// XT.COM futures REST probe: host latency and clock, the CCXT catalog against the raw symbol list, the bulk anchor calls, one minute of one second anchor polls, the REST book, and error and rate limit shapes.
// Public, unauthenticated and read-only. It never sends more than three requests a second, under the documented 10 per second and 1,000 per minute per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/xt/rest-probe.mjs [host|catalog|anchor|poll|book|errors]
//   host     DNS, cold and warm request time, and the server clock offset on fapi.xt.com and dapi.xt.com, about 15 s
//   catalog  CCXT 4.5.68 loadMarkets for xt against the raw USDT-M and coin-M symbol lists, about 20 s
//   anchor   every bulk call once per family: size, time, rows, fields, coverage, index and mark cross-checks, the mark against last trade and index, stale rows, plates, funding cross-checks, about 25 s
//   poll     60 one second polls of cg/contracts, mark-price and index-price on USDT-M, with change counts per contract, about 75 s
//   book     REST depth levels, level order, update id and caching, about 10 s
//   errors   unknown symbols, unknown paths, missing parameters and the rate limit headers, about 10 s
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/xt/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const FAPI = 'https://fapi.xt.com/future/market';
const DAPI = 'https://dapi.xt.com/future/market';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};
const stats = (arr) => ({ n: arr.length, min: Math.min(...arr), median: pct(arr, 0.5), p90: pct(arr, 0.9), max: Math.max(...arr) });
const round = (x) => Math.round(x);

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
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const headers = Object.fromEntries([...res.headers].filter(([k]) => /ratelimit|retry-after|x-cache|x-amz-cf-pop|age|cache-control/i.test(k)));
  return { status: res.status, ms, bytes: text.length, json, text, headers };
}

async function host() {
  for (const h of ['fapi.xt.com', 'dapi.xt.com', 'fstream.xt.com', 'dstream.xt.com']) {
    try {
      const a = await lookup(h, { all: true });
      log('dns', { host: h, addresses: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host: h, error: e.code });
    }
  }
  for (const base of [FAPI, DAPI]) {
    const times = [];
    const offsets = [];
    for (let i = 0; i < 11; i++) {
      const before = Date.now();
      const r = await get(`${base}/v1/public/time`);
      const after = Date.now();
      times.push(round(r.ms));
      if (typeof r.json?.result === 'number') offsets.push(r.json.result - (before + after) / 2);
      if (i === 0) log('time_reply', { base, status: r.status, body: r.text.slice(0, 200) });
      await sleep(400);
    }
    log('latency', { base, cold_ms: times[0], warm: stats(times.slice(1)), clock_offset_ms: stats(offsets.map(round)) });
  }
}

