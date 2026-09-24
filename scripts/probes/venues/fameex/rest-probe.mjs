// FameEX futures REST probe: catalog, the per contract anchor calls and how often they change, funding history, the REST book, errors, headers and clock offset.
// Public, unauthenticated, read-only. At most 5 requests a second, since market data calls publish no limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/fameex/rest-probe.mjs [catalog|anchor|survey|book|limits|config]
//   catalog  host resolution, cold and warm time, the contract list by status and multiplier, the spot symbol count, and whether CCXT 4.5.68 has a class. About 10 s.
//   anchor   bulk attempts, then 60 one second polls of /index on four perps, counting how often each field changes and when the index moved. About 65 s.
//   survey   the undocumented /v1/inner/contract_config once, then one /index and one /fundingRate?symbol= per active perp, one pair at a time: zero marks, mark to index gaps, rate bounds, interval and last settlement. About 150 s.
//   book     /depth at several limits, level order, a lowercase name, an unknown name, repeated reads for caching. About 10 s.
//   limits   response headers, error shapes and status codes, and the clock offset against /time. About 15 s.
//   config   the undocumented /v1/inner/contract_config once, against the documented contract list: field values by count. About 3 s.
// Recorded in docs/profiles/fameex/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'futuresopenapi.fameex.com';
const API = `https://${HOST}/fapi/v1`;
const SPOT = 'https://openapi.fameex.com/sapi/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

async function get(url) {
  const t = performance.now();
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  const text = await r.text();
  const ms = Math.round(performance.now() - t);
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, ms, bytes: text.length, json, text, headers: Object.fromEntries(r.headers) };
}

async function contracts() {
  return (await get(`${API}/contracts`)).json;
}

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });
  const times = [];
  for (let i = 0; i < 6; i++) { times.push((await get(`${API}/time`)).ms); await sleep(200); }
  log('time_call_ms', { cold: times[0], warm: times.slice(1) });
  const c = await get(`${API}/contracts`);
  const list = c.json;
  const by = (f) => list.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  log('contracts', { status: c.status, ms: c.ms, bytes: c.bytes, rows: list.length, byStatus: by((x) => x.status), byType: by((x) => x.type), bySide: by((x) => x.side), byQuote: by((x) => x.symbol.split('-').at(-1)), fields: Object.keys(list[0]) });
  const active = list.filter((x) => x.status === 1);
  log('active', { count: active.length, multipliers: by.call(null, (x) => (x.status === 1 ? x.multiplier : 'inactive')), multiplierCoinNotBase: active.filter((x) => x.multiplierCoin !== x.symbol.split('-')[1]).map((x) => `${x.symbol}:${x.multiplierCoin}:${x.multiplier}`) });
  const pairs = {};
  for (const x of list) pairs[x.symbol.slice(2)] = (pairs[x.symbol.slice(2)] || 0) + 1;
  log('pairs_listed_twice', { pairs: Object.entries(pairs).filter(([, n]) => n > 1) });
  const scaled = active.filter((x) => /^E-(1000|10000|1M)/.test(x.symbol)).map((x) => `${x.symbol}:${x.multiplier}`);
  log('scaled_names', { scaled });
  const s = await get(`${SPOT}/symbols`);
  const syms = s.json?.data?.symbols ?? s.json?.symbols ?? [];
  log('spot_symbols', { status: s.status, ms: s.ms, count: syms.length, quotes: syms.reduce((m, x) => ((m[x.quoteAsset] = (m[x.quoteAsset] || 0) + 1), m), {}) });
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, hasFameex: ccxt.exchanges.some((e) => /fame/i.test(e)), exchanges: ccxt.exchanges.length });
}

