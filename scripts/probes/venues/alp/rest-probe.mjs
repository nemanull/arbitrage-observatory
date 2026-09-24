// ALP.COM REST v3 probe: host and latency, spot catalog, the tickers and currency-rates replies, the REST book, errors, and the server clock.
// Public, unauthenticated, read-only. At most two requests a second, since ALP.COM publishes no rate limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/alp/rest-probe.mjs [ccxt|latency|catalog|book|quality|poll|errors|clock|all]
//   ccxt     whether CCXT from server/node_modules has a class for the venue, by id and by URL. About 2 s.
//   latency  DNS, the edge, the first request on a new connection, then one plus ten warm requests on four calls. About 45 s.
//   catalog  pairs, currencies, tickers and currency-rates, joined per pair. About 3 s.
//   book     the REST order book at several limits, its level order, and two reads 300 ms apart. About 10 s.
//   quality  the last 50 trades against the posted touch on five pairs, and buy and sell prints that share a millisecond. About 6 s.
//   poll     tickers and currency-rates once a second for 60 s, counting how often each number changes. About 62 s.
//   errors   unknown pair, missing pair, unknown path, the retired v1 API and the old btc-alpha.com host. About 4 s.
//   clock    five reads of the server time, whose resolution is one second. About 4 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/alp/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'www.alp.com';
const API = `https://${HOST}/api/v3`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'arbitrage-observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  return { status: res.status, ms, bytes: text.length, text, headers: res.headers };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function latency() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });
  // The first request opens the TLS connection, and fetch reuses it for every later request.
  const trace = await get(`https://${HOST}/cdn-cgi/trace`);
  const t = Object.fromEntries(trace.text.trim().split('\n').map((l) => l.split('=')));
  log('edge', { colo: t.colo, loc: t.loc, http: t.http, firstRequestOnNewConnectionMs: trace.ms });
  for (const path of ['/time', '/ticker', '/pairs', '/orderbook?pair=BTC_USDC']) {
    const first = await get(API + path);
    const warm = [];
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      warm.push((await get(API + path)).ms);
    }
    log('latency', { path, status: first.status, bytes: first.bytes, firstMs: first.ms, warm: stats(warm), ray: first.headers.get('cf-ray'), cache: first.headers.get('cf-cache-status'), serverTiming: first.headers.get('server-timing') });
  }
}

async function catalog() {
  const [pairs, currencies, ticker, rates] = await Promise.all(['/pairs', '/currencies', '/ticker', '/currency-rates'].map((p) => get(API + p)));
  keep('pairs.json', pairs.text);
  keep('ticker.json', ticker.text);
  keep('currency-rates.json', rates.text);
  const P = JSON.parse(pairs.text);
  const T = new Map(JSON.parse(ticker.text).map((x) => [x.pair, x]));
  const R = JSON.parse(rates.text);
  const C = JSON.parse(currencies.text);
  log('catalog', { pairs: P.length, pairFields: Object.keys(P[0]), currencies: C.length, currencyFields: Object.keys(C[0]), tickers: T.size, tickerFields: Object.keys([...T.values()][0]), rates: Object.keys(R).length });
  const byQuote = {};
  for (const p of P) byQuote[p.currency2] = (byQuote[p.currency2] || 0) + 1;
  log('byQuote', byQuote);
  const nowS = Date.now() / 1000;
  let traded24h = 0;
  for (const p of P) {
    const t = T.get(p.name) || {};
    const spreadPpm = t.buy > 0 && t.sell > 0 ? Math.round(((t.sell - t.buy) / t.buy) * 1e6) : null;
    const ageS = t.timestamp ? Math.round(nowS - t.timestamp) : null;
    if (t.vol > 0) traded24h++;
    log('pair', { name: p.name, last: t.last, buy: t.buy, sell: t.sell, spreadPpm, vol: t.vol, lastTradeAgeS: ageS, rateBase: R[p.currency1] ?? null });
  }
  log('traded24h', { withVolume: traded24h, of: P.length });
  const twice = {};
  for (const p of P) {
    const k = [p.currency1, p.currency2].sort().join('/');
    twice[k] = (twice[k] || []).concat(p.name);
  }
  log('pairsListedBothWays', Object.values(twice).filter((v) => v.length > 1));
  const typeOf = Object.fromEntries(Object.entries([...T.values()][0]).map(([k, v]) => [k, typeof v]));
  log('tickerTypes', typeOf);
  log('rateSample', { BTC: R.BTC, ETH: R.ETH, USDT: R.USDT, USDC: R.USDC, ALP: R.ALP });
}

