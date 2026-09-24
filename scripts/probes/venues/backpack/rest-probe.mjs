// Backpack Exchange REST probe: host and latency, the CCXT catalog, the markPrices anchor call polled at one hertz, funding history, the REST book, error shapes, public fee tiers and country permissions, and server time.
// Public, unauthenticated and read-only.
// Loops keep one second between two requests for the same URL, and the seed mode and one four-request book burst stay at 5 requests per second or less, far under the 20 per second CCXT assumes at ccxt/js/src/backpack.js line 25.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/backpack/rest-probe.mjs [main|poll|seed]
//   main  host, catalog through the raw call and CCXT, market families, fee tiers, country permissions, funding history, book, errors and server time, about 30 s
//   poll  markPrices polled 60 times at one hertz, with change counts per field, cache headers and the mark to index spread, then 15 polls with a unique query parameter that misses the CDN cache, about 80 s
//   seed  the REST book at 1,000 levels for every open perpetual at 5 requests per second, as a feed would seed its books, about 20 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/backpack/rest.md and docs/profiles/backpack/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.backpack.exchange';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// One retry on a dropped keep-alive socket, which CloudFront closed once on 2026-09-23.
async function fetchText(url) {
  const res = await fetch(url);
  return { res, text: await res.text() };
}

async function fetchOnce(url) {
  try {
    return await fetchText(url);
  } catch (e) {
    log('fetch_retry', { url, error: String(e.cause?.message ?? e.message) });
    await sleep(500);
    return fetchText(url);
  }
}

async function get(path) {
  const t0 = performance.now();
  const { res, text } = await fetchOnce(API + path);
  const ms = Math.round(performance.now() - t0);
  const headers = {};
  for (const [k, v] of res.headers) {
    if (/cache|age|x-cache|ratelimit|retry|x-amz-cf-pop|date/i.test(k)) headers[k] = v;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers };
}

const count = (arr, key) => arr.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});

async function host() {
  for (const name of ['api.backpack.exchange', 'ws.backpack.exchange']) {
    const a = await dns.resolve4(name).catch((e) => [String(e.code)]);
    const c = await dns.resolveCname(name).catch(() => []);
    log('dns', { name, a, cname: c });
  }
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/api/v1/time');
    times.push(r.ms);
    if (i === 0) log('time_cold', { ms: r.ms, status: r.status, body: r.text });
    await sleep(1000);
  }
  log('time_warm', { ms: times.slice(1) });

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/api/v1/time');
    const t1 = Date.now();
    offsets.push(Number(r.text) - (t0 + t1) / 2);
    await sleep(1000);
  }
  log('clock_offset_ms', { offsets: offsets.map((x) => Math.round(x)) });
  const st = await get('/api/v1/status');
  log('status', { status: st.status, body: st.text });
}

