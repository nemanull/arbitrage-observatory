// Toobit REST probe: host and latency, the CCXT catalog against the raw catalog, the three anchor bulk calls polled at one hertz, the REST book, error shapes, clock offset, index baskets and a funding settlement.
// Public, unauthenticated, read-only. No loop sends more than two requests per second to one endpoint, far inside the published 3,000 weight per minute.
// Run from server/: node ../scripts/probes/venues/toobit/rest-probe.mjs [main|baskets|settlement|mirror]
//   main        host, catalog, 60 anchor rounds, book, errors, time. About 2 minutes.
//   baskets     indexPriceComponents for every index an active perpetual uses, two requests per second. About 8 minutes.
//   settlement  polls the contracts that settle next and their funding history every 5 s from 90 s before that settlement to 120 s after it.
//   mirror      reads four Toobit books and the same Binance USD-M books at the same moment, five rounds, and compares prices and sizes level by level. About 1 minute.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/toobit/rest.md and docs/profiles/toobit/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.toobit.com';
const OUT = process.env.PROBE_OUT_DIR;
const ANCHOR_ROUNDS = 60;
const TRACKED = ['BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'DOGE-SWAP-USDT', 'LSK-SWAP-USDT', 'AAPL-SWAP-USDT'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const iso = (ms) => new Date(Number(ms)).toISOString();

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), typeof body === 'string' ? body : JSON.stringify(body, null, 1));
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(path.startsWith('https://') ? path : API + path, { headers: { accept: 'application/json' } });
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
    cfCache: h('cf-cache-status'),
    cacheControl: h('cache-control'),
    age: h('age'),
    limitStatus: h('x-api-limit-status'),
    limit: h('x-api-limit'),
    limitReset: h('x-api-limit-reset-timestamp'),
    retryAfter: h('retry-after'),
    cfRay: h('cf-ray'),
    date: h('date'),
    text,
    json,
  };
}

const strip = (r) => { const { text, json, ...rest } = r; return rest; };
const count = (arr, key) => { const o = {}; for (const x of arr) { const k = String(key(x)); o[k] = (o[k] ?? 0) + 1; } return o; };

async function host() {
  for (const name of ['api.toobit.com', 'stream.toobit.com', 'www.toobit.com', 'api-docs.toobit.com', 'support.toobit.com']) {
    const out = { name };
    try { out.cname = await dns.resolveCname(name); } catch (e) { out.cname = e.code; }
    try { out.a = await dns.resolve4(name); } catch (e) { out.a = e.code; }
    log('dns', out);
  }
  // Cloudflare names the edge that answered in cf-ray, which says where the request entered and nothing about the origin.
  const paths = ['/api/v1/time', '/api/v1/exchangeInfo', '/quote/v1/index', '/quote/v1/markPrice', '/api/v1/futures/fundingRate', '/quote/v1/depth?symbol=BTC-SWAP-USDT&limit=20'];
  for (const p of paths) {
    const first = await get(p);
    const warm = [];
    for (let i = 0; i < 5; i++) { await sleep(1100); warm.push((await get(p)).ms); }
    warm.sort((a, b) => a - b);
    log('latency', { path: p, first: strip(first), warmMin: warm[0], warmMedian: warm[2], warmMax: warm[4] });
  }
}

