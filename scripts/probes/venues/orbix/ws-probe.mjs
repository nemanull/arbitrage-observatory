// Orbix spot WebSocket probe: the diff and partial depth streams, their id chain against the REST snapshot, level order, idle repeats, stream variants, the SUBSCRIBE frame, a batch of every trading pair on one connection, silence and deflate.
// Orbix lists no perpetuals, so this is the spot book of the THB pairs.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/orbix/ws-probe.mjs [book|variants|batch|silence|deflate]
//   book      diff depth on four pairs through SUBSCRIBE with a REST snapshot, a local book checked against each pair's depth20 socket, 60 s.
//   variants  depth5 to depth100 at 100 ms and 1000 ms, unknown, upper case, halted, one sided and empty books, SUBSCRIBE, LIST_SUBSCRIPTIONS, bad frames, bare, broker and documented combined paths, about 35 s.
//   batch     the largest SUBSCRIBE frame the server accepts, then every TRADING pair's diff depth on one connection for 60 s.
//   silence   three sockets that differ in what the client sends, for up to 120 s.
//   deflate   asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep a few raw frames. Recorded in docs/profiles/orbix/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS = 'wss://www.orbixtrade.com/ws';
const API = 'https://www.orbixtrade.com/api';
const OUT = process.env.PROBE_OUT_DIR;
const PAIRS = ['btc_thb', 'usdt_thb', 'eth_thb', 'xlm_thb'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text, max = 20) {
  if (!OUT) return;
  capture.n ??= {};
  capture.n[name] = (capture.n[name] ?? 0) + 1;
  if (capture.n[name] > max) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  const s = { url, ws, t0, openMs: null, frames: 0, bytes: 0, pings: [], close: null, error: null, http: null, ext: null };
  ws.on('open', () => {
    s.openMs = Date.now() - t0;
    s.ext = ws.extensions || null;
  });
  ws.on('upgrade', (res) => {
    s.ext = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('unexpected-response', (_req, res) => {
    s.http = { status: res.statusCode, location: res.headers.location ?? null };
    ws.terminate();
  });
  ws.on('error', (e) => (s.error = e.message));
  ws.on('ping', () => s.pings.push(Date.now() - t0));
  ws.on('close', (code, reason) => (s.close = { code, reason: String(reason), atMs: Date.now() - t0 }));
  ws.on('message', (d) => {
    s.frames++;
    s.bytes += d.length;
  });
  return s;
}

const whenOpen = (s, ms = 10_000) =>
  new Promise((resolve) => {
    if (s.ws.readyState === WebSocket.OPEN) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    s.ws.once('open', () => (clearTimeout(t), resolve(true)));
    s.ws.once('close', () => (clearTimeout(t), resolve(false)));
  });

async function restDepth(pair, limit = 1000) {
  const res = await fetch(`${API}/v3/depth?symbol=${pair}&limit=${limit}`);
  return res.json();
}

const desc = (a) => a.every((l, i) => i === 0 || Number(l[0]) < Number(a[i - 1][0]));
const asc = (a) => a.every((l, i) => i === 0 || Number(l[0]) > Number(a[i - 1][0]));

// Diff frames arrive through SUBSCRIBE on /ws/stream, since the streams query parameter delivered nothing, and they are not wrapped.
// Partial frames carry no symbol, so each pair's depth20 stream gets its own raw socket.
// The local book follows the Binance recipe: buffer, fetch a REST snapshot, drop frames with u <= lastUpdateId, then apply.
async function book() {
  const diff = open(`${WS}/stream`);
  const parts = PAIRS.map((p) => Object.assign(open(`${WS}/${p}@depth20@100ms`), { pair: p }));
  const per = Object.fromEntries(PAIRS.map((p) => [p, {
    frames: 0, emptyFrames: 0, rel: {}, uMinusU: [], lastU: null, buffer: [], bidsUnordered: 0, asksUnordered: 0, maxLevelsPerFrame: 0,
    live: false, bids: new Map(), asks: new Map(), straddle: null, snapshotId: null, snapshotLevels: null,
    cmp: { idEqual: 0, top20Equal: 0, top20Differ: 0, idNotEqual: 0 }, differSample: null,
  }]));
  const acks = [];
  const allIds = [];
  const apply = (p, e) => {
    for (const [pr, q] of e.b) Number(q) === 0 ? p.bids.delete(pr) : p.bids.set(pr, q);
    for (const [pr, q] of e.a) Number(q) === 0 ? p.asks.delete(pr) : p.asks.set(pr, q);
    p.appliedU = e.u;
  };
  diff.ws.on('message', (d) => {
    const m = JSON.parse(d);
    capture('book-diff.jsonl', String(d), 12);
    if (m.e !== 'depthUpdate') {
      acks.push(String(d).slice(0, 200));
      return;
    }
    const p = per[m.s];
    if (!p) return;
    p.frames++;
    if (m.b.length === 0 && m.a.length === 0) p.emptyFrames++;
    if (!desc(m.b)) p.bidsUnordered++;
    if (!asc(m.a)) p.asksUnordered++;
    p.maxLevelsPerFrame = Math.max(p.maxLevelsPerFrame, m.b.length + m.a.length);
    p.uMinusU.push(m.u - m.U);
    p.lagMs ??= [];
    p.lagMs.push(Date.now() - m.E);
    if (p.lastU !== null) {
      const k = m.U === p.lastU ? 'U=prev_u' : m.U === p.lastU + 1 ? 'U=prev_u+1' : m.U > p.lastU + 1 ? 'U>prev_u+1' : 'U<prev_u';
      p.rel[k] = (p.rel[k] ?? 0) + 1;
    }
    p.lastU = m.u;
    allIds.push({ s: m.s, U: m.U, u: m.u });
    if (p.live) {
      p.firstLive ??= { U: m.U, u: m.u, snapshotId: p.snapshotId, UleSnapshot: m.U <= p.snapshotId, uGtSnapshot: m.u > p.snapshotId, UeqSnapshot: m.U === p.snapshotId };
      apply(p, m);
    } else p.buffer.push(m);
  });
  const partStats = Object.fromEntries(PAIRS.map((p) => [p, { frames: 0, repeats: 0, lastId: null, levels: new Set(), bidsDesc: 0, asksAsc: 0, keys: null }]));
  const top = (map, dir) => [...map].sort((x, y) => dir * (Number(x[0]) - Number(y[0]))).slice(0, 20);
  const eq = (x, y) => x.length === y.length && x.every((l, i) => Number(l[0]) === Number(y[i][0]) && Number(l[1]) === Number(y[i][1]));
  for (const s of parts) {
    s.ws.on('message', (d) => {
      const x = JSON.parse(d);
      capture('book-partial.jsonl', String(d), 4);
      const st = partStats[s.pair];
      st.frames++;
      if (x.lastUpdateId === st.lastId) st.repeats++;
      st.lastId = x.lastUpdateId;
      st.levels.add(`${x.bids.length}/${x.asks.length}`);
      if (desc(x.bids)) st.bidsDesc++;
      if (asc(x.asks)) st.asksAsc++;
      st.keys ??= Object.keys(x);
      const p = per[s.pair];
      if (!p.live) return;
      if (x.lastUpdateId !== p.appliedU) {
        p.cmp.idNotEqual++;
        return;
      }
      p.cmp.idEqual++;
      const lb = top(p.bids, -1);
      const la = top(p.asks, 1);
      if (eq(lb, x.bids.slice(0, 20)) && eq(la, x.asks.slice(0, 20))) p.cmp.top20Equal++;
      else {
        p.cmp.top20Differ++;
        p.differSample ??= { id: x.lastUpdateId, localBid: lb[0], wireBid: x.bids[0], localAsk: la[0], wireAsk: x.asks[0], localLevels: `${lb.length}/${la.length}`, wireLevels: `${x.bids.length}/${x.asks.length}` };
      }
    });
  }
  await Promise.all([whenOpen(diff), ...parts.map((s) => whenOpen(s))]);
  diff.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: PAIRS.map((p) => `${p}@depth@100ms`), id: 1 }));
  log('opened', { diff: diff.openMs, partial: parts.map((s) => s.openMs) });

  await sleep(1500);
  for (const pair of PAIRS) {
    const snap = await restDepth(pair);
    const p = per[pair];
    p.snapshotId = snap.lastUpdateId;
    p.snapshotLevels = `${snap.bids.length}/${snap.asks.length}`;
    p.bids = new Map(snap.bids.map(([pr, q]) => [pr, q]));
    p.asks = new Map(snap.asks.map(([pr, q]) => [pr, q]));
    p.appliedU = snap.lastUpdateId;
    const after = p.buffer.filter((e) => e.u > snap.lastUpdateId);
    const first = after[0];
    p.straddle = first ? { U: first.U, u: first.u, UleId1: first.U <= snap.lastUpdateId + 1, uGeId1: first.u >= snap.lastUpdateId + 1, bufferedBefore: p.buffer.length } : { bufferedBefore: p.buffer.length, note: 'no buffered frame after the snapshot, the next live frame applies' };
    for (const e of after) apply(p, e);
    p.live = true;
    await sleep(300);
  }
  await sleep(58_000);

  for (const pair of PAIRS) {
    const p = per[pair];
    const sizes = [...p.uMinusU].sort((x, y) => x - y);
    const lb = top(p.bids, -1);
    const la = top(p.asks, 1);
    log('diff', {
      pair, frames: p.frames, emptyFrames: p.emptyFrames, relation: p.rel,
      uMinusU: { min: sizes[0], median: sizes[Math.floor(sizes.length / 2)], max: sizes.at(-1) },
      arrivalMinusEventMs: (() => {
        const l = [...(p.lagMs ?? [])].sort((x, y) => x - y);
        return l.length ? { min: l[0], median: l[Math.floor(l.length / 2)], max: l.at(-1) } : null;
      })(),
      bidsUnordered: p.bidsUnordered, asksUnordered: p.asksUnordered, maxLevelsPerFrame: p.maxLevelsPerFrame,
      snapshotId: p.snapshotId, snapshotLevels: p.snapshotLevels, straddle: p.straddle, firstLive: p.firstLive,
      compareWithDepth20: p.cmp, differSample: p.differSample,
      localBook: { levels: `${p.bids.size}/${p.asks.size}`, bestBid: lb[0], bestAsk: la[0], crossed: lb.length > 0 && la.length > 0 && Number(lb[0][0]) >= Number(la[0][0]) },
    });
  }
  // A counter shared by all pairs shows as id ranges of different pairs overlapping in time.
  const sorted = [...allIds].sort((x, y) => x.U - y.U);
  let interleaved = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].s !== sorted[i - 1].s && sorted[i].U < sorted[i - 1].u) interleaved++;
  const ranges = Object.fromEntries(PAIRS.map((p) => {
    const x = allIds.filter((i) => i.s === p);
    return [p, x.length ? [x[0].U, x.at(-1).u] : null];
  }));
  log('ids', { acks, idRanges: ranges, overlapsAcrossPairs: interleaved, framesTotal: allIds.length });
  for (const pair of PAIRS) {
    const st = partStats[pair];
    log('partial', { pair, frames: st.frames, repeatsOfSameId: st.repeats, levelShapes: [...st.levels].slice(0, 8), bidsDescFrames: st.bidsDesc, asksAscFrames: st.asksAsc, keys: st.keys });
  }
  log('sockets', { diff: { frames: diff.frames, bytes: diff.bytes, pings: diff.pings, close: diff.close }, partial: parts.map((s) => ({ pair: s.pair, frames: s.frames, bytes: s.bytes, pings: s.pings, close: s.close })) });
  for (const s of [diff, ...parts]) s.ws.terminate();
}

