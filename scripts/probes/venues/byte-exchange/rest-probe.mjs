// Byte Exchange (bexc.io) public REST probe: latency and clock, spot catalog, perpetual status and the demo perp list, fee schedule, depth snapshots, error shapes, a bulk ticker poll, and the busiest books next to Bybit spot.
// Public, unauthenticated, read-only. Every mode stays at or under five requests a second, inside the 30 per second that CCXT pull request 28769 quotes.
// Run from server/: node ../scripts/probes/venues/byte-exchange/rest-probe.mjs [latency|catalog|perp|book|poll|mirror|all]
//   latency  DNS, 10 cold /perp/status calls, 20 warm /markets calls on api.bexc.io and 10 on bexc.io, clock offset from the Date header and the as_of field. About 40 s.
//   catalog  /markets, /ticker, /ticker/24h, /currencies and /fees counted and cross checked, plus the CCXT 4.5.68 exchange list.
//   perp     /perp/status, /perp/disclosures, /perp/eligibility, /perp-demo/markets and the perp paths a real contract would use.
//   book     depth limits, level order, order counts, repeat reads for caching, error replies, response headers. About 15 s.
//   poll     the bulk /ticker once a second for 30 polls, reply time and how many rows changed.
//   mirror   BTC, ETH, SOL, XRP and DOGE books next to Bybit spot at the same instant, ten rounds a second apart.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/byte-exchange/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.bexc.io/api/v1';
const WEB = 'https://bexc.io/api/v1';
const BYBIT = 'https://api.bybit.com/v5/market/orderbook?category=spot&limit=1&symbol=';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, headers = {}) {
  const t = performance.now();
  const res = await fetch(url, { headers });
  const text = await res.text();
  const ms = Math.round(performance.now() - t);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

const count = (xs, f) => xs.reduce((o, x) => ((o[f(x)] = (o[f(x)] ?? 0) + 1), o), {});

async function latency() {
  for (const host of ['api.bexc.io', 'bexc.io', 'engine-v3.bexc.io']) {
    log('dns', { host, addresses: (await lookup(host, { all: true })).map((a) => a.address) });
  }
  // Connection: close asks the server to drop the socket after each reply, so each call opens a new connection.
  const cold = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${API}/perp/status`, { connection: 'close' });
    cold.push(r.ms);
    await sleep(500);
  }
  log('cold_perp_status', stats(cold));
  const warm = [];
  let size = 0;
  for (let i = 0; i < 20; i++) {
    const r = await get(`${API}/markets`);
    warm.push(r.ms);
    size = r.bytes;
    await sleep(500);
  }
  log('warm_markets_api_host', { ...stats(warm), bytes: size });
  const web = [];
  for (let i = 0; i < 10; i++) {
    web.push((await get(`${WEB}/markets`)).ms);
    await sleep(500);
  }
  log('warm_markets_web_host', stats(web));
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get(`${API}/perp/status`);
    const after = Date.now();
    const server = Date.parse(r.headers.get('date'));
    const asOf = Date.parse(r.json?.as_of ?? '');
    offsets.push({ dateHeaderMinusMid: server - Math.round((before + after) / 2), asOfMinusMid: asOf - Math.round((before + after) / 2), rtt: after - before });
    await sleep(500);
  }
  log('clock', {
    dateHeader: stats(offsets.map((o) => o.dateHeaderMinusMid)),
    asOf: stats(offsets.map((o) => o.asOfMinusMid)),
    rtt: stats(offsets.map((o) => o.rtt)),
  });
}

async function catalog() {
  const m = await get(`${API}/markets`);
  keep('markets.json', m.text);
  const markets = m.json.markets;
  log('markets', {
    status: m.status,
    bytes: m.bytes,
    count: m.json.count,
    rows: markets.length,
    byQuote: count(markets, (x) => x.quote_asset),
    active: count(markets, (x) => x.is_active),
    fees: count(markets, (x) => `${x.maker_fee}/${x.taker_fee}`),
    protected: markets.filter((x) => x.protected_pair).map((x) => x.symbol),
    postOnlySell: markets.filter((x) => x.force_post_only_sell).map((x) => x.symbol),
    symbolShape: count(markets, (x) => (/^[A-Z0-9]+_[A-Z0-9]+$/.test(x.symbol) ? 'BASE_QUOTE' : 'other')),
    symbolMatchesAssets: markets.filter((x) => x.symbol === `${x.base_asset}_${x.quote_asset}`).length,
    perpLike: markets.filter((x) => /PERP|SWAP|FUT/i.test(x.symbol)).length,
    keys: Object.keys(markets[0]).join(','),
  });
  const dup = count(markets, (x) => x.base_asset);
  log('bases', { distinct: Object.keys(dup).length, listedOnTwoOrMoreQuotes: Object.values(dup).filter((n) => n > 1).length });
  log('low_taker_markets', { symbols: markets.filter((x) => x.taker_fee === '0.001000').map((x) => x.symbol) });

  const t = await get(`${API}/ticker`);
  keep('ticker.json', t.text);
  const t24 = await get(`${API}/ticker/24h`);
  const bySym = new Map(t.json.map((x) => [x.symbol, x]));
  const vol = t.json.map((x) => [x.symbol, Number(x.quote_volume_24h)]).sort((a, b) => b[1] - a[1]);
  log('ticker', {
    status: t.status,
    bytes: t.bytes,
    rows: t.json.length,
    keys: Object.keys(t.json[0]).join(','),
    inMarkets: t.json.filter((x) => markets.some((y) => y.symbol === x.symbol)).length,
    hasBidAsk: 'bid' in t.json[0] || 'best_bid' in t.json[0],
    top10ByQuoteVolume: vol.slice(0, 10).map(([s, v]) => `${s} ${Math.round(v)}`),
    rowsOver100kQuote: vol.filter(([, v]) => v > 100_000).length,
    rowsUnder1kQuote: vol.filter(([, v]) => v < 1_000).length,
  });
  log('ticker24h', { status: t24.status, bytes: t24.bytes, rows: t24.json.length, keys: Object.keys(t24.json[0]).join(','), tradeCount24h: count(t24.json, (x) => (x.trade_count_24h === 0 ? 'zero' : 'nonzero')) });
  const c = await get(`${API}/currencies`);
  log('currencies', { status: c.status, bytes: c.bytes, rows: Array.isArray(c.json) ? c.json.length : Object.keys(c.json ?? {}) });

  const f = await get(`${API}/fees`);
  keep('fees.json', f.text);
  log('fees', {
    status: f.status,
    tiers: f.json.tiers.map((x) => `${x.rank} ${x.name} ${x.maker_fee}/${x.taker_fee} from ${x.volume_30d_min_usd}`),
    discount: `${f.json.discount_token} ${f.json.discount_pct}% active ${f.json.bexc_discount_active}`,
    makerRebate: `${f.json.maker_rebate_vip3_bps} bps cap ${f.json.maker_rebate_daily_cap_usd} active ${f.json.maker_rebate_active}`,
    convertSpreadPct: f.json.convert_spread_pct,
    lastUpdated: f.json.last_updated,
  });
  const v = await get(`${API}/wallet/volume-discount-tiers`);
  log('volume_discount_tiers', { status: v.status, tiers: v.json.map((x) => `${x.name} ${x.maker_fee}/${x.taker_fee} from ${x.volume} discount ${x.discount_perc}`) });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ccxt.exchanges.filter((id) => /byte|bexc/i.test(id)) });
}

async function perp() {
  for (const p of ['perp/status', 'perp/disclosures', 'perp/eligibility', 'perp-demo/markets', 'perp-demo/status', 'perp/markets', 'perps/status', 'futures/markets', 'perp/ticker', 'perp/funding', 'perp/mark']) {
    const r = await get(`${API}/${p}`);
    keep(`${p.replace(/\//g, '_')}.json`, r.text);
    log('perp_call', { path: p, status: r.status, bytes: r.bytes, head: r.text.slice(0, 160) });
    await sleep(500);
  }
  const s = await get(`${API}/perp/status`);
  log('perp_status', { byte_systems: s.json.byte_systems, clearing_rail: s.json.clearing_rail, price_feed: { ...s.json.price_feed, catching_up: s.json.price_feed.catching_up.length }, backstops: s.json.backstops.rows });
  const d = await get(`${API}/perp/disclosures`);
  log('perp_disclosures', { ids: d.json.items.map((x) => x.id), values: d.json.items.flatMap((x) => x.values) });
  const dm = await get(`${API}/perp-demo/markets`);
  const rows = dm.json;
  log('perp_demo_markets', {
    rows: rows.length,
    keys: Object.keys(rows[0]).join(','),
    symbolSuffix: count(rows, (x) => x.symbol.replace(/^.*?_(USDT_PERP_DEMO|USD_DEMO|DEMO)$/, '$1')),
    quote: count(rows, (x) => x.quote),
    intervalSecs: count(rows, (x) => x.funding_interval_secs),
    takerBps: count(rows, (x) => x.taker_fee_bps),
    markSource: rows.filter((x) => x.mark_source_symbol).map((x) => `${x.symbol}<${x.mark_source_symbol}`),
    fundingRate: stats(rows.map((x) => x.current_funding_rate)),
    maxLeverage: count(rows, (x) => x.max_leverage),
    first: rows[0],
  });
  const vs = await get(`${API}/perp-demo/vault-stats`);
  log('perp_demo_vault_stats', { status: vs.status, activity: vs.json?.stats?.activity });
}

async function book() {
  for (const limit of [undefined, 5, 20, 50, 100, 200, 1000]) {
    const r = await get(`${API}/orderbook/BTC_USDT${limit === undefined ? '' : `?limit=${limit}`}`);
    log('depth_limit', { limit: limit ?? 'none', status: r.status, bids: r.json?.bids?.length, asks: r.json?.asks?.length, bytes: r.bytes, ms: r.ms });
    await sleep(500);
  }
  for (const sym of ['BTC_USDT', 'ETH_USDT', 'ALLO_USDT', 'EUL_USDC', 'SUI_ETH']) {
    const r = await get(`${API}/orderbook/${sym}`);
    keep(`book_${sym}.json`, r.text);
    const b = r.json.bids.map((l) => Number(l.price));
    const a = r.json.asks.map((l) => Number(l.price));
    const all = [...r.json.bids, ...r.json.asks];
    log('book', {
      sym,
      status: r.status,
      keys: Object.keys(r.json).join(','),
      last_update_id: r.json.last_update_id,
      bids: b.length,
      asks: a.length,
      bidsDescending: b.every((p, i) => i === 0 || p < b[i - 1]),
      asksAscending: a.every((p, i) => i === 0 || p > a[i - 1]),
      repeatedPrices: b.filter((p, i) => i > 0 && p === b[i - 1]).length + a.filter((p, i) => i > 0 && p === a[i - 1]).length,
      inversions: b.filter((p, i) => i > 0 && p > b[i - 1]).length + a.filter((p, i) => i > 0 && p < a[i - 1]).length,
      crossed: b.length > 0 && a.length > 0 && b[0] >= a[0],
      spreadPpm: b.length && a.length ? Math.round(((a[0] - b[0]) / ((a[0] + b[0]) / 2)) * 1e6) : null,
      orderCount: count(all, (l) => l.order_count),
      priceType: typeof r.json.bids[0]?.price,
      sizeType: typeof r.json.bids[0]?.quantity,
      top: [r.json.bids[0], r.json.asks[0]],
    });
    await sleep(500);
  }
  // Same book read quickly to see whether the three second cache-control is honoured.
  const reads = [];
  for (let i = 0; i < 8; i++) {
    const r = await get(`${API}/orderbook/BTC_USDT`);
    reads.push({ t: i * 400, id: r.json.last_update_id, xcache: r.headers.get('x-cache-status'), cf: r.headers.get('cf-cache-status'), age: r.headers.get('age'), cc: r.headers.get('cache-control') });
    await sleep(400);
  }
  log('book_repeat_reads', { reads });
  const nonce = await get(`${API}/orderbook/BTC_USDT?n=${Date.now()}`);
  log('book_nonce', { id: nonce.json.last_update_id, xcache: nonce.headers.get('x-cache-status') });

  for (const p of ['orderbook/NOPE_USDT', 'orderbook/btc_usdt', 'orderbook/BTC-USDT', 'orderbook/BTC_USDT?limit=abc', 'orderbook/BTC_USDT?limit=0', 'trades/NOPE_USDT', 'klines?symbol=BTC_USDT&interval=7m', 'nope']) {
    const r = await get(`${API}/${p}`);
    log('error_shape', { path: p, status: r.status, body: r.text.slice(0, 200), contentType: r.headers.get('content-type') });
    await sleep(500);
  }
  const h = await get(`${API}/orderbook/BTC_USDT`);
  const headers = {};
  for (const [k, v] of h.headers) if (/rate|limit|retry|cache|cf-ray|server|age/i.test(k)) headers[k] = v;
  log('headers', headers);
  const tr = await get(`${API}/trades/BTC_USDT?limit=5`);
  log('trades', { status: tr.status, first: Array.isArray(tr.json) ? tr.json[0] : tr.json });
}

async function poll() {
  let prev = null;
  const times = [];
  const changed = [];
  const bytes = [];
  const xcache = [];
  for (let i = 0; i < 30; i++) {
    const r = await get(`${API}/ticker`);
    times.push(r.ms);
    bytes.push(r.bytes);
    const now = new Map(r.json.map((x) => [x.symbol, x.last_price]));
    if (prev) changed.push([...now].filter(([s, p]) => prev.get(s) !== p).length);
    xcache.push(r.headers.get('x-cache-status'));
    prev = now;
    await sleep(Math.max(0, 1000 - r.ms));
  }
  log('ticker_poll', { ms: stats(times), bytes: stats(bytes), rowsChangedPerPoll: stats(changed), pollsWithChange: changed.map((n, i) => (n > 0 ? `${i + 1}:${n}` : null)).filter(Boolean), xcache: count(xcache, (x) => x) });
}

async function mirror() {
  const pairs = [
    ['BTC_USDT', 'BTCUSDT'],
    ['ETH_USDT', 'ETHUSDT'],
    ['SOL_USDT', 'SOLUSDT'],
    ['XRP_USDT', 'XRPUSDT'],
    ['DOGE_USDT', 'DOGEUSDT'],
  ];
  const rows = Object.fromEntries(pairs.map(([s]) => [s, []]));
  for (let round = 0; round < 10; round++) {
    await Promise.all(
      pairs.map(async ([s, b]) => {
        const [x, y] = await Promise.all([get(`${API}/orderbook/${s}?n=${Date.now()}`), get(`${BYBIT}${b}`)]);
        const xb = Number(x.json.bids[0].price);
        const xa = Number(x.json.asks[0].price);
        const yb = Number(y.json.result.b[0][0]);
        const ya = Number(y.json.result.a[0][0]);
        const mid = (yb + ya) / 2;
        rows[s].push({ midPpm: Math.round((((xb + xa) / 2 - mid) / mid) * 1e6), spreadPpm: Math.round(((xa - xb) / ((xa + xb) / 2)) * 1e6), bybitSpreadPpm: Math.round(((ya - yb) / mid) * 1e6), topQty: Number(x.json.bids[0].quantity) });
      }),
    );
    await sleep(1000);
  }
  for (const [s, r] of Object.entries(rows)) {
    log('mirror', { sym: s, midMinusBybitPpm: stats(r.map((x) => x.midPpm)), byteSpreadPpm: stats(r.map((x) => x.spreadPpm)), bybitSpreadPpm: stats(r.map((x) => x.bybitSpreadPpm)) });
  }
}

const modes = { latency, catalog, perp, book, poll, mirror };
const arg = process.argv[2] ?? 'all';
for (const [name, fn] of Object.entries(modes)) {
  if (arg !== 'all' && arg !== name) continue;
  log('mode', { name, at: new Date().toISOString() });
  await fn();
}
