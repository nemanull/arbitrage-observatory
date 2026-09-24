// Bitvavo REST probe: host and latency, the spot catalog and how CCXT maps it, the bulk best bid and ask call,
// the REST book snapshot and its nonce, rate limit headers, error shapes, server time, and CoinGecko listing context.
// Public, unauthenticated, read-only. Unauthenticated calls count against a 1,000 weight per minute budget per IP,
// and going over it blocks the IP for 15 minutes, so each mode spends under 100 weight points.
// Run from server/: node ../scripts/probes/venues/bitvavo/rest-probe.mjs [main|poll]
//   main  DNS, 10 server time calls, markets, CCXT loadMarkets, ticker/book, books, errors, CoinGecko. About 10 s and 30 weight.
//   poll  GET /ticker/book for every market once a second for 60 s. About 61 s and 60 weight.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitvavo/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.bitvavo.com/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const round = (x) => Math.round(x);

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, { raw = false } = {}) {
  const url = path.startsWith('http') ? path : API + path;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = performance.now() - t0;
  const h = res.headers;
  const limit = {
    remaining: h.get('bitvavo-ratelimit-remaining'),
    resetAt: h.get('bitvavo-ratelimit-resetat'),
    limit: h.get('bitvavo-ratelimit-limit'),
  };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, ms, bytes: text.length, body, text: raw ? text : undefined, limit, headers: h };
}

async function main() {
  for (const host of ['api.bitvavo.com', 'ws.bitvavo.com', 'ws-mdpro.bitvavo.com', 'docs.bitvavo.com', 'bitvavo.com']) {
    try {
      log('dns', { host, a: await dns.resolve4(host) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const times = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get('/time');
    const after = Date.now();
    times.push(r.ms);
    offsets.push(r.body.time - (before + after) / 2);
    if (i === 0) log('time_first', { status: r.status, ms: round(r.ms), body: r.body, cfRay: r.headers.get('cf-ray'), server: r.headers.get('server'), limit: r.limit });
  }
  log('time', { cold_ms: round(times[0]), warm_ms: times.slice(1).map(round), offset_ms: offsets.map(round), offset_median_ms: round(pct(offsets, 50)) });

  const m = await get('/markets', { raw: true });
  keep('markets.json', m.text);
  const markets = m.body;
  const count = (f) => markets.reduce((acc, x) => ((acc[f(x)] = (acc[f(x)] ?? 0) + 1), acc), {});
  log('markets', {
    status: m.status, ms: round(m.ms), bytes: m.bytes, rows: markets.length, limit: m.limit,
    byStatus: count((x) => x.status), byQuote: count((x) => x.quote), byFeeCategory: count((x) => x.feeCategory),
    notTrading: markets.filter((x) => x.status !== 'trading').map((x) => x.market),
    feeCategoryNotA: markets.filter((x) => x.feeCategory !== 'A').map((x) => `${x.market}:${x.feeCategory}`),
    keys: Object.keys(markets[0]),
    sample: markets.find((x) => x.market === 'BTC-EUR'),
  });

  const ex = new ccxt.bitvavo();
  const t0 = performance.now();
  await ex.loadMarkets();
  const all = Object.values(ex.markets);
  const rawIds = new Set(markets.map((x) => x.market));
  const btc = ex.markets['BTC/EUR'];
  log('ccxt', {
    version: ccxt.version, ms: round(performance.now() - t0), markets: all.length,
    byType: all.reduce((a, x) => ((a[x.type] = (a[x.type] ?? 0) + 1), a), {}),
    swaps: all.filter((x) => x.swap).length, active: all.filter((x) => x.active).length,
    idsMatchRaw: all.filter((x) => rawIds.has(x.id)).length,
    idsWithDash: all.filter((x) => x.id === `${x.baseId}-${x.quoteId}`).length,
    symbolsDiffer: all.filter((x) => x.base !== x.baseId || x.quote !== x.quoteId).map((x) => `${x.id}=>${x.symbol}`),
    takers: [...new Set(all.map((x) => x.taker))], makers: [...new Set(all.map((x) => x.maker))],
    btc: { id: btc.id, symbol: btc.symbol, taker: btc.taker, maker: btc.maker, contractSize: btc.contractSize, linear: btc.linear, active: btc.active, spot: btc.spot, precision: btc.precision },
    feesTrading: { taker: ex.fees.trading.taker, maker: ex.fees.trading.maker, tier0: [ex.fees.trading.tiers.taker[0], ex.fees.trading.tiers.maker[0]] },
  });

  const tb = await get('/ticker/book', { raw: true });
  keep('ticker_book.json', tb.text);
  const rows = tb.body;
  log('ticker_book', {
    status: tb.status, ms: round(tb.ms), bytes: tb.bytes, rows: rows.length, limit: tb.limit,
    keys: Object.keys(rows[0]),
    emptyBid: rows.filter((r) => !r.bid).map((r) => r.market), emptyAsk: rows.filter((r) => !r.ask).map((r) => r.market),
    missingFromMarkets: rows.filter((r) => !rawIds.has(r.market)).map((r) => r.market),
    marketsMissing: markets.filter((x) => !rows.some((r) => r.market === x.market)).map((x) => x.market),
    btc: rows.find((r) => r.market === 'BTC-EUR'),
  });

  for (const [market, q] of [['BTC-EUR', ''], ['BTC-EUR', '?depth=1000'], ['ETH-EUR', '?depth=25']]) {
    const r = await get(`/${market}/book${q}`, { raw: true });
    const b = r.body;
    const desc = b.bids.every((l, i) => i === 0 || Number(l[0]) < Number(b.bids[i - 1][0]));
    const asc = b.asks.every((l, i) => i === 0 || Number(l[0]) > Number(b.asks[i - 1][0]));
    log('book', {
      market, q, status: r.status, ms: round(r.ms), bytes: r.bytes, keys: Object.keys(b), nonce: b.nonce, timestamp: b.timestamp,
      bids: b.bids.length, asks: b.asks.length, bidsDescending: desc, asksAscending: asc,
      levelWidth: [...new Set([...b.bids, ...b.asks].map((l) => l.length))], top: [b.bids[0], b.asks[0]],
      cache: { cfCache: r.headers.get('cf-cache-status'), age: r.headers.get('age'), cacheControl: r.headers.get('cache-control') },
    });
    if (market === 'BTC-EUR' && q === '') keep('book_btc.json', r.text);
  }

  // Two book reads back to back show whether the reply is cached at the edge.
  const a = await get('/BTC-EUR/book?depth=1');
  const b = await get('/BTC-EUR/book?depth=1');
  log('book_back_to_back', { nonces: [a.body.nonce, b.body.nonce], ms: [round(a.ms), round(b.ms)] });

  const rep = await get('/report/BTC-EUR/book');
  log('report_book', { status: rep.status, ms: round(rep.ms), bytes: rep.bytes, keys: typeof rep.body === 'object' ? Object.keys(rep.body) : rep.body, bids: rep.body?.bids?.length, bidSample: rep.body?.bids?.[0] });

  for (const path of ['/NOPE-EUR/book', '/BTC-EUR/book?depth=0', '/BTC-EUR/book?depth=1001', '/btc-eur/book?depth=1', '/WMTX-EUR/book?depth=5', '/markets?market=NOPE-EUR', '/ticker/book?market=NOPE-EUR', '/nope']) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, body: r.body, limit: r.limit });
  }

  const assets = await get('/assets');
  log('assets', { status: assets.status, rows: assets.body.length, bytes: assets.bytes });

  const cg = await get('https://api.coingecko.com/api/v3/exchanges/bitvavo');
  log('coingecko_exchange', {
    status: cg.status, name: cg.body.name, country: cg.body.country, year: cg.body.year_established,
    trust_score: cg.body.trust_score, trust_score_rank: cg.body.trust_score_rank,
    btc_volume_24h: cg.body.trade_volume_24h_btc, tickers: cg.body.tickers?.length,
  });
  const cgd = await get('https://api.coingecko.com/api/v3/derivatives/exchanges/list');
  log('coingecko_derivatives', { status: cgd.status, venues: Array.isArray(cgd.body) ? cgd.body.length : null, bitvavo: Array.isArray(cgd.body) ? cgd.body.filter((x) => /bitvavo/i.test(x.id + x.name)) : cgd.body });

  const last = await get('/time');
  log('weight_after_main', { limit: last.limit });
}

