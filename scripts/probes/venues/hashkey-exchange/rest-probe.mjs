// HashKey Exchange REST probe: latency, the HK and MENA catalogs, what CCXT's hashkey class loads, book depth limits and order, bulk tickers, mark and index calls, error shapes and headers, and a short 1 Hz poll.
// Public, unauthenticated, read-only. At most two requests a second, well inside the documented 5 per second per API key.
// Run from server/: node ../scripts/probes/venues/hashkey-exchange/rest-probe.mjs [main|poll]
//   main  latency, catalogs, CCXT, depth, bulk calls, mark and index, errors. About 60 s.
//   poll  40 one-second polls of the bulk bookTicker and the one contract's mark price. About 45 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/hashkey-exchange/rest.md.
import { createRequire } from 'node:module';
import https from 'node:https';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api-pro.hashkey.com';
const GLB = 'https://api-glb.hashkey.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// One GET with timings: ttfb and total in ms, a fresh TLS connection unless warm.
function get(url, { warm = true } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let ttfb = null;
    const req = https.get(url, { agent: warm ? warmAgent : false, headers: { 'user-agent': 'observatory-probe' } }, (res) => {
      ttfb = performance.now() - t0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body, json, bytes: body.length, ttfb: Math.round(ttfb), ms: Math.round(performance.now() - t0), tEnd: Date.now() });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Math.round(performance.now() - t0) }));
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function latency() {
  const cold = [];
  for (let i = 0; i < 3; i++) {
    const r = await get(`${API}/api/v1/time`, { warm: false });
    cold.push(r.ms);
    await sleep(500);
  }
  const warm = [];
  const offsets = [];
  const pairs = [];
  for (let i = 0; i < 20; i++) {
    const tSend = Date.now();
    const r = await get(`${API}/api/v1/time`);
    warm.push(r.ms);
    if (r.json?.serverTime) {
      const off = Math.round(Number(r.json.serverTime) - (tSend + r.tEnd) / 2);
      offsets.push(off);
      pairs.push([r.ms, off]);
    }
    await sleep(500);
  }
  // The midpoint estimate is only good to half the round trip, so the sample with the shortest round trip bounds the offset best.
  const best = pairs.sort((a, b) => a[0] - b[0])[0];
  log('latency_time', { cold, warm: stats(warm), clockOffsetMs: stats(offsets), offsetAtShortestRoundTrip: { rttMs: best?.[0], offsetMs: best?.[1] } });
  const depthWarm = [];
  for (let i = 0; i < 10; i++) {
    depthWarm.push((await get(`${API}/quote/v1/depth?symbol=BTCUSD&limit=20`)).ms);
    await sleep(500);
  }
  log('latency_depth', { warm: stats(depthWarm) });
}

function summarizeCatalog(label, r) {
  const e = r.json;
  const symbols = e.symbols ?? [];
  const contracts = e.contracts ?? [];
  const byQuote = {};
  for (const s of symbols) byQuote[s.quoteAsset] = (byQuote[s.quoteAsset] ?? 0) + 1;
  const statuses = {};
  for (const s of symbols) statuses[s.status] = (statuses[s.status] ?? 0) + 1;
  log('catalog', {
    label, status: r.status, bytes: r.bytes, ms: r.ms, site: e.site, timezone: e.timezone,
    symbols: symbols.length, statuses, byQuote,
    retailAllowed: symbols.filter((s) => s.retailAllowed).map((s) => s.symbol),
    piAllowed: symbols.filter((s) => s.piAllowed).length,
    contracts: contracts.map((c) => ({ symbol: c.symbol, status: c.status, base: c.baseAsset, underlying: c.underlying, index: c.index, margin: c.marginToken, mult: c.contractMultiplier, inverse: c.inverse })),
    options: (e.options ?? []).length, coins: (e.coins ?? []).length,
  });
  return e;
}

async function catalogs() {
  const hk = await get(`${API}/api/v1/exchangeInfo`);
  save('exchangeInfo-hk.json', hk.body);
  const e = summarizeCatalog('api-pro default', hk);
  const hk2 = await get(`${API}/api/v1/exchangeInfo?site=HK`);
  log('catalog_site_hk_equal_default', { equal: JSON.stringify(hk2.json?.symbols?.map((s) => s.symbol)) === JSON.stringify(e.symbols.map((s) => s.symbol)) });
  const mena = await get(`${API}/api/v1/exchangeInfo?site=MENA`);
  save('exchangeInfo-mena.json', mena.body);
  summarizeCatalog('api-pro site=MENA', mena);
  const glb = await get(`${GLB}/api/v1/exchangeInfo`);
  summarizeCatalog('api-glb', glb);
  return e;
}

