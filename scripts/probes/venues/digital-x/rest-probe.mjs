// Digital X (formerly Korbit) public REST probe: latency and clock, the spot catalog, the bulk ticker, book snapshots, error shapes and rate limit headers.
// Public, unauthenticated, read-only. Every call stays far inside the published limit of 50 public requests per second per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/digital-x/rest-probe.mjs [latency|catalog|book|poll|all]
//   latency  DNS, 20 cold and 20 warm /v2/time calls, clock offset, and the former api.korbit.co.kr host. About 20 s.
//   catalog  /v2/currencyPairs and the bulk /v2/tickers counted and cross checked, tick size policy, market alerts, currencies, notices, and the CCXT 4.5.68 exchange list.
//   book     /v2/orderbook depth and parameters, level order, repeat reads for caching, grouping, error replies and headers. About 10 s.
//   poll     the bulk ticker once a second for 30 polls, reply time and how many rows changed.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/digital-x/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'api.digitalx.miraeasset.com';
const OLD_HOST = 'api.korbit.co.kr';
const API = `https://${HOST}`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const keepAlive = new https.Agent({ keepAlive: true, maxSockets: 1 });

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// One GET with its status, headers, body and time. agent false forces a new TCP and TLS connection.
function get(path, { host = HOST, agent = keepAlive } = {}) {
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const req = https.get({ host, path, agent, headers: { 'user-agent': 'arbitrage-observatory-probe' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, ms: +(performance.now() - t0).toFixed(1) }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (arr) => ({ min: Math.min(...arr), p50: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) });
const pickHeaders = (h) => Object.fromEntries(Object.entries(h).filter(([k]) => /^(cache-control|ratelimit|ratelimit-policy|retry-after|cf-cache-status|age|content-type|server)$/.test(k)));

async function latency() {
  for (const h of [HOST, OLD_HOST, 'ws-api.digitalx.miraeasset.com']) {
    const addrs = await lookup(h, { all: true });
    log('dns', { host: h, addrs: addrs.map((a) => a.address) });
  }
  const cold = [];
  for (let i = 0; i < 20; i++) {
    cold.push((await get('/v2/time', { agent: false })).ms);
    await sleep(100);
  }
  log('cold', { path: '/v2/time', ms: stats(cold) });
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    const r = await get('/v2/time');
    const t1 = Date.now();
    warm.push(r.ms);
    const server = JSON.parse(r.body).data.time;
    offsets.push(server - (t0 + t1) / 2);
    if (i === 0) log('timeReply', { status: r.status, body: r.body, headers: pickHeaders(r.headers) });
    await sleep(100);
  }
  log('warm', { path: '/v2/time', ms: stats(warm) });
  log('clock', { offsetMs: stats(offsets.map((o) => Math.round(o))), note: 'server minus local midpoint' });
  const old = await get('/v2/time', { host: OLD_HOST, agent: false });
  log('formerHost', { host: OLD_HOST, status: old.status, body: old.body.slice(0, 120), ms: old.ms });
}

async function catalog() {
  const p = await get('/v2/currencyPairs');
  save('currencyPairs.json', p.body);
  const pairs = JSON.parse(p.body).data;
  const byStatus = {};
  const byQuote = {};
  for (const x of pairs) {
    byStatus[x.status] = (byStatus[x.status] || 0) + 1;
    byQuote[x.quoteCurrency] = (byQuote[x.quoteCurrency] || 0) + 1;
  }
  const noMin = pairs.filter((x) => x.minOrderValue == null).length;
  log('currencyPairs', { status: p.status, bytes: p.body.length, ms: p.ms, count: pairs.length, byStatus, byQuote, noMinOrderValue: noMin, headers: pickHeaders(p.headers), sample: pairs.find((x) => x.symbol === 'btc_krw') });
  const symbolShape = pairs.filter((x) => x.symbol !== `${x.baseCurrency}_${x.quoteCurrency}`).length;
  log('symbolShape', { rowsWhereSymbolIsNotBase_Quote: symbolShape, anyUppercase: pairs.some((x) => x.symbol !== x.symbol.toLowerCase()), uniqueSymbols: new Set(pairs.map((x) => x.symbol)).size, uniqueBases: new Set(pairs.map((x) => x.baseCurrency)).size });

  const t = await get('/v2/tickers');
  save('tickers.json', t.body);
  const tickers = JSON.parse(t.body).data;
  const pairSet = new Set(pairs.map((x) => x.symbol));
  const launched = new Set(pairs.filter((x) => x.status === 'launched').map((x) => x.symbol));
  const zeroTouchLaunched = tickers.filter((x) => launched.has(x.symbol) && (Number(x.bestBidPrice) === 0 || Number(x.bestAskPrice) === 0)).map((x) => x.symbol);
  const zeroTouchStopped = tickers.filter((x) => !launched.has(x.symbol) && Number(x.bestBidPrice) === 0 && Number(x.bestAskPrice) === 0).length;
  const crossed = tickers.filter((x) => Number(x.bestBidPrice) > 0 && Number(x.bestAskPrice) > 0 && Number(x.bestBidPrice) >= Number(x.bestAskPrice)).map((x) => x.symbol);
  const quoteVolume = tickers.filter((x) => launched.has(x.symbol)).map((x) => Number(x.quoteVolume)).sort((a, b) => b - a);
  const total = quoteVolume.reduce((a, b) => a + b, 0);
  const top = tickers.filter((x) => launched.has(x.symbol)).sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, 5).map((x) => [x.symbol, Math.round(Number(x.quoteVolume) / 1e6)]);
  log('tickers', { status: t.status, bytes: t.body.length, ms: t.ms, rows: tickers.length, notInPairs: tickers.filter((x) => !pairSet.has(x.symbol)).length, pairsNotInTickers: pairs.filter((x) => !tickers.some((y) => y.symbol === x.symbol)).length, fields: Object.keys(tickers[0]), zeroTouchLaunched, zeroTouchStopped, crossed, headers: pickHeaders(t.headers) });
  log('volume', { launchedQuoteVolumeKrwMillions: Math.round(total / 1e6), top5KrwMillions: top, launchedWithZeroVolume: quoteVolume.filter((v) => v === 0).length, usdtKrw: tickers.find((x) => x.symbol === 'usdt_krw')?.close });

  const one = await get('/v2/tickers?symbol=btc_krw,eth_krw');
  log('tickersSubset', { status: one.status, rows: JSON.parse(one.body).data.length, bytes: one.body.length });

  const ts = await get('/v2/tickSizePolicy?symbol=btc_krw');
  log('tickSizePolicy', { status: ts.status, body: ts.body.slice(0, 500) });
  const al = await get('/v2/marketAlerts');
  const alerts = JSON.parse(al.body).data;
  log('marketAlerts', { status: al.status, rows: Array.isArray(alerts) ? alerts.length : null, sample: Array.isArray(alerts) ? alerts.slice(0, 2) : alerts });
  const cur = await get('/v2/currencies');
  save('currencies.json', cur.body);
  const curData = JSON.parse(cur.body).data;
  log('currencies', { status: cur.status, rows: curData.length, bytes: cur.body.length, fields: Object.keys(curData[0] || {}) });

  const n = await get('/v2/notices');
  const notices = JSON.parse(n.body).data;
  log('notices', { status: n.status, rows: notices.length, fields: Object.keys(notices[0] || {}), urlHost: notices[0] ? new URL(notices[0].url).host : null, newest: notices.map((x) => x.createdAt).sort((a, b) => b - a)[0] });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ccxt.exchanges.filter((x) => /korbit|digital|mirae/i.test(x)) });
}

