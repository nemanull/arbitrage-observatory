// BTSE REST probe: host and latency, the perpetual catalog, the anchor bulk calls polled at one hertz, funding history, the REST book, error shapes and server time.
// Public, unauthenticated and read-only.
// The markets API allows 50 requests per 2 s per IP and the legacy futures API 15 per second, and this probe stays near 3 requests per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btse/rest-probe.mjs [all|host|catalog|anchor|funding|book|errors|time]
//   host     DNS, cold and warm request time
//   catalog  markets v1 and legacy market_summary, counts, symbol spellings, contract sizes, and whether CCXT 4.5.68 has a btse class
//   anchor   ticker/indices, ticker/24hr and legacy price polled once a second for 60 rounds, about 65 s
//   funding  recentFundingHistory and legacy funding_history on four perpetuals, and the rate distribution
//   book     REST book depth limits, level order and caching
//   errors   the replies to bad symbols and missing parameters, and any rate limit headers
//   time     server time against the local clock
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/btse/rest.md and docs/profiles/btse/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.btse.com';
const V1 = `${API}/public-api/market/v1`;
const LEGACY = `${API}/futures/api/v2.3`;
const PERP_TYPES = encodeURIComponent('["FuturesPerpetual"]');
const OUT = process.env.PROBE_OUT_DIR;
const ROUNDS = Number(process.env.ANCHOR_ROUNDS ?? 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { ...init, headers: { 'user-agent': 'observatory-probe', ...(init.headers ?? {}) } });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: Object.fromEntries(res.headers), text, json, ms, bytes: Buffer.byteLength(text) };
}

// A perpetual's symbol is spelled three ways: markets v1 `BTC-PERP-USDT`, its `tradeCurrency` and the legacy API `BTC-PERP`.
async function loadPerps() {
  const r = await get(`${V1}/markets`);
  const all = r.json.data.symbols;
  return { all, perps: all.filter((m) => m.type === 'FuturesPerpetual'), reply: r };
}

async function host() {
  const hostname = new URL(API).hostname;
  const t0 = performance.now();
  const v4 = await dns.resolve4(hostname).catch((e) => e.code);
  log('dns', { hostname, v4, ms: round(performance.now() - t0) });
  const cold = await get(`${API}/spot/api/v3.3/time`);
  const warm = [];
  for (let i = 0; i < 5; i++) {
    warm.push((await get(`${API}/spot/api/v3.3/time`)).ms);
    await sleep(300);
  }
  log('latency_time_call', { coldMs: round(cold.ms), warmMs: warm.map((x) => round(x)), server: cold.headers.server, cfRay: cold.headers['cf-ray'] });
}

