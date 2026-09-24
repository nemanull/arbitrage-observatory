// Icrypex REST probe: catalog by market type, CCXT presence, host latency, the perpetual book against the spot book, fee levels, candidate anchor paths, error shapes and clock offset.
// Public, unauthenticated, read-only. Every call is a GET well inside the published 240 to 300 requests per minute per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/icrypex/rest-probe.mjs [catalog|poll]
//   catalog  exchange info, tickers, fee levels, REST books for five pairs, basis of every perpetual against its spot pair, candidate anchor paths, errors, clock. About 25 s.
//   poll     GET /v1/tickers once a second for 60 s: reply time, and how often last, bid and ask change on four perpetuals.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/icrypex/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.icrypex.com';
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
  const res = await fetch(API + path, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* non JSON body */ }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const mid = (b) => (Number(b.asks[0]?.p) + Number(b.bids[0]?.p)) / 2;

async function catalog() {
  log('ccxt', { version: ccxt.version, icrypexClass: ccxt.exchanges.filter((id) => /icr|crypex/i.test(id)) });
  const addrs = await lookup('api.icrypex.com', { all: true });
  log('dns', { host: 'api.icrypex.com', addresses: addrs.map((a) => a.address) });

  const timings = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/v1/tickers');
    timings.push(r.ms);
    if (i === 0) log('tickers_first', { status: r.status, bytes: r.bytes, ms: r.ms, cfRay: r.headers.get('cf-ray'), cache: r.headers.get('cache-control') });
    await sleep(500);
  }
  log('tickers_timing', { ms: timings });

  const info = await get('/v1/exchange/info');
  keep('exchange-info.json', info.text);
  const pairs = info.json.pairs;
  const count = (arr, f) => arr.reduce((m, p) => ((m[f(p)] = (m[f(p)] || 0) + 1), m), {});
  const perps = pairs.filter((p) => p.marketTypes.includes('PERPETUAL'));
  log('exchange_info', {
    status: info.status, ms: info.ms, bytes: info.bytes, version: info.json.version,
    assets: info.json.assets.length, pairs: pairs.length,
    marketTypes: count(pairs, (p) => p.marketTypes.join('+')),
    perpStatus: count(perps, (p) => p.status), perpQuote: count(perps, (p) => p.quote),
    spotStatus: count(pairs.filter((p) => !p.marketTypes.includes('PERPETUAL')), (p) => p.status),
    perpOrderTypes: count(perps, (p) => p.orderTypes.join('+')),
    perpPriceLimitFactor: count(perps, (p) => p.priceLimitFactor),
    perpTickSize: count(perps, (p) => p.tickSize),
    perpMinExchangeValue: count(perps, (p) => p.minExchangeValue),
  });
  const spotSymbols = new Set(pairs.filter((p) => !p.marketTypes.includes('PERPETUAL')).map((p) => p.symbol));
  const perpBases = perps.map((p) => p.base);
  log('perps', { n: perps.length, symbols: perps.map((p) => p.symbol).join(' '), withoutSpotTwin: perps.filter((p) => !spotSymbols.has(p.base + p.quote)).map((p) => p.symbol).join(' ') });
  log('perp_bases_listed_twice', { dup: perpBases.filter((b, i) => perpBases.indexOf(b) !== i) });
  const assets = new Map(info.json.assets.map((a) => [a.symbol, a]));
  const cats = {};
  for (const p of perps) {
    const k = (assets.get(p.base)?.categories || []).join('+') || 'none';
    (cats[k] ||= []).push(p.base);
  }
  log('perp_base_categories', { cats });

  const tick = await get('/v1/tickers');
  keep('tickers.json', tick.text);
  const tmap = new Map(tick.json.map((t) => [t.symbol, t]));
  log('tickers', { rows: tick.json.length, perpRows: tick.json.filter((t) => t.symbol.endsWith('/P')).length, fields: Object.keys(tick.json[0]), btcPerp: tmap.get('BTCUSDT/P'), btcSpot: tmap.get('BTCUSDT') });
  const perpZeroVol = perps.filter((p) => Number(tmap.get(p.symbol)?.volume || 0) === 0).map((p) => p.symbol);
  log('perp_zero_volume_24h', { n: perpZeroVol.length, symbols: perpZeroVol.join(' ') });

  const fees = await get('/v1/trades/fees');
  keep('fees.json', fees.text);
  log('fees', { status: fees.status, levels: fees.json.map((l) => `${l.level}:${l.min}-${l.max ?? ''} maker ${l.fees.map((f) => f.pairSymbol + '=' + f.makerFeePercentage).join(',')} taker ${l.fees.map((f) => f.takerFeePercentage).join(',')}`) });

  for (const sym of ['BTCUSDT/P', 'BTCUSDT', 'ETHUSDT/P', 'LDOUSDT/P', 'NVDXUSDT/P']) {
    const r = await get('/v1/orderbook?symbol=' + encodeURIComponent(sym));
    const b = r.json;
    const askAsc = b.asks.every((x, i) => i === 0 || Number(x.p) > Number(b.asks[i - 1].p));
    const bidDesc = b.bids.every((x, i) => i === 0 || Number(x.p) < Number(b.bids[i - 1].p));
    log('rest_book', { sym, status: r.status, ms: r.ms, pairSymbol: b.pairSymbol, asks: b.asks.length, bids: b.bids.length, askAsc, bidDesc, bestBid: b.bids[0], bestAsk: b.asks[0], spreadPpm: Math.round(((Number(b.asks[0]?.p) - Number(b.bids[0]?.p)) / mid(b)) * 1e6) });
    await sleep(300);
  }
  const r1 = await get('/v1/orderbook?symbol=BTCUSDT%2FP');
  await sleep(150);
  const r2 = await get('/v1/orderbook?symbol=BTCUSDT%2FP');
  log('rest_book_repeat', { identical: r1.text === r2.text, cache: r2.headers.get('cache-control'), cf: r2.headers.get('cf-cache-status') });

  const basis = [];
  for (const p of perps) {
    const spot = p.base + p.quote;
    const tp = tmap.get(p.symbol);
    const ts = tmap.get(spot);
    if (!tp || !ts) continue;
    const mp = (Number(tp.bid) + Number(tp.ask)) / 2;
    const ms = (Number(ts.bid) + Number(ts.ask)) / 2;
    if (mp > 0 && ms > 0) basis.push({ s: p.symbol, ppm: Math.round(((mp - ms) / ms) * 1e6), perpSpreadPpm: Math.round(((Number(tp.ask) - Number(tp.bid)) / mp) * 1e6) });
  }
  basis.sort((a, b) => a.ppm - b.ppm);
  const abs = basis.map((b) => Math.abs(b.ppm)).sort((a, b) => a - b);
  log('perp_vs_spot_mid_ppm', { n: basis.length, medianAbs: abs[Math.floor(abs.length / 2)], min: basis[0], max: basis.at(-1), sample: basis.filter((b) => /^(BTC|ETH|SOL|XRP|DOGE)USDT/.test(b.s)) });
  const spreads = basis.map((b) => b.perpSpreadPpm).sort((a, b) => a - b);
  log('perp_touch_spread_ppm', { min: spreads[0], median: spreads[Math.floor(spreads.length / 2)], max: spreads.at(-1) });

  for (const path of ['/v1/future/info', '/v1/future/get-future-settings?pairSymbol=BTCUSDT/P&positionSide=LONG', '/v1/future/funding-rates', '/v1/future/mark-price', '/v1/future/pairs', '/v1/premium-index', '/v1/funding-rate', '/v1/mark-price', '/v1/index-price', '/v1/accounts/fee-level', '/v1/time', '/v1/orderbook', '/v1/orderbook?symbol=NOPEUSDT', '/v1/trades/last?symbol=NOPEUSDT']) {
    const r = await get(path);
    log('path', { path, status: r.status, bytes: r.bytes, body: r.text.slice(0, 120), wwwAuth: r.headers.get('www-authenticate') });
    await sleep(250);
  }

  const tl = await get('/v1/trades/last?symbol=' + encodeURIComponent('BTCUSDT/P'));
  log('trades_last', { status: tl.status, n: tl.json.trades.length, first: tl.json.trades[0], nowSec: Math.floor(Date.now() / 1000) });
  const now = Math.floor(Date.now() / 1000);
  const kl = await get(`/v1/trades/kline?symbol=${encodeURIComponent('BTCUSDT/P')}&resolution=60&from=${now - 6 * 3600}&to=${now}`);
  log('kline', { status: kl.status, s: kl.json?.s, keys: kl.json && Object.keys(kl.json), bars: kl.json?.t?.length, lastBar: kl.json?.t?.at(-1) });

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const res = await fetch(API + '/v1/future/info');
    const t1 = Date.now();
    await res.text();
    const d = Date.parse(res.headers.get('date'));
    offsets.push(Math.round(d - (t0 + t1) / 2));
    await sleep(1100);
  }
  log('clock_offset_from_date_header_ms', { offsets, note: 'Date header has 1 s resolution' });
}

