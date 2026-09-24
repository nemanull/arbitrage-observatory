// Backpack Exchange WebSocket probe: the depth stream against the REST snapshot, the sequence and gap rule, level order, size unit, aggregated depth, book ticker and mark price streams, errors, keepalive, silence and a batch of every open perpetual on one connection.
// Public, unauthenticated and read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/backpack/ws-probe.mjs [book|batch|silence|deflate]
//   book     depth on six perps for 70 s with a REST snapshot aligned by update id and a final compare, depth.200ms, bookTicker, markPrice, and an error socket, about 75 s
//   batch    depth on every open perpetual on one connection for 45 s
//   silence  five sockets that differ only in what they subscribe, whether they answer the server ping, and whether they send their own ping, for 120 s
//   deflate  offers permessage-deflate once and prints what the server negotiates
// Set PROBE_OUT_DIR to keep raw frames.
// Recorded in docs/profiles/backpack/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.backpack.exchange';
const API = 'https://api.backpack.exchange';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const count = (arr, key) => arr.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(label, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, ...opts });
  const s = { ws, label, t0, openMs: undefined, pings: [], closed: undefined, ext: undefined };
  ws.on('upgrade', (res) => (s.ext = res.headers['sec-websocket-extensions'] ?? null));
  ws.on('ping', () => s.pings.push(Math.round((performance.now() - t0) / 1000)));
  ws.on('close', (code, reason) => (s.closed = { atS: Math.round((performance.now() - t0) / 100) / 10, code, reason: reason.toString() }));
  ws.on('error', (e) => log('socket_error', { label, error: String(e.message) }));
  s.ready = new Promise((resolve) => ws.once('open', () => ((s.openMs = Math.round(performance.now() - t0)), resolve())));
  return s;
}

const send = (s, obj) => s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));

async function restDepth(symbol, limit) {
  const res = await fetch(`${API}/api/v1/depth?symbol=${symbol}${limit ? `&limit=${limit}` : ''}`);
  return res.json();
}

// REST prints "86700" where the socket prints "86700.0", so levels are keyed by number, never by the string.
function applyLevels(side, levels) {
  for (const [p, q] of levels) {
    if (Number(q) === 0) side.delete(Number(p));
    else side.set(Number(p), Number(q));
  }
}

const toSide = (levels) => new Map(levels.map(([p, q]) => [Number(p), Number(q)]));

function topOf(side, desc, n) {
  return [...side.entries()].sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, n);
}

