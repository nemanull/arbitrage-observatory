// Bitlo public REST probe: host and latency, clock offset, spot catalog, REST book shape and sequence, the bulk ticker as the only reference price, request pacing and error shapes.
// Public, unauthenticated, read-only. No account, no key, no order.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitlo/rest-probe.mjs [host|catalog|book|ticker|limits|all]
//   host     DNS, cold and warm request time on each public call, website and document reachability, server time offset. About 12 s.
//   catalog  CCXT class check, /config markets by quote and status, the fee schedule, and the ticker list against the catalog. About 3 s.
//   book     /market/orderbook on five markets: depth, level order, sequenceId, repeat reads, depth parameters. About 10 s.
//   ticker   /market/ticker/all and the BTC-TRY book once a second for 120 s: reply size and time, and when the ticker touch changes. About 122 s.
//   limits   20 back-to-back book reads, then the error shapes of bad calls. About 15 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitlo/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API4 = 'https://api4.bitlo.com';
const API = 'https://api.bitlo.com';
const BOOK_MARKETS = ['BTC-TRY', 'ETH-TRY', 'USDT-TRY', 'BTC-USDT', 'CHR-TRY'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// One GET, timed from request to last byte, on a fresh connection unless warm is set.
function get(url, warm = false) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = https.get(url, { agent: warm ? warmAgent : new https.Agent({ keepAlive: false }), headers: { 'user-agent': 'observatory-probe', 'accept-encoding': 'identity' } }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, bytes: Buffer.byteLength(body), ms: Math.round(performance.now() - t0), t0: Date.now() });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Math.round(performance.now() - t0) }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function host() {
  for (const h of ['api4.bitlo.com', 'api.bitlo.com', 'api3.bitlo.com', 'www.bitlo.com', 'docs.bitlo.com']) {
    const a = await lookup(h, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host: h, addresses: a.map((x) => x.address) });
  }
  const calls = [`${API}/config/servertime`, `${API4}/config`, `${API4}/market/ticker/all`, `${API4}/market/orderbook?market=BTC-TRY`, `${API4}/market/market-ticker?market=BTC-TRY`, `${API4}/market/orderbook/fills?market=BTC-TRY`];
  for (const url of calls) {
    const cold = await get(url);
    const warm = [];
    for (let i = 0; i < 5; i++) warm.push((await get(url, true)).ms);
    log('latency', { url, status: cold.status, bytes: cold.bytes, coldMs: cold.ms, warmMs: warm, cfRay: cold.headers?.['cf-ray'], cache: cold.headers?.['cache-control'] });
  }
  for (const url of ['https://www.bitlo.com/komisyonlar', 'https://docs.bitlo.com/', 'https://www.bitlo.exchange/']) {
    const r = await get(url);
    log('page', { url, status: r.status, contentType: r.headers?.['content-type'], bytes: r.bytes, title: (r.body ?? '').match(/<title>([^<]*)/)?.[1] ?? null });
  }
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get(`${API}/config/servertime`, true);
    const after = Date.now();
    const server = JSON.parse(r.body).serverTime;
    offsets.push({ offsetMs: server - (before + after) / 2, rttMs: after - before });
  }
  log('clock', { body: (await get(`${API}/config/servertime`, true)).body, offsetsMs: offsets.map((o) => o.offsetMs), rttMs: offsets.map((o) => o.rttMs) });
}

