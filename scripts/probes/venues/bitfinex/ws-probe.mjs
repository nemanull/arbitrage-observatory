// Bitfinex public WebSocket v2 probe for the perpetual (F0) books: snapshot and update shape, checksum, level order and window, size unit against REST, heartbeats, the status channel, subscription cap, silence, errors and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks for it once.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitfinex/ws-probe.mjs [book|batch|flags|silence|errors|deflate]
//   book     book P0 F0 len 25 on seven perps of three families, len 100 on ETH and R0 on BTC, status on two perps and ticker on BTC, checksum on every book, a REST book compare. About 75 s.
//   batch    book P0 len 25 on 31 USDT perps on one socket, or BATCH_N of them, to find the per connection cap, checksum on all of them. About 60 s.
//   flags    SEQ_ALL with OB_CHECKSUM on two books, then TIMESTAMP and BULK_UPDATES added, to see what each appends. About 25 s.
//   silence  three sockets that differ in what the client subscribes and sends, for up to 120 s.
//   errors   unknown symbol, channel, length and precision, a duplicate, text that is not JSON. About 15 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// DURATION_S shortens the hold of book, batch and silence, so a rerun can stay inside the socket budget.
// Set PROBE_OUT_DIR to keep a capped sample of raw frames. Recorded in docs/profiles/bitfinex/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUB = 'wss://api-pub.bitfinex.com/ws/2';
const API = 'https://api-pub.bitfinex.com/v2';
const OUT = process.env.PROBE_OUT_DIR;
const FLAG = { TIMESTAMP: 32768, SEQ_ALL: 65536, OB_CHECKSUM: 131072, BULK_UPDATES: 536870912 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hold = (defaultS) => Number(process.env.DURATION_S ?? defaultS) * 1_000;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const iso = (ms) => new Date(ms).toISOString();
let captured = 0;

function capture(name, text) {
  if (!OUT || captured > 4_000) return;
  captured++;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2_000) + '\n');
}

function open(label, { deflate = false } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(URL_PUB, { perMessageDeflate: deflate });
  const state = { ws, label, t0, openMs: null, closed: null, pings: 0, frames: 0 };
  ws.on('open', () => (state.openMs = Math.round(performance.now() - t0)));
  ws.on('ping', () => state.pings++);
  ws.on('close', (code, reason) => (state.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }));
  ws.on('error', (e) => log('socket_error', { label, message: e.message }));
  return state;
}

const waitOpen = (s) => new Promise((resolve, reject) => {
  if (s.ws.readyState === WebSocket.OPEN) return resolve();
  s.ws.once('open', resolve);
  s.ws.once('error', reject);
});

// One P-precision or R0 book kept from the snapshot and every update, checked against every checksum frame.
class Book {
  constructor(raw) {
    this.raw = raw;
    this.bids = new Map();
    this.asks = new Map();
    this.maxBids = 0;
    this.maxAsks = 0;
    this.ok = 0;
    this.bad = 0;
    this.updates = 0;
    this.deletes = 0;
  }
  apply(e) {
    if (this.raw) {
      // R0 entry is [orderId, price, amount], price 0 deletes the order.
      const [id, price, amount] = e;
      this.bids.delete(id);
      this.asks.delete(id);
      if (price === 0) this.deletes++;
      else (amount > 0 ? this.bids : this.asks).set(id, [price, amount]);
    } else {
      const [price, count, amount] = e;
      if (count > 0) (amount > 0 ? this.bids : this.asks).set(price, amount);
      else {
        this.deletes++;
        if (amount === 1) this.bids.delete(price);
        else if (amount === -1) this.asks.delete(price);
        else this.badDelete = (this.badDelete || 0) + 1;
      }
    }
    this.maxBids = Math.max(this.maxBids, this.bids.size);
    this.maxAsks = Math.max(this.maxAsks, this.asks.size);
  }
  sorted() {
    if (this.raw) {
      const b = [...this.bids.entries()].sort((x, y) => y[1][0] - x[1][0] || x[0] - y[0]);
      const a = [...this.asks.entries()].sort((x, y) => x[1][0] - y[1][0] || x[0] - y[0]);
      return { b: b.map(([id, [, amt]]) => [id, amt]), a: a.map(([id, [, amt]]) => [id, amt]) };
    }
    return { b: [...this.bids.entries()].sort((x, y) => y[0] - x[0]), a: [...this.asks.entries()].sort((x, y) => x[0] - y[0]) };
  }
  checksum(expected) {
    const { b, a } = this.sorted();
    const parts = [];
    for (let i = 0; i < 25; i++) {
      if (b[i]) parts.push(String(b[i][0]), String(b[i][1]));
      if (a[i]) parts.push(String(a[i][0]), String(a[i][1]));
    }
    const mine = crc32(parts.join(':')) | 0;
    if (mine === expected) this.ok++;
    else this.bad++;
    return mine === expected;
  }
}

