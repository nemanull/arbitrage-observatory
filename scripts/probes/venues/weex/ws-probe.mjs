// WEEX futures WebSocket v3 probe: depth channels, snapshot and update id chain, level order, size unit against REST, keepalive, silence, errors, the User-Agent rule, and a batch of perpetuals on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/weex/ws-probe.mjs [book|batch|silence|deflate|noua]
//   book     depth200 on four perps plus depth15 on BTC and four tickers for 75 s, a REST depth compare at 20 s and 50 s, error probes on a second socket. About 85 s.
//   batch    depth200 on 100 USDT perps on one connection for 45 s, then one more stream past the documented cap of 100.
//   silence  three sockets that differ only in whether they subscribe and whether they answer the server ping, for up to 110 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   noua     opens the public URL with no User-Agent header, an empty one and a set one, subscribes BTC depth15 on each for 3 s, and prints each handshake.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/weex/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const PUBLIC_URL = 'wss://ws-contract.weex.com/v3/ws/public';
const API = 'https://api-contract.weex.com/capi/v3';
const UA = { 'User-Agent': 'arbitrage-observatory-probe' };
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

async function getJson(path) {
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  return res.json();
}

function open(url, { headers = UA, deflate = false, name = 'ws' } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate, headers });
  ws.t0 = t0;
  ws.pings = [];
  ws.closed = null;
  ws.on('upgrade', (res) => {
    ws.openMs = Date.now() - t0;
    ws.negotiated = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
      ws.refused = { status: res.statusCode, server: res.headers.server ?? null, body: body.slice(0, 300) };
      log('refused', { name, ...ws.refused, ms: Date.now() - t0 });
    });
  });
  ws.on('ping', () => ws.pings.push({ kind: 'protocol', at: Date.now() - t0 }));
  ws.on('close', (code, reason) => {
    ws.closed = { code, reason: reason.toString(), at: Date.now() - t0 };
  });
  ws.on('error', (e) => log('error', { name, message: e.message }));
  return ws;
}

const waitOpen = (ws) =>
  new Promise((resolve) => {
    if (ws.readyState === ws.OPEN) return resolve(true);
    ws.once('open', () => resolve(true));
    ws.once('close', () => resolve(false));
    ws.once('error', () => resolve(false));
  });

// One book per stream, keyed "SYMBOL@depthN", applying every frame by price.
function makeStream(key) {
  return {
    key,
    snapshots: 0,
    deltas: 0,
    emptyDeltas: 0,
    chainEq: 0, // U equals the previous u
    chainPlus1: 0, // U equals the previous u plus one
    chainOther: [],
    firstAfterSnapshot: [],
    snapLevels: [],
    snapBidsDesc: 0,
    snapAsksAsc: 0,
    deltaBidsUnordered: 0,
    deltaAsksUnordered: 0,
    maxBids: 0,
    maxAsks: 0,
    crossed: 0,
    lastU: null,
    lastArrival: null,
    maxGapMs: 0,
    lagMs: [],
    eGaps: [], // E of a frame minus E of the previous frame, ms
    lastE: null,
    repeats: 0,
    lastBody: null,
    bids: new Map(),
    asks: new Map(),
    fractionalSizes: 0,
    sizes: 0,
  };
}

const isDesc = (lv) => lv.every((x, i) => i === 0 || Number(lv[i - 1][0]) > Number(x[0]));
const isAsc = (lv) => lv.every((x, i) => i === 0 || Number(lv[i - 1][0]) < Number(x[0]));

function applyLevels(side, levels, st) {
  for (const [p, s] of levels) {
    st.sizes++;
    if (!Number.isInteger(Number(s))) st.fractionalSizes++;
    if (Number(s) === 0) side.delete(p);
    else side.set(p, s);
  }
}

