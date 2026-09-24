// MAX (MaiCoin) REST probe: host and latency, spot catalog, VIP fee table, the M-wallet index, ticker cadence, REST book, errors and server time.
// Public, unauthenticated, read-only. At most about four requests a second, far inside the published 1,200 per minute per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/max-maicoin/rest-probe.mjs [all|quick]
//   all    everything below, with a 60 s poll of index_prices and v2 tickers once a second. About 90 s.
//   quick  everything except the 60 s poll. About 15 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/max-maicoin/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://max-api.maicoin.com';
const MODE = process.argv[2] ?? 'all';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  const limitHeaders = {};
  for (const [k, v] of res.headers) {
    if (/limit|retry|age$|cache/i.test(k)) limitHeaders[k] = v;
  }
  return { status: res.status, ms, bytes: text.length, body, text, limitHeaders, date: res.headers.get('date') };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function host() {
  const addrs = await lookup('max-api.maicoin.com', { all: true });
  log('dns', { host: 'max-api.maicoin.com', addrs: addrs.map((a) => a.address) });
  const cold = await get('/api/v3/timestamp');
  const warm = [];
  for (let i = 0; i < 10; i++) warm.push((await get('/api/v3/timestamp')).ms);
  log('latency_timestamp', { cold: cold.ms, warm: stats(warm) });
  const t0 = performance.now();
  const st = await fetch('https://status-api-max.maicoin.com/api/status/max-api');
  log('system_status', { status: st.status, ms: Math.round(performance.now() - t0), body: (await st.text()).slice(0, 200) });
}

async function catalog() {
  const v3 = await get('/api/v3/markets');
  const v2 = await get('/api/v2/markets');
  const tick = await get('/api/v2/tickers');
  keep('v3-markets.json', v3.text);
  const byQuote = {};
  const byStatus = {};
  let mwallet = 0;
  for (const m of v3.body) {
    byQuote[m.quote_unit] = (byQuote[m.quote_unit] ?? 0) + 1;
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    if (m.m_wallet_supported) mwallet++;
  }
  const v3ids = new Set(v3.body.map((m) => m.id));
  const v2ids = new Set(v2.body.map((m) => m.id));
  const tickIds = new Set(Object.keys(tick.body));
  const pairs = {};
  for (const m of v3.body) {
    const k = m.base_unit;
    pairs[k] = (pairs[k] ?? 0) + 1;
  }
  log('catalog', {
    v3Status: v3.status, v3Count: v3.body.length, v3Bytes: v3.bytes, v3Ms: v3.ms,
    byQuote, byStatus, mwalletSupported: mwallet,
    v2Count: v2.body.length, v2Fields: Object.keys(v2.body[0]),
    v3Fields: Object.keys(v3.body[0]),
    idsV3NotInV2: [...v3ids].filter((x) => !v2ids.has(x)),
    idsV3NotInTickers: [...v3ids].filter((x) => !tickIds.has(x)),
    basesListedTwice: Object.entries(pairs).filter(([, n]) => n > 1).length,
    mwalletMarkets: v3.body.filter((m) => m.m_wallet_supported).map((m) => m.id),
    anyNonSpotField: v3.body.some((m) => Object.keys(m).some((k) => /contract|settle|swap|future|perp/i.test(k))),
  });
  return v3.body;
}

async function fees() {
  const r = await get('/api/v2/vip_levels');
  keep('vip-levels.json', r.text);
  log('vip_levels', { status: r.status, rows: r.body.map((l) => [l.level, l.minimum_trading_volume, l.minimum_staking_volume, l.maker_fee, l.taker_fee]) });
  log('ccxt', { version: ccxt.version, maxClasses: ccxt.exchanges.filter((x) => /^max|maicoin/i.test(x)) });
}

async function book(markets) {
  for (const [market, limit] of [['btcusdt', 300], ['usdttwd', 300], ['btctwd', 20]]) {
    const r = await get(`/api/v3/depth?market=${market}&limit=${limit}`);
    const { asks, bids, timestamp, last_update_id, last_update_version } = r.body;
    const desc = (xs) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) > Number(x[0]));
    log('depth', {
      market, limit, status: r.status, ms: r.ms, bytes: r.bytes, keys: Object.keys(r.body),
      asks: asks.length, bids: bids.length, asksDescending: desc(asks), bidsDescending: desc(bids),
      firstAsk: asks[0], lastAsk: asks[asks.length - 1], firstBid: bids[0],
      ageS: Math.round(Date.now() / 1000 - timestamp), last_update_id, last_update_version,
      sizesAreStrings: typeof asks[0][1] === 'string',
    });
  }
  const noSort = await get('/api/v3/depth?market=btcusdt&limit=5&sort_by_price=false');
  log('depth_sort_false', { status: noSort.status, asks: noSort.body.asks, bids: noSort.body.bids });
  const a = await get('/api/v3/depth?market=btcusdt&limit=1');
  await sleep(1000);
  const b = await get('/api/v3/depth?market=btcusdt&limit=1');
  log('depth_ids_1s_apart', { a: [a.body.last_update_id, a.body.last_update_version], b: [b.body.last_update_id, b.body.last_update_version], headers: a.limitHeaders });
  const thin = markets.find((m) => m.quote_unit === 'twd' && /^(gst|gram|xaut)/.test(m.id));
  if (thin) {
    const t = await get(`/api/v3/depth?market=${thin.id}&limit=300`);
    log('depth_thin', { market: thin.id, asks: t.body.asks.length, bids: t.body.bids.length });
  }
}

