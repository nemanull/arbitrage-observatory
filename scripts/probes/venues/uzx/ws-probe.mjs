// UZX public WebSocket probe: the swap.orderbook channel, its frame shape and cadence, errors, a batch of perpetuals, keepalive, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in deflate mode.
// The venue allows 1 connection per second and 240 subscriptions per hour, so sockets open 1.2 s apart and one full run sends about 90 subscriptions.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/uzx/ws-probe.mjs [book|errors|batch|silence|deflate]
//   book     swap.orderbook on seven perpetuals across both families, step1, percent10 and ticker on BTCUSDT, with a REST book compare. About 62 s.
//   errors   unknown, malformed, duplicate, multi symbol, gzip, unsubscribe and the swap.overview bulk channel on one socket. About 35 s.
//   batch    swap.orderbook on every USDT-M perpetual on one socket for 45 s.
//   silence  four sockets that differ only in what the client subscribes and whether it answers pings, for up to 100 s.
//   deflate  offers permessage-deflate once, and tries the web client URL and the bare documented host.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/uzx/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, inflateSync, inflateRawSync, brotliDecompressSync, zstdDecompressSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_DOC = 'wss://stream.uzx.com/notification/ws'; // the URL every documented example opens
const URL_WEB = 'wss://api.uzx.com/notification/ws'; // the URL the web client opens
const URL_BARE = 'wss://stream.uzx.com'; // the host the overview section names
const API = 'https://api-v2.uzx.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
// Pass null for symbol or interval to leave the field out of the frame.
const sub = (symbol, type = 'swap.orderbook', interval = '0') => ({ event: 'sub', params: { biz: 'market', type, ...(symbol === null ? {} : { symbol }), ...(interval === null ? {} : { interval }) }, zip: false });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

let lastOpen = 0;
async function open(url, opts = {}) {
  const wait = lastOpen + 1200 - Date.now(); // 1 connection per second is the documented cap
  if (wait > 0) await sleep(wait);
  lastOpen = Date.now();
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve) => {
    let upgrade = null;
    ws.on('upgrade', (res) => (upgrade = { status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null, cfRay: res.headers['cf-ray'] ?? null }));
    ws.on('unexpected-response', (_req, res) => resolve({ ws: null, error: `http ${res.statusCode}`, ms: Date.now() - t0 }));
    ws.on('open', () => resolve({ ws, upgrade, ms: Date.now() - t0, t0 }));
    ws.on('error', (e) => resolve({ ws: null, error: e.message, ms: Date.now() - t0 }));
  });
}

// The docs say zip turns on gzip, and the frames start with the zstd magic 28b52ffd, so each codec is tried and the one that works is reported.
function decodeBinary(raw) {
  for (const [codec, fn] of [['zstd', zstdDecompressSync], ['gzip', gunzipSync], ['zlib', inflateSync], ['deflate-raw', inflateRawSync], ['brotli', brotliDecompressSync]]) {
    try {
      const text = fn(raw).toString('utf8');
      JSON.parse(text);
      return { codec, text };
    } catch {}
  }
  const plain = raw.toString('utf8');
  try {
    JSON.parse(plain);
    return { codec: 'plain-binary', text: plain };
  } catch {}
  return { codec: 'unknown', text: null };
}

// Book frames carry product_name and bids, and the control frames carry event, ping, pong or type.
function isBook(j) {
  return j && Array.isArray(j.bids) && Array.isArray(j.asks);
}

function newStats() {
  return { frames: 0, bytes: 0, gaps: [], ages: [], bidLv: [], askLv: [], unsorted: 0, crossed: 0, identical: 0, zeroSize: 0, seqSteps: [], seqBack: 0, seqRepeat: 0, identicalSameSeq: 0, idSteps: [], idEqVersion: 0, prev: null, lastAt: 0, first: null, keys: null, numTypes: new Set(), frames50: 0, lastFrame: null };
}