async function catalog() {
  log('ccxt', { version: ccxt.version, hasBtse: ccxt.exchanges.includes('btse'), matches: ccxt.exchanges.filter((e) => /bts/i.test(e)) });
  const { all, perps, reply } = await loadPerps();
  save('markets.json', reply.text);
  log('markets_v1', { status: reply.status, bytes: reply.bytes, ms: round(reply.ms), rows: all.length });
  const by = {};
  for (const m of all) {
    const k = `${m.type}|${m.category}|${m.quoteCurrency}|active=${m.active}`;
    by[k] = (by[k] ?? 0) + 1;
  }
  log('markets_by_type', by);
  log('perp_spelling', {
    symbolIsTradeCurrencyPlusQuote: perps.filter((m) => m.symbol === `${m.tradeCurrency}-${m.quoteCurrency}`).length,
    tradeCurrencyEndsPerp: perps.filter((m) => m.tradeCurrency === `${m.baseCurrency}-PERP`).length,
    perps: perps.length,
    odd: perps.filter((m) => m.tradeCurrency !== `${m.baseCurrency}-PERP`).map((m) => `${m.symbol}/${m.baseCurrency}`).slice(0, 20),
  });
  const bases = {};
  for (const m of perps) bases[m.baseCurrency] = (bases[m.baseCurrency] ?? 0) + 1;
  log('perp_bases_listed_twice', { bases: Object.entries(bases).filter(([, n]) => n > 1) });
  log('perp_scaled_bases', { list: perps.filter((m) => /^(1000|10000|1M|100)/.test(m.baseCurrency) || /^(1000|10000)/.test(m.tradeCurrency)).map((m) => `${m.symbol} cs=${m.contractSize}`) });
  const cs = {};
  for (const m of perps) cs[m.contractSize] = (cs[m.contractSize] ?? 0) + 1;
  log('perp_contract_sizes', { sizes: cs });
  const settle = {};
  for (const m of perps) settle[m.availableSettlement.length] = (settle[m.availableSettlement.length] ?? 0) + 1;
  log('perp_available_settlement_lengths', { lengths: settle });
  log('perp_fields', { keys: Object.keys(perps[0]), btc: perps.find((m) => m.symbol === 'BTC-PERP-USDT') });
  const stock = perps.filter((m) => m.category !== 'CRYPTO');
  log('perp_non_crypto', { n: stock.length, bases: stock.map((m) => m.baseCurrency).join(' '), sample: stock.slice(0, 4).map((m) => `${m.symbol} ${m.category} ${m.displayName} cs=${m.contractSize}`) });

  const typed = await get(`${V1}/markets?types=${PERP_TYPES}`);
  log('markets_v1_types_filter', { status: typed.status, bytes: typed.bytes, rows: typed.json?.data?.symbols?.length });

  const ms = await get(`${LEGACY}/market_summary`);
  save('market_summary.json', ms.text);
  const legacyPerps = ms.json.filter((m) => !m.timeBasedContract);
  const tradeCurrencies = new Set(perps.map((m) => m.tradeCurrency));
  log('legacy_market_summary', {
    status: ms.status,
    bytes: ms.bytes,
    ms: round(ms.ms),
    rows: ms.json.length,
    perps: legacyPerps.length,
    dated: ms.json.filter((m) => m.timeBasedContract).map((m) => m.symbol),
    legacySymbolsInV1TradeCurrency: legacyPerps.filter((m) => tradeCurrencies.has(m.symbol)).length,
    contractSizeAgrees: legacyPerps.filter((m) => Number(perps.find((p) => p.tradeCurrency === m.symbol)?.contractSize) === m.contractSize).length,
    keys: Object.keys(ms.json[0]),
  });
}

function summarize(xs) {
  return { n: xs.length, min: round(Math.min(...xs)), median: round(pct(xs, 50)), p90: round(pct(xs, 90)), max: round(Math.max(...xs)), over1s: xs.filter((x) => x > 1000).length };
}

