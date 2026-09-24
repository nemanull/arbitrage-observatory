// BTC Trade UA public REST probe: host and latency, clock offset, spot catalog from the ticker, the per side order lists that serve as the book, the edge cache in front of them, and a CCXT class check.
// Public, unauthenticated, read-only. Every call is a GET on btc-trade.com.ua, plus one Kraken ticker read in depth mode for a price reference, with pauses between calls.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btc-trade-ua/rest-probe.mjs [catalog|depth|poll]
//   catalog  DNS, cold and warm time, Date header offset, ticker for every pair, the pair list of the trading page, deals, candles, market_prices, unknown pairs, CCXT class check. About 25 s.
//   depth    trades/buy and trades/sell on five pairs, level order and duplicates, cache headers, two reads 300 ms apart, the ask and bid calculators, a Kraken reference. About 20 s.
//   poll     30 rounds 2 s apart of ticker/btc_uah and trades/sell/btc_uah, with status, time, cache headers and whether the reply changed. About 70 s.
// Trade participant names in the deals reply are never printed. Recorded in docs/profiles/btc-trade-ua/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const API = 'https://btc-trade.com.ua';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

async function get(path, { timeoutMs = 15000, base = API } = {}) {
  const t = performance.now();
  const sentAt = Date.now();
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, ms: Math.round(performance.now() - t), sentAt, doneAt: Date.now(), headers: r.headers, text, json };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t), sentAt, doneAt: Date.now(), error: e.name + ': ' + e.message, text: '', json: null, headers: new Headers() };
  }
}

const cacheHeaders = (h) => ({
  cacheControl: h.get('cache-control'),
  ggStatus: h.get('x-gg-cache-status'),
  ggDate: h.get('x-gg-cache-date'),
  upstream: h.get('x-upstream'),
  etag: h.get('etag'),
  retryAfter: h.get('retry-after'),
});

const tally = (arr, key) => arr.reduce((m, x) => { const k = key(x); m[k] = (m[k] || 0) + 1; return m; }, {});

