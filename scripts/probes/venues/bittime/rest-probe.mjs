// Bittime USDT-M futures REST probe: catalog, CCXT mapping, anchor fields, book snapshot, errors, server time and latency.
// Public, unauthenticated, read-only. One request at a time except one 49 contract anchor round at concurrency 5.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bittime/rest-probe.mjs [catalog|latency|anchor|depth|errors|time]
//   catalog  documented contracts call, the undocumented web front end contract list, spot exchangeInfo, and CCXT bitrue pointed at fapi.bittime.com. About 15 s.
//   latency  DNS, then cold and warm request times for time, index and depth. About 20 s.
//   anchor   one index round over every contract, 60 one second polls of index, mark and funding on five contracts beside the ticker, and one read of Bitrue's index call for the same five. About 75 s.
//   depth    book snapshot depth limits, level order, repeat reads and CloudFront caching headers. About 10 s.
//   errors   unknown contract, missing parameter, unknown path, auth-only path, and the headers a reply carries. About 10 s.
//   time     ten server time samples and the clock offset. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bittime/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const FAPI = 'https://fapi.bittime.com/fapi/v1';
const WEB = 'https://futures.bittime.com/fe-co-api'; // the futures web page's own API, not in the API docs
const SPOT = 'https://openapi.bittime.com/api/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

function get(url, { agent = warmAgent, method = 'GET', body } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let ttfb = null;
    const req = https.request(url, { method, agent, headers: { 'content-type': 'application/json', 'user-agent': 'observatory-probe' } }, (res) => {
      ttfb = performance.now() - t0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json, ms: Math.round(performance.now() - t0), ttfb: Math.round(ttfb), bytes: text.length, reused: req.reusedSocket });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Math.round(performance.now() - t0) }));
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (arr) => ({ n: arr.length, min: Math.min(...arr), median: q(arr, 0.5), p90: q(arr, 0.9), max: Math.max(...arr) });

async function contracts() {
  const r = await get(`${FAPI}/contracts`);
  return r.json;
}

async function catalog() {
  const r = await get(`${FAPI}/contracts`);
  keep('contracts.json', r.text);
  const list = r.json;
  const by = {};
  for (const c of list) { const k = `type=${c.type} status=${c.status} side=${c.side}`; by[k] = (by[k] || 0) + 1; }
  log('contracts', { status: r.status, ms: r.ms, bytes: r.bytes, count: list.length, by, first: list[0] });
  const quotes = {};
  for (const c of list) { const qt = c.symbol.split('-')[2]; quotes[qt] = (quotes[qt] || 0) + 1; }
  log('contracts_quote', { quotes });

  const w = await get(`${WEB}/common/public_info`, { method: 'POST', body: JSON.stringify({ type: '1,2,3,4' }) });
  keep('public_info.json', w.text);
  const d = w.json?.data ?? {};
  const L = d.contractList ?? [];
  const count = (f) => { const m = {}; for (const c of L) { const k = f(c); m[k] = (m[k] || 0) + 1; } return m; };
  log('web_public_info', {
    status: w.status, ms: w.ms, bytes: w.bytes, wsUrl: d.wsUrl, marginCoinList: d.marginCoinList, contracts: L.length,
    takerFee: count((c) => `${c.openTakerFeeRate}/${c.closeTakerFeeRate}`),
    feeOutliers: L.filter((c) => c.openTakerFeeRate !== 0.0006).map((c) => `${c.contractName} ${c.openTakerFeeRate}`),
    fundingHours: count((c) => c.capitalFrequency), capitalStartTime: count((c) => c.capitalStartTime),
    fourHour: L.filter((c) => c.capitalFrequency === 4).map((c) => c.contractName),
    maxLever: count((c) => c.maxLever), showType: count((c) => `${c.contractShowType} ${c.marginCoin} ${c.firstTab}`),
    keys: Object.keys(L[0] ?? {}),
  });
  const docMult = new Map(list.map((c) => [c.symbol, c.multiplier]));
  log('web_vs_doc', { sameNames: L.filter((c) => docMult.has(c.contractName)).length, sameMultiplier: L.filter((c) => docMult.get(c.contractName) === c.multiplier).length });

  const s = await get(`${SPOT}/exchangeInfo`);
  const sym = s.json?.symbols ?? [];
  const sp = {};
  for (const x of sym) { const k = `${x.status} ${x.quoteAsset}`; sp[k] = (sp[k] || 0) + 1; }
  log('spot_exchangeInfo', { status: s.status, ms: s.ms, bytes: s.bytes, symbols: sym.length, byStatusQuote: sp, rateLimits: (s.json?.rateLimits ?? []).map((x) => `${x.prefix} ${x.type} ${x.replenishRate}/${x.timeCount}${x.timeUnit}`) });

  // CCXT has no Bittime class. The fapi shape matches CCXT bitrue's swap path, so point bitrue at Bittime to see what the catalog would read.
  // bitrue's fetchMarkets reads its replies by position, spot first, so the spot URL is pointed at Bittime too.
  log('ccxt', { version: ccxt.version, bittimeClass: ccxt.exchanges.includes('bittime') });
  const ex = new ccxt.bitrue({ options: { fetchMarkets: { types: ['spot', 'linear'] } } });
  ex.urls.api.spot = 'https://openapi.bittime.com/api';
  ex.urls.api.fapi = 'https://fapi.bittime.com/fapi';
  try {
    const markets = await ex.loadMarkets();
    const swaps = Object.values(markets).filter((m) => m.swap);
    const btc = swaps.find((m) => m.id === 'E-BTC-USDT');
    log('ccxt_bitrue_repointed', {
      swaps: swaps.length, active: swaps.filter((m) => m.active).length, linear: swaps.filter((m) => m.linear).length,
      contractSizeEqualsMultiplier: swaps.filter((m) => m.contractSize === docMult.get(m.id)).length,
      btc: btc && { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, settle: btc.settle, active: btc.active, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker, linear: btc.linear, infoStatus: btc.info.status },
    });
  } catch (e) {
    log('ccxt_bitrue_repointed', { error: e.message.slice(0, 200) });
  }
}

