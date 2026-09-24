// KuCoin Futures REST probe: host and latency, the CCXT catalog, the anchor bulk call polled at one hertz, the REST book, error shapes, index baskets and a funding settlement.
// Public, unauthenticated and read-only.
// Every loop keeps at least one second between two requests to the same endpoint, and the basket survey stays near 4 requests per second, far under the public pool of 2,000 per 30 s.
// Run from server/: node ../scripts/probes/venues/kucoin/rest-probe.mjs [main|baskets|settlement]
//   main        host, catalog through CCXT, anchor poll of 60 rounds, book, errors, basket sample and server time, about 3 minutes
//   baskets     index/query for the index of every open perpetual at about 4 per second, about 3 minutes
//   settlement  polls the contracts that settle next every 5 s from 90 s before the settlement to 120 s after it, with the funding history call
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/kucoin/rest.md and docs/profiles/kucoin/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api-futures.kucoin.com';
const OUT = process.env.PROBE_OUT_DIR;
const ANCHOR_ROUNDS = 60;
const TRACKED = ['XBTUSDTM', 'ETHUSDTM', 'XBTUSDCM', 'XBTUSDM', 'CHRUSDTM', 'AAPLUSDTM'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const tally = (rows, f) => { const c = {}; for (const r of rows) { const k = String(f(r)); c[k] = (c[k] ?? 0) + 1; } return c; };

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), typeof body === 'string' ? body : JSON.stringify(body, null, 1));
}

async function get(path, init = {}) {
  const t0 = performance.now();
  const res = await fetch(path.startsWith('https://') ? path : API + path, { headers: { accept: 'application/json' }, ...init });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  const h = (k) => res.headers.get(k);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return {
    status: res.status,
    ms: Math.round(ms),
    ttfbMs: Math.round(ttfb),
    bytes: Buffer.byteLength(text),
    encoding: h('content-encoding'),
    serverMs: h('x-in-time') && h('x-out-time') ? (Number(h('x-out-time').split('-')[1]) - Number(h('x-in-time').split('-')[1])) / 1000 : null, // microseconds after a dash
    limit: h('gw-ratelimit-limit'),
    remain: h('gw-ratelimit-remaining'),
    reset: h('gw-ratelimit-reset'),
    retryAfter: h('retry-after'),
    cache: h('cf-cache-status'),
    ray: h('cf-ray'),
    date: h('date'),
    text,
    json,
  };
}

const strip = (r) => { const { text, json, ...rest } = r; return rest; };

async function host() {
  for (const name of ['api-futures.kucoin.com', 'api.kucoin.com', 'ws-api-futures.kucoin.com', 'x-push-futures.kucoin.com']) {
    const out = { name };
    try { out.cname = await dns.resolveCname(name); } catch (e) { out.cname = e.code; }
    try { out.a = await dns.resolve4(name); } catch (e) { out.a = e.code; }
    log('dns', out);
  }
}

// The first request of the process pays DNS and TLS, and later paths reuse that connection.
async function latency() {
  const calls = [
    ['timestamp', '/api/v1/timestamp'],
    ['contracts_active', '/api/v1/contracts/active'],
    ['all_tickers', '/api/v1/allTickers'],
    ['depth20_btc', '/api/v1/level2/depth20?symbol=XBTUSDTM'],
  ];
  for (const [id, path] of calls) {
    const runs = [];
    for (let i = 0; i < 6; i++) {
      const r = await get(path);
      runs.push(strip(r));
      if (i === 0) save(`${id}.json`, r.text);
      await sleep(1100);
    }
    const warm = runs.slice(1).map((r) => r.ms).sort((a, b) => a - b);
    log('latency', { id, path, first: runs[0], warmMin: warm[0], warmMedian: warm[2], warmMax: warm[4], serverMs: runs.map((r) => r.serverMs), remain: runs.map((r) => r.remain), bytes: runs[0].bytes, encoding: runs[0].encoding, cache: runs[0].cache, ray: runs[0].ray });
  }
  const gz = await get('/api/v1/contracts/active', { headers: { accept: 'application/json', 'accept-encoding': 'gzip' } });
  log('latency_gzip_request', strip(gz));
}

