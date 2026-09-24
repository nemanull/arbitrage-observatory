// KCEX futures REST probe: host and latency, catalog, anchor calls, index baskets, funding history, book snapshot, errors, and a same-instant book compare with MEXC.
// KCEX publishes no API documentation, so every call here is one the futures web app at www.kcex.com makes, found in its JavaScript bundle.
// Public, unauthenticated, read-only, at most about three requests a second. No proxy and no cookie.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/kcex/rest-probe.mjs [catalog|poll|book]
//   catalog  DNS, cold and warm timing, response headers, catalog counts, CCXT check, anchor field survey, index baskets, funding history, errors. About 15 s.
//   poll     60 one second polls of the bulk ticker and the single BTC index and fair price calls, the bulk funding call every fifth poll, with change counts and ages. About 65 s.
//   book     REST depth limits, level order, caching, and KCEX against MEXC depth read at the same instant. About 15 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/kcex/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const BASE = 'https://www.kcex.com/fapi/v1';
const MEXC = 'https://api.mexc.com/api/v1';
const OUT = process.env.PROBE_OUT_DIR;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const count = (rows, fn) => rows.reduce((m, r) => ((m[fn(r)] = (m[fn(r)] ?? 0) + 1), m), {});
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, name) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const h = (k) => res.headers.get(k);
  if (name) keep(name, text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, json, text, headers: { cache: h('x-cache'), pop: h('x-amz-cf-pop'), age: h('age'), cc: h('cache-control'), server: h('server'), retryAfter: h('retry-after'), date: h('date') } };
}

