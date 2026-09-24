// ChainEX REST probe: host and latency, the spot catalog, the REST book, how often the book and the summary change, error shapes and clock offset.
// Public, unauthenticated, read-only. ChainEX publishes a limit of 10 requests per second answered with HTTP 503 beyond it, so every request here waits at least 250 ms after the previous one.
// Run from server/: node ../scripts/probes/venues/chainex/rest-probe.mjs [catalog|book|poll|errors]
//   catalog  DNS, the CCXT id check, one cold and five warm timestamp calls, the market summary in four shapes, the web backend market list with its fees and ids, and the scaling fees. About 5 s, 12 requests.
//   book     the combined and single sided order books on seven markets, the 200 level limit, level order, duplicate prices, summary compare, the web backend depth call, then every market at 200 levels for depth and spread. About 10 s, about 42 requests.
//   poll     the BTC/ZAR book and the market summary, each once a second for 60 s: reply time and how often the touch changes in each. 120 requests.
//   errors   unknown market, unknown quote, unknown type, a zero limit, a lowercase symbol, an unknown path, and the clock offset from the timestamp call. About 5 s, 10 requests.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/chainex/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.chainex.io';
const APP = 'https://app.chainex.io/action'; // the backend the chainex.io pages call, anonymous GET
const OUT = process.env.PROBE_OUT_DIR;
const MIN_GAP_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