function onDepth(st, f, arrival) {
  if (st.lastArrival !== null) st.maxGapMs = Math.max(st.maxGapMs, arrival - st.lastArrival);
  st.lastArrival = arrival;
  st.lagMs.push(arrival - f.E);
  if (st.lastE !== null) st.eGaps.push(f.E - st.lastE);
  st.lastE = f.E;
  const bids = f.b ?? [];
  const asks = f.a ?? [];
  if (f.e === 'depthSnapshot') {
    st.snapshots++;
    st.snapLevels.push([bids.length, asks.length]);
    if (isDesc(bids)) st.snapBidsDesc++;
    if (isAsc(asks)) st.snapAsksAsc++;
    st.bids = new Map();
    st.asks = new Map();
    applyLevels(st.bids, bids, st);
    applyLevels(st.asks, asks, st);
    st.lastU = f.u;
    st.justSnapped = true;
  } else {
    st.deltas++;
    if (bids.length === 0 && asks.length === 0) st.emptyDeltas++;
    const body = JSON.stringify([f.b, f.a]);
    if (body === st.lastBody) st.repeats++;
    st.lastBody = body;
    if (st.lastU !== null) {
      if (f.U === st.lastU) st.chainEq++;
      else if (f.U === st.lastU + 1) st.chainPlus1++;
      else if (st.chainOther.length < 5) st.chainOther.push({ last: st.lastU, U: f.U, u: f.u });
      if (st.justSnapped && st.firstAfterSnapshot.length < 3) st.firstAfterSnapshot.push(f.U - st.lastU);
    }
    st.justSnapped = false;
    if (bids.length > 1 && !isDesc(bids)) st.deltaBidsUnordered++;
    if (asks.length > 1 && !isAsc(asks)) st.deltaAsksUnordered++;
    applyLevels(st.bids, bids, st);
    applyLevels(st.asks, asks, st);
    st.lastU = f.u;
  }
  st.maxBids = Math.max(st.maxBids, st.bids.size);
  st.maxAsks = Math.max(st.maxAsks, st.asks.size);
  if (st.bids.size && st.asks.size) {
    const bb = Math.max(...[...st.bids.keys()].map(Number));
    const ba = Math.min(...[...st.asks.keys()].map(Number));
    if (bb >= ba) st.crossed++;
  }
}

function summarize(st) {
  const lag = st.lagMs.slice().sort((a, b) => a - b);
  return {
    key: st.key,
    snapshots: st.snapshots,
    snapLevels: st.snapLevels.slice(0, 3),
    snapBidsDesc: st.snapBidsDesc,
    snapAsksAsc: st.snapAsksAsc,
    deltas: st.deltas,
    emptyDeltas: st.emptyDeltas,
    chainEq: st.chainEq,
    chainPlus1: st.chainPlus1,
    chainOther: st.chainOther,
    firstAfterSnapshot: st.firstAfterSnapshot,
    deltaBidsUnordered: st.deltaBidsUnordered,
    deltaAsksUnordered: st.deltaAsksUnordered,
    maxBids: st.maxBids,
    maxAsks: st.maxAsks,
    crossedAfterApply: st.crossed,
    maxGapMs: st.maxGapMs,
    repeats: st.repeats,
    lagMedMs: lag[lag.length >> 1] ?? null,
    eGapMs: (() => {
      const g = st.eGaps.slice().sort((a, b) => a - b);
      return g.length ? { min: g[0], median: g[g.length >> 1], max: g.at(-1) } : null;
    })(),
    fractionalSizes: st.fractionalSizes,
    sizes: st.sizes,
  };
}

// Frames that are not depth: pings, acks, errors, tickers, the connected greeting.
function control(ws, name, s, f, extra) {
  const at = Date.now() - ws.t0;
  if (f.event === 'ping') {
    ws.pings.push({ kind: 'app', at, time: f.time });
    if (ws.answerPings !== false) ws.send(JSON.stringify({ method: 'PONG', id: ++ws.nextId }));
    capture('ping.txt', s);
    return;
  }
  if (f.event === 'connected') {
    capture('connected.txt', s);
    return;
  }
  if ('result' in f || 'id' in f || 'code' in f) {
    log('reply', { name, at, frame: s.slice(0, 300) });
    capture('reply.txt', s);
    return;
  }
  if (f.e === 'ticker') {
    extra.tickers = (extra.tickers ?? 0) + 1;
    const d = f.d?.[0] ?? {};
    const t = (extra.bySymbol ??= {})[f.s] ??= { frames: 0, markEqualsLast: 0, markEqualsIndex: 0, marks: new Set() };
    t.frames++;
    if (Number(d.m) === Number(d.c)) t.markEqualsLast++;
    if (Number(d.m) === Number(d.i)) t.markEqualsIndex++;
    t.marks.add(d.m);
    if (extra.tickers <= 2) capture('ticker.txt', s);
    return;
  }
  extra.other = (extra.other ?? 0) + 1;
  if (extra.other <= 5) log('other', { name, at, frame: s.slice(0, 300) });
}

