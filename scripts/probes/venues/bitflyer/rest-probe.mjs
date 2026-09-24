// bitFlyer Lightning REST probe: market lists and CCXT mapping, host latency, the Crypto CFD funding calls, ticker and board of FX_BTC_JPY against spot BTC_JPY, rate limit headers, errors, clock offset.
// Public, unauthenticated, read-only. The documented limit is 500 requests per 5 minutes per IP, and every mode stays under 100 requests.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitflyer/rest-probe.mjs [catalog|latency|cache|funding|poll|book|errors|all]
//   catalog  GET /v1/getmarkets, /getmarkets/usa, /getmarkets/eu, then CCXT 4.5.68 loadMarkets and the fields the engine reads. About 5 s.
//   latency  DNS, one cold and ten warm requests of getticker, rate limit headers, clock offset from Date and from the ticker timestamp. About 10 s.
//   cache    20 getticker, 8 getboard and 5 getfundingrate at 150 ms spacing: reply time, identical replies, ticker age, to find edge caching. About 10 s.
//   funding  getfundingrate, getfundingratehistory with count 500: interval, lead of calculation over settlement, rate distribution, and CCXT fetchFundingRate. About 3 s.
//   poll     40 polls at 1.5 s of getticker FX_BTC_JPY and BTC_JPY: time, change counts, premium of the CFD over spot. About 65 s, 80 requests.
//   book     getboard of FX_BTC_JPY: level count, order, mid_price, compared with the ticker. About 3 s.
//   errors   unknown product, spot product on the funding call, missing parameter, unknown path, undocumented index or mark paths. About 5 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitflyer/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.bitflyer.com/v1';
const CFD = 'FX_BTC_JPY';
const SPOT = 'BTC_JPY';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, body, headers: res.headers };
}

const rateHeaders = (h) => ({
  period: h.get('x-ratelimit-period'),
  remaining: h.get('x-ratelimit-remaining'),
  reset: h.get('x-ratelimit-reset'),
  retryAfter: h.get('retry-after'),
});

// bitFlyer spells UTC instants without a zone, as in "2026-09-23T03:21:04.97".
const utcMs = (s) => Date.parse(s.endsWith('Z') ? s : s + 'Z');

async function catalog() {
  for (const p of ['/getmarkets', '/getmarkets/usa', '/getmarkets/eu']) {
    const r = await get(p);
    keep(`markets${p.replace(/\//g, '_')}.json`, r.text);
    const byType = {};
    for (const m of r.body) byType[m.market_type] = (byType[m.market_type] ?? 0) + 1;
    log('markets', { path: p, status: r.status, ms: r.ms, rows: r.body.length, byType, fx: r.body.filter((m) => m.market_type !== 'Spot') });
  }

  const ex = new ccxt.bitflyer();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const count = (f) => all.filter(f).length;
  log('ccxt_loadMarkets', {
    version: ccxt.version,
    ms: Math.round(performance.now() - t0),
    markets: all.length,
    spot: count((m) => m.spot),
    swap: count((m) => m.swap),
    future: count((m) => m.future),
    activeSwap: count((m) => m.swap && m.active),
    duplicateIds: all.length - new Set(all.map((m) => m.id)).size,
  });
  for (const m of all.filter((x) => x.swap || x.future)) {
    const { id, symbol, type, base, quote, settle, linear, inverse, contractSize, active, taker, maker } = m;
    log('ccxt_contract', { id, symbol, type, base, quote, settle, linear, inverse, contractSize: contractSize ?? null, active, taker, maker, precision: m.precision, limits: m.limits.amount });
  }
  const spot = markets['BTC/JPY'];
  log('ccxt_spot', { id: spot.id, taker: spot.taker, maker: spot.maker, feesTrading: ex.fees.trading.taker });
}

async function latency() {
  const host = new URL(API).hostname;
  const addrs = await lookup(host, { all: true });
  log('dns', { host, addrs: addrs.map((a) => a.address) });
  const times = [];
  let last;
  for (let i = 0; i < 11; i++) {
    const tSend = Date.now();
    last = await get(`/getticker?product_code=${CFD}`);
    const tRecv = Date.now();
    times.push(last.ms);
    if (i === 0 || i === 10) {
      const dateHdr = Date.parse(last.headers.get('date'));
      const mid = (tSend + tRecv) / 2;
      log('ticker_clock', {
        i,
        status: last.status,
        ms: last.ms,
        dateHeaderMinusLocalMidMs: dateHdr - mid,
        tickerTsMinusLocalRecvMs: utcMs(last.body.timestamp) - tRecv,
        rate: rateHeaders(last.headers),
        server: last.headers.get('server'),
        via: last.headers.get('via'),
        cache: last.headers.get('x-cache') ?? last.headers.get('cf-cache-status'),
      });
    }
    await sleep(300);
  }
  const warm = times.slice(1).sort((a, b) => a - b);
  log('ticker_latency', { cold: times[0], warmMin: warm[0], warmMedian: warm[Math.floor(warm.length / 2)], warmMax: warm[warm.length - 1] });
  for (const p of [`/getboardstate?product_code=${CFD}`, `/gethealth?product_code=${CFD}`, `/getboardstate?product_code=${SPOT}`]) {
    const r = await get(p);
    log('state', { path: p, status: r.status, ms: r.ms, body: r.body });
  }
}

