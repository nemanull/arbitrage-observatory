// Orbix spot REST probe: host and latency, the spot catalog, the REST book, the tickers, the public fee call, error shapes, and server time.
// Orbix lists no perpetuals, so there is no index, mark or funding call to poll, and the probe checks that the Binance style names for them are absent.
// Public, unauthenticated and read-only.
// Every loop keeps at least 500 ms between two requests, far under the published 160 GET requests per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/orbix/rest-probe.mjs [catalog|book|poll|errors|time|all]
//   catalog  DNS, cold and warm request time, exchangeInfo, tickers and one sided books, the web configs symbols, the public fee call, the CCXT id list, about 15 s
//   book     REST depth on four pairs at several limits, level order, caching across ten reads, about 15 s
//   poll     ticker/24hr and depth polled once a second for 60 rounds, reply time and change counts, about 65 s
//   errors   unknown, upper case and halted symbols, unknown paths, the Binance anchor paths, the per pair fee call and the web app's broker paths, about 12 s
//   time     serverTime from /v3/time and from exchangeInfo against the local clock, six samples each, about 15 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/orbix/rest.md and docs/profiles/orbix/fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'www.orbixtrade.com';
const API = `https://${HOST}/api`;
const OUT = process.env.PROBE_OUT_DIR;
const PAIRS = ['usdt_thb', 'btc_thb', 'eth_thb', 'xlm_thb'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const pick = (h, names) => Object.fromEntries(names.filter((n) => h.get(n) !== null).map((n) => [n, h.get(n)]));
const HEADERS = ['x-amz-cf-pop', 'x-cache-status', 'x-cache', 'cache-control', 'age', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-mbx-used-weight', 'server'];

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });

  const cold = await get('/v3/ping');
  const warm = [];
  for (let i = 0; i < 5; i++) {
    await sleep(500);
    warm.push((await get('/v3/ping')).ms);
  }
  log('ping', { status: cold.status, body: cold.text, coldMs: cold.ms, warmMs: warm, headers: pick(cold.headers, HEADERS) });

  const info = await get('/v3/exchangeInfo');
  keep('exchangeInfo.json', info.text);
  const syms = info.json.symbols;
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  log('exchangeInfo', {
    status: info.status, ms: info.ms, bytes: info.bytes, symbols: syms.length,
    byStatus: count(syms, (s) => s.status), byQuote: count(syms, (s) => s.quoteAsset),
    margin: syms.filter((s) => s.isMarginTradingAllowed).length,
    orderTypes: [...new Set(syms.flatMap((s) => s.orderTypes))],
    filterTypes: [...new Set(syms.flatMap((s) => s.filters.map((f) => f.filterType)))],
    notTrading: syms.filter((s) => s.status !== 'TRADING').map((s) => s.symbol),
    rateLimits: info.json.rateLimits, keys: Object.keys(info.json),
  });

  await sleep(500);
  const tick = await get('/v3/ticker/24hr');
  keep('ticker24hr.json', tick.text);
  const rows = tick.json;
  const trading = new Set(syms.filter((s) => s.status === 'TRADING').map((s) => s.symbol));
  const tickSyms = new Set(rows.map((r) => r.symbol));
  const now = Date.now();
  log('ticker24hr', {
    status: tick.status, ms: tick.ms, bytes: tick.bytes, rows: rows.length, keys: Object.keys(rows[0]),
    notInExchangeInfo: rows.filter((r) => !syms.some((s) => s.symbol === r.symbol)).map((r) => r.symbol).slice(0, 20),
    tradingWithoutTicker: [...trading].filter((s) => !tickSyms.has(s)),
    withTrades24h: rows.filter((r) => Number(r.count) > 0).length,
    zeroAsk: rows.filter((r) => Number(r.askPrice) === 0).length,
    zeroBid: rows.filter((r) => Number(r.bidPrice) === 0).length,
    closeTimeOlderThan1h: rows.filter((r) => now - r.closeTime > 3_600_000).length,
    sample: rows.find((r) => r.symbol === 'btc_thb'),
  });

  // ticker/24hr reports a missing side as "0", so it shows which books are one sided or empty.
  const side = (r) => (Number(r.bidPrice) > 0 ? 'b' : '') + (Number(r.askPrice) > 0 ? 'a' : '');
  const bySide = count(rows, (r) => ({ ba: 'both', b: 'bidOnly', a: 'askOnly', '': 'none' })[side(r)]);
  log('sides', { bySide, bidOnly: rows.filter((r) => side(r) === 'b').map((r) => r.symbol).slice(0, 6), askOnly: rows.filter((r) => side(r) === 'a').map((r) => r.symbol).slice(0, 6), none: rows.filter((r) => side(r) === '').map((r) => r.symbol).slice(0, 6) });
  for (const want of ['a', 'b', '']) {
    const r0 = rows.find((r) => side(r) === want);
    if (!r0) continue;
    await sleep(500);
    const d = await get(`/v3/depth?symbol=${r0.symbol}&limit=20`);
    log('sideDepth', { pair: r0.symbol, tickerSide: want || 'none', status: d.status, body: d.text.slice(0, 240) });
  }
  const active = rows.filter((r) => Number(r.count) > 0).sort((x, y) => Number(y.quoteVolume) - Number(x.quoteVolume));
  log('active24h', { pairs: active.length, byQuoteVolumeThb: active.map((r) => `${r.symbol}:${r.count}:${Math.round(Number(r.quoteVolume))}`) });

  await sleep(500);
  const obt = await get('/orderbook-tickers/');
  const obtKeys = Object.keys(obt.json);
  log('orderbookTickers', { status: obt.status, ms: obt.ms, bytes: obt.bytes, pairs: obtKeys.length, spelling: obtKeys.slice(0, 3), usdt: obt.json.USDT_THB });

  await sleep(500);
  const cfg = await get('/configs/');
  const cfgSyms = cfg.json.trading.symbols;
  log('configs', {
    status: cfg.status, ms: cfg.ms, bytes: cfg.bytes, symbols: cfgSyms.length,
    createOrderDisabled: cfgSyms.filter((s) => !s.createOrderEnabled).map((s) => s.symbol),
    kyc: { foreigner_use_version: cfg.json.kyc.foreigner_use_version, thai_use_version: cfg.json.kyc.thai_use_version },
    btc: cfgSyms.find((s) => s.symbol === 'btc_thb'),
  });

  await sleep(500);
  const fees = await get('/trading-fees/');
  log('tradingFees', { status: fees.status, ms: fees.ms, body: fees.json });

  const ids = ccxt.exchanges.filter((id) => /orbix|satang|tdax/i.test(id));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ids });
}

