// Websea futures REST probe: host and latency, the documented OpenAPI catalog and bulk calls, the web app calls that carry the mark price, funding history, the REST book, errors and clock.
// Public, unauthenticated, read-only. It sends one request at a time and at most 3 a second to any host, inside the documented 100 requests per 10 s per endpoint.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/websea/rest-probe.mjs [latency|catalog|anchor|funding|book|errors|clock]
//   latency  DNS, 5 cold and 10 warm requests on the bulk ticker call of oapi.websea.com, and 5 warm on capi.websea.com.
//   catalog  whether CCXT has a class, then the three OpenAPI instrument calls against each other, contract size, quote, and the web app symbol list with its TradFi flags and status.
//   anchor   60 polls at 1 s of /v1/futures/24hr and /v1/futures/index_price, plus the web app symbol detail of three contracts and the Binance USD-M index of BTC and ETH: reply time and size, how often index, funding and mark changed, the three Websea index numbers against each other and against Binance. About 80 s. It reads one public Binance call per contract per poll.
//   funding  the single funding rate call against the bulk one, the web app settlement history of three contracts and of three on the earliest next settlement, interval, next settlement and caps.
//   book     REST depth on four contracts at limits 50, 100 and 200: level count, order, repeated prices, two reads in a row, and the merged depth call.
//   errors   unknown symbol, missing parameter and unknown path on the public calls.
//   clock    the Date header against the local clock, and the index ts against arrival.
// Set PROBE_OUT_DIR to keep the last replies. Recorded in docs/profiles/websea/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const OAPI = 'https://oapi.websea.com';
const CAPI = 'https://capi.websea.com'; // the host the futures web app calls, BASI_API_AGREEMENT in its bundle
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const keepAlive = new https.Agent({ keepAlive: true, maxSockets: 1 });
const THREE = ['BTC-USDT', 'ETH-USDT', 'LAPTOP-USDT'];

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// Resolves with status, headers, body text, total ms and time to first byte.
function get(url, { agent = keepAlive } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let ttfb = 0;
    const req = https.get(url, { agent, headers: { 'accept-encoding': 'identity', 'user-agent': 'observatory-probe' } }, (res) => {
      ttfb = performance.now() - t0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), ms: performance.now() - t0, ttfb }));
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
  });
}

async function getJson(url, opts) {
  const r = await get(url, opts);
  let json = null;
  try {
    json = JSON.parse(r.text);
  } catch {}
  return { ...r, json };
}

const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: round(s[0]), median: round(q(0.5)), p90: round(q(0.9)), max: round(s[s.length - 1]) };
}

