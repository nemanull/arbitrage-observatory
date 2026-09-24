// Phemex REST probe: host and latency, the product catalog and how CCXT maps it, the anchor bulk calls polled at one hertz, index baskets, funding history, the REST book, error shapes and server time.
// Public, unauthenticated and read-only.
// The two anchor calls are each polled once a second, 120 requests a minute, under the 300 per minute that the rate limit headers of the counted endpoints report.
// Run from server/: node ../scripts/probes/venues/phemex/rest-probe.mjs [main|poll]
//   main  host, catalog through the products call and CCXT, anchor shapes and joins, baskets, funding history, books, errors and server time, about 30 s
//   poll  the ticker and real funding rate calls every second for 60 rounds, with reply time, change counts and the rate limit counter, about 65 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/phemex/rest.md and docs/profiles/phemex/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.phemex.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const iso = (ms) => new Date(Number(ms)).toISOString();
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: res.status,
    ms,
    bytes: text.length,
    text,
    json,
    remaining: res.headers.get('x-ratelimit-remaining'),
    capacity: res.headers.get('x-ratelimit-capacity'),
    retryAfter: res.headers.get('retry-after'),
    cache: res.headers.get('x-cache'),
    age: res.headers.get('age'),
    pop: res.headers.get('x-amz-cf-pop'),
  };
}

async function host() {
  for (const name of ['api.phemex.com', 'ws.phemex.com', 'vapi.phemex.com']) {
    let cname = [];
    try {
      cname = await dns.resolveCname(name);
    } catch {}
    let addrs = [];
    try {
      addrs = await dns.resolve4(name);
    } catch (e) {
      addrs = [String(e.code)];
    }
    log('dns', { name, cname, addrs });
  }
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/public/time');
    times.push(r.ms);
    await sleep(300);
  }
  log('latency_public_time', { coldMs: times[0], warmMs: times.slice(1), pop: (await get('/public/time')).pop });
}

async function serverTime() {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const a = Date.now();
    const r = await get('/public/time');
    const b = Date.now();
    offsets.push({ rtt: b - a, offset: r.json.data.serverTime - Math.round((a + b) / 2) });
    await sleep(300);
  }
  log('server_time', { samples: offsets });
}

async function catalog() {
  const r = await get('/public/products');
  keep('products.json', r.text);
  const d = r.json.data;
  const count = (rows, key) => {
    const m = {};
    for (const p of rows) {
      const k = key(p);
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  };
  log('products', {
    status: r.status,
    ms: r.ms,
    bytes: r.bytes,
    lists: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])),
    perpV2: count(d.perpProductsV2, (p) => `${p.type}|${p.settleCurrency}|${p.status}`),
    perpV1: count(d.products.filter((p) => p.type === 'Perpetual'), (p) => `${p.settleCurrency}|${p.status}`),
    spot: count(d.products.filter((p) => p.type === 'Spot'), (p) => p.status),
    other: count(d.products.filter((p) => p.type !== 'Spot' && p.type !== 'Perpetual'), (p) => `${p.type}|${p.status}`),
  });
  const listedV2 = d.perpProductsV2.filter((p) => p.status === 'Listed');
  log('perpV2_listed', {
    subType: count(listedV2, (p) => `${p.settleCurrency}|${p.perpProductSubType}`),
    fundingInterval: count(listedV2, (p) => p.fundingInterval),
    hasFeeFields: listedV2.filter((p) => 'takerFeeRateEr' in p || 'takerFeeRateRr' in p).length,
    hasContractSize: listedV2.filter((p) => 'contractSize' in p).length,
    numericBase: listedV2.filter((p) => /^\d/.test(p.baseCurrency)).map((p) => `${p.symbol}:${p.baseCurrency}`),
    preMarket: listedV2.filter((p) => p.perpProductSubType === 'PreMarket').map((p) => p.symbol),
    usdc: listedV2.filter((p) => p.settleCurrency === 'USDC').map((p) => p.symbol),
  });
  const coinM = d.products.filter((p) => p.type === 'Perpetual' && p.status === 'Listed');
  log('coinM_listed', { rows: coinM.map((p) => `${p.symbol}:${p.settleCurrency}:${p.contractSize}:${p.priceScale}`) });

  const v1 = await get('/exchange/public/products');
  const v1Listed = (v1.json.data || []).filter((p) => p.status === 'Listed');
  log('v1_products', {
    status: v1.status,
    rows: (v1.json.data || []).length,
    listed: v1Listed.map((p) => `${p.symbol}:${p.type}:taker ${p.takerFeeRateEr}:maker ${p.makerFeeRateEr}`),
  });

  const ex = new ccxt.phemex();
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.swap);
  log('ccxt_catalog', {
    version: ccxt.version,
    ms: Date.now() - t0,
    swaps: swaps.length,
    activeSwaps: count(swaps.filter((m) => m.active), (m) => `${m.settle}|${m.linear ? 'linear' : 'inverse'}|taker ${m.taker}|maker ${m.maker}|contractSize ${m.contractSize}`),
    classDefaultTaker: ex.fees.trading.taker,
  });
  for (const s of ['BTC/USDT:USDT', 'ETH/USDC:USDC', 'BTC/USD:BTC', 'ETH/USD:ETH', '1000SHIB/USDT:USDT', 'TSLA/USDT:USDT']) {
    const m = markets[s];
    if (m) log('ccxt_market', { symbol: s, id: m.id, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, active: m.active, contractSize: m.contractSize, taker: m.taker, maker: m.maker, precision: m.precision });
  }
  const pairs = {};
  for (const m of swaps.filter((m) => m.active)) (pairs[`${m.base}/${m.quote}`] ||= []).push(m.id);
  log('ccxt_pairs_listed_twice', { sameQuote: Object.entries(pairs).filter(([, v]) => v.length > 1) });
  const family = {};
  for (const m of swaps.filter((m) => m.active)) (family[m.base] ||= []).push(m.id);
  log('ccxt_bases_on_several_contracts', { count: Object.values(family).filter((v) => v.length > 1).length, sample: Object.entries(family).filter(([, v]) => v.length > 1).slice(0, 10) });
  return { markets, listedV2 };
}

