// CEX.IO Spot Trading public REST probe: host and latency, catalog and CCXT mapping, bulk ticker cadence, book snapshots, errors, and the legacy cex.io/api host.
// Public, unauthenticated, read-only. The docs allow 100 points a minute per IP, and every mode makes at most 10 calls, but get_ticker drew 429 after two calls a minute on 2026-09-23, so no mode calls it more than twice in 60 s.
// Run from server/: node ../scripts/probes/venues/cex/rest-probe.mjs [host|catalog|ticker|book|errors|legacy]
//   host     DNS for the API hosts, one cold and five warm get_server_time calls, and the clock offset. 6 points.
//   catalog  get_pairs_info, get_ticker for every pair, get_currencies_info, and CCXT loadMarkets with market.id, taker, contractSize and active. About 6 points.
//   ticker   get_ticker for every pair 3 times 31 s apart, reply size and time, and how many pairs changed bid, ask or last between calls. About 63 s.
//   book     get_order_book on three pairs, twice back to back, level count and order, and parameters the docs do not name: depth 5, 0 and 1, and limit. 10 points.
//   errors   unknown pair, unknown method, GET instead of POST, text that is not JSON, missing pair. 6 points.
//   legacy   the older cex.io/api host, which still answers: tickers, order book and last price. 3 requests.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/cex/rest.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://trade.cex.io/api/spot/rest-public';
const LEGACY = 'https://cex.io/api';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text.slice(0, 2_000_000));
}

const HEADERS_OF_INTEREST = ['cf-ray', 'cf-cache-status', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'age', 'cache-control', 'content-encoding', 'server'];

async function call(path, body = {}, { method = 'POST', raw } = {}) {
  const t0 = performance.now();
  const res = await fetch(API + path, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const headers = {};
  for (const h of HEADERS_OF_INTEREST) if (res.headers.get(h)) headers[h] = res.headers.get(h);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers };
}

async function host() {
  for (const name of ['trade.cex.io', 'cex.io', 'ws.cex.io']) {
    try {
      log('dns', { name, a: await dns.resolve4(name) });
    } catch (e) {
      log('dns', { name, error: e.code });
    }
  }
  const times = [];
  for (let i = 0; i < 6; i++) {
    const before = Date.now();
    const r = await call('/get_server_time');
    const after = Date.now();
    const server = r.json?.data?.timestamp;
    const mid = (before + after) / 2;
    times.push(r.ms);
    log('server_time', { i, status: r.status, ms: r.ms, server, offsetMs: server ? Math.round(server - mid) : null, headers: r.headers, body: i === 0 ? r.text : undefined });
    await sleep(500);
  }
  log('latency', { cold: times[0], warm: times.slice(1), warmMedian: median(times.slice(1)) });
}

