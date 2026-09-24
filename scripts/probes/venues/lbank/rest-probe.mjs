// LBank perpetual (SwapU) REST probe: host and latency, the catalog against CCXT, the bulk anchor call and how often its numbers change, the REST book, error shapes, the server clock, and the fee table the public fee page loads.
// Public, unauthenticated and read-only.
// No rate limit is published for these calls, so every mode sends at most a few requests a second.
// Run from server/: node ../scripts/probes/venues/lbank/rest-probe.mjs [catalog|anchor|book|misc]
//   catalog  instrument and marketData for SwapU, other product group names, and CCXT 4.5.68 loadMarkets, about 10 s
//   anchor   marketData polled once a second for 60 s, about 65 s
//   book     marketOrder at several depths, level order, repeat reads, about 10 s
//   misc     cold and warm request time, headers, error bodies, server clock offset, fee tiers, about 15 s
// Recorded in docs/profiles/lbank/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'https://lbkperp.lbank.com';
const PUB = `${HOST}/cfd/openApi/v1/pub`;
const GROUP = 'SwapU'; // the product group CCXT sends, server/node_modules/ccxt/js/src/lbank.js line 616
const FEE_API = 'https://ccapi.rerrkvifj.com/lbk-vip-center/vip'; // what https://www.lbank.com/fee and /vip/home load in the browser
const WATCH = ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'CTKUSDT', 'HK50USDT', '1000XECUSDT'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const count = (rows, f) => rows.reduce((o, r) => ((o[f(r)] = (o[f(r)] ?? 0) + 1), o), {});

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe' }, ...init });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), text, json, ms, bytes: text.length };
}

function stats(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s.at(-1) };
}

async function catalog() {
  const host = new URL(HOST).hostname;
  log('dns', { host, addresses: (await lookup(host, { all: true })).map((a) => a.address) });

  const inst = await get(`${PUB}/instrument?productGroup=${GROUP}`);
  const md = await get(`${PUB}/marketData?productGroup=${GROUP}`);
  const rows = inst.json.data;
  const mrows = md.json.data;
  log('instrument', { status: inst.status, ms: inst.ms, bytes: inst.bytes, rows: rows.length, keys: Object.keys(rows[0]) });
  log('instrument_values', {
    clearCurrency: count(rows, (r) => r.clearCurrency),
    priceCurrency: count(rows, (r) => r.priceCurrency),
    volumeMultiple: count(rows, (r) => r.volumeMultiple),
    needSuspend: count(rows, (r) => r.needSuspend),
    symbolEqualsName: rows.filter((r) => r.symbol === r.symbolName).length,
    symbolEqualsBasePlusUsdt: rows.filter((r) => r.symbol === `${r.baseCurrency}USDT`).length,
  });
  log('need_suspend', { symbols: rows.filter((r) => r.needSuspend).map((r) => r.symbol) });
  const aliased = rows.filter((r) => r.symbolAlias !== r.baseCurrency);
  log('alias_differs_from_base', { n: aliased.length, rows: aliased.map((r) => `${r.symbol}=${r.symbolAlias}`) });
  log('digit_prefixed', { symbols: rows.filter((r) => /^\d/.test(r.symbol)).map((r) => r.symbol) });
  const bases = count(rows, (r) => r.baseCurrency);
  log('base_listed_twice', { bases: Object.entries(bases).filter(([, n]) => n > 1) });

  log('marketData', { status: md.status, ms: md.ms, bytes: md.bytes, rows: mrows.length, keys: Object.keys(mrows[0]) });
  log('marketData_values', {
    instrumentStatus: count(mrows, (r) => r.instrumentStatus),
    positionFeeTime: count(mrows, (r) => r.positionFeeTime),
    nextFeeTime: count(mrows, (r) => new Date(Number(r.nextFeeTime)).toISOString()),
    fundingEqualsPositionFeeRate: mrows.filter((r) => r.fundingRate === r.positionFeeRate).length,
    markZero: mrows.filter((r) => Number(r.markedPrice) === 0).map((r) => r.symbol),
    indexZero: mrows.filter((r) => Number(r.underlyingPrice) === 0).map((r) => r.symbol),
    hasPrePositionFeeRate: mrows.filter((r) => 'prePositionFeeRate' in r).length,
  });
  const iset = new Set(rows.map((r) => r.symbol));
  const mset = new Set(mrows.map((r) => r.symbol));
  log('instrument_vs_marketData', {
    onlyInstrument: [...iset].filter((s) => !mset.has(s)),
    onlyMarketData: [...mset].filter((s) => !iset.has(s)),
  });

  for (const g of ['SwapB', 'SwapC', 'Swap', 'SwapUSDC', '']) {
    const r = await get(`${PUB}/instrument?productGroup=${g}`);
    log('other_group', { productGroup: g, status: r.status, rows: r.json?.data?.length, body: r.text.slice(0, 120) });
    await sleep(300);
  }

  const ex = new ccxt.lbank();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  log('ccxt', {
    version: ccxt.version,
    ms: Math.round(performance.now() - t0),
    total: Object.keys(markets).length,
    activeSwaps: swaps.length,
    linear: count(swaps, (m) => m.linear),
    settle: count(swaps, (m) => m.settle),
    contractSize: count(swaps, (m) => m.contractSize),
    taker: count(swaps, (m) => m.taker),
    maker: count(swaps, (m) => m.maker),
    idMatchesSymbol: swaps.filter((m) => iset.has(m.id)).length,
    active: count(swaps, (m) => m.active),
  });
  const btc = swaps.find((m) => m.id === 'BTCUSDT');
  log('ccxt_btc', { symbol: btc.symbol, id: btc.id, base: btc.base, quote: btc.quote, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker, precision: btc.precision });
  const suspended = new Set(rows.filter((r) => r.needSuspend).map((r) => r.symbol));
  log('ccxt_suspended_still_active', { n: swaps.filter((m) => suspended.has(m.id)).length });
  const mismatchBase = swaps.filter((m) => m.base !== m.info.baseCurrency).map((m) => `${m.id}:${m.base}`);
  log('ccxt_base_differs_from_baseCurrency', { n: mismatchBase.length, rows: mismatchBase.slice(0, 20) });
}

