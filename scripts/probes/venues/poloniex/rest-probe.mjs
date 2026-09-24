// Poloniex futures v3 REST probe: host and latency, the CCXT catalog, the anchor calls polled at one hertz, index baskets, the REST book, error shapes and server time.
// Public, unauthenticated and read-only.
// The public market data limit is 300 requests per second per IP, and this probe stays under 25 per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/poloniex/rest-probe.mjs [main|anchor|baskets]
//   main     host, CCXT catalog against the venue catalog, funding per contract, book, errors, server time, spot catalog count, about 40 s
//   anchor   tickers every 1 s for 60 rounds, with indexPrice, markPrice and fundingRate for four contracts beside it, about 65 s
//   baskets  indexPriceComponents with no symbol, which returns every perpetual in one reply, then the BTC call alone, about 2 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/poloniex/rest.md and docs/profiles/poloniex/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.poloniex.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: Math.min(...xs), median: quantile(xs, 0.5), p90: quantile(xs, 0.9), max: Math.max(...xs) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, init = {}) {
  const t0 = performance.now();
  const res = await fetch(API + path, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const headers = {};
  for (const [k, v] of res.headers) {
    if (/rate|limit|retry|cache|age|x-cache|date|cf-/i.test(k)) headers[k] = v;
  }
  return { status: res.status, ms, bytes: text.length, body, text, headers };
}

