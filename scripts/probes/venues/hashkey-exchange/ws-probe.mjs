// HashKey Exchange WebSocket probe: the V1 and V2 public streams, full depth against diffMergedDepth, the o sequence, level order and window, idle repeats, keepalive, silence, errors, a batch of every HK spot pair, and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node ../scripts/probes/venues/hashkey-exchange/ws-probe.mjs [book|batch|silence|deflate|conns|v2snap]
//   book     V1 depth and diffMergedDepth on four pairs and the one HK contract, V2 depth and bbo, errors, a REST compare. About 70 s.
//   batch    every TRADING HK spot pair on one V1 socket as depth, on a second as diffMergedDepth, and on a V2 socket as depth. About 50 s.
//   silence  four V1 sockets that differ only in what the client sends or subscribes, for up to 120 s.
//   deflate  asks for permessage-deflate once, and asks for the binary depth option once.
//   v2snap   subscribes V2 depth for every HK pair and times each pair's first book after its acknowledgement, 15 s.
//   conns    opens up to twelve idle V1 sockets one after another and holds them for 2 s, to find a concurrent connection cap.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/hashkey-exchange/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const V1 = 'wss://stream-pro.hashkey.com/quote/ws/v1';
const V2 = 'wss://stream-pro.hashkey.com/quote/ws/v2';
const API = 'https://api-pro.hashkey.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let captured = 0;

function capture(name, text) {
  if (!OUT || captured > 3_000_000) return;
  mkdirSync(OUT, { recursive: true });
  const line = text.length > 600 ? text.slice(0, 600) + '…' : text;
  captured += line.length;
  appendFileSync(join(OUT, name), line + '\n');
}

const stats = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

