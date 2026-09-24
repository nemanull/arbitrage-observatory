// CoinTR public REST probe: spot catalog, the documented futures endpoints, latency, clock offset, the REST book, headers and error shapes.
// Public, unauthenticated, read-only. Every request is a GET well inside the documented 20 per second per endpoint.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/cointr/rest-probe.mjs [catalog|futures|latency|book|errors|ccxt]
//   catalog  spot symbols by status and quote, tickers, the fee fields in the catalog, the documented VIP fee call.
//   futures  every documented /api/v2/mix market call for the three product types, and the legacy CoinTR Pro host.
//   latency  DNS, one cold and twenty warm requests to three calls, and the clock offset against /api/v2/public/time.
//   book     orderbook and merge-depth on a busy USDT pair, a TRY pair and a quiet pair: level order, depth, repeats and caching.
//   errors   unknown symbol, unknown path and bad parameter replies, and the response headers of a normal call.
//   ccxt     whether CCXT 4.5.68 knows the venue, and what its bitget class reads from api.cointr.com when pointed at it.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/cointr/rest.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.cointr.com';
const LEGACY = 'https://api.cointr.pro';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

async function get(url, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: Object.fromEntries(res.headers) };
}

const short = (r) => (r.json ? JSON.stringify({ code: r.json.code, msg: r.json.msg, data: r.json.data === null ? null : typeof r.json.data }) : r.text.slice(0, 160).replace(/\s+/g, ' '));

async function catalog() {
  const sym = await get(`${API}/api/v2/spot/public/symbols`);
  capture('symbols.json', sym.text);
  const rows = sym.json.data;
  const byStatus = {};
  const byQuote = {};
  const fees = {};
  for (const s of rows) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    byQuote[s.quoteCoin] = (byQuote[s.quoteCoin] ?? 0) + 1;
    const k = `${s.quoteCoin} maker ${s.makerFeeRate} taker ${s.takerFeeRate}`;
    fees[k] = (fees[k] ?? 0) + 1;
  }
  log('symbols', { status: sym.status, ms: sym.ms, bytes: sym.bytes, rows: rows.length, byStatus, byQuote });
  log('catalog_fee_fields', { fees });
  log('not_online', { rows: rows.filter((s) => s.status !== 'online').map((s) => `${s.symbol}:${s.status}`) });
  log('symbol_example', { row: rows.find((s) => s.symbol === 'BTCUSDT') });
  const pairsTwice = {};
  for (const s of rows) pairsTwice[`${s.baseCoin}/${s.quoteCoin}`] = (pairsTwice[`${s.baseCoin}/${s.quoteCoin}`] ?? 0) + 1;
  log('pairs_listed_twice', { pairs: Object.entries(pairsTwice).filter(([, n]) => n > 1) });
  const concat = rows.filter((s) => s.symbol !== s.baseCoin + s.quoteCoin).map((s) => s.symbol);
  log('symbol_not_base_plus_quote', { symbols: concat });

  const tick = await get(`${API}/api/v2/spot/market/tickers`);
  capture('tickers.json', tick.text);
  const t = tick.json.data;
  const usdt = t.filter((x) => x.symbol.endsWith('USDT') && !x.symbol.endsWith('SUSDT')).sort((a, b) => Number(b.usdtVolume) - Number(a.usdtVolume));
  const tr = t.filter((x) => x.symbol.endsWith('TRY')).sort((a, b) => Number(b.usdtVolume) - Number(a.usdtVolume));
  const sum = (a) => Math.round(a.reduce((s, x) => s + Number(x.usdtVolume), 0));
  const noBook = t.filter((x) => !(Number(x.bidPr) > 0) || !(Number(x.askPr) > 0)).map((x) => x.symbol);
  log('tickers', { status: tick.status, ms: tick.ms, bytes: tick.bytes, rows: t.length, usdtRows: usdt.length, tryRows: tr.length, usdtVolumeUsdtQuoted: sum(usdt), usdtVolumeTryQuoted: sum(tr), oneSidedOrEmpty: noBook.length, oneSidedExamples: noBook.slice(0, 8) });
  log('top_usdt', { rows: usdt.slice(0, 8).map((x) => `${x.symbol} ${Math.round(Number(x.usdtVolume))} bid ${x.bidPr} ask ${x.askPr}`) });
  log('top_try', { rows: tr.slice(0, 5).map((x) => `${x.symbol} ${Math.round(Number(x.usdtVolume))} bid ${x.bidPr} ask ${x.askPr}`) });
  const quiet = usdt.filter((x) => Number(x.usdtVolume) > 0).slice(-5);
  log('quiet_usdt', { rows: quiet.map((x) => `${x.symbol} ${Number(x.usdtVolume).toFixed(0)} bid ${x.bidPr} ask ${x.askPr}`) });
  log('ticker_example', { row: t.find((x) => x.symbol === 'BTCUSDT') });
  const spreads = usdt.slice(0, 20).map((x) => Math.round(((Number(x.askPr) - Number(x.bidPr)) / Number(x.bidPr)) * 1e6));
  log('top20_usdt_spread_ppm', { spreads });

  const vip = await get(`${API}/api/v2/spot/market/vip-fee-rate`);
  capture('vip-fee-rate.json', vip.text);
  log('spot_vip_fee_rate', { status: vip.status, ms: vip.ms, body: vip.json?.data ?? short(vip) });

  const coins = await get(`${API}/api/v2/spot/public/coins`);
  log('spot_coins', { status: coins.status, bytes: coins.bytes, rows: Array.isArray(coins.json?.data) ? coins.json.data.length : short(coins) });
}

