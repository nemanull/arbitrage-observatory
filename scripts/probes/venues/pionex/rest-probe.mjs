// Pionex REST probe: perpetual and spot catalog, the bulk index and mark reply, funding history, REST depth, error shapes, rate limit headers and clock offset.
// Public, unauthenticated, read-only. Requests are spaced at least 600 ms apart, inside the documented 10 weight per second per IP, where each market call weighs 5.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/pionex/rest-probe.mjs [catalog|anchor|funding|intervals|depth|errors|time]
//   catalog  symbols by type and status, family counts, symbol sets of indexes, tickers and bookTicker, and the CCXT class check. About 10 s.
//   anchor   60 polls of GET /api/v1/market/indexes one second apart: reply size and time, how often each number changes, updateTime age. About 65 s.
//   funding  funding history for a sample of perpetuals to derive the interval, and the last settled rate against nextFundingRate. About 15 s.
//   intervals  nextFundingTime groups, then the interval of every eighth contract from its funding history, or with PREV_INDEXES=<an earlier indexes reply> the 1 h, 4 h and 8 h split across a settlement hour. About 46 s, or 1 s.
//   depth    REST depth at 20, 100 and 1000 levels, level order, updateTime age, and two back to back reads. About 10 s.
//   errors   unknown symbol, spot symbol, bad type and bad limit on the market calls. About 8 s.
//   time     response timestamp against the local clock over 10 requests. About 8 s.
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/pionex/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.pionex.com';
const OUT = process.env.PROBE_OUT_DIR;
const SPACING_MS = 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

let lastRequestAt = 0;

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const t0 = performance.now();
  const sentAt = Date.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = performance.now() - t0;
  const receivedAt = Date.now();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return {
    status: res.status,
    ms: Math.round(ms),
    bytes: text.length,
    text,
    body,
    sentAt,
    receivedAt,
    tokens: res.headers.get('x-ratelimit-tokens'),
    retryAfter: res.headers.get('retry-after'),
  };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

function family(sym) {
  const [base, quote] = sym.symbol.split('_');
  if (sym.quoteCurrency === 'USDT' && sym.symbol.endsWith('_USDT_PERP')) return 'USDT-M';
  if (base === 'USDT') return 'USDT_<coin> (quoted in coin)';
  return `coin-quoted (${quote})`;
}

