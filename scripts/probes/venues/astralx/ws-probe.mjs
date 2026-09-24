// AstralX futures WebSocket probe: the depth_full book topic, mark and index topics, errors, binary frames, a batch of every perpetual, silence, deflate, and a book comparison against OKX.
// AstralX publishes no API documentation, so the URL and frames here are the ones the www.astralx.com web front uses, read out of its JavaScript bundle on 2026-09-22.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/astralx/ws-probe.mjs [book|errors|mirror|batch|silence|deflate]
//   book     depth_full on five perps plus mark_price, index_price and feeRate for 60 s, a text ping, and two unsubscribe spellings. About 62 s.
//   errors   one socket per bad or odd request (unknown, hidden and spot ids, duplicate, other topics, binary, not JSON), 4 s each. About 45 s.
//   mirror   depth_full, mark_price and index_price on five perps for 25 s, compared twice against the OKX and Binance REST books and the OKX mark and index. About 30 s.
//   batch    depth_full on all 51 ids of the ticker list on one socket for 45 s. About 47 s.
//   silence  three sockets that differ in what the client sends or subscribes, held for up to 120 s, or fewer seconds given as a second argument.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/astralx/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync, inflateRawSync, gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_FUTURES = 'wss://fws.astralx.com/future/websocket';
const TICKER = 'https://www.astralx.com/f_api/public/quote/ticker';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (topic, symbol, extra = {}) => ({ id: `${topic}_${symbol}`, topic, event: 'sub', symbol, params: { binary: false, ...extra } });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

function open(url = URL_FUTURES, opts = { perMessageDeflate: false }) {
  const t0 = Date.now();
  const ws = new WebSocket(url, opts);
  ws.opened = new Promise((resolve, reject) => {
    ws.on('upgrade', (res) => { ws.upgradeHeaders = res.headers; });
    ws.on('open', () => resolve(Date.now() - t0));
    ws.on('unexpected-response', (req, res) => reject(new Error(`unexpected ${res.statusCode}`)));
    ws.on('error', reject);
  });
  return ws;
}

function decode(data, isBinary) {
  if (!isBinary) return { text: data.toString('utf8'), binary: false };
  if (data[0] === 0x7b) return { text: data.toString('utf8'), binary: 'plain', wireBytes: data.length };
  for (const [name, fn] of [['zlib', inflateSync], ['raw', inflateRawSync], ['gzip', gunzipSync]]) {
    try {
      return { text: fn(data).toString('utf8'), binary: name, wireBytes: data.length };
    } catch {}
  }
  return { text: null, binary: 'unknown', wireBytes: data.length };
}

// Checks one depth_full frame: level counts, order, crossing, and whether it repeats the previous frame of the symbol.
function bookCheck(state, symbol, data) {
  const s = (state[symbol] ??= { frames: 0, dt: [], bidLv: [], askLv: [], bidsNotDesc: 0, asksNotAsc: 0, crossed: 0, repeats: 0, oneSided: 0, age: [], last: null, lastAt: 0, prev: null });
  const now = Date.now();
  s.frames++;
  if (s.lastAt) s.dt.push(now - s.lastAt);
  s.lastAt = now;
  const b = data.b ?? [];
  const a = data.a ?? [];
  s.bidLv.push(b.length);
  s.askLv.push(a.length);
  if (b.length === 0 || a.length === 0) s.oneSided++;
  const bidsAsc = b.length > 1 && Number(b[1][0]) > Number(b[0][0]);
  if (s.frames === 1) s.firstFrameBids = bidsAsc ? 'ascending' : 'descending';
  else for (let i = 1; i < b.length; i++) if (Number(b[i][0]) >= Number(b[i - 1][0])) { s.bidsNotDesc++; break; }
  for (let i = 1; i < a.length; i++) if (Number(a[i][0]) <= Number(a[i - 1][0])) { s.asksNotAsc++; break; }
  const bestBid = Math.max(...b.map((l) => Number(l[0])));
  if (b.length && a.length && bestBid >= Number(a[0][0])) s.crossed++;
  const sig = JSON.stringify([b, a]);
  if (s.prev === sig) s.repeats++;
  s.prev = sig;
  if (data.t) s.age.push(now - Number(data.t));
  s.last = data;
}

