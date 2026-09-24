// Icrypex WebSocket probe: the orderbook channel on perpetual and spot pairs, the change set chain, level order and window, row types, size against REST, keepalive, silence, errors, and every perpetual on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/icrypex/ws-probe.mjs [book|batch|silence|deflate]
//   book     orderbook on five perpetuals and spot BTCUSDT for 70 s with a REST book compare, plus ticker, trade, tickers, orderbook-short, error and path checks. About 90 s.
//   batch    orderbook on every perpetual on one connection for 60 s.
//   silence  five sockets that differ in what they subscribe and whether they send protocol pings, for up to 115 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/icrypex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://istream.icrypex.com';
const API = 'https://api.icrypex.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (c, s = true) => `subscribe|${JSON.stringify({ c, s })}`;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function parse(raw) {
  const s = raw.toString();
  const i = s.indexOf('|');
  if (i < 0) return { type: null, data: null, s };
  let data = null;
  try { data = JSON.parse(s.slice(i + 1)); } catch { /* keep null */ }
  return { type: s.slice(0, i), data, s };
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  ws.t0 = t0;
  return new Promise((resolve, reject) => {
    ws.once('open', () => { ws.openMs = Date.now() - t0; resolve(ws); });
    ws.once('error', reject);
    ws.once('unexpected-response', (req, res) => reject(new Error('HTTP ' + res.statusCode)));
  });
}

// One tracked order book per pair, fed by orderbook snapshots and obd differences.
function newTracker(ps) {
  return {
    ps, snapshots: 0, snapLevels: [], snapOrderOk: 0, snapOrderBad: 0, firstSnapMs: null,
    obd: 0, emptyObd: 0, gaps: 0, gapLog: [], repeats: 0, lastCs: null, beforeSnap: 0,
    rows: { 1: 0, 2: 0, 3: 0, other: 0 }, typeMismatch: { insertExisting: 0, updateMissing: 0, removeMissing: 0 },
    qtyZeroNotRemove: 0, removeQty: { zero: 0, last: 0, other: 0 }, deltaAskUnordered: 0, deltaBidUnordered: 0,
    maxAsk: 0, maxBid: 0, lastFrameAt: null, maxIdleMs: 0, minObdIntervalMs: Infinity, lastObdAt: null,
    asks: new Map(), bids: new Map(),
  };
}

function applySnapshot(tr, d, now, subAt) {
  tr.snapshots++;
  if (tr.firstSnapMs === null) tr.firstSnapMs = now - subAt;
  tr.asks = new Map(d.a.map((r) => [r.p, r.q]));
  tr.bids = new Map(d.b.map((r) => [r.p, r.q]));
  tr.snapLevels.push([d.b.length, d.a.length]);
  const askAsc = d.a.every((r, i) => i === 0 || Number(r.p) > Number(d.a[i - 1].p));
  const bidDesc = d.b.every((r, i) => i === 0 || Number(r.p) < Number(d.b[i - 1].p));
  if (askAsc && bidDesc) tr.snapOrderOk++; else tr.snapOrderBad++;
  tr.lastCs = d.cs;
  tr.maxAsk = Math.max(tr.maxAsk, tr.asks.size);
  tr.maxBid = Math.max(tr.maxBid, tr.bids.size);
}

function applyObd(tr, d, now) {
  tr.obd++;
  if (tr.lastObdAt !== null) tr.minObdIntervalMs = Math.min(tr.minObdIntervalMs, now - tr.lastObdAt);
  tr.lastObdAt = now;
  if (tr.lastCs === null) { tr.beforeSnap++; return; }
  if (d.cs === tr.lastCs) tr.repeats++;
  else if (d.cs !== tr.lastCs + 1) { tr.gaps++; tr.gapLog.push({ expected: tr.lastCs + 1, got: d.cs }); }
  tr.lastCs = d.cs;
  if (d.a.length === 0 && d.b.length === 0) tr.emptyObd++;
  if (d.a.length > 1 && !d.a.every((r, i) => i === 0 || Number(r.p) > Number(d.a[i - 1].p))) tr.deltaAskUnordered++;
  if (d.b.length > 1 && !d.b.every((r, i) => i === 0 || Number(r.p) < Number(d.b[i - 1].p))) tr.deltaBidUnordered++;
  for (const [side, rows] of [[tr.asks, d.a], [tr.bids, d.b]]) {
    for (const r of rows) {
      const has = side.has(r.p);
      if (r.t === 1) { tr.rows[1]++; if (has) tr.typeMismatch.insertExisting++; side.set(r.p, r.q); }
      else if (r.t === 2) { tr.rows[2]++; if (!has) tr.typeMismatch.updateMissing++; side.set(r.p, r.q); }
      else if (r.t === 3) {
        tr.rows[3]++;
        if (!has) { tr.typeMismatch.removeMissing++; tr.gapLog.push({ removeMissingAtCs: d.cs, p: r.p }); }
        else if (r.q === '0') tr.removeQty.zero++;
        else if (r.q === side.get(r.p)) tr.removeQty.last++;
        else tr.removeQty.other++;
        side.delete(r.p);
      }
      else tr.rows.other++;
      if (r.t !== 3 && Number(r.q) === 0) tr.qtyZeroNotRemove++;
    }
  }
  tr.maxAsk = Math.max(tr.maxAsk, tr.asks.size);
  tr.maxBid = Math.max(tr.maxBid, tr.bids.size);
}

