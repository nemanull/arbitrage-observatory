// Kanga Global REST probe: hosts and latency, the spot catalog on every public listing call, fees, the operator-quoted futures list, the REST book polled at one hertz, error shapes, a gentle burst and the clock offset.
// Public, unauthenticated and read-only. The POST calls are the listing reads the web app makes before login, with an empty body.
// Kanga publishes no rate limit, so every mode sends at most 5 requests in any one second, most of the time one.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/kanga/rest-probe.mjs [main|poll|all]
//   main  hosts and latency, catalog, fees, futures list, errors, a 20 request burst at 5 per second, clock, about 40 s
//   poll  130 rounds one second apart of GET orderbook/raw on three markets and the BTC-USDC futures price, with book age, refresh steps and change counts, about 135 s
//   all   both
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/kanga/rest.md and docs/profiles/kanga/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.kanga.global';
const HOSTS = ['api.kanga.global', 'public.kanga.global', 'trade.kanga.global', 'ws.kanga.global', 'public.kanga.exchange', 'trade.kanga.exchange'];
const OUT = process.env.PROBE_OUT_DIR;
const MODE = process.argv[2] ?? 'main';
const ROUNDS = 130; // the REST book snapshot refreshed about every two minutes on 2026-09-22, so a poll must span one refresh
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function call(url, { method = 'GET', body } = {}) {
  const t0 = performance.now();
  const init = { method, headers: { accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers, arrived: Date.now() };
}

function rateHeaders(h) {
  const out = {};
  for (const [k, v] of h) if (/rate|limit|retry|cache|age|cf-ray/i.test(k)) out[k] = v;
  return out;
}

async function hosts() {
  for (const h of HOSTS) {
    const addrs = await dns.lookup(h, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host: h, addrs: addrs.map((a) => a.address) });
  }
  for (const [label, url] of [
    ['api pairs', `${API}/api/v2/market/pairs`],
    ['public pairs', 'https://public.kanga.global/api/v2/market/pairs'],
    ['trade pairs', 'https://trade.kanga.global/api/v2/market/pairs'],
  ]) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const r = await call(url);
      times.push(r.ms);
      if (i === 0) log('first', { label, status: r.status, ms: r.ms, bytes: r.bytes, headers: rateHeaders(r.headers) });
      await sleep(300);
    }
    log('latency', { label, coldMs: times[0], warmMs: times.slice(1) });
  }
  const redirect = await fetch('https://trade.kanga.exchange/market/BTC-USDT', { redirect: 'manual' });
  log('trade.kanga.exchange', { status: redirect.status, location: redirect.headers.get('location') });
}

