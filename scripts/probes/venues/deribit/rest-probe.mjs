// Deribit REST probe: host latency, clock offset, the perpetual catalog and its CCXT mapping, the bulk anchor calls and how often they change, funding history, the REST book, and error shapes.
// Public, unauthenticated, read-only. Stays far inside the documented public limits: get_instruments at most once per mode, other calls at most 3 per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/deribit/rest-probe.mjs [host|catalog|anchor|funding|book|errors]
//   host     DNS, cold and warm get_time, clock offset. About 5 s.
//   catalog  get_instruments, perpetual counts per settlement, CCXT 4.5.68 loadMarkets mapping. About 10 s.
//   anchor   book summary per currency: fields, sizes, timings, and 60 one second polls with change counts, plus ticker and get_index_price cross checks. About 70 s.
//   funding  get_funding_rate_history over 24 h, get_funding_rate_value, and the documented formula against the published current_funding. About 5 s.
//   book     get_order_book at several depths: level order, size unit against contract_size. About 5 s.
//   errors   unknown instrument, missing parameter, unknown method, set_heartbeat over HTTP. About 3 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/deribit/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://www.deribit.com/api/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, name) {
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  if (name) keep(name, text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, json, text, headers: res.headers };
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (arr) => ({ n: arr.length, min: Math.min(...arr), median: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) });

async function host() {
  const addrs = await lookup('www.deribit.com', { all: true });
  log('dns', { host: 'www.deribit.com', addresses: addrs.map((a) => a.address) });
  const times = [];
  const offsets = [];
  for (let i = 0; i < 11; i++) {
    const before = Date.now();
    const r = await get('/public/get_time');
    const after = Date.now();
    times.push(r.ms);
    offsets.push(r.json.result - (before + after) / 2);
    if (i === 0) log('get_time_first', { status: r.status, ms: r.ms, body: r.text, server: r.headers.get('server'), cfRay: r.headers.get('cf-ray') });
    await sleep(300);
  }
  log('get_time', { coldMs: times[0], warm: stats(times.slice(1)), clockOffsetMs: stats(offsets.map((o) => Math.round(o))) });
  const st = await get('/public/status');
  log('status', { status: st.status, body: st.text });
  const hdr = await get('/public/get_time');
  const names = [];
  hdr.headers.forEach((v, k) => names.push(`${k}: ${v.slice(0, 60)}`));
  log('headers', { names });
}

