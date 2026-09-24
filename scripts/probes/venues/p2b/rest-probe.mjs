// P2B public REST probe: DNS and request timing, the spot catalog and how CCXT maps it, the bulk ticker, the depth and book calls, caching, error replies, and the clock.
// Public, unauthenticated, read-only. At most two requests a second, well inside CCXT's 100 ms rateLimit for this venue.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/p2b/rest-probe.mjs [catalog|timing|depth|errors|all]
//   catalog  markets, tickers and CCXT loadMarkets side by side. About 5 s.
//   timing   DNS, one cold request per call, then 30 tickers polls at 1 s with cache_time and BTC_USDT bid and ask changes. About 35 s.
//   depth    depth/result and book on BTC_USDT and a quiet market, level order, limits, and 15 depth polls at 1 s. About 25 s.
//   errors   unknown market, bad limit, bad side, bad interval, unknown route. About 6 s.
// Recorded in docs/profiles/p2b/rest.md.
import { createRequire } from 'node:module';
import https from 'node:https';
import dns from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'api.p2pb2b.com';
const BASE = '/api/v2/public';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 2 });

// One GET with a timing breakdown. agent false opens a fresh TCP and TLS connection.
function get(path, { cold = false } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const t = {};
    const req = https.request({ host: HOST, path, method: 'GET', agent: cold ? false : warmAgent, headers: { 'user-agent': 'observatory-probe' } }, (res) => {
      t.firstByte = performance.now() - t0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        t.total = performance.now() - t0;
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, bytes: text.length, text, json, ms: t, localMs: Date.now() });
      });
    });
    req.on('socket', (s) => {
      if (!s.connecting) return; // a reused keep-alive socket has no lookup, connect or handshake to time
      s.once('lookup', () => { t.dns = performance.now() - t0; });
      s.once('connect', () => { t.connect = performance.now() - t0; });
      s.once('secureConnect', () => { t.tls = performance.now() - t0; });
    });
    req.on('error', (e) => resolve({ status: null, error: e.message, ms: t }));
    req.end();
  });
}

const round = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]));
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: Math.round(s[0]), median: Math.round(s[Math.floor(s.length / 2)]), p90: Math.round(s[Math.floor(s.length * 0.9)]), max: Math.round(s[s.length - 1]) };
};

function orderOf(levels, side) {
  if (!levels || levels.length < 2) return 'n<2';
  let asc = true, desc = true;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0] ?? levels[i - 1].price), b = Number(levels[i][0] ?? levels[i].price);
    if (b < a) asc = false;
    if (b > a) desc = false;
  }
  if (side === 'bids') return desc ? 'best first' : asc ? 'worst first' : 'unordered';
  return asc ? 'best first' : desc ? 'worst first' : 'unordered';
}

