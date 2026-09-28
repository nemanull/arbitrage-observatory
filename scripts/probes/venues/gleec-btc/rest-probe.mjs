// Gleec BTC REST probe: latency, perpetual catalog, CCXT hitbtc mapping with Gleec URLs, bulk anchor call, anchor change rate, REST book, errors and headers.
// Public, unauthenticated, read-only. At most one request per second in the poll loop, far under the documented 30 per second on /public/*.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/gleec-btc/rest-probe.mjs [all|catalog|anchor|poll|book|errors]
//   catalog  symbol catalog counts, CCXT 4.5.68 hitbtc class pointed at api.exchange.gleec.com, market fields for the perpetuals.
//   anchor   futures/info bulk reply size and time, funding history, field mapping.
//   poll     futures/info once a second for 60 s, counts how often mark, index and the rates change.
//   book     REST order book for three perpetuals: depth, level order, sizes.
//   errors   unknown symbol, bad path and the response headers that carry limits.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/gleec-btc/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.exchange.gleec.com/api/3';
const OUT = process.env.PROBE_OUT_DIR;
const mode = process.argv[2] ?? 'all';
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
  return { status: res.status, ms, bytes: text.length, text, headers: Object.fromEntries(res.headers) };
}

async function latency() {
  const times = [];
  for (let i = 0; i < 5; i++) times.push((await get('/public/ticker/BTCUSDT_PERP')).ms);
  log('latency', { firstIsCold: times[0], warm: times.slice(1) });
}

