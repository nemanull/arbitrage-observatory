// Deepcoin perpetual REST probe: host latency, the catalog as CCXT 4.5.68 maps it, the bulk anchor calls, a minute of one second polls, the REST book, errors, rate limit headers and server time.
// Public, unauthenticated and read-only, and well inside the published limit of 10 requests per second per endpoint.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/deepcoin/rest-probe.mjs [catalog|anchor|poll|book|misc]
//   catalog  CCXT loadMarkets against the raw instruments reply, ids against the socket and anchor spellings, contract sizes, pairs listed twice
//   anchor   one read of each bulk anchor call with size, time and coverage, and a funding history read
//   poll     60 polls one second apart of mark-price and current-funding-rate, with a 1m index candle read for two markets every other second
//   book     REST book depth limits, level order, size unit and caching
//   misc     error shapes, rate limit headers and the server clock offset
// Recorded in docs/profiles/deepcoin/rest.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.deepcoin.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
const stats = (a) => ({ n: a.length, min: Math.min(...a), median: median(a), p90: pct(a, 0.9), max: Math.max(...a) });
// BTC-USDT-SWAP becomes BTCUSDT, which is how the socket and the funding calls spell a perpetual.
const wireId = (instId) => instId.replace(/-SWAP$/, '').replace('-', '');

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ms, bytes: text.length, json, text, headers: res.headers };
}

async function catalogMode() {
  const cold = await get('/deepcoin/market/time');
  const warm = [];
  for (let i = 0; i < 5; i++) { warm.push((await get('/deepcoin/market/time')).ms); await sleep(250); }
  log('latency', { coldMs: cold.ms, warmMs: warm, pop: cold.headers.get('x-amz-cf-pop'), cache: cold.headers.get('x-cache') });

  const raw = (await get('/deepcoin/market/instruments?instType=SWAP')).json.data;
  const spot = (await get('/deepcoin/market/instruments?instType=SPOT')).json.data;
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  log('raw', { swapRows: raw.length, byQuoteAndState: count(raw, (x) => `${x.quoteCcy}:${x.state}`), ctVal: count(raw, (x) => `${x.quoteCcy}:${x.ctVal}`), spotRows: spot.length, spotLive: spot.filter((x) => x.state === 'live').length });

  const ex = new ccxt.deepcoin();
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.swap);
  const active = swaps.filter((m) => m.active);
  log('ccxt', {
    version: ccxt.version, loadMs: Date.now() - t0, markets: Object.keys(markets).length, swaps: swaps.length, activeSwaps: active.length,
    bySettle: count(active, (m) => `${m.settle}:${m.linear ? 'linear' : 'inverse'}`),
    takerMaker: count(active, (m) => `${m.taker}/${m.maker}`),
    contractSizeMatchesCtVal: active.filter((m) => m.contractSize === Number(m.info.ctVal)).length,
    idIsInstId: active.filter((m) => m.id === m.info.instId).length,
    uniqueWireIds: new Set(active.map((m) => wireId(m.id))).size,
    tickSzSpelledAsExponent: active.filter((m) => String(m.precision.price) !== m.info.tickSz).map((m) => `${m.id} ${m.info.tickSz} ${m.precision.price}`).slice(0, 5),
    tickSzNotSpelledSameCount: active.filter((m) => String(m.precision.price) !== m.info.tickSz).length,
  });
  for (const s of ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'ETH/USD:ETH', 'LTC/USD:LTC']) {
    const m = markets[s];
    if (m) log('market', { symbol: s, id: m.id, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, inverse: m.inverse, contractSize: m.contractSize, taker: m.taker, maker: m.maker, active: m.active, precision: m.precision, socketFilter: `DeepCoin_${wireId(m.id)}_${m.info.tickSz}` });
  }
  const byBase = new Map();
  for (const m of active) byBase.set(m.base, [...(byBase.get(m.base) ?? []), m.symbol]);
  log('twice', { basesWithTwoSwaps: [...byBase.entries()].filter(([, v]) => v.length > 1) });
  log('spotAlsoPerp', { perpBasesWithSpot: active.filter((m) => markets[`${m.base}/USDT`]).length });
  const odd = active.filter((m) => /^1000|^10000|^1M/.test(m.base));
  log('scaled', { count: odd.length, bases: odd.map((m) => `${m.base}:${m.contractSize}`) });
  const tickers = (await get('/deepcoin/market/tickers?instType=SWAP')).json.data;
  const ids = new Set(raw.map((x) => x.instId));
  log('hidden', { tickerRows: tickers.length, notInCatalog: tickers.filter((t) => !ids.has(t.instId)).map((t) => `${t.instId} vol ${Math.round(Number(t.volCcy24h))}`) });
}