async function catalog() {
  const pairs = await call('/get_pairs_info');
  keep('pairs_info.json', pairs.text);
  const rows = pairs.json.data;
  const byQuote = {};
  for (const p of rows) byQuote[p.quote] = (byQuote[p.quote] ?? 0) + 1;
  const fieldCount = {};
  for (const p of rows) for (const k of Object.keys(p)) fieldCount[k] = (fieldCount[k] ?? 0) + 1;
  log('pairs_info', { status: pairs.status, ms: pairs.ms, bytes: pairs.bytes, rows: rows.length, byQuote, fieldCount, first: rows[0] });

  const ticker = await call('/get_ticker');
  keep('ticker_all.json', ticker.text);
  const t = ticker.json.data;
  const tickerIds = Object.keys(t);
  const noBid = tickerIds.filter((k) => t[k].bestBid === undefined);
  const noAsk = tickerIds.filter((k) => t[k].bestAsk === undefined);
  const crossed = tickerIds.filter((k) => t[k].bestBid !== undefined && t[k].bestAsk !== undefined && Number(t[k].bestBid) >= Number(t[k].bestAsk));
  const zeroVol = tickerIds.filter((k) => Number(t[k].volumeUSD) === 0);
  log('ticker_all', { status: ticker.status, ms: ticker.ms, bytes: ticker.bytes, rows: tickerIds.length, noBid: noBid.length, noAsk: noAsk.length, bothMissing: noBid.filter((k) => noAsk.includes(k)).length, crossed: crossed.length, crossedSample: crossed.slice(0, 5), zeroVolumeUSD: zeroVol.length, noBidSample: noBid.slice(0, 8), noAskSample: noAsk.slice(0, 8) });

  const currencies = await call('/get_currencies_info');
  const cur = currencies.json?.data ?? [];
  log('currencies_info', { status: currencies.status, ms: currencies.ms, bytes: currencies.bytes, rows: Array.isArray(cur) ? cur.length : Object.keys(cur).length, first: Array.isArray(cur) ? cur[0] : undefined });

  const ex = new ccxt.cex();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  log('ccxt_load', { ms: Math.round(performance.now() - t0), markets: list.length, version: ccxt.version });
  const types = {};
  const takers = {};
  const actives = {};
  const contractSizes = {};
  const linears = {};
  for (const m of list) {
    types[m.type] = (types[m.type] ?? 0) + 1;
    takers[`${m.taker}/${m.maker}`] = (takers[`${m.taker}/${m.maker}`] ?? 0) + 1;
    actives[String(m.active)] = (actives[String(m.active)] ?? 0) + 1;
    contractSizes[String(m.contractSize)] = (contractSizes[String(m.contractSize)] ?? 0) + 1;
    linears[String(m.linear)] = (linears[String(m.linear)] ?? 0) + 1;
  }
  const rawIds = new Set(rows.map((p) => `${p.base}-${p.quote}`));
  const idNotRaw = list.filter((m) => !rawIds.has(m.id)).map((m) => ({ id: m.id, baseId: m.baseId, quoteId: m.quoteId, symbol: m.symbol }));
  const idNotTicker = list.filter((m) => !(m.id in t)).map((m) => m.id);
  const renamed = list.filter((m) => m.base !== m.baseId || m.quote !== m.quoteId).map((m) => `${m.baseId}-${m.quoteId} as ${m.symbol}`);
  const ids = list.map((m) => m.id);
  const dupIds = ids.filter((x, i) => ids.indexOf(x) !== i);
  const btc = markets['BTC/USD'];
  log('ccxt_fields', { types, takerMaker: takers, active: actives, contractSize: contractSizes, linear: linears, idNotRaw: idNotRaw.length, idNotRawSample: idNotRaw.slice(0, 10), idNotTicker: idNotTicker.length, renamed, dupIds });
  log('ccxt_btc_usd', { id: btc.id, symbol: btc.symbol, type: btc.type, spot: btc.spot, swap: btc.swap, taker: String(btc.taker), maker: String(btc.maker), contractSize: String(btc.contractSize), linear: String(btc.linear), active: String(btc.active), precision: btc.precision, feeSide: String(btc.feeSide), percentage: String(btc.percentage), tierBased: String(btc.tierBased) });
  log('ccxt_fees_trading', { trading: Object.fromEntries(Object.entries(ex.fees.trading).map(([k, v]) => [k, String(v)])) });

  const family = rows.filter((p) => ['USD', 'USDT', 'USDC'].includes(p.quote));
  const bases = {};
  for (const p of family) (bases[p.base] ??= []).push(p.quote);
  const multi = Object.entries(bases).filter(([, q]) => q.length > 1);
  log('usd_family', { pairs: family.length, bases: Object.keys(bases).length, basesListedMoreThanOnce: multi.length, onAllThree: multi.filter(([, q]) => q.length === 3).length });
}

async function tickerCadence() {
  // On 2026-09-23 get_ticker answered 429 after two calls in each of three 60 s stretches, for 7 named pairs and for all pairs alike, so this mode spaces three calls 31 s apart.
  const WATCH = ['BTC-USD', 'BTC-USDT', 'ETH-USD', 'SOL-USD', 'XRP-USDT', 'ADA-USD', 'MSTRX-USDC'];
  const prev = {};
  const changes = {};
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const r = await call('/get_ticker');
    const d = r.json?.data ?? {};
    let changed = 0;
    for (const [k, v] of Object.entries(d)) {
      const p = prev[k];
      if (p && (p.bestBid !== v.bestBid || p.bestAsk !== v.bestAsk || p.last !== v.last)) changed++;
      if (p && WATCH.includes(k)) {
        const c = (changes[k] ??= { bestBid: 0, bestAsk: 0, last: 0, volume: 0 });
        for (const f of Object.keys(c)) if (p[f] !== v[f]) c[f]++;
      }
      prev[k] = v;
    }
    rows.push({ i, at: new Date().toISOString(), status: r.status, ms: r.ms, bytes: r.bytes, pairs: Object.keys(d).length, pairsChangedSincePrevious: i ? changed : null, body: r.status === 200 ? undefined : r.text.slice(0, 200), headers: r.status === 200 ? undefined : r.headers });
    if (i < 2) await sleep(31_000);
  }
  for (const row of rows) log('ticker_poll', row);
  log('ticker_summary', { changes });
}