function summarizeBooks(state) {
  for (const [symbol, s] of Object.entries(state)) {
    log('book', { symbol, frames: s.frames, dtMs: stats(s.dt), bidLevels: [Math.min(...s.bidLv), Math.max(...s.bidLv)], askLevels: [Math.min(...s.askLv), Math.max(...s.askLv)], firstFrameBids: s.firstFrameBids, laterBidsNotDescending: s.bidsNotDesc, asksNotAscending: s.asksNotAsc, crossed: s.crossed, identicalToPrevious: s.repeats, oneSidedOrEmpty: s.oneSided, ageMs: stats(s.age) });
  }
}

// Mark and index of one symbol arrive a few ms apart once a second, so a pair is the two frames that arrive within 300 ms of each other.
function pairMarkIndex(state, symbol, topic, value) {
  const now = Date.now();
  const st = (state[symbol] ??= { mark: null, markAt: 0, index: null, indexAt: 0, equal: 0, differ: 0, maxPpm: 0 });
  if (topic === 'mark_price') { st.mark = value; st.markAt = now; }
  else { st.index = value; st.indexAt = now; }
  const otherAt = topic === 'mark_price' ? st.indexAt : st.markAt;
  if (otherAt && now - otherAt < 300 && st.mark !== null && st.index !== null) {
    if (st.mark === st.index) st.equal++;
    else st.differ++;
    st.maxPpm = Math.max(st.maxPpm, Math.round(Math.abs(st.mark / st.index - 1) * 1e6));
    st.markAt = 0;
    st.indexAt = 0;
  }
}