async function catalog() {
  const r = await get('/public/symbol');
  keep('symbol.json', r.text);
  const s = JSON.parse(r.text);
  const counts = {};
  for (const v of Object.values(s)) {
    const k = `${v.type}|${v.contract_type ?? '-'}|${v.status}|${v.quote_currency}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  log('symbol', { status: r.status, ms: r.ms, bytes: r.bytes, counts });
  const perps = Object.entries(s).filter(([, v]) => v.type === 'futures');
  log('perpFees', { rates: [...new Set(perps.map(([, v]) => `${v.take_rate}/${v.make_rate}/${v.fee_currency}`))] });
  log('perpNotWorking', { ids: perps.filter(([, v]) => v.status !== 'working').map(([k, v]) => `${k}:${v.status}`) });

  const ex = new ccxt.hitbtc({ urls: { api: { public: API, private: API } } });
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.swap);
  log('ccxt', {
    version: ccxt.version,
    markets: Object.keys(markets).length,
    swaps: swaps.length,
    activeSwaps: swaps.filter((m) => m.active).length,
    sample: swaps.filter((m) => ['BTCUSDT_PERP', 'TONUSDT_PERP'].includes(m.id)).map((m) => ({
      id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear,
      active: m.active, contractSize: m.contractSize, taker: m.taker, maker: m.maker,
    })),
    takers: [...new Set(swaps.map((m) => m.taker))],
    basesTwice: Object.entries(swaps.reduce((a, m) => ((a[m.base] = (a[m.base] ?? 0) + 1), a), {})).filter(([, n]) => n > 1),
  });
}

async function anchor() {
  const r = await get('/public/futures/info');
  keep('futures-info.json', r.text);
  const f = JSON.parse(r.text);
  const rows = Object.entries(f);
  log('futuresInfo', {
    status: r.status, ms: r.ms, bytes: r.bytes, contracts: rows.length,
    types: [...new Set(rows.map(([, v]) => v.contract_type))],
    nextFunding: [...new Set(rows.map(([, v]) => v.next_funding_time))],
    markEqualsIndex: rows.filter(([, v]) => v.mark_price === v.index_price).length,
    premiumZero: rows.filter(([, v]) => v.premium_index === '0').length,
    ageMs: Date.now() - Date.parse(rows[0][1].timestamp),
  });
  log('btcRow', { row: f.BTCUSDT_PERP });
  const one = await get('/public/futures/info/BTCUSDT_PERP');
  log('futuresInfoOne', { status: one.status, ms: one.ms, bytes: one.bytes });
  const h = await get('/public/futures/history/funding/BTCUSDT_PERP?limit=6');
  const hist = JSON.parse(h.text);
  log('fundingHistory', { status: h.status, rows: hist.map((x) => `${x.timestamp} rate=${x.funding_rate} next=${x.next_funding_time}`) });
  const all = await get('/public/futures/history/funding?limit=1');
  log('fundingHistoryAll', { status: all.status, ms: all.ms, bytes: all.bytes, symbols: Object.keys(JSON.parse(all.text)).length });
}

async function poll() {
  const fields = ['mark_price', 'index_price', 'funding_rate', 'indicative_funding_rate', 'premium_index', 'timestamp'];
  const ids = ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'SOLUSDT_PERP', 'MANAUSDT_PERP'];
  let prev;
  const changes = Object.fromEntries(ids.map((id) => [id, Object.fromEntries(fields.map((k) => [k, 0]))]));
  const ms = [];
  const maxMoves = Object.fromEntries(ids.map((id) => [id, { mark: 0, index: 0 }]));
  for (let i = 0; i < 60; i++) {
    const t = Date.now();
    const r = await get('/public/futures/info');
    ms.push(r.ms);
    const f = JSON.parse(r.text);
    if (prev) for (const id of ids) {
      for (const k of fields) if (f[id][k] !== prev[id][k]) changes[id][k]++;
      const dm = Math.abs(f[id].mark_price / prev[id].mark_price - 1) * 1e6;
      const di = Math.abs(f[id].index_price / prev[id].index_price - 1) * 1e6;
      maxMoves[id].mark = Math.max(maxMoves[id].mark, Math.round(dm));
      maxMoves[id].index = Math.max(maxMoves[id].index, Math.round(di));
    }
    prev = f;
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  ms.sort((a, b) => a - b);
  log('poll', { polls: 60, msMin: ms[0], msMedian: ms[30], msMax: ms[59], changesOutOf59: changes, maxMovePpm: maxMoves });
}

async function book() {
  for (const id of ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'MANAUSDT_PERP']) {
    const r = await get(`/public/orderbook/${id}?depth=0`);
    const b = JSON.parse(r.text);
    const desc = b.bid.every((x, i) => i === 0 || +x[0] < +b.bid[i - 1][0]);
    const asc = b.ask.every((x, i) => i === 0 || +x[0] > +b.ask[i - 1][0]);
    log('book', { id, status: r.status, ms: r.ms, bytes: r.bytes, bids: b.bid.length, asks: b.ask.length, bidsDesc: desc, asksAsc: asc,
      touch: [b.bid[0], b.ask[0]], ts: b.timestamp, cache: r.headers['cf-cache-status'] ?? null });
  }
  const d = await get('/public/orderbook/BTCUSDT_PERP?depth=20');
  const b = JSON.parse(d.text);
  log('bookDepth20', { bids: b.bid.length, asks: b.ask.length });
}

async function errors() {
  for (const p of ['/public/futures/info/NOPE_PERP', '/public/orderbook/NOPE_PERP', '/public/nope', '/public/futures/info/TONUSDT_PERP']) {
    const r = await get(p);
    log('error', { path: p, status: r.status, body: r.text.slice(0, 300) });
  }
  const r = await get('/public/futures/info');
  const h = r.headers;
  log('headers', { server: h.server, date: h.date, cfRay: h['cf-ray'], rateHeaders: Object.fromEntries(Object.entries(h).filter(([k]) => /rate|limit|retry/i.test(k))) });
  const skew = Date.now() - Date.parse(JSON.parse(r.text).BTCUSDT_PERP.timestamp);
  log('clock', { localMinusReplyTimestampMs: skew, rttMs: r.ms });
}

if (['all', 'catalog'].includes(mode)) { await latency(); await catalog(); }
if (['all', 'anchor'].includes(mode)) await anchor();
if (['all', 'book'].includes(mode)) await book();
if (['all', 'errors'].includes(mode)) await errors();
if (['poll'].includes(mode)) await poll();
