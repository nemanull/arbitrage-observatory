// BTCBOX public REST probe: CCXT catalog mapping, host latency, the depth book, a minute of one second polls, error shapes, and server time.
// Public, unauthenticated, read-only. BTCBOX publishes no request limit for its public calls, and this probe stays at about three requests a second or less, except one burst of ten sequential requests.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btcbox/rest-probe.mjs [catalog|latency|book|poll|errors|time|all]
//   catalog  CCXT 4.5.68 loadMarkets without credentials, then the market fields the engine reads, against the tickers keys and the coinInfo flags.
//   latency  one cold and twenty warm requests to tickers, depth and coinInfo, with the resolved address and the Cloudflare edge.
//   book     depth for every coin: level count, level order on the wire, touch against the ticker, crossed or locked books.
//   poll     tickers and the BTC depth once a second for 60 s: how often each number changes, and reply times.
//   errors   unknown coin, unknown path, wrong case, and a burst of ten sequential tickers requests.
//   time     the Date header against the local clock, and the web client's server time call.
//   all      every mode except poll.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/btcbox/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://www.btcbox.co.jp/api/v1';
const WEB = 'https://www.btcbox.co.jp';
const COINS = ['btc', 'bch', 'ltc', 'eth', 'doge', 'dot', 'trx'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const ms = (x) => Math.round(x);

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const t1 = performance.now();
  let json;
  try {
    json = JSON.parse(text.trim());
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json, ms: t1 - t0, padded: text !== text.trim() };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: ms(s[0]), median: ms(q(0.5)), p90: ms(q(0.9)), max: ms(s[s.length - 1]) };
}

async function catalog() {
  const ex = new ccxt.btcbox();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  log('ccxt_load_markets', { ms: ms(performance.now() - t0), count: Object.keys(markets).length, version: ccxt.version });
  const tickers = await get(`${API}/tickers`);
  const info = await get(`${WEB}/ajax/coin/coinInfo`);
  keep('tickers.json', tickers.text);
  keep('coininfo.json', info.text);
  for (const m of Object.values(markets)) {
    log('ccxt_market', {
      id: m.id,
      symbol: m.symbol,
      base: m.base,
      quote: m.quote,
      type: m.type,
      spot: m.spot,
      swap: m.swap,
      active: m.active,
      taker: m.taker,
      maker: m.maker,
      contractSize: m.contractSize,
      linear: m.linear,
      pricePrecision: m.precision.price,
      tickersKey: Object.keys(tickers.json).find((k) => k.split('_')[0].toLowerCase() === m.id),
      tradeEnable: info.json?.data?.[m.id]?.trade?.enable,
      vendEnable: info.json?.data?.[m.id]?.vend?.enable,
    });
  }
  log('tickers_keys', { keys: Object.keys(tickers.json) });
  log('ccxt_has', { swap: ex.has.swap, future: ex.has.future, margin: ex.has.margin, ws: ex.has.ws, pro: ex.pro, proClass: typeof ccxt.pro?.btcbox });
}

async function latency() {
  const addrs = await lookup('www.btcbox.co.jp', { all: true });
  log('dns', { addrs: addrs.map((a) => a.address) });
  const trace = await get(`${WEB}/cdn-cgi/trace`);
  const kv = Object.fromEntries(trace.text.trim().split('\n').map((l) => l.split('=')));
  log('edge', { colo: kv.colo, loc: kv.loc, http: kv.http });
  for (const [name, url] of [
    ['tickers', `${API}/tickers`],
    ['depth_btc', `${API}/depth`],
    ['coininfo', `${WEB}/ajax/coin/coinInfo`],
  ]) {
    const times = [];
    let bytes = 0;
    let ray = '';
    for (let i = 0; i < 21; i++) {
      const r = await get(url);
      if (i === 0) log('first_request', { name, status: r.status, ms: ms(r.ms), bytes: r.text.length, contentType: r.headers.get('content-type'), cache: r.headers.get('cf-cache-status'), cacheControl: r.headers.get('cache-control'), padded: r.padded });
      else times.push(r.ms);
      bytes = r.text.length;
      ray = r.headers.get('cf-ray');
      await sleep(250);
    }
    log('warm', { name, bytes, ray, ...stats(times) });
  }
}