async function catalog() {
  const raw = await get('/api/v1/exchangeInfo');
  save('exchangeInfo.json', raw.text);
  const ei = raw.json;
  const contracts = ei.contracts;
  log('raw_catalog', {
    reply: strip(raw),
    keys: Object.keys(ei),
    spot: ei.symbols.length,
    contracts: contracts.length,
    options: ei.options.length,
    status: count(contracts, (c) => c.status),
    marginToken: count(contracts, (c) => c.marginToken),
    inverse: count(contracts, (c) => c.inverse),
    rateLimits: ei.rateLimits,
    rwaType: count(contracts, (c) => c.rwaType),
    isRwa: count(contracts, (c) => c.isRwa),
    closingWindowSet: contracts.filter((c) => c.closingStartTime !== '0' || c.closingEndTime !== '0').map((c) => `${c.symbol} ${c.closingStartTime} ${c.closingEndTime}`).slice(0, 10),
    allowedOpenTime: count(contracts, (c) => c.allowedOpenTime ?? 'absent'),
    idShape: count(contracts, (c) => /^[A-Z0-9]+-SWAP-(USDT|USDC)$/.test(c.symbol)),
    symbolNameDiffers: contracts.filter((c) => c.symbolName !== c.symbol).length,
    multipliers: count(contracts, (c) => c.contractMultiplier),
  });
  const sample = contracts.find((c) => c.symbol === 'BTC-SWAP-USDT');
  log('raw_contract_sample', { ...sample, riskLimits: sample.riskLimits.slice(0, 2) });

  const t0 = performance.now();
  const ex = new ccxt.toobit();
  const markets = await ex.loadMarkets();
  const loadMs = Math.round(performance.now() - t0);
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  const byId = new Map(contracts.map((c) => [c.symbol, c]));
  log('ccxt_catalog', {
    version: ccxt.version,
    loadMs,
    total: all.length,
    byType: count(all, (m) => `${m.type}${m.active === false ? ' inactive' : ''}`),
    activeSwaps: swaps.length,
    bySettle: count(swaps, (m) => `${m.settle} linear=${m.linear}`),
    taker: count(swaps, (m) => m.taker),
    maker: count(swaps, (m) => m.maker),
    contractSize: count(swaps, (m) => m.contractSize),
    contractSizeEqualsMultiplier: swaps.filter((m) => Number(byId.get(m.id)?.contractMultiplier) === m.contractSize).length,
    idEqualsRawSymbol: swaps.filter((m) => byId.has(m.id)).length,
  });
  for (const id of ['BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'BTC-SWAP-USDC', 'DOGE-SWAP-USDT', '1000PEPE-SWAP-USDT', 'AAPL-SWAP-USDT']) {
    const m = swaps.find((x) => x.id === id);
    if (m) log('ccxt_market', { id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, pricePrecision: m.precision.price, amountPrecision: m.precision.amount, multiplier: byId.get(id).contractMultiplier, stepSize: byId.get(id).filters.find((f) => f.filterType === 'LOT_SIZE').stepSize });
  }
  const family = { USD: 'USDT', USDC: 'USDT' };
  const pairs = {};
  for (const m of swaps) (pairs[`${m.base}|${family[m.quote] ?? m.quote}`] ??= []).push(m.id);
  log('pairs_listed_twice', { pairs: Object.entries(pairs).filter(([, v]) => v.length > 1) });
  // A base that differs from its own index token names a token the other venues may spell without the suffix, or a different token under a reused ticker.
  log('base_vs_index_token', { rows: swaps.filter((m) => `${m.base}${m.quote}` !== byId.get(m.id).indexToken).map((m) => `${m.id} base=${m.base} indexToken=${byId.get(m.id).indexToken}`) });
  return { contracts, swaps };
}

// One round reads all three bulk calls, which together carry every AnchorRow column.
async function anchor(contracts) {
  const active = new Set(contracts.map((c) => c.symbol));
  const indexOf = new Map(contracts.map((c) => [c.symbol, c.indexToken]));
  const first = { index: await get('/quote/v1/index'), mark: await get('/quote/v1/markPrice'), funding: await get('/api/v1/futures/fundingRate'), last: await get('/quote/v1/contract/ticker/price') };
  save('index.json', first.index.text); save('markPrice.json', first.mark.text); save('fundingRate.json', first.funding.text);
  const idx = first.index.json;
  const mk = first.mark.json;
  const fr = first.funding.json;
  log('anchor_shapes', {
    index: { reply: strip(first.index), keys: Object.keys(idx), indexKeys: Object.keys(idx.index).length, edpKeys: Object.keys(idx.edp).length, sample: { BTCUSDT: idx.index.BTCUSDT, edp: idx.edp.BTCUSDT } },
    mark: { reply: strip(first.mark), rows: mk.length, sample: mk.find((x) => x.symbolId === 'BTC-SWAP-USDT'), zero: mk.filter((x) => Number(x.price) === 0).length, times: count(mk, (x) => x.time), notInCatalog: mk.filter((x) => !active.has(x.symbolId)).length, notInCatalogSample: mk.filter((x) => !active.has(x.symbolId)).map((x) => x.symbolId).slice(0, 12) },
    funding: { reply: strip(first.funding), rows: fr.length, sample: fr.find((x) => x.symbol === 'BTC-SWAP-USDT'), notInCatalog: fr.filter((x) => !active.has(x.symbol)).length, period: count(fr.filter((x) => active.has(x.symbol)), (x) => x.period), next: count(fr.filter((x) => active.has(x.symbol)), (x) => iso(x.nextFundingTime)), interest: count(fr.filter((x) => active.has(x.symbol)), (x) => x.interest), capEqualsMinusFloor: fr.filter((x) => Number(x.fundingRateCap) === -Number(x.fundingRateFloor)).length, capTop: Object.entries(count(fr.filter((x) => active.has(x.symbol)), (x) => x.fundingRateCap)).sort((p, q) => q[1] - p[1]).slice(0, 10), interestByRwa: count(fr.filter((x) => active.has(x.symbol)), (x) => `${x.interest} rwa=${contracts.find((c) => c.symbol === x.symbol)?.isRwa}`), periodByRwa: count(fr.filter((x) => active.has(x.symbol)), (x) => `${x.period} rwa=${contracts.find((c) => c.symbol === x.symbol)?.isRwa}`), rateEqualsInterest: fr.filter((x) => active.has(x.symbol) && Number(x.rate) === Number(x.interest)).length, atCap: fr.filter((x) => active.has(x.symbol) && Math.abs(Number(x.rate)) >= Number(x.fundingRateCap) - 1e-12).map((x) => `${x.symbol} ${x.rate} ${x.fundingRateCap}`) },
    catalogCoverage: { mark: contracts.filter((c) => mk.some((x) => x.symbolId === c.symbol)).length, funding: contracts.filter((c) => fr.some((x) => x.symbol === c.symbol)).length, index: contracts.filter((c) => c.indexToken in idx.index).length, of: contracts.length },
    indexTokenShared: Object.entries(count(contracts, (c) => c.indexToken)).filter(([, n]) => n > 1).map(([k, n]) => `${k} ${n}`),
    indexTokenNotSymbolMinusSwap: contracts.filter((c) => c.indexToken !== c.symbol.replace(/-SWAP-/, '')).map((c) => `${c.symbol} ${c.indexToken}`).slice(0, 20),
    markEqualsLast: (() => { const last = new Map(first.last.json.map((x) => [x.s, x.p])); return mk.filter((x) => active.has(x.symbolId) && last.get(x.symbolId) === x.price).length; })(),
  });

  const hist = Object.fromEntries(TRACKED.map((s) => [s, []]));
  const times = { index: [], mark: [], funding: [] };
  const skew = [];
  for (let i = 0; i < ANCHOR_ROUNDS; i++) {
    const start = performance.now();
    const [ri, rm, rf, rl] = await Promise.all([get('/quote/v1/index'), get('/quote/v1/markPrice'), get('/api/v1/futures/fundingRate'), get('/quote/v1/contract/ticker/price')]);
    const recv = Date.now();
    times.index.push(ri.ms); times.mark.push(rm.ms); times.funding.push(rf.ms);
    if (ri.status !== 200 || rm.status !== 200 || rf.status !== 200) log('anchor_error', { round: i, index: strip(ri), mark: strip(rm), funding: strip(rf) });
    const mkMap = new Map((rm.json ?? []).map((x) => [x.symbolId, x]));
    const frMap = new Map((rf.json ?? []).map((x) => [x.symbol, x]));
    const lastMap = new Map((rl.json ?? []).map((x) => [x.s, x.p]));
    const markTime = (rm.json ?? [])[0]?.time;
    skew.push(recv - Number(markTime));
    for (const s of TRACKED) {
      const m = mkMap.get(s);
      const f = frMap.get(s);
      hist[s].push({ index: ri.json?.index?.[indexOf.get(s)], edp: ri.json?.edp?.[indexOf.get(s)], mark: m?.price, markTime: m?.time, rate: f?.rate, next: f?.nextFundingTime, period: f?.period, last: lastMap.get(s) });
    }
    const wait = 1000 - (performance.now() - start);
    if (wait > 0) await sleep(wait);
  }
  const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1], over1s: s.filter((x) => x > 1000).length }; };
  log('anchor_times', { rounds: ANCHOR_ROUNDS, index: stats(times.index), mark: stats(times.mark), funding: stats(times.funding), markAgeAtArrivalMs: stats(skew) });
  for (const s of TRACKED) {
    const h = hist[s];
    const changes = (k) => h.filter((x, i) => i > 0 && x[k] !== h[i - 1][k]).length;
    let longestIndexHold = 0; let run = 0;
    for (let i = 1; i < h.length; i++) { run = h[i].index === h[i - 1].index ? run + 1 : 0; longestIndexHold = Math.max(longestIndexHold, run); }
    log('anchor_changes', { symbol: s, rounds: h.length, index: changes('index'), edp: changes('edp'), mark: changes('mark'), rate: changes('rate'), last: changes('last'), next: changes('next'), markEqualsLast: h.filter((x) => x.mark === x.last).length, markEqualsIndex: h.filter((x) => x.mark === x.index).length, longestIndexHoldS: longestIndexHold, first: h[0], lastRow: h[h.length - 1] });
  }
}

