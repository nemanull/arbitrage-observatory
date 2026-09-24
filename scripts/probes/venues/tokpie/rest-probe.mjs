// Tokpie public REST probe: DNS and request timing, the spot catalog from the bulk ticker, both book calls and their level order, trades and candles, error replies, caching over a minute of polls, and the clock.
// Public, unauthenticated, read-only. At most two requests a second, since Tokpie publishes no rate limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/tokpie/rest-probe.mjs [catalog|errors|poll|all|live [pair]]
//   catalog  DNS, one cold and five warm requests, the ticker catalog, CCXT's exchange list, both book calls at several depths, trades, candles, plain http, the documentation site status and the sign up page. About 30 s.
//   errors   unknown market, missing parameter, bad depth and size, unknown route. About 6 s.
//   live     60 s of one book_v2 read and one ticker read every 2 s on a pair that moves, BNB@USDT by default, to see whether the ticker follows the book. About 60 s, not part of all.
//   poll     Gate spot reference quotes for the six busiest USDT pairs, then 60 s of one book_v2 poll a second on the busiest pair, its ticker every 5 s, and the bulk ticker diffed across the run. About 70 s.
// Recorded in docs/profiles/tokpie/rest.md.
import { createRequire } from 'node:module';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'tokpie.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });

// One GET with phase timings. A fresh agent makes it cold.
function get(path, { agent = warmAgent, proto = https, host = HOST } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const phases = {};
    const req = proto.get({ host, path, agent, headers: { 'user-agent': 'observatory-probe', accept: 'application/json' }, timeout: 20_000 }, (res) => {
      phases.ttfb = Math.round(performance.now() - t0);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body, json, bytes: Buffer.byteLength(body), ms: Math.round(performance.now() - t0), phases, dateHeader: res.headers.date, recvAt: Date.now() });
      });
    });
    req.on('socket', (s) => {
      if (!s.connecting) return; // a reused keep-alive socket has no phases to time
      s.once('lookup', () => (phases.lookup = Math.round(performance.now() - t0)));
      s.once('connect', () => (phases.connect = Math.round(performance.now() - t0)));
      s.once('secureConnect', () => (phases.tls = Math.round(performance.now() - t0)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Math.round(performance.now() - t0), phases }));
  });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};
const order = (levels) => {
  let desc = true, asc = true;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i][0] > levels[i - 1][0]) desc = false;
    if (levels[i][0] < levels[i - 1][0]) asc = false;
  }
  return desc && asc ? 'single' : desc ? 'descending' : asc ? 'ascending' : 'unordered';
};
const pickHeaders = (h = {}) => Object.fromEntries(Object.entries(h).filter(([k]) => /server|cache|age|etag|expires|rate|limit|retry|cf-|x-|date|content-type|vary|access-control/i.test(k)));

async function tickerCatalog() {
  const r = await get('/api_ticker/');
  const rows = r.json;
  const quotes = {};
  let twoSided = 0, frozen = 0, withLast = 0, crossed = 0, unfrozenEmpty = 0;
  const updated = new Set();
  for (const t of rows) {
    const q = t.pair.split('@')[1];
    quotes[q] = (quotes[q] ?? 0) + 1;
    const both = t.highestBid && t.lowestAsk;
    if (both) twoSided++;
    if (both && Number(t.highestBid) >= Number(t.lowestAsk)) crossed++;
    if (t.isFrozen) frozen++;
    if (!t.isFrozen && !both) unfrozenEmpty++;
    if (t.last) withLast++;
    updated.add(t.updated);
  }
  const numericTypes = [...new Set(rows.flatMap((t) => ['highestBid', 'lowestAsk', 'last', 'isFrozen', 'id'].map((k) => `${k}:${t[k] === null ? 'null' : typeof t[k]}`)))];
  const perpLike = rows.filter((t) => /perp|swap|fut|[-_]p$/i.test(t.pair)).map((t) => t.pair);
  const byQuoteVolume = rows.filter((t) => t.pair.endsWith('@USDT')).sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume));
  const usdtVolume = byQuoteVolume.reduce((s, t) => s + Number(t.quoteVolume), 0);
  const twoSidedByQuote = {};
  for (const t of rows) if (t.highestBid && t.lowestAsk) twoSidedByQuote[t.pair.split('@')[1]] = (twoSidedByQuote[t.pair.split('@')[1]] ?? 0) + 1;
  const frozenWithBook = rows.filter((t) => t.isFrozen && (t.highestBid || t.lowestAsk)).length;
  const uniquePairs = new Set(rows.map((t) => t.pair)).size, uniqueIds = new Set(rows.map((t) => t.id)).size;
  const tkpAsBase = rows.filter((t) => /^tkp@/i.test(t.pair)).map((t) => t.pair);
  log('ticker_catalog', { status: r.status, bytes: r.bytes, ms: r.ms, rows: rows.length, quotes, twoSided, twoSidedByQuote, frozen, frozenWithBook, unfrozenEmpty, crossed, withLast, uniquePairs, uniqueIds, tkpAsBase, updatedValues: [...updated].sort(), numericTypes, perpLike, usdtQuoteVolume24h: Math.round(usdtVolume), topUsdt: byQuoteVolume.slice(0, 8).map((t) => `${t.pair} ${Math.round(Number(t.quoteVolume))}`) });
  return rows;
}

