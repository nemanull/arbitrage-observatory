// Bitexlive public REST probe: host and latency, the spot catalog, the order book call, trades, errors, and how often the tickers change.
// Public, unauthenticated, read-only. The documented public calls are currencies, tickers, recentTrades and orderBook, from https://bitexlive.com/api.
// No rate limit is published, so requests go one at a time and every loop pauses 1 to 2 s between calls.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitexlive/rest-probe.mjs [host|catalog|book|trades|poll|ccxt]
//   host     DNS, cold and warm request times, response headers and the Date header offset. About 20 s.
//   catalog  tickers, currencies and the exchange page's pair list, with crossed tickers counted. About 5 s.
//   book     orderBook at several limits, level order, rounding against the ticker, and the error shapes. About 15 s.
//   trades   recentTrades at the maximum limit, spacing, duplicate ids and the volume fields. About 3 s.
//   poll     tickers every 2 s for 150 s: how often each pair's quote and timestamp change. About 155 s.
//   ccxt     confirms CCXT 4.5.68 has no class for the venue.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitexlive/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://prod.bitexlive.com/api/public';
const PAGE_URL = 'https://bitexlive.com/exchange/BTC_USDT';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t = Date.now();
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const text = await res.text();
  const ms = Date.now() - t;
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, ms, bytes: text.length, headers: Object.fromEntries(res.headers), text, body };
}

function order(prices) {
  let asc = true;
  let desc = true;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] < prices[i - 1]) asc = false;
    if (prices[i] > prices[i - 1]) desc = false;
  }
  return asc && desc ? 'flat' : asc ? 'ascending' : desc ? 'descending' : 'unordered';
}

async function host() {
  for (const h of ['prod.bitexlive.com', 'bitexlive.com', 'wss.bitexlive.com']) log('dns', { host: h, addrs: (await lookup(h, { all: true })).map((a) => a.address) });
  const cold = await get(`${API}/tickers`);
  const h = cold.headers;
  log('cold', { url: '/tickers', status: cold.status, ms: cold.ms, bytes: cold.bytes, server: h.server, cfRay: h['cf-ray'], cacheControl: h['cache-control'], cfCache: h['cf-cache-status'], rateHeaders: Object.keys(h).filter((k) => /rate|limit|retry/i.test(k)) });
  const offsets = [];
  const warm = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1_000);
    const before = Date.now();
    const r = await get(`${API}/orderBook?filter=BTC_USDT&limit=5`);
    warm.push(r.ms);
    const dateMs = Date.parse(r.headers.date);
    offsets.push(dateMs - (before + r.ms / 2)); // Date is whole seconds, so each offset is only good to about one second
    if (r.body?.LastUpdateTimestamp) offsets.push(r.body.LastUpdateTimestamp * 1000 - (before + r.ms / 2));
  }
  warm.sort((a, b) => a - b);
  log('warm', { url: '/orderBook?filter=BTC_USDT&limit=5', n: warm.length, min: warm[0], median: warm[5], max: warm[9] });
  log('offsets', { note: 'even entries are the Date header, odd are LastUpdateTimestamp, ms against local clock', values: offsets.map(Math.round) });
}

async function loadPairs() {
  const r = await get(PAGE_URL);
  const start = r.text.indexOf('window.pageData = ') + 'window.pageData = '.length;
  let depth = 0;
  let end = start;
  for (; end < r.text.length; end++) {
    if (r.text[end] === '{') depth++;
    else if (r.text[end] === '}' && --depth === 0) break;
  }
  return JSON.parse(r.text.slice(start, end + 1));
}

