// HashKey Global public WebSocket probe: the v1 and v2 depth topics on the perpetuals, cadence, levels, version field, size unit against the REST book, bbo, keepalive, silence, errors and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in `deflate` mode, which asks once to see what the server negotiates.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hashkey/ws-probe.mjs [book|errors|silence|deflate|anchor]
//   book     v1 and v2 depth and the undocumented markPrice topic on both perpetuals, depth on spot BTCUSDT, v2 bbo, trade and realtimes, a REST book compare at 30 s, pings every 10 s. About 70 s.
//   errors   unknown symbol and topic, text that is not JSON, duplicate and multi-symbol subscriptions, undocumented topics, a limit parameter, unsubscribe, and what a ping may carry. About 36 s.
//   silence  three sockets that never ping, one of them never subscribes, for up to 110 s.
//   deflate  asks for permessage-deflate on v1 and v2 and prints what the server answers.
//   anchor   the undocumented v1 index topic (with its basket formula) and markPrice topic for 30 s, and one REST index read to compare.
// Set PROBE_OUT_DIR to keep raw frames, at most 3 MB a file. Recorded in docs/profiles/hashkey/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const V1 = 'wss://stream-glb.hashkey.com/quote/ws/v1';
const V2 = 'wss://stream-glb.hashkey.com/quote/ws/v2';
const API = 'https://api-glb.hashkey.com';
const PERPS = ['BTCUSDT-PERPETUAL', 'ETHUSDT-PERPETUAL'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const trim = (s, n = 600) => (s.length > n ? s.slice(0, n) + '…' : s);

// Keeps whole frames, and stops writing a file once it holds 3 MB so a capture stays small.
const captured = new Map();
function capture(name, text) {
  if (!OUT) return;
  const bytes = captured.get(name) ?? 0;
  if (bytes > 3_000_000) return;
  captured.set(name, bytes + text.length + 1);
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

// Opens a socket and resolves once it is open, recording the open time and any server protocol pings.
function open(url, name, { deflate = false } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const info = { name, url, serverPings: 0, closed: null, openMs: null, extensions: null };
  ws.on('upgrade', (res) => (info.extensions = res.headers['sec-websocket-extensions'] ?? null));
  ws.on('ping', () => info.serverPings++);
  ws.on('close', (code, reason) => (info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }));
  ws.on('error', (e) => log('socketError', { name, error: String(e) }));
  return new Promise((resolve) => {
    ws.on('open', () => {
      info.openMs = Math.round(performance.now() - t0);
      resolve({ ws, info, t0 });
    });
    ws.on('unexpected-response', (_req, res) => {
      log('refused', { name, status: res.statusCode, headers: res.headers });
      resolve({ ws, info, t0 });
    });
  });
}

// Per stream bookkeeping for one depth topic.
function depthTracker() {
  return { frames: 0, gaps: [], last: null, lastAt: null, bidLevels: [], askLevels: [], bidOrderBad: 0, askOrderBad: 0, crossed: 0, repeats: 0, versions: [], vNotIncreasing: 0, fTrue: 0, fFalse: 0, sendLag: [], arriveLag: [], firstAt: null, emptySide: 0, keys: new Set() };
}

function versionKey(v) {
  const [a, b] = String(v).split('_').map(Number);
  return { a, b };
}

function trackDepth(tr, msg, data, recvMs, recvWall) {
  tr.frames++;
  if (tr.firstAt === null) tr.firstAt = recvMs;
  if (tr.lastAt !== null) tr.gaps.push(Math.round(recvMs - tr.lastAt));
  tr.lastAt = recvMs;
  Object.keys(data).forEach((k) => tr.keys.add(k));
  const b = data.b ?? [];
  const a = data.a ?? [];
  tr.bidLevels.push(b.length);
  tr.askLevels.push(a.length);
  if (!b.length || !a.length) tr.emptySide++;
  if (!b.every((x, i) => i === 0 || Number(b[i - 1][0]) > Number(x[0]))) tr.bidOrderBad++;
  if (!a.every((x, i) => i === 0 || Number(a[i - 1][0]) < Number(x[0]))) tr.askOrderBad++;
  if (b.length && a.length && Number(b[0][0]) >= Number(a[0][0])) tr.crossed++;
  const content = JSON.stringify([b, a]);
  if (tr.last && tr.last.content === content) tr.repeats++;
  if (msg.f === true) tr.fTrue++;
  if (msg.f === false) tr.fFalse++;
  if (data.v !== undefined) {
    if (tr.versions.length < 4) tr.versions.push(data.v);
    if (tr.last?.v !== undefined) {
      const p = versionKey(tr.last.v);
      const c = versionKey(data.v);
      if (!(c.a > p.a || (c.a === p.a && c.b > p.b))) tr.vNotIncreasing++;
    }
  }
  if (msg.sendTime && data.t) tr.sendLag.push(Number(msg.sendTime) - Number(data.t));
  if (data.t) tr.arriveLag.push(recvWall - Number(data.t));
  tr.last = { content, b, a, v: data.v, t: data.t };
}

function summarize(tr) {
  return {
    frames: tr.frames, interArrivalMs: stats(tr.gaps), bidLevels: stats(tr.bidLevels), askLevels: stats(tr.askLevels), bidOrderBad: tr.bidOrderBad, askOrderBad: tr.askOrderBad,
    crossed: tr.crossed, identicalRepeats: tr.repeats, emptySideFrames: tr.emptySide, fTrue: tr.fTrue, fFalse: tr.fFalse, firstVersions: tr.versions, vNotIncreasing: tr.vNotIncreasing,
    sendTimeMinusT: stats(tr.sendLag), arrivalMinusT: stats(tr.arriveLag), dataKeys: [...tr.keys],
  };
}

async function restBook(symbol) {
  const r = await fetch(`${API}/quote/v1/depth?symbol=${symbol}&limit=200`);
  return r.json();
}

// Levels of the socket frame whose size equals the REST size at the same price, over the socket's levels.
function compare(frame, rest) {
  const restMap = { b: new Map(rest.b.map(([p, s]) => [p, s])), a: new Map(rest.a.map(([p, s]) => [p, s])) };
  const out = {};
  for (const side of ['b', 'a']) {
    const levels = frame[side] ?? [];
    let samePrice = 0;
    let sameSize = 0;
    for (const [p, s] of levels) {
      if (restMap[side].has(p)) {
        samePrice++;
        if (restMap[side].get(p) === s) sameSize++;
      }
    }
    out[side] = { socketLevels: levels.length, restLevels: rest[side].length, samePrice, sameSize, socketTop: levels[0], restTop: rest[side][0] };
  }
  return out;
}

async function book() {
  const v1 = await open(V1, 'v1');
  const v2 = await open(V2, 'v2');
  log('open', { v1: v1.info.openMs, v2: v2.info.openMs });
  const trackers = { v1: {}, v2: {} };
  const counts = {};
  const firsts = new Set();
  const pongRtt = { v1: [], v2: [] };
  const pending = { v1: null, v2: null };
  const pongOffset = { v1: [], v2: [] };
  const other = [];
  const marks = {};

  for (const [name, conn] of [['v1', v1], ['v2', v2]]) {
    conn.ws.on('message', (raw) => {
      const recvMs = performance.now();
      const recvWall = Date.now();
      const text = raw.toString('utf8');
      capture(`${name}.jsonl`, text);
      const msg = JSON.parse(text);
      // The pong carries the server's clock, not the ping's value, so the round trip is timed from the last ping sent.
      if (msg.pong !== undefined) {
        const last = pending[name];
        if (last) {
          pongRtt[name].push(Math.round(recvMs - last.perf));
          pongOffset[name].push(Math.round(Number(msg.pong) - (last.wall + recvWall) / 2));
          pending[name] = null;
        }
        if (!firsts.has(`${name}:pong`)) {
          firsts.add(`${name}:pong`);
          log('firstFrame', { name, kind: 'pong', text: trim(text) });
        }
        return;
      }
      const topic = msg.topic;
      const symbol = msg.symbol ?? msg.params?.symbol ?? msg.data?.s;
      const key = `${topic}:${symbol}`;
      counts[`${name}:${key}`] = (counts[`${name}:${key}`] ?? 0) + 1;
      if (!firsts.has(`${name}:${key}:${msg.event ?? 'data'}`)) {
        firsts.add(`${name}:${key}:${msg.event ?? 'data'}`);
        log('firstFrame', { name, key, text: trim(text) });
      }
      if (msg.event || msg.code !== undefined) {
        other.push({ name, text: trim(text, 300) });
        return;
      }
      if (topic === 'markPrice') {
        const d = Array.isArray(msg.data) ? msg.data[0] : msg.data;
        const sym = d?.s ?? d?.symbolId;
        const m = (marks[`${name}:${sym}`] ??= { frames: 0, gaps: [], lastAt: null, times: new Set(), ageMs: [], prices: new Set() });
        m.frames++;
        if (m.lastAt !== null) m.gaps.push(Math.round(recvMs - m.lastAt));
        m.lastAt = recvMs;
        const t = Number(d?.t ?? d?.time);
        m.times.add(t % 1000);
        m.ageMs.push(recvWall - t);
        m.prices.add(d?.p ?? d?.price);
        return;
      }
      if (topic === 'depth') {
        const data = Array.isArray(msg.data) ? msg.data[0] : msg.data;
        if (!data) return;
        trackers[name][symbol] ??= depthTracker();
        trackDepth(trackers[name][symbol], msg, data, recvMs, recvWall);
      }
    });
  }

  const sentAt = performance.now();
  for (const s of [...PERPS, 'BTCUSDT']) {
    v1.ws.send(JSON.stringify({ symbol: s, topic: 'depth', event: 'sub', params: { binary: false }, id: s }));
    v2.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { symbol: s } }));
  }
  v1.ws.send(JSON.stringify({ symbol: PERPS[0], topic: 'trade', event: 'sub', params: { binary: false }, id: 'trade' }));
  v1.ws.send(JSON.stringify({ symbol: PERPS[0], topic: 'realtimes', event: 'sub', params: { binary: false }, id: 'rt' }));
  v2.ws.send(JSON.stringify({ topic: 'bbo', event: 'sub', params: { symbol: PERPS[0] } }));
  v2.ws.send(JSON.stringify({ topic: 'realtimes', event: 'sub', params: { symbol: PERPS[0] } }));
  for (const sym of PERPS) {
    v1.ws.send(JSON.stringify({ symbol: sym, topic: 'markPrice', event: 'sub', params: { binary: false }, id: `mark-${sym}` }));
    v2.ws.send(JSON.stringify({ topic: 'markPrice', event: 'sub', params: { symbol: sym } }));
  }

  const ping = setInterval(() => {
    for (const [name, conn] of [['v1', v1], ['v2', v2]]) {
      const ts = Date.now();
      pending[name] = { perf: performance.now(), wall: ts };
      conn.ws.send(JSON.stringify({ ping: ts }));
    }
  }, 10_000);

  await sleep(30_000);
  for (const s of PERPS) {
    const rest = await restBook(s);
    for (const name of ['v1', 'v2']) {
      const tr = trackers[name][s];
      if (tr?.last) log('restCompare', { name, symbol: s, socketT: tr.last.t, restT: rest.t, ...compare(tr.last, rest) });
    }
  }
  await sleep(35_000);
  clearInterval(ping);

  for (const name of ['v1', 'v2']) {
    for (const [s, tr] of Object.entries(trackers[name])) {
      log('depthSummary', { name, symbol: s, firstFrameAfterSubMs: tr.firstAt ? Math.round(tr.firstAt - sentAt) : null, ...summarize(tr) });
    }
  }
  for (const [k, m] of Object.entries(marks)) log('markPriceSummary', { key: k, frames: m.frames, interArrivalMs: stats(m.gaps), tMsMod1000: [...m.times], arrivalMinusT: stats(m.ageMs), distinctPrices: m.prices.size });
  log('frameCounts', counts);
  log('controlFrames', { n: other.length, sample: other.slice(0, 12) });
  log('pong', { rttMs: { v1: stats(pongRtt.v1), v2: stats(pongRtt.v2) }, pongMinusLocalMidpointMs: { v1: stats(pongOffset.v1), v2: stats(pongOffset.v2) } });
  v1.ws.close();
  v2.ws.close();
  await sleep(500);
  log('sockets', { v1: v1.info, v2: v2.info });
}