async function catalog() {
  const perp = await get('/api/v1/common/symbols?type=PERP');
  keep('symbols-perp.json', perp.text);
  const syms = perp.body.data.symbols;
  const byFamily = {};
  const byStatus = {};
  for (const s of syms) {
    byFamily[family(s)] = (byFamily[family(s)] ?? 0) + 1;
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }
  log('symbols_perp', { status: perp.status, ms: perp.ms, bytes: perp.bytes, count: syms.length, byFamily, byStatus, tokens: perp.tokens });
  log('symbols_perp_btc', { row: syms.find((s) => s.symbol === 'BTC_USDT_PERP') });
  const renamed = syms.filter((s) => s.baseCurrency !== s.symbol.split('_')[0]);
  log('base_differs_from_symbol_prefix', { count: renamed.length, rows: renamed.map((s) => `${s.symbol}:${s.baseCurrency}`) });
  const liq = {};
  for (const s of syms) liq[s.liquidationFeeRate] = (liq[s.liquidationFeeRate] ?? 0) + 1;
  const liqRates = Object.keys(liq).map(Number).sort((a, b) => a - b);
  log('liquidation_fee_rate', { min: liqRates[0], max: liqRates[liqRates.length - 1], mostCommon: Object.entries(liq).sort((a, b) => b[1] - a[1]).slice(0, 4) });
  const nonAscii = syms.filter((s) => /[^\x20-\x7e]/.test(s.symbol)).map((s) => s.symbol);
  log('non_ascii_symbols', { count: nonAscii.length, rows: nonAscii });
  const bases = {};
  for (const s of syms) {
    const k = `${s.baseCurrency}/${s.quoteCurrency}`;
    (bases[k] ??= []).push(s.symbol);
  }
  log('pair_listed_twice', { rows: Object.entries(bases).filter(([, v]) => v.length > 1) });

  for (const st of ['TRADING', 'OFFLINE']) {
    const r = await get(`/api/v1/common/symbols?type=PERP&status=${st}`);
    log('symbols_perp_status', { status: st, http: r.status, count: r.body?.data?.symbols?.length ?? null, symbols: r.body?.data?.symbols === null ? 'null' : 'array', sample: r.body?.data?.symbols?.slice(0, 5).map((s) => s.symbol) });
  }

  const spot = await get('/api/v1/common/symbols?type=SPOT');
  const spotSyms = spot.body.data.symbols;
  const spotEnabled = spotSyms.filter((s) => s.enable).length;
  log('symbols_spot', { status: spot.status, ms: spot.ms, bytes: spot.bytes, count: spotSyms.length, enabled: spotEnabled });

  const idx = await get('/api/v1/market/indexes');
  keep('indexes.json', idx.text);
  const bt = await get('/api/v1/market/bookTickers?type=PERP'); // the futures docs spell it bookTicker, which answers 404
  const tk = await get('/api/v1/market/tickers?type=PERP');
  const perpSet = new Set(syms.map((s) => s.symbol));
  const idxSet = new Set(idx.body.data.indexes.map((r) => r.symbol));
  const btSet = new Set(bt.body.data.tickers.map((r) => r.symbol));
  const tkSet = new Set(tk.body.data.tickers.map((r) => r.symbol));
  const diff = (a, b) => [...a].filter((x) => !b.has(x));
  log('symbol_sets', {
    perp: perpSet.size,
    indexes: { count: idxSet.size, bytes: idx.bytes, ms: idx.ms, missingFromIndexes: diff(perpSet, idxSet), extra: diff(idxSet, perpSet) },
    bookTicker: { count: btSet.size, bytes: bt.bytes, ms: bt.ms, missing: diff(perpSet, btSet).slice(0, 10), extra: diff(btSet, perpSet).slice(0, 10) },
    tickers: { count: tkSet.size, bytes: tk.bytes, ms: tk.ms, missing: diff(perpSet, tkSet).slice(0, 10), extra: diff(tkSet, perpSet).slice(0, 10) },
  });
  const btc = bt.body.data.tickers.find((r) => r.symbol === 'BTC_USDT_PERP');
  const tkb = tk.body.data.tickers.find((r) => r.symbol === 'BTC_USDT_PERP');
  log('bookTicker_btc', { row: btc, replyTs: bt.body.timestamp });
  log('ticker_btc', { row: tkb });
  const vol = tk.body.data.tickers
    .map((r) => ({ s: r.symbol, amount: Number(r.amount) }))
    .sort((a, b) => b.amount - a.amount);
  log('ticker_volume', {
    totalQuoteAmount24h: Math.round(vol.reduce((a, r) => a + (Number.isFinite(r.amount) ? r.amount : 0), 0)),
    top5: vol.slice(0, 5).map((r) => `${r.s}:${Math.round(r.amount)}`),
    zeroTrades: tk.body.data.tickers.filter((r) => r.count === 0).length,
  });

  const ccxt = require('ccxt');
  const hasClass = ccxt.exchanges.filter((e) => /pionex/i.test(e));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, pionexClasses: hasClass });
}

async function anchor() {
  const watch = ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'USDT_BTC_PERP', 'BTC_ETH_PERP'];
  const times = [];
  const sizes = [];
  const ages = [];
  const tokens = [];
  const changes = {};
  const prev = new Map();
  let allChanged = { index: [], mark: [], rate: [], nextTime: [] };
  let last;
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const r = await get('/api/v1/market/indexes');
    if (r.status !== 200 || !r.body?.result) {
      log('anchor_poll_error', { i, status: r.status, body: r.text.slice(0, 300) });
      await sleep(1000);
      continue;
    }
    times.push(r.ms);
    sizes.push(r.bytes);
    tokens.push(Number(r.tokens));
    const rows = r.body.data.indexes;
    let ci = 0, cm = 0, cr = 0, cn = 0;
    for (const row of rows) {
      ages.push(r.receivedAt - row.updateTime);
      const p = prev.get(row.symbol);
      if (p) {
        if (p.indexPrice !== row.indexPrice) ci++;
        if (p.markPrice !== row.markPrice) cm++;
        if (p.nextFundingRate !== row.nextFundingRate) cr++;
        if (p.nextFundingTime !== row.nextFundingTime) cn++;
        if (watch.includes(row.symbol)) {
          const c = (changes[row.symbol] ??= { index: 0, mark: 0, rate: 0, updateTime: 0 });
          if (p.indexPrice !== row.indexPrice) c.index++;
          if (p.markPrice !== row.markPrice) c.mark++;
          if (p.nextFundingRate !== row.nextFundingRate) c.rate++;
          if (p.updateTime !== row.updateTime) c.updateTime++;
        }
      }
      prev.set(row.symbol, row);
    }
    if (i > 0) {
      allChanged.index.push(ci);
      allChanged.mark.push(cm);
      allChanged.rate.push(cr);
      allChanged.nextTime.push(cn);
    }
    last = r;
    const spent = Date.now() - t0;
    if (spent < 1000) await sleep(1000 - spent);
  }
  keep('indexes-last.json', last.text);
  log('anchor_reply', { rows: last.body.data.indexes.length, bytes: stats(sizes), ms: stats(times), tokens: stats(tokens) });
  log('anchor_update_age_ms', stats(ages));
  log('anchor_rows_changed_per_poll', { of: last.body.data.indexes.length, index: stats(allChanged.index), mark: stats(allChanged.mark), rate: stats(allChanged.rate), nextTime: stats(allChanged.nextTime) });
  log('anchor_watch_changes_in_59_intervals', changes);
  const rows = last.body.data.indexes;
  const nft = {};
  for (const row of rows) nft[new Date(row.nextFundingTime).toISOString()] = (nft[new Date(row.nextFundingTime).toISOString()] ?? 0) + 1;
  const premium = rows.map((row) => ({ s: row.symbol, ppm: Math.round((Number(row.markPrice) / Number(row.indexPrice) - 1) * 1e6) }));
  premium.sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm));
  const rates = rows.map((row) => Number(row.nextFundingRate)).sort((a, b) => a - b);
  log('anchor_snapshot', {
    nextFundingTime: nft,
    zeroOrMissingMark: rows.filter((row) => !(Number(row.markPrice) > 0)).map((row) => row.symbol),
    zeroOrMissingIndex: rows.filter((row) => !(Number(row.indexPrice) > 0)).map((row) => row.symbol),
    premiumPpmTop10: premium.slice(0, 10).map((p) => `${p.s}:${p.ppm}`),
    rateMin: rates[0],
    rateMax: rates[rates.length - 1],
    ratesAtMinus0p0005OrBelow: rates.filter((x) => x <= -0.0005).length,
    ratesAt0p0005OrAbove: rates.filter((x) => x >= 0.0005).length,
  });
  for (const sym of watch) log('anchor_watch_row', { row: rows.find((row) => row.symbol === sym) });
}

