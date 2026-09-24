// BYDFi futures REST probe: the documented paths and CCXT class, then the contract API the upgraded platform serves on the same host, its catalog, anchor fields, book, errors and clock.
// Public, unauthenticated and read-only, at most two requests a second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bydfi/rest-probe.mjs [legacy|catalog|anchor|history|book|limits]
//   legacy    DNS of the documented hosts, every documented public path on api.bydfi.com, and CCXT bydfi loadMarkets. About 10 s.
//   catalog   the contract list by family and state, index sources, and CCXT mexc with its host swapped for api.bydfi.com.
//   anchor    60 rounds of the bulk ticker and funding calls at one a second, with timings and how often each number changed. About 70 s.
//   history   funding history of four contracts, and the single contract index and fair price calls.
//   book      REST depth at several limits, level order, version and caching.
//   limits    response headers, error shapes for unknown symbols and paths, and the server clock against this host.
// Recorded in docs/profiles/bydfi/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const LEGACY_API = 'https://api.bydfi.com/api';
const LEGACY_PATHS = [
  'v1/public/api_limits',
  'v1/public/api_limit',
  'v1/fapi/market/exchange_info',
  'v1/fapi/market/depth?symbol=BTC-USDT',
  'v1/fapi/market/ticker/24hr',
  'v1/fapi/market/mark_price?symbol=BTC-USDT',
  'v1/fapi/market/funding_rate',
  'v1/fapi/market/funding_rate_history?symbol=BTC-USDT',
];
const HOST = 'https://futures.bydfi.com';
const REST = 'https://api.bydfi.com/api/v1/contract';
const WATCH = ['BTC_USDT', 'ETH_USDT', 'BTC_USDC', 'BTC_USD'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj = {}) => console.log(JSON.stringify({ tag, ...obj }));

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, text, body, headers: Object.fromEntries(res.headers) };
}

async function legacyMode() {
  for (const host of ['developers.bydfi.com', 'stream.bydfi.com', 'api.bydfi.com', 'futures.bydfi.com']) {
    let a;
    try {
      a = await dns.resolve4(host);
    } catch (e) {
      a = e.code;
    }
    log('dns', { host, a });
  }
  for (const p of LEGACY_PATHS) {
    const r = await get(`${LEGACY_API}/${p}`);
    log('legacy_rest', { path: p, status: r.status, ms: r.ms, body: r.text.slice(0, 80), server: r.headers.server, cfRay: r.headers['cf-ray'] });
    await sleep(300);
  }
  // The same host answers the contract and spot paths of the upgraded platform.
  for (const u of [`${LEGACY_API}/v1/contract/ping`, `${LEGACY_API}/v1/contract/detail`, `${HOST}/api/v1/contract/detail`, `${LEGACY_API}/v3/ping`, `${LEGACY_API}/v3/time`]) {
    const r = await get(u);
    log('new_layout', { url: u, status: r.status, ms: r.ms, bytes: r.bytes, body: r.text.slice(0, 70) });
    await sleep(300);
  }
  const ex = new ccxt.bydfi();
  try {
    const m = await ex.loadMarkets();
    log('ccxt_bydfi', { markets: Object.keys(m).length });
  } catch (e) {
    log('ccxt_bydfi', { error: e.constructor.name, message: String(e.message).slice(0, 200) });
  }
}

function swapHost(o) {
  for (const k of Object.keys(o)) {
    if (typeof o[k] === 'string') o[k] = o[k].replace('https://api.mexc.com', 'https://api.bydfi.com');
    else if (o[k] && typeof o[k] === 'object') swapHost(o[k]);
  }
}

