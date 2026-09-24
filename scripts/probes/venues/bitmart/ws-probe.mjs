// BitMart futures WebSocket probe: book channels, snapshot and version chain, level order and window, size unit against REST, ticker and funding channels, keepalive, silence, errors, and a batch of perpetuals on one connection.
// Public, unauthenticated and read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitmart/ws-probe.mjs [book|channels|cadence|ticker|framecap|batch|silence|deflate]
//   book      depthIncrease50@100ms on six perps for 60 s with a REST book compare, about 65 s
//   channels  the other book channels, bookticker, ticker with and without a symbol, fundingRate, the request action, pings and errors, about 45 s
//   cadence   twelve book, best bid and ask, and trade channels on BTCUSDT at once for 25 s, arrival and ms_t gaps, about 26 s
//   ticker    futures/ticker without a symbol for 40 s: which contracts it pushes, how often, and how often mark and index change, about 42 s
//   framecap  one socket per subscribe frame size from 1,000 to 3,500 bytes, to find the size the server closes on, about 20 s
//   batch     depthIncrease50@100ms on every contract that traded in the last 24 h, on one connection, for 60 s, about 65 s
//   silence   five sockets that differ only in what the client subscribes and sends, for up to 75 s
//   deflate   asks for permessage-deflate once and prints what the server negotiates
// Set PROBE_OUT_DIR to keep raw frames.
// Recorded in docs/profiles/bitmart/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUBLIC = 'wss://openapi-ws-v2.bitmart.com/api?protocol=1.1';
const API = 'https://api-cloud-v2.bitmart.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);
const stats = (xs) => (xs.length ? { n: xs.length, min: Math.min(...xs), p50: pct(xs, 0.5), p90: pct(xs, 0.9), max: Math.max(...xs) } : { n: 0 });
const trim = (s, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(label, { deflate = false } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(URL_PUBLIC, { perMessageDeflate: deflate });
  const state = { ws, label, openedMs: null, closed: null, pongs: [], serverPings: [], frames: 0, binary: 0, ext: null };
  ws.on('ping', () => state.serverPings.push(Math.round(performance.now() - t0)));
  ws.on('upgrade', (res) => (state.ext = res.headers['sec-websocket-extensions'] ?? null));
  ws.on('open', () => (state.openedMs = Math.round(performance.now() - t0)));
  ws.on('pong', () => state.pongs.push(Date.now()));
  ws.on('close', (code, reason) => (state.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }));
  ws.on('error', (e) => (state.error = e.message));
  return new Promise((resolve) => {
    ws.once('open', () => resolve(state));
    ws.once('close', () => resolve(state));
  });
}

const send = (s, obj) => s.ws.readyState === WebSocket.OPEN && s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));

function parse(raw) {
  const text = raw.toString('utf8');
  try {
    return { text, msg: JSON.parse(text) };
  } catch {
    return { text, msg: null };
  }
}

// A local book per stream: snapshot resets, update applies when version is last + 1.
function makeTracker() {
  return {
    snapshots: 0,
    updates: 0,
    gaps: [],
    stale: 0,
    emptyUpdates: 0,
    firstType: null,
    firstAfterSnapshot: [],
    snapLevels: [],
    maxLevels: [0, 0],
    unorderedBidArrays: 0,
    unorderedAskArrays: 0,
    snapshotBidOrder: null,
    snapshotAskOrder: null,
    crossed: 0,
    interFrameMs: [],
    lastAt: null,
    version: null,
    bids: new Map(),
    asks: new Map(),
    sameAsPrevious: 0,
    prevKey: null,
  };
}

const levelsOf = (side) => (side ?? []).map((l) => (Array.isArray(l) ? [l[0], l[1]] : [l.price, l.vol]));
const isDesc = (ls) => ls.every((l, i) => i === 0 || Number(l[0]) < Number(ls[i - 1][0]));
const isAsc = (ls) => ls.every((l, i) => i === 0 || Number(l[0]) > Number(ls[i - 1][0]));

