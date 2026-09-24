// Mercado Bitcoin REST probe: host and latency, the spot catalog and how CCXT maps it, the REST book, the bulk ticker cadence, error shapes and clock offset.
// Public, unauthenticated, read-only. The v4 API documents 1 request per second per public endpoint and 500 per minute in total, so every request here waits 1.1 s after the previous one.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/mercado/rest-probe.mjs [catalog|book|ticker|errors]
//   catalog  DNS, one cold and five warm v4 symbols calls, the legacy v3 coins list, then CCXT 4.5.68 loadMarkets and its market fields. About 15 s, 9 requests.
//   book     v4 orderbook at several limits, level order, age of its timestamp, ten polls for caching, the legacy v3 book, ticker compare. About 30 s, 20 requests.
//   ticker   the bulk v4 tickers call for every CRYPTO symbol every 1.1 s for 30 polls: reply time, size, and how often each field changes. About 35 s.
//   errors   unknown symbol, bad limit, missing parameter, unknown path, an empty book, legacy unknown coin, and the clock offset from the Date header. About 13 s, 11 requests.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/mercado/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const V4 = 'https://api.mercadobitcoin.net/api/v4';
const V3 = 'https://www.mercadobitcoin.net/api';
const SPACING_MS = 1_100;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

let lastRequestAt = 0;

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'User-Agent': 'arbitrage-observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers, recvAt: Date.now() };
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function catalog() {
  for (const host of ['api.mercadobitcoin.net', 'www.mercadobitcoin.net', 'ws.mercadobitcoin.net']) {
    const a = await dns.resolve4(host).catch((e) => [String(e.code)]);
    log('dns', { host, a });
  }

  const times = [];
  let symbols;
  for (let i = 0; i < 6; i++) {
    const r = await get(`${V4}/symbols`);
    times.push(r.ms);
    if (i === 0) {
      symbols = r.json;
      keep('symbols.json', r.text);
      log('symbols_first', { status: r.status, ms: r.ms, bytes: r.bytes, cfRay: r.headers.get('cf-ray') });
    }
  }
  log('symbols_warm', { ms: times.slice(1) });

  const n = symbols.symbol.length;
  const byType = {};
  const byQuote = {};
  const crypto = [];
  for (let i = 0; i < n; i++) {
    byType[symbols.type[i]] = (byType[symbols.type[i]] ?? 0) + 1;
    byQuote[symbols.currency[i]] = (byQuote[symbols.currency[i]] ?? 0) + 1;
    if (symbols.type[i] === 'CRYPTO') crypto.push(symbols.symbol[i]);
  }
  const notTraded = symbols.symbol.filter((_, i) => symbols['exchange-traded'][i] !== true);
  const nonBrl = symbols.symbol.filter((_, i) => symbols.currency[i] !== 'BRL');
  log('v4_catalog', { rows: n, byType, byQuote, notTraded: notTraded.length, nonBrl, fields: Object.keys(symbols) });

  const coins = await get(`${V3}/coins`);
  keep('coins.json', coins.text);
  log('v3_coins', { status: coins.status, ms: coins.ms, rows: coins.json.length });

  const ex = new ccxt.mercado();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  log('ccxt_load', { ms: Math.round(performance.now() - t0), markets: list.length });
  const count = (pred) => list.filter(pred).length;
  log('ccxt_types', {
    spot: count((m) => m.spot),
    swap: count((m) => m.swap),
    future: count((m) => m.future),
    activeTrue: count((m) => m.active === true),
    activeFalse: count((m) => m.active === false),
    activeUndefined: count((m) => m.active === undefined),
    quotes: [...new Set(list.map((m) => m.quote))],
    takers: [...new Set(list.map((m) => m.taker))],
    makers: [...new Set(list.map((m) => m.maker))],
    contractSizes: [...new Set(list.map((m) => m.contractSize))],
    linear: [...new Set(list.map((m) => m.linear))],
  });
  const btc = markets['BTC/BRL'];
  log('ccxt_btc', {
    id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, baseId: btc.baseId, type: btc.type,
    active: btc.active, taker: btc.taker, maker: btc.maker, contractSize: btc.contractSize, precision: btc.precision,
  });

  const v4Base = new Map();
  for (let i = 0; i < n; i++) if (symbols.currency[i] === 'BRL') v4Base.set(symbols['base-currency'][i], symbols.type[i]);
  const ccxtByV4Type = {};
  let absentFromV4 = 0;
  for (const m of list) {
    const t = v4Base.get(m.baseId);
    if (t === undefined) absentFromV4++;
    else ccxtByV4Type[t] = (ccxtByV4Type[t] ?? 0) + 1;
  }
  const idMatchesWs = list.filter((m) => m.id === `BRL${m.baseId}`).length;
  log('ccxt_vs_v4', { ccxtByV4Type, absentFromV4, idIsBrlPlusBase: idMatchesWs, v4CryptoSymbols: crypto.length });
}