async function anchor() {
  for (const q of ['index', 'ticker', 'fundingRate', 'index?contractName=E-BTC-USDT,E-ETH-USDT']) {
    const r = await get(`${API}/${q}`);
    const rows = Array.isArray(r.json) ? r.json.length : null;
    log('bulk_attempt', { q, status: r.status, ms: r.ms, bytes: r.bytes, rows, head: r.text.slice(0, 160) });
    await sleep(300);
  }
  const ids = ['E-BTC-USDT', 'E-ETH-USDT', 'E-ZIL-USDT', 'E-AAPL-USDT'];
  const st = Object.fromEntries(ids.map((id) => [id, { ms: [], changes: {}, prev: null, gapPpm: [], fields: null, sample: null, indexChangedAtPoll: [] }]));
  for (let i = 0; i < 60; i++) {
    const t = Date.now();
    await Promise.all(ids.map(async (id) => {
      const r = await get(`${API}/index?contractName=${id}`);
      const x = st[id];
      x.ms.push(r.ms);
      const j = r.json;
      if (!j || j.code) return;
      x.fields = Object.keys(j);
      x.sample = j;
      if (x.prev) for (const k of Object.keys(j)) if (j[k] !== x.prev[k]) x.changes[k] = (x.changes[k] || 0) + 1;
      if (x.prev && j.indexPrice !== x.prev.indexPrice) x.indexChangedAtPoll.push(i);
      x.prev = j;
      x.gapPpm.push(Math.round(((j.tagPrice - j.indexPrice) / j.indexPrice) * 1e6));
    }));
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  for (const [id, x] of Object.entries(st)) {
    log('index_poll', { id, polls: x.ms.length, msMin: pct(x.ms, 0), msP50: pct(x.ms, 0.5), msP90: pct(x.ms, 0.9), msMax: pct(x.ms, 1), changesIn59: x.changes, indexChangedAtPoll: x.indexChangedAtPoll.length <= 12 ? x.indexChangedAtPoll : x.indexChangedAtPoll.length, markMinusIndexPpm: [pct(x.gapPpm, 0), pct(x.gapPpm, 0.5), pct(x.gapPpm, 1)], last: x.sample });
  }
}

// Settlement rows sit on the hour, give or take a minute. Rows elsewhere are noise, such as the rate 0 rows an equity perp writes about every 70 s while its home market is shut.
function scheduled(hist) {
  const byHour = new Map();
  for (const h of hist) {
    const into = h.fundingTime % 3_600_000;
    if (into > 60_000) continue;
    const hour = h.fundingTime - into;
    if (!byHour.has(hour)) byHour.set(hour, h);
  }
  return [...byHour.entries()].sort((a, b) => a[0] - b[0]);
}

async function survey() {
  const cfgReply = await get(`https://${HOST}/v1/inner/contract_config`);
  const cfg = new Map(cfgReply.json.data.contractList.map((x) => [x.contractName, x]));
  log('contract_config', { status: cfgReply.status, ms: cfgReply.ms, bytes: cfgReply.bytes, rows: cfg.size });
  const active = (await contracts()).filter((x) => x.status === 1);
  const rows = [];
  const now = Date.now();
  for (const c of active) {
    const t = Date.now();
    const [ix, fr] = await Promise.all([get(`${API}/index?contractName=${c.symbol}`), get(`${API}/fundingRate?symbol=${c.symbol}`)]);
    const hist = Array.isArray(fr.json) ? fr.json.filter((h) => h.symbol === c.symbol) : [];
    const sch = scheduled(hist);
    const gaps = sch.slice(1).map(([h], i) => (h - sch[i][0]) / 3_600_000);
    const recent = gaps.slice(-6);
    const freq = cfg.get(c.symbol)?.capitalFrequency;
    const last = sch.at(-1);
    rows.push({ id: c.symbol, ix: ix.json, ixMs: ix.ms, frMs: fr.ms, histRows: hist.length, offHourRows: hist.length - sch.length, otherSymbols: Array.isArray(fr.json) ? fr.json.length - hist.length : null, intervalH: pct(recent, 0.5), freq, lastAt: last?.[0], lastRate: last?.[1].fundingRate, alignsWithFreq: last && freq ? last[0] % (freq * 3_600_000) === 0 : null });
    await sleep(Math.max(0, 400 - (Date.now() - t)));
  }
  const ok = rows.filter((r) => r.ix && !r.ix.code);
  const by = (f) => rows.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  log('survey', { active: active.length, inConfig: rows.filter((r) => r.freq !== undefined).length, indexOk: ok.length, indexErrors: rows.filter((r) => !r.ix || r.ix.code).map((r) => `${r.id}:${JSON.stringify(r.ix).slice(0, 80)}`), ixMsP50: pct(rows.map((r) => r.ixMs), 0.5), ixMsMax: pct(rows.map((r) => r.ixMs), 1), frMsP50: pct(rows.map((r) => r.frMs), 0.5), histRowsP50: pct(rows.map((r) => r.histRows), 0.5), histOtherSymbols: rows.filter((r) => r.otherSymbols).length, contractsWithOffHourRows: rows.filter((r) => r.offHourRows > 0).length });
  log('survey_zero', { markZero: ok.filter((r) => !r.ix.tagPrice).map((r) => r.id), indexZero: ok.filter((r) => !r.ix.indexPrice).map((r) => r.id), rateMissing: ok.filter((r) => typeof r.ix.nextFundRate !== 'number').map((r) => r.id) });
  const gap = ok.filter((r) => r.ix.indexPrice).map((r) => ({ id: r.id, ppm: Math.round(((r.ix.tagPrice - r.ix.indexPrice) / r.ix.indexPrice) * 1e6), lastVsIndexPpm: Math.round(((r.ix.newPrice - r.ix.indexPrice) / r.ix.indexPrice) * 1e6), markIsLast: r.ix.tagPrice === r.ix.newPrice }));
  const abs = gap.map((g) => Math.abs(g.ppm));
  log('survey_mark_gap', { absPpmP50: pct(abs, 0.5), absPpmP90: pct(abs, 0.9), absPpmMax: pct(abs, 1), over1000: gap.filter((g) => Math.abs(g.ppm) > 1000).length, markEqualsLast: gap.filter((g) => g.markIsLast).length, top: gap.sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm)).slice(0, 8) });
  const rates = ok.map((r) => r.ix.nextFundRate);
  const cur = ok.map((r) => r.ix.currentFundRate);
  const settled = rows.filter((r) => r.lastRate !== undefined).map((r) => Number(r.lastRate));
  log('survey_rates', { nextMin: pct(rates, 0), nextP50: pct(rates, 0.5), nextMax: pct(rates, 1), currentMin: pct(cur, 0), currentMax: pct(cur, 1), lastSettledMin: pct(settled, 0), lastSettledMax: pct(settled, 1), overPremiumBound: ok.filter((r) => Math.abs(r.ix.nextFundRate) > 0.0005).length, nextAbsTop: [...ok].sort((a, b) => Math.abs(b.ix.nextFundRate) - Math.abs(a.ix.nextFundRate)).slice(0, 6).map((r) => `${r.id}:${r.ix.nextFundRate}`), currentEqualsLastSettled: ok.filter((r) => r.lastRate !== undefined && Number(r.lastRate) === r.ix.currentFundRate).length, nextEqualsLastSettled: ok.filter((r) => r.lastRate !== undefined && Number(r.lastRate) === r.ix.nextFundRate).length, nextAt0_00005: rates.filter((x) => x === 0.00005).length, nextAt0_0001: rates.filter((x) => x === 0.0001).length, nextAt0: rates.filter((x) => x === 0).length, compared: ok.filter((r) => r.lastRate !== undefined).length });
  log('survey_interval', { historyIntervalH: by((r) => r.intervalH), configFrequencyH: by((r) => r.freq), historyEqualsConfig: rows.filter((r) => r.intervalH === r.freq).length, differ: rows.filter((r) => r.intervalH !== r.freq).map((r) => `${r.id}:hist${r.intervalH}:cfg${r.freq}`).slice(0, 12), lastSettlementAlignsWithFreqFromMidnightUtc: by((r) => r.alignsWithFreq), lastSettlementUtc: by((r) => iso(r.lastAt)?.slice(0, 16)), overdue: rows.filter((r) => r.freq && r.lastAt && now - r.lastAt > r.freq * 3_600_000 + 120_000).map((r) => `${r.id}:${iso(r.lastAt)}:cfg${r.freq}`).slice(0, 12) });
}

