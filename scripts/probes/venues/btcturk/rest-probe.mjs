// BtcTurk spot REST probe: host and latency, the exchangeinfo catalog against CCXT, the bulk ticker over 30 one second polls, the REST book, error shapes, and the clock offset.
// Public, unauthenticated, read-only. It stays far inside the published per IP limits: 600 ticker and 180 orderbook calls a minute.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btcturk/rest-probe.mjs [host|catalog|poll|book|time]
//   host     DNS, then cold and warm request times and cache headers for four public calls.
//   catalog  exchangeinfo counts, and what CCXT 4.5.68 loadMarkets makes of it.
//   poll     the bulk ticker once a second for 30 polls: reply time, size, changed rows, cache status.
//   book     the REST book at several limits, level order, age, repeat reads, and error replies.
//   time     server time against the local clock, five samples.
// Recorded in docs/profiles/btcturk/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.btcturk.com/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const HEADERS = ['cf-cache-status', 'cache-control', 'age', 'content-encoding', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'server', 'cf-ray'];

function stats(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (x) => Math.round(x * 10) / 10;
  return { n: s.length, min: r(s[0]), median: r(q(0.5)), p90: r(q(0.9)), max: r(s[s.length - 1]) };
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
  const text = await res.text();
  const ms = performance.now() - t0;
  const headers = Object.fromEntries(HEADERS.filter((h) => res.headers.has(h)).map((h) => [h, res.headers.get(h)]));
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, bytes: text.length, headers, json, text };
}

async function host() {
  for (const name of ['api.btcturk.com', 'ws-feed-pro.btcturk.com', 'graph-api.btcturk.com']) {
    log('dns', { name, v4: await dns.resolve4(name).catch((e) => e.code), v6: await dns.resolve6(name).catch((e) => e.code) });
  }
  const calls = ['/server/time', '/ticker', '/orderbook?pairSymbol=BTCUSDT', '/server/exchangeinfo'];
  for (const path of calls) {
    const times = [];
    let first;
    for (let i = 0; i < 6; i++) {
      const r = await get(API + path);
      times.push(r.ms);
      if (i === 0) first = r;
      await sleep(300);
    }
    log('latency', { path, status: first.status, bytes: first.bytes, firstMs: Math.round(times[0]), warm: stats(times.slice(1)), headers: first.headers });
  }
}

async function catalog() {
  const r = await get(`${API}/server/exchangeinfo`);
  const syms = r.json.data.symbols;
  const count = (f) => syms.reduce((m, s) => ((m[f(s)] = (m[f(s)] ?? 0) + 1), m), {});
  const byBase = count((s) => s.numerator);
  const twice = Object.entries(byBase).filter(([, n]) => n > 1).map(([b]) => b);
  log('exchangeinfo', {
    status: r.status, bytes: r.bytes, ms: Math.round(r.ms), symbols: syms.length, byStatus: count((s) => s.status), byQuote: count((s) => s.denominator),
    basesOnBothQuotes: twice.length, keys: Object.keys(syms[0]), idEqualsBasePlusQuote: syms.filter((s) => s.name === s.numerator + s.denominator).length,
    hasFraction: count((s) => String(s.hasFraction)), orderMethods: count((s) => s.orderMethods.join('|')), btcusdt: syms.find((s) => s.name === 'BTCUSDT'),
  });

  const ex = new ccxt.btcturk();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const ms = Object.values(markets);
  const idSet = new Set(syms.map((s) => s.name));
  log('ccxt', {
    version: ccxt.version, loadMs: Math.round(performance.now() - t0), markets: ms.length, types: [...new Set(ms.map((m) => m.type))], swaps: ms.filter((m) => m.swap).length,
    active: ms.filter((m) => m.active).length, idMatchesRestName: ms.filter((m) => idSet.has(m.id)).length,
    takerValues: [...new Set(ms.map((m) => m.taker))], makerValues: [...new Set(ms.map((m) => m.maker))], contractSize: [...new Set(ms.map((m) => m.contractSize))], linear: [...new Set(ms.map((m) => m.linear))],
    sample: (({ id, symbol, base, quote, type, spot, swap, active, taker, maker, contractSize, precision }) => ({ id, symbol, base, quote, type, spot, swap, active, taker, maker, contractSize, precision }))(markets['BTC/USDT']),
  });
}

