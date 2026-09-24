// Dinari REST probe: DNS, what the documented Enterprise API returns without keys, the web app's own market data routes, one second polls of a quote and a price, the Date header offset and the CCXT catalog check.
// Public, unauthenticated, read-only. It sends no X-API-Key-Id or X-API-Secret-Key header, only GET requests plus one batch read POST that the web app itself sends, spaced at least 250 ms apart.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/dinari/rest-probe.mjs [api|app|poll|ccxt|all]
//   api   every documented market data GET of the Enterprise API, live and sandbox, without keys, plus the Date header offset. About 20 requests.
//   app   the web app routes under https://app.dinari.com/api/: region, the stock catalog pages, one quote, one price and one batch quote. About 15 requests.
//   poll  quote and price of AAPL and TSLA through the web app routes once a second for 30 s. 120 requests.
//   ccxt  whether CCXT 4.5.68 lists a dinari class.
//   all   api, app and ccxt (the default).
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/dinari/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const LIVE = 'https://api-enterprise.sbt.dinari.com';
const SANDBOX = 'https://api-enterprise.sandbox.dinari.com';
const APP = 'https://app.dinari.com/api';
const AAPL = '0196ea6d-b6de-70d5-ae41-9525959ef309'; // stock id of AAPL, from the app catalog
const OUT = process.env.PROBE_OUT_DIR;
const HEADERS = ['content-type', 'cache-control', 'cf-cache-status', 'age', 'retry-after', 'www-authenticate', 'apigw-requestid', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'server', 'cf-ray', 'date'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function call(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) } });
  const body = await res.text();
  const ms = Math.round(performance.now() - t0);
  const headers = Object.fromEntries(HEADERS.filter((h) => res.headers.has(h)).map((h) => [h, res.headers.get(h)]));
  return { status: res.status, ms, bytes: body.length, headers, body, received: Date.now() };
}

async function resolve(host) {
  try {
    const a = await dns.resolve4(host);
    let cname = null;
    try { cname = await dns.resolveCname(host); } catch { /* no CNAME */ }
    return { a, cname };
  } catch (e) {
    return { error: e.code };
  }
}

async function api() {
  for (const host of ['api-enterprise.sbt.dinari.com', 'api-enterprise.sandbox.dinari.com', 'app.dinari.com', 'ws.api.dinari.com', 'ws.api.sandbox.dinari.com', 'api.dinari.com']) {
    log('dns', { host, ...(await resolve(host)) });
  }
  const paths = [
    '/api/v2/market_data/stocks/',
    '/api/v2/market_data/stocks/?page_size=5',
    `/api/v2/market_data/stocks/${AAPL}/current_price`,
    `/api/v2/market_data/stocks/${AAPL}/current_quote`,
    '/api/v2/market_data/market_hours/',
    '/api/v2/market_data/alloys/',
    '/api/v2/nope',
    '/',
  ];
  for (const base of [LIVE, SANDBOX]) {
    for (const p of paths) {
      const r = await call(base + p);
      log('api', { base, path: p, status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers, body: r.body.slice(0, 160) });
      await sleep(250);
    }
  }
  // Date header offset against the local clock, midpoint of five warm requests.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await call(LIVE + '/api/v2/market_data/stocks/');
    const mid = (t0 + r.received) / 2;
    offsets.push({ ms: r.ms, offsetMs: Date.parse(r.headers.date) - mid });
    await sleep(300);
  }
  log('clock', { host: 'api-enterprise.sbt.dinari.com', note: 'Date header has 1 s resolution', offsets });
}

