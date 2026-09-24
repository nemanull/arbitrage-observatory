// HTX REST probe: catalog through CCXT, bulk anchor calls and their cadence, mark price kline, funding history, REST depth, limits and errors, server time.
// Public, unauthenticated, read-only. Every call is a GET well inside the published 800 per second market data and 240 per 3 s non-market limits.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/htx/rest-probe.mjs [catalog|anchor|funding|book|limits|time|marks]
//   catalog  CCXT 4.5.68 loadMarkets, swap counts by settle, id and contractSize checks, pairs listed twice, fee fields. About 10 s.
//   anchor   60 one-second rounds of swap_index, swap_batch_funding_rate and the bulk bbo, plus the mark price kline of five contracts. About 70 s.
//   funding  interval census from swap_contract_info, the V5 funding call with its cap and floor, funding history of three contracts. About 8 s.
//   book     REST depth levels, order and repeat reads. About 10 s.
//   limits   rate limit headers, unknown contract and bad parameter errors. About 5 s.
//   time     server time against the local clock, five reads. About 3 s.
//   marks    one round of mark price kline reads over every crypto perpetual, ten in flight. About 5 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/htx/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.hbdm.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const WATCH = ['BTC-USDT', 'ETH-USDT', 'STEEM-USDT', 'XAU-USDT', 'NVDA-USDT'];

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, ms, bytes: text.length, body, text, headers: res.headers };
}

const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function catalog() {
  const ex = new ccxt.htx();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  log('loadMarkets', { ms: Math.round(performance.now() - t0), total: Object.keys(markets).length });
  const all = Object.values(markets);
  const byKind = {};
  for (const m of all) {
    const k = `${m.type}|${m.linear ? 'linear' : m.inverse ? 'inverse' : 'spot'}|${m.settle ?? '-'}|active=${m.active}`;
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  log('byKind', byKind);
  const swaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  const takers = {};
  const makers = {};
  const sizes = {};
  for (const m of swaps) {
    takers[m.taker] = (takers[m.taker] ?? 0) + 1;
    makers[m.maker] = (makers[m.maker] ?? 0) + 1;
    sizes[m.contractSize] = (sizes[m.contractSize] ?? 0) + 1;
  }
  log('activeSwaps', { count: swaps.length, takers, makers, contractSizeKinds: Object.keys(sizes).length });
  log('contractSizeTop', Object.fromEntries(Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 12)));
  for (const id of ['BTC-USDT', 'ETH-USDT', 'DOGE-USDT', 'BTC-USD', 'ONE-USDT']) {
    const m = swaps.find((x) => x.id === id);
    if (m) log('market', { id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, active: m.active });
  }
  const pairCount = {};
  for (const m of swaps) {
    const q = ['USD', 'USDT', 'USDC'].includes(m.quote) ? 'USDfam' : m.quote;
    const k = `${m.base}/${q}`;
    pairCount[k] = (pairCount[k] ?? []).concat(m.id);
  }
  log('pairsListedTwice', Object.fromEntries(Object.entries(pairCount).filter(([, v]) => v.length > 1)));
  const inactive = all.filter((m) => m.type === 'swap' && m.active === false).map((m) => `${m.id}:${m.info.contract_status}`);
  log('inactiveSwaps', { inactive });

  const [info, idx, fund] = await Promise.all([
    get('/linear-swap-api/v1/swap_contract_info?business_type=swap'),
    get('/linear-swap-api/v1/swap_index'),
    get('/linear-swap-api/v1/swap_batch_funding_rate'),
  ]);
  const linearIds = new Set(swaps.filter((m) => m.linear).map((m) => m.id));
  const idxIds = new Set(idx.body.data.map((r) => r.contract_code));
  const fundIds = new Set(fund.body.data.map((r) => r.contract_code));
  const missIdx = [...linearIds].filter((id) => !idxIds.has(id));
  const missFund = [...linearIds].filter((id) => !fundIds.has(id));
  log('idMatch', { linearActive: linearIds.size, infoRows: info.body.data.length, idxRows: idx.body.data.length, fundRows: fund.body.data.length, missingInIndex: missIdx, missingInFunding: missFund });
  const idxNonSwap = idx.body.data.filter((r) => !/^[A-Z0-9]+-USDT$/.test(r.contract_code)).map((r) => r.contract_code);
  log('indexRowsNotSwap', { count: idxNonSwap.length, sample: idxNonSwap.slice(0, 12) });
  const sizeMismatch = info.body.data.filter((r) => {
    const m = swaps.find((x) => x.id === r.contract_code);
    return m && m.contractSize !== Number(r.contract_size);
  }).length;
  log('contractSizeVsInfo', { mismatches: sizeMismatch });
  capture('contract_info.json', info.text);
}