async function latency() {
  for (const host of ['oapi.websea.com', 'capi.websea.com', 'cws.websea.com']) {
    const addrs = await lookup(host, { all: true });
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${OAPI}/v1/futures/24hr`, { agent: new https.Agent({ keepAlive: false }) });
    cold.push(r.ms);
    if (i === 0) log('pop', { cfRay: r.headers['cf-ray'], server: r.headers.server, bytes: r.text.length });
    await sleep(400);
  }
  const warm = [];
  const warmTtfb = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${OAPI}/v1/futures/24hr`);
    warm.push(r.ms);
    warmTtfb.push(r.ttfb);
    await sleep(400);
  }
  const capiAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  const capi = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${CAPI}/webApi/market/getSymbolDetail?symbol=BTC-USDT`, { agent: capiAgent });
    capi.push(r.ms);
    await sleep(400);
  }
  log('latency', { url: '/v1/futures/24hr', cold: stats(cold), warm: stats(warm), warmTtfb: stats(warmTtfb), capiDetailWarm: stats(capi) });
}

async function catalog() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, hasWebsea: ccxt.exchanges.includes('websea'), matches: ccxt.exchanges.filter((e) => /websea|sea/i.test(e)) });

  const sym = await getJson(`${OAPI}/v1/futures/symbols`);
  const info = await getJson(`${OAPI}/v1/futures/info`);
  const prec = await getJson(`${OAPI}/v1/futures/symbol_precision`);
  const h24 = await getJson(`${OAPI}/v1/futures/24hr`);
  const spot = await getJson(`${OAPI}/v1/spot/symbols`);
  save('futures_symbols.json', sym.text);
  save('futures_info.json', info.text);
  const S = sym.json.result;
  const byQuote = {};
  for (const r of S) byQuote[r.quote_currency] = (byQuote[r.quote_currency] ?? 0) + 1;
  log('symbols', { status: sym.status, rows: S.length, bytes: sym.text.length, byQuote, fields: Object.keys(S[0]), first: S[0] });
  const feeValues = {};
  for (const r of S) feeValues[`${r.maker_fee}/${r.taker_fee}`] = (feeValues[`${r.maker_fee}/${r.taker_fee}`] ?? 0) + 1;
  log('symbols_fee_fields', { makerSlashTaker: feeValues });
  const types = {};
  for (const r of info.json.result) types[r.contract_type] = (types[r.contract_type] ?? 0) + 1;
  const infoBy = new Map(info.json.result.map((r) => [r.symbol, r]));
  let sizeAgree = 0;
  const sizeDiff = [];
  for (const r of S) {
    const i = infoBy.get(r.symbol);
    if (i && Number(i.contract_price) === Number(r.contract_size)) sizeAgree++;
    else sizeDiff.push([r.symbol, r.contract_size, i?.contract_price]);
  }
  const sizes = {};
  for (const r of S) sizes[r.contract_size] = (sizes[r.contract_size] ?? 0) + 1;
  log('info', { rows: info.json.result.length, contractTypes: types, first: info.json.result[0], contractSizeAgrees: sizeAgree, sizeDiff: sizeDiff.slice(0, 5) });
  log('contract_sizes', { distinct: Object.keys(sizes).length, top: Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 8) });
  const sets = {
    symbols: new Set(S.map((r) => r.symbol)),
    info: new Set(info.json.result.map((r) => r.symbol)),
    precision: new Set(Object.keys(prec.json.result)),
    h24: new Set(h24.json.result.map((r) => r.symbol)),
  };
  const only = (a, b) => [...sets[a]].filter((x) => !sets[b].has(x));
  log('symbol_sets', { symbols: sets.symbols.size, info: sets.info.size, precision: sets.precision.size, h24: sets.h24.size, symbolsNotIn24hr: only('symbols', 'h24'), h24NotInSymbols: only('h24', 'symbols') });
  const nonAscii = S.map((r) => r.symbol).filter((s) => /[^\x00-\x7f]/.test(s));
  const pattern = S.filter((r) => r.symbol !== `${r.base_currency}-${r.quote_currency}`).map((r) => [r.symbol, r.base_currency]);
  const baseDup = {};
  for (const r of S) baseDup[r.base_currency] = (baseDup[r.base_currency] ?? 0) + 1;
  log('symbol_shape', { nonAscii, notBaseDashQuote: pattern.slice(0, 10), basesListedTwice: Object.entries(baseDup).filter(([, n]) => n > 1) });

  const web = await getJson(`${CAPI}/webApi/market/getSymbolList`);
  save('capi_getSymbolList.json', web.text);
  const W = web.json.result;
  const flags = {};
  const status = {};
  for (const r of W) {
    const k = `tradfi=${r.isTradFi} cfd=${r.isCfd} crypto=${r.isCrypto}`;
    flags[k] = (flags[k] ?? 0) + 1;
    status[r.status] = (status[r.status] ?? 0) + 1;
  }
  const webNames = new Set(W.map((r) => `${r.currency}-${r.tradeCurrency}`));
  log('web_symbol_list', { status: web.status, rows: W.length, bytes: web.text.length, flags, status, notInOapi: [...webNames].filter((x) => !sets.symbols.has(x)).slice(0, 10), oapiNotInWeb: [...sets.symbols].filter((x) => !webNames.has(x)).slice(0, 10) });
  const tradfi = W.filter((r) => r.isTradFi === 1 || r.isCfd === 1).map((r) => r.currency);
  log('web_tradfi', { count: tradfi.length, names: tradfi });
  const spotQuotes = {};
  for (const r of spot.json.result ?? []) spotQuotes[r.quote_currency ?? r.quoteCurrency ?? '?'] = (spotQuotes[r.quote_currency ?? r.quoteCurrency ?? '?'] ?? 0) + 1;
  log('spot', { status: spot.status, rows: (spot.json.result ?? []).length, firstKeys: Object.keys((spot.json.result ?? [])[0] ?? {}), quotes: spotQuotes });
}

async function anchor() {
  const polls = 60;
  const binAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  const t24 = [];
  const tIdx = [];
  const tWeb = [];
  const size = {};
  const prev = { idx24: new Map(), fund: new Map(), next: new Map(), idx: new Map(), idxTs: new Map() };
  const changes = { idx24: new Map(), fund: new Map(), next: new Map(), idx: new Map(), idxTs: new Map() };
  const webPrev = new Map();
  const webChanges = new Map();
  const idxVsIdx = [];
  const webVsBulk = [];
  const idxTsAge = [];
  const zeroIdxPolls = [];
  const idxVsMark = { BTC: [], ETH: [] };
  const markVsLast = { BTC: [], ETH: [] };
  const vsBinance = { web: { BTC: [], ETH: [] }, bulk: { BTC: [], ETH: [] }, idx: { BTC: [], ETH: [] }, mark: { BTC: [], ETH: [] } };
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const track = (kind, key, value) => {
    const p = prev[kind].get(key);
    if (p !== undefined && p !== value) bump(changes[kind], key);
    prev[kind].set(key, value);
  };
  let first24 = null;
  for (let i = 0; i < polls; i++) {
    const start = Date.now();
    const a = await getJson(`${OAPI}/v1/futures/24hr`);
    t24.push(a.ms);
    size.h24 = a.text.length;
    if (!first24) first24 = a.json.result;
    const b = await getJson(`${OAPI}/v1/futures/index_price`);
    const arrival = Date.now();
    tIdx.push(b.ms);
    size.idx = b.text.length;
    const idxBy = new Map(b.json.result.map((r) => [r.symbol, r]));
    for (const r of a.json.result) {
      track('idx24', r.symbol, r.index_price);
      track('fund', r.symbol, r.funding_rate);
      track('next', r.symbol, r.next_funding_rate_times);
      const x = idxBy.get(r.symbol);
      if (x && Number(x.price) > 0 && Number(r.index_price) > 0) idxVsIdx.push(Math.abs(Number(r.index_price) / Number(x.price) - 1) * 1e6);
    }
    zeroIdxPolls.push(b.json.result.filter((r) => !(Number(r.price) > 0)).map((r) => r.symbol));
    const bin = {};
    for (const c of ['BTC', 'ETH']) {
      const p = await getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${c}USDT`, { agent: binAgent });
      bin[c] = Number(p.json?.indexPrice);
    }
    for (const r of b.json.result) {
      track('idx', r.symbol, r.price);
      track('idxTs', r.symbol, r.ts);
      if (r.symbol === 'BTC-USDT') idxTsAge.push(arrival - r.ts * 1000);
    }
    for (const s of THREE) {
      const w = await getJson(`${CAPI}/webApi/market/getSymbolDetail?symbol=${encodeURIComponent(s)}`);
      tWeb.push(w.ms);
      const d = w.json?.result;
      if (!d) continue;
      for (const f of ['markerPrice', 'indexPrice', 'capitalRate', 'countdown', 'newPrice']) {
        const k = `${s}.${f}`;
        if (webPrev.has(k) && webPrev.get(k) !== d[f]) bump(webChanges, k);
        webPrev.set(k, d[f]);
      }
      const bulk = a.json.result.find((r) => r.symbol === s);
      const c = s.split('-')[0];
      if (bulk && bin[c] > 0) {
        const ppm = (x) => Math.round((Number(x) / bin[c] - 1) * 1e6);
        vsBinance.web[c].push(ppm(d.indexPrice));
        vsBinance.bulk[c].push(ppm(bulk.index_price));
        vsBinance.idx[c].push(ppm(idxBy.get(s)?.price));
        vsBinance.mark[c].push(ppm(d.markerPrice));
        const rel = (x, y) => Math.round((Number(x) / Number(y) - 1) * 1e6);
        idxVsMark[c].push(rel(idxBy.get(s)?.price, d.markerPrice));
        markVsLast[c].push(rel(d.markerPrice, d.newPrice));
      }
      if (bulk) webVsBulk.push({ s, webIndex: d.indexPrice, bulkIndex: bulk.index_price, idxPrice: idxBy.get(s)?.price, mark: d.markerPrice, webRate: d.capitalRate, bulkRate: bulk.funding_rate, countdown: d.countdown, next: bulk.next_funding_rate_times, at: Math.floor(arrival / 1000) });
    }
    const wait = 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
  }
  const dist = (m) => {
    const vals = [...prev.idx24.keys()].map((k) => m.get(k) ?? 0);
    return { zero: vals.filter((v) => v === 0).length, median: stats(vals).median, max: Math.max(...vals) };
  };
  log('anchor_calls', { polls, h24: { bytes: size.h24, ms: stats(t24) }, index_price: { bytes: size.idx, ms: stats(tIdx) }, webDetail: { ms: stats(tWeb) } });
  log('anchor_changes', { idx24: dist(changes.idx24), idx: dist(changes.idx), idxTs: dist(changes.idxTs), fund: dist(changes.fund), next: dist(changes.next), btc: { idx24: changes.idx24.get('BTC-USDT') ?? 0, idx: changes.idx.get('BTC-USDT') ?? 0, idxTs: changes.idxTs.get('BTC-USDT') ?? 0 } });
  log('index_vs_index_ppm', stats(idxVsIdx));
  log('index_ts_age_ms_btc', stats(idxTsAge));
  log('web_detail_changes', Object.fromEntries(webChanges));
  const zc = {};
  for (const z of zeroIdxPolls) for (const s of z) zc[s] = (zc[s] ?? 0) + 1;
  log('index_price_zero', { pollsWithAZero: zeroIdxPolls.filter((z) => z.length > 0).length, bySymbol: zc });
  log('index_price_vs_web_mark_ppm', { BTC: stats(idxVsMark.BTC), ETH: stats(idxVsMark.ETH) });
  log('web_mark_vs_web_last_ppm', { BTC: stats(markVsLast.BTC), ETH: stats(markVsLast.ETH) });
  for (const k of Object.keys(vsBinance)) log('vs_binance_index_ppm', { source: k, BTC: stats(vsBinance[k].BTC), ETH: stats(vsBinance[k].ETH) });
  log('web_vs_bulk_first', { rows: webVsBulk.slice(0, 3) });
  log('web_vs_bulk_last', { rows: webVsBulk.slice(-3) });
  const r0 = first24;
  const zeroIdx = r0.filter((r) => !(Number(r.index_price) > 0)).map((r) => r.symbol);
  const types = { index_price: typeof r0[0].index_price, funding_rate: typeof r0[0].funding_rate, next: typeof r0[0].next_funding_rate_times, bid: typeof r0[0].bid };
  const nextVals = {};
  for (const r of r0) nextVals[r.next_funding_rate_times] = (nextVals[r.next_funding_rate_times] ?? 0) + 1;
  const rates = {};
  for (const r of r0) rates[r.funding_rate] = (rates[r.funding_rate] ?? 0) + 1;
  log('h24_shape', { fields: Object.keys(r0[0]), types, zeroOrMissingIndex: zeroIdx, nextFundingValues: nextVals, fundingRateValues: Object.entries(rates).sort((a, b) => b[1] - a[1]).slice(0, 8), distinctRates: Object.keys(rates).length });
}

