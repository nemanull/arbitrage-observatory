// Bitkub public REST probe: latency and clock, spot catalog, bulk ticker, depth snapshots, error shapes, and the USDT broker books against Bybit spot.
// Public, unauthenticated, read-only. Every call stays far inside the published per endpoint limits (depth 10 per second, the rest 100 per second).
// Run from server/: node ../scripts/probes/venues/bitkub/rest-probe.mjs [latency|catalog|book|mirror|poll|all]
//   latency  DNS, 20 cold and 20 warm servertime calls, clock offset, /api/status. About 30 s.
//   catalog  /api/v3/market/symbols and the bulk /api/v3/market/ticker, counted and cross checked, plus the CCXT 4.5.68 exchange list.
//   book     depth limits, level order, repeat reads for caching, bids and asks endpoints, error replies, response headers. About 15 s.
//   mirror   the ten USDT broker books and the five busiest THB broker books next to Bybit spot at the same instant. About 15 s.
//   poll     the bulk ticker once a second for 30 polls, reply time and how many rows changed.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitkub/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.bitkub.com';
const BYBIT = 'https://api.bybit.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });

// Raw GET so the cold path really opens a new TLS connection and the headers stay visible.
function get(url, { agent = warmAgent } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.get(url, { agent, headers: { 'User-Agent': 'arbitrage-observatory-probe' } }, (res) => {
      const chunks = [];
      let ttfb = null;
      res.on('data', (c) => {
        if (ttfb === null) ttfb = performance.now() - t0;
        chunks.push(c);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, ms: performance.now() - t0, ttfb, t0, t1: performance.now() });
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });
}

const json = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return undefined;
  }
};

async function latency() {
  const host = new URL(API).hostname;
  const addrs = await lookup(host, { all: true });
  log('dns', { host, addrs: addrs.map((a) => a.address) });

  const cold = [];
  for (let i = 0; i < 20; i++) {
    const r = await get(`${API}/api/v3/servertime`, { agent: new https.Agent({ keepAlive: false }) });
    cold.push(r.ms);
    await sleep(150);
  }
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 20; i++) {
    const before = Date.now();
    const r = await get(`${API}/api/v3/servertime`);
    const after = Date.now();
    warm.push(r.ms);
    offsets.push(Number(r.body) - (before + after) / 2);
    await sleep(150);
  }
  log('servertime_cold_ms', { n: 20, min: round(Math.min(...cold)), median: round(quantile(cold, 0.5)), max: round(Math.max(...cold)) });
  log('servertime_warm_ms', { n: 20, min: round(Math.min(...warm)), median: round(quantile(warm, 0.5)), p90: round(quantile(warm, 0.9)), max: round(Math.max(...warm)) });
  log('clock_offset_ms', { note: 'server minus local midpoint', min: round(Math.min(...offsets)), median: round(quantile(offsets, 0.5)), max: round(Math.max(...offsets)) });

  const st = await get(`${API}/api/status`);
  log('status', { http: st.status, body: st.body.slice(0, 200) });
  const v1 = await get(`${API}/api/servertime`);
  log('v1_servertime', { http: v1.status, body: v1.body.slice(0, 40) });
  const hdr = await get(`${API}/api/v3/servertime`);
  log('headers', { server: hdr.headers.server, eo: hdr.headers['eo-cache-status'], keys: Object.keys(hdr.headers).join(',') });
}

