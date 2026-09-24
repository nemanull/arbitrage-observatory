// CoinZoom spot WebSocket probe: order book channel shape, id semantics, level window, top of book against the ticker and the REST book, errors, silence and a batch of pairs on one socket.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// The venue asks clients not to open and close sockets repeatedly and caps the streaming API at 30 requests per minute, so every mode paces subscribe frames 2.5 s apart and opens one or two sockets.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coinzoom/ws-probe.mjs [book|errors|silence|batch|channels|deflate|analyze]
//   book     OrderBookRequest on eleven pairs with flag variants and a one-sided book, the ticker, a burst and a duplicate, then a REST book compare. About 70 s.
//   errors   unknown symbol, other spellings, unknown request, bad action, missing symbol, text that is not JSON. About 25 s.
//   silence  two sockets with no subscription, one answering server pings and one not, for 75 s.
//   batch    every pair with 24 h volume, subscribed 2.5 s apart on one socket, then 20 s of traffic. About 95 s.
//   channels ticker, trades and one minute candles on BTC/USD, and an aggregated book with a depth, for 15 s after the last frame. About 25 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates, with the upgrade headers.
//   analyze  opens no socket: replays $PROBE_OUT_DIR/book.txt from an earlier book run and counts id reuse, re-placed orders, unchanged top 20 levels, one-sided deltas and snapshot order.
// Set PROBE_OUT_DIR to keep raw frames, trimmed to 16 KB each. Recorded in docs/profiles/coinzoom/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api.coinzoom.com/api/v1/public/market/data/stream';
const REST = 'https://api.coinzoom.com/api/v1/public';
const UA = 'Mozilla/5.0 arbitrage-observatory-probe'; // the API rejects a request without a User-Agent
const GAP_MS = 2_500;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 16384) + '\n');
}

function open(name, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, headers: { 'User-Agent': UA }, ...opts });
  const s = { ws, t0, name, pings: [], closed: null, opened: null, ext: null };
  ws.on('upgrade', (res) => { s.ext = res.headers['sec-websocket-extensions'] ?? null; s.status = res.statusCode; s.ray = res.headers['cf-ray']; s.server = res.headers.server; s.location = res.headers['sec-websocket-location']; s.cfCookie = (res.headers['set-cookie'] ?? []).some((c) => c.startsWith('__cf_bm=')); });
  ws.on('unexpected-response', (_req, res) => { s.closed = { status: res.statusCode, ms: Date.now() - t0 }; log('refused', { name, status: res.statusCode, headers: res.headers }); });
  ws.on('open', () => { s.opened = Date.now() - t0; });
  ws.on('ping', () => s.pings.push(Date.now() - t0));
  ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString(), ms: Date.now() - t0 }; });
  ws.on('error', (e) => log('error', { name, message: e.message }));
  s.ready = new Promise((resolve) => { ws.once('open', resolve); ws.once('close', resolve); });
  return s;
}

// One book per stream: orders by id per side, and levels summed by price.
function newBook() {
  return { bids: new Map(), asks: new Map(), snapshots: 0, deltas: 0, orphanDeletes: 0, bothSides: 0, crossed: 0, oneSided: 0, maxBidOrders: 0, maxAskOrders: 0, maxBidLevels: 0, maxAskLevels: 0, times: [], snapBidOrder: null, snapAskOrder: null, deltaAddsOutOfOrder: 0, sameAsPrev: 0, prevTop: null };
}

function levels(side) {
  const m = new Map();
  for (const [, [p, q]] of side) m.set(p, (m.get(p) ?? 0) + q);
  return m;
}

function top(book) {
  let bid = -Infinity, ask = Infinity;
  for (const [, [p]] of book.bids) if (p > bid) bid = p;
  for (const [, [p]] of book.asks) if (p < ask) ask = p;
  return { bid, ask };
}

const isSorted = (arr, desc) => arr.every((x, i) => i === 0 || (desc ? arr[i - 1][1] >= x[1] : arr[i - 1][1] <= x[1]));

