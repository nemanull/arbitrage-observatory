// KoinBX REST probe: futures catalog, anchor fields and their cadence, REST book against Binance USD-M, errors, latency and clock.
// Public, unauthenticated, read-only. One request at a time per host, never faster than one per second per endpoint.
// The futures host is the one the koinbx.com/futures web app calls, and it has no public documentation. The spot host is the documented https://api.koinbx.com.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/koinbx/rest-probe.mjs [catalog|latency|anchor|book|errors|time]
//   catalog  futures exchangeInfo, markets, pairs and marketInfo, spot markets, ticker and asset, the Binance USD-M overlap, and CCXT. About 60 s, the futures catalog is slow.
//   latency  DNS, one cold and five warm requests to marketInfo and orderBook.
//   anchor   up to 60 polls of marketInfo, one per second or one per reply when the reply is slower, beside Binance premiumIndex, per symbol change counts and the gap to the Binance mark. Stops after ANCHOR_WALL_MS, 240 s by default.
//   book     8 samples of the REST orderBook beside the Binance depth, touch offsets and level order.
//   errors   unknown and malformed requests, and the status and body each returns.
//   time     server time from the futures markets reply against the local clock.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/koinbx/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const FAPI = 'https://futures-api.koinbx.com/api/v1';
const SPOT = 'https://api.koinbx.com';
const BINANCE = 'https://fapi.binance.com/fapi/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const ppm = (a, b) => Math.round(((a - b) / b) * 1e6);
const q = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: q(xs, 0), p50: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, timeoutMs = 90_000) {
  const t0 = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const total = performance.now() - t0;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: Object.fromEntries(res.headers), text, json, bytes: text.length, ttfb: Math.round(ttfb), total: Math.round(total) };
}

