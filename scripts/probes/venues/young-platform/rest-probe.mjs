// Young Platform public REST probe: latency and clock, the SOR spot catalog, the bulk ticker, the aggregated liquidity book, error shapes, and a one second poll.
// Public, unauthenticated, read-only. No limit is published, so calls are spaced at 250 ms or more, and the poll runs once a second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/young-platform/rest-probe.mjs [latency|catalog|book|errors|poll|all]
//   latency  DNS, 5 cold and 10 warm calls to /public/markets, clock offset from the Date header and from the legacy /api/v4/public/time. About 25 s.
//   catalog  /public/markets and /public/tickers counted and cross checked, the legacy /api/v4/public/markets, the charts call, and the CCXT 4.5.68 exchange list.
//   book     /public/liquidity for every catalog market, level counts and order, spread, snapshot age, and BTC-EUR, ETH-EUR and SOL-EUR beside the Kraken ticker. About 15 s.
//   errors   unknown market, unknown path, the retired v3 calls, response headers. About 5 s.
//   poll     /public/liquidity/BTC-EUR and /public/tickers once a second for 60 polls, reply time and how often each changed.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/young-platform/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'api.youngplatform.com';
const BASE = `https://${HOST}/api/v1/trader`;
const KRAKEN_BASE = 'https://api.kraken.com/0/public/Ticker';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

function get(url, agent = warmAgent) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const sent = Date.now();
    const req = https.get(url, { agent, headers: { 'user-agent': 'venue-survey-probe', accept: 'application/json' } }, (res) => {
      const chunks = [];
      let ttfb = performance.now() - t0;
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, ms: performance.now() - t0, ttfb, sent, recv: Date.now() });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: performance.now() - t0, sent, recv: Date.now() }));
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
  });
}

function json(r) {
  try {
    return JSON.parse(r.body);
  } catch {
    return undefined;
  }
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: +s[0]?.toFixed(1), median: +q(0.5)?.toFixed(1), p90: +q(0.9)?.toFixed(1), max: +s[s.length - 1]?.toFixed(1) };
}

// The Date header has one second resolution, so the offset is only good to about half a second.
function dateOffset(r) {
  const server = Date.parse(r.headers?.date ?? '');
  const mid = (r.sent + r.recv) / 2;
  return Number.isFinite(server) ? server + 500 - mid : null;
}

async function latency() {
  const addrs = await dns.lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${BASE}/public/markets`, false);
    cold.push(r.ms);
    await sleep(500);
  }
  const warm = [];
  const offsets = [];
  let edge;
  for (let i = 0; i < 10; i++) {
    const r = await get(`${BASE}/public/markets`);
    warm.push(r.ms);
    offsets.push(dateOffset(r));
    edge = r.headers['cf-ray'];
    await sleep(500);
  }
  log('latency', { url: '/public/markets', cold: stats(cold), warm: stats(warm), cfRay: edge });
  log('clock', { dateHeaderOffsetMs: stats(offsets.filter((x) => x !== null)), note: 'server Date plus 500 ms minus local midpoint' });

  // The legacy v4 time call still answers, with sub millisecond precision.
  const v4 = [];
  const v4ms = [];
  let sample;
  for (let i = 0; i < 10; i++) {
    const r = await get(`https://${HOST}/api/v4/public/time`);
    const t = Date.parse(json(r)?.time ?? '');
    sample = r.body;
    if (Number.isFinite(t)) v4.push(t - (r.sent + r.recv) / 2);
    v4ms.push(r.ms);
    await sleep(500);
  }
  log('clockV4', { url: '/api/v4/public/time', sample, offsetMs: stats(v4), replyMs: stats(v4ms), note: 'server time minus local midpoint' });
}