async function main() {
  const [a4, cname] = await Promise.all([dns.resolve4('api.poloniex.com').catch((e) => e.code), dns.resolveCname('api.poloniex.com').catch((e) => e.code)]);
  log('dns', { host: 'api.poloniex.com', cname, a: a4 });

  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/timestamp');
    times.push(r.ms);
    await sleep(300);
  }
  log('latency_timestamp', { first: times[0], warm: stats(times.slice(1)) });

  const inst = await get('/v3/market/allInstruments');
  keep('allInstruments.json', inst.text);
  const rows = inst.body.data;
  const byStatus = {};
  const byFamily = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const fam = `${r.sCcy}/${r.ctType}`;
    byFamily[fam] = (byFamily[fam] ?? 0) + 1;
  }
  log('allInstruments', { status: inst.status, ms: inst.ms, bytes: inst.bytes, rows: rows.length, byStatus, byFamily, headers: inst.headers });
  log('instrument_fields', { keys: Object.keys(rows[0]).sort(), aliasValues: [...new Set(rows.map((r) => JSON.stringify(r.alias)))], tFee: rows.filter((r) => 'tFee' in r).length, mFee: rows.filter((r) => 'mFee' in r).length });
  log('instruments', { rows: rows.map((r) => `${r.symbol} ctVal=${r.ctVal} lotSz=${r.lotSz} tSz=${r.tSz} bAsset=${r.bAsset} maxLever=${r.maxLever}`) });

  // CCXT catalog without credentials.
  const ex = new ccxt.poloniex();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const loadMs = Math.round(performance.now() - t0);
  const all = Object.values(markets);
  const contracts = all.filter((m) => m.contract);
  const typeCount = {};
  for (const m of all) typeCount[`${m.type}/swap=${m.swap}/active=${m.active}`] = (typeCount[`${m.type}/swap=${m.swap}/active=${m.active}`] ?? 0) + 1;
  const activeSwaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  log('ccxt_catalog', { version: ccxt.version, loadMs, markets: all.length, contracts: contracts.length, typeCount, activeSwaps: activeSwaps.length });
  const takerSet = [...new Set(contracts.map((m) => m.taker))];
  const makerSet = [...new Set(contracts.map((m) => m.maker))];
  log('ccxt_contract_fees', { taker: takerSet.map(String), maker: makerSet.map(String), takerType: typeof contracts[0]?.taker, hasTakerKey: contracts.length > 0 && 'taker' in contracts[0], feeSide: contracts[0]?.feeSide, exchangeDefaultTaker: ex.fees.trading.taker });
  const btc = contracts.find((m) => m.id === 'BTC_USDT_PERP');
  if (btc) log('ccxt_btc', { id: btc.id, symbol: btc.symbol, type: btc.type, swap: btc.swap, future: btc.future, linear: btc.linear, active: btc.active, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker, settle: btc.settle });
  const ids = new Set(rows.map((r) => r.symbol));
  const ccxtIds = new Set(contracts.map((m) => m.id));
  log('ccxt_ids', { venueRows: ids.size, ccxtContracts: ccxtIds.size, missingInCcxt: [...ids].filter((i) => !ccxtIds.has(i)), extraInCcxt: [...ccxtIds].filter((i) => !ids.has(i)), csMismatch: contracts.filter((m) => Number(rows.find((r) => r.symbol === m.id)?.ctVal) !== m.contractSize).map((m) => m.id) });
  const spot = all.filter((m) => m.spot);
  const quotes = {};
  for (const m of spot) quotes[m.quote] = (quotes[m.quote] ?? 0) + 1;
  log('ccxt_spot', { spot: spot.length, active: spot.filter((m) => m.active).length, byQuote: quotes, taker: [...new Set(spot.map((m) => m.taker))] });
  const pairs = {};
  for (const m of contracts) pairs[`${m.base}/${m.quote}`] = (pairs[`${m.base}/${m.quote}`] ?? 0) + 1;
  log('pairs_listed_twice', { pairs: Object.entries(pairs).filter(([, n]) => n > 1) });

  // Funding per contract, one call each, 4 per second.
  const funding = [];
  for (const r of rows) {
    const f = await get(`/v3/market/fundingRate?symbol=${r.symbol}`);
    const d = f.body.data;
    funding.push({ s: r.symbol, ms: f.ms, fR: d.fR, fT: d.fT, nFR: d.nFR, nFT: d.nFT, hours: (Number(d.nFT) - Number(d.fT)) / 3_600_000, typeof_fT: typeof d.fT });
    await sleep(250);
  }
  const hours = {};
  for (const f of funding) hours[f.hours] = (hours[f.hours] ?? 0) + 1;
  log('funding_all', { now: Date.now(), intervals: hours, nFT: [...new Set(funding.map((f) => f.nFT))], fT: [...new Set(funding.map((f) => f.fT))], ms: stats(funding.map((f) => f.ms)), sample: funding.slice(0, 4) });
  log('funding_rates', { rows: funding.map((f) => `${f.s} fR=${f.fR} nFR=${f.nFR}`) });
  const noSym = await get('/v3/market/fundingRate');
  log('funding_bulk', { status: noSym.status, body: noSym.body });

  // Funding history for BTC, ms bounds.
  const now = Date.now();
  const hist = await get(`/v3/market/fundingRate/history?symbol=BTC_USDT_PERP&sT=${now - 3 * 86_400_000}&eT=${now}&limit=100`);
  log('funding_history_ms', { status: hist.status, rows: hist.body.data?.length, first: hist.body.data?.[0], last: hist.body.data?.at(-1), gapsH: [...new Set((hist.body.data ?? []).slice(1).map((d, i) => (Number(hist.body.data[i].fT) - Number(d.fT)) / 3_600_000))] });
  const histSec = await get(`/v3/market/fundingRate/history?symbol=BTC_USDT_PERP&sT=${Math.floor(now / 1000) - 86_400}&eT=${Math.floor(now / 1000)}`);
  log('funding_history_seconds', { status: histSec.status, body: histSec.body });
  const histNone = await get('/v3/market/fundingRate/history?symbol=BTC_USDT_PERP');
  log('funding_history_default', { status: histNone.status, rows: histNone.body.data?.length, body: histNone.body.data?.[0] });

  // REST book: limits, order, caching.
  for (const limit of [5, 10, 20, 100, 150, 200, 1000]) {
    const b = await get(`/v3/market/orderBook?symbol=BTC_USDT_PERP&limit=${limit}`);
    const d = b.body.data;
    if (!d || !d.bids) {
      log('book_limit', { limit, status: b.status, body: b.body });
    } else {
      const bidsDesc = d.bids.every((l, i) => i === 0 || Number(l[0]) < Number(d.bids[i - 1][0]));
      const asksAsc = d.asks.every((l, i) => i === 0 || Number(l[0]) > Number(d.asks[i - 1][0]));
      log('book_limit', { limit, status: b.status, ms: b.ms, bytes: b.bytes, bids: d.bids.length, asks: d.asks.length, bidsDesc, asksAsc, keys: Object.keys(d), ts: d.ts, s: d.s, headers: b.headers });
    }
    await sleep(250);
  }
  const b0 = await get('/v3/market/orderBook?symbol=BTC_USDT_PERP&limit=20');
  log('book_sample', { top: { bid: b0.body.data.bids[0], ask: b0.body.data.asks[0] }, id: b0.body.data.id, ts: b0.body.data.ts, cT: b0.body.data.cT });
  const scale = await get('/v3/market/orderBook?symbol=BTC_USDT_PERP&limit=5&scale=1');
  log('book_scale', { status: scale.status, bids: scale.body.data?.bids?.slice(0, 3), asks: scale.body.data?.asks?.slice(0, 3) });
  const same = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/v3/market/orderBook?symbol=BTC_USDT_PERP&limit=5');
    same.push(`${r.ms}ms ts=${r.body.data?.ts} ${r.body.data?.bids?.[0]?.join('@')}`);
    await sleep(150);
  }
  log('book_repeat_150ms', { rows: same });

  // Errors.
  for (const p of ['/v3/market/orderBook?symbol=NOPE_USDT_PERP', '/v3/market/fundingRate?symbol=NOPE_USDT_PERP', '/v3/market/tickers?symbol=NOPE_USDT_PERP', '/v3/market/indexPrice?symbol=NOPE_USDT_PERP', '/v3/market/orderBook?symbol=BTC_USDT_PERP&limit=7', '/v3/market/nope', '/v3/market/indexPriceComponents']) {
    const r = await get(p);
    log('error_shape', { path: p, status: r.status, body: typeof r.body === 'string' ? r.body.slice(0, 200) : r.body });
    await sleep(250);
  }

  // Server time and clock offset, from five round trips.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t1 = Date.now();
    const r = await get('/timestamp');
    const t2 = Date.now();
    offsets.push(r.body.serverTime - (t1 + t2) / 2);
    await sleep(300);
  }
  log('clock', { offsetMs: offsets.map((o) => Math.round(o)), median: Math.round(quantile(offsets, 0.5)) });
  const v3time = await get('/v3/market/time');
  log('v3_time', { status: v3time.status, body: v3time.body });
}

