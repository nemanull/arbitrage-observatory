// Coins.ph WebSocket probe: book channels, the diff sequence against a REST snapshot, level order, size unit, URL shapes, keepalive, silence, errors, and every trading symbol on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate question.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coinsph/ws-probe.mjs [book|errors|batch|silence|deflate]
//   book     diff depth@100ms, partial depth20@100ms, depth200, bookTicker on five symbols for 60 s, with a REST snapshot per symbol, a local book rebuilt by the documented recipe and compared with depth20 at equal update ids, and the combined and raw URL shapes. About 75 s.
//   errors   unknown, closed, malformed and duplicate subscriptions, bad JSON, unknown method, LIST_SUBSCRIPTIONS. About 20 s.
//   batch    every trading symbol on depth@100ms on one socket and on depth20@100ms on a second socket for 45 s.
//   silence  four sockets that differ only in what the client sends or subscribes, for 100 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/coinsph/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_BASE = 'wss://wsapi.pro.coins.ph';
const STREAM_URL = `${WS_BASE}/openapi/quote/stream`;
const API = 'https://api.pro.coins.ph';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (a, p) => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

let lastRest = 0;
async function rest(path) {
  const wait = lastRest + 1_000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastRest = Date.now();
  const res = await fetch(`${API}${path}`);
  return { status: res.status, json: await res.json() };
}