function applyIncrease(t, data, now) {
  const bids = levelsOf(data.bids);
  const asks = levelsOf(data.asks);
  if (t.lastAt !== null) t.interFrameMs.push(now - t.lastAt);
  t.lastAt = now;
  if (t.firstType === null) t.firstType = data.type;
  const key = JSON.stringify([bids, asks]);
  if (key === t.prevKey && data.type === 'update') t.sameAsPrevious++;
  t.prevKey = key;
  if (data.type === 'snapshot') {
    t.snapshots++;
    t.bids = new Map(bids);
    t.asks = new Map(asks);
    t.snapLevels.push([bids.length, asks.length]);
    t.snapshotBidOrder = isDesc(bids) ? 'desc' : isAsc(bids) ? 'asc' : 'unordered';
    t.snapshotAskOrder = isAsc(asks) ? 'asc' : isDesc(asks) ? 'desc' : 'unordered';
    t.version = data.version;
    t.justSnapped = true;
    return;
  }
  t.updates++;
  if (t.justSnapped) {
    t.firstAfterSnapshot.push(data.version - t.version);
    t.justSnapped = false;
  }
  if (bids.length === 0 && asks.length === 0) t.emptyUpdates++;
  if (bids.length > 1 && !isDesc(bids)) t.unorderedBidArrays++;
  if (asks.length > 1 && !isAsc(asks)) t.unorderedAskArrays++;
  if (t.version !== null && data.version <= t.version) {
    t.stale++;
    return;
  }
  if (t.version !== null && data.version !== t.version + 1) t.gaps.push(data.version - t.version - 1);
  t.version = data.version;
  for (const [p, v] of bids) (Number(v) === 0 ? t.bids.delete(p) : t.bids.set(p, v));
  for (const [p, v] of asks) (Number(v) === 0 ? t.asks.delete(p) : t.asks.set(p, v));
  t.maxLevels = [Math.max(t.maxLevels[0], t.bids.size), Math.max(t.maxLevels[1], t.asks.size)];
  const bb = Math.max(...[...t.bids.keys()].map(Number));
  const ba = Math.min(...[...t.asks.keys()].map(Number));
  if (t.bids.size && t.asks.size && bb >= ba) t.crossed++;
}

const summary = (t) => ({
  firstType: t.firstType,
  snapshots: t.snapshots,
  snapLevels: t.snapLevels.slice(0, 3),
  snapshotOrder: `${t.snapshotBidOrder}/${t.snapshotAskOrder}`,
  updates: t.updates,
  firstUpdateVersionMinusSnapshot: [...new Set(t.firstAfterSnapshot)],
  gaps: t.gaps.length,
  gapSizes: t.gaps.slice(0, 5),
  stale: t.stale,
  emptyUpdates: t.emptyUpdates,
  sameAsPrevious: t.sameAsPrevious,
  unorderedDeltaArrays: `${t.unorderedBidArrays}/${t.unorderedAskArrays}`,
  maxLevelsHeld: t.maxLevels,
  levelsNow: [t.bids.size, t.asks.size],
  crossedAfterApply: t.crossed,
  interFrameMs: stats(t.interFrameMs),
});

async function restBook(symbol) {
  const r = await fetch(`${API}/contract/public/depth?symbol=${symbol}`);
  return (await r.json()).data;
}

