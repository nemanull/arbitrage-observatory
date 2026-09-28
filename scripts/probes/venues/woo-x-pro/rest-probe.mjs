// WOO X Pro public REST probe: catalog, per contract liveness (book sides, last trade), anchor fields and how often they change, errors, and CCXT's bitmart class pointed at this host.
// Public, unauthenticated, read-only. Every call stays under the documented 12 requests per 2 s per endpoint.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/woo-x-pro/rest-probe.mjs [catalog|live|anchor|errors|ccxt]
//   catalog  three catalog calls with timing, counts by quote, status and funding interval, contract sizes. About 5 s.
//   live     one depth and one trade call per contract, prints book sides, best prices against the index, last trade age. About 40 s.
//   anchor   catalog polled once a second for 60 s, counts changes of index, funding and last price, plus funding-rate, funding history and mark kline for BTCUSDT and BTCUSDC. About 70 s.
//   errors   unknown symbol, unknown route, missing parameter.
//   ccxt     CCXT 4.5.68 bitmart with its swap URL replaced by this host, fetchContractMarkets only.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/woo-x-pro/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://cloud-api.wooxpro.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

async function catalog() {
  for (let i = 0; i < 3; i++) {
    const r = await getCatalog();
    log('catalog_call', { i, status: r.status, ms: r.ms, bytes: r.bytes, cfRay: r.headers.get('cf-ray'), code: r.json?.code, body: r.json?.data ? undefined : r.text.slice(0, 120) });
    if (r.json?.data && i === 0) {
      keep('details.json', r.text);
      const s = r.json.data.symbols;
      const groups = {};
      for (const m of s) {
        const k = `${m.product_type}/${m.status}/${m.quote_currency}/${m.funding_interval_hours}h`;
        groups[k] = (groups[k] ?? 0) + 1;
      }
      log('catalog_groups', { count: s.length, groups });
      const sizes = {};
      for (const m of s) sizes[m.contract_size] = (sizes[m.contract_size] ?? 0) + 1;
      log('contract_sizes', { sizes });
      log('fields', { keys: Object.keys(s[0]).sort() });
      log('tradfi', { symbols: s.filter((m) => m.tradfi_info).map((m) => m.symbol) });
      const pairs = {};
      for (const m of s) (pairs[m.base_currency] ??= []).push(m.symbol);
      log('bases_listed_twice', { pairs: Object.fromEntries(Object.entries(pairs).filter(([, v]) => v.length > 1)) });
    }
    await sleep(400);
  }
}

// The catalog route intermittently answers 404 {"error_msg":"404 Route Not Found"}, so a caller retries.
async function getCatalog() {
  for (let i = 0; i < 30; i++) {
    const r = await get('/contract/public/details');
    if (r.json?.data) return r;
    log('catalog_retry', { i, status: r.status, body: r.text.slice(0, 80) });
    await sleep(2000);
  }
  throw new Error('catalog unavailable');
}

async function live() {
  const cat = await getCatalog();
  const s = cat.json.data.symbols;
  const now = Date.now();
  const rows = [];
  for (const m of s) {
    const d = await get(`/contract/public/depth?symbol=${m.symbol}`);
    await sleep(200);
    const t = await get(`/contract/public/market-trade?symbol=${m.symbol}&limit=1`);
    await sleep(200);
    const bids = d.json?.data?.bids ?? [];
    const asks = d.json?.data?.asks ?? [];
    const lastTrade = t.json?.data?.[0];
    const idx = Number(m.index_price);
    const bb = bids[0] ? Number(bids[0][0]) : null;
    const ba = asks[0] ? Number(asks[0][0]) : null;
    const mid = bb && ba ? (bb + ba) / 2 : null;
    rows.push({
      symbol: m.symbol,
      bids: bids.length,
      asks: asks.length,
      midVsIndexPct: mid ? +(((mid - idx) / idx) * 100).toFixed(2) : null,
      lastVsIndexPct: +(((Number(m.last_price) - idx) / idx) * 100).toFixed(2),
      lastTradeAgeH: lastTrade ? +((now / 1000 - lastTrade.time) / 3600).toFixed(2) : null,
      turnover24h: Math.round(Number(m.turnover_24h)),
      depthMs: d.ms,
    });
  }
  keep('live.json', JSON.stringify(rows, null, 1));
  for (const r of rows) console.log(JSON.stringify(r));
  const twoSided = rows.filter((r) => r.bids > 0 && r.asks > 0);
  const tradedHour = rows.filter((r) => r.lastTradeAgeH !== null && r.lastTradeAgeH < 1);
  const nearIndex = rows.filter((r) => r.midVsIndexPct !== null && Math.abs(r.midVsIndexPct) < 1);
  log('live_summary', {
    contracts: rows.length,
    twoSided: twoSided.length,
    oneOrNoSide: rows.length - twoSided.length,
    tradedInLastHour: tradedHour.map((r) => r.symbol),
    midWithin1PctOfIndex: nearIndex.map((r) => r.symbol),
    turnoverSumUsd: rows.reduce((a, r) => a + r.turnover24h, 0),
    turnoverOfTradedInLastHour: tradedHour.reduce((a, r) => a + r.turnover24h, 0),
  });
}

