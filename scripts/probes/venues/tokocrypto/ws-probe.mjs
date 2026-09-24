// TokoCrypto WebSocket probe: the spot diff depth channel and its update id chain against a REST snapshot, the partial depth channel,
// level order, size unit, the same stream read from Binance's own socket, error replies, every documented endpoint,
// a batch of markets on one connection, server pings and silence, and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/tokocrypto/ws-probe.mjs [book|endpoints|batch|silence|deflate]
//   book       diff depth on BTCUSDT, ETHUSDT, ADAUSD1 and BTCIDR aligned to REST snapshots, depth20, bookTicker, referencePrice,
//              Binance's own BTCUSDT diff stream beside it, the 17 type 3 books on their own socket, and error cases. About 55 s.
//   endpoints  opens every documented and configured stream URL, subscribes one book and waits for data. About 45 s.
//   batch      diff depth at 100 ms on 200 USDT and USDC markets on one connection for 45 s.
//   silence    three sockets that differ in what they subscribe and whether they answer pings, for 100 s.
//   deflate    offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/tokocrypto/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const STREAM = 'wss://stream-cloud.tokocrypto.site/stream';
const STREAM_WEBAPP = 'wss://stream-cloud.binanceru.net/stream';
const NEXTME_STREAM = 'wss://stream-toko.2meta.app/stream';
const BINANCE_STREAM = 'wss://stream.binance.com:9443/stream';
const SITE = 'https://www.tokocrypto.site';
const TOKO = 'https://www.tokocrypto.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();
const since = () => Date.now() - t0;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url, opts = {}) {
  const started = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const s = { ws, url, started, openMs: undefined, frames: [], pings: [], closed: undefined };
  ws.on('upgrade', (res) => (s.extensions = res.headers['sec-websocket-extensions'] ?? null));
  ws.on('open', () => (s.openMs = Date.now() - started));
  ws.on('ping', () => s.pings.push(Date.now() - started));
  ws.on('close', (code, reason) => (s.closed = { code, reason: reason.toString(), atMs: Date.now() - started }));
  ws.on('error', (e) => (s.error = String(e.message ?? e)));
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => (s.refused = { status: res.statusCode, body: body.slice(0, 200) }));
  });
  return s;
}

const opened = (s, ms = 8000) =>
  new Promise((resolve) => {
    if (s.ws.readyState === WebSocket.OPEN) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    s.ws.once('open', () => (clearTimeout(timer), resolve(true)));
    s.ws.once('close', () => (clearTimeout(timer), resolve(false)));
    s.ws.once('error', () => (clearTimeout(timer), resolve(false)));
  });

const send = (s, obj) => s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));

async function rest(url) {
  const r = await fetch(url);
  return r.json();
}

// Local book per stream, aligned to a REST snapshot by the documented recipe.
function makeBook() {
  return { bids: new Map(), asks: new Map(), last: undefined, buffered: [], aligned: false, gaps: 0, applied: 0, dropped: 0 };
}
function applyLevels(map, levels) {
  for (const [p, q] of levels) {
    if (Number(q) === 0) map.delete(p);
    else map.set(p, q);
  }
}
function applyDiff(book, d) {
  if (!book.aligned) {
    book.buffered.push(d);
    return;
  }
  if (d.u <= book.last) {
    book.dropped++;
    return;
  }
  if (book.applied === 0) {
    if (!(d.U <= book.last + 1 && d.u >= book.last + 1)) book.gaps++;
  } else if (d.U !== book.last + 1) {
    book.gaps++;
  }
  applyLevels(book.bids, d.b);
  applyLevels(book.asks, d.a);
  book.last = d.u;
  book.applied++;
}
function align(book, snap) {
  for (const [p, q] of snap.bids) book.bids.set(p, q);
  for (const [p, q] of snap.asks) book.asks.set(p, q);
  book.last = snap.lastUpdateId;
  book.aligned = true;
  const pending = book.buffered;
  book.buffered = [];
  for (const d of pending) applyDiff(book, d);
}
const top = (map, desc, n) =>
  [...map.entries()].sort((a, b) => (desc ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]))).slice(0, n);

