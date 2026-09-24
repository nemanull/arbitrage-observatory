// GMO Coin REST probe: catalog and CCXT check, host latency and CDN headers, bulk ticker polls with the leverage over spot premium, book snapshots, errors, clock offset.
// Public, unauthenticated, read-only. At most about 6 requests per second, in the cache mode, and no public REST limit is published.
// Run from server/: node ../scripts/probes/venues/gmo-coin/rest-probe.mjs [catalog|latency|cache|poll|book|errors|all]
//   catalog  GET /v1/status and /v1/symbols, spot and leverage split, fees per symbol, and whether CCXT 4.5.68 has a GMO Coin class. About 2 s.
//   latency  DNS, one cold and ten warm requests per endpoint, CDN headers, clock offset from responsetime on CloudFront misses. About 30 s.
//   cache    20 reads of one ticker URL at 150 ms, then 20 with a query parameter that changes per read: CloudFront hits, repeated responsetime, age at receipt. About 12 s.
//   poll     60 polls of GET /v1/ticker at 1 s: reply time, how often each leverage symbol changes, ticker age, and the leverage over spot mid premium. About 65 s.
//   book     GET /v1/orderbooks on every leverage symbol and spot BTC: level count, order, crossing, touch against the ticker, and repeat reads for caching. About 20 s.
//   errors   unknown symbol, missing symbol, unknown path, bad klines interval: status and body. About 3 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/gmo-coin/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.coin.z.com/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => { const s = sorted(a); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = sorted(a); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const isLeverage = (symbol) => symbol.endsWith('_JPY');

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const sentMs = Date.now();
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'accept-encoding': 'gzip' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, text, json, headers: res.headers, sentMs, recvMs: Date.now() };
}

async function catalog() {
  const status = await get('/v1/status');
  log('status', { http: status.status, body: status.json });

  const symbols = await get('/v1/symbols');
  keep('symbols.json', symbols.text);
  const rows = symbols.json.data;
  const spot = rows.filter((r) => !isLeverage(r.symbol));
  const lev = rows.filter((r) => isLeverage(r.symbol));
  log('symbols', { http: symbols.status, bytes: symbols.text.length, total: rows.length, spot: spot.length, leverage: lev.length, fields: Object.keys(rows[0]) });

  const byFee = (list) => {
    const groups = {};
    for (const r of list) {
      const key = `taker ${r.takerFee} maker ${r.makerFee}`;
      (groups[key] ??= []).push(r.symbol);
    }
    return groups;
  };
  log('leverage_fees', byFee(lev));
  log('spot_fees', byFee(spot));
  for (const r of lev) log('leverage_rule', { symbol: r.symbol, minOrderSize: r.minOrderSize, maxOrderSize: r.maxOrderSize, sizeStep: r.sizeStep, tickSize: r.tickSize });

  const names = ccxt.exchanges.filter((id) => /gmo|coinz|zcom/i.test(id));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, gmoMatches: names, pro: Object.keys(ccxt.pro ?? {}).filter((id) => /gmo/i.test(id)) });
}

async function latency() {
  const host = 'api.coin.z.com';
  const t0 = performance.now();
  const addrs = await lookup(host, { all: true });
  log('dns', { host, ms: Math.round(performance.now() - t0), addrs: addrs.map((a) => a.address) });

  const paths = ['/v1/status', '/v1/ticker', '/v1/ticker?symbol=BTC_JPY', '/v1/orderbooks?symbol=BTC_JPY', '/v1/symbols'];
  const offsets = [];
  for (const path of paths) {
    const times = [];
    let first = null;
    for (let i = 0; i < 11; i++) {
      const r = await get(path);
      if (i === 0) first = r;
      else times.push(r.ms);
      const rt = Date.parse(r.json?.responsetime ?? '');
      // A CloudFront hit replays an older responsetime, so only a miss measures the clock.
      if (Number.isFinite(rt) && /Miss/.test(r.headers.get('x-cache') ?? '')) offsets.push(rt - (r.sentMs + r.recvMs) / 2);
      await sleep(500);
    }
    const h = first.headers;
    log('latency', {
      path, http: first.status, bytes: first.text.length, coldMs: first.ms,
      warm: { min: Math.min(...times), median: median(times), max: Math.max(...times) },
      headers: { server: h.get('server'), 'x-cache': h.get('x-cache'), pop: h.get('x-amz-cf-pop'), 'cache-control': h.get('cache-control'), 'content-encoding': h.get('content-encoding'), date: h.get('date') },
    });
  }
  log('clock_offset_from_responsetime', { misses: offsets.length, medianMs: Math.round(median(offsets)), minMs: Math.round(Math.min(...offsets)), maxMs: Math.round(Math.max(...offsets)), note: 'server responsetime minus local midpoint of the request' });
}

