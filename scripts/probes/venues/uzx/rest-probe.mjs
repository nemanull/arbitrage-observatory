// UZX public REST probe: catalog, bulk anchor tickers, funding history, REST book, errors, clock and access.
// Public, unauthenticated, read-only. Every call stays far inside the documented 20 per 2 s and 10 per s limits.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/uzx/rest-probe.mjs [catalog|anchor|funding|book|errors|all]
//   catalog  DNS, cold and warm times, /v2/products against the web symbol lists and the bulk tickers, CCXT id check, the VIP fee list, access checks. About 15 s.
//   anchor   /notification/swap/tickers once a second for 60 s: reply time and size, how often each anchor field changes, premium spread. About 65 s.
//   funding  /v2/info/swap/history/funding for every perpetual: interval, settlement hours, newest settled rate against the ticker rates. About 30 s.
//   book     /notification/swap/{symbol}/orderbook at every step: levels, order, caching, size unit. About 10 s.
//   errors   unknown symbol and path replies, response headers, server time offset. About 10 s.
//   compare  one UZX tickers read against one Binance USD-M premiumIndex read: index gap and funding rate equality. About 2 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/uzx/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolve4 } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api-v2.uzx.com'; // documented REST host
const WEB_API = 'https://api.uzx.com'; // host the web client calls, carries the undocumented /v2/info routes
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init) {
  const t = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = performance.now() - t;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json, ms, bytes: Buffer.byteLength(text) };
}