async function anchorShapes(listedV2, markets) {
  const t = await get('/md/v3/ticker/24hr/all');
  keep('ticker_v3_all.json', t.text);
  const rows = t.json.result;
  const listed = new Set(listedV2.map((p) => p.symbol));
  const syms = new Set(rows.map((x) => x.symbol));
  log('ticker_v3_all', {
    status: t.status,
    ms: t.ms,
    bytes: t.bytes,
    rows: rows.length,
    keys: Object.keys(rows[0]),
    notListed: [...syms].filter((s) => !listed.has(s)),
    listedMissing: [...listed].filter((s) => !syms.has(s)),
    markZero: rows.filter((x) => Number(x.markRp) === 0).length,
    indexZero: rows.filter((x) => Number(x.indexRp) === 0).map((x) => x.symbol),
    sample: rows.find((x) => x.symbol === 'BTCUSDT'),
  });
  const ageMs = rows.map((x) => Date.now() - Number(BigInt(x.timestamp) / 1000000n));
  log('ticker_v3_row_age_ms', { min: Math.min(...ageMs), median: pct(ageMs, 50), max: Math.max(...ageMs) });
  const ccxtIds = new Set(Object.values(markets).filter((m) => m.swap && m.active && m.linear).map((m) => m.id));
  log('ticker_vs_ccxt_ids', { linearActive: ccxtIds.size, inTicker: [...ccxtIds].filter((id) => syms.has(id)).length });

  const dev = rows
    .filter((x) => Number(x.indexRp) > 0)
    .map((x) => ({ s: x.symbol, ppm: Math.round((Number(x.markRp) / Number(x.indexRp) - 1) * 1e6) }))
    .sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm));
  log('mark_vs_index_ppm', { top: dev.slice(0, 8), medianAbs: pct(dev.map((d) => Math.abs(d.ppm)), 50) });

  const v2 = await get('/md/v2/ticker/24hr/all');
  log('ticker_v2_all', { status: v2.status, ms: v2.ms, bytes: v2.bytes, rows: v2.json.result.length, keys: Object.keys(v2.json.result[0]) });
  const v1 = await get('/md/ticker/24hr/all');
  log('ticker_v1_all', { status: v1.status, ms: v1.ms, bytes: v1.bytes, rows: v1.json.result.length, sample: v1.json.result.find((x) => x.symbol === 'BTCUSD') });

  const f = await get('/contract-biz/public/real-funding-rates?pageSize=200');
  keep('real_funding_rates.json', f.text);
  const frows = f.json.data.rows;
  const fDefault = await get('/contract-biz/public/real-funding-rates');
  const byInterval = {};
  for (const x of frows) byInterval[x.fundingInterval] = (byInterval[x.fundingInterval] || 0) + 1;
  const caps = {};
  for (const x of frows) caps[`${x.fundingRateCap}/${x.fundingRateFloor}`] = (caps[`${x.fundingRateCap}/${x.fundingRateFloor}`] || 0) + 1;
  const next = {};
  for (const x of frows) next[`${x.fundingInterval}@${iso(x.nextfundingTime)}`] = (next[`${x.fundingInterval}@${iso(x.nextfundingTime)}`] || 0) + 1;
  log('real_funding_rates', {
    status: f.status,
    ms: f.ms,
    bytes: f.bytes,
    total: f.json.data.total,
    rows: frows.length,
    defaultPageRows: fDefault.json.data.rows.length,
    keys: Object.keys(frows[0]),
    byInterval,
    capFloor: caps,
    interestByInterval: frows.reduce((m, x) => ((m[`${x.interestRate}@${x.fundingInterval}`] = (m[`${x.interestRate}@${x.fundingInterval}`] || 0) + 1), m), {}),
    fundingZero: frows.filter((x) => Number(x.fundingRate) === 0).length,
    nextSettlement: next,
    tickerSymbolsMissing: [...syms].filter((s) => !frows.some((x) => x.symbol === s)),
    extraRows: frows.filter((x) => !syms.has(x.symbol)).map((x) => x.symbol),
    remaining: f.remaining,
    capacity: f.capacity,
  });
  const tick = Object.fromEntries(rows.map((x) => [x.symbol, x]));
  const cmp = frows.filter((x) => tick[x.symbol]);
  log('funding_fields_compared', {
    rfrEqualsTickerFunding: cmp.filter((x) => Number(x.fundingRate) === Number(tick[x.symbol].fundingRateRr)).length,
    rfrEqualsTickerPred: cmp.filter((x) => Number(x.fundingRate) === Number(tick[x.symbol].predFundingRateRr)).length,
    tickerFundingEqualsPred: rows.filter((x) => x.fundingRateRr === x.predFundingRateRr).length,
    of: cmp.length,
    sample: ['BTCUSDT', 'ETHUSDT', 'TSLAUSDT', 'PATHUSDT'].map((s) => ({
      s,
      tickerFunding: tick[s]?.fundingRateRr,
      tickerPred: tick[s]?.predFundingRateRr,
      rfr: frows.find((x) => x.symbol === s),
    })),
  });
  return { rows, frows, listedV2 };
}

