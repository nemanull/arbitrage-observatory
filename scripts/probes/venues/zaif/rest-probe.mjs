// Zaif REST probe: spot catalog and CCXT mapping, per pair tickers, host latency, depth snapshot and caching, errors, clock offset, and the retired futures API.
// Public, unauthenticated, read-only. At most about 4 requests per second, well inside the documented 10 calls per second of the public API.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/zaif/rest-probe.mjs [catalog|tickers|latency|depth|errors|futures|all]
//   catalog  GET /api/1/currency_pairs/all and /currencies/all, CCXT 4.5.68 loadMarkets with market.taker and contractSize, then ten more catalog reads to count rows. About 15 s.
//   tickers  GET /api/1/ticker/{pair} for every pair at 4 per second: 24 h volume in quote units, spread, empty books. About 20 s.
//   latency  DNS, one cold and twenty warm requests to /ticker/btc_jpy, response headers, clock offset from the Date header. About 15 s.
//   depth    GET /api/1/depth/{pair} on three pairs: level count, order, crossing, number types, then 30 reads at 1 s for caching. About 35 s.
//   errors   unknown pair, unknown path, missing pair, uppercase pair: status and body. About 3 s.
//   futures  GET /fapi/1/groups/all and the ticker, depth, trades and swap history of each group, to date the retired AirFX product. About 5 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/zaif/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.zaif.jp/api/1';
const FAPI = 'https://api.zaif.jp/fapi/1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const iso = (sec) => new Date(sec * 1000).toISOString();

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), text, json, ms, bytes: text.length, localMs: Date.now() };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

async function catalog() {
  const pairs = await get(`${API}/currency_pairs/all`);
  const currencies = await get(`${API}/currencies/all`);
  keep('currency_pairs_all.json', pairs.text);
  log('currency_pairs_all', { status: pairs.status, bytes: pairs.bytes, ms: pairs.ms, rows: pairs.json.length });
  log('currencies_all', { status: currencies.status, bytes: currencies.bytes, rows: currencies.json.length, tokens: currencies.json.filter((c) => c.is_token).length });
  const byQuote = {};
  for (const p of pairs.json) byQuote[p.currency_pair.split('_').pop()] = (byQuote[p.currency_pair.split('_').pop()] ?? 0) + 1;
  log('pairs_by_quote_id', byQuote);
  log('is_token_false', { pairs: pairs.json.filter((p) => !p.is_token).map((p) => p.currency_pair) });
  log('event_pairs', { pairs: pairs.json.filter((p) => p.event_number !== 0).map((p) => `${p.currency_pair}=${p.name}`) });
  log('pair_fields', { keys: Object.keys(pairs.json[0]).sort() });

  const ex = new ccxt.zaif();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  log('ccxt_loadMarkets', { version: ccxt.version, ms: Math.round(performance.now() - t0), markets: list.length, spot: list.filter((m) => m.spot).length, swap: list.filter((m) => m.swap).length, future: list.filter((m) => m.future).length });
  const btc = markets['BTC/JPY'];
  log('ccxt_btc_jpy', { id: btc.id, symbol: btc.symbol, type: btc.type, taker: btc.taker, maker: btc.maker, percentage: btc.percentage, tierBased: btc.tierBased, contractSize: btc.contractSize, linear: btc.linear, active: btc.active, precision: btc.precision, limits: { amount: btc.limits.amount, price: btc.limits.price } });
  log('ccxt_taker_values', { distinct: [...new Set(list.map((m) => m.taker))], makers: [...new Set(list.map((m) => m.maker))] });
  log('ccxt_active_values', { distinct: [...new Set(list.map((m) => String(m.active)))] });
  const idMismatch = list.filter((m) => m.id !== m.info.currency_pair).map((m) => m.id);
  log('ccxt_id_vs_currency_pair', { mismatches: idMismatch.length });
  const bySymbol = {};
  for (const m of list) (bySymbol[`${m.base}/${m.quote}`] ??= []).push(m.id);
  log('ccxt_symbols_odd', { symbols: list.filter((m) => /[^A-Z0-9/]/.test(m.symbol)).map((m) => `${m.id}=${m.symbol}`) });
  log('ccxt_pairs_listed_twice', { dup: Object.entries(bySymbol).filter(([, ids]) => ids.length > 1) });
  log('ccxt_quote_counts', list.reduce((a, m) => ((a[m.quote] = (a[m.quote] ?? 0) + 1), a), {}));

  // The reply has been seen to drop the six suspended pairs on some reads, so read it again and count.
  const counts = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const r = await get(`${API}/currency_pairs/all`);
    counts.push(r.json.length);
  }
  const missing = new Set();
  const again = await get(`${API}/currency_pairs/all`);
  const ids = new Set(again.json.map((p) => p.currency_pair));
  for (const p of pairs.json) if (!ids.has(p.currency_pair)) missing.add(p.currency_pair);
  log('catalog_repeat_rows', { reads: counts, lastReadMissing: [...missing] });
}

