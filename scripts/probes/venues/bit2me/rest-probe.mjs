// Bit2Me REST probe: host and latency, the Pro spot catalog and how it would map to CCXT, the bulk ticker, the REST book
// (depth, level order, nonce and caching), the broker reference price, error shapes, the clock, and the futures paths.
// Public, unauthenticated, read-only. About 75 requests per full run against a published limit of 600 per minute per IP.
// Run from server/: node ../scripts/probes/venues/bit2me/rest-probe.mjs [catalog|book|poll|errors|futures|all]
//   catalog  DNS, cold and warm timing, market-config and tickers summaries, the CCXT 4.5.68 exchange list. About 10 s.
//   book     REST order-book on five markets, level order, depth, nonce, then 10 polls of BTC/EUR one second apart. About 15 s.
//   poll     tickers every second for 30 s: reply time and how often BTC/EUR bid, ask and timestamp change. About 32 s.
//   errors   unknown symbol, missing symbol, unknown path, and the Date header against the local clock. About 3 s.
//   futures  guessed futures REST paths next to a bogus path, since only a futures socket is documented. About 3 s.
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/bit2me/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import dns from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const API = 'https://gateway.bit2me.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (x) => Math.round(x * 10) / 10;

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text.slice(0, 2_000_000));
}

async function get(path) {
  const url = path.startsWith('http') ? path : API + path;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = performance.now() - t0;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.replace(/\s+/g, ' ').slice(0, 200);
  }
  return { status: res.status, ms, bytes: text.length, body, text, headers: res.headers };
}