async function funding() {
  const h = await getJson(`${OAPI}/v1/futures/24hr`);
  const by = new Map(h.json.result.map((r) => [r.symbol, r]));
  for (const s of THREE) {
    const one = await getJson(`${OAPI}/v1/futures/funding_rate?symbol=${encodeURIComponent(s)}`);
    const d = await getJson(`${CAPI}/webApi/market/getSymbolDetail?symbol=${encodeURIComponent(s)}`);
    const r = d.json.result;
    log('funding_now', { s, single: one.json, bulk: by.get(s)?.funding_rate, bulkNext: by.get(s)?.next_funding_rate_times, web: { capitalRate: r.capitalRate, capitalRateMin: r.capitalRateMin, capitalRateMax: r.capitalRateMax, countdown: r.countdown, feeCycle: r.feeCycle, settlementTime: r.settlementTime, premiumPriceRatio: r.premiumPriceRatio, indexSource: r.indexSource, serviceRate: r.serviceRate, faceValue: r.faceValue }, at: Math.floor(Date.now() / 1000) });
    const hist = await getJson(`${CAPI}/webApi/capital/settle?symbol=${encodeURIComponent(s)}`);
    const rows = hist.json?.result ?? [];
    const gaps = rows.slice(1).map((x, i) => rows[i].settleTime - x.settleTime);
    const gapCount = {};
    for (const g of gaps) gapCount[g] = (gapCount[g] ?? 0) + 1;
    const utc = rows.slice(0, 4).map((x) => new Date(x.settleTime * 1000).toISOString().slice(0, 19));
    const rateCount = {};
    for (const x of rows) rateCount[x.capitalRate] = (rateCount[x.capitalRate] ?? 0) + 1;
    log('funding_history', { s, rows: rows.length, fields: Object.keys(rows[0] ?? {}), newest: rows[0], newestUtc: utc, snapshotLeadS: rows[0] ? rows[0].settleTime - rows[0].snapshotTime : null, gapsS: gapCount, rates: rateCount });
    await sleep(500);
  }
  // Three contracts whose next settlement is the earliest, to read their interval from history.
  const earliest = Math.min(...h.json.result.map((r) => r.next_funding_rate_times));
  const early = h.json.result.filter((r) => r.next_funding_rate_times === earliest).slice(0, 3).map((r) => r.symbol);
  for (const s of early) {
    const d = await getJson(`${CAPI}/webApi/market/getSymbolDetail?symbol=${encodeURIComponent(s)}`);
    const hist = await getJson(`${CAPI}/webApi/capital/settle?symbol=${encodeURIComponent(s)}`);
    const rows = hist.json?.result ?? [];
    const gaps = {};
    for (let i = 1; i < rows.length; i++) gaps[rows[i - 1].settleTime - rows[i].settleTime] = (gaps[rows[i - 1].settleTime - rows[i].settleTime] ?? 0) + 1;
    log('funding_early_group', { s, next: earliest, feeCycle: d.json?.result?.feeCycle, settlementTime: d.json?.result?.settlementTime, capitalRateMin: d.json?.result?.capitalRateMin, capitalRateMax: d.json?.result?.capitalRateMax, historyRows: rows.length, gapsS: gaps, newestUtc: rows.slice(0, 3).map((x) => new Date(x.settleTime * 1000).toISOString().slice(0, 16)) });
    await sleep(500);
  }
  const intervals = {};
  const now = Math.floor(Date.now() / 1000);
  for (const r of h.json.result) {
    const k = `${(r.next_funding_rate_times + 1) % 3600 === 0 ? 'hour-1s' : 'other'} in ${Math.round((r.next_funding_rate_times - now) / 60)} min`;
    intervals[k] = (intervals[k] ?? 0) + 1;
  }
  log('next_funding_spread', intervals);
}

