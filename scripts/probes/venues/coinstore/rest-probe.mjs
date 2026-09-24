// Coinstore REST probe: hosts and latency, the perpetual catalogs (web app instruments and the legacy configs), fees, funding history, the REST book and its id, polling time, error shapes, rate limit headers and clock offset.
// The perpetual calls are the ones the futures web app at futures.coinstore.com makes, since the documented perpetual API was deleted from coinstore-openapi.github.io on 2026-06-12.
// Public, unauthenticated, read-only, and well under the documented spot limit of 300 requests per 3 s per IP.
// Run from server/: node ../scripts/probes/venues/coinstore/rest-probe.mjs [catalog|anchor|book|poll|errors]
//   catalog  DNS, cold and warm request time, instruments, legacy configs, fee list, spot symbols, and CCXT's exchange list. About 10 s.
//   anchor   funding history for every perpetual, the bulk ticker, and the legacy snapshot call. About 20 s.
//   book     depthAll and depth on four perps: gears, level counts, order, ids, caching, and size unit against ctVal. About 10 s.
//   poll     60 one-second polls of the bulk ticker and one depth. About 65 s.
//   errors   unknown symbol, missing parameters, unknown path, headers, and the server clock from the Date header and from an error reply's ts. About 20 s.
// Recorded in docs/profiles/coinstore/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const FUT = 'https://futures.coinstore.com/api';
const SPOT = 'https://api.coinstore.com/api';
const TT = 'linearPerpetual';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

async function get(url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, bytes: text.length, json, text, headers: res.headers };
}

async function catalog() {
  for (const host of ['futures.coinstore.com', 'ws-futures.coinstore.com', 'api.coinstore.com', 'ws.coinstore.com', 'futures.api.coinstore.com']) {
    try { log('dns', { host, addresses: (await lookup(host, { all: true })).map((a) => a.address) }); } catch (e) { log('dns', { host, error: e.code }); }
  }
  for (const url of [`${FUT}/v1/public/web/instruments`, `${SPOT}/v1/market/tickers`]) {
    const times = [];
    for (let i = 0; i < 4; i++) { times.push((await get(url)).ms); await sleep(250); }
    log('latency', { url, coldMs: times[0], warmMs: times.slice(1) });
  }

  const inst = await get(`${FUT}/v1/public/web/instruments`);
  const d = inst.json.data;
  const count = (k) => d.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {});
  log('instruments', { status: inst.status, bytes: inst.bytes, rows: d.length, tradeType: count('tradeType'), quote: count('quote'), settleCurrency: count('settleCurrency'), status_: count('status'), takerRate: count('takerRate'), makerRate: count('makerRate'), maxLeverage: count('maxLeverage'), ctVal: count('ctVal') });
  const dupBase = Object.entries(count('base')).filter(([, n]) => n > 1);
  log('instruments_shape', { symbolEqualsBasePlusQuote: d.filter((x) => x.symbol === x.base + x.quote).length, symbolNotBasePlusQuote: d.filter((x) => x.symbol !== x.base + x.quote).map((x) => `${x.symbol}=${x.base}+${x.quote}`), baseListedTwice: dupBase, onboardFirst: new Date(Math.min(...d.map((x) => x.onboardDate))).toISOString(), onboardLast: new Date(Math.max(...d.map((x) => x.onboardDate))).toISOString(), ratios: [...new Set(d.map((x) => `${x.indexPriceGreaterRatio}/${x.markPriceGreaterRatio}/${x.indexPriceLessRatio}/${x.markPriceLessRatio}`))] });
  const btc = { ...d.find((x) => x.symbol === 'BTCUSDT') };
  delete btc.baseIconUrl;
  log('instrument_btc', { instrument: btc });

  const legacy = await get(`${FUT}/configs/public`);
  const c = legacy.json.data.contracts;
  log('legacy_configs', { status: legacy.status, bytes: legacy.bytes, contracts: c.length, names: c.map((x) => x.name).slice(0, 40), fundingInterval: c.reduce((m, x) => ((m[x.fundingInterval] = (m[x.fundingInterval] ?? 0) + 1), m), {}), takerFeeRate: [...new Set(c.map((x) => x.takerFeeRate))], version: legacy.json.data.version });

  const fee = await get(`${FUT}/v1/trade/web/query/querySymbolFee`);
  const fl = fee.json.data.symbolFeeList;
  const byFee = fl.reduce((m, x) => ((m[`${x.makerFee}/${x.takerFee}`] = (m[`${x.makerFee}/${x.takerFee}`] ?? 0) + 1), m), {});
  log('symbol_fee', { status: fee.status, defaultMaker: fee.json.data.makerFee, defaultTaker: fee.json.data.takerFee, rows: fl.length, makerOverTaker: byFee, notInInstruments: fl.filter((x) => !d.some((i) => i.symbol === x.symbol)).map((x) => x.symbol), disagreeWithInstruments: fl.filter((x) => { const i = d.find((y) => y.symbol === x.symbol); return i && (i.takerRate !== x.takerFee || i.makerRate !== x.makerFee); }).length });

  const spot = await get(`${SPOT}/v2/public/config/spot/symbols`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const sd = spot.json.data;
  log('spot_symbols', { status: spot.status, rows: sd.length, openTrade: sd.filter((x) => x.openTrade).length, takerFee: sd.reduce((m, x) => ((m[x.takerFee] = (m[x.takerFee] ?? 0) + 1), m), {}), makerFee: sd.reduce((m, x) => ((m[x.makerFee] = (m[x.makerFee] ?? 0) + 1), m), {}) });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, coinstore: ccxt.exchanges.includes('coinstore'), similar: ccxt.exchanges.filter((e) => e.includes('store') || e.startsWith('coins')) });
}

