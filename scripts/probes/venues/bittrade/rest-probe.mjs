// BitTrade public REST probe: host and latency, the spot catalog against CCXT, the depth snapshot, the bulk ticker at one poll a second, errors and server time.
// Public, unauthenticated, read-only. Stays at one request a second in the poll, far inside the documented 10 requests per second per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bittrade/rest-probe.mjs [catalog|book|poll|time|all]
//   catalog  DNS, cold and warm request time, /v1/common/symbols by state, CCXT 4.5.68 loadMarkets and its fee and id mapping, tickers, merged detail, dealer maintenance time, last trade.
//   book     /market/depth step0 on four symbols: levels, order, version, caching, and the error replies.
//   poll     /market/tickers once a second for 60 s: reply time, size, how often ts and each pair's bid and ask change.
//   time     /v1/common/timestamp five times, clock offset against the request midpoint.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bittrade/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'api-cloud.bittrade.co.jp';
const API = `https://${HOST}`;
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
  const res = await fetch(API + path, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

function pickHeaders(h) {
  const out = {};
  for (const [k, v] of h) {
    if (/rate|limit|retry|cache|age|cf-|server|date|x-/i.test(k)) out[k] = v;
  }
  return out;
}

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });

  const cold = await get('/v1/common/timestamp');
  const warm = [];
  for (let i = 0; i < 5; i++) {
    warm.push((await get('/v1/common/timestamp')).ms);
    await sleep(300);
  }
  log('latency_timestamp', { cold: cold.ms, warm, headers: pickHeaders(cold.headers) });

  const sym = await get('/v1/common/symbols');
  keep('symbols.json', sym.text);
  const rows = sym.json.data;
  const byState = {};
  for (const r of rows) {
    const k = `${r.state}|${r['quote-currency']}|api-trading=${r['api-trading']}`;
    byState[k] = (byState[k] ?? 0) + 1;
  }
  log('symbols', { status: sym.status, ms: sym.ms, bytes: sym.bytes, count: rows.length, byState });
  const online = rows.filter((r) => r.state === 'online');
  log('symbols_online', {
    count: online.length,
    apiEnabled: online.filter((r) => r['api-trading'] === 'enabled').map((r) => r.symbol),
    apiDisabledCount: online.filter((r) => r['api-trading'] !== 'enabled').length,
    leverageFields: rows.filter((r) => 'leverage-ratio' in r || 'super-margin-leverage-ratio' in r).length,
  });

  const ex = new ccxt.bittrade();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const types = {};
  for (const m of list) types[`${m.type}|active=${m.active}`] = (types[`${m.type}|active=${m.active}`] ?? 0) + 1;
  const takers = {};
  for (const m of list) takers[`taker=${m.taker} maker=${m.maker}`] = (takers[`taker=${m.taker} maker=${m.maker}`] ?? 0) + 1;
  const btc = markets['BTC/JPY'];
  log('ccxt_markets', {
    ms: Math.round(performance.now() - t0),
    count: list.length,
    types,
    takers,
    swaps: list.filter((m) => m.swap).length,
    btc: btc && { id: btc.id, symbol: btc.symbol, type: btc.type, linear: btc.linear, contractSize: btc.contractSize, active: btc.active, taker: btc.taker, maker: btc.maker, margin: btc.margin, precision: btc.precision },
    idEqualsSymbolField: list.every((m) => m.id === m.info.symbol),
    symbolsTwice: Object.entries(list.reduce((a, m) => ((a[m.base] = (a[m.base] ?? 0) + (m.active ? 1 : 0)), a), {})).filter(([, n]) => n > 1).map(([b]) => b),
  });
  log('ccxt_fees_default', { trading: ex.fees.trading });

  const tick = await get('/market/tickers');
  log('tickers', { status: tick.status, ms: tick.ms, bytes: tick.bytes, count: tick.json.data.length, keys: Object.keys(tick.json.data[0]), ts: tick.json.ts });

  const merged = await get('/market/detail/merged?symbol=btcjpy');
  log('detail_merged', { status: merged.status, ms: merged.ms, bytes: merged.bytes, body: merged.text.slice(0, 400) });

  const retail = await get('/v1/retail/maintain/time');
  log('retail_maintain_time', { status: retail.status, ms: retail.ms, bytes: retail.bytes, body: retail.text.slice(0, 300) });

  const trade = await get('/market/trade?symbol=btcjpy');
  log('last_trade_btcjpy', { status: trade.status, ageMs: Date.now() - trade.json.tick.ts, body: trade.text.slice(0, 300) });

  const ms = await get('/v2/market-status');
  log('market_status', { status: ms.status, ms: ms.ms, body: ms.text.slice(0, 400) });
}