async function catalog() {
  const markets = await call(`${API}/api/markets`, { method: 'POST', body: {} });
  keep('markets.json', markets.text);
  const items = markets.json.items;
  const count = (arr, f) => arr.reduce((o, x) => ((o[f(x)] = (o[f(x)] ?? 0) + 1), o), {});
  log('markets', {
    status: markets.status, ms: markets.ms, bytes: markets.bytes, result: markets.json.result, n: items.length,
    types: count(items, (x) => x.type), quotes: count(items, (x) => x.payingCurrency),
    kycRequired: items.filter((x) => x.kycRequired).map((x) => x.id),
    notOpen: items.filter((x) => new Date(x.bidsAvailableSince) > Date.now() || new Date(x.asksAvailableSince) > Date.now()).map((x) => x.id),
    sample: items.find((x) => x.id === 'BTC-USDT'),
  });
  const view = await call('https://trade.kanga.global/api/market/view/list', { method: 'POST', body: {} });
  const list = view.json.list;
  log('view', {
    status: view.status, bytes: view.bytes, n: list.length, hidden: list.filter((x) => x.hidden).map((x) => x.id),
    customFee: list.filter((x) => 'customMarketFeeRate' in x).map((x) => `${x.id}=${x.customMarketFeeRate}`),
  });
  const ids = new Set(items.map((x) => x.id));
  const pairs = await call(`${API}/api/v2/market/pairs`);
  const ticker = await call(`${API}/api/v2/market/ticker`);
  const tickers = await call(`${API}/api/v2/market/tickers`);
  const summary = await call(`${API}/api/v2/market/summary`);
  keep('ticker.json', ticker.text);
  const tk = Object.keys(ticker.json);
  log('listing calls', {
    pairs: { n: pairs.json.length, ms: pairs.ms, bytes: pairs.bytes, sample: pairs.json[0], dashIdsMatch: pairs.json.filter((p) => ids.has(p.ticker_id.replace('_', '-'))).length },
    ticker: { n: tk.length, ms: ticker.ms, bytes: ticker.bytes, inMarkets: tk.filter((k) => ids.has(k)).length, notInMarkets: tk.filter((k) => !ids.has(k)).slice(0, 12), sample: ticker.json['BTC-USDT'] },
    tickers: { n: tickers.json.length, ms: tickers.ms, bytes: tickers.bytes, keys: Object.keys(tickers.json[0]) },
    summary: { n: summary.json.summary?.length, ms: summary.ms, bytes: summary.bytes, keys: Object.keys(summary.json.summary?.[0] ?? {}) },
  });
  const usdFamily = items.filter((x) => ['USDT', 'USDC', 'oUSD'].includes(x.payingCurrency));
  const byBase = count(usdFamily, (x) => x.buyingCurrency);
  log('usd family', { n: usdFamily.length, bases: Object.keys(byBase).length, listedTwice: Object.values(byBase).filter((n) => n > 1).length });
  log('ccxt', { version: ccxt.version, classes: ccxt.exchanges.length, kanga: ccxt.exchanges.filter((e) => /kanga/i.test(e)) });
}

async function fees() {
  const assets = await call(`${API}/api/v2/market/assets`);
  const vals = Object.values(assets.json);
  const mt = vals.reduce((o, a) => ((o[`${a.maker_fee}/${a.taker_fee}`] = (o[`${a.maker_fee}/${a.taker_fee}`] ?? 0) + 1), o), {});
  log('assets fees', { status: assets.status, n: vals.length, makerSlashTaker: mt });
  const disc = await call('https://trade.kanga.global/api/pos/transaction/fee/discounts/get', { method: 'POST', body: {} });
  log('fee discounts', { status: disc.status, body: disc.json });
  const fut = await call('https://trade.kanga.global/futures/api/markets/list', { method: 'POST', body: {} });
  keep('futures-markets.json', fut.text);
  const fm = fut.json.markets;
  log('futures list', {
    status: fut.status, ms: fut.ms, bytes: fut.bytes, result: fut.json.result, n: fm.length, keys: Object.keys(fm[0]),
    quotes: [...new Set(fm.map((m) => m.payingCurrency))], markets: fm.map((m) => m.market),
    feeRates: fm.map((m) => `${m.market} ${m.feeRates.orderOpen}/${m.feeRates.orderClose}/${m.feeRates.fundingLong}/${m.feeRates.fundingShort}/${m.feeRates.liquidation}`),
  });
  const price = await call('https://trade.kanga.global/futures/api/markets/price/get', { method: 'POST', body: { market: 'BTC-USDC' } });
  const spot = await call(`${API}/api/v2/market/orderbook/raw?market=BTC-USDC`);
  const bid = Number(spot.json.bids[0][0]);
  const ask = Number(spot.json.asks[0][0]);
  const f = Number(price.json.price);
  log('futures price vs spot', { futures: price.json, spotBid: bid, spotAsk: ask, ppmFromSpotMid: Math.round((f / ((bid + ask) / 2) - 1) * 1e6) });
}