// The API host is an Akamai edge about 13 ms away, so a reply under about 100 ms cannot have reached the origin in Japan.
async function cache() {
  for (const [name, path, n] of [
    ['ticker', `/getticker?product_code=${CFD}`, 20],
    ['board', `/getboard?product_code=${CFD}`, 8],
    ['fundingrate', `/getfundingrate?product_code=${CFD}`, 5],
  ]) {
    const rows = [];
    let prevText;
    for (let i = 0; i < n; i++) {
      const r = await get(path);
      const tRecv = Date.now();
      rows.push({
        ms: r.ms,
        same: r.text === prevText,
        tick: r.body.tick_id,
        ageMs: r.body.timestamp ? tRecv - utcMs(r.body.timestamp) : undefined,
      });
      prevText = r.text;
      await sleep(150);
    }
    const fast = rows.filter((x) => x.ms < 100);
    log('cache', {
      name,
      requests: n,
      under100ms: fast.length,
      identicalToPrevious: rows.filter((x) => x.same).length,
      identicalAndUnder100ms: rows.filter((x) => x.same && x.ms < 100).length,
      ms: rows.map((x) => x.ms),
      ageMs: rows.map((x) => x.ageMs).filter((x) => x !== undefined),
    });
  }
}

async function funding() {
  const cur = await get(`/getfundingrate?product_code=${CFD}`);
  keep('fundingrate.json', cur.text);
  log('fundingrate', { status: cur.status, ms: cur.ms, bytes: cur.bytes, body: cur.body, nextUtcMs: utcMs(cur.body.next_funding_rate_settledate), localNow: Date.now() });

  const hist = await get(`/getfundingratehistory?product_code=${CFD}&count=500`);
  keep('fundingratehistory.json', hist.text);
  const rows = hist.body;
  const leads = {};
  const steps = {};
  const settleHours = {};
  const rates = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lead = (utcMs(r.settlement_date) - utcMs(r.calculation_date)) / 3_600_000;
    leads[lead] = (leads[lead] ?? 0) + 1;
    const h = new Date(utcMs(r.settlement_date)).getUTCHours();
    settleHours[h] = (settleHours[h] ?? 0) + 1;
    rates[r.rate] = (rates[r.rate] ?? 0) + 1;
    if (i > 0) {
      const step = (utcMs(rows[i - 1].settlement_date) - utcMs(r.settlement_date)) / 3_600_000;
      steps[step] = (steps[step] ?? 0) + 1;
    }
  }
  const values = rows.map((r) => r.rate);
  const top = Object.entries(rates).sort((a, b) => b[1] - a[1]).slice(0, 8);
  log('fundingratehistory', {
    status: hist.status,
    ms: hist.ms,
    bytes: hist.bytes,
    rows: rows.length,
    newest: rows[0],
    oldest: rows[rows.length - 1],
    leadHours: leads,
    stepHours: steps,
    settleUtcHours: settleHours,
    min: Math.min(...values),
    max: Math.max(...values),
    positive: values.filter((v) => v > 0).length,
    zero: values.filter((v) => v === 0).length,
    negative: values.filter((v) => v < 0).length,
    distinct: Object.keys(rates).length,
    topRates: top,
  });
  const nextInHistory = rows.find((r) => r.settlement_date === cur.body.next_funding_rate_settledate);
  log('current_vs_history', { currentEqualsNewestRow: nextInHistory?.rate === cur.body.current_funding_rate, row: nextInHistory ?? null });

  const ex = new ccxt.bitflyer();
  const fr = await ex.fetchFundingRate('BTC/JPY:JPY');
  const { info, ...rest } = fr;
  log('ccxt_fetchFundingRate', { ...rest });
}

