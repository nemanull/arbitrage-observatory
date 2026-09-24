// BTC Markets WebSocket probe: orderbookUpdate snapshot and deltas, snapshotId order, CRC32 checksum, level window, the 50 level orderbook channel, errors, a batch of every online market, keepalive, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// The venue documents 3 new connections per 10 s per IP, so every mode opens its sockets at least 4 s apart.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btcmarkets/ws-probe.mjs [book|errors|batch|silence|deflate]
//   book     orderbookUpdate on seven markets for 75 s, a second socket with orderbook and tick on the same markets, and a REST book compare. About 85 s.
//   errors   bad channel, bad and offline markets, text that is not JSON, add and remove subscription, resubscribe. About 40 s.
//   batch    orderbookUpdate on every online market on one socket for 60 s.
//   silence  four sockets that differ only in what the client sends or subscribes, for up to 120 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames, capped at about 2 MB per file. Recorded in docs/profiles/btcmarkets/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://socket.btcmarkets.net/v2';
const API = 'https://api.btcmarkets.net/v3';
const OUT = process.env.PROBE_OUT_DIR;
const CAPTURE_CAP_BYTES = 2_000_000;
const OPEN_SPACING_MS = 4_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  try {
    if (statSync(file).size > CAPTURE_CAP_BYTES) return;
  } catch {}
  appendFileSync(file, text + '\n');
}

function open(label, { deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  const info = { label, t0, openMs: null, closeAt: null, closeCode: null, pings: 0, headers: null };
  ws.on('upgrade', (res) => {
    info.headers = {
      status: res.statusCode,
      ext: res.headers['sec-websocket-extensions'] ?? null,
      rlLimit: res.headers['x-ratelimit-limit'],
      rlRemaining: res.headers['x-ratelimit-remaining'],
      rlResetInS: res.headers['x-ratelimit-reset'] ? Number(res.headers['x-ratelimit-reset']) - Math.floor(Date.parse(res.headers.date) / 1000) : null,
      ray: res.headers['cf-ray'],
    };
  });
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => log('refused', { label, status: res.statusCode, body: body.slice(0, 300) }));
  });
  ws.on('ping', () => info.pings++);
  ws.on('close', (code) => {
    info.closeAt = Date.now() - t0;
    info.closeCode = code;
  });
  ws.on('error', (e) => log('socket_error', { label, message: e.message }));
  const ready = new Promise((resolve) => ws.on('open', () => { info.openMs = Date.now() - t0; resolve(); }));
  return { ws, info, ready };
}

const subscribe = (ws, marketIds, channels, messageType = 'subscribe') =>
  ws.send(JSON.stringify({ marketIds, channels, messageType }));

// Checksum per ngin-io/websocket-checksum: top 10 bids high to low, then top 10 asks low to high, each price and volume with the dot and leading zeros removed, CRC32 in decimal.
const trim = (s) => s.replace('.', '').replace(/^0+/, '');
function checksumOf(book) {
  const side = (m, desc) => [...m.entries()].sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, 10).map(([, l]) => trim(l[0]) + trim(l[1])).join('');
  return crc32(side(book.bids, true) + side(book.asks, false)) >>> 0;
}

function applyLevels(map, levels) {
  for (const l of levels) {
    const p = Number(l[0]);
    if (Number(l[1]) === 0) map.delete(p);
    else map.set(p, l);
  }
}

const newBook = (msg) => {
  const b = { bids: new Map(), asks: new Map() };
  applyLevels(b.bids, msg.bids);
  applyLevels(b.asks, msg.asks);
  return b;
};

const isSorted = (levels, desc) => levels.every((l, i) => i === 0 || (desc ? Number(levels[i - 1][0]) > Number(l[0]) : Number(levels[i - 1][0]) < Number(l[0])));

