// Bitfinex REST probe for the perpetual (F0) contracts: host and latency, the catalog against CCXT, the bulk anchor call, funding history across a settlement, the REST book, and error shapes.
// Public, unauthenticated, read-only. Every mode stays inside the published per endpoint limits, and the anchor modes use 60 of the 90 requests per minute the status call allows.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitfinex/rest-probe.mjs [host|catalog|anchor|anchor-nonce|index|history|book|errors]
//   host     DNS, cold and warm request time, the Date header against the local clock.
//   catalog  conf lists, status keys and CCXT 4.5.68 loadMarkets for bitfinex: ids, families, taker, contractSize.
//   anchor   status/deriv?keys=ALL once a second for 60 s: reply size and time, edge cache, fields, how often each number changes.
//   anchor-nonce  the same with a changing query parameter, to see whether the edge cache or the origin sets the cadence.
//   index    one status/deriv?keys=ALL beside one tickers?symbols=ALL: is SPOT_PRICE or MARK_PRICE the Bitfinex spot mid of the base against USDt or USD.
//   history  status/deriv/<key>/hist around the last settlement instant, to see what the rate fields do across it.
//   book     REST book at P0 and R0: depth, level order, caching.
//   errors   unknown symbol, unknown key and unknown path replies.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitfinex/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api-pub.bitfinex.com/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const iso = (ms) => new Date(ms).toISOString();

// Field positions of one status/deriv row, from the REST reference.
const F = { key: 0, mts: 1, deriv: 3, spot: 4, insurance: 6, nextEvt: 8, accrued: 9, step: 10, current: 12, mark: 15, oi: 18, clampMin: 22, clampMax: 23 };

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  return { status: res.status, ms, bytes: text.length, text, headers: res.headers };
}

function pickHeaders(h) {
  const out = {};
  for (const k of ['date', 'server', 'cache-control', 'age', 'cf-cache-status', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'content-encoding']) {
    if (h.get(k) !== null) out[k] = h.get(k);
  }
  return out;
}

async function host() {
  const [v4, v6] = await Promise.all([dns.resolve4('api-pub.bitfinex.com').catch((e) => e.code), dns.resolve6('api-pub.bitfinex.com').catch((e) => e.code)]);
  log('dns', { v4, v6 });
  for (const path of ['/platform/status', '/status/deriv?keys=ALL', '/tickers?symbols=ALL']) {
    const times = [];
    let last;
    for (let i = 0; i < 5; i++) {
      last = await get(path);
      times.push(last.ms);
      await sleep(1_500);
    }
    log('latency', { path, status: last.status, bytes: last.bytes, firstMs: times[0], restMs: times.slice(1), headers: pickHeaders(last.headers) });
  }
  // The Date header has one second resolution, so the offset is bounded by the request time.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/platform/status');
    const t1 = Date.now();
    const server = Date.parse(r.headers.get('date'));
    offsets.push({ serverMinusMidMs: server - Math.round((t0 + t1) / 2), rttMs: t1 - t0 });
    await sleep(1_200);
  }
  log('clock', { offsets });
}