function apply(book, msg, now) {
  book.times.push(now);
  if ('ob' in msg) {
    book.snapshots++;
    book.bids = new Map(msg.b.map((e) => [e[0], [e[1], e[2]]]));
    book.asks = new Map(msg.s.map((e) => [e[0], [e[1], e[2]]]));
    book.snapBidOrder = isSorted(msg.b, true);
    book.snapAskOrder = isSorted(msg.s, false);
  } else {
    book.deltas++;
    for (const [key, side] of [['b', book.bids], ['s', book.asks]]) {
      const adds = [];
      for (const e of msg[key] ?? []) {
        if (e.length === 1) {
          if (!side.delete(e[0])) book.orphanDeletes++;
        } else {
          side.set(e[0], [e[1], e[2]]);
          adds.push(e);
        }
      }
      if (!isSorted(adds, key === 'b')) book.deltaAddsOutOfOrder++;
    }
    for (const id of book.bids.keys()) if (book.asks.has(id)) book.bothSides++;
  }
  const t = top(book);
  if (t.bid >= t.ask) book.crossed++;
  if (book.bids.size === 0 || book.asks.size === 0) book.oneSided++;
  const key = `${t.bid}|${t.ask}`;
  if (book.prevTop === key) book.sameAsPrev++;
  book.prevTop = key;
  book.maxBidOrders = Math.max(book.maxBidOrders, book.bids.size);
  book.maxAskOrders = Math.max(book.maxAskOrders, book.asks.size);
  book.maxBidLevels = Math.max(book.maxBidLevels, levels(book.bids).size);
  book.maxAskLevels = Math.max(book.maxAskLevels, levels(book.asks).size);
}

function gaps(times) {
  if (times.length < 2) return { maxGapMs: null, medianGapMs: null };
  const g = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  return { maxGapMs: g[g.length - 1], medianGapMs: g[Math.floor(g.length / 2)] };
}

function summarize(sym, b) {
  const { bids, asks, times, prevTop, ...rest } = b;
  return { sym, ...rest, ...gaps(times), bidOrders: bids.size, askOrders: asks.size, bidLevels: levels(bids).size, askLevels: levels(asks).size, top: top(b) };
}

async function getJson(path) {
  const t0 = Date.now();
  const res = await fetch(REST + path, { headers: { 'User-Agent': UA } });
  const body = await res.json();
  return { status: res.status, ms: Date.now() - t0, arrived: Date.now(), body };
}

// Compare the top n aggregated levels of the socket book with a REST level 2 book read at nearly the same instant.
function compareRest(book, rest, n) {
  const wsBids = [...levels(book.bids)].sort((a, b) => b[0] - a[0]).slice(0, n);
  const wsAsks = [...levels(book.asks)].sort((a, b) => a[0] - b[0]).slice(0, n);
  const eq = (a, b) => a.filter((x, i) => b[i] && x[0] === b[i][0] && Math.abs(x[1] - b[i][1]) < 1e-9).length;
  return { n, bidsEqual: eq(wsBids, rest.bids.slice(0, n)), asksEqual: eq(wsAsks, rest.asks.slice(0, n)), wsTop: [wsBids[0], wsAsks[0]], restTop: [rest.bids[0], rest.asks[0]], restBids: rest.bids.length, restAsks: rest.asks.length, restTimestampAgeMs: Date.now() - rest.timestamp };
}

function streamOf(msg) {
  if ('ob' in msg) return msg.ob;
  if ('oi' in msg) return msg.oi;
  return null;
}

function attach(s, books, extra) {
  s.frames = 0; s.bytes = 0; s.parseUs = 0; s.control = [];
  s.ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString();
    const p0 = process.hrtime.bigint();
    let msg;
    try { msg = JSON.parse(text); } catch { s.control.push({ ms: now - s.t0, text: text.slice(0, 300) }); return; }
    s.parseUs += Number(process.hrtime.bigint() - p0) / 1000;
    s.frames++; s.bytes += raw.length;
    capture(`${s.name}.txt`, `${now} ${text}`);
    const sym = streamOf(msg);
    if (sym !== null) {
      if (!books.has(sym)) books.set(sym, newBook());
      apply(books.get(sym), msg, now);
      return;
    }
    if (extra && extra(msg, now)) return;
    s.control.push({ ms: now - s.t0, text: text.slice(0, 300) });
  });
}

const baseline = (sym, id = sym) => ({ OrderBookRequest: { requestId: id, action: 'subscribe', symbol: sym, aggregate: false, depth: 0 } });

async function sendPaced(s, frames) {
  for (const f of frames) {
    if (s.ws.readyState !== WebSocket.OPEN) break;
    const list = Array.isArray(f) ? f : [f];
    for (const x of list) s.ws.send(typeof x === 'string' ? x : JSON.stringify(x));
    log('sent', { at: Date.now() - s.t0, frames: list.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) });
    await sleep(GAP_MS);
  }
}

