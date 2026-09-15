// Bitget public REST probe: host latency, the CCXT catalog, the anchor bulk calls polled at 1 Hz, the REST book, error shapes, server time, and the index baskets.
// Public, unauthenticated, read-only. Every polling loop stays at one request per second per endpoint, far inside the published 20 per second per IP.
// Run from server/: node ../scripts/probes/bitget-rest-probe.mjs [sections] [--out DIR] [--polls N]
// Sections: host, catalog, anchor, book, fees, errors, time, baskets. Without a section list every section except baskets runs.
// baskets walks every USDT-FUTURES perp through /api/v3/market/index-components at 1 request per second, about 13 minutes, so it runs only when named.
// Recorded in docs/profiles/bitget/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.bitget.com';
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : path.join(os.tmpdir(), 'bitget-probe');
const pollsIdx = args.indexOf('--polls');
const POLLS = pollsIdx >= 0 ? Number(args[pollsIdx + 1]) : 60;
const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--polls');
const SECTIONS = named.length ? named : ['host', 'catalog', 'anchor', 'book', 'fees', 'errors', 'time'];
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (section, data) => console.log(JSON.stringify({ section, ...data }));
const save = (name, data) => fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));

// One timed GET. ttfbMs is headers received, totalMs is the whole body read.
async function get(pathAndQuery) {
  const url = API + pathAndQuery;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const ttfbMs = performance.now() - t0;
  const text = await res.text();
  const totalMs = performance.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const pick = ['server', 'cf-cache-status', 'cache-control', 'age', 'retry-after', 'x-mbx-used-remain-limit', 'content-encoding', 'cf-ray', 'x-cache', 'via'];
  const headers = {};
  for (const h of pick) if (res.headers.get(h) !== null) headers[h] = res.headers.get(h);
  return { url, status: res.status, ttfbMs: Math.round(ttfbMs), totalMs: Math.round(totalMs), bytes: Buffer.byteLength(text), headers, json, text };
}

const round = (x, d = 0) => Number(x.toFixed(d));

async function host() {
  for (const name of ['api.bitget.com', 'ws.bitget.com']) {
    const addrs = await dns.lookup(name, { all: true }).catch((e) => String(e));
    const cname = await dns.resolveCname(name).catch((e) => String(e.code));
    log('host', { name, addrs, cname });
  }
  const calls = [
    '/api/v2/public/time',
    '/api/v2/mix/market/contracts?productType=USDT-FUTURES',
    '/api/v2/mix/market/tickers?productType=USDT-FUTURES',
    '/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES',
    '/api/v3/market/tickers?category=USDT-FUTURES',
    '/api/v2/mix/market/merge-depth?productType=USDT-FUTURES&symbol=BTCUSDT&limit=50',
    '/api/v3/market/orderbook?category=USDT-FUTURES&symbol=BTCUSDT&limit=50',
  ];
  // The first request of the process pays DNS and TLS. Each later call rides the kept connection, and the five warm reads sit one second apart.
  for (const c of calls) {
    const first = await get(c);
    const warm = [];
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      const r = await get(c);
      warm.push(r.totalMs);
    }
    warm.sort((a, b) => a - b);
    log('host', { call: c, status: first.status, firstTtfbMs: first.ttfbMs, firstTotalMs: first.totalMs, bytes: first.bytes, headers: first.headers, warmMin: warm[0], warmMed: warm[2], warmMax: warm[4] });
  }
}

let ccxtSwaps = null;
async function loadCatalog() {
  if (ccxtSwaps) return ccxtSwaps;
  const ex = new ccxt.bitget();
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const ms = Date.now() - t0;
  const all = Object.values(markets);
  // The same filter as isActiveSwapMarket in server/src/ccxt/connector.ts.
  const swaps = all.filter((m) => m !== undefined && m.type === 'swap' && m.swap === true && m.active !== false);
  ccxtSwaps = { ms, all, swaps, version: ccxt.version };
  return ccxtSwaps;
}

function productTypeOf(m) {
  const demo = m.settle.startsWith('S') && ['SUSDT', 'SUSDC', 'SBTC', 'SETH', 'SXRP'].includes(m.settle);
  if (demo) return m.linear ? `S${m.settle.slice(1)}-FUTURES` : 'SCOIN-FUTURES';
  if (!m.linear) return 'COIN-FUTURES';
  return m.settle === 'USDC' ? 'USDC-FUTURES' : 'USDT-FUTURES';
}