async function anchor() {
  const prev = new Map();
  const changes = new Map();
  const times = [];
  const t0 = Date.now();
  let polls = 0;
  while (Date.now() - t0 < 60_000) {
    const tick = Date.now();
    const r = await get('/contract/public/details');
    polls++;
    times.push(r.ms);
    if (r.json?.data) {
      for (const m of r.json.data.symbols) {
        const cur = { index: m.index_price, fr: m.funding_rate, efr: m.expected_funding_rate, ft: m.funding_time, last: m.last_price };
        const p = prev.get(m.symbol);
        const c = changes.get(m.symbol) ?? { index: 0, fr: 0, efr: 0, ft: 0, last: 0 };
        if (p) for (const k of Object.keys(cur)) if (p[k] !== cur[k]) c[k]++;
        prev.set(m.symbol, cur);
        changes.set(m.symbol, c);
      }
    } else log('anchor_poll_fail', { status: r.status, body: r.text.slice(0, 100) });
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  times.sort((a, b) => a - b);
  log('anchor_polls', { polls, msMin: times[0], msMedian: times[times.length >> 1], msMax: times[times.length - 1] });
  for (const sym of ['BTCUSDT', 'BTCUSDC', 'ETHUSDT', 'SOLUSDT', 'XAUTUSDT']) log('anchor_changes', { sym, ...changes.get(sym), sample: prev.get(sym) });
  const all = [...changes.values()];
  log('anchor_changes_all', { contracts: all.length, indexChangedMedian: all.map((c) => c.index).sort((a, b) => a - b)[all.length >> 1], indexNeverChanged: [...changes].filter(([, c]) => c.index === 0).map(([k]) => k) });
  for (const sym of ['BTCUSDT', 'BTCUSDC']) {
    const f = await get(`/contract/public/funding-rate?symbol=${sym}`);
    log('funding_rate', { sym, status: f.status, ms: f.ms, data: f.json?.data });
    const h = await get(`/contract/public/funding-rate-history?symbol=${sym}&limit=4`);
    log('funding_history', { sym, list: h.json?.data?.list });
    const now = Math.floor(Date.now() / 1000);
    const k = await get(`/contract/public/markprice-kline?symbol=${sym}&step=1&start_time=${now - 180}&end_time=${now}`);
    log('mark_kline', { sym, status: k.status, rows: k.json?.data?.slice(-2) });
    const d = prev.get(sym);
    log('catalog_row', { sym, index: d?.index, fundingRate: d?.fr, expected: d?.efr, fundingTime: d?.ft });
    await sleep(500);
  }
}

async function errors() {
  for (const p of ['/contract/public/funding-rate?symbol=NOPEUSDT', '/contract/public/depth?symbol=NOPEUSDT', '/contract/public/depth', '/contract/public/nothing', '/system/time', '/contract/public/details?symbol=NOPEUSDT']) {
    const r = await get(p);
    log('error_case', { path: p, status: r.status, ms: r.ms, retryAfter: r.headers.get('retry-after'), body: r.text.slice(0, 160) });
    await sleep(300);
  }
}

async function ccxtMode() {
  const ccxt = require('ccxt');
  const ex = new ccxt.bitmart();
  ex.urls.api.swap = API; // bitmart.js line 122 builds api-cloud-v2.{hostname}, which does not fit cloud-api.wooxpro.com
  const markets = await ex.fetchContractMarkets();
  const swaps = markets.filter((m) => m.swap);
  log('ccxt_bitmart', { version: ccxt.version, markets: markets.length, swaps: swaps.length, active: swaps.filter((m) => m.active).length });
  for (const id of ['BTCUSDT', 'BTCUSDC', 'BTCUSD', 'XAUTUSDT']) {
    const m = markets.find((x) => x.id === id);
    if (m) log('ccxt_market', { id: m.id, symbol: m.symbol, settle: m.settle, linear: m.linear, contractSize: m.contractSize, active: m.active, taker: m.taker, maker: m.maker });
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, live, anchor, errors, ccxt: ccxtMode };
await modes[mode]();
