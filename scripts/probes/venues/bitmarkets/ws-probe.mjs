// BITmarkets WebSocket probe: whether any public socket host accepts a handshake, and what an open socket sends unprompted and in answer to generic pings.
// BITmarkets publishes no WebSocket API documentation, so the hosts come from the web app config archived on 2025-09-23 and from DNS.
// Public, unauthenticated, read-only. No login, no private channel, no subscribe to an account stream. Sockets open with perMessageDeflate false, like the engine does.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitmarkets/ws-probe.mjs [generic|idle|early]
//   generic  waits 10 s for unprompted frames, then sends four generic pings 3 s apart. About 60 s.
//   idle     sends nothing and holds each platform-api socket up to 40 s, to time a server idle close.
//   early    sends each generic ping 2 s after open on its own socket, to see whether a frame ends the socket. Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/bitmarkets/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const TARGETS = [
  'wss://platform-api.bitmarkets.com:8443/', // tradingSocket in the archived web app config
  'wss://platform-api.bitmarkets.com:2096/', // spotPublicSocket in the same config
  'wss://ws.bitmarkets.com/', // DNS name, answers plain HTTP with the block JSON
];
const PROBES = ['ping', '{"op":"ping"}', '{"method":"ping"}', '{"event":"ping"}'];
const MODE = process.argv[2] ?? 'generic';
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function probe(url, plan) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const frames = [];
    let pings = 0;
    let finished = false;
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000 });
    const done = (why) => {
      if (finished) return;
      finished = true;
      log('done', { url, why, frames: frames.length, serverPings: pings, heldMs: Date.now() - t0 });
      try { ws.terminate(); } catch {}
      resolve();
    };
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        log('refused', { url, status: res.statusCode, server: res.headers.server, body: body.slice(0, 160) });
        done('unexpected-response');
      });
    });
    ws.on('upgrade', (res) => log('upgrade', { url, status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null, protocol: res.headers['sec-websocket-protocol'] ?? null }));
    ws.on('open', async () => {
      log('open', { url, ms: Date.now() - t0 });
      if (plan.idleMs) {
        await sleep(plan.idleMs);
        return done('idle timer');
      }
      await sleep(plan.waitMs);
      log('unprompted', { url, frames: frames.length });
      for (const p of plan.send) {
        if (ws.readyState !== WebSocket.OPEN) break;
        const before = frames.length;
        ws.send(p);
        await sleep(3_000);
        log('reply', { url, sent: p, newFrames: frames.length - before, first: frames[before]?.slice(0, 200) ?? null });
      }
      done('timer');
    });
    ws.on('ping', () => pings++);
    ws.on('message', (data, isBinary) => {
      const text = isBinary ? `<binary ${data.length} bytes>` : data.toString();
      frames.push(text);
      capture('frames.txt', `${Date.now()} ${url} ${text.slice(0, 2000)}`);
    });
    ws.on('close', (code, reason) => {
      log('close', { url, code, reason: reason.toString(), atMs: Date.now() - t0 });
      done('close');
    });
    ws.on('error', (err) => log('error', { url, message: err.message }));
  });
}

if (MODE === 'idle') {
  for (const url of TARGETS.slice(0, 2)) await probe(url, { idleMs: 40_000 });
} else if (MODE === 'early') {
  for (const p of PROBES) await probe(TARGETS[0], { waitMs: 2_000, send: [p] });
} else {
  for (const url of TARGETS) await probe(url, { waitMs: 10_000, send: PROBES });
}
