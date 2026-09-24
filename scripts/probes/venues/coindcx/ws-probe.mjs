// CoinDCX futures WebSocket probe: the Socket.IO book channel, its version chain and delta semantics, level order, size unit against Binance, the current prices channel, errors, a batch of every active pair on one socket, and session silence.
// CoinDCX speaks Socket.IO v4 (Engine.IO 4) over wss://stream.coindcx.com, so this probe frames the Engine.IO and Socket.IO packets by hand on a plain ws socket.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate offer in `handshake`.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coindcx/ws-probe.mjs [book|relay|errors|batch|silence|handshake]
//   book       six book streams at depths 50, 20 and 10, current prices, trades and prices on one socket for 75 s, with a Binance REST book compare. About 80 s.
//   relay      three CoinDCX book streams beside the Binance USD-M diff and partial depth streams of the same symbols for 25 s, matched by the event time E.
//   errors     one socket per malformed or unknown request, then a doubled join and two depths of one pair on one socket. About 20 s.
//   batch      every active pair at depth 50 on one socket for 60 s. About 65 s.
//   silence    three sockets that differ only in whether they answer the server ping and whether they joined a book, up to 110 s.
//   handshake  Engine.IO 3 against 4, and one permessage-deflate offer. About 15 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/coindcx/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL4 = 'wss://stream.coindcx.com/socket.io/?EIO=4&transport=websocket';
const URL3 = 'wss://stream.coindcx.com/socket.io/?EIO=3&transport=websocket';
const ACTIVE = 'https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT';
const BN = 'https://fapi.binance.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);
const bookChannel = (pair, depth) => `${pair}@orderbook@${depth}-futures`;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Opens a Socket.IO v4 client on a raw socket. onEvent gets (event, data, rawText, recvMs) for every 42 packet, with data parsed twice when it is a JSON string.
function sio({ url = URL4, joins = [], answerPing = true, onEvent = () => {}, onRaw = () => {}, deflate = false }) {
  const t0 = Date.now();
  const state = { t0, openMs: null, sid: null, pings: 0, closed: null, other: [], ws: null };
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  state.ws = ws;
  ws.on('upgrade', (r) => { state.upgrade = { status: r.statusCode, ext: r.headers['sec-websocket-extensions'] ?? null, server: r.headers.server ?? null }; });
  ws.on('open', () => { state.openMs = Date.now() - t0; });
  ws.on('message', (m) => {
    const s = m.toString();
    const now = Date.now();
    onRaw(s, now);
    if (s === '2') { state.pings++; state.lastPingAt = now - t0; if (answerPing) ws.send('3'); return; }
    if (s[0] === '0') { state.handshake = JSON.parse(s.slice(1)); ws.send('40'); return; }
    if (s.startsWith('40')) { state.connectedMs = now - t0; for (const c of joins) ws.send('42' + JSON.stringify(['join', { channelName: c }])); state.joinedAt = now; return; }
    if (s.startsWith('42')) {
      const [event, body] = JSON.parse(s.slice(2));
      let data = body?.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { /* left as text */ } }
      onEvent(event, data, s, now, body);
      return;
    }
    if (state.other.length < 10) state.other.push({ at: now - t0, text: s.slice(0, 200) });
  });
  ws.on('close', (code, reason) => { state.closed = { code, reason: reason.toString(), at: Date.now() - t0 }; });
  ws.on('error', (e) => { state.error = e.message; });
  state.send = (text) => { if (ws.readyState === ws.OPEN) ws.send(text); };
  state.close = () => ws.terminate();
  return state;
}

