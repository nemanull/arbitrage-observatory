// PointPay public REST probe: latency and clock, the futures catalog against Bybit linear, the futures books and tickers against Bybit at the same instant, the bulk contracts reply as an anchor, and error shapes.
// Public, unauthenticated, read-only. Every mode stays far inside the 500 requests per 60 s that the x-ratelimit headers announce.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/pointpay/rest-probe.mjs [latency|catalog|mirror|anchor|limits|reference|all]
//   latency  DNS, 10 calls to the pairs list on a new connection each and 10 on a kept-alive one, clock offset from the Date header and the book ts. About 30 s.
//   catalog  futures pairs list, CoinGecko and CoinMarketCap contracts, full pair data for a sample, the CCXT 4.5.68 exchange list, and Bybit linear instruments for comparison.
//   mirror   PointPay futures book and full pair data next to Bybit linear book and ticker at the same instant, five rounds on four pairs. About 30 s.
//   anchor   the CoinGecko contracts reply and pair-data/BTCUSDT polled for 60 s each at a 1 s target, with Bybit tickers as the reference.
//   limits   unknown pair, bad path and method replies, rate limit headers over 20 calls, response caching.
//   reference  Bybit funding history and the BTCUSDT index basket, and three guessed PointPay paths for either. A few seconds.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/pointpay/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.pointpay.io';
const FAPI = `${API}/fapi/v1/public/trade`;
const CG_CONTRACTS = `${API}/public/coingecko/futures/contracts`;
const CMC_CONTRACTS = `${API}/public/cmc/futures/contracts`;
const BYBIT = 'https://api.bybit.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json' }, ...init });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json, ms: Math.round(ms), ttfb: Math.round(ttfb), recv: Date.now() };
}

// A new TCP and TLS connection per call, since fetch keeps its connections alive.
function coldGet(url) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let secureMs = null;
    const req = https.get(url, { agent: false, headers: { accept: 'application/json' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Math.round(performance.now() - t0), secureMs }));
    });
    req.on('socket', (sock) => sock.on('secureConnect', () => (secureMs = Math.round(performance.now() - t0))));
    req.on('error', reject);
  });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function latency() {
  for (const host of ['api.pointpay.io', 'exchange.pointpay.io', 'ws-futures.pointpay.io', 'back.pointpay.io']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: String(e.code) }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }
  const cold = [];
  const connect = [];
  for (let i = 0; i < 10; i++) {
    const r = await coldGet(`${FAPI}/pairs`);
    cold.push(r.ms);
    connect.push(r.secureMs);
    await sleep(300);
  }
  log('latency_cold_pairs', { total: stats(cold), tlsDone: stats(connect) });
  const warm = [];
  let last;
  for (let i = 0; i < 10; i++) {
    last = await get(`${FAPI}/pairs`);
    warm.push(last.ms);
    await sleep(300);
  }
  log('latency_warm_pairs', { ...stats(warm), bytes: last.text.length, cfRay: last.headers.get('cf-ray'), server: last.headers.get('server') });
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${FAPI}/order-book/BTCUSDT`);
    const mid = (t0 + r.recv) / 2;
    const b = r.json?.response;
    offsets.push({ dateHeaderMinusMid: Date.parse(r.headers.get('date')) - mid, tsMinusMid: b ? b.ts - mid : null, ctsMinusMid: b ? b.cts - mid : null, rtt: r.recv - t0 });
    await sleep(500);
  }
  log('clock', { samples: offsets.map((o) => ({ date: Math.round(o.dateHeaderMinusMid), ts: Math.round(o.tsMinusMid), cts: Math.round(o.ctsMinusMid), rtt: o.rtt })) });
}

async function bybitLinear() {
  const rows = [];
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const r = await get(`${BYBIT}/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    rows.push(...(r.json?.result?.list ?? []));
    cursor = r.json?.result?.nextPageCursor;
    if (!cursor) break;
  }
  return rows;
}

