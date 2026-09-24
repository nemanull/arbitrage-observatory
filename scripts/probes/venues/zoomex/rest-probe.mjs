// Zoomex REST probe: host latency, perpetual catalog, bulk anchor tickers, funding history, REST book, errors, server time, the CCXT bybit class pointed at Zoomex, and a same-instant compare with Bybit's public tickers.
// Public, unauthenticated, read-only. Every mode stays far below the published 600 requests per 5 s per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/zoomex/rest-probe.mjs [catalog|anchor|funding|book|errors|time|ccxt|mirror|own]
//   catalog  instruments-info for linear, inverse and spot, status, funding interval, tags, pagination, and the overlap with Bybit's linear catalog.
//   anchor   bulk tickers for linear and inverse once a second for 60 s: reply size and time, and how often index, mark and rate change per symbol.
//   funding  funding history for an 8 h, a 4 h and a 1 h contract, the published rate against the last settled one, and four contracts' settled rates beside Bybit's.
//   book     REST orderbook at several limits, level order, and two reads 100 ms apart.
//   errors   unknown symbol, unknown category, missing parameter, and the rate limit headers.
//   time     ten server time calls and the clock offset.
//   ccxt     CCXT 4.5.68 bybit with its public host and path prefix pointed at Zoomex, loadMarkets for linear and inverse.
//   mirror   Zoomex and Bybit linear tickers fetched together five times, counting identical fields, then recent trades on three perps, and the bulk against the single symbol ticker for four perps Zoomex books itself.
//   own      every linear perp's single symbol ticker at ten a second against the bulk row, listing the perps Zoomex books itself. About 75 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/zoomex/rest.md and fees.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://openapi.zoomex.com/cloud/trade/v3/market';
const BYBIT = 'https://api.bybit.com/v5/market';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json, ms, bytes: text.length };
}

