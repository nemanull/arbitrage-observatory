// INX One (now served as Republic trading) REST probe: which hosts answer this machine, what the documented API gateway returns without credentials, and whether CCXT has a class.
// Public, unauthenticated, read-only. No API key, no signature, no order. At most 30 requests per mode, spaced at least 300 ms apart, well inside the documented 10 per second and 100 per minute.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/inx-one/rest-probe.mjs [access|api|ccxt]
//   access  DNS for every host, the marketing site, the API doc page, the old web app host and its redirect target, and the Cloudflare trace. About 10 s, 12 requests.
//   api     the documented REST gateway without credentials: ping and getMarkets by GET and POST, one cold and five warm pings, rate limit headers, the clock offset from the Date header,
//           and the same ping sent with no User-Agent header at all, which is how the ws package and the engine's feed connect. About 10 s, 15 requests.
//   ccxt    whether CCXT 4.5.68 lists any INX or Republic class, and the CoinGecko ticker list for volume context. About 3 s, 1 request.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/inx-one/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const GATEWAY = 'https://gw-client-api-rest.trading.republic.com';
const HOSTS = [
  'inx.co',
  'www.inx.co',
  'apidoc.inx.co',
  'one.inx.co',
  'crypto-support.inx.co',
  'trading.republic.com',
  'gw-client-api-rest.trading.republic.com',
  'gw-client-api-ws.trading.republic.com',
  'api.inx.co',
];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// One request, never following a redirect, with the few headers that say who answered.
async function hit(label, url, init = {}) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, { redirect: 'manual', ...init });
  } catch (err) {
    log(label, { url, error: String(err.cause?.code ?? err.message) });
    return null;
  }
  const body = await res.text();
  const ms = Math.round(performance.now() - t0);
  const h = res.headers;
  const title = /<title>([^<]*)<\/title>/i.exec(body)?.[1]?.replace(/\s+/g, ' ').trim();
  // A Cloudflare refusal names itself in a heading and an error code, which is what tells a WAF block from an origin refusal.
  const cfBlock = /cloudflare/i.test(title ?? '')
    ? [...body.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>|errorCode:\s*(\d+)/gi)]
        .map((m) => (m[1] ?? `errorCode ${m[2]}`).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    : undefined;
  log(label, {
    url,
    method: init.method ?? 'GET',
    status: res.status,
    ms,
    bytes: body.length,
    type: h.get('content-type'),
    location: h.get('location') ?? undefined,
    server: h.get('server'),
    cfRay: h.get('cf-ray') ?? undefined,
    lastModified: h.get('last-modified') ?? undefined,
    rateSecondLeft: h.get('ratelimitpersecondleft') ?? undefined,
    rateMinuteLeft: h.get('ratelimitperminuteleft') ?? undefined,
    serverProcessTime: h.get('serverprocesstime') ?? undefined,
    requestId: h.get('requestid') ?? undefined,
    retryAfter: h.get('retry-after') ?? undefined,
    title,
    cfBlock,
    body: title ? undefined : body.slice(0, 400),
  });
  capture(`${label}-${res.status}.txt`, body);
  return { res, body, ms };
}

async function access() {
  for (const host of HOSTS) {
    const a = await dns.resolve4(host).catch((e) => e.code);
    log('dns', { host, a });
  }
  await hit('site', 'https://www.inx.co/');
  await sleep(300);
  await hit('fees', 'https://www.inx.co/fee-schedules');
  await sleep(300);
  await hit('apidoc', 'https://apidoc.inx.co/');
  await sleep(300);
  await hit('oldApp', 'https://one.inx.co/trading/BTC-USD');
  await sleep(300);
  await hit('oldAppApi', 'https://one.inx.co/exchange/market/getAllMarkets');
  await sleep(300);
  await hit('newApp', 'https://trading.republic.com/trading/BTC-USD', {
    headers: { 'user-agent': 'arbitrage-observatory-rest-probe/1 (read-only research)', accept: 'text/html' },
  });
  await sleep(300);
  await hit('newAppApi', 'https://trading.republic.com/exchange/market/getAllMarkets');
  await sleep(300);
  await hit('robots', 'https://trading.republic.com/robots.txt');
  await sleep(300);
  await hit('support', 'https://crypto-support.inx.co/hc/en-gb');
  await sleep(300);
  const trace = await fetch('https://trading.republic.com/cdn-cgi/trace').then((r) => r.text());
  const kv = Object.fromEntries(trace.trim().split('\n').map((l) => l.split('=')));
  log('cfTrace', { colo: kv.colo, loc: kv.loc, http: kv.http, tls: kv.tls });
}