const pct = (arr, q) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// Tracks one market's orderbookUpdate stream under three rules for deltas stamped at or before the snapshot.
function makeTracker() {
  return {
    snapshots: 0, snapBids: [], snapAsks: [], snapOrderBad: 0, subToSnapMs: null,
    deltas: 0, deltasBeforeSnapshot: 0, levelsPerDelta: [],
    idLower: 0, idEqual: 0, idHigher: 0, lastId: null, snapId: null,
    atOrBelowSnap: { lower: 0, equal: 0 }, laterRepeat: 0, laterLower: 0, maxLevelsPerDelta: 0,
    books: null, mismatch: { applyAll: 0, skipLower: 0, skipLowerOrEqual: 0 }, mismatchStampedAtOrAfterSnapshot: { applyAll: 0, skipLower: 0, skipLowerOrEqual: 0 }, checked: 0,
    firstMismatch: null, maxBids: 0, maxAsks: 0, zeroVolNonZeroCount: 0, nonZeroVolZeroCount: 0,
    sameAsBook: 0, unordered: 0, nonCanonical: 0, nonCanonicalExample: null, crossedAfterApply: 0, lastArrival: null, maxGapMs: 0, early: [],
  };
}

function trackBookFrame(t, msg, now, subAt) {
  if (t.lastArrival !== null) t.maxGapMs = Math.max(t.maxGapMs, now - t.lastArrival);
  t.lastArrival = now;
  const id = Number(msg.snapshotId);
  if (msg.snapshot === true) {
    t.snapshots++;
    t.snapBids.push(msg.bids.length);
    t.snapAsks.push(msg.asks.length);
    if (!isSorted(msg.bids, true) || !isSorted(msg.asks, false)) t.snapOrderBad++;
    for (const l of [...msg.bids, ...msg.asks]) for (const x of [l[0], l[1]]) if (String(Number(x)) !== x) { t.nonCanonical++; t.nonCanonicalExample ??= x; }
    if (t.subToSnapMs === null) t.subToSnapMs = now - subAt;
    t.snapId = id;
    t.lastId = id;
    t.books = { applyAll: newBook(msg), skipLower: newBook(msg), skipLowerOrEqual: newBook(msg) };
    t.snapChecksumOk = msg.checksum === undefined ? null : Number(msg.checksum) === checksumOf(t.books.applyAll);
    return;
  }
  t.deltas++;
  if (t.books === null) { t.deltasBeforeSnapshot++; return; }
  t.levelsPerDelta.push(msg.bids.length + msg.asks.length);
  if (msg.bids.length > 1 && !isSorted(msg.bids, true)) t.unordered++;
  if (msg.asks.length > 1 && !isSorted(msg.asks, false)) t.unordered++;
  const prevId = t.lastId;
  if (id < t.lastId) t.idLower++;
  else if (id === t.lastId) t.idEqual++;
  else t.idHigher++;
  t.lastId = Math.max(t.lastId, id);
  if (id < t.snapId) t.atOrBelowSnap.lower++;
  else if (id === t.snapId) t.atOrBelowSnap.equal++;
  else if (id < prevId) t.laterLower++;
  else if (id === prevId) t.laterRepeat++;
  t.maxLevelsPerDelta = Math.max(t.maxLevelsPerDelta, msg.bids.length + msg.asks.length);
  for (const l of [...msg.bids, ...msg.asks]) {
    // A level string that a number round trip changes, such as a trailing zero or 0.00000001, which String(Number()) spells 1e-8, breaks a checksum rebuilt from numbers.
    for (const x of [l[0], l[1]]) if (String(Number(x)) !== x) { t.nonCanonical++; t.nonCanonicalExample ??= x; }
    if (Number(l[1]) === 0 && l[2] !== 0) t.zeroVolNonZeroCount++;
    if (Number(l[1]) !== 0 && l[2] === 0) t.nonZeroVolZeroCount++;
  }
  const ref = t.books.applyAll;
  const same = [...msg.bids.map((l) => [ref.bids, l]), ...msg.asks.map((l) => [ref.asks, l])].every(([m, l]) => {
    const cur = m.get(Number(l[0]));
    return cur ? cur[1] === l[1] && cur[2] === l[2] : Number(l[1]) === 0;
  });
  if (same) t.sameAsBook++;
  const apply = (b) => { applyLevels(b.bids, msg.bids); applyLevels(b.asks, msg.asks); };
  apply(t.books.applyAll);
  if (id >= t.snapId) apply(t.books.skipLower);
  if (id > t.snapId) apply(t.books.skipLowerOrEqual);
  const b = t.books.applyAll;
  t.maxBids = Math.max(t.maxBids, b.bids.size);
  t.maxAsks = Math.max(t.maxAsks, b.asks.size);
  const bestBid = Math.max(...b.bids.keys());
  const bestAsk = Math.min(...b.asks.keys());
  if (b.bids.size && b.asks.size && bestBid >= bestAsk) t.crossedAfterApply++;
  if (msg.checksum !== undefined) {
    t.checked++;
    const want = Number(msg.checksum);
    // The first deltas after a snapshot, with their stamp relative to it and which rule's book matched the checksum.
    if (t.early.length < 4) t.early.push({ afterSnapshotUs: id - t.snapId, level: msg.bids.length ? ['bid', ...msg.bids[0]] : ['ask', ...msg.asks[0]], match: Object.fromEntries(Object.keys(t.books).map((k) => [k, checksumOf(t.books[k]) === want])) });
    for (const k of Object.keys(t.books)) {
      if (checksumOf(t.books[k]) !== want) {
        t.mismatch[k]++;
        if (id >= t.snapId) t.mismatchStampedAtOrAfterSnapshot[k]++;
        if (k === 'skipLower' && t.firstMismatch === null) t.firstMismatch = { snapshotId: id, deltaIndex: t.deltas };
      }
    }
  }
}

