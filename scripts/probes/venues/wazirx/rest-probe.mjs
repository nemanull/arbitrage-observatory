// WazirX public REST probe: latency and clock, the futures and spot catalogs, the bulk anchor call, depth snapshots, error shapes, and every futures reading next to Binance USD-M at the same instant.
// Public, unauthenticated, read-only. WazirX publishes 60 requests per minute per futures endpoint, so no mode sends more than 45 calls to one endpoint in a minute.
// The public limit is tighter than the published one: 53 premiumIndex calls in 3 min 19 s drew code 2136 on 2026-09-23, so leave a few minutes between the anchor mode and any other mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/wazirx/rest-probe.mjs [latency|catalog|anchor|book|funding|errors]
//   latency  DNS, 5 cold and 10 warm /fapi/v1/time calls, 3 bulk premiumIndex calls, clock offset. About 15 s.
//   catalog  futures exchangeInfo, premiumIndex and ticker/24hr, spot exchangeInfo, the CCXT 4.5.68 exchange list, and each futures row against Binance USD-M. About 10 s.
//   anchor   the bulk premiumIndex every 2 s for 45 polls, with Binance premiumIndex read beside it, and how often each number changed. About 95 s.
//   book     depth for four contracts next to Binance depth, the price grid, size by rank, the limit parameter, and 15 repeat reads for caching. About 40 s.
//   funding  the published rate against Binance's predicted rate and its last three settlements, and INR twins against USDT twins. About 5 s.
//   errors   unknown symbol, missing symbol, unknown path and the undocumented Binance paths. About 10 s.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/wazirx/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.wazirx.com';
const BINANCE = 'https://fapi.binance.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const stats = (xs) => ({ n: xs.length, min: round(quantile(xs, 0)), median: round(quantile(xs, 0.5)), p90: round(quantile(xs, 0.9)), max: round(quantile(xs, 1)) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });

// Raw GET so the cold path really opens a new TLS connection and the headers stay visible.
function get(url, { agent = warmAgent } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let ttfb = null;
    const req = https.get(url, { agent, headers: { 'user-agent': 'observatory-probe' } }, (res) => {
      ttfb = performance.now() - t0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, bytes: Buffer.byteLength(body), ms: performance.now() - t0, ttfb, at: Date.now() });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

async function getJson(url, opts) {
  const r = await get(url, opts);
  let json = null;
  try {
    json = JSON.parse(r.body);
  } catch {
    // an HTML refusal stays in r.body
  }
  return { ...r, json };
}

async function latency() {
  for (const host of ['api.wazirx.com', 'fstreamx.wazirx.com', 'stream.wazirx.com']) {
    const t0 = performance.now();
    const addrs = await lookup(host, { all: true });
    log('dns', { host, ms: round(performance.now() - t0), addrs: addrs.map((a) => a.address) });
  }
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const agent = new https.Agent({ keepAlive: false });
    const r = await get(`${API}/fapi/v1/time`, { agent });
    cold.push(r.ms);
    await sleep(1200);
  }
  log('cold_time', stats(cold));
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await getJson(`${API}/fapi/v1/time`);
    const t1 = Date.now();
    warm.push(r.ms);
    offsets.push(r.json.serverTime - (t0 + t1) / 2);
    await sleep(1200);
  }
  log('warm_time', stats(warm));
  log('clock_offset_ms', { ...stats(offsets), note: 'serverTime minus the local midpoint of the request' });
  const bulk = [];
  for (let i = 0; i < 3; i++) {
    const r = await getJson(`${API}/fapi/v1/premiumIndex`);
    bulk.push({ ms: round(r.ms), ttfb: round(r.ttfb), bytes: r.bytes, rows: r.json?.length, status: r.status, encoding: r.headers['content-encoding'] ?? null });
    await sleep(2000);
  }
  log('warm_premiumIndex', { polls: bulk });
  const spot = await getJson(`${API}/sapi/v1/time`);
  log('spot_time', { status: spot.status, ms: round(spot.ms), body: spot.body });
}

