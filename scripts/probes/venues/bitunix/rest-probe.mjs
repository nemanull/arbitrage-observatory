// Bitunix futures REST probe: host and latency, catalog by family, the bulk anchor call over a minute, funding units and history, REST book, errors and clock.
// Public, unauthenticated, read-only. It sends at most three requests at once and averages under 2 a second, well inside the documented 10 per second per IP.
// Run from server/: node ../scripts/probes/venues/bitunix/rest-probe.mjs [latency|catalog|anchor|units|history|book|errors|clock]
//   latency  DNS, 5 cold and 10 warm requests.
//   catalog  whether CCXT has a class, then trading_pairs by quote, status and API flag, cross-checked with tickers and funding_rate/batch.
//   anchor   60 polls of funding_rate/batch at 1 s: reply time and size, and how often each field changed. About 65 s.
//   units    funding_rate/batch against Binance premiumIndex on common symbols, to settle whether the rate is a percent or a fraction.
//   history  funding history on seven symbols, spacing and the last settled rate.
//   book     REST depth at every limit, level order, number types, caching.
//   errors   unknown symbol, missing parameter, bad limit and unknown path.
//   clock    the Date header against the local clock.
// Set PROBE_OUT_DIR to keep the last anchor reply. Recorded in docs/profiles/bitunix/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'fapi.bitunix.com';
const API = `https://${HOST}/api/v1/futures/market`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true });

function pct(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// A raw https GET, so cold and warm timings and headers are visible.
function get(url, agent = warmAgent) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.get(url, { agent, headers: { 'user-agent': 'observatory-probe' } }, (res) => {
      let ttfb = null;
      const chunks = [];
      res.on('data', (c) => {
        if (ttfb === null) ttfb = performance.now() - t0;
        chunks.push(c);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, bytes: body.length, ms: performance.now() - t0, ttfb });
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });
}

async function json(path) {
  const r = await get(`${API}/${path}`);
  return { ...r, json: JSON.parse(r.body) };
}

async function latency() {
  log('dns', { a: await dns.resolve4(HOST), cname: await dns.resolveCname(HOST).catch((e) => e.code) });
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${API}/funding_rate?symbol=BTCUSDT`, new https.Agent({ keepAlive: false }));
    cold.push(Math.round(r.ms));
    await sleep(500);
  }
  const warm = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${API}/funding_rate?symbol=BTCUSDT`);
    warm.push(Math.round(r.ms));
    await sleep(500);
  }
  const h = (await get(`${API}/funding_rate?symbol=BTCUSDT`)).headers;
  log('latency', { coldMs: cold, warmMs: warm, warmMedian: pct(warm, 50), server: h.server, cfRay: h['cf-ray'], cache: h['cf-cache-status'], upstreamMs: h['x-envoy-upstream-service-time'] });
}

