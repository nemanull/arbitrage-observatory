// Independent Reserve REST probe: host and latency, the spot catalog through CCXT, which listed pairs have a book, the REST book, caching, error shapes and the clock offset.
// Public, unauthenticated and read-only.
// No rate limit is published, and CCXT 4.5.68 spaces calls 1,000 ms apart, so every mode sends at most one request per second, apart from the one second cache test, which sends two.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/independentreserve/rest-probe.mjs [main|sweep|poll]
//   main   DNS, cold and warm request time, the catalog through CCXT, the book on three pairs, GetAllOrders, FX rates, errors and clock, about 40 s
//   sweep  GetMarketSummary for every pair CCXT lists, one per second, to count the pairs that trade, about 170 s
//   poll   30 rounds of GetOrderBook and GetMarketSummary on XBT/AUD one second apart, with cache and change counts, about 35 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/independentreserve/rest.md and docs/profiles/independentreserve/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.independentreserve.com/Public';
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
  const res = await fetch(`${API}/${path}`, { headers: { 'Accept-Encoding': 'gzip' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, body, headers: Object.fromEntries(res.headers), recv: Date.now() };
}

const pairQs = (b, q) => `primaryCurrencyCode=${b}&secondaryCurrencyCode=${q}`;

function bookStats(body) {
  const bids = body.BuyOrders ?? [];
  const asks = body.SellOrders ?? [];
  const dupes = (side) => side.length - new Set(side.map((o) => o.Price)).size;
  const desc = bids.every((o, i) => i === 0 || bids[i - 1].Price >= o.Price);
  const asc = asks.every((o, i) => i === 0 || asks[i - 1].Price <= o.Price);
  return {
    bidRows: bids.length,
    askRows: asks.length,
    bidPrices: bids.length - dupes(bids),
    askPrices: asks.length - dupes(asks),
    bidsDescending: desc,
    asksAscending: asc,
    bestBid: bids[0]?.Price,
    bestAsk: asks[0]?.Price,
    types: [...new Set([...bids, ...asks].map((o) => o.OrderType))],
    created: body.CreatedTimestampUtc,
  };
}

async function main() {
  for (const host of ['api.independentreserve.com', 'websockets.independentreserve.com', 'www.independentreserve.com']) {
    const a = await dns.resolve4(host).catch((e) => e.code);
    const c = await dns.resolveCname(host).catch((e) => e.code);
    log('dns', { host, a, cname: c });
  }

  const cold = await get('GetValidPrimaryCurrencyCodes');
  log('cold', { status: cold.status, ms: cold.ms, headers: cold.headers });
  const warm = [];
  for (let i = 0; i < 5; i++) {
    await sleep(1000);
    warm.push((await get('GetValidPrimaryCurrencyCodes')).ms);
  }
  log('warm', { ms: warm });

  await sleep(1000);
  const primaries = cold.body;
  const secondaries = (await get('GetValidSecondaryCurrencyCodes')).body;
  await sleep(1000);
  const mins = (await get('GetOrderMinimumVolumes')).body;
  log('currencies', { primaries: primaries.length, secondaries, minimumVolumes: Object.keys(mins).length, xbtMin: mins.Xbt });

  const ex = new ccxt.independentreserve();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const byQuote = {};
  for (const m of list) byQuote[m.quote] = (byQuote[m.quote] ?? 0) + 1;
  const btc = markets['BTC/AUD'];
  log('ccxt', {
    ms: Math.round(performance.now() - t0),
    markets: list.length,
    byQuote,
    types: [...new Set(list.map((m) => m.type))],
    swaps: list.filter((m) => m.swap).length,
    active: [...new Set(list.map((m) => String(m.active)))],
    contractSize: [...new Set(list.map((m) => String(m.contractSize)))],
    linear: [...new Set(list.map((m) => String(m.linear)))],
    btcAud: { id: btc.id, symbol: btc.symbol, baseId: btc.baseId, taker: btc.taker, maker: btc.maker, precision: btc.precision, minAmount: btc.limits.amount.min },
    takers: [...new Set(list.map((m) => m.taker))],
    makers: [...new Set(list.map((m) => m.maker))],
    renamed: list.filter((m) => m.base.toLowerCase() !== m.baseId.toLowerCase()).map((m) => `${m.baseId} to ${m.base}`).filter((v, i, a) => a.indexOf(v) === i),
  });

  for (const [b, q] of [['xbt', 'aud'], ['eth', 'usd'], ['zrx', 'nzd']]) {
    await sleep(1000);
    const r = await get(`GetOrderBook?${pairQs(b, q)}`);
    keep(`book-${b}-${q}.json`, r.text);
    log('book', { pair: `${b}/${q}`, status: r.status, ms: r.ms, bytes: r.bytes, ...bookStats(r.body), first: { bid: r.body.BuyOrders?.[0], ask: r.body.SellOrders?.[0] } });
  }

  await sleep(1000);
  const lim = await get(`GetOrderBook?${pairQs('xbt', 'aud')}&maxDepthVolume=1`);
  log('book_maxDepthVolume_1', { status: lim.status, ...bookStats(lim.body) });
  await sleep(1000);
  const all = await get(`GetAllOrders?${pairQs('xbt', 'aud')}`);
  keep('allorders-xbt-aud.json', all.text);
  log('allorders', { status: all.status, ms: all.ms, bytes: all.bytes, bids: all.body.BuyOrders?.length, asks: all.body.SellOrders?.length, first: all.body.BuyOrders?.[0], keys: Object.keys(all.body) });

  await sleep(1000);
  const aud = await get(`GetOrderBook?${pairQs('xbt', 'aud')}`);
  await sleep(1000);
  const usdBook = await get(`GetOrderBook?${pairQs('xbt', 'usd')}`);
  await sleep(1000);
  const fxNow = (await get('GetFxRates')).body;
  const rate = fxNow.find((r) => r.CurrencyCodeA === 'Aud' && r.CurrencyCodeB === 'Usd')?.Rate;
  const audByVol = new Map(aud.body.BuyOrders.map((o) => [o.Volume, o.Price]));
  const shared = usdBook.body.BuyOrders.filter((o) => audByVol.has(o.Volume));
  const ratios = shared.slice(0, 200).map((o) => o.Price / audByVol.get(o.Volume)).sort((a, b) => a - b);
  log('cross_currency_book', {
    audBids: aud.body.BuyOrders.length,
    usdBids: usdBook.body.BuyOrders.length,
    usdBidVolumesAlsoInAudBook: shared.length,
    usdOverAudPriceRatio: { min: ratios[0], median: ratios[ratios.length >> 1], max: ratios[ratios.length - 1] },
    fxAudUsd: rate,
    usdTop3: usdBook.body.BuyOrders.slice(0, 3).map((o) => [o.Price, o.Volume, audByVol.has(o.Volume) ? 'also in AUD book' : 'USD only']),
  });

  await sleep(1000);
  const fx = await get('GetFxRates');
  log('fx', { status: fx.status, ms: fx.ms, rows: fx.body.length, sample: fx.body.slice(0, 2) });

  await sleep(1000);
  const s = await get(`GetMarketSummary?${pairQs('xbt', 'aud')}`);
  const created = Date.parse(s.body.CreatedTimestampUtc);
  const dateHdr = Date.parse(s.headers.date);
  log('summary', { status: s.status, ms: s.ms, body: s.body });
  log('clock', { localRecvMinusCreatedMs: s.recv - created, localRecvMinusDateHeaderMs: s.recv - dateHdr, requestMs: s.ms });

  const errors = [
    `GetMarketSummary?${pairQs('nope', 'aud')}`,
    `GetMarketSummary?${pairQs('xbt', 'eur')}`,
    `GetMarketSummary?${pairQs('xbt', 'usdt')}`,
    'GetMarketSummary',
    `GetOrderBook?${pairQs('xbt', 'aud')}&maxDepthVolume=abc`,
    'GetNope',
  ];
  for (const path of errors) {
    await sleep(1000);
    const r = await get(path);
    log('error', { path, status: r.status, body: r.text.slice(0, 200), contentType: r.headers['content-type'] });
  }
  await sleep(1000);
  const post = await fetch(`${API}/GetValidPrimaryCurrencyCodes`, { method: 'POST' });
  log('error', { path: 'POST GetValidPrimaryCurrencyCodes', status: post.status, body: (await post.text()).slice(0, 200) });
}

async function sweep() {
  const ex = new ccxt.independentreserve();
  const markets = Object.values(await ex.loadMarkets());
  const fx = (await get('GetFxRates')).body;
  const toAud = (q) => (q === 'Aud' ? 1 : fx.find((r) => r.CurrencyCodeA === q && r.CurrencyCodeB === 'Aud')?.Rate);
  const rows = [];
  const t0 = Date.now();
  for (const m of markets) {
    const r = await get(`GetMarketSummary?${pairQs(m.baseId, m.quoteId)}`);
    const b = r.body ?? {};
    // DayVolumeXbt is the base's volume over every fiat, DayVolumeXbtInSecondaryCurrrency is the part traded in this pair's fiat, both in base units.
    const audNotional = (b.DayVolumeXbtInSecondaryCurrrency ?? 0) * (b.LastPrice ?? 0) * (toAud(m.quoteId) ?? NaN);
    rows.push({ id: m.id, status: r.status, ms: r.ms, bid: b.CurrentHighestBidPrice, ask: b.CurrentLowestOfferPrice, last: b.LastPrice, volAll: b.DayVolumeXbt, volHere: b.DayVolumeXbtInSecondaryCurrrency, audNotional, err: r.status === 200 ? undefined : r.text.slice(0, 120) });
    await sleep(Math.max(0, 1000 - r.ms));
  }
  keep('sweep.json', JSON.stringify(rows));
  const byQuote = {};
  for (const r of rows) {
    const q = r.id.split('/')[1];
    byQuote[q] ??= { listed: 0, ok: 0, twoSided: 0, crossed: 0, oneSidedOrEmpty: 0, tradedHere24h: 0, audNotional24h: 0 };
    const e = byQuote[q];
    e.listed++;
    if (r.status !== 200) continue;
    e.ok++;
    if (r.bid > 0 && r.ask > 0) e.twoSided++;
    else e.oneSidedOrEmpty++;
    if (r.bid > 0 && r.ask > 0 && r.bid >= r.ask) e.crossed++;
    if (r.volHere > 0) e.tradedHere24h++;
    e.audNotional24h += Number.isFinite(r.audNotional) ? r.audNotional : 0;
  }
  for (const e of Object.values(byQuote)) e.audNotional24h = Math.round(e.audNotional24h);
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  log('sweep', { requests: rows.length, seconds: Math.round((Date.now() - t0) / 1000), statuses: [...new Set(rows.map((r) => r.status))], medianMs: ms[ms.length >> 1], maxMs: ms[ms.length - 1], byQuote });
  const spreadPpm = (r) => Math.round(((r.ask - r.bid) / ((r.ask + r.bid) / 2)) * 1e6);
  const usd = rows.filter((r) => r.id.endsWith('/Usd') && r.bid > 0 && r.ask > 0);
  const sp = usd.map(spreadPpm).sort((a, b) => a - b);
  log('sweep_usd_spread_ppm', { count: usd.length, min: sp[0], median: sp[sp.length >> 1], max: sp[sp.length - 1], xbt: spreadPpm(usd.find((r) => r.id === 'Xbt/Usd')), eth: spreadPpm(usd.find((r) => r.id === 'Eth/Usd')) });
  const top = rows.filter((r) => r.status === 200).sort((a, b) => (b.audNotional || 0) - (a.audNotional || 0)).slice(0, 10).map((r) => `${r.id} ${Math.round(r.audNotional)} AUD`);
  log('sweep_top_by_aud_notional', { rows: top });
  const usdTop = usd.sort((a, b) => (b.audNotional || 0) - (a.audNotional || 0)).slice(0, 10).map((r) => `${r.id} ${Math.round(r.audNotional)} AUD, spread ${spreadPpm(r)} ppm`);
  log('sweep_usd_top_by_aud_notional', { rows: usdTop });
  const odd = rows.filter((r) => r.status !== 200).map((r) => `${r.id} ${r.status} ${r.err}`);
  log('sweep_errors', { count: odd.length, rows: odd.slice(0, 10) });
}

async function poll() {
  const book = [];
  const sum = [];
  for (let i = 0; i < 30; i++) {
    const a = await get(`GetOrderBook?${pairQs('xbt', 'aud')}`);
    book.push({ ms: a.ms, created: a.body.CreatedTimestampUtc, bid: a.body.BuyOrders?.[0]?.Price, ask: a.body.SellOrders?.[0]?.Price, recv: a.recv });
    const s = await get(`GetMarketSummary?${pairQs('xbt', 'aud')}`);
    sum.push({ ms: s.ms, created: s.body.CreatedTimestampUtc, bid: s.body.CurrentHighestBidPrice, ask: s.body.CurrentLowestOfferPrice, recv: s.recv });
    await sleep(1000);
  }
  const changes = (rows, k) => rows.filter((r, i) => i > 0 && r[k] !== rows[i - 1][k]).length;
  const stats = (rows) => {
    const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    const age = rows.map((r) => r.recv - Date.parse(r.created)).sort((a, b) => a - b);
    return { min: ms[0], median: ms[ms.length >> 1], p90: ms[Math.floor(ms.length * 0.9)], max: ms[ms.length - 1], createdChanges: changes(rows, 'created'), bidChanges: changes(rows, 'bid'), askChanges: changes(rows, 'ask'), ageMsMin: age[0], ageMsMedian: age[age.length >> 1], ageMsMax: age[age.length - 1] };
  };
  log('poll_book', stats(book));
  log('poll_summary', stats(sum));
  const a = await get(`GetOrderBook?${pairQs('eth', 'aud')}`);
  const b = await get(`GetOrderBook?${pairQs('eth', 'aud')}`);
  log('cache_same_second', { firstCreated: a.body.CreatedTimestampUtc, secondCreated: b.body.CreatedTimestampUtc, gapMs: b.recv - a.recv });
}

const mode = process.argv[2] ?? 'main';
const run = { main, sweep, poll }[mode];
if (!run) {
  console.error('mode must be main, sweep or poll');
  process.exit(1);
}
await run();