async function catalog() {
  const raw = (await get('/api/v1/contracts/active')).json.data;
  log('raw_catalog', {
    rows: raw.length,
    bySettleInverseType: tally(raw, (x) => `${x.settleCurrency}|inverse=${x.isInverse}|${x.type}|${x.status}`),
    marketType: tally(raw, (x) => x.marketType),
    assetClass: tally(raw, (x) => x.assetClass),
    subMarketType: tally(raw, (x) => x.subMarketType),
    marketStage: tally(raw, (x) => x.marketStage),
    preMarket: raw.filter((x) => x.marketStage !== 'NORMAL').map((x) => x.symbol),
    granularityHours: tally(raw, (x) => x.fundingRateGranularity == null ? null : x.fundingRateGranularity / 3_600_000),
    currentGranularityHours: tally(raw, (x) => x.currentFundingRateGranularity == null ? null : x.currentFundingRateGranularity / 3_600_000),
    nextFunding: tally(raw, (x) => x.nextFundingRateDateTime == null ? null : new Date(x.nextFundingRateDateTime).toISOString()),
    hourly: raw.filter((x) => x.fundingRateGranularity === 3_600_000).map((x) => x.symbol),
    cap: tally(raw, (x) => x.fundingRateCap),
    capFloorSymmetric: raw.filter((x) => x.fundingRateCap != null).every((x) => x.fundingRateCap === -x.fundingRateFloor),
    feeRates: tally(raw, (x) => `${x.takerFeeRate}/${x.makerFeeRate}`),
    multiplier: tally(raw, (x) => x.multiplier),
    markMethod: tally(raw, (x) => x.markMethod),
    predictedNull: raw.filter((x) => x.predictedFundingFeeRate == null).length,
    markZero: raw.filter((x) => !x.markPrice).map((x) => x.symbol),
    inverse: raw.filter((x) => x.isInverse).map((x) => `${x.symbol} ${x.type} mult=${x.multiplier}`),
    dated: raw.filter((x) => x.nextFundingRateTime == null).map((x) => `${x.symbol} expires ${x.expireDate && new Date(x.expireDate).toISOString()}`),
    usdc: raw.filter((x) => x.settleCurrency === 'USDC').map((x) => x.symbol),
    sourceExchangesCount: tally(raw, (x) => (x.sourceExchanges ?? []).length),
  });
  const perps = raw.filter((x) => x.nextFundingRateTime != null);
  const capped = perps.filter((x) => x.fundingRateCap != null);
  log('raw_funding', {
    usdtBreakdown: tally(perps.filter((x) => x.settleCurrency === 'USDT'), (x) => `${x.marketType}/${x.assetClass}/${x.subMarketType}`),
    capEqualsImMinusMmTimes075: capped.filter((x) => Math.abs((x.initialMargin - x.maintainMargin) * 0.75 - x.fundingRateCap) < 1e-9).length,
    cappedRows: capped.length,
    dailyInterestRate: tally(perps, (x) => x.dailyInterestRate),
    maxRateOverCap: Math.max(...capped.map((x) => Math.abs(x.fundingFeeRate) / x.fundingRateCap)),
    atCap: capped.filter((x) => Math.abs(x.fundingFeeRate) >= x.fundingRateCap - 1e-12).map((x) => `${x.symbol} ${x.fundingFeeRate}`),
    rateEqualsLastSettled: perps.filter((x) => x.fundingFeeRate === x.lastTimeFundingRate).length,
    granularityDiffersFromCurrent: perps.filter((x) => x.fundingRateGranularity !== x.currentFundingRateGranularity).map((x) => `${x.symbol} ${x.fundingRateGranularity} ${x.currentFundingRateGranularity}`),
    fourHourCycleStartHourUtc: tally(perps.filter((x) => x.fundingRateGranularity === 14_400_000), (x) => x.effectiveFundingRateCycleStartTime == null ? null : new Date(x.effectiveFundingRateCycleStartTime).getUTCHours()),
    preMarket: perps.filter((x) => x.marketStage !== 'NORMAL').map((x) => `${x.symbol} rate ${x.fundingFeeRate} gran ${x.fundingRateGranularity} last ${x.lastTradePrice}`),
  });

  for (const cls of ['kucoinfutures', 'kucoin']) {
    const ex = new ccxt[cls]();
    const t0 = performance.now();
    const markets = await ex.loadMarkets();
    const ms = Math.round(performance.now() - t0);
    const all = Object.values(markets);
    const swaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
    const rawById = new Map(raw.map((x) => [x.symbol, x]));
    const pairs = tally(swaps, (m) => `${m.base}/${m.quote}`);
    const family = (q) => (q === 'USD' || q === 'USDC' ? 'USDT' : q);
    const familyPairs = tally(swaps, (m) => `${m.base}|${family(m.quote)}`);
    log('ccxt_catalog', {
      cls,
      version: ccxt.version,
      loadMs: ms,
      types: tally(all, (m) => m.type),
      activeSwaps: swaps.length,
      bySettle: tally(swaps, (m) => `${m.settle}|linear=${m.linear}`),
      takerPpm: tally(swaps, (m) => Math.round(m.taker * 1e6)),
      makerPpm: tally(swaps, (m) => Math.round(m.maker * 1e6)),
      idEqualsRawSymbol: swaps.filter((m) => rawById.has(m.id)).length,
      contractSizeVsMultiplier: swaps.filter((m) => m.contractSize === Math.abs(Number(rawById.get(m.id)?.multiplier))).length,
      contractSize: tally(swaps, (m) => m.contractSize),
      pairsListedTwiceInCcxt: Object.entries(pairs).filter(([, n]) => n > 1).map(([k]) => k),
      pairsListedTwiceUnderQuoteFamily: Object.entries(familyPairs).filter(([, n]) => n > 1).map(([k]) => k),
      baseRenames: swaps.filter((m) => m.base !== m.info.baseCurrency).map((m) => `${m.id}: ${m.info.baseCurrency} to ${m.base}`),
      nonAsciiIds: swaps.filter((m) => /[^\x20-\x7e]/.test(m.id)).map((m) => m.id),
      samples: TRACKED.map((id) => swaps.find((m) => m.id === id)).filter(Boolean).map((m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, pricePrecision: m.precision.price, amountPrecision: m.precision.amount, multiplier: m.info.multiplier })),
    });
  }
}