async function book() {
  const syms = ['btcusdt', 'ethusdt', 'adausd1', 'btcidr'];
  const a = open(STREAM);
  const bn = open(BINANCE_STREAM);
  const e = open(STREAM);
  const nx = open(NEXTME_STREAM);
  await Promise.all([opened(a), opened(bn), opened(e), opened(nx)]);
  log('open', { toko: a.openMs, binance: bn.openMs, tokoErrors: e.openMs, nextme: nx.openMs, refusedBinance: bn.refused, errBinance: bn.error });

  // The type 3 symbols live on a separate engine and socket.
  const catalog = await rest(`${TOKO}/open/v1/common/symbols`);
  const type3 = catalog.data.list.filter((x) => x.type === 3).map((x) => x.symbol.replace('_', '').toLowerCase());
  const nxFrames = {};
  let nxSample;
  nx.ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.stream) {
      nxFrames[m.stream] = (nxFrames[m.stream] ?? 0) + 1;
      nxSample ??= raw.toString().slice(0, 400);
    } else capture('nextme-acks.jsonl', raw.toString());
  });
  send(nx, { method: 'SUBSCRIBE', params: [...type3.map((x) => `${x}@depth@100ms`), ...type3.map((x) => `${x}@depth20@100ms`)], id: 1 });

  const books = Object.fromEntries(syms.map((s) => [s, makeBook()]));
  const per = {};
  const chain = {}; // U and u chain per stream, with or without a snapshot
  const unordered = { bids: 0, asks: 0, frames: 0 };
  const firstAt = {};
  const lastAt = {};
  const maxIdle = {};
  const tokoArrival = new Map();
  const bnArrival = new Map();
  const partial = { frames: 0, ids: [], levels: new Set(), sample: undefined };
  // A feed seeded by depth20 frames instead of REST: the partial frame resets the book, diffs chain onto its id.
  const seeded = { last: undefined, seeds: 0, stale: 0, straddle: 0, chained: 0, gaps: 0, diffIds: new Set(), idsOnDiffU: 0 };
  const bookTicker = { frames: 0, sample: undefined, repeats: 0, prev: undefined };
  const ref = { frames: 0, sample: undefined };
  const acks = [];
  const subSentAt = Date.now();

  a.ws.on('message', (raw) => {
    const now = Date.now();
    const m = JSON.parse(raw.toString());
    if (m.id !== undefined) {
      acks.push({ ms: now - subSentAt, m });
      capture('book-acks.jsonl', raw.toString());
      return;
    }
    const stream = m.stream;
    const d = m.data;
    per[stream] = (per[stream] ?? 0) + 1;
    if (firstAt[stream] === undefined) {
      firstAt[stream] = now - subSentAt;
      capture('book-first.jsonl', raw.toString().slice(0, 1500));
    }
    if (lastAt[stream] !== undefined) maxIdle[stream] = Math.max(maxIdle[stream] ?? 0, now - lastAt[stream]);
    lastAt[stream] = now;
    if (stream.endsWith('@depth@100ms')) {
      const sym = stream.split('@')[0];
      const c = (chain[sym] ??= { n: 0, breaks: 0, prevU: undefined, emptyFrames: 0, sameE: 0 });
      if (c.prevU !== undefined && d.U !== c.prevU + 1) c.breaks++;
      c.prevU = d.u;
      c.n++;
      if (d.b.length === 0 && d.a.length === 0) c.emptyFrames++;
      unordered.frames++;
      if (!d.b.every((x, i) => i === 0 || Number(x[0]) < Number(d.b[i - 1][0]))) unordered.bids++;
      if (!d.a.every((x, i) => i === 0 || Number(x[0]) > Number(d.a[i - 1][0]))) unordered.asks++;
      if (sym === 'btcusdt') {
        tokoArrival.set(d.u, now);
        seeded.diffIds.add(d.u);
        if (seeded.last !== undefined && d.u > seeded.last) {
          if (d.U === seeded.last + 1) seeded.chained++;
          else if (d.U <= seeded.last + 1) seeded.straddle++;
          else seeded.gaps++;
          seeded.last = d.u;
        }
      }
      applyDiff(books[sym], d);
      if (c.n === 2) capture('book-delta.jsonl', raw.toString().slice(0, 1500));
    } else if (stream.includes('@depth20')) {
      partial.frames++;
      partial.ids.push(d.lastUpdateId);
      partial.levels.add(`${d.bids.length}/${d.asks.length}`);
      partial.sample ??= { lastUpdateId: d.lastUpdateId, keys: Object.keys(d), bid0: d.bids[0], ask0: d.asks[0] };
      if (seeded.diffIds.has(d.lastUpdateId)) seeded.idsOnDiffU++;
      if (seeded.last === undefined || d.lastUpdateId > seeded.last) {
        seeded.last = d.lastUpdateId;
        seeded.seeds++;
      } else seeded.stale++;
    } else if (stream.endsWith('@bookTicker')) {
      bookTicker.frames++;
      bookTicker.sample ??= d;
      const key = `${d.b}|${d.B}|${d.a}|${d.A}`;
      if (key === bookTicker.prev) bookTicker.repeats++;
      bookTicker.prev = key;
    } else if (stream.endsWith('@referencePrice')) {
      ref.frames++;
      ref.sample ??= d;
    }
  });
  bn.ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.data?.u !== undefined) bnArrival.set(m.data.u, Date.now());
  });

  send(a, {
    method: 'SUBSCRIBE',
    params: [...syms.map((s) => `${s}@depth@100ms`), 'btcusdt@depth20@100ms', 'btcusdt@bookTicker', 'btcusdt@referencePrice'],
    id: 1,
  });
  send(bn, { method: 'SUBSCRIBE', params: ['btcusdt@depth@100ms'], id: 1 });

  // Error cases on their own socket.
  const errReplies = [];
  e.ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.stream) {
      errReplies.push({ ms: since(), dataFrom: m.stream });
      e.ws.removeAllListeners('message');
      e.ws.on('message', (r2) => {
        const m2 = JSON.parse(r2.toString());
        if (!m2.stream) errReplies.push({ ms: since(), reply: r2.toString().slice(0, 300) });
        else if (!errReplies.some((x) => x.dataFrom === m2.stream)) errReplies.push({ ms: since(), dataFrom: m2.stream });
      });
      return;
    }
    errReplies.push({ ms: since(), reply: text.slice(0, 300) });
    capture('book-errors.jsonl', text);
  });
  const errCases = [
    { method: 'SUBSCRIBE', params: ['nopeusdt@depth@100ms'], id: 11 },
    { method: 'SUBSCRIBE', params: ['BTC_USDT@depth@100ms'], id: 12 },
    { method: 'SUBSCRIBE', params: ['BTCUSDT@depth@100ms'], id: 13 },
    { method: 'SUBSCRIBE', params: ['btcusdt@depth@50ms'], id: 14 },
    { method: 'SUBSCRIBE', params: ['btcusdt@depth30'], id: 15 },
    { method: 'SUBSCRIBE', params: ['alchidr@depth@100ms'], id: 16 },
    { method: 'SUBSCRIBE', params: ['btcusdt@markPrice'], id: 17 },
    { method: 'SUBSCRIBE', params: ['btcusdt@depth@0ms'], id: 18 },
    { method: 'LIST_SUBSCRIPTIONS', id: 19 },
    { method: 'FOO', params: [], id: 20 },
    { method: 'SUBSCRIBE', params: ['btcusdt@trade'], id: 'abc' },
    'hello',
  ];
  for (const c of errCases) {
    send(e, c);
    await sleep(300);
  }

  // Snapshot after the diff stream has buffered for 2 s.
  await sleep(2000);
  const snapUrls = { btcusdt: 'BTCUSDT', ethusdt: 'ETHUSDT', adausd1: 'ADAUSD1', btcidr: 'BTCIDR' };
  const snaps = {};
  for (const [sym, up] of Object.entries(snapUrls)) {
    snaps[sym] = await rest(`${SITE}/api/v3/depth?symbol=${up}&limit=1000`);
    const bk = books[sym];
    log('snapshot', {
      sym,
      lastUpdateId: snaps[sym].lastUpdateId,
      buffered: bk.buffered.length,
      firstBufferedU: bk.buffered[0]?.U,
      lastBufferedU: bk.buffered.at(-1)?.u,
      levels: [snaps[sym].bids.length, snaps[sym].asks.length],
    });
    align(bk, snaps[sym]);
  }

  await sleep(40000);

  // Compare the maintained BTCUSDT and ADAUSD1 books with a fresh REST read.
  for (const [sym, up] of [['btcusdt', 'BTCUSDT'], ['adausd1', 'ADAUSD1'], ['btcidr', 'BTCIDR']]) {
    const bk = books[sym];
    const idAtRead = bk.last;
    const r = await rest(`${SITE}/api/v3/depth?symbol=${up}&limit=20`);
    const localBids = top(bk.bids, true, 20);
    const localAsks = top(bk.asks, false, 20);
    const eq = (loc, rem) => loc.filter(([p, q], i) => rem[i] && Number(rem[i][0]) === Number(p) && Number(rem[i][1]) === Number(q)).length;
    log('book compare', {
      sym,
      localId: idAtRead,
      restId: r.lastUpdateId,
      bidsEqual: eq(localBids, r.bids),
      asksEqual: eq(localAsks, r.asks),
      localTop: [localBids[0], localAsks[0]],
      restTop: [r.bids[0], r.asks[0]],
      localDepth: [bk.bids.size, bk.asks.size],
    });
  }

  for (const sym of syms) {
    const bk = books[sym];
    log('diff chain', { sym, frames: chain[sym]?.n ?? 0, breaksWithoutSnapshot: chain[sym]?.breaks, emptyFrames: chain[sym]?.emptyFrames, appliedAfterSnapshot: bk.applied, droppedOld: bk.dropped, gaps: bk.gaps, firstFrameMs: firstAt[`${sym}@depth@100ms`], maxIdleMs: maxIdle[`${sym}@depth@100ms`] });
  }
  const common = [...tokoArrival.keys()].filter((u) => bnArrival.has(u));
  const lead = common.map((u) => tokoArrival.get(u) - bnArrival.get(u)).sort((x, y) => x - y);
  log('vs binance', {
    tokoFrames: tokoArrival.size,
    binanceFrames: bnArrival.size,
    sameFinalId: common.length,
    tokoMinusBinanceMs: lead.length ? { min: lead[0], median: lead[Math.floor(lead.length / 2)], max: lead.at(-1) } : null,
  });
  log('streams', { frames: per, firstAtMs: firstAt, maxIdleMs: maxIdle });
  log('diff order', unordered);
  log('depth20', { frames: partial.frames, levels: [...partial.levels], idsMonotonic: partial.ids.every((x, i) => i === 0 || x >= partial.ids[i - 1]), repeatedIds: partial.ids.filter((x, i) => i > 0 && x === partial.ids[i - 1]).length, sample: partial.sample });
  log('depth20 seeded', { seeds: seeded.seeds, staleSeeds: seeded.stale, diffsChained: seeded.chained, diffsStraddling: seeded.straddle, gaps: seeded.gaps, partialIdsEqualToADiffU: seeded.idsOnDiffU });
  log('bookTicker', { frames: bookTicker.frames, repeats: bookTicker.repeats, sample: bookTicker.sample });
  log('referencePrice stream', ref);
  log('acks', { acks });
  log('errors', { replies: errReplies, closed: e.closed, pings: e.pings.length });
  log('nextme', { symbols: type3.length, streamsDelivering: Object.keys(nxFrames).length, frames: nxFrames, sample: nxSample, pings: nx.pings, closed: nx.closed });
  log('pings', { toko: a.pings, binance: bn.pings });
  for (const s of [a, bn, e, nx]) s.ws.terminate();
}