async function catalog() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, bitloLike: ccxt.exchanges.filter((x) => /bitlo/i.test(x)) });
  const r4 = await get(`${API4}/config`);
  keep('config.json', r4.body);
  const c = JSON.parse(r4.body);
  const byQuote = {};
  for (const m of c.markets) {
    const k = `${m.quoteAssetCode} tradingEnabled=${m.tradingEnabled} reason=${m.tradeDisabledReason} platform=${m.tradePlatformId}`;
    byQuote[k] = (byQuote[k] ?? 0) + 1;
  }
  const ids = c.markets.map((m) => m.code);
  const badId = ids.filter((id) => !/^[A-Z0-9]+-(TRY|USDT)$/.test(id));
  const bases = {};
  for (const m of c.markets.filter((x) => x.tradingEnabled)) (bases[m.baseAssetCode] ??= []).push(m.quoteAssetCode);
  const both = Object.entries(bases).filter(([, q]) => q.length > 1).length;
  const derivLike = ids.filter((id) => /PERP|SWAP|FUT|-P$|\d{6}/i.test(id));
  log('catalog', { status: r4.status, bytes: r4.bytes, markets: c.markets.length, assets: c.assets.length, byQuote, badIdPattern: badId, basesOnBothQuotes: both, derivativeLike: derivLike, topKeys: Object.keys(c), marketKeys: Object.keys(c.markets[0]) });
  log('fee_schedule', { exchangeFeeSchedule: c.exchangeFeeSchedule, settings: c.settings, convertibleAsset: c.convertibleAsset });
  const cats = Object.fromEntries(c.marketCategories.map((x) => [x.id, x.enName ?? x.name]));
  for (const id of [32, 26, 28]) {
    log('category', { id, name: cats[id], markets: c.markets.filter((m) => (m.category ?? []).includes(id)).map((m) => m.code) });
  }
  const r1 = await get(`${API}/config`);
  const c1 = JSON.parse(r1.body);
  log('catalog_api1', { status: r1.status, bytes: r1.bytes, markets: c1.markets.length, sameIds: JSON.stringify(c1.markets.map((m) => m.code).sort()) === JSON.stringify([...ids].sort()), extraTopKeys: Object.keys(c1).filter((k) => !(k in c)) });
  const t = await get(`${API4}/market/ticker/all`);
  const tickers = JSON.parse(t.body);
  const tset = new Set(tickers.map((x) => x.marketCode));
  const trading = c.markets.filter((m) => m.tradingEnabled).map((m) => m.code);
  const disabled = c.markets.filter((m) => !m.tradingEnabled).map((m) => m.code);
  log('ticker_vs_catalog', {
    tickers: tickers.length,
    tradingMissingFromTicker: trading.filter((x) => !tset.has(x)),
    disabledInTicker: disabled.filter((x) => tset.has(x)).length,
    tickerNotInCatalog: [...tset].filter((x) => !ids.includes(x)),
    emptyBidOrAsk: tickers.filter((x) => !(Number(x.bid) > 0) || !(Number(x.ask) > 0)).length,
    tradingWithAnEmptySide: tickers.filter((x) => trading.includes(x.marketCode) && (!(Number(x.bid) > 0) || !(Number(x.ask) > 0))).map((x) => `${x.marketCode} ${x.bid}/${x.ask}`),
    crossedOrLocked: tickers.filter((x) => Number(x.bid) > 0 && Number(x.ask) > 0 && Number(x.bid) >= Number(x.ask)).map((x) => x.marketCode),
  });
  const usdt = tickers.filter((x) => x.marketCode.endsWith('-USDT') && Number(x.bid) > 0 && Number(x.ask) > 0);
  const spreads = usdt.map((x) => Math.round(((Number(x.ask) - Number(x.bid)) / ((Number(x.ask) + Number(x.bid)) / 2)) * 1e6));
  const vol = usdt.map((x) => Number(x.notionalVolume24h)).sort((a, b) => b - a);
  log('usdt_markets', { withTwoSides: usdt.length, spreadPpm: stats(spreads), notionalVolume24hUsdt: { top5: vol.slice(0, 5).map(Math.round), total: Math.round(vol.reduce((a, b) => a + b, 0)), over10k: vol.filter((v) => v > 10000).length } });
  const tryT = tickers.filter((x) => x.marketCode.endsWith('-TRY') && Number(x.bid) > 0 && Number(x.ask) > 0);
  const tryVol = tryT.map((x) => Number(x.notionalVolume24h)).sort((a, b) => b - a);
  log('try_markets', { withTwoSides: tryT.length, spreadPpm: stats(tryT.map((x) => Math.round(((Number(x.ask) - Number(x.bid)) / ((Number(x.ask) + Number(x.bid)) / 2)) * 1e6))), notionalVolume24hTry: { top5: tryVol.slice(0, 5).map(Math.round), total: Math.round(tryVol.reduce((a, b) => a + b, 0)) } });
  log('ticker_sample', { row: tickers.find((x) => x.marketCode === 'BTC-USDT') });
}

function orderInfo(side, asc) {
  let bad = 0;
  for (let i = 1; i < side.length; i++) {
    const a = Number(side[i - 1]['0']);
    const b = Number(side[i]['0']);
    if (asc ? b <= a : b >= a) bad++;
  }
  return bad;
}

async function book() {
  for (const m of BOOK_MARKETS) {
    const r = await get(`${API4}/market/orderbook?market=${m}`, true);
    keep(`book-${m}.json`, r.body);
    const j = JSON.parse(r.body);
    const r2 = await get(`${API4}/market/orderbook?market=${m}`, true);
    const j2 = JSON.parse(r2.body);
    log('book', {
      market: m, status: r.status, ms: r.ms, bytes: r.bytes, keys: Object.keys(j), sequenceId: j.sequenceId, bids: j.bids.length, asks: j.asks.length,
      bidsNotDescending: orderInfo(j.bids, false), asksNotAscending: orderInfo(j.asks, true),
      top: { bid: j.bids[0], ask: j.asks[0] }, levelKeys: Object.keys(j.bids[0] ?? {}),
      repeatSequenceId: j2.sequenceId, repeatMsLater: r2.t0 - r.t0, cacheControl: r.headers['cache-control'], age: r.headers.age ?? null, cfCache: r.headers['cf-cache-status'],
    });
  }
  for (const q of ['limit=5', 'limit=100', 'depth=5', 'size=100', 'level=100']) {
    const r = await get(`${API4}/market/orderbook?market=BTC-TRY&${q}`, true);
    const j = JSON.parse(r.body);
    log('book_param', { query: q, status: r.status, bids: j.bids?.length, asks: j.asks?.length });
  }
  const fills = await get(`${API4}/market/orderbook/fills?market=BTC-TRY`, true);
  const f = JSON.parse(fills.body);
  log('fills', { status: fills.status, n: f.fills?.length, sample: f.fills?.[0] });
}

