// Mudrex REST probe: host and latency, what the catalog and CCXT return without credentials, the public mark-price and price klines as an anchor, errors, headers and clock.
// Public, unauthenticated, read-only. The two catalog calls send no credential and only record the refusal.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/mudrex/rest-probe.mjs [catalog|anchor|errors|clock]
//   catalog  DNS, cold and warm kline time, GET /futures and /futures/BTCUSDT?is_symbol with no credential, CCXT 4.5.68 loadMarkets and fee constants,
//            and, when PROBE_OUT_DIR holds mudrex-symbols.json from ws-probe.mjs streams, that list against Bybit's USDT perpetuals. About 5 s.
//   anchor   bulk mark-kline and kline for 25 perpetuals once a second for 60 s: reply size and time, candle age, how often the close changes. About 65 s.
//   errors   documented error cases and guessed book, ticker and funding paths, one request each. About 10 s.
//   clock    five Date header reads against the local clock. About 3 s.
// The documented public limit is 300 requests per minute per IP, and the busiest mode, anchor, sends about 72 in a minute.
// Recorded in docs/profiles/mudrex/rest.md.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'trade.mudrex.com';
const BASE = `https://${HOST}/fapi/v1`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const nowS = () => Math.floor(Date.now() / 1000);

const ANCHOR_ASSETS = 'BTC ETH SOL XRP DOGE ADA BNB TRX AVAX LINK LTC BCH DOT SUI NEAR APT ARB OP 1000PEPE WIF TAO HBAR ENA 1000BONK ONDO'.split(' ').map((b) => `${b}/USDT`);

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function get(path, headers = {}) {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, ms: Math.round(performance.now() - started), bytes: text.length, text, headers: res.headers };
}

function interestingHeaders(h) {
  const out = {};
  for (const [k, v] of h) if (/rate|retry|limit|date|server|cache|age|via|cf-pop|kong/i.test(k)) out[k] = v;
  return out;
}

async function catalog() {
  log('dns', { host: HOST, v4: await dns.resolve4(HOST), cname: await dns.resolveCname(HOST).catch((e) => e.code) });
  const window = `aggregation=1m&start_time=${nowS() - 120}&end_time=${nowS()}`;
  for (const label of ['cold', 'warm', 'warm', 'warm']) {
    const r = await get(`/price/kline?assets=BTC/USDT&${window}`);
    log('latency', { label, status: r.status, ms: r.ms, bytes: r.bytes, cache: r.headers.get('x-cache'), body: r.bytes < 120 ? r.text : undefined });
  }
  for (const path of ['/futures?limit=1', '/futures/BTCUSDT?is_symbol']) {
    const r = await get(path);
    log('catalogNoCredential', { path, status: r.status, body: r.text.slice(0, 200), headers: interestingHeaders(r.headers) });
  }

  const ex = new ccxt.mudrex();
  log('ccxt', { version: ccxt.version, feesTrading: ex.fees.trading, has: { fetchMarkets: ex.has.fetchMarkets, fetchOrderBook: ex.has.fetchOrderBook, fetchFundingRates: ex.has.fetchFundingRates, fetchTickers: ex.has.fetchTickers } });
  try {
    const markets = await ex.loadMarkets();
    log('ccxtLoadMarkets', { ok: true, count: Object.keys(markets).length });
  } catch (e) {
    log('ccxtLoadMarkets', { ok: false, error: e.constructor.name, message: String(e.message).slice(0, 200) });
  }
  const parsed = ex.parseMarket({ symbol: '1000PEPEUSDT' });
  log('ccxtParseMarket', { input: '1000PEPEUSDT', id: parsed.id, symbol: parsed.symbol, base: parsed.base, contractSize: parsed.contractSize, taker: parsed.taker, maker: parsed.maker, linear: parsed.linear, active: parsed.active });

  const listFile = OUT ? join(OUT, 'mudrex-symbols.json') : null;
  if (listFile && existsSync(listFile)) {
    const mudrex = new Set(JSON.parse(readFileSync(listFile, 'utf8')));
    const bybit = (await (await fetch('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000')).json()).result.list;
    const usdtPerp = bybit.filter((i) => i.quoteCoin === 'USDT' && i.contractType === 'LinearPerpetual' && i.status === 'Trading');
    const onMudrex = usdtPerp.filter((i) => mudrex.has(i.symbol.toLowerCase()));
    const notBybit = [...mudrex].filter((s) => !usdtPerp.some((i) => i.symbol.toLowerCase() === s));
    log('catalogVsBybit', { mudrexRecognised: mudrex.size, bybitUsdtPerpsTrading: usdtPerp.length, bybitOnMudrex: onMudrex.length, mudrexNotBybitUsdtPerp: notBybit.length, bybitMissing: usdtPerp.filter((i) => !mudrex.has(i.symbol.toLowerCase())).map((i) => i.symbol), digitPrefixed: [...mudrex].filter((m) => /^[0-9]/.test(m)).length });
  }
}

