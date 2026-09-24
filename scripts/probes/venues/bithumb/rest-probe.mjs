// Bithumb spot REST probe: host and latency, the market catalog against CCXT, the bulk ticker, the REST book, errors, rate limit headers and the clock.
// Public, unauthenticated, read-only. At most one request every 250 ms, far inside the published 150 requests per second per category.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bithumb/rest-probe.mjs [catalog|timing|book|errors|all]
//   catalog  DNS, /v1/market/all, the legacy ALL_KRW and ALL_BTC tickers, the warning list, and CCXT 4.5.68 loadMarkets. About 10 s.
//   timing   cold and warm times of the bulk ticker, the one market and many market books, and the legacy bulk book, 20 polls each at 1 s. About 2 minutes.
//   book     level counts and order, repeat reads 250 ms apart to see caching, the KRW price against OKX through KRW-USDT, padding and zero sizes on every market. About 20 s.
//   errors   unknown market, missing parameter, URL length, legacy errors, rate limit headers, Date header and ticker timestamp against the local clock. About 15 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bithumb/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.bithumb.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: Math.min(...xs), median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, json, text, headers: res.headers };
}

async function catalog() {
  const addrs = await lookup('api.bithumb.com', { all: true });
  log('dns', { host: 'api.bithumb.com', addrs: addrs.map((a) => a.address) });

  const all = await get('/v1/market/all?isDetails=true');
  keep('market-all.json', all.text);
  const byQuote = {};
  const warn = {};
  for (const m of all.json) {
    const q = m.market.split('-')[0];
    byQuote[q] = (byQuote[q] ?? 0) + 1;
    warn[m.market_warning] = (warn[m.market_warning] ?? 0) + 1;
  }
  log('market_all', { status: all.status, ms: all.ms, bytes: all.bytes, rows: all.json.length, byQuote, warn, fields: Object.keys(all.json[0]) });
  const btcQuoted = all.json.filter((m) => m.market.startsWith('BTC-')).map((m) => m.market);
  log('btc_quoted', { markets: btcQuoted });
  const usdLike = all.json.filter((m) => /-(USDT|USDC|USD1|USDE|DAI)$/.test(m.market)).map((m) => m.market);
  log('stablecoin_bases_on_krw', { markets: usdLike });

  const warnings = await get('/v1/market/virtual_asset_warning');
  const types = {};
  for (const w of warnings.json ?? []) types[`${w.warning_type}/${w.warning_step}`] = (types[`${w.warning_type}/${w.warning_step}`] ?? 0) + 1;
  log('virtual_asset_warning', { status: warnings.status, ms: warnings.ms, rows: warnings.json?.length, types, sample: warnings.json?.[0] });

  for (const q of ['KRW', 'BTC']) {
    await sleep(250);
    const legacy = await get(`/public/ticker/ALL_${q}`);
    const keys = Object.keys(legacy.json?.data ?? {}).filter((k) => k !== 'date');
    log('legacy_ticker_all', { quote: q, status: legacy.status, ms: legacy.ms, bytes: legacy.bytes, markets: keys.length, date: legacy.json?.data?.date });
  }

  const ex = new ccxt.bithumb();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const types2 = {};
  for (const m of list) types2[`${m.type}/${m.quote}/${m.active}`] = (types2[`${m.type}/${m.quote}/${m.active}`] ?? 0) + 1;
  log('ccxt_markets', { ms: Math.round(performance.now() - t0), count: list.length, byTypeQuoteActive: types2, swaps: list.filter((m) => m.swap).length });
  const btc = markets['BTC/KRW'];
  const takers = {};
  for (const m of list) takers[`${m.quote}:${m.taker}`] = (takers[`${m.quote}:${m.taker}`] ?? 0) + 1;
  log('ccxt_taker_by_quote', takers);
  log('ccxt_btc_krw', { id: btc.id, base: btc.base, quote: btc.quote, taker: btc.taker, maker: btc.maker, contractSize: btc.contractSize, linear: btc.linear, active: btc.active, precision: btc.precision, limits: btc.limits });
  const ids = {};
  for (const m of list) ids[m.id] = [...(ids[m.id] ?? []), m.symbol];
  const shared = Object.entries(ids).filter(([, s]) => s.length > 1);
  log('ccxt_ids_shared', { count: shared.length, sample: shared.slice(0, 5) });
  const wire = new Set(all.json.map((m) => m.market));
  const matched = list.filter((m) => wire.has(`${m.quote}-${m.base}`) || wire.has(`${m.quote}-${m.id}`)).length;
  const missing = list.filter((m) => !wire.has(`${m.quote}-${m.id}`)).map((m) => m.symbol);
  const extra = [...wire].filter((w) => {
    const [q, b] = w.split('-');
    return !list.some((m) => m.quote === q && m.id === b);
  });
  log('ccxt_vs_market_all', { ccxt: list.length, wire: wire.size, matchedByQuoteDashId: matched, ccxtNotOnWire: missing.slice(0, 20), wireNotInCcxt: extra.slice(0, 20), wireNotInCcxtCount: extra.length });
  const renamed = list.filter((m) => m.base !== m.id).map((m) => `${m.id} as ${m.base}`);
  log('ccxt_common_currency_renames', { renamed });
}

