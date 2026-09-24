// Echobit WebSocket probe: the depth channel and its versions, level order and size unit, channel variants, errors, a batch of perpetuals on one socket, keepalive and silence, the funding socket, and compression.
// Public, unauthenticated, read-only. No API key is sent. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/echobit/ws-probe.mjs [book|diff|variants|errors|batch|silence|fund|deflate]
//   book      depth on four perpetuals for 60 s with a REST depth compare, and a REST read of the second contract every second. About 65 s.
//   diff      diffDepth on one socket and depth on another for three perpetuals, the rebuilt book compared with each snapshot of the same version. About 50 s.
//   variants  depth with other limits, diffDepth, mergedDepth, binary, a multi symbol frame, bookTicker, trade, mark and index klines, spot depth, quotesData, on one socket. About 30 s.
//   errors    unknown symbol, unknown topic, text that is not JSON, missing symbol, duplicate and cancelled subscriptions. About 20 s.
//   batch     depth on every visible USDT perpetual on one socket for 30 s.
//   silence   three sockets that differ only in what the client subscribes and sends, for up to 100 s.
//   fund      fund_rates on the funding socket for 30 s.
//   deflate   asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/echobit/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const MARKET_URL = 'wss://uapi.echobit.com/uapi/exchange/ws';
const FUND_URL = 'wss://uapi.echobit.com/uapi/ws/inform';
const UAPI = 'https://uapi.echobit.com';
const OUT = process.env.PROBE_OUT_DIR;
const BATCH_MS = 30_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 3000) + '\n');
}

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

function decode(data, isBinary) {
  if (!isBinary) return { text: data.toString('utf8'), binary: null };
  for (const [kind, fn] of [['gzip', gunzipSync], ['deflate', inflateSync]]) {
    try {
      return { text: fn(data).toString('utf8'), binary: kind };
    } catch {}
  }
  return { text: null, binary: 'unknown' };
}

// Opens a socket and resolves once it is open, with the handshake time.
function open(url, opts = { perMessageDeflate: false }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, opts);
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0, t0 }));
    ws.once('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ ws: null, refused: res.statusCode, body: body.slice(0, 300) }));
    });
    ws.once('error', (e) => resolve({ ws: null, error: e.message }));
  });
}

async function visiblePerps() {
  const [contracts, tickers] = await Promise.all([getJson(`${UAPI}/uapi/contract/list`), getJson(`${UAPI}/uapi/exchange/all/tickers`)]);
  const qv = new Map(tickers.data.map((t) => [t.s, Number(t.qv)]));
  return contracts.data
    .filter((x) => x.showState && x.baseId === 1)
    .map((x) => ({ ...x, qv: qv.get(x.symbolId) ?? 0 }))
    .sort((a, b) => b.qv - a.qv);
}

const depthSub = (symbol, extra = {}) => ({ id: `depth.${symbol}`, topic: 'depth', event: 'sub', symbol, params: {}, ...extra });

function versionNumber(v) {
  return Number(String(v).split('_')[0]);
}

