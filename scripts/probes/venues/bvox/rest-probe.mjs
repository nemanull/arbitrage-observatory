// BVOX (formerly BitVenus) REST reachability probe: what this host is served by every public BVOX host and every public path the venue's docs, its archived web app and its BHEX platform name.
// Also checks CCXT 4.5.68 for a class under any of the venue's names, and asks Cloudflare where it places this host.
// Public, unauthenticated, read-only. About 50 GET requests, one every 300 ms, so about 20 s.
// Run from server/: node ../scripts/probes/venues/bvox/rest-probe.mjs
// Set PROBE_OUT_DIR to keep each reply body. Recorded in docs/profiles/bvox/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolve4 } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

const HOSTS = [
  'www.bvox.com', 'bvox.com', 'api.bvox.com', 'wsapi.bvox.com', 'futures.bvox.com', 'www.bvox.io', 'api.bvox.io',
  'www.bitvenus.me', 'api.bitvenus.me', 'www.bitvenus.com', 'www.bitvenus.live', 'static.bvox.io',
];

// Site roots and the API documentation link CoinGecko publishes for the venue.
const SITE = [
  'https://www.bvox.com/',
  'https://futures.bvox.com/',
  'https://www.bvox.io/',
  'https://www.bitvenus.me/',
  'https://www.bitvenus.com/',
  'https://www.bitvenus.me/docs/v1/intro',
  'https://www.bvox.com/docs/v1/intro',
];

// Public contract paths of the BHEX broker open API, doc/Contract API EN.md of github.com/bhexopen/BHEX-OpenApi.
const OPENAPI = [
  '/openapi/v1/ping',
  '/openapi/v1/time',
  '/openapi/v1/brokerInfo?type=future',
  '/openapi/v1/contracts',
  '/openapi/quote/v1/contract/index',
  '/openapi/contract/v1/fundingRate',
  '/openapi/quote/v1/contract/depth?symbol=BTC-SWAP-USDT&limit=20',
  '/openapi/quote/v1/contract/ticker/24hr?symbol=BTC-SWAP-USDT',
];

// Paths the web app called, from archived captures of www.bvox.com between 2024-12 and 2026-08.
const WEBAPP = [
  '/api/quote/v1/time',
  '/api/contract/symbol-newest/list?categories=FUTURES,COIN',
  '/s_api/basic/config_v2_js?tab=exchange&type=all&platform=1',
  '/api/contract/funding_rates',
  '/api/v1/basic/home/ticker',
  '/openapi/quote/v1/contracts',
];

const API_HOSTS = ['api.bvox.com', 'www.bvox.com', 'api.bitvenus.me'];

// Plain GETs on the socket host, to show which paths it routes (503) and which it does not (404).
const WSAPI = [
  'https://wsapi.bvox.com/openapi/quote/ws/v1',
  'https://wsapi.bvox.com/openapi/ws/',
  'https://wsapi.bvox.com/openapi/v1/ping',
  'https://wsapi.bvox.com/ws/quote/v1',
  'https://wsapi.bitvenus.me/openapi/quote/ws/v1',
];

let seq = 0;

async function get(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'arbitrage-observatory-probe/1.0' } });
    const body = await res.text();
    const ms = Math.round(performance.now() - t0);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `rest-${String(++seq).padStart(2, '0')}.txt`), `${url}\n${res.status}\n${body.slice(0, 200_000)}`);
    }
    const title = body.match(/<title>([^<]*)/)?.[1]?.trim();
    return {
      url,
      status: res.status,
      ms,
      bytes: Buffer.byteLength(body),
      type: res.headers.get('content-type'),
      server: res.headers.get('server'),
      location: res.headers.get('location') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
      retryAfter: res.headers.get('retry-after') ?? undefined,
      title,
      regionBlock: body.includes('Not Support Region'),
      head: title ? undefined : body.slice(0, 120).replace(/\s+/g, ' '),
    };
  } catch (err) {
    return { url, error: err.cause?.code ?? err.name, ms: Math.round(performance.now() - t0) };
  }
}

async function main() {
  const names = ccxt.exchanges.filter((id) => /bvox|venus|bhex|hbtc|bhop/i.test(id));
  log('ccxt', { version: ccxt.version, classes: ccxt.exchanges.length, matching: names });

  for (const host of HOSTS) {
    let addrs;
    try {
      addrs = await resolve4(host);
    } catch (err) {
      addrs = err.code;
    }
    log('dns', { host, addrs });
  }

  const trace = await (await fetch('https://www.bvox.com/cdn-cgi/trace')).text();
  const pick = Object.fromEntries(trace.trim().split('\n').map((l) => l.split('=')).filter(([k]) => ['colo', 'loc', 'http', 'tls'].includes(k)));
  log('cloudflare_trace', pick);

  for (const url of SITE) {
    log('site', await get(url));
    await sleep(300);
  }

  for (const host of API_HOSTS) {
    for (const path of OPENAPI) {
      log('openapi', await get(`https://${host}${path}`));
      await sleep(300);
    }
  }

  for (const path of WEBAPP) {
    log('webapp', await get(`https://www.bvox.com${path}`));
    await sleep(300);
  }

  for (const url of WSAPI) {
    log('wsapi_get', await get(url));
    await sleep(300);
  }

  const t0 = performance.now();
  const cold = await get('https://www.bvox.com/');
  const warm = [];
  for (let i = 0; i < 5; i++) {
    warm.push((await get('https://www.bvox.com/')).ms);
    await sleep(300);
  }
  log('timing', { url: 'https://www.bvox.com/', first: cold.ms, warm, totalMs: Math.round(performance.now() - t0) });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