// One call carries index, mark, rate, interval and next settlement for every contract, so the loop reads it once a second beside the per symbol mark call for BTC.
async function anchor() {
  const history = Object.fromEntries(TRACKED.map((s) => [s, []]));
  const times = [];
  const markCall = [];
  const remains = [];
  for (let i = 0; i < ANCHOR_ROUNDS; i++) {
    const started = Date.now();
    const r = await get('/api/v1/contracts/active');
    times.push(r.ms);
    remains.push(Number(r.remain));
    const byId = new Map((r.json?.data ?? []).map((x) => [x.symbol, x]));
    for (const s of TRACKED) {
      const x = byId.get(s);
      if (x) history[s].push({ at: started, index: x.indexPrice, mark: x.markPrice, rate: x.fundingFeeRate, last: x.lastTradePrice, lastRate: x.lastTimeFundingRate, gran: x.fundingRateGranularity, next: x.nextFundingRateDateTime, nextIn: x.nextFundingRateTime });
    }
    const m = await get('/api/v1/mark-price/XBTUSDTM/current');
    markCall.push({ at: Date.now(), value: m.json?.data?.value, index: m.json?.data?.indexPrice, timePoint: m.json?.data?.timePoint, activeMark: byId.get('XBTUSDTM')?.markPrice, activeIndex: byId.get('XBTUSDTM')?.indexPrice, ms: m.ms });
    const wait = 1000 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  const sorted = [...times].sort((a, b) => a - b);
  log('anchor_times', { rounds: times.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], max: sorted.at(-1), over1s: times.filter((t) => t > 1000).length, over2s: times.filter((t) => t > 2000).length, remainMin: Math.min(...remains), remainMax: Math.max(...remains) });
  for (const s of TRACKED) {
    const h = history[s];
    const changes = (k) => h.slice(1).filter((x, i) => x[k] !== h[i][k]).length;
    let maxHold = 0; let lastChange = h[0]?.at;
    for (let i = 1; i < h.length; i++) if (h[i].index !== h[i - 1].index) { maxHold = Math.max(maxHold, h[i].at - lastChange); lastChange = h[i].at; }
    log('anchor_changes', { s, polls: h.length, index: changes('index'), mark: changes('mark'), rate: changes('rate'), last: changes('last'), gran: changes('gran'), next: changes('next'), longestIndexHoldMs: maxHold, markEqualsLast: h.filter((x) => x.mark === x.last).length, markEqualsIndex: h.filter((x) => x.mark === x.index).length, first: h[0], lastRow: h.at(-1) });
  }
  const agree = markCall.filter((x) => x.value === x.activeMark).length;
  const agreeIdx = markCall.filter((x) => x.index === x.activeIndex).length;
  const timeLag = markCall.map((x) => x.at - x.timePoint).sort((a, b) => a - b);
  log('anchor_mark_call_vs_active', { polls: markCall.length, markEqual: agree, indexEqual: agreeIdx, markCallMsMedian: [...markCall.map((x) => x.ms)].sort((a, b) => a - b)[30], timePointAgeMs: { min: timeLag[0], median: timeLag[Math.floor(timeLag.length / 2)], max: timeLag.at(-1) } });
  save('anchor_history.json', { history, markCall });
}