function addBook(st, j, raw, now) {
  st.frames++;
  st.bytes += raw.length;
  if (st.lastAt) st.gaps.push(now - st.lastAt);
  st.lastAt = now;
  if (st.first === null) st.first = now;
  if (!st.keys) st.keys = Object.keys(j).filter((k) => k !== 'bids' && k !== 'asks');
  if (typeof j.ts === 'number') st.ages.push(now - j.ts);
  st.bidLv.push(j.bids.length);
  st.askLv.push(j.asks.length);
  const b = j.bids.map((l) => Number(l[0]));
  const a = j.asks.map((l) => Number(l[0]));
  if (!b.every((p, i) => i === 0 || p < b[i - 1]) || !a.every((p, i) => i === 0 || p > a[i - 1])) st.unsorted++;
  if (b.length && a.length && b[0] >= a[0]) st.crossed++;
  for (const l of [...j.bids, ...j.asks]) {
    st.numTypes.add(`${typeof l[0]}/${typeof l[1]}`);
    if (Number(l[1]) === 0) st.zeroSize++;
  }
  const body = JSON.stringify([j.bids, j.asks]);
  if (st.prev) {
    if (st.prev.body === body) st.identical++;
    if (st.prev.body === body && j.seqId === st.prev.seqId) st.identicalSameSeq++;
    if (typeof j.seqId === 'number') {
      const d = j.seqId - st.prev.seqId;
      st.seqSteps.push(d);
      if (d < 0) st.seqBack++;
      if (d === 0) st.seqRepeat++;
    }
    if (typeof j.id === 'number') st.idSteps.push(j.id - st.prev.id);
  }
  if (j.id === j.version) st.idEqVersion++;
  st.prev = { body, seqId: j.seqId, id: j.id };
  st.lastFrame = j;
}

function summary(st) {
  return {
    frames: st.frames,
    medianGapMs: q(st.gaps, 0.5),
    p90GapMs: q(st.gaps, 0.9),
    maxGapMs: st.gaps.length ? Math.max(...st.gaps) : null,
    bytesPerFrame: st.frames ? Math.round(st.bytes / st.frames) : null,
    bidLevels: [q(st.bidLv, 0), q(st.bidLv, 0.5), q(st.bidLv, 1)],
    askLevels: [q(st.askLv, 0), q(st.askLv, 0.5), q(st.askLv, 1)],
    unsortedFrames: st.unsorted,
    crossedFrames: st.crossed,
    identicalToPrevious: st.identical,
    identicalWithSameSeqId: st.identicalSameSeq,
    zeroSizeLevels: st.zeroSize,
    seqIdStep: [q(st.seqSteps, 0), q(st.seqSteps, 0.5), q(st.seqSteps, 1)],
    seqIdDecreased: st.seqBack,
    seqIdRepeated: st.seqRepeat,
    idStep: [q(st.idSteps, 0), q(st.idSteps, 0.5), q(st.idSteps, 1)],
    idStepZero: st.idSteps.filter((d) => d === 0).length,
    idEqualsVersion: st.idEqVersion,
    tsAgeMs: [q(st.ages, 0), q(st.ages, 0.5), q(st.ages, 1)],
    levelTypes: [...st.numTypes],
    keys: st.keys,
  };
}

// Routes every frame of one socket: answers pings unless told not to, counts book frames per type, logs control frames.
function attach(ws, name, { pong = true, onBook, maxControlLogs = 40 } = {}) {
  const s = { pings: [], protoPings: 0, control: {}, controlLogged: 0, books: new Map(), tickers: { frames: 0, gaps: [], last: 0, repeats: 0, prevSeq: null, sample: null }, codecs: {}, binary: 0, nonJson: 0, closed: null, t0: Date.now() };
  ws.on('ping', () => s.protoPings++);
  ws.on('message', (raw, isBinary) => {
    const now = Date.now();
    let text = raw.toString('utf8');
    if (isBinary) {
      s.binary++;
      const dec = decodeBinary(raw);
      if (s.binary === 1) log('binary_first', { name, bytes: raw.length, hex: raw.subarray(0, 12).toString('hex'), codec: dec.codec });
      s.codecs[dec.codec] = (s.codecs[dec.codec] ?? 0) + 1;
      if (dec.text === null) {
        s.nonJson++;
        return;
      }
      text = dec.text;
    }
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      s.nonJson++;
      if (s.controlLogged++ < maxControlLogs) log('nonjson', { name, at: now - s.t0, text: text.slice(0, 200) });
      return;
    }
    if (j.ping !== undefined) {
      s.pings.push(now);
      if (s.pings.length <= 2) capture(`${name}.txt`, text);
      if (pong) ws.send(JSON.stringify({ pong: j.ping }));
      return;
    }
    if (isBook(j)) {
      const key = `${j.type}|${j.interval ?? ''}${isBinary ? '|binary' : ''}`;
      if (!s.books.has(key)) {
        s.books.set(key, newStats());
        capture(`${name}.txt`, text);
      }
      addBook(s.books.get(key), j, text, now);
      if (onBook) onBook(j, now);
      return;
    }
    if (typeof j.type === 'string' && j.type.endsWith('.ticker') && j.data) {
      const tk = s.tickers;
      tk.frames++;
      if (tk.last) tk.gaps.push(now - tk.last);
      tk.last = now;
      if (tk.prevSeq === j.data.seq_id) tk.repeats++;
      tk.prevSeq = j.data.seq_id;
      if (!tk.sample) {
        tk.sample = text;
        capture(`${name}.txt`, text);
      }
      return;
    }
    const k = j.event ?? j.type ?? (j.pong !== undefined ? 'pong' : Object.keys(j).join(','));
    s.control[k] = (s.control[k] ?? 0) + 1;
    if (k === 'swap.overview' && s.control[k] > 1) return;
    if (s.controlLogged++ < maxControlLogs) {
      const t = JSON.stringify(j);
      log('control', { name, at: now - s.t0, binary: isBinary, bytes: t.length, frame: t.slice(0, 320) });
      capture(`${name}.txt`, t);
    }
  });
  ws.on('close', (code, reason) => (s.closed = { at: Date.now() - s.t0, code, reason: reason.toString() }));
  return s;
}

