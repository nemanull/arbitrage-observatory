// Foxbit WebSocket v3 probe: the orderbook channel (snapshot, sequence chain, level order, size unit against REST), channel variants, errors, a batch of markets on one connection, keepalive, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode that asks for it once.
// Foxbit publishes 10 connections and 10 messages per 2 s per IP, 25 subscriptions per message and 50 per connection.
// Every mode stays inside the connection and message rates, and batch crosses each subscription cap once on purpose to record the refusal.
// Run from server/: node ../scripts/probes/venues/foxbit/ws-probe.mjs [book|channels|batch|silence|deflate]
//   book      orderbook-100 with snapshot on four markets for 60 s, ticker and trades on one, a REST book compare at 30 s, a ping every 20 s. About 62 s.
//   channels  the other intervals, snapshot false, and nine malformed, unknown or repeated requests, one socket each, 10 s. About 25 s.
//   batch     orderbook-100 with snapshot on 50 markets in two frames of 25 on one socket for 60 s, then a 51st, and a 26 entry frame on a second socket. About 65 s.
//   silence   four sockets that differ only in what the client subscribes or sends, for up to 120 s.
//   deflate   asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/foxbit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUBLIC = 'wss://api.foxbit.com.br/ws/v3/public';
const API = 'https://api.foxbit.com.br/rest/v3';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const r1 = (x) => Math.round(x);
const sub = (channel, market, snapshot) => ({ channel, market_symbol: market, ...(snapshot === undefined ? {} : { snapshot }) });
const subscribeFrame = (params) => JSON.stringify({ type: 'subscribe', params });
const PING = JSON.stringify({ type: 'message', params: [{ channel: 'ping' }] });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(url = URL_PUBLIC, opts = { perMessageDeflate: false }) {
  const t0 = Date.now();
  const ws = new WebSocket(url, opts);
  ws.t0 = t0;
  ws.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString(), atMs: Date.now() - t0 })));
  ws.on('error', (e) => log('socket_error', { message: e.message }));
  ws.on('upgrade', (res) => (ws.upgradeHeaders = res.headers));
  ws.opened = new Promise((resolve) => ws.on('open', () => resolve(Date.now() - t0)));
  return ws;
}

// A local book per market, keyed by price string, to check the chain, the window and the REST compare.
class Book {
  constructor() {
    this.bids = new Map();
    this.asks = new Map();
    this.seq = undefined;
  }
  apply(side, levels) {
    const m = side === 'bids' ? this.bids : this.asks;
    for (const [p, s] of levels) {
      if (Number(s) === 0) m.delete(Number(p));
      else m.set(Number(p), s);
    }
  }
  top(side, n) {
    const m = side === 'bids' ? this.bids : this.asks;
    const keys = [...m.keys()].sort((a, b) => (side === 'bids' ? b - a : a - b)).slice(0, n);
    return keys.map((k) => [k, m.get(k)]);
  }
}

function ordered(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (dir === 'desc' ? b >= a : b <= a) return false;
  }
  return true;
}

function newStats() {
  return { snapshots: 0, snapshotLevels: [], snapshotOrdered: true, snapshotAfterSubMs: undefined, deltas: 0, empty: 0, zeroSizes: 0, gaps: 0, firstLink: undefined, unorderedBids: 0, unorderedAsks: 0, maxBids: 0, maxAsks: 0, gapsMs: [], lastAt: 0, tsLagMs: [], multiSeq: 0, noop: 0 };
}

