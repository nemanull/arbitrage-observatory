// Giottus REST probe: the documented public spot API on api.giottus.com, and the futures catalog and anchors the www.giottus.com/futures page embeds, compared against Binance USD-M.
// Giottus documents no futures endpoint, so the futures mode reads the Futures.init(...) JSON the public web page renders, and compares every row with Binance's bulk replies.
// Public, unauthenticated, read-only. Requests are spaced at least 2.5 s apart on api.giottus.com, whose replies carry X-RateLimit-Limit 1.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/giottus/rest-probe.mjs [spot|futures]
//   spot     DNS, cold and warm request times, the six documented public calls, two error shapes, rate limit headers, clock offset from Date, two guessed futures paths. About 60 s.
//   futures  one fetch of the futures page, its catalog by quote, funding interval and venue id, and a row by row comparison with Binance premiumIndex, fundingInfo and bookTicker. About 10 s.
// Recorded in docs/profiles/giottus/rest.md and fees.md.
import { promises as dns } from 'node:dns';

const API = 'https://api.giottus.com';
const PAGE = 'https://www.giottus.com/futures';
const BINANCE = 'https://fapi.binance.com/fapi/v1';
const UA = { 'User-Agent': 'Mozilla/5.0 (probe; read-only)' };
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stats(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

async function timed(url, headers = UA) {
  const t = performance.now();
  const res = await fetch(url, { headers });
  const ttfb = performance.now() - t;
  const body = await res.text();
  return { res, body, ttfb: Math.round(ttfb), total: Math.round(performance.now() - t) };
}

const rateHeaders = (res) => ({
  limit: res.headers.get('x-ratelimit-limit'),
  remaining: res.headers.get('x-ratelimit-remaining'),
  reset: res.headers.get('x-ratelimit-reset'),
  retryAfter: res.headers.get('retry-after'),
  cache: res.headers.get('cf-cache-status'),
  colo: (res.headers.get('cf-ray') ?? '').split('-')[1] ?? null,
});

async function spot() {
  for (const host of ['api.giottus.com', 'www.giottus.com', 'socket.giottus.com']) {
    log('dns', { host, a: await dns.resolve4(host).catch((e) => e.code) });
  }
  const calls = [
    ['symbols', '/api/v1/public/exchange/symbols'],
    ['ticker_all', '/api/v1/public/exchange/ticker'],
    ['ticker_btcusdt', '/api/v1/public/exchange/ticker?symbol=BTC/USDT'],
    ['orderbook_50', '/api/v1/public/market/orderbook?symbol=BTC/USDT&limit=50'],
    ['trades', '/api/v1/public/market/trades?symbol=BTC/USDT&limit=50'],
    ['assets_btc', '/api/v1/public/exchange/assets?asset=BTC'],
    ['orderbook_limit_51', '/api/v1/public/market/orderbook?symbol=BTC/USDT&limit=51'],
    ['orderbook_unknown', '/api/v1/public/market/orderbook?symbol=NOPE/USDT'],
    ['guess_futures_symbols', '/api/v1/public/futures/symbols'],
    ['guess_futures_ticker', '/api/v1/public/futures/ticker'],
  ];
  const offsets = [];
  for (const [name, path] of calls) {
    const before = Date.now();
    const r = await timed(API + path);
    const date = Date.parse(r.res.headers.get('date'));
    offsets.push(date - (before + Date.now()) / 2);
    let summary;
    try {
      const j = JSON.parse(r.body);
      if (Array.isArray(j)) summary = { rows: j.length, first: JSON.stringify(j[0]).slice(0, 200) };
      else if (j.bids) {
        const bids = j.bids.map((l) => Number(l[0]));
        const asks = j.asks.map((l) => Number(l[0]));
        summary = {
          bids: j.bids.length,
          asks: j.asks.length,
          bidsDesc: bids.every((x, i) => i === 0 || x < bids[i - 1]),
          asksAsc: asks.every((x, i) => i === 0 || x > asks[i - 1]),
          top: [j.bids[0], j.asks[0]],
        };
      } else summary = JSON.stringify(j).slice(0, 250);
    } catch {
      summary = r.body.slice(0, 200);
    }
    log('call', { name, status: r.res.status, ttfbMs: r.ttfb, totalMs: r.total, bytes: r.body.length, ...rateHeaders(r.res), summary });
    await sleep(2_500);
  }
  if (offsets.length) log('clock', { note: 'Date header minus local midpoint, 1 s resolution', offsetMs: stats(offsets.map(Math.round)) });

  const warm = [];
  const remaining = [];
  for (let i = 0; i < 8; i++) {
    const r = await timed(API + '/api/v1/public/market/orderbook?symbol=BTC/USDT&limit=20');
    warm.push(r.total);
    remaining.push(`${r.res.status}:${r.res.headers.get('x-ratelimit-remaining')}`);
    await sleep(2_500);
  }
  log('warm_orderbook_20', { totalMs: stats(warm), statusRemaining: remaining });
}

async function futures() {
  const t = Date.now();
  const page = await timed(PAGE);
  const i = page.body.indexOf('Futures.init(');
  log('page', { status: page.res.status, ttfbMs: page.ttfb, totalMs: page.total, bytes: page.body.length, colo: rateHeaders(page.res).colo, cache: rateHeaders(page.res).cache, found: i >= 0 });
  if (i < 0) return;
  let depth = 0;
  let end = i + 'Futures.init('.length;
  let inStr = false;
  for (; end < page.body.length; end++) {
    const c = page.body[end];
    if (inStr) {
      if (c === '\\') end++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  const cfg = JSON.parse(page.body.slice(i + 'Futures.init('.length, end + 1));
  const [pi, fi, bt] = await Promise.all([
    fetch(`${BINANCE}/premiumIndex`).then((r) => r.json()),
    fetch(`${BINANCE}/fundingInfo`).then((r) => r.json()),
    fetch(`${BINANCE}/ticker/bookTicker`).then((r) => r.json()),
  ]);
  const binanceReadAt = Date.now();
  const bPi = new Map(pi.map((r) => [r.symbol, r]));
  const bFi = new Map(fi.map((r) => [r.symbol, r.fundingIntervalHours]));
  const bBt = new Map(bt.map((r) => [r.symbol, r]));
  const factor = Object.fromEntries(Object.entries(cfg.active_conversion_factors).map(([k, v]) => [k, Number(v.usdt_price)]));

  const byQuote = {};
  const intervals = {};
  const liqFees = {};
  const venueIds = {};
  const notSelfNamed = [];
  const missingOnBinance = [];
  const intervalMismatch = [];
  const markDiffPpm = [];
  const indexDiffPpm = [];
  const etsAge = [];
  let rateEqual = 0;
  let nextEqual = 0;
  let compared = 0;
  const topDiffPpm = [];
  for (const sc of cfg.symbol_config) {
    const [base, quote] = sc.symbol.split('/');
    byQuote[quote] = (byQuote[quote] || 0) + 1;
    const ik = `${quote}:${sc.funding_frequency}h`;
    intervals[ik] = (intervals[ik] || 0) + 1;
    const lk = `${quote}:${Number(sc.deductibles.liquidation_fee)}`;
    liqFees[lk] = (liqFees[lk] || 0) + 1;
    const m = cfg.mark_price[sc.symbol];
    if (!m) continue;
    venueIds[m.exchange_id] = (venueIds[m.exchange_id] || 0) + 1;
    if (quote === 'USDT' && m.exchange_symbol !== `${base}USDT`) notSelfNamed.push(`${sc.symbol}=${m.exchange_symbol}`);
    const b = bPi.get(m.exchange_symbol);
    if (!b) {
      missingOnBinance.push(sc.symbol);
      continue;
    }
    const f = factor[quote];
    compared++;
    const ppm = (x, y) => Math.round(((x - y) / y) * 1e6);
    markDiffPpm.push(ppm(Number(m.mark_price) / f, Number(b.markPrice)));
    indexDiffPpm.push(ppm(Number(m.index_price) / f, Number(b.indexPrice)));
    if (Number(m.funding_rate) === Number(b.lastFundingRate)) rateEqual++;
    if (Number(m.next_funding_time) === b.nextFundingTime) nextEqual++;
    etsAge.push(t - m.ets * 1000);
    const bi = bFi.get(m.exchange_symbol) ?? 8;
    if (quote === 'USDT' && Number(sc.funding_frequency) !== bi) intervalMismatch.push(`${sc.symbol}:${sc.funding_frequency}/${bi}`);
    const td = cfg.ticker_data[sc.symbol];
    const bb = bBt.get(m.exchange_symbol);
    if (td && bb && quote === 'USDT') topDiffPpm.push(Math.abs(ppm(Number(td.top_bid), Number(bb.bidPrice))));
  }
  const abs = (xs) => xs.map(Math.abs);
  log('catalog', {
    symbols: cfg.symbol_config.length,
    byQuote,
    fundingFrequencyHours: intervals,
    liquidationFee: liqFees,
    binanceUsdtPerpsInPremiumIndex: pi.filter((r) => r.symbol.endsWith('USDT')).length,
    binanceRowsNotOnGiottus: pi.filter((r) => r.symbol.endsWith('USDT') && !Object.values(cfg.mark_price).some((m) => m.exchange_symbol === r.symbol)).length,
    exchangeId: venueIds,
    delistedContracts: Object.keys(cfg.delisted_contracts).length,
    conversion: cfg.active_conversion_factors,
  });
  log('mapping', { usdtSymbolsNotNamedBasePlusUSDT: notSelfNamed.length, examples: notSelfNamed.slice(0, 12), missingOnBinancePremiumIndex: missingOnBinance.slice(0, 12), missingCount: missingOnBinance.length });
  log('anchor_vs_binance', {
    compared,
    pageToBinanceReadMs: binanceReadAt - t,
    absMarkDiffPpm: stats(abs(markDiffPpm)),
    absIndexDiffPpm: stats(abs(indexDiffPpm)),
    fundingRateEqual: rateEqual,
    nextFundingTimeEqual: nextEqual,
    etsAgeAtFetchMs: stats(etsAge),
    usdtIntervalMismatch: intervalMismatch.length,
    intervalMismatchExamples: intervalMismatch.slice(0, 8),
    absTopBidDiffPpmVsBookTicker: stats(topDiffPpm),
  });
  const perBase = {};
  for (const x of cfg.symbol_config) {
    const [b, q] = x.symbol.split('/');
    (perBase[b] ??= {})[q] = x;
  }
  const differ = (f) => Object.entries(perBase).filter(([, v]) => v.USDT && v.INR && f(v.USDT) !== f(v.INR)).map(([b, v]) => `${b}:${f(v.USDT)}/${f(v.INR)}`);
  log('usdt_vs_inr_rows', {
    fundingFrequencyDiffers: differ((x) => x.funding_frequency),
    liquidationFeeDiffers: differ((x) => Number(x.deductibles.liquidation_fee)),
    maxLeverage150: cfg.symbol_config.filter((x) => x.leverage?.max_leverage_long === 150).map((x) => x.symbol),
  });
  const btc = cfg.mark_price['BTC/USDT'];
  const bb = bPi.get('BTCUSDT');
  log('btc_row', {
    giottus: btc,
    binance: { markPrice: bb.markPrice, indexPrice: bb.indexPrice, estimatedSettlePrice: bb.estimatedSettlePrice, lastFundingRate: bb.lastFundingRate, nextFundingTime: bb.nextFundingTime, time: bb.time },
  });
  const sc = cfg.symbol_config.find((x) => x.symbol === 'BTC/USDT');
  log('btc_config', { funding_frequency: sc.funding_frequency, deductibles: sc.deductibles, market: sc.market, leverageMax: sc.leverage?.max_leverage_long });
  const fees = {};
  for (const x of cfg.symbol_config) {
    const k = JSON.stringify(x.deductibles.fees);
    fees[k] = (fees[k] || 0) + 1;
  }
  log('page_fee_config', { uiconfigNote: 'deductibles.fees per pair, shown to a visitor who is not logged in', fees });
}

const mode = process.argv[2] ?? 'spot';
if (mode === 'spot') await spot();
else if (mode === 'futures') await futures();
else console.error('mode must be spot or futures');