async function binanceMaps() {
  const [info, prem, tick, fund] = await Promise.all([
    getJson(`${BINANCE}/fapi/v1/exchangeInfo`),
    getJson(`${BINANCE}/fapi/v1/premiumIndex`),
    getJson(`${BINANCE}/fapi/v1/ticker/24hr`),
    getJson(`${BINANCE}/fapi/v1/fundingInfo`),
  ]);
  return {
    info: new Map(info.json.symbols.map((s) => [s.symbol, s])),
    prem: new Map(prem.json.map((p) => [p.symbol, p])),
    tick: new Map(tick.json.map((t) => [t.symbol, t])),
    fund: new Map(fund.json.map((f) => [f.symbol, f])),
    at: prem.at,
  };
}

// A WazirX INR contract maps to the Binance USDT contract of the same base.
const binanceSymbol = (w) => (w.quoteAsset === 'INR' ? `${w.baseAsset}USDT` : w.symbol);

async function catalog() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, wazirx: ccxt.exchanges.filter((x) => /waz|wrx/i.test(x)) });

  const [info, prem, tick, bin] = await Promise.all([
    getJson(`${API}/fapi/v1/exchangeInfo`),
    getJson(`${API}/fapi/v1/premiumIndex`),
    getJson(`${API}/fapi/v1/ticker/24hr`),
    binanceMaps(),
  ]);
  keep('fapi-exchangeInfo.json', info.body);
  keep('fapi-premiumIndex.json', prem.body);
  const syms = info.json.symbols;
  const count = (f, xs = syms) => xs.reduce((o, x) => ((o[f(x)] = (o[f(x)] ?? 0) + 1), o), {});
  log('futures_catalog', {
    status: info.status, bytes: info.bytes, ms: round(info.ms), rows: syms.length,
    by_type_quote_margin: count((s) => `${s.contractType}/${s.quoteAsset}/${s.marginAsset}`),
    has_status_field: syms.filter((s) => 'status' in s).length,
    assets: info.json.assets, conversionRates: info.json.conversionRates,
    maxLeverage: count((s) => s.maxLeverage),
    categories: info.json.categories.map((c) => `${c.id}:${c.name}`),
    scaled_bases: syms.filter((s) => /^1(0+|M)/.test(s.baseAsset)).map((s) => s.symbol),
    orderTypes: count((s) => s.orderTypes.join(',')),
  });
  log('bulk_rows', { premiumIndex: prem.json.length, premiumIndex_bytes: prem.bytes, premiumIndex_ms: round(prem.ms), ticker: tick.json.length, ticker_bytes: tick.bytes, ticker_ms: round(tick.ms) });

  const spot = await getJson(`${API}/sapi/v1/exchangeInfo`);
  log('spot_catalog', { status: spot.status, rows: spot.json.symbols.length, by_quote_status: count((s) => `${s.quoteAsset}/${s.status}`, spot.json.symbols) });

  // Each WazirX futures row against Binance USD-M read in the same second.
  const pm = new Map(prem.json.map((p) => [p.symbol, p]));
  const tm = new Map(tick.json.map((t) => [t.symbol, t]));
  let onBinance = 0, trading = 0, perpType = {}, tickOHL = 0, tickVol = 0, idxClose = 0, settleClose = 0, markClose = 0, rateEq = 0, nextEq = 0, interval = {};
  const ratios = [], idxDiffPpm = [], markDiffPpm = [], missing = [];
  for (const s of syms) {
    const b = binanceSymbol(s);
    const bi = bin.info.get(b);
    if (!bi) { missing.push(s.symbol); continue; }
    onBinance++;
    if (bi.status === 'TRADING') trading++;
    perpType[bi.contractType] = (perpType[bi.contractType] ?? 0) + 1;
    const fi = bin.fund.get(b);
    const h = fi ? fi.fundingIntervalHours : 8;
    interval[h] = (interval[h] ?? 0) + 1;
    const w = pm.get(s.symbol), bp = bin.prem.get(b), wt = tm.get(s.symbol), bt = bin.tick.get(b);
    if (!w || !bp || !wt || !bt) continue;
    if (s.quoteAsset === 'INR') ratios.push(Number(wt.openPrice) / Number(bt.openPrice));
    const near = (x, y, tol) => Math.abs(x / y - 1) <= tol;
    if (s.quoteAsset === 'USDT' && wt.openPrice === String(Number(bt.openPrice)) && Number(wt.highPrice) === Number(bt.highPrice) && Number(wt.lowPrice) === Number(bt.lowPrice)) tickOHL++;
    if (s.quoteAsset === 'USDT' && near(Number(wt.volume), Number(bt.quoteVolume), 0.002)) tickVol++;
    const scale = s.quoteAsset === 'INR' ? Number(wt.openPrice) / Number(bt.openPrice) : 1;
    const di = (Number(w.indexPrice) / scale / Number(bp.indexPrice) - 1) * 1e6;
    const dm = (Number(w.markPrice) / scale / Number(bp.markPrice) - 1) * 1e6;
    idxDiffPpm.push(Math.abs(di));
    markDiffPpm.push(Math.abs(dm));
    if (Math.abs(di) < 200) idxClose++;
    if (Math.abs(dm) < 200) markClose++;
    if (near(Number(w.estimatedSettlePrice) / scale, Number(bp.estimatedSettlePrice), 0.0002)) settleClose++;
    if (Number(w.lastFundingRate) === Number(bp.lastFundingRate)) rateEq++;
    if (w.nextFundingTime === bp.nextFundingTime) nextEq++;
  }
  log('vs_binance', {
    rows: syms.length, on_binance: onBinance, binance_trading: trading, binance_contractType: perpType, missing,
    usdt_ticker_open_high_low_equal: tickOHL, usdt_ticker_volume_equals_binance_quoteVolume: tickVol,
    inr_open_ratio: stats(ratios.map((r) => r * 1000)).median / 1000, inr_open_ratio_spread: [round(Math.min(...ratios), 4), round(Math.max(...ratios), 4)],
    index_within_200ppm: idxClose, index_absdiff_ppm: stats(idxDiffPpm),
    mark_within_200ppm: markClose, mark_absdiff_ppm: stats(markDiffPpm),
    estimatedSettle_within_200ppm: settleClose, funding_rate_equal: rateEq, nextFundingTime_equal: nextEq,
    binance_interval_hours_of_mapped: interval,
  });
  const nf = count((p) => new Date(p.nextFundingTime).toISOString(), prem.json);
  log('nextFundingTime', { values: nf, read_at: new Date(prem.at).toISOString() });
  const zero = prem.json.filter((p) => !(Number(p.markPrice) > 0) || !(Number(p.indexPrice) > 0)).map((p) => p.symbol);
  const rates = prem.json.map((p) => Number(p.lastFundingRate));
  log('premiumIndex_values', { zero_mark_or_index: zero, rate_min: Math.min(...rates), rate_max: Math.max(...rates), rate_decimals_max: Math.max(...prem.json.map((p) => (p.lastFundingRate.split('.')[1] ?? '').length)), E_minus_time: count((p) => p.E - p.time, prem.json), E_age_ms: stats(prem.json.map((p) => prem.at - p.E)) });
  for (const sym of ['BTCUSDT', 'BTCINR', 'ETHUSDT']) {
    const s = syms.find((x) => x.symbol === sym);
    log('contract', { symbol: sym, pricePrecision: s.pricePrecision, quantityPrecision: s.quantityPrecision, filters: s.filters, binance_tick: bin.info.get(binanceSymbol(s))?.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize, binance_step: bin.info.get(binanceSymbol(s))?.filters.find((f) => f.filterType === 'LOT_SIZE')?.stepSize, wazirx: pm.get(sym), binance: bin.prem.get(binanceSymbol(s)) });
  }
}

