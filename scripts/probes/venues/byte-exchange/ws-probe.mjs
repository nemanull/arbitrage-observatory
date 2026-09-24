// Byte Exchange (bexc.io) spot WebSocket probe: the Origin gate, the book frame and its update id, level order, the default broadcast, unsubscribe, error replies, keepalive and silence, and a batch of spot markets on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, and send the Origin the bexc.io web client sends, since the server refuses a handshake without it.
// Run from server/: node ../scripts/probes/venues/byte-exchange/ws-probe.mjs [origin|book|silence|batch|ratelimit]
//   origin   handshakes without Origin, with a foreign Origin, with https://bexc.io on both hosts, and one that offers permessage-deflate. About 10 s.
//   book     four spot books for 70 s with a REST compare, unsubscribe, and one bad request at a time. About 75 s.
//   silence  four sockets that differ only in what the client sends or subscribes, for up to 120 s.
//   batch    the ten default books dropped, then the top 30 spot markets by 24 h quote volume, the per connection cap, at SUB_SPACING_MS apart (default 200), for 60 s.
//   ratelimit  three sockets: a burst of 12, the defaults unsubscribed then 31 at 150 ms, the defaults unsubscribed then 20 at 50 ms. About 40 s.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/byte-exchange/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://engine-v3.bexc.io/ws';
const WS_URL_API = 'wss://api.bexc.io/ws';
const ORIGIN = 'https://bexc.io';
const API = 'https://api.bexc.io/api/v1';
// Pushed to every new socket without a subscribe, and counted against the per connection cap of 30.
const DEFAULT_BOOKS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'BNB_USDT', 'DOGE_USDT', 'ADA_USDT', 'DOT_USDT', 'AVAX_USDT', 'LINK_USDT'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const count = (xs, f) => xs.reduce((o, x) => ((o[f(x)] = (o[f(x)] ?? 0) + 1), o), {});
const stats = (xs) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url, { origin = ORIGIN, deflate = false, autoPong = true } = {}) {
  const headers = origin ? { Origin: origin } : {};
  return new WebSocket(url, { perMessageDeflate: deflate, headers, autoPong });
}

// Book and ticker frames arrive as binary raw deflate inside the WebSocket frame, trades and candles as text.
function decode(data, isBinary) {
  const t = process.hrtime.bigint();
  const text = isBinary ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { text, json, us: Number(process.hrtime.bigint() - t) / 1000, wire: data.length, plain: text.length };
}

async function handshake(label, url, opts) {
  const t0 = Date.now();
  const ws = open(url, opts);
  let finished = false;
  return new Promise((resolve) => {
    const done = (obj) => {
      if (finished) return;
      finished = true;
      log('handshake', { label, url, ...obj });
      try {
        ws.terminate();
      } catch {}
      resolve();
    };
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => done({ status: res.statusCode, body: body.slice(0, 120), ms: Date.now() - t0 }));
    });
    ws.on('upgrade', (res) => log('upgrade', { label, status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, ms: Date.now() - t0 }));
    ws.on('message', (data, isBinary) => {
      const d = decode(data, isBinary);
      done({ status: 101, firstFrame: { binary: isBinary, type: d.json?.type, symbol: d.json?.symbol, wire: d.wire, plain: d.plain }, negotiated: ws.extensions || null, ms: Date.now() - t0 });
    });
    ws.on('error', (e) => log('handshake_error', { label, message: e.message }));
    setTimeout(() => done({ timeout: true }), 5000);
  });
}

async function origin() {
  await handshake('no origin', WS_URL, { origin: null });
  await handshake('foreign origin', WS_URL, { origin: 'https://example.com' });
  await handshake('web origin', WS_URL, {});
  await handshake('web origin, api host', WS_URL_API, {});
  await handshake('web origin, deflate offered', WS_URL, { deflate: true });
}