const countBy = (xs, f) => {
  const c = {};
  for (const x of xs) {
    const k = f(x);
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
};

async function catalog() {
  const ei = await get(`${FAPI}/exchange/exchangeInfo`);
  keep('exchangeInfo.json', ei.text);
  const pairs = ei.json.data.pairs;
  log('exchangeInfo', { status: ei.status, bytes: ei.bytes, ttfb: ei.ttfb, total: ei.total, pairs: pairs.length, dataKeys: Object.keys(ei.json.data), conversionRates: ei.json.data.conversionRates });
  log('byTypeQuote', countBy(pairs, (p) => `${p.contractType} ${p.quoteAsset}`));
  log('marginAssets', countBy(pairs, (p) => `${p.quoteAsset} ${JSON.stringify(p.marginAssetsSupported)}`));
  log('fees', countBy(pairs, (p) => `maker ${p.makerFee} taker ${p.takerFee}`));
  log('fundingInterval', countBy(pairs, (p) => `${p.quoteAsset} ${p.fundingFeeInterval}h`));
  log('liquidationFee', countBy(pairs, (p) => Number(p.liquidationFee)));
  log('depthGrouping', { lengths: countBy(pairs, (p) => p.depthGrouping.length), btc: pairs.find((p) => p.pair === 'BTCUSDT')?.depthGrouping });
  log('maxLeverage', countBy(pairs, (p) => p.maxLeverage));
  const tradfi = pairs.filter((p) => p.contractType === 'TRADIFI_PERPETUAL' && p.quoteAsset === 'USDT').map((p) => p.pair);
  log('tradfiUsdt', { n: tradfi.length, pairs: tradfi.join(' ') });
  const usdt = pairs.filter((p) => p.quoteAsset === 'USDT');
  const scaled = usdt.filter((p) => /^1(000)+/.test(p.baseAsset)).map((p) => p.pair);
  log('scaledBases', { n: scaled.length, pairs: scaled.join(' ') });
  const bases = countBy(usdt, (p) => p.baseAsset.replace(/^1(000)+/, ''));
  log('usdtBaseListedTwice', { pairs: Object.entries(bases).filter(([, n]) => n > 1).map(([b]) => b) });
  const inrBases = new Set(pairs.filter((p) => p.quoteAsset === 'INR').map((p) => p.baseAsset));
  log('inrBasesAlsoUsdt', { inr: inrBases.size, alsoUsdt: [...inrBases].filter((b) => usdt.some((p) => p.baseAsset === b)).length });
  const btc = pairs.find((p) => p.pair === 'BTCUSDT');
  log('btcusdtRow', { ...btc, filters: btc.filters.map((f) => `${f.filterType}:${f.minQty ?? ''}/${f.maxQty ?? ''}/${f.limit ?? ''}/${f.notional ?? ''}`), maintenanceMarginConfig: undefined, iconURL: btc.iconURL });

  await sleep(1000);
  const mk = await get(`${FAPI}/market/markets`);
  const syms = mk.json.data.symbols;
  log('markets', { status: mk.status, bytes: mk.bytes, ttfb: mk.ttfb, total: mk.total, n: syms.length, status_: countBy(syms, (s) => s.status), rateLimits: mk.json.data.rateLimits, fieldKeys: Object.keys(syms[0]).join(',') });
  const eiSet = new Set(pairs.map((p) => p.pair));
  log('marketsVsExchangeInfo', { same: syms.filter((s) => eiSet.has(s.symbol)).length, onlyMarkets: syms.filter((s) => !eiSet.has(s.symbol)).map((s) => s.symbol) });

  await sleep(1000);
  const pr = await get(`${FAPI}/exchange/pairs`);
  log('pairs', { status: pr.status, bytes: pr.bytes, total: pr.total, n: pr.json.data.pairs.length, isActive: countBy(pr.json.data.pairs, (p) => p.isActive), marginAsset: countBy(pr.json.data.pairs, (p) => `${p.quoteAsset} ${p.marginAsset}`) });

  await sleep(1000);
  const mi = await get(`${FAPI}/market/marketInfo`);
  const miKeys = Object.keys(mi.json.data);
  log('marketInfo', { status: mi.status, bytes: mi.bytes, total: mi.total, n: miKeys.length, fields: Object.keys(mi.json.data.BTCUSDT).join(','), btc: mi.json.data.BTCUSDT, btcinr: mi.json.data.BTCINR });
  const vol = usdt.map((p) => ({ pair: p.pair, qv: Number(mi.json.data[p.pair]?.quoteAssetVolume ?? 0) })).sort((a, b) => b.qv - a.qv);
  log('usdtByQuoteVolume', { top: vol.slice(0, 5).map((v) => `${v.pair}:${Math.round(v.qv)}`), bottom: vol.slice(-5).map((v) => `${v.pair}:${Math.round(v.qv)}`), zero: vol.filter((v) => v.qv === 0).length });

  const bn = await get(`${BINANCE}/premiumIndex`);
  const bnSet = new Set(bn.json.map((r) => r.symbol));
  const missing = usdt.filter((p) => !bnSet.has(p.pair)).map((p) => p.pair);
  log('binanceOverlap', { binanceRows: bn.json.length, koinbxUsdt: usdt.length, onBinance: usdt.length - missing.length, notOnBinance: missing.join(' ') });
  const inrOnBinance = [...inrBases].filter((b) => bnSet.has(`${b}USDT`)).length;
  log('binanceOverlapInr', { inrBases: inrBases.size, baseUsdtOnBinance: inrOnBinance });

  const sm = await get(`${SPOT}/markets`);
  keep('spot-markets.json', sm.text);
  const spot = sm.json.markets;
  log('spotMarkets', { status: sm.status, bytes: sm.bytes, total: sm.total, n: spot.length, byQuote: countBy(spot, (m) => m.trading_pairs.split('_')[1]), sample: spot[0] });
  await sleep(1000);
  const st = await get(`${SPOT}/ticker`);
  const tk = Object.values(st.json.tickers ?? {});
  log('spotTicker', { status: st.status, bytes: st.bytes, n: tk.length, frozen: countBy(tk, (t) => t.isFrozen) });
  await sleep(1000);
  const sa = await get(`${SPOT}/asset`);
  const assets = sa.json.assets ?? [];
  log('spotAsset', { status: sa.status, bytes: sa.bytes, n: assets.length, fees: countBy(assets, (a) => `maker ${a.maker_fee} taker ${a.taker_fee}`) });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, koinbx: ccxt.exchanges.filter((e) => /koin|kbx/i.test(e)) });
}

async function latency() {
  for (const host of ['futures-api.koinbx.com', 'api.koinbx.com', 'kbx-futures-prod.webpubsub.azure.com']) {
    const a = await lookup(host, { all: true });
    log('dns', { host, addrs: a.map((x) => x.address) });
  }
  const trace = await get('https://futures-api.koinbx.com/cdn-cgi/trace');
  log('cfTrace', { status: trace.status, body: trace.text.split('\n').filter((l) => /^(colo|loc|http)=/.test(l)).join(' ') });
  for (const [name, url] of [['marketInfo', `${FAPI}/market/marketInfo`], ['orderBook', `${FAPI}/market/orderBook?symbol=BTCUSDT`], ['spotOrderbook', `${SPOT}/orderbook?market_pair=BTC_USDT`]]) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const r = await get(url);
      times.push({ status: r.status, ttfb: r.ttfb, total: r.total, bytes: r.bytes, cfRay: r.headers['cf-ray'] });
      await sleep(1000);
    }
    log('latency', { name, cold: times[0], warm: times.slice(1).map((t) => `${t.ttfb}/${t.total}`).join(' '), rays: [...new Set(times.map((t) => t.cfRay?.split('-')[1]))] });
  }
}