function sideOrder(levels) {
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (b > a) asc++;
    else if (b < a) desc++;
  }
  return asc && !desc ? 'ascending' : desc && !asc ? 'descending' : `mixed ${asc}/${desc}`;
}

async function book() {
  const pairs = ['BTC-BRL', 'ETH-BRL', 'USDT-BRL', 'COMP-BRL'];
  for (const limit of [undefined, '10', '20', '200', '1000']) {
    const url = `${V4}/BTC-BRL/orderbook${limit ? `?limit=${limit}` : ''}`;
    const r = await get(url);
    const j = r.json;
    keep(`book_btc_${limit ?? 'none'}.json`, r.text);
    log('v4_book_limit', {
      limit: limit ?? 'none', status: r.status, ms: r.ms, bytes: r.bytes, bids: j.bids?.length, asks: j.asks?.length,
      bidOrder: sideOrder(j.bids ?? []), askOrder: sideOrder(j.asks ?? []),
      bid0: j.bids?.[0], ask0: j.asks?.[0], tsType: typeof j.timestamp, ts: j.timestamp,
      ageMs: typeof j.timestamp === 'number' ? r.recvAt - Math.round(j.timestamp / 1e6) : undefined,
      levelTypes: j.bids?.[0]?.map((x) => typeof x),
    });
  }
  for (const p of pairs.slice(1)) {
    const r = await get(`${V4}/${p}/orderbook?limit=20`);
    const j = r.json;
    log('v4_book_pair', {
      pair: p, status: r.status, ms: r.ms, bids: j.bids?.length, asks: j.asks?.length, bidOrder: sideOrder(j.bids ?? []),
      askOrder: sideOrder(j.asks ?? []), bid0: j.bids?.[0], ask0: j.asks?.[0],
      ageMs: typeof j.timestamp === 'number' ? r.recvAt - Math.round(j.timestamp / 1e6) : undefined,
    });
  }

  const seen = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${V4}/BTC-BRL/orderbook?limit=20`);
    const j = r.json;
    seen.push({ ms: r.ms, ts: j.timestamp, age: r.recvAt - Math.round(j.timestamp / 1e6), top: `${j.bids[0]?.[0]}/${j.asks[0]?.[0]}`, cf: r.headers.get('cf-cache-status') });
  }
  log('v4_book_polls', {
    ms: seen.map((s) => s.ms), ageMs: seen.map((s) => s.age), distinctTs: new Set(seen.map((s) => s.ts)).size,
    distinctTop: new Set(seen.map((s) => s.top)).size, cache: [...new Set(seen.map((s) => s.cf))],
  });

  const v3 = await get(`${V3}/BTC/orderbook/`);
  const j3 = v3.json;
  log('v3_book', {
    status: v3.status, ms: v3.ms, bytes: v3.bytes, bids: j3.bids?.length, asks: j3.asks?.length,
    bidOrder: sideOrder(j3.bids ?? []), askOrder: sideOrder(j3.asks ?? []), bid0: j3.bids?.[0], ask0: j3.asks?.[0],
    keys: Object.keys(j3), levelTypes: j3.bids?.[0]?.map((x) => typeof x),
  });

  const t = await get(`${V4}/tickers?symbols=BTC-BRL`);
  const b = await get(`${V4}/BTC-BRL/orderbook?limit=1`);
  log('ticker_vs_book', { ticker: t.json[0], bookTop: [b.json.bids?.[0], b.json.asks?.[0]] });
}

async function ticker() {
  const s = (await get(`${V4}/symbols`)).json;
  const crypto = s.symbol.filter((_, i) => s.type[i] === 'CRYPTO');
  const url = `${V4}/tickers?symbols=${crypto.join(',')}`;
  log('ticker_setup', { symbols: crypto.length, urlLength: url.length });

  const polls = [];
  let prev;
  const changes = {};
  const watch = ['BTC-BRL', 'ETH-BRL', 'USDT-BRL', 'SOL-BRL', 'COMP-BRL'];
  const perPair = Object.fromEntries(watch.map((p) => [p, { buy: 0, sell: 0, last: 0, vol: 0, date: 0 }]));
  let anyChanged = 0;
  let zeroLast = 0;
  let sides;
  const dateAges = [];
  for (let i = 0; i < 30; i++) {
    const r = await get(url);
    polls.push({ ms: r.ms, bytes: r.bytes, rows: r.json.length, status: r.status });
    const rows = new Map(r.json.map((x) => [x.pair, x]));
    if (i === 0) {
      keep('tickers_first.json', r.text);
      zeroLast = r.json.filter((x) => Number(x.last) === 0).length;
      const b0 = (x) => Number(x.buy) === 0;
      const s0 = (x) => Number(x.sell) === 0;
      sides = { buyZero: r.json.filter(b0).length, sellZero: r.json.filter(s0).length, bothZero: r.json.filter((x) => b0(x) && s0(x)).length, anyZero: r.json.filter((x) => b0(x) || s0(x)).length };
      for (const x of r.json) dateAges.push(Math.round(r.recvAt / 1000) - x.date);
    }
    if (prev) {
      const changedPairs = new Set();
      for (const [pair, row] of rows) {
        const p = prev.get(pair);
        if (!p) continue;
        for (const f of ['buy', 'sell', 'last', 'vol', 'date']) {
          if (row[f] !== p[f]) {
            changes[f] = (changes[f] ?? 0) + 1;
            if (f !== 'date') changedPairs.add(pair);
            if (perPair[pair]) perPair[pair][f]++;
          }
        }
      }
      anyChanged = Math.max(anyChanged, changedPairs.size);
    }
    prev = rows;
  }
  const ms = polls.map((p) => p.ms);
  log('ticker_polls', {
    polls: polls.length, statuses: [...new Set(polls.map((p) => p.status))], rows: [...new Set(polls.map((p) => p.rows))],
    bytes: [Math.min(...polls.map((p) => p.bytes)), Math.max(...polls.map((p) => p.bytes))],
    ms: { min: Math.min(...ms), median: pct(ms, 50), p90: pct(ms, 90), max: Math.max(...ms) },
  });
  log('ticker_changes', { intervals: polls.length - 1, fieldChangesAllRows: changes, maxRowsChangedInOneInterval: anyChanged, perPair });
  log('ticker_first_reply', { rowsWithLastZero: zeroLast, ...sides, dateAgeSecMin: Math.min(...dateAges), dateAgeSecMax: Math.max(...dateAges), dateAgeSecMedian: pct(dateAges, 50) });
}

async function errors() {
  const cases = [
    ['v4 unknown symbol book', `${V4}/NOPE-BRL/orderbook`],
    ['v4 lowercase symbol book', `${V4}/btc-brl/orderbook?limit=1`],
    ['v4 ws spelling book', `${V4}/BRLBTC/orderbook?limit=1`],
    ['v4 limit 5000', `${V4}/BTC-BRL/orderbook?limit=5000`],
    ['v4 limit abc', `${V4}/BTC-BRL/orderbook?limit=abc`],
    ['v4 tickers unknown', `${V4}/tickers?symbols=NOPE-BRL`],
    ['v4 tickers mixed', `${V4}/tickers?symbols=BTC-BRL,NOPE-BRL`],
    ['v4 unknown path', `${V4}/nope`],
    ['v4 tickers without symbols', `${V4}/tickers`],
    ['v4 empty book', `${V4}/CLV-BRL/orderbook?limit=5`],
    ['v3 unknown coin', `${V3}/NOPE/orderbook/`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    const hdr = {};
    for (const h of ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'ratelimit-limit', 'content-type']) {
      if (r.headers.get(h)) hdr[h] = r.headers.get(h);
    }
    const date = Date.parse(r.headers.get('date'));
    log('error_case', {
      name, status: r.status, ms: r.ms, body: r.text.slice(0, 200), hdr,
      dateOffsetMs: Number.isFinite(date) ? date - r.recvAt : undefined,
    });
  }
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, book, ticker, errors }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