async function anchorMode() {
  const inst = (await get('/deepcoin/market/instruments?instType=SWAP')).json.data;
  const usdt = new Set(inst.filter((x) => x.quoteCcy === 'USDT').map((x) => wireId(x.instId)));
  const usd = new Set(inst.filter((x) => x.quoteCcy === 'USD').map((x) => wireId(x.instId)));
  const calls = {
    mark: '/deepcoin/market/mark-price?instType=SWAP',
    rateU: '/deepcoin/trade/fund-rate/current-funding-rate?instType=SwapU',
    rateCoin: '/deepcoin/trade/fund-rate/current-funding-rate?instType=Swap',
    cycleU: '/deepcoin/trade/funding-rate?instType=SwapU',
    cycleCoin: '/deepcoin/trade/funding-rate?instType=Swap',
    tickers: '/deepcoin/market/tickers?instType=SWAP',
    rateDocPath: '/deepcoin/market/fund-rate/current-funding-rate?instType=SwapU',
  };
  const out = {};
  for (const [k, path] of Object.entries(calls)) {
    const r = await get(path);
    r.arrival = Date.now();
    out[k] = r;
    log('call', { k, path, status: r.status, ms: r.ms, bytes: r.bytes, rateHeaders: [r.headers.get('x-ratelimit-limit'), r.headers.get('x-ratelimit-remaining'), r.headers.get('x-ratelimit-window')], cache: r.headers.get('x-cache'), head: r.json ? undefined : r.text.slice(0, 60) });
    await sleep(200);
  }
  const now = out.mark.arrival;
  const mark = out.mark.json.data;
  const markIds = new Set(mark.map((x) => wireId(x.instId)));
  const ages = mark.map((x) => now - Number(x.ts));
  log('mark', { rows: mark.length, coversUsdt: [...usdt].filter((i) => markIds.has(i)).length, of: usdt.size, extra: mark.filter((x) => !usdt.has(wireId(x.instId)) && !usd.has(wireId(x.instId))).map((x) => x.instId), tsAgeMsAtArrival: stats(ages), tsWholeSeconds: mark.every((x) => x.ts.endsWith('000')), zeroMarks: mark.filter((x) => Number(x.markPx) === 0).length, sample: mark.find((x) => x.instId === 'BTC-USDT-SWAP') });
  const rate = out.rateU.json.data.current_fund_rates;
  const rateIds = new Set(rate.map((x) => x.instrumentId));
  const vals = rate.filter((x) => usdt.has(x.instrumentId)).map((x) => x.fundingRate);
  log('rate', { rows: rate.length, coversUsdt: [...usdt].filter((i) => rateIds.has(i)).length, of: usdt.size, notLive: rate.filter((x) => !usdt.has(x.instrumentId)).length, types: [...new Set(rate.map((x) => typeof x.fundingRate))], liveRate: { min: Math.min(...vals), max: Math.max(...vals), atMinus0_003: vals.filter((v) => v === -0.003).length, at0_003: vals.filter((v) => v === 0.003).length }, coinRows: out.rateCoin.json.data.current_fund_rates.map((x) => `${x.instrumentId}:${x.fundingRate}`) });
  const cycle = out.cycleU.json.data;
  const cyc = cycle.reduce((m, x) => ((m[`${x.settleInterval}s next ${new Date(x.nextSettleTime * 1000).toISOString()}`] = (m[`${x.settleInterval}s next ${new Date(x.nextSettleTime * 1000).toISOString()}`] ?? 0) + 1), m), {});
  const intervalOf = new Map(cycle.map((x) => [x.instrumentID, x.settleInterval]));
  const common = {};
  for (const x of rate) if (intervalOf.has(x.instrumentId)) common[`${intervalOf.get(x.instrumentId)}s:${x.fundingRate}`] = (common[`${intervalOf.get(x.instrumentId)}s:${x.fundingRate}`] ?? 0) + 1;
  const live = rate.filter((x) => intervalOf.has(x.instrumentId)).sort((a, b) => a.fundingRate - b.fundingRate);
  log('rateShape', { mostCommon: Object.entries(common).sort((a, b) => b[1] - a[1]).slice(0, 6), lowest: live.slice(0, 3).map((x) => `${x.instrumentId}:${x.fundingRate}:${intervalOf.get(x.instrumentId)}s`), highest: live.slice(-3).map((x) => `${x.instrumentId}:${x.fundingRate}:${intervalOf.get(x.instrumentId)}s`) });
  log('cycle', { rows: cycle.length, coversUsdt: cycle.filter((x) => usdt.has(x.instrumentID)).length, groups: cyc, hourly: cycle.filter((x) => x.settleInterval === 3600).map((x) => x.instrumentID), coin: out.cycleCoin.json.data.map((x) => `${x.instrumentID}:${x.settleInterval}`) });
  const tick = out.tickers.json.data;
  log('tickers', { rows: tick.length, keys: Object.keys(tick[0]), hasMarkOrIndex: Object.keys(tick[0]).some((k) => /mark|idx|index/i.test(k)) });

  for (const id of ['BTCUSDT', 'TMFUSDT']) {
    const h = await get(`/deepcoin/trade/fund-rate/history?instId=${id}&size=6`);
    const list = h.json?.data?.rows ?? h.json?.data?.list ?? []; // the documentation names the array list, the wire names it rows
    const cur = rate.find((x) => x.instrumentId === id)?.fundingRate;
    log('history', { id, status: h.status, ms: h.ms, current: cur, rows: list.map((x) => ({ rate: x.rate, at: new Date(x.CreateTime * 1000).toISOString(), ratePeriodSec: x.ratePeriodSec })) });
    await sleep(200);
  }
  for (const id of ['BTC-USDT-SWAP', 'ETH-USD-SWAP']) {
    const c = await get(`/deepcoin/market/index-candles?instId=${id}&bar=1m&limit=2`);
    const m = await get(`/deepcoin/market/mark-price-candles?instId=${id}&bar=1m&limit=2`);
    log('candles', { id, indexStatus: c.status, indexMs: c.ms, index: c.json?.data?.[0], markCandle: m.json?.data?.[0] });
  }
}