async function variants() {
  const streams = [
    'btc_thb@depth5@100ms', 'btc_thb@depth10@100ms', 'btc_thb@depth20@100ms', 'btc_thb@depth50@100ms', 'btc_thb@depth100@100ms',
    'btc_thb@depth20@1000ms', 'btc_thb@depth20', 'btc_thb@depth@1000ms', 'btc_thb@depth', 'btc_thb@depth@0ms', 'btc_thb@bookTicker',
    'nope_thb@depth20@100ms', 'BTC_THB@depth20@100ms', 'ltc_thb@depth20@100ms', 'ltc_thb@depth@100ms',
    'pyth_thb@depth20@100ms', 'rsr_thb@depth20@100ms', 'yfi_thb@depth20@100ms',
  ];
  const socks = streams.map((st) => {
    const s = open(`${WS}/${st}`);
    s.stream = st;
    s.shapes = new Set();
    s.first = null;
    s.ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (!s.first) s.first = String(d).slice(0, 200);
      if (m.bids) s.shapes.add(`${m.bids.length}/${m.asks.length}`);
      if (m.b) s.shapes.add(`diff ${m.b.length}/${m.a.length}`);
    });
    return s;
  });
  await sleep(12_000);
  for (const s of socks) {
    log('variant', { stream: s.stream, openMs: s.openMs, http: s.http, error: s.error, close: s.close, framesIn12s: s.frames, shapes: [...s.shapes].slice(0, 6), first: s.first });
    s.ws.terminate();
  }

  // Control frames on a combined socket, the way the web app sends SUBSCRIBE for aggTrade.
  const c = open(`${WS}/stream?streams=usdt_thb@aggTrade`);
  const replies = [];
  const data = {};
  let phase = 'before_subscribe';
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    const kind = m.stream ? `wrapped:${m.stream}` : m.lastUpdateId !== undefined ? 'partial' : m.e ? `${m.e}:${m.s}` : null;
    if (kind) {
      data[phase] ??= {};
      data[phase][kind] = (data[phase][kind] ?? 0) + 1;
    } else replies.push({ phase, atMs: Date.now() - c.t0, frame: String(d).slice(0, 300) });
  });
  await whenOpen(c);
  await sleep(3000);
  const send = (x) => c.ws.send(typeof x === 'string' ? x : JSON.stringify(x));
  phase = 'after_subscribe';
  send({ method: 'SUBSCRIBE', params: ['btc_thb@depth20@100ms', 'eth_thb@depth@100ms'], id: 1 });
  await sleep(1500);
  send({ method: 'LIST_SUBSCRIPTIONS', id: 2 });
  await sleep(1000);
  send({ method: 'SUBSCRIBE', params: ['nope_thb@depth20@100ms'], id: 3 });
  await sleep(1000);
  send({ method: 'SUBSCRIBE', params: ['eth_thb@depth@100ms'], id: 4 });
  await sleep(1000);
  send({ method: 'UNSUBSCRIBE', params: ['btc_thb@depth20@100ms'], id: 5 });
  phase = 'after_unsubscribe';
  await sleep(2000);
  send({ method: 'NOPE', id: 6 });
  await sleep(1500);
  log('control', { openMs: c.openMs, replies, dataFramesByPhase: data, close: c.close });
  c.ws.terminate();

  // Text that is not JSON, on a socket of its own, since the unknown method above already closes the control socket.
  const bad = open(`${WS}/btc_thb@depth20@100ms`);
  const badReplies = [];
  bad.ws.on('message', (d) => !String(d).startsWith('{"lastUpdateId"') && badReplies.push(String(d).slice(0, 200)));
  await whenOpen(bad);
  await sleep(500);
  const sentAt = Date.now() - bad.t0;
  bad.ws.send('not json');
  await sleep(2500);
  log('notJson', { sentAtMs: sentAt, replies: badReplies, close: bad.close, framesTotal: bad.frames });
  bad.ws.terminate();

  // A raw socket with no stream in the path, and the combined path with no streams parameter.
  for (const url of [`${WS}/`, `${WS}/stream`, `${WS}/stream?streams=`, `${WS}/broker/btc_usdt@depth20@1000ms`, 'wss://www.orbixtrade.com/stream?streams=btc_thb@depth20@100ms']) {
    const s = open(url);
    const replies2 = [];
    s.ws.on('message', (d) => replies2.push(String(d).slice(0, 200)));
    const ok = await whenOpen(s, 5000);
    if (ok) {
      s.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['btc_thb@depth20@100ms'], id: 1 }));
      await sleep(2000);
    }
    log('barePath', { url, opened: ok, openMs: s.openMs, http: s.http, error: s.error, close: s.close, frames: s.frames, first: replies2.slice(0, 2) });
    s.ws.terminate();
  }
}

