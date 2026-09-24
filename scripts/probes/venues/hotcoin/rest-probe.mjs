// Hotcoin perpetual REST probe: host and latency, catalog by family, the bulk anchor call over a minute, funding estimate against last settled rate, funding history spacing, index baskets, REST book, errors and clock.
// Public, unauthenticated, read-only. Hotcoin publishes no numeric limit, so every mode sends one request at a time and at most about 2 a second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hotcoin/rest-probe.mjs [latency|catalog|anchor|funding|history|index|book|errors|clock]
//   latency  DNS, 5 cold and 10 warm requests to the time call, and 3 warm catalog calls.
//   catalog  whether CCXT has a class, the perpetual list by settlement asset, direction and asset category, the contract unit from 24 h volume, pairs listed twice, the undocumented tickers call, and the spot symbol count.
//   anchor   40 polls of the catalog, one every second or back to back when a reply takes longer: reply time and size, and how often mark, index, rate and next settlement changed, with premiumIndex on BTC beside it. About 1 to 3 minutes, since a catalog reply took 0.7 to 5.8 s here.
//   funding  premiumIndex on 12 contracts: estimate against last settled rate against the catalog `fund`.
//   history  funding history on about 20 contracts from each settlement group, 38 in all on 2026-09-23, the spacing between settlements, and the settle delay after the hour.
//   index    indexInfo on 12 contracts: components, weights and the age of `time`.
//   book     REST orderbook on four contracts: level count, order, number types, sizes against the socket unit, and caching over back-to-back calls.
//   errors   unknown contract on each public call, bad query values and an unknown path.
//   clock    the time call and the Date header against the local clock.
// Set PROBE_OUT_DIR to keep the last catalog reply. Recorded in docs/profiles/hotcoin/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'api-ct.hotcoin.fit';
const API = `https://${HOST}/api/v1/perpetual/public`;
const SPOT_SYMBOLS = 'https://api.hotcoinfin.com/v1/common/symbols';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const iso = (ms) => new Date(Number(ms)).toISOString();
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stats = (a) => ({ n: a.length, min: Math.min(...a), median: pct(a, 0.5), p90: pct(a, 0.9), max: Math.max(...a) });

async function get(url, { fresh = false, timeoutMs = 15000 } = {}) {
  const t0 = performance.now();
  const headers = fresh ? { connection: 'close' } : {};
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), bytes: 0, text: String(e), json: undefined, headers: new Headers() };
  }
}

async function catalog() {
  const r = await get(API, { timeoutMs: 30000 });
  if (!Array.isArray(r.json?.data)) log('catalog_failed', { status: r.status, ms: r.ms, body: r.text.slice(0, 160) });
  return { r, rows: r.json?.data ?? [] };
}

async function latency() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${API}/time`, { fresh: true });
    cold.push(r.ms);
    await sleep(600);
  }
  const warm = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${API}/time`);
    warm.push(r.ms);
    await sleep(600);
  }
  const cat = [];
  for (let i = 0; i < 3; i++) {
    const r = await get(API);
    cat.push(r.ms);
    await sleep(1000);
  }
  const probe = await get(`${API}/time`);
  log('latency', { cold: stats(cold), warm: stats(warm), catalogWarm: cat, reqId: probe.headers.get('x-req-id') });
}

