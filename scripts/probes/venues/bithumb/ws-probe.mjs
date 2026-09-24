// Bithumb spot WebSocket probe: the orderbook stream, its snapshot and level shape, repeats, the size unit, subscribe semantics, errors, keepalive, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bithumb/ws-probe.mjs [book|batch|errors|silence|deflate|legacy]
//   book     orderbook, ticker and trade on five markets for 45 s with a REST book compare, then eight request variants for 5 s each. About 95 s.
//   batch    orderbook on every KRW and BTC market in one request on one socket for 45 s. About 50 s.
//   errors   unknown, lowercase and mixed codes, missing ticket or type, text that is not JSON, and a second request on the same socket. About 25 s.
//   silence  four sockets that differ only in what the client sends, for 120 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates. About 5 s.
//   legacy   the older wss://pubwss.bithumb.com/pub/ws socket that CCXT Pro watchOrderBook uses, for 15 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/bithumb/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_V1 = 'wss://ws-api.bithumb.com/websocket/v1';
const URL_LEGACY = 'wss://pubwss.bithumb.com/pub/ws';
const API = 'https://api.bithumb.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => (xs.length === 0 ? { n: 0 } : { n: xs.length, min: Math.min(...xs), median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs) });
let captured = 0;

function capture(name, text) {
  if (!OUT || captured > 3_000_000) return;
  mkdirSync(OUT, { recursive: true });
  const line = text.length > 4000 ? text.slice(0, 4000) + '…' : text;
  captured += line.length;
  appendFileSync(join(OUT, name), line + '\n');
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected-response ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

const ticket = () => ({ ticket: `probe-${Math.random().toString(36).slice(2, 10)}` });
const unitsKey = (u) => JSON.stringify(u);

async function book() {
  const codes = ['KRW-BTC', 'KRW-ETH', 'KRW-USDT', 'BTC-ETH', 'KRW-EGG'];
  const { ws, openMs } = await open(URL_V1);
  log('open', { url: URL_V1, openMs });
  const sentAt = Date.now();
  ws.send(JSON.stringify([ticket(), { type: 'orderbook', codes }, { type: 'ticker', codes: ['KRW-BTC', 'KRW-EGG'] }, { type: 'trade', codes: ['KRW-BTC', 'KRW-EGG'] }, { format: 'DEFAULT' }]));
  const per = {};
  const other = {};
  const restCompare = [];
  let firstFrame;
  ws.on('message', (raw, isBinary) => {
    const recv = Date.now();
    const text = raw.toString('utf8');
    capture('book.jsonl', text);
    const m = JSON.parse(text);
    firstFrame ??= { isBinary, keys: Object.keys(m), afterSendMs: recv - sentAt };
    if (m.type !== 'orderbook') {
      const k = `${m.type}/${m.code}/${m.stream_type}`;
      other[k] = (other[k] ?? 0) + 1;
      return;
    }
    const s = (per[m.code] ??= { frames: 0, streamTypes: {}, levels: {}, repeats: 0, gaps: [], ages: [], last: undefined, lastRecv: undefined, bidDescBad: 0, askAscBad: 0, oneSided: 0, tsNonMonotonic: 0, lastTs: 0, firstAfterSendMs: recv - sentAt, levelField: m.level, sizeTypes: new Set(), zeroSizes: 0 });
    s.frames++;
    s.streamTypes[m.stream_type] = (s.streamTypes[m.stream_type] ?? 0) + 1;
    const u = m.orderbook_units;
    s.levels[u.length] = (s.levels[u.length] ?? 0) + 1;
    const key = unitsKey(u);
    if (s.last === key) s.repeats++;
    s.last = key;
    if (s.lastRecv !== undefined) s.gaps.push(recv - s.lastRecv);
    s.lastRecv = recv;
    const tsMs = m.timestamp > 1e14 ? m.timestamp / 1000 : m.timestamp;
    s.ages.push(recv - tsMs);
    if (m.timestamp < s.lastTs) s.tsNonMonotonic++;
    s.lastTs = m.timestamp;
    s.tsDigits = String(m.timestamp).length;
    for (let i = 1; i < u.length; i++) {
      if (u[i].bid_price !== 0 && u[i - 1].bid_price <= u[i].bid_price) s.bidDescBad++;
      if (u[i].ask_price !== 0 && u[i - 1].ask_price >= u[i].ask_price) s.askAscBad++;
    }
    for (const x of u) {
      s.sizeTypes.add(typeof x.bid_size);
      if (x.bid_price !== 0 && x.bid_size === 0) s.zeroSizes++;
      if (x.ask_price !== 0 && x.ask_size === 0) s.zeroSizes++;
    }
    if (u.some((x) => x.bid_price === 0) || u.some((x) => x.ask_price === 0)) s.oneSided++;
    s.lastFrame = m;
  });
  for (let i = 0; i < 3; i++) {
    await sleep(12_000);
    const t0 = Date.now();
    const res = await fetch(`${API}/v1/orderbook?markets=KRW-BTC`);
    const rest = (await res.json())[0];
    const sock = per['KRW-BTC']?.lastFrame;
    if (sock) {
      const restBids = new Map(rest.orderbook_units.map((x) => [x.bid_price, x.bid_size]));
      const restAsks = new Map(rest.orderbook_units.map((x) => [x.ask_price, x.ask_size]));
      let same = 0;
      let samePrice = 0;
      for (const x of sock.orderbook_units) {
        if (restBids.has(x.bid_price)) { samePrice++; if (restBids.get(x.bid_price) === x.bid_size) same++; }
        if (restAsks.has(x.ask_price)) { samePrice++; if (restAsks.get(x.ask_price) === x.ask_size) same++; }
      }
      restCompare.push({ restMs: Date.now() - t0, sockLevels: sock.orderbook_units.length, restLevels: rest.orderbook_units.length, pricesInBoth: samePrice, sizesEqual: same, sockTop: sock.orderbook_units[0], restTop: rest.orderbook_units[0], sockTs: sock.timestamp, restTs: rest.timestamp });
    }
  }
  await sleep(9_000);
  ws.close();
  log('first_frame', firstFrame);
  for (const [code, s] of Object.entries(per)) {
    log('orderbook', { code, frames: s.frames, perSecond: +(s.frames / 45).toFixed(2), firstAfterSendMs: s.firstAfterSendMs, streamTypes: s.streamTypes, levels: s.levels, levelField: s.levelField, repeats: s.repeats, gapMs: stats(s.gaps), ageMs: stats(s.ages), tsDigits: s.tsDigits, tsNonMonotonic: s.tsNonMonotonic, bidDescBad: s.bidDescBad, askAscBad: s.askAscBad, paddedFrames: s.oneSided, zeroSizeAtPriceSides: s.zeroSizes, sizeTypes: [...s.sizeTypes] });
  }
  log('other_streams', other);
  for (const c of restCompare) log('rest_compare', c);

  // A ".30" suffix, a grouping level and the SIMPLE format, each on a fresh socket for 5 s.
  const variants = {
    suffix30: [ticket(), { type: 'orderbook', codes: ['KRW-BTC.30'] }],
    suffix5: [ticket(), { type: 'orderbook', codes: ['KRW-BTC.5'] }],
    level1000: [ticket(), { type: 'orderbook', codes: ['KRW-BTC'], level: 1000 }],
    level7: [ticket(), { type: 'orderbook', codes: ['KRW-BTC'], level: 7 }],
    simple: [ticket(), { type: 'orderbook', codes: ['KRW-BTC'] }, { format: 'SIMPLE' }],
    onlySnapshot: [ticket(), { type: 'orderbook', codes: ['KRW-BTC'], isOnlySnapshot: true }],
    onlySnapshotSnake: [ticket(), { type: 'orderbook', codes: ['KRW-BTC'], is_only_snapshot: true }],
    onlyRealtime: [ticket(), { type: 'orderbook', codes: ['KRW-BTC'], isOnlyRealtime: true }],
  };
  for (const [name, req] of Object.entries(variants)) {
    const { ws: v } = await open(URL_V1);
    const frames = [];
    v.on('message', (raw) => frames.push(JSON.parse(raw.toString('utf8'))));
    v.send(JSON.stringify(req));
    await sleep(5_000);
    v.close();
    const f = frames[0] ?? {};
    const units = f.orderbook_units ?? f.obu ?? [];
    log('variant', { name, frames: frames.length, keys: Object.keys(f).slice(0, 12), code: f.code ?? f.cd, levels: units.length, level: f.level ?? f.lv, streamTypes: [...new Set(frames.map((x) => x.stream_type ?? x.st))], top: units[0], error: f.error });
    capture(`variant-${name}.jsonl`, JSON.stringify(frames.slice(0, 2)));
    await sleep(300);
  }
}

async function batch() {
  const all = await (await fetch(`${API}/v1/market/all`)).json();
  const codes = all.map((m) => m.market);
  const { ws, openMs } = await open(URL_V1);
  log('open', { url: URL_V1, openMs, codes: codes.length });
  const sentAt = Date.now();
  ws.send(JSON.stringify([ticket(), { type: 'orderbook', codes }]));
  const seen = new Map();
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  const perSecond = [];
  let secCount = 0;
  let lastSec = Math.floor(Date.now() / 1000);
  let firstSnapshotAll;
  ws.on('message', (raw) => {
    const recv = Date.now();
    const t0 = performance.now();
    const m = JSON.parse(raw.toString('utf8'));
    parseUs += (performance.now() - t0) * 1000;
    frames++;
    bytes += raw.length;
    const sec = Math.floor(recv / 1000);
    if (sec !== lastSec) {
      perSecond.push(secCount);
      secCount = 0;
      lastSec = sec;
    }
    secCount++;
    if (m.type !== 'orderbook') return;
    const s = seen.get(m.code) ?? { frames: 0, first: recv - sentAt, last: recv, maxGap: 0, snapshot: 0, levels: m.orderbook_units.length, paddedBid: false, paddedAsk: false, zeroSizeAtPrice: 0 };
    const u = m.orderbook_units;
    if (u.some((x) => x.bid_price === 0)) s.paddedBid = true;
    if (u.some((x) => x.ask_price === 0)) s.paddedAsk = true;
    s.zeroSizeAtPrice += u.filter((x) => (x.bid_price !== 0 && x.bid_size === 0) || (x.ask_price !== 0 && x.ask_size === 0)).length;
    if (s.frames > 0) s.maxGap = Math.max(s.maxGap, recv - s.last);
    s.last = recv;
    s.frames++;
    if (m.stream_type === 'SNAPSHOT') s.snapshot++;
    seen.set(m.code, s);
    if (firstSnapshotAll === undefined && seen.size === codes.length) firstSnapshotAll = recv - sentAt;
  });
  await sleep(45_000);
  ws.close();
  const end = Date.now();
  const list = [...seen.values()];
  const tailGap = [...seen.entries()].map(([code, s]) => ({ code, gap: Math.max(s.maxGap, end - s.last) }));
  tailGap.sort((a, b) => b.gap - a.gap);
  const levelCounts = {};
  for (const s of list) levelCounts[s.levels] = (levelCounts[s.levels] ?? 0) + 1;
  log('batch', {
    requested: codes.length,
    delivered: seen.size,
    snapshotOnFirst: list.filter((s) => s.snapshot >= 1).length,
    allFirstFramesByMs: firstSnapshotAll,
    firstFrameMs: stats(list.map((s) => s.first)),
    frames,
    framesPerSecond: stats(perSecond),
    kbPerSecond: +(bytes / 1024 / 45).toFixed(1),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: +(parseUs / frames).toFixed(1),
    firstFrameLevels: levelCounts,
    marketsWithPaddedBid: list.filter((s) => s.paddedBid).length,
    marketsWithPaddedAsk: list.filter((s) => s.paddedAsk).length,
    marketsWithZeroSizeAtPrice: list.filter((s) => s.zeroSizeAtPrice > 0).length,
    zeroSizeAtPriceUnitSides: list.reduce((a, s) => a + s.zeroSizeAtPrice, 0),
    longestSilenceMs: tailGap.slice(0, 5),
    marketsOver30sSilent: tailGap.filter((x) => x.gap > 30_000).length,
    missing: codes.filter((c) => !seen.has(c)).slice(0, 10),
  });
}

async function errors() {
  const cases = {
    unknown: [ticket(), { type: 'orderbook', codes: ['KRW-NOPE'] }],
    lowercase: [ticket(), { type: 'orderbook', codes: ['krw-btc'] }],
    mixed_known_unknown: [ticket(), { type: 'orderbook', codes: ['KRW-BTC', 'KRW-NOPE'] }],
    wrong_order: [ticket(), { type: 'orderbook', codes: ['BTC-KRW'] }],
    legacy_symbol: [ticket(), { type: 'orderbook', codes: ['BTC_KRW'] }],
    no_ticket: [{ type: 'orderbook', codes: ['KRW-BTC'] }],
    no_type: [ticket(), { codes: ['KRW-BTC'] }],
    unknown_type: [ticket(), { type: 'nope', codes: ['KRW-BTC'] }],
    empty_codes: [ticket(), { type: 'orderbook', codes: [] }],
    bad_format: [ticket(), { type: 'orderbook', codes: ['KRW-BTC'] }, { format: 'NOPE' }],
    not_json: 'hello',
    object_not_array: { ticket: 'x', type: 'orderbook', codes: ['KRW-BTC'] },
  };
  for (const [name, req] of Object.entries(cases)) {
    const { ws } = await open(URL_V1);
    const frames = [];
    let closed;
    ws.on('message', (raw) => frames.push(raw.toString('utf8')));
    ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });
    ws.send(typeof req === 'string' ? req : JSON.stringify(req));
    await sleep(2_500);
    const codes = [...new Set(frames.map((f) => { try { return JSON.parse(f).code; } catch { return undefined; } }))];
    log('error_case', { name, frames: frames.length, codes, first: frames[0]?.slice(0, 200), closed });
    capture(`error-${name}.jsonl`, frames.slice(0, 2).join('\n'));
    ws.close();
    await sleep(300);
  }

  // A second request on the same socket: does it add to or replace the first?
  const { ws } = await open(URL_V1);
  const counts = { phase1: {}, phase2: {} };
  let phase = 'phase1';
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString('utf8'));
    const k = `${m.type}/${m.code}`;
    counts[phase][k] = (counts[phase][k] ?? 0) + 1;
  });
  ws.send(JSON.stringify([ticket(), { type: 'orderbook', codes: ['KRW-BTC'] }]));
  await sleep(4_000);
  phase = 'phase2';
  ws.send(JSON.stringify([ticket(), { type: 'orderbook', codes: ['KRW-ETH'] }]));
  await sleep(5_000);
  ws.close();
  log('second_request', counts);
}