async function catalog() {
  const r = await get('/public/get_instruments', 'get_instruments.json');
  const all = r.json.result;
  log('get_instruments', { status: r.status, ms: r.ms, bytes: r.bytes, rows: all.length });
  const perps = all.filter((m) => m.settlement_period === 'perpetual');
  const fam = {};
  for (const m of perps) {
    const k = `${m.instrument_type} settle=${m.settlement_currency} quote=${m.quote_currency} counter=${m.counter_currency} state=${m.state} active=${m.is_active}`;
    fam[k] = (fam[k] ?? 0) + 1;
  }
  log('perp_families', fam);
  const states = {};
  for (const m of all) states[m.state] = (states[m.state] ?? 0) + 1;
  log('states_all_kinds', states);
  const fees = {};
  for (const m of perps) fees[`${m.taker_commission}/${m.maker_commission}`] = (fees[`${m.taker_commission}/${m.maker_commission}`] ?? 0) + 1;
  log('perp_taker_maker', fees);
  const cs = {};
  for (const m of perps) cs[`${m.contract_size}|min=${m.min_trade_amount}`] = (cs[`${m.contract_size}|min=${m.min_trade_amount}`] ?? 0) + 1;
  log('perp_contract_size_and_min', cs);
  const pi = {};
  for (const m of perps) pi[m.price_index.endsWith('_usdc') ? 'x_usdc' : m.price_index] = (pi[m.price_index.endsWith('_usdc') ? 'x_usdc' : m.price_index] ?? 0) + 1;
  log('perp_price_index_suffix', pi);
  const ut = {};
  for (const m of perps) ut[m.underlying_type ?? 'absent'] = (ut[m.underlying_type ?? 'absent'] ?? 0) + 1;
  log('perp_underlying_type', ut);
  log('perp_sample', { btc: perps.find((m) => m.instrument_name === 'BTC_USDC-PERPETUAL'), inverse: perps.find((m) => m.instrument_name === 'ETH-PERPETUAL') });
  const spot = all.filter((m) => m.kind === 'spot');
  log('spot', { rows: spot.length, open: spot.filter((m) => m.state === 'open').length, sample: spot.slice(0, 3).map((m) => m.instrument_name) });

  await sleep(1500);
  const ex = new ccxt.deribit();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  log('ccxt_loadMarkets', { version: ccxt.version, ms: Math.round(performance.now() - t0), markets: Object.keys(markets).length });
  const swaps = Object.values(markets).filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  const byFam = {};
  for (const m of swaps) {
    const k = `linear=${m.linear} settle=${m.settle} quote=${m.quote} contractSize=${m.contractSize} taker=${m.taker}`;
    byFam[k] = (byFam[k] ?? 0) + 1;
  }
  log('ccxt_active_swaps', { count: swaps.length, byFam });
  const perpIds = new Set(perps.map((m) => m.instrument_name));
  log('ccxt_id_match', { idsInCatalog: swaps.filter((m) => perpIds.has(m.id)).length, of: swaps.length });
  const base = {};
  for (const m of swaps) (base[m.base] ??= []).push(m.id);
  log('ccxt_pairs_listed_twice', Object.fromEntries(Object.entries(base).filter(([, v]) => v.length > 1)));
  const csMismatch = swaps.filter((m) => m.contractSize !== perps.find((p) => p.instrument_name === m.id)?.contract_size).length;
  log('ccxt_contractSize_equals_contract_size', { mismatches: csMismatch });
  log('ccxt_samples', swaps.filter((m) => ['BTC_USDC-PERPETUAL', 'BTC-PERPETUAL', '1000PEPE_USDC-PERPETUAL', 'NVDA_USDC-PERPETUAL'].includes(m.id)).map((m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, active: m.active })));
}