async function catalogMode() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, hotcoinLike: ccxt.exchanges.filter((x) => /hot|hcoin/i.test(x)) });
  const { r, rows } = await catalog();
  log('catalog_reply', { status: r.status, ms: r.ms, bytes: r.bytes, rows: rows.length, code: r.json?.code });
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'catalog.json'), r.text);
  }
  const fam = {};
  for (const m of rows) {
    const k = `${m.base}/${m.quote} dir=${m.direction} cat=${m.assetCategory} env=${m.env}`;
    fam[k] = (fam[k] ?? 0) + 1;
  }
  log('families', fam);
  const keys = new Set();
  rows.forEach((m) => Object.keys(m).forEach((k) => keys.add(k)));
  log('fields', { keys: [...keys].sort() });
  log('code_case', { lower: rows.filter((m) => m.code === m.code.toLowerCase()).length, displayUpper: rows.filter((m) => m.codeDisplayName === m.code.toUpperCase()).length, sample: rows.slice(0, 3).map((m) => [m.code, m.codeDisplayName]) });
  const diffDisplay = rows.filter((m) => m.codeDisplayName !== m.code.toUpperCase()).map((m) => [m.code, m.codeDisplayName]);
  log('display_differs', { n: diffDisplay.length, sample: diffDisplay.slice(0, 10) });

  // size24 over amount24 over price recovers the coins per contract on a linear contract, and the USD per contract on an inverse one.
  let agree = 0;
  let tested = 0;
  const off = [];
  for (const m of rows) {
    const a = Number(m.amount24);
    const s = Number(m.size24);
    const p = Number(m.price);
    const u = Number(m.unitAmount);
    if (!(a > 1000 && s > 0 && p > 0)) continue;
    tested++;
    const implied = m.direction === 0 ? s / a / p : (s * p) / a;
    const ratio = implied / u;
    if (ratio > 0.8 && ratio < 1.25) agree++;
    else off.push([m.code, u, Number(implied.toPrecision(3))]);
  }
  log('unit_check', { tested, agree, off: off.slice(0, 12) });
  const units = {};
  rows.forEach((m) => (units[Number(m.unitAmount)] = (units[Number(m.unitAmount)] ?? 0) + 1));
  log('unit_values', units);

  const byUnderlying = {};
  for (const m of rows) {
    const k = `${m.underlying ?? m.indexBase}|${m.direction}`;
    (byUnderlying[k] ??= []).push(m.code);
  }
  const twice = Object.entries(byUnderlying).filter(([, v]) => v.length > 1);
  log('listed_twice_same_direction', { n: twice.length, sample: twice.slice(0, 10) });
  const multi = {};
  for (const m of rows) (multi[m.underlying ?? m.indexBase] ??= new Set()).add(`${m.base}/${m.quote}`);
  const multiFam = Object.entries(multi).filter(([, v]) => v.size > 1).map(([k, v]) => [k, [...v]]);
  log('underlying_in_several_families', { n: multiFam.length, sample: multiFam.slice(0, 20) });
  const scaled = rows.filter((m) => /^1000|^10000|^1m|^100/.test(m.underlying ?? '')).map((m) => [m.code, m.underlying, Number(m.unitAmount)]);
  log('scaled_names', { n: scaled.length, sample: scaled.slice(0, 20) });
  const zero = rows.filter((m) => Number(m.markPrice) === 0 || Number(m.indexPrice) === 0);
  log('zero_mark_or_index', { n: zero.length, sample: zero.slice(0, 10).map((m) => [m.code, m.markPrice, m.indexPrice]) });
  const premium = rows.map((m) => Math.round((Number(m.markPrice) / Number(m.indexPrice) - 1) * 1e6));
  const top = rows.map((m, i) => [m.code, m.assetCategory, m.markPrice, m.indexPrice, premium[i]]).sort((a, b) => Math.abs(b[4]) - Math.abs(a[4]));
  log('mark_over_index_ppm', { min: Math.min(...premium), p5: pct(premium, 0.05), median: pct(premium, 0.5), p95: pct(premium, 0.95), max: Math.max(...premium), equal: rows.filter((m) => m.markPrice === m.indexPrice).length, over10000: premium.filter((p) => Math.abs(p) > 10000).length, top: top.slice(0, 4) });
  const fundAbs = rows.map((m) => Math.abs(Number(m.fund)));
  log('fund_range', { min: Math.min(...rows.map((m) => Number(m.fund))), max: Math.max(...rows.map((m) => Number(m.fund))), maxAbs: Math.max(...fundAbs) });
  const next = {};
  rows.forEach((m) => (next[iso(m.liquidationTime)] = (next[iso(m.liquidationTime)] ?? 0) + 1));
  log('next_settlement', next);
  const quiet = rows.filter((m) => Number(m.amount24) === 0);
  log('no_volume_24h', { n: quiet.length, sample: quiet.slice(0, 10).map((m) => m.code) });
  const stock = rows.filter((m) => m.assetCategory !== 'crypto').map((m) => `${m.code}:${m.assetCategory}`);
  log('non_crypto', { n: stock.length, sample: stock.slice(0, 12) });

  await sleep(800);
  const t = await get(`${API}/products/tickers`);
  const trows = t.json?.data ?? [];
  const tcodes = new Set(trows.map((x) => x[11]));
  const codes = new Set(rows.map((m) => m.code));
  const extra = trows.filter((x) => !codes.has(x[11]));
  log('tickers', { status: t.status, ms: t.ms, bytes: t.bytes, rows: trows.length, inCatalog: rows.filter((m) => tcodes.has(m.code)).length, notInCatalog: extra.length, notInCatalogWithVolume: extra.filter((x) => Number(x[3]) > 0).length, extraSample: extra.slice(0, 5).map((x) => x[11]), sample: trows[0] });

  await sleep(800);
  const sp = await get(SPOT_SYMBOLS);
  const srows = sp.json?.data ?? [];
  log('spot_symbols', { status: sp.status, ms: sp.ms, bytes: sp.bytes, rows: Array.isArray(srows) ? srows.length : typeof srows, sample: Array.isArray(srows) ? srows[0] : sp.text.slice(0, 200) });
}