async function errors() {
  for (const p of [
    '/api/v3/depth?market=nopeusdt',
    '/api/v3/depth?market=btcusdt&limit=301',
    '/api/v3/depth?market=btcusdt&limit=0',
    '/api/v3/tickers',
    '/api/v3/tickers?markets[]=btcusdt&markets[]=nopeusdt',
    '/api/v3/ticker?market=nopeusdt',
    '/api/v3/nope',
    '/api/v3/wallet/m/historical_index_prices?market=btcusdt',
  ]) {
    const r = await get(p);
    log('error_shape', { path: p, status: r.status, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 200) });
  }
  const t = await get('/api/v3/tickers?markets[]=btcusdt&markets[]=usdttwd');
  log('v3_tickers_two', { status: t.status, ms: t.ms, body: JSON.stringify(t.body).slice(0, 400) });
}

async function clock() {
  const offsets = [];
  const rtts = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/api/v3/timestamp');
    const t1 = Date.now();
    rtts.push(t1 - t0);
    offsets.push(r.body.timestamp * 1000 - (t0 + t1) / 2);
    await sleep(300);
  }
  log('clock', { unit: 'seconds on the wire', offsetsMs: offsets.map(Math.round), rttMs: rtts });
}

async function indexHistory() {
  const end = Date.now();
  const r = await get(`/api/v3/wallet/m/historical_index_prices?market=btcusdt&start_time=${end - 600_000}&end_time=${end}`);
  const ts = (r.body ?? []).map((x) => x.timestamp);
  const gaps = ts.slice(1).map((t, i) => Math.abs(t - ts[i]));
  log('historical_index', { status: r.status, rows: ts.length, first: r.body?.[0], last: r.body?.[r.body.length - 1], spacingMs: gaps.length ? stats(gaps) : null });
}

async function poll() {
  const idxPrev = {};
  const idxChanges = {};
  const tickPrev = {};
  const tickChanges = {};
  const idxMs = [];
  const tickMs = [];
  const idxBytes = [];
  const tickBytes = [];
  const skew = [];
  let atChanges = 0;
  let prevAt = null;
  const tickCache = {};
  const tickAge = [];
  const tickStaleS = [];
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const [idx, tick] = await Promise.all([get('/api/v3/wallet/m/index_prices'), get('/api/v2/tickers')]);
    const cs = tick.limitHeaders['cf-cache-status'] ?? 'none';
    tickCache[cs] = (tickCache[cs] ?? 0) + 1;
    tickAge.push(Number(tick.limitHeaders.age ?? 0));
    tickStaleS.push(Math.round(Date.now() / 1000) - Math.max(...Object.values(tick.body).map((x) => x.at)));
    idxMs.push(idx.ms);
    tickMs.push(tick.ms);
    idxBytes.push(idx.bytes);
    tickBytes.push(tick.bytes);
    for (const [k, v] of Object.entries(idx.body)) {
      if (idxPrev[k] !== undefined && idxPrev[k] !== v) idxChanges[k] = (idxChanges[k] ?? 0) + 1;
      idxPrev[k] = v;
    }
    for (const k of ['btcusdt', 'usdttwd', 'ethusdt', 'btctwd']) {
      const tk = tick.body[k];
      const sig = `${tk.buy}|${tk.sell}`;
      if (tickPrev[k] !== undefined && tickPrev[k] !== sig) tickChanges[k] = (tickChanges[k] ?? 0) + 1;
      tickPrev[k] = sig;
      if (k === 'btcusdt' || k === 'usdttwd') {
        const mid = (Number(tk.buy) + Number(tk.sell)) / 2;
        skew.push({ k, ppm: Math.round(((Number(idx.body[k]) - mid) / mid) * 1e6) });
      }
    }
    const maxAt = Math.max(...Object.values(tick.body).map((x) => x.at));
    if (prevAt !== null && maxAt !== prevAt) atChanges++;
    prevAt = maxAt;
    if (i === 0) {
      keep('index-prices.json', idx.text);
      keep('v2-tickers.json', tick.text);
      log('index_keys', { keys: Object.keys(idx.body), headers: idx.limitHeaders, tickersHeaders: tick.limitHeaders });
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  const skewBy = (k) => stats(skew.filter((s) => s.k === k).map((s) => s.ppm));
  log('poll_60', {
    indexMs: stats(idxMs), indexBytes: stats(idxBytes), tickersMs: stats(tickMs), tickersBytes: stats(tickBytes),
    tickersCfCache: tickCache, tickersAgeHeaderS: stats(tickAge), tickersNowMinusNewestAtS: stats(tickStaleS),
    indexChangesPerKey: idxChanges, tickerTouchChanges: tickChanges, tickersMaxAtChanges: atChanges,
    indexMinusMidPpm: { btcusdt: skewBy('btcusdt'), usdttwd: skewBy('usdttwd') },
  });
}

await host();
const markets = await catalog();
await fees();
await book(markets);
await errors();
await clock();
await indexHistory();
if (MODE === 'all') await poll();
