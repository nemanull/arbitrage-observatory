// Paribu public REST probe: host and latency, spot catalog and ticker coverage, quoted spreads, REST book depth, order and edge caching, rate limit headers, error shapes, server clock.
// Public, unauthenticated, read-only. Every call is a GET on https://api.paribu.com, plus one Cloudflare trace on www.paribu.com, paced well inside the published limits.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/paribu/rest-probe.mjs [host|catalog|book|limits|time|all]
//   host     DNS, Cloudflare trace, one cold and 20 warm requests on four calls. About 30 s.
//   catalog  exchange config markets, bulk ticker, CoinGecko pairs and tickers, quoted spreads, CCXT check. About 5 s.
//   book     REST book at several limits, level order, unknown symbols, edge cache over 8 s, CoinGecko book. About 20 s.
//   limits   rate limit headers over 20 calls at 5 per second and on three other calls, and the error shapes. About 12 s.
//   time     Date header and book timestamp against the local clock over 10 calls. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/paribu/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.paribu.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'user-agent': 'arbitrage-observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const h = (k) => res.headers.get(k);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return {
    status: res.status,
    ms,
    bytes: text.length,
    body,
    text,
    date: h('date'),
    colo: (h('cf-ray') ?? '').split('-')[1],
    cache: h('cf-cache-status'),
    cacheControl: h('cache-control'),
    age: h('age'),
    rlLimit: h('x-ratelimit-limit'),
    rlRemaining: h('x-ratelimit-remaining'),
    rlReset: h('x-ratelimit-reset'),
    ratelimit: h('ratelimit'),
    quota: h('x-quota-remaining'),
    retryAfter: h('retry-after'),
  };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

async function host() {
  const a4 = await dns.resolve4('api.paribu.com').catch((e) => String(e));
  const a6 = await dns.resolve6('api.paribu.com').catch((e) => e.code);
  log('dns', { host: 'api.paribu.com', a: a4, aaaa: a6 });
  const trace = await fetch('https://www.paribu.com/cdn-cgi/trace').then((r) => r.text());
  const kv = Object.fromEntries(trace.trim().split('\n').map((l) => l.split('=')));
  log('cloudflare_trace', { colo: kv.colo, loc: kv.loc, http: kv.http, tls: kv.tls });

  const calls = ['/market/ticker', '/orderbook?market=btc_tl&limit=100', '/cg/tickers', '/initials/config?scope=markets'];
  for (const path of calls) {
    const times = [];
    const colos = new Set();
    const caches = {};
    let first = null;
    for (let i = 0; i < 21; i++) {
      const r = await get(path);
      colos.add(r.colo);
      caches[r.cache] = (caches[r.cache] ?? 0) + 1;
      if (i === 0) first = r;
      else times.push(r.ms);
      await sleep(250);
    }
    log('latency', { path, status: first.status, bytes: first.bytes, firstMs: first.ms, warm: stats(times), colos: [...colos], caches });
  }
}

