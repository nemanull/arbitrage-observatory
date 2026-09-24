// Tokpie WebSocket probe: whether the exchange's own pages use a socket, whether the documented public socket ws://tokpie.com:8222 opens, what it answers instead, and whether any other spelling of it opens.
// If a socket does open, it subscribes the documented trade topic in both documented frame shapes, tries a guessed book topic, and holds the socket for 60 s with a protocol ping every 30 s.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one attempt that offers deflate on purpose.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/tokpie/ws-probe.mjs
// About 45 s when nothing opens. Recorded in docs/profiles/tokpie/websocket.md.
import { createRequire } from 'node:module';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const PAIR = 'ETH@USDT';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function tcp(host, port) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const s = net.connect({ host, port, timeout: 8_000 });
    s.on('connect', () => { resolve({ ok: true, ms: Math.round(performance.now() - t0) }); s.destroy(); });
    s.on('timeout', () => { resolve({ ok: false, error: 'timeout', ms: Math.round(performance.now() - t0) }); s.destroy(); });
    s.on('error', (e) => resolve({ ok: false, error: e.code, ms: Math.round(performance.now() - t0) }));
  });
}

// Opens one socket and reports open, refusal (status, headers, body) or error.
// On open it runs the documented subscribes and holds the socket for holdMs.
function attempt(label, url, { deflate = false, origin, holdMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const ws = new WebSocket(url, { perMessageDeflate: deflate, handshakeTimeout: 10_000, ...(origin ? { origin } : {}) });
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; log('attempt', { label, url, deflate, origin, ...r }); resolve(r); } };
    ws.on('unexpected-response', (_req, res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const h = res.headers;
        done({ opened: false, ms: ms(), status: res.statusCode, headers: { server: h.server, 'content-type': h['content-type'], connection: h.connection, upgrade: h.upgrade }, body: Buffer.concat(chunks).toString('utf8').slice(0, 120) });
        ws.terminate();
      });
    });
    ws.on('error', (e) => done({ opened: false, ms: ms(), error: e.code ?? e.message.slice(0, 100) }));
    ws.on('open', async () => {
      const frames = [];
      log('open', { label, ms: ms(), extensions: ws.extensions || null });
      ws.on('message', (d) => frames.push({ at: ms(), text: d.toString().slice(0, 300) }));
      ws.on('pong', () => frames.push({ at: ms(), text: 'protocol pong' }));
      ws.on('close', (code, reason) => frames.push({ at: ms(), text: `close ${code} ${reason}` }));
      ws.send(JSON.stringify({ sws_operation: 'swsOperationSubscribe', sws_pair: PAIR }));
      ws.send(JSON.stringify({ op: 'subscribe', args: [`tradeHistory:${PAIR}`] }));
      ws.send(JSON.stringify({ op: 'subscribe', args: [`orderBook:${PAIR}`] }));
      ws.send(JSON.stringify({ op: 'subscribe', args: ['tradeHistory:NOPE@USDT'] }));
      const ping = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 30_000);
      await sleep(holdMs);
      clearInterval(ping);
      ws.close();
      done({ opened: true, ms: ms(), frames: frames.length, first: frames.slice(0, 6) });
    });
  });
}

function fetchText(url) {
  return new Promise((resolve) => {
    const proto = url.startsWith('https') ? https : http;
    const t0 = performance.now();
    const req = proto.get(url, { timeout: 15_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Math.round(performance.now() - t0), headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Math.round(performance.now() - t0), body: '' }));
  });
}

// Whether the exchange's own web pages use a socket at all.
const login = await fetchText('https://tokpie.com/login/');
const bundles = [...new Set(login.body.match(/\/static\/[^"']+\.js/g) ?? [])];
let socketUrls = [...new Set(login.body.match(/wss?:\/\/[^"'\s]+/g) ?? [])];
const ajaxRoutes = new Set();
for (const path of bundles) {
  const r = await fetchText(`https://tokpie.com${path}`);
  (r.body.match(/wss?:\/\/[^"'\s]+/g) ?? []).forEach((u) => socketUrls.push(u));
  (r.body.match(/['"]\/ajax_[a-z0-9_]+\/['"]/g) ?? []).forEach((u) => ajaxRoutes.add(u));
  await sleep(300);
}
log('site', { loginStatus: login.status, bundles: bundles.length, socketUrls: [...new Set(socketUrls)], ajaxRoutes: ajaxRoutes.size });

const plain = await fetchText('http://tokpie.com:8222/');
log('plain_get', { url: 'http://tokpie.com:8222/', status: plain.status, ms: plain.ms, contentType: plain.headers?.['content-type'], body: plain.body.slice(0, 60) });

log('tcp', { host: 'tokpie.com', port: 8222, ...(await tcp('tokpie.com', 8222)) });
log('tcp', { host: 'tokpie.com', port: 443, ...(await tcp('tokpie.com', 443)) });
await attempt('documented', 'ws://tokpie.com:8222');
await sleep(500);
await attempt('documented with site origin', 'ws://tokpie.com:8222', { origin: 'https://tokpie.com' });
await sleep(500);
await attempt('documented offering deflate', 'ws://tokpie.com:8222', { deflate: true });
await sleep(500);
await attempt('path /ws', 'ws://tokpie.com:8222/ws');
await sleep(500);
await attempt('path /websocket', 'ws://tokpie.com:8222/websocket');
await sleep(500);
await attempt('socket.io path', 'ws://tokpie.com:8222/socket.io/?EIO=3&transport=websocket');
await sleep(500);
await attempt('tls on the same port', 'wss://tokpie.com:8222');
await sleep(500);
await attempt('tls on 443, path /ws', 'wss://tokpie.com/ws');
