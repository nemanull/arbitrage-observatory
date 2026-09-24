// Biconomy.com futures REST probe: catalog, anchor calls and their cadence, funding history, REST book, errors, latency and clock offset.
// The futures endpoints are the ones the biconomy.com futures web app calls under https://openapi.biconomy.com/future/api/v1.
// They are not in the official API documentation, which covers spot only.
// Public, unauthenticated, read-only. At most about 3 requests per second, below the 5 to 20 per second the spot documentation publishes.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/biconomy/rest-probe.mjs [catalog|latency|anchor|history|book|errors|index]
//   catalog  detailV2, ticker/list, allFundingRate and the fee page reply: counts, states, contract sizes, size unit, index sources.
//   latency  cold and warm times for ping and the bulk calls, and the clock offset against ping.
//   anchor   60 one-second polls of ticker/list and allFundingRate: reply size and time, how often index, mark and rate change, the premium.
//   history  fundingRate/history for four contracts: settlement instants, intervals, settled rate against the live rate.
//   book     depth/{symbol} and depth/priceStep: level counts, order, caching headers, size unit against the contract size.
//   errors   unknown symbol, unknown path, lowercase symbol, delisted symbol, the MEXC contract paths, and the response headers a limit would use.
//   index    every contract whose mark sits more than 5,000 ppm from its index, and how long its hourly index candles have been flat.
// Set PROBE_OUT_DIR to keep a few trimmed replies. Recorded in docs/profiles/biconomy/rest.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://openapi.biconomy.com/future/api/v1';
const FEE_URL = 'https://openapi.biconomy.com/api/v1/exchange-fee';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text.slice(0, 200_000));
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, json, text, headers: res.headers };
}

const counts = (arr, key) => {
  const m = {};
  for (const x of arr) {
    const v = typeof key === 'function' ? key(x) : x[key];
    m[v] = (m[v] ?? 0) + 1;
  }
  return m;
};

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function catalog() {
  const detail = await get(`${API}/detailV2?client=web`);
  const tickers = await get(`${API}/ticker/list?timezone=24H`);
  const funding = await get(`${API}/allFundingRate`);
  const fee = await get(FEE_URL);
  keep('detailV2.json', detail.text);
  for (const [name, r] of Object.entries({ detail, tickers, funding, fee })) {
    log('reply', { name, status: r.status, ms: r.ms, bytes: r.bytes });
  }
  const all = detail.json.data;
  const active = all.filter((c) => c.state === 0);
  log('detailV2', {
    rows: all.length,
    state: counts(all, 'state'),
    settle: counts(all, 'sc'),
    quote: counts(all, 'qc'),
    futureType: counts(all, 'ft'),
    active: active.length,
    activeCt: counts(active, 'ct'),
    activeFees: counts(active, (c) => `${c.mfr}/${c.tfr}`),
    activeHidden: active.filter((c) => c.ih || c.ihd).map((c) => `${c.symbol}:ih=${c.ih},ihd=${c.ihd}`),
    symbolIsBaseQuote: active.every((c) => c.symbol === `${c.bc}_${c.qc}`),
    duplicateBases: Object.entries(counts(active, 'bc')).filter(([, n]) => n > 1),
  });
  log('contractSize', { cs: counts(active, 'cs') });
  const scaled = active.filter((c) => /^\d+/.test(c.bc) || /^1000|^10000|^1M/.test(c.symbol));
  log('scaledNames', { n: scaled.length, sample: scaled.slice(0, 12).map((c) => `${c.symbol}:cs=${c.cs}`) });
  const sources = active.map((c) => c.io ?? []);
  log('indexSources', {
    perContract: counts(sources, (s) => s.length),
    byVenue: counts(sources.flat(), (s) => s),
    containsBiconomy: sources.filter((s) => s.some((v) => /BICONOMY/i.test(v))).length,
    single: active.filter((c) => (c.io ?? []).length === 1).map((c) => `${c.symbol}:${c.io[0]}`),
  });
  const btc = all.find((c) => c.symbol === 'BTC_USDT');
  log('btcRow', { row: Object.fromEntries(Object.entries(btc).filter(([k]) => k !== 'baseCoinIconUrl')) });

  const t = tickers.json.data;
  const f = funding.json.data;
  const tSet = new Set(t.map((x) => x.symbol));
  const fSet = new Set(f.map((x) => x.symbol));
  const aSet = new Set(active.map((c) => c.symbol));
  log('sets', {
    tickers: t.length,
    funding: f.length,
    tickersNotActive: [...tSet].filter((s) => !aSet.has(s)),
    activeNotTickers: [...aSet].filter((s) => !tSet.has(s)),
    fundingEqualsTickers: tSet.size === fSet.size && [...tSet].every((s) => fSet.has(s)),
  });
  log('fundingRows', {
    cycle: counts(f, 'cycle'),
    nextSettleTs: counts(f, 'nextSettleTs'),
    notEight: f.filter((x) => x.cycle !== 8),
    zeroRate: f.filter((x) => x.fundingRate === 0).length,
    atPlus0001: f.filter((x) => x.fundingRate === 0.0001).length,
    atPlus0005: f.filter((x) => x.fundingRate === 0.0005).length,
    atMinus0005: f.filter((x) => x.fundingRate === -0.0005).length,
    beyond0005: f.filter((x) => Math.abs(x.fundingRate) > 0.0005).length,
  });
  const tickerKeys = new Set();
  t.forEach((x) => Object.keys(x).forEach((k) => tickerKeys.add(k)));
  log('tickerFields', { keys: [...tickerKeys], zeroFair: t.filter((x) => !x.fairPrice).length, zeroIndex: t.filter((x) => !x.indexPrice).length });

  // amount24 is quote turnover and volume24 is contracts, so amount24 / (volume24 * price) recovers the contract size.
  let agree = 0;
  let checked = 0;
  const off = [];
  for (const x of t) {
    const c = all.find((d) => d.symbol === x.symbol);
    if (!c || !x.volume24 || !x.amount24) continue;
    checked++;
    const implied = x.amount24 / (x.volume24 * x.curPrice);
    if (Math.abs(implied / c.cs - 1) < 0.15) agree++;
    else off.push(`${x.symbol}:cs=${c.cs},implied=${implied.toPrecision(3)}`);
  }
  log('sizeUnitFromTurnover', { checked, agree, off: off.slice(0, 10) });

  const fees = fee.json.result.futures_fee;
  log('feePage', {
    futuresRows: fees.length,
    futuresFees: counts(fees, (x) => `${Number(x.maker_fee)}/${Number(x.taker_fee)}`),
    activeNotOnFeePage: [...aSet].filter((s) => !fees.some((x) => x.symbol === s)),
    spotRows: fee.json.result.spot_fee.length,
    spotFees: counts(fee.json.result.spot_fee, (x) => `${x.maker_fee}/${x.taker_fee}`),
  });
}

