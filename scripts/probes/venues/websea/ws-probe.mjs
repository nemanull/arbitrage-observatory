// Websea futures WebSocket probe: the undocumented depth socket the futures web app uses, its gear keyed deltas, level order and window, size unit, the symbol detail stream that carries mark, index and funding, the documented OpenAPI socket, keepalive, silence, errors, compression and a batch of every perpetual.
// The documented socket at wss://oapi.websea.com/ws/v1/futures/market has no book channel, so the book comes from wss://cws.websea.com, found in the web app bundle (BASI_API_AGREEMENT_SOCKET, paths /ws/realTime_depth and /ws/realTime).
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/websea/ws-probe.mjs [book|mark|oapi|errors|silence|batch|compress|deflate]
//   book      depth (type 1) at 50 gears on four perps, one socket each, for 45 s: first frame against a full book, gear semantics, cadence, order, crossed books, then a REST depth_merged compare.
//   mark      symbol detail (type 8) on every perp on one socket for 40 s: cadence per symbol and how often mark, index and funding changed.
//   oapi      the documented socket: tickers and trade on BTC and a quiet perp for 30 s.
//   errors    unknown symbol, wrong depth, level 20, 100 and 200, unknown type, bad JSON, a duplicate subscribe and several subscriptions on the depth socket, and unknown channel and symbol on the documented socket. About 35 s.
//   silence   five sockets that differ only in what the client sends or subscribes, for up to 110 s, or SILENCE_S seconds.
//   batch     twenty sockets with one depth subscription each, every twelfth perp by volume, opened two a second and held 30 s.
//   compress  the same depth stream with compress=1, decoded the way the web app does it, for 8 s.
//   deflate   offers permessage-deflate once on each host and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/websea/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const DEPTH_URL = 'wss://cws.websea.com/ws/realTime_depth?compress=0';
const MARKET_URL = 'wss://cws.websea.com/ws/realTime?compress=0';
const OAPI_URL = 'wss://oapi.websea.com/ws/v1/futures/market';
const OAPI = 'https://oapi.websea.com';
const CAPI = 'https://capi.websea.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: round(s[0]), median: round(q(0.5)), p90: round(q(0.9)), max: round(s[s.length - 1]) };
}

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

// Opens a socket and resolves once it is open, with the open time.
function open(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0 }));
    ws.once('error', reject);
    ws.once('unexpected-response', (req, res) => reject(new Error(`unexpected ${res.statusCode}`)));
  });
}

const depthSub = (symbol, depth, level = 50) => ({ symbol, depth, level, type: 1, version: 1 });
const frame = (subs, unSubs = []) => JSON.stringify({ subs, unSubs });

async function defaultDepth(symbol) {
  const j = await getJson(`${CAPI}/webApi/market/getSymbolDepth?symbol=${encodeURIComponent(symbol)}`);
  const rows = j.result ?? [];
  return { chosen: (rows.find((r) => r.isDefault === 1) ?? rows[rows.length - 1])?.depth, all: rows.map((r) => r.depth) };
}

// Applies one side of a type 1 frame the way the web app does: a map keyed by gear, "0" deletes the gear.
function applySide(map, entries) {
  for (const e of entries) {
    if (Number(e.number) === 0) map.delete(Number(e.gear));
    else map.set(Number(e.gear), [Number(e.price), Number(e.number), e]);
  }
}

function sideState(map, dir) {
  const gears = [...map.keys()].sort((a, b) => a - b);
  const contiguous = gears.every((g, i) => g === i + 1);
  const prices = gears.map((g) => map.get(g)[0]);
  const ordered = prices.every((p, i) => i === 0 || (dir > 0 ? p > prices[i - 1] : p < prices[i - 1]));
  return { n: gears.length, contiguous, ordered, best: prices[0] };
}

function isFull(entries) {
  const g = entries.map((e) => Number(e.gear)).sort((a, b) => a - b);
  return g.length > 0 && g.every((x, i) => x === i + 1);
}

