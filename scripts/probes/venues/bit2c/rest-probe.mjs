// Bit2c public REST probe: host latency, the CCXT catalog and fee constants, every pair code the site names, book shape and level order, cache behaviour of the two book calls, error replies, and the clock offset read from the Date header.
// Public, unauthenticated, read-only. At most one request per second, because Bit2c publishes no rate limit and CCXT paces it at one request per 3 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bit2c/rest-probe.mjs [survey|cache]
//   survey  latency, CCXT catalog, pair sweep, book shape, trades, errors, clock. About 45 s.
//   cache   alternates orderbook.json and orderbook-top.json for BtcNis, one request per second, for 120 s, and counts how often each reply changed.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bit2c/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'https://bit2c.co.il';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

// Every pair code named by the site's PairToInt table on 2026-09-22, CCXT lists only the first four.
const PAIRS = ['BtcNis', 'EthNis', 'LtcNis', 'UsdcNis', 'BchabcNis', 'BchsvNis', 'EtcNis', 'BtgNis', 'GrinNis', 'LtcBtc'];

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const sent = Date.now();
  let res;
  try {
    res = await fetch(HOST + path, { redirect: 'manual', headers: { 'user-agent': 'observatory-probe/1' } });
  } catch (e) {
    return { path, error: String(e.cause?.code ?? e.message), ms: Math.round(performance.now() - t0) };
  }
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const received = Date.now();
  const h = (k) => res.headers.get(k);
  return {
    path,
    status: res.status,
    ttfb: Math.round(ttfb),
    ms: Math.round(performance.now() - t0),
    bytes: text.length,
    text,
    sent,
    received,
    date: h('date'),
    headers: { 'content-type': h('content-type'), 'cache-control': h('cache-control'), age: h('age'), etag: h('etag'), 'last-modified': h('last-modified'), 'retry-after': h('retry-after'), 'x-cdn': h('x-cdn'), server: h('server'), location: h('location') },
  };
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function bookShape(book) {
  const side = (levels, dir) => {
    let ordered = 0;
    let broken = 0;
    for (let i = 1; i < levels.length; i++) {
      const ok = dir === 'desc' ? levels[i][0] < levels[i - 1][0] : levels[i][0] > levels[i - 1][0];
      if (ok) ordered++;
      else broken++;
    }
    const widths = [...new Set(levels.map((l) => l.length))];
    const types = [...new Set(levels.flat().map((v) => typeof v))];
    const dupPrices = levels.length - new Set(levels.map((l) => l[0])).size;
    const notional = levels.reduce((s, l) => s + l[0] * l[1], 0);
    return { levels: levels.length, ordered, broken, widths, types, dupPrices, notional: Math.round(notional) };
  };
  const bids = book.bids ?? [];
  const asks = book.asks ?? [];
  return {
    bids: side(bids, 'desc'),
    asks: side(asks, 'asc'),
    bestBid: bids[0]?.slice(0, 3),
    bestAsk: asks[0]?.slice(0, 3),
    spreadPpm: bids[0] && asks[0] ? Math.round(((asks[0][0] - bids[0][0]) / ((asks[0][0] + bids[0][0]) / 2)) * 1e6) : null,
  };
}