async function poll() {
  const times = [], sizes = [], changed = [], cache = {}, ages = [];
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const started = performance.now();
    const r = await get(`${API}/ticker`);
    times.push(r.ms);
    sizes.push(r.bytes);
    cache[r.headers['cf-cache-status'] ?? 'none'] = (cache[r.headers['cf-cache-status'] ?? 'none'] ?? 0) + 1;
    const rows = new Map(r.json.data.map((x) => [x.pair, `${x.bid}|${x.ask}|${x.last}`]));
    const now = Date.now();
    ages.push(now - Math.max(...r.json.data.map((x) => x.timestamp)));
    if (prev) changed.push([...rows].filter(([k, v]) => prev.get(k) !== v).length);
    if (i === 0) log('ticker_row', { rows: rows.size, sample: r.json.data.find((x) => x.pair === 'BTCUSDT') });
    prev = rows;
    await sleep(Math.max(0, 1000 - (performance.now() - started)));
  }
  log('poll_summary', { replyMs: stats(times), bytes: stats(sizes), rowsChangedPerPoll: stats(changed), newestTimestampAgeMs: stats(ages), cacheStatus: cache });
}

async function book() {
  for (const q of ['', '&limit=25', '&limit=100', '&limit=500', '&limit=1000']) {
    const r = await get(`${API}/orderbook?pairSymbol=BTCUSDT${q}`);
    const d = r.json?.data;
    const bids = d?.bids ?? [], asks = d?.asks ?? [];
    log('rest_book', {
      query: q || '(no limit)', status: r.status, ms: Math.round(r.ms), bytes: r.bytes, levels: [bids.length, asks.length], ageMs: d ? Date.now() - d.timestamp : null,
      bidsDesc: bids.every((x, i) => i === 0 || Number(bids[i - 1][0]) > Number(x[0])), asksAsc: asks.every((x, i) => i === 0 || Number(asks[i - 1][0]) < Number(x[0])),
      touch: [bids[0], asks[0]], keys: d ? Object.keys(d) : null, headers: r.headers,
    });
    await sleep(500);
  }
  const reads = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${API}/orderbook?pairSymbol=ETHUSDT&limit=100`);
    reads.push({ ms: Math.round(r.ms), ts: r.json.data.timestamp, body: r.text.length, cache: r.headers['cf-cache-status'] ?? null });
    await sleep(150);
  }
  log('rest_book_repeats', { reads, distinctTimestamps: new Set(reads.map((x) => x.ts)).size });
  const errors = [
    ['unknown pair', `${API}/orderbook?pairSymbol=NOPEUSDT`],
    ['lowercase pair', `${API}/orderbook?pairSymbol=btcusdt`],
    ['underscore pair', `${API}/orderbook?pairSymbol=BTC_USDT`],
    ['missing pairSymbol', `${API}/orderbook`],
    ['ticker unknown pair', `${API}/ticker?pairSymbol=NOPEUSDT`],
    ['unknown path', `${API}/nope`],
  ];
  for (const [name, url] of errors) {
    const r = await get(url);
    const d = r.json?.data;
    log('error_reply', { name, status: r.status, body: r.text.slice(0, 220), levels: d?.bids ? [d.bids.length, d.asks.length] : null, headers: r.headers });
    await sleep(400);
  }
}

async function time() {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/server/time`);
    const t1 = Date.now();
    offsets.push({ rttMs: t1 - t0, offsetMs: r.json.serverTime - (t0 + t1) / 2 });
    await sleep(500);
  }
  log('clock', { samples: offsets, offsetMs: stats(offsets.map((x) => x.offsetMs)) });
}

const mode = process.argv[2] ?? 'host';
const modes = { host, catalog, poll, book, time };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, utc: new Date().toISOString() });
await modes[mode]();
log('end', { mode, utc: new Date().toISOString() });