async function catalogMode() {
  const r = await get(`${REST}/detail`);
  const d = r.body.data;
  log('detail', { status: r.status, ms: r.ms, bytes: r.bytes, rows: d.length });
  const fam = {};
  for (const x of d) {
    const k = `${x.quoteCoin}/${x.settleCoin} state=${x.state} futureType=${x.futureType} type=${x.type} apiAllowed=${x.apiAllowed} isHidden=${x.isHidden}`;
    fam[k] = (fam[k] ?? 0) + 1;
  }
  log('families', fam);
  const fees = {};
  for (const x of d) fees[`taker=${x.takerFeeRate} maker=${x.makerFeeRate} zeroFee=${x.isZeroFeeRate}/${x.isZeroFeeSymbol} mode=${x.feeRateMode} type=${x.feeRateType}`] = (fees[`taker=${x.takerFeeRate} maker=${x.makerFeeRate} zeroFee=${x.isZeroFeeRate}/${x.isZeroFeeSymbol} mode=${x.feeRateMode} type=${x.feeRateType}`] ?? 0) + 1;
  log('fee_fields', fees);
  const cs = {};
  for (const x of d) cs[x.contractSize] = (cs[x.contractSize] ?? 0) + 1;
  log('contract_sizes', { distinct: Object.keys(cs).length, all: Object.entries(cs).sort((a, b) => b[1] - a[1]) });
  const liq = {};
  for (const x of d) liq[x.liquidationFeeRate] = (liq[x.liquidationFeeRate] ?? 0) + 1;
  log('liquidation_fee_rate', liq);
  const pick = (x, ks) => Object.fromEntries(ks.map((k) => [k, x[k]]));
  for (const s of WATCH) log('row', pick(d.find((x) => x.symbol === s), ['symbol', 'baseCoin', 'quoteCoin', 'settleCoin', 'contractSize', 'priceUnit', 'volUnit', 'takerFeeRate', 'makerFeeRate', 'liquidationFeeRate', 'state', 'indexOrigin', 'maxLeverage', 'openingTime', 'preMarket', 'tieredFeeRates', 'leverageFeeRates']));
  // Index sources: how many, and which contracts lean on few or on BYDFi itself.
  const n = {};
  const src = {};
  for (const x of d) {
    const o = x.indexOrigin ?? [];
    n[o.length] = (n[o.length] ?? 0) + 1;
    for (const e of o) src[e] = (src[e] ?? 0) + 1;
  }
  log('index_origin', { bySourceCount: n, bySource: src, singleSource: d.filter((x) => (x.indexOrigin ?? []).length <= 1).map((x) => `${x.symbol}:${(x.indexOrigin ?? []).join('+')}`).slice(0, 40) });
  const pairs = {};
  for (const x of d) pairs[x.baseCoin] = [...(pairs[x.baseCoin] ?? []), x.symbol];
  log('bases_listed_twice', Object.fromEntries(Object.entries(pairs).filter(([, v]) => v.length > 1)));
  const t = await get(`${REST}/ticker`);
  const f = await get(`${REST}/funding_rate`);
  const ids = new Set(d.map((x) => x.symbol));
  const tIds = new Set(t.body.data.map((x) => x.symbol));
  const fIds = new Set(f.body.data.map((x) => x.symbol));
  log('id_sets', { detail: ids.size, ticker: tIds.size, funding: fIds.size, tickerNotInDetail: [...tIds].filter((x) => !ids.has(x)), fundingNotInDetail: [...fIds].filter((x) => !ids.has(x)), detailNotInTicker: [...ids].filter((x) => !tIds.has(x)) });
  // CCXT mexc parses this API shape. Every api.mexc.com URL is swapped for api.bydfi.com and loadMarkets runs whole, as the connector would run it.
  const mx = new ccxt.mexc();
  swapHost(mx.urls.api);
  try {
    const all = Object.values(await mx.loadMarkets());
    const ms = all.filter((m) => m.swap);
    log('ccxt_mexc_urls', { spot: mx.urls.api.spot.public, contract: mx.urls.api.contract.public, spotMarkets: all.filter((m) => m.spot).length, swapMarkets: ms.length });
    const byType = {};
    for (const m of ms) byType[`${m.settle} linear=${m.linear} active=${m.active}`] = (byType[`${m.settle} linear=${m.linear} active=${m.active}`] ?? 0) + 1;
    log('ccxt_mexc_on_bydfi', { markets: ms.length, byType });
    for (const s of WATCH) {
      const m = ms.find((x) => x.id === s);
      log('ccxt_market', pick(m, ['id', 'symbol', 'base', 'quote', 'settle', 'linear', 'inverse', 'active', 'contractSize', 'taker', 'maker']));
    }
  } catch (e) {
    log('ccxt_mexc_on_bydfi', { error: e.constructor.name, message: String(e.message).slice(0, 200) });
  }
}