async function anchor() {
  const calls = [
    ['USDC', '/public/get_book_summary_by_currency?currency=USDC&kind=future'],
    ['BTC', '/public/get_book_summary_by_currency?currency=BTC&kind=future'],
    ['ETH', '/public/get_book_summary_by_currency?currency=ETH&kind=future'],
  ];
  for (const [cur, path] of calls) {
    const r = await get(path, `summary_${cur}.json`);
    const rows = r.json.result;
    const perps = rows.filter((x) => x.instrument_name.endsWith('-PERPETUAL'));
    const keys = new Set();
    for (const p of perps) Object.keys(p).forEach((k) => keys.add(k));
    log('book_summary', { currency: cur, status: r.status, ms: r.ms, bytes: r.bytes, rows: rows.length, perps: perps.length, perpKeys: [...keys].sort() });
    const missing = { mark: perps.filter((p) => !(p.mark_price > 0)).length, edp: perps.filter((p) => !(p.estimated_delivery_price > 0)).length, cur: perps.filter((p) => typeof p.current_funding !== 'number').length, f8h: perps.filter((p) => typeof p.funding_8h !== 'number').length };
    log('book_summary_missing', { currency: cur, ...missing });
    if (cur === 'USDC') log('book_summary_btc_row', perps.find((p) => p.instrument_name === 'BTC_USDC-PERPETUAL'));
    await sleep(400);
  }
  const w = await get('/public/get_book_summary_by_currency?currency=any&kind=future', 'summary_any.json');
  log('book_summary_any', { status: w.status, ms: w.ms, bytes: w.bytes, rows: w.json?.result?.length, perps: w.json?.result?.filter((x) => x.instrument_name.endsWith('-PERPETUAL')).length, error: w.json?.error });
  await sleep(400);

  // Cross check estimated_delivery_price against ticker index_price and get_index_price for a few names.
  const summary = (await get('/public/get_book_summary_by_currency?currency=USDC&kind=future')).json.result;
  for (const id of ['BTC_USDC-PERPETUAL', 'HYPE_USDC-PERPETUAL', 'NVDA_USDC-PERPETUAL', 'OPENAI_USDC-PERPETUAL']) {
    const t = await get(`/public/ticker?instrument_name=${id}`, `ticker_${id}.json`);
    const s = summary.find((x) => x.instrument_name === id);
    const tr = t.json.result;
    log('ticker_vs_summary', { id, tickerMs: t.ms, tickerIndex: tr.index_price, summaryEdp: s?.estimated_delivery_price, tickerMark: tr.mark_price, summaryMark: s?.mark_price, cur: tr.current_funding, f8h: tr.funding_8h, sumCur: s?.current_funding, sumF8h: s?.funding_8h, interest_value: tr.interest_value, min_price: tr.min_price, max_price: tr.max_price, state: tr.state, keys: Object.keys(tr).join(',') });
    await sleep(350);
  }
  const inst = (await get('/public/get_instrument?instrument_name=BTC_USDC-PERPETUAL')).json.result;
  const ix = await get(`/public/get_index_price?index_name=${inst.price_index}`);
  log('get_index_price', { index_name: inst.price_index, ms: ix.ms, body: ix.text.slice(0, 200) });
  await sleep(350);

  // 60 one second polls of the USDC summary, counting how often each number changes.
  const watch = ['BTC_USDC-PERPETUAL', 'ETH_USDC-PERPETUAL', 'HYPE_USDC-PERPETUAL', 'NVDA_USDC-PERPETUAL', 'ALGO_USDC-PERPETUAL', 'OPENAI_USDC-PERPETUAL', 'GOLD_USDC-PERPETUAL'];
  const prev = {};
  const changes = {};
  const times = [];
  const bytes = [];
  const serverUs = [];
  const created = [];
  const ages = [];
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const r = await get('/public/get_book_summary_by_currency?currency=USDC&kind=future');
    const btcRow = r.json.result.find((x) => x.instrument_name === 'BTC_USDC-PERPETUAL');
    created.push(btcRow.creation_timestamp);
    ages.push(Date.now() - btcRow.creation_timestamp);
    times.push(r.ms);
    bytes.push(r.bytes);
    serverUs.push(r.json.usDiff);
    for (const row of r.json.result) {
      if (!watch.includes(row.instrument_name)) continue;
      const c = (changes[row.instrument_name] ??= { edp: 0, mark: 0, cur: 0, f8h: 0, polls: 0 });
      const p = prev[row.instrument_name];
      c.polls++;
      if (p) {
        if (p.estimated_delivery_price !== row.estimated_delivery_price) c.edp++;
        if (p.mark_price !== row.mark_price) c.mark++;
        if (p.current_funding !== row.current_funding) c.cur++;
        if (p.funding_8h !== row.funding_8h) c.f8h++;
      }
      prev[row.instrument_name] = row;
    }
    const wait = 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
  }
  log('summary_poll_timing', { ms: stats(times), bytes: stats(bytes), usDiff: stats(serverUs) });
  const distinct = [...new Set(created)];
  log('summary_creation_timestamp', { distinctOf60: distinct.length, stepMs: stats(distinct.slice(1).map((x, i) => x - distinct[i])), ageAtReceiptMs: stats(ages) });
  log('summary_poll_changes', changes);
  const last = Object.fromEntries(watch.map((id) => [id, { edp: prev[id]?.estimated_delivery_price, mark: prev[id]?.mark_price, cur: prev[id]?.current_funding, f8h: prev[id]?.funding_8h, ts: prev[id]?.creation_timestamp }]));
  log('summary_last', last);
}