async function catalog() {
  const addrs = await dns.lookup(HOST, { all: true }).catch((e) => e.message);
  log('dns', { host: HOST, addrs });

  const cold = await get('/api_ticker/', { agent: new https.Agent({ keepAlive: false }) });
  log('cold', { path: '/api_ticker/', status: cold.status, bytes: cold.bytes, ms: cold.ms, phases: cold.phases, headers: pickHeaders(cold.headers) });
  const warm = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/api_ticker/?market=ETH@USDT');
    warm.push(r.ms);
    await sleep(600);
  }
  const single = await get('/api_ticker/?market=ETH@USDT');
  log('warm', { path: '/api_ticker/?market=ETH@USDT', ms: warm, single: single.json });

  const rows = await tickerCatalog();
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, tokpieLike: ccxt.exchanges.filter((id) => /tok|pie/i.test(id)) });

  const busiest = rows.filter((t) => t.pair.endsWith('@USDT') && t.highestBid && t.lowestAsk).sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume));
  const quiet = busiest.filter((t) => Number(t.quoteVolume) === 0)[0] ?? busiest[busiest.length - 1];
  for (const pair of [busiest[0].pair, quiet.pair]) {
    const tick = rows.find((t) => t.pair === pair);
    for (const size of [5, 10, 20]) {
      const r = await get(`/api_order_book/?market=${pair}&size=${size}`);
      const res = r.json?.result ?? {};
      const b = res.aob_bid ?? [], a = res.aob_ask ?? [];
      log('book_v1', { pair, size, status: r.status, bytes: r.bytes, ms: r.ms, bids: b.length, asks: a.length, bidOrder: order(b), askOrder: order(a), bestBid: b.length ? Math.max(...b.map((l) => l[0])) : null, bestAsk: a.length ? Math.min(...a.map((l) => l[0])) : null, firstAsk: a[0], lastAsk: a[a.length - 1], aob_datetime: res.aob_datetime, date: r.dateHeader });
      await sleep(500);
    }
    for (const depth of [0, 20, 100]) {
      const r = await get(`/api_order_book_v2/?market=${pair}&depth=${depth}`);
      const res = r.json?.result ?? {};
      const b = res.aob2_bids ?? [], a = res.aob2_asks ?? [];
      const bestBid = b.length ? Math.max(...b.map((l) => l[0])) : null;
      const bestAsk = a.length ? Math.min(...a.map((l) => l[0])) : null;
      log('book_v2', { pair, depth, status: r.status, bytes: r.bytes, ms: r.ms, bids: b.length, asks: a.length, bidOrder: order(b), askOrder: order(a), bestBid, bestAsk, tickerBid: Number(tick.highestBid), tickerAsk: Number(tick.lowestAsk), firstBid: b[0], firstAsk: a[0], lastAsk: a[a.length - 1], numberTypes: [typeof b[0]?.[0], typeof b[0]?.[1]], aob2_datetime: res.aob2_datetime, date: r.dateHeader, headers: pickHeaders(r.headers) });
      await sleep(500);
    }
  }

  const pair = busiest[0].pair;
  const trades = await get(`/api_trades/?market=${pair}`);
  const tr = trades.json?.result ?? [];
  log('trades', { pair, status: trades.status, bytes: trades.bytes, rows: tr.length, first: tr[0], last: tr[tr.length - 1] });
  await sleep(500);
  const hist = await get(`/api_historical_trades/?pair=${pair}`);
  const hr = hist.json?.result ?? [];
  log('historical_trades', { pair, status: hist.status, bytes: hist.bytes, rows: hr.length, first: hr[0] });
  await sleep(500);
  const candles = await get(`/api_candlestick/?pair=${pair}&limit=100&interval=1`);
  const cr = candles.json?.result ?? [];
  log('candlestick', { pair, status: candles.status, bytes: candles.bytes, rows: cr.length, first: cr[0], last: cr[cr.length - 1] });
  await sleep(500);

  const plain = await get('/api_ticker/?market=ETH@USDT', { proto: http, agent: new http.Agent() });
  log('plain_http', { status: plain.status, ms: plain.ms, location: plain.headers?.location, isJson: plain.json !== null });

  // The documentation site sits behind a Cloudflare challenge, and the sign up page is the only eligibility text on the exchange host.
  for (const path of ['/', '/api', '/fees', '/terms']) {
    const r = await get(path, { host: 'tokpie.io', agent: new https.Agent() });
    log('doc_site', { url: `https://tokpie.io${path}`, status: r.status, cfMitigated: r.headers?.['cf-mitigated'], server: r.headers?.server });
    await sleep(500);
  }
  const regis = await get('/regis/');
  const text = regis.body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  log('signup', { status: regis.status, eligibilityWords: [...new Set(text.match(/united states|\busa\b|u\.s\.|resident|citizen|countr\w*|restricted|jurisdiction/gi) ?? [])], links: [...new Set(regis.body.match(/https:\/\/tokpie\.io\/(terms|privacy)/g) ?? [])] });

  // Date carries whole seconds, so the offset is bounded to about one second either way.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/api_ticker/?market=ETH@USDT');
    const t1 = Date.now();
    offsets.push({ serverMs: Date.parse(r.dateHeader), localMid: Math.round((t0 + t1) / 2), rtt: t1 - t0 });
    await sleep(700);
  }
  log('clock', { samples: offsets.map((o) => ({ offsetMs: o.serverMs - o.localMid, rtt: o.rtt })) });
}