async function funding() {
  const idx = await get('/api/v1/market/indexes');
  const rows = idx.body.data.indexes;
  const byNext = {};
  for (const row of rows) (byNext[row.nextFundingTime] ??= []).push(row);
  const sample = ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'USDT_BTC_PERP', 'BTC_ETH_PERP'];
  for (const group of Object.values(byNext)) {
    for (const row of group.slice(0, 4)) if (!sample.includes(row.symbol)) sample.push(row.symbol);
  }
  const extreme = [...rows].sort((a, b) => Math.abs(Number(b.nextFundingRate)) - Math.abs(Number(a.nextFundingRate))).slice(0, 3);
  for (const row of extreme) if (!sample.includes(row.symbol)) sample.push(row.symbol);
  const intervals = {};
  for (const sym of sample.slice(0, 16)) {
    const r = await get(`/api/v1/market/fundingRates?symbol=${encodeURIComponent(sym)}&limit=10`);
    if (!r.body?.result) {
      log('funding_error', { sym, status: r.status, body: r.text.slice(0, 200) });
      continue;
    }
    const rates = r.body.data.rates;
    const gaps = rates.slice(0, -1).map((x, i) => (x.fundingTime - rates[i + 1].fundingTime) / 3_600_000);
    const now = rows.find((x) => x.symbol === sym);
    intervals[sym] = gaps[0];
    log('funding_history', {
      sym,
      last: rates[0] && { rate: rates[0].fundingRate, at: new Date(rates[0].fundingTime).toISOString() },
      gapsHours: gaps,
      nextFundingRate: now?.nextFundingRate,
      nextFundingTime: now && new Date(now.nextFundingTime).toISOString(),
      nextMinusLastHours: now && rates[0] ? (now.nextFundingTime - rates[0].fundingTime) / 3_600_000 : null,
    });
  }
  const r = await get('/api/v1/market/fundingRates?symbol=BTC_USDT_PERP');
  log('funding_default_limit', { rows: r.body?.data?.rates?.length, body: r.text.slice(0, 300) });
}