// Each request goes alone, and every frame that arrives in the next 900 ms is attributed to it.
async function errors() {
  const conns = { v1: await open(V1, 'v1'), v2: await open(V2, 'v2') };
  let label = 'none';
  const replies = {};
  const dataCounts = {};
  const maxLevels = {};
  for (const [name, conn] of Object.entries(conns)) {
    conn.ws.on('message', (raw) => {
      const text = raw.toString('utf8');
      capture(`errors-${name}.jsonl`, text);
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        (replies[label] ??= []).push(trim(text, 300));
        return;
      }
      const isData = msg.data !== undefined && msg.event === undefined && msg.code === undefined;
      if (!isData) {
        (replies[label] ??= []).push(trim(text, 300));
        return;
      }
      const d = Array.isArray(msg.data) ? msg.data[0] : msg.data;
      const key = `${name}:${msg.topic}:${msg.symbol ?? msg.params?.symbol ?? d?.s ?? d?.symbolId}`;
      if (!dataCounts[key]) (replies[label] ??= []).push('first data ' + trim(text, 260));
      dataCounts[key] = (dataCounts[key] ?? 0) + 1;
      if (msg.topic === 'depth' && d) maxLevels[key] = Math.max(maxLevels[key] ?? 0, (d.b ?? []).length, (d.a ?? []).length);
    });
  }
  const v1sub = (symbol, topic, extra = {}) => ({ symbol, topic, event: 'sub', params: { binary: false, ...extra }, id: 1 });
  const v2sub = (params, topic = 'depth') => ({ topic, event: 'sub', params });
  const steps = [
    ['v1 ping with 12345', 'v1', { ping: 12345 }],
    ['v2 ping with a string', 'v2', { ping: 'abc' }],
    ['v1 unknown symbol', 'v1', v1sub('NOPEUSDT-PERPETUAL', 'depth')],
    ['v1 unknown topic', 'v1', v1sub('BTCUSDT-PERPETUAL', 'nope')],
    ['v1 not json', 'v1', 'not json'],
    ['v1 no symbol', 'v1', { topic: 'depth', event: 'sub', params: { binary: false }, id: 1 }],
    ['v1 delisted BTCUSD-PERPETUAL', 'v1', v1sub('BTCUSD-PERPETUAL', 'depth')],
    ['v1 index topic', 'v1', v1sub('BTCUSDT-PERPETUAL', 'index')],
    ['v1 index topic on BTCUSDT', 'v1', v1sub('BTCUSDT', 'index')],
    ['v1 fundingRate topic', 'v1', v1sub('BTCUSDT-PERPETUAL', 'fundingRate')],
    ['v1 bbo topic', 'v1', v1sub('BTCUSDT-PERPETUAL', 'bbo')],
    ['v1 markPrice topic', 'v1', v1sub('BTCUSDT-PERPETUAL', 'markPrice')],
    ['v1 depth two symbols comma', 'v1', v1sub('BTCUSDT-PERPETUAL,ETHUSDT-PERPETUAL', 'depth')],
    ['v1 depth duplicate', 'v1', v1sub('BTCUSDT-PERPETUAL', 'depth')],
    ['v2 unknown symbol', 'v2', v2sub({ symbol: 'NOPEUSDT-PERPETUAL' })],
    ['v2 unknown topic', 'v2', v2sub({ symbol: 'BTCUSDT-PERPETUAL' }, 'nope')],
    ['v2 not json', 'v2', 'not json'],
    ['v2 no symbol', 'v2', v2sub({})],
    ['v2 two symbols comma', 'v2', v2sub({ symbol: 'BTCUSDT-PERPETUAL,ETHUSDT-PERPETUAL' })],
    ['v2 index topic', 'v2', v2sub({ symbol: 'BTCUSDT-PERPETUAL' }, 'index')],
    ['v2 index topic on BTCUSDT', 'v2', v2sub({ symbol: 'BTCUSDT' }, 'index')],
    ['v2 fundingRate topic', 'v2', v2sub({ symbol: 'BTCUSDT-PERPETUAL' }, 'fundingRate')],
    ['v2 markPrice topic', 'v2', v2sub({ symbol: 'ETHUSDT-PERPETUAL' }, 'markPrice')],
    ['v2 delisted BTCUSD-PERPETUAL', 'v2', v2sub({ symbol: 'BTCUSD-PERPETUAL' })],
    ['v2 depth ETH', 'v2', v2sub({ symbol: 'ETHUSDT-PERPETUAL' })],
    ['v2 depth ETH duplicate', 'v2', v2sub({ symbol: 'ETHUSDT-PERPETUAL' })],
  ];
  for (const [l, name, frame] of steps) {
    label = l;
    conns[name].ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
    await sleep(900);
  }
  label = 'late';
  await sleep(4_000);
  const before = { ...dataCounts };
  label = 'cancel';
  conns.v1.ws.send(JSON.stringify({ symbol: 'ETHUSDT-PERPETUAL', topic: 'depth', event: 'cancel', params: { binary: false }, id: 1 }));
  conns.v2.ws.send(JSON.stringify({ topic: 'depth', event: 'cancel', params: { symbol: 'ETHUSDT-PERPETUAL' } }));
  await sleep(4_000);
  const afterCancel = Object.fromEntries(Object.entries(dataCounts).filter(([k]) => k.includes('depth:ETHUSDT')).map(([k, v]) => [k, v - (before[k] ?? 0)]));
  for (const [l, r] of Object.entries(replies)) log('reply', { label: l, frames: r.slice(0, 4) });
  log('dataCounts', dataCounts);
  log('maxLevels', maxLevels);
  log('framesAfterCancel4s', afterCancel);

  // A depth subscription with a limit, alone on a fresh socket of each version.
  const lim = { v1: await open(V1, 'v1-limit'), v2: await open(V2, 'v2-limit') };
  const limLevels = { v1: [], v2: [] };
  for (const [name, conn] of Object.entries(lim)) {
    conn.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      const d = Array.isArray(msg.data) ? msg.data[0] : msg.data;
      if (msg.topic === 'depth' && d) limLevels[name].push(Math.max((d.b ?? []).length, (d.a ?? []).length));
    });
  }
  lim.v1.ws.send(JSON.stringify(v1sub('ETHUSDT-PERPETUAL', 'depth', { limit: 5 })));
  lim.v2.ws.send(JSON.stringify(v2sub({ symbol: 'ETHUSDT-PERPETUAL', limit: 5 })));
  await sleep(3_000);
  log('limitParam', { v1: stats(limLevels.v1), v2: stats(limLevels.v2) });
  for (const c of [...Object.values(conns), ...Object.values(lim)]) c.ws.close();
  await sleep(300);
  log('sockets', { v1: conns.v1.info, v2: conns.v2.info });
}