async function timing() {
  const all = await get('/v1/market/all');
  const krw = all.json.filter((m) => m.market.startsWith('KRW-')).map((m) => m.market);
  const everything = all.json.map((m) => m.market);
  const calls = {
    ticker_all_markets: `/v1/ticker?markets=${everything.join(',')}`,
    ticker_krw_200: `/v1/ticker?markets=${krw.slice(0, 200).join(',')}`,
    orderbook_one: '/v1/orderbook?markets=KRW-BTC',
    orderbook_krw_200: `/v1/orderbook?markets=${krw.slice(0, 200).join(',')}`,
    legacy_orderbook_all_krw: '/public/orderbook/ALL_KRW',
    legacy_ticker_all_krw: '/public/ticker/ALL_KRW',
  };
  for (const [name, path] of Object.entries(calls)) {
    const times = [];
    let bytes = 0;
    let rows = 0;
    let status = 0;
    for (let i = 0; i < 20; i++) {
      const r = await get(path);
      times.push(r.ms);
      bytes = r.bytes;
      status = r.status;
      rows = Array.isArray(r.json) ? r.json.length : Object.keys(r.json?.data ?? {}).length;
      if (i === 0 && OUT) keep(`timing-${name}.json`, r.text.slice(0, 200000));
      await sleep(Math.max(0, 1000 - r.ms));
    }
    log('timing', { name, status, bytes, rows, first: times[0], warm: stats(times.slice(1)) });
  }
}