function newBookStats() {
  return { n: 0, zeroQty: 0, dupFrames: 0, dupLevels: 0, firstMs: null, snapshotKey: {}, firstFrameKeys: null, gaps: [], idSteps: {}, bids: [], asks: [], badOrder: 0, crossed: 0, oneSided: 0, empty: 0, repeats: 0, orderCounts: {}, last: null, lastKey: null, ring: new Map() };
}

function trackBook(st, j, now, t0) {
  st.n++;
  if (st.firstMs === null) {
    st.firstMs = now - t0;
    st.firstFrameKeys = Object.keys(j).join(',');
  }
  const sk = String(j.snapshot);
  st.snapshotKey[sk] = (st.snapshotKey[sk] ?? 0) + 1;
  if (st.last !== null) {
    st.gaps.push(now - st.lastAt);
    const step = j.update_id - st.last;
    const k = step === 1 ? '1' : step > 1 ? '>1' : step === 0 ? '0' : '<0';
    st.idSteps[k] = (st.idSteps[k] ?? 0) + 1;
  }
  st.last = j.update_id;
  st.lastAt = now;
  st.bids.push(j.bids.length);
  st.asks.push(j.asks.length);
  const b = j.bids.map((l) => Number(l.price));
  const a = j.asks.map((l) => Number(l.price));
  // A repeated price is counted apart from an inversion, because the REST book showed two levels at one price.
  const dupes = b.filter((p, i) => i > 0 && p === b[i - 1]).length + a.filter((p, i) => i > 0 && p === a[i - 1]).length;
  const inversions = b.filter((p, i) => i > 0 && p > b[i - 1]).length + a.filter((p, i) => i > 0 && p < a[i - 1]).length;
  if (dupes > 0) {
    st.dupFrames++;
    st.dupLevels += dupes;
    if (st.dupFrames <= 1) {
      const bi = b.findIndex((p, i) => i > 0 && p === b[i - 1]);
      const ai = a.findIndex((p, i) => i > 0 && p === a[i - 1]);
      log('repeated_price_frame', { sym: j.symbol, update_id: j.update_id, bids: bi > 0 ? j.bids.slice(bi - 1, bi + 1) : null, asks: ai > 0 ? j.asks.slice(ai - 1, ai + 1) : null });
    }
  }
  if (inversions > 0) {
    st.badOrder++;
    if (st.badOrder <= 2) log('inverted_frame', { sym: j.symbol, update_id: j.update_id, inversions });
  }
  if (b.length && a.length && b[0] >= a[0]) st.crossed++;
  if (b.length === 0 && a.length === 0) st.empty++;
  else if (b.length === 0 || a.length === 0) st.oneSided++;
  const key = JSON.stringify([j.bids, j.asks]);
  if (key === st.lastKey) st.repeats++;
  st.lastKey = key;
  for (const l of [...j.bids, ...j.asks]) {
    st.orderCounts[l.order_count] = (st.orderCounts[l.order_count] ?? 0) + 1;
    if (Number(l.quantity) === 0) st.zeroQty++;
  }
  st.ring.set(j.update_id, j);
  if (st.ring.size > 200) st.ring.delete(st.ring.keys().next().value);
}

function summary(sym, st) {
  return {
    sym,
    frames: st.n,
    firstMs: st.firstMs,
    firstFrameKeys: st.firstFrameKeys,
    snapshotField: st.snapshotKey,
    interArrivalMs: stats(st.gaps),
    gapsOver300Ms: stats(st.gaps.filter((g) => g > 300)),
    idSteps: st.idSteps,
    bids: stats(st.bids),
    asks: stats(st.asks),
    badOrder: st.badOrder,
    framesWithRepeatedPrice: st.dupFrames,
    repeatedPriceLevels: st.dupLevels,
    crossed: st.crossed,
    oneSided: st.oneSided,
    empty: st.empty,
    identicalToPrevious: st.repeats,
    zeroQuantityLevels: st.zeroQty,
    orderCounts: st.orderCounts,
  };
}

