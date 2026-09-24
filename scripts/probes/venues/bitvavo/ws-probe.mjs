// Bitvavo WebSocket probe: the spot book channel and its nonce chain against a getBook snapshot, level order, size unit,
// the ticker channel, error replies, every trading market on one connection, keepalive and silence, deflate, and the
// Market Data Pro socket's answer to an unauthenticated client.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Every subscribe and getBook costs one weight point of the 1,000 per minute an unauthenticated IP gets, and each mode spends under 30.
// Run from server/: node ../scripts/probes/venues/bitvavo/ws-probe.mjs [book|batch|session|deflate|mdpro|snapshot]
//   book     book on four EUR markets plus a getBook snapshot each, ticker on BTC-EUR, error cases, then a REST book compare. About 65 s.
//   batch    book on every trading market in one subscribe frame for 45 s.
//   session  four sockets that differ only in what the client subscribes and sends, for up to 100 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
//   mdpro    subscribes and asks for a book on wss://ws-mdpro.bitvavo.com/v2/ without authenticating. About 8 s.
//   snapshot prints one untrimmed getBook reply of three levels per side for BTC-EUR. About 2 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/bitvavo/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.bitvavo.com/v2/';
const MDPRO_URL = 'wss://ws-mdpro.bitvavo.com/v2/';
const API = 'https://api.bitvavo.com/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const round = (x) => Math.round(x);
const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const captured = {};

// Keeps the first few frames of each kind, trimmed to 600 characters.
function capture(kind, text) {
  if (!OUT) return;
  captured[kind] = (captured[kind] ?? 0) + 1;
  if (captured[kind] > 5) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, 'frames.txt'), `${kind}\t${text.slice(0, 600)}\n`);
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: round(performance.now() - t0) }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`handshake ${res.statusCode}`)));
  });
}

