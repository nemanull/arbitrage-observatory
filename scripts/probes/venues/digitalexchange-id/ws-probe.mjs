// Digitalexchange.id WebSocket probe: the undocumented Socket.IO v3 feeds behind the web trading page, which are the only book stream the venue exposes.
// It measures the handshake, which subscribe string delivers a book, depth frame cadence, level count and order, number format, idle repeats, unknown symbols, whether a socket carries more than one pair, ten sockets from one host, what the server does to a silent client, and permessage-deflate.
// Public, unauthenticated, read-only: it joins the same guest rooms an anonymous browser joins, sends no header or cookie, and places nothing.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/digitalexchange-id/ws-probe.mjs [book|batch|silence|deflate]
//   book     eight sockets for 35 s, one per subscribe form and host, plus REST depth reads of BTCIDR, USDTIDR and DCTIDR to compare. About 36 s.
//   batch    ten sockets on socket-market, one liquid pair each, for 25 s.
//   silence  three sockets that differ in whether they join the namespace and answer pings, for up to 55 s.
//   deflate  offers permessage-deflate once on each host, then lists what the main host pushes to the market room for 20 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames.
// Recorded in docs/profiles/digitalexchange-id/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const MARKET_HOST = 'socket-market.digitalexchange.id'; // the web page reads @depth from this host
const MAIN_HOST = 'socket.digitalexchange.id'; // ticker, market summary and chat
const SITE = 'https://digitalexchange.id';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const url = (host) => `wss://${host}/socket.io/?EIO=4&transport=websocket`;
// Prices and sizes arrive formatted for Indonesian readers: "1.551.622.084" and "1,83657".
const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

const stats = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

// Opens one Engine.IO v4 socket, joins the default namespace unless told not to, and hands every Socket.IO event to onEvent.
// subGapMs spaces the subscribe frames, to tell a dropped burst from a server that honours one room per socket.
function openSio(host, { subs = [], subGapMs = 0, join: doJoin = true, pong = true, deflate = false, name = host, onEvent = () => {} } = {}) {
  const t0 = Date.now();
  const s = { name, t0, pings: 0, events: 0, closed: null, handshake: null, joined: null, other: [] };
  const ws = new WebSocket(url(host), { perMessageDeflate: deflate });
  s.ws = ws;
  ws.on('upgrade', (res) => { s.upgrade = { status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null }; });
  ws.on('open', () => { s.openMs = Date.now() - t0; });
  ws.on('message', (data) => {
    const text = data.toString();
    const now = Date.now();
    capture(`${name}.txt`, `${now} ${text}`);
    if (text === '2') { s.pings++; s.lastPingAt = now - t0; if (pong) ws.send('3'); return; }
    if (text.startsWith('0{')) { s.handshake = JSON.parse(text.slice(1)); if (doJoin) ws.send('40'); return; }
    if (text.startsWith('40')) {
      s.joined = { ms: now - t0, body: text.slice(2) };
      s.subSentAt = Date.now();
      subs.forEach((sub, i) => setTimeout(() => ws.send('42' + JSON.stringify(['subscribe', sub])), i * subGapMs));
      return;
    }
    if (text.startsWith('42[')) {
      s.events++;
      const t = performance.now();
      const [ev, payload] = JSON.parse(text.slice(2));
      s.parseUs = (s.parseUs ?? 0) + (performance.now() - t) * 1000;
      onEvent(ev, payload, now, text.length);
      return;
    }
    s.other.push(text.slice(0, 200));
  });
  ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }; });
  ws.on('error', (e) => { s.error = e.message; });
  return s;
}

function bookShape(payload) {
  const asks = (payload.ask ?? []).map((l) => [num(l.price), num(l.amount), num(l.total)]);
  const bids = (payload.bid ?? []).map((l) => [num(l.price), num(l.amount), num(l.total)]);
  const asc = (xs) => xs.every((x, i) => i === 0 || x[0] > xs[i - 1][0]);
  const desc = (xs) => xs.every((x, i) => i === 0 || x[0] < xs[i - 1][0]);
  // total is price times the unrounded amount, so a mismatch means the amount was rounded for display
  const totalOk = [...asks, ...bids].every(([p, a, t]) => Math.abs(p * a - t) <= Math.max(1, 0.001 * t));
  return { asks, bids, askAsc: asc(asks), bidDesc: desc(bids), totalOk, keys: Object.keys(payload).join('|') };
}