function open(url, name, { deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const conn = { ws, name, t0, openMs: null, closed: null, pings: [], serverPings: 0, ext: null };
  ws.on('upgrade', (res) => { conn.ext = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('open', () => { conn.openMs = Date.now() - t0; });
  ws.on('ping', () => { conn.serverPings++; });
  ws.on('close', (code, reason) => { conn.closed = { code, reason: reason.toString(), afterMs: Date.now() - t0 }; });
  ws.on('error', (e) => { conn.error = e.message; });
  return new Promise((resolve) => {
    // With this listener ws emits neither error nor close for a refused upgrade, so the refusal resolves here.
    ws.on('unexpected-response', (req, res) => {
      const chunks = [];
      res.on('data', (x) => chunks.push(x));
      res.on('end', () => {
        conn.unexpected = { status: res.statusCode, retryAfter: res.headers['retry-after'] ?? null, body: Buffer.concat(chunks).toString('utf8').slice(0, 200), afterMs: Date.now() - t0 };
        req.destroy();
        resolve(conn);
      });
    });
    ws.once('open', () => resolve(conn));
    ws.once('close', () => resolve(conn));
    ws.once('error', () => resolve(conn));
  });
}

const isDesc = (a) => a.every((x, i) => i === 0 || Number(a[i - 1][0]) > Number(x[0]));
const isAsc = (a) => a.every((x, i) => i === 0 || Number(a[i - 1][0]) < Number(x[0]));
const scaleOf = (tick) => {
  const n = Number(tick);
  if (n >= 1) return -Math.round(Math.log10(n));
  return (tick.split('.')[1] ?? '').replace(/0+$/, '').length;
};

// Per stream bookkeeping for the full depth topic.
function depthTracker() {
  return { frames: 0, snapshots: 0, bids: [], asks: [], orderBad: 0, repeats: 0, gapsMs: [], ageMs: [], lastKey: null, lastAt: null, versions: [], vBackwards: 0, vSame: 0, last: null, byV: new Map() };
}

function onDepth(tr, d, f, arrival) {
  tr.frames++;
  if (f) tr.snapshots++;
  tr.bids.push(d.b.length);
  tr.asks.push(d.a.length);
  if (!isDesc(d.b) || !isAsc(d.a)) tr.orderBad++;
  const key = JSON.stringify([d.b, d.a]);
  if (key === tr.lastKey) tr.repeats++;
  tr.lastKey = key;
  if (tr.lastAt !== null) tr.gapsMs.push(arrival - tr.lastAt);
  tr.lastAt = arrival;
  tr.ageMs.push(arrival - d.t);
  const v = Number(String(d.v).split('_')[0]);
  const prev = tr.versions[tr.versions.length - 1];
  if (prev !== undefined && v < prev) tr.vBackwards++;
  if (prev !== undefined && v === prev) tr.vSame++;
  tr.versions.push(v);
  tr.last = { v, b: d.b, a: d.a, at: arrival };
  tr.byV.set(v, JSON.stringify([d.b.slice(0, 20).map(([p, q]) => [Number(p), Number(q)]), d.a.slice(0, 20).map(([p, q]) => [Number(p), Number(q)])]));
  if (tr.byV.size > 400) tr.byV.delete(tr.byV.keys().next().value);
}

function summarizeDepth(sym, tr) {
  return { sym, frames: tr.frames, snapshots: tr.snapshots, bidLevels: stats(tr.bids), askLevels: stats(tr.asks), orderBad: tr.orderBad, identicalToPrevious: tr.repeats, interFrameMs: stats(tr.gapsMs), dataAgeMs: stats(tr.ageMs), versionBackwards: tr.vBackwards, versionRepeated: tr.vSame };
}

// Per stream bookkeeping for diffMergedDepth: the o chain and a book kept from snapshot plus deltas.
function diffTracker() {
  return { snapshots: 0, deltas: 0, firstDeltaO: null, gaps: 0, lastO: null, emptyDeltas: 0, deltaBeforeSnapshot: 0, bids: new Map(), asks: new Map(), maxHeld: 0, orderBadDelta: 0, snapshotLevels: null, byV: new Map(), zeroSizes: 0, gapList: [] };
}

function onDiff(tr, d, f) {
  if (f || d.o === 0) {
    tr.snapshots++;
    tr.bids = new Map(d.b.map(([p, q]) => [p, q]));
    tr.asks = new Map(d.a.map(([p, q]) => [p, q]));
    tr.snapshotLevels = [d.b.length, d.a.length];
    tr.lastO = null;
  } else {
    if (tr.snapshots === 0) { tr.deltaBeforeSnapshot++; return; }
    tr.deltas++;
    if (tr.firstDeltaO === null) tr.firstDeltaO = d.o;
    if (tr.lastO !== null && d.o !== tr.lastO + 1) { tr.gaps++; if (tr.gapList.length < 5) tr.gapList.push([tr.lastO, d.o]); }
    tr.lastO = d.o;
    if (d.b.length === 0 && d.a.length === 0) tr.emptyDeltas++;
    if (!isDesc(d.b) || !isAsc(d.a)) tr.orderBadDelta++;
    for (const [p, q] of d.b) { if (Number(q) === 0) { tr.bids.delete(p); tr.zeroSizes++; } else tr.bids.set(p, q); }
    for (const [p, q] of d.a) { if (Number(q) === 0) { tr.asks.delete(p); tr.zeroSizes++; } else tr.asks.set(p, q); }
  }
  tr.maxHeld = Math.max(tr.maxHeld, tr.bids.size, tr.asks.size);
  const v = Number(String(d.v).split('_')[0]);
  tr.byV.set(v, topOf(tr.bids, tr.asks, 20));
  if (tr.byV.size > 400) tr.byV.delete(tr.byV.keys().next().value);
}

function topOf(bids, asks, n) {
  const b = [...bids].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
  const a = [...asks].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
  return JSON.stringify([b.map(([p, q]) => [Number(p), Number(q)]), a.map(([p, q]) => [Number(p), Number(q)])]);
}

async function restDepth(sym, limit = 100) {
  const t0 = Date.now();
  const r = await fetch(`${API}/quote/v1/depth?symbol=${sym}&limit=${limit}`);
  return { at: Date.now(), ms: Date.now() - t0, j: await r.json() };
}

function compareTop(wsBook, restReply, n = 20) {
  const rest = restReply.j;
  let priceMatch = 0;
  let sizeMatch = 0;
  const restB = new Map(rest.b.map(([p, q]) => [Number(p), q]));
  const restA = new Map(rest.a.map(([p, q]) => [Number(p), q]));
  for (const [p, q] of wsBook.b.slice(0, n)) { if (restB.has(Number(p))) { priceMatch++; if (Number(restB.get(Number(p))) === Number(q)) sizeMatch++; } }
  for (const [p, q] of wsBook.a.slice(0, n)) { if (restA.has(Number(p))) { priceMatch++; if (Number(restA.get(Number(p))) === Number(q)) sizeMatch++; } }
  return { compared: Math.min(n, wsBook.b.length) + Math.min(n, wsBook.a.length), priceMatch, sizeMatch, wsFrameAgeAtRestReplyMs: restReply.at - wsBook.at };
}

async function book() {
  const info = await (await fetch(`${API}/api/v1/exchangeInfo`)).json();
  const tick = Object.fromEntries(info.symbols.map((s) => [s.symbol, s.filters.find((f) => f.filterType === 'PRICE_FILTER').tickSize]));
  const syms = ['BTCUSD', 'ETHUSD', 'XDCUSD', 'CCUSD'];
  const contract = 'BBTCUSD-PERPETUAL';

  const a = await open(V1, 'v1');
  log('open', { name: 'v1', openMs: a.openMs, ext: a.ext });
  const depth = Object.fromEntries([...syms, contract].map((s) => [s, depthTracker()]));
  const diff = Object.fromEntries(['BTCUSD', 'ETHUSD', 'XDCUSD'].map((s) => [s, diffTracker()]));
  const control = [];
  const pongs = [];
  const diffOrderAcrossSymbols = [];
  let firstFrameAfterSubMs = null;
  let subAt = null;
  a.ws.on('message', (raw) => {
    const arrival = Date.now();
    const s = raw.toString();
    capture('book-v1.jsonl', s);
    const j = JSON.parse(s);
    if (j.pong !== undefined) { pongs.push(arrival - j.pong); return; }
    if (j.code !== undefined) { control.push(s.slice(0, 200)); return; }
    if (j.topic === 'depth' && Array.isArray(j.data)) {
      if (firstFrameAfterSubMs === null) firstFrameAfterSubMs = arrival - subAt;
      for (const d of j.data) onDepth(depth[j.symbol] ?? (depth[j.symbol] = depthTracker()), d, j.f, arrival);
      return;
    }
    if (j.topic === 'diffMergedDepth' && Array.isArray(j.data)) {
      for (const d of j.data) {
        if (d.o) diffOrderAcrossSymbols.push([j.symbol, d.o]);
        onDiff(diff[j.symbol], d, j.f);
      }
      return;
    }
    control.push(s.slice(0, 200));
  });
  subAt = Date.now();
  a.ws.send(JSON.stringify({ symbol: syms.join(','), topic: 'depth', event: 'sub', params: { binary: false } }));
  a.ws.send(JSON.stringify({ symbol: contract, topic: 'depth', event: 'sub', params: { binary: false } }));
  for (const s of Object.keys(diff)) a.ws.send(JSON.stringify({ symbol: s, topic: 'diffMergedDepth', event: 'sub', params: { binary: false, dumpScale: scaleOf(tick[s]) } }));
  // Error cases, each on its own frame.
  a.ws.send(JSON.stringify({ symbol: 'NOPEUSD', topic: 'depth', event: 'sub', params: { binary: false } }));
  a.ws.send(JSON.stringify({ symbol: 'BTCUSD', topic: 'nope', event: 'sub', params: {} }));
  a.ws.send(JSON.stringify({ symbol: 'BTCUSD', topic: 'diffMergedDepth', event: 'sub', params: { binary: false } }));
  a.ws.send('not json');
  a.ws.send(JSON.stringify({ symbol: 'BTCUSD', topic: 'depth', event: 'sub', params: { binary: false } }));
  a.ws.send(JSON.stringify({ symbol: 'BTCUSDT-PERPETUAL', topic: 'depth', event: 'sub', params: { binary: false } }));
  // A limit of 200 in params, then a cancel 5 s later, to see the level count and whether a cancel is acknowledged.
  a.ws.send(JSON.stringify({ symbol: 'SOLUSD', topic: 'depth', event: 'sub', params: { binary: false, limit: 200 } }));
  let cancelAt = null;
  setTimeout(() => { cancelAt = Date.now(); a.ws.send(JSON.stringify({ symbol: 'SOLUSD', topic: 'depth', event: 'cancel', params: { binary: false } })); }, 5_000);
  const ping = setInterval(() => a.ws.readyState === 1 && a.ws.send(JSON.stringify({ ping: Date.now() })), 10_000);

  const b = await open(V2, 'v2');
  log('open', { name: 'v2', openMs: b.openMs, ext: b.ext });
  const v2depth = {};
  const v2bbo = {};
  const v2control = [];
  b.ws.on('message', (raw) => {
    const arrival = Date.now();
    const s = raw.toString();
    capture('book-v2.jsonl', s);
    const j = JSON.parse(s);
    if (j.pong !== undefined) return;
    if (j.code !== undefined || j.msg !== undefined) { v2control.push(s.slice(0, 200)); return; }
    if (j.topic === 'depth' && j.data) { onDepth(v2depth[j.data.s] ?? (v2depth[j.data.s] = depthTracker()), j.data, false, arrival); return; }
    if (j.topic === 'bbo' && j.data) {
      const t = v2bbo[j.data.s] ?? (v2bbo[j.data.s] = { frames: 0, repeats: 0, last: null, gaps: [], lastAt: null });
      t.frames++;
      const key = [j.data.b, j.data.bz, j.data.a, j.data.az].join();
      if (key === t.last) t.repeats++;
      t.last = key;
      if (t.lastAt !== null) t.gaps.push(arrival - t.lastAt);
      t.lastAt = arrival;
      return;
    }
    v2control.push(s.slice(0, 200));
  });
  for (const s of ['BTCUSD', 'XDCUSD']) {
    b.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { symbol: s } }));
    b.ws.send(JSON.stringify({ topic: 'bbo', event: 'sub', params: { symbol: s } }));
  }
  b.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { symbol: 'ETHUSD,SOLUSD' } }));
  b.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { symbol: 'NOPE' } }));
  b.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', site: 'MENA', params: { symbol: 'BTCUSDT-PERPETUAL' } }));
  const ping2 = setInterval(() => b.ws.readyState === 1 && b.ws.send(JSON.stringify({ ping: Date.now() })), 10_000);

  // Size unit and freshness: REST book against the latest V1 depth frame, three times.
  const compares = [];
  for (let i = 0; i < 3; i++) {
    await sleep(15_000);
    const r = await restDepth('BTCUSD');
    if (depth.BTCUSD.last) compares.push({ restMs: r.ms, restAgeMs: r.at - r.j.t, ...compareTop(depth.BTCUSD.last, r) });
  }
  await sleep(20_000);
  clearInterval(ping);
  clearInterval(ping2);

  // The diff book against the full depth stream at the same version number.
  const diffCheck = {};
  for (const s of Object.keys(diff)) {
    let same = 0;
    let differ = 0;
    // The top 20 of the book kept from diffMergedDepth against the full depth frame carrying the same version number.
    for (const [v, top] of diff[s].byV) {
      const f = depth[s].byV.get(v);
      if (f === undefined) continue;
      if (f === top) same++; else differ++;
    }
    diffCheck[s] = { versionsInBoth: same + differ, top20Equal: same, top20Differ: differ };
  }
  const oSymbols = new Set();
  let interleaved = 0;
  for (let i = 1; i < diffOrderAcrossSymbols.length; i++) {
    if (diffOrderAcrossSymbols[i][0] !== diffOrderAcrossSymbols[i - 1][0]) interleaved++;
    oSymbols.add(diffOrderAcrossSymbols[i][0]);
  }
  log('v1_first_frame_after_subscribe_ms', { ms: firstFrameAfterSubMs });
  const sol = depth.SOLUSD;
  log('v1_limit_and_cancel', { levels: sol ? [Math.max(...sol.bids), Math.max(...sol.asks)] : null, frames: sol?.frames ?? 0, lastFrameAfterCancelMs: sol && cancelAt ? sol.lastAt - cancelAt : null });
  for (const [s, tr] of Object.entries(depth)) log('v1_depth', summarizeDepth(s, tr));
  for (const [s, tr] of Object.entries(diff)) {
    const { bids, asks, byV, ...rest } = tr;
    log('v1_diff', { sym: s, ...rest, heldAtEnd: [bids.size, asks.size], ...diffCheck[s] });
  }
  log('v1_diff_o_shared', { symbolsWithDeltas: [...oSymbols], symbolSwitches: interleaved, sample: diffOrderAcrossSymbols.slice(0, 8) });
  log('v1_control', { frames: control });
  log('v1_pong_rtt_ms', stats(pongs));
  log('rest_compare', { compares });
  for (const [s, tr] of Object.entries(v2depth)) log('v2_depth', summarizeDepth(s, tr));
  for (const [s, t] of Object.entries(v2bbo)) log('v2_bbo', { sym: s, frames: t.frames, identicalToPrevious: t.repeats, interFrameMs: stats(t.gaps) });
  log('v2_control', { frames: v2control });
  log('sessions', { v1: { serverPings: a.serverPings, closed: a.closed }, v2: { serverPings: b.serverPings, closed: b.closed } });
  a.ws.terminate();
  b.ws.terminate();
}