async function app() {
  const region = await call(`${APP}/region`);
  log('app_region', { status: region.status, ms: region.ms, body: region.body });
  await sleep(250);

  // Catalog, paginated until a short page.
  const rows = [];
  const pageSize = 100;
  for (let page = 1; page <= 15; page++) {
    const r = await call(`${APP}/dinari/market/stocks?page=${page}&page_size=${pageSize}`);
    let list = [];
    try { list = JSON.parse(r.body); } catch { /* not JSON */ }
    log('app_stocks_page', { page, status: r.status, ms: r.ms, bytes: r.bytes, rows: Array.isArray(list) ? list.length : null, headers: r.headers });
    if (!Array.isArray(list)) break;
    rows.push(...list);
    if (list.length < pageSize) break;
    await sleep(300);
  }
  keep('app-stocks.json', JSON.stringify(rows));
  const chains = {};
  for (const s of rows) for (const t of s.tokens ?? []) { const c = t.split(':').slice(0, 2).join(':'); chains[c] = (chains[c] ?? 0) + 1; }
  const ids = new Set(rows.map((s) => s.id));
  const syms = rows.map((s) => s.symbol);
  const dupSyms = syms.filter((s, i) => syms.indexOf(s) !== i);
  log('app_catalog', {
    rows: rows.length,
    uniqueIds: ids.size,
    duplicateSymbols: dupSyms,
    tradable: rows.filter((s) => s.is_tradable).length,
    fractionable: rows.filter((s) => s.is_fractionable).length,
    fields: rows[0] ? Object.keys(rows[0]) : [],
    tokenChains: chains,
    sample: syms.slice(0, 12),
  });

  const tsla = rows.find((s) => s.symbol === 'TSLA')?.id;
  for (const [name, path] of [['quote', `stocks/${AAPL}/quote`], ['price', `stocks/${AAPL}/price`], ['quote_cold_tsla', `stocks/${tsla}/quote`], ['stock', `stocks/${AAPL}`], ['nope_quote', 'stocks/00000000-0000-0000-0000-000000000000/quote']]) {
    const r = await call(`${APP}/dinari/market/${path}`);
    log('app_' + name, { status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers, body: r.body.slice(0, 400) });
    keep(`app-${name}.json`, r.body);
    await sleep(300);
  }
  const five = rows.slice(0, 5).map((s) => s.id);
  const b = await call(`${APP}/dinari/market/stocks/quotes/batch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stockIds: five }) });
  log('app_batch_quotes', { status: b.status, ms: b.ms, bytes: b.bytes, headers: b.headers, body: b.body.slice(0, 500) });
  await sleep(300);
  const bp = await call(`${APP}/dinari/market/stocks/prices/batch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stockIds: five }) });
  log('app_batch_prices', { status: bp.status, ms: bp.ms, bytes: bp.bytes, headers: bp.headers, body: bp.body.slice(0, 500) });
}

async function poll() {
  const cat = await call(`${APP}/dinari/market/stocks?page=1&page_size=100`);
  const tsla = JSON.parse(cat.body).find((s) => s.symbol === 'TSLA')?.id;
  const targets = [['AAPL', AAPL], ['TSLA', tsla]];
  const seen = {};
  const times = [];
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    for (const [sym, id] of targets) {
      for (const kind of ['quote', 'price']) {
        const r = await call(`${APP}/dinari/market/stocks/${id}/${kind}`);
        times.push(r.ms);
        let j = {};
        try { j = JSON.parse(r.body); } catch { /* not JSON */ }
        const key = `${sym}_${kind}`;
        const val = kind === 'quote' ? `${j.bid_price}x${j.bid_size}/${j.ask_price}x${j.ask_size}` : `${j.price}`;
        const s = (seen[key] ??= { values: [], stamps: [], statuses: {}, cache: {}, ageMs: [] });
        if (s.values.at(-1) !== val) s.values.push(val);
        if (s.stamps.at(-1) !== j.timestamp) s.stamps.push(j.timestamp);
        s.statuses[r.status] = (s.statuses[r.status] ?? 0) + 1;
        const cs = `${r.headers['cf-cache-status'] ?? '-'}|${r.headers['cache-control'] ?? '-'}`;
        s.cache[cs] = (s.cache[cs] ?? 0) + 1;
        if (j.timestamp) s.ageMs.push(r.received - Date.parse(j.timestamp));
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  times.sort((a, b) => a - b);
  log('poll_times', { n: times.length, min: times[0], median: times[times.length >> 1], p90: times[Math.floor(times.length * 0.9)], max: times.at(-1) });
  for (const [key, s] of Object.entries(seen)) {
    s.ageMs.sort((a, b) => a - b);
    log('poll', { key, distinctValues: s.values.length, firstValues: s.values.slice(0, 4), distinctStamps: s.stamps.length, firstStamps: s.stamps.slice(0, 3), statuses: s.statuses, cache: s.cache, stampAgeMs: { min: s.ageMs[0], median: s.ageMs[s.ageMs.length >> 1], max: s.ageMs.at(-1) } });
  }
}

function ccxtCheck() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, dinari: ccxt.exchanges.filter((x) => /dinari|dshare/i.test(x)) });
}

const mode = process.argv[2] ?? 'all';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'api' || mode === 'all') await api();
if (mode === 'app' || mode === 'all') await app();
if (mode === 'poll') await poll();
if (mode === 'ccxt' || mode === 'all') ccxtCheck();
log('end', { at: new Date().toISOString() });