async function api() {
  const json = { 'content-type': 'application/json' };
  await hit('pingGet', `${GATEWAY}/api/ping`);
  await sleep(300);
  await hit('pingPost', `${GATEWAY}/api/ping`, { method: 'POST', headers: json, body: '{}' });
  await sleep(300);
  await hit('marketsPost', `${GATEWAY}/api/market/getMarkets`, { method: 'POST', headers: json, body: '{}' });
  await sleep(300);
  await hit('marketsGet', `${GATEWAY}/api/market/getMarkets`);
  await sleep(300);
  await hit('tokenPost', `${GATEWAY}/api/createToken`, { method: 'POST', headers: json, body: '{}' });
  await sleep(300);
  await hit('unknownPath', `${GATEWAY}/api/market/nope`, { method: 'POST', headers: json, body: '{}' });
  await sleep(300);
  await hit('root', `${GATEWAY}/`);
  await sleep(300);
  // fetch always sends `User-Agent: node`, so node:https is used to send a request with no User-Agent.
  for (const url of [`${GATEWAY}/api/ping`, 'https://gw-client-api-ws.trading.republic.com/']) {
    const { status, title } = await new Promise((resolve) => {
      https
        .get(url, (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => resolve({ status: res.statusCode, title: /<title>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? body.slice(0, 120) }));
        })
        .on('error', (e) => resolve({ status: e.code }));
    });
    log('noUserAgent', { url, status, title });
    await sleep(300);
  }

  // Warm time on the cheapest call, which answers 401 without credentials. The cold time is the first pingGet above, which opened the connection.
  const times = [];
  let offsets = [];
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const res = await fetch(`${GATEWAY}/api/ping`);
    await res.text();
    const t1 = Date.now();
    times.push(t1 - t0);
    const date = Date.parse(res.headers.get('date'));
    offsets.push(date - (t0 + t1) / 2);
    await sleep(400);
  }
  offsets = offsets.map((o) => Math.round(o));
  log('pingTimes', { warmMs: times, dateHeaderOffsetMs: offsets, note: 'Date header has 1 s resolution' });
}

async function ccxt() {
  const c = require('ccxt');
  const hits = c.exchanges.filter((id) => /inx|republic/i.test(id));
  log('ccxt', { version: c.version, exchanges: c.exchanges.length, matches: hits });
  const cg = await hit('coingecko', 'https://api.coingecko.com/api/v3/exchanges/inx_one');
  if (cg?.res.status === 200) {
    const j = JSON.parse(cg.body);
    log('coingeckoExchange', { name: j.name, country: j.country, trust: j.trust_score, trustRank: j.trust_score_rank, pairs: j.pairs, volume24hBtc: j.trade_volume_24h_btc });
    for (const t of j.tickers) {
      log('coingeckoTicker', { pair: `${t.base}-${t.target}`, usd24h: Math.round(t.converted_volume.usd), spreadPct: Number(t.bid_ask_spread_percentage.toFixed(3)), lastTradedAt: t.last_traded_at, stale: t.is_stale, tradeUrl: t.trade_url });
    }
  }
}

const mode = process.argv[2] ?? 'access';
const modes = { access, api, ccxt };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, expected one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
