// Cryptal public REST probe: host and latency, the spot catalog, the ticker, the order book, error shapes, rate limit headers, and one minute of one second polls.
// Public, unauthenticated, read-only. Every call is a GET on https://exchange.cryptal.com/exchange/api/v1/public, at most two per second against a header budget of 20 per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/cryptal/rest-probe.mjs [catalog|book|poll]
//   catalog  DNS, cold and warm times, pairs, currencies, ticker and allMarketsSummery counts, fees, spreads, rate limit headers, Date offset, CCXT ids. About 15 s.
//   book     order book depth limits, level order, timestamp age, ticker against book, and the error replies. About 25 s.
//   poll     60 rounds of ticker plus BTC-USD book, one round per second, and how often each number changed. About 65 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/cryptal/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'exchange.cryptal.com';
const API = `https://${HOST}/exchange/api/v1/public`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`);
  const text = await res.text();
  const recvAt = Date.now();
  const ms = Math.round(performance.now() - t0);
  const h = (k) => res.headers.get(k);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: res.status,
    ms,
    recvAt,
    bytes: text.length,
    text,
    json,
    date: h('date'),
    rl: { burst: h('x-ratelimit-burst-capacity'), rate: h('x-ratelimit-replenish-rate'), remaining: h('x-ratelimit-remaining'), retryAfter: h('retry-after') },
    server: h('server'),
    cache: h('cache-control'),
  };
}

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });

  const paths = ['/pairs', '/currencies', '/ticker', '/allMarketsSummery', '/orderbook/BTC-USD', '/trades/BTC-USD?limit=5'];
  const replies = {};
  for (const p of paths) {
    const first = await get(p);
    await sleep(300);
    const warm = [];
    for (let i = 0; i < 3; i++) {
      warm.push((await get(p)).ms);
      await sleep(300);
    }
    replies[p] = first;
    save(`catalog${p.replace(/[/?=]/g, '_')}.json`, first.text);
    log('latency', { path: p, status: first.status, bytes: first.bytes, firstMs: first.ms, warmMs: warm, rateLimit: first.rl, server: first.server, cache: first.cache });
  }

  // Date has one second resolution, so the offset is bounded from ten replies: server minus local lies between the largest lower bound and the smallest upper bound.
  let lo = -Infinity;
  let hi = Infinity;
  for (let i = 0; i < 10; i++) {
    const r = await get('/currencies');
    const sent = r.recvAt - r.ms;
    const d = Date.parse(r.date);
    lo = Math.max(lo, d - r.recvAt);
    hi = Math.min(hi, d + 999 - sent);
    await sleep(237);
  }
  log('date_header', { offsetLowerMs: lo, offsetUpperMs: hi, note: 'server Date minus local clock, one second resolution' });

  const pairs = replies['/pairs'].json;
  const byQuote = {};
  const fees = {};
  for (const p of pairs) {
    const k = `${p.quoteCurrency}(${p.quoteCurrencyDisplayCode}) tradeEnabled=${p.tradeEnabled}`;
    byQuote[k] = (byQuote[k] ?? 0) + 1;
    const f = `maker ${p.makerFee} taker ${p.takerFee}`;
    fees[f] = (fees[f] ?? 0) + 1;
  }
  log('pairs', { count: pairs.length, byQuote, fees, disabled: pairs.filter((p) => !p.tradeEnabled).map((p) => p.pair), odd: pairs.filter((p) => p.takerFee !== '0.0025').map((p) => `${p.pair} maker ${p.makerFee} taker ${p.takerFee}`) });
  log('pairs_example', { row: Object.fromEntries(Object.entries(pairs.find((p) => p.pair === 'BTC-USD')).filter(([k]) => ['pair', 'pairDisplayName', 'baseCurrency', 'quoteCurrency', 'quoteCurrencyDisplayCode', 'quoteCurrencyName', 'baseScale', 'quoteScale', 'minSize', 'minCost', 'maxSize', 'takerFee', 'makerFee', 'orderTypes', 'tradeEnabled'].includes(k))) });

  const currencies = replies['/currencies'].json;
  log('currencies', { count: currencies.length, fiat: currencies.filter((c) => c.type === 'FIAT').map((c) => `${c.code}=${c.displayCode} "${c.name}" types=${c.types} networks=${Object.keys(c.providerToUrlPattern ?? {})}`) });

  const ticker = replies['/ticker'].json;
  const ams = replies['/allMarketsSummery'].json;
  const pairSet = new Set(pairs.map((p) => p.pair));
  const amsPairs = ams.pairs.map((p) => p.pair);
  log('ticker', {
    tickerRows: ticker.length,
    amsTickers: ams.tickers.length,
    amsPairs: amsPairs.length,
    amsPairsNotInPairs: amsPairs.filter((p) => !pairSet.has(p)),
    tickerNotEnabled: ticker.filter((t) => !pairs.find((p) => p.pair === t.pair)?.tradeEnabled).map((t) => t.pair),
    timestampValues: [...new Set(ticker.map((t) => t.timestamp))].slice(0, 5),
    nullBidOrAsk: ticker.filter((t) => t.bidPrice === null || t.askPrice === null).map((t) => t.pair),
  });

  const spreads = ticker
    .filter((t) => t.bidPrice !== null && t.askPrice !== null)
    .map((t) => ({ pair: t.pair, bid: Number(t.bidPrice), ask: Number(t.askPrice), usdVol: t.quoteVolume }))
    .map((t) => ({ ...t, ppm: Math.round(((t.ask - t.bid) / ((t.ask + t.bid) / 2)) * 1e6) }));
  const ppms = spreads.map((s) => s.ppm);
  log('spreads', { pairs: spreads.length, minPpm: Math.min(...ppms), medianPpm: pct(ppms, 50), p90Ppm: pct(ppms, 90), maxPpm: Math.max(...ppms), crossedOrZero: spreads.filter((s) => s.ppm <= 0).map((s) => s.pair) });
  for (const p of ['BTC-USD', 'ETH-USD', 'XRP-USD', 'SOL-USD', 'USDT-USD', 'BTC-USDT', 'BTC-EUR', 'BTC-GEL']) {
    const s = spreads.find((x) => x.pair === p);
    if (s) log('spread', { pair: p, bid: s.bid, ask: s.ask, ppm: s.ppm, quoteVolume24h: s.usdVol });
  }

  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, cryptalLike: ccxt.exchanges.filter((id) => /cryptal/i.test(id)), crypLike: ccxt.exchanges.filter((id) => /cryp/i.test(id)) });
}

function orderOk(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (dir === 'desc' ? b >= a : b <= a) return false;
  }
  return true;
}

async function book() {
  for (const pair of ['BTC-USD', 'ETH-USD', 'XRP-USD', 'USDT-USD', 'XLM-BTC']) {
    for (const limit of [null, 5, 25, 100, 1000]) {
      const r = await get(`/orderbook/${pair}${limit === null ? '' : `?limit=${limit}`}`);
      const recv = Date.now();
      const b = r.json;
      if (r.status !== 200 || !b?.bids) {
        log('book', { pair, limit, status: r.status, body: r.text.slice(0, 200) });
      } else {
        const costOk = [...b.bids, ...b.asks].every((l) => Math.abs(Number(l.price) * Number(l.volume) - Number(l.totalCost)) <= 0.011 * Math.max(1, Number(l.totalCost) / 1000));
        log('book', { pair, limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: b.bids.length, asks: b.asks.length, bidsDesc: orderOk(b.bids, 'desc'), asksAsc: orderOk(b.asks, 'asc'), ageMs: recv - b.timestamp, bestBid: b.bids[0]?.price, bestAsk: b.asks[0]?.price, totalCostIsPriceTimesVolume: costOk });
        if (limit === 25 && pair === 'BTC-USD') save('book_BTC-USD_25.json', r.text);
      }
      await sleep(350);
    }
  }

  const ticker = (await get('/ticker')).json;
  await sleep(350);
  for (const pair of ['BTC-USD', 'ETH-USD', 'XRP-USD']) {
    const b = (await get(`/orderbook/${pair}?limit=25`)).json;
    const t = ticker.find((x) => x.pair === pair);
    log('ticker_vs_book', { pair, tickerBid: t.bidPrice, bookBid: b.bids[0]?.price, tickerAsk: t.askPrice, bookAsk: b.asks[0]?.price });
    await sleep(350);
  }

  const single = await get('/ticker?pair=BTC-USD');
  log('ticker_single', { status: single.status, isArray: Array.isArray(single.json), rows: Array.isArray(single.json) ? single.json.length : null, body: single.text.slice(0, 160) });
  await sleep(350);

  const errors = ['/orderbook/NOPE-USD', '/orderbook/btc-usd', '/orderbook/BTC_USD', '/orderbook/BTC-USD?limit=0', '/orderbook/BTC-USD?limit=-1', '/orderbook/BTC-USD?limit=abc', '/orderbook/XLM-BTC', '/ticker?pair=NOPE-USD', '/trades/NOPE-USD', '/time', '/serverTime'];
  for (const p of errors) {
    const r = await get(p);
    const b = r.json;
    log('error_case', { path: p, status: r.status, body: b?.bids ? `book bids ${b.bids.length} asks ${b.asks.length}` : r.text.slice(0, 220) });
    await sleep(350);
  }
}

async function poll() {
  const rounds = 60;
  const tickerMs = [];
  const bookMs = [];
  const prev = {};
  const changes = {};
  const bump = (k, v) => {
    if (prev[k] !== undefined && prev[k] !== v) changes[k] = (changes[k] ?? 0) + 1;
    prev[k] = v;
  };
  let bookTsSame = 0;
  let lastBookTs = null;
  const bookAges = [];
  const statuses = {};
  const remaining = [];
  for (let i = 0; i < rounds; i++) {
    const start = Date.now();
    const t = await get('/ticker');
    tickerMs.push(t.ms);
    statuses[t.status] = (statuses[t.status] ?? 0) + 1;
    remaining.push(Number(t.rl.remaining));
    if (t.status === 200) {
      for (const pair of ['BTC-USD', 'ETH-USD', 'XRP-USD', 'USDT-USD']) {
        const row = t.json.find((x) => x.pair === pair);
        bump(`${pair} bid`, row.bidPrice);
        bump(`${pair} ask`, row.askPrice);
        bump(`${pair} last`, row.lastTradePrice);
      }
    }
    const b = await get('/orderbook/BTC-USD?limit=25');
    const recv = Date.now();
    bookMs.push(b.ms);
    statuses[b.status] = (statuses[b.status] ?? 0) + 1;
    if (b.status === 200) {
      if (b.json.timestamp === lastBookTs) bookTsSame++;
      lastBookTs = b.json.timestamp;
      bookAges.push(recv - b.json.timestamp);
      bump('book BTC-USD top', `${b.json.bids[0]?.price}/${b.json.asks[0]?.price}`);
      bump('book BTC-USD levels', JSON.stringify([b.json.bids.slice(0, 25), b.json.asks.slice(0, 25)]));
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  const summary = (xs) => ({ min: Math.min(...xs), median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs), over1s: xs.filter((x) => x > 1000).length });
  log('poll', { rounds, statuses, tickerMs: summary(tickerMs), bookMs: summary(bookMs), minRateLimitRemaining: Math.min(...remaining) });
  log('poll_changes', { of: rounds - 1, changes });
  log('poll_book_timestamp', { sameAsPrevious: bookTsSame, ageMs: summary(bookAges) });
}

const mode = process.argv[2] ?? 'catalog';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'catalog') await catalog();
else if (mode === 'book') await book();
else if (mode === 'poll') await poll();
else throw new Error(`unknown mode ${mode}`);
log('done', { mode, at: new Date().toISOString() });
