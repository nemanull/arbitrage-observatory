// Dex-Trade REST probe: host and latency, the spot catalog, the per pair ticker, the REST book and its sequenceId, fees from the site config, error shapes and the clock offset.
// Public, unauthenticated and read-only. The only POST is /api/vip/info, the fee table the website loads for a visitor who is not logged in.
// No rate limit is published, so every mode sends at most 2 requests in any one second, most of the time one.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/dex-trade/rest-probe.mjs [main|poll|all]
//   main  host and latency, catalog, CCXT check, ticker, books, fees, errors and clock, about 40 s
//   poll  30 rounds of the REST book for three pairs one second apart, with sequenceId and touch change counts, about 35 s
//   all   both
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/dex-trade/rest.md and docs/profiles/dex-trade/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.dex-trade.com';
const SITE_API = 'https://api.dex-trade.com/api';
const OUT = process.env.PROBE_OUT_DIR;
const WATCH = ['AVDOUSDT', 'ELGUSDT', 'BIMUSDT', 'P2PSETH'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init) {
  const t = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

function limitHeaders(h) {
  const out = {};
  for (const [k, v] of h) {
    if (/rate|limit|retry|cache|age|expires|etag|server|cf-ray/i.test(k)) out[k] = v;
  }
  return out;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

async function host() {
  for (const h of ['api.dex-trade.com', 'socket.dex-trade.com', 'docs.dex-trade.com']) {
    const addrs = await dns.lookup(h, { all: true });
    log('dns', { host: h, addrs: addrs.map((a) => a.address) });
  }
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${API}/v1/public/symbols`);
    times.push(r.ms);
    if (i === 0) log('symbols_first', { status: r.status, ms: r.ms, bytes: r.bytes, headers: limitHeaders(r.headers) });
    await sleep(600);
  }
  log('symbols_latency', { cold_ms: times[0], warm_ms: times.slice(1), warm_median_ms: median(times.slice(1)) });
}

async function catalog() {
  const r = await get(`${API}/v1/public/symbols`);
  keep('symbols.json', r.text);
  const rows = r.json.data;
  const byQuote = {};
  const decimals = {};
  for (const x of rows) {
    byQuote[x.quote] = (byQuote[x.quote] ?? 0) + 1;
    const k = `${x.rate_decimal}/${x.base_decimal}/${x.quote_decimal}`;
    decimals[k] = (decimals[k] ?? 0) + 1;
  }
  const odd = rows.filter((x) => x.pair !== x.base + x.quote || /[a-z]/.test(x.pair)).map((x) => x.pair);
  const majors = rows.filter((x) => ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'].includes(x.base)).map((x) => x.pair);
  log('catalog', { status: r.status, rows: rows.length, keys: Object.keys(rows[0]), byQuote, decimals_rate_base_quote: decimals, odd_names: odd, major_bases: majors });

  await sleep(600);
  const t = await get(`${SITE_API}/default/ticker`);
  keep('site-ticker.json', t.text);
  const site = t.json.data;
  const statusCount = {};
  for (const x of site) statusCount[x.status] = (statusCount[x.status] ?? 0) + 1;
  const ids = new Set(rows.map((x) => x.id));
  const onlySite = site.filter((x) => !ids.has(x.id)).map((x) => `${x.name} status ${x.status}`);
  const fee = {};
  for (const x of site) {
    const k = `limit ${x.commission_percent} market ${x.commission_percent_market}`;
    fee[k] = (fee[k] ?? 0) + 1;
  }
  log('site_ticker', { status: t.status, ms: t.ms, bytes: t.bytes, rows: site.length, status_values: statusCount, not_in_symbols: onlySite, commission_percent: fee });

  // Context only: which Dex-Trade bases also name a Bybit linear perpetual, one public call.
  const b = await get('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000');
  const perps = b.json.result.list.filter((x) => x.contractType === 'LinearPerpetual' && x.status === 'Trading');
  const perpBases = new Set(perps.map((x) => x.baseCoin));
  const bases = [...new Set(rows.map((x) => x.base))];
  log('bybit_overlap', { bybit_linear_perps_trading: perps.length, dex_trade_bases: bases.length, shared_bases: bases.filter((x) => perpBases.has(x)) });
  return rows;
}

function ccxtCheck() {
  const hits = ccxt.exchanges.filter((x) => /dex|trade/i.test(x));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, has_dextrade: ccxt.exchanges.includes('dextrade') || ccxt.exchanges.includes('dex-trade'), names_matching_dex_or_trade: hits });
}

async function ticker() {
  for (const p of WATCH.slice(0, 2)) {
    const r = await get(`${API}/v1/public/ticker?pair=${p}`);
    const keys = Object.keys(r.json.data);
    const nonAscii = keys.filter((k) => /[^\x00-\x7f]/.test(k)).map((k) => ({ key: k, codes: [...k].map((c) => c.codePointAt(0).toString(16)).filter((c) => parseInt(c, 16) > 127) }));
    log('ticker', { pair: p, status: r.status, ms: r.ms, data: r.json.data, non_ascii_keys: nonAscii });
    await sleep(600);
  }
}

function bookShape(d) {
  const desc = (a) => a.every((x, i) => i === 0 || x.rate < a[i - 1].rate);
  const asc = (a) => a.every((x, i) => i === 0 || x.rate > a[i - 1].rate);
  return {
    buy: d.buy.length,
    sell: d.sell.length,
    buy_descending: desc(d.buy),
    sell_ascending: asc(d.sell),
    best_bid: d.buy[0]?.rate,
    best_ask: d.sell[0]?.rate,
    sequenceId: d.sequenceId,
    level_keys: Object.keys(d.buy[0] ?? d.sell[0] ?? {}),
  };
}

async function books(rows) {
  for (const p of WATCH) {
    const r = await get(`${API}/v1/public/book?pair=${p}`);
    keep(`book-${p}.json`, r.text);
    log('book', { pair: p, status: r.status, ms: r.ms, bytes: r.bytes, headers: limitHeaders(r.headers), ...bookShape(r.json.data), first_bid: r.json.data.buy[0], first_ask: r.json.data.sell[0] });
    await sleep(600);
  }
  // Depth: count levels across every pair, to see whether the reply is capped.
  const depth = {};
  let maxSide = 0;
  let oneSided = [];
  let empty = [];
  let ordered = 0;
  let maxPair = '';
  for (const x of rows) {
    const r = await get(`${API}/v1/public/book?pair=${x.pair}`);
    const d = r.json?.data;
    if (!d) {
      log('book_error', { pair: x.pair, status: r.status, body: r.text.slice(0, 200) });
      continue;
    }
    const shape = bookShape(d);
    if (shape.buy_descending && shape.sell_ascending) ordered++;
    const k = `${d.buy.length}/${d.sell.length}`;
    depth[k] = (depth[k] ?? 0) + 1;
    if (Math.max(d.buy.length, d.sell.length) > maxSide) {
      maxSide = Math.max(d.buy.length, d.sell.length);
      maxPair = x.pair;
    }
    if (d.buy.length === 0 && d.sell.length === 0) empty.push(x.pair);
    else if (d.buy.length === 0 || d.sell.length === 0) oneSided.push(`${x.pair} ${d.buy.length}/${d.sell.length}`);
    await sleep(550);
  }
  log('book_depth_all_pairs', { pairs: rows.length, buy_sell_counts: depth, max_levels_one_side: maxSide, max_pair: maxPair, best_first_both_sides: ordered, one_sided: oneSided, empty });

  // Query parameters the documentation does not name, to see whether depth can be raised.
  for (const q of ['limit=100', 'depth=100']) {
    const r = await get(`${API}/v1/public/book?pair=AVDOUSDT&${q}`);
    log('book_param', { q, status: r.status, buy: r.json?.data?.buy?.length, sell: r.json?.data?.sell?.length });
    await sleep(600);
  }
}

async function fees() {
  const c = await get(`${SITE_API}/default/config`);
  const tc = c.json.data.trade_commission;
  const tally = {};
  for (const v of Object.values(tc)) {
    const k = JSON.stringify({ percent: v.percent, limit_percent: v.limit_percent, market_percent: v.market_percent, quick_market_percent: v.quick_market_percent, hidden: v.commission_percent_limit_hidden, fixed: v.fixed, special: v.special });
    tally[k] = (tally[k] ?? 0) + 1;
  }
  log('config_trade_commission', { status: c.status, bytes: c.bytes, pairs: Object.keys(tc).length, tally, default_currency: c.json.data.default_currency, margin_pair_list: c.json.data.margin_pair_list, margin_trade_commission: c.json.data.margin_trade_commission });
  const currencies = Object.entries(c.json.data.commission);
  log('config_currencies', { currencies: currencies.length, delisting_set: currencies.filter(([, v]) => v.delisting).map(([k]) => k) });
  await sleep(600);
  const v = await get(`${SITE_API}/vip/info`, { method: 'POST' });
  keep('vip-info.json', v.text);
  log('vip_info', { status: v.status, levels: v.json.data.map((x) => ({ level: x.level_name, btc_30d_volume: x.trade_volume, condition: x.condition_symbol, dxu_balance: x.coin_balance, limit: x.limit_commission, market: x.market_commission, dxu_fee_discount_pct: x.percent_commission_project_coin, total_discount_pct: x.total_discount_percent })) });
  await sleep(600);
  for (const p of ['ticker-margin', 'margin-settings']) {
    const r = await get(`${SITE_API}/default/${p}`);
    log('margin', { path: `/api/default/${p}`, status: r.status, body: r.text.slice(0, 200) });
    await sleep(600);
  }
}

async function errors() {
  const cases = [
    ['ticker unknown pair', `${API}/v1/public/ticker?pair=NOPEUSDT`],
    ['ticker BTCUSDT', `${API}/v1/public/ticker?pair=BTCUSDT`],
    ['ticker no pair', `${API}/v1/public/ticker`],
    ['book unknown pair', `${API}/v1/public/book?pair=NOPEUSDT`],
    ['book lowercase', `${API}/v1/public/book?pair=elgusdt`],
    ['book slash', `${API}/v1/public/book?pair=ELG/USDT`],
    ['trades unknown pair', `${API}/v1/public/trades?pair=NOPEUSDT`],
    ['unknown path', `${API}/v1/public/nope`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_shape', { case: name, status: r.status, ms: r.ms, content_type: r.headers.get('content-type'), body: r.text.slice(0, 160) });
    await sleep(600);
  }
}

async function clock() {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${SITE_API}/info/time`);
    const t1 = Date.now();
    offsets.push({ rtt_ms: t1 - t0, offset_ms: r.json.data - Math.round((t0 + t1) / 2) });
    if (i === 0) log('time_reply', { status: r.status, body: r.text });
    await sleep(600);
  }
  log('clock', { call: '/api/info/time', samples: offsets, median_offset_ms: median(offsets.map((o) => o.offset_ms)) });
  const r = await get(`${API}/v1/public/time`);
  log('documented_time_call', { path: '/v1/public/time', status: r.status, body: r.text.slice(0, 120) });
}

