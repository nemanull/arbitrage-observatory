// SAFEbit REST probe: host and latency, the spot catalog, the book snapshot calls, how often they change, error shapes and the server clock.
// SAFEbit lists no perpetuals, so this probes the spot market of the aggregator API at https://api.safebit.com.tr/swagger/index.html.
// Public, unauthenticated, read-only. One request at a time, never faster than two a second, well inside any limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/safebit/rest-probe.mjs [catalog|book|poll|scan|errors|all]
//   catalog  DNS, cold and warm request time, pairs, exchangeinfo, tickers, summary, CCXT lookup. About 20 s.
//   book     every book call at every depth and level, level order, field order, size rounding, one-sided books. About 40 s.
//   poll     the ETH_TRY book and the tickers read every 1 s for 60 s, how often each changes, cache headers. About 70 s.
//   scan     every pair's book touch against the tickers call, at two requests a second. About 90 s.
//   errors   unknown pair, bad depth, unknown path, server time against the local clock. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/safebit/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'api.safebit.com.tr';
const API = `https://${HOST}`;
const OUT = process.env.PROBE_OUT_DIR;
const POLL_PAIR = 'ETH_TRY'; // the busiest pair with a book on 2026-09-22
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const h = (k) => res.headers.get(k);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: res.status,
    ms,
    bytes: text.length,
    text,
    json,
    headers: {
      type: h('content-type'),
      cache: h('cf-cache-status'),
      age: h('age'),
      cacheControl: h('cache-control'),
      retryAfter: h('retry-after'),
      rateLimit: [...res.headers.keys()].filter((k) => /rate|limit/i.test(k)),
      date: h('date'),
      ray: h('cf-ray'),
    },
  };
}

const count = (arr, key) => arr.reduce((a, x) => ((a[key(x)] = (a[key(x)] ?? 0) + 1), a), {});
const ordered = (xs, desc) => xs.every((x, i) => i === 0 || (desc ? xs[i - 1] >= x : xs[i - 1] <= x));
const decimals = (s) => (String(s).split('.')[1] ?? '').replace(/0+$/, '').length;

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });

  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/api/Spot/pairs');
    times.push(r.ms);
    await sleep(500);
  }
  log('latency', { path: '/api/Spot/pairs', firstMs: times[0], warmMs: times.slice(1) });

  const pairs = await get('/api/Spot/pairs');
  capture('pairs.json', pairs.text);
  log('pairs', {
    status: pairs.status,
    ms: pairs.ms,
    bytes: pairs.bytes,
    rows: pairs.json.length,
    byTarget: count(pairs.json, (p) => p.target),
    keys: Object.keys(pairs.json[0]),
    sample: pairs.json.slice(0, 3).map((p) => p.ticker_id),
  });

  const info = await get('/api/exchangeinfo');
  capture('exchangeinfo.json', info.text);
  log('exchangeinfo', {
    status: info.status,
    ms: info.ms,
    bytes: info.bytes,
    rows: info.json.symbols.length,
    timezone: info.json.timezone,
    byStatus: count(info.json.symbols, (s) => s.status),
    byQuote: count(info.json.symbols, (s) => s.quoteAsset),
    orderTypes: count(info.json.symbols, (s) => s.orderTypes.join('+')),
    sample: info.json.symbols.slice(0, 3).map((s) => s.symbol),
  });

  const ids = new Set(pairs.json.map((p) => p.ticker_id));
  const infoIds = new Set(info.json.symbols.map((s) => `${s.baseAsset}_${s.quoteAsset}`));
  log('catalog_match', {
    pairsNotInInfo: [...ids].filter((x) => !infoIds.has(x)),
    infoNotInPairs: [...infoIds].filter((x) => !ids.has(x)),
    baseListedTwice: Object.entries(count(pairs.json, (p) => p.base))
      .filter(([, n]) => n > 1)
      .map(([b]) => b),
  });

  const tickers = await get('/api/Spot/tickers');
  capture('tickers.json', tickers.text);
  const t = tickers.json;
  log('tickers', {
    status: tickers.status,
    ms: tickers.ms,
    bytes: tickers.bytes,
    rows: t.length,
    keys: Object.keys(t[0]),
    withVolume: t.filter((x) => x.target_volume > 0).length,
    bidZero: t.filter((x) => !x.bid).map((x) => x.ticker_id),
    askZero: t.filter((x) => !x.ask).map((x) => x.ticker_id),
    crossedOrLocked: t.filter((x) => x.bid && x.ask && x.bid >= x.ask).map((x) => x.ticker_id),
  });
  const usdTry = t.find((x) => x.ticker_id === 'USDT_TRY');
  const vol = t
    .map((x) => ({ id: x.ticker_id, quoteVol: x.target_volume, quote: x.target_currency }))
    .sort((a, b) => b.quoteVol / (b.quote === 'TRY' ? 1 : 1 / (usdTry?.last_price ?? 1)) - a.quoteVol / (a.quote === 'TRY' ? 1 : 1 / (usdTry?.last_price ?? 1)));
  log('volume', {
    usdtTry: usdTry?.last_price,
    top: vol.slice(0, 8).map((v) => `${v.id} ${Math.round(v.quoteVol)} ${v.quote}`),
    totalTry: Math.round(t.filter((x) => x.target_currency === 'TRY').reduce((a, x) => a + x.target_volume, 0)),
    totalUsdt: Math.round(t.filter((x) => x.target_currency === 'USDT').reduce((a, x) => a + x.target_volume, 0)),
  });

  for (const path of ['/api/CoinMarketCap/summary', '/api/CoinMarketCap/ticker', '/api/ReturnTicker', '/api/Summary']) {
    const r = await get(path);
    // /api/Summary answers with a JSON string that holds JSON, so it is decoded twice.
    const body = typeof r.json === 'string' ? JSON.parse(r.json) : r.json;
    const rows = Array.isArray(body) ? body.length : body ? Object.keys(body).length : null;
    const first = Array.isArray(body) ? body[0] : body ? Object.values(body)[0] : null;
    const frozen = body && !Array.isArray(body) ? Object.values(body).filter((x) => x.isFrozen !== undefined && x.isFrozen !== 0 && x.isFrozen !== '0').length : undefined;
    log('ticker_variant', { path, status: r.status, ms: r.ms, bytes: r.bytes, type: r.headers.type, encodedTwice: typeof r.json === 'string', rows, keys: first ? Object.keys(first) : null, frozen });
    await sleep(500);
  }

  log('ccxt', {
    version: ccxt.version,
    classes: ccxt.exchanges.length,
    match: ccxt.exchanges.filter((x) => /safe|bitci/i.test(x)),
  });
}