async function latency() {
  for (const h of ['fapi.bittime.com', 'futures.bittime.com', 'fmarket-ws.bittime.com', 'futuresws-cfx.bittime.com', 'openapi.bittime.com']) {
    try { log('dns', { host: h, addrs: (await lookup(h, { all: true })).map((a) => a.address) }); } catch (e) { log('dns', { host: h, error: e.code }); }
  }
  for (const [name, url] of [['time', `${FAPI}/time`], ['index', `${FAPI}/index?contractName=E-BTC-USDT`], ['depth', `${FAPI}/depth?contractName=E-BTC-USDT&limit=100`]]) {
    const cold = [];
    for (let i = 0; i < 3; i++) { cold.push((await get(url, { agent: new https.Agent({ keepAlive: false }) })).ms); await sleep(300); }
    const warm = [];
    const fresh = [];
    await get(url);
    for (let i = 0; i < 10; i++) { const r = await get(url); (r.reused ? warm : fresh).push(r.ms); await sleep(200); }
    log('latency', { name, cold, warmReused: warm.length ? stats(warm) : null, keepAliveNotReused: fresh });
  }
}

async function indexOf(name) {
  const t = Date.now();
  const r = await get(`${FAPI}/index?contractName=${name}`);
  return { name, t, ms: r.ms, status: r.status, bytes: r.bytes, j: r.json };
}