async function book() {
  const SUBS = ['BTC_USDT', 'TRX_USDT', 'ALLO_USDT', 'EUL_USDC'];
  const t0 = Date.now();
  const ws = open(WS_URL);
  const books = new Map();
  const types = {};
  const other = [];
  const inflateUs = [];
  const wire = {};
  const tickerGaps = [];
  let lastTicker = null;
  const tradeLagMs = [];
  let protocolPings = 0;
  let lastSent = 'none';
  const firstOfType = new Set();
  ws.on('ping', () => protocolPings++);
  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    const d = decode(data, isBinary);
    const j = d.json;
    const type = j?.type ?? 'nonjson';
    const tk = `${isBinary ? 'bin' : 'txt'}:${type}`;
    types[tk] = (types[tk] ?? 0) + 1;
    wire[tk] = (wire[tk] ?? 0) + d.wire;
    if (isBinary) inflateUs.push(d.us);
    // Book frames are trimmed to three levels a side and ticker frames to three rows, so every captured line stays valid JSON.
    const firstBookDelta = type === 'book_update' && j.symbol === 'BTC_USDT' && j.snapshot === undefined && !firstOfType.has('btc-later');
    if (!firstOfType.has(tk) || firstBookDelta) {
      firstOfType.add(firstBookDelta ? 'btc-later' : tk);
      let shown = j;
      if (type === 'book_update') shown = { ...j, asks: j.asks.slice(0, 3), bids: j.bids.slice(0, 3) };
      if (type === 'ticker_update') shown = { ...j, tickers: j.tickers.slice(0, 3) };
      const levels = type === 'book_update' ? ` levels ${j.bids.length}/${j.asks.length}` : '';
      capture('ws-book-first-frames.txt', `${now - t0} ${tk} wire ${d.wire} plain ${d.plain}${levels} ${shown ? JSON.stringify(shown) : d.text}`);
    }
    if (type === 'book_update') {
      if (!books.has(j.symbol)) books.set(j.symbol, newBookStats());
      trackBook(books.get(j.symbol), j, now, t0);
    } else if (type === 'ticker_update') {
      if (lastTicker !== null) tickerGaps.push(now - lastTicker);
      lastTicker = now;
    } else if (type === 'trade_update') {
      tradeLagMs.push(now - Date.parse(j.timestamp));
    } else if (type !== 'candle_update') {
      other.push({ ms: now - t0, after: lastSent, binary: isBinary, text: d.text.slice(0, 200) });
    }
  });
  ws.on('close', (code, reason) => log('close', { ms: Date.now() - t0, code, reason: reason.toString() }));
  await new Promise((r) => ws.on('open', r));
  log('open', { ms: Date.now() - t0 });
  const subAt = Date.now();
  for (const s of SUBS) ws.send(JSON.stringify({ action: 'subscribe', symbol: s }));
  capture('ws-book-first-frames.txt', `subscribe frame ${JSON.stringify({ action: 'subscribe', symbol: SUBS[0] })}`);
  log('subscribed', { symbols: SUBS, at: subAt - t0 });

  await sleep(30_000);
  // Compare the REST book with the WebSocket frame that carries the same update id.
  for (const s of ['BTC_USDT', 'TRX_USDT', 'ALLO_USDT']) {
    const rest = await (await fetch(`${API}/orderbook/${s}?n=${Date.now()}`)).json();
    const st = books.get(s);
    const frame = st?.ring.get(rest.last_update_id);
    const lvl = (x) => `${x.price}@${x.quantity}`;
    if (frame) {
      const same = (side) => rest[side].filter((l, i) => frame[side][i] && lvl(frame[side][i]) === lvl(l)).length;
      log('rest_compare', { sym: s, update_id: rest.last_update_id, matchedFrame: true, bidsEqual: `${same('bids')}/${rest.bids.length}`, asksEqual: `${same('asks')}/${rest.asks.length}`, wsLevels: `${frame.bids.length}/${frame.asks.length}` });
    } else {
      log('rest_compare', { sym: s, update_id: rest.last_update_id, matchedFrame: false, wsLast: st?.last, ringFrom: st ? [...st.ring.keys()][0] : null });
    }
    await sleep(300);
  }

  await sleep(5_000);
  const before = Object.fromEntries(['BTC_USDT', 'TRX_USDT'].map((s) => [s, books.get(s)?.n ?? 0]));
  for (const s of ['BTC_USDT', 'TRX_USDT']) ws.send(JSON.stringify({ action: 'unsubscribe', symbol: s }));
  lastSent = 'unsubscribe BTC_USDT and TRX_USDT';
  await sleep(2_000);
  const mid = Object.fromEntries(['BTC_USDT', 'TRX_USDT'].map((s) => [s, books.get(s)?.n ?? 0]));
  await sleep(8_000);
  const after = Object.fromEntries(['BTC_USDT', 'TRX_USDT'].map((s) => [s, books.get(s)?.n ?? 0]));
  log('unsubscribe', { framesBefore: before, twoSecondsLater: mid, tenSecondsLater: after });

  const bad = [
    'not json',
    '{"action":"nope"}',
    '{"action":"subscribe"}',
    '{"action":"subscribe","symbol":"BTC-USDT"}',
    '{"action":"subscribe","symbol":"btc_usdt"}',
    '{"action":"subscribe","symbol":"NOPE_USDT"}',
    '{"action":"subscribe","symbol":"ALLO_USDT"}',
    '{"action":"subscribe","symbols":["SUI_USDT"]}',
    '{"action":"ping"}',
    '{"type":"ping"}',
    '{"op":"ping"}',
  ];
  for (const b of bad) {
    lastSent = b;
    const n = books.get('NOPE_USDT')?.n ?? 0;
    ws.send(b);
    await sleep(1_500);
    if (b.includes('NOPE_USDT')) {
      const st = books.get('NOPE_USDT');
      log('unknown_symbol', { frames: (st?.n ?? 0) - n, levels: st ? `${st.bids.at(-1)}/${st.asks.at(-1)}` : null, update_id: st?.last ?? null });
    }
  }
  log('symbols_array', { SUI_USDT_frames: books.get('SUI_USDT')?.n ?? 0 });
  const pingAt = Date.now();
  let pong = null;
  ws.once('pong', () => (pong = Date.now() - pingAt));
  ws.ping();
  await sleep(2_000);
  log('protocol_ping', { pongMs: pong });
  ws.terminate();

  log('frame_types', { types, wireBytes: wire, seconds: Math.round((Date.now() - t0) / 1000) });
  log('inflate_parse_us', stats(inflateUs.map((x) => Math.round(x))));
  log('ticker_update', { interArrivalMs: stats(tickerGaps) });
  log('trade_lag_ms', stats(tradeLagMs));
  log('server_protocol_pings', { count: protocolPings });
  log('replies', { other });
  const subscribed = new Set(SUBS);
  for (const [s, st] of books) log(subscribed.has(s) ? 'book_subscribed' : 'book_unsolicited', summary(s, st));
}