async function anchor() {
  const assets = ANCHOR_ASSETS.join(',');
  const marks = [];
  const lasts = [];
  const changes = new Map();
  const ages = [];
  const candlesPerKey = [];
  let first = null;
  const until = Date.now() + 60_000;
  let polls = 0;
  const keysPerPoll = [];
  while (Date.now() < until) {
    const tick = Date.now();
    const end = nowS();
    const r = await get(`/price/mark-kline?assets=${assets}&aggregation=1m&start_time=${end - 120}&end_time=${end}`);
    polls++;
    marks.push(r);
    if (r.status === 200) {
      const ticks = JSON.parse(r.text).data.asset_ticks ?? {};
      keysPerPoll.push(Object.keys(ticks).length);
      if (first === null) first = { keys: Object.keys(ticks).length, sampleKey: Object.keys(ticks)[0], sample: ticks[Object.keys(ticks)[0]], headers: interestingHeaders(r.headers) };
      for (const [k, candles] of Object.entries(ticks)) {
        candlesPerKey.push(candles.length);
        const lastCandle = candles[candles.length - 1];
        if (lastCandle === undefined) continue;
        ages.push(end - lastCandle[0]);
        const c = changes.get(k) ?? { prev: null, changed: 0, n: 0 };
        if (c.prev !== null && lastCandle[4] !== c.prev) c.changed++;
        c.prev = lastCandle[4];
        c.n++;
        changes.set(k, c);
      }
    } else {
      log('anchorError', { status: r.status, body: r.text.slice(0, 200), headers: interestingHeaders(r.headers) });
    }
    if (polls % 5 === 0) {
      const k = await get(`/price/kline?assets=${assets}&aggregation=1m&start_time=${end - 120}&end_time=${end}`);
      lasts.push(k);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  const ms = marks.map((r) => r.ms);
  log('markKlineBulk', {
    polls,
    ok: marks.filter((r) => r.status === 200).length,
    bytesMedian: median(marks.map((r) => r.bytes)),
    ms: { min: Math.min(...ms), p50: median(ms), p90: [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.9)], max: Math.max(...ms), over1s: ms.filter((x) => x > 1000).length },
    keys: first?.keys,
    keysPerPoll: { min: Math.min(...keysPerPoll), p50: median(keysPerPoll), under25: keysPerPoll.filter((k) => k < 25).length },
    candlesPerKey: { min: Math.min(...candlesPerKey), max: Math.max(...candlesPerKey) },
    lastCandleAgeS: { min: Math.min(...ages), p50: median(ages), max: Math.max(...ages) },
  });
  log('markKlineFirst', first ?? {});
  const perKey = [...changes].map(([k, c]) => `${k}:${c.changed}/${c.n - 1}`);
  log('markCloseChanges', { perKey });
  const kms = lasts.map((r) => r.ms);
  log('klineBulk', { polls: lasts.length, ok: lasts.filter((r) => r.status === 200).length, bytesMedian: median(lasts.map((r) => r.bytes)), msP50: median(kms), msMax: Math.max(...kms), sample: lasts[0]?.text.slice(0, 160) });
}

async function errors() {
  const w = `aggregation=1m&start_time=${nowS() - 120}&end_time=${nowS()}`;
  const cases = [
    ['missing assets', `/price/mark-kline?${w}`],
    ['26 assets', `/price/mark-kline?assets=${[...ANCHOR_ASSETS, 'ATOM/USDT'].join(',')}&${w}`],
    ['unknown asset alone', `/price/mark-kline?assets=NOPE/USDT&${w}`],
    ['unknown asset in a batch', `/price/mark-kline?assets=BTC/USDT,NOPE/USDT&${w}`],
    ['no slash', `/price/mark-kline?assets=BTCUSDT&${w}`],
    ['lowercase', `/price/mark-kline?assets=btc/usdt&${w}`],
    ['TON, not recognised on the socket', `/price/mark-kline?assets=TON/USDT&${w}`],
    ['aggregation 1s', `/price/mark-kline?assets=BTC/USDT&aggregation=1s&start_time=${nowS() - 10}&end_time=${nowS()}`],
    ['window without end_time', `/price/kline?assets=BTC/USDT&aggregation=1m&start_time=${nowS() - 120}`],
    ['guess depth', '/price/depth?assets=BTC/USDT'],
    ['guess orderbook', '/price/orderbook?assets=BTC/USDT'],
    ['guess ticker', '/price/ticker?assets=BTC/USDT'],
    ['guess tickers', '/price/tickers'],
    ['guess trades', '/price/trades?assets=BTC/USDT'],
    ['guess index-kline', `/price/index-kline?assets=BTC/USDT&${w}`],
    ['guess funding', '/price/funding?assets=BTC/USDT'],
    ['guess server time', '/time'],
  ];
  for (const [label, path] of cases) {
    const r = await get(path);
    log('error', { label, path: path.slice(0, 90), status: r.status, ms: r.ms, body: r.text.slice(0, 220) });
    await sleep(250);
  }
}

async function clock() {
  for (let i = 0; i < 5; i++) {
    const before = Date.now();
    const r = await get(`/price/kline?assets=BTC/USDT&aggregation=1m&start_time=${nowS() - 60}&end_time=${nowS()}`);
    const after = Date.now();
    const server = Date.parse(r.headers.get('date'));
    log('clock', { rttMs: after - before, serverDate: r.headers.get('date'), offsetMsVsMidpoint: server - Math.round((before + after) / 2), note: 'Date has one second resolution' });
    await sleep(400);
  }
}

const mode = process.argv[2] ?? 'catalog';
log('start', { mode, iso: new Date().toISOString() });
if (mode === 'catalog') await catalog();
else if (mode === 'anchor') await anchor();
else if (mode === 'errors') await errors();
else if (mode === 'clock') await clock();
else throw new Error(`unknown mode ${mode}`);
log('end', { mode });