async function anchor() {
  const polls = 60;
  const started = Date.now();
  const series = new Map();
  const times = [];
  const bytes = [];
  const gapMark = [];
  let rateEq = 0;
  let rateN = 0;
  let pollErrors = 0;
  const rateEqBySym = new Map(); // polls on which the KoinBX rate equalled the Binance rate
  const inrRatio = [];
  const maxWallMs = Number(process.env.ANCHOR_WALL_MS ?? 240_000); // the reply can take 15 s, so the run stops on wall time too
  for (let i = 0; i < polls && Date.now() - started < maxWallMs; i++) {
    const t0 = Date.now();
    const [k, b] = await Promise.all([get(`${FAPI}/market/marketInfo`, 15_000).catch((e) => ({ error: e.message })), get(`${BINANCE}/premiumIndex`, 15_000).catch((e) => ({ error: e.message }))]);
    if (k.error || k.status !== 200) {
      pollErrors++;
      log('pollError', { i, error: k.error, status: k.status, body: k.text?.slice(0, 200) });
    } else {
      times.push(k.total);
      bytes.push(k.bytes);
      const bnBy = new Map((b.json ?? []).map((r) => [r.symbol, r]));
      for (const [sym, row] of Object.entries(k.json.data)) {
        let s = series.get(sym);
        if (!s) series.set(sym, (s = { mark: [], rate: [], last: [] }));
        s.mark.push(row.marketPrice);
        s.rate.push(row.upcomingFundingRate);
        s.last.push(row.lastPrice);
        const bn = bnBy.get(sym);
        if (bn && sym.endsWith('USDT')) {
          gapMark.push(Math.abs(ppm(Number(row.marketPrice), Number(bn.markPrice))));
          rateN++;
          if (Number(row.upcomingFundingRate) === Number(bn.lastFundingRate)) {
            rateEq++;
            rateEqBySym.set(sym, (rateEqBySym.get(sym) ?? 0) + 1);
          }
        }
      }
      const btc = k.json.data.BTCUSDT;
      const btcinr = k.json.data.BTCINR;
      if (btc && btcinr) inrRatio.push(Number(btcinr.marketPrice) / Number(btc.marketPrice));
      const bnBtc = bnBy.get('BTCUSDT');
      if (i % 15 === 0 && bnBtc) {
        log('btcSample', { i, koinbxMark: btc.marketPrice, koinbxLast: btc.lastPrice, koinbxRate: btc.upcomingFundingRate, binanceMark: bnBtc.markPrice, binanceIndex: bnBtc.indexPrice, binanceRate: bnBtc.lastFundingRate, binanceNext: bnBtc.nextFundingTime });
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  const distinct = (xs) => new Set(xs).size;
  const changes = (xs) => xs.reduce((n, x, i) => n + (i > 0 && x !== xs[i - 1] ? 1 : 0), 0);
  log('replyTime', { ...stats(times), bytes: stats(bytes), timeouts: pollErrors });
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAUUSDT', 'BTCINR']) {
    const s = series.get(sym);
    if (s) log('cadence', { sym, polls: s.mark.length, markChanges: changes(s.mark), rateChanges: changes(s.rate), lastChanges: changes(s.last), rateDistinct: distinct(s.rate) });
  }
  const markCh = [...series.values()].map((s) => changes(s.mark));
  log('markChangesAllSymbols', { symbols: series.size, ...stats(markCh), neverChanged: markCh.filter((n) => n === 0).length });
  log('markGapToBinancePpm', { ...stats(gapMark), exactZero: gapMark.filter((g) => g === 0).length });
  log('rateEqualsBinanceLastFundingRate', { equal: rateEq, of: rateN, symbolsEverEqual: rateEqBySym.size, equalValues: countBy([...rateEqBySym.keys()], (sym) => series.get(sym).rate.at(-1)) });
  const rateCh = [...series.values()].map((s) => changes(s.rate));
  log('rateChangesAllSymbols', { ...stats(rateCh), neverChanged: rateCh.filter((n) => n === 0).length, wallSeconds: Math.round((Date.now() - started) / 1000) });
  log('inrPerUsdtFromBtcMarks', stats(inrRatio.map((r) => Math.round(r * 1000) / 1000)));
}

async function book() {
  const targets = [
    ['BTCUSDT', 'BTCUSDT'],
    ['ETHUSDT', 'ETHUSDT'],
    ['DOGEUSDT', 'DOGEUSDT'],
    ['BTCINR', 'BTCUSDT'],
  ];
  const acc = new Map();
  for (let i = 0; i < 8; i++) {
    for (const [sym, bnSym] of targets) {
      const [k, b] = await Promise.all([get(`${FAPI}/market/orderBook?symbol=${sym}`, 15_000), get(`${BINANCE}/depth?symbol=${bnSym}&limit=20`, 15_000)]);
      if (i === 0) keep(`orderBook-${sym}.json`, k.text);
      const d = k.json?.data;
      if (!d) {
        log('bookError', { sym, status: k.status, body: k.text.slice(0, 200) });
        continue;
      }
      const bidsAsc = d.bids.every((l, j) => j === 0 || l[0] >= d.bids[j - 1][0]);
      const asksAsc = d.asks.every((l, j) => j === 0 || l[0] >= d.asks[j - 1][0]);
      const bestBid = Math.max(...d.bids.map((l) => l[0]));
      const bestAsk = Math.min(...d.asks.map((l) => l[0]));
      const bnBid = Number(b.json.bids[0][0]);
      const bnAsk = Number(b.json.asks[0][0]);
      let a = acc.get(sym);
      if (!a) acc.set(sym, (a = { levels: new Set(), order: new Set(), bidOff: [], askOff: [], spreadK: [], spreadB: [], ratio: [], time: [], keys: Object.keys(d).join(',') }));
      a.levels.add(`${d.bids.length}/${d.asks.length}`);
      a.order.add(`bids ${bidsAsc ? 'ascending' : 'not ascending'} asks ${asksAsc ? 'ascending' : 'not ascending'}`);
      a.time.push(k.total);
      if (sym === bnSym) {
        a.bidOff.push(Math.round((bestBid - bnBid) * 1e8) / 1e8);
        a.askOff.push(Math.round((bestAsk - bnAsk) * 1e8) / 1e8);
        a.spreadK.push(ppm(bestAsk, bestBid));
        a.spreadB.push(ppm(bnAsk, bnBid));
      } else {
        a.ratio.push(Math.round(((bestBid + bestAsk) / (bnBid + bnAsk)) * 1000) / 1000);
      }
    }
    await sleep(2000);
  }
  for (const [sym, a] of acc) {
    log('book', { sym, keys: a.keys, levels: [...a.levels], order: [...a.order], bidMinusBinanceBid: a.bidOff.join(' '), askMinusBinanceAsk: a.askOff.join(' '), spreadPpmKoinbx: a.spreadK.join(' '), spreadPpmBinance: a.spreadB.join(' '), midRatioToBinance: a.ratio.join(' '), replyMs: stats(a.time) });
  }
}

async function errors() {
  const cases = [
    ['orderBook unknown', `${FAPI}/market/orderBook?symbol=NOPEUSDT`],
    ['orderBook lowercase', `${FAPI}/market/orderBook?symbol=btcusdt`],
    ['orderBook missing symbol', `${FAPI}/market/orderBook`],
    ['orderBook limit 100', `${FAPI}/market/orderBook?symbol=BTCUSDT&limit=100`],
    ['ticker24Hr unknown', `${FAPI}/market/ticker24Hr?symbol=NOPEUSDT`],
    ['unknown path', `${FAPI}/market/premiumIndex`],
    ['fundingRate path', `${FAPI}/market/fundingRate?symbol=BTCUSDT`],
    ['spot orderbook unknown', `${SPOT}/orderbook?market_pair=NOPE_USDT`],
    ['spot orderbook depth 50', `${SPOT}/orderbook?market_pair=BTC_USDT&depth=50`],
    ['spot unknown path', `${SPOT}/nope`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url, 20_000).catch((e) => ({ status: 'error', text: e.message, headers: {} }));
    const d = r.json?.data;
    const levels = d?.bids ? `${d.bids.length}/${d.asks.length}` : r.json?.bids ? `${r.json.bids.length}/${r.json.asks.length}` : undefined;
    const rl = Object.entries(r.headers).filter(([h]) => /rate|limit|retry/i.test(h));
    log('error', { name, status: r.status, levels, rateLimitHeaders: rl, body: levels ? undefined : r.text.slice(0, 260) });
    await sleep(1000);
  }
}

async function time() {
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const res = await fetch(`${FAPI}/market/markets`, { signal: AbortSignal.timeout(90_000) });
    const t1 = Date.now();
    const text = await res.text();
    const server = JSON.parse(text).data.serverTime;
    log('serverTime', { serverTime: server, sent: t0, headers: t1, offsetMs: server - Math.round((t0 + t1) / 2), rttToHeaders: t1 - t0, bodyMs: Date.now() - t1, dateHeader: res.headers.get('date') });
    await sleep(1000);
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, latency, anchor, book, errors, time };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
