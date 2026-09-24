// SAFEbit WebSocket probe: does any public socket accept an anonymous upgrade from this host.
// SAFEbit documents no WebSocket. Its web app asks the internal /api/WebSocket/GetProvider call for a socket URL, and that call refused this host.
// So this probe only tries the upgrade on the resolvable ws host and on the aggregator API host, records the status and headers, and closes.
// It sends no subscribe frame, because no public socket or channel is documented and the user agreement forbids automated access through interfaces SAFEbit does not provide.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts. About 10 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/safebit/ws-probe.mjs
// Recorded in docs/profiles/safebit/websocket.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const CANDIDATES = [
  'wss://ws.safebit.com.tr/',
  'wss://ws.safebit.com.tr/connection/websocket', // the default path of the Centrifugo protocol the web client speaks, an inference
  'wss://api.safebit.com.tr/',
  'wss://www.safebit.com.tr/',
];
const HOLD_MS = 5_000;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function attempt(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000 });
    let settled = false;
    const done = (row) => {
      if (settled) return;
      settled = true;
      log('upgrade', { url, ...row });
      try {
        ws.terminate();
      } catch {}
      resolve();
    };

    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => {
        if (body.length < 8_000) body += d.toString('utf8');
      });
      res.on('end', () => {
        const title = body.match(/<title>([^<]*)<\/title>/)?.[1];
        const h1 = body.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1];
        done({
          ms: ms(),
          status: res.statusCode,
          server: res.headers.server,
          cfRay: res.headers['cf-ray'],
          type: res.headers['content-type'],
          bytes: body.length,
          title,
          h1,
          text: title ? undefined : body.slice(0, 160),
        });
      });
    });

    ws.on('upgrade', (res) => {
      log('upgrade_headers', { url, status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server });
    });

    ws.on('open', () => {
      const openMs = ms();
      const frames = [];
      ws.on('message', (d) => frames.push(d.toString('utf8').slice(0, 200)));
      setTimeout(() => done({ ms: ms(), status: 101, openMs, openedAndHeldMs: HOLD_MS, unsolicitedFrames: frames.length, first: frames[0] }), HOLD_MS);
    });

    ws.on('close', (code, reason) => done({ ms: ms(), closed: code, reason: reason.toString() }));
    ws.on('error', (err) => done({ ms: ms(), error: err.message }));
  });
}

log('start', { at: new Date().toISOString() });
for (const host of ['ws.safebit.com.tr', 'api.safebit.com.tr', 'www.safebit.com.tr']) {
  try {
    const addrs = await lookup(host, { all: true, family: 4 });
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  } catch (err) {
    log('dns', { host, error: err.code });
  }
}
for (const url of CANDIDATES) {
  await attempt(url);
}