function pingSummary(s) {
  const gaps = s.pings.slice(1).map((t, i) => t - s.pings[i]);
  return { serverPings: s.pings.length, pingGapMs: [q(gaps, 0), q(gaps, 0.5), q(gaps, 1)], protocolPings: s.protoPings };
}

async function book() {
  const o = await open(URL_DOC);
  log('open', { url: URL_DOC, ms: o.ms, upgrade: o.upgrade, error: o.error });
  if (!o.ws) return;
  const frames = [];
  const s = attach(o.ws, 'book', {
    onBook: (j, now) => {
      if (j.product_name === 'BTCUSDT' && j.interval === '0') frames.push({ now, j });
      if (frames.length > 40) frames.shift();
    },
  });
  const subs = [sub('BTCUSDT'), sub('ETHUSDT'), sub('ACEUSDT'), sub('UZXUSDT'), sub('XAUUSDT'), sub('1000SATSUSDT'), sub('BTCUSD'), sub('BTCUSDT', 'swap.orderbook', '1'), sub('BTCUSDT', 'swap.percent10', null), sub('BTCUSDT', 'swap.ticker', null)];
  const sentAt = Date.now();
  for (const f of subs) o.ws.send(JSON.stringify(f));
  log('sent', { subs: subs.length, frame: JSON.stringify(subs[0]) });

  await sleep(30_000);
  const rest = await fetch(`${API}/notification/swap/BTCUSDT/orderbook?interval=step0`).then((r) => r.json());
  const at = Date.now();
  const rb = rest.data;
  const near = frames.reduce((best, f) => (best === null || Math.abs(f.j.ts - rb.ts) < Math.abs(best.j.ts - rb.ts) ? f : best), null);
  const sameId = frames.find((f) => f.j.id === rb.id && f.j.seqId === rb.seqId) ?? null;
  const cmp = (w) => {
    let bid = 0;
    let ask = 0;
    for (let i = 0; i < 20; i++) {
      if (w.bids[i] && rb.bids[i] && w.bids[i][0] === rb.bids[i][0] && w.bids[i][1] === rb.bids[i][1]) bid++;
      if (w.asks[i] && rb.asks[i] && w.asks[i][0] === rb.asks[i][0] && w.asks[i][1] === rb.asks[i][1]) ask++;
    }
    return { bid, ask };
  };
  log('rest_compare', { restLevels: [rb.bids.length, rb.asks.length], restTs: rb.ts, restSeqId: rb.seqId, restId: rb.id, nearestWsTsGapMs: near ? near.j.ts - rb.ts : null, nearestWsLevels: near ? [near.j.bids.length, near.j.asks.length] : null, top20EqualNearest: near ? cmp(near.j) : null, wsFrameWithSameSeqId: sameId ? { equalTop20: cmp(sameId.j), fullEqual: JSON.stringify([sameId.j.bids, sameId.j.asks]) === JSON.stringify([rb.bids, rb.asks]) } : null, readAt: at - sentAt });

  await sleep(30_000);
  for (const [k, st] of s.books) log('book_stream', { stream: k, firstFrameAfterSubMs: st.first - sentAt, ...summary(st) });
  log('ticker_stream', { frames: s.tickers.frames, medianGapMs: q(s.tickers.gaps, 0.5), sameSeqIdAsPrevious: s.tickers.repeats, sample: (s.tickers.sample ?? '').slice(0, 600) });
  log('book_socket', { control: s.control, ...pingSummary(s), binary: s.binary, closed: s.closed });
  const btc = s.books.get('swap.BTCUSDT.orderBook|0')?.lastFrame;
  if (btc) {
    const levels = [...btc.bids, ...btc.asks];
    log('btc_top', { bids: btc.bids.slice(0, 3), asks: btc.asks.slice(0, 3), deepestBid: btc.bids.at(-1), deepestAsk: btc.asks.at(-1), fractional: levels.filter((l) => !/^\d+$/.test(l[1])).length });
  }
  o.ws.close();
}

