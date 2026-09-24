// Vindax spot WebSocket probe: the socket.io v2 stream at socket.vindax.com, its per symbol depth namespace, sequence, level order, alignment with the REST book, keepalive, silence and errors.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which only asks once.
// Run from server/: node ../scripts/probes/venues/vindax/ws-probe.mjs [book|align|batch|silence|deflate|errors]
//   book     eight spot depth namespaces plus trade and kline namespaces on one socket for 65 s, REST book alignment at the start and a compare at the end. About 70 s.
//   align    BTCUSDT and ETHUSDT deltas replayed from the first of seven REST snapshots to each later one, and compared level by level. About 40 s, 14 REST calls.
//   batch    every symbol from exchangeInfo as a depth namespace on one socket for 45 s.
//   silence  three sockets that differ only in pinging and subscribing, for up to 100 s, or the seconds given as the next argument.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   errors   unknown, uppercase, guessed and wrong namespaces, an unknown event, an EIO=4 handshake, and text that is not protocol. About 12 s.
// Set PROBE_OUT_DIR to keep a trimmed copy of the raw frames. Recorded in docs/profiles/vindax/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://socket.vindax.com/socket.io/?EIO=3&transport=websocket';
const API = 'https://api.vindax.com/api/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let captured = 0;

function capture(name, text) {
  if (!OUT || captured > 4_000_000) return;
  mkdirSync(OUT, { recursive: true });
  const line = text.length > 1500 ? text.slice(0, 1500) + '…' : text;
  captured += line.length;
  appendFileSync(join(OUT, name), line + '\n');
}

// Engine.IO 3 packet types: 0 open, 2 ping, 3 pong, 4 message. Socket.IO 2 packet types inside a message: 0 connect, 2 event, 4 error.
function parse(text) {
  const m = /^(\d)(\d)?(\/[^,]*)?,?(.*)$/s.exec(text);
  if (!m) return { raw: text };
  const [, eio, sio, ns, rest] = m;
  let data;
  try {
    data = rest ? JSON.parse(rest) : undefined;
  } catch {
    data = rest;
  }
  return { eio, sio, ns: ns ?? '/', data };
}

function open(label, { deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  ws.t0 = t0;
  ws.on('upgrade', (res) => log('upgrade', { label, status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server }));
  ws.on('open', () => log('open', { label, ms: Date.now() - t0 }));
  ws.on('unexpected-response', (req, res) => log('refused', { label, status: res.statusCode }));
  ws.on('error', (e) => log('socket_error', { label, message: e.message }));
  ws.on('close', (code, reason) => log('close', { label, code, reason: reason.toString(), afterMs: Date.now() - t0 }));
  return ws;
}

const nsOf = (symbol) => '/' + symbol.toLowerCase();

async function restDepth(symbol, limit) {
  const t0 = Date.now();
  const res = await fetch(`${API}/depth?symbol=${symbol}&limit=${limit}`);
  const j = await res.json();
  return { ...j, ms: Date.now() - t0, at: Date.now() };
}

function stats(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
}

class Book {
  bids = new Map();
  asks = new Map();
  load(bids, asks) {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of bids) this.bids.set(Number(p), Number(q));
    for (const [p, q] of asks) this.asks.set(Number(p), Number(q));
  }
  apply(side, levels) {
    const m = side === 'b' ? this.bids : this.asks;
    for (const [p, q] of levels) {
      if (Number(q) === 0) m.delete(Number(p));
      else m.set(Number(p), Number(q));
    }
  }
  top(n) {
    const b = [...this.bids].sort((x, y) => y[0] - x[0]).slice(0, n);
    const a = [...this.asks].sort((x, y) => x[0] - y[0]).slice(0, n);
    return { b, a };
  }
}

