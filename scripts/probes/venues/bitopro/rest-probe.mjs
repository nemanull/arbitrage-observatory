// BitoPro REST probe: host and latency, the spot catalog against CCXT 4.5.68, the fee tier table, the book call and its limits,
// error shapes, the OTC reference price, server time from the Date header, and one-second polls of the tickers and book calls.
// Public, unauthenticated, read-only. The documented public budget is 600 requests per minute per IP, and each mode stays under 150.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitopro/rest-probe.mjs [main|poll|pages]
//   main  DNS, cold and warm times, catalog, CCXT markets and fees, tier table, book limits and order, errors, OTC price, Date offset. About 20 s.
//   poll  60 polls one second apart of GET /tickers and GET /order-book/btc_usdt?limit=20, with time and change counts. About 65 s.
//   pages the fee and terms pages, the documentation README, and CoinGecko's exchange and derivatives lists, with the lines the profiles quote. About 5 s.
// Set PROBE_OUT_DIR to keep trimmed replies. Recorded in docs/profiles/bitopro/rest.md and fees.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.bitopro.com/v3';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const round = (x) => Math.round(x);
const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: pct(xs, 0), med: pct(xs, 50), p90: pct(xs, 90), max: pct(xs, 100) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = round(performance.now() - t0);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, text, body, ms, bytes: text.length };
}

function ordered(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (dir === 'desc' ? b >= a : b <= a) return false;
  }
  return true;
}

// `total` should be the running sum of `amount` from the touch outward.
function cumulative(levels) {
  let sum = 0;
  for (const l of levels) {
    sum += Number(l.amount);
    if (Math.abs(sum - Number(l.total)) > 1e-9 * Math.max(1, sum)) return false;
  }
  return true;
}