async function catalog() {
  const { ms, all, swaps, version } = await loadCatalog();
  const bySettle = {};
  const taker = {};
  const contractSize = {};
  const byType = {};
  for (const m of swaps) {
    const k = `${m.settle} linear=${m.linear}`;
    bySettle[k] = (bySettle[k] ?? 0) + 1;
    taker[m.taker] = (taker[m.taker] ?? 0) + 1;
    contractSize[m.contractSize] = (contractSize[m.contractSize] ?? 0) + 1;
    byType[productTypeOf(m)] = (byType[productTypeOf(m)] ?? 0) + 1;
  }
  const pairs = {};
  for (const m of swaps) (pairs[`${m.base}/${m.quote}`] ??= []).push(m.id);
  const family = { USD: 'USDT', USDC: 'USDT' };
  const familyPairs = {};
  for (const m of swaps) (familyPairs[`${m.base}|${family[m.quote] ?? m.quote}`] ??= []).push(m.id);
  const twice = Object.entries(familyPairs).filter(([, v]) => v.length > 1);
  const rwa = swaps.filter((m) => m.info.isRwa === 'YES').length;
  const futures = all.filter((m) => m.type === 'future').map((m) => m.id);
  log('catalog', { ccxtVersion: version, loadMarketsMs: ms, markets: all.length, activeSwaps: swaps.length, bySettle, byProductType: byType, taker, contractSize, rwaSwaps: rwa, datedFutures: futures, pairsListedTwiceExact: Object.values(pairs).filter((v) => v.length > 1).length, pairsSharingOneQuoteFamily: twice.length, familyExamples: twice.slice(0, 6) });
  const detail = (m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, precision: m.precision, limitsAmountMin: m.limits.amount.min, info: { symbolStatus: m.info.symbolStatus, sizeMultiplier: m.info.sizeMultiplier, volumePlace: m.info.volumePlace, pricePlace: m.info.pricePlace, fundInterval: m.info.fundInterval, isRwa: m.info.isRwa, takerFeeRate: m.info.takerFeeRate } });
  const thin = await pickThin();
  for (const id of ['BTCUSDT', 'BTCPERP', 'BTCUSD', ...thin]) {
    const m = swaps.find((x) => x.id === id);
    if (m) log('catalog', { market: detail(m) });
  }
  const demo = swaps.filter((m) => productTypeOf(m).startsWith('S')).map((m) => `${m.id} ${m.symbol}`);
  log('catalog', { demoProductMarketsLoadedAsActiveSwaps: demo });
  save('catalog-swaps.json', swaps.map((m) => ({ id: m.id, symbol: m.symbol, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, isRwa: m.info.isRwa, fundInterval: m.info.fundInterval, status: m.info.symbolStatus })));
}

// Two thin crypto perps: the lowest 24 h USDT volume among non-RWA USDT-FUTURES perps that still show both a bid and an ask.
let thinPicked = null;
async function pickThin() {
  if (thinPicked) return thinPicked;
  const forced = process.env.BITGET_THIN;
  if (forced) return (thinPicked = forced.split(','));
  const [tick, contracts] = await Promise.all([
    get('/api/v2/mix/market/tickers?productType=USDT-FUTURES'),
    get('/api/v2/mix/market/contracts?productType=USDT-FUTURES'),
  ]);
  const rwa = new Set(contracts.json.data.filter((c) => c.isRwa === 'YES').map((c) => c.symbol));
  const rows = tick.json.data.filter((t) => !rwa.has(t.symbol) && Number(t.bidPr) > 0 && Number(t.askPr) > 0 && Number(t.usdtVolume) > 0);
  rows.sort((a, b) => Number(a.usdtVolume) - Number(b.usdtVolume));
  thinPicked = [rows[0].symbol, rows[1].symbol];
  log('catalog', { thinPicked, volumes: [rows[0].usdtVolume, rows[1].usdtVolume] });
  return thinPicked;
}