// Opens a socket and records its lifecycle, protocol pings from the server and pongs to application pings.
function open(name, url, { deflate = false, autoPong = true } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate, autoPong });
  const s = { name, ws, t0, openMs: null, serverPings: [], pongMs: [], closed: null, frames: 0, bytes: 0, controls: [] };
  ws.on('upgrade', (res) => {
    s.extensions = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('open', () => {
    s.openMs = Date.now() - t0;
  });
  ws.on('ping', (d) => s.serverPings.push({ atS: +((Date.now() - t0) / 1000).toFixed(1), payload: d.toString() }));
  ws.on('close', (code, reason) => {
    s.closed = { code, reason: reason.toString(), afterS: +((Date.now() - t0) / 1000).toFixed(2) };
  });
  ws.on('error', (e) => {
    s.error = e.message;
  });
  s.ready = new Promise((resolve) => {
    ws.once('open', resolve);
    ws.once('close', resolve);
  });
  return s;
}

function send(s, obj) {
  if (s.ws.readyState === WebSocket.OPEN) s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function appPing(s) {
  const sent = Date.now();
  s.pendingPing = sent;
  send(s, { ping: sent });
}

function summary(s) {
  return { name: s.name, openMs: s.openMs, extensions: s.extensions, frames: s.frames, bytes: s.bytes, serverPings: s.serverPings, pongMs: s.pongMs, closed: s.closed, error: s.error };
}

function isDesc(levels) {
  for (let i = 1; i < levels.length; i++) if (!(Number(levels[i - 1][0]) > Number(levels[i][0]))) return false;
  return true;
}
function isAsc(levels) {
  for (let i = 1; i < levels.length; i++) if (!(Number(levels[i - 1][0]) < Number(levels[i][0]))) return false;
  return true;
}

// Parses a frame, answers control frames, and hands data frames to onData.
function wire(s, onData) {
  s.ws.on('message', (raw) => {
    const text = raw.toString();
    s.frames++;
    s.bytes += text.length;
    const at = Date.now();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      s.controls.push({ at: at - s.t0, nonJson: text.slice(0, 200) });
      return;
    }
    if (j.pong !== undefined) {
      if (s.pendingPing !== undefined) s.pongMs.push(at - s.pendingPing);
      if (s.controls.filter((c) => c.pong).length < 1) s.controls.push({ at: at - s.t0, pong: text });
      return;
    }
    if (j.id !== undefined || j.code !== undefined || j.result !== undefined) {
      s.controls.push({ at: at - s.t0, frame: text.slice(0, 400) });
      return;
    }
    onData(j, at, text);
  });
}

async function book() {
  const t24 = await rest('/openapi/quote/v1/ticker/24hr');
  const ei = await rest('/openapi/v1/exchangeInfo');
  const trading = new Set(ei.json.symbols.filter((x) => x.status === 'trading').map((x) => x.symbol));
  const byCount = t24.json.filter((x) => trading.has(x.symbol) && Number(x.bidPrice) > 0 && Number(x.askPrice) > 0).sort((a, b) => a.count - b.count);
  const quiet = byCount[0].symbol;
  const symbols = ['BTCPHP', 'USDTPHP', 'ETHPHP', 'BTCUSDT', quiet];
  log('book_symbols', { symbols, quiet, quietTrades24h: byCount[0].count });

  const diff = open('diff', STREAM_URL);
  const part = open('depth20', STREAM_URL);
  const d200 = open('depth200', STREAM_URL);
  const bt = open('bookTicker', STREAM_URL);
  await Promise.all([diff.ready, part.ready, d200.ready, bt.ready]);
  log('open', { diff: diff.openMs, depth20: part.openMs, depth200: d200.openMs, bookTicker: bt.openMs });

  const D = {};
  const P = {};
  const B = {};
  const L = {}; // local books rebuilt from a REST snapshot and the diff stream
  for (const sym of symbols) {
    D[sym] = { frames: 0, gaps: 0, lastU: null, firstU: null, lags: [], bidsUnordered: 0, asksUnordered: 0, zeroQty: 0, levels: 0, maxLevels: 0, emptyFrames: 0, intervals: [], lastAt: null };
    P[sym] = { frames: 0, firstAgeMs: null, firstAfterSubMs: null, intervals: [], lastAt: null, repeats: 0, lastId: null, idBackwards: 0, levelCounts: new Set(), bidsDesc: 0, asksAsc: 0, lags: [], last: null, maxGapMs: 0, tops: new Map() };
    B[sym] = { frames: 0, repeats: 0, last: null, lastU: null, uBackwards: 0 };
    L[sym] = { buffer: [], snap: null, bids: new Map(), asks: new Map(), applied: 0, started: false, firstStraddles: null, firstU: null, chainBreaks: 0, prevU: null, tops: new Map() };
  }
  const P200 = { frames: 0, intervals: [], lastAt: null, levelCounts: new Set(), firstAgeMs: null };
  let subAt = 0;
  const top20 = (bids, asks) => {
    const b = [...bids.entries()].sort((x, y) => y[0] - x[0]).slice(0, 20);
    const a = [...asks.entries()].sort((x, y) => x[0] - y[0]).slice(0, 20);
    return JSON.stringify([b, a]);
  };
  const levelsKey = (bids, asks) => JSON.stringify([bids.map(([p, q]) => [Number(p), Number(q)]), asks.map(([p, q]) => [Number(p), Number(q)])]);

  const applyDiff = (sym, e) => {
    const bk = L[sym];
    if (e.u <= bk.snap) return;
    if (!bk.started) {
      bk.started = true;
      bk.firstStraddles = e.U <= bk.snap + 1 && e.u >= bk.snap + 1;
      bk.firstU = e.U;
    } else if (e.U !== bk.prevU + 1) bk.chainBreaks++;
    bk.prevU = e.u;
    bk.applied++;
    for (const [p, q] of e.b) (Number(q) === 0 ? bk.bids.delete(Number(p)) : bk.bids.set(Number(p), Number(q)));
    for (const [p, q] of e.a) (Number(q) === 0 ? bk.asks.delete(Number(p)) : bk.asks.set(Number(p), Number(q)));
    bk.tops.set(e.u, top20(bk.bids, bk.asks));
  };

  wire(diff, (j, at, text) => {
    if (j.e !== 'depthUpdate') return;
    const d = D[j.s];
    if (!d) return;
    if (d.frames < 3) capture('diff.jsonl', text);
    d.frames++;
    d.lags.push(at - j.E);
    if (d.lastAt !== null) d.intervals.push(at - d.lastAt);
    d.lastAt = at;
    if (d.firstU === null) d.firstU = j.U;
    if (d.lastU !== null && j.U !== d.lastU + 1) d.gaps++;
    d.lastU = j.u;
    if (!isDesc(j.b)) d.bidsUnordered++;
    if (!isAsc(j.a)) d.asksUnordered++;
    const n = j.b.length + j.a.length;
    if (n === 0) d.emptyFrames++;
    d.levels += n;
    d.maxLevels = Math.max(d.maxLevels, n);
    for (const l of [...j.b, ...j.a]) if (Number(l[1]) === 0) d.zeroQty++;
    if (L[j.s].snap === null) L[j.s].buffer.push(j);
    else applyDiff(j.s, j);
  });
  wire(part, (j, at, text) => {
    if (j.e !== 'depth') return;
    const p = P[j.s];
    if (!p) return;
    if (p.frames < 2) capture('depth20.jsonl', text);
    if (p.frames === 0) {
      p.firstAgeMs = at - j.E;
      p.firstAfterSubMs = at - subAt;
    } else {
      p.lags.push(at - j.E);
    }
    p.frames++;
    if (p.lastAt !== null) {
      p.intervals.push(at - p.lastAt);
      p.maxGapMs = Math.max(p.maxGapMs, at - p.lastAt);
    }
    p.lastAt = at;
    if (p.lastId !== null && j.lastUpdateId === p.lastId) p.repeats++;
    if (p.lastId !== null && j.lastUpdateId < p.lastId) p.idBackwards++;
    p.lastId = j.lastUpdateId;
    p.levelCounts.add(`${j.bids.length}/${j.asks.length}`);
    if (isDesc(j.bids)) p.bidsDesc++;
    if (isAsc(j.asks)) p.asksAsc++;
    p.last = j;
    p.tops.set(j.lastUpdateId, levelsKey(j.bids, j.asks));
  });
  wire(d200, (j, at, text) => {
    if (j.e !== 'depth') return;
    if (P200.frames === 0) {
      P200.firstAgeMs = at - j.E;
      capture('depth200.jsonl', text.slice(0, 2000));
    }
    P200.frames++;
    if (P200.lastAt !== null) P200.intervals.push(at - P200.lastAt);
    P200.lastAt = at;
    P200.levelCounts.add(`${j.bids.length}/${j.asks.length}`);
  });
  wire(bt, (j, at, text) => {
    if (j.u === undefined || !B[j.s]) return;
    const b = B[j.s];
    if (b.frames < 2) capture('bookTicker.jsonl', text);
    b.frames++;
    const key = `${j.b}|${j.B}|${j.a}|${j.A}`;
    if (b.last === key) b.repeats++;
    b.last = key;
    if (b.lastU !== null && j.u < b.lastU) b.uBackwards++;
    b.lastU = j.u;
  });

  subAt = Date.now();
  send(diff, { method: 'SUBSCRIBE', params: symbols.map((x) => `${x.toLowerCase()}@depth@100ms`), id: 1 });
  send(part, { method: 'SUBSCRIBE', params: symbols.map((x) => `${x.toLowerCase()}@depth20@100ms`), id: 2 });
  send(d200, { method: 'SUBSCRIBE', params: ['btcphp@depth200'], id: 3 });
  send(bt, { method: 'SUBSCRIBE', params: symbols.map((x) => `${x.toLowerCase()}@bookTicker`), id: 4 });
  const pinger = setInterval(() => [diff, part, d200, bt].forEach(appPing), 20_000);

  // The documented recipe: buffer the diff stream, fetch a REST snapshot, drop u <= lastUpdateId, the first applied event straddles lastUpdateId + 1.
  await sleep(2_000);
  for (const sym of symbols) {
    const snap = await rest(`/openapi/quote/v1/depth?symbol=${sym}&limit=200`);
    const bk = L[sym];
    const lid = snap.json.lastUpdateId;
    for (const [p, q] of snap.json.bids) bk.bids.set(Number(p), Number(q));
    for (const [p, q] of snap.json.asks) bk.asks.set(Number(p), Number(q));
    bk.snap = lid;
    bk.tops.set(lid, top20(bk.bids, bk.asks));
    const buf = bk.buffer.splice(0);
    log('recipe_snapshot', { sym, lastUpdateId: lid, buffered: buf.length, bufferedRange: buf.length ? [buf[0].U, buf[buf.length - 1].u] : null, droppedAsOld: buf.filter((e) => e.u <= lid).length });
    for (const e of buf) applyDiff(sym, e);
  }

  // Combined URL with streams in the query, and the raw single stream URL.
  const comb = open('combined', `${STREAM_URL}?streams=btcphp@depth20@100ms/btcphp@bookTicker`);
  const raw = open('raw', `${WS_BASE}/openapi/quote/ws/v3/btcphp@depth20@100ms`);
  const shapes = { combined: [], raw: [] };
  for (const [s, key] of [[comb, 'combined'], [raw, 'raw']]) {
    s.ws.on('message', (m) => {
      s.frames++;
      if (shapes[key].length < 3) shapes[key].push(m.toString().slice(0, 220));
    });
  }
  await sleep(6_000);
  log('url_shapes', { combined: { ...summary(comb), first: shapes.combined }, raw: { ...summary(raw), first: shapes.raw } });
  comb.ws.terminate();
  raw.ws.terminate();

  await sleep(45_000);
  clearInterval(pinger);

  // A depth20 frame and the rebuilt book at the same update id should hold the same twenty levels per side.
  for (const sym of symbols) {
    const bk = L[sym];
    let compared = 0;
    let equal = 0;
    let firstMismatch = null;
    for (const [id, key] of P[sym].tops) {
      const local = bk.tops.get(id);
      if (local === undefined) continue;
      compared++;
      if (local === key) equal++;
      else if (firstMismatch === null) firstMismatch = { id, local: local.slice(0, 160), stream: key.slice(0, 160) };
    }
    const r = await rest(`/openapi/quote/v1/depth?symbol=${sym}&limit=20`);
    const restKey = levelsKey(r.json.bids, r.json.asks);
    const localAtRest = bk.tops.get(r.json.lastUpdateId);
    log('rebuilt_vs_streams', {
      sym,
      snapshotId: bk.snap,
      firstDiffU: bk.firstU,
      firstStraddles: bk.firstStraddles,
      applied: bk.applied,
      chainBreaks: bk.chainBreaks,
      depth20FramesWithMatchingId: compared,
      depth20FramesEqual: equal,
      firstMismatch,
      restId: r.json.lastUpdateId,
      localLastU: bk.prevU,
      restEqualsLocalAtSameId: localAtRest === undefined ? 'no local state at that id' : localAtRest === restKey,
    });
  }

  for (const sym of symbols) {
    const d = D[sym];
    log('diff_stream', { sym, frames: d.frames, gaps: d.gaps, firstU: d.firstU, lastU: d.lastU, minIntervalMs: d.intervals.length ? Math.min(...d.intervals) : null, p10IntervalMs: pct(d.intervals, 0.1), medianIntervalMs: median(d.intervals), maxIntervalMs: d.intervals.length ? Math.max(...d.intervals) : null, medianLagMs: median(d.lags), bidsUnordered: d.bidsUnordered, asksUnordered: d.asksUnordered, zeroQty: d.zeroQty, levelsPerFrame: d.frames ? +(d.levels / d.frames).toFixed(1) : null, maxLevels: d.maxLevels, emptyFrames: d.emptyFrames });
  }
  for (const sym of symbols) {
    const p = P[sym];
    log('depth20_stream', { sym, frames: p.frames, firstAfterSubMs: p.firstAfterSubMs, firstAgeMs: p.firstAgeMs, minIntervalMs: p.intervals.length ? Math.min(...p.intervals) : null, medianIntervalMs: median(p.intervals), maxGapMs: p.maxGapMs, medianLagMs: median(p.lags), repeats: p.repeats, idBackwards: p.idBackwards, levelCounts: [...p.levelCounts].slice(0, 6), bidsDescFrames: p.bidsDesc, asksAscFrames: p.asksAsc });
  }
  log('depth200_stream', { frames: P200.frames, firstAgeMs: P200.firstAgeMs, minIntervalMs: P200.intervals.length ? Math.min(...P200.intervals) : null, medianIntervalMs: median(P200.intervals), levelCounts: [...P200.levelCounts].slice(0, 6) });
  for (const sym of symbols) log('bookTicker_stream', { sym, ...B[sym], last: undefined });
  for (const s of [diff, part, d200, bt]) log('socket', { ...summary(s), controls: s.controls.slice(0, 4) });
  for (const s of [diff, part, d200, bt]) s.ws.terminate();
}

async function errors() {
  const ei = await rest('/openapi/v1/exchangeInfo');
  const closedSym = ei.json.symbols.find((x) => x.status === 'break').symbol;
  const s = open('errors', STREAM_URL);
  await s.ready;
  const data = {};
  wire(s, (j) => {
    const k = `${j.s ?? '?'} ${j.e ?? Object.keys(j).join(',')}`;
    data[k] = (data[k] ?? 0) + 1;
  });
  const cases = [
    ['unknown symbol', { method: 'SUBSCRIBE', params: ['nopephp@depth20@100ms'], id: 11 }],
    ['closed symbol', { method: 'SUBSCRIBE', params: [`${closedSym.toLowerCase()}@depth20@100ms`], id: 12 }],
    ['uppercase symbol', { method: 'SUBSCRIBE', params: ['ETHPHP@depth20@100ms'], id: 13 }],
    ['invalid level', { method: 'SUBSCRIBE', params: ['btcphp@depth30'], id: 14 }],
    ['invalid channel', { method: 'SUBSCRIBE', params: ['btcphp@nope'], id: 15 }],
    ['valid', { method: 'SUBSCRIBE', params: ['btcphp@depth20@100ms'], id: 16 }],
    ['duplicate', { method: 'SUBSCRIBE', params: ['btcphp@depth20@100ms'], id: 17 }],
    ['unknown method', { method: 'FOO', params: ['btcphp@depth20@100ms'], id: 18 }],
    ['id as string', { method: 'SUBSCRIBE', params: ['xrpphp@depth20@100ms'], id: 'abc' }],
    ['missing id', { method: 'SUBSCRIBE', params: ['solphp@depth20@100ms'] }],
    ['not json', 'hello'],
    ['list', { method: 'LIST_SUBSCRIPTIONS', id: 19 }],
    ['unsubscribe', { method: 'UNSUBSCRIBE', params: ['btcphp@depth20@100ms'], id: 20 }],
    ['list after unsubscribe', { method: 'LIST_SUBSCRIPTIONS', id: 21 }],
  ];
  for (const [name, frame] of cases) {
    const before = s.controls.length;
    send(s, frame);
    await sleep(1_200);
    log('ws_error_case', { name, sent: typeof frame === 'string' ? frame : JSON.stringify(frame), replies: s.controls.slice(before).map((c) => c.frame ?? c.nonJson), open: s.ws.readyState === WebSocket.OPEN });
  }
  await sleep(1_500);
  log('ws_error_data', { closedSym, dataFramesBySymbol: data, ...summary(s) });
  s.ws.terminate();
}

async function batch() {
  const ei = await rest('/openapi/v1/exchangeInfo');
  const syms = ei.json.symbols.filter((x) => x.status === 'trading').map((x) => x.symbol);
  const diff = open('batch-diff', STREAM_URL);
  const part = open('batch-depth20', STREAM_URL);
  await Promise.all([diff.ready, part.ready]);
  const per = {};
  const perP = {};
  let parseUs = 0;
  let parsed = 0;
  const secs = [];
  let secFrames = 0;
  const secTimer = setInterval(() => {
    secs.push(secFrames);
    secFrames = 0;
  }, 1_000);
  for (const [s, table] of [[diff, per], [part, perP]]) {
    s.ws.on('message', (raw) => {
      const t0 = process.hrtime.bigint();
      const j = JSON.parse(raw.toString());
      parseUs += Number(process.hrtime.bigint() - t0) / 1000;
      parsed++;
      s.frames++;
      s.bytes += raw.length;
      if (s === diff) secFrames++;
      if (j.s === undefined) {
        if (j.id !== undefined) s.controls.push({ frame: JSON.stringify(j).slice(0, 200) });
        return;
      }
      const r = (table[j.s] ??= { frames: 0, gaps: 0, lastU: null });
      r.frames++;
      if (j.e === 'depthUpdate') {
        if (r.lastU !== null && j.U !== r.lastU + 1) r.gaps++;
        r.lastU = j.u;
      }
    });
  }
  const t0 = Date.now();
  send(diff, { method: 'SUBSCRIBE', params: syms.map((x) => `${x.toLowerCase()}@depth@100ms`), id: 1 });
  send(part, { method: 'SUBSCRIBE', params: syms.map((x) => `${x.toLowerCase()}@depth20@100ms`), id: 2 });
  const pinger = setInterval(() => [diff, part].forEach(appPing), 20_000);
  await sleep(45_000);
  clearInterval(pinger);
  clearInterval(secTimer);
  const dur = (Date.now() - t0) / 1000;
  const counts = Object.values(per).map((r) => r.frames);
  log('batch', {
    symbols: syms.length,
    streamsPerSocket: syms.length,
    durationS: +dur.toFixed(1),
    diff: { frames: diff.frames, framesPerS: +(diff.frames / dur).toFixed(1), bytesPerS: Math.round(diff.bytes / dur), symbolsWithFrames: Object.keys(per).length, gaps: Object.values(per).reduce((a, r) => a + r.gaps, 0), medianFramesPerSymbol: median(counts), maxFramesPerSymbol: counts.length ? Math.max(...counts) : 0, peakPerS: Math.max(...secs), medianPerS: median(secs) },
    depth20: { frames: part.frames, framesPerS: +(part.frames / dur).toFixed(1), bytesPerS: Math.round(part.bytes / dur), symbolsWithFrames: Object.keys(perP).length },
    parseUsPerFrame: +(parseUs / parsed).toFixed(1),
    acks: [...diff.controls, ...part.controls],
    sockets: [summary(diff), summary(part)],
  });
  diff.ws.terminate();
  part.ws.terminate();
}

async function silence() {
  const a = open('A nothing', STREAM_URL);
  const b = open('B subscribed quiet, sends nothing', STREAM_URL);
  const c = open('C app ping every 30 s, no subscription', STREAM_URL);
  const d = open('D no subscription, protocol pongs disabled', STREAM_URL, { autoPong: false });
  await Promise.all([a.ready, b.ready, c.ready, d.ready]);
  for (const s of [a, b, c, d]) wire(s, () => {
    s.dataFrames = (s.dataFrames ?? 0) + 1;
  });
  send(b, { method: 'SUBSCRIBE', params: ['latusdt@depth20@100ms'], id: 1 });
  const pinger = setInterval(() => appPing(c), 30_000);
  const t0 = Date.now();
  while (Date.now() - t0 < 100_000 && [a, b, c, d].some((s) => s.closed === null)) await sleep(1_000);
  clearInterval(pinger);
  for (const s of [a, b, c, d]) log('silence', { ...summary(s), dataFrames: s.dataFrames ?? 0, heldS: s.closed ? s.closed.afterS : +((Date.now() - s.t0) / 1000).toFixed(1) });
  for (const s of [a, b, c, d]) s.ws.terminate();
}

async function deflate() {
  const s = open('deflate', STREAM_URL, { deflate: true });
  await s.ready;
  log('deflate', { offered: 'permessage-deflate', negotiated: s.extensions, openMs: s.openMs });
  s.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await book();
if (mode === 'errors') await errors();
if (mode === 'batch') await batch();
if (mode === 'silence') await silence();
if (mode === 'deflate') await deflate();
log('end', { at: new Date().toISOString() });
process.exit(0);