async function book() {
  const pair = 'BTC_TRY';
  for (const depth of [undefined, 0, -1, 1, 2, 5, 10, 20, 50, 100, 500]) {
    const q = depth === undefined ? '' : `&depth=${depth}`;
    const r = await get(`/api/Spot/orderbook?ticker_id=${pair}${q}`);
    const j = r.json ?? {};
    log('spot_orderbook', {
      depth,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      bids: j.bids?.length,
      asks: j.asks?.length,
      firstBid: j.bids?.[0],
      firstAsk: j.asks?.[0],
      bidsDesc: j.bids ? ordered(j.bids.map((l) => Number(l[1])), true) : null,
      asksAsc: j.asks ? ordered(j.asks.map((l) => Number(l[1])), false) : null,
      tsType: typeof j.timestamp,
      body: r.json ? undefined : r.text.slice(0, 200),
    });
    await sleep(500);
  }

  for (const [depth, level] of [[undefined, undefined], [20, 1], [20, 2], [20, 3], [100, 2], [0, 2]]) {
    const q = `${depth === undefined ? '' : `&depth=${depth}`}${level === undefined ? '' : `&level=${level}`}`;
    const r = await get(`/api/CoinMarketCap/orderbook/market_pair?market_pair=${pair}${q}`);
    const j = r.json ?? {};
    log('cmc_orderbook', {
      depth,
      level,
      status: r.status,
      ms: r.ms,
      bids: j.bids?.length,
      asks: j.asks?.length,
      firstBid: j.bids?.[0],
      bidsDesc: j.bids ? ordered(j.bids.map((l) => l.price), true) : null,
      asksAsc: j.asks ? ordered(j.asks.map((l) => l.price), false) : null,
      body: r.json ? undefined : r.text.slice(0, 200),
    });
    await sleep(500);
  }

  // The legacy call returns every resting order, one row per order rather than per price.
  const legacy = await get(`/api/OrderBook/${pair}`);
  capture('orderbook-legacy.json', legacy.text);
  const lj = legacy.json;
  const bp = lj.bids.map((l) => l.price);
  const ap = lj.asks.map((l) => l.price);
  log('legacy_orderbook', {
    status: legacy.status,
    ms: legacy.ms,
    bytes: legacy.bytes,
    bids: bp.length,
    asks: ap.length,
    distinctBidPrices: new Set(bp).size,
    distinctAskPrices: new Set(ap).size,
    bidsDesc: ordered(bp, true),
    asksAsc: ordered(ap, false),
    bestBid: Math.max(...bp),
    bestAsk: Math.min(...ap),
    firstAsks: ap.slice(0, 4),
  });

  // Same instant, three calls: do the aggregated books agree, and how are sizes rounded.
  const [a, b] = [await get(`/api/Spot/orderbook?ticker_id=${pair}&depth=10`), await get(`/api/CoinMarketCap/orderbook/market_pair?market_pair=${pair}&depth=10&level=2`)];
  const sp = a.json;
  const cm = b.json;
  log('size_rounding', {
    spotSizeDecimals: count(sp.bids.concat(sp.asks), (l) => decimals(l[0])),
    cmcSizeDecimals: count(cm.bids.concat(cm.asks), (l) => decimals(l.amount)),
    pairs: sp.bids.slice(0, 4).map((l, i) => `${l[1]}:${l[0]} vs ${cm.bids[i]?.price}:${cm.bids[i]?.amount}`),
    samePrices: sp.bids.every((l, i) => Number(l[1]) === cm.bids[i]?.price),
  });

  // A thin pair and the one-sided pair seen in the tickers.
  const tickers = (await get('/api/Spot/tickers')).json;
  const oneSided = tickers.filter((x) => !x.bid || !x.ask || x.bid >= x.ask).map((x) => x.ticker_id);
  const thin = tickers.filter((x) => x.target_volume === 0).slice(0, 2).map((x) => x.ticker_id);
  for (const id of [...oneSided, ...thin, 'USDT_TRY', 'ETH_TRY']) {
    const r = await get(`/api/Spot/orderbook?ticker_id=${id}&depth=100`);
    const j = r.json ?? {};
    log('pair_book', {
      id,
      status: r.status,
      bids: j.bids?.length,
      asks: j.asks?.length,
      bestBid: j.bids?.[0]?.[1],
      bestAsk: j.asks?.[0]?.[1],
      spreadPpm: j.bids?.length && j.asks?.length ? Math.round((1e6 * (j.asks[0][1] - j.bids[0][1])) / j.bids[0][1]) : null,
      tsAgeMs: j.timestamp ? Date.now() - Number(j.timestamp) : null,
    });
    await sleep(500);
  }
}