async function anchor() {
  const idxLast = new Map();
  const fundLast = new Map();
  const idxChanges = new Map();
  const fundChanges = new Map();
  const idxTsChanges = new Map();
  const idxMs = [];
  const fundMs = [];
  const markMs = [];
  const markLast = new Map();
  const markChanges = new Map();
  const premium = new Map();
  const markMid = new Map();
  const ROUNDS = 60;
  const btcIdxAge = [];
  let idxBytes = 0;
  let fundBytes = 0;
  let firstFund = null;
  let firstIdx = null;
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = Date.now();
    const [idx, fund, bbo, ...marks] = await Promise.all([
      get('/linear-swap-api/v1/swap_index'),
      get('/linear-swap-api/v1/swap_batch_funding_rate'),
      get('/linear-swap-ex/market/bbo?business_type=swap'),
      ...WATCH.map((c) => get(`/index/market/history/linear_swap_mark_price_kline?contract_code=${c}&period=1min&size=1`)),
    ]);
    idxMs.push(idx.ms);
    fundMs.push(fund.ms);
    idxBytes = idx.bytes;
    fundBytes = fund.bytes;
    if (i === 0) {
      firstIdx = idx.body;
      firstFund = fund.body;
    }
    for (const r of idx.body?.data ?? []) {
      const prev = idxLast.get(r.contract_code);
      if (prev && prev.index_price !== r.index_price) idxChanges.set(r.contract_code, (idxChanges.get(r.contract_code) ?? 0) + 1);
      if (prev && prev.index_ts !== r.index_ts) idxTsChanges.set(r.contract_code, (idxTsChanges.get(r.contract_code) ?? 0) + 1);
      if (r.contract_code === 'BTC-USDT') btcIdxAge.push(Date.now() - r.index_ts);
      idxLast.set(r.contract_code, r);
    }
    for (const r of fund.body?.data ?? []) {
      const prev = fundLast.get(r.contract_code);
      if (prev && prev.funding_rate !== r.funding_rate) fundChanges.set(r.contract_code, (fundChanges.get(r.contract_code) ?? 0) + 1);
      fundLast.set(r.contract_code, r);
    }
    marks.forEach((m, j) => {
      const c = WATCH[j];
      markMs.push(m.ms);
      const k = m.body?.data?.[0];
      if (!k) return;
      const prev = markLast.get(c);
      if (prev !== undefined && prev !== k.close) markChanges.set(c, (markChanges.get(c) ?? 0) + 1);
      markLast.set(c, k.close);
      const q = (bbo.body?.ticks ?? []).find((x) => x.contract_code === c);
      if (q?.bid?.[0] && q?.ask?.[0]) {
        const mid = (q.bid[0] + q.ask[0]) / 2;
        const d = Math.round(((Number(k.close) - mid) / mid) * 1e6);
        const cur = markMid.get(c) ?? { min: Infinity, max: -Infinity };
        markMid.set(c, { min: Math.min(cur.min, d), max: Math.max(cur.max, d) });
      }
      const ix = idxLast.get(c)?.index_price;
      if (ix) {
        const p = ((Number(k.close) - ix) / ix) * 1e6;
        const cur = premium.get(c) ?? { min: Infinity, max: -Infinity };
        premium.set(c, { min: Math.min(cur.min, Math.round(p)), max: Math.max(cur.max, Math.round(p)) });
      }
    });
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log('swap_index', { bytes: idxBytes, rows: firstIdx?.data?.length, ms: stats(idxMs) });
  log('swap_batch_funding_rate', { bytes: fundBytes, rows: firstFund?.data?.length, ms: stats(fundMs) });
  log('mark_kline', { ms: stats(markMs) });
  const w = (m) => Object.fromEntries(WATCH.map((c) => [c, m.get(c) ?? 0]));
  log('changesIn60', { index: w(idxChanges), indexTs: w(idxTsChanges), funding: w(fundChanges), mark: w(markChanges) });
  const allIdx = [...idxChanges.values()];
  log('indexChangeCensus', { contractsThatChanged: allIdx.length, of: idxLast.size, perContract: allIdx.length ? stats(allIdx) : null });
  log('markMinusIndexPpm', Object.fromEntries(premium));
  log('markMinusBboMidPpm', Object.fromEntries(markMid));
  const now = Date.now();
  const idxAge = [...idxLast.values()].map((r) => now - r.index_ts);
  log('indexTsAgeAtEnd', stats(idxAge));
  log('btcIndexAgeAtArrival', stats(btcIdxAge));
  const f = [...fundLast.values()];
  const nullRate = f.filter((r) => r.funding_rate === null).length;
  const estNull = f.filter((r) => r.estimated_rate === null).length;
  const nextNull = f.filter((r) => r.next_funding_time === null).length;
  const times = {};
  for (const r of f) times[r.funding_time] = (times[r.funding_time] ?? 0) + 1;
  log('fundingFields', { rows: f.length, nullRate, estimatedRateNull: estNull, nextFundingTimeNull: nextNull, fundingTimeValues: times });
  const rates = f.filter((r) => r.funding_rate !== null).map((r) => Number(r.funding_rate));
  log('fundingRateRange', stats(rates));
  for (const c of WATCH) log('sample', { c, index: idxLast.get(c), funding: fundLast.get(c), markClose: markLast.get(c) });
  capture('swap_index.json', JSON.stringify(firstIdx));
  capture('swap_batch_funding_rate.json', JSON.stringify(firstFund));
}