async function modeBook() {
  // One subscription per socket, because a second subscribe on the same socket is ignored (the 'second-sub' socket shows it).
  const forms = [
    { name: 'BTCIDR@graph', host: MARKET_HOST, subs: ['guest.tradedata-BTCIDR@graph'] },
    { name: 'PEPEIDR@graph', host: MARKET_HOST, subs: ['guest.tradedata-PEPEIDR@graph'] },
    { name: 'USDTIDR@graph', host: MARKET_HOST, subs: ['guest.tradedata-USDTIDR@graph'] },
    { name: 'ETHIDR-bare', host: MARKET_HOST, subs: ['guest.tradedata-ETHIDR'] },
    { name: 'BTCIDR@graph-main-host', host: MAIN_HOST, subs: ['guest.tradedata-BTCIDR@graph'] },
    { name: 'DCTIDR-bare-main-host', host: MAIN_HOST, subs: ['guest.tradedata-DCTIDR'] },
    { name: 'NOPEIDR@graph', host: MARKET_HOST, subs: ['guest.tradedata-NOPEIDR@graph'] },
    { name: 'second-sub', host: MARKET_HOST, subs: ['guest.tradedata-DOGEIDR@graph', 'guest.tradedata-SOLIDR@graph'], subGapMs: 5_000 },
  ];
  const per = {}; // socket name -> event name -> records
  const sockets = forms.map((f) => {
    per[f.name] = {};
    return openSio(f.host, {
      name: f.name,
      subs: f.subs,
      subGapMs: f.subGapMs,
      onEvent: (ev, payload, now, bytes) => {
        const rec = (per[f.name][ev] ??= { n: 0, at: [], bytes: [], frames: [] });
        rec.n++;
        rec.at.push(now);
        rec.bytes.push(bytes);
        if (ev.endsWith('@depth')) rec.frames.push({ now, text: JSON.stringify(payload), shape: bookShape(payload) });
        else if (rec.n === 1) rec.first = JSON.stringify(payload).slice(0, 300);
      },
    });
  });
  await sleep(17_000);
  // REST depth reads in the middle of the run, each set against the socket frame nearest to it.
  const restAt = Date.now();
  const rest = {};
  for (const pair of ['btcidr', 'usdtidr', 'dctidr']) {
    const r = await fetch(`${SITE}/api/${pair}/depth`);
    rest[pair] = { status: r.status, at: Date.now(), body: await r.json() };
  }
  await sleep(18_000);
  for (const s of sockets) s.ws.close();
  await sleep(500);

  for (const s of sockets) {
    log('socket', { name: s.name, upgrade: s.upgrade, openMs: s.openMs, handshake: s.handshake, joined: s.joined, pings: s.pings, closed: s.closed, error: s.error, other: s.other.slice(0, 3) });
    for (const [ev, rec] of Object.entries(per[s.name])) {
      const gaps = rec.at.slice(1).map((t, i) => t - rec.at[i]);
      const out = { socket: s.name, event: ev, frames: rec.n, gapMs: stats(gaps), bytes: stats(rec.bytes) };
      if (rec.frames.length > 0) {
        const f = rec.frames;
        out.firstAfterSubscribeMs = f[0].now - s.subSentAt;
        out.levels = { asks: stats(f.map((x) => x.shape.asks.length)), bids: stats(f.map((x) => x.shape.bids.length)) };
        out.askAscAll = f.every((x) => x.shape.askAsc);
        out.bidDescAll = f.every((x) => x.shape.bidDesc);
        out.keys = [...new Set(f.map((x) => x.shape.keys))];
        out.identicalToPrevious = f.slice(1).filter((x, i) => x.text === f[i].text).length;
        out.touchChanged = f.slice(1).filter((x, i) => x.shape.asks[0]?.[0] !== f[i].shape.asks[0]?.[0] || x.shape.bids[0]?.[0] !== f[i].shape.bids[0]?.[0]).length;
        out.crossed = f.filter((x) => x.shape.asks[0] && x.shape.bids[0] && x.shape.asks[0][0] < x.shape.bids[0][0]).length;
        out.locked = f.filter((x) => x.shape.asks[0] && x.shape.bids[0] && x.shape.asks[0][0] === x.shape.bids[0][0]).length;
        // Each refresh arrives as a repeat of the previous book followed a few ms later by the new one, so count the refreshes that bring a new book.
        out.newBookGapMs = stats(f.map((x, i) => ({ x, i })).filter(({ x, i }) => i > 0 && x.text !== f[i - 1].text).map(({ x, i }, k, arr) => (k === 0 ? null : x.now - arr[k - 1].x.now)).filter((v) => v !== null));
        out.sizeRoundedForDisplay = f.some((x) => !x.shape.totalOk);
        out.emptySide = f.filter((x) => x.shape.asks.length === 0 || x.shape.bids.length === 0).length;
        const last = f[f.length - 1].shape;
        out.lastTouch = { bid: last.bids[0], ask: last.asks[0] };
        out.sample = f[f.length - 1].text.slice(0, 260);
      } else if (rec.first) {
        out.first = rec.first;
      }
      log('event', out);
    }
  }

  // REST against the socket frame nearest in time.
  const pairMap = { btcidr: ['BTCIDR@graph', 'tradedata-BTCIDR@depth'], usdtidr: ['USDTIDR@graph', 'tradedata-USDTIDR@depth'], dctidr: ['DCTIDR-bare-main-host', 'tradedata-DCTIDR@depth'] };
  for (const [pair, [sock, ev]] of Object.entries(pairMap)) {
    const r = rest[pair];
    const frames = per[sock][ev]?.frames ?? [];
    if (frames.length === 0 || r.body?.status !== 'success') {
      const d = r.body?.data ?? {};
      log('rest-vs-ws', { pair, status: r.status, restStatus: r.body?.status, wsFrames: frames.length, restLevels: { buy: d.buy?.length, sell: d.sell?.length }, restTouch: { bid: d.buy?.[0], ask: d.sell?.[0] } });
      continue;
    }
    const near = frames.reduce((b, x) => (Math.abs(x.now - r.at) < Math.abs(b.now - r.at) ? x : b));
    const rb = r.body.data.buy.map(([p, a]) => [Number(p), Number(a)]);
    const ra = r.body.data.sell.map(([p, a]) => [Number(p), Number(a)]);
    const wsBidSet = new Map(near.shape.bids.map(([p, a]) => [p, a]));
    const wsAskSet = new Map(near.shape.asks.map(([p, a]) => [p, a]));
    log('rest-vs-ws', {
      pair,
      restKeys: Object.keys(r.body.data),
      restLevels: { buy: rb.length, sell: ra.length },
      restBuyDesc: rb.every((x, i) => i === 0 || x[0] < rb[i - 1][0]),
      restSellAsc: ra.every((x, i) => i === 0 || x[0] > ra[i - 1][0]),
      restTouch: { bid: rb[0], ask: ra[0] },
      wsTouch: { bid: near.shape.bids[0], ask: near.shape.asks[0] },
      msApart: near.now - r.at,
      bidPricesAlsoOnWs: rb.filter(([p]) => wsBidSet.has(p)).length,
      askPricesAlsoOnWs: ra.filter(([p]) => wsAskSet.has(p)).length,
      sizeDecimalsRest: Math.max(...r.body.data.buy.concat(r.body.data.sell).map(([, a]) => (a.split('.')[1] ?? '').length)),
      sizeDecimalsWs: Math.max(...(() => { const d = JSON.parse(near.text); return d.ask.concat(d.bid).map((l) => (l.amount.split(',')[1] ?? '').length); })()),
      samePriceSizes: rb.filter(([p]) => wsBidSet.has(p)).slice(0, 3).map(([p, a]) => ({ price: p, rest: a, ws: wsBidSet.get(p) })),
      restSample: JSON.stringify(r.body).slice(0, 200),
      restAtMsAfterRun: restAt,
    });
  }
}

