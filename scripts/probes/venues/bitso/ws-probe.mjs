// Bitso WebSocket probe: the orders and diff-orders book channels, the documented REST plus diff recipe, sequence gaps, level shape and order, keepalive, silence, errors, compression, and every book on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks once to see what the server negotiates.
// Run from server/: node ../scripts/probes/venues/bitso/ws-probe.mjs [book|batch|silence|errors|deflate]
//   book     orders, diff-orders and trades on five books for 60 s, with one whole REST book on btc_usd replayed against the diffs. About 65 s, 1 REST request.
//   batch    orders and diff-orders on every book of available_books on one connection for 45 s. About 50 s, 1 REST request.
//   silence  three sockets that differ only in what they subscribe, for up to 100 s.
//   errors   one socket each for an unknown book, type and action, a missing book, an uppercase book and text that is not JSON, then a duplicate subscribe and an unsubscribe. About 30 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/bitso/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.bitso.com';
const API = 'https://api.bitso.com/v3';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (book, type, action = 'subscribe') => JSON.stringify({ action, book, type });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(name, opts = { perMessageDeflate: false }) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, opts);
  const state = { ws, t0, name, openMs: null, pings: 0, ka: [], closed: null, upgradeHeaders: null };
  ws.on('upgrade', (res) => (state.upgradeHeaders = res.headers));
  ws.on('open', () => (state.openMs = Date.now() - t0));
  ws.on('ping', () => state.pings++);
  ws.on('close', (code, reason) => (state.closed = { code, reason: reason.toString(), atS: (Date.now() - t0) / 1000 }));
  ws.on('error', (e) => log('socket_error', { name, message: e.message }));
  return new Promise((resolve) => ws.once('open', () => resolve(state)));
}

const stats = (xs) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

// A whole book keyed by order id, the shape the diff-orders channel mutates.
class OrderBookL3 {
  constructor(rest) {
    this.orders = new Map();
    for (const x of rest.bids) this.orders.set(x.oid, { side: 0, price: x.price, amount: x.amount });
    for (const x of rest.asks) this.orders.set(x.oid, { side: 1, price: x.price, amount: x.amount });
    this.unknownRemovals = 0;
  }
  apply(o) {
    if (o.s === 'open') {
      this.orders.set(o.o, { side: o.t, price: o.r, amount: o.a });
    } else {
      if (!this.orders.has(o.o)) this.unknownRemovals++;
      this.orders.delete(o.o);
    }
  }
  levels(side) {
    const m = new Map();
    for (const x of this.orders.values()) if (x.side === side) m.set(Number(x.price), (m.get(Number(x.price)) ?? 0) + Number(x.amount));
    return [...m.entries()].sort((a, b) => (side === 0 ? b[0] - a[0] : a[0] - b[0]));
  }
}

