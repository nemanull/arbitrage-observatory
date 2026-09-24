// Changelly PRO REST probe: host and latency, the catalog and how CCXT hitbtc maps it when pointed at this host, the futures info anchor call and one hertz polls of it, funding history, the REST book, error shapes, the clock offset, and a comparison with HitBTC's public API.
// Public, unauthenticated and read-only.
// The documented public limit is a rate of 30 requests a second with a burst limit of 50, and every mode here sends at most 7 requests in any one second.
// Run from server/: node ../scripts/probes/venues/changelly-pro/rest-probe.mjs [main|poll|mirror|all]
//   main    DNS, latency, catalog, CCXT hitbtc with the Changelly PRO URL, futures info, funding history, REST book, errors and clock, about 15 s
//   poll    60 rounds one second apart of GET /public/futures/info, with reply time and change counts per field, about 62 s
//   mirror  trades, top five levels and open interest read from Changelly PRO and from api.hitbtc.com at the same moment, about 10 s
//   all     the three in order
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/changelly-pro/rest.md and docs/profiles/changelly-pro/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'api.pro.changelly.com';
const API = `https://${HOST}/api/3`;
const HITBTC = 'https://api.hitbtc.com/api/3';
const OUT = process.env.PROBE_OUT_DIR;
const WATCH = ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'BCHUSDT_PERP', 'MANAUSDT_PERP'];
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
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe/1' } });
  const text = await res.text();
  const ms = round(performance.now() - t0);
  const recvMs = Date.now();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, headers: res.headers, text, body, ms, bytes: text.length, recvMs };
}

function limitHeaders(headers) {
  const out = {};
  for (const [k, v] of headers) {
    if (/ratelimit|retry|x-|cache|age|cf-ray|server/i.test(k)) out[k] = v;
  }
  return out;
}

function sortedDesc(levels) {
  for (let i = 1; i < levels.length; i++) if (Number(levels[i][0]) > Number(levels[i - 1][0])) return false;
  return true;
}

function sortedAsc(levels) {
  for (let i = 1; i < levels.length; i++) if (Number(levels[i][0]) < Number(levels[i - 1][0])) return false;
  return true;
}

