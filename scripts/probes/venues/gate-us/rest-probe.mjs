// Gate US REST probe: host and latency, the spot catalog and how CCXT would map it, the product paths the host serves, the REST book and its cache, the bulk ticker cadence, error shapes and clock offset.
// Public, unauthenticated, read-only. Gate US documents 900 public requests per second per IP and its headers count 200 per path, and this probe stays under 4 requests per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/gate-us/rest-probe.mjs [catalog|book|ticker|errors]
//   catalog  DNS, one cold and five warm currency_pairs calls, the futures, delivery and options paths, then CCXT 4.5.68 ids and the gateeu class pointed at api.gate.us. About 10 s, 14 requests plus those CCXT loadMarkets makes.
//   book     order_book on four pairs at three limits, level order, the ticker, 20 reads 250 ms apart with and without a nonce to measure the cache, and one read of global Gate. About 20 s, 55 requests.
//   ticker   the bulk spot/tickers every 1 s for 60 s: reply time, size, cache headers and how often each field changes. 60 requests.
//   errors   unknown pair, missing parameter, limits past 100, unknown path, spot/time with and without a Timestamp header, the last BTC_USD trades, and the clock offset. About 6 s, 18 requests.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/gate-us/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.gate.us/api/v4';
const GLOBAL_API = 'https://api.gateio.ws/api/v4';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const h = {};
  for (const k of ['server', 'date', 'cache-control', 'age', 'x-cache', 'via', 'x-gate-ratelimit-requests-remain', 'x-gate-ratelimit-limit', 'x-gate-ratelimit-reset-timestamp', 'retry-after', 'content-type']) {
    if (res.headers.get(k) !== null) h[k] = res.headers.get(k);
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: h };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function catalog() {
  for (const host of ['api.gate.us', 'ws.gate.us']) {
    const a = await dns.resolve4(host).catch((e) => [e.code]);
    const c = await dns.resolveCname(host).catch(() => []);
    log('dns', { host, a, cname: c });
  }
  const times = [];
  let last;
  for (let i = 0; i < 6; i++) {
    last = await get(`${API}/spot/currency_pairs`);
    times.push(last.ms);
    await sleep(400);
  }
  log('currency_pairs_time', { cold: times[0], warm: stats(times.slice(1)), status: last.status, bytes: last.bytes, headers: last.headers });
  keep('currency_pairs.json', last.text);
  const pairs = last.json;
  const byQuote = {};
  for (const p of pairs) {
    const k = `${p.quote}/${p.trade_status}`;
    byQuote[k] = (byQuote[k] ?? 0) + 1;
  }
  const fees = {};
  for (const p of pairs) fees[p.fee] = (fees[p.fee] ?? 0) + 1;
  log('catalog', { rows: pairs.length, byQuoteAndStatus: byQuote, feeField: fees, types: [...new Set(pairs.map((p) => p.type))], feeNot02: pairs.filter((p) => p.fee !== '0.2').map((p) => `${p.id} ${p.fee}`) });
  log('catalog_sample', { BTC_USD: pairs.find((p) => p.id === 'BTC_USD') });

  const bases = {};
  for (const p of pairs) bases[p.base] = [...(bases[p.base] ?? []), p.quote];
  log('pairs_listed_twice', { basesWithUsdAndUsdt: Object.entries(bases).filter(([, q]) => q.length > 1).length });

  for (const path of ['futures/usdt/contracts', 'futures/btc/contracts', 'futures/usdt/tickers', 'delivery/usdt/contracts', 'options/underlyings', 'margin/currency_pairs', 'margin/uni/currency_pairs', 'spot/currencies']) {
    const r = await get(`${API}/${path}`);
    log('path', { path, status: r.status, bytes: r.bytes, head: r.text.slice(0, 90) });
    await sleep(300);
  }

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, gateIds: ccxt.exchanges.filter((id) => id.includes('gate')) });

  // No gateus class exists, so this points the gateeu class, which is spot only, at the Gate US host to show how a class built the same way would map the catalog.
  const ex = new ccxt.gateeu();
  for (const scope of ['public', 'private']) {
    for (const k of Object.keys(ex.urls.api[scope])) ex.urls.api[scope][k] = API;
  }
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const btc = markets['BTC/USD'];
  log('ccxt_mapped', {
    note: 'gateeu class with urls pointed at api.gate.us, not a CCXT class of Gate US',
    markets: list.length,
    active: list.filter((m) => m.active).length,
    types: [...new Set(list.map((m) => m.type))],
    idEqualsWireId: list.filter((m) => pairs.some((p) => p.id === m.id)).length,
    takerValues: [...new Set(list.map((m) => m.taker))],
    btcUsd: { id: btc.id, symbol: btc.symbol, taker: btc.taker, maker: btc.maker, contractSize: btc.contractSize, linear: btc.linear, active: btc.active, precision: btc.precision },
  });
}