async function book() {
  const perps = await visiblePerps();
  const picks = [perps[0], perps[1], perps[29], perps.at(-1)].map((p) => p.symbolId);
  log('picks', { picks });
  const rest = await getJson(`${UAPI}/uapi/exchange/depth?symbol=${picks[0]}&limit=20`);

  const o = await open(MARKET_URL);
  if (!o.ws) return log('open_failed', o);
  log('open', { url: MARKET_URL, openMs: o.openMs });
  const stats = new Map(picks.map((s) => [s, { frames: 0, arrivals: [], levelsB: [], levelsA: [], badOrder: 0, fValues: {}, oValues: {}, suffixes: {}, vSteps: [], vBack: 0, repeats: 0, lastBook: null, lastV: null, sendLag: [], clockLag: [], firstAt: null, firstLevels: [], under20: 0 }]));
  const other = [];
  let firstSocketTop = null;
  const subSentAt = Date.now();
  o.ws.on('ping', () => other.push({ at: Date.now() - o.t0, kind: 'protocol ping' }));
  o.ws.on('message', (data, isBinary) => {
    const now = Date.now();
    const { text } = decode(data, isBinary);
    const j = JSON.parse(text);
    if (j.topic !== 'depth' || !stats.has(j.symbol)) {
      other.push({ at: now - o.t0, text: text.slice(0, 200) });
      return;
    }
    const s = stats.get(j.symbol);
    const d = j.data[0];
    if (s.frames < 2 || d.b.length === 0 || d.a.length === 0) capture('book.txt', `${now} ${text}`);
    s.frames++;
    if (s.firstAt === null) s.firstAt = now - subSentAt;
    s.arrivals.push(now);
    s.levelsB.push(d.b.length);
    s.levelsA.push(d.a.length);
    if (s.firstLevels.length < 3) s.firstLevels.push(`${d.b.length}/${d.a.length}`);
    if (d.b.length < 20 || d.a.length < 20) s.under20++;
    const desc = d.b.every((l, i) => i === 0 || Number(l[0]) < Number(d.b[i - 1][0]));
    const asc = d.a.every((l, i) => i === 0 || Number(l[0]) > Number(d.a[i - 1][0]));
    if (!desc || !asc) s.badOrder++;
    s.fValues[j.f] = (s.fValues[j.f] ?? 0) + 1;
    s.oValues[d.o] = (s.oValues[d.o] ?? 0) + 1;
    const suffix = String(d.v).split('_')[1];
    s.suffixes[suffix] = (s.suffixes[suffix] ?? 0) + 1;
    const vn = versionNumber(d.v);
    if (s.lastV !== null) {
      if (vn <= s.lastV) s.vBack++;
      else s.vSteps.push(vn - s.lastV);
    }
    s.lastV = vn;
    const bookKey = JSON.stringify([d.b, d.a]);
    if (bookKey === s.lastBook) s.repeats++;
    s.lastBook = bookKey;
    s.sendLag.push(j.sendTime - d.t);
    s.clockLag.push(now - j.sendTime);
    if (j.symbol === picks[0] && firstSocketTop === null && d.b.length >= 20 && d.a.length >= 20) firstSocketTop = { v: d.v, b: d.b.slice(0, 20), a: d.a.slice(0, 20) };
  });
  for (const s of picks) o.ws.send(JSON.stringify(depthSub(s)));

  // A REST read of the second contract every second, to see whether the book moved while its socket stream was silent.
  const restPolls = [];
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    const tick = Date.now();
    const r = await getJson(`${UAPI}/uapi/exchange/depth?symbol=${picks[1]}&limit=20`).catch(() => null);
    const st = stats.get(picks[1]);
    const row = r?.data?.[0];
    if (row) restPolls.push({ restV: versionNumber(row.v), wsV: st.lastV, wsAgeMs: st.arrivals.length ? Date.now() - st.arrivals.at(-1) : null, restTouch: `${row.b[0]?.[0]}/${row.a[0]?.[0]}` });
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  o.ws.terminate();

  const ahead = restPolls.filter((p) => p.wsV !== null && p.restV > p.wsV);
  log('rest_vs_socket', {
    sym: picks[1],
    polls: restPolls.length,
    restAheadOfSocket: ahead.length,
    socketAgeMsWhenRestAheadMedian: median(ahead.map((p) => p.wsAgeMs)),
    socketAgeMsWhenRestAheadMax: ahead.length ? Math.max(...ahead.map((p) => p.wsAgeMs)) : null,
    distinctRestVersions: new Set(restPolls.map((p) => p.restV)).size,
    distinctRestTouches: new Set(restPolls.map((p) => p.restTouch)).size,
  });

  for (const [sym, s] of stats) {
    const gaps = s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]);
    log('depth_stats', {
      sym,
      frames: s.frames,
      firstFrameMs: s.firstAt,
      gapMsMedian: median(gaps),
      gapMsMin: Math.min(...gaps),
      gapMsMax: Math.max(...gaps),
      bidsMaxMin: [Math.max(...s.levelsB), Math.min(...s.levelsB)],
      asksMaxMin: [Math.max(...s.levelsA), Math.min(...s.levelsA)],
      firstFramesLevels: s.firstLevels,
      framesUnder20Levels: s.under20,
      badOrder: s.badOrder,
      f: s.fValues,
      o: s.oValues,
      vSuffix: s.suffixes,
      vStepMedian: median(s.vSteps),
      vStepMax: Math.max(...s.vSteps),
      vBackwards: s.vBack,
      identicalToPrevious: s.repeats,
      sendMinusTMsMedian: median(s.sendLag),
      sendMinusTMsMax: Math.max(...s.sendLag),
      arrivalMinusSendMsMedian: median(s.clockLag),
    });
  }
  log('other_frames', { count: other.length, first: other.slice(0, 5) });

  const quiet = await getJson(`${UAPI}/uapi/exchange/depth?symbol=${picks[3]}&limit=200`);
  const q = quiet.data[0];
  log('quiet_rest_depth', { sym: picks[3], levels: `${q.b.length}/${q.a.length}`, v: q.v, ageMs: Date.now() - q.t });

  const r = rest.data[0];
  const restB = new Map(r.b.map(([p, q]) => [p, q]));
  const restA = new Map(r.a.map(([p, q]) => [p, q]));
  const same = firstSocketTop.b.filter(([p, q]) => restB.get(p) === q).length + firstSocketTop.a.filter(([p, q]) => restA.get(p) === q).length;
  log('size_unit', { sym: picks[0], restV: r.v, socketV: firstSocketTop.v, restTouch: [r.b[0], r.a[0]], socketTouch: [firstSocketTop.b[0], firstSocketTop.a[0]], sameSizeAtSamePriceOf40: same });
}