async function errors() {
  const cases = [
    '/api_ticker/?market=NOPE@USDT',
    '/api_order_book/?market=NOPE@USDT&size=10',
    '/api_order_book/?market=ETH@USDT',
    '/api_order_book/?market=ETH@USDT&size=0',
    '/api_order_book/?market=ETH@USDT&size=11',
    '/api_order_book_v2/?market=NOPE@USDT&depth=0',
    '/api_order_book_v2/?market=ETH@USDT',
    '/api_order_book_v2/?market=ETH@USDT&depth=-1',
    '/api_order_book_v2/?market=ETH_USDT&depth=5',
    '/api_trades/',
    '/api_trades/?market=NOPE@USDT',
    '/api_nope/',
  ];
  for (const path of cases) {
    const r = await get(path);
    const res = r.json?.result;
    const shape = r.json ? { is_ok: r.json.is_ok, result: typeof res === 'string' ? res : res && typeof res === 'object' ? Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : v])) : res } : r.body?.slice(0, 80);
    log('error_case', { path, status: r.status, ms: r.ms, contentType: r.headers?.['content-type'], shape, raw: r.json && r.bytes < 200 ? r.body : undefined });
    await sleep(500);
  }
}

// Tokpie touch against Gate spot for the busiest USDT pairs, one Gate call per pair.
async function reference(rows) {
  const top = rows.filter((t) => t.pair.endsWith('@USDT') && t.highestBid && t.lowestAsk && !/USD|PAXG|WBTC/.test(t.pair.split('@')[0])).sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, 6);
  const out = [];
  for (const t of top) {
    const base = t.pair.split('@')[0].toUpperCase();
    const g = (await get(`/api/v4/spot/tickers?currency_pair=${base}_USDT`, { host: 'api.gateio.ws', agent: new https.Agent() })).json?.[0];
    if (!g?.highest_bid) { out.push({ pair: t.pair, gate: 'absent' }); continue; }
    const tm = (Number(t.highestBid) + Number(t.lowestAsk)) / 2, gm = (Number(g.highest_bid) + Number(g.lowest_ask)) / 2;
    out.push({ pair: t.pair, tokpieBid: Number(t.highestBid), tokpieAsk: Number(t.lowestAsk), gateBid: Number(g.highest_bid), gateAsk: Number(g.lowest_ask), midGapPpm: Math.round(((tm - gm) / gm) * 1e6), tokpieSpreadPpm: Math.round(((Number(t.lowestAsk) - Number(t.highestBid)) / tm) * 1e6) });
    await sleep(300);
  }
  log('reference', { at: new Date().toISOString(), pairs: out });
}

const tops = (rows) => new Map(rows.filter((t) => t.highestBid && t.lowestAsk).map((t) => [t.pair, `${t.highestBid}/${t.lowestAsk}`]));

