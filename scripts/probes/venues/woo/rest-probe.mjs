// WOO X public REST probe: catalog and CCXT mapping, the anchor calls, one second anchor polls, the REST book with and without RPI, errors, server time.
// Public, unauthenticated, read-only. Every mode stays under 3 requests per second, and WOO X publishes 10 per second per IP for each public v3 call.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/woo/rest-probe.mjs [catalog|anchor|book|errors|time|history]
//   catalog  DNS, cold and warm timing of the v3 public calls, catalog counts, CCXT 4.5.68 loadMarkets mapping and market.taker.
//   anchor   60 polls at 1 s of /v3/public/futures and /v3/public/fundingRate, reply size and time, how often each field changes.
//   book     REST book for a few perps with and without RPI, level order, depth limits, how long the book timestamp stays put.
//   errors   unknown symbol, bad parameter and unknown path replies, and the response headers.
//   time     server time against the local clock, 10 samples.
//   history  funding rate history for two perps, settlement stamps against the published next funding time.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/woo/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.woox.io';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'accept-encoding': 'gzip' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, json, text, headers: res.headers };
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (arr) => ({ n: arr.length, min: Math.min(...arr), median: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) });

async function catalog() {
  const addrs = await lookup('api.woox.io', { all: true });
  log('dns', { host: 'api.woox.io', addrs: addrs.map((a) => a.address) });
  for (const p of ['/v3/public/systemInfo', '/v3/public/instruments', '/v3/public/futures', '/v3/public/fundingRate']) {
    const times = [];
    let last;
    for (let i = 0; i < 4; i++) {
      last = await get(p);
      times.push(last.ms);
      await sleep(400);
    }
    keep(p.split('/').pop() + '.json', last.text);
    log('call', { path: p, status: last.status, bytes: last.bytes, rows: last.json?.data?.rows?.length, firstMs: times[0], warmMs: times.slice(1) });
  }

  const inst = (await get('/v3/public/instruments')).json.data.rows;
  const perps = inst.filter((r) => r.symbol.startsWith('PERP_'));
  const byStatus = {};
  for (const r of inst) byStatus[`${r.symbol.split('_')[0]}_${r.quoteAsset}:${r.status}`] = (byStatus[`${r.symbol.split('_')[0]}_${r.quoteAsset}:${r.status}`] ?? 0) + 1;
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  log('instruments', {
    byTypeQuoteStatus: byStatus,
    fundingIntervalHours: count(perps, (r) => r.fundingIntervalHours),
    fundingCapFloor: count(perps, (r) => `${r.fundingCap}/${r.fundingFloor}`),
    baseAssetMultiplier: count(perps, (r) => r.baseAssetMultiplier),
    orderMode: count(perps, (r) => r.orderMode),
    isAllowedRpi: count(perps, (r) => r.isAllowedRpi),
    impactNotional: count(perps, (r) => r.impactNotional),
  });

  const ex = new ccxt.woo();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.swap);
  const active = swaps.filter((m) => m.active);
  const btc = markets['BTC/USDT:USDT'];
  log('ccxt', {
    version: ccxt.version,
    loadMs: Math.round(performance.now() - t0),
    swaps: swaps.length,
    activeSwaps: active.length,
    bySettle: count(active, (m) => m.settle),
    linear: count(active, (m) => m.linear),
    contractSize: count(active, (m) => m.contractSize),
    taker: count(active, (m) => m.taker),
    maker: count(active, (m) => m.maker),
    feeSide: count(active, (m) => String(m.tierBased)),
    btc: btc && { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, settle: btc.settle, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker, precision: btc.precision, active: btc.active },
  });

  const pairs = count(active, (m) => `${m.base}/${m.quote}`);
  log('ccxt_twice', { pairsListedTwice: Object.entries(pairs).filter(([, n]) => n > 1) });
  const futures = (await get('/v3/public/futures')).json.data.rows;
  const futIds = new Set(futures.map((r) => r.symbol));
  const idMiss = active.filter((m) => !futIds.has(m.id)).map((m) => m.id);
  log('id_match', { activeSwaps: active.length, futuresRows: futures.length, ccxtIdsMissingFromFutures: idMiss, futuresMissingFromCcxt: futures.filter((r) => !active.some((m) => m.id === r.symbol)).map((r) => r.symbol) });
  const odd = active.filter((m) => /^\d/.test(m.base) || /^\d/.test(m.baseId)).map((m) => `${m.id}:${m.base}`);
  log('numeric_bases', { odd });
}