// Routes every frame of one socket: events, snapshots, updates, heartbeats, checksums.
function attach(s, opts = {}) {
  const chans = new Map(); // chanId to { sub, book, frames, hb, firstAt, snapshotAt, lastHbAt, hbGaps, lastAt, maxGap }
  s.chans = chans;
  s.events = [];
  s.unknown = 0;
  s.bytes = 0;
  s.parseUs = 0;
  s.ws.on('message', (data) => {
    const text = data.toString();
    s.frames++;
    s.bytes += text.length;
    const p0 = performance.now();
    const msg = JSON.parse(text);
    s.parseUs += (performance.now() - p0) * 1000;
    const now = Date.now();
    if (!Array.isArray(msg)) {
      s.events.push(msg);
      if (msg.event === 'subscribed') {
        chans.set(msg.chanId, { sub: msg, book: msg.channel === 'book' ? new Book(msg.prec === 'R0') : null, frames: 0, hb: 0, cs: 0, subscribedAt: now, snapshotAt: null, hbGaps: [], lastHbAt: null, lastAt: null, maxGap: 0, seq: [], ts: [] });
      }
      capture(`${s.label}-events.jsonl`, text);
      return;
    }
    if (opts.flags && (s.rawSample ||= []).length < 6) s.rawSample.push(text.slice(0, 300));
    // With SEQ_ALL and TIMESTAMP every array frame ends in [..., seq, ts], heartbeats and checksums included.
    if (opts.flags) (s.allSeq ||= []).push(msg.at(opts.seqAt));
    const c = chans.get(msg[0]);
    if (!c) {
      s.unknown++;
      return;
    }
    c.frames++;
    if (c.lastAt) c.maxGap = Math.max(c.maxGap, now - c.lastAt);
    c.lastAt = now;
    if (c.frames <= 3 || (msg[1] === 'cs' && c.cs < 2)) capture(`${s.label}-${c.sub.channel}-${c.sub.symbol ?? c.sub.key}.jsonl`, text);
    if (msg[1] === 'hb') {
      c.hb++;
      if (c.lastHbAt) c.hbGaps.push(now - c.lastHbAt);
      c.lastHbAt = now;
      return;
    }
    if (msg[1] === 'cs') {
      c.cs++;
      if (c.lastCsAt) (c.csGaps ||= []).push(now - c.lastCsAt);
      c.lastCsAt = now;
      if (c.book && c.book.snapshotSeen) {
        const good = c.book.checksum(msg[2]);
        if (!good && c.book.bad <= 2) log('checksum_mismatch', { symbol: c.sub.symbol, len: c.sub.len, prec: c.sub.prec, frame: c.frames });
      }
      return;
    }
    if (c.book) {
      const body = msg[1];
      const isSnapshot = !c.book.snapshotSeen;
      if (isSnapshot) {
        c.book.snapshotSeen = true;
        c.snapshotAt = now;
        c.snapshot = body;
        for (const e of body) c.book.apply(e);
        return;
      }
      // With BULK_UPDATES an update is an array of entries, otherwise a single entry.
      const entries = Array.isArray(body[0]) ? body : [body];
      if (Array.isArray(body[0])) c.bulk = (c.bulk || 0) + 1;
      for (const e of entries) {
        c.book.updates++;
        c.book.apply(e);
      }
      return;
    }
    if (!c.first) c.first = msg;
    if (c.sub.channel === 'status') {
      const row = msg[1];
      const prev = c.last?.[1];
      c.distinctMts = (c.distinctMts || 0) + (prev && prev[0] === row[0] ? 0 : 1);
      c.markChanges = (c.markChanges || 0) + (prev && prev[14] !== row[14] ? 1 : 0);
      c.derivChanges = (c.derivChanges || 0) + (prev && prev[2] !== row[2] ? 1 : 0);
      c.accruedChanges = (c.accruedChanges || 0) + (prev && prev[8] !== row[8] ? 1 : 0);
      (c.mtsAge ||= []).push(now - row[0]);
    }
    c.last = msg;
    c.times = c.times || [];
    c.times.push(now);
  });
}

