// Bitso REST probe: host and latency, the spot catalog and how CCXT maps it, the REST book, the bulk ticker cadence, error shapes and clock offset.
// Public, unauthenticated, read-only. Bitso allows 60 public requests per minute per IP and locks an IP out for a minute past that, so every request here waits 2 s after the previous one.
// Run from server/: node ../scripts/probes/venues/bitso/rest-probe.mjs [catalog|book|ticker|errors]
//   catalog  DNS, one cold and five warm available_books calls, then CCXT 4.5.68 loadMarkets and its market fields. About 20 s, 8 requests.
//   book     aggregated and unaggregated order_book on four books, level order, sequence, caching, ticker compare. About 25 s, 11 requests.
//   ticker   the undocumented bulk ticker every 2 s for 60 s: reply time, size, and how often each field changes. 30 requests.
//   errors   unknown book, missing book, unknown path, and the clock offset from the Date header. About 15 s, 6 requests.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitso/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.bitso.com/v3';
const SPACING_MS = 2_000;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

let lastRequestAt = 0;

async function get(path) {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const localAfter = Date.now();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const headers = Object.fromEntries(['date', 'cf-ray', 'cf-cache-status', 'retry-after', 'x-envoy-upstream-service-time', 'age', 'cache-control'].map((h) => [h, res.headers.get(h)]).filter(([, v]) => v !== null));
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, path.replace(/[^a-z0-9]+/gi, '_') + '.json'), text);
  }
  return { status: res.status, ms, bytes: text.length, json, text, headers, localAfter };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function catalog() {
  for (const host of ['api.bitso.com', 'bitso.com', 'ws.bitso.com']) {
    log('dns', { host, addresses: await dns.resolve4(host).catch((e) => e.code) });
  }
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/available_books/');
    times.push(r.ms);
    if (i === 0) log('available_books', { status: r.status, bytes: r.bytes, cold_ms: r.ms, books: r.json?.payload?.length, headers: r.headers });
  }
  log('available_books_warm', stats(times.slice(1)));

  const ex = new ccxt.bitso();
  await sleep(SPACING_MS);
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  log('ccxt_loadMarkets', { ms: Math.round(performance.now() - t0), count: Object.keys(markets).length, rateLimit: ex.rateLimit, restUrl: ex.urls.api.rest });
  const list = Object.values(markets);
  const count = (f) => list.reduce((m, x) => ((m[String(f(x))] = (m[String(f(x))] ?? 0) + 1), m), {});
  log('ccxt_fields', {
    type: count((m) => m.type),
    active: count((m) => m.active),
    contractSize: count((m) => m.contractSize),
    linear: count((m) => m.linear),
    quote: count((m) => m.quote),
    takerMaker: count((m) => `${m.taker}/${m.maker}`),
    idEqualsInfoBook: list.every((m) => m.id === m.info.book),
    idLowercaseUnderscore: list.every((m) => m.id === `${m.baseId}_${m.quoteId}` && m.id === m.id.toLowerCase()),
  });
  const btc = markets['BTC/USD'];
  log('ccxt_btc_usd', { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, taker: btc.taker, maker: btc.maker, active: btc.active, contractSize: btc.contractSize, precision: btc.precision, tiers0: btc.tiers?.taker?.slice(0, 3), flatRate: btc.info.fees.flat_rate });
  const byBase = {};
  for (const m of list) (byBase[m.base] ??= []).push(m.quote);
  const family = new Set(['USD', 'USDC', 'USDT']);
  const twice = Object.entries(byBase).filter(([, qs]) => qs.filter((q) => family.has(q)).length > 1).map(([b, qs]) => `${b}:${qs.join('+')}`);
  log('ccxt_pairs_in_usd_family_twice', { twice });
}