async function book() {
  const syms = ['BTC_USDC_PERP', 'ETH_USDC_PERP', 'SOL_USDC_PERP', 'LINK_USDC_PERP', 'kSHIB_USDC_PERP', 'AAPL.US_USDC_PERP'];
  const s = open('book');
  await s.ready;
  log('open', { label: 'book', ms: s.openMs, ext: s.ext });
  const st = new Map(syms.map((x) => [x, { frames: 0, gaps: [], lastU: undefined, eqUu: 0, empty: 0, bidsUnordered: 0, asksUnordered: 0, maxLevels: 0, lastAt: undefined, maxSilenceMs: 0, firstAt: undefined, deltas: [], engineLagMs: [] }]));
  const other = [];
  const streams = count([], () => '');
  const t0 = performance.now();
  s.ws.on('message', (raw) => {
    const now = performance.now();
    const text = raw.toString();
    const msg = JSON.parse(text);
    const stream = msg.stream ?? '(none)';
    streams[stream] = (streams[stream] ?? 0) + 1;
    if (!msg.stream) {
      other.push({ atMs: Math.round(now - t0), text: text.slice(0, 300) });
      capture('book-other.jsonl', text);
      return;
    }
    const d = msg.data;
    if (stream.startsWith('depth.') && !stream.startsWith('depth.200ms.')) {
      const x = st.get(d.s);
      if (!x) return;
      if (x.frames < 3) capture('book-depth-first.jsonl', text);
      x.frames++;
      if (x.lastU !== undefined && d.U !== x.lastU + 1) x.gaps.push({ expected: x.lastU + 1, got: d.U });
      x.lastU = d.u;
      if (d.U === d.u) x.eqUu++;
      if (d.a.length === 0 && d.b.length === 0) x.empty++;
      if (!d.b.every((l, i) => i === 0 || Number(d.b[i - 1][0]) > Number(l[0]))) x.bidsUnordered++;
      if (!d.a.every((l, i) => i === 0 || Number(d.a[i - 1][0]) < Number(l[0]))) x.asksUnordered++;
      x.maxLevels = Math.max(x.maxLevels, d.a.length + d.b.length);
      if (x.lastAt !== undefined) x.maxSilenceMs = Math.max(x.maxSilenceMs, now - x.lastAt);
      x.firstAt ??= now - t0;
      x.lastAt = now;
      x.engineLagMs.push(Date.now() - Number(d.T) / 1000);
      x.deltas.push(d);
      return;
    }
    capture(`book-${stream.split('.')[0]}.jsonl`, text);
  });
  send(s, { method: 'SUBSCRIBE', params: syms.map((x) => `depth.${x}`) });
  send(s, { method: 'SUBSCRIBE', params: ['depth.200ms.ETH_USDC_PERP', 'bookTicker.BTC_USDC_PERP', 'bookTicker.kSHIB_USDC_PERP', 'markPrice.BTC_USDC_PERP', 'markPrice.kSHIB_USDC_PERP', 'markPrice.AAPL.US_USDC_PERP', 'ticker.BTC_USDC_PERP'] });

  const err = open('errors');
  await err.ready;
  const errReplies = [];
  err.ws.on('message', (raw) => {
    const text = raw.toString();
    errReplies.push({ atMs: Math.round(performance.now() - err.t0), text });
    capture('errors.jsonl', text);
  });
  const errCases = [
    { method: 'SUBSCRIBE', params: ['depth.NOPE_USDC_PERP'] },
    { method: 'SUBSCRIBE', params: ['nope.BTC_USDC_PERP'] },
    { method: 'SUBSCRIBE', params: ['depth.TON_USDC_PERP'] },
    { method: 'FOO', params: ['depth.BTC_USDC_PERP'] },
    'not json',
    { method: 'SUBSCRIBE', params: ['bookTicker.BTC_USDC_PERP'] },
    { method: 'SUBSCRIBE', params: ['bookTicker.BTC_USDC_PERP'] },
    { id: 9, method: 'SUBSCRIBE', params: ['nope.BTC_USDC_PERP'] },
    { method: 'SUBSCRIBE', params: ['depth.5.BTC_USDC_PERP'] },
    { method: 'SUBSCRIBE', params: ['depth.100ms.BTC_USDC_PERP'] },
    { method: 'SUBSCRIBE', params: ['depth.1000ms.BTC_USDC_PERP'] },
    { method: 'UNSUBSCRIBE', params: ['bookTicker.BTC_USDC_PERP'] },
    { id: 7, method: 'SUBSCRIBE', params: ['trade.SOL_USDC_PERP'] },
  ];
  for (const c of errCases) {
    const before = errReplies.length;
    send(err, c);
    await sleep(1500);
    const got = errReplies.slice(before);
    const us = got.map((g) => { try { return JSON.parse(g.text).data?.u; } catch { return undefined; } }).filter((u) => u !== undefined);
    log('error_case', { sent: c, replies: got.length, streams: count(got.map((g) => { try { return JSON.parse(g.text).stream ?? '(control)'; } catch { return '(unparsed)'; } }), (x) => x), repeatedU: us.length - new Set(us).size, control: got.filter((g) => !g.text.includes('"stream"')).slice(0, 2).map((g) => ({ atMs: g.atMs, text: g.text.slice(0, 260) })) });
  }
  err.ws.close();

  // Snapshot after a few deltas have arrived, aligned by lastUpdateId.
  await sleep(2000);
  const snaps = {};
  for (const sym of ['BTC_USDC_PERP', 'kSHIB_USDC_PERP']) {
    const t = Date.now();
    snaps[sym] = await restDepth(sym, '1000');
    const x = st.get(sym);
    const L = Number(snaps[sym].lastUpdateId);
    const firstBuffered = x.deltas[0];
    const straddle = x.deltas.find((d) => d.U <= L + 1 && d.u >= L + 1);
    log('snapshot_align', { sym, restMs: Date.now() - t, lastUpdateId: L, bufferedDeltas: x.deltas.length, firstBufferedU: firstBuffered?.U, lastBufferedu: x.deltas.at(-1)?.u, straddlingDelta: straddle ? { U: straddle.U, u: straddle.u } : null });
    await sleep(1000);
  }

  const remaining = 70_000 - (performance.now() - t0);
  await sleep(Math.max(0, remaining));

  // Final compare: rebuild BTC from the first snapshot plus every delta up to the second snapshot's id.
  for (const sym of ['BTC_USDC_PERP', 'kSHIB_USDC_PERP']) {
    const snap2 = await restDepth(sym, '1000');
    const L1 = Number(snaps[sym].lastUpdateId);
    const L2 = Number(snap2.lastUpdateId);
    const bids = toSide(snaps[sym].bids);
    const asks = toSide(snaps[sym].asks);
    let lastApplied;
    for (const d of st.get(sym).deltas) {
      if (d.u <= L1) continue;
      if (d.U > L2) break;
      applyLevels(bids, d.b);
      applyLevels(asks, d.a);
      lastApplied = d.u;
    }
    const wsTop = { b: topOf(bids, true, 20), a: topOf(asks, false, 20) };
    const restTop = { b: topOf(toSide(snap2.bids), true, 20), a: topOf(toSide(snap2.asks), false, 20) };
    const same = (x, y) => x.filter((l, i) => y[i] && y[i][0] === l[0] && y[i][1] === l[1]).length;
    log('final_compare', { sym, L1, L2, lastApplied, exactAlign: lastApplied === L2, bidsEqual: same(wsTop.b, restTop.b), asksEqual: same(wsTop.a, restTop.a), wsBest: [wsTop.b[0], wsTop.a[0]], restBest: [restTop.b[0], restTop.a[0]] });
    await sleep(1000);
  }

  for (const [sym, x] of st) {
    const lag = x.engineLagMs.sort((a, b) => a - b);
    log('depth_stream', { sym, frames: x.frames, gaps: x.gaps.length, firstGaps: x.gaps.slice(0, 3), UeqU: x.eqUu, emptyDeltas: x.empty, bidsNotDescending: x.bidsUnordered, asksNotAscending: x.asksUnordered, maxLevelsInOneDelta: x.maxLevels, firstFrameAfterMs: Math.round(x.firstAt ?? -1), maxSilenceMs: Math.round(x.maxSilenceMs), engineToLocalMsMedian: Math.round(lag[Math.floor(lag.length / 2)] ?? NaN), engineToLocalMsP90: Math.round(lag[Math.floor(lag.length * 0.9)] ?? NaN) });
  }
  log('streams', streams);
  log('control_frames', { rows: other.slice(0, 5), total: other.length });
  log('pings', { label: 'book', atS: s.pings });
  s.ws.close();
  await sleep(500);
}

