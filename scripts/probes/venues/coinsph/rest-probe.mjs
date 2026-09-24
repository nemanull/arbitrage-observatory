// Coins.ph REST probe: host and latency, the spot catalog and how CCXT maps it, the absence of perpetuals, the REST book, rate limit headers, errors and the clock offset.
// Public, unauthenticated, read-only. Every call is spaced by at least SPACING_MS, far inside the published 120 requests per minute per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coinsph/rest-probe.mjs [catalog|book|errors|time|all]
//   catalog  DNS, cold and warm latency, exchangeInfo by status and quote, CCXT 4.5.68 loadMarkets, the pairs call, and the web app's futures catalog. About 30 s.
//   book     depth at every limit, level order, repeat reads for caching, bookTicker and 24hr bulk replies, avgPrice. About 40 s.
//   errors   unknown symbol, bad limit, missing parameter, unknown path, and the weight header. About 10 s.
//   time     server time against the local clock over 10 reads. About 12 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/coinsph/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.pro.coins.ph';
const WEB_PH = 'https://www.coins.ph';
const WEB_XYZ = 'https://www.coins.xyz';
const SPACING_MS = 1_000;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

let lastCall = 0;
async function get(url, { headers = {} } = {}) {
  const wait = lastCall + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const sentAt = Date.now();
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const doneAt = Date.now();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const h = {};
  for (const k of ['x-sapi-used-ip-weight-1m', 'retry-after', 'cf-cache-status', 'cf-ray', 'age', 'cache-control', 'content-encoding']) {
    if (res.headers.get(k) !== null) h[k] = res.headers.get(k);
  }
  return { status: res.status, ms, sentAt, doneAt, bytes: text.length, text, json, headers: h };
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

async function catalog() {
  for (const host of ['api.pro.coins.ph', 'wsapi.pro.coins.ph', 'www.coins.ph']) {
    const v4 = await dns.resolve4(host).catch((e) => [e.code]);
    const cname = await dns.resolveCname(host).catch(() => []);
    log('dns', { host, v4, cname });
  }

  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${API}/openapi/v1/ping`);
    times.push(r.ms);
    if (i === 0) log('ping_first', { status: r.status, ms: r.ms, body: r.text, headers: r.headers });
  }
  log('ping_latency', { first: times[0], warm: times.slice(1), warmMedian: median(times.slice(1)) });

  const ei = await get(`${API}/openapi/v1/exchangeInfo`);
  keep('exchangeInfo.json', ei.text);
  const syms = ei.json.symbols;
  const byStatus = {};
  const byStatusQuote = {};
  const filters = {};
  for (const s of syms) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    const k = `${s.status} ${s.quoteAsset}`;
    byStatusQuote[k] = (byStatusQuote[k] ?? 0) + 1;
    for (const f of s.filters) filters[f.filterType] = (filters[f.filterType] ?? 0) + 1;
  }
  log('exchangeInfo', {
    status: ei.status,
    ms: ei.ms,
    bytes: ei.bytes,
    headers: ei.headers,
    keys: Object.keys(ei.json),
    timezone: ei.json.timezone,
    exchangeFilters: ei.json.exchangeFilters,
    symbols: syms.length,
    byStatus,
    byStatusQuote,
    filters,
    symbolKeys: Object.keys(syms[0]),
  });
  const btc = syms.find((s) => s.symbol === 'BTCPHP');
  log('exchangeInfo_BTCPHP', { symbol: btc.symbol, status: btc.status, base: btc.baseAsset, quote: btc.quoteAsset, filters: btc.filters.map((f) => f.filterType) });
  const pctIndex = syms.filter((s) => s.filters.some((f) => f.filterType === 'PERCENT_PRICE_INDEX'));
  log('percent_price_index_filter', { symbols: pctIndex.length });

  const pairs = await get(`${API}/openapi/v1/pairs`);
  keep('pairs.json', pairs.text);
  log('pairs', { status: pairs.status, ms: pairs.ms, bytes: pairs.bytes, rows: Array.isArray(pairs.json) ? pairs.json.length : null, first: Array.isArray(pairs.json) ? pairs.json[0] : pairs.text.slice(0, 200) });

  const ex = new ccxt.coinsph({ enableRateLimit: true });
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const types = {};
  for (const m of list) types[`${m.type} active=${m.active}`] = (types[`${m.type} active=${m.active}`] ?? 0) + 1;
  const m = markets['BTC/PHP'];
  log('ccxt_loadMarkets', {
    version: ccxt.version,
    ms: Math.round(performance.now() - t0),
    markets: list.length,
    types,
    swaps: list.filter((x) => x.swap === true).length,
    has: { swap: ex.has.swap, future: ex.has.future, fetchFundingRates: ex.has.fetchFundingRates ?? null, watchOrderBook: ex.has.watchOrderBook ?? null, ws: ex.has.ws ?? null },
    btcphp: { id: m.id, symbol: m.symbol, type: m.type, spot: m.spot, linear: String(m.linear), contractSize: String(m.contractSize), active: m.active, taker: String(m.taker), maker: String(m.maker) },
    feesTrading: { taker: ex.fees.trading.taker, maker: ex.fees.trading.maker, tierBased: ex.fees.trading.tierBased },
    idEqualsExchangeSymbol: list.filter((x) => syms.some((s) => s.symbol === x.id)).length,
    takerValues: [...new Set(list.map((x) => String(x.taker)))],
  });
  const dupPairs = {};
  for (const x of list) dupPairs[`${x.base}/${x.quote}`] = (dupPairs[`${x.base}/${x.quote}`] ?? 0) + 1;
  log('ccxt_pairs_listed_twice', { count: Object.values(dupPairs).filter((n) => n > 1).length });

  for (const [name, base] of [['coins.ph', WEB_PH], ['coins.xyz', WEB_XYZ]]) {
    const fut = await get(`${base}/future-api/v1/public/config/exchange-info`, { headers: { 'user-agent': 'Mozilla/5.0' } });
    const d = fut.json?.data;
    log('web_futures_catalog', { site: name, status: fut.status, ms: fut.ms, bytes: fut.bytes, symbols: d?.symbolList?.length ?? null, ids: (d?.symbolList ?? []).map((s) => `${s.symbolId}:${s.settleToken ?? ''}`) });
    const fee = await get(`${base}/future-api/v1/public/fee/user-level`, { headers: { 'user-agent': 'Mozilla/5.0' } });
    log('web_futures_fee', { site: name, status: fee.status, body: fee.text.slice(0, 300) });
  }
  const spotFee = await get(`${WEB_PH}/biz-api/v1/public/spot/user-level`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  keep('spot-user-level.json', spotFee.text);
  log('web_spot_fee', {
    status: spotFee.status,
    tiers: (spotFee.json?.data ?? []).map((r) => `${r.levelName} ${r.conditions?.[0]?.[0]?.minValue ?? 0} ${r.conditions?.[0]?.[0]?.tokenId ?? ''} maker ${r.spotBuyMakerDiscount} taker ${r.spotBuyTakerDiscount}`),
  });
}

function orderCheck(levels, side) {
  let ok = true;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (side === 'bids' ? !(a > b) : !(a < b)) ok = false;
  }
  return ok;
}

async function book() {
  for (const limit of [undefined, 5, 20, 50, 100, 200, 201, 500, 0]) {
    const q = limit === undefined ? '' : `&limit=${limit}`;
    const r = await get(`${API}/openapi/quote/v1/depth?symbol=BTCPHP${q}`);
    const j = r.json;
    log('depth', {
      limit: limit ?? 'default',
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      weight: r.headers['x-sapi-used-ip-weight-1m'],
      bids: j?.bids?.length,
      asks: j?.asks?.length,
      bidsDescending: j?.bids ? orderCheck(j.bids, 'bids') : null,
      asksAscending: j?.asks ? orderCheck(j.asks, 'asks') : null,
      lastUpdateId: j?.lastUpdateId,
      lastUpdateIdType: typeof j?.lastUpdateId,
      err: j?.code !== undefined ? j : undefined,
    });
  }
  const first = await get(`${API}/openapi/quote/v1/depth?symbol=BTCPHP&limit=5`);
  keep('depth-BTCPHP-5.json', first.text);
  log('depth_sample', { top: { bid: first.json.bids[0], ask: first.json.asks[0] }, keys: Object.keys(first.json) });

  const ids = [];
  for (let i = 0; i < 8; i++) {
    const r = await get(`${API}/openapi/quote/v1/depth?symbol=BTCUSDT&limit=20`);
    ids.push({ ms: r.ms, id: r.json.lastUpdateId, bid: r.json.bids[0]?.[0], ask: r.json.asks[0]?.[0], cf: r.headers['cf-cache-status'] });
  }
  log('depth_repeat_BTCUSDT', { reads: ids, distinctIds: new Set(ids.map((x) => x.id)).size, medianMs: median(ids.map((x) => x.ms)) });

  const ei = await get(`${API}/openapi/v1/exchangeInfo`);
  const catalogSyms = new Set(ei.json.symbols.map((x) => x.symbol));
  const tradingSyms = new Set(ei.json.symbols.filter((x) => x.status === 'trading').map((x) => x.symbol));
  for (const path of ['ticker/bookTicker', 'ticker/24hr', 'ticker/price']) {
    const r = await get(`${API}/openapi/quote/v1/${path}`);
    keep(`${path.replace('/', '-')}.json`, r.text);
    const rows = Array.isArray(r.json) ? r.json : [];
    log('bulk', {
      path,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      weight: r.headers['x-sapi-used-ip-weight-1m'],
      rows: rows.length,
      keys: rows[0] ? Object.keys(rows[0]) : null,
      indexLikeKeys: rows[0] ? Object.keys(rows[0]).filter((k) => /index|mark|fund/i.test(k)) : null,
      emptyBook: rows.filter((x) => x.bidPrice !== undefined && (Number(x.bidPrice) === 0 || Number(x.askPrice) === 0)).length,
      distinctSymbols: new Set(rows.map((x) => x.symbol)).size,
      notInCatalog: new Set(rows.filter((x) => !catalogSyms.has(x.symbol)).map((x) => x.symbol)).size,
      tradingPresent: new Set(rows.filter((x) => tradingSyms.has(x.symbol)).map((x) => x.symbol)).size,
      tradingOneSidedOrEmpty: new Set(rows.filter((x) => tradingSyms.has(x.symbol) && x.bidPrice !== undefined && (Number(x.bidPrice) === 0 || Number(x.askPrice) === 0)).map((x) => x.symbol)).size,
      duplicatedSymbols: [...new Set(rows.map((x) => x.symbol).filter((x, i, a) => a.indexOf(x) !== i))].slice(0, 5),
    });
  }
  const avg = await get(`${API}/openapi/quote/v1/avgPrice?symbol=BTCPHP`);
  log('avgPrice', { status: avg.status, ms: avg.ms, body: avg.text });

  const sym = await get(`${API}/openapi/quote/v1/depth?symbol=btcphp&limit=5`);
  log('depth_lowercase_symbol', { status: sym.status, body: sym.text.slice(0, 160) });
}

async function errors() {
  const cases = [
    ['unknown symbol', `${API}/openapi/quote/v1/depth?symbol=NOPEPHP`],
    ['missing symbol', `${API}/openapi/quote/v1/depth`],
    ['bad limit', `${API}/openapi/quote/v1/depth?symbol=BTCPHP&limit=abc`],
    ['break symbol', null],
    ['unknown path', `${API}/openapi/quote/v1/nope`],
    ['unknown symbol bookTicker', `${API}/openapi/quote/v1/ticker/bookTicker?symbol=NOPEPHP`],
    ['private without key', `${API}/openapi/v1/account`],
  ];
  let breakSymbol;
  for (const [name, url0] of cases) {
    let url = url0;
    if (name === 'break symbol') {
      const ei = await get(`${API}/openapi/v1/exchangeInfo?symbol=ETHPHP`);
      log('exchangeInfo_one_symbol', { status: ei.status, bytes: ei.bytes, symbols: ei.json?.symbols?.length });
      const all = await get(`${API}/openapi/v1/exchangeInfo`);
      breakSymbol = all.json.symbols.find((s) => s.status === 'break')?.symbol;
      url = `${API}/openapi/quote/v1/depth?symbol=${breakSymbol}&limit=5`;
    }
    const r = await get(url);
    log('error_case', { name, symbol: name === 'break symbol' ? breakSymbol : undefined, status: r.status, ms: r.ms, headers: r.headers, body: r.text.slice(0, 240) });
  }
}

async function time() {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${API}/openapi/v1/time`);
    const mid = (r.sentAt + r.doneAt) / 2;
    rows.push({ rtt: r.doneAt - r.sentAt, offset: Math.round(r.json.serverTime - mid), weight: r.headers['x-sapi-used-ip-weight-1m'] });
  }
  log('time', { weights: rows.map((x) => x.weight), offsets: rows.map((x) => x.offset), rtts: rows.map((x) => x.rtt), medianOffset: median(rows.map((x) => x.offset)), medianRtt: median(rows.map((x) => x.rtt)) });
}

const mode = process.argv[2] ?? 'all';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'catalog' || mode === 'all') await catalog();
if (mode === 'book' || mode === 'all') await book();
if (mode === 'errors' || mode === 'all') await errors();
if (mode === 'time' || mode === 'all') await time();
log('end', { at: new Date().toISOString() });
