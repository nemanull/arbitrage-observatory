// DigiFinex perpetual swap WebSocket probe: zlib frames, the depth channel at 10, 20 and 100 levels, its snapshot and delta semantics, level order, size unit, the 30 channel cap, keepalive, silence, errors, and the index, mark and funding channels.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/digifinex/ws-probe.mjs [book|batch|silence|anchor|deflate]
//   book     depth 20 on four perps and the ticker channel for 75 s, depth 100 and 10 on a second socket, a REST book compare at the end, error replies. About 80 s.
//   batch    depth 20 on the 30 busiest perps on one socket for 60 s, a second socket that asks for 31 channels in one frame, then a 31st channel on the full socket. About 65 s.
//   silence  four sockets that differ only in whether they subscribe and whether they ping, for up to 100 s.
//   anchor   index_price and mark_price on three perps, fund_rate on six, and all_ticker for 40 s, with REST tickers polled once a second beside them, and the funding calls compared at the end.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/digifinex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://openapi.digifinex.com/swap_ws/v2/';
const API = 'https://openapi.digifinex.com/swap/v2/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (xs) => (xs.length ? { n: xs.length, min: +Math.min(...xs).toFixed(1), median: +pct(xs, 0.5).toFixed(1), p90: +pct(xs, 0.9).toFixed(1), max: +Math.max(...xs).toFixed(1) } : { n: 0 });
let reqId = 0;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

async function rest(path) {
  const r = await fetch(`${API}/${path}`);
  return r.json();
}

// Every frame arrives zlib compressed inside a binary message, whatever the socket negotiated.
function open(label, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(URL_WS, { perMessageDeflate: false, ...opts });
  const info = { label, openMs: null, closed: null, pings: 0, frames: 0, binary: 0, text: 0, zlibHeaders: new Set(), wireBytes: 0, jsonBytes: 0, inflateUs: [], parseUs: [], extensions: null, upgradeHeaders: null, t0 };
  ws.on('upgrade', (res) => { info.upgradeHeaders = res.headers; });
  ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; });
  ws.on('ping', () => { info.pings++; });
  ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  ws.on('error', (e) => { info.error = e.message; });
  ws.onFrame = () => {};
  ws.on('message', (data, isBinary) => {
    const arrival = Date.now();
    const buf = Buffer.from(data);
    info.frames++;
    isBinary ? info.binary++ : info.text++;
    info.wireBytes += buf.length;
    info.zlibHeaders.add(buf.subarray(0, 2).toString('hex'));
    let text;
    const a = performance.now();
    try { text = zlib.inflateSync(buf).toString('utf8'); } catch { text = buf.toString('utf8'); }
    const b = performance.now();
    let msg = null;
    try { msg = JSON.parse(text); } catch { msg = { unparsed: text.slice(0, 200) }; }
    const c = performance.now();
    info.inflateUs.push((b - a) * 1000);
    info.parseUs.push((c - b) * 1000);
    info.jsonBytes += text.length;
    capture(`${label}.jsonl`, `${arrival} ${text}`);
    ws.onFrame(msg, arrival, text);
  });
  return { ws, info, ready: new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }) };
}

const send = (ws, obj) => { const o = { id: ++reqId, ...obj }; ws.send(JSON.stringify(o)); return o.id; };