// Ten sockets from this host, one pair each, since a socket carries one pair.
// Every listed pair would be 91 sockets, which was not tried.
async function modeBatch() {
  const pairs = ['BTCIDR', 'ETHIDR', 'USDTIDR', 'SOLIDR', 'XRPIDR', 'DOGEIDR', 'PEPEIDR', 'BONKIDR', 'BNBIDR', 'HBARIDR'];
  const perSym = new Map();
  let frames = 0;
  let bytes = 0;
  const sockets = pairs.map((p) =>
    openSio(MARKET_HOST, {
      name: `batch-${p}`,
      subs: [`guest.tradedata-${p}@graph`],
      onEvent: (ev, payload, now, len) => {
        frames++;
        bytes += len;
        if (!ev.endsWith('@depth')) return;
        const sym = ev.slice('tradedata-'.length, -'@depth'.length);
        const r = perSym.get(sym) ?? { n: 0, first: now, levels: 0, empty: 0, same: 0, prev: '' };
        const text = JSON.stringify(payload);
        if (text === r.prev) r.same++;
        r.prev = text;
        r.n++;
        r.levels = Math.max(r.levels, (payload.ask ?? []).length, (payload.bid ?? []).length);
        if ((payload.ask ?? []).length === 0 || (payload.bid ?? []).length === 0) r.empty++;
        perSym.set(sym, r);
      },
    }),
  );
  const t0 = Date.now();
  await sleep(25_000);
  for (const s of sockets) s.ws.close();
  await sleep(300);
  const spanS = (Date.now() - t0) / 1000;
  log('batch', {
    sockets: sockets.length,
    opened: sockets.filter((s) => s.joined).length,
    openMs: stats(sockets.map((s) => s.openMs ?? -1)),
    refused: sockets.filter((s) => s.error || (s.closed && s.closed.atMs < 20_000)).map((s) => ({ name: s.name, error: s.error, closed: s.closed })),
    symbolsWithDepth: perSym.size,
    silent: pairs.filter((p) => !perSym.has(p)),
    depthFramesPerSymbol: Object.fromEntries([...perSym.entries()].map(([k, r]) => [k, r.n])),
    identicalToPreviousPerSymbol: Object.fromEntries([...perSym.entries()].map(([k, r]) => [k, r.same])),
    maxLevelsPerSide: Object.fromEntries([...perSym.entries()].map(([k, r]) => [k, r.levels])),
    symbolsWithAnEmptySide: [...perSym.entries()].filter(([, r]) => r.empty > 0).map(([k, r]) => `${k}:${r.empty}/${r.n}`),
    eventsPerSecond: +(frames / spanS).toFixed(1),
    kbPerSecond: +(bytes / spanS / 1024).toFixed(1),
    parseUsPerEvent: +(sockets.reduce((a, s) => a + (s.parseUs ?? 0), 0) / Math.max(1, sockets.reduce((a, s) => a + s.events, 0))).toFixed(1),
  });
}