// diffDepth on one socket and depth on another, for the same contracts.
// The book rebuilt from diffDepth is compared with every depth snapshot that carries the same version.
async function diff() {
  const perps = await visiblePerps();
  const picks = [perps[0], perps[1], perps[29]].map((p) => p.symbolId);
  const [d, s] = await Promise.all([open(MARKET_URL), open(MARKET_URL)]);
  if (!d.ws || !s.ws) return log('open_failed', { d, s });
  const books = new Map(picks.map((p) => [p, { bids: new Map(), asks: new Map(), frames: 0, keys: {}, firstLevels: null, vSteps: [], vBack: 0, lastV: null, history: new Map(), zeroSize: 0, gaps: [], arrivals: [] }]));
  const cmp = new Map(picks.map((p) => [p, { snapshots: 0, sameV: 0, match: 0, mismatch: 0, example: null }]));
  const top = (m, desc, n) => [...m.entries()].sort((a, b) => (desc ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]))).slice(0, n);
  d.ws.on('message', (data) => {
    const text = data.toString('utf8');
    const j = JSON.parse(text);
    if (j.topic !== 'diffDepth') return;
    const b = books.get(j.symbol);
    const row = j.data[0];
    const keySet = Object.keys(j).sort().join(',') + ' | ' + Object.keys(row).sort().join(',');
    b.keys[keySet] = (b.keys[keySet] ?? 0) + 1;
    if (b.frames < 3) capture('diff.txt', `${Date.now()} ${text}`);
    if (b.frames === 0) b.firstLevels = `${row.b.length}/${row.a.length}`;
    b.frames++;
    b.arrivals.push(Date.now());
    const vn = versionNumber(row.v);
    if (b.lastV !== null) {
      if (vn <= b.lastV) b.vBack++;
      else b.vSteps.push(vn - b.lastV);
    }
    b.lastV = vn;
    for (const [p, q] of row.b) {
      if (Number(q) === 0) {
        b.zeroSize++;
        b.bids.delete(p);
      } else b.bids.set(p, q);
    }
    for (const [p, q] of row.a) {
      if (Number(q) === 0) {
        b.zeroSize++;
        b.asks.delete(p);
      } else b.asks.set(p, q);
    }
    b.history.set(vn, JSON.stringify([top(b.bids, true, 200), top(b.asks, false, 200)]));
    if (b.history.size > 400) b.history.delete(b.history.keys().next().value);
  });
  s.ws.on('message', (data) => {
    const j = JSON.parse(data.toString('utf8'));
    if (j.topic !== 'depth') return;
    const c = cmp.get(j.symbol);
    const row = j.data[0];
    c.snapshots++;
    const rebuilt = books.get(j.symbol).history.get(versionNumber(row.v));
    if (rebuilt === undefined) return;
    c.sameV++;
    const snap = JSON.stringify([row.b.map(([p, q]) => [p, q]), row.a.map(([p, q]) => [p, q])]);
    if (snap === rebuilt) c.match++;
    else {
      c.mismatch++;
      if (!c.example) {
        const [rb, ra] = JSON.parse(rebuilt);
        c.example = { v: row.v, snapTop: [row.b[0], row.a[0]], rebuiltTop: [rb[0], ra[0]], snapLevels: `${row.b.length}/${row.a.length}`, rebuiltLevels: `${rb.length}/${ra.length}` };
      }
    }
  });
  for (const p of picks) {
    d.ws.send(JSON.stringify({ id: `diff.${p}`, topic: 'diffDepth', event: 'sub', symbol: p, params: {} }));
    s.ws.send(JSON.stringify(depthSub(p)));
  }
  await sleep(45_000);
  d.ws.terminate();
  s.ws.terminate();
  for (const p of picks) {
    const b = books.get(p);
    const gaps = b.arrivals.slice(1).map((t, i) => t - b.arrivals[i]);
    log('diff_stats', { sym: p, frames: b.frames, firstFrameLevels: b.firstLevels, frameKeys: b.keys, gapMsMedian: median(gaps), gapMsMax: gaps.length ? Math.max(...gaps) : null, vStepMedian: median(b.vSteps), vStepMin: b.vSteps.length ? Math.min(...b.vSteps) : null, vBackwards: b.vBack, zeroSizeLevels: b.zeroSize, heldLevels: `${b.bids.size}/${b.asks.size}`, vsDepth: cmp.get(p) });
  }
}