async function book() {
  const t0 = Date.now();
  const ws = open();
  const openMs = await ws.opened;
  log('open', { url: URL_FUTURES, ms: openMs, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, server: ws.upgradeHeaders?.server, cfRay: ws.upgradeHeaders?.['cf-ray'] });
  const books = {};
  const other = {};
  const parseUs = [];
  const bytes = [];
  const firstSeen = new Set();
  const replies = [];
  const markVsIndex = {};
  let serverPings = 0;
  ws.on('ping', () => serverPings++);
  ws.on('message', (data, isBinary) => {
    const d = decode(data, isBinary);
    if (d.text === null) {
      log('undecodable', { wireBytes: d.wireBytes, head: data.subarray(0, 8).toString('hex') });
      return;
    }
    if (d.text.startsWith('{"pong"') || d.text === 'pong') {
      replies.push({ text: d.text, at: Date.now() });
      return;
    }
    const t0 = performance.now();
    let f;
    try {
      f = JSON.parse(d.text);
    } catch {
      log('non_json', { text: d.text.slice(0, 200) });
      return;
    }
    parseUs.push(Math.round((performance.now() - t0) * 1000));
    bytes.push(isBinary ? d.wireBytes : data.length);
    const kind = `${f.topic}|${f.data ? 'data' : 'ack'}|${d.binary || 'text'}|code=${f.code}`;
    if (!firstSeen.has(kind)) {
      firstSeen.add(kind);
      const trimmed = f.data?.a ? { ...f, data: { ...f.data, a: f.data.a.slice(0, 3), b: f.data.b?.slice(0, 3), aLen: f.data.a.length, bLen: f.data.b?.length } } : f;
      log('first', { kind, frame: JSON.stringify(trimmed).slice(0, 700) });
      capture('book-first-frames.jsonl', JSON.stringify(trimmed));
    }
    if (f.topic === 'depth_full' && f.data?.s && !d.binary) {
      bookCheck(books, f.data.s, f.data);
    } else if (f.data) {
      const key = `${f.topic} ${f.symbol ?? f.data.s ?? ''}${d.binary ? ' binary' : ''}`;
      const o = (other[key] ??= { frames: 0, dt: [], lastAt: 0, values: new Set() });
      o.frames++;
      if (o.lastAt) o.dt.push(Date.now() - o.lastAt);
      o.lastAt = Date.now();
      o.values.add(JSON.stringify(f.data.price ?? f.data.p ?? f.data.fundingRate ?? f.data.a?.[0] ?? null));
      if (f.topic === 'mark_price' || f.topic === 'index_price') pairMarkIndex(markVsIndex, f.symbol, f.topic, f.data.price ?? f.data.p);
    }
  });

  const perps = ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'SOLUSDT_PERP', 'GIGGLEUSDT_PERP', 'ZKPUSDT_PERP'];
  for (const p of perps) ws.send(JSON.stringify(sub('depth_full', p)));
  for (const p of ['BTCUSDT_PERP', 'GIGGLEUSDT_PERP']) {
    ws.send(JSON.stringify(sub('mark_price', p, { type: 0 })));
    ws.send(JSON.stringify(sub('index_price', p)));
  }
  ws.send(JSON.stringify(sub('feeRate', 'BTCUSDT_PERP')));
  let closed = null;
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }; });
  await sleep(3000);
  const pingAt = Date.now();
  ws.send('ping');
  await sleep(1500);
  const pong = replies.find((r) => r.at >= pingAt);
  log('ping', { sent: 'ping', reply: pong?.text ?? null, ms: pong ? pong.at - pingAt : null });

  // Unsubscribe one stream to see whether it stops.
  ws.send(JSON.stringify({ ...sub('depth_full', 'SOLUSDT_PERP'), event: 'cancel' }));
  ws.send(JSON.stringify({ ...sub('depth_full', 'ZKPUSDT_PERP'), event: 'unSub' }));
  const zkpBefore = () => books.ZKPUSDT_PERP?.frames ?? 0;
  const solBefore = () => books.SOLUSDT_PERP?.frames ?? 0;
  const z0 = zkpBefore();
  const s0 = solBefore();
  await sleep(55_000);
  log('after_unsubscribe', { zkpFramesSince: zkpBefore() - z0, solFramesSince: solBefore() - s0, closed });
  summarizeBooks(books);
  for (const [key, o] of Object.entries(other)) log('stream', { key, frames: o.frames, dtMs: stats(o.dt), distinctValues: o.values.size });
  for (const [symbol, v] of Object.entries(markVsIndex)) log('mark_vs_index', { symbol, equal: v.equal, differ: v.differ, maxPpm: v.maxPpm });
  log('wire', { framesParsed: parseUs.length, parseUs: stats(parseUs), bytes: stats(bytes), serverPings });
  const btc = books.BTCUSDT_PERP?.last;
  if (btc) log('btc_last_frame', { bids: btc.b.slice(0, 3), asks: btc.a.slice(0, 3), bidLevels: btc.b.length, askLevels: btc.a.length });
  ws.close();
}

// One socket per request, so a request that makes the server close the socket is identified.
async function errors() {
  const cases = [
    ['unknown symbol', JSON.stringify(sub('depth_full', 'NOPEUSDT_PERP'))],
    ['hidden id', JSON.stringify(sub('depth_full', 'AUCTIONUSDT_PERP'))],
    ['spot spelling', JSON.stringify(sub('depth_full', 'BTCUSDT'))],
    ['duplicate', JSON.stringify(sub('depth_full', 'BTCUSDT_PERP')), 2],
    ['depth topic', JSON.stringify(sub('depth', 'ETHUSDT_PERP'))],
    ['diffDepth topic', JSON.stringify(sub('diffDepth', 'ETHUSDT_PERP'))],
    ['unknown topic', JSON.stringify(sub('nope', 'BTCUSDT_PERP'))],
    ['binary true', JSON.stringify({ id: 'bin', topic: 'depth_full', event: 'sub', symbol: 'XRPUSDT_PERP', params: { binary: true } })],
    ['json ping', JSON.stringify({ ping: 1 })],
    ['not json', 'hello'],
  ];
  for (const [label, text, times = 1] of cases) {
    const ws = open();
    await ws.opened;
    const t0 = Date.now();
    const got = [];
    let closed = null;
    ws.on('message', (data, isBinary) => {
      const d = decode(data, isBinary);
      if (got.length < 3) got.push({ atMs: Date.now() - t0, binary: d.binary, bytes: data.length, text: d.text?.slice(0, 220) });
      else got.push(null);
    });
    ws.on('close', (code, reason) => { closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }; });
    for (let i = 0; i < times; i++) ws.send(text);
    await sleep(4000);
    log('error_case', { label, sent: text, frames: got.length, first: got.filter(Boolean), closed });
    if (!closed) ws.close();
    await sleep(300);
  }
}

