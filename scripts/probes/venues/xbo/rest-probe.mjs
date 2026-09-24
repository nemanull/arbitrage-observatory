// XBO.com REST probe: host and latency, public spot catalog, order book snapshot, polling cadence, gentle burst, the refused futures and Client API market data calls, clock offset.
// Public, unauthenticated, read-only. No API key is sent, so every call the docs mark as authenticated is expected to answer 401, and that refusal is what gets recorded.
// XBO publishes no rate limit, so requests run one at a time, and the burst mode stays under 5 requests per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/xbo/rest-probe.mjs [host|catalog|book|poll|burst|refused|compare|all]
//   host     DNS, one cold and ten warm requests per public endpoint, CDN headers, clock offset from the Date header and from the book timestamp. About 20 s.
//   catalog  GET /trading-pairs, /trading-pairs/stats, /currencies and /v1/spot-trading/symbols: counts, quotes, spelling, and CCXT 4.5.68 exchanges. About 10 s.
//   book     GET /orderbook/{symbol} at several depths on three pairs: level count, order, crossing, number type, timestamp age, and unknown symbols. About 15 s.
//   poll     60 polls at 1 s of the BTC/USDT and a thin book at depth 20, and 12 polls of /trading-pairs/stats at 5 s: reply time, how often the top and the timestamp change. About 130 s.
//   burst    40 sequential book requests at about 4 per second, then status codes and any rate limit headers. About 12 s.
//   refused  the futures catalog, the Client API book and stats, and a few undocumented guesses, all without a key: status, headers and body. About 5 s.
//   compare  10 samples at 1 s of the BTC/USDT and ETH/USDT touch against the public Binance spot bookTicker, for context. About 12 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/xbo/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.xbo.com';
const UA = 'arbitrage-observatory-research-probe/1.0'; // the docs ask for a descriptive User-Agent
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const enc = (s) => encodeURIComponent(s);

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, { raw = false } = {}) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'user-agent': UA, accept: 'application/json' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body = text;
  if (!raw && text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, headers: res.headers, ms, bytes: text.length, body, text, localMs: Date.now() };
}

const pick = (h, names) => Object.fromEntries(names.map((n) => [n, h.get(n)]).filter(([, v]) => v !== null));
const HEADERS = ['server', 'cf-ray', 'cf-cache-status', 'age', 'cache-control', 'content-type', 'date', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit', 'ratelimit-policy'];

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

async function host() {
  const addrs = await lookup('api.xbo.com', { all: true });
  log('dns', { host: 'api.xbo.com', addrs: addrs.map((a) => a.address) });
  for (const path of ['/trading-pairs', `/orderbook/${enc('BTC/USDT')}?depth=20`, '/trading-pairs/stats']) {
    const times = [];
    let first;
    for (let i = 0; i < 11; i++) {
      const r = await get(path);
      if (i === 0) first = r;
      else times.push(r.ms);
      await sleep(300);
    }
    log('latency', { path, status: first.status, bytes: first.bytes, coldMs: first.ms, warm: stats(times), headers: pick(first.headers, HEADERS) });
  }
  // Offset from the Date header, which has one second resolution, and from the book timestamp, which is the last update and not the reply time.
  const offsets = [];
  const bookAges = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(`/orderbook/${enc('BTC/USDT')}?depth=5`);
    const t1 = Date.now();
    const mid = (t0 + t1) / 2;
    offsets.push(Date.parse(r.headers.get('date')) - mid);
    if (typeof r.body?.timestamp === 'number') bookAges.push(Math.round(t1 - r.body.timestamp));
    await sleep(700);
  }
  log('clock', { dateHeaderMinusLocalMs: stats(offsets.map(Math.round)), bookTimestampAgeMs: stats(bookAges) });
}

