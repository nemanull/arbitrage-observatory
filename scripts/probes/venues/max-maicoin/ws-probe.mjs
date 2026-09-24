// MAX (MaiCoin) WebSocket probe: the spot book channel, its fi, li and v chain, level order and window, a REST book compare, errors, keepalive, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/max-maicoin/ws-probe.mjs [book|batch|silence|deflate]
//   book     book depth 50 on four markets plus ticker, trade and market_status for about 60 s, client pings every 20 s, error cases, REST compare, and a side socket that subscribes one market twice. About 70 s.
//   batch    book depth 50 on every market of the catalog on one connection, one subscribe frame, for 40 s.
//   silence  four sockets held 90 s: a quiet book and a busy book with no client ping, and a quiet book with a protocol ping or an application ping every 40 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/max-maicoin/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://max-stream.maicoin.com/ws';
const API = 'https://max-api.maicoin.com';
const OUT = process.env.PROBE_OUT_DIR;
const MODE = process.argv[2] ?? 'book';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

let captured = 0;
function capture(name, text) {
  if (!OUT || captured > 4_000_000) return;
  mkdirSync(OUT, { recursive: true });
  const line = text.length > 4000 ? text.slice(0, 4000) + '…' : text;
  captured += line.length;
  appendFileSync(join(OUT, name), line + '\n');
}

function open(opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  ws.once('upgrade', (res) => {
    ws.upgradeHeaders = res.headers;
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('error', reject);
  });
}

const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

// One book per market, kept by the documented rule: snapshot replaces, drop fi <= li, first update needs fi <= li + 1 <= its li, v must match.
function makeBook(market) {
  return {
    market, bids: new Map(), asks: new Map(), li: null, v: null,
    snapshots: 0, updates: 0, gaps: 0, dropped: 0, vChanges: 0, emptyUpdates: 0, contiguous: 0, overlap: 0,
    fiEqLi: 0, maxBids: 0, maxAsks: 0, snapLevels: [], lagMs: [], maxQuietMs: 0, lastRecv: null,
    zeroSizeAbsent: 0, snapOrder: null, firstSnapMs: null, snapAgeMs: [], preSnapshot: 0, idGaps: 0, sinceSnap: 0, snapRecv: null, snapT: null,
    updOrder: { bids: { asc: 0, desc: 0, mixed: 0 }, asks: { asc: 0, desc: 0, mixed: 0 } },
  };
}

const orderOf = (xs) => (isDesc(xs) ? 'desc' : isAsc(xs) ? 'asc' : 'mixed');

function applyLevels(side, levels, book) {
  for (const [p, s] of levels) {
    if (Number(s) === 0) {
      if (!side.has(p)) book.zeroSizeAbsent++;
      side.delete(p);
    } else side.set(p, s);
  }
}

const isDesc = (xs) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) > Number(x[0]));
const isAsc = (xs) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) < Number(x[0]));

function onBook(book, msg, recv, subAt) {
  if (book.lastRecv !== null) book.maxQuietMs = Math.max(book.maxQuietMs, recv - book.lastRecv);
  book.lastRecv = recv;
  book.lagMs.push(recv - msg.T);
  if (msg.e === 'snapshot') {
    book.snapshots++;
    if (book.firstSnapMs === null) book.firstSnapMs = Math.round(recv - subAt);
    book.bids = new Map();
    book.asks = new Map();
    applyLevels(book.bids, msg.b, book);
    applyLevels(book.asks, msg.a, book);
    book.snapLevels.push([msg.b.length, msg.a.length]);
    book.snapOrder = { bids: orderOf(msg.b), asks: orderOf(msg.a) };
    book.snapAgeMs.push(recv - msg.T);
    book.li = msg.li;
    book.sinceSnap = 0;
    book.snapRecv = recv;
    book.snapT = msg.T;
    if (book.v !== null && book.v !== msg.v) book.vChanges++;
    book.v = msg.v;
    return;
  }
  book.updates++;
  book.sinceSnap++;
  if (!msg.a.length && !msg.b.length) book.emptyUpdates++;
  if (msg.fi === msg.li) book.fiEqLi++;
  if (msg.b.length > 1) book.updOrder.bids[orderOf(msg.b)]++;
  if (msg.a.length > 1) book.updOrder.asks[orderOf(msg.a)]++;
  if (book.li === null) {
    book.gaps++;
    book.preSnapshot++;
    return;
  }
  if (msg.v !== book.v) {
    book.vChanges++;
    book.gaps++;
    return;
  }
  if (msg.li <= book.li) {
    book.dropped++;
    return;
  }
  if (msg.fi === book.li + 1) book.contiguous++;
  else if (msg.fi <= book.li) book.overlap++;
  else {
    book.gaps++;
    book.idGaps++;
    log('gap', {
      market: book.market, localLi: book.li, fi: msg.fi, li: msg.li, updateNoSinceSnapshot: book.sinceSnap,
      msSinceSnapshotRecv: recv - book.snapRecv, updateTMinusSnapshotT: msg.T - book.snapT, sides: [msg.b.length, msg.a.length],
    });
  }
  applyLevels(book.bids, msg.b, book);
  applyLevels(book.asks, msg.a, book);
  book.li = msg.li;
  book.maxBids = Math.max(book.maxBids, book.bids.size);
  book.maxAsks = Math.max(book.maxAsks, book.asks.size);
}