async function anchor() {
  const polls = [];
  const series = Object.fromEntries(WATCH.map((s) => [s, []]));
  let firstHeaders;
  for (let i = 0; i < 60; i++) {
    const t = Date.now();
    const r = await get(`${PUB}/marketData?productGroup=${GROUP}`);
    firstHeaders ??= r.headers;
    polls.push({ ms: r.ms, bytes: r.bytes, status: r.status });
    if (r.status === 200) {
      const rows = r.json.data;
      const lastTimes = rows.map((x) => Number(x.lastTime));
      polls.at(-1).newestLastTimeAgeS = Math.round(t / 1000 - Math.max(...lastTimes));
      polls.at(-1).oldestLastTimeAgeS = Math.round(t / 1000 - Math.min(...lastTimes));
      for (const s of WATCH) {
        const x = rows.find((y) => y.symbol === s);
        if (x) series[s].push(x);
      }
      if (i === 0) {
        const prem = rows.filter((x) => Number(x.underlyingPrice) > 0).map((x) => Math.abs(Number(x.markedPrice) / Number(x.underlyingPrice) - 1) * 1e6);
        log('mark_premium_ppm_abs', stats(prem));
        const ranked = rows.filter((x) => Number(x.underlyingPrice) > 0).map((x) => ({ s: x.symbol, ppm: Math.round((Number(x.markedPrice) / Number(x.underlyingPrice) - 1) * 1e6) })).sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm));
        log('mark_premium_largest', { over10000ppm: ranked.filter((x) => Math.abs(x.ppm) > 10_000).length, over5000ppm: ranked.filter((x) => Math.abs(x.ppm) > 5_000).length, top: ranked.slice(0, 6) });
        const keys = Object.keys(rows.find((x) => x.symbol === 'BTCUSDT'));
        const missing = rows.filter((x) => keys.some((k) => !(k in x)));
        log('rows_missing_fields', { n: missing.length, rows: missing.map((x) => ({ s: x.symbol, missing: keys.filter((k) => !(k in x)), index: x.underlyingPrice, mark: x.markedPrice })) });
        log('funding_by_interval', Object.fromEntries(Object.entries(count(rows, (x) => x.positionFeeTime)).map(([k]) => [k, stats(rows.filter((x) => String(x.positionFeeTime) === k).map((x) => Number(x.fundingRate) * 1e6))])));
        const fr = rows.map((x) => Number(x.fundingRate)).filter(Number.isFinite);
        log('funding_extremes', { max: Math.max(...fr), min: Math.min(...fr), atMax: rows.filter((x) => Number(x.fundingRate) === Math.max(...fr)).map((x) => x.symbol).slice(0, 5), atMin: rows.filter((x) => Number(x.fundingRate) === Math.min(...fr)).map((x) => x.symbol).slice(0, 5) });
        log('sample_row', rows.find((x) => x.symbol === 'BTCUSDT'));
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  log('headers', { 'cache-control': firstHeaders['cache-control'], 'cf-cache-status': firstHeaders['cf-cache-status'], age: firstHeaders.age, server: firstHeaders.server, 'content-encoding': firstHeaders['content-encoding'] });
  log('poll_time_ms', stats(polls.map((p) => p.ms)));
  log('poll_bytes', stats(polls.map((p) => p.bytes)));
  log('poll_status', count(polls, (p) => p.status));
  log('newest_lastTime_age_s', stats(polls.map((p) => p.newestLastTimeAgeS)));
  log('oldest_lastTime_age_s', stats(polls.map((p) => p.oldestLastTimeAgeS)));
  for (const s of WATCH) {
    const xs = series[s];
    const changes = (f) => xs.filter((x, i) => i > 0 && f(x) !== f(xs[i - 1])).length;
    const maxMovePpm = (f) => Math.max(0, ...xs.map((x, i) => (i === 0 ? 0 : Math.abs(Number(f(x)) / Number(f(xs[i - 1])) - 1) * 1e6)).filter(Number.isFinite));
    log('changes', {
      symbol: s,
      polls: xs.length,
      index: changes((x) => x.underlyingPrice),
      mark: changes((x) => x.markedPrice),
      fundingRate: changes((x) => x.fundingRate),
      nextFeeTime: changes((x) => x.nextFeeTime),
      lastTime: changes((x) => x.lastTime),
      maxIndexMovePpm: Math.round(maxMovePpm((x) => x.underlyingPrice)),
      maxMarkMovePpm: Math.round(maxMovePpm((x) => x.markedPrice)),
      last: { index: xs.at(-1)?.underlyingPrice, mark: xs.at(-1)?.markedPrice, fundingRate: xs.at(-1)?.fundingRate, interval: xs.at(-1)?.positionFeeTime, nextFeeTime: xs.at(-1)?.nextFeeTime },
    });
  }
}

async function book() {
  for (const depth of [1, 5, 20, 50, 100, 200, 500, 1000]) {
    const r = await get(`${PUB}/marketOrder?symbol=BTCUSDT&depth=${depth}`);
    const d = r.json?.data;
    const bp = (d?.bids ?? []).map((x) => Number(x.price));
    const ap = (d?.asks ?? []).map((x) => Number(x.price));
    log('depth', {
      depth,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      bids: bp.length,
      asks: ap.length,
      bidsDescending: bp.every((v, i) => i === 0 || bp[i - 1] > v),
      asksAscending: ap.every((v, i) => i === 0 || ap[i - 1] < v),
      top: { bid: d?.bids?.[0], ask: d?.asks?.[0] },
      keys: Object.keys(d ?? {}),
    });
    await sleep(400);
  }
  for (const s of ['CTKUSDT', 'HK50USDT']) {
    const r = await get(`${PUB}/marketOrder?symbol=${s}&depth=50`);
    const d = r.json?.data;
    log('depth_other', { symbol: s, bids: d?.bids?.length, asks: d?.asks?.length, top: { bid: d?.bids?.[0], ask: d?.asks?.[0] } });
    await sleep(400);
  }
  const reads = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${PUB}/marketOrder?symbol=BTCUSDT&depth=20`);
    reads.push({ ms: r.ms, body: JSON.stringify(r.json?.data), cf: r.headers['cf-cache-status'], age: r.headers.age });
    await sleep(200);
  }
  log('repeat_reads', { identicalToPrevious: reads.filter((x, i) => i > 0 && x.body === reads[i - 1].body).length, ms: reads.map((x) => x.ms), cf: reads.map((x) => x.cf), age: reads.map((x) => x.age) });
}

async function misc() {
  const cold = await get(`${PUB}/getTime`);
  const warm = [];
  let best;
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(`${PUB}/getTime`);
    const t1 = Date.now();
    warm.push(r.ms);
    const offset = r.json.data - (t0 + t1) / 2;
    if (!best || t1 - t0 < best.rtt) best = { rtt: t1 - t0, offsetMs: Math.round(offset) };
    await sleep(150);
  }
  log('getTime', { cold: cold.ms, warm: stats(warm), body: cold.text, bestOffset: best });
  log('headers', Object.fromEntries(Object.entries(cold.headers).filter(([k]) => /rate|limit|retry|cache|cf-|server|age/i.test(k))));

  const cases = [
    ['marketOrder_unknown_symbol', `${PUB}/marketOrder?symbol=NOPEUSDT&depth=20`],
    ['marketOrder_no_depth', `${PUB}/marketOrder?symbol=BTCUSDT`],
    ['marketOrder_no_symbol', `${PUB}/marketOrder?depth=20`],
    ['marketOrder_depth_0', `${PUB}/marketOrder?symbol=BTCUSDT&depth=0`],
    ['marketOrder_lowercase', `${PUB}/marketOrder?symbol=btcusdt&depth=5`],
    ['instrument_no_group', `${PUB}/instrument`],
    ['marketData_no_group', `${PUB}/marketData`],
    ['unknown_path', `${PUB}/nope`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    const levels = r.json?.data?.bids ? `${r.json.data.bids.length}/${r.json.data.asks.length}` : undefined;
    log('error_case', { name, status: r.status, levels, body: r.text.slice(0, 200) });
    await sleep(300);
  }

  for (const path of ['rateDesc', 'upgradeThresholdRate']) {
    const r = await get(`${FEE_API}/${path}`);
    log('fee_api', { path, status: r.status, body: r.json?.data ?? r.text.slice(0, 200) });
    await sleep(300);
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, book, misc };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