async function poll() {
  const seen = { book: [], tickers: [] };
  const ms = { book: [], tickers: [] };
  const caches = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    const tick = Date.now();
    const b = await get(`/api/Spot/orderbook?ticker_id=${POLL_PAIR}&depth=10`);
    ms.book.push(b.ms);
    caches.add(`${b.headers.cache}|${b.headers.age}|${b.headers.cacheControl}`);
    seen.book.push({ ts: b.json.timestamp, top: `${b.json.bids[0]?.[1]}/${b.json.asks[0]?.[1]}`, body: JSON.stringify([b.json.bids, b.json.asks]) });
    const t = await get('/api/Spot/tickers');
    ms.tickers.push(t.ms);
    const row = t.json.find((x) => x.ticker_id === POLL_PAIR);
    seen.tickers.push({ top: `${row.bid}/${row.ask}`, last: row.last_price, vol: row.target_volume });
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  const changes = (xs, k) => xs.filter((x, i) => i > 0 && x[k] !== xs[i - 1][k]).length;
  const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
  };
  log('poll_book', {
    pair: POLL_PAIR,
    ms: stat(ms.book),
    tsChanges: changes(seen.book, 'ts'),
    topChanges: changes(seen.book, 'top'),
    bodyChanges: changes(seen.book, 'body'),
    tsAgeLastMs: Date.now() - Number(seen.book.at(-1).ts),
  });
  log('poll_tickers', {
    ms: stat(ms.tickers),
    topChanges: changes(seen.tickers, 'top'),
    lastChanges: changes(seen.tickers, 'last'),
    volChanges: changes(seen.tickers, 'vol'),
  });
  log('cache_headers', { distinct: [...caches] });
}