async function futures() {
  const types = ['USDT-FUTURES', 'usdt-futures', 'COIN-FUTURES', 'USDC-FUTURES', 'SUSDT-FUTURES'];
  for (const pt of types) {
    for (const path of [`/api/v2/mix/market/contracts?productType=${pt}`, `/api/v2/mix/market/tickers?productType=${pt}`]) {
      const r = await get(API + path);
      log('mix', { path, status: r.status, ms: r.ms, body: short(r) });
      await sleep(150);
    }
  }
  const single = [
    '/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=usdt-futures',
    '/api/v2/mix/market/current-fund-rate?symbol=BTCUSDT&productType=usdt-futures',
    '/api/v2/mix/market/history-fund-rate?symbol=BTCUSDT&productType=usdt-futures',
    '/api/v2/mix/market/funding-time?symbol=BTCUSDT&productType=usdt-futures',
    '/api/v2/mix/market/symbol-price?symbol=BTCUSDT&productType=usdt-futures',
    '/api/v2/mix/market/merge-depth?symbol=BTCUSDT&productType=usdt-futures',
    '/api/v2/mix/market/open-interest?symbol=BTCUSDT&productType=usdt-futures',
    '/api/v2/mix/market/vip-fee-rate',
    '/api/v2/mix/market/candles?symbol=BTCUSDT&productType=usdt-futures&granularity=1m',
    '/api/v2/mix/market/history-index-candles?symbol=BTCUSDT&productType=usdt-futures&granularity=1m',
    '/api/v2/mix/market/history-mark-candles?symbol=BTCUSDT&productType=usdt-futures&granularity=1m',
    '/api/mix/v1/market/contracts?productType=umcbl',
  ];
  for (const path of single) {
    const r = await get(API + path);
    log('mix', { path, status: r.status, ms: r.ms, body: short(r) });
    await sleep(150);
  }
  for (const path of ['/v1/spot/public/time', '/v1/spot/public/instruments', '/v1/futures/public/instruments', '/v1/futures/market/tickers', '/']) {
    const r = await get(LEGACY + path);
    log('legacy', { url: LEGACY + path, status: r.status, ms: r.ms, body: short(r) });
    await sleep(150);
  }
  for (const host of ['api.cointr.pro', 'stream.cointr.pro']) {
    try {
      const addrs = await lookup(host, { all: true });
      log('legacy_dns', { host, addrs: addrs.map((a) => a.address) });
    } catch (e) {
      log('legacy_dns', { host, error: e.code });
    }
  }
}

async function latency() {
  const host = new URL(API).host;
  const t0 = performance.now();
  const addrs = await lookup(host, { all: true });
  log('dns', { host, ms: Math.round(performance.now() - t0), addrs: addrs.map((a) => a.address) });
  const calls = ['/api/v2/public/time', '/api/v2/spot/market/tickers', '/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=150'];
  for (const path of calls) {
    const times = [];
    for (let i = 0; i < 21; i++) {
      const r = await get(API + path);
      times.push(r.ms);
      await sleep(250);
    }
    const cold = times[0];
    const warm = times.slice(1).sort((a, b) => a - b);
    log('latency', { path, cold, warmMin: warm[0], warmMedian: warm[10], warmP90: warm[17], warmMax: warm[19] });
  }
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get(`${API}/api/v2/public/time`);
    const after = Date.now();
    const server = Number(r.json.data.serverTime);
    offsets.push({ offset: server - (before + after) / 2, rtt: after - before, requestTime: r.json.requestTime - server });
    await sleep(300);
  }
  offsets.sort((a, b) => a.rtt - b.rtt);
  log('clock', { bestRttMs: offsets[0].rtt, offsetAtBestRttMs: Math.round(offsets[0].offset), offsets: offsets.map((o) => Math.round(o.offset)), requestTimeMinusServerTime: offsets.map((o) => o.requestTime) });
}

function orderInfo(side, levels, desc) {
  let bad = 0;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (desc ? b >= a : b <= a) bad++;
  }
  return { side, n: levels.length, first: levels[0], last: levels.at(-1), outOfOrder: bad };
}

