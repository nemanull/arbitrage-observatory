// GoPax REST probe: KRW and USDC spot catalog, host latency and edge headers, rate limit weight headers, bulk ticker polls, order book snapshots, errors, clock offset.
// Public, unauthenticated, read-only. At most about 2 requests per second, and the book call at most once per 1.1 s, inside the documented 20 calls per second per IP and 1 book call per second.
// Run from server/: node ../scripts/probes/venues/gopax/rest-probe.mjs [catalog|latency|tickers|book|errors|all]
//   catalog  GET /trading-pairs, /tickers, /trading-pairs/stats, /trading-pairs/cautions and /assets: counts, fees, quotes, activity, and whether CCXT 4.5.68 has a class. About 5 s.
//   latency  DNS, one cold and ten warm requests per endpoint, edge and weight headers, clock offset from /time. About 25 s.
//   tickers  30 polls of /tickers at 1 s: reply time and size, and how many pairs changed per poll. About 35 s.
//   book     GET /trading-pairs/{pair}/book at level 1, 2 and 3 on four pairs: level count, order, spread, sequence and entry ids, timestamp age, repeat reads, and /tickers against the live touch. About 30 s.
//   errors   unknown pair, delisted pair, bad level, lower case pair, unknown path, per pair ticker: status and body. About 12 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/gopax/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.gopax.co.kr';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const count = (arr, f) => arr.reduce((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, headers = {}) {
  const sent = Date.now();
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { accept: 'application/json', 'accept-encoding': 'gzip', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, text, json, headers: res.headers, sent, recv: Date.now() };
}

const HEADERS = ['server', 'via', 'x-cache', 'x-amz-cf-pop', 'age', 'cache-control', 'content-encoding', 'content-type', 'retry-after',
  'x-gopax-ip-addr-used-weight', 'x-gopax-ip-addr-left-weight', 'x-gopax-api-key-used-weight', 'x-gopax-api-key-left-weight'];
const pick = (h) => Object.fromEntries(HEADERS.map((n) => [n, h.get(n)]).filter(([, v]) => v !== null));

async function catalog() {
  const pairs = await get('/trading-pairs');
  keep('trading-pairs.json', pairs.text);
  const p = pairs.json;
  log('trading_pairs', {
    status: pairs.status, ms: pairs.ms, bytes: pairs.text.length, rows: p.length,
    quote: count(p, (x) => x.quoteAsset), fees: count(p, (x) => `${x.makerFeePercent}/${x.takerFeePercent}`),
    keys: Object.keys(p[0]), status_field: p.some((x) => 'status' in x || 'active' in x || 'isActive' in x),
    usdc: p.filter((x) => x.quoteAsset !== 'KRW').map((x) => x.name),
  });
  await sleep(500);

  const t = await get('/tickers');
  keep('tickers.json', t.text);
  const now = Date.now();
  const tk = t.json;
  const names = new Set(p.map((x) => x.name));
  const tnames = new Set(tk.map((x) => x.tradingPairName));
  const age = (x) => (now - x.lastTraded) / 86_400_000;
  const listed = tk.filter((x) => names.has(x.tradingPairName));
  const delisted = tk.filter((x) => !names.has(x.tradingPairName));
  const krw = listed.filter((x) => x.tradingPairName.endsWith('-KRW'));
  const spreadPpm = (x) => (x.highestBid && x.lowestAsk ? Math.round(((x.lowestAsk - x.highestBid) / x.highestBid) * 1e6) : null);
  log('tickers', {
    status: t.status, ms: t.ms, bytes: t.text.length, rows: tk.length, keys: Object.keys(tk[0]),
    in_catalog_not_tickers: [...names].filter((n) => !tnames.has(n)), in_tickers_not_catalog: delisted.length,
    delisted_newest_trade: new Date(Math.max(...delisted.map((x) => x.lastTraded))).toISOString(),
    delisted_with_bid: delisted.filter((x) => x.highestBid).length, delisted_crossed: delisted.filter((x) => x.highestBid && x.lowestAsk && x.highestBid >= x.lowestAsk).length,
    listed_bid0: listed.filter((x) => !x.highestBid).map((x) => x.tradingPairName), listed_ask0: listed.filter((x) => !x.lowestAsk).map((x) => x.tradingPairName),
    listed_crossed: listed.filter((x) => x.highestBid && x.lowestAsk && x.highestBid >= x.lowestAsk).map((x) => x.tradingPairName),
    listed_last_trade_age: { under_1h: listed.filter((x) => age(x) < 1 / 24).length, under_1d: listed.filter((x) => age(x) < 1).length, under_7d: listed.filter((x) => age(x) < 7).length, over_30d: listed.filter((x) => age(x) > 30).length },
    krw_quote_volume_total: Math.round(krw.reduce((a, x) => a + x.quoteVolume, 0)),
    krw_quote_volume_top: [...krw].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 8).map((x) => [x.tradingPairName, Math.round(x.quoteVolume), spreadPpm(x)]),
    krw_over_100m: krw.filter((x) => x.quoteVolume > 1e8).length, krw_zero_volume: krw.filter((x) => !x.quoteVolume).length,
    krw_spread_ppm: { min: Math.min(...krw.map(spreadPpm)), median: median(krw.map(spreadPpm)), p90: pct(krw.map(spreadPpm), 0.9) },
    majors: ['BTC-KRW', 'ETH-KRW', 'XRP-KRW', 'USDT-KRW', 'USDC-KRW', 'SOL-KRW'].map((n) => { const x = listed.find((y) => y.tradingPairName === n); return x ? [n, x.highestBid, x.lowestAsk, spreadPpm(x), Math.round(x.quoteVolume)] : [n, 'absent']; }),
    usdc: listed.filter((x) => x.tradingPairName.endsWith('-USDC')).map((x) => [x.tradingPairName, Math.round(x.quoteVolume), spreadPpm(x), Math.round(age(x) * 24) + 'h']),
  });
  await sleep(500);

  const s = await get('/trading-pairs/stats');
  keep('stats.json', s.text);
  log('stats', { status: s.status, ms: s.ms, bytes: s.text.length, rows: s.json?.length, first: s.json?.[0] });
  await sleep(500);

  const c = await get('/trading-pairs/cautions?showActive=true');
  keep('cautions.json', c.text);
  log('cautions_active', { status: c.status, ms: c.ms, rows: c.json?.length, alert: count(c.json ?? [], (x) => x.alertLevel), names: (c.json ?? []).map((x) => x.name) });
  await sleep(500);

  const a = await get('/assets');
  keep('assets.json', a.text);
  log('assets', { status: a.status, ms: a.ms, rows: a.json?.length, keys: a.json?.[0] && Object.keys(a.json[0]) });
  await sleep(500);

  const tick = await get('/trading-pairs/BTC-KRW/price-tick-size');
  log('price_tick_size_BTC_KRW', { status: tick.status, body: tick.text.slice(0, 400) });

  log('ccxt', { version: ccxt.version, classes: ccxt.exchanges.length, gopax: ccxt.exchanges.filter((x) => /gopax/i.test(x)) });
}