async function catalog() {
  const t0 = performance.now();
  const ex = new ccxt.xt();
  const markets = await ex.loadMarkets();
  log('ccxt_load', { ms: round(performance.now() - t0), markets: Object.keys(markets).length });
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.type === 'swap' && m.swap === true);
  const engine = swaps.filter((m) => m.active !== false);
  const bySettle = {};
  for (const m of swaps) {
    const k = `${m.settle} linear=${m.linear} active=${m.active}`;
    bySettle[k] = (bySettle[k] ?? 0) + 1;
  }
  log('ccxt_swaps', { swaps: swaps.length, engine_catalog: engine.length, bySettle });
  const futures = all.filter((m) => m.type === 'future');
  log('ccxt_futures', { futures: futures.length, active: futures.filter((m) => m.active).length, spot: all.filter((m) => m.type === 'spot').length });
  const count = (arr, f) => arr.reduce((acc, m) => ((acc[f(m)] = (acc[f(m)] ?? 0) + 1), acc), {});
  log('ccxt_taker_ppm', { engine: count(engine, (m) => (typeof m.taker === 'number' ? round(m.taker * 1e6) : String(m.taker))) });
  log('ccxt_maker_ppm', { engine: count(engine, (m) => (typeof m.maker === 'number' ? round(m.maker * 1e6) : String(m.maker))) });
  log('ccxt_contract_size', { engine: count(engine, (m) => String(m.contractSize)) });
  const btc = markets['BTC/USDT:USDT'];
  const btcUsd = markets['BTC/USD:BTC'];
  log('ccxt_btc', { id: btc?.id, taker: btc?.taker, maker: btc?.maker, contractSize: btc?.contractSize, linear: btc?.linear, active: btc?.active });
  log('ccxt_btc_usd', { id: btcUsd?.id, taker: btcUsd?.taker, contractSize: btcUsd?.contractSize, linear: btcUsd?.linear, active: btcUsd?.active });

  // What the raw list says about the markets the engine would load.
  const raw = new Map();
  for (const base of [FAPI, DAPI]) {
    const r = await get(`${base}/v1/public/symbol/list`);
    log('symbol_list', { base, status: r.status, bytes: r.bytes, ms: round(r.ms), rows: r.json?.result?.length });
    for (const x of r.json?.result ?? []) raw.set(x.symbol, x);
  }
  const notTrading = engine.filter((m) => raw.get(m.id)?.tradeSwitch !== true);
  log('engine_not_trading', { count: notTrading.length, sample: notTrading.slice(0, 12).map((m) => m.id) });
  const rawTradingPerps = [...raw.values()].filter((x) => x.productType === 'perpetual' && x.tradeSwitch === true);
  const hidden = rawTradingPerps.filter((x) => x.isOpenApi !== true);
  log('trading_not_openapi', { count: hidden.length, of: rawTradingPerps.length, sample: hidden.slice(0, 15).map((x) => x.symbol) });

  // Pairs the quote family would see twice: BTC/USDT:USDT and BTC/USD:BTC share base BTC.
  const byBase = {};
  for (const m of engine) (byBase[m.base] ??= []).push(m.symbol);
  const twice = Object.entries(byBase).filter(([, v]) => v.length > 1);
  log('base_listed_twice', { count: twice.length, sample: twice.slice(0, 6) });
  const scaled = engine.filter((m) => /^[0-9]/.test(m.base));
  log('numeric_prefix_bases', { count: scaled.length, sample: scaled.map((m) => `${m.id} cs=${m.contractSize}`) });
  // Raw counts per family: product type, trading switch and Open API flag.
  for (const [name, host] of [['usdtm', 'fapi'], ['coinm', 'dapi']]) {
    const rows = [...raw.values()].filter((x) => (host === 'fapi' ? x.underlyingType === 'U_BASED' : x.underlyingType === 'COIN_BASED'));
    const c = {};
    for (const x of rows) {
      const k = `${x.productType} trade=${x.tradeSwitch} api=${x.isOpenApi}`;
      c[k] = (c[k] ?? 0) + 1;
    }
    const cs = {};
    for (const x of rows.filter((r) => r.productType === 'perpetual' && r.tradeSwitch && r.isOpenApi)) cs[x.contractSize] = (cs[x.contractSize] ?? 0) + 1;
    log('raw_counts', { family: name, rows: rows.length, c, tradable_perp_contract_size: cs });
  }
  const odd = engine.filter((m) => !/^[a-z0-9]+_(usdt|usd)$/.test(m.id));
  log('odd_ids', { count: odd.length, sample: odd.slice(0, 10).map((m) => `${m.id} ${m.symbol}`) });
  // Unit check: 24 h volume a is in contracts when a times contractSize times last price matches the 24 h turnover v.
  const tick = (await get(`${FAPI}/v1/public/q/tickers`)).json.result;
  const ratios = [];
  for (const t of tick) {
    const m = engine.find((x) => x.id === t.s);
    const notional = Number(t.a) * (m?.contractSize ?? NaN) * Number(t.c);
    if (m && Number(t.v) > 1000 && notional > 0) ratios.push(Number(t.v) / notional);
  }
  log('volume_unit_check', { contracts: ratios.length, within_10pct_of_1: ratios.filter((r) => Math.abs(r - 1) < 0.1).length, within_30pct: ratios.filter((r) => Math.abs(r - 1) < 0.3).length, ratio: stats(ratios.map((r) => +r.toFixed(3))) });
  const cased = engine.filter((m) => m.base !== m.base.toUpperCase() || /[^\x00-\x7f]/.test(m.id));
  log('non_ascii_or_lower_base', { count: cased.length, sample: cased.slice(0, 10).map((m) => `${m.id} ${m.base}`) });
}