function bookSummary(b) {
  return {
    market: b.market, snapshots: b.snapshots, firstSnapMs: b.firstSnapMs, snapLevels: b.snapLevels.slice(0, 3), snapOrder: b.snapOrder,
    updates: b.updates, contiguous: b.contiguous, overlap: b.overlap, dropped: b.dropped, gaps: b.gaps, vChanges: b.vChanges,
    emptyUpdates: b.emptyUpdates, fiEqLi: b.fiEqLi, updOrder: b.updOrder, snapAgeMs: b.snapAgeMs,
    maxBids: b.maxBids, maxAsks: b.maxAsks, zeroSizeAbsent: b.zeroSizeAbsent, maxQuietMs: b.maxQuietMs, lagMs: stats(b.lagMs),
  };
}

async function restCompare(book) {
  const res = await fetch(`${API}/api/v3/depth?market=${book.market}&limit=50&sort_by_price=false`);
  const r = await res.json();
  const localBids = [...book.bids.keys()].sort((a, b) => Number(b) - Number(a)).slice(0, 20);
  const localAsks = [...book.asks.keys()].sort((a, b) => Number(a) - Number(b)).slice(0, 20);
  let same = 0;
  for (const [p, s] of r.bids.slice(0, 20)) if (book.bids.get(p) === s) same++;
  for (const [p, s] of r.asks.slice(0, 20)) if (book.asks.get(p) === s) same++;
  log('rest_compare', {
    market: book.market, restLastUpdateId: r.last_update_id, restVersion: r.last_update_version, wsLi: book.li, wsV: book.v,
    top40SameSize: same, restBestBid: r.bids[0], wsBestBid: [localBids[0], book.bids.get(localBids[0])], restBestAsk: r.asks[0], wsBestAsk: [localAsks[0], book.asks.get(localAsks[0])],
  });
}

