// XBO.com WebSocket probe: what the documented futures socket and a few undocumented spot socket guesses answer to a client that sends no API key.
// Public, unauthenticated, read-only. No XBO-API-KEY, XBO-API-SIGN or XBO-API-TIMESTAMP header is sent, so the documented futures socket is expected to refuse the upgrade with 401.
// If a socket does open, the probe subscribes the documented books and tickers channels for BTC-USDT-PERP, sends the literal "ping" every 10 s, and records for 20 s.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/xbo/ws-probe.mjs [futures|guess|deflate|all]
//   futures  the documented wss://api.xbo.com/ws/v1/futures, three attempts: status, headers, body of the refusal, and time to refusal. About 3 s.
//   guess    undocumented URLs a spot or public socket might use: status of each upgrade. About 3 s.
//   deflate  the futures URL once more while offering permessage-deflate, to see whether the refusal changes. About 1 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/xbo/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FUTURES_URL = 'wss://api.xbo.com/ws/v1/futures';
const GUESSES = ['wss://api.xbo.com/ws/v1/spot', 'wss://api.xbo.com/ws/v1', 'wss://api.xbo.com/ws', 'wss://ws.xbo.com/'];
const UA = 'arbitrage-observatory-research-probe/1.0';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

const KEEP_HEADERS = ['server', 'cf-ray', 'content-type', 'content-length', 'www-authenticate', 'sec-websocket-extensions', 'upgrade', 'connection', 'date'];

// Resolves with what the server did to the upgrade: refused with a status, opened, or failed below HTTP.
function attempt(url, { deflate = false, holdMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: deflate, headers: { 'user-agent': UA }, handshakeTimeout: 10_000 });
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      resolve({ url, deflate, ms: Math.round(performance.now() - t0), ...r });
    };

    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => {
        if (body.length < 2000) body += d.toString('utf8');
      });
      res.on('end', () => {
        const headers = Object.fromEntries(KEEP_HEADERS.filter((h) => res.headers[h] !== undefined).map((h) => [h, res.headers[h]]));
        finish({ outcome: 'refused', status: res.statusCode, headers, body: body.slice(0, 300) });
      });
      res.on('error', () => finish({ outcome: 'refused', status: res.statusCode }));
    });

    ws.on('open', () => {
      const frames = [];
      const ext = ws.extensions;
      ws.on('message', (data, isBinary) => {
        const text = isBinary ? `<binary ${data.length} bytes>` : data.toString('utf8');
        capture('open-frames.txt', text.slice(0, 4000));
        if (frames.length < 20) frames.push(text.slice(0, 300));
      });
      ws.send(JSON.stringify({ operation: 'subscribe', id: 'probe-1', arguments: [{ channel: 'books', instrumentId: 'BTC-USDT-PERP' }, { channel: 'tickers', instrumentId: 'BTC-USDT-PERP' }] }));
      const ping = setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 10_000);
      setTimeout(() => {
        clearInterval(ping);
        ws.close();
        finish({ outcome: 'opened', extensions: ext, framesSeen: frames.length, firstFrames: frames.slice(0, 5) });
      }, holdMs);
      ws.on('close', (code) => {
        clearInterval(ping);
        finish({ outcome: 'opened then closed', closeCode: code, extensions: ext, framesSeen: frames.length, firstFrames: frames.slice(0, 5) });
      });
    });

    ws.on('error', (err) => {
      if (!done) setTimeout(() => finish({ outcome: 'error', error: String(err.message ?? err).slice(0, 200) }), 50);
    });
  });
}

async function futures() {
  for (let i = 0; i < 3; i++) {
    log('futures', await attempt(FUTURES_URL));
    await sleep(500);
  }
}

async function guess() {
  for (const url of GUESSES) {
    log('guess', await attempt(url));
    await sleep(500);
  }
}

async function deflate() {
  log('deflate', await attempt(FUTURES_URL, { deflate: true }));
}

const mode = process.argv[2] ?? 'all';
const modes = { futures, guess, deflate };
const run = mode === 'all' ? Object.keys(modes) : [mode];
log('start', { mode, at: new Date().toISOString() });
for (const m of run) {
  if (!modes[m]) throw new Error(`unknown mode ${m}`);
  await modes[m]();
}
log('end', { at: new Date().toISOString() });