async function main() {
  for (const host of ['api.bitopro.com', 'stream.bitopro.com', 'www.bitopro.com']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }

  // Cold is the first request of this process, warm is the next four on the same keep-alive pool.
  for (const path of ['/provisioning/trading-pairs', '/tickers', '/order-book/btc_usdt?limit=20']) {
    const times = [];
    let first = null;
    for (let i = 0; i < 5; i++) {
      const r = await get(path);
      times.push(r.ms);
      if (i === 0) first = r;
      await sleep(200);
    }
    const h = {};
    for (const k of ['server', 'x-response-time', 'cache-control', 'age', 'via', 'x-cache', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining']) {
      const v = first.headers.get(k);
      if (v !== null) h[k] = v;
    }
    log('latency', { path, status: first.status, bytes: first.bytes, coldMs: times[0], warmMs: times.slice(1), headers: h, headerNames: [...first.headers.keys()] });
  }

  const pairs = await get('/provisioning/trading-pairs');
  keep('trading-pairs.json', pairs.text);
  const rows = pairs.body.data;
  const byQuote = {};
  for (const r of rows) byQuote[r.quote] = (byQuote[r.quote] ?? 0) + 1;
  log('catalog', {
    rows: rows.length,
    byQuote,
    maintain: rows.filter((r) => r.maintain).length,
    lowercaseIds: rows.filter((r) => r.pair === r.pair.toLowerCase()).length,
    keys: Object.keys(rows[0]),
    scaleLevels: [...new Set(rows.map((r) => r.orderBookQuoteScaleLevel))],
    amountPrecision: rows.reduce((acc, r) => ({ ...acc, [r.amountPrecision]: (acc[r.amountPrecision] ?? 0) + 1 }), {}),
    usdtPairs: rows.filter((r) => r.quote === 'usdt').map((r) => r.pair),
  });

  const tickers = await get('/tickers');
  const tickerIds = new Set(tickers.body.data.map((t) => t.pair));
  log('tickers', { rows: tickers.body.data.length, sameIdsAsCatalog: rows.every((r) => tickerIds.has(r.pair)), keys: Object.keys(tickers.body.data[0]) });

  const ex = new ccxt.bitopro();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const types = {};
  for (const m of all) types[m.type] = (types[m.type] ?? 0) + 1;
  const m = markets['BTC/USDT'];
  log('ccxt', {
    version: ccxt.version,
    markets: all.length,
    types,
    swaps: all.filter((x) => x.swap).length,
    active: all.filter((x) => x.active).length,
    idEqualsCatalog: all.every((x) => rows.some((r) => r.pair === x.id)),
    takers: [...new Set(all.map((x) => x.taker))],
    makers: [...new Set(all.map((x) => x.maker))],
    sample: { id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, type: m.type, linear: m.linear ?? null, contractSize: m.contractSize ?? null, active: m.active, taker: m.taker, maker: m.maker, precision: m.precision },
  });
  try {
    const fees = await ex.fetchTradingFees();
    const f = fees['BTC/USDT'];
    log('ccxt_fetchTradingFees', { symbols: Object.keys(fees).length, taker: f?.taker ?? null, maker: f?.maker ?? null, info: JSON.stringify(f?.info ?? null).slice(0, 200) });
  } catch (e) {
    log('ccxt_fetchTradingFees', { error: `${e.constructor.name}: ${e.message.slice(0, 200)}` });
  }

  const fees = await get('/provisioning/limitations-and-fees');
  keep('limitations-and-fees.json', fees.text);
  log('fee_keys', { status: fees.status, bytes: fees.bytes, keys: Object.keys(fees.body) });
  for (const t of fees.body.tradingFeeRate) {
    log('fee_tier', {
      rank: t.rank,
      twd: `${t.twdVolumeSymbol} ${t.twdVolume}`,
      rankCondition: t.rankCondition,
      bito: `${t.bitoAmountSymbol} ${t.bitoAmount}`,
      maker: t.makerFee,
      taker: t.takerFee,
      makerBito: t.makerBitoFee,
      takerBito: t.takerBitoFee,
      gridMaker: t.gridBotMakerFee,
      gridTaker: t.gridBotTakerFee,
      extra: Object.keys(t).filter((k) => !['rank', 'twdVolumeSymbol', 'twdVolume', 'bitoAmountSymbol', 'bitoAmount', 'makerFee', 'takerFee', 'makerBitoFee', 'takerBitoFee', 'rankCondition', 'gridBotMakerFee', 'gridBotTakerFee'].includes(k)),
    });
  }
  for (const k of Object.keys(fees.body)) {
    if (k === 'tradingFeeRate') continue;
    const v = fees.body[k];
    log('fee_section', { key: k, rows: Array.isArray(v) ? v.length : typeof v, first: JSON.stringify(Array.isArray(v) ? v[0] : v)?.slice(0, 300) });
  }

  // Book limits: documented 1, 5, 10, 20, 30, 50 with default 5. CCXT Pro accepts 100, 500 and 1000 too.
  for (const q of ['', '?limit=1', '?limit=5', '?limit=10', '?limit=20', '?limit=30', '?limit=50', '?limit=100', '?limit=7', '?limit=0', '?limit=1000']) {
    const r = await get('/order-book/btc_usdt' + q);
    const b = r.body ?? {};
    log('book_limit', {
      q: q || '(none)',
      status: r.status,
      ms: r.ms,
      bids: b.bids?.length,
      asks: b.asks?.length,
      bidsDesc: b.bids ? ordered(b.bids, 'desc') : null,
      asksAsc: b.asks ? ordered(b.asks, 'asc') : null,
      totalCumulative: b.bids ? cumulative(b.bids) && cumulative(b.asks) : null,
      keys: b ? Object.keys(b) : null,
      body: r.body?.bids ? undefined : r.text.slice(0, 200),
    });
    await sleep(150);
  }
  const top = await get('/order-book/btc_usdt?limit=1');
  keep('book-btc_usdt-limit1.json', top.text);
  log('book_top', { text: top.text.slice(0, 400) });

  // Scale groups prices into coarser buckets, up to orderBookQuoteScaleLevel.
  for (const q of ['?limit=5&scale=0', '?limit=5&scale=1', '?limit=5&scale=3', '?limit=5&scale=9']) {
    const r = await get('/order-book/btc_usdt' + q);
    log('book_scale', { q, status: r.status, bestBid: r.body?.bids?.[0]?.price, bestAsk: r.body?.asks?.[0]?.price, body: r.body?.bids ? undefined : r.text.slice(0, 200) });
    await sleep(150);
  }

  for (const path of ['/order-book/BTC_USDT?limit=5', '/order-book/nope_usdt', '/order-book/ton_usdt?limit=50', '/order-book/eth_btc?limit=50', '/tickers/nope_usdt', '/tickers/btc_usdt', '/nope', '/price/otc/usdt', '/price/otc/btc', '/price/otc/nope', '/trades/btc_usdt']) {
    const r = await get(path);
    const b = r.body;
    const brief = b?.bids ? { bids: b.bids.length, asks: b.asks.length, bestBid: b.bids[0]?.price, bestAsk: b.asks[0]?.price } : undefined;
    log('call', { path, status: r.status, ms: r.ms, bytes: r.bytes, brief, body: brief ? undefined : r.text.slice(0, 300) });
    await sleep(150);
  }

  // No server time call exists, CCXT marks fetchTime false, so the Date header gives the offset at one second resolution.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/tickers/btc_usdt');
    const t1 = Date.now();
    const server = Date.parse(r.headers.get('date'));
    offsets.push(server - (t0 + t1) / 2);
    await sleep(333);
  }
  log('date_offset', { offsetsMs: offsets.map(round), note: 'Date header has one second resolution' });
}

