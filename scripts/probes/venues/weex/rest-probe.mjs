// WEEX futures REST v3 probe: host latency, the contract catalog and how CCXT 4.5.68 maps it, the bulk anchor call, funding history, the REST book, weights, errors and clock offset.
// Public, unauthenticated, read-only. About 40 requests in catalog mode, 61 in poll mode, 490 over 70 s in fresh mode and 41 in ticker mode, well inside the published 500 weight per 10 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/weex/rest-probe.mjs [catalog|poll|fresh|ticker]
//   catalog  every call once, with weights read from the response headers. About 40 s.
//   poll     the bulk premiumIndex call once a second for 60 s: timing, how often each field changes, and per poll moves in ppm.
//   fresh    for 70 s, once a second, BTC and ETH mark and index from the bulk premiumIndex, the one symbol premiumIndex and symbolPrice, to see which refreshes. About 7 weight per second.
//   ticker   the bulk ticker and the bulk premiumIndex every 2 s for 40 s, about 205 weight per 10 s, to see whether the ticker's mark and index refresh.
// Recorded in docs/profiles/weex/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'api-contract.weex.com';
const API = `https://${HOST}/capi/v3`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

async function call(path) {
  const t = performance.now();
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return {
    status: res.status,
    ms,
    arrivedAt: Date.now(),
    bytes: text.length,
    used: res.headers.get('x-used-weight-10s'),
    remaining: res.headers.get('x-remaining-weight-10s'),
    cache: res.headers.get('x-cache'),
    retryAfter: res.headers.get('retry-after'),
    body,
  };
}

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addresses: addrs.map((a) => a.address) });

  const cold = await call('/market/time');
  log('cold', { path: '/market/time', status: cold.status, ms: cold.ms, cache: cold.cache });
  const offsets = [];
  const warm = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await call('/market/time');
    const t1 = Date.now();
    warm.push(r.ms);
    offsets.push(r.body.serverTime - (t0 + t1) / 2);
  }
  log('time', { warmMs: warm, offsetMs: offsets.map(Math.round), body: cold.body });

  // Weights: each call's used counter minus the previous one, read inside one 10 s window after a pause.
  await sleep(11_000);
  const weights = [];
  let prev = null;
  const probeWeight = async (label, path) => {
    const r = await call(path);
    const used = Number(r.used);
    weights.push({ label, used, delta: prev === null ? used : used - prev, status: r.status, ms: r.ms, bytes: r.bytes });
    prev = used;
    return r;
  };
  const info = await probeWeight('exchangeInfo', '/market/exchangeInfo');
  const pi = await probeWeight('premiumIndex bulk', '/market/premiumIndex');
  const tick = await probeWeight('ticker/24hr bulk', '/market/ticker/24hr');
  const bt = await probeWeight('bookTicker bulk', '/market/ticker/bookTicker');
  const api = await probeWeight('apiTradingSymbols', '/market/apiTradingSymbols');
  await probeWeight('depth 15', '/market/depth?symbol=BTCUSDT');
  await probeWeight('depth 200', '/market/depth?symbol=BTCUSDT&limit=200');
  await probeWeight('symbolPrice', '/market/symbolPrice?symbol=BTCUSDT&priceType=MARK');
  await probeWeight('premiumIndex one', '/market/premiumIndex?symbol=BTCUSDT');
  await probeWeight('fundingRate', '/market/fundingRate?symbol=ETHUSDT&limit=10');
  await probeWeight('time', '/market/time');
  log('weights', { rows: weights });

  const syms = info.body.symbols;
  log('catalog', {
    rows: syms.length,
    keys: Object.keys(syms[0]).length,
    hasStatus: syms.some((s) => 'status' in s),
    hasApiFee: syms.filter((s) => 'apiTakerFeeRate' in s || 'apiMakerFeeRate' in s).length,
    contractType: count(syms, (s) => s.contractType),
    underlyingType: count(syms, (s) => s.underlyingType),
    marginAsset: count(syms, (s) => s.marginAsset),
    quoteAsset: count(syms, (s) => s.quoteAsset),
    taker: count(syms, (s) => s.takerFeeRate),
    maker: count(syms, (s) => s.makerFeeRate),
    takerOutliers: syms.filter((s) => s.takerFeeRate !== 0.0008).map((s) => `${s.symbol}:${s.takerFeeRate}`),
    contractVal: count(syms, (s) => s.contractVal),
    stepEqualsContractVal: syms.filter((s) => Math.abs(10 ** -s.quantityPrecision - s.contractVal) < 1e-12).length,
    stepBelowContractVal: syms.filter((s) => 10 ** -s.quantityPrecision < s.contractVal - 1e-12).length,
    minOrderEqualsContractVal: syms.filter((s) => s.minOrderSize === s.contractVal).length,
    displayDiffers: syms.filter((s) => s.displaySymbol !== s.symbol).map((s) => `${s.symbol}/${s.displaySymbol}`),
    rateLimits: info.body.rateLimits,
    marginAssets: info.body.assets.filter((a) => a.marginAvailable).map((a) => a.asset),
    assets: info.body.assets.length,
    maxLeverage: count(syms, (s) => s.maxLeverage),
  });

  const apiSet = new Set(api.body);
  const type = Object.fromEntries(syms.map((s) => [s.symbol, s.contractType]));
  log('api_trading_symbols', {
    count: api.body.length,
    inCatalog: api.body.filter((s) => type[s]).length,
    byType: count(api.body.filter((s) => type[s]), (s) => type[s]),
    catalogNotApi: syms.filter((s) => !apiSet.has(s.symbol)).length,
    sampleNotApi: syms.filter((s) => !apiSet.has(s.symbol)).slice(0, 8).map((s) => s.symbol),
  });

  // CCXT 4.5.68 mapping, without credentials.
  const ccxt = require('ccxt');
  const ex = new ccxt.weex();
  const t = performance.now();
  await ex.loadMarkets();
  const swaps = Object.values(ex.markets).filter((m) => m.swap);
  const ids = new Set(swaps.map((m) => m.id));
  const bySym = Object.fromEntries(syms.map((s) => [s.symbol, s]));
  const btc = ex.markets['BTC/USDT:USDT'];
  log('ccxt', {
    loadMs: Math.round(performance.now() - t),
    markets: Object.keys(ex.markets).length,
    swaps: swaps.length,
    spot: Object.values(ex.markets).filter((m) => m.spot).length,
    swapActive: count(swaps, (m) => m.active),
    swapLinear: count(swaps, (m) => m.linear),
    swapTaker: count(swaps, (m) => m.taker),
    swapMaker: count(swaps, (m) => m.maker),
    catalogIdsMissing: syms.filter((s) => !ids.has(s.symbol)).map((s) => s.symbol),
    contractSizeEqualsContractVal: swaps.filter((m) => m.contractSize === bySym[m.id]?.contractVal).length,
    baseRenamed: swaps.filter((m) => m.base !== bySym[m.id]?.baseAsset).map((m) => `${m.id}:${m.base}`),
    btc: {
      id: btc.id,
      symbol: btc.symbol,
      taker: btc.taker,
      maker: btc.maker,
      contractSize: btc.contractSize,
      amountStep: btc.precision.amount,
      minAmount: btc.limits.amount.min,
      active: btc.active,
      linear: btc.linear,
    },
    feesContract: ex.fees.contract ? { taker: ex.fees.contract.taker, maker: ex.fees.contract.maker } : null,
  });

  // Bulk anchor reply.
  const rows = pi.body;
  const now = pi.arrivedAt;
  log('premium_index', {
    status: pi.status,
    ms: pi.ms,
    bytes: pi.bytes,
    rows: rows.length,
    keys: Object.keys(rows[0]),
    keyMatchesCatalog: rows.filter((r) => bySym[r.symbol]).length,
    collectCycle: count(rows, (r) => r.collectCycle),
    collectCycleByType: count(rows, (r) => `${type[r.symbol]}:${r.collectCycle}`),
    cycleMatchesDelivery: rows.filter((r) => bySym[r.symbol] && 1440 / bySym[r.symbol].delivery.length === r.collectCycle).length,
    deliveryWithStrayWhitespace: syms.filter((x) => x.delivery.some((d) => d !== d.trim())).length,
    nextFundingTime: count(rows, (r) => new Date(r.nextFundingTime).toISOString()),
    distinctTime: new Set(rows.map((r) => r.time)).size,
    ageAtArrivalMs: now - rows[0].time,
    markZero: rows.filter((r) => Number(r.markPrice) === 0).length,
    lastEqualsForecast: rows.filter((r) => r.lastFundingRate === r.forecastFundingRate).length,
    interestRate: count(rows, (r) => r.interestRate),
    maxAbsForecast: rows.map((r) => [r.symbol, Math.abs(Number(r.forecastFundingRate))]).sort((a, b) => b[1] - a[1]).slice(0, 5),
    markEqualsIndex: count(rows, (r) => `${type[r.symbol]}:${r.markPrice === r.indexPrice || Number(r.markPrice) === Number(r.indexPrice)}`),
    premiumPpm: (() => {
      const p = rows.map((r) => Math.round((Number(r.markPrice) / Number(r.indexPrice) - 1) * 1e6));
      return { min: Math.min(...p), p1: pct(p, 0.01), median: median(p), p99: pct(p, 0.99), max: Math.max(...p) };
    })(),
    topPremium: rows.map((r) => [r.symbol, Math.round((Number(r.markPrice) / Number(r.indexPrice) - 1) * 1e6)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6),
    btc: rows.find((r) => r.symbol === 'BTCUSDT'),
  });

  // Ticker bulk against the premium index read a moment earlier.
  const trow = tick.body;
  const piBy = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  log('ticker24hr', {
    rows: trow.length,
    bytes: tick.bytes,
    ms: tick.ms,
    keys: Object.keys(trow[0]),
    markEqualsPremiumIndex: trow.filter((x) => piBy[x.symbol] && x.markPrice === piBy[x.symbol].markPrice).length,
    indexEqualsPremiumIndex: trow.filter((x) => piBy[x.symbol] && x.indexPrice === piBy[x.symbol].indexPrice).length,
    markEqualsLast: count(trow, (x) => `${type[x.symbol]}:${Number(x.markPrice) === Number(x.lastPrice)}`),
    btcMarkLastIndex: ((x) => [x.markPrice, x.lastPrice, x.indexPrice])(trow.find((x) => x.symbol === 'BTCUSDT')),
    zeroVolume: trow.filter((x) => Number(x.quoteVolume) === 0).length,
  });
  log('book_ticker', { rows: bt.body.length, bytes: bt.bytes, ms: bt.ms, sample: bt.body.find((r) => r.symbol === 'BTCUSDT') });

  // Funding history against the two rates of the premium index.
  const fundingSymbols = ['ETHUSDT', ...rows.filter((r) => r.collectCycle === 60).slice(0, 1).map((r) => r.symbol), rows.find((r) => r.collectCycle === 240).symbol, 'DALUSDT'];
  for (const s of fundingSymbols) {
    const h = await call(`/market/fundingRate?symbol=${s}&limit=6`);
    const p = piBy[s];
    const times = (h.body ?? []).map((x) => x.fundingTime);
    log('funding_history', {
      symbol: s,
      status: h.status,
      rows: Array.isArray(h.body) ? h.body.length : h.body,
      newest: Array.isArray(h.body) ? h.body[0] : null,
      spacingH: times.slice(1).map((t, i) => (times[i] - t) / 3.6e6),
      premiumIndex: p ? { last: p.lastFundingRate, forecast: p.forecastFundingRate, next: p.nextFundingTime, cycle: p.collectCycle } : null,
      lastEqualsNewestSettled: Array.isArray(h.body) && h.body[0] ? Number(h.body[0].fundingRate) === Number(p?.lastFundingRate) : null,
    });
    await sleep(300);
  }

  // REST book: order, units, window, caching.
  const quiet = trow.filter((x) => type[x.symbol] === 'PERPETUAL' && Number(x.quoteVolume) > 0).sort((a, b) => Number(a.quoteVolume) - Number(b.quoteVolume))[0].symbol;
  for (const s of ['BTCUSDT', 'ETHUSDT', '1000PEPEUSDT', quiet]) {
    const a = await call(`/market/depth?symbol=${s}&limit=200`);
    const b = await call(`/market/depth?symbol=${s}&limit=200`);
    const cv = bySym[s].contractVal;
    const sizes = [...a.body.bids, ...a.body.asks].map((x) => Number(x[1]));
    const multiples = sizes.filter((x) => Math.abs(x / cv - Math.round(x / cv)) < 1e-6).length;
    log('rest_depth', {
      symbol: s,
      contractVal: cv,
      levels: [a.body.bids.length, a.body.asks.length],
      bidsDesc: a.body.bids.every((x, i) => i === 0 || Number(a.body.bids[i - 1][0]) > Number(x[0])),
      asksAsc: a.body.asks.every((x, i) => i === 0 || Number(a.body.asks[i - 1][0]) < Number(x[0])),
      touch: [a.body.bids[0], a.body.asks[0]],
      sizesThatAreMultiplesOfContractVal: `${multiples}/${sizes.length}`,
      fractionalSizes: sizes.filter((x) => !Number.isInteger(x)).length,
      lastUpdateId: [a.body.lastUpdateId, b.body.lastUpdateId],
      msApart: [a.ms, b.ms],
      cache: [a.cache, b.cache],
    });
  }

  // Error shapes.
  for (const [label, path] of [
    ['depth unknown symbol', '/market/depth?symbol=NOPEUSDT'],
    ['depth limit 20', '/market/depth?symbol=BTCUSDT&limit=20'],
    ['depth lowercase', '/market/depth?symbol=btcusdt'],
    ['depth delisted IKAUSDT', '/market/depth?symbol=IKAUSDT'],
    ['premiumIndex unknown symbol', '/market/premiumIndex?symbol=NOPEUSDT'],
    ['fundingRate without symbol', '/market/fundingRate'],
    ['exchangeInfo unknown symbol', '/market/exchangeInfo?symbol=NOPEUSDT'],
    ['unknown path', '/market/nope'],
  ]) {
    const r = await call(path);
    log('error', { label, status: r.status, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 200) });
  }
}