// Local book kept by price, with the first frame after the subscribe taken as the snapshot.
class Book {
  constructor(level) {
    Object.assign(this, { level, bids: new Map(), asks: new Map(), frames: 0, snapshot: null, zeros: 0, maxBids: 0, maxAsks: 0, crossed: 0, fullFrames: 0, lastTs: 0, tsBackwards: 0, gaps: [], lastArrival: 0, repeats: 0, lastText: '', deltaBidsUnordered: 0, deltaAsksUnordered: 0, deltaMulti: 0, deltaBidsAsc: 0, ages: [], emptyFrames: 0, fullFlags: [] });
  }
  onFrame(d, arrival, offset, fullData) {
    if (fullData !== undefined) this.fullFlags.push(`${this.frames + 1}:${fullData}`);
    const text = JSON.stringify([d.bids, d.asks]);
    if (text === this.lastText) this.repeats++;
    this.lastText = text;
    if (this.lastArrival) this.gaps.push(arrival - this.lastArrival);
    this.lastArrival = arrival;
    if (d.timestamp < this.lastTs) this.tsBackwards++;
    this.lastTs = d.timestamp;
    this.ages.push(arrival + offset - d.timestamp);
    const bids = d.bids ?? []; const asks = d.asks ?? [];
    if (bids.length === 0 && asks.length === 0) this.emptyFrames++;
    if (this.frames === 0) {
      this.snapshot = { bids: bids.length, asks: asks.length, zeros: [...bids, ...asks].filter((l) => Number(l[1]) === 0).length, bidsDesc: bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0])), asksAsc: asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0])), priceType: typeof bids[0]?.[0], sizeType: typeof bids[0]?.[1] };
      this.bids.clear(); this.asks.clear();
    } else {
      if (bids.length === this.level && asks.length === this.level && ![...bids, ...asks].some((l) => Number(l[1]) === 0)) this.fullFrames++;
      if (bids.length > 1) { this.deltaMulti++; if (!bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]))) this.deltaBidsUnordered++; if (bids.every((l, i) => i === 0 || Number(l[0]) > Number(bids[i - 1][0]))) this.deltaBidsAsc++; }
      if (asks.length > 1 && !asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]))) this.deltaAsksUnordered++;
    }
    this.frames++;
    for (const [p, s] of bids) { if (Number(s) === 0) { this.zeros++; this.bids.delete(Number(p)); } else this.bids.set(Number(p), Number(s)); }
    for (const [p, s] of asks) { if (Number(s) === 0) { this.zeros++; this.asks.delete(Number(p)); } else this.asks.set(Number(p), Number(s)); }
    this.maxBids = Math.max(this.maxBids, this.bids.size);
    this.maxAsks = Math.max(this.maxAsks, this.asks.size);
    const [bb, ba] = this.best();
    if (bb !== undefined && ba !== undefined && bb >= ba) this.crossed++;
  }
  best() { return [Math.max(...this.bids.keys()), Math.min(...this.asks.keys())].map((x) => (Number.isFinite(x) ? x : undefined)); }
  top(n) {
    return { bids: [...this.bids].sort((x, y) => y[0] - x[0]).slice(0, n), asks: [...this.asks].sort((x, y) => x[0] - y[0]).slice(0, n) };
  }
  summary() {
    return { frames: this.frames, fullDataAtFrame: this.fullFlags, snapshot: this.snapshot, zerosApplied: this.zeros, maxBids: this.maxBids, maxAsks: this.maxAsks, crossedAfterFrame: this.crossed, laterFramesShapedLikeSnapshot: this.fullFrames, identicalConsecutive: this.repeats, emptyFrames: this.emptyFrames, tsBackwards: this.tsBackwards, deltaWithSeveralBids: this.deltaMulti, deltaBidsNotDesc: this.deltaBidsUnordered, deltaBidsAsc: this.deltaBidsAsc, deltaAsksNotAsc: this.deltaAsksUnordered, gapMs: stats(this.gaps), ageMs: stats(this.ages) };
  }
}

async function clockOffset() {
  const offs = [];
  for (let i = 0; i < 3; i++) { const t0 = Date.now(); const r = await rest('time'); const t1 = Date.now(); offs.push(r.data - (t0 + t1) / 2); }
  return pct(offs, 0.5);
}

function sessionSummary(info) {
  return { label: info.label, openMs: info.openMs, frames: info.frames, binary: info.binary, text: info.text, zlibHeaders: [...info.zlibHeaders], wireKB: +(info.wireBytes / 1024).toFixed(1), jsonKB: +(info.jsonBytes / 1024).toFixed(1), inflateUs: stats(info.inflateUs), parseUs: stats(info.parseUs), serverPings: info.pings, closed: info.closed, extensions: info.extensions, error: info.error };
}