async function silence() {
  const a = await open(V1, 'v1-sub-noping');
  const b = await open(V1, 'v1-nosub-noping');
  const c = await open(V2, 'v2-sub-noping');
  const frames = { [a.info.name]: 0, [b.info.name]: 0, [c.info.name]: 0 };
  const nonData = [];
  for (const conn of [a, b, c]) {
    conn.ws.on('message', (raw) => {
      frames[conn.info.name]++;
      const text = raw.toString('utf8');
      if (!text.includes('"data"')) nonData.push({ name: conn.info.name, atMs: Math.round(performance.now() - conn.t0), text: trim(text, 200) });
    });
  }
  a.ws.send(JSON.stringify({ symbol: 'ETHUSDT-PERPETUAL', topic: 'depth', event: 'sub', params: { binary: false }, id: 1 }));
  c.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { symbol: 'ETHUSDT-PERPETUAL' } }));
  const deadline = performance.now() + 110_000;
  while (performance.now() < deadline && [a, b, c].some((x) => x.info.closed === null)) await sleep(500);
  for (const conn of [a, b, c]) {
    if (conn.info.closed === null) conn.ws.close();
  }
  await sleep(300);
  log('silence', { frames, nonData: nonData.slice(0, 10), sockets: [a.info, b.info, c.info] });
}