async function anchor() {
  const inst = (await get(`${FUT}/v1/public/web/instruments`)).json.data;
  const now = Date.now();
  const spacing = {};
  const latest = {};
  const rates = [];
  const hours = new Set();
  const maxAbs = {};
  let rows = 0;
  let slowest = 0;
  for (const x of inst) {
    const r = await get(`${FUT}/v1/public/funding/web/fundingRate?tradeType=${TT}&symbol=${x.symbol}`);
    slowest = Math.max(slowest, r.ms);
    const h = r.json.data;
    rows += h.length;
    if (x.symbol === 'BTCUSDT') log('funding_btc', { status: r.status, bytes: r.bytes, rows: h.length, first: h[0], last: h.at(-1) });
    const gaps = h.slice(1).map((e, i) => (h[i].fundingTime - e.fundingTime) / 3_600_000);
    const key = [...new Set(gaps)].join(',') || 'n/a';
    spacing[key] = (spacing[key] ?? 0) + 1;
    latest[new Date(h[0]?.fundingTime).toISOString()] = (latest[new Date(h[0]?.fundingTime).toISOString()] ?? 0) + 1;
    for (const e of h) {
      rates.push(Number(e.fundingRate));
      hours.add(new Date(e.fundingTime).getUTCHours());
      const r = Math.abs(Number(e.fundingRate));
      if (r > (maxAbs[x.symbol]?.rate ?? -1)) maxAbs[x.symbol] = { rate: r, mmr: Number(x.maintMarginRatio) };
    }
    await sleep(150);
  }
  log('funding_all', { symbols: inst.length, rows, slowestMs: slowest, spacingHours: spacing, latestSettlement: latest, now: new Date(now).toISOString(), rateMin: Math.min(...rates), rateMax: Math.max(...rates), distinctRates: [...new Set(rates)].length, equal_0_0001: rates.filter((r) => r === 0.0001).length, settlementHoursUtc: [...hours].sort((a, b) => a - b) });

  const top = rates.reduce((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {});
  log('funding_rate_histogram_top', { of: rates.length, top: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n]) => `${r}:${n}`) });
  const peak = Object.entries(maxAbs).sort((a, b) => b[1].rate - a[1].rate).slice(0, 8).map(([sym, v]) => `${sym} max|rate| ${v.rate} mmr ${v.mmr} 0.75*mmr ${+(0.75 * v.mmr).toFixed(6)}`);
  log('funding_peaks', { peak, symbolsAtOrAbove_0_75_mmr: Object.values(maxAbs).filter((v) => v.rate >= 0.75 * v.mmr - 1e-12).length });

  const t = await get(`${FUT}/v1/market/ticker/24hr?tradeType=${TT}`);
  log('ticker24hr', { status: t.status, bytes: t.bytes, ms: t.ms, rows: t.json.data.length, fields: Object.keys(t.json.data[0]), notInInstruments: t.json.data.filter((r) => !inst.some((i) => i.symbol === r.symbol)).map((r) => r.symbol) });
  const mini = await get(`${FUT}/v1/market/ticker/mini?tradeType=${TT}`);
  log('ticker_mini', { status: mini.status, bytes: mini.bytes, rows: mini.json.data.length, fields: Object.keys(mini.json.data[0]) });

  const leg = await get(`${FUT}/v1/futureQuot/querySnapshot?contractId=100300034`);
  log('legacy_snapshot', { status: leg.status, body: leg.text.slice(0, 120) });
}