async function book() {
  const s = open('book');
  const books = new Map();
  const ms = [];
  attach(s, books, (msg, now) => {
    if (msg.ms) { ms.push({ now, bid: msg.ms[6], ask: msg.ms[7] }); return true; }
    return false;
  });
  await s.ready;
  log('open', { ms: s.opened, status: s.status, ray: s.ray, ext: s.ext, server: s.server, location: s.location, cfCookie: s.cfCookie });
  // Track whether the socket book of BTC/USD agrees with the ticker's best bid and ask at each ticker frame.
  let tickerMatch = 0, tickerMiss = 0; const misses = [];
  s.ws.on('message', () => {
    const last = ms[ms.length - 1];
    const b = books.get('BTC/USD');
    if (!last || !b || last.checked) return;
    last.checked = true;
    const t = top(b);
    if (t.bid === last.bid && t.ask === last.ask) tickerMatch++; else { tickerMiss++; if (misses.length < 5) misses.push({ book: t, ticker: [last.bid, last.ask] }); }
  });
  await sendPaced(s, [
    baseline('BTC/USD'),
    baseline('ETH/USD'),
    baseline('USDT/USD'),
    { MarketSummaryRequest: { action: 'subscribe', symbol: 'BTC/USD' } },
    baseline('LINK/USD'),
    { OrderBookRequest: { requestId: 'XRP/USD', action: 'subscribe', symbol: 'XRP/USD', aggregate: true, depth: 0 } },
    { OrderBookRequest: { requestId: 'SOL/USD', action: 'subscribe', symbol: 'SOL/USD', aggregate: false, depth: 10 } },
    { OrderBookRequest: { requestId: 'ADA/USD', action: 'subscribe', symbol: 'ADA/USD' } },
    baseline('BTC/USDT'),
    [baseline('BCH/USD'), baseline('LTC/USD')],
    baseline('USG/USD'),
    baseline('BTC/USD', 'BTC/USD#2'),
  ]);
  await sleep(20_000);
  const restPairs = [];
  for (const sym of ['BTC/USD', 'ETH/USD']) {
    const r = await getJson(`/marketwatch/orderbook/${sym.replace('/', '_')}/0/2`);
    if (books.has(sym)) restPairs.push({ sym, restStatus: r.status, restMs: r.ms, ...compareRest(books.get(sym), r.body, 20) });
    await sleep(1_500);
  }
  await sendPaced(s, [{ OrderBookRequest: { requestId: 'ETH/USD', action: 'unsubscribe', symbol: 'ETH/USD' } }]);
  const ethAtUnsub = books.get('ETH/USD')?.times.length ?? 0;
  await sleep(10_000);
  const ethAfter = (books.get('ETH/USD')?.times.length ?? 0) - ethAtUnsub;
  s.ws.close();
  await sleep(500);
  for (const [sym, b] of books) log('stream', summarize(sym, b));
  for (const r of restPairs) log('rest_compare', r);
  log('ticker_vs_book', { tickerFrames: ms.length, tickerMatch, tickerMiss, misses, tickerGaps: gaps(ms.map((x) => x.now)) });
  log('unsubscribe', { stream: 'ETH/USD', framesAfterUnsubscribe: ethAfter });
  log('control', { frames: s.control });
  log('session', { opened: s.opened, pings: s.pings, closed: s.closed, frames: s.frames, bytes: s.bytes, parseUsPerFrame: +(s.parseUs / Math.max(1, s.frames)).toFixed(1) });
}

async function errors() {
  const s = open('errors');
  const books = new Map();
  attach(s, books);
  await s.ready;
  log('open', { ms: s.opened, status: s.status });
  await sendPaced(s, [
    baseline('NOPE/USD'),
    baseline('BTC_USD'),
    baseline('btc/usd'),
    { FooRequest: { action: 'subscribe', symbol: 'BTC/USD' } },
    { OrderBookRequest: { requestId: 'bogus', action: 'bogus', symbol: 'BTC/USD', aggregate: false, depth: 0 } },
    { OrderBookRequest: { requestId: 'nosym', action: 'subscribe', aggregate: false, depth: 0 } },
    { OrderBookRequest: { action: 'subscribe', symbol: 'DOGE/USD', aggregate: false, depth: 0 } },
    'hello, not json',
  ]);
  await sleep(4_000);
  const closedBefore = s.closed;
  if (!s.closed) s.ws.close();
  await sleep(500);
  for (const [sym, b] of books) log('stream', { sym, snapshots: b.snapshots, deltas: b.deltas });
  log('control', { frames: s.control });
  log('session', { pings: s.pings, closedByServer: closedBefore, closed: s.closed });
}

