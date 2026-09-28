// Mandala Exchange REST probe: catalog, CCXT hitbtc class pointed at the Mandala host, bulk futures info anchor, funding history, book snapshot, errors, clock.
// Public, unauthenticated, read-only. At most one request per second in the poll mode, far below the documented 30 per second on /public/*.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/mandala/rest-probe.mjs [catalog|anchor|poll|book|errors|grid|all]
//   catalog  /public/symbol summary, and CCXT 4.5.68 hitbtc loadMarkets with urls.api overridden to the Mandala host.
//   anchor   /public/futures/info bulk reply, fields, symbol match, and /public/futures/history/funding interval.
//   poll     60 one second polls of /public/futures/info, counting how often mark, index and funding change.
//   book     /public/orderbook/{symbol} at depth 20, level order, timestamp age, back to back caching.
//   errors   unknown symbol replies, rate limit headers, and the Date header against the local clock.
//   grid     perpetual 24 hour quote volume and touch spread from /public/ticker, then ten futures info readings one second apart.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/mandala/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Loads a package the way the engine does, through server/package.json, falling back to old_ts_server/ and the root pnpm store while the server is being moved.
function load(name) {
  for (const base of ['../../../../server/package.json', '../../../../old_ts_server/package.json', '../../../../package.json']) {
    try { return createRequire(new URL(base, import.meta.url))(name); } catch {}
  }
  const store = { ccxt: 'ccxt@4.5.68_protobufjs@7.6.6', ws: 'ws@8.21.1_bufferutil@4.1.0' }[name];
  return createRequire(new URL(`../../../../node_modules/.pnpm/${store}/node_modules/${name}/package.json`, import.meta.url))(name);
}
const ccxt = load('ccxt');

const HOST = 'https://api.trade.mandala.exchange';
const API = `${HOST}/api/3/public`;
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
  const body = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try { json = JSON.parse(body); } catch { json = undefined; }
  return { status: res.status, ms, bytes: body.length, body, json, headers: res.headers };
}