async function book() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SUIUSDT', 'RSRUSDT', 'BIOUSDT', 'SCUSDT', 'BFCV2USDT', 'CZWUSDT'];
  const aligned = ['BTCUSDT', 'ETHUSDT', 'SUIUSDT', 'RSRUSDT'];
  const extra = ['/btcusdt_aggTrade', '/btcusdt_kline_1m'];
  const st = Object.fromEntries(symbols.map((s) => [s, {
    frames: 0, buffered: [], lastU: null, gaps: 0, chained: 0, emptyDelta: 0, bidsNotDesc: 0, asksNotAsc: 0,
    zTrue: 0, thirdNonEmpty: 0, priceTypes: new Set(), qtyTypes: new Set(), arrivals: [], eGaps: [], lastE: null,
    crossedAfterApply: 0, applied: 0, repeats: 0, lastText: null, book: null, align: null, maxLevels: 0,
  }]));
  const extraCount = {};
  const pongs = [];
  let pingSentAt = 0;
  const ws = open('book');
  ws.on('message', (buf) => {
    const text = buf.toString();
    const now = Date.now();
    const p = parse(text);
    if (p.eio === '0') {
      log('handshake', { data: p.data });
      for (const s of symbols) ws.send('40' + nsOf(s));
      for (const e of extra) ws.send('40' + e);
      return;
    }
    if (p.eio === '3') {
      pongs.push(now - pingSentAt);
      return;
    }
    if (p.eio !== '4') {
      log('other_packet', { text: text.slice(0, 200) });
      return;
    }
    if (p.sio === '0') {
      log('ns_ack', { ns: p.ns, atMs: now - ws.t0 });
      return;
    }
    if (p.sio === '4') {
      log('ns_error', { ns: p.ns, data: p.data });
      return;
    }
    if (extra.includes(p.ns)) {
      extraCount[p.ns] = (extraCount[p.ns] ?? 0) + 1;
      if (extraCount[p.ns] === 1) log('extra_first', { ns: p.ns, sample: JSON.stringify(p.data).slice(0, 400) });
      capture('extra.txt', text);
      return;
    }
    const msg = Array.isArray(p.data) ? p.data[1] : undefined;
    if (!msg || msg.e !== 'depthUpdate') {
      log('unexpected_event', { ns: p.ns, text: text.slice(0, 200) });
      return;
    }
    capture('depth.txt', `${now} ${text}`);
    const s = st[msg.s];
    if (!s) {
      log('unrouted', { ns: p.ns, s: msg.s });
      return;
    }
    s.frames++;
    if (s.lastText === JSON.stringify([msg.b, msg.a])) s.repeats++;
    s.lastText = JSON.stringify([msg.b, msg.a]);
    s.arrivals.push(now);
    if (s.lastE !== null) s.eGaps.push(msg.E - s.lastE);
    s.lastE = msg.E;
    if (msg.z) s.zTrue++;
    const b = msg.b ?? [];
    const a = msg.a ?? [];
    if (b.length === 0 && a.length === 0) s.emptyDelta++;
    for (const l of [...b, ...a]) {
      s.priceTypes.add(typeof l[0]);
      s.qtyTypes.add(typeof l[1] + (typeof l[1] === 'number' ? ':' + (l[1] === 0 ? 'zero' : 'nonzero') : ''));
      if (Array.isArray(l[2]) && l[2].length > 0) s.thirdNonEmpty++;
    }
    for (let i = 1; i < b.length; i++) if (Number(b[i][0]) > Number(b[i - 1][0])) { s.bidsNotDesc++; break; }
    for (let i = 1; i < a.length; i++) if (Number(a[i][0]) < Number(a[i - 1][0])) { s.asksNotAsc++; break; }
    if (s.lastU !== null) {
      if (msg.U === s.lastU + 1) s.chained++;
      else {
        s.gaps++;
        if (s.gaps <= 3) log('gap', { symbol: msg.s, expected: s.lastU + 1, got: msg.U, u: msg.u });
      }
    }
    s.lastU = msg.u;
    if (s.book) applyDelta(s, msg);
    else s.buffered.push(msg);
  });

  function applyDelta(s, msg) {
    if (msg.u <= s.align.L) return;
    s.book.apply('b', msg.b ?? []);
    s.book.apply('a', msg.a ?? []);
    s.applied++;
    s.maxLevels = Math.max(s.maxLevels, s.book.bids.size, s.book.asks.size);
    const t = s.book.top(1);
    if (t.b.length && t.a.length && t.b[0][0] >= t.a[0][0]) s.crossedAfterApply++;
  }

  const pinger = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      pingSentAt = Date.now();
      ws.send('2');
    }
  }, 20_000);

  await sleep(4000);
  for (const sym of aligned) {
    const s = st[sym];
    const r = await restDepth(sym, 100);
    const L = r.lastUpdateId;
    const first = s.buffered[0];
    const straddle = s.buffered.find((m) => m.U <= L + 1 && m.u >= L + 1);
    s.align = { L, restMs: r.ms, bufferedCount: s.buffered.length, firstU: first?.U, firstu: first?.u, straddle: Boolean(straddle), restBids: r.bids.length, restAsks: r.asks.length };
    s.book = new Book();
    s.book.load(r.bids, r.asks);
    for (const m of s.buffered) applyDelta(s, m);
    s.buffered = [];
    log('align', { symbol: sym, ...s.align });
    await sleep(1300);
  }

  await sleep(10_000);
  ws.send('40/nopeusdt');
  ws.send('40/BTCUSDT');
  await sleep(47_000);

  for (const sym of aligned) {
    const s = st[sym];
    const r = await restDepth(sym, 20);
    const mine = s.book.top(20);
    const eq = (mineSide, restSide) => restSide.filter(([p, q], i) => mineSide[i] && mineSide[i][0] === Number(p) && mineSide[i][1] === Number(q)).length;
    log('compare', {
      symbol: sym, restId: r.lastUpdateId, localU: s.lastU, idDiff: s.lastU - r.lastUpdateId,
      bidsEqual: eq(mine.b, r.bids), asksEqual: eq(mine.a, r.asks), restBids: r.bids.length, restAsks: r.asks.length,
      localBest: [mine.b[0], mine.a[0]], restBest: [r.bids[0], r.asks[0]],
    });
    await sleep(1300);
  }
  clearInterval(pinger);
  ws.close();
  await sleep(500);

  for (const sym of symbols) {
    const s = st[sym];
    const gaps = s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]);
    log('symbol_summary', {
      symbol: sym, frames: s.frames, chained: s.chained, gaps: s.gaps, emptyDelta: s.emptyDelta, repeats: s.repeats,
      bidsNotDesc: s.bidsNotDesc, asksNotAsc: s.asksNotAsc, zTrue: s.zTrue, thirdNonEmpty: s.thirdNonEmpty,
      priceTypes: [...s.priceTypes], qtyTypes: [...s.qtyTypes], arrivalGapMs: stats(gaps), eGapMs: stats(s.eGaps),
      applied: s.applied, crossedAfterApply: s.crossedAfterApply, maxLevels: s.maxLevels,
    });
  }
  log('extra_counts', { extraCount });
  log('pongs', { rttMs: pongs });
}