function onBookFrame(trackers, msg, now, subAt) {
  const d = msg.data;
  const tr = trackers.get(d.ps);
  if (!tr) return false;
  if (tr.lastFrameAt !== null) tr.maxIdleMs = Math.max(tr.maxIdleMs, now - tr.lastFrameAt);
  tr.lastFrameAt = now;
  if (msg.type === 'orderbook') applySnapshot(tr, d, now, subAt);
  else applyObd(tr, d, now);
  return true;
}

function summary(tr, endAt) {
  const tail = tr.lastFrameAt === null ? null : endAt - tr.lastFrameAt;
  const { asks, bids, lastFrameAt, lastObdAt, ...rest } = tr;
  return { ...rest, minObdIntervalMs: Number.isFinite(tr.minObdIntervalMs) ? tr.minObdIntervalMs : null, maxIdleMs: Math.max(tr.maxIdleMs, tail ?? 0), levelsAtEnd: [bids.size, asks.size] };
}

async function restCompare(tr) {
  const res = await fetch(`${API}/v1/orderbook?symbol=${encodeURIComponent(tr.ps)}`);
  const b = await res.json();
  const top = (m, desc) => [...m.entries()].sort((x, y) => (desc ? Number(y[0]) - Number(x[0]) : Number(x[0]) - Number(y[0]))).slice(0, 20);
  const lb = top(tr.bids, true);
  const la = top(tr.asks, false);
  const eq = (loc, rest) => loc.filter(([p, q], i) => rest[i] && rest[i].p === p && rest[i].q === q).length;
  const priceEq = (loc, rest) => loc.filter(([p], i) => rest[i] && rest[i].p === p).length;
  return { ps: tr.ps, restLevels: [b.bids.length, b.asks.length], top20BidsExact: eq(lb, b.bids), top20AsksExact: eq(la, b.asks), top20BidPrices: priceEq(lb, b.bids), top20AskPrices: priceEq(la, b.asks), wsTouch: [lb[0], la[0]], restTouch: [b.bids[0], b.asks[0]] };
}