function summarize(market, t) {
  return {
    market, snapshots: t.snapshots, snapBids: t.snapBids, snapAsks: t.snapAsks, snapOrderBad: t.snapOrderBad,
    snapChecksumOk: t.snapChecksumOk ?? null, subToSnapMs: t.subToSnapMs, deltas: t.deltas, deltasBeforeSnapshot: t.deltasBeforeSnapshot,
    levelsPerDelta: { median: pct(t.levelsPerDelta, 0.5), max: pct(t.levelsPerDelta, 1) },
    snapshotIdVsPrevious: { lower: t.idLower, equal: t.idEqual, higher: t.idHigher },
    deltasAtOrBelowSnapshotId: t.atOrBelowSnap, checksumsChecked: t.checked, checksumMismatch: t.mismatch, checksumMismatchStampedAtOrAfterSnapshot: t.mismatchStampedAtOrAfterSnapshot, firstMismatchSkipLower: t.firstMismatch,
    maxLevelsHeld: { bids: t.maxBids, asks: t.maxAsks }, zeroVolNonZeroCount: t.zeroVolNonZeroCount, nonZeroVolZeroCount: t.nonZeroVolZeroCount,
    deltasThatChangeNothing: t.sameAsBook, nonCanonicalStrings: t.nonCanonical, nonCanonicalExample: t.nonCanonicalExample, unorderedDeltaSides: t.unordered, crossedAfterApply: t.crossedAfterApply, maxGapMs: t.maxGapMs,
    early: t.atOrBelowSnap.lower + t.atOrBelowSnap.equal > 0 || t.mismatch.skipLower > 0 ? t.early : undefined,
  };
}