async function book() {
  for (const limit of [5, 20, 100, 101, 1000]) {
    const r = await get(`${API}/depth?contractName=E-BTC-USDT&limit=${limit}`);
    const j = r.json;
    const bidDesc = j.bids.every((l, i) => i === 0 || l[0] < j.bids[i - 1][0]);
    const askAsc = j.asks.every((l, i) => i === 0 || l[0] > j.asks[i - 1][0]);
    log('depth', { limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: j.bids.length, asks: j.asks.length, bidDesc, askAsc, time: j.time, keys: Object.keys(j), top: [j.bids[0], j.asks[0]], cache: r.headers['cache-control'] ?? null, age: r.headers.age ?? null });
    await sleep(300);
  }
  const noLimit = await get(`${API}/depth?contractName=E-BTC-USDT`);
  log('depth_default', { bids: noLimit.json.bids.length, asks: noLimit.json.asks.length });
  for (const q of ['contractName=e-btc-usdt&limit=5', 'contractName=E-NOPE-USDT&limit=5', 'contractName=E-HIFI-USDT&limit=5', 'limit=5']) {
    const r = await get(`${API}/depth?${q}`);
    log('depth_case', { q, status: r.status, body: r.text.slice(0, 200) });
    await sleep(300);
  }
  const tops = [];
  for (let i = 0; i < 10; i++) { const r = await get(`${API}/depth?contractName=E-BTC-USDT&limit=5`); tops.push(JSON.stringify([r.json.bids[0], r.json.asks[0]])); await sleep(200); }
  log('depth_repeat', { reads: tops.length, distinctTops: new Set(tops).size });
}