async function book() {
  const inst = (await get(`${FUT}/v1/public/web/instruments`)).json.data;
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'QNTXUSDT']) {
    const m = inst.find((x) => x.symbol === sym);
    const all = await get(`${FUT}/v1/market/depthAll?tradeType=${TT}&symbol=${sym}`);
    if (!Array.isArray(all.json?.data)) { log('depthAll', { sym, status: all.status, body: all.text.slice(0, 160) }); continue; }
    const g = all.json.data;
    const order = g.map((x) => ({ gear: x.gear, bids: x.bids.length, asks: x.asks.length, bidsDesc: x.bids.every((l, i) => i === 0 || Number(x.bids[i - 1][0]) > Number(l[0])), asksAsc: x.asks.every((l, i) => i === 0 || Number(x.asks[i - 1][0]) < Number(l[0])), lastDepthId: x.lastDepthId, idType: typeof x.lastDepthId, keys: Object.keys(x) }));
    log('depthAll', { sym, inInstruments: Boolean(m), ctVal: m?.ctVal, tickSize: m?.tickSize, status: all.status, bytes: all.bytes, ms: all.ms, gears: order });
    if (!m) continue;
    const ids = [];
    const ms = [];
    for (let i = 0; i < 5; i++) {
      const r = await get(`${FUT}/v1/market/depth?tradeType=${TT}&symbol=${sym}&gear=${m.tickSize}`);
      ids.push(r.json.data.lastDepthId);
      ms.push(r.ms);
      if (i === 0) {
        const ct = Number(m.ctVal);
        const sizes = [...r.json.data.bids, ...r.json.data.asks].map((l) => Number(l[1]));
        log('depth', { sym, gear: m.tickSize, bytes: r.bytes, levels: `${r.json.data.bids.length}b/${r.json.data.asks.length}a`, cacheHeaders: { 'cache-control': r.headers.get('cache-control'), 'cf-cache-status': r.headers.get('cf-cache-status'), age: r.headers.get('age') }, sizesMultipleOfCtVal: sizes.filter((q) => Math.abs(q / ct - Math.round(q / ct)) < 1e-6).length, sizes: sizes.length, fractionalSizes: sizes.filter((q) => !Number.isInteger(q)).length, top: [r.json.data.bids[0], r.json.data.asks[0]] });
      }
      await sleep(200);
    }
    log('depth_repeat', { sym, ids, distinctIds: new Set(ids).size, ms });
    const tr = await get(`${FUT}/v1/market/trade?tradeType=${TT}&symbol=${sym}`);
    const q = (tr.json?.data ?? []).map((x) => Number(x.qty ?? x.q ?? x.quantity));
    log('trades', { sym, status: tr.status, rows: tr.json?.data?.length, fields: tr.json?.data?.[0] ? Object.keys(tr.json.data[0]) : null, qtyMultipleOfCtVal: q.filter((v) => Math.abs(v / Number(m.ctVal) - Math.round(v / Number(m.ctVal))) < 1e-6).length, sample: tr.json?.data?.slice(0, 2) });
  }
  const big = await get(`${FUT}/v1/market/depth?tradeType=${TT}&symbol=BTCUSDT&gear=0.01&limit=5`);
  log('depth_limit_param', { status: big.status, levels: `${big.json?.data?.bids?.length}b/${big.json?.data?.asks?.length}a` });
}