async function anchor() {
  const { perps } = await loadPerps();
  const t24 = await get(`${V1}/ticker/24hr?types=${PERP_TYPES}`);
  const byVol = [...t24.json.data].sort((a, b) => Number(b.volume) - Number(a.volume));
  const cat = new Map(perps.map((m) => [m.symbol, m.category]));
  const cryptoByVol = byVol.filter((r) => cat.get(r.symbol) === 'CRYPTO');
  const watch = [
    'BTC-PERP-USDT',
    'ETH-PERP-USDT',
    cryptoByVol[Math.floor(cryptoByVol.length * 0.75)].symbol,
    cryptoByVol.at(-1).symbol,
    byVol.find((r) => cat.get(r.symbol) === 'STOCK').symbol,
    byVol.find((r) => cat.get(r.symbol) === 'COMMODITIES').symbol,
  ];
  log('anchor_watch', { watch });

  const series = { indices: [], t24: [], legacy: [], summary: [] };
  const times = { indices: [], t24: [], legacy: [] };
  const sizes = { indices: 0, t24: 0, legacy: 0 };
  for (let i = 0; i < ROUNDS; i++) {
    const start = Date.now();
    const [a, b, c] = await Promise.all([
      get(`${V1}/ticker/indices?types=${PERP_TYPES}`),
      get(`${V1}/ticker/24hr?types=${PERP_TYPES}`),
      get(`${LEGACY}/price`),
    ]);
    const arrival = Date.now();
    for (const [k, r] of [['indices', a], ['t24', b], ['legacy', c]]) {
      times[k].push(r.ms);
      sizes[k] = r.bytes;
      if (r.status !== 200) log('anchor_non_200', { k, status: r.status, body: r.text.slice(0, 200) });
    }
    series.indices.push({ arrival, time: a.json?.time, rows: new Map((a.json?.data ?? []).map((x) => [x.symbol, x])) });
    series.t24.push({ arrival, time: b.json?.time, rows: new Map((b.json?.data ?? []).map((x) => [x.symbol, x])) });
    series.legacy.push({ arrival, rows: new Map((Array.isArray(c.json) ? c.json : []).map((x) => [x.symbol, x])) });
    // The legacy summary carries the funding rate too, read every tenth round to see whether it moves inside a period.
    if (i % 10 === 0) {
      const ms = await get(`${LEGACY}/market_summary`);
      series.summary.push({ arrival: Date.now(), rows: new Map((Array.isArray(ms.json) ? ms.json : []).map((x) => [x.symbol, x])) });
    }
    if (i === 0) {
      save('indices.json', a.text);
      save('t24.json', b.text);
      save('legacy_price.json', c.text);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  log('anchor_reply', {
    indices: { bytes: sizes.indices, rows: series.indices[0].rows.size, ...summarize(times.indices) },
    t24: { bytes: sizes.t24, rows: series.t24[0].rows.size, ...summarize(times.t24) },
    legacyPrice: { bytes: sizes.legacy, rows: series.legacy[0].rows.size, ...summarize(times.legacy) },
  });

  // How often each number changed between consecutive one second polls.
  const changes = (arr, sym, field) => {
    let n = 0;
    for (let i = 1; i < arr.length; i++) {
      const p = arr[i - 1].rows.get(sym)?.[field];
      const q = arr[i].rows.get(sym)?.[field];
      if (p !== undefined && q !== undefined && p !== q) n++;
    }
    return n;
  };
  for (const sym of watch) {
    const legacySym = sym.replace(/-USDT$/, '');
    const first = series.indices[0].rows.get(sym);
    log('anchor_changes', {
      sym,
      polls: ROUNDS,
      index: changes(series.indices, sym, 'indexPrice'),
      mark: changes(series.indices, sym, 'markPrice'),
      rate: changes(series.t24, sym, 'fundingRate'),
      t24last: changes(series.t24, sym, 'lastPrice'),
      t24closeTime: changes(series.t24, sym, 'closeTime'),
      legacyIndex: changes(series.legacy, legacySym, 'indexPrice'),
      legacyMark: changes(series.legacy, legacySym, 'markPrice'),
      legacyLast: changes(series.legacy, legacySym, 'lastPrice'),
      first: { index: first?.indexPrice, mark: first?.markPrice, premiumPpm: first ? round((Number(first.markPrice) / Number(first.indexPrice) - 1) * 1e6, 0) : null },
      legacyFirst: series.legacy[0].rows.get(legacySym),
    });
  }

  // Across every perpetual: the share of polls where index or mark changed, and the largest move in one poll.
  const syms = [...series.indices[0].rows.keys()];
  const idxShare = [];
  const markShare = [];
  let maxIdxMovePpm = 0;
  let maxIdxSym = '';
  for (const sym of syms) {
    idxShare.push(changes(series.indices, sym, 'indexPrice') / (ROUNDS - 1));
    markShare.push(changes(series.indices, sym, 'markPrice') / (ROUNDS - 1));
    for (let i = 1; i < ROUNDS; i++) {
      const p = Number(series.indices[i - 1].rows.get(sym)?.indexPrice);
      const q = Number(series.indices[i].rows.get(sym)?.indexPrice);
      const m = Math.abs(q / p - 1) * 1e6;
      if (p > 0 && q > 0 && m > maxIdxMovePpm) {
        maxIdxMovePpm = m;
        maxIdxSym = sym;
      }
    }
  }
  log('anchor_change_share_all', {
    perps: syms.length,
    indexChangedShare: { min: round(Math.min(...idxShare), 2), median: round(pct(idxShare, 50), 2), max: round(Math.max(...idxShare), 2) },
    markChangedShare: { min: round(Math.min(...markShare), 2), median: round(pct(markShare, 50), 2), max: round(Math.max(...markShare), 2) },
    indexNeverChanged: syms.filter((s, i) => idxShare[i] === 0).length,
    markNeverChanged: syms.filter((s, i) => markShare[i] === 0).length,
    maxIndexMovePpm: round(maxIdxMovePpm, 0),
    maxIdxSym,
  });

  // Premium of mark over index across every perpetual on the last poll, to look for a clamp.
  const last = series.indices.at(-1).rows;
  const prem = [];
  for (const [sym, r] of last) {
    const i = Number(r.indexPrice);
    const m = Number(r.markPrice);
    if (i > 0 && m > 0) prem.push({ sym, ppm: round((m / i - 1) * 1e6, 0) });
  }
  prem.sort((a, b) => a.ppm - b.ppm);
  const absPpm = prem.map((p) => Math.abs(p.ppm));
  const counts = {};
  for (const p of prem) counts[p.ppm] = (counts[p.ppm] ?? 0) + 1;
  log('mark_premium_last_poll', {
    n: prem.length,
    zeroIndexOrMark: last.size - prem.length,
    lowest: prem.slice(0, 5),
    highest: prem.slice(-5),
    medianAbsPpm: pct(absPpm, 50),
    p90AbsPpm: pct(absPpm, 90),
    repeatedValues: Object.entries(counts).filter(([, n]) => n > 2),
  });

  // The legacy markPrice against the v1 markPrice and the legacy lastPrice, on the last poll.
  let legacyMarkEqLast = 0;
  let legacyMarkEqV1 = 0;
  let n = 0;
  for (const [sym, r] of series.legacy.at(-1).rows) {
    const v1 = last.get(`${sym}-USDT`);
    if (!v1 || !sym.includes('PERP')) continue;
    n++;
    if (r.markPrice === r.lastPrice) legacyMarkEqLast++;
    if (Math.abs(r.markPrice / Number(v1.markPrice) - 1) < 1e-9) legacyMarkEqV1++;
  }
  log('legacy_mark_vs_v1', { perps: n, legacyMarkEqualsLegacyLast: legacyMarkEqLast, legacyMarkEqualsV1Mark: legacyMarkEqV1 });

  // Freshness: the reply `time` against arrival, and how often 24hr closeTime moved.
  // When the markets v1 index and mark change, and how far behind the legacy price call their value is.
  for (const sym of watch.slice(0, 3)) {
    const legacySym = sym.replace(/-USDT$/, '');
    const changeAt = [];
    const lagMs = [];
    for (let i = 1; i < ROUNDS; i++) {
      const v = series.indices[i].rows.get(sym)?.indexPrice;
      if (v === series.indices[i - 1].rows.get(sym)?.indexPrice) continue;
      changeAt.push(new Date(series.indices[i].arrival).toISOString().slice(11, 23));
      for (let j = i; j >= 0; j--) {
        const l = series.legacy[j].rows.get(legacySym)?.indexPrice;
        if (l !== undefined && Math.abs(l / Number(v) - 1) < 1e-9) {
          lagMs.push(series.indices[i].arrival - series.legacy[j].arrival);
          break;
        }
      }
    }
    log('v1_index_change_times', { sym, changeAt, lagBehindLegacyMs: lagMs });
  }
  // At each markets v1 refresh, compare its mark with the legacy mark and last read in the same round, over every perpetual.
  for (let i = 1; i < ROUNDS; i++) {
    if (series.indices[i].rows.get('BTC-PERP-USDT')?.indexPrice === series.indices[i - 1].rows.get('BTC-PERP-USDT')?.indexPrice) continue;
    let n = 0;
    let idxEq = 0;
    let markEq = 0;
    let markEqLegacyLast = 0;
    const diffs = [];
    for (const [sym, r] of series.indices[i].rows) {
      const l = series.legacy[i].rows.get(sym.replace(/-USDT$/, ''));
      if (!l) continue;
      n++;
      if (Math.abs(l.indexPrice / Number(r.indexPrice) - 1) < 1e-9) idxEq++;
      if (Math.abs(l.markPrice / Number(r.markPrice) - 1) < 1e-9) markEq++;
      if (Math.abs(l.lastPrice / Number(r.markPrice) - 1) < 1e-9) markEqLegacyLast++;
      diffs.push(Math.abs(l.markPrice / Number(r.markPrice) - 1) * 1e6);
    }
    log('v1_refresh_vs_legacy_same_round', { at: new Date(series.indices[i].arrival).toISOString().slice(11, 23), perps: n, indexEqual: idxEq, markEqual: markEq, v1MarkEqualsLegacyLast: markEqLegacyLast, markDiffPpm: { median: round(pct(diffs, 50), 0), p90: round(pct(diffs, 90), 0), max: round(Math.max(...diffs), 0) } });
  }
  const rateChanges = {};
  for (const sym of watch) {
    const legacySym = sym.replace(/-USDT$/, '');
    rateChanges[legacySym] = series.summary.map((x) => x.rows.get(legacySym)?.fundingRate);
  }
  log('legacy_summary_rate_every_10s', rateChanges);
  const lag = series.indices.map((s) => s.arrival - s.time).filter(Number.isFinite);
  log('indices_reply_time_vs_arrival_ms', { median: pct(lag, 50), min: Math.min(...lag), max: Math.max(...lag) });
  const t24Last = series.t24.at(-1).rows;
  const nft = {};
  for (const r of t24Last.values()) {
    const k = `${r.fundingIntervalMinutes}|${r.nextFundingTime}`;
    nft[k] = (nft[k] ?? 0) + 1;
  }
  log('t24_interval_next_funding', { at: new Date().toISOString(), groups: nft });
}

async function funding() {
  const { perps } = await loadPerps();
  const t24 = await get(`${V1}/ticker/24hr?types=${PERP_TYPES}`);
  const cat = new Map(perps.map((m) => [m.symbol, m.category]));
  const dist = {};
  for (const r of t24.json.data) {
    const k = `${cat.get(r.symbol)}|${r.fundingIntervalMinutes}min|${r.fundingRate}`;
    dist[k] = (dist[k] ?? 0) + 1;
  }
  log('rate_by_category_interval', Object.fromEntries(Object.entries(dist).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])));
  const perCategory = {};
  for (const r of t24.json.data) {
    const c = cat.get(r.symbol);
    perCategory[c] ??= { perps: 0, zeroRate: 0, interval480: 0, interval240: 0, other: [] };
    const e = perCategory[c];
    e.perps++;
    if (Number(r.fundingRate) === 0) e.zeroRate++;
    if (r.fundingIntervalMinutes === 480) e.interval480++;
    else if (r.fundingIntervalMinutes === 240) e.interval240++;
    if (c !== 'CRYPTO' && Number(r.fundingRate) !== 0) e.other.push(`${r.symbol} ${r.fundingRate}`);
  }
  log('rate_per_category', perCategory);
  const rates = t24.json.data.map((r) => Number(r.fundingRate));
  log('rate_extremes', { min: Math.min(...rates), max: Math.max(...rates), over0005: rates.filter((x) => Math.abs(x) > 0.005).length });

  const rows = new Map(t24.json.data.map((r) => [r.symbol, r]));
  const byVol = [...t24.json.data].sort((a, b) => Number(b.volume) - Number(a.volume));
  const picks = ['BTC-PERP-USDT', 'ETH-PERP-USDT', byVol.find((r) => cat.get(r.symbol) === 'STOCK').symbol, byVol.find((r) => r.fundingIntervalMinutes === 240).symbol];
  for (const sym of picks) {
    const h = await get(`${V1}/recentFundingHistory?symbol=${sym}&period=7D`);
    const data = h.json?.data ?? [];
    const gaps = data.slice(1).map((x, i) => (x.timestamp - data[i].timestamp) / 3.6e6);
    const gapCounts = {};
    for (const g of gaps) gapCounts[round(g, 3)] = (gapCounts[round(g, 3)] ?? 0) + 1;
    const cur = rows.get(sym);
    log('funding_history_v1', {
      sym,
      status: h.status,
      rows: data.length,
      gapHours: gapCounts,
      msOffsets: [...new Set(data.map((x) => x.timestamp % 1000))].slice(0, 5),
      last3: data.slice(-3),
      rateValues: [...new Set(data.map((x) => x.rate))].length,
      current: { fundingRate: cur?.fundingRate, nextFundingTime: cur?.nextFundingTime, intervalMin: cur?.fundingIntervalMinutes },
      currentEqualsLastSettled: cur?.fundingRate === data.at(-1)?.rate,
    });
    const legacy = await get(`${LEGACY}/funding_history?symbol=${sym.replace(/-USDT$/, '')}`);
    const lj = legacy.json;
    const lrows = Array.isArray(lj) ? lj : lj && typeof lj === 'object' ? Object.values(lj).flat() : [];
    log('funding_history_legacy', { sym: sym.replace(/-USDT$/, ''), status: legacy.status, bytes: legacy.bytes, shape: Array.isArray(lj) ? 'array' : typeof lj, keys: lj && !Array.isArray(lj) ? Object.keys(lj).slice(0, 5) : null, rows: lrows.length, last: lrows.slice(-2) });
    await sleep(400);
  }
}