async function endpoints() {
  const cases = [
    [STREAM, ['btcusdt@depth@100ms']],
    ['wss://stream-cloud.tokocrypto.site/ws', ['btcusdt@depth@100ms']],
    ['wss://stream-cloud.tokocrypto.site/stream?streams=btcusdt@depth20@100ms', []],
    ['wss://stream-cloud.tokocrypto.site/stream/ws/btcusdt@depth', []],
    ['wss://stream-cloud.tokocrypto.site/ws/btcusdt@depth', []],
    [STREAM_WEBAPP, ['btcusdt@depth@100ms']],
    [NEXTME_STREAM, ['alchidr@depth@100ms', 'nbtusdt@depth@100ms', 'velousdt@depth20@100ms']],
    [NEXTME_STREAM, ['btcusdt@depth@100ms']],
    ['wss://www.tokocrypto.com', ['btcusdt@depth@100ms']],
    ['wss://www.tokocrypto.com/stream', ['btcusdt@depth@100ms']],
  ];
  for (const [url, params] of cases) {
    const s = open(url);
    const ok = await opened(s);
    const got = [];
    s.ws.on('message', (raw) => {
      if (got.length < 4) got.push({ ms: Date.now() - s.started, text: raw.toString().slice(0, 220) });
      if (got.length === 1) capture('endpoints.jsonl', `${url} ${raw.toString().slice(0, 1500)}`);
    });
    if (ok && params.length) send(s, { method: 'SUBSCRIBE', params, id: 1 });
    await sleep(ok ? 4000 : 500);
    log('endpoint', { url, params, opened: ok, openMs: s.openMs, refused: s.refused, error: s.error, closed: s.closed, frames: got });
    s.ws.terminate();
  }
}

