// AstralX REST probe: catalog, access refusals, latency and clock, the bulk funding and ticker calls polled once a second, and a comparison against OKX and Binance.
// AstralX publishes no API documentation, so every path here is one the www.astralx.com web front calls, read out of its JavaScript bundle on 2026-09-22.
// Public, unauthenticated, read-only. No account, no key, no order.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/astralx/rest-probe.mjs [catalog|access|latency|anchor|compare]
//   catalog  futures page symbol map (about 4 MB of HTML, fetched once) checked against the OKX instruments, the ticker and funding bulk rows, CCXT listing. About 10 s.
//   access   status and body of the refusals: api.astralx.com, the /openapi and /futures gateways, the help center VIP page, and the routes where docs, index, mark or a book could live. About 15 s.
//   latency  DNS, one cold and ten warm requests of the server time call, clock offset. About 10 s.
//   anchor   funding_rates and ticker polled once a second for 60 s, reply size and time, how often each field changed. About 65 s.
//   compare  AstralX ticker high, low and last against the OKX and Binance USDT perpetual tickers, and six funding rates against OKX. About 8 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/astralx/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const WWW = 'https://www.astralx.com';
const FUTURES_PAGE = `${WWW}/en-us/futures/BTCUSDT_PERP`;
const TICKER = `${WWW}/f_api/public/quote/ticker`;
const FUNDING = `${WWW}/futures/funding_rates`;
const TIME = `${WWW}/f_api/public/quote/time`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe', ...headers } });
  const text = await res.text();
  return { status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, text, headers: res.headers };
}

