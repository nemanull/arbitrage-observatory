// Upbit Indonesia REST probe: host latency, the pair catalog against CCXT, bulk tickers, the REST orderbook, the public fee table, error shapes, rate limit headers and clock offset.
// Public, unauthenticated, read-only. At most about three requests a second, well inside the documented 10 per second per group.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/upbit-indonesia/rest-probe.mjs [host|catalog|ticker|book|fees|errors|time|all]
//   host     DNS answer, cold and warm request time on /v1/market/all. About 10 s.
//   catalog  /v1/market/all?is_details=true by quote and warning, /v1/orderbook/instruments, and CCXT 4.5.68 upbit with hostname id-api.upbit.com compared field by field. About 15 s.
//   ticker   /v1/ticker/all for every quote: reply size and time over 20 polls, which fields change, and 24 h turnover per quote in USDT. About 25 s.
//   book     /v1/orderbook: count values, several pairs per call, level order, repeat reads and caching, thin books. About 20 s.
//   fees     the guest trade fee table the Upbit Indonesia web site reads, from ccxid.upbit.com. About 1 s.
//   errors   unknown pair, bad parameter, missing parameter, unknown path, and one request with an Origin header. About 5 s.
//   time     clock offset bounded by the second in which the Date header flips, and the orderbook timestamp lag. About 8 s.
// Set PROBE_OUT_DIR to keep trimmed replies. Recorded in docs/profiles/upbit-indonesia/rest.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'id-api.upbit.com';
const API = `https://${HOST}/v1`;
const FEE_URL = 'https://ccxid.upbit.com/api/v1/market_status/base_trade_fee_conditions/guest';
const QUOTES = ['IDR', 'BTC', 'USDT'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text.slice(0, 200_000));
}

async function get(path, headers = {}) {
  const url = path.startsWith('http') ? path : API + path;
  const t0 = performance.now();
  const sent = Date.now();
  const res = await fetch(url, { headers: { 'accept-encoding': 'gzip', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* the body is kept as text */ }
  return { status: res.status, ms, sent, received: Date.now(), bytes: text.length, text, json, headers: Object.fromEntries(res.headers) };
}

async function host() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { addrs: addrs.map((a) => a.address) });
  const times = [];
  for (let i = 0; i < 8; i++) {
    const r = await get('/market/all');
    times.push(r.ms);
    if (i === 0) log('first', { status: r.status, ms: r.ms, bytes: r.bytes, remainingReq: r.headers['remaining-req'], limitByIp: r.headers['limit-by-ip'], server: r.headers.server ?? null, via: r.headers.via ?? null, cfRay: r.headers['cf-ray'] ?? null, trafficPath: r.headers['x-dunamu-traffic-path'] ?? null });
    await sleep(400);
  }
  log('market_all_times', { first: times[0], warm: times.slice(1), warmMedian: median(times.slice(1)) });
}