async function batch() {
  const sym = await rest(`${TOKO}/open/v1/common/symbols`);
  const list = sym.data.list.filter((x) => x.type === 1 && (x.quoteAsset === 'USDT' || x.quoteAsset === 'USDC')).map((x) => x.symbol.replace('_', '').toLowerCase());
  const pick = list.filter((_, i) => i % 3 === 0).slice(0, 200);
  const s = open(STREAM);
  await opened(s);
  const chain = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let gaps = 0;
  const acks = [];
  const perSecond = [];
  let secCount = 0;
  const tick = setInterval(() => (perSecond.push(secCount), (secCount = 0)), 1000);
  const seen = new Set();
  const sentAt = Date.now();
  s.ws.on('message', (raw) => {
    const p0 = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - p0;
    if (m.id !== undefined) {
      acks.push({ ms: Date.now() - sentAt, m });
      return;
    }
    frames++;
    secCount++;
    bytes += raw.length;
    const d = m.data;
    seen.add(d.s);
    const prev = chain.get(d.s);
    if (prev !== undefined && d.U !== prev + 1) gaps++;
    chain.set(d.s, d.u);
  });
  const params = pick.map((x) => `${x}@depth@100ms`);
  // One frame of 100, then two of 50, to see whether a large frame is accepted.
  send(s, { method: 'SUBSCRIBE', params: params.slice(0, 100), id: 1 });
  await sleep(300);
  send(s, { method: 'SUBSCRIBE', params: params.slice(100, 150), id: 2 });
  await sleep(300);
  send(s, { method: 'SUBSCRIBE', params: params.slice(150), id: 3 });
  await sleep(45000);
  clearInterval(tick);
  const ps = perSecond.slice(2).sort((x, y) => x - y);
  log('batch', {
    streams: params.length,
    streamsDelivering: seen.size,
    frames,
    perSecond: { median: ps[Math.floor(ps.length / 2)], max: ps.at(-1), min: ps[0] },
    bytesPerSecond: Math.round(bytes / 45),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000,
    gaps,
    acks,
    closed: s.closed,
    pings: s.pings,
  });
  s.ws.terminate();
}

