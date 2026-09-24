// Coinone REST probe: KRW spot catalog and CCXT mapping, host latency and CDN headers, bulk ticker polls, order book snapshot, errors, rate limit headers, clock offset.
// Public, unauthenticated, read-only. At most about 3 requests per second, well inside the documented 1,200 public V2 requests per minute per IP.
// Run from server/: node ../scripts/probes/venues/coinone/rest-probe.mjs [catalog|latency|tickers|book|errors|all]
//   catalog  GET /public/v2/markets/KRW for USDT, BTC and USDC quotes too, and CCXT 4.5.68 loadMarkets twice with market.id, taker and contractSize. About 5 s.
//   latency  DNS, one cold and ten warm requests per endpoint, CDN and rate limit headers, clock offset from server_time. About 20 s.
//   tickers  30 polls of /public/v2/ticker_new/KRW at 1 s: reply time and size, and how many pairs changed per poll. About 35 s.
//   book     GET /public/v2/orderbook/KRW/{pair} at every size on three pairs: level count, order, crossing, id and timestamp age, repeat reads. About 15 s.
//   errors   unknown pair, bad size, lower case pair, unknown quote, unknown path: status and body. About 4 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/coinone/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.coinone.co.kr';
const V2 = `${API}/public/v2`;
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
  const sent = Date.now();
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json', 'accept-encoding': 'gzip', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, text, json, headers: res.headers, sent, recvMs: Date.now() };
}

const pick = (h, names) => Object.fromEntries(names.map((n) => [n, h.get(n)]).filter(([, v]) => v !== null));
const HEADERS = ['server', 'cf-cache-status', 'cf-ray', 'age', 'cache-control', 'content-encoding', 'public-ratelimit-remaining', 'public-ratelimit-replenish-rate', 'public-ratelimit-burst-capacity', 'retry-after'];