async function silence() {
  const kinds = {
    idle: { subscribe: false, ping: null },
    subscribed_quiet: { subscribe: true, ping: null },
    protocol_ping_30s: { subscribe: false, ping: 'protocol' },
    text_ping_once: { subscribe: false, ping: 'text' },
  };
  const results = {};
  await Promise.all(Object.entries(kinds).map(async ([name, k]) => {
    const { ws, openMs } = await open(URL_V1);
    const t0 = Date.now();
    const r = (results[name] = { openMs, frames: 0, status: [], pongs: [], serverPings: 0, closedAtMs: null, closeCode: null, sample: [] });
    ws.on('message', (raw) => {
      r.frames++;
      const t = raw.toString('utf8');
      if (t.includes('"status"')) r.status.push(Date.now() - t0);
      if (r.sample.length < 2) r.sample.push(t.slice(0, 120));
    });
    ws.on('ping', () => { r.serverPings++; });
    ws.on('pong', () => { r.pongs.push(Date.now() - t0); });
    ws.on('close', (code) => { r.closedAtMs = Date.now() - t0; r.closeCode = code; });
    if (k.subscribe) ws.send(JSON.stringify([ticket(), { type: 'trade', codes: ['KRW-EGG'] }]));
    let timer;
    if (k.ping === 'protocol') {
      ws.ping();
      timer = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 30_000);
    }
    if (k.ping === 'text') ws.send('PING');
    await sleep(120_000);
    clearInterval(timer);
    if (ws.readyState === ws.OPEN) ws.close();
  }));
  for (const [name, r] of Object.entries(results)) {
    const gaps = r.status.map((t, i) => (i === 0 ? t : t - r.status[i - 1]));
    log('silence', { name, openMs: r.openMs, frames: r.frames, statusFrames: r.status.length, statusGapMs: stats(gaps.slice(1)), firstStatusMs: r.status[0], pongs: r.pongs.length, firstPongMs: r.pongs[0], serverPings: r.serverPings, closedAtMs: r.closedAtMs, closeCode: r.closeCode, sample: r.sample });
  }
}