// Keeps a book per stream from snapshots and updates, and checks each new snapshot against the book the updates built.
function makeTracker(name, depth) {
  const t = { name, depth, first: null, firstAtMs: null, snaps: 0, updates: 0, gaps: 0, repeats: 0, back: 0, lastVs: null, lastTs: null, tsSteps: [], snapTs: [], lag: [], updLevels: [], updZeros: 0, updOutside: 0, snapLevels: [], rawAskUnordered: 0, rawBidUnordered: 0, integerKeyFirst: 0, checks: [], staleChecks: [], priceChecks: [], stalePriceChecks: [], applied: 0, crossed: 0, snapBids: null, snapAsks: null, bids: null, asks: null, sampleUpdate: null, sampleSnap: null, fields: new Set() };
  t.on = (event, d, raw, now, joinedAt) => {
    Object.keys(d).forEach((k) => t.fields.add(k));
    if (t.first === null) { t.first = event; t.firstAtMs = now - joinedAt; }
    if (t.lastVs !== null) {
      if (d.vs === t.lastVs) t.repeats++;
      else if (d.vs < t.lastVs) t.back++;
      else if (d.vs !== t.lastVs + 1) t.gaps++;
    }
    t.lastVs = d.vs;
    if (t.lastTs !== null) t.tsSteps.push(d.ts - t.lastTs);
    t.lastTs = d.ts;
    t.lag.push(now - d.ts);
    const bidKeys = rawKeys(raw, 'bids'), askKeys = rawKeys(raw, 'asks');
    if (event === 'depth-snapshot') {
      t.snaps++; t.snapTs.push(d.ts);
      t.snapLevels.push([Object.keys(d.bids).length, Object.keys(d.asks).length]);
      if (!isMonotonic(askKeys, 1)) t.rawAskUnordered++;
      if (!isMonotonic(bidKeys, -1)) t.rawBidUnordered++;
      if (askKeys.length && Number.isInteger(Number(askKeys[0])) && askKeys.length > 1 && Number(askKeys[0]) > Number(askKeys[1])) t.integerKeyFirst++;
      // The snapshot is one 500 ms tick after the last update, so the overlap is compared with the overlap of the previous snapshot alone.
      if (t.bids) {
        const want = [...top(toMap(d.bids), -1, depth).map(([p, z]) => `b${p}:${z}`), ...top(toMap(d.asks), 1, depth).map(([p, z]) => `a${p}:${z}`)];
        const built = new Set([...top(t.bids, -1, depth).map(([p, z]) => `b${p}:${z}`), ...top(t.asks, 1, depth).map(([p, z]) => `a${p}:${z}`)]);
        const stale = new Set([...top(t.snapBids, -1, depth).map(([p, z]) => `b${p}:${z}`), ...top(t.snapAsks, 1, depth).map(([p, z]) => `a${p}:${z}`)]);
        t.checks.push(want.filter((k) => built.has(k)).length / want.length);
        const priceOf = (k) => k.split(':')[0];
        const builtP = new Set([...built].map(priceOf)), staleP = new Set([...stale].map(priceOf));
        t.priceChecks.push(want.filter((k) => builtP.has(priceOf(k))).length / want.length);
        t.stalePriceChecks.push(want.filter((k) => staleP.has(priceOf(k))).length / want.length);
        t.staleChecks.push(want.filter((k) => stale.has(k)).length / want.length);
      }
      t.bids = toMap(d.bids); t.asks = toMap(d.asks);
      t.snapBids = toMap(d.bids); t.snapAsks = toMap(d.asks);
      if (!t.sampleSnap) t.sampleSnap = raw;
    } else {
      t.updates++;
      const n = Object.keys(d.bids ?? {}).length + Object.keys(d.asks ?? {}).length;
      t.updLevels.push(n);
      for (const side of ['bids', 'asks']) for (const [p, sz] of Object.entries(d[side] ?? {})) {
        if (Number(sz) === 0) t.updZeros++;
        if (t[side]) {
          const edge = top(t[side], side === 'bids' ? -1 : 1, depth).at(-1)?.[0];
          if (edge !== undefined && (side === 'bids' ? Number(p) < edge : Number(p) > edge)) t.updOutside++;
          if (Number(sz) === 0) t[side].delete(Number(p)); else t[side].set(Number(p), Number(sz));
        }
      }
      if (t.bids) {
        t.applied++;
        const bb = top(t.bids, -1, 1)[0]?.[0], ba = top(t.asks, 1, 1)[0]?.[0];
        if (bb !== undefined && ba !== undefined && bb >= ba) t.crossed++;
      }
      if (!t.sampleUpdate) t.sampleUpdate = raw;
    }
  };
  t.summary = () => ({
    stream: name, first: t.first, firstAfterJoinMs: t.firstAtMs, snapshots: t.snaps, updates: t.updates, vsGaps: t.gaps, vsRepeats: t.repeats, vsBackwards: t.back,
    tsStepMs: [q(t.tsSteps, 0), q(t.tsSteps, 0.5), q(t.tsSteps, 1)], snapshotEveryMs: q(t.snapTs.slice(1).map((x, i) => x - t.snapTs[i]), 0.5),
    recvMinusTsMs: [q(t.lag, 0), q(t.lag, 0.5), q(t.lag, 1)], snapshotLevels: t.snapLevels.slice(0, 3), updateLevels: [q(t.updLevels, 0), q(t.updLevels, 0.5), q(t.updLevels, 1)],
    updateZeroSizes: t.updZeros, updateLevelsOutsideWindow: t.updOutside, rawAsksNotAscending: t.rawAskUnordered, rawBidsNotDescending: t.rawBidUnordered, integerPriceKeyHoisted: t.integerKeyFirst,
    nextSnapshotLevelsFound: { checks: t.checks.length, inBookBuiltFromUpdates: [q(t.checks, 0), q(t.checks, 0.5), q(t.checks, 1)].map((x) => (x === null ? null : +x.toFixed(2))), inPreviousSnapshotAlone: [q(t.staleChecks, 0), q(t.staleChecks, 0.5), q(t.staleChecks, 1)].map((x) => (x === null ? null : +x.toFixed(2))), pricesInBuilt: [q(t.priceChecks, 0), q(t.priceChecks, 0.5), q(t.priceChecks, 1)].map((x) => (x === null ? null : +x.toFixed(2))), pricesInPreviousSnapshot: [q(t.stalePriceChecks, 0), q(t.stalePriceChecks, 0.5), q(t.stalePriceChecks, 1)].map((x) => (x === null ? null : +x.toFixed(2))) },
    crossedAfterUpdate: `${t.crossed} of ${t.applied}`, fields: [...t.fields].join(','),
  });
  return t;
}

