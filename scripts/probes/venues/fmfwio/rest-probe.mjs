// FMFW.io public REST v3 probe for the USDT perpetuals: catalog and CCXT mapping, the futures/info anchor call, index and mark against spot, funding history, the REST book, errors, headers and clock.
// Public, unauthenticated, read-only. Every mode stays far inside the documented 30 requests per second on /public/*.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/fmfwio/rest-probe.mjs [catalog|anchor|index|funding|book|errors]
//   catalog  /public/symbol counts, CCXT 4.5.68 fmfwio loadMarkets on the swaps, and id agreement with /public/futures/info. About 5 s.
//   anchor   /public/futures/info polled once a second for POLLS rounds (default 60), with change counts per field. About 65 s.
//   index    one read of futures/info, the FMFW spot tickers, the perp tickers and OKX spot tickers, to place index and mark against each. About 3 s.
//   funding  /public/futures/history/funding for every perpetual, the settlement grid and the rate the info call shows. About 2 s.
//   book     /public/orderbook on BTCUSDT_PERP at several depths, level order, two back to back reads, and the bulk call. About 3 s.
//   errors   unknown, expired and suspended symbols, a bad depth, response headers and the clock offset. About 3 s.
// Recorded in docs/profiles/fmfwio/rest.md and docs/profiles/fmfwio/fees.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.fmfw.io/api/3';
const OKX = 'https://www.okx.com/api/v5/market/tickers?instType=SPOT';
const POLLS = Number(process.env.POLLS ?? 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const ppm = (a, b) => Math.round(((a - b) / b) * 1e6);

async function get(path, base = API) {
  const t0 = performance.now();
  const sent = Date.now();
  const res = await fetch(base + path, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: res.status, ms, bytes: text.length, body, headers: res.headers, sent, received: Date.now() };
}

async function perpIds() {
  const { body } = await get('/public/symbol');
  return Object.entries(body).filter(([, v]) => v.type === 'futures');
}

async function catalog() {
  const r = await get('/public/symbol');
  const counts = {};
  for (const v of Object.values(r.body)) {
    const k = `${v.type}|${v.status}|${v.quote_currency}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  log('symbol', { status: r.status, ms: r.ms, bytes: r.bytes, total: Object.keys(r.body).length, counts });
  const perps = Object.entries(r.body).filter(([, v]) => v.type === 'futures');
  for (const [id, v] of perps) {
    log('perp', { id, status: v.status, contract_type: v.contract_type, underlying: v.underlying, base_currency: v.base_currency, qty: v.quantity_increment, tick: v.tick_size, take: v.take_rate, make: v.make_rate, fee_ccy: v.fee_currency, lev: v.max_initial_leverage ?? null, margin: v.margin_trading ?? null });
  }
  const rates = {};
  for (const v of Object.values(r.body)) {
    const k = `${v.type} take ${v.take_rate} make ${v.make_rate}`;
    rates[k] = (rates[k] ?? 0) + 1;
  }
  log('rates', rates);

  const ex = new ccxt.fmfwio();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.type === 'swap');
  log('ccxt', { ms: Math.round(performance.now() - t0), markets: Object.keys(markets).length, swaps: swaps.length, activeSwaps: swaps.filter((m) => m.active !== false).length, classFeeTaker: ex.fees.trading.taker, classFeeMaker: ex.fees.trading.maker });
  for (const m of swaps) {
    log('ccxtSwap', { id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, active: m.active, contractSize: m.contractSize, taker: m.taker, maker: m.maker, amountStep: m.precision.amount });
  }
  const bases = {};
  for (const m of swaps) bases[m.base] = (bases[m.base] ?? 0) + 1;
  log('ccxtPairsTwice', { twice: Object.entries(bases).filter(([, n]) => n > 1) });

  const info = await get('/public/futures/info');
  const infoIds = new Set(Object.keys(info.body));
  log('idAgreement', { infoRows: infoIds.size, swapIdsInInfo: swaps.filter((m) => infoIds.has(m.id)).length, infoNotInSwaps: [...infoIds].filter((id) => !swaps.some((m) => m.id === id)) });
}

async function anchor() {
  const prev = new Map();
  const changes = new Map();
  const times = [];
  const lags = [];
  let bytes = 0;
  let keys = null;
  const next = new Set();
  const gaps = [];
  // Mark against index times (1 + rate times the share of the 8 h interval left), rounded to the contract tick.
  const ticks = new Map((await perpIds()).map(([id, v]) => [id, Number(v.tick_size)]));
  const fit = { rows: 0, byFundingRate: 0, byIndicative: 0, markEqIndex: 0 };
  for (let i = 0; i < POLLS; i++) {
    const started = Date.now();
    const r = await get('/public/futures/info');
    times.push(r.ms);
    bytes = r.bytes;
    for (const [id, v] of Object.entries(r.body)) {
      keys ??= Object.keys(v);
      next.add(v.next_funding_time);
      if (id === 'BTCUSDT_PERP') lags.push(r.received - Date.parse(v.timestamp));
      if (v.contract_type === 'perpetual' && id !== 'LUNAUSDT_PERP') {
        gaps.push(Math.abs(ppm(Number(v.mark_price), Number(v.index_price))));
        const idx = Number(v.index_price);
        const mark = Number(v.mark_price);
        const share = (Date.parse(v.next_funding_time) - Date.parse(v.timestamp)) / (8 * 3.6e6);
        const half = ticks.get(id) / 2 + 1e-12;
        fit.rows++;
        if (Math.abs(idx * (1 + Number(v.funding_rate) * share) - mark) <= half) fit.byFundingRate++;
        if (Math.abs(idx * (1 + Number(v.indicative_funding_rate) * share) - mark) <= half) fit.byIndicative++;
        if (mark === idx) fit.markEqIndex++;
      }
      const p = prev.get(id);
      const c = changes.get(id) ?? { index: 0, mark: 0, funding_rate: 0, indicative: 0, premium_index: 0, timestamp: 0 };
      if (p) {
        if (p.index_price !== v.index_price) c.index++;
        if (p.mark_price !== v.mark_price) c.mark++;
        if (p.funding_rate !== v.funding_rate) c.funding_rate++;
        if (p.indicative_funding_rate !== v.indicative_funding_rate) c.indicative++;
        if (p.premium_index !== v.premium_index) c.premium_index++;
        if (p.timestamp !== v.timestamp) c.timestamp++;
      }
      changes.set(id, c);
      prev.set(id, v);
    }
    const wait = 1000 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  const s = [...times].sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
  log('anchorTimes', { polls: POLLS, bytes, first: times[0], min: s[0], median: q(s, 0.5), p90: q(s, 0.9), max: s[s.length - 1], over1s: times.filter((t) => t > 1000).length, fields: keys });
  const sl = [...lags].sort((a, b) => a - b);
  log('btcTimestampLagMs', { min: sl[0], median: q(sl, 0.5), max: sl[sl.length - 1] });
  const sg = [...gaps].sort((a, b) => a - b);
  log('markIndexGapPpm', { samples: sg.length, median: q(sg, 0.5), p90: q(sg, 0.9), max: sg[sg.length - 1] });
  log('nextFundingTimes', { values: [...next] });
  log('markFormulaFit', { note: 'rows where the mark is within half a tick of index times (1 + rate times time left over 8 h)', ...fit });
  for (const [id, c] of changes) log('changes', { id, ...c, of: POLLS - 1, last: { index: prev.get(id).index_price, mark: prev.get(id).mark_price, rate: prev.get(id).funding_rate, indicative: prev.get(id).indicative_funding_rate, premium: prev.get(id).premium_index, avgPremium: prev.get(id).avg_premium_index, interest: prev.get(id).interest_rate } });
}

async function index() {
  const perps = (await perpIds()).filter(([, v]) => v.status === 'working');
  const info = (await get('/public/futures/info')).body;
  const spotSyms = perps.map(([, v]) => `${v.underlying}USDT`);
  const spot = (await get('/public/ticker?symbols=' + spotSyms.join(','))).body;
  const perpT = (await get('/public/ticker?symbols=' + perps.map(([id]) => id).join(','))).body;
  const okx = await get('', OKX);
  const okxLast = new Map();
  if (okx.status === 200) for (const t of okx.body.data) okxLast.set(t.instId, Number(t.last));
  log('okx', { status: okx.status, rows: okxLast.size });
  for (const [id, v] of perps) {
    const i = info[id];
    const s = spot[`${v.underlying}USDT`];
    const p = perpT[id];
    const idx = Number(i.index_price);
    const mark = Number(i.mark_price);
    const spotMid = s ? (Number(s.bid) + Number(s.ask)) / 2 : null;
    const perpMid = p ? (Number(p.bid) + Number(p.ask)) / 2 : null;
    const ext = okxLast.get(`${v.underlying}-USDT`);
    log('index', {
      id,
      index: i.index_price,
      mark: i.mark_price,
      spotLast: s?.last ?? null,
      spotMid,
      perpLast: p?.last ?? null,
      perpMid,
      okxLast: ext ?? null,
      indexVsSpotMidPpm: spotMid ? ppm(idx, spotMid) : null,
      indexEqSpotLast: s ? Number(s.last) === idx : null,
      indexVsOkxPpm: ext ? ppm(idx, ext) : null,
      markVsIndexPpm: ppm(mark, idx),
      tickPpm: Math.round((Number(v.tick_size) / idx) * 1e6),
      markVsPerpMidPpm: perpMid ? ppm(mark, perpMid) : null,
      perpSpread: p ? ppm(Number(p.ask), Number(p.bid)) : null,
      perpVolQuote: p?.volume_quote ?? null,
      perpTs: p?.timestamp ?? null,
    });
  }
  const c = await get('/public/futures/candles/index_price/BTCUSDT_PERP?period=M1&limit=3');
  log('indexCandles', { status: c.status, body: c.body });
}

async function funding() {
  const perps = await perpIds();
  const info = (await get('/public/futures/info')).body;
  const r = await get('/public/futures/history/funding?limit=6');
  log('historyAll', { status: r.status, ms: r.ms, bytes: r.bytes, contracts: Object.keys(r.body).length });
  for (const [id] of perps) {
    const h = r.body[id] ?? [];
    const ts = h.map((x) => x.timestamp);
    const steps = h.slice(1).map((x, k) => (Date.parse(h[k].timestamp) - Date.parse(x.timestamp)) / 3.6e6);
    log('history', { id, rows: h.length, latest: h[0] ?? null, steps, oldest: ts[ts.length - 1] ?? null, infoRate: info[id]?.funding_rate, infoIndicative: info[id]?.indicative_funding_rate, infoNext: info[id]?.next_funding_time, infoRateEqLatest: h[0] ? h[0].funding_rate === info[id]?.funding_rate : null });
  }
  const b = await get('/public/futures/history/funding/BTCUSDT_PERP?limit=1000&sort=DESC');
  const rates = b.body.map((x) => Number(x.funding_rate));
  const hours = {};
  for (const x of b.body) {
    const h = new Date(x.timestamp).getUTCHours();
    hours[h] = (hours[h] ?? 0) + 1;
  }
  log('btcHistory', { status: b.status, rows: b.body.length, newest: b.body[0]?.timestamp, oldest: b.body[b.body.length - 1]?.timestamp, min: Math.min(...rates), max: Math.max(...rates), at0001: rates.filter((x) => x === 0.0001).length, hoursUtc: hours });
  let all = [];
  const r2 = await get('/public/futures/history/funding?limit=1000');
  for (const [id, h] of Object.entries(r2.body)) for (const x of h) all.push({ id, r: Number(x.funding_rate), t: x.timestamp });
  all.sort((a, b) => a.r - b.r);
  log('extremes', { rows: all.length, lowest: all.slice(0, 3), highest: all.slice(-3) });
}

async function book() {
  for (const depth of [0, 5, 20, 100]) {
    const r = await get(`/public/orderbook/BTCUSDT_PERP?depth=${depth}`);
    const b = r.body;
    const bidsDesc = b.bid.every((l, i) => i === 0 || Number(l[0]) < Number(b.bid[i - 1][0]));
    const asksAsc = b.ask.every((l, i) => i === 0 || Number(l[0]) > Number(b.ask[i - 1][0]));
    log('book', { depth, status: r.status, ms: r.ms, bytes: r.bytes, bids: b.bid.length, asks: b.ask.length, bidsDesc, asksAsc, ts: b.timestamp, top: [b.bid[0], b.ask[0]] });
  }
  const a = await get('/public/orderbook/BTCUSDT_PERP?depth=20');
  const b = await get('/public/orderbook/BTCUSDT_PERP?depth=20');
  log('backToBack', { first: a.body.timestamp, second: b.body.timestamp, sameTs: a.body.timestamp === b.body.timestamp, cf: a.headers.get('cf-cache-status') });
  const perps = (await perpIds()).map(([id]) => id);
  const bulk = await get(`/public/orderbook?depth=20&symbols=${perps.join(',')}`);
  const thin = Object.entries(bulk.body).map(([id, v]) => ({ id, bids: v.bid.length, asks: v.ask.length }));
  log('bulk', { status: bulk.status, ms: bulk.ms, bytes: bulk.bytes, books: Object.keys(bulk.body).length, sides: thin });
  const v = await get('/public/orderbook/BTCUSDT_PERP?depth=5&volume=0.5');
  log('volumeParam', { status: v.status, body: v.body });
}

async function errors() {
  const cases = [
    '/public/orderbook/NOPEUSDT_PERP',
    '/public/futures/info/NOPEUSDT_PERP',
    '/public/futures/info/LUNAUSDT_PERP',
    '/public/orderbook/LUNAUSDT_PERP?depth=5',
    '/public/orderbook/WHITEUSDT?depth=5',
    '/public/orderbook/BTCUSDT_PERP?depth=-1',
    '/public/futures/history/funding?limit=5000',
    '/public/nope',
  ];
  for (const p of cases) {
    const r = await get(p);
    log('error', { path: p, status: r.status, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 300) });
    await sleep(200);
  }
  const r = await get('/public/futures/info/BTCUSDT_PERP');
  const hdr = {};
  for (const [k, v] of r.headers) if (!/^(report-to|nel|set-cookie)$/.test(k)) hdr[k] = v.slice(0, 120);
  log('headers', { status: r.status, headers: hdr });
  // No server time call is documented, and the futures/info timestamp is the publication time, so the clock is read from an error body, which is stamped when the request is served.
  const infoLag = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const x = await get('/public/futures/info/BTCUSDT_PERP');
    infoLag.push(x.received - Date.parse(x.body.timestamp));
    const e = await get('/public/symbol/NOPEUSDT_PERP');
    offsets.push(Date.parse(e.body.timestamp) - (e.sent + e.received) / 2);
    await sleep(300);
  }
  offsets.sort((a, b) => a - b);
  infoLag.sort((a, b) => a - b);
  log('clock', { note: 'error body timestamp minus local midpoint, ms', min: offsets[0], median: offsets[5], max: offsets[9], dateHeader: r.headers.get('date') });
  log('infoTimestampAge', { note: 'arrival minus futures/info timestamp, ms', min: infoLag[0], median: infoLag[5], max: infoLag[9] });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, index, funding, book, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