async function book() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'FOLKSUSDT', 'ASTEROIDETHUSDT', 'BTCUSD', 'BTCUSDC'];
  const s = await open('book');
  log('open', { ms: s.openedMs, extensions: s.ext });
  const trackers = Object.fromEntries(symbols.map((x) => [x, makeTracker()]));
  const acks = [];
  let subSentAt = null;
  const firstFrameMs = {};
  let other = 0;
  s.ws.on('message', (raw, isBinary) => {
    const now = Date.now();
    s.frames++;
    if (isBinary) s.binary++;
    const { text, msg } = parse(raw);
    capture('book.txt', trim(text, 1500));
    if (msg?.action) {
      acks.push(trim(text, 300));
      return;
    }
    if (msg?.group?.startsWith('futures/depthIncrease50:') && msg.data) {
      const sym = msg.data.symbol;
      if (firstFrameMs[sym] === undefined) firstFrameMs[sym] = now - subSentAt;
      applyIncrease(trackers[sym], msg.data, now);
      return;
    }
    other++;
  });
  subSentAt = Date.now();
  const frame = { action: 'subscribe', args: symbols.map((x) => `futures/depthIncrease50:${x}@100ms`) };
  send(s, frame);
  log('subscribe frame', { frame: JSON.stringify(frame), bytes: JSON.stringify(frame).length });
  const ping = setInterval(() => send(s, { action: 'ping' }), 15_000);
  await sleep(30_000);
  // REST compare at the same moment, on the liquid and the thin book.
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'ASTEROIDETHUSDT', 'BTCUSD']) {
    const rb = await restBook(sym);
    const t = trackers[sym];
    const localBids = [...t.bids.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 20);
    const restMap = new Map((rb.bids ?? []).map((l) => [l[0], l[1]]));
    const equal = localBids.filter(([p, v]) => restMap.get(p) === v).length;
    log('rest compare', { symbol: sym, topLocal: localBids[0], topRest: rb.bids?.[0]?.slice(0, 2), top20BidSizesEqualAtSamePrice: `${equal} of ${localBids.length}` });
    await sleep(300);
  }
  await sleep(30_000);
  clearInterval(ping);
  s.ws.close();
  await sleep(300);
  log('book summary', { frames: s.frames, binaryFrames: s.binary, acks: acks.slice(0, 3), otherFrames: other, firstFrameMsAfterSubscribe: firstFrameMs, closed: s.closed });
  for (const sym of symbols) log(`stream ${sym}`, summary(trackers[sym]));
}

async function channels() {
  const s = await open('channels');
  const seen = {};
  const samples = {};
  const log2 = [];
  const tickerAll = new Set();
  const types = {};
  let tickerAllFrames = 0;
  s.ws.on('message', (raw) => {
    const { text, msg } = parse(raw);
    capture('channels.txt', trim(text, 1500));
    const key = msg?.group ?? (msg?.action ? `ack ${msg.action}` : `text ${trim(text, 40)}`);
    seen[key] = (seen[key] ?? 0) + 1;
    if (!samples[key]) samples[key] = trim(text, 700);
    if (msg?.action || !msg) log2.push({ at: Date.now(), text: trim(text, 300) });
    if (msg?.data?.type) (types[key] ??= new Set()).add(`${msg.data.type} v${msg.data.version} bids ${msg.data.bids?.length} asks ${msg.data.asks?.length}`);
    if (msg?.group === 'futures/ticker') {
      tickerAllFrames++;
      tickerAll.add(msg.data?.symbol);
    }
  });
  const sub = (args) => send(s, { action: 'subscribe', args });
  sub(['futures/depth50:BTCUSDT@100ms']);
  sub(['futures/depthAll20:BTCUSDT@100ms']);
  sub(['futures/v2/depthAll20:ETHUSDT@200ms']);
  sub(['futures/v2/depthIncrease20:ETHUSDT@100ms']);
  sub(['futures/bookticker:BTCUSDT']);
  sub(['futures/ticker:BTCUSDT']);
  sub(['futures/ticker:ASTEROIDETHUSDT']);
  sub(['futures/fundingRate:BTCUSDT']);
  sub(['futures/ticker']);
  await sleep(20_000);
  const errors = [
    ['futures/depthIncrease50:NOPEUSDT@100ms'],
    ['futures/depthIncrease50:THETAUSDT@100ms'],
    ['futures/depthIncrease50:LUNAUSDT@100ms'],
    ['futures/depthIncrease30:BTCUSDT@100ms'],
    ['futures/depthIncrease50:BTCUSDT@50ms'],
    ['futures/depthIncrease50:BTCUSDT'],
    ['futures/nope:BTCUSDT'],
    ['futures/depth50:BTCUSDT@100ms'],
  ];
  for (const args of errors) {
    sub(args);
    await sleep(400);
  }
  send(s, { action: 'request', args: ['futures/depthIncrease50:ETHUSDT@100ms'] });
  await sleep(400);
  send(s, { action: 'request', args: ['futures/fundingRate:ETHUSDT'] });
  await sleep(400);
  send(s, 'not json');
  await sleep(400);
  const t0 = Date.now();
  send(s, 'ping');
  await sleep(600);
  send(s, { action: 'ping' });
  await sleep(600);
  s.ws.ping();
  await sleep(600);
  send(s, { action: 'unsubscribe', args: ['futures/ticker'] });
  await sleep(3000);
  s.ws.close();
  await sleep(300);
  log('channel frame counts over about 30 s', { seen });
  for (const [k, v] of Object.entries(samples)) log('sample', { key: k, text: v });
  log('control and error frames in order', { frames: log2.map((f) => `${f.at - t0} ms ${f.text}`) });
  log('depthIncrease frame types per group', Object.fromEntries(Object.entries(types).map(([k, v]) => [k, [...v].slice(0, 3)])));
  log('ticker without symbol', { frames: tickerAllFrames, distinctSymbols: tickerAll.size, protocolPongs: s.pongs.map((p) => p - t0) });
}