async function book() {
  const books = ['btc_usd', 'btc_mxn', 'eth_usd', 'bar_usd', 'tusd_btc'];
  const s = await open('book');
  log('open', { ms: s.openMs, extensions: s.upgradeHeaders['sec-websocket-extensions'] ?? null });
  const per = Object.fromEntries(books.map((b) => [b, { acks: {}, firstOrdersMs: null, orders: 0, ordersKeys: new Set(), bidN: [], askN: [], bidLevels: [], askLevels: [], bidsDesc: 0, asksAsc: 0, lastOrdersAt: null, maxOrdersGapMs: 0, identicalRepeats: 0, lastPayload: null, diffs: 0, gaps: 0, dups: 0, lastSeq: null, diffPayloadLens: [], status: {}, removalKeys: {}, trades: 0 }]));
  let subAt = 0;
  let queue = [];
  let l3 = null;
  let restSeq = null;
  const cmp = { framesCompared: 0, touchMatch: 0, ordersAllKnown: 0, levelMatch: 0, firstMismatch: null };
  const ackTimes = [];
  const captured = new Map(); // first 20 frames per channel and book go to the capture file

  s.ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString();
    const j = JSON.parse(text);
    const kept = `${j.type}:${j.book}:${j.action ?? ''}`;
    captured.set(kept, (captured.get(kept) ?? 0) + 1);
    if (captured.get(kept) <= 20) capture('book.ndjson', `${now} ${text}`);
    if (j.type === 'ka') return void s.ka.push(now);
    const p = per[j.book];
    if (j.action === 'subscribe') {
      ackTimes.push({ localMs: now, serverMs: j.time });
      if (p) p.acks[j.type] = { response: j.response, ms: now - subAt };
      if (!p || j.response !== 'ok') log('ack', j);
      return;
    }
    if (!p) return log('unrouted', { text: text.slice(0, 200) });
    if (j.type === 'orders') {
      p.orders++;
      Object.keys(j).forEach((k) => p.ordersKeys.add(k));
      if (p.firstOrdersMs === null) p.firstOrdersMs = now - subAt;
      if (p.lastOrdersAt !== null) p.maxOrdersGapMs = Math.max(p.maxOrdersGapMs, now - p.lastOrdersAt);
      p.lastOrdersAt = now;
      const key = JSON.stringify(j.payload);
      if (key === p.lastPayload) p.identicalRepeats++;
      p.lastPayload = key;
      const { bids, asks } = j.payload;
      p.bidN.push(bids.length);
      p.askN.push(asks.length);
      p.bidLevels.push(new Set(bids.map((x) => x.r)).size);
      p.askLevels.push(new Set(asks.map((x) => x.r)).size);
      if (bids.every((x, i) => i === 0 || Number(bids[i - 1].r) >= Number(x.r))) p.bidsDesc++;
      if (asks.every((x, i) => i === 0 || Number(asks[i - 1].r) <= Number(x.r))) p.asksAsc++;
      if (j.book === 'btc_usd' && l3) compare(j.payload);
    } else if (j.type === 'diff-orders') {
      p.diffs++;
      if (p.lastSeq !== null) {
        if (j.sequence === p.lastSeq) p.dups++;
        else if (j.sequence !== p.lastSeq + 1) p.gaps++;
      }
      p.lastSeq = j.sequence;
      p.diffPayloadLens.push(j.payload.length);
      for (const o of j.payload) {
        p.status[o.s] = (p.status[o.s] ?? 0) + 1;
        if (o.s !== 'open') {
          const k = `${o.s}:${Object.keys(o).sort().join('')}`;
          p.removalKeys[k] = (p.removalKeys[k] ?? 0) + 1;
          if (o.s === 'completed' && p.removalKeys[k] === 1) capture('completed.ndjson', text);
        }
      }
      if (j.book === 'btc_usd') {
        if (l3) j.payload.forEach((o) => l3.apply(o));
        else queue.push(j);
      }
    } else if (j.type === 'trades') {
      p.trades++;
      if (p.trades === 1) capture('trade.json', text);
    }
  });

  function compare(payload) {
    cmp.framesCompared++;
    const lb = l3.levels(0);
    const la = l3.levels(1);
    if (lb[0]?.[0] === Number(payload.bids[0]?.r) && la[0]?.[0] === Number(payload.asks[0]?.r)) cmp.touchMatch++;
    // Numbers, not strings: diff-orders pads amounts to 8 decimals and the orders channel strips trailing zeros.
    const known = [...payload.bids, ...payload.asks].every((x) => Number(l3.orders.get(x.o)?.amount) === Number(x.a) && Number(l3.orders.get(x.o)?.price) === Number(x.r));
    if (known) cmp.ordersAllKnown++;
    // Levels strictly better than the frame's worst price are complete in the frame, so their sums must equal the L3 sums.
    const sumFrame = (xs) => xs.reduce((m, x) => m.set(Number(x.r), (m.get(Number(x.r)) ?? 0) + Number(x.a)), new Map());
    const fb = sumFrame(payload.bids);
    const fa = sumFrame(payload.asks);
    const worstBid = payload.bids.at(-1)?.r;
    const worstAsk = payload.asks.at(-1)?.r;
    const eq = (a, b) => Math.abs(a - b) < 1e-9;
    const okB = lb.filter(([px]) => px > Number(worstBid)).every(([px, sz]) => eq(fb.get(px) ?? 0, sz));
    const okA = la.filter(([px]) => px < Number(worstAsk)).every(([px, sz]) => eq(fa.get(px) ?? 0, sz));
    if (okB && okA) cmp.levelMatch++;
    else if (!cmp.firstMismatch) cmp.firstMismatch = { bestBidL3: lb[0], bestBidFrame: payload.bids[0]?.r, bestAskL3: la[0], bestAskFrame: payload.asks[0]?.r };
  }

  subAt = Date.now();
  for (const b of books) for (const type of ['orders', 'diff-orders', 'trades']) s.ws.send(sub(b, type));

  await sleep(5_000);
  const t0 = performance.now();
  const res = await fetch(`${API}/order_book/?book=btc_usd&aggregate=false`);
  const rest = (await res.json()).payload;
  restSeq = Number(rest.sequence);
  const firstQueued = queue[0]?.sequence;
  const lastQueued = queue.at(-1)?.sequence;
  l3 = new OrderBookL3(rest);
  let replayed = 0;
  let discarded = 0;
  for (const j of queue) {
    if (j.sequence <= restSeq) discarded++;
    else {
      j.payload.forEach((o) => l3.apply(o));
      replayed++;
    }
  }
  log('recipe_btc_usd', { restStatus: res.status, restMs: Math.round(performance.now() - t0), restSequence: restSeq, restOrders: rest.bids.length + rest.asks.length, queued: queue.length, firstQueued, lastQueued, discarded, replayed, restCoveredByQueue: firstQueued !== undefined && firstQueued <= restSeq + 1 });
  queue = [];

  await sleep(55_000);
  s.ws.close();
  await sleep(300);
  const serverMinusLocal = ackTimes.map((a) => a.serverMs - a.localMs);
  log('ack_clock', { serverMinusLocalMs: stats(serverMinusLocal) });
  for (const [b, p] of Object.entries(per)) {
    log('book_summary', {
      book: b,
      acks: p.acks,
      firstOrdersMs: p.firstOrdersMs,
      orders: p.orders,
      ordersKeys: [...p.ordersKeys],
      entriesPerSide: { bid: stats(p.bidN), ask: stats(p.askN) },
      distinctPricesPerSide: { bid: stats(p.bidLevels), ask: stats(p.askLevels) },
      bidsDescending: `${p.bidsDesc}/${p.orders}`,
      asksAscending: `${p.asksAsc}/${p.orders}`,
      maxOrdersGapMs: p.maxOrdersGapMs,
      identicalRepeats: p.identicalRepeats,
      diffs: p.diffs,
      gaps: p.gaps,
      dups: p.dups,
      diffPayloadLen: stats(p.diffPayloadLens),
      status: p.status,
      removalKeys: p.removalKeys, // status:sorted field letters, so 'cancelled:adorstvz' carries a and v
      trades: p.trades,
    });
  }
  log('recipe_compare_btc_usd', { ...cmp, unknownRemovals: l3?.unknownRemovals, l3Orders: l3?.orders.size });
  log('session', { kaFrames: s.ka.length, kaIntervalsMs: stats(s.ka.slice(1).map((t, i) => t - s.ka[i])), protocolPings: s.pings, closed: s.closed });
}