function handleBook(msg, books, stats, subAt, frameName) {
  const m = msg.params?.market_symbol;
  if (!m || !stats[m]) return;
  const st = stats[m];
  const now = Date.now();
  if (msg.event === 'snapshot') {
    const b = new Book();
    b.apply('bids', msg.data.bids);
    b.apply('asks', msg.data.asks);
    b.seq = msg.data.sequence_id;
    books[m] = b;
    st.snapshots++;
    st.snapshotLevels.push(`${msg.data.bids.length}/${msg.data.asks.length}`);
    if (!ordered(msg.data.bids, 'desc') || !ordered(msg.data.asks, 'asc')) st.snapshotOrdered = false;
    st.snapshotAfterSubMs ??= now - subAt;
    st.snapshotKeys = Object.keys(msg.data).sort().join(',');
    if (frameName) capture(frameName, JSON.stringify(msg));
    return;
  }
  if (msg.event !== 'update') return;
  const d = msg.data;
  const b = books[m];
  st.deltas++;
  if (st.lastAt) st.gapsMs.push(now - st.lastAt);
  st.lastAt = now;
  if (typeof d.ts === 'number') st.tsLagMs.push(now - d.ts);
  if (d.last_sequence_id > d.first_sequence_id) st.multiSeq++;
  if (!b) return;
  if (st.firstLink === undefined) st.firstLink = d.first_sequence_id - b.seq;
  if (d.first_sequence_id !== b.seq + 1) st.gaps++;
  b.seq = d.last_sequence_id;
  if ((d.bids?.length ?? 0) === 0 && (d.asks?.length ?? 0) === 0) st.empty++;
  let changed = false;
  for (const [side, map] of [['bids', b.bids], ['asks', b.asks]]) {
    for (const [p, s] of d[side] ?? []) {
      if (Number(s) === 0) st.zeroSizes++;
      const cur = map.get(Number(p));
      if (!(cur !== undefined && cur === s) && !(cur === undefined && Number(s) === 0)) changed = true;
    }
  }
  if (!changed) st.noop++;
  if (!ordered(d.bids ?? [], 'desc')) st.unorderedBids++;
  if (!ordered(d.asks ?? [], 'asc')) st.unorderedAsks++;
  b.apply('bids', d.bids ?? []);
  b.apply('asks', d.asks ?? []);
  st.maxBids = Math.max(st.maxBids, b.bids.size);
  st.maxAsks = Math.max(st.maxAsks, b.asks.size);
}

function summarize(stats, durS) {
  for (const [m, st] of Object.entries(stats)) {
    const g = st.gapsMs.sort((a, b) => a - b);
    const lag = st.tsLagMs.sort((a, b) => a - b);
    log('book_summary', {
      market: m, snapshots: st.snapshots, snapshotLevels: st.snapshotLevels.slice(0, 3), snapshotOrdered: st.snapshotOrdered, snapshotKeys: st.snapshotKeys, snapshotAfterSubMs: st.snapshotAfterSubMs,
      deltas: st.deltas, perSec: +(st.deltas / durS).toFixed(1), gaps: st.gaps, firstLinkMinusSnapshotSeq: st.firstLink, multiSeqDeltas: st.multiSeq, emptyDeltas: st.empty, noopDeltas: st.noop, zeroSizes: st.zeroSizes,
      unorderedBids: st.unorderedBids, unorderedAsks: st.unorderedAsks, maxBids: st.maxBids, maxAsks: st.maxAsks,
      interFrameMs: g.length ? { min: g[0], p10: g[Math.floor(g.length * 0.1)], median: g[Math.floor(g.length / 2)], max: g[g.length - 1] } : null,
      tsLagMs: lag.length ? { min: lag[0], median: lag[Math.floor(lag.length / 2)], max: lag[lag.length - 1] } : null,
    });
  }
}

