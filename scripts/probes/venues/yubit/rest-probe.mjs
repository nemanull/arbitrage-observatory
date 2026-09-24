// YUBIT REST probe: CCXT presence, hosts and latency, the web app's perpetual catalog, fee endpoints, access answers, per contract funding and mark history, and server time.
// YUBIT publishes no public API documentation, so every call here is one the www.yubit.com web app makes for an anonymous visitor, found in its script bundles.
// Public, unauthenticated and read-only.
// The one POST, ban-area/check with an empty body, is the check the web app sends for every visitor, and it changes no state.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/yubit/rest-probe.mjs [catalog|access|anchor|time]
//   catalog  CCXT exchange list, DNS, cold and warm catalog reads, catalog summary, fee endpoints, spot pair count, about 15 s
//   access   status codes of the openapi host, the docs, and the region answers the web app reads, about 10 s
//   anchor   funding history for four contracts, mark history for one, and a search for a bulk anchor call, about 10 s
//   time     the header names of one reply, then ten reads of a small call with the offset between the reply's time field and the local clock, about 5 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/yubit/rest.md and docs/profiles/yubit/fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const WWW = 'https://www.yubit.com';
const OPENAPI = 'https://openapi.yubit.com';
const MAPI = `${WWW}/mapi`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { redirect: 'manual', ...init });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