async function book() {
  for (const limit of [5, 20, 100, 200, 500, 1000, 0]) {
    const r = await get(`/quote/v1/depth?symbol=BTC-SWAP-USDT&limit=${limit}`);
    const j = r.json ?? {};
    const desc = (l) => l.every((x, i) => i === 0 || Number(x[0]) < Number(l[i - 1][0]));
    const asc = (l) => l.every((x, i) => i === 0 || Number(x[0]) > Number(l[i - 1][0]));
    log('rest_book', { limit, reply: strip(r), bids: j.b?.length, asks: j.a?.length, bidsDesc: j.b ? desc(j.b) : null, asksAsc: j.a ? asc(j.a) : null, t: j.t, ageMs: j.t ? Date.now() - j.t : null, top: j.b ? { b: j.b[0], a: j.a[0] } : r.text.slice(0, 200) });
    await sleep(1100);
  }
  const a = await get('/quote/v1/depth?symbol=BTC-SWAP-USDT&limit=20');
  await sleep(150);
  const b = await get('/quote/v1/depth?symbol=BTC-SWAP-USDT&limit=20');
  // Size ratio between the two reads at every price both carry, to see whether a whole ladder is rescaled at once.
  const ratios = [];
  for (const side of ['b', 'a']) {
    const second = new Map((b.json?.[side] ?? []).map(([p, q]) => [p, Number(q)]));
    for (const [p, q] of a.json?.[side] ?? []) if (second.has(p) && Number(q) > 0) ratios.push(second.get(p) / Number(q));
  }
  ratios.sort((x, y) => x - y);
  const med = ratios[Math.floor(ratios.length / 2)];
  log('rest_book_cache', { firstT: a.json?.t, secondT: b.json?.t, sameBody: a.text === b.text, cf: [a.cfCache, b.cfCache], sharedLevels: ratios.length, ratioMedian: med, withinOnePercentOfMedian: ratios.filter((r) => Math.abs(r / med - 1) < 0.01).length, unchanged: ratios.filter((r) => r === 1).length });
  const quiet = await get('/quote/v1/depth?symbol=LSK-SWAP-USDT&limit=20');
  log('rest_book_quiet', { reply: strip(quiet), ageMs: quiet.json?.t ? Date.now() - quiet.json.t : null, bids: quiet.json?.b?.length, asks: quiet.json?.a?.length, top: { b: quiet.json?.b?.[0], a: quiet.json?.a?.[0] } });
}