async function poll() {
  const pairs = WATCH.slice(0, 3);
  const prev = {};
  const stats = Object.fromEntries(pairs.map((p) => [p, { seq_changes: 0, touch_changes: 0, ms: [], max_seq_step: 0 }]));
  const t0 = Date.now();
  for (let round = 0; round < 30; round++) {
    const due = t0 + round * 1000;
    await sleep(Math.max(0, due - Date.now()));
    await Promise.all(
      pairs.map(async (p, i) => {
        await sleep(i * 300);
        const r = await get(`${API}/v1/public/book?pair=${p}`);
        const d = r.json.data;
        const s = stats[p];
        s.ms.push(r.ms);
        const touch = `${d.buy[0]?.rate}/${d.buy[0]?.volume}/${d.sell[0]?.rate}/${d.sell[0]?.volume}`;
        if (prev[p]) {
          if (d.sequenceId !== prev[p].seq) s.seq_changes++;
          if (touch !== prev[p].touch) s.touch_changes++;
          s.max_seq_step = Math.max(s.max_seq_step, d.sequenceId - prev[p].seq);
        }
        prev[p] = { seq: d.sequenceId, touch };
      }),
    );
  }
  for (const p of pairs) {
    const s = stats[p];
    log('poll', { pair: p, rounds: 30, seq_changes: s.seq_changes, touch_changes: s.touch_changes, max_seq_step: s.max_seq_step, median_ms: median(s.ms), max_ms: Math.max(...s.ms) });
  }
}

const mode = process.argv[2] ?? 'main';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'main' || mode === 'all') {
  await host();
  const rows = await catalog();
  ccxtCheck();
  await ticker();
  await books(rows);
  await fees();
  await errors();
  await clock();
}
if (mode === 'poll' || mode === 'all') await poll();
log('end', { at: new Date().toISOString() });
