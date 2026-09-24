// INEX public REST probe: CCXT class check, CoinGecko listing, host and latency, what the documented Open API returns without a token, and the website's own catalog and bulk ticker.
// Public, unauthenticated, read-only. No account, no key, no JWT, no order.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/inex/rest-probe.mjs [context|official|web|poll|all]
//   context   CCXT 4.5.68 exchange list, CoinGecko exchange and derivatives listing. About 3 s.
//   official  DNS, then every documented market data path of api.inexcoin.com three times, once cold and twice warm, with status, body and Date offset, then the docs, site and help center pages. About 17 s.
//   web       the website's /client-api/service calls: catalog (market-coins), bulk ticker (market/tickers), server time. About 3 s.
//   poll      market/tickers once a second for 60 s: reply time, and how often each pair's last price changes. About 62 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/inex/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.inexcoin.com';
const WEB = 'https://www.inexcoin.com/client-api/service';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

// The documented market data paths, from https://docs.inex.im/docs/symbol-all, tickers, tickers-symbol, orderbook-market and trades-ticks.
const OFFICIAL_PATHS = [
  '/v1/symbol/all',
  '/v1/tickers',
  '/v1/tickers/BTC-USDT',
  '/v1/orderbook/BTC-USDT',
  '/v1/trades/ticks?market=BTC-USDT&count=5',
  '/v1/market/ticker?symbol=btcusdt', // the example on www.inexcoin.com/open-api
  '/v1/nope', // an undefined path, to see whether the token check runs before routing
];

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// One GET with its own agent, so the caller decides whether the connection is reused.
function get(url, agent, headers = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = https.get(url, { agent, headers: { 'user-agent': 'inex-probe/1', ...headers } }, (res) => {
      const chunks = [];
      let ttfb;
      res.once('data', () => { ttfb = performance.now() - t0; });
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, ms: Math.round(performance.now() - t0), ttfbMs: Math.round(ttfb ?? 0), ip: res.socket?.remoteAddress, doneAt: Date.now() });
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Math.round(performance.now() - t0) }));
  });
}

// Offset of the server Date header from the local clock, at one second resolution.
function dateOffsetMs(r) {
  if (!r.headers?.date) return null;
  return new Date(r.headers.date).getTime() - r.doneAt;
}

async function context() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, nameMatches: ccxt.exchanges.filter((x) => /inex|infinity/i.test(x)) });

  const cg = await get('https://api.coingecko.com/api/v3/exchanges/inex');
  keep('coingecko-exchange.json', cg.body);
  if (cg.status === 200) {
    const j = JSON.parse(cg.body);
    log('coingecko', { status: cg.status, name: j.name, country: j.country, year: j.year_established, url: j.url, trustScore: j.trust_score, trustRank: j.trust_score_rank, coins: j.coins, pairs: j.pairs, volume24hBtc: j.trade_volume_24h_btc, targets: [...new Set(j.tickers.map((t) => t.target))], tickerCount: j.tickers.length, volume24hUsd: Math.round(j.tickers.reduce((s, t) => s + (t.converted_volume?.usd ?? 0), 0)), spreadPct: j.tickers.map((t) => `${t.base}:${t.bid_ask_spread_percentage?.toFixed(2)}`).join(' ') });
  } else {
    log('coingecko', { status: cg.status, body: cg.body.slice(0, 200) });
  }

  await sleep(1500);
  const der = await get('https://api.coingecko.com/api/v3/derivatives/exchanges/list');
  if (der.status === 200) {
    const list = JSON.parse(der.body);
    log('coingeckoDerivatives', { status: der.status, count: list.length, inexMatches: list.filter((x) => /inex/i.test(x.id + ' ' + x.name)) });
  } else {
    log('coingeckoDerivatives', { status: der.status, body: der.body.slice(0, 200) });
  }
}