async function catalog() {
  const m = await get(`${BASE}/markets`);
  const rows = m.json.result;
  const byQuote = {};
  for (const r of rows) byQuote[r.money] = (byQuote[r.money] ?? 0) + 1;
  log('markets', { status: m.status, bytes: m.bytes, rows: rows.length, byQuote, rowKeys: Object.keys(rows[0]), limitsKeys: Object.keys(rows[0].limits), cacheTime: m.json.cache_time, currentTime: m.json.current_time, varnish: m.headers['x-varnish-ttl'], xCache: m.headers['x-cache'], cfRay: m.headers['cf-ray'] });
  const zeroLimits = rows.filter((r) => Number(r.limits.max_amount) === 0 || Number(r.limits.max_price) === 0).map((r) => r.name);
  log('markets-limits', { zeroMaxAmountOrPrice: zeroLimits.length, sample: zeroLimits.slice(0, 5) });

  const tk = await get(`${BASE}/tickers`);
  const tkeys = Object.keys(tk.json.result);
  const names = new Set(rows.map((r) => r.name));
  log('tickers', { status: tk.status, bytes: tk.bytes, rows: tkeys.length, notInMarkets: tkeys.filter((k) => !names.has(k)), marketsNotInTickers: [...names].filter((n) => !tk.json.result[n]), sample: tk.json.result.BTC_USDT, tickerKeys: Object.keys(tk.json.result.BTC_USDT.ticker) });

  const ex = new ccxt.p2b();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const types = {};
  for (const x of list) types[`${x.type}/spot=${x.spot}/swap=${x.swap}`] = (types[`${x.type}/spot=${x.spot}/swap=${x.swap}`] ?? 0) + 1;
  const btc = markets['BTC/USDT'];
  log('ccxt', {
    loadMs: Math.round(performance.now() - t0),
    markets: list.length,
    types,
    active: [...new Set(list.map((x) => x.active))],
    idEqualsName: list.filter((x) => names.has(x.id)).length,
    idEqualsTickerKey: list.filter((x) => tk.json.result[x.id]).length,
    btc: { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, active: btc.active, linear: btc.linear, contractSize: btc.contractSize, takerIsArray: Array.isArray(btc.taker), takerFirstTiers: Array.isArray(btc.taker) ? btc.taker.slice(0, 2) : btc.taker, makerFirstTiers: Array.isArray(btc.maker) ? btc.maker.slice(0, 2) : btc.maker, tierBased: btc.tierBased, percentage: btc.percentage, precision: btc.precision },
    swapCount: list.filter((x) => x.type === 'swap' && x.swap === true && x.active !== false).length,
  });
  const usdFamily = list.filter((x) => ['USDT', 'USDC', 'USD'].includes(x.quote));
  const perBase = {};
  for (const x of usdFamily) (perBase[x.base] ??= []).push(x.quote);
  log('usd-family', { markets: usdFamily.length, bases: Object.keys(perBase).length, basesListedTwiceOrMore: Object.entries(perBase).filter(([, q]) => q.length > 1).length, sample: Object.entries(perBase).filter(([, q]) => q.length > 2).slice(0, 6) });
}

async function timing() {
  const addrs = await dns.resolve4(HOST);
  const d0 = performance.now();
  await dns.lookup(HOST);
  log('dns', { host: HOST, a: addrs, lookupMs: Math.round(performance.now() - d0) });
  for (const p of ['/markets', '/tickers', '/ticker?market=BTC_USDT', '/depth/result?market=BTC_USDT&limit=100', '/book?market=BTC_USDT&side=buy&limit=100']) {
    const r = await get(BASE + p, { cold: true });
    log('cold', { path: p, status: r.status, bytes: r.bytes, ms: round(r.ms), cfRay: r.headers?.['cf-ray'], xCache: r.headers?.['x-cache'], age: r.headers?.age });
    await sleep(500);
  }
  const polls = [];
  let prev = null;
  let cacheChanges = 0, bidAskChanges = 0, sameBody = 0;
  const cacheAges = [];
  for (let i = 0; i < 30; i++) {
    const r = await get(`${BASE}/tickers`);
    const j = r.json;
    const b = j.result.BTC_USDT.ticker;
    if (prev) {
      if (j.cache_time !== prev.cache_time) cacheChanges++;
      if (b.bid !== prev.bid || b.ask !== prev.ask) bidAskChanges++;
      if (r.text === prev.text) sameBody++;
    }
    cacheAges.push(r.localMs / 1000 - j.cache_time);
    polls.push(r.ms.total);
    prev = { cache_time: j.cache_time, bid: b.bid, ask: b.ask, text: r.text };
    await sleep(Math.max(0, 1000 - r.ms.total));
  }
  log('tickers-polls', { polls: 30, totalMs: stats(polls), cacheTimeChanged: cacheChanges, btcBidAskChanged: bidAskChanges, identicalBody: sameBody, localMinusCacheTimeS: stats(cacheAges.map((x) => x * 1000)), unit: 'ms' });
}

