// CoinTR public spot WebSocket probe: the books channel with its checksum, the fixed-depth channels, level order, size unit, errors, a batch of pairs on one socket, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/cointr/ws-probe.mjs [book|errors|batch|silence|sync|deflate]
//   book     books on a busy USDT pair, a TRY pair, a second USDT pair and a quiet pair for 60 s, books15, books5, books1, ticker and trade on BTCUSDT, with a REST compare at the end.
//   errors   unknown symbol, futures instType, unknown channel, duplicate subscribe, non-JSON text and the string ping. About 20 s.
//   batch    books on every online USDT pair, in subscribe frames of 45 pairs, on one socket for 60 s.
//   silence  three sockets that differ only in what they subscribe and send, for up to 120 s.
//   sync     books and trade on BTCUSDT and ETHUSDT for about 60 s beside a REST top-five read of each pair every second, and trade prints against the socket's spread.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/cointr/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.cointr.com/v2/ws/public';
const API = 'https://api.cointr.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const arg = (channel, instId) => ({ instType: 'SPOT', channel, instId });
const sub = (args) => JSON.stringify({ op: 'subscribe', args });

// Book frames are kept with their first three levels per side, so a captured snapshot stays valid JSON.
function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  let out = text.slice(0, 1500);
  try {
    const msg = JSON.parse(text);
    const d = msg.data?.[0];
    if (d?.bids) {
      msg.data[0] = { ...d, bids: d.bids.slice(0, 3), asks: d.asks.slice(0, 3), levelsOnWire: [d.bids.length, d.asks.length] };
      out = JSON.stringify(msg);
    }
  } catch {
    // not JSON, kept as text
  }
  appendFileSync(join(OUT, name), out + '\n');
}

function open(opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, ...opts });
  const ready = new Promise((resolve, reject) => {
    ws.once('open', () => resolve(Math.round(performance.now() - t0)));
    ws.once('error', reject);
  });
  return { ws, ready };
}