async function catalog() {
  const r = await get('/symbol');
  keep('symbol.json', r.body);
  const all = Object.entries(r.json);
  const counts = {};
  for (const [, s] of all) {
    const k = `${s.type}|${s.contract_type ?? ''}|${s.quote_currency}|${s.status}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const perps = all.filter(([, s]) => s.type === 'futures');
  const rates = {};
  for (const [, s] of perps) rates[`${s.take_rate}/${s.make_rate}/${s.fee_currency}`] = (rates[`${s.take_rate}/${s.make_rate}/${s.fee_currency}`] ?? 0) + 1;
  log('catalog', { status: r.status, ms: r.ms, bytes: r.bytes, symbols: all.length, counts, perpTakeMake: rates });
  log('perps', { ids: perps.map(([id]) => id) });
  log('perp_sample', { id: perps[0][0], ...perps[0][1] });

  const ex = new ccxt.hitbtc({ urls: { api: { public: `${HOST}/api/3`, private: `${HOST}/api/3` } } });
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.swap);
  const active = swaps.filter((m) => m.active);
  const m = swaps.find((x) => x.id === 'BTCUSDT_PERP') ?? swaps[0];
  log('ccxt_hitbtc_override', {
    ccxt: ccxt.version, ms: Math.round(performance.now() - t0), markets: Object.keys(markets).length, swaps: swaps.length, activeSwaps: active.length,
    sample: { id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, active: m.active },
    takers: [...new Set(swaps.map((x) => x.taker))],
    contractSizes: [...new Set(swaps.map((x) => x.contractSize))],
    duplicateBases: Object.entries(swaps.reduce((a, x) => ((a[x.base] = (a[x.base] ?? 0) + 1), a), {})).filter(([, n]) => n > 1),
  });
}

async function anchor() {
  const cold = await get('/futures/info');
  const warm = await get('/futures/info');
  keep('futures-info.json', warm.body);
  const rows = Object.entries(warm.json);
  const types = {};
  for (const [, x] of rows) types[x.contract_type] = (types[x.contract_type] ?? 0) + 1;
  const [id, x] = rows.find(([k]) => k === 'BTCUSDT_PERP') ?? rows[0];
  log('futures_info', { status: warm.status, coldMs: cold.ms, warmMs: warm.ms, bytes: warm.bytes, rows: rows.length, types, sampleId: id, sample: x });
  const sym = await get('/symbol');
  const perpIds = Object.entries(sym.json).filter(([, s]) => s.type === 'futures').map(([k]) => k);
  const infoIds = new Set(rows.map(([k]) => k));
  log('id_match', { perps: perpIds.length, inInfo: perpIds.filter((k) => infoIds.has(k)).length, missing: perpIds.filter((k) => !infoIds.has(k)) });
  const now = Date.now();
  const nexts = [...new Set(rows.map(([, r]) => r.next_funding_time))];
  log('next_funding', { values: nexts, minutesAhead: nexts.map((t) => Math.round((Date.parse(t) - now) / 60000)) });
  const rateSpread = rows.map(([k, r]) => [k, r.funding_rate, r.indicative_funding_rate, r.interest_rate]).slice(0, 6);
  log('funding_fields', { first6: rateSpread });

  const h = await get('/futures/history/funding?symbols=BTCUSDT_PERP,ETHUSDT_PERP&limit=6');
  keep('funding-history.json', h.body);
  const out = {};
  for (const [k, list] of Object.entries(h.json ?? {})) {
    const ts = list.map((e) => Date.parse(e.timestamp));
    out[k] = { n: list.length, first: list[0], gapsHours: ts.slice(1).map((t, i) => (ts[i] - t) / 3600000) };
  }
  log('funding_history', { status: h.status, ms: h.ms, out });
}

async function poll() {
  const last = new Map();
  const changes = {};
  const times = [];
  let tsAges = [];
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const r = await get('/futures/info');
    times.push(r.ms);
    for (const [k, x] of Object.entries(r.json ?? {})) {
      const prev = last.get(k);
      const c = (changes[k] ??= { mark: 0, index: 0, fr: 0, ifr: 0, next: 0 });
      if (prev) {
        if (prev.mark_price !== x.mark_price) c.mark++;
        if (prev.index_price !== x.index_price) c.index++;
        if (prev.funding_rate !== x.funding_rate) c.fr++;
        if (prev.indicative_funding_rate !== x.indicative_funding_rate) c.ifr++;
        if (prev.next_funding_time !== x.next_funding_time) c.next++;
      }
      last.set(k, x);
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  times.sort((a, b) => a - b);
  const pick = (k) => changes[k];
  const marks = Object.values(changes).map((c) => c.mark).sort((a, b) => a - b);
  const idx = Object.values(changes).map((c) => c.index).sort((a, b) => a - b);
  log('poll', { polls: 60, msMin: times[0], msMedian: times[30], msMax: times[59], BTC: pick('BTCUSDT_PERP'), ETH: pick('ETHUSDT_PERP'), markChangesMinMedMax: [marks[0], marks[marks.length >> 1], marks.at(-1)], indexChangesMinMedMax: [idx[0], idx[idx.length >> 1], idx.at(-1)] });
  log('poll_per_symbol', changes);
}

async function book() {
  for (const s of ['BTCUSDT_PERP', 'SUIUSDT_PERP']) {
    const a = await get(`/orderbook/${s}?depth=20`);
    const b = await get(`/orderbook/${s}?depth=20`);
    const j = a.json;
    if (!j || !j.bid) { log('book', { s, status: a.status, body: a.body.slice(0, 200) }); continue; }
    const bids = j.bid.map((l) => +l[0]);
    const asks = j.ask.map((l) => +l[0]);
    log('book', {
      s, status: a.status, ms: a.ms, bytes: a.bytes, bidLevels: bids.length, askLevels: asks.length,
      bidsDescending: bids.every((p, i) => i === 0 || p < bids[i - 1]), asksAscending: asks.every((p, i) => i === 0 || p > asks[i - 1]),
      top: { bid: j.bid[0], ask: j.ask[0] }, timestamp: j.timestamp, ageMs: Date.now() - Date.parse(j.timestamp), secondSameTimestamp: b.json?.timestamp === j.timestamp,
      cacheHeaders: { cf: a.headers.get('cf-cache-status'), cc: a.headers.get('cache-control') },
    });
  }
  const full = await get('/orderbook/BTCUSDT_PERP?depth=0');
  log('book_full', { status: full.status, ms: full.ms, bytes: full.bytes, bid: full.json?.bid?.length, ask: full.json?.ask?.length });
}

async function errors() {
  for (const p of ['/futures/info/NOPEUSDT_PERP', '/orderbook/NOPEUSDT_PERP', '/symbol/NOPE', '/futures/info?symbols=NOPE']) {
    const r = await get(p);
    log('error_shape', { path: p, status: r.status, ms: r.ms, body: r.body.slice(0, 240) });
  }
  const r = await get('/ticker/BTCUSDT_PERP');
  const hdr = {};
  for (const [k, v] of r.headers) if (/rate|limit|retry|date|server|cf-ray|age|cache/i.test(k)) hdr[k] = v;
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const x = await get('/ticker/BTCUSDT_PERP');
    const t1 = Date.now();
    offsets.push({ dateHeader: x.headers.get('date'), localMid: new Date((t0 + t1) / 2).toISOString(), tickerTs: x.json?.timestamp });
    await sleep(1100);
  }
  log('headers', { status: r.status, hdr });
  log('clock', { offsets });
}

async function grid() {
  const t = await get('/ticker');
  const perps = Object.entries(t.json).filter(([k]) => k.endsWith('_PERP'))
    .map(([k, x]) => [k, Math.round(+x.volume_quote), x.bid && x.ask ? Math.round((x.ask / x.bid - 1) * 1e6) : null])
    .sort((a, b) => b[1] - a[1]);
  log('ticker_perps', { volumeQuoteSum: perps.reduce((a, x) => a + x[1], 0), rows: perps, btc: t.json.BTCUSDT_PERP });
  for (let i = 0; i < 10; i++) {
    const r = await get('/futures/info');
    const b = r.json.BTCUSDT_PERP;
    const m = r.json.MANAUSDT_PERP;
    log('grid', { local: new Date().toISOString().slice(11, 23), ts: b.timestamp.slice(11, 23), mark: b.mark_price, index: b.index_price, markOverIndexPpm: +((b.mark_price / b.index_price - 1) * 1e6).toFixed(1), premium: b.premium_index, mana: [m.funding_rate, m.indicative_funding_rate] });
    await sleep(1000);
  }
}

const mode = process.argv[2] ?? 'all';
const plan = { catalog, anchor, poll, book, errors, grid };
for (const [k, f] of Object.entries(plan)) {
  if (mode === 'all' ? k !== 'poll' && k !== 'grid' : mode === k) {
    try { await f(); } catch (e) { log('fail', { mode: k, error: String(e) }); }
  }
}