async function catalog() {
  for (const host of ['api-v2.uzx.com', 'api.uzx.com', 'stream.uzx.com', 'www.uzx.com']) {
    try {
      log('dns', { host, a: await resolve4(host) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const times = [];
  let products;
  for (let i = 0; i < 6; i++) {
    const r = await get(`${API}/v2/products`);
    times.push(Math.round(r.ms));
    if (i === 0) {
      products = r.json.data;
      keep('products.json', r.text);
      log('products_first', { status: r.status, ms: Math.round(r.ms), bytes: r.bytes, cfRay: r.headers.get('cf-ray'), server: r.headers.get('server') });
    }
    await sleep(300);
  }
  log('products_times', { coldMs: times[0], warmMs: times.slice(1) });

  const byType = {};
  for (const p of products) byType[p.ins_type] = (byType[p.ins_type] ?? 0) + 1;
  log('products_counts', { total: products.length, byType, fields: Object.keys(products[0]) });

  const perps = products.filter((p) => p.ins_type !== 'SPOT');
  const sv = {};
  for (const p of perps) sv[`${p.ins_type}:${p.swap_value}`] = (sv[`${p.ins_type}:${p.swap_value}`] ?? 0) + 1;
  log('swap_value_counts', sv);
  log('quote_coins', { swap: [...new Set(perps.filter((p) => p.ins_type === 'SWAP').map((p) => p.quote_coin_name))], base: perps.filter((p) => p.ins_type === 'BASE').map((p) => `${p.product_name} base=${JSON.stringify(p.base_coin_name)} quote=${p.quote_coin_name} value=${p.swap_value}`) });
  const deeps = {};
  for (const p of perps) deeps[p.market_max_deeps] = (deeps[p.market_max_deeps] ?? 0) + 1;
  log('market_max_deeps', deeps);
  log('scaled_or_odd', { names: perps.map((p) => p.product_name).filter((n) => /^\d/.test(n) || /XAU|UZX/.test(n)) });

  const ws = await get(`${WEB_API}/v2/info/swap-usdt/symbols`);
  const wb = await get(`${WEB_API}/v2/info/swap-base/symbols`);
  keep('swap-usdt-symbols.json', ws.text);
  const web = [...ws.json.data, ...wb.json.data];
  const st = {};
  for (const s of web) st[`status=${s.status} hidden=${s.front_hidden}`] = (st[`status=${s.status} hidden=${s.front_hidden}`] ?? 0) + 1;
  log('web_symbols', { usdtStatus: ws.status, baseStatus: wb.status, usdt: ws.json.data.length, base: wb.json.data.length, states: st, circuitRate: [...new Set(web.map((s) => s.circuit_rate))], priceRange: [...new Set(web.map((s) => s.price_range))], takerFee: [...new Set(web.map((s) => s.taker_fee))] });
  const prodNames = new Set(perps.map((p) => p.product_name));
  const webNames = new Set(web.map((s) => s.product_name));
  log('products_vs_web', { onlyProducts: [...prodNames].filter((n) => !webNames.has(n)), onlyWeb: [...webNames].filter((n) => !prodNames.has(n)), swapValueMismatch: web.filter((s) => { const p = perps.find((x) => x.product_name === s.product_name); return p && p.swap_value !== s.swap_value; }).map((s) => s.product_name) });

  const t = await get(`${API}/notification/swap/tickers`);
  const tickNames = new Set(t.json.data.map((x) => x.symbol));
  log('tickers_vs_products', { tickers: tickNames.size, onlyTickers: [...tickNames].filter((n) => !prodNames.has(n)), missingFromTickers: [...prodNames].filter((n) => !tickNames.has(n)) });
  const extra = t.json.data.filter((x) => !prodNames.has(x.symbol));
  log('tickers_extra_rows', { rows: extra.map((x) => `${x.symbol} close=${x.market.close} vol=${x.market.vol} index=${x.index.close} tag=${x.tag.close} fr=${x.funding_rate} next=${x.funding_next_time}`) });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, uzx: ccxt.exchanges.filter((e) => /uzx/i.test(e)) });

  for (const host of ['api-v2.uzx.com', 'stream.uzx.com']) {
    const tr = await get(`https://${host}/cdn-cgi/trace`);
    const kv = Object.fromEntries(tr.text.trim().split('\n').map((l) => l.split('=')));
    log('cf_trace', { host, status: tr.status, loc: kv.loc, colo: kv.colo, http: kv.http, tls: kv.tls });
  }

  // The VIP page renders this public call, and it is the only published fee schedule.
  const vip = await get(`${WEB_API}/uc/v2/vip/list`);
  log('vip_list', { status: vip.status, rows: vip.json?.data?.length ?? null });
  for (const v of vip.json?.data ?? []) log('vip_level', { level: v.level, uzx: v.uzxVolume, spot30d: v.spotTradeVolumeD30, swap30d: v.swapTradeVolumeD30, uMaker: v.uMakerFee, uTaker: v.uTakerFee, coinMaker: v.coinMakerFee, coinTaker: v.coinTakerFee, spotMaker: v.spotMakerFee, spotTaker: v.spotTakerFee, updated: new Date(v.updateTime).toISOString() });

  // The web client posts this on page load to decide whether to show the region notice. It reads, it does not change state.
  const region = await get(`${WEB_API}/content/limit/region/judgeByIp`, { method: 'POST' });
  log('region_judge', { status: region.status, body: region.text.slice(0, 300) });
}

async function anchor() {
  const live = new Set((await get(`${API}/v2/products`)).json.data.filter((p) => p.ins_type !== 'SPOT').map((p) => p.product_name));
  const polls = [];
  const last = new Map();
  const changes = new Map();
  let first;
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const due = t0 + i * 1000;
    if (Date.now() < due) await sleep(due - Date.now());
    let r;
    try {
      r = await get(`${API}/notification/swap/tickers`);
    } catch (e) {
      log('poll_error', { i, error: e.message });
      continue;
    }
    const arrival = Date.now();
    polls.push({ ms: r.ms, bytes: r.bytes, status: r.status, age: arrival - r.json.ts });
    if (!first) {
      first = r.json;
      keep('tickers.json', r.text);
    }
    for (const x of r.json.data) {
      const cur = { index: x.index.close, mark: x.tag.close, fr: x.funding_rate, pre: x.pre_funding_rate, next: x.funding_next_time, last: x.market.close };
      const prev = last.get(x.symbol);
      const c = changes.get(x.symbol) ?? { index: 0, mark: 0, fr: 0, pre: 0, next: 0, last: 0, polls: 0 };
      c.polls++;
      if (prev) for (const k of Object.keys(cur)) if (prev[k] !== cur[k]) c[k]++;
      changes.set(x.symbol, c);
      last.set(x.symbol, cur);
    }
  }
  const ms = polls.map((p) => p.ms);
  log('anchor_polls', { polls: polls.length, statuses: [...new Set(polls.map((p) => p.status))], minMs: r1(q(ms, 0)), medianMs: r1(q(ms, 0.5)), p90Ms: r1(q(ms, 0.9)), maxMs: r1(Math.max(...ms)), over1s: ms.filter((m) => m > 1000).length, bytesMedian: q(polls.map((p) => p.bytes), 0.5), replyTsAgeMedianMs: q(polls.map((p) => p.age), 0.5), replyTsAgeMaxMs: Math.max(...polls.map((p) => p.age)) });

  const rows = [...changes.entries()].filter(([s]) => live.has(s));
  const dist = (k) => {
    const v = rows.map(([, c]) => c[k]);
    return { min: Math.min(...v), median: q(v, 0.5), max: Math.max(...v), zero: v.filter((x) => x === 0).length };
  };
  log('changes_per_60_polls', { symbols: rows.length, index: dist('index'), mark: dist('mark'), fundingRate: dist('fr'), preFundingRate: dist('pre'), nextFunding: dist('next'), last: dist('last') });
  for (const s of ['BTCUSDT', 'ETHUSDT', 'ACEUSDT', 'UZXUSDT', 'XAUUSDT', 'BTCUSD']) log('changes_symbol', { symbol: s, ...changes.get(s) });

  const snap = [...last.entries()].filter(([s]) => live.has(s)); // the tickers reply also carries delisted rows with zero prices and no next time
  const prem = snap.map(([s, v]) => ({ s, ppm: Math.round((Number(v.mark) / Number(v.index) - 1) * 1e6), lastPpm: Math.round((Number(v.last) / Number(v.index) - 1) * 1e6), markEqLast: v.mark === v.last, frEqPre: v.fr === v.pre, fr: v.fr, pre: v.pre, next: v.next, index: v.index }));
  const abs = prem.map((p) => Math.abs(p.ppm));
  log('premium_scope', { liveContracts: snap.length, deadRowsSkipped: last.size - snap.length });
  log('premium_last_poll', { medianAbsPpm: q(abs, 0.5), p90AbsPpm: q(abs, 0.9), maxAbsPpm: Math.max(...abs), markEqualsLast: prem.filter((p) => p.markEqLast).length, fundingEqualsPredicted: prem.filter((p) => p.frEqPre).length, zeroIndex: prem.filter((p) => Number(p.index) === 0).map((p) => p.s) });
  log('premium_top', { rows: [...prem].sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm)).slice(0, 8).map((p) => `${p.s} mark-index ${p.ppm} ppm, last-index ${p.lastPpm} ppm`) });
  const nexts = {};
  for (const p of prem) nexts[p.next] = (nexts[p.next] ?? 0) + 1;
  log('funding_next_time', { values: Object.entries(nexts).map(([k, v]) => `${k} (${new Date(Number(k) * 1000).toISOString()}) x${v}`) });
  const frs = prem.map((p) => Number(p.fr));
  log('funding_rate_last_poll', { min: Math.min(...frs), median: q(frs, 0.5), max: Math.max(...frs), at0001: frs.filter((f) => f === 0.0001).length, differ: prem.filter((p) => !p.frEqPre).map((p) => `${p.s} fr=${p.fr} pre=${p.pre}`) });

  const one = await get(`${API}/notification/swap/BTCUSDT/ticker`);
  const b = first.data.find((x) => x.symbol === 'BTCUSDT');
  log('single_ticker', { status: one.status, ms: Math.round(one.ms), bytes: one.bytes, ch: one.json.ch, keys: Object.keys(one.json.data), bulkKeys: Object.keys(b) });
  log('bulk_row_btc', { row: JSON.stringify(b) });
}