async function hostAndLatency() {
  const addrs = await dns.resolve4(HOST);
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${API}/public/symbol/BTCUSDT_PERP`);
    times.push(r.ms);
    if (i === 0) log('first_request', { status: r.status, headers: limitHeaders(r.headers) });
    await sleep(300);
  }
  log('host', { host: HOST, a: addrs.sort(), coldMs: times[0], warmMs: stats(times.slice(1)) });
}

async function catalog() {
  const r = await get(`${API}/public/symbol`);
  keep('symbol.json', r.text);
  const rows = Object.entries(r.body);
  const byTypeStatus = {};
  const perpByQuote = {};
  for (const [, m] of rows) {
    const k = `${m.type}|${m.contract_type ?? '-'}|${m.status}`;
    byTypeStatus[k] = (byTypeStatus[k] ?? 0) + 1;
    if (m.type === 'futures' && m.status === 'working') perpByQuote[m.quote_currency] = (perpByQuote[m.quote_currency] ?? 0) + 1;
  }
  const perps = rows.filter(([, m]) => m.type === 'futures');
  const fees = {};
  for (const [, m] of rows) {
    const k = `${m.type}:${m.take_rate}/${m.make_rate}`;
    fees[k] = (fees[k] ?? 0) + 1;
  }
  log('catalog', { status: r.status, bytes: r.bytes, ms: r.ms, total: rows.length, byTypeStatus, perpByQuote, feesByType: fees });
  log('perps', { list: perps.map(([id, m]) => `${id}:${m.status}:${m.underlying}:${m.quantity_increment}:${m.tick_size}:${m.max_initial_leverage ?? '-'}`) });
  return r.body;
}

async function ccxtMapping(symbols) {
  // CCXT 4.5.68 has no Changelly PRO class, and hitbtc speaks the same API v3, so the probe points hitbtc at this host.
  const ex = new ccxt.hitbtc({ id: 'changellypro', urls: { api: { public: API, private: API } } });
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.swap);
  const ids = new Set(Object.keys(symbols));
  log('ccxt_hitbtc_on_changelly', {
    version: ccxt.version,
    id: ex.id,
    publicUrl: ex.urls.api.public,
    ms: round(performance.now() - t0),
    markets: Object.keys(markets).length,
    swaps: swaps.length,
    swapsActive: swaps.filter((m) => m.active).length,
    idsInCatalog: swaps.filter((m) => ids.has(m.id)).length,
    expiredButActive: swaps.filter((m) => symbols[m.id]?.status !== 'working' && m.active).map((m) => m.id),
    contractSizes: [...new Set(swaps.map((m) => m.contractSize))],
    linear: [...new Set(swaps.map((m) => m.linear))],
    settle: [...new Set(swaps.map((m) => m.settle))],
    taker: [...new Set(swaps.map((m) => m.taker))],
    maker: [...new Set(swaps.map((m) => m.maker))],
    sample: swaps.slice(0, 2).map((m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, active: m.active, contractSize: m.contractSize })),
    pairsListedTwice: Object.entries(swaps.reduce((a, m) => ((a[`${m.base}/${m.quote}`] = (a[`${m.base}/${m.quote}`] ?? 0) + 1), a), {})).filter(([, n]) => n > 1),
  });
  const plain = new ccxt.hitbtc();
  log('ccxt_default_urls', { public: plain.urls.api.public, ws: 'see pro/hitbtc.js' });
}

async function futuresInfo() {
  const r = await get(`${API}/public/futures/info`);
  keep('futures-info.json', r.text);
  const rows = Object.entries(r.body);
  const nft = {};
  const fields = new Set();
  for (const [, v] of rows) {
    nft[v.next_funding_time] = (nft[v.next_funding_time] ?? 0) + 1;
    Object.keys(v).forEach((k) => fields.add(k));
  }
  log('futures_info', { status: r.status, bytes: r.bytes, ms: r.ms, rows: rows.length, fields: [...fields], nextFundingTime: nft, headers: limitHeaders(r.headers) });
  for (const [id, v] of rows) {
    const premPpm = Math.round((Number(v.mark_price) / Number(v.index_price) - 1) * 1e6);
    const ageMs = r.recvMs - Date.parse(v.timestamp);
    log('info_row', { id, mark: v.mark_price, index: v.index_price, markVsIndexPpm: premPpm, funding: v.funding_rate, indicative: v.indicative_funding_rate, premium: v.premium_index, avgPremium: v.avg_premium_index, interest: v.interest_rate, oi: v.open_interest, next: v.next_funding_time, ageMs });
  }
  const one = await get(`${API}/public/futures/info/BTCUSDT_PERP`);
  log('futures_info_one', { status: one.status, bytes: one.bytes, ms: one.ms, body: one.body });
  return r.body;
}

// Tests the fair basis form: mark = index * (1 + rate * time to next funding / 8 h), rounded to the tick, with rate either the last settled or the indicative one.
function markFormula(info, symbols) {
  const tally = { settled: 0, indicative: 0, neither: [] };
  for (const [id, v] of Object.entries(info)) {
    if (symbols[id]?.status !== 'working') continue;
    const tick = Number(symbols[id].tick_size);
    const tau = (Date.parse(v.next_funding_time) - Date.parse(v.timestamp)) / (8 * 3_600_000);
    const fit = (rate) => Math.abs(Number(v.index_price) * (1 + Number(rate) * tau) - Number(v.mark_price)) <= tick / 2 + 1e-12;
    if (fit(v.funding_rate)) tally.settled++;
    else if (fit(v.indicative_funding_rate)) tally.indicative++;
    else tally.neither.push(`${id} mark ${v.mark_price} index ${v.index_price} tau ${tau.toFixed(4)}`);
  }
  log('mark_formula', { rows: Object.keys(info).length - 1, ...tally });
}

async function fundingHistory(info) {
  const r = await get(`${API}/public/futures/history/funding?limit=3`);
  keep('funding-history.json', r.text);
  let equal = 0;
  let differ = [];
  for (const [id, hist] of Object.entries(r.body)) {
    if (hist.length === 0) continue;
    if (hist[0].funding_rate === info[id]?.funding_rate) equal++;
    else differ.push(`${id} hist ${hist[0].funding_rate} info ${info[id]?.funding_rate}`);
  }
  const btc = r.body.BTCUSDT_PERP ?? [];
  log('funding_history', { status: r.status, bytes: r.bytes, ms: r.ms, symbols: Object.keys(r.body).length, infoFundingEqualsLastSettled: equal, differ, btc: btc.map((h) => `${h.timestamp} ${h.funding_rate} next ${h.next_funding_time}`) });
}

// Tests rate = P + clamp(I - P, -0.05 %, +0.05 %) on every settled row of the last 30 days, and lists the rows it misses.
async function fundingFit() {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const r = await get(`${API}/public/futures/history/funding?limit=1000&from=${from}`);
  let rows = 0;
  let fit = 0;
  const misses = {};
  const hours = new Set();
  const gaps = {};
  let min = Infinity;
  let max = -Infinity;
  for (const [id, hist] of Object.entries(r.body)) {
    for (let i = 0; i < hist.length; i++) {
      const h = hist[i];
      const p = Number(h.avg_premium_index);
      const rate = Number(h.funding_rate);
      const pred = p + Math.max(-0.0005, Math.min(0.0005, Number(h.interest_rate) - p));
      rows++;
      if (Math.abs(pred - rate) < 1e-12) fit++;
      else misses[`${id} ${h.funding_rate}`] = (misses[`${id} ${h.funding_rate}`] ?? 0) + 1;
      min = Math.min(min, rate);
      max = Math.max(max, rate);
      hours.add(h.timestamp.slice(11, 16));
      if (i + 1 < hist.length) {
        const g = (Date.parse(h.next_funding_time) - Date.parse(hist[i + 1].next_funding_time)) / 3_600_000;
        gaps[g] = (gaps[g] ?? 0) + 1;
      }
    }
  }
  log('funding_fit', { status: r.status, bytes: r.bytes, ms: r.ms, from, symbols: Object.keys(r.body).length, rows, fit, misses, min, max, settleHoursUtc: [...hours].sort(), gapsHours: gaps });
  const negative = {};
  for (const [id, hist] of Object.entries(r.body)) {
    const rates = hist.map((h) => Number(h.funding_rate));
    const neg = rates.filter((x) => x < 0).length;
    if (neg > 0) negative[id] = { rows: rates.length, negative: neg, min: Math.min(...rates), max: Math.max(...rates) };
  }
  log('funding_negative', negative);
}

async function restBook() {
  for (const depth of [undefined, 0, 20, 5]) {
    const url = `${API}/public/orderbook/BTCUSDT_PERP${depth === undefined ? '' : `?depth=${depth}`}`;
    const r = await get(url);
    log('book', { depth: depth ?? 'default', status: r.status, bytes: r.bytes, ms: r.ms, bids: r.body.bid?.length, asks: r.body.ask?.length, bidsDesc: sortedDesc(r.body.bid ?? []), asksAsc: sortedAsc(r.body.ask ?? []), ts: r.body.timestamp, ageMs: r.recvMs - Date.parse(r.body.timestamp), top: [r.body.bid?.[0], r.body.ask?.[0]] });
    await sleep(300);
  }
  const quiet = await get(`${API}/public/orderbook/MANAUSDT_PERP?depth=0`);
  log('book_quiet', { status: quiet.status, bids: quiet.body.bid?.length, asks: quiet.body.ask?.length, ageMs: quiet.recvMs - Date.parse(quiet.body.timestamp), top: [quiet.body.bid?.[0], quiet.body.ask?.[0]] });
  const bulk = await get(`${API}/public/orderbook?symbols=${WATCH.join(',')}&depth=20`);
  log('book_bulk', { status: bulk.status, bytes: bulk.bytes, ms: bulk.ms, keys: Object.keys(bulk.body ?? {}), levels: Object.values(bulk.body ?? {}).map((b) => `${b.bid?.length}/${b.ask?.length}`) });
  const a = await get(`${API}/public/orderbook/BTCUSDT_PERP?depth=5`);
  const b = await get(`${API}/public/orderbook/BTCUSDT_PERP?depth=5`);
  log('book_cache', { firstTs: a.body.timestamp, secondTs: b.body.timestamp, cfCache: b.headers.get('cf-cache-status'), cacheControl: b.headers.get('cache-control') });
  const vol = await get(`${API}/public/orderbook/BTCUSDT_PERP?volume=1`);
  log('book_volume', { status: vol.status, bids: vol.body.bid?.length, asks: vol.body.ask?.length });
}

async function errors() {
  const urls = [
    `${API}/public/symbol/NOPE_PERP`,
    `${API}/public/orderbook/NOPE_PERP`,
    `${API}/public/orderbook/BTCUSDT_PERP?depth=abc`,
    `${API}/public/futures/info/NOPE_PERP`,
    `${API}/public/futures/info/BTCUSDT`,
    `${API}/public/nope`,
    `${API}/public/time`,
  ];
  for (const u of urls) {
    const r = await get(u);
    log('error_shape', { url: u.replace(API, ''), status: r.status, body: r.body ?? r.text.slice(0, 120), headers: limitHeaders(r.headers) });
    await sleep(300);
  }
}

async function clock() {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/public/futures/info/BTCUSDT_PERP`);
    const mid = (t0 + r.recvMs) / 2;
    offsets.push({ rttMs: r.recvMs - t0, bodyTsMinusMid: Date.parse(r.body.timestamp) - mid, dateHeader: r.headers.get('date') });
    await sleep(300);
  }
  log('clock', { samples: offsets });
}