async function book() {
  const books = ['btc_usd', 'btc_mxn', 'bar_usd', 'tusd_btc'];
  for (const b of books) {
    const r = await get(`/order_book/?book=${b}`);
    const p = r.json?.payload;
    const bids = p?.bids ?? [];
    const asks = p?.asks ?? [];
    const desc = bids.every((x, i) => i === 0 || Number(bids[i - 1].price) > Number(x.price));
    const asc = asks.every((x, i) => i === 0 || Number(asks[i - 1].price) < Number(x.price));
    const serverNow = Date.parse(r.headers.date);
    log('order_book_aggregated', { book: b, status: r.status, ms: r.ms, bytes: r.bytes, bids: bids.length, asks: asks.length, bidsDescending: desc, asksAscending: asc, sequence: p?.sequence, sequenceType: typeof p?.sequence, updated_at: p?.updated_at, updatedAgeS: Math.round((serverNow - Date.parse(p?.updated_at)) / 1000), levelKeys: Object.keys(bids[0] ?? asks[0] ?? {}), top: { bid: bids[0], ask: asks[0] } });
  }
  for (const b of ['btc_usd', 'btc_mxn']) {
    const r = await get(`/order_book/?book=${b}&aggregate=false`);
    const p = r.json?.payload;
    const bids = p?.bids ?? [];
    const asks = p?.asks ?? [];
    const levels = (xs) => new Set(xs.map((x) => x.price)).size;
    const desc = bids.every((x, i) => i === 0 || Number(bids[i - 1].price) >= Number(x.price));
    const asc = asks.every((x, i) => i === 0 || Number(asks[i - 1].price) <= Number(x.price));
    log('order_book_whole', { book: b, status: r.status, ms: r.ms, bytes: r.bytes, bidOrders: bids.length, askOrders: asks.length, bidLevels: levels(bids), askLevels: levels(asks), bidsDescending: desc, asksAscending: asc, sequence: p?.sequence, levelKeys: Object.keys(bids[0] ?? {}) });
  }
  const seqs = [];
  for (let i = 0; i < 3; i++) {
    const r = await get('/order_book/?book=btc_usd');
    seqs.push({ sequence: r.json?.payload?.sequence, updated_at: r.json?.payload?.updated_at, ms: r.ms, cache: r.headers['cf-cache-status'], age: r.headers.age });
  }
  log('order_book_repeat_2s', { seqs });
  const t = await get('/ticker/?book=btc_usd');
  const ob = await get('/order_book/?book=btc_usd');
  log('ticker_vs_book', { ticker: { bid: t.json?.payload?.bid, ask: t.json?.payload?.ask, created_at: t.json?.payload?.created_at }, book: { bid: ob.json?.payload?.bids?.[0]?.price, ask: ob.json?.payload?.asks?.[0]?.price, updated_at: ob.json?.payload?.updated_at } });
}

async function ticker() {
  const times = [];
  const sizes = [];
  const prev = new Map();
  const changes = {};
  const createdAt = new Set();
  const fields = ['bid', 'ask', 'last', 'vwap', 'volume', 'high', 'low', 'change_24'];
  let books = 0;
  for (let i = 0; i < 30; i++) {
    const r = await get('/ticker/');
    times.push(r.ms);
    sizes.push(r.bytes);
    const rows = r.json?.payload ?? [];
    books = rows.length;
    for (const row of rows) {
      createdAt.add(row.created_at);
      const before = prev.get(row.book);
      if (before) {
        for (const f of fields) if (before[f] !== row[f]) ((changes[row.book] ??= {})[f] = (changes[row.book]?.[f] ?? 0) + 1);
      }
      prev.set(row.book, row);
    }
  }
  log('ticker_bulk', { polls: times.length, books, ms: stats(times), bytes: stats(sizes), distinctCreatedAt: createdAt.size, rowKeys: Object.keys([...prev.values()][0] ?? {}) });
  for (const b of ['btc_usd', 'btc_usdt', 'eth_usd', 'btc_mxn', 'usd_mxn', 'bar_usd', 'tusd_btc']) log('ticker_changes_in_29_intervals', { book: b, ...(changes[b] ?? {}) });
  const changedBooks = Object.keys(changes).length;
  log('ticker_books_with_any_change', { changedBooks, of: books });
}

async function errors() {
  for (const path of ['/ticker/?book=nope_usd', '/order_book/?book=nope_usd', '/order_book/', '/trades/?book=nope_usd', '/nope/']) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, ms: r.ms, body: r.text.slice(0, 200), headers: r.headers });
  }
  const offsets = [];
  for (let i = 0; i < 1; i++) {
    const r = await get('/ticker/?book=btc_usd');
    offsets.push({ dateHeader: r.headers.date, localAtReply: new Date(r.localAfter).toISOString(), created_at: r.json?.payload?.created_at, createdMinusLocalMs: Date.parse(r.json?.payload?.created_at) - r.localAfter });
  }
  log('clock', { offsets, note: 'Date and created_at have 1 s resolution, the WS ack time field is in ms, see ws-probe.mjs' });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, book, ticker, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, expected one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
