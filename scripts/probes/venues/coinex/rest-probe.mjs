// CoinEx v2 public REST probe: latency, clock offset, the futures catalog and how CCXT maps it, the anchor calls, the REST book, and the evidence that futures stopped trading.
// Public, unauthenticated, read-only, well under the published limits (at most five requests a second).
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coinex/rest-probe.mjs [catalog|anchor|depth]
//   catalog  latency, server time, catalog counts, frozen-state evidence, CCXT 4.5.68 loadMarkets mapping. About 15 s.
//   anchor   20 one second polls of futures/ticker and futures/funding-rate, reply size and time, how often mark and index changed, one Binance comparison. About 25 s.
//   depth    REST futures depth on every eighth perpetual, 28 of 221, at five a second, plus the BTCUSDT funding history and last trades. About 10 s.
// Recorded in docs/profiles/coinex/rest.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.coinex.com/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : ms);

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${path}`);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  return { status: res.status, ms, bytes: text.length, body: JSON.parse(text), headers: res.headers };
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key];
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

async function catalog() {
  const timings = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('time');
    const t1 = Date.now();
    timings.push({ ms: r.ms, offsetMs: r.body.data.timestamp - Math.round((t0 + t1) / 2) });
    await sleep(250);
  }
  log('time', { status: 200, runs: timings, pop: 'see headers' });
  const ping = await get('ping');
  log('ping', { status: ping.status, ms: ping.ms, body: ping.body, pop: ping.headers.get('x-amz-cf-pop'), cache: ping.headers.get('x-cache') });
  const maint = await get('maintain/info');
  log('maintain', { status: maint.status, body: maint.body });

  const m = await get('futures/market');
  const markets = m.body.data;
  log('futures/market', {
    status: m.status, ms: m.ms, bytes: m.bytes, count: markets.length,
    byFamily: countBy(markets, (r) => `${r.contract_type}/${r.quote_ccy}/${r.status}`),
    isMarketAvailable: countBy(markets, 'is_market_available'),
    isApiTradingAvailable: countBy(markets, 'is_api_trading_available'),
    delistedAt: countBy(markets, 'delisted_at'),
    fees: countBy(markets, (r) => `${r.maker_fee_rate}/${r.taker_fee_rate}`),
    openInterestVolume: countBy(markets, (r) => (r.open_interest_volume === '0' ? 'zero' : 'nonzero')),
    inverse: markets.filter((r) => r.contract_type === 'inverse').map((r) => r.market),
  });

  const now = Date.now();
  const t = await get('futures/ticker');
  const f = await get('futures/funding-rate');
  const idx = await get('futures/index');
  const tick = t.body.data;
  const fund = f.body.data;
  const index = idx.body.data;
  log('frozen', {
    tickerVolumeZero: tick.filter((r) => r.volume === '0').length + ' of ' + tick.length,
    markEqualsIndex: tick.filter((r) => r.mark_price === r.index_price).length,
    nextFundingTime: countBy(fund, (r) => iso(r.next_funding_time)),
    nextFundingInPast: fund.filter((r) => r.next_funding_time < now).length + ' of ' + fund.length,
    fundingIntervalH: countBy(fund, (r) => (r.next_funding_time - r.latest_funding_time) / 3_600_000),
    fundingCap: countBy(fund, (r) => `${r.min_funding_rate}/${r.max_funding_rate}`),
    indexCreatedAt: { min: iso(Math.min(...index.map((r) => r.created_at))), max: iso(Math.max(...index.map((r) => r.created_at))) },
    btc: { ticker: tick.find((r) => r.market === 'BTCUSDT'), funding: fund.find((r) => r.market === 'BTCUSDT') },
    btcIndexSources: index.find((r) => r.market === 'BTCUSDT')?.sources,
  });

  const ex = new ccxt.coinex();
  const loaded = await ex.loadMarkets();
  const swaps = Object.values(loaded).filter((x) => x.type === 'swap' && x.swap === true && x.active !== false);
  log('ccxt', {
    version: ccxt.version,
    swaps: swaps.length,
    active: countBy(swaps, (x) => String(x.active)),
    linear: countBy(swaps, (x) => String(x.linear)),
    settleByQuote: countBy(swaps, (x) => `${x.quote}:${x.settle}`),
    contractSize: countBy(swaps, (x) => String(x.contractSize)),
    taker: countBy(swaps, (x) => String(x.taker)),
    maker: countBy(swaps, (x) => String(x.maker)),
    idEqualsRest: swaps.filter((x) => markets.some((r) => r.market === x.id)).length,
    sample: swaps.filter((x) => ['BTCUSDT', 'BTCUSDC', 'BTCUSD'].includes(x.id)).map((x) => ({ id: x.id, symbol: x.symbol, settle: x.settle, contractSize: x.contractSize, taker: x.taker })),
    pairsListedTwice: Object.entries(countBy(swaps, (x) => `${x.base}/${x.quote}`)).filter(([, n]) => n > 1).length,
    basesOnTwoQuotes: Object.entries(countBy(swaps, (x) => x.base)).filter(([, n]) => n > 1).map(([b]) => b),
  });
}

async function anchor() {
  const seen = { mark: new Set(), index: new Set(), next: new Set() };
  const t = [];
  const fz = [];
  let bytes = {};
  for (let i = 0; i < 20; i++) {
    const a = await get('futures/ticker');
    const b = await get('futures/funding-rate');
    t.push(a.ms);
    fz.push(b.ms);
    bytes = { ticker: a.bytes, funding: b.bytes };
    const row = a.body.data.find((r) => r.market === 'BTCUSDT');
    const fr = b.body.data.find((r) => r.market === 'BTCUSDT');
    seen.mark.add(row.mark_price);
    seen.index.add(row.index_price);
    seen.next.add(fr.next_funding_time);
    await sleep(1000);
  }
  const all = (await get('futures/ticker')).body.data;
  const stats = (xs) => ({ min: Math.min(...xs), median: [...xs].sort((p, q) => p - q)[xs.length >> 1], max: Math.max(...xs) });
  log('anchor-polls', { polls: 20, tickerMs: stats(t), fundingMs: stats(fz), bytes, btcDistinct: { mark: [...seen.mark], index: [...seen.index], nextFundingTime: [...seen.next].map(iso) } });

  const bn = await (await fetch('https://fapi.binance.com/fapi/v1/premiumIndex')).json();
  const bnBy = new Map(bn.map((r) => [r.symbol, r]));
  const cmp = [];
  for (const r of all) {
    const b = bnBy.get(r.market);
    if (!b) continue;
    cmp.push({ m: r.market, dev: (Number(r.index_price) / Number(b.indexPrice) - 1) * 1e6 });
  }
  const abs = cmp.map((c) => Math.abs(c.dev)).sort((p, q) => p - q);
  log('index-vs-binance', {
    matched: cmp.length,
    medianAbsPpm: Math.round(abs[abs.length >> 1]),
    over1000ppm: abs.filter((x) => x > 1000).length,
    btc: cmp.filter((c) => ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(c.m)).map((c) => ({ m: c.m, ppm: Math.round(c.dev) })),
  });
}

async function depth() {
  const markets = (await get('futures/market')).body.data.map((r) => r.market);
  const pick = markets.filter((_, i) => i % Math.ceil(markets.length / 30) === 0).slice(0, 30);
  const out = { empty: 0, nonEmpty: [], checksum: {}, ms: [] };
  for (const m of pick) {
    const r = await get(`futures/depth?market=${m}&limit=50&interval=0`);
    const d = r.body.data.depth;
    out.ms.push(r.ms);
    if (d.asks.length === 0 && d.bids.length === 0) out.empty++;
    else out.nonEmpty.push({ m, asks: d.asks.length, bids: d.bids.length });
    out.checksum[d.checksum] = (out.checksum[d.checksum] ?? 0) + 1;
    await sleep(200);
  }
  log('futures-depth', { sampled: pick.length, empty: out.empty, nonEmpty: out.nonEmpty, checksum: out.checksum, msMax: Math.max(...out.ms) });
  const spot = await get('spot/depth?market=BTCUSDT&limit=50&interval=0');
  const sd = spot.body.data.depth;
  log('spot-depth', { status: spot.status, asks: sd.asks.length, bids: sd.bids.length, bestBid: sd.bids[0], bestAsk: sd.asks[0] });
  const hist = await get('futures/funding-rate-history?market=BTCUSDT&limit=8');
  log('funding-history', { rows: hist.body.data.map((r) => ({ t: iso(r.funding_time), actual: r.actual_funding_rate, theoretical: r.theoretical_funding_rate })) });
  const deals = await get('futures/deals?market=BTCUSDT&limit=3');
  log('last-deals', { rows: deals.body.data.map((r) => ({ t: iso(r.created_at), price: r.price, amount: r.amount })) });
  const bad = await get('futures/depth?market=NOPEUSDT&limit=50&interval=0');
  log('unknown-market', { status: bad.status, body: bad.body });
}

const mode = process.argv[2] ?? 'catalog';
await ({ catalog, anchor, depth })[mode]();