async function silence() {
  const bare = open(STREAM);
  const quiet = open(STREAM);
  const noPong = open(STREAM, { autoPong: false });
  await Promise.all([opened(bare), opened(quiet), opened(noPong)]);
  const counts = { quiet: 0, noPong: 0 };
  quiet.ws.on('message', () => counts.quiet++);
  noPong.ws.on('message', () => counts.noPong++);
  send(quiet, { method: 'SUBSCRIBE', params: ['adausd1@depth@100ms'], id: 1 });
  send(noPong, { method: 'SUBSCRIBE', params: ['adausd1@depth@100ms'], id: 1 });
  const pingPayload = [];
  bare.ws.on('ping', (data) => pingPayload.length < 2 && pingPayload.push(data.toString()));
  await sleep(100000);
  for (const [name, s] of [['bare', bare], ['quiet', quiet], ['noPong', noPong]]) {
    log('silence', { name, openMs: s.openMs, pingsAtMs: s.pings, closed: s.closed ?? 'open at 100 s', frames: counts[name] });
    s.ws.terminate();
  }
  log('ping payload', { pingPayload });
}

async function deflate() {
  const s = open(STREAM, { perMessageDeflate: true });
  await opened(s);
  let first;
  s.ws.on('message', (raw) => (first ??= raw.toString().slice(0, 120)));
  send(s, { method: 'SUBSCRIBE', params: ['btcusdt@depth@100ms'], id: 1 });
  await sleep(2000);
  log('deflate', { offered: true, negotiated: s.extensions, first });
  s.ws.terminate();
  const n = open(NEXTME_STREAM, { perMessageDeflate: true });
  await opened(n);
  log('deflate nextme', { offered: true, negotiated: n.extensions, openMs: n.openMs });
  n.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, endpoints, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`mode is one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