async function catalog() {
  const lists = await get('/conf/pub:list:pair:futures,pub:info:pair:futures,pub:list:pair:securities');
  save('conf.json', lists.text);
  const [futList, futInfo, securities] = JSON.parse(lists.text);
  log('conf', { status: lists.status, ms: lists.ms, bytes: lists.bytes, futures: futList.length, infoRows: futInfo.length, first: futList.slice(0, 3), infoSample: futInfo.find((r) => r[0] === 'BTCF0:USTF0') });
  const bySettle = {};
  for (const id of futList) {
    const q = id.split(':')[1];
    bySettle[q] = (bySettle[q] || 0) + 1;
  }
  log('conf_settle', { bySettle, nonUsdt: futList.filter((id) => !id.endsWith(':USTF0')), indexLike: futList.filter((id) => /IX|VIV|EUR|GBP|JPY|XAU/.test(id.split(':')[0])) });

  const st = await get('/status/deriv?keys=ALL');
  const rows = JSON.parse(st.text);
  const keys = new Set(rows.map((r) => r[F.key]));
  const conf = new Set(futList.map((id) => 't' + id));
  log('status_keys', { rows: rows.length, inConfNotStatus: [...conf].filter((k) => !keys.has(k)), inStatusNotConf: [...keys].filter((k) => !conf.has(k)) });

  const ccxt = require('ccxt');
  const ex = new ccxt.bitfinex();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const loadMs = Math.round(performance.now() - t0);
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.swap);
  const active = swaps.filter((m) => m.active);
  const bySettleCcxt = {};
  const takers = {};
  const sizes = {};
  for (const m of swaps) {
    bySettleCcxt[m.settle] = (bySettleCcxt[m.settle] || 0) + 1;
    takers[m.taker] = (takers[m.taker] || 0) + 1;
    sizes[m.contractSize] = (sizes[m.contractSize] || 0) + 1;
  }
  log('ccxt', { version: ccxt.version, loadMs, markets: all.length, swaps: swaps.length, activeSwaps: active.length, bySettle: bySettleCcxt, takers, makers: [...new Set(swaps.map((m) => m.maker))], contractSizes: sizes, linear: [...new Set(swaps.map((m) => m.linear))], inverse: [...new Set(swaps.map((m) => m.inverse))] });
  const btc = markets['BTC/USDT:USDT'];
  log('ccxt_btc', btc ? { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, settle: btc.settle, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker, precision: btc.precision, limits: btc.limits.amount, tradfi: btc.tradfi } : { missing: true });
  const ids = new Set(swaps.map((m) => m.id));
  log('ccxt_vs_status', { swapIdsNotInStatus: [...ids].filter((id) => !keys.has(id)), statusNotInCcxt: [...keys].filter((k) => !ids.has(k)) });
  // A pair listed twice is two swaps with the same base and a quote of the USD family.
  const fam = (q) => (['USD', 'USDT', 'USDC', 'UST'].includes(q) ? 'USD' : q);
  const byPair = {};
  for (const m of swaps) (byPair[m.base + '/' + fam(m.quote)] ||= []).push(m.symbol);
  log('ccxt_twice', { pairs: Object.entries(byPair).filter(([, v]) => v.length > 1) });
  log('ccxt_symbols', { odd: swaps.filter((m) => /IX|VIV|EUR|GBP|JPY|XAU|TESTUSDT|BTCDOM/.test(m.base)).map((m) => `${m.id} ${m.symbol} tradfi=${m.tradfi}`), sample: swaps.slice(0, 5).map((m) => `${m.id} ${m.symbol}`) });
  // CCXT's precision is fixed, so compare with the conf info row for a few contracts.
  const info = Object.fromEntries(futInfo.map((r) => [r[0], r[1]]));
  log('conf_info_fields', { BTC: info['BTCF0:USTF0'], DOGE: info['DOGEF0:USTF0'], ETHBTC: info['ETHF0:BTCF0'] });
}