async function batch() {
  const info = await (await fetch(`${API}/api/v1/exchangeInfo`)).json();
  const syms = info.symbols.filter((s) => s.status === 'TRADING').map((s) => s.symbol);
  const tick = Object.fromEntries(info.symbols.map((s) => [s.symbol, s.filters.find((f) => f.filterType === 'PRICE_FILTER').tickSize]));
  const a = await open(V1, 'batch-depth');
  const c = await open(V1, 'batch-diff');
  const v2 = await open(V2, 'batch-v2-depth');
  const v2depth = {};
  const v2acks = { ok: 0, fail: [] };
  let v2frames = 0;
  let v2bytes = 0;
  let v2parseNs = 0n;
  v2.ws.on('message', (raw) => {
    v2frames++;
    v2bytes += raw.length;
    const t0 = process.hrtime.bigint();
    const j = JSON.parse(raw.toString());
    v2parseNs += process.hrtime.bigint() - t0;
    if (j.event === 'sub') { if (j.code === '0') v2acks.ok++; else v2acks.fail.push(raw.toString().slice(0, 160)); return; }
    if (j.topic === 'depth' && j.data) onDepth(v2depth[j.data.s] ?? (v2depth[j.data.s] = depthTracker()), j.data, false, Date.now());
  });
  const depth = {};
  const diff = {};
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let diffFrames = 0;
  let diffBytes = 0;
  const control = [];
  const perSecond = new Map();
  a.ws.on('message', (raw) => {
    frames++;
    bytes += raw.length;
    const t0 = process.hrtime.bigint();
    const j = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t0;
    const sec = Math.floor(Date.now() / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (j.topic === 'depth' && Array.isArray(j.data)) { for (const d of j.data) onDepth(depth[j.symbol] ?? (depth[j.symbol] = depthTracker()), d, j.f, Date.now()); return; }
    if (j.pong === undefined) control.push(raw.toString().slice(0, 160));
  });
  c.ws.on('message', (raw) => {
    diffFrames++;
    diffBytes += raw.length;
    const j = JSON.parse(raw.toString());
    if (j.topic === 'diffMergedDepth' && Array.isArray(j.data)) { for (const d of j.data) onDiff(diff[j.symbol] ?? (diff[j.symbol] = diffTracker()), d, j.f); return; }
    if (j.pong === undefined) control.push(raw.toString().slice(0, 160));
  });
  const t0 = Date.now();
  a.ws.send(JSON.stringify({ symbol: syms.join(','), topic: 'depth', event: 'sub', params: { binary: false } }));
  for (const s of syms) c.ws.send(JSON.stringify({ symbol: s, topic: 'diffMergedDepth', event: 'sub', params: { binary: false, dumpScale: scaleOf(tick[s]) } }));
  for (const s of syms) v2.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { symbol: s } }));
  const ping = setInterval(() => { for (const x of [a, c, v2]) if (x.ws.readyState === 1) x.ws.send(JSON.stringify({ ping: Date.now() })); }, 10_000);
  await sleep(45_000);
  clearInterval(ping);
  const secs = (Date.now() - t0) / 1000;
  const counts = [...perSecond.values()].slice(1, -1);
  const silent = syms.filter((s) => !depth[s]);
  const perSym = Object.entries(depth).map(([s, tr]) => [s, tr.frames, tr.repeats]).sort((x, y) => y[1] - x[1]);
  let gaps = 0;
  let deltas = 0;
  let maxHeld = 0;
  const noSnapshot = [];
  for (const s of syms) {
    const tr = diff[s];
    if (!tr || tr.snapshots === 0) { noSnapshot.push(s); continue; }
    gaps += tr.gaps;
    deltas += tr.deltas;
    maxHeld = Math.max(maxHeld, tr.maxHeld);
  }
  log('batch_depth', { symbols: syms.length, delivering: Object.keys(depth).length, silent, frames, framesPerSecond: stats(counts), bytesPerSecond: Math.round(bytes / secs), bytesPerFrame: Math.round(bytes / Math.max(1, frames)), parseUsPerFrame: Number(parseNs / 1000n) / Math.max(1, frames), snapshotsTotal: Object.values(depth).reduce((x, t) => x + t.snapshots, 0), identicalToPreviousTotal: Object.values(depth).reduce((x, t) => x + t.repeats, 0), top: perSym.slice(0, 3), bottom: perSym.slice(-5), maxLevels: Math.max(...Object.values(depth).map((t) => Math.max(...t.bids, ...t.asks))) });
  log('batch_diff', { symbols: syms.length, withSnapshot: syms.length - noSnapshot.length, noSnapshot, frames: diffFrames, bytesPerSecond: Math.round(diffBytes / secs), deltas, gaps, maxHeldLevels: maxHeld });
  const v2ages = Object.values(v2depth).flatMap((t) => t.ageMs);
  const v2gaps = Object.values(v2depth).flatMap((t) => t.gapsMs);
  log('batch_v2_depth', { symbols: syms.length, acks: v2acks.ok, ackFailures: v2acks.fail, delivering: Object.keys(v2depth).length, silent: syms.filter((s) => !v2depth[s]), frames: v2frames, bytesPerSecond: Math.round(v2bytes / secs), parseUsPerFrame: Number(v2parseNs / 1000n) / Math.max(1, v2frames), interFrameMs: stats(v2gaps), dataAgeMs: stats(v2ages), identicalToPreviousTotal: Object.values(v2depth).reduce((x, t) => x + t.repeats, 0), versionBackwardsTotal: Object.values(v2depth).reduce((x, t) => x + t.vBackwards, 0) });
  const v1ages = Object.values(depth).flatMap((t) => t.ageMs);
  log('batch_v1_depth_age', { dataAgeMs: stats(v1ages), interFrameMs: stats(Object.values(depth).flatMap((t) => t.gapsMs)) });
  log('batch_control', { frames: control.slice(0, 10) });
  log('sessions', { depth: { serverPings: a.serverPings, closed: a.closed }, diff: { serverPings: c.serverPings, closed: c.closed }, v2: { serverPings: v2.serverPings, closed: v2.closed } });
  a.ws.terminate();
  c.ws.terminate();
  v2.ws.terminate();
}