async function book() {
  const symbols = ['BTC-USDT', 'ETH-USDT', 'PLTR-USDT', 'LAPTOP-USDT'];
  const catalog = await getJson(`${OAPI}/v1/futures/symbols`);
  const csize = new Map(catalog.result.map((r) => [r.symbol, Number(r.contract_size)]));
  const depths = {};
  for (const s of symbols) depths[s] = await defaultDepth(s);
  log('merge_depths', depths);
  const t0 = Date.now();
  const state = new Map(symbols.map((s) => [s, { asks: new Map(), bids: new Map(), frames: 0, arrivals: [], ageMs: [], entries: [], fullAsks: 0, fullBids: 0, firstFrame: null, badOrder: 0, gearHoles: 0, crossed: 0, noop: 0, unitOk: 0, unitBad: 0, lastTs: 0, tsBack: 0, maxGear: 0, subAt: 0, askFull: false, bidFull: false, bothFullAfterMs: null, holesAfterBothFull: 0, framesBeforeBothFull: 0, firstGears: [], unsortedInFrame: 0 }]));
  const acks = [];
  const onMessage = (raw) => {
    const text = raw.toString('utf8');
    const j = JSON.parse(text);
    if (j.type !== 1) {
      acks.push({ at: Date.now() - t0, j });
      capture('websea-depth-control.txt', text);
      return;
    }
    const d = j.data;
    const st = state.get(d.symbol);
    if (!st) return;
    const now = Date.now();
    st.frames++;
    st.arrivals.push(now);
    st.ageMs.push(now - d.ts);
    if (d.ts < st.lastTs) st.tsBack++;
    st.lastTs = d.ts;
    st.entries.push(d.asks.length + d.bids.length);
    if (st.frames <= 3 || st.frames % 50 === 0) capture(`websea-depth-${d.symbol}.txt`, `${now - t0} ${text}`);
    const span = (a) => (a.length === 0 ? '-' : `${a.length} gears ${Math.min(...a.map((e) => Number(e.gear)))} to ${Math.max(...a.map((e) => Number(e.gear)))}`);
    if (st.firstGears.length < 4) st.firstGears.push({ atMs: now - st.subAt, asks: span(d.asks), bids: span(d.bids) });
    if (isFull(d.asks)) st.askFull = true;
    if (isFull(d.bids)) st.bidFull = true;
    if (st.bothFullAfterMs === null) {
      st.framesBeforeBothFull++;
      if (st.askFull && st.bidFull) st.bothFullAfterMs = now - st.subAt;
    }
    if (st.frames === 1) st.firstFrame = { at: now - t0, asks: d.asks.length, bids: d.bids.length, fullAsks: isFull(d.asks), fullBids: isFull(d.bids), keys: Object.keys(d), entryKeys: Object.keys(d.asks[0] ?? d.bids[0] ?? {}) };
    else {
      if (d.asks.length > 0 && isFull(d.asks)) st.fullAsks++;
      if (d.bids.length > 0 && isFull(d.bids)) st.fullBids++;
    }
    const inGearOrder = (a) => a.every((e, i) => i === 0 || Number(e.gear) > Number(a[i - 1].gear));
    if (!inGearOrder(d.asks) || !inGearOrder(d.bids)) st.unsortedInFrame++;
    let changed = false;
    for (const [side, map] of [['asks', st.asks], ['bids', st.bids]]) {
      for (const e of d[side]) {
        const cur = map.get(Number(e.gear));
        if (!cur || cur[0] !== Number(e.price) || cur[1] !== Number(e.number)) changed = true;
        st.maxGear = Math.max(st.maxGear, Number(e.gear));
        const conv = Number(e.number) * csize.get(d.symbol);
        if (Math.abs(conv - Number(e.numberConvert)) <= 1e-9 * Math.max(1, conv)) st.unitOk++;
        else st.unitBad++;
      }
      applySide(map, d[side]);
    }
    if (!changed) st.noop++;
    const a = sideState(st.asks, 1);
    const b = sideState(st.bids, -1);
    if (!a.ordered || !b.ordered) st.badOrder++;
    if (!a.contiguous || !b.contiguous) {
      st.gearHoles++;
      if (st.bothFullAfterMs !== null) st.holesAfterBothFull++;
    }
    if (a.best !== undefined && b.best !== undefined && b.best >= a.best) st.crossed++;
  };
  // One depth subscription per socket, since a later subscribe on the same socket replaces the earlier one.
  const sockets = [];
  const openMs = [];
  for (const s of symbols) {
    const o = await open(DEPTH_URL);
    openMs.push(o.openMs);
    o.ws.on('message', onMessage);
    state.get(s).subAt = Date.now();
    o.ws.send(frame([depthSub(s, depths[s].chosen, 50)]));
    sockets.push(o.ws);
  }
  await sleep(45_000);
  // Compare the maintained book with the REST merged depth at the same merge.
  const compare = {};
  for (const s of symbols) {
    const r = await getJson(`${OAPI}/v1/futures/depth_merged?symbol=${encodeURIComponent(s)}&depth=${depths[s].chosen}`);
    const st = state.get(s);
    let eq = 0;
    let n = 0;
    for (const [side, map] of [['asks', st.asks], ['bids', st.bids]]) {
      for (const lvl of (r.result?.[side] ?? []).slice(0, 10)) {
        n++;
        const cur = map.get(Number(lvl.gear));
        if (cur && cur[0] === Number(lvl.price) && cur[1] === Number(lvl.number)) eq++;
      }
    }
    compare[s] = { top10PerSideEqual: `${eq}/${n}`, restGears: [r.result?.bids?.length, r.result?.asks?.length], restTopBid: r.result?.bids?.[0], wsTopBid: st.bids.get(1)?.slice(0, 2) };
  }
  for (const ws of sockets) ws.close();
  log('depth_open', { openMs, acks: acks.slice(0, 4).map((a) => ({ at: a.at, msg: a.j.msg, code: a.j.code })) });
  for (const [s, st] of state) {
    const gaps = st.arrivals.slice(1).map((t, i) => t - st.arrivals[i]);
    log('depth_book', {
      s,
      depth: depths[s].chosen,
      frames: st.frames,
      firstFrame: st.firstFrame,
      laterFullSides: { asks: st.fullAsks, bids: st.fullBids },
      interArrivalMs: stats(gaps),
      entriesPerFrame: stats(st.entries),
      tsAgeAtArrivalMs: stats(st.ageMs),
      tsWentBack: st.tsBack,
      maxGear: st.maxGear,
      finalSides: { asks: st.asks.size, bids: st.bids.size, contiguous: sideState(st.asks, 1).contiguous && sideState(st.bids, -1).contiguous },
      framesWithEntriesOutOfGearOrder: st.unsortedInFrame,
      framesWithOrderBroken: st.badOrder,
      framesWithGearHoles: st.gearHoles,
      firstFrames: st.firstGears,
      bothSidesFullAfterMs: st.bothFullAfterMs,
      framesUntilBothSidesFull: st.framesBeforeBothFull,
      holesAfterBothSidesFull: st.holesAfterBothFull,
      framesCrossed: st.crossed,
      framesChangingNothing: st.noop,
      numberTimesContractSizeIsNumberConvert: `${st.unitOk}/${st.unitOk + st.unitBad}`,
    });
  }
  log('depth_vs_rest_merged', compare);
}