async function book() {
  const symbols = ['BTC-USDT', 'ETH-USDT', 'PLTR-USDT', 'LAPTOP-USDT'];
  for (const s of symbols) {
    for (const limit of [50, 100, 200]) {
      const r = await getJson(`${OAPI}/v1/futures/depth?symbol=${encodeURIComponent(s)}&limit=${limit}`);
      const d = r.json?.result;
      if (!d) {
        log('depth', { s, limit, status: r.status, body: r.text.slice(0, 200) });
        continue;
      }
      const bids = d.bids.map(([p, q]) => [Number(p), Number(q)]);
      const asks = d.asks.map(([p, q]) => [Number(p), Number(q)]);
      const desc = bids.every((x, i) => i === 0 || x[0] <= bids[i - 1][0]);
      const asc = asks.every((x, i) => i === 0 || x[0] >= asks[i - 1][0]);
      const repB = bids.filter((x, i) => i > 0 && x[0] === bids[i - 1][0]).length;
      const repA = asks.filter((x, i) => i > 0 && x[0] === asks[i - 1][0]).length;
      log('depth', { s, limit, ms: round(r.ms), bytes: r.text.length, keys: Object.keys(d), buyType: d.buyType, sellType: d.sellType, bids: bids.length, asks: asks.length, bidsDesc: desc, asksAsc: asc, repeatedBidPrices: repB, repeatedAskPrices: repA, top: { bid: d.bids[0], ask: d.asks[0] }, numberType: typeof d.bids[0]?.[1], ts: d.ts, ageMs: Date.now() - d.ts });
      await sleep(400);
    }
  }
  const a = await getJson(`${OAPI}/v1/futures/depth?symbol=BTC-USDT&limit=50`);
  const b = await getJson(`${OAPI}/v1/futures/depth?symbol=BTC-USDT&limit=50`);
  log('depth_twice', { ms: [round(a.ms), round(b.ms)], sameTs: a.json.result.ts === b.json.result.ts, sameBody: a.text === b.text, cfCache: [a.headers['cf-cache-status'], b.headers['cf-cache-status']] });
  for (const depth of ['0.1', '1', '0.0001']) {
    const m = await getJson(`${OAPI}/v1/futures/depth_merged?symbol=BTC-USDT&depth=${depth}`);
    const d = m.json?.result;
    log('depth_merged', { depth, status: m.status, errno: m.json?.errno, errmsg: m.json?.errmsg, bids: d?.bids?.length, asks: d?.asks?.length, first: d?.bids?.[0], body: d ? undefined : m.text.slice(0, 160) });
    await sleep(400);
  }
}