async function anchor() {
  const polls = [];
  const prem = [];
  let prev;
  let prevPrem;
  const changes = {};
  const watch = ['btcusdt', 'ethusdt', 'sophusdt', 'xrpusd', 'btcusdc'];
  for (const w of watch) changes[w] = { mark: 0, index: 0, fund: 0, next: 0, polls: 0 };
  let allChanged = { mark: 0, index: 0 };
  let rowsPerPoll = 0;
  const POLLS = 40;
  for (let i = 0; i < POLLS; i++) {
    const t0 = Date.now();
    const { r, rows } = await catalog();
    polls.push({ ms: r.ms, bytes: r.bytes, status: r.status });
    const map = new Map(rows.map((m) => [m.code, m]));
    rowsPerPoll = rows.length;
    if (prev) {
      for (const w of watch) {
        const a = prev.get(w);
        const b = map.get(w);
        if (!a || !b) continue;
        changes[w].polls++;
        if (a.markPrice !== b.markPrice) changes[w].mark++;
        if (a.indexPrice !== b.indexPrice) changes[w].index++;
        if (a.fund !== b.fund) changes[w].fund++;
        if (a.liquidationTime !== b.liquidationTime) changes[w].next++;
      }
      let m = 0;
      let x = 0;
      for (const [k, b] of map) {
        const a = prev.get(k);
        if (!a) continue;
        if (a.markPrice !== b.markPrice) m++;
        if (a.indexPrice !== b.indexPrice) x++;
      }
      allChanged.mark += m;
      allChanged.index += x;
    }
    prev = map;
    const p = await get(`${API}/btcusdt/premiumIndex`);
    const d = p.json?.data;
    if (d) {
      const c = map.get('btcusdt');
      prem.push({ ms: p.ms, sameMark: c?.markPrice === d.markPrice, sameIndex: c?.indexPrice === d.indexPrice, estChanged: prevPrem ? prevPrem.estimateFeeRate !== d.estimateFeeRate : false, timeAge: Date.now() - d.time });
      prevPrem = d;
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  const ms = polls.map((p) => p.ms);
  log('anchor_catalog', { polls: polls.length, statuses: [...new Set(polls.map((p) => p.status))], ms: stats(ms), over1s: ms.filter((x) => x > 1000).length, over2s: ms.filter((x) => x > 2000).length, bytes: stats(polls.map((p) => p.bytes)), rows: rowsPerPoll });
  log('anchor_changes', { pollPairs: POLLS - 1, changes, allRowsMarkChanges: allChanged.mark, allRowsIndexChanges: allChanged.index, perPollAvgMark: Math.round(allChanged.mark / (POLLS - 1)), perPollAvgIndex: Math.round(allChanged.index / (POLLS - 1)) });
  log('premium_btc', { n: prem.length, ms: stats(prem.map((p) => p.ms)), sameMark: prem.filter((p) => p.sameMark).length, sameIndex: prem.filter((p) => p.sameIndex).length, estChanged: prem.filter((p) => p.estChanged).length, timeAge: stats(prem.map((p) => p.timeAge)) });
}

async function funding() {
  const { rows } = await catalog();
  const map = new Map(rows.map((m) => [m.code, m]));
  const pick = ['btcusdt', 'ethusdt', 'solusdt', 'sophusdt', 'xrpusd', 'btcusd', 'btcusdc', 'ethusdc'];
  const fours = rows.filter((m) => m.liquidationTime !== map.get('btcusdt')?.liquidationTime).slice(0, 2).map((m) => m.code);
  const stocks = rows.filter((m) => m.assetCategory === 'us_stock').slice(0, 2).map((m) => m.code);
  for (const c of [...pick, ...fours, ...stocks]) {
    await sleep(500);
    const p = await get(`${API}/${c}/premiumIndex`);
    const d = p.json?.data;
    const m = map.get(c);
    log('premium', { c, status: p.status, ms: p.ms, est: d?.estimateFeeRate, last: d?.lastFeeRate, catFund: m?.fund, catFundIsLast: m?.fund !== undefined && d ? Number(m.fund) === Number(d.lastFeeRate) : null, next: d ? iso(d.liquidationTime) : null, catNext: m ? iso(m.liquidationTime) : null, mark: d?.markPrice, catMark: m?.markPrice, index: d?.indexPrice, catIndex: m?.indexPrice, lastPx: d?.lastPrice, timeAgeMs: d ? Date.now() - d.time : null, cat: m?.assetCategory });
  }
}

async function history() {
  const { rows } = await catalog();
  const btcNext = rows.find((m) => m.code === 'btcusdt')?.liquidationTime;
  const groupA = rows.filter((m) => m.liquidationTime === btcNext);
  const groupB = rows.filter((m) => m.liquidationTime !== btcNext);
  const sample = [...groupA.filter((_, i) => i % Math.ceil(groupA.length / 20) === 0), ...groupB.filter((_, i) => i % Math.ceil(groupB.length / 20) === 0)];
  const spacing = {};
  const delays = [];
  const caps = [];
  for (const m of sample) {
    await sleep(500);
    const r = await get(`${API}/${m.code}/fee-rate?page=1&pageSize=10`);
    const list = r.json?.data?.rows ?? [];
    const ts = list.map((x) => x.createdDate).sort((a, b) => b - a);
    const gaps = [];
    for (let i = 1; i < ts.length; i++) gaps.push(Math.round((ts[i - 1] - ts[i]) / 3600000));
    const mode = gaps.length ? pct(gaps, 0.5) : null;
    const key = `next=${iso(m.liquidationTime).slice(11, 16)} gapH=${mode}`;
    spacing[key] = (spacing[key] ?? 0) + 1;
    for (const t of ts) delays.push(Math.round((t % 3600000) / 1000));
    const rates = list.map((x) => Number(x.feeRate));
    caps.push([m.code, Math.min(...rates), Math.max(...rates)]);
    if (list[0] && Number(m.fund) !== Number(list[0].feeRate)) log('fund_not_latest', { c: m.code, fund: m.fund, latest: list[0].feeRate });
  }
  log('history_spacing', { sampled: sample.length, groupA: groupA.length, groupB: groupB.length, spacing });
  log('history_settle_delay_s', stats(delays));
  const vals = {};
  for (const [, lo, hi] of caps) for (const v of [lo, hi]) vals[v] = (vals[v] ?? 0) + 1;
  log('history_extremes', { topValues: Object.entries(vals).sort((a, b) => b[1] - a[1]).slice(0, 8), sample: caps.slice(0, 8) });
  const r = await get(`${API}/btcusdt/fee-rate?page=1&pageSize=3`);
  log('history_shape', { status: r.status, keys: Object.keys(r.json?.data ?? {}), row: r.json?.data?.rows?.[0] });
}

async function index() {
  const { rows } = await catalog();
  const pick = ['btcusdt', 'ethusdt', 'solusdt', 'sophusdt', 'xrpusd', 'btcusdc'];
  const extra = rows.filter((m) => m.assetCategory !== 'crypto').slice(0, 3).map((m) => m.code);
  const tail = rows.filter((_, i) => i % 150 === 75).map((m) => m.code);
  const map = new Map(rows.map((m) => [m.code, m]));
  for (const c of [...pick, ...extra, ...tail]) {
    await sleep(500);
    const r = await get(`${API}/${c}/indexInfo`);
    const d = r.json?.data;
    log('index', { c, status: r.status, code: r.json?.code, msg: r.json?.msg, comps: d?.components?.map((x) => `${x.name}:${x.symbol}:${x.wgt}`), indexPrice: d?.indexPrice, catIndex: map.get(c)?.indexPrice, time: d?.time ? iso(d.time) : null });
  }
}

async function book() {
  const { rows } = await catalog();
  const map = new Map(rows.map((m) => [m.code, m]));
  const byTurnover = rows.filter((m) => m.direction === 0 && Number(m.amount24) > 0).sort((a, b) => Number(a.size24) - Number(b.size24));
  const quiet = byTurnover[5]?.code ?? 'klacusdt';
  log('quiet_pick', { quiet, turnover24: byTurnover[5]?.size24 });
  for (const c of ['btcusdt', 'sophusdt', 'xrpusd', quiet]) {
    await sleep(600);
    const a = await get(`${API}/products/${c}/orderbook`);
    const b = await get(`${API}/products/${c}/orderbook`);
    const d = a.json?.data ?? a.json;
    const bids = d?.bids ?? [];
    const asks = d?.asks ?? [];
    const desc = bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]));
    const asc = asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]));
    const cum = bids.every((l, i) => Number(l[2]) === (i === 0 ? 0 : Number(bids[i - 1][2])) + Number(l[1]));
    log('rest_book', { c, status: a.status, ms: a.ms, bytes: a.bytes, topKeys: Object.keys(a.json ?? {}), bids: bids.length, asks: asks.length, bidsDesc: desc, asksAsc: asc, thirdIsCumulative: cum, types: [typeof bids[0]?.[0], typeof bids[0]?.[1]], touch: [bids[0], asks[0]], unit: map.get(c)?.unitAmount, identicalBackToBack: a.text === b.text, secondMs: b.ms, cache: a.headers.get('cache-control') });
  }
  const thin = [];
  for (const m of byTurnover.slice(0, 8)) {
    await sleep(500);
    const r = await get(`${API}/products/${m.code}/orderbook`);
    const d = r.json ?? {};
    const bid = Number(d.bids?.[0]?.[0]);
    const ask = Number(d.asks?.[0]?.[0]);
    thin.push([m.code, m.assetCategory, Number(m.size24), d.bids?.length ?? 0, d.asks?.length ?? 0, bid && ask ? Math.round((ask / bid - 1) * 1e6) : null]);
  }
  log('thin_books', { columns: ['code', 'category', 'turnover24', 'bids', 'asks', 'spreadPpm'], rows: thin });
  for (const q of ['?depth=5', '?limit=100', '?size=200']) {
    await sleep(600);
    const r = await get(`${API}/products/btcusdt/orderbook${q}`);
    const d = r.json?.data ?? r.json;
    log('rest_book_param', { q, status: r.status, bids: d?.bids?.length, asks: d?.asks?.length });
  }
}