async function catalog() {
  const r = await get(`${V2}/markets/KRW`);
  keep('markets-KRW.json', r.text);
  const m = r.json.markets;
  const count = (f) => Object.entries(m.reduce((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {}));
  log('markets_KRW', { status: r.status, ms: r.ms, bytes: r.text.length, rows: m.length, trade_status: count((x) => x.trade_status), maintenance_status: count((x) => x.maintenance_status), order_types: count((x) => x.order_types.join(',')), sample: m.find((x) => x.target_currency === 'BTC') });
  for (const q of ['USDT', 'BTC', 'USDC']) {
    await sleep(300);
    const o = await get(`${V2}/markets/${q}`);
    log('markets_other_quote', { quote: q, status: o.status, rows: o.json?.markets?.length, body: o.text.slice(0, 160) });
  }

  const ids = [];
  for (let run = 0; run < 2; run++) {
    const ex = new ccxt.coinone();
    const markets = await ex.loadMarkets();
    const list = Object.values(markets);
    const btc = markets['BTC/KRW'];
    ids.push(Object.fromEntries(list.map((x) => [x.symbol, x.id])));
    log('ccxt_loadMarkets', {
      run,
      count: list.length,
      types: [...new Set(list.map((x) => x.type))],
      active: [...new Set(list.map((x) => String(x.active)))],
      linear: [...new Set(list.map((x) => String(x.linear)))],
      contractSize: [...new Set(list.map((x) => String(x.contractSize)))],
      taker: [...new Set(list.map((x) => x.taker))],
      maker: [...new Set(list.map((x) => x.maker))],
      idsNumeric: list.filter((x) => /^\d+$/.test(x.id)).length,
      idsUnique: new Set(list.map((x) => x.id)).size,
      btc: { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, baseId: btc.baseId, quoteId: btc.quoteId, precision: btc.precision },
    });
    if (run === 0) {
      const krw = new Set(m.map((x) => `${x.target_currency}/KRW`));
      const cc = new Set(list.map((x) => `${x.baseId}/${x.quoteId}`));
      log('ccxt_vs_markets', { inMarketsNotCcxt: [...krw].filter((s) => !cc.has(s)).slice(0, 20), inCcxtNotMarkets: [...cc].filter((s) => !krw.has(s)).slice(0, 20), symbolsRenamed: list.filter((x) => x.base !== x.baseId).map((x) => `${x.baseId} as ${x.base}`).slice(0, 20) });
    }
    await sleep(2000);
  }
  const same = Object.keys(ids[0]).filter((s) => ids[0][s] === ids[1][s]).length;
  log('ccxt_id_stability', { symbols: Object.keys(ids[0]).length, sameIdAcrossTwoLoads: same, btcIds: [ids[0]['BTC/KRW'], ids[1]['BTC/KRW']] });
}

async function latency() {
  for (const host of ['api.coinone.co.kr', 'stream.coinone.co.kr']) {
    const a = await lookup(host, { all: true });
    log('dns', { host, addresses: a.map((x) => x.address) });
  }
  const eps = [
    ['markets', `${V2}/markets/KRW`],
    ['ticker_new_all', `${V2}/ticker_new/KRW`],
    ['ticker_new_btc', `${V2}/ticker_new/KRW/BTC`],
    ['orderbook_btc', `${V2}/orderbook/KRW/BTC?size=16`],
  ];
  for (const [name, url] of eps) {
    const times = [];
    let first = null;
    for (let i = 0; i < 11; i++) {
      const r = await get(url);
      if (i === 0) first = r;
      else times.push(r.ms);
      await sleep(250);
    }
    log('latency', { name, status: first.status, bytes: first.text.length, cold: first.ms, warm: { min: Math.min(...times), median: median(times), max: Math.max(...times) }, headers: pick(first.headers, HEADERS) });
  }
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${V2}/ticker_new/KRW/BTC`);
    offsets.push(r.json.server_time - (r.sent + r.recvMs) / 2);
    await sleep(300);
  }
  log('clock_offset_ms', { samples: offsets.length, min: Math.round(Math.min(...offsets)), median: Math.round(median(offsets)), max: Math.round(Math.max(...offsets)) });
}

async function tickers() {
  const times = [];
  const sizes = [];
  const changed = [];
  const lag = [];
  let prev = null;
  let first = null;
  for (let i = 0; i < 30; i++) {
    const t = Date.now();
    const r = await get(`${V2}/ticker_new/KRW`);
    times.push(r.ms);
    sizes.push(r.text.length);
    const rows = r.json.tickers;
    if (i === 0) {
      first = rows;
      keep('ticker_new-KRW.json', r.text);
    }
    const cur = Object.fromEntries(rows.map((x) => [x.target_currency, `${x.id}|${x.best_bids[0]?.price}|${x.best_asks[0]?.price}`]));
    if (prev) changed.push(Object.keys(cur).filter((k) => cur[k] !== prev[k]).length);
    prev = cur;
    const btc = rows.find((x) => x.target_currency === 'btc');
    lag.push(r.json.server_time - btc.timestamp);
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  const oneSided = first.filter((x) => x.best_bids.length === 0 || x.best_asks.length === 0).map((x) => x.target_currency);
  const crossed = first.filter((x) => x.best_bids.length && x.best_asks.length && Number(x.best_bids[0].price) >= Number(x.best_asks[0].price)).map((x) => x.target_currency);
  const zeroVol = first.filter((x) => Number(x.quote_volume) === 0).length;
  log('ticker_new_poll', { polls: times.length, ms: { min: Math.min(...times), median: median(times), p90: pct(times, 0.9), max: Math.max(...times) }, bytes: { min: Math.min(...sizes), max: Math.max(...sizes) }, rows: first.length, pairsChangedPerPoll: { min: Math.min(...changed), median: median(changed), max: Math.max(...changed) }, btcServerMinusTickerTs: { min: Math.min(...lag), median: median(lag), max: Math.max(...lag) }, oneSided, crossed, zeroQuoteVolume24h: zeroVol, fields: Object.keys(first[0]) });
  const byVol = [...first].sort((a, b) => Number(b.quote_volume) - Number(a.quote_volume));
  log('ticker_new_top_volume', { top10: byVol.slice(0, 10).map((x) => `${x.target_currency}:${Math.round(Number(x.quote_volume) / 1e8) / 10}e9`), medianQuoteVolume: median(first.map((x) => Number(x.quote_volume))) });
}

function describeBook(j) {
  const bids = j.bids.map((l) => Number(l.price));
  const asks = j.asks.map((l) => Number(l.price));
  const desc = (a) => a.every((v, i) => i === 0 || v < a[i - 1]);
  const asc = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);
  return { bids: bids.length, asks: asks.length, bidsDesc: desc(bids), asksAsc: asc(asks), asksDesc: desc(asks), bestBid: j.bids[0]?.price, bestAsk: j.asks[0]?.price, crossed: bids.length && asks.length ? bids[0] >= asks[0] : null, id: j.id, ageMs: j.timestamp ? Date.now() - j.timestamp : null };
}

async function book() {
  for (const pair of ['BTC', 'XRP', 'TNSR']) {
    for (const size of [undefined, 5, 10, 15, 16]) {
      const r = await get(`${V2}/orderbook/KRW/${pair}${size ? `?size=${size}` : ''}`);
      if (size === 16) keep(`orderbook-${pair}-16.json`, r.text);
      log('orderbook', { pair, size: size ?? 'default', status: r.status, ms: r.ms, bytes: r.text.length, keys: Object.keys(r.json ?? {}), order_book_unit: r.json?.order_book_unit, ...(r.json?.bids ? describeBook(r.json) : { body: r.text.slice(0, 200) }), headers: pick(r.headers, ['cf-cache-status', 'age', 'cache-control']) });
      await sleep(300);
    }
  }
  const reads = [];
  for (let i = 0; i < 8; i++) {
    const r = await get(`${V2}/orderbook/KRW/BTC?size=16`);
    reads.push({ id: r.json.id, ts: r.json.timestamp, ageMs: r.recvMs - r.json.timestamp, ms: r.ms });
    await sleep(250);
  }
  log('orderbook_repeat', { reads, distinctIds: new Set(reads.map((x) => x.id)).size });
  const s = (await get(`${V2}/orderbook/KRW/BTC?size=16`)).json;
  log('orderbook_sample', { id: s.id, timestamp: s.timestamp, bids: s.bids.slice(0, 2), asks: s.asks.slice(0, 2) });
}

async function errors() {
  const cases = [
    ['unknown_pair', `${V2}/orderbook/KRW/NOPE`],
    ['bad_size', `${V2}/orderbook/KRW/BTC?size=20`],
    ['lower_case_pair', `${V2}/orderbook/krw/btc`],
    ['unknown_quote_ticker', `${V2}/ticker_new/USDT`],
    ['unknown_pair_ticker', `${V2}/ticker_new/KRW/NOPE`],
    ['unknown_path', `${V2}/nope`],
    ['removed_range_units', `${V2}/range_units`],
    ['range_unit_btc', `${V2}/range_units/KRW/BTC`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, body: r.text.slice(0, 240), headers: pick(r.headers, ['content-type', 'public-ratelimit-remaining', 'retry-after']) });
    await sleep(400);
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, latency, tickers, book, errors };
for (const [name, fn] of Object.entries(modes)) {
  if (mode === name || mode === 'all') {
    log('mode', { name, at: new Date().toISOString() });
    await fn();
  }
}