async function catalog() {
  const m = await get(`${BASE}/public/markets`);
  save('markets.json', m.body);
  const markets = json(m).markets;
  const quotes = {};
  for (const x of markets) quotes[x.market.split('-')[1]] = (quotes[x.market.split('-')[1]] ?? 0) + 1;
  const flags = markets.filter((x) => !x.sor_details.active || !x.sor_details.buy_enabled || !x.sor_details.sell_enabled);
  log('markets', { status: m.status, bytes: m.body.length, ms: +m.ms.toFixed(0), count: markets.length, quotes, notFullyEnabled: flags.map((x) => ({ market: x.market, ...x.sor_details })) });
  log('marketsList', { markets: markets.map((x) => x.market) });
  log('marketSample', { btc: markets.find((x) => x.market === 'BTC-EUR') });
  await sleep(300);

  const t = await get(`${BASE}/public/tickers`);
  save('tickers.json', t.body);
  const tickers = json(t).tickers;
  const inMarkets = new Set(markets.map((x) => x.market));
  const extra = tickers.filter((x) => !inMarkets.has(x.mkt)).map((x) => x.mkt);
  const missing = [...inMarkets].filter((x) => !tickers.some((y) => y.mkt === x));
  const tq = {};
  for (const x of tickers) tq[x.mkt.split('-')[1]] = (tq[x.mkt.split('-')[1]] ?? 0) + 1;
  const traded = tickers.filter((x) => Number(x.qty) > 0);
  const eurVolume = tickers.filter((x) => x.mkt.endsWith('-EUR')).reduce((s, x) => s + Number(x.amt), 0);
  const top = [...tickers].sort((a, b) => Number(b.amt) - Number(a.amt)).slice(0, 6).map((x) => `${x.mkt} ${Number(x.amt).toFixed(0)}`);
  const ts = [...new Set(tickers.map((x) => x.t))].sort();
  log('tickers', { status: t.status, bytes: t.body.length, ms: +t.ms.toFixed(0), count: tickers.length, quotes: tq, withVolume: traded.length, eurQuotedAmount24h: Math.round(eurVolume), top, tickerOnlyCount: extra.length, tickerOnlySample: extra.slice(0, 12), catalogWithoutTicker: missing, distinctT: ts.map((x) => new Date(x).toISOString()), ageOfNewestTSec: +((Date.now() - ts[ts.length - 1]) / 1000).toFixed(0) });
  log('tickerSample', { btc: tickers.find((x) => x.mkt === 'BTC-EUR') });
  await sleep(300);

  // The legacy v4 market list still answers, with the pre SOR fee fields and a frozen last price.
  const v = await get(`https://${HOST}/api/v4/public/markets`);
  const legacy = json(v) ?? [];
  const feeGroups = {};
  for (const x of legacy) {
    const k = `maker ${x.makerFee} taker ${x.takerFee} base ${x.makerFeeBase}/${x.takerFeeBase}`;
    feeGroups[k] = (feeGroups[k] ?? 0) + 1;
  }
  const stale = ['BTC-EUR', 'ETH-EUR', 'SOL-EUR'].map((m) => ({ m, legacyPrice: legacy.find((x) => x.name === m)?.currentTradingPrice, tickerLast: Number(tickers.find((x) => x.mkt === m)?.c) }));
  log('legacyV4Markets', { status: v.status, bytes: v.body.length, count: legacy.length, active: legacy.filter((x) => x.active).length, feeGroups, stale, fixedFeeTiers: legacy.find((x) => x.name === 'BTC-EUR')?.fixedFeeTiers });
  await sleep(300);

  const c = await get(`${BASE}/public/charts/BTC-EUR?interval=1&limit=3`);
  log('charts', { status: c.status, bytes: c.body.length, sample: json(c)?.candles?.[0] });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, young: ccxt.exchanges.filter((x) => /young/i.test(x)) });
  return markets.map((x) => x.market);
}