async function poll() {
  const tk = [];
  const dp = [];
  let bytesT = 0;
  const lastPrice = [];
  const depthIds = [];
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const [a, b] = await Promise.all([get(`${FUT}/v1/market/ticker/24hr?tradeType=${TT}`), get(`${FUT}/v1/market/depth?tradeType=${TT}&symbol=ETHUSDT&gear=0.01`)]);
    tk.push(a.ms);
    dp.push(b.ms);
    bytesT += a.bytes;
    lastPrice.push(['BTCUSDT', 'ETHUSDT', 'XRPUSDT'].map((sym) => { const r = a.json.data.find((x) => x.symbol === sym); return `${r?.lastPrice}@${r?.closeTime}`; }));
    depthIds.push(b.json.data.lastDepthId);
    if (a.status !== 200 || b.status !== 200) log('non_200', { i, a: a.status, b: b.status });
    await sleep(Math.max(0, 1_000 - (Date.now() - start)));
  }
  const s = (a) => ({ min: quantile(a, 0), p50: quantile(a, 0.5), p90: quantile(a, 0.9), max: quantile(a, 1), over1s: a.filter((x) => x > 1000).length });
  const changes = [0, 1, 2].map((k) => lastPrice.slice(1).filter((p, i) => p[k] !== lastPrice[i][k]).length);
  log('poll', { polls: 60, secs: Math.round((Date.now() - t0) / 1000), ticker24hrMs: s(tk), ticker24hrBytesAvg: Math.round(bytesT / 60), depthMs: s(dp), tickerChangesBtcEthXrp: changes, tickerSample: lastPrice.slice(0, 3).map((p) => p[1]), depthIdChanges: depthIds.slice(1).filter((d, i) => d !== depthIds[i]).length });
}

async function errors() {
  const tries = [
    ['depth unknown symbol', `${FUT}/v1/market/depth?tradeType=${TT}&symbol=NOPEUSDT&gear=0.01`],
    ['depth wrong gear', `${FUT}/v1/market/depth?tradeType=${TT}&symbol=BTCUSDT&gear=5`],
    ['depth no params', `${FUT}/v1/market/depth`],
    ['depthAll bad tradeType', `${FUT}/v1/market/depthAll?tradeType=nope&symbol=BTCUSDT`],
    ['funding unknown symbol', `${FUT}/v1/public/funding/web/fundingRate?tradeType=${TT}&symbol=NOPEUSDT`],
    ['unknown path', `${FUT}/v1/market/markPrice?tradeType=${TT}`],
    ['private path without login', `${FUT}/v1/trade/web/position`],
    ['spot tickers', `${SPOT}/v1/market/tickers`],
  ];
  for (const [name, url] of tries) {
    const r = await get(url);
    log('try', { name, status: r.status, ms: r.ms, contentType: r.headers.get('content-type'), body: r.text.slice(0, 160) });
    await sleep(300);
  }
  const r = await get(`${FUT}/v1/market/ticker/mini?tradeType=${TT}`);
  const hdr = {};
  for (const [k, v] of r.headers) if (/rate|limit|retry|remaining|cache|server|cf-ray|date/i.test(k)) hdr[k] = v;
  log('headers', hdr);

  const offs = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const x = await get(`${FUT}/v1/market/ticker/mini?tradeType=${TT}`);
    const t1 = Date.now();
    offs.push(Date.parse(x.headers.get('date')) - (t0 + t1) / 2);
    await sleep(700);
  }
  log('clock_from_date_header', { note: 'Date has one second resolution, so each offset is within -1000 to 0 ms of the truth', offsetsMs: offs.map(Math.round), max: Math.round(Math.max(...offs)) });

  // An error reply carries `ts` in ms, which is the only millisecond server clock found on this API.
  const tsOffs = [];
  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const x = await get(`${FUT}/v1/market/depth`);
    const t1 = Date.now();
    tsOffs.push(x.json.ts - (t0 + t1) / 2);
    rtts.push(t1 - t0);
    await sleep(500);
  }
  log('clock_from_error_ts', { offsetsMs: tsOffs.map(Math.round), median: Math.round(quantile(tsOffs, 0.5)), rttMs: rtts });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, book, poll, errors };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
