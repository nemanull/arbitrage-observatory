// BASEKX futures REST probe: host latency, catalog, the bulk index, mark and ticker calls, funding, REST book, server time, and a book compare against XT futures.
// Public, unauthenticated, read-only. At most a few requests per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/basekx/rest-probe.mjs [catalog|anchor|poll|book|xt]
//   catalog  latency, symbol list by family and state, coin-M list, fees per symbol, CCXT class check, server time offset.
//   anchor   bulk mark-price, index-price, agg-tickers and tickers, funding-rate and funding-rate-record on ten perps.
//   poll     one second polls of mark-price, index-price and agg-tickers for 45 s, counts how often each value changed.
//   book     REST depth at several levels, level order, number format.
//   xt       the same depth call on BASEKX and on fapi.xt.com, compares update id and top levels.
// Recorded in docs/profiles/basekx/rest.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://www.basekx.com/futures/fapi/market/v1/public';
const DAPI = 'https://www.basekx.com/futures/dapi/market/v1/public';
const XT = 'https://fapi.xt.com/future/market/v1/public';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

async function get(url) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await r.text();
    const ms = Math.round(performance.now() - t0);
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, ms, bytes: text.length, json, text: json ? null : text.slice(0, 200), retryAfter: r.headers.get('retry-after'), headers: r.headers };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), error: String(e.cause?.code || e.message) };
  }
}

async function catalog() {
  for (let i = 0; i < 3; i++) { const r = await get(`${API}/time`); log('time_latency', { i, status: r.status, ms: r.ms }); }
  const t0 = Date.now();
  const tr = await get(`${API}/time`);
  const t1 = Date.now();
  const mid = Math.round((t0 + t1) / 2);
  log('clock', { serverMs: tr.json?.data, localMidMs: mid, offsetMs: tr.json?.data - mid, rttMs: t1 - t0 });
  const r = await get(`${API}/symbol/list`);
  log('symbol_list_raw_u_note', { note: 'REST depth u is a JSON number above 2^53, so JSON.parse rounds it' });
  log('symbol_list', { status: r.status, ms: r.ms, bytes: r.bytes, headersSample: { server: r.headers.get('server'), cache: r.headers.get('x-cache'), rateLimit: Object.fromEntries([...r.headers.entries()].filter(([k]) => /limit|retry/i.test(k))) } });
  const d = r.json.data;
  const fam = {};
  for (const m of d) { const k = `${m.contractType}/${m.underlyingType}/${m.quoteCoin}/state=${m.state}/trade=${m.tradeSwitch}`; fam[k] = (fam[k] || 0) + 1; }
  log('families', fam);
  const fees = {};
  for (const m of d) { const k = `taker=${m.takerFee} maker=${m.makerFee}`; fees[k] = (fees[k] || 0) + 1; }
  log('fees', fees);
  log('fee_outliers', { list: d.filter((m) => m.takerFee !== '0.0004' || m.makerFee !== '0.0004').map((m) => `${m.symbol} ${m.takerFee}/${m.makerFee}`) });
  const cs = {};
  for (const m of d) cs[m.contractSize] = (cs[m.contractSize] || 0) + 1;
  log('contract_sizes', { cs });
  const bases = {};
  for (const m of d) bases[m.baseCoin] = (bases[m.baseCoin] || 0) + 1;
  log('pairs_listed_twice', { list: Object.entries(bases).filter(([, n]) => n > 1) });
  log('sample', { btc: d.find((m) => m.symbol === 'btc_usdt'), event: d.find((m) => m.contractType === 'EVENT')?.symbol });
  const dr = await get(`${DAPI}/symbol/list`);
  log('coin_m_list', { status: dr.status, count: dr.json?.data?.length, body: JSON.stringify(dr.json).slice(0, 120) });
  log('ccxt', { version: ccxt.version, hasBasekx: ccxt.exchanges.includes('basekx'), matches: ccxt.exchanges.filter((e) => /base|kx/i.test(e)) });
}

