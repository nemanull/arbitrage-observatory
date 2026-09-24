// Upbit REST probe: host latency, the pair catalog against CCXT, bulk tickers, the REST orderbook, error shapes, rate limit headers and clock offset.
// Public, unauthenticated, read-only. At most about three requests a second, well inside the documented 10 per second per group.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/upbit/rest-probe.mjs [host|catalog|ticker|book|errors|time|all]
//   host     DNS answer, cold and warm request time on /v1/market/all. About 10 s.
//   catalog  /v1/market/all?is_details=true by quote, market_event flags, /v1/orderbook/instruments, and CCXT 4.5.68 loadMarkets compared field by field. About 15 s.
//   ticker   /v1/ticker/all for every quote: reply size and time over 20 polls, which fields change, and 24 h turnover per market in USDT. About 25 s.
//   book     /v1/orderbook: several pairs per call, count, level order, the size unit against the socket, repeat reads and caching. About 20 s.
//   errors   unknown pair, bad parameter, missing parameter, unknown path, and one request with an Origin header. About 5 s.
//   time     clock offset bounded by the second in which the Date header flips, 20 book reads with 0.2 s pauses, and the orderbook timestamp lag. About 8 s.
// Set PROBE_OUT_DIR to keep trimmed replies. Recorded in docs/profiles/upbit/rest.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.upbit.com/v1';
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
  const t0 = performance.now();
  const sent = Date.now();
  const res = await fetch(API + path, { headers: { 'accept-encoding': 'gzip', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* the body is kept as text */ }
  return { status: res.status, ms, sent, received: Date.now(), bytes: text.length, text, json, headers: Object.fromEntries(res.headers) };
}

async function host() {
  const addrs = await lookup('api.upbit.com', { all: true });
  log('dns', { addrs: addrs.map((a) => a.address) });
  const times = [];
  for (let i = 0; i < 8; i++) {
    const r = await get('/market/all');
    times.push(r.ms);
    if (i === 0) log('first', { status: r.status, ms: r.ms, bytes: r.bytes, remainingReq: r.headers['remaining-req'], limitByIp: r.headers['limit-by-ip'], server: r.headers.server, via: r.headers.via, xCache: r.headers['x-cache'], cfRay: r.headers['cf-ray'] });
    await sleep(400);
  }
  log('market_all_times', { first: times[0], warm: times.slice(1), warmMedian: median(times.slice(1)) });
}

async function catalog() {
  const r = await get('/market/all?is_details=true');
  keep('market_all.json', r.text);
  const rows = r.json;
  const byQuote = {};
  const cautionFlags = {};
  let warning = 0;
  let anyCaution = 0;
  for (const m of rows) {
    const q = m.market.split('-')[0];
    byQuote[q] = (byQuote[q] ?? 0) + 1;
    if (m.market_event?.warning) warning++;
    const c = m.market_event?.caution ?? {};
    if (Object.values(c).some(Boolean)) anyCaution++;
    for (const [k, v] of Object.entries(c)) if (v) cautionFlags[k] = (cautionFlags[k] ?? 0) + 1;
  }
  log('market_all', { status: r.status, ms: r.ms, bytes: r.bytes, rows: rows.length, byQuote, keys: Object.keys(rows[0]), warning, anyCaution, cautionFlags });
  const plain = await get('/market/all');
  log('market_all_plain', { rows: plain.json.length, keys: Object.keys(plain.json[0]), bytes: plain.bytes });

  const bases = {};
  for (const m of rows) { const [q, b] = m.market.split('-'); (bases[b] ??= []).push(q); }
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const qs of Object.values(bases)) counts[qs.length]++;
  log('bases', { distinct: Object.keys(bases).length, quotesPerBase: counts, krwAndUsdt: Object.values(bases).filter((q) => q.includes('KRW') && q.includes('USDT')).length });

  await sleep(400);
  const sample = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'BTC-ETH', 'USDT-BTC', 'USDT-ETH', 'KRW-SHIB'].join(',');
  const inst = await get(`/orderbook/instruments?markets=${sample}`);
  log('orderbook_instruments', { status: inst.status, ms: inst.ms, rows: inst.json?.map((x) => ({ market: x.market, quote: x.quote_currency, tick: x.tick_size, levels: x.supported_levels?.length, levelsHead: x.supported_levels?.slice(0, 4) })) });

  const ex = new ccxt.upbit();
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
    sample: (({ id, symbol, base, quote, type, spot, swap, active, linear, contractSize, taker, maker }) => ({ id, symbol, base, quote, type, spot, swap, active, linear, contractSize, taker, maker }))(markets['BTC/KRW']),
  });
}

