// Bitbank REST probe: spot catalog and CCXT mapping, host latency and CDN headers, bulk tickers, depth snapshot, circuit break info, errors, clock offset.
// Public, unauthenticated, read-only. At most about 3 requests per second, well inside the documented 10 QUERY calls per second.
// Run from server/: node ../scripts/probes/venues/bitbank/rest-probe.mjs [catalog|latency|tickers|depth|errors|all]
//   catalog  GET /v1/spot/pairs, GET /v1/spot/status, circuit_break_info on three pairs, and CCXT 4.5.68 loadMarkets with market.taker. About 5 s.
//   latency  DNS, one cold and ten warm requests per endpoint, CDN headers, clock offset from Date and from the reply timestamp. About 20 s.
//   tickers  GET /tickers and /tickers_jpy shape, then 30 polls of /tickers at 1 s: time, and how many pairs changed per poll. About 35 s.
//   depth    GET /{pair}/depth on three pairs: level count, order, crossing, size strings, sequenceId, and repeat reads for caching. About 10 s.
//   errors   unknown pair, unknown path, unknown host path: status and body. About 3 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitbank/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const PUBLIC = 'https://public.bitbank.cc';
const API = 'https://api.bitbank.cc/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'accept-encoding': 'gzip', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, text, json, headers: res.headers, recvMs: Date.now() };
}

function pickHeaders(h) {
  const names = ['server', 'content-type', 'content-encoding', 'cache-control', 'age', 'x-cache', 'x-amz-cf-pop', 'retry-after', 'date', 'via', 'x-ratelimit-limit', 'x-ratelimit-remaining'];
  const out = {};
  for (const n of names) { const v = h.get(n); if (v !== null) out[n] = v; }
  return out;
}

async function catalog() {
  const pairs = await get(`${API}/spot/pairs`);
  keep('spot-pairs.json', pairs.text);
  const list = pairs.json.data.pairs;
  const byQuote = {};
  for (const p of list) byQuote[p.quote_asset] = (byQuote[p.quote_asset] ?? 0) + 1;
  const fees = {};
  for (const p of list) {
    const k = `taker ${p.taker_fee_rate_quote} maker ${p.maker_fee_rate_quote} base ${p.taker_fee_rate_base}/${p.maker_fee_rate_base}`;
    (fees[k] ??= []).push(p.name);
  }
  log('pairs', { status: pairs.status, bytes: pairs.text.length, ms: pairs.ms, count: list.length, byQuote, enabled: list.filter((p) => p.is_enabled).length });
  for (const [k, names] of Object.entries(fees)) log('pair_fees', { fees: k, count: names.length, sample: names.slice(0, 3) });
  const margin = list.filter((p) => p.margin_long_interest !== null);
  log('margin_pairs', { count: margin.length, names: margin.map((p) => p.name), longInterest: [...new Set(margin.map((p) => p.margin_long_interest))], shortInterest: [...new Set(margin.map((p) => p.margin_short_interest))] });
  const flags = ['stop_order', 'stop_order_and_cancel', 'stop_market_order', 'stop_stop_order', 'stop_stop_limit_order', 'stop_buy_order', 'stop_sell_order'];
  for (const f of flags) {
    const hit = list.filter((p) => p[f] === true).map((p) => p.name);
    log('flag', { flag: f, count: hit.length, names: hit });
  }
  const tradable = list.filter((p) => p.is_enabled && !p.stop_order && !p.stop_order_and_cancel && !p.stop_buy_order && !p.stop_sell_order);
  log('tradable', { count: tradable.length, jpy: tradable.filter((p) => p.quote_asset === 'jpy').length, btc: tradable.filter((p) => p.quote_asset === 'btc').length });

  const status = await get(`${API}/spot/status`);
  keep('spot-status.json', status.text);
  const st = {};
  for (const s of status.json.data.statuses) st[s.status] = (st[s.status] ?? 0) + 1;
  log('spot_status', { status: status.status, count: status.json.data.statuses.length, byStatus: st, sample: status.json.data.statuses[0] });

  for (const pair of ['btc_jpy', 'xrp_jpy', 'mkr_jpy']) {
    const cb = await get(`${PUBLIC}/${pair}/circuit_break_info`);
    log('circuit_break_info', { pair, status: cb.status, data: cb.json?.data ?? cb.text.slice(0, 200) });
    await sleep(300);
  }

  const ex = new ccxt.bitbank();
  const urls = [];
  const origFetch = ex.fetch.bind(ex);
  ex.fetch = (url, ...rest) => { urls.push(url); return origFetch(url, ...rest); };
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const types = {};
  for (const m of all) types[m.type] = (types[m.type] ?? 0) + 1;
  log('ccxt', { version: ccxt.version, ms: Math.round(performance.now() - t0), urls, count: all.length, types, swaps: all.filter((m) => m.swap).length, active: all.filter((m) => m.active).length });
  const takers = {};
  for (const m of all) { const k = `${m.taker}/${m.maker}`; takers[k] = (takers[k] ?? 0) + 1; }
  log('ccxt_taker_maker', { distribution: takers });
  for (const s of ['BTC/JPY', 'XRP/JPY', 'ETH/BTC']) {
    const m = markets[s];
    log('ccxt_market', { symbol: s, id: m.id, base: m.base, quote: m.quote, type: m.type, linear: m.linear, contractSize: m.contractSize, active: m.active, taker: m.taker, maker: m.maker, percentage: m.percentage, tierBased: m.tierBased });
  }
  const pairNames = new Set(list.map((p) => p.name));
  log('ccxt_ids', { idsEqualPairNames: all.every((m) => pairNames.has(m.id)) && all.length === pairNames.size });
}

