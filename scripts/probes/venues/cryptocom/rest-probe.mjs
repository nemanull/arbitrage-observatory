// Crypto.com Exchange REST probe: host and latency, the perpetual catalog and how CCXT maps it, the REST book, errors and headers, anchor cadence, one full anchor round, the index baskets.
// Public, unauthenticated, read-only. Every call stays far below the published 100 requests per second per method per IP.
// Run from server/: node ../scripts/probes/venues/cryptocom/rest-probe.mjs [main|anchor|round|baskets]
//   main     DNS, cold and warm latency, catalog counts, CCXT loadMarkets mapping, REST book depth and order, error replies, headers, clock. About 20 s.
//   anchor   60 one second polls of get-valuations (mark, index, funding, estimated funding) on four perpetuals, plus 30 settled funding rates. About 65 s, 16 requests per second.
//   round    one get-valuations mark_price call for every active perpetual at 40 requests per second, as a REST anchor round would. About 10 s.
//   baskets  downloads the published index constituent PDF, converts it with pdftotext, and classifies every perpetual's basket. Needs pdftotext on PATH.
// Recorded in docs/profiles/cryptocom/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.crypto.com/exchange/v1';
const INDEX_PDF = 'https://static2.crypto.com/exchange/assets/documents/Exchange%20-%20Index%20Constituent.pdf';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