async function catalog() {
  const t = await get(`${API}/tickers`);
  keep('tickers.json', t.text);
  const rows = t.body;
  const crossed = rows.filter((x) => x.highestBid !== null && x.lowestAsk !== null && x.highestBid >= x.lowestAsk);
  log('tickers', { status: t.status, ms: t.ms, bytes: t.bytes, count: rows.length, keys: Object.keys(rows[0]), quotes: [...new Set(rows.map((x) => x.tradingPairs.split('_')[1]))], tradesEnabledFalse: rows.filter((x) => !x.tradesEnabled).length, nullQuotes: rows.filter((x) => x.highestBid === null || x.lowestAsk === null).length, timestamps: [...new Set(rows.map((x) => x.lastUpdateTimestamp))] });
  log('crossed', { count: crossed.length, rows: crossed.map((x) => `${x.tradingPairs} bid ${x.highestBid} ask ${x.lowestAsk}`) });
  log('volume', { rows: rows.map((x) => `${x.tradingPairs} ${Math.round(x.quoteVolume24h)}`).join(', ') });
  const c = await get(`${API}/currencies`);
  keep('currencies.json', c.text);
  log('currencies', { status: c.status, bytes: c.bytes, count: c.body.length, fiat: c.body.filter((x) => x.isFiat).length, depositClosed: c.body.filter((x) => !x.canDeposit).map((x) => x.symbol), withdrawClosed: c.body.filter((x) => !x.canWithdraw).map((x) => x.symbol) });
  const filtered = await get(`${API}/tickers?filter=BTC_USDT`);
  log('ticker_filter', { status: filtered.status, count: Array.isArray(filtered.body) ? filtered.body.length : null, body: filtered.text.slice(0, 300) });
  const page = await loadPairs();
  const pairs = Object.values(page.pairs).flat();
  log('page_pairs', { tabs: Object.keys(page.pairs), count: pairs.length, notInTickers: pairs.filter((p) => !rows.some((x) => x.tradingPairs === p.title)).map((p) => p.title), tickersNotOnPage: rows.filter((x) => !pairs.some((p) => p.title === x.tradingPairs)).map((x) => x.tradingPairs), fields: Object.keys(pairs[0]), decimals: pairs.map((p) => `${p.title} p${p.price_decimals} a${p.amount_decimals}`).join(', ') });
}

async function book() {
  for (const limit of [undefined, 5, 50, 51, 100, 0]) {
    const r = await get(`${API}/orderBook?filter=BTC_USDT${limit === undefined ? '' : `&limit=${limit}`}`);
    const b = r.body;
    log('book_limit', { limit: limit ?? 'none', status: r.status, ms: r.ms, bytes: r.bytes, bids: b?.bids?.length, asks: b?.asks?.length, keys: b ? Object.keys(b) : null, ts: b?.LastUpdateTimestamp, bidOrder: b?.bids ? order(b.bids.map((x) => Number(x[0]))) : null, askOrder: b?.asks ? order(b.asks.map((x) => Number(x[0]))) : null, types: b?.bids?.[0]?.map((v) => typeof v) });
    if (limit === 50) keep('book-btc-50.json', r.text);
    await sleep(1_000);
  }
  const t = (await get(`${API}/tickers`)).body;
  for (const sym of ['BTC_USDT', 'ETH_USDT', 'ZRX_USDT', 'LTC_USDT']) {
    const r = await get(`${API}/orderBook?filter=${sym}&limit=50`);
    const b = r.body;
    const bestBid = Math.max(...b.bids.map((x) => Number(x[0])));
    const bestAsk = Math.min(...b.asks.map((x) => Number(x[0])));
    const tk = t.find((x) => x.tradingPairs === sym);
    log('book_top', { sym, bids: b.bids.length, asks: b.asks.length, firstBid: b.bids[0][0], lastAsk: b.asks.at(-1)[0], firstAsk: b.asks[0][0], bestBid, bestAsk, crossed: bestBid >= bestAsk, tickerBid: tk.highestBid, tickerAsk: tk.lowestAsk, askLevelsBelowBestBid: b.asks.filter((a) => Number(a[0]) <= bestBid).length, bidLevelsAboveBestAsk: b.bids.filter((x) => Number(x[0]) >= bestAsk).length, sizesHave8dp: b.bids.every((x) => /\.\d{8}$/.test(x[1])) });
    await sleep(1_000);
  }
  for (const [label, url] of [
    ['unknown symbol', `${API}/orderBook?filter=NOPE_USDT`],
    ['lowercase symbol', `${API}/orderBook?filter=btc_usdt&limit=2`],
    ['slash symbol', `${API}/orderBook?filter=BTC/USDT&limit=2`],
    ['no filter', `${API}/orderBook`],
    ['unknown path', `${API}/nope`],
    ['trades unknown symbol', `${API}/recentTrades?filter=NOPE_USDT`],
  ]) {
    const r = await get(url);
    log('error_shape', { label, status: r.status, contentType: r.headers['content-type'], bytes: r.bytes, body: r.body ? r.text.slice(0, 300) : r.text.replace(/\s+/g, ' ').slice(0, 160) });
    await sleep(1_000);
  }
}