// Replays the socket deltas from one REST snapshot to a later one and compares the two books level by level.
async function align() {
  const symbols = ['BTCUSDT', 'ETHUSDT'];
  const deltas = Object.fromEntries(symbols.map((s) => [s, []]));
  const snaps = Object.fromEntries(symbols.map((s) => [s, []]));
  const ws = open('align');
  ws.on('message', (buf) => {
    const text = buf.toString();
    if (text.startsWith('0')) {
      for (const s of symbols) ws.send('40' + nsOf(s));
      return;
    }
    const p = parse(text);
    const msg = p.data?.[1];
    if (msg?.e === 'depthUpdate') deltas[msg.s].push({ ...msg, at: Date.now() });
  });
  const pinger = setInterval(() => ws.readyState === ws.OPEN && ws.send('2'), 20_000);
  await sleep(3000);
  for (let i = 0; i < 14; i++) {
    const sym = symbols[i % 2];
    const sentAt = Date.now();
    const r = await restDepth(sym, 100);
    snaps[sym].push({ L: r.lastUpdateId, sentAt, at: r.at, bids: r.bids, asks: r.asks });
    await sleep(2200);
  }
  await sleep(4000);
  clearInterval(pinger);
  ws.close();
  for (const sym of symbols) {
    const ds = deltas[sym];
    const ss = snaps[sym];
    const idEqualsFrameEnd = ss.filter((s) => ds.some((d) => d.u === s.L)).length;
    const idInsideFrame = ss.filter((s) => ds.some((d) => d.U <= s.L && s.L < d.u)).length;
    // Lag: time from the REST reply to the arrival of the first frame whose u reaches the snapshot id.
    const lags = ss.map((s) => {
      const d = ds.find((x) => x.u >= s.L);
      return d ? d.at - s.at : null;
    }).filter((x) => x !== null);
    const results = [];
    const from = ss[0];
    for (let j = 1; j < ss.length; j++) {
      const to = ss[j];
      const book = new Book();
      book.load(from.bids, from.asks);
      const after = ds.filter((d) => d.u > from.L);
      const firstOk = after.length > 0 && after[0].U <= from.L + 1;
      for (const d of after) {
        if (d.u > to.L) break;
        book.apply('b', d.b ?? []);
        book.apply('a', d.a ?? []);
      }
      const reached = after.filter((d) => d.u <= to.L).at(-1)?.u ?? from.L;
      const mine = book.top(100);
      const eq = (m, r) => r.filter(([p, q], k) => m[k] && m[k][0] === Number(p) && m[k][1] === Number(q)).length;
      results.push({ fromL: from.L, toL: to.L, reachedU: reached, exactEnd: reached === to.L, firstDeltaStraddles: firstOk,
        bidsEqual: eq(mine.b, to.bids), bids: to.bids.length, localBids: mine.b.length, asksEqual: eq(mine.a, to.asks), asks: to.asks.length, localAsks: mine.a.length });
    }
    log('align_summary', { symbol: sym, frames: ds.length, snapshots: ss.length, snapshotIds: ss.map((s) => s.L), idEqualsFrameEnd, idInsideFrame, lagMs: stats(lags) });
    for (const r of results) log('replay', { symbol: sym, ...r });
  }
}

