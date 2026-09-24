// CrypFine WebSocket probe: whether the documented public socket accepts this host, and if it does, what the order book and ticker topics send.
// Public, unauthenticated, read-only. The socket opens with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/crypfine/ws-probe.mjs
// It tries the handshake twice, 2 s apart, under the documented cap of one connection per second.
// On an open socket it subscribes usdt/orderBook.BTC-SWAP.200, usdt/orderBook.ETH-SWAP.50 and usdt/ticker.all for 60 s and answers every server ping.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/crypfine/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://ws-openapi.crypfine.com/backend/exchange/stream/ws';
const TOPICS = ['usdt/orderBook.BTC-SWAP.200', 'usdt/orderBook.ETH-SWAP.50', 'usdt/ticker.all'];
const HOLD_MS = 60_000;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, 'frames.txt'), text.slice(0, 4000) + '\n');
}

function attempt(n) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const ws = new WebSocket(URL_WS, { perMessageDeflate: false, handshakeTimeout: 10_000 });
    const stats = { frames: 0, pings: 0, byTopic: {} };
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      log('result', { attempt: n, ...result, ...stats });
      resolve();
    };

    // A refused upgrade arrives here with the HTTP status, headers and body of the refusal.
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        const title = body.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
        finish({
          opened: false, ms: ms(), status: res.statusCode, server: res.headers.server, cfRay: res.headers['cf-ray'],
          type: res.headers['content-type'], bytes: body.length, title, blocked: /Sorry, you have been blocked/.test(body),
        });
        req.destroy();
      });
    });
    ws.on('error', (e) => finish({ opened: false, ms: ms(), error: e.message }));
    ws.on('upgrade', (res) => log('upgrade', { attempt: n, ms: ms(), extensions: res.headers['sec-websocket-extensions'] ?? null }));
    ws.on('open', () => {
      log('open', { attempt: n, ms: ms() });
      ws.send(JSON.stringify({ op: 'subscribe', args: TOPICS }));
      setTimeout(() => ws.close(1000), HOLD_MS);
    });
    ws.on('ping', (d) => { stats.pings++; ws.pong(d); });
    ws.on('message', (raw, isBinary) => {
      stats.frames++;
      const text = isBinary ? `<binary ${raw.length} bytes>` : raw.toString('utf8');
      capture(`${Date.now()} ${text}`);
      if (stats.frames <= 5) log('frame', { attempt: n, ms: ms(), head: text.slice(0, 300) });
      const topic = text.match(/"topic":"([^"]+)"/)?.[1] ?? 'other';
      stats.byTopic[topic] = (stats.byTopic[topic] ?? 0) + 1;
    });
    ws.on('close', (code, reason) => finish({ opened: true, ms: ms(), closeCode: code, reason: reason.toString() }));
  });
}

await attempt(1);
await sleep(2000);
await attempt(2);
process.exit(0);