async function book() {
  const markets = ['btcbrl', 'usdtbrl', 'btcusdt', 'solusdt'];
  const stats = Object.fromEntries(markets.map((m) => [m, newStats()]));
  const books = {};
  const ws = open();
  const openMs = await ws.opened;
  log('open', { url: URL_PUBLIC, openMs, cfRay: ws.upgradeHeaders?.['cf-ray'], extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null });
  const subAt = Date.now();
  const misc = { ticker: 0, trades: 0, pong: [], acks: [], other: [] };
  let pingAt = 0;
  let firstDelta = true;
  let firstTicker = true;
  let firstTrade = true;
  let bytes = 0;
  let frames = 0;
  ws.on('message', (raw) => {
    frames++;
    bytes += raw.length;
    const text = raw.toString();
    const msg = JSON.parse(text);
    const ch = msg.params?.channel ?? '';
    if (msg.event === 'success' && ch === 'ping') {
      misc.pong.push(Date.now() - pingAt);
      if (misc.pong.length === 1) capture('pong.json', text);
    } else if (msg.event === 'success') {
      misc.acks.push(`${ch} ${msg.params?.market_symbol} +${Date.now() - subAt}ms`);
      capture('ack.json', text);
    } else if (ch.startsWith('orderbook')) {
      if (msg.event === 'update' && firstDelta && msg.params.market_symbol === 'btcbrl') {
        capture('delta.json', text);
        firstDelta = false;
      }
      handleBook(msg, books, stats, subAt, `snapshot-${msg.params.market_symbol}.json`);
    } else if (ch === 'ticker') {
      misc.ticker++;
      if (firstTicker) log('ticker_frame', { text: text.slice(0, 700) });
      firstTicker = false;
    } else if (ch === 'trades') {
      misc.trades++;
      if (firstTrade) log('trade_frame', { text: text.slice(0, 500) });
      firstTrade = false;
    } else misc.other.push(text.slice(0, 300));
  });
  ws.send(subscribeFrame(markets.map((m) => sub('orderbook-100', m, true))));
  await sleep(300);
  ws.send(subscribeFrame([sub('ticker', 'btcbrl'), sub('trades', 'btcbrl')]));
  const ping = setInterval(() => {
    pingAt = Date.now();
    ws.send(PING);
  }, 20_000);
  pingAt = Date.now();
  ws.send(PING);
  await sleep(30_000);
  // REST compare: same prices, same sizes, at the nearest sequence.
  const res = await fetch(`${API}/markets/btcbrl/orderbook?depth=40`);
  const rest = await res.json();
  const local = books.btcbrl;
  if (local) {
    const cmp = { restSeq: rest.sequence_id, localSeq: local.seq, sameSize: 0, samePriceDiffSize: 0, priceMissing: 0 };
    for (const side of ['bids', 'asks']) {
      const lmap = side === 'bids' ? local.bids : local.asks;
      for (const [p, s] of rest[side].slice(0, 20)) {
        const ls = lmap.get(Number(p));
        if (ls === undefined) cmp.priceMissing++;
        else if (Number(ls) === Number(s)) cmp.sameSize++;
        else cmp.samePriceDiffSize++;
      }
    }
    cmp.localTopBid = local.top('bids', 1)[0];
    cmp.restTopBid = rest.bids[0];
    log('rest_compare_btcbrl', cmp);
  }
  await sleep(30_000);
  clearInterval(ping);
  ws.close();
  const closed = await ws.closed;
  summarize(stats, 60);
  log('book_misc', { frames, bytes, acks: misc.acks, tickerFrames: misc.ticker, tradeFrames: misc.trades, pongMs: misc.pong, other: misc.other.slice(0, 5), close: closed });
}

