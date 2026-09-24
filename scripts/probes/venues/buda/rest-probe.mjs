// Buda REST probe: host and latency, the spot catalog, fee tiers, per market ticker and volume, the REST book, errors, and the clock.
// Public, unauthenticated, read-only. Stays far inside the documented 120 requests per minute per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/buda/rest-probe.mjs [catalog|book]
//   catalog  DNS, cold and warm times, markets, tickers, tiers, CCXT check, then ticker and volume for every market at one call per 1.1 s. About 70 s.
//   book     REST order book shape and order on four markets, ten polls of BTC-CLP at 1.5 s, trades, unknown market, headers, Date offset. About 35 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/buda/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://www.buda.com/api/v2';
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
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
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

function interestingHeaders(h) {
  const out = {};
  for (const [k, v] of h) {
    if (/rate|limit|retry|cache|age|etag|cf-ray|date|server|x-runtime|envoy/i.test(k)) out[k] = v;
  }
  return out;
}

async function catalog() {
  log('dns', { www: await lookup('www.buda.com', { all: true }), realtime: await lookup('realtime.buda.com', { all: true }) });

  const cold = await get('/markets');
  const warm = [];
  for (let i = 0; i < 5; i++) {
    await sleep(600);
    warm.push((await get('/markets')).ms);
  }
  log('markets_timing', { status: cold.status, coldMs: cold.ms, warmMs: warm, bytes: cold.bytes, headers: interestingHeaders(cold.headers) });
  keep('markets.json', cold.text);

  const markets = cold.json.markets;
  const byQuote = {};
  for (const m of markets) byQuote[m.quote_currency] = (byQuote[m.quote_currency] ?? 0) + 1;
  log('markets', {
    count: markets.length,
    byQuote,
    disabled: markets.filter((m) => m.disabled).map((m) => m.id),
    illiquid: markets.filter((m) => m.illiquid).map((m) => m.id),
    keys: Object.keys(markets[0]),
  });
  const feeGroups = {};
  for (const m of markets) {
    const k = `taker ${m.taker_fee} maker ${m.maker_fee} discount ${m.taker_discount_percentage}/${m.maker_discount_percentage} tiers ${JSON.stringify(m.taker_discount_tiers)}/${JSON.stringify(m.maker_discount_tiers)}`;
    (feeGroups[k] ??= []).push(m.id);
  }
  log('market_fees', feeGroups);

  await sleep(600);
  const tickers = await get('/tickers');
  log('tickers', { status: tickers.status, ms: tickers.ms, bytes: tickers.bytes, count: tickers.json.tickers.length, keys: Object.keys(tickers.json.tickers[0]) });

  await sleep(600);
  const tiers = await get('/tiers');
  keep('tiers.json', tiers.text);
  log('tiers', { status: tiers.status, ms: tiers.ms, rows: tiers.json.tiers.map((t) => [t.id, t.monthly_traded?.[0]?.[0], t.monthly_traded?.[1]?.[0] ?? null, t.taker_fee, t.maker_fee, t.order_quota]) });

  log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, hasBuda: ccxt.exchanges.includes('buda'), budaLike: ccxt.exchanges.filter((x) => /buda/i.test(x)) });

  const rows = [];
  for (const m of markets) {
    await sleep(1100);
    const t = await get(`/markets/${m.name}/ticker`);
    await sleep(1100);
    const v = await get(`/markets/${m.name}/volume`);
    const tk = t.json?.ticker ?? {};
    const vol = v.json?.volume ?? {};
    const bid = Number(tk.max_bid?.[0]);
    const ask = Number(tk.min_ask?.[0]);
    rows.push({
      id: m.id,
      status: [t.status, v.status],
      ms: [t.ms, v.ms],
      last: tk.last_price?.[0],
      bid: tk.max_bid?.[0],
      ask: tk.min_ask?.[0],
      spreadBps: bid > 0 && ask > 0 ? Math.round(((ask - bid) / ((ask + bid) / 2)) * 1e5) / 10 : null,
      vol24hBase: tk.volume?.[0],
      quoteVol24h: [Number(vol.bid_quote_volume_24h?.[0] ?? 0) + Number(vol.ask_quote_volume_24h?.[0] ?? 0), vol.bid_quote_volume_24h?.[1]],
    });
  }
  for (const r of rows) log('market_row', r);
}

function orderCheck(levels, descending) {
  let bad = 0;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (descending ? b >= a : b <= a) bad++;
  }
  return bad;
}

async function book() {
  for (const id of ['btc-clp', 'btc-usdc', 'usdc-clp', 'ltc-cop']) {
    const r = await get(`/markets/${id}/order_book`);
    const ob = r.json.order_book;
    keep(`book-${id}.json`, r.text);
    log('book', {
      id,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      keys: Object.keys(ob),
      bids: ob.bids.length,
      asks: ob.asks.length,
      bidsNotDescending: orderCheck(ob.bids, true),
      asksNotAscending: orderCheck(ob.asks, false),
      bestBid: ob.bids[0],
      bestAsk: ob.asks[0],
      levelShape: typeof ob.bids[0]?.[0] + ',' + typeof ob.bids[0]?.[1] + ',len' + ob.bids[0]?.length,
      headers: interestingHeaders(r.headers),
    });
    await sleep(800);
  }

  const withLimit = await get('/markets/btc-clp/order_book?limit=20');
  log('book_limit_param', { status: withLimit.status, bids: withLimit.json?.order_book?.bids?.length, asks: withLimit.json?.order_book?.asks?.length });
  await sleep(800);

  let prev;
  const polls = [];
  for (let i = 0; i < 10; i++) {
    const r = await get('/markets/btc-clp/order_book');
    const body = JSON.stringify(r.json.order_book);
    polls.push({ ms: r.ms, changed: prev === undefined ? null : body !== prev, top: [r.json.order_book.bids[0], r.json.order_book.asks[0]] });
    prev = body;
    await sleep(1500);
  }
  log('book_polls', { ms: polls.map((p) => p.ms), changed: polls.map((p) => p.changed), firstTop: polls[0].top, lastTop: polls[9].top });

  const trades = await get('/markets/btc-clp/trades?limit=5');
  log('trades', { status: trades.status, keys: Object.keys(trades.json.trades), entry: trades.json.trades.entries[0] });
  await sleep(800);

  for (const p of ['/markets/nope-clp/order_book', '/markets/nope-clp', '/markets/BTC-CLP/order_book', '/markets/btc-clp/order_book.json', '/nope']) {
    const r = await get(p);
    log('path', { path: p, status: r.status, body: r.text.slice(0, 160) });
    await sleep(800);
  }

  // Server time: no documented call, and the Date header has one second resolution, so it only shows an offset of a second or more.
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const before = Date.now();
    const r = await get('/markets/btc-clp/ticker');
    const after = Date.now();
    const server = Date.parse(r.headers.get('date'));
    samples.push({ rttMs: after - before, localMid: Math.round((before + after) / 2), serverDate: server, midMinusServerMs: Math.round((before + after) / 2) - server });
    await sleep(1300);
  }
  log('date_header', { samples: samples.map((s) => [s.rttMs, s.midMinusServerMs]), note: 'Date has 1 s resolution, so 0 to 999 ms means no measurable offset' });
}

const mode = process.argv[2] ?? 'catalog';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'catalog') await catalog();
else if (mode === 'book') await book();
else console.log('modes: catalog | book');
log('end', { at: new Date().toISOString() });
