// GroveX public REST probe: latency and clock, spot catalog, bulk tickers, depth snapshots and their age, error shapes, and the books next to Binance spot.
// Public, unauthenticated, read-only. GroveX publishes 6 public requests per 2 s per IP, and this probe sends at most two GroveX requests in any 1.2 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/grovex/rest-probe.mjs [latency|catalog|book|mirror|poll|all]
//   latency  DNS, 5 cold and 10 warm symbol calls, clock offset from the ticker time and the 404 body. About 30 s.
//   catalog  /open/api/common/symbols, /open/api/get_allticker and /pub/tickers counted and cross checked, plus the CCXT 4.5.68 exchange list. About 30 s.
//   book     market_dept types and newOrderBook depths, level order, book age, repeat reads, error replies, headers. About 25 s.
//   mirror   REST book, get_ticker buy and sell, and Binance spot at the same instant for five Binance pairs and GRX. About 15 s.
//   poll     market_dept btcusdt and ethusdt alternately once a second for 60 s, with Binance beside each read.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/grovex/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://openapi.grovex.io';
const BINANCE = 'https://api.binance.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const ppm = (a, b) => round(((a - b) / b) * 1e6, 0);

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 2 });

// Raw GET so the cold path really opens a new TLS connection and the headers stay visible.
function get(url, { agent = warmAgent } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const sentAt = Date.now();
    const req = https.get(url, { agent, headers: { 'user-agent': 'grovex-rest-probe' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json, ms: performance.now() - t0, sentAt, recvAt: Date.now(), bytes: text.length });
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const touch = (tick) => {
  const bids = tick?.bids ?? tick?.buys ?? [];
  const asks = tick?.asks ?? [];
  return { bid: bids[0]?.[0] ?? null, ask: asks[0]?.[0] ?? null, nb: bids.length, na: asks.length };
};

async function binanceTouch(symbol) {
  const r = await get(`${BINANCE}/api/v3/ticker/bookTicker?symbol=${symbol.toUpperCase()}`);
  if (r.status !== 200) return { bid: null, ask: null, status: r.status };
  return { bid: Number(r.json.bidPrice), ask: Number(r.json.askPrice) };
}

async function latency() {
  for (const host of ['openapi.grovex.io', 'ws.grovex.io', 'www.grovex.io', 'webapi.grovex.io', 'futuresopenapi.grovex.io']) {
    try {
      const a = await lookup(host, { all: true });
      log('dns', { host, addresses: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const cold = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${API}/open/api/common/symbols`, { agent: new https.Agent({ keepAlive: false }) });
    cold.push(r.ms);
    if (i === 0) log('headers', { url: '/open/api/common/symbols', status: r.status, server: r.headers.server, cfRay: r.headers['cf-ray'], cache: r.headers['cf-cache-status'], rateHeaders: Object.keys(r.headers).filter((k) => /rate|limit|retry/i.test(k)) });
    await sleep(1_000);
  }
  const warm = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${API}/open/api/common/symbols`);
    warm.push(r.ms);
    await sleep(1_000);
  }
  log('latency', {
    cold: { min: round(Math.min(...cold)), median: round(quantile(cold, 0.5)), max: round(Math.max(...cold)) },
    warm: { min: round(Math.min(...warm)), median: round(quantile(warm, 0.5)), max: round(Math.max(...warm)) },
  });

  // No time call is published, so the clock comes from the ticker `time` and the Spring 404 body `timestamp`.
  const offsets = { ticker: [], notFound: [] };
  for (let i = 0; i < 5; i++) {
    const t = await get(`${API}/open/api/get_ticker?symbol=btcusdt`);
    const mid = (t.sentAt + t.recvAt) / 2;
    offsets.ticker.push({ offsetMs: t.json?.data?.time - mid, rttMs: round(t.ms, 0), serverTime: t.json?.data?.time });
    await sleep(1_000);
    const n = await get(`${API}/sapi/v1/time`);
    const nmid = (n.sentAt + n.recvAt) / 2;
    offsets.notFound.push({ offsetMs: round(n.json?.timestamp - nmid, 0), rttMs: round(n.ms, 0), status: n.status });
    await sleep(1_000);
  }
  log('clock', offsets);
}

async function catalog() {
  const s = await get(`${API}/open/api/common/symbols`);
  keep('symbols.json', s.text);
  const rows = s.json.data;
  const quotes = {};
  for (const m of rows) quotes[m.count_coin] = (quotes[m.count_coin] ?? 0) + 1;
  log('symbols', { status: s.status, ms: round(s.ms), bytes: s.bytes, envelope: Object.keys(s.json), rows: rows.length, quotes, fields: Object.keys(rows[0]), example: rows[0] });
  await sleep(1_000);

  for (let i = 0; i < 3; i++) {
    const t = await get(`${API}/open/api/get_allticker`);
    if (i === 0) keep('get_allticker.json', t.text);
    const tk = t.json?.data?.ticker ?? [];
    const mid = (t.sentAt + t.recvAt) / 2;
    log('allticker', {
      i, status: t.status, ms: round(t.ms), bytes: t.bytes, rows: tk.length, dataDate: t.json?.data?.date, dateAgeMs: round(mid - t.json?.data?.date, 0),
      withLast: tk.filter((x) => x.last !== undefined).length, withBuyAndSell: tk.filter((x) => x.buy !== undefined && x.sell !== undefined).length,
      isShow0: tk.filter((x) => x.isShow !== 1).length, fieldsBtc: Object.keys(tk.find((x) => x.symbol === 'btcusdt') ?? {}),
      numberTypes: Object.fromEntries(Object.entries(tk.find((x) => x.symbol === 'btcusdt') ?? {}).map(([k, v]) => [k, typeof v])),
    });
    await sleep(1_500);
  }

  const p = await get(`${API}/pub/tickers`);
  keep('pub_tickers.json', p.text);
  const pr = p.json?.data ?? [];
  log('pubTickers', { status: p.status, ms: round(p.ms), bytes: p.bytes, rows: pr.length, fields: Object.keys(pr[0] ?? {}), btc: pr.find((x) => x.ticker_id === 'btcusdt') });
  await sleep(1_000);

  const t = await get(`${API}/open/api/get_ticker?symbol=btcusdt`);
  log('getTicker', { status: t.status, ms: round(t.ms), data: t.json?.data });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, grovex: ccxt.exchanges.filter((x) => /grov/i.test(x)) });
}

async function book() {
  const cases = [
    ['market_dept step0', `${API}/open/api/market_dept?symbol=btcusdt&type=step0`],
    ['market_dept step1', `${API}/open/api/market_dept?symbol=btcusdt&type=step1`],
    ['market_dept step2', `${API}/open/api/market_dept?symbol=btcusdt&type=step2`],
    ['market_dept step0time', `${API}/open/api/market_dept?symbol=btcusdt&type=step0time`],
    ['newOrderBook depth 0', `${API}/pub/newOrderBook?symbol=btcusdt&depth=0`],
    ['newOrderBook depth 100', `${API}/pub/newOrderBook?symbol=btcusdt&depth=100`],
    ['newOrderBook depth 200', `${API}/pub/newOrderBook?symbol=btcusdt&depth=200`],
    ['market_dept step0 ethusdt', `${API}/open/api/market_dept?symbol=ethusdt&type=step0`],
    ['market_dept step0 grxusdt', `${API}/open/api/market_dept?symbol=grxusdt&type=step0`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    keep(`book-${name.replace(/\s+/g, '_')}.json`, r.text);
    const tick = r.json?.data?.tick ?? r.json?.data?.orderbook;
    const t = touch(tick);
    const bids = (tick?.bids ?? []).map((l) => l[0]);
    const asks = (tick?.asks ?? []).map((l) => l[0]);
    const mid = (r.sentAt + r.recvAt) / 2;
    log('book', {
      name, status: r.status, ms: round(r.ms), bytes: r.bytes, keys: tick ? Object.keys(tick) : null, ...t,
      bidsDescending: bids.every((p, i) => i === 0 || p < bids[i - 1]), asksAscending: asks.every((p, i) => i === 0 || p > asks[i - 1]),
      lastUpdateId: tick?.lastUpdateId ?? null, time: tick?.time ?? null,
      ageOfLastUpdateMs: tick?.lastUpdateId ? round(mid - tick.lastUpdateId, 0) : null, levelTypes: tick?.bids?.[0] ? tick.bids[0].map((v) => typeof v) : null,
      cache: r.headers['cf-cache-status'],
    });
    await sleep(1_100);
  }

  // Repeat reads one second apart show whether a reply is cached or frozen.
  const reads = [];
  for (let i = 0; i < 4; i++) {
    const r = await get(`${API}/open/api/market_dept?symbol=btcusdt&type=step0`);
    const tick = r.json?.data?.tick;
    reads.push({ lastUpdateId: tick?.lastUpdateId, time: tick?.time, ...touch(tick) });
    await sleep(1_100);
  }
  log('repeat', { reads });

  const errors = [
    ['unknown symbol', `${API}/open/api/market_dept?symbol=nopeusdt&type=step0`],
    ['missing type', `${API}/open/api/market_dept?symbol=btcusdt`],
    ['bad type', `${API}/open/api/market_dept?symbol=btcusdt&type=step9`],
    ['uppercase symbol', `${API}/open/api/market_dept?symbol=BTCUSDT&type=step0`],
    ['underscore symbol', `${API}/open/api/market_dept?symbol=BTC_USDT&type=step0`],
    ['unknown ticker', `${API}/open/api/get_ticker?symbol=nopeusdt`],
    ['unknown path', `${API}/open/api/nope`],
    ['futures host', 'https://futuresopenapi.grovex.io/'],
  ];
  for (const [name, url] of errors) {
    try {
      const r = await get(url);
      const tick = r.json?.data?.tick;
      log('error', { name, status: r.status, ms: round(r.ms), body: tick ? { tick: touch(tick), lastUpdateId: tick.lastUpdateId } : r.text.slice(0, 200) });
    } catch (e) {
      log('error', { name, failed: e.code ?? e.message });
    }
    await sleep(1_100);
  }
}

async function mirror() {
  for (const sym of ['btcusdt', 'ethusdt', 'solusdt', 'xrpusdt', 'dogeusdt', 'grxusdt']) {
    const [d, bn] = await Promise.all([get(`${API}/open/api/market_dept?symbol=${sym}&type=step0`), binanceTouch(sym)]);
    await sleep(600);
    const [tk, bn2] = await Promise.all([get(`${API}/open/api/get_ticker?symbol=${sym}`), binanceTouch(sym)]);
    const tick = d.json?.data?.tick;
    const t = touch(tick);
    const bnMid = (bn.bid + bn.ask) / 2;
    const bnMid2 = (bn2.bid + bn2.ask) / 2;
    log('mirror', {
      sym,
      book: { bid: t.bid, ask: t.ask, spreadPpm: ppm(t.ask, t.bid), bidVsBinancePpm: ppm(t.bid, bnMid), askVsBinancePpm: ppm(t.ask, bnMid), ageMs: tick?.lastUpdateId ? d.recvAt - tick.lastUpdateId : null },
      ticker: { buy: tk.json?.data?.buy, sell: tk.json?.data?.sell, last: tk.json?.data?.last, spreadPpm: ppm(tk.json?.data?.sell, tk.json?.data?.buy), lastVsBinancePpm: ppm(tk.json?.data?.last, bnMid2) },
      binance: { bid: bn.bid, ask: bn.ask, spreadPpm: ppm(bn.ask, bn.bid) },
      bookTouchEqualsTicker: t.bid === tk.json?.data?.buy && t.ask === tk.json?.data?.sell,
    });
    await sleep(600);
  }
}

async function poll() {
  const rows = { btcusdt: [], ethusdt: [] };
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 60_000) {
    const sym = i++ % 2 === 0 ? 'btcusdt' : 'ethusdt';
    const [r, bn] = await Promise.all([get(`${API}/open/api/market_dept?symbol=${sym}&type=step0`), binanceTouch(sym)]);
    const tick = r.json?.data?.tick;
    const t = touch(tick);
    const bnMid = (bn.bid + bn.ask) / 2;
    rows[sym].push({ ms: r.ms, lastUpdateId: tick?.lastUpdateId, age: tick?.lastUpdateId ? r.recvAt - tick.lastUpdateId : null, bid: t.bid, ask: t.ask, midVsBinancePpm: t.bid && t.ask ? ppm((t.bid + t.ask) / 2, bnMid) : null, status: r.status });
    const wait = 1_000 - r.ms;
    if (wait > 0) await sleep(wait);
  }
  for (const [sym, rs] of Object.entries(rows)) {
    const ids = new Set(rs.map((r) => r.lastUpdateId));
    const ages = rs.map((r) => r.age).filter((x) => x != null);
    const dev = rs.map((r) => Math.abs(r.midVsBinancePpm)).filter((x) => x != null);
    let touchChanges = 0;
    for (let k = 1; k < rs.length; k++) if (rs[k].bid !== rs[k - 1].bid || rs[k].ask !== rs[k - 1].ask) touchChanges++;
    log('poll', {
      sym, polls: rs.length, statuses: [...new Set(rs.map((r) => r.status))], distinctLastUpdateId: ids.size, touchChanges,
      replyMs: { min: round(Math.min(...rs.map((r) => r.ms))), median: round(quantile(rs.map((r) => r.ms), 0.5)), p90: round(quantile(rs.map((r) => r.ms), 0.9)), max: round(Math.max(...rs.map((r) => r.ms))) },
      ageMs: { min: Math.min(...ages), median: quantile(ages, 0.5), max: Math.max(...ages) },
      absMidVsBinancePpm: { median: quantile(dev, 0.5), p90: quantile(dev, 0.9), max: Math.max(...dev) },
      first: rs[0], last: rs[rs.length - 1],
    });
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { latency, catalog, book, mirror, poll };
log('start', { mode, at: new Date().toISOString() });
if (mode === 'all') {
  for (const m of ['latency', 'catalog', 'book', 'mirror', 'poll']) await modes[m]();
} else {
  await modes[mode]();
}
log('done', { at: new Date().toISOString() });
warmAgent.destroy();