function orderOf(levels) {
  let asc = true;
  let desc = true;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i][0] < levels[i - 1][0]) asc = false;
    if (levels[i][0] > levels[i - 1][0]) desc = false;
  }
  return levels.length < 2 ? 'single' : asc ? 'ascending' : desc ? 'descending' : 'unordered';
}

async function book() {
  const tickers = (await get(`${API}/tickers`)).json;
  for (const coin of COINS) {
    const r = await get(`${API}/depth?coin=${coin}`);
    keep(`depth_${coin}.json`, r.text);
    const { asks = [], bids = [] } = r.json ?? {};
    const bestAsk = Math.min(...asks.map((l) => l[0]));
    const bestBid = Math.max(...bids.map((l) => l[0]));
    const t = tickers[`${coin.toUpperCase()}_JPY`];
    const typeOf = (v) => (typeof v === 'string' ? 'string' : Number.isInteger(v) ? 'int' : 'number');
    log('depth', {
      coin,
      status: r.status,
      ms: ms(r.ms),
      bytes: r.text.length,
      asks: asks.length,
      bids: bids.length,
      askOrder: orderOf(asks),
      bidOrder: orderOf(bids),
      firstAsk: asks[0],
      lastAsk: asks[asks.length - 1],
      firstBid: bids[0],
      lastBid: bids[bids.length - 1],
      bestBid,
      bestAsk,
      spreadPpm: Math.round(((bestAsk - bestBid) / bestBid) * 1e6),
      locked: bestAsk === bestBid,
      crossed: bestAsk < bestBid,
      askFarPct: asks.length ? Math.round(((Math.max(...asks.map((l) => l[0])) / bestAsk - 1) * 1e4)) / 100 : null,
      bidFarPct: bids.length ? Math.round(((1 - Math.min(...bids.map((l) => l[0])) / bestBid) * 1e4)) / 100 : null,
      tickerBuy: t?.buy,
      tickerSell: t?.sell,
      priceType: asks[0] ? typeOf(asks[0][0]) : null,
      sizeType: asks[0] ? typeOf(asks[0][1]) : null,
    });
    await sleep(500);
  }
  // The web client's own depth call, to see whether the public API trims the book.
  const [api, web] = await Promise.all([get(`${API}/depth`), get(`${WEB}/ajax/coin/depth/type/btc`)]);
  const [webBids, webAsks] = web.json?.data?.[0] ?? [[], []];
  const apiBidPrices = (api.json?.bids ?? []).map((l) => l[0]).sort((a, b) => b - a);
  const apiAskPrices = (api.json?.asks ?? []).map((l) => l[0]).sort((a, b) => a - b);
  log('web_depth_btc', {
    status: web.status,
    apiBids: apiBidPrices.length,
    apiAsks: apiAskPrices.length,
    webBids: webBids.length,
    webAsks: webAsks.length,
    sameBidPrices: JSON.stringify(apiBidPrices) === JSON.stringify(webBids.map((l) => l[0])),
    sameAskPrices: JSON.stringify(apiAskPrices) === JSON.stringify(webAsks.map((l) => l[0])),
    apiOnlyAsks: apiAskPrices.filter((p) => !webAsks.some((l) => l[0] === p)),
    apiOnlyBids: apiBidPrices.filter((p) => !webBids.some((l) => l[0] === p)),
    webFirstBid: webBids[0],
    webFirstAsk: webAsks[0],
  });
  const ex = new ccxt.btcbox();
  await ex.loadMarkets();
  const ob = await ex.fetchOrderBook('ETH/JPY');
  log('ccxt_order_book', { symbol: 'ETH/JPY', bids: ob.bids.length, asks: ob.asks.length, bestBid: ob.bids[0], bestAsk: ob.asks[0] });
}