async function anchor() {
  const thin = await pickThin();
  const tracked = ['BTCUSDT', 'ETHUSDT', ...thin];
  const { swaps } = await loadCatalog();
  const ccxtIds = new Set(swaps.map((m) => m.id));

  // One read of every family and of the v3 twin, for keys, units and coverage.
  for (const pt of ['USDT-FUTURES', 'USDC-FUTURES', 'COIN-FUTURES']) {
    const [t, f, c] = await Promise.all([
      get(`/api/v2/mix/market/tickers?productType=${pt}`),
      get(`/api/v2/mix/market/current-fund-rate?productType=${pt}`),
      get(`/api/v2/mix/market/contracts?productType=${pt}`),
    ]);
    save(`tickers-${pt}.json`, t.text);
    save(`current-fund-rate-${pt}.json`, f.text);
    const tSyms = new Set(t.json.data.map((r) => r.symbol));
    const fSyms = new Set(f.json.data.map((r) => r.symbol));
    const perps = c.json.data.filter((r) => r.symbolType === 'perpetual');
    const intervalOf = new Map(perps.map((r) => [r.symbol, r.fundInterval]));
    const intervals = {};
    const intervalDisagree = [];
    const caps = {};
    let atCap = 0;
    for (const r of f.json.data) {
      intervals[r.fundingRateInterval] = (intervals[r.fundingRateInterval] ?? 0) + 1;
      caps[r.maxFundingRate] = (caps[r.maxFundingRate] ?? 0) + 1;
      if (intervalOf.has(r.symbol) && intervalOf.get(r.symbol) !== r.fundingRateInterval) intervalDisagree.push(`${r.symbol} contracts=${intervalOf.get(r.symbol)} fund=${r.fundingRateInterval}`);
      // A row without a cap is a listing that is not trading yet, and it must not count as capped.
      if (r.maxFundingRate !== null && (Number(r.fundingRate) >= Number(r.maxFundingRate) || Number(r.fundingRate) <= Number(r.minFundingRate))) atCap++;
    }
    const nextUpdates = {};
    for (const r of f.json.data) nextUpdates[new Date(Number(r.nextUpdate)).toISOString()] = (nextUpdates[new Date(Number(r.nextUpdate)).toISOString()] ?? 0) + 1;
    const markEqLast = t.json.data.filter((r) => r.markPrice === r.lastPr).length;
    const nullCap = f.json.data.filter((r) => r.maxFundingRate === null).map((r) => r.symbol);
    const emptyIndex = t.json.data.filter((r) => !(Number(r.indexPrice) > 0)).map((r) => r.symbol);
    const emptyMark = t.json.data.filter((r) => !(Number(r.markPrice) > 0)).map((r) => r.symbol);
    const premiums = t.json.data.filter((r) => Number(r.indexPrice) > 0 && Number(r.markPrice) > 0).map((r) => Math.abs(Number(r.markPrice) / Number(r.indexPrice) - 1)).sort((a, b) => a - b);
    const q = (p) => premiums.length ? round(premiums[Math.min(premiums.length - 1, Math.floor(p * premiums.length))] * 1e6) : null;
    log('anchor', {
      productType: pt,
      tickers: { status: t.status, rows: t.json.data.length, bytes: t.bytes, ms: t.totalMs },
      fundRate: { status: f.status, rows: f.json.data.length, bytes: f.bytes, ms: f.totalMs },
      contractsPerpetual: perps.length,
      tickerRowsNotInFundRate: [...tSyms].filter((s) => !fSyms.has(s)),
      fundRowsNotInTickers: [...fSyms].filter((s) => !tSyms.has(s)),
      tickerRowsNotCcxtIds: [...tSyms].filter((s) => !ccxtIds.has(s)),
      ccxtIdsMissingFromTickers: swaps.filter((m) => productTypeOf(m) === pt && !tSyms.has(m.id)).map((m) => m.id),
      fundingRateIntervalCounts: intervals,
      contractsVsFundRateIntervalDisagree: intervalDisagree,
      maxFundingRateCounts: caps,
      rowsAtCap: atCap,
      rowsWithoutCap: nullCap,
      nextUpdateCounts: nextUpdates,
      markEqualsLastPrice: markEqLast,
      emptyIndex,
      emptyMark,
      absMarkPremiumPpm: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: premiums.length ? round(premiums[premiums.length - 1] * 1e6) : null },
      sampleTicker: t.json.data.find((r) => r.symbol === (pt === 'USDT-FUTURES' ? 'BTCUSDT' : pt === 'USDC-FUTURES' ? 'BTCPERP' : 'BTCUSD')),
      sampleFund: f.json.data.find((r) => r.symbol === (pt === 'USDT-FUTURES' ? 'BTCUSDT' : pt === 'USDC-FUTURES' ? 'BTCPERP' : 'BTCUSD')),
    });
  }

  // funding-time answers one symbol, and it is the cross-check that nextUpdate is the settlement instant.
  const intervalSample = {};
  const fr = JSON.parse(fs.readFileSync(path.join(OUT, 'current-fund-rate-USDT-FUTURES.json'), 'utf8')).data;
  for (const iv of ['1', '2', '4', '8']) {
    const r = fr.find((x) => x.fundingRateInterval === iv);
    if (r) intervalSample[iv] = r.symbol;
  }
  for (const [iv, sym] of Object.entries(intervalSample)) {
    const ft = await get(`/api/v2/mix/market/funding-time?productType=USDT-FUTURES&symbol=${sym}`);
    const hist = await get(`/api/v2/mix/market/history-fund-rate?productType=USDT-FUTURES&symbol=${sym}&pageSize=3`);
    const cur = fr.find((x) => x.symbol === sym);
    log('anchor', { fundingTimeCheck: { symbol: sym, interval: iv, currentFundRate: cur, fundingTime: ft.json?.data, lastSettled: hist.json?.data } });
    await sleep(1100);
  }

  // v3 twin of the tickers call, read beside v2 in the same second.
  const [v2, v3] = await Promise.all([get('/api/v2/mix/market/tickers?productType=USDT-FUTURES'), get('/api/v3/market/tickers?category=USDT-FUTURES')]);
  const v3by = new Map(v3.json.data.map((r) => [r.symbol, r]));
  const cmp = tracked.map((s) => { const a = v2.json.data.find((r) => r.symbol === s); const b = v3by.get(s); return { s, v2: a && { index: a.indexPrice, mark: a.markPrice, fr: a.fundingRate, ts: a.ts }, v3: b && { index: b.indexPrice, mark: b.markPrice, fr: b.fundingRate, ts: b.ts } }; });
  log('anchor', { v2VsV3: cmp, v2Bytes: v2.bytes, v3Bytes: v3.bytes, v2Ms: v2.totalMs, v3Ms: v3.totalMs, v3Rows: v3.json.data.length });

  // POLLS rounds, one per second, tickers and current-fund-rate in parallel.
  const prev = {};
  const changes = {};
  for (const s of tracked) changes[s] = { index: 0, mark: 0, fundingRateTicker: 0, fundingRateFund: 0, ts: 0, nextUpdate: 0, samples: 0 };
  const rtt = { tickers: [], fund: [] };
  const bytes = { tickers: [], fund: [] };
  const series = [];
  let failures = 0;
  const start = Date.now();
  for (let i = 0; i < POLLS; i++) {
    const tick = start + i * 1000;
    const wait = tick - Date.now();
    if (wait > 0) await sleep(wait);
    let t, f;
    try {
      [t, f] = await Promise.all([get('/api/v2/mix/market/tickers?productType=USDT-FUTURES'), get('/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES')]);
    } catch (e) {
      failures++;
      continue;
    }
    if (t.status !== 200 || f.status !== 200) { failures++; log('anchor', { pollStatus: [t.status, f.status], body: t.text.slice(0, 200) }); continue; }
    rtt.tickers.push(t.totalMs); rtt.fund.push(f.totalMs); bytes.tickers.push(t.bytes); bytes.fund.push(f.bytes);
    const row = { i, at: Date.now() };
    for (const s of tracked) {
      const a = t.json.data.find((r) => r.symbol === s);
      const b = f.json.data.find((r) => r.symbol === s);
      if (!a || !b) continue;
      const cur = { index: a.indexPrice, mark: a.markPrice, frT: a.fundingRate, frF: b.fundingRate, ts: a.ts, nu: b.nextUpdate };
      row[s] = cur;
      const p = prev[s];
      changes[s].samples++;
      if (p) {
        if (p.index !== cur.index) changes[s].index++;
        if (p.mark !== cur.mark) changes[s].mark++;
        if (p.frT !== cur.frT) changes[s].fundingRateTicker++;
        if (p.frF !== cur.frF) changes[s].fundingRateFund++;
        if (p.ts !== cur.ts) changes[s].ts++;
        if (p.nu !== cur.nu) changes[s].nextUpdate++;
      }
      prev[s] = cur;
    }
    series.push(row);
  }
  save('anchor-poll-series.json', series);
  const stat = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] } : null; };
  log('anchor', { polls: POLLS, failures, changesAcrossConsecutivePolls: changes, rttMs: { tickers: stat(rtt.tickers), fund: stat(rtt.fund) }, bytes: { tickers: stat(bytes.tickers), fund: stat(bytes.fund) }, first: series[0], last: series[series.length - 1] });
}