async function cadence() {
  const variants = [
    'futures/depthIncrease5:BTCUSDT@100ms',
    'futures/depthIncrease20:BTCUSDT@100ms',
    'futures/depthIncrease50:BTCUSDT@200ms',
    'futures/depthIncrease50:BTCUSDT',
    'futures/depth5:BTCUSDT@100ms',
    'futures/depth20:BTCUSDT@200ms',
    'futures/depthAll5:BTCUSDT@100ms',
    'futures/depthAll50:BTCUSDT@100ms',
    'futures/v2/depthAll5:BTCUSDT@100ms',
    'futures/v2/depthIncrease50:BTCUSDT@100ms',
    'futures/bookticker:BTCUSDT',
    'futures/trade:BTCUSDT',
  ];
  const s = await open('cadence');
  const at = Object.fromEntries(variants.map((v) => [v, []]));
  const msT = Object.fromEntries(variants.map((v) => [v, []]));
  const empty = Object.fromEntries(variants.map((v) => [v, 0]));
  const first = {};
  s.ws.on('message', (raw) => {
    const { msg } = parse(raw);
    if (!msg?.group || msg.action || !at[msg.group]) return;
    at[msg.group].push(Date.now());
    first[msg.group] ??= trim(JSON.stringify(msg), 220);
    const d = Array.isArray(msg.data) ? msg.data[0] : msg.data;
    if (d?.ms_t) msT[msg.group].push(d.ms_t);
    if (d && Array.isArray(d.bids) && Array.isArray(d.asks) && d.bids.length + d.asks.length === 0) empty[msg.group]++;
  });
  send(s, { action: 'subscribe', args: variants });
  const ping = setInterval(() => send(s, { action: 'ping' }), 15_000);
  await sleep(25_000);
  clearInterval(ping);
  s.ws.close();
  await sleep(300);
  for (const v of variants) {
    const gaps = at[v].slice(1).map((t, i) => t - at[v][i]);
    const serverGaps = msT[v].slice(1).map((t, i) => t - msT[v][i]);
    log('cadence', { channel: v, frames: at[v].length, emptyFrames: empty[v], arrivalGapMs: stats(gaps), msTGapMs: stats(serverGaps), first: v.includes('/v2/') ? first[v] : undefined });
  }
}