async function silence() {
  const a = open('silent-pong');
  const b = open('silent-nopong', { autoPong: false });
  for (const s of [a, b]) attach(s, new Map());
  await Promise.all([a.ready, b.ready]);
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline && !(a.closed && b.closed)) await sleep(500);
  for (const s of [a, b]) {
    const closedByServer = s.closed;
    if (!s.closed) s.ws.close();
    log('silence', { name: s.name, opened: s.opened, pings: s.pings, closedByServer, frames: s.frames, control: s.control });
  }
  await sleep(500);
}

async function batch() {
  const t = await getJson('/marketwatch/ticker');
  const pairs = Object.entries(t.body).filter(([, v]) => v.base_volume > 0).sort((x, y) => y[1].quote_volume - x[1].quote_volume).map(([k]) => k.replace('_', '/'));
  log('batch_pairs', { tickerStatus: t.status, count: pairs.length, pairs });
  const s = open('batch');
  const books = new Map();
  attach(s, books);
  await s.ready;
  log('open', { ms: s.opened, status: s.status });
  const subStart = Date.now();
  await sendPaced(s, pairs.map((p) => baseline(p)));
  const subscribedAt = Date.now();
  const f0 = s.frames, b0 = s.bytes;
  await sleep(20_000);
  const secs = (Date.now() - subscribedAt) / 1000;
  s.ws.close();
  await sleep(500);
  const acks = s.control.filter((c) => c.text.includes('"subscribed"')).length;
  const rows = [...books].map(([sym, b]) => ({ sym, snapshots: b.snapshots, deltas: b.deltas, orphanDeletes: b.orphanDeletes, crossed: b.crossed, oneSided: b.oneSided, bidOrders: b.bids.size, askOrders: b.asks.size, maxBidOrders: b.maxBidOrders, maxAskOrders: b.maxAskOrders, maxGapMs: gaps(b.times).maxGapMs }));
  for (const r of rows) log('stream', r);
  const noSnapshot = pairs.filter((p) => !books.has(p) || books.get(p).snapshots === 0);
  log('batch', { pairs: pairs.length, acks, withSnapshot: pairs.length - noSnapshot.length, noSnapshot, subscribeSeconds: (subscribedAt - subStart) / 1000, framesPerSecondAfter: +((s.frames - f0) / secs).toFixed(1), bytesPerSecondAfter: Math.round((s.bytes - b0) / secs), bytesPerFrame: Math.round(s.bytes / Math.max(1, s.frames)), parseUsPerFrame: +(s.parseUs / Math.max(1, s.frames)).toFixed(1), pings: s.pings.length, closed: s.closed, otherControl: s.control.filter((c) => !c.text.includes('"subscribed"')).slice(0, 5) });
}

async function channels() {
  const s = open('channels');
  const books = new Map();
  const seen = { ms: [], ts: [], cu: [] };
  attach(s, books, (msg, now) => {
    for (const k of Object.keys(seen)) if (msg[k]) { seen[k].push({ now, msg }); return true; }
    return false;
  });
  await s.ready;
  log('open', { ms: s.opened, status: s.status });
  await sendPaced(s, [
    { MarketSummaryRequest: { action: 'subscribe', symbol: 'BTC/USD' } },
    { TradeSummaryRequest: { action: 'subscribe', symbol: 'BTC/USD' } },
    { CandleRequest: { action: 'subscribe', symbol: 'BTC/USD', interval: 'M1' } },
    { OrderBookRequest: { requestId: 'DOGE/USD', action: 'subscribe', symbol: 'DOGE/USD', aggregate: true, depth: 20 } },
  ]);
  await sleep(15_000);
  s.ws.close();
  await sleep(500);
  const ts = seen.ts.map((x) => x.msg.ts);
  const firstTs = seen.ts[0]?.now;
  log('ticker', { frames: seen.ms.length, ...gaps(seen.ms.map((x) => x.now)), first: seen.ms[0]?.msg, midIsMidOfBidAsk: seen.ms.filter((x) => Math.abs(x.msg.ms[4] - (x.msg.ms[6] + x.msg.ms[7]) / 2) < 0.01).length });
  log('trades', { frames: ts.length, withinOneSecondOfFirst: seen.ts.filter((x) => x.now - firstTs < 1_000).length, oldest: ts[0]?.[3], newest: ts[ts.length - 1]?.[3], sides: countBy(ts, (t) => t[4]), fields: ts[0]?.length, first: seen.ts[0]?.msg });
  log('candles', { frames: seen.cu.length, first: seen.cu[0]?.msg, rowsInFirst: seen.cu[0]?.msg.c?.length });
  log('books', { streams: [...books.keys()] });
  log('control', { frames: s.control });
}