async function tickers() {
  const pairs = (await get(`${API}/currency_pairs/all`)).json;
  const rows = [];
  for (const p of pairs) {
    const r = await get(`${API}/ticker/${p.currency_pair}`);
    const t = r.json ?? {};
    const spreadPpm = t.bid > 0 && t.ask > 0 ? Math.round(((t.ask - t.bid) / ((t.ask + t.bid) / 2)) * 1e6) : null;
    rows.push({ pair: p.currency_pair, status: r.status, volume: t.volume, quoteVolume: t.volume != null && t.vwap != null ? Math.round(t.volume * t.vwap * 100) / 100 : null, bid: t.bid, ask: t.ask, spreadPpm, err: t.error });
    await sleep(250);
  }
  keep('tickers.json', JSON.stringify(rows));
  const jpy = rows.filter((r) => r.pair.endsWith('_jpy')).sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
  for (const r of jpy) log('ticker_jpy', r);
  const btc = rows.filter((r) => r.pair.endsWith('_btc')).sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
  log('ticker_btc_quote', { n: btc.length, top: btc.slice(0, 5).map((r) => `${r.pair}:${r.quoteVolume}BTC:${r.spreadPpm}ppm`), zeroVolume: btc.filter((r) => !r.volume).length });
  const other = rows.filter((r) => !r.pair.endsWith('_jpy') && !r.pair.endsWith('_btc'));
  log('ticker_other_quote', { rows: other.map((r) => `${r.pair}:${r.status}:${r.quoteVolume}:${r.spreadPpm}`) });
  log('ticker_summary', { pairs: rows.length, non200: rows.filter((r) => r.status !== 200).length, noBid: rows.filter((r) => !r.bid).length, noAsk: rows.filter((r) => !r.ask).length, jpyVolumeTotal: Math.round(jpy.reduce((a, r) => a + (r.quoteVolume ?? 0), 0)) });
}

async function latency() {
  const host = 'api.zaif.jp';
  const t0 = performance.now();
  const addrs = await lookup(host, { all: true });
  log('dns', { host, ms: Math.round(performance.now() - t0), addrs: addrs.map((a) => a.address) });
  const cold = await get(`${API}/ticker/btc_jpy`);
  log('cold', { ms: cold.ms, status: cold.status, headers: cold.headers });
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 20; i++) {
    const before = Date.now();
    const r = await get(`${API}/ticker/btc_jpy`);
    warm.push(r.ms);
    const serverMs = Date.parse(r.headers.date);
    offsets.push(serverMs - Math.round((before + r.localMs) / 2)); // Date has 1 s resolution, so this bounds the offset to about a second
    await sleep(500);
  }
  log('warm_ticker', stats(warm));
  log('date_header_offset_ms', stats(offsets));
}

function checkOrder(levels, desc) {
  let bad = 0;
  for (let i = 1; i < levels.length; i++) if (desc ? levels[i][0] >= levels[i - 1][0] : levels[i][0] <= levels[i - 1][0]) bad++;
  return bad;
}

