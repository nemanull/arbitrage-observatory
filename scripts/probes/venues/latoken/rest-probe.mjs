// LATOKEN REST probe: host latency and clock, spot catalog and CCXT mapping, fee endpoints, book snapshot shape and caching, ticker cadence, rate limit headers and error shapes.
// Public, unauthenticated, read-only. Paced at about one request a second, which is CCXT's rateLimit for this venue, since LATOKEN publishes no number.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/latoken/rest-probe.mjs [latency|catalog|fees|book|ticker|errors]
//   latency  one cold and twenty warm GET /v2/time, and the clock offset. About 25 s.
//   catalog  /v2/pair, /v2/currency, /v2/ticker and CCXT loadMarkets, counted by status and quote, with the id forms compared. About 15 s.
//   fees     /v2/trade/feeLevels and /v2/trade/fee on a sample of pairs. About 20 s.
//   book     /v2/book depth limits, level order, tag against id paths, and 30 polls of BTC/USDT at 1 s for caching. About 45 s.
//   ticker   30 polls of /v2/ticker at 1 s: reply size and time, how often four pairs' best bid, best ask and last change. About 35 s.
//   errors   unknown pair, unknown path and bad limit replies, with status codes and rate limit headers. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/latoken/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.latoken.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const BTC = '92151d82-df98-4d88-9a4d-284fa9eca49f';
const USDT = '0c3a106d-bde3-4c13-a26e-3fd2394529e5';

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const headers = {};
  for (const h of ['cache-control', 'x-rate-limit-remaining', 'x-rate-limit-limit', 'retry-after', 'x-la-cf-cache-status', 'cf-cache-status', 'age', 'content-type']) {
    const v = res.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  return { status: res.status, ms, bytes: text.length, json, text, headers };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function latency() {
  const cold = await get('/v2/time');
  log('cold', { status: cold.status, ms: cold.ms, body: cold.text });
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    const r = await get('/v2/time');
    const t1 = Date.now();
    warm.push(r.ms);
    offsets.push(r.json.serverTime - (t0 + t1) / 2);
    await sleep(1000);
  }
  log('warm', stats(warm));
  log('clock_offset_ms', { ...stats(offsets.map(Math.round)), note: 'serverTime minus local midpoint' });
}

async function catalog() {
  const pairs = await get('/v2/pair');
  const currencies = await get('/v2/currency');
  const tickers = await get('/v2/ticker');
  keep('pair.json', pairs.text);
  keep('ticker.json', tickers.text);
  for (const [name, r] of [['pair', pairs], ['currency', currencies], ['ticker', tickers]]) {
    log('call', { name, status: r.status, bytes: r.bytes, ms: r.ms, rows: r.json.length, headers: r.headers });
  }
  const byId = new Map(currencies.json.map((c) => [c.id, c]));
  const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  log('pair_status', count(pairs.json, (p) => p.status));
  const active = pairs.json.filter((p) => p.status === 'PAIR_STATUS_ACTIVE');
  log('active_by_quote', count(active, (p) => byId.get(p.quoteCurrency)?.tag ?? 'unknown'));
  log('currency_type', count(currencies.json, (c) => c.type));
  log('base_type_of_active_pairs', count(active, (p) => byId.get(p.baseCurrency)?.type ?? 'unknown'));
  const tags = count(currencies.json.filter((c) => c.status === 'CURRENCY_STATUS_ACTIVE'), (c) => c.tag);
  const dupTags = Object.entries(tags).filter(([, n]) => n > 1);
  log('duplicate_active_tags', { count: dupTags.length, sample: dupTags.slice(0, 8) });
  const tickerSymbols = new Set(tickers.json.map((t) => t.symbol));
  const tagSymbol = (p) => `${byId.get(p.baseCurrency)?.tag}/${byId.get(p.quoteCurrency)?.tag}`;
  log('ticker_vs_pair', {
    tickers: tickers.json.length,
    activePairsWhoseTagSymbolIsATicker: active.filter((p) => tickerSymbols.has(tagSymbol(p))).length,
    tickerSample: tickers.json.slice(0, 2).map((t) => t.symbol),
  });
  const ex = new ccxt.latoken();
  const t0 = performance.now();
  await ex.loadMarkets();
  const markets = Object.values(ex.markets);
  log('ccxt_loadMarkets', { ms: Math.round(performance.now() - t0), markets: markets.length });
  log('ccxt_types', count(markets, (m) => `${m.type} active=${m.active}`));
  log('ccxt_swaps', { swap: markets.filter((m) => m.swap).length, future: markets.filter((m) => m.future).length, contract: markets.filter((m) => m.contract).length });
  log('ccxt_taker', count(markets, (m) => `taker=${m.taker} maker=${m.maker}`));
  const btc = ex.markets['BTC/USDT'];
  log('ccxt_btc_usdt', { id: btc.id, baseId: btc.baseId, quoteId: btc.quoteId, contractSize: btc.contractSize, linear: btc.linear, active: btc.active, taker: btc.taker, precision: btc.precision });
  const symbolsFromIds = new Map();
  for (const m of markets) symbolsFromIds.set(m.symbol, (symbolsFromIds.get(m.symbol) ?? 0) + 1);
  log('ccxt_symbol_collisions', { markets: markets.length, uniqueSymbols: symbolsFromIds.size, pairRows: pairs.json.length });
  const cryptoTicker = tickers.json.filter((t) => Number(t.bestBid) > 0 && Number(t.bestAsk) > 0);
  const zeroVol = tickers.json.filter((t) => Number(t.volume24h) === 0).length;
  log('ticker_books', { twoSided: cryptoTicker.length, zeroVolume24h: zeroVol });
  const top = [...tickers.json].sort((a, b) => Number(b.volume24h) - Number(a.volume24h)).slice(0, 12);
  log('top_by_volume24h_quote', top.map((t) => `${t.symbol} ${Math.round(Number(t.volume24h))}`));
}

