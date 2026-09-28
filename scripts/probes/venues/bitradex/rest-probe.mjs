// BitradeX REST probe: what the venue's hosts answer to this host, and what the Wayback Machine holds of its futures API.
// BitradeX publishes no API documentation, so every path here is one the www.bitradex.ai web app calls, read from its _app JavaScript bundle on static3.bitradex.mobi.
// Public, unauthenticated, read-only. It sends one request at a time, at most about 2 a second, and every request times out after 10 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitradex/rest-probe.mjs [access|latency|catalog|anchor|funding|mirror|book|clock|archive]
//   access   Cloudflare trace of this host's exit, DNS of every BitradeX host, then status, headers and body of the site, the futures API paths and api.bitradex.com.
//            Node's fetch is used on purpose: the site answers the user agent curl/<version> with HTTP 456 and any other agent with 200.
//   latency  10 cold requests on fresh connections and 20 warm requests on one kept-alive connection to /time.
//   catalog  public/symbol/list: counts by type, state, switches and fee, contract sizes, then the fee steps of user/public/user/step-rate/getStepRates.
//   anchor   60 polls at 1 s of q/agg-tickers: reply time and size, symbol count, how often index and mark changed, mark against index. About 70 s.
//   funding  q/funding-rate for every trading perpetual at 2 a second, then funding-rate-record on btc_usdt. About 35 s.
//   mirror   one read of BitradeX mark, index and best prices against Binance USDT-M premiumIndex and bookTicker on common symbols.
//   book     q/depth at levels 5, 20, 50, 1000, level order, number types, two back to back reads for caching.
//   clock    /time against the local clock, five reads.
//   archive  reads the Wayback Machine captures of the futures API (fee steps, symbol list, index, mark, funding, depth, tickers) and prints a summary.
//            These are the venue's own replies as archived by web.archive.org, not calls to the venue.
// Set PROBE_OUT_DIR to keep the replies. Recorded in docs/profiles/bitradex/rest.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    const body = await res.text();
    const ms = Math.round(performance.now() - t0);
    const h = res.headers;
    return { status: res.status, ms, bytes: body.length, body, server: h.get('server'), cfRay: h.get('cf-ray'), location: h.get('location'), contentType: h.get('content-type') };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), error: String(e.cause?.code ?? e.message) };
  }
}

const HOSTS = ['www.bitradex.ai', 'api.bitradex.ai', 'fws.bitradex.ai', 'sws.bitradex.ai', 'www.bitradex.com', 'api.bitradex.com', 'static3.bitradex.mobi'];
const FUT = '/v1/future-u/market';
const PATHS = [
  'https://www.bitradex.ai/',
  'https://www.bitradex.ai/en/futures/trade/btc_usdt',
  `https://www.bitradex.ai${FUT}/public/symbol/list`,
  `https://www.bitradex.ai${FUT}/v2/public/symbol/list`,
  `https://www.bitradex.ai${FUT}/public/q/tickers`,
  `https://www.bitradex.ai${FUT}/public/q/index-price`,
  `https://www.bitradex.ai${FUT}/public/q/mark-price`,
  `https://www.bitradex.ai${FUT}/public/q/funding-rate?symbol=btc_usdt`,
  `https://www.bitradex.ai${FUT}/public/q/depth?symbol=btc_usdt&level=20`,
  'https://www.bitradex.ai/v1/future-u/user/public/user/step-rate/getStepRates',
  'https://api.bitradex.ai/',
  'https://www.bitradex.com/',
  `https://api.bitradex.com${FUT}/public/q/tickers`,
];

async function access() {
  const trace = await get('https://www.cloudflare.com/cdn-cgi/trace');
  const t = Object.fromEntries((trace.body ?? '').trim().split('\n').map((l) => l.split('=')));
  log('exit', { loc: t.loc, colo: t.colo, ipFamily: t.ip?.includes(':') ? 'v6' : 'v4' });
  for (const h of HOSTS) {
    try {
      const a = await lookup(h, { all: true });
      log('dns', { host: h, addrs: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host: h, error: e.code });
    }
  }
  for (const url of PATHS) {
    const r = await get(url);
    log('get', { url, status: r.status, ms: r.ms, bytes: r.bytes, body: r.body?.slice(0, 60), server: r.server, cfRay: r.cfRay, location: r.location, error: r.error });
    await sleep(500);
  }
}

