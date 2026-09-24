// Indodax public REST probe: host and latency, clock offset, the pairs catalog and how CCXT 4.5.68 maps it, the depth book, Cloudflare caching, and error shapes.
// Public, unauthenticated, read-only. At most one request a second in the polling loops, well inside the published 180 requests a minute.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/indodax/rest-probe.mjs [host|catalog|book|cache|errors|all]
//   host     DNS, cold and warm request times, and the clock offset against /api/server_time. About 10 s.
//   catalog  /api/pairs by quote and state, and what CCXT loadMarkets reports for id, type, active and taker. About 5 s.
//   book     /api/depth on three pairs for levels, order and number types, then the fields of the ticker replies and the USDT pairs by 24 h volume. About 10 s.
//   cache    polls /api/depth/btcidr and /api/ticker_all once a second for 20 s and prints cf-cache-status, age and whether the body changed. About 45 s.
//   errors   unknown pair, unknown path, a POST, and a pair id in another spelling. About 5 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/indodax/rest.md.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://indodax.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const hash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
const HEADERS = ['cache-control', 'cf-cache-status', 'age', 'expires', 'last-modified', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'cf-ray', 'content-type'];

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
  const headers = {};
  for (const h of HEADERS) if (res.headers.get(h) !== null) headers[h] = res.headers.get(h);
  return { status: res.status, ms, bytes: text.length, text, headers };
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s.at(-1) };
}

async function host() {
  const addrs = await lookup('indodax.com', { all: true });
  log('dns', { host: 'indodax.com', addrs: addrs.map((a) => a.address) });
  const ws = await lookup('ws3.indodax.com', { all: true });
  log('dns', { host: 'ws3.indodax.com', addrs: ws.map((a) => a.address) });

  // Cloudflare caches /api/server_time for up to 30 s, so a cached reply carries an old time.
  // Plain requests show the cache, and requests with a nonce query reach the origin every time.
  for (const nonce of [false, true]) {
    const times = [];
    const offsets = [];
    const cacheStatus = {};
    for (let i = 0; i < 8; i++) {
      const sent = Date.now();
      const r = await get(nonce ? `/api/server_time?n=${sent}` : '/api/server_time');
      const received = Date.now();
      const server = JSON.parse(r.text).server_time;
      const cs = r.headers['cf-cache-status'] ?? '-';
      cacheStatus[cs] = (cacheStatus[cs] ?? 0) + 1;
      times.push(r.ms);
      if (cs !== 'HIT') offsets.push(server - Math.round((sent + received) / 2));
      if (i === 0) log('server_time_first', { nonce, status: r.status, ms: r.ms, body: r.text.trim(), headers: r.headers });
      await sleep(500);
    }
    log('server_time', { nonce, first_ms: times[0], rest: stats(times.slice(1)), cacheStatus, offset_ms_excluding_hits: offsets.length ? stats(offsets) : null });
  }
  const trace = await (await fetch(API + '/cdn-cgi/trace')).text();
  log('cf_trace', { colo: trace.match(/colo=(\w+)/)?.[1], loc: trace.match(/loc=(\w+)/)?.[1], http: trace.match(/http=(\S+)/)?.[1] });
}

async function catalog() {
  const r = await get('/api/pairs');
  keep('pairs.json', r.text);
  const pairs = JSON.parse(r.text);
  const byQuote = {};
  for (const p of pairs) {
    const k = p.base_currency;
    byQuote[k] ??= { n: 0, maintenance: 0, suspended: 0, fees: {} };
    byQuote[k].n++;
    if (p.is_maintenance) byQuote[k].maintenance++;
    if (p.is_market_suspended) byQuote[k].suspended++;
    const f = `${p.trade_fee_percent}/${p.trade_fee_percent_taker}/${p.trade_fee_percent_maker}`;
    byQuote[k].fees[f] = (byQuote[k].fees[f] ?? 0) + 1;
  }
  log('pairs', { status: r.status, ms: r.ms, bytes: r.bytes, count: pairs.length, byQuote, feeKey: 'trade_fee_percent/taker/maker', headers: r.headers });
  const usdt = pairs.filter((p) => p.base_currency === 'usdt');
  log('usdt_pairs', { ids: usdt.map((p) => `${p.id}:${p.symbol}:${p.traded_currency}`) });
  const idMismatch = pairs.filter((p) => p.id !== `${p.traded_currency}${p.base_currency}`);
  log('id_vs_currencies', { mismatches: idMismatch.map((p) => `${p.id}:${p.traded_currency}/${p.base_currency}:${p.symbol}`) });

  const ex = new ccxt.indodax();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const takerPpm = {};
  const makerPpm = {};
  for (const m of list) {
    const t = Math.round(m.taker * 1e6);
    const mk = Math.round(m.maker * 1e6);
    takerPpm[t] = (takerPpm[t] ?? 0) + 1;
    makerPpm[mk] = (makerPpm[mk] ?? 0) + 1;
  }
  const btc = markets['BTC/USDT'];
  log('ccxt', {
    version: ccxt.version,
    ms: Math.round(performance.now() - t0),
    markets: list.length,
    types: [...new Set(list.map((m) => m.type))],
    swap: list.filter((m) => m.swap).length,
    active: list.filter((m) => m.active).length,
    takerPpmHistogram: takerPpm,
    makerPpmHistogram: makerPpm,
    has: { swap: ex.has.swap, future: ex.has.future, watchOrderBook: ex.has.watchOrderBook ?? null, fetchFundingRates: ex.has.fetchFundingRates ?? null },
    btcusdt: { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, type: btc.type, active: btc.active, taker: btc.taker, maker: btc.maker, percentage: btc.percentage, contractSize: btc.contractSize, linear: btc.linear },
    feesTrading: ex.fees.trading,
  });
  const dupSymbols = list.length - new Set(list.map((m) => m.symbol)).size;
  const idx = list.find((m) => m.id === 'idxusdt');
  log('ccxt_symbols', { duplicateSymbols: dupSymbols, idxusdt: idx ? { symbol: idx.symbol, base: idx.base } : null });
}