async function book() {
  for (const depth of [5, 20, 50, 51, 100, 500]) {
    const r = await get(`${V1}/orderbook?symbol=BTC-PERP-USDT&depth=${depth}`);
    const d = r.json?.data;
    const desc = (xs = []) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) > Number(x[0]));
    const asc = (xs = []) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) < Number(x[0]));
    if (!d?.bids) {
      log('book_v1_refused', { depth, status: r.status, body: r.text.slice(0, 240) });
      await sleep(300);
      continue;
    }
    log('book_v1', {
      depth,
      status: r.status,
      bytes: r.bytes,
      ms: round(r.ms),
      bids: d?.bids?.length,
      asks: d?.asks?.length,
      bidsDesc: d ? desc(d.bids) : null,
      asksAsc: d ? asc(d.asks) : null,
      asksDesc: d ? desc(d.asks) : null,
      firstAsk: d?.asks?.[0],
      lastAsk: d?.asks?.at(-1),
      firstBid: d?.bids?.[0],
      replyAgeMs: d ? r.json.time - d.timestamp : null,
    });
    await sleep(300);
  }
  const noDepth = await get(`${V1}/orderbook?symbol=BTC-PERP-USDT`);
  log('book_v1_default_depth', { bids: noDepth.json?.data?.bids?.length, asks: noDepth.json?.data?.asks?.length });
  for (const depth of [20, 100]) {
    const r = await get(`${LEGACY}/orderbook/L2?symbol=BTC-PERP&depth=${depth}`);
    const j = r.json;
    log('book_legacy_L2', {
      depth,
      status: r.status,
      bytes: r.bytes,
      keys: j ? Object.keys(j) : null,
      bids: j?.buyQuote?.length,
      asks: j?.sellQuote?.length,
      firstBuy: j?.buyQuote?.[0],
      firstSell: j?.sellQuote?.[0],
      lastSell: j?.sellQuote?.at(-1),
      timestamp: j?.timestamp,
    });
    await sleep(300);
  }
  // Two reads 100 ms apart show whether the book is cached.
  const a = await get(`${V1}/orderbook?symbol=BTC-PERP-USDT&depth=20`);
  await sleep(100);
  const b = await get(`${V1}/orderbook?symbol=BTC-PERP-USDT&depth=20`);
  log('book_cache', { ts1: a.json?.data?.timestamp, ts2: b.json?.data?.timestamp, same: a.text === b.text, cacheHeaders: [a.headers['cache-control'], a.headers['cf-cache-status'], a.headers.age] });
}