async function catalog() {
  const tp = await get('/trading-pairs');
  keep('trading-pairs.json', tp.text);
  const rows = tp.body;
  const byQuote = {};
  for (const r of rows) byQuote[r.quoteCurrency] = (byQuote[r.quoteCurrency] ?? 0) + 1;
  const enabled = rows.filter((r) => r.isEnabled === true).length;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const dupes = rows.length - new Set(rows.map((r) => r.symbol)).size;
  const spelling = rows.filter((r) => r.symbol !== `${r.baseCurrency}/${r.quoteCurrency}`).map((r) => r.symbol);
  const perpLike = rows.filter((r) => /PERP|SWAP|-\d{6}/i.test(r.symbol)).map((r) => r.symbol);
  const zeroVol = rows.filter((r) => Number(r.last24HTradeVolume) === 0).length;
  const top = [...rows].sort((a, b) => (b.last24HTradeVolumeUsd ?? 0) - (a.last24HTradeVolumeUsd ?? 0)).slice(0, 8).map((r) => `${r.symbol} ${Math.round(r.last24HTradeVolumeUsd)}`);
  const usdSum = Math.round(rows.reduce((a, r) => a + (Number(r.last24HTradeVolumeUsd) || 0), 0));
  log('trading-pairs', { status: tp.status, ms: tp.ms, bytes: tp.bytes, rows: rows.length, enabled, byQuote, keys, dupes, spellingMismatch: spelling.slice(0, 5), perpLike, zeroVol, usd24hSum: usdSum, top });

  const st = await get('/trading-pairs/stats');
  keep('stats.json', st.text);
  const srows = st.body;
  const skeys = [...new Set(srows.flatMap((r) => Object.keys(r)))];
  const crossed = srows.filter((r) => r.highestBid > 0 && r.lowestAsk > 0 && r.highestBid >= r.lowestAsk).map((r) => `${r.symbol} ${r.highestBid}>=${r.lowestAsk}`);
  const noBid = srows.filter((r) => !(r.highestBid > 0)).length;
  const noAsk = srows.filter((r) => !(r.lowestAsk > 0)).length;
  const inTp = new Set(rows.map((r) => r.symbol));
  const onlyStats = srows.filter((r) => !inTp.has(r.symbol)).map((r) => r.symbol);
  log('stats', { status: st.status, ms: st.ms, bytes: st.bytes, rows: srows.length, keys: skeys, noBid, noAsk, crossed: crossed.slice(0, 5), crossedCount: crossed.length, onlyInStats: onlyStats.slice(0, 5) });

  const cur = await get('/currencies');
  const crows = cur.body;
  log('currencies', { status: cur.status, bytes: cur.bytes, rows: crows.length, crypto: crows.filter((c) => c.type === 'Crypto').length, fiat: crows.filter((c) => c.type === 'Fiat').length });

  // The Client API catalog answers without a key, and it is paged.
  const sym = [];
  let total = 0;
  for (let page = 1; page < 20; page++) {
    const r = await get(`/v1/spot-trading/symbols?page=${page}&count=100`);
    if (r.status !== 200) {
      log('symbols-page', { page, status: r.status, text: r.text.slice(0, 200) });
      break;
    }
    total = r.body.total;
    sym.push(...r.body.data);
    if (sym.length >= total || r.body.data.length === 0) break;
    await sleep(300);
  }
  const symSet = new Set(sym.map((s) => s.symbol));
  const inSymNotTp = [...symSet].filter((s) => !inTp.has(s));
  const inTpNotSym = [...inTp].filter((s) => !symSet.has(s));
  const big = await get('/v1/spot-trading/symbols?page=1&count=1000');
  log('client-symbols', { total, fetched: sym.length, keys: Object.keys(sym[0] ?? {}), inSymbolsNotTradingPairs: inSymNotTp.slice(0, 8), inSymbolsNotTradingPairsCount: inSymNotTp.length, inTradingPairsNotSymbols: inTpNotSym.slice(0, 8), inTradingPairsNotSymbolsCount: inTpNotSym.length, count1000: { status: big.status, rows: big.body?.data?.length } });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, xboLike: ccxt.exchanges.filter((e) => /xbo/i.test(e)) });
}

function orderInfo(side, desc) {
  let bad = 0;
  for (let i = 1; i < side.length; i++) if (desc ? side[i][0] >= side[i - 1][0] : side[i][0] <= side[i - 1][0]) bad++;
  return bad;
}