function routeBooks(conn, books, acks, other) {
  conn.ws.onFrame = (msg, arrival, text) => {
    if (msg.event === 'depth.update') {
      const key = `${msg.data.instrument_id}@${msg.data.level}`;
      const book = books.get(key);
      if (book) book.onFrame(msg.data, arrival, conn.offset ?? 0, msg.full_data);
      else other.push(`unrouted ${key}`);
      if (book && book.frames <= 2) capture(`${conn.info.label}-first.jsonl`, text);
    } else if ('code' in msg) acks.push({ at: Math.round(arrival - conn.info.t0 - performance.timeOrigin), text: text.slice(0, 300) });
    else other.push(text.slice(0, 300));
  };
}

async function book() {
  const offset = await clockOffset();
  log('clock', { serverMinusLocalMs: Math.round(offset) });
  const ids = ['BTCUSDTPERP', 'ETHUSDTPERP', 'XAUTUSDTPERP', 'MANAUSDTPERP'];
  const A = open('book-A'); A.offset = offset;
  const B = open('book-B'); B.offset = offset;
  await Promise.all([A.ready, B.ready]);
  const booksA = new Map(ids.map((id) => [`${id}@20`, new Book(20)]));
  const booksB = new Map([['BTCUSDTPERP@100', new Book(100)], ['MANAUSDTPERP@100', new Book(100)], ['ETHUSDTPERP@10', new Book(10)], ['BTCPERP@20', new Book(20)]]);
  const acksA = []; const acksB = []; const otherA = []; const otherB = [];
  routeBooks(A, booksA, acksA, otherA);
  routeBooks(B, booksB, acksB, otherB);
  // Ticker frames on socket A compared with the local book at the moment they arrive.
  const tick = { frames: 0, match: 0, mismatch: [], sample: null };
  const baseA = A.ws.onFrame;
  A.ws.onFrame = (msg, arrival, text) => {
    if (msg.event === 'ticker.update') {
      tick.frames++;
      tick.sample ??= text.slice(0, 400);
      const bk = booksA.get(`${msg.data.instrument_id}@20`);
      const [bb, ba] = bk.best();
      if (Number(msg.data.best_bid) === bb && Number(msg.data.best_ask) === ba) tick.match++;
      else if (tick.mismatch.length < 5) tick.mismatch.push(`${msg.data.instrument_id} ticker ${msg.data.best_bid}/${msg.data.best_ask} book ${bb}/${ba}`);
      return;
    }
    baseA(msg, arrival, text);
  };
  const tSub = Date.now();
  send(A.ws, { event: 'depth.subscribe', instrument_ids: ids, level: 20 });
  send(A.ws, { event: 'ticker.subscribe', instrument_ids: ids });
  send(B.ws, { event: 'depth.subscribe', instrument_ids: ['BTCUSDTPERP', 'MANAUSDTPERP'], level: 100 });
  send(B.ws, { event: 'depth.subscribe', instrument_id: 'ETHUSDTPERP', level: 10 });
  send(B.ws, { event: 'depth.subscribe', instrument_id: 'BTCPERP', level: 20 });
  // Application ping every 20 s on both, and the round trip of the first one.
  const pingSent = new Map();
  const pongMs = [];
  const pinger = setInterval(() => { for (const c of [A, B]) { const id = send(c.ws, { event: 'server.ping' }); pingSent.set(id, performance.now()); } }, 20_000);
  const wrapPong = (c) => { const base = c.ws.onFrame; c.ws.onFrame = (msg, arrival, text) => { if (msg.event === 'server.ping' && pingSent.has(msg.id)) { pongMs.push(performance.now() - pingSent.get(msg.id)); capture('pong.jsonl', text); return; } base(msg, arrival, text); }; };
  wrapPong(A); wrapPong(B);
  await sleep(2000);
  const firstArrival = Object.fromEntries([...booksA, ...booksB].map(([k, b]) => [k, b.gaps.length >= 0 && b.lastArrival ? `${b.frames} frames` : 'none']));
  log('after_2s', { firstArrival, msSinceSubscribe: Date.now() - tSub });
  await sleep(73_000);
  clearInterval(pinger);
  // REST book at the end, against the local book.
  for (const [key, bk] of [...booksA, ...booksB]) {
    const [id, level] = key.split('@');
    const r = await rest(`depth?instrument_id=${id}&limit=${Math.min(100, Number(level))}`);
    const t = bk.top(Number(level));
    const restBids = new Map(r.data.bids.map(([p, s]) => [Number(p), Number(s)]));
    const restAsks = new Map(r.data.asks.map(([p, s]) => [Number(p), Number(s)]));
    const samePrice = t.bids.filter(([p]) => restBids.has(p)).length + t.asks.filter(([p]) => restAsks.has(p)).length;
    const sameSize = t.bids.filter(([p, s]) => restBids.get(p) === s).length + t.asks.filter(([p, s]) => restAsks.get(p) === s).length;
    log('book', { key, ...bk.summary(), vsRest: { localLevels: t.bids.length + t.asks.length, restLevels: r.data.bids.length + r.data.asks.length, samePrice, sameSize, localTop: [t.bids[0], t.asks[0]], restTop: [r.data.bids[0], r.data.asks[0]] } });
  }
  log('ticker_vs_book', { frames: tick.frames, match: tick.match, mismatch: tick.mismatch, sample: tick.sample });
  log('acks', { A: acksA, B: acksB, otherA: otherA.slice(0, 5), otherB: otherB.slice(0, 5) });
  log('pong', { rttMs: stats(pongMs) });
  A.ws.close(); B.ws.close();
  await sleep(500);
  log('session', sessionSummary(A.info));
  log('session', sessionSummary(B.info));
  await errors();
}