async function catalog() {
  const pairs = await get(`${FAPI}/pairs`);
  keep('pairs.json', pairs.text);
  const list = pairs.json?.response ?? [];
  const byQuote = {};
  for (const p of list) byQuote[p.quotable] = (byQuote[p.quotable] ?? 0) + 1;
  const mods = {};
  for (const p of list) mods[p.modificator] = (mods[p.modificator] ?? 0) + 1;
  log('pairs', { status: pairs.status, ms: pairs.ms, bytes: pairs.text.length, count: list.length, byQuote, modificator: mods, keys: Object.keys(list[0] ?? {}), first: list[0], symbolIsBaseUnderscoreQuote: list.filter((p) => p.symbol === `${p.asset}_${p.quotable}`).length, pairIsBaseQuote: list.filter((p) => p.pair === `${p.asset}${p.quotable}`).length });

  const cg = await get(CG_CONTRACTS);
  keep('cg-contracts.json', cg.text);
  const cgRows = Array.isArray(cg.json) ? cg.json : [];
  const count = (rows, f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  log('cg_contracts', { status: cg.status, ms: cg.ms, bytes: cg.text.length, count: cgRows.length, product: count(cgRows, (r) => `${r.product_type}/${r.contract_type}/${r.target_currency}`), fees: count(cgRows, (r) => `${r.maker_fee}/${r.taker_fee}`), keys: Object.keys(cgRows[0] ?? {}), nextFunding: count(cgRows, (r) => new Date(r.next_funding_rate_timestamp).toISOString()), indexZero: cgRows.filter((r) => !(Number(r.index_price) > 0)).map((r) => r.ticker_id) });
  const cmc = await get(CMC_CONTRACTS);
  keep('cmc-contracts.json', cmc.text);
  const cmcRows = Array.isArray(cmc.json) ? cmc.json : [];
  log('cmc_contracts', { status: cmc.status, ms: cmc.ms, bytes: cmc.text.length, count: cmcRows.length, keys: Object.keys(cmcRows[0] ?? {}), fees: count(cmcRows, (r) => `${r.maker_fee}/${r.taker_fee}`) });

  const by = await bybitLinear();
  const byMap = new Map(by.map((i) => [i.symbol, i]));
  const onBybit = list.filter((p) => byMap.has(p.pair));
  const notOnBybit = list.filter((p) => !byMap.has(p.pair)).map((p) => p.pair);
  log('vs_bybit_linear', { bybitLinear: by.length, bybitTradingUsdtPerp: by.filter((i) => i.status === 'Trading' && i.contractType === 'LinearPerpetual' && i.settleCoin === 'USDT').length, pointpayOnBybit: onBybit.length, notOnBybit, bybitStatusOfListed: count(onBybit, (p) => byMap.get(p.pair).status), bybitTypeOfListed: count(onBybit, (p) => byMap.get(p.pair).contractType), bybitSymbolTypeOfListed: count(onBybit, (p) => byMap.get(p.pair).symbolType || '(empty)') });

  const sample = ['BTCUSDT', 'ETHUSDT', '1000BONKUSDT', list.find((p) => byMap.get(p.pair)?.symbolType && byMap.get(p.pair).symbolType !== 'innovation')?.pair, list[list.length - 1]?.pair].filter(Boolean);
  for (const s of [...new Set(sample)]) {
    const r = await get(`${FAPI}/full-pair-data/${s}`);
    keep(`full-pair-data-${s}.json`, r.text);
    const pd = r.json?.response?.pair_data ?? {};
    const td = r.json?.response?.trade_data ?? {};
    const b = byMap.get(s) ?? {};
    const same = ['contractType', 'status', 'priceScale', 'fundingInterval', 'upperFundingRate', 'lowerFundingRate', 'launchTime', 'symbolType'].filter((k) => JSON.stringify(pd[k]) === JSON.stringify(b[k]));
    log('full_pair_data', { symbol: s, status: r.status, ms: r.ms, contractType: pd.contractType, pairStatus: pd.status, settleCoin: pd.settleCoin, fundingInterval: pd.fundingInterval, fundingIntervalHour: td.fundingIntervalHour, fundingCap: td.fundingCap, upper: pd.upperFundingRate, lower: pd.lowerFundingRate, tick: pd.priceFilter?.tickSize, qtyStep: pd.lotSizeFilter?.qtyStep, symbolType: pd.symbolType, modificator: pd.modificator, sameAsBybitInstrument: same, lotEqual: JSON.stringify(pd.lotSizeFilter) === JSON.stringify(b.lotSizeFilter), priceFilterEqual: JSON.stringify(pd.priceFilter) === JSON.stringify(b.priceFilter) });
    await sleep(300);
  }

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, pointpayLike: ccxt.exchanges.filter((x) => /point|ppay/i.test(x)) });
}