async function batch() {
  const info = await (await fetch(`${API}/v3/exchangeInfo`)).json();
  const pairs = info.symbols.filter((s) => s.status === 'TRADING').map((s) => s.symbol);
  // One SUBSCRIBE frame for all 104 pairs, 2,388 bytes, closed the socket with 1009, so the largest accepted frame is measured first.
  const frameOf = (list, id) => JSON.stringify({ method: 'SUBSCRIBE', params: list.map((p) => `${p}@depth@100ms`), id });
  const sizes = [];
  let chunkSize = 1;
  for (const n of [4, 16, 32, 64, 80, 88, 96, 104]) {
    const t = open(`${WS}/stream`);
    const got = [];
    t.ws.on('message', (d) => String(d).includes('"method"') && got.push(String(d).trim()));
    await whenOpen(t);
    t.ws.send(frameOf(pairs.slice(0, n), 1));
    await sleep(800);
    const ok = got.length > 0 && t.close === null;
    sizes.push({ params: n, bytes: frameOf(pairs.slice(0, n), 1).length, acked: got.length > 0, close: t.close?.code ?? null });
    t.ws.terminate();
    if (!ok) break;
    chunkSize = n;
    await sleep(300);
  }
  log('frameLimit', { sizes, chunkSize });

  const url = `${WS}/stream`;
  const s = open(url);
  const acks = [];
  const per = new Map();
  const perSecond = [];
  let secFrames = 0;
  let parseUs = 0;
  let gapsPrevU = 0;
  let gapsPrevU1 = 0;
  s.ws.on('message', (d) => {
    const t = process.hrtime.bigint();
    const m = JSON.parse(d);
    parseUs += Number(process.hrtime.bigint() - t) / 1000;
    secFrames++;
    const e = m;
    if (e.e !== 'depthUpdate') {
      acks.push(String(d).slice(0, 200));
      return;
    }
    const p = per.get(e.s) ?? { frames: 0, lastU: null, eqPrev: 0, eqPrev1: 0, other: 0 };
    p.frames++;
    if (p.lastU !== null) {
      if (e.U === p.lastU) p.eqPrev++;
      else if (e.U === p.lastU + 1) p.eqPrev1++;
      else p.other++;
    }
    p.lastU = e.u;
    per.set(e.s, p);
  });
  const ok = await whenOpen(s);
  for (let i = 0; i < pairs.length; i += chunkSize) {
    s.ws.send(frameOf(pairs.slice(i, i + chunkSize), 1 + i / chunkSize));
    await sleep(200);
  }
  const tick = setInterval(() => {
    perSecond.push(secFrames);
    secFrames = 0;
  }, 1000);
  await sleep(60_000);
  clearInterval(tick);
  s.ws.terminate();
  for (const p of per.values()) {
    gapsPrevU += p.other;
    gapsPrevU1 += p.eqPrev1;
  }
  const sorted = [...perSecond].sort((a, b) => a - b);
  const top = [...per].sort((a, b) => b[1].frames - a[1].frames).slice(0, 5).map(([k, v]) => [k, v.frames]);
  log('batch', {
    pairs: pairs.length, chunkSize, subscribeFrames: Math.ceil(pairs.length / chunkSize), acks: acks.length, ackSample: acks[0], opened: ok, openMs: s.openMs, http: s.http, error: s.error, close: s.close,
    frames: s.frames, bytes: s.bytes, pairsWithFrames: per.size, silentPairs: pairs.length - per.size,
    framesPerSecond: { median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1), min: sorted[0] },
    bytesPerFrame: Math.round(s.bytes / Math.max(1, s.frames)), parseUsPerFrame: +(parseUs / Math.max(1, s.frames)).toFixed(1),
    relationTotals: { 'U=prev_u': [...per.values()].reduce((a, p) => a + p.eqPrev, 0), 'U=prev_u+1': gapsPrevU1, other: gapsPrevU },
    busiest: top, pings: s.pings,
  });
}

