// Bullish REST probe: what the production API answers this host, and the catalog, anchor fields, book snapshot, errors, limits and clock on the SimNext test environment.
// Public, unauthenticated, read-only. Production refuses this host by location, so nothing here routes around that refusal, and SimNext is the venue's own public test environment.
// Run from server/: node ../scripts/probes/venues/bullish/rest-probe.mjs [access|sim|poll]
//   access  production REST paths and CCXT loadMarkets against production: status, bytes, time, refusal text, and the Cloudflare colo. About 10 s.
//   sim     SimNext catalog by type, CCXT sandbox mapping of the perpetuals, tick, index prices, funding history, REST book, errors, rate limit headers, clock. About 20 s.
//   poll    30 one-second polls of the SimNext tick on a busy and a quiet perpetual and of the bulk index prices, counting how often each anchor number changed. About 35 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bullish/rest.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const PROD = 'https://api.exchange.bullish.com/trading-api';
const SIM = 'https://api.simnext.bullish-test.com/trading-api';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const h = (k) => res.headers.get(k);
  return {
    status: res.status,
    ms,
    bytes: text.length,
    text,
    headers: {
      ray: h('cf-ray'),
      cache: h('cf-cache-status'),
      cacheControl: h('cache-control'),
      limit: h('x-ratelimit-limit'),
      remaining: h('x-ratelimit-remaining'),
      reset: h('x-ratelimit-reset'),
      globalBreach: h('x-ratelimit-global-breach'),
      retryAfter: h('retry-after'),
      date: h('date'),
    },
  };
}