async function fundingHistory(listedV2) {
  for (const s of ['BTCUSDT', 'ETHUSDT', 'TSLAUSDT', 'PATHUSDT']) {
    const p = listedV2.find((x) => x.symbol === s);
    if (!p) continue;
    const r = await get(`/api-data/public/data/funding-rate-history?symbol=${encodeURIComponent(p.fundingRate8hSymbol)}&limit=4`);
    const rr = await get(`/api-data/public/data/funding-rate-history?symbol=${encodeURIComponent(p.fundingRateSymbol)}&limit=4`);
    log('funding_history', {
      symbol: s,
      fr8hSymbol: p.fundingRate8hSymbol,
      status: r.status,
      ms: r.ms,
      rows: (r.json?.data?.rows || []).map((x) => `${iso(x.fundingTime)} ${x.fundingRate} ${x.intervalSeconds}s`),
      frSymbol: p.fundingRateSymbol,
      frRows: (rr.json?.data?.rows || []).map((x) => `${iso(x.fundingTime)} ${x.fundingRate} ${x.intervalSeconds}s`),
      frReply: rr.json?.data ? undefined : rr.text.slice(0, 200),
    });
    await sleep(250);
  }
}

async function baskets(listedV2) {
  const r = await get('/public/index-sources');
  keep('index_sources.json', r.text);
  const data = r.json.data;
  const bySym = Object.fromEntries(data.map((x) => [x.indexSymbol, x.references]));
  const exch = {};
  const rows = [];
  for (const p of listedV2) {
    const refs = bySym[p.indexSymbol];
    if (!refs) {
      rows.push({ s: p.symbol, n: 0 });
      continue;
    }
    const total = refs.reduce((a, x) => a + x.weight, 0);
    const self = refs.filter((x) => /PHEMEX/i.test(x.exchange)).reduce((a, x) => a + x.weight, 0);
    const top = Math.max(...refs.map((x) => x.weight));
    for (const x of refs) exch[x.exchange] = (exch[x.exchange] || 0) + 1;
    const core = p.baseCurrency.replace(/^\d+\s*/, '');
    const nameDiffers = !refs.some((x) => x.refSymbol.startsWith(core));
    rows.push({ s: p.symbol, nameDiffers, n: refs.length, selfShare: total ? self / total : 0, topShare: total ? top / total : 0, refs: refs.map((x) => `${x.exchange}:${x.refSymbol}:${x.weight}`).join(' ') });
  }
  const dist = {};
  for (const x of rows) dist[x.n] = (dist[x.n] || 0) + 1;
  log('index_sources', {
    status: r.status,
    ms: r.ms,
    bytes: r.bytes,
    indices: data.length,
    listedWithoutBasket: rows.filter((x) => x.n === 0).map((x) => x.s),
    sourceCountDistribution: dist,
    exchanges: exch,
    selfReferencing: rows.filter((x) => x.selfShare > 0).map((x) => `${x.s} ${x.selfShare.toFixed(2)}`),
    singleSource: rows.filter((x) => x.n === 1).map((x) => `${x.s} ${x.refs}`),
    refNameDiffers: rows.filter((x) => x.nameDiffers).map((x) => `${x.s} ${x.refs}`),
    topShareOver70: rows.filter((x) => x.topShare > 0.7 && x.n > 1).map((x) => `${x.s} ${x.refs}`),
  });
  for (const s of ['BTCUSDT', 'TSLAUSDT', 'XAUUSDT', 'OPENAIUSDT', 'PATHUSDT']) {
    const x = rows.find((y) => y.s === s);
    if (x) log('basket', x);
  }
}

