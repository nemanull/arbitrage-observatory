// BTC Markets REST probe: host and latency, the v3 market catalog against CCXT 4.5.68, the bulk ticker and order book calls, snapshot age and caching, rate limit headers, error shapes and the server clock.
// Public, unauthenticated, read-only. At most about three requests a second, far inside the limits the replies advertise.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btcmarkets/rest-probe.mjs [catalog|poll|book|errors]
//   catalog  DNS, cold and warm request time, /v3/markets by status and quote, CCXT loadMarkets, server time offset. About 15 s.
//   poll     /v3/markets/tickers for every market once a second for 30 s: reply size and time, how often each field changes, timestamp age.
//   book     REST order book depth at level 1 and 2, entries per price, snapshot age, caching, and the bulk orderbooks call. About 30 s.
//   errors   the error body and status of bad arguments, and the rate limit headers of each endpoint group. About 10 s.
// Recorded in docs/profiles/btcmarkets/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.btcmarkets.net/v3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (arr, q) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${path}`);
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  const h = res.headers;
  const date = Date.parse(h.get('date'));
  return {
    status: res.status, text, ms: Math.round(ms), ttfbMs: Math.round(ttfb), bytes: text.length, arrival: Date.now(),
    rl: { limit: h.get('x-ratelimit-limit'), remaining: h.get('x-ratelimit-remaining'), resetInS: h.get('x-ratelimit-reset') ? Number(h.get('x-ratelimit-reset')) - Math.floor(date / 1000) : null, retryAfter: h.get('retry-after') },
    cache: h.get('cache-control'), cf: h.get('cf-cache-status'), ray: h.get('cf-ray'),
  };
}

async function catalog() {
  const addrs = await lookup('api.btcmarkets.net', { all: true });
  log('dns', { host: 'api.btcmarkets.net', addresses: addrs.map((a) => a.address) });
  const ws = await lookup('socket.btcmarkets.net', { all: true });
  log('dns', { host: 'socket.btcmarkets.net', addresses: ws.map((a) => a.address) });

  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('time');
    times.push({ ms: r.ms, ttfbMs: r.ttfbMs });
    await sleep(500);
  }
  log('time_latency', { first: times[0], warm: times.slice(1).map((t) => t.ms) });

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('time');
    const t1 = Date.now();
    offsets.push(Date.parse(JSON.parse(r.text).timestamp) - (t0 + t1) / 2);
    await sleep(500);
  }
  log('clock', { serverMinusLocalMs: offsets.map((x) => Math.round(x)), sample: (await get('time')).text });

  const m = await get('markets');
  const markets = JSON.parse(m.text);
  const by = (f) => markets.reduce((acc, x) => ((acc[f(x)] = (acc[f(x)] ?? 0) + 1), acc), {});
  log('markets', { status: m.status, ms: m.ms, bytes: m.bytes, count: markets.length, byStatus: by((x) => x.status), byQuote: by((x) => x.quoteAssetName), offline: markets.filter((x) => x.status !== 'Online').map((x) => x.marketId), keys: Object.keys(markets[0]), rl: m.rl });

  const ex = new ccxt.btcmarkets();
  const loaded = await ex.loadMarkets();
  const list = Object.values(loaded);
  const types = list.reduce((acc, x) => ((acc[x.type] = (acc[x.type] ?? 0) + 1), acc), {});
  const takerByQuote = {};
  for (const x of list) (takerByQuote[x.quote] ??= new Set()).add(`${x.taker}/${x.maker}`);
  const idMatches = list.filter((x) => markets.some((y) => y.marketId === x.id)).length;
  const sample = loaded['BTC/AUD'];
  log('ccxt', {
    version: ccxt.version, count: list.length, types, swaps: list.filter((x) => x.swap).length, active: list.filter((x) => x.active).length,
    inactive: list.filter((x) => !x.active).map((x) => x.id), idEqualsMarketId: idMatches,
    takerMakerByQuote: Object.fromEntries(Object.entries(takerByQuote).map(([k, v]) => [k, [...v]])),
    btcAud: { id: sample.id, symbol: sample.symbol, taker: sample.taker, maker: sample.maker, contractSize: sample.contractSize ?? null, linear: sample.linear ?? null, precision: sample.precision },
    has: { fetchTickers: ex.has.fetchTickers, fetchFundingRate: ex.has.fetchFundingRate, fetchMarkPrices: ex.has.fetchMarkPrices, watchOrderBook: ex.has.watchOrderBook ?? null },
  });
}