function refusalText(text) {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function access() {
  for (const host of ['api.exchange.bullish.com', 'api.simnext.bullish-test.com', 'docs.exchange.bullish.com']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }
  const paths = [
    '/v1/time',
    '/v1/markets',
    '/v1/markets?marketType=PERPETUAL',
    '/v1/markets/BTC-USDC-PERP/tick',
    '/v1/markets/BTC-USDC-PERP/orderbook/hybrid',
    '/v1/index-prices',
    '/v1/history/markets/BTC-USDC-PERP/funding-rate',
  ];
  for (const p of paths) {
    const r = await get(PROD + p);
    log('prod', { path: p, status: r.status, ms: r.ms, bytes: r.bytes, ray: r.headers.ray, body: refusalText(r.text) });
    keep(`prod${p.replace(/[/?=]/g, '_')}.html`, r.text);
  }
  const ex = new ccxt.bullish();
  const t0 = performance.now();
  try {
    await ex.loadMarkets();
    log('ccxt_prod', { ok: true, markets: Object.keys(ex.markets).length });
  } catch (e) {
    log('ccxt_prod', { ok: false, ms: Math.round(performance.now() - t0), error: e.constructor.name, message: String(e.message).slice(0, 160) });
  }
  for (const u of ['https://docs.exchange.bullish.com/', SIM + '/v1/time']) {
    const r = await get(u);
    log('other_host', { url: u, status: r.status, ms: r.ms, bytes: r.bytes });
  }
}

async function sim() {
  const cold = await get(SIM + '/v1/time');
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push((await get(SIM + '/v1/time')).ms);
  log('sim_latency', { coldMs: cold.ms, warmMs: warm });

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(SIM + '/v1/time');
    const t1 = Date.now();
    offsets.push(JSON.parse(r.text).timestamp - (t0 + t1) / 2);
  }
  log('sim_clock', { offsetMs: offsets.map(Math.round), sample: JSON.parse(cold.text) });

  const m = await get(SIM + '/v1/markets');
  keep('sim-markets.json', m.text);
  const markets = JSON.parse(m.text);
  const byType = {};
  for (const x of markets) {
    const k = `${x.marketType}|${x.marketEnabled ? 'enabled' : 'disabled'}`;
    byType[k] = (byType[k] ?? 0) + 1;
  }
  log('sim_catalog', { ms: m.ms, bytes: m.bytes, rows: markets.length, byType, headers: m.headers });
  const perps = markets.filter((x) => x.marketType === 'PERPETUAL');
  const settle = {};
  const mult = {};
  for (const p of perps) {
    settle[p.settlementAssetSymbol] = (settle[p.settlementAssetSymbol] ?? 0) + 1;
    mult[p.contractMultiplier] = (mult[p.contractMultiplier] ?? 0) + 1;
  }
  log('sim_perps', {
    total: perps.length,
    enabled: perps.filter((p) => p.marketEnabled).map((p) => p.symbol),
    disabled: perps.filter((p) => !p.marketEnabled).length,
    settle,
    contractMultiplier: mult,
    fields: Object.keys(perps[0]).filter((k) => k !== 'feeTiers'),
  });
  const filtered = await get(SIM + '/v1/markets?marketType=PERPETUAL');
  log('sim_perp_filter', { ms: filtered.ms, bytes: filtered.bytes, rows: JSON.parse(filtered.text).length });

  const ex = new ccxt.bullish();
  ex.setSandboxMode(true);
  await ex.loadMarkets();
  const swaps = Object.values(ex.markets).filter((x) => x.swap);
  const pairs = {};
  for (const s of swaps) pairs[`${s.base}/${s.quote}`] = (pairs[`${s.base}/${s.quote}`] ?? 0) + 1;
  log('ccxt_sandbox', {
    swaps: swaps.length,
    active: swaps.filter((s) => s.active).length,
    takers: [...new Set(swaps.map((s) => s.taker))],
    makers: [...new Set(swaps.map((s) => s.maker))],
    contractSizes: [...new Set(swaps.map((s) => s.contractSize))],
    linear: [...new Set(swaps.map((s) => s.linear))],
    pairsListedTwice: Object.entries(pairs).filter(([, n]) => n > 1),
    btc: (({ id, symbol, base, quote, settle, linear, contractSize, taker, maker, active }) => ({ id, symbol, base, quote, settle, linear, contractSize, taker, maker, active }))(ex.market('BTC/USDC:USDC')),
  });

  for (const sym of ['BTC-USDC-PERP', 'ETH-USDC-PERP', 'CHZ-USDC-PERP']) {
    const t = await get(`${SIM}/v1/markets/${sym}/tick`);
    keep(`sim-tick-${sym}.json`, t.text);
    const j = JSON.parse(t.text);
    log('sim_tick', { sym, status: t.status, ms: t.ms, bytes: t.bytes, markPrice: j.markPrice, fundingRate: j.fundingRate, indexPrice: j.indexPrice, bestBid: j.bestBid, bestAsk: j.bestAsk, createdAtTimestamp: j.createdAtTimestamp, publishedAtTimestamp: j.publishedAtTimestamp, cache: t.headers.cache, cacheControl: t.headers.cacheControl, rateLimit: [t.headers.limit, t.headers.remaining, t.headers.reset, t.headers.globalBreach], keys: Object.keys(j).filter((k) => k !== 'ammData') });
  }
  const spot = await get(`${SIM}/v1/markets/BTCUSDC/tick`);
  log('sim_tick_spot', { status: spot.status, body: spot.text.slice(0, 200) });

  const idx = await get(SIM + '/v1/index-prices');
  keep('sim-index-prices.json', idx.text);
  const rows = JSON.parse(idx.text);
  const bySym = Object.fromEntries(rows.map((r) => [r.assetSymbol, r]));
  const ages = rows.map((r) => Date.now() - Number(r.updatedAtTimestamp)).sort((a, b) => a - b);
  log('sim_index', {
    ms: idx.ms,
    bytes: idx.bytes,
    rows: rows.length,
    ageMsMin: ages[0],
    ageMsMedian: ages[Math.floor(ages.length / 2)],
    ageMsMax: ages[ages.length - 1],
    perpBasesMissing: perps.filter((p) => p.marketEnabled && !bySym[p.underlyingBaseSymbol]).map((p) => p.underlyingBaseSymbol),
    samples: ['BTC', 'ETH', 'USDC', 'CD20', 'SHIB1M', 'CMWTI', 'CHZ'].map((s) => [s, bySym[s]?.price]),
  });

  const fh = await get(SIM + '/v1/history/markets/BTC-USDC-PERP/funding-rate');
  keep('sim-funding-history.json', fh.text);
  const hist = JSON.parse(fh.text);
  log('sim_funding_history', { status: fh.status, ms: fh.ms, rows: hist.length, first: hist[0], last: hist[hist.length - 1], rateCounts: hist.reduce((c, h) => ({ ...c, [h.fundingRate]: (c[h.fundingRate] ?? 0) + 1 }), {}), minuteSecond: [...new Set(hist.map((h) => h.updatedAtDatetime.slice(14)))] });

  const ob = await get(SIM + '/v1/markets/BTC-USDC-PERP/orderbook/hybrid');
  const book = JSON.parse(ob.text);
  const bp = book.bids.map((l) => Number(l.price));
  const ap = book.asks.map((l) => Number(l.price));
  log('sim_rest_book', {
    ms: ob.ms,
    bytes: ob.bytes,
    bids: book.bids.length,
    asks: book.asks.length,
    bidsDescending: bp.every((p, i) => i === 0 || p < bp[i - 1]),
    asksAscending: ap.every((p, i) => i === 0 || p > ap[i - 1]),
    sequenceNumber: book.sequenceNumber,
    timestamp: book.timestamp,
    keys: Object.keys(book),
    levelKeys: Object.keys(book.bids[0] ?? {}),
    cache: ob.headers.cache,
    cacheControl: ob.headers.cacheControl,
  });
  for (const q of ['?depth=5', '?limit=5', '?aggregate=true']) {
    const r = await get(`${SIM}/v1/markets/BTC-USDC-PERP/orderbook/hybrid${q}`);
    const b = JSON.parse(r.text);
    log('sim_rest_book_param', { q, status: r.status, bids: b.bids?.length, asks: b.asks?.length });
  }

  for (const p of ['/v1/markets/NOPE-USDC-PERP/tick', '/v1/markets/NOPE-USDC-PERP', '/v1/markets/NOPE-USDC-PERP/orderbook/hybrid', '/v1/index-prices/NOPE', '/v1/history/markets/NOPE-USDC-PERP/funding-rate', '/v1/markets/FTM-USDC-PERP/tick']) {
    const r = await get(SIM + p);
    log('sim_error', { path: p, status: r.status, body: r.text.slice(0, 220) });
  }
}

