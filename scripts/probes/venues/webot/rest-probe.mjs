// Webot REST probe: host and latency, the undocumented spot catalog, the absence of any index, mark or funding call, the REST book, a one hertz poll, error shapes and the clock offset.
// Webot (formerly Pionex.US) publishes no API documentation, so the paths are those of the Pionex open API docs, tried on api.webot.com.
// Public, unauthenticated and read-only.
// The Pionex docs publish a weight of 10 per second per IP, where common/symbols weighs 5 and the market calls weigh 1.
// This probe keeps its own weight at or under 8 in any trailing second, across both API hosts.
// Run from server/: node ../scripts/probes/venues/webot/rest-probe.mjs [main|poll|all]
//   main  hosts and latency, CCXT check, catalog, anchor paths, book, errors and clock, about 40 s
//   poll  60 rounds of GET /api/v1/market/depth for BTC_USDT and GET /api/v1/market/tickers one second apart, with change counts, about 65 s
//   all   both
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/webot/rest.md and docs/profiles/webot/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.webot.com';
const ALT_API = 'https://api.pionex.us';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

const WEIGHT_BUDGET = 8;
const spent = []; // [sentAtMs, weight] of the requests of the trailing second

async function pace(weight) {
  for (;;) {
    const now = Date.now();
    while (spent.length && now - spent[0][0] >= 1000) spent.shift();
    const used = spent.reduce((a, [, w]) => a + w, 0);
    if (used + weight <= WEIGHT_BUDGET) {
      spent.push([now, weight]);
      return;
    }
    await sleep(1000 - (now - spent[0][0]) + 5);
  }
}

async function get(url, init = {}) {
  await pace(url.includes('/common/symbols') ? 5 : 1);
  const t0 = performance.now();
  const sent = Date.now();
  const res = await fetch(url, { ...init, headers: { 'user-agent': 'observatory-probe', ...(init.headers ?? {}) } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, sent, recv: Date.now(), bytes: text.length, text, body, headers: Object.fromEntries(res.headers) };
}

async function hosts() {
  for (const h of ['api.webot.com', 'api.pionex.us', 'ws.pionex.us', 'www.webot.com']) {
    try {
      const a = await dns.lookup(h, { all: true });
      log('dns', { host: h, addrs: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host: h, error: e.code });
    }
  }
  for (const base of [API, ALT_API]) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const r = await get(`${base}/api/v1/market/depth?symbol=BTC_USDT&limit=5`);
      times.push(r.ms);
      if (i === 0) log('latency_first', { base, status: r.status, ms: r.ms, server: r.headers.server, cfRay: r.headers['cf-ray'], via: r.headers.via ?? null, xCache: r.headers['x-cache'] ?? null, xAmzCf: r.headers['x-amz-cf-pop'] ?? null });
      await sleep(500);
    }
    log('latency', { base, firstMs: times[0], warm: times.slice(1) });
  }
}

function ccxtCheck() {
  const ids = ccxt.exchanges.filter((e) => /webot|pionex|pionew/i.test(e));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ids });
}