function median(a) {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

// A local book that keeps the wire strings, because the checksum is computed over the original text of price and size.
class LocalBook {
  bids = new Map();
  asks = new Map();
  reset(bids, asks) {
    this.bids.clear();
    this.asks.clear();
    this.apply(bids, asks);
  }
  apply(bids, asks) {
    for (const [p, s] of bids) this.set(this.bids, p, s);
    for (const [p, s] of asks) this.set(this.asks, p, s);
  }
  set(side, p, s) {
    if (Number(s) === 0) side.delete(Number(p));
    else side.set(Number(p), [p, s]);
  }
  sorted() {
    const b = [...this.bids.entries()].sort((x, y) => y[0] - x[0]).map((e) => e[1]);
    const a = [...this.asks.entries()].sort((x, y) => x[0] - y[0]).map((e) => e[1]);
    return { b, a };
  }
  checksum() {
    const { b, a } = this.sorted();
    const parts = [];
    for (let i = 0; i < 25; i++) {
      if (i < b.length) parts.push(`${b[i][0]}:${b[i][1]}`);
      if (i < a.length) parts.push(`${a[i][0]}:${a[i][1]}`);
    }
    return crc32(parts.join(':')) | 0;
  }
}

function orderBad(levels, desc) {
  let bad = 0;
  for (let i = 1; i < levels.length; i++) {
    const x = Number(levels[i - 1][0]);
    const y = Number(levels[i][0]);
    if (desc ? y >= x : y <= x) bad++;
  }
  return bad;
}

function newStats() {
  return { snapshots: 0, updates: 0, emptyUpdates: 0, checksumOk: 0, checksumBad: 0, checksumZero: 0, bidDisorder: 0, askDisorder: 0, gaps: 0, seqSeen: 0, keys: new Set(), gapsMs: [], last: 0, maxLevels: [0, 0], snapLevels: [], tsAge: [], deltaLevels: [] };
}

function handleBook(stats, books, msg, recv) {
  const id = msg.arg.instId;
  const d = msg.data[0];
  const st = (stats[id] ??= newStats());
  const book = (books[id] ??= new LocalBook());
  Object.keys(d).forEach((k) => st.keys.add(k));
  if (st.last) st.gapsMs.push(recv - st.last);
  st.last = recv;
  st.tsAge.push(recv - Number(d.ts));
  if (d.seq !== undefined) {
    st.seqSeen++;
    if (st.lastSeq !== undefined && d.pseq !== undefined && d.pseq !== st.lastSeq) st.gaps++;
    st.lastSeq = d.seq;
  }
  if (msg.action === 'snapshot') {
    st.snapshots++;
    st.snapLevels.push([d.bids.length, d.asks.length]);
    st.bidDisorder += orderBad(d.bids, true);
    st.askDisorder += orderBad(d.asks, false);
    book.reset(d.bids, d.asks);
  } else {
    st.updates++;
    if (d.bids.length === 0 && d.asks.length === 0) st.emptyUpdates++;
    st.deltaLevels.push(d.bids.length + d.asks.length);
    st.bidDisorder += orderBad(d.bids, true);
    st.askDisorder += orderBad(d.asks, false);
    book.apply(d.bids, d.asks);
  }
  st.maxLevels = [Math.max(st.maxLevels[0], book.bids.size), Math.max(st.maxLevels[1], book.asks.size)];
  if (d.checksum === 0 || d.checksum === undefined) st.checksumZero++;
  else if (book.checksum() === d.checksum) st.checksumOk++;
  else st.checksumBad++;
}

function summarize(stats) {
  const out = {};
  for (const [id, st] of Object.entries(stats)) {
    out[id] = {
      snapshots: st.snapshots,
      updates: st.updates,
      emptyUpdates: st.emptyUpdates,
      checksumOk: st.checksumOk,
      checksumBad: st.checksumBad,
      checksumZero: st.checksumZero,
      seqSeen: st.seqSeen,
      seqGaps: st.gaps,
      keys: [...st.keys].join(','),
      snapLevels: st.snapLevels.slice(0, 3),
      maxLevels: st.maxLevels,
      bidDisorder: st.bidDisorder,
      askDisorder: st.askDisorder,
      intervalMs: { median: median(st.gapsMs), max: st.gapsMs.length ? Math.max(...st.gapsMs) : null, under100: st.gapsMs.filter((x) => x < 100).length },
      tsAgeMs: { median: median(st.tsAge), max: st.tsAge.length ? Math.max(...st.tsAge) : null },
      deltaLevelsMedian: median(st.deltaLevels),
    };
  }
  return out;
}

async function book() {
  const tick = await (await fetch(`${API}/api/v2/spot/market/tickers`)).json();
  const usdt = tick.data.filter((x) => x.symbol.endsWith('USDT') && !x.symbol.endsWith('SUSDT') && Number(x.usdtVolume) > 0).sort((a, b) => Number(b.usdtVolume) - Number(a.usdtVolume));
  const quiet = usdt.at(-3).symbol;
  const pairs = ['BTCUSDT', 'USDTTRY', 'ETHUSDT', quiet];
  log('pairs', { pairs });
  const { ws, ready } = open();
  const openMs = await ready;
  log('open', { ms: openMs });
  const stats = {};
  const books = {};
  const other = {};
  const firstSeen = {};
  let protoPings = 0;
  ws.on('ping', () => protoPings++);
  const t0 = Date.now();
  ws.on('message', (raw) => {
    const recv = Date.now();
    const text = raw.toString();
    if (text === 'pong') {
      other.pong = (other.pong ?? 0) + 1;
      return;
    }
    const msg = JSON.parse(text);
    const key = msg.event ? `event:${msg.event}:${msg.arg?.channel ?? ''}` : `${msg.arg?.channel}:${msg.action ?? 'push'}`;
    if (!firstSeen[key]) {
      firstSeen[key] = recv - t0;
      capture(`first-${key.replace(/[^a-z0-9]/gi, '_')}-${msg.arg?.instId ?? ''}.json`, text);
    }
    if (msg.arg?.channel === 'books' && msg.data) {
      if (msg.action === 'update' && stats[msg.arg.instId]?.updates === 3) capture(`books-delta-${msg.arg.instId}.json`, text);
      handleBook(stats, books, msg, recv);
      return;
    }
    if (msg.data) {
      const k = `${msg.arg.channel}:${msg.arg.instId}`;
      const o = (other[k] ??= { frames: 0, actions: {}, levels: [], disorder: 0, gaps: [], last: 0 });
      o.frames++;
      o.actions[msg.action ?? 'none'] = (o.actions[msg.action ?? 'none'] ?? 0) + 1;
      if (o.last) o.gaps.push(recv - o.last);
      o.last = recv;
      const d = msg.data[0];
      if (d?.bids) {
        o.levels.push(`${d.bids.length}/${d.asks.length}`);
        o.disorder += orderBad(d.bids, true) + orderBad(d.asks, false);
        o.checksum = d.checksum;
        o.keys = Object.keys(d).join(',');
      }
      return;
    }
    other[key] = (other[key] ?? 0) + 1;
  });
  ws.send(sub(pairs.map((p) => arg('books', p))));
  ws.send(sub([arg('books15', 'BTCUSDT'), arg('books5', 'BTCUSDT'), arg('books1', 'BTCUSDT'), arg('ticker', 'BTCUSDT'), arg('trade', 'BTCUSDT')]));
  const pinger = setInterval(() => ws.send('ping'), 20_000);
  const pingSent = Date.now();
  await sleep(60_000);
  clearInterval(pinger);
  // Compare the socket book at the touch with a REST read taken now.
  const rest = await (await fetch(`${API}/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=20`)).json();
  const local = books.BTCUSDT.sorted();
  const restBids = rest.data.bids.slice(0, 10).map((l) => l.join(' '));
  const wsBids = local.b.slice(0, 10).map((l) => l.join(' '));
  const same = restBids.filter((x) => wsBids.includes(x)).length;
  log('rest_compare', { sym: 'BTCUSDT', restTop: rest.data.bids.slice(0, 2), wsTop: local.b.slice(0, 2), sameOfTop10Bids: same, restTs: rest.data.ts });
  ws.close();
  log('books', { perPair: summarize(stats) });
  for (const [k, o] of Object.entries(other)) {
    if (typeof o === 'number') log('other', { key: k, count: o });
    else log('other', { key: k, frames: o.frames, actions: o.actions, levels: [...new Set(o.levels)].slice(0, 5), disorder: o.disorder, checksum: o.checksum, keys: o.keys, intervalMedianMs: median(o.gaps), intervalMaxMs: o.gaps.length ? Math.max(...o.gaps) : null });
  }
  log('first_seen_ms', { firstSeen, protoPings, pingSentAt: pingSent - t0 });
}

async function errors() {
  const { ws, ready } = open();
  await ready;
  const seen = [];
  const t0 = Date.now();
  let pingAt = 0;
  ws.on('message', (raw) => {
    const text = raw.toString();
    if (text === 'pong') {
      seen.push({ at: Date.now() - t0, pong: true, rttMs: Date.now() - pingAt });
      return;
    }
    const msg = JSON.parse(text);
    if (msg.data) {
      const k = `${msg.arg.instType}:${msg.arg.channel}:${msg.arg.instId}`;
      if (msg.action === 'snapshot' || !seen.some((s) => s.data === k)) seen.push({ at: Date.now() - t0, data: k, action: msg.action });
      return;
    }
    seen.push({ at: Date.now() - t0, frame: text.slice(0, 300) });
  });
  ws.on('close', (code, reason) => seen.push({ at: Date.now() - t0, close: code, reason: reason.toString() }));
  const steps = [
    ['unknown symbol', sub([arg('books', 'NOPEUSDT')])],
    ['gray symbol', sub([arg('books', 'REEFTRY')])],
    ['futures instType', JSON.stringify({ op: 'subscribe', args: [{ instType: 'USDT-FUTURES', channel: 'books', instId: 'BTCUSDT' }] })],
    ['MC instType', JSON.stringify({ op: 'subscribe', args: [{ instType: 'MC', channel: 'books', instId: 'BTCUSDT' }] })],
    ['unknown channel', sub([arg('books400', 'BTCUSDT')])],
    ['lowercase symbol', sub([arg('books5', 'btcusdt')])],
    ['duplicate subscribe first', sub([arg('books5', 'ETHUSDT')])],
    ['duplicate subscribe second', sub([arg('books5', 'ETHUSDT')])],
    ['unsubscribe', JSON.stringify({ op: 'unsubscribe', args: [arg('books5', 'ETHUSDT')] })],
    ['non JSON', 'hello'],
    ['string ping', 'ping'],
    ['JSON ping', JSON.stringify({ op: 'ping' })],
  ];
  for (const [name, frame] of steps) {
    if (frame === 'ping') pingAt = Date.now();
    seen.push({ at: Date.now() - t0, sent: name });
    if (ws.readyState === ws.OPEN) ws.send(frame);
    await sleep(1_200);
  }
  await sleep(5_000);
  ws.close();
  await sleep(300);
  for (const s of seen) log('errors', s);
}

async function batch() {
  const syms = await (await fetch(`${API}/api/v2/spot/public/symbols`)).json();
  const pairs = syms.data.filter((s) => s.quoteCoin === 'USDT' && s.status === 'online').map((s) => s.symbol);
  const { ws, ready } = open();
  const openMs = await ready;
  const stats = {};
  const books = {};
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  const perSecond = [];
  let secFrames = 0;
  const errs = [];
  let acks = 0;
  const t0 = Date.now();
  ws.on('message', (raw) => {
    frames++;
    secFrames++;
    bytes += raw.length;
    const text = raw.toString();
    if (text === 'pong') return;
    const p0 = performance.now();
    const msg = JSON.parse(text);
    parseUs += (performance.now() - p0) * 1000;
    if (msg.event === 'subscribe') acks++;
    else if (msg.event === 'error') errs.push(text.slice(0, 200));
    else if (msg.arg?.channel === 'books') handleBook(stats, books, msg, Date.now());
  });
  let closed = null;
  ws.on('close', (code) => (closed = { code, atMs: Date.now() - t0 }));
  const tick = setInterval(() => {
    perSecond.push(secFrames);
    secFrames = 0;
  }, 1000);
  const pinger = setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 20_000);
  for (let i = 0; i < pairs.length; i += 45) {
    const frame = sub(pairs.slice(i, i + 45).map((p) => arg('books', p)));
    ws.send(frame);
    log('batch_frame', { from: i, n: Math.min(45, pairs.length - i), bytes: frame.length });
    await sleep(300);
  }
  await sleep(60_000);
  clearInterval(tick);
  clearInterval(pinger);
  ws.close();
  const s = summarize(stats);
  const all = Object.values(s);
  const snapTimes = Object.values(stats).filter((x) => x.snapshots > 0).length;
  log('batch', {
    pairs: pairs.length,
    openMs,
    acks,
    errors: errs.slice(0, 3),
    closed,
    pairsWithSnapshot: snapTimes,
    frames,
    framesPerSecond: { mean: Math.round(frames / 60), median: median(perSecond), max: Math.max(...perSecond) },
    bytesPerSecond: Math.round(bytes / 60),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: Number((parseUs / frames).toFixed(1)),
    snapshots: all.reduce((x, y) => x + y.snapshots, 0),
    updates: all.reduce((x, y) => x + y.updates, 0),
    checksumOk: all.reduce((x, y) => x + y.checksumOk, 0),
    checksumBad: all.reduce((x, y) => x + y.checksumBad, 0),
    checksumZero: all.reduce((x, y) => x + y.checksumZero, 0),
    seqGaps: all.reduce((x, y) => x + y.seqGaps, 0),
    bidDisorder: all.reduce((x, y) => x + y.bidDisorder, 0),
    askDisorder: all.reduce((x, y) => x + y.askDisorder, 0),
    emptyUpdates: all.reduce((x, y) => x + y.emptyUpdates, 0),
    maxQuietMs: Math.max(...all.map((x) => x.intervalMs.max ?? 0)),
    snapshotLevelsMin: Math.min(...all.flatMap((x) => x.snapLevels.map((l) => Math.min(...l)))),
    snapshotLevelsMax: Math.max(...all.flatMap((x) => x.snapLevels.map((l) => Math.max(...l)))),
  });
  const bad = Object.entries(s).filter(([, v]) => v.checksumBad > 0).map(([k, v]) => `${k}:${v.checksumBad}/${v.checksumOk}`);
  log('batch_checksum_bad_pairs', { pairs: bad.slice(0, 10), count: bad.length });
  const quiet = Object.entries(s).sort((a, b) => (b[1].intervalMs.max ?? 0) - (a[1].intervalMs.max ?? 0)).slice(0, 5).map(([k, v]) => `${k}:${v.updates}:${v.intervalMs.max}`);
  log('batch_quietest', { pairs: quiet });
}