async function catalog() {
  for (const host of ['btc-trade.com.ua', 'www.btc-trade.com.ua', 'api.btc-trade.com.ua', 'btc-trade.app']) {
    try {
      const addrs = await lookup(host, { all: true });
      log('dns', { host, addrs: addrs.map((a) => a.address) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const times = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/api/ticker/btc_uah');
    times.push(r.ms);
    const serverMs = Date.parse(r.headers.get('date'));
    log('clock', { i, status: r.status, ms: r.ms, dateHeader: r.headers.get('date'), offsetS: Math.round((serverMs - (r.sentAt + r.doneAt) / 2) / 1000) });
    await sleep(1000);
  }
  log('ticker_pair_latency', { coldMs: times[0], warmMs: times.slice(1) });

  const one = await get('/api/ticker/btc_uah');
  log('ticker_one', { status: one.status, bytes: one.text.length, topKeys: one.json && Object.keys(one.json), ...cacheHeaders(one.headers) });
  await sleep(1000);

  const all = await get('/api/ticker');
  const pairs = Object.entries(all.json ?? {});
  const now = Date.now() / 1000;
  log('ticker_all', {
    status: all.status, ms: all.ms, bytes: all.text.length, ...cacheHeaders(all.headers),
    count: pairs.length,
    fieldKeys: pairs.length ? Object.keys(pairs[0][1]) : [],
    quoteTally: tally(pairs, ([, t]) => t.currency_base),
    updatedAgeS: [...new Set(pairs.map(([, t]) => Math.round(now - t.updated)))],
    usdRate: [...new Set(pairs.map(([, t]) => t.usd_rate))],
    tradedIn24h: pairs.filter(([, t]) => Number(t.vol) > 0).map(([k, t]) => `${k}:vol=${Number(t.vol)}:vol_cur=${Number(t.vol_cur)}`),
    zeroBid: pairs.filter(([, t]) => Number(t.buy) === 0).map(([k]) => k),
    usdtPairs: pairs.filter(([, t]) => t.currency_base === 'USDT').map(([k, t]) => `${k}:bid=${Number(t.buy)}:ask=${Number(t.sell)}:spreadPpm=${Math.round((t.sell / t.buy - 1) * 1e6)}:vol=${Number(t.vol)}`),
    derivativeWords: all.text.match(/perp|swap|futur|contract|funding|mark|index/gi) ?? [],
  });
  const usdtUah = all.json?.usdt_uah;
  const btcUah = all.json?.btc_uah;
  if (usdtUah && btcUah) {
    log('implied_btc_usdt', { btcUahBid: Number(btcUah.buy), usdtUahAsk: Number(usdtUah.sell), usdtUahBid: Number(usdtUah.buy), impliedMid: Math.round((Number(btcUah.buy) + Number(btcUah.sell)) / (Number(usdtUah.buy) + Number(usdtUah.sell))) });
  }
  await sleep(1000);

  const stock = await get('/stock');
  const stockPairs = [...new Set([...stock.text.matchAll(/"\/stock\/([a-z0-9]+_[a-z0-9]+)"/g)].map((m) => m[1]))];
  const tickerKeys = new Set(pairs.map(([k]) => k));
  log('stock_page', {
    status: stock.status, bytes: stock.text.length, pairLinks: stockPairs.length,
    notInTicker: stockPairs.filter((p) => !tickerKeys.has(p)),
    tickerNotLinked: [...tickerKeys].filter((p) => !stockPairs.includes(p)),
    derivativeWords: stock.text.match(/perpetual|futures|фьючерс|ф'ючерс|леверидж|плеч[оа]/gi) ?? [],
  });
  await sleep(1000);

  const deals = await get('/api/deals/btc_uah');
  const d = Array.isArray(deals.json) ? deals.json : [];
  log('deals', {
    status: deals.status, ms: deals.ms, bytes: deals.text.length, ...cacheHeaders(deals.headers), count: d.length,
    keys: d.length ? Object.keys(d[0]) : [],
    newest: d.length ? new Date(Math.max(...d.map((x) => x.unixtime)) * 1000).toISOString() : null,
    oldest: d.length ? new Date(Math.min(...d.map((x) => x.unixtime)) * 1000).toISOString() : null,
    sample: d.slice(0, 2).map(({ user, ...rest }) => ({ ...rest, user: user === undefined ? undefined : '<redacted>' })),
    typeTally: tally(d, (x) => x.type),
  });
  await sleep(1000);

  const japan = await get('/api/japan_stat/high/btc_uah');
  const trades = japan.json?.trades;
  log('japan_stat', {
    status: japan.status, ms: japan.ms, bytes: japan.text.length, topKeys: japan.json && Object.keys(japan.json),
    candles: Array.isArray(trades) ? trades.length : null,
    lastCandle: Array.isArray(trades) ? trades[trades.length - 1] : null,
    lastCandleUtc: Array.isArray(trades) && trades.length ? new Date(trades[trades.length - 1][0]).toISOString() : null,
  });
  await sleep(1000);

  for (let i = 0; i < 2; i++) {
    const mp = await get('/api/market_prices');
    log('market_prices', { i, status: mp.status, ms: mp.ms, bytes: mp.text.length, body: mp.text.slice(0, 160), ...cacheHeaders(mp.headers) });
    await sleep(1500);
  }

  for (const path of ['/api/trades/buy/nope_uah', '/api/ticker/nope_uah', '/api/deals/nope_uah', '/api/nope', '/api/trades/buy/BTC_UAH']) {
    const r = await get(path);
    log('unknown', { path, status: r.status, ms: r.ms, contentType: r.headers.get('content-type'), body: r.text.slice(0, 160).replace(/\s+/g, ' ') });
    await sleep(1000);
  }

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, hasBtctradeua: ccxt.exchanges.includes('btctradeua'), nameMatches: ccxt.exchanges.filter((x) => /btctrade|trade.?ua/i.test(x)) });
}

function sideStats(json, side) {
  const list = Array.isArray(json?.list) ? json.list : [];
  const p = list.map((x) => Number(x.price));
  let down = 0, up = 0, equal = 0;
  for (let i = 1; i < p.length; i++) {
    if (p[i] < p[i - 1]) down++;
    else if (p[i] > p[i - 1]) up++;
    else equal++;
  }
  const distinct = new Set(p).size;
  return {
    side, entries: list.length, distinctPrices: distinct, down, up, equal,
    head: json && Object.fromEntries(Object.entries(json).filter(([k]) => k !== 'list')),
    first3: list.slice(0, 3), last: list[list.length - 1],
    sizeCheck: list.slice(0, 5).map((x) => Math.round((Number(x.price) * Number(x.currency_trade) / Number(x.currency_base) - 1) * 1e6)),
  };
}

async function depth() {
  for (const pair of ['btc_uah', 'usdt_uah', 'eth_uah', 'btc_usdt', 'sol_usdt']) {
    for (const side of ['buy', 'sell']) {
      const r = await get(`/api/trades/${side}/${pair}`);
      log('book_side', { pair, status: r.status, ms: r.ms, bytes: r.text.length, ...cacheHeaders(r.headers), ...sideStats(r.json, side) });
      await sleep(800);
    }
  }

  const a = await get('/api/trades/buy/btc_uah');
  await sleep(300);
  const b = await get('/api/trades/buy/btc_uah');
  log('two_reads', {
    gapMs: b.sentAt - a.sentAt, sameBody: a.text === b.text,
    a: { status: a.status, ms: a.ms, ...cacheHeaders(a.headers), hash: hash(a.text) },
    b: { status: b.status, ms: b.ms, ...cacheHeaders(b.headers), hash: hash(b.text) },
  });
  await sleep(1000);

  const t = await get('/api/ticker/btc_uah');
  const bs = await get('/api/trades/buy/btc_uah');
  const ss = await get('/api/trades/sell/btc_uah');
  log('ticker_vs_book', {
    tickerBid: t.json?.btc_uah?.buy, tickerAsk: t.json?.btc_uah?.sell, tickerUpdated: t.json?.btc_uah?.updated && new Date(t.json.btc_uah.updated * 1000).toISOString(),
    tickerCache: cacheHeaders(t.headers),
    bookBid: bs.json?.list?.[0]?.price, bookBidMax: bs.json?.max_price, bookAsk: ss.json?.list?.[0]?.price, bookAskMin: ss.json?.min_price,
  });
  await sleep(1000);

  for (const [kind, path] of [['ask', '/api/ask/btc_uah?is_api=1&amount=0.01'], ['bid', '/api/bid/btc_uah?is_api=1&amount=0.01']]) {
    const r = await get(path);
    const j = r.json ?? {};
    log('calculator', { kind, status: r.status, ms: r.ms, keys: Object.keys(j), status_: j.status, start: j.start_price, avg: j.avarage_price, end: j.end_price, orders: Array.isArray(j.orders) ? j.orders.length : null, firstOrder: Array.isArray(j.orders) ? j.orders[0] : null, ...cacheHeaders(r.headers) });
    await sleep(1000);
  }

  const k = await get('/0/public/Ticker?pair=XBTUSDT', { base: 'https://api.kraken.com' });
  const kr = k.json?.result && Object.values(k.json.result)[0];
  log('kraken_reference', { status: k.status, bid: kr?.b?.[0], ask: kr?.a?.[0] });
}

async function poll() {
  const rows = [];
  let prevTicker = '', prevSell = '';
  for (let i = 0; i < 30; i++) {
    const t = await get('/api/ticker/btc_uah');
    const s = await get('/api/trades/sell/btc_uah');
    const row = {
      i,
      tStatus: t.status, tMs: t.ms, tGg: t.headers.get('x-gg-cache-status'), tGgDate: t.headers.get('x-gg-cache-date'), tUpdated: t.json?.btc_uah?.updated, tChanged: t.text !== prevTicker,
      sStatus: s.status, sMs: s.ms, sGg: s.headers.get('x-gg-cache-status'), sGgDate: s.headers.get('x-gg-cache-date'), sChanged: s.text !== prevSell, sTop: s.json?.list?.[0]?.price, sEntries: s.json?.list?.length,
      retryAfter: t.headers.get('retry-after') ?? s.headers.get('retry-after'),
    };
    prevTicker = t.text;
    prevSell = s.text;
    rows.push(row);
    log('poll', row);
    await sleep(2000);
  }
  const ms = (k) => rows.map((r) => r[k]).sort((a, b) => a - b);
  const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  const tm = ms('tMs');
  const sm = ms('sMs');
  log('poll_summary', {
    rounds: rows.length,
    statusTally: tally(rows.flatMap((r) => [r.tStatus, r.sStatus]), String),
    tickerMs: { min: tm[0], median: pct(tm, 0.5), p90: pct(tm, 0.9), max: tm[tm.length - 1] },
    sellMs: { min: sm[0], median: pct(sm, 0.5), p90: pct(sm, 0.9), max: sm[sm.length - 1] },
    tickerChanged: rows.slice(1).filter((r) => r.tChanged).length,
    tickerDistinctUpdated: new Set(rows.map((r) => r.tUpdated)).size,
    tickerDistinctGgDate: new Set(rows.map((r) => r.tGgDate)).size,
    tickerGgTally: tally(rows, (r) => String(r.tGg)),
    sellChanged: rows.slice(1).filter((r) => r.sChanged).length,
    sellDistinctGgDate: new Set(rows.map((r) => r.sGgDate)).size,
    sellGgTally: tally(rows, (r) => String(r.sGg)),
    sellTopDistinct: [...new Set(rows.map((r) => r.sTop))],
  });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, depth, poll };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, expected one of ${Object.keys(modes).join(', ')}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
