// TokoCrypto REST probe: host latency, the spot catalog and how CCXT maps it, the absence of any index, mark or funding call,
// the reference and average price calls it does publish, the REST book on each host and against Binance's own book,
// the fee schedule endpoint, rate limit headers, error shapes and server time.
// Public, unauthenticated, read-only. www.tokocrypto.site returns no weight header, and at the depth weights Binance publishes the main mode
// spends about 450 of the 6,000 per minute Binance allows an IP. www.tokocrypto.com reports a 1,200 per minute budget, and main spends under 40 of it.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/tokocrypto/rest-probe.mjs [main|poll]
//   main  latency, catalog, CCXT loadMarkets, anchor candidates, books, shared book check, fees, errors, time. About 45 s.
//   poll  referencePrice, avgPrice and ticker/price for BTCUSDT and a quiet pair once a second for 60 s. About 62 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/tokocrypto/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const TOKO = 'https://www.tokocrypto.com';
const SITE = 'https://www.tokocrypto.site';
const NEXTME = 'https://cloudme-toko.2meta.app';
const BINANCE = 'https://api.binance.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const headers = {};
  for (const [k, v] of res.headers) {
    if (/^x-mbx|^retry-after|^x-cache|^x-amz-cf-pop|^server$|^age$|^cache-control/.test(k)) headers[k] = v;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, json, text, headers };
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: Math.min(...xs), median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs) });

async function latency() {
  for (const host of ['www.tokocrypto.com', 'www.tokocrypto.site', 'cloudme-toko.2meta.app', 'stream-cloud.tokocrypto.site', 'stream-toko.2meta.app', 'api.binance.com']) {
    try {
      const a = await dns.lookup(host, { all: true });
      log('dns', { host, addresses: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host, error: String(e) });
    }
  }
  const targets = [
    ['toko time', `${TOKO}/open/v1/common/time`],
    ['site time', `${SITE}/api/v3/time`],
    ['nextme depth', `${NEXTME}/api/v1/depth?symbol=ALCHIDR&limit=5`],
    ['binance time', `${BINANCE}/api/v3/time`],
  ];
  for (const [name, url] of targets) {
    const times = [];
    let first;
    for (let i = 0; i < 6; i++) {
      const r = await get(url);
      if (i === 0) first = r;
      else times.push(r.ms);
      await sleep(150);
    }
    log('latency', { name, url, status: first.status, coldMs: first.ms, warm: stats(times), headers: first.headers });
  }
}

async function catalog() {
  const r = await get(`${TOKO}/open/v1/common/symbols`);
  keep('symbols.json', r.text);
  const list = r.json.data.list;
  const count = (f) => list.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  log('symbols', {
    status: r.status,
    ms: r.ms,
    bytes: r.bytes,
    rows: list.length,
    byType: count((x) => x.type),
    byTypeQuote: count((x) => `${x.type}/${x.quoteAsset}`),
    spotTradingEnable: count((x) => x.spotTradingEnable),
    permissions: count((x) => JSON.stringify(x.permissions)),
    keys: Object.keys(list[0]),
  });

  const ex = new ccxt.tokocrypto();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const btc = markets['BTC/USDT'];
  const idr = markets['BTC/IDR'];
  log('ccxt', {
    version: ccxt.version,
    loadMs: Math.round(performance.now() - t0),
    markets: all.length,
    active: all.filter((m) => m.active).length,
    spot: all.filter((m) => m.spot).length,
    swap: all.filter((m) => m.swap).length,
    contract: all.filter((m) => m.contract).length,
    hasSwap: ex.has.swap,
    hasFuture: ex.has.future,
    feesTrading: ex.fees.trading,
    btcUsdt: { id: btc.id, type: btc.type, taker: btc.taker, maker: btc.maker, contractSize: btc.contractSize, linear: btc.linear, active: btc.active, precision: btc.precision },
    btcIdr: { id: idr.id, taker: idr.taker, maker: idr.maker },
    takerValues: [...new Set(all.map((m) => m.taker))],
    idsWithUnderscore: all.filter((m) => m.id.includes('_')).length,
    doubleListed: all.length - new Set(all.map((m) => `${m.base}/${m.quote}`)).size,
  });
  return list;
}