async function batch() {
  const res = await fetch(`${API}/exchangeInfo`);
  const symbols = (await res.json()).symbols.map((s) => s.symbol);
  const acked = new Set();
  const refused = [];
  const lastU = new Map();
  const frames = new Map();
  let gaps = 0;
  let chained = 0;
  let total = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = [];
  let second = 0;
  let firstFrameAt = null;
  const ws = open('batch');
  ws.on('message', (buf) => {
    const text = buf.toString();
    const t0 = process.hrtime.bigint();
    const p = parse(text);
    parseNs += process.hrtime.bigint() - t0;
    if (p.eio === '0') {
      ws.subAt = Date.now();
      for (const s of symbols) ws.send('40' + nsOf(s));
      return;
    }
    if (p.eio !== '4') return;
    if (p.sio === '0') {
      acked.add(p.ns);
      if (acked.size + refused.length === symbols.length + 1) log('all_answered', { ms: Date.now() - ws.subAt });
      return;
    }
    if (p.sio === '4') {
      refused.push(p.ns);
      log('batch_refused', { ns: p.ns, data: p.data });
      if (acked.size + refused.length === symbols.length + 1) log('all_answered', { ms: Date.now() - ws.subAt });
      return;
    }
    const msg = p.data?.[1];
    if (msg?.e !== 'depthUpdate') return;
    if (firstFrameAt === null) firstFrameAt = Date.now();
    total++;
    second++;
    bytes += text.length;
    frames.set(msg.s, (frames.get(msg.s) ?? 0) + 1);
    const last = lastU.get(msg.s);
    if (last !== undefined) {
      if (msg.U === last + 1) chained++;
      else {
        gaps++;
        if (gaps <= 5) log('batch_gap', { symbol: msg.s, expected: last + 1, got: msg.U, u: msg.u, missing: msg.U - last - 1 });
      }
    }
    lastU.set(msg.s, msg.u);
  });
  const tick = setInterval(() => {
    perSecond.push(second);
    second = 0;
  }, 1000);
  const pinger = setInterval(() => ws.readyState === ws.OPEN && ws.send('2'), 20_000);
  await sleep(45_000);
  clearInterval(tick);
  clearInterval(pinger);
  ws.close();
  await sleep(500);
  const counts = [...frames.values()];
  log('batch_summary', {
    namespaces: symbols.length, acked: acked.size - (acked.has('/') ? 1 : 0), refused: refused.length, refusedSample: refused.slice(0, 5),
    symbolsWithFrames: frames.size, totalFrames: total, chained, gaps, framesPerSecond: stats(perSecond.slice(2)),
    bytesPerFrame: Math.round(bytes / Math.max(total, 1)), bytesPerSecond: Math.round(bytes / 43),
    parseUsPerFrame: Number(parseNs / 1000n) / Math.max(total, 1), framesPerSymbol: stats(counts),
  });
}