async function catalog() {
  const s = await get(`${API}/api/v3/market/symbols`);
  keep('symbols.json', s.body);
  const rows = json(s).result;
  const count = (f) => rows.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  log('symbols', { http: s.status, ms: round(s.ms), bytes: s.body.length, rows: rows.length, error: json(s).error });
  log('symbols_by', {
    segment: count((x) => x.market_segment),
    quote_source_status: count((x) => `${x.quote_asset}/${x.source}/${x.status}`),
    freeze_buy_when_active: count((x) => `${x.status}/${x.freeze_buy}`),
  });
  const ids = rows.map((x) => x.pairing_id);
  log('symbols_ids', { unique_ids: new Set(ids).size, unique_symbols: new Set(rows.map((x) => x.symbol)).size, min: Math.min(...ids), max: Math.max(...ids) });
  const btc = rows.find((x) => x.symbol === 'BTC_THB');
  const busd = rows.find((x) => x.symbol === 'BTC_USDT');
  log('symbol_rows', { BTC_THB: btc, BTC_USDT: busd });

  const t = await get(`${API}/api/v3/market/ticker`);
  keep('ticker.json', t.body);
  const tick = json(t);
  const tickSyms = new Set(tick.map((x) => x.symbol));
  const active = rows.filter((x) => x.status === 'active');
  const missing = active.filter((x) => !tickSyms.has(x.symbol)).map((x) => x.symbol);
  const extra = [...tickSyms].filter((sym) => !rows.some((x) => x.symbol === sym));
  const stoppedInTicker = rows.filter((x) => x.status === 'stopped' && tickSyms.has(x.symbol)).length;
  log('ticker_bulk', { http: t.status, ms: round(t.ms), bytes: t.body.length, rows: tick.length, active_missing: missing.length, missing_sample: missing.slice(0, 5), extra, stopped_rows_in_ticker: stoppedInTicker });
  log('ticker_fields', { exchange_row: Object.keys(tick.find((x) => x.symbol === 'BTC_THB')).join(','), broker_row: Object.keys(tick.find((x) => x.symbol === 'BTC_USDT') ?? {}).join(',') });
  const oneSided = tick.filter((x) => tickSyms.has(x.symbol) && active.some((a) => a.symbol === x.symbol) && (Number(x.highest_bid) === 0 || Number(x.lowest_ask) === 0));
  const crossed = tick.filter((x) => Number(x.highest_bid) > 0 && Number(x.lowest_ask) > 0 && Number(x.highest_bid) >= Number(x.lowest_ask));
  log('ticker_books', { active_one_sided_or_empty: oneSided.length, sample: oneSided.slice(0, 3).map((x) => `${x.symbol}:${x.highest_bid}/${x.lowest_ask}`), crossed_or_locked: crossed.length, crossed_sample: crossed.slice(0, 3).map((x) => `${x.symbol}:${x.highest_bid}/${x.lowest_ask}`) });
  const vol = tick.filter((x) => active.some((a) => a.symbol === x.symbol && a.source === 'exchange')).map((x) => Number(x.quote_volume)).sort((a, b) => b - a);
  log('exchange_quote_volume_thb', { rows: vol.length, top: round(vol[0], 0), median: round(quantile(vol, 0.5), 0), zero: vol.filter((v) => v === 0).length, sum: round(vol.reduce((a, b) => a + b, 0), 0) });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, bitkub: ccxt.exchanges.filter((x) => /kub/i.test(x)) });
}

function orderCheck(side, levels) {
  let bad = 0;
  for (let i = 1; i < levels.length; i++) {
    const [p0] = levels[i - 1];
    const [p1] = levels[i];
    if (side === 'bids' ? p1 >= p0 : p1 <= p0) bad++;
  }
  return bad;
}

