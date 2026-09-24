// EXMO REST probe: host and latency, the spot catalog and how CCXT maps it, the fee endpoint, the bulk REST book, the bulk ticker cadence, error shapes and clock offset.
// Public, unauthenticated, read-only. EXMO allows 10 requests per second per IP, and every request here waits at least 250 ms after the previous one.
// Run from server/: node ../scripts/probes/venues/exmo/rest-probe.mjs [catalog|book|ticker|errors]
//   catalog  DNS, one cold and five warm pair_settings calls, the web fee endpoint, the exmo.me catalog, then CCXT 4.5.68 loadMarkets. About 10 s.
//   book     order_book for every pair in one call at limit 1000: levels, order, touch spread, stub levels, ticker compare, and Kraken's USD mid as a reference. About 5 s.
//   ticker   the bulk ticker every 1 s for 60 s: reply time, size, how often each field changes, and the Date header offset. 60 requests.
//   errors   unknown pair, missing pair, unknown method, over-limit book depth, and the response headers. About 5 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/exmo/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.exmo.com/v1.1';
const SPACING_MS = 250;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

let lastRequestAt = 0;

async function get(url) {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
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

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function catalog() {
  const hosts = ['api.exmo.com', 'ws-api.exmo.com', 'exmo.com', 'api.exmo.me', 'ws-api.exmo.me'];
  for (const h of hosts) {
    const a = await dns.resolve4(h).catch((e) => [e.code]);
    log('dns', { host: h, a });
  }

  const times = [];
  let ps;
  for (let i = 0; i < 6; i++) {
    ps = await get(`${API}/pair_settings`);
    times.push(ps.ms);
  }
  keep('pair_settings.json', ps.text);
  log('pair_settings_timing', { status: ps.status, bytes: ps.bytes, coldMs: times[0], warm: stats(times.slice(1)), server: ps.headers.server });

  const pairs = Object.keys(ps.json);
  const quotes = {};
  const fees = {};
  for (const id of pairs) {
    const q = id.split('_')[1];
    quotes[q] = (quotes[q] ?? 0) + 1;
    const f = `${ps.json[id].commission_taker_percent}/${ps.json[id].commission_maker_percent}`;
    fees[f] = (fees[f] ?? 0) + 1;
  }
  log('pair_settings', { count: pairs.length, quotes, takerMakerPercent: fees, sample: { BTC_USDC: ps.json.BTC_USDC } });

  const web = await get('https://exmo.com/ctrl/feesAndLimits');
  const limits = web.json?.data?.limits ?? [];
  log('web_fees_and_limits', {
    status: web.status,
    bytes: web.bytes,
    pairs: limits.length,
    feesArray: web.json?.data?.fees,
    takerMaker: [...new Set(limits.map((l) => `${l.taker}/${l.maker}`))],
    samePairsAsPairSettings: limits.map((l) => l.pair.replace('/', '_')).sort().join() === [...pairs].sort().join(),
  });

  const me = await get('https://api.exmo.me/v1.1/pair_settings');
  log('exmo_me_pair_settings', { status: me.status, pairs: Object.keys(me.json ?? {}), sample: me.json });

  const ex = new ccxt.exmo();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const byType = {};
  for (const m of list) byType[m.type] = (byType[m.type] ?? 0) + 1;
  const b = markets['BTC/USDC'];
  log('ccxt_markets', {
    ms: Math.round(performance.now() - t0),
    count: list.length,
    byType,
    swaps: list.filter((m) => m.swap).length,
    idsEqualPairSettings: list.map((m) => m.id).sort().join() === [...pairs].sort().join(),
    takers: [...new Set(list.map((m) => m.taker))],
    makers: [...new Set(list.map((m) => m.maker))],
    active: [...new Set(list.map((m) => String(m.active)))],
    sample: { id: b.id, symbol: b.symbol, base: b.base, quote: b.quote, type: b.type, spot: b.spot, margin: b.margin, linear: b.linear, contractSize: b.contractSize, active: b.active, taker: b.taker, maker: b.maker, precision: b.precision },
    defaultFees: ex.fees.trading,
    has: { fetchFundingRates: ex.has.fetchFundingRates, watchOrderBook: ex.has.watchOrderBook, swap: ex.has.swap, margin: ex.has.margin },
  });
}

async function book() {
  const ps = await get(`${API}/pair_settings`);
  const pairs = Object.keys(ps.json);
  const r = await get(`${API}/order_book?pair=${pairs.join(',')}&limit=1000`);
  keep('order_book_all.json', r.text);
  log('order_book_bulk', { status: r.status, bytes: r.bytes, ms: r.ms, pairsReturned: Object.keys(r.json).length });

  const tk = await get(`${API}/ticker`);
  const rows = [];
  let bidsDesc = 0;
  let asksAsc = 0;
  for (const id of pairs) {
    const b = r.json[id];
    const bids = b.bid.map((l) => l.map(Number));
    const asks = b.ask.map((l) => l.map(Number));
    if (bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0])) bidsDesc++;
    if (asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0])) asksAsc++;
    const bb = bids[0]?.[0];
    const ba = asks[0]?.[0];
    const mid = (bb + ba) / 2;
    const near = (side) => side.filter((l) => Math.abs(l[0] / mid - 1) < 0.2).length;
    rows.push({
      id,
      nb: bids.length,
      na: asks.length,
      bid: bb,
      ask: ba,
      spreadPpm: Math.round(((ba - bb) / mid) * 1e6),
      bidOffMidPpm: Math.round((bb / mid - 1) * 1e6),
      touchBidQuote: Math.round(bids[0]?.[0] * bids[0]?.[1]),
      touchAskQuote: Math.round(asks[0]?.[0] * asks[0]?.[1]),
      bidsWithin20pct: near(bids),
      asksWithin20pct: near(asks),
      tickerMatches: tk.json[id]?.buy_price === b.bid_top && tk.json[id]?.sell_price === b.ask_top,
      tripletOk: b.bid.every((l) => Math.abs(Number(l[0]) * Number(l[1]) - Number(l[2])) <= 1e-6 * Math.max(1, Number(l[2]))),
    });
  }
  for (const row of rows) log('book', row);
  log('book_order', { pairs: pairs.length, bidsDescending: bidsDesc, asksAscending: asksAsc });
  log('book_sample_btc', { keys: Object.keys(r.json.BTC_USDC), bid: r.json.BTC_USDC.bid.slice(0, 3), ask: r.json.BTC_USDC.ask.slice(0, 3) });

  // Kraken's USD books are a reference for where EXMO's quotes sit against the wider market.
  const kr = await get('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD,XRPUSD');
  const krMap = { XXBTZUSD: 'BTC_USDC', XETHZUSD: 'ETH_USDC', SOLUSD: 'SOL_USDC', XXRPZUSD: 'XRP_USDC' };
  for (const [k, id] of Object.entries(krMap)) {
    const t = kr.json?.result?.[k];
    const row = rows.find((x) => x.id === id);
    if (!t || !row) continue;
    const refMid = (Number(t.b[0]) + Number(t.a[0])) / 2;
    const exmoMid = (row.bid + row.ask) / 2;
    log('reference_kraken_usd', { id, krakenMid: refMid, exmoMid, exmoMidVsKrakenPpm: Math.round((exmoMid / refMid - 1) * 1e6), exmoBidVsKrakenPpm: Math.round((row.bid / refMid - 1) * 1e6), exmoAskVsKrakenPpm: Math.round((row.ask / refMid - 1) * 1e6) });
  }

  const small = await get(`${API}/order_book?pair=BTC_USDC&limit=1`);
  log('order_book_limit1', { status: small.status, body: small.text.slice(0, 300) });
}

