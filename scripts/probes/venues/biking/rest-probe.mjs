// BiKing REST probe: CCXT catalog check, host resolution, and what the website's own contract endpoints return to this host.
// BiKing publishes no API documentation, so this probe checks whether any public, readable market data endpoint exists.
// Public, unauthenticated, read-only. Six GET requests, one at a time, far below any plausible limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/biking/rest-probe.mjs
// Recorded in docs/profiles/biking/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const SITE = 'https://www.bikingex.com';
const PATHS = [
  '/contract/api/v2/public/ins', // contract list the futures page loads
  '/market/api/v2/pub/index', // price list the futures page loads
  '/contract/api/v2/public/url-info', // the futures page reads its socket URL from this reply
];
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

log('ccxt', { version: ccxt.version, matches: ccxt.exchanges.filter((id) => /bik/i.test(id)) });

for (const host of ['www.bikingex.com', 'biking.com', 'api.bikingex.com', 'openapi.bikingex.com', 'futuresopenapi.bikingex.com']) {
  try {
    const addrs = await lookup(host, { all: true });
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  } catch (e) {
    log('dns', { host, error: e.code });
  }
}

for (const path of PATHS) {
  for (const round of ['cold', 'warm']) {
    const t0 = performance.now();
    const res = await fetch(SITE + path);
    const body = await res.text();
    const ms = Math.round(performance.now() - t0);
    let json = false;
    try {
      JSON.parse(body);
      json = true;
    } catch {}
    const base64 = /^[A-Za-z0-9+/=\s]+$/.test(body);
    log('rest', { path, round, status: res.status, ms, bytes: body.length, contentType: res.headers.get('content-type'), parsesAsJson: json, looksLikeBase64: base64, head: body.slice(0, 60) });
  }
}