function ordered(levels, desc) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (desc ? b >= a : b <= a) return false;
  }
  return true;
}

async function book() {
  const variants = ['/v2/orderbook?symbol=btc_krw', '/v2/orderbook?symbol=btc_krw&limit=5', '/v2/orderbook?symbol=btc_krw&limit=100', '/v2/orderbook?symbol=btc_krw&depth=100', '/v2/orderbook?symbol=usdt_krw', '/v2/orderbook?symbol=klay_krw'];
  for (const v of variants) {
    const r = await get(v);
    const d = JSON.parse(r.body).data;
    log('book', { path: v, status: r.status, ms: r.ms, bytes: r.body.length, bids: d?.bids?.length, asks: d?.asks?.length, bidsDesc: d ? ordered(d.bids, true) : null, asksAsc: d ? ordered(d.asks, false) : null, ageMs: d ? Date.now() - d.timestamp : null, amt: d?.bids?.[0]?.amt ?? null, headers: v.endsWith('btc_krw') ? pickHeaders(r.headers) : undefined });
    if (v.endsWith('btc_krw')) save('orderbook-btc_krw.json', r.body);
    await sleep(150);
  }
  const g = await get('/v2/orderbook?symbol=eth_krw&level=100000');
  const gd = JSON.parse(g.body).data;
  log('grouped', { status: g.status, bids: gd?.bids?.length, asks: gd?.asks?.length, firstBid: gd?.bids?.[0], firstAsk: gd?.asks?.[0] });
  const reads = [];
  for (let i = 0; i < 10; i++) {
    const r = await get('/v2/orderbook?symbol=btc_krw');
    const d = JSON.parse(r.body).data;
    reads.push({ ts: d.timestamp, bid: d.bids[0].price, ask: d.asks[0].price, ms: r.ms });
    await sleep(200);
  }
  log('repeatReads', { reads: reads.length, distinctTimestamps: new Set(reads.map((x) => x.ts)).size, ms: stats(reads.map((x) => x.ms)) });
  for (const path of ['/v2/orderbook', '/v2/orderbook?symbol=nope_krw', '/v2/orderbook?symbol=BTC_KRW', '/v2/orderbook?symbol=btc_krw&level=7', '/v2/nope', '/v2/tickers?symbol=nope_krw', '/v2/tradingFeePolicy']) {
    const r = await get(path);
    log('error', { path, status: r.status, body: r.body.slice(0, 200), headers: pickHeaders(r.headers) });
    await sleep(150);
  }
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push((await get('/v2/orderbook?symbol=btc_krw')).headers.ratelimit ?? null);
  const par = await Promise.all(Array.from({ length: 10 }, () => get('/v2/orderbook?symbol=eth_krw', { agent: false })));
  log('ratelimitHeaders', { fiveSequentialOnOneConnection: seq, tenConcurrentOnNewConnections: par.map((r) => r.headers.ratelimit ?? null), statuses: par.map((r) => r.status) });
}