async function latency() {
  for (const path of ['ping', 'ticker/list?timezone=24H', 'allFundingRate', 'detailV2?client=web']) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const r = await get(`${API}/${path}`);
      times.push(r.ms);
      await sleep(400);
    }
    log('latency', { path, coldMs: times[0], warmMs: times.slice(1) });
  }
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/ping`);
    const t1 = Date.now();
    offsets.push({ rtt: t1 - t0, offset: r.json.data - (t0 + t1) / 2 });
    await sleep(300);
  }
  offsets.sort((a, b) => a.rtt - b.rtt);
  log('clock', { bestRtt: offsets[0].rtt, offsetAtBestRtt: Math.round(offsets[0].offset), offsets: offsets.map((o) => Math.round(o.offset)) });
  const r = await get(`${API}/ticker/list?timezone=24H`);
  log('headers', { h: Object.fromEntries([...r.headers].filter(([k]) => /cache|age|cf-|rate|limit|retry|server|date/i.test(k))) });
}

async function anchor() {
  const watch = ['BTC_USDT', 'ETH_USDT', 'NATGAS_USDT', 'ONG_USDT', 'KNC_USDT'];
  const prev = new Map();
  const changes = {};
  const times = { tickers: [], funding: [] };
  const sizes = { tickers: 0, funding: 0 };
  let maxPremium = { ppm: 0 };
  let lagSamples = [];
  const rateMismatch = new Set();
  const polls = 60;
  for (let i = 0; i < polls; i++) {
    const start = Date.now();
    const [t, f] = await Promise.all([get(`${API}/ticker/list?timezone=24H`), get(`${API}/allFundingRate`)]);
    times.tickers.push(t.ms);
    times.funding.push(f.ms);
    sizes.tickers = t.bytes;
    sizes.funding = f.bytes;
    const fr = new Map(f.json.data.map((x) => [x.symbol, x]));
    for (const x of t.json.data) {
      if (x.indexPrice > 0) {
        const ppm = Math.round((x.fairPrice / x.indexPrice - 1) * 1e6);
        if (Math.abs(ppm) > Math.abs(maxPremium.ppm)) maxPremium = { ppm, symbol: x.symbol, fair: x.fairPrice, index: x.indexPrice };
      }
      const fx = fr.get(x.symbol);
      if (fx && fx.fundingRate !== x.fundingRate) rateMismatch.add(x.symbol);
      if (!watch.includes(x.symbol)) continue;
      const p = prev.get(x.symbol);
      const c = (changes[x.symbol] ??= { index: 0, fair: 0, rate: 0, ts: 0 });
      if (p) {
        if (p.indexPrice !== x.indexPrice) c.index++;
        if (p.fairPrice !== x.fairPrice) c.fair++;
        if (p.fundingRate !== x.fundingRate) c.rate++;
        if (p.ts !== x.ts) c.ts++;
      }
      prev.set(x.symbol, x);
      if (x.symbol === 'BTC_USDT') lagSamples.push(start + t.ms - x.ts);
    }
    const wait = 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
  }
  const s = (a) => [...a].sort((x, y) => x - y);
  for (const k of ['tickers', 'funding']) {
    const a = s(times[k]);
    log('pollTime', { call: k, bytes: sizes[k], min: a[0], median: pct(a, 50), p90: pct(a, 90), max: a[a.length - 1], over1s: a.filter((x) => x > 1000).length });
  }
  log('changesOver59Intervals', changes);
  log('premium', { maxAbs: maxPremium });
  log('rateTickerVsAllFunding', { symbolsThatDiffered: rateMismatch.size, sample: [...rateMismatch].slice(0, 8) });
  const lag = s(lagSamples);
  log('btcTickerTsAge', { note: 'arrival minus ts, local clock', min: lag[0], median: pct(lag, 50), max: lag[lag.length - 1] });
}

async function history() {
  const live = await get(`${API}/allFundingRate`);
  const liveMap = new Map(live.json.data.map((x) => [x.symbol, x]));
  for (const symbol of ['BTC_USDT', 'ETH_USDT', 'ONG_USDT', 'BASED_USDT']) {
    const r = await get(`${API}/fundingRate/history?symbol=${symbol}&page_num=1&page_size=20`);
    const d = r.json.data;
    const rows = d.resultList;
    const gapsH = [];
    for (let i = 1; i < rows.length; i++) gapsH.push((rows[i - 1].settleTime - rows[i].settleTime) / 3.6e6);
    const hours = counts(rows, (x) => new Date(x.settleTime).getUTCHours());
    const rates = rows.map((x) => x.fundingRate);
    log('history', {
      symbol,
      status: r.status,
      pageSize: d.pageSize,
      totalCount: d.totalCount,
      newest: rows[0],
      oldestOnPage: new Date(rows[rows.length - 1].settleTime).toISOString(),
      intervalsH: counts(gapsH, (x) => x),
      settleHoursUtc: hours,
      maxAbsRate: Math.max(...rates.map(Math.abs)),
      live: liveMap.get(symbol),
    });
    await sleep(400);
  }
  // Whether the live rate equals the newest settled rate, on every twelfth active contract.
  const sample = live.json.data.filter((_, i) => i % 12 === 0);
  const cmp = { equal: 0, differ: 0, equalSymbols: [] };
  for (const x of sample) {
    const r = await get(`${API}/fundingRate/history?symbol=${x.symbol}&page_num=1&page_size=1`);
    const newest = r.json.data.resultList[0];
    if (newest && newest.fundingRate === x.fundingRate) {
      cmp.equal++;
      cmp.equalSymbols.push(`${x.symbol}:${x.fundingRate}`);
    } else cmp.differ++;
    await sleep(350);
  }
  log('liveVsNewestSettled', { sampled: sample.length, ...cmp });
  const one = await get(`${API}/fundingRate/BTC_USDT`);
  log('single', { status: one.status, data: one.json.data });
  let maxAbs = { rate: 0 };
  for (const x of live.json.data) if (Math.abs(x.fundingRate) > Math.abs(maxAbs.rate)) maxAbs = { rate: x.fundingRate, symbol: x.symbol, cycle: x.cycle };
  const cap = counts(live.json.data, (x) => (Math.abs(x.fundingRate) >= 0.003 ? '>=0.003' : Math.abs(x.fundingRate) >= 0.001 ? '>=0.001' : '<0.001'));
  log('liveRates', { maxAbs, buckets: cap });
}

async function book() {
  for (const symbol of ['BTC_USDT', 'ETH_USDT', 'NATGAS_USDT', 'KNC_USDT']) {
    const r = await get(`${API}/depth/${symbol}`);
    const d = r.json.data;
    const desc = (a) => a.every((l, i) => i === 0 || a[i - 1][0] > l[0]);
    const asc = (a) => a.every((l, i) => i === 0 || a[i - 1][0] < l[0]);
    log('restDepth', {
      symbol,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      keys: Object.keys(d),
      bids: d.bids.length,
      asks: d.asks.length,
      bidsDescending: desc(d.bids),
      asksAscending: asc(d.asks),
      levelShape: d.bids[0],
      version: d.version,
      cacheControl: r.headers.get('cache-control'),
      age: r.headers.get('age'),
      cf: r.headers.get('cf-cache-status'),
    });
    await sleep(400);
  }
  for (const q of ['depth/BTC_USDT?limit=20', 'depth/BTC_USDT/20', 'depth/priceStep/BTC_USDT?priceStep=0.1', 'depth/priceStep/BTC_USDT?priceStep=1']) {
    const r = await get(`${API}/${q}`);
    const d = r.json?.data;
    log('depthVariant', { q, status: r.status, bytes: r.bytes, bids: d?.bids?.length, asks: d?.asks?.length, keys: d ? Object.keys(d) : r.text.slice(0, 120) });
    await sleep(400);
  }
  // Two reads 300 ms apart show whether the reply is cached at the edge.
  const a = await get(`${API}/depth/BTC_USDT`);
  await sleep(300);
  const b = await get(`${API}/depth/BTC_USDT`);
  log('cacheCheck', { v1: a.json.data.version, v2: b.json.data.version, same: a.json.data.version === b.json.data.version });
}

async function errors() {
  const cases = [
    `${API}/fundingRate/NOPE_USDT`,
    `${API}/depth/NOPE_USDT`,
    `${API}/depth/btc_usdt`,
    `${API}/fundingRate/LRC_USDT`,
    `${API}/depth/LRC_USDT`,
    `${API}/nope`,
    `${API}/contract/detail`,
    `${API}/detail`,
    `${API}/ticker`,
    `${API}/funding_rate/BTC_USDT`,
    `${API}/index_price/BTC_USDT`,
    `${API}/fundingRate/history?symbol=NOPE_USDT`,
  ];
  for (const url of cases) {
    const r = await get(url);
    log('error', { url: url.replace(API, ''), status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
    await sleep(400);
  }
  const r = await get(`${API}/ping`);
  log('pingHeaders', { h: Object.fromEntries([...r.headers].filter(([k]) => /rate|limit|retry|remaining/i.test(k))) });
}

// For every contract whose mark sits more than 5,000 ppm from its index, how long the hourly index candles have been flat.
async function index() {
  const t = await get(`${API}/ticker/list?timezone=24H`);
  const detail = await get(`${API}/detailV2?client=web`);
  const sources = new Map(detail.json.data.map((c) => [c.symbol, c.io]));
  const wide = t.json.data
    .map((x) => ({ symbol: x.symbol, ppm: Math.round((x.fairPrice / x.indexPrice - 1) * 1e6), fair: x.fairPrice, index: x.indexPrice, bid: x.bid1, ask: x.ask1 }))
    .filter((x) => Math.abs(x.ppm) > 5000);
  const buckets = counts(t.json.data, (x) => {
    const a = Math.abs(x.fairPrice / x.indexPrice - 1) * 1e6;
    return a < 1000 ? 'under 1,000 ppm' : a < 5000 ? '1,000 to 5,000' : a < 10000 ? '5,000 to 10,000' : 'over 10,000';
  });
  const rows = t.json.data;
  log('premiumBuckets', {
    contracts: rows.length,
    buckets,
    markEqualsLast: rows.filter((x) => x.fairPrice === x.curPrice).length,
    markWithin100ppmOfMid: rows.filter((x) => Math.abs((x.bid1 + x.ask1) / 2 / x.fairPrice - 1) < 1e-4).length,
    markInsideTouch: rows.filter((x) => x.fairPrice >= x.bid1 && x.fairPrice <= x.ask1).length,
  });
  for (const w of wide) {
    const k = await get(`${API}/kline/indexPrice/${w.symbol}?interval=Min60`);
    const d = k.json.data;
    const n = d.time.length;
    let flat = 0;
    for (let i = n - 1; i >= 0 && d.h[i] === d.l[i] && d.c[i] === d.c[n - 1]; i--) flat++;
    log('wideIndex', { ...w, sources: sources.get(w.symbol), flatHourlyCandles: flat, flatSince: flat ? new Date(d.time[n - flat] * 1000).toISOString() : null, candles: n, wholeWindowFlat: flat === n });
    await sleep(400);
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, latency, anchor, history, book, errors, index };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