async function book() {
  const one = await get('/v1/orderbook?markets=KRW-BTC');
  const u = one.json[0].orderbook_units;
  const bidDesc = u.every((x, i) => i === 0 || u[i - 1].bid_price > x.bid_price);
  const askAsc = u.every((x, i) => i === 0 || u[i - 1].ask_price < x.ask_price);
  log('orderbook_one', { levels: u.length, bidDesc, askAsc, timestamp: one.json[0].timestamp, fields: Object.keys(one.json[0]), top: u[0], sizeType: typeof u[0].bid_size });
  await sleep(250);
  const many = await get('/v1/orderbook?markets=KRW-BTC,KRW-ETH,BTC-ETH');
  log('orderbook_many', { rows: many.json.length, levels: many.json.map((r) => `${r.market}:${r.orderbook_units.length}`) });
  await sleep(250);
  const krwUsdt = await get('/v1/orderbook?markets=KRW-USDT');
  log('orderbook_krw_usdt', { top: krwUsdt.json[0]?.orderbook_units?.[0] });

  const seen = [];
  for (let i = 0; i < 40; i++) {
    const r = await get('/v1/orderbook?markets=KRW-BTC');
    seen.push({ ts: r.json[0].timestamp, top: `${r.json[0].orderbook_units[0].bid_price}/${r.json[0].orderbook_units[0].ask_price}`, recv: Date.now(), ms: r.ms });
    await sleep(250);
  }
  const distinctTs = new Set(seen.map((s) => s.ts)).size;
  const ages = seen.map((s) => s.recv - Number(s.ts));
  log('orderbook_repeat', { reads: seen.length, distinctTimestamps: distinctTs, ageMs: stats(ages) });

  const legacy = await get('/public/orderbook/BTC_KRW?count=30');
  const d = legacy.json?.data;
  log('legacy_orderbook', { status: legacy.status, bids: d?.bids?.length, asks: d?.asks?.length, timestamp: d?.timestamp, firstBid: d?.bids?.[0], firstAsk: d?.asks?.[0] });
  // The KRW books sit in their own quote, so the USDT price they imply goes through KRW-USDT. One OKX read gives the global side for context.
  const pair = await get('/v1/orderbook?markets=KRW-BTC,KRW-ETH,KRW-USDT');
  const mid = (code) => {
    const u = pair.json.find((r) => r.market === code).orderbook_units[0];
    return (u.bid_price + u.ask_price) / 2;
  };
  const usdtKrw = mid('KRW-USDT');
  for (const base of ['BTC', 'ETH']) {
    const okx = await (await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${base}-USDT`)).json();
    const okxMid = (Number(okx.data[0].bidPx) + Number(okx.data[0].askPx)) / 2;
    const implied = mid(`KRW-${base}`) / usdtKrw;
    log('krw_premium', { base, bithumbKrwMid: mid(`KRW-${base}`), usdtKrwMid: usdtKrw, impliedUsdt: +implied.toFixed(2), okxUsdtMid: okxMid, premiumPpm: Math.round((implied / okxMid - 1) * 1e6) });
    await sleep(250);
  }
  // Every market at 15 levels, 200 per call: how a side with fewer than 15 levels is padded, and how often a size prints as 0.
  const codes = (await get('/v1/market/all')).json.map((m) => m.market);
  const scan = { markets: 0, units: {}, paddedBidMarkets: 0, paddedAskMarkets: 0, emptyBidMarkets: 0, emptyAskMarkets: 0, zeroSizeAtPrice: 0, zeroSizeMarkets: 0, samples: [] };
  for (let i = 0; i < codes.length; i += 200) {
    const r = await get(`/v1/orderbook?markets=${codes.slice(i, i + 200).join(',')}`);
    for (const b of r.json) {
      const u = b.orderbook_units;
      scan.markets++;
      scan.units[u.length] = (scan.units[u.length] ?? 0) + 1;
      if (u.some((x) => x.bid_price === 0)) scan.paddedBidMarkets++;
      if (u.some((x) => x.ask_price === 0)) scan.paddedAskMarkets++;
      if (u.every((x) => x.bid_price === 0)) scan.emptyBidMarkets++;
      if (u.every((x) => x.ask_price === 0)) scan.emptyAskMarkets++;
      const z = u.filter((x) => (x.bid_price !== 0 && x.bid_size === 0) || (x.ask_price !== 0 && x.ask_size === 0)).length;
      scan.zeroSizeAtPrice += z;
      if (z > 0) scan.zeroSizeMarkets++;
      if (scan.samples.length < 2 && u.some((x) => x.bid_price === 0 || x.ask_price === 0)) scan.samples.push({ market: b.market, last: u[u.length - 1] });
    }
    await sleep(300);
  }
  log('book_scan_all_markets', scan);
  const legacyAll = await get('/public/orderbook/ALL_KRW');
  const la = legacyAll.json?.data ?? {};
  const sample = la.BTC;
  log('legacy_orderbook_all', { status: legacyAll.status, markets: Object.keys(la).filter((k) => !['timestamp', 'payment_currency'].includes(k)).length, btcBids: sample?.bids?.length, btcAsks: sample?.asks?.length });
}

async function errors() {
  const cases = {
    unknown_market: '/v1/orderbook?markets=KRW-NOPE',
    lowercase_market: '/v1/orderbook?markets=krw-btc',
    one_known_one_unknown: '/v1/orderbook?markets=KRW-BTC,KRW-NOPE',
    missing_param: '/v1/orderbook',
    ticker_unknown: '/v1/ticker?markets=KRW-NOPE',
    unknown_path: '/v1/nope',
    legacy_unknown: '/public/orderbook/NOPE_KRW',
    legacy_usdt_quote: '/public/ticker/ALL_USDT',
  };
  for (const [name, path] of Object.entries(cases)) {
    const r = await get(path);
    log('error_case', { name, status: r.status, body: r.text.slice(0, 160) });
    await sleep(250);
  }
  const all = (await get('/v1/market/all')).json.map((m) => m.market);
  for (const n of [400, all.length]) {
    const q = all.slice(0, n).join(',');
    const x = await get(`/v1/ticker?markets=${q}`);
    log('url_length', { markets: n, queryChars: q.length, status: x.status, rows: Array.isArray(x.json) ? x.json.length : null });
    await sleep(250);
  }
  const r = await get('/v1/orderbook?markets=KRW-BTC');
  const h = {};
  for (const k of ['x-ratelimit-remaining', 'x-ratelimit-burst-capacity', 'x-ratelimit-replenish-rate', 'x-ratelimit-requested-tokens', 'retry-after', 'server', 'date']) h[k] = r.headers.get(k);
  log('headers', h);
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const x = await get('/v1/ticker?markets=KRW-BTC');
    const t1 = Date.now();
    const mid = (t0 + t1) / 2;
    offsets.push({ dateHeaderMinusMid: Date.parse(x.headers.get('date')) - mid, tickerTsMinusMid: Number(x.json[0].timestamp) - mid, tradeTimestampEqualsTimestamp: x.json[0].trade_timestamp === x.json[0].timestamp, tradeTimeUtc: x.json[0].trade_time, tradeTimeKst: x.json[0].trade_time_kst, rtt: t1 - t0 });
    await sleep(1000);
  }
  log('clock', { samples: offsets });
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, timing, book, errors };
for (const [name, fn] of Object.entries(modes)) {
  if (mode === name || mode === 'all') {
    log('mode', { name, at: new Date().toISOString() });
    await fn();
  }
}