// The ticker without a symbol pushes every contract, with mark_price and index_price, so it is the only bulk source of the mark.
async function ticker() {
  const d = await (await fetch(`${API}/contract/public/details`)).json();
  const rows = Object.fromEntries(d.data.symbols.map((r) => [r.symbol, r]));
  const s = await open('ticker');
  const per = new Map();
  let frames = 0;
  let bytes = 0;
  let t0 = null;
  s.ws.on('message', (raw) => {
    const { msg } = parse(raw);
    if (msg?.group !== 'futures/ticker' || !msg.data) return;
    frames++;
    bytes += raw.length;
    const x = msg.data;
    const p = per.get(x.symbol) ?? { at: [], marks: [], idx: [], zeroMark: 0, zeroBook: 0 };
    p.at.push(Date.now());
    p.marks.push(x.mark_price);
    p.idx.push(x.index_price);
    if (Number(x.mark_price) === 0) p.zeroMark++;
    if (Number(x.bid_price) === 0 && Number(x.ask_price) === 0) p.zeroBook++;
    p.last = x;
    per.set(x.symbol, p);
  });
  t0 = Date.now();
  send(s, { action: 'subscribe', args: ['futures/ticker'] });
  const ping = setInterval(() => send(s, { action: 'ping' }), 15_000);
  await sleep(40_000);
  clearInterval(ping);
  s.ws.close();
  await sleep(300);
  const changes = (xs) => xs.slice(1).filter((v, i) => v !== xs[i]).length;
  const all = [...per.entries()];
  const trading = Object.values(rows).filter((r) => r.status === 'Trading');
  const live = new Set(trading.filter((r) => Number(r.volume_24h) > 0).map((r) => r.symbol));
  const gapStats = (list) => stats(list.flatMap(([, p]) => p.at.slice(1).map((t, i) => t - p.at[i])));
  log('ticker all', {
    seconds: Math.round((Date.now() - t0) / 1000),
    frames,
    framesPerSecond: Math.round(frames / 40),
    kbPerSecond: Math.round(bytes / 1024 / 40),
    distinctSymbols: per.size,
    tradingNotSeen: trading.filter((r) => !per.has(r.symbol)).length,
    tradingWithVolumeNotSeen: [...live].filter((x) => !per.has(x)),
    delistedSeen: all.filter(([k]) => rows[k]?.status !== 'Trading').map(([k]) => k).slice(0, 10),
    liveGapMs: gapStats(all.filter(([k]) => live.has(k))),
    silentGapMs: gapStats(all.filter(([k]) => !live.has(k))),
    liveFramesPerSymbol: stats(all.filter(([k]) => live.has(k)).map(([, p]) => p.at.length)),
    liveMarkChangesPerSymbol: stats(all.filter(([k]) => live.has(k)).map(([, p]) => changes(p.marks))),
    liveIndexChangesPerSymbol: stats(all.filter(([k]) => live.has(k)).map(([, p]) => changes(p.idx))),
    zeroMarkSymbols: all.filter(([, p]) => p.zeroMark > 0).map(([k]) => k).slice(0, 10),
    zeroBookLiveSymbols: all.filter(([k, p]) => live.has(k) && p.zeroBook === p.at.length).map(([k]) => k),
    zeroBookSilentSymbols: all.filter(([k, p]) => !live.has(k) && p.zeroBook === p.at.length).length,
  });
  for (const k of ['BTCUSDT', 'ETHUSDT', 'ASTEROIDETHUSDT', 'BTCUSD', 'THETAUSDT', 'MUUSDT']) {
    const p = per.get(k);
    if (!p) {
      log('ticker symbol', { symbol: k, frames: 0 });
      continue;
    }
    const markPremiumPpm = Math.round((Number(p.last.mark_price) / Number(p.last.index_price) - 1) * 1e6);
    log('ticker symbol', { symbol: k, frames: p.at.length, gapsMs: p.at.slice(1).map((t, i) => t - p.at[i]).slice(0, 12), markChanges: changes(p.marks), indexChanges: changes(p.idx), markPremiumPpm, last: p.last });
  }
  const premiums = all
    .filter(([k, p]) => live.has(k) && Number(p.last.index_price) > 0)
    .map(([k, p]) => [k, Math.round((Number(p.last.mark_price) / Number(p.last.index_price) - 1) * 1e6)])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  log('mark over index premium on live contracts, ppm', { n: premiums.length, largest: premiums.slice(0, 8), absMedian: pct(premiums.map(([, v]) => Math.abs(v)), 0.5) });
}