async function errors() {
  const C = open('errors');
  await C.ready;
  const replies = [];
  const frames = [];
  C.ws.onFrame = (msg, arrival, text) => { if (msg.event === 'depth.update') frames.push(msg.data.instrument_id + '@' + msg.data.level); else replies.push(text.slice(0, 260)); };
  const tries = [
    { event: 'depth.subscribe', instrument_id: 'NOPEUSDTPERP', level: 20 },
    { event: 'depth.subscribe', instrument_id: 'BTCUSDTPERP', level: 30 },
    { event: 'depth.subscribe', instrument_id: 'BTCUSDTPERP', level: 50 },
    { event: 'depth.subscribe', instrument_id: 'TORNUSDTPERP', level: 20 },
    { event: 'depth.subscribe', instrument_id: 'BTCUSDT2PERP', level: 20 },
    { event: 'depth.subscribe', instrument_id: 'BTCUSDTPERP', level: 20 },
    { event: 'depth.subscribe', instrument_id: 'BTCUSDTPERP', level: 20 },
    { event: 'depth.subscribe', instrument_id: 'BTC_USDT', level: 20 },
    { event: 'depth.subscribe', level: 20 },
    { event: 'ticker.subscribe', instrument_id: 'NOPEUSDTPERP' },
    { event: 'nope.subscribe', instrument_id: 'BTCUSDTPERP' },
    { event: 'depth.unsubscribe', instrument_id: 'ETHUSDTPERP', level: 20 },
  ];
  for (const t of tries) { send(C.ws, t); await sleep(400); }
  C.ws.send('not json');
  await sleep(400);
  C.ws.send(JSON.stringify({ event: 'server.time' }));
  await sleep(1500);
  log('errors', { sent: tries.map((t) => `${t.event} ${t.instrument_id ?? ''} ${t.level ?? ''}`), replies, depthFramesFrom: [...new Set(frames)], closed: C.info.closed });
  C.ws.close();
  await sleep(300);
}

