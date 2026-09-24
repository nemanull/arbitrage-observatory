// CoinJar Exchange REST probe: host and latency, the spot catalog, a ticker scan of every product, one hertz ticker and book polls with cache headers, the REST book at each level, error shapes and the clock offset.
// Public, unauthenticated and read-only.
// Market data calls are documented as not rate limited, and each mode still sends at most 4 requests in any one second, most of the time one or two.
// Run from server/: node ../scripts/probes/venues/coinjar/rest-probe.mjs [main|scan|poll|all]
//   main  DNS, latency, active and inactive catalog, CCXT check, REST book at levels 1 to 3, errors and clock, about 5 s
//   scan  GET /products/{id}/ticker once for every product, 3 at a time, with the engine's USD family picks, about 35 s
//   poll  60 rounds one second apart of four tickers and one level 2 book, with change and cache counts, about 60 s
//   all   the three in order
// Set PROBE_OUT_DIR to keep raw replies and the scan results.
// Recorded in docs/profiles/coinjar/rest.md and docs/profiles/coinjar/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.exchange.coinjar.com';
const DATA = 'https://data.exchange.coinjar.com';
const OUT = process.env.PROBE_OUT_DIR;
const WATCH = ['BTC-USDT', 'ETH-USDC', 'BTCUSD', 'XRPBTC'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stats = (arr) => ({ n: arr.length, min: q(arr, 0), median: q(arr, 0.5), p90: q(arr, 0.9), max: q(arr, 1) });
const round = (x) => Math.round(x * 10) / 10;

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const sent = Date.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = round(performance.now() - t0);
  const h = (k) => res.headers.get(k);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: res.status,
    ms,
    sent,
    recv: Date.now(),
    bytes: text.length,
    text,
    json,
    cache: h('cf-cache-status'),
    age: h('age'),
    cacheControl: h('cache-control'),
    date: h('date'),
    ray: h('cf-ray'),
    retryAfter: h('retry-after'),
    rateHeaders: [...res.headers.keys()].filter((k) => /rate|limit/i.test(k)),
  };
}

const median3 = (a, b, c) => [a, b, c].sort((x, y) => x - y)[1];