async function anchor(nonce = false) {
  const polls = 60;
  const cache = {};
  const ages = {};
  const mtsSeen = [];
  const times = [];
  const bytes = [];
  const last = new Map();
  const changes = new Map();
  const mtsLag = [];
  let first;
  for (let i = 0; i < polls; i++) {
    const tStart = Date.now();
    const r = await get('/status/deriv?keys=ALL' + (nonce ? `&_=${Date.now()}` : ''));
    const tEnd = Date.now();
    times.push(r.ms);
    const cs = r.headers.get('cf-cache-status') ?? 'none';
    cache[cs] = (cache[cs] || 0) + 1;
    const age = r.headers.get('age') ?? 'none';
    ages[age] = (ages[age] || 0) + 1;
    bytes.push(r.bytes);
    if (r.status !== 200) {
      log('anchor_error', { i, status: r.status, body: r.text.slice(0, 200) });
      await sleep(1_000);
      continue;
    }
    const rows = JSON.parse(r.text);
    const btcRow = rows.find((x) => x[F.key] === 'tBTCF0:USTF0');
    if (btcRow && mtsSeen.at(-1) !== btcRow[F.mts]) mtsSeen.push(btcRow[F.mts]);
    if (!first) {
      first = rows;
      save('status-deriv-all.json', r.text);
    }
    for (const row of rows) {
      const k = row[F.key];
      mtsLag.push(tEnd - row[F.mts]);
      const prev = last.get(k);
      const c = changes.get(k) || { deriv: 0, spot: 0, mark: 0, accrued: 0, step: 0, current: 0, nextEvt: 0, mts: 0 };
      if (prev) {
        for (const f of ['deriv', 'spot', 'mark', 'accrued', 'step', 'current', 'nextEvt', 'mts']) if (prev[F[f]] !== row[F[f]]) c[f]++;
      }
      changes.set(k, c);
      last.set(k, row);
    }
    const wait = 1_000 - (Date.now() - tStart);
    if (wait > 0) await sleep(wait);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mtsSteps = mtsSeen.slice(1).map((m, i) => m - mtsSeen[i]);
  log('anchor_cache', { nonce, cfCacheStatus: cache, age: ages, distinctBtcMts: mtsSeen.length, btcMtsStepsMs: mtsSteps });
  log('anchor_timing', { polls, bytesMin: Math.min(...bytes), bytesMax: Math.max(...bytes), msMin: sorted[0], msMedian: q(0.5), msP90: q(0.9), msMax: sorted[sorted.length - 1], over1s: times.filter((t) => t > 1_000).length });
  const lagSorted = mtsLag.sort((a, b) => a - b);
  log('anchor_mts_age', { minMs: lagSorted[0], medianMs: lagSorted[Math.floor(lagSorted.length / 2)], maxMs: lagSorted[lagSorted.length - 1] });

  const rows = [...last.values()];
  const count = (pred) => rows.filter(pred).length;
  log('anchor_fields', {
    rows: rows.length,
    markNullOrZero: count((r) => !(r[F.mark] > 0)),
    markEqualsSpot: count((r) => r[F.mark] === r[F.spot]),
    markEqualsSpotKeys: rows.filter((r) => r[F.mark] === r[F.spot]).map((r) => r[F.key]).slice(0, 30),
    spotNullOrZero: count((r) => !(r[F.spot] > 0)),
    derivNullOrZero: count((r) => !(r[F.deriv] > 0)),
    currentNull: count((r) => r[F.current] === null),
    accruedNull: count((r) => r[F.accrued] === null),
    nextEvt: [...new Set(rows.map((r) => iso(r[F.nextEvt])))],
    clamps: Object.entries(rows.reduce((a, r) => ((a[`${r[F.clampMin]}/${r[F.clampMax]}`] = (a[`${r[F.clampMin]}/${r[F.clampMax]}`] || 0) + 1), a), {})),
    clampOdd: rows.filter((r) => r[F.clampMax] !== 0.0025).map((r) => `${r[F.key]} ${r[F.clampMin]} ${r[F.clampMax]}`),
    currentNonZero: count((r) => r[F.current] !== 0 && r[F.current] !== null),
    currentMax: Math.max(...rows.map((r) => Math.abs(r[F.current] ?? 0))),
    rowLength: [...new Set(rows.map((r) => r.length))],
  });
  const ppm = (a, b) => (a > 0 && b > 0 ? Math.round((a / b - 1) * 1e6) : null);
  const markVsSpot = rows.map((r) => ppm(r[F.mark], r[F.spot])).filter((x) => x !== null).map(Math.abs).sort((a, b) => a - b);
  const derivVsMark = rows.map((r) => ppm(r[F.deriv], r[F.mark])).filter((x) => x !== null).map(Math.abs).sort((a, b) => a - b);
  const mid = (a) => a[Math.floor(a.length / 2)];
  log('anchor_premiums_abs_ppm', { markVsSpotMedian: mid(markVsSpot), markVsSpotMax: markVsSpot.at(-1), markVsSpotOver1000: markVsSpot.filter((x) => x > 1000).length, derivVsMarkMedian: mid(derivVsMark), derivVsMarkMax: derivVsMark.at(-1) });
  const bigSpotGap = rows.filter((r) => Math.abs(ppm(r[F.mark], r[F.spot]) ?? 0) > 5000).map((r) => `${r[F.key]} mark=${r[F.mark]} spot=${r[F.spot]} deriv=${r[F.deriv]}`);
  log('anchor_mark_far_from_spot', { over5000ppm: bigSpotGap.slice(0, 12), count: bigSpotGap.length });
  const pick = ['tBTCF0:USTF0', 'tETHF0:USTF0', 'tDOGEF0:USTF0', 'tETHF0:BTCF0', 'tEUROPE50IXF0:USTF0'];
  for (const k of pick) {
    const r = last.get(k);
    if (r) log('anchor_row', { key: k, deriv: r[F.deriv], spot: r[F.spot], mark: r[F.mark], accrued: r[F.accrued], step: r[F.step], current: r[F.current], nextEvt: iso(r[F.nextEvt]), clampMin: r[F.clampMin], clampMax: r[F.clampMax], changesIn59: changes.get(k) });
  }
  const agg = { deriv: [], spot: [], mark: [], accrued: [], current: [], mts: [] };
  for (const c of changes.values()) for (const f of Object.keys(agg)) agg[f].push(c[f]);
  const summary = {};
  for (const [f, arr] of Object.entries(agg)) {
    arr.sort((a, b) => a - b);
    summary[f] = { min: arr[0], median: mid(arr), max: arr.at(-1) };
  }
  log('anchor_changes_per_59_intervals', summary);
}

async function index() {
  const [st, tk] = await Promise.all([get(`/status/deriv?keys=ALL&_=${Date.now()}`), get(`/tickers?symbols=ALL&_=${Date.now()}`)]);
  const rows = JSON.parse(st.text);
  const mids = new Map();
  // Trading tickers are [SYMBOL, BID, BID_SIZE, ASK, ASK_SIZE, ...].
  for (const t of JSON.parse(tk.text)) if (t[0].startsWith('t') && !t[0].includes('F0')) mids.set(t[0], (t[1] + t[3]) / 2);
  const ppm = (a, b) => (a > 0 && b > 0 ? Math.round((a / b - 1) * 1e6) : null);
  const tally = { spotIsUstMid: 0, spotIsUsdMid: 0, markIsUstMid: 0, markIsUsdMid: 0, noSpotPair: 0, markEqualsSpot: 0 };
  const lines = [];
  for (const r of rows) {
    const [base, quote] = r[F.key].slice(1).split(':').map((x) => x.replace(/F0$/, ''));
    if (quote !== 'UST') continue;
    const ust = mids.get(`t${base}UST`) ?? mids.get(`t${base}:UST`);
    const usd = mids.get(`t${base}USD`) ?? mids.get(`t${base}:USD`);
    const near = (a, b) => a !== undefined && Math.abs(ppm(a, b) ?? 1e9) <= 50;
    if (ust === undefined && usd === undefined) tally.noSpotPair++;
    if (near(ust, r[F.spot])) tally.spotIsUstMid++;
    if (near(usd, r[F.spot])) tally.spotIsUsdMid++;
    if (near(ust, r[F.mark])) tally.markIsUstMid++;
    if (near(usd, r[F.mark])) tally.markIsUsdMid++;
    if (r[F.mark] === r[F.spot]) tally.markEqualsSpot++;
    if (['BTC', 'ETH', 'ICP', 'ALG', 'ATO', 'LDO', 'EGLD', 'EUROPE50IX', 'XAG'].includes(base)) lines.push(`${base} mark=${r[F.mark]} spot=${r[F.spot]} ustMid=${ust} usdMid=${usd} markVsUst=${ppm(r[F.mark], ust)}ppm markVsUsd=${ppm(r[F.mark], usd)}ppm`);
  }
  log('index_tally', { usdtPerps: rows.filter((r) => r[F.key].endsWith(':USTF0')).length, ...tally, within: '50 ppm' });
  for (const l of lines) log('index_row', { l });
}

async function history() {
  // The last settlement instant is the most recent of 00:00, 08:00 and 16:00 UTC.
  const now = Date.now();
  const lastSettle = Math.floor(now / (8 * 3_600_000)) * 8 * 3_600_000;
  for (const key of ['tBTCF0:USTF0', 'tDOGEF0:USTF0']) {
    const start = lastSettle - 10 * 60_000;
    const end = lastSettle + 10 * 60_000;
    const r = await get(`/status/deriv/${key}/hist?start=${start}&end=${end}&sort=1&limit=5000`);
    save(`hist-${key.replace(':', '_')}.json`, r.text);
    const rows = JSON.parse(r.text);
    // History rows have no key column, so every field sits one place left of the snapshot row.
    const h = { mts: 0, deriv: 2, spot: 3, nextEvt: 7, accrued: 8, step: 9, current: 11, mark: 14, clampMin: 21, clampMax: 22 };
    const gaps = rows.slice(1).map((row, i) => row[h.mts] - rows[i][h.mts]);
    log('hist', { key, status: r.status, ms: r.ms, rows: rows.length, rowLength: rows[0]?.length, from: rows[0] && iso(rows[0][0]), to: rows.at(-1) && iso(rows.at(-1)[0]), stepMsMin: Math.min(...gaps), stepMsMedian: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)], settle: iso(lastSettle) });
    let prev;
    for (const row of rows) {
      const view = { t: iso(row[h.mts]), accrued: row[h.accrued], step: row[h.step], current: row[h.current], nextEvt: iso(row[h.nextEvt]), mark: row[h.mark] };
      if (!prev || prev.accrued !== view.accrued && Math.abs(row[h.mts] - lastSettle) < 30_000 || prev.current !== view.current || prev.nextEvt !== view.nextEvt) log('hist_row', { key, ...view });
      prev = view;
    }
    await sleep(2_000);
  }
  // Longer window at coarse sampling: the step counter and the current rate over the day.
  const r = await get(`/status/deriv/tBTCF0:USTF0/hist?start=${lastSettle - 24 * 3_600_000}&end=${now}&sort=1&limit=5000`);
  const rows = JSON.parse(r.text);
  const changesCurrent = [];
  for (let i = 1; i < rows.length; i++) if (rows[i][11] !== rows[i - 1][11]) changesCurrent.push(`${iso(rows[i][0])} ${rows[i - 1][11]} to ${rows[i][11]}`);
  log('hist_day', { rows: rows.length, from: rows[0] && iso(rows[0][0]), to: rows.at(-1) && iso(rows.at(-1)[0]), currentChanges: changesCurrent.slice(0, 20) });
  // At each settlement, compare the last accrued average before it with the current rate after it, and with the rate charged at it.
  for (let t = lastSettle - 16 * 3_600_000; t <= lastSettle; t += 8 * 3_600_000) {
    const before = rows.filter((x) => x[0] < t).at(-1);
    const after = rows.find((x) => x[0] >= t);
    if (!before || !after) continue;
    const acc = before[8];
    const clamped = Math.min(0.0025, Math.max(0, acc - 0.0005)) + Math.max(-0.0025, Math.min(0, acc + 0.0005));
    log('hist_settle', { settle: iso(t), accruedBefore: acc, clampFormula: Number(clamped.toFixed(8)), currentAfter: after[11], currentBefore: before[11], stepBefore: before[9], stepAfter: after[9] });
  }
}

