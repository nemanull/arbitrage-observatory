// HashKey Global REST probe: latency and clock, the catalog and what CCXT's hashkey class makes of it, the anchor calls (index, mark, funding), the REST book, tickers, error shapes and headers, and a short 1 Hz anchor poll.
// Public, unauthenticated, read-only. No API key is sent. The funding calls carry only the `timestamp` query field the venue requires.
// At most four requests a second, inside CCXT's own 100 ms throttle for this venue.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hashkey/rest-probe.mjs [main|poll]
//   main  latency, clock, catalog, CCXT, anchor calls, funding history, tickers, REST book, errors. About 25 s.
//   poll  60 one-second rounds of the bulk index and the two mark prices, and the bulk funding rate every 10 s. About 65 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/hashkey/rest.md.
import { createRequire } from 'node:module';
import https from 'node:https';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api-glb.hashkey.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });
const iso = (ms) => new Date(Number(ms)).toISOString();

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// One GET with its status, headers, body and wall time. A fresh agent makes the request cold.
function get(path, { cold = false } = {}) {
  const url = path.startsWith('http') ? path : API + path;
  const agent = cold ? new https.Agent({ keepAlive: false }) : warmAgent;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const req = https.get(url, { agent, headers: { 'user-agent': 'observatory-probe' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json, bytes: text.length, ms: +(performance.now() - t0).toFixed(1), t1: Date.now() });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e), ms: +(performance.now() - t0).toFixed(1) }));
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

const interesting = (h) => Object.fromEntries(Object.entries(h ?? {}).filter(([k]) => /ratelimit|retry|x-cache|x-amz-cf-pop|server|cache-control|age|traceid|x-mbx|limit/i.test(k)));

async function latencyAndClock() {
  const cold = [];
  for (let i = 0; i < 3; i++) {
    cold.push((await get('/api/v1/time', { cold: true })).ms);
    await sleep(300);
  }
  const warm = [];
  const offsets = [];
  await get('/api/v1/time');
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    const r = await get('/api/v1/time');
    const t1 = Date.now();
    warm.push(r.ms);
    offsets.push({ rtt: t1 - t0, offset: Number(r.json.serverTime) - (t0 + t1) / 2 });
    await sleep(300);
  }
  const ping = await get('/api/v1/ping');
  log('latency', { coldTimeMs: cold, warm: stats(warm), ping: { status: ping.status, body: ping.text } });
  // The sample with the shortest round trip bounds the offset best.
  const best = offsets.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  log('clock', { offsetMsServerMinusLocal: stats(offsets.map((x) => Math.round(x.offset))), bestSample: { rttMs: best.rtt, offsetMs: Math.round(best.offset) } });
}

async function catalog() {
  const r = await get('/api/v1/exchangeInfo');
  save('exchangeInfo.json', r.text);
  const j = r.json;
  log('exchangeInfo', { status: r.status, bytes: r.bytes, ms: r.ms, site: j.site, timezone: j.timezone, spot: j.symbols.length, contracts: j.contracts.length, options: j.options?.length, headers: interesting(r.headers) });
  const statuses = {};
  for (const s of j.symbols) statuses[`spot:${s.status}:${s.tradeStatus}`] = (statuses[`spot:${s.status}:${s.tradeStatus}`] ?? 0) + 1;
  for (const c of j.contracts) statuses[`perp:${c.status}:${c.tradeStatus}`] = (statuses[`perp:${c.status}:${c.tradeStatus}`] ?? 0) + 1;
  log('statusCounts', statuses);
  for (const c of j.contracts) {
    const f = Object.fromEntries(c.filters.map((x) => [x.filterType, x]));
    log('contract', {
      symbol: c.symbol, status: c.status, tradeStatus: c.tradeStatus, underlying: c.underlying, quoteAsset: c.quoteAsset, marginToken: c.marginToken, index: c.index,
      inverse: c.inverse, contractMultiplier: c.contractMultiplier, baseAssetPrecision: c.baseAssetPrecision, tickSize: f.PRICE_FILTER?.tickSize,
      lot: { minQty: f.LOT_SIZE?.minQty, maxQty: f.LOT_SIZE?.maxQty, stepSize: f.LOT_SIZE?.stepSize, marketOrderMaxQty: f.LOT_SIZE?.marketOrderMaxQty },
      riskLimits: c.riskLimits.length, firstRisk: c.riskLimits[0], lastRisk: c.riskLimits[c.riskLimits.length - 1],
    });
  }
  for (const probe of ['BTCUSD-PERPETUAL', 'BTCUSDT-PERPETUAL']) {
    const one = await get(`/api/v1/exchangeInfo?symbol=${probe}`);
    log('exchangeInfoOne', { symbol: probe, status: one.status, bytes: one.bytes, body: one.text.slice(0, 160) });
  }
  return j;
}