async function book() {
  for (const [symbol, depth] of [['BTC/USDT', undefined], ['BTC/USDT', 250], ['BTC/USDT', 251], ['BTC/USDT', 1000], ['BTC/USDT', 0], ['BTC/USDT', 1], ['ETH/USDT', 250], ['BTC/EUR', 250], ['ZEC/USDT', 250]]) {
    const path = `/orderbook/${enc(symbol)}` + (depth === undefined ? '' : `?depth=${depth}`);
    const r = await get(path);
    if (r.status !== 200 || typeof r.body !== 'object') {
      log('book', { symbol, depth, status: r.status, text: r.text.slice(0, 200) });
      await sleep(400);
      continue;
    }
    const { bids = [], asks = [], timestamp } = r.body;
    const types = [typeof bids[0]?.[0], typeof bids[0]?.[1]];
    const crossed = bids.length && asks.length ? bids[0][0] >= asks[0][0] : null;
    const spreadPpm = bids.length && asks.length ? Math.round(((asks[0][0] - bids[0][0]) / ((asks[0][0] + bids[0][0]) / 2)) * 1e6) : null;
    const zeroSize = [...bids, ...asks].filter((l) => !(l[1] > 0)).length;
    const bidDepthQuote = Math.round(bids.reduce((a, l) => a + l[0] * l[1], 0));
    if (symbol === 'BTC/USDT' && depth === 250) keep('book-btc-250.json', r.text);
    log('book', { symbol, depth, status: r.status, ms: r.ms, bytes: r.bytes, bids: bids.length, asks: asks.length, bidsNotDescending: orderInfo(bids, true), asksNotAscending: orderInfo(asks, false), types, top: [bids[0], asks[0]], spreadPpm, crossed, zeroSize, bidDepthQuote, timestampAgeMs: r.localMs - timestamp, cache: r.headers.get('cf-cache-status') });
    await sleep(400);
  }
  // Two reads 300 ms apart show whether the reply is cached.
  const a = await get(`/orderbook/${enc('BTC/USDT')}?depth=5`);
  await sleep(300);
  const b = await get(`/orderbook/${enc('BTC/USDT')}?depth=5`);
  log('book-repeat', { sameTimestamp: a.body.timestamp === b.body.timestamp, sameBody: a.text === b.text, ts: [a.body.timestamp, b.body.timestamp] });
  for (const path of [`/orderbook/${enc('NOPE/USDT')}`, `/orderbook/${enc('btc/usdt')}?depth=5`, '/orderbook/BTC/USDT', '/orderbook/BTCUSDT', '/orderbook/BTC-USDT', `/orderbook/${enc('BTC/USDT')}?depth=abc`, `/orderbook/${enc('BTC/USDT')}?depth=-1`, `/trades?symbol=${enc('NOPE/USDT')}`]) {
    const r = await get(path, { raw: true });
    log('book-error', { path, status: r.status, bytes: r.bytes, text: r.text.slice(0, 200) });
    await sleep(300);
  }
  const tr = await get(`/trades?symbol=${enc('BTC/USDT')}`);
  const t = tr.body;
  log('trades', { status: tr.status, ms: tr.ms, bytes: tr.bytes, rows: t.length, keys: Object.keys(t[0] ?? {}), newest: t[0], oldestAgeH: Math.round((Date.now() / 1000 - t[t.length - 1]?.timeStamp) / 360) / 10, types: [...new Set(t.map((x) => x.type))] });
}