async function ticker() {
  const times = { KRW: [], BTC: [], USDT: [] };
  const sizes = {};
  const prev = {};
  const changes = { trade_price: 0, timestamp: 0, trade_timestamp: 0 };
  const turnover = {};
  let compared = 0;
  for (let i = 0; i < 20; i++) {
    for (const q of ['KRW', 'BTC', 'USDT']) {
      if (q !== 'KRW' && i % 5 !== 0) continue;
      const r = await get(`/ticker/all?quote_currencies=${q}`);
      times[q].push(r.ms);
      sizes[q] = { rows: r.json?.length, bytes: r.bytes, status: r.status, remainingReq: r.headers['remaining-req'] };
      if (Array.isArray(r.json)) turnover[q] = r.json.reduce((a, t) => a + t.acc_trade_price_24h, 0);
      if (q === 'KRW' && Array.isArray(r.json)) {
        if (i === 0) {
          keep('ticker_krw.json', r.text);
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
  log('ticker_all', { sizes, krwMs: { min: Math.min(...times.KRW), median: median(times.KRW), p90: pct(times.KRW, 0.9), max: Math.max(...times.KRW) }, btcMs: times.BTC, usdtMs: times.USDT });
  log('ticker_changes', { comparedRowPairs: compared, changes });
  // 24 h turnover per market in its own quote, and in USDT through the KRW-USDT and KRW-BTC last trades.
  const px = await get('/ticker?markets=KRW-USDT,KRW-BTC');
  const last = Object.fromEntries(px.json.map((t) => [t.market, t.trade_price]));
  log('turnover_24h', { own: { KRW: Math.round(turnover.KRW), BTC: +turnover.BTC.toFixed(2), USDT: Math.round(turnover.USDT) }, krwUsdt: last['KRW-USDT'], krwBtc: last['KRW-BTC'], inUsdt: { KRW: Math.round(turnover.KRW / last['KRW-USDT']), BTC: Math.round((turnover.BTC * last['KRW-BTC']) / last['KRW-USDT']), USDT: Math.round(turnover.USDT) } });
  const btc = prev['KRW-BTC'];
  log('ticker_btc', btc ? { market: btc.market, trade_price: btc.trade_price, timestamp: btc.timestamp, trade_timestamp: btc.trade_timestamp, market_state: btc.market_state } : {});
}

async function book() {
  const one = await get('/orderbook?markets=KRW-BTC');
  keep('orderbook_krw_btc.json', one.text);
  const b = one.json[0];
  const units = b.orderbook_units;
  const asksAsc = units.every((u, i) => i === 0 || u.ask_price > units[i - 1].ask_price);
  const bidsDesc = units.every((u, i) => i === 0 || u.bid_price < units[i - 1].bid_price);
  log('orderbook_one', { status: one.status, ms: one.ms, bytes: one.bytes, keys: Object.keys(b), units: units.length, level: b.level, asksAscending: asksAsc, bidsDescending: bidsDesc, touch: units[0], timestamp: b.timestamp, receivedMinusTimestamp: one.received - b.timestamp });

  for (const count of [1, 5, 15, 20, 30, 31, 50]) {
    await sleep(350);
    const r = await get(`/orderbook?markets=KRW-ETH&count=${count}`);
    log('orderbook_count', { count, status: r.status, units: r.json?.[0]?.orderbook_units?.length, error: r.json?.error });
  }

  await sleep(350);
  const all = await get('/market/all');
  const krw = all.json.map((m) => m.market).filter((m) => m.startsWith('KRW-'));
  const every = all.json.map((m) => m.market);
  for (const n of [10, 50, 100, krw.length, every.length]) {
    await sleep(400);
    const list = (n === every.length ? every : krw).slice(0, n);
    const r = await get(`/orderbook?markets=${list.join(',')}`);
    const lens = Array.isArray(r.json) ? r.json.map((x) => x.orderbook_units.length) : [];
    log('orderbook_multi', { asked: list.length, status: r.status, rows: Array.isArray(r.json) ? r.json.length : null, ms: r.ms, bytes: r.bytes, minUnits: lens.length ? Math.min(...lens) : null, maxUnits: lens.length ? Math.max(...lens) : null, error: r.json?.error });
  }

  const stamps = [];
  for (let i = 0; i < 10; i++) {
    await sleep(350);
    const r = await get('/orderbook?markets=KRW-BTC,KRW-XRP');
    stamps.push({ ms: r.ms, ts: r.json.map((x) => x.timestamp), tsMod: r.json.map((x) => x.timestamp % 1000), lagMs: r.json.map((x) => r.received - x.timestamp), bid: r.json[0].orderbook_units[0].bid_price, ask: r.json[0].orderbook_units[0].ask_price, etag: r.headers.etag, cache: r.headers['cache-control'] });
  }
  log('orderbook_repeat', { reads: stamps.length, distinctBtcTs: new Set(stamps.map((s) => s.ts[0])).size, btcTsMod1000: stamps.map((s) => s.tsMod[0]), xrpTsMod1000: stamps.map((s) => s.tsMod[1]), lagMs: stamps.map((s) => s.lagMs[0]), ms: stamps.map((s) => s.ms), cache: stamps[0].cache, etag: stamps[0].etag });

  await sleep(350);
  const lv = await get('/orderbook?markets=KRW-BTC&level=100000');
  log('orderbook_level', { status: lv.status, level: lv.json?.[0]?.level, touch: lv.json?.[0]?.orderbook_units?.[0], units: lv.json?.[0]?.orderbook_units?.length });
  await sleep(350);
  const lvBad = await get('/orderbook?markets=BTC-ETH&level=100');
  log('orderbook_level_non_krw', { status: lvBad.status, body: lvBad.text.slice(0, 300) });

  const thin = all.json.map((m) => m.market).filter((m) => m.startsWith('BTC-')).slice(0, 60);
  await sleep(350);
  const tr = await get(`/orderbook?markets=${thin.join(',')}`);
  const oneSided = [];
  for (const x of tr.json ?? []) {
    const u = x.orderbook_units;
    const zeroAsk = u.filter((v) => v.ask_price === 0 || v.ask_size === 0).length;
    const zeroBid = u.filter((v) => v.bid_price === 0 || v.bid_size === 0).length;
    if (zeroAsk || zeroBid || u.length < 30) oneSided.push({ m: x.market, units: u.length, zeroAsk, zeroBid, tas: x.total_ask_size, tbs: x.total_bid_size });
  }
  log('orderbook_thin', { scanned: tr.json?.length, withEmptySlots: oneSided.length, sample: oneSided.slice(0, 5) });
  const ex = (tr.json ?? []).find((x) => x.orderbook_units.some((v) => v.bid_size === 0));
  if (ex) log('orderbook_empty_slot', { market: ex.market, lastUnits: ex.orderbook_units.slice(-2) });
}

async function errors() {
  const cases = [
    ['/orderbook?markets=KRW-NOPE', 'unknown pair'],
    ['/orderbook?markets=krw-btc', 'lower case pair'],
    ['/orderbook?markets=KRW-BTC,KRW-NOPE', 'known and unknown pair'],
    ['/orderbook', 'missing markets'],
    ['/orderbook?markets=KRW-BTC&count=abc', 'bad count'],
    ['/ticker?markets=KRW-NOPE', 'unknown ticker pair'],
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
  // The orderbook timestamp trails the request by up to about 2 s, so the clock is bounded by the second in which the Date header flips.
  const rows = [];
  for (let i = 0; i < 20; i++) {
    const r = await get('/orderbook?markets=KRW-BTC&count=1');
    rows.push({ sent: r.sent, received: r.received, date: Date.parse(r.headers.date), ts: r.json?.[0]?.timestamp });
    await sleep(200);
  }
  let lower = -Infinity;
  let upper = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (b.date > a.date) {
      // The server clock reached b.date after a's reply was stamped and before b's reply was stamped.
      lower = Math.max(lower, a.sent - b.date);
      upper = Math.min(upper, b.received - b.date);
    }
  }
  log('clock', { requests: rows.length, rttMs: rows.map((r) => r.received - r.sent), localMinusServerMs: { lower, upper }, orderbookTsLagMs: rows.map((r) => r.received - r.ts) });
}

const mode = process.argv[2] ?? 'all';
const modes = { host, catalog, ticker, book, errors, time };
const run = mode === 'all' ? Object.keys(modes) : [mode];
for (const m of run) {
  if (!modes[m]) throw new Error(`unknown mode ${m}`);
  log('mode', { mode: m, at: new Date().toISOString() });
  await modes[m]();
}