function send(ws, obj) {
  ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

async function restBook(market, depth) {
  const res = await fetch(`${API}/${market}/book?depth=${depth}`);
  return res.json();
}

const isDesc = (side) => side.every((l, i) => i === 0 || Number(l[0]) < Number(side[i - 1][0]));
const isAsc = (side) => side.every((l, i) => i === 0 || Number(l[0]) > Number(side[i - 1][0]));

async function book() {
  const MARKETS = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'FUN-EUR'];
  const { ws, openMs } = await open(WS_URL);
  log('open', { url: WS_URL, openMs });
  const st = Object.fromEntries(MARKETS.map((m) => [m, {
    events: 0, firstEvent: null, snapshot: null, buffered: 0, last: null, gaps: [], steps: {}, emptyDeltas: 0,
    bidsUnordered: 0, asksUnordered: 0, maxLevelsInEvent: 0, lagMs: [], arrivals: [], bids: new Map(), asks: new Map(), repeats: 0, prevText: null,
  }]));
  const other = [];
  let tickers = 0;
  let firstTicker = null;
  const tickerShapes = {};
  let subSentAt = 0;

  ws.on('message', (data) => {
    const now = Date.now();
    const text = data.toString();
    const f = JSON.parse(text);
    if (f.event === 'book' && f.market && f.nonce !== undefined) {
      const s = st[f.market];
      if (!s) return other.push({ kind: 'book_other_market', market: f.market });
      capture('book_event', text);
      s.events++;
      s.arrivals.push(now);
      s.lagMs.push(now - f.timestamp / 1e6);
      if (!s.firstEvent) s.firstEvent = { nonce: f.nonce, bids: f.bids.length, asks: f.asks.length, msAfterSubscribe: now - subSentAt, keys: Object.keys(f) };
      const body = JSON.stringify([f.bids, f.asks]);
      if (body === s.prevText) s.repeats++;
      s.prevText = body;
      if (f.bids.length === 0 && f.asks.length === 0) s.emptyDeltas++;
      for (const [p, q] of [...f.bids, ...f.asks]) {
        s.levels = (s.levels ?? 0) + 1;
        if (String(Number(p)) !== p) s.paddedPrices = (s.paddedPrices ?? 0) + 1;
        if (Number(q) !== 0 && String(Number(q)) !== q) s.paddedSizes = (s.paddedSizes ?? 0) + 1;
      }
      for (const side of [f.bids, f.asks]) {
        const prices = side.map((l) => Number(l[0]));
        if (new Set(prices).size !== prices.length) {
          s.dupPriceEvents = (s.dupPriceEvents ?? 0) + 1;
          if (!s.dupSample) s.dupSample = { nonce: f.nonce, side: side === f.bids ? 'bids' : 'asks', levels: side.filter((l) => prices.filter((x) => x === Number(l[0])).length > 1).slice(0, 6) };
        }
      }
      if (!isDesc(f.bids)) s.bidsUnordered++;
      if (!isAsc(f.asks)) s.asksUnordered++;
      s.maxLevelsInEvent = Math.max(s.maxLevelsInEvent, f.bids.length + f.asks.length);
      if (s.last !== null) {
        const step = f.nonce - s.last;
        s.steps[step] = (s.steps[step] ?? 0) + 1;
        if (step !== 1) s.gaps.push([s.last, f.nonce]);
      }
      s.last = f.nonce;
      if (!s.snapshot) {
        s.buffered++;
        (s.pending ??= []).push(f);
        return;
      }
      if (f.nonce > s.snapshot.nonce) applyLevels(s, f);
      return;
    }
    if (f.action === 'getBook' && f.response) {
      const r = f.response;
      const s = st[r.market];
      capture('getBook_response', text);
      if (!s) return other.push({ kind: 'getBook_other', market: r.market });
      const lv = [...r.bids, ...r.asks];
      s.snapshotPadded = lv.filter(([p, q]) => String(Number(p)) !== p || String(Number(q)) !== q).length;
      s.snapshot = { nonce: r.nonce, bids: r.bids.length, asks: r.asks.length, msAfterSubscribe: now - subSentAt, bidsDesc: isDesc(r.bids), asksAsc: isAsc(r.asks), keys: Object.keys(r), requestId: f.requestId };
      for (const [p, q] of r.bids) s.bids.set(Number(p), [q, 'snapshot']);
      for (const [p, q] of r.asks) s.asks.set(Number(p), [q, 'snapshot']);
      s.snapshot.bufferedBefore = s.buffered;
      s.snapshot.bufferedNonces = (s.pending ?? []).map((x) => x.nonce);
      for (const e of s.pending ?? []) if (e.nonce > r.nonce) applyLevels(s, e);
      s.pending = [];
      return;
    }
    if (f.event === 'ticker') {
      tickers++;
      if (!firstTicker) firstTicker = f;
      const shape = Object.keys(f).filter((k) => k !== 'event' && k !== 'market').join(',');
      tickerShapes[shape] = (tickerShapes[shape] ?? 0) + 1;
      capture('ticker', text);
      return;
    }
    capture(`other_${f.event ?? f.action ?? 'unknown'}`, text);
    other.push({ at: now - subSentAt, frame: text.slice(0, 300) });
  });
  ws.on('ping', () => other.push({ kind: 'server_ping' }));
  ws.on('close', (code, reason) => other.push({ kind: 'close', code, reason: reason.toString() }));

  subSentAt = Date.now();
  send(ws, { action: 'subscribe', channels: [{ name: 'book', markets: MARKETS }] });
  let rid = 1;
  for (const m of MARKETS) send(ws, { action: 'getBook', requestId: rid++, market: m });
  send(ws, { action: 'subscribe', channels: [{ name: 'ticker', markets: ['BTC-EUR'] }] });
  await sleep(5_000);
  log('initial_replies', { replies: other.map((x) => x.frame ?? x) });

  const errs = [
    { action: 'subscribe', channels: [{ name: 'book', markets: ['NOPE-EUR'] }] },
    { action: 'subscribe', channels: [{ name: 'book', markets: ['btc-eur'] }] },
    { action: 'subscribe', channels: [{ name: 'book', markets: ['WMTX-EUR'] }] },
    { action: 'subscribe', channels: [{ name: 'nope', markets: ['BTC-EUR'] }] },
    { action: 'subscribe', channels: [{ name: 'book', markets: ['BTC-EUR'] }] },
    { action: 'getBook', requestId: 90, market: 'NOPE-EUR' },
    { action: 'getBook', requestId: 91, market: 'WMTX-EUR' },
    { action: 'getBook', requestId: 92, market: 'BTC-EUR', depth: 5000 },
    { action: 'nope' },
    'not json',
  ];
  for (const e of errs) {
    const at = other.length;
    send(ws, e);
    await sleep(700);
    log('error_case', { sent: typeof e === 'string' ? e : e, replies: other.slice(at).map((x) => x.frame ?? x) });
  }

  await sleep(50_000);
  // Compare each maintained book against a REST read of 25 levels, level by level at the same price.
  for (const m of MARKETS.slice(0, 3)) {
    const rest = await restBook(m, 25);
    const x = st[m];
    const bids = [...x.bids].sort((a, b) => b[0] - a[0]);
    const asks = [...x.asks].sort((a, b) => a[0] - b[0]);
    // The wire pads delta prices and sizes with trailing zeros and the snapshot does not, so both are compared as numbers.
    const same = (side, loc) => side.filter(([p, q]) => Number(loc.get(Number(p))?.[0]) === Number(q)).length;
    const bestAsk = Number(rest.asks[0][0]);
    const bestBid = Number(rest.bids[0][0]);
    log('rest_compare', {
      market: m, restNonce: rest.nonce, wsNonce: x.last, sameBidsOf25: same(rest.bids, x.bids), sameAsksOf25: same(rest.asks, x.asks),
      restTop: [rest.bids[0], rest.asks[0]], localTop: [bids[0], asks[0]], localLevels: [x.bids.size, x.asks.size],
      crossedLocalBids: bids.filter(([p]) => p >= bestAsk).slice(0, 5), crossedLocalAsks: asks.filter(([p]) => p <= bestBid).slice(0, 5),
    });
  }
  ws.close();
  await sleep(300);

  for (const [m, x] of Object.entries(st)) {
    const gapsMs = x.arrivals.slice(1).map((t, i) => t - x.arrivals[i]);
    log('book_summary', {
      market: m, events: x.events, firstEvent: x.firstEvent, snapshot: x.snapshot, steps: x.steps, gaps: x.gaps.slice(0, 5), gapCount: x.gaps.length,
      deltaLevels: x.levels ?? 0, paddedPrices: x.paddedPrices ?? 0, paddedSizes: x.paddedSizes ?? 0, snapshotPadded: x.snapshotPadded,
      emptyDeltas: x.emptyDeltas, dupPriceEvents: x.dupPriceEvents ?? 0, dupSample: x.dupSample, bidsUnordered: x.bidsUnordered, asksUnordered: x.asksUnordered, maxLevelsInEvent: x.maxLevelsInEvent, repeats: x.repeats,
      interArrivalMs: { min: pct(gapsMs, 0), p10: pct(gapsMs, 10), median: pct(gapsMs, 50), max: gapsMs.length ? Math.max(...gapsMs) : null },
      lagMs: { min: pct(x.lagMs, 0), median: round(pct(x.lagMs, 50) ?? 0), p90: round(pct(x.lagMs, 90) ?? 0) },
    });
  }
  log('ticker_summary', { frames: tickers, first: firstTicker, shapes: tickerShapes });
  log('other', { frames: other.filter((x) => x.kind === 'server_ping' || x.kind === 'close') });
}