async function catalog() {
  for (const host of ['www.kcex.com', 'kcex.com', 'api.kcex.com', 'wbs.kcex.com', 'docs.kcex.com', 'api-docs.kcex.com']) {
    try {
      const a = await lookup(host, { all: true });
      log('dns', { host, addrs: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${BASE}/contract/ping`);
    times.push(r.ms);
    if (i === 0) log('ping_first', { status: r.status, ms: r.ms, body: r.text, headers: r.headers });
    await sleep(500);
  }
  log('ping_times', { ms: times });

  // The engine's AnchorPoller sets only an accept header, so Node's own User-Agent goes out.
  const plain = await fetch(`${BASE}/contract/ping`, { headers: { accept: 'application/json' } });
  log('ping_node_default_user_agent', { status: plain.status, body: (await plain.text()).slice(0, 80) });

  // Clock offset from the ping reply against the midpoint of the request.
  const offs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${BASE}/contract/ping`);
    const t1 = Date.now();
    offs.push({ offsetMs: r.json.data - Math.round((t0 + t1) / 2), rttMs: t1 - t0 });
    await sleep(500);
  }
  log('clock', { samples: offs });

  const det = await get(`${BASE}/contract/detail`, 'detail.json');
  const rows = det.json.data;
  log('detail', { status: det.status, ms: det.ms, bytes: det.bytes, headers: det.headers, rows: rows.length });
  log('detail_counts', {
    state: count(rows, (r) => r.state),
    settleCoin: count(rows, (r) => r.settleCoin),
    quoteCoin: count(rows, (r) => r.quoteCoin),
    futureType: count(rows, (r) => r.futureType),
    positionOpenType: count(rows, (r) => r.positionOpenType),
    apiAllowed: count(rows, (r) => r.apiAllowed),
    isHidden: count(rows, (r) => r.isHidden),
    automaticDelivery: count(rows, (r) => r.automaticDelivery),
    takerFeeRate: count(rows, (r) => r.takerFeeRate),
    makerFeeRate: count(rows, (r) => r.makerFeeRate),
    volUnit: count(rows, (r) => r.volUnit),
  });
  const cs = count(rows, (r) => r.contractSize);
  log('contract_size', { distinct: Object.keys(cs).length, top: Object.entries(cs).sort((a, b) => b[1] - a[1]).slice(0, 8) });
  const bases = count(rows, (r) => r.baseCoin);
  const twice = Object.entries(bases).filter(([, n]) => n > 1).map(([b]) => rows.filter((r) => r.baseCoin === b).map((r) => r.symbol).join('+'));
  log('pairs_twice', { n: twice.length, sample: twice.slice(0, 12) });
  const scaled = rows.filter((r) => /^(10+|1M|1K)/.test(r.symbol)).map((r) => r.symbol);
  log('scaled_symbols', { n: scaled.length, sample: scaled.slice(0, 12) });
  const nonStd = rows.filter((r) => r.symbol !== `${r.baseCoin}_${r.quoteCoin}`).map((r) => `${r.symbol}(${r.baseCoin})`);
  log('symbol_not_base_quote', { n: nonStd.length, sample: nonStd.slice(0, 12) });
  log('sample_rows', { rows: ['BTC_USDT', 'ETH_USDT', 'BTC_USDC', 'PEPE_USDT'].map((s) => { const r = rows.find((x) => x.symbol === s); return r && { symbol: r.symbol, contractSize: r.contractSize, priceUnit: r.priceUnit, volUnit: r.volUnit, takerFeeRate: r.takerFeeRate, makerFeeRate: r.makerFeeRate, state: r.state, apiAllowed: r.apiAllowed, indexOrigin: r.indexOrigin, createTime: new Date(r.createTime).toISOString() }; }) });

  // Index baskets from the catalog.
  const origins = rows.map((r) => r.indexOrigin ?? []);
  log('index_baskets', {
    sizeDist: count(origins, (o) => o.length),
    exchangeFreq: Object.entries(count(origins.flat(), (x) => x)).sort((a, b) => b[1] - a[1]),
    kcexInBasket: rows.filter((r) => (r.indexOrigin ?? []).some((x) => /KCEX/i.test(x))).map((r) => r.symbol),
    single: rows.filter((r) => (r.indexOrigin ?? []).length === 1).map((r) => `${r.symbol}:${r.indexOrigin[0]}`).slice(0, 40),
    mexcOnly: rows.filter((r) => (r.indexOrigin ?? []).length === 1 && r.indexOrigin[0] === 'MEXC').length,
  });

  // CCXT has no KCEX class, so the catalog cannot come from loadMarkets.
  log('ccxt', { version: ccxt.version, kcex: ccxt.exchanges.filter((e) => /kcex/i.test(e)) });

  const tick = await get(`${BASE}/contract/ticker`, 'ticker.json');
  const trows = tick.json.data;
  log('ticker', { status: tick.status, ms: tick.ms, bytes: tick.bytes, headers: tick.headers, rows: trows.length, keys: Object.keys(trows[0]) });
  const fund = await get(`${BASE}/contract/funding_rate`, 'funding.json');
  const frows = fund.json.data;
  log('funding', { status: fund.status, ms: fund.ms, bytes: fund.bytes, headers: fund.headers, rows: frows.length, keys: Object.keys(frows[0]) });
  const now = Date.now();
  log('funding_counts', {
    collectCycle: count(frows, (r) => r.collectCycle),
    maxFundingRate: count(frows, (r) => r.maxFundingRate),
    minFundingRate: count(frows, (r) => r.minFundingRate),
    nextSettle: count(frows, (r) => new Date(r.nextSettleTime).toISOString()),
    atCap: frows.filter((r) => r.fundingRate >= r.maxFundingRate || r.fundingRate <= r.minFundingRate).map((r) => `${r.symbol}:${r.fundingRate}`),
    tsAgeMs: [pct(frows.map((r) => now - r.timestamp), 0), pct(frows.map((r) => now - r.timestamp), 0.5), pct(frows.map((r) => now - r.timestamp), 0.99)],
  });
  const detSet = new Set(rows.map((r) => r.symbol));
  const tSet = new Set(trows.map((r) => r.symbol));
  const fSet = new Set(frows.map((r) => r.symbol));
  log('key_match', { detailNotTicker: [...detSet].filter((s) => !tSet.has(s)), tickerNotDetail: [...tSet].filter((s) => !detSet.has(s)), detailNotFunding: [...detSet].filter((s) => !fSet.has(s)) });
  const zeroIdx = trows.filter((r) => !(r.indexPrice > 0)).map((r) => r.symbol);
  const zeroFair = trows.filter((r) => !(r.fairPrice > 0)).map((r) => r.symbol);
  const prem = trows.filter((r) => r.indexPrice > 0).map((r) => ({ s: r.symbol, ppm: Math.round(((r.fairPrice - r.indexPrice) / r.indexPrice) * 1e6), lastPpm: Math.round(((r.lastPrice - r.indexPrice) / r.indexPrice) * 1e6) }));
  const abs = prem.map((p) => Math.abs(p.ppm));
  log('mark_premium', { zeroIdx, zeroFair, medianAbsPpm: pct(abs, 0.5), p90: pct(abs, 0.9), max: Math.max(...abs), over10k: prem.filter((p) => Math.abs(p.ppm) > 10000).map((p) => `${p.s}:${p.ppm}`).slice(0, 20), fairEqLast: trows.filter((r) => r.fairPrice === r.lastPrice).length });
  const tAge = trows.map((r) => now - r.timestamp);
  log('ticker_ts_age_ms', { min: Math.min(...tAge), median: pct(tAge, 0.5), p99: pct(tAge, 0.99), max: Math.max(...tAge) });

  // The ticker rate against the funding call rate.
  const fMap = new Map(frows.map((r) => [r.symbol, r.fundingRate]));
  log('rate_ticker_vs_funding', { equal: trows.filter((r) => fMap.get(r.symbol) === r.fundingRate).length, of: trows.length });

  for (const s of ['BTC_USDT', 'ETH_USDT', 'ONE_USDT', 'META_USDT']) {
    const r = await get(`${BASE}/contract/market_price_v2?symbol=${s}`);
    log('basket_call', { symbol: s, status: r.status, ms: r.ms, data: r.json?.data });
    await sleep(400);
  }

  // Funding history: settlement instants and rates.
  const hourly = frows.find((r) => r.collectCycle === 1)?.symbol;
  const four = frows.find((r) => r.collectCycle === 4)?.symbol;
  for (const s of ['BTC_USDT', hourly, four].filter(Boolean)) {
    const r = await get(`${BASE}/contract/funding_rate/history?symbol=${s}&page_num=1&page_size=10`);
    const list = r.json?.data?.resultList ?? r.json?.data ?? [];
    log('funding_history', { symbol: s, status: r.status, keys: list[0] && Object.keys(list[0]), rows: (Array.isArray(list) ? list : []).slice(0, 6).map((x) => ({ ...x, at: x.settleTime && new Date(x.settleTime).toISOString() })), raw: Array.isArray(list) ? undefined : r.text.slice(0, 300) });
    await sleep(400);
  }

  // Error shapes.
  const errs = [
    `${BASE}/contract/funding_rate/NOPE_USDT`,
    `${BASE}/contract/index_price/NOPE_USDT`,
    `${BASE}/contract/depth/NOPE_USDT`,
    `${BASE}/contract/nope`,
    `https://www.kcex.com/api/v1/contract/ping`,
    `https://api.kcex.com/api/v1/contract/ping`,
    `https://api.kcex.com/fapi/v1/contract/ping`,
  ];
  for (const u of errs) {
    const r = await get(u);
    log('error_shape', { url: u, status: r.status, bytes: r.bytes, headers: { cache: r.headers.cache, server: r.headers.server }, body: r.text.replace(/\s+/g, ' ').slice(0, 220) });
    await sleep(400);
  }
}

async function poll() {
  const watch = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'BTC_USDC'];
  const n = 60;
  const tms = [];
  const fms = [];
  const prev = new Map();
  const changes = new Map(watch.map((s) => [s, { index: 0, fair: 0, rate: 0, tsSame: 0 }]));
  const changedAll = { index: 0, fair: 0 };
  let lastAll = null;
  const statuses = {};
  const tickTs = [];
  const single = { index: [], fair: [], indexAge: [], fairAge: [] };
  let lastF = null;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    // Funding every fifth poll keeps the probe near three requests a second.
    const [t, f, ix, fp] = await Promise.all([
      get(`${BASE}/contract/ticker`),
      i % 5 === 0 ? get(`${BASE}/contract/funding_rate`) : Promise.resolve(lastF),
      get(`${BASE}/contract/index_price/BTC_USDT`),
      get(`${BASE}/contract/fair_price/BTC_USDT`),
    ]);
    lastF = f;
    const arrival = Date.now();
    const bt = t.json?.data?.find((x) => x.symbol === 'BTC_USDT');
    if (bt) {
      tickTs.push({ ts: bt.timestamp, ageMs: arrival - bt.timestamp });
    }
    if (ix.json?.data) {
      single.index.push(ix.json.data.indexPrice);
      single.indexAge.push(arrival - ix.json.data.timestamp);
    }
    if (fp.json?.data) {
      single.fair.push(fp.json.data.fairPrice);
      single.fairAge.push(arrival - fp.json.data.timestamp);
    }
    statuses[`${t.status}/${f.status}`] = (statuses[`${t.status}/${f.status}`] ?? 0) + 1;
    tms.push(t.ms);
    if (i % 5 === 0) fms.push(f.ms);
    if (i === 0) log('poll_headers', { ticker: t.headers, funding: f.headers });
    const rows = t.json?.data ?? [];
    const fr = new Map((f.json?.data ?? []).map((r) => [r.symbol, r]));
    const all = new Map(rows.map((r) => [r.symbol, [r.indexPrice, r.fairPrice]]));
    if (lastAll) {
      let ci = 0;
      let cf = 0;
      for (const [s, [ix, fa]] of all) {
        const p = lastAll.get(s);
        if (!p) continue;
        if (p[0] !== ix) ci++;
        if (p[1] !== fa) cf++;
      }
      changedAll.index += ci;
      changedAll.fair += cf;
    }
    lastAll = all;
    for (const s of watch) {
      const r = rows.find((x) => x.symbol === s);
      const fu = fr.get(s);
      if (!r || !fu) continue;
      const p = prev.get(s);
      const c = changes.get(s);
      if (p) {
        if (p.indexPrice !== r.indexPrice) c.index++;
        if (p.fairPrice !== r.fairPrice) c.fair++;
        if (p.rate !== fu.fundingRate) c.rate++;
        if (p.timestamp === r.timestamp) c.tsSame++;
      }
      prev.set(s, { indexPrice: r.indexPrice, fairPrice: r.fairPrice, rate: fu.fundingRate, timestamp: r.timestamp });
    }
    const wait = 1000 - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  const distinct = [...new Set(tickTs.map((x) => x.ts))];
  const gaps = distinct.slice(1).map((x, k) => x - distinct[k]);
  const ages = tickTs.map((x) => x.ageMs);
  const flips = (a) => a.slice(1).filter((x, k) => x !== a[k]).length;
  log('ticker_refresh', { distinctTimestamps: distinct.length, gapsMs: gaps, arrivalAgeMs: { min: Math.min(...ages), median: pct(ages, 0.5), max: Math.max(...ages) } });
  log('single_calls_btc', { indexChanges: flips(single.index), fairChanges: flips(single.fair), of: single.index.length - 1, indexAgeMs: { min: Math.min(...single.indexAge), median: pct(single.indexAge, 0.5), max: Math.max(...single.indexAge) }, fairAgeMs: { min: Math.min(...single.fairAge), median: pct(single.fairAge, 0.5), max: Math.max(...single.fairAge) } });
  const st = (a) => ({ min: Math.min(...a), median: pct(a, 0.5), p90: pct(a, 0.9), max: Math.max(...a), over1s: a.filter((x) => x > 1000).length });
  log('poll_summary', { polls: n, statuses, tickerMs: st(tms), fundingMs: st(fms), changesOver59Intervals: Object.fromEntries(changes), allContractsMeanChangesPerInterval: { index: +(changedAll.index / (n - 1)).toFixed(1), fair: +(changedAll.fair / (n - 1)).toFixed(1) }, contracts: lastAll?.size });
}

async function book() {
  for (const lim of [5, 20, 100, 1000]) {
    const r = await get(`${BASE}/contract/depth/BTC_USDT?limit=${lim}`);
    const d = r.json?.data ?? {};
    const desc = (a) => a.every((x, i) => i === 0 || a[i - 1][0] > x[0]);
    const asc = (a) => a.every((x, i) => i === 0 || a[i - 1][0] < x[0]);
    log('depth', { limit: lim, status: r.status, ms: r.ms, bytes: r.bytes, bids: d.bids?.length, asks: d.asks?.length, bidsDesc: d.bids && desc(d.bids), asksAsc: d.asks && asc(d.asks), version: d.version, keys: Object.keys(d), headers: { cache: r.headers.cache, age: r.headers.age, cc: r.headers.cc } });
    await sleep(400);
  }
  const plain = await get(`${BASE}/contract/depth/BTC_USDT`);
  log('depth_default', { bids: plain.json?.data?.bids?.length, asks: plain.json?.data?.asks?.length });

  // Caching: back to back reads.
  const vers = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${BASE}/contract/depth/BTC_USDT?limit=5`);
    vers.push({ v: r.json?.data?.version, ms: r.ms, cache: r.headers.cache });
    await sleep(150);
  }
  log('depth_repeat', { reads: vers });

  // KCEX against MEXC, read at the same instant, for three contracts.
  for (const s of ['BTC_USDT', 'ETH_USDT', 'DOGE_USDT', 'CHR_USDT']) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = await Promise.all([get(`${BASE}/contract/depth/${s}?limit=10`), get(`${MEXC}/contract/depth/${s}?limit=10`)]);
      const ka = a.json?.data;
      const mb = b.json?.data;
      if (!ka || !mb) {
        log('vs_mexc', { symbol: s, kcexStatus: a.status, mexcStatus: b.status, mexcBody: b.text.slice(0, 200) });
        continue;
      }
      const same = (x, y) => x.filter((l, i) => y[i] && l[0] === y[i][0] && l[1] === y[i][1]).length;
      const samePx = (x, y) => x.filter((l, i) => y[i] && l[0] === y[i][0]).length;
      log('vs_mexc', { symbol: s, kcexVersion: ka.version, mexcVersion: mb.version, kcexTop: [ka.bids[0], ka.asks[0]], mexcTop: [mb.bids[0], mb.asks[0]], samePriceLevels: samePx(ka.bids, mb.bids) + samePx(ka.asks, mb.asks), samePriceAndSize: same(ka.bids, mb.bids) + same(ka.asks, mb.asks), of: ka.bids.length + ka.asks.length });
      await sleep(600);
    }
  }
  const [kd, md] = await Promise.all([get(`${BASE}/contract/detail`), get(`${MEXC}/contract/detail`)]);
  const kS = new Set((kd.json?.data ?? []).map((r) => r.symbol));
  const mRows = md.json?.data ?? [];
  const mS = new Set(mRows.map((r) => r.symbol));
  const kc = new Map((kd.json?.data ?? []).map((r) => [r.symbol, r.contractSize]));
  const csEq = mRows.filter((r) => kc.has(r.symbol) && kc.get(r.symbol) === r.contractSize).length;
  log('catalog_vs_mexc', { kcex: kS.size, mexc: mS.size, both: [...kS].filter((s) => mS.has(s)).length, kcexOnly: [...kS].filter((s) => !mS.has(s)).slice(0, 20), contractSizeEqualOnShared: csEq });
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, poll, book }[mode];
if (!run) {
  console.error('mode must be catalog, poll or book');
  process.exit(1);
}
await run();