async function book() {
  const thin = await pickThin();
  const { swaps } = await loadCatalog();
  for (const s of ['BTCUSDT', ...thin]) {
    const m = swaps.find((x) => x.id === s);
    const reads = [];
    for (let i = 0; i < 4; i++) {
      const [a, b] = await Promise.all([
        get(`/api/v2/mix/market/merge-depth?productType=USDT-FUTURES&symbol=${s}&limit=50`),
        get(`/api/v3/market/orderbook?category=USDT-FUTURES&symbol=${s}&limit=50`),
      ]);
      const da = a.json?.data ?? {};
      const db = b.json?.data ?? {};
      const asc = (xs) => xs.every((x, j) => j === 0 || Number(x[0]) > Number(xs[j - 1][0]));
      const desc = (xs) => xs.every((x, j) => j === 0 || Number(x[0]) < Number(xs[j - 1][0]));
      reads.push({
        v2: { status: a.status, ms: a.totalMs, bytes: a.bytes, headers: a.headers, bids: da.bids?.length, asks: da.asks?.length, bidsDescending: da.bids ? desc(da.bids) : null, asksAscending: da.asks ? asc(da.asks) : null, b0: da.bids?.[0], a0: da.asks?.[0], ts: da.ts, scale: da.scale, precision: da.precision, numberType: typeof da.bids?.[0]?.[0] },
        v3: { status: b.status, ms: b.totalMs, bytes: b.bytes, bids: db.b?.length, asks: db.a?.length, bidsDescending: db.b ? desc(db.b) : null, asksAscending: db.a ? asc(db.a) : null, b0: db.b?.[0], a0: db.a?.[0], ts: db.ts, numberType: typeof db.b?.[0]?.[0] },
      });
      await sleep(1000);
    }
    const max = await get(`/api/v2/mix/market/merge-depth?productType=USDT-FUTURES&symbol=${s}&limit=max`);
    log('book', { symbol: s, ccxtContractSize: m?.contractSize, sizeMultiplier: m?.info.sizeMultiplier, reads, limitMax: { status: max.status, bytes: max.bytes, bids: max.json?.data?.bids?.length, asks: max.json?.data?.asks?.length } });
  }
}