// Per symbol calls that carry anchor fields, read once so their shapes are on record.
async function anchorShapes() {
  for (const path of [
    '/api/v1/funding-rate/XBTUSDTM/current',
    '/api/v1/mark-price/XBTUSDTM/current',
    '/api/v1/premium/query?symbol=.XBTUSDTMPI&maxCount=3&reverse=true',
    '/api/v1/index/query?symbol=.KXBTUSDT&maxCount=1&reverse=true',
    '/api/v1/index/query?symbol=.KXBTUSDC&maxCount=1&reverse=true',
    '/api/v1/index/query?symbol=.BXBT&maxCount=1&reverse=true',
    '/api/v1/interest/query?symbol=.XBTINT8H&maxCount=1&reverse=true',
    '/api/v1/contract/funding-rates?symbol=XBTUSDTM&from=' + (Date.now() - 2 * 86_400_000) + '&to=' + Date.now(),
    '/api/v1/ticker?symbol=XBTUSDTM',
    '/api/v1/trade-statistics',
    '/api/v1/status',
  ]) {
    const r = await get(path);
    log('shape', { path, status: r.status, ms: r.ms, bytes: r.bytes, body: r.text.slice(0, 1200) });
    await sleep(600);
  }
  const t = await get('/api/v1/allTickers');
  const rows = t.json?.data ?? [];
  log('all_tickers', { status: t.status, rows: rows.length, keys: Object.keys(rows[0] ?? {}), sample: rows.find((x) => x.symbol === 'XBTUSDTM') });
  // The spot index basket of each index family.
  const active = (await get('/api/v1/contracts/active')).json.data;
  const indexOf = new Map(active.map((x) => [x.symbol, x.indexSymbol]));
  for (const s of TRACKED) {
    await sleep(600);
    const r = await get(`/api/v1/index/query?symbol=${encodeURIComponent(indexOf.get(s))}&maxCount=1&reverse=true`);
    const row = r.json?.data?.dataList?.[0];
    log('basket', { s, index: indexOf.get(s), status: r.status, members: row?.decomposionList?.map((d) => `${d.exchange} ${d.price} ${d.weight}`), value: row?.value, timePoint: row?.timePoint });
  }
}

