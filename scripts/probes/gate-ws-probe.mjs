// Gate futures WebSocket probe: book channels, sequence and level order, size unit, keepalive, silence, errors, and a batch of perpetuals on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/gate-ws-probe.mjs [book|batch|silence|deflate]
//   book     obu 50 on four perps for 75 s with a REST book compare, order_book_update, legacy order_book, book_ticker, tickers, errors, other families. About 80 s.
//   batch    obu 50 on 150 USDT perps on one connection for 60 s.
//   silence  six sockets that differ only in what the client sends or subscribes, for up to 150 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/gate/websocket.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const USDT_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
const BTC_URL = 'wss://fx-ws.gateio.ws/v4/ws/btc';
const USD1_URL = 'wss://fx-ws.gateio.ws/v4/ws/usd1';
const API = 'https://api.gateio.ws/api/v4';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const nowSec = () => Math.floor(Date.now() / 1000);
const frame = (channel, event, payload) => JSON.stringify({ time: nowSec(), channel, event, ...(payload === undefined ? {} : { payload }) });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// A local book per stream, kept exactly as the documentation says: replace on full, apply when U is the last u plus one.
class Book {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.u = null; this.maxLevels = 0; }
  reset(r) {
    this.bids.clear(); this.asks.clear();
    for (const [p, s] of r.b ?? []) if (Number(s) !== 0) this.bids.set(p, s);
    for (const [p, s] of r.a ?? []) if (Number(s) !== 0) this.asks.set(p, s);
    this.u = r.u;
  }
  apply(r) {
    for (const [p, s] of r.b ?? []) Number(s) === 0 ? this.bids.delete(p) : this.bids.set(p, s);
    for (const [p, s] of r.a ?? []) Number(s) === 0 ? this.asks.delete(p) : this.asks.set(p, s);
    this.u = r.u;
    this.maxLevels = Math.max(this.maxLevels, this.bids.size, this.asks.size);
  }
  top(n) {
    const bids = [...this.bids].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
    const asks = [...this.asks].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
    return { bids, asks };
  }
}

function open(url, opts = {}) {
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const t0 = performance.now();
  const info = { url, pings: [], closed: null, openMs: null, extensions: null, upgradeHeaders: null };
  ws.on('upgrade', (res) => { info.upgradeHeaders = res.headers; });
  ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; });
  ws.on('ping', (d) => info.pings.push({ atMs: Math.round(performance.now() - t0), data: d.toString() }));
  ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  ws.on('error', (e) => { info.error = e.message; });
  const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, info, ready, t0 };
}

const isAsc = (levels) => levels.every((l, i) => i === 0 || Number(l[0]) > Number(levels[i - 1][0]));
const isDesc = (levels) => levels.every((l, i) => i === 0 || Number(l[0]) < Number(levels[i - 1][0]));