async function poll() {
  const series = { 'BTC/USDT': [], 'ZEC/USDT': [] };
  for (let i = 0; i < 60; i++) {
    const tick = Date.now();
    for (const symbol of Object.keys(series)) {
      const r = await get(`/orderbook/${enc(symbol)}?depth=20`);
      series[symbol].push({ ms: r.ms, status: r.status, ts: r.body?.timestamp, age: r.localMs - r.body?.timestamp, top: JSON.stringify([r.body?.bids?.[0], r.body?.asks?.[0]]), all: r.text });
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  for (const [symbol, s] of Object.entries(series)) {
    let tsChanged = 0;
    let topChanged = 0;
    let bookChanged = 0;
    for (let i = 1; i < s.length; i++) {
      if (s[i].ts !== s[i - 1].ts) tsChanged++;
      if (s[i].top !== s[i - 1].top) topChanged++;
      if (s[i].all !== s[i - 1].all) bookChanged++;
    }
    const statuses = [...new Set(s.map((x) => x.status))];
    log('poll-book', { symbol, polls: s.length, statuses, replyMs: stats(s.map((x) => x.ms)), timestampChanged: tsChanged, topChanged, bookChanged, timestampAgeMs: stats(s.map((x) => x.age)) });
  }
  const snaps = [];
  for (let i = 0; i < 12; i++) {
    const tick = Date.now();
    const r = await get('/trading-pairs/stats');
    snaps.push({ ms: r.ms, rows: new Map(r.body.map((x) => [x.symbol, `${x.highestBid}|${x.lowestAsk}|${x.lastPrice}`])) });
    await sleep(Math.max(0, 5000 - (Date.now() - tick)));
  }
  const changed = [];
  for (let i = 1; i < snaps.length; i++) {
    let n = 0;
    for (const [k, v] of snaps[i].rows) if (snaps[i - 1].rows.get(k) !== v) n++;
    changed.push(n);
  }
  const btc = snaps.map((s) => s.rows.get('BTC/USDT'));
  log('poll-stats', { polls: snaps.length, replyMs: stats(snaps.map((s) => s.ms)), rowsChangedPer5s: changed, btcDistinct: new Set(btc).size });
}

async function burst() {
  const codes = {};
  const rl = new Set();
  const times = [];
  for (let i = 0; i < 40; i++) {
    const tick = Date.now();
    const r = await get(`/orderbook/${enc('ETH/USDT')}?depth=5`);
    codes[r.status] = (codes[r.status] ?? 0) + 1;
    times.push(r.ms);
    for (const [k, v] of r.headers) if (/rate|retry|limit/i.test(k)) rl.add(`${k}: ${v}`);
    await sleep(Math.max(0, 250 - (Date.now() - tick)));
  }
  log('burst', { requests: 40, codes, replyMs: stats(times), rateHeaders: [...rl] });
}

async function refused() {
  const paths = [
    ['documented, key required', '/v1/futures/trading-pairs'],
    ['documented, key required', `/v1/spot-trading/orderbook/${enc('BTC/USDT')}?depth=5`],
    ['documented, key required', '/v1/spot-trading/trading-pairs/stats'],
    ['Client API, no key', '/v1/spot-trading/symbols?page=1&count=1'],
    ['Client API, no key', '/v1/currencies'],
    ['guess, undocumented', '/futures/trading-pairs'],
    ['guess, undocumented', '/v1/futures/tickers'],
    ['guess, undocumented', '/v1/time'],
  ];
  for (const [kind, path] of paths) {
    const r = await get(path, { raw: true });
    log('refused', { kind, path, status: r.status, bytes: r.bytes, text: r.text.slice(0, 160), headers: pick(r.headers, ['content-type', 'www-authenticate', 'cf-ray', 'server']) });
    await sleep(400);
  }
}

// Context only: where the spot touch sits against Binance spot, read one public bookTicker per sample.
async function compare() {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const tick = Date.now();
    for (const [x, b] of [['BTC/USDT', 'BTCUSDT'], ['ETH/USDT', 'ETHUSDT']]) {
      const r = await get(`/orderbook/${enc(x)}?depth=1`);
      const bn = await (await fetch(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${b}`)).json();
      const xm = (r.body.bids[0][0] + r.body.asks[0][0]) / 2;
      const bm = (Number(bn.bidPrice) + Number(bn.askPrice)) / 2;
      rows.push({ x, spreadPpm: Math.round(((r.body.asks[0][0] - r.body.bids[0][0]) / xm) * 1e6), midVsBinancePpm: Math.round(((xm - bm) / bm) * 1e6), bidBelowBinanceBid: r.body.bids[0][0] <= Number(bn.bidPrice), askAboveBinanceAsk: r.body.asks[0][0] >= Number(bn.askPrice) });
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  for (const x of ['BTC/USDT', 'ETH/USDT']) {
    const s = rows.filter((r) => r.x === x);
    log('compare', { symbol: x, samples: s.length, spreadPpm: stats(s.map((r) => r.spreadPpm)), midVsBinancePpm: stats(s.map((r) => r.midVsBinancePpm)), straddlesBinance: s.filter((r) => r.bidBelowBinanceBid && r.askAboveBinanceAsk).length });
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { host, catalog, book, poll, burst, refused, compare };
const run = mode === 'all' ? Object.keys(modes) : [mode];
log('start', { mode, at: new Date().toISOString() });
for (const m of run) {
  if (!modes[m]) throw new Error(`unknown mode ${m}`);
  await modes[m]();
}
log('end', { at: new Date().toISOString() });