function orderOf(levels, desc) {
  let ok = true;
  for (let i = 1; i < levels.length; i++) if (desc ? levels[i][0] > levels[i - 1][0] : levels[i][0] < levels[i - 1][0]) ok = false;
  return ok;
}

async function book() {
  for (const path of ['/book/tBTCF0:USTF0/P0?len=25', '/book/tBTCF0:USTF0/P0?len=100', '/book/tBTCF0:USTF0/P0?len=250', '/book/tDOGEF0:USTF0/P0?len=100', '/book/tBTCF0:USTF0/R0?len=100']) {
    const r = await get(path);
    const rows = JSON.parse(r.text);
    const raw = path.includes('/R0');
    // P rows are [price, count, amount]. R0 rows are [orderId, price, amount].
    const lv = rows.map((x) => (raw ? [x[1], x[2]] : [x[0], x[2]]));
    const bids = lv.filter((x) => x[1] > 0);
    const asks = lv.filter((x) => x[1] < 0);
    log('rest_book', { path, status: r.status, ms: r.ms, rows: rows.length, bids: bids.length, asks: asks.length, bidsDesc: orderOf(bids, true), asksAsc: orderOf(asks, false), bidsFirst: rows.findIndex((x) => (raw ? x[2] : x[2]) < 0) === bids.length, top: [bids[0], asks[0]], sample: rows[0], headers: pickHeaders(r.headers) });
    await sleep(1_000);
  }
  const a = await get('/book/tBTCF0:USTF0/P0?len=25');
  await sleep(300);
  const b = await get('/book/tBTCF0:USTF0/P0?len=25');
  log('rest_book_cache', { identical: a.text === b.text, gapMs: 300 });
}

async function errors() {
  for (const path of ['/book/tNOPEF0:USTF0/P0?len=25', '/book/tBTCF0:USTF0/P9', '/book/tBTCF0:USTF0/P0?len=7', '/status/deriv?keys=tNOPEF0:USTF0', '/status/deriv', '/ticker/tNOPEF0:USTF0', '/nope', '/status/deriv/tNOPEF0:USTF0/hist?limit=5']) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, ms: r.ms, body: r.text.slice(0, 200), headers: pickHeaders(r.headers) });
    await sleep(1_000);
  }
}

const modes = { host, catalog, anchor: () => anchor(false), 'anchor-nonce': () => anchor(true), index, history, book, errors };
const mode = process.argv[2] ?? 'catalog';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: iso(Date.now()) });
await modes[mode]();
log('end', { mode, at: iso(Date.now()) });