async function silence() {
  // A quiet pair keeps the socket without book traffic, so the server's own behaviour shows.
  // The third socket asks for depth20 at 1000 ms, which the server accepts and never serves.
  const quiet = 'algo_thb@depth@100ms';
  const a = open(`${WS}/${quiet}`);
  const b = open(`${WS}/${quiet}`);
  const c = open(`${WS}/btc_thb@depth20@1000ms`);
  const frameTimes = { a: [], b: [], c: [] };
  a.ws.on('message', () => frameTimes.a.push(Date.now() - a.t0));
  b.ws.on('message', () => frameTimes.b.push(Date.now() - b.t0));
  c.ws.on('message', () => frameTimes.c.push(Date.now() - c.t0));
  await Promise.all([whenOpen(a), whenOpen(b), whenOpen(c)]);
  const pongs = [];
  b.ws.on('pong', () => pongs.push(Date.now() - b.t0));
  const pinger = setInterval(() => b.ws.readyState === WebSocket.OPEN && b.ws.ping(), 20_000);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && [a, b, c].some((s) => s.close === null)) await sleep(1000);
  clearInterval(pinger);
  const gap = (t) => t.reduce((m, x, i) => Math.max(m, i === 0 ? x : x - t[i - 1]), 0);
  log('silence', {
    quietNoClientFrames: { stream: quiet, frames: a.frames, maxGapMs: gap(frameTimes.a), serverPings: a.pings, close: a.close },
    quietClientPing20s: { stream: quiet, frames: b.frames, serverPings: b.pings, pongs, close: b.close },
    silentStream1000ms: { stream: 'btc_thb@depth20@1000ms', frames: c.frames, maxGapMs: gap(frameTimes.c), serverPings: c.pings, close: c.close },
  });
  for (const s of [a, b, c]) s.ws.terminate();
}

async function deflate() {
  const s = open(`${WS}/btc_thb@depth20@100ms`, { deflate: true });
  await whenOpen(s);
  await sleep(2000);
  log('deflate', { openMs: s.openMs, negotiated: s.ext, frames: s.frames, http: s.http, error: s.error });
  s.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, variants, batch, silence, deflate };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