const countBy = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

// Replays a book capture offline, so the counts need no second socket.
function analyze() {
  const file = join(OUT ?? '.', 'book.txt');
  const acked = new Set();
  const books = new Map();
  const st = {};
  let snapshotsAfterAck = 0, snapshotsBeforeAck = 0;
  const top20 = (side, desc) => JSON.stringify([...levels(side)].map(([p, q]) => [p, +q.toFixed(10)]).sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, 20));
  let truncatedLines = 0; // the first run's capture cut frames at 2 KB, which cuts the larger snapshots
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    let msg;
    try { msg = JSON.parse(line.slice(line.indexOf(' ') + 1)); } catch { truncatedLines++; continue; }
    if (msg.OrderBookResponse?.result === 'subscribed') acked.add(msg.OrderBookResponse.requestId);
    const sym = streamOf(msg);
    if (sym === null) continue;
    const s = (st[sym] ??= { deltas: 0, oneSideOnly: 0, adds: 0, deletes: 0, readdSamePriceAmount: 0, addOfLiveId: 0, idLastSeenOtherSide: 0, idLastSeenSameSide: 0, unchangedTop20: 0, maxId: 0, lastSide: new Map() });
    if ('ob' in msg) {
      if (acked.has(sym)) snapshotsAfterAck++; else snapshotsBeforeAck++;
      books.set(sym, { bids: new Map(msg.b.map((e) => [e[0], [e[1], e[2]]])), asks: new Map(msg.s.map((e) => [e[0], [e[1], e[2]]])) });
      for (const [k, arr] of [['b', msg.b], ['s', msg.s]]) for (const e of arr) { s.lastSide.set(e[0], k); s.maxId = Math.max(s.maxId, Number(e[0])); }
      continue;
    }
    const book = books.get(sym);
    if (!book) continue;
    s.deltas++;
    if (!msg.b || !msg.s) s.oneSideOnly++;
    const before = top20(book.bids, true) + top20(book.asks, false);
    for (const [k, side] of [['b', book.bids], ['s', book.asks]]) {
      const deleted = new Set();
      for (const e of msg[k] ?? []) {
        if (e.length === 1) {
          const o = side.get(e[0]);
          if (o) deleted.add(`${o[0]},${o[1]}`);
          side.delete(e[0]);
          s.deletes++;
          continue;
        }
        s.adds++;
        if (side.has(e[0])) s.addOfLiveId++;
        if (deleted.has(`${e[1]},${e[2]}`)) s.readdSamePriceAmount++;
        const last = s.lastSide.get(e[0]);
        if (last === k) s.idLastSeenSameSide++; else if (last) s.idLastSeenOtherSide++;
        s.lastSide.set(e[0], k);
        s.maxId = Math.max(s.maxId, Number(e[0]));
        side.set(e[0], [e[1], e[2]]);
      }
    }
    if (before === top20(book.bids, true) + top20(book.asks, false)) s.unchangedTop20++;
  }
  for (const [sym, s] of Object.entries(st)) { const { lastSide, ...rest } = s; log('stream', { sym, ...rest }); }
  const all = Object.values(st);
  const sum = (k) => all.reduce((a, s) => a + s[k], 0);
  log('totals', { file, truncatedLines, snapshotsAfterAck, snapshotsBeforeAck, deltas: sum('deltas'), oneSideOnly: sum('oneSideOnly'), adds: sum('adds'), addOfLiveId: sum('addOfLiveId'), idLastSeenOtherSide: sum('idLastSeenOtherSide'), idLastSeenSameSide: sum('idLastSeenSameSide') });
}

async function deflate() {
  const s = open('deflate', { perMessageDeflate: true });
  await s.ready;
  log('deflate', { status: s.status, offered: 'permessage-deflate', negotiated: s.ext, server: s.server, ray: s.ray, location: s.location, cfCookie: s.cfCookie });
  await sleep(2_000);
  s.ws.close();
  await sleep(500);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, silence, batch, channels, deflate, analyze };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