async function variants() {
  const perps = await visiblePerps();
  const sym = perps.slice(0, 12).map((p) => p.symbolId);
  const idx = perps[0].indexId;
  const subs = [
    { id: 'v_limit5', topic: 'depth', event: 'sub', symbol: sym[1], limit: 5, params: {} },
    { id: 'v_limit200', topic: 'depth', event: 'sub', symbol: sym[2], limit: 200, params: {} },
    { id: 'v_paramsLimit5', topic: 'depth', event: 'sub', symbol: sym[3], params: { limit: 5 } },
    { id: 'v_diff', topic: 'diffDepth', event: 'sub', symbol: sym[4], params: {} },
    { id: 'v_merged', topic: 'mergedDepth', event: 'sub', symbol: sym[5], limit: 20, params: { dumpScale: 1 } },
    { id: 'v_binary', topic: 'depth', event: 'sub', symbol: sym[6], params: { binary: true } },
    { id: 'v_multi', topic: 'depth', event: 'sub', symbol: `${sym[7]},${sym[8]}`, params: {} },
    { id: 'v_bookTicker', topic: 'bookTicker', event: 'sub', symbol: sym[0], params: {} },
    { id: 'v_trade', topic: 'trade', event: 'sub', symbol: sym[0], params: {} },
    { id: 'v_markIndexId', topic: 'markKline_1m', event: 'sub', symbol: idx, limit: 1, params: {} },
    { id: 'v_markContractId', topic: 'markKline_1m', event: 'sub', symbol: sym[0], limit: 1, params: {} },
    { id: 'v_indexIndexId', topic: 'indexKline_1m', event: 'sub', symbol: idx, limit: 1, params: { klineType: '1m' } },
    { id: 'v_spot', topic: 'depth', event: 'sub', symbol: 'BTCUSDT', params: {} },
    { id: 'v_quotes', topic: 'quotesData', event: 'sub', params: {} },
  ];
  const o = await open(MARKET_URL);
  if (!o.ws) return log('open_failed', o);
  const byId = new Map();
  const unrouted = [];
  o.ws.on('message', (data, isBinary) => {
    const now = Date.now() - o.t0;
    const { text, binary } = decode(data, isBinary);
    if (text === null) return unrouted.push({ at: now, binary, bytes: data.length });
    const j = JSON.parse(text);
    const id = j.id ?? '(no id)';
    const e = byId.get(id) ?? { frames: 0, bytes: 0, binary, first: null, last: null, topics: {}, symbols: {}, levels: [], rows: [] };
    e.frames++;
    e.bytes += data.length;
    e.topics[j.topic] = (e.topics[j.topic] ?? 0) + 1;
    e.symbols[j.symbol ?? j.data?.[0]?.s] = (e.symbols[j.symbol ?? j.data?.[0]?.s] ?? 0) + 1;
    if (Array.isArray(j.data)) {
      e.rows.push(j.data.length);
      const d = j.data[0];
      if (d?.b) e.levels.push(`${d.b.length}/${d.a.length}`);
    }
    if (e.first === null) e.first = { at: now, text: text.slice(0, 400) };
    e.last = { at: now, text: text.slice(0, 250) };
    byId.set(id, e);
    if (e.frames <= 2) capture('variants.txt', `${id} ${binary ?? 'text'} ${text}`);
  });
  for (const s of subs) o.ws.send(JSON.stringify(s));
  await sleep(30_000);
  o.ws.terminate();
  for (const s of subs) {
    const e = byId.get(s.id);
    if (!e) {
      log('variant', { id: s.id, sub: s, frames: 0 });
      continue;
    }
    log('variant', { id: s.id, sub: s, frames: e.frames, kb: Math.round(e.bytes / 1024), binary: e.binary, topics: e.topics, symbols: e.symbols, levels: [...new Set(e.levels)].slice(0, 6), rowsPerFrame: [...new Set(e.rows)].slice(0, 6), first: e.first, last: e.last });
  }
  for (const [id, e] of byId) if (!subs.some((s) => s.id === id)) log('variant_unrouted_id', { id, frames: e.frames, first: e.first });
  log('variant_undecoded', { count: unrouted.length, first: unrouted.slice(0, 3) });
}