async function survey() {
  const addrs = await lookup('bit2c.co.il', { all: true });
  log('dns', { host: 'bit2c.co.il', addrs: addrs.map((a) => a.address) });

  const lat = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/Exchanges/BtcNis/Ticker.json');
    lat.push({ status: r.status, ttfb: r.ttfb, ms: r.ms, bytes: r.bytes });
    await sleep(1000);
  }
  log('latency_ticker', { first: lat[0], warm: lat.slice(1).map((x) => x.ms) });

  const ex = new ccxt.bit2c();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  log('ccxt_load', { ms: Math.round(performance.now() - t0), count: Object.keys(markets).length, rateLimit: ex.rateLimit, has: { spot: ex.has.spot, swap: ex.has.swap, future: ex.has.future, option: ex.has.option, ws: ex.has.ws }, pro: ex.pro, feeTrading: { maker: ex.fees.trading.maker, taker: ex.fees.trading.taker, percentage: ex.fees.trading.percentage, tierBased: ex.fees.trading.tierBased } });
  for (const m of Object.values(markets)) {
    log('ccxt_market', { symbol: m.symbol, id: m.id, type: m.type, spot: m.spot, swap: m.swap, active: m.active, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, takerPpm: Math.round(m.taker * 1e6), precision: m.precision, limits: m.limits?.amount });
  }

  for (const pair of PAIRS) {
    const t = await get(`/Exchanges/${pair}/Ticker.json`);
    await sleep(1000);
    const b = await get(`/Exchanges/${pair}/orderbook.json`);
    await sleep(1000);
    const tj = parse(t.text);
    const bj = parse(b.text);
    keep(`ticker-${pair}.json`, t.text);
    keep(`orderbook-${pair}.json`, b.text);
    log('pair', {
      pair,
      ticker: { status: t.status, bytes: t.bytes, ms: t.ms, body: tj ?? t.text.slice(0, 160) },
      book: { status: b.status, bytes: b.bytes, ms: b.ms, shape: bj && bj.bids ? bookShape(bj) : b.text.slice(0, 160) },
    });
  }

  for (const pair of ['BtcNis', 'UsdcNis']) {
    const top = await get(`/Exchanges/${pair}/orderbook-top.json`);
    await sleep(1000);
    const tj = parse(top.text);
    keep(`orderbook-top-${pair}.json`, top.text);
    log('book_top', { pair, status: top.status, bytes: top.bytes, ms: top.ms, headers: top.headers, shape: tj && tj.bids ? bookShape(tj) : top.text.slice(0, 200) });
  }

  const full = await get('/Exchanges/BtcNis/orderbook.json');
  log('book_full_headers', { headers: full.headers });
  await sleep(1000);

  const lt = await get('/Exchanges/BtcNis/lasttrades');
  const ltj = parse(lt.text);
  keep('lasttrades-BtcNis.json', lt.text);
  if (Array.isArray(ltj)) {
    const dates = ltj.map((x) => x.date);
    log('lasttrades', { status: lt.status, bytes: lt.bytes, count: ltj.length, keys: Object.keys(ltj[0] ?? {}), first: ltj[0], last: ltj[ltj.length - 1], newestAgeS: Math.round(Date.now() / 1000 - Math.max(...dates)), oldestAgeS: Math.round(Date.now() / 1000 - Math.min(...dates)) });
  } else {
    log('lasttrades', { status: lt.status, bytes: lt.bytes, body: lt.text.slice(0, 200) });
  }
  await sleep(1000);

  const tr = await get('/Exchanges/BtcNis/trades.json?limit=5');
  const trj = parse(tr.text);
  log('trades', { status: tr.status, bytes: tr.bytes, count: Array.isArray(trj) ? trj.length : null, sample: Array.isArray(trj) ? trj.slice(0, 2) : tr.text.slice(0, 200), headers: { 'cache-control': tr.headers['cache-control'] } });
  await sleep(1000);

  for (const path of ['/Exchanges/NopeNis/Ticker.json', '/Exchanges/NopeNis/orderbook.json', '/Exchanges/btcnis/Ticker.json', '/Exchanges/BTCNIS/orderbook.json', '/Exchanges/BtcNis/Ticker', '/Exchanges/BtcNis/depth.json', '/api/v1/time', '/Exchanges/BtcUsdc/orderbook.json']) {
    const r = await get(path);
    log('error_case', { path, status: r.status, bytes: r.bytes, contentType: r.headers['content-type'], location: r.headers.location, body: r.text.slice(0, 160).replace(/\s+/g, ' ') });
    await sleep(1000);
  }

  // Date carries whole seconds, so the offset is bounded by the request's send and receive instants.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/Exchanges/BtcNis/Ticker.json');
    const server = Date.parse(r.date);
    offsets.push({ lowMs: server - r.received, highMs: server + 999 - r.sent });
    await sleep(1000);
  }
  const low = Math.max(...offsets.map((o) => o.lowMs));
  const high = Math.min(...offsets.map((o) => o.highMs));
  log('clock', { samples: offsets.length, serverMinusLocalMs: { low, high } });
}

async function cache() {
  const seconds = 120;
  const state = { full: { last: null, changes: 0, polls: 0, ms: [], bytes: [], levels: [] }, top: { last: null, changes: 0, polls: 0, ms: [], bytes: [], levels: [] } };
  const touch = { full: [], top: [] };
  for (let i = 0; i < seconds; i++) {
    const which = i % 2 === 0 ? 'full' : 'top';
    const path = which === 'full' ? '/Exchanges/BtcNis/orderbook.json' : '/Exchanges/BtcNis/orderbook-top.json';
    const r = await get(path);
    const s = state[which];
    s.polls++;
    s.ms.push(r.ms);
    s.bytes.push(r.bytes);
    const h = hash(r.text);
    if (s.last !== null && h !== s.last) s.changes++;
    s.last = h;
    const j = parse(r.text);
    if (j?.bids) {
      s.levels.push([j.bids.length, j.asks.length]);
      touch[which].push(`${j.bids[0]?.[0]}x${j.asks[0]?.[0]}`);
    }
    if (r.status !== 200) log('cache_status', { which, status: r.status, body: r.text.slice(0, 160) });
    await sleep(Math.max(0, 1000 - r.ms));
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
  for (const which of ['full', 'top']) {
    const s = state[which];
    const touchChanges = touch[which].filter((t, i) => i > 0 && t !== touch[which][i - 1]).length;
    log('cache', { which, polls: s.polls, bodyChanges: s.changes, touchChanges, ms: { min: Math.min(...s.ms), median: q(s.ms, 0.5), p90: q(s.ms, 0.9), max: Math.max(...s.ms) }, bytes: { min: Math.min(...s.bytes), max: Math.max(...s.bytes) }, bidLevels: [Math.min(...s.levels.map((l) => l[0])), Math.max(...s.levels.map((l) => l[0]))], askLevels: [Math.min(...s.levels.map((l) => l[1])), Math.max(...s.levels.map((l) => l[1]))] });
  }
}

const mode = process.argv[2] ?? 'survey';
if (mode === 'survey') await survey();
else if (mode === 'cache') await cache();
else console.error('unknown mode', mode);
