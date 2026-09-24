// IMBX REST probe: hosts and latency, refusals by User-Agent, the futures catalog, the per contract and bulk anchor calls with a minute of one second polls, funding history, the VIP table, errors and server time.
// Public, unauthenticated, read-only. At most four requests a second, and the web client itself polls public_market_info every 4 s per open page.
// IMBX publishes no API documentation, so every path here is one its own web client calls, read from https://www.imbx.io bundles on 2026-09-22.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/imbx/rest-probe.mjs [catalog|anchor|funding|errors]
//   catalog  DNS, cold and warm times, User-Agent refusals, the open API hosts, the futures and spot catalogs. About 30 s.
//   anchor   60 one second rounds of price_list plus public_market_info on three contracts, one sweep of every contract, the bulk funding call. About 75 s.
//   funding  funding history for three contracts, funding params, the VIP table, server time. About 5 s.
//   errors   wrong method, missing and unknown parameters, unknown paths, response headers. About 5 s.
// The load balancer blocked this host, sockets included, a few minutes after about 250 REST requests in five minutes on 2026-09-23, so space the runs out.
// A refused request prints a `refused` line and exits with code 2.
// Recorded in docs/profiles/imbx/rest.md and fees.md.
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const LF = 'https://lf-api.imbx.io'; // the web client's legacyFuturesApiDomain
const LS = 'https://ls-api.imbx.io'; // legacySpotApiDomain
const API = 'https://api.imbx.io'; // apiDomain
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

async function call(method, url, body, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}
const post = (path, body = {}, base = LF) => call('POST', base + path, body).then(needJson);

// The load balancer answers a refusal with an HTML 403, which no mode can use, so the run stops and says so.
function needJson(r) {
  if (r.json === null) {
    log('refused', { status: r.status, server: r.headers.get('server'), body: r.text.replace(/\s+/g, ' ').slice(0, 120), at: new Date().toISOString() });
    process.exit(2);
  }
  return r;
}

async function catalog() {
  for (const h of ['lf-api.imbx.io', 'ls-api.imbx.io', 'api.imbx.io', 'futuresws.imbx.io', 'openapi.imbx.io', 'futuresopenapi.imbx.io']) {
    const a = await lookup(h, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host: h, addresses: a.map((x) => x.address) });
  }
  // The load balancer's WAF answers by User-Agent. fetch sends `node` unless told otherwise.
  for (const [name, h] of [['fetch default', {}], ['curl', { 'user-agent': 'curl/8.14.1' }], ['empty', { 'user-agent': '' }]]) {
    const r = await call('POST', LF + '/common/public_info', {}, h);
    log('user_agent', { userAgent: name, status: r.status, server: r.headers.get('server'), body: r.json ? `json code ${r.json.code}` : r.text.replace(/\s+/g, ' ').slice(0, 100) });
  }

  // The spot public_info names an open API host, and the TLS handshake to that host gets no answer from here.
  for (const host of ['openapi.imbx.io', 'futuresopenapi.imbx.io', 'openapi.iambit.com']) {
    const t0 = Date.now();
    const out = await new Promise((resolve) => {
      const req = https.get({ host, path: '/sapi/v1/ping', timeout: 6000 }, (res) => { resolve(`HTTP ${res.statusCode}`); res.resume(); });
      req.on('timeout', () => { req.destroy(); resolve('no answer in 6 s'); });
      req.on('error', (e) => resolve(e.code ?? e.message));
    });
    log('open_api_host', { host, result: out, ms: Date.now() - t0 });
  }

  const times = [];
  for (let i = 0; i < 6; i++) { const r = await post('/common/public_info'); times.push(r.ms); await sleep(500); }
  log('latency_public_info', { firstMs: times[0], warmMs: times.slice(1) });

  const r = await post('/common/public_info');
  const d = r.json.data;
  const L = d.contractList;
  const count = (k) => L.reduce((m, c) => ((m[JSON.stringify(c[k])] = (m[JSON.stringify(c[k])] ?? 0) + 1), m), {});
  log('futures_catalog', { bytes: r.bytes, ms: r.ms, wsUrl: d.wsUrl, marginCoinList: d.marginCoinList, contracts: L.length, serverMs: d.currentTimeMillis, localMs: Date.now() });
  for (const k of ['contractType', 'contractShowType', 'contractSide', 'marginCoin', 'deliveryKind', 'capitalFrequency', 'openTakerFee', 'closeTakerFee', 'openMakerFee', 'closeMakerFee', 'nextCapitalSettTime', 'tags']) log('field', { k, values: count(k) });
  log('contracts', { rows: L.map((c) => `${c.id} ${c.contractName} ${c.subSymbol} x${c.multiplier} ${c.multiplierCoin} ${c.capitalFrequency}h`).join(' | ') });
  log('contract_sample', { row: L[0] });

  const s = await post('/common/public_info', {}, LS);
  const m = s.json.data.market ?? {};
  log('spot_catalog', { bytes: s.bytes, quotes: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Object.keys(v).length])), symbols: Object.values(m).flatMap((v) => Object.keys(v)).join(' '), wsUrl: s.json.data.wsUrl, open_api_url: s.json.data.open_api_url, contractOpen: s.json.data.contractOpen, feeRates: [...new Set(Object.values(m).flatMap((v) => Object.values(v).map((x) => x.quoteFeeRate)))] });
}

