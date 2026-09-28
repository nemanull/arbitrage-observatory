// BiKing WebSocket probe: tries the socket path the website's simulated-trading config names, on the live site host.
// BiKing documents no public WebSocket, so this only records whether a handshake succeeds and what arrives unprompted in 10 s.
// Public, unauthenticated, read-only. Sends nothing after the handshake. Sockets open with perMessageDeflate false, like the engine.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/biking/ws-probe.mjs
// Recorded in docs/profiles/biking/websocket.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URLS = ['wss://www.bikingex.com/websocket', 'wss://www.bikingex.com/ws'];
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

for (const url of URLS) {
  await new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, headers: { Origin: 'https://www.bikingex.com' } });
    let frames = 0;
    const done = setTimeout(() => ws.terminate(), 10_000);
    ws.on('open', () => log('open', { url, ms: Math.round(performance.now() - t0) }));
    ws.on('unexpected-response', (_req, res) => {
      log('refused', { url, status: res.statusCode, ms: Math.round(performance.now() - t0) });
      ws.terminate();
    });
    ws.on('message', (data, isBinary) => {
      frames++;
      if (frames <= 3) log('frame', { url, isBinary, bytes: data.length, head: isBinary ? data.subarray(0, 16).toString('hex') : data.toString().slice(0, 120) });
    });
    ws.on('ping', () => log('ping', { url }));
    ws.on('error', (e) => log('error', { url, message: e.message }));
    ws.on('close', (code) => {
      clearTimeout(done);
      log('close', { url, code, frames, ms: Math.round(performance.now() - t0) });
      resolve();
    });
  });
}