async function anchor() {
  const polls = [];
  const series = new Map(); // symbol to arrays of mark, index, rate
  for (let i = 0; i < 45; i++) {
    const t = Date.now();
    const [w, b] = await Promise.all([getJson(`${API}/fapi/v1/premiumIndex`), getJson(`${BINANCE}/fapi/v1/premiumIndex`)]);
    if (w.status !== 200) {
      log('anchor_refused', { i, status: w.status, headers: w.headers, body: w.body.slice(0, 300) });
      await sleep(2000);
      continue;
    }
    const bm = new Map(b.json.map((p) => [p.symbol, p]));
    let markEq = 0, idxEq = 0, n = 0;
    for (const p of w.json) {
      let s = series.get(p.symbol);
      if (!s) series.set(p.symbol, (s = { mark: [], index: [], rate: [], next: [], E: [] }));
      s.mark.push(p.markPrice); s.index.push(p.indexPrice); s.rate.push(p.lastFundingRate); s.next.push(p.nextFundingTime); s.E.push(p.E);
      if (p.symbol.endsWith('USDT')) {
        const q = bm.get(p.symbol);
        if (q) {
          n++;
          if (Math.abs(Number(p.markPrice) / Number(q.markPrice) - 1) < 1e-4) markEq++;
          if (Math.abs(Number(p.indexPrice) / Number(q.indexPrice) - 1) < 1e-4) idxEq++;
        }
      }
    }
    polls.push({ ms: w.ms, ttfb: w.ttfb, bytes: w.bytes, rows: w.json.length, E: w.json[0].E, ageMs: w.at - w.json[0].E, markWithin100ppm: markEq, indexWithin100ppm: idxEq, usdtRows: n });
    const wait = 2000 - (Date.now() - t);
    if (wait > 0) await sleep(wait);
  }
  log('anchor_polls', { polls: polls.length, ms: stats(polls.map((p) => p.ms)), ttfb: stats(polls.map((p) => p.ttfb)), bytes: stats(polls.map((p) => p.bytes)), rows: [...new Set(polls.map((p) => p.rows))], distinct_E: new Set(polls.map((p) => p.E)).size, E_age_ms: stats(polls.map((p) => p.ageMs)) });
  log('anchor_vs_binance', { usdt_rows: polls[0]?.usdtRows, mark_within_100ppm: stats(polls.map((p) => p.markWithin100ppm)), index_within_100ppm: stats(polls.map((p) => p.indexWithin100ppm)) });
  const changes = (xs) => xs.reduce((n, x, i) => n + (i > 0 && x !== xs[i - 1] ? 1 : 0), 0);
  const per = { mark: [], index: [], rate: [], next: [] };
  for (const s of series.values()) for (const k of Object.keys(per)) per[k].push(changes(s[k]));
  log('anchor_changes_per_symbol', { polls: polls.length, mark: stats(per.mark), index: stats(per.index), rate: stats(per.rate), next: stats(per.next) });
  for (const sym of ['BTCUSDT', 'BTCINR', 'ETHUSDT']) {
    const s = series.get(sym);
    if (s) log('anchor_symbol', { symbol: sym, mark_changes: changes(s.mark), index_changes: changes(s.index), rate_changes: changes(s.rate), rates: [...new Set(s.rate)], first_mark: s.mark[0], last_mark: s.mark.at(-1) });
  }
}