async function book() {
  const pairs = ['BTC_USD', 'BTC_USDT', 'ETH_USDT', 'SAND_USD'];
  for (const pair of pairs) {
    for (const limit of [20, 100, 1000]) {
      const r = await get(`${API}/spot/order_book?currency_pair=${pair}&limit=${limit}&with_id=true`);
      const b = r.json ?? {};
      const bids = (b.bids ?? []).map((l) => Number(l[0]));
      const asks = (b.asks ?? []).map((l) => Number(l[0]));
      const desc = bids.every((p, i) => i === 0 || p < bids[i - 1]);
      const asc = asks.every((p, i) => i === 0 || p > asks[i - 1]);
      const now = Date.now();
      log('order_book', {
        pair, limit, status: r.status, ms: r.ms, bytes: r.bytes, id: b.id, levels: [bids.length, asks.length],
        bidsDescending: desc, asksAscending: asc, top: [b.bids?.[0], b.asks?.[0]],
        spreadPpm: bids.length && asks.length ? Math.round(((asks[0] - bids[0]) / ((asks[0] + bids[0]) / 2)) * 1e6) : null,
        currentAgeMs: now - b.current, updateAgeMs: now - b.update, headers: r.headers, err: r.json?.label,
      });
      if (limit === 100) keep(`book-${pair}.json`, r.text);
      await sleep(300);
    }
  }
  const tick = await get(`${API}/spot/tickers?currency_pair=BTC_USDT`);
  log('ticker_vs_book', { ticker: { bid: tick.json?.[0]?.highest_bid, ask: tick.json?.[0]?.lowest_ask } });

  // The same URL read 20 times 250 ms apart, then 20 times with a nonce, to see whether the edge serves a cached copy.
  for (const nonce of [false, true]) {
    const currents = [];
    const ages = [];
    let hdr;
    for (let i = 0; i < 20; i++) {
      const url = `${API}/spot/order_book?currency_pair=BTC_USDT&limit=5&with_id=true${nonce ? `&_=${Date.now()}` : ''}`;
      const r = await get(url);
      const now = Date.now();
      currents.push(r.json?.current);
      ages.push(now - r.json?.current);
      hdr = r.headers;
      await sleep(250);
    }
    log('book_cache', { nonce, reads: 20, distinctCurrent: new Set(currents).size, currentAgeMs: stats(ages), lastHeaders: hdr, status: 'ok' });
  }

  // One read of Gate's global host for the same pair, to show whether the two venues share a book.
  const [us, gl] = await Promise.all([
    get(`${API}/spot/order_book?currency_pair=BTC_USDT&limit=3&with_id=true`),
    get(`${GLOBAL_API}/spot/order_book?currency_pair=BTC_USDT&limit=3&with_id=true`),
  ]);
  log('us_vs_global', { us: { id: us.json?.id, bid: us.json?.bids?.[0], ask: us.json?.asks?.[0] }, global: { id: gl.json?.id, bid: gl.json?.bids?.[0], ask: gl.json?.asks?.[0] } });
}