function indexBy(rows, key) {
  const m = new Map();
  for (const r of rows ?? []) m.set(r[key], r);
  return m;
}

async function anchor() {
  const listRes = await get(`${FAPI}/v1/public/symbol/list`);
  const trading = listRes.json.result.filter((x) => x.productType === 'perpetual' && x.tradeSwitch === true && x.isOpenApi === true);
  const tradingIds = new Set(trading.map((x) => x.symbol));
  log('trading_openapi_perps', { usdtm: trading.length });
  const calls = ['v1/public/cg/contracts', 'v1/public/q/mark-price', 'v1/public/q/index-price', 'v1/public/q/agg-tickers', 'v1/public/q/tickers'];
  const replies = {};
  const arrivedAt = {};
  for (const base of [FAPI, DAPI]) {
    for (const c of calls) {
      const r = await get(`${base}/${c}`);
      const rows = Array.isArray(r.json) ? r.json : r.json?.result;
      keep(`${base.includes('fapi') ? 'fapi' : 'dapi'}_${c.replace(/\//g, '_')}.json`, r.text);
      const first = Array.isArray(rows) ? rows.find((x) => (x.symbol ?? x.s) === 'btc_usdt' || (x.symbol ?? x.s) === 'btc_usd') ?? rows[0] : null;
      log('bulk', { base, call: c, status: r.status, ms: round(r.ms), bytes: r.bytes, rows: rows?.length, headers: r.headers, sample: first });
      if (base === FAPI) {
        replies[c] = rows;
        arrivedAt[c] = Date.now();
      }
      await sleep(400);
    }
  }
  const cg = indexBy(replies['v1/public/cg/contracts'], 'symbol');
  const mark = indexBy(replies['v1/public/q/mark-price'], 's');
  const index = indexBy(replies['v1/public/q/index-price'], 's');
  const agg = indexBy(replies['v1/public/q/agg-tickers'], 's');
  const missing = (m) => [...tradingIds].filter((id) => !m.has(id));
  log('coverage', {
    cg: cg.size, cg_missing: missing(cg).slice(0, 10), cg_missing_n: missing(cg).length,
    mark: mark.size, mark_missing_n: missing(mark).length, index: index.size, index_missing_n: missing(index).length,
    agg: agg.size, agg_missing_n: missing(agg).length,
    cg_extra: [...cg.keys()].filter((k) => !tradingIds.has(k)).slice(0, 10),
  });
  const cgRows = [...cg.values()];
  const count = (arr, f) => arr.reduce((acc, m) => ((acc[f(m)] = (acc[f(m)] ?? 0) + 1), acc), {});
  log('cg_fields', {
    product_type: count(cgRows, (x) => x.product_type), underlyingType: count(cgRows, (x) => x.underlyingType),
    collection_internal: count(cgRows, (x) => x.collection_internal),
    next_ts: count(cgRows, (x) => new Date(x.next_funding_rate_timestamp).toISOString().slice(11, 16)),
    funding_eq_next: cgRows.filter((x) => x.funding_rate === x.next_funding_rate).length,
    index_zero: cgRows.filter((x) => !(Number(x.index_price) > 0)).length,
    contractSize: count(cgRows, (x) => x.contractSize),
  });
  const absRates = cgRows.map((x) => Math.abs(Number(x.funding_rate))).sort((a, b) => b - a);
  log('funding_extremes', { top: cgRows.filter((x) => Math.abs(Number(x.funding_rate)) >= absRates[5]).map((x) => `${x.symbol} ${x.funding_rate} ${x.collection_internal}h`), equal_to_0_0003: cgRows.filter((x) => Math.abs(Number(x.funding_rate)) === 0.003).length });
  const markRows = [...mark.values()];
  log('mark_fields', {
    zero: markRows.filter((x) => !(Number(x.p) > 0)).length,
    p_type: count(markRows, (x) => typeof x.p), t_age_at_arrival_ms: stats(markRows.map((x) => arrivedAt['v1/public/q/mark-price'] - x.t)),
  });
  const indexRows = [...index.values()];
  log('index_fields', { zero: indexRows.filter((x) => !(Number(x.p) > 0)).length, p_type: count(indexRows, (x) => typeof x.p), t_age_at_arrival_ms: stats(indexRows.map((x) => arrivedAt['v1/public/q/index-price'] - x.t)) });
  // cg index against the index call, and agg-tickers mark and index against the dedicated calls.
  let cgIdxEq = 0, aggMarkEq = 0, aggIdxEq = 0, n = 0;
  const cgIdxDiff = [];
  for (const id of tradingIds) {
    const c = cg.get(id), i = index.get(id), m = mark.get(id), a = agg.get(id);
    if (!c || !i || !m || !a) continue;
    n++;
    if (Number(c.index_price) === Number(i.p)) cgIdxEq++;
    else cgIdxDiff.push(Math.abs(Number(c.index_price) / Number(i.p) - 1) * 1e6);
    if (Number(a.m) === Number(m.p)) aggMarkEq++;
    if (Number(a.i) === Number(i.p)) aggIdxEq++;
  }
  log('cross_check', { n, cg_index_eq_index_call: cgIdxEq, cg_index_diff_ppm: cgIdxDiff.length ? stats(cgIdxDiff.map(round)) : null, agg_mark_eq_mark_call: aggMarkEq, agg_index_eq_index_call: aggIdxEq });
  // The mark against the last trade, the touch and the index, from one agg-tickers reply.
  const aggRows = [...tradingIds].map((id) => agg.get(id)).filter(Boolean);
  const premium = aggRows.filter((x) => Number(x.i) > 0).map((x) => ({ s: x.s, ppm: (Number(x.m) / Number(x.i) - 1) * 1e6, m: x.m, i: x.i }));
  const absPpm = premium.map((x) => Math.abs(x.ppm));
  log('mark_shape', {
    contracts: aggRows.length, mark_eq_last: aggRows.filter((x) => Number(x.m) === Number(x.c)).length,
    mark_inside_touch: aggRows.filter((x) => Number(x.m) >= Number(x.bp) && Number(x.m) <= Number(x.ap)).length,
    missing_bid: aggRows.filter((x) => !(Number(x.bp) > 0)).length, missing_ask: aggRows.filter((x) => !(Number(x.ap) > 0)).length,
    abs_mark_vs_index_ppm: { median: round(pct(absPpm, 0.5)), p90: round(pct(absPpm, 0.9)), p99: round(pct(absPpm, 0.99)), max: round(Math.max(...absPpm)) },
    over_1pct: premium.filter((x) => Math.abs(x.ppm) > 10000).map((x) => `${x.s} m=${x.m} i=${x.i} ${round(x.ppm)}ppm`),
  });
  const staleMark = markRows.filter((x) => arrivedAt['v1/public/q/mark-price'] - x.t > 5000).map((x) => `${x.s} ${round((arrivedAt['v1/public/q/mark-price'] - x.t) / 1000)}s`);
  log('stale_t_over_5s', { mark: staleMark, index_missing: [...tradingIds].filter((id) => !index.has(id)), mark_missing: [...tradingIds].filter((id) => !mark.has(id)), cg_null_interval: cgRows.filter((x) => x.collection_internal == null).map((x) => x.symbol) });
  const plates = (await get(`${FAPI}/v1/public/plate/list`)).json.result;
  const plateName = new Map(plates.map((p) => [p.id, p.plate.trim()]));
  const perPlate = {};
  for (const x of trading) for (const id of x.plates ?? []) perPlate[plateName.get(id) ?? id] = (perPlate[plateName.get(id) ?? id] ?? 0) + 1;
  log('plates', { perPlate });
  // Per contract funding call against the cg row, for a few contracts spread over the list.
  const sample = ['btc_usdt', 'eth_usdt', 'sol_usdt', ...trading.filter((_, i) => i % 150 === 75).map((x) => x.symbol)];
  for (const s of sample) {
    const r = await get(`${FAPI}/v1/public/q/funding-rate?symbol=${s}`);
    const c = cg.get(s);
    log('funding_call', { symbol: s, status: r.status, ms: round(r.ms), result: r.json?.result, cg_funding: c?.funding_rate, cg_next: c?.next_funding_rate, cg_next_ts: c?.next_funding_rate_timestamp, cg_interval: c?.collection_internal, headers: r.headers });
    await sleep(1100);
  }
  // The settled history: is the published rate the one that will be charged next?
  for (const s of ['btc_usdt', sample[3]]) {
    const r = await get(`${FAPI}/v1/public/q/funding-rate-record?symbol=${s}&limit=4`);
    log('funding_record', { symbol: s, status: r.status, items: r.json?.result?.items?.map((x) => ({ ...x, at: new Date(x.createdTime).toISOString() })) });
    await sleep(1100);
  }
  const r = await get(`${DAPI}/v1/public/q/funding-rate?symbol=btc_usd`);
  log('funding_call_coinm', { status: r.status, result: r.json?.result });
}