async function errors() {
  const cases = [
    ['raw unknown', `${API}/api/v2/market/orderbook/raw?market=NOPE-USDT`],
    ['raw underscore id', `${API}/api/v2/market/orderbook/raw?market=BTC_USDT`],
    ['raw no market', `${API}/api/v2/market/orderbook/raw`],
    ['depth unknown', `${API}/api/v2/market/depth?market=NOPE-USDT`],
    ['changes unknown', `${API}/api/v2/market/changes?market=NOPE-USDT`],
    ['trades unknown', `${API}/api/v2/market/trades?market=NOPE-USDT`],
    ['markets by GET', `${API}/api/markets`],
    ['unknown path', `${API}/api/v2/market/nope`],
    ['cg orderbook path form', 'https://public.kanga.global/api/v2/market/orderbook/BTC_USDT'],
    ['cg orderbook depth 5', 'https://public.kanga.global/api/v2/market/orderbook/BTC_USDT?depth=5'],
    ['raw with a nonce parameter', `${API}/api/v2/market/orderbook/raw?market=BTC-USDT&nonce=${Date.now()}`],
    ['raw on public host', 'https://public.kanga.global/api/v2/market/orderbook/raw?market=BTC-USDT'],
    ['cg orderbook path form on api host', `${API}/api/v2/market/orderbook/BTC_USDT`],
  ];
  for (const [label, url] of cases) {
    const r = await call(url);
    log('error case', { label, status: r.status, bytes: r.bytes, body: r.text.slice(0, 160) });
    await sleep(250);
  }
}

async function burst() {
  const statuses = {};
  const times = [];
  let hdr;
  for (let i = 0; i < 20; i++) {
    const r = await call(`${API}/api/v2/market/changes?market=BTC-USDT`);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    times.push(r.ms);
    hdr ??= rateHeaders(r.headers);
    await sleep(200);
  }
  log('burst 20 at 5 per second', { statuses, medianMs: pct(times, 0.5), maxMs: Math.max(...times), headers: hdr });
}

async function clock() {
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await call(`${API}/api/v2/market/orderbook/raw?market=BTC-USDT`);
    const mid = (t0 + r.arrived) / 2;
    const date = Date.parse(r.headers.get('date'));
    log('clock', { dateHeader: r.headers.get('date'), localMid: new Date(mid).toISOString(), offsetMsAtOneSecondResolution: date - Math.floor(mid / 1000) * 1000, bookTimestampAgeMs: r.arrived - r.json.timestamp });
    await sleep(1100);
  }
}

async function bookCompare() {
  const raw = await call(`${API}/api/v2/market/orderbook/raw?market=BTC-USDT`);
  const depth = await call(`${API}/api/v2/market/depth?market=BTC-USDT`);
  const desc = (a) => a.every((x, i) => i === 0 || Number(a[i - 1]) >= Number(x));
  const asc = (a) => a.every((x, i) => i === 0 || Number(a[i - 1]) <= Number(x));
  const dp = (side) => depth.json[side].map((l) => l.price);
  log('raw book', {
    ms: raw.ms, bytes: raw.bytes, keys: Object.keys(raw.json), bids: raw.json.bids.length, asks: raw.json.asks.length,
    bidsDescending: desc(raw.json.bids.map((l) => l[0])), asksAscending: asc(raw.json.asks.map((l) => l[0])),
    ageMs: raw.arrived - raw.json.timestamp, top: [raw.json.bids[0], raw.json.asks[0]],
  });
  log('depth book', {
    ms: depth.ms, bytes: depth.bytes, bids: depth.json.bids.length, asks: depth.json.asks.length, timestamp: depth.json.timestamp,
    ageMs: depth.arrived - Date.parse(depth.json.timestamp),
    bidsDescending: desc(dp('bids')), asksAscending: asc(dp('asks')), asksDescending: desc(dp('asks')),
    firstAsks: depth.json.asks.slice(0, 2), lastAsks: depth.json.asks.slice(-2), firstBids: depth.json.bids.slice(0, 2),
  });
  const changes = await call(`${API}/api/v2/market/changes?market=BTC-USDT`);
  log('changes', { ms: changes.ms, body: changes.json, ageMs: changes.arrived - Date.parse(changes.json.timestamp) });
  const tickers = await call(`${API}/api/v2/market/tickers`);
  const summary = await call(`${API}/api/v2/market/summary`);
  const t = tickers.json.find((x) => x.ticker_id === 'BTC_USDT');
  const sm = summary.json.summary.find((x) => x.trading_pairs === 'BTC-USDT');
  log('bulk bid and ask against raw', { rawTop: [raw.json.bids[0][0], raw.json.asks[0][0]], tickers: [t?.bid, t?.ask], summary: [sm?.highest_bid, sm?.lowest_ask], summaryTimestamp: summary.json.timestamp });
}

