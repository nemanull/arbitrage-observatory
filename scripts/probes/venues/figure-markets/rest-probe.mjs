// Figure Markets public REST probe: host and latency, the market catalog, the wind-down flags, the REST book, the per market index price and how often it moves, errors, and clock offset.
// Public, unauthenticated, read-only. At most one request per second, well inside the gateway's unpublished per IP limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/figure-markets/rest-probe.mjs [catalog|book|poll|errors|time]
//   catalog  DNS, cold and warm timings on both hosts, market counts by type, status, location and quote, fees, last trades, CCXT check, wind-down config. About 10 s.
//   book     the order book call at each depth and level, level order, and whether two reads in a row are cached. About 5 s.
//   poll     GET /markets once a second for 60 s: reply time, and how often index, mid and best prices change per crypto market, then one Coinbase Exchange BTC-USD ticker read to compare the index. About 62 s.
//   errors   unknown symbol, bad parameters, unknown path, the page size cap. About 5 s.
//   time     clock offset from the order book timestamp over ten reads. About 6 s.
// Recorded in docs/profiles/figure-markets/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.figuremarkets.com/public/v1';
const LEGACY = 'https://www.figuremarkets.com/service-hft-exchange/api/v1';
const CONFIG = 'https://www.figuremarkets.com/exchange/api/config/current';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();

async function get(url, init) {
  const started = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - started);
  let body; try { body = JSON.parse(text); } catch { body = undefined; }
  return { status: res.status, ms, bytes: text.length, headers: Object.fromEntries(res.headers), body, text };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
};

async function modeCatalog() {
  for (const host of ['api.figuremarkets.com', 'www.figuremarkets.com']) {
    const a = await dns.resolve4(host).catch((e) => [String(e.code)]);
    log('dns', { host, a });
  }
  for (const [name, url] of [['api', `${API}/markets?size=50`], ['legacy', `${LEGACY}/markets?size=50`]]) {
    const times = [];
    let first;
    for (let i = 0; i < 5; i++) { const r = await get(url); times.push(r.ms); first ??= r; await sleep(300); }
    log('timing', { name, url, status: first.status, bytes: first.bytes, rows: first.body?.data?.length, coldMs: times[0], warmMs: times.slice(1), server: first.headers.server, rateHeaders: Object.keys(first.headers).filter((k) => /rate|limit|retry/i.test(k)) });
  }
  const { body } = await get(`${API}/markets?size=50`);
  const markets = body.data;
  const count = (f) => markets.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  log('catalog', {
    total: markets.length, pagination: body.pagination,
    byType: count((m) => m.marketType), byStatus: count((m) => m.status), byLocation: count((m) => (m.marketLocations ?? []).join('|')),
    cryptoByQuote: count((m) => (m.marketType === 'CRYPTO' ? m.quoteDenom : 'not crypto')),
  });
  for (const m of markets.filter((x) => x.marketType === 'CRYPTO')) {
    log('crypto_market', {
      symbol: m.symbol, displayName: m.displayName, denom: m.denom, quote: m.quoteDenom, status: m.status,
      taker: m.takerFee?.rate, maker: m.makerFee?.rate, minFeeNotional: m.takerFee?.minimumNotional, maxRate: m.takerFee?.maximumRate,
      tick: m.priceIncrement, step: m.sizeIncrement, minQty: m.minTradeQuantity, bid: m.bestBid, ask: m.bestAsk, index: m.indexPrice, exchangePrice: m.exchangePrice,
      trades24h: m.tradeCount24h, volume24h: Math.round(Number(m.volume24h)), baseVolume24h: m.baseVolume24h, requiredAttributes: m.requiredAttributes, locations: m.marketLocations, orderLimits: m.orderLimits, protectionBps: m.marketOrderProtectionBasisPoints,
    });
  }
  // The last match per market shows how recently each book traded.
  for (const sym of ['BTC-USD-2S', 'ETH-USD', 'XRP-USD', 'UNI-USD']) {
    const t = await get(`${API}/trades/${sym}?size=1`);
    const last = t.body?.matches?.[0];
    log('last_trade', { symbol: sym, status: t.status, keys: Object.keys(t.body ?? {}), created: last?.created, price: last?.price, quantity: last?.quantity, hasSettlementTx: Boolean(last?.settlementTxHash) });
    await sleep(300);
  }
  const other = markets.filter((x) => x.marketType !== 'CRYPTO').map((m) => `${m.symbol} ${m.marketType} taker ${m.takerFee?.rate ?? 'none'} index ${m.indexPrice}`);
  log('other_markets', { other });
  // No CCXT class exists for this venue in 4.5.68, so the catalog cannot come from loadMarkets.
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, matches: ccxt.exchanges.filter((e) => /figure|provenance/i.test(e)) });
  const cfg = await get(CONFIG);
  const b = cfg.body ?? {};
  log('config', { status: cfg.status, IS_TRADE_ENABLED: b.IS_TRADE_ENABLED, EXCHANGE_MAINTENANCE: b.EXCHANGE_MAINTENANCE, IS_TRADING_FEES_ENABLED: b.IS_TRADING_FEES_ENABLED, IS_WINDDOWN_ALERTS_ENABLED: b.IS_WINDDOWN_ALERTS_ENABLED, WINDDOWN_DATE: b.WINDDOWN_DATE });
}

