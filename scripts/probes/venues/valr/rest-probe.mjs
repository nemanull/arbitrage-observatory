// VALR REST probe: host and latency, clock offset, catalog, anchor fields and their cadence, REST book, caching and error shapes.
// Public, unauthenticated, read-only. No API key is sent.
// VALR documents /v1/public/* at 30 requests a minute per IP, so calls on that route are spaced 3 s or more apart, about 20 a minute at most.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/valr/rest-probe.mjs [catalog|anchor|errors]
//   catalog  DNS, /v1/public/time cold and warm, pairs, futures info, market summary, the four REST books, funding history. About 45 s.
//   anchor   one call every 4 s for 120 s, two market summaries then one futures info, and how often each anchor number changes.
//   errors   unknown and inactive pairs, and the Perps v1 routes without a key. About 25 s.
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/valr/rest.md.
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.valr.com';
const PERPS = ['BTCUSDTPERP', 'ETHUSDTPERP', 'XRPUSDTPERP', 'SOLUSDTPERP'];
let publicSpacingMs = 3_000; // anchor mode widens it to 4 s
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let lastPublic = 0;

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name.replace(/[^A-Za-z0-9_.-]+/g, '_')), text);
}

// Every /v1/public/* call except time and status shares the 30 a minute budget, so it waits its turn.
async function get(path, { spaced = true } = {}) {
  if (spaced) {
    const wait = lastPublic + publicSpacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastPublic = Date.now();
  }
  const sent = Date.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Date.now() - sent;
  const h = (k) => res.headers.get(k);
  keep(path, text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, json, text, sent, arrived: Date.now(), cache: h('cache-control'), age: h('age'), upstreamMs: h('x-valr-upstream-service-time'), retryAfter: h('retry-after'), date: h('date') };
}

const isDesc = (lv) => lv.every((x, i) => i === 0 || Number(lv[i - 1].price) > Number(x.price));
const isAsc = (lv) => lv.every((x, i) => i === 0 || Number(lv[i - 1].price) < Number(x.price));

async function catalog() {
  const addrs = await lookup('api.valr.com', { all: true });
  log('dns', { host: 'api.valr.com', addrs: addrs.map((a) => a.address) });

  const times = [];
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/v1/public/time', { spaced: false });
    times.push(r.ms);
    const server = Date.parse(r.json.time);
    offsets.push(server - (r.sent + r.arrived) / 2);
    if (i === 0) log('time_reply', { body: r.text });
    await sleep(300);
  }
  log('time', { coldMs: times[0], warmMs: times.slice(1), clockOffsetMs: offsets.map((x) => Math.round(x)) });

  const status = await get('/v1/public/status', { spaced: false });
  log('status', { status: status.status, body: status.text.slice(0, 100) });

  const pairs = await get('/v1/public/pairs');
  const byType = {};
  for (const p of pairs.json) {
    const k = `${p.currencyPairType}/${p.active ? 'active' : 'inactive'}`;
    byType[k] = (byType[k] ?? 0) + 1;
  }
  const futures = pairs.json.filter((p) => p.currencyPairType === 'FUTURE');
  const active = futures.filter((p) => p.active);
  const byQuote = {};
  for (const p of active) byQuote[p.quoteCurrency] = (byQuote[p.quoteCurrency] ?? 0) + 1;
  const twice = Object.entries(active.reduce((m, p) => ((m[`${p.baseCurrency}/${p.quoteCurrency}`] = (m[`${p.baseCurrency}/${p.quoteCurrency}`] ?? 0) + 1), m), {})).filter(([, n]) => n > 1);
  log('pairs', { status: pairs.status, ms: pairs.ms, bytes: pairs.bytes, cache: pairs.cache, total: pairs.json.length, byType, activeFutureByQuote: byQuote, listedTwice: twice, inactiveFutures: futures.filter((p) => !p.active).map((p) => p.symbol) });
  for (const p of active) log('perp', { symbol: p.symbol, base: p.baseCurrency, quote: p.quoteCurrency, tick: p.tickSize, minBase: p.minBaseAmount, maxBase: p.maxBaseAmount, baseDp: p.baseDecimalPlaces, imf: p.initialMarginFraction, mmf: p.maintenanceMarginFraction });

  const byTypeCall = await get('/v1/public/pairs/FUTURE');
  log('pairs_future', { status: byTypeCall.status, ms: byTypeCall.ms, rows: Array.isArray(byTypeCall.json) ? byTypeCall.json.length : byTypeCall.text.slice(0, 200), active: Array.isArray(byTypeCall.json) ? byTypeCall.json.filter((p) => p.active).length : null });

  const info = await get('/v1/public/futures/info');
  log('futures_info', { status: info.status, ms: info.ms, upstreamMs: info.upstreamMs, bytes: info.bytes, cache: info.cache, age: info.age, rows: info.json.length, keys: Object.keys(info.json[0] ?? {}), symbols: info.json.map((r) => r.currencyPair), matchesActive: info.json.every((r) => active.some((p) => p.symbol === r.currencyPair)) && active.every((p) => info.json.some((r) => r.currencyPair === p.symbol)) });
  for (const r of info.json) log('futures_info_row', r);

  const summary = await get('/v1/public/marketsummary');
  const perpRows = summary.json.filter((r) => r.currencyPair.endsWith('PERP'));
  log('marketsummary', { status: summary.status, ms: summary.ms, upstreamMs: summary.upstreamMs, bytes: summary.bytes, cache: summary.cache, age: summary.age, rows: summary.json.length, perpRows: perpRows.length, keys: Object.keys(perpRows[0] ?? {}), createdAgeMs: perpRows.map((r) => summary.arrived - Date.parse(r.created)) });

  for (const pair of PERPS) {
    const b = await get(`/v1/public/${pair}/orderbook`);
    const bids = b.json.Bids ?? [];
    const asks = b.json.Asks ?? [];
    log('orderbook', { pair, status: b.status, ms: b.ms, upstreamMs: b.upstreamMs, bytes: b.bytes, cache: b.cache, age: b.age, bids: bids.length, asks: asks.length, bidsDesc: isDesc(bids), asksAsc: isAsc(asks), top: [bids[0], asks[0]].map((l) => l && [l.price, l.quantity, l.orderCount]), lastChangeAgeMs: b.arrived - Date.parse(b.json.LastChange), seq: b.json.SequenceNumber, keys: Object.keys(b.json) });
  }

  const full = await get('/v1/public/BTCUSDTPERP/orderbook/full');
  log('orderbook_full', { status: full.status, ms: full.ms, bytes: full.bytes, cache: full.cache, bids: full.json.Bids?.length, asks: full.json.Asks?.length, firstBid: full.json.Bids?.[0], keys: Object.keys(full.json) });

  for (const pair of PERPS) {
    const h = await get(`/v1/public/futures/funding/history?currencyPair=${pair}`);
    const rows = h.json;
    const steps = rows.slice(1).map((r, i) => (Date.parse(rows[i].fundingTime) - Date.parse(r.fundingTime)) / 3_600_000);
    const stepCounts = steps.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
    const rates = rows.map((r) => Number(r.fundingRate));
    const infoRow = info.json.find((r) => r.currencyPair === pair);
    log('funding_history', { pair, status: h.status, ms: h.ms, cache: h.cache, rows: rows.length, newest: rows[0], oldest: rows[rows.length - 1]?.fundingTime, stepHours: stepCounts, minRate: Math.min(...rates), maxRate: Math.max(...rates), zeroRows: rates.filter((x) => x === 0).length, estimatedNow: infoRow?.estimatedFundingRate });
  }
}

