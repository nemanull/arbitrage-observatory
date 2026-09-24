// BigONE contract REST probe: host and latency, the CCXT catalog against the venue's symbols call, the instruments anchor call polled at one hertz, the REST book, error shapes and server time.
// Public, unauthenticated and read-only.
// Every loop keeps at least one second between two requests to the same endpoint, far under the published 500 requests per 10 s per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bigone/rest-probe.mjs [catalog|anchor|book|errors|time|all]
//   catalog  DNS, cold and warm request time, symbols and instruments, CCXT loadMarkets, about 15 s
//   anchor   instruments polled once a second for 60 rounds, change counts and the mark formula check, about 65 s
//   book     REST depth snapshot on four contracts, level counts, key order on the wire, caching, about 10 s
//   errors   unknown and disabled symbols, unknown paths, undocumented paths CCXT lists, about 10 s
//   time     server time from /api/v3/ping against the local clock, five samples
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/bigone/rest.md and docs/profiles/bigone/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'big.one';
const CONTRACT = `https://${HOST}/api/contract/v2`;
const SPOT = `https://${HOST}/api/v3`;
const OUT = process.env.PROBE_OUT_DIR;
const BOOK_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'BTCUSD'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const stats = (xs) => ({ n: xs.length, min: pct(xs, 0), median: pct(xs, 50), p90: pct(xs, 90), max: pct(xs, 100) });
const r1 = (x) => Math.round(x * 10) / 10;

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers });
  const text = await res.text();
  const ms = performance.now() - t0;
  const pick = {};
  for (const h of ['date', 'server-timing', 'cache-control', 'age', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'content-encoding', 'x-envoy-upstream-service-time']) {
    const v = res.headers.get(h);
    if (v !== null) pick[h] = v;
  }
  return { status: res.status, text, ms, headers: pick, bytes: Buffer.byteLength(text) };
}

async function catalog() {
  const addrs = await dns.lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });

  const cold = await get(`${CONTRACT}/symbols`, { connection: 'close' });
  const warm = [];
  for (let i = 0; i < 5; i++) {
    warm.push((await get(`${CONTRACT}/symbols`)).ms);
    await sleep(1000);
  }
  log('symbols_time', { coldMs: r1(cold.ms), warm: stats(warm.map(r1)), bytes: cold.bytes, headers: cold.headers });

  const symbols = JSON.parse(cold.text);
  keep('symbols.json', cold.text);
  const ins = await get(`${CONTRACT}/instruments`);
  const instruments = JSON.parse(ins.text);
  keep('instruments.json', ins.text);
  log('instruments_size', { status: ins.status, bytes: ins.bytes, rows: instruments.length, ms: r1(ins.ms) });

  const families = {};
  const types = {};
  for (const s of symbols) {
    const k = `settle=${s.settleCurrency} quote=${s.quoteCurrency} inverse=${s.isInverse} enable=${s.enable}`;
    families[k] = (families[k] ?? 0) + 1;
    types[s.type] = (types[s.type] ?? 0) + 1;
  }
  log('symbols_families', { total: symbols.length, families, types });
  log('symbols_disabled', { symbols: symbols.filter((s) => !s.enable).map((s) => s.symbol) });
  const insSet = new Set(instruments.map((i) => i.symbol));
  log('instruments_vs_symbols', {
    enabledNotInInstruments: symbols.filter((s) => s.enable && !insSet.has(s.symbol)).map((s) => s.symbol),
    disabledInInstruments: symbols.filter((s) => !s.enable && insSet.has(s.symbol)).map((s) => s.symbol),
    instrumentsNotInSymbols: instruments.filter((i) => !symbols.some((s) => s.symbol === i.symbol)).map((i) => i.symbol),
  });
  const mults = {};
  for (const s of symbols) mults[s.multiplier] = (mults[s.multiplier] ?? 0) + 1;
  log('multipliers', { counts: mults, samples: ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'XAUUSDT', 'TSLAUSDT', 'XAGUSDT', 'BTCUSD', 'ETHUSD'].map((id) => { const s = symbols.find((x) => x.symbol === id); return s ? `${id}=${s.multiplier}` : `${id}=absent`; }) });
  const bases = {};
  for (const s of symbols) if (s.enable) (bases[s.baseCurrency] ??= []).push(s.symbol);
  log('listed_twice', { bases: Object.entries(bases).filter(([, v]) => v.length > 1) });
  const nft = {};
  for (const i of instruments) nft[i.nextFundingTime] = (nft[i.nextFundingTime] ?? 0) + 1;
  log('next_funding_time', { distinct: Object.entries(nft).map(([t, n]) => `${new Date(Number(t)).toISOString()} x${n}`) });
  log('instrument_zero_fields', {
    markZero: instruments.filter((i) => !(i.markPrice > 0)).map((i) => i.symbol),
    indexZero: instruments.filter((i) => !(i.indexPrice > 0)).map((i) => i.symbol),
    rateDiffersFromNext: instruments.filter((i) => i.fundingRate !== i.nextFundingRate).length,
    types: [...new Set(instruments.flatMap((i) => Object.values(i).map((v) => typeof v)))],
  });

  const ex = new ccxt.bigone();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.type === 'swap' && m.swap === true);
  const active = swaps.filter((m) => m.active !== false);
  const takers = {};
  const makers = {};
  for (const m of swaps) {
    takers[m.taker] = (takers[m.taker] ?? 0) + 1;
    makers[m.maker] = (makers[m.maker] ?? 0) + 1;
  }
  const symById = new Map(symbols.map((s) => [s.symbol, s]));
  log('ccxt', {
    version: ccxt.version,
    ms: Math.round(performance.now() - t0),
    markets: all.length,
    spot: all.filter((m) => m.spot).length,
    swaps: swaps.length,
    activeSwaps: active.length,
    linear: active.filter((m) => m.linear === true).length,
    inverse: active.filter((m) => m.inverse === true).length,
    takers,
    makers,
    idInInstruments: active.filter((m) => insSet.has(m.id)).length,
    contractSizeEqualsMultiplier: active.filter((m) => m.contractSize === symById.get(m.id)?.multiplier).length,
    samples: ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'BTC/USD:BTC'].map((s) => markets[s] ? { symbol: s, id: markets[s].id, contractSize: markets[s].contractSize, linear: markets[s].linear, taker: markets[s].taker, maker: markets[s].maker, active: markets[s].active } : { symbol: s, absent: true }),
    inactive: swaps.filter((m) => m.active === false).map((m) => m.id),
  });
}