async function book() {
  for (const path of [
    '/api/v1/level2/depth20?symbol=XBTUSDTM',
    '/api/v1/level2/depth100?symbol=XBTUSDTM',
    '/api/v1/level2/snapshot?symbol=XBTUSDTM',
    '/api/v1/level2/depth20?symbol=CHRUSDTM',
    '/api/v1/level2/snapshot?symbol=CHRUSDTM',
  ]) {
    const r = await get(path);
    const d = r.json?.data ?? {};
    const bids = d.bids ?? [];
    const asks = d.asks ?? [];
    const desc = bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0]);
    const asc = asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0]);
    log('rest_book', { path, status: r.status, ms: r.ms, bytes: r.bytes, keys: Object.keys(d), sequence: d.sequence, ts: d.ts, levels: { bids: bids.length, asks: asks.length }, bidsDesc: desc, asksAsc: asc, top: { bid: bids[0], ask: asks[0] }, types: { price: typeof bids[0]?.[0], size: typeof bids[0]?.[1] }, remain: r.remain, cache: r.cache });
    await sleep(1100);
  }
  // Two reads a moment apart show whether an edge cache holds the book.
  const a = await get('/api/v1/level2/depth20?symbol=XBTUSDTM');
  await sleep(150);
  const b = await get('/api/v1/level2/depth20?symbol=XBTUSDTM');
  log('rest_book_cache', { seqA: a.json?.data?.sequence, seqB: b.json?.data?.sequence, tsA: a.json?.data?.ts, tsB: b.json?.data?.ts, cacheA: a.cache, cacheB: b.cache });
}

async function errors() {
  for (const path of [
    '/api/v1/level2/depth20?symbol=NOPEUSDTM',
    '/api/v1/level2/snapshot?symbol=NOPEUSDTM',
    '/api/v1/ticker?symbol=NOPEUSDTM',
    '/api/v1/contracts/NOPEUSDTM',
    '/api/v1/mark-price/NOPEUSDTM/current',
    '/api/v1/funding-rate/NOPEUSDTM/current',
    '/api/v1/level2/depth50?symbol=XBTUSDTM',
    '/api/v1/index/query?symbol=.NOPE',
    '/api/v1/nope',
  ]) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, body: r.text.slice(0, 300), retryAfter: r.retryAfter });
    await sleep(700);
  }
}

async function serverTime() {
  for (let i = 0; i < 3; i++) {
    const sent = Date.now();
    const r = await get('/api/v1/timestamp');
    const recv = Date.now();
    const server = r.json?.data;
    log('server_time', { server, sent, recv, rttMs: recv - sent, offsetLowMs: sent - server, offsetHighMs: recv - server, body: r.text });
    await sleep(1100);
  }
}