async function ticker() {
  const watch = ['BTC_USD', 'BTC_USDT', 'ETH_USDT', 'SAND_USD', 'SOL_USD'];
  const prev = {};
  const changes = {};
  const times = [];
  const sizes = [];
  let rows = 0;
  let hdr;
  let firstBody;
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const r = await get(`${API}/spot/tickers`);
    times.push(r.ms);
    sizes.push(r.bytes);
    hdr = r.headers;
    if (!firstBody) firstBody = r.text;
    rows = r.json.length;
    for (const t of r.json) {
      if (!watch.includes(t.currency_pair)) continue;
      for (const f of ['last', 'highest_bid', 'lowest_ask', 'base_volume']) {
        const k = `${t.currency_pair}.${f}`;
        if (prev[k] !== undefined && prev[k] !== t[f]) changes[k] = (changes[k] ?? 0) + 1;
        prev[k] = t[f];
      }
    }
    const wait = 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
  }
  keep('tickers.json', firstBody);
  const sample = JSON.parse(firstBody).find((t) => t.currency_pair === 'BTC_USD');
  log('tickers', { polls: 60, wallS: Math.round((Date.now() - t0) / 1000), rows, ms: stats(times), bytes: stats(sizes), headers: hdr, fields: Object.keys(sample), btcUsd: sample });
  log('ticker_changes_in_59_intervals', changes);
  const zeroVol = JSON.parse(firstBody).filter((t) => Number(t.quote_volume) === 0).length;
  const oneSided = JSON.parse(firstBody).filter((t) => !Number(t.highest_bid) || !Number(t.lowest_ask)).length;
  log('ticker_quiet', { rows, zeroQuoteVolume24h: zeroVol, missingBidOrAsk: oneSided });
}

async function errors() {
  const cases = [
    ['unknown pair', `${API}/spot/order_book?currency_pair=NOPE_USD`],
    ['missing pair', `${API}/spot/order_book`],
    ['limit 101', `${API}/spot/order_book?currency_pair=BTC_USDT&limit=101`],
    ['limit 1000', `${API}/spot/order_book?currency_pair=BTC_USDT&limit=1000`],
    ['limit 0', `${API}/spot/order_book?currency_pair=BTC_USDT&limit=0`],
    ['trades on a pair with no volume', `${API}/spot/trades?currency_pair=SAND_USD&limit=3`],
    ['unknown ticker', `${API}/spot/tickers?currency_pair=NOPE_USD`],
    ['unknown path', `${API}/spot/nope`],
    ['time', `${API}/spot/time`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, body: r.text.slice(0, 160), headers: r.headers });
    await sleep(300);
  }
  const ts = String(Math.floor(Date.now() / 1000));
  const t = await get(`${API}/spot/time`, { Timestamp: ts });
  log('error_case', { name: 'time with Timestamp header', status: t.status, body: t.text.slice(0, 160) });

  // The ticker's last price is compared with the venue's own last trade, since most pairs show no 24 h volume.
  const [tr, tk] = await Promise.all([get(`${API}/spot/trades?currency_pair=BTC_USD&limit=5`), get(`${API}/spot/tickers?currency_pair=BTC_USD`)]);
  log('last_trades_btc_usd', {
    lastTradeId: tr.json?.[0]?.id,
    lastTradeAgeS: Math.round(Date.now() / 1000 - Number(tr.json?.[0]?.create_time)),
    tradePrices: tr.json?.map((t) => t.price),
    tickerLast: tk.json?.[0]?.last,
  });

  const d0 = Date.now();
  const dr = await fetch(`${API}/spot/currency_pairs/BTC_USD`);
  const d1 = Date.now();
  log('date_header', { date: dr.headers.get('date'), localMid: new Date((d0 + d1) / 2).toISOString(), note: 'one second resolution' });

  // Clock offset from the book's generation time, midpoint of the request.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const a = Date.now();
    const r = await get(`${API}/spot/order_book?currency_pair=BTC_USD&limit=1`);
    const b = Date.now();
    offsets.push(r.json.current - (a + b) / 2);
    await sleep(300);
  }
  log('clock', { bookCurrentMinusLocalMidMs: offsets.map(Math.round), note: 'current is cached up to a few seconds, so the smallest value is the bound' });
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, book, ticker, errors }[mode];
if (!run) {
  console.error('mode: catalog|book|ticker|errors');
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