function gridReport(label, w, b, scale) {
  const tick = (xs) => xs.slice(1).map((x, i) => round(Math.abs(Number(x[0]) - Number(xs[i][0])), 8));
  const sizeEqByRank = (ws, bs) => ws.filter((x, i) => bs[i] && Number(x[1]) === Number(bs[i][1])).length;
  const sizeEqByPrice = (ws, bs) => { const m = new Map(bs.map((x) => [Number(x[0]) * scale, Number(x[1])])); return ws.filter((x) => m.get(Number(x[0])) === Number(x[1])).length; };
  const desc = (xs) => xs.every((x, i) => i === 0 || Number(x[0]) < Number(xs[i - 1][0]));
  const asc = (xs) => xs.every((x, i) => i === 0 || Number(x[0]) > Number(xs[i - 1][0]));
  log('book_vs_binance', {
    label, w_E: w.E, w_T: w.T, b_E: b.E, read_gap_ms: w.E - b.E,
    w_levels: [w.bids.length, w.asks.length], b_levels: [b.bids.length, b.asks.length],
    w_bids_desc: desc(w.bids), w_asks_asc: asc(w.asks),
    w_touch: [w.bids[0], w.asks[0]], b_touch: [b.bids[0], b.asks[0]],
    w_spread: round(Number(w.asks[0][0]) - Number(w.bids[0][0]), 6), b_spread_scaled: round((Number(b.asks[0][0]) - Number(b.bids[0][0])) * scale, 6),
    bid_below_binance_ppm: round((1 - Number(w.bids[0][0]) / (Number(b.bids[0][0]) * scale)) * 1e6), ask_above_binance_ppm: round((Number(w.asks[0][0]) / (Number(b.asks[0][0]) * scale) - 1) * 1e6),
    w_bid_steps: [...new Set(tick(w.bids))].slice(0, 6), b_bid_steps: [...new Set(tick(b.bids))].slice(0, 6),
    bid_size_equal_by_rank: sizeEqByRank(w.bids, b.bids), ask_size_equal_by_rank: sizeEqByRank(w.asks, b.asks),
    bid_size_equal_by_price: scale === 1 ? sizeEqByPrice(w.bids, b.bids) : null, ask_size_equal_by_price: scale === 1 ? sizeEqByPrice(w.asks, b.asks) : null,
  });
}

