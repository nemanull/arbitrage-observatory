// 4E (eeee.com) WebSocket probe: whether any guessed public socket URL accepts a handshake without the web client's signed bootstrap.
// 4E publishes no socket URL. Its web client reads `ws3_url` from a signed `/Publics/getWebInitInfo` call, which this probe does not make.
// Public, unauthenticated, read-only. Each socket opens with perMessageDeflate false, like the engine, sends the web client's text "ping" once, and closes after 8 s at most.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/four-e/ws-probe.mjs
// Prints one line per URL. Recorded in docs/profiles/four-e/websocket.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

const URLS = [
  'wss://www.eeee.com/ws',
  'wss://api.eeee.com/ws',
  'wss://app.eeee.com/ws',
  'wss://contract.eeee.com/ws',
  'wss://apiuni.eeee.com/ws',
];

function probe(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const out = { url, frames: 0 };
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 8000 });
    const done = () => { clearTimeout(timer); try { ws.terminate(); } catch {} resolve(out); };
    const timer = setTimeout(done, 8000);
    ws.on('unexpected-response', (_req, res) => {
      out.httpStatus = res.statusCode;
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { out.body = body.slice(0, 120).replace(/\s+/g, ' '); done(); });
    });
    ws.on('open', () => {
      out.openMs = Math.round(performance.now() - t0);
      out.extensions = ws.extensions;
      ws.send('ping');
    });
    ws.on('message', (data, isBinary) => {
      out.frames += 1;
      if (out.frames === 1) out.first = isBinary ? `binary ${data.length} bytes` : String(data).slice(0, 120);
    });
    ws.on('close', (code) => { out.closeCode = code; done(); });
    ws.on('error', (e) => { out.error = e.code ?? e.message; });
  });
}

for (const url of URLS) log('ws', await probe(url));