async function ccxtView() {
  const ex = new ccxt.hashkey();
  const t0 = performance.now();
  await ex.loadMarkets();
  const ms = Math.round(performance.now() - t0);
  const all = Object.values(ex.markets);
  const swaps = all.filter((m) => m.swap);
  log('ccxt', { version: ccxt.version, ms, markets: all.length, spot: all.filter((m) => m.spot).length, swaps: swaps.length, activeSwaps: swaps.filter((m) => m.active).length });
  for (const m of swaps) {
    log('ccxtSwap', { id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, active: m.active, linear: m.linear, inverse: m.inverse, contractSize: m.contractSize, taker: m.taker, maker: m.maker, amountPrecision: m.precision.amount, minAmount: m.limits.amount.min });
  }
  const spot = ex.markets['BTC/USDT'];
  log('ccxtSpot', { id: spot?.id, taker: spot?.taker, maker: spot?.maker });
}

async function anchorCalls(contracts) {
  const idx = await get('/quote/v1/index');
  save('index.json', idx.text);
  log('indexBulk', { status: idx.status, bytes: idx.bytes, ms: idx.ms, keys: Object.keys(idx.json.index ?? {}), edpKeys: Object.keys(idx.json.edp ?? {}), body: idx.text.slice(0, 300), headers: interesting(idx.headers) });
  for (const q of ['?symbol=BTCUSDT', '?symbol=BTCUSDT-PERPETUAL', '?symbol=NOPEUSDT']) {
    const r = await get('/quote/v1/index' + q);
    log('indexOne', { q, status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
  }
  for (const c of contracts) {
    const r = await get(`/quote/v1/markPrice?symbol=${c.symbol}`);
    log('mark', { symbol: c.symbol, status: r.status, bytes: r.bytes, ms: r.ms, body: r.text, markTimeAgeMs: r.json?.time ? r.t1 - Number(r.json.time) : null });
  }
  for (const q of ['', '?symbol=NOPEUSDT-PERPETUAL', '?symbol=BTCUSD-PERPETUAL', '?symbol=BTCUSDT']) {
    const r = await get('/quote/v1/markPrice' + q);
    log('markOther', { q, status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
  }
  const fr = await get(`/api/v1/futures/fundingRate?timestamp=${Date.now()}`);
  log('fundingBulk', { status: fr.status, bytes: fr.bytes, ms: fr.ms, body: fr.text, next: (fr.json ?? []).map?.((x) => `${x.symbol} ${iso(x.nextSettleTime)}`), headers: interesting(fr.headers) });
  for (const q of ['', `?symbol=ETHUSDT-PERPETUAL&timestamp=${Date.now()}`, `?symbol=NOPEUSDT-PERPETUAL&timestamp=${Date.now()}`, `?symbol=BTCUSD-PERPETUAL&timestamp=${Date.now()}`]) {
    const r = await get('/api/v1/futures/fundingRate' + q);
    log('fundingOther', { q: q.replace(/timestamp=\d+/, 'timestamp=<now>'), status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
  }
  for (const c of [...contracts.map((x) => x.symbol), 'BTCUSD-PERPETUAL']) {
    const r = await get(`/api/v1/futures/historyFundingRate?symbol=${c}&limit=100&timestamp=${Date.now()}`);
    const rows = Array.isArray(r.json) ? r.json : [];
    const times = rows.map((x) => Number(x.settleTime));
    const gaps = times.slice(1).map((t, i) => (times[i] - t) / 3_600_000);
    const hours = [...new Set(times.map((t) => new Date(t).getUTCHours()))].sort((a, b) => a - b);
    const rates = rows.map((x) => Number(x.settleRate));
    log('fundingHistory', {
      symbol: c, status: r.status, ms: r.ms, rows: rows.length, newest: rows[0], oldest: rows.length ? iso(rows[rows.length - 1].settleTime) : null,
      gapHours: [...new Set(gaps)], settleHoursUtc: hours, rateMin: rows.length ? Math.min(...rates) : null, rateMax: rows.length ? Math.max(...rates) : null,
      atDefault: rates.filter((x) => x === 0.0001).length, body: rows.length ? undefined : r.text.slice(0, 200),
    });
  }
}

async function tickersAndBook(contracts) {
  const sym = contracts[0].symbol;
  for (const p of ['/quote/v1/ticker/24hr', `/quote/v1/ticker/24hr?symbol=${sym}`, '/quote/v1/ticker/price', '/quote/v1/ticker/bookTicker', `/quote/v1/ticker/bookTicker?symbol=${sym}`]) {
    const r = await get(p);
    const arr = Array.isArray(r.json) ? r.json : [r.json];
    const perps = arr.filter((x) => String(x?.s ?? '').includes('PERPETUAL'));
    log('ticker', { path: p, status: r.status, bytes: r.bytes, ms: r.ms, rows: arr.length, perpRows: perps.length, fields: Object.keys(arr[0] ?? {}), perpSample: perps[0] ?? (arr.length === 1 ? arr[0] : undefined) });
    await sleep(250);
  }
  for (const c of contracts) {
    const books = {};
    for (const limit of [undefined, 20, 200, 201, 1000]) {
      const r = await get(`/quote/v1/depth?symbol=${c.symbol}${limit ? `&limit=${limit}` : ''}`);
      const j = r.json ?? {};
      const b = j.b ?? [];
      const a = j.a ?? [];
      const bidsDesc = b.every((x, i) => i === 0 || Number(b[i - 1][0]) > Number(x[0]));
      const asksAsc = a.every((x, i) => i === 0 || Number(a[i - 1][0]) < Number(x[0]));
      log('depth', { symbol: c.symbol, limit: limit ?? 'none', status: r.status, bytes: r.bytes, ms: r.ms, bids: b.length, asks: a.length, bidsDesc, asksAsc, bestBid: b[0], bestAsk: a[0], tAgeMs: j.t ? r.t1 - Number(j.t) : null, body: r.status === 200 ? undefined : r.text.slice(0, 200) });
      books[limit ?? 'none'] = j;
      await sleep(250);
    }
    // Two reads in a row show whether the edge caches the book.
    const x = await get(`/quote/v1/depth?symbol=${c.symbol}&limit=20`);
    const y = await get(`/quote/v1/depth?symbol=${c.symbol}&limit=20`);
    log('depthRepeat', { symbol: c.symbol, t1: x.json?.t, t2: y.json?.t, same: x.text === y.text, cache: [x.headers?.['x-cache'], y.headers?.['x-cache']] });
    const m = await get(`/quote/v1/depth/merged?symbol=${c.symbol}&limit=20`);
    log('depthMerged', { symbol: c.symbol, status: m.status, ms: m.ms, bids: m.json?.b?.length, asks: m.json?.a?.length, best: [m.json?.b?.[0], m.json?.a?.[0]], body: m.status === 200 ? undefined : m.text.slice(0, 200) });
  }
}

async function errors() {
  for (const p of ['/quote/v1/depth?symbol=NOPEUSDT-PERPETUAL', '/quote/v1/depth', '/quote/v1/depth?symbol=BTCUSD-PERPETUAL', '/api/v1/nope', '/quote/v1/ticker/price?symbol=NOPE']) {
    const r = await get(p);
    log('error', { path: p, status: r.status, ms: r.ms, contentType: r.headers?.['content-type'], body: r.text.slice(0, 160), headers: interesting(r.headers) });
    await sleep(250);
  }
}

async function main() {
  await latencyAndClock();
  const info = await catalog();
  await ccxtView();
  await anchorCalls(info.contracts);
  await tickersAndBook(info.contracts);
  await errors();
}

// 60 rounds at 1 Hz of the calls a poller would make, with the funding rate every tenth round.
async function poll() {
  const info = (await get('/api/v1/exchangeInfo')).json;
  const contracts = info.contracts.map((c) => ({ symbol: c.symbol, indexKey: c.underlying + c.index }));
  const series = Object.fromEntries(contracts.map((c) => [c.symbol, { index: [], mark: [], markTime: [], rate: [] }]));
  const times = { index: [], mark: [], funding: [] };
  const statuses = {};
  let funding = new Map();
  const t0 = Date.now();
  for (let round = 0; round < 60; round++) {
    const start = t0 + round * 1000;
    const wait = start - Date.now();
    if (wait > 0) await sleep(wait);
    const calls = [get('/quote/v1/index'), ...contracts.map((c) => get(`/quote/v1/markPrice?symbol=${c.symbol}`))];
    if (round % 10 === 0) calls.push(get(`/api/v1/futures/fundingRate?timestamp=${Date.now()}`));
    const [idx, ...rest] = await Promise.all(calls);
    const marks = rest.slice(0, contracts.length);
    const fr = rest[contracts.length];
    for (const r of [idx, ...rest]) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    times.index.push(idx.ms);
    marks.forEach((m) => times.mark.push(m.ms));
    if (fr) {
      times.funding.push(fr.ms);
      if (Array.isArray(fr.json)) funding = new Map(fr.json.map((x) => [x.symbol, x]));
    }
    contracts.forEach((c, i) => {
      const s = series[c.symbol];
      s.index.push(idx.json?.index?.[c.indexKey]);
      s.mark.push(marks[i].json?.price);
      s.markTime.push(marks[i].json?.time ? { age: marks[i].t1 - Number(marks[i].json.time), time: Number(marks[i].json.time) } : null);
      s.rate.push(funding.get(c.symbol)?.rate);
      if (round === 30) {
        const f = funding.get(c.symbol);
        const index = Number(idx.json?.index?.[c.indexKey]);
        const hours = Math.round(((Number(f?.nextSettleTime) - Date.now()) / 3_600_000) * 100) / 100;
        const price1 = index * (1 + (Number(f?.rate) * hours) / 8);
        log('markVsPrice1', { symbol: c.symbol, index, mark: Number(marks[i].json?.price), price1: +price1.toFixed(4), hoursToNext: hours, rate: f?.rate, markMinusIndexPpm: Math.round(((Number(marks[i].json?.price) - index) / index) * 1e6), price1MinusIndexPpm: Math.round(((price1 - index) / index) * 1e6) });
      }
    });
  }
  const changes = (xs) => xs.slice(1).filter((x, i) => x !== xs[i]).length;
  for (const c of contracts) {
    const s = series[c.symbol];
    const markTimes = s.markTime.filter(Boolean);
    const markTimeSteps = markTimes.slice(1).map((x, i) => x.time - markTimes[i].time).filter((d) => d > 0);
    log('pollSeries', {
      symbol: c.symbol, indexKey: c.indexKey, rounds: s.index.length, indexChanges: changes(s.index), markChanges: changes(s.mark), rateChanges: changes(s.rate.filter(Boolean)),
      markTimeAgeMs: stats(markTimes.map((x) => x.age)), markTimeMsMod1000: [...new Set(markTimes.map((x) => x.time % 1000))], markTimeStepsMs: [...new Set(markTimeSteps)].sort((a, b) => a - b).slice(0, 8),
      indexFirstLast: [s.index[0], s.index[s.index.length - 1]], markFirstLast: [s.mark[0], s.mark[s.mark.length - 1]], rateFirstLast: [s.rate.find(Boolean), s.rate[s.rate.length - 1]],
      markMinusIndexPpm: stats(s.mark.map((m, i) => Math.round(((Number(m) - Number(s.index[i])) / Number(s.index[i])) * 1e6))),
    });
  }
  log('pollTimes', { index: stats(times.index), mark: stats(times.mark), funding: stats(times.funding), statuses, wallMs: Date.now() - t0 });
}

const mode = process.argv[2] ?? 'main';
log('run', { mode, startedAt: new Date().toISOString() });
await (mode === 'poll' ? poll() : main());
log('done', { at: new Date().toISOString() });
