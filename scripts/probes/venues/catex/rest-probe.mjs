// Catex public REST probe: DNS and request timing, the spot catalog, the bulk ticker, the book calls, caching, error replies, and the clock.
// Public, unauthenticated, read-only. Most requests are spaced 500 to 700 ms apart and never more than three fall in one second, since Catex publishes no rate limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/catex/rest-probe.mjs [catalog|timing|depth|errors|clock|all]
//   catalog  every documented catalog and ticker call, pair counts by quote, key spelling across calls, and whether CCXT has a class. About 6 s.
//   timing   DNS, one cold request per call, then 65 rounds of cmc/summary and cmc/ticker at 1 s each, recording when each reply changed. About 75 s.
//   depth    api/order, cmc/orderbook and the web page's list call on BTC/USDT and a quiet pair, limits, level order, aggregation, and 15 polls at 1 s. About 30 s.
//   errors   unknown pair, other spellings, bad limits, unknown route. About 8 s.
//   clock    Date header and the cmc/orderbook millisecond timestamp against the local clock over 5 requests each, and the newest trade time. About 8 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/catex/rest.md.
import { createRequire } from 'node:module';
import https from 'node:https';
import dns from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'www.catex.io';
const BASE = `https://${HOST}`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text.slice(0, 2_000_000));
}

function get(path, { cold = false } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let tFirst = 0;
    const req = https.get(
      `${BASE}${path}`,
      { agent: cold ? new https.Agent({ keepAlive: false }) : warmAgent, headers: { 'user-agent': 'observatory-probe/1.0', accept: 'application/json' } },
      (res) => {
        const chunks = [];
        res.once('data', () => (tFirst = performance.now()));
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(body);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, body, json, ms: performance.now() - t0, ttfb: (tFirst || performance.now()) - t0, bytes: body.length });
        });
      },
    );
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: performance.now() - t0, bytes: 0, headers: {}, body: '' }));
  });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: +s[0].toFixed(1), median: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

function levelOrder(levels, side) {
  const p = levels.map((l) => Number(Array.isArray(l) ? l[0] : l.price));
  let ordered = true;
  for (let i = 1; i < p.length; i++) if (side === 'bid' ? p[i] > p[i - 1] : p[i] < p[i - 1]) ordered = false;
  const dupes = p.length - new Set(p).size;
  return { n: p.length, first: p[0], last: p[p.length - 1], bestFirst: ordered, dupes };
}

async function catalog() {
  log('ccxt', { version: ccxt.version, hasCatex: ccxt.exchanges.includes('catex'), matches: ccxt.exchanges.filter((e) => /cat/i.test(e)) });
  const calls = ['/api/token/baseCurrency', '/api/token/list', '/api/cmc/summary', '/api/cmc/ticker', '/api/cmc/assets', '/api/token?pair=BTC/USDT', '/api/volume', '/api/token/supply'];
  const r = {};
  for (const c of calls) {
    r[c] = await get(c);
    keep(`catalog${c.replace(/[^a-z0-9]+/gi, '_')}.json`, r[c].body);
    log('call', { path: c, status: r[c].status, bytes: r[c].bytes, ms: Math.round(r[c].ms), contentType: r[c].headers['content-type'], cache: r[c].headers['cf-cache-status'], head: r[c].body.slice(0, 160) });
    await sleep(600);
  }
  const summary = r['/api/cmc/summary'].json ?? [];
  const ticker = r['/api/cmc/ticker'].json ?? {};
  const list = r['/api/token/list'].json?.data ?? [];
  const byQuote = {};
  for (const s of summary) byQuote[s.quote_currency] = (byQuote[s.quote_currency] ?? 0) + 1;
  const zeroVol = summary.filter((s) => !(Number(s.quote_volume) > 0));
  const noBook = summary.filter((s) => !(Number(s.highest_bid) > 0) || !(Number(s.lowest_ask) > 0));
  const crossed = summary.filter((s) => Number(s.highest_bid) > 0 && Number(s.lowest_ask) > 0 && Number(s.highest_bid) >= Number(s.lowest_ask));
  const summaryIds = new Set(summary.map((s) => s.trading_pairs));
  const tickerIds = new Set(Object.keys(ticker));
  const listIds = new Set(list.map((x) => x.pair.replace('/', '_')));
  const same = (a, b) => [...a].every((x) => b.has(x)) && a.size === b.size;
  const frozen = {};
  for (const v of Object.values(ticker)) frozen[v.isFrozen] = (frozen[v.isFrozen] ?? 0) + 1;
  log('catalog', {
    summaryRows: summary.length,
    byQuote,
    zeroVolume: zeroVol.length,
    oneOrNoSide: noBook.length,
    crossed: crossed.map((s) => `${s.trading_pairs} ${s.highest_bid}/${s.lowest_ask}`),
    tickerRows: tickerIds.size,
    listRows: listIds.size,
    summaryEqTicker: same(summaryIds, tickerIds),
    summaryEqList: same(summaryIds, listIds),
    isFrozen: frozen,
    feeTypes: [...new Set(list.map((x) => x.feeType))],
    listKeys: list[0] ? Object.keys(list[0]) : [],
    summaryKeys: summary[0] ? Object.keys(summary[0]) : [],
  });
  const usdt = summary.filter((s) => s.quote_currency === 'USDT');
  const spreads = usdt
    .filter((s) => Number(s.highest_bid) > 0 && Number(s.lowest_ask) > 0)
    .map((s) => ({ id: s.trading_pairs, ppm: Math.round(((s.lowest_ask - s.highest_bid) / ((+s.lowest_ask + +s.highest_bid) / 2)) * 1e6), qv: Math.round(s.quote_volume) }))
    .sort((a, b) => b.qv - a.qv);
  log('usdtSpreads', { n: spreads.length, top: spreads.slice(0, 20).map((s) => `${s.id} ${s.ppm}ppm qv=${s.qv}`), under2000ppm: spreads.filter((s) => s.ppm < 2000).length });
}