async function catalog() {
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, bitunixLike: ccxt.exchanges.filter((e) => /unix/i.test(e)) });
  const [pairs, tickers, fr] = await Promise.all([json('trading_pairs'), json('tickers'), json('funding_rate/batch')]);
  const p = pairs.json.data;
  const byKey = {};
  for (const d of p) {
    const k = `${d.quote}|${d.symbolStatus}|api=${d.isApiSupported}`;
    byKey[k] = (byKey[k] ?? 0) + 1;
  }
  log('catalog', { bytes: pairs.bytes, ms: Math.round(pairs.ms), rows: p.length, byKey, fields: Object.keys(p[0]) });
  const idOk = p.filter((d) => d.symbol === `${d.base}${d.quote}`).length;
  const bases = {};
  for (const d of p.filter((x) => x.symbolStatus === 'OPEN')) (bases[d.base] ??= []).push(d.quote);
  const multi = Object.entries(bases).filter(([, q]) => q.length > 1);
  log('catalog_ids', {
    symbolIsBasePlusQuote: idOk,
    of: p.length,
    basesListedTwiceOrMore: multi.length,
    quoteCombos: Object.entries(multi.reduce((m, [, q]) => ((m[q.sort().join('+')] = (m[q.sort().join('+')] ?? 0) + 1), m), {})),
    scaledBases: p.filter((d) => /^(10+)[A-Z]/.test(d.base) || /^(10+)[A-Z]/.test(d.symbol)).map((d) => d.symbol).slice(0, 40),
    nonUpper: p.filter((d) => !/^[A-Z0-9]+$/.test(d.symbol)).map((d) => d.symbol),
  });
  const ps = new Set(p.map((d) => d.symbol));
  const ts = new Set(tickers.json.data.map((d) => d.symbol));
  const fs = new Set(fr.json.data.map((d) => d.symbol));
  const onlyFr = fr.json.data.filter((d) => !ps.has(d.symbol));
  const now = Date.now();
  log('catalog_cross', {
    tickersRows: ts.size,
    fundingRows: fs.size,
    catalogNotInTickers: [...ps].filter((s) => !ts.has(s)),
    catalogNotInFunding: [...ps].filter((s) => !fs.has(s)),
    tickersNotInCatalog: [...ts].filter((s) => !ps.has(s)).length,
    fundingNotInCatalog: onlyFr.length,
    fundingNotInCatalogSample: onlyFr.slice(0, 6).map((d) => d.symbol),
    fundingNotInCatalogRateNonZero: onlyFr.filter((d) => Number(d.fundingRate) !== 0).length,
    fundingNotInCatalogNextWithin5sOfNow: onlyFr.filter((d) => Math.abs(Number(d.nextFundingTime) - now) < 5000).length,
    fundingNullIndex: fr.json.data.filter((d) => d.indexPrice === null).map((d) => d.symbol),
    fundingZeroMark: fr.json.data.filter((d) => Number(d.markPrice) === 0).map((d) => d.symbol),
  });
  const preview = p.filter((d) => d.symbolStatus !== 'OPEN');
  log('catalog_preview', { rows: preview.map((d) => ({ symbol: d.symbol, status: d.symbolStatus, fr: fr.json.data.find((f) => f.symbol === d.symbol) })) });
  log('catalog_api_disabled', { n: p.filter((d) => !d.isApiSupported).length, symbols: p.filter((d) => !d.isApiSupported).map((d) => d.symbol).join(' ') });
  const caps = {};
  for (const d of p) caps[d.maxFundingRate] = (caps[d.maxFundingRate] ?? 0) + 1;
  log('catalog_caps', { maxFundingRate: caps, symmetric: p.filter((d) => Number(d.maxFundingRate) === -Number(d.minFundingRate)).length });
}

async function anchor() {
  const times = [];
  const sizes = [];
  const watch = ['BTCUSDT', 'ETHUSDT', 'ARIAUSDT', 'BTCUSD', 'BTCUSDC', 'GUSDT', 'LSKUSDT'];
  const prev = new Map();
  const changes = new Map(watch.map((s) => [s, { indexPrice: 0, markPrice: 0, fundingRate: 0, nextFundingTime: 0 }]));
  const still = new Map(watch.map((s) => [s, { markPrice: { run: 0, max: 0 }, indexPrice: { run: 0, max: 0 } }]));
  let rateChangedRows = new Set();
  let rowsChanged = { indexPrice: 0, markPrice: 0 };
  let first = null;
  let last = null;
  const offRound = { rows: new Set(), ageMs: [] };
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    const r = await json('funding_rate/batch');
    times.push(Math.round(r.ms));
    sizes.push(r.bytes);
    const rows = new Map(r.json.data.map((d) => [d.symbol, d]));
    if (!first) first = rows;
    // Rows that are not on the hour carry no settlement, and their distance from the reply shows what the field holds instead.
    for (const d of r.json.data) {
      if (Number(d.nextFundingTime) % 3_600_000 === 0) continue;
      offRound.rows.add(d.symbol);
      offRound.ageMs.push(Date.now() - Number(d.nextFundingTime));
    }
    for (const [sym, d] of rows) {
      const p = prev.get(sym);
      if (!p) continue;
      if (p.fundingRate !== d.fundingRate) rateChangedRows.add(sym);
      if (p.indexPrice !== d.indexPrice) rowsChanged.indexPrice++;
      if (p.markPrice !== d.markPrice) rowsChanged.markPrice++;
      if (changes.has(sym)) {
        for (const f of Object.keys(changes.get(sym))) if (p[f] !== d[f]) changes.get(sym)[f]++;
        // The longest stretch of polls over which the mark or the index did not move.
        const st = still.get(sym);
        for (const f of ['markPrice', 'indexPrice']) {
          st[f].run = p[f] === d[f] ? st[f].run + 1 : 0;
          st[f].max = Math.max(st[f].max, st[f].run);
        }
      }
    }
    prev.clear();
    for (const [k, v] of rows) prev.set(k, v);
    last = r;
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  log('anchor_times', { polls: times.length, minMs: pct(times, 0), medMs: pct(times, 50), p90Ms: pct(times, 90), maxMs: pct(times, 100), over1s: times.filter((t) => t > 1000).length, bytes: pct(sizes, 50), rows: prev.size, contentEncoding: last.headers['content-encoding'] ?? null });
  log('anchor_still', { longestUnchangedPolls: Object.fromEntries([...still].map(([k, v]) => [k, { mark: v.markPrice.max, index: v.indexPrice.max }])) });
  log('anchor_changes', { perSymbol: Object.fromEntries(changes), rowsWithRateChange: rateChangedRows.size, sampleRateChanges: [...rateChangedRows].slice(0, 5).map((s) => [s, first.get(s)?.fundingRate, prev.get(s)?.fundingRate]), rowChangeCounts: rowsChanged });
  // The documented mark is a median that includes the last price, so a mark equal to the last trade is that median at work.
  const onHour = last.json.data.filter((d) => Number(d.nextFundingTime) % 3_600_000 === 0 && Number(d.indexPrice) > 0);
  const premiumPpm = onHour.map((d) => Math.abs(Number(d.markPrice) / Number(d.indexPrice) - 1) * 1e6);
  log('anchor_mark_shape', { rows: onHour.length, markEqualsLast: onHour.filter((d) => d.markPrice === d.lastPrice).length, absPremiumPpm: { med: Math.round(pct(premiumPpm, 50)), p90: Math.round(pct(premiumPpm, 90)), p99: Math.round(pct(premiumPpm, 99)), max: Math.round(pct(premiumPpm, 100)) } });
  log('anchor_off_round', { rows: offRound.rows.size, replyMinusNextMs: { min: pct(offRound.ageMs, 0), med: pct(offRound.ageMs, 50), max: pct(offRound.ageMs, 100) } });
  const wantFirst = watch.map((s) => prev.get(s));
  log('anchor_rows', { rows: wantFirst });
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `funding-batch-${Date.now()}.json`), last.body);
  }
}