async function anchor() {
  const WATCH = ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'FIL_USDT_PERP', '1000SHIB_USDT_PERP'];
  const tickMs = [];
  const idxMs = [];
  const markMs = [];
  const last = new Map();
  const changes = new Map();
  let tickerMismatch = 0;
  let tickerCompared = 0;
  const markKind = { last: 0, nearIndex: 0, other: 0 };
  const bump = (key) => changes.set(key, (changes.get(key) ?? 0) + 1);
  const t0 = Date.now();
  for (let round = 0; round < 60; round++) {
    const start = Date.now();
    const [tk, ip, mp, ...fr] = await Promise.all([
      get('/v3/market/tickers'),
      get('/v3/market/indexPrice'),
      get('/v3/market/markPrice'),
      ...WATCH.map((s) => get(`/v3/market/fundingRate?symbol=${s}`)),
    ]);
    tickMs.push(tk.ms);
    idxMs.push(ip.ms);
    markMs.push(mp.ms);
    if (round === 0) {
      keep('tickers.json', tk.text);
      log('tickers_shape', { status: tk.status, bytes: tk.bytes, rows: tk.body.data.length, keys: Object.keys(tk.body.data[0]).sort(), headers: tk.headers });
      log('index_mark_shape', { indexBytes: ip.bytes, indexRows: ip.body.data.length, markBytes: mp.bytes, markRows: mp.body.data.length });
      log('premium_ppm', { rows: tk.body.data.map((d) => `${d.s} mark-index=${Math.round(((d.mPx - d.iPx) / d.iPx) * 1e6)} mark-last=${Math.round(((d.mPx - d.c) / d.c) * 1e6)} mid-index=${Math.round((((Number(d.bPx) + Number(d.aPx)) / 2 - d.iPx) / d.iPx) * 1e6)}`) });
      log('ticker_mark_zero', { mPxZero: tk.body.data.filter((d) => !(Number(d.mPx) > 0)).map((d) => d.s), iPxZero: tk.body.data.filter((d) => !(Number(d.iPx) > 0)).map((d) => d.s) });
    }
    // Which input of median(Price 1, Price 2, last) the mark equals: the last trade exactly, near the index (Price 1 carries at most the rate times the time share), or neither (Price 2).
    for (const d of tk.body.data) {
      const nearIndex = Math.abs(d.mPx - d.iPx) / d.iPx <= 1e-4;
      const kind = d.mPx === d.c ? 'last' : nearIndex ? 'nearIndex' : 'other';
      markKind[kind]++;
    }
    const idx = new Map(ip.body.data.map((d) => [d.s, d.iPx]));
    const mark = new Map(mp.body.data.map((d) => [d.s, d.mPx]));
    for (const d of tk.body.data) {
      tickerCompared++;
      if (idx.get(d.s) !== d.iPx || mark.get(d.s) !== d.mPx) tickerMismatch++;
    }
    for (const s of WATCH) {
      const t = tk.body.data.find((d) => d.s === s);
      const f = fr[WATCH.indexOf(s)].body.data;
      const now = { iPx: t.iPx, mPx: t.mPx, bPx: t.bPx, c: t.c, cT: t.cT, nFR: f.nFR, fR: f.fR, nFT: f.nFT };
      const prev = last.get(s);
      if (prev) {
        for (const k of Object.keys(now)) if (prev[k] !== now[k]) bump(`${s}.${k}`);
      }
      last.set(s, now);
    }
    const spent = Date.now() - start;
    await sleep(Math.max(0, 1000 - spent));
  }
  log('anchor_times', { seconds: Math.round((Date.now() - t0) / 1000), tickers: stats(tickMs), indexPrice: stats(idxMs), markPrice: stats(markMs) });
  log('anchor_changes_in_59_intervals', Object.fromEntries([...changes.entries()].sort()));
  log('mark_equals', markKind);
  log('ticker_vs_index_mark_calls', { compared: tickerCompared, differing: tickerMismatch });
  log('anchor_last', Object.fromEntries(last));
}