function send(s, obj) {
  s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function bookSummary(c) {
  const b = c.book;
  const snap = c.snapshot || [];
  const raw = b.raw;
  const amt = (e) => (raw ? e[2] : e[2]);
  const px = (e) => (raw ? e[1] : e[0]);
  const bidsSnap = snap.filter((e) => amt(e) > 0);
  const asksSnap = snap.filter((e) => amt(e) < 0);
  const desc = bidsSnap.every((e, i) => i === 0 || px(e) <= px(bidsSnap[i - 1]));
  const asc = asksSnap.every((e, i) => i === 0 || px(e) >= px(asksSnap[i - 1]));
  const bidsFirst = snap.findIndex((e) => amt(e) < 0) === bidsSnap.length || asksSnap.length === 0;
  const hbSorted = [...c.hbGaps].sort((x, y) => x - y);
  return {
    symbol: c.sub.symbol, prec: c.sub.prec, len: c.sub.len, freq: c.sub.freq, chanId: c.sub.chanId,
    snapshotMs: c.snapshotAt ? c.snapshotAt - c.subscribedAt : null, snapshotBids: bidsSnap.length, snapshotAsks: asksSnap.length, snapshotBidsDesc: desc, snapshotAsksAsc: asc, snapshotBidsFirst: bidsFirst,
    frames: c.frames, updates: b.updates, deletes: b.deletes, badDeletes: b.badDelete || 0, bulkFrames: c.bulk || 0, hb: c.hb, hbGapMs: hbSorted.length ? [hbSorted[0], hbSorted.at(-1)] : null, maxFrameGapMs: c.maxGap,
    cs: c.cs, csGapMs: c.csGaps ? [Math.min(...c.csGaps), [...c.csGaps].sort((x, y) => x - y)[Math.floor(c.csGaps.length / 2)], Math.max(...c.csGaps)] : null, csOk: b.ok, csBad: b.bad, maxBids: b.maxBids, maxAsks: b.maxAsks, heldBids: b.bids.size, heldAsks: b.asks.size,
  };
}

async function restBook(symbol, len) {
  const res = await fetch(`${API}/book/${symbol}/P0?len=${len}`);
  return res.json();
}

async function book() {
  const s = open('book');
  attach(s);
  await waitOpen(s);
  log('open', { openMs: s.openMs });
  await sleep(300);
  send(s, { event: 'conf', flags: FLAG.OB_CHECKSUM });
  const subs = [
    { channel: 'book', symbol: 'tBTCF0:USTF0', prec: 'P0', freq: 'F0', len: '25' },
    { channel: 'book', symbol: 'tETHF0:USTF0', prec: 'P0', freq: 'F0', len: '25' },
    { channel: 'book', symbol: 'tDOGEF0:USTF0', prec: 'P0', freq: 'F0', len: '25' },
    { channel: 'book', symbol: 'tXTZF0:USTF0', prec: 'P0', freq: 'F0', len: '25' },
    { channel: 'book', symbol: 'tETHF0:USTF0', prec: 'P0', freq: 'F0', len: '100' },
    { channel: 'book', symbol: 'tBTCF0:USTF0', prec: 'R0', len: '25' },
    { channel: 'book', symbol: 'tEUROPE50IXF0:USTF0', prec: 'P0', freq: 'F0', len: '25' },
    { channel: 'book', symbol: 'tTESTXTZF0:TESTUSDTF0', prec: 'P0', freq: 'F0', len: '25' },
    { channel: 'book', symbol: 'tETHF0:BTCF0', prec: 'P0', freq: 'F0', len: '25' },
    { channel: 'status', key: 'deriv:tBTCF0:USTF0' },
    { channel: 'status', key: 'deriv:tXTZF0:USTF0' },
    { channel: 'ticker', symbol: 'tBTCF0:USTF0' },
  ];
  for (const sub of subs) send(s, { event: 'subscribe', ...sub });
  await sleep(3_000);
  // Compare sizes at the same prices with a REST read, which is the size unit check.
  const rest = await restBook('tBTCF0:USTF0', 25);
  const btc = [...s.chans.values()].find((c) => c.sub.symbol === 'tBTCF0:USTF0' && c.sub.prec === 'P0');
  if (btc) {
    const { b, a } = btc.book.sorted();
    const restMap = new Map(rest.map((e) => [e[0], e[2]]));
    let same = 0;
    let samePrice = 0;
    for (const [p, amt] of [...b.slice(0, 20), ...a.slice(0, 20).map(([pp, aa]) => [pp, aa])]) {
      if (restMap.has(p)) {
        samePrice++;
        if (restMap.get(p) === amt) same++;
      }
    }
    log('size_unit', { socketTop: [b[0], a[0]], restTop: [rest.find((e) => e[2] > 0), rest.find((e) => e[2] < 0)], pricesInBoth: samePrice, equalAmount: same, of: 40 });
  }
  await sleep(hold(72));
  for (const e of s.events) if (e.event !== 'subscribed') log('event', { e });
  const subEvents = s.events.filter((e) => e.event === 'subscribed');
  log('subscribed_sample', { e: subEvents[0], count: subEvents.length });
  for (const c of s.chans.values()) {
    if (c.book) log('book_summary', bookSummary(c));
    else {
      const gaps = (c.times || []).slice(1).map((t, i) => t - c.times[i]).sort((x, y) => x - y);
      const ages = (c.mtsAge || []).sort((x, y) => x - y);
      log('channel_summary', { channel: c.sub.channel, key: c.sub.key ?? c.sub.symbol, distinctMts: c.distinctMts, markChanges: c.markChanges, derivChanges: c.derivChanges, accruedChanges: c.accruedChanges, mtsAgeMs: ages.length ? [ages[0], ages[Math.floor(ages.length / 2)], ages.at(-1)] : null, frames: c.frames, hb: c.hb, dataFrames: (c.times || []).length, gapMs: gaps.length ? { min: gaps[0], median: gaps[Math.floor(gaps.length / 2)], max: gaps.at(-1) } : null, first: JSON.stringify(c.first)?.slice(0, 400) });
    }
  }
  log('socket', { frames: s.frames, bytes: s.bytes, parseUsPerFrame: Math.round(s.parseUs / Math.max(1, s.frames)), pings: s.pings, unknown: s.unknown });
  s.ws.close();
}

async function batch() {
  const res = await fetch(`${API}/conf/pub:list:pair:futures`);
  const [list] = await res.json();
  const symbols = list.filter((x) => x.endsWith(':USTF0')).slice(0, Number(process.env.BATCH_N ?? 31)).map((x) => 't' + x);
  const s = open('batch');
  attach(s);
  await waitOpen(s);
  send(s, { event: 'conf', flags: FLAG.OB_CHECKSUM });
  for (const symbol of symbols) send(s, { event: 'subscribe', channel: 'book', symbol, prec: 'P0', freq: 'F0', len: '25' });
  const t0 = Date.now();
  const seconds = hold(60) / 1_000;
  await sleep(seconds * 1_000);
  const books = [...s.chans.values()].filter((c) => c.book);
  const errors = s.events.filter((e) => e.event === 'error');
  log('batch_subscribe', { sent: symbols.length, subscribed: books.length, errors: errors.map((e) => ({ code: e.code, msg: e.msg, symbol: e.symbol })) });
  const sum = (f) => books.reduce((a, c) => a + f(c), 0);
  const snapshotsMs = books.map((c) => c.snapshotAt - c.subscribedAt).sort((a, b) => a - b);
  log('batch_errors_sample', { first: errors.slice(0, 2), closed: s.closed });
  log('batch_totals', { seconds: (Date.now() - t0) / 1000, frames: s.frames, framesPerSecond: Math.round(s.frames / seconds), bytesPerSecond: Math.round(s.bytes / seconds), bytesPerFrame: Math.round(s.bytes / s.frames), parseUsPerFrame: Math.round(s.parseUs / s.frames), updates: sum((c) => c.book.updates), cs: sum((c) => c.cs), csOk: sum((c) => c.book.ok), csBad: sum((c) => c.book.bad), snapshotMs: [snapshotsMs[0], snapshotsMs.at(-1)], hbOnly: books.filter((c) => c.book.updates === 0).map((c) => c.sub.symbol), shallow: books.filter((c) => c.book.maxBids < 25 || c.book.maxAsks < 25).map((c) => `${c.sub.symbol} ${c.book.maxBids}/${c.book.maxAsks}`) });
  s.ws.close();
}

async function flags() {
  // Socket A carries the recommended flags, SEQ_ALL and OB_CHECKSUM. Socket B adds TIMESTAMP and BULK_UPDATES, to see what each appends.
  for (const [label, value] of [['seq-cs', FLAG.SEQ_ALL + FLAG.OB_CHECKSUM], ['ts-seq-bulk-cs', FLAG.TIMESTAMP + FLAG.SEQ_ALL + FLAG.BULK_UPDATES + FLAG.OB_CHECKSUM]]) {
    const s = open(label);
    const withTs = (value & FLAG.TIMESTAMP) !== 0;
    attach(s, { flags: true, seqAt: withTs ? -2 : -1 });
    await waitOpen(s);
    send(s, { event: 'conf', flags: value });
    send(s, { event: 'subscribe', channel: 'book', symbol: 'tBTCF0:USTF0', prec: 'P0', freq: 'F0', len: '25' });
    send(s, { event: 'subscribe', channel: 'book', symbol: 'tETHF0:USTF0', prec: 'P0', freq: 'F0', len: '25' });
    await sleep(12_000);
    const all = s.allSeq.filter((x) => typeof x === 'number');
    let socketGaps = 0;
    for (let i = 1; i < all.length; i++) if (all[i] !== all[i - 1] + 1) socketGaps++;
    const books = [...s.chans.values()];
    log('flags_raw', { label, sample: s.rawSample.map((t) => t.slice(0, 160)) });
    log('flags_socket_seq', { label, conf: s.events.find((e) => e.event === 'conf'), frames: all.length, first: all.slice(0, 3), last: all.at(-1), gapsAcrossSocket: socketGaps, nonNumeric: s.allSeq.length - all.length, updates: books.reduce((a, c) => a + c.book.updates, 0), bulkFrames: books.reduce((a, c) => a + (c.bulk || 0), 0), csOk: books.reduce((a, c) => a + c.book.ok, 0), csBad: books.reduce((a, c) => a + c.book.bad, 0) });
    s.ws.close();
  }
}

async function silence() {
  const a = open('silent-nothing');
  const bSock = open('silent-subscribed');
  const cSock = open('ping-only');
  for (const s of [a, bSock, cSock]) attach(s);
  await Promise.all([a, bSock, cSock].map(waitOpen));
  send(bSock, { event: 'subscribe', channel: 'book', symbol: 'tXTZF0:USTF0', prec: 'P0', freq: 'F0', len: '25' });
  const pongs = [];
  cSock.ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.event === 'pong') pongs.push(Date.now() - m.cid);
  });
  const timer = setInterval(() => cSock.ws.readyState === WebSocket.OPEN && send(cSock, { event: 'ping', cid: Date.now() }), 20_000);
  const t0 = Date.now();
  while (Date.now() - t0 < hold(120) && [a, bSock, cSock].some((s) => !s.closed)) await sleep(1_000);
  clearInterval(timer);
  for (const s of [a, bSock, cSock]) {
    const hbGaps = [...s.chans.values()].flatMap((c) => c.hbGaps);
    log('silence', { label: s.label, openMs: s.openMs, closed: s.closed, stillOpenAtS: s.closed ? null : Math.round((Date.now() - t0) / 1000), frames: s.frames, serverProtocolPings: s.pings, events: s.events.map((e) => e.event + (e.code ? ':' + e.code : '')), hbGapMs: hbGaps.length ? [Math.min(...hbGaps), Math.max(...hbGaps)] : null });
    if (!s.closed) s.ws.close();
  }
  log('pong_rtt_ms', { pongs });
}