async function poll() {
  let prev = null;
  const times = [];
  const bytes = [];
  const changed = [];
  const usdtChanges = { bid: 0, ask: 0, close: 0 };
  const btcChanges = { bid: 0, ask: 0, close: 0 };
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) {
    const start = Date.now();
    const r = await get('/v2/tickers');
    times.push(r.ms);
    bytes.push(r.body.length);
    const rows = Object.fromEntries(JSON.parse(r.body).data.map((x) => [x.symbol, x]));
    if (prev) {
      let n = 0;
      for (const [k, v] of Object.entries(rows)) {
        const p = prev[k];
        if (p && (p.bestBidPrice !== v.bestBidPrice || p.bestAskPrice !== v.bestAskPrice || p.close !== v.close)) n++;
      }
      changed.push(n);
      for (const [sym, c] of [['usdt_krw', usdtChanges], ['btc_krw', btcChanges]]) {
        if (prev[sym].bestBidPrice !== rows[sym].bestBidPrice) c.bid++;
        if (prev[sym].bestAskPrice !== rows[sym].bestAskPrice) c.ask++;
        if (prev[sym].close !== rows[sym].close) c.close++;
      }
    }
    prev = rows;
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  log('poll', { polls: 30, wallMs: Date.now() - t0, ms: stats(times), bytes: stats(bytes), rowsChangedPerPoll: stats(changed), usdtKrwChangesIn29: usdtChanges, btcKrwChangesIn29: btcChanges });
}

const mode = process.argv[2] || 'all';
const modes = { latency, catalog, book, poll };
log('start', { mode, utc: new Date().toISOString() });
if (mode === 'all') {
  for (const m of Object.values(modes)) await m();
} else if (modes[mode]) {
  await modes[mode]();
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('end', { mode, utc: new Date().toISOString() });
keepAlive.destroy();