async function ticker() {
  const seen = {};
  const times = [];
  const offsets = [];
  let bytes = 0;
  let count = 0;
  for (let i = 0; i < 60; i++) {
    const r = await get(`${API}/ticker`);
    times.push(r.ms);
    bytes = r.bytes;
    count = Object.keys(r.json).length;
    const date = Date.parse(r.headers.date);
    offsets.push(r.localMs - r.ms / 2 - date);
    for (const [id, t] of Object.entries(r.json)) {
      seen[id] ??= { buy: new Set(), sell: new Set(), last: new Set(), updated: new Set(), firstUpdatedAgeS: Math.round(Date.now() / 1000 - t.updated) };
      seen[id].buy.add(t.buy_price);
      seen[id].sell.add(t.sell_price);
      seen[id].last.add(t.last_trade);
      seen[id].updated.add(t.updated);
    }
    const next = lastRequestAt + 1000 - Date.now();
    if (next > 0) await sleep(next);
  }
  log('ticker_timing', { pairs: count, bytes, ms: stats(times), over1s: times.filter((t) => t > 1000).length });
  log('date_header_offset_ms', { note: 'local midpoint minus Date header, which has 1 s resolution', ...stats(offsets.map(Math.round)) });
  for (const [id, s] of Object.entries(seen)) {
    log('ticker_changes', { id, buyValues: s.buy.size, sellValues: s.sell.size, lastValues: s.last.size, updatedValues: s.updated.size, firstUpdatedAgeS: s.firstUpdatedAgeS });
  }
}

async function errors() {
  const cases = [
    ['unknown pair', `${API}/order_book?pair=NOPE_USDC`],
    ['pair listed on exmo.me only', `${API}/order_book?pair=BTC_USDT`],
    ['missing pair', `${API}/order_book`],
    ['limit 5000', `${API}/order_book?pair=BTC_USDC&limit=5000`],
    ['unknown method', `${API}/nope`],
    ['trades unknown pair', `${API}/trades?pair=NOPE_USDC`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, contentType: r.headers['content-type'], body: r.text.slice(0, 240) });
  }
  const r = await get(`${API}/ticker`);
  log('ticker_headers', { headers: r.headers });
}

const modes = { catalog, book, ticker, errors };
const mode = process.argv[2] ?? 'catalog';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