async function catalog() {
  const r = await get('/market/all?is_details=true');
  keep('market_all.json', r.text);
  const rows = r.json;
  const byQuote = {};
  const warnings = {};
  for (const m of rows) {
    const q = m.market.split('-')[0];
    byQuote[q] = (byQuote[q] ?? 0) + 1;
    warnings[m.market_warning] = (warnings[m.market_warning] ?? 0) + 1;
  }
  log('market_all', { status: r.status, ms: r.ms, bytes: r.bytes, rows: rows.length, byQuote, keys: Object.keys(rows[0]), warnings, caution: rows.filter((m) => m.market_warning !== 'NONE').map((m) => m.market) });
  const plain = await get('/market/all');
  log('market_all_plain', { rows: plain.json.length, keys: Object.keys(plain.json[0]), bytes: plain.bytes });

  const bases = {};
  for (const m of rows) { const [q, b] = m.market.split('-'); (bases[b] ??= []).push(q); }
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const qs of Object.values(bases)) counts[qs.length]++;
  log('bases', { distinct: Object.keys(bases).length, quotesPerBase: counts, idrAndUsdt: Object.values(bases).filter((q) => q.includes('IDR') && q.includes('USDT')).length });

  await sleep(400);
  const sample = ['IDR-BTC', 'IDR-ETH', 'IDR-USDT', 'BTC-ETH', 'USDT-BTC', 'USDT-ETH', 'IDR-DOGE'].join(',');
  const inst = await get(`/orderbook/instruments?markets=${sample}`);
  log('orderbook_instruments', { status: inst.status, ms: inst.ms, body: Array.isArray(inst.json) ? null : inst.text.slice(0, 200), rows: Array.isArray(inst.json) ? inst.json.map((x) => ({ market: x.market, quote: x.quote_currency, tick: x.tick_size, levels: x.supported_levels?.length, levelsHead: x.supported_levels?.slice(0, 4) })) : null });

  const ex = new ccxt.upbit({ hostname: HOST });
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const types = {};
  const takers = {};
  for (const m of list) {
    types[m.type] = (types[m.type] ?? 0) + 1;
    takers[`${m.quote}:${m.taker}/${m.maker}`] = (takers[`${m.quote}:${m.taker}/${m.maker}`] ?? 0) + 1;
  }
  const ids = new Set(rows.map((m) => m.market));
  const idMismatch = list.filter((m) => !ids.has(m.id)).map((m) => m.id);
  const renamed = list.filter((m) => m.base !== m.baseId || m.quote !== m.quoteId).map((m) => `${m.id} as ${m.symbol}`);
  log('ccxt', {
    hostname: ex.hostname,
    loadMs: Math.round(performance.now() - t0),
    count: list.length,
    types,
    takerMakerByQuote: takers,
    activeFalse: list.filter((m) => m.active !== true).length,
    swap: list.filter((m) => m.swap).length,
    contractSizeSet: list.filter((m) => m.contractSize !== undefined).length,
    linearSet: list.filter((m) => m.linear !== undefined).length,
    idNotInMarketAll: idMismatch,
    renamed,
    sample: (({ id, symbol, base, quote, type, spot, swap, active, linear, contractSize, taker, maker }) => ({ id, symbol, base, quote, type, spot, swap, active, linear, contractSize, taker, maker }))(markets['BTC/IDR']),
  });
  const kr = new ccxt.upbit();
  log('ccxt_default_host', { hostname: kr.hostname, publicUrl: kr.urls.api.public });
}

async function ticker() {
  const times = { IDR: [], BTC: [], USDT: [] };
  const sizes = {};
  const prev = {};
  const changes = { trade_price: 0, timestamp: 0, trade_timestamp: 0 };
  const turnover = {};
  let compared = 0;
  for (let i = 0; i < 20; i++) {
    for (const q of QUOTES) {
      if (q !== 'IDR' && i % 5 !== 0) continue;
      const r = await get(`/ticker/all?quote_currencies=${q}`);
      times[q].push(r.ms);
      sizes[q] = { rows: r.json?.length, bytes: r.bytes, status: r.status, remainingReq: r.headers['remaining-req'] };
      if (Array.isArray(r.json)) turnover[q] = r.json.map((t) => [t.market, t.acc_trade_price_24h]);
      if (q === 'IDR' && Array.isArray(r.json)) {
        if (i === 0) {
          keep('ticker_idr.json', r.text);
          log('ticker_fields', { keys: Object.keys(r.json[0]) });
        }
        for (const t of r.json) {
          const p = prev[t.market];
          if (p) {
            compared++;
            for (const k of Object.keys(changes)) if (p[k] !== t[k]) changes[k]++;
          }
          prev[t.market] = t;
        }
      }
      await sleep(350);
    }
  }
  log('ticker_all', { sizes, idrMs: { min: Math.min(...times.IDR), median: median(times.IDR), p90: pct(times.IDR, 0.9), max: Math.max(...times.IDR) }, btcMs: times.BTC, usdtMs: times.USDT });
  log('ticker_changes', { comparedRowPairs: compared, changes });
  // 24 h turnover in USDT through the IDR-USDT and USDT-BTC last trades.
  const px = await get('/ticker?markets=IDR-USDT,USDT-BTC');
  const last = Object.fromEntries(px.json.map((t) => [t.market, t.trade_price]));
  const toUsdt = { IDR: 1 / last['IDR-USDT'], BTC: last['USDT-BTC'], USDT: 1 };
  const inUsdt = {};
  const top = {};
  for (const q of QUOTES) {
    const rows = (turnover[q] ?? []).map(([m, v]) => [m, v * toUsdt[q]]).sort((a, b) => b[1] - a[1]);
    inUsdt[q] = Math.round(rows.reduce((a, [, v]) => a + v, 0));
    top[q] = rows.slice(0, 5).map(([m, v]) => `${m} ${Math.round(v)}`);
    top[`${q}_under_1000`] = rows.filter(([, v]) => v < 1000).length;
  }
  log('turnover_24h', { idrUsdt: last['IDR-USDT'], usdtBtc: last['USDT-BTC'], inUsdt, top });
  const btc = prev['IDR-BTC'];
  log('ticker_btc', btc ? { market: btc.market, trade_price: btc.trade_price, timestamp: btc.timestamp, trade_timestamp: btc.trade_timestamp, lastTrade: new Date(btc.trade_timestamp).toISOString(), lastTradeAgeMin: Math.round((Date.now() - btc.trade_timestamp) / 60_000) } : {});
}