async function catalog() {
  const cfg = await get('/initials/config?scope=markets');
  capture('config-markets.json', cfg.text);
  const markets = cfg.body.payload.markets;
  const ids = Object.keys(markets);
  const byQuote = {};
  const labels = {};
  const flags = { suspended: [], unlisted: [], listingDate: 0 };
  for (const id of ids) {
    const m = markets[id];
    byQuote[m.pairs.payment] = (byQuote[m.pairs.payment] ?? 0) + 1;
    for (const l of m.labels ?? []) labels[l] = (labels[l] ?? 0) + 1;
    if (m.suspended !== undefined) flags.suspended.push(`${id}:${m.suspended}`);
    if (m.unlisted === true) flags.unlisted.push(id);
    if (m.listing_date !== undefined) flags.listingDate++;
    if (`${m.pairs.market}_${m.pairs.payment}` !== id) log('id_mismatch', { id, pairs: m.pairs });
  }
  const derivative = ids.filter((id) => /perp|swap|future|_p$|-p$/i.test(id) || (markets[id].labels ?? []).some((l) => /perp|swap|future|margin|lever/i.test(l)));
  log('config_markets', { status: cfg.status, bytes: cfg.bytes, ms: cfg.ms, total: ids.length, byQuote, labels, derivative, ...flags });

  const bad = await get('/initials/config?scope=nope');
  log('config_bad_scope', { status: bad.status, body: JSON.stringify(bad.body).slice(0, 200) });

  const tick = await get('/market/ticker');
  capture('market-ticker.json', tick.text);
  const tickIds = new Set(tick.body.map((t) => t.market));
  const notInTicker = ids.filter((id) => !tickIds.has(id));
  const notInCatalog = [...tickIds].filter((id) => !markets[id]);
  const openNotInTicker = notInTicker.filter((id) => markets[id].unlisted !== true && markets[id].suspended === undefined);
  const flaggedInTicker = ids.filter((id) => tickIds.has(id) && (markets[id].unlisted === true || markets[id].suspended !== undefined));
  log('market_ticker', { status: tick.status, bytes: tick.bytes, ms: tick.ms, rows: tick.body.length, fields: Object.keys(tick.body[0]), notInTicker: notInTicker.length, openNotInTicker, flaggedInTicker, notInCatalog });

  const pairs = await get('/cg/pairs');
  const cgIds = pairs.body.map((p) => p.ticker_id);
  const toNative = (t) => t.toLowerCase().replace(/_try$/, '_tl');
  const cgUnmapped = cgIds.filter((t) => !markets[toNative(t)]);
  const cgNative = new Set(cgIds.map(toNative));
  const tickerNotInCg = [...tickIds].filter((id) => !cgNative.has(id));
  log('cg_pairs', { status: pairs.status, rows: cgIds.length, sample: pairs.body[0], cgUnmapped, tickerNotInCg });

  const cgt = await get('/cg/tickers');
  capture('cg-tickers.json', cgt.text);
  const spreads = { TRY: [], USDT: [] };
  let oneSided = 0;
  let crossed = 0;
  for (const t of cgt.body) {
    const bid = Number(t.bid);
    const ask = Number(t.ask);
    if (!(bid > 0) || !(ask > 0)) {
      oneSided++;
      continue;
    }
    if (bid >= ask) crossed++;
    const ppm = ((ask - bid) / ((ask + bid) / 2)) * 1e6;
    (spreads[t.target_currency] ??= []).push(Math.round(ppm));
  }
  const pick = (id) => cgt.body.find((t) => t.ticker_id === id);
  const sp = (t) => (t ? Math.round(((t.ask - t.bid) / ((Number(t.ask) + Number(t.bid)) / 2)) * 1e6) : null);
  log('cg_tickers', {
    status: cgt.status, rows: cgt.body.length, oneSided, crossed,
    spreadPpm: Object.fromEntries(Object.entries(spreads).map(([k, v]) => [k, stats(v)])),
    btcTry: sp(pick('BTC_TRY')), btcUsdt: sp(pick('BTC_USDT')), usdtTry: sp(pick('USDT_TRY')), ethTry: sp(pick('ETH_TRY')),
  });
  const vol = cgt.body.map((t) => ({ id: t.ticker_id, q: Number(t.target_volume) })).sort((a, b) => b.q - a.q);
  log('cg_top_volume', { top: vol.slice(0, 8).map((v) => `${v.id}:${Math.round(v.q)}`), usdtPairsQuoteVol: Math.round(vol.filter((v) => v.id.endsWith('_USDT')).reduce((s, v) => s + v.q, 0)) });

  log('ccxt', { version: ccxt.version, paribu: ccxt.exchanges.includes('paribu'), count: ccxt.exchanges.length });
}

function orderOk(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (dir === 'desc' ? b >= a : b <= a) return false;
  }
  return true;
}