async function restBooks(base) {
  const okx = await fetch(`https://www.okx.com/api/v5/market/books?instId=${base}-USDT-SWAP&sz=400`).then((r) => r.json()).catch(() => null);
  const bn = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${base}USDT&limit=100`).then((r) => r.json()).catch(() => null);
  return {
    okx: okx?.data?.[0] ? { bids: okx.data[0].bids.map((l) => [Number(l[0]), Number(l[1])]), asks: okx.data[0].asks.map((l) => [Number(l[0]), Number(l[1])]) } : null,
    bn: bn?.bids ? { bids: bn.bids.map((l) => [Number(l[0]), Number(l[1])]), asks: bn.asks.map((l) => [Number(l[0]), Number(l[1])]) } : null,
  };
}

// Of the venue's top 20 levels per side, how many prices exist in the other book, and the size ratio where they do.
function overlap(ax, other) {
  if (!other) return null;
  const res = {};
  for (const side of ['bids', 'asks']) {
    const m = new Map(other[side].map(([p, q]) => [p, q]));
    const top = ax[side].slice(0, 20);
    const ratios = [];
    let found = 0;
    for (const [p, q] of top) {
      if (m.has(p)) {
        found++;
        if (m.get(p) > 0) ratios.push(q / m.get(p));
      }
    }
    const s = ratios.sort((x, y) => x - y);
    res[side] = { found, of: top.length, sizeRatioMedian: s.length ? Number(s[Math.floor(s.length / 2)].toFixed(3)) : null };
  }
  res.touch = { axBid: ax.bids[0]?.[0], otherBid: other.bids[0]?.[0], axAsk: ax.asks[0]?.[0], otherAsk: other.asks[0]?.[0] };
  return res;
}

async function mirror() {
  const ws = open();
  log('open', { ms: await ws.opened });
  const last = {};
  const anchors = {};
  const markVsIndex = {};
  ws.on('message', (data) => {
    const f = JSON.parse(data.toString('utf8'));
    if (f.topic === 'depth_full' && f.data?.s) last[f.data.s] = { at: Date.now(), bids: f.data.b.map((l) => [Number(l[0]), Number(l[1])]), asks: f.data.a.map((l) => [Number(l[0]), Number(l[1])]) };
    if ((f.topic === 'mark_price' || f.topic === 'index_price') && f.data) {
      const v = f.data.price ?? f.data.p;
      (anchors[f.symbol] ??= {})[f.topic] = v;
      pairMarkIndex(markVsIndex, f.symbol, f.topic, v);
    }
  });
  const bases = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'];
  for (const b of bases) {
    ws.send(JSON.stringify(sub('depth_full', `${b}USDT_PERP`)));
    ws.send(JSON.stringify(sub('mark_price', `${b}USDT_PERP`, { type: 0 })));
    ws.send(JSON.stringify(sub('index_price', `${b}USDT_PERP`)));
  }
  for (const round of [1, 2]) {
    await sleep(10_000);
    for (const b of bases) {
      const rest = await restBooks(b);
      const t0 = Date.now();
      const ax = last[`${b}USDT_PERP`];
      if (!ax) {
        log('mirror', { round, base: b, astralx: 'no frame' });
        continue;
      }
      log('mirror', { round, base: b, astralxFrameAgeAtRestReplyMs: t0 - ax.at, okx: overlap(ax, rest.okx), binance: overlap(ax, rest.bn) });
      const okxMark = await fetch(`https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${b}-USDT-SWAP`).then((r) => r.json()).catch(() => null);
      const okxIndex = await fetch(`https://www.okx.com/api/v5/market/index-tickers?instId=${b}-USDT`).then((r) => r.json()).catch(() => null);
      const an = anchors[`${b}USDT_PERP`] ?? {};
      log('anchor_vs_okx', { round, base: b, astralxMark: an.mark_price, okxMark: Number(okxMark?.data?.[0]?.markPx), astralxIndex: an.index_price, okxIndex: Number(okxIndex?.data?.[0]?.idxPx) });
    }
  }
  for (const [symbol, v] of Object.entries(markVsIndex)) log('mark_vs_index', { symbol, equal: v.equal, differ: v.differ, maxPpm: v.maxPpm });
  ws.close();
}