async function poll() {
  const info = await call('/market/exchangeInfo');
  const type = Object.fromEntries(info.body.symbols.map((s) => [s.symbol, s.contractType]));
  const polls = [];
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const due = start + i * 1000;
    await sleep(Math.max(0, due - Date.now()));
    const at = Date.now();
    const r = await call('/market/premiumIndex');
    polls.push({ at, ms: r.ms, status: r.status, used: r.used, rows: Array.isArray(r.body) ? r.body : [] });
  }
  const ms = polls.map((p) => p.ms);
  log('poll_timing', { polls: polls.length, statuses: count(polls, (p) => p.status), min: Math.min(...ms), median: median(ms), p90: pct(ms, 0.9), max: Math.max(...ms), over1s: ms.filter((x) => x > 1000).length, usedMax: Math.max(...polls.map((p) => Number(p.used))) });
  log('poll_time_field', {
    distinctTimes: new Set(polls.map((p) => p.rows[0]?.time)).size,
    ageAtArrivalMs: (() => {
      const a = polls.map((p) => p.at + p.ms - p.rows[0]?.time);
      return { min: Math.min(...a), median: median(a), max: Math.max(...a) };
    })(),
    timeStepMs: count(polls.slice(1).map((p, i) => p.rows[0]?.time - polls[i].rows[0]?.time), (x) => x),
  });

  const fields = ['markPrice', 'indexPrice', 'forecastFundingRate', 'lastFundingRate', 'nextFundingTime'];
  const series = new Map();
  for (const p of polls) {
    for (const r of p.rows) {
      if (!series.has(r.symbol)) series.set(r.symbol, []);
      series.get(r.symbol).push(r);
    }
  }
  const changes = (arr, f) => arr.slice(1).filter((r, i) => r[f] !== arr[i][f]).length;
  const report = {};
  for (const s of ['BTCUSDT', 'ETHUSDT', 'DOODUSDT', 'SNDKUSDT', 'NVDAUSDT', 'XAUTUSDT']) {
    const arr = series.get(s);
    if (!arr) continue;
    report[s] = Object.fromEntries(fields.map((f) => [f, changes(arr, f)]));
  }
  log('changes_of_59', report);
  const all = [...series.entries()];
  const dist = (f) => {
    const c = all.map(([, arr]) => changes(arr, f));
    return { zero: c.filter((x) => x === 0).length, median: median(c), max: Math.max(...c) };
  };
  log('changes_catalog', Object.fromEntries(fields.map((f) => [f, dist(f)])));
  const byType = {};
  for (const t of ['PERPETUAL', 'TRADIFI_PERPETUAL']) {
    const sub = all.filter(([s]) => type[s] === t);
    const c = sub.map(([, arr]) => changes(arr, 'markPrice'));
    const ci = sub.map(([, arr]) => changes(arr, 'indexPrice'));
    byType[t] = { rows: sub.length, markMedian: median(c), markZero: c.filter((x) => x === 0).length, indexMedian: median(ci), indexZero: ci.filter((x) => x === 0).length };
  }
  log('changes_by_type', byType);

  // Per poll moves against the engine's 1,000 ppm guard.
  let over = 0;
  let steps = 0;
  const worst = [];
  for (const [s, arr] of all) {
    for (let i = 1; i < arr.length; i++) {
      for (const f of ['markPrice', 'indexPrice']) {
        const m = Math.abs(Number(arr[i][f]) / Number(arr[i - 1][f]) - 1) * 1e6;
        steps++;
        if (m > 1000) {
          over++;
          worst.push([s, f, Math.round(m)]);
        }
      }
    }
  }
  worst.sort((a, b) => b[2] - a[2]);
  log('moves_over_1000ppm', { steps, over, worst: worst.slice(0, 8) });
}