async function modeBook() {
  const sym = 'BTC-USD-2S';
  for (const q of ['', '?depth=3', '?depth=0', '?level=1', '?level=3', '?level=2&depth=20']) {
    const r = await get(`${API}/markets/${sym}/orderbook${q}`);
    const b = r.body ?? {};
    const desc = (b.bids ?? []).every((l, i, a) => i === 0 || l.price < a[i - 1].price);
    const asc = (b.asks ?? []).every((l, i, a) => i === 0 || l.price > a[i - 1].price);
    log('book', { query: q || '(none)', status: r.status, ms: r.ms, bytes: r.bytes, bids: b.bids?.length, asks: b.asks?.length, bidsDescending: desc, asksAscending: asc, levelKeys: Object.keys(b.bids?.[0] ?? {}), top: { bid: b.bids?.[0], ask: b.asks?.[0] }, timestamp: b.timestamp, cacheHeaders: Object.fromEntries(Object.entries(r.headers).filter(([k]) => /cache|age|etag|expires/i.test(k))) });
    await sleep(300);
  }
  const stamps = [];
  for (let i = 0; i < 4; i++) { const r = await get(`${API}/markets/${sym}/orderbook`); stamps.push(r.body?.timestamp); }
  log('back_to_back', { timestamps: stamps, distinct: new Set(stamps).size });
  const legacy = await get(`${LEGACY}/markets/${sym}/orderbook`);
  log('legacy_book', { status: legacy.status, ms: legacy.ms, keys: Object.keys(legacy.body ?? {}), bids: legacy.body?.bids?.length, top: legacy.body?.bids?.[0] });
}