async function pairAt(symbol) {
  const [pp, by, ppd, byt] = await Promise.all([
    get(`${FAPI}/order-book/${symbol}`),
    get(`${BYBIT}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=200`),
    get(`${FAPI}/full-pair-data/${symbol}`),
    get(`${BYBIT}/v5/market/tickers?category=linear&symbol=${symbol}`),
  ]);
  return { pp, by, ppd, byt };
}

async function mirror() {
  const symbols = ['BTCUSDT', 'ETHUSDT', '1000BONKUSDT', 'ALGOUSDT'];
  for (let round = 0; round < 5; round++) {
    for (const s of symbols) {
      const { pp, by, ppd, byt } = await pairAt(s);
      const a = pp.json?.response;
      const b = by.json?.result;
      const t = ppd.json?.response?.trade_data ?? {};
      const u = byt.json?.result?.list?.[0] ?? {};
      if (round === 0) keep(`book-${s}.json`, pp.text);
      const top = (x, y) => x.slice(0, 20).filter((l, i) => y[i] && l[0] === y[i][0] && l[1] === y[i][1]).length;
      const priceTop = (x, y) => x.slice(0, 20).filter((l, i) => y[i] && l[0] === y[i][0]).length;
      const descending = (xs) => xs.every((l, i) => i === 0 || Number(l[0]) < Number(xs[i - 1][0]));
      const ascending = (xs) => xs.every((l, i) => i === 0 || Number(l[0]) > Number(xs[i - 1][0]));
      log('mirror', {
        round, symbol: s,
        ppMs: pp.ms, byMs: by.ms,
        ppLevels: a ? [a.b.length, a.a.length] : pp.status, byLevels: b ? [b.b.length, b.a.length] : by.status,
        uDiff: a && b ? a.u - b.u : null, seqDiff: a && b ? a.seq - b.seq : null, ctsDiffMs: a && b ? a.cts - b.cts : null,
        top20SameLevel: a && b ? [top(a.b, b.b), top(a.a, b.a)] : null, top20SamePrice: a && b ? [priceTop(a.b, b.b), priceTop(a.a, b.a)] : null,
        order: a ? [descending(a.b), ascending(a.a)] : null,
        mark: [t.markPrice, u.markPrice], index: [t.indexPrice, u.indexPrice], funding: [t.fundingRate, u.fundingRate], nextFunding: [t.nextFundingTime, u.nextFundingTime],
        oiRatio: Number(u.openInterest) / Number(t.openInterest), volRatio: Number(u.volume24h) / Number(t.volume24h), turnoverRatio: Number(u.turnover24h) / Number(t.turnover24h),
        singleOiRatio: Number(u.singleOpenInterest) / Number(t.singleOpenInterest),
        sameStatic: ['prevPrice24h', 'highPrice24h', 'lowPrice24h', 'prevPrice1h', 'fundingRate', 'nextFundingTime', 'fundingIntervalHour', 'fundingCap'].filter((k) => t[k] === u[k]).length,
      });
      await sleep(150);
    }
    await sleep(1000);
  }
}