async function anchor() {
  const WATCH = ['PERP_BTC_USDT', 'PERP_ETH_USDT', 'PERP_TAO_USDT', 'PERP_WOO_USDT', 'PERP_EWT_USDT'];
  const fut = { ms: [], bytes: [] };
  const fr = { ms: [], bytes: [] };
  const prev = {};
  const changes = {};
  let markEqIndex = [];
  let premiums = [];
  let estTs = new Set();
  let serverLag = [];
  for (let i = 0; i < 60; i++) {
    const tick = Date.now();
    const [a, b] = await Promise.all([get('/v3/public/futures'), get('/v3/public/fundingRate')]);
    fut.ms.push(a.ms);
    fut.bytes.push(a.bytes);
    fr.ms.push(b.ms);
    fr.bytes.push(b.bytes);
    if (i === 0) {
      keep('futures-poll0.json', a.text);
      keep('fundingRate-poll0.json', b.text);
    }
    serverLag.push(Date.now() - a.json.timestamp);
    const rows = a.json.data.rows;
    const frRows = new Map(b.json.data.rows.map((r) => [r.symbol, r]));
    markEqIndex.push(rows.filter((r) => r.markPrice === r.indexPrice).length);
    if (i === 0) {
      for (const r of rows) {
        const idx = Number(r.indexPrice);
        if (idx > 0) premiums.push([r.symbol, Math.round(((Number(r.markPrice) - idx) / idx) * 1e6)]);
      }
    }
    for (const r of b.json.data.rows) estTs.add(r.estFundingRateTimestamp);
    for (const s of WATCH) {
      const r = rows.find((x) => x.symbol === s);
      const f = frRows.get(s);
      if (!r || !f) continue;
      const cur = { index: r.indexPrice, mark: r.markPrice, est: r.estFundingRate, next: r.nextFundingTime, estTs: f.estFundingRateTimestamp, interval: f.estFundingIntervalHours };
      changes[s] ??= { index: 0, mark: 0, est: 0, next: 0, estTs: 0, interval: 0 };
      if (prev[s]) for (const k of Object.keys(cur)) if (cur[k] !== prev[s][k]) changes[s][k]++;
      prev[s] = cur;
    }
    const wait = 1000 - (Date.now() - tick);
    if (wait > 0) await sleep(wait);
  }
  log('futures_poll', { ms: stats(fut.ms), bytes: stats(fut.bytes) });
  log('fundingRate_poll', { ms: stats(fr.ms), bytes: stats(fr.bytes) });
  log('changes_in_59_intervals', changes);
  log('last_values', prev);
  log('mark_equals_index_rows', stats(markEqIndex));
  premiums.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  log('premium_ppm_first_poll', { top: premiums.slice(0, 8), zero: premiums.filter((p) => p[1] === 0).length, rows: premiums.length });
  log('estFundingRateTimestamp_distinct', { n: estTs.size, sample: [...estTs].sort().slice(-4) });
  log('arrival_minus_reply_timestamp_ms', stats(serverLag));
}