async function anchorCandidates() {
  const probes = [
    ['fapi premiumIndex on site', `${SITE}/fapi/v1/premiumIndex?symbol=BTCUSDT`],
    ['fapi premiumIndex on toko', `${TOKO}/fapi/v1/premiumIndex?symbol=BTCUSDT`],
    ['futures page', `${TOKO}/futures/BTCUSDT`],
    ['referencePrice', `${SITE}/api/v3/referencePrice?symbol=BTCUSDT`],
    ['referencePrice calculation', `${SITE}/api/v3/referencePrice/calculation?symbol=BTCUSDT`],
    ['referencePrice no symbol', `${SITE}/api/v3/referencePrice`],
    ['avgPrice', `${SITE}/api/v3/avgPrice?symbol=BTCUSDT`],
    ['executionRules', `${SITE}/api/v3/executionRules?symbol=BTCUSDT`],
    ['ticker/price all', `${SITE}/api/v3/ticker/price`],
    ['ticker/bookTicker all', `${SITE}/api/v3/ticker/bookTicker`],
    ['nextme bookTicker all', `${NEXTME}/api/v1/ticker/bookTicker`],
  ];
  for (const [name, url] of probes) {
    const r = await get(url);
    const rows = Array.isArray(r.json) ? r.json.length : undefined;
    const sample = Array.isArray(r.json) ? r.json[0] : r.json ?? r.text.slice(0, 120).replace(/\s+/g, ' ');
    log('anchor', { name, status: r.status, ms: r.ms, bytes: r.bytes, rows, sample, weight: r.headers['x-mbx-used-weight-1m'] });
    await sleep(200);
  }
}

