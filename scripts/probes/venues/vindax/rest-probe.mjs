// Vindax spot REST probe: host and latency, catalog, reference prices, REST book, rate limit headers, error shapes, server time.
// Public, unauthenticated, read-only. About 35 counted requests in 90 s, spaced out, against a 50 per minute window.
// Run from server/: node ../scripts/probes/venues/vindax/rest-probe.mjs [catalog|book|limits|time|all]
//   catalog  DNS, cold and warm latency, exchangeInfo, ticker/24hr, returnTicker, bookTicker, and a search for index, mark or funding fields.
//   book     depth at every documented limit, level order, back-to-back caching, one-sided and empty books, error shapes.
//   limits   the x-ratelimit headers over eight spaced calls, and which calls are not counted.
//   time     ten server time reads and the clock offset from the round trip midpoint.
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/vindax/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.vindax.com/api/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, name) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'user-agent': 'vindax-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const h = (k) => res.headers.get(k);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (name) keep(name, text);
  return {
    status: res.status,
    ms,
    bytes: text.length,
    type: h('content-type'),
    limit: h('x-ratelimit-limit'),
    remaining: h('x-ratelimit-remaining'),
    reset: h('x-ratelimit-reset'),
    retryAfter: h('retry-after'),
    json,
    text,
  };
}

function orderOf(levels, desc) {
  let ok = true;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (desc ? b >= a : b <= a) ok = false;
  }
  return ok;
}

const typesOf = (levels) => [...new Set(levels.flatMap((l) => l.slice(0, 2).map((v) => typeof v)))].join('/');

async function catalog() {
  const addrs = await lookup('api.vindax.com', { all: true });
  log('dns', { host: 'api.vindax.com', addresses: addrs.map((a) => a.address) });
  const cold = await get('/time');
  const warm = [];
  for (let i = 0; i < 10; i++) warm.push((await get('/time')).ms);
  warm.sort((a, b) => a - b);
  log('latency_time', { cold: cold.ms, warmMin: warm[0], warmMedian: warm[5], warmMax: warm[9] });

  const ei = await get('/exchangeInfo', 'exchangeInfo.json');
  const syms = ei.json.symbols;
  const count = (f) => syms.reduce((m, s) => ((m[f(s)] = (m[f(s)] || 0) + 1), m), {});
  log('exchangeInfo', {
    status: ei.status, ms: ei.ms, bytes: ei.bytes, symbols: syms.length,
    byStatus: count((s) => s.status), byQuote: count((s) => s.quoteAsset),
    rateLimits: ei.json.rateLimits, keys: Object.keys(syms[0]),
    filterTypes: [...new Set(syms.flatMap((s) => s.filters.map((f) => f.filterType)))],
    spelledLikeBaseQuote: syms.filter((s) => s.symbol === s.baseAsset + s.quoteAsset).length,
  });

  const t24 = await get('/ticker/24hr', 'ticker24hr.json');
  const rows = t24.json;
  const px = Object.fromEntries(rows.map((r) => [r.symbol, Number(r.lastPrice)]));
  const usd = { USDT: 1, BTC: px.BTCUSDT, ETH: px.ETHUSDT };
  const quoteOf = Object.fromEntries(syms.map((s) => [s.symbol, s.quoteAsset]));
  const vol = rows.map((r) => [r.symbol, Number(r.quoteVolume) * (usd[quoteOf[r.symbol]] ?? 0)]).sort((a, b) => b[1] - a[1]);
  log('ticker24hr', {
    status: t24.status, ms: t24.ms, bytes: t24.bytes, rows: rows.length, keys: Object.keys(rows[0]),
    nonZeroQuoteVolume: rows.filter((r) => Number(r.quoteVolume) > 0).length,
    over10kUsd: vol.filter((v) => v[1] > 1e4).length, over100kUsd: vol.filter((v) => v[1] > 1e5).length,
    usdTotalExVdQuote: Math.round(vol.reduce((a, v) => a + v[1], 0)),
    top5: vol.slice(0, 5).map(([s, v]) => [s, Math.round(v)]),
    bidZero: rows.filter((r) => !(Number(r.bidPrice) > 0)).length,
    askZero: rows.filter((r) => !(Number(r.askPrice) > 0)).length,
    bothZero: rows.filter((r) => !(Number(r.bidPrice) > 0) && !(Number(r.askPrice) > 0)).length,
    crossed: rows.filter((r) => Number(r.bidPrice) > 0 && Number(r.askPrice) > 0 && Number(r.bidPrice) >= Number(r.askPrice)).length,
    btc: rows.find((r) => r.symbol === 'BTCUSDT'),
  });
  await sleep(1500);

  const rt = await get('/returnTicker', 'returnTicker.json');
  const rk = Object.keys(rt.json);
  log('returnTicker', { status: rt.status, ms: rt.ms, bytes: rt.bytes, keys: rk.length, sampleKey: rk[0], fields: Object.keys(rt.json[rk[0]]) });
  await sleep(1500);

  const bt = await get('/ticker/bookTicker', 'bookTicker.json');
  log('bookTicker', { status: bt.status, ms: bt.ms, bytes: bt.bytes, rows: bt.json.length, fields: Object.keys(bt.json[0]), valueTypes: typeof bt.json[0].bidPrice });

  const all = [ei.text, t24.text, rt.text, bt.text].join('\n');
  log('anchor_fields', {
    index: /index/i.test(all), mark: /mark/i.test(all), funding: /funding/i.test(all), premium: /premium/i.test(all),
    note: 'true means the word appears anywhere in the four replies, including inside a symbol or asset name',
    tokensContaining: [...new Set((all.match(/"[^"]*(index|mark|funding|premium)[^"]*"/gi) || []).slice(0, 10))],
  });

  log('ccxt', { version: ccxt.version, vindaxClass: ccxt.exchanges.filter((id) => /vindax/i.test(id)) });
}