async function books() {
  for (const [path, label] of [
    ['/md/v2/orderbook?symbol=BTCUSDT', 'usdt'],
    ['/md/v2/orderbook?symbol=BTCUSDC', 'usdc'],
    ['/md/orderbook?symbol=BTCUSD', 'coinM'],
    ['/md/fullbook?symbol=BTCUSDT', 'fullbook_usdt'],
    ['/md/v2/fullbook?symbol=BTCUSDT', 'v2_fullbook_usdt'],
  ]) {
    const r = await get(path);
    const res = r.json?.result;
    const book = res?.orderbook_p || res?.book;
    const desc = (a) => a.every((x, i) => i === 0 || Number(x[0]) < Number(a[i - 1][0]));
    const asc = (a) => a.every((x, i) => i === 0 || Number(x[0]) > Number(a[i - 1][0]));
    log('rest_book', {
      label,
      path,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      cache: r.cache,
      keys: res ? Object.keys(res) : null,
      depth: res?.depth,
      bids: book?.bids?.length,
      asks: book?.asks?.length,
      bidsDescending: book ? desc(book.bids) : null,
      asksAscending: book ? asc(book.asks) : null,
      top: book ? { bid: book.bids[0], ask: book.asks[0] } : r.text.slice(0, 200),
      seq: res?.sequence,
    });
    await sleep(250);
  }
  const a = await get('/md/v2/orderbook?symbol=BTCUSDT');
  const b = await get('/md/v2/orderbook?symbol=BTCUSDT');
  log('rest_book_repeat', { sameSequence: a.json.result.sequence === b.json.result.sequence, seqA: a.json.result.sequence, seqB: b.json.result.sequence, cacheB: b.cache });
}

async function errors() {
  for (const path of [
    '/md/v3/ticker/24hr?symbol=NOPEUSDT',
    '/md/v2/orderbook?symbol=NOPEUSDT',
    '/md/v2/orderbook',
    '/md/v2/orderbook?symbol=BTCUSD',
    '/md/v3/ticker/24hr?symbol=LSKUSDT',
    '/contract-biz/public/real-funding-rates?symbol=NOPEUSDT',
    '/api-data/public/data/funding-rate-history?symbol=NOPE',
    '/public/nope',
    '/api-data/futures/fee-rate?settleCurrency=USDT',
  ]) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, ms: r.ms, body: r.text.slice(0, 220) });
    await sleep(250);
  }
}