async function batch() {
  const res = await fetch(`${API}/api/v1/markets?marketType=PERP`);
  const perps = (await res.json()).filter((x) => x.orderBookState === 'Open').map((x) => x.symbol);
  const s = open('batch');
  await s.ready;
  log('open', { label: 'batch', ms: s.openMs, markets: perps.length });
  const per = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let gaps = 0;
  const perSecond = [];
  let secFrames = 0;
  const other = [];
  s.ws.on('message', (raw) => {
    frames++;
    secFrames++;
    bytes += raw.length;
    const a = process.hrtime.bigint();
    const msg = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - a;
    if (!msg.stream) {
      other.push(raw.toString().slice(0, 200));
      return;
    }
    const d = msg.data;
    const x = per.get(d.s) ?? { n: 0, lastU: undefined, lastAt: undefined, maxSilence: 0 };
    if (x.lastU !== undefined && d.U !== x.lastU + 1) gaps++;
    const now = performance.now();
    if (x.lastAt !== undefined) x.maxSilence = Math.max(x.maxSilence, now - x.lastAt);
    x.lastAt = now;
    x.lastU = d.u;
    x.n++;
    per.set(d.s, x);
  });
  const tick = setInterval(() => (perSecond.push(secFrames), (secFrames = 0)), 1000);
  const t0 = performance.now();
  send(s, { method: 'SUBSCRIBE', params: perps.map((x) => `depth.${x}`) });
  await sleep(45_000);
  clearInterval(tick);
  const secs = (performance.now() - t0) / 1000;
  const silent = perps.filter((p) => !per.has(p));
  const sorted = [...perSecond].sort((a, b) => a - b);
  const silences = [...per.entries()].map(([k, v]) => [k, Math.round(v.maxSilence / 1000)]).sort((a, b) => b[1] - a[1]);
  log('batch', { markets: perps.length, seconds: Math.round(secs), frames, framesPerSecond: Math.round(frames / secs), medianPerSecond: sorted[Math.floor(sorted.length / 2)], peakPerSecond: sorted.at(-1), bytesPerSecond: Math.round(bytes / secs), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000, gaps, streamsWithFrames: per.size, silentStreams: silent, longestSilencesS: silences.slice(0, 6), control: other.slice(0, 3) });
  s.ws.close();
  await sleep(500);
}