async function silence() {
  const cases = [
    { name: 'nothing', sub: null, ping: false },
    { name: 'quiet-subscribe-only', sub: 'SPICEUSDC', ping: false },
    { name: 'busy-subscribe-only', sub: 'BTCUSD', ping: false },
    { name: 'ping-only', sub: null, ping: true },
  ];
  const conns = await Promise.all(cases.map((k) => open(V1, k.name)));
  conns.forEach((c, i) => {
    c.frames = 0;
    c.lastFrameAt = null;
    c.ws.on('message', (raw) => {
      c.frames++;
      c.lastFrameAt = Date.now() - c.t0;
      const j = JSON.parse(raw.toString());
      if (j.ping !== undefined) { c.jsonPings = (c.jsonPings ?? 0) + 1; }
    });
    if (cases[i].sub) c.ws.send(JSON.stringify({ symbol: cases[i].sub, topic: 'depth', event: 'sub', params: { binary: false } }));
    if (cases[i].ping) c.timer = setInterval(() => c.ws.readyState === 1 && c.ws.send(JSON.stringify({ ping: Date.now() })), 10_000);
  });
  const end = Date.now() + 120_000;
  while (Date.now() < end && conns.some((c) => !c.closed)) await sleep(500);
  for (const [i, c] of conns.entries()) {
    clearInterval(c.timer);
    log('silence', { name: cases[i].name, openMs: c.openMs, unexpected: c.unexpected ?? null, closed: c.closed, frames: c.frames, lastFrameAtMs: c.lastFrameAt, serverProtocolPings: c.serverPings, serverJsonPings: c.jsonPings ?? 0, heldMs: Date.now() - c.t0 });
    c.ws.terminate();
  }
}

