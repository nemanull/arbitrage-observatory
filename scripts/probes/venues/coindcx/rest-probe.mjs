// CoinDCX public REST probe: host latency, the futures catalog, instrument details and fees, the bulk current prices reply, the REST book, errors and the clock.
// It also reads Binance USD-M public endpoints beside CoinDCX, because CoinDCX futures are brokered to a third-party exchange and every pair is spelled B-<base>_USDT.
// Public, unauthenticated, read-only. At most 4 CoinDCX requests per second, against a published 16 per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coindcx/rest-probe.mjs [latency|catalog|instruments|anchor|book|errors]
//   latency      DNS, cold and warm request times for api.coindcx.com and public.coindcx.com, response headers. About 20 s.
//   catalog      active instruments per margin currency, the current prices keys and fields, the fee fields of three pairs under both margins, spot markets by ecode, and the Binance match of symbols, marks and funding, including fr against the latest and previous settlement. About 10 s.
//   instruments  instrument details for every active USDT pair at 4 per second: status, fees, funding frequency, unit value, against Binance fundingInfo. About 130 s.
//   anchor       current prices every second for 60 s, change counts per field, reply size and time, and Binance premiumIndex every 5 s for the mark match and lag. About 65 s.
//   book         REST order book at each depth, raw key order, caching, and a size compare with the Binance book read at the same moment. About 15 s.
//   errors       unknown pair, wrong margin currency, bad depth, unknown path. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/coindcx/rest.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const API = 'https://api.coindcx.com';
const PUB = 'https://public.coindcx.com';
const BN = 'https://fapi.binance.com';
const ACTIVE = (m) => `${API}/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=${m}`;
const INSTRUMENT = (p, m) => `${API}/exchange/v1/derivatives/futures/data/instrument?pair=${p}&margin_currency_short_name=${m}`;
const RT = `${PUB}/market_data/v3/current_prices/futures/rt`;
const OB = (p, d) => `${PUB}/market_data/v3/orderbook/${p}-futures/${d}`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const binanceSymbol = (pair) => pair.slice(2).replace('_', '');

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const r = await fetch(url, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await r.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, ms, bytes: text.length, text, json, headers: Object.fromEntries(r.headers), recv: Date.now() };
}

async function latency() {
  for (const host of ['api.coindcx.com', 'public.coindcx.com', 'stream.coindcx.com']) {
    const all = await lookup(host, { all: true });
    log('dns', { host, addresses: all.map((a) => a.address) });
  }
  for (const [name, url] of [['markets', `${API}/exchange/v1/markets`], ['active', ACTIVE('USDT')], ['rt', RT], ['book', OB('B-BTC_USDT', 50)]]) {
    const times = [];
    let first;
    for (let i = 0; i < 10; i++) {
      const r = await get(url);
      if (i === 0) first = r;
      times.push(r.ms);
      await sleep(300);
    }
    const h = first.headers;
    log('latency', { name, status: first.status, bytes: first.bytes, coldMs: times[0], warm: { min: Math.min(...times.slice(1)), median: q(times.slice(1), 0.5), max: Math.max(...times.slice(1)) }, server: h.server, cfCacheStatus: h['cf-cache-status'], cacheControl: h['cache-control'], age: h.age, rateHeaders: Object.keys(h).filter((k) => /rate|limit|retry/i.test(k)) });
  }
}