async function anchor() {
  const list = await contracts();
  const names = list.map((c) => c.symbol);
  // One full round at concurrency 5, the way a per contract poller would have to run.
  const t0 = performance.now();
  const rows = [];
  for (let i = 0; i < names.length; i += 5) rows.push(...(await Promise.all(names.slice(i, i + 5).map(indexOf))));
  const roundMs = Math.round(performance.now() - t0);
  const bad = rows.filter((r) => typeof r.j?.indexPrice !== 'number');
  const fields = {};
  for (const r of rows) for (const k of Object.keys(r.j ?? {})) fields[k] = (fields[k] || 0) + 1;
  const now = Date.now();
  const nextAt = {};
  for (const r of rows) if (r.j?.remainingSecond != null) { const iso = new Date(Math.round((r.t + r.j.remainingSecond * 1000) / 60000) * 60000).toISOString(); nextAt[iso] = (nextAt[iso] || 0) + 1; }
  const prem = rows.filter((r) => r.j?.indexPrice).map((r) => ({ n: r.name, ppm: Math.round((r.j.tagPrice / r.j.indexPrice - 1) * 1e6), fr: r.j.currentFundRate, nfr: r.j.nextFundRate }));
  log('index_round', { contracts: names.length, roundMs, perCall: stats(rows.map((r) => r.ms)), failed: bad.map((r) => `${r.name} ${JSON.stringify(r.j)}`), fields, nextFundingAtRounded: nextAt, currentEqualsNext: rows.filter((r) => r.j && r.j.currentFundRate === r.j.nextFundRate).length, zeroIndex: rows.filter((r) => r.j?.indexPrice === 0).length, zeroMark: rows.filter((r) => r.j?.tagPrice === 0).length });
  prem.sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm));
  log('premium_extremes', { replyBytes: [Math.min(...rows.map((r) => r.bytes)), Math.max(...rows.map((r) => r.bytes))], btc: prem.find((p) => p.n === 'E-BTC-USDT'), top: prem.slice(0, 6), rateRange: [Math.min(...prem.map((p) => p.fr)), Math.max(...prem.map((p) => p.fr))] });
  keep('index_round.json', JSON.stringify(rows));

  const watch = ['E-BTC-USDT', 'E-ETH-USDT', 'E-HYPE-USDT', 'E-ZRX-USDT', 'E-XAUT-USDT'];
  const series = Object.fromEntries(watch.map((n) => [n, []]));
  const tick = [];
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const got = await Promise.all(watch.map(indexOf));
    for (const g of got) series[g.name].push(g);
    const tk = await get(`${FAPI}/ticker?contractName=E-BTC-USDT`);
    tick.push({ t: Date.now(), ...tk.json });
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  for (const n of watch) {
    const s = series[n].filter((x) => x.j);
    const changes = (k) => s.reduce((a, x, i) => a + (i > 0 && x.j[k] !== s[i - 1].j[k] ? 1 : 0), 0);
    const maxStep = (k) => Math.max(...s.slice(1).map((x, i) => Math.abs(x.j[k] / s[i].j[k] - 1) * 1e6)).toFixed(0);
    log('anchor_series', {
      n, polls: s.length, ms: stats(s.map((x) => x.ms)),
      changes: { indexPrice: changes('indexPrice'), tagPrice: changes('tagPrice'), currentFundRate: changes('currentFundRate'), nextFundRate: changes('nextFundRate'), remainingSecond: changes('remainingSecond') },
      maxStepPpm: { indexPrice: maxStep('indexPrice'), tagPrice: maxStep('tagPrice') },
      first: s[0].j, last: s.at(-1).j,
      remainingDrift: s.map((x) => Math.round(x.t / 1000) + x.j.remainingSecond).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6),
    });
  }
  // Is the mark the last trade, the touch, or its own number?
  const btc = series['E-BTC-USDT'];
  let eqLast = 0, eqBuy = 0, eqSell = 0, inside = 0, cmp = 0;
  for (let i = 0; i < Math.min(btc.length, tick.length); i++) {
    const m = btc[i].j?.tagPrice; const k = tick[i];
    if (m == null || k.last == null) continue;
    cmp++;
    if (m === k.last) eqLast++;
    if (m === k.buy) eqBuy++;
    if (m === k.sell) eqSell++;
    if (m >= k.buy && m <= k.sell) inside++;
  }
  // Bittime's futures API is the same product as Bitrue's, so read Bitrue's public index call once beside Bittime's.
  const pairs = [];
  for (const n of watch) {
    const [a, b] = await Promise.all([get(`${FAPI}/index?contractName=${n}`), get(`https://fapi.bitrue.com/fapi/v1/index?contractName=${n}`)]);
    pairs.push({ n, bittime: a.json && { index: a.json.indexPrice, mark: a.json.tagPrice, rate: a.json.currentFundRate }, bitrue: b.json && { index: b.json.indexPrice, mark: b.json.tagPrice, rate: b.json.currentFundRate } });
  }
  log('index_vs_bitrue', { equalIndex: pairs.filter((p) => p.bittime && p.bitrue && p.bittime.index === p.bitrue.index).length, of: pairs.length, pairs });
  log('mark_vs_ticker', { compared: cmp, equalsLast: eqLast, equalsBuy: eqBuy, equalsSell: eqSell, insideTouch: inside, sample: { mark: btc[5]?.j?.tagPrice, index: btc[5]?.j?.indexPrice, ticker: tick[5] } });
}