let lastRequestAt = 0;
async function get(url, name) {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const t0 = performance.now();
  const sentAt = Date.now();
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'venue-survey-probe/1.0', accept: 'application/json' } });
  } catch (e) {
    return { url, status: 0, error: String(e.cause?.code ?? e.message), ms: Math.round(performance.now() - t0) };
  }
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (OUT && name) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, name), text.slice(0, 2_000_000));
  }
  const h = (k) => res.headers.get(k);
  return {
    url, status: res.status, ms, bytes: text.length, text, json, sentAt, recvAt: Date.now(),
    headers: { date: h('date'), 'cache-control': h('cache-control'), 'cf-cache-status': h('cf-cache-status'), 'retry-after': h('retry-after'), server: h('server'), 'x-powered-by': h('x-powered-by'), 'cf-ray': h('cf-ray'), 'content-encoding': h('content-encoding') },
  };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function catalog() {
  const host = new URL(API).hostname;
  const addrs = await dns.lookup(host, { all: true });
  log('dns', { host, addrs: addrs.map((a) => a.address) });
  const appAddrs = await dns.lookup('app.chainex.io', { all: true });
  const pushAddrs = await dns.lookup('push.chainex.io', { all: true });
  log('dns', { app: appAddrs.map((a) => a.address), push: pushAddrs.map((a) => a.address) });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, chainex: ccxt.exchanges.includes('chainex'), similar: ccxt.exchanges.filter((x) => /chain|chx/.test(x)) });

  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${API}/timestamp`, i === 0 ? 'timestamp.json' : undefined);
    times.push(r.ms);
    if (i === 0) log('timestamp_cold', { status: r.status, ms: r.ms, body: r.text.slice(0, 80), headers: r.headers });
  }
  log('timestamp_warm', { cold: times[0], warm: stats(times.slice(1)) });

  const all = await get(`${API}/market/summary/`, 'summary.json');
  const rows = all.json?.data ?? [];
  const byQuote = {};
  for (const m of rows) (byQuote[m.exchange] ??= []).push(m.code);
  const nowS = Date.now() / 1000;
  const stale = rows.map((m) => ({ market: m.market, hoursSinceTrade: Math.round((nowS - Number(m.last_trade_time)) / 360) / 10 }));
  log('summary', {
    status: all.status, ms: all.ms, bytes: all.bytes, count: all.json?.count, rows: rows.length, byQuote,
    fields: rows[0] ? Object.keys(rows[0]) : [], headers: all.headers,
    types: rows[0] ? Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, typeof v])) : {},
    crossedOrLocked: rows.filter((m) => Number(m.top_bid) >= Number(m.top_ask)).map((m) => m.market),
    zeroSide: rows.filter((m) => !(Number(m.top_bid) > 0) || !(Number(m.top_ask) > 0)).map((m) => m.market),
    midCheck: rows.slice(0, 3).map((m) => ({ market: m.market, spread_price: m.spread_price, mid: (Number(m.top_bid) + Number(m.top_ask)) / 2 })),
  });
  log('last_trade_age', { overOneDay: stale.filter((x) => x.hoursSinceTrade > 24).length, hours: stale });
  log('quote_volume_24h', { rows: rows.map((m) => [m.market, m['24hvol'], m.volume_amount]) });

  for (const q of ['USDT', 'ZAR', 'BTC']) {
    const r = await get(`${API}/market/summary/${q}`);
    log('summary_by_quote', { quote: q, status: r.status, ms: r.ms, count: r.json?.count, rows: r.json?.data?.length, sample: r.text.slice(0, 160) });
  }

  const app = await get(`${APP}/getMarkets`, 'app_getMarkets.json');
  const am = app.json?.data ?? [];
  log('app_getMarkets', {
    status: app.status, ms: app.ms, bytes: app.bytes, rows: am.length, topKeys: app.json ? Object.keys(app.json) : [],
    quick_trading_fee: app.json?.quick_trading_fee,
    fees: [...new Set(am.map((m) => `${m.maker_fee}|${m.taker_fee}`))],
    ids: Object.fromEntries(am.map((m) => [m.market, m.market_id])),
    missingFromApi: am.filter((m) => !rows.some((x) => x.market === m.market)).map((m) => m.market),
    missingFromApp: rows.filter((x) => !am.some((m) => m.market === x.market)).map((x) => x.market),
  });
  const sc = await get(`${APP}/getScalingFees`, 'app_getScalingFees.json');
  log('app_getScalingFees', { status: sc.status, ms: sc.ms, body: sc.text.slice(0, 600) });
}

const BOOK_MARKETS = [['BTC', 'ZAR'], ['XRP', 'USDT'], ['ETH', 'USDT'], ['USDT', 'ZAR'], ['UNI', 'ZAR'], ['TITANX', 'USDT'], ['ZARP', 'ZAR']];

function sideShape(side) {
  const levels = (side?.orders ?? []).map((o) => ({ p: Number(o.price), a: Number(o.amount), t: Number(o.total) }));
  const prices = levels.map((l) => l.p);
  const desc = prices.every((p, i) => i === 0 || prices[i - 1] > p);
  const asc = prices.every((p, i) => i === 0 || prices[i - 1] < p);
  const dupPrices = prices.length - new Set(prices).size;
  const totalMismatch = levels.filter((l) => Math.abs(l.p * l.a - l.t) > Math.max(0.011, l.t * 0.001)).length;
  return { type: side?.type, count: side?.count, levels: levels.length, first: levels[0], last: levels[levels.length - 1], order: desc ? 'descending' : asc ? 'ascending' : 'unordered', dupPrices, totalMismatch };
}

async function book() {
  const summary = await get(`${API}/market/summary/`);
  const sum = Object.fromEntries((summary.json?.data ?? []).map((m) => [m.market, m]));
  for (const [c, e] of BOOK_MARKETS) {
    const r = await get(`${API}/market/orders/${c}/${e}/ALL`, `orders_${c}_${e}.json`);
    const [buy, sell] = [r.json?.data?.find((s) => s.type === 'buy'), r.json?.data?.find((s) => s.type === 'sell')];
    const s = sum[`${c}/${e}`];
    log('orders_all', {
      market: `${c}/${e}`, status: r.status, ms: r.ms, bytes: r.bytes, headers: { 'cache-control': r.headers['cache-control'], 'cf-cache-status': r.headers['cf-cache-status'] },
      sideTypes: r.json?.data?.map((x) => x.type), buy: sideShape(buy), sell: sideShape(sell),
      summaryTop: s ? [s.top_bid, s.top_ask] : null,
      bookTop: [buy?.orders?.[0]?.price ?? null, sell?.orders?.[0]?.price ?? null],
      priceType: typeof buy?.orders?.[0]?.price,
    });
  }
  for (const lim of [200, 500]) {
    const r = await get(`${API}/market/orders/BTC/ZAR/ALL/${lim}`, `orders_BTC_ZAR_ALL_${lim}.json`);
    const [buy, sell] = [r.json?.data?.find((s) => s.type === 'buy'), r.json?.data?.find((s) => s.type === 'sell')];
    log('orders_limit', { limit: lim, status: r.status, ms: r.ms, bytes: r.bytes, buy: sideShape(buy), sell: sideShape(sell), body: r.json ? undefined : r.text.slice(0, 200) });
  }
  for (const t of ['BUY', 'SELL']) {
    const r = await get(`${API}/market/orders/BTC/ZAR/${t}/5`);
    log('orders_single', { type: t, status: r.status, ms: r.ms, dataType: Array.isArray(r.json?.data) ? 'array' : typeof r.json?.data, sample: r.text.slice(0, 260) });
  }
  const tr = await get(`${API}/market/trades/BTC/ZAR/5`);
  log('trades', { status: tr.status, ms: tr.ms, sample: tr.text.slice(0, 400) });
  const st = await get(`${API}/market/stats/BTC/ZAR`);
  log('stats', { status: st.status, ms: st.ms, fields: st.json?.data ? Object.keys(st.json.data) : null });
  const d = await get(`${APP}/getOrderDepth?perPage=50&pageNo=0&orderBy=price&market=57&decimals=2`, 'app_getOrderDepth_57.json');
  const j = d.json ?? {};
  log('app_getOrderDepth', {
    status: d.status, ms: d.ms, bytes: d.bytes, keys: Object.keys(j), response: j.response,
    buy: Array.isArray(j.buy) ? { n: j.buy.length, first: j.buy[0], keys: j.buy[0] ? Object.keys(j.buy[0]) : [] } : j.buy,
    sell: Array.isArray(j.sell) ? { n: j.sell.length, first: j.sell[0] } : j.sell,
    body: d.json ? undefined : d.text.slice(0, 200),
  });
  const depth = [];
  for (const m of summary.json?.data ?? []) {
    const r = await get(`${API}/market/orders/${m.code}/${m.exchange}/ALL/200`);
    const buy = r.json?.data?.find((x) => x.type === 'buy')?.orders ?? [];
    const sell = r.json?.data?.find((x) => x.type === 'sell')?.orders ?? [];
    const bid = Number(buy[0]?.price);
    const ask = Number(sell[0]?.price);
    depth.push({ market: m.market, status: r.status, bids: buy.length, asks: sell.length, spreadBps: bid > 0 && ask > 0 ? Math.round(((ask - bid) / ((ask + bid) / 2)) * 1e4) : null, touchQuote: [Math.round(bid * Number(buy[0]?.amount ?? 0) * 100) / 100, Math.round(ask * Number(sell[0]?.amount ?? 0) * 100) / 100] });
  }
  log('depth_scan', {
    markets: depth.length,
    atLeast20BothSides: depth.filter((d) => d.bids >= 20 && d.asks >= 20).map((d) => d.market),
    atMost5OneSide: depth.filter((d) => d.bids <= 5 || d.asks <= 5).map((d) => d.market),
    atMost2BothSides: depth.filter((d) => d.bids <= 2 && d.asks <= 2).map((d) => d.market),
    over50OneSide: depth.filter((d) => d.bids > 50 || d.asks > 50).map((d) => d.market),
    spreadBps: stats(depth.filter((d) => d.spreadBps !== null).map((d) => d.spreadBps)),
    rows: depth.map((d) => `${d.market} ${d.bids}/${d.asks} ${d.spreadBps}bps touch ${d.touchQuote.join('/')}`),
  });
  const deep = depth.filter((d) => d.bids > 50 || d.asks > 50)[0];
  if (deep) {
    const [c, e] = deep.market.split('/');
    const r = await get(`${API}/market/orders/${c}/${e}/ALL`);
    log('default_limit', { market: deep.market, bidsAt200: deep.bids, asksAt200: deep.asks, bidsDefault: r.json?.data?.find((x) => x.type === 'buy')?.orders?.length, asksDefault: r.json?.data?.find((x) => x.type === 'sell')?.orders?.length });
  }
}

async function poll() {
  const book = [];
  const summ = [];
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const t = Date.now();
    const b = await get(`${API}/market/orders/BTC/ZAR/ALL/20`);
    const buy = b.json?.data?.find((s) => s.type === 'buy')?.orders ?? [];
    const sell = b.json?.data?.find((s) => s.type === 'sell')?.orders ?? [];
    book.push({ ms: b.ms, status: b.status, bid: buy[0]?.price, ask: sell[0]?.price, top20: JSON.stringify([buy, sell]) });
    const s = await get(`${API}/market/summary/`);
    const row = s.json?.data?.find((m) => m.market === 'BTC/ZAR');
    const xrp = s.json?.data?.find((m) => m.market === 'XRP/USDT');
    summ.push({ ms: s.ms, status: s.status, bid: row?.top_bid, ask: row?.top_ask, last: row?.last_price, xrp: `${xrp?.top_bid}|${xrp?.top_ask}`, all: JSON.stringify(s.json?.data?.map((m) => [m.top_bid, m.top_ask])) });
    const wait = t + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  }
  const changes = (xs, f) => xs.reduce((n, x, i) => n + (i > 0 && f(x) !== f(xs[i - 1]) ? 1 : 0), 0);
  log('poll_book', { polls: book.length, statuses: [...new Set(book.map((x) => x.status))], ms: stats(book.map((x) => x.ms)), touchChanges: changes(book, (x) => `${x.bid}|${x.ask}`), top20Changes: changes(book, (x) => x.top20), firstTouch: [book[0]?.bid, book[0]?.ask], lastTouch: [book.at(-1)?.bid, book.at(-1)?.ask] });
  log('poll_summary', { polls: summ.length, statuses: [...new Set(summ.map((x) => x.status))], ms: stats(summ.map((x) => x.ms)), btcZarTouchChanges: changes(summ, (x) => `${x.bid}|${x.ask}`), xrpUsdtTouchChanges: changes(summ, (x) => x.xrp), anyTouchChanges: changes(summ, (x) => x.all), firstTouch: [summ[0]?.bid, summ[0]?.ask] });
  const disagree = book.filter((x, i) => summ[i] && (x.bid !== summ[i].bid || x.ask !== summ[i].ask)).length;
  log('poll_compare', { pairs: Math.min(book.length, summ.length), bookVsSummaryTouchDisagree: disagree });
}

async function errors() {
  const cases = [
    ['unknown market', `${API}/market/orders/NOPE/ZAR/ALL`],
    ['unknown quote', `${API}/market/orders/BTC/USD/ALL`],
    ['unknown type', `${API}/market/orders/BTC/ZAR/BOTH`],
    ['limit 0', `${API}/market/orders/BTC/ZAR/ALL/0`],
    ['lowercase', `${API}/market/orders/btc/zar/ALL/3`],
    ['unknown path', `${API}/market/nope`],
    ['stats unknown', `${API}/market/stats/NOPE/ZAR`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, url: url.replace(API, ''), status: r.status, ms: r.ms, retryAfter: r.headers['retry-after'], body: r.text.slice(0, 240) });
  }
  const offsets = [];
  for (let i = 0; i < 3; i++) {
    const r = await get(`${API}/timestamp`);
    const server = Number(r.json?.data) * 1000;
    const local = (r.sentAt + r.recvAt) / 2;
    offsets.push({ serverMinusLocalMs: Math.round(server - local), rttMs: r.recvAt - r.sentAt, dateHeader: r.headers.date });
  }
  log('clock', { note: 'server time has 1 s resolution, so the offset is only known to within about 1 s', offsets });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, book, poll, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, expected one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