async function errors() {
  const cases = [
    `${API}/nopeusdt/premiumIndex`,
    `${API}/nopeusdt/indexInfo`,
    `${API}/nopeusdt/fee-rate`,
    `${API}/products/nopeusdt/orderbook`,
    `${API}/nopeusdt/fills`,
    `${API}/nopeusdt/candles?kline=1min`,
    `${API}/BTCUSDT/premiumIndex`,
    `${API}/products/BTCUSDT/orderbook`,
    `${API}/btcusdt/candles?kline=7min`,
    `${API}/btcusdt/fee-rate?page=0&pageSize=100000`,
    `https://${HOST}/api/v1/perpetual/nope`,
  ];
  for (const u of cases) {
    await sleep(500);
    const r = await get(u);
    log('error_case', { url: u.replace(`https://${HOST}`, ''), status: r.status, ms: r.ms, body: r.text.slice(0, 160) });
  }
}

async function clock() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/time`);
    const t1 = Date.now();
    const server = Number(r.json?.timestamp);
    out.push({ offsetMs: server - Math.round((t0 + t1) / 2), rttMs: t1 - t0, date: r.headers.get('date') });
    await sleep(600);
  }
  log('clock', { samples: out, body: (await get(`${API}/time`)).text });
}

const modes = { latency, catalog: catalogMode, anchor, funding, history, index, book, errors, clock };
const mode = process.argv[2] ?? 'catalog';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(' ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