async function book() {
  const pairs = ['btcusdt/p', 'ethusdt/p', 'xrpusdt/p', 'ldousdt/p', 'nvdxusdt/p', 'btcusdt'];
  const trackers = new Map(pairs.map((p) => [p.toUpperCase(), newTracker(p.toUpperCase())]));
  const ws = await open(WS_URL);
  log('open', { url: WS_URL, openMs: ws.openMs });
  const counts = {};
  const firsts = {};
  const acks = [];
  const tickerTimes = [];
  const allTickerTimes = [];
  let serverPings = 0;
  let subAt = Date.now();
  ws.on('ping', () => serverPings++);
  ws.on('close', (c, r) => log('close', { socket: 'A', code: c, reason: r.toString(), atMs: Date.now() - ws.t0 }));
  ws.on('message', (raw) => {
    const now = Date.now();
    const msg = parse(raw);
    counts[msg.type] = (counts[msg.type] || 0) + 1;
    capture('book-A.txt', `${now} ${msg.s}`);
    if (!firsts[msg.type]) firsts[msg.type] = msg.s.slice(0, 400);
    if (msg.type === 'subscribe-response') acks.push({ ...msg.data, ms: now - subAt });
    else if (msg.type === 'orderbook' || msg.type === 'obd') onBookFrame(trackers, msg, now, subAt);
    else if (msg.type === 'ticker') tickerTimes.push(now);
    else if (msg.type === 'tickers') allTickerTimes.push({ now, rows: msg.data.t.length, perpRows: msg.data.t.filter((t) => t.ps.endsWith('/P')).length });
    else if (msg.type !== 'trade' && msg.type !== 'trades') log('other_frame', { type: msg.type, s: msg.s.slice(0, 300) });
  });
  subAt = Date.now();
  for (const p of pairs) ws.send(sub('orderbook@' + p));
  ws.send(sub('ticker@btcusdt/p'));
  ws.send(sub('trade@btcusdt/p'));
  ws.send(sub('tickers'));
  ws.send(sub('orderbook@nopeusdt/p'));
  await sleep(5000);
  ws.send(sub('orderbook@btcusdt/p'));
  log('sent', { what: 'duplicate subscribe orderbook@btcusdt/p', atMs: Date.now() - subAt });

  // A second socket for orderbook-short and an upper case channel name, since the docs warn against mixing orderbook and orderbook-short on one socket.
  const wsB = await open(WS_URL);
  const bFrames = [];
  wsB.on('message', (raw) => { const m = parse(raw); bFrames.push({ ms: Date.now() - wsB.t0, type: m.type, ps: m.data?.ps ?? m.data?.c, levels: m.data?.a ? [m.data.b.length, m.data.a.length] : undefined }); capture('book-B.txt', m.s); });
  wsB.send(sub('orderbook-short@ethusdt/p'));
  wsB.send(sub('orderbook@BTCUSDT/P'));
  wsB.send(sub('orderbook@btcusdt%2fp'));
  wsB.send('hello');
  wsB.send('subscribe|notjson');
  wsB.send(sub(''));
  await sleep(15000);
  const bCount = bFrames.reduce((m, f) => ((m[`${f.type} ${f.ps}`] = (m[`${f.type} ${f.ps}`] || 0) + 1), m), {});
  log('socket_B', { counts: bCount, first: bFrames.slice(0, 8), readyState: wsB.readyState });
  wsB.terminate();

  await sleep(20000);
  ws.send('channel-data-request|' + JSON.stringify({ c: 'orderbook@ethusdt/p' }));
  log('sent', { what: 'channel-data-request orderbook@ethusdt/p', atMs: Date.now() - subAt });
  await sleep(30000);
  const endAt = Date.now();
  log('socket_A_counts', { counts, serverPings, seconds: Math.round((endAt - subAt) / 1000) });
  log('acks', { acks });
  for (const tr of trackers.values()) log('book', summary(tr, endAt));
  for (const tr of trackers.values()) { log('rest_compare', await restCompare(tr)); await sleep(300); }
  const gaps = (ts) => ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const tg = gaps(tickerTimes);
  const ag = gaps(allTickerTimes.map((x) => x.now));
  log('ticker_cadence', { tickerFrames: tickerTimes.length, tickerGapMedian: tg[Math.floor(tg.length / 2)], tickersFrames: allTickerTimes.length, tickersGapMin: ag[0], tickersGapMedian: ag[Math.floor(ag.length / 2)], tickersGapMax: ag.at(-1), tickersRows: allTickerTimes[0]?.rows, tickersPerpRows: allTickerTimes[0]?.perpRows });
  for (const [k, v] of Object.entries(firsts)) log('first_frame', { type: k, s: v });
  ws.terminate();

  for (const path of ['/7', '/1']) {
    try {
      const w = await open(WS_URL + path);
      const seen = [];
      w.on('message', (raw) => { const m = parse(raw); seen.push({ type: m.type, ps: m.data?.ps, cs: m.data?.cs, bid: m.data?.b?.[0], ask: m.data?.a?.[0], levels: m.data?.a ? [m.data.b.length, m.data.a.length] : undefined }); });
      w.send(sub('orderbook@btcusdt/p'));
      w.send(sub('orderbook@btcusdt'));
      await sleep(6000);
      log('path', { url: WS_URL + path, openMs: w.openMs, frames: seen.length, first: seen.filter((s) => s.type === 'orderbook').slice(0, 2), types: [...new Set(seen.map((s) => s.type))] });
      w.terminate();
    } catch (e) {
      log('path', { url: WS_URL + path, error: e.message });
    }
  }
}