async function book() {
  for (const pair of PAIRS) {
    for (const limit of [undefined, 5, 20, 100, 500, 1000]) {
      const r = await get(`/v3/depth?symbol=${pair}${limit === undefined ? '' : `&limit=${limit}`}`);
      if (r.json?.bids === undefined) {
        log('depth', { pair, limit, status: r.status, body: r.text.slice(0, 200) });
        await sleep(500);
        continue;
      }
      const b = r.json.bids.map((l) => Number(l[0]));
      const a = r.json.asks.map((l) => Number(l[0]));
      log('depth', {
        pair, limit, status: r.status, ms: r.ms, bytes: r.bytes, lastUpdateId: r.json.lastUpdateId,
        bids: b.length, asks: a.length,
        bidsDescending: b.every((p, i) => i === 0 || p < b[i - 1]),
        asksAscending: a.every((p, i) => i === 0 || p > a[i - 1]),
        crossed: b.length > 0 && a.length > 0 && b[0] >= a[0],
        top: { bid: r.json.bids[0], ask: r.json.asks[0] }, keys: Object.keys(r.json),
        types: r.json.bids[0] ? r.json.bids[0].map((x) => typeof x) : null,
      });
      await sleep(500);
    }
  }
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const r = await get('/v3/depth?symbol=btc_thb&limit=20');
    ids.push({ id: r.json.lastUpdateId, ms: r.ms, date: r.headers.get('date'), cache: r.headers.get('x-cache-status') });
    await sleep(500);
  }
  log('depthRepeat', { pair: 'btc_thb', distinctIds: new Set(ids.map((x) => x.id)).size, reads: ids });
}

async function poll() {
  const tMs = [], dMs = [], changes = { btcLast: 0, btcBid: 0, depthId: 0 };
  let prev;
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    const t = await get('/v3/ticker/24hr');
    const d = await get('/v3/depth?symbol=btc_thb&limit=20');
    tMs.push(t.ms);
    dMs.push(d.ms);
    const btc = t.json.find((r) => r.symbol === 'btc_thb');
    const cur = { btcLast: btc.lastPrice, btcBid: btc.bidPrice, depthId: d.json.lastUpdateId };
    if (prev) for (const k of Object.keys(changes)) if (prev[k] !== cur[k]) changes[k]++;
    prev = cur;
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  const stats = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1], over1s: s.filter((x) => x > 1000).length };
  };
  log('poll', { rounds: 60, ticker24hrMs: stats(tMs), depthMs: stats(dMs), changesIn59: changes });
}

async function errors() {
  const paths = [
    '/v3/depth?symbol=nope_thb', '/v3/depth?symbol=BTC_THB', '/v3/depth?symbol=btcthb', '/v3/depth',
    '/v3/depth?symbol=ltc_thb', '/v3/ticker/24hr?symbol=btc_thb', '/v3/ticker/bookTicker', '/v3/ticker/price',
    '/v3/time', '/v3/nope', '/v3/premiumIndex', '/v3/fundingRate', '/v1/premiumIndex', '/fapi/v1/premiumIndex',
    '/fees/?pair=btc_thb', '/v3/trades?symbol=btc_thb', '/trading-fees/',
    '/broker/ticker/24h', '/broker/depth?symbol=btc_usdt',
  ];
  for (const p of paths) {
    const r = await get(p);
    log('error', { path: p, status: r.status, ms: r.ms, body: r.text.slice(0, 160), headers: pick(r.headers, ['content-type', 'retry-after']) });
    await sleep(500);
  }
}

// /v3/time answers live, while the serverTime inside exchangeInfo repeats for several seconds, so both are sampled.
async function time() {
  for (const path of ['/v3/time', '/v3/exchangeInfo']) {
    const samples = [];
    for (let i = 0; i < 6; i++) {
      const t0 = Date.now();
      const r = await get(path);
      const t1 = Date.now();
      const mid = (t0 + t1) / 2;
      samples.push({ serverTime: r.json.serverTime, rttMs: t1 - t0, offsetMs: Math.round(r.json.serverTime - mid) });
      await sleep(1000);
    }
    log('time', { path, distinctServerTimes: new Set(samples.map((s) => s.serverTime)).size, samples });
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, book, poll, errors, time };
log('start', { mode, at: new Date().toISOString() });
for (const [name, fn] of Object.entries(modes)) {
  if (mode === 'all' || mode === name) await fn();
}
log('end', { at: new Date().toISOString() });
