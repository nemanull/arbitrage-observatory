// Batonex public REST probe: host latency, perpetual catalog, anchor calls, index against the Binance mark, funding, book snapshot, errors and server time.
// Public, unauthenticated, read-only. One request at a time, far inside the published 3,000 weight per minute.
// Endpoints are those of the Batonex openapi docs at github.com/batonex/openapi, apidocs/04-contract.md, plus the web app's /api/contract/funding_rates.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/batonex/rest-probe.mjs [catalog|anchor|poll|book|errors]
//   catalog  latency, brokerInfo contracts by status and margin, contract size against ticker volume, CCXT exchange list. About 10 s.
//   anchor   bulk index, funding rate, web funding_rates, mark price call, and index against the Binance and Bitget futures mark. About 10 s.
//   poll     the index call and the contracts call polled once a second for 60 s: reply time and how often each number changes. About 70 to 130 s.
//   book     REST depth at limits 20, 100 and 300, level order, the merged depth call, repeat reads for caching. About 10 s.
//   errors   unknown symbol, missing parameter, unknown path, rate limit headers, server time offset. About 10 s.
// Recorded in docs/profiles/batonex/rest.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.batonex.com/openapi';
const WEB = 'https://www.batonex.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const headers = Object.fromEntries([...res.headers].filter(([k]) => /limit|retry|date|cache|age|server|cf-|x-/i.test(k)));
  return { status: res.status, ms, bytes: text.length, text, json, headers };
}

async function catalog() {
  for (let i = 0; i < 3; i++) {
    const r = await get(`${API}/v1/time`);
    log('latency', { call: 'time', i, status: r.status, ms: r.ms, body: r.text });
  }
  const info = await get(`${API}/v1/brokerInfo`);
  const c = info.json.contracts;
  const groups = {};
  for (const x of c) { const k = `${x.status}|${x.underlying}|${x.marginToken}|inverse=${x.inverse}`; groups[k] = (groups[k] ?? 0) + 1; }
  const names = { SWAP: c.filter((x) => x.symbol.includes('-SWAP-')).length, PERP: c.filter((x) => x.symbol.endsWith('-PERP')).length };
  const bases = new Map();
  for (const x of c) { const b = x.symbol.split('-')[0]; bases.set(b, [...(bases.get(b) ?? []), x.symbol]); }
  const twice = [...bases.values()].filter((v) => v.length > 1);
  log('brokerInfo', { status: info.status, ms: info.ms, bytes: info.bytes, spot: info.json.symbols.length, options: info.json.options.length, contracts: c.length, groups, names, listedTwice: twice, rateLimits: info.json.rateLimits });
  const tick = await get(`${API}/quote/v1/contract/ticker/24hr`);
  const bySym = new Map(tick.json.map((t) => [t.symbol, t]));
  const checks = [];
  for (const s of ['BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'SOL-SWAP-USDT', 'AAPL-USDT-PERP', '1MBABYDOGE-USDT-PERP']) {
    const x = c.find((y) => y.symbol === s); const t = bySym.get(s);
    if (!x || !t) continue;
    const implied = +t.quoteVolume / (+t.volume * +t.lastPrice);
    checks.push({ s, contractMultiplier: x.contractMultiplier, impliedByVolume: +implied.toPrecision(4) });
  }
  const notInCatalog = tick.json.filter((t) => !c.some((x) => x.symbol === t.symbol)).map((t) => t.symbol);
  log('ticker24hr', { status: tick.status, ms: tick.ms, rows: tick.json.length, notInBrokerInfo: notInCatalog.length, sampleNotIn: notInCatalog.slice(0, 8), zeroVolumeContracts: tick.json.filter((t) => c.some((x) => x.symbol === t.symbol) && +t.quoteVolume === 0).length, sizeChecks: checks });
  log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, matches: ccxt.exchanges.filter((x) => /bato|wise|bhex|hbtc/i.test(x)) });
}

async function anchor() {
  const idx = await get(`${API}/quote/v1/contract/index`);
  const fr = await get(`${API}/contract/v1/fundingRate`);
  const web = await get(`${WEB}/api/contract/funding_rates`);
  const mark = await get(`${API}/quote/v1/markPrice?symbol=BTC-SWAP-USDT`);
  const contracts = await get(`${API}/v1/contracts`);
  const info = (await get(`${API}/v1/brokerInfo`)).json.contracts.filter((x) => x.status === 'TRADING');
  const indexKeys = Object.keys(idx.json.index);
  log('index', { status: idx.status, ms: idx.ms, bytes: idx.bytes, count: indexKeys.length, missingForContracts: info.filter((x) => !(x.index in idx.json.index)).map((x) => x.symbol), btc: idx.json.index.BTCUSDT, edp: idx.json.edp.BTCUSDT });
  const intervals = {};
  for (const r of fr.json) { const h = (+r.intervalEnd - +r.intervalStart) / 3_600_000; intervals[h] = (intervals[h] ?? 0) + 1; }
  const rates = fr.json.map((r) => +r.rate).sort((a, b) => a - b);
  log('fundingRate', { status: fr.status, ms: fr.ms, bytes: fr.bytes, rows: fr.json.length, intervalHours: intervals, ends: [...new Set(fr.json.map((r) => r.intervalEnd))], rateMinMax: [rates[0], rates[rates.length - 1]], sample: fr.json[0] });
  const w = web.json.find((r) => r.tokenId === 'BTC-SWAP-USDT');
  log('webFunding', { status: web.status, ms: web.ms, rows: web.json.length, btc: w, keys: Object.keys(web.json[0]) });
  log('markPrice', { status: mark.status, ms: mark.ms, bytes: mark.bytes, body: mark.text.slice(0, 200) });
  log('contractsCall', { status: contracts.status, ms: contracts.ms, body: contracts.text.slice(0, 300) });
  const bn = await get('https://fapi.binance.com/fapi/v1/premiumIndex');
  const bnMap = new Map((bn.json ?? []).map((r) => [r.symbol, r]));
  const idx2 = (await get(`${API}/quote/v1/contract/index`)).json.index;
  const cmp = [];
  for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AAPLUSDT', 'EDGEUSDT', 'XRPUSDT', 'AVAXUSDT', 'TSLAUSDT']) {
    const b = bnMap.get(s);
    if (!b || !idx2[s]) { cmp.push({ s, binance: b ? 'present' : 'absent' }); continue; }
    cmp.push({ s, batonexIndex: idx2[s], binanceMark: b.markPrice, binanceIndex: b.indexPrice, ppmVsMark: Math.round((+idx2[s] / +b.markPrice - 1) * 1e6), ppmVsIndex: Math.round((+idx2[s] / +b.indexPrice - 1) * 1e6) });
  }
  log('binanceCompare', { binanceStatus: bn.status, rows: cmp });
  let within = 0, n = 0;
  for (const [k, v] of Object.entries(idx2)) { const b = bnMap.get(k); if (!b) continue; n++; if (Math.abs(+v / +b.markPrice - 1) < 500e-6) within++; }
  log('binanceCompareAll', { comparable: n, within500ppmOfMark: within });
}