async function fees() {
  // The base maker and taker every contract row carries, per product type, including the demo types CCXT also loads.
  for (const pt of ['USDT-FUTURES', 'USDC-FUTURES', 'COIN-FUTURES', 'SUSDT-FUTURES', 'SUSDC-FUTURES', 'SCOIN-FUTURES']) {
    const c = await get(`/api/v2/mix/market/contracts?productType=${pt}`);
    const pairs = {};
    const rwa = {};
    const types = {};
    for (const r of c.json?.data ?? []) {
      pairs[`${r.makerFeeRate}/${r.takerFeeRate}`] = (pairs[`${r.makerFeeRate}/${r.takerFeeRate}`] ?? 0) + 1;
      if (r.isRwa === 'YES') rwa[r.takerFeeRate] = (rwa[r.takerFeeRate] ?? 0) + 1;
      types[r.symbolType] = (types[r.symbolType] ?? 0) + 1;
    }
    log('fees', { productType: pt, rows: c.json?.data?.length ?? 0, makerSlashTaker: pairs, rwaTaker: rwa, symbolType: types, ids: pt.startsWith('S') ? c.json?.data?.map((r) => r.symbol) : undefined });
    await sleep(1100);
  }
  const vip = await get('/api/v2/mix/market/vip-fee-rate');
  log('fees', { vipFeeRateMix: vip.json?.data });
  await sleep(1100);
  const group = await get('/api/v3/market/fee-group?category=FUTURES');
  log('fees', { feeGroupFutures: (group.json?.data ?? []).map((g) => ({ group: g.group, symbols: g.labelList?.flatMap((l) => l.symbols ?? []).length, tiers: g.tierList })) });
}