async function funding() {
  const end = Date.now();
  const start = end - 24 * 3600 * 1000;
  for (const id of ['BTC_USDC-PERPETUAL', 'BTC-PERPETUAL', 'HYPE_USDC-PERPETUAL']) {
    const r = await get(`/public/get_funding_rate_history?instrument_name=${id}&start_timestamp=${start}&end_timestamp=${end}`, `funding_history_${id}.json`);
    const rows = r.json.result ?? [];
    const gaps = rows.slice(1).map((x, i) => x.timestamp - rows[i].timestamp);
    log('funding_history', { id, status: r.status, ms: r.ms, rows: rows.length, stepMs: rows.length > 1 ? stats(gaps) : null, first: rows[0], last: rows[rows.length - 1], keys: rows[0] ? Object.keys(rows[0]).join(',') : null });
    await sleep(350);
    const v = await get(`/public/get_funding_rate_value?instrument_name=${id}&start_timestamp=${end - 8 * 3600 * 1000}&end_timestamp=${end}`);
    log('funding_rate_value_8h', { id, body: v.text.slice(0, 160) });
    await sleep(350);
  }
  // The documented formula applied to the summary's mark and the ticker's index, against the published current_funding.
  const summary = (await get('/public/get_book_summary_by_currency?currency=USDC&kind=future')).json.result.filter((x) => x.instrument_name.endsWith('-PERPETUAL'));
  let agree = 0;
  const off = [];
  for (const s of summary) {
    const prem = (s.mark_price - s.estimated_delivery_price) / s.estimated_delivery_price;
    const damp = s.instrument_name.startsWith('PAXG') || s.instrument_name.startsWith('OPENAI') ? 0.001 : 0.00025;
    const expected = Math.max(damp, prem) + Math.min(-damp, prem);
    if (Math.abs(expected - s.current_funding) < 1e-6) agree++;
    else off.push({ id: s.instrument_name, prem: +prem.toFixed(7), expected: +expected.toFixed(7), published: s.current_funding, f8h: s.funding_8h });
  }
  log('current_funding_vs_formula', { perps: summary.length, agreeWithin1e6: agree, examplesOff: off.slice(0, 8) });
  const nonZero = summary.filter((s) => s.current_funding !== 0).length;
  const maxAbs = summary.reduce((m, s) => (Math.abs(s.current_funding) > Math.abs(m.v) ? { id: s.instrument_name, v: s.current_funding } : m), { v: 0 });
  log('current_funding_spread', { nonZero, zero: summary.length - nonZero, maxAbs });
}

async function book() {
  const inst = (await get('/public/get_instruments?kind=future')).json.result;
  await sleep(1100);
  for (const [id, depth] of [['BTC_USDC-PERPETUAL', 20], ['BTC_USDC-PERPETUAL', 10000], ['ETH-PERPETUAL', 20], ['ALGO_USDC-PERPETUAL', 20], ['NVDA_USDC-PERPETUAL', 20]]) {
    const r = await get(`/public/get_order_book?instrument_name=${id}&depth=${depth}`, `book_${id}_${depth}.json`);
    const b = r.json.result;
    const desc = b.bids.every((x, i) => i === 0 || b.bids[i - 1][0] > x[0]);
    const asc = b.asks.every((x, i) => i === 0 || b.asks[i - 1][0] < x[0]);
    const cs = inst.find((m) => m.instrument_name === id)?.contract_size;
    const multiples = [...b.bids, ...b.asks].filter((x) => Math.abs(x[1] / cs - Math.round(x[1] / cs)) < 1e-6).length;
    log('get_order_book', { id, depth, ms: r.ms, bytes: r.bytes, bids: b.bids.length, asks: b.asks.length, bidsDescending: desc, asksAscending: asc, top: { bid: b.bids[0], ask: b.asks[0] }, contract_size: cs, sizesThatAreMultiplesOfContractSize: `${multiples}/${b.bids.length + b.asks.length}`, change_id: b.change_id, timestamp: b.timestamp, keys: Object.keys(b).join(',') });
    await sleep(350);
  }
}

async function errors() {
  const cases = [
    ['unknown instrument ticker', '/public/ticker?instrument_name=NOPE_USDC-PERPETUAL'],
    ['unknown instrument book', '/public/get_order_book?instrument_name=NOPE_USDC-PERPETUAL'],
    ['missing currency', '/public/get_book_summary_by_currency'],
    ['bad currency', '/public/get_book_summary_by_currency?currency=NOPE'],
    ['unknown method', '/public/nope'],
    ['set_heartbeat over HTTP', '/public/set_heartbeat?interval=10'],
    ['private without auth', '/private/get_account_summary?currency=BTC'],
  ];
  for (const [what, path] of cases) {
    const r = await get(path);
    log('error_case', { what, status: r.status, ms: r.ms, body: r.text.slice(0, 260), retryAfter: r.headers.get('retry-after') });
    await sleep(350);
  }
}

const mode = process.argv[2] ?? 'host';
const modes = { host, catalog, anchor, funding, book, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
