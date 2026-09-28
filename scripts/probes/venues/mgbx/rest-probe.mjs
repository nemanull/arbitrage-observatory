// MGBX futures REST probe: host and latency, catalog, the bulk anchor calls over a minute, funding per symbol and its history, a Binance cross-check, REST book, errors and clock.
// MGBX publishes no API documentation, so every path here is one the www.mgbx.com web app calls, read from its JavaScript bundle on 2026-09-22.
// Public, unauthenticated, read-only. It sends one request at a time, at most about 3 a second, and every request times out after 5 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/mgbx/rest-probe.mjs [latency|catalog|anchor|funding|fundingpoll|mirror|book|errors|clock]
//   latency  DNS, 10 cold requests on fresh connections and 20 warm requests on one kept-alive connection.
//   catalog  whether CCXT has a class, then symbol/list by type, state, fee and contract size, cross-checked with agg-tickers and the coin-M path.
//   anchor   60 polls at 1 s of agg-tickers, mark-price and index-price: reply time and size, index against mark, and how often each field changed. About 70 s.
//   funding  funding-rate for every listed perpetual at 4 a second, then funding-rate-record on three symbols. About 80 s.
//   fundingpoll  funding-rate of four contracts once a second for 60 s: how often the running rate changes.
//   mirror   MGBX mark against Binance mark and index, funding and book against Binance USDT-M on common symbols, one read each.
//   book     REST depth at each level, level order, number types, caching, size unit against contractSize.
//   errors   unknown symbol, missing parameter, bad level and unknown path.
//   clock    Binance serverTime, the MGBX time call, the Date header and reply timestamps against the local clock.
// Set PROBE_OUT_DIR to keep the last replies. Recorded in docs/profiles/mgbx/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

// Loads a package the way the engine did, through server/package.json, falling back to old_ts_server/ and the root pnpm store after the 2026-09-23 move.
function load(name) {
  for (const base of ['../../../../server/package.json', '../../../../old_ts_server/package.json', '../../../../package.json']) {
    try {
      return createRequire(new URL(base, import.meta.url))(name);
    } catch {}
  }
  const store = { ccxt: 'ccxt@4.5.68_protobufjs@7.6.6', ws: 'ws@8.21.1_bufferutil@4.1.0' }[name];
  return createRequire(new URL(`../../../../node_modules/.pnpm/${store}/node_modules/${name}/package.json`, import.meta.url))(name);
}

const HOST = 'www.mgbx.com';
const BASE = `https://${HOST}/futures/fapi/market/v1/public`;
const BINANCE = 'https://fapi.binance.com/fapi/v1';
const OUT = process.env.PROBE_OUT_DIR;
const TIMEOUT_MS = 5_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// One request, never thrown: a hang or a refused connection comes back as status 0.
async function get(url, opts = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: opts.headers });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), error: e.name, bytes: 0 };
  }
}

// A third or more of fresh connections to the AWS Global Accelerator front hang on this host, so a read that must succeed tries three times.
async function getRetry(url, tries = 3) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await get(url);
    if (r.status !== 0) return { ...r, tries: i + 1 };
  }
  return { ...r, tries };
}

const q = (path) => `${BASE}/${path}`;
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const stats = (arr) => ({ n: arr.length, min: Math.min(...arr), median: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) });
const countBy = (rows, f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});

async function latency() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });
  const cold = [];
  for (let i = 0; i < 10; i++) {
    // curl opens a fresh connection each time, which fetch's pool would not. A hang exits 28 and still prints the timings.
    const { spawnSync } = await import('node:child_process');
    const out = spawnSync('curl', ['-s', '-m', '5', '-o', '/dev/null', '-w', '%{http_code} connect %{time_connect} tls %{time_appconnect} ttfb %{time_starttransfer} total %{time_total}', q('q/mark-price?symbol=btc_usdt')]).stdout.toString();
    cold.push(out);
    await sleep(1000);
  }
  const ok = cold.filter((c) => c.startsWith('200'));
  log('cold', { requests: cold.length, ok: ok.length, hung: cold.length - ok.length, samples: cold });
  const warm = [];
  let fails = 0;
  for (let i = 0; i < 20; i++) {
    const r = await get(q('q/mark-price?symbol=btc_usdt'));
    if (r.status === 200) warm.push(r.ms);
    else fails++;
    await sleep(500);
  }
  log('warm', { ...stats(warm), fails });
}