async function catalog() {
  const r = await get('/api/v1/markets');
  keep('markets.json', r.text);
  log('markets_call', { status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers });
  const m = r.json;
  log('markets_by_kind', count(m, (x) => `${x.marketType}|${x.quoteSymbol}|${x.orderBookState}|visible=${x.visible}|rwa=${x.rwaMarketType ?? '-'}`));
  const perps = m.filter((x) => x.marketType === 'PERP');
  log('perp_funding_interval_ms', count(perps, (x) => String(x.fundingInterval)));
  log('perp_funding_bounds_bps', count(perps, (x) => `${x.fundingRateLowerBound}..${x.fundingRateUpperBound}`));
  log('perp_price_update_multiplier', count(perps, (x) => `${x.filters.price.minPriceUpdateMultiplier}..${x.filters.price.maxPriceUpdateMultiplier}`));
  log('perp_mean_mark_band', count(perps, (x) => JSON.stringify(x.filters.price.meanMarkPriceBand)));
  log('perp_mean_premium_band', count(perps, (x) => JSON.stringify(x.filters.price.meanPremiumBand)));
  log('perp_not_open', { rows: perps.filter((x) => x.orderBookState !== 'Open').map((x) => `${x.symbol}:${x.orderBookState}:${x.visible}`) });
  log('perp_rwa', { rows: perps.filter((x) => x.rwaMarketType).map((x) => `${x.symbol}:${x.rwaMarketType}:${x.orderBookState}`) });
  const suffixes = count(perps, (x) => x.symbol.replace(`${x.baseSymbol}_${x.quoteSymbol}`, '') || '(none)');
  log('perp_symbol_suffix', suffixes);

  for (const t of ['PERP', 'IPERP', 'DATED', 'PREDICTION', 'RFQ', 'SPOT']) {
    const x = await get(`/api/v1/markets?marketType=${t}`);
    const rows = Array.isArray(x.json) ? x.json : [];
    log('markets_family', { marketType: t, status: x.status, rows: rows.length, open: rows.filter((y) => y.orderBookState === 'Open').length, sample: rows.slice(0, 3).map((y) => y.symbol) });
    await sleep(1000);
  }

  const ex = new ccxt.backpack();
  const t0 = performance.now();
  await ex.loadMarkets();
  const ms = Math.round(performance.now() - t0);
  const all = Object.values(ex.markets);
  const swaps = all.filter((x) => x.swap);
  const active = swaps.filter((x) => x.active);
  log('ccxt_load', { ms, markets: all.length, swaps: swaps.length, activeSwaps: active.length, version: ccxt.version });
  log('ccxt_active_by_settle', count(active, (x) => `${x.settle}|linear=${x.linear}|contractSize=${x.contractSize}|taker=${x.taker}|maker=${x.maker}`));
  const btc = ex.markets['BTC/USDC:USDC'];
  log('ccxt_btc', { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, settle: btc.settle, linear: btc.linear, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker, active: btc.active, precision: btc.precision });
  const pairs = count(active, (x) => `${x.base}/${x.quote}`);
  log('ccxt_pairs_listed_twice', { pairs: Object.entries(pairs).filter(([, n]) => n > 1) });
  const idMismatch = active.filter((x) => !perps.find((p) => p.symbol === x.id));
  log('ccxt_id_vs_markets_symbol', { active: active.length, notInRaw: idMismatch.map((x) => x.id) });
  const odd = active.filter((x) => /^\d/.test(x.base) || x.base.length > 8 || x.base !== x.info.baseSymbol);
  log('ccxt_odd_bases', { rows: odd.map((x) => `${x.id}:${x.base}`) });

  const one = await get('/api/v1/markPrices?symbol=BTC_USDC_PERP');
  log('markprices_one_symbol', { status: one.status, rows: Array.isArray(one.json) ? one.json.length : null, headers: one.headers });
  await sleep(1000);
  const mp = await get('/api/v1/markPrices');
  log('markprices_headers', { headers: mp.headers });
  const keys = new Set(mp.json.map((x) => x.symbol));
  log('markprices_vs_catalog', {
    markPriceRows: mp.json.length,
    activeMissingFromMarkPrices: active.filter((x) => !keys.has(x.id)).map((x) => x.id),
    markPricesNotActive: [...keys].filter((k) => !active.find((x) => x.id === k)),
  });
  return { perps, active, markPrices: mp.json };
}

async function fees() {
  const r = await get('/wapi/v1/feeTiers');
  log('fee_tiers', { status: r.status, ms: r.ms, futuresTier1: r.json?.futures?.[0], spotTier1: r.json?.spot?.[0], futuresTiers: r.json?.futures?.length });
  await sleep(1000);
  const p = await get('/wapi/v1/country/permissions');
  const perms = p.json ?? [];
  log('country_permissions', {
    status: p.status,
    rows: perms.length,
    perpDisabled: perms.filter((x) => !x.isPerpEnabled).map((x) => x.countryCode),
    us: perms.find((x) => x.countryCode === 'US'),
    leverageLimits: count(perms.filter((x) => x.isPerpEnabled), (x) => x.leverageLimit),
  });
  await sleep(1000);
  const c = await get('/wapi/v1/country');
  const rows = c.json ?? [];
  log('country', { status: c.status, rows: rows.length, blocked: rows.filter((x) => x.blocked).map((x) => x.countryCode), sanctioned: rows.filter((x) => x.sanctioned).map((x) => x.countryCode), us: rows.find((x) => x.countryCode === 'US') });
}

async function funding(markPrices) {
  const now = Date.now();
  log('markprices_next_funding', count(markPrices, (x) => String(x.nextFundingTimestamp)));
  log('markprices_rate_is_0_0000125', { rows: markPrices.filter((x) => Number(x.fundingRate) === 0.0000125).length, of: markPrices.length });
  const extremes = [...markPrices].sort((a, b) => Math.abs(Number(b.fundingRate)) - Math.abs(Number(a.fundingRate))).slice(0, 5);
  log('markprices_rate_extremes', { rows: extremes.map((x) => `${x.symbol}:${x.fundingRate}`) });
  for (const sym of ['BTC_USDC_PERP', 'SOL_USDC_PERP', extremes[0].symbol]) {
    const r = await get(`/api/v1/fundingRates?symbol=${sym}&limit=4`);
    const cur = markPrices.find((x) => x.symbol === sym);
    log('funding_history', { sym, status: r.status, rows: r.json, markPricesRate: cur?.fundingRate, markPricesNext: cur?.nextFundingTimestamp && new Date(cur.nextFundingTimestamp).toISOString(), now: new Date(now).toISOString() });
    await sleep(1000);
  }
  const r = await get('/api/v1/fundingRates?symbol=BTC_USDC_PERP&limit=1000');
  const ts = (r.json ?? []).map((x) => Date.parse(x.intervalEndTimestamp + 'Z'));
  const gaps = count(ts.slice(1).map((t, i) => ts[i] - t), (x) => String(x / 3_600_000) + 'h');
  log('funding_history_spacing', { rows: ts.length, first: r.json?.at(-1)?.intervalEndTimestamp, last: r.json?.[0]?.intervalEndTimestamp, gaps });
}

