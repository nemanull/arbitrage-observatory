// Luno REST probe: host and latency, the spot catalog through CCXT, the bulk ticker call polled at one hertz, the REST book, error shapes and the clock offset.
// Public, unauthenticated and read-only.
// The published limit is 300 calls per minute, and each mode sends at most 3 requests in any one second, most of the time one.
// Run from server/: node ../scripts/probes/venues/luno/rest-probe.mjs [main|poll|all]
//   main  host and latency, catalog through CCXT, book, errors and clock, about 30 s
//   poll  60 rounds of GET /api/1/tickers one second apart, with change counts for a few pairs, about 70 s
//   all   both
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/luno/rest.md and docs/profiles/luno/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.luno.com';
const OUT = process.env.PROBE_OUT_DIR;
const WATCH = ['XBTUSDT', 'ETHUSDT', 'SOLUSDT', 'XBTZAR', 'USDTZAR', 'SOLXRP'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'user-agent': 'observatory-probe' } });
  const tHead = performance.now();
  const text = await res.text();
  const t1 = performance.now();
  const h = (k) => res.headers.get(k);
  return {
    status: res.status,
    ms: Math.round(t1 - t0),
    headMs: Math.round(tHead - t0),
    bytes: text.length,
    text,
    date: h('date'),
    cache: h('cache-control'),
    cf: h('cf-cache-status'),
    age: h('age'),
    rl: [h('x-ratelimit-limit'), h('x-ratelimit-remaining'), h('x-ratelimit-reset')].join(' | '),
    retryAfter: h('retry-after'),
    tReq: Date.now(),
  };
}

const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stats = (a) => ({ n: a.length, min: Math.min(...a), median: q(a, 0.5), p90: q(a, 0.9), max: Math.max(...a) });

async function host() {
  for (const name of ['api.luno.com', 'ws.luno.com']) {
    const v4 = await dns.resolve4(name).catch((e) => [e.code]);
    const v6 = await dns.resolve6(name).catch((e) => [e.code]);
    log('dns', { name, v4, v6 });
  }
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/api/1/ticker?pair=XBTUSDT');
    times.push(r.ms);
    if (i === 0) log('first_request', { status: r.status, ms: r.ms, headMs: r.headMs });
    await sleep(600);
  }
  log('ticker_single_warm', stats(times.slice(1)));
}

async function catalog() {
  const r = await get('/api/exchange/1/markets');
  keep('markets.json', r.text);
  const markets = JSON.parse(r.text).markets;
  const byStatus = {};
  const byQuote = {};
  for (const m of markets) {
    byStatus[m.trading_status] = (byStatus[m.trading_status] ?? 0) + 1;
    byQuote[m.counter_currency] = (byQuote[m.counter_currency] ?? 0) + 1;
  }
  log('markets_rest', { status: r.status, ms: r.ms, bytes: r.bytes, count: markets.length, byStatus, byQuote });
  log('markets_row', { row: markets.find((m) => m.market_id === 'XBTUSDT') });
  const perpLike = markets.filter((m) => /PERP|SWAP|FUT|-/i.test(m.market_id)).map((m) => m.market_id);
  log('perp_like_ids', { perpLike });

  const ex = new ccxt.luno();
  const t0 = performance.now();
  const loaded = await ex.loadMarkets();
  const list = Object.values(loaded);
  const types = {};
  for (const m of list) types[m.type] = (types[m.type] ?? 0) + 1;
  const btc = loaded['BTC/USDT'];
  log('ccxt_markets', {
    ms: Math.round(performance.now() - t0),
    count: list.length,
    types,
    active: list.filter((m) => m.active).length,
    swaps: list.filter((m) => m.swap).length,
    btcUsdt: { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, taker: btc.taker, maker: btc.maker, contractSize: btc.contractSize, linear: btc.linear, active: btc.active, precision: btc.precision },
    exchangeFees: ex.fees.trading,
  });
  const restIds = new Set(markets.map((m) => m.market_id));
  const ccxtIds = new Set(list.map((m) => m.id));
  log('ccxt_vs_rest_ids', {
    onlyRest: [...restIds].filter((x) => !ccxtIds.has(x)),
    onlyCcxt: [...ccxtIds].filter((x) => !restIds.has(x)),
    renamedBases: [...new Set(list.filter((m) => m.base !== m.baseId).map((m) => `${m.baseId}>${m.base}`))],
    renamedQuotes: [...new Set(list.filter((m) => m.quote !== m.quoteId).map((m) => `${m.quoteId}>${m.quote}`))],
  });
  const family = list.filter((m) => ['USDT', 'USDC', 'USD'].includes(m.quote));
  const perBase = {};
  for (const m of family) (perBase[m.base] ??= []).push(m.id);
  log('usd_family', { count: family.length, twice: Object.fromEntries(Object.entries(perBase).filter(([, v]) => v.length > 1)), ids: family.map((m) => m.id) });
  return markets;
}