async function errors() {
  const calls = [
    '/api/v2/mix/market/merge-depth?productType=USDT-FUTURES&symbol=NOPEUSDT&limit=5',
    '/api/v2/mix/market/tickers?productType=NOPE-FUTURES',
    '/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES&symbol=NOPEUSDT',
    '/api/v2/mix/market/merge-depth?productType=USDT-FUTURES&symbol=BTCPERP&limit=5',
    '/api/v3/market/orderbook?category=USDT-FUTURES&symbol=NOPEUSDT&limit=5',
    '/api/v3/market/current-fund-rate',
  ];
  for (const c of calls) {
    const r = await get(c);
    log('errors', { call: c, status: r.status, headers: r.headers, body: r.text.slice(0, 300) });
    await sleep(1100);
  }
}

async function time() {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/api/v2/public/time');
    const t1 = Date.now();
    const server = Number(r.json.data.serverTime);
    samples.push({ offsetMs: server - (t0 + t1) / 2, rttMs: t1 - t0 });
    await sleep(1000);
  }
  log('time', { samples });
}

async function baskets() {
  const contracts = await get('/api/v2/mix/market/contracts?productType=USDT-FUTURES');
  const rwa = new Map(contracts.json.data.map((c) => [c.symbol, c.isRwa]));
  const symbols = contracts.json.data.filter((c) => c.symbolType === 'perpetual').map((c) => c.symbol);
  const extra = ['BTCPERP', 'ETHPERP', 'BTCUSD', 'ETHUSD'];
  const rows = [];
  const file = path.join(OUT, 'baskets.jsonl');
  fs.writeFileSync(file, '');
  const start = Date.now();
  const all = [...symbols, ...extra];
  for (let i = 0; i < all.length; i++) {
    const tick = start + i * 1000;
    const wait = tick - Date.now();
    if (wait > 0) await sleep(wait);
    const s = all[i];
    let r;
    try { r = await get(`/api/v3/market/index-components?symbol=${encodeURIComponent(s)}`); } catch (e) { rows.push({ s, error: String(e) }); continue; }
    const list = r.json?.data?.componentList ?? null;
    const row = { s, isRwa: rwa.get(s) ?? null, status: r.status, code: r.json?.code, components: list };
    rows.push(row);
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
    if (r.status === 429) { log('baskets', { rateLimited: s, headers: r.headers }); await sleep(60_000); }
  }
  const answered = rows.filter((r) => Array.isArray(r.components));
  const single = answered.filter((r) => r.components.length === 1).map((r) => `${r.s}:${r.components[0].exchange}`);
  const selfOnly = answered.filter((r) => r.components.every((c) => /BITGET_FUTURE/i.test(c.exchange))).map((r) => r.s);
  const selfAny = answered.map((r) => ({ s: r.s, w: r.components.filter((c) => /BITGET_FUTURE/i.test(c.exchange)).reduce((a, c) => a + Number(c.weight), 0) })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w);
  const exchanges = {};
  for (const r of answered) for (const c of r.components) exchanges[c.exchange] = (exchanges[c.exchange] ?? 0) + 1;
  const sizes = {};
  for (const r of answered) sizes[r.components.length] = (sizes[r.components.length] ?? 0) + 1;
  log('baskets', { asked: all.length, answered: answered.length, notAnswered: rows.filter((r) => !Array.isArray(r.components)).map((r) => `${r.s}:${r.code ?? r.error}`), componentCountDistribution: sizes, singleSource: single, bitgetFutureOnly: selfOnly, bitgetFutureWeighted: selfAny.slice(0, 40), bitgetFutureWeightedCount: selfAny.length, exchangeCounts: exchanges });
}

const table = { host, catalog, anchor, book, fees, errors, time, baskets };
log('run', { startedAt: new Date().toISOString(), sections: SECTIONS, out: OUT, node: process.version });
for (const s of SECTIONS) {
  try { await table[s](); } catch (e) { log(s, { error: String(e.stack ?? e) }); }
}
log('run', { finishedAt: new Date().toISOString() });
process.exit(0);