function levelSummary(side, levels, descending) {
  let ordered = true;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (descending ? b >= a : b <= a) ordered = false;
  }
  return { side, n: levels.length, ordered, priceType: typeof levels[0]?.[0], sizeType: typeof levels[0]?.[1], first: levels[0], last: levels.at(-1) };
}

async function book() {
  for (const pair of ['btcusdt', 'btcidr', 'vcgusdt']) {
    const r = await get(`/api/depth/${pair}`);
    keep(`depth_${pair}.json`, r.text);
    const d = JSON.parse(r.text);
    log('depth', { pair, status: r.status, ms: r.ms, bytes: r.bytes, keys: Object.keys(d), buy: levelSummary('buy', d.buy, true), sell: levelSummary('sell', d.sell, false), headers: r.headers });
    await sleep(1000);
  }
  const t = await get('/api/ticker/btcusdt');
  log('ticker', { status: t.status, ms: t.ms, body: JSON.parse(t.text) });
  await sleep(1000);
  const all = await get('/api/ticker_all');
  keep('ticker_all.json', all.text);
  const tickers = JSON.parse(all.text).tickers;
  const fields = new Set();
  for (const v of Object.values(tickers)) for (const k of Object.keys(v)) fields.add(k.startsWith('vol_') ? 'vol_<asset>' : k);
  log('ticker_all', { status: all.status, ms: all.ms, bytes: all.bytes, rows: Object.keys(tickers).length, fields: [...fields], sampleKey: Object.keys(tickers)[0] });
  await sleep(1000);
  const s = await get('/api/summaries');
  const sum = JSON.parse(s.text);
  log('summaries', { status: s.status, ms: s.ms, bytes: s.bytes, keys: Object.keys(sum), rows: Object.keys(sum.tickers ?? {}).length });
  const usdtVol = Object.entries(tickers)
    .filter(([k]) => k.endsWith('_usdt'))
    .map(([k, v]) => [k, Math.round(Number(v.vol_usdt ?? 0)), v.buy, v.sell]);
  log('usdt_volume', { rows: usdtVol.sort((a, b) => b[1] - a[1]) });
}

async function cache() {
  for (const path of ['/api/depth/btcidr', '/api/ticker_all']) {
    const rows = [];
    let lastHash = null;
    let changes = 0;
    for (let i = 0; i < 20; i++) {
      const r = await get(path);
      const h = hash(r.text);
      if (lastHash !== null && h !== lastHash) changes++;
      lastHash = h;
      rows.push(`${r.status}/${r.headers['cf-cache-status'] ?? '-'}/age=${r.headers.age ?? '-'}/${h}/${r.ms}ms`);
      await sleep(1000);
    }
    log('cache', { path, polls: rows.length, bodyChanges: changes, rows });
  }
}

async function errors() {
  const cases = [
    ['GET', '/api/depth/nopeidr'],
    ['GET', '/api/depth/btc_idr'],
    ['GET', '/api/depth/BTCIDR'],
    ['GET', '/api/ticker/nopeidr'],
    ['GET', '/api/nope'],
    ['POST', '/api/depth/btcidr'],
  ];
  for (const [method, path] of cases) {
    const r = await get(path, { method });
    log('error_case', { method, path, status: r.status, ms: r.ms, body: r.text.slice(0, 200), headers: r.headers });
    await sleep(1000);
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { host, catalog, book, cache, errors };
for (const [name, fn] of Object.entries(modes)) {
  if (mode === 'all' || mode === name) {
    log('mode', { name, at: new Date().toISOString() });
    await fn();
  }
}