async function errors() {
  const cases = [
    '/quote/v1/depth?symbol=NOPE-SWAP-USDT',
    '/quote/v1/depth',
    '/quote/v1/depth?symbol=BTC-SWAP-USDT&limit=5000',
    '/quote/v1/markPrice?symbol=NOPE-SWAP-USDT',
    '/api/v1/futures/fundingRate?symbol=NOPE-SWAP-USDT',
    '/quote/v1/index?symbol=NOPEUSDT',
    '/quote/v1/indexPriceComponents?symbol=NOPEUSDT',
    '/api/v1/futures/historyFundingRate',
    '/api/v1/nope',
    '/quote/v1/depth?symbol=REN-SWAP-USDT',
  ];
  for (const p of cases) {
    const r = await get(p);
    log('error_shape', { path: p, status: r.status, body: r.text.slice(0, 300), limitHeaders: [r.limitStatus, r.limit, r.limitReset], retryAfter: r.retryAfter });
    await sleep(1100);
  }
}

async function clock() {
  for (let i = 0; i < 3; i++) {
    const sent = Date.now();
    const r = await get('/api/v1/time');
    const recv = Date.now();
    const server = r.json.serverTime;
    log('clock', { server, sent, recv, rttMs: recv - sent, localMinusServerLow: sent - server, localMinusServerHigh: recv - server });
    await sleep(1100);
  }
}