async function anchorMode() {
  const rounds = [];
  const series = new Map(WATCH.map((s) => [s, { index: [], mark: [], rate: [], next: [], tRate: [], prem: [], touch: null }]));
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    const [t, f] = await Promise.all([get(`${REST}/ticker`), get(`${REST}/funding_rate`)]);
    rounds.push({ t: t.ms, f: f.ms, tb: t.bytes, fb: f.bytes, ts: t.status, fs: f.status });
    const tm = new Map(t.body.data.map((x) => [x.symbol, x]));
    const fm = new Map(f.body.data.map((x) => [x.symbol, x]));
    for (const s of WATCH) {
      const z = series.get(s);
      z.index.push(tm.get(s)?.indexPrice);
      z.mark.push(tm.get(s)?.fairPrice);
      z.tRate.push(tm.get(s)?.fundingRate);
      z.rate.push(fm.get(s)?.fundingRate);
      z.next.push(fm.get(s)?.nextSettleTime);
      const tk = tm.get(s);
      if (tk) {
        z.prem.push(Math.round((tk.fairPrice / tk.indexPrice - 1) * 1e6));
        z.touch = [tk.bid1, tk.ask1, tk.fairPrice, tk.indexPrice];
      }
    }
    if (i === 0) {
      const cyc = {};
      const next = {};
      const caps = {};
      let zeroMark = 0;
      let zeroIndex = 0;
      let rateMismatch = 0;
      const prem = [];
      for (const x of f.body.data) {
        cyc[x.collectCycle] = (cyc[x.collectCycle] ?? 0) + 1;
        next[new Date(x.nextSettleTime).toISOString()] = (next[new Date(x.nextSettleTime).toISOString()] ?? 0) + 1;
        caps[`${x.minFundingRate}..${x.maxFundingRate}`] = (caps[`${x.minFundingRate}..${x.maxFundingRate}`] ?? 0) + 1;
        const tk = tm.get(x.symbol);
        if (tk && tk.fundingRate !== x.fundingRate) rateMismatch++;
      }
      for (const x of t.body.data) {
        if (!x.fairPrice) zeroMark++;
        if (!x.indexPrice) zeroIndex++;
        if (x.fairPrice && x.indexPrice) prem.push([x.symbol, Math.round((x.fairPrice / x.indexPrice - 1) * 1e6)]);
      }
      prem.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const atCap = f.body.data.filter((x) => Math.abs(x.fundingRate) >= x.maxFundingRate).map((x) => x.symbol);
      const oneSided = t.body.data.filter((x) => !x.bid1 || !x.ask1).map((x) => x.symbol);
      log('anchor_shape', { oneSidedTickers: oneSided, tickerKeys: Object.keys(t.body.data[0]).join(','), fundingKeys: Object.keys(f.body.data[0]).join(','), collectCycle: cyc, nextSettle: next, rateCaps: caps, rateAtCap: atCap, tickerRateNotEqualFundingRate: rateMismatch, zeroMark, zeroIndex, largestMarkPremiumPpm: prem.slice(0, 8), localNow: new Date().toISOString() });
    }
    const wait = 1_000 - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
  const tMs = rounds.map((r) => r.t);
  const fMs = rounds.map((r) => r.f);
  log('anchor_timing', { rounds: rounds.length, statuses: [...new Set(rounds.map((r) => `${r.ts}/${r.fs}`))], tickerBytes: rounds[0].tb, fundingBytes: rounds[0].fb, tickerMs: { min: Math.min(...tMs), median: q(tMs, 0.5), p90: q(tMs, 0.9), max: Math.max(...tMs) }, fundingMs: { min: Math.min(...fMs), median: q(fMs, 0.5), p90: q(fMs, 0.9), max: Math.max(...fMs) } });
  const changes = (a) => a.slice(1).filter((v, i) => v !== a[i]).length;
  for (const [s, z] of series) log('anchor_changes', { symbol: s, of: z.index.length - 1, index: changes(z.index), mark: changes(z.mark), tickerRate: changes(z.tRate), fundingRate: changes(z.rate), nextSettle: changes(z.next), markPremiumPpmMin: Math.min(...z.prem), markPremiumPpmMax: Math.max(...z.prem), lastBidAskMarkIndex: z.touch, lastRate: z.rate.at(-1) });
}

