// Coincheck spot REST probe: host and latency, the pair list against CCXT, the REST book of every pair, errors, a short burst, the server clock, and one second polls of the book, the ticker and the standard rate.
// Public, unauthenticated, read-only. No account, no key, no order.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coincheck/rest-probe.mjs [catalog|errors|poll|all]
//   catalog  DNS, cold and warm request time, exchange_status against CCXT loadMarkets, one REST book per pair, clock offset. About 30 s.
//   errors   unknown pair and missing parameter replies, then 20 ticker requests 200 ms apart. About 15 s.
//   poll     60 one second polls of btc_jpy order_books, with ticker and rate every third second. About 65 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/coincheck/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://coincheck.com/api';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null;
};
const stats = (xs) => ({ n: xs.length, min: pct(xs, 0), median: pct(xs, 0.5), p90: pct(xs, 0.9), max: pct(xs, 1) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, text, json, headers: res.headers };
}

function bookShape(book) {
  const num = (l) => [Number(l[0]), Number(l[1])];
  const bids = (book.bids ?? []).map(num);
  const asks = (book.asks ?? []).map(num);
  const desc = bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0]);
  const asc = asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0]);
  const types = typeof book.bids?.[0]?.[0] + '/' + typeof book.bids?.[0]?.[1];
  return { nb: bids.length, na: asks.length, bidsDesc: desc, asksAsc: asc, types, bestBid: bids[0]?.[0], bestAsk: asks[0]?.[0], crossed: bids.length && asks.length ? bids[0][0] >= asks[0][0] : null };
}

async function catalog() {
  for (const host of ['coincheck.com', 'ws-api.coincheck.com']) {
    const t0 = performance.now();
    const addrs = await lookup(host, { all: true });
    log('dns', { host, ms: Math.round(performance.now() - t0), addrs: addrs.map((a) => a.address) });
  }

  const cold = await get('/ticker?pair=btc_jpy');
  const warm = [];
  for (let i = 0; i < 10; i++) warm.push((await get('/ticker?pair=btc_jpy')).ms);
  log('latency_ticker', { coldMs: Math.round(cold.ms), warm: stats(warm), pop: cold.headers.get('x-amz-cf-pop'), xcache: cold.headers.get('x-cache'), server: cold.headers.get('server') });

  const st = await get('/exchange_status');
  keep('exchange_status.json', st.text);
  const rows = st.json.exchange_status;
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const quotes = {};
  for (const r of rows) {
    const q = r.pair.split('_')[1];
    quotes[q] = (quotes[q] ?? 0) + 1;
  }
  const notFull = rows.filter((r) => !(r.availability?.order && r.availability?.market_order && r.availability?.cancel)).map((r) => r.pair);
  log('exchange_status', { status: st.status, bytes: st.text.length, ms: Math.round(st.ms), pairs: rows.length, byStatus, quotes, notFullyAvailable: notFull, keys: Object.keys(rows[0]) });

  const ex = new ccxt.coincheck();
  const markets = await ex.loadMarkets();
  const live = new Set(rows.map((r) => r.pair));
  const ccxtIds = Object.values(markets).map((m) => m.id);
  log('ccxt', {
    version: ccxt.version,
    count: ccxtIds.length,
    markets: Object.values(markets).map((m) => ({ id: m.id, symbol: m.symbol, type: m.type, spot: m.spot, swap: m.swap, active: String(m.active), taker: String(m.taker), maker: String(m.maker), contractSize: String(m.contractSize), linear: String(m.linear), precisionPrice: String(m.precision?.price), precisionAmount: String(m.precision?.amount), live: live.has(m.id) })),
    liveMissingFromCcxt: [...live].filter((id) => !ccxtIds.includes(id)),
    has: { swap: ex.has.swap, future: ex.has.future, fetchMarkets: ex.has.fetchMarkets, fetchTickers: ex.has.fetchTickers, fetchTime: ex.has.fetchTime },
    rateLimit: ex.rateLimit,
    feesTrading: ex.fees.trading,
  });

  const books = [];
  for (const r of rows) {
    const b = await get('/order_books?pair=' + r.pair);
    const shape = bookShape(b.json ?? {});
    const spreadPpm = shape.bestBid && shape.bestAsk ? Math.round(((shape.bestAsk - shape.bestBid) / ((shape.bestAsk + shape.bestBid) / 2)) * 1e6) : null;
    books.push({ pair: r.pair, status: b.status, bytes: b.text.length, ms: Math.round(b.ms), ...shape, spreadPpm });
    if (r.pair === 'btc_jpy') keep('order_books_btc_jpy.json', b.text);
    await sleep(400);
  }
  for (const b of books) log('rest_book', b);
  log('rest_book_summary', {
    pairs: books.length,
    levelCounts: [...new Set(books.map((b) => `${b.nb}/${b.na}`))],
    allBidsDesc: books.every((b) => b.bidsDesc),
    allAsksAsc: books.every((b) => b.asksAsc),
    types: [...new Set(books.map((b) => b.types))],
    crossed: books.filter((b) => b.crossed).map((b) => b.pair),
    spreadPpm: stats(books.map((b) => b.spreadPpm).filter((x) => x !== null)),
    bytes: stats(books.map((b) => b.bytes)),
    ms: stats(books.map((b) => b.ms)),
  });

  // The Date header has one second resolution, so each sample bounds the offset to a one second window, and the windows are intersected.
  let lo = -Infinity;
  let hi = Infinity;
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const before = Date.now();
    const b = await get('/order_books?pair=btc_jpy');
    const after = Date.now();
    const d = Date.parse(b.headers.get('date'));
    lo = Math.max(lo, d - after);
    hi = Math.min(hi, d + 1000 - before);
    samples.push({ rtt: after - before, xcache: b.headers.get('x-cache') });
    await sleep(1130);
  }
  const t = await get('/ticker?pair=btc_jpy');
  log('clock', { method: 'Date header of order_books, intersected windows', serverMinusLocalMs: { lo, hi }, samples, tickerXcache: t.headers.get('x-cache'), tickerAge: t.headers.get('age') });
}

