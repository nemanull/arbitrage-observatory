// Bitexen REST probe: host and latency, the market catalog, the order book call, caching, clock, error shapes, and the public fee and feature flags.
// Public, unauthenticated, read-only. The documented limit is 60 requests per minute, and every mode here stays under 40 per minute.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitexen/rest-probe.mjs [latency|catalog|book|errors|context]
//   latency  resolves the host, then one cold and ten warm GET /api/v1/ticker/ 1.5 s apart, with the headers that matter. About 20 s.
//   catalog  market_info and ticker in full, per market info for a few codes, and how the listed markets split by resell_market. About 10 s.
//   book     order_book/USDTTRY every 2 s for 60 s: side lengths, level order, how often the top and the reply timestamp change, clock offset. About 62 s.
//   errors   unknown market, missing trailing slash, wrong method, lowercase code. About 10 s.
//   context  the web app's public fee reply, its derivatives feature flag here and on global.bitexen.com, the Modulus contracts call, and CCXT 4.5.68's exchange list. About 10 s.
// Recorded in docs/profiles/bitexen/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'www.bitexen.com';
const API = `https://${HOST}/api/v1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pick = (h, names) => Object.fromEntries(names.map((n) => [n, h.get(n)]).filter(([, v]) => v !== null));
const HEADERS = ['server', 'cf-cache-status', 'age', 'cache-control', 'date', 'content-type', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit-limit', 'ratelimit-remaining', 'cf-ray'];

async function get(url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const body = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(body); } catch { json = null; }
  return { status: res.status, ms, bytes: body.length, headers: res.headers, json, body, recvMs: Date.now() };
}

const quantiles = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s.at(-1) };
};

async function latency() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addresses: addrs.map((a) => a.address) });
  const cold = await get(`${API}/ticker/`);
  log('cold', { status: cold.status, ms: cold.ms, bytes: cold.bytes, headers: pick(cold.headers, HEADERS) });
  const warm = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1500);
    const r = await get(`${API}/ticker/`);
    warm.push(r.ms);
    if (i === 9) log('warm_last_headers', { headers: pick(r.headers, HEADERS) });
  }
  log('warm', quantiles(warm));
}

async function catalog() {
  const mi = await get(`${API}/market_info/`);
  const markets = mi.json?.data?.markets ?? [];
  log('market_info', { status: mi.status, ms: mi.ms, bytes: mi.bytes, count: markets.length, codes: markets.map((m) => m.market_code), resell: markets.filter((m) => m.resell_market).length, fields: Object.keys(markets[0] ?? {}) });
  for (const m of markets) log('market', m);
  await sleep(1500);
  const tk = await get(`${API}/ticker/`);
  const tickers = tk.json?.data?.ticker ?? {};
  log('ticker', { status: tk.status, ms: tk.ms, bytes: tk.bytes, keys: Object.keys(tickers), sample: Object.values(tickers)[0] ?? null, localSec: Date.now() / 1000 });
  for (const code of ['BTCTRY', 'ETHTRY', 'BTCUSDT', 'USDTTRY']) {
    await sleep(1500);
    const one = await get(`${API}/market_info/${code}/`);
    const d = one.json?.data?.markets;
    const t = await get(`${API}/ticker/${code}/`);
    log('market_one', { code, status: one.status, resell_market: d?.resell_market ?? null, maker: d?.maker_fee_ratio ?? null, taker: d?.taker_fee_ratio ?? null, min: d?.minimum_order_amount ?? null, tickerStatus: t.status, ticker: t.json?.data?.ticker === null ? null : 'present' });
  }
}

async function book() {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const r = await get(`${API}/order_book/USDTTRY/`);
    const d = r.json?.data;
    rows.push({ ms: r.ms, recvMs: r.recvMs, status: r.status, bytes: r.bytes, d, cache: r.headers.get('cf-cache-status'), date: r.headers.get('date') });
    await sleep(2000);
  }
  const ok = rows.filter((r) => r.d);
  const first = ok[0].d;
  const orderOk = (lv, side) => lv.every((l, i) => i === 0 || (side === 'bid' ? Number(l.orders_price) < Number(lv[i - 1].orders_price) : Number(l.orders_price) > Number(lv[i - 1].orders_price)));
  log('book_shape', { keys: Object.keys(first), bids: first.buyers.length, asks: first.sellers.length, trades: first.last_transactions.length, bidsDescending: orderOk(first.buyers, 'bid'), asksAscending: orderOk(first.sellers, 'ask'), topBid: first.buyers[0], topAsk: first.sellers[0], lastTrade: first.last_transactions[0], replyTimestamp: first.timestamp, tickerTimestamp: first.ticker?.timestamp, bytes: rows[0].bytes });
  let topChanged = 0, tsChanged = 0, identical = 0;
  for (let i = 1; i < ok.length; i++) {
    const a = ok[i - 1].d, b = ok[i].d;
    if (JSON.stringify([a.buyers[0], a.sellers[0]]) !== JSON.stringify([b.buyers[0], b.sellers[0]])) topChanged++;
    if (a.timestamp !== b.timestamp) tsChanged++;
    if (JSON.stringify([a.buyers, a.sellers]) === JSON.stringify([b.buyers, b.sellers])) identical++;
  }
  const offsets = ok.map((r) => Math.round(r.recvMs - Number(r.d.timestamp) * 1000));
  log('book_poll', { polls: rows.length, statuses: [...new Set(rows.map((r) => r.status))], ms: quantiles(rows.map((r) => r.ms)), cache: [...new Set(rows.map((r) => r.cache))], topChanged, replyTimestampChanged: tsChanged, bothSidesIdentical: identical, arrivalMinusReplyTimestampMs: quantiles(offsets) });
  const dateOffsets = ok.map((r) => r.recvMs - Date.parse(r.date));
  log('clock', { httpDateMinusLocalMs: quantiles(dateOffsets.map((x) => -x)), note: 'HTTP Date has 1 s resolution' });
}

async function errors() {
  const cases = [
    ['unknown market order_book', `${API}/order_book/NOPETRY/`],
    ['unknown market ticker', `${API}/ticker/NOPETRY/`],
    ['unknown market market_info', `${API}/market_info/NOPETRY/`],
    ['resell market order_book', `${API}/order_book/BTCTRY/`],
    ['lowercase order_book', `${API}/order_book/usdttry/`],
    ['no trailing slash', `${API}/order_book/USDTTRY`],
    ['POST to ticker', `${API}/ticker/`, { method: 'POST' }],
    ['server time guess', `${API}/time/`],
  ];
  for (const [label, url, init] of cases) {
    const r = await get(url, init);
    log('case', { label, status: r.status, ms: r.ms, bytes: r.bytes, contentType: r.headers.get('content-type'), body: r.json ? JSON.stringify(r.json).slice(0, 200) : r.body.replace(/\s+/g, ' ').slice(0, 120) });
    await sleep(1200);
  }
}

async function context() {
  const fees = await get(`https://${HOST}/p/v1/account/general_transaction_fees/`);
  const f = fees.json?.data?.fees ?? {};
  log('fees', { status: fees.status, maker: f.maker_fee_ratio, taker: f.taker_fee_ratio, KDV: f.KDV, minOrderFeeCurrencies: Object.keys(f.min_order_fees ?? {}).length, minOrderFeeTRY: f.min_order_fees?.TRY ?? null, minOrderFeeUSDT: f.min_order_fees?.USDT ?? null });
  await sleep(1200);
  const fs = await get(`https://${HOST}/p/v1/feature_status/`);
  log('feature_status', { status: fs.status, derivatives: fs.json?.data?.derivatives ?? 'absent', flags: Object.keys(fs.json?.data ?? {}).length });
  await sleep(1200);
  const gfs = await get('https://global.bitexen.com/p/v1/feature_status/');
  log('global_feature_status', { status: gfs.status, derivatives: gfs.json?.data?.derivatives ?? 'absent' });
  await sleep(1200);
  const gmi = await get('https://global.bitexen.com/api/v1/market_info/');
  const gm = gmi.json?.data?.markets ?? [];
  const byQuote = {};
  for (const m of gm) byQuote[m.counter_currency] = (byQuote[m.counter_currency] ?? 0) + 1;
  log('global_market_info', { status: gmi.status, count: gm.length, byQuote });
  for (const host of ['gmod-api.bitexen.com', 'gtmod2-api.bitexen.com']) {
    await sleep(1200);
    try {
      const r = await get(`https://${host}/public/contracts`);
      log('modulus_contracts', { host, status: r.status, bytes: r.bytes, cloudflareError: r.body.match(/error code:? ?(\d{4})|Error (\d{4})/i)?.slice(1).find(Boolean) ?? null, title: r.body.match(/<title>([^<]*)/)?.[1]?.trim() ?? null, server: r.headers.get('server') });
    } catch (e) {
      log('modulus_contracts', { host, error: e.cause?.code ?? e.message });
    }
  }
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, match: ccxt.exchanges.filter((x) => /bitexen|exen/i.test(x)) });
}

const mode = process.argv[2] ?? 'latency';
const modes = { latency, catalog, book, errors, context };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await modes[mode]();