async function errors() {
  const o = await open(MARKET_URL);
  if (!o.ws) return log('open_failed', o);
  const frames = [];
  const counts = {};
  o.ws.on('message', (data) => {
    const text = data.toString('utf8');
    const j = JSON.parse(text);
    const key = `${j.id ?? '-'}|${j.topic ?? '-'}|${j.code ?? '-'}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (counts[key] <= 1) frames.push({ at: Date.now() - o.t0, text: text.slice(0, 300) });
  });
  o.ws.on('close', (c, r) => log('closed', { at: Date.now() - o.t0, code: c, reason: r.toString() }));
  const send = (label, payload) => {
    log('send', { at: Date.now() - o.t0, label });
    o.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };
  send('unknown symbol', depthSub('NOPE-SWAP-USDT'));
  send('unknown topic', { id: 'nope', topic: 'nope', event: 'sub', symbol: 'BTC-SWAP-USDT', params: {} });
  send('missing symbol', { id: 'nosym', topic: 'depth', event: 'sub', params: {} });
  send('delisted symbol', depthSub('CATI-SWAP-USDT'));
  send('unknown event', { id: 'badevent', topic: 'depth', event: 'nope', symbol: 'ETH-SWAP-USDT', params: {} });
  send('not json', 'hello');
  await sleep(3_000);
  send('first BTC depth', depthSub('BTC-SWAP-USDT'));
  send('same BTC depth again, same id', depthSub('BTC-SWAP-USDT'));
  send('same BTC depth, other id', { ...depthSub('BTC-SWAP-USDT'), id: 'depth.BTC.second' });
  await sleep(5_000);
  const before = { ...counts };
  send('cancel BTC depth', { id: 'depth.BTC-SWAP-USDT', topic: 'depth', event: 'cancel', symbol: 'BTC-SWAP-USDT', params: {} });
  await sleep(5_000);
  send('client ping', { ping: Date.now() });
  await sleep(3_000);
  o.ws.terminate();
  log('counts_before_cancel', before);
  log('counts_after', counts);
  for (const f of frames) log('frame', f);
}

async function batch() {
  const perps = await visiblePerps();
  const syms = perps.map((p) => p.symbolId);
  const o = await open(MARKET_URL);
  if (!o.ws) return log('open_failed', o);
  log('open', { openMs: o.openMs, streams: syms.length });
  const seen = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = [];
  let lastSecond = 0;
  let closed = null;
  let control = [];
  const cutFirst = [];
  let cutLater = 0;
  o.ws.on('close', (c) => (closed = { at: Date.now() - o.t0, code: c }));
  o.ws.on('message', (data) => {
    const t = process.hrtime.bigint();
    const j = JSON.parse(data.toString('utf8'));
    parseNs += process.hrtime.bigint() - t;
    frames++;
    bytes += data.length;
    lastSecond++;
    if (j.topic === 'depth') {
      const n = seen.get(j.symbol) ?? 0;
      seen.set(j.symbol, n + 1);
      const d = j.data[0];
      // A book cut to exactly 1, 5 or 20 levels on both sides looks like a cached reply for a smaller limit.
      if (d.b.length === d.a.length && [1, 5, 20].includes(d.b.length)) {
        if (n === 0) cutFirst.push(`${j.symbol} ${d.b.length}`);
        else cutLater++;
      }
    }
    else if (control.length < 5) control.push(data.toString('utf8').slice(0, 200));
  });
  const tick = setInterval(() => {
    perSecond.push(lastSecond);
    lastSecond = 0;
  }, 1000);
  const t0 = Date.now();
  for (const s of syms) o.ws.send(JSON.stringify(depthSub(s)));
  const sentMs = Date.now() - t0;
  await sleep(BATCH_MS);
  clearInterval(tick);
  o.ws.terminate();
  const counts = [...seen.values()];
  log('batch', {
    streams: syms.length,
    subscribeFramesSentMs: sentMs,
    symbolsWithFrames: seen.size,
    missing: syms.filter((s) => !seen.has(s)),
    frames,
    framesPerSecondMedian: median(perSecond),
    framesPerSecondMax: Math.max(...perSecond),
    seconds: BATCH_MS / 1000,
    kbPerSecond: Math.round(bytes / (BATCH_MS / 1000) / 1024),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000,
    framesPerSymbolMedian: median(counts),
    framesPerSymbolMin: Math.min(...counts),
    firstFramesCutTo1Or5Or20: cutFirst,
    laterFramesCutTo1Or5Or20: cutLater,
    closed,
    control,
  });
}

async function silence() {
  const perps = await visiblePerps();
  const quiet = perps.at(-1).symbolId;
  const plans = [
    { name: 'A subscribed busy, sends nothing', sub: depthSub(perps[0].symbolId), ping: false },
    { name: 'B unsubscribed, sends nothing', sub: null, ping: false },
    { name: 'C unsubscribed, JSON ping every 20 s', sub: null, ping: true },
  ];
  log('quiet', { quiet });
  const results = await Promise.all(
    plans.map(async (p) => {
      const o = await open(MARKET_URL);
      if (!o.ws) return { name: p.name, open: o };
      const r = { name: p.name, openMs: o.openMs, frames: 0, serverJsonPings: [], protocolPings: [], pongs: [], closed: null };
      o.ws.on('ping', () => r.protocolPings.push(Date.now() - o.t0));
      o.ws.on('message', (data) => {
        r.frames++;
        const j = JSON.parse(data.toString('utf8'));
        if (j.ping !== undefined) {
          r.serverJsonPings.push({ at: Date.now() - o.t0, value: j.ping });
          if (r.serverJsonPings.length === 1) log('server_ping_frame', { name: p.name, text: data.toString('utf8') });
        }
        if (j.pong !== undefined) r.pongs.push({ at: Date.now() - o.t0, sent: r.lastSent, text: data.toString('utf8').slice(0, 100) });
      });
      if (p.sub) o.ws.send(JSON.stringify(p.sub));
      let timer = null;
      if (p.ping)
        timer = setInterval(() => {
          if (o.ws.readyState !== 1) return;
          r.lastSent = Date.now();
          o.ws.send(JSON.stringify({ ping: r.lastSent }));
        }, 20_000);
      await new Promise((resolve) => {
        o.ws.on('close', (code, reason) => {
          if (r.closed === null) r.closed = { at: Date.now() - o.t0, code, reason: reason.toString() };
          resolve();
        });
        setTimeout(resolve, 100_000);
      });
      if (timer) clearInterval(timer);
      // A socket still open at 100 s is closed by the probe, and that close is not the server's.
      if (o.ws.readyState === 1) {
        r.closed = 'open at 100 s, closed by the probe';
        o.ws.terminate();
      }
      r.serverJsonPings = r.serverJsonPings.slice(0, 6);
      r.pongs = r.pongs.slice(0, 3);
      return r;
    }),
  );
  for (const r of results) log('silence', r);
}

async function fund() {
  const o = await open(FUND_URL);
  if (!o.ws) return log('open_failed', o);
  log('open', { url: FUND_URL, openMs: o.openMs });
  const pushes = [];
  const other = [];
  o.ws.on('message', (data) => {
    const text = data.toString('utf8');
    const j = JSON.parse(text);
    if (j.topic === 'fund_rates' && Array.isArray(j.data)) {
      pushes.push({ at: Date.now() - o.t0, rows: j.data.length, event: j.event, code: j.code, btc: j.data.find((x) => x.symbolId === 'BTC-SWAP-USDT') });
      if (pushes.length <= 1) capture('fund.txt', text);
    } else other.push({ at: Date.now() - o.t0, text: text.slice(0, 200) });
  });
  o.ws.on('close', (c, r) => other.push({ at: Date.now() - o.t0, close: c, reason: r.toString() }));
  o.ws.send(JSON.stringify({ id: 'fund_rates', topic: 'fund_rates', event: 'sub' }));
  await sleep(30_000);
  o.ws.terminate();
  const gaps = pushes.slice(1).map((p, i) => p.at - pushes[i].at);
  log('fund_ws', { pushes: pushes.length, rows: [...new Set(pushes.map((p) => p.rows))], gapMsMedian: median(gaps), gapMsMax: gaps.length ? Math.max(...gaps) : null, first: pushes[0], last: pushes.at(-1), other: other.slice(0, 5) });
}

async function deflate() {
  const o = await open(MARKET_URL, { perMessageDeflate: true });
  if (!o.ws) return log('open_failed', o);
  log('deflate', { offered: true, negotiated: o.ws.extensions || '(none)' });
  let frames = 0;
  o.ws.on('message', () => frames++);
  o.ws.send(JSON.stringify(depthSub('BTC-SWAP-USDT')));
  await sleep(3_000);
  o.ws.terminate();
  log('deflate_frames', { frames });
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
await { book, diff, variants, errors, batch, silence, fund, deflate }[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
