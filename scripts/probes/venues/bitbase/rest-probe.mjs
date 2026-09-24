// Bitbase REST probe: DNS, the Cloudflare edge, what every public REST path the web app uses returns to this host, the archived catalog against the live socket, and the CCXT check.
// Public, unauthenticated, read-only. Bitbase publishes no API documentation, so the paths are the ones its web app calls and the XT style paths its code base implies.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitbase/rest-probe.mjs [access|archive|ccxt]
//   access   DNS, cdn-cgi/trace, and a cold and a warm request to each path, printing status, cf-mitigated, type, time and the page title. About 20 s.
//   archive  the Wayback Machine capture of the web app's symbol list from 2026-09-10, summarised and compared with 6 s of the live agg_tickers and tickers streams. About 15 s.
//   ccxt     whether CCXT 4.5.68 or the CCXT master branch on GitHub has a Bitbase class. About 3 s.
// Recorded in docs/profiles/bitbase/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', accept: 'application/json, text/plain, */*' };

const PATHS = [
  'https://www.bitbase.com/',
  'https://www.bitbase.com/rate',
  'https://www.bitbase.com/robots.txt',
  'https://www.bitbase.com/fapi/market/v1/public/symbol/list',
  'https://www.bitbase.com/fapi/market/v2/public/symbol/list?isPredict=true&isDelivery=true',
  'https://www.bitbase.com/fapi/market/v1/public/q/tickers',
  'https://www.bitbase.com/fapi/market/v1/public/q/agg-tickers',
  'https://www.bitbase.com/fapi/market/v1/public/q/depth?symbol=btc_usdt&level=50',
  'https://www.bitbase.com/fapi/market/v1/public/q/funding-rate?symbol=btc_usdt',
  'https://www.bitbase.com/fapi/market/v1/public/time',
  'https://www.bitbase.com/sapi/v4/public/time',
  'https://www.bitbase.com/sapi/v4/balance/public/currenciesV2',
  'https://fstream.bitbase.com/ws/market',
  'https://fapi.bitbase.com/future/market/v1/public/q/tickers',
  'https://support.bitbase.com/',
  'https://bitbase-support.zendesk.com/api/v2/help_center/en-us/categories.json',
];

async function hit(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers: UA, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    const ms = Math.round(performance.now() - t0);
    const title = body.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
    return {
      status: res.status,
      ms,
      cfMitigated: res.headers.get('cf-mitigated'),
      server: res.headers.get('server'),
      type: res.headers.get('content-type'),
      retryAfter: res.headers.get('retry-after'),
      location: res.headers.get('location'),
      bytes: body.length,
      title,
      head: title ? null : body.slice(0, 90).replace(/\s+/g, ' '),
    };
  } catch (e) {
    return { error: String(e.cause?.code ?? e.message), ms: Math.round(performance.now() - t0) };
  }
}

async function modeAccess() {
  for (const h of ['bitbase.com', 'www.bitbase.com', 'fstream.bitbase.com', 'stream.bitbase.com', 'fapi.bitbase.com', 'sapi.bitbase.com', 'api.bitbase.com', 'static.bitbase.com', 'support.bitbase.com']) {
    let cname = null;
    let a = null;
    try { cname = await dns.resolveCname(h); } catch (e) { cname = e.code; }
    try { a = await dns.resolve4(h); } catch (e) { a = e.code; }
    log('dns', { host: h, cname, a });
  }
  const trace = await (await fetch('https://www.bitbase.com/cdn-cgi/trace')).text();
  const kv = Object.fromEntries(trace.trim().split('\n').map((l) => l.split('=')));
  log('edge', { colo: kv.colo, loc: kv.loc, http: kv.http, tls: kv.tls, warp: kv.warp });
  for (const url of PATHS) {
    const cold = await hit(url);
    await sleep(300);
    const warm = await hit(url);
    log('path', { url, cold, warmMs: warm.ms, warmStatus: warm.status ?? warm.error });
    await sleep(300);
  }
}