async function pickSymbols() {
  const info = await getJson('/market/exchangeInfo');
  const tick = await getJson('/market/ticker/24hr');
  const type = Object.fromEntries(info.symbols.map((s) => [s.symbol, s.contractType]));
  const rows = tick.filter((t) => type[t.symbol]).map((t) => ({ s: t.symbol, q: Number(t.quoteVolume), n: Number(t.count ?? 0), type: type[t.symbol] }));
  rows.sort((a, b) => b.q - a.q);
  const crypto = rows.filter((r) => r.type === 'PERPETUAL');
  const tradfi = rows.filter((r) => r.type === 'TRADIFI_PERPETUAL');
  const quiet = crypto.filter((r) => r.q > 0).at(-1);
  return { rows, crypto, tradfi, quiet: quiet.s, tradfiTop: tradfi[0].s };
}

async function restCompare(streams, symbol, level) {
  const t = Date.now();
  const rest = await getJson(`/market/depth?symbol=${symbol}&limit=200`);
  const st = streams.get(`${symbol}@depth${level}`);
  if (!st) return;
  const topBids = [...st.bids.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 20);
  const topAsks = [...st.asks.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 20);
  const restB = new Map(rest.bids.map(([p, s]) => [Number(p), s]));
  const restA = new Map(rest.asks.map(([p, s]) => [Number(p), s]));
  let equal = 0;
  let present = 0;
  for (const [p, s] of topBids) {
    if (restB.has(Number(p))) {
      present++;
      if (Number(restB.get(Number(p))) === Number(s)) equal++;
    }
  }
  for (const [p, s] of topAsks) {
    if (restA.has(Number(p))) {
      present++;
      if (Number(restA.get(Number(p))) === Number(s)) equal++;
    }
  }
  log('rest_compare', {
    symbol,
    level,
    restMs: Date.now() - t,
    restLastUpdateId: rest.lastUpdateId,
    wsLastU: st.lastU,
    restLevels: [rest.bids.length, rest.asks.length],
    restBidsDesc: isDesc(rest.bids),
    restAsksAsc: isAsc(rest.asks),
    wsTouch: [topBids[0], topAsks[0]],
    restTouch: [rest.bids[0], rest.asks[0]],
    topLevels: topBids.length + topAsks.length,
    pricesAlsoInRest: present,
    sizesEqual: equal,
  });
}