function orderCheck(side, dir) {
  for (let i = 1; i < side.length; i++) {
    if (dir === 'desc' ? side[i][0] >= side[i - 1][0] : side[i][0] <= side[i - 1][0]) return false;
  }
  return true;
}

async function book() {
  for (const s of ['btcjpy', 'ethjpy', 'batjpy', 'soljpy']) {
    const r = await get(`/market/depth?symbol=${s}&type=step0`);
    const t = r.json.tick ?? {};
    log('depth_step0', {
      symbol: s,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      ch: r.json.ch,
      bids: t.bids?.length,
      asks: t.asks?.length,
      bidsDesc: t.bids && orderCheck(t.bids, 'desc'),
      asksAsc: t.asks && orderCheck(t.asks, 'asc'),
      version: t.version,
      tickTs: t.ts,
      envTs: r.json.ts,
      tickAgeMs: r.json.ts - t.ts,
      top: [t.bids?.[0], t.asks?.[0]],
      numbersAreJsonNumbers: typeof t.bids?.[0]?.[0] === 'number',
    });
    await sleep(250);
  }

  // Two reads 150 ms apart show whether a reply is cached.
  const a = await get('/market/depth?symbol=btcjpy&type=step0');
  await sleep(150);
  const b = await get('/market/depth?symbol=btcjpy&type=step0');
  log('depth_cache', { versionA: a.json.tick.version, versionB: b.json.tick.version, tsA: a.json.tick.ts, tsB: b.json.tick.ts, headersA: pickHeaders(a.headers) });

  for (const q of ['symbol=btcjpy&type=step0&depth=5', 'symbol=btcjpy&type=step0&depth=20', 'symbol=btcjpy&type=step1', 'symbol=btcjpy&type=step9', 'symbol=nopejpy&type=step0', 'symbol=btcjpy', 'symbol=adaeth&type=step0']) {
    const r = await get(`/market/depth?${q}`);
    log('depth_variant', { q, status: r.status, ms: r.ms, bids: r.json?.tick?.bids?.length, asks: r.json?.tick?.asks?.length, body: r.json?.tick ? undefined : r.text.slice(0, 300) });
    await sleep(250);
  }

  const nope = await get('/market/tickers/nope');
  log('unknown_path', { status: nope.status, body: nope.text.slice(0, 200) });
}

async function poll() {
  const times = [];
  const sizes = [];
  let lastTs;
  let tsChanges = 0;
  const last = new Map();
  const changes = new Map();
  const n = 60;
  for (let i = 0; i < n; i++) {
    const start = Date.now();
    const r = await get('/market/tickers');
    times.push(r.ms);
    sizes.push(r.bytes);
    if (r.status !== 200) log('poll_status', { i, status: r.status, body: r.text.slice(0, 200), headers: pickHeaders(r.headers) });
    if (r.json?.ts !== lastTs) tsChanges++;
    lastTs = r.json?.ts;
    for (const row of r.json?.data ?? []) {
      const k = `${row.bid}|${row.ask}`;
      if (last.has(row.symbol) && last.get(row.symbol) !== k) changes.set(row.symbol, (changes.get(row.symbol) ?? 0) + 1);
      last.set(row.symbol, k);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  times.sort((x, y) => x - y);
  const pct = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  const ch = [...last.keys()].map((s) => changes.get(s) ?? 0).sort((x, y) => x - y);
  log('poll_tickers', {
    polls: n,
    min: times[0],
    median: pct(0.5),
    p90: pct(0.9),
    max: times[times.length - 1],
    over1s: times.filter((t) => t > 1000).length,
    bytesMedian: sizes.sort((x, y) => x - y)[Math.floor(sizes.length / 2)],
    envTsChanges: tsChanges,
    pairs: last.size,
    bidAskChangesPerPair: { min: ch[0], median: ch[Math.floor(ch.length / 2)], max: ch[ch.length - 1] },
    btcjpyChanges: changes.get('btcjpy') ?? 0,
  });
}

async function time() {
  const offs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/v1/common/timestamp');
    const t1 = Date.now();
    offs.push({ rtt: t1 - t0, offset: r.json.data - Math.round((t0 + t1) / 2) });
    await sleep(500);
  }
  log('server_time', { offs });
}

const mode = process.argv[2] ?? 'all';
const run = { catalog, book, poll, time };
for (const m of mode === 'all' ? Object.keys(run) : [mode]) {
  log('mode', { mode: m, at: new Date().toISOString() });
  await run[m]();
}