async function book() {
  const one = await get('/orderbook?markets=IDR-BTC');
  keep('orderbook_idr_btc.json', one.text);
  const b = one.json[0];
  const units = b.orderbook_units;
  // A side with fewer than 30 levels is padded with zero price, zero size slots, which are left out of the order check.
  const asks = units.map((u) => u.ask_price).filter((p) => p > 0);
  const bids = units.map((u) => u.bid_price).filter((p) => p > 0);
  const asksAsc = asks.every((p, i) => i === 0 || p > asks[i - 1]);
  const bidsDesc = bids.every((p, i) => i === 0 || p < bids[i - 1]);
  log('orderbook_one', { status: one.status, ms: one.ms, bytes: one.bytes, keys: Object.keys(b), units: units.length, realAsks: asks.length, realBids: bids.length, level: b.level, asksAscending: asksAsc, bidsDescending: bidsDesc, touch: units[0], timestamp: b.timestamp, receivedMinusTimestamp: one.received - b.timestamp, head: one.text.slice(0, 260) });

  for (const count of [1, 5, 15, 20, 30, 31, 50]) {
    await sleep(350);
    const r = await get(`/orderbook?markets=USDT-ETH&count=${count}`);
    log('orderbook_count', { count, status: r.status, units: r.json?.[0]?.orderbook_units?.length, error: r.json?.error });
  }

  await sleep(350);
  const all = await get('/market/all');
  const every = all.json.map((m) => m.market);
  for (const n of [10, 50, 100, every.length]) {
    await sleep(400);
    const list = every.slice(0, n);
    const r = await get(`/orderbook?markets=${list.join(',')}`);
    const lens = Array.isArray(r.json) ? r.json.map((x) => x.orderbook_units.length) : [];
    log('orderbook_multi', { asked: list.length, status: r.status, rows: Array.isArray(r.json) ? r.json.length : null, ms: r.ms, bytes: r.bytes, minUnits: lens.length ? Math.min(...lens) : null, maxUnits: lens.length ? Math.max(...lens) : null, error: r.json?.error ?? null });
  }

  const stamps = [];
  for (let i = 0; i < 10; i++) {
    await sleep(350);
    const r = await get('/orderbook?markets=USDT-BTC,IDR-BTC');
    stamps.push({ ms: r.ms, ts: r.json.map((x) => x.timestamp), tsMod: r.json.map((x) => x.timestamp % 1000), lagMs: r.json.map((x) => r.received - x.timestamp), etag: r.headers.etag, cache: r.headers['cache-control'] });
  }
  log('orderbook_repeat', { reads: stamps.length, distinctUsdtBtcTs: new Set(stamps.map((s) => s.ts[0])).size, distinctIdrBtcTs: new Set(stamps.map((s) => s.ts[1])).size, usdtBtcTsMod1000: stamps.map((s) => s.tsMod[0]), idrBtcTsMod1000: stamps.map((s) => s.tsMod[1]), lagMs: stamps.map((s) => s.lagMs), ms: stamps.map((s) => s.ms), cache: stamps[0].cache, etag: stamps[0].etag ?? null });

  await sleep(350);
  const lv = await get('/orderbook?markets=IDR-BTC&level=100000');
  log('orderbook_level', { status: lv.status, level: lv.json?.[0]?.level, units: lv.json?.[0]?.orderbook_units?.length, body: Array.isArray(lv.json) ? null : lv.text.slice(0, 200) });

  // Thin books: every pair, one side short of 30 levels or a zero slot.
  await sleep(350);
  const tr = await get(`/orderbook?markets=${every.join(',')}`);
  const short = [];
  let emptySide = 0;
  for (const x of Array.isArray(tr.json) ? tr.json : []) {
    const u = x.orderbook_units;
    const zeroAsk = u.filter((v) => v.ask_price === 0 || v.ask_size === 0).length;
    const zeroBid = u.filter((v) => v.bid_price === 0 || v.bid_size === 0).length;
    if (zeroAsk === u.length || zeroBid === u.length) emptySide++;
    if (zeroAsk || zeroBid || u.length < 30) short.push({ m: x.market, units: u.length, zeroAsk, zeroBid, tas: x.total_ask_size, tbs: x.total_bid_size });
  }
  log('orderbook_thin', { scanned: Array.isArray(tr.json) ? tr.json.length : tr.text.slice(0, 200), withEmptySlots: short.length, emptySide, sample: short.slice(0, 5) });
  const ex = short.find((s) => s.zeroBid || s.zeroAsk);
  if (ex) log('orderbook_empty_slot', { market: ex.m, lastUnits: tr.json.find((x) => x.market === ex.m).orderbook_units.slice(-2) });
}