async function main() {
  await host();
  const { contracts } = await catalog();
  await anchor(contracts);
  await book();
  await errors();
  await clock();
}

// The documented basket call answers one index at a time, so the survey walks every index token an active perpetual uses.
async function baskets() {
  const ei = (await get('/api/v1/exchangeInfo')).json;
  const tokens = [...new Set(ei.contracts.map((c) => c.indexToken))].sort();
  const rows = [];
  for (const token of tokens) {
    const r = await get(`/quote/v1/indexPriceComponents?symbol=${encodeURIComponent(token)}`);
    const comps = r.json?.components ?? [];
    rows.push({ token, status: r.status, n: comps.length, comps: comps.map((c) => `${c.exchange}:${c.spotPair}:${c.weight}`), ageMs: r.json?.time ? Date.now() - Number(r.json.time) : null, body: r.status === 200 && comps.length ? undefined : r.text.slice(0, 160) });
    await sleep(500);
  }
  save('baskets.json', rows);
  const byCount = count(rows, (r) => r.n);
  const exchanges = {};
  for (const r of rows) for (const c of r.comps) { const ex = c.split(':')[0]; exchanges[ex] = (exchanges[ex] ?? 0) + 1; }
  const own = rows.filter((r) => r.comps.some((c) => /TOOBIT/i.test(c)));
  const single = rows.filter((r) => r.n === 1);
  const futuresMembers = rows.filter((r) => r.comps.some((c) => /FUTURE|SWAP|PERP/i.test(c)));
  const unequal = rows.filter((r) => new Set(r.comps.map((c) => c.split(':')[2])).size > 1);
  log('baskets', { tokens: tokens.length, byCount, exchanges, ownVenue: own.map((r) => `${r.token} ${r.comps.join(',')}`), single: single.map((r) => `${r.token} ${r.comps.join(',')}`), futuresMembers: futuresMembers.map((r) => `${r.token} ${r.comps.join(',')}`).slice(0, 40), futuresMemberCount: futuresMembers.length, unequalWeights: unequal.length, unequalSample: unequal.slice(0, 10).map((r) => `${r.token} ${r.comps.join(',')}`), empty: rows.filter((r) => r.n === 0).map((r) => `${r.token} ${r.status} ${r.body}`).slice(0, 20), staleOver60s: rows.filter((r) => r.ageMs > 60_000).map((r) => `${r.token} ${Math.round(r.ageMs / 1000)}s`).slice(0, 30) });
  for (const t of ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'LSKUSDT', 'AAPLUSDT', 'XAUUSDT']) log('basket_sample', rows.find((r) => r.token === t) ?? { token: t, missing: true });
}

