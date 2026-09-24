// Bilaxy spot REST probe: host and latency, the User-Agent refusal, server time, rate limit headers, the pair catalog against the ticker, the valuation call, and the order book call.
// Public, unauthenticated, read-only. A few requests a second at most, well inside the published 10 per second per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bilaxy/rest-probe.mjs [all|host|catalog|book]
//   host     DNS, cold and warm /health, clock offset, /ratelimits and its headers, the request without a User-Agent, the old API host. About 15 s.
//   catalog  /v1/pairs, /v1/ticker/24hr, /v1/currencies, /v1/valuation, the site's getFee call, CCXT's exchange list. About 12 s.
//   book     /v1/orderbook limits, level order, unknown and missing pair, and six polls one second apart. About 15 s.
// Recorded in docs/profiles/bilaxy/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://newapi.bilaxy.com';
const UA = 'arbitrage-observatory-probe/1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);

async function get(path, { ua = UA } = {}) {
  const t0 = Date.now();
  const res = await fetch(path.startsWith('http') ? path : API + path, { headers: ua === null ? {} : { 'User-Agent': ua } });
  const text = await res.text();
  const ms = Date.now() - t0;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const h = (k) => res.headers.get(k);
  return { status: res.status, ms, t0, t1: t0 + ms, bytes: text.length, text, json, headers: { server: h('server'), xcache: h('x-cache'), pop: h('x-amz-cf-pop'), cacheControl: h('cache-control'), age: h('age'), limit: h('x-ratelimit-limit'), remaining: h('x-ratelimit-remaining'), reset: h('x-ratelimit-reset'), retryAfter: h('retry-after'), contentType: h('content-type') } };
}

// fetch always sends a User-Agent, so the bare request goes through node:https, which sends none.
function bareGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: {} }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, server: res.headers.server, xcache: res.headers['x-cache'], title: (body.match(/<H1>([^<]*)<\/H1>/i) || [])[1] ?? body.slice(0, 60) }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
  });
}

async function host() {
  for (const name of ['newapi.bilaxy.com', 'bilaxy.com', 'api.bilaxy.com']) {
    const addrs = await lookup(name, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { name, addresses: addrs.map((a) => a.address) });
  }
  const cold = await get('/health');
  log('health_cold', { status: cold.status, ms: cold.ms, body: cold.json, headers: cold.headers });
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    const r = await get('/health');
    warm.push(r.ms);
    if (r.json?.timestamp) offsets.push([r.ms, r.json.timestamp - (r.t0 + r.t1) / 2]);
  }
  // Warm times are bimodal, and the midpoint rule only holds on the fast, symmetric round trips.
  const fast = offsets.filter(([ms]) => ms < 150).map(([, o]) => o);
  const all = offsets.map(([, o]) => o);
  log('health_warm', { n: warm.length, ms: warm, min: pct(warm, 0), p50: pct(warm, 0.5), max: pct(warm, 1), clockOffsetMs: { all: [Math.round(pct(all, 0)), Math.round(pct(all, 0.5)), Math.round(pct(all, 1))], under150msTrips: fast.map(Math.round) } });
  const rl = await get('/ratelimits');
  log('ratelimits', { status: rl.status, body: rl.json, headers: rl.headers });
  const rlv1 = await get('/v1/ratelimits');
  log('ratelimits_v1_path', { status: rlv1.status, body: rlv1.text.slice(0, 120) });
  const defaultUa = await fetch(API + '/health');
  log('fetch_default_user_agent', { status: defaultUa.status, note: 'fetch with no headers, as AnchorPoller sends it' });
  log('no_user_agent', await bareGet(API + '/health'));
  log('no_user_agent_site', await bareGet('https://bilaxy.com/'));
  for (const url of ['https://api.bilaxy.com/v1/ticker?symbol=1', 'https://api.bilaxy.com/v1/coins']) {
    const r = await get(url).catch((e) => ({ status: e.message }));
    log('old_api', { url, status: r.status, body: r.text?.slice(0, 80) });
  }
}

