// BTCBOX WebSocket probe: BTCBOX documents no WebSocket, so this checks whether any plausible socket endpoint answers a handshake.
// Public, unauthenticated, read-only. Each attempt is one upgrade request with a 10 s timeout, and nothing is subscribed or sent.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btcbox/ws-probe.mjs
// Recorded in docs/profiles/btcbox/websocket.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');
const ccxt = require('ccxt');

const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

const HOSTS = ['www.btcbox.co.jp', 'btcbox.co.jp', 'ws.btcbox.co.jp', 'stream.btcbox.co.jp', 'api.btcbox.co.jp', 'socket.btcbox.co.jp', 'wss.btcbox.co.jp'];
const URLS = [
  'wss://www.btcbox.co.jp/',
  'wss://www.btcbox.co.jp/ws',
  'wss://www.btcbox.co.jp/websocket',
  'wss://www.btcbox.co.jp/api/v1/ws',
  'wss://www.btcbox.co.jp/socket.io/?EIO=4&transport=websocket',
  'wss://www.btcbox.co.jp/socket.io/?EIO=3&transport=websocket',
];

function attempt(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const done = (result) => {
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
      resolve({ url, ms: Math.round(performance.now() - t0), ...result });
    };
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000 });
    const timer = setTimeout(() => done({ outcome: 'timeout' }), 10_000);
    ws.on('open', () => done({ outcome: 'open' }));
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => {
        if (body.length < 200) body += c;
      });
      res.on('end', () => done({ outcome: 'refused', status: res.statusCode, server: res.headers.server, ray: res.headers['cf-ray'], body: body.replace(/\s+/g, ' ').slice(0, 120) }));
    });
    ws.on('error', (e) => done({ outcome: 'error', error: e.message }));
  });
}

log('ccxt', { version: ccxt.version, has_ws: new ccxt.btcbox().has.ws, pro_class: typeof ccxt.pro?.btcbox, pro_exchanges_with_btcbox: (ccxt.pro?.exchanges ?? []).includes('btcbox') });

for (const host of HOSTS) {
  try {
    const addrs = await lookup(host, { all: true });
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  } catch (e) {
    log('dns', { host, error: e.code });
  }
}

for (const url of URLS) {
  log('handshake', await attempt(url));
}