async function mark() {
  const catalog = await getJson(`${OAPI}/v1/futures/symbols`);
  const symbols = catalog.result.map((r) => r.symbol);
  const { ws, openMs } = await open(MARKET_URL);
  const t0 = Date.now();
  let acks = 0;
  let fails = [];
  let frames = 0;
  let bytes = 0;
  const per = new Map();
  const fields = ['markerPrice', 'indexPrice', 'capitalRate', 'newPrice'];
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    bytes += raw.length;
    const j = JSON.parse(text);
    if (j.type !== 8) {
      if (j.msg === 'Subscription succeeded') acks++;
      else fails.push(text.slice(0, 200));
      return;
    }
    frames++;
    const d = j.data;
    let st = per.get(d.symbol);
    if (!st) {
      st = { n: 0, arrivals: [], prev: {}, changes: Object.fromEntries(fields.map((f) => [f, 0])), zeroMark: 0 };
      per.set(d.symbol, st);
      if (per.size <= 2) capture('websea-type8.txt', text);
    }
    st.n++;
    st.arrivals.push(Date.now());
    if (!(Number(d.markerPrice) > 0)) st.zeroMark++;
    for (const f of fields) {
      if (st.prev[f] !== undefined && st.prev[f] !== d[f]) st.changes[f]++;
      st.prev[f] = d[f];
    }
  });
  ws.send(frame(symbols.map((symbol) => ({ symbol, type: 8 }))));
  await sleep(40_000);
  ws.close();
  const secs = (Date.now() - t0) / 1000;
  const counts = symbols.map((s) => per.get(s)?.n ?? 0);
  const gapsMax = symbols.map((s) => {
    const a = per.get(s)?.arrivals ?? [];
    return a.length > 1 ? Math.max(...a.slice(1).map((t, i) => t - a[i])) : Infinity;
  });
  const ch = (f) => stats(symbols.map((s) => per.get(s)?.changes[f] ?? 0));
  log('mark_stream', { openMs, subscribed: symbols.length, acks, fails: fails.slice(0, 3), symbolsWithFrames: per.size, framesPerSecond: round(frames / secs), kbPerSecond: round(bytes / secs / 1024), framesPerSymbol: stats(counts), longestGapPerSymbolMs: stats(gapsMax.filter(Number.isFinite)), symbolsWithOneOrNoFrame: counts.filter((c) => c <= 1).length });
  log('mark_changes_per_symbol_in_40s', { markerPrice: ch('markerPrice'), indexPrice: ch('indexPrice'), capitalRate: ch('capitalRate'), newPrice: ch('newPrice'), zeroMarkFrames: [...per.values()].reduce((a, s) => a + s.zeroMark, 0) });
  log('mark_btc', per.get('BTC-USDT') ? { n: per.get('BTC-USDT').n, changes: per.get('BTC-USDT').changes } : {});
}