async function depth() {
  for (const pair of ['btc_jpy', 'mona_jpy', 'xem_btc', 'eth_jpy']) {
    const r = await get(`${API}/depth/${pair}`);
    const d = r.json;
    keep(`depth_${pair}.json`, r.text);
    log('depth', {
      pair, status: r.status, ms: r.ms, bytes: r.bytes, bids: d.bids.length, asks: d.asks.length,
      bidsDescViolations: checkOrder(d.bids, true), asksAscViolations: checkOrder(d.asks, false),
      crossed: d.bids.length && d.asks.length ? d.bids[0][0] >= d.asks[0][0] : null,
      top: { bid: d.bids[0], ask: d.asks[0] }, numberTypes: [typeof d.bids[0]?.[0], typeof d.bids[0]?.[1]], keys: Object.keys(d),
      cacheHeaders: { 'cache-control': r.headers['cache-control'], age: r.headers.age, etag: r.headers.etag, 'x-cache': r.headers['x-cache'], via: r.headers.via },
    });
    await sleep(300);
  }
  const bodies = [];
  const times = [];
  for (let i = 0; i < 30; i++) {
    const r = await get(`${API}/depth/btc_jpy`);
    bodies.push(r.text);
    times.push(r.ms);
    await sleep(1000 - Math.min(r.ms, 900));
  }
  let changed = 0;
  for (let i = 1; i < bodies.length; i++) if (bodies[i] !== bodies[i - 1]) changed++;
  log('depth_repeat_btc_jpy', { reads: bodies.length, changedFromPrevious: changed, distinct: new Set(bodies).size, ms: stats(times) });
}

async function errors() {
  const cases = [
    ['unknown pair ticker', `${API}/ticker/nope_jpy`],
    ['unknown pair depth', `${API}/depth/nope_jpy`],
    ['uppercase pair', `${API}/depth/BTC_JPY`],
    ['missing pair', `${API}/depth/`],
    ['unknown method', `${API}/nope/btc_jpy`],
    ['unknown currency', `${API}/currencies/nope`],
    ['unknown futures group', `${FAPI}/ticker/99/btc_jpy`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, url: url.replace('https://api.zaif.jp', ''), status: r.status, contentType: r.headers['content-type'], body: r.text.slice(0, 160) });
    await sleep(300);
  }
}

async function futures() {
  const groups = await get(`${FAPI}/groups/all`);
  log('fapi_groups_all', { status: groups.status, rows: groups.json.map((g) => ({ id: g.id, pair: g.currency_pair, start: iso(g.start_timestamp), end: iso(g.end_timestamp), use_swap: g.use_swap })) });
  for (const g of groups.json) {
    const t = await get(`${FAPI}/ticker/${g.id}/${g.currency_pair}`);
    const d = await get(`${FAPI}/depth/${g.id}/${g.currency_pair}`);
    const tr = await get(`${FAPI}/trades/${g.id}/${g.currency_pair}`);
    const trades = Array.isArray(tr.json) ? tr.json : [];
    log('fapi_group', { id: g.id, ticker: t.json, depth: { bids: d.json?.bids?.length, asks: d.json?.asks?.length }, trades: trades.length, lastTrade: trades[0] ? iso(trades[0].date) : null });
    await sleep(300);
  }
  const swap = await get(`${FAPI}/swap_history/1/btc_jpy`);
  const rows = Array.isArray(swap.json) ? swap.json : [];
  log('fapi_swap_history_1', { status: swap.status, rows: rows.length, newest: rows[0] ? iso(rows[0].timestamp) : null, oldest: rows.length ? iso(rows[rows.length - 1].timestamp) : null, stepSeconds: rows.length > 1 ? rows[0].timestamp - rows[1].timestamp : null, distinctBid: [...new Set(rows.map((r) => r.swap_rate_bid))], distinctAsk: [...new Set(rows.map((r) => r.swap_rate_ask))] });
}

const modes = { catalog, tickers, latency, depth, errors, futures };
const arg = process.argv[2] ?? 'all';
const run = arg === 'all' ? Object.keys(modes) : [arg];
log('start', { modes: run, at: new Date().toISOString() });
for (const m of run) {
  if (!modes[m]) throw new Error(`unknown mode ${m}`);
  await modes[m]();
}
log('end', { at: new Date().toISOString() });