async function batch() {
  const res = await fetch(`${API}/available_books/`);
  const books = (await res.json()).payload.map((x) => x.book);
  const s = await open('batch');
  const per = new Map(books.map((b) => [b, { orders: 0, diffs: 0, gaps: 0, lastSeq: null, firstOrdersMs: null, lastAt: null, maxGapMs: 0 }]));
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let acks = 0;
  let nacks = [];
  let lastAckMs = 0;
  const perSecond = new Map();
  const subAt = Date.now();
  s.ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString();
    frames++;
    bytes += raw.length;
    const sec = Math.floor((now - subAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const t = process.hrtime.bigint();
    const j = JSON.parse(text);
    parseNs += process.hrtime.bigint() - t;
    if (j.type === 'ka') return;
    if (j.action === 'subscribe') {
      if (j.response === 'ok') acks++;
      else nacks.push(text.slice(0, 200));
      lastAckMs = now - subAt;
      return;
    }
    const p = per.get(j.book);
    if (!p) return;
    if (p.lastAt !== null) p.maxGapMs = Math.max(p.maxGapMs, now - p.lastAt);
    p.lastAt = now;
    if (j.type === 'orders') {
      p.orders++;
      if (p.firstOrdersMs === null) p.firstOrdersMs = now - subAt;
    } else if (j.type === 'diff-orders') {
      p.diffs++;
      if (p.lastSeq !== null && j.sequence !== p.lastSeq + 1) p.gaps++;
      p.lastSeq = j.sequence;
    }
  });
  for (const b of books) {
    s.ws.send(sub(b, 'orders'));
    s.ws.send(sub(b, 'diff-orders'));
  }
  await sleep(45_000);
  s.ws.close();
  await sleep(300);
  const rows = [...per.entries()];
  const rates = [...perSecond.entries()].filter(([k]) => k >= 2 && k < 45).map(([, v]) => v);
  log('batch_summary', {
    books: books.length,
    subscribeFrames: books.length * 2,
    acks,
    nacks,
    lastAckMs,
    frames,
    framesPerSecond: stats(rates),
    bytesPerSecond: Math.round(bytes / 45),
    bytesPerFrame: Math.round(bytes / frames),
    parseMicrosPerFrame: Number(parseNs / BigInt(frames)) / 1000,
    booksWithOrdersFrame: rows.filter(([, p]) => p.orders > 0).length,
    booksWithoutOrdersFrame: rows.filter(([, p]) => p.orders === 0).map(([b]) => b),
    firstOrdersMs: stats(rows.filter(([, p]) => p.firstOrdersMs !== null).map(([, p]) => p.firstOrdersMs)),
    diffGaps: rows.reduce((n, [, p]) => n + p.gaps, 0),
    diffs: rows.reduce((n, [, p]) => n + p.diffs, 0),
    ordersFrames: rows.reduce((n, [, p]) => n + p.orders, 0),
    maxBookGapMs: stats(rows.map(([, p]) => p.maxGapMs)),
    closed: s.closed,
    protocolPings: s.pings,
  });
  const quiet = rows.filter(([, p]) => p.orders <= 1).map(([b, p]) => `${b}:${p.orders}/${p.diffs}`);
  log('batch_quiet_books', { ordersFramesAtMostOne: quiet });
}