async function latency() {
  for (const host of ['public.bitbank.cc', 'api.bitbank.cc', 'stream.bitbank.cc']) {
    const addrs = await lookup(host, { all: true });
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }
  const endpoints = [`${PUBLIC}/tickers`, `${PUBLIC}/btc_jpy/depth`, `${API}/spot/pairs`, `${API}/spot/status`];
  for (const url of endpoints) {
    const times = [];
    let first = null;
    let bytes = 0;
    let lastHeaders = null;
    for (let i = 0; i < 11; i++) {
      const r = await get(url);
      if (i === 0) { first = r.ms; log('headers', { url, status: r.status, headers: pickHeaders(r.headers) }); } else times.push(r.ms);
      bytes = r.text.length;
      lastHeaders = pickHeaders(r.headers);
      await sleep(400);
    }
    log('latency', { url, bytes, firstMs: first, warmMin: Math.min(...times), warmMedian: median(times), warmMax: Math.max(...times), lastXCache: lastHeaders['x-cache'] ?? null, lastAge: lastHeaders.age ?? null });
  }
  // Clock: no server time call is published, so the Date header of the uncached spot/status reply bounds the offset.
  // Date is floored to the second, so server time lies in [Date, Date + 1000) at some instant between send and receive.
  let lo = -Infinity;
  let hi = Infinity;
  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/spot/status`);
    const d = Date.parse(r.headers.get('date'));
    lo = Math.max(lo, d - r.recvMs);
    hi = Math.min(hi, d + 1000 - t0);
    rtts.push(r.recvMs - t0);
    await sleep(333);
  }
  log('clock', { source: 'Date header of /v1/spot/status', serverMinusLocalMsLow: lo, serverMinusLocalMsHigh: hi, rttMedian: median(rtts) });
  const ages = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${PUBLIC}/btc_jpy/ticker`);
    ages.push({ ageMs: r.recvMs - r.json.data.timestamp, ms: r.ms, xCache: r.headers.get('x-cache') });
    await sleep(500);
  }
  log('ticker_age', { pair: 'btc_jpy', reads: ages });
}