async function anchor() {
  const prev = new Map();
  const changes = new Map();
  const indexChangeAt = new Map(); // symbol to the arrival times of polls whose index differed from the previous poll
  const times = [];
  const cache = {};
  const fits = [];
  let bytes = 0;
  const ROUNDS = 60;
  for (let round = 0; round < ROUNDS; round++) {
    const started = Date.now();
    const r = await get(`${CONTRACT}/instruments`);
    times.push(r1(r.ms));
    bytes = r.bytes;
    const c = /cdn-cache; desc=([A-Z_]+)/.exec(r.headers['server-timing'] ?? '')?.[1] ?? 'none';
    cache[c] = (cache[c] ?? 0) + 1;
    const now = Date.now();
    for (const i of JSON.parse(r.text)) {
      const p = prev.get(i.symbol);
      const ch = changes.get(i.symbol) ?? { index: 0, mark: 0, rate: 0, next: 0, time: 0, last: 0 };
      if (p) {
        if (p.indexPrice !== i.indexPrice) {
          ch.index++;
          (indexChangeAt.get(i.symbol) ?? indexChangeAt.set(i.symbol, []).get(i.symbol)).push(now);
        }
        if (p.markPrice !== i.markPrice) ch.mark++;
        if (p.fundingRate !== i.fundingRate) ch.rate++;
        if (p.nextFundingRate !== i.nextFundingRate) ch.next++;
        if (p.nextFundingTime !== i.nextFundingTime) ch.time++;
        if (p.latestPrice !== i.latestPrice) ch.last++;
      }
      changes.set(i.symbol, ch);
      prev.set(i.symbol, i);
      // Fair Price = Index * (1 + rate * timeUntil / interval), so interval = rate * timeUntil / (mark / index - 1).
      if (round === ROUNDS - 1 && i.indexPrice > 0 && i.fundingRate !== 0) {
        const basis = i.markPrice / i.indexPrice - 1;
        const untilH = (i.nextFundingTime - now) / 3_600_000;
        fits.push({ s: i.symbol, basisPpm: Math.round(basis * 1e6), ratePpm: Math.round(i.fundingRate * 1e6), nextPpm: Math.round(i.nextFundingRate * 1e6), untilH: Math.round(untilH * 100) / 100, impliedIntervalH: basis !== 0 ? Math.round(((i.fundingRate * untilH) / basis) * 100) / 100 : null });
      }
    }
    const wait = 1000 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  log('anchor_poll', { rounds: ROUNDS, bytes, ms: stats(times), cdnCache: cache });
  const sums = { index: 0, mark: 0, rate: 0, next: 0, time: 0, last: 0 };
  for (const ch of changes.values()) for (const k of Object.keys(sums)) sums[k] += ch[k];
  log('anchor_changes_total', { symbols: changes.size, polls: ROUNDS - 1, sums });
  for (const s of ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'XAUUSDT', 'BTCUSD']) if (changes.has(s)) log('anchor_changes', { symbol: s, ...changes.get(s) });
  const gaps = [];
  for (const [s, ts] of indexChangeAt) {
    const g = ts.slice(1).map((t, k) => Math.round((t - ts[k]) / 100) / 10);
    gaps.push(...g);
    if (['BTCUSDT', 'ETHUSDT', 'XAUUSDT', 'TSLAUSDT'].includes(s)) log('index_change_gaps_s', { symbol: s, gaps: g });
  }
  log('index_change_gaps_all_s', stats(gaps));
  const idxZero = [...changes.entries()].filter(([, c]) => c.index === 0).map(([s]) => s);
  const markZero = [...changes.entries()].filter(([, c]) => c.mark === 0).map(([s]) => s);
  log('anchor_static', { indexNeverChanged: idxZero.length, markNeverChanged: markZero.length, examples: idxZero.slice(0, 12) });
  const intervals = fits.filter((f) => f.impliedIntervalH !== null).map((f) => f.impliedIntervalH);
  const buckets = {};
  for (const h of intervals) {
    const b = h > 0 && h < 1.5 ? '~1h' : h >= 3 && h < 5 ? '~4h' : h >= 7 && h < 9 ? '~8h' : 'other';
    buckets[b] = (buckets[b] ?? 0) + 1;
  }
  log('mark_formula', { withRate: fits.length, impliedIntervalBuckets: buckets, other: fits.filter((f) => f.impliedIntervalH === null || !(f.impliedIntervalH > 0 && f.impliedIntervalH < 1.5) && !(f.impliedIntervalH >= 3 && f.impliedIntervalH < 5) && !(f.impliedIntervalH >= 7 && f.impliedIntervalH < 9)).map((f) => `${f.s} basis ${f.basisPpm} rate ${f.ratePpm} implied ${f.impliedIntervalH}`) });
  log('mark_formula_4h', { symbols: fits.filter((f) => f.impliedIntervalH >= 3 && f.impliedIntervalH < 5).map((f) => f.s) });
  log('mark_formula_1h', { symbols: fits.filter((f) => f.impliedIntervalH > 0 && f.impliedIntervalH < 1.5).map((f) => f.s) });
  log('mark_formula_samples', { rows: fits.filter((f) => ['BTCUSDT', 'ETHUSDT', 'XAUUSDT', 'SKRUSDT', 'HYPEUSDT', 'BTCUSD'].includes(f.s)) });
  const last = [...prev.values()];
  const premium = last.filter((i) => i.indexPrice > 0).map((i) => Math.abs(i.markPrice / i.indexPrice - 1) * 1e6);
  log('mark_premium_abs_ppm', stats(premium.map(Math.round)));
  const lastVsMark = last.filter((i) => i.markPrice > 0 && i.latestPrice > 0).map((i) => Math.round(Math.abs(i.latestPrice / i.markPrice - 1) * 1e6));
  log('last_vs_mark_abs_ppm', stats(lastVsMark));
  const rates = last.map((i) => i.fundingRate);
  log('funding_rate_range', { min: Math.min(...rates), max: Math.max(...rates), atMin: last.filter((i) => i.fundingRate === Math.min(...rates)).map((i) => i.symbol).slice(0, 5), atMax: last.filter((i) => i.fundingRate === Math.max(...rates)).map((i) => i.symbol).slice(0, 5) });
}