async function books(list) {
  for (const limit of [5, 20, 100, 500, 1000, 5000, 7]) {
    const r = await get(`${SITE}/api/v3/depth?symbol=BTCUSDT&limit=${limit}`);
    const j = r.json ?? {};
    const bids = j.bids ?? [];
    const asks = j.asks ?? [];
    log('depth', {
      limit,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      levels: [bids.length, asks.length],
      bidsDesc: bids.every((b, i) => i === 0 || Number(b[0]) < Number(bids[i - 1][0])),
      asksAsc: asks.every((a, i) => i === 0 || Number(a[0]) > Number(asks[i - 1][0])),
      error: j.code,
      msg: j.msg,
      weight: r.headers['x-mbx-used-weight-1m'],
    });
    await sleep(200);
  }
  // The same book read from TokoCrypto's hosts and from Binance at the same instant.
  for (const sym of ['BTCUSDT', 'ETHUSDC', 'BTCIDR', 'SOLUSD1']) {
    const [site, toko, bn] = await Promise.all([
      get(`${SITE}/api/v3/depth?symbol=${sym}&limit=5`),
      get(`${TOKO}/open/v1/market/depth?symbol=${list.find((x) => x.symbol.replace('_', '') === sym)?.symbol ?? sym}&limit=5`),
      get(`${BINANCE}/api/v3/depth?symbol=${sym}&limit=5`),
    ]);
    const s = site.json ?? {};
    const t = toko.json?.data ?? {};
    const b = bn.json ?? {};
    log('shared book', {
      sym,
      status: [site.status, toko.status, bn.status],
      ms: [site.ms, toko.ms, bn.ms],
      lastUpdateId: [s.lastUpdateId, t.lastUpdateId, b.lastUpdateId],
      bestBid: [s.bids?.[0], t.bids?.[0], b.bids?.[0]],
      bestAsk: [s.asks?.[0], t.asks?.[0], b.asks?.[0]],
    });
    await sleep(200);
  }
  // Caching: five reads 200 ms apart.
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${SITE}/api/v3/depth?symbol=BTCUSDT&limit=5`);
    ids.push(r.json?.lastUpdateId);
    await sleep(200);
  }
  log('depth caching', { ids, distinct: new Set(ids).size });
  const nm = [];
  for (let i = 0; i < 3; i++) {
    const r = await get(`${NEXTME}/api/v1/depth?symbol=NBTUSDT&limit=5`);
    nm.push({ status: r.status, ms: r.ms, id: r.json?.lastUpdateId, E: r.json?.E, T: r.json?.T, localMs: Date.now(), cache: r.headers['x-cache'], age: r.headers.age, bid: r.json?.bids?.[0], ask: r.json?.asks?.[0] });
    await sleep(1000);
  }
  log('nextme depth', { reads: nm });
}

async function feesAndErrors() {
  const v = await get(`${TOKO}/v1/common/vip-rules`);
  keep('vip-rules.json', v.text);
  const rows = v.json?.data?.list ?? [];
  log('vip rules', {
    status: v.status,
    ms: v.ms,
    rows: rows.map((r) => [r.vipLevel, r.tradeVolume, r.balance, r.takerCommission, r.makerCommission, r.takerTax, r.makerTax, r.takerSpecificAssetPayFeeDiscount]),
  });
  const sc = await get(`${TOKO}/v1/common/system-config`);
  const d = sc.json?.data ?? {};
  log('system config', {
    status: sc.status,
    specificAsset: d.specificAsset,
    specificAssetPayFeeDiscount: d.specificAssetPayFeeDiscount,
    binanceApiBaseUrlList: d.binanceApiBaseUrlList,
    binanceWssBaseUrlList: d.binanceWssBaseUrlList,
    binanceWssApiBaseUrl: d.binanceWssApiBaseUrl,
    nextMeWssBaseUrl: d.nextMeWssBaseUrl,
    nextMeApiBaseUrl: d.nextMeApiBaseUrl,
    apiDomainListV2: (d.apiDomainListV2 ?? []).map((x) => x.domain),
  });
  const errs = [
    ['site bad symbol', `${SITE}/api/v3/depth?symbol=NOPEUSDT&limit=5`],
    ['site underscore symbol', `${SITE}/api/v3/depth?symbol=BTC_USDT&limit=5`],
    ['site bad limit', `${SITE}/api/v3/depth?symbol=BTCUSDT&limit=abc`],
    ['site unknown path', `${SITE}/api/v3/nope`],
    ['toko bad symbol', `${TOKO}/open/v1/market/depth?symbol=NOPE_USDT&limit=5`],
    ['toko private without key', `${TOKO}/open/v1/account/spot`],
    ['nextme bad symbol', `${NEXTME}/api/v1/depth?symbol=NOPEIDR&limit=5`],
    ['nextme time', `${NEXTME}/api/v1/time`],
  ];
  for (const [name, url] of errs) {
    const r = await get(url);
    log('error shape', { name, status: r.status, ms: r.ms, body: r.text.slice(0, 160).replace(/\s+/g, ' '), headers: r.headers });
    await sleep(200);
  }
}

async function serverTime() {
  for (const [name, url, field] of [
    ['toko', `${TOKO}/open/v1/common/time`, 'timestamp'],
    ['site', `${SITE}/api/v3/time`, 'serverTime'],
  ]) {
    const offsets = [];
    const rtts = [];
    for (let i = 0; i < 6; i++) {
      const t0 = Date.now();
      const r = await get(url);
      const t1 = Date.now();
      const server = r.json?.[field];
      if (i > 0) {
        offsets.push(server - (t0 + t1) / 2);
        rtts.push(t1 - t0);
      }
      await sleep(200);
    }
    log('server time', { name, offsetMs: stats(offsets.map(Math.round)), rttMs: stats(rtts) });
  }
}

async function poll() {
  const series = { ref: [], avg: [], price: [], refQuiet: [], priceQuiet: [] };
  const ms = { ref: [], avg: [], price: [] };
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const [ref, avg, price, refQuiet, priceQuiet] = await Promise.all([
      get(`${SITE}/api/v3/referencePrice?symbol=BTCUSDT`),
      get(`${SITE}/api/v3/avgPrice?symbol=BTCUSDT`),
      get(`${SITE}/api/v3/ticker/price?symbol=BTCUSDT`),
      get(`${SITE}/api/v3/referencePrice?symbol=BTCIDR`),
      get(`${SITE}/api/v3/ticker/price?symbol=BTCIDR`),
    ]);
    series.ref.push(ref.json?.referencePrice);
    series.avg.push(avg.json?.price);
    series.price.push(price.json?.price);
    series.refQuiet.push(refQuiet.json?.referencePrice);
    series.priceQuiet.push(priceQuiet.json?.price);
    ms.ref.push(ref.ms);
    ms.avg.push(avg.ms);
    ms.price.push(price.ms);
    if (i === 59) log('poll weight', { weight: ref.headers['x-mbx-used-weight-1m'], refTs: ref.json?.timestamp, localMs: Date.now() });
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  const changes = (xs) => xs.filter((x, i) => i > 0 && x !== xs[i - 1]).length;
  log('poll', {
    polls: 60,
    changes: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, changes(v)])),
    first: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, v[0]])),
    refVsPricePpm: Math.round(((Number(series.price[59]) - Number(series.ref[59])) / Number(series.ref[59])) * 1e6),
    ms: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, stats(v)])),
  });
}

const mode = process.argv[2] ?? 'main';
if (mode === 'main') {
  await latency();
  const list = await catalog();
  await anchorCandidates();
  await books(list);
  await feesAndErrors();
  await serverTime();
} else if (mode === 'poll') {
  await poll();
} else {
  console.error('mode is main or poll');
  process.exit(1);
}
