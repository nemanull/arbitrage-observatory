// Globe public REST probe: host and latency, the contracts catalog, the bulk anchor reply and how often its numbers change, the REST book, candles, errors and the Date header offset.
// Public, unauthenticated, read-only. Globe publishes a limit of 1 REST request per second, so every mode waits at least 1.2 s between requests and the anchor poll runs every 2 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/globe/rest-probe.mjs [catalog|anchor|book|history|errors]
//   catalog  DNS, one cold and five warm reads of /ticker/contracts, headers, the catalog by status and type, /ticker/pairs, premium and funding per contract. About 10 s.
//   anchor   /ticker/contracts every 2 s for 60 s: reply time and size, and how often index, mark, funding rate and next funding time change.
//   book     /ticker/orderbook and /ticker for a busy, a quiet, a suspended, a spot and an unknown instrument. About 12 s.
//   history  index and trade candles for BTC-PERP at 1m and 8h resolution. About 6 s.
//   errors   unknown instrument, missing parameter and unknown path. About 6 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/globe/rest.md.
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOST = 'globe.exchange';
const API = `https://${HOST}/api/v1`;
const OUT = process.env.PROBE_OUT_DIR;
const GAP_MS = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const HEADERS = ['content-type', 'content-length', 'content-encoding', 'cache-control', 'cf-cache-status', 'age', 'server', 'cf-ray', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'ratelimit-limit', 'ratelimit-remaining'];
const offsets = [];

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const t0 = performance.now();
  const sent = Date.now();
  const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
  const ttfbMs = performance.now() - t0;
  const text = await res.text();
  const totalMs = performance.now() - t0;
  const recv = Date.now();
  const date = res.headers.get('date');
  if (date) offsets.push((sent + recv) / 2 - Date.parse(date));
  const headers = {};
  for (const h of HEADERS) if (res.headers.get(h) !== null) headers[h] = res.headers.get(h);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { url, status: res.status, ttfbMs: Math.round(ttfbMs), totalMs: Math.round(totalMs), bytes: text.length, headers, text, json };
}

function logOffsets() {
  log('date_header_offset_ms', { n: offsets.length, min: q(offsets, 0), median: q(offsets, 0.5), max: q(offsets, 1), note: 'local midpoint minus the 1 s resolution Date header, so values fall between 0 and 1000 when the clocks agree' });
}

async function catalogMode() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addresses: addrs.map((a) => a.address) });
  const cold = await get('/ticker/contracts');
  log('cold', { status: cold.status, ttfbMs: cold.ttfbMs, totalMs: cold.totalMs, bytes: cold.bytes, headers: cold.headers });
  save('contracts.json', cold.text);
  const warm = [];
  for (let i = 0; i < 5; i++) {
    await sleep(GAP_MS);
    const r = await get('/ticker/contracts');
    warm.push(r.totalMs);
  }
  log('warm', { totalMs: warm });
  const rows = cold.json;
  const count = (f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  log('catalog', {
    rows: rows.length,
    byProductType: count((r) => r.product_type), byStatus: count((r) => r.product_status), byQuote: count((r) => r.quote_symbol),
    byContractType: count((r) => r.contract_type), byContractPriceCurrency: count((r) => r.contract_price_currency),
    byNextFunding: count((r) => new Date(r.next_funding_time).toISOString()), earlyAccess: count((r) => String(r.early_access)),
    fields: Object.keys(rows[0]),
    baseTwice: Object.entries(count((r) => r.base_symbol)).filter(([, n]) => n > 1),
  });
  for (const r of rows) {
    const premPpm = r.index_price ? Math.round(((r.mark_price - r.index_price) / r.index_price) * 1e6) : null;
    console.log(`${r.instrument} ${r.product_status} contract_price=${r.contract_price} base_increment=${r.base_increment} quote_increment=${r.quote_increment} funding_rate=${r.funding_rate} mark=${r.mark_price} index=${r.index_price} premium_ppm=${premPpm} bid=${r.best_bid?.price}x${r.best_bid?.volume} ask=${r.best_ask?.price}x${r.best_ask?.volume} quote_volume=${Math.round(r.quote_volume)} max_leverage=${r.max_leverage}`);
  }
  await sleep(GAP_MS);
  const pairs = await get('/ticker/pairs');
  log('pairs', { status: pairs.status, ms: pairs.totalMs, bytes: pairs.bytes, rows: Array.isArray(pairs.json) ? pairs.json.map((p) => `${p.instrument} ${p.product_type} vol=${Math.round(p.quote_volume)}`) : pairs.text.slice(0, 200) });
  logOffsets();
}