// Which source refreshes the mark and the index: the bulk premiumIndex, the one symbol premiumIndex and symbolPrice, read side by side once a second.
// The one symbol ticker weighs 40 like the bulk one, so it is left out.
async function fresh() {
  const symbols = ['BTCUSDT', 'ETHUSDT'];
  const sources = {
    bulk: async (s, cache) => cache.bulk.find((r) => r.symbol === s),
    one: async (s) => (await call(`/market/premiumIndex?symbol=${s}`)).body[0],
    symbolPrice: async (s) => ({
      markPrice: (await call(`/market/symbolPrice?symbol=${s}&priceType=MARK`)).body.price,
      indexPrice: (await call(`/market/symbolPrice?symbol=${s}&priceType=INDEX`)).body.price,
    }),
  };
  const hist = {};
  const start = Date.now();
  let used = 0;
  for (let i = 0; i < 70; i++) {
    await sleep(Math.max(0, start + i * 1000 - Date.now()));
    const b = await call('/market/premiumIndex');
    used = Math.max(used, Number(b.used));
    const cache = { bulk: b.body };
    for (const s of symbols) {
      for (const [name, get] of Object.entries(sources)) {
        const r = await get(s, cache);
        if (!r) {
          log('fresh_missing', { s, name, i });
          continue;
        }
        for (const f of ['markPrice', 'indexPrice']) {
          const key = `${s} ${name} ${f}`;
          const h = (hist[key] ??= { last: null, changesAtS: [] });
          if (h.last !== null && r[f] !== h.last) h.changesAtS.push(Math.round((Date.now() - start) / 100) / 10);
          h.last = r[f];
        }
      }
    }
  }
  log('fresh', { seconds: 70, usedMax: used, changes: Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, { count: v.changesAtS.length, atS: v.changesAtS.slice(0, 12) }])) });
}