async function trial(name, frames, ms = 10_000, onOpen) {
  const ws = open();
  const got = [];
  ws.on('message', (raw) => got.push({ at: Date.now() - ws.t0, text: raw.toString() }));
  const openMs = await ws.opened;
  const sentAt = Date.now() - ws.t0;
  for (const f of frames) ws.send(f);
  if (onOpen) onOpen(ws);
  const result = await Promise.race([ws.closed, sleep(ms).then(() => null)]);
  if (result === null) ws.close();
  const counts = {};
  for (const g of got) {
    let k = 'unparsed';
    try {
      const m = JSON.parse(g.text);
      k = `${m.params?.channel ?? '-'}:${m.event ?? '-'}`;
    } catch {}
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const parsed = got.map((g) => {
    try {
      return { at: g.at, m: JSON.parse(g.text) };
    } catch {
      return { at: g.at, m: {} };
    }
  });
  const snap = parsed.find((g) => g.m.event === 'snapshot' && g.m.data?.bids);
  const snapLevels = snap ? `${snap.m.data.bids.length}/${snap.m.data.asks.length}` : undefined;
  const upd = parsed.filter((g) => g.m.event === 'update').map((g) => g.at);
  const distinctSeq = new Set(parsed.filter((g) => g.m.event === 'update').map((g) => g.m.data?.first_sequence_id)).size;
  const gaps = upd.slice(1).map((t, i) => t - upd[i]).sort((a, b) => a - b);
  log('trial', {
    name, openMs, counts, snapLevels, distinctUpdateSeq: distinctSeq, updateGapMedianMs: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null, updateGapMinMs: gaps[0] ?? null,
    first: got.slice(0, 2).map((g) => `+${g.at - sentAt}ms ${g.text.slice(0, 260)}`), closedBy: result,
  });
}

async function channels() {
  const variants = ['orderbook-250', 'orderbook-500', 'orderbook-1000', 'orderbook-50', 'orderbook'];
  const runs = variants.map((ch, i) => sleep(i * 300).then(() => trial(`btcbrl ${ch} snapshot true`, [subscribeFrame([sub(ch, 'btcbrl', true)])])));
  runs.push(sleep(1_500).then(() => trial('btcbrl orderbook-100 snapshot false', [subscribeFrame([sub('orderbook-100', 'btcbrl', false)])])));
  await Promise.all(runs);
  await sleep(2_500);
  const errs = [
    ['unknown market', [subscribeFrame([sub('orderbook-100', 'nopebrl', true)])]],
    ['valid and unknown in one frame', [subscribeFrame([sub('orderbook-100', 'ethbrl', true), sub('orderbook-100', 'nopebrl', true)])]],
    ['unknown channel', [subscribeFrame([sub('nope', 'btcbrl')])]],
    ['not json', ['hello']],
    ['unknown type', [JSON.stringify({ type: 'nope', params: [sub('orderbook-100', 'btcbrl', true)] })]],
    ['duplicate subscribe', [subscribeFrame([sub('orderbook-100', 'solusdt', true)]), subscribeFrame([sub('orderbook-100', 'solusdt', true)])]],
    ['uppercase market', [subscribeFrame([sub('orderbook-100', 'BTCBRL', true)])]],
    ['prediction market', [subscribeFrame([sub('orderbook-100', 'pred11brl', true)])]],
    ['unsubscribe after 3 s', [subscribeFrame([sub('orderbook-100', 'usdtbrl', true)])]],
  ];
  await Promise.all(
    errs.map(([name, frames], i) =>
      sleep(i * 300).then(() =>
        trial(name, frames, 10_000, name.startsWith('unsubscribe') ? (ws) => setTimeout(() => ws.send(JSON.stringify({ type: 'unsubscribe', params: [sub('orderbook-100', 'usdtbrl')] })), 3_000) : undefined),
      ),
    ),
  );
}

async function batch() {
  const res = await fetch(`${API}/markets/ticker/24hr`);
  const rows = (await res.json()).data;
  const ranked = rows.sort((a, b) => Number(b.rolling_24h.quote_volume) - Number(a.rolling_24h.quote_volume)).map((r) => r.market_symbol);
  const markets = ranked.slice(0, 51);
  const stats = Object.fromEntries(markets.map((m) => [m, newStats()]));
  const books = {};
  const ws = open();
  const openMs = await ws.opened;
  const subAt = Date.now();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSec = [];
  let secFrames = 0;
  const acks = [];
  const other = [];
  ws.on('message', (raw) => {
    frames++;
    secFrames++;
    bytes += raw.length;
    const t = process.hrtime.bigint();
    const msg = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t;
    if (msg.event === 'success') acks.push(msg.params?.market_symbol ?? msg.params?.channel);
    else if (msg.event === 'snapshot' || msg.event === 'update') handleBook(msg, books, stats, subAt);
    else other.push(JSON.stringify(msg).slice(0, 300));
  });
  const tick = setInterval(() => {
    perSec.push(secFrames);
    secFrames = 0;
  }, 1_000);
  const ping = setInterval(() => ws.send(PING), 20_000);
  ws.send(subscribeFrame(markets.slice(0, 25).map((m) => sub('orderbook-100', m, true))));
  await sleep(500);
  ws.send(subscribeFrame(markets.slice(25, 50).map((m) => sub('orderbook-100', m, true))));
  await sleep(5_000);
  log('batch_after_50', { openMs, acks: acks.length, snapshots: Object.values(stats).filter((s) => s.snapshots > 0).length });
  ws.send(subscribeFrame([sub('orderbook-100', markets[50], true)]));
  await sleep(55_000);
  clearInterval(tick);
  clearInterval(ping);
  const closedEarly = await Promise.race([ws.closed, sleep(10).then(() => null)]);
  ws.close();
  const s = perSec.slice(6).sort((a, b) => a - b);
  let gaps = 0;
  let deltas = 0;
  let unordered = 0;
  let empty = 0;
  for (const st of Object.values(stats)) {
    gaps += st.gaps;
    deltas += st.deltas;
    unordered += st.unorderedBids + st.unorderedAsks;
    empty += st.empty;
  }
  log('batch', {
    markets: 51, acks: acks.length, fiftyFirst: markets[50], fiftyFirstSnapshots: stats[markets[50]].snapshots, fiftyFirstDeltas: stats[markets[50]].deltas,
    snapshots: Object.values(stats).reduce((a, x) => a + x.snapshots, 0), deltas, gaps, unordered, empty,
    frames, bytes, framesPerSec: s.length ? { median: s[Math.floor(s.length / 2)], max: s[s.length - 1], mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1) } : null,
    bytesPerSec: r1(bytes / 60), bytesPerFrame: r1(bytes / frames), parseUsPerFrame: +(Number(parseNs) / frames / 1000).toFixed(1),
    quietestDeltas: Object.entries(stats).sort((a, b) => a[1].deltas - b[1].deltas).slice(0, 5).map(([m, st]) => `${m} ${st.deltas}`),
    other: other.slice(0, 5), closedEarly,
  });
  await sleep(1_000);
  await trial('26 entries in one frame', [subscribeFrame(ranked.slice(0, 26).map((m) => sub('orderbook-1000', m, false)))], 5_000);
}