async function catalog() {
  const pairs = await get('/v1/pairs');
  const p = pairs.json;
  const vals = Object.entries(p);
  const byQuote = {};
  for (const [, v] of vals) {
    const k = `${v.quote}:${v.trade_enabled ? 'enabled' : 'disabled'}`;
    byQuote[k] = (byQuote[k] ?? 0) + 1;
  }
  const ids = new Set(vals.map(([, v]) => v.pair_id));
  const keyMismatch = vals.filter(([k, v]) => k !== `${v.base}_${v.quote}`).map(([k]) => k);
  log('pairs', { status: pairs.status, ms: pairs.ms, bytes: pairs.bytes, headers: pairs.headers, count: vals.length, enabled: vals.filter(([, v]) => v.trade_enabled).length, closedTrue: vals.filter(([, v]) => v.closed).length, uniquePairIds: ids.size, byQuote, keyNotBaseUnderscoreQuote: keyMismatch, fields: Object.keys(vals[0][1]) });
  const one = await get('/v1/pairs?pair=BTC_USDT');
  log('pairs_one', { status: one.status, body: one.json });
  const bad = await get('/v1/pairs?pair=NOPE_USDT');
  log('pairs_unknown', { status: bad.status, body: bad.text.slice(0, 160) });

  const tick = await get('/v1/ticker/24hr');
  const t = tick.json;
  const tk = Object.keys(t);
  const onlyPairs = Object.keys(p).filter((k) => !(k in t));
  const onlyTicker = tk.filter((k) => !(k in p));
  const enabledDiff = tk.filter((k) => k in p && t[k].trade_enabled !== p[k].trade_enabled);
  const top = Object.entries(t)
    .filter(([, v]) => v.trade_enabled)
    .map(([k, v]) => [k, Math.round(Number(v.quote_volume))])
    .sort((a, b) => b[1] - a[1]);
  // ETH-quoted volume is in ETH, so it is valued at the ETH_USDT close before the shares are taken.
  const ethUsdt = Number(t.ETH_USDT?.close);
  const usd = Object.entries(t)
    .filter(([k, v]) => v.trade_enabled && k in p)
    .map(([k, v]) => [k, Number(v.quote_volume) * (p[k].quote === 'ETH' ? ethUsdt : p[k].quote === 'USDT' || p[k].quote === 'USDC' ? 1 : NaN)])
    .filter(([, x]) => Number.isFinite(x))
    .sort((a, b) => b[1] - a[1]);
  const usdTotal = usd.reduce((x, [, y]) => x + y, 0);
  const ethQuotedUsd = usd.filter(([k]) => k.endsWith('_ETH')).reduce((x, [, y]) => x + y, 0);
  log('ticker_24hr_usd', { totalUsd: Math.round(usdTotal), btcEthShare: Math.round(((usd.find(([k]) => k === 'BTC_USDT')?.[1] ?? 0) + (usd.find(([k]) => k === 'ETH_USDT')?.[1] ?? 0)) / usdTotal * 1000) / 10, ethQuotedUsd: Math.round(ethQuotedUsd), topUsd: usd.slice(0, 8).map(([k, x]) => [k, Math.round(x)]) });
  log('ticker_24hr', { status: tick.status, ms: tick.ms, bytes: tick.bytes, count: tk.length, enabled: Object.values(t).filter((v) => v.trade_enabled).length, onlyInPairs: onlyPairs, onlyInTicker: onlyTicker, tradeEnabledDiffers: enabledDiff, fields: Object.keys(t[tk[0]]), topQuoteVolume: top.slice(0, 8), zeroVolumeEnabled: top.filter((x) => x[1] === 0).length });

  const cur = await get('/v1/currencies');
  log('currencies', { status: cur.status, ms: cur.ms, bytes: cur.bytes, count: Object.keys(cur.json ?? {}).length });
  const val = await get('/v1/valuation');
  const vk = Object.keys(val.json ?? {});
  log('valuation', { status: val.status, ms: val.ms, bytes: val.bytes, count: vk.length, fields: vk.length ? Object.keys(val.json[vk[0]]) : [], BTC: val.json?.BTC, ETH: val.json?.ETH });
  const btcVals = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/v1/valuation?currency=BTC');
    btcVals.push(r.json?.BTC?.usd_value);
    await sleep(1000);
  }
  log('valuation_btc_5_polls', { usd: btcVals, distinct: new Set(btcVals).size });
  const ppmOff = (cur, pair) => (val.json?.[cur] && t[pair] ? Math.round((Number(val.json[cur].usd_value) / Number(t[pair].close) - 1) * 1e6) : null);
  log('valuation_vs_ticker_close_ppm', { BTC: ppmOff('BTC', 'BTC_USDT'), ETH: ppmOff('ETH', 'ETH_USDT'), DOT: ppmOff('DOT', 'DOT_USDT'), OP: ppmOff('OP', 'OP_USDT') });

  // The site asks this for the fee shown on the trade page, and it answers without a session too.
  for (const sym of [113, 79, 999999]) {
    const r = await get(`https://bilaxy.com/api/v2/market/getFee?symbol=${sym}`);
    log('site_get_fee', { symbol: sym, status: r.status, body: r.text.slice(0, 80) });
    await sleep(300);
  }

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, bilaxyLike: ccxt.exchanges.filter((x) => /bilaxy/i.test(x)) });
}