async function book() {
  for (const pair of ['XBTUSDT', 'ETHUSDT', 'XBTZAR', 'SOLXRP']) {
    const r = await get(`/api/1/orderbook_top?pair=${pair}`);
    const b = JSON.parse(r.text);
    const bids = b.bids.map((l) => Number(l.price));
    const asks = b.asks.map((l) => Number(l.price));
    log('orderbook_top', {
      pair,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      keys: Object.keys(b),
      levelKeys: Object.keys(b.bids[0] ?? b.asks[0] ?? {}),
      bids: bids.length,
      asks: asks.length,
      bidsDesc: bids.every((p, i) => i === 0 || p < bids[i - 1]),
      asksAsc: asks.every((p, i) => i === 0 || p > asks[i - 1]),
      top: [b.bids[0], b.asks[0]],
      tsAgeMs: Date.now() - b.timestamp,
      cache: r.cache,
      cf: r.cf,
      age: r.age,
    });
    keep(`orderbook_top_${pair}.json`, r.text);
    await sleep(600);
  }
  const a = await get('/api/1/orderbook_top?pair=XBTUSDT');
  const b = await get('/api/1/orderbook_top?pair=XBTUSDT');
  log('orderbook_top_twice', { tsA: JSON.parse(a.text).timestamp, tsB: JSON.parse(b.text).timestamp, gapMs: b.tReq - a.tReq, same: a.text === b.text, ages: [a.age, b.age], cf: [a.cf, b.cf] });
  await sleep(600);
  for (const pair of ['XBTUSDT', 'XBTZAR']) {
    const r = await get(`/api/1/orderbook?pair=${pair}`);
    const full = JSON.parse(r.text);
    const prices = (side) => full[side].map((l) => l.price);
    log('orderbook_full', {
      pair,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      bids: full.bids.length,
      asks: full.asks.length,
      uniqueBidPrices: new Set(prices('bids')).size,
      uniqueAskPrices: new Set(prices('asks')).size,
      levelKeys: Object.keys(full.bids[0] ?? {}),
      tsAgeMs: Date.now() - full.timestamp,
    });
    await sleep(600);
  }
}

async function errors() {
  const paths = [
    '/api/1/orderbook_top?pair=NOPEUSDT',
    '/api/1/ticker?pair=NOPEUSDT',
    '/api/1/orderbook_top',
    '/api/1/tickers?pair=NOPEUSDT',
    '/api/1/nope',
    '/api/1/time',
  ];
  for (const p of paths) {
    const r = await get(p);
    log('error_shape', { path: p, status: r.status, retryAfter: r.retryAfter, rl: r.rl, body: r.text.slice(0, 200) });
    await sleep(600);
  }
}

async function clock() {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/api/1/ticker?pair=XBTUSDT');
    const t1 = Date.now();
    const mid = (t0 + t1) / 2;
    const tick = JSON.parse(r.text);
    offsets.push({ dateHeaderMinusMid: Date.parse(r.date) - mid, tickerTsMinusMid: Math.round(tick.timestamp - mid), rttMs: t1 - t0 });
    await sleep(700);
  }
  log('clock', { offsets });
}

async function poll() {
  const times = [];
  const bytes = [];
  const caches = {};
  const last = {};
  const changes = Object.fromEntries(WATCH.map((p) => [p, { bid: 0, ask: 0, last_trade: 0, timestamp: 0 }]));
  const tsAge = [];
  const rlSeen = new Set();
  let non200 = 0;
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    const r = await get('/api/1/tickers');
    times.push(r.ms);
    bytes.push(r.bytes);
    caches[`${r.cf}|age=${r.age}`] = (caches[`${r.cf}|age=${r.age}`] ?? 0) + 1;
    rlSeen.add(r.rl);
    if (r.status !== 200) {
      non200++;
      log('poll_non200', { i, status: r.status, retryAfter: r.retryAfter, body: r.text.slice(0, 200) });
    } else {
      const rows = JSON.parse(r.text).tickers;
      const byPair = Object.fromEntries(rows.map((t) => [t.pair, t]));
      const arrived = Date.now();
      for (const p of WATCH) {
        const t = byPair[p];
        if (!t) continue;
        tsAge.push(arrived - t.timestamp);
        if (last[p]) for (const k of ['bid', 'ask', 'last_trade', 'timestamp']) if (last[p][k] !== t[k]) changes[p][k]++;
        last[p] = t;
      }
      if (i === 0) {
        log('tickers_first', { rows: rows.length, bytes: r.bytes, statuses: [...new Set(rows.map((t) => t.status))], sample: byPair.XBTUSDT });
        keep('tickers.json', r.text);
      }
    }
    const wait = 1000 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  log('poll_summary', { polls: times.length, non200, ms: stats(times), bytes: stats(bytes), caches, rateLimitHeaders: [...rlSeen].slice(0, 5), tickerTsAgeMs: stats(tsAge) });
  log('poll_changes_of_59', changes);
}

const mode = process.argv[2] ?? 'main';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'main' || mode === 'all') {
  await host();
  await catalog();
  await book();
  await errors();
  await clock();
}
if (mode === 'poll' || mode === 'all') await poll();
log('end', { at: new Date().toISOString() });