async function funding() {
  const info = await get('/linear-swap-api/v1/swap_contract_info?business_type=swap');
  const per = {};
  const next = {};
  for (const r of info.body.data) {
    per[r.settlement_period] = (per[r.settlement_period] ?? 0) + 1;
    next[`${r.settlement_period}h@${new Date(Number(r.settlement_date)).toISOString()}`] = (next[`${r.settlement_period}h@${new Date(Number(r.settlement_date)).toISOString()}`] ?? 0) + 1;
  }
  log('intervalCensus', { rows: info.body.data.length, byPeriodHours: per, bySettlementDate: next });
  const hourly = info.body.data.filter((r) => r.settlement_period === '1').map((r) => r.contract_code);
  const four = info.body.data.filter((r) => r.settlement_period === '4').map((r) => r.contract_code);
  log('shortIntervals', { hourly, fourHourSample: four.slice(0, 8) });
  const fund = await get('/linear-swap-api/v1/swap_batch_funding_rate');
  const fmap = new Map(fund.body.data.map((r) => [r.contract_code, r]));
  const infoMap = new Map(info.body.data.map((r) => [r.contract_code, r]));
  let agree = 0;
  let disagree = [];
  for (const [c, r] of fmap) {
    const i = infoMap.get(c);
    if (!i) continue;
    if (i.settlement_date === r.funding_time) agree++;
    else disagree.push(`${c}:${i.settlement_date}/${r.funding_time}`);
  }
  log('settlementDateVsFundingTime', { agree, disagree: disagree.slice(0, 10), disagreeCount: disagree.length });
  // The V5 market funding call takes up to about ten codes and carries next_funding_time and the cap and floor, which the V1 bulk call leaves out.
  for (const codes of ['BTC-USDT,ETH-USDT,DOGE-USDT,XAU-USDT,NVDA-USDT', 'LSK-USDT,STEEM-USDT'].concat(hourly.length ? [hourly.slice(0, 5).join(',')] : [])) {
    const v5 = await get(`/v5/market/funding_rate?contract_code=${encodeURIComponent(codes)}`);
    for (const r of v5.body?.data ?? []) log('v5funding', { c: r.contract_code, rate: r.funding_rate, funding_time: r.funding_time, next_funding_time: r.next_funding_time, min: r.min_funding_rate, max: r.max_funding_rate });
    if (!v5.body?.data) log('v5funding', { codes, status: v5.status, body: v5.text.slice(0, 200) });
    await sleep(200);
  }
  const many = await get(`/v5/market/funding_rate?contract_code=${info.body.data.filter((r) => /^[A-Z0-9-]+$/.test(r.contract_code)).slice(0, 20).map((r) => r.contract_code).join(',')}`);
  log('v5fundingTwentyCodes', { status: many.status, body: many.text.slice(0, 160) });
  for (const c of ['BTC-USDT', hourly[0], four[0]].filter(Boolean)) {
    const h = await get(`/linear-swap-api/v1/swap_historical_funding_rate?contract_code=${c}&page_size=4`);
    const rows = (h.body?.data?.data ?? []).map((r) => ({ funding_time: new Date(Number(r.funding_time)).toISOString(), funding_rate: r.funding_rate, realized_rate: r.realized_rate, avg_premium_index: r.avg_premium_index }));
    log('history', { c, status: h.status, keys: Object.keys(h.body?.data?.data?.[0] ?? {}), rows, live: fmap.get(c)?.funding_rate });
    await sleep(200);
  }
}