async function main() {
  for (const host of ['api.exchange.coinjar.com', 'data.exchange.coinjar.com', 'feed.exchange.coinjar.com']) {
    const addrs = await dns.lookup(host, { all: true }).catch((e) => [{ address: String(e.code) }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }

  const cold = await get(`${API}/products`);
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push((await get(`${API}/products`)).ms);
  log('products_latency', { cold: cold.ms, warm, bytes: cold.bytes, status: cold.status, cacheControl: cold.cacheControl, cache: cold.cache, ray: cold.ray });
  keep('products.json', cold.text);
  const products = cold.json;
  const byCounter = {};
  const pairs = new Map();
  for (const p of products) {
    const c = p.counter_currency.iso_code;
    byCounter[c] = (byCounter[c] ?? 0) + 1;
    const key = `${p.base_currency.iso_code}/${c}`;
    pairs.set(key, [...(pairs.get(key) ?? []), p.id]);
  }
  const twice = [...pairs].filter(([, ids]) => ids.length > 1);
  const keys = new Set(products.flatMap((p) => Object.keys(p)));
  log('catalog', {
    products: products.length,
    byCounter,
    dashIds: products.filter((p) => p.id.includes('-')).length,
    noDashIds: products.filter((p) => !p.id.includes('-')).length,
    pairsListedTwice: twice,
    fields: [...keys],
    statusField: keys.has('status') || keys.has('trading'),
  });
  const all = await get(`${API}/products?all=true`);
  const activeIds = new Set(products.map((p) => p.id));
  const inactive = all.json.filter((p) => !activeIds.has(p.id));
  const inactiveByCounter = {};
  for (const p of inactive) inactiveByCounter[p.counter_currency.iso_code] = (inactiveByCounter[p.counter_currency.iso_code] ?? 0) + 1;
  log('catalog_all', { status: all.status, ms: all.ms, bytes: all.bytes, products: all.json.length, inactive: inactive.length, inactiveByCounter, sample: inactive.slice(0, 6).map((p) => p.id) });
  if (inactive.length > 0) {
    const id = inactive[0].id;
    for (const path of ['ticker', 'book?level=2']) {
      const r = await get(`${DATA}/products/${id}/${path}`);
      log('inactive_call', { id, path, status: r.status, body: r.text.slice(0, 160) });
    }
  }
  const usdFamily = {};
  for (const p of products) {
    const c = p.counter_currency.iso_code;
    if (!['USDT', 'USDC', 'USD'].includes(c)) continue;
    (usdFamily[p.base_currency.iso_code] ??= []).push(c);
  }
  const pick = { USDT: 0, USDC: 0, USD: 0 };
  for (const quotes of Object.values(usdFamily)) pick[['USDT', 'USDC', 'USD'].find((x) => quotes.includes(x))]++;
  log('usd_family', { bases: Object.keys(usdFamily).length, pickedByQuoteRank: pick });

  log('ccxt', {
    version: ccxt.version,
    exchanges: ccxt.exchanges.length,
    coinjarPresent: ccxt.exchanges.some((x) => /coinjar/i.test(x)),
    nameMatches: ccxt.exchanges.filter((x) => /jar/i.test(x)),
  });

  const one = await get(`${API}/products/BTC-USDT`);
  log('product_one', { status: one.status, ms: one.ms, id: one.json?.id, tick_value: one.json?.tick_value, levels: one.json?.price_levels?.length });

  for (const id of ['BTC-USDT', 'BTCUSD', 'XRPBTC']) {
    const tk = await get(`${DATA}/products/${id}/ticker`);
    for (const level of ['1', '2', '3']) {
      const r = await get(`${DATA}/products/${id}/book?level=${level}`);
      const b = r.json ?? { bids: [], asks: [] };
      const desc = b.bids.every((x, i) => i === 0 || Number(x[0]) < Number(b.bids[i - 1][0]));
      const asc = b.asks.every((x, i) => i === 0 || Number(x[0]) > Number(b.asks[i - 1][0]));
      const bb = Number(b.bids[0]?.[0]);
      const ba = Number(b.asks[0]?.[0]);
      log('book', {
        id,
        level,
        status: r.status,
        ms: r.ms,
        bytes: r.bytes,
        bids: b.bids.length,
        asks: b.asks.length,
        bidsDescending: desc,
        asksAscending: asc,
        crossed: bb >= ba,
        best: [b.bids[0], b.asks[0]],
        tickerBidAsk: level === '1' ? [tk.json?.bid, tk.json?.ask] : undefined,
        cache: r.cache,
        age: r.age,
      });
      if (level === '2') keep(`book-${id}.json`, r.text);
    }
  }

  const errors = [
    `${DATA}/products/NOPE/ticker`,
    `${DATA}/products/NOPE/book`,
    `${DATA}/products/BTC-USDT/book?level=4`,
    `${DATA}/products/btc-usdt/ticker`,
    `${DATA}/products/BTC-USDT/nope`,
    `${DATA}/products`,
    `${DATA}/products/BTC-USDT/trades?limit=2`,
    `${DATA}/products/BTC-USDT/auction`,
    `${DATA}/products/BTC-USDT/stats`,
    `${API}/products/NOPE`,
    `${API}/sessions`,
  ];
  for (const url of errors) {
    const r = await get(url);
    log('call', { url: url.replace(/https:\/\//, ''), status: r.status, ms: r.ms, body: r.text.slice(0, 220), retryAfter: r.retryAfter, rateHeaders: r.rateHeaders });
  }

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${DATA}/products/BTC-USDT/ticker?nonce=${Date.now()}`);
    const server = Date.parse(r.json.current_time);
    offsets.push({ offsetMs: Math.round(server - (r.sent + r.recv) / 2), rttMs: r.recv - r.sent, cache: r.cache });
    await sleep(300);
  }
  log('clock', { offsets });
}

async function scan() {
  const res = await get(`${API}/products`);
  const ids = res.json.map((p) => p.id);
  const rows = [];
  for (let i = 0; i < ids.length; i += 3) {
    const batch = await Promise.all(ids.slice(i, i + 3).map((id) => get(`${DATA}/products/${id}/ticker`).then((r) => ({ id, r }))));
    for (const { id, r } of batch) rows.push({ id, status: r.status, ms: r.ms, t: r.json });
    await sleep(250);
  }
  const statusCount = {};
  const sessionCount = {};
  const keys = new Set();
  let markIsMedian = 0;
  let markChecked = 0;
  let markMissing = 0;
  const markOff = [];
  let noBid = 0;
  let noAsk = 0;
  let zeroVol = 0;
  let crossed = 0;
  let transitionSet = 0;
  for (const { id, status, t } of rows) {
    if (status !== 200 || !t) {
      statusCount[`http_${status}`] = (statusCount[`http_${status}`] ?? 0) + 1;
      continue;
    }
    Object.keys(t).forEach((k) => keys.add(k));
    statusCount[t.status] = (statusCount[t.status] ?? 0) + 1;
    sessionCount[t.session] = (sessionCount[t.session] ?? 0) + 1;
    if (t.transition_time !== null) transitionSet++;
    const bid = t.bid === null ? NaN : Number(t.bid);
    const ask = t.ask === null ? NaN : Number(t.ask);
    if (!(bid > 0)) noBid++;
    if (!(ask > 0)) noAsk++;
    if (bid > 0 && ask > 0 && bid >= ask) crossed++;
    if (!(Number(t.volume_24h) > 0)) zeroVol++;
    if (t.mark_price === undefined || t.mark_price === null) {
      markMissing++;
      continue;
    }
    if (bid > 0 && ask > 0 && t.last !== null) {
      markChecked++;
      const m = median3(bid, ask, Number(t.last));
      if (Math.abs(m - Number(t.mark_price)) < 1e-12) markIsMedian++;
      else markOff.push({ id, bid: t.bid, ask: t.ask, last: t.last, mark: t.mark_price });
    }
  }
  log('scan', {
    products: ids.length,
    statusCount,
    sessionCount,
    transitionSet,
    fields: [...keys],
    noBid,
    noAsk,
    crossed,
    zeroVolume24h: zeroVol,
    markMissing,
    markChecked,
    markIsMedianOfBidAskLast: markIsMedian,
    markOff: markOff.slice(0, 5),
    latency: stats(rows.map((r) => r.ms)),
  });
  const usd = rows
    .filter((r) => r.t && /(USDT|USDC|USD)$/.test(r.id))
    .map((r) => ({ id: r.id, vol: Number(r.t.volume_24h) * Number(r.t.last ?? 0) }))
    .sort((a, b) => b.vol - a.vol);
  log('usd_quote_volume_24h', {
    top: usd.slice(0, 8).map((x) => [x.id, Math.round(x.vol)]),
    bottom: usd.slice(-4).map((x) => [x.id, Math.round(x.vol)]),
    over100k: usd.filter((x) => x.vol > 100_000).length,
    over10k: usd.filter((x) => x.vol > 10_000).length,
    zero: usd.filter((x) => !(x.vol > 0)).length,
    total: Math.round(usd.reduce((s, x) => s + x.vol, 0)),
  });
  // The market the engine would pick per base: USDT before USDC before USD, as server/src/engine/cluster/quoteFamily.ts ranks them.
  const byBase = {};
  for (const p of res.json) {
    const c = p.counter_currency.iso_code;
    if (['USDT', 'USDC', 'USD'].includes(c)) (byBase[p.base_currency.iso_code] ??= {})[c] = p.id;
  }
  const picks = Object.values(byBase).map((m) => m.USDT ?? m.USDC ?? m.USD);
  const pickRows = picks.map((id) => rows.find((r) => r.id === id)?.t).filter(Boolean);
  const pickVol = pickRows.map((t) => Number(t.volume_24h) * Number(t.last || 0));
  const spreads = pickRows
    .filter((t) => Number(t.bid) > 0 && Number(t.ask) > 0)
    .map((t) => Math.round(((Number(t.ask) - Number(t.bid)) / ((Number(t.ask) + Number(t.bid)) / 2)) * 1e6));
  log('engine_picks', {
    markets: picks.length,
    zeroVolume24h: pickVol.filter((v) => !(v > 0)).length,
    over10kQuote: pickVol.filter((v) => v > 10_000).length,
    totalQuote: Math.round(pickVol.reduce((s, v) => s + v, 0)),
    twoSided: spreads.length,
    spreadPpmOfMid: stats(spreads),
    under2000ppm: spreads.filter((x) => x < 2000).length,
  });
  keep('scan.json', JSON.stringify(rows.map((r) => ({ id: r.id, status: r.status, ...r.t }))));
}

async function poll() {
  const seen = Object.fromEntries(WATCH.map((id) => [id, { last: null, changes: {}, cache: {}, ms: [], currentTimeRepeats: 0, ageMs: [] }]));
  const book = { prev: null, changes: 0, cache: {}, ms: [], ages: [] };
  const bust = { cache: {}, ms: [] };
  for (let round_ = 0; round_ < 60; round_++) {
    const started = Date.now();
    const replies = await Promise.all([
      ...WATCH.map((id) => get(`${DATA}/products/${id}/ticker`)),
      get(`${DATA}/products/BTC-USDT/book?level=2`),
    ]);
    WATCH.forEach((id, i) => {
      const r = replies[i];
      const s = seen[id];
      s.ms.push(r.ms);
      s.cache[r.cache] = (s.cache[r.cache] ?? 0) + 1;
      if (r.age !== null) s.ageMs.push(Number(r.age) * 1000);
      const t = r.json;
      if (!t) return;
      if (s.last) {
        for (const k of ['bid', 'ask', 'last', 'mark_price', 'volume_24h', 'status', 'session']) {
          if (t[k] !== s.last[k]) s.changes[k] = (s.changes[k] ?? 0) + 1;
        }
        if (t.current_time === s.last.current_time) s.currentTimeRepeats++;
      }
      s.staleness ??= [];
      s.staleness.push(r.recv - Date.parse(t.current_time));
      s.last = t;
    });
    const br = replies[WATCH.length];
    book.ms.push(br.ms);
    book.cache[br.cache] = (book.cache[br.cache] ?? 0) + 1;
    if (br.age !== null) book.ages.push(Number(br.age));
    if (book.prev !== null && book.prev !== br.text) book.changes++;
    book.prev = br.text;
    if (round_ % 10 === 0) {
      const b = await get(`${DATA}/products/BTC-USDT/ticker?nonce=${Date.now()}`);
      bust.cache[b.cache] = (bust.cache[b.cache] ?? 0) + 1;
      bust.ms.push(b.ms);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  for (const id of WATCH) {
    const s = seen[id];
    log('poll_ticker', {
      id,
      latency: stats(s.ms),
      cache: s.cache,
      ageSeconds: stats(s.ageMs.map((x) => x / 1000)),
      changesIn59: s.changes,
      currentTimeRepeats: s.currentTimeRepeats,
      currentTimeLagMs: stats(s.staleness),
      final: { bid: s.last?.bid, ask: s.last?.ask, last: s.last?.last, mark: s.last?.mark_price, status: s.last?.status },
    });
  }
  log('poll_book', { id: 'BTC-USDT', latency: stats(book.ms), cache: book.cache, ageSeconds: stats(book.ages), changedIn59: book.changes });
  log('poll_nonce', { cache: bust.cache, latency: stats(bust.ms) });
}

const mode = process.argv[2] ?? 'main';
const t0 = Date.now();
log('start', { mode, at: new Date().toISOString() });
if (mode === 'main' || mode === 'all') await main();
if (mode === 'scan' || mode === 'all') await scan();
if (mode === 'poll' || mode === 'all') await poll();
log('done', { mode, seconds: Math.round((Date.now() - t0) / 1000) });