async function baskets() {
  const bulk = await get('/v3/market/indexPriceComponents');
  keep('indexPriceComponents.json', bulk.text);
  const out = [];
  for (const d of bulk.body.data) {
    const live = d.cs.filter((x) => Number(x.w) > 0);
    const polo = d.cs.find((x) => x.e.toLowerCase() === 'poloniex');
    const wsum = d.cs.reduce((a, x) => a + Number(x.w), 0);
    const cpx = d.cs.reduce((a, x) => a + Number(x.cPx), 0);
    out.push(`${d.s} px=${d.px} sumCPx=${cpx.toPrecision(10)} sumW=${wsum.toFixed(6)} sources=${d.cs.length} weighted=${live.length} polo=${polo ? Number(polo.w).toFixed(3) : 'absent'} ${live.map((x) => `${x.e}:${Number(x.w).toFixed(3)}`).join(',')}`);
  }
  log('baskets_bulk', { status: bulk.status, ms: bulk.ms, bytes: bulk.bytes, rows: bulk.body.data.length });
  log('baskets', { rows: out });
  const exch = {};
  for (const d of bulk.body.data) for (const x of d.cs) exch[x.e] = (exch[x.e] ?? 0) + (Number(x.w) > 0 ? 1 : 0);
  log('basket_sources_weighted_count', exch);
  const one = await get('/v3/market/indexPriceComponents?symbol=BTC_USDT_PERP');
  log('basket_single', { status: one.status, ms: one.ms, bytes: one.bytes, px: one.body.data?.[0]?.px });
}

const mode = process.argv[2] ?? 'main';
const run = { main, anchor, baskets }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { at: new Date().toISOString() });