async function poll() {
  const tickMs = [];
  const bookMs = [];
  const respTime = [];
  let prevBook = null;
  let prevTick = null;
  let bookChanged = 0;
  let tickChanged = 0;
  let errors = 0;
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const [t, b] = await Promise.all([get('/tickers'), get('/order-book/btc_usdt?limit=20')]);
    if (t.status !== 200 || b.status !== 200) {
      errors++;
      log('poll_error', { i, tickers: t.status, book: b.status, body: (t.status !== 200 ? t.text : b.text).slice(0, 200) });
    } else {
      tickMs.push(t.ms);
      bookMs.push(b.ms);
      respTime.push(Number.parseInt(b.headers.get('x-response-time') ?? '-1', 10));
      const bk = JSON.stringify([b.body.bids, b.body.asks]);
      if (prevBook !== null && bk !== prevBook) bookChanged++;
      prevBook = bk;
      const tk = t.body.data.find((x) => x.pair === 'btc_usdt')?.lastPrice;
      if (prevTick !== null && tk !== prevTick) tickChanged++;
      prevTick = tk;
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log('poll', { tickersMs: stats(tickMs), bookMs: stats(bookMs), bookServerMs: stats(respTime), bookChangedOf59: bookChanged, btcUsdtLastChangedOf59: tickChanged, errors });
}

// The site is a Next.js app, and its page strings sit in the __NEXT_DATA__ i18n store.
async function i18n(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const store = m ? JSON.parse(m[1]).props.pageProps._nextI18Next.initialI18nStore['en-US'] : null;
  return { status: res.status, bytes: html.length, store };
}

async function pages() {
  const fees = await i18n('https://www.bitopro.com/ns/en-US/fees');
  log('fee_page', { status: fees.status, bytes: fees.bytes, BITODiscount: fees.store?.fees.BITODiscount, termList1: fees.store?.fees.termList[0], termList4: fees.store?.fees.termList[3], promo: [fees.store?.fees.wholeSiteMakerZeroFee, fees.store?.fees.gridBotPromotionFee], nav: [fees.store?.header.tradingSpot, fees.store?.header.tradingMargin, fees.store?.header.earn, fees.store?.header.grid_trading_bot] });
  const terms = await i18n('https://www.bitopro.com/ns/en-US/terms');
  log('terms_page', { status: terms.status, bytes: terms.bytes, versionDate: terms.store?.terms.versionDate, chapter1Section1Article5: terms.store?.terms.section1.subSection1.list['5'], chapter10: terms.store?.terms.section10.subSection1.list['1']?.slice(0, 200) });
  const readme = await fetch('https://raw.githubusercontent.com/bitoex/bitopro-offical-api-docs/master/README.md');
  const text = await readme.text();
  log('docs_readme', { status: readme.status, bytes: text.length, endpointLines: text.split('\n').filter((l) => /hosted at|base endpoint|requests per minute/.test(l)) });
  const cg = await fetch('https://api.coingecko.com/api/v3/exchanges/bitopro');
  const ex = await cg.json();
  log('coingecko_exchange', { status: cg.status, name: ex.name, country: ex.country, year: ex.year_established, trustScore: ex.trust_score, trustScoreRank: ex.trust_score_rank, volume24hBtc: ex.trade_volume_24h_btc });
  // The public CoinGecko API throttles a shared IP with a plain text reply, so the list is parsed only when it is JSON.
  await sleep(3000);
  const dv = await fetch('https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=500');
  const raw = await dv.text();
  let list = null;
  try {
    list = JSON.parse(raw);
  } catch {
    list = null;
  }
  log('coingecko_derivatives', { status: dv.status, venues: Array.isArray(list) ? list.length : null, bitoMatches: Array.isArray(list) ? list.filter((v) => /bito/i.test(`${v.id} ${v.name}`)).map((v) => v.id) : null, body: Array.isArray(list) ? undefined : raw.slice(0, 80) });
}

const mode = process.argv[2] ?? 'main';
log('start', { mode, at: new Date().toISOString() });
await ({ main, poll, pages }[mode])();
log('end', { at: new Date().toISOString() });