function keyOrder(rawSide) {
  const keys = [...rawSide.matchAll(/"([0-9.eE+-]+)"\s*:/g)].map((m) => Number(m[1]));
  let desc = true;
  let asc = true;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] > keys[i - 1]) desc = false;
    if (keys[i] < keys[i - 1]) asc = false;
  }
  return { n: keys.length, order: desc ? 'descending' : asc ? 'ascending' : 'unordered', first: keys.slice(0, 3) };
}

async function book() {
  for (const s of BOOK_SYMBOLS) {
    const r = await get(`${CONTRACT}/depth@${s}/snapshot`);
    keep(`depth-${s}.json`, r.text);
    if (r.status !== 200) {
      log('book', { symbol: s, status: r.status, body: r.text.slice(0, 200) });
      continue;
    }
    const j = JSON.parse(r.text);
    const bidRaw = /"bids":\{[^}]*\}/.exec(r.text)?.[0] ?? '';
    const askRaw = /"asks":\{[^}]*\}/.exec(r.text)?.[0] ?? '';
    const bids = Object.keys(j.bids).map(Number);
    const asks = Object.keys(j.asks).map(Number);
    const bestBid = Math.max(...bids);
    const bestAsk = Math.min(...asks);
    const valueTypes = [...new Set([...Object.values(j.bids), ...Object.values(j.asks)].map((v) => typeof v))];
    log('book', {
      symbol: s, status: r.status, ms: r1(r.ms), bytes: r.bytes, headers: r.headers,
      keys: Object.keys(j), from: j.from, to: j.to, lastPrice: j.lastPrice, bestPrices: j.bestPrices,
      bidLevels: bids.length, askLevels: asks.length, bestBid, bestAsk,
      bestPricesMatch: Number(j.bestPrices?.bid) === bestBid && Number(j.bestPrices?.ask) === bestAsk,
      bidSpanPct: r1(((bestBid - Math.min(...bids)) / bestBid) * 100), askSpanPct: r1(((Math.max(...asks) - bestAsk) / bestAsk) * 100),
      wireBidOrder: keyOrder(bidRaw), wireAskOrder: keyOrder(askRaw), valueTypes,
      touch: { bid: j.bids[String(bestBid)] ?? j.bids[bidRaw.match(new RegExp(`"(${bestBid}[0-9.]*)"`))?.[1]], ask: j.asks[String(bestAsk)] },
    });
    await sleep(300);
  }
  const tos = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${CONTRACT}/depth@BTCUSDT/snapshot`);
    tos.push({ to: JSON.parse(r.text).to, ms: r1(r.ms), cdn: /cdn-cache; desc=([A-Z_]+)/.exec(r.headers['server-timing'] ?? '')?.[1] ?? 'none' });
    await sleep(1000);
  }
  log('book_caching', { btcusdtEverySecond: tos });
}

async function errors() {
  const cases = [
    ['depth unknown symbol', `${CONTRACT}/depth@NOPEUSDT/snapshot`],
    ['depth lowercase', `${CONTRACT}/depth@btcusdt/snapshot`],
    ['depth disabled symbol', null],
    ['unknown path', `${CONTRACT}/nope`],
    ['instruments one symbol', `${CONTRACT}/instruments@BTCUSDT`],
    ['symbols one symbol', `${CONTRACT}/symbols@BTCUSDT`],
    ['CCXT instruments/difference', `${CONTRACT}/instruments/difference`],
    ['CCXT instruments/prices', `${CONTRACT}/instruments/prices`],
    ['funding history guess', `${CONTRACT}/funding-rates?symbol=BTCUSDT`],
    ['private accounts without auth', `${CONTRACT}/accounts`],
    ['v1 instruments (web app)', `https://${HOST}/api/contract/v1/instruments`],
  ];
  const symbols = JSON.parse((await get(`${CONTRACT}/symbols`)).text);
  const disabled = symbols.find((s) => !s.enable)?.symbol;
  cases[2][1] = `${CONTRACT}/depth@${disabled}/snapshot`;
  cases[2][0] += ` ${disabled}`;
  for (const [name, url] of cases) {
    const r = await get(url);
    let shape = r.text.slice(0, 220);
    try {
      const j = JSON.parse(r.text);
      if (Array.isArray(j)) shape = `array of ${j.length}, keys ${Object.keys(j[0] ?? {}).slice(0, 8).join(',')}`;
      else if (j.bids) shape = `book with ${Object.keys(j.bids).length} bids and ${Object.keys(j.asks).length} asks, to ${j.to}`;
    } catch {}
    log('error_case', { name, url: url.replace(`https://${HOST}`, ''), status: r.status, bytes: r.bytes, body: shape });
    await sleep(400);
  }
}

async function time() {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${SPOT}/ping`);
    const t1 = Date.now();
    const j = JSON.parse(r.text);
    const serverMs = Number(BigInt(j.data?.Timestamp ?? 0) / 1000n) / 1000; // Timestamp is Unix nanoseconds
    rows.push({ body: i === 0 ? r.text : undefined, rttMs: t1 - t0, offsetMs: Math.round(serverMs - (t0 + t1) / 2) });
    await sleep(1000);
  }
  log('server_time', { rows });
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, anchor, book, errors, time };
for (const [name, fn] of Object.entries(modes)) {
  if (mode === name || mode === 'all') {
    log('mode', { name, at: new Date().toISOString() });
    await fn();
  }
}