async function poll() {
  const seen = { index: new Map(), contractsIndex: new Map(), next: new Map(), nextTs: new Map() };
  const changes = { index: 0, contractsIndex: 0, next: 0, nextTs: 0 };
  const times = { index: [], contracts: [] };
  let lag = [];
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const a = await get(`${API}/quote/v1/contract/index`);
    const b = await get(`${API}/v1/contracts`);
    times.index.push(a.ms); times.contracts.push(b.ms);
    const bump = (k, key, v) => { if (seen[k].has(key) && seen[k].get(key) !== v) changes[k]++; seen[k].set(key, v); };
    for (const [k, v] of Object.entries(a.json.index)) bump('index', k, v);
    for (const r of b.json) { bump('contractsIndex', r.symbol, r.indexPrice); bump('next', r.symbol, r.nextFundingRate); bump('nextTs', r.symbol, r.nextFundingRateTs); }
    const btc = b.json.find((r) => r.symbol === 'BTC-SWAP-USDT');
    lag.push(Math.round((+btc.indexPrice / +a.json.index.BTCUSDT - 1) * 1e6));
    const wait = 1_000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  const q = (arr) => { const x = [...arr].sort((m, n) => m - n); return [x[0], x[Math.floor(x.length / 2)], x[Math.floor(x.length * 0.9)], x[x.length - 1]]; };
  const per = (k) => +(changes[k] / seen[k].size).toFixed(2);
  log('poll', { rounds: 60, indexReplyMsMinMedP90Max: q(times.index), contractsReplyMsMinMedP90Max: q(times.contracts), changesPerSymbolPerMinute: { index: per('index'), contractsIndexPrice: per('contractsIndex'), nextFundingRate: per('next'), nextFundingRateTs: per('nextTs') }, btcContractsIndexVsIndexCallPpmMinMedP90Max: q(lag.map(Math.abs)), symbols: { index: seen.index.size, contracts: seen.contractsIndex.size } });
}

async function book() {
  for (const limit of [20, 100, 300]) {
    const r = await get(`${API}/quote/v1/contract/depth?symbol=BTC-SWAP-USDT&limit=${limit}`);
    const b = r.json?.bids ?? [], a = r.json?.asks ?? [];
    const desc = b.every((l, i) => i === 0 || +l[0] < +b[i - 1][0]);
    const asc = a.every((l, i) => i === 0 || +l[0] > +a[i - 1][0]);
    log('depth', { limit, status: r.status, ms: r.ms, bids: b.length, asks: a.length, bidsDescending: desc, asksAscending: asc, time: r.json?.time, headers: r.headers });
  }
  const m = await get(`${API}/quote/v1/contract/depth/merged?symbol=BTC-SWAP-USDT&limit=20`);
  log('merged', { status: m.status, ms: m.ms, bids: m.json?.bids?.length, body: m.text.slice(0, 160) });
  const ts = [];
  for (let i = 0; i < 5; i++) { const r = await get(`${API}/quote/v1/contract/depth?symbol=BTC-SWAP-USDT&limit=5`); ts.push([Date.now(), r.json.time, r.json.bids[0]]); await sleep(300); }
  log('depthRepeat', { reads: ts.map(([now, t, b]) => ({ ageMs: now - t, time: t, bid: b })) });
}

async function errors() {
  const cases = [
    `${API}/quote/v1/contract/depth?symbol=NOPE-SWAP-USDT`,
    `${API}/quote/v1/contract/depth`,
    `${API}/quote/v1/contract/index?symbol=NOPEUSDT`,
    `${API}/contract/v1/fundingRate?symbol=NOPE-SWAP-USDT`,
    `${API}/quote/v1/nope`,
  ];
  for (const u of cases) {
    const r = await get(u);
    log('error', { url: u.replace(API, ''), status: r.status, ms: r.ms, body: r.text.slice(0, 200), headers: r.headers });
  }
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/v1/time`);
    const t1 = Date.now();
    offsets.push({ offsetMs: r.json.serverTime - Math.round((t0 + t1) / 2), rttMs: t1 - t0 });
  }
  log('time', { offsets });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, poll, book, errors };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
await modes[mode]();