async function book() {
  const pick = await pickSymbols();
  const syms = ['BTCUSDT', 'ETHUSDT', pick.quiet, pick.tradfiTop];
  log('picked', { quiet: pick.quiet, tradfiTop: pick.tradfiTop, crypto: pick.crypto.length, tradfi: pick.tradfi.length });
  const streams = new Map();
  const extra = {};
  const ws = open(PUBLIC_URL, { name: 'book' });
  ws.nextId = 0;
  if (!(await waitOpen(ws))) return log('book_failed', { refused: ws.refused ?? null });
  log('open', { name: 'book', ms: ws.openMs });
  const params = [...syms.map((s) => `${s}@depth200`), 'BTCUSDT@depth15', 'BTCUSDT@ticker', `${pick.quiet}@ticker`, `${pick.tradfiTop}@ticker`, 'AAPLUSDT@ticker'];
  const subAt = Date.now();
  let firstSnap = {};
  ws.on('message', (raw) => {
    const arrival = Date.now();
    const s = raw.toString();
    const f = JSON.parse(s);
    if (f.e === 'depth' || f.e === 'depthSnapshot') {
      const key = `${f.s}@depth${f.l}`;
      if (!streams.has(key)) streams.set(key, makeStream(key));
      if (f.e === 'depthSnapshot' && !firstSnap[key]) {
        firstSnap[key] = arrival - subAt;
        capture('snapshot.txt', s);
      } else if (f.e === 'depth' && streams.get(key).deltas < 3) capture('delta.txt', s);
      onDepth(streams.get(key), f, arrival);
      return;
    }
    control(ws, 'book', s, f, extra);
  });
  ws.send(JSON.stringify({ method: 'SUBSCRIBE', params, id: ++ws.nextId }));

  // Error probes on a second socket, each in its own frame.
  const err = open(PUBLIC_URL, { name: 'errors' });
  err.nextId = 100;
  if (await waitOpen(err)) {
    err.on('message', (raw) => {
      const s = raw.toString();
      let f;
      try {
        f = JSON.parse(s);
      } catch {
        return log('non_json', { frame: s.slice(0, 200) });
      }
      if (f.e === 'depthSnapshot' || f.e === 'depth') {
        err.depthFrames = err.depthFrames ?? {};
        err.depthFrames[`${f.s}@depth${f.l}`] = (err.depthFrames[`${f.s}@depth${f.l}`] ?? 0) + 1;
        return;
      }
      control(err, 'errors', s, f, {});
    });
    const probes = [
      { label: 'unknown symbol', frame: { method: 'SUBSCRIBE', params: ['NOPEUSDT@depth200'], id: 101 } },
      { label: 'unsupported level 50', frame: { method: 'SUBSCRIBE', params: ['BTCUSDT@depth50'], id: 102 } },
      { label: 'unknown channel', frame: { method: 'SUBSCRIBE', params: ['BTCUSDT@nope'], id: 103 } },
      { label: 'lowercase symbol', frame: { method: 'SUBSCRIBE', params: ['btcusdt@depth15'], id: 104 } },
      { label: 'delisted symbol IKAUSDT', frame: { method: 'SUBSCRIBE', params: ['IKAUSDT@depth200'], id: 105 } },
      { label: 'first subscribe', frame: { method: 'SUBSCRIBE', params: ['ETHUSDT@depth15'], id: 106 } },
      { label: 'duplicate subscribe', frame: { method: 'SUBSCRIBE', params: ['ETHUSDT@depth15'], id: 107 } },
      { label: 'unknown method', frame: { method: 'FOO', params: ['BTCUSDT@depth15'], id: 108 } },
      { label: 'client PING', frame: { method: 'PING', id: 109 } },
      { label: 'unsubscribe', frame: { method: 'UNSUBSCRIBE', params: ['ETHUSDT@depth15'], id: 110 } },
    ];
    for (const p of probes) {
      log('send', { label: p.label, frame: JSON.stringify(p.frame) });
      err.send(JSON.stringify(p.frame));
      await sleep(700);
    }
    log('send', { label: 'text that is not JSON', frame: 'hello' });
    err.send('hello');
    await sleep(1500);
    log('error_socket', { depthFrames: err.depthFrames ?? {}, closed: err.closed, pings: err.pings.length });
    err.terminate();
  }

  await sleep(Math.max(0, 20_000 - (Date.now() - subAt)));
  await restCompare(streams, 'BTCUSDT', 200);
  await restCompare(streams, 'ETHUSDT', 200);
  await restCompare(streams, pick.quiet, 200);
  await sleep(30_000);
  await restCompare(streams, 'BTCUSDT', 200);
  await restCompare(streams, 'ETHUSDT', 200);
  await sleep(Math.max(0, 75_000 - (Date.now() - subAt)));
  log('first_snapshot_ms', firstSnap);
  for (const st of streams.values()) log('stream', summarize(st));
  const tickers = Object.fromEntries(Object.entries(extra.bySymbol ?? {}).map(([k, v]) => [k, { frames: v.frames, markEqualsLast: v.markEqualsLast, markEqualsIndex: v.markEqualsIndex, distinctMarks: v.marks.size }]));
  log('tickers', tickers);
  log('book_socket', { tickers: extra.tickers ?? 0, other: extra.other ?? 0, pings: ws.pings, closed: ws.closed });
  ws.terminate();
}