async function limits() {
  const t = await get(`${API}/time`);
  log('headers', { status: t.status, headers: Object.fromEntries(Object.entries(t.headers).filter(([k]) => !/cookie|date|x-iinfo/i.test(k))) });
  const cases = ['index?contractName=E-NOPE-USDT', 'index', 'ticker?contractName=E-NOPE-USDT', 'tickers', 'premiumIndex', 'nope', 'depth?contractName=E-BTC-USDT&limit=abc', 'klines?contractName=E-BTC-USDT&interval=1min&limit=2'];
  for (const q of cases) {
    const r = await get(`${API}/${q}`);
    log('error_case', { q, status: r.status, contentType: r.headers['content-type'], body: r.text.slice(0, 220) });
    await sleep(300);
  }
  const offsets = [];
  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const a = Date.now();
    const r = await get(`${API}/time`);
    const b = Date.now();
    offsets.push(r.json.serverTime - (a + b) / 2);
    rtts.push(b - a);
    await sleep(300);
  }
  log('clock', { offsetMsMin: pct(offsets, 0), offsetMsP50: pct(offsets, 0.5), offsetMsMax: pct(offsets, 1), rttMsP50: pct(rtts, 0.5), timezone: (await get(`${API}/time`)).json.timezone });
  const sp = [];
  for (let i = 0; i < 5; i++) { const a = Date.now(); const r = await get(`${SPOT}/time`); const b = Date.now(); sp.push(r.json.server_time - (a + b) / 2); await sleep(300); }
  log('spot_clock', { offsetMsP50: pct(sp, 0.5) });
}

async function config() {
  const r = await get(`https://${HOST}/v1/inner/contract_config`);
  const rows = r.json.data.contractList;
  const list = await contracts();
  const active = list.filter((x) => x.status === 1);
  const by = (f) => rows.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  const bySym = new Map(active.map((x) => [x.symbol, x]));
  log('contract_config', { status: r.status, ms: r.ms, bytes: r.bytes, rows: rows.length, sameSetAsActive: rows.length === active.length && rows.every((x) => bySym.has(x.contractName)), multiplierDiffers: rows.filter((x) => bySym.get(x.contractName)?.multiplier !== x.multiplier).length, fields: Object.keys(rows[0]) });
  log('config_values', { capitalFrequency: by((x) => x.capitalFrequency), shortIntervals: rows.filter((x) => x.capitalFrequency < 4).map((x) => `${x.contractName}:${x.capitalFrequency}`), capitalStartTime: by((x) => x.capitalStartTime), capitalPremium: by((x) => `${x.capitalPremiumMin}/${x.capitalPremiumMax}`), priceRange: by((x) => x.priceRange), settlementFrequency: by((x) => x.settlementFrequency), deliveryKind: by((x) => x.deliveryKind), contractType: by((x) => x.contractType), maxLever: by((x) => x.maxLever), baseNotMultiplierCoin: rows.filter((x) => x.base !== x.multiplierCoin).map((x) => `${x.contractName}:${x.base}:${x.multiplierCoin}`) });
  log('named', { present: ['E-HK0700-USDT', 'E-NATGAS-USDT', 'E-XAU-USDT', 'E-AAPL-USDT', 'E-NVDA-USDT', 'E-KUAISHOU-USDT'].map((s) => `${s}:${list.find((x) => x.symbol === s)?.status ?? 'absent'}`) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, survey, book, limits, config };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(2); }
await modes[mode]();