function count(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

async function catalog() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ccxt.exchanges.filter((x) => /yu|ybit/i.test(x)) });

  for (const host of ['www.yubit.com', 'yubit.com', 'openapi.yubit.com']) {
    try {
      const addrs = await lookup(host, { all: true });
      log('dns', { host, addrs: addrs.map((a) => a.address) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const url = `${MAPI}/trade/public/v1/market/dynamic_symbol`;
  const times = [];
  const cache = [];
  let reply;
  for (let i = 0; i < 6; i++) {
    reply = await get(url);
    times.push(reply.ms);
    cache.push(reply.headers.get('akamai-cache-status'));
    if (i === 0) log('catalog_first', { status: reply.status, ms: reply.ms, bytes: reply.bytes, cacheControl: reply.headers.get('cache-control') });
    await sleep(500);
  }
  log('catalog_warm', { ms: times.slice(1), median: median(times.slice(1)), akamaiCacheStatus: cache });
  const small = [];
  for (let i = 0; i < 5; i++) {
    small.push((await get(`${MAPI}/trade/public/v1/market/fee-rate`)).ms);
    await sleep(300);
  }
  log('small_call_warm', { path: 'fee-rate', ms: small });
  keep('dynamic_symbol.json', reply.text);

  const d = reply.json.data;
  log('catalog_keys', { code: reply.json.code, keys: Object.keys(d), SupportedCoins: d.SupportedCoins, OfflineTrade: d.OfflineTrade });
  for (const fam of ['LinearPerpetual', 'InversePerpetual', 'InverseFutures', 'FreeUPerpetual']) {
    const rows = d[fam] ?? [];
    log('family', {
      fam,
      rows: rows.length,
      contractStatus: count(rows, (r) => r.contractStatus),
      symbolStatus: count(rows, (r) => r.symbolStatus),
      quote: count(rows, (r) => r.quoteCurrency),
      takerE8: count(rows, (r) => r.defaultTakerFeeRateE8),
      makerE8: count(rows, (r) => r.defaultMakerFeeRateE8),
    });
  }

  const lin = d.LinearPerpetual;
  log('linear_fields', { perRow: count(lin, (r) => Object.keys(r).length) });
  const prefixed = lin.filter((r) => r.symbolName === 'M1' + r.symbolAlias);
  const odd = lin.filter((r) => r.symbolName !== 'M1' + r.symbolAlias).map((r) => [r.symbolName, r.symbolAlias, r.baseCurrency]);
  log('linear_names', { symbolNameIsM1PlusAlias: prefixed.length, aliasIsBasePlusQuote: lin.filter((r) => r.symbolAlias === r.baseCurrency + r.quoteCurrency).length, odd });
  const bases = count(lin, (r) => r.baseCurrency);
  log('linear_duplicates', { basesListedTwice: Object.entries(bases).filter(([, n]) => n > 1) });
  log('linear_index_sources', {
    sourcesPerContract: count(lin, (r) => (r.indexSource ?? []).length),
    single: count(lin.filter((r) => (r.indexSource ?? []).length === 1), (r) => r.indexSource[0]),
    anyYubit: lin.filter((r) => (r.indexSource ?? []).some((s) => /yubit/i.test(s))).length,
    examples: lin.filter((r) => ['BTCUSDT', 'ETHUSDT', 'NVDAUSDT', 'ONEUSDT'].includes(r.symbolAlias)).map((r) => [r.symbolName, r.indexSource]),
  });
  log('linear_limits', { priceLimitPntE6: count(lin, (r) => r.priceLimitPntE6), lotSizeBTC: lin.find((r) => r.symbolAlias === 'BTCUSDT')?.lotSize, tickBTC: lin.find((r) => r.symbolAlias === 'BTCUSDT')?.tickSize, tags: count(lin, (r) => r.symbolTags) });
  const inv = d.InversePerpetual.map((r) => [r.symbolName, r.contractStatus, r.minQty, r.lotSize, r.indexSource]);
  log('inverse', { inv, freeU: d.FreeUPerpetual.map((r) => [r.symbolName, r.quoteCurrency, r.contractStatus]) });

  const fee = await get(`${MAPI}/trade/public/v1/market/fee-rate`);
  log('fee_rate', { status: fee.status, ms: fee.ms, body: fee.json });
  const vip = await get(`${MAPI}/desk/vipfee/config`);
  log('vipfee_config', {
    status: vip.status,
    tiers: vip.json?.data?.list?.map((r) => [r.vipLevel, r.last30DaysSpotTurnover, r.last30DaysFutureTurnover, r.totalBalance, r.spotMakerFeeRate, r.spotTakerFeeRate, r.futureMakerFeeRate, r.futureTakerFeeRate]),
  });
  const spot = await get(`${MAPI}/spot-openapi/public/v1/market/summary-new`);
  log('spot_summary', { status: spot.status, bytes: spot.bytes, pairs: spot.json?.data?.length, quotes: count(spot.json?.data ?? [], (r) => r.quote_currency) });
  const plates = await get(`${MAPI}/trade/public/v1/market/plates`);
  log('plates', { status: plates.status, bytes: plates.bytes, plates: plates.json?.data?.data?.length });
}

async function access() {
  const urls = [
    [`${WWW}/`, 'GET'],
    [`${WWW}/en-US/vip-details`, 'GET'],
    [`${OPENAPI}/`, 'GET'],
    [`${OPENAPI}/en-US/`, 'GET'],
    [`${OPENAPI}/docs`, 'GET'],
    [`${OPENAPI}/api`, 'GET'],
    [`${OPENAPI}/v5/market/time`, 'GET'],
    [`${OPENAPI}/trade/public/v1/market/fee-rate`, 'GET'],
    [`${OPENAPI}/mapi/trade/public/v1/market/fee-rate`, 'GET'],
    ['https://yubit.com/', 'GET'],
    ['https://yubit.gitbook.io/yubit/other-help/announcements/feature-upgrade/openaiskill.md', 'GET'],
    ['https://yubit.gitbook.io/yubit/derivatives-trading/trading-fee-rate.md', 'GET'],
  ];
  for (const [url] of urls) {
    try {
      const r = await get(url, { signal: AbortSignal.timeout(15000) });
      log('status', { url, status: r.status, ms: r.ms, bytes: r.bytes, server: r.headers.get('server'), location: r.headers.get('location'), head: r.status >= 300 ? r.text.slice(0, 80) : undefined });
    } catch (e) {
      log('status', { url, error: e.name + ' ' + (e.cause?.code ?? e.message) });
    }
    await sleep(300);
  }
  for (const path of ['/user/public/v1/country-code', '/commom-public/google-play/public/v1/unavailable-regions']) {
    const r = await get(`${MAPI}${path}`);
    log('region', { path, status: r.status, body: r.json });
  }
  const ban = await get(`${MAPI}/user/public/v1/ban-area/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const b = ban.json?.data ?? {};
  log('ban_area', { status: ban.status, code: ban.json?.code, banned: b.banned, threatLevel: b.threatLevel, accessDecision: b.accessDecision, blocked: b.blocked });
}

async function anchor() {
  const now = Math.floor(Date.now() / 1000);
  for (const sym of ['M1BTCUSDT', 'M1ETHUSDT', 'M1NVDAUSDT', 'M1ONDOUSDT']) {
    const r = await get(`${MAPI}/trade/public/v1/market/funding-rate-history?symbol=${sym}&from=${now - 3 * 86400}&to=${now}&timeStamp=${Date.now()}`);
    const list = r.json?.data?.list ?? [];
    const gaps = list.slice(0, -1).map((x, i) => (Number(x.time) - Number(list[i + 1].time)) / 3600);
    log('funding_history', {
      sym,
      status: r.status,
      ms: r.ms,
      rows: list.length,
      newest: list[0] ? [new Date(Number(list[0].time) * 1000).toISOString(), list[0].valueE8] : null,
      intervalsHours: count(gaps.map((g) => ({ g })), (x) => x.g),
      valuesE8: count(list, (x) => x.valueE8),
    });
    await sleep(300);
  }
  const m = await get(`${MAPI}/trade/public/v1/market/mark-price-list?symbol=M1BTCUSDT&resolution=1&from=${now - 180}&to=${now}`);
  log('mark_price_list', { status: m.status, ms: m.ms, bytes: m.bytes, rows: m.json?.data?.list?.length, last: m.json?.data?.list?.at(-1) });
  const nosym = await get(`${MAPI}/trade/public/v1/market/funding-rate-history?from=${now - 86400}&to=${now}`);
  log('funding_history_without_symbol', { status: nosym.status, body: nosym.text.slice(0, 200) });
  const risk = await get(`${MAPI}/trade/public/v1/market/risk-pool-list?symbol=M1BTCUSDT`);
  log('risk_pool_list', { status: risk.status, body: risk.text.slice(0, 200) });
  for (const path of ['/trade/public/v1/market/tickers', '/trade/public/v1/market/ticker', '/trade/public/v1/market/instruments', '/trade/public/v1/market/orderbook', '/trade/public/v1/market/depth']) {
    const r = await get(`${MAPI}${path}`);
    log('bulk_guess', { path, status: r.status, body: r.text.slice(0, 160) });
    await sleep(300);
  }
}

async function time() {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(`${MAPI}/trade/public/v1/market/fee-rate`);
    const t1 = Date.now();
    rows.push({ rtt: t1 - t0, offset: Number(r.json?.time) - (t0 + t1) / 2, date: r.headers.get('date') });
    await sleep(300);
  }
  const h = await get(`${MAPI}/trade/public/v1/market/fee-rate`);
  log('headers', { names: [...h.headers.keys()].sort(), rateLimitLike: [...h.headers.keys()].filter((k) => /limit|retry|quota|remain/i.test(k)) });
  log('time', { rtt: rows.map((r) => r.rtt), offsetMs: rows.map((r) => Math.round(r.offset)), medianOffsetMs: Math.round(median(rows.map((r) => r.offset))), date: rows[0].date });
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, access, anchor, time }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