// One socket per size, each sending a single subscribe frame of real topics, to find the frame size the server closes on.
async function framecap() {
  const d = await (await fetch(`${API}/contract/public/details`)).json();
  const topics = d.data.symbols.filter((r) => r.status === 'Trading' && Number(r.volume_24h) > 0).map((r) => `futures/depthIncrease50:${r.symbol}@100ms`);
  for (const target of [1000, 1800, 2048, 2200, 2600, 3000, 3500]) {
    const args = [];
    for (const t of topics) {
      if (JSON.stringify({ action: 'subscribe', args: [...args, t] }).length > target) break;
      args.push(t);
    }
    const frame = JSON.stringify({ action: 'subscribe', args });
    const s = await open(`cap ${target}`);
    let acks = 0;
    let data = 0;
    s.ws.on('message', (raw) => {
      const { msg } = parse(raw);
      if (msg?.action === 'subscribe' && msg.success) acks++;
      else if (msg?.data) data++;
    });
    send(s, frame);
    await sleep(2500);
    const closed = s.closed;
    if (!closed) s.ws.close();
    log('framecap', { frameBytes: frame.length, topics: args.length, acks, dataFrames: data, closed: closed ?? 'open after 2.5 s' });
    await sleep(300);
  }
}

async function batch() {
  const d = await (await fetch(`${API}/contract/public/details`)).json();
  const symbols = d.data.symbols.filter((r) => r.status === 'Trading' && Number(r.volume_24h) > 0).map((r) => r.symbol);
  const s = await open('batch');
  const trackers = Object.fromEntries(symbols.map((x) => [x, makeTracker()]));
  const acks = { ok: 0, fail: [] };
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  const perSecond = new Map();
  let t0 = null;
  s.ws.on('message', (raw) => {
    const now = Date.now();
    const p0 = performance.now();
    const { text, msg } = parse(raw);
    parseUs += (performance.now() - p0) * 1000;
    if (msg?.action === 'subscribe') {
      if (msg.success) acks.ok++;
      else acks.fail.push(trim(text, 200));
      return;
    }
    if (!msg?.data?.symbol || !trackers[msg.data.symbol]) return;
    frames++;
    bytes += raw.length;
    const sec = Math.floor((now - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    applyIncrease(trackers[msg.data.symbol], msg.data, now);
  });
  // The documented cap is 4096 bytes for all topics in one frame, but framecap saw a 2,186 byte frame closed with 1009, so frames stay under 2,000 bytes.
  const chunks = [];
  let cur = [];
  for (const sym of symbols) {
    const next = [...cur, `futures/depthIncrease50:${sym}@100ms`];
    if (JSON.stringify({ action: 'subscribe', args: next }).length > 2000) {
      chunks.push(cur);
      cur = [`futures/depthIncrease50:${sym}@100ms`];
    } else cur = next;
  }
  if (cur.length) chunks.push(cur);
  t0 = Date.now();
  for (const c of chunks) {
    send(s, { action: 'subscribe', args: c });
    await sleep(200);
  }
  const ping = setInterval(() => send(s, { action: 'ping' }), 15_000);
  await sleep(60_000);
  clearInterval(ping);
  s.ws.close();
  await sleep(300);
  const all = Object.values(trackers);
  const rates = [...perSecond.values()];
  log('batch', {
    symbols: symbols.length,
    subscribeFrames: chunks.length,
    frameBytes: chunks.map((c) => JSON.stringify({ action: 'subscribe', args: c }).length),
    acks,
    frames,
    framesPerSecond: stats(rates),
    kbPerSecond: Math.round(bytes / 1024 / 60),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: Math.round((parseUs / Math.max(1, frames)) * 10) / 10,
    streamsWithSnapshot: all.filter((t) => t.snapshots > 0).length,
    streamsWithoutFrames: symbols.filter((x) => trackers[x].snapshots + trackers[x].updates === 0),
    snapshotsTotal: all.reduce((a, t) => a + t.snapshots, 0),
    updates: all.reduce((a, t) => a + t.updates, 0),
    firstUpdateIsSnapshotPlusOne: all.filter((t) => t.firstAfterSnapshot.length && t.firstAfterSnapshot.every((d) => d === 1)).length,
    gaps: all.reduce((a, t) => a + t.gaps.length, 0),
    gapStreams: symbols.filter((x) => trackers[x].gaps.length).slice(0, 10),
    stale: all.reduce((a, t) => a + t.stale, 0),
    crossedAfterApply: all.reduce((a, t) => a + t.crossed, 0),
    maxLevelsHeld: Math.max(...all.map((t) => Math.max(...t.maxLevels))),
    oneSidedSnapshots: all.filter((t) => t.snapLevels.some(([b, a]) => b === 0 || a === 0)).length,
    longestSilenceMs: Math.max(...all.map((t) => (t.interFrameMs.length ? Math.max(...t.interFrameMs) : 0))),
    closed: s.closed,
  });
}

async function silence() {
  const cases = [
    { label: 'A no subscribe, sends nothing', args: null, every: null },
    { label: 'B quiet book, sends nothing', args: ['futures/depthIncrease50:ASTEROIDETHUSDT@100ms'], every: null },
    { label: 'C empty book, sends nothing', args: ['futures/depthIncrease50:THETAUSDT@100ms'], every: null },
    { label: 'D empty book, action ping every 15 s', args: ['futures/depthIncrease50:THETAUSDT@100ms'], every: 'action' },
    { label: 'E empty book, protocol ping every 15 s', args: ['futures/depthIncrease50:THETAUSDT@100ms'], every: 'protocol' },
  ];
  const sockets = [];
  for (const c of cases) {
    const s = await open(c.label);
    s.t0 = Date.now();
    s.lastFrame = null;
    s.frameTimes = [];
    s.ws.on('message', (raw) => {
      s.frameTimes.push(Date.now() - s.t0);
      capture('silence.txt', `${c.label} ${trim(raw.toString('utf8'), 300)}`);
    });
    if (c.args) send(s, { action: 'subscribe', args: c.args });
    if (c.every === 'action') s.timer = setInterval(() => send(s, { action: 'ping' }), 15_000);
    if (c.every === 'protocol') s.timer = setInterval(() => s.ws.readyState === WebSocket.OPEN && s.ws.ping(), 15_000);
    sockets.push({ c, s });
  }
  const until = Date.now() + 75_000;
  while (Date.now() < until && sockets.some(({ s }) => !s.closed)) await sleep(500);
  for (const { c, s } of sockets) {
    clearInterval(s.timer);
    const open = !s.closed;
    if (open) s.ws.close();
    log('silence', { label: c.label, closed: open ? 'still open at 75 s' : s.closed, frames: s.frameTimes.length, frameTimesMs: s.frameTimes.slice(0, 12), protocolPongs: s.pongs.length, serverProtocolPingsMs: s.serverPings.slice(0, 8) });
  }
  await sleep(300);
}

async function deflate() {
  const s = await open('deflate', { deflate: true });
  let binary = 0;
  let n = 0;
  s.ws.on('message', (raw, isBinary) => {
    n++;
    if (isBinary) binary++;
  });
  send(s, { action: 'subscribe', args: ['futures/depthIncrease50:BTCUSDT@100ms'] });
  await sleep(3000);
  s.ws.close();
  log('deflate', { offered: 'permessage-deflate', negotiated: s.ext, frames: n, binaryFrames: binary, openMs: s.openedMs });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, channels, cadence, ticker, framecap, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