async function depth() {
  for (const [p, label] of [
    ['/depth/result?market=BTC_USDT&limit=1000', 'depth 1000'],
    ['/depth/result?market=BTC_USDT&limit=100', 'depth 100'],
    ['/depth/result?market=BTC_USDT', 'depth default'],
    ['/depth/result?market=BTC_USDT&limit=100&interval=1', 'depth interval 1'],
    ['/book?market=BTC_USDT&side=buy&limit=100', 'book buy'],
    ['/book?market=BTC_USDT&side=sell&limit=100', 'book sell'],
    ['/depth/result?market=CPC_USDT&limit=100', 'quiet depth 100'],
  ]) {
    const r = await get(BASE + p);
    const res = r.json?.result;
    const out = { label, status: r.status, bytes: r.bytes, ms: Math.round(r.ms.total), xCache: r.headers['x-cache'], cacheAgeS: r.json ? +(r.localMs / 1000 - r.json.cache_time).toFixed(3) : null };
    if (res?.bids || res?.asks) Object.assign(out, { levels: `${res.bids?.length}/${res.asks?.length}`, order: `${orderOf(res.bids, 'bids')}/${orderOf(res.asks, 'asks')}`, top: [res.bids?.[0], res.asks?.[0]] });
    if (res?.orders) Object.assign(out, { keys: Object.keys(res), total: res.total, levels: res.orders.length, order: orderOf(res.orders.map((o) => [o.price]), p.includes('buy') ? 'bids' : 'asks'), first: res.orders[0] });
    log('depth-call', out);
    await sleep(500);
  }
  const t = await get(`${BASE}/ticker?market=BTC_USDT`);
  const d = await get(`${BASE}/depth/result?market=BTC_USDT&limit=5`);
  log('ticker-vs-depth', { ticker: { bid: t.json.result.bid, ask: t.json.result.ask, at: t.json.result.at ?? t.json.result.timestamp }, depthTop: [d.json.result.bids[0][0], d.json.result.asks[0][0]], gapMs: d.localMs - t.localMs });

  let prev = null, changes = 0, cacheChanges = 0;
  const ms = [], ages = [];
  for (let i = 0; i < 15; i++) {
    const r = await get(`${BASE}/depth/result?market=BTC_USDT&limit=20`);
    const key = JSON.stringify(r.json.result);
    if (prev && key !== prev.key) changes++;
    if (prev && r.json.cache_time !== prev.cache) cacheChanges++;
    ms.push(r.ms.total);
    ages.push((r.localMs / 1000 - r.json.cache_time) * 1000);
    prev = { key, cache: r.json.cache_time };
    await sleep(Math.max(0, 1000 - r.ms.total));
  }
  log('depth-polls', { polls: 15, totalMs: stats(ms), bookChanged: changes, cacheTimeChanged: cacheChanges, localMinusCacheTimeMs: stats(ages) });
}

async function errors() {
  for (const p of [
    '/ticker?market=NOPE_USDT',
    '/depth/result?market=NOPE_USDT',
    '/depth/result?market=btc_usdt&limit=5',
    '/depth/result?market=BTC_USDT&limit=0',
    '/depth/result?market=BTC_USDT&limit=1001',
    '/depth/result?market=BTC_USDT&interval=0.5',
    '/book?market=BTC_USDT&side=nope',
    '/book?market=BTC_USDT&side=buy&limit=101',
    '/nope',
  ]) {
    const r = await get(BASE + p);
    const rl = Object.fromEntries(Object.entries(r.headers ?? {}).filter(([k]) => /rate|retry|limit/i.test(k)));
    log('error-case', { path: p, status: r.status, body: r.text?.slice(0, 220), rateHeaders: rl });
    await sleep(500);
  }
  const r = await get(`${BASE}/markets`);
  const dateMs = Date.parse(r.headers.date);
  log('clock', { httpDate: r.headers.date, localMs: r.localMs, localMinusHttpDateMs: r.localMs - dateMs, currentTime: r.json.current_time, localMinusCurrentTimeMs: Math.round(r.localMs - r.json.current_time * 1000), note: 'current_time is stamped by a cache layer, see cache_time' });
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, timing, depth, errors };
if (mode === 'all') { for (const f of Object.values(modes)) await f(); } else if (modes[mode]) await modes[mode](); else { console.error(`unknown mode ${mode}`); process.exit(1); }
warmAgent.destroy();
