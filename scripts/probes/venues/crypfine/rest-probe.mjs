// CrypFine REST probe: DNS, the Cloudflare edge that answers, and what every documented public perpetual and spot endpoint returns to this host.
// Public, unauthenticated, read-only. One request at a time, one second apart, far under the documented 3 requests per second per endpoint.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/crypfine/rest-probe.mjs
// Set PROBE_OUT_DIR to keep each reply body. Recorded in docs/profiles/crypfine/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const SWAP = 'https://openapi.crypfine.com/backend/exchange/swap';
const SPOT = 'https://openapi.crypfine.com/backend/exchange/spot';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

// Every public call the two API documents name, with the parameters their examples use.
const CALLS = [
  ['swap time', `${SWAP}/api/v1/usdt/time`],
  ['swap instruments', `${SWAP}/api/usdt/instruments/list`],
  ['swap ticker_list', `${SWAP}/api/usdt/instruments/ticker_list`],
  ['swap ticker_one', `${SWAP}/api/usdt/instruments/ticker_one?instrument_id=BTC-SWAP`],
  ['swap funding_rate', `${SWAP}/api/usdt/instruments/funding_rate?instrument_id=BTC`],
  ['swap depth', `${SWAP}/api/usdt/instruments/depth?instrument_id=BTC-SWAP&depth=100`],
  ['spot trade_pair_list', `${SPOT}/api/spot/instruments/trade_pair_list`],
  ['spot depth', `${SPOT}/api/spot/instruments/depth?instrument_id=BTC/USDT&depth=10`],
  ['docs page, same zone', 'https://www.crypfine.com/openapi-docs/usdt_perpetual/'],
];

function summarize(body, type) {
  if (type.includes('json')) return body.slice(0, 200);
  const title = body.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
  const blocked = /Sorry, you have been blocked/.test(body);
  const ray = body.match(/Cloudflare Ray ID: <strong[^>]*>([0-9a-f]+)/)?.[1];
  return JSON.stringify({ title, blocked, ray });
}

async function resolve() {
  for (const host of ['openapi.crypfine.com', 'ws-openapi.crypfine.com', 'www.crypfine.com']) {
    const t0 = performance.now();
    const cname = await dns.resolveCname(host).catch(() => []);
    const a = await dns.resolve4(host).catch((e) => [e.code]);
    log('dns', { host, cname, a, ms: Math.round(performance.now() - t0) });
  }
}

// Cloudflare answers /cdn-cgi/trace at the edge, so it names the colo and the country it sees without touching the origin.
async function edge() {
  for (const host of ['openapi.crypfine.com', 'ws-openapi.crypfine.com']) {
    const res = await fetch(`https://${host}/cdn-cgi/trace`);
    const text = await res.text();
    const pick = Object.fromEntries(text.split('\n').filter((l) => /^(colo|loc|http|tls|warp)=/.test(l)).map((l) => l.split('=')));
    log('edge', { host, status: res.status, ...pick });
    await sleep(1000);
  }
}

async function calls(round) {
  for (const [name, url] of CALLS) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      const body = await res.text();
      const ms = Math.round(performance.now() - t0);
      const type = res.headers.get('content-type') ?? '';
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `${round}-${name.replace(/\W+/g, '_')}.txt`), body.slice(0, 20000));
      }
      log('call', {
        round, name, status: res.status, ms, bytes: body.length, type: type.split(';')[0],
        server: res.headers.get('server'), cfRay: res.headers.get('cf-ray'), cfMitigated: res.headers.get('cf-mitigated'),
        retryAfter: res.headers.get('retry-after'), body: summarize(body, type),
      });
    } catch (e) {
      log('call', { round, name, error: String(e.cause?.code ?? e.message) });
    }
    await sleep(1000);
  }
}

// Which paths the edge refuses and which reach the origin, to tell a path rule from a host or country rule.
async function paths() {
  const urls = [
    'https://openapi.crypfine.com/',
    'https://openapi.crypfine.com/backend/exchange/',
    'https://openapi.crypfine.com/backend/exchange/swap/',
    'https://openapi.crypfine.com/backend/exchange/spot/',
    'https://openapi.crypfine.com/backend/exchange/stream/ws',
    'https://ws-openapi.crypfine.com/',
    'https://ws-openapi.crypfine.com/backend/exchange/stream/ws',
  ];
  for (const url of urls) {
    const t0 = performance.now();
    const res = await fetch(url);
    const body = await res.text();
    const type = res.headers.get('content-type') ?? '';
    log('path', { url, status: res.status, ms: Math.round(performance.now() - t0), type: type.split(';')[0], body: summarize(body, type) });
    await sleep(1000);
  }
}

function ccxtCheck() {
  const hits = ccxt.exchanges.filter((id) => /cryp|fine/i.test(id));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, nameHits: hits, crypfine: ccxt.exchanges.includes('crypfine') });
}

ccxtCheck();
await resolve();
await edge();
await paths();
await calls('cold');
await calls('warm');