async function oapi() {
  const { ws, openMs } = await open(OAPI_URL);
  const t0 = Date.now();
  const per = {};
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    const j = JSON.parse(text);
    const k = `${j.channel}:${j.symbol ?? 'ack'}`;
    per[k] ??= { n: 0, first: null, ages: [] };
    per[k].n++;
    if (!per[k].first) {
      per[k].first = text.slice(0, 400);
      capture('websea-oapi.txt', text);
    }
    if (j.ts) per[k].ages.push(Date.now() - (j.ts < 1e12 ? j.ts * 1000 : j.ts));
  });
  for (const s of ['BTC-USDT', 'LAPTOP-USDT']) {
    for (const channel of ['tickers', 'trade']) ws.send(JSON.stringify({ op: 'sub', channel, symbol: s }));
  }
  await sleep(30_000);
  ws.close();
  log('oapi_open', { openMs });
  for (const [k, v] of Object.entries(per)) log('oapi_channel', { k, n: v.n, tsAgeMs: stats(v.ages), first: v.first });
}

async function errors() {
  const d = await open(DEPTH_URL);
  const got = [];
  const t0 = Date.now();
  d.ws.on('message', (raw) => {
    const j = JSON.parse(raw.toString('utf8'));
    if (j.type === 1) {
      const k = `${j.data.symbol} a${j.data.asks.length} b${j.data.bids.length}`;
      got.push({ at: Date.now() - t0, k });
    } else got.push({ at: Date.now() - t0, text: raw.toString('utf8').slice(0, 220) });
  });
  d.ws.on('close', (c) => got.push({ at: Date.now() - t0, close: c }));
  const cases = [
    ['unknown symbol', frame([depthSub('NOPE-USDT', '0.1')])],
    ['depth not in list', frame([depthSub('ETH-USDT', '0.0001')])],
    ['no depth field', frame([{ symbol: 'PLTR-USDT', level: 50, type: 1, version: 1 }])],
    ['level 20', frame([depthSub('SOL-USDT', '0.01', 20)])],
    ['level 100', frame([depthSub('XRP-USDT', '0.0001', 100)])],
    ['unknown type', frame([{ symbol: 'BTC-USDT', type: 99 }])],
    ['duplicate', frame([depthSub('LAPTOP-USDT', '0.001')])],
    ['duplicate again', frame([depthSub('LAPTOP-USDT', '0.001')])],
  ];
  for (const [name, f] of cases) {
    got.push({ at: Date.now() - t0, sent: name });
    d.ws.send(f);
    await sleep(1500);
  }
  await sleep(2000);
  const summary = {};
  for (const g of got) if (g.k) summary[g.k.split(' ')[0]] = (summary[g.k.split(' ')[0]] ?? { frames: 0, firstSides: g.k }), summary[g.k.split(' ')[0]].frames++;
  log('depth_errors', { controlAndSends: got.filter((g) => !g.k), streams: summary });
  // Bad JSON last, since it may close the socket.
  const before = got.length;
  d.ws.send('not json');
  await sleep(3000);
  log('depth_bad_json', { after: got.slice(before).filter((g) => !g.k).slice(0, 3), open: d.ws.readyState === 1 });
  d.ws.terminate();

  // Several depth subscriptions on one socket: one frame with three, then a frame with one more.
  const m = await open(DEPTH_URL);
  const tally = [{}, {}];
  let phase = 0;
  m.ws.on('message', (raw) => {
    const j = JSON.parse(raw.toString('utf8'));
    if (j.type === 1) tally[phase][j.data.symbol] = (tally[phase][j.data.symbol] ?? 0) + 1;
  });
  m.ws.send(frame([depthSub('BTC-USDT', '0.1'), depthSub('ETH-USDT', '0.01'), depthSub('SOL-USDT', '0.01')]));
  await sleep(3000);
  phase = 1;
  m.ws.send(frame([depthSub('PLTR-USDT', '0.01')]));
  await sleep(3000);
  log('depth_several_subscriptions', { oneFrameWithBtcEthSol: tally[0], thenPltrAlone: tally[1] });
  m.ws.terminate();

  // Level 200 on its own socket, and the depth socket's reply to an application ping.
  const e = await open(DEPTH_URL);
  const lv = [];
  e.ws.on('message', (raw) => {
    const j = JSON.parse(raw.toString('utf8'));
    if (j.type === 1) lv.push({ asks: j.data.asks.length, bids: j.data.bids.length, maxGear: Math.max(...j.data.asks.map((x) => Number(x.gear)), 0) });
    else lv.push({ text: raw.toString('utf8').slice(0, 200) });
  });
  e.ws.send(frame([depthSub('BTC-USDT', '0.1', 200)]));
  await sleep(2500);
  e.ws.send(String(Math.round(Date.now() / 1000)));
  await sleep(1500);
  log('depth_level_200_and_ping', { frames: lv.slice(0, 4) });
  e.ws.terminate();

  const o = await open(OAPI_URL);
  const og = [];
  o.ws.on('message', (raw) => og.push(raw.toString('utf8').slice(0, 200)));
  o.ws.on('close', (c) => og.push(`close ${c}`));
  for (const f of [
    { op: 'sub', channel: 'depth', symbol: 'BTC-USDT' },
    { op: 'sub', channel: 'tickers', symbol: 'NOPE-USDT' },
    { op: 'sub', channel: 'tickers', symbol: 'BTC-USDT' },
    { op: 'sub', channel: 'tickers', symbol: 'BTC-USDT' },
    { op: 'nope', channel: 'tickers', symbol: 'BTC-USDT' },
    { op: 'ping' },
  ]) {
    o.ws.send(JSON.stringify(f));
    await sleep(700);
  }
  const keep = og.filter((x) => !x.includes('"close"') || x.startsWith('close'));
  o.ws.send('not json');
  await sleep(2000);
  log('oapi_errors', { replies: keep.filter((x) => !/"last"/.test(x)).slice(0, 10), afterBadJson: og.slice(-2) });
  o.ws.terminate();
}