async function book() {
  for (const q of ['', '&limit_buy=5&limit_sell=5', '&limit_buy=50&limit_sell=50', '&limit_buy=100&limit_sell=100', '&limit_buy=1000&limit_sell=1000']) {
    for (const pair of ['BTC_USDC', 'BTC_USDT']) {
      const r = await get(`${API}/orderbook?pair=${pair}${q}`);
      const b = JSON.parse(r.text);
      const desc = b.buy.every((l, i) => i === 0 || l.price < b.buy[i - 1].price);
      const asc = b.sell.every((l, i) => i === 0 || l.price > b.sell[i - 1].price);
      log('book', { pair, q: q || 'default', status: r.status, ms: r.ms, bytes: r.bytes, bids: b.buy.length, asks: b.sell.length, bidsDescending: desc, asksAscending: asc, bestBid: b.buy[0], bestAsk: b.sell[0], priceType: typeof b.buy[0]?.price });
      await sleep(600);
    }
  }
  for (const pair of ['ALP_USDT', 'ZEC_USDC', 'GRDR_USDT', 'EURQ_USDC']) {
    const r = await get(`${API}/orderbook?pair=${pair}`);
    const b = JSON.parse(r.text);
    log('thinBook', { pair, status: r.status, bids: b.buy?.length, asks: b.sell?.length, bestBid: b.buy?.[0], bestAsk: b.sell?.[0], raw: r.bytes < 200 ? r.text : undefined });
    await sleep(600);
  }
  const a = await get(`${API}/orderbook?pair=BTC_USDC`);
  await sleep(300);
  const b = await get(`${API}/orderbook?pair=BTC_USDC`);
  log('twoReads300ms', { identical: a.text === b.text, cacheA: a.headers.get('cf-cache-status'), age: a.headers.get('age'), cacheControl: a.headers.get('cache-control') });
}