async function get(path, { raw = false } = {}) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${path}`, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, ms, bytes: text.length, headers: Object.fromEntries(res.headers), body: raw ? text : body, arrivedAt: Date.now() };
}

const count = (arr, f) => arr.reduce((o, x) => { const k = f(x); o[k] = (o[k] ?? 0) + 1; return o; }, {});

async function main() {
  for (const host of ['api.crypto.com', 'stream.crypto.com', 'static2.crypto.com']) {
    const a = await dns.resolve4(host).catch((e) => e.code);
    const c = await dns.resolveCname(host).catch((e) => e.code);
    log('dns', { host, a, cname: c });
  }

  // Cold then five warm requests per call, on one kept connection.
  const calls = [
    'public/get-instruments',
    'public/get-tickers',
    'public/get-book?instrument_name=BTCUSD-PERP&depth=50',
    'public/get-valuations?instrument_name=BTCUSD-PERP&valuation_type=mark_price&count=1',
  ];
  for (const path of calls) {
    const runs = [];
    let first = null;
    for (let i = 0; i < 6; i++) {
      const r = await get(path);
      if (i === 0) first = r;
      runs.push(r.ms);
      await sleep(200);
    }
    const warm = runs.slice(1).sort((a, b) => a - b);
    log('latency', { path, status: first.status, firstMs: runs[0], warmMin: warm[0], warmMedian: warm[2], warmMax: warm[4], bytes: first.bytes, encoding: first.headers['content-encoding'] ?? 'none', cfRay: first.headers['cf-ray'], server: first.headers.server });
  }

  const hdr = await get('public/get-tickers?instrument_name=BTCUSD-PERP');
  log('headers', { status: hdr.status, headers: hdr.headers });

  // Catalog.
  const inst = (await get('public/get-instruments')).body.result.data;
  log('catalog_types', { total: inst.length, byType: count(inst, (x) => `${x.inst_type}|${x.inst_type === 'CCY_PAIR' ? '-' : x.quote_ccy}|tradable=${x.tradable}` ) });
  const perps = inst.filter((x) => x.inst_type === 'PERPETUAL_SWAP');
  log('catalog_perps', {
    count: perps.length,
    tradable: count(perps, (x) => x.tradable),
    productType: count(perps, (x) => x.product_type),
    contractSize: count(perps, (x) => x.contract_size),
    maxLeverage: count(perps, (x) => x.max_leverage),
    beta: count(perps, (x) => x.beta_product),
    symbolIsBaseUSDPERP: count(perps, (x) => x.symbol === `${x.base_ccy}USD-PERP`),
    underlyingIsBaseUSDINDEX: count(perps, (x) => x.underlying_symbol === `${x.base_ccy}USD-INDEX`),
    basesListedTwice: Object.entries(count(perps, (x) => x.base_ccy)).filter(([, n]) => n > 1),
    nonAsciiSymbols: perps.filter((x) => /[^\x20-\x7e]/.test(x.symbol)).map((x) => x.symbol),
    fields: [...new Set(perps.flatMap((x) => Object.keys(x)))],
  });
  log('catalog_sample', { rows: perps.filter((x) => ['BTCUSD-PERP', 'ETHUSD-PERP', 'NVDAUSD-PERP', 'ANTHROPICIPOUSD-PERP'].includes(x.symbol)) });
  log('catalog_futures', { symbols: inst.filter((x) => x.inst_type === 'FUTURE').map((x) => x.symbol) });
  log('catalog_spot_quotes', count(inst.filter((x) => x.inst_type === 'CCY_PAIR'), (x) => x.quote_ccy));

  // Tickers cover every perpetual, and carry no mark, index or funding.
  const tick = (await get('public/get-tickers')).body.result.data;
  const tickIds = new Set(tick.map((x) => x.i));
  log('tickers', { rows: tick.length, fields: [...new Set(tick.flatMap((x) => Object.keys(x)))], perpsMissing: perps.filter((x) => !tickIds.has(x.symbol)).map((x) => x.symbol), btc: tick.find((x) => x.i === 'BTCUSD-PERP') });
  const quiet = tick.filter((x) => x.i.endsWith('-PERP')).sort((a, b) => Number(a.vv) - Number(b.vv)).slice(0, 5).map((x) => ({ i: x.i, vv: x.vv, b: x.b, k: x.k }));
  log('quietest_perps', { quiet });
  const oneSided = tick.filter((x) => x.i.endsWith('-PERP') && (x.b === null || x.k === null)).map((x) => x.i);
  log('one_sided_perps', { count: oneSided.length, symbols: oneSided });

  // CCXT 4.5.68 mapping.
  const ex = new ccxt.cryptocom();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const loadMs = Math.round(performance.now() - t0);
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  const perpIds = new Set(perps.map((x) => x.symbol));
  log('ccxt', {
    version: ccxt.version, loadMs, byType: count(all, (m) => m.type), activeSwaps: swaps.length,
    taker: count(swaps, (m) => m.taker), maker: count(swaps, (m) => m.maker), contractSize: count(swaps, (m) => m.contractSize),
    linear: count(swaps, (m) => m.linear), settle: count(swaps, (m) => m.settle), quote: count(swaps, (m) => m.quote),
    idEqualsCatalogSymbol: swaps.filter((m) => perpIds.has(m.id)).length,
    spotTaker: count(all.filter((m) => m.type === 'spot'), (m) => m.taker),
    sample: swaps.filter((m) => ['BTCUSD-PERP', 'ETHUSD-PERP', 'NVDAUSD-PERP'].includes(m.id)).map((m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, pricePrecision: m.precision.price, amountPrecision: m.precision.amount })),
  });
  const pairKeys = count(swaps, (m) => `${m.base}|${m.quote}`);
  log('ccxt_pairs_twice', { pairs: Object.entries(pairKeys).filter(([, n]) => n > 1) });

  // The pre-IPO perpetuals, whose price basis other venues scale.
  for (const u of ['ANTHROPICIPOUSD-INDEX', 'OPENAIIPOUSD-INDEX']) {
    const r = await get(`public/get-valuations?instrument_name=${u}&valuation_type=index_price&count=1`);
    const p = r.body?.result?.data?.[0];
    log('pre_ipo_index', { index: u, v: p?.v, t: p?.t, at: new Date(r.arrivedAt).toISOString() });
  }

  // REST book: depth limits, order, level shape, caching.
  for (const depth of [10, 50, 100, 150, 200]) {
    const r = await get(`public/get-book?instrument_name=BTCUSD-PERP&depth=${depth}`);
    const d = r.body?.result?.data?.[0];
    const bids = d?.bids ?? [];
    const asks = d?.asks ?? [];
    log('rest_book', { depth, status: r.status, ms: r.ms, bytes: r.bytes, code: r.body?.code, message: r.body?.message, levels: { bids: bids.length, asks: asks.length }, bidsDesc: bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0])), asksAsc: asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0])), keys: d ? Object.keys(d) : null, top: { bid: bids[0], ask: asks[0] }, t: d?.t, ageMs: d?.t ? r.arrivedAt - d.t : null });
  }
  const c1 = await get('public/get-book?instrument_name=BTCUSD-PERP&depth=10');
  await sleep(150);
  const c2 = await get('public/get-book?instrument_name=BTCUSD-PERP&depth=10');
  const d1 = c1.body.result.data[0];
  const d2 = c2.body.result.data[0];
  log('rest_book_cache', { t1: d1.t, t2: d2.t, u1: d1.u, u2: d2.u, same: JSON.stringify(d1) === JSON.stringify(d2), cfCache: c2.headers['cf-cache-status'] });
  const qb = await get(`public/get-book?instrument_name=${quiet[0].i}&depth=50`);
  log('rest_book_quiet', { i: quiet[0].i, status: qb.status, levels: { bids: qb.body?.result?.data?.[0]?.bids?.length, asks: qb.body?.result?.data?.[0]?.asks?.length }, t: qb.body?.result?.data?.[0]?.t, ageMs: qb.arrivedAt - (qb.body?.result?.data?.[0]?.t ?? 0) });

  // Error replies.
  const errs = [
    'public/get-book?instrument_name=NOPEUSD-PERP&depth=10',
    'public/get-book?instrument_name=BTCUSD-PERP',
    'public/get-book?instrument_name=BTCUSD-PERP&depth=0',
    'public/get-tickers?instrument_name=NOPEUSD-PERP',
    'public/get-valuations?valuation_type=mark_price',
    'public/get-valuations?instrument_name=BTCUSD-PERP&valuation_type=nope',
    'public/get-valuations?instrument_name=NOPEUSD-PERP&valuation_type=mark_price',
    'public/get-nope',
  ];
  for (const path of errs) {
    const r = await get(path, { raw: true });
    log('error_reply', { path, status: r.status, body: String(r.body).replace(/\s+/g, ' ').slice(0, 300) });
  }

  // Clock: the Date header has one second resolution, and the ticker t is the time a ticker was published.
  const tc = await get('public/get-tickers');
  const maxT = Math.max(...tc.body.result.data.map((x) => x.t));
  log('clock', { localArrival: tc.arrivedAt, dateHeader: tc.headers.date, dateHeaderMs: Date.parse(tc.headers.date), newestTickerT: maxT, arrivalMinusNewestTickerMs: tc.arrivedAt - maxT, roundTripMs: tc.ms });
}

async function valuation(instrument, type, count = 1) {
  const r = await get(`public/get-valuations?instrument_name=${instrument}&valuation_type=${type}&count=${count}`);
  const p = r.body?.result?.data?.[0];
  return { status: r.status, ms: r.ms, code: r.body?.code, v: p?.v, t: p?.t, arrivedAt: r.arrivedAt, instrumentName: r.body?.result?.instrument_name, data: r.body?.result?.data };
}

async function anchor() {
  const tick = (await get('public/get-tickers')).body.result.data.filter((x) => x.i.endsWith('-PERP'));
  const quiet = tick.filter((x) => Number(x.vv) > 0).sort((a, b) => Number(a.vv) - Number(b.vv))[0].i;
  const symbols = ['BTCUSD-PERP', 'ETHUSD-PERP', 'NVDAUSD-PERP', quiet];
  const types = ['mark_price', 'index_price', 'funding_rate', 'estimated_funding_rate'];
  const st = {};
  for (const s of symbols) for (const ty of types) st[`${s}|${ty}`] = { polls: 0, vChanges: 0, tChanges: 0, last: null, ages: [], ms: [], tSecondsOfMinute: new Set(), instrumentName: null, errors: 0 };
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    await Promise.all(symbols.flatMap((s) => types.map(async (ty) => {
      const r = await valuation(s, ty);
      const x = st[`${s}|${ty}`];
      if (r.status !== 200 || r.code !== 0) { x.errors++; return; }
      x.polls++; x.ms.push(r.ms); x.ages.push(r.arrivedAt - r.t); x.instrumentName = r.instrumentName;
      x.tSecondsOfMinute.add(new Date(r.t).getUTCSeconds());
      if (x.last) { if (x.last.v !== r.v) x.vChanges++; if (x.last.t !== r.t) x.tChanges++; }
      x.last = { v: r.v, t: r.t };
    })));
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  for (const [k, x] of Object.entries(st)) {
    const ages = x.ages.sort((a, b) => a - b);
    const ms = x.ms.sort((a, b) => a - b);
    log('anchor_cadence', { key: k, instrumentName: x.instrumentName, polls: x.polls, errors: x.errors, vChanges: x.vChanges, tChanges: x.tChanges, ageMinMs: ages[0], ageMedianMs: ages[Math.floor(ages.length / 2)], ageMaxMs: ages.at(-1), replyMedianMs: ms[Math.floor(ms.length / 2)], replyMaxMs: ms.at(-1), tSecondsOfMinute: [...x.tSecondsOfMinute].sort((a, b) => a - b), last: x.last });
  }
  // Settled rates: one row per hour, and the same rate for each hour of one four hour interval.
  const hist = await valuation('BTCUSD-PERP', 'funding_hist', 30);
  log('funding_hist', { rows: hist.data.map((p) => `${new Date(p.t).toISOString().slice(0, 16)} ${p.v}`) });
  const hist2 = await valuation('ETHUSD-PERP', 'funding_hist', 12);
  log('funding_hist_eth', { rows: hist2.data.map((p) => `${new Date(p.t).toISOString().slice(0, 16)} ${p.v}`) });
  const cur = await valuation('BTCUSD-PERP', 'funding_rate', 5);
  log('funding_rate_series', { fetchedAt: new Date(cur.arrivedAt).toISOString().slice(11, 19), rows: cur.data.map((p) => `${new Date(p.t).toISOString().slice(11, 19)} ${p.v}`) });
  // With count above 1 the newest point is not the live one, which count=1 returns.
  const mk = await valuation('BTCUSD-PERP', 'mark_price', 8);
  log('mark_price_series', { fetchedAt: new Date(mk.arrivedAt).toISOString().slice(11, 19), newestAgeMs: mk.arrivedAt - mk.data[0].t, rows: mk.data.map((p) => `${new Date(p.t).toISOString().slice(11, 19)} ${p.v}`) });
  const ix = await valuation('BTCUSD-INDEX', 'index_price', 8);
  log('index_price_series', { fetchedAt: new Date(ix.arrivedAt).toISOString().slice(11, 19), newestAgeMs: ix.arrivedAt - ix.data[0].t, rows: ix.data.map((p) => `${new Date(p.t).toISOString().slice(11, 19)} ${p.v}`) });
  const mk1 = await valuation('BTCUSD-PERP', 'mark_price', 1);
  log('mark_price_count1', { fetchedAt: new Date(mk1.arrivedAt).toISOString().slice(11, 19), ageMs: mk1.arrivedAt - mk1.t, v: mk1.v });
}

async function round() {
  const perps = (await get('public/get-instruments')).body.result.data.filter((x) => x.inst_type === 'PERPETUAL_SWAP' && x.tradable);
  const t0 = performance.now();
  const results = [];
  let next = 0;
  // 40 requests per second: one request every 25 ms, never more than 40 in flight.
  await new Promise((resolve) => {
    let inFlight = 0;
    const timer = setInterval(() => {
      if (next >= perps.length) { if (inFlight === 0) { clearInterval(timer); resolve(); } return; }
      if (inFlight >= 40) return;
      const s = perps[next++].symbol;
      inFlight++;
      valuation(s, 'mark_price').then((r) => results.push({ s, ...r })).catch((e) => results.push({ s, status: 0, error: e.message })).finally(() => { inFlight--; });
    }, 25);
  });
  const ms = Math.round(performance.now() - t0);
  const ages = results.filter((r) => r.t).map((r) => r.arrivedAt - r.t).sort((a, b) => a - b);
  log('round', { markets: perps.length, wallMs: ms, statuses: count(results, (r) => r.status), codes: count(results, (r) => r.code), noPoint: results.filter((r) => !r.t).map((r) => r.s), ageMinMs: ages[0], ageMedianMs: ages[Math.floor(ages.length / 2)], ageP90Ms: ages[Math.floor(ages.length * 0.9)], ageMaxMs: ages.at(-1), replyMedianMs: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)] });
}

async function baskets() {
  const dir = mkdtempSync(join(tmpdir(), 'cdc-index-'));
  const res = await fetch(INDEX_PDF);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(dir, 'index.pdf'), buf);
  log('pdf', { status: res.status, bytes: buf.length, lastModified: res.headers.get('last-modified') });
  execFileSync('pdftotext', ['-layout', join(dir, 'index.pdf'), join(dir, 'index.txt')]);
  const text = execFileSync('cat', [join(dir, 'index.txt')]).toString();
  log('pdf_header', { firstLine: text.split('\n')[0].trim() });
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\S+-INDEX)\s+(.+?)\s{2,}(\S+)\s+([0-9.]+)$/);
    if (m) rows.push({ idx: m[1], comp: m[2].trim(), src: m[3], w: Number(m[4]) });
  }
  const by = {};
  for (const r of rows) (by[r.idx] ??= []).push(r);
  const perps = (await get('public/get-instruments')).body.result.data.filter((x) => x.inst_type === 'PERPETUAL_SWAP');
  const isOtherPerp = (r) => /-SWAP$/.test(r.comp) || (r.src === 'GATE_IO_FUTURES' && !/\.Index$/.test(r.comp)) || (r.src === 'BINANCE_FUTURES' && !/\.Index$/.test(r.comp)) || (r.src === 'HyperLiquid' && !/Oracle/.test(r.comp));
  const isVenueIndex = (r) => /\.Index$/.test(r.comp) || /Oracle/.test(r.comp);
  const isOwnPerp = (r) => r.src === 'CRYPTO_OEX' && /PERP/.test(r.comp);
  const covered = perps.filter((x) => by[x.underlying_symbol]);
  log('baskets_summary', {
    rows: rows.length, indices: Object.keys(by).length, perps: perps.length,
    perpsWithoutBasket: perps.filter((x) => !by[x.underlying_symbol]).map((x) => x.symbol),
    sourceRows: count(rows, (r) => r.src),
    sourcesPerBasket: count(covered, (x) => by[x.underlying_symbol].length),
    sourcesPerBasketCrypto: count(covered.filter((x) => x.product_type === 'DIGITAL_CURRENCIES'), (x) => by[x.underlying_symbol].length),
    sourcesPerBasketTradFi: count(covered.filter((x) => x.product_type !== 'DIGITAL_CURRENCIES'), (x) => by[x.underlying_symbol].length),
    ownPerpInBasket: covered.filter((x) => by[x.underlying_symbol].some(isOwnPerp)).map((x) => x.symbol),
  });
  const withPerp = covered.map((x) => ({ s: x.symbol, w: by[x.underlying_symbol].filter(isOtherPerp).reduce((a, r) => a + r.w, 0), who: [...new Set(by[x.underlying_symbol].filter(isOtherPerp).map((r) => r.src))] })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w);
  log('baskets_other_venue_perp', { count: withPerp.length, rows: withPerp.map((x) => `${x.s}:${x.w.toFixed(2)}(${x.who.join('+')})`) });
  const withIdx = covered.filter((x) => by[x.underlying_symbol].some(isVenueIndex));
  log('baskets_other_venue_index', { count: withIdx.length, byType: count(withIdx, (x) => x.product_type) });
  const ownSpot = covered.map((x) => ({ s: x.symbol, w: by[x.underlying_symbol].filter((r) => r.src === 'CRYPTO_OEX').reduce((a, r) => a + r.w, 0) })).filter((x) => x.w >= 33);
  log('baskets_own_spot_33pct', { rows: ownSpot.map((x) => `${x.s}:${x.w}`) });
  const dominant = covered.map((x) => ({ s: x.symbol, top: by[x.underlying_symbol].reduce((a, r) => (r.w > a.w ? r : a)) })).filter((x) => x.top.w >= 90);
  log('baskets_one_member_90pct', { rows: dominant.map((x) => `${x.s}:${x.top.src} ${x.top.comp} ${x.top.w}`) });
  const twoOrFewer = covered.filter((x) => by[x.underlying_symbol].length <= 2).map((x) => `${x.symbol}: ${by[x.underlying_symbol].map((r) => `${r.src} ${r.comp} ${r.w}`).join(', ')}`);
  log('baskets_two_or_fewer', { rows: twoOrFewer });
  for (const u of ['BTCUSD-INDEX', 'ETHUSD-INDEX', 'ONEUSD-INDEX', 'NVDAUSD-INDEX', 'XAUUSD-INDEX', 'CLUSD-INDEX', 'OPENAIIPOUSD-INDEX', 'ANTHROPICIPOUSD-INDEX']) {
    log('basket', { index: u, members: (by[u] ?? []).map((r) => `${r.src} ${r.comp} ${r.w}`) });
  }
}

const mode = process.argv[2] ?? 'main';
const run = { main, anchor, round, baskets }[mode];
if (!run) { console.error(`unknown mode ${mode}`); process.exit(1); }
await run();