async function poll() {
  const syms = ['BTC-USDC-PERP', 'CHZ-USDC-PERP'];
  const seen = Object.fromEntries(syms.map((s) => [s, { mark: [], rate: [], created: [], ms: [] }]));
  const index = { price: [], ts: [], ms: [] };
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    const replies = await Promise.all([...syms.map((s) => get(`${SIM}/v1/markets/${s}/tick`)), get(`${SIM}/v1/index-prices`)]);
    syms.forEach((s, k) => {
      const j = JSON.parse(replies[k].text);
      seen[s].mark.push(j.markPrice);
      seen[s].rate.push(j.fundingRate);
      seen[s].created.push(j.createdAtTimestamp);
      seen[s].ms.push(replies[k].ms);
    });
    const btc = JSON.parse(replies[syms.length].text).find((r) => r.assetSymbol === 'BTC');
    index.price.push(btc.price);
    index.ts.push(btc.updatedAtTimestamp);
    index.ms.push(replies[syms.length].ms);
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  const changes = (a) => a.filter((v, i) => i > 0 && v !== a[i - 1]).length;
  const q = (a) => { const s = [...a].sort((p, r) => p - r); return { min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] }; };
  for (const s of syms) {
    log('sim_poll_tick', { sym: s, polls: 30, markChanges: changes(seen[s].mark), rateChanges: changes(seen[s].rate), createdChanges: changes(seen[s].created), rates: [...new Set(seen[s].rate)], ms: q(seen[s].ms) });
  }
  log('sim_poll_index', { asset: 'BTC', polls: 30, priceChanges: changes(index.price), timestampChanges: changes(index.ts), ms: q(index.ms) });
}

const mode = process.argv[2] ?? 'access';
const modes = { access, sim, poll };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