async function silence() {
  const quiet = 'RVVUSDT';
  const variants = [
    ['no subscribe, no send', null, false],
    ['books on a quiet pair, no ping', quiet, false],
    ['books on a quiet pair, ping every 20 s', quiet, true],
  ];
  const results = [];
  await Promise.all(
    variants.map(async ([name, pair, ping]) => {
      const { ws, ready } = open();
      await ready;
      const t0 = Date.now();
      let frames = 0;
      let pongs = 0;
      let protoPings = 0;
      let lastFrame = t0;
      let maxGap = 0;
      ws.on('ping', () => protoPings++);
      ws.on('message', (raw) => {
        const now = Date.now();
        maxGap = Math.max(maxGap, now - lastFrame);
        lastFrame = now;
        if (raw.toString() === 'pong') pongs++;
        else frames++;
      });
      if (pair) ws.send(sub([arg('books', pair)]));
      const timer = ping ? setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 20_000) : null;
      const closed = await Promise.race([
        new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: reason.toString(), atMs: Date.now() - t0 }))),
        sleep(120_000).then(() => null),
      ]);
      if (timer) clearInterval(timer);
      if (!closed) ws.terminate();
      results.push({ name, closed: closed ?? 'open at 120 s', frames, pongs, protoPings, maxGapMs: maxGap });
    }),
  );
  for (const r of results) log('silence', r);
}