async function anchorMode() {
  const polls = [];
  const track = new Map();
  const t0 = Date.now();
  for (let i = 0; i < 31; i++) {
    const due = t0 + i * 2000;
    if (Date.now() < due) await sleep(due - Date.now());
    const r = await get('/ticker/contracts');
    polls.push({ ms: r.totalMs, ttfb: r.ttfbMs, bytes: r.bytes, status: r.status, cache: r.headers['cf-cache-status'] ?? null });
    if (r.status !== 200) continue;
    for (const c of r.json) {
      let t = track.get(c.instrument);
      if (!t) { t = { prev: null, changes: { index_price: 0, mark_price: 0, funding_rate: 0, next_funding_time: 0 }, n: 0, maxPremPpm: 0 }; track.set(c.instrument, t); }
      t.n++;
      if (t.prev) for (const f of Object.keys(t.changes)) if (c[f] !== t.prev[f]) t.changes[f]++;
      t.prev = c;
      if (c.index_price) t.maxPremPpm = Math.max(t.maxPremPpm, Math.abs(Math.round(((c.mark_price - c.index_price) / c.index_price) * 1e6)));
    }
  }
  const ms = polls.map((p) => p.ms);
  log('anchor_polls', { n: polls.length, statuses: [...new Set(polls.map((p) => p.status))], cache: [...new Set(polls.map((p) => p.cache))], bytesMin: q(polls.map((p) => p.bytes), 0), bytesMax: q(polls.map((p) => p.bytes), 1), msMin: q(ms, 0), msMed: q(ms, 0.5), msP90: q(ms, 0.9), msMax: q(ms, 1), over1s: ms.filter((x) => x > 1000).length, over2s: ms.filter((x) => x > 2000).length });
  for (const [inst, t] of track) console.log(`${inst} polls=${t.n} index_changes=${t.changes.index_price} mark_changes=${t.changes.mark_price} funding_changes=${t.changes.funding_rate} next_funding_changes=${t.changes.next_funding_time} max_abs_premium_ppm=${t.maxPremPpm}`);
  logOffsets();
}

async function bookMode() {
  const cases = ['BTC-PERP', 'XLM-PERP', 'IOTA-PERP', 'BTC/USDT', 'NOPE-PERP'];
  for (const inst of cases) {
    const r = await get(`/ticker/orderbook?instrument=${encodeURIComponent(inst)}`);
    const j = r.json;
    if (r.status === 200 && j && Array.isArray(j.bids)) {
      const desc = j.bids.every((l, i) => i === 0 || j.bids[i - 1][0] > l[0]);
      const asc = j.asks.every((l, i) => i === 0 || j.asks[i - 1][0] < l[0]);
      const zero = (side) => side.filter((l) => l[0] === 0 && l[1] === 0).length;
      const nz = (side) => side.filter((l) => !(l[0] === 0 && l[1] === 0));
      const nzb = nz(j.bids);
      const nza = nz(j.asks);
      const descNz = nzb.every((l, i) => i === 0 || nzb[i - 1][0] > l[0]);
      const ascNz = nza.every((l, i) => i === 0 || nza[i - 1][0] < l[0]);
      log('orderbook', { inst, status: r.status, ms: r.totalMs, bytes: r.bytes, headers: r.headers, keys: Object.keys(j), lastUpdatedAt: j.last_updated_at ?? null, ageMs: typeof j.last_updated_at === 'number' ? Date.now() - j.last_updated_at : null, bidLevels: j.bids.length, askLevels: j.asks.length, zeroBids: zero(j.bids), zeroAsks: zero(j.asks), bidsDescending: desc, asksAscending: asc, nonZeroBidsDescending: descNz, nonZeroAsksAscending: ascNz, top: { bids: j.bids.slice(0, 3), asks: j.asks.slice(0, 3) }, tail: { bids: j.bids.slice(-2), asks: j.asks.slice(-2) } });
    } else {
      log('orderbook', { inst, status: r.status, ms: r.totalMs, body: r.text.slice(0, 300) });
    }
    await sleep(GAP_MS);
  }
  const t = await get('/ticker?instrument=BTC-PERP');
  log('ticker_one', { status: t.status, ms: t.totalMs, bytes: t.bytes, body: t.text.slice(0, 900) });
  await sleep(GAP_MS);
  logOffsets();
}

async function historyMode() {
  const paths = ['/history/index-price/BTC-PERP/candles/1m', '/history/BTC-PERP/candles/1m', '/history/index-price/BTC-PERP/candles/8h'];
  for (const p of paths) {
    const r = await get(p);
    const j = r.json;
    if (Array.isArray(j)) {
      const times = j.map((c) => c.time).filter((x) => x !== undefined);
      const newestFirst = times.length > 1 && times[0] > times[times.length - 1];
      log('history', { path: p, status: r.status, ms: r.totalMs, bytes: r.bytes, rows: j.length, keys: j[0] ? Object.keys(j[0]) : [], newestFirst, firstTime: times.length ? new Date(Math.min(...times)).toISOString() : null, lastTime: times.length ? new Date(Math.max(...times)).toISOString() : null, newest: newestFirst ? j[0] : j[j.length - 1] });
    } else {
      log('history', { path: p, status: r.status, ms: r.totalMs, body: r.text.slice(0, 300) });
    }
    await sleep(GAP_MS);
  }
  logOffsets();
}

async function errorsMode() {
  const paths = ['/ticker?instrument=NOPE-PERP', '/ticker', '/ticker/orderbook', '/nope', '/history/NOPE-PERP/candles/1m'];
  for (const p of paths) {
    const r = await get(p);
    log('error_case', { path: p, status: r.status, ms: r.totalMs, contentType: r.headers['content-type'] ?? null, body: r.text.slice(0, 300) });
    await sleep(GAP_MS);
  }
  logOffsets();
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog: catalogMode, anchor: anchorMode, book: bookMode, history: historyMode, errors: errorsMode };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