// Binance premiumIndex publishes the predicted rate as a fraction, so the ratio tells the unit.
async function units() {
  const bx = (await json('funding_rate/batch')).json.data;
  const bn = await new Promise((resolve, reject) => {
    https.get('https://fapi.binance.com/fapi/v1/premiumIndex', (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => resolve(JSON.parse(s)));
    }).on('error', reject);
  });
  const bnMap = new Map(bn.map((d) => [d.symbol, Number(d.lastFundingRate)]));
  const ratios = [];
  const signAgree = [];
  let exact = 0;
  let common = 0;
  let offDefault = 0;
  let offDefaultExact = 0;
  const offDefaultRatio = [];
  const exactValues = {};
  const DEFAULT_RATES = new Set([0.0001, 0.00005, 0.000025, 0.0000125, 0]);
  for (const d of bx) {
    const b = bnMap.get(d.symbol);
    if (b !== undefined) {
      common++;
      if (Math.abs(Number(d.fundingRate) / 100 - b) < 1e-9) {
        exact++;
        exactValues[b] = (exactValues[b] ?? 0) + 1;
      }
      // A rate at the interest-rate default of either venue says nothing about copying, so the test that matters is on the other rows.
      if (!DEFAULT_RATES.has(b)) {
        offDefault++;
        if (Math.abs(Number(d.fundingRate) / 100 - b) < 1e-9) offDefaultExact++;
        offDefaultRatio.push(Number(d.fundingRate) / 100 / b);
      }
    }
    if (b === undefined || Math.abs(b) < 0.00005 || Number(d.fundingRate) === 0) continue;
    ratios.push(Number(d.fundingRate) / b);
    signAgree.push(Math.sign(Number(d.fundingRate)) === Math.sign(b));
  }
  // Index and mark against Binance on the same symbols, in ppm, to see whether the prices are mirrored too.
  const bnRow = new Map(bn.map((d) => [d.symbol, d]));
  const idxPpm = [];
  const markPpm = [];
  let idxEqual = 0;
  let markEqual = 0;
  for (const d of bx) {
    const b = bnRow.get(d.symbol);
    if (!b || !Number(d.indexPrice) || !Number(b.indexPrice)) continue;
    idxPpm.push(Math.abs(Number(d.indexPrice) / Number(b.indexPrice) - 1) * 1e6);
    markPpm.push(Math.abs(Number(d.markPrice) / Number(b.markPrice) - 1) * 1e6);
    if (Number(d.indexPrice) === Number(b.indexPrice)) idxEqual++;
    if (Number(d.markPrice) === Number(b.markPrice)) markEqual++;
  }
  log('units_prices', { compared: idxPpm.length, indexAbsPpm: { med: Math.round(pct(idxPpm, 50)), p90: Math.round(pct(idxPpm, 90)), max: Math.round(pct(idxPpm, 100)) }, markAbsPpm: { med: Math.round(pct(markPpm, 50)), p90: Math.round(pct(markPpm, 90)), max: Math.round(pct(markPpm, 100)) }, idxEqual, markEqual });
  const defaults = bx.filter((d) => d.fundingRate === '0.01').length;
  const topExact = Object.entries(exactValues).sort((a, b) => b[1] - a[1]).slice(0, 4);
  log('units_copy_test', { exactMatches: exact, topExactValues: topExact, offDefaultRows: offDefault, offDefaultExact, offDefaultRatioMedian: +pct(offDefaultRatio, 50).toFixed(3), offDefaultRatioP10: +pct(offDefaultRatio, 10).toFixed(3), offDefaultRatioP90: +pct(offDefaultRatio, 90).toFixed(3) });
  log('units', { commonNonTrivial: ratios.length, ratioMedian: +pct(ratios, 50).toFixed(1), ratioP25: +pct(ratios, 25).toFixed(1), ratioP75: +pct(ratios, 75).toFixed(1), signAgree: signAgree.filter(Boolean).length, commonSymbols: common, equalToBinanceAfterDividingBy100: exact, rowsExactly0p01: defaults, rows: bx.length });
}

