// CoinZoom spot REST probe: catalog, symbol spellings, latency, the order book call and its variants, caching, error shapes and clock offset.
// Public, unauthenticated, read-only. The venue caps the REST API at 120 requests per minute and the instruments call at 12, so every mode waits at least 1.5 s between requests.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coinzoom/rest-probe.mjs [catalog|latency|book|errors|time]
//   catalog  instruments, ticker, currencies and assets, their symbol spellings, and whether CCXT 4.5.68 lists the venue. About 10 s.
//   latency  DNS, one cold request, ten warm ticker requests 2 s apart, and the Cloudflare edge and country. About 25 s.
//   book     the order book call at every documented depth and level, level order, and five repeats for caching. About 25 s.
//   errors   no User-Agent, unknown and misspelled pairs, an odd depth, an unknown level, unknown paths, and the summary by GET and by the documented POST, with its pairs that lack a side. About 25 s.
//   time     five order book reads comparing the reply timestamp and Date header with the local clock. About 10 s.
// Recorded in docs/profiles/coinzoom/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'api.coinzoom.com';
const BASE = `https://${HOST}/api/v1/public`;
const UA = 'Mozilla/5.0 arbitrage-observatory-probe'; // the API rejects a request without a User-Agent
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const PACE_MS = 1_500;

async function get(path, init = {}) {
  const t0 = performance.now();
  const sent = Date.now();
  const res = await fetch(BASE + path, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
  const text = await res.text();
  const ms = +(performance.now() - t0).toFixed(1);
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  const h = (k) => res.headers.get(k);
  return { status: res.status, ms, sent, arrived: Date.now(), bytes: text.length, body, text, headers: { date: h('date'), ray: h('cf-ray'), cache: h('cf-cache-status'), cacheControl: h('cache-control'), age: h('age'), retryAfter: h('retry-after'), contentType: h('content-type'), rateLimit: [...res.headers.keys()].filter((k) => /rate|limit|remaining/i.test(k)) } };
}

// A request with no User-Agent header at all, which fetch cannot send.
function getNoUa(path) {
  return new Promise((resolve) => {
    const req = https.request({ host: HOST, path: `/api/v1/public${path}`, method: 'GET', headers: {} }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, bytes: data.length, text: data.slice(0, 300), server: res.headers.server, ray: res.headers['cf-ray'] }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

const countBy = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const isSorted = (arr, desc) => arr.every((x, i) => i === 0 || (desc ? arr[i - 1][0] >= x[0] : arr[i - 1][0] <= x[0]));
const repeatedPrices = (arr) => arr.length - new Set(arr.map((x) => x[0])).size; // above 0 only on the level 3 book, one row per order
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function catalog() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ccxt.exchanges.filter((x) => /zoom/i.test(x)) });
  const ins = await get('/instruments');
  const I = ins.body;
  log('instruments', { status: ins.status, ms: ins.ms, bytes: ins.bytes, count: I.length, fields: Object.keys(I[0]), instrumentType: countBy(I, (x) => x.instrumentType), term: countBy(I, (x) => x.termCurrencyCode), supportsLeverage: I.filter((x) => x.supportsLeverage).map((x) => `${x.symbol} maxLeverage ${x.maxLeverage}`), issueOnly: countBy(I, (x) => x.issueOnly), symbolSample: I.slice(0, 3).map((x) => x.symbol) });
  const bases = countBy(I, (x) => x.baseCurrencyCode);
  log('pairs_per_base', { twoQuotes: Object.keys(bases).filter((b) => bases[b] > 1).length, bases: Object.keys(bases).length });
  await sleep(PACE_MS);
  const t = await get('/marketwatch/ticker');
  const T = t.body;
  const keys = Object.keys(T);
  const insSet = new Set(I.map((x) => x.symbol.replace('/', '_')));
  const active = keys.filter((k) => T[k].base_volume > 0);
  log('ticker', { status: t.status, ms: t.ms, bytes: t.bytes, count: keys.length, fields: Object.keys(T[keys[0]]), isFrozen: countBy(Object.values(T), (v) => v.isFrozen), notInInstruments: keys.filter((k) => !insSet.has(k)), instrumentsNotInTicker: [...insSet].filter((k) => !T[k]), withVolume: active.length, quoteVolumeUsdTop: active.sort((a, b) => T[b].quote_volume - T[a].quote_volume).slice(0, 8).map((k) => `${k} ${Math.round(T[k].quote_volume)}`), sample: { BTC_USD: T.BTC_USD } });
  await sleep(PACE_MS);
  const c = await get('/currencies');
  log('currencies', { status: c.status, ms: c.ms, bytes: c.bytes, shape: Array.isArray(c.body) ? `array of ${c.body.length}` : typeof c.body, sample: Array.isArray(c.body) ? c.body[0] : String(c.text).slice(0, 200) });
  await sleep(PACE_MS);
  const a = await get('/marketwatch/assets');
  const A = a.body;
  const ak = A && !Array.isArray(A) ? Object.keys(A) : [];
  log('assets', { status: a.status, ms: a.ms, bytes: a.bytes, shape: Array.isArray(A) ? `array of ${A.length}` : `object of ${ak.length}`, sample: Array.isArray(A) ? A[0] : { [ak[0]]: A?.[ak[0]] } });
}

async function latency() {
  const t0 = performance.now();
  const addrs = await lookup(HOST, { all: true });
  log('dns', { ms: +(performance.now() - t0).toFixed(1), addrs: addrs.map((x) => x.address) });
  const cold = await get('/marketwatch/ticker');
  log('cold', { status: cold.status, ms: cold.ms, bytes: cold.bytes, ray: cold.headers.ray });
  const warm = [];
  for (let i = 0; i < 10; i++) {
    await sleep(2_000);
    const r = await get('/marketwatch/ticker');
    warm.push(r.ms);
  }
  log('warm_ticker', { n: warm.length, min: Math.min(...warm), median: pct(warm, 0.5), max: Math.max(...warm), all: warm });
  await sleep(PACE_MS);
  // Cloudflare's trace names the edge and the country it places this host in, and the client address is left out of the log.
  const trace = await (await fetch(`https://${HOST}/cdn-cgi/trace`, { headers: { 'User-Agent': UA } })).text();
  const field = (k) => trace.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];
  log('edge', { colo: field('colo'), loc: field('loc'), http: field('http'), tls: field('tls') });
}