async function anchor() {
  const L = (await post('/common/public_info')).json.data.contractList;
  const byName = Object.fromEntries(L.map((c) => [c.contractName, c]));
  const watch = ['E-BTC-USDT', 'E-COPPER-USDT', 'E-NVDA-USDT'];
  const gaps = Object.fromEntries(watch.map((n) => [n, { markIndex: [], markMid: [] }]));
  const prev = {};
  const changes = {};
  const times = { price_list: [], public_market_info: [] };
  let bytes = { price_list: 0, public_market_info: 0 };
  let markMismatch = 0;
  let markCompared = 0;
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const pl = await post('/common/price_list');
    times.price_list.push(pl.ms); bytes.price_list = pl.bytes;
    const rows = Object.assign({}, ...pl.json.data);
    for (const name of watch) {
      const r = await post('/common/public_market_info', { contractId: byName[name].id });
      times.public_market_info.push(r.ms); bytes.public_market_info = r.bytes;
      const v = { ...r.json.data, plMark: rows[name].tagPrice, plLast: rows[name].lastPrice };
      markCompared++;
      const mid = (rows[name].buyOne + rows[name].sellOne) / 2;
      if (v.indexPrice) gaps[name].markIndex.push(Math.round((v.tagPrice / v.indexPrice - 1) * 1e6));
      if (rows[name].buyOne && rows[name].sellOne) gaps[name].markMid.push(Math.round((v.tagPrice / mid - 1) * 1e6));
      if (v.tagPrice !== v.plMark) markMismatch++;
      for (const [k, x] of Object.entries(v)) {
        const key = `${name}.${k}`;
        if (prev[key] !== undefined && prev[key] !== x) changes[key] = (changes[key] ?? 0) + 1;
        prev[key] = x;
      }
      if (i === 0 || i === 59) log('market_info', { name, round: i, data: r.json.data, priceList: rows[name] });
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  log('poll_times', Object.fromEntries(Object.entries(times).map(([k, a]) => [k, { n: a.length, min: q(a, 0), p50: q(a, 0.5), p90: q(a, 0.9), max: q(a, 1), over1s: a.filter((x) => x > 1000).length, bytes: bytes[k] }])));
  for (const [n, g] of Object.entries(gaps)) log('mark_gap_ppm', { name: n, markOverIndex: { min: q(g.markIndex, 0), p50: q(g.markIndex, 0.5), max: q(g.markIndex, 1) }, markOverMid: { min: q(g.markMid, 0), p50: q(g.markMid, 0.5), max: q(g.markMid, 1) } });
  log('changes_in_59_intervals', { changes, priceListMarkEqualsMarketInfoMark: `${markCompared - markMismatch} of ${markCompared}` });

  // One sweep of the per contract call over the whole catalog, which is what an index anchor would cost per round.
  const t0 = Date.now();
  const zeros = [];
  const capped = [];
  for (const c of L) {
    const r = await post('/common/public_market_info', { contractId: c.id });
    const x = r.json.data;
    if (!x.indexPrice || !x.tagPrice) zeros.push(c.contractName);
    if (Math.abs(x.currentFundRate) >= x.fundingRateCap) capped.push(c.contractName);
  }
  log('sweep', { contracts: L.length, totalMs: Date.now() - t0, zeroIndexOrMark: zeros, rateAtCapOrFloor: capped });

  const f = needJson(await call('GET', `${API}/futures/finance/public/funding-rate?size=100`));
  const rows = f.json.data;
  log('funding_bulk', { status: f.status, ms: f.ms, bytes: f.bytes, total: f.json.total, rows: rows.length, periods: rows.reduce((m, r) => ((m[r.timePeriod] = (m[r.timePeriod] ?? 0) + 1), m), {}), nextUpdate: [...new Set(rows.map((r) => r.nextUpdate))], caps: [...new Set(rows.map((r) => r.maxFundingRate))], first: rows[0] });
  const pmi = (await post('/common/public_market_info', { contractId: 1 })).json.data;
  log('funding_bulk_vs_market_info', { bulkBtc: rows.find((r) => r.symbol === 'BTC-USDT')?.fundingRate, marketInfoCurrentFundRate: pmi.currentFundRate, marketInfoNextFundRate: pmi.nextFundRate });
}

async function funding() {
  for (const sym of ['BTC-USDT', 'XAU-USDT', 'COPPER-USDT']) {
    const r = needJson(await call('GET', `${API}/futures/finance/public/funding-rate-history?symbol=${sym}&size=8`));
    log('history', { sym, status: r.status, ms: r.ms, total: r.json.total, rows: r.json.data.map((x) => `${x.settlementTime} ${x.timePeriod} ${x.fundingRate}`) });
  }
  const id = { 'BTC-USDT': 1 };
  const pmi = (await post('/common/public_market_info', { contractId: id['BTC-USDT'] })).json.data;
  log('btc_market_info_now', { data: pmi, localUtc: new Date().toISOString() });
  const p = await call('GET', `${API}/futures/finance/public/funding-rate-params`);
  log('funding_params', { status: p.status, body: p.text.slice(0, 600) });
  const v = needJson(await call('GET', `${API}/vip/levels`));
  log('vip_levels', { status: v.status, rows: v.json.sort((a, b) => a.levelOrder - b.levelOrder).map((l) => `${l.levelName.trim()} spot30d ${l.spotTradingVolume30dUsdt} fut30d ${l.tradingVolume30dUsdt} token ${l.tokenBalanceRequired} assets ${l.totalAssetUsdt} spot ${l.spotMakerFee}/${l.spotTakerFee} futures ${l.futuresMakerFee}/${l.futuresTakerFee} status ${l.status} mtime ${l.mtime}`) });
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const before = Date.now();
    const r = await post('/common/public_info');
    const after = Date.now();
    offsets.push({ offsetMs: r.json.data.currentTimeMillis - Math.round((before + after) / 2), rttMs: after - before, date: r.headers.get('date') });
    await sleep(300);
  }
  log('server_time', { offsets });
}

async function errors() {
  const cases = [
    ['GET on public_info', () => call('GET', LF + '/common/public_info')],
    ['public_market_info without contractId', () => post('/common/public_market_info', {})],
    ['public_market_info contractId 999', () => post('/common/public_market_info', { contractId: 999 })],
    ['public_market_info contractId as text', () => post('/common/public_market_info', { contractId: 'E-BTC-USDT' })],
    ['unknown lf-api path', () => post('/common/nope')],
    ['unknown api path', () => call('GET', API + '/futures/finance/public/nope')],
    ['funding history without symbol', () => call('GET', API + '/futures/finance/public/funding-rate-history')],
    ['funding history unknown symbol', () => call('GET', API + '/futures/finance/public/funding-rate-history?symbol=NOPE-USDT')],
  ];
  for (const [name, fn] of cases) {
    const r = await fn();
    log('error_case', { name, status: r.status, ms: r.ms, body: r.text.replace(/\s+/g, ' ').slice(0, 220) });
    await sleep(300);
  }
  const r = await post('/common/price_list');
  log('headers', { headers: Object.fromEntries([...r.headers.entries()].filter(([k]) => !['date', 'content-length'].includes(k))) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, funding, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