async function history() {
  for (const symbol of ['BTCUSDT', 'ETHUSD', 'BTCUSD', 'BTCUSDC', 'ARIAUSDT', 'GUSDT', 'LSKUSDT']) {
    const r = await json(`get_funding_rate_history?symbol=${symbol}&limit=6`);
    const rows = r.json.data ?? [];
    const spacingH = rows.slice(1).map((d, i) => (Number(rows[i].fundingTime) - Number(d.fundingTime)) / 3_600_000);
    log('history', { symbol, newestFirst: rows.slice(0, 3).map((d) => [new Date(Number(d.fundingTime)).toISOString(), d.fundingRate]), spacingH, typeOfTime: typeof rows[0]?.fundingTime });
    await sleep(500);
  }
}

async function book() {
  for (const symbol of ['BTCUSDT', 'ARIAUSDT', 'BTCUSD']) {
    for (const limit of ['1', '5', '15', '50', 'max']) {
      const r = await json(`depth?symbol=${symbol}&limit=${limit}`);
      const b = r.json.data?.bids ?? [];
      const a = r.json.data?.asks ?? [];
      const desc = b.every((l, i) => i === 0 || Number(l[0]) < Number(b[i - 1][0]));
      const asc = a.every((l, i) => i === 0 || Number(l[0]) > Number(a[i - 1][0]));
      log('rest_book', { symbol, limit, status: r.status, ms: Math.round(r.ms), bytes: r.bytes, bids: b.length, asks: a.length, bidsDesc: desc, asksAsc: asc, types: [typeof b[0]?.[0], typeof b[0]?.[1]], top: [b[0], a[0]], cache: r.headers['cf-cache-status'] });
      await sleep(500);
    }
  }
  const r1 = await json('depth?symbol=BTCUSDT&limit=15');
  await sleep(100);
  const r2 = await json('depth?symbol=BTCUSDT&limit=15');
  log('rest_book_cache', { identical: r1.body === r2.body, ageHeader: r2.headers.age ?? null, cacheControl: r2.headers['cache-control'] ?? null });
  const r3 = await json('depth?symbol=BTCUSDT');
  log('rest_book_default', { bids: r3.json.data?.bids?.length, asks: r3.json.data?.asks?.length });
}

async function errors() {
  const cases = [
    'depth?symbol=NOPEUSDT&limit=15',
    'depth?limit=15',
    'depth?symbol=BTCUSDT&limit=20',
    'depth?symbol=btcusdt&limit=1',
    'funding_rate?symbol=NOPEUSDT',
    'funding_rate?symbol=MILKUSDT',
    'trading_pairs?symbols=NOPEUSDT',
    'tickers?symbols=NOPEUSDT',
    'nope',
  ];
  for (const c of cases) {
    const r = await get(`${API}/${c}`);
    log('error_case', { path: c, status: r.status, retryAfter: r.headers['retry-after'] ?? null, body: r.body.slice(0, 220) });
    await sleep(500);
  }
}

async function clock() {
  const offsets = [];
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/funding_rate?symbol=BTCUSDT`);
    const t1 = Date.now();
    const server = Date.parse(r.headers.date);
    offsets.push(server - (t0 + t1) / 2);
    await sleep(1100 - (Date.now() % 1000));
  }
  log('clock', { dateHeaderOffsetsMs: offsets.map(Math.round), note: 'Date has one second resolution, so each offset is only good to 1,000 ms' });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { latency, catalog, anchor, units, history, book, errors, clock };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('run', { mode, at: new Date().toISOString() });
await modes[mode]();
process.exit(0);