// Reads one URL every 150 ms, with and without a query parameter that differs per read, to measure the CloudFront cache.
async function cache() {
  for (const bust of [false, true]) {
    const reads = [];
    for (let i = 0; i < 20; i++) {
      const r = await get(`/v1/ticker?symbol=BTC_JPY${bust ? `&n=${Date.now()}` : ''}`);
      const rt = Date.parse(r.json?.responsetime ?? '');
      reads.push({ hit: /Hit/.test(r.headers.get('x-cache') ?? ''), ms: r.ms, ageAtReceiptMs: r.recvMs - rt, rt });
      await sleep(150);
    }
    const hits = reads.filter((x) => x.hit);
    const distinct = new Set(reads.map((x) => x.rt)).size;
    const missGaps = [];
    let lastMiss = null;
    for (const x of reads) if (!x.hit) { if (lastMiss !== null) missGaps.push(x.rt - lastMiss); lastMiss = x.rt; }
    log('cache', {
      bust, reads: reads.length, hits: hits.length, distinctResponsetime: distinct,
      hitMs: hits.length ? { min: Math.min(...hits.map((x) => x.ms)), median: median(hits.map((x) => x.ms)) } : null,
      missMs: { min: Math.min(...reads.filter((x) => !x.hit).map((x) => x.ms)), median: median(reads.filter((x) => !x.hit).map((x) => x.ms)) },
      ageAtReceiptMs: { hit: hits.length ? { min: Math.min(...hits.map((x) => x.ageAtReceiptMs)), max: Math.max(...hits.map((x) => x.ageAtReceiptMs)) } : null, missMedian: median(reads.filter((x) => !x.hit).map((x) => x.ageAtReceiptMs)) },
      gapBetweenMissResponsetimeMs: missGaps.length ? { min: Math.min(...missGaps), median: median(missGaps), max: Math.max(...missGaps) } : null,
    });
  }
}

async function poll(seconds = 60) {
  const prev = new Map();
  const changes = new Map();
  const ages = [];
  const times = [];
  const premium = new Map();
  const sizes = [];
  let rowsSeen = 0;
  let hits = 0;
  for (let i = 0; i < seconds; i++) {
    const started = performance.now();
    const r = await get('/v1/ticker');
    times.push(r.ms);
    sizes.push(r.text.length);
    if (/Hit/.test(r.headers.get('x-cache') ?? '')) hits++;
    if (i === 0) keep('ticker.json', r.text);
    const rows = r.json?.data ?? [];
    rowsSeen = rows.length;
    const rt = Date.parse(r.json?.responsetime ?? '');
    const bySymbol = new Map(rows.map((x) => [x.symbol, x]));
    for (const x of rows) {
      if (!isLeverage(x.symbol)) continue;
      const c = changes.get(x.symbol) ?? { bidAsk: 0, last: 0, timestamp: 0, polls: 0 };
      const p = prev.get(x.symbol);
      if (p) {
        c.polls++;
        if (p.bid !== x.bid || p.ask !== x.ask) c.bidAsk++;
        if (p.last !== x.last) c.last++;
        if (p.timestamp !== x.timestamp) c.timestamp++;
      }
      changes.set(x.symbol, c);
      prev.set(x.symbol, x);
      ages.push(rt - Date.parse(x.timestamp));
      const spot = bySymbol.get(x.symbol.replace('_JPY', ''));
      if (spot) {
        const levMid = (Number(x.bid) + Number(x.ask)) / 2;
        const spotMid = (Number(spot.bid) + Number(spot.ask)) / 2;
        const list = premium.get(x.symbol) ?? [];
        list.push(Math.round((levMid / spotMid - 1) * 1e6));
        premium.set(x.symbol, list);
      }
    }
    await sleep(Math.max(0, 1000 - (performance.now() - started)));
  }
  log('ticker_poll', { polls: seconds, rows: rowsSeen, bytes: { min: Math.min(...sizes), max: Math.max(...sizes) }, ms: { min: Math.min(...times), median: median(times), p90: pct(times, 0.9), max: Math.max(...times) }, over1s: times.filter((t) => t > 1000).length, cloudfrontHits: hits });
  log('ticker_age_ms', { note: 'responsetime minus the row timestamp, leverage rows', min: Math.min(...ages), median: median(ages), p90: pct(ages, 0.9), max: Math.max(...ages) });
  for (const [symbol, c] of changes) {
    const p = premium.get(symbol) ?? [];
    log('ticker_changes', { symbol, ...c, premiumPpm: p.length ? { min: Math.min(...p), median: median(p), max: Math.max(...p) } : null });
  }
}