const WB = 'https://web.archive.org/web';
const ARCHIVED = {
  steps: ['20260914110643', '/v1/future-u/user/public/user/step-rate/getStepRates'],
  symbols: ['20260914110842', `${FUT}/public/symbol/list`],
  index: ['20260916100222', `${FUT}/public/q/index-price`],
  mark: ['20260916100222', `${FUT}/public/q/mark-price`],
  funding: ['20260916100222', `${FUT}/public/q/funding-rate?symbol=btc_usdt`],
  ticker: ['20260916100222', `${FUT}/public/q/ticker?symbol=btc_usdt`],
  depth: ['20260916100223', `${FUT}/public/q/depth?symbol=btc_usdt&limit=1000&level=1000`],
};

async function archive() {
  const j = {};
  for (const [name, [ts, path]] of Object.entries(ARCHIVED)) {
    const r = await get(`${WB}/${ts}id_/https://www.bitradex.ai${path}`);
    log('wayback', { name, requested: ts, status: r.status, bytes: r.bytes, error: r.error });
    if (r.status === 200) {
      keep(`${name}.json`, r.body);
      try { j[name] = JSON.parse(r.body); } catch { log('parse', { name, head: r.body.slice(0, 80) }); }
    }
    await sleep(700);
  }
  if (j.steps) for (const s of j.steps.data) log('step', { name: s.stepName, vol: s.tradeVolume, maker: s.makerFee, taker: s.takerFee, retentionDays: s.levelRetentionDay, updated: s.updatedTime });
  if (j.symbols) {
    const s = j.symbols.data;
    const count = (k) => s.reduce((m, x) => ({ ...m, [x[k]]: (m[x[k]] ?? 0) + 1 }), {});
    log('symbols', { ts: j.symbols.ts, n: s.length, contractType: count('contractType'), underlyingType: count('underlyingType'), quoteCoin: count('quoteCoin'), tradeSwitch: count('tradeSwitch'), isDisplay: count('isDisplay'), isOpenApi: count('isOpenApi'), makerFee: count('makerFee'), takerFee: count('takerFee') });
    log('openApi', { symbols: s.filter((x) => x.isOpenApi).map((x) => x.symbol) });
    log('feeOutliers', { rows: s.filter((x) => x.makerFee !== '0.0004' || x.takerFee !== '0.0006').map((x) => `${x.symbol} ${x.makerFee}/${x.takerFee}`) });
    const btc = s.find((x) => x.symbol === 'btc_usdt');
    log('btc', { contractSize: btc.contractSize, minQty: btc.minQty, liquidationFee: btc.liquidationFee, multiplierUp: btc.multiplierUp, multiplierDown: btc.multiplierDown, marketTakeBound: btc.marketTakeBound });
  }
  for (const k of ['index', 'mark']) {
    const d = j[k];
    if (!d) continue;
    const ts = d.data.map((x) => x.t);
    const stale = d.data.filter((x) => d.ts - x.t > 60_000).map((x) => x.s);
    log(k, { replyTs: d.ts, n: d.data.length, oldestT: Math.min(...ts), newestT: Math.max(...ts), staleOver60s: stale.length, btc: d.data.find((x) => x.s === 'btc_usdt') });
  }
  if (j.funding) log('funding', { ...j.funding.data, ts: j.funding.ts });
  if (j.ticker) log('ticker', { ...j.ticker.data, ts: j.ticker.ts });
  if (j.depth) {
    const d = j.depth.data;
    const desc = d.b.every((x, i) => i === 0 || Number(x[0]) < Number(d.b[i - 1][0]));
    const asc = d.a.every((x, i) => i === 0 || Number(x[0]) > Number(d.a[i - 1][0]));
    log('depth', { t: d.t, u: d.u, bids: d.b.length, asks: d.a.length, bidsDescending: desc, asksAscending: asc, topBid: d.b[0], topAsk: d.a[0], sizeType: typeof d.b[0][1] });
  }
}

const PUB = 'https://www.bitradex.ai/v1/future-u/market/public';
const json = async (path) => {
  const t0 = performance.now();
  const r = await fetch(PUB + path, { signal: AbortSignal.timeout(10_000) });
  const body = await r.text();
  return { status: r.status, ms: performance.now() - t0, bytes: body.length, j: JSON.parse(body) };
};
const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return Math.round(b[Math.min(b.length - 1, Math.floor(q * b.length))]); };

async function latency() {
  const cold = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await fetch(`${PUB}/time`, { signal: AbortSignal.timeout(10_000), headers: { connection: 'close' } }).then((r) => r.text());
    cold.push(performance.now() - t0);
    await sleep(300);
  }
  const warm = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await fetch(`${PUB}/time`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.text());
    warm.push(performance.now() - t0);
    await sleep(300);
  }
  log('latency', { coldMedian: pct(cold, 0.5), coldMax: pct(cold, 1), warmMedian: pct(warm, 0.5), warmP90: pct(warm, 0.9), warmMax: pct(warm, 1) });
}

