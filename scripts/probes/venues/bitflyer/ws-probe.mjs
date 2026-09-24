// bitFlyer Lightning Realtime API probe over JSON-RPC 2.0: book snapshot and delta channels of the Crypto CFD FX_BTC_JPY, acknowledgements, cadence, level order, a local book checked against every snapshot, size unit against REST, keepalive, silence, errors, compression, and the Socket.IO handshake.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks once.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitflyer/ws-probe.mjs [book|errors|silence|deflate|socketio]
//   book      one socket with board_snapshot, board, ticker and executions of FX_BTC_JPY plus board_snapshot and board of BTC_JPY, for 60 s, with a REST board compare, a book kept from deltas only, and the mid_price check. About 62 s.
//   errors    unknown product, unknown channel, missing params, unknown method, duplicate subscribe, a batch of two, a request without id, text that is not JSON. About 12 s.
//   silence   two sockets for up to 90 s: no subscription, and a quiet subscription. Logs server pings, gaps and closes. About 90 s.
//   deflate   asks for permessage-deflate once and prints what the server negotiates. About 3 s.
//   socketio  opens the Socket.IO endpoint with the websocket transport and prints the handshake frame. About 5 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/bitflyer/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_RPC = 'wss://ws.lightstream.bitflyer.com/json-rpc';
const URL_IO = 'wss://io.lightstream.bitflyer.com/socket.io/?EIO=3&transport=websocket';
const API = 'https://api.bitflyer.com/v1';
const CFD = 'FX_BTC_JPY';
const SPOT = 'BTC_JPY';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const opened = new Promise((resolve, reject) => {
    ws.once('open', () => resolve(Math.round(performance.now() - t0)));
    ws.once('error', reject);
  });
  return { ws, opened };
}

let nextId = 1;
const rpc = (method, params, id = nextId++) => JSON.stringify({ jsonrpc: '2.0', method, params, id });

class Book {
  bids = new Map();
  asks = new Map();
  reset(msg) {
    this.bids.clear();
    this.asks.clear();
    this.apply(msg);
  }
  apply(msg) {
    for (const l of msg.bids) l.size === 0 ? this.bids.delete(l.price) : this.bids.set(l.price, l.size);
    for (const l of msg.asks) l.size === 0 ? this.asks.delete(l.price) : this.asks.set(l.price, l.size);
  }
  top(n) {
    const b = [...this.bids].sort((x, y) => y[0] - x[0]).slice(0, n);
    const a = [...this.asks].sort((x, y) => x[0] - y[0]).slice(0, n);
    return { b, a };
  }
}

const topOf = (msg, n) => ({
  b: msg.bids.map((l) => [l.price, l.size]).sort((x, y) => y[0] - x[0]).slice(0, n),
  a: msg.asks.map((l) => [l.price, l.size]).sort((x, y) => x[0] - y[0]).slice(0, n),
});

function diffTop(local, snap) {
  let diff = 0;
  for (const side of ['b', 'a']) {
    for (let i = 0; i < snap[side].length; i++) {
      const l = local[side][i];
      const s = snap[side][i];
      if (!l || l[0] !== s[0] || Math.abs(l[1] - s[1]) > 1e-9) diff++;
    }
  }
  return diff;
}

// Splits the difference between a delta-only book and a snapshot inside the snapshot's top 20 price range.
function classify(book, snap) {
  const out = { staleInBook: [], missingInBook: [], sizeDiffers: [] };
  for (const [side, map] of [['b', book.bids], ['a', book.asks]]) {
    const levels = snap[side];
    if (levels.length === 0) continue;
    const lo = Math.min(levels[0][0], levels[levels.length - 1][0]);
    const hi = Math.max(levels[0][0], levels[levels.length - 1][0]);
    const want = new Map(levels);
    for (const [p, sz] of map) {
      if (p < lo || p > hi) continue;
      if (!want.has(p)) out.staleInBook.push([side, p, sz]);
      else if (Math.abs(want.get(p) - sz) > 1e-9) out.sizeDiffers.push([side, p, sz, want.get(p)]);
    }
    for (const [p, sz] of levels) if (!map.has(p)) out.missingInBook.push([side, p, sz]);
  }
  return { stale: out.staleInBook.length, missing: out.missingInBook.length, sizeDiffers: out.sizeDiffers.length, examples: { stale: out.staleInBook.slice(0, 3), missing: out.missingInBook.slice(0, 3), sizeDiffers: out.sizeDiffers.slice(0, 3) } };
}