// Status and type only, and the body is dropped unread, because an unknown path returns the 4 MB Next.js 404 page.
async function status(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe' }, redirect: 'manual' });
  const type = res.headers.get('content-type');
  const small = type?.includes('json') ? (await res.text()).slice(0, 160) : undefined;
  if (!small) await res.body?.cancel();
  return { status: res.status, type, location: res.headers.get('location') ?? undefined, body: small };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

// The futures page is server rendered and embeds every listed contract as "<id>":{...} inside one map.
function symbolMapFromPage(html) {
  const raw = html.replace(/\\"/g, '"');
  const key = '"BTCUSDT_PERP":{';
  const at = raw.indexOf(key);
  if (at < 0) return null;
  let depth = 0;
  let start = at - 1;
  for (; start >= 0; start--) {
    if (raw[start] === '}') depth++;
    else if (raw[start] === '{') {
      if (depth === 0) break;
      depth--;
    }
  }
  let end = start;
  depth = 0;
  for (; end < raw.length; end++) {
    if (raw[end] === '{') depth++;
    else if (raw[end] === '}' && --depth === 0) break;
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function count(xs) {
  const m = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}

async function catalog() {
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, astralx: ccxt.exchanges.filter((e) => /astral/i.test(e)) });

  const page = await get(FUTURES_PAGE);
  keep('futures-page.html', page.text);
  const map = symbolMapFromPage(page.text);
  const ids = Object.keys(map ?? {});
  log('page', { status: page.status, bytes: page.bytes, ms: page.ms, contracts: ids.length });
  const rows = ids.map((id) => map[id]);
  log('page_fields', {
    category: count(rows.map((r) => r.category)),
    quote: count(rows.map((r) => r.quoteTokenId)),
    canTrade: count(rows.map((r) => r.canTrade)),
    showStatus: count(rows.map((r) => r.showStatus)),
    isReverse: count(rows.map((r) => String(r.isReverse))),
    fees: count(rows.map((r) => `taker ${r.takerBuyFee}/${r.takerSellFee} maker ${r.makerBuyFee}/${r.makerSellFee}`)),
    contractMultiplier: count(rows.map((r) => r.baseTokenFutures?.contractMultiplier)),
    indexTokenIsIdMinusPerp: rows.filter((r) => r.baseTokenFutures?.indexToken === r.symbolId.replace('_PERP', '')).length,
  });
  log('page_ids', { ids: ids.join(' ') });
  const btc = map.BTCUSDT_PERP;
  log('page_btc', {
    symbolId: btc.symbolId, baseTokenId: btc.baseTokenId, quoteTokenId: btc.quoteTokenId, minPricePrecision: btc.minPricePrecision,
    basePrecision: btc.basePrecision, minTradeQuantity: btc.minTradeQuantity, contractMultiplier: btc.baseTokenFutures.contractMultiplier,
    indexToken: btc.baseTokenFutures.indexToken, maxLeverage: btc.baseTokenFutures.maxLeverage, overPriceRange: btc.baseTokenFutures.overPriceRange,
    marketPriceRange: btc.baseTokenFutures.marketPriceRange, exchangeId: btc.exchangeId, fixFee: btc.fixFee,
    riskLimits: btc.baseTokenFutures.riskLimits.map((r) => `${r.riskLimitAmount}:${r.maintainMargin}:${r.initialMargin}`).join(' '),
  });
  for (const id of ['ETHUSDT_PERP', 'SOLUSDT_PERP', 'XRPUSDT_PERP', 'XAUUSDT_PERP']) {
    log('page_spec', { id, contractMultiplier: map[id]?.baseTokenFutures?.contractMultiplier, tick: map[id]?.minPricePrecision });
  }

  // The contract multipliers and ticks look like OKX's, so every listed contract is checked against the OKX instrument of the same base.
  const okxInst = new Map(JSON.parse((await get('https://www.okx.com/api/v5/public/instruments?instType=SWAP')).text).data.map((r) => [r.instId, r]));
  let onOkx = 0;
  let ctValEqual = 0;
  let tickEqual = 0;
  const differ = [];
  for (const r of rows) {
    const o = okxInst.get(`${r.baseTokenId}-USDT-SWAP`);
    if (!o) continue;
    onOkx++;
    const ct = Number(o.ctVal) === Number(r.baseTokenFutures?.contractMultiplier);
    const tick = Number(o.tickSz) === Number(r.minPricePrecision);
    if (ct) ctValEqual++;
    if (tick) tickEqual++;
    if (!ct || !tick) differ.push(`${r.symbolId} mult ${r.baseTokenFutures?.contractMultiplier}/${o.ctVal} tick ${r.minPricePrecision}/${o.tickSz}`);
  }
  log('page_vs_okx_instruments', { listed: rows.length, onOkx, ctValEqual, tickEqual, differ: differ.join(' | ') });

  const tk = await get(TICKER);
  keep('ticker.json', tk.text);
  const tkRows = JSON.parse(tk.text).data;
  const fr = await get(FUNDING);
  keep('funding_rates.json', fr.text);
  const frRows = JSON.parse(fr.text).data;
  const listed = new Set(ids);
  const hidden = tkRows.filter((r) => !listed.has(r.s));
  log('ticker', { status: tk.status, bytes: tk.bytes, rows: tkRows.length, keys: Object.keys(tkRows.find((r) => r.s === 'BTCUSDT_PERP')).join(','), notOnPage: hidden.length, notOnPageWithVolume: hidden.filter((r) => r.v > 0).length });
  log('ticker_hidden', { ids: hidden.map((r) => r.s).join(' ') });
  log('ticker_btc', tkRows.find((r) => r.s === 'BTCUSDT_PERP'));
  log('funding', {
    status: fr.status, bytes: fr.bytes, rows: frRows.length, keys: Object.keys(frRows[0]).join(','),
    notOnPage: frRows.filter((r) => !listed.has(r.tokenId)).length,
    nextSettleTime: count(frRows.map((r) => new Date(r.nextSettleTime).toISOString())),
    lastSettleTimeZero: frRows.filter((r) => r.lastSettleTime === 0).length,
    lastSettleTimeZeroOnPage: frRows.filter((r) => r.lastSettleTime === 0 && listed.has(r.tokenId)).length,
    intervalMs: count(frRows.filter((r) => r.lastSettleTime > 0).map((r) => r.nextSettleTime - r.lastSettleTime)),
    rateEqualsSettleRate: frRows.filter((r) => r.fundingRate === r.settleRate).length,
  });
  log('funding_btc', frRows.find((r) => r.tokenId === 'BTCUSDT_PERP'));
  const zeroOnPage = frRows.filter((r) => r.lastSettleTime === 0 && listed.has(r.tokenId)).map((r) => r.tokenId);
  log('funding_never_settled_on_page', { ids: zeroOnPage.join(' ') });

  const hist = await get(`${WWW}/futures/history_funding_rates?tokenId=BTCUSDT_PERP&limit=5`);
  log('history_funding_rates', { status: hist.status, body: hist.text.slice(0, 200) });
}

async function access() {
  for (const url of [
    'https://api.astralx.com/',
    'https://api.astralx.com/openapi/v1/time',
    `${WWW}/openapi/v1/time`,
    `${WWW}/openapi/nope`,
    `${WWW}/futures/nope`,
    `${WWW}/futures/quote/depth?symbol=BTCUSDT_PERP`,
    'https://support.astralx.com/hc/en-001/articles/6735922392335-VIP-Levels-and-Discounts',
  ]) {
    const r = await get(url);
    const title = /<title[^>]*>([^<]*)</i.exec(r.text)?.[1];
    log('access', { url, status: r.status, server: r.headers.get('server'), bytes: r.bytes, title, body: r.text.startsWith('<') ? undefined : r.text.slice(0, 160) });
  }
  // Places an API document or a REST index and mark call could live, all found absent or refused.
  for (const url of [
    `${WWW}/en-us/api`,
    `${WWW}/en-us/apiDoc`,
    `${WWW}/en-us/api-doc`,
    `${WWW}/en-us/openapi`,
    `${WWW}/apidoc`,
    `${WWW}/quote/indices?symbol=BTCUSDT_PERP`,
    `${WWW}/quote/markPrice?symbol=BTCUSDT_PERP`,
    `${WWW}/quote/depth?symbol=BTCUSDT_PERP`,
    `${WWW}/f_api/quote/depth?symbol=BTCUSDT_PERP`,
    `${WWW}/ipublic/basic/indices?symbol=BTCUSDT`,
  ]) {
    log('route', { url, ...(await status(url)) });
  }
  const trace = await get(`${WWW}/cdn-cgi/trace`);
  log('cf_trace', { loc: /loc=(\w+)/.exec(trace.text)?.[1], colo: /colo=(\w+)/.exec(trace.text)?.[1] });
}

async function latency() {
  for (const host of ['www.astralx.com', 'fws.astralx.com', 'api.astralx.com', 'support.astralx.com']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host, addrs: addrs.map((a) => a.address).join(' ') });
  }
  const cold = await get(TIME);
  log('cold', { status: cold.status, ms: cold.ms, body: cold.text.slice(0, 120) });
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(TIME);
    const t1 = Date.now();
    warm.push(r.ms);
    offsets.push(Number(JSON.parse(r.text).data) - (t0 + t1) / 2);
    await sleep(300);
  }
  log('warm', stats(warm));
  log('clock_offset_ms', stats(offsets.map(Math.round)));
}