// Levels are keyed by numeric price and remember which frame set them, so a stale level can be traced.
function applyLevels(s, f) {
  for (const [p, q] of f.bids) Number(q) === 0 ? s.bids.delete(Number(p)) : s.bids.set(Number(p), [q, f.nonce]);
  for (const [p, q] of f.asks) Number(q) === 0 ? s.asks.delete(Number(p)) : s.asks.set(Number(p), [q, f.nonce]);
}

async function batch() {
  const markets = (await (await fetch(`${API}/markets`)).json()).filter((m) => m.status === 'trading').map((m) => m.market);
  const { ws, openMs } = await open(WS_URL);
  log('open', { url: WS_URL, openMs, markets: markets.length });
  const last = new Map();
  const lastAt = new Map();
  const maxSilence = new Map();
  let frames = 0;
  let bytes = 0;
  let gaps = 0;
  let parseUs = 0;
  let ack = null;
  const perSecond = new Map();
  const t0 = Date.now();
  let sentAt = 0;
  ws.on('message', (data) => {
    const now = Date.now();
    const p0 = performance.now();
    const f = JSON.parse(data.toString());
    parseUs += (performance.now() - p0) * 1000;
    if (f.event === 'subscribed') {
      ack = { msAfterSend: now - sentAt, channels: Object.keys(f.subscriptions ?? {}), book: f.subscriptions?.book?.length };
      return;
    }
    if (f.event !== 'book') return;
    frames++;
    bytes += data.length;
    const sec = Math.floor((now - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const prev = last.get(f.market);
    if (prev !== undefined && f.nonce !== prev + 1) gaps++;
    last.set(f.market, f.nonce);
    const pa = lastAt.get(f.market);
    if (pa !== undefined) maxSilence.set(f.market, Math.max(maxSilence.get(f.market) ?? 0, now - pa));
    lastAt.set(f.market, now);
  });
  sentAt = Date.now();
  send(ws, { action: 'subscribe', channels: [{ name: 'book', markets }] });
  await sleep(45_000);
  ws.close();
  const secs = [...perSecond.values()];
  const silent = markets.filter((m) => !last.has(m));
  const silences = [...maxSilence.values()];
  log('batch', {
    markets: markets.length, ack, frames, framesPerSecond: { mean: round(frames / 45), median: pct(secs, 50), max: Math.max(...secs) },
    kbPerSecond: round(bytes / 45 / 1024), bytesPerFrame: round(bytes / frames), parseUsPerFrame: +(parseUs / frames).toFixed(1),
    marketsWithFrames: last.size, marketsSilent45s: silent.length, silentSample: silent.slice(0, 10), nonceGaps: gaps,
    longestSilenceMs: { median: pct(silences, 50), max: silences.length ? Math.max(...silences) : null },
  });
}

async function session() {
  const QUIET = process.env.QUIET_MARKET ?? 'FUN-EUR';
  const cases = [
    { id: 'idle', subscribe: null, pingMs: 0 },
    { id: 'book_quiet', subscribe: { name: 'book', markets: [QUIET] }, pingMs: 0 },
    { id: 'idle_protocol_ping_20s', subscribe: null, pingMs: 20_000 },
    { id: 'idle_getTime_30s', subscribe: null, appMs: 30_000 },
  ];
  const results = await Promise.all(cases.map(async (c) => {
    const { ws, openMs } = await open(WS_URL);
    const t0 = Date.now();
    const r = { id: c.id, openMs, frames: 0, serverPings: 0, pongs: 0, appReplies: 0, closedAt: null, code: null, lastFrameAt: null, sample: null };
    ws.on('message', (d) => {
      r.frames++;
      r.lastFrameAt = Date.now() - t0;
      const f = JSON.parse(d.toString());
      if (f.action === 'getTime') {
        r.appReplies++;
        r.sample ??= d.toString().slice(0, 200);
      }
    });
    ws.on('ping', (payload) => {
      r.serverPings++;
      (r.pingAtMs ??= []).push(Date.now() - t0);
      r.pingPayload ??= payload.toString();
    });
    ws.on('pong', () => r.pongs++);
    const timers = [];
    if (c.subscribe) send(ws, { action: 'subscribe', channels: [c.subscribe] });
    if (c.pingMs) timers.push(setInterval(() => ws.ping(), c.pingMs));
    if (c.appMs) timers.push(setInterval(() => send(ws, { action: 'getTime' }), c.appMs));
    await new Promise((resolve) => {
      const stop = setTimeout(resolve, 100_000);
      ws.on('close', (code) => {
        r.closedAt = Date.now() - t0;
        r.code = code;
        clearTimeout(stop);
        resolve();
      });
    });
    timers.forEach(clearInterval);
    if (ws.readyState === ws.OPEN) ws.close();
    return r;
  }));
  for (const r of results) log('session', r);
}

async function deflate() {
  const { ws, openMs } = await open(WS_URL, { deflate: true });
  log('deflate', { openMs, negotiated: ws.extensions || '(none)' });
  ws.close();
}

async function mdpro() {
  let conn;
  try {
    conn = await open(MDPRO_URL);
  } catch (e) {
    log('mdpro_open_failed', { error: e.message });
    return;
  }
  const { ws, openMs } = conn;
  const replies = [];
  ws.on('message', (d) => replies.push(d.toString().slice(0, 300)));
  ws.on('close', (code, reason) => replies.push(`close ${code} ${reason}`));
  send(ws, { action: 'subscribe', channels: [{ name: 'book', markets: ['BTC-EUR'] }] });
  await sleep(3_000);
  send(ws, { action: 'getBook', requestId: 1, market: 'BTC-EUR', depth: 5 });
  await sleep(3_000);
  log('mdpro', { openMs, replies: replies.slice(0, 6), replyCount: replies.length });
  if (ws.readyState === ws.OPEN) ws.close();
}

async function snapshot() {
  const { ws, openMs } = await open(WS_URL);
  const reply = new Promise((resolve) => ws.once('message', (d) => resolve(d.toString())));
  send(ws, { action: 'getBook', requestId: 1, market: 'BTC-EUR', depth: 3 });
  log('snapshot', { openMs, reply: await reply });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const t = Date.now();
log('start', { mode, utc: new Date().toISOString() });
await ({ book, batch, session, deflate, mdpro, snapshot })[mode]();
log('end', { mode, seconds: Math.round((Date.now() - t) / 1000) });
