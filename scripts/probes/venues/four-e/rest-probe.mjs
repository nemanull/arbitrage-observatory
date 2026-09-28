// 4E (eeee.com) REST probe: whether any public market data API answers without a key, and what the web client's hosts return.
// Public, unauthenticated, read-only. It never signs a request, never uses the web client's embedded app key, and sends about 30 requests in total.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/four-e/rest-probe.mjs
// Prints a compact summary. Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/four-e/rest.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function call(url, init = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    return { status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, text, ray: res.headers.get('cf-ray') };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), error: String(e.cause?.code ?? e.message) };
  }
}

// 1. CCXT
log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, matches: ccxt.exchanges.filter((e) => /4e|four|eeee|bitda/i.test(e)) });

// 2. Hosts: DNS, cold and warm time, root reply
const hosts = ['www.eeee.com', 'api.eeee.com', 'app.eeee.com', 'appuc.eeee.com', 'apiuni.eeee.com', 'contract.eeee.com', 'hcapi.eeee.com', 'openapi.eeee.com', 'ws.eeee.com'];
for (const h of hosts) {
  let addrs = [];
  try { addrs = (await lookup(h, { all: true })).map((a) => a.address); } catch (e) { log('dns', { host: h, error: e.code }); continue; }
  const cold = await call(`https://${h}/`);
  const warm = await call(`https://${h}/`);
  log('host', { host: h, addrs, cold: cold.ms, warm: warm.ms, status: warm.status, ray: warm.ray, body: (warm.text ?? warm.error ?? '').slice(0, 140).replace(/\s+/g, ' ') });
  await sleep(300);
}

// 3. Edge location of this host's exit
const trace = await call('https://www.eeee.com/cdn-cgi/trace');
log('trace', { loc: /loc=(\w+)/.exec(trace.text ?? '')?.[1], colo: /colo=(\w+)/.exec(trace.text ?? '')?.[1] });

// 4. Site config: the public bootstrap call of the web client. app_info is redacted and never used.
const cfg = await call('https://www.eeee.com/Site/config', { method: 'POST', headers: { 'content-type': 'application/json;charset=UTF-8' }, body: JSON.stringify({ device_id: 'probe' }) });
keep('site-config.json', cfg.text ?? '');
try {
  const d = JSON.parse(cfg.text).data;
  log('site_config', { status: cfg.status, ms: cfg.ms, bytes: cfg.bytes, app: d.app, appuc: d.appuc, apiuni: d.apiuni, contract: d.contract, sotc: d.sotc, country: d.country_code2, is_specific_country_ip: d.is_specific_country_ip, app_info: Array.isArray(d.app_info) ? `array of ${d.app_info.length}, redacted` : typeof d.app_info });
} catch { log('site_config', { status: cfg.status, body: (cfg.text ?? cfg.error ?? '').slice(0, 200) }); }

// 5. The web client's market calls, unsigned. The client adds app_id, nonce and an MD5 signature over an embedded key, which this probe does not do.
for (const p of ['/MarketV2/contractFuturesList', '/Publics/getWebInitInfo', '/Contract/getFundingRate', '/Web/Kline/orderbook']) {
  const r = await call(`https://app.eeee.com${p}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'device_id=probe' });
  let j = {};
  try { j = JSON.parse(r.text); } catch {}
  log('web_api_unsigned', { path: p, status: r.status, ms: r.ms, appStatus: j.status, msg: j.msg, data: JSON.stringify(j.data ?? null).slice(0, 60) });
  await sleep(300);
}

// 6. Guessed public paths on api.eeee.com, the host whose error envelope says source API.
for (const p of ['/v1/ticker', '/api/v1/ticker', '/api/v1/contracts', '/Market/ticker', '/openapi/v1/depth', '/api/v1/depth?symbol=BTCUSDT']) {
  const r = await call(`https://api.eeee.com${p}`);
  let j = {};
  try { j = JSON.parse(r.text); } catch {}
  log('api_guess', { path: p, status: r.status, ms: r.ms, appStatus: j.status, msg: j.msg, source: j.source });
  await sleep(300);
}

// 7. Help centre CMS: count of English articles and any article whose title names an API.
const hc = await call('https://hcapi.eeee.com/api/news?pagination[pageSize]=1&locale=en');
const hcApi = await call('https://hcapi.eeee.com/api/news?pagination[pageSize]=25&locale=en&filters[title][$containsi]=API');
try {
  log('help_centre', { status: hc.status, englishArticles: JSON.parse(hc.text).meta.pagination.total, titlesContainingApi: JSON.parse(hcApi.text).meta.pagination.total });
} catch { log('help_centre', { status: hc.status, error: (hc.text ?? hc.error ?? '').slice(0, 120) }); }

// 8. Third-party listing: CoinMarketCap's public data API for the venue's perpetual pairs.
const cmc = await call('https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=4e&category=perpetual&start=1&limit=100');
keep('cmc-perpetual.json', cmc.text ?? '');
try {
  const d = JSON.parse(cmc.text).data;
  const m = d.marketPairs ?? [];
  const quotes = {};
  const rates = {};
  for (const p of m) { quotes[p.quoteSymbol] = (quotes[p.quoteSymbol] ?? 0) + 1; rates[p.fundingRate] = (rates[p.fundingRate] ?? 0) + 1; }
  const oiNonZero = m.filter((p) => p.openInterestUsd > 0).length;
  log('cmc_perpetuals', { status: cmc.status, numMarketPairs: d.numMarketPairs, quotes, fundingRates: rates, oiNonZero, lastUpdated: m[0]?.lastUpdated, bases: m.map((p) => p.baseSymbol).join(',') });
} catch { log('cmc_perpetuals', { status: cmc.status, error: (cmc.text ?? cmc.error ?? '').slice(0, 120) }); }