async function book() {
  const tick = await getJson(`${API}/fapi/v1/ticker/24hr`);
  const usdt = tick.json.filter((t) => t.symbol.endsWith('USDT')).sort((a, b) => Number(a.volume) - Number(b.volume));
  const quiet = usdt[Math.floor(usdt.length * 0.1)].symbol;
  const pairs = [['BTCUSDT', 'BTCUSDT'], ['ETHUSDT', 'ETHUSDT'], [quiet, quiet], ['BTCINR', 'BTCUSDT']];
  let ratio = null;
  for (const [w, b] of pairs) {
    const [wr, br] = await Promise.all([getJson(`${API}/fapi/v1/depth?symbol=${w}`), getJson(`${BINANCE}/fapi/v1/depth?symbol=${b}&limit=20`)]);
    keep(`depth-${w}.json`, wr.body);
    if (w === 'BTCINR') {
      const wt = tick.json.find((t) => t.symbol === 'BTCINR'), bt = tick.json.find((t) => t.symbol === 'BTCUSDT');
      ratio = Number(wt.openPrice) / Number(bt.openPrice);
    }
    gridReport(w, wr.json, br.json, w === 'BTCINR' ? ratio : 1);
    log('depth_headers', { symbol: w, status: wr.status, ms: round(wr.ms), bytes: wr.bytes, cache: wr.headers['cache-control'] ?? null, age: wr.headers.age ?? null, etag: wr.headers.etag ?? null });
    await sleep(1500);
  }
  // Paired reads a few seconds apart, to tell a steady offset from a book that moved between the two reads.
  for (let i = 0; i < 4; i++) {
    for (const sym of ['BTCUSDT', 'ETHUSDT']) {
      const [wr, br] = await Promise.all([getJson(`${API}/fapi/v1/depth?symbol=${sym}`), getJson(`${BINANCE}/fapi/v1/depth?symbol=${sym}&limit=20`)]);
      gridReport(`${sym}#${i + 2}`, wr.json, br.json, 1);
      await sleep(1500);
    }
  }
  for (const limit of [5, 50, 100, 500]) {
    const r = await getJson(`${API}/fapi/v1/depth?symbol=BTCUSDT&limit=${limit}`);
    log('depth_limit', { limit, status: r.status, levels: r.json?.bids ? [r.json.bids.length, r.json.asks.length] : null, body: r.status === 200 ? undefined : r.body.slice(0, 200) });
    await sleep(1500);
  }
  const reads = [];
  for (let i = 0; i < 15; i++) {
    const r = await getJson(`${API}/fapi/v1/depth?symbol=BTCUSDT`);
    reads.push({ at: r.at, E: r.json.E, T: r.json.T, top: `${r.json.bids[0][0]}/${r.json.asks[0][0]}` });
    await sleep(1500);
  }
  const eMinusT = reads.map((r) => r.E - r.T);
  log('depth_repeat', { reads: reads.length, distinct_T: new Set(reads.map((r) => r.T)).size, distinct_top: new Set(reads.map((r) => r.top)).size, E_minus_T_ms: stats(eMinusT), arrival_minus_T_ms: stats(reads.map((r) => r.at - r.T)) });
}