async function poll() {
  const rows = (await get('/api_ticker/')).json;
  const pair = rows.filter((t) => t.pair.endsWith('@USDT') && t.highestBid && t.lowestAsk).sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))[0].pair;
  await reference(rows);
  const firstTops = tops(rows);

  const lat = [], tickerLat = [];
  const seen = { top: new Set(), full: new Set(), datetimes: new Set() };
  let changesTop = 0, changesFull = 0, prevTop = null, prevFull = null, polls = 0;
  const lags = [];
  const tickerVsBook = [];
  let lastBook = null;
  const start = Date.now();
  for (let i = 0; Date.now() - start < 60_000; i++) {
    const tick = performance.now();
    const r = await get(`/api_order_book_v2/?market=${pair}&depth=20`);
    polls++;
    lat.push(r.ms);
    const res = r.json?.result ?? {};
    const b = res.aob2_bids ?? [], a = res.aob2_asks ?? [];
    const bb = Math.max(...b.map((l) => l[0])), ba = Math.min(...a.map((l) => l[0]));
    const top = `${bb}/${ba}`;
    const full = JSON.stringify([b, a]);
    if (prevTop !== null && top !== prevTop) changesTop++;
    if (prevFull !== null && full !== prevFull) changesFull++;
    prevTop = top; prevFull = full;
    seen.top.add(top); seen.full.add(full); seen.datetimes.add(res.aob2_datetime);
    const dt = res.aob2_datetime?.match(/(\d+)\.(\d+)\.(\d+) (\d+):(\d+):(\d+)/);
    if (dt) lags.push(r.recvAt - Date.UTC(+dt[3], +dt[2] - 1, +dt[1], +dt[4], +dt[5], +dt[6]));
    lastBook = { bb, ba };
    if (i % 5 === 0) {
      const t = await get(`/api_ticker/?market=${pair}`);
      tickerLat.push(t.ms);
      const tr = t.json?.result;
      if (tr) tickerVsBook.push({ tickerBid: Number(tr.highestBid), tickerAsk: Number(tr.lowestAsk), bookBid: lastBook.bb, bookAsk: lastBook.ba, updated: tr.updated, id: tr.id });
    }
    const wait = 1000 - (performance.now() - tick);
    if (wait > 0) await sleep(wait);
  }
  const ticks = tickerVsBook.length;
  const agree = tickerVsBook.filter((x) => x.tickerBid === x.bookBid && x.tickerAsk === x.bookAsk).length;
  const lastTops = tops((await get('/api_ticker/')).json);
  const changedPairs = [...firstTops].filter(([k, v]) => lastTops.has(k) && lastTops.get(k) !== v).map(([k]) => k);
  log('catalog_tops', { twoSidedAtStart: firstTops.size, twoSidedAtEnd: lastTops.size, changedOverRun: changedPairs.length, changed: changedPairs.slice(0, 20) });
  log('poll', { pair, polls, bookLatency: stats(lat), tickerLatency: stats(tickerLat), distinctTop: seen.top.size, distinctBooks: seen.full.size, topChanges: changesTop, bookChanges: changesFull, distinctDatetimes: seen.datetimes.size, datetimeLagMs: stats(lags), tickerSamples: ticks, tickerTopEqualsBookTop: agree, tickerIds: [...new Set(tickerVsBook.map((x) => x.id))], tickerUpdated: [...new Set(tickerVsBook.map((x) => x.updated))], lastTop: lastBook, sample: tickerVsBook.slice(0, 2) });
}

// Whether the single-pair ticker follows the book: every 2 s for 60 s, one book_v2 read and one ticker read on a pair that moves.
async function live(pair) {
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const tick = performance.now();
    const b = (await get(`/api_order_book_v2/?market=${pair}&depth=5`)).json?.result ?? {};
    const t = (await get(`/api_ticker/?market=${pair}`)).json?.result ?? {};
    const bb = Math.max(...(b.aob2_bids ?? []).map((l) => l[0])), ba = Math.min(...(b.aob2_asks ?? []).map((l) => l[0]));
    samples.push({ book: `${bb}/${ba}`, ticker: `${Number(t.highestBid)}/${Number(t.lowestAsk)}`, updated: t.updated });
    const wait = 2000 - (performance.now() - tick);
    if (wait > 0) await sleep(wait);
  }
  const distinct = (k) => new Set(samples.map((x) => x[k])).size;
  log('live', { pair, samples: samples.length, distinctBookTops: distinct('book'), distinctTickerTops: distinct('ticker'), tickerEqualsBook: samples.filter((x) => x.book === x.ticker).length, updated: [...new Set(samples.map((x) => x.updated))], mismatches: samples.filter((x) => x.book !== x.ticker).slice(0, 3) });
}

const mode = process.argv[2] ?? 'all';
if (mode === 'catalog' || mode === 'all') await catalog();
if (mode === 'errors' || mode === 'all') await errors();
if (mode === 'poll' || mode === 'all') await poll();
if (mode === 'live') await live(process.argv[3] ?? 'BNB@USDT');
warmAgent.destroy();