async function batch() {
  const ids = (await fetch(TICKER).then((r) => r.json())).data.map((r) => r.s);
  const ws = open();
  log('open', { ms: await ws.opened, ids: ids.length });
  const frames = {};
  const acks = {};
  let total = 0;
  let totalBytes = 0;
  const perSecond = [];
  let secFrames = 0;
  const timer = setInterval(() => { perSecond.push(secFrames); secFrames = 0; }, 1000);
  ws.on('message', (data) => {
    total++;
    secFrames++;
    totalBytes += data.length;
    const f = JSON.parse(data.toString('utf8'));
    if (f.data?.s) frames[f.data.s] = (frames[f.data.s] ?? 0) + 1;
    else acks[`code=${f.code} ${f.msg}`] = (acks[`code=${f.code} ${f.msg}`] ?? 0) + 1;
  });
  const t0 = Date.now();
  for (const id of ids) ws.send(JSON.stringify(sub('depth_full', id)));
  log('sent', { frames: ids.length, ms: Date.now() - t0 });
  await sleep(45_000);
  clearInterval(timer);
  const silent = ids.filter((id) => !frames[id]);
  log('batch', { subscribed: ids.length, delivering: Object.keys(frames).length, silent: silent.join(' '), acks, framesPerSecond: stats(perSecond.slice(1)), bytesPerSecond: Math.round(totalBytes / 45), bytesPerFrame: Math.round(totalBytes / total) });
  const counts = Object.entries(frames).map(([, n]) => n);
  log('batch_per_symbol_frames', { ...stats(counts), under10: Object.entries(frames).filter(([, n]) => n < 10).map(([id, n]) => `${id}:${n}`).join(' ') });
  ws.close();
}

async function silence() {
  const holdMs = Math.min(120, Number(process.argv[3] ?? 120)) * 1000;
  const specs = [
    { name: 'idle', subscribe: false, ping: false },
    { name: 'subscribed_no_ping', subscribe: true, ping: false },
    { name: 'ping_only', subscribe: false, ping: true },
  ];
  const t0 = Date.now();
  const done = specs.map(async (spec) => {
    const ws = open();
    await ws.opened;
    let serverPings = 0;
    let frames = 0;
    let pongs = 0;
    let timer;
    ws.on('ping', () => serverPings++);
    ws.on('message', (d) => { frames++; if (d.toString().startsWith('{"pong"')) pongs++; });
    if (spec.subscribe) ws.send(JSON.stringify(sub('depth_full', 'ZKPUSDT_PERP')));
    if (spec.ping) timer = setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 10_000);
    const closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString(), atMs: Date.now() - t0 })));
    const res = await Promise.race([closed, sleep(holdMs).then(() => null)]);
    clearInterval(timer);
    log('silence', { socket: spec.name, holdS: holdMs / 1000, closed: res, stillOpen: res === null, serverPings, frames, pongs });
    if (res === null) ws.terminate();
  });
  await Promise.all(done);
}

async function deflate() {
  const ws = open(URL_FUTURES, { perMessageDeflate: true });
  const ms = await ws.opened;
  log('deflate', { ms, requested: 'permessage-deflate', negotiated: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, extensions: ws.extensions });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const run = { book, errors, mirror, batch, silence, deflate }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
setTimeout(() => process.exit(0), 500);