async function depth() {
  for (const limit of [5, 30, 100, 200, 500]) {
    const r = await get(`${FAPI}/depth?contractName=E-BTC-USDT&limit=${limit}`);
    const j = r.json;
    const desc = j.bids.every((l, i) => i === 0 || l[0] < j.bids[i - 1][0]);
    const asc = j.asks.every((l, i) => i === 0 || l[0] > j.asks[i - 1][0]);
    log('depth', { limit, status: r.status, ms: r.ms, bids: j.bids.length, asks: j.asks.length, bidsDescending: desc, asksAscending: asc, time: j.time, ageMs: Date.now() - j.time, types: [typeof j.bids[0][0], typeof j.bids[0][1]], cache: { 'x-cache': r.headers['x-cache'], age: r.headers.age, 'cache-control': r.headers['cache-control'] } });
  }
  const r = await get(`${FAPI}/depth?contractName=E-BTC-USDT`);
  log('depth_default', { bids: r.json.bids.length, asks: r.json.asks.length });
  // How often the origin renews the snapshot: 20 reads 250 ms apart on the busiest contract.
  const times = [];
  for (let i = 0; i < 20; i++) { const x = await get(`${FAPI}/depth?contractName=E-BTC-USDT&limit=100`); times.push({ at: Date.now(), time: x.json.time }); await sleep(250); }
  const distinct = [...new Set(times.map((x) => x.time))];
  log('depth_cadence_busy', { reads: times.length, spanMs: times.at(-1).at - times[0].at, distinctTimes: distinct.length, steps: distinct.slice(1).map((v, i) => v - distinct[i]), ageAtArrival: stats(times.map((x) => x.at - x.time)) });
  const reads = [];
  for (let i = 0; i < 8; i++) { const x = await get(`${FAPI}/depth?contractName=E-ZRX-USDT&limit=100`); reads.push({ time: x.json.time, top: `${x.json.bids[0]?.join('@')}|${x.json.asks[0]?.join('@')}`, levels: `${x.json.bids.length}/${x.json.asks.length}`, xcache: x.headers['x-cache'] }); await sleep(250); }
  log('depth_repeat_quiet', { reads });
  const t = await get(`${FAPI}/ticker?contractName=E-BTC-USDT`);
  const d = await get(`${FAPI}/depth?contractName=E-BTC-USDT&limit=5`);
  log('ticker_vs_depth', { ticker: t.json, bestBid: d.json.bids[0], bestAsk: d.json.asks[0] });
}

async function errors() {
  const cases = [
    ['unknown contract', `${FAPI}/depth?contractName=E-NOPE-USDT`],
    ['socket spelling', `${FAPI}/depth?contractName=e_btcusdt`],
    ['missing parameter', `${FAPI}/index`],
    ['unknown path', `${FAPI}/nope`],
    ['guessed path', `${FAPI}/premiumIndex?contractName=E-BTC-USDT`],
    ['guessed path', `${FAPI}/fundingRate?contractName=E-BTC-USDT`],
    ['auth path', `${FAPI}/account`],
    ['web unknown', `${WEB}/common/nope`],
  ];
  for (const [what, url] of cases) {
    const r = await get(url);
    log('error_case', { what, url: url.replace('https://', ''), status: r.status, body: r.text.slice(0, 220) });
    await sleep(300);
  }
  const r = await get(`${FAPI}/index?contractName=E-BTC-USDT`);
  log('headers', { status: r.status, headers: r.headers });
}

async function time() {
  const offs = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(`${FAPI}/time`);
    const t1 = Date.now();
    offs.push({ offset: r.json.serverTime - (t0 + t1) / 2, rtt: t1 - t0 });
    await sleep(500);
  }
  const best = offs.filter((o) => o.rtt <= Math.min(...offs.map((x) => x.rtt)) + 20);
  log('time', { body: (await get(`${FAPI}/time`)).json, offsetMs: stats(offs.map((o) => o.offset)), rttMs: stats(offs.map((o) => o.rtt)), offsetAtShortestRtt: best.map((o) => `${o.offset} at ${o.rtt} ms`) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, latency, anchor, depth, errors, time };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
warmAgent.destroy();