async function batch() {
  const tickers = (await rest('tickers')).data;
  const ids = tickers.map((x) => [x.instrument_id, Number(x.volume_24h) * Number(x.last) * 1]).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 31);
  const A = open('batch-30');
  const B = open('batch-31');
  await Promise.all([A.ready, B.ready]);
  const books = new Map(ids.slice(0, 30).map((id) => [`${id}@20`, new Book(20)]));
  const acks = []; const other = [];
  routeBooks(A, books, acks, other);
  const perSecond = [];
  let lastFrames = 0; let lastBytes = 0;
  const meter = setInterval(() => { perSecond.push([A.info.frames - lastFrames, A.info.wireBytes - lastBytes]); lastFrames = A.info.frames; lastBytes = A.info.wireBytes; }, 1000);
  const bReplies = []; const bFrames = new Set();
  B.ws.onFrame = (msg, arrival, text) => { if (msg.event === 'depth.update') bFrames.add(msg.data.instrument_id); else bReplies.push(text.slice(0, 260)); };
  send(A.ws, { event: 'depth.subscribe', instrument_ids: ids.slice(0, 30), level: 20 });
  send(B.ws, { event: 'depth.subscribe', instrument_ids: ids.slice(0, 31), level: 20 });
  const ping = setInterval(() => send(A.ws, { event: 'server.ping' }), 20_000);
  await sleep(60_000);
  clearInterval(meter); clearInterval(ping);
  const sums = [...books].map(([k, b]) => ({ k, ...b.summary() }));
  log('batch', { ids30: ids.slice(0, 30).join(','), id31: ids[30], acks, other: other.slice(0, 5), framesPerSecond: stats(perSecond.map((x) => x[0])), wireBytesPerSecond: stats(perSecond.map((x) => x[1])), crossedTotal: sums.reduce((s, x) => s + x.crossedAfterFrame, 0), booksCrossed: sums.filter((x) => x.crossedAfterFrame > 0).map((x) => `${x.k}:${x.crossedAfterFrame}`), overTwentyLevels: sums.filter((x) => Math.max(x.maxBids, x.maxAsks) > 20).map((x) => `${x.k}:${x.maxBids}/${x.maxAsks}`), maxGapMs: Math.max(...sums.map((x) => x.gapMs.max ?? 0)), quietest: sums.sort((a, b) => a.frames - b.frames).slice(0, 3).map((x) => `${x.k}:${x.frames}`), noFrames: sums.filter((x) => x.frames === 0).map((x) => x.k) });
  log('batch_31_in_one_frame', { replies: bReplies.slice(0, 4), instrumentsDelivering: bFrames.size, closed: B.info.closed });
  // A 31st channel on the socket that already holds 30, sent last because it may end the socket.
  const before = A.info.frames;
  const tSend = Date.now();
  send(A.ws, { event: 'depth.subscribe', instrument_id: ids[30], level: 20 });
  await sleep(3000);
  log('batch_31st_on_full_socket', { framesAfter: A.info.frames - before, closed: A.info.closed, msAfterSend: A.info.closed ? A.info.closed.atMs - (tSend - performance.timeOrigin - A.info.t0) : null, lastReplies: acks.slice(-2) });
  A.ws.close(); B.ws.close();
  await sleep(500);
  const sA = sessionSummary(A.info);
  log('session', { ...sA, bytesPerFrame: Math.round(A.info.wireBytes / A.info.frames), jsonBytesPerFrame: Math.round(A.info.jsonBytes / A.info.frames) });
  log('session', sessionSummary(B.info));
}

