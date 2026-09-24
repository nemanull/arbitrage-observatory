// Aivora futures REST probe: host and latency, catalog against the web contract list, per contract anchor polls, REST book, errors and headers.
// Public, unauthenticated, read-only. No API key is sent and no order or private call is made.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/aivora/rest-probe.mjs [latency|catalog|anchor|sweep|book|errors|fees]
//   latency  DNS, one cold and ten warm GET /time, clock offset against serverTime. About 15 s.
//   catalog  GET /contracts and the web POST public_info_v2, counts by status and quote, symbol spellings, CCXT presence. About 5 s.
//   anchor   GET /index for four contracts and /ticker for two once a second for 60 s, reply time, how often each field changed, mark against last. About 65 s.
//   sweep    GET /index for every tradable contract once, one at a time, to time a whole round. About 60 to 120 s.
//   book     GET /depth at several limits, level order, the four columns, back to back repeats. About 15 s.
//   errors   unknown contract, missing parameter, odd limits, unknown path, and the response headers. About 10 s.
//   fees     the spot and futures VIP tables from the data call behind the site's fee page. About 3 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/aivora/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://openapi.aivora.com/futures/open/fapi/v1';
const WEB_INFO = 'https://api.aivora.com/futures/api/common/public_info_v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, init) {
  const t0 = performance.now();
  const res = await fetch(path.startsWith('http') ? path : API + path, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const webInfo = () =>
  get(WEB_INFO, { method: 'POST', headers: { 'Content-Type': 'application/json', 'exchange-client': 'pc' }, body: '{}' });

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

async function latency() {
  for (const host of ['openapi.aivora.com', 'api.aivora.com', 'ws.aivora.com', 'futuresws.aivora.com']) {
    try {
      const a = await lookup(host, { all: true });
      log('dns', { host, addrs: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }
  const cold = await get('/time');
  log('cold', { status: cold.status, ms: cold.ms, body: cold.text, via: cold.headers.get('via'), server: cold.headers.get('server') });
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get('/time');
    const after = Date.now();
    warm.push(r.ms);
    if (r.json?.serverTime) offsets.push(r.json.serverTime - (before + after) / 2);
    await sleep(500);
  }
  log('warm_time', stats(warm));
  log('clock_offset_ms', stats(offsets.map(Math.round)));
  const ping = await get('/ping');
  log('ping', { status: ping.status, ms: ping.ms, body: ping.text });
}

async function catalog() {
  const r = await get('/contracts');
  keep('contracts.json', r.text);
  const rows = r.json;
  const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  log('contracts', { status: r.status, ms: r.ms, bytes: r.bytes, rows: rows.length, keys: Object.keys(rows[0]) });
  log('contracts_counts', {
    type: count(rows, (x) => x.type),
    side: count(rows, (x) => x.side),
    status: count(rows, (x) => x.status),
    quoteAll: count(rows, (x) => x.symbol.split('-')[2]),
    quoteTradable: count(rows.filter((x) => x.status === 1), (x) => x.symbol.split('-')[2]),
  });
  const tradable = rows.filter((x) => x.status === 1);
  const bases = count(tradable, (x) => x.symbol.split('-')[1]);
  log('pairs_listed_twice', { bases: Object.entries(bases).filter(([, n]) => n > 1).map(([b]) => b) });
  log('base_not_multiplierCoin', { rows: rows.filter((x) => x.symbol.split('-')[1] !== x.multiplierCoin).map((x) => x.symbol) });
  const w = await webInfo();
  keep('public_info_v2.json', w.text);
  const list = w.json?.data?.contractList ?? [];
  log('web_info', { status: w.status, ms: w.ms, bytes: w.bytes, code: w.json?.code, contracts: list.length, wsUrl: w.json?.data?.wsUrl, marginCoins: w.json?.data?.marginCoinList });
  log('web_counts', {
    capitalFrequency: count(list, (x) => x.capitalFrequency),
    nextCapitalSettTime: count(list, (x) => x.nextCapitalSettTime),
    capitalStartTime: count(list, (x) => x.capitalStartTime),
    marginCoin: count(list, (x) => x.marginCoin),
    maxLever: count(list, (x) => x.maxLever),
  });
  log('web_off_grid', { rows: list.filter((x) => x.capitalStartTime !== 0).map((x) => [x.contractName, x.capitalStartTime, x.nextCapitalSettTime]) });
  const inOpen = new Map(rows.map((x) => [x.symbol, x]));
  let sameSet = 0;
  let sameMult = 0;
  let stepIsTick = 0;
  let subSymbolRule = 0;
  for (const c of list) {
    const o = inOpen.get(c.contractName);
    if (o && o.status === 1) sameSet++;
    if (o && Number(o.multiplier) === Number(c.multiplier)) sameMult++;
    if (Number(c.coinResultVo.depthList[0]) === 10 ** -c.coinResultVo.symbolPricePrecision) stepIsTick++;
    if (c.subSymbol === 'e_' + c.contractName.split('-').slice(1).join('').toLowerCase()) subSymbolRule++;
  }
  log('web_vs_open', { webRows: list.length, tradableOpenRows: tradable.length, webRowTradableInOpen: sameSet, sameMultiplier: sameMult, finestDepthStepIsTick: stepIsTick, subSymbolIsLowerWithPrefix: subSymbolRule });
  const btc = list.find((x) => x.contractName === 'E-BTC-USDT');
  log('web_btc_row', { row: btc });
  log('open_btc_row', { row: rows.find((x) => x.symbol === 'E-BTC-USDT') });
  const tradfi = ['XAU', 'XAG', 'XPT', 'XPD', 'CL', 'BZ', 'NATGAS', 'SPY', 'QQQ', 'AAPL', 'AMZN', 'COIN', 'CRCL', 'GOOGL', 'HOOD', 'INTC', 'MSFT', 'MSTR', 'MU', 'NVDA', 'PLTR', 'SNDK', 'TSLA', 'TSM'];
  log('tradfi_tradable', { rows: tradable.filter((x) => tradfi.includes(x.symbol.split('-')[1])).map((x) => x.symbol) });
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, aivoraLike: ccxt.exchanges.filter((x) => /aiv|vora/i.test(x)) });
}

const ANCHOR_SET = ['E-BTC-USDT', 'E-ETH-USDT', 'E-FARTCOIN-USDT', 'E-XAU-USDT'];
const TICKER_SET = ['E-BTC-USDT', 'E-FARTCOIN-USDT'];

async function anchor() {
  const seen = Object.fromEntries(ANCHOR_SET.map((c) => [c, { last: null, changes: {}, polls: 0, keys: null }]));
  const times = [];
  const markVsLast = Object.fromEntries(TICKER_SET.map((c) => [c, { polls: 0, markIsLast: 0, markIsIndex: 0, markInsideTouch: 0 }]));
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const tick = Date.now();
    const [replies, tickers] = await Promise.all([
      Promise.all(ANCHOR_SET.map((c) => get(`/index?contractName=${c}`))),
      Promise.all(TICKER_SET.map((c) => get(`/ticker?contractName=${c}`))),
    ]);
    tickers.forEach((t, k) => {
      const r = replies[ANCHOR_SET.indexOf(TICKER_SET[k])];
      const m = markVsLast[TICKER_SET[k]];
      if (!t.json?.last || !r.json?.tagPrice) return;
      m.polls++;
      if (Number(t.json.last) === r.json.tagPrice) m.markIsLast++;
      if (r.json.tagPrice === r.json.indexPrice) m.markIsIndex++;
      const bid = Number(t.json.buy);
      const ask = Number(t.json.sell);
      if (r.json.tagPrice >= bid && r.json.tagPrice <= ask) m.markInsideTouch++;
    });
    replies.forEach((r, k) => {
      const c = ANCHOR_SET[k];
      const s = seen[c];
      times.push(r.ms);
      if (r.status !== 200 || !r.json) {
        log('anchor_error', { c, status: r.status, body: r.text.slice(0, 200) });
        return;
      }
      s.polls++;
      s.keys ??= Object.keys(r.json);
      if (i === 0) log('anchor_first', { c, body: r.json });
      if (s.last) for (const f of Object.keys(r.json)) if (r.json[f] !== s.last[f]) s.changes[f] = (s.changes[f] ?? 0) + 1;
      s.last = r.json;
    });
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  for (const c of ANCHOR_SET) log('anchor_changes', { c, polls: seen[c].polls, keys: seen[c].keys, changes: seen[c].changes, last: seen[c].last });
  log('anchor_mark_vs_ticker', markVsLast);
  log('anchor_reply_ms', stats(times));
  log('anchor_wall_s', { s: Math.round((Date.now() - t0) / 1000) });
}

async function sweep() {
  const rows = (await get('/contracts')).json.filter((x) => x.status === 1);
  const times = [];
  const bad = [];
  const nextRates = {};
  const markEqIndex = [];
  let zeroMark = 0;
  const premiums = [];
  const t0 = Date.now();
  for (const c of rows) {
    const r = await get(`/index?contractName=${c.symbol}`);
    times.push(r.ms);
    if (r.status !== 200 || typeof r.json?.tagPrice !== 'number') {
      bad.push([c.symbol, r.status, r.text.slice(0, 80)]);
      continue;
    }
    const j = r.json;
    if (j.tagPrice === j.indexPrice) markEqIndex.push(c.symbol);
    if (!j.tagPrice) zeroMark++;
    premiums.push([c.symbol, Math.round(((j.tagPrice - j.indexPrice) / j.indexPrice) * 1e6)]);
    nextRates[String(j.nextFundRate)] = (nextRates[String(j.nextFundRate)] ?? 0) + 1;
  }
  const wall = Date.now() - t0;
  premiums.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  log('sweep', { contracts: rows.length, wallMs: wall, reply: stats(times), bad, markEqualsIndex: markEqIndex.length, zeroMark });
  log('sweep_mark_equals_index', { rows: markEqIndex });
  log('sweep_mark_premium_ppm_top', { rows: premiums.slice(0, 8) });
  log('sweep_nextFundRate_values', { distinct: Object.keys(nextRates).length, top: Object.entries(nextRates).sort((a, b) => b[1] - a[1]).slice(0, 6) });
}

async function book() {
  for (const limit of [5, 30, 100, 150]) {
    const r = await get(`/depth?contractName=E-BTC-USDT&limit=${limit}`);
    const j = r.json;
    const b = j?.bids ?? [];
    const a = j?.asks ?? [];
    const desc = b.every((x, i) => i === 0 || Number(x[0]) < Number(b[i - 1][0]));
    const asc = a.every((x, i) => i === 0 || Number(x[0]) > Number(a[i - 1][0]));
    const cumOk = b.every((x, i) => Number(x[2]) === b.slice(0, i + 1).reduce((s, y) => s + Number(y[1]), 0));
    log('depth', { limit, status: r.status, ms: r.ms, bytes: r.bytes, keys: j && Object.keys(j), bids: b.length, asks: a.length, bidsDescending: desc, asksAscending: asc, col3IsCumulativeSize: cumOk, top: [b[0], a[0]], time: j?.time });
    await sleep(300);
  }
  const [r1, r2] = await Promise.all([get('/depth?contractName=E-BTC-USDT&limit=30'), get('/depth?contractName=E-BTC-USDT&limit=30')]);
  log('depth_back_to_back', { identical: r1.text === r2.text, ms: [r1.ms, r2.ms] });
  for (const c of ['E-ETH-USDT', 'E-FARTCOIN-USDT', 'E-XAU-USDT', 'E-AAPL-USDT', 'E-BTC-USDC', 'E-AR-USDT']) {
    const r = await get(`/depth?contractName=${c}&limit=100`);
    const j = r.json;
    log('depth_other', { c, status: r.status, ms: r.ms, bids: j?.bids?.length, asks: j?.asks?.length, top: [j?.bids?.[0], j?.asks?.[0]], body: j?.bids ? undefined : r.text.slice(0, 150) });
    await sleep(300);
  }
  const t = await get('/ticker?contractName=E-BTC-USDT');
  log('ticker', { status: t.status, ms: t.ms, body: t.json });
}

async function errors() {
  const cases = [
    '/index?contractName=E-NOPE-USDT',
    '/index',
    '/index?contractName=BTCUSDT',
    '/depth?contractName=E-NOPE-USDT',
    '/depth?contractName=E-BTC-USDT&limit=0',
    '/depth?contractName=E-BTC-USDT&limit=abc',
    '/ticker?contractName=E-NOPE-USDT',
    '/ticker_all',
    '/fundingRate?contractName=E-BTC-USDT',
    '/premiumIndex',
    '/nope',
  ];
  for (const p of cases) {
    const r = await get(p);
    log('error_case', { path: p, status: r.status, ms: r.ms, body: r.text.slice(0, 220) });
    await sleep(400);
  }
  const r = await get('/index?contractName=E-BTC-USDT');
  const h = {};
  r.headers.forEach((v, k) => (h[k] = k === 'set-cookie' ? v.replace(/=[^;]+/g, '=…') : v));
  log('headers', { headers: h });
  const old = await get('https://api.aivora.com/futures/open/fapi/v1/time');
  log('old_host', { url: 'https://api.aivora.com/futures/open/fapi/v1/time', status: old.status, body: old.text.slice(0, 120) });
}

// The fee page renders its table in the browser from this call, type 1 for spot and type 2 for futures.
async function fees() {
  for (const type of ['1', '2']) {
    const r = await get('https://api.aivora.com/spot/api/membership/get_level_fee_config_list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'exchange-client': 'pc' },
      body: JSON.stringify({ type }),
    });
    const d = r.json?.data;
    log('fee_condition', { type, status: r.status, code: r.json?.code, condition: d?.condition });
    for (const l of d?.list ?? []) log('fee_level', { type, level: l.levelName, firstKey: l.firstKey, firstValue: l.firstValue, secondKey: l.secondKey, secondValue: l.secondValue, compareRule: l.compareRule, maker: l.maker, taker: l.taker, takerPpm: Math.round(l.taker * 1e6) });
  }
}

const modes = { latency, catalog, anchor, sweep, book, errors, fees };
const mode = process.argv[2] ?? 'latency';
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