async function timing() {
  const t0 = performance.now();
  const addrs = await dns.lookup(HOST, { all: true });
  log('dns', { ms: Math.round(performance.now() - t0), addrs: addrs.map((a) => a.address) });
  for (const c of ['/api/cmc/summary', '/api/cmc/ticker', '/api/token/list', '/api/order?market=BTC/USDT&limit=20']) {
    const r = await get(c, { cold: true });
    log('cold', { path: c, status: r.status, bytes: r.bytes, ms: Math.round(r.ms), ttfb: Math.round(r.ttfb), cfRay: r.headers['cf-ray'] });
    await sleep(600);
  }
  // Summary and ticker polled alternately, 65 rounds at 1 s, recording the second at which each body changed.
  const times = { summary: [], ticker: [] };
  const changedAt = { summary: [], ticker: [] };
  const last = {};
  let btcChanges = 0;
  let prevBtc;
  const t0loop = performance.now();
  for (let i = 0; i < 65; i++) {
    const r = await get('/api/cmc/summary');
    times.summary.push(r.ms);
    const btc = (r.json ?? []).find((s) => s.trading_pairs === 'BTC_USDT');
    const key = btc ? `${btc.highest_bid}/${btc.lowest_ask}/${btc.last_price}` : '';
    if (prevBtc !== undefined && key !== prevBtc) btcChanges++;
    prevBtc = key;
    if (last.summary !== undefined && r.body !== last.summary) changedAt.summary.push(Math.round((performance.now() - t0loop) / 1000));
    last.summary = r.body;
    if (r.status !== 200) log('warnStatus', { i, status: r.status, body: r.body.slice(0, 200) });
    await sleep(500);
    const t = await get('/api/cmc/ticker');
    times.ticker.push(t.ms);
    if (last.ticker !== undefined && t.body !== last.ticker) changedAt.ticker.push(Math.round((performance.now() - t0loop) / 1000));
    last.ticker = t.body;
    await sleep(Math.max(0, 500 - t.ms));
  }
  log('warmSummary', { ...stats(times.summary), bodyChangedAtS: changedAt.summary, btcTopChanges: btcChanges });
  log('warmTicker', { ...stats(times.ticker), bodyChangedAtS: changedAt.ticker });
}