async function book() {
  for (const [c, type] of [['BTC-USDT', 'step0'], ['BTC-USDT', 'step6'], ['CYBER-USDT', 'step0'], ['STEEM-USDT', 'step0']]) {
    const r = await get(`/linear-swap-ex/market/depth?contract_code=${c}&type=${type}`);
    const t = r.body?.tick ?? {};
    const bids = t.bids ?? [];
    const asks = t.asks ?? [];
    const bidDesc = bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0]);
    const askAsc = asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0]);
    log('depth', { c, type, status: r.status, err: r.body?.['err-msg'], ms: r.ms, bytes: r.bytes, bids: bids.length, asks: asks.length, bidDesc, askAsc, top: [bids[0], asks[0]], version: t.version, tickTs: t.ts, age: Date.now() - t.ts, cacheHeader: r.headers.get('cache-control'), age_h: r.headers.get('age') });
    await sleep(150);
  }
  const versions = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/linear-swap-ex/market/depth?contract_code=BTC-USDT&type=step6');
    versions.push({ v: r.body?.tick?.version, ts: r.body?.tick?.ts, ms: r.ms });
    await sleep(50);
  }
  log('repeatReads', { versions });
  const bbo = await get('/linear-swap-ex/market/bbo?contract_code=BTC-USDT');
  log('bbo', { status: bbo.status, body: bbo.text.slice(0, 300) });
}

async function limits() {
  const r = await get('/linear-swap-api/v1/swap_index?contract_code=BTC-USDT');
  const h = {};
  for (const [k, v] of r.headers) if (/rate|limit|retry|cache|age|server|x-/.test(k)) h[k] = v;
  log('headersIndex', { status: r.status, h });
  const d = await get('/linear-swap-ex/market/depth?contract_code=BTC-USDT&type=step6');
  const h2 = {};
  for (const [k, v] of d.headers) if (/rate|limit|retry|cache|age|server|x-/.test(k)) h2[k] = v;
  log('headersDepth', { status: d.status, h: h2 });
  for (const p of ['/index/market/history/linear_swap_mark_price_kline?contract_code=BTC-USDT&period=1min&size=1', '/linear-swap-api/v1/swap_batch_funding_rate', '/linear-swap-api/v1/swap_contract_info?business_type=swap']) {
    const x = await get(p);
    const hx = {};
    for (const [k, v] of x.headers) if (/rate|limit|retry/.test(k)) hx[k] = v;
    log('headers', { p, status: x.status, ms: x.ms, bytes: x.bytes, h: hx });
    await sleep(150);
  }
  for (const p of [
    '/linear-swap-ex/market/depth?contract_code=NOPE-USDT&type=step0',
    '/linear-swap-ex/market/depth?contract_code=BTC-USDT&type=step99',
    '/linear-swap-api/v1/swap_index?contract_code=NOPE-USDT',
    '/linear-swap-api/v1/swap_batch_funding_rate?contract_code=NOPE-USDT',
    '/index/market/history/linear_swap_mark_price_kline?contract_code=NOPE-USDT&period=1min&size=1',
    '/linear-swap-api/v1/nope',
  ]) {
    const e = await get(p);
    log('error', { p, status: e.status, body: e.text.slice(0, 240) });
    await sleep(150);
  }
}

async function time() {
  const offs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/api/v1/timestamp');
    const t1 = Date.now();
    const server = r.body?.ts;
    offs.push({ rtt: t1 - t0, offset: server - Math.round((t0 + t1) / 2) });
    await sleep(200);
  }
  log('time', { offs });
  const hb = await get('/heartbeat/');
  log('heartbeat', { status: hb.status, body: hb.text.slice(0, 300) });
}

// No bulk mark call exists, so this times one round of per-contract mark reads over the 130 crypto perpetuals at ten in flight, about 13 requests per 100 ms.
async function marks() {
  const info = await get('/linear-swap-api/v1/swap_contract_info?business_type=swap');
  const codes = info.body.data.filter((r) => r.contract_status === 1 && r.tradfi_labels.length === 0).map((r) => r.contract_code);
  const ms = [];
  const bad = [];
  let i = 0;
  const t0 = performance.now();
  const worker = async () => {
    while (i < codes.length) {
      const c = codes[i++];
      const r = await get(`/index/market/history/linear_swap_mark_price_kline?contract_code=${encodeURIComponent(c)}&period=1min&size=1`);
      ms.push(r.ms);
      if (r.status !== 200 || r.body?.status !== 'ok' || !r.body?.data?.[0]) bad.push(`${c}:${r.status}:${r.text.slice(0, 80)}`);
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  log('markRound', { contracts: codes.length, roundMs: Math.round(performance.now() - t0), perCall: stats(ms), bad });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, funding, book, limits, time, marks };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