async function historyMode() {
  const f = await get(`${REST}/funding_rate`);
  const fourHour = f.body.data.find((x) => x.collectCycle === 4)?.symbol;
  for (const s of [...WATCH, fourHour]) {
    const r = await get(`${REST}/funding_rate/history?symbol=${s}&page_num=1&page_size=12`);
    const rows = r.body?.data?.resultList ?? r.body?.data ?? [];
    const times = rows.map((x) => x.settleTime);
    const steps = times.slice(1).map((t, i) => (times[i] - t) / 3_600_000);
    log('funding_history', { symbol: s, status: r.status, keys: rows[0] ? Object.keys(rows[0]).join(',') : r.text.slice(0, 120), total: r.body?.data?.totalCount, first: rows[0], latestSettles: times.slice(0, 4).map((t) => new Date(t).toISOString()), stepsHours: steps, settleHoursUtc: [...new Set(times.map((t) => new Date(t).getUTCHours()))] });
    await sleep(500);
  }
  for (const p of ['index_price/BTC_USDT', 'fair_price/BTC_USDT', 'funding_rate/BTC_USDT', 'index_price/BTC_USD', 'fair_price/BTC_USD']) {
    const r = await get(`${REST}/${p}`);
    log('single', { path: p, status: r.status, ms: r.ms, body: r.text.slice(0, 260) });
    await sleep(500);
  }
}

function ordered(levels, side) {
  for (let i = 1; i < levels.length; i++) if (side === 'bids' ? levels[i][0] >= levels[i - 1][0] : levels[i][0] <= levels[i - 1][0]) return false;
  return true;
}

async function bookMode() {
  for (const limit of [null, 5, 20, 100, 1000]) {
    const r = await get(`${REST}/depth/BTC_USDT${limit ? `?limit=${limit}` : ''}`);
    const d = r.body.data;
    log('depth', { limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: d.bids.length, asks: d.asks.length, bidsDescending: ordered(d.bids, 'bids'), asksAscending: ordered(d.asks, 'asks'), version: d.version, timestamp: d.timestamp, levelShape: JSON.stringify(d.bids[0]), cache: r.headers['cf-cache-status'] });
    await sleep(500);
  }
  const versions = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${REST}/depth/BTC_USDT?limit=5`);
    versions.push([r.body.data.version, Date.now() - r.body.data.timestamp]);
    await sleep(200);
  }
  log('depth_repeat', { versionAndAgeMs: versions });
  for (const s of ['ETH_USDT', 'BTC_USD', 'BTC_USDC']) {
    const r = await get(`${REST}/depth/${s}?limit=5`);
    log('depth_other', { symbol: s, status: r.status, bids: r.body.data?.bids, asks: r.body.data?.asks });
    await sleep(500);
  }
}

async function limitsMode() {
  const r = await get(`${REST}/ticker?symbol=BTC_USDT`);
  const keep = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !/cookie|report-to|^nel$|access-control-allow-headers/.test(k)));
  log('headers', { status: r.status, headers: keep });
  for (const p of ['depth/NOPE_USDT', 'ticker?symbol=NOPE_USDT', 'funding_rate/NOPE_USDT', 'depth/BTC-USDT', 'nope']) {
    const x = await get(`${REST}/${p}`);
    log('error_shape', { path: p, status: x.status, body: x.text.slice(0, 200) });
    await sleep(400);
  }
  const offs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const x = await get(`${REST}/ping`);
    const t1 = Date.now();
    offs.push({ rttMs: t1 - t0, offsetMs: x.body.data - Math.round((t0 + t1) / 2) });
    await sleep(400);
  }
  log('clock', { samples: offs });
}

const modes = { legacy: legacyMode, catalog: catalogMode, anchor: anchorMode, history: historyMode, book: bookMode, limits: limitsMode };
const picked = process.argv.slice(2);
for (const m of picked.length ? picked : Object.keys(modes)) {
  log('mode', { mode: m, at: new Date().toISOString() });
  await modes[m]();
}