async function book() {
  for (const limit of ['5', '20', '1000', undefined]) {
    const r = await get(`/api/v1/depth?symbol=BTC_USDC_PERP${limit ? `&limit=${limit}` : ''}`);
    const d = r.json;
    const bidsDesc = d.bids.every((b, i) => i === 0 || Number(d.bids[i - 1][0]) > Number(b[0]));
    const bidsAsc = d.bids.every((b, i) => i === 0 || Number(d.bids[i - 1][0]) < Number(b[0]));
    const asksAsc = d.asks.every((b, i) => i === 0 || Number(d.asks[i - 1][0]) < Number(b[0]));
    log('depth', {
      limit: limit ?? 'none', status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers,
      bids: d.bids.length, asks: d.asks.length, bidsDesc, bidsAsc, asksAsc,
      bidFirst: d.bids[0], bidLast: d.bids.at(-1), askFirst: d.asks[0], askLast: d.asks.at(-1),
      lastUpdateId: d.lastUpdateId, timestamp: d.timestamp, ageMs: Math.round(Date.now() - d.timestamp / 1000),
    });
    await sleep(1000);
  }
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const r = await get('/api/v1/depth?symbol=BTC_USDC_PERP&limit=5');
    ids.push({ id: r.json.lastUpdateId, cache: r.headers['x-cache'], age: r.headers.age, ms: r.ms });
    await sleep(250);
  }
  log('depth_repeat_250ms', { ids });
}

async function errors() {
  const cases = [
    '/api/v1/depth?symbol=NOPE_USDC_PERP',
    '/api/v1/depth?symbol=BTC_USDC_PERP&limit=30',
    '/api/v1/depth',
    '/api/v1/markPrices?symbol=NOPE_USDC_PERP',
    '/api/v1/markPrices?marketType=NOPE',
    '/api/v1/fundingRates',
    '/api/v1/market?symbol=NOPE',
    '/api/v1/nope',
    '/api/v1/depth?symbol=TON_USDC_PERP&limit=5',
    '/api/v1/markPrices?symbol=TON_USDC_PERP',
  ];
  for (const c of cases) {
    const r = await get(c);
    log('error_case', { path: c, status: r.status, body: r.text.slice(0, 200), headers: r.headers });
    await sleep(1000);
  }
}