// The undocumented v1 index and markPrice topics, which carry the anchor numbers and the index basket.
async function anchor() {
  const conn = await open(V1, 'v1-anchor');
  const streams = {};
  const firsts = [];
  conn.ws.on('message', (raw) => {
    const recvMs = performance.now();
    const recvWall = Date.now();
    const text = raw.toString('utf8');
    capture('anchor-v1.jsonl', text);
    const msg = JSON.parse(text);
    if (msg.pong !== undefined) return;
    const d = Array.isArray(msg.data) ? msg.data[0] : msg.data;
    if (!d) {
      firsts.push(trim(text, 300));
      return;
    }
    const key = `${msg.topic}:${d.symbol ?? d.symbolId ?? d.s}`;
    const st = (streams[key] ??= { frames: 0, gaps: [], lastAt: null, ageMs: [], values: new Set(), formulas: new Set(), keys: new Set(), dataIsArray: new Set() });
    if (st.frames === 0) firsts.push(trim(text, 1500));
    st.frames++;
    st.dataIsArray.add(Array.isArray(msg.data));
    Object.keys(d).forEach((k) => st.keys.add(k));
    if (st.lastAt !== null) st.gaps.push(Math.round(recvMs - st.lastAt));
    st.lastAt = recvMs;
    const t = Number(d.time ?? d.t ?? msg.sendTime);
    if (t) st.ageMs.push(recvWall - t);
    st.values.add(d.index ?? d.price);
    if (d.formula) st.formulas.add(d.formula.replace(/[0-9.]+\[/g, '[').replace(/\)\/[0-9.]+/, ')/w'));
  });
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'BTCUSD']) conn.ws.send(JSON.stringify({ symbol: sym, topic: 'index', event: 'sub', params: { binary: false }, id: `index-${sym}` }));
  for (const sym of PERPS) conn.ws.send(JSON.stringify({ symbol: sym, topic: 'markPrice', event: 'sub', params: { binary: false }, id: `mark-${sym}` }));
  const ping = setInterval(() => conn.ws.send(JSON.stringify({ ping: Date.now() })), 10_000);
  await sleep(15_000);
  const rest = await (await fetch(`${API}/quote/v1/index`)).json();
  const restAt = Date.now();
  await sleep(15_000);
  clearInterval(ping);
  for (const f of firsts) log('first', { text: f });
  for (const [k, st] of Object.entries(streams)) {
    log('anchorStream', { key: k, frames: st.frames, dataIsArray: [...st.dataIsArray], keys: [...st.keys], interArrivalMs: stats(st.gaps), arrivalMinusTime: stats(st.ageMs), distinctValues: st.values.size, formulaShapes: [...st.formulas] });
  }
  log('restIndexAtMid', { at: restAt, index: rest.index });
  conn.ws.close();
  await sleep(300);
  log('socket', conn.info);
}

async function deflate() {
  for (const url of [V1, V2]) {
    const conn = await open(url, url.endsWith('v1') ? 'v1-deflate' : 'v2-deflate', { deflate: true });
    let first = null;
    conn.ws.on('message', (raw, isBinary) => (first ??= { isBinary, bytes: raw.length, head: trim(raw.toString('utf8'), 120) }));
    if (url === V1) conn.ws.send(JSON.stringify({ symbol: 'BTCUSDT-PERPETUAL', topic: 'depth', event: 'sub', params: { binary: false }, id: 1 }));
    else conn.ws.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { symbol: 'BTCUSDT-PERPETUAL' } }));
    await sleep(3_000);
    conn.ws.close();
    await sleep(200);
    log('deflate', { url, negotiated: conn.info.extensions, openMs: conn.info.openMs, first });
  }
}

const mode = process.argv[2] ?? 'book';
log('run', { mode, startedAt: new Date().toISOString() });
const modes = { book, errors, silence, deflate, anchor };
await modes[mode]();
log('done', { at: new Date().toISOString() });
process.exit(0);
