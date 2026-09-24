// BVOX (formerly BitVenus) WebSocket reachability probe: tries the quote socket of the venue's archived web app and the BHEX broker open API socket on every BVOX host, and prints what each handshake returns.
// A socket that opens gets one depth subscription and one application ping and is held for 15 s.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/venues/bvox/ws-probe.mjs
// About 20 s when every handshake is refused. Set PROBE_OUT_DIR to keep refusal bodies and frames. Recorded in docs/profiles/bvox/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const OUT = process.env.PROBE_OUT_DIR;
const HOLD_MS = 15_000;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

// The web app built its quote socket as the page origin plus /ws/quote/v1, in main-be17c5a6.297cc435.chunk.js archived 2025-09.
// The BHEX broker open API serves raw streams at wsapi.<domain>/openapi/quote/ws/v1, doc/Websocket Stream EN.md of github.com/bhexopen/BHEX-OpenApi.
const URLS = [
  'wss://www.bvox.com/ws/quote/v1',
  'wss://www.bvox.com/openapi/quote/ws/v1',
  'wss://wsapi.bvox.com/openapi/quote/ws/v1',
  'wss://ws.bvox.com/ws/quote/v1',
  'wss://api.bvox.com/openapi/quote/ws/v1',
  'wss://wsapi.bitvenus.me/openapi/quote/ws/v1',
  'wss://www.bitvenus.me/ws/quote/v1',
];

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function probe(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000 });
    let frames = 0;
    let done = false;
    const finish = (obj) => {
      if (done) return;
      done = true;
      log('ws', { url, ...obj });
      resolve();
    };

    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => {
        body += d;
      });
      res.on('end', () => {
        capture('ws-refusals.txt', `${url}\n${res.statusCode}\n${body}`);
        const title = body.match(/<title>([^<]*)/)?.[1]?.trim();
        finish({ result: 'refused', status: res.statusCode, ms: ms(), server: res.headers.server, retryAfter: res.headers['retry-after'], type: res.headers['content-type'], bytes: Buffer.byteLength(body), title, regionBlock: body.includes('Not Support Region') });
        req.destroy();
      });
    });

    ws.on('open', () => {
      const openMs = ms();
      ws.send(JSON.stringify({ symbol: 'BTC-SWAP-USDT', topic: 'depth', event: 'sub', params: { binary: false } }));
      ws.send(JSON.stringify({ ping: Date.now() }));
      setTimeout(() => {
        finish({ result: 'open', openMs, frames, heldMs: ms(), extensions: ws.extensions });
        ws.terminate();
      }, HOLD_MS);
    });

    ws.on('message', (data) => {
      frames++;
      if (frames <= 20) capture('ws-frames.txt', `${url} ${data.toString('utf8').slice(0, 2000)}`);
    });

    ws.on('error', (err) => {
      finish({ result: 'error', error: err.code ?? err.message, ms: ms() });
    });

    ws.on('close', (code) => {
      finish({ result: 'closed', code, frames, ms: ms() });
    });
  });
}

for (const url of URLS) {
  await probe(url);
}
