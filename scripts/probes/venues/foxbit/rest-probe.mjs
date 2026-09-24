// Foxbit REST probe: host and latency, the spot catalog and how CCXT maps it, the REST book, the bulk ticker cadence, error shapes and clock offset.
// Public, unauthenticated, read-only. Foxbit publishes per endpoint limits (markets 6/s, orderbook 10 per 2 s, bulk ticker 2 per 4 s, time 5/s), so requests here are 700 ms apart, 300 ms for the repeated book and time reads, and 2.5 s for the bulk ticker.
// Run from server/: node ../scripts/probes/venues/foxbit/rest-probe.mjs [catalog|book|ticker|errors]
//   catalog  DNS, the Cloudflare edge and country, one cold markets and one cold orderbook call, five warm markets calls, the PREDICTION and ALL categories, then CCXT 4.5.68 loadMarkets and its market fields. About 15 s, 11 requests.
//   book     orderbook on five markets, one of them quiet, at depth 300 and 20, level order, sequence_id and ts, eight reads 300 ms apart for caching, one simulated quote, one ticker. About 15 s, 17 requests.
//   ticker   the bulk markets/ticker/24hr every 2.5 s for 60 s: reply time, size, fields, and how often each field changes. 24 requests.
//   errors   unknown market, bad depth, unknown path, and the clock offset from system/time. About 15 s, 13 requests.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/foxbit/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'api.foxbit.com.br';
const API = `https://${HOST}/rest/v3`;
const SPACING_MS = 700;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const RL_HEADERS = ['x-fb-rate-limit-requests-limit', 'x-fb-rate-limit-requests-remaining', 'x-fb-rate-limit-requests-reset', 'x-fb-rate-limit-retry-after', 'cf-cache-status', 'age', 'cache-control', 'cf-ray', 'server-timing'];

let lastRequestAt = 0;

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

function pickHeaders(headers) {
  const out = {};
  for (const h of RL_HEADERS) {
    const v = typeof headers.get === 'function' ? headers.get(h) : headers[h];
    if (v !== null && v !== undefined) out[h] = v;
  }
  return out;
}

// Warm requests go through fetch, which keeps the connection alive.
async function get(path, spacing = SPACING_MS) {
  const wait = lastRequestAt + spacing - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'user-agent': 'observatory-probe' } });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, ttfb, bytes: text.length, text, json, headers: pickHeaders(res.headers), date: res.headers.get('date') };
}

// A cold request opens a fresh TCP and TLS connection with no agent reuse.
function coldGet(path) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let tls = 0;
    const req = https.request({ host: HOST, path: '/rest/v3' + path, agent: false, headers: { 'user-agent': 'observatory-probe' } }, (res) => {
      const ttfb = performance.now() - t0;
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, ms: performance.now() - t0, ttfb, tls, bytes: body.length, headers: pickHeaders(res.headers) }));
    });
    req.on('socket', (s) => s.on('secureConnect', () => (tls = performance.now() - t0)));
    req.on('error', reject);
    req.end();
  });
}

const r1 = (x) => Math.round(x);
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: r1(s[0]), median: r1(q(0.5)), p90: r1(q(0.9)), max: r1(s[s.length - 1]) };
};