async function errors() {
  const cases = ['/ticker?pair=nope_jpy', '/order_books?pair=nope_jpy', '/order_books', '/rate/nope_jpy', '/trades?pair=nope_jpy', '/trades', '/exchange_status?pair=nope_jpy', '/order_books?pair=fct_jpy', '/order_books?pair=etc_btc', '/ticker?pair=etc_btc', '/rate/etc_btc', '/order_books?pair=BTC_JPY', '/nope'];
  for (const c of cases) {
    const r = await get(c);
    const ctype = r.headers.get('content-type');
    log('error_case', { path: c, status: r.status, ctype, bytes: r.text.length, body: r.json ? r.text.slice(0, 160) : r.text.replace(/\s+/g, ' ').match(/<title>(.*?)<\/title>/)?.[1] ?? r.text.slice(0, 80) });
    await sleep(300);
  }

  const burst = [];
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    const r = await get('/ticker?pair=btc_jpy');
    burst.push({ s: r.status, ms: Math.round(r.ms), retryAfter: r.headers.get('retry-after'), rl: [...r.headers.keys()].filter((k) => /rate|limit/i.test(k)) });
    await sleep(200); // five a second at most, since no public limit is published
  }
  const secs = (performance.now() - t0) / 1000;
  log('burst', { requests: 20, seconds: +secs.toFixed(2), perSecond: +(20 / secs).toFixed(1), statuses: [...new Set(burst.map((b) => b.s))], ms: stats(burst.map((b) => b.ms)), rateHeaders: [...new Set(burst.flatMap((b) => b.rl))], retryAfter: [...new Set(burst.map((b) => b.retryAfter))] });
}

async function poll() {
  const book = [];
  const tick = [];
  const rate = [];
  let prevBook = null;
  let prevEtag = null;
  let prevTick = null;
  let prevRate = null;
  let bookChanges = 0;
  let etagChanges = 0;
  let tickChanges = 0;
  let rateChanges = 0;
  const tsLag = [];
  const rateVsMidPpm = [];
  const xcache = {};
  const tickCache = {};
  const rateCache = {};
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const b = await get('/order_books?pair=btc_jpy');
    book.push(b.ms);
    const key = b.text;
    if (prevBook !== null && key !== prevBook) bookChanges++;
    prevBook = key;
    const etag = b.headers.get('etag');
    if (prevEtag !== null && etag !== prevEtag) etagChanges++;
    prevEtag = etag;
    const xc = b.headers.get('x-cache');
    xcache[xc] = (xcache[xc] ?? 0) + 1;
    const shape = bookShape(b.json);
    if (i % 3 === 0) {
      const t = await get('/ticker?pair=btc_jpy');
      tick.push(t.ms);
      const tk = JSON.stringify({ ...t.json, timestamp: 0 });
      if (prevTick !== null && tk !== prevTick) tickChanges++;
      prevTick = tk;
      tsLag.push(Date.now() - t.json.timestamp * 1000);
      tickCache[t.headers.get('x-cache')] = (tickCache[t.headers.get('x-cache')] ?? 0) + 1;
      const r = await get('/rate/btc_jpy');
      rateCache[r.headers.get('x-cache')] = (rateCache[r.headers.get('x-cache')] ?? 0) + 1;
      rate.push(r.ms);
      if (prevRate !== null && r.text !== prevRate) rateChanges++;
      prevRate = r.text;
      const mid = (shape.bestBid + shape.bestAsk) / 2;
      rateVsMidPpm.push(Math.round(((Number(r.json.rate) - mid) / mid) * 1e6));
      if (i === 0) log('poll_first', { ticker: t.text, rate: r.text, bestBid: shape.bestBid, bestAsk: shape.bestAsk });
    }
    const wait = 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
  }
  log('poll_book', { polls: 60, ms: stats(book), bodyChanges: bookChanges, etagChanges, xcache });
  log('poll_ticker', { polls: tick.length, ms: stats(tick), changes: tickChanges, localMinusTimestampMs: stats(tsLag), xcache: tickCache });
  log('poll_rate', { polls: rate.length, ms: stats(rate), changes: rateChanges, rateMinusBookMidPpm: stats(rateVsMidPpm), xcache: rateCache });
}

const mode = process.argv[2] ?? 'all';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'catalog' || mode === 'all') await catalog();
if (mode === 'errors' || mode === 'all') await errors();
if (mode === 'poll' || mode === 'all') await poll();
log('end', { at: new Date().toISOString() });