async function errors() {
  const cases = [
    ['unknown symbol, orderbook', `${V1}/orderbook?symbol=NOPE-PERP-USDT`],
    ['missing symbol, orderbook', `${V1}/orderbook`],
    ['unknown symbol, indices', `${V1}/ticker/indices?symbol=NOPE-PERP-USDT`],
    ['bad types, indices', `${V1}/ticker/indices?types=NOPE`],
    ['missing period, funding history', `${V1}/recentFundingHistory?symbol=BTC-PERP-USDT`],
    ['unknown path', `${V1}/nope`],
    ['legacy unknown symbol, price', `${LEGACY}/price?symbol=NOPE-PERP`],
    ['legacy unknown symbol, L2', `${LEGACY}/orderbook/L2?symbol=NOPE-PERP`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, body: r.text.slice(0, 240) });
    await sleep(300);
  }
  const r = await get(`${V1}/ticker/indices?symbol=BTC-PERP-USDT`);
  log('response_headers', { headers: Object.keys(r.headers), rateLike: Object.fromEntries(Object.entries(r.headers).filter(([k]) => /rate|limit|retry|remaining/i.test(k))) });
}

async function time() {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/spot/api/v3.3/time`);
    const t1 = Date.now();
    const server = Date.parse(r.json.iso);
    samples.push({ rtt: t1 - t0, offsetMs: server - (t0 + t1) / 2 });
    await sleep(300);
  }
  log('server_time', { body: (await get(`${API}/spot/api/v3.3/time`)).text, samples });
}

const mode = process.argv[2] ?? 'all';
const steps = { host, catalog, anchor, funding, book, errors, time };
for (const [name, fn] of Object.entries(steps)) {
  if (mode === 'all' || mode === name) {
    log('step', { name, at: new Date().toISOString() });
    await fn();
  }
}