async function silence() {
  const t0 = Date.now();
  const variants = [
    { label: 'no subscription, client silent', subscribe: null, pingEveryMs: null },
    { label: 'quiet book EUL_USDC, client silent', subscribe: 'EUL_USDC', pingEveryMs: null },
    { label: 'no subscription, protocol ping every 20 s', subscribe: null, pingEveryMs: 20_000 },
    { label: 'no subscription, server pings left unanswered', subscribe: null, pingEveryMs: null, autoPong: false },
  ];
  const results = variants.map((v) => ({ ...v, frames: 0, serverPings: 0, pingAtMs: [], pongs: 0, closed: null, lastFrameMs: null, maxGapMs: 0 }));
  const sockets = results.map((r) => {
    const ws = open(WS_URL, { autoPong: r.autoPong ?? true });
    let last = null;
    ws.on('open', () => {
      if (r.subscribe) ws.send(JSON.stringify({ action: 'subscribe', symbol: r.subscribe }));
      if (r.pingEveryMs) r.timer = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), r.pingEveryMs);
    });
    ws.on('message', () => {
      const now = Date.now();
      if (last !== null) r.maxGapMs = Math.max(r.maxGapMs, now - last);
      last = now;
      r.frames++;
      r.lastFrameMs = now - t0;
    });
    ws.on('ping', () => {
      r.serverPings++;
      r.pingAtMs.push(Date.now() - t0);
    });
    ws.on('pong', () => r.pongs++);
    ws.on('close', (code, reason) => {
      r.closed = { ms: Date.now() - t0, code, reason: reason.toString() };
      clearInterval(r.timer);
    });
    return ws;
  });
  while (Date.now() - t0 < 120_000 && results.some((r) => r.closed === null)) await sleep(1_000);
  for (const ws of sockets) ws.terminate();
  for (const r of results) {
    clearInterval(r.timer);
    const { timer, ...rest } = r;
    log('silence', rest);
  }
}