// The index of every open perpetual, read once, to find single source baskets and baskets that hold a perpetual.
async function baskets() {
  const active = (await get('/api/v1/contracts/active')).json.data.filter((x) => x.nextFundingRateTime != null);
  const indices = [...new Set(active.map((x) => x.indexSymbol))];
  log('baskets_plan', { perpetuals: active.length, distinctIndices: indices.length });
  const out = [];
  for (const idx of indices) {
    const t0 = Date.now();
    const r = await get(`/api/v1/index/query?symbol=${encodeURIComponent(idx)}&maxCount=1&reverse=true`);
    const row = r.json?.data?.dataList?.[0];
    out.push({ idx, status: r.status, code: r.json?.code, members: (row?.decomposionList ?? []).map((d) => ({ exchange: d.exchange, name: d.exchangeName, weight: d.weight, price: d.price })), timePoint: row?.timePoint, remain: r.remain });
    const wait = 250 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  save('baskets.json', out);
  const members = out.map((b) => b.members);
  const names = tally(members.flat(), (m) => m.exchange);
  const contracts = new Map();
  for (const x of active) { const l = contracts.get(x.indexSymbol) ?? []; l.push(x.symbol); contracts.set(x.indexSymbol, l); }
  log('baskets_summary', {
    read: out.length,
    failed: out.filter((b) => b.members.length === 0).map((b) => `${b.idx} ${b.status} ${b.code}`),
    sourceCount: tally(out, (b) => b.members.length),
    memberNames: names,
    remainMin: Math.min(...out.map((b) => Number(b.remain))),
  });
  const futuresLike = (m) => /future|perp|swap|contract/i.test(m.exchange + ' ' + (m.name ?? ''));
  log('baskets_single_source', { list: out.filter((b) => b.members.length === 1).map((b) => `${b.idx} (${contracts.get(b.idx)?.join(',')}): ${b.members[0].exchange} ${b.members[0].weight}`) });
  log('baskets_with_futures_member', { list: out.filter((b) => b.members.some(futuresLike)).map((b) => `${b.idx}: ${b.members.map((m) => `${m.exchange} ${m.weight}`).join(', ')}`) });
  log('baskets_kucoin_heavy', { list: out.filter((b) => b.members.some((m) => /kucoin/i.test(m.exchange) && Number(m.weight) >= 0.5)).map((b) => `${b.idx}: ${b.members.map((m) => `${m.exchange} ${m.weight}`).join(', ')}`) });
  log('baskets_only_kucoin', { list: out.filter((b) => b.members.length > 0 && b.members.every((m) => /kucoin/i.test(m.exchange))).map((b) => `${b.idx}: ${b.members.map((m) => `${m.exchange} ${m.weight}`).join(', ')}`) });
}

// Reads the published rate on both sides of the next settlement of the hourly contracts, against the rate the history call records.
async function settlement() {
  const active = (await get('/api/v1/contracts/active')).json.data.filter((x) => x.nextFundingRateDateTime != null);
  const next = Math.min(...active.map((x) => x.nextFundingRateDateTime));
  const settling = active.filter((x) => x.nextFundingRateDateTime === next).map((x) => x.symbol);
  const watch = [...new Set([...settling, 'XBTUSDTM'])];
  const startAt = next - 90_000;
  log('settlement_plan', { next, iso: new Date(next).toISOString(), settling, watch, waitMs: Math.max(0, startAt - Date.now()) });
  if (startAt - Date.now() > 40 * 60_000) { log('settlement_skip', { reason: 'next settlement is more than 40 minutes away' }); return; }
  if (startAt > Date.now()) await sleep(startAt - Date.now());
  const rows = [];
  while (Date.now() < next + 120_000) {
    const t0 = Date.now();
    const r = await get('/api/v1/contracts/active');
    const byId = new Map((r.json?.data ?? []).map((x) => [x.symbol, x]));
    for (const s of watch) {
      const x = byId.get(s);
      rows.push({ at: t0, iso: new Date(t0).toISOString(), s, rate: x?.fundingFeeRate, lastRate: x?.lastTimeFundingRate, next: x?.nextFundingRateDateTime, nextIn: x?.nextFundingRateTime, gran: x?.fundingRateGranularity, mark: x?.markPrice, index: x?.indexPrice });
    }
    const f = await get(`/api/v1/funding-rate/${settling[0]}/current`);
    rows.push({ at: t0, iso: new Date(t0).toISOString(), s: `${settling[0]} current`, body: f.json?.data });
    const wait = 5000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  for (const s of watch) {
    const mine = rows.filter((r) => r.s === s);
    const before = mine.filter((r) => r.at < next).slice(-3);
    const after = mine.filter((r) => r.at >= next).slice(0, 4);
    const changes = mine.slice(1).filter((r, i) => r.rate !== mine[i].rate || r.lastRate !== mine[i].lastRate || r.next !== mine[i].next).map((r) => ({ iso: r.iso, rate: r.rate, lastRate: r.lastRate, next: r.next && new Date(r.next).toISOString() }));
    const h = await get(`/api/v1/contract/funding-rates?symbol=${s}&from=${next - 3 * 3_600_000}&to=${next + 60_000}`);
    log('settlement', { s, before, after, changes, history: h.json?.data?.slice(0, 3) });
    await sleep(600);
  }
  const cur = rows.filter((r) => r.s.endsWith(' current'));
  log('settlement_current_call', { changes: cur.slice(1).filter((r, i) => JSON.stringify(r.body) !== JSON.stringify(cur[i].body)).map((r) => ({ iso: r.iso, body: r.body })), first: cur[0], last: cur.at(-1) });
  save('settlement_rows.json', rows);
}

const mode = process.argv[2] ?? 'main';
if (mode === 'main') {
  await host();
  await latency();
  await catalog();
  await anchor();
  await anchorShapes();
  await book();
  await errors();
  await serverTime();
} else if (mode === 'baskets') {
  await baskets();
} else if (mode === 'settlement') {
  await settlement();
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
