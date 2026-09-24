// Pionex public WebSocket probe for perpetuals: ORDERBOOK snapshot and sequence, level order and window, size unit against REST depth, DEPTH and INDEX cadence, keepalive, silence, errors, and a batch of perpetuals on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Client frames are sent at most four per second per connection, inside the documented five.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/pionex/ws-probe.mjs [book|errors|batch|silence|deflate]
//   book     ORDERBOOK on five perps, DEPTH 20 on two, INDEX on two, TRADE on one, for 60 s, a second socket's snapshot against the book built from deltas, stalls over 5 s, and a REST depth compare. About 65 s.
//   errors   unknown, spot and malformed subscriptions, a duplicate, a symbol list, and text that is not JSON. About 15 s.
//   batch    ORDERBOOK on 100 USDT perps on one connection: subscribe for 25 s, then 35 s of counting frames, gaps and busy streams that stall. About 62 s.
//   silence  three sockets that differ in subscription and in answering the server PING, for up to 75 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/pionex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.pionex.com/wsPub';
const API = 'https://api.pionex.com';
const SEND_GAP_MS = 250;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const trim = (text, n = 600) => (text.length > n ? text.slice(0, n) + '…' : text);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), trim(text, 2000) + '\n');
}

const stats = (xs) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

function open(label, options = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, ...options });
  const queue = [];
  let sending = false;
  const sock = {
    ws,
    label,
    openedMs: null,
    closed: null,
    sentAt: new Map(), // frame text to the time it left the queue
    send(obj) {
      queue.push(typeof obj === 'string' ? obj : JSON.stringify(obj));
      if (!sending) pump();
    },
  };
  async function pump() {
    sending = true;
    while (queue.length > 0 && ws.readyState === WebSocket.OPEN) {
      const text = queue.shift();
      ws.send(text);
      sock.sentAt.set(text, Date.now());
      await sleep(SEND_GAP_MS);
    }
    sending = false;
  }
  sock.ready = new Promise((resolve, reject) => {
    ws.once('open', () => {
      sock.openedMs = Date.now() - t0;
      if (queue.length > 0) pump();
      resolve();
    });
    ws.once('error', reject);
  });
  ws.on('upgrade', (res) => {
    sock.extensions = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('close', (code, reason) => {
    sock.closed = { code, reason: reason.toString(), afterMs: Date.now() - t0 };
  });
  ws.on('error', (err) => {
    sock.error = String(err.message ?? err);
  });
  return sock;
}

async function tickers() {
  const res = await fetch(`${API}/api/v1/market/tickers?type=PERP`);
  const body = await res.json();
  return body.data.tickers;
}

async function restDepth(symbol, limit) {
  const res = await fetch(`${API}/api/v1/market/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  const body = await res.json();
  return { at: Date.now(), ...body.data };
}

// Keeps three levels per side so a frame can be quoted whole, in the key order the server sent.
function compact(msg, text) {
  if (msg.data && Array.isArray(msg.data.bids)) {
    return JSON.stringify({ ...msg, data: { ...msg.data, bids: msg.data.bids.slice(0, 3), asks: msg.data.asks.slice(0, 3) } });
  }
  return trim(text, 700);
}

function newBook() {
  return { bids: new Map(), asks: new Map(), number: null };
}

function applySide(map, levels) {
  for (const [p, s] of levels) {
    if (Number(s) === 0) map.delete(p);
    else map.set(p, s);
  }
}

function isSorted(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (dir === 'desc' ? b >= a : b <= a) return false;
  }
  return true;
}

function closestByTs(h, ts) {
  let bestEntry = null;
  for (const e of h.values()) {
    if (bestEntry === null || Math.abs(e.ts - ts) < Math.abs(bestEntry.ts - ts)) bestEntry = e;
  }
  return bestEntry;
}

function sortedSide(map, dir) {
  return [...map.entries()].sort((a, b) => (dir === 'desc' ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0])));
}

function best(map, dir) {
  let bestPrice = null;
  for (const p of map.keys()) {
    const n = Number(p);
    if (bestPrice === null || (dir === 'desc' ? n > bestPrice : n < bestPrice)) bestPrice = n;
  }
  return bestPrice;
}

// Tracks one ORDERBOOK stream: snapshot, number chain, level order, window size and crossed books.
function tracker(symbol) {
  return {
    symbol,
    book: newBook(),
    snapshots: 0,
    updates: 0,
    emptyUpdates: 0,
    gaps: 0,
    gapSamples: [],
    firstFrameMs: null,
    snapshotOrder: null,
    updateBidsUnsorted: 0,
    updateAsksUnsorted: 0,
    maxBids: 0,
    maxAsks: 0,
    minBids: Infinity,
    minAsks: Infinity,
    crossed: 0,
    lastFrameAt: null,
    maxIdleMs: 0,
    frameGaps: [],
    lagMs: [],
    numberStep: [],
    stalls: [], // silences over 5 s: when they began, how long, and the frame that ended them
  };
}

function onOrderbook(t, msg, subscribedAt, now) {
  const d = msg.data;
  if (t.firstFrameMs === null) t.firstFrameMs = now - subscribedAt;
  if (t.lastFrameAt !== null) {
    if (now - t.lastFrameAt > 5000) t.stalls.push({ fromIso: new Date(t.lastFrameAt).toISOString().slice(11, 23), ms: now - t.lastFrameAt, empty: (d.bids ?? []).length + (d.asks ?? []).length === 0, step: d.number - t.book.number });
    t.maxIdleMs = Math.max(t.maxIdleMs, now - t.lastFrameAt);
    t.frameGaps.push(now - t.lastFrameAt);
  }
  t.lastFrameAt = now;
  if (typeof d.timestamp === 'number') t.lagMs.push(now - d.timestamp); // documented as timeStamp, sent as timestamp
  if (d.action === 'SNAPSHOT') {
    t.snapshots++;
    t.book = newBook();
    applySide(t.book.bids, d.bids ?? []);
    applySide(t.book.asks, d.asks ?? []);
    t.book.number = d.number;
    t.snapshotOrder = { bidsDesc: isSorted(d.bids ?? [], 'desc'), asksAsc: isSorted(d.asks ?? [], 'asc'), bids: (d.bids ?? []).length, asks: (d.asks ?? []).length, number: d.number, prevNumber: d.prevNumber };
  } else {
    t.updates++;
    if ((d.bids ?? []).length === 0 && (d.asks ?? []).length === 0) t.emptyUpdates++;
    if (t.book.number !== null && d.prevNumber !== t.book.number) {
      t.gaps++;
      if (t.gapSamples.length < 3) t.gapSamples.push({ last: t.book.number, prevNumber: d.prevNumber, number: d.number });
    }
    if (t.book.number !== null) t.numberStep.push(d.number - t.book.number);
    if (!isSorted(d.bids ?? [], 'desc')) t.updateBidsUnsorted++;
    if (!isSorted(d.asks ?? [], 'asc')) t.updateAsksUnsorted++;
    applySide(t.book.bids, d.bids ?? []);
    applySide(t.book.asks, d.asks ?? []);
    t.book.number = d.number;
  }
  t.maxBids = Math.max(t.maxBids, t.book.bids.size);
  t.maxAsks = Math.max(t.maxAsks, t.book.asks.size);
  t.minBids = Math.min(t.minBids, t.book.bids.size);
  t.minAsks = Math.min(t.minAsks, t.book.asks.size);
  const bb = best(t.book.bids, 'desc');
  const ba = best(t.book.asks, 'asc');
  if (bb !== null && ba !== null && bb >= ba) t.crossed++;
}

function summary(t) {
  return {
    symbol: t.symbol,
    firstFrameMs: t.firstFrameMs,
    snapshots: t.snapshots,
    updates: t.updates,
    emptyUpdates: t.emptyUpdates,
    gaps: t.gaps,
    gapSamples: t.gapSamples,
    numberStep: stats(t.numberStep),
    snapshotOrder: t.snapshotOrder,
    updateBidsUnsorted: t.updateBidsUnsorted,
    updateAsksUnsorted: t.updateAsksUnsorted,
    levels: { maxBids: t.maxBids, maxAsks: t.maxAsks, minBids: t.minBids, minAsks: t.minAsks },
    crossed: t.crossed,
    maxIdleMs: t.maxIdleMs,
    frameGapMs: stats(t.frameGaps),
    lagMs: stats(t.lagMs),
    stalls: t.stalls,
  };
}

async function book() {
  const tk = await tickers();
  const quiet = tk
    .filter((r) => r.symbol.endsWith('_USDT_PERP') && r.count > 0 && r.symbol !== 'USD_USDT_PERP')
    .sort((a, b) => a.count - b.count)[0].symbol;
  const books = ['BTC_USDT_PERP', 'ETH_USDT_PERP', quiet, 'USDT_BTC_PERP', 'BTC_ETH_PERP'];
  log('book_plan', { books, quiet, quietTrades24h: tk.find((r) => r.symbol === quiet).count });

  const s = open('book');
  await s.ready;
  log('open', { ms: s.openedMs });
  const trackers = new Map(books.map((b) => [b, tracker(b)]));
  const firstByKind = new Map();
  const obKeys = new Map();
  const history = new Map([['BTC_USDT_PERP', new Map()], ['ETH_USDT_PERP', new Map()]]); // number to the book the deltas built
  const depthVsBook = { levels: 0, equal: 0, samePriceOtherSize: 0 }; // against the book as it stands when the DEPTH frame arrives
  const depthVsBookByTs = { frames: 0, levels: 0, equal: 0, tsDiffMs: [] }; // against the built book whose server timestamp is nearest
  const depth = new Map();
  const index = new Map();
  let trades = 0;
  const pings = [];
  const pongRtt = [];
  const others = [];
  let binaryFrames = 0;
  let textFrames = 0;
  let pingSentAt = null;

  s.ws.on('message', (raw, isBinary) => {
    const now = Date.now();
    if (isBinary) binaryFrames++;
    else textFrames++;
    const text = raw.toString('utf8');
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      others.push(trim(text, 200));
      return;
    }
    const kind = msg.op ?? msg.type ?? `${msg.topic}:${msg.data?.action ?? ''}`;
    if (!firstByKind.has(kind) && !(kind === 'ORDERBOOK:UPDATE' && !(msg.data.bids?.length && msg.data.asks?.length))) {
      firstByKind.set(kind, compact(msg, text));
      capture('book-first-frames.txt', text);
    }
    if (msg.op === 'PING') {
      pings.push(now);
      s.ws.send(JSON.stringify({ op: 'PONG', timestamp: Date.now() }));
      return;
    }
    if (msg.op === 'PONG' && pingSentAt !== null) {
      pongRtt.push(now - pingSentAt);
      return;
    }
    if (msg.topic === 'ORDERBOOK' && msg.data) {
      const keys = `${Object.keys(msg).join(',')} data:${Object.keys(msg.data).join(',')} n:${msg.n === '' ? 'empty' : typeof msg.n}`;
      obKeys.set(keys, (obKeys.get(keys) ?? 0) + 1);
      const tr = trackers.get(msg.symbol);
      onOrderbook(tr, msg, s.sentAt.get(JSON.stringify({ op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: msg.symbol })), now);
      if (history.has(msg.symbol)) {
        const h = history.get(msg.symbol);
        h.set(tr.book.number, { ts: msg.data.timestamp, bids: sortedSide(tr.book.bids, 'desc'), asks: sortedSide(tr.book.asks, 'asc') });
        if (h.size > 200) h.delete(h.keys().next().value);
      }
      return;
    }
    if (msg.topic === 'DEPTH' && msg.data && msg.symbol === 'BTC_USDT_PERP') {
      // The DEPTH frame and the ORDERBOOK book come from the same server, so equal sizes at equal prices check the book and the unit together.
      const ob = trackers.get('BTC_USDT_PERP').book;
      for (const [p, sz] of msg.data.bids) {
        depthVsBook.levels++;
        if (ob.bids.get(p) === sz) depthVsBook.equal++;
        else if (ob.bids.has(p)) depthVsBook.samePriceOtherSize++;
      }
      const near = closestByTs(history.get('BTC_USDT_PERP'), msg.timestamp);
      if (near) {
        const m = new Map(near.bids);
        depthVsBookByTs.frames++;
        depthVsBookByTs.tsDiffMs.push(msg.timestamp - near.ts);
        for (const [p, sz] of msg.data.bids) {
          depthVsBookByTs.levels++;
          if (m.get(p) === sz) depthVsBookByTs.equal++;
        }
      }
    }
    if (msg.topic === 'DEPTH' && msg.data) {
      const d = (depth.get(msg.symbol) ?? depth.set(msg.symbol, { frames: 0, gaps: [], bids: [], asks: [], last: null, unsorted: 0, lag: [] }).get(msg.symbol));
      d.frames++;
      if (d.last !== null) d.gaps.push(now - d.last);
      d.last = now;
      d.bids.push(msg.data.bids.length);
      d.asks.push(msg.data.asks.length);
      if (!isSorted(msg.data.bids, 'desc') || !isSorted(msg.data.asks, 'asc')) d.unsorted++;
      if (typeof msg.timestamp === 'number') d.lag.push(now - msg.timestamp);
      return;
    }
    if (msg.topic === 'INDEX' && msg.data) {
      const x = (index.get(msg.symbol) ?? index.set(msg.symbol, { frames: 0, gaps: [], last: null, rows: [], markChanges: 0, prevMark: null, oddTimestamps: [], emptyData: 0 }).get(msg.symbol));
      x.frames++;
      if (x.last !== null) x.gaps.push(now - x.last);
      x.last = now;
      if (!(msg.timestamp > 1e12)) x.oddTimestamps.push(msg.timestamp);
      if (Array.isArray(msg.data) && msg.data.length === 0) x.emptyData++;
      const row = Array.isArray(msg.data) ? msg.data[0] : msg.data;
      if (row && x.prevMark !== null && row.markPrice !== x.prevMark) x.markChanges++;
      if (row) x.prevMark = row.markPrice;
      if (x.rows.length < 2) x.rows.push(row);
      return;
    }
    if (msg.topic === 'TRADE' && msg.data) {
      trades++;
      return;
    }
    if (others.length < 30) others.push(trim(text, 300));
  });

  const sub = (topic, symbol, extra = {}) => s.send({ op: 'SUBSCRIBE', topic, symbol, ...extra });
  for (const b of books) sub('ORDERBOOK', b);
  sub('DEPTH', 'BTC_USDT_PERP', { limit: 20 });
  sub('DEPTH', quiet, { limit: 20 });
  sub('INDEX', 'BTC_USDT_PERP');
  sub('INDEX', quiet);
  sub('TRADE', 'BTC_USDT_PERP');

  await sleep(30_000);
  pingSentAt = Date.now();
  s.ws.send(JSON.stringify({ op: 'PING', timestamp: pingSentAt }));
  await sleep(10_000);

  // A second socket's snapshot at a number the first socket reached by deltas shows whether the deltas rebuild the server book.
  const s2 = open('book-check');
  await s2.ready;
  const pending = [];
  s2.ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString('utf8'));
    if (msg.topic === 'ORDERBOOK' && msg.data?.action === 'SNAPSHOT') pending.push({ msg, at: Date.now(), firstAt: trackers.get(msg.symbol).book.number });
  });
  s2.send({ op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: 'BTC_USDT_PERP' });
  s2.send({ op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: 'ETH_USDT_PERP' });
  await sleep(4_000);
  s2.ws.close();
  for (const p of pending) {
    const d = p.msg.data;
    const built = history.get(p.msg.symbol).get(d.number);
    const cmp = (snap, mine) => {
      if (!mine) return null;
      const m = new Map(mine);
      const sm = new Map(snap);
      return {
        snapLevels: snap.length,
        builtLevels: mine.length,
        equal: snap.filter(([px, sz]) => m.get(px) === sz).length,
        samePriceOtherSize: snap.filter(([px, sz]) => m.has(px) && m.get(px) !== sz).length,
        onlyInSnapshot: snap.filter(([px]) => !m.has(px)).length,
        onlyInSnapshotRanks: snap.map(([px], i) => (m.has(px) ? -1 : i + 1)).filter((i) => i > 0), // 1 is the touch
        onlyInBuilt: mine.filter(([px]) => !sm.has(px)).length,
      };
    };
    log('snapshot_vs_built_book', {
      symbol: p.msg.symbol,
      snapshotNumber: d.number,
      firstSocketNumberAtArrival: p.firstAt,
      builtAtSameNumber: built !== undefined,
      bids: cmp(d.bids, built?.bids),
      asks: cmp(d.asks, built?.asks),
    });
  }
  await sleep(14_000);

  const rest = await restDepth('BTC_USDT_PERP', 100);
  const t = trackers.get('BTC_USDT_PERP');
  const near = closestByTs(history.get('BTC_USDT_PERP'), rest.updateTime);
  if (near) {
    const m = new Map(near.bids.slice(0, 20));
    const restTop = rest.bids.slice(0, 20);
    log('size_compare_btc_top20_bids_nearest_ts', {
      tsDiffMs: rest.updateTime - near.ts,
      samePrice: restTop.filter(([p]) => m.has(p) || m.has(Number(p).toFixed(1))).length,
      sameSize: restTop.filter(([p, sz]) => Number(m.get(p) ?? m.get(Number(p).toFixed(1))) === Number(sz)).length,
      restTop: restTop.slice(0, 2),
      wsTop: near.bids.slice(0, 2),
    });
  }
  const wsBids = [...t.book.bids.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 20);
  const restBids = new Map(rest.bids.slice(0, 40));
  const sameSize = wsBids.filter(([p, sz]) => restBids.get(p) === sz).length;
  const samePrice = wsBids.filter(([p]) => restBids.has(p)).length;
  log('size_compare_btc_top20_bids', { samePrice, sameSize, wsTop: wsBids.slice(0, 3), restTop: rest.bids.slice(0, 3), restUpdateTime: rest.updateTime, wsNumber: t.book.number });

  await sleep(2_000);
  s.ws.close();
  await sleep(300);
  for (const tr of trackers.values()) log('orderbook', summary(tr));
  for (const [sym, d] of depth) log('depth20', { symbol: sym, frames: d.frames, gapMs: stats(d.gaps), bids: stats(d.bids), asks: stats(d.asks), unsorted: d.unsorted, lagMs: stats(d.lag) });
  for (const [sym, x] of index) log('index', { symbol: sym, frames: x.frames, gapMs: stats(x.gaps), markChanges: x.markChanges, emptyData: x.emptyData, oddTimestamps: x.oddTimestamps.length, oddSample: x.oddTimestamps.slice(0, 3), rows: x.rows });
  log('orderbook_frame_keys', Object.fromEntries(obKeys));
  log('depth20_vs_orderbook_btc_bids', depthVsBook);
  log('depth20_vs_orderbook_btc_bids_nearest_ts', { ...depthVsBookByTs, tsDiffMs: stats(depthVsBookByTs.tsDiffMs) });
  log('trade', { frames: trades });
  log('keepalive', { serverPings: pings.length, pingGapsMs: pings.slice(1).map((p, i) => p - pings[i]), clientPingAnswered: pongRtt });
  log('frames', { text: textFrames, binary: binaryFrames, others: others.filter((o) => !o.includes('SUBSCRIBED')) });
  for (const [k, v] of firstByKind) log('first_frame', { kind: k, frame: v });
  log('closed', s.closed ?? {});
}

async function errors() {
  const s = open('errors');
  await s.ready;
  const replies = [];
  const counts = {};
  const afterUnsubscribe = [];
  let unsubscribedAt = null;
  const t0 = Date.now();
  s.ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      msg = {};
    }
    if (msg.op === 'PING') {
      s.ws.send(JSON.stringify({ op: 'PONG', timestamp: Date.now() }));
      return;
    }
    if (msg.topic && msg.data) {
      const key = `${msg.topic}:${msg.symbol}:${msg.data.action ?? ''}`;
      counts[key] = (counts[key] ?? 0) + 1;
      if (unsubscribedAt !== null && msg.symbol === 'DOGE_USDT_PERP') afterUnsubscribe.push(Date.now() - unsubscribedAt);
      if (!replies.some((r) => r.key === key)) replies.push({ key, atMs: Date.now() - t0 });
      return;
    }
    replies.push({ atMs: Date.now() - t0, text: trim(text, 300) });
    capture('errors-replies.txt', text);
  });
  const cases = [
    { op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: 'NOPE_USDT_PERP' },
    { op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: 'BTC_USDT' },
    { op: 'SUBSCRIBE', topic: 'DEPTH', symbol: 'BTC_USDT_PERP', limit: 200 },
    { op: 'SUBSCRIBE', topic: 'NOPE', symbol: 'BTC_USDT_PERP' },
    { op: 'SUBSCRIBE', topic: 'ORDERBOOK' },
    { op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: 'ETH_USDT_PERP,SOL_USDT_PERP' },
    { op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: ['ETH_USDT_PERP', 'SOL_USDT_PERP'] },
    { op: 'subscribe', topic: 'ORDERBOOK', symbol: 'XRP_USDT_PERP' },
    { op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: 'DOGE_USDT_PERP' },
    { op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: 'DOGE_USDT_PERP' },
    { op: 'SUBSCRIBE', topic: 'DEPTH', symbol: 'BTC_USDT' },
    'not json',
    { op: 'UNSUBSCRIBE', topic: 'ORDERBOOK', symbol: 'DOGE_USDT_PERP' },
    { op: 'UNSUBSCRIBE', topic: 'ORDERBOOK', symbol: 'NOPE_USDT_PERP' },
  ];
  for (const c of cases) {
    replies.push({ atMs: Date.now() - t0, sent: typeof c === 'string' ? c : JSON.stringify(c) });
    s.ws.send(typeof c === 'string' ? c : JSON.stringify(c));
    if (c.op === 'UNSUBSCRIBE' && c.symbol === 'DOGE_USDT_PERP') unsubscribedAt = Date.now();
    await sleep(900);
  }
  await sleep(3_000);
  s.ws.close();
  await sleep(300);
  for (const r of replies) log('errors', r);
  log('errors_frame_counts', { counts, dogeFramesAfterUnsubscribeMs: afterUnsubscribe });
  log('closed', s.closed ?? {});
}

async function batch() {
  const tk = await tickers();
  const usdt = tk
    .filter((r) => r.symbol.endsWith('_USDT_PERP') && r.symbol !== 'USD_USDT_PERP' && /^[\x20-\x7e]+$/.test(r.symbol))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  const pick = usdt.filter((_, i) => i % Math.floor(usdt.length / 100) === 0).slice(0, 100).map((r) => r.symbol);
  const s = open('batch');
  await s.ready;
  const trackers = new Map(pick.map((b) => [b, tracker(b)]));
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let countFrom = null;
  const perSecond = [];
  let secondCount = 0;
  let pings = 0;
  const acks = new Set();
  const errs = [];
  s.ws.on('message', (raw) => {
    const t0 = process.hrtime.bigint();
    const msg = JSON.parse(raw.toString('utf8'));
    const t1 = process.hrtime.bigint();
    const now = Date.now();
    if (msg.op === 'PING') {
      pings++;
      s.ws.send(JSON.stringify({ op: 'PONG', timestamp: Date.now() }));
      return;
    }
    if (msg.type === 'SUBSCRIBED') {
      acks.add(msg.symbol);
      return;
    }
    if (msg.topic === 'ORDERBOOK' && msg.data) {
      onOrderbook(trackers.get(msg.symbol), msg, s.sentAt.get(JSON.stringify({ op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: msg.symbol })), now);
      if (countFrom !== null) {
        frames++;
        bytes += raw.length;
        parseNs += t1 - t0;
        secondCount++;
      }
      return;
    }
    if (errs.length < 5) errs.push(trim(raw.toString('utf8'), 200));
  });
  const t0 = Date.now();
  for (const sym of pick) s.send({ op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: sym });
  await sleep(SEND_GAP_MS * pick.length + 1_000);
  log('batch_subscribed', { streams: pick.length, acks: acks.size, subscribeMs: Date.now() - t0, snapshots: [...trackers.values()].filter((t) => t.snapshots > 0).length });
  countFrom = Date.now();
  const timer = setInterval(() => {
    perSecond.push(secondCount);
    secondCount = 0;
  }, 1_000);
  await sleep(35_000);
  clearInterval(timer);
  const secs = (Date.now() - countFrom) / 1000;
  s.ws.close();
  await sleep(300);
  const all = [...trackers.values()];
  log('batch', {
    streams: pick.length,
    seconds: Math.round(secs),
    framesPerSecond: stats(perSecond),
    bytesPerSecond: Math.round(bytes / secs),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: Number(parseNs / BigInt(Math.max(1, frames))) / 1000,
    gaps: all.reduce((a, t) => a + t.gaps, 0),
    updates: all.reduce((a, t) => a + t.updates, 0),
    withSnapshot: all.filter((t) => t.snapshots > 0).length,
    withMoreThanOneSnapshot: all.filter((t) => t.snapshots > 1).length,
    crossedFrames: all.reduce((a, t) => a + t.crossed, 0),
    maxLevels: Math.max(...all.map((t) => Math.max(t.maxBids, t.maxAsks))),
    streamsUnder100Levels: all.filter((t) => t.maxBids < 100 || t.maxAsks < 100).length,
    maxIdleMs: stats(all.map((t) => t.maxIdleMs)),
    busyStreamStalls: all.filter((t) => stats(t.frameGaps).median < 1000 && t.maxIdleMs > 5000).map((t) => `${t.symbol}:${t.stalls.map((s) => `${s.fromIso}+${s.ms}${s.empty ? 'e' : ''}`).join('|')}`), // streams that normally tick under a second but went silent over 5 s, e marks an empty frame ending the silence
    busyStreams: all.filter((t) => stats(t.frameGaps).median < 1000).length,
    firstFrameMs: stats(all.map((t) => t.firstFrameMs).filter((x) => x !== null)),
    pings,
    others: errs,
  });
  const g = all.filter((t) => t.gaps > 0).slice(0, 5).map((t) => ({ s: t.symbol, gaps: t.gaps, samples: t.gapSamples }));
  if (g.length) log('batch_gap_samples', { rows: g });
  log('closed', s.closed ?? {});
}

async function silence() {
  const tk = await tickers();
  const quiet = tk
    .filter((r) => r.symbol.endsWith('_USDT_PERP') && r.count > 0 && r.symbol !== 'USD_USDT_PERP')
    .sort((a, b) => a.count - b.count)[0].symbol;
  const plans = [
    { label: 'no_sub_no_pong', sub: false, pong: false },
    { label: 'no_sub_pong', sub: false, pong: true },
    { label: 'quiet_sub_no_pong', sub: true, pong: false },
  ];
  const socks = plans.map((p) => ({ ...p, s: open(p.label), pings: [], frames: 0, lastFrameAt: null }));
  await Promise.all(socks.map((x) => x.s.ready));
  const t0 = Date.now();
  for (const x of socks) {
    x.s.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      x.frames++;
      x.lastFrameAt = Date.now() - t0;
      if (msg.op === 'PING') {
        x.pings.push(Date.now() - t0);
        if (x.pong) x.s.ws.send(JSON.stringify({ op: 'PONG', timestamp: Date.now() }));
      }
    });
    if (x.sub) x.s.send({ op: 'SUBSCRIBE', topic: 'ORDERBOOK', symbol: quiet });
  }
  while (Date.now() - t0 < 75_000 && socks.some((x) => x.s.closed === null)) await sleep(500);
  for (const x of socks) if (x.s.closed === null) x.s.ws.close();
  await sleep(300);
  for (const x of socks) log('silence', { label: x.label, quiet: x.sub ? quiet : null, pingsAtMs: x.pings, frames: x.frames, lastFrameAtMs: x.lastFrameAt, closed: x.s.closed });
}

async function deflate() {
  const s = open('deflate', { perMessageDeflate: true });
  await s.ready;
  let first = null;
  s.ws.on('message', (raw, isBinary) => {
    if (first === null) first = { isBinary, text: trim(raw.toString('utf8'), 200) };
  });
  s.send({ op: 'SUBSCRIBE', topic: 'DEPTH', symbol: 'BTC_USDT_PERP', limit: 5 });
  await sleep(3_000);
  s.ws.close();
  await sleep(300);
  log('deflate', { offered: true, negotiated: s.extensions, openMs: s.openedMs, first });
  const p = open('plain');
  await p.ready;
  log('plain', { negotiated: p.extensions, openMs: p.openedMs });
  p.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