async function anchor() {
  publicSpacingMs = 4_000;
  const started = Date.now();
  const marks = new Map(PERPS.map((p) => [p, []]));
  const funding = new Map(PERPS.map((p) => [p, []]));
  const summaryTimes = [];
  const infoTimes = [];
  const upstream = [];
  const ages = new Set();
  const createdAge = [];
  let n = 0;
  while (Date.now() - started < 120_000) {
    if (n % 3 === 2) {
      const info = await get('/v1/public/futures/info');
      infoTimes.push(info.ms);
      upstream.push(['info', Number(info.upstreamMs)]);
      if (info.age !== null) ages.add(`info:${info.age}`);
      for (const r of info.json) funding.get(r.currencyPair)?.push(`${r.estimatedFundingRate}@${r.nextFundingRun}`);
      n++;
      continue;
    }
    const s = await get('/v1/public/marketsummary');
    summaryTimes.push(s.ms);
    upstream.push(['summary', Number(s.upstreamMs)]);
    if (s.age !== null) ages.add(`summary:${s.age}`);
    for (const r of s.json) {
      if (!marks.has(r.currencyPair)) continue;
      marks.get(r.currencyPair).push(r.markPrice);
      createdAge.push(s.arrived - Date.parse(r.created));
    }
    n++;
  }
  const st = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
  };
  log('anchor_timing', { seconds: (Date.now() - started) / 1000, summaryMs: st(summaryTimes), infoMs: st(infoTimes), infoUpstreamMs: st(upstream.filter(([k]) => k === 'info').map(([, v]) => v)), summaryUpstreamMs: st(upstream.filter(([k]) => k === 'summary').map(([, v]) => v)), ageHeaders: [...ages].slice(0, 10), summaryCreatedAgeMs: st(createdAge) });
  for (const p of PERPS) {
    const m = marks.get(p);
    const changes = m.slice(1).filter((x, i) => x !== m[i]).length;
    const f = funding.get(p);
    const fChanges = f.slice(1).filter((x, i) => x !== f[i]).length;
    log('anchor_changes', { pair: p, summaryPolls: m.length, markChanges: changes, distinctMarks: new Set(m).size, infoPolls: f.length, fundingChanges: fChanges, fundingValues: [...new Set(f)].slice(0, 6) });
  }
}

async function errors() {
  const cases = [
    '/v1/public/NOPEUSDTPERP/orderbook',
    '/v1/public/DOGEUSDTPERP/orderbook',
    '/v1/public/DOGEUSDTPERP/marketsummary',
    '/v1/public/futures/funding/history?currencyPair=NOPEUSDTPERP',
    '/v1/public/pairs/NOPE',
  ];
  for (const path of cases) {
    const r = await get(path);
    log('error_case', { path, status: r.status, ms: r.ms, cache: r.cache, retryAfter: r.retryAfter, body: r.text.slice(0, 240) });
  }
  for (const path of ['/v1/perps/status', '/v1/perps/pairs', '/v1/perps/mark-prices?pairs=BTCUSDC', '/v1/perps/orderbook/BTCUSDC']) {
    const r = await get(path, { spaced: false });
    log('perps_unauthenticated', { path, status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
    await sleep(500);
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