function rawKeys(raw, side) {
  const inner = raw.replace(/\\"/g, '"');
  const m = inner.match(new RegExp(`"${side}":\\{([^}]*)\\}`));
  return m ? [...m[1].matchAll(/"([0-9.eE-]+)":/g)].map((x) => x[1]) : [];
}
const isMonotonic = (keys, dir) => keys.every((k, i) => i === 0 || dir * (Number(k) - Number(keys[i - 1])) > 0);
const toMap = (o) => new Map(Object.entries(o ?? {}).map(([p, s]) => [Number(p), Number(s)]));
const top = (m, dir, n) => [...m.entries()].filter(([, s]) => s > 0).sort((a, b) => dir * (a[0] - b[0])).slice(0, n);

async function book() {
  const streams = [['B-BTC_USDT', 50], ['B-ETH_USDT', 50], ['B-DOGE_USDT', 50], ['B-CHR_USDT', 50], ['B-SOL_USDT', 20], ['B-XRP_USDT', 10]];
  const trackers = new Map(streams.map(([p, d]) => [p.slice(2).replace('_', ''), makeTracker(bookChannel(p, d), d)]));
  const counts = {};
  const seeds = [];
  const cp = { snapshots: [], frames: 0, pairs: new Set(), perFrame: [], fields: {}, btcMp: 0, lastBtcMp: null, first: null };
  let bnDone = false;
  const st = sio({
    joins: [...streams.map(([p, d]) => bookChannel(p, d)), 'currentPrices@futures@rt', 'B-BTC_USDT@trades-futures', 'B-BTC_USDT@prices-futures'],
    onEvent: async (event, d, raw, now) => {
      counts[event] = (counts[event] ?? 0) + 1;
      if (counts[event] <= 3) capture(`book_${event}.txt`, raw);
      if (event === 'depth-snapshot' || event === 'depth-update') {
        const t = trackers.get(d.s);
        if (!t) { counts.unrouted = (counts.unrouted ?? 0) + 1; return; }
        const isFirst = t.first === null;
        t.on(event, d, raw, now, st.joinedAt);
        // The REST book of the same depth is read on the first frame, to see whether its vs belongs to the same chain and can seed the stream.
        if (isFirst) {
          const [pair, depth] = streams.find(([p]) => p.slice(2).replace('_', '') === d.s);
          fetch(`https://public.coindcx.com/market_data/v3/orderbook/${pair}-futures/${depth}`).then((x) => x.json()).then((r) => { seeds.push({ stream: t.name, firstEvent: event, firstVs: d.vs, restVs: r.vs, restMinusFirst: r.vs - d.vs, restLevels: [Object.keys(r.bids).length, Object.keys(r.asks).length] }); });
        }
        if (event === 'depth-snapshot' && d.s === 'ETHUSDT' && !bnDone && t.snaps >= 2) {
          bnDone = true;
          const r = await fetch(`${BN}/fapi/v1/depth?symbol=ETHUSDT&limit=50`).then((x) => x.json());
          const bb = new Map(r.bids.map(([p, s]) => [Number(p), Number(s)]));
          const mine = top(toMap(d.bids), -1, 20);
          log('ws_vs_binance_book', { pair: 'B-ETH_USDT', top20: mine.length, pricesOnBinance: mine.filter(([p]) => bb.has(p)).length, sizesEqual: mine.filter(([p, s]) => bb.get(p) === s).length, wsTs: d.ts, binanceE: r.E, dcxTop: mine[0], bnTop: r.bids[0] });
        }
      } else if (event === 'currentPrices@futures#snapshot') {
        cp.snapshots.push({ atMs: now - st.joinedAt, pairs: Object.keys(d.prices).length, withMark: Object.values(d.prices).filter((v) => v.mp > 0).length, withEfr: Object.values(d.prices).filter((v) => v.efr !== undefined).length });
      } else if (event === 'currentPrices@futures#update') {
        cp.frames++;
        if (cp.first === null) cp.first = Object.keys(d.prices).length;
        cp.perFrame.push(Object.keys(d.prices).length);
        for (const [k, v] of Object.entries(d.prices)) {
          cp.pairs.add(k);
          for (const f of Object.keys(v)) cp.fields[f] = (cp.fields[f] ?? 0) + 1;
          if (k === 'B-BTC_USDT' && v.mp !== undefined && v.mp !== cp.lastBtcMp) { cp.btcMp++; cp.lastBtcMp = v.mp; }
        }
      }
    },
  });
  const pingBefore = st.pings;
  await sleep(75_000);
  st.close();
  log('session', { openMs: st.openMs, connectedMs: st.connectedMs, handshake: st.handshake, upgrade: st.upgrade, serverPings: st.pings - pingBefore, closed: st.closed, other: st.other });
  log('events', { counts });
  for (const x of seeds) log('rest_seed', x);
  for (const t of trackers.values()) {
    log('book_stream', t.summary());
    capture('book_samples.txt', `${t.name}\nSNAP ${t.sampleSnap}\nUPD ${t.sampleUpdate}`);
  }
  log('current_prices', { snapshots: cp.snapshots, frames: cp.frames, perSecond: +(cp.frames / 75).toFixed(2), pairsSeen: cp.pairs.size, pairsInFirstFrame: cp.first, pairsPerFrame: [q(cp.perFrame, 0), q(cp.perFrame, 0.5), q(cp.perFrame, 1)], fieldCounts: cp.fields, btcMarkChanges: cp.btcMp });
}

async function errors() {
  const cases = [
    ['unknown pair', ['B-NOPE_USDT@orderbook@50-futures']],
    ['depth 30', ['B-BTC_USDT@orderbook@30-futures']],
    ['binance spelling', ['BTCUSDT@orderbook@50-futures']],
    ['spot spelling on futures host', ['B-BTC_USDT@orderbook@20']],
    ['no suffix depth', ['B-BTC_USDT@orderbook-futures']],
  ];
  const sockets = cases.map(([name, joins]) => {
    const seen = {};
    const s = sio({ joins, onEvent: (event, d, raw) => { seen[event] = (seen[event] ?? 0) + 1; if (seen[event] === 1) capture('errors.txt', `${name} ${raw}`); } });
    return { name, s, seen };
  });
  const dbl = {};
  const vsSeen = new Map();
  const twice = sio({
    joins: ['B-ETH_USDT@orderbook@50-futures', 'B-ETH_USDT@orderbook@50-futures', 'B-ETH_USDT@orderbook@20-futures'],
    onEvent: (event, d) => {
      if (!event.startsWith('depth')) return;
      const n = Object.keys(d.bids ?? {}).length;
      const key = `${event}:${d.s}`;
      dbl[key] = (dbl[key] ?? 0) + 1;
      const k = `${d.vs}`;
      vsSeen.set(k, (vsSeen.get(k) ?? 0) + 1);
      if (event === 'depth-snapshot') dbl[`snapshotBids${n}`] = (dbl[`snapshotBids${n}`] ?? 0) + 1;
    },
  });
  const junk = sio({ joins: [] });
  await sleep(3_000);
  const junkSeen = {};
  junk.ws.on('message', (m) => { const s = m.toString(); if (s !== '2') junkSeen[s.slice(0, 60)] = (junkSeen[s.slice(0, 60)] ?? 0) + 1; });
  junk.send('42' + JSON.stringify(['nope', { channelName: 'B-BTC_USDT@orderbook@50-futures' }]));
  junk.send('42' + JSON.stringify(['join', { channel: 'B-BTC_USDT@orderbook@50-futures' }]));
  junk.send('42' + JSON.stringify(['ping', { data: 'Ping message' }]));
  await sleep(4_000);
  const junkBeforeMalformed = { closed: junk.closed, replies: { ...junkSeen } };
  // Only a packet that is not valid Socket.IO is left, and it is sent last because it may end the session.
  junk.send('42nope');
  await sleep(8_000);
  // A leave on the doubled socket, to see whether one leave stops both joins.
  twice.send('42' + JSON.stringify(['leave', { channelName: 'B-ETH_USDT@orderbook@50-futures' }]));
  const afterLeave = {};
  twice.ws.on('message', (m) => { const s = m.toString(); if (s.startsWith('42["depth')) { const d = JSON.parse(JSON.parse(s.slice(2))[1].data); const k = `${Object.keys(d.bids).length >= 21 || Object.keys(d.asks).length >= 21 ? 'over20' : 'upTo20'}`; afterLeave[k] = (afterLeave[k] ?? 0) + 1; } });
  await sleep(6_000);
  for (const { name, s, seen } of sockets) { log('error_case', { name, events: seen, other: s.other, closed: s.closed }); s.close(); }
  const dup = [...vsSeen.values()].filter((c) => c > 1).length;
  log('doubled_join', { note: '50 joined twice plus 20 on one socket for 15 s', counts: dbl, vsValuesSeenMoreThanOnce: dup, distinctVs: vsSeen.size, afterLeaveOf50For6s: afterLeave, closed: twice.closed });
  log('junk_packets', { validButUnknownFor4s: junkBeforeMalformed, afterMalformed: { replies: junkSeen, other: junk.other, closed: junk.closed } });
  twice.close(); junk.close();
}

async function batch() {
  const pairs = await fetch(ACTIVE).then((r) => r.json());
  const trackers = new Map(pairs.map((p) => [p.slice(2).replace('_', ''), makeTracker(p, 50)]));
  let frames = 0, bytes = 0, parseNs = 0n, unrouted = 0;
  const perSecond = [];
  let secFrames = 0;
  const tick = setInterval(() => { perSecond.push(secFrames); secFrames = 0; }, 1000);
  const st = sio({
    joins: pairs.map((p) => bookChannel(p, 50)),
    onRaw: (s) => { frames++; secFrames++; bytes += s.length; },
    onEvent: (event, d, raw, now) => {
      if (!event.startsWith('depth')) return;
      const t0 = process.hrtime.bigint();
      JSON.parse(JSON.parse(raw.slice(2))[1].data);
      parseNs += process.hrtime.bigint() - t0;
      const t = trackers.get(d.s);
      if (!t) { unrouted++; return; }
      t.on(event, d, raw, now, st.joinedAt);
    },
  });
  await sleep(62_000);
  clearInterval(tick);
  st.close();
  const all = [...trackers.values()];
  const silent = all.filter((t) => t.first === null).map((t) => t.name);
  const noSnap = all.filter((t) => t.snaps === 0 && t.first !== null).map((t) => t.name);
  const firstSnapMs = [];
  const snapEvery = all.map((t) => q(t.snapTs.slice(1).map((x, i) => x - t.snapTs[i]), 0.5)).filter((x) => x !== null);
  const updEvery = all.map((t) => q(t.tsSteps, 0.5)).filter((x) => x !== null);
  const crossed = all.reduce((a, t) => a + t.crossed, 0), applied = all.reduce((a, t) => a + t.applied, 0);
  const crossedStreams = all.filter((t) => t.crossed > 0).length;
  log('batch', {
    pairs: pairs.length, openMs: st.openMs, closed: st.closed, framesTotal: frames, framesPerSecond: [q(perSecond, 0), q(perSecond, 0.5), q(perSecond, 1)], bytesPerSecond: Math.round(bytes / 62), bytesPerFrame: Math.round(bytes / frames),
    doubleParseMicrosPerFrame: +(Number(parseNs) / 1000 / Math.max(1, all.reduce((a, t) => a + t.snaps + t.updates, 0))).toFixed(1), unrouted,
    streamsSilent: silent.length, silentSample: silent.slice(0, 10), streamsWithoutSnapshot: noSnap.length, noSnapSample: noSnap.slice(0, 10),
    vsGaps: all.reduce((a, t) => a + t.gaps, 0), vsRepeats: all.reduce((a, t) => a + t.repeats, 0), vsBackwards: all.reduce((a, t) => a + t.back, 0),
    medianSnapshotEveryMs: [q(snapEvery, 0), q(snapEvery, 0.5), q(snapEvery, 1)], medianFrameStepMs: [q(updEvery, 0), q(updEvery, 0.5), q(updEvery, 1)],
    crossedAfterUpdate: `${crossed} of ${applied}`, streamsThatCrossed: crossedStreams, snapshotsPerStream: [q(all.map((t) => t.snaps), 0), q(all.map((t) => t.snaps), 0.5), q(all.map((t) => t.snaps), 1)], serverPings: st.pings, other: st.other,
  });
  const gapped = all.filter((t) => t.gaps > 0).map((t) => `${t.name}:${t.gaps}`);
  log('batch_gaps', { streamsWithGaps: gapped.length, sample: gapped.slice(0, 10) });
}

// Matches each CoinDCX book frame to the Binance USD-M depth streams of the same symbol, by the Binance event time E the update carries.
async function relay() {
  const pairs = [['XRPUSDT', 10], ['ETHUSDT', 20], ['CHRUSDT', 50]];
  const bnDiff = new Map(), bnPart = new Map();
  const dcx = [];
  const names = pairs.flatMap(([s, d]) => [`${s.toLowerCase()}@depth@500ms`, ...(d <= 20 ? [`${s.toLowerCase()}@depth${d}@500ms`] : [])]);
  const bn = new WebSocket(`wss://fstream.binance.com/stream?streams=${names.join('/')}`, { perMessageDeflate: false });
  bn.on('message', (m) => {
    const { stream, data } = JSON.parse(m.toString());
    const key = `${data.s}:${data.E}`;
    (stream.includes('@depth@') ? bnDiff : bnPart).set(key, data);
  });
  const st = sio({ joins: pairs.map(([s, d]) => bookChannel(`B-${s.replace('USDT', '')}_USDT`, d)), onEvent: (event, d, raw, now) => { if (event.startsWith('depth')) dcx.push({ event, d, now }); } });
  await sleep(25_000);
  st.close(); bn.terminate();
  const levels = (o) => Object.entries(o ?? {}).map(([p, q]) => [Number(p), Number(q)]);
  for (const [sym, depth] of pairs) {
    const mine = dcx.filter((x) => x.d.s === sym);
    const r = { symbol: sym, depth, frames: mine.length, updates: 0, updWithE: 0, eFoundInDiff: 0, eFoundInPartial: 0, updLevelsInDiffSameSize: 0, updLevels: 0, diffLevelsNotInUpd: 0, diffLevelsNotInUpdInsideWindow: 0, droppedInsideWindowWereZero: 0, updLevelsNotInDiff: 0, sizeMismatchSample: [], updZeroSizes: 0, diffZeroSizes: 0, updSubsetOfPartial: 0, partialLevelsNotInUpd: 0, eMinusBinanceT: [] };
    for (const { event, d } of mine) {
      if (event !== 'depth-update') continue;
      r.updates++;
      if (d.E === undefined) continue;
      r.updWithE++;
      const diff = bnDiff.get(`${sym}:${d.E}`), part = bnPart.get(`${sym}:${d.E}`);
      const upd = [...levels(d.bids).map((x) => ['b', ...x]), ...levels(d.asks).map((x) => ['a', ...x])];
      r.updLevels += upd.length;
      r.updZeroSizes += upd.filter((x) => x[2] === 0).length;
      if (diff) {
        r.eFoundInDiff++;
        const dm = new Map([...diff.b.map(([p, q]) => [`b${Number(p)}`, Number(q)]), ...diff.a.map(([p, q]) => [`a${Number(p)}`, Number(q)])]);
        r.diffZeroSizes += [...dm.values()].filter((q) => q === 0).length;
        r.updLevelsInDiffSameSize += upd.filter(([side, p, q]) => dm.get(`${side}${p}`) === q).length;
        const um = new Set(upd.map(([side, p]) => `${side}${p}`));
        const bidLo = Math.min(...levels(d.bids).map((x) => x[0])), askHi = Math.max(...levels(d.asks).map((x) => x[0]));
        for (const [k, qty] of dm) if (!um.has(k)) { r.diffLevelsNotInUpd++; const p = Number(k.slice(1)); if ((k[0] === 'b' && p >= bidLo) || (k[0] === 'a' && p <= askHi)) { r.diffLevelsNotInUpdInsideWindow++; if (qty === 0) r.droppedInsideWindowWereZero++; } }
        for (const [side, p, qty] of upd) { const want = dm.get(`${side}${p}`); if (want !== qty && r.sizeMismatchSample.length < 4) r.sizeMismatchSample.push(`${side}${p}:dcx${qty}/bn${want}`); if (want === undefined) r.updLevelsNotInDiff++; }
        r.eMinusBinanceT.push(d.E - diff.T);
      }
      if (part) {
        r.eFoundInPartial++;
        const pm = new Map([...part.b.map(([p, q]) => [`b${Number(p)}`, Number(q)]), ...part.a.map(([p, q]) => [`a${Number(p)}`, Number(q)])]);
        if (upd.every(([side, p, q]) => pm.get(`${side}${p}`) === q)) r.updSubsetOfPartial++;
        const um = new Set(upd.map(([side, p]) => `${side}${p}`));
        r.partialLevelsNotInUpd += [...pm.keys()].filter((k) => !um.has(k)).length;
      }
    }
    r.eMinusBinanceT = [q(r.eMinusBinanceT, 0), q(r.eMinusBinanceT, 0.5), q(r.eMinusBinanceT, 1)];
    log('relay', r);
  }
  log('relay_counts', { dcxFrames: dcx.length, binanceDiffEvents: bnDiff.size, binancePartialEvents: bnPart.size });
}

async function silence() {
  const a = sio({ joins: [], answerPing: true });
  const b = sio({ joins: [], answerPing: false });
  const c = sio({ joins: ['B-BTC_USDT@orderbook@10-futures'], answerPing: false });
  const started = Date.now();
  while (Date.now() - started < 110_000 && !(b.closed && c.closed)) await sleep(1000);
  for (const [name, s] of [['answers pings, no join', a], ['no pong, no join', b], ['no pong, joined book', c]]) {
    log('silence', { name, handshake: s.handshake, serverPings: s.pings, lastPingAtMs: s.lastPingAt, closed: s.closed, heldMs: Date.now() - s.t0, other: s.other });
    s.close();
  }
}

async function handshake() {
  for (const [name, url, deflate] of [['EIO 4', URL4, false], ['EIO 3', URL3, false], ['EIO 4 deflate offer', URL4, true]]) {
    const raw = [];
    const s = sio({ url, deflate, joins: ['B-BTC_USDT@orderbook@10-futures'], onRaw: (m, now) => { if (raw.length < 4) raw.push(`${now - s.t0}ms ${m.slice(0, 120)}`); } });
    await sleep(4_000);
    log('handshake', { name, upgrade: s.upgrade, openMs: s.openMs, first: raw, closed: s.closed, error: s.error });
    s.close();
  }
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, handshake, relay };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
