// NonKYC perpetuals REST probe. perp.nonkyc.io is the Orderly builder `nonkyc`, so every perpetual market data call goes to Orderly's public API.
// Measures host latency, the catalog against CCXT woofipro (the Orderly class), the builder's own flow and fee, the anchor calls and how often they change, the public book snapshot, errors and the clock.
// Also reads the NonKYC spot API (api.nonkyc.io) that the spot line of the coverage matrix cites.
// Public, unauthenticated, read-only. Stays far under Orderly's published 10 requests per second per IP and the 1,200 weight per minute of /v1/public/query.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/nonkyc/rest-probe.mjs [catalog|anchor|book|errors]
//   catalog  DNS, cold and warm timing, builder id and flow, builder admin fee rate, /v1/public/info and /futures against CCXT woofipro, index sources, spot API. About 20 s.
//   anchor   /v1/public/futures once a second for 60 s, change counts, clamps, funding history against the published rates. About 70 s.
//   book     the zero-auth /v1/public/query orderbook at several depths, level order, caching. About 10 s.
//   errors   unknown symbols, unknown paths, rate limit headers, server clock. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/nonkyc/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.orderly.org';
const API_EVM = 'https://api-evm.orderly.org'; // the host CCXT woofipro uses
const SPOT = 'https://api.nonkyc.io/api/v2';
const BROKER = 'nonkyc';
const BROKER_EOA = '0x7ef1da01fad1d4bbef316008bd3155ba50258a68'; // VITE_BROKER_EOA_ADDRESS in https://perp.nonkyc.io/config.js
const SHARED = /^PERP_[A-Z0-9]+_USDC$/; // builder-listed markets carry a `_<builder>` suffix
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const stats = (xs) => ({ n: xs.length, min: Math.min(...xs), median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs) });
const count = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const query = (body) => get(`${API}/v1/public/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function catalog() {
  for (const host of ['api.orderly.org', 'api-evm.orderly.org', 'ws-evm.orderly.org', 'perp.nonkyc.io', 'nonkyc.io', 'api.nonkyc.io', 'ws.nonkyc.io']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }

  for (const base of [API, API_EVM]) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const r = await get(`${base}/v1/public/futures`);
      times.push(r.ms);
      if (i === 0) log('futures_first', { base, status: r.status, ms: r.ms, bytes: r.bytes, cfRay: r.headers.get('cf-ray'), server: r.headers.get('server') });
      await sleep(300);
    }
    log('futures_warm', { base, ...stats(times.slice(1)) });
  }

  const cfg = await get('https://perp.nonkyc.io/config.js');
  const brokerLine = (cfg.text.match(/"VITE_ORDERLY_BROKER_ID":\s*"[^"]*"/) ?? [null])[0];
  const envLine = (cfg.text.match(/"VITE_DEPLOYMENT_ENV":\s*"[^"]*"/) ?? [null])[0];
  const restricted = (cfg.text.match(/"VITE_RESTRICTED_REGIONS":\s*"[^"]*"/) ?? [null])[0];
  log('front_end_config', { status: cfg.status, brokerLine, envLine, restricted });

  const name = await get(`${API}/v1/public/broker/name?broker_id=${BROKER}`);
  log('broker_name', { status: name.status, data: name.json?.data });
  const vol = await get(`${API}/v1/public/volume/stats?broker_id=${BROKER}`);
  log('broker_volume', { status: vol.status, data: vol.json?.data });
  const volAll = await get(`${API}/v1/public/volume/stats`);
  log('orderly_volume', { status: volAll.status, data: volAll.json?.data });
  const bstats = await get(`${API}/v1/public/broker/stats?broker_id=${BROKER}`);
  log('broker_stats', { status: bstats.status, data: bstats.json?.data });
  const fee = await query({ type: 'feeRate', address: BROKER_EOA, broker_id: BROKER });
  log('builder_admin_fee_rate', { status: fee.status, data: fee.json?.data, weight: fee.headers.get('x-ratelimit-weight') });

  const ip = await get(`${API}/v1/ip_info`);
  log('ip_info', { status: ip.status, data: ip.json?.data });
  const sys = await get(`${API}/v1/public/system_info`);
  log('system_info', { status: sys.status, data: sys.json?.data });

  const info = await get(`${API}/v1/public/info`);
  keep('info.json', info.text);
  const rows = info.json.data.rows;
  const shared = rows.filter((r) => SHARED.test(r.symbol));
  const suffixes = count(rows.filter((r) => !SHARED.test(r.symbol)).map((r) => r.symbol.split('_').slice(3).join('_') || 'other'));
  log('info', {
    status: info.status,
    ms: info.ms,
    bytes: info.bytes,
    rows: rows.length,
    shared: shared.length,
    builderSuffixes: suffixes,
    ownSuffix: rows.filter((r) => r.symbol.endsWith(`_${BROKER}`)).length,
    statusShared: count(shared.map((r) => r.status)),
    brokerIdShared: count(shared.map((r) => String(r.broker_id))),
    fundingPeriodShared: count(shared.map((r) => r.funding_period)),
    capFundingShared: count(shared.map((r) => r.cap_funding)),
    markCapShared: count(shared.map((r) => r.mark_index_price_deviation_cap)),
    pretge: shared.filter((r) => r.is_pretge).map((r) => r.symbol),
  });
  const btc = rows.find((r) => r.symbol === 'PERP_BTC_USDC');
  log('info_btc', { funding_period: btc.funding_period, cap_funding: btc.cap_funding, floor_funding: btc.floor_funding, interest_rate: btc.interest_rate, mark_cap: btc.mark_index_price_deviation_cap, mark_floor: btc.mark_index_price_deviation_floor, std_liquidation_fee: btc.std_liquidation_fee, liquidator_fee: btc.liquidator_fee, base_tick: btc.base_tick, quote_tick: btc.quote_tick });
  log('liquidation_fees_shared', { std: count(shared.map((r) => r.std_liquidation_fee)), liquidator: count(shared.map((r) => r.liquidator_fee)) });

  const woofi = new ccxt.woofipro();
  const t0 = performance.now();
  await woofi.loadMarkets();
  const ms = Math.round(performance.now() - t0);
  const ms_ = Object.values(woofi.markets);
  const swaps = ms_.filter((m) => m.swap);
  const ids = new Set(rows.map((r) => r.symbol));
  const bySymbol = count(swaps.map((m) => m.symbol));
  const doubled = Object.entries(bySymbol).filter(([, n]) => n > 1).map(([s]) => s);
  log('ccxt_woofipro', {
    version: ccxt.version,
    loadMs: ms,
    markets: ms_.length,
    swaps: swaps.length,
    idsInInfo: swaps.filter((m) => ids.has(m.id)).length,
    active: count(swaps.map((m) => String(m.active))),
    linear: count(swaps.map((m) => String(m.linear))),
    contractSize: count(swaps.map((m) => m.contractSize)),
    settle: count(swaps.map((m) => m.settle)),
    taker: count(swaps.map((m) => m.taker)),
    maker: count(swaps.map((m) => m.maker)),
    unifiedSymbolsListedTwice: doubled.length,
    example: doubled.slice(0, 3).map((s) => swaps.filter((m) => m.symbol === s).map((m) => m.id)),
  });
  const btcM = woofi.markets['BTC/USDC:USDC'];
  log('ccxt_btc', { id: btcM.id, contractSize: btcM.contractSize, taker: btcM.taker, maker: btcM.maker, amountPrecision: btcM.precision.amount, pricePrecision: btcM.precision.price });

  const idx = await get(`${API}/v1/public/index_price_source`);
  const irows = idx.json.data.rows;
  const sharedIds = new Set(shared.map((r) => r.symbol));
  const perpSpot = irows.filter((r) => sharedIds.has(r.symbol.replace(/^SPOT_/, 'PERP_')));
  const withFutures = perpSpot.filter((r) => r.sources.some((s) => /future|perp|swap/i.test(s)));
  const onlyFutures = perpSpot.filter((r) => r.sources.length && r.sources.every((s) => /future|perp|swap/i.test(s)));
  const withOrderly = perpSpot.filter((r) => r.sources.some((s) => /orderly/i.test(s)));
  log('index_sources', {
    status: idx.status,
    bytes: idx.bytes,
    rows: irows.length,
    sharedBaskets: perpSpot.length,
    sourceCounts: count(perpSpot.map((r) => r.sources.length)),
    withFuturesSource: withFutures.length,
    onlyFutures: onlyFutures.map((r) => `${r.symbol}:${r.sources.join('+')}`),
    withOrderly: withOrderly.length,
    btc: irows.find((r) => r.symbol === 'SPOT_BTC_USDC')?.sources,
  });

  const st = await get(`${SPOT}/time`);
  log('spot_time', { status: st.status, ms: st.ms, body: st.json });
  const sm = await get(`${SPOT}/market/getlist`);
  const smRows = Array.isArray(sm.json) ? sm.json : [];
  log('spot_markets', {
    status: sm.status,
    ms: sm.ms,
    bytes: sm.bytes,
    rows: smRows.length,
    keys: smRows[0] ? Object.keys(smRows[0]).slice(0, 30) : null,
    isActive: count(smRows.map((r) => String(r.isActive ?? r.active ?? r.status))),
    quotes: Object.entries(count(smRows.map((r) => r.secondaryTicker ?? r.quote ?? (r.symbol ?? '').split('/')[1]))).sort((a, b) => b[1] - a[1]).slice(0, 6),
  });
}

async function anchor() {
  const WATCH = ['PERP_BTC_USDC', 'PERP_ETH_USDC', 'PERP_SOL_USDC', 'PERP_WOO_USDC'];
  const info = (await get(`${API}/v1/public/info`)).json.data.rows;
  const infoBy = new Map(info.map((r) => [r.symbol, r]));
  const fr0 = await get(`${API}/v1/public/funding_rates`);
  log('funding_rates_first', { status: fr0.status, ms: fr0.ms, bytes: fr0.bytes, rows: fr0.json.data.rows.length, btc: fr0.json.data.rows.find((r) => r.symbol === 'PERP_BTC_USDC') });

  const times = [];
  const prev = new Map();
  const changes = new Map(WATCH.map((s) => [s, { index: 0, mark: 0, est: 0, next: 0, last: 0 }]));
  let first = null;
  let outOfBand = 0;
  let markZero = 0;
  let over1s = 0;
  const allChanged = { index: 0, mark: 0, est: 0 };
  for (let i = 0; i < 60; i++) {
    const t = performance.now();
    const r = await get(`${API}/v1/public/futures`);
    times.push(r.ms);
    if (r.ms > 1000) over1s++;
    const rows = r.json.data.rows;
    if (i === 0) {
      first = rows;
      keep('futures-first.json', r.text);
      const shared = rows.filter((x) => SHARED.test(x.symbol));
      log('futures_first', {
        rows: rows.length,
        shared: shared.length,
        bytes: r.bytes,
        nextFunding: count(shared.map((x) => new Date(x.next_funding_time).toISOString())),
        estNonZero: shared.filter((x) => x.est_funding_rate !== 0).length,
        btc: rows.find((x) => x.symbol === 'PERP_BTC_USDC'),
      });
    }
    for (const x of rows) {
      if (!SHARED.test(x.symbol)) continue;
      if (x.mark_price === 0) markZero++;
      const band = infoBy.get(x.symbol);
      if (band && x.index_price > 0) {
        const ratio = x.mark_price / x.index_price;
        if (ratio > band.mark_index_price_deviation_cap + 1e-9 || ratio < band.mark_index_price_deviation_floor - 1e-9) outOfBand++;
      }
      const p = prev.get(x.symbol);
      if (p) {
        if (p.index_price !== x.index_price) allChanged.index++;
        if (p.mark_price !== x.mark_price) allChanged.mark++;
        if (p.est_funding_rate !== x.est_funding_rate) allChanged.est++;
        const c = changes.get(x.symbol);
        if (c) {
          if (p.index_price !== x.index_price) c.index++;
          if (p.mark_price !== x.mark_price) c.mark++;
          if (p.est_funding_rate !== x.est_funding_rate) c.est++;
          if (p.next_funding_time !== x.next_funding_time) c.next++;
          if (p.last_funding_rate !== x.last_funding_rate) c.last++;
        }
      }
      prev.set(x.symbol, x);
    }
    const wait = 1000 - (performance.now() - t);
    if (wait > 0) await sleep(wait);
  }
  log('futures_poll', { ...stats(times), over1s });
  log('changes_in_59_intervals', Object.fromEntries(changes));
  log('changes_all_shared_rows', { ...allChanged, rowsTimesIntervals: 80 * 59 });
  log('clamp_check', { markOutsideInfoBand: outOfBand, markZero });

  const fr1 = await get(`${API}/v1/public/funding_rates`);
  log('funding_rates_last', { btc: fr1.json.data.rows.find((r) => r.symbol === 'PERP_BTC_USDC'), estTs: count(fr1.json.data.rows.map((r) => r.est_funding_rate_timestamp % 60000)) });

  for (const s of ['PERP_BTC_USDC', 'PERP_WOO_USDC']) {
    const h = await get(`${API}/v1/public/funding_rate_history?symbol=${s}`);
    const rows = h.json?.data?.rows ?? [];
    const head = rows.slice(0, 3).map((r) => ({ rate: r.funding_rate, at: new Date(r.funding_rate_timestamp).toISOString(), next: r.next_funding_time ? new Date(r.next_funding_time).toISOString() : undefined }));
    const f = first.find((x) => x.symbol === s);
    log('funding_history', { symbol: s, status: h.status, head, lastFundingRateInFutures: f.last_funding_rate, equalsNewest: rows[0]?.funding_rate === f.last_funding_rate, spacingH: rows.slice(0, 6).map((r, i, a) => (i ? (a[i - 1].funding_rate_timestamp - r.funding_rate_timestamp) / 3.6e6 : null)).slice(1) });
    await sleep(300);
  }
}

async function book() {
  for (const [symbol, level] of [['PERP_BTC_USDC', 20], ['PERP_BTC_USDC', 100], ['PERP_BTC_USDC', 1000], ['PERP_WOO_USDC', 1000]]) {
    const r = await query({ type: 'orderbook', symbol, max_level: level });
    const d = r.json?.data ?? {};
    const bids = (d.bids ?? []).map((l) => Number(l.price));
    const asks = (d.asks ?? []).map((l) => Number(l.price));
    const desc = bids.every((p, i) => i === 0 || p < bids[i - 1]);
    const asc = asks.every((p, i) => i === 0 || p > asks[i - 1]);
    log('rest_book', { symbol, level, status: r.status, ms: r.ms, bytes: r.bytes, bids: bids.length, asks: asks.length, bidsDescending: desc, asksAscending: asc, top: { bid: d.bids?.[0], ask: d.asks?.[0] }, mid: d.mid_price, innerTs: d.ts, ageMs: d.ts ? Date.now() - d.ts : null, weight: r.headers.get('x-ratelimit-weight'), remaining: r.headers.get('x-ratelimit-remaining') });
    await sleep(400);
  }
  const ts = [];
  for (let i = 0; i < 5; i++) {
    const r = await query({ type: 'orderbook', symbol: 'PERP_BTC_USDC', max_level: 5 });
    ts.push({ ms: r.ms, innerTs: r.json?.data?.ts, bid: r.json?.data?.bids?.[0]?.price });
    await sleep(200);
  }
  log('rest_book_repeat', { reads: ts });
  const auth = await get(`${API}/v1/orderbook/PERP_BTC_USDC?max_level=5`);
  log('v1_orderbook_without_key', { status: auth.status, body: auth.text.slice(0, 200) });
}

async function errors() {
  const cases = [
    ['futures unknown', `${API}/v1/public/futures/PERP_NOPE_USDC`],
    ['funding history unknown', `${API}/v1/public/funding_rate_history?symbol=PERP_NOPE_USDC`],
    ['unknown path', `${API}/v1/public/nope`],
    ['spot unknown market', `${SPOT}/market/info?symbol=NOPE_USDT`],
    ['spot unknown path', `${SPOT}/nope`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, body: r.text.slice(0, 200), retryAfter: r.headers.get('retry-after') });
    await sleep(300);
  }
  const q = await query({ type: 'orderbook', symbol: 'PERP_NOPE_USDC' });
  log('error_case', { name: 'query orderbook unknown', status: q.status, body: q.text.slice(0, 200) });
  const rl = await query({ type: 'rateLimitStatus' });
  log('query_rate_limit', { status: rl.status, data: rl.json?.data, headers: Object.fromEntries([...rl.headers].filter(([k]) => /ratelimit|retry/i.test(k))) });
  const f = await get(`${API}/v1/public/futures`);
  log('futures_headers', Object.fromEntries([...f.headers].filter(([k]) => /ratelimit|retry|cache|age|cf-|server|date/i.test(k))));

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/v1/public/system_info`);
    const t1 = Date.now();
    offsets.push({ offsetMs: r.json.timestamp - (t0 + t1) / 2, rttMs: t1 - t0 });
    await sleep(300);
  }
  log('orderly_clock', { reads: offsets });
  const so = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await get(`${SPOT}/time`);
    const t1 = Date.now();
    so.push({ offsetMs: r.json.serverTime - (t0 + t1) / 2, rttMs: t1 - t0 });
    await sleep(300);
  }
  log('spot_clock', { reads: so });
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, anchor, book, errors }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