async function catalog() {
  const { ms, bytes, j } = await json('/symbol/list');
  const s = j.data;
  const count = (k) => s.reduce((m, x) => ({ ...m, [x[k]]: (m[x[k]] ?? 0) + 1 }), {});
  log('catalog', { ms: Math.round(ms), bytes, n: s.length, contractType: count('contractType'), state: count('state'), quoteCoin: count('quoteCoin'), underlyingType: count('underlyingType'), tradeSwitch: count('tradeSwitch'), openSwitch: count('openSwitch'), isDisplay: count('isDisplay'), isOpenApi: count('isOpenApi') });
  const t = s.filter((x) => x.tradeSwitch);
  log('trading', { n: t.length, makerFee: t.reduce((m, x) => ({ ...m, [x.makerFee]: (m[x.makerFee] ?? 0) + 1 }), {}), takerFee: t.reduce((m, x) => ({ ...m, [x.takerFee]: (m[x.takerFee] ?? 0) + 1 }), {}) });
  log('feeOutliers', { rows: s.filter((x) => x.makerFee !== '0.0004' || x.takerFee !== '0.0006').map((x) => `${x.symbol} ${x.makerFee}/${x.takerFee} trade=${x.tradeSwitch}`) });
  log('openApi', { symbols: s.filter((x) => x.isOpenApi).map((x) => x.symbol) });
  log('hidden', { symbols: s.filter((x) => !x.tradeSwitch).map((x) => x.symbol) });
  log('sizes', { rows: t.map((x) => `${x.symbol}:${x.contractSize}`).join(' ') });
  const pairs = t.reduce((m, x) => ({ ...m, [x.baseCoin]: (m[x.baseCoin] ?? 0) + 1 }), {});
  log('twice', { bases: Object.entries(pairs).filter(([, n]) => n > 1) });
  const st = await fetch('https://www.bitradex.ai/v1/future-u/user/public/user/step-rate/getStepRates', { signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
  for (const x of st.data) log('step', { name: x.stepName, vol: x.tradeVolume, maker: x.makerFee, taker: x.takerFee, retentionDays: x.levelRetentionDay, updated: x.updatedTime });
  const btc = s.find((x) => x.symbol === 'btc_usdt');
  log('btc', { contractSize: btc.contractSize, liquidationFee: btc.liquidationFee, multiplierUp: btc.multiplierUp, multiplierDown: btc.multiplierDown, marketTakeBound: btc.marketTakeBound, pricePrecision: btc.pricePrecision, quantityPrecision: btc.quantityPrecision, keys: Object.keys(btc).length });
}

async function anchor() {
  const last = new Map();
  const changes = { i: 0, m: 0 };
  const times = [], sizes = [], counts = [];
  let spreads = [];
  let prevAgeMax = 0;
  for (let k = 0; k < 60; k++) {
    const t0 = Date.now();
    try {
      const { ms, bytes, j } = await json('/q/agg-tickers');
      times.push(ms); sizes.push(bytes); counts.push(j.data.length);
      for (const x of j.data) {
        const p = last.get(x.s);
        if (p) { if (p.i !== x.i) changes.i++; if (p.m !== x.m) changes.m++; }
        last.set(x.s, x);
        prevAgeMax = Math.max(prevAgeMax, Date.now() - x.t);
      }
      if (k === 59) spreads = j.data.map((x) => ({ s: x.s, ppm: Math.round((Number(x.m) / Number(x.i) - 1) * 1e6) }));
    } catch (e) { log('pollError', { k, e: e.message }); }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  const n = last.size;
  log('anchor', { polls: times.length, symbols: n, countsSeen: [...new Set(counts)], msMedian: pct(times, 0.5), msP90: pct(times, 0.9), msMax: pct(times, 1), bytesMedian: pct(sizes, 0.5), indexChangesPerSymbolPerMin: +(changes.i / n).toFixed(1), markChangesPerSymbolPerMin: +(changes.m / n).toFixed(1), maxTickerAgeMs: prevAgeMax });
  spreads.sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm));
  log('markVsIndex', { medianAbsPpm: pct(spreads.map((x) => Math.abs(x.ppm)), 0.5), top: spreads.slice(0, 6) });
  const btc = last.get('btc_usdt');
  log('btcRow', btc);
}

async function funding() {
  const { j } = await json('/symbol/list');
  const syms = j.data.filter((x) => x.tradeSwitch).map((x) => x.symbol);
  const rows = [];
  for (const s of syms) {
    try { const r = await json(`/q/funding-rate?symbol=${s}`); rows.push({ s, ...r.j.data, ms: r.ms }); } catch (e) { log('fundErr', { s, e: e.message }); }
    await sleep(500);
  }
  const by = (k) => rows.reduce((m, x) => ({ ...m, [x[k]]: (m[x[k]] ?? 0) + 1 }), {});
  log('funding', { n: rows.length, interval: by('collectionInternal'), next: Object.fromEntries(Object.entries(by('nextCollectionTime')).map(([k, v]) => [new Date(Number(k)).toISOString(), v])), rates: by('fundingRate'), msMedian: pct(rows.map((x) => x.ms), 0.5) });
  log('fundingOdd', { notEight: rows.filter((x) => x.collectionInternal !== 8).map((x) => `${x.s} ${x.collectionInternal}h next ${new Date(x.nextCollectionTime).toISOString()}`), topAbs: [...rows].sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate)).slice(0, 6).map((x) => `${x.s} ${x.fundingRate}`) });
  const rec = await json('/q/funding-rate-record?symbol=btc_usdt');
  log('record', { items: rec.j.data.items.slice(0, 6).map((x) => `${new Date(x.createdTime).toISOString()} ${x.fundingRate} ${x.collectionInternal}`), hasNext: rec.j.data.hasNext });
}