async function book() {
  const variants = ['/BTC_USD', '/BTC_USD/0', '/BTC_USD/20', '/BTC_USD/40/2', '/BTC_USD/20/1', '/BTC_USD/0/3', '/BTC_USD/7', '/ETH_USD/0/2'];
  for (const v of variants) {
    const r = await get(`/marketwatch/orderbook${v}`);
    const b = r.body ?? {};
    log('book', { path: v, status: r.status, ms: r.ms, bytes: r.bytes, keys: Object.keys(b), bids: b.bids?.length, asks: b.asks?.length, bidsDescending: b.bids ? isSorted(b.bids, true) : null, asksAscending: b.asks ? isSorted(b.asks, false) : null, repeatedBidPrices: b.bids ? repeatedPrices(b.bids) : null, touch: b.bids ? [b.bids[0], b.asks[0]] : r.text.slice(0, 200), timestampAgeMs: b.timestamp ? r.arrived - b.timestamp : null, cache: r.headers.cache, cacheControl: r.headers.cacheControl });
    await sleep(PACE_MS);
  }
  const reps = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/marketwatch/orderbook/BTC_USD/20/2');
    reps.push({ timestamp: r.body.timestamp, ageMs: r.arrived - r.body.timestamp, touch: `${r.body.bids[0]?.[0]}/${r.body.asks[0]?.[0]}`, ms: r.ms, age: r.headers.age, cache: r.headers.cache });
    await sleep(PACE_MS);
  }
  log('book_repeats', { distinctTimestamps: new Set(reps.map((x) => x.timestamp)).size, reps });
}

async function errors() {
  log('no_user_agent', { path: '/marketwatch/ticker', ...(await getNoUa('/marketwatch/ticker')) });
  await sleep(PACE_MS);
  const cases = [
    ['GET', '/marketwatch/orderbook/NOPE_USD'],
    ['GET', '/marketwatch/orderbook/btc_usd'],
    ['GET', '/marketwatch/orderbook/BTC-USD'],
    ['GET', '/marketwatch/orderbook/BTC_USD/20/4'],
    ['GET', '/marketwatch/orderbook/BTC_USD/-2'],
    ['GET', '/nope'],
    ['GET', '/time'],
    ['GET', '/marketwatch/summary'],
    ['POST', '/marketwatch/summary'],
  ];
  for (const [method, path] of cases) {
    const init = method === 'POST' ? { method, body: '{}', headers: { 'Content-Type': 'application/json' } } : {};
    const r = await get(path, init);
    const shape = Array.isArray(r.body) ? `array of ${r.body.length}` : r.body && typeof r.body === 'object' ? `object keys ${Object.keys(r.body).slice(0, 6).join(',')}` : 'not JSON';
    const emptySide = Array.isArray(r.body) && r.body[0]?.trading_pairs ? r.body.filter((x) => !x.highest_bid || !x.lowest_ask).map((x) => `${x.trading_pairs} ${x.highest_bid}/${x.lowest_ask}`) : undefined;
    log('error_case', { method, path, status: r.status, emptySide, ms: r.ms, bytes: r.bytes, contentType: r.headers.contentType, shape, head: r.text.slice(0, 240), sample: Array.isArray(r.body) ? r.body[0] : undefined, rateLimitHeaders: r.headers.rateLimit, retryAfter: r.headers.retryAfter });
    await sleep(PACE_MS);
  }
}

async function time() {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/marketwatch/orderbook/BTC_USD/2/1');
    const mid = (r.sent + r.arrived) / 2;
    rows.push({ ms: r.ms, bookTsMinusLocalMidMs: Math.round(r.body.timestamp - mid), dateHeaderMinusLocalMidMs: Math.round(Date.parse(r.headers.date) - mid) });
    await sleep(PACE_MS);
  }
  log('clock', { rows, note: 'Date has one second resolution, so its offset is only good to about 1 s' });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, latency, book, errors, time };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