async function bookMode() {
  const markets = ['btcusdt', 'usdttwd', 'btctwd', 'gsttwd'];
  const books = new Map(markets.map((m) => [m, makeBook(m)]));
  const { ws, openMs } = await open();
  log('open', { url: WS_URL, openMs, extensions: ws.extensions, server: ws.upgradeHeaders?.server ?? null });
  let serverPings = 0;
  const pongMs = [];
  let pingAt = 0;
  ws.on('ping', () => serverPings++);
  ws.on('pong', (d) => pongMs.push(Math.round(performance.now() - pingAt)));
  const counts = {};
  const firstOf = {};
  let subAt = 0;
  ws.on('message', (data, isBinary) => {
    const recv = Date.now();
    const text = data.toString();
    const msg = JSON.parse(text);
    const key = `${msg.c ?? '-'}:${msg.e}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (!firstOf[key]) {
      firstOf[key] = true;
      capture('book-first-frames.jsonl', text);
    }
    if (msg.e === 'error' || msg.e === 'subscribed' || msg.e === 'unsubscribed') log('control', { recvMinusSubMs: recv - subAt, frame: text.slice(0, 600), isBinary });
    if (msg.c === 'book' && books.has(msg.M)) onBook(books.get(msg.M), msg, recv, subAt);
  });
  const sub = {
    action: 'sub',
    subscriptions: [
      ...markets.map((m) => ({ channel: 'book', market: m, depth: 50 })),
      { channel: 'ticker', market: 'btcusdt' },
      { channel: 'trade', market: 'btcusdt' },
      { channel: 'market_status' },
    ],
    id: 'probe-book',
  };
  subAt = Date.now();
  ws.send(JSON.stringify(sub));
  const ping = setInterval(() => {
    pingAt = performance.now();
    ws.ping('probe');
  }, 20_000);
  await sleep(45_000);
  // Error and edge cases on the same socket, after the main books have run.
  const cases = [
    { action: 'sub', subscriptions: [{ channel: 'book', market: 'nopeusdt', depth: 50 }], id: 'unknown-market' },
    { action: 'sub', subscriptions: [{ channel: 'book', market: 'ethusdt', depth: 30 }], id: 'depth-30' },
    { action: 'sub', subscriptions: [{ channel: 'nope', market: 'btcusdt' }], id: 'unknown-channel' },
    { action: 'nope', id: 'bad-action' },
    { action: 'ping', id: 'app-ping' },
  ];
  for (const c of cases) {
    subAt = Date.now();
    ws.send(JSON.stringify(c));
    await sleep(700);
  }
  subAt = Date.now();
  ws.send('not json');
  await sleep(1500);
  const quietMarket = [...books.values()].sort((a, b) => a.updates - b.updates)[0];
  await restCompare(books.get('btcusdt'));
  await restCompare(books.get('usdttwd'));
  await sideSocket();
  await restCompare(books.get('btctwd'));
  clearInterval(ping);
  log('frame_counts', { counts, serverPings, pongMs });
  for (const b of books.values()) log('book', bookSummary(b));
  log('quietest', { market: quietMarket.market });
  ws.close();
  await sleep(500);
}

// Same market twice on one socket, first at the same depth and then at another depth, to see whether frames can be told apart.
async function sideSocket() {
  const { ws } = await open();
  const seen = new Map();
  const events = [];
  let phase = 'first';
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.e === 'subscribed' || msg.e === 'error') events.push({ phase, e: msg.e, i: msg.i, E: msg.E });
    if (msg.c !== 'book') return;
    if (msg.e === 'snapshot') events.push({ phase, e: 'snapshot', levels: [msg.b.length, msg.a.length], keys: Object.keys(msg) });
    else {
      const k = `${msg.fi}-${msg.li}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
    }
  });
  const sub = (depth, id) => ws.send(JSON.stringify({ action: 'sub', subscriptions: [{ channel: 'book', market: 'btcusdt', depth }], id }));
  sub(50, 'first');
  await sleep(3_000);
  const before = [...seen.values()].filter((n) => n > 1).length;
  phase = 'duplicate';
  sub(50, 'duplicate');
  await sleep(3_000);
  const afterDup = [...seen.values()].filter((n) => n > 1).length;
  phase = 'second-depth';
  sub(5, 'second-depth');
  await sleep(3_000);
  const afterDepth = [...seen.values()].filter((n) => n > 1).length;
  log('side_socket', { events, updateIdsSeenTwice: { first3s: before, afterDuplicate: afterDup, afterSecondDepth: afterDepth }, distinctUpdates: seen.size });
  ws.close();
}