const isDesc = (arr) => arr.every((l, i) => i === 0 || l.price < arr[i - 1].price);
const isAsc = (arr) => arr.every((l, i) => i === 0 || l.price > arr[i - 1].price);

async function book() {
  const { ws, opened } = open(URL_RPC);
  const tCreate = Date.now();
  log('open', { url: URL_RPC, ms: await opened, extensions: ws.extensions ?? null });
  const channels = [
    `lightning_board_snapshot_${CFD}`,
    `lightning_board_${CFD}`,
    `lightning_ticker_${CFD}`,
    `lightning_executions_${CFD}`,
    `lightning_board_snapshot_${SPOT}`,
    `lightning_board_${SPOT}`,
  ];
  const sentAt = {};
  const idToChannel = {};
  const stats = {};
  for (const ch of channels) stats[ch] = { frames: 0, bytes: 0, first: null, arrivals: [], levels: [], unorderedBids: 0, unorderedAsks: 0, empty: 0, priceZero: 0, maxBids: 0, maxAsks: 0 };
  const books = { [CFD]: new Book(), [SPOT]: new Book() };
  const synced = { [CFD]: false, [SPOT]: false };
  const checks = { [CFD]: [], [SPOT]: [] };
  const bufferedDeltas = { [CFD]: 0, [SPOT]: 0 };
  // A second book per product is seeded by the first snapshot and then fed deltas only, to see whether the delta stream alone stays whole.
  const deltaOnly = { [CFD]: null, [SPOT]: null };
  const ring = { [CFD]: [], [SPOT]: [] };
  const pending = { [CFD]: [], [SPOT]: [] };
  const match = { [CFD]: { past: [], future: [], none: 0 }, [SPOT]: { past: [], future: [], none: 0 } };
  const midCheck = { [CFD]: { equal: 0, differ: 0, examples: [] }, [SPOT]: { equal: 0, differ: 0, examples: [] } };
  const fp = (top) => JSON.stringify(top);
  let pings = 0;
  let firstSnapshotCfd;
  const tickerAges = [];
  ws.on('ping', () => {
    pings++;
    log('server_ping', { atS: Math.round((Date.now() - tCreate) / 1000) });
  });
  ws.on('message', (raw) => {
    const t = Date.now();
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.id !== undefined) {
      log('ack', { id: m.id, channel: idToChannel[m.id], ms: t - sentAt[m.id], frame: m });
      capture('ack.jsonl', text);
      return;
    }
    if (m.method !== 'channelMessage') {
      log('other', { frame: text.slice(0, 300) });
      return;
    }
    const ch = m.params.channel;
    const msg = m.params.message;
    const s = stats[ch];
    s.frames++;
    s.bytes += text.length;
    s.arrivals.push(t);
    if (s.first === null) {
      s.first = t - sentAt[channels.indexOf(ch) + 1];
      capture(`first_${ch}.json`, text);
    }
    if (ch.startsWith('lightning_ticker_')) {
      tickerAges.push(t - Date.parse(msg.timestamp));
      return;
    }
    if (!ch.startsWith('lightning_board')) return;
    const product = ch.replace('lightning_board_snapshot_', '').replace('lightning_board_', '');
    s.levels.push(msg.bids.length + msg.asks.length);
    s.maxBids = Math.max(s.maxBids, msg.bids.length);
    s.maxAsks = Math.max(s.maxAsks, msg.asks.length);
    if (!isDesc(msg.bids)) s.unorderedBids++;
    if (!isAsc(msg.asks)) s.unorderedAsks++;
    if (msg.bids.length === 0 && msg.asks.length === 0) s.empty++;
    s.priceZero += msg.bids.concat(msg.asks).filter((l) => l.price === 0).length;
    if (ch.includes('_snapshot_')) {
      if (product === CFD && !firstSnapshotCfd) firstSnapshotCfd = msg;
      if (synced[product]) {
        const local = books[product].top(20);
        const snap = topOf(msg, 20);
        checks[product].push({ top20Diff: diffTop(local, snap), bestLocal: [local.b[0]?.[0], local.a[0]?.[0]], bestSnap: [snap.b[0]?.[0], snap.a[0]?.[0]], full: books[product].bids.size + books[product].asks.size, snapLevels: msg.bids.length + msg.asks.length });
      }
      if (deltaOnly[product] === null) {
        deltaOnly[product] = new Book();
        deltaOnly[product].reset(msg);
      } else {
        const want = fp(topOf(msg, 20));
        const hit = [...ring[product]].reverse().find((r) => r.fp === want);
        if (hit) match[product].past.push(t - hit.t);
        else if (fp(deltaOnly[product].top(20)) === want) match[product].past.push(0);
        else pending[product].push({ fp: want, t, snap: topOf(msg, 20) });
      }
      books[product].reset(msg);
      synced[product] = true;
      if (s.frames <= 2) capture(`snapshot_${product}.json`, JSON.stringify({ ...m, params: { ...m.params, message: { ...msg, bids: msg.bids.slice(0, 3), asks: msg.asks.slice(0, 3) } } }));
    } else {
      if (!synced[product]) {
        bufferedDeltas[product]++;
        return;
      }
      books[product].apply(msg);
      const d = deltaOnly[product];
      d.apply(msg);
      const now = fp(d.top(20));
      ring[product].push({ t, fp: now });
      if (ring[product].length > 200) ring[product].shift();
      pending[product] = pending[product].filter((q) => {
        if (q.fp === now) {
          match[product].future.push(t - q.t);
          return false;
        }
        if (t - q.t > 3_000) {
          match[product].none++;
          if (match[product].none <= 3) log('unmatched_snapshot', { product, ...classify(d, q.snap) });
          return false;
        }
        return true;
      });
      const top = books[product].top(1);
      if (top.b[0] && top.a[0]) {
        const mid = (top.b[0][0] + top.a[0][0]) / 2;
        if (Math.floor(mid) === msg.mid_price || mid === msg.mid_price) midCheck[product].equal++;
        else {
          midCheck[product].differ++;
          if (midCheck[product].examples.length < 3) midCheck[product].examples.push({ localMid: mid, frameMid: msg.mid_price });
        }
      }
      const zeros = msg.bids.concat(msg.asks).filter((l) => l.size === 0).length;
      s.zeroSizeLevels = (s.zeroSizeLevels ?? 0) + zeros;
      if (zeros > 0 && (s.zeroFramesKept = (s.zeroFramesKept ?? 0) + 1) <= 2) capture(`delta_${product}.json`, text);
    }
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  for (const ch of channels) {
    const id = nextId;
    sentAt[id] = Date.now();
    idToChannel[id] = ch;
    ws.send(rpc('subscribe', { channel: ch }));
  }
  await sleep(30_000);

  // Compare the socket's touch with the REST board read now.
  const rest = await (await fetch(`${API}/getboard?product_code=${CFD}`)).json();
  const local = books[CFD].top(10);
  const restTop = topOf(rest, 10);
  let samePrice = 0;
  let sameSize = 0;
  for (const side of ['b', 'a']) {
    for (const [p, sz] of restTop[side]) {
      const mine = books[CFD][side === 'b' ? 'bids' : 'asks'].get(p);
      if (mine !== undefined) {
        samePrice++;
        if (Math.abs(mine - sz) < 1e-9) sameSize++;
      }
    }
  }
  log('rest_compare', { restLevels: rest.bids.length + rest.asks.length, restTop20PricesFoundInSocketBook: samePrice, ofWhichSameSize: sameSize, restBest: [restTop.b[0], restTop.a[0]], socketBest: [local.b[0], local.a[0]] });
  await sleep(30_000);
  ws.close();

  for (const ch of channels) {
    const s = stats[ch];
    const gaps = s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]).sort((a, b) => a - b);
    const lv = [...s.levels].sort((a, b) => a - b);
    log('channel_summary', {
      ch,
      frames: s.frames,
      perS: +(s.frames / 60).toFixed(1),
      bytesPerFrame: s.frames ? Math.round(s.bytes / s.frames) : 0,
      firstFrameMsAfterSubscribe: s.first,
      gapMs: gaps.length ? { min: gaps[0], median: gaps[Math.floor(gaps.length / 2)], max: gaps[gaps.length - 1] } : null,
      levelsPerFrame: lv.length ? { min: lv[0], median: lv[Math.floor(lv.length / 2)], max: lv[lv.length - 1] } : null,
      maxBids: s.maxBids,
      maxAsks: s.maxAsks,
      framesWithBidsNotDescending: s.unorderedBids,
      framesWithAsksNotAscending: s.unorderedAsks,
      emptyFrames: s.empty,
      priceZeroLevels: s.priceZero,
      zeroSizeLevels: s.zeroSizeLevels ?? 0,
    });
  }
  for (const p of [CFD, SPOT]) {
    const c = checks[p];
    log('snapshot_check', {
      product: p,
      deltasBeforeFirstSnapshot: bufferedDeltas[p],
      snapshotsCompared: c.length,
      top20Identical: c.filter((x) => x.top20Diff === 0).length,
      bestIdentical: c.filter((x) => x.bestLocal[0] === x.bestSnap[0] && x.bestLocal[1] === x.bestSnap[1]).length,
      worst: c.reduce((w, x) => (x.top20Diff > (w?.top20Diff ?? -1) ? x : w), null),
    });
  }
  const ages = [...tickerAges].sort((a, b) => a - b);
  log('ticker_timestamp_age', { frames: ages.length, minMs: ages[0], medianMs: ages[Math.floor(ages.length / 2)], maxMs: ages[ages.length - 1] });
  if (firstSnapshotCfd) {
    log('first_snapshot_cfd', { mid_price: firstSnapshotCfd.mid_price, bids: firstSnapshotCfd.bids.length, asks: firstSnapshotCfd.asks.length, bidsDescending: isDesc(firstSnapshotCfd.bids), asksAscending: isAsc(firstSnapshotCfd.asks), top2: { b: firstSnapshotCfd.bids.slice(0, 2), a: firstSnapshotCfd.asks.slice(0, 2) } });
  }
  for (const p of [CFD, SPOT]) {
    log('delta_only_book', { product: p, snapshotMatchedAnEarlierDeltaState: match[p].past.length, lagMs: match[p].past, snapshotMatchedALaterDeltaState: match[p].future.length, leadMs: match[p].future, unmatchedWithin3s: match[p].none + pending[p].length });
    log('mid_price_check', { product: p, ...midCheck[p] });
  }
  log('pings', { serverPings: pings });
}