function bookShape(b) {
  const bids = b.bids.map((l) => [Number(l.price), Number(l.volume)]);
  const asks = b.asks.map((l) => [Number(l.price), Number(l.volume)]);
  const desc = bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0]);
  const asc = asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0]);
  const bb = bids[0]?.[0];
  const ba = asks[0]?.[0];
  const mid = Number(b.mid_price);
  return { nb: bids.length, na: asks.length, desc, asc, bb, ba, mid, midCheck: bb && ba ? +(((bb + ba) / 2 - mid)).toFixed(6) : null, spreadPpm: bb && ba ? Math.round(((ba - bb) / ((ba + bb) / 2)) * 1e6) : null, crossed: bb >= ba, bidNotional: Math.round(bids.reduce((s, l) => s + l[0] * l[1], 0)), askNotional: Math.round(asks.reduce((s, l) => s + l[0] * l[1], 0)), lastBid: bids.at(-1) ? { notional: Math.round(bids.at(-1)[0] * bids.at(-1)[1]), awayPpm: Math.round(((bb - bids.at(-1)[0]) / bb) * 1e6) } : null, lastAsk: asks.at(-1) ? { notional: Math.round(asks.at(-1)[0] * asks.at(-1)[1]), awayPpm: Math.round(((asks.at(-1)[0] - ba) / ba) * 1e6) } : null };
}

async function book(list) {
  const markets = list ?? json(await get(`${BASE}/public/markets`)).markets.map((x) => x.market);
  const rows = [];
  for (const m of markets) {
    const r = await get(`${BASE}/public/liquidity/${m}`);
    const b = json(r);
    const age = b?.time ? (r.recv - Date.parse(b.time)) / 1000 : null;
    const shape = b?.bids ? bookShape(b) : null;
    rows.push({ m, status: r.status, ms: Math.round(r.ms), bytes: r.body.length, ageSec: age, ...shape });
    if (m === 'BTC-EUR') save('liquidity-BTC-EUR.json', r.body);
    await sleep(250);
  }
  for (const x of rows) log('liquidity', x);
  const nbs = rows.map((x) => x.nb).filter((x) => x !== undefined);
  log('liquiditySummary', { markets: rows.length, ok: rows.filter((x) => x.status === 200).length, levelsPerSide: [...new Set(rows.flatMap((x) => [x.nb, x.na]))].sort((a, b) => a - b), allBidsDesc: rows.every((x) => x.desc), allAsksAsc: rows.every((x) => x.asc), anyCrossed: rows.some((x) => x.crossed), spreadPpm: stats(rows.map((x) => x.spreadPpm).filter((x) => x !== null)), ageSec: stats(rows.map((x) => x.ageSec).filter((x) => x !== null)), minLevels: Math.min(...nbs), lastBidOver10M: rows.filter((x) => x.lastBid?.notional > 1e7).map((x) => `${x.m} ${x.lastBid.notional} at ${x.lastBid.awayPpm} ppm`), lastAskOver10M: rows.filter((x) => x.lastAsk?.notional > 1e7).map((x) => `${x.m} ${x.lastAsk.notional} at ${x.lastAsk.awayPpm} ppm`) });

  // A ticker-only market and a lowercase spelling.
  for (const m of ['TRUMP-EUR', 'AVAX-EUR', 'btc-eur', 'BTC_EUR', 'NOPE-EUR']) {
    const r = await get(`${BASE}/public/liquidity/${m}`);
    const b = json(r);
    log('liquidityOther', { m, status: r.status, body: b?.bids ? { market: b.market, nb: b.bids.length, na: b.asks.length, mid: b.mid_price, time: b.time } : r.body.slice(0, 200) });
    await sleep(250);
  }

  // The SOR book beside Kraken, one of the venues the SOR names in its own documentation example.
  const pairs = [['BTC-EUR', 'XXBTZEUR'], ['ETH-EUR', 'XETHZEUR'], ['SOL-EUR', 'SOLEUR']];
  const [k, ...ys] = await Promise.all([get(`${KRAKEN_BASE}?pair=XBTEUR,ETHEUR,SOLEUR`, false), ...pairs.map(([m]) => get(`${BASE}/public/liquidity/${m}`))]);
  const kr = json(k)?.result ?? {};
  pairs.forEach(([m, kk], i) => {
    const yb = bookShape(json(ys[i]));
    const kt = kr[kk];
    if (!kt) return log('versusKraken', { m, kraken: k.status });
    const kb = Number(kt.b[0]);
    const ka = Number(kt.a[0]);
    log('versusKraken', { m, yp: { bid: yb.bb, ask: yb.ba, spreadPpm: yb.spreadPpm }, kraken: { bid: kb, ask: ka, spreadPpm: Math.round(((ka - kb) / ((ka + kb) / 2)) * 1e6) }, ypBidBelowKrakenBidPpm: Math.round(((kb - yb.bb) / kb) * 1e6), ypAskAboveKrakenAskPpm: Math.round(((yb.ba - ka) / ka) * 1e6) });
  });
}