async function depth() {
  for (const lim of [5, 20, 100, 101, 500]) {
    const r = await get(`/api/order?market=BTC/USDT&limit=${lim}`);
    const d = r.json?.data;
    log('apiOrderLimit', { limit: lim, status: r.status, bytes: r.bytes, ms: Math.round(r.ms), bids: d ? levelOrder(d.bids, 'bid') : null, asks: d ? levelOrder(d.asks, 'ask') : null, timestamp: d?.timestamp, head: d ? undefined : r.body.slice(0, 200) });
    await sleep(600);
  }
  const noLimit = await get('/api/order?market=BTC/USDT');
  log('apiOrderDefault', { bids: noLimit.json?.data?.bids?.length, asks: noLimit.json?.data?.asks?.length, sample: JSON.stringify(noLimit.json?.data?.bids?.slice(0, 2)) });
  await sleep(600);
  const all = await get('/api/order');
  log('apiOrderNoMarket', { status: all.status, bytes: all.bytes, body: all.body.slice(0, 200) });
  await sleep(600);
  for (const q of ['market_pair=BTC_USDT', 'market_pair=BTC_USDT&depth=20', 'market_pair=BTC_USDT&depth=100', 'market_pair=BTC_USDT&level=1', 'market_pair=BTC_USDT&depth=0']) {
    const r = await get(`/api/cmc/orderbook/market_pair?${q}`);
    const d = r.json;
    log('cmcOrderbook', { q, status: r.status, bytes: r.bytes, keys: d ? Object.keys(d) : null, bids: d?.bids ? levelOrder(d.bids, 'bid') : null, asks: d?.asks ? levelOrder(d.asks, 'ask') : null, timestamp: d?.timestamp });
    await sleep(600);
  }
  for (const side of ['buy', 'sell']) {
    const r = await get(`/order/BTC/USDT/${side}/list`);
    const d = r.json?.data ?? [];
    log('webList', { side, status: r.status, bytes: r.bytes, levels: levelOrder(d, side === 'buy' ? 'bid' : 'ask'), keys: d[0] ? Object.keys(d[0]) : [], first: JSON.stringify(d[0]) });
    await sleep(600);
  }
  // Same instant compare: api/order top 20 against cmc orderbook top 20, read back to back.
  const a = await get('/api/order?market=BTC/USDT&limit=20');
  const b = await get('/api/cmc/orderbook/market_pair?market_pair=BTC_USDT&depth=40');
  const eq = (x, y) => x && y && x.length && x.every((l, i) => y[i] && Number(l[0]) === Number(y[i][0]) && Number(l[1]) === Number(y[i][1]));
  log('compare', { gapMs: Math.round(b.ms), bidsEqual: eq(a.json?.data?.bids, b.json?.bids?.slice(0, 20)), asksEqual: eq(a.json?.data?.asks, b.json?.asks?.slice(0, 20)), apiTop: [a.json?.data?.bids?.[0], a.json?.data?.asks?.[0]], cmcTop: [b.json?.bids?.[0], b.json?.asks?.[0]] });
  await sleep(600);
  for (const m of ['QTUM/USDT', 'COSA/BTC', 'MPRA/USDT']) {
    const r = await get(`/api/order?market=${m}&limit=100`);
    const d = r.json?.data;
    log('quietBook', { market: m, status: r.status, bids: d ? levelOrder(d.bids, 'bid') : null, asks: d ? levelOrder(d.asks, 'ask') : null, timestamp: d?.timestamp, bestBid: d?.bids?.[0], bestAsk: d?.asks?.[0] });
    await sleep(600);
  }
  const bodies = new Set();
  const tops = new Set();
  const times = [];
  const stamps = new Set();
  for (let i = 0; i < 15; i++) {
    const r = await get('/api/order?market=BTC/USDT&limit=20');
    times.push(r.ms);
    const d = r.json?.data;
    bodies.add(JSON.stringify([d?.bids, d?.asks]));
    tops.add(JSON.stringify([d?.bids?.[0], d?.asks?.[0]]));
    stamps.add(d?.timestamp);
    await sleep(Math.max(0, 1000 - r.ms));
  }
  log('bookPolls', { ...stats(times), distinctBooks: bodies.size, distinctTops: tops.size, distinctTimestamps: stamps.size, cache: 'see cf-cache-status in catalog' });
}

async function errors() {
  const cases = [
    '/api/order?market=NOPE/USDT',
    '/api/order?market=btc/usdt',
    '/api/order?market=BTC_USDT',
    '/api/order?market=BTC/USDT&limit=0',
    '/api/order?market=BTC/USDT&limit=-1',
    '/api/order?market=BTC/USDT&limit=abc',
    '/api/cmc/orderbook/market_pair?market_pair=NOPE_USDT',
    '/api/cmc/orderbook/market_pair',
    '/api/token?pair=NOPE/USDT',
    '/api/trading/history?market=NOPE/USDT',
    '/api/nope',
  ];
  for (const c of cases) {
    const r = await get(c);
    const d = r.json?.data;
    const levels = d?.bids ? { bids: d.bids.length, asks: d.asks.length } : undefined;
    log('error', { path: c, status: r.status, contentType: r.headers['content-type'], retryAfter: r.headers['retry-after'] ?? null, ...(levels ? { levels } : { body: r.body.replace(/\s+/g, ' ').slice(0, 180) }) });
    await sleep(600);
  }
}

async function clock() {
  const offs = [];
  for (let i = 0; i < 5; i++) {
    const before = Date.now();
    const r = await get('/api/trading/history?market=BTC/USDT&limit=1');
    const after = Date.now();
    const server = Date.parse(r.headers.date);
    offs.push(server - (before + after) / 2);
    if (i === 4) {
      const t = r.json?.data?.[0]?.time;
      log('newestTrade', { time: t, asUtcMs: t ? Date.parse(t.replace(' ', 'T') + 'Z') : null, localMs: after, ageS: t ? Math.round((after - Date.parse(t.replace(' ', 'T') + 'Z')) / 1000) : null });
    }
    await sleep(700);
  }
  log('clock', { dateHeaderOffsetMs: offs.map((o) => Math.round(o)), note: 'Date header has 1 s resolution, so offsets within -1000..0 mean agreement' });
  // cmc/orderbook carries a millisecond timestamp, which bounds the offset more tightly than the Date header.
  const ms = [];
  for (let i = 0; i < 5; i++) {
    const before = Date.now();
    const r = await get('/api/cmc/orderbook/market_pair?market_pair=BTC_USDT&level=1');
    const after = Date.now();
    ms.push({ offset: Math.round(r.json.timestamp - (before + after) / 2), rtt: after - before });
    await sleep(700);
  }
  log('clockMs', { offsets: ms.map((m) => m.offset), rtts: ms.map((m) => m.rtt) });
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, timing, depth, errors, clock };
log('start', { mode, at: new Date().toISOString() });
for (const [name, fn] of Object.entries(modes)) if (mode === 'all' || mode === name) await fn();
warmAgent.destroy();
log('done', { at: new Date().toISOString() });
