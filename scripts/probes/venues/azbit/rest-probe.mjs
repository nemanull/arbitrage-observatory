// Azbit REST probe: host and latency, the futures and spot catalogs, the futures funding fields, the REST book, error shapes,
// clock offset from the Date header, CoinGecko listing context, and a side by side read of Bybit's public linear market,
// because the Azbit futures book and funding look like a copy of Bybit's.
// Public, unauthenticated, read-only. Azbit allows 5 requests per second per endpoint per IP for calls without a key,
// and every mode stays under 3 per second on any one endpoint.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/azbit/rest-probe.mjs [main|poll]
//   main  DNS, 10 healthcheck calls, both catalogs, books, errors, the Bybit comparison, CoinGecko. About 20 s.
//   poll  the futures pairs call once a second for 60 s, the BTCUSDT REST book twice a second for 20 s against Bybit's. About 85 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/azbit/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://data.azbit.com';
const BYBIT = 'https://api.bybit.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: Math.round(Math.min(...xs)), median: Math.round(pct(xs, 50)), p90: Math.round(pct(xs, 90)), max: Math.round(Math.max(...xs)) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, text, json, headers: res.headers, bytes: Buffer.byteLength(text) };
}

const utcMs = (s) => (s ? Date.parse(s.endsWith('Z') ? s : s + 'Z') : NaN);
const sig = (levels, n = 5) => levels.slice(0, n).map(([p, q]) => `${Number(p)}x${Number(q)}`).join(',');