async function fees() {
  const levels = await get('/v2/trade/feeLevels');
  log('feeLevels', { status: levels.status, ms: levels.ms, body: levels.json });
  const sample = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'TRX/USDT', 'ETH/BTC', 'LA/USDT', 'CADINU/USDT', 'FONE/USDT', 'TREE/USDT', 'BTC/USDC'];
  for (const s of sample) {
    await sleep(1000);
    const r = await get(`/v2/trade/fee/${s}`);
    log('fee', { pair: s, status: r.status, body: r.json ?? r.text.slice(0, 200) });
  }
  await sleep(1000);
  const byId = await get(`/v2/trade/fee/${BTC}/${USDT}`);
  log('fee_by_currency_id', { status: byId.status, body: byId.json });
}

function orderCheck(side, levels, dir) {
  let ordered = true;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (dir === 'desc' ? b >= a : b <= a) ordered = false;
  }
  return { side, levels: levels.length, ordered, first: levels[0]?.price, last: levels[levels.length - 1]?.price };
}

async function book() {
  for (const limit of [undefined, 1, 20, 100, 1000, 2000]) {
    const r = await get(`/v2/book/BTC/USDT${limit === undefined ? '' : `?limit=${limit}`}`);
    if (r.status !== 200) {
      log('book_limit', { limit, status: r.status, body: r.text.slice(0, 300) });
    } else {
      log('book_limit', { limit, status: r.status, bytes: r.bytes, ms: r.ms, bid: orderCheck('bid', r.json.bid, 'desc'), ask: orderCheck('ask', r.json.ask, 'asc'), keys: Object.keys(r.json), headers: r.headers });
      if (limit === 20) keep('book_btc_usdt_20.json', r.text);
    }
    await sleep(1000);
  }
  const byId = await get(`/v2/book/${BTC}/${USDT}?limit=5`);
  log('book_by_currency_id', { status: byId.status, bid0: byId.json?.bid?.[0], ask0: byId.json?.ask?.[0] });
  await sleep(1000);
  const sample = await get('/v2/book/BTC/USDT?limit=3');
  log('book_sample', { body: sample.json });
  const prev = { key: '', same: 0, changed: 0 };
  const times = [];
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const r = await get('/v2/book/BTC/USDT?limit=20');
    times.push(r.ms);
    const key = JSON.stringify([r.json.bid.slice(0, 20), r.json.ask.slice(0, 20)]);
    if (key === prev.key) prev.same++;
    else prev.changed++;
    prev.key = key;
  }
  log('book_poll_btc_usdt_20', { polls: 30, identicalToPrevious: prev.same, changed: prev.changed, ms: stats(times) });
}

async function ticker() {
  const watched = ['BTC/USDT', 'ETH/USDT', 'USDC/USDT', 'HBAR/USDT'];
  const times = [];
  const bytes = [];
  const prev = {};
  const changes = Object.fromEntries(watched.map((s) => [s, 0]));
  const ages = Object.fromEntries(watched.map((s) => [s, []]));
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    const r = await get('/v2/ticker');
    times.push(r.ms);
    bytes.push(r.bytes);
    for (const s of watched) {
      const row = r.json.find((t) => t.symbol === s);
      const key = `${row.bestBid}|${row.bestAsk}|${row.lastPrice}`;
      if (prev[s] !== undefined && key !== prev[s]) changes[s]++;
      prev[s] = key;
      ages[s].push(t0 - row.updateTimestamp);
      if (i === 0) log('ticker_row', { row });
    }
    if (i === 0) {
      const staleRows = r.json.filter((t) => t0 - t.updateTimestamp > 86_400_000).length;
      log('ticker_update_age', { rows: r.json.length, olderThanOneDay: staleRows, headers: r.headers });
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  log('ticker_poll', { polls: 30, ms: stats(times), bytes: stats(bytes) });
  for (const s of watched) log('ticker_changes', { symbol: s, changedBetweenPolls: changes[s], updateAgeMs: stats(ages[s]) });
  const book = await get('/v2/book/ETH/USDT?limit=1');
  log('eth_book_vs_last_ticker', { bookBid: book.json.bid[0]?.price, bookAsk: book.json.ask[0]?.price, tickerRow: prev['ETH/USDT'] });
}

async function errors() {
  const cases = [
    '/v2/book/NOPE/USDT',
    '/v2/book/BTC/USDT?limit=0',
    '/v2/ticker/NOPE/USDT',
    '/v2/ticker/BTC/USDT',
    '/v2/nope',
    '/v2/trade/fee/NOPE/USDT',
    '/v2/currency/NOPE',
  ];
  for (const c of cases) {
    const r = await get(c);
    log('error_case', { path: c, status: r.status, headers: r.headers, body: r.text.slice(0, 300) });
    await sleep(1000);
  }
}

const modes = { latency, catalog, fees, book, ticker, errors };
const mode = process.argv[2] ?? 'latency';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