async function catalog() {
  const addrs = await dns.resolve4(HOST);
  log('dns', { host: HOST, addrs });
  // Cloudflare's trace names the edge and the country it places this host in, without printing the address.
  const trace = await (await fetch(`https://${HOST}/cdn-cgi/trace`)).text();
  log('cloudflare_trace', Object.fromEntries(trace.trim().split('\n').map((l) => l.split('=')).filter(([k]) => ['colo', 'loc', 'http', 'tls'].includes(k))));
  lastRequestAt = Date.now();
  const cold = await coldGet('/markets');
  log('markets_cold', { status: cold.status, ms: r1(cold.ms), tlsDoneMs: r1(cold.tls), ttfb: r1(cold.ttfb), bytes: cold.bytes, headers: cold.headers });
  const coldBook = await coldGet('/markets/btcbrl/orderbook?depth=5');
  log('book_cold', { status: coldBook.status, ms: r1(coldBook.ms), tlsDoneMs: r1(coldBook.tls), ttfb: r1(coldBook.ttfb), headers: coldBook.headers });
  const warm = [];
  let last;
  for (let i = 0; i < 5; i++) {
    last = await get('/markets');
    warm.push(last.ms);
    log('markets_warm', { i, status: last.status, ms: r1(last.ms), headers: last.headers });
  }
  log('markets_warm_stats', stats(warm));
  save('markets.json', last.text);
  const rows = last.json.data;
  const byQuote = {};
  const fees = {};
  for (const m of rows) {
    byQuote[m.quote.symbol] = (byQuote[m.quote.symbol] ?? 0) + 1;
    const k = `${m.default_fees.maker}/${m.default_fees.taker}`;
    fees[k] = (fees[k] ?? 0) + 1;
  }
  log('markets_default', { rows: rows.length, bytes: last.bytes, byQuote, feesMakerTaker: fees, keys: Object.keys(rows[0]).sort(), usdtMarkets: rows.filter((m) => m.quote.symbol === 'usdt').map((m) => `${m.symbol} ${m.default_fees.maker}/${m.default_fees.taker}`) });
  const feeGroups = {};
  for (const m of rows) {
    const k = `${m.default_fees.maker}/${m.default_fees.taker}`;
    (feeGroups[k] ??= []).push(m.symbol);
  }
  for (const [k, v] of Object.entries(feeGroups)) if (v.length < 20) log('fee_group', { makerTaker: k, markets: v });

  for (const cat of ['PREDICTION', 'ALL']) {
    const r = await get(`/markets?category=${cat}`);
    const d = r.json?.data ?? [];
    const extra = d.filter((m) => !rows.some((x) => x.symbol === m.symbol));
    log('markets_category', { category: cat, status: r.status, rows: d.length, notInDefault: extra.length, sample: extra.slice(0, 5).map((m) => ({ symbol: m.symbol, base: m.base?.symbol, quote: m.quote?.symbol, category: m.base?.category?.code ?? m.category, fees: m.default_fees })) });
    if (extra[0]) log('prediction_row', { keys: Object.keys(extra[0]).sort(), base: JSON.stringify(extra[0].base).slice(0, 400) });
  }

  const ex = new ccxt.foxbit();
  const t0 = performance.now();
  await ex.loadMarkets();
  const ms = performance.now() - t0;
  const ms2 = Object.values(ex.markets);
  const count = (f) => {
    const out = {};
    for (const m of ms2) {
      const k = String(f(m));
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const pairs = {};
  for (const m of ms2) pairs[`${m.base}/${m.quote}`] = (pairs[`${m.base}/${m.quote}`] ?? 0) + 1;
  log('ccxt_loadMarkets', {
    version: ccxt.version, ms: r1(ms), markets: ms2.length,
    type: count((m) => m.type), active: count((m) => m.active), swap: count((m) => m.swap), contractSize: count((m) => m.contractSize), linear: count((m) => m.linear),
    takerMaker: count((m) => `${m.taker}/${m.maker}`), quote: count((m) => m.quote),
    idEqualsRestSymbol: ms2.filter((m) => rows.some((x) => x.symbol === m.id)).length,
    pairsListedTwice: Object.entries(pairs).filter(([, n]) => n > 1).map(([k]) => k),
    btc: (({ id, symbol, base, quote, taker, maker, contractSize, linear, active, precision }) => ({ id, symbol, base, quote, taker, maker, contractSize, linear, active, precision }))(ex.markets['BTC/BRL']),
    usdt: ms2.filter((m) => m.quote === 'USDT').map((m) => `${m.symbol} ${m.id} ${m.taker}/${m.maker}`),
    renamedBases: ms2.filter((m) => m.base.toLowerCase() !== m.info.base.symbol).map((m) => `${m.info.base.symbol} to ${m.base}`),
  });
}

function orderCheck(side, levels, dir) {
  let bad = 0;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (dir === 'desc' ? b >= a : b <= a) bad++;
  }
  return bad;
}

async function book() {
  const markets = ['btcbrl', 'usdtbrl', 'btcusdt', 'solusdt', 'ftmann08brl'];
  for (const m of markets) {
    const r = await get(`/markets/${m}/orderbook?depth=300`);
    const d = r.json;
    save(`book-${m}.json`, r.text);
    log('book', {
      market: m, status: r.status, ms: r1(r.ms), bytes: r.bytes, keys: Object.keys(d).sort(), sequence_id: d.sequence_id, ts: d.timestamp, tsAgeMs: Date.now() - d.timestamp,
      bids: d.bids.length, asks: d.asks.length, bidsOutOfOrder: orderCheck('bids', d.bids, 'desc'), asksOutOfOrder: orderCheck('asks', d.asks, 'asc'),
      bestBid: d.bids[0], bestAsk: d.asks[0], numberType: typeof d.bids[0]?.[0], headers: r.headers,
    });
  }
  const a = await get('/markets/btcbrl/orderbook?depth=20');
  log('book_depth20', { status: a.status, bids: a.json.bids.length, asks: a.json.asks.length, sequence_id: a.json.sequence_id, headers: a.headers });
  const b = await get('/markets/btcbrl/orderbook');
  log('book_nodepth', { status: b.status, bids: b.json.bids.length, asks: b.json.asks.length, sequence_id: b.json.sequence_id });
  // Two reads in quick succession show whether an edge cache holds the book.
  const seq = [];
  for (let i = 0; i < 8; i++) {
    const r = await get('/markets/btcbrl/orderbook?depth=5', 300);
    seq.push({ sequence_id: r.json.sequence_id, ts: r.json.timestamp, cache: r.headers['cf-cache-status'] ?? null, age: r.headers.age ?? null, ms: r1(r.ms) });
  }
  log('book_repeat', { seq });
  const q = await get('/markets/quotes?side=buy&base_currency=btc&quote_currency=brl&amount=1000');
  log('quote_sim', { status: q.status, ms: r1(q.ms), body: q.text.slice(0, 400), headers: q.headers });
  const t = await get('/markets/btcbrl/ticker/24hr');
  save('ticker-btcbrl.json', t.text);
  log('ticker_one', { status: t.status, ms: r1(t.ms), body: t.text.slice(0, 700), headers: t.headers });
}

async function ticker() {
  const polls = [];
  const prev = new Map();
  const changes = {};
  let first;
  for (let i = 0; i < 24; i++) {
    const r = await get('/markets/ticker/24hr', 2_500);
    if (r.status !== 200) {
      log('ticker_bulk_fail', { i, status: r.status, body: r.text.slice(0, 300), headers: r.headers });
      continue;
    }
    polls.push(r.ms);
    const rows = r.json.data;
    if (!first) {
      first = r;
      save('tickers.json', r.text);
      log('ticker_bulk_first', { rows: rows.length, bytes: r.bytes, headers: r.headers, row0: JSON.stringify(rows[0]).slice(0, 900) });
    }
    for (const row of rows) {
      const key = row.market_symbol;
      const flat = { last: row.last_trade?.price, bid: row.best?.bid?.price, ask: row.best?.ask?.price, lastTs: row.last_trade?.date ?? row.last_trade?.ts };
      const p = prev.get(key);
      if (p) for (const f of Object.keys(flat)) if (p[f] !== flat[f]) ((changes[key] ??= {})[f] = ((changes[key] ??= {})[f] ?? 0) + 1);
      prev.set(key, flat);
    }
    if (i % 6 === 0) log('ticker_bulk_poll', { i, ms: r1(r.ms), cache: r.headers['cf-cache-status'] ?? null, age: r.headers.age ?? null, remaining: r.headers['x-fb-rate-limit-requests-remaining'] ?? null });
  }
  log('ticker_bulk_stats', stats(polls));
  for (const k of ['btcbrl', 'usdtbrl', 'btcusdt', 'solusdt']) log('ticker_changes', { market: k, polls: polls.length, changes: changes[k] ?? {} });
}

async function errors() {
  const cases = [
    '/markets/nopebrl/orderbook',
    '/markets/btcbrl/orderbook?depth=301',
    '/markets/btcbrl/orderbook?depth=0',
    '/markets/BTCBRL/orderbook?depth=1',
    '/markets/nopebrl/ticker/24hr',
    '/nope',
  ];
  for (const p of cases) {
    const r = await get(p);
    const levels = r.json?.bids ? { bids: r.json.bids.length, asks: r.json.asks.length } : undefined;
    log('error_case', { path: p, status: r.status, ...(levels ?? { body: r.text.slice(0, 300) }), headers: r.headers });
  }
  const offs = [];
  for (let i = 0; i < 7; i++) {
    const t0 = Date.now();
    const r = await get('/system/time', 300);
    const t1 = Date.now();
    const server = r.json.timestamp ?? Date.parse(r.json.iso);
    offs.push({ offsetMs: server - (t0 + t1) / 2, rttMs: t1 - t0 });
    if (i === 0) log('time_reply', { status: r.status, body: r.text, headers: r.headers });
  }
  log('clock', { offsetsMs: offs.map((o) => r1(o.offsetMs)), rttMs: offs.map((o) => o.rttMs) });
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, book, ticker, errors }[mode];
if (!run) {
  console.error('mode must be catalog, book, ticker or errors');
  process.exit(1);
}
await run();