async function funding() {
  const products = (await get(`${API}/v2/products`)).json.data.filter((p) => p.ins_type !== 'SPOT');
  const tick = new Map((await get(`${API}/notification/swap/tickers`)).json.data.map((x) => [x.symbol, x]));
  const cycles = {};
  const hours = {};
  const rows = [];
  for (const p of products) {
    await sleep(350);
    const r = await get(`${WEB_API}/v2/info/swap/history/funding?symbol=${p.product_name}&page=1&size=3`);
    const list = r.json?.data?.list ?? [];
    if (r.status !== 200 || list.length === 0) {
      rows.push({ s: p.product_name, status: r.status, body: r.text.slice(0, 120) });
      continue;
    }
    const newest = list[0];
    cycles[newest.cycle] = (cycles[newest.cycle] ?? 0) + 1;
    for (const e of list) {
      const h = new Date(e.time).getUTCHours();
      hours[h] = (hours[h] ?? 0) + 1;
    }
    const t = tick.get(p.product_name);
    rows.push({ s: p.product_name, cycle: newest.cycle, newestTime: new Date(newest.time).toISOString(), newest: newest.rate, total: r.json.data.total, fr: t?.funding_rate, pre: t?.pre_funding_rate, next: t ? new Date(t.funding_next_time * 1000).toISOString() : null, gapToNextH: t ? (t.funding_next_time * 1000 - newest.time) / 3.6e6 : null });
  }
  const ok = rows.filter((r) => r.cycle !== undefined);
  log('funding_cycles', { cycles, settlementHoursUtc: hours, fourHour: ok.filter((r) => r.cycle === 4).map((r) => r.s) });
  log('funding_compare', { contracts: ok.length, failed: rows.filter((r) => r.cycle === undefined), tickerRateEqualsNewestSettled: ok.filter((r) => r.fr === r.newest).length, predictedEqualsNewestSettled: ok.filter((r) => r.pre === r.newest).length, gapToNextEqualsCycle: ok.filter((r) => r.gapToNextH === r.cycle).length, gapOther: ok.filter((r) => r.gapToNextH !== r.cycle).map((r) => `${r.s} gap ${r.gapToNextH} cycle ${r.cycle}`) });
  for (const r of ok.filter((x) => ['BTCUSDT', 'ETHUSDT', 'ACEUSDT', 'BTCUSD', 'XAUUSDT', 'UZXUSDT'].includes(x.s))) log('funding_row', r);

  const deep = await get(`${WEB_API}/v2/info/swap/history/funding?symbol=BTCUSDT&page=1&size=100`);
  const list = deep.json.data.list;
  const rates = list.map((e) => Number(e.rate));
  log('funding_btc_history', { entries: list.length, total: deep.json.data.total, oldest: new Date(list.at(-1).time).toISOString(), newest: new Date(list[0].time).toISOString(), min: Math.min(...rates), max: Math.max(...rates), exactly0001: rates.filter((x) => x === 0.0001).length, cycles: [...new Set(list.map((e) => e.cycle))] });
  let maxAbs = { s: null, rate: 0 };
  for (const p of products) {
    await sleep(350);
    const r = await get(`${WEB_API}/v2/info/swap/history/funding?symbol=${p.product_name}&page=1&size=100`);
    for (const e of r.json?.data?.list ?? []) if (Math.abs(Number(e.rate)) > Math.abs(maxAbs.rate)) maxAbs = { s: p.product_name, rate: Number(e.rate), time: new Date(e.time).toISOString() };
  }
  log('funding_max_abs_last_100', maxAbs);
}