async function poll() {
  const markets = JSON.parse((await get('markets')).text).map((x) => x.marketId);
  const query = markets.map((id) => `marketId=${id}`).join('&');
  const prev = new Map();
  const changes = new Map(markets.map((id) => [id, { bid: 0, ask: 0, last: 0, ts: 0 }]));
  const ages = [];
  const times = [];
  let rows = null;
  let bytes = null;
  let rl = null;
  for (let i = 0; i < 30; i++) {
    const started = Date.now();
    const r = await get(`markets/tickers?${query}`);
    times.push(r.ms);
    bytes = r.bytes;
    rl = r.rl;
    const list = JSON.parse(r.text);
    rows = list.length;
    for (const t of list) {
      ages.push(r.arrival - Date.parse(t.timestamp));
      const p = prev.get(t.marketId);
      if (p) {
        const c = changes.get(t.marketId);
        if (p.bestBid !== t.bestBid) c.bid++;
        if (p.bestAsk !== t.bestAsk) c.ask++;
        if (p.lastPrice !== t.lastPrice) c.last++;
        if (p.timestamp !== t.timestamp) c.ts++;
      }
      prev.set(t.marketId, t);
    }
    await sleep(Math.max(0, 1_000 - (Date.now() - started)));
  }
  const btc = prev.get('BTC-AUD');
  log('tickers', { marketsAsked: markets.length, rows, bytes, ms: { min: pct(times, 0), median: pct(times, 0.5), p90: pct(times, 0.9), max: pct(times, 1) }, rl, keys: Object.keys(btc), btcAud: btc });
  log('ticker_changes_in_29_steps', { BTC_AUD: changes.get('BTC-AUD'), ETH_AUD: changes.get('ETH-AUD'), XRP_AUD: changes.get('XRP-AUD'), BTC_USDT: changes.get('BTC-USDT'), OMG_AUD: changes.get('OMG-AUD') });
  const tsChangedEveryStep = [...changes.values()].filter((c) => c.ts === 29).length;
  log('ticker_timestamp', { marketsWhoseTimestampChangedEveryStep: tsChangedEveryStep, ageMs: { min: pct(ages, 0), median: pct(ages, 0.5), p90: pct(ages, 0.9), max: pct(ages, 1) } });
  const one = await get('markets/tickers?marketId=BTC-AUD&marketId=NOPE-AUD');
  log('tickers_with_unknown_market', { status: one.status, body: one.text.slice(0, 200) });
}

async function book() {
  for (const level of [1, 2]) {
    const ages = [];
    const ids = [];
    let shape = null;
    for (let i = 0; i < 10; i++) {
      const r = await get(`markets/BTC-AUD/orderbook?level=${level}`);
      const b = JSON.parse(r.text);
      ages.push(r.arrival - Number(b.snapshotId) / 1000);
      ids.push(b.snapshotId);
      const prices = (side) => new Set(side.map((x) => x[0])).size;
      const sorted = (side, desc) => side.every((x, j) => j === 0 || (desc ? Number(side[j - 1][0]) >= Number(x[0]) : Number(side[j - 1][0]) <= Number(x[0])));
      shape = { status: r.status, bytes: r.bytes, ms: r.ms, entries: { bids: b.bids.length, asks: b.asks.length }, distinctPrices: { bids: prices(b.bids), asks: prices(b.asks) }, tuple: b.bids[0]?.length, bidsDescending: sorted(b.bids, true), asksAscending: sorted(b.asks, false), cache: r.cache, cf: r.cf, rl: r.rl };
      await sleep(i % 2 === 0 ? 250 : 1_000);
    }
    const repeats = ids.filter((x, j) => j > 0 && x === ids[j - 1]).length;
    log('rest_book', { market: 'BTC-AUD', level, ...shape, snapshotAgeMs: { min: Math.round(pct(ages, 0)), median: Math.round(pct(ages, 0.5)), max: Math.round(pct(ages, 1)) }, sameSnapshotIdAsPrevious: repeats, of: ids.length - 1 });
  }
  const multi = await get('markets/orderbooks?marketId=BTC-AUD&marketId=ETH-AUD&marketId=XRP-AUD');
  const mb = JSON.parse(multi.text);
  log('orderbooks_bulk', { status: multi.status, ms: multi.ms, bytes: multi.bytes, rows: mb.length, entries: mb.map((x) => [x.marketId, x.bids.length, x.asks.length]), keys: Object.keys(mb[0]), rl: multi.rl });
  const all = JSON.parse((await get('markets')).text).map((x) => x.marketId);
  const allBooks = await get(`markets/orderbooks?${all.map((id) => `marketId=${id}`).join('&')}`);
  log('orderbooks_bulk_all', { status: allBooks.status, ms: allBooks.ms, bytes: allBooks.bytes, rows: allBooks.status === 200 ? JSON.parse(allBooks.text).length : allBooks.text.slice(0, 200) });
  const offline = await get('markets/MCAU-AUD/orderbook');
  log('offline_market_book', { status: offline.status, body: offline.text.slice(0, 200) });
}

async function errors() {
  const cases = ['markets/NOPE-AUD/orderbook', 'markets/btc-aud/orderbook', 'markets/BTC-AUD/orderbook?level=3', 'markets/tickers', 'markets/orderbooks', 'markets/BTC-AUD/nope', 'nope', 'markets/BTC-AUD/trades?limit=1', 'markets/BTC-AUD/ticker', 'markets/BTC-AUD/candles?timeWindow=1m&limit=1'];
  for (const path of cases) {
    const r = await get(path);
    log('call', { path, status: r.status, ms: r.ms, body: r.text.slice(0, 160), rl: r.rl, cache: r.cache, cf: r.cf });
    await sleep(700);
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, poll, book, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
