// DigiFinex perpetual swap REST probe: host and latency, the CCXT catalog against the instruments call, the tickers bulk call polled at one hertz, funding per instrument, the REST book, error shapes, rate limit headers and server time.
// Public, unauthenticated and read-only.
// The published IP budget is a weight per minute, and every mode here stays under 1,500 of the 6,000 the headers report.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/digifinex/rest-probe.mjs [main|anchor|funding|book]
//   main     host, cold and warm times, catalog through CCXT, errors, rate limit headers, server time, about 20 s
//   anchor   tickers every second for 60 rounds: reply size and time, how often index and mark change, how old the reply timestamp is
//   funding  funding_rate for every instrument once, then funding_rate_history for every instrument, both at about 4 per second, then BTC every 5 s for 40 s, about 2.5 minutes
//   book     depth at several limits, level order, two reads 100 ms apart, and the book against the tickers best bid and ask
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/digifinex/rest.md and docs/profiles/digifinex/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'openapi.digifinex.com';
const API = `https://${HOST}/swap/v2/public`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (xs) => ({ n: xs.length, min: Math.round(Math.min(...xs)), median: Math.round(pct(xs, 0.5)), p90: Math.round(pct(xs, 0.9)), max: Math.round(Math.max(...xs)) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${path}`);
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  const h = (k) => res.headers.get(k);
  return { status: res.status, ms, ttfb, bytes: text.length, text, body, weightUse: h('ip-weight-minute-use'), weightRemain: h('ip-weight-minute-remain'), retryAfter: h('retry-after'), cfRay: h('cf-ray'), date: h('date') };
}

async function main() {
  const addrs = await dns.resolve4(HOST).catch((e) => [e.code]);
  log('dns', { host: HOST, addrs });

  const cold = await get('time');
  log('cold', { path: 'time', status: cold.status, ms: Math.round(cold.ms), cfRay: cold.cfRay });
  const warm = [];
  for (let i = 0; i < 10; i++) { warm.push((await get('time')).ms); await sleep(200); }
  log('warm', { path: 'time', ...stats(warm) });

  // Server time against the local clock, midpoint of the request.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('time');
    const t1 = Date.now();
    offsets.push(r.body.data - (t0 + t1) / 2);
    await sleep(200);
  }
  log('clock', { offsetMs: stats(offsets), sample: offsets.map(Math.round) });

  const inst = await get('instruments');
  keep('instruments.json', inst.text);
  const rows = inst.body.data;
  const byKind = {};
  for (const x of rows) {
    const k = `${x.type} ${x.contract_type} settle=${x.clear_currency} quote=${x.quote_currency} inverse=${x.is_inverse} trading=${x.is_trading} ${x.status}`;
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  log('instruments', { status: inst.status, bytes: inst.bytes, ms: Math.round(inst.ms), rows: rows.length, byKind, weightUse: inst.weightUse, weightRemain: inst.weightRemain });
  const pairs = {};
  for (const x of rows) (pairs[`${x.base_currency}/${x.quote_currency}`] ??= []).push(x.instrument_id);
  log('pairs_listed_twice', { pairs: Object.fromEntries(Object.entries(pairs).filter(([, v]) => v.length > 1)) });
  const cv = {};
  for (const x of rows) cv[`${x.contract_value} ${x.contract_value_currency}`] = (cv[`${x.contract_value} ${x.contract_value_currency}`] ?? 0) + 1;
  log('contract_values', { cv });
  const sim = await get('instruments?type=1');
  log('instruments_simulate', { status: sim.status, rows: sim.body?.data?.length, ids: sim.body?.data?.map((x) => x.instrument_id) });

  // CCXT catalog, no credentials.
  const ex = new ccxt.digifinex();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const loadMs = Math.round(performance.now() - t0);
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  const takers = {}; const makers = {};
  for (const m of swaps) { takers[m.taker] = (takers[m.taker] ?? 0) + 1; makers[m.maker] = (makers[m.maker] ?? 0) + 1; }
  const ids = new Set(rows.map((x) => x.instrument_id));
  const swapIdsInMarkets = new Set(swaps.map((m) => m.id));
  const lost = [...ids].filter((id) => !swapIdsInMarkets.has(id));
  const byId = ex.markets_by_id ?? {};
  log('ccxt', {
    version: ccxt.version, loadMs, markets: all.length, spot: all.filter((m) => m.spot).length, swapsActive: swaps.length,
    linear: swaps.filter((m) => m.linear === true).length, inverse: swaps.filter((m) => m.inverse === true).length,
    takers, makers, idsMissingFromObjectValues: lost,
    ethUsdtSymbol: markets['ETH/USDT:USDT']?.id, ethUsdtById: ['ETHUSDTPERP', 'BETHUSDTPERP', 'OETHUSDTPERP'].map((id) => `${id}:${(byId[id] ?? []).map((m) => m.symbol).join('|')}`),
    idEqualsInstrumentId: swaps.filter((m) => ids.has(m.id)).length,
    contractSizeEqualsContractValue: swaps.filter((m) => m.contractSize === Number(m.info.contract_value)).length,
    activeFalse: swaps.filter((m) => m.active === false).length,
  });
  for (const id of ['BTCUSDTPERP', 'ETHUSDTPERP', 'BETHUSDTPERP', 'BTCPERP', 'XAUTUSDTPERP', 'PEPEUSDTPERP']) {
    const m = (byId[id] ?? [])[0];
    if (m) log('ccxt_market', { id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, inverse: m.inverse, contractSize: m.contractSize, taker: m.taker, maker: m.maker, active: m.active, contract_value: m.info.contract_value, contract_value_currency: m.info.contract_value_currency });
  }

  // Error shapes.
  for (const path of ['funding_rate', 'funding_rate?instrument_id=NOPEUSDTPERP', 'depth?instrument_id=NOPEUSDTPERP', 'depth?instrument_id=BTCUSDTPERP&limit=101', 'ticker?instrument_id=NOPEUSDTPERP', 'nope']) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, body: r.text.slice(0, 120), weightUse: r.weightUse });
    await sleep(250);
  }

  const w = await get('api_weight');
  log('api_weight', { status: w.status, public: w.body.data.filter((x) => x.path.includes('/public/')).map((x) => `${x.path.replace('/swap/v2/public/', '')}=${x.weight}`).join(' '), weightUse: w.weightUse, weightRemain: w.weightRemain });
}

async function anchor() {
  const rounds = [];
  const last = new Map();
  const changes = new Map();
  let prevTs = null;
  const tsChanges = [];
  for (let i = 0; i < 60; i++) {
    const tStart = Date.now();
    const r = await get('tickers');
    const arrival = Date.now();
    if (i === 0) keep('tickers.json', r.text);
    const data = r.body?.data ?? [];
    const tsSet = new Set(data.map((x) => x.timestamp));
    const ts = Math.max(...data.map((x) => x.timestamp));
    if (prevTs !== null && ts !== prevTs) tsChanges.push(ts - prevTs);
    prevTs = ts;
    rounds.push({ ms: r.ms, ttfb: r.ttfb, bytes: r.bytes, age: arrival - ts, distinctTs: tsSet.size, status: r.status, weightUse: Number(r.weightUse) });
    for (const x of data) {
      const p = last.get(x.instrument_id);
      const c = changes.get(x.instrument_id) ?? { index: 0, mark: 0, bid: 0 };
      if (p) {
        if (p.index_price !== x.index_price) c.index++;
        if (p.mark_price !== x.mark_price) c.mark++;
        if (p.best_bid !== x.best_bid) c.bid++;
      }
      changes.set(x.instrument_id, c);
      last.set(x.instrument_id, x);
    }
    const wait = 1000 - (Date.now() - tStart);
    if (wait > 0) await sleep(wait);
  }
  log('tickers_poll', { rounds: rounds.length, statuses: [...new Set(rounds.map((r) => r.status))], bytes: stats(rounds.map((r) => r.bytes)), ms: stats(rounds.map((r) => r.ms)), ttfb: stats(rounds.map((r) => r.ttfb)), over1s: rounds.filter((r) => r.ms > 1000).length, distinctTsPerReply: [...new Set(rounds.map((r) => r.distinctTs))], maxWeightUse: Math.max(...rounds.map((r) => r.weightUse)) });
  log('tickers_timestamp', { ageAtArrivalMs: stats(rounds.map((r) => r.age)), stepsBetweenDistinctTimestamps: stats(tsChanges), distinctTimestamps: tsChanges.length + 1 });
  const pick = ['BTCUSDTPERP', 'ETHUSDTPERP', 'XAUTUSDTPERP', 'NVDAUSDTPERP', 'BTCPERP', 'MANAUSDTPERP'];
  log('changes_in_59_steps', { per: Object.fromEntries(pick.map((id) => [id, changes.get(id)])), indexChangesAll: stats([...changes.values()].map((c) => c.index)), markChangesAll: stats([...changes.values()].map((c) => c.mark)) });
  // Premium and price band on the last round.
  const prem = [...last.values()].map((x) => ({ id: x.instrument_id, prem: (Number(x.mark_price) / Number(x.index_price) - 1) * 1e6, hi: (Number(x.max_buy_price) / Number(x.index_price) - 1) * 1e6, lo: (Number(x.min_sell_price) / Number(x.index_price) - 1) * 1e6, markVsMid: (Number(x.mark_price) / ((Number(x.best_bid) + Number(x.best_ask)) / 2) - 1) * 1e6 }));
  prem.sort((a, b) => Math.abs(b.prem) - Math.abs(a.prem));
  log('premium_ppm', { absMarkOverIndex: stats(prem.map((p) => Math.abs(p.prem))), top5: prem.slice(0, 5).map((p) => `${p.id}:${Math.round(p.prem)}`), maxBuyOverIndex: stats(prem.map((p) => p.hi)), minSellUnderIndex: stats(prem.map((p) => p.lo)), zeroMark: prem.filter((p) => !Number.isFinite(p.prem)).length });
}

async function funding() {
  const inst = (await get('instruments')).body.data;
  const rows = [];
  const t0 = Date.now();
  for (const x of inst) {
    const r = await get(`funding_rate?instrument_id=${x.instrument_id}`);
    rows.push({ id: x.instrument_id, status: r.status, ms: r.ms, ...(r.body?.data ?? {}), weightUse: Number(r.weightUse) });
    await sleep(250);
  }
  const now = Date.now();
  const intervals = {};
  const nextTimes = {};
  for (const r of rows) {
    const h = (r.next_funding_time - r.funding_time) / 3.6e6;
    intervals[h] = (intervals[h] ?? 0) + 1;
    const nt = new Date(r.funding_time).toISOString().slice(0, 16);
    nextTimes[nt] = (nextTimes[nt] ?? 0) + 1;
  }
  const rates = rows.map((r) => Number(r.funding_rate)).filter(Number.isFinite);
  log('funding_all', { calls: rows.length, seconds: Math.round((now - t0) / 1000), statuses: [...new Set(rows.map((r) => r.status))], ms: stats(rows.map((r) => r.ms)), maxWeightUse: Math.max(...rows.map((r) => r.weightUse)), intervalHours: intervals, funding_time: nextTimes, rateMin: Math.min(...rates), rateMax: Math.max(...rates), rateEqualsNext: rows.filter((r) => Number(r.funding_rate) === Number(r.next_funding_rate)).length });
  const four = rows.filter((r) => (r.next_funding_time - r.funding_time) / 3.6e6 !== 8).map((r) => `${r.id}:${(r.next_funding_time - r.funding_time) / 3.6e6}h`);
  log('funding_not_8h', { four });
  const ext = [...rows].sort((a, b) => Math.abs(Number(b.funding_rate)) - Math.abs(Number(a.funding_rate))).slice(0, 5).map((r) => `${r.id}:${r.funding_rate}:${r.next_funding_rate}`);
  log('funding_extremes', { ext });
  log('funding_sample', { row: rows.find((r) => r.id === 'BTCUSDTPERP') });

  // History against the funding_rate call for every instrument, to tell whether funding_rate is the upcoming or the last settled one, and to read each interval.
  // The history call weighs 10, so 111 calls at 4 per second spend about 1,110 of the 6,000 per minute.
  const sample = new Set(['BTCUSDTPERP', 'ETHUSDTPERP', 'MANAUSDTPERP', 'AAVEUSDTPERP', 'NVDAUSDTPERP', 'XAUTUSDTPERP', 'PIUSDTPERP', 'SAMSUNGUSDTPERP']);
  const iso = (t) => (t ? new Date(t).toISOString().slice(5, 16) : t);
  const survey = { stepsHours: {}, futureEntries: {}, callEqualsLastSettled: 0, callEqualsFuture: 0, futureTime: {}, n: 0, maxWeightUse: 0 };
  const fourHour = [];
  for (const x of inst) {
    const id = x.instrument_id;
    const cur = rows.find((r) => r.id === id);
    const h = await get(`funding_rate_history?instrument_id=${id}&start_timestamp=${now - 2 * 86400e3}&limit=100`);
    survey.maxWeightUse = Math.max(survey.maxWeightUse, Number(h.weightUse));
    const list = h.body?.data?.funding_rates ?? [];
    const times = list.map((y) => y.time);
    const steps = [...new Set(times.slice(1).map((t, i) => (t - times[i]) / 3.6e6))].join('/');
    const past = list.filter((y) => y.time <= now);
    const future = list.filter((y) => y.time > now);
    survey.n++;
    survey.stepsHours[steps] = (survey.stepsHours[steps] ?? 0) + 1;
    survey.futureEntries[future.length] = (survey.futureEntries[future.length] ?? 0) + 1;
    if (future[0]) survey.futureTime[iso(future[0].time)] = (survey.futureTime[iso(future[0].time)] ?? 0) + 1;
    if (past.length && Number(past.at(-1).rate) === Number(cur?.funding_rate)) survey.callEqualsLastSettled++;
    if (future.length && Number(future[0].rate) === Number(cur?.funding_rate)) survey.callEqualsFuture++;
    if (steps === '4') fourHour.push(id);
    if (sample.has(id)) log('funding_vs_history', { id, stepsHours: steps, call: `${cur?.funding_rate}@${iso(cur?.funding_time)} next ${cur?.next_funding_rate}@${iso(cur?.next_funding_time)}`, historyLastThree: list.slice(-3).map((y) => `${y.rate}@${iso(y.time)}`).join(' ') });
    await sleep(250);
  }
  log('funding_history_survey', { ...survey, fourHour });
  // The upcoming entry alone, which is what a poller would call.
  for (const id of ['BTCUSDTPERP', 'XAUTUSDTPERP', 'MANAUSDTPERP']) {
    const r = await get(`funding_rate_history?instrument_id=${id}&start_timestamp=${Date.now()}&limit=1`);
    log('funding_upcoming_only', { id, status: r.status, ms: Math.round(r.ms), bytes: r.bytes, body: r.text });
    await sleep(500);
  }
  const deep = await get('funding_rate_history?instrument_id=BTCUSDTPERP&limit=100');
  const dl = deep.body?.data?.funding_rates ?? [];
  log('funding_history_default', { n: dl.length, firstTime: dl[0] && new Date(dl[0].time).toISOString(), lastTime: dl.at(-1) && new Date(dl.at(-1).time).toISOString() });

  // Is the published rate still moving before settlement: BTC every 5 s for 40 s.
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const r = await get('funding_rate?instrument_id=BTCUSDTPERP');
    seen.push(`${r.body?.data?.funding_rate}/${r.body?.data?.next_funding_rate}`);
    await sleep(5000);
  }
  log('funding_btc_40s', { distinct: [...new Set(seen)] });
}

async function book() {
  for (const limit of [1, 20, 50, 100]) {
    const r = await get(`depth?instrument_id=BTCUSDTPERP&limit=${limit}`);
    const d = r.body.data;
    const bidsDesc = d.bids.every((l, i) => i === 0 || Number(l[0]) < Number(d.bids[i - 1][0]));
    const asksAsc = d.asks.every((l, i) => i === 0 || Number(l[0]) > Number(d.asks[i - 1][0]));
    log('depth', { limit, status: r.status, ms: Math.round(r.ms), bytes: r.bytes, bids: d.bids.length, asks: d.asks.length, bidsDesc, asksAsc, priceType: typeof d.bids[0]?.[0], sizeType: typeof d.bids[0]?.[1], ageMs: Date.now() - d.timestamp, top: [d.bids[0], d.asks[0]] });
    if (limit === 20) keep('depth20.json', r.text);
    await sleep(300);
  }
  const nolimit = await get('depth?instrument_id=BTCUSDTPERP');
  log('depth_default', { bids: nolimit.body.data.bids.length, asks: nolimit.body.data.asks.length });
  // Caching: two reads 100 ms apart.
  const a = await get('depth?instrument_id=BTCUSDTPERP&limit=20');
  await sleep(100);
  const b = await get('depth?instrument_id=BTCUSDTPERP&limit=20');
  log('depth_cache', { tsA: a.body.data.timestamp, tsB: b.body.data.timestamp, sameBody: a.text === b.text, cfCache: [a.cfRay, b.cfRay] });
  // Book against the tickers best bid and ask for a few contracts.
  const t = (await get('tickers')).body.data;
  for (const id of ['BTCUSDTPERP', 'ETHUSDTPERP', 'MANAUSDTPERP', 'BTCPERP']) {
    const d = (await get(`depth?instrument_id=${id}&limit=20`)).body.data;
    const x = t.find((y) => y.instrument_id === id);
    log('depth_vs_ticker', { id, depthTop: [d.bids[0], d.asks[0]], tickerTop: [x.best_bid, x.best_bid_size, x.best_ask, x.best_ask_size], depthTs: d.timestamp, tickerTs: x.timestamp, levels: [d.bids.length, d.asks.length] });
    await sleep(300);
  }
}

const mode = process.argv[2] ?? 'main';
const modes = { main, anchor, funding, book };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(2); }
await modes[mode]();