async function poll() {
  const ids = ['btc_usdt', 'eth_usdt', 'sol_usdt', 'doge_usdt', 'xt_usdt'];
  const listRes = await get(`${FAPI}/v1/public/symbol/list`);
  const trading = listRes.json.result.filter((x) => x.productType === 'perpetual' && x.tradeSwitch === true && x.isOpenApi === true).map((x) => x.symbol);
  const quiet = trading.filter((_, i) => i % 100 === 50).slice(0, 5);
  ids.push(...quiet);
  const calls = { cg: 'v1/public/cg/contracts', mark: 'v1/public/q/mark-price', index: 'v1/public/q/index-price' };
  const ms = { cg: [], mark: [], index: [] };
  const prev = {};
  const changes = {};
  const tAdvance = { mark: 0, index: 0 };
  let cgIndexEq = 0, cgIndexN = 0, allChanged = { cgIndex: 0, cgFunding: 0, mark: 0, index: 0 }, rounds = 0;
  const lastAll = {};
  const age = { mark: [], index: [] };
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    const rows = {};
    await Promise.all(Object.entries(calls).map(async ([k, c]) => {
      const r = await get(`${FAPI}/${c}`);
      ms[k].push(round(r.ms));
      rows[k] = r.json?.result ?? r.json;
    }));
    rounds++;
    const arrived = Date.now();
    for (const k of ['mark', 'index']) {
      const ts = (rows[k] ?? []).map((x) => arrived - x.t);
      age[k].push(pct(ts, 0.5));
    }
    const cg = indexBy(rows.cg, 'symbol');
    const mark = indexBy(rows.mark, 's');
    const index = indexBy(rows.index, 's');
    for (const id of trading) {
      const cur = { cgIndex: cg.get(id)?.index_price, cgFunding: cg.get(id)?.funding_rate, mark: mark.get(id)?.p, index: index.get(id)?.p };
      const was = lastAll[id];
      if (was) for (const k of Object.keys(cur)) if (String(cur[k]) !== String(was[k])) allChanged[k]++;
      lastAll[id] = cur;
      if (cg.get(id) && index.get(id)) {
        cgIndexN++;
        if (Number(cg.get(id).index_price) === Number(index.get(id).p)) cgIndexEq++;
      }
    }
    for (const id of ids) {
      const cur = { cgIndex: cg.get(id)?.index_price, cgFunding: cg.get(id)?.funding_rate, cgNext: cg.get(id)?.next_funding_rate, mark: mark.get(id)?.p, index: index.get(id)?.p, markT: mark.get(id)?.t, indexT: index.get(id)?.t };
      const p = prev[id];
      changes[id] ??= { cgIndex: 0, cgFunding: 0, cgNext: 0, mark: 0, index: 0, markT: 0, indexT: 0 };
      if (p) for (const k of Object.keys(changes[id])) if (String(cur[k]) !== String(p[k])) changes[id][k]++;
      prev[id] = cur;
    }
    const wait = 1000 - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log('poll_t_age_ms', { note: 'arrival minus t, the median over contracts of each poll, then spread over polls', mark: stats(age.mark), index: stats(age.index) });
  log('poll_latency', { cg: stats(ms.cg), mark: stats(ms.mark), index: stats(ms.index), over_1s: { cg: ms.cg.filter((x) => x > 1000).length, mark: ms.mark.filter((x) => x > 1000).length, index: ms.index.filter((x) => x > 1000).length } });
  for (const id of ids) log('poll_changes', { id, of: rounds - 1, ...changes[id] });
  const pairs = (rounds - 1) * trading.length;
  log('poll_changes_all', { contracts: trading.length, pairs, ...allChanged, cg_index_eq_index_call: `${cgIndexEq} of ${cgIndexN}` });
}