async function mirror() {
  const { j } = await json('/q/agg-tickers');
  const bx = new Map(j.data.map((x) => [x.s, x]));
  const pi = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
  const bt = await fetch('https://fapi.binance.com/fapi/v1/ticker/bookTicker', { signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
  const bn = new Map(pi.map((x) => [x.symbol, x]));
  const bb = new Map(bt.map((x) => [x.symbol, x]));
  const rows = [];
  for (const [s, x] of bx) {
    const sym = s.replace('_', '').toUpperCase();
    const b = bn.get(sym), k = bb.get(sym);
    if (!b || !k) continue;
    rows.push({ s, indexPpm: Math.round((Number(x.i) / Number(b.indexPrice) - 1) * 1e6), markPpm: Math.round((Number(x.m) / Number(b.markPrice) - 1) * 1e6), bidPpm: Math.round((Number(x.bp) / Number(k.bidPrice) - 1) * 1e6), askPpm: Math.round((Number(x.ap) / Number(k.askPrice) - 1) * 1e6), bnFunding: b.lastFundingRate });
  }
  const abs = (k) => rows.map((r) => Math.abs(r[k]));
  log('mirror', { common: rows.length, of: bx.size, indexMedianAbsPpm: pct(abs('indexPpm'), 0.5), markMedianAbsPpm: pct(abs('markPpm'), 0.5), bidMedianAbsPpm: pct(abs('bidPpm'), 0.5), askMedianAbsPpm: pct(abs('askPpm'), 0.5) });
  for (const s of ['btc_usdt', 'eth_usdt', 'xmr_usdt', 'sol_usdt']) log('mirrorRow', rows.find((r) => r.s === s) ?? { s, missing: true });
}

async function bookMode() {
  for (const level of [5, 20, 50, 1000]) {
    const { ms, bytes, j } = await json(`/q/depth?symbol=btc_usdt&level=${level}`);
    const d = j.data;
    log('depth', { level, ms: Math.round(ms), bytes, bids: d.b.length, asks: d.a.length, u: d.u, uType: typeof d.u, sizeType: typeof d.b[0][1], bidsDesc: d.b.every((l, i) => !i || Number(l[0]) < Number(d.b[i - 1][0])), asksAsc: d.a.every((l, i) => !i || Number(l[0]) > Number(d.a[i - 1][0])) });
    await sleep(500);
  }
  const a = await json('/q/depth?symbol=eth_usdt&level=20');
  const b = await json('/q/depth?symbol=eth_usdt&level=20');
  log('cache', { u1: a.j.data.u, u2: b.j.data.u, t1: a.j.data.t, t2: b.j.data.t });
}

async function clock() {
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const { j } = await json('/time');
    const t1 = Date.now();
    log('clock', { rttMs: t1 - t0, offsetMs: j.data - Math.round((t0 + t1) / 2) });
    await sleep(500);
  }
}

const mode = process.argv[2] ?? 'access';
const modes = { access, latency, catalog, anchor, funding, mirror, book: bookMode, clock, archive };
if (modes[mode]) await modes[mode]();
else console.log(`modes: ${Object.keys(modes).join(' | ')}`);