// SILENCE_S shortens the hold for a rerun.
const HOLD_MS = Number(process.env.SILENCE_S ?? 110) * 1000;

async function silence() {
  const specs = [
    { name: 'depth, nothing sent', url: DEPTH_URL },
    { name: 'depth, subscribed quiet book, nothing else', url: DEPTH_URL, sub: frame([depthSub('FLYBRAIN-USDT', '0.00001')]) },
    { name: 'depth, unsubscribed, unix seconds every 5 s like the web app', url: DEPTH_URL, keepalive: () => String(Math.round(Date.now() / 1000)), every: 5000 },
    { name: 'depth, unsubscribed, protocol ping every 10 s', url: DEPTH_URL, ping: 10_000 },
    { name: 'oapi, nothing sent', url: OAPI_URL },
  ];
  const results = await Promise.all(
    specs.map(async (sp) => {
      const t0 = Date.now();
      const { ws } = await open(sp.url);
      const r = { name: sp.name, frames: 0, serverPings: 0, replies: [], closedAtS: null, code: null };
      ws.on('message', (raw) => {
        r.frames++;
        const t = raw.toString('utf8');
        if (r.replies.length < 2 && !t.includes('"type":1')) r.replies.push(t.slice(0, 120));
      });
      ws.on('ping', () => r.serverPings++);
      let timer;
      if (sp.sub) ws.send(sp.sub);
      if (sp.keepalive) timer = setInterval(() => ws.readyState === 1 && ws.send(sp.keepalive()), sp.every);
      if (sp.ping) timer = setInterval(() => ws.readyState === 1 && ws.ping(), sp.ping);
      let pongs = 0;
      ws.on('pong', () => pongs++);
      let held = false;
      await new Promise((resolve) => {
        ws.on('close', (code) => {
          if (held) return;
          r.closedAtS = round((Date.now() - t0) / 1000);
          r.code = code;
          resolve();
        });
        setTimeout(resolve, HOLD_MS);
      });
      held = true;
      r.openAtEnd = r.closedAtS === null;
      clearInterval(timer);
      r.pongs = pongs;
      if (ws.readyState === 1) ws.terminate();
      return r;
    }),
  );
  for (const r of results) log('silence', r);
}