// Every pair's touch from the book call, against the bid and ask the tickers call reports.
async function scan() {
  const tickers = (await get('/api/Spot/tickers')).json;
  const rows = [];
  const failures = [];
  const t0 = Date.now();
  for (const x of tickers) {
    const r = await get(`/api/Spot/orderbook?ticker_id=${x.ticker_id}&depth=0`);
    const j = r.json;
    if (r.status !== 200 || !Array.isArray(j?.bids)) {
      failures.push({ id: x.ticker_id, status: r.status, ms: r.ms, retryAfter: r.headers.retryAfter, type: r.headers.type, ray: r.headers.ray, body: r.text.slice(0, 160) });
      await sleep(500);
      continue;
    }
    const bid = j.bids[0] ? Number(j.bids[0][1]) : 0;
    const ask = j.asks[0] ? Number(j.asks[0][1]) : 0;
    rows.push({ id: x.ticker_id, bids: j.bids.length, asks: j.asks.length, bid, ask, tBid: x.bid, tAsk: x.ask, vol: x.target_volume, quote: x.target_currency });
    await sleep(500);
  }
  const two = rows.filter((r) => r.bids && r.asks);
  const spreads = two.map((r) => Math.round((1e6 * (r.ask - r.bid)) / r.bid)).sort((a, b) => a - b);
  log('scan', {
    pairs: rows.length,
    failures,
    seconds: Math.round((Date.now() - t0) / 1000),
    twoSided: two.length,
    bidOnly: rows.filter((r) => r.bids && !r.asks).map((r) => r.id),
    askOnly: rows.filter((r) => !r.bids && r.asks).map((r) => r.id),
    empty: rows.filter((r) => !r.bids && !r.asks).map((r) => r.id),
    crossedBook: two.filter((r) => r.bid >= r.ask).map((r) => r.id),
    spreadPpm: { min: spreads[0], median: spreads[Math.floor(spreads.length / 2)], p90: spreads[Math.floor(spreads.length * 0.9)], max: spreads.at(-1) },
    levelsPerSide: { maxBids: Math.max(...rows.map((r) => r.bids)), maxAsks: Math.max(...rows.map((r) => r.asks)), under20Either: two.filter((r) => r.bids < 20 || r.asks < 20).length },
    tickerBidMatchesBook: rows.filter((r) => r.bids && r.tBid === r.bid).length,
    tickerAskMatchesBook: rows.filter((r) => r.asks && r.tAsk === r.ask).length,
    tickerAskBelowBookBid: rows.filter((r) => r.bids && r.tAsk && r.tAsk < r.bid).map((r) => r.id),
    tickerTouchWithEmptyBook: rows.filter((r) => !r.bids && !r.asks && (r.tBid || r.tAsk)).map((r) => r.id),
    zeroVolume: rows.filter((r) => !r.vol).length,
  });
  capture('scan.json', JSON.stringify(rows));
}

async function errors() {
  for (const path of [
    '/api/Spot/orderbook?ticker_id=NOPE_TRY&depth=10',
    '/api/Spot/orderbook?ticker_id=btc_try&depth=10',
    '/api/Spot/orderbook?ticker_id=BTCTRY&depth=10',
    '/api/Spot/orderbook?depth=10',
    '/api/Spot/orderbook?ticker_id=BTC_TRY&depth=-1',
    '/api/Spot/orderbook?ticker_id=BTC_TRY&depth=abc',
    '/api/OrderBook/NOPE_TRY',
    '/api/CoinMarketCap/orderbook/market_pair?market_pair=NOPE_TRY',
    '/api/Spot/nope',
    '/api/v1/time',
  ]) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, type: r.headers.type, retryAfter: r.headers.retryAfter, rateHeaders: r.headers.rateLimit, body: r.text.slice(0, 160) });
    await sleep(500);
  }

  const before = Date.now();
  const info = await get('/api/exchangeinfo');
  const after = Date.now();
  const mid = (before + after) / 2;
  const book = await get('/api/Spot/orderbook?ticker_id=BTC_TRY&depth=1');
  const done = Date.now();
  log('clock', {
    exchangeinfoServerTimeS: info.json.serverTime,
    localMidS: Math.round(mid / 1000),
    offsetS: info.json.serverTime - Math.round(mid / 1000),
    offsetHours: Math.round(((info.json.serverTime * 1000 - mid) / 3_600_000) * 100) / 100,
    httpDate: info.headers.date,
    bookTimestampMs: book.json.timestamp,
    bookTsMinusLocalMs: Number(book.json.timestamp) - done,
    cfRay: info.headers.ray,
  });
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, book, poll, scan, errors };
for (const [name, fn] of Object.entries(modes)) {
  if (mode === name || mode === 'all') {
    log('mode', { name, at: new Date().toISOString() });
    await fn();
  }
}