async function poll() {
  const n = 40;
  const prev = {};
  const changes = { cfdBid: 0, cfdAsk: 0, cfdLtp: 0, cfdTs: 0, spotLtp: 0, spotTs: 0 };
  const cfdMs = [];
  const premiums = [];
  const ages = [];
  for (let i = 0; i < n; i++) {
    const [c, s] = await Promise.all([get(`/getticker?product_code=${CFD}`), get(`/getticker?product_code=${SPOT}`)]);
    const tRecv = Date.now();
    cfdMs.push(c.ms);
    const cb = c.body;
    const sb = s.body;
    ages.push(tRecv - utcMs(cb.timestamp));
    const cfdMid = (cb.best_bid + cb.best_ask) / 2;
    const spotMid = (sb.best_bid + sb.best_ask) / 2;
    premiums.push(Math.round(((cfdMid - spotMid) / spotMid) * 1e6));
    if (i > 0) {
      if (cb.best_bid !== prev.cb.best_bid) changes.cfdBid++;
      if (cb.best_ask !== prev.cb.best_ask) changes.cfdAsk++;
      if (cb.ltp !== prev.cb.ltp) changes.cfdLtp++;
      if (cb.timestamp !== prev.cb.timestamp) changes.cfdTs++;
      if (sb.ltp !== prev.sb.ltp) changes.spotLtp++;
      if (sb.timestamp !== prev.sb.timestamp) changes.spotTs++;
    }
    if (i === 0 || i === n - 1) {
      log('poll_sample', { i, cfd: cb, spot: { best_bid: sb.best_bid, best_ask: sb.best_ask, ltp: sb.ltp, timestamp: sb.timestamp, state: sb.state }, rate: rateHeaders(c.headers) });
    }
    prev.cb = cb;
    prev.sb = sb;
    await sleep(1_500);
  }
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const q = (a, p) => sorted(a)[Math.min(a.length - 1, Math.floor(p * a.length))];
  log('poll_summary', {
    polls: n,
    changesOutOf: n - 1,
    changes,
    cfdMs: { min: q(cfdMs, 0), median: q(cfdMs, 0.5), p90: q(cfdMs, 0.9), max: q(cfdMs, 1) },
    cfdTickerAgeMs: { min: q(ages, 0), median: q(ages, 0.5), max: q(ages, 1) },
    cfdOverSpotMidPpm: { min: q(premiums, 0), median: q(premiums, 0.5), max: q(premiums, 1) },
  });
}

async function book() {
  const [b, t] = await Promise.all([get(`/getboard?product_code=${CFD}`), get(`/getticker?product_code=${CFD}`)]);
  keep('board_fx.json', b.text);
  const bids = b.body.bids;
  const asks = b.body.asks;
  const desc = bids.every((l, i) => i === 0 || l.price < bids[i - 1].price);
  const asc = asks.every((l, i) => i === 0 || l.price > asks[i - 1].price);
  const bidSum = bids.reduce((s, l) => s + l.size, 0);
  const askSum = asks.reduce((s, l) => s + l.size, 0);
  log('board', {
    status: b.status,
    ms: b.ms,
    bytes: b.bytes,
    mid_price: b.body.mid_price,
    bids: bids.length,
    asks: asks.length,
    bidsDescending: desc,
    asksAscending: asc,
    top3Bids: bids.slice(0, 3),
    top3Asks: asks.slice(0, 3),
    lastBid: bids[bids.length - 1],
    lastAsk: asks[asks.length - 1],
    bidSizeSum: +bidSum.toFixed(8),
    askSizeSum: +askSum.toFixed(8),
    tickerTotalBidDepth: t.body.total_bid_depth,
    tickerTotalAskDepth: t.body.total_ask_depth,
    tickerBest: [t.body.best_bid, t.body.best_ask],
    midOfTouch: (bids[0].price + asks[0].price) / 2,
    nonIntegerPrices: bids.concat(asks).filter((l) => !Number.isInteger(l.price)).length,
  });
  const s = await get(`/getboard?product_code=${SPOT}`);
  log('board_spot', { status: s.status, bids: s.body.bids.length, asks: s.body.asks.length, mid_price: s.body.mid_price });
}

async function errors() {
  const paths = [
    '/getticker?product_code=NOPE_JPY',
    '/getboard?product_code=NOPE_JPY',
    `/getfundingrate?product_code=${SPOT}`,
    '/getfundingrate',
    '/getticker',
    '/nope',
    `/getindex?product_code=${CFD}`,
    `/getmarkprice?product_code=${CFD}`,
    `/getticker?product_code=${CFD.toLowerCase()}`,
    '/getcorporateleverage',
  ];
  for (const p of paths) {
    const r = await get(p);
    log('error_probe', { path: p, status: r.status, ms: r.ms, body: r.body ?? r.text.slice(0, 160), rate: rateHeaders(r.headers) });
    await sleep(300);
  }
}

const modes = { catalog, latency, cache, funding, poll, book, errors };
const arg = process.argv[2] ?? 'all';
const run = arg === 'all' ? Object.keys(modes) : [arg];
for (const m of run) {
  if (!modes[m]) throw new Error(`unknown mode ${m}`);
  log('mode', { mode: m, at: new Date().toISOString() });
  await modes[m]();
}