async function ccxtMaps(e) {
  const def = new ccxt.hashkey();
  const out = { version: ccxt.version, defaultHost: def.urls.api.public };
  try {
    const m = await def.loadMarkets();
    const vals = Object.values(m);
    out.defaultLoad = { spot: vals.filter((x) => x.spot).length, swap: vals.filter((x) => x.swap).length, swapIds: vals.filter((x) => x.swap).map((x) => x.id) };
    const btcSpot = vals.find((x) => x.spot && x.id === 'BTCUSDT');
    const btcSwap = vals.find((x) => x.swap);
    out.defaultTaker = { spot: btcSpot?.taker, spotMaker: btcSpot?.maker, swap: btcSwap?.taker, swapMaker: btcSwap?.maker };
  } catch (err) {
    out.defaultError = String(err.message).slice(0, 200);
  }
  const hk = new ccxt.hashkey({ urls: { api: { public: API, private: API } } });
  try {
    const m = await hk.loadMarkets();
    const vals = Object.values(m);
    const btc = m['BTC/USD'];
    const sw = vals.find((x) => x.swap);
    out.hkOverride = {
      spotCount: vals.filter((x) => x.spot).length, swapCount: vals.filter((x) => x.swap).length,
      idsMatchCatalog: vals.filter((x) => x.spot).every((x) => e.symbols.some((s) => s.symbol === x.id)),
      btcUsd: btc && { id: btc.id, active: btc.active, taker: btc.taker, maker: btc.maker, contractSize: btc.contractSize },
      swap: sw && { symbol: sw.symbol, id: sw.id, active: sw.active, linear: sw.linear, contractSize: sw.contractSize, taker: sw.taker },
    };
  } catch (err) {
    out.hkOverrideError = String(err.message).slice(0, 200);
  }
  log('ccxt', out);
}

function bookShape(r) {
  const j = r.json;
  if (!j || !Array.isArray(j.b)) return { status: r.status, body: r.body.slice(0, 160) };
  const desc = (a) => a.every((x, i) => i === 0 || Number(a[i - 1][0]) > Number(x[0]));
  const asc = (a) => a.every((x, i) => i === 0 || Number(a[i - 1][0]) < Number(x[0]));
  return { status: r.status, bytes: r.bytes, ms: r.ms, bids: j.b.length, asks: j.a.length, bidsDesc: desc(j.b), asksAsc: asc(j.a), ageMs: Date.now() - j.t, bestBid: j.b[0], bestAsk: j.a[0] };
}

async function depth() {
  for (const q of ['symbol=BTCUSD', 'symbol=BTCUSD&limit=200', 'symbol=BTCUSD&limit=201', 'symbol=BTCUSD&limit=1000', 'symbol=BTCUSD&limit=20', 'symbol=XDCUSD&limit=200', 'symbol=BBTCUSD-PERPETUAL&limit=20', 'symbol=BTCUSDT-PERPETUAL&limit=20&site=MENA', 'symbol=ETHUSDT-PERPETUAL&limit=20&site=MENA', 'symbol=QQQUSDT-PERPETUAL&limit=20&site=MENA', 'symbol=NOPEUSD', '']) {
    const r = await get(`${API}/quote/v1/depth?${q}`);
    log('depth', { q, ...bookShape(r) });
    await sleep(500);
  }
  const m = await get(`${API}/quote/v1/depth/merged?symbol=BTCUSD&limit=20`);
  log('depth_merged', { ...bookShape(m) });
  // Two reads a few ms apart, to see whether a CDN or edge cache serves the same book.
  const a = await get(`${API}/quote/v1/depth?symbol=BTCUSD&limit=5`);
  const b = await get(`${API}/quote/v1/depth?symbol=BTCUSD&limit=5`);
  log('depth_cache', { t1: a.json?.t, t2: b.json?.t, sameBody: a.body === b.body, xCache: [a.headers['x-cache'], b.headers['x-cache']], cacheControl: a.headers['cache-control'] ?? null, age: a.headers.age ?? null });
}

async function bulk() {
  for (const p of ['/quote/v1/ticker/24hr', '/quote/v1/ticker/price', '/quote/v1/ticker/bookTicker', '/quote/v1/ticker/24hr?site=MENA', '/quote/v1/ticker/bookTicker?site=MENA']) {
    const r = await get(API + p);
    const rows = Array.isArray(r.json) ? r.json : [];
    const types = {};
    for (const x of rows) types[x.it ?? 'n/a'] = (types[x.it ?? 'n/a'] ?? 0) + 1;
    const zero = rows.filter((x) => x.b === '0' && x.a === '0').map((x) => x.s);
    log('bulk', { p, status: r.status, bytes: r.bytes, ms: r.ms, rows: rows.length, types, zeroBidAskRows: zero.length, sample: rows.find((x) => x.s === 'BTCUSD' || x.s === 'BTCUSDT-PERPETUAL') ?? r.body.slice(0, 160) });
    await sleep(500);
  }
}