async function silence() {
  const quiet = 'SATSUSDTPERP';
  const socks = {
    nothing: open('silent-nothing'),
    subscribedNoPing: open('silent-sub'),
    subscribedPing20: open('silent-sub-ping'),
    pingOnly20: open('silent-ping'),
  };
  await Promise.all(Object.values(socks).map((s) => s.ready));
  const counts = Object.fromEntries(Object.keys(socks).map((k) => [k, { depth: 0, other: 0 }]));
  for (const [k, s] of Object.entries(socks)) s.ws.onFrame = (msg) => { msg.event === 'depth.update' ? counts[k].depth++ : counts[k].other++; };
  send(socks.subscribedNoPing.ws, { event: 'depth.subscribe', instrument_id: quiet, level: 20 });
  send(socks.subscribedPing20.ws, { event: 'depth.subscribe', instrument_id: quiet, level: 20 });
  const ping = setInterval(() => { for (const k of ['subscribedPing20', 'pingOnly20']) if (socks[k].ws.readyState === 1) send(socks[k].ws, { event: 'server.ping' }); }, 20_000);
  const t0 = Date.now();
  while (Date.now() - t0 < 100_000 && Object.values(socks).some((s) => !s.info.closed)) await sleep(500);
  clearInterval(ping);
  for (const [k, s] of Object.entries(socks)) { log('silence', { socket: k, frames: counts[k], serverPings: s.info.pings, closed: s.info.closed, openAfterMs: Date.now() - t0 }); if (!s.info.closed) s.ws.close(); }
  await sleep(300);
}