async function ticker() {
  const POLLS = 120;
  const times = [];
  const sizes = [];
  let prev = null;
  let prevBook = null;
  const changed = { 'BTC-TRY': 0, 'ETH-TRY': 0, 'USDT-TRY': 0, 'BTC-USDT': 0, 'CHR-TRY': 0 };
  const changeAt = [];
  let bookChanges = 0;
  let tickerEqualsBook = 0;
  let bad = 0;
  const t0 = Date.now();
  for (let i = 0; i < POLLS; i++) {
    const tick = Date.now();
    const [r, b] = await Promise.all([get(`${API4}/market/ticker/all`, true), get(`${API4}/market/orderbook?market=BTC-TRY`)]);
    if (r.status !== 200) { bad++; log('ticker_status', { i, status: r.status }); }
    else {
      times.push(r.ms);
      sizes.push(r.bytes);
      const all = JSON.parse(r.body);
      const rows = Object.fromEntries(all.map((x) => [x.marketCode, `${x.bid}|${x.ask}`]));
      const bj = b.status === 200 ? JSON.parse(b.body) : null;
      const bookTop = bj ? `${bj.bids[0]?.['0']}|${bj.asks[0]?.['0']}` : null;
      if (bookTop === rows['BTC-TRY']) tickerEqualsBook++;
      if (prevBook !== null && bookTop !== prevBook) bookChanges++;
      prevBook = bookTop;
      if (prev) {
        let n = 0;
        for (const k of Object.keys(rows)) if (rows[k] !== prev[k]) n++;
        if (n > 0) changeAt.push({ poll: i, sAfterStart: Math.round((tick - t0) / 1000), markets: n });
        for (const k of Object.keys(changed)) if (rows[k] !== prev[k]) changed[k]++;
      }
      prev = rows;
    }
    const wait = 1000 - (Date.now() - tick);
    if (wait > 0) await sleep(wait);
  }
  log('ticker_poll', { polls: POLLS, wallMs: Date.now() - t0, non200: bad, ms: stats(times), bytes: stats(sizes), touchChangedTransitions: changed, pollsWithAnyChange: changeAt, btcTryBookTopChanged: bookChanges, btcTryTickerEqualsBookTop: tickerEqualsBook });
  const one = await get(`${API4}/market/market-ticker?market=BTC-USDT`, true);
  const allNow = JSON.parse((await get(`${API4}/market/ticker/all`, true)).body).find((x) => x.marketCode === 'BTC-USDT');
  log('market_ticker', { status: one.status, ms: one.ms, single: JSON.parse(one.body), bulkRowSameMarket: allNow });
}

async function limits() {
  const statuses = {};
  const ms = [];
  const rlHeaders = new Set();
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    const r = await get(`${API4}/market/orderbook?market=BTC-TRY`, true);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    ms.push(r.ms);
    for (const h of Object.keys(r.headers ?? {})) if (/rate|limit|retry|remaining/i.test(h)) rlHeaders.add(`${h}: ${r.headers[h]}`);
  }
  log('burst', { requests: 20, wallMs: Date.now() - t0, statuses, ms: stats(ms), rateLimitHeaders: [...rlHeaders] });
  const bad = [
    `${API4}/market/orderbook?market=NOPE-TRY`,
    `${API4}/market/orderbook`,
    `${API4}/market/orderbook?market=btc-try`,
    `${API4}/market/orderbook?market=BTC_TRY`,
    `${API4}/market/market-ticker?market=NOPE-TRY`,
    `${API4}/market/nope`,
    `${API}/market/orderbook?market=BTC-TRY`,
    `${API}/market/ticker/all`,
    `${API4}/market/ticker/all?ask=false`,
    `${API4}/config/servertime`,
    `https://api3.bitlo.com/api/v3/klines/history?symbol=BTC-TRY&resolution=60&from=${Math.floor(Date.now() / 1000) - 7200}&to=${Math.floor(Date.now() / 1000)}`,
    `${API4}/ws/info`,
    `${API}/`,
  ];
  for (const url of bad) {
    const r = await get(url, true);
    log('error_shape', { url, status: r.status, contentType: r.headers?.['content-type'], location: r.headers?.location, bytes: r.bytes, body: (r.body ?? r.error ?? '').slice(0, 220) });
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { host, catalog, book, ticker, limits };
console.log(JSON.stringify({ tag: 'start', mode, at: new Date().toISOString() }));
if (mode === 'all') {
  for (const m of ['host', 'catalog', 'book', 'limits', 'ticker']) await modes[m]();
} else {
  await modes[mode]();
}
warmAgent.destroy();
console.log(JSON.stringify({ tag: 'end', at: new Date().toISOString() }));