async function silence() {
  const cases = [
    { label: 'no_ns_no_ping', ns: null, ping: false },
    { label: 'quiet_ns_no_ping', ns: '/bfcv2usdt', ping: false },
    { label: 'no_ns_ping_25s', ns: null, ping: true },
  ];
  const sockets = cases.map((c) => {
    const ws = open(c.label);
    let frames = 0;
    ws.on('message', (buf) => {
      const text = buf.toString();
      frames++;
      if (text.startsWith('0') && c.ns) ws.send('40' + c.ns);
      if (text === '2') log('server_ping', { label: c.label, atMs: Date.now() - ws.t0 });
      if (text === '3') log('pong', { label: c.label, atMs: Date.now() - ws.t0 });
    });
    if (c.ping) ws.pinger = setInterval(() => ws.readyState === ws.OPEN && ws.send('2'), 25_000);
    ws.on('close', () => log('frames_before_close', { label: c.label, frames }));
    return ws;
  });
  await sleep(Number(process.argv[3] ?? 100) * 1000);
  for (const ws of sockets) {
    clearInterval(ws.pinger);
    if (ws.readyState === ws.OPEN) log('still_open', { atMs: Date.now() - ws.t0 });
    ws.terminate();
  }
}

async function deflate() {
  const ws = open('deflate_offer', { deflate: true });
  ws.on('message', (buf) => log('first_frame', { text: buf.toString().slice(0, 120) }));
  await sleep(3000);
  log('negotiated', { extensions: ws.extensions });
  ws.terminate();
}

// Namespaces tried for a ticker, book ticker, trade or partial book stream, none of which the web app names.
const GUESSES = ['/market', '/markets', '/tickers', '/ticker', '/allticker', '/mktdata', '/stream', '/btcusdt_ticker', '/btcusdt_bookTicker',
  '/btcusdt_trade', '/btcusdt_depth', '/btcusdt_depth20', '/btcusdt@depth', '/btcusdt_mktdata', '/btcusdt_aggtrade', '/btcusdt_kline_1h'];

async function errors() {
  const ws = open('errors');
  ws.on('message', (buf) => {
    const text = buf.toString();
    if (text.startsWith('0')) {
      for (const f of ['40/nopeusdt', '40/BTCUSDT', '40/btc_usdt', '40/dogecubeusdt', '40/btcusdt', '42/btcusdt,["subscribe",{"symbol":"ETHUSDT"}]', '42["subscribe","btcusdt"]']) ws.send(f);
      for (const g of GUESSES) ws.send('40' + g);
      return;
    }
    if (!/^42\/btcusdt(_kline_1h)?,/.test(text)) log('reply', { atMs: Date.now() - ws.t0, text: text.slice(0, 200) });
  });
  const v4 = new WebSocket(WS_URL.replace('EIO=3', 'EIO=4'), { perMessageDeflate: false });
  v4.on('message', (buf) => {
    const text = buf.toString();
    log('eio4_reply', { text: text.slice(0, 160) });
    if (text.startsWith('0')) v4.send('40/btcusdt,');
    if (text.startsWith('42')) v4.terminate();
  });
  await sleep(6000);
  v4.terminate();
  log('sending_garbage', { text: 'hello' });
  ws.send('hello');
  await sleep(5000);
  log('state_after_garbage', { readyState: ws.readyState });
  ws.terminate();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await book();
if (mode === 'align') await align();
if (mode === 'batch') await batch();
if (mode === 'silence') await silence();
if (mode === 'deflate') await deflate();
if (mode === 'errors') await errors();
log('end', { at: new Date().toISOString() });
process.exit(0);