async function anchor() {
  for (const p of ['q/mark-price', 'q/index-price', 'q/agg-tickers', 'q/tickers']) {
    const r = await get(`${API}/${p}`);
    const d = r.json?.data || [];
    log('bulk', { call: p, status: r.status, ms: r.ms, bytes: r.bytes, rows: d.length, first: JSON.stringify(d[0]).slice(0, 260) });
  }
  const m = (await get(`${API}/q/mark-price`)).json.data;
  const ix = (await get(`${API}/q/index-price`)).json.data;
  const ag = (await get(`${API}/q/agg-tickers`)).json.data;
  const im = new Map(ix.map((r) => [r.s, r.p]));
  let eqMI = 0, eqMC = 0, eqIC = 0;
  const diffs = [];
  for (const r of ag) {
    if (r.i === r.m) eqMI++; else diffs.push(`${r.s} i=${r.i} m=${r.m} c=${r.c}`);
    if (r.m === r.c) eqMC++;
    if (r.i === r.c) eqIC++;
  }
  log('agg_equalities', { rows: ag.length, indexEqMark: eqMI, markEqLast: eqMC, indexEqLast: eqIC, diffs: diffs.slice(0, 8), markVsIndexCallEqual: m.filter((r) => im.get(r.s) === r.p).length });
  const syms = ['btc_usdt', 'eth_usdt', 'sol_usdt', 'xrp_usdt', 'doge_usdt', 'dot_usdt', 'tao_usdt', 'nvda_usdt', 'wld_usdt', 'aixbt_usdt'];
  for (const s of syms) {
    const f = await get(`${API}/q/funding-rate?symbol=${s}`);
    const h = await get(`${API}/q/funding-rate-record?symbol=${s}&limit=5`);
    log('funding', { s, rate: JSON.stringify(f.json?.data), records: h.json?.data?.items?.length ?? JSON.stringify(h.json).slice(0, 100) });
    await sleep(250);
  }
  const f0 = await get(`${API}/q/funding-rate`);
  log('funding_no_symbol', { status: f0.status, body: JSON.stringify(f0.json) });
  const rb = await get(`${API}/contract/risk-balance?symbol=btc_usdt`);
  log('risk_balance', { status: rb.status, body: JSON.stringify(rb.json).slice(0, 200) });
}

async function poll() {
  const prev = {}, changes = { mark: {}, index: {}, last: {} }, ms = [];
  const keys = ['btc_usdt', 'eth_usdt', 'dot_usdt', 'tao_usdt', 'aixbt_usdt'];
  for (let i = 0; i < 45; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/q/agg-tickers`);
    ms.push(r.ms);
    for (const x of r.json?.data || []) {
      if (!keys.includes(x.s)) continue;
      const p = prev[x.s];
      if (p) { if (p.m !== x.m) changes.mark[x.s] = (changes.mark[x.s] || 0) + 1; if (p.i !== x.i) changes.index[x.s] = (changes.index[x.s] || 0) + 1; if (p.c !== x.c) changes.last[x.s] = (changes.last[x.s] || 0) + 1; }
      prev[x.s] = x;
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  ms.sort((a, b) => a - b);
  log('poll', { polls: ms.length, msMin: ms[0], msMed: ms[ms.length >> 1], msMax: ms[ms.length - 1], changesOver44Intervals: changes });
}

async function book() {
  for (const lv of [5, 20, 50, 100, 500, 1000]) {
    const r = await get(`${API}/q/depth?symbol=btc_usdt&level=${lv}`);
    const d = r.json?.data;
    const b = d?.b || [], a = d?.a || [];
    let bd = true, aa = true, sci = 0;
    for (let i = 1; i < b.length; i++) if (Number(b[i][0]) >= Number(b[i - 1][0])) bd = false;
    for (let i = 1; i < a.length; i++) if (Number(a[i][0]) <= Number(a[i - 1][0])) aa = false;
    for (const l of [...b, ...a]) if (/e/i.test(l[1])) sci++;
    log('depth', { level: lv, status: r.status, ms: r.ms, code: r.json?.code, msg: r.json?.msg, bids: b.length, asks: a.length, bidDesc: bd, askAsc: aa, sci, u: d?.u, t: d?.t });
    await sleep(300);
  }
  const x = await get(`${API}/q/depth?symbol=nope_usdt&level=20`);
  log('depth_unknown', { status: x.status, body: JSON.stringify(x.json).slice(0, 200) });
}

async function xt() {
  for (let i = 0; i < 3; i++) {
    const [b, x] = await Promise.all([get(`${API}/q/depth?symbol=btc_usdt&level=5`), get(`${XT}/q/depth?symbol=btc_usdt&level=5`)]);
    const bd = b.json?.data, xd = x.json?.result;
    log('xt_compare', { basekx: { status: b.status, u: bd?.u, t: bd?.t, b0: bd?.b?.[0], a0: bd?.a?.[0] }, xt: { status: x.status, error: x.error, u: xd?.u, t: xd?.t, b0: xd?.b?.[0], a0: xd?.a?.[0] } });
    await sleep(1000);
  }
}

const mode = process.argv[2] || 'catalog';
const fn = { catalog, anchor, poll, book, xt }[mode];
if (!fn) { console.error('unknown mode'); process.exit(1); }
await fn();