async function poll() {
  const markets = ['BTC-USDT', 'ETH-USDC', 'NEAR-USDT'];
  const state = Object.fromEntries(markets.map((m) => [m, { ms: [], ages: [], tsChanges: 0, topChanges: 0, lastTs: null, lastTop: null, lastAge: null, statuses: {}, refreshes: [] }]));
  const fut = { prices: [], changes: 0, ms: [] };
  for (let round = 0; round < ROUNDS; round++) {
    const t0 = Date.now();
    // The futures price is the only number Kanga publishes that a position settles against, so its cadence is recorded beside the book.
    const f = await call('https://trade.kanga.global/futures/api/markets/price/get', { method: 'POST', body: { market: 'BTC-USDC' } });
    if (f.status === 200) {
      if (fut.prices.length && f.json.price !== fut.prices.at(-1)) fut.changes++;
      fut.prices.push(f.json.price);
      fut.ms.push(f.ms);
    }
    for (const m of markets) {
      const r = await call(`${API}/api/v2/market/orderbook/raw?market=${m}`);
      const s = state[m];
      s.statuses[r.status] = (s.statuses[r.status] ?? 0) + 1;
      if (r.status !== 200) continue;
      s.ms.push(r.ms);
      s.ages.push(r.arrived - r.json.timestamp);
      const top = JSON.stringify([r.json.bids[0], r.json.asks[0]]);
      if (s.lastTs !== null && r.json.timestamp !== s.lastTs) {
        s.tsChanges++;
        // The last age seen before a new snapshot bounds the refresh period from below, and the step between timestamps measures it.
        s.refreshes.push({ at: new Date(r.arrived).toISOString().slice(11, 19), lastAgeBefore: s.lastAge, newAge: r.arrived - r.json.timestamp, stepMs: r.json.timestamp - s.lastTs, topChanged: top !== s.lastTop });
      }
      if (s.lastTop !== null && top !== s.lastTop) s.topChanges++;
      s.lastTs = r.json.timestamp;
      s.lastTop = top;
      s.lastAge = r.arrived - r.json.timestamp;
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  for (const m of markets) {
    const s = state[m];
    log('poll', {
      market: m, statuses: s.statuses, msMin: Math.min(...s.ms), msMedian: pct(s.ms, 0.5), msP90: pct(s.ms, 0.9), msMax: Math.max(...s.ms),
      ageMin: Math.min(...s.ages), ageMedian: pct(s.ages, 0.5), ageMax: Math.max(...s.ages), timestampChanges: s.tsChanges, topChanges: s.topChanges,
      refreshes: s.refreshes,
    });
  }
  log('futures price poll', { market: 'BTC-USDC', polls: fut.prices.length, changes: fut.changes, msMedian: pct(fut.ms, 0.5), msMax: Math.max(...fut.ms), first: fut.prices[0], last: fut.prices.at(-1) });
}

log('start', { mode: MODE, at: new Date().toISOString() });
if (MODE === 'main' || MODE === 'all') {
  await hosts();
  await catalog();
  await fees();
  await bookCompare();
  await errors();
  await burst();
  await clock();
}
if (MODE === 'poll' || MODE === 'all') await poll();
log('end', { at: new Date().toISOString() });