async function modePoll() {
  const seconds = Number(process.env.POLL_SECONDS ?? 60);
  const tracked = ['BTC-USD-2S', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'UNI-USD', 'LINK-USD', 'HASH-USD'];
  const prev = new Map();
  const changes = new Map(tracked.map((s) => [s, { index: 0, mid: 0, bid: 0, exchangePrice: 0, indexVsMidBps: [], exchangeEqualsIndex: 0 }]));
  const times = [];
  let polls = 0, failures = [], replyBytes = 0;
  for (let i = 0; i < seconds; i++) {
    const tick = Date.now();
    const r = await get(`${API}/markets?size=50&market_type=CRYPTO`).catch((e) => ({ status: 'err', ms: 0, error: String(e) }));
    polls++;
    times.push(r.ms);
    replyBytes = r.bytes ?? replyBytes;
    if (r.status !== 200) failures.push({ status: r.status, body: r.text?.slice(0, 200) });
    for (const m of r.body?.data ?? []) {
      if (!changes.has(m.symbol)) continue;
      const c = changes.get(m.symbol);
      const p = prev.get(m.symbol);
      if (p) {
        if (p.indexPrice !== m.indexPrice) c.index++;
        if (p.midMarketPrice !== m.midMarketPrice) c.mid++;
        if (p.bestBid !== m.bestBid) c.bid++;
        if (p.exchangePrice !== m.exchangePrice) c.exchangePrice++;
      }
      if (m.exchangePrice === m.indexPrice) c.exchangeEqualsIndex++;
      if (m.midMarketPrice && m.indexPrice) c.indexVsMidBps.push(Math.round((Number(m.indexPrice) / Number(m.midMarketPrice) - 1) * 1e5) / 10);
      prev.set(m.symbol, m);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  log('poll_timing', { polls, replyBytes, ...stats(times), over1s: times.filter((t) => t > 1000).length, failures });
  for (const [s, c] of changes) log('poll_changes', { symbol: s, polls, indexChanged: c.index, midChanged: c.mid, bidChanged: c.bid, exchangePriceChanged: c.exchangePrice, exchangePriceEqualsIndex: c.exchangeEqualsIndex, indexVsMidBps: c.indexVsMidBps.length ? stats(c.indexVsMidBps) : null });
  // One outside read of BTC-USD to see what the index follows. Coinbase Exchange public ticker, one request.
  const cb = await get('https://api.exchange.coinbase.com/products/BTC-USD/ticker', { headers: { 'User-Agent': 'probe' } }).catch(() => undefined);
  const fm = await get(`${API}/markets/BTC-USD-2S`);
  if (cb?.body && fm.body) {
    const cbMid = (Number(cb.body.bid) + Number(cb.body.ask)) / 2;
    log('index_vs_coinbase', { figureIndex: fm.body.indexPrice, figureMid: fm.body.midMarketPrice, coinbaseMid: cbMid, indexVsCoinbaseBps: Math.round((Number(fm.body.indexPrice) / cbMid - 1) * 1e5) / 10, midVsCoinbaseBps: Math.round((Number(fm.body.midMarketPrice) / cbMid - 1) * 1e5) / 10 });
  }
}

async function modeErrors() {
  const cases = [
    ['unknown_symbol', `${API}/markets/NOPE-USD`],
    ['unknown_symbol_book', `${API}/markets/NOPE-USD/orderbook`],
    ['bad_depth', `${API}/markets/BTC-USD-2S/orderbook?depth=abc`],
    ['bad_level', `${API}/markets/BTC-USD-2S/orderbook?level=9`],
    ['page_size_100', `${API}/markets?size=100`],
    ['page_size_default', `${API}/markets`],
    ['page_size_10', `${API}/markets?size=10`],
    ['unknown_path', `${API}/nope`],
    ['no_public_prefix', 'https://api.figuremarkets.com/v1/markets'],
    ['asset_price', `${API}/assets/BTC/price`],
  ];
  for (const [label, url] of cases) {
    const r = await get(url);
    const page = r.body?.pagination;
    log('err', { label, status: r.status, ms: r.ms, body: page ? { rows: r.body.data?.length, pagination: page } : r.text.slice(0, 260) });
    await sleep(300);
  }
}

async function modeTime() {
  const offsets = [];
  let rtts = [];
  for (let i = 0; i < 10; i++) {
    const sent = Date.now();
    const r = await get(`${API}/markets/BTC-USD-2S/orderbook?level=1`);
    const recv = Date.now();
    const ts = r.body?.timestamp;
    if (ts) offsets.push(Date.parse(ts) - (sent + recv) / 2);
    rtts.push(recv - sent);
    await sleep(500);
  }
  log('clock', { offsetMs: stats(offsets), rttMs: stats(rtts), note: 'server minus local at the request midpoint, from the order book timestamp' });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog: modeCatalog, book: modeBook, poll: modePoll, errors: modeErrors, time: modeTime };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, seconds: Math.round((Date.now() - t0) / 1000) });
