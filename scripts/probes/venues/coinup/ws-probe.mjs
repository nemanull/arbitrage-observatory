// CoinUp.io WebSocket probe: whether the public market data sockets accept an upgrade from this machine, and what a refusal looks like.
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// No CoinUp documentation page is readable from here, so the URLs are the ChainUp kline-api shape that CCXT Pro's bitrue class uses, at server/node_modules/ccxt/js/src/pro/bitrue.js line 31.
// If a socket ever opens, it subscribes one depth stream in that shape, logs gzip-decoded frames for 20 s and closes.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coinup/ws-probe.mjs
// One upgrade attempt per URL, one at a time, a few seconds in total when every upgrade is refused.
// Set PROBE_OUT_DIR to keep raw refusal bodies.
// Recorded in docs/profiles/coinup/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

const URLS = [
  'wss://futuresws.coinup.io/kline-api/ws',
  'wss://futuresws.coinup.io/ws',
  'wss://futuresws.coinup.io/',
  'wss://ws.coinup.io/kline-api/ws',
  'wss://ws.coinup.io/',
  'wss://futures.coinup.io/kline-api/ws',
  'wss://www.coinup.io/kline-api/ws',
];

const SUBSCRIBE = { event: 'sub', params: { channel: 'market_e_btcusdt_depth_step0', cb_id: 'e_btcusdt' } };

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), body);
}

function decode(data) {
  try {
    return gunzipSync(data).toString('utf8');
  } catch {
    return data.toString('utf8');
  }
}

function attempt(url, i) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000 });
    let frames = 0;

    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        save(`refusal-${i}.html`, body);
        log('refused', {
          url,
          status: res.statusCode,
          cfMitigated: res.headers['cf-mitigated'],
          server: res.headers.server,
          ray: res.headers['cf-ray'],
          type: res.headers['content-type'],
          bytes: body.length,
          title: /<title>([^<]*)<\/title>/i.exec(body)?.[1],
          ms: Math.round(performance.now() - t0),
        });
        resolve();
      });
    });

    ws.on('open', () => {
      log('open', { url, ms: Math.round(performance.now() - t0), extensions: ws.extensions });
      ws.send(JSON.stringify(SUBSCRIBE));
      setTimeout(() => ws.close(), 20_000);
    });

    ws.on('message', (data, isBinary) => {
      frames++;
      if (frames <= 5) log('frame', { url, isBinary, text: decode(data).slice(0, 300) });
    });

    ws.on('close', (code) => {
      if (frames > 0 || code !== 1006) log('close', { url, code, frames });
      resolve();
    });

    ws.on('error', (e) => {
      if (!/Unexpected server response/.test(e.message)) {
        log('error', { url, error: e.message, ms: Math.round(performance.now() - t0) });
        resolve();
      }
    });
  });
}

for (const [i, url] of URLS.entries()) {
  await attempt(url, i);
}