async function batch() {
  const pick = await pickSymbols();
  // Every k-th perp by 24 h quote volume, crypto and TradFi together, so the slice spans busy and quiet books.
  const k = Math.max(1, Math.floor(pick.rows.length / 100));
  const chosen = pick.rows.filter((_, i) => i % k === 0).slice(0, 100).map((r) => r.s);
  const extraSym = pick.rows.find((r) => !chosen.includes(r.s)).s;
  const ws = open(PUBLIC_URL, { name: 'batch' });
  ws.nextId = 0;
  if (!(await waitOpen(ws))) return log('batch_failed', { refused: ws.refused ?? null });
  log('open', { name: 'batch', ms: ws.openMs, streams: chosen.length });
  const streams = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSec = new Map();
  let firstSnapAll = null;
  const subAt = Date.now();
  ws.on('message', (raw) => {
    const arrival = Date.now();
    const t = process.hrtime.bigint();
    const f = JSON.parse(raw);
    parseNs += process.hrtime.bigint() - t;
    if (f.e === 'depth' || f.e === 'depthSnapshot') {
      frames++;
      bytes += raw.length;
      const sec = Math.floor((arrival - subAt) / 1000);
      perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
      const key = `${f.s}@depth${f.l}`;
      if (!streams.has(key)) streams.set(key, makeStream(key));
      const st = streams.get(key);
      // Only the id chain is checked here, the level bookkeeping is too slow for 100 books.
      if (f.e === 'depthSnapshot') {
        st.snapshots++;
        st.lastU = f.u;
        if (firstSnapAll === null && [...streams.values()].filter((x) => x.snapshots > 0).length === chosen.length) firstSnapAll = arrival - subAt;
      } else {
        st.deltas++;
        if (st.lastU !== null) {
          if (f.U === st.lastU) st.chainEq++;
          else if (f.U === st.lastU + 1) st.chainPlus1++;
          else if (st.chainOther.length < 3) st.chainOther.push({ last: st.lastU, U: f.U, u: f.u });
        }
        st.lastU = f.u;
      }
      return;
    }
    control(ws, 'batch', raw.toString(), f, {});
  });
  ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: chosen.map((s) => `${s}@depth200`), id: ++ws.nextId }));
  await sleep(45_000);
  const secs = [...perSec.entries()].filter(([s]) => s >= 2 && s < 45).map(([, n]) => n).sort((a, b) => a - b);
  const all = [...streams.values()];
  log('batch_summary', {
    streamsDelivering: all.length,
    snapshotted: all.filter((s) => s.snapshots > 0).length,
    allSnapshotsMs: firstSnapAll,
    frames,
    framesPerSecMedian: secs[secs.length >> 1],
    framesPerSecMax: secs.at(-1),
    bytesPerSec: Math.round(bytes / 45),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: Number(parseNs / BigInt(Math.max(1, frames))) / 1000,
    chainEq: all.reduce((a, s) => a + s.chainEq, 0),
    chainPlus1: all.reduce((a, s) => a + s.chainPlus1, 0),
    chainOther: all.flatMap((s) => s.chainOther.map((c) => ({ key: s.key, ...c }))).slice(0, 5),
    silentStreams: chosen.filter((s) => !streams.has(`${s}@depth200`)),
    deltasPerStream: (() => {
      const d = all.map((s) => s.deltas).sort((a, b) => a - b);
      return { min: d[0], median: d[d.length >> 1], max: d.at(-1) };
    })(),
    fewDeltas: all.filter((s) => s.deltas < 45).map((s) => `${s.key}:${s.deltas}`),
  });
  log('send', { label: 'stream 101 past the cap', symbol: extraSym });
  ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [`${extraSym}@depth200`], id: ++ws.nextId }));
  await sleep(3000);
  log('after_101', { delivering: streams.has(`${extraSym}@depth200`), closed: ws.closed, pings: ws.pings.length });
  ws.terminate();
}

async function silence() {
  const pick = await pickSymbols();
  const cases = [
    { name: 'idle_no_pong', subscribe: null, answer: false },
    { name: 'idle_pong', subscribe: null, answer: true },
    { name: 'quiet_book_no_pong', subscribe: `${pick.quiet}@depth200`, answer: false },
  ];
  const sockets = cases.map((c) => {
    const ws = open(PUBLIC_URL, { name: c.name });
    ws.nextId = 0;
    ws.answerPings = c.answer;
    ws.frames = 0;
    ws.on('open', () => {
      if (c.subscribe) ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [c.subscribe], id: ++ws.nextId }));
    });
    ws.on('message', (raw) => {
      ws.frames++;
      const s = raw.toString();
      const f = JSON.parse(s);
      if (f.e === 'depth' || f.e === 'depthSnapshot') return;
      control(ws, c.name, s, f, {});
    });
    return { c, ws };
  });
  const start = Date.now();
  while (Date.now() - start < 110_000 && sockets.some(({ ws }) => ws.closed === null)) await sleep(500);
  for (const { c, ws } of sockets) {
    const gaps = ws.pings.filter((p) => p.kind === 'app').map((p, i, a) => (i ? p.at - a[i - 1].at : p.at));
    log('silence', { name: c.name, quiet: c.subscribe, openMs: ws.openMs, frames: ws.frames, appPings: gaps.length, pingGapsMs: gaps, pingTimes: ws.pings.filter((p) => p.kind === 'app').map((p) => new Date(Number(p.time)).toISOString()), protocolPings: ws.pings.filter((p) => p.kind === 'protocol').length, closed: ws.closed });
    ws.terminate();
  }
}

async function deflate() {
  const ws = open(PUBLIC_URL, { name: 'deflate', deflate: true });
  const ok = await waitOpen(ws);
  log('deflate', { opened: ok, openMs: ws.openMs, negotiated: ws.negotiated });
  ws.terminate();
}

async function noua() {
  for (const [label, headers] of [
    ['no User-Agent', {}],
    ['empty User-Agent', { 'User-Agent': '' }],
    ['User-Agent set', UA],
  ]) {
    const ws = open(PUBLIC_URL, { name: label, headers });
    let frames = 0;
    ws.on('message', () => frames++);
    const ok = await waitOpen(ws);
    if (ok) ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['BTCUSDT@depth15'], id: 1 }));
    await sleep(3000);
    log('handshake', { label, opened: ok, openMs: ws.openMs ?? null, refused: ws.refused ?? null, framesIn3s: frames, closed: ws.closed });
    ws.terminate();
  }
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate, noua };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