async function obuTest() {
  const symbols = ['BTC_USDT', 'ETH_USDT', 'CHR_USDT', 'INIT_USDT'];
  const WINDOW_MS = 75_000;
  const { ws, info, ready, t0 } = open(USDT_URL);
  await ready;
  const stats = Object.fromEntries(symbols.map((s) => [s, { snapshots: 0, deltas: 0, emptyDeltas: 0, gaps: 0, gapSamples: [], bytes: 0, snapshotLevels: null, snapshotBidsDesc: null, snapshotAsksAsc: null, deltaBidOrderViolations: 0, deltaAskOrderViolations: 0, sizeStringTypes: new Set(), maxIdleMs: 0, lastAt: null, firstSnapshotMs: null, repeatsSameU: 0 }]));
  const books = Object.fromEntries(symbols.map((s) => [s, new Book()]));
  const history = { BTC_USDT: [], ETH_USDT: [] }; // top 20 after every frame, bounded
  const acks = [];
  const pongs = [];
  const other = [];
  const firstFrames = [];
  let msgs = 0;
  let bytes = 0;

  ws.on('message', (data, isBinary) => {
    const text = data.toString();
    msgs++; bytes += data.length;
    const at = performance.now() - t0;
    if (firstFrames.length < 8) firstFrames.push({ atMs: Math.round(at), isBinary, text: text.slice(0, 600) });
    capture('obu_frames.jsonl', text);
    let j; try { j = JSON.parse(text); } catch { other.push(text.slice(0, 200)); return; }
    if (j.channel === 'futures.pong') { pongs.push({ atMs: Math.round(at), frame: j }); return; }
    if (j.event === 'subscribe' || j.event === 'unsubscribe' || j.error) { acks.push({ atMs: Math.round(at), frame: j }); return; }
    if (j.channel !== 'futures.obu' || j.event !== 'update') { other.push(text.slice(0, 300)); return; }
    const r = j.result;
    const sym = r.s.split('.')[1];
    const st = stats[sym];
    if (!st) { other.push(`unrequested ${r.s}`); return; }
    st.bytes += data.length;
    if (st.lastAt !== null) st.maxIdleMs = Math.max(st.maxIdleMs, Math.round(at - st.lastAt));
    st.lastAt = at;
    for (const [, s] of [...(r.b ?? []), ...(r.a ?? [])]) st.sizeStringTypes.add(typeof s);
    const book = books[sym];
    if (r.full) {
      st.snapshots++;
      if (st.firstSnapshotMs === null) st.firstSnapshotMs = Math.round(at);
      st.snapshotLevels = { bids: r.b?.length ?? 0, asks: r.a?.length ?? 0 };
      st.snapshotBidsDesc = isDesc(r.b ?? []);
      st.snapshotAsksAsc = isAsc(r.a ?? []);
      book.reset(r);
    } else {
      st.deltas++;
      if (!r.b && !r.a) st.emptyDeltas++;
      if (r.b && !isDesc(r.b)) st.deltaBidOrderViolations++;
      if (r.a && !isAsc(r.a)) st.deltaAskOrderViolations++;
      if (book.u === null) { st.gaps++; st.gapSamples.push({ reason: 'delta_before_snapshot', U: r.U }); return; }
      if (r.U === book.u) st.repeatsSameU++;
      if (r.U !== book.u + 1) { st.gaps++; if (st.gapSamples.length < 5) st.gapSamples.push({ expected: book.u + 1, U: r.U, u: r.u }); }
      book.apply(r);
    }
    if (history[sym]) {
      history[sym].push({ u: book.u, t: r.t, recv: Date.now(), ...book.top(20) });
      if (history[sym].length > 400) history[sym].shift();
    }
  });

  ws.send(frame('futures.obu', 'subscribe', symbols.map((s) => `ob.${s}.50`)));
  const sentAt = performance.now() - t0;
  const pingTimer = setInterval(() => { ws.send(JSON.stringify({ time: nowSec(), channel: 'futures.ping' })); pongs.push({ sentAtMs: Math.round(performance.now() - t0) }); }, 20_000);

  // The REST book compare: sizes and prices on both, near the same update id.
  await sleep(35_000);
  const compare = [];
  for (const sym of ['BTC_USDT', 'ETH_USDT']) {
    const res = await fetch(`${API}/futures/usdt/order_book?contract=${sym}&limit=20&with_id=true`);
    const rest = await res.json();
    const recv = Date.now();
    const h = history[sym];
    const below = [...h].reverse().find((x) => x.u <= rest.id);
    const above = h.find((x) => x.u >= rest.id);
    const score = (x) => {
      if (!x) return null;
      const restBids = new Map(rest.bids.map((l) => [Number(l.p), l.s]));
      const restAsks = new Map(rest.asks.map((l) => [Number(l.p), l.s]));
      let priceMatch = 0; let sizeMatch = 0; let floorMatch = 0; let wsFractional = 0;
      const one = (side, restSide) => {
        for (const [p, s] of side) {
          if (Number(s) % 1 !== 0) wsFractional++;
          if (!restSide.has(Number(p))) continue;
          priceMatch++;
          if (Number(restSide.get(Number(p))) === Number(s)) sizeMatch++;
          if (Number(restSide.get(Number(p))) === Math.floor(Number(s))) floorMatch++;
        }
      };
      one(x.bids, restBids);
      one(x.asks, restAsks);
      return { u: x.u, priceMatchOf40: priceMatch, sizeMatchOf40: sizeMatch, restEqualsFloorOfWs: floorMatch, wsFractionalOf40: wsFractional, wsBid0: x.bids[0], wsAsk0: x.asks[0] };
    };
    compare.push({ sym, restId: rest.id, restBid0: rest.bids[0], restAsk0: rest.asks[0], restSizeType: typeof rest.bids[0]?.s, recvDeltaMs: recv - (above?.recv ?? recv), below: score(below), above: score(above) });
    await sleep(1100);
  }
  log('obu_rest_compare', { compare });

  await sleep(Math.max(0, WINDOW_MS - (performance.now() - t0 - sentAt)));
  clearInterval(pingTimer);
  const windowSec = (performance.now() - t0 - sentAt) / 1000;
  ws.close();
  await sleep(300);
  for (const [sym, st] of Object.entries(stats)) {
    const { lastAt, sizeStringTypes, ...rest } = st;
    log('obu_stats', { sym, windowSec: +windowSec.toFixed(1), msgPerSec: +((st.snapshots + st.deltas) / windowSec).toFixed(1), bytesPerSec: Math.round(st.bytes / windowSec), sizeTypes: [...sizeStringTypes], maxHeldLevels: books[sym].maxLevels, heldAtEnd: { bids: books[sym].bids.size, asks: books[sym].asks.size }, ...rest });
  }
  log('obu_session', { msgs, bytes, msgPerSec: +(msgs / windowSec).toFixed(1), openMs: info.openMs, extensions: info.extensions, upgradeHeaders: info.upgradeHeaders, serverPings: info.pings, closed: info.closed, acks, pongs, other: other.slice(0, 5), firstFrames });
}