// V2 depth sends a book only when it changes, so this times the first book of every HK pair after its acknowledgement.
async function v2snap() {
  const info = await (await fetch(`${API}/api/v1/exchangeInfo`)).json();
  const syms = info.symbols.filter((s) => s.status === 'TRADING').map((s) => s.symbol);
  const c = await open(V2, 'v2snap');
  const ackAt = {};
  const firstAt = {};
  c.ws.on('message', (raw) => {
    const j = JSON.parse(raw.toString());
    const s = j.params?.symbol;
    if (j.event === 'sub') ackAt[s] = Date.now();
    else if (j.topic === 'depth' && j.data && firstAt[s] === undefined) firstAt[s] = Date.now();
  });
  for (const s of syms) c.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { symbol: s } }));
  await sleep(15_000);
  const waits = syms.filter((s) => firstAt[s] !== undefined && ackAt[s] !== undefined).map((s) => firstAt[s] - ackAt[s]);
  log('v2_first_book_after_ack', { symbols: syms.length, acked: Object.keys(ackAt).length, within1s: waits.filter((w) => w <= 1_000).length, within15s: waits.length, never: syms.filter((s) => firstAt[s] === undefined), waitMs: stats(waits), slowest: syms.filter((s) => firstAt[s] - ackAt[s] > 1_000).map((s) => [s, firstAt[s] - ackAt[s]]) });
  c.ws.terminate();
}