async function silence() {
  const specs = [
    { name: 'no_subscription', subs: [] },
    { name: 'dead_book_diff_orders', subs: [['tusd_btc', 'diff-orders']] },
    { name: 'dead_book_orders', subs: [['tusd_btc', 'orders']] },
  ];
  const sockets = await Promise.all(specs.map((x) => open(x.name)));
  sockets.forEach((s, i) => {
    s.frames = [];
    s.ws.on('message', (raw) => {
      const j = JSON.parse(raw.toString());
      s.frames.push({ atS: (Date.now() - s.t0) / 1000, type: j.type ?? j.action });
      if (j.type === 'ka') s.ka.push(Date.now());
    });
    for (const [b, t] of specs[i].subs) s.ws.send(sub(b, t));
  });
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && sockets.some((s) => !s.closed)) await sleep(500);
  for (const s of sockets) {
    if (!s.closed) s.ws.close();
  }
  await sleep(300);
  for (const s of sockets) {
    const types = s.frames.reduce((m, f) => ((m[f.type] = (m[f.type] ?? 0) + 1), m), {});
    log('silence', { name: s.name, openMs: s.openMs, closed: s.closed, frameTypes: types, firstKaS: s.frames.find((f) => f.type === 'ka')?.atS ?? null, kaIntervalsMs: stats(s.ka.slice(1).map((t, i) => t - s.ka[i])), protocolPings: s.pings });
  }
}

// One socket per bad frame, since a single bad frame can close the socket.
async function errors() {
  const cases = [
    ['unknown book', sub('nope_usd', 'orders')],
    ['unknown type', sub('btc_usd', 'nope')],
    ['missing book', JSON.stringify({ action: 'subscribe', type: 'orders' })],
    ['uppercase book', sub('BTC_USD', 'orders')],
    ['unknown action', sub('btc_usd', 'orders', 'nope')],
    ['not json', 'hello'],
  ];
  for (const [label, frame] of cases) {
    const s = await open(label);
    const replies = [];
    s.ws.on('message', (raw) => {
      const text = raw.toString();
      if (!text.includes('"ka"')) replies.push({ atMs: Date.now() - s.t0 - s.openMs, text: text.slice(0, 200) });
    });
    s.ws.send(frame);
    await sleep(2_500);
    const closed = s.closed;
    if (!closed) s.ws.close();
    await sleep(200);
    log('error_case', { label, frame, replies: replies.slice(0, 3), dataFrames: Math.max(0, replies.length - 1), closedByServer: closed });
  }
  // A duplicate subscribe, then an unsubscribe, on a busy book.
  const s = await open('duplicate and unsubscribe');
  const counts = { acks: [], frames: 0 };
  s.ws.on('message', (raw) => {
    const j = JSON.parse(raw.toString());
    if (j.action) counts.acks.push(raw.toString().slice(0, 200));
    else if (j.type === 'orders') counts.frames++;
  });
  s.ws.send(sub('btc_usd', 'orders'));
  s.ws.send(sub('btc_usd', 'orders'));
  await sleep(5_000);
  const before = counts.frames;
  s.ws.send(sub('btc_usd', 'orders', 'unsubscribe'));
  await sleep(1_000);
  const atUnsub = counts.frames;
  await sleep(5_000);
  const closed = s.closed;
  if (!closed) s.ws.close();
  await sleep(200);
  log('duplicate_and_unsubscribe', { acks: counts.acks, ordersFramesFirst5s: before, ordersFramesInSecondAfterUnsubscribe: atUnsub - before, ordersFramesNext5s: counts.frames - atUnsub, closedByServer: closed });
}

async function deflate() {
  const s = await open('deflate', { perMessageDeflate: true });
  log('deflate', { openMs: s.openMs, extensions: s.upgradeHeaders['sec-websocket-extensions'] ?? null, server: s.upgradeHeaders.server });
  s.ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, errors, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, expected one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
