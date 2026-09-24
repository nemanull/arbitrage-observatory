// Delta Exchange global REST probe: host latency and clock, the perpetual catalog and its CCXT mapping, the bulk anchor call and how often it changes, CloudFront caching, funding history, the REST book, and error shapes.
// Public, unauthenticated, read-only. The documented public quota is 10,000 weight per 5 minutes per IP with products, tickers and the book at weight 3, and no mode here spends more than about 400.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/delta/rest-probe.mjs [host|catalog|anchor|funding|book|errors]
//   host     DNS, cold and warm tickers timing, the request-in-time header against the local clock. About 10 s.
//   catalog  products by type and state, the perpetual rows, the India platform count, CCXT 4.5.68 loadMarkets mapping. About 10 s.
//   anchor   perpetual tickers: fields, size, 60 one second polls with change counts, cache hits and mark premium, then 30 polls with a nonce. About 95 s.
//   funding  FUNDING:<symbol> candles over 48 h at 1 h and around the last settlement at 1 m, and the documented formula recomputed from MARK and index candles for the closed and the running interval. About 10 s.
//   book     l2orderbook at several depths: level order, size unit, depth field, caching. About 10 s.
//   errors   unknown symbol, unknown path, bad query, and the India host with a global symbol. About 3 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/delta/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.delta.exchange/v2';
const INDIA_API = 'https://api.india.delta.exchange/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, name) {
  const t0 = performance.now();
  const sent = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  if (name) keep(name, text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const h = (k) => res.headers.get(k);
  return {
    status: res.status,
    ms,
    sent,
    recv: Date.now(),
    bytes: text.length,
    json,
    text,
    cache: h('x-cache'),
    age: h('age'),
    cacheControl: h('cache-control'),
    inTime: h('request-in-time'),
    outTime: h('request-out-time'),
    headers: res.headers,
  };
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function host() {
  const url = new URL(API);
  const addrs = await lookup(url.hostname, { all: true });
  log('dns', { host: url.hostname, addrs: addrs.map((a) => a.address) });
  const times = [];
  const offsets = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${API}/tickers/BTCUSDT`);
    times.push(r.ms);
    // request-in-time is the server's receive instant in µs, so the offset is judged against the midpoint of the local send and receive.
    if (r.inTime) offsets.push(Math.round(Number(r.inTime) / 1000 - (r.sent + r.recv) / 2));
    log('tickers_btc', { i, status: r.status, ms: r.ms, cache: r.cache, age: r.age, inTime: r.inTime, outTime: r.outTime, serverUs: r.outTime && r.inTime ? Number(r.outTime) - Number(r.inTime) : null });
    await sleep(700);
  }
  log('timing', { firstMs: times[0], warmMs: times.slice(1), offsetMs: offsets });
  const d = await get(`${API}/tickers/BTCUSDT`);
  log('date_header', { date: d.headers.get('date'), local: new Date().toUTCString(), pop: d.headers.get('x-amz-cf-pop') });
}

async function catalog() {
  const r = await get(`${API}/products`, 'products.json');
  log('products', { status: r.status, ms: r.ms, bytes: r.bytes, meta: r.json?.meta });
  const rows = r.json.result;
  const byType = {};
  for (const p of rows) {
    const k = `${p.contract_type}|${p.state}|${p.trading_status}`;
    byType[k] = (byType[k] ?? 0) + 1;
  }
  log('by_type', byType);
  const perps = rows.filter((p) => p.contract_type === 'perpetual_futures');
  for (const p of perps) {
    const s = p.product_specs ?? {};
    log('perp', {
      symbol: p.symbol,
      id: p.id,
      state: p.state,
      trading_status: p.trading_status,
      quote: p.quoting_asset?.symbol,
      settle: p.settling_asset?.symbol,
      contract_value: p.contract_value,
      unit: p.contract_unit_currency,
      tick: p.tick_size,
      taker: p.taker_commission_rate,
      maker: p.maker_commission_rate,
      apiTaker: s.api_taker_commission_rate,
      apiMaker: s.api_maker_commission_rate,
      rateInterval: s.rate_exchange_interval,
      expiryInterval: s.expiry_interval,
      clamp: s.funding_clamp_value,
      annualized_funding: p.annualized_funding,
      basis_factor_max_limit: p.basis_factor_max_limit,
      price_band: p.price_band,
      impact_size: p.impact_size,
      index: p.spot_index?.symbol,
      indexMethod: p.spot_index?.price_method,
      basket: (p.spot_index?.constituent_exchanges ?? []).map((e) => `${e.exchange}:${e.weight}`),
      launch: p.launch_time,
    });
  }
  const spot = rows.filter((p) => p.contract_type === 'spot').map((p) => p.symbol);
  log('spot', { count: spot.length, symbols: spot });
  const pf = await get(`${API}/products?contract_types=perpetual_futures`);
  log('products_perp_only', { status: pf.status, ms: pf.ms, bytes: pf.bytes, rows: pf.json?.result?.length });

  const ind = await get(`${INDIA_API}/products?contract_types=perpetual_futures`);
  const iperps = ind.json?.result ?? [];
  const fam = {};
  for (const p of iperps) {
    const k = `${p.state}|${p.quoting_asset?.symbol}|${p.settling_asset?.symbol}`;
    fam[k] = (fam[k] ?? 0) + 1;
  }
  log('india_perps', { status: ind.status, ms: ind.ms, bytes: ind.bytes, total: ind.json?.meta?.total_count, families: fam, takerSample: iperps.find((p) => p.symbol === 'BTCUSD')?.taker_commission_rate });

  const ex = new ccxt.delta();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  log('ccxt_loadMarkets', { version: ccxt.version, ms: Math.round(performance.now() - t0), markets: Object.keys(markets).length });
  const swaps = Object.values(markets).filter((m) => m.swap);
  log('ccxt_swaps', { total: swaps.length, active: swaps.filter((m) => m.active).length });
  for (const m of swaps) {
    log('ccxt_swap', { symbol: m.symbol, id: m.id, numericId: m.numericId, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, active: m.active, contractSize: m.contractSize, taker: m.taker, maker: m.maker, precision: m.precision });
  }
  const pairs = {};
  for (const m of swaps.filter((m) => m.active)) {
    const k = `${m.base}/${m.quote}`;
    pairs[k] = (pairs[k] ?? 0) + 1;
  }
  log('ccxt_pairs_twice', { twice: Object.entries(pairs).filter(([, n]) => n > 1) });
  log('ccxt_fees_constant', { taker: ex.fees.trading.taker, maker: ex.fees.trading.maker });
}

async function anchor() {
  const url = `${API}/tickers?contract_types=perpetual_futures`;
  const first = await get(url, 'tickers_perp.json');
  const rows = first.json.result;
  log('tickers', { status: first.status, ms: first.ms, bytes: first.bytes, rows: rows.length, cacheControl: first.cacheControl, cache: first.cache });
  const btc = rows.find((t) => t.symbol === 'BTCUSDT');
  log('ticker_keys', { keys: Object.keys(btc).sort() });
  for (const t of rows) {
    const prem = (Number(t.mark_price) / Number(t.spot_price) - 1) * 1e6;
    log('ticker_row', {
      symbol: t.symbol,
      spot_price: t.spot_price,
      mark_price: t.mark_price,
      mark_basis: t.mark_basis,
      premiumPpm: Math.round(prem),
      funding_rate: t.funding_rate,
      bid: t.quotes?.best_bid,
      ask: t.quotes?.best_ask,
      impact_mid: t.quotes?.impact_mid_price,
      timestamp: t.timestamp,
      tsAgeMs: Math.round(first.recv - t.timestamp / 1000),
      time: t.time,
      turnover_usd: Math.round(t.turnover_usd ?? 0),
      status: t.product_trading_status,
    });
  }

  const prev = new Map();
  const changes = new Map();
  const times = [];
  const cache = {};
  const ages = [];
  const stuckTs = new Map();
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const r = await get(url);
    times.push(r.ms);
    cache[r.cache] = (cache[r.cache] ?? 0) + 1;
    if (r.age) ages.push(Number(r.age));
    for (const t of r.json?.result ?? []) {
      const p = prev.get(t.symbol);
      const c = changes.get(t.symbol) ?? { spot: 0, mark: 0, funding: 0, ts: 0, bidask: 0, samples: 0 };
      c.samples++;
      if (p) {
        if (p.spot_price !== t.spot_price) c.spot++;
        if (p.mark_price !== t.mark_price) c.mark++;
        if (p.funding_rate !== t.funding_rate) c.funding++;
        if (p.timestamp !== t.timestamp) c.ts++;
        if (p.quotes?.best_bid !== t.quotes?.best_bid || p.quotes?.best_ask !== t.quotes?.best_ask) c.bidask++;
      }
      const lag = Math.round(r.recv - t.timestamp / 1000);
      const s = stuckTs.get(t.symbol) ?? [];
      s.push(lag);
      stuckTs.set(t.symbol, s);
      changes.set(t.symbol, c);
      prev.set(t.symbol, t);
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log('poll_timing', { polls: times.length, min: Math.min(...times), median: pct(times, 50), p90: pct(times, 90), max: Math.max(...times), over1s: times.filter((x) => x > 1000).length });
  log('poll_cache', { cache, ageMin: ages.length ? Math.min(...ages) : null, ageMax: ages.length ? Math.max(...ages) : null });
  for (const [sym, c] of changes) {
    const lags = stuckTs.get(sym);
    log('poll_changes', { symbol: sym, ...c, tsLagMsMedian: pct(lags, 50), tsLagMsMax: Math.max(...lags) });
  }
  // The edge caches the reply for 2 s by URL, so a nonce shows what the origin itself republishes.
  const nonceTimes = [];
  const nonceLag = [];
  const nonceCache = {};
  let tsChanges = 0;
  let prevTs = null;
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    const r = await get(`${url}&nonce=${Date.now()}`);
    nonceTimes.push(r.ms);
    nonceCache[r.cache] = (nonceCache[r.cache] ?? 0) + 1;
    const b = (r.json?.result ?? []).find((t) => t.symbol === 'BTCUSDT');
    if (b) {
      if (prevTs !== null && b.timestamp !== prevTs) tsChanges++;
      prevTs = b.timestamp;
      nonceLag.push(Math.round(r.recv - b.timestamp / 1000));
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log('nonce_polls', { polls: nonceTimes.length, cache: nonceCache, median: pct(nonceTimes, 50), p90: pct(nonceTimes, 90), max: Math.max(...nonceTimes), tsChanges, tsLagMsMin: Math.min(...nonceLag), tsLagMsMedian: pct(nonceLag, 50), tsLagMsMax: Math.max(...nonceLag) });

  const last = prev.get('BTCUSDT');
  log('funding_fields', { symbol: 'BTCUSDT', funding_rate: last.funding_rate, fractionPerInterval: Number(last.funding_rate) / 100 });

  const idx = await get(`${API}/indices`, 'indices.json');
  const perpIdx = new Set(rows.map((t) => t.spot_price && t.symbol));
  log('indices', { status: idx.status, ms: idx.ms, bytes: idx.bytes, rows: idx.json?.result?.length, perpRows: perpIdx.size });
  for (const sym of ['.DEXBTUSDT', '.DEETHUSDT', '.DESOLUSDT', '.DEXRPUSDT', '.DEDOGEUSDT', '.DEPAXGUSDT']) {
    const row = (idx.json?.result ?? []).find((x) => x.symbol === sym);
    log('index_row', { symbol: sym, found: !!row, method: row?.price_method, basket: row?.constituent_exchanges?.map((e) => `${e.exchange}:${e.weight}`) });
  }
}

async function funding() {
  const now = Math.floor(Date.now() / 1000);
  for (const sym of ['BTCUSDT', 'PAXGUSDT', 'SOLUSDT']) {
    const r = await get(`${API}/history/candles?resolution=1h&symbol=FUNDING:${sym}&start=${now - 48 * 3600}&end=${now}`, `funding_1h_${sym}.json`);
    const c = r.json?.result ?? [];
    log('funding_1h', {
      symbol: sym,
      status: r.status,
      candles: c.length,
      sample: c.slice(0, 12).map((x) => ({ t: new Date(x.time * 1000).toISOString().slice(5, 16), o: x.open, c: x.close })),
    });
  }
  // The last settlement instant, at 00:00, 08:00 or 16:00 UTC.
  const lastSettle = Math.floor(now / 28800) * 28800;
  for (const sym of ['BTCUSDT', 'PAXGUSDT']) {
    const r = await get(`${API}/history/candles?resolution=1m&symbol=FUNDING:${sym}&start=${lastSettle - 300}&end=${lastSettle + 300}`);
    const c = r.json?.result ?? [];
    log('funding_1m_around_settle', { symbol: sym, settle: new Date(lastSettle * 1000).toISOString(), candles: c.map((x) => ({ t: new Date(x.time * 1000).toISOString().slice(11, 16), o: x.open, h: x.high, l: x.low, c: x.close })) });
  }
  const r = await get(`${API}/history/candles?resolution=1m&symbol=MARK:BTCUSDT&start=${now - 300}&end=${now}`);
  log('mark_1m', { status: r.status, candles: (r.json?.result ?? []).length, last: (r.json?.result ?? []).slice(-2) });

  // The documented rate is avgPremium + clamp(0.01 % - avgPremium, -0.05 %, 0.05 %), with the premium (mark - index) / index sampled each minute.
  // Recomputing it over the interval that ended at the last settlement and over the running interval shows which one the published numbers describe.
  const rate = (avgPct) => avgPct + Math.min(0.05, Math.max(-0.05, 0.01 - avgPct));
  for (const [sym, idx] of [
    ['BTCUSDT', '.DEXBTUSDT'],
    ['ETHUSDT', '.DEETHUSDT'],
  ]) {
    const windows = [
      ['ended_at_last_settle', lastSettle - 28800, lastSettle],
      ['running_since_last_settle', lastSettle, now],
    ];
    for (const [label, from, to] of windows) {
      const m = await get(`${API}/history/candles?resolution=1m&symbol=MARK:${sym}&start=${from}&end=${to - 1}`);
      const i = await get(`${API}/history/candles?resolution=1m&symbol=${encodeURIComponent(idx)}&start=${from}&end=${to - 1}`);
      const idxBy = new Map((i.json?.result ?? []).map((c) => [c.time, c.close]));
      const prem = [];
      for (const c of m.json?.result ?? []) {
        const x = idxBy.get(c.time);
        if (x) prem.push(((c.close - x) / x) * 100);
      }
      const avg = prem.reduce((a, b) => a + b, 0) / (prem.length || 1);
      log('funding_recompute', { symbol: sym, window: label, from: new Date(from * 1000).toISOString(), markCandles: (m.json?.result ?? []).length, indexCandles: idxBy.size, matched: prem.length, avgPremiumPct: Number(avg.toFixed(6)), formulaRatePct: Number(rate(avg).toFixed(6)) });
    }
    const f = await get(`${API}/history/candles?resolution=1h&symbol=FUNDING:${sym}&start=${lastSettle - 3600}&end=${now}`);
    const t = await get(`${API}/tickers/${sym}`);
    log('funding_published', { symbol: sym, candles: (f.json?.result ?? []).map((c) => [new Date(c.time * 1000).toISOString().slice(11, 16), c.close]), tickerFundingPct: t.json?.result?.funding_rate });
  }
}

async function book() {
  for (const depth of [undefined, 5, 20, 50, 100, 1000]) {
    const r = await get(`${API}/l2orderbook/BTCUSDT${depth ? `?depth=${depth}` : ''}`, `book_btc_${depth ?? 'default'}.json`);
    const res = r.json?.result ?? {};
    const buy = res.buy ?? [];
    const sell = res.sell ?? [];
    const desc = buy.every((l, i) => i === 0 || Number(l.price) < Number(buy[i - 1].price));
    const asc = sell.every((l, i) => i === 0 || Number(l.price) > Number(sell[i - 1].price));
    log('book', {
      depth: depth ?? 'default',
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      buy: buy.length,
      sell: sell.length,
      bidsDescending: desc,
      asksAscending: asc,
      keys: Object.keys(res),
      top: { bid: buy[0], ask: sell[0] },
      last_sequence_no: res.last_sequence_no,
      last_updated_at: res.last_updated_at,
      cache: r.cache,
      cacheControl: r.cacheControl,
      sizeTypes: [typeof buy[0]?.size, typeof buy[0]?.price, typeof buy[0]?.depth],
    });
  }
  // Two quick reads show whether the edge serves the same book twice.
  const seqs = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${API}/l2orderbook/ETHUSDT?depth=20`);
    seqs.push({ seq: r.json?.result?.last_sequence_no, upd: r.json?.result?.last_updated_at, cache: r.cache, age: r.age, ms: r.ms });
    await sleep(400);
  }
  log('book_repeat', { symbol: 'ETHUSDT', reads: seqs });
  for (const sym of ['DOGEUSDT', 'PAXGUSDT', 'XRPUSDT', 'SOLUSDT']) {
    const r = await get(`${API}/l2orderbook/${sym}?depth=20`);
    const res = r.json?.result ?? {};
    log('book_other', { symbol: sym, buy: res.buy?.length, sell: res.sell?.length, bid: res.buy?.[0], ask: res.sell?.[0], upd: res.last_updated_at, ageS: res.last_updated_at ? Math.round((Date.now() - res.last_updated_at / 1000) / 1000) : null });
  }
}

async function errors() {
  const cases = [
    `${API}/l2orderbook/NOPEUSDT`,
    `${API}/tickers/NOPEUSDT`,
    `${API}/products/NOPEUSDT`,
    `${API}/tickers?contract_types=nope`,
    `${API}/l2orderbook/BTCUSDT?depth=abc`,
    `${API}/history/candles?resolution=1m&symbol=FUNDING:BTCUSDT`,
    `${API}/nope`,
    `${INDIA_API}/tickers/BTCUSDT`,
    `${INDIA_API}/tickers/BTCUSD`,
  ];
  for (const u of cases) {
    const r = await get(u);
    const body = r.json ? JSON.stringify(r.json) : r.text;
    log('error_case', { url: u.replace('https://', ''), status: r.status, body: body.length > 300 ? `${body.slice(0, 300)}…` : body, rl: [r.headers.get('x-rate-limit-reset'), r.headers.get('x-rate-limit-remaining')] });
  }
}

const mode = process.argv[2] ?? 'host';
const modes = { host, catalog, anchor, funding, book, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