async function book() {
  const markets = ['BTC-AUD', 'ETH-AUD', 'XRP-AUD', 'SOL-AUD', 'BTC-USDT', 'ETH-BTC', 'BAT-AUD'];
  const trackers = new Map(markets.map((m) => [m, makeTracker()]));
  const a = open('update');
  await a.ready;
  const subAt = Date.now();
  subscribe(a.ws, markets, ['orderbookUpdate', 'heartbeat']);
  const hb = [];
  let frames = 0;
  let bytes = 0;
  const other = [];
  a.ws.on('message', (d) => {
    const now = Date.now();
    frames++;
    bytes += d.length;
    const msg = JSON.parse(d.toString());
    capture('book-update.jsonl', `${now} ${d.toString().slice(0, 4000)}`);
    if (msg.messageType === 'orderbookUpdate') trackBookFrame(trackers.get(msg.marketId), msg, now, subAt);
    else if (msg.messageType === 'heartbeat') hb.push(now - subAt);
    else other.push(d.toString().slice(0, 300));
  });

  await sleep(OPEN_SPACING_MS);
  const b = open('orderbook');
  await b.ready;
  const subB = Date.now();
  subscribe(b.ws, markets, ['orderbook', 'tick']);
  const ob = new Map(markets.map((m) => [m, { n: 0, bids: [], asks: [], firstMs: null, keys: null, sameAsPrev: 0, prev: null, matchUpdateTop20: 0, compared: 0 }]));
  const tick = new Map(markets.map((m) => [m, 0]));
  let tickKeys = null;
  b.ws.on('message', (d) => {
    const now = Date.now();
    const msg = JSON.parse(d.toString());
    capture('book-orderbook.jsonl', `${now} ${d.toString().slice(0, 4000)}`);
    if (msg.messageType === 'orderbook') {
      const o = ob.get(msg.marketId);
      o.n++;
      o.bids.push(msg.bids.length);
      o.asks.push(msg.asks.length);
      if (o.firstMs === null) o.firstMs = now - subB;
      o.keys ??= Object.keys(msg).join(',');
      const sig = JSON.stringify([msg.bids, msg.asks]);
      if (sig === o.prev) o.sameAsPrev++;
      o.prev = sig;
      const t = trackers.get(msg.marketId);
      if (t.books && t.lastId === Number(msg.snapshotId)) {
        o.compared++;
        // The orderbook channel lists single orders, so it is summed per price and only the ten best prices are compared, since the fiftieth order can cut a price short.
        const sumByPrice = (levels) => {
          const m = new Map();
          for (const [p, v] of levels) m.set(Number(p), (m.get(Number(p)) ?? 0) + Number(v));
          return [...m.entries()].slice(0, 10).map(([p, v]) => `${p}:${v.toFixed(8)}`).join('|');
        };
        const top = (m, desc) => [...m.entries()].sort((x, y) => (desc ? y[0] - x[0] : x[0] - y[0])).slice(0, 10).map(([p, l]) => `${p}:${Number(l[1]).toFixed(8)}`).join('|');
        const mine = top(t.books.skipLower.bids, true) + '#' + top(t.books.skipLower.asks, false);
        const theirs = sumByPrice(msg.bids) + '#' + sumByPrice(msg.asks);
        if (mine === theirs) o.matchUpdateTop20++;
      }
    } else if (msg.messageType === 'tick') {
      tick.set(msg.marketId, tick.get(msg.marketId) + 1);
      tickKeys ??= Object.keys(msg).join(',');
    }
  });

  await sleep(71_000 - OPEN_SPACING_MS);

  // REST level 2 lists every resting order, so it is summed per price before the compare, and its entry count per price is set against the socket's count field.
  for (const market of ['BTC-AUD', 'ETH-BTC']) {
    const rest = await fetch(`${API}/markets/${market}/orderbook?level=2`).then((r) => r.json());
    const t = trackers.get(market);
    const agg = (levels) => {
      const m = new Map();
      for (const [p, v] of levels) {
        const cur = m.get(Number(p)) ?? { size: 0, orders: 0 };
        m.set(Number(p), { size: cur.size + Number(v), orders: cur.orders + 1 });
      }
      return m;
    };
    const restBids = agg(rest.bids);
    const restAsks = agg(rest.asks);
    let sameSize = 0;
    let sameCount = 0;
    let compared = 0;
    for (const [restSide, mine, desc] of [[restBids, t.books.skipLower.bids, true], [restAsks, t.books.skipLower.asks, false]]) {
      const top = [...mine.entries()].sort((x, y) => (desc ? y[0] - x[0] : x[0] - y[0])).slice(0, 20);
      for (const [p, l] of top) {
        compared++;
        const r = restSide.get(p);
        if (r && Math.abs(r.size - Number(l[1])) < 1e-9) sameSize++;
        if (r && r.orders === l[2]) sameCount++;
      }
    }
    log('rest_compare', { market, restSnapshotId: Number(rest.snapshotId), socketSnapshotId: t.lastId, restMinusSocketMs: (Number(rest.snapshotId) - t.lastId) / 1000, restEntries: { bids: rest.bids.length, asks: rest.asks.length }, restPriceLevels: { bids: restBids.size, asks: restAsks.size }, socketLevels: { bids: t.books.skipLower.bids.size, asks: t.books.skipLower.asks.size }, compared, sameSize, sameOrderCount: sameCount });
  }

  await sleep(4_000);
  a.ws.close();
  b.ws.close();
  await sleep(500);
  const hbGaps = hb.slice(1).map((x, i) => x - hb[i]);
  log('update_socket', { openMs: a.info.openMs, headers: a.info.headers, frames, bytes, seconds: 75, heartbeatsAtMs: hb.slice(0, 3), heartbeatGapMs: { min: pct(hbGaps, 0), median: pct(hbGaps, 0.5), max: pct(hbGaps, 1) }, serverPings: a.info.pings, other: other.slice(0, 5) });
  for (const [m, tr] of trackers) log('orderbookUpdate', summarize(m, tr));
  log('orderbook_socket', { openMs: b.info.openMs, headers: b.info.headers, serverPings: b.info.pings, tickKeys });
  for (const [m, o] of ob) log('orderbook', { market: m, frames: o.n, firstMs: o.firstMs, bids: { min: pct(o.bids, 0), max: pct(o.bids, 1) }, asks: { min: pct(o.asks, 0), max: pct(o.asks, 1) }, keys: o.keys, identicalToPrevious: o.sameAsPrev, comparedAtSameSnapshotId: o.compared, top10PricesEqualUpdateBook: o.matchUpdateTop20, ticks: tick.get(m) });
}