async function batch() {
  const catalog = await getJson(`${OAPI}/v1/futures/symbols`);
  const h24 = await getJson(`${OAPI}/v1/futures/24hr`);
  const vol = new Map(h24.result.map((r) => [r.symbol, Number(r.quote_vol)]));
  const ranked = catalog.result.map((r) => r.symbol).sort((a, b) => (vol.get(b) ?? 0) - (vol.get(a) ?? 0));
  // Every twelfth perp by 24 h volume, twenty sockets with one depth subscription each, opened two a second.
  const symbols = ranked.filter((_, i) => i % 12 === 0).slice(0, 20);
  const prec = await getJson(`${OAPI}/v1/futures/symbol_precision`);
  // The web app's default merge equals the price precision, for example 0.1 for BTC and 0.001 for LAPTOP.
  const depthOf = (s) => {
    const p = Number(prec.result[s]?.price ?? 2);
    return p <= 0 ? '1' : (1 / 10 ** p).toFixed(p);
  };
  const t0 = Date.now();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let acks = 0;
  const fails = [];
  const seen = new Map();
  const perSecond = new Map();
  const openMs = [];
  const closes = [];
  const sockets = [];
  const onMessage = (raw) => {
    bytes += raw.length;
    const a = process.hrtime.bigint();
    const j = JSON.parse(raw.toString('utf8'));
    parseNs += process.hrtime.bigint() - a;
    if (j.type !== 1) {
      if (j.msg === 'Subscription succeeded') acks++;
      else fails.push(raw.toString('utf8').slice(0, 200));
      return;
    }
    frames++;
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const s = seen.get(j.data.symbol) ?? { n: 0, first: null };
    if (!s.first) s.first = { full: isFull(j.data.asks) || isFull(j.data.bids) };
    s.n++;
    seen.set(j.data.symbol, s);
  };
  for (const s of symbols) {
    try {
      const o = await open(DEPTH_URL);
      openMs.push(o.openMs);
      o.ws.on('message', onMessage);
      o.ws.on('close', (c) => closes.push(c));
      o.ws.send(frame([depthSub(s, depthOf(s), 50)]));
      sockets.push(o.ws);
    } catch (e) {
      fails.push(`${s}: ${e.message}`);
    }
    await sleep(500);
  }
  const tHold = Date.now();
  for (const v of seen.values()) v.n = 0;
  frames = 0;
  bytes = 0;
  parseNs = 0n;
  perSecond.clear();
  await sleep(30_000);
  for (const ws of sockets) ws.close();
  const secs = (Date.now() - tHold) / 1000;
  log('batch', {
    sockets: sockets.length,
    openMs: stats(openMs),
    acks,
    fails: fails.slice(0, 3),
    closesDuringHold: closes.length,
    symbolsWithFrames: seen.size,
    firstFrameFull: [...seen.values()].filter((s) => s.first.full).length,
    framesPerSecondOver30s: round(frames / secs),
    framesPerSymbol: stats(symbols.map((s) => seen.get(s)?.n ?? 0)),
    kbPerSecond: round(bytes / secs / 1024),
    bytesPerFrame: round(bytes / Math.max(1, frames)),
    parseUsPerFrame: round(Number(parseNs) / 1000 / Math.max(1, frames)),
    silentSymbols: symbols.filter((s) => !seen.has(s)),
  });
}