async function main() {
  // 1. Host and latency.
  for (const host of ['data.azbit.com', 'ws.azbit.com']) {
    log('dns', { host, a: await dns.resolve4(host).catch((e) => e.code) });
  }
  const hc = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${API}/api/healthcheck`);
    hc.push(r.ms);
    if (i === 0) log('healthcheck_first', { status: r.status, ms: Math.round(r.ms), body: r.text.slice(0, 120), server: r.headers.get('server'), cfRay: r.headers.get('cf-ray') });
    await sleep(300);
  }
  log('healthcheck_timing', { first: Math.round(hc[0]), warm: stats(hc.slice(1)) });

  // 2. Futures catalog.
  const fp = await get(`${API}/api/futures/exchange-data/pairs`);
  keep('futures-pairs.json', fp.text);
  const pairs = fp.json;
  const headerNames = [...fp.headers.keys()].filter((k) => !['set-cookie', 'report-to', 'nel'].includes(k));
  log('futures_pairs', { status: fp.status, bytes: fp.bytes, ms: Math.round(fp.ms), rows: pairs.length, active: pairs.filter((p) => p.isActive).length, headerNames });
  const shape = {};
  for (const p of pairs) {
    const k = /^[A-Z0-9]+USDT$/.test(p.currencyPairCode) ? 'xxxUSDT' : p.currencyPairCode;
    shape[k] = (shape[k] ?? 0) + 1;
  }
  log('futures_code_shapes', shape);
  log('futures_units', {
    uniqueCodes: new Set(pairs.map((p) => p.currencyPairCode)).size,
    contractValueEqualsLotSize: pairs.filter((p) => p.contractValue === p.lotSize).length,
    otherwise: pairs.filter((p) => p.contractValue !== p.lotSize).map((p) => [p.currencyPairCode, p.contractValue, p.lotSize]),
    per1000: pairs.map((p) => p.currencyPairCode).filter((c) => /1000/.test(c)),
  });
  const intervals = {};
  for (const p of pairs) {
    const h = (utcMs(p.fundingRateFinishTimestamp) - utcMs(p.fundingRateStartTimestamp)) / 3.6e6;
    const k = `${h}h to ${p.fundingRateFinishTimestamp}`;
    intervals[k] = (intervals[k] ?? 0) + 1;
  }
  log('futures_funding_intervals', { now: new Date().toISOString(), intervals });
  const rates = pairs.map((p) => p.fundingRate);
  log('futures_funding_rates', { zero: rates.filter((r) => r === 0).length, min: Math.min(...rates), max: Math.max(...rates), ids: [...new Set(pairs.map((p) => p.id))] });
  for (const code of ['BTCUSDT', 'ETHUSDT', 'SHIB1000USDT', '1000PEPEUSDT', '$BTC_TOP', 'TSLA']) {
    log('futures_pair', { row: pairs.find((p) => p.currencyPairCode === code) });
  }

  // Spot catalog, for the coverage matrix only.
  const sp = await get(`${API}/api/currencies/pairs`);
  const quotes = {};
  for (const p of sp.json) {
    const q = p.code.split('_').pop();
    quotes[q] = (quotes[q] ?? 0) + 1;
  }
  log('spot_pairs', { status: sp.status, rows: sp.json.length, quotes, sample: sp.json[0] });
  const cm = await get(`${API}/api/currencies/commissions`);
  const tally = {};
  for (const c of cm.json) {
    if (c.commissionTypeCode === '3' || c.commissionTypeCode === '4') {
      const k = `type${c.commissionTypeCode} ${c.percent}%`;
      tally[k] = (tally[k] ?? 0) + 1;
    }
  }
  log('spot_commissions', { status: cm.status, bytes: cm.bytes, rows: cm.json.length, type3and4: tally, btc: cm.json.filter((c) => c.currencyCode === 'BTC').map((c) => [c.commissionTypeCode, c.percent, c.minimum]) });

  // CCXT has no Azbit class.
  log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, azbit: ccxt.exchanges.filter((x) => /azbit/i.test(x)) });

  // 5. REST book.
  for (const code of ['BTCUSDT', 'ETHUSDT', 'EURUSD', '$BTC_TOP', 'BTC_USDT', 'NOPEUSDT']) {
    const r = await get(`${API}/api/futures/trade/orderbook/${encodeURIComponent(code)}`);
    const b = r.json ?? {};
    const bids = (b.bids ?? []).map((l) => l.price);
    const asks = (b.asks ?? []).map((l) => l.price);
    log('futures_book', {
      code,
      status: r.status,
      ms: Math.round(r.ms),
      bytes: r.bytes,
      keys: Object.keys(b),
      bids: bids.length,
      asks: asks.length,
      bidsDescending: bids.every((p, i) => i === 0 || p < bids[i - 1]),
      asksAscending: asks.every((p, i) => i === 0 || p > asks[i - 1]),
      top: b.bids?.length ? [b.bids[0], b.asks[0]] : r.text.slice(0, 160),
      levelKeys: b.bids?.[0] ? Object.keys(b.bids[0]) : [],
    });
    await sleep(600);
  }
  const sb = await get(`${API}/api/orderbook?currencyPairCode=BTC_USDT`);
  log('spot_book', { status: sb.status, bytes: sb.bytes, rows: Array.isArray(sb.json) ? sb.json.length : typeof sb.json, sample: Array.isArray(sb.json) ? sb.json[0] : sb.text.slice(0, 200) });

  // 6. Errors.
  for (const url of [`${API}/api/futures/nope`, `${API}/api/futures/exchange-data/candles?CurrencyPair=NOPEUSDT&CandleTimePeriod=60`, `${API}/api/user/profile`, `${API}/api/orderbook?currencyPairCode=NOPE_USDT`, `${API}/api/futures/deals?CurrencyPair=BTCUSDT&PageSize=3`]) {
    const r = await get(url);
    log('error_shape', { url: url.replace(API, ''), status: r.status, ctype: r.headers.get('content-type'), retryAfter: r.headers.get('retry-after'), body: r.text.slice(0, 260) });
    await sleep(300);
  }

  // 7. Clock offset from the Date header, which has one second resolution.
  const offs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await fetch(`${API}/api/healthcheck`);
    const t1 = Date.now();
    await r.text();
    offs.push(Date.parse(r.headers.get('date')) - (t0 + t1) / 2);
    await sleep(1100);
  }
  log('clock_offset_ms', { samples: offs.map(Math.round), note: 'Date header, 1 s resolution' });

  // The Bybit comparison: catalog, funding and book at the same instant.
  const [bi, bt] = await Promise.all([
    get(`${BYBIT}/v5/market/instruments-info?category=linear&limit=1000`),
    get(`${BYBIT}/v5/market/tickers?category=linear`),
  ]);
  const byInst = new Map(bi.json.result.list.map((x) => [x.symbol, x]));
  const byTick = new Map(bt.json.result.list.map((x) => [x.symbol, x]));
  const azFresh = (await get(`${API}/api/futures/exchange-data/pairs`)).json;
  let inBybit = 0, rateEq = 0, rateCmp = 0, ivEq = 0, nextEq = 0, lotEq = 0;
  const missing = [], rateDiff = [];
  for (const p of azFresh) {
    const inst = byInst.get(p.currencyPairCode);
    const t = byTick.get(p.currencyPairCode);
    if (!inst) {
      missing.push(p.currencyPairCode);
      continue;
    }
    inBybit++;
    if (Number(inst.lotSizeFilter?.qtyStep) === p.lotSize) lotEq++;
    const hours = (utcMs(p.fundingRateFinishTimestamp) - utcMs(p.fundingRateStartTimestamp)) / 3.6e6;
    if (Number(inst.fundingInterval) / 60 === hours) ivEq++;
    if (t) {
      rateCmp++;
      if (Number(t.fundingRate) === p.fundingRate) rateEq++;
      else if (rateDiff.length < 6) rateDiff.push([p.currencyPairCode, p.fundingRate, t.fundingRate]);
      if (Number(t.nextFundingTime) === utcMs(p.fundingRateFinishTimestamp)) nextEq++;
    }
  }
  log('bybit_compare_catalog', { azbit: azFresh.length, bybitLinear: byInst.size, inBybit, missing, lotSizeEqualsQtyStep: lotEq, intervalEqual: ivEq, rateCompared: rateCmp, rateEqual: rateEq, nextFundingEqual: nextEq, rateDiff });
  // Where the rates differ, is the Azbit rate one of Bybit's last settled rates?
  for (const [code, azRate, byRate] of rateDiff) {
    const h = await get(`${BYBIT}/v5/market/funding/history?category=linear&symbol=${code}&limit=3`);
    const settled = h.json.result.list.map((x) => [new Date(Number(x.fundingRateTimestamp)).toISOString().slice(5, 16), x.fundingRate]);
    log('bybit_compare_rate', { code, azbit: azRate, bybitCurrent: byRate, bybitSettled: settled, azbitEqualsASettled: settled.some(([, r]) => Number(r) === azRate) });
    await sleep(250);
  }
  for (const code of ['BTCUSDT', 'ETHUSDT', 'AVAXUSDT', 'SHIB1000USDT']) {
    const [a, b] = await Promise.all([
      get(`${API}/api/futures/trade/orderbook/${code}`),
      get(`${BYBIT}/v5/market/orderbook?category=linear&symbol=${code}&limit=50`),
    ]);
    const az = { b: a.json.bids.map((l) => [l.price, l.quantity]), a: a.json.asks.map((l) => [l.price, l.quantity]) };
    const by = b.json.result;
    let same = 0;
    for (let i = 0; i < 20; i++) if (az.b[i] && by.b[i] && Number(by.b[i][0]) === az.b[i][0] && Number(by.b[i][1]) === az.b[i][1]) same++;
    log('bybit_compare_book', { code, azbitTop5: sig(az.b) + ' | ' + sig(az.a), bybitTop5: sig(by.b) + ' | ' + sig(by.a), sameBidLevelsOfTop20: same, azLevels: [az.b.length, az.a.length], byLevels: [by.b.length, by.a.length], azMs: Math.round(a.ms), byMs: Math.round(b.ms) });
    await sleep(600);
  }

  // CoinGecko listing context.
  const cg = await get('https://api.coingecko.com/api/v3/exchanges/azbit');
  if (cg.json) {
    const { name, country, year_established, trust_score, trust_score_rank, coins, pairs: cgPairs, trade_volume_24h_btc } = cg.json;
    log('coingecko', { status: cg.status, name, country, year_established, trust_score, trust_score_rank, coins, pairs: cgPairs, trade_volume_24h_btc });
  } else {
    log('coingecko', { status: cg.status, body: cg.text.slice(0, 160) });
  }
  const cgd = await get('https://api.coingecko.com/api/v3/derivatives/exchanges/list');
  log('coingecko_derivatives', { status: cgd.status, venues: Array.isArray(cgd.json) ? cgd.json.length : null, azbit: Array.isArray(cgd.json) ? cgd.json.filter((x) => /azbit/i.test(x.id + x.name)) : null });
}

async function poll() {
  // The funding fields over 60 one second polls.
  const ms = [];
  const bytes = [];
  const prev = new Map();
  let changes = 0;
  const changedCodes = new Set();
  const finishes = new Set();
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/api/futures/exchange-data/pairs`);
    ms.push(r.ms);
    bytes.push(r.bytes);
    if (r.status !== 200) log('poll_status', { i, status: r.status, retryAfter: r.headers.get('retry-after'), body: r.text.slice(0, 160) });
    for (const p of r.json ?? []) {
      finishes.add(p.fundingRateFinishTimestamp);
      const before = prev.get(p.currencyPairCode);
      if (before !== undefined && before !== p.fundingRate) {
        changes++;
        changedCodes.add(p.currencyPairCode);
      }
      prev.set(p.currencyPairCode, p.fundingRate);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  log('poll_pairs', { timing: stats(ms), bytes: stats(bytes), fundingRateChanges: changes, pairsWithAChange: changedCodes.size, sampleChanged: [...changedCodes].slice(0, 8), finishTimestamps: [...finishes] });

  // The REST book against Bybit's, twice a second for 20 s.
  let identical = 0, n = 0, azUnchanged = 0;
  let last;
  const azMs = [];
  for (let i = 0; i < 40; i++) {
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      get(`${API}/api/futures/trade/orderbook/BTCUSDT`),
      get(`${BYBIT}/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=50`),
    ]);
    azMs.push(a.ms);
    const s = sig(a.json.bids.map((l) => [l.price, l.quantity])) + '|' + sig(a.json.asks.map((l) => [l.price, l.quantity]));
    const t = sig(b.json.result.b) + '|' + sig(b.json.result.a);
    n++;
    if (s === t) identical++;
    if (s === last) azUnchanged++;
    last = s;
    await sleep(Math.max(0, 500 - (Date.now() - t0)));
  }
  log('poll_book_vs_bybit', { reads: n, top5Identical: identical, azbitUnchangedFromPreviousRead: azUnchanged, azbitMs: stats(azMs) });
}

const mode = process.argv[2] ?? 'main';
if (mode === 'main') await main();
else if (mode === 'poll') await poll();
else console.log('unknown mode', mode);
