// ZebPay futures REST probe: host and latency, the public catalog and how CCXT maps it, the bulk anchor call, the REST book, errors, rate limit headers, clock offset, and how ZebPay's numbers compare with Binance USD-M.
// Public, unauthenticated, read-only. ZebPay answers x-ratelimit-limit 180 per 60 s per IP, so every mode stays under 90 ZebPay requests a minute.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/zebpay/rest-probe.mjs [catalog|anchor|mirror]
//   catalog  DNS, cold and warm timings, markets, exchangeInfo, pairs, tradefees, CCXT 4.5.68 loadMarkets, unknown symbols, headers, clock. About 30 ZebPay requests.
//   anchor   marketInfo every 1 s for 60 s, with Binance premiumIndex (all symbols) every 10 s beside it. 60 ZebPay requests.
//   mirror   the REST book of ten perpetuals next to Binance's depth, read back to back, three rounds. 30 ZebPay requests.
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/zebpay/rest.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const FUT = 'https://futuresbe.zebpay.com/api/v1';
const BINANCE = 'https://fapi.binance.com/fapi/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, bytes: text.length, headers: res.headers, text, json };
}

async function catalog() {
  for (const host of ['futuresbe.zebpay.com', 'futuresws.zebpay.com', 'sapi.zebpay.com']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }

  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${FUT}/system/time`);
    times.push(r.ms);
    if (i === 0) log('time_cold', { status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
  }
  log('time_warm', { ms: times.slice(1) });

  const local0 = Date.now();
  const t = await get(`${FUT}/system/time`);
  const local1 = Date.now();
  const server = t.json?.data?.timestamp;
  log('clock', { server, localMid: Math.round((local0 + local1) / 2), offsetMs: server - Math.round((local0 + local1) / 2), rttMs: local1 - local0 });

  const st = await get(`${FUT}/system/status`);
  log('status', { status: st.status, body: st.text });

  const m = await get(`${FUT}/market/markets`);
  keep('markets.json', m.text);
  const syms = m.json.data.symbols;
  const count = (arr, f) => arr.reduce((acc, x) => { const k = f(x); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  log('markets', {
    status: m.status, ms: m.ms, bytes: m.bytes, rows: syms.length,
    envelope: Object.keys(m.json), dataKeys: Object.keys(m.json.data),
    statuses: count(syms, (s) => s.status), quotes: count(syms, (s) => s.quoteAsset),
    fees: count(syms, (s) => `${s.quoteAsset} maker ${s.makerFee} taker ${s.takerFee}`),
    rateLimits: m.json.data.rateLimits, headers: {
      limit: m.headers.get('x-ratelimit-limit'), remaining: m.headers.get('x-ratelimit-remaining'), reset: m.headers.get('x-ratelimit-reset'),
      server: m.headers.get('server'), cfRay: m.headers.get('cf-ray'), cache: m.headers.get('cf-cache-status'),
    },
  });
  const inrBases = new Set(syms.filter((s) => s.quoteAsset === 'INR').map((s) => s.baseAsset));
  const usdtBases = new Set(syms.filter((s) => s.quoteAsset === 'USDT').map((s) => s.baseAsset));
  log('twins', { bothQuotes: [...inrBases].filter((b) => usdtBases.has(b)).length, inrOnly: [...inrBases].filter((b) => !usdtBases.has(b)), usdtOnly: [...usdtBases].filter((b) => !inrBases.has(b)).length });
  log('market_row', { first: syms.find((s) => s.symbol === 'BTCUSDT') });

  const ei = await get(`${FUT}/exchange/exchangeInfo`);
  keep('exchangeInfo.json', ei.text);
  const pairs = ei.json.data.pairs;
  log('exchangeInfo', {
    status: ei.status, ms: ei.ms, bytes: ei.bytes, pairs: pairs.length, conversionRates: ei.json.data.conversionRates,
    fundingFeeInterval: count(pairs, (p) => `${p.quoteAsset} ${p.fundingFeeInterval}h`),
    liquidationFee: count(pairs, (p) => Number(p.liquidationFee)),
    marginAssets: count(pairs, (p) => `${p.quoteAsset} ${p.marginAssetsSupported.join('+')}`),
    depthGroupingLengths: count(pairs, (p) => p.depthGrouping.length),
    groupingEqualsTick: pairs.filter((p) => Number(p.depthGrouping[0]) === Number(syms.find((s) => s.symbol === p.pair)?.tickSz)).length,
  });

  const pa = await get(`${FUT}/exchange/pairs`);
  keep('pairs.json', pa.text);
  log('pairs', { status: pa.status, ms: pa.ms, bytes: pa.bytes, rows: pa.json.data.pairs.length, active: count(pa.json.data.pairs, (p) => p.isActive), types: pa.json.data.types, categories: pa.json.data.categories });

  const tf = await get(`${FUT}/exchange/tradefees`);
  log('tradefees', { status: tf.status, ms: tf.ms, rows: tf.json.data.length, fees: count(tf.json.data, (f) => `maker ${f.makerFee} taker ${f.takerFee}`), sample: tf.json.data.slice(0, 2) });
  const tf1 = await get(`${FUT}/exchange/tradefee?symbol=BTCUSDT`);
  log('tradefee', { status: tf1.status, body: tf1.text });

  const mi = await get(`${FUT}/market/marketInfo`);
  keep('marketInfo.json', mi.text);
  const miKeys = Object.keys(mi.json.data);
  const catalogSet = new Set(syms.map((s) => s.symbol));
  log('marketInfo', {
    status: mi.status, ms: mi.ms, bytes: mi.bytes, rows: miKeys.length, inCatalog: miKeys.filter((k) => catalogSet.has(k)).length,
    catalogMissing: syms.filter((s) => !(s.symbol in mi.json.data)).map((s) => s.symbol),
    fields: count(Object.values(mi.json.data), (v) => Object.keys(v).sort().join(',')),
    zeroMark: miKeys.filter((k) => Number(mi.json.data[k].marketPrice) === 0).length,
    sample: { BTCUSDT: mi.json.data.BTCUSDT, BTCINR: mi.json.data.BTCINR },
  });

  const ob = await get(`${FUT}/market/orderBook?symbol=BTCUSDT`);
  const d = ob.json.data;
  log('orderBook', { status: ob.status, ms: ob.ms, bytes: ob.bytes, keys: Object.keys(d), bids: d.bids.length, asks: d.asks.length, bidTop: d.bids.slice(0, 2), askTop: d.asks.slice(0, 2), bidLast: d.bids.at(-1), askLast: d.asks.at(-1), ts: d.timestamp, nonce: d.nonce, ageMs: Date.now() - d.timestamp });
  for (const q of ['&limit=100', '&limit=5', '&depth=50']) {
    const r = await get(`${FUT}/market/orderBook?symbol=BTCUSDT${q}`);
    log('orderBook_param', { q, status: r.status, bids: r.json?.data?.bids?.length, asks: r.json?.data?.asks?.length });
  }

  const tk = await get(`${FUT}/market/ticker24Hr?symbol=BTCUSDT`);
  log('ticker24Hr', { status: tk.status, ms: tk.ms, keys: Object.keys(tk.json.data), info: tk.json.data.info, bid: tk.json.data.bid, ask: tk.json.data.ask });

  for (const u of [`${FUT}/market/orderBook?symbol=NOPEUSDT`, `${FUT}/market/orderBook`, `${FUT}/market/ticker24Hr?symbol=NOPEUSDT`, `${FUT}/exchange/tradefee?symbol=NOPEUSDT`, `${FUT}/market/nope`, `${FUT}/market/orderBook?symbol=btcusdt`, `${FUT}/market/orderBook?symbol=AIAINR`]) {
    const r = await get(u);
    log('error_shape', { url: u.replace(FUT, ''), status: r.status, body: r.text.slice(0, 300), retryAfter: r.headers.get('retry-after'), remaining: r.headers.get('x-ratelimit-remaining') });
  }

  const ex = new ccxt.zebpay();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const swaps = all.filter((x) => x.type === 'swap' && x.swap === true);
  const active = swaps.filter((x) => x.active !== false);
  log('ccxt', {
    version: ccxt.version, ms: Math.round(performance.now() - t0), markets: all.length, spot: all.filter((x) => x.spot).length, swaps: swaps.length, activeSwaps: active.length,
    taker: count(swaps, (x) => x.taker), maker: count(swaps, (x) => x.maker), contractSize: count(swaps, (x) => String(x.contractSize)),
    linear: count(swaps, (x) => String(x.linear)), settle: count(swaps, (x) => x.settle), active: count(swaps, (x) => String(x.active)),
    idEqualsSymbolField: swaps.filter((x) => x.id === x.info.symbol).length,
    sample: (({ id, symbol, base, quote, settle, active, taker, maker, contractSize, linear, inverse, precision }) => ({ id, symbol, base, quote, settle, active, taker, maker, contractSize, linear, inverse, precision }))(markets['BTC/USDT:USDT']),
    inr: (({ id, symbol, settle, taker }) => ({ id, symbol, settle, taker }))(markets['BTC/INR:INR']),
    spotSample: (({ id, symbol, taker, maker }) => ({ id, symbol, taker, maker }))(all.find((x) => x.spot) ?? {}),
  });
}

async function anchor() {
  const polls = [];
  const binance = [];
  let prev = null;
  const changes = {};
  const watch = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAUUSDT', 'BTCINR', 'ETHINR'];
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const at = Date.now();
    const r = await get(`${FUT}/market/marketInfo`);
    polls.push({ ms: r.ms, bytes: r.bytes, status: r.status, remaining: r.headers.get('x-ratelimit-remaining') });
    const d = r.json?.data ?? {};
    if (prev) {
      for (const k of Object.keys(d)) {
        for (const f of ['marketPrice', 'upcomingFundingRate', 'lastPrice']) {
          if (prev[k] && prev[k][f] !== d[k][f]) {
            changes[f] = changes[f] ?? {};
            changes[f][k] = (changes[f][k] ?? 0) + 1;
          }
        }
      }
    }
    prev = d;
    if (i % 10 === 0) {
      const b = await get(`${BINANCE}/premiumIndex`);
      const bmap = new Map(b.json.map((x) => [x.symbol, x]));
      binance.push({ at, zeb: d, bmap, ms: b.ms });
    }
    const wait = t0 + (i + 1) * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  }
  log('anchor_polls', {
    n: polls.length, statuses: [...new Set(polls.map((p) => p.status))], bytes: median(polls.map((p) => p.bytes)),
    ms: { min: Math.min(...polls.map((p) => p.ms)), median: median(polls.map((p) => p.ms)), p90: pct(polls.map((p) => p.ms), 0.9), max: Math.max(...polls.map((p) => p.ms)) },
    over1s: polls.filter((p) => p.ms > 1000).length, over2s: polls.filter((p) => p.ms > 2000).length, remainingLast: polls.at(-1).remaining,
  });
  for (const f of ['marketPrice', 'upcomingFundingRate', 'lastPrice']) {
    const c = changes[f] ?? {};
    log('changes_in_59_intervals', { field: f, symbolsThatChanged: Object.keys(c).length, of: Object.keys(prev).length, medianChanges: median(Object.values(c)), watch: Object.fromEntries(watch.map((w) => [w, c[w] ?? 0])) });
  }

  // Compare every USDT row with Binance's premiumIndex read in the same second.
  const ex = await get(`${FUT}/exchange/exchangeInfo`);
  const conv = ex.json.data.conversionRates;
  for (const s of binance) {
    let markEq = 0, markNear = 0, markN = 0, rateN = 0;
    const ratio = {};
    const noBinance = [];
    for (const [k, v] of Object.entries(s.zeb)) {
      if (!k.endsWith('USDT')) continue;
      const b = s.bmap.get(k);
      if (!b) { noBinance.push(k); continue; }
      markN++;
      const zm = Number(v.marketPrice), bm = Number(b.markPrice);
      const decimals = (v.marketPrice.split('.')[1] ?? '').length;
      if (zm === bm || zm.toFixed(decimals) === bm.toFixed(decimals)) markEq++;
      if (Math.abs(zm - bm) / bm < 0.0005) markNear++;
      const zr = Number(v.upcomingFundingRate), br = Number(b.lastFundingRate);
      if (br !== 0) { rateN++; const q = (zr / br).toFixed(2); ratio[q] = (ratio[q] ?? 0) + 1; }
    }
    const top = Object.entries(ratio).sort((a, b) => b[1] - a[1]).slice(0, 8);
    log('vs_binance', { at: new Date(s.at).toISOString(), binanceMs: s.ms, usdtRows: markN, markEqualAtZebPayDecimals: markEq, markWithin500ppm: markNear, rateRatioZebOverBinance: Object.fromEntries(top), rateRows: rateN, noBinanceTwin: noBinance.slice(0, 12), noBinanceCount: noBinance.length });
    // INR rows: the same pair's USDT mark times one conversion factor.
    const f = [];
    for (const [k, v] of Object.entries(s.zeb)) {
      if (!k.endsWith('INR')) continue;
      const u = s.zeb[k.replace(/INR$/, 'USDT')];
      if (u) f.push(Number(v.marketPrice) / Number(u.marketPrice));
    }
    const rates = [];
    for (const [k, v] of Object.entries(s.zeb)) {
      if (!k.endsWith('INR')) continue;
      const u = s.zeb[k.replace(/INR$/, 'USDT')];
      if (u && Number(u.upcomingFundingRate) !== 0) rates.push((Number(v.upcomingFundingRate) / Number(u.upcomingFundingRate)).toFixed(3));
    }
    log('inr_vs_usdt', { pairs: f.length, factorMin: Math.min(...f).toFixed(3), factorMedian: median(f).toFixed(3), factorMax: Math.max(...f).toFixed(3), conversionRates: conv, rateRatioInrOverUsdt: Object.entries(rates.reduce((a, x) => { a[x] = (a[x] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5) });
  }
  const last = binance.at(-1);
  log('sample_rows', { BTCUSDT: last.zeb.BTCUSDT, binanceBTC: (({ markPrice, indexPrice, lastFundingRate, nextFundingTime, time }) => ({ markPrice, indexPrice, lastFundingRate, nextFundingTime, time }))(last.bmap.get('BTCUSDT')), ETHUSDT: last.zeb.ETHUSDT, binanceETH: last.bmap.get('ETHUSDT')?.lastFundingRate });

  const hist = await get(`${BINANCE}/fundingRate?symbol=BTCUSDT&limit=2`);
  log('binance_last_settled_btc', { rows: hist.json });

  // ZebPay's static fundingFeeInterval against Binance's interval, where fundingInfo lists only the adjusted symbols and the rest are 8 h.
  const fi = await get(`${BINANCE}/fundingInfo`);
  const bnInterval = new Map(fi.json.map((x) => [x.symbol, x.fundingIntervalHours]));
  const agree = {};
  const differ = [];
  for (const p of ex.json.data.pairs) {
    const bsym = p.pair.replace(/INR$/, 'USDT');
    const bh = bnInterval.get(bsym) ?? 8;
    const k = `${p.quoteAsset} ${p.fundingFeeInterval === bh ? 'same' : 'differs'}`;
    agree[k] = (agree[k] ?? 0) + 1;
    if (p.fundingFeeInterval !== bh) differ.push(`${p.pair} zebpay ${p.fundingFeeInterval} binance ${bh}`);
  }
  log('interval_vs_binance', { agree, differ: differ.slice(0, 12), differCount: differ.length });
}

async function mirror() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'XAUUSDT', 'MMTUSDT', 'ENJUSDT', 'BTCINR', 'ETHINR'];
  const ex = await get(`${FUT}/market/markets`);
  const tick = new Map(ex.json.data.symbols.map((s) => [s.symbol, Number(s.tickSz)]));
  const bnTick = new Map();
  const bi = await get(`${BINANCE}/exchangeInfo`);
  for (const s of bi.json.symbols) bnTick.set(s.symbol, Number(s.filters.find((f) => f.filterType === 'PRICE_FILTER').tickSize));
  const bnType = new Map(bi.json.symbols.filter((s) => s.status === 'TRADING').map((s) => [s.symbol, s.contractType]));
  const usdt = ex.json.data.symbols.filter((s) => s.quoteAsset === 'USDT').map((s) => s.symbol);
  const types = usdt.reduce((a, s) => { const k = bnType.get(s) ?? 'absent'; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  log('binance_twins', { zebUsdt: usdt.length, binanceContractTypes: types, notOnBinance: usdt.filter((s) => !bnType.has(s)) });

  for (let round = 0; round < 3; round++) {
    for (const sym of symbols) {
      const bsym = sym.replace(/INR$/, 'USDT');
      const [z, b] = await Promise.all([get(`${FUT}/market/orderBook?symbol=${sym}`), get(`${BINANCE}/depth?symbol=${bsym}&limit=50`)]);
      const zb = z.json?.data;
      if (!zb || !b.json?.bids) { log('mirror_fail', { sym, z: z.status, b: b.status }); continue; }
      // Match each ZebPay level to the Binance level of equal size on the same side, then read the price offset.
      const off = (zs, bs, sign) => {
        const out = [];
        for (const [p, q] of zs) {
          const m = bs.find(([, bq]) => Number(bq) === Number(q));
          if (m) out.push(sign * (Number(p) - Number(m[0])));
        }
        return out;
      };
      const isInr = sym.endsWith('INR');
      const bidOff = isInr ? [] : off(zb.bids, b.json.bids, -1);
      const askOff = isInr ? [] : off(zb.asks, b.json.asks, 1);
      const t = tick.get(sym);
      const bt = bnTick.get(bsym);
      const zMid = (Number(zb.bids[0]?.[0]) + Number(zb.asks[0]?.[0])) / 2;
      const bMid = (Number(b.json.bids[0][0]) + Number(b.json.asks[0][0])) / 2;
      const sizeMatch = (zs, bs) => zs.filter(([, q]) => bs.some(([, bq]) => Number(bq) === Number(q))).length;
      log('mirror', {
        round, sym, zebTick: t, binanceTick: bt, levels: [zb.bids.length, zb.asks.length],
        bidOrder: zb.bids.every((l, i) => i === 0 || Number(l[0]) < Number(zb.bids[i - 1][0])) ? 'descending' : 'other',
        askOrder: zb.asks.every((l, i) => i === 0 || Number(l[0]) > Number(zb.asks[i - 1][0])) ? 'ascending' : 'other',
        sizesFoundOnBinance: [sizeMatch(zb.bids, b.json.bids), sizeMatch(zb.asks, b.json.asks)],
        bidMarkdown: bidOff.length ? { medianPrice: +median(bidOff).toFixed(8), medianTicks: +(median(bidOff) / t).toFixed(2), ppm: Math.round(median(bidOff) / bMid * 1e6), n: bidOff.length } : null,
        askMarkup: askOff.length ? { medianPrice: +median(askOff).toFixed(8), medianTicks: +(median(askOff) / t).toFixed(2), ppm: Math.round(median(askOff) / bMid * 1e6), n: askOff.length } : null,
        zebSpreadPpm: Math.round((Number(zb.asks[0][0]) - Number(zb.bids[0][0])) / zMid * 1e6),
        binanceSpreadPpm: Math.round((Number(b.json.asks[0][0]) - Number(b.json.bids[0][0])) / bMid * 1e6),
        midRatio: +(zMid / bMid).toFixed(isInr ? 4 : 7), zebTouch: [zb.bids[0], zb.asks[0]], binanceTouch: [b.json.bids[0], b.json.asks[0]], zebAgeMs: Date.now() - zb.timestamp,
      });
      await sleep(400);
    }
    await sleep(3000);
  }
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, anchor, mirror }[mode];
if (!run) throw new Error(`unknown mode ${mode}`);
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