async function book() {
  for (const level of [5, 20, 50, 100, 500, 1000]) {
    const r = await get(`${FAPI}/v1/public/q/depth?symbol=btc_usdt&level=${level}`);
    const x = r.json?.result;
    const desc = (a) => a.every((v, i) => i === 0 || Number(a[i - 1][0]) > Number(v[0]));
    const asc = (a) => a.every((v, i) => i === 0 || Number(a[i - 1][0]) < Number(v[0]));
    log('depth', { level, status: r.status, ms: round(r.ms), bytes: r.bytes, keys: x ? Object.keys(x) : r.json, bids: x?.b?.length, asks: x?.a?.length, bids_desc: x?.b ? desc(x.b) : null, asks_asc: x?.a ? asc(x.a) : null, id: x?.u, t: x?.t, age_ms: x?.t ? Date.now() - x.t : null, top: x ? { b: x.b?.[0], a: x.a?.[0] } : null, headers: r.headers });
    await sleep(400);
  }
  const a = await get(`${FAPI}/v1/public/q/depth?symbol=btc_usdt&level=20`);
  const b = await get(`${FAPI}/v1/public/q/depth?symbol=btc_usdt&level=20`);
  log('depth_twice', { same_body: a.text === b.text, u: [a.json?.result?.u, b.json?.result?.u], t: [a.json?.result?.t, b.json?.result?.t] });
  const c = await get(`${DAPI}/v1/public/q/depth?symbol=btc_usd&level=20`);
  log('depth_coinm', { status: c.status, bids: c.json?.result?.b?.length, top: { b: c.json?.result?.b?.[0], a: c.json?.result?.a?.[0] }, u: c.json?.result?.u });
}

async function errors() {
  const tries = [
    `${FAPI}/v1/public/q/depth?symbol=nope_usdt&level=20`,
    `${FAPI}/v1/public/q/depth?symbol=btc_usdt&level=7`,
    `${FAPI}/v1/public/q/depth?symbol=btc_usdt`,
    `${FAPI}/v1/public/q/funding-rate?symbol=nope_usdt`,
    `${FAPI}/v1/public/q/funding-rate?symbol=ftt_usdt`,
    `${FAPI}/v1/public/q/symbol-mark-price?symbol=ftt_usdt`,
    `${FAPI}/v1/public/q/nope`,
    `${DAPI}/v1/public/q/funding-rate?symbol=btc_usdt`,
  ];
  for (const u of tries) {
    const r = await get(u);
    log('error_shape', { url: u.replace(/^https:\/\//, ''), status: r.status, ms: round(r.ms), body: r.text.slice(0, 240), headers: r.headers });
    await sleep(400);
  }
}

const mode = process.argv[2] ?? 'host';
const modes = { host, catalog, anchor, poll, book, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
