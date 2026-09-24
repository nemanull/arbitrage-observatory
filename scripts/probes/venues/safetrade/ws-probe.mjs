// SafeTrade WebSocket probe: what the public socket handshake returns to this host on both SafeTrade domains and on the legacy Peatio ranger path.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// A socket that does open subscribes the documented depth stream and is held for at most 20 s. No attempt is made to pass a challenge page.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/safetrade/ws-probe.mjs [handshake]
//   handshake  one socket per URL, one at a time, prints status, Cloudflare headers and the refusal text, or the first frames if it opens. About 10 s when refused.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/safetrade/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

// The first URL is the one the official example client builds, github.com/safetrade-exchange/example-client ws.py and main.py.
const URLS = [
  'wss://safe.trade/api/v2/websocket/public',
  'wss://safetrade.com/api/v2/websocket/public',
  'wss://safe.trade/api/v2/ranger/public/?stream=global.tickers',
];

// The subscribe frame the example client sends, with the depth stream spelled `<market>.depth`.
const SUBSCRIBE = { event: 'subscribe', streams: ['btcusdt.depth', 'btcusdt.trades'] };
const HOLD_MS = 20_000;
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function refusalText(body) {
  const text = body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const i = text.indexOf('If you are seeing this page');
  return i >= 0 ? text.slice(i, i + 160) : text.slice(0, 160);
}

function probe(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 15_000 });
    let frames = 0;
    let timer;
    const done = (why) => {
      clearTimeout(timer);
      try { ws.terminate(); } catch {}
      resolve(why);
    };

    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 20_000) body += d; });
      res.on('end', () => {
        capture('refusal.html', `${url}\n${body}`);
        log('refused', {
          url,
          ms: ms(),
          status: res.statusCode,
          cfMitigated: res.headers['cf-mitigated'] ?? null,
          cfRay: res.headers['cf-ray'] ?? null,
          server: res.headers.server ?? null,
          extensions: res.headers['sec-websocket-extensions'] ?? null,
          canadaNotice: body.includes('you may be from Canada'),
          text: refusalText(body),
        });
        done('refused');
      });
    });

    ws.on('upgrade', (res) => log('upgrade', { url, ms: ms(), status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null }));

    ws.on('open', () => {
      log('open', { url, ms: ms() });
      ws.send(JSON.stringify(SUBSCRIBE));
      timer = setTimeout(() => done('held'), HOLD_MS);
    });

    ws.on('message', (data, isBinary) => {
      frames += 1;
      const text = isBinary ? `<binary ${data.length} bytes>` : data.toString('utf8');
      capture('frames.jsonl', text);
      if (frames <= 5) log('frame', { url, ms: ms(), n: frames, text: text.slice(0, 300) });
    });

    ws.on('ping', () => log('server_ping', { url, ms: ms() }));
    ws.on('error', (err) => { log('error', { url, ms: ms(), error: err.message }); done('error'); });
    ws.on('close', (code, reason) => { log('close', { url, ms: ms(), code, reason: reason.toString(), frames }); done('closed'); });
  });
}

const mode = process.argv[2] ?? 'handshake';
if (mode !== 'handshake') {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}

for (const url of URLS) {
  await probe(url);
  await new Promise((r) => setTimeout(r, 1_000));
}