async function tickers() {
  const all = await get(`${PUBLIC}/tickers`);
  const jpy = await get(`${PUBLIC}/tickers_jpy`);
  keep('tickers.json', all.text);
  log('tickers_shape', { status: all.status, bytes: all.text.length, count: all.json.data.length, fields: Object.keys(all.json.data[0]), sample: all.json.data[0] });
  log('tickers_jpy_shape', { status: jpy.status, bytes: jpy.text.length, count: jpy.json.data.length });
  const oneSided = all.json.data.filter((t) => t.buy === null || t.sell === null || t.buy === '' || t.sell === '').map((t) => t.pair);
  const crossed = all.json.data.filter((t) => t.buy !== null && t.sell !== null && Number(t.buy) >= Number(t.sell)).map((t) => t.pair);
  log('tickers_books', { oneSided, crossed });
  let prev = new Map(all.json.data.map((t) => [t.pair, t.timestamp]));
  const times = [];
  const changed = [];
  const ages = [];
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const r = await get(`${PUBLIC}/tickers`);
    times.push(r.ms);
    let c = 0;
    for (const t of r.json.data) { if (prev.get(t.pair) !== t.timestamp) c++; ages.push(r.recvMs - t.timestamp); }
    changed.push(c);
    prev = new Map(r.json.data.map((t) => [t.pair, t.timestamp]));
  }
  log('tickers_poll', { polls: times.length, msMin: Math.min(...times), msMedian: median(times), msP90: pct(times, 0.9), msMax: Math.max(...times), pairsChangedPerPoll: { min: Math.min(...changed), median: median(changed), max: Math.max(...changed) }, tickerAgeMs: { min: Math.min(...ages), median: median(ages), p90: pct(ages, 0.9), max: Math.max(...ages) } });
}

function orderOf(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (dir === 'desc' ? b >= a : b <= a) return `broken at ${i}`;
  }
  return dir === 'desc' ? 'descending' : 'ascending';
}

async function depth() {
  for (const pair of ['btc_jpy', 'xrp_jpy', 'bat_jpy']) {
    const r = await get(`${PUBLIC}/${pair}/depth`);
    keep(`depth-${pair}.json`, r.text);
    const d = r.json.data;
    log('depth', {
      pair, status: r.status, ms: r.ms, bytes: r.text.length, bids: d.bids.length, asks: d.asks.length,
      bidOrder: orderOf(d.bids, 'desc'), askOrder: orderOf(d.asks, 'asc'),
      crossed: d.bids.length && d.asks.length ? Number(d.bids[0][0]) >= Number(d.asks[0][0]) : null,
      top: { bid: d.bids[0], ask: d.asks[0] }, priceType: typeof d.bids[0]?.[0], sizeType: typeof d.bids[0]?.[1],
      extras: { asks_over: d.asks_over, bids_under: d.bids_under, asks_under: d.asks_under, bids_over: d.bids_over, ask_market: d.ask_market, bid_market: d.bid_market },
      sequenceId: d.sequenceId, sequenceIdType: typeof d.sequenceId, timestampAgeMs: r.recvMs - d.timestamp, headers: pickHeaders(r.headers),
    });
    await sleep(400);
  }
  // Five reads 300 ms apart show whether the edge serves a cached copy.
  const seqs = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${PUBLIC}/btc_jpy/depth`);
    seqs.push({ seq: r.json.data.sequenceId, ageMs: r.recvMs - r.json.data.timestamp, ms: r.ms, xCache: r.headers.get('x-cache'), age: r.headers.get('age') });
    await sleep(300);
  }
  log('depth_repeat', { pair: 'btc_jpy', reads: seqs });
}

async function errors() {
  const cases = [
    `${PUBLIC}/nope_jpy/depth`,
    `${PUBLIC}/nope_jpy/ticker`,
    `${PUBLIC}/btc_jpy/nope`,
    `${PUBLIC}/nope`,
    `${API}/nope`,
  ];
  for (const url of cases) {
    const r = await get(url);
    log('error_case', { url, status: r.status, body: r.text.slice(0, 200), headers: pickHeaders(r.headers) });
    await sleep(400);
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, latency, tickers, depth, errors };
log('start', { mode, at: new Date().toISOString() });
if (mode === 'all') { for (const m of ['catalog', 'latency', 'depth', 'errors', 'tickers']) await modes[m](); } else await modes[mode]();
log('end', { at: new Date().toISOString() });