async function trades() {
  const r = await get(`${API}/recentTrades?filter=BTC_USDT&limit=50`);
  keep('trades-btc.json', r.text);
  const rows = r.body;
  const times = rows.map((x) => Date.parse(x.time.replace(' ', 'T') + 'Z'));
  const gaps = [];
  for (let i = 1; i < times.length; i++) if (times[i - 1] !== times[i]) gaps.push((times[i - 1] - times[i]) / 1000);
  const ids = rows.map((x) => x.tradeID);
  log('trades', { status: r.status, ms: r.ms, count: rows.length, keys: Object.keys(rows[0]), distinctIds: new Set(ids).size, idEqualsUnixSecond: rows.filter((x, i) => x.tradeID * 1000 === times[i]).length, types: [...new Set(rows.map((x) => x.type))], gapsSeconds: gaps, baseVolumeOverPrice: rows.slice(0, 4).map((x) => `${x.baseVolume} / ${x.price} = ${(x.baseVolume / x.price).toPrecision(4)}, quoteVolume ${x.quoteVolume}`), usdPerTrade: rows.filter((x, i) => i % 2 === 0).map((x) => Math.round(x.baseVolume)) });
  const d = await get(`${API}/recentTrades?filter=BTC_USDT&limit=100`);
  log('trades_limit_100', { status: d.status, count: Array.isArray(d.body) ? d.body.length : null });
}

async function poll() {
  const seen = new Map(); // pair to last { bid, ask, ts, last }
  const changes = new Map(); // pair to { quote, ts, last }
  const ms = [];
  const tsSet = new Map();
  const end = Date.now() + 150_000;
  let n = 0;
  while (Date.now() < end) {
    const started = Date.now();
    const r = await get(`${API}/tickers`);
    n++;
    ms.push(r.ms);
    if (r.status !== 200) log('poll_status', { status: r.status, body: r.text.slice(0, 200) });
    for (const x of r.body ?? []) {
      const prev = seen.get(x.tradingPairs);
      const c = changes.get(x.tradingPairs) ?? { quote: 0, ts: 0, last: 0 };
      if (prev) {
        if (prev.bid !== x.highestBid || prev.ask !== x.lowestAsk) c.quote++;
        if (prev.ts !== x.lastUpdateTimestamp) c.ts++;
        if (prev.last !== x.LastPrice) c.last++;
      }
      changes.set(x.tradingPairs, c);
      seen.set(x.tradingPairs, { bid: x.highestBid, ask: x.lowestAsk, ts: x.lastUpdateTimestamp, last: x.LastPrice });
      if (x.tradingPairs === 'BTC_USDT' && !tsSet.has(x.lastUpdateTimestamp)) tsSet.set(x.lastUpdateTimestamp, new Date().toISOString());
    }
    await sleep(Math.max(0, 2_000 - (Date.now() - started)));
  }
  ms.sort((a, b) => a - b);
  log('poll', { polls: n, secs: 150, minMs: ms[0], medianMs: ms[Math.floor(ms.length / 2)], p90Ms: ms[Math.floor(ms.length * 0.9)], maxMs: ms.at(-1) });
  log('poll_changes', { rows: [...changes.entries()].map(([k, v]) => `${k} q${v.quote} t${v.ts} l${v.last}`).join(', ') });
  log('btc_timestamps', { seen: [...tsSet.entries()].map(([k, v]) => `${k} first read ${v}`) });
}

async function ccxt() {
  const c = require('ccxt');
  log('ccxt', { version: c.version, classes: c.exchanges.length, matches: c.exchanges.filter((x) => /bitex/i.test(x)) });
}

const mode = process.argv[2] ?? 'host';
const modes = { host, catalog, book, trades, poll, ccxt };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, utc: new Date().toISOString() });
await modes[mode]();
log('end', { mode, utc: new Date().toISOString() });