async function poll() {
  const watch = ['BTCUSDT/P', 'ETHUSDT/P', 'XRPUSDT/P', 'LDOUSDT/P'];
  const prev = {};
  const changes = Object.fromEntries(watch.map((s) => [s, { last: 0, bid: 0, ask: 0 }]));
  const ms = [];
  let bad = 0;
  const statuses = {};
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const t = Date.now();
    const r = await get('/v1/tickers');
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    ms.push(r.ms);
    if (r.status !== 200 || !Array.isArray(r.json)) { bad++; } else {
      const m = new Map(r.json.map((x) => [x.symbol, x]));
      for (const s of watch) {
        const row = m.get(s);
        if (!row) continue;
        if (prev[s]) for (const k of ['last', 'bid', 'ask']) if (row[k] !== prev[s][k]) changes[s][k]++;
        prev[s] = row;
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  const sorted = [...ms].sort((a, b) => a - b);
  log('poll', { polls: ms.length, seconds: Math.round((Date.now() - start) / 1000), statuses, bad, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], max: sorted.at(-1), over1s: ms.filter((x) => x > 1000).length });
  log('poll_changes_of_59', changes);
}

const mode = process.argv[2] || 'catalog';
if (mode === 'catalog') await catalog();
else if (mode === 'poll') await poll();
else console.log('unknown mode', mode);