async function errors() {
  const o = await open(URL_DOC);
  log('open', { url: URL_DOC, ms: o.ms, upgrade: o.upgrade, error: o.error });
  if (!o.ws) return;
  const s = attach(o.ws, 'errors', { maxControlLogs: 60 });
  let overview = null;
  o.ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    const t = raw.toString('utf8');
    if (!t.includes('"swap.overview"') && !t.includes('swap.tickers')) return;
    const j = JSON.parse(t);
    if (!Array.isArray(j.data)) return;
    const now = Date.now();
    if (!overview) {
      overview = { frames: 0, gaps: [], rows: [], bytes: [], last: 0, keys: Object.keys(j), rowKeys: Object.keys(j.data[0] ?? {}) };
      capture('errors-overview.txt', t);
    }
    overview.frames++;
    overview.rows.push(j.data.length);
    overview.bytes.push(t.length);
    if (overview.last) overview.gaps.push(now - overview.last);
    overview.last = now;
  });
  const cases = [
    ['unknown symbol', sub('NOPEUSDT')],
    ['spot style symbol', sub('BTC-USDT')],
    ['unknown channel', sub('BTCUSDT', 'swap.nope')],
    ['first BTCUSDT', sub('BTCUSDT')],
    ['duplicate BTCUSDT', sub('BTCUSDT')],
    ['no interval', sub('ETHUSDT', 'swap.orderbook', null)],
    ['interval 4', sub('SOLUSDT', 'swap.orderbook', '4')],
    ['biz swap', { event: 'sub', params: { biz: 'swap', type: 'swap.orderbook', symbol: 'XRPUSDT', interval: '0' }, zip: false }],
    ['two symbols joined', sub('ADAUSDT,DOGEUSDT')],
    ['delisted in tickers', sub('LISTAUSDT')],
    ['gzip on', { ...sub('ACEUSDT'), zip: true }],
    ['not json', 'hello'],
    ['overview', sub(null, 'swap.overview', null)],
    ['unsubscribe BTCUSDT', { event: 'unsub', params: { biz: 'market', type: 'swap.orderbook', symbol: 'BTCUSDT', interval: '0' }, zip: false }],
  ];
  for (const [name, frame] of cases) {
    log('case', { name, at: Date.now() - s.t0, frame: typeof frame === 'string' ? frame : JSON.stringify(frame) });
    o.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
    await sleep(1500);
  }
  const btcBefore = s.books.get('swap.BTCUSDT.orderBook|0')?.frames ?? 0;
  await sleep(12_000);
  const btcAfter = s.books.get('swap.BTCUSDT.orderBook|0')?.frames ?? 0;
  log('after_unsub', { btcFramesInLast12s: btcAfter - btcBefore });
  for (const [k, st] of s.books) log('errors_stream', { stream: k, frames: st.frames, medianGapMs: q(st.gaps, 0.5) });
  if (overview) log('overview', { frames: overview.frames, rows: [q(overview.rows, 0), q(overview.rows, 1)], medianGapMs: q(overview.gaps, 0.5), maxGapMs: overview.gaps.length ? Math.max(...overview.gaps) : null, bytesMedian: q(overview.bytes, 0.5), keys: overview.keys, rowKeys: overview.rowKeys });
  log('errors_socket', { control: s.control, binary: s.binary, codecs: s.codecs, nonJson: s.nonJson, closed: s.closed });
  o.ws.close();
}