async function fees() {
  const r = await get(FEE_URL);
  keep('fee_guest.json', r.text);
  log('fee_guest', { status: r.status, ms: r.ms, rows: r.json?.default_trade_fee_conditions?.map((c) => ({ quote: c.quote_unit, country: c.country_code, takerBid: c.bid_ratio, takerAsk: c.ask_ratio, makerBid: c.maker_bid_ratio, makerAsk: c.maker_ask_ratio, watchTaker: c.watch_bid_ratio, watchMaker: c.maker_watch_bid_ratio })) ?? r.text.slice(0, 300) });
}

async function errors() {
  const cases = [
    ['/orderbook?markets=IDR-NOPE', 'unknown pair'],
    ['/orderbook?markets=idr-btc', 'lower case pair'],
    ['/orderbook?markets=IDR-BTC,IDR-NOPE', 'known and unknown pair'],
    ['/orderbook?markets=KRW-BTC', 'Korean pair'],
    ['/orderbook', 'missing markets'],
    ['/orderbook?markets=IDR-BTC&count=abc', 'bad count'],
    ['/ticker?markets=IDR-NOPE', 'unknown ticker pair'],
    ['/nope', 'unknown path'],
  ];
  for (const [path, what] of cases) {
    const r = await get(path);
    log('error_case', { what, path, status: r.status, remainingReq: r.headers['remaining-req'] ?? null, body: r.text.slice(0, 240) });
    await sleep(400);
  }
  const withOrigin = await get('/market/all', { origin: 'https://example.com' });
  log('origin_header', { status: withOrigin.status, remainingReq: withOrigin.headers['remaining-req'] });
}

async function time() {
  // The server clock reached the later Date second after the earlier reply left and before the later reply arrived.
  const rows = [];
  for (let i = 0; i < 20; i++) {
    const r = await get('/orderbook?markets=USDT-BTC&count=1');
    rows.push({ sent: r.sent, received: r.received, date: Date.parse(r.headers.date), ts: r.json?.[0]?.timestamp });
    await sleep(200);
  }
  let lower = -Infinity;
  let upper = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (b.date > a.date) {
      lower = Math.max(lower, a.sent - b.date);
      upper = Math.min(upper, b.received - b.date);
    }
  }
  log('clock', { requests: rows.length, rttMs: rows.map((r) => r.received - r.sent), localMinusServerMs: { lower, upper }, orderbookTsLagMs: rows.map((r) => r.received - r.ts) });
}

const mode = process.argv[2] ?? 'all';
const modes = { host, catalog, ticker, book, fees, errors, time };
const run = mode === 'all' ? Object.keys(modes) : [mode];
for (const m of run) {
  if (!modes[m]) throw new Error(`unknown mode ${m}`);
  log('mode', { mode: m, at: new Date().toISOString() });
  await modes[m]();
}