async function catalog() {
  const r = await get(`${API}/api/v1/common/symbols`);
  keep('symbols.json', r.text);
  const syms = r.body.data.symbols;
  const by = {};
  for (const s of syms) {
    const k = `${s.type}|${s.quoteCurrency}|enable=${s.enable}`;
    by[k] = (by[k] ?? 0) + 1;
  }
  log('symbols', { status: r.status, ms: r.ms, bytes: r.bytes, count: syms.length, by, enabled: syms.filter((s) => s.enable).map((s) => s.symbol), fields: Object.keys(syms[0]) });
  log('symbol_example', { btc: syms.find((s) => s.symbol === 'BTC_USDT'), eth: syms.find((s) => s.symbol === 'ETH_USDT') });

  const alt = await get(`${ALT_API}/api/v1/common/symbols`);
  log('symbols_alt_host', { status: alt.status, sameData: JSON.stringify(alt.body?.data) === JSON.stringify(r.body.data) });

  for (const type of ['PERP', 'SPOT', 'FUTURES', 'nope']) {
    const q = await get(`${API}/api/v1/common/symbols?type=${type}`);
    log('symbols_type', { type, status: q.status, count: q.body?.data?.symbols?.length ?? null, text: q.body?.data?.symbols ? undefined : q.text.slice(0, 160) });
    await sleep(300);
  }

  const t = await get(`${API}/api/v1/market/tickers`);
  keep('tickers.json', t.text);
  const tickers = t.body.data.tickers;
  const enable = new Map(syms.map((s) => [s.symbol, s.enable]));
  const traded = tickers.filter((x) => Number(x.count) > 0);
  const quoteVol = {};
  for (const x of traded) {
    const q = x.symbol.split('_')[1];
    quoteVol[q] = (quoteVol[q] ?? 0) + Number(x.amount);
  }
  log('tickers', {
    status: t.status, ms: t.ms, bytes: t.bytes, count: tickers.length, fields: Object.keys(tickers[0]),
    traded24h: traded.length, tradedEnabled: traded.filter((x) => enable.get(x.symbol)).length, tradedDisabled: traded.filter((x) => !enable.get(x.symbol)).length,
    quoteAmount24h: Object.fromEntries(Object.entries(quoteVol).map(([k, v]) => [k, Math.round(v)])),
    top: [...traded].sort((a, b) => b.amount - a.amount).slice(0, 8).map((x) => `${x.symbol} ${Math.round(x.amount)} ${x.count}`),
  });
  const bases = new Map();
  for (const s of syms) bases.set(s.baseCurrency, [...(bases.get(s.baseCurrency) ?? []), s.quoteCurrency]);
  const multi = [...bases.values()].filter((qs) => qs.length > 1).length;
  log('pairs_per_base', { bases: bases.size, basesWithSeveralQuotes: multi, btc: bases.get('BTC'), eth: bases.get('ETH') });
  const leveraged = syms.filter((s) => /\d[LS]$/.test(s.baseCurrency));
  log('leveraged_tokens', { count: leveraged.length, examples: leveraged.slice(0, 6).map((s) => s.symbol) });
}

async function anchorPaths() {
  const paths = [
    '/api/v1/market/indexes', '/api/v1/market/indexes?symbol=BTC_USDT_PERP', '/api/v1/market/fundingRates?symbol=BTC_USDT_PERP',
    '/api/v1/market/markKlines?symbol=BTC_USDT_PERP&interval=1M', '/api/v1/market/indexKlines?symbol=BTC_USDT_PERP&interval=1M',
    '/api/v1/market/openInterests', '/api/v1/common/riskTable', '/api/v1/market/bookTicker?symbol=BTC_USDT', '/api/v1/market/bookTickers',
    '/api/v1/market/tickers?type=PERP', '/api/v1/market/depth?symbol=BTC_USDT_PERP', '/api/v1/common/timestamp', '/api/v1/common/time',
  ];
  for (const p of paths) {
    const r = await get(`${API}${p}`);
    log('anchor_path', { path: p, status: r.status, ms: r.ms, text: r.text.slice(0, 140) });
    await sleep(400);
  }
}

async function book() {
  for (const limit of [5, 20, 100, 1000, 1001, 0]) {
    const r = await get(`${API}/api/v1/market/depth?symbol=BTC_USDT&limit=${limit}`);
    const d = r.body?.data;
    const bids = d?.bids ?? [];
    const asks = d?.asks ?? [];
    const bidsDesc = bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]));
    const asksAsc = asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]));
    log('rest_book', { limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: bids.length, asks: asks.length, bidsDesc, asksAsc, keys: d ? Object.keys(d) : null, updateTime: d?.updateTime ?? null, age: d?.updateTime ? r.recv - d.updateTime : null, top: [bids[0], asks[0]], err: r.body?.result === false ? r.text.slice(0, 160) : undefined });
    if (limit === 1000) keep('depth-1000.json', r.text);
    await sleep(500);
  }
  for (const sym of ['ETH_USDT', 'ZEC_USD', 'USDC_USD', 'BTC_USD']) {
    const r = await get(`${API}/api/v1/market/depth?symbol=${sym}&limit=100`);
    const d = r.body?.data;
    log('rest_book_sym', { sym, status: r.status, bids: d?.bids?.length, asks: d?.asks?.length, spread: d ? Number(d.asks[0]?.[0]) - Number(d.bids[0]?.[0]) : null, age: d?.updateTime ? r.recv - d.updateTime : null });
    await sleep(500);
  }
  const a = await get(`${API}/api/v1/market/depth?symbol=BTC_USDT&limit=20`);
  const b = await get(`${API}/api/v1/market/depth?symbol=BTC_USDT&limit=20`);
  log('rest_book_back_to_back', { sameBody: JSON.stringify(a.body.data) === JSON.stringify(b.body.data), updateTimes: [a.body.data.updateTime, b.body.data.updateTime], cacheHeaders: [a.headers['cf-cache-status'], a.headers['cache-control'] ?? null, a.headers.age ?? null] });
}