async function anchor() {
  const watch = ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'SOLUSDT_PERP', 'GIGGLEUSDT_PERP', 'ZKPUSDT_PERP'];
  const last = {};
  const changes = {};
  const frMs = [];
  const tkMs = [];
  let frBytes = 0;
  let tkBytes = 0;
  const serverLag = [];
  const t0 = Date.now();
  let polls = 0;
  while (Date.now() - t0 < 60_000) {
    const tick = Date.now();
    const [fr, tk] = await Promise.all([get(FUNDING), get(TICKER)]);
    polls++;
    frMs.push(fr.ms);
    tkMs.push(tk.ms);
    frBytes = fr.bytes;
    tkBytes = tk.bytes;
    const frRows = new Map(JSON.parse(fr.text).data.map((r) => [r.tokenId, r]));
    const tkRows = new Map(JSON.parse(tk.text).data.map((r) => [r.s, r]));
    for (const id of watch) {
      const f = frRows.get(id);
      const t = tkRows.get(id);
      const now = { fundingRate: f?.fundingRate, settleRate: f?.settleRate, nextSettleTime: f?.nextSettleTime, curServerTime: f?.curServerTime, last: t?.c, bidField: t?.b, askField: t?.a, t: t?.t };
      for (const [k, v] of Object.entries(now)) {
        const key = `${id} ${k}`;
        if (last[key] !== undefined && last[key] !== v) changes[key] = (changes[key] ?? 0) + 1;
        last[key] = v;
      }
      if (t?.t) serverLag.push(Date.now() - Number(t.t));
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  log('anchor_polls', { polls, fundingBytes: frBytes, tickerBytes: tkBytes });
  log('funding_ms', stats(frMs));
  log('ticker_ms', stats(tkMs));
  log('ticker_age_ms', stats(serverLag));
  for (const id of watch) {
    const c = {};
    for (const k of ['fundingRate', 'settleRate', 'nextSettleTime', 'curServerTime', 'last', 'bidField', 'askField', 't']) c[k] = changes[`${id} ${k}`] ?? 0;
    log('changes_in_polls', { id, ...c });
  }
}

async function compare() {
  const ax = JSON.parse((await get(TICKER)).text).data.filter((r) => r.v > 0);
  const okx = new Map(JSON.parse((await get('https://www.okx.com/api/v5/market/tickers?instType=SWAP')).text).data.map((r) => [r.instId, r]));
  const bnRes = await get('https://fapi.binance.com/fapi/v1/ticker/24hr');
  const bn = bnRes.status === 200 ? new Map(JSON.parse(bnRes.text).map((r) => [r.symbol, r])) : new Map();
  let okxHighLow = 0;
  let bnHighLow = 0;
  let okxHigh = 0;
  let okxLast = 0;
  let onOkx = 0;
  const rel = [];
  for (const r of ax) {
    const base = r.s.replace('USDT_PERP', '');
    const o = okx.get(`${base}-USDT-SWAP`);
    const b = bn.get(`${base}USDT`);
    if (o) {
      onOkx++;
      if (Number(o.high24h) === r.h && Number(o.low24h) === r.l) okxHighLow++;
      if (Number(o.high24h) === r.h) okxHigh++;
      if (Number(o.last) === r.c) okxLast++;
      rel.push(Math.round(Math.abs(r.c / Number(o.last) - 1) * 1e6));
    }
    if (b && Number(b.highPrice) === r.h && Number(b.lowPrice) === r.l) bnHighLow++;
  }
  log('compare', { quoteVolume24hSum: Math.round(ax.reduce((sum, r) => sum + Number(r.qv), 0)), astralxWithVolume: ax.length, onOkx, okxHighAndLowEqual: okxHighLow, okxHighEqual: okxHigh, okxLastEqual: okxLast, binanceStatus: bnRes.status, binanceHighAndLowEqual: bnHighLow });
  log('last_vs_okx_ppm', stats(rel));
  const fr = new Map(JSON.parse((await get(FUNDING)).text).data.map((r) => [r.tokenId, r]));
  for (const base of ['BTC', 'ETH', 'SOL', 'DOGE', 'GIGGLE', 'ZKP']) {
    const o = JSON.parse((await get(`https://www.okx.com/api/v5/public/funding-rate?instId=${base}-USDT-SWAP`)).text).data?.[0];
    const a = fr.get(`${base}USDT_PERP`);
    log('funding_vs_okx', { base, astralxRate: a?.fundingRate, astralxNext: a?.nextSettleTime, okxRate: o?.fundingRate, okxFundingTime: o?.fundingTime, okxMax: o?.maxFundingRate, okxMin: o?.minFundingRate });
    await sleep(250);
  }
  const btc = ax.find((r) => r.s === 'BTCUSDT_PERP');
  const ob = okx.get('BTC-USDT-SWAP');
  log('btc', { astralx: { c: btc.c, h: btc.h, l: btc.l, o: btc.o, b: btc.b, a: btc.a, v: btc.v, qv: Math.round(btc.qv) }, okx: { last: ob.last, high24h: ob.high24h, low24h: ob.low24h, open24h: ob.open24h, bidPx: ob.bidPx, askPx: ob.askPx, vol24h: ob.vol24h } });
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, access, latency, anchor, compare }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