async function anchor() {
  const offset = await clockOffset();
  const ids = ['BTCUSDTPERP', 'XAUTUSDTPERP', 'MANAUSDTPERP'];
  const A = open('anchor');
  await A.ready;
  const seen = {}; const samples = {}; const acks = [];
  let allTicker = { frames: 0, rows: [], bytes: [] };
  A.ws.onFrame = (msg, arrival, text) => {
    if (msg.event === 'all_ticker.update' || (Array.isArray(msg) || (msg.event === undefined && Array.isArray(msg.data)))) {
      allTicker.frames++; allTicker.rows.push(Array.isArray(msg.data) ? msg.data.length : -1); allTicker.bytes.push(text.length);
      samples.all_ticker ??= text.slice(0, 500);
      return;
    }
    if (msg.event?.endsWith('.update')) {
      const k = `${msg.event.replace('.update', '')} ${msg.data.instrument_id}`;
      const s = (seen[k] ??= { n: 0, values: new Set(), gaps: [], last: 0, ages: [] });
      s.n++;
      s.values.add(JSON.stringify(Object.fromEntries(Object.entries(msg.data).filter(([f]) => f !== 'timestamp'))));
      if (s.last) s.gaps.push(arrival - s.last);
      s.last = arrival;
      if (msg.data.timestamp) s.ages.push(arrival + offset - msg.data.timestamp);
      samples[msg.event] ??= text.slice(0, 400);
      return;
    }
    acks.push(text.slice(0, 200));
  };
  const fundIds = ['BTCUSDTPERP', 'ETHUSDTPERP', 'MANAUSDTPERP', 'XAUTUSDTPERP', 'PIUSDTPERP', 'NVDAUSDTPERP'];
  const lastFund = {};
  const wsIndex = []; const wsMark = [];
  let firstAll = null;
  const baseFrame = A.ws.onFrame;
  A.ws.onFrame = (msg, arrival, text) => {
    if (msg.event === 'fund_rate.update') lastFund[msg.data.instrument_id] = msg.data;
    if (msg.event === 'index_price.update' && msg.data.instrument_id === 'BTCUSDTPERP') wsIndex.push([arrival, msg.data.index_price]);
    if (msg.event === 'mark_price.update' && msg.data.instrument_id === 'BTCUSDTPERP') wsMark.push([arrival, msg.data.mark_price]);
    if (msg.event === 'all_ticker.update') firstAll ??= msg.data;
    baseFrame(msg, arrival, text);
  };
  for (const ch of ['index_price', 'mark_price']) send(A.ws, { event: `${ch}.subscribe`, instrument_ids: ids });
  send(A.ws, { event: 'fund_rate.subscribe', instrument_ids: fundIds });
  send(A.ws, { event: 'all_ticker.subscribe' });
  // REST tickers once a second beside the pushes: is the REST value the latest pushed one, and if not, how long ago was it pushed.
  const lag = { index: { current: 0, stale: [], unseen: 0 }, mark: { current: 0, stale: [], unseen: 0 } };
  const tEnd = Date.now() + 40_000;
  await sleep(3000);
  while (Date.now() < tEnd) {
    const t0 = Date.now();
    const row = (await rest('tickers')).data.find((x) => x.instrument_id === 'BTCUSDTPERP');
    const at = Date.now();
    for (const [k, series, v] of [['index', wsIndex, row.index_price], ['mark', wsMark, row.mark_price]]) {
      const seen = series.filter(([ts]) => ts <= at);
      if (seen.length && seen.at(-1)[1] === v) lag[k].current++;
      else {
        const hit = [...seen].reverse().find(([, val]) => val === v);
        hit ? lag[k].stale.push(at - hit[0]) : lag[k].unseen++;
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  const t = (await rest('tickers')).data;
  const f = await rest('funding_rate?instrument_id=BTCUSDTPERP');
  A.ws.close();
  await sleep(300);
  // The pushed rate against the REST call and the REST history, per contract.
  const iso = (x) => new Date(x).toISOString().slice(5, 16);
  const inst = new Set((await rest('instruments')).data.map((x) => x.instrument_id));
  for (const id of fundIds) {
    const w = lastFund[id];
    const r = (await rest(`funding_rate?instrument_id=${id}`)).data;
    const h = (await rest(`funding_rate_history?instrument_id=${id}&start_timestamp=${Date.now() - 86400e3}`)).data.funding_rates;
    log('fund_rate_vs_rest', { id, ws: w ? `${w.funding_rate}@${iso(w.funding_time)} next ${w.next_funding_rate}@${iso(w.next_funding_time)}` : null, restCall: `${r.funding_rate}@${iso(r.funding_time)} next ${r.next_funding_rate}@${iso(r.next_funding_time)}`, historyLastTwo: h.slice(-2).map((x) => `${x.rate}@${iso(x.time)}`).join(' ') });
    await sleep(300);
  }
  const extra = (firstAll ?? []).map((x) => x.instrument_id).filter((i) => !inst.has(i));
  log('rest_vs_push_btc', { index: { current: lag.index.current, staleMs: stats(lag.index.stale), unseen: lag.index.unseen }, mark: { current: lag.mark.current, staleMs: stats(lag.mark.stale), unseen: lag.mark.unseen } });
  log('all_ticker_ids', { rows: firstAll?.length, notInInstruments: extra.length, sample: extra.slice(0, 12) });
  log('anchor_channels', { per: Object.fromEntries(Object.entries(seen).map(([k, s]) => [k, { pushes: s.n, distinctValues: s.values.size, gapMs: stats(s.gaps), ageMs: stats(s.ages) }])) });
  log('anchor_last_vs_rest', { btcRest: [t.find((x) => x.instrument_id === 'BTCUSDTPERP')?.index_price, t.find((x) => x.instrument_id === 'BTCUSDTPERP')?.mark_price], fundRest: f.data });
  log('all_ticker', { frames: allTicker.frames, rowsPerFrame: [...new Set(allTicker.rows)], bytes: stats(allTicker.bytes) });
  log('anchor_samples', { samples, acks });
  log('session', sessionSummary(A.info));
}

async function deflate() {
  const D = open('deflate', { perMessageDeflate: true });
  await D.ready;
  let first = null;
  D.ws.onFrame = (msg, arrival, text) => { first ??= text.slice(0, 120); };
  send(D.ws, { event: 'server.ping' });
  await sleep(1500);
  log('deflate', { offered: 'permessage-deflate', negotiated: D.info.upgradeHeaders?.['sec-websocket-extensions'] ?? null, extensions: D.info.extensions, zlibInsideFrame: [...D.info.zlibHeaders], first, cfRay: D.info.upgradeHeaders?.['cf-ray'] });
  D.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, anchor, deflate };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(2); }
await modes[mode]();
process.exit(0);