async function errors() {
  const cases = [
    `${OAPI}/v1/futures/depth?symbol=NOPE-USDT`,
    `${OAPI}/v1/futures/depth`,
    `${OAPI}/v1/futures/depth?symbol=btc-usdt`,
    `${OAPI}/v1/futures/depth?symbol=BTCUSDT`,
    `${OAPI}/v1/futures/funding_rate`,
    `${OAPI}/v1/futures/funding_rate?symbol=NOPE-USDT`,
    `${OAPI}/v1/futures/index_price?symbol=NOPE-USDT`,
    `${OAPI}/v1/futures/24hr?symbol=NOPE-USDT`,
    `${OAPI}/v1/futures/nope`,
    `${CAPI}/webApi/market/getSymbolDetail?symbol=NOPE-USDT`,
    `${CAPI}/webApi/market/getSymbolDetail`,
  ];
  for (const url of cases) {
    const r = await get(url);
    log('error_case', { url: url.replace(/^https:\/\//, ''), status: r.status, contentType: r.headers['content-type'], retryAfter: r.headers['retry-after'] ?? null, body: r.text.slice(0, 180) });
    await sleep(400);
  }
  const r = await get(`${OAPI}/v1/futures/24hr`);
  log('rate_headers', { headers: Object.keys(r.headers).filter((h) => /rate|limit|remaining|retry/i.test(h)) });
}

async function clock() {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${OAPI}/v1/futures/index_price?symbol=BTC-USDT`);
    const t1 = Date.now();
    const server = Date.parse(r.headers.date);
    offsets.push({ dateHeaderMinusMid: server - (t0 + t1) / 2, rtt: t1 - t0, indexTs: r.text.match(/"ts":(\d+)/)?.[1] });
    await sleep(1100);
  }
  log('clock', { note: 'Date header has 1 s resolution', offsets });
}

const modes = { latency, catalog, anchor, funding, book, errors, clock };
const mode = process.argv[2] ?? 'catalog';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
await modes[mode]();
keepAlive.destroy();