async function poll() {
  const last = {};
  const changes = {};
  const tTimes = [];
  const dTimes = [];
  let lastDepth = '';
  let depthChanges = 0;
  let lastTouch = '';
  let touchChanges = 0;
  let bad = 0;
  const start = Date.now();
  let polls = 0;
  while (Date.now() - start < 60_000) {
    const tick = Date.now();
    const [t, d] = await Promise.all([get(`${API}/tickers`), get(`${API}/depth`)]);
    polls++;
    if (t.status !== 200 || d.status !== 200) bad++;
    tTimes.push(t.ms);
    dTimes.push(d.ms);
    for (const [k, v] of Object.entries(t.json ?? {})) {
      for (const f of ['buy', 'sell', 'last', 'vol']) {
        const key = `${k}.${f}`;
        if (last[key] !== undefined && last[key] !== v[f]) changes[key] = (changes[key] ?? 0) + 1;
        last[key] = v[f];
      }
    }
    if (lastDepth && lastDepth !== d.text) depthChanges++;
    lastDepth = d.text;
    const bb = Math.max(...(d.json?.bids ?? []).map((l) => l[0]));
    const ba = Math.min(...(d.json?.asks ?? []).map((l) => l[0]));
    const touch = `${bb}/${ba}`;
    if (lastTouch && lastTouch !== touch) touchChanges++;
    lastTouch = touch;
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  log('poll_summary', { polls, bad, depthBodyChanges: depthChanges, btcTouchChanges: touchChanges });
  log('poll_tickers_ms', stats(tTimes));
  log('poll_depth_ms', stats(dTimes));
  log('poll_ticker_changes', changes);
}

async function errors() {
  const cases = [
    ['depth unknown coin', `${API}/depth?coin=nope`],
    ['ticker unknown coin', `${API}/ticker?coin=nope`],
    ['orders unknown coin', `${API}/orders?coin=nope`],
    ['depth upper case', `${API}/depth?coin=ETH`],
    ['depth pair id', `${API}/depth?coin=eth_jpy`],
    ['depth disabled coin', `${API}/depth?coin=doge`],
    ['unknown path', `${API}/nope`],
    ['tickers v2', 'https://www.btcbox.co.jp/api/v2/tickers'],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, contentType: r.headers.get('content-type'), body: r.text.slice(0, 160) });
    await sleep(500);
  }
  const statuses = {};
  const times = [];
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) {
    const r = await get(`${API}/tickers`);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    times.push(r.ms);
    if (r.status !== 200) log('burst_refusal', { status: r.status, retryAfter: r.headers.get('retry-after'), body: r.text.slice(0, 160) });
  }
  log('burst', { requests: 10, wallMs: ms(performance.now() - t0), statuses, ...stats(times) });
}

async function time() {
  // The Date header has one second resolution, so requests sent at ten phases of the second bound the clock offset from both sides.
  let lo = -Infinity;
  let hi = Infinity;
  for (let i = 0; i < 10; i++) {
    await sleep(((i * 100 - (Date.now() % 1000)) + 2000) % 1000);
    const before = Date.now();
    const r = await get(`${API}/ticker`);
    const after = Date.now();
    const server = Date.parse(r.headers.get('date'));
    lo = Math.max(lo, server - after);
    hi = Math.min(hi, server + 1000 - before);
  }
  log('date_header_offset_ms', { note: 'server minus local, from the Date header', lowerBound: lo, upperBound: hi });
  for (const method of ['GET', 'POST']) {
    const before = Date.now();
    const r = await get(`${WEB}/ajax/trade/servertime`, { method });
    const after = Date.now();
    log('web_servertime', { method, status: r.status, contentType: r.headers.get('content-type'), body: r.text.slice(0, 160), localMidMs: Math.round((before + after) / 2) });
    await sleep(500);
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, latency, book, poll, errors, time };
if (mode === 'all') {
  for (const name of ['catalog', 'latency', 'book', 'errors', 'time']) {
    log('mode', { name, at: new Date().toISOString() });
    await modes[name]();
  }
} else {
  log('mode', { name: mode, at: new Date().toISOString() });
  await modes[mode]();
}