// The published funding rate against Binance's predicted rate and its settled history, and INR twins against USDT twins.
async function funding() {
  const [w, b] = await Promise.all([getJson(`${API}/fapi/v1/premiumIndex`), getJson(`${BINANCE}/fapi/v1/premiumIndex`)]);
  const wm = new Map(w.json.map((p) => [p.symbol, p]));
  const bm = new Map(b.json.map((p) => [p.symbol, p]));
  let eqPred = 0, n = 0, twins = 0, twinEq = 0;
  const vals = {};
  for (const p of w.json) {
    vals[p.lastFundingRate] = (vals[p.lastFundingRate] ?? 0) + 1;
    if (!p.symbol.endsWith('USDT')) continue;
    const q = bm.get(p.symbol);
    if (q) { n++; if (Number(q.lastFundingRate) === Number(p.lastFundingRate)) eqPred++; }
    const inr = wm.get(p.symbol.replace(/USDT$/, 'INR'));
    if (inr) { twins++; if (inr.lastFundingRate === p.lastFundingRate) twinEq++; }
  }
  const common = Object.entries(vals).sort((x, y) => y[1] - x[1]).slice(0, 5);
  log('funding_summary', { read_at: new Date(w.at).toISOString(), usdt_rows: n, equal_binance_predicted: eqPred, usdt_inr_twins: twins, twin_rates_equal: twinEq, most_common_rates: common });
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'SUIUSDT']) {
    const hist = await getJson(`${BINANCE}/fapi/v1/fundingRate?symbol=${sym}&limit=3`);
    log('funding_symbol', {
      symbol: sym, wazirx_usdt: wm.get(sym)?.lastFundingRate, wazirx_inr: wm.get(sym.replace(/USDT$/, 'INR'))?.lastFundingRate,
      binance_predicted: bm.get(sym)?.lastFundingRate, binance_settled: hist.json.map((h) => `${new Date(h.fundingTime).toISOString().slice(11, 16)} ${h.fundingRate}`),
    });
    await sleep(300);
  }
}

async function errors() {
  const cases = [
    `${API}/fapi/v1/depth?symbol=NOPEUSDT`,
    `${API}/fapi/v1/depth`,
    `${API}/fapi/v1/depth?symbol=btcusdt`,
    `${API}/fapi/v1/premiumIndex?symbol=NOPEUSDT`,
    `${API}/fapi/v1/ticker/24hr?symbol=NOPEUSDT`,
    `${API}/fapi/v1/fundingRate?symbol=BTCUSDT`,
    `${API}/fapi/v1/fundingInfo`,
    `${API}/fapi/v1/ticker/bookTicker`,
    `${API}/fapi/v1/nope`,
    `${API}/sapi/v1/depth?symbol=nopeinr`,
  ];
  for (const url of cases) {
    const r = await get(url);
    log('error_case', { url: url.replace(API, ''), status: r.status, ms: round(r.ms), retryAfter: r.headers['retry-after'] ?? null, body: r.body.replace(/\s+/g, ' ').slice(0, 200) });
    await sleep(600);
  }
}

const mode = process.argv[2] ?? 'latency';
const modes = { latency, catalog, anchor, book, funding, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