async function book() {
  for (const q of ['', '&limit=20', '&limit=100', '&limit=500', '&limit=abc']) {
    const r = await get(`/orderbook?market=btc_tl${q}`);
    const b = r.body;
    log('orderbook', { query: `market=btc_tl${q}`, status: r.status, bytes: r.bytes, bids: b.bids?.length, asks: b.asks?.length, bidsDesc: orderOk(b.bids ?? [], 'desc'), asksAsc: orderOk(b.asks ?? [], 'asc'), keys: Object.keys(b ?? {}), cache: r.cache, cacheControl: r.cacheControl });
    await sleep(300);
  }
  for (const m of ['btc_usdt', 'usdt_tl']) {
    const r = await get(`/orderbook?market=${m}&limit=100`);
    log('orderbook', { query: `market=${m}&limit=100`, status: r.status, bids: r.body.bids?.length, asks: r.body.asks?.length, bidsDesc: orderOk(r.body.bids ?? [], 'desc'), asksAsc: orderOk(r.body.asks ?? [], 'asc'), top: [r.body.bids?.[0], r.body.asks?.[0]] });
    await sleep(300);
  }
  for (const m of ['nope_tl', 'BTC_TL', 'btc-tl', 'agix_tl', 'rdnt_tl']) {
    const r = await get(`/orderbook?market=${m}`);
    log('orderbook_odd_symbol', { market: m, status: r.status, body: r.text.slice(0, 160) });
    await sleep(300);
  }
  const noMarket = await get('/orderbook');
  log('orderbook_no_market', { status: noMarket.status, body: noMarket.text.slice(0, 160) });

  const seen = [];
  for (let i = 0; i < 8; i++) {
    const r = await get('/orderbook?market=btc_tl&limit=100');
    seen.push({ t: Date.now() % 100000, seq: r.body.seq, ts: r.body.timestamp, cache: r.cache, age: r.age, colo: r.colo, ms: r.ms });
    await sleep(1000);
  }
  log('orderbook_cache', { calls: seen });
  const nonce = [];
  for (let i = 0; i < 3; i++) {
    const r = await get(`/orderbook?market=btc_tl&limit=100&_=${Date.now()}`);
    nonce.push({ seq: r.body.seq, cache: r.cache, age: r.age });
    await sleep(500);
  }
  log('orderbook_nonce', { calls: nonce });

  for (const q of ['depth=0', 'depth=10', 'depth=1', 'depth=200', 'depth=501']) {
    const r = await get(`/cg/orderbook?ticker_id=BTC_TRY&${q}`);
    log('cg_orderbook', { query: q, status: r.status, bids: r.body?.bids?.length, asks: r.body?.asks?.length, bidsDesc: orderOk(r.body?.bids ?? [], 'desc'), asksAsc: orderOk(r.body?.asks ?? [], 'asc'), body: r.status !== 200 ? r.text.slice(0, 160) : undefined, cache: r.cache, cacheControl: r.cacheControl });
    await sleep(300);
  }
}

async function limits() {
  const rows = [];
  const ratelimit = new Set();
  for (let i = 0; i < 20; i++) {
    const r = await get(i % 2 ? '/orderbook?market=eth_tl&limit=5' : '/market/ticker?market=btc_tl');
    rows.push(`${r.status}:${r.rlLimit}/${r.rlRemaining}/${r.rlReset}${r.quota ? `/q${r.quota}` : ''}`);
    ratelimit.add(r.ratelimit);
    await sleep(200);
  }
  log('rate_headers', { note: 'status:limit/remaining/reset, alternating ticker and orderbook', rows, ratelimit: [...ratelimit] });
  for (const path of ['/cg/tickers', '/initials/config?scope=markets', '/trades?market=btc_tl&limit=1']) {
    const r = await get(path);
    log('rate_headers_other', { path, status: r.status, limit: r.rlLimit, remaining: r.rlRemaining, reset: r.rlReset, ratelimit: r.ratelimit, quota: r.quota });
    await sleep(300);
  }
  const cases = [
    '/market/ticker?market=nope_tl',
    '/market/ticker?market=BTC_TL',
    '/trades?market=btc_tl&limit=21',
    '/trades?market=btc_tl',
    '/trades?market=nope_tl&limit=5',
    '/nope',
  ];
  for (const path of cases) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, body: r.text.slice(0, 200), retryAfter: r.retryAfter });
    await sleep(300);
  }
  const tr = await get('/trades?market=btc_tl&limit=3');
  log('trades', { status: tr.status, rows: tr.body.length, first: tr.body[0] });
}

async function time() {
  const offsets = [];
  const bookAges = [];
  for (let i = 0; i < 10; i++) {
    const sent = Date.now();
    const r = await get(`/orderbook?market=btc_tl&limit=5&_=${sent}`);
    const recv = Date.now();
    const mid = (sent + recv) / 2;
    offsets.push(Math.round(Date.parse(r.date) - mid));
    bookAges.push(Math.round(recv - r.body.timestamp * 1000));
    await sleep(900);
  }
  log('clock', { note: 'Date header has 1 s resolution, so offsets span about -1000 to 0 ms for a synced clock', dateMinusLocalMs: stats(offsets), bookTimestampAgeMs: stats(bookAges) });
}

const mode = process.argv[2] ?? 'all';
const runs = { host, catalog, book, limits, time };
const order = mode === 'all' ? Object.keys(runs) : [mode];
log('start', { mode, at: new Date().toISOString() });
for (const m of order) {
  if (!runs[m]) throw new Error(`unknown mode ${m}`);
  await runs[m]();
}
log('done', { at: new Date().toISOString() });