async function errors() {
  const calls = [
    `${BASE}/public/liquidity/`,
    `${BASE}/public/nope`,
    `${BASE}/public/tickers/BTC-EUR`,
    `${BASE}/public/tickers/NOPE-EUR`,
    `${BASE}/public/charts/BTC-EUR?interval=7`,
    `${BASE}/private/balance`,
    `https://${HOST}/api/v3/markets`,
    `https://${HOST}/api/v3/ticker?pair=BTC-EUR`,
    `https://${HOST}/api/v3/orderbook?pair=BTC-EUR`,
    `https://${HOST}/api/v3/time`,
    `https://${HOST}/api/v4/public/trades?pair=BTC-EUR`,
    `https://${HOST}/api/v4/public/orderbook?pair=BTC-EUR`,
  ];
  for (const u of calls) {
    const r = await get(u);
    const h = Object.fromEntries(Object.entries(r.headers ?? {}).filter(([k]) => /rate|limit|retry|cache|age|cf-ray|content-type/i.test(k)));
    log('error', { url: u.replace(`https://${HOST}`, ''), status: r.status, body: r.body?.slice(0, 220), headers: h });
    await sleep(300);
  }
}

async function poll() {
  const liq = [];
  const tick = [];
  let prevBook;
  let prevTime;
  let prevTick;
  let bookChanged = 0;
  let timeChanged = 0;
  let topChanged = 0;
  let tickChanged = 0;
  let prevTop;
  const ages = [];
  const n = 60;
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const [a, b] = await Promise.all([get(`${BASE}/public/liquidity/BTC-EUR`), get(`${BASE}/public/tickers`, i === 0 ? false : undefined)]);
    liq.push(a.ms);
    tick.push(b.ms);
    const bk = json(a);
    const body = JSON.stringify([bk?.bids, bk?.asks]);
    const top = `${bk?.bids?.[0]?.price}/${bk?.asks?.[0]?.price}`;
    if (prevBook !== undefined && body !== prevBook) bookChanged++;
    if (prevTime !== undefined && bk?.time !== prevTime) timeChanged++;
    if (prevTop !== undefined && top !== prevTop) topChanged++;
    if (bk?.time) ages.push((a.recv - Date.parse(bk.time)) / 1000);
    const tb = json(b)?.tickers;
    const tbody = JSON.stringify(tb?.map((x) => [x.mkt, x.c, x.t]));
    if (prevTick !== undefined && tbody !== prevTick) tickChanged++;
    prevBook = body;
    prevTime = bk?.time;
    prevTop = top;
    prevTick = tbody;
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log('poll', { polls: n, liquidityMs: stats(liq), tickersMs: stats(tick), liquidityBodyChanged: bookChanged, liquidityTimeChanged: timeChanged, liquidityTopChanged: topChanged, liquidityAgeSec: stats(ages), tickersChanged: tickChanged });
}

const mode = process.argv[2] ?? 'all';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'latency' || mode === 'all') await latency();
let list;
if (mode === 'catalog' || mode === 'all') list = await catalog();
if (mode === 'book' || mode === 'all') await book(list);
if (mode === 'errors' || mode === 'all') await errors();
if (mode === 'poll' || mode === 'all') await poll();
log('end', { at: new Date().toISOString() });
warmAgent.destroy();