async function batchMode() {
  const res = await fetch(`${API}/api/v3/markets`);
  const markets = (await res.json()).filter((m) => m.status === 'active').map((m) => m.id);
  const books = new Map(markets.map((m) => [m, makeBook(m)]));
  const { ws, openMs } = await open();
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  const perSecond = [];
  let secFrames = 0;
  const control = [];
  let subAt = 0;
  ws.on('message', (data) => {
    const recv = Date.now();
    const text = data.toString();
    frames++;
    secFrames++;
    bytes += text.length;
    const t0 = performance.now();
    const msg = JSON.parse(text);
    parseUs += (performance.now() - t0) * 1000;
    if (msg.e === 'error' || msg.e === 'subscribed') control.push({ ms: recv - subAt, frame: text.slice(0, 300) });
    if (msg.c === 'book' && books.has(msg.M)) onBook(books.get(msg.M), msg, recv, subAt);
  });
  const tick = setInterval(() => {
    perSecond.push(secFrames);
    secFrames = 0;
  }, 1000);
  subAt = Date.now();
  ws.send(JSON.stringify({ action: 'sub', subscriptions: markets.map((m) => ({ channel: 'book', market: m, depth: 50 })), id: 'batch' }));
  await sleep(40_000);
  clearInterval(tick);
  const all = [...books.values()];
  const snapMs = all.map((b) => b.firstSnapMs).filter((x) => x !== null);
  log('batch', {
    openMs, markets: markets.length, control: control.slice(0, 3), controlCount: control.length,
    withSnapshot: all.filter((b) => b.snapshots > 0).length, snapshotsTotal: all.reduce((s, b) => s + b.snapshots, 0),
    lastSnapshotMs: Math.max(...snapMs), updates: all.reduce((s, b) => s + b.updates, 0),
    gaps: all.reduce((s, b) => s + b.gaps, 0), preSnapshot: all.reduce((s, b) => s + b.preSnapshot, 0), idGaps: all.reduce((s, b) => s + b.idGaps, 0),
    vChanges: all.reduce((s, b) => s + b.vChanges, 0), overlap: all.reduce((s, b) => s + b.overlap, 0), dropped: all.reduce((s, b) => s + b.dropped, 0),
    emptyUpdates: all.reduce((s, b) => s + b.emptyUpdates, 0),
    framesPerSecond: stats(perSecond), bytesPerSecond: Math.round(bytes / 40), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: +(parseUs / frames).toFixed(1),
    quietMaxMs: stats(all.map((b) => b.maxQuietMs)), neverUpdated: all.filter((b) => b.updates === 0).map((b) => b.market).length,
    oneSidedSnapshots: all.filter((b) => b.snapLevels.some(([nb, na]) => nb === 0 || na === 0)).map((b) => [b.market, b.snapLevels[0]]),
    snapLevelsMin: Math.min(...all.flatMap((b) => b.snapLevels.map(([nb, na]) => Math.min(nb, na)))),
    maxLevelsSeen: Math.max(...all.map((b) => Math.max(b.maxBids, b.maxAsks))),
  });
  ws.close();
  await sleep(500);
}

async function silenceMode() {
  const HOLD_MS = 90_000;
  const results = [];
  // keep: 'none', 'ping' for a protocol ping frame, or 'app' for {"action":"ping"}, every 40 s. ws answers server pings on its own.
  async function one(name, market, keep) {
    const { ws, openMs } = await open();
    const t0 = Date.now();
    let frames = 0;
    let serverPings = 0;
    const pongs = [];
    ws.on('ping', () => serverPings++);
    ws.on('pong', () => pongs.push(+((Date.now() - t0) / 1000).toFixed(1)));
    ws.on('message', (d) => {
      frames++;
      if (d.toString().includes('"e":"pong"')) pongs.push(+((Date.now() - t0) / 1000).toFixed(1));
    });
    ws.send(JSON.stringify({ action: 'sub', subscriptions: [{ channel: 'book', market, depth: 1 }], id: name }));
    const timer = keep === 'none' ? null : setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      if (keep === 'ping') ws.ping();
      else ws.send(JSON.stringify({ action: 'ping', id: name }));
    }, 40_000);
    const closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString(), atS: +((Date.now() - t0) / 1000).toFixed(2) })));
    const res = await Promise.race([closed, sleep(HOLD_MS).then(() => null)]);
    if (timer) clearInterval(timer);
    results.push({ name, openMs, frames, serverPings, pongsAtS: pongs, closed: res ?? `open at ${HOLD_MS / 1000} s` });
    if (!res) ws.terminate();
  }
  await Promise.all([
    one('quiet-no-ping', 'gsttwd', 'none'),
    one('busy-no-ping', 'btcusdt', 'none'),
    one('quiet-protocol-ping-40s', 'gsttwd', 'ping'),
    one('quiet-app-ping-40s', 'gsttwd', 'app'),
  ]);
  log('silence', { results });
}

async function deflateMode() {
  const { ws, openMs } = await open({ deflate: true });
  log('deflate', { openMs, negotiated: ws.extensions, header: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, server: ws.upgradeHeaders?.server ?? null });
  let firstBinary = null;
  ws.on('message', (d, isBinary) => {
    if (firstBinary === null) firstBinary = isBinary;
  });
  ws.send(JSON.stringify({ action: 'sub', subscriptions: [{ channel: 'book', market: 'btcusdt', depth: 1 }], id: 'deflate' }));
  await sleep(2_000);
  log('deflate_frames', { firstFrameBinary: firstBinary });
  ws.close();
  await sleep(300);
}

const modes = { book: bookMode, batch: batchMode, silence: silenceMode, deflate: deflateMode };
if (!modes[MODE]) throw new Error(`unknown mode ${MODE}`);
await modes[MODE]();
process.exit(0);