async function batch() {
  const info = await (await fetch(API + '/v1/exchange/info')).json();
  const perps = info.pairs.filter((p) => p.marketTypes.includes('PERPETUAL')).map((p) => p.symbol);
  const trackers = new Map(perps.map((s) => [s, newTracker(s)]));
  const ws = await open(WS_URL);
  let frames = 0;
  let acks = 0;
  let subAt = Date.now();
  ws.on('message', (raw) => {
    const now = Date.now();
    const msg = parse(raw);
    frames++;
    if (msg.type === 'subscribe-response') acks++;
    else if (msg.type === 'orderbook' || msg.type === 'obd') onBookFrame(trackers, msg, now, subAt);
  });
  ws.on('close', (c, r) => log('close', { code: c, reason: r.toString() }));
  subAt = Date.now();
  for (const s of perps) ws.send(sub('orderbook@' + s.toLowerCase()));
  await sleep(60000);
  const endAt = Date.now();
  const all = [...trackers.values()].map((t) => summary(t, endAt));
  const snapMs = all.map((t) => t.firstSnapMs).filter((x) => x !== null).sort((a, b) => a - b);
  const sum = (f) => all.reduce((a, t) => a + f(t), 0);
  log('batch', {
    perps: perps.length, openMs: ws.openMs, acks, frames, framesPerSecond: Math.round(frames / 60),
    withSnapshot: all.filter((t) => t.snapshots > 0).length, snapshotsTotal: sum((t) => t.snapshots),
    firstSnapMsMin: snapMs[0], firstSnapMsMax: snapMs.at(-1), obd: sum((t) => t.obd), emptyObd: sum((t) => t.emptyObd),
    gaps: sum((t) => t.gaps), repeats: sum((t) => t.repeats), beforeSnap: sum((t) => t.beforeSnap),
    typeMismatch: all.reduce((m, t) => { for (const k in t.typeMismatch) m[k] = (m[k] || 0) + t.typeMismatch[k]; return m; }, {}),
    removeQty: all.reduce((m, t) => { for (const k in t.removeQty) m[k] = (m[k] || 0) + t.removeQty[k]; return m; }, {}),
    snapOrderBad: sum((t) => t.snapOrderBad), deltaUnordered: sum((t) => t.deltaAskUnordered + t.deltaBidUnordered),
    maxLevelsSeen: Math.max(...all.map((t) => Math.max(t.maxAsk, t.maxBid))),
    snapLevelsMax: Math.max(...all.flatMap((t) => t.snapLevels.flat())),
    under20PerSideAtEnd: all.filter((t) => Math.min(...t.levelsAtEnd) < 20).map((t) => `${t.ps}:${t.levelsAtEnd.join('/')}`),
    minObdIntervalMs: Math.min(...all.map((t) => t.minObdIntervalMs ?? Infinity)),
  });
  const idle = all.map((t) => ({ ps: t.ps, obd: t.obd, maxIdleMs: t.maxIdleMs })).sort((a, b) => b.maxIdleMs - a.maxIdleMs);
  log('batch_gaps', { detail: all.filter((t) => t.gapLog.length).map((t) => ({ ps: t.ps, obd: t.obd, gapLog: t.gapLog })) });
  log('batch_idle', { quietest: idle.slice(0, 6), busiest: [...idle].sort((a, b) => b.obd - a.obd).slice(0, 4), obdMedian: [...idle].sort((a, b) => a.obd - b.obd)[Math.floor(idle.length / 2)].obd });
  ws.terminate();
}

async function silence() {
  const specs = [
    { name: 'S1 no subscribe, sends nothing', subs: [] },
    { name: 'S2 tickers, sends nothing', subs: ['tickers'] },
    { name: 'S3 quiet book, sends nothing', subs: ['orderbook@ldousdt/p'] },
    { name: 'S4 quiet book, protocol ping every 20 s', subs: ['orderbook@ldousdt/p'], ping: 20000 },
    { name: 'S5 no subscribe, protocol ping every 20 s', subs: [], ping: 20000 },
  ];
  const results = [];
  await Promise.all(specs.map(async (sp) => {
    const ws = await open(WS_URL);
    const r = { name: sp.name, openMs: ws.openMs, frames: 0, serverPings: 0, pongs: [], maxGapMs: 0, closed: null };
    let last = Date.now();
    let pingAt = 0;
    ws.on('message', () => { const n = Date.now(); r.maxGapMs = Math.max(r.maxGapMs, n - last); last = n; r.frames++; });
    ws.on('ping', () => r.serverPings++);
    ws.on('pong', () => r.pongs.push(Date.now() - pingAt));
    ws.on('close', (c, reason) => { r.closed = { code: c, reason: reason.toString(), atMs: Date.now() - ws.t0 }; });
    for (const c of sp.subs) ws.send(sub(c));
    let timer = null;
    if (sp.ping) timer = setInterval(() => { pingAt = Date.now(); ws.ping(); }, sp.ping);
    const end = Date.now() + 115000;
    while (Date.now() < end && r.closed === null) await sleep(500);
    if (timer) clearInterval(timer);
    r.maxGapMs = Math.max(r.maxGapMs, Date.now() - last);
    ws.terminate();
    results.push(r);
  }));
  for (const r of results) log('silence', r);
}

async function deflate() {
  const ws = new WebSocket(WS_URL, { perMessageDeflate: true });
  await new Promise((resolve) => {
    ws.on('upgrade', (res) => log('deflate_upgrade', { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null }));
    ws.on('open', resolve);
    ws.on('error', (e) => { log('deflate_error', { error: e.message }); resolve(); });
  });
  ws.send(sub('orderbook@btcusdt/p'));
  let first = null;
  ws.on('message', (raw) => { if (!first) first = raw.toString().slice(0, 80); });
  await sleep(3000);
  log('deflate', { negotiated: ws.extensions || null, firstFrame: first });
  ws.terminate();
}

const mode = process.argv[2] || 'book';
if (mode === 'book') await book();
else if (mode === 'batch') await batch();
else if (mode === 'silence') await silence();
else if (mode === 'deflate') await deflate();
else console.log('unknown mode', mode);
