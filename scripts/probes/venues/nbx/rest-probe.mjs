// NBX public REST probe: DNS, the Cloudflare edge this host reaches, and what every documented public endpoint returns to it, plus the CCXT 4.5.68 exchange list.
// Public, unauthenticated, read-only. About 30 requests in all mode, far inside the documented 1,000 requests per minute per IP.
// Run from server/: node ../scripts/probes/venues/nbx/rest-probe.mjs [access|latency|ua|ccxt|all]
//   access   each documented public GET once with Node's default fetch, the status, the edge, and whether the body is a Cloudflare block page. About 4 minutes when the origin times out at about 20 s a request.
//   latency  ten sequential requests to the Cloudflare trace path and three to /tickers, first and warm times. About 70 s when the origin times out.
//   ua       /markets once with curl's User-Agent, to reproduce the Cloudflare WAF block that curl met, beside Node's default fetch in access mode.
//   ccxt     the CCXT version and whether any exchange id matches nbx.
// When an endpoint answers JSON the probe summarises it: row count, field names, market ids, level order.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/nbx/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.nbx.com';
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every public GET path of the NBX Public API 1.0.0 spec, with a busy market, an order book market and an unknown market.
const PATHS = [
  '/markets',
  '/markets/BTC-NOK',
  '/tickers',
  '/assets',
  '/assets/BTC',
  '/markets/BTC-NOK/orders',
  '/markets/BTC-NOK/orders?side=sell',
  '/markets/PALM-USDM/orders',
  '/markets/BTC-NOK/trades',
  '/markets/NOPE-NOK/orders',
];
const CONTROLS = ['https://nbx.com/', 'https://app.nbx.com/developers', 'https://app.nbx.com/markets'];

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name.replace(/[^a-zA-Z0-9.-]+/g, '_')), text.slice(0, 200_000));
}

function classify(text) {
  if (/Sorry, you have been blocked/.test(text)) return 'cloudflare_waf_block';
  if (/has banned the country or region/.test(text)) return 'cloudflare_country_block';
  if (/Just a moment|cf-chl|challenge-platform/.test(text)) return 'cloudflare_challenge';
  const t = text.trimStart();
  if (t.startsWith('[') || t.startsWith('{')) return 'json';
  if (/<html/i.test(t)) return 'html';
  return 'other';
}

async function get(url, headers = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    return { res, text, ms };
  } catch (err) {
    return { error: String(err?.cause?.code ?? err?.message ?? err), ms: Math.round(performance.now() - t0) };
  }
}

function summariseJson(path, text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { parse: 'failed' };
  }
  if (!Array.isArray(body)) return { keys: Object.keys(body).slice(0, 20) };
  const out = { rows: body.length, fields: body[0] ? Object.keys(body[0]) : [] };
  if (path === '/markets' || path === '/tickers') out.ids = body.map((r) => r.id).slice(0, 60);
  if (path.includes('/orders')) {
    const buys = body.filter((o) => o.side === 'BUY').map((o) => Number(o.price));
    const sells = body.filter((o) => o.side === 'SELL').map((o) => Number(o.price));
    out.buys = buys.length;
    out.sells = sells.length;
    out.buyDescending = buys.every((p, i) => i === 0 || p <= buys[i - 1]);
    out.sellAscending = sells.every((p, i) => i === 0 || p >= sells[i - 1]);
    out.distinctPrices = new Set(body.map((o) => o.price)).size;
  }
  return out;
}

async function access() {
  const host = new URL(API).hostname;
  for (const h of [host, 'app.nbx.com', 'nbx.com']) {
    const addrs = await lookup(h, { all: true }).catch((e) => [{ address: String(e.code) }]);
    log('dns', { host: h, addresses: addrs.map((a) => a.address) });
  }
  for (const h of ['api.nbx.com', 'app.nbx.com', 'nbx.com']) {
    const r = await get(`https://${h}/cdn-cgi/trace`);
    const kv = Object.fromEntries((r.text ?? '').split('\n').filter(Boolean).map((l) => l.split('=')));
    log('trace', { host: h, status: r.res?.status, colo: kv.colo, loc: kv.loc, ipPrefix: (kv.ip ?? '').split('.').slice(0, 2).join('.'), ms: r.ms });
  }
  for (const url of [...PATHS.map((p) => API + p), ...CONTROLS]) {
    const r = await get(url);
    if (r.error) {
      log('get', { url, error: r.error, ms: r.ms });
      continue;
    }
    const h = r.res.headers;
    const kind = classify(r.text);
    keep(url, r.text);
    const title = (r.text.match(/<title>([^<]*)<\/title>/i) ?? [])[1];
    const row = {
      url,
      status: r.res.status,
      ms: r.ms,
      bytes: r.text.length,
      kind,
      contentType: h.get('content-type'),
      server: h.get('server'),
      cfRay: h.get('cf-ray'),
      cfMitigated: h.get('cf-mitigated'),
      retryAfter: h.get('retry-after'),
      cacheControl: h.get('cache-control'),
      age: h.get('age'),
      nextPage: h.get('x-next-page-url'),
      title: title?.trim(),
    };
    if (kind === 'json') row.json = summariseJson(url.slice(API.length), r.text);
    log('get', row);
    await sleep(300);
  }
}

async function latency() {
  for (const [url, n] of [[`${API}/cdn-cgi/trace`, 10], [`${API}/tickers`, 3]]) {
    const times = [];
    const statuses = new Set();
    for (let i = 0; i < n; i++) {
      const r = await get(url);
      times.push(r.ms);
      statuses.add(r.res?.status ?? r.error);
      await sleep(200);
    }
    const warm = times.slice(1).sort((a, b) => a - b);
    log('latency', { url, first: times[0], warmMin: warm[0], warmMedian: warm[Math.floor(warm.length / 2)], warmMax: warm[warm.length - 1], statuses: [...statuses] });
  }
}

async function ua() {
  const r = await get(`${API}/markets`, { 'user-agent': 'curl/8.14.1' });
  const title = (r.text?.match(/<title>([^<]*)<\/title>/i) ?? [])[1];
  log('ua', { userAgent: 'curl/8.14.1', status: r.res?.status, ms: r.ms, kind: r.text ? classify(r.text) : r.error, cfRay: r.res?.headers.get('cf-ray'), title: title?.trim() });
}

function ccxt() {
  const c = require('ccxt');
  log('ccxt', { version: c.version, exchanges: c.exchanges.length, matches: c.exchanges.filter((id) => /nbx|norw/i.test(id)) });
}

const mode = process.argv[2] ?? 'all';
if (mode === 'access' || mode === 'all') await access();
if (mode === 'latency' || mode === 'all') await latency();
if (mode === 'ua' || mode === 'all') await ua();
if (mode === 'ccxt' || mode === 'all') ccxt();
