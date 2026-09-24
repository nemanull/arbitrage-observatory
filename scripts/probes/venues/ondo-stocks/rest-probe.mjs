// Ondo Stocks REST probe: DNS, what every documented GET endpoint of the GM Backend API returns without an API key, request timing, the Date header offset, the public web pages, the CCXT catalog check and the CoinGecko listing.
// Public, unauthenticated, read-only. It sends no x-api-key header and makes about thirty requests in total, spaced at least 250 ms apart.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/ondo-stocks/rest-probe.mjs
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/ondo-stocks/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.gm.ondo.finance';
const GECKO = 'https://api.coingecko.com/api/v3/exchanges/ondo_global_markets';
const GECKO_PERPS = 'https://api.coingecko.com/api/v3/derivatives/exchanges/ondo-perps'; // a separate CoinGecko entry, checked for the coverage matrix only
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

// Every GET path of https://docs.ondo.finance/openapi.json, with a real symbol where the path takes one.
const GET_PATHS = [
  '/v1/tickers',
  '/v1/assets/all/prices/latest',
  '/v1/assets/all/prices/latest/enhanced',
  '/v1/assets/all/market',
  '/v1/assets/all/metadata',
  '/v1/assets/all/addresses',
  '/v1/assets/TSLAon/prices/latest',
  '/v1/assets/TSLAon/prices/ohlc',
  '/v1/assets/TSLAon/market',
  '/v1/assets/TSLAon/dividends',
  '/v1/assets/TSLAon/addresses',
  '/v1/assets/TSLAon/shares-multiplier',
  '/v1/status/market',
  '/v1/status/assets',
  '/v1/limits/session',
  '/v1/limits/trading',
  '/v1/chains/ethereum-1/balances',
];

// Paths the spec does not define, to see whether the gateway answers them differently.
const UNDEFINED_PATHS = ['/', '/v1/nope', '/v1/time'];

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function timedGet(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const ttfb = performance.now() - t0;
  const body = await res.text();
  const total = performance.now() - t0;
  return {
    status: res.status,
    ms: Math.round(total),
    ttfbMs: Math.round(ttfb),
    bytes: body.length,
    errorType: res.headers.get('x-amzn-errortype'),
    retryAfter: res.headers.get('retry-after'),
    wwwAuthenticate: res.headers.get('www-authenticate'),
    date: res.headers.get('date'),
    via: res.headers.get('via'),
    cache: res.headers.get('x-cache'),
    body: body.slice(0, 200),
  };
}

async function probeDns() {
  for (const host of ['api.gm.ondo.finance', 'grpc.gm.ondo.finance']) {
    const a = await dns.resolve4(host).catch((e) => [e.code]);
    const cname = await dns.resolveCname(host).catch(() => []);
    log('dns', { host, a, cname });
  }
}

function probeCcxt() {
  const hits = ccxt.exchanges.filter((id) => /ondo|stock|gm/i.test(id));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: hits });
}

async function probeEndpoints() {
  for (const path of [...GET_PATHS, ...UNDEFINED_PATHS]) {
    const r = await timedGet(API + path);
    log('get', { path, ...r });
    await sleep(250);
  }
}

// Cold then warm timing on one path, with the Date header offset against the local clock.
async function probeTiming() {
  const times = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await timedGet(API + '/v1/tickers');
    const after = Date.now();
    times.push(r.ms);
    // Date has one second resolution, so the offset is only good to about ±1 s.
    offsets.push(Date.parse(r.date) - (before + after) / 2);
    await sleep(1000);
  }
  const sorted = [...times].sort((a, b) => a - b);
  log('timing', {
    path: '/v1/tickers',
    coldMs: times[0],
    warm: { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] },
    all: times,
    dateOffsetMs: { min: Math.min(...offsets), max: Math.max(...offsets) },
  });
}

// The public web pages, to show that this host is not refused at the network level.
async function probePages() {
  for (const url of ['https://status.ondo.finance/market', 'https://app.ondo.finance/', 'https://docs.ondo.finance/openapi.json']) {
    const r = await timedGet(url);
    log('page', { url, status: r.status, bytes: r.bytes, ms: r.ms });
    await sleep(250);
  }
}

async function probeGecko() {
  const res = await fetch(GECKO);
  const text = await res.text();
  keep('coingecko-ondo_global_markets.json', text);
  if (res.status !== 200) {
    log('coingecko', { status: res.status, body: text.slice(0, 200) });
    return;
  }
  const ex = JSON.parse(text);
  const tickers = ex.tickers ?? [];
  const targets = {};
  for (const t of tickers) targets[t.target] = (targets[t.target] ?? 0) + 1;
  const spreads = tickers.map((t) => t.bid_ask_spread_percentage).filter((x) => x != null).sort((a, b) => a - b);
  log('coingecko', {
    status: res.status,
    name: ex.name,
    centralized: ex.centralized,
    country: ex.country,
    trustScore: ex.trust_score,
    trustScoreRank: ex.trust_score_rank,
    coins: ex.coins,
    pairs: ex.pairs,
    volume24hBtc: ex.trade_volume_24h_btc,
    tickersReturned: tickers.length,
    targets,
    spreadPct: { min: spreads[0], median: spreads[Math.floor(spreads.length / 2)], max: spreads[spreads.length - 1] },
    sample: tickers.slice(0, 3).map((t) => ({ base: t.base, target: t.target, last: t.last, tradeUrl: t.trade_url, lastTradedAt: t.last_traded_at })),
  });
}

async function probeGeckoPerps() {
  await sleep(3000);
  const res = await fetch(GECKO_PERPS);
  const text = await res.text();
  if (res.status !== 200) {
    log('coingecko_perps', { status: res.status, body: text.slice(0, 200) });
    return;
  }
  const ex = JSON.parse(text);
  log('coingecko_perps', {
    status: res.status,
    name: ex.name,
    country: ex.country,
    url: ex.url,
    yearEstablished: ex.year_established,
    perpetualPairs: ex.number_of_perpetual_pairs,
    futuresPairs: ex.number_of_futures_pairs,
    openInterestBtc: ex.open_interest_btc,
    volume24hBtc: ex.trade_volume_24h_btc,
  });
}

log('start', { at: new Date().toISOString() });
await probeDns();
probeCcxt();
await probeEndpoints();
await probeTiming();
await probePages();
await probeGecko();
await probeGeckoPerps();
log('end', { at: new Date().toISOString() });