async function book() {
  const ticker = await get('/v1/ticker');
  const tick = new Map(ticker.json.data.map((x) => [x.symbol, x]));
  const lev = ticker.json.data.map((x) => x.symbol).filter(isLeverage).sort();
  for (const symbol of [...lev, 'BTC']) {
    const r = await get(`/v1/orderbooks?symbol=${symbol}`);
    if (symbol === 'BTC_JPY') keep('orderbooks-BTC_JPY.json', r.text);
    const d = r.json?.data;
    const asks = (d?.asks ?? []).map((l) => [Number(l.price), Number(l.size)]);
    const bids = (d?.bids ?? []).map((l) => [Number(l.price), Number(l.size)]);
    const asc = asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0]);
    const desc = bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0]);
    const notional20 = (side) => Math.round(side.slice(0, 20).reduce((s, l) => s + l[0] * l[1], 0));
    const t = tick.get(symbol);
    const bestBid = bids[0]?.[0];
    const bestAsk = asks[0]?.[0];
    log('book', {
      symbol, http: r.status, ms: r.ms, bytes: r.text.length, bids: bids.length, asks: asks.length, bidsDescending: desc, asksAscending: asc,
      crossed: bestBid >= bestAsk, spreadPpm: Math.round(((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 1e6),
      touch: [bestBid, bestAsk], tickerTouch: t ? [Number(t.bid), Number(t.ask)] : null, sizeStrings: typeof d?.asks?.[0]?.size === 'string',
      jpyWithin20: { bids: notional20(bids), asks: notional20(asks) }, fields: d ? Object.keys(d) : null,
    });
    await sleep(600);
  }

  const etags = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/v1/orderbooks?symbol=BTC_JPY');
    const d = r.json.data;
    etags.push({ ms: r.ms, etag: r.headers.get('etag'), lastModified: r.headers.get('last-modified'), responsetime: r.json.responsetime, top: `${d.bids[0].price}/${d.asks[0].price}`, xcache: r.headers.get('x-cache') });
    await sleep(300);
  }
  log('book_repeat_BTC_JPY', { reads: etags });
}

async function errors() {
  const cases = ['/v1/orderbooks?symbol=NOPE_JPY', '/v1/orderbooks', '/v1/ticker?symbol=NOPE', '/v1/nope', '/v2/ticker', '/v1/klines?symbol=BTC_JPY&interval=2min&date=20260922', '/v1/trades?symbol=BTC_JPY&count=1'];
  for (const path of cases) {
    const r = await get(path);
    log('error_case', { path, http: r.status, body: r.text.slice(0, 200) });
    await sleep(400);
  }
}

const mode = process.argv[2] ?? 'all';
if (mode === 'catalog' || mode === 'all') await catalog();
if (mode === 'latency' || mode === 'all') await latency();
if (mode === 'cache' || mode === 'all') await cache();
if (mode === 'poll' || mode === 'all') await poll(Number(process.argv[3] ?? 60));
if (mode === 'book' || mode === 'all') await book();
if (mode === 'errors' || mode === 'all') await errors();