async function latency() {
  const host = new URL(API).hostname;
  const t0 = performance.now();
  const addrs = await lookup(host, { all: true });
  log('dns', { host, ms: Math.round(performance.now() - t0), addrs: addrs.map((a) => a.address) });

  for (const path of ['/time', '/tickers', '/trading-pairs', '/trading-pairs/BTC-KRW/ticker']) {
    const times = [];
    let first = null;
    for (let i = 0; i < 11; i++) {
      const r = await get(path);
      if (i === 0) first = r;
      else times.push(r.ms);
      if (i === 0 || i === 10) log('headers', { path, i, status: r.status, bytes: r.text.length, headers: pick(r.headers) });
      await sleep(500);
    }
    log('latency', { path, cold_ms: first.ms, warm_min: Math.min(...times), warm_median: median(times), warm_max: Math.max(...times) });
  }

  const offsets = [];
  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const r = await get('/time');
    const mid = (r.sent + r.recv) / 2;
    offsets.push(r.json.serverTime - mid);
    rtts.push(r.recv - r.sent);
    await sleep(300);
  }
  log('clock', { offset_ms_median: median(offsets), offset_min: Math.min(...offsets), offset_max: Math.max(...offsets), rtt_median: median(rtts), sample: 'serverTime minus local midpoint' });
}

async function tickers() {
  let prev = null;
  const ms = [];
  const bytes = [];
  const changed = [];
  const statuses = {};
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    const r = await get('/tickers');
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    ms.push(r.ms);
    bytes.push(r.text.length);
    if (r.json && prev) {
      const pm = new Map(prev.map((x) => [x.tradingPairName, x]));
      let touch = 0;
      let last = 0;
      for (const x of r.json) {
        const o = pm.get(x.tradingPairName);
        if (!o) continue;
        if (o.highestBid !== x.highestBid || o.lowestAsk !== x.lowestAsk) touch++;
        if (o.last !== x.last) last++;
      }
      changed.push({ touch, last });
    }
    if (i === 0) log('tickers_headers', { headers: pick(r.headers) });
    prev = r.json ?? prev;
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  log('tickers_polls', {
    polls: ms.length, statuses, ms_min: Math.min(...ms), ms_median: median(ms), ms_p90: pct(ms, 0.9), ms_max: Math.max(...ms), bytes_median: median(bytes),
    touch_changed_median: median(changed.map((c) => c.touch)), touch_changed_max: Math.max(...changed.map((c) => c.touch)), polls_with_no_touch_change: changed.filter((c) => c.touch === 0).length,
    last_changed_median: median(changed.map((c) => c.last)),
  });
}