async function errors() {
  const s = open('errors');
  await s.ready;
  const t0 = Date.now();
  const seen = [];
  const counts = new Map();
  const lastRaw = new Map();
  let window = new Map(); // frames per market since the previous step, to see which subscriptions a step kept
  s.ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    const key = `${msg.messageType}:${msg.marketId ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (msg.marketId) window.set(msg.marketId, (window.get(msg.marketId) ?? 0) + 1);
    // The same delta delivered twice would show a doubled subscription.
    if (msg.marketId && lastRaw.get(msg.marketId) === d.toString()) window.set(`${msg.marketId} repeated`, (window.get(`${msg.marketId} repeated`) ?? 0) + 1);
    if (msg.marketId) lastRaw.set(msg.marketId, d.toString());
    if (msg.messageType !== 'orderbookUpdate' || msg.snapshot === true) seen.push(`${Date.now() - t0} ${d.toString().slice(0, 260)}`);
  });
  const steps = [
    ['bad channel', { marketIds: ['BTC-AUD'], channels: ['nope'], messageType: 'subscribe' }],
    ['bad market', { marketIds: ['NOPE-AUD'], channels: ['orderbookUpdate'], messageType: 'subscribe' }],
    ['bad and good market', { marketIds: ['NOPE-AUD', 'BAT-AUD'], channels: ['orderbookUpdate'], messageType: 'subscribe' }],
    ['lower case market', { marketIds: ['bat-aud'], channels: ['orderbookUpdate'], messageType: 'subscribe' }],
    ['offline market', { marketIds: ['MCAU-AUD'], channels: ['orderbookUpdate'], messageType: 'subscribe' }],
    ['subscribe BAT-AUD', { marketIds: ['BAT-AUD'], channels: ['orderbookUpdate'], messageType: 'subscribe' }],
    ['wait', null],
    ['subscribe POWR-AUD, replaces BAT-AUD?', { marketIds: ['POWR-AUD'], channels: ['orderbookUpdate'], messageType: 'subscribe' }],
    ['wait', null],
    ['addSubscription BAT-AUD', { marketIds: ['BAT-AUD'], channels: ['orderbookUpdate'], messageType: 'addSubscription' }],
    ['wait', null],
    ['addSubscription BAT-AUD twice', { marketIds: ['BAT-AUD'], channels: ['orderbookUpdate'], messageType: 'addSubscription' }],
    ['wait', null],
    ['removeSubscription POWR-AUD', { marketIds: ['POWR-AUD'], channels: ['orderbookUpdate'], messageType: 'removeSubscription' }],
    ['wait', null],
    ['unknown messageType', { marketIds: ['BAT-AUD'], channels: ['orderbookUpdate'], messageType: 'nope' }],
    ['missing marketIds', { channels: ['orderbookUpdate'], messageType: 'subscribe' }],
    ['not json', 'hello'],
    ['heartbeat only', { channels: ['heartbeat'], messageType: 'subscribe' }],
  ];
  for (const [label, payload] of steps) {
    seen.push(`${Date.now() - t0} frames since previous step ${JSON.stringify(Object.fromEntries(window))}`);
    window = new Map();
    seen.push(`${Date.now() - t0} >>> ${label}`);
    if (payload !== null) s.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    await sleep(1_800);
  }
  await sleep(4_000);
  seen.push(`${Date.now() - t0} frames since previous step ${JSON.stringify(Object.fromEntries(window))}`);
  s.ws.close();
  await sleep(300);
  for (const line of seen) console.log(line);
  log('errors_summary', { openMs: s.info.openMs, closeCode: s.info.closeCode, serverPings: s.info.pings, counts: Object.fromEntries(counts) });
}

async function batch() {
  const markets = (await fetch(`${API}/markets`).then((r) => r.json())).filter((m) => m.status === 'Online').map((m) => m.marketId);
  const trackers = new Map(markets.map((m) => [m, makeTracker()]));
  const s = open('batch');
  await s.ready;
  const subAt = Date.now();
  subscribe(s.ws, markets, ['orderbookUpdate', 'heartbeat']);
  const perSecond = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  s.ws.on('message', (d) => {
    const now = Date.now();
    const p0 = process.hrtime.bigint();
    const msg = JSON.parse(d.toString());
    parseNs += process.hrtime.bigint() - p0;
    frames++;
    bytes += d.length;
    const sec = Math.floor((now - subAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (msg.messageType === 'orderbookUpdate') trackBookFrame(trackers.get(msg.marketId), msg, now, subAt);
  });
  await sleep(60_000);
  s.ws.close();
  await sleep(300);
  const rates = [...perSecond.values()];
  const all = [...trackers.values()];
  const snapMs = all.map((t) => t.subToSnapMs).filter((x) => x !== null);
  const sum = (f) => all.reduce((acc, t) => acc + f(t), 0);
  log('batch', {
    markets: markets.length, openMs: s.info.openMs, headers: s.info.headers, frames, bytes, bytesPerFrame: Math.round(bytes / frames),
    framesPerSecond: { median: pct(rates, 0.5), max: pct(rates, 1), mean: Math.round(frames / 60) }, parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000,
    snapshots: sum((t) => t.snapshots), marketsWithSnapshot: snapMs.length, subToSnapMs: { min: pct(snapMs, 0), max: pct(snapMs, 1) },
    deltas: sum((t) => t.deltas), checksumsChecked: sum((t) => t.checked),
    mismatch: { applyAll: sum((t) => t.mismatch.applyAll), skipLower: sum((t) => t.mismatch.skipLower), skipLowerOrEqual: sum((t) => t.mismatch.skipLowerOrEqual) },
    mismatchStampedAtOrAfterSnapshot: { applyAll: sum((t) => t.mismatchStampedAtOrAfterSnapshot.applyAll), skipLower: sum((t) => t.mismatchStampedAtOrAfterSnapshot.skipLower), skipLowerOrEqual: sum((t) => t.mismatchStampedAtOrAfterSnapshot.skipLowerOrEqual) },
    deltasStampedBeforeSnapshot: sum((t) => t.atOrBelowSnap.lower), deltasStampedAtSnapshot: sum((t) => t.atOrBelowSnap.equal),
    laterDeltasStampedBelowPrevious: sum((t) => t.laterLower), laterDeltasStampedSameAsPrevious: sum((t) => t.laterRepeat),
    maxLevelsPerDelta: Math.max(...all.map((t) => t.maxLevelsPerDelta)), deltasThatChangeNothing: { sum: sum((t) => t.sameAsBook), maxPerMarket: Math.max(...all.map((t) => t.sameAsBook)) },
    zeroVolumeCountMismatch: sum((t) => t.zeroVolNonZeroCount + t.nonZeroVolZeroCount), marketsWithNoDelta: all.filter((t) => t.deltas === 0).length, serverPings: s.info.pings,
    idLower: sum((t) => t.idLower), idEqual: sum((t) => t.idEqual), crossedAfterApply: sum((t) => t.crossedAfterApply),
    maxLevelsHeld: Math.max(...all.map((t) => Math.max(t.maxBids, t.maxAsks))),
    snapLevelsMax: Math.max(...all.flatMap((t) => [...t.snapBids, ...t.snapAsks])),
    oneSidedSnapshots: all.filter((t) => t.snapBids[0] === 0 || t.snapAsks[0] === 0).length,
    quietest: [...trackers].map(([m, t]) => [m, t.deltas, t.maxGapMs]).sort((x, y) => x[1] - y[1]).slice(0, 6),
    busiest: [...trackers].map(([m, t]) => [m, t.deltas]).sort((x, y) => y[1] - x[1]).slice(0, 4),
  });
  for (const [m, t] of trackers) {
    if (t.mismatch.skipLower > 0 || t.mismatch.applyAll > 0 || t.atOrBelowSnap.lower + t.atOrBelowSnap.equal > 0 || t.snapshots !== 1) log('batch_market', summarize(m, t));
  }
}

async function silence() {
  const plans = [
    ['nothing', (ws) => {}],
    ['heartbeat only', (ws) => subscribe(ws, [], ['heartbeat'])],
    ['quiet book, no heartbeat', (ws) => subscribe(ws, ['OMG-AUD'], ['orderbookUpdate'])], // OMG-AUD sent no delta in the 60 s batch run of 2026-09-23
    ['nothing, client protocol ping every 20 s', (ws) => { const t = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 20_000); ws.on('close', () => clearInterval(t)); }],
  ];
  const sockets = [];
  for (const [label, plan] of plans) {
    const s = open(label);
    s.frames = 0;
    s.lastFrame = null;
    s.pongs = 0;
    s.ws.on('message', () => { s.frames++; s.lastFrame = Date.now() - s.info.t0; });
    s.ws.on('pong', () => s.pongs++);
    await s.ready;
    plan(s.ws);
    sockets.push(s);
    await sleep(OPEN_SPACING_MS);
  }
  const deadline = Date.now() + 120_000 - OPEN_SPACING_MS * plans.length;
  while (Date.now() < deadline && sockets.some((s) => s.info.closeAt === null)) await sleep(1_000);
  for (const s of sockets) {
    log('silence', { label: s.info.label, openMs: s.info.openMs, closedAtMs: s.info.closeAt, closeCode: s.info.closeCode, heldMs: s.info.closeAt ?? Date.now() - s.info.t0, frames: s.frames, lastFrameAtMs: s.lastFrame, serverPings: s.info.pings, pongs: s.pongs });
    if (s.info.closeAt === null) s.ws.close();
  }
  await sleep(300);
}

async function deflate() {
  const s = open('deflate', { deflate: true });
  await s.ready;
  let compressedFrames = 0;
  s.ws.on('message', () => compressedFrames++);
  subscribe(s.ws, ['BTC-AUD'], ['orderbookUpdate']);
  await sleep(3_000);
  s.ws.close();
  await sleep(300);
  log('deflate', { openMs: s.info.openMs, negotiated: s.info.headers?.ext ?? null, frames: compressedFrames });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
