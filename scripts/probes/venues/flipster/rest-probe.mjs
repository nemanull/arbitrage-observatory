// Flipster REST probe: which documented Trading API calls answer without an API key, host and latency, the rate limit headers, error shapes, server time and clock offset, and whether CCXT 4.5.68 has a Flipster class.
// Public, unauthenticated and read-only: no api-key, api-signature or api-expires header is ever sent, and no account exists.
// About 25 requests over both modes, never more than 4 per second, far under the 100 per window the public calls report in x-ratelimit-limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/flipster/rest-probe.mjs [access|time]
//   access  DNS, CCXT class list, every documented market, trade and public GET without credentials plus two unknown paths, with status, refusal body and headers, about 5 s
//   time    ten warm requests to /api/v1/public/time with the clock offset and the rate limit headers of each, about 4 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/flipster/rest.md, websocket.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://trading-api.flipster.io';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

// Every GET the documentation lists outside the private account, position and affiliate groups, then two paths it does not list.
const DOCUMENTED = [
  '/api/v1/public/ping',
  '/api/v1/public/time',
  '/api/v1/market/contract',
  '/api/v1/market/contract?symbol=BTCUSDT.PERP',
  '/api/v1/market/ticker',
  '/api/v1/market/ticker?symbol=BTCUSDT.PERP',
  '/api/v1/market/funding-info',
  '/api/v1/market/orderbook?symbol=BTCUSDT.PERP',
  '/api/v1/market/kline?symbol=BTCUSDT.PERP&interval=1&startTime=1790100000000000000&endTime=1790103600000000000',
  '/api/v1/market/fee-rate',
  '/api/v1/trade/symbol',
  '/api/v2/market/ticker',
  '/api/v1/nope',
];

const KEEP_HEADERS = /^(content-type|retry-after|x-ratelimit-.*|x-prex-.*|cf-ray|www-authenticate|server|cache-control|age)$/i;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  const ttfb = performance.now() - t0;
  const body = await res.text();
  const ms = performance.now() - t0;
  const headers = {};
  for (const [k, v] of res.headers) if (KEEP_HEADERS.test(k)) headers[k] = v;
  return { status: res.status, ttfb: Math.round(ttfb), ms: Math.round(ms), bytes: body.length, headers, body };
}

async function access() {
  for (const host of ['trading-api.flipster.io', 'api.flipster.io', 'flipster.io', 'api-docs.flipster.io']) {
    try {
      log('dns', { host, a: await dns.resolve4(host) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  log('ccxt', { version: ccxt.version, classes: ccxt.exchanges.length, flipster: ccxt.exchanges.filter((id) => /flip/i.test(id)) });

  for (const path of DOCUMENTED) {
    const r = await get(path);
    capture(path.replace(/[^a-z0-9]+/gi, '_') + '.txt', `${r.status}\n${JSON.stringify(r.headers)}\n${r.body}`);
    log('get', { path, status: r.status, ttfb: r.ttfb, ms: r.ms, bytes: r.bytes, headers: r.headers, body: r.body.slice(0, 200) });
    await sleep(300);
  }
}

// The server time is nanoseconds since the epoch as a decimal string.
async function time() {
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get('/api/v1/public/time');
    const after = Date.now();
    const serverMs = Number(BigInt(JSON.parse(r.body).serverTime) / 1_000_000n);
    log('time', {
      i,
      status: r.status,
      ms: r.ms,
      serverMs,
      offsetMs: serverMs - Math.round((before + after) / 2),
      limit: r.headers['x-ratelimit-limit'],
      remaining: r.headers['x-ratelimit-remaining'],
      reset: r.headers['x-ratelimit-reset'],
      region: r.headers['x-prex-region'],
      country: r.headers['x-prex-ipcountry'],
      ray: r.headers['cf-ray'],
    });
    await sleep(250);
  }
}

const mode = process.argv[2] ?? 'access';
if (mode === 'access') await access();
else if (mode === 'time') await time();
else throw new Error(`unknown mode ${mode}`);