async function batch() {
  const tickers = await (await fetch(`${API}/ticker`)).json();
  const symbols = tickers
    .map((x) => [x.symbol, Number(x.quote_volume_24h)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([s]) => s);
  const t0 = Date.now();
  const ws = open(WS_URL);
  const books = new Map();
  const inflateUs = [];
  let frames = 0;
  let wire = 0;
  let plain = 0;
  let bookFrames = 0;
  let errorCount = 0;
  const other = [];
  const perSecond = new Map();
  let subDone = null;
  let subStart = null;
  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    const d = decode(data, isBinary);
    frames++;
    wire += d.wire;
    plain += d.plain;
    if (isBinary) inflateUs.push(d.us);
    const sec = Math.floor((now - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const j = d.json;
    if (j?.type === 'book_update') {
      bookFrames++;
      if (!books.has(j.symbol)) books.set(j.symbol, { n: 0, first: now - (subStart ?? now), last: null, maxGap: 0, idJumps: 0, prevId: null });
      const b = books.get(j.symbol);
      b.n++;
      if (b.last !== null) b.maxGap = Math.max(b.maxGap, now - b.last);
      if (b.prevId !== null && j.update_id !== b.prevId + 1) b.idJumps++;
      b.prevId = j.update_id;
      b.last = now;
    } else if (j && !['trade_update', 'candle_update', 'ticker_update'].includes(j.type)) {
      other.push(d.text.slice(0, 160));
    }
    if (j?.type === 'error') errorCount++;
  });
  ws.on('close', (code) => log('close', { ms: Date.now() - t0, code }));
  await new Promise((r) => ws.on('open', r));
  // The ten default books count toward the cap of 30, so they are dropped first and resubscribed only if they rank in the top 30.
  for (const s of DEFAULT_BOOKS) {
    ws.send(JSON.stringify({ action: 'unsubscribe', symbol: s }));
    await sleep(200);
  }
  await sleep(2_000);
  books.clear();
  frames = 0;
  wire = 0;
  plain = 0;
  bookFrames = 0;
  inflateUs.length = 0;
  perSecond.clear();
  const spacing = Number(process.env.SUB_SPACING_MS ?? 200);
  subStart = Date.now();
  for (const s of symbols) {
    ws.send(JSON.stringify({ action: 'subscribe', symbol: s }));
    if (spacing) await sleep(spacing);
  }
  subDone = Date.now();
  log('batch_subscribed', { spacingMs: spacing, subscribeSeconds: Math.round((subDone - subStart) / 100) / 10 });
  await sleep(60_000);
  ws.terminate();
  const secs = (Date.now() - subDone) / 1000;
  const got = symbols.filter((s) => books.has(s));
  const rates = got.map((s) => books.get(s).n / secs);
  log('batch', {
    subscribed: symbols.length,
    delivered: got.length,
    notDelivered: symbols.filter((s) => !books.has(s)),
    unsolicited: [...books.keys()].filter((s) => !symbols.includes(s)),
    firstFrameMs: stats(got.map((s) => books.get(s).first)),
    framesPerSecond: Math.round(frames / secs),
    bookFramesPerSecond: Math.round(bookFrames / secs),
    perSecond: stats([...perSecond.values()]),
    wireKBps: Math.round(wire / secs / 1024),
    inflatedKBps: Math.round(plain / secs / 1024),
    inflateParseUs: stats(inflateUs.map((x) => Math.round(x))),
    perSymbolFramesPerSecond: stats(rates.map((x) => Math.round(x * 100) / 100)),
    perSymbolMaxGapMs: stats(got.map((s) => books.get(s).maxGap)),
    symbolsWithIdJumps: got.filter((s) => books.get(s).idJumps > 0).length,
    idJumpsTotal: got.reduce((a, s) => a + books.get(s).idJumps, 0),
    errors: errorCount,
    other: [...new Set(other)].slice(0, 5),
  });
}

// Three sockets in turn: a burst of 12 subscribes, then the ten default books unsubscribed and 31 subscribes at 150 ms, then 20 subscribes at 50 ms.
// Counts "Rate limit exceeded" and "Maximum subscription limit" replies, which name no symbol, so each phase is judged by which books arrived.
async function ratelimit() {
  const tickers = await (await fetch(`${API}/ticker`)).json();
  const DEFAULT = DEFAULT_BOOKS;
  const pool = tickers
    .map((x) => [x.symbol, Number(x.quote_volume_24h)])
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s)
    .filter((s) => !DEFAULT.includes(s));
  const phases = [
    { label: 'burst of 12, defaults kept', unsubscribeDefaults: false, n: 12, spacingMs: 0 },
    { label: 'defaults unsubscribed, then 31 at 150 ms', unsubscribeDefaults: true, n: 31, spacingMs: 150 },
    { label: 'defaults unsubscribed, then 20 at 50 ms', unsubscribeDefaults: true, n: 20, spacingMs: 50 },
  ];
  for (const ph of phases) {
    const t0 = Date.now();
    const ws = open(WS_URL);
    const seen = new Map();
    const errors = [];
    ws.on('message', (data, isBinary) => {
      const j = decode(data, isBinary).json;
      if (j?.type === 'book_update') seen.set(j.symbol, Date.now() - t0);
      if (j?.type === 'error') errors.push({ ms: Date.now() - t0, message: j.message });
    });
    await new Promise((r) => ws.on('open', r));
    if (ph.unsubscribeDefaults) {
      for (const s of DEFAULT) {
        ws.send(JSON.stringify({ action: 'unsubscribe', symbol: s }));
        await sleep(200);
      }
      await sleep(2_000);
    }
    const quietFrom = Date.now() - t0;
    const syms = pool.slice(0, ph.n);
    for (const s of syms) {
      ws.send(JSON.stringify({ action: 'subscribe', symbol: s }));
      if (ph.spacingMs) await sleep(ph.spacingMs);
    }
    await sleep(4_000);
    const lateDefaults = DEFAULT.filter((s) => (seen.get(s) ?? -1) > quietFrom + 1_000);
    log('ratelimit_phase', {
      label: ph.label,
      sent: syms.length,
      delivered: syms.filter((s) => seen.has(s)).length,
      undelivered: syms.filter((s) => !seen.has(s)),
      defaultsStillArriving: ph.unsubscribeDefaults ? lateDefaults.length : DEFAULT.filter((s) => seen.has(s)).length,
      errors: count(errors, (e) => e.message),
    });
    ws.terminate();
    await sleep(1_000);
  }
}

const modes = { origin, book, silence, batch, ratelimit };
const arg = process.argv[2];
if (!modes[arg]) {
  console.log('usage: ws-probe.mjs origin|book|silence|batch|ratelimit');
  process.exit(1);
}
log('mode', { name: arg, at: new Date().toISOString() });
await modes[arg]();
process.exit(0);