async function channelTest(url, label, subs, windowMs, classify, later = []) {
  const { ws, info, ready, t0 } = open(url);
  await ready;
  const frames = [];
  const counts = {};
  const state = {};
  ws.on('message', (data) => {
    const text = data.toString();
    const at = Math.round(performance.now() - t0);
    capture(`${label}.jsonl`, text);
    let j; try { j = JSON.parse(text); } catch { frames.push({ at, text: text.slice(0, 200) }); return; }
    const key = `${j.channel}:${j.event}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (frames.length < 10 || (counts[key] <= 2)) frames.push({ at, text: text.slice(0, 700) });
    classify?.(j, state, at);
  });
  for (const s of subs) ws.send(s);
  const timers = later.map(([delayMs, text]) => setTimeout(() => ws.readyState === 1 && ws.send(text), delayMs));
  await sleep(windowMs);
  timers.forEach(clearTimeout);
  ws.close();
  await sleep(300);
  log('channel', { label, url, openMs: info.openMs, windowMs, counts, state, closed: info.closed, frames: frames.slice(0, 16) });
}

// order_book_update: whether the first frame is a snapshot and whether U chains to the previous u.
function oubClassifier(j, state) {
  if (j.channel !== 'futures.order_book_update' || j.event !== 'update') return;
  const r = j.result;
  const key = `${r.s}:${r.l}`;
  const st = (state[key] ??= { frames: 0, fulls: 0, firstFull: null, gaps: 0, empty: 0, lastU: null, sizeTypes: [], firstLevels: null });
  st.frames++;
  if (st.frames === 1) { st.firstFull = r.full === true; st.firstLevels = { b: r.b?.length, a: r.a?.length }; }
  if (r.full) st.fulls++;
  if (!r.b?.length && !r.a?.length) st.empty++;
  const t = typeof (r.b?.[0]?.s ?? r.a?.[0]?.s);
  if (t !== 'undefined' && !st.sizeTypes.includes(t)) st.sizeTypes.push(t);
  if (st.lastU !== null && !r.full && r.U !== st.lastU + 1) st.gaps++;
  st.lastU = r.u;
}

function tickerClassifier(j, state) {
  if (j.event !== 'update') return;
  if (j.channel === 'futures.tickers') {
    for (const t of j.result) {
      const st = (state[`tickers:${t.contract}`] ??= { frames: 0, markChanges: 0, indexChanges: 0, rateChanges: 0, last: null, keys: Object.keys(t) });
      st.frames++;
      if (st.last) { if (st.last.mark_price !== t.mark_price) st.markChanges++; if (st.last.index_price !== t.index_price) st.indexChanges++; if (st.last.funding_rate !== t.funding_rate) st.rateChanges++; }
      st.last = { mark_price: t.mark_price, index_price: t.index_price, funding_rate: t.funding_rate, last: t.last };
    }
  }
  if (j.channel === 'futures.book_ticker') {
    const r = j.result;
    const st = (state[`book_ticker:${r.s}`] ??= { frames: 0, sameTopRepeats: 0, last: null });
    st.frames++;
    const top = `${r.b}|${r.B}|${r.a}|${r.A}`;
    if (st.last === top) st.sameTopRepeats++;
    st.last = top;
  }
  if (j.channel === 'futures.order_book') {
    const st = (state[`order_book:${j.event}`] ??= { frames: 0 });
    st.frames++;
  }
}

async function bookMode() {
  await Promise.all([
    obuTest(),
    (async () => {
      await sleep(500);
      await channelTest(USDT_URL, 'order_book_update', [
        frame('futures.order_book_update', 'subscribe', ['BTC_USDT', '20ms', '20']),
        frame('futures.order_book_update', 'subscribe', ['ETH_USDT', '100ms', '100']),
        frame('futures.order_book_update', 'subscribe', ['CHR_USDT', '100ms', '20']),
      ], 30_000, oubClassifier);
    })(),
    (async () => {
      await sleep(1000);
      await channelTest(USDT_URL, 'tickers_bookticker_legacy', [
        frame('futures.tickers', 'subscribe', ['BTC_USDT', 'CHR_USDT']),
        frame('futures.book_ticker', 'subscribe', ['BTC_USDT', 'CHR_USDT']),
        frame('futures.order_book', 'subscribe', ['ETH_USDT', '20', '0']),
      ], 30_000, tickerClassifier);
    })(),
    (async () => {
      await sleep(1500);
      await channelTest(USDT_URL, 'errors', [
        frame('futures.obu', 'subscribe', ['ob.NOPE_USDT.50']),
        frame('futures.obu', 'subscribe', ['ob.BTC_USDT.20']),
        frame('futures.obu', 'subscribe', ['ob.BTC_USDT.50']),
        frame('futures.obu', 'subscribe', ['ob.BTC_USDT.50']),
        frame('futures.obu', 'subscribe', ['ob.BTC_USD.50']),
        frame('futures.order_book_update', 'subscribe', ['NOPE_USDT', '100ms', '20']),
        frame('futures.order_book_update', 'subscribe', ['BTC_USDT', '100ms', '30']),
        frame('futures.tickers', 'subscribe', ['NOPE_USDT']),
        frame('futures.nope', 'subscribe', ['BTC_USDT']),
        'not json',
      ], 12_000, oubClassifierObu, [[8_000, JSON.stringify({ time: nowSec(), channel: 'futures.obu', event: 'unsubscribe', payload: ['ob.BTC_USDT.50'] })]]);
    })(),
    (async () => {
      await sleep(2000);
      await channelTest(BTC_URL, 'family_btc', [frame('futures.obu', 'subscribe', ['ob.BTC_USD.50']), frame('futures.obu', 'subscribe', ['ob.BTC_USDT.50'])], 5_000, oubClassifierObu);
      await channelTest(USD1_URL, 'family_usd1', [frame('futures.obu', 'subscribe', ['ob.BTC_USD1.50']), frame('futures.obu', 'subscribe', ['ob.BTC_USDT.50'])], 5_000, oubClassifierObu);
      // The 400 level stream, and a contract id that is not ASCII.
      await channelTest(USDT_URL, 'obu_400_and_unicode', [frame('futures.obu', 'subscribe', ['ob.BTC_USDT.400', 'ob.币安人生_USDT.50'])], 5_000, oubClassifierObu);
    })(),
  ]);
}

function oubClassifierObu(j, state) {
  if (j.channel !== 'futures.obu' || j.event !== 'update') return;
  const r = j.result;
  const st = (state[r.s] ??= { frames: 0, fulls: 0, b0: null, a0: null });
  st.frames++;
  if (r.full) { st.fulls++; st.b0 = r.b?.[0]; st.a0 = r.a?.[0]; st.levels = { b: r.b?.length, a: r.a?.length }; }
}

async function batchMode() {
  const res = await fetch(`${API}/futures/usdt/tickers`);
  const tickers = await res.json();
  tickers.sort((a, b) => Number(b.volume_24h_quote) - Number(a.volume_24h_quote));
  // Every sixth contract by volume, so the slice spans the liquid head and the thin tail.
  const symbols = tickers.filter((_, i) => i % 6 === 0).slice(0, 150).map((t) => t.contract);
  const WINDOW_MS = 60_000;
  const { ws, info, ready, t0 } = open(USDT_URL);
  await ready;
  const last = new Map();
  const snap = new Set();
  let msgs = 0; let bytes = 0; let gaps = 0; let deltas = 0; let fulls = 0; let empty = 0; let parseNs = 0n;
  const acks = { success: 0, fail: [] };
  const perSecond = [];
  let secMsgs = 0;
  const secTimer = setInterval(() => { perSecond.push(secMsgs); secMsgs = 0; }, 1000);
  ws.on('message', (data) => {
    msgs++; secMsgs++; bytes += data.length;
    const p0 = process.hrtime.bigint();
    const j = JSON.parse(data.toString());
    parseNs += process.hrtime.bigint() - p0;
    if (j.event === 'subscribe') { if (j.error) acks.fail.push(JSON.stringify(j).slice(0, 200)); else acks.success++; return; }
    if (j.channel !== 'futures.obu' || j.event !== 'update') return;
    const r = j.result;
    if (r.full) { fulls++; snap.add(r.s); last.set(r.s, r.u); return; }
    deltas++;
    if (!r.b && !r.a) empty++;
    const prev = last.get(r.s);
    if (prev === undefined || r.U !== prev + 1) gaps++;
    last.set(r.s, r.u);
  });
  const subAt = performance.now();
  for (const s of symbols) ws.send(frame('futures.obu', 'subscribe', [`ob.${s}.50`]));
  const pingTimer = setInterval(() => ws.send(JSON.stringify({ time: nowSec(), channel: 'futures.ping' })), 20_000);
  let allSnapshotsMs = null;
  const check = setInterval(() => { if (allSnapshotsMs === null && snap.size === symbols.length) allSnapshotsMs = Math.round(performance.now() - subAt); }, 50);
  await sleep(WINDOW_MS);
  clearInterval(secTimer); clearInterval(pingTimer); clearInterval(check);
  ws.close();
  await sleep(300);
  const sorted = [...perSecond].sort((a, b) => a - b);
  log('batch', { symbols: symbols.length, firstSymbols: symbols.slice(0, 5), lastSymbols: symbols.slice(-5), windowSec: WINDOW_MS / 1000, openMs: info.openMs, acks, snapshotsReceived: snap.size, allSnapshotsMs, msgs, msgPerSec: +(msgs / (WINDOW_MS / 1000)).toFixed(1), perSecondMedian: sorted[Math.floor(sorted.length / 2)], perSecondMax: sorted.at(-1), bytesPerSec: Math.round(bytes / (WINDOW_MS / 1000)), avgFrameBytes: Math.round(bytes / msgs), fulls, deltas, emptyDeltas: empty, gaps, parseMicrosPerMsg: +(Number(parseNs) / msgs / 1000).toFixed(1), serverPings: info.pings.length, closed: info.closed });
}

// Which client behaviour keeps a socket open: nothing at all, a subscription on a thin or a busy book, an application ping, or a protocol ping.
async function silenceMode() {
  const CAP_MS = 150_000;
  const cases = [
    { id: 'idle_no_pong', opts: { autoPong: false } },
    { id: 'idle_auto_pong', opts: {} },
    { id: 'thin_book_no_ping', subscribe: ['ob.CHR_USDT.50'] },
    { id: 'busy_book_no_ping', subscribe: ['ob.BTC_USDT.50'] },
    { id: 'idle_app_ping_25s', appPingMs: 25_000 },
    { id: 'idle_protocol_ping_10s', protocolPingMs: 10_000 },
  ];
  const conns = cases.map((c) => ({ ...c, ...open(USDT_URL, c.opts ?? {}), msgs: 0, pongs: 0, lastMsgMs: null }));
  await Promise.all(conns.map((c) => c.ready));
  const timers = [];
  for (const c of conns) {
    c.ws.on('message', (d) => { c.msgs++; c.lastMsgMs = Math.round(performance.now() - c.t0); if (d.toString().includes('futures.pong')) c.pongs++; });
    c.ws.on('pong', () => c.pongs++);
    if (c.subscribe) c.ws.send(frame('futures.obu', 'subscribe', c.subscribe));
    if (c.appPingMs) timers.push(setInterval(() => c.ws.readyState === 1 && c.ws.send(JSON.stringify({ time: nowSec(), channel: 'futures.ping' })), c.appPingMs));
    if (c.protocolPingMs) timers.push(setInterval(() => c.ws.readyState === 1 && c.ws.ping(), c.protocolPingMs));
  }
  const t = Date.now();
  while (Date.now() - t < CAP_MS && conns.some((c) => c.info.closed === null)) await sleep(1000);
  timers.forEach(clearInterval);
  for (const c of conns) log('silence', { id: c.id, serverPings: c.info.pings, closed: c.info.closed, msgs: c.msgs, pongs: c.pongs, lastMsgMs: c.lastMsgMs, capMs: CAP_MS });
  conns.forEach((c) => c.ws.terminate());
}

async function deflateMode() {
  const { ws, info, ready } = open(USDT_URL, { perMessageDeflate: true });
  await ready;
  let binary = 0; let text = 0;
  ws.on('message', (d, isBinary) => (isBinary ? binary++ : text++));
  ws.send(frame('futures.obu', 'subscribe', ['ob.BTC_USDT.50']));
  await sleep(3000);
  ws.close();
  log('deflate', { requested: true, negotiated: info.extensions, secWebSocketExtensions: info.upgradeHeaders?.['sec-websocket-extensions'] ?? null, binary, text });
}

const mode = process.argv[2] ?? 'book';
if (mode === 'book') await bookMode();
else if (mode === 'batch') await batchMode();
else if (mode === 'silence') await silenceMode();
else if (mode === 'deflate') await deflateMode();
process.exit(0);
