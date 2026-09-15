// Read-only REST probe of Gemini perpetuals: host, CCXT catalog, symbol details, anchor calls, REST book, error shapes and latency.
// Every call is public and unauthenticated, and request starts are spaced at least 550 ms apart, so the process stays under 110 requests per minute, inside Gemini's published 120.
// Run from server/: OUT=<dir> node ../scripts/probes/gemini-venue-probe.mjs [sections]
// Sections default to host,catalog,details,book,errors,anchor. OUT, when set, receives one JSON file per section.
// Recorded in docs/profiles/gemini/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';

// Package resolution follows the importing file, so the server's node_modules is named explicitly.
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'api.gemini.com';
const OUT = process.env.OUT;
const SECTIONS = (process.argv[2] ?? 'host,catalog,details,book,errors,anchor').split(',');
const ANCHOR_POLLS = Number(process.env.ANCHOR_POLLS ?? 60);
const ANCHOR_SYMBOLS = (process.env.ANCHOR_SYMBOLS ?? 'btcgusdperp,ethgusdperp,trumpgusdperp,avaxusdcperp').split(',');
const MIN_GAP_MS = 550; // between request starts, process wide

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });
let lastStart = 0;
let gate = Promise.resolve();

// Chained, so concurrent callers such as the riskstats and funding loops cannot start two requests inside one gap.
function spaced() {
  gate = gate.then(async () => {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  return gate;
}

function save(name, data) {
  console.log(JSON.stringify({ section: name, ...summaryOf(data) }));
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/rest-${name}.json`, JSON.stringify(data, null, 2));
  }
}

function summaryOf(data) {
  const text = JSON.stringify(data);
  return text.length < 6000 ? { data } : { bytes: text.length, note: 'full result in OUT' };
}

// One GET with a timing breakdown. cold opens a fresh TLS connection, warm reuses the keep-alive agent.
async function get(path, { cold = false } = {}) {
  await spaced();
  return new Promise((resolve) => {
    const t0 = performance.now();
    const marks = {};
    const req = https.request(
      { host: HOST, path, method: 'GET', headers: { accept: 'application/json' }, agent: cold ? new https.Agent({ keepAlive: false }) : warmAgent },
      (res) => {
        marks.firstByteMs = performance.now() - t0;
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(body); } catch { json = undefined; }
          resolve({
            path,
            status: res.statusCode,
            bytes: Buffer.byteLength(body),
            totalMs: round(performance.now() - t0),
            firstByteMs: round(marks.firstByteMs),
            tlsMs: marks.tlsMs === undefined ? null : round(marks.tlsMs),
            reused: marks.tlsMs === undefined,
            headers: pick(res.headers, ['date', 'server', 'cache-control', 'age', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'content-encoding']),
            body: json ?? body.slice(0, 300),
            arrivedAt: Date.now(),
          });
        });
      },
    );
    req.on('socket', (s) => {
      if (s.connecting) s.once('secureConnect', () => (marks.tlsMs = performance.now() - t0));
    });
    req.on('error', (e) => resolve({ path, error: e.message }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const round = (x) => (x === undefined ? null : Math.round(x * 10) / 10);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

async function host() {
  const out = {};
  out.lookup = await dns.lookup(HOST, { all: true }).catch((e) => e.message);
  out.cname = await dns.resolveCname(HOST).catch((e) => e.code);
  out.wsCname = await dns.resolveCname('ws.gemini.com').catch((e) => e.code);
  out.wsLookup = await dns.lookup('ws.gemini.com', { all: true }).catch((e) => e.message);
  const calls = ['/v1/symbols', '/v1/riskstats/btcgusdperp', '/v1/fundingamount/btcgusdperp', '/v1/book/btcgusdperp?limit_bids=20&limit_asks=20'];
  out.latency = [];
  for (const path of calls) {
    const cold = await get(path, { cold: true });
    const warm = [];
    for (let i = 0; i < 5; i++) warm.push(await get(path));
    out.latency.push({
      path,
      cold: { status: cold.status, bytes: cold.bytes, tlsMs: cold.tlsMs, firstByteMs: cold.firstByteMs, totalMs: cold.totalMs, server: cold.headers?.server },
      warmTotalMs: warm.map((w) => w.totalMs),
      warmReused: warm.map((w) => w.reused),
    });
  }
  save('host', out);
}

async function catalog() {
  const ex = new ccxt.gemini();
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  // The same filter as server/src/ccxt/connector.ts isActiveSwapMarket.
  const swaps = all.filter((m) => m !== undefined && m.type === 'swap' && m.swap === true && m.active !== false);
  const bySettle = {};
  for (const m of swaps) bySettle[`${m.settle}|linear=${m.linear}`] = (bySettle[`${m.settle}|linear=${m.linear}`] ?? 0) + 1;
  const show = (m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, active: m.active, contractSize: m.contractSize ?? null, taker: m.taker, maker: m.maker, precision: { price: m.precision.price ?? null, amount: m.precision.amount ?? null }, minAmount: m.limits.amount.min ?? null, info: m.info });
  // CCXT fills tradingPairs, and so precision and contractSize, only when this page scrape succeeds, see ccxt/js/src/gemini.js:420.
  const scrape = await fetch('https://exchange.gemini.com/', { redirect: 'manual' }).then((r) => ({ status: r.status, location: r.headers.get('location') })).catch((e) => ({ error: e.message }));
  save('catalog', {
    ccxtVersion: ccxt.version,
    exchangePageScrape: scrape,
    loadMs: Date.now() - t0,
    marketCount: all.length,
    spotCount: all.filter((m) => m.spot).length,
    activeSwapCount: swaps.length,
    bySettle,
    tradingPairsScraped: Array.isArray(ex.options.tradingPairs),
    swaps: swaps.map(show),
  });
}

async function details() {
  const symbols = await get('/v1/symbols');
  const perps = symbols.body.filter((s) => s.endsWith('perp'));
  const rows = [];
  for (const s of perps) {
    const d = await get(`/v1/symbols/details/${s}`);
    rows.push({ requested: s, status: d.status, server: d.headers.server, body: d.body });
  }
  const pricefeed = await get('/v1/pricefeed');
  const perpPrices = Array.isArray(pricefeed.body) ? pricefeed.body.filter((p) => /PERP$/i.test(p.pair)) : pricefeed.body;
  const tickerV2 = await get('/v2/ticker/trumpgusdperp');
  const tickerV1 = await get('/v1/pubticker/trumpgusdperp');
  save('details', { symbolsBytes: symbols.bytes, symbolCount: symbols.body.length, perps, rows, pricefeed: { bytes: pricefeed.bytes, pairs: pricefeed.body.length, perpPrices }, tickerV2: tickerV2.body, tickerV1: tickerV1.body });
}

function orderOf(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (dir === 'desc' ? b >= a : b <= a) return `broken at ${i}`;
  }
  return dir === 'desc' ? 'strictly descending' : 'strictly ascending';
}

async function book() {
  const out = { pairs: [], full: [], repeat: [] };
  for (const base of ['btc', 'eth', 'sol', 'xrp', 'avax', 'hype']) {
    const g = await get(`/v1/book/${base}gusdperp?limit_bids=20&limit_asks=20`);
    const u = await get(`/v1/book/${base}usdcperp?limit_bids=20&limit_asks=20`);
    const same = JSON.stringify(g.body.bids?.map((l) => [l.price, l.amount])) === JSON.stringify(u.body.bids?.map((l) => [l.price, l.amount])) &&
      JSON.stringify(g.body.asks?.map((l) => [l.price, l.amount])) === JSON.stringify(u.body.asks?.map((l) => [l.price, l.amount]));
    out.pairs.push({ base, gusd: { status: g.status, bids: g.body.bids?.length, asks: g.body.asks?.length, top: [g.body.bids?.[0], g.body.asks?.[0]] }, usdc: { status: u.status, bids: u.body.bids?.length, asks: u.body.asks?.length, top: [u.body.bids?.[0], u.body.asks?.[0]] }, gapMs: u.arrivedAt - g.arrivedAt, identicalTop20: same });
  }
  for (const s of ['btcgusdperp', 'trumpgusdperp']) {
    const f = await get(`/v1/book/${s}?limit_bids=0&limit_asks=0`);
    const d = await get(`/v1/book/${s}`);
    out.full.push({ symbol: s, bytes: f.bytes, bids: f.body.bids.length, asks: f.body.asks.length, bidOrder: orderOf(f.body.bids, 'desc'), askOrder: orderOf(f.body.asks, 'asc'), worstBid: f.body.bids.at(-1), worstAsk: f.body.asks.at(-1), defaultBids: d.body.bids.length, defaultAsks: d.body.asks.length, timestampField: f.body.bids[0]?.timestamp, headers: f.headers, totalMs: f.totalMs });
  }
  // Two reads 0.6 s apart show whether an edge cache answers the book call.
  for (let i = 0; i < 3; i++) {
    const r = await get('/v1/book/btcgusdperp?limit_bids=3&limit_asks=3');
    out.repeat.push({ totalMs: r.totalMs, headers: r.headers, top: [r.body.bids[0], r.body.asks[0]] });
  }
  save('book', out);
}

async function errors() {
  const paths = ['/v1/book/nosuchperp', '/v1/riskstats/nosuchperp', '/v1/fundingamount/nosuchperp', '/v1/riskstats/btcusd', '/v1/fundingamount/btcusd', '/v1/riskstats', '/v1/fundingamount', '/v1/feepromos', '/v1/symbols/details/nosuchperp', '/v1/riskstats/BTCGUSDPERP', '/v1/fundingamount/BTCGUSDPERP', '/v1/nextfundingtimestamp/btcgusdperp'];
  const rows = [];
  for (const p of paths) {
    const r = await get(p);
    rows.push({ path: p, status: r.status, bytes: r.bytes, totalMs: r.totalMs, server: r.headers.server, body: r.body });
  }
  save('errors', rows);
}

// Polls riskstats once a second for each symbol in turn, and fundingamount every fifth second, then reads one full round of every perpetual.
async function anchor() {
  const out = { perSymbol: [], fullRound: [] };
  for (const s of ANCHOR_SYMBOLS) {
    const risk = [];
    const funding = [];
    const start = Date.now();
    const riskLoop = async () => {
      for (let i = 0; i < ANCHOR_POLLS; i++) {
        const due = start + i * 1000;
        if (due > Date.now()) await sleep(due - Date.now());
        const r = await get(`/v1/riskstats/${s}`);
        risk.push({ at: r.arrivedAt, ms: r.totalMs, status: r.status, mark: r.body.mark_price, index: r.body.index_price, oi: r.body.open_interest });
      }
    };
    // The funding call answers in about 3 s, so it runs beside the riskstats loop rather than inside it.
    const fundingLoop = async () => {
      for (let i = 0; i < ANCHOR_POLLS / 5; i++) {
        const due = start + 500 + i * 5000;
        if (due > Date.now()) await sleep(due - Date.now());
        const f = await get(`/v1/fundingamount/${s}`);
        funding.push({ at: f.arrivedAt, ms: f.totalMs, status: f.status, body: f.body });
      }
    };
    await Promise.all([riskLoop(), fundingLoop()]);
    out.perSymbol.push({ symbol: s, polls: risk.length, markChanges: changes(risk.map((x) => x.mark)), indexChanges: changes(risk.map((x) => x.index)), riskMs: stats(risk.map((x) => x.ms)), statuses: [...new Set(risk.map((x) => x.status))], fundingPolls: funding.length, estimatedChanges: changes(funding.map((x) => x.body.estimatedFundingAmount)), fundingMs: stats(funding.map((x) => x.ms)), firstRisk: risk[0], lastRisk: risk.at(-1), funding, risk });
    console.log(JSON.stringify({ section: 'anchor-progress', symbol: s, markChanges: out.perSymbol.at(-1).markChanges, indexChanges: out.perSymbol.at(-1).indexChanges, riskMs: out.perSymbol.at(-1).riskMs, fundingMs: out.perSymbol.at(-1).fundingMs, estimatedChanges: out.perSymbol.at(-1).estimatedChanges }));
  }
  const symbols = (await get('/v1/symbols')).body.filter((s) => s.endsWith('perp'));
  for (const s of symbols) {
    const r = await get(`/v1/riskstats/${s}`);
    const f = await get(`/v1/fundingamount/${s}`);
    const mark = Number(r.body.mark_price);
    out.fullRound.push({ symbol: s, riskMs: r.totalMs, fundingMs: f.totalMs, mark: r.body.mark_price, index: r.body.index_price, oi: r.body.open_interest, oiNotional: r.body.open_interest_notional, markOverIndexPpm: Math.round((mark / Number(r.body.index_price) - 1) * 1e6), funding: f.body, estimatedOverMarkPct: f.body.estimatedFundingAmount / mark * 100, intervalHours: (f.body.nextFundingTimestamp - f.body.fundingTimestampMilliSecs) / 3600000 });
  }
  save('anchor', out);
}

function changes(values) {
  let n = 0;
  for (let i = 1; i < values.length; i++) if (values[i] !== values[i - 1]) n++;
  return n;
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s.at(-1) };
}

const RUN = { host, catalog, details, book, errors, anchor };
const began = Date.now();
for (const name of SECTIONS) {
  try {
    await RUN[name]();
  } catch (e) {
    console.log(JSON.stringify({ section: name, error: String(e.stack ?? e).slice(0, 400) }));
  }
}
console.log(JSON.stringify({ done: true, wallMs: Date.now() - began, at: new Date().toISOString() }));
process.exit(0);