async function modeSilence() {
  const sockets = [
    openSio(MARKET_HOST, { name: 'joined-answers-pings', subs: ['guest.tradedata-BTCIDR@graph'] }),
    openSio(MARKET_HOST, { name: 'joined-ignores-pings', subs: ['guest.tradedata-BTCIDR@graph'], pong: false }),
    openSio(MARKET_HOST, { name: 'never-joins-namespace', join: false }),
  ];
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline && sockets.some((s) => !s.closed)) await sleep(250);
  for (const s of sockets) {
    if (!s.closed) s.ws.close();
  }
  await sleep(300);
  for (const s of sockets) log('silence', { name: s.name, handshake: s.handshake, joined: !!s.joined, pings: s.pings, lastPingAtMs: s.lastPingAt, events: s.events, closed: s.closed, other: s.other.slice(0, 3) });
}

async function modeDeflate() {
  for (const host of [MARKET_HOST, MAIN_HOST]) {
    const s = openSio(host, { name: `deflate-${host}`, deflate: true });
    await sleep(3_000);
    s.ws.close();
    log('deflate', { host, upgrade: s.upgrade, openMs: s.openMs, handshake: s.handshake, joined: s.joined });
  }
  // The main host, joined to the market room as the home page does, to list what it pushes.
  const seen = {};
  const s = openSio(MAIN_HOST, {
    name: 'main-events',
    subs: ['guest.tradedata-market'],
    onEvent: (ev, payload, now) => {
      const r = (seen[ev] ??= { n: 0, at: [], first: JSON.stringify(payload).slice(0, 200), pairs: Object.keys(payload ?? {}).length, withBidAsk: Object.values(payload ?? {}).filter((v) => Number(v?.bid) > 0 && Number(v?.ask) > 0).length });
      r.n++;
      r.at.push(now);
    },
  });
  await sleep(20_000);
  s.ws.close();
  for (const [ev, r] of Object.entries(seen)) log('main-host-event', { event: ev, frames: r.n, gapMs: stats(r.at.slice(1).map((t, i) => t - r.at[i])), pairs: r.pairs, withBidAsk: r.withBidAsk, first: r.first });
}

const mode = process.argv[2] ?? 'book';
const modes = { book: modeBook, batch: modeBatch, silence: modeSilence, deflate: modeDeflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