// With PREV_INDEXES set to an indexes reply saved before a settlement hour, the pair of nextFundingTime values splits 1 h, 4 h and 8 h contracts.
async function intervals() {
  const r = await get('/api/v1/market/indexes');
  keep('indexes-intervals.json', r.text);
  const rows = r.body.data.indexes;
  const groups = {};
  for (const row of rows) groups[new Date(row.nextFundingTime).toISOString()] = (groups[new Date(row.nextFundingTime).toISOString()] ?? 0) + 1;
  log('next_funding_groups', { at: new Date(r.receivedAt).toISOString(), groups });
  const prevPath = process.env.PREV_INDEXES;
  if (!prevPath) {
    // Without an earlier reply, sample the funding history of every eighth contract, one call about every 600 ms.
    const sample = rows.filter((_, i) => i % 8 === 0);
    const hours = {};
    for (const row of sample) {
      await sleep(400);
      const h = await get(`/api/v1/market/fundingRates?symbol=${encodeURIComponent(row.symbol)}&limit=2`);
      const rates = h.body?.data?.rates ?? [];
      const gap = rates.length === 2 ? (rates[0].fundingTime - rates[1].fundingTime) / 3_600_000 : 'unknown';
      hours[gap] = (hours[gap] ?? 0) + 1;
    }
    log('interval_sample', { sampled: sample.length, of: rows.length, hours });
    return;
  }
  const { readFileSync } = await import('node:fs');
  const prev = JSON.parse(readFileSync(prevPath, 'utf8'));
  const before = new Map(prev.data.indexes.map((row) => [row.symbol, row.nextFundingTime]));
  const pairs = {};
  for (const row of rows) {
    const b = before.get(row.symbol);
    if (b === undefined) continue;
    const k = `${new Date(b).toISOString().slice(11, 16)} then ${new Date(row.nextFundingTime).toISOString().slice(11, 16)}`;
    pairs[k] = (pairs[k] ?? 0) + 1;
  }
  log('next_funding_transitions', { before: new Date(prev.timestamp).toISOString(), pairs });
}

async function depth() {
  for (const limit of [20, 100, 1000]) {
    const r = await get(`/api/v1/market/depth?symbol=BTC_USDT_PERP&limit=${limit}`);
    const d = r.body.data;
    const desc = d.bids.every((x, i) => i === 0 || Number(x[0]) < Number(d.bids[i - 1][0]));
    const asc = d.asks.every((x, i) => i === 0 || Number(x[0]) > Number(d.asks[i - 1][0]));
    log('depth', { limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: d.bids.length, asks: d.asks.length, bidsDescending: desc, asksAscending: asc, top: [d.bids[0], d.asks[0]], updateAgeMs: r.receivedAt - d.updateTime, replyTs: r.body.timestamp, keys: Object.keys(d) });
    if (limit === 20) keep('depth-btc-20.json', r.text);
  }
  const a = await get('/api/v1/market/depth?symbol=BTC_USDT_PERP&limit=5');
  const b = await get('/api/v1/market/depth?symbol=BTC_USDT_PERP&limit=5');
  log('depth_back_to_back', { gapMs: b.sentAt - a.sentAt, sameUpdateTime: a.body.data.updateTime === b.body.data.updateTime, a: a.body.data.updateTime, b: b.body.data.updateTime, sameTop: JSON.stringify(a.body.data.bids[0]) === JSON.stringify(b.body.data.bids[0]) });
  const q = await get('/api/v1/market/depth?symbol=BTC_ETH_PERP&limit=20');
  log('depth_coin_quoted', { status: q.status, bids: q.body?.data?.bids?.length, asks: q.body?.data?.asks?.length, top: [q.body?.data?.bids?.[0], q.body?.data?.asks?.[0]] });
  const u = await get('/api/v1/market/depth?symbol=USDT_BTC_PERP&limit=20');
  log('depth_usdt_base', { status: u.status, bids: u.body?.data?.bids?.length, asks: u.body?.data?.asks?.length, top: [u.body?.data?.bids?.[0], u.body?.data?.asks?.[0]] });
}

async function errors() {
  const cases = [
    '/api/v1/market/depth?symbol=NOPE_USDT_PERP',
    '/api/v1/market/depth?symbol=BTC_USDT_PERP&limit=2000',
    '/api/v1/market/indexes?symbol=NOPE_USDT_PERP',
    '/api/v1/market/indexes?symbol=BTC_USDT',
    '/api/v1/market/tickers?type=NOPE',
    '/api/v1/market/fundingRates?symbol=BTC_USDT',
    '/api/v1/market/fundingRates',
    '/api/v1/common/symbols?symbols=NOPE_USDT_PERP',
    '/api/v1/market/bookTicker?type=PERP',
    '/api/v1/nope',
  ];
  for (const p of cases) {
    const r = await get(p);
    log('error_case', { path: p, status: r.status, tokens: r.tokens, retryAfter: r.retryAfter, body: r.text.slice(0, 220) });
  }
}

async function time() {
  const offsets = [];
  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const r = await get('/api/v1/market/bookTickers?symbol=BTC_USDT_PERP');
    const mid = (r.sentAt + r.receivedAt) / 2;
    offsets.push(r.body.timestamp - mid);
    rtts.push(r.receivedAt - r.sentAt);
  }
  log('clock', { offsetMs: stats(offsets.map(Math.round)), rttMs: stats(rtts) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, funding, intervals, depth, errors, time };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