async function official() {
  for (const host of ['api.inexcoin.com', 'www.inexcoin.com', 'socket.inexcoin.com', 'docs.inex.im', 'support.inexcoin.com']) {
    try {
      const addrs = await lookup(host, { all: true });
      log('dns', { host, addrs: addrs.map((a) => a.address) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const warm = new https.Agent({ keepAlive: true, maxSockets: 1 });
  for (const path of OFFICIAL_PATHS) {
    const cold = await get(API + path, new https.Agent({ keepAlive: false }));
    await sleep(300);
    const w1 = await get(API + path, warm);
    await sleep(300);
    const w2 = await get(API + path, warm);
    keep(`official${path.replace(/[/?&=]/g, '_')}.txt`, `${cold.status}\n${JSON.stringify(cold.headers)}\n${cold.body}`);
    log('official', { path, status: [cold.status, w1.status, w2.status], coldMs: cold.ms, warmMs: [w1.ms, w2.ms], ip: cold.ip, contentType: cold.headers?.['content-type'], retryAfter: cold.headers?.['retry-after'] ?? null, body: cold.body.slice(0, 160), offsetMs: dateOffsetMs(w2) });
    await sleep(300);
  }

  // A documented public call with an empty bearer, to see whether the refusal changes name.
  const empty = await get(API + '/v1/symbol/all', warm, { authorization: 'Bearer' });
  log('officialEmptyBearer', { status: empty.status, body: empty.body.slice(0, 160) });
  warm.destroy();

  for (const url of ['https://docs.inex.im/docs/symbol-all', 'https://www.inexcoin.com/en/open-api', 'https://support.inexcoin.com/api/v2/help_center/ko/articles/25725101566745.json']) {
    const r = await get(url, new https.Agent({ keepAlive: false }));
    log('page', { url, status: r.status, bytes: r.body?.length, ms: r.ms, server: r.headers?.server ?? null, via: r.headers?.via ?? null, pop: r.headers?.['x-amz-cf-pop'] ?? null });
    await sleep(300);
  }
}

async function web() {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  const coins = await get(`${WEB}/market-coins`, agent);
  keep('web-market-coins.json', coins.body);
  const j = JSON.parse(coins.body);
  const markets = j.data.market.map((m) => ({ quote: m.name, pairs: Object.keys(m.pairs).length }));
  const pairs = j.data.market.flatMap((m) => Object.values(m.pairs));
  log('webCatalog', { status: coins.status, ms: coins.ms, bytes: coins.body.length, code: j.code, markets, isOpen: pairs.filter((p) => p.isOpen === 1).length, isShow: pairs.filter((p) => p.isShow === 1).length, leverOpen: pairs.filter((p) => p.is_open_lever !== 0).length, symbols: pairs.map((p) => p.symbol).join(','), priceDecimals: [...new Set(pairs.map((p) => p.price))], volumeDecimals: [...new Set(pairs.map((p) => p.volume))], depthSteps: [...new Set(pairs.map((p) => p.depth))], quoteFeeRate: [...new Set(pairs.map((p) => p.quoteFeeRate))], openQuoteFee: [...new Set(pairs.map((p) => p.openQuoteFee))], serverTime: j.data.serverTime });
  const btc = pairs.find((p) => p.symbol === 'btcusdt');
  log('webCatalogBtc', { btc });

  // serverTime is a Korea Standard Time wall clock string with milliseconds.
  const serverMs = new Date(j.data.serverTime.replace(' ', 'T') + '+09:00').getTime();
  log('webServerTime', { serverTime: j.data.serverTime, offsetFromMidpointMs: Math.round(serverMs - (coins.doneAt - coins.ms / 2)), offsetFromArrivalMs: serverMs - coins.doneAt, replyMs: coins.ms, dateHeaderOffsetMs: dateOffsetMs(coins) });

  await sleep(500);
  const t = await get(`${WEB}/market/tickers`, agent);
  keep('web-market-tickers.json', t.body);
  const tj = JSON.parse(t.body);
  log('webTickers', { status: t.status, ms: t.ms, bytes: t.body.length, code: tj.code, rows: tj.data.length, fields: Object.keys(tj.data[0]), btc: tj.data.find((r) => r.symbol === 'btcusdt'), pop: t.headers['x-amz-cf-pop'] ?? null, cache: t.headers['x-cache'] ?? null, cacheControl: t.headers['cache-control'] ?? null });

  await sleep(500);
  const c2 = await get(`${WEB}/coins`, agent);
  log('webCoins', { status: c2.status, ms: c2.ms, bytes: c2.body.length, body: c2.body.slice(0, 160) });
  agent.destroy();
}

async function poll() {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  const times = [];
  const last = new Map();
  const changes = new Map();
  const statuses = {};
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    const r = await get(`${WEB}/market/tickers`, agent);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    times.push(r.ms);
    if (r.status === 200) {
      for (const row of JSON.parse(r.body).data) {
        const key = `${row.close}|${row.amount}`;
        if (last.has(row.symbol) && last.get(row.symbol) !== key) changes.set(row.symbol, (changes.get(row.symbol) ?? 0) + 1);
        last.set(row.symbol, key);
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  agent.destroy();
  const s = [...times].sort((a, b) => a - b);
  log('poll', { polls: times.length, statuses, minMs: s[0], medianMs: s[Math.floor(s.length / 2)], p90Ms: s[Math.floor(s.length * 0.9)], maxMs: s[s.length - 1], over1s: s.filter((x) => x > 1000).length });
  log('pollChanges', { changesIn59Intervals: Object.fromEntries([...last.keys()].map((k) => [k, changes.get(k) ?? 0])) });
}

const mode = process.argv[2] ?? 'all';
const t0 = Date.now();
log('start', { mode, at: new Date().toISOString() });
if (mode === 'context' || mode === 'all') await context();
if (mode === 'official' || mode === 'all') await official();
if (mode === 'web' || mode === 'all') await web();
if (mode === 'poll' || mode === 'all') await poll();
log('done', { seconds: Math.round((Date.now() - t0) / 1000) });