async function book() {
  for (const limit of [undefined, 5, 30, 200, 201, 0]) {
    const r = await get(`/v1/orderbook?pair=BTC_USDT${limit === undefined ? '' : `&limit=${limit}`}`);
    const b = r.json?.bids ?? [];
    const a = r.json?.asks ?? [];
    const desc = b.every((l, i) => i === 0 || Number(l[0]) <= Number(b[i - 1][0]));
    const asc = a.every((l, i) => i === 0 || Number(l[0]) >= Number(a[i - 1][0]));
    log('orderbook', { limit: limit ?? 'default', status: r.status, ms: r.ms, bytes: r.bytes, levels: [b.length, a.length], bidsDescending: desc, asksAscending: asc, types: [typeof b[0]?.[0], typeof b[0]?.[1]], tsMinusLocalMs: r.json?.timestamp ? r.json.timestamp - r.t1 : null, touch: [b[0], a[0]], deepestBid: b.at(-1), headers: { xcache: r.headers.xcache, cacheControl: r.headers.cacheControl, limit: r.headers.limit, remaining: r.headers.remaining }, error: r.json?.bids ? undefined : r.text.slice(0, 160) });
    await sleep(300);
  }
  for (const q of ['pair=NOPE_USDT', '', 'pair=btc_usdt', 'pair=ACH_ETH&limit=5', 'pair=DOT_USDT&limit=5']) {
    const r = await get(`/v1/orderbook?${q}`);
    log('orderbook_edge', { query: q, status: r.status, body: r.text.slice(0, 200) });
    await sleep(300);
  }
  const polls = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/v1/orderbook?pair=ETH_USDT&limit=30');
    polls.push({ ms: r.ms, ts: r.json?.timestamp, key: JSON.stringify([r.json?.bids, r.json?.asks]), age: r.json?.timestamp ? r.t1 - r.json.timestamp : null, xcache: r.headers.xcache });
    await sleep(1000);
  }
  log('orderbook_polls', { pair: 'ETH_USDT', ms: polls.map((p) => p.ms), distinctTimestamps: new Set(polls.map((p) => p.ts)).size, distinctBooks: new Set(polls.map((p) => p.key)).size, arrivalMinusTsMs: polls.map((p) => p.age), xcache: [...new Set(polls.map((p) => p.xcache))] });
  const tr = await get('/v1/trades?pair=BTC_USDT&limit=3');
  log('trades', { status: tr.status, ms: tr.ms, body: tr.json });
}

const mode = process.argv[2] ?? 'all';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'all' || mode === 'host') await host();
if (mode === 'all' || mode === 'catalog') await catalog();
if (mode === 'all' || mode === 'book') await book();
log('end', { at: new Date().toISOString() });