async function book() {
  const tick = await get(`${API}/api/v2/spot/market/tickers`);
  const usdt = tick.json.data.filter((x) => x.symbol.endsWith('USDT') && !x.symbol.endsWith('SUSDT')).sort((a, b) => Number(b.usdtVolume) - Number(a.usdtVolume));
  const quiet = usdt.filter((x) => Number(x.usdtVolume) > 0).at(-3).symbol;
  for (const sym of ['BTCUSDT', 'USDTTRY', quiet]) {
    const r = await get(`${API}/api/v2/spot/market/orderbook?symbol=${sym}&type=step0&limit=150`);
    capture(`orderbook-${sym}.json`, r.text);
    const d = r.json?.data;
    if (!d) {
      log('orderbook', { sym, status: r.status, body: short(r) });
      continue;
    }
    log('orderbook', { sym, status: r.status, ms: r.ms, bytes: r.bytes, keys: Object.keys(d), ts: d.ts, ageMs: Date.now() - Number(d.ts), bids: orderInfo('bids', d.bids, true), asks: orderInfo('asks', d.asks, false) });
    const m = await get(`${API}/api/v2/spot/market/merge-depth?symbol=${sym}&precision=scale0&limit=max`);
    const md = m.json?.data;
    log('merge_depth', { sym, status: m.status, ms: m.ms, bytes: m.bytes, keys: md ? Object.keys(md) : short(m), bids: md?.bids?.length, asks: md?.asks?.length, precision: md?.precision, scale: md?.scale, isMaxPrecision: md?.isMaxPrecision });
    await sleep(200);
  }
  for (const limit of [5, 15, 50, 100, 150, 200]) {
    const r = await get(`${API}/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=${limit}`);
    log('orderbook_limit', { limit, status: r.status, bids: r.json?.data?.bids?.length, asks: r.json?.data?.asks?.length, body: r.json?.data ? undefined : short(r) });
    await sleep(150);
  }
  // Two reads in quick succession, with and without a cache buster, to see whether an edge cache serves a stale book.
  const seen = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${API}/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=5${i % 2 ? `&_=${Date.now()}` : ''}`);
    seen.push({ ts: r.json.data.ts, cf: r.headers['cf-cache-status'] ?? null, age: r.headers.age ?? null, ms: r.ms });
    await sleep(120);
  }
  log('orderbook_repeat', { seen });
}

async function errors() {
  const cases = [
    `${API}/api/v2/spot/market/orderbook?symbol=NOPEUSDT&type=step0&limit=5`,
    `${API}/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step9&limit=5`,
    `${API}/api/v2/spot/market/orderbook?type=step0&limit=5`,
    `${API}/api/v2/spot/market/tickers?symbol=NOPEUSDT`,
    `${API}/api/v2/spot/public/symbols?symbol=NOPEUSDT`,
    `${API}/api/v2/spot/market/nope`,
    `${API}/api/v3/spot/public/symbols`,
  ];
  for (const url of cases) {
    const r = await get(url);
    log('error', { path: url.slice(API.length), status: r.status, body: r.text.slice(0, 200) });
    await sleep(150);
  }
  const r = await get(`${API}/api/v2/spot/market/tickers?symbol=BTCUSDT`);
  const keep = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !['set-cookie', 'report-to', 'nel'].includes(k)));
  log('headers', { status: r.status, headers: keep });
  const g = await get(`${API}/api/v2/spot/market/tickers?symbol=BTCUSDT`, { 'accept-encoding': 'gzip' });
  log('gzip', { status: g.status, contentEncoding: g.headers['content-encoding'] ?? null });
}

async function ccxtMode() {
  const ccxt = require('ccxt');
  const ids = ccxt.exchanges.filter((id) => /cointr|coin_tr|metx/i.test(id));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ids });
  // CoinTR's API reproduces Bitget's V2 paths, so this asks what the bitget class reads when its host is swapped.
  const ex = new ccxt.bitget({ options: { fetchMarkets: { types: ['spot'] } } });
  ex.urls.api = Object.fromEntries(Object.keys(ex.urls.api).map((k) => [k, API]));
  const urls = [];
  const fetchOrig = ex.fetch.bind(ex);
  ex.fetch = (url, ...rest) => {
    urls.push(url.slice(API.length));
    return fetchOrig(url, ...rest);
  };
  const tryMarkets = async (tag) => {
    try {
      const markets = await ex.fetchMarkets();
      const m = markets.find((x) => x.id === 'BTCUSDT');
      log(tag, { urls, markets: markets.length, active: markets.filter((x) => x.active).length, btc: m && { id: m.id, symbol: m.symbol, type: m.type, active: m.active, taker: m.taker, maker: m.maker, precision: m.precision } });
    } catch (e) {
      log(tag, { urls, error: String(e).slice(0, 300) });
    }
  };
  await tryMarkets('ccxt_bitget_on_cointr');
  // fetchDefaultMarkets always adds the margin currencies call for spot, which CoinTR does not serve, so the second try stubs it.
  urls.length = 0;
  ex.publicMarginGetV2MarginCurrencies = async () => ({ code: '00000', data: [] });
  await tryMarkets('ccxt_bitget_on_cointr_margin_stubbed');
  try {
    const ob = await ex.fetchOrderBook('BTC/USDT', 5);
    log('ccxt_bitget_on_cointr_book', { bids: ob.bids.slice(0, 2), asks: ob.asks.slice(0, 2), timestamp: ob.timestamp });
  } catch (e) {
    log('ccxt_bitget_on_cointr_book', { error: String(e).slice(0, 300) });
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, futures, latency, book, errors, ccxt: ccxtMode };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