async function book() {
  for (const limit of [5, 10, 20, 50, 100, 500, 1000]) {
    const r = await get(`/depth?symbol=BTCUSDT&limit=${limit}`, `depth_BTCUSDT_${limit}.json`);
    const j = r.json;
    log('depth_limit', {
      limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: j.bids?.length, asks: j.asks?.length,
      lastUpdateId: j.lastUpdateId, idType: typeof j.lastUpdateId, keys: Object.keys(j),
      bidsDesc: orderOf(j.bids ?? [], true), asksAsc: orderOf(j.asks ?? [], false),
      levelTypes: typesOf([...(j.bids ?? []), ...(j.asks ?? [])]), levelLen: j.bids?.[0]?.length,
      bestBid: j.bids?.[0], bestAsk: j.asks?.[0], remaining: r.remaining,
    });
    await sleep(1300);
  }
  const noLimit = await get('/depth?symbol=BTCUSDT');
  log('depth_default', { status: noLimit.status, bids: noLimit.json.bids?.length, asks: noLimit.json.asks?.length });
  await sleep(1300);

  const a = await get('/depth?symbol=ETHUSDT&limit=20');
  const b = await get('/depth?symbol=ETHUSDT&limit=20');
  log('depth_back_to_back', {
    firstMs: a.ms, secondMs: b.ms, firstId: a.json.lastUpdateId, secondId: b.json.lastUpdateId,
    identical: JSON.stringify(a.json) === JSON.stringify(b.json),
  });
  await sleep(1300);

  for (const s of ['SCUSDT', 'BFCV2USDT', 'CZWUSDT']) {
    const r = await get(`/depth?symbol=${s}&limit=20`, `depth_${s}.json`);
    log('depth_thin', { symbol: s, status: r.status, bids: r.json.bids?.length, asks: r.json.asks?.length, lastUpdateId: r.json.lastUpdateId, bestBid: r.json.bids?.[0], bestAsk: r.json.asks?.[0] });
    await sleep(1300);
  }

  for (const q of ['/depth?symbol=NOPEUSDT', '/depth?symbol=btcusdt&limit=5', '/depth?symbol=BTC_USDT&limit=5', '/depth?symbol=BTCUSDT&limit=7', '/depth', '/nope']) {
    const r = await get(q);
    log('error_shape', { query: q, status: r.status, type: r.type, body: r.text.slice(0, 160) });
    await sleep(1300);
  }
}

async function limits() {
  const seq = [];
  for (let i = 0; i < 8; i++) {
    const r = await get('/ticker/price?symbol=BTCUSDT');
    seq.push({ at: Math.floor(Date.now() / 1000), status: r.status, limit: r.limit, remaining: r.remaining, reset: r.reset, retryAfter: r.retryAfter });
    await sleep(2000);
  }
  log('ratelimit_sequence', { seq });
  const heavy = await get('/ticker/24hr');
  const after = await get('/ticker/price?symbol=BTCUSDT');
  log('ratelimit_weight', { afterAllTickers: heavy.remaining, nextCall: after.remaining, note: 'a drop of 1 between the two means the all-symbol call counted as one request' });
  const ping = await get('/ping');
  const time = await get('/time');
  log('ratelimit_uncounted', { pingHasHeader: ping.limit !== null, timeHasHeader: time.limit !== null, pingBody: ping.text, timeBody: time.text });
}

async function time() {
  const offsets = [];
  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get('/time');
    const t1 = Date.now();
    offsets.push(r.json.serverTime - (t0 + t1) / 2);
    rtts.push(t1 - t0);
    await sleep(300);
  }
  const s = [...offsets].sort((a, b) => a - b);
  log('clock', { offsetMsMin: Math.round(s[0]), offsetMsMedian: Math.round(s[5]), offsetMsMax: Math.round(s[9]), rttMin: Math.min(...rtts), rttMax: Math.max(...rtts), note: 'offset is server minus local at the round trip midpoint' });
}

const mode = process.argv[2] ?? 'all';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'catalog' || mode === 'all') await catalog();
if (mode === 'all') await sleep(5000);
if (mode === 'book' || mode === 'all') await book();
if (mode === 'all') await sleep(5000);
if (mode === 'limits' || mode === 'all') await limits();
if (mode === 'time' || mode === 'all') await time();
log('end', { at: new Date().toISOString() });