async function batch() {
  const products = (await fetch(`${API}/v2/products?ins_type=SWAP`).then((r) => r.json())).data.map((p) => p.product_name);
  const o = await open(URL_DOC);
  log('open', { url: URL_DOC, ms: o.ms, upgrade: o.upgrade, error: o.error });
  if (!o.ws) return;
  const bins = new Map();
  const parseUs = [];
  const topics = new Set();
  let acks = 0;
  let books = 0;
  const t0 = Date.now();
  const pong = { pings: 0 };
  o.ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString('utf8');
    const p0 = process.hrtime.bigint();
    const j = JSON.parse(text);
    parseUs.push(Number(process.hrtime.bigint() - p0) / 1000);
    if (j.ping !== undefined) {
      pong.pings++;
      o.ws.send(JSON.stringify({ pong: j.ping }));
      return;
    }
    if (j.event === 'subscribe') acks++;
    if (!isBook(j)) return;
    books++;
    topics.add(j.product_name);
    const sec = Math.floor((now - t0) / 1000);
    const b = bins.get(sec) ?? { frames: 0, bytes: 0 };
    b.frames++;
    b.bytes += text.length;
    bins.set(sec, b);
  });
  let closed = null;
  o.ws.on('close', (code, reason) => (closed = { at: Date.now() - t0, code, reason: reason.toString() }));
  for (const p of products) o.ws.send(JSON.stringify(sub(p)));
  await sleep(45_000);
  const full = [...bins.entries()].filter(([sec]) => sec >= 3 && sec < 44).map(([, b]) => b);
  log('batch', { contracts: products.length, acks, streamsDelivering: topics.size, silent: products.filter((p) => !topics.has(p)), bookFrames: books, framesPerSecMedian: q(full.map((b) => b.frames), 0.5), framesPerSecPeak: Math.max(...full.map((b) => b.frames)), kbPerSecMedian: Math.round(q(full.map((b) => b.bytes), 0.5) / 1024), bytesPerFrame: Math.round(full.reduce((a, b) => a + b.bytes, 0) / full.reduce((a, b) => a + b.frames, 0)), parseUsMedian: Math.round(q(parseUs, 0.5)), parseUsP90: Math.round(q(parseUs, 0.9)), pings: pong.pings, closed });
  o.ws.close();
}

async function silence() {
  const plans = [
    { name: 'no-sub, answers pings', subscribe: null, pong: true },
    { name: 'ACEUSDT book, ignores pings', subscribe: sub('ACEUSDT'), pong: false },
    { name: 'NOPEUSDT, answers pings', subscribe: sub('NOPEUSDT'), pong: true },
    { name: 'ACEUSDT book, answers pings', subscribe: sub('ACEUSDT'), pong: true },
  ];
  const socks = [];
  for (const p of plans) {
    const o = await open(URL_DOC);
    if (!o.ws) {
      log('open_failed', { name: p.name, error: o.error });
      continue;
    }
    const s = attach(o.ws, `silence-${socks.length}`, { pong: p.pong, maxControlLogs: 3 });
    if (p.subscribe) o.ws.send(JSON.stringify(p.subscribe));
    socks.push({ p, o, s });
  }
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && socks.some((x) => !x.s.closed)) await sleep(500);
  for (const { p, o, s } of socks) {
    const books = [...s.books.values()].reduce((a, st) => a + st.frames, 0);
    log('silence', { name: p.name, closed: s.closed, openFor: s.closed ? s.closed.at : Date.now() - s.t0, bookFrames: books, ...pingSummary(s) });
    if (!s.closed) o.ws.close();
  }
}

async function deflate() {
  const d = await open(URL_DOC, { deflate: true });
  log('deflate_offer', { url: URL_DOC, ms: d.ms, negotiated: d.upgrade?.ext ?? null, error: d.error });
  if (d.ws) d.ws.close();
  for (const url of [URL_WEB, URL_BARE]) {
    const o = await open(url);
    log('alt_url_open', { url, ms: o.ms, upgrade: o.upgrade, error: o.error });
    if (!o.ws) continue;
    const s = attach(o.ws, 'alt', { maxControlLogs: 4 });
    o.ws.send(JSON.stringify(sub('ETHUSDT')));
    await sleep(5000);
    log('alt_url', { url, bookFrames: [...s.books.values()].reduce((a, st) => a + st.frames, 0), control: s.control, closed: s.closed });
    o.ws.close();
  }
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, deflate };
log('mode', { name: mode, at: new Date().toISOString() });
await modes[mode]();
await sleep(300);
process.exit(0);