async function errors() {
  const s = open('errors');
  attach(s);
  await waitOpen(s);
  const cases = [
    { event: 'subscribe', channel: 'book', symbol: 'tNOPEF0:USTF0', prec: 'P0', len: '25' },
    { event: 'subscribe', channel: 'book', symbol: 'BTCF0:USTF0', prec: 'P0', len: '25' },
    { event: 'subscribe', channel: 'book', symbol: 'tBTCF0:USTF0', prec: 'P0', len: '7' },
    { event: 'subscribe', channel: 'book', symbol: 'tBTCF0:USTF0', prec: 'P9', len: '25' },
    { event: 'subscribe', channel: 'nope', symbol: 'tBTCF0:USTF0' },
    { event: 'subscribe', channel: 'book', symbol: 'tDOGEF0:USTF0', prec: 'P0', len: '25' },
    { event: 'subscribe', channel: 'book', symbol: 'tDOGEF0:USTF0', prec: 'P0', len: '25' },
    { event: 'subscribe', channel: 'status', key: 'deriv:tNOPEF0:USTF0' },
    { event: 'unsubscribe', chanId: 123456789 },
    { event: 'nope' },
  ];
  for (const c of cases) {
    send(s, c);
    await sleep(500);
  }
  send(s, 'not json');
  await sleep(3_000);
  for (const e of s.events) log('error_event', { e: JSON.stringify(e).slice(0, 300) });
  const quietNope = [...s.chans.values()].filter((c) => c.sub.symbol === 'tNOPEF0:USTF0' || c.sub.key === 'deriv:tNOPEF0:USTF0').map((c) => ({ key: c.sub.symbol ?? c.sub.key, frames: c.frames, snapshot: JSON.stringify(c.snapshot ?? c.first)?.slice(0, 100) }));
  log('unknown_symbol_channels', { quietNope, closed: s.closed });
  s.ws.close();
}

async function deflate() {
  const s = open('deflate', { deflate: true });
  const headers = await new Promise((resolve) => s.ws.on('upgrade', (res) => resolve(res.headers)));
  await waitOpen(s);
  log('deflate', { offered: 'permessage-deflate', negotiated: headers['sec-websocket-extensions'] ?? null, server: headers.server ?? null, cfRay: headers['cf-ray'] ? 'present' : null, openMs: s.openMs });
  s.ws.close();
}

const modes = { book, batch, flags, silence, errors, deflate };
const mode = process.argv[2] ?? 'book';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: iso(Date.now()) });
await modes[mode]();
log('end', { mode, at: iso(Date.now()) });
setTimeout(() => process.exit(0), 500);