async function compress() {
  const { ws, openMs } = await open(DEPTH_URL.replace('compress=0', 'compress=1'));
  const kinds = {};
  let first = null;
  let rawBytes = 0;
  let textBytes = 0;
  ws.on('message', (raw, isBinary) => {
    rawBytes += raw.length;
    let kind = isBinary ? 'binary' : 'text';
    let text;
    try {
      text = raw.toString('utf8');
      JSON.parse(text);
      kind += ' json';
    } catch {
      // The web app maps each character of the text frame to one byte and inflates it with pako, which reads gzip.
      text = zlib.gunzipSync(Buffer.from(raw.toString('utf8'), 'latin1')).toString('utf8');
      kind += ' gzip bytes carried as characters';
    }
    textBytes += Buffer.byteLength(text);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    first ??= { hexHead: raw.subarray(0, 8).toString('hex'), decoded: text.slice(0, 160) };
  });
  ws.send(frame([depthSub('BTC-USDT', '0.1', 50)]));
  await sleep(8000);
  ws.close();
  log('compress', { openMs, kinds, first, wireBytes: rawBytes, decodedBytes: textBytes });
}

async function deflate() {
  for (const url of [DEPTH_URL, OAPI_URL]) {
    await new Promise((resolve) => {
      const ws = new WebSocket(url, { perMessageDeflate: true });
      ws.on('upgrade', (res) => log('deflate', { url, status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server ?? null }));
      ws.on('open', () => {
        ws.close();
        resolve();
      });
      ws.on('error', (e) => {
        log('deflate_error', { url, error: e.message });
        resolve();
      });
    });
  }
}

const modes = { book, mark, oapi, errors, silence, batch, compress, deflate };
const mode = process.argv[2] ?? 'book';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
await modes[mode]();
setTimeout(() => process.exit(0), 500);