function bookStats(pair, level, r) {
  const b = r.json;
  if (!b || !Array.isArray(b.bid)) return { pair, level, status: r.status, body: r.text.slice(0, 200) };
  const bids = b.bid.map((e) => Number(e[1]));
  const asks = b.ask.map((e) => Number(e[1]));
  const desc = bids.every((p, i) => i === 0 || p < bids[i - 1]);
  const asc = asks.every((p, i) => i === 0 || p > asks[i - 1]);
  const ids = [...b.bid, ...b.ask].map((e) => Number(e[0]));
  const times = [...b.bid, ...b.ask].map((e) => Number(e[3]));
  return {
    pair, level, status: r.status, ms: r.ms, bytes: r.text.length, keys: Object.keys(b), sequence: b.sequence,
    bids: bids.length, asks: asks.length, bid_desc: desc, ask_asc: asc, best_bid: bids[0], best_ask: asks[0], spread_ppm: Math.round(((asks[0] - bids[0]) / bids[0]) * 1e6), crossed: bids[0] >= asks[0],
    max_entry_id: Math.max(...ids), max_entry_le_sequence: Math.max(...ids) <= b.sequence,
    newest_level_age_s: Math.round((r.recv - Math.max(...times)) / 1000), oldest_level_age_days: Math.round((r.recv - Math.min(...times)) / 86_400_000),
    types: { id: typeof b.bid[0]?.[0], price: typeof b.bid[0]?.[1], size: typeof b.bid[0]?.[2], time: typeof b.bid[0]?.[3] },
    first_bid: b.bid[0], first_ask: b.ask[0], weight: pick(r.headers)['x-gopax-ip-addr-used-weight'],
  };
}

async function book() {
  const pairs = ['BTC-KRW', 'USDT-KRW', 'XRP-KRW', 'ETH-USDC'];
  for (const pair of pairs) {
    for (const level of [1, 2, 3]) {
      const r = await get(`/trading-pairs/${pair}/book?level=${level}`);
      keep(`book-${pair}-${level}.json`, r.text);
      log('book', bookStats(pair, level, r));
      await sleep(1100);
    }
  }
  const a = await get('/trading-pairs/BTC-KRW/book');
  log('book_default_level', bookStats('BTC-KRW', 'none', a));
  await sleep(1100);
  const seqs = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/trading-pairs/USDT-KRW/book?level=1');
    seqs.push([r.json?.sequence, r.json?.bid?.[0]?.[1], r.json?.ask?.[0]?.[1], pick(r.headers)['x-gopax-ip-addr-used-weight']]);
    await sleep(1100);
  }
  log('book_repeat_USDT_KRW_level1', { reads: seqs, note: '[sequence, best bid, best ask, used weight]' });

  // The bulk ticker's highestBid and lowestAsk against the live touch, read back to back.
  for (const pair of ['BTC-KRW', 'XRP-KRW', 'ETH-KRW']) {
    await sleep(1100);
    const t = await get('/tickers');
    const b = await get(`/trading-pairs/${pair}/book?level=1`);
    const x = t.json.find((y) => y.tradingPairName === pair);
    log('ticker_vs_book', { pair, ticker_bid: x.highestBid, book_bid: b.json.bid[0]?.[1], ticker_ask: x.lowestAsk, book_ask: b.json.ask[0]?.[1], ticker_last_traded: new Date(x.lastTraded).toISOString(), book_bid_updated: new Date(Number(b.json.bid[0]?.[3])).toISOString(), book_ask_updated: new Date(Number(b.json.ask[0]?.[3])).toISOString() });
  }
}

async function errors() {
  const cases = [
    ['unknown_pair_ticker', '/trading-pairs/NOPE-KRW/ticker'],
    ['unknown_pair_book', '/trading-pairs/NOPE-KRW/book?level=1'],
    ['bad_level', '/trading-pairs/BTC-KRW/book?level=9'],
    ['lower_case_pair', '/trading-pairs/btc-krw/ticker'],
    ['underscore_pair', '/trading-pairs/BTC_KRW/ticker'],
    ['unknown_path', '/nope'],
    ['per_pair_ticker', '/trading-pairs/BTC-KRW/ticker'],
    ['per_pair_ticker_usdc', '/trading-pairs/BTC-USDC/ticker'],
    ['delisted_pair_ticker', '/trading-pairs/ZEC-KRW/ticker'],
    ['delisted_pair_book', '/trading-pairs/ZEC-KRW/book?level=1'],
  ];
  for (const [name, path] of cases) {
    const r = await get(path);
    log('error_case', { name, path, status: r.status, body: r.text.slice(0, 240), headers: pick(r.headers) });
    await sleep(1100);
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, latency, tickers, book, errors };
const started = new Date().toISOString();
if (mode === 'all') {
  for (const f of Object.values(modes)) await f();
} else {
  await modes[mode]();
}
log('done', { mode, started, ended: new Date().toISOString() });