async function errors() {
  const { ws, opened } = open(URL_RPC);
  log('open', { ms: await opened });
  const got = [];
  ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.method === 'channelMessage') {
      got.push(m.params.channel);
      return;
    }
    log('reply', { frame: m });
    capture('errors.jsonl', text);
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  const cases = [
    ['unknown product', rpc('subscribe', { channel: 'lightning_board_NOPE_JPY' }, 101)],
    ['unknown channel', rpc('subscribe', { channel: 'nope_channel' }, 102)],
    ['alias', rpc('subscribe', { channel: 'lightning_board_BTCJPY_MAT1WK' }, 103)],
    ['missing params', JSON.stringify({ jsonrpc: '2.0', method: 'subscribe', id: 104 })],
    ['unknown method', rpc('nope', { channel: `lightning_board_${CFD}` }, 105)],
    ['first subscribe', rpc('subscribe', { channel: `lightning_ticker_${CFD}` }, 106)],
    ['duplicate subscribe', rpc('subscribe', { channel: `lightning_ticker_${CFD}` }, 107)],
    ['batch of two', JSON.stringify([
      { jsonrpc: '2.0', method: 'subscribe', params: { channel: `lightning_board_snapshot_${CFD}` }, id: 108 },
      { jsonrpc: '2.0', method: 'subscribe', params: { channel: `lightning_board_${CFD}` }, id: 109 },
    ])],
    ['no id, a notification', JSON.stringify({ jsonrpc: '2.0', method: 'subscribe', params: { channel: `lightning_executions_${CFD}` } })],
    ['no jsonrpc field', JSON.stringify({ method: 'subscribe', params: { channel: `lightning_board_snapshot_${SPOT}` }, id: 110 })],
    ['private channel without auth', rpc('subscribe', { channel: 'child_order_events' }, 111)],
    ['unsubscribe', rpc('unsubscribe', { channel: `lightning_ticker_${CFD}` }, 112)],
    ['not json', 'hello'],
  ];
  for (const [name, frame] of cases) {
    log('send', { case: name, frame: frame.slice(0, 200) });
    if (ws.readyState !== ws.OPEN) break;
    ws.send(frame);
    await sleep(700);
  }
  await sleep(3_000);
  const counts = {};
  for (const c of got) counts[c] = (counts[c] ?? 0) + 1;
  log('delivered', { counts });
  ws.close();
  await sleep(300);
}