async function errors() {
  const cases = [
    '/api/v1/market/depth?symbol=NOPE_USDT', '/api/v1/market/depth', '/api/v1/market/depth?symbol=btc_usdt', '/api/v1/market/depth?symbol=BTCUSDT',
    '/api/v1/market/depth?symbol=BTC_USDT&limit=abc', '/api/v1/market/tickers?symbol=NOPE_USDT', '/api/v1/common/symbols?symbols=NOPE_USDT',
    '/api/v1/trade/allOrders?symbol=BTC_USDT', '/api/v1/account/balances', '/nope',
  ];
  for (const p of cases) {
    const r = await get(`${API}${p}`);
    log('error_case', { path: p, status: r.status, text: r.text.slice(0, 180) });
    await sleep(400);
  }
  const r = await get(`${API}/api/v1/market/depth?symbol=BTC_USDT&limit=5`);
  const limitHeaders = Object.fromEntries(Object.entries(r.headers).filter(([k]) => /limit|retry|weight|remain/i.test(k)));
  log('rate_limit_headers', { headers: limitHeaders, all: Object.keys(r.headers) });
}

async function clock() {
  const offsets = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${API}/api/v1/market/tickers?symbol=BTC_USDT`);
    const mid = (r.sent + r.recv) / 2;
    offsets.push({ offsetMs: Math.round(r.body.timestamp - mid), rttMs: r.recv - r.sent, dateHeader: r.headers.date });
    await sleep(500);
  }
  log('clock', { offsets: offsets.map((o) => o.offsetMs), rtts: offsets.map((o) => o.rttMs), date: offsets[0].dateHeader });
}

async function poll() {
  let prevBook = null;
  let prevTick = null;
  let bookChanged = 0;
  let touchChanged = 0;
  let utChanged = 0;
  let tickChanged = 0;
  let tickTimeChanged = 0;
  const bookMs = [];
  const tickMs = [];
  const ages = [];
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const b = await get(`${API}/api/v1/market/depth?symbol=BTC_USDT&limit=20`);
    const t = await get(`${API}/api/v1/market/tickers`);
    bookMs.push(b.ms);
    tickMs.push(t.ms);
    const d = b.body.data;
    if (d.updateTime) ages.push(b.recv - d.updateTime);
    const btc = t.body.data.tickers.find((x) => x.symbol === 'BTC_USDT');
    if (prevBook) {
      if (JSON.stringify(prevBook.bids) + JSON.stringify(prevBook.asks) !== JSON.stringify(d.bids) + JSON.stringify(d.asks)) bookChanged++;
      if (prevBook.bids[0][0] !== d.bids[0][0] || prevBook.asks[0][0] !== d.asks[0][0] || prevBook.bids[0][1] !== d.bids[0][1] || prevBook.asks[0][1] !== d.asks[0][1]) touchChanged++;
      if (prevBook.updateTime !== d.updateTime) utChanged++;
      if (prevTick.close !== btc.close || prevTick.count !== btc.count) tickChanged++;
      if (prevTick.time !== btc.time) tickTimeChanged++;
    }
    prevBook = d;
    prevTick = btc;
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  log('poll', {
    rounds: 60, bookChanged, touchChanged, updateTimeChanged: utChanged, tickerBtcChanged: tickChanged, tickerBtcTimeChanged: tickTimeChanged,
    bookMs: { min: Math.min(...bookMs), median: pct(bookMs, 0.5), p90: pct(bookMs, 0.9), max: Math.max(...bookMs) },
    tickersMs: { min: Math.min(...tickMs), median: pct(tickMs, 0.5), p90: pct(tickMs, 0.9), max: Math.max(...tickMs) },
    bookAgeMs: ages.length ? { min: Math.min(...ages), median: pct(ages, 0.5), max: Math.max(...ages) } : null,
  });
}

const mode = process.argv[2] ?? 'main';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'main' || mode === 'all') {
  ccxtCheck();
  await hosts();
  await catalog();
  await anchorPaths();
  await book();
  await errors();
  await clock();
}
if (mode === 'poll' || mode === 'all') await poll();
log('end', { at: new Date().toISOString() });