function openWithExtensions(url, perMessageDeflate) {
  const ws = new WebSocket(url, { perMessageDeflate });
  let header = null;
  ws.once('upgrade', (res) => { header = res.headers['sec-websocket-extensions'] ?? null; });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, header }));
    ws.once('error', reject);
  });
}

async function deflate() {
  const offered = await openWithExtensions(URL_V1, true);
  let frames = 0;
  offered.ws.on('message', () => frames++);
  offered.ws.send(JSON.stringify([ticket(), { type: 'orderbook', codes: ['KRW-BTC'] }]));
  await sleep(3_000);
  offered.ws.close();
  const plain = await openWithExtensions(URL_V1, false);
  let plainFrames = 0;
  let binary = 0;
  plain.ws.on('message', (_raw, isBinary) => { plainFrames++; if (isBinary) binary++; });
  plain.ws.send(JSON.stringify([ticket(), { type: 'orderbook', codes: ['KRW-BTC'] }]));
  await sleep(3_000);
  plain.ws.close();
  log('deflate', { offered: offered.header, framesWhenOffered: frames, notOffered: plain.header, framesWhenNotOffered: plainFrames, binaryFramesWhenNotOffered: binary });
}

async function legacy() {
  let conn;
  try {
    conn = await open(URL_LEGACY);
  } catch (e) {
    log('legacy', { url: URL_LEGACY, error: e.message });
    return;
  }
  const { ws, openMs } = conn;
  const byType = {};
  const samples = {};
  ws.on('message', (raw) => {
    const t = raw.toString('utf8');
    capture('legacy.jsonl', t);
    let m;
    try { m = JSON.parse(t); } catch { m = { type: 'not_json' }; }
    const k = m.type ?? `status:${m.status}`;
    byType[k] = (byType[k] ?? 0) + 1;
    samples[k] ??= t.slice(0, 300);
  });
  ws.send(JSON.stringify({ type: 'orderbookdepth', symbols: ['BTC_KRW'] }));
  await sleep(300);
  ws.send(JSON.stringify({ type: 'orderbooksnapshot', symbols: ['BTC_KRW'] }));
  await sleep(15_000);
  ws.close();
  log('legacy', { url: URL_LEGACY, openMs, byType, samples });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, errors, silence, deflate, legacy };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
log('mode', { name: mode, at: new Date().toISOString() });
await modes[mode]();