async function catalog() {
  for (const host of ['gateway.bit2me.com', 'ws.bit2me.com', 'api.bit2me.com']) {
    try {
      log('dns', { host, a: await dns.resolve4(host) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const times = [];
  let mc;
  for (let i = 0; i < 4; i++) {
    mc = await get('/v1/trading/market-config');
    times.push(r1(mc.ms));
  }
  log('market_config_timing', { status: mc.status, bytes: mc.bytes, coldThenWarmMs: times });
  keep('market-config.json', mc.text);

  const markets = mc.body;
  const byStatus = {};
  const byQuote = {};
  const enabledByQuote = {};
  for (const m of markets) {
    byStatus[m.marketEnabled] = (byStatus[m.marketEnabled] ?? 0) + 1;
    const quote = m.symbol.split('/')[1];
    byQuote[quote] = (byQuote[quote] ?? 0) + 1;
    if (m.marketEnabled === 'enabled') enabledByQuote[quote] = (enabledByQuote[quote] ?? 0) + 1;
  }
  const fees = {};
  for (const m of markets) {
    const k = `${m.feeMakerPercentage}/${m.feeTakerPercentage}`;
    fees[k] = (fees[k] ?? 0) + 1;
  }
  const bases = new Map();
  for (const m of markets) {
    const [b, q] = m.symbol.split('/');
    bases.set(b, [...(bases.get(b) ?? []), q]);
  }
  const multiQuote = [...bases.values()].filter((qs) => qs.length > 1).length;
  log('market_config', {
    count: markets.length,
    fields: Object.keys(markets[0]),
    byStatus,
    byQuote,
    enabledByQuote,
    feeMakerTakerPercentage: fees,
    notEnabled: markets.filter((m) => m.marketEnabled !== 'enabled').map((m) => `${m.symbol}:${m.marketEnabled}`),
    bases: bases.size,
    basesWithSeveralQuotes: multiQuote,
    btcUsdcAndEur: markets.filter((m) => m.symbol === 'BTC/EUR' || m.symbol === 'BTC/USDC'),
  });

  const tt = [];
  let tk;
  for (let i = 0; i < 3; i++) {
    tk = await get('/v2/trading/tickers');
    tt.push(r1(tk.ms));
  }
  keep('tickers.json', tk.text);
  const tickers = tk.body;
  const now = Date.now();
  const ages = tickers.map((t) => now - t.timestamp);
  const mcSet = new Set(markets.map((m) => m.symbol));
  const tkSet = new Set(tickers.map((t) => t.symbol));
  const noBid = tickers.filter((t) => !(t.bid > 0));
  const noAsk = tickers.filter((t) => !(t.ask > 0));
  const crossed = tickers.filter((t) => t.bid > 0 && t.ask > 0 && t.bid >= t.ask);
  const spreads = tickers
    .filter((t) => t.bid > 0 && t.ask > 0 && t.ask > t.bid)
    .map((t) => ((t.ask - t.bid) / ((t.ask + t.bid) / 2)) * 1e6);
  log('tickers', {
    status: tk.status,
    bytes: tk.bytes,
    warmMs: tt,
    count: tickers.length,
    fields: Object.keys(tickers[0]),
    sameSymbolsAsMarketConfig: tickers.length === markets.length && [...tkSet].every((s) => mcSet.has(s)),
    tickerAgeMs: { min: Math.min(...ages), median: pct(ages, 50), max: Math.max(...ages) },
    noBid: noBid.map((t) => t.symbol),
    noAsk: noAsk.map((t) => t.symbol),
    crossed: crossed.map((t) => `${t.symbol} ${t.bid}/${t.ask}`),
    spreadPpm: { p10: Math.round(pct(spreads, 10)), median: Math.round(pct(spreads, 50)), p90: Math.round(pct(spreads, 90)) },
    btcEur: tickers.find((t) => t.symbol === 'BTC/EUR'),
  });

  const last = await get('/v1/trading/trade/last?symbol=BTC/EUR&limit=3');
  const btcTicker = tickers.find((t) => t.symbol === 'BTC/EUR');
  // A last trade row is [side, price, amount, timestamp], and `limit` below 50 was ignored on 2026-09-22.
  log('last_trades_vs_ticker', {
    status: last.status,
    rows: Array.isArray(last.body) ? last.body.length : last.body,
    newestRow: Array.isArray(last.body) ? last.body[0] : null,
    tickerTimestamp: btcTicker.timestamp,
    tickerClose: btcTicker.close,
    tickerMinusNewestTradeMs: Array.isArray(last.body) ? btcTicker.timestamp - last.body[0][3] : null,
  });

  const ccxt = require('ccxt');
  log('ccxt', {
    version: ccxt.version,
    exchanges: ccxt.exchanges.length,
    bit2meLike: ccxt.exchanges.filter((e) => /bit2|2me|b2m/i.test(e)),
  });

  const ref = await get('/v3/currency/ticker/BTC?rateCurrency=EUR');
  log('reference_price', { path: '/v3/currency/ticker/BTC?rateCurrency=EUR', status: ref.status, ms: r1(ref.ms), body: ref.body });
}

async function book() {
  const symbols = ['BTC/EUR', 'ETH/EUR', 'BTC/USDC', 'B2M/EUR', 'PERP/EUR'];
  for (const s of symbols) {
    const r = await get(`/v2/trading/order-book?symbol=${encodeURIComponent(s)}`);
    if (r.status !== 200) {
      log('rest_book', { symbol: s, status: r.status, body: r.body });
      continue;
    }
    const b = r.body;
    const bidsDesc = b.bids.every((l, i) => i === 0 || l[0] < b.bids[i - 1][0]);
    const asksAsc = b.asks.every((l, i) => i === 0 || l[0] > b.asks[i - 1][0]);
    log('rest_book', {
      symbol: s,
      ms: r1(r.ms),
      bytes: r.bytes,
      keys: Object.keys(b),
      bids: b.bids.length,
      asks: b.asks.length,
      bidsDescending: bidsDesc,
      asksAscending: asksAsc,
      touch: [b.bids[0], b.asks[0]],
      nonce: b.nonce,
      timestamp: b.timestamp,
      datetime: b.datetime,
      ageMs: Date.now() - b.timestamp,
      levelTypes: typeof b.bids[0]?.[0] + '/' + typeof b.bids[0]?.[1],
    });
    if (s === 'BTC/EUR') keep('book-btc-eur.json', r.text);
  }

  const seen = [];
  for (let i = 0; i < 10; i++) {
    const r = await get('/v2/trading/order-book?symbol=BTC/EUR');
    seen.push({ ms: r1(r.ms), nonce: r.body.nonce, ts: r.body.timestamp, ageMs: Date.now() - r.body.timestamp, etag: r.headers.get('etag'), touch: `${r.body.bids[0]?.[0]}/${r.body.asks[0]?.[0]}` });
    await sleep(1000);
  }
  const nonces = seen.map((x) => x.nonce);
  log('rest_book_polls', {
    polls: seen,
    distinctNonces: new Set(nonces).size,
    nonceEqualsTimestamp: seen.filter((x) => x.nonce === x.ts).length,
    nonceSteps: nonces.slice(1).map((n, i) => n - nonces[i]),
  });
}

async function poll() {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    const r = await get('/v2/trading/tickers');
    const btc = r.body.find((t) => t.symbol === 'BTC/EUR');
    rows.push({ ms: r.ms, ts: btc.timestamp, bid: btc.bid, ask: btc.ask, ageMs: Date.now() - btc.timestamp, all: r.body.map((t) => t.timestamp) });
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  const ms = rows.map((r) => r.ms);
  const changed = (k) => rows.slice(1).filter((r, i) => r[k] !== rows[i][k]).length;
  const tsAll = rows.map((r) => Math.max(...r.all));
  log('tickers_poll', {
    polls: rows.length,
    replyMs: { min: r1(Math.min(...ms)), median: r1(pct(ms, 50)), p90: r1(pct(ms, 90)), max: r1(Math.max(...ms)) },
    btcEurChanges: { timestamp: changed('ts'), bid: changed('bid'), ask: changed('ask') },
    btcEurAgeMs: { min: Math.min(...rows.map((r) => r.ageMs)), median: pct(rows.map((r) => r.ageMs), 50), max: Math.max(...rows.map((r) => r.ageMs)) },
    newestTimestampSteps: tsAll.slice(1).map((t, i) => t - tsAll[i]),
  });
}

async function errors() {
  const cases = [
    '/v2/trading/order-book?symbol=NOPE/EUR',
    '/v2/trading/order-book',
    '/v2/trading/order-book?symbol=BTC-EUR',
    '/v2/trading/tickers?symbol=NOPE/EUR',
    '/v1/trading/market-config?symbol=NOPE/EUR',
    '/v2/trading/order-book?symbol=B2M/USDR',
    '/v1/nope',
  ];
  for (const c of cases) {
    const r = await get(c);
    log('error_case', { path: c, status: r.status, ms: r1(r.ms), body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 300), retryAfter: r.headers.get('retry-after') });
  }
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/v1/trading/market-config?symbol=BTC/EUR');
    const t1 = Date.now();
    const server = Date.parse(r.headers.get('date'));
    offsets.push({ dateHeader: r.headers.get('date'), localMid: new Date((t0 + t1) / 2).toISOString(), offsetMs: Math.round(server - (t0 + t1) / 2) });
    await sleep(300);
  }
  log('clock', { note: 'Date header has one second resolution', offsets });
}

async function futures() {
  const paths = [
    '/v1/futures/instruments',
    '/v1/futures/markets',
    '/v1/futures/tickers',
    '/v1/futures/funding-rate',
    '/v2/futures/tickers',
    '/v1/derivatives/instruments',
    '/v1/nope/nope',
  ];
  for (const p of paths) {
    const r = await get(p);
    log('futures_path', { path: p, status: r.status, body: typeof r.body === 'string' ? r.body.slice(0, 120) : JSON.stringify(r.body).slice(0, 120) });
  }
  for (const p of ['https://ws.bit2me.com/v1/futures/connection/websocket', 'https://ws.bit2me.com/v1/nope']) {
    const r = await get(p);
    log('ws_host_get', { url: p, status: r.status, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) });
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, book, poll, errors, futures };
log('start', { mode, at: new Date().toISOString() });
for (const [name, fn] of Object.entries(modes)) {
  if (mode === name || mode === 'all') await fn();
}
log('end', { at: new Date().toISOString() });