async function book() {
  for (const lmt of [1, 20, 100, 1000, 5000]) {
    const r = await get(`${API}/api/v3/market/depth?sym=btc_thb&lmt=${lmt}`);
    const res = json(r)?.result;
    log('depth_limit', { sym: 'btc_thb', lmt, http: r.status, ms: round(r.ms), bytes: r.body.length, bids: res?.bids?.length, asks: res?.asks?.length, bids_not_desc: res ? orderCheck('bids', res.bids) : null, asks_not_asc: res ? orderCheck('asks', res.asks) : null });
    if (lmt === 1000) keep('depth-btc_thb-1000.json', r.body);
    await sleep(250);
  }
  const noLmt = await get(`${API}/api/v3/market/depth?sym=btc_thb`);
  log('depth_no_lmt', { http: noLmt.status, body: noLmt.body.slice(0, 120) });
  await sleep(250);
  const zero = await get(`${API}/api/v3/market/depth?sym=btc_thb&lmt=0`);
  log('depth_lmt_0', { http: zero.status, body: zero.body.slice(0, 120) });

  // Repeat reads at 4 per second, well inside 10 per second, to see whether replies repeat or come from a cache.
  const reads = [];
  for (let i = 0; i < 20; i++) {
    const r = await get(`${API}/api/v3/market/depth?sym=btc_thb&lmt=20`);
    reads.push({ body: r.body, ms: r.ms, eo: r.headers['eo-cache-status'], cc: r.headers['cache-control'], age: r.headers.age });
    await sleep(Math.max(0, 250 - r.ms));
  }
  let same = 0;
  for (let i = 1; i < reads.length; i++) if (reads[i].body === reads[i - 1].body) same++;
  const eo = reads.reduce((m, x) => ((m[x.eo] = (m[x.eo] ?? 0) + 1), m), {});
  let run = 1;
  let longest = 1;
  for (let i = 1; i < reads.length; i++) {
    run = reads[i].body === reads[i - 1].body ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const byEo = (k) => reads.filter((x) => x.eo === k).map((x) => x.ms);
  log('depth_repeat_by_cache', { longest_identical_run_reads: longest, read_spacing_ms: 250, hit_ms_median: round(quantile(byEo('HIT'), 0.5)), hit_ms_max: round(Math.max(...byEo('HIT'))), miss_ms_median: round(quantile(byEo('MISS'), 0.5)), miss_ms_min: round(Math.min(...byEo('MISS'))) });
  log('depth_repeat', { reads: 20, identical_to_previous: same, distinct: new Set(reads.map((x) => x.body)).size, eo_cache_status: eo, cache_control: reads[0].cc ?? null, age: reads[0].age ?? null, ms_median: round(quantile(reads.map((x) => x.ms), 0.5)), ms_max: round(Math.max(...reads.map((x) => x.ms))) });

  const d1000 = json(await get(`${API}/api/v3/market/depth?sym=btc_thb&lmt=1000`)).result;
  const dupB = d1000.bids.length - new Set(d1000.bids.map((l) => l[0])).size;
  const dupA = d1000.asks.length - new Set(d1000.asks.map((l) => l[0])).size;
  log('depth_levels_aggregated', { bids: d1000.bids.length, asks: d1000.asks.length, duplicate_bid_prices: dupB, duplicate_ask_prices: dupA, sample: { b0: d1000.bids[0], a0: d1000.asks[0] } });

  const bids = await get(`${API}/api/v3/market/bids?sym=btc_thb&lmt=1000`);
  const bj = json(bids);
  const bidPrices = bj.result.map((x) => x.price);
  log('bids_endpoint', { http: bids.status, rows: bj.result.length, distinct_prices: new Set(bidPrices).size, first: bj.result[0], note: 'rows are single orders when prices repeat' });
  await sleep(200);

  const cases = [
    ['unknown', `${API}/api/v3/market/depth?sym=nope_thb&lmt=3`],
    ['old_quote_first_form', `${API}/api/v3/market/depth?sym=thb_btc&lmt=3`],
    ['upper_case', `${API}/api/v3/market/depth?sym=BTC_THB&lmt=1`],
    ['broker_depth', `${API}/api/v3/market/depth?sym=btc_usdt&lmt=3`],
    ['broker_bids', `${API}/api/v3/market/bids?sym=btc_usdt&lmt=3`],
    ['broker_asks', `${API}/api/v3/market/asks?sym=btc_usdt&lmt=3`],
    ['broker_trades', `${API}/api/v3/market/trades?sym=btc_usdt&lmt=3`],
    ['stopped_depth', `${API}/api/v3/market/depth?sym=ltc_thb&lmt=3`],
    ['stopped_ticker', `${API}/api/v3/market/ticker?sym=ltc_thb`],
    ['unknown_ticker', `${API}/api/v3/market/ticker?sym=nope_thb`],
    ['removed_v1_depth', `${API}/api/market/depth?sym=THB_BTC&lmt=3`],
    ['unknown_path', `${API}/api/v3/market/nope`],
  ];
  for (const [name, url] of cases) {
    try {
      const r = await get(url);
      log('reply', { name, http: r.status, ms: round(r.ms), body: r.body.slice(0, 160) });
    } catch (e) {
      log('reply', { name, error: e.message });
    }
    await sleep(200);
  }
  const h = await get(`${API}/api/v3/market/depth?sym=btc_thb&lmt=1`);
  log('depth_headers', { headers: h.headers });
}

// The USDT pairs have source "broker". Their books are read next to Bybit spot at the same instant.
async function mirror() {
  const all = json(await get(`${API}/api/v3/market/symbols`)).result;
  const rows = all.filter((x) => x.quote_asset === 'USDT');
  const tick = json(await get(`${API}/api/v3/market/ticker`));

  // THB broker pairs: the implied THB per USDT of the touch, next to Bitkub's own USDT_THB touch.
  const usdt = tick.find((x) => x.symbol === 'USDT_THB');
  const thbBroker = all
    .filter((x) => x.source === 'broker' && x.status === 'active' && x.quote_asset === 'THB')
    .map((x) => tick.find((t) => t.symbol === x.symbol))
    .filter(Boolean)
    .sort((a, b) => Number(b.quote_volume) - Number(a.quote_volume))
    .slice(0, 5);
  for (const t of thbBroker) {
    const base = t.symbol.split('_')[0];
    const [bk, byt] = await Promise.all([
      get(`${API}/api/v3/market/depth?sym=${t.symbol.toLowerCase()}&lmt=1`),
      get(`${BYBIT}/v5/market/tickers?category=spot&symbol=${base}USDT`),
    ]);
    const k = json(bk)?.result;
    const yt = json(byt)?.result?.list?.[0];
    log('mirror_thb_broker', {
      sym: t.symbol,
      bitkub_touch: k ? [k.bids[0], k.asks[0]] : bk.body.slice(0, 60),
      bybit_touch: yt ? [yt.bid1Price, yt.ask1Price] : byt.body.slice(0, 80),
      implied_thb_per_usdt_bid: k && yt ? round(k.bids[0][0] / Number(yt.bid1Price), 4) : null,
      implied_thb_per_usdt_ask: k && yt ? round(k.asks[0][0] / Number(yt.ask1Price), 4) : null,
      bitkub_usdt_thb_touch: [usdt.highest_bid, usdt.lowest_ask],
      bitkub_base_volume: t.base_volume,
      bitkub_base_volume_self: t.base_volume_self,
      bybit_volume24h: yt?.volume24h ?? null,
    });
    await sleep(300);
  }

  for (const row of rows) {
    const sym = row.symbol;
    const bb = sym.replace('_', '');
    const [bk, by, byt] = await Promise.all([
      get(`${API}/api/v3/market/depth?sym=${sym.toLowerCase()}&lmt=5`),
      get(`${BYBIT}/v5/market/orderbook?category=spot&symbol=${bb}&limit=5`),
      get(`${BYBIT}/v5/market/tickers?category=spot&symbol=${bb}`),
    ]);
    const k = json(bk)?.result;
    const y = json(by)?.result;
    const yt = json(byt)?.result?.list?.[0];
    const t = tick.find((x) => x.symbol === sym);
    if (!k || !y || !yt) {
      log('mirror', { sym, bitkub: bk.body.slice(0, 80), bybit: by.body.slice(0, 80) });
      continue;
    }
    const bidRatio = k.bids[0][0] / Number(y.b[0][0]);
    const askRatio = k.asks[0][0] / Number(y.a[0][0]);
    const kSizes = [...k.bids.map((l) => l[1]), ...k.asks.map((l) => l[1])];
    const ySizes = new Set([...y.b.map((l) => Number(l[1])), ...y.a.map((l) => Number(l[1]))]);
    const sizeHits = kSizes.filter((s) => ySizes.has(s)).length;
    log('mirror', {
      sym,
      bitkub_touch: [k.bids[0], k.asks[0]],
      bybit_touch: [y.b[0], y.a[0]],
      bid_ppm: round((bidRatio - 1) * 1e6, 0),
      ask_ppm: round((askRatio - 1) * 1e6, 0),
      top5_sizes_equal_to_a_bybit_size: `${sizeHits}/${kSizes.length}`,
      bitkub_base_volume: t?.base_volume,
      bitkub_base_volume_self: t?.base_volume_self,
      bybit_volume24h: yt.volume24h,
      high_ppm: round((Number(t?.high_24_hr) / Number(yt.highPrice24h) - 1) * 1e6, 0),
      low_ppm: round((Number(t?.low_24_hr) / Number(yt.lowPrice24h) - 1) * 1e6, 0),
    });
    await sleep(300);
  }
}

async function poll() {
  const times = [];
  const changed = [];
  let prev;
  for (let i = 0; i < 30; i++) {
    const started = Date.now();
    const r = await get(`${API}/api/v3/market/ticker`);
    times.push(r.ms);
    const rows = json(r);
    const map = new Map(rows.map((x) => [x.symbol, `${x.highest_bid}|${x.lowest_ask}|${x.last}`]));
    if (prev) {
      let n = 0;
      for (const [k, v] of map) if (prev.get(k) !== v) n++;
      changed.push(n);
    }
    prev = map;
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  log('ticker_poll', { polls: 30, ms_min: round(Math.min(...times)), ms_median: round(quantile(times, 0.5)), ms_p90: round(quantile(times, 0.9)), ms_max: round(Math.max(...times)), rows_changed_per_poll_median: quantile(changed, 0.5), rows_changed_max: Math.max(...changed), rows_changed_min: Math.min(...changed) });
}

const mode = process.argv[2] ?? 'all';
const modes = { latency, catalog, book, mirror, poll };
log('start', { mode, at: new Date().toISOString() });
if (mode === 'all') {
  for (const m of Object.values(modes)) await m();
} else if (modes[mode]) {
  await modes[mode]();
} else {
  console.error(`unknown mode ${mode}`);
  process.exitCode = 1;
}
warmAgent.destroy();
log('end', { at: new Date().toISOString() });