async function poll() {
  const lat = [];
  const changes = { 'BTC-EUR': 0, 'ETH-EUR': 0, 'FUN-EUR': 0 };
  const prev = {};
  let rowsChanged = [];
  let before;
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const r = await get('/ticker/book');
    lat.push(r.ms);
    const map = new Map(r.body.map((x) => [x.market, `${x.bid}|${x.ask}|${x.bidSize}|${x.askSize}`]));
    if (before) rowsChanged.push([...map].filter(([k, v]) => before.get(k) !== v).length);
    before = map;
    for (const k of Object.keys(changes)) {
      const px = map.get(k)?.split('|').slice(0, 2).join('|');
      if (prev[k] !== undefined && prev[k] !== px) changes[k]++;
      prev[k] = px;
    }
    if (i === 59) log('poll_last_limit', { limit: r.limit });
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  log('poll', {
    polls: lat.length, min_ms: round(Math.min(...lat)), median_ms: round(pct(lat, 50)), p90_ms: round(pct(lat, 90)), max_ms: round(Math.max(...lat)),
    over1s: lat.filter((x) => x > 1000).length, touchChangesIn59: changes,
    rowsChangedPerPoll: { min: Math.min(...rowsChanged), median: pct(rowsChanged, 50), max: Math.max(...rowsChanged) },
  });
}

const mode = process.argv[2] ?? 'main';
const t = Date.now();
log('start', { mode, utc: new Date().toISOString() });
await ({ main, poll })[mode]();
log('end', { mode, seconds: Math.round((Date.now() - t) / 1000) });