async function poll() {
  const rounds = 60;
  const seen = new Map();
  const replies = [];
  let prevText;
  let identical = 0;
  let maxIndexStep = { sym: '', step: 0 };
  let maxMarkStep = { sym: '', step: 0 };
  const lastVal = new Map();
  let firstRows;
  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now();
    const r = await get('/api/v1/markPrices');
    replies.push({ ms: r.ms, status: r.status, bytes: r.bytes, cache: r.headers['x-cache'], age: r.headers.age });
    if (r.status !== 200) {
      await sleep(Math.max(0, 1000 - (Date.now() - t0)));
      continue;
    }
    if (r.text === prevText) identical++;
    prevText = r.text;
    if (!firstRows) firstRows = r.json;
    for (const x of r.json) {
      const s = seen.get(x.symbol) ?? { index: new Set(), mark: new Set(), rate: new Set(), next: new Set() };
      s.index.add(x.indexPrice);
      s.mark.add(x.markPrice);
      s.rate.add(x.fundingRate);
      s.next.add(x.nextFundingTimestamp);
      seen.set(x.symbol, s);
      const prev = lastVal.get(x.symbol);
      if (prev) {
        const di = Math.abs(Number(x.indexPrice) / Number(prev.indexPrice) - 1);
        const dm = Math.abs(Number(x.markPrice) / Number(prev.markPrice) - 1);
        if (di > maxIndexStep.step) maxIndexStep = { sym: x.symbol, step: di };
        if (dm > maxMarkStep.step) maxMarkStep = { sym: x.symbol, step: dm };
      }
      lastVal.set(x.symbol, x);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  keep('markprices-last.json', prevText ?? '');
  const ms = replies.map((x) => x.ms).sort((a, b) => a - b);
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  log('poll_timing', { rounds, statuses: count(replies, (x) => String(x.status)), min: ms[0], median: q(0.5), p90: q(0.9), max: ms.at(-1), bytes: replies[0].bytes, identicalToPrevious: identical, xcache: count(replies, (x) => String(x.cache)), ages: count(replies, (x) => String(x.age)) });
  const dist = (field) => {
    const n = [...seen.values()].map((s) => s[field].size).sort((a, b) => a - b);
    return { min: n[0], median: n[Math.floor(n.length / 2)], max: n.at(-1) };
  };
  log('poll_distinct_values_per_symbol', { symbols: seen.size, index: dist('index'), mark: dist('mark'), rate: dist('rate'), next: dist('next') });
  for (const sym of ['BTC_USDC_PERP', 'ETH_USDC_PERP', 'SOL_USDC_PERP']) {
    const s = seen.get(sym);
    if (s) log('poll_symbol', { sym, index: s.index.size, mark: s.mark.size, rate: s.rate.size, next: s.next.size });
  }
  log('poll_max_step', { index: maxIndexStep, mark: maxMarkStep });
  log('poll_flat_symbols', { rows: [...seen.entries()].filter(([, s]) => s.index.size <= 3).map(([k, s]) => `${k}:index=${s.index.size}:mark=${s.mark.size}:rate=${s.rate.size}`) });
  log('poll_rate_constant', { rows: [...seen.entries()].filter(([, s]) => s.rate.size === 1).length, of: seen.size });
  const prem = [...lastVal.values()].map((x) => ({ sym: x.symbol, p: Number(x.markPrice) / Number(x.indexPrice) - 1 })).sort((a, b) => Math.abs(b.p) - Math.abs(a.p));
  log('premium_top', { rows: prem.slice(0, 8).map((x) => `${x.sym}:${(x.p * 1e6).toFixed(0)}ppm`) });
  log('premium_abs_distribution_ppm', count(prem, (x) => { const a = Math.abs(x.p) * 1e6; return a < 1000 ? '<1000' : a < 5000 ? '1000-5000' : a < 10000 ? '5000-10000' : '>=10000'; }));
  log('markprices_fields', { keys: count(firstRows ?? [], (x) => Object.keys(x).sort().join(',')), sample: firstRows?.find((x) => x.symbol === 'BTC_USDC_PERP') });

  // The query string is part of the CloudFront cache key, so a unique parameter reaches the origin.
  const busted = [];
  for (let i = 0; i < 15; i++) {
    const t0 = Date.now();
    const r = await get(`/api/v1/markPrices?_=${t0}`);
    busted.push({ ms: r.ms, status: r.status, cache: r.headers['x-cache'] });
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  const bms = busted.map((x) => x.ms).sort((a, b) => a - b);
  log('poll_cache_busted', { rounds: busted.length, statuses: count(busted, (x) => String(x.status)), xcache: count(busted, (x) => String(x.cache)), min: bms[0], median: bms[Math.floor(bms.length / 2)], max: bms.at(-1) });
}

// What a feed would do at start: seed every open perpetual from the REST book, paced at 5 requests per second.
async function seed() {
  const m = (await get('/api/v1/markets?marketType=PERP')).json.filter((x) => x.orderBookState === 'Open').map((x) => x.symbol);
  const rows = [];
  const t0 = Date.now();
  for (const sym of m) {
    const t = Date.now();
    const r = await get(`/api/v1/depth?symbol=${sym}&limit=1000`);
    const d = r.json ?? { bids: [], asks: [] };
    rows.push({ sym, status: r.status, ms: r.ms, bytes: r.bytes, bids: d.bids.length, asks: d.asks.length, body: r.status === 200 ? undefined : r.text.slice(0, 200), headers: r.status === 200 ? undefined : r.headers });
    await sleep(Math.max(0, 200 - (Date.now() - t)));
  }
  const ms = rows.map((x) => x.ms).sort((a, b) => a - b);
  log('seed', {
    markets: m.length, seconds: Math.round((Date.now() - t0) / 1000), statuses: count(rows, (x) => String(x.status)),
    msMedian: ms[Math.floor(ms.length / 2)], msMax: ms.at(-1), totalKB: Math.round(rows.reduce((a, x) => a + x.bytes, 0) / 1024),
    under20Bids: rows.filter((x) => x.bids < 20).map((x) => `${x.sym}:${x.bids}`), under20Asks: rows.filter((x) => x.asks < 20).map((x) => `${x.sym}:${x.asks}`),
    oneSidedOrEmpty: rows.filter((x) => x.bids === 0 || x.asks === 0).map((x) => `${x.sym}:${x.bids}/${x.asks}`),
    at1000: rows.filter((x) => x.bids === 1000 || x.asks === 1000).length,
    refusals: rows.filter((x) => x.status !== 200).slice(0, 3),
  });
}

const mode = process.argv[2] ?? 'main';
if (mode === 'main') {
  await host();
  const { markPrices } = await catalog();
  await fees();
  await funding(markPrices);
  await book();
  await errors();
} else if (mode === 'poll') {
  await poll();
} else if (mode === 'seed') {
  await seed();
} else {
  console.error('mode: main | poll | seed');
  process.exit(1);
}
