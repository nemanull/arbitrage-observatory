// IBIT Global WebSocket probe: what each socket host found in the web app's bundle answers to an unsigned handshake, and whether an opened socket serves a public market channel.
// Public, unauthenticated, read-only. The web app appends a ts and a sign query parameter. This probe never computes the sign.
// Mode plain connects with no query, mode ts adds only ts, the way a client without the web app's signing code would.
// Sockets open with perMessageDeflate false, like the engine does. Each socket is held at most 8 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/ibit-global/ws-probe.mjs
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/ibit-global/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const HOSTS = [
  ['futures-market', 'wss://prod-ibit-market-server-p-co-p-group.aka-line-a.com/ws/quotation', ['gzip_market_all_mark_price', 'gzip_market_all_index_price']],
  ['spot-market', 'wss://prod-ibit-spot-market-server-p-co-p-group.aka-line-a.com/ws/quotation', ['market_all_latest_price']],
  ['futures-private', 'wss://prod-ibit-futures-ws-p-group.aka-line-a.com/ws/futures', null],
  ['spot-private', 'wss://prod-ibit-spot-ws-p-group.aka-line-a.com/ws/spot', null],
  ['msghub', 'wss://prod-ibit-msghub-p-wsserver-pc.aka-line-a.com/ws', null],
];
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function decode(data, isBinary) {
  if (!isBinary) return data.toString();
  for (const f of [gunzipSync, inflateSync]) {
    try { return f(data).toString(); } catch {}
  }
  return `<binary ${data.length} bytes>`;
}

function probe(name, url, channels) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 8000 });
    let frames = 0;
    const done = (why) => { clearTimeout(timer); try { ws.terminate(); } catch {} log('end', { name, why, frames, ms: Date.now() - t0 }); resolve(); };
    const timer = setTimeout(() => done('held 8 s'), 8000);
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const title = /<TITLE>([^<]*)<\/TITLE>/i.exec(body)?.[1];
        log('refused', { name, url, status: res.statusCode, ms: Date.now() - t0, server: res.headers.server, title, body: title ? undefined : body.slice(0, 200) });
        capture(`${name}-refusal.html`, body);
        done('refused');
      });
    });
    ws.on('open', () => {
      log('open', { name, url, ms: Date.now() - t0, extensions: ws.extensions });
      if (channels) ws.send(JSON.stringify({ event: 'sub', params: { channels } }));
      ws.send(JSON.stringify({ event: 'ping' }));
    });
    ws.on('message', (data, isBinary) => {
      frames++;
      const text = decode(data, isBinary);
      capture(`${name}-frames.txt`, text);
      if (frames <= 3) log('frame', { name, isBinary, bytes: data.length, head: text.slice(0, 240) });
    });
    ws.on('close', (code, reason) => { log('close', { name, code, reason: reason.toString(), ms: Date.now() - t0 }); done('closed'); });
    ws.on('error', (e) => { log('error', { name, message: e.message }); done('error'); });
  });
}

const mode = process.argv[2] ?? 'both';
for (const [name, url, channels] of HOSTS) {
  if (mode !== 'ts') await probe(name, url, channels);
  if (mode !== 'plain') await probe(`${name}-ts`, `${url}?ts=${Date.now()}`, channels);
}