async function modeArchive() {
  const url = 'https://web.archive.org/web/20260910123242id_/https://www.bitbase.com/fapi/market/v2/public/symbol/list?isPredict=true&isDelivery=true';
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString() : buf.toString();
  const j = JSON.parse(text);
  const syms = j.result.symbols;
  const count = (f) => syms.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  log('archive', {
    source: url,
    status: res.status,
    bytes: text.length,
    envelope: Object.keys(j),
    returnCode: j.returnCode,
    resultTime: j.result.time,
    rows: syms.length,
    contractType: count((r) => r.contractType),
    underlyingType: count((r) => r.underlyingType),
    quoteCoin: count((r) => r.quoteCoin),
    tradeSwitch: count((r) => r.tradeSwitch),
    isDisplay: count((r) => r.isDisplay),
    state: count((r) => r.state),
    contractSize: count((r) => r.contractSize),
    makerTaker: count((r) => `${r.makerFee}/${r.takerFee}`),
    liquidationFee: count((r) => r.liquidationFee),
    btc: syms.filter((r) => r.symbol === 'btc_usdt').map((r) => ({ symbol: r.symbol, contractSize: r.contractSize, pricePrecision: r.pricePrecision, quantityPrecision: r.quantityPrecision, minQty: r.minQty, makerFee: r.makerFee, takerFee: r.takerFee, liquidationFee: r.liquidationFee, isOpenApi: r.isOpenApi }))[0],
    fieldNames: Object.keys(syms[0]).length,
  });
  // The live list comes from the socket, since the REST list is behind the challenge.
  const WebSocket = require('ws');
  const ws = new WebSocket('wss://fstream.bitbase.com/ws/market', { perMessageDeflate: false });
  const live = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (d) => {
    try {
      const m = JSON.parse(d.toString());
      // agg_tickers repeats the contract amount in v, so only the tickers row carries turnover in quote currency.
      if (m.topic === 'agg_tickers') for (const row of m.data) if (!live.has(row.s)) live.set(row.s, {});
      if (m.topic === 'tickers') for (const row of m.data) live.set(row.s, row);
    } catch {}
  });
  ws.send(JSON.stringify({ id: 'a1', method: 'SUBSCRIBE', params: ['agg_tickers'] }));
  ws.send(JSON.stringify({ id: 'a2', method: 'SUBSCRIBE', params: ['tickers'] }));
  await sleep(6_000);
  ws.terminate();
  const arch = new Map(syms.map((r) => [r.symbol, r]));
  const onlyLive = [...live.keys()].filter((s) => !arch.has(s));
  const onlyArch = [...arch.keys()].filter((s) => !live.has(s));
  const tradableArch = syms.filter((r) => r.tradeSwitch && r.isDisplay).map((r) => r.symbol);
  // Turnover over amount over last price estimates the contract size, and a ratio near 1 agrees with the archive.
  let agree = 0;
  let disagree = [];
  let noVolume = 0;
  let noTicker = 0;
  for (const [s, row] of live) {
    const r = arch.get(s);
    if (!r || row.v === undefined) { if (r) noTicker++; continue; }
    const est = Number(row.v) / (Number(row.a) * Number(row.c));
    if (!(est > 0) || !Number.isFinite(est)) { noVolume++; continue; }
    const ratio = est / Number(r.contractSize);
    if (ratio > 0.5 && ratio < 2) agree++;
    else disagree.push(`${s}:${r.contractSize}:${est.toPrecision(2)}`);
  }
  log('archive_vs_live', {
    live: live.size,
    archive: arch.size,
    archiveTradableDisplayed: tradableArch.length,
    inBoth: live.size - onlyLive.length,
    onlyLive: onlyLive.length,
    onlyLiveSample: onlyLive.slice(0, 8),
    onlyArchive: onlyArch.length,
    onlyArchiveTradable: onlyArch.filter((s) => arch.get(s).tradeSwitch).length,
    liveButArchiveNotTradable: [...live.keys()].filter((s) => arch.has(s) && !arch.get(s).tradeSwitch).length,
    contractSizeAgreesWithTurnover: agree,
    contractSizeDisagrees: disagree.length,
    disagreeSample: disagree.slice(0, 8),
    noVolume,
    noTickerRowIn6s: noTicker,
  });
}

async function modeCcxt() {
  const ccxt = require('ccxt');
  log('ccxt_local', { version: ccxt.version, exchanges: ccxt.exchanges.length, bitbaseLike: ccxt.exchanges.filter((x) => /bitbase/i.test(x)), xtPresent: ccxt.exchanges.includes('xt') });
  const res = await fetch('https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master', { headers: { 'user-agent': 'probe' } });
  const list = await res.json();
  const head = await (await fetch('https://api.github.com/repos/ccxt/ccxt/commits/master', { headers: { 'user-agent': 'probe' } })).json();
  log('ccxt_master', { status: res.status, entries: Array.isArray(list) ? list.length : list.message, bitbaseLike: Array.isArray(list) ? list.map((f) => f.name).filter((n) => /bitbase/i.test(n)) : null, commit: head.sha?.slice(0, 10), committed: head.commit?.committer?.date });
}

const modes = { access: modeAccess, archive: modeArchive, ccxt: modeCcxt };
const mode = process.argv[2] ?? 'access';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