async function book() {
  for (const step of ['', 'step0', 'step1', 'step2', 'step3']) {
    const r = await get(`${API}/notification/swap/BTCUSDT/orderbook${step ? `?interval=${step}` : ''}`);
    const d = r.json.data;
    const bids = d.bids.map((l) => Number(l[0]));
    const asks = d.asks.map((l) => Number(l[0]));
    const bidDesc = bids.every((p, i) => i === 0 || p < bids[i - 1]);
    const askAsc = asks.every((p, i) => i === 0 || p > asks[i - 1]);
    const tick = bids.length > 1 ? Math.round((bids[0] - bids[1]) * 100) / 100 : null;
    log('rest_book', { step: step || 'none', status: r.status, ms: Math.round(r.ms), bytes: r.bytes, interval: r.json.interval, dataInterval: d.interval, bids: d.bids.length, asks: d.asks.length, bidDesc, askAsc, firstGap: tick, top: [d.bids[0], d.asks[0]], sizeTypes: typeof d.bids[0][1], ageMs: Date.now() - d.ts, keys: Object.keys(d) });
    await sleep(200);
  }
  const a = await get(`${API}/notification/swap/BTCUSDT/orderbook?interval=step0`);
  const b = await get(`${API}/notification/swap/BTCUSDT/orderbook?interval=step0`);
  log('rest_book_cache', { sameTs: a.json.data.ts === b.json.data.ts, tsA: a.json.data.ts, tsB: b.json.data.ts, cfA: a.headers.get('cf-cache-status'), cacheControl: a.headers.get('cache-control') });
  for (const s of ['ETHUSDT', 'ACEUSDT', 'BTCUSD', 'XAUUSDT', '1000SATSUSDT']) {
    const r = await get(`${API}/notification/swap/${s}/orderbook?interval=step0`);
    const d = r.json.data;
    const sizes = [...d.bids, ...d.asks].map((l) => l[1]);
    log('rest_book_symbol', { s, status: r.status, bids: d.bids.length, asks: d.asks.length, top: [d.bids[0], d.asks[0]], fractionalSizes: sizes.filter((x) => !/^\d+$/.test(String(x))).length, ageMs: Date.now() - d.ts });
    await sleep(200);
  }
}