async function book() {
  const pairs = ['BTC-USD', 'ETH-USDT', 'ADA-USD'];
  for (const pair of pairs) {
    const a = await call('/get_order_book', { pair });
    const b = await call('/get_order_book', { pair });
    keep(`book_${pair}.json`, a.text);
    const d = a.json?.data ?? {};
    const bids = d.bids ?? [];
    const asks = d.asks ?? [];
    const desc = bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]));
    const asc = asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]));
    log('rest_book', {
      pair,
      status: a.status,
      ms: [a.ms, b.ms],
      bytes: a.bytes,
      keys: Object.keys(d),
      timestamp: d.timestamp,
      ageMs: d.timestamp ? Date.now() - d.timestamp : null,
      bids: bids.length,
      asks: asks.length,
      bidsDescending: desc,
      asksAscending: asc,
      top: { bid: bids[0], ask: asks[0] },
      types: [typeof bids[0]?.[0], typeof bids[0]?.[1]],
      secondSameTimestamp: b.json?.data?.timestamp === d.timestamp,
      secondSameBody: b.text === a.text,
      headers: a.headers,
    });
    await sleep(800);
  }
  const depth = await call('/get_order_book', { pair: 'BTC-USD', depth: 5 });
  log('rest_book_depth_param', { status: depth.status, bids: depth.json?.data?.bids?.length, asks: depth.json?.data?.asks?.length, body: depth.text.slice(0, 200) });
  for (const d of [0, 1]) {
    const r = await call('/get_order_book', { pair: 'BTC-USD', depth: d });
    log('rest_book_depth_value', { depth: d, status: r.status, bids: r.json?.data?.bids?.length, asks: r.json?.data?.asks?.length });
  }
  const limit = await call('/get_order_book', { pair: 'BTC-USD', limit: 5 });
  log('rest_book_limit_param', { status: limit.status, bids: limit.json?.data?.bids?.length, asks: limit.json?.data?.asks?.length });
}

async function errors() {
  const cases = [
    ['unknown_pair', '/get_order_book', { body: { pair: 'NOPE-USD' } }],
    ['lowercase_pair', '/get_order_book', { body: { pair: 'btc-usd' } }],
    ['missing_pair', '/get_order_book', { body: {} }],
    ['unknown_method', '/get_nope', { body: {} }],
    ['get_verb', '/get_server_time', { method: 'GET' }],
    ['not_json', '/get_server_time', { raw: 'not json' }],
  ];
  for (const [name, path, opts] of cases) {
    const r = await call(path, opts.body ?? {}, opts);
    log('error_case', { name, status: r.status, ms: r.ms, headers: r.headers, body: r.text.slice(0, 300) });
    await sleep(700);
  }
}

async function legacy() {
  for (const path of ['/tickers/USD/USDT', '/order_book/BTC/USD/?depth=20', '/last_price/BTC/USD']) {
    const t0 = performance.now();
    const res = await fetch(LEGACY + path);
    const text = await res.text();
    let summary;
    try {
      const j = JSON.parse(text);
      summary = Array.isArray(j.data) ? { rows: j.data.length, first: j.data[0], ok: j.ok } : { keys: Object.keys(j), bids: j.bids?.length, asks: j.asks?.length, id: j.id, timestamp: j.timestamp, bid0: j.bids?.[0], ask0: j.asks?.[0], lprice: j.lprice };
    } catch {
      summary = { text: text.slice(0, 200) };
    }
    log('legacy', { path, status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, cfRay: res.headers.get('cf-ray'), ...summary });
    await sleep(700);
  }
}

const mode = process.argv[2] ?? 'host';
const modes = { host, catalog, ticker: tickerCadence, book, errors, legacy };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
