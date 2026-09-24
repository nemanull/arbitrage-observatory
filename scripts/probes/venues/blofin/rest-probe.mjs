// BloFin REST probe: what the public REST API and the web pages return to this host, and how CCXT 4.5.68 maps BloFin markets.
// Public, unauthenticated and read-only.
// Every mode sends fewer than 40 requests, far inside the documented 500 requests per minute per IP.
// Run from server/: node ../scripts/probes/venues/blofin/rest-probe.mjs [access|ccxt]
//   access  DNS, then every public market data path on the live and demo REST hosts, the docs, fee and home pages, each read twice for cold and warm time, about 15 s
//   ccxt    CCXT 4.5.68 loadMarkets and fetchFundingRates against the live host, then parseMarket on the documented instruments row offline, about 5 s
// A refusal prints its status, the Cloudflare colo from cf-ray, server-timing, and whether the body is the restricted region page.
// Set PROBE_OUT_DIR to keep the first refusal body.
// Recorded in docs/profiles/blofin/rest.md, fees.md and websocket.md.
import { createRequire } from 'node:module';
import { resolve4 } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const LIVE = 'https://openapi.blofin.com';
const DEMO = 'https://demo-trading-openapi.blofin.com';
const PATHS = [
  '/api/v1/market/instruments',
  '/api/v1/market/tickers',
  '/api/v1/market/mark-price',
  '/api/v1/market/funding-rate',
  '/api/v1/market/funding-rate-history?instId=BTC-USDT&limit=10',
  '/api/v1/market/books?instId=BTC-USDT&size=100',
  '/api/v1/market/trades?instId=BTC-USDT&limit=5',
];
const PAGES = ['https://docs.blofin.com/index.html', 'https://blofin.com/en/fees', 'https://www.blofin.com/', 'https://blofin.com/docs'];
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The instruments row exactly as the API reference prints it, used to show CCXT's mapping without the network.
const DOC_INSTRUMENT = {
  instId: 'BTC-USDT', baseCurrency: 'BTC', quoteCurrency: 'USDT', contractValue: '0.001', listTime: '1638333031000',
  expireTime: '1704124800000', maxLeverage: '125', minSize: '0.1', lotSize: '0.1', tickSize: '0.5', instType: 'SWAP',
  contractType: 'linear', maxLimitSize: '100000000', maxMarketSize: '1000000', state: 'live', settleCurrency: 'USDT',
};

let savedBody = false;

async function get(url) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { redirect: 'manual' });
    const text = await r.text();
    const ms = Math.round(performance.now() - t0);
    const ray = r.headers.get('cf-ray') ?? '';
    if (OUT && !savedBody && r.status === 403) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, 'refusal-body.html'), text);
      savedBody = true;
    }
    return {
      status: r.status,
      ms,
      bytes: text.length,
      type: r.headers.get('content-type'),
      colo: ray.split('-')[1] ?? null,
      serverTiming: r.headers.get('server-timing'),
      retryAfter: r.headers.get('retry-after'),
      location: r.headers.get('location'),
      restricted: /restricted\s+countries\s+or\s+regions/.test(text),
      json: text.startsWith('{') ? text.slice(0, 200) : undefined,
    };
  } catch (e) {
    return { error: e.cause?.code ?? e.message, ms: Math.round(performance.now() - t0) };
  }
}

async function access() {
  for (const host of ['openapi.blofin.com', 'demo-trading-openapi.blofin.com', 'docs.blofin.com', 'blofin.com']) {
    try {
      log('dns', { host, a: await resolve4(host) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }
  for (const base of [LIVE, DEMO]) {
    for (const path of PATHS) {
      const cold = await get(base + path);
      await sleep(300);
      const warm = await get(base + path);
      log('rest', { url: base + path, cold, warmMs: warm.ms, warmStatus: warm.status });
      await sleep(300);
    }
  }
  for (const url of PAGES) {
    log('page', { url, ...(await get(url)) });
    await sleep(300);
  }
}

async function ccxtMode() {
  const ex = new ccxt.blofin({ enableRateLimit: true });
  log('ccxt', { version: ccxt.version, fees: ex.fees, restUrl: ex.urls.api.rest });
  for (const [name, call] of [['loadMarkets', () => ex.loadMarkets()], ['fetchFundingRates', () => ex.fetchFundingRates()]]) {
    const t0 = performance.now();
    try {
      const r = await call();
      log('ccxt_call', { name, ok: true, n: Object.keys(r).length, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      log('ccxt_call', { name, ok: false, error: e.constructor.name, message: String(e.message).slice(0, 160), ms: Math.round(performance.now() - t0) });
    }
  }
  const offline = new ccxt.blofin();
  for (const row of [DOC_INSTRUMENT, { ...DOC_INSTRUMENT, instId: 'BTC-USD', quoteCurrency: 'USD', contractValue: '100', contractType: 'inverse', settleCurrency: 'BTC' }]) {
    const m = offline.parseMarket(row);
    log('parse_market', {
      input: `${row.instId} ${row.contractType} settle ${row.settleCurrency}`,
      id: m.id, symbol: m.symbol, settle: m.settle, linear: m.linear, inverse: m.inverse,
      contractSize: m.contractSize, active: m.active, taker: m.taker, maker: m.maker,
    });
  }
}

const mode = process.argv[2] ?? 'access';
if (mode === 'access') await access();
else if (mode === 'ccxt') await ccxtMode();
else console.error('mode is access or ccxt');