async function silence() {
  const quiet = process.argv[3] ?? 'ftmann08brl';
  const mk = async (name, frames, pingEveryMs) => {
    const ws = open();
    await ws.opened;
    let received = 0;
    let lastFrameAt = 0;
    ws.on('message', () => {
      received++;
      lastFrameAt = Date.now() - ws.t0;
    });
    ws.on('ping', () => log('server_ping', { name, atMs: Date.now() - ws.t0 }));
    for (const f of frames) ws.send(f);
    const timer = pingEveryMs ? setInterval(() => ws.send(PING), pingEveryMs) : undefined;
    const result = await Promise.race([ws.closed, sleep(120_000).then(() => null)]);
    if (timer) clearInterval(timer);
    if (result === null) ws.close();
    log('silence', { name, received, lastFrameAtMs: lastFrameAt, closed: result ?? 'open at 120 s' });
  };
  await Promise.all([
    mk('no subscription, no ping', []),
    sleep(300).then(() => mk(`orderbook-1000 on quiet ${quiet}, no ping`, [subscribeFrame([sub('orderbook-1000', quiet, true)])])),
    sleep(600).then(() => mk('no subscription, ping every 20 s', [PING], 20_000)),
    sleep(900).then(() => mk('orderbook-1000 on busy btcbrl, no ping', [subscribeFrame([sub('orderbook-1000', 'btcbrl', false)])])),
  ]);
}

async function deflate() {
  const ws = open(URL_PUBLIC, { perMessageDeflate: true });
  const openMs = await ws.opened;
  let compressed = 0;
  ws.on('message', () => compressed++);
  ws.send(subscribeFrame([sub('orderbook-100', 'btcbrl', true)]));
  await sleep(3_000);
  ws.close();
  log('deflate', { openMs, negotiated: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, frames: compressed, cfRay: ws.upgradeHeaders?.['cf-ray'] });
}

const mode = process.argv[2] ?? 'book';
const run = { book, channels, batch, silence, deflate }[mode];
if (!run) {
  console.error('mode must be book, channels, batch, silence or deflate');
  process.exit(1);
}
await run();
process.exit(0);