async function book() {
  const syms = ['PERP_BTC_USDT', 'PERP_ETH_USDT', 'PERP_SOL_USDT', 'PERP_TAO_USDT', 'PERP_CHR_USDT'];
  const inst = new Set((await get('/v3/public/instruments')).json.data.rows.map((r) => r.symbol));
  for (const s of syms) {
    if (!inst.has(s)) {
      log('book_skip', { symbol: s, reason: 'not listed' });
      continue;
    }
    for (const rpi of [false, true]) {
      const r = await get(`/v3/public/orderbook?symbol=${s}&maxLevel=500&rpi=${rpi}`);
      const d = r.json.data;
      const bids = d.bids.map((l) => Number(l.price));
      const asks = d.asks.map((l) => Number(l.price));
      const desc = (a) => a.every((p, i) => i === 0 || p < a[i - 1]);
      const asc = (a) => a.every((p, i) => i === 0 || p > a[i - 1]);
      const mid = (bids[0] + asks[0]) / 2;
      const notional = (side, n) => side.slice(0, n).reduce((s, l) => s + Number(l.price) * Number(l.quantity), 0);
      log('book', {
        symbol: s, rpi, status: r.status, ms: r.ms, bytes: r.bytes, ageMs: Date.now() - r.json.timestamp,
        levels: [bids.length, asks.length], bidOrder: desc(bids) ? 'descending' : asc(bids) ? 'ascending' : 'mixed', askOrder: asc(asks) ? 'ascending' : desc(asks) ? 'descending' : 'mixed',
        bestBid: d.bids[0], bestAsk: d.asks[0], spreadPpm: Math.round(((asks[0] - bids[0]) / mid) * 1e6),
        top20NotionalUsdt: [Math.round(notional(d.bids, 20)), Math.round(notional(d.asks, 20))],
      });
      await sleep(400);
    }
  }
  for (const lvl of [1, 20, 50, 100, 200, 500, 1000]) {
    const r = await get(`/v3/public/orderbook?symbol=PERP_ETH_USDT&maxLevel=${lvl}`);
    log('maxLevel', { maxLevel: lvl, status: r.status, levels: r.json?.data ? [r.json.data.bids.length, r.json.data.asks.length] : r.text.slice(0, 160) });
    await sleep(400);
  }
  const r0 = await get('/v3/public/orderbook?symbol=PERP_ETH_USDT');
  log('maxLevel_default', { levels: [r0.json.data.bids.length, r0.json.data.asks.length] });
  for (const [s, rpi] of [['PERP_BTC_USDT', false], ['PERP_BTC_USDT', true], ['PERP_ETH_USDT', false]]) {
    const seen = [];
    for (let i = 0; i < 20; i++) {
      const r = await get(`/v3/public/orderbook?symbol=${s}&maxLevel=20&rpi=${rpi}`);
      seen.push(r.json.timestamp);
      await sleep(1000);
    }
    const distinct = new Set(seen);
    log('book_timestamp_20s', { symbol: s, rpi, distinct: distinct.size, oldestAgeAtEndMs: Date.now() - Math.min(...seen) });
  }
}

async function errors() {
  const cases = [
    '/v3/public/orderbook?symbol=PERP_NOPE_USDT',
    '/v3/public/orderbook',
    '/v3/public/orderbook?symbol=PERP_BTC_USDT&maxLevel=abc',
    '/v3/public/futures?symbol=PERP_NOPE_USDT',
    '/v3/public/fundingRate?symbol=PERP_NOPE_USDT',
    '/v3/public/fundingRate?symbol=SPOT_BTC_USDT',
    '/v3/public/nope',
    '/v1/public/futures',
  ];
  for (const c of cases) {
    const r = await get(c);
    log('error_case', { path: c, status: r.status, body: r.text.slice(0, 220) });
    await sleep(400);
  }
  const r = await get('/v3/public/futures');
  const h = {};
  for (const [k, v] of r.headers) h[k] = v;
  log('headers', h);
}

async function time() {
  const off = [];
  const rtt = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get('/v3/public/systemInfo');
    const t1 = Date.now();
    rtt.push(t1 - t0);
    off.push(r.json.timestamp - (t0 + t1) / 2);
    await sleep(500);
  }
  log('clock', { offsetMs: stats(off.map(Math.round)), rttMs: stats(rtt) });
  const s = await get('/v3/public/systemInfo');
  log('systemInfo', { body: s.json });
}

async function history() {
  for (const s of ['PERP_BTC_USDT', 'PERP_TAO_USDT']) {
    const h = await get(`/v3/public/fundingRateHistory?symbol=${s}&size=6`);
    const rows = h.json?.data?.rows ?? [];
    const f = await get(`/v3/public/fundingRate?symbol=${s}`);
    log('funding_history', {
      symbol: s, status: h.status, meta: h.json?.data?.meta,
      rows: rows.map((r) => ({ rate: r.fundingRate, at: new Date(r.fundingRateTimestamp).toISOString(), next: new Date(r.nextFundingTime).toISOString(), mark: r.markPrice })),
      current: f.json?.data?.rows?.[0] ?? f.json?.data,
    });
    await sleep(500);
  }
}

const modes = { catalog, anchor, book, errors, time, history };
const mode = process.argv[2] ?? 'catalog';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