// books on two pairs beside a REST read of the same pairs every second, to see whether a book the socket leaves alone is also still on REST.
async function sync() {
  const pairs = ['BTCUSDT', 'ETHUSDT'];
  const { ws, ready } = open();
  await ready;
  const stats = {};
  const books = {};
  const trades = {};
  ws.on('message', (raw) => {
    const text = raw.toString();
    if (text === 'pong') return;
    const msg = JSON.parse(text);
    if (msg.arg?.channel === 'books' && msg.data) handleBook(stats, books, msg, Date.now());
    if (msg.arg?.channel === 'trade' && msg.action === 'update') {
      const t = (trades[msg.arg.instId] ??= { frames: 0, insideSpread: 0, prints: 0, minSize: Infinity, maxSize: 0 });
      t.frames++;
      const top = books[msg.arg.instId]?.sorted();
      for (const d of msg.data) {
        t.prints++;
        t.minSize = Math.min(t.minSize, Number(d.size));
        t.maxSize = Math.max(t.maxSize, Number(d.size));
        if (top && top.b[0] && top.a[0] && Number(d.price) > Number(top.b[0][0]) && Number(d.price) < Number(top.a[0][0])) t.insideSpread++;
      }
    }
  });
  ws.send(sub([...pairs.map((p) => arg('books', p)), ...pairs.map((p) => arg('trade', p))]));
  const pinger = setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 20_000);
  const rest = Object.fromEntries(pairs.map((p) => [p, { reads: 0, changes: 0, last: null, matchesSocket: 0 }]));
  for (let i = 0; i < 60; i++) {
    for (const p of pairs) {
      const r = await (await fetch(`${API}/api/v2/spot/market/orderbook?symbol=${p}&type=step0&limit=5`)).json();
      // REST drops trailing zeros from prices ("2762" against the socket's "2762.00"), so the two are compared as numbers.
      const num = (levels) => levels.map(([p, q]) => [Number(p), Number(q)]);
      const key = JSON.stringify([num(r.data.bids), num(r.data.asks)]);
      const s = rest[p];
      s.reads++;
      if (s.last !== null && key !== s.last) s.changes++;
      s.last = key;
      const local = books[p]?.sorted();
      if (local && JSON.stringify([num(local.b.slice(0, 5)), num(local.a.slice(0, 5))]) === key) s.matchesSocket++;
    }
    await sleep(600);
  }
  clearInterval(pinger);
  ws.close();
  const s = summarize(stats);
  for (const p of pairs) {
    log('sync', { pair: p, socketUpdates: s[p]?.updates, socketNonEmptyUpdates: (s[p]?.updates ?? 0) - (s[p]?.emptyUpdates ?? 0), socketChecksumOk: s[p]?.checksumOk, socketChecksumBad: s[p]?.checksumBad, restReads: rest[p].reads, restTop5Changes: rest[p].changes, restEqualsSocketTop5: rest[p].matchesSocket, trades: trades[p] });
  }
}

async function deflate() {
  const { ws, ready } = open({ perMessageDeflate: true });
  let ext = null;
  ws.on('upgrade', (res) => (ext = res.headers['sec-websocket-extensions'] ?? null));
  const ms = await ready;
  log('deflate', { openMs: ms, negotiated: ext, wsExtensions: ws.extensions });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, sync, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