async function errors() {
  const cases = [
    `${API}/notification/swap/NOPEUSDT/orderbook?interval=step0`,
    `${API}/notification/swap/NOPEUSDT/ticker`,
    `${API}/notification/swap/BTCUSDT/orderbook?interval=step9`,
    `${API}/notification/swap/BTC-USDT/ticker`,
    `${API}/v2/nope`,
    `${API}/v2/products?ins_type=NOPE`,
    `${API}/v2/products?ins_type=SWAP`,
    `${API}/v2/products?ins_type=BASE`,
  ];
  for (const u of cases) {
    const r = await get(u);
    log('error_case', { url: u.replace(API, ''), status: r.status, bytes: r.bytes, body: r.json ? JSON.stringify(r.json).slice(0, 200) : r.text.slice(0, 120) });
    await sleep(250);
  }
  const h = await get(`${API}/notification/swap/tickers`);
  const hdr = {};
  for (const [k, v] of h.headers) if (!/report-to|nel|set-cookie/.test(k)) hdr[k] = v.slice(0, 80);
  log('tickers_headers', hdr);

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/v2/time`);
    const t1 = Date.now();
    offsets.push({ offsetMs: r.json.data.server_time - (t0 + t1) / 2, rttMs: t1 - t0 });
    if (i === 0) log('time_reply', { status: r.status, body: r.text.slice(0, 120) });
    await sleep(300);
  }
  log('clock', { offsetsMs: offsets.map((o) => Math.round(o.offsetMs)), rttMs: offsets.map((o) => o.rttMs) });
}

// Tells whether UZX republishes another venue's index or funding rate, which the anchor reader would then double count.
async function compare() {
  const live = new Set((await get(`${API}/v2/products?ins_type=SWAP`)).json.data.map((p) => p.product_name));
  const uz = (await get(`${API}/notification/swap/tickers`)).json.data.filter((x) => live.has(x.symbol));
  const bn = await get('https://fapi.binance.com/fapi/v1/premiumIndex');
  log('binance_reply', { status: bn.status, rows: Array.isArray(bn.json) ? bn.json.length : null });
  if (!Array.isArray(bn.json)) return;
  const m = new Map(bn.json.map((x) => [x.symbol, x]));
  const rows = uz.filter((u) => m.has(u.symbol)).map((u) => {
    const b = m.get(u.symbol);
    return { s: u.symbol, indexPpm: Math.round((Number(u.index.close) / Number(b.indexPrice) - 1) * 1e6), markPpm: Math.round((Number(u.tag.close) / Number(b.markPrice) - 1) * 1e6), u: Number(u.funding_rate), b: Number(b.lastFundingRate) };
  });
  const trivial = new Set([0.0001, 0.00005, 0]);
  const nt = rows.filter((r) => !trivial.has(r.b));
  const ai = rows.map((r) => Math.abs(r.indexPpm));
  const am = rows.map((r) => Math.abs(r.markPpm));
  log('uzx_vs_binance', { shared: rows.length, notOnBinance: [...live].filter((s) => !m.has(s)), indexGapMedianPpm: q(ai, 0.5), indexGapMaxPpm: Math.max(...ai), indexExact: rows.filter((r) => r.indexPpm === 0).length, markGapMedianPpm: q(am, 0.5), markExact: rows.filter((r) => r.markPpm === 0).length, fundingEqual: rows.filter((r) => r.u === r.b).length, fundingNontrivial: nt.length, fundingNontrivialEqual: nt.filter((r) => r.u === r.b).length });
  log('uzx_vs_binance_nontrivial', { rows: nt.map((r) => `${r.s} uzx ${r.u} binance ${r.b}`) });
  log('uzx_vs_binance_index_top', { rows: [...rows].sort((a, b) => Math.abs(b.indexPpm) - Math.abs(a.indexPpm)).slice(0, 5).map((r) => `${r.s} index ${r.indexPpm} ppm, mark ${r.markPpm} ppm`) });

  // Binance lists only the contracts whose interval differs from 8 h, so a shared contract missing from it is on 8 h.
  const info = await get('https://fapi.binance.com/fapi/v1/fundingInfo');
  const bnHours = new Map((info.json ?? []).map((x) => [x.symbol, x.fundingIntervalHours]));
  const pick = ['BTCUSDT', 'ETHUSDT', 'ACEUSDT', ...rows.filter((r) => bnHours.has(r.s) && bnHours.get(r.s) !== 8).map((r) => r.s)].slice(0, 12);
  let sameRate = 0;
  let compared = 0;
  const cyc = [];
  for (const sym of pick) {
    await sleep(400);
    const uh = (await get(`${WEB_API}/v2/info/swap/history/funding?symbol=${sym}&page=1&size=5`)).json?.data?.list ?? [];
    const bh = (await get(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=5`)).json ?? [];
    const bmap = new Map(bh.map((x) => [Math.floor(x.fundingTime / 1000) * 1000, Number(x.fundingRate)]));
    for (const e of uh) {
      const b = bmap.get(e.time);
      if (b === undefined) continue;
      compared++;
      if (b === Number(e.rate)) sameRate++;
    }
    cyc.push(`${sym} uzx ${uh[0]?.cycle ?? '?'}h binance ${bnHours.get(sym) ?? 8}h`);
  }
  log('settled_history_vs_binance', { contracts: pick.length, settlementsCompared: compared, identicalRate: sameRate, intervals: cyc });
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, anchor, funding, book, errors, compare };
for (const [name, fn] of Object.entries(modes)) {
  if (mode !== 'all' && mode !== name) continue;
  log('mode', { name, at: new Date().toISOString() });
  await fn();
}