// The bulk ticker carries markPrice and indexPrice too, at weight 40, so it is read every 2 s rather than every second.
async function ticker() {
  const info = await call('/market/exchangeInfo');
  const type = Object.fromEntries(info.body.symbols.map((x) => [x.symbol, x.contractType]));
  await sleep(1000);
  const polls = [];
  const start = Date.now();
  for (let i = 0; i < 20; i++) {
    await sleep(Math.max(0, start + i * 2000 - Date.now()));
    const r = await call('/market/ticker/24hr');
    const pi = await call('/market/premiumIndex');
    polls.push({ ms: r.ms, used: Number(r.used), status: r.status, rows: Array.isArray(r.body) ? r.body : [], pi: Array.isArray(pi.body) ? pi.body : [] });
  }
  const ms = polls.map((p) => p.ms);
  const series = new Map();
  for (const p of polls) for (const r of p.rows) (series.get(r.symbol) ?? series.set(r.symbol, []).get(r.symbol)).push(r);
  const changes = (arr, f) => arr.slice(1).filter((r, i) => r[f] !== arr[i][f]).length;
  const dist = (f) => {
    const c = [...series.values()].map((arr) => changes(arr, f));
    return { zero: c.filter((x) => x === 0).length, median: median(c), max: Math.max(...c) };
  };
  const last = polls.at(-1);
  const piBy = Object.fromEntries(last.pi.map((r) => [r.symbol, r]));
  log('ticker_poll', {
    polls: polls.length,
    statuses: count(polls, (p) => p.status),
    ms: { min: Math.min(...ms), median: median(ms), max: Math.max(...ms) },
    usedMax: Math.max(...polls.map((p) => p.used)),
    changesOf19: { markPrice: dist('markPrice'), indexPrice: dist('indexPrice'), lastPrice: dist('lastPrice') },
    byType: Object.fromEntries(
      ['PERPETUAL', 'TRADIFI_PERPETUAL'].map((t) => {
        const sub = [...series.entries()].filter(([k]) => type[k] === t).map(([, arr]) => arr);
        return [t, { rows: sub.length, markZero: sub.filter((a) => changes(a, 'markPrice') === 0).length, indexZero: sub.filter((a) => changes(a, 'indexPrice') === 0).length, markEqualsLastOnLastPoll: sub.filter((a) => Number(a.at(-1).markPrice) === Number(a.at(-1).lastPrice)).length }];
      }),
    ),
    watch: Object.fromEntries(
      ['BTCUSDT', 'ETHUSDT', 'AAPLUSDT', 'METAUSDT', 'MSTRUSDT'].filter((k) => series.has(k)).map((k) => {
        const a = series.get(k);
        return [k, { markChanges: changes(a, 'markPrice'), indexChanges: changes(a, 'indexPrice'), last: [a.at(-1).markPrice, a.at(-1).lastPrice, a.at(-1).indexPrice] }];
      }),
    ),
    lastPollMarkEqualsPremiumIndex: last.rows.filter((r) => piBy[r.symbol]?.markPrice === r.markPrice).length,
    lastPollIndexEqualsPremiumIndex: last.rows.filter((r) => piBy[r.symbol]?.indexPrice === r.indexPrice).length,
  });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, poll, fresh, ticker };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