async function silence() {
  const cases = [
    ['no_subscription', null],
    ['quiet', 'lightning_executions_BCH_BTC'],
  ];
  const results = await Promise.all(
    cases.map(async ([name, ch]) => {
      const { ws, opened } = open(URL_RPC);
      await opened;
      const t0 = Date.now();
      const pings = [];
      let frames = 0;
      let lastFrame = t0;
      let maxGap = 0;
      ws.on('ping', () => pings.push(Math.round((Date.now() - t0) / 1000)));
      ws.on('message', () => {
        const t = Date.now();
        maxGap = Math.max(maxGap, t - lastFrame);
        lastFrame = t;
        frames++;
      });
      if (ch) ws.send(rpc('subscribe', { channel: ch }));
      const closed = new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString(), atMs: Date.now() - t0 })));
      const timer = sleep(90_000).then(() => null);
      const close = await Promise.race([closed, timer]);
      if (!close) ws.terminate();
      return { name, ch, frames, maxGapMs: Math.max(maxGap, Date.now() - lastFrame), serverPingsAtS: pings, closedByServer: close };
    }),
  );
  for (const r of results) log('silence', r);
}

async function deflate() {
  const { ws, opened } = open(URL_RPC, { perMessageDeflate: true });
  let ext = null;
  ws.on('upgrade', (res) => (ext = res.headers['sec-websocket-extensions'] ?? null));
  log('deflate', { ms: await opened, negotiated: ext, wsExtensions: ws.extensions });
  ws.close();
}

async function socketio() {
  const { ws, opened } = open(URL_IO);
  log('open', { url: URL_IO, ms: await opened });
  const frames = [];
  ws.on('message', (raw) => frames.push(raw.toString().slice(0, 300)));
  await sleep(1_000);
  ws.send(`42${JSON.stringify(['subscribe', `lightning_ticker_${CFD}`])}`);
  await sleep(3_000);
  log('socketio_frames', { count: frames.length, first: frames.slice(0, 4) });
  ws.close();
}

const modes = { book, errors, silence, deflate, socketio };
const arg = process.argv[2] ?? 'book';
if (!modes[arg]) throw new Error(`unknown mode ${arg}`);
log('mode', { mode: arg, at: new Date().toISOString() });
await modes[arg]();
process.exit(0);