async function poll() {
  const seen = { tickerFrames: 0, rateFrames: 0 };
  let prevT = null;
  let prevR = null;
  const changes = {};
  const bump = (k) => (changes[k] = (changes[k] || 0) + 1);
  const ms = { ticker: [], rates: [] };
  const statuses = {};
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const [t, r] = await Promise.all([get(`${API}/ticker`), get(`${API}/currency-rates`)]);
    statuses[`${t.status}/${r.status}`] = (statuses[`${t.status}/${r.status}`] || 0) + 1;
    ms.ticker.push(t.ms);
    ms.rates.push(r.ms);
    if (t.status === 200 && r.status === 200) {
      const T = Object.fromEntries(JSON.parse(t.text).map((x) => [x.pair, x]));
      const R = JSON.parse(r.text);
      seen.tickerFrames++;
      seen.rateFrames++;
      if (prevT) {
        for (const p of ['BTC_USDC', 'BTC_USDT', 'ETH_USDC', 'XRP_USDC', 'LTC_USDT']) {
          if (T[p].buy !== prevT[p].buy || T[p].sell !== prevT[p].sell) bump(`ticker.${p}.bidask`);
          if (T[p].last !== prevT[p].last) bump(`ticker.${p}.last`);
        }
        for (const c of ['BTC', 'ETH', 'XRP', 'LTC', 'USDT', 'USDC', 'ALP']) if (R[c] !== prevR[c]) bump(`rate.${c}`);
      }
      prevT = T;
      prevR = R;
      if (i === 30) log('rateVsBook', { rateBTC: R.BTC, btcUsdcBid: T.BTC_USDC.buy, btcUsdcAsk: T.BTC_USDC.sell, btcUsdtBid: T.BTC_USDT.buy, btcUsdtAsk: T.BTC_USDT.sell, rateUSDT: R.USDT, rateUSDC: R.USDC });
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  log('poll', { ...seen, statuses, tickerMs: stats(ms.ticker), ratesMs: stats(ms.rates), changesOver59Intervals: changes });
}

async function errors() {
  const cases = [
    `${API}/orderbook?pair=NOPE_USDT`,
    `${API}/orderbook`,
    `${API}/ticker?pair=NOPE_USDT`,
    `${API}/nope`,
    `https://${HOST}/api/v1/pairs/`,
    'https://btc-alpha.com/api/v1/pairs/',
  ];
  for (const url of cases) {
    const res = await fetch(url, { redirect: 'manual' });
    const text = await res.text();
    log('error', { url, status: res.status, location: res.headers.get('location'), retryAfter: res.headers.get('retry-after'), body: text.slice(0, 160) });
    await sleep(600);
  }
}

async function clock() {
  const offs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/time`);
    const t1 = Date.now();
    const s = JSON.parse(r.text).serverTime;
    offs.push({ serverTime: s, localMidS: (t0 + t1) / 2000, offsetS: Math.round((s - (t0 + t1) / 2000) * 1000) / 1000, dateHeader: r.headers.get('date') });
    await sleep(700);
  }
  log('clock', { replies: offs });
}

// Where the last 50 trades printed against the posted touch, and how many buy and sell prints share a timestamp to the millisecond.
async function quality() {
  for (const pair of ['DOGE_USDT', 'XRP_USDT', 'ETH_USDT', 'BTC_USDT', 'BTC_USDC']) {
    const [b, t] = await Promise.all([get(`${API}/orderbook?pair=${pair}`), get(`${API}/trades?pair=${pair}&limit=50`)]);
    const book = JSON.parse(b.text);
    const trades = JSON.parse(t.text);
    const bid = book.buy[0]?.price ?? null;
    const ask = book.sell[0]?.price ?? null;
    const prices = trades.map((x) => x.price);
    const aboveAsk = ask === null ? null : prices.filter((x) => x > ask).length;
    const belowBid = bid === null ? null : prices.filter((x) => x < bid).length;
    let pairedWithin1ms = 0;
    for (let i = 1; i < trades.length; i++) if (Math.abs(trades[i].timestamp - trades[i - 1].timestamp) < 0.001 && trades[i].type !== trades[i - 1].type) pairedWithin1ms++;
    log('quality', { pair, bid, bidAmount: book.buy[0]?.amount, ask, askAmount: book.sell[0]?.amount, trades: trades.length, tradeMin: Math.min(...prices), tradeMax: Math.max(...prices), aboveAsk, belowBid, pairedWithin1ms, newest: trades[0], spanS: trades.length ? Math.round(trades[0].timestamp - trades[trades.length - 1].timestamp) : null });
    await sleep(1000);
  }
}

async function ccxtCheck() {
  const ccxt = require('ccxt');
  const ids = ccxt.exchanges.filter((id) => /alp|btcalpha/i.test(id));
  const byUrl = [];
  for (const id of ids) {
    const urls = JSON.stringify(new ccxt[id]().urls || {});
    byUrl.push({ id, mentionsAlpCom: /alp\.com|btc-alpha/i.test(urls) });
  }
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, idsMatchingAlp: ids, byUrl });
}

const mode = process.argv[2] || 'all';
const modes = { ccxt: ccxtCheck, latency, catalog, book, poll, errors, clock, quality };
for (const m of mode === 'all' ? ['ccxt', 'catalog', 'book', 'quality', 'errors', 'clock', 'latency', 'poll'] : [mode]) {
  log('mode', { mode: m, at: new Date().toISOString() });
  await modes[m]();
}