async function poll() {
  const rounds = 60;
  const tickerMs = [];
  const rfrMs = [];
  const tickerBytes = [];
  const counters = [];
  const prev = new Map();
  const changes = new Map();
  const prevF = new Map();
  const changesF = new Map();
  const ages = [];
  let markRows = 0;
  let markEqualsLast = 0;
  let statusOther = 0;
  const cache = {};
  const bump = (k) => (cache[k] = (cache[k] || 0) + 1);
  for (let i = 0; i < rounds; i++) {
    const start = Date.now();
    const t = await get('/md/v3/ticker/24hr/all');
    if (t.status !== 200) statusOther++;
    bump(`ticker ${t.cache}`);
    if (t.cache && t.cache.startsWith('Hit')) bump(`ticker hit age ${t.age}`);
    tickerMs.push(t.ms);
    tickerBytes.push(t.bytes);
    for (const x of t.json?.result || []) {
      markRows++;
      if (x.markRp === x.lastRp) markEqualsLast++;
      const cur = { index: x.indexRp, mark: x.markRp, funding: x.fundingRateRr, pred: x.predFundingRateRr, ts: x.timestamp };
      const p = prev.get(x.symbol);
      const c = changes.get(x.symbol) || { index: 0, mark: 0, funding: 0, pred: 0, ts: 0 };
      if (p) for (const k of Object.keys(c)) if (p[k] !== cur[k]) c[k]++;
      changes.set(x.symbol, c);
      prev.set(x.symbol, cur);
      if (x.symbol === 'BTCUSDT') ages.push(Date.now() - Number(BigInt(x.timestamp) / 1000000n));
    }
    await sleep(Math.max(0, 500 - (Date.now() - start)));
    const f = await get('/contract-biz/public/real-funding-rates?pageSize=200');
    if (f.status !== 200) statusOther++;
    bump(`rfr ${f.cache}`);
    rfrMs.push(f.ms);
    counters.push(`${f.remaining}/${f.capacity}`);
    for (const x of f.json?.data?.rows || []) {
      const cur = { funding: x.fundingRate, next: x.nextfundingTime, interest: x.interestRate };
      const p = prevF.get(x.symbol);
      const c = changesF.get(x.symbol) || { funding: 0, next: 0, interest: 0 };
      if (p) for (const k of Object.keys(c)) if (p[k] !== cur[k]) c[k]++;
      changesF.set(x.symbol, c);
      prevF.set(x.symbol, cur);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  const summary = (arr) => ({ min: Math.min(...arr), median: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) });
  log('poll_times', { rounds, tickerMs: summary(tickerMs), rfrMs: summary(rfrMs), tickerBytes: summary(tickerBytes), over1s: tickerMs.filter((x) => x > 1000).length + rfrMs.filter((x) => x > 1000).length, statusOther });
  log('poll_cdn_cache', cache);
  log('poll_rate_counter', { first: counters.slice(0, 3), last: counters.slice(-3), distinct: [...new Set(counters)].length });
  log('poll_btc_ticker_age_ms', summary(ages));
  log('poll_mark_equals_last', { rows: markRows, equal: markEqualsLast });
  for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TSLAUSDT', 'XAUUSDT', 'PATHUSDT', 'BTCUSDC']) {
    log('poll_changes', { symbol: s, of: rounds - 1, ticker: changes.get(s), rfr: changesF.get(s) });
  }
  const all = [...changes.values()];
  const dist = (k) => ({ zero: all.filter((c) => c[k] === 0).length, median: pct(all.map((c) => c[k]), 50), max: Math.max(...all.map((c) => c[k])) });
  log('poll_changes_all', { symbols: all.length, index: dist('index'), mark: dist('mark'), funding: dist('funding'), pred: dist('pred'), ts: dist('ts') });
  const allF = [...changesF.values()];
  log('poll_changes_rfr_all', { symbols: allF.length, fundingChangedOnSymbols: allF.filter((c) => c.funding > 0).length, nextChangedOnSymbols: allF.filter((c) => c.next > 0).length });
}

const mode = process.argv[2] || 'main';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'main') {
  await host();
  const { markets, listedV2 } = await catalog();
  await anchorShapes(listedV2, markets);
  await fundingHistory(listedV2);
  await baskets(listedV2);
  await books();
  await errors();
  await serverTime();
} else if (mode === 'poll') {
  await poll();
}
log('done', { at: new Date().toISOString() });
