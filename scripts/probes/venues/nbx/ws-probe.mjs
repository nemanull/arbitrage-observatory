// NBX public WebSocket probe: whether the per market events socket opens from this host, and what it sends if it does.
// Public, unauthenticated, read-only. The documented socket accepts no client frames, so the probe only listens. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/venues/nbx/ws-probe.mjs [open|listen|deflate]
//   open     one handshake each to wss://api.nbx.com/markets/<id>/events for BTC-NOK, PALM-USDM and NOPE-NOK, printing the status and body of any refusal. About 60 s when the origin times out.
//   listen   holds BTC-NOK and PALM-USDM for 90 s if they open, counting events by type and printing the first frame of each type.
//   deflate  one handshake to BTC-NOK that offers permessage-deflate, printing what the server negotiates.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/nbx/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const url = (market) => `wss://api.nbx.com/markets/${market}/events`;
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2_000) + '\n');
}

// Opens one socket and resolves when it closes, fails, or holdMs passes.
function attempt(market, { holdMs = 0, deflate = false } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const counts = {};
    const firsts = {};
    let frames = 0;
    let done = false;
    const ws = new WebSocket(url(market), { perMessageDeflate: deflate, handshakeTimeout: 30_000 });
    const finish = (tag, extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      log(tag, { market, ms: ms(), frames, counts, ...extra });
      for (const [type, text] of Object.entries(firsts)) log('first', { market, type, frame: text.slice(0, 600) });
      try {
        ws.terminate();
      } catch {}
      resolve();
    };
    const timer = setTimeout(() => finish('held', {}), Math.max(holdMs, 1) + 30_000);
    ws.on('upgrade', (res) => log('upgrade', { market, ms: ms(), status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, cfRay: res.headers['cf-ray'] }));
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        const title = (body.match(/<title>([^<]*)<\/title>/i) ?? [])[1];
        keep(`refusal-${market}.html`, body);
        finish('refused', { status: res.statusCode, server: res.headers.server, cfRay: res.headers['cf-ray'], retryAfter: res.headers['retry-after'] ?? null, bytes: body.length, title: title?.trim() });
      });
    });
    ws.on('open', () => {
      log('open', { market, ms: ms() });
      clearTimeout(timer);
      setTimeout(() => finish('held', {}), holdMs);
    });
    ws.on('ping', () => log('server_ping', { market, ms: ms() }));
    ws.on('message', (data) => {
      frames++;
      const text = data.toString('utf8');
      let type = 'unparsed';
      try {
        type = JSON.parse(text).type ?? 'no_type';
      } catch {}
      counts[type] = (counts[type] ?? 0) + 1;
      if (!firsts[type]) firsts[type] = text;
      keep(`frames-${market}.jsonl`, text);
    });
    ws.on('close', (code, reason) => finish('closed', { code, reason: reason.toString() }));
    ws.on('error', (err) => finish('error', { error: String(err?.code ?? err?.message ?? err) }));
  });
}

const mode = process.argv[2] ?? 'open';
if (mode === 'open') {
  for (const m of ['BTC-NOK', 'PALM-USDM', 'NOPE-NOK']) await attempt(m);
} else if (mode === 'listen') {
  await Promise.all(['BTC-NOK', 'PALM-USDM'].map((m) => attempt(m, { holdMs: 90_000 })));
} else if (mode === 'deflate') {
  await attempt('BTC-NOK', { deflate: true });
}