async function anchorCalls() {
  const paths = [
    '/quote/v2/markPrice?symbol=BBTCUSD-PERPETUAL',
    '/quote/v1/markPrice?symbol=BBTCUSD-PERPETUAL',
    '/quote/v2/markPrice?symbol=BTCUSD',
    '/quote/v2/markPrice',
    '/quote/v2/index?symbol=BTCUSD',
    '/quote/v1/index?symbol=BTCUSD',
    '/quote/v1/index?symbol=BTCUSDT&site=MENA',
    '/api/v1/futures/fundingRate?symbol=BBTCUSD-PERPETUAL',
    '/api/v1/futures/historyFundingRate?symbol=BBTCUSD-PERPETUAL',
    '/quote/v2/markPrice?symbol=BTCUSDT-PERPETUAL&site=MENA',
    '/api/v1/futures/fundingRate?symbol=BTCUSDT-PERPETUAL&site=MENA',
    '/quote/v1/ticker/24hr?symbol=BBTCUSD-PERPETUAL',
    '/quote/v1/trades?symbol=BBTCUSD-PERPETUAL&limit=3',
  ];
  for (const p of paths) {
    const r = await get(API + p);
    log('anchor_call', { p, status: r.status, bytes: r.bytes, ms: r.ms, body: r.body.slice(0, 220) });
    await sleep(500);
  }
  for (const p of ['/quote/v1/index?symbol=BTCUSDT', '/api/v1/futures/fundingRate?symbol=BTCUSDT-PERPETUAL', '/quote/v1/markPrice?symbol=BTCUSDT-PERPETUAL']) {
    const r = await get(GLB + p);
    log('anchor_call_glb', { p, status: r.status, bytes: r.bytes, ms: r.ms, body: r.body.slice(0, 220) });
    await sleep(500);
  }
}

async function errorsAndHeaders() {
  const cases = ['/quote/v1/depth?symbol=BTCUSD&limit=abc', '/quote/v1/trades', '/quote/v1/klines?symbol=BTCUSD&interval=7m', '/api/v1/nope', '/api/v1/time'];
  for (const p of cases) {
    const r = await get(API + p);
    const h = r.headers ?? {};
    const keep = Object.fromEntries(Object.entries(h).filter(([k]) => /limit|retry|cache|server|via|cf-|x-amz|age|content-type/i.test(k)));
    log('error_or_header', { p, status: r.status, body: r.body.slice(0, 160), headers: keep });
    await sleep(500);
  }
}

async function poll() {
  const t = [];
  const bt = [];
  let lastBid = null;
  let bidChanges = 0;
  let lastMark = null;
  let markChanges = 0;
  const markTimes = [];
  for (let i = 0; i < 40; i++) {
    const tick = Date.now();
    const [a, m] = await Promise.all([get(`${API}/quote/v1/ticker/bookTicker`), get(`${API}/quote/v2/markPrice?symbol=BBTCUSD-PERPETUAL`)]);
    t.push(a.ms);
    const btc = Array.isArray(a.json) ? a.json.find((x) => x.s === 'BTCUSD') : null;
    if (btc) {
      if (lastBid !== null && btc.b !== lastBid) bidChanges++;
      lastBid = btc.b;
      bt.push(Date.now() - btc.t);
    }
    if (m.json?.price) {
      if (lastMark !== null && m.json.price !== lastMark) markChanges++;
      lastMark = m.json.price;
      markTimes.push(m.json.time);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  const markStep = markTimes.slice(1).map((x, i) => x - markTimes[i]).filter((x) => x > 0);
  log('poll', { polls: 40, bookTickerMs: stats(t), btcBidChanges: bidChanges, btcTickerAgeMs: stats(bt), bbtcMarkChanges: markChanges, bbtcMarkTimeSteps: stats(markStep), lastMark, lastBtcBid: lastBid });
}

const mode = process.argv[2] ?? 'main';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'main') {
  await latency();
  const e = await catalogs();
  await ccxtMaps(e);
  await depth();
  await bulk();
  await anchorCalls();
  await errorsAndHeaders();
} else if (mode === 'poll') {
  await poll();
}
log('end', { at: new Date().toISOString() });
warmAgent.destroy();