async function catalog() {
  const usdt = await get(ACTIVE('USDT'));
  const inr = await get(ACTIVE('INR'));
  keep('active_usdt.json', usdt.text);
  const a = usdt.json, b = inr.json;
  const setB = new Set(b);
  const quotes = {};
  for (const p of a) { const m = p.match(/^([A-Z]+)-(.+)_([A-Z0-9]+)$/); const k = m ? `${m[1]}-*_${m[3]}` : 'other'; quotes[k] = (quotes[k] || 0) + 1; }
  log('active', { usdt: a.length, inr: b.length, sameSet: a.length === b.length && a.every((p) => setB.has(p)), shapes: quotes, sample: a.slice(0, 4), ms: usdt.ms, bytes: usdt.bytes });
  const bad = await get(ACTIVE('BTC'));
  log('active_other_margin', { margin: 'BTC', status: bad.status, body: bad.text.slice(0, 120) });

  const rt = await get(RT);
  keep('rt.json', rt.text);
  const prices = rt.json.prices;
  const keys = Object.keys(prices);
  const fieldCount = {};
  for (const k of keys) for (const f of Object.keys(prices[k])) fieldCount[f] = (fieldCount[f] || 0) + 1;
  const activeSet = new Set(a);
  const inactive = keys.filter((k) => !activeSet.has(k));
  const mktMismatch = keys.filter((k) => prices[k].mkt !== undefined && prices[k].mkt !== binanceSymbol(k));
  const stale = keys.filter((k) => rt.json.ts - prices[k].bmST > 3_600_000);
  log('rt', { ts: rt.json.ts, vs: rt.json.vs, keys: keys.length, activeMissing: a.filter((p) => !prices[p]).length, inactiveKeys: inactive.length, inactiveSample: inactive.slice(0, 6), fieldCount, mktMismatch: mktMismatch.map((k) => `${k}=${prices[k].mkt}`), bmStOlderThan1h: stale.length, staleSample: stale.slice(0, 4), mpZero: keys.filter((k) => !(prices[k].mp > 0)).length, bytes: rt.bytes, ms: rt.ms });

  const bnPrem = await get(`${BN}/fapi/v1/premiumIndex`);
  const bnInfo = await get(`${BN}/fapi/v1/exchangeInfo`);
  const bm = new Map(bnPrem.json.map((x) => [x.symbol, x]));
  const perp = new Map(bnInfo.json.symbols.filter((s) => s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL').map((s) => [s.symbol, s]));
  // Binance files its commodity perpetuals under a second contract type.
  const tradfi = a.filter((p) => perp.get(binanceSymbol(p))?.contractType === 'TRADIFI_PERPETUAL');
  log('binance_tradfi', { pairs: tradfi, inBulkPremiumIndex: tradfi.filter((p) => bnPrem.json.some((x) => x.symbol === binanceSymbol(p))).length });
  let exact = 0, within1 = 0, efrEq = 0, frEq = 0, n = 0;
  const notOnBinance = [], notTrading = [];
  for (const p of a) {
    const s = binanceSymbol(p), x = bm.get(s), info = perp.get(s);
    if (!x || !info) { notOnBinance.push(p); continue; }
    if (info.status !== 'TRADING') notTrading.push(`${p}:${info.status}`);
    n++;
    const v = prices[p];
    const ppm = Math.abs(v.mp - Number(x.markPrice)) / Number(x.markPrice) * 1e6;
    if (v.mp === Number(x.markPrice)) exact++;
    if (ppm <= 1) within1++;
    if (v.efr === Number(x.lastFundingRate)) efrEq++;
    if (v.fr === Number(x.lastFundingRate)) frEq++;
  }
  const bnPerpUsdt = [...perp.values()].filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT').length; // crypto and TradFi USDT perpetuals
  log('binance_match', { compared: n, markExact: exact, markWithin1ppm: within1, efrEqualsBinanceLastFundingRate: efrEq, frEqualsBinanceLastFundingRate: frEq, notOnBinance, notTrading, binanceTradingUsdtPerps: bnPerpUsdt, gapMs: rt.recv - bnPrem.recv });

  // Every settlement of the last 9 h across all Binance symbols, in one call, keeping the latest per symbol.
  const settled = new Map();
  const history = new Map(); // every settlement per symbol in the window, to compare fr with the previous one too
  let from = Date.now() - 9 * 3_600_000, historyRows = 0;
  for (let page = 0; page < 6; page++) {
    const hist = await get(`${BN}/fapi/v1/fundingRate?startTime=${from}&limit=1000`);
    historyRows += hist.json.length;
    for (const r of hist.json) {
      if (!settled.has(r.symbol) || settled.get(r.symbol).fundingTime <= r.fundingTime) settled.set(r.symbol, r);
      (history.get(r.symbol) ?? history.set(r.symbol, []).get(r.symbol)).push(r);
    }
    if (hist.json.length < 1000) break;
    from = hist.json[hist.json.length - 1].fundingTime;
    await sleep(300);
  }
  let frSettled = 0, frCompared = 0, frPrevious = 0;
  const frOther = [];
  const minutesSince = [];
  for (const p of a) {
    const r = settled.get(binanceSymbol(p));
    if (!r) continue;
    frCompared++;
    const prev = (history.get(binanceSymbol(p)) ?? []).filter((x) => x.fundingTime < r.fundingTime).sort((x, y) => y.fundingTime - x.fundingTime)[0];
    if (prices[p].fr === Number(r.fundingRate)) frSettled++;
    else if (prev && prices[p].fr === Number(prev.fundingRate)) { frPrevious++; minutesSince.push(Math.round((rt.recv - r.fundingTime) / 60_000)); }
    else frOther.push(`${p}:${prices[p].fr}/${r.fundingRate}`);
  }
  log('fr_vs_binance_last_settled', { historyRows, compared: frCompared, equalLatest: frSettled, equalPrevious: frPrevious, minutesSinceLatestWhenPrevious: [...new Set(minutesSince)], neither: frOther.length, neitherSample: frOther.slice(0, 6) });

  const sample = ['B-BTC_USDT', 'B-ETH_USDT', 'B-SOL_USDT'];
  for (const p of sample) {
    const h = await get(`${BN}/fapi/v1/fundingRate?symbol=${binanceSymbol(p)}&limit=2`);
    const x = bm.get(binanceSymbol(p));
    log('funding_compare', { pair: p, dcx_fr: prices[p].fr, dcx_efr: prices[p].efr, bn_lastFundingRate: x.lastFundingRate, bn_nextFundingTime: x.nextFundingTime, bn_lastSettled: h.json.map((r) => [r.fundingTime, r.fundingRate]) });
  }

  // The fee fields of three pairs under each margin currency, since the list is the same contract ids.
  for (const p of ['B-BTC_USDT', 'B-ETH_USDT', 'B-DOGE_USDT']) {
    const fees = {};
    for (const m of ['USDT', 'INR']) {
      const i = (await get(INSTRUMENT(p, m))).json.instrument;
      fees[m] = { pair: i.pair, margin: i.margin_currency_short_name, maker: i.maker_fee, taker: i.taker_fee, funding: i.funding_frequency };
      await sleep(250);
    }
    log('fees_by_margin', { pair: p, ...fees });
  }

  const md = await get(`${API}/exchange/v1/markets_details`);
  const byEcode = {};
  for (const m of md.json) { const k = `${m.ecode}:${m.status}`; byEcode[k] = (byEcode[k] || 0) + 1; }
  log('spot_markets', { total: md.json.length, byEcodeStatus: byEcode, bytes: md.bytes });
}

async function instruments() {
  const a = (await get(ACTIVE('USDT'))).json;
  const info = await get(`${BN}/fapi/v1/fundingInfo`);
  const bnInterval = new Map(info.json.map((x) => [x.symbol, x.fundingIntervalHours]));
  const tally = { status: {}, kind: {}, maker: {}, taker: {}, freq: {}, ucv: {}, qtsm: {}, settle: {}, liq: {}, exitOnly: {} };
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const freqMismatch = [];
  const byFee = {}, exitOnly = [], byFreq = { 1: [], 8: [] };
  const errors = [];
  const times = [];
  for (const p of a) {
    const r = await get(INSTRUMENT(p, 'USDT'));
    times.push(r.ms);
    const i = r.json?.instrument;
    if (!i) { errors.push(`${p}:${r.status}`); await sleep(250); continue; }
    inc(tally.status, i.status); inc(tally.kind, i.kind); inc(tally.maker, i.maker_fee); inc(tally.taker, i.taker_fee);
    inc(tally.freq, i.funding_frequency); inc(tally.ucv, i.unit_contract_value); inc(tally.qtsm, i.quanto_to_settle_multiplier);
    inc(tally.settle, i.settle_currency_short_name); inc(tally.liq, i.liquidation_fee); inc(tally.exitOnly, i.exit_only);
    const fee = `${i.maker_fee}/${i.taker_fee}`;
    if (fee !== '0.0236/0.059') (byFee[fee] ??= []).push(p);
    if (i.exit_only) exitOnly.push(p);
    if (byFreq[i.funding_frequency]) byFreq[i.funding_frequency].push(p);
    const bnH = bnInterval.get(binanceSymbol(p)) ?? 8;
    if (bnH !== i.funding_frequency) freqMismatch.push(`${p}:dcx${i.funding_frequency}/bn${bnH}`);
    await sleep(250);
  }
  log('instruments', { pairs: a.length, errors, ...tally, fundingFrequencyVsBinance: { mismatches: freqMismatch.length, sample: freqMismatch.slice(0, 12) }, pairsOffTheCommonFee: byFee, exitOnly, hourly: byFreq[1], eightHourlyCount: byFreq[8].length, eightHourlySample: byFreq[8].slice(0, 8), ms: { median: q(times, 0.5), max: Math.max(...times) } });
}

async function anchor() {
  const active = new Set((await get(ACTIVE('USDT'))).json);
  const relay = [], build = [], age = [], btcBmStep = [];
  let btcBm;
  const last = new Map();
  const changes = { mp: 0, fr: 0, efr: 0, ls: 0 };
  const perPair = new Map();
  const times = [], sizes = [], tsLag = [], vsSteps = [];
  let prevVs;
  const markCompare = [];
  for (let i = 0; i < 60; i++) {
    const t = Date.now();
    const r = await get(RT);
    times.push(r.ms); sizes.push(r.bytes); tsLag.push(r.recv - r.json.ts);
    if (prevVs !== undefined) vsSteps.push(r.json.vs - prevVs);
    prevVs = r.json.vs;
    const btc = r.json.prices['B-BTC_USDT'];
    if (btcBm !== undefined) btcBmStep.push(btc.bmST - btcBm);
    btcBm = btc.bmST;
    const rel = [], bld = [], ag = [];
    for (const [k, v] of Object.entries(r.json.prices)) {
      if (!active.has(k)) continue;
      rel.push(v.cmRT - v.bmST); bld.push(r.json.ts - v.cmRT); ag.push(r.recv - v.bmST);
    }
    relay.push(q(rel, 0.5)); build.push(q(bld, 0.5)); age.push(q(ag, 0.5));
    for (const [k, v] of Object.entries(r.json.prices)) {
      if (!active.has(k)) continue;
      const old = last.get(k);
      if (old) for (const f of Object.keys(changes)) if (old[f] !== v[f]) { changes[f]++; const c = perPair.get(k) ?? {}; c[f] = (c[f] ?? 0) + 1; perPair.set(k, c); }
      last.set(k, v);
    }
    if (i % 5 === 0) {
      const b = await get(`${BN}/fapi/v1/premiumIndex`);
      const bm = new Map(b.json.map((x) => [x.symbol, x]));
      let exact = 0, n = 0, dcxNewer = 0, bnNewer = 0;
      for (const [k, v] of Object.entries(r.json.prices)) {
        if (!active.has(k)) continue;
        const x = bm.get(binanceSymbol(k));
        if (!x || !(v.mp > 0)) continue;
        n++;
        if (v.mp === Number(x.markPrice)) exact++;
        else if (v.bmST > x.time) dcxNewer++;
        else bnNewer++;
      }
      markCompare.push({ i, compared: n, exact, dcxBmStNewer: dcxNewer, binanceNewer: bnNewer, bnMinusDcxMs: b.recv - r.recv });
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  const pick = ['B-BTC_USDT', 'B-ETH_USDT', 'B-DOGE_USDT', 'B-CHR_USDT'];
  log('anchor_polls', { polls: 60, ms: { min: Math.min(...times), median: q(times, 0.5), p90: q(times, 0.9), max: Math.max(...times) }, bytes: { min: Math.min(...sizes), max: Math.max(...sizes) }, recvMinusTsMs: { min: Math.min(...tsLag), median: q(tsLag, 0.5), max: Math.max(...tsLag) }, vsStep: { min: Math.min(...vsSteps), median: q(vsSteps, 0.5), max: Math.max(...vsSteps) } });
  log('anchor_changes', { totalOver59Intervals: changes, pairs: last.size, sample: Object.fromEntries(pick.map((p) => [p, perPair.get(p) ?? {}])), mpChangesPerPair: { median: q([...last.keys()].map((k) => perPair.get(k)?.mp ?? 0), 0.5), max: Math.max(...[...last.keys()].map((k) => perPair.get(k)?.mp ?? 0)) } });
  log('anchor_relay', { note: 'per poll medians over active pairs, then min/median/max over polls', cmRtMinusBmStMs: [Math.min(...relay), q(relay, 0.5), Math.max(...relay)], tsMinusCmRtMs: [Math.min(...build), q(build, 0.5), Math.max(...build)], recvMinusBmStMs: [Math.min(...age), q(age, 0.5), Math.max(...age)], btcBmStStepMs: { zero: btcBmStep.filter((x) => x === 0).length, min: Math.min(...btcBmStep.filter((x) => x > 0)), median: q(btcBmStep, 0.5), max: Math.max(...btcBmStep) } });
  for (const m of markCompare) log('mark_vs_binance', m);
}

async function book() {
  for (const d of [10, 20, 50]) {
    const r = await get(OB('B-ETH_USDT', d));
    const bidKeys = [...r.text.matchAll(/"bids":\{([^}]*)\}/g)][0]?.[1].match(/"([0-9.]+)":/g)?.map((s) => s.slice(1, -2)) ?? [];
    const askKeys = [...r.text.matchAll(/"asks":\{([^}]*)\}/g)][0]?.[1].match(/"([0-9.]+)":/g)?.map((s) => s.slice(1, -2)) ?? [];
    const isSorted = (arr, dir) => arr.every((x, i) => i === 0 || (dir * (Number(x) - Number(arr[i - 1]))) > 0);
    log('rest_book', { depth: d, status: r.status, ms: r.ms, bytes: r.bytes, bids: bidKeys.length, asks: askKeys.length, rawBidOrderAscending: isSorted(bidKeys, 1), rawBidOrderDescending: isSorted(bidKeys, -1), rawAskOrderAscending: isSorted(askKeys, 1), firstBidKeys: bidKeys.slice(0, 3), firstAskKeys: askKeys.slice(0, 3), ts: r.json?.ts, vs: r.json?.vs, recvMinusTs: r.recv - r.json?.ts, keys: Object.keys(r.json ?? {}) });
    await sleep(300);
  }
  const other = await get(OB('B-ETH_USDT', 100));
  log('rest_book_depth100', { status: other.status, body: other.text.slice(0, 120) });
  const vs = [];
  for (let i = 0; i < 6; i++) { const r = await get(OB('B-BTC_USDT', 50)); vs.push([r.json.vs, r.json.ts, r.recv - r.json.ts, r.headers['cf-cache-status'] ?? '', r.headers.age ?? '']); await sleep(250); }
  log('rest_book_repeat', { note: 'vs, ts, recv minus ts, cf-cache-status, age, 250 ms apart', rows: vs });
  for (const s of ['ETH', 'DOGE']) {
    const [d, b] = await Promise.all([get(OB(`B-${s}_USDT`, 50)), get(`${BN}/fapi/v1/depth?symbol=${s}USDT&limit=50`)]);
    const bb = new Map(b.json.bids.map(([p, qty]) => [Number(p), Number(qty)]));
    const dbids = Object.entries(d.json.bids).map(([p, qty]) => [Number(p), Number(qty)]).sort((x, y) => y[0] - x[0]).slice(0, 20);
    const samePrice = dbids.filter(([p]) => bb.has(p)).length;
    const sameSize = dbids.filter(([p, qty]) => bb.get(p) === qty).length;
    log('rest_book_vs_binance', { pair: `B-${s}_USDT`, top20Bids: dbids.length, pricesOnBinance: samePrice, sizesEqual: sameSize, dcxTop: dbids[0], bnTop: b.json.bids[0], dcxTs: d.json.ts, bnE: b.json.E });
  }
}

async function errors() {
  const cases = [
    ['instrument unknown pair', INSTRUMENT('B-NOPE_USDT', 'USDT')],
    ['instrument binance spelling', INSTRUMENT('BTCUSDT', 'USDT')],
    ['instrument margin BTC', INSTRUMENT('B-BTC_USDT', 'BTC')],
    ['instrument no margin', `${API}/exchange/v1/derivatives/futures/data/instrument?pair=B-BTC_USDT`],
    ['orderbook unknown pair', OB('B-NOPE_USDT', 50)],
    ['orderbook depth 30', OB('B-BTC_USDT', 30)],
    ['trades unknown pair', `${API}/exchange/v1/derivatives/futures/data/trades?pair=B-NOPE_USDT`],
    ['unknown path', `${API}/exchange/v1/derivatives/futures/data/nope`],
    ['time guess', `${API}/api/v1/time`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, contentType: r.headers['content-type'], body: r.text.slice(0, 160).replace(/\s+/g, ' ') });
    await sleep(300);
  }
  const r = await get(RT);
  const local = Date.now();
  log('clock', { dateHeader: r.headers.date, headerMinusLocalMs: Date.parse(r.headers.date) - local, rtTs: r.json.ts, recvMinusRtTsMs: r.recv - r.json.ts });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { latency, catalog, instruments, anchor, book, errors };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