async function catalog() {
  const ccxt = load('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, hasMgbx: ccxt.exchanges.filter((x) => /mgbx|megabit/i.test(x)) });
  const r = await getRetry(q('symbol/list'));
  log('symbol_list', { status: r.status, ms: r.ms, bytes: r.bytes, code: r.json?.code });
  if (!r.json?.data) return;
  keep('symbol-list.json', r.text);
  const d = r.json.data;
  log('counts', {
    rows: d.length,
    contractType: countBy(d, (x) => x.contractType),
    underlyingType: countBy(d, (x) => x.underlyingType),
    quoteCoin: countBy(d, (x) => x.quoteCoin),
    targetType: countBy(d, (x) => x.targetType),
    state: countBy(d, (x) => x.state),
    tradeSwitch: countBy(d, (x) => x.tradeSwitch),
  });
  log('fees', { taker: countBy(d, (x) => x.takerFee), maker: countBy(d, (x) => x.makerFee), liquidationFee: countBy(d, (x) => x.liquidationFee) });
  log('contract_size', countBy(d, (x) => x.contractSize));
  const bases = countBy(d, (x) => x.baseCoin);
  log('pairs_twice', { bases: Object.entries(bases).filter(([, n]) => n > 1) });
  const scaled = d.filter((x) => /^1000|^1m|^10000/i.test(x.baseCoin)).map((x) => x.symbol);
  log('scaled_names', { symbols: scaled });
  log('tradfi_sample', { symbols: d.filter((x) => x.targetType === 2).slice(0, 40).map((x) => x.symbol) });
  const { partitionId, supportOrderType, supportTimeInForce, supportEntrustType, supportPositionType, coinName, coinNameZh, coinNameHk, ...btc } = d.find((x) => x.symbol === 'btc_usdt');
  log('btc_row', { row: btc });
  const onboard = d.map((x) => x.onboardDate).filter(Boolean);
  log('onboard', { first: new Date(Math.min(...onboard)).toISOString(), last: new Date(Math.max(...onboard)).toISOString() });
  const a = await getRetry(q('q/agg-tickers'));
  const listed = new Set(d.map((x) => x.symbol));
  const inAgg = new Set((a.json?.data ?? []).map((x) => x.s));
  log('agg_vs_list', { status: a.status, tries: a.tries, aggRows: inAgg.size, notListed: [...inAgg].filter((s) => !listed.has(s)), notInAgg: [...listed].filter((s) => !inAgg.has(s)).slice(0, 10) });
  for (const path of ['futures/dapi/market/v1/public/symbol/list', 'futures/dapi/market/v1/public/q/agg-tickers']) {
    const dapi = await getRetry(`https://${HOST}/${path}`);
    log('coin_m_path', { path, status: dapi.status, tries: dapi.tries, error: dapi.error, body: dapi.text?.slice(0, 200) });
  }
}

async function anchor() {
  const t = { agg: [], mark: [], index: [] };
  const fails = { agg: 0, mark: 0, index: 0 };
  const sizes = {};
  const hist = new Map(); // symbol to list of {i, m, c}
  let iEqM = 0;
  let rows = 0;
  let idxEqMark = 0;
  let idxRows = 0;
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const a = await get(q('q/agg-tickers'));
    if (a.status === 200 && a.json?.code === 0) {
      t.agg.push(a.ms);
      sizes.agg = a.bytes;
      for (const x of a.json.data) {
        rows++;
        if (x.i === x.m) iEqM++;
        if (!hist.has(x.s)) hist.set(x.s, []);
        hist.get(x.s).push({ i: x.i, m: x.m, c: x.c, t: x.t });
      }
      if (i === 59) keep('agg-tickers.json', a.text);
    } else fails.agg++;
    const m = await get(q('q/mark-price'));
    const x = await get(q('q/index-price'));
    if (m.status === 200 && m.json?.code === 0) (t.mark.push(m.ms), (sizes.mark = m.bytes));
    else fails.mark++;
    if (x.status === 200 && x.json?.code === 0) (t.index.push(x.ms), (sizes.index = x.bytes));
    else fails.index++;
    if (m.json?.data && x.json?.data) {
      const mm = new Map(m.json.data.map((r) => [r.s, r.p]));
      for (const r of x.json.data) {
        idxRows++;
        if (mm.get(r.s) === r.p) idxEqMark++;
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  log('times', { agg: stats(t.agg), mark: stats(t.mark), index: stats(t.index), fails, sizes });
  log('agg_index_equals_mark', { rows, equal: iEqM });
  log('bulk_index_equals_bulk_mark', { rows: idxRows, equal: idxEqMark });
  const changes = (arr, k) => arr.reduce((n, v, j) => n + (j > 0 && v[k] !== arr[j - 1][k] ? 1 : 0), 0);
  const all = [...hist.entries()];
  const changeSummary = (k) => stats(all.map(([, v]) => changes(v, k)));
  log('changes_per_symbol', { polls: all[0]?.[1].length, index: changeSummary('i'), mark: changeSummary('m'), last: changeSummary('c') });
  for (const s of ['btc_usdt', 'eth_usdt', 'aapl_usdt', 'xau_usdt']) {
    const v = hist.get(s);
    if (v) log('symbol_changes', { s, polls: v.length, index: changes(v, 'i'), mark: changes(v, 'm'), last: changes(v, 'c'), tAge: Date.now() - v[v.length - 1].t });
  }
  // Single-symbol index against single-symbol mark and the agg row, five reads.
  for (let k = 0; k < 5; k++) {
    for (const s of ['btc_usdt', 'eth_usdt']) {
      const im = await get(q(`q/index-price?symbol=${s}`));
      const mm = await get(q(`q/mark-price?symbol=${s}`));
      const ip = im.json?.data?.[0]?.p;
      const mp = mm.json?.data?.[0]?.p;
      log('single', { s, index: ip, mark: mp, gapPpm: ip && mp ? Math.round((Number(mp) / Number(ip) - 1) * 1e6) : null, status: [im.status, mm.status] });
    }
    await sleep(1000);
  }
}

async function funding() {
  const list = await getRetry(q('symbol/list'));
  const syms = (list.json?.data ?? []).map((x) => ({ s: x.symbol, type: x.targetType }));
  const rows = [];
  let fails = 0;
  for (const { s, type } of syms) {
    const r = await get(q(`q/funding-rate?symbol=${s}`));
    if (r.json?.code === 0) rows.push({ ...r.json.data, type, ms: r.ms });
    else fails++;
    await sleep(250);
  }
  keep('funding-rates.json', JSON.stringify(rows));
  log('funding_sweep', { symbols: syms.length, ok: rows.length, fails, times: stats(rows.map((r) => r.ms)) });
  log('funding_fields', { keys: rows[0] && Object.keys(rows[0]) });
  log('interval', countBy(rows, (r) => r.collectionInterval));
  log('next', countBy(rows, (r) => new Date(r.nextCollectionTime).toISOString()));
  log('caps', countBy(rows, (r) => `${r.fundingRateLowerLimit}..${r.fundingRateUpperLimit}`));
  log('caps_by_type', countBy(rows, (r) => `${r.type} ${r.fundingRateLowerLimit}..${r.fundingRateUpperLimit}`));
  log('at_cap', { current: rows.filter((r) => Number(r.fundingRate) === Number(r.fundingRateUpperLimit) || Number(r.fundingRate) === Number(r.fundingRateLowerLimit)).length, last: rows.filter((r) => Number(r.lastFundingRate) === Number(r.fundingRateUpperLimit) || Number(r.lastFundingRate) === Number(r.fundingRateLowerLimit)).length });
  const abs = rows.map((r) => Math.abs(Number(r.fundingRate)));
  log('rate_abs', stats(abs));
  for (const s of ['btc_usdt', 'eth_usdt', 'xau_usdt']) {
    const r = rows.find((x) => x.symbol === s);
    log('funding_row', { row: r });
  }
  for (const s of ['btc_usdt', 'eth_usdt', 'xau_usdt']) {
    const h = await get(q(`q/funding-rate-record?symbol=${s}`));
    const items = h.json?.data?.items ?? [];
    const gaps = items.slice(1).map((x, j) => (items[j].createdTime - x.createdTime) / 3.6e6);
    log('history', {
      s,
      status: h.status,
      n: items.length,
      hasNext: h.json?.data?.hasNext,
      newest: items[0] && { t: new Date(items[0].createdTime).toISOString(), rate: items[0].fundingRate, mark: items[0].markPrice, interval: items[0].collectionInterval },
      spacingHours: countBy(gaps, (g) => g),
      rates: countBy(items, (x) => x.fundingRate),
    });
    await sleep(300);
  }
}

// The running funding rate of four contracts, read once a second for a minute: how often it changes, and whether the mark moves with it.
async function fundingpoll() {
  const syms = ['btc_usdt', 'eth_usdt', 'sol_usdt', 'xau_usdt'];
  const seen = new Map(syms.map((s) => [s, []]));
  let fails = 0;
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    for (const s of syms) {
      const r = await get(q(`q/funding-rate?symbol=${s}`));
      if (r.json?.code === 0) seen.get(s).push(r.json.data.fundingRate);
      else fails++;
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  for (const s of syms) {
    const v = seen.get(s);
    const changes = v.reduce((n, x, j) => n + (j > 0 && x !== v[j - 1] ? 1 : 0), 0);
    log('funding_changes', { s, polls: v.length, changes, distinct: new Set(v).size, first: v[0], last: v[v.length - 1] });
  }
  log('funding_poll_fails', { fails });
}

async function mirror() {
  const bn = await getRetry(`${BINANCE}/premiumIndex`);
  const m = await getRetry(q('q/mark-price'));
  const a = await getRetry(q('q/agg-tickers'));
  log('reads', { binance: [bn.status, bn.ms], mgbxMark: [m.status, m.ms], mgbxAgg: [a.status, a.ms] });
  if (!bn.json || !m.json?.data) return;
  const bmap = new Map(bn.json.map((r) => [r.symbol, r]));
  const diffs = [];
  let exact = 0;
  let common = 0;
  for (const r of m.json.data) {
    const b = bmap.get(r.s.replace('_', '').toUpperCase());
    if (!b) continue;
    common++;
    const ppm = Math.round((Number(r.p) / Number(b.markPrice) - 1) * 1e6);
    diffs.push(Math.abs(ppm));
    if (Number(r.p) === Number(b.markPrice)) exact++;
  }
  log('mark_vs_binance_mark', { common, exactEqual: exact, absPpm: stats(diffs) });
  const toIndex = [];
  let exactIndex = 0;
  for (const r of m.json.data) {
    const b = bmap.get(r.s.replace('_', '').toUpperCase());
    if (!b) continue;
    toIndex.push(Math.abs(Math.round((Number(r.p) / Number(b.indexPrice) - 1) * 1e6)));
    if (Number(r.p) === Number(b.indexPrice)) exactIndex++;
  }
  log('mark_vs_binance_index', { common: toIndex.length, exactEqual: exactIndex, absPpm: stats(toIndex) });
  const idiffs = [];
  for (const r of a.json?.data ?? []) {
    const b = bmap.get(r.s.replace('_', '').toUpperCase());
    if (b) idiffs.push(Math.abs(Math.round((Number(r.i) / Number(b.indexPrice) - 1) * 1e6)));
  }
  log('agg_index_vs_binance_index', { absPpm: stats(idiffs) });
  const f = [];
  for (const s of ['btc_usdt', 'eth_usdt', 'sol_usdt', 'doge_usdt', 'xrp_usdt', 'pepe_usdt']) {
    const r = await get(q(`q/funding-rate?symbol=${s}`));
    const b = bmap.get(s.replace('_', '').toUpperCase());
    f.push({ s, mgbx: r.json?.data?.fundingRate, mgbxCap: r.json?.data?.fundingRateUpperLimit, mgbxNext: r.json?.data?.nextCollectionTime, binance: b?.lastFundingRate, binanceNext: b?.nextFundingTime });
    await sleep(300);
  }
  log('funding_vs_binance', { rows: f });
  // Book: MGBX 20 levels against Binance 20 levels on BTC and ETH, read back to back.
  for (const s of ['btc_usdt', 'eth_usdt']) {
    const bsym = s.replace('_', '').toUpperCase();
    const md = await get(q(`q/depth?symbol=${s}&level=20`));
    const bd = await get(`${BINANCE}/depth?symbol=${bsym}&limit=20`);
    const mb = md.json?.data;
    const bb = bd.json;
    if (!mb || !bb) continue;
    const bPrices = new Set([...bb.bids, ...bb.asks].map((l) => Number(l[0])));
    const shared = [...mb.b, ...mb.a].filter((l) => bPrices.has(Number(l[0]))).length;
    log('book_vs_binance', { s, mgbxTouch: [mb.b[0], mb.a[0]], binanceTouch: [bb.bids[0], bb.asks[0]], mgbxLevelsAtBinancePrices: `${shared} of ${mb.b.length + mb.a.length}`, readGapMs: bd.ms });
  }
}

async function book() {
  const list = await getRetry(q('symbol/list'));
  const cs = new Map((list.json?.data ?? []).map((x) => [x.symbol, x.contractSize]));
  for (const level of [1, 5, 10, 20, 50, 100, 200, 500, 1000]) {
    const r = await get(q(`q/depth?symbol=btc_usdt&level=${level}`));
    const d = r.json?.data;
    log('depth_level', { level, status: r.status, code: r.json?.code, msg: r.json?.code !== 0 ? r.json?.msg : undefined, bids: d?.b?.length, asks: d?.a?.length, ms: r.ms, bytes: r.bytes });
    await sleep(300);
  }
  for (const s of ['btc_usdt', 'eth_usdt', 'doge_usdt', 'xau_usdt', 'aapl_usdt']) {
    const r = await get(q(`q/depth?symbol=${s}&level=50`));
    const d = r.json?.data;
    if (!d) {
      log('depth', { s, status: r.status, error: r.error });
      continue;
    }
    const desc = d.b.every((l, j) => j === 0 || Number(l[0]) < Number(d.b[j - 1][0]));
    const asc = d.a.every((l, j) => j === 0 || Number(l[0]) > Number(d.a[j - 1][0]));
    const types = countBy([...d.b, ...d.a].flat(), (v) => typeof v);
    const sci = [...d.b, ...d.a].filter((l) => /e/i.test(String(l[1]))).length;
    const touchCoins = Number(d.b[0][1]) * Number(cs.get(s));
    log('depth', { s, keys: Object.keys(d), uRaw: r.text.match(/"u":(\d+)/)?.[1], uType: typeof d.u, tAgeMs: Date.now() - d.t, bids: d.b.length, asks: d.a.length, bidsDesc: desc, asksAsc: asc, types, sciSizes: sci, touch: [d.b[0], d.a[0]], contractSize: cs.get(s), bidTouchCoins: touchCoins });
    await sleep(300);
  }
  // Caching: two reads back to back.
  const r1 = await get(q('q/depth?symbol=btc_usdt&level=20'));
  const r2 = await get(q('q/depth?symbol=btc_usdt&level=20'));
  log('cache', { u1: r1.text?.match(/"u":(\d+)/)?.[1], u2: r2.text?.match(/"u":(\d+)/)?.[1], t1: r1.json?.data?.t, t2: r2.json?.data?.t, cacheHeaders: [r1.headers?.get('cache-control'), r1.headers?.get('x-cache'), r1.headers?.get('age')] });
}

async function errors() {
  const cases = [
    ['unknown symbol, depth', q('q/depth?symbol=nope_usdt&level=20')],
    ['missing level, depth', q('q/depth?symbol=btc_usdt')],
    ['bad level, depth', q('q/depth?symbol=btc_usdt&level=7')],
    ['unknown symbol, mark', q('q/mark-price?symbol=nope_usdt')],
    ['missing symbol, funding', q('q/funding-rate')],
    ['uppercase symbol, mark', q('q/mark-price?symbol=BTC_USDT')],
    ['unknown path', q('q/nope')],
    ['tickers path', q('q/tickers')],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, error: r.error, ms: r.ms, body: r.text?.slice(0, 160), retryAfter: r.headers?.get('retry-after') ?? null });
    await sleep(500);
  }
}

async function clock() {
  // Binance serverTime, read at the midpoint of a warm request, bounds the local clock offset to within half a round trip.
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const b = await get(`${BINANCE}/time`);
    const t1 = Date.now();
    log('local_vs_binance', { status: b.status, rttMs: t1 - t0, offsetMs: b.json?.serverTime ? b.json.serverTime - Math.round((t0 + t1) / 2) : null });
    await sleep(500);
  }
  // The server time call is not in the web app bundle. It answered on 2026-09-24 when tried by hand.
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const r = await get(q('time'));
    const t1 = Date.now();
    log('server_time', { status: r.status, rttMs: t1 - t0, body: r.text?.slice(0, 80), offsetMs: typeof r.json?.data === 'number' ? r.json.data - Math.round((t0 + t1) / 2) : null });
    await sleep(500);
  }
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(q('q/mark-price?symbol=btc_usdt'));
    const t1 = Date.now();
    const date = r.headers?.get('date');
    const replyT = r.json?.data?.[0]?.t;
    log('clock', { status: r.status, rttMs: t1 - t0, dateHeader: date, dateOffsetMs: date ? Date.parse(date) - Math.round((t0 + t1) / 2) : null, markTAgeMs: replyT ? t1 - replyT : null, server: r.headers?.get('server'), via: r.headers?.get('via'), rateLimit: ['remaining', 'requested-tokens', 'burst-capacity', 'replenish-rate'].map((h) => r.headers?.get(`x-ratelimit-${h}`)) });
    await sleep(1000);
  }
}

const modes = { latency, catalog, anchor, funding, fundingpoll, mirror, book, errors, clock };
const mode = process.argv[2] ?? 'catalog';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