// Opens sockets one after another on V1 and holds them, to find a per host cap on concurrent connections, then closes them all.
async function conns() {
  const held = [];
  for (let i = 0; i < 12; i++) {
    const c = await open(V1, `conn-${i}`);
    held.push(c);
    log('conn', { i, openMs: c.openMs, unexpected: c.unexpected ?? null, error: c.error ?? null, closed: c.closed });
    await sleep(300);
  }
  await sleep(2_000);
  log('conns_after_2s', { open: held.filter((c) => c.ws.readyState === 1).length, closed: held.filter((c) => c.closed).map((c) => [c.name, c.closed.code]) });
  for (const c of held) c.ws.terminate();
}

async function deflate() {
  const c = await open(V1, 'deflate', { deflate: true });
  log('deflate', { offered: true, negotiated: c.ext, openMs: c.openMs });
  let first = null;
  c.ws.on('message', (raw, isBinary) => {
    if (first) return;
    first = { isBinary, bytes: raw.length, head: isBinary ? raw.subarray(0, 4).toString('hex') : raw.toString().slice(0, 160) };
  });
  c.ws.send(JSON.stringify({ symbol: 'BTCUSD', topic: 'depth', event: 'sub', params: { binary: true } }));
  await sleep(3_000);
  log('binary_option', { first });
  c.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await book();
else if (mode === 'batch') await batch();
else if (mode === 'silence') await silence();
else if (mode === 'deflate') await deflate();
else if (mode === 'conns') await conns();
else if (mode === 'v2snap') await v2snap();
log('end', { at: new Date().toISOString() });
process.exit(0);