async function settlement() {
  const fr = (await get('/api/v1/futures/fundingRate')).json;
  const now = Date.now();
  const next = Math.min(...fr.map((x) => Number(x.nextFundingTime)).filter((t) => t > now));
  const symbols = fr.filter((x) => Number(x.nextFundingTime) === next && !x.symbol.startsWith('TBV_')).map((x) => x.symbol).slice(0, 4);
  symbols.push('BTC-SWAP-USDT');
  log('settlement_plan', { next: iso(next), symbols, startsIn: Math.round((next - 90_000 - now) / 1000) });
  if (next - 90_000 > now) await sleep(next - 90_000 - now);
  const seen = {};
  while (Date.now() < next + 120_000) {
    const start = performance.now();
    const r = await get('/api/v1/futures/fundingRate');
    const at = new Date().toISOString();
    for (const s of symbols) {
      const row = r.json?.find((x) => x.symbol === s);
      const key = `${row?.rate} ${row?.nextFundingTime} ${row?.period}`;
      if (seen[s] !== key) { log('settlement_rate', { at, symbol: s, rate: row?.rate, next: iso(row?.nextFundingTime), period: row?.period }); seen[s] = key; }
    }
    const wait = 5000 - (performance.now() - start);
    if (wait > 0) await sleep(wait);
  }
  for (const s of symbols) {
    const h = await get(`/api/v1/futures/historyFundingRate?symbol=${s}&limit=3`);
    log('settlement_history', { symbol: s, rows: (h.json ?? []).map((x) => ({ ...x, settleIso: iso(x.settleTime) })) });
    await sleep(1100);
  }
}

// Consecutive Toobit books rescale many levels by one common factor, so this compares each level with Binance USD-M read at the same moment.
// Two reads per round, one public depth call to each venue, five rounds two seconds apart.
async function mirror() {
  const pairs = [['BTC-SWAP-USDT', 'BTCUSDT'], ['ETH-SWAP-USDT', 'ETHUSDT'], ['SOL-SWAP-USDT', 'SOLUSDT'], ['DOGE-SWAP-USDT', 'DOGEUSDT']];
  const ei = (await get('/api/v1/exchangeInfo')).json;
  const mult = new Map(ei.contracts.map((c) => [c.symbol, Number(c.contractMultiplier)]));
  for (const [t, b] of pairs) {
    const rounds = [];
    for (let i = 0; i < 5; i++) {
      const [rt, rb] = await Promise.all([get(`/quote/v1/depth?symbol=${t}&limit=20`), get(`https://fapi.binance.com/fapi/v1/depth?symbol=${b}&limit=100`)]);
      if (rt.status !== 200 || rb.status !== 200) { rounds.push({ toobit: rt.status, binance: rb.status, body: rb.text.slice(0, 200) }); await sleep(2000); continue; }
      const bin = { b: new Map(rb.json.bids.map(([p, q]) => [Number(p), Number(q)])), a: new Map(rb.json.asks.map(([p, q]) => [Number(p), Number(q)])) };
      const side = (levels, map) => {
        const ratios = [];
        let hit = 0;
        for (const [p, q] of levels) { const bq = map.get(Number(p)); if (bq !== undefined) { hit++; ratios.push((Number(q) * mult.get(t)) / bq); } }
        ratios.sort((x, y) => x - y);
        const mean = ratios.reduce((s, x) => s + x, 0) / Math.max(1, ratios.length);
        const sd = Math.sqrt(ratios.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, ratios.length));
        return { levels: levels.length, pricesOnBinance: hit, ratioMedian: ratios.length ? +ratios[Math.floor(ratios.length / 2)].toFixed(4) : null, ratioMin: ratios.length ? +ratios[0].toFixed(4) : null, ratioMax: ratios.length ? +ratios[ratios.length - 1].toFixed(4) : null, cv: ratios.length ? +(sd / mean).toFixed(4) : null };
      };
      rounds.push({ toobitTouch: [rt.json.b[0], rt.json.a[0]], binanceTouch: [rb.json.bids[0], rb.json.asks[0]], bids: side(rt.json.b, bin.b), asks: side(rt.json.a, bin.a), toobitT: rt.json.t, binanceE: rb.json.E });
      await sleep(2000);
    }
    log('mirror', { toobit: t, binance: b, multiplier: mult.get(t), rounds });
  }
}

const mode = process.argv[2] ?? 'main';
const run = { main, baskets, settlement, mirror }[mode];
if (!run) { console.error(`unknown mode ${mode}`); process.exit(1); }
run().catch((e) => { console.error(e); process.exit(1); });
