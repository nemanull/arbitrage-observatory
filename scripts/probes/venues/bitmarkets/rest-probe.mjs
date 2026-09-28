// BITmarkets REST probe: CCXT coverage, DNS, and what each candidate public API host returns to this host.
// BITmarkets publishes no REST API documentation, so the hosts come from DNS, CoinMarketCap and the web app config archived on 2025-09-23.
// Public, unauthenticated, read-only GET requests only, one at a time. No login, no signed header, no order.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitmarkets/rest-probe.mjs
// About 20 s. Recorded in docs/profiles/bitmarkets/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

const TARGETS = [
  'https://bitmarkets.com/en', // marketing site
  'https://bitmarkets.com/en/api', // where /api redirects
  'https://api.bitmarkets.com/', // DNS name, CloudFront
  'https://api.bitmarkets.com/api/v1/ticker',
  'https://ws.bitmarkets.com/', // DNS name, Cloudflare
  'https://platform-api.bitmarkets.com/v1/', // tradingApi in the archived web app config
  'https://platform-api.bitmarkets.com/v1/symbols',
  'https://myzone-api.bitmarkets.com/api/v2/currencies', // API_URL in the same config
];

function get(url, insecure) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = https.get(url, { rejectUnauthorized: !insecure, headers: { 'user-agent': 'observatory-probe' }, timeout: 10_000 }, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 4096) body += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        ms: Math.round(performance.now() - t0),
        server: res.headers.server ?? null,
        cfMitigated: res.headers['cf-mitigated'] ?? null,
        xCache: res.headers['x-cache'] ?? null,
        location: res.headers.location ?? null,
        body: body.replace(/\s+/g, ' ').slice(0, 140),
      }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ error: err.code ?? err.message, ms: Math.round(performance.now() - t0) }));
  });
}

log('ccxt', { version: ccxt.version, matches: ccxt.exchanges.filter((id) => /bitmarket/i.test(id)) });

for (const host of ['bitmarkets.com', 'api.bitmarkets.com', 'ws.bitmarkets.com', 'platform-api.bitmarkets.com', 'myzone-api.bitmarkets.com']) {
  try {
    const addrs = await lookup(host, { all: true, family: 4 });
    log('dns', { host, v4: addrs.map((a) => a.address) });
  } catch (err) {
    log('dns', { host, error: err.code });
  }
}

for (const url of TARGETS) {
  const r = await get(url, false);
  log('get', { url, ...r });
  if (r.error === 'CERT_HAS_EXPIRED') log('get-insecure', { url, ...(await get(url, true)) }); // reads the body behind the expired certificate
}