async function pollMode() {
  const ids = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'AXTI-USDT-SWAP', 'TMF-USDT-SWAP'];
  const series = new Map(ids.map((i) => [i, { mark: [], markTs: [], rate: [], index: [] }]));
  const markMs = [];
  const rateMs = [];
  const indexMs = [];
  const tsAge = [];
  let markChangesAll = 0;
  let prevAll = null;
  for (let k = 0; k < 60; k++) {
    const start = Date.now();
    const m = await get('/deepcoin/market/mark-price?instType=SWAP');
    const arrival = Date.now();
    markMs.push(m.ms);
    const r = await get('/deepcoin/trade/fund-rate/current-funding-rate?instType=SwapU');
    rateMs.push(r.ms);
    const byId = new Map(m.json.data.map((x) => [x.instId, x]));
    const rateById = new Map(r.json.data.current_fund_rates.map((x) => [x.instrumentId, x.fundingRate]));
    const nowAll = new Map(m.json.data.map((x) => [x.instId, x.markPx]));
    if (prevAll) for (const [id, px] of nowAll) if (prevAll.get(id) !== px) markChangesAll++;
    prevAll = nowAll;
    for (const id of ids) {
      const s = series.get(id);
      s.mark.push(byId.get(id)?.markPx);
      s.markTs.push(byId.get(id)?.ts);
      tsAge.push(arrival - Number(byId.get(id)?.ts));
      s.rate.push(rateById.get(wireId(id)));
    }
    if (k % 2 === 0) {
      for (const id of ids.slice(0, 2)) {
        const c = await get(`/deepcoin/market/index-candles?instId=${id}&bar=1m&limit=1`);
        indexMs.push(c.ms);
        series.get(id).index.push(c.json?.data?.[0]?.[4]);
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  const changes = (a) => a.filter((v, i) => i > 0 && v !== a[i - 1]).length;
  log('pollTimes', { markMs: stats(markMs), rateMs: stats(rateMs), indexCandleMs: stats(indexMs), markTsAgeAtArrivalMs: stats(tsAge), markChangesAllRowsPer59Polls: markChangesAll });
  for (const [id, s] of series) log('pollSeries', { id, markChanges: changes(s.mark), markTsChanges: changes(s.markTs), rateChanges: changes(s.rate), rateFirstLast: [s.rate[0], s.rate.at(-1)], indexCloseChangesOver30Reads: s.index.length ? changes(s.index) : null });
}

async function bookMode() {
  const inst = (await get('/deepcoin/market/instruments?instType=SWAP')).json.data;
  const btc = inst.find((x) => x.instId === 'BTC-USDT-SWAP');
  for (const sz of [20, 400, 401, 1000]) {
    const r = await get(`/deepcoin/market/books?instId=BTC-USDT-SWAP&sz=${sz}`);
    const d = r.json?.data;
    const bids = d?.bids?.map(([p]) => Number(p)) ?? [];
    const asks = d?.asks?.map(([p]) => Number(p)) ?? [];
    log('depth', { sz, status: r.status, ms: r.ms, bytes: r.bytes, bids: bids.length, asks: asks.length, bidsDesc: bids.every((p, i) => i === 0 || p < bids[i - 1]), asksAsc: asks.every((p, i) => i === 0 || p > asks[i - 1]), types: d?.bids?.[0]?.map((x) => typeof x), head: d ? undefined : r.text.slice(0, 200) });
    await sleep(200);
  }
  const noSz = await get('/deepcoin/market/books?instId=BTC-USDT-SWAP');
  log('depth', { sz: 'absent', status: noSz.status, bids: noSz.json?.data?.bids?.length, body: noSz.json?.data ? undefined : noSz.text.slice(0, 200) });
  const t = await get('/deepcoin/market/tickers?instType=SWAP&uly=BTC-USDT');
  const b = await get('/deepcoin/market/books?instId=BTC-USDT-SWAP&sz=1');
  log('unit', { ctVal: btc.ctVal, tickerBidSz: t.json.data[0].bidSz, tickerBidPx: t.json.data[0].bidPx, bookTop: b.json.data.bids[0], note: 'ticker sizes are contracts, book sizes are coins when the ratio is 1/ctVal' });
  const same = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/deepcoin/market/books?instId=BTC-USDT-SWAP&sz=5');
    same.push({ ms: r.ms, cache: r.headers.get('x-cache'), body: r.text.slice(0, 60), age: r.headers.get('age') });
    await sleep(150);
  }
  log('caching', { reads: same });
}

async function miscMode() {
  const cases = [
    '/deepcoin/market/books?instId=NOPE-USDT-SWAP&sz=5',
    '/deepcoin/market/mark-price',
    '/deepcoin/market/mark-price?instType=FUTURES',
    '/deepcoin/market/instruments?instType=spot',
    '/deepcoin/trade/fund-rate/current-funding-rate?instType=SwapU&instId=NOPEUSDT',
    '/deepcoin/trade/fund-rate/current-funding-rate?instType=SwapU&instId=BTC-USDT-SWAP',
    '/deepcoin/market/nope',
  ];
  for (const path of cases) {
    const r = await get(path);
    log('error', { path, status: r.status, body: r.text.slice(0, 220), rate: [r.headers.get('x-ratelimit-limit'), r.headers.get('x-ratelimit-remaining'), r.headers.get('x-ratelimit-window'), r.headers.get('x-ratelimit-reset')] });
    await sleep(250);
  }
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/deepcoin/market/time');
    const t1 = Date.now();
    offsets.push({ rttMs: t1 - t0, offsetMs: r.json.data.ts - Math.round((t0 + t1) / 2) });
    await sleep(300);
  }
  log('time', { samples: offsets, medianOffsetMs: median(offsets.map((x) => x.offsetMs)) });
  const h = await get('/deepcoin/market/time');
  log('headers', { names: [...h.headers.keys()] });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog: catalogMode, anchor: anchorMode, poll: pollMode, book: bookMode, misc: miscMode };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