async function silence() {
  const cases = [
    { label: 'nosub_autopong', sub: null, autoPong: true },
    { label: 'nosub_nopong', sub: null, autoPong: false },
    { label: 'quiet_nopong', sub: 'depth.AAPL.US_USDC_PERP', autoPong: false },
    { label: 'busy_autopong', sub: 'bookTicker.BTC_USDC_PERP', autoPong: true },
    { label: 'nosub_clientping', sub: null, autoPong: true, clientPingMs: 15_000 },
  ];
  const socks = cases.map((c) => ({ c, s: open(c.label, { autoPong: c.autoPong }), frames: 0, lastFrameS: undefined, pongMs: [] }));
  await Promise.all(socks.map((x) => x.s.ready));
  const timers = [];
  for (const x of socks) {
    if (x.c.clientPingMs) {
      let sentAt;
      x.s.ws.on('pong', () => x.pongMs.push(Math.round(performance.now() - sentAt)));
      timers.push(setInterval(() => ((sentAt = performance.now()), x.s.ws.ping()), x.c.clientPingMs));
    }
    x.s.ws.on('message', () => {
      x.frames++;
      x.lastFrameS = Math.round((performance.now() - x.s.t0) / 1000);
    });
    if (x.c.sub) send(x.s, { method: 'SUBSCRIBE', params: [x.c.sub] });
  }
  const t0 = performance.now();
  while (performance.now() - t0 < 120_000 && socks.some((x) => !x.s.closed)) await sleep(1000);
  timers.forEach(clearInterval);
  for (const x of socks) {
    log('silence', { label: x.c.label, openMs: x.s.openMs, pingsAtS: x.s.pings, clientPongMs: x.c.clientPingMs ? x.pongMs : undefined, frames: x.frames, lastFrameS: x.lastFrameS, closed: x.s.closed ?? 'open at 120 s' });
    if (!x.s.closed) x.s.ws.terminate();
  }
}

async function deflate() {
  const s = open('deflate', { perMessageDeflate: true });
  await s.ready;
  log('deflate', { openMs: s.openMs, negotiated: s.ext });
  let frames = 0;
  s.ws.on('message', () => frames++);
  send(s, { method: 'SUBSCRIBE', params: ['depth.BTC_USDC_PERP'] });
  await sleep(3000);
  log('deflate_frames', { frames });
  s.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate };
if (!modes[mode]) {
  console.error('mode: book | batch | silence | deflate');
  process.exit(1);
}
await modes[mode]();
process.exit(0);