async function pollLoop(name, url, durationMs, pick) {
  const end = Date.now() + durationMs;
  const times = [];
  const changes = {};
  let prev = null;
  let polls = 0;
  let bytes = 0;
  const changeAt = []; // arrival time of each change of the first picked field
  const startedAt = Date.now();
  while (Date.now() < end) {
    const t0 = Date.now();
    const r = await get(url);
    polls++;
    times.push(r.ms);
    bytes = r.text.length;
    const cur = pick(r.json);
    if (prev && cur) {
      for (const [k, v] of Object.entries(cur)) if (prev[k] !== v) changes[k] = (changes[k] ?? 0) + 1;
      const first = Object.keys(cur)[0];
      if (prev[first] !== cur[first]) changeAt.push(r.recv - startedAt);
    }
    if (cur) prev = cur;
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  return { name, polls, bytes, ms: stats(times), over1s: times.filter((x) => x > 1000).length, over2s: times.filter((x) => x > 2000).length, changes, firstFieldChangedAtMs: changeAt };
}

async function anchor() {
  const cgPick = (j) => {
    if (!Array.isArray(j)) return null;
    const o = {};
    for (const id of ['BTC-USDT', 'ETH-USDT', 'ALGO-USDT', '1000BONK-USDT']) {
      const r = j.find((x) => x.ticker_id === id);
      if (r) {
        o[`${id}.index`] = r.index_price;
        o[`${id}.funding`] = r.funding_rate;
        o[`${id}.next`] = r.next_funding_rate;
        o[`${id}.bid`] = r.bid;
      }
    }
    return o;
  };
  const pdPick = (j) => {
    const t = j?.response;
    return t ? { mark: t.markPrice, index: t.indexPrice, funding: t.fundingRate, last: t.lastPrice } : null;
  };
  const results = await Promise.all([
    pollLoop('cg_contracts', CG_CONTRACTS, 60_000, cgPick),
    pollLoop('pair_data_BTCUSDT', `${FAPI}/pair-data/BTCUSDT`, 60_000, pdPick),
  ]);
  for (const r of results) log('anchor_poll', r);

  const [cg, byt] = await Promise.all([get(CG_CONTRACTS), get(`${BYBIT}/v5/market/tickers?category=linear`)]);
  const byMap = new Map((byt.json?.result?.list ?? []).map((x) => [x.symbol, x]));
  let sameIndex = 0;
  let sameFunding = 0;
  let sameNext = 0;
  let close = 0;
  const rows = Array.isArray(cg.json) ? cg.json : [];
  for (const r of rows) {
    const b = byMap.get(`${r.base_currency}${r.target_currency}`);
    if (!b) continue;
    if (r.index_price === b.indexPrice) sameIndex++;
    if (Math.abs(Number(r.index_price) / Number(b.indexPrice) - 1) < 1e-3) close++;
    if (Number(r.funding_rate) === Number(b.fundingRate)) sameFunding++;
    if (String(r.next_funding_rate_timestamp) === b.nextFundingTime) sameNext++;
  }
  log('cg_vs_bybit_tickers', { rows: rows.length, cgMs: cg.ms, bybitMs: byt.ms, bybitBytes: byt.text.length, sameIndexString: sameIndex, indexWithin1000ppm: close, sameFunding, sameNextFunding: sameNext });
  const intervals = {};
  for (const r of rows) {
    const b = byMap.get(`${r.base_currency}${r.target_currency}`);
    if (b) intervals[b.fundingIntervalHour] = (intervals[b.fundingIntervalHour] ?? 0) + 1;
  }
  log('bybit_interval_of_listed', { intervals });
}

async function limits() {
  const cases = [
    ['unknown_pair_data', `${FAPI}/pair-data/NOPEUSDT`],
    ['unknown_full_pair', `${FAPI}/full-pair-data/NOPEUSDT`],
    ['unknown_book', `${FAPI}/order-book/NOPEUSDT`],
    ['lowercase_book', `${FAPI}/order-book/btcusdt`],
    ['underscore_book', `${FAPI}/order-book/BTC_USDT`],
    ['book_limit_param', `${FAPI}/order-book/BTCUSDT?limit=50`],
    ['bad_path', `${FAPI}/nope`],
    ['cg_orderbook_dash', `${API}/public/coingecko/futures/orderbook?ticker_id=BTC-USDT&depth=100`],
    ['cg_orderbook', `${API}/public/coingecko/futures/orderbook?ticker_id=BTCUSDT&depth=100`],
    ['cg_orderbook_full', `${API}/public/coingecko/futures/orderbook?ticker_id=BTCUSDT&depth=0`],
    ['cmc_orderbook', `${API}/public/cmc/futures/orderbook/BTC-USDT`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    const j = r.json;
    const summary = j?.response?.b ? { levels: [j.response.b.length, j.response.a.length] } : j?.bids ? { levels: [j.bids.length, j.asks.length], keys: Object.keys(j) } : null;
    log('case', { name, status: r.status, ms: r.ms, contentType: r.headers.get('content-type'), body: summary ? undefined : r.text.slice(0, 240), summary });
    await sleep(300);
  }
  const post = await get(`${FAPI}/pairs`, { method: 'POST' });
  log('case', { name: 'post_pairs', status: post.status, body: post.text.slice(0, 200) });

  const seen = [];
  for (let i = 0; i < 20; i++) {
    const r = await get(`${FAPI}/order-book/BTCUSDT`);
    seen.push({ s: r.status, lim: r.headers.get('x-ratelimit-limit'), rem: r.headers.get('x-ratelimit-remaining'), reset: r.headers.get('x-ratelimit-reset'), ra: r.headers.get('retry-after'), cache: r.headers.get('cf-cache-status'), age: r.headers.get('age'), u: r.json?.response?.u, ms: r.ms });
  }
  log('ratelimit_book_burst', { first: seen[0], last: seen[seen.length - 1], statuses: [...new Set(seen.map((x) => x.s))], remaining: seen.map((x) => x.rem).join(','), distinctU: new Set(seen.map((x) => x.u)).size, ms: stats(seen.map((x) => x.ms)) });
  const other = await get(`${API}/public/cmc/futures/contracts`);
  log('ratelimit_other_endpoint', { lim: other.headers.get('x-ratelimit-limit'), rem: other.headers.get('x-ratelimit-remaining'), reset: other.headers.get('x-ratelimit-reset') });
}

// PointPay publishes no funding history or index basket call, so the settled rates and the basket come from Bybit, whose contracts these are.
async function reference() {
  for (const symbol of ['BTCUSDT', '1000BONKUSDT']) {
    const r = await get(`${BYBIT}/v5/market/funding/history?category=linear&symbol=${symbol}&limit=6`);
    log('bybit_funding_history', { symbol, settled: (r.json?.result?.list ?? []).map((x) => `${x.fundingRate}@${new Date(Number(x.fundingRateTimestamp)).toISOString()}`) });
  }
  const idx = await get(`${BYBIT}/v5/market/index-price-components?indexName=BTCUSDT`);
  log('bybit_index_basket', { index: idx.json?.result?.indexName, components: (idx.json?.result?.components ?? []).map((c) => `${c.exchange}:${c.spotPair}:${c.weight}`) });
  for (const path of ['/fapi/v1/public/trade/funding-history/BTCUSDT', '/fapi/v1/public/trade/funding-rate/BTCUSDT', '/fapi/v1/public/trade/index-components/BTCUSDT']) {
    const r = await get(`${API}${path}`);
    log('pointpay_guess', { path, status: r.status, body: r.text.slice(0, 160) });
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { latency, catalog, mirror, anchor, limits, reference };
for (const m of mode === 'all' ? Object.keys(modes) : [mode]) {
  log('mode', { mode: m, at: new Date().toISOString() });
  await modes[m]();
}