function count(list, f) {
  const m = {};
  for (const x of list) {
    const k = f(x);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

async function catalog() {
  for (const category of ['linear', 'inverse', 'spot']) {
    const r = await get(`${API}/instruments-info?category=${category}&limit=1000`);
    save(`instruments-${category}.json`, r.text);
    const list = r.json?.result?.list ?? [];
    log('instruments', {
      category,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      rows: list.length,
      cursor: r.json?.result?.nextPageCursor,
      byStatus: count(list, (x) => x.status),
      byContractType: count(list, (x) => x.contractType),
      bySettle: count(list, (x) => x.settleCoin),
      byQuote: count(list, (x) => x.quoteCoin),
      byFundingMinutes: count(list, (x) => x.fundingInterval),
    });
    if (category === 'linear') {
      const tags = count(list.flatMap((x) => x.tags ?? []), (t) => t);
      log('linear_tags', { tags });
      log('linear_offline', { rows: list.filter((x) => x.offlineTime).map((x) => `${x.symbol}:${x.offlineTime}`) });
      log('linear_scaled', { rows: list.filter((x) => /^1000+/.test(x.symbol)).map((x) => x.symbol) });
      log('linear_sample', { btc: list.find((x) => x.symbol === 'BTCUSDT') });
      const bybit = await get(`${BYBIT}/instruments-info?category=linear&limit=1000`);
      const b = new Set((bybit.json?.result?.list ?? []).map((x) => x.symbol));
      log('bybit_overlap', {
        bybitRowsFirstPage: b.size,
        zoomexOnBybit: list.filter((x) => b.has(x.symbol)).length,
        zoomexNotOnBybit: list.filter((x) => !b.has(x.symbol)).map((x) => x.symbol),
      });
    }
    if (category === 'inverse') {
      log('inverse_rows', { rows: list.map((x) => `${x.symbol}:${x.status}:${x.settleCoin}:${x.fundingInterval}`) });
    }
  }
  const pre = await get(`${API}/instruments-info?category=linear&status=PreLaunch`);
  log('prelaunch', { status: pre.status, rows: pre.json?.result?.list?.length, body: pre.text.slice(0, 160) });
  const page = await get(`${API}/instruments-info?category=linear&limit=5`);
  log('pagination', { rows: page.json?.result?.list?.length, cursor: page.json?.result?.nextPageCursor });
}

async function anchor() {
  const polls = 60;
  const prev = new Map();
  const changes = new Map();
  const times = [];
  const sizes = [];
  let inverseRows;
  for (let i = 0; i < polls; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/tickers?category=linear`);
    times.push(r.ms);
    sizes.push(r.bytes);
    if (i === 0) save('tickers-linear.json', r.text);
    const list = r.json?.result?.list ?? [];
    for (const x of list) {
      const p = prev.get(x.symbol);
      const c = changes.get(x.symbol) ?? { index: 0, mark: 0, rate: 0, next: 0, markEqLast: 0 };
      if (p) {
        if (p.indexPrice !== x.indexPrice) c.index++;
        if (p.markPrice !== x.markPrice) c.mark++;
        if (p.fundingRate !== x.fundingRate) c.rate++;
        if (p.nextFundingTime !== x.nextFundingTime) c.next++;
      }
      if (x.markPrice === x.lastPrice) c.markEqLast++;
      changes.set(x.symbol, c);
      prev.set(x.symbol, x);
    }
    if (i === 0) {
      log('tickers_first', {
        rows: list.length,
        bytes: r.bytes,
        serverTime: r.json?.time,
        localTime: t0,
        keys: Object.keys(list[0] ?? {}),
        byIntervalHour: count(list, (x) => x.fundingIntervalHour),
        byFundingCap: count(list, (x) => x.fundingCap),
        byNextFunding: count(list, (x) => x.nextFundingTime),
        markZero: list.filter((x) => !(Number(x.markPrice) > 0)).length,
        indexZero: list.filter((x) => !(Number(x.indexPrice) > 0)).map((x) => x.symbol),
        btc: list.find((x) => x.symbol === 'BTCUSDT'),
      });
      const inv = await get(`${API}/tickers?category=inverse`);
      inverseRows = inv.json?.result?.list?.length;
      log('tickers_inverse', { status: inv.status, rows: inverseRows, body: inv.text.slice(0, 200) });
      for (const s of ['BTCUSD', 'ETHUSD']) {
        const one = await get(`${API}/tickers?category=inverse&symbol=${s}`);
        log('tickers_inverse_symbol', { symbol: s, status: one.status, body: one.text.slice(0, 400) });
      }
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  const sorted = [...times].sort((a, b) => a - b);
  log('tickers_timing', {
    polls,
    min: sorted[0],
    median: sorted[polls >> 1],
    p90: sorted[Math.floor(polls * 0.9)],
    max: sorted[polls - 1],
    over1s: times.filter((t) => t > 1000).length,
    bytesMedian: [...sizes].sort((a, b) => a - b)[polls >> 1],
  });
  const all = [...changes.entries()];
  const dist = (k) => {
    const v = all.map(([, c]) => c[k]).sort((a, b) => a - b);
    return { min: v[0], median: v[v.length >> 1], p90: v[Math.floor(v.length * 0.9)], max: v[v.length - 1], zero: v.filter((x) => x === 0).length };
  };
  log('change_counts_over_59_intervals', { index: dist('index'), mark: dist('mark'), rate: dist('rate'), next: dist('next'), markEqLastPolls: dist('markEqLast') });
  for (const s of ['BTCUSDT', 'ETHUSDT', 'CHRUSDT', 'AAPLUSDT', '1000PEPEUSDT']) log('change_counts_symbol', { symbol: s, ...changes.get(s) });
}

async function funding() {
  const t = await get(`${API}/tickers?category=linear`);
  const list = t.json?.result?.list ?? [];
  const pick = (h) => list.filter((x) => x.fundingIntervalHour === h).sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h))[0];
  const symbols = ['BTCUSDT', pick('4')?.symbol, pick('1')?.symbol].filter(Boolean);
  for (const symbol of symbols) {
    const now = list.find((x) => x.symbol === symbol);
    const r = await get(`${API}/funding/history?category=linear&symbol=${symbol}&limit=6`);
    const rows = r.json?.result?.list ?? [];
    log('funding_history', {
      symbol,
      status: r.status,
      intervalHour: now?.fundingIntervalHour,
      publishedRate: now?.fundingRate,
      nextFundingTime: now?.nextFundingTime,
      fundingCap: now?.fundingCap,
      keys: Object.keys(rows[0] ?? {}),
      rows: rows.map((x) => `${x.fundingRateTimestamp}:${x.fundingRate}`),
      spacingMs: rows.slice(1).map((x, i) => Number(rows[i].fundingRateTimestamp) - Number(x.fundingRateTimestamp)),
    });
    await sleep(300);
  }
  // Settled rates beside Bybit's: the four perps Zoomex books itself against one it relays.
  for (const symbol of ['BTCUSDT', 'ETHUSDT', 'GMTUSDT', 'CHRUSDT']) {
    const [z, by] = await Promise.all([get(`${API}/funding/history?category=linear&symbol=${symbol}&limit=4`), get(`${BYBIT}/funding/history?category=linear&symbol=${symbol}&limit=4`)]);
    const zr = (z.json?.result?.list ?? []).map((x) => `${x.fundingRateTimestamp}:${x.fundingRate}`);
    const br = (by.json?.result?.list ?? []).map((x) => `${x.fundingRateTimestamp}:${x.fundingRate}`);
    log('funding_vs_bybit', { symbol, equalRows: zr.filter((x) => br.includes(x)).length, of: zr.length, zoomex: zr, bybit: br });
    await sleep(300);
  }
  const bad = await get(`${API}/funding/history?category=linear&symbol=BTCUSDT&startTime=${Date.now() - 86400000}`);
  log('funding_start_only', { status: bad.status, body: bad.text.slice(0, 200) });
}

async function book() {
  for (const limit of [1, 25, 50, 200, 500, 501]) {
    const r = await get(`${API}/orderbook?category=linear&symbol=BTCUSDT&limit=${limit}`);
    const res = r.json?.result;
    const b = res?.b ?? [];
    const a = res?.a ?? [];
    log('rest_book', {
      limit,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      bids: b.length,
      asks: a.length,
      bidsDescending: b.every((x, i) => i === 0 || Number(b[i - 1][0]) > Number(x[0])),
      asksAscending: a.every((x, i) => i === 0 || Number(a[i - 1][0]) < Number(x[0])),
      keys: Object.keys(res ?? {}),
      u: res?.u,
      seq: res?.seq,
      ts: res?.ts,
      body: r.json ? undefined : r.text.slice(0, 200),
    });
    await sleep(200);
  }
  const x = await get(`${API}/orderbook?category=linear&symbol=ETHUSDT&limit=50`);
  await sleep(100);
  const y = await get(`${API}/orderbook?category=linear&symbol=ETHUSDT&limit=50`);
  log('rest_book_repeat', { first: { u: x.json?.result?.u, ts: x.json?.result?.ts }, second: { u: y.json?.result?.u, ts: y.json?.result?.ts }, cacheControl: y.headers.get('cache-control'), age: y.headers.get('age'), xCache: y.headers.get('x-cache') });
  const inv = await get(`${API}/orderbook?category=inverse&symbol=BTCUSD&limit=5`);
  log('rest_book_inverse', { status: inv.status, body: inv.text.slice(0, 300) });
  save('book-btc-500.json', (await get(`${API}/orderbook?category=linear&symbol=BTCUSDT&limit=500`)).text);
}

async function errors() {
  const cases = [
    ['unknown symbol tickers', `${API}/tickers?category=linear&symbol=NOPEUSDT`],
    ['unknown symbol book', `${API}/orderbook?category=linear&symbol=NOPEUSDT`],
    ['unknown category', `${API}/tickers?category=option`],
    ['missing category', `${API}/tickers`],
    ['missing symbol book', `${API}/orderbook?category=linear`],
    ['spot symbol on linear', `${API}/tickers?category=linear&symbol=BTCUSDC`],
    ['unknown path', `${API}/nope`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_case', { name, status: r.status, contentType: r.headers.get('content-type'), body: r.text.slice(0, 200) });
    await sleep(250);
  }
  const r = await get(`${API}/tickers?category=linear&symbol=BTCUSDT`);
  const h = {};
  for (const [k, v] of r.headers) if (/bapi|limit|retry|cache|cf-|via|server|x-amz|akamai|traceid/i.test(k)) h[k] = v;
  log('headers', { status: r.status, headers: h });
}

async function time() {
  const offsets = [];
  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/time`);
    const t1 = Date.now();
    const server = Number(BigInt(r.json.result.timeNano) / 1000000n);
    offsets.push(server - (t0 + t1) / 2);
    rtts.push(t1 - t0);
    if (i === 0) log('time_first', { body: r.text });
    await sleep(300);
  }
  const s = [...offsets].sort((a, b) => a - b);
  log('clock', { offsetMsMedian: Math.round(s[5]), offsetMsMin: Math.round(s[0]), offsetMsMax: Math.round(s[9]), rttMin: Math.min(...rtts), rttMax: Math.max(...rtts) });
}

// The bybit class builds `urls.api.public + '/' + path` with paths spelled `v5/market/...`, and Zoomex serves the same calls under `cloud/trade/v3/market/...`.
async function ccxtCatalog() {
  const ccxt = require('ccxt');
  class Zoomex extends ccxt.bybit {
    describe() {
      return this.deepExtend(super.describe(), {
        id: 'zoomex',
        name: 'Zoomex',
        hostname: 'zoomex.com',
        urls: { api: { public: 'https://openapi.zoomex.com', spot: 'https://openapi.zoomex.com', futures: 'https://openapi.zoomex.com', v2: 'https://openapi.zoomex.com' } },
        options: { fetchMarkets: { types: ['linear', 'inverse'] } },
      });
    }
    sign(path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
      return super.sign(path.replace(/^v5\//, 'cloud/trade/v3/'), api, method, params, headers, body);
    }
  }
  const ex = new Zoomex();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const ms = Math.round(performance.now() - t0);
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.swap && m.active);
  log('ccxt_catalog', {
    version: ccxt.version,
    ms,
    markets: all.length,
    activeSwaps: swaps.length,
    linear: swaps.filter((m) => m.linear).length,
    inverse: swaps.filter((m) => m.inverse).length,
    byTaker: count(swaps, (m) => m.taker),
    byMaker: count(swaps, (m) => m.maker),
    byContractSize: count(swaps, (m) => m.contractSize),
    idNotEqualRawSymbol: swaps.filter((m) => m.id !== m.info.symbol).length,
    pairsListedTwice: Object.entries(count(swaps, (m) => `${m.base}/${m.quote}`)).filter(([, n]) => n > 1).map(([k]) => k),
  });
  for (const s of ['BTC/USDT:USDT', 'BTC/USD:BTC', '1000PEPE/USDT:USDT', 'AAPL/USDT:USDT']) {
    const m = markets[s];
    if (m) log('ccxt_market', { symbol: s, id: m.id, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, active: m.active });
  }
}

async function mirror() {
  const fields = ['indexPrice', 'markPrice', 'lastPrice', 'fundingRate', 'nextFundingTime'];
  for (let i = 0; i < 5; i++) {
    const [z, b] = await Promise.all([get(`${API}/tickers?category=linear`), get(`${BYBIT}/tickers?category=linear`)]);
    const bm = new Map((b.json?.result?.list ?? []).map((x) => [x.symbol, x]));
    const zl = z.json?.result?.list ?? [];
    const same = Object.fromEntries(fields.map((f) => [f, 0]));
    let bbo = 0;
    let bboAndSize = 0;
    let common = 0;
    let fundingCapSame = 0;
    for (const x of zl) {
      const y = bm.get(x.symbol);
      if (!y) continue;
      common++;
      for (const f of fields) if (x[f] === y[f]) same[f]++;
      if (x.bid1Price === y.bid1Price && x.ask1Price === y.ask1Price) bbo++;
      if (x.bid1Price === y.bid1Price && x.ask1Price === y.ask1Price && x.bid1Size === y.bid1Size && x.ask1Size === y.ask1Size) bboAndSize++;
      if (x.fundingCap === y.fundingCap) fundingCapSame++;
    }
    log('mirror_round', { round: i, zoomexServerTime: z.json?.time, bybitServerTime: b.json?.time, zoomexRows: zl.length, bybitRows: bm.size, common, same, bbo, bboAndSize, fundingCapSame });
    await sleep(2000);
  }
  for (const symbol of ['ETHUSDT', 'XRPUSDT', 'CHRUSDT']) {
    const [zt, bt] = await Promise.all([get(`${API}/recent-trade?category=linear&symbol=${symbol}&limit=60`), get(`${BYBIT}/recent-trade?category=linear&symbol=${symbol}&limit=60`)]);
    const bIds = new Set((bt.json?.result?.list ?? []).map((x) => x.execId));
    const zl = zt.json?.result?.list ?? [];
    log('mirror_trades', { symbol, zoomexTrades: zl.length, sharedExecIds: zl.filter((x) => bIds.has(x.execId)).length });
    await sleep(300);
  }
  // The bulk reply and a single symbol reply disagree for the perps Zoomex books itself, so both are read beside Bybit's.
  const bulk = await get(`${API}/tickers?category=linear`);
  const bulkMap = new Map((bulk.json?.result?.list ?? []).map((x) => [x.symbol, x]));
  for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'GMTUSDT', 'CHRUSDT']) {
    const [one, by] = await Promise.all([get(`${API}/tickers?category=linear&symbol=${symbol}`), get(`${BYBIT}/tickers?category=linear&symbol=${symbol}`)]);
    const pick = (x) => (x ? { mark: x.markPrice, index: x.indexPrice, rate: x.fundingRate, cap: x.fundingCap, oi: x.openInterest } : null);
    log('bulk_vs_single', { symbol, zoomexBulk: pick(bulkMap.get(symbol)), zoomexSingle: pick(one.json?.result?.list?.[0]), bybitSingle: pick(by.json?.result?.list?.[0]) });
    await sleep(300);
  }
}

// Every linear perp read one at a time at ten requests a second, to list those whose single symbol ticker is not the bulk row, which is how a perp Zoomex books itself shows on REST.
async function own() {
  const bulk = await get(`${API}/tickers?category=linear`);
  const list = bulk.json?.result?.list ?? [];
  const differ = [];
  let failed = 0;
  for (const x of list) {
    const t0 = Date.now();
    const one = await get(`${API}/tickers?category=linear&symbol=${x.symbol}`);
    const y = one.json?.result?.list?.[0];
    if (!y) failed++;
    // Open interest drifts over the 70 s read, so only a different cap or a twofold open interest counts as another market.
    else if (y.fundingCap !== x.fundingCap || Math.abs(Math.log(Number(y.openInterest) / Number(x.openInterest))) > Math.log(2)) differ.push({ symbol: x.symbol, bulkOi: x.openInterest, singleOi: y.openInterest, bulkCap: x.fundingCap, singleCap: y.fundingCap, bulkRate: x.fundingRate, singleRate: y.fundingRate });
    const wait = 100 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log('single_vs_bulk', { symbols: list.length, failed, differ: differ.length });
  for (const d of differ) log('single_differs', d);
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, funding, book, errors, time, ccxt: ccxtCatalog, mirror, own };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