async function main() {
  await hostAndLatency();
  const symbols = await catalog();
  await ccxtMapping(symbols);
  const info = await futuresInfo();
  markFormula(info, symbols);
  await fundingHistory(info);
  await fundingFit();
  await restBook();
  await errors();
  await clock();
}

async function poll() {
  const times = [];
  const bytes = [];
  const ages = [];
  const last = new Map();
  const changes = new Map();
  const fields = ['index_price', 'mark_price', 'indicative_funding_rate', 'funding_rate', 'premium_index', 'timestamp', 'next_funding_time'];
  let statuses = {};
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    const r = await get(`${API}/public/futures/info`);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    times.push(r.ms);
    bytes.push(r.bytes);
    if (r.status === 200) {
      for (const [id, v] of Object.entries(r.body)) {
        if (id === 'LUNAUSDT_PERP') continue;
        const age = r.recvMs - Date.parse(v.timestamp);
        ages.push(age);
        const prev = last.get(id);
        const c = changes.get(id) ?? { ...Object.fromEntries(fields.map((f) => [f, 0])), maxAgeMs: 0 };
        c.maxAgeMs = Math.max(c.maxAgeMs, age);
        if (prev) for (const f of fields) if (prev[f] !== v[f]) c[f]++;
        changes.set(id, c);
        last.set(id, v);
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  log('poll', { statuses, ms: stats(times), bytes: stats(bytes), ageMs: stats(ages) });
  for (const [id, c] of changes) log('poll_changes', { id, ...c });
}

async function mirror() {
  for (const sym of ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'MANAUSDT_PERP', 'BTCUSDT']) {
    const [a, b] = await Promise.all([get(`${API}/public/trades/${sym}?limit=5`), get(`${HITBTC}/public/trades/${sym}?limit=5`)]);
    const ida = (a.body ?? []).map((t) => t.id).join(',');
    const idb = (b.body ?? []).map((t) => t.id).join(',');
    const [c, d] = await Promise.all([get(`${API}/public/orderbook/${sym}?depth=5`), get(`${HITBTC}/public/orderbook/${sym}?depth=5`)]);
    const top = (x) => JSON.stringify([x.body?.bid?.slice(0, 5), x.body?.ask?.slice(0, 5)]);
    log('mirror', { sym, changellyStatus: a.status, hitbtcStatus: b.status, tradeIdsEqual: ida === idb, tradeIds: ida, book5Equal: top(c) === top(d), bookTs: [c.body?.timestamp, d.body?.timestamp] });
    await sleep(600);
  }
  const [e, f] = await Promise.all([get(`${API}/public/futures/info`), get(`${HITBTC}/public/futures/info`)]);
  let oiEqual = 0;
  let compared = 0;
  let sameTs = 0;
  let anchorEqualAtSameTs = 0;
  for (const [id, v] of Object.entries(e.body)) {
    if (!f.body[id]) continue;
    compared++;
    if (v.open_interest === f.body[id].open_interest) oiEqual++;
    if (v.timestamp === f.body[id].timestamp) {
      sameTs++;
      if (v.index_price === f.body[id].index_price && v.mark_price === f.body[id].mark_price) anchorEqualAtSameTs++;
    }
  }
  const [g, h] = await Promise.all([get(`${API}/public/symbol`), get(`${HITBTC}/public/symbol`)]);
  const perpsHere = Object.entries(g.body).filter(([, m]) => m.type === 'futures').map(([id]) => id);
  const perpsThere = Object.entries(h.body).filter(([, m]) => m.type === 'futures');
  log('mirror_catalog', {
    changellySymbols: Object.keys(g.body).length,
    hitbtcSymbols: Object.keys(h.body).length,
    changellyPerps: perpsHere.length,
    hitbtcPerpsByStatus: perpsThere.reduce((a, [, m]) => ((a[m.status] = (a[m.status] ?? 0) + 1), a), {}),
    changellyPerpsMissingOnHitbtc: perpsHere.filter((id) => !h.body[id]),
    openInterestEqual: `${oiEqual} of ${compared}`,
    futuresInfoSameTimestamp: `${sameTs} of ${compared}`,
    indexAndMarkEqualWhereSameTimestamp: `${anchorEqualAtSameTs} of ${sameTs}`,
    hitbtcPerpFee: `${h.body.BTCUSDT_PERP?.take_rate}/${h.body.BTCUSDT_PERP?.make_rate}`,
    changellyPerpFee: `${g.body.BTCUSDT_PERP?.take_rate}/${g.body.BTCUSDT_PERP?.make_rate}`,
  });
}

const mode = process.argv[2] ?? 'main';
if (mode === 'main' || mode === 'all') await main();
if (mode === 'poll' || mode === 'all') await poll();
if (mode === 'mirror' || mode === 'all') await mirror();
