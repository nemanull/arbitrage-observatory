// INX One (now served as Republic trading) WebSocket probe: what the documented streaming gateway does with a client that carries no token.
// Public, unauthenticated, read-only. No API key and no websocket token are sent, so the documented authorization and apiKey headers are absent on purpose.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks once to see what the server negotiates.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/inx-one/ws-probe.mjs [connect|deflate]
//   connect  opens the documented URL twice: once exactly as the engine does, with no headers at all, and once with an honest User-Agent naming this probe.
//            If an upgrade succeeds, it sends the documented order book and all trades subscribes for BTC-USD, answers pings, and listens for 30 s. About 5 s when both are refused.
//   deflate  asks for permessage-deflate once, with the honest User-Agent, and prints the upgrade status and any negotiated extension. About 5 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/inx-one/websocket.md.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://gw-client-api-ws.trading.republic.com';
const LISTEN_MS = 30_000;
// The ws package sends no User-Agent, and neither does the engine's VenueFeed. This one names the probe and imitates no browser.
const HONEST_UA = { 'User-Agent': 'arbitrage-observatory-ws-probe/1 (read-only research)' };
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// Resolves when the socket closes, fails the upgrade, or the listen window ends.
function open(label, url, options, onOpen) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const ws = new WebSocket(url, options);
    let frames = 0;
    let timer;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };

    ws.on('upgrade', (res) => {
      log(label, { event: 'upgrade', ms: ms(), status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, cfRay: res.headers['cf-ray'] });
    });
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => {
        if (body.length < 2000) body += d;
      });
      res.on('end', () => {
        const h = res.headers;
        log(label, {
          event: 'unexpected-response',
          ms: ms(),
          status: res.statusCode,
          statusMessage: res.statusMessage,
          type: h['content-type'],
          server: h.server,
          cfRay: h['cf-ray'],
          requestId: h.requestid,
          body: /<title>/i.test(body) ? undefined : body.slice(0, 500),
        });
        capture(`${label}-refusal.txt`, body);
        const title = /<title>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
        const headings = [...body.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (title) log(label, { event: 'refusal-page', title, headings });
        req.destroy();
        done();
      });
    });
    ws.on('open', () => {
      log(label, { event: 'open', ms: ms() });
      onOpen?.(ws);
      timer = setTimeout(() => ws.close(1000), LISTEN_MS);
    });
    ws.on('ping', (data) => {
      log(label, { event: 'protocol-ping', ms: ms(), data: data.toString() });
    });
    ws.on('message', (data) => {
      frames++;
      const text = data.toString();
      capture(`${label}-frames.jsonl`, text.slice(0, 4000));
      if (frames <= 10) log(label, { event: 'frame', ms: ms(), n: frames, text: text.slice(0, 400) });
      // The documentation says the server sends a 'ping' message and expects 'pong', without saying whether it is a text frame or a protocol ping.
      if (text === 'ping' || text.includes('"ping"')) ws.send('pong');
    });
    ws.on('error', (err) => log(label, { event: 'error', ms: ms(), message: err.message }));
    ws.on('close', (code, reason) => {
      log(label, { event: 'close', ms: ms(), code, reason: reason.toString(), frames });
      done();
    });
  });
}

function subscribeBook(ws) {
  const subscribe = (event, data) => ws.send(JSON.stringify({ event, data: { ...data, clientRequestId: randomUUID() } }));
  subscribe('orderBook/subscribeOrderBook', { marketName: 'BTC-USD', depth: 20 });
  subscribe('allTrades/subscribeAllTrades', { marketName: 'BTC-USD' });
}

async function connect() {
  await open('engineLike', WS_URL, { perMessageDeflate: false }, subscribeBook);
  await open('honestUa', WS_URL, { perMessageDeflate: false, headers: HONEST_UA }, subscribeBook);
}

async function deflate() {
  await open('deflate', WS_URL, { perMessageDeflate: true, headers: HONEST_UA });
}

const mode = process.argv[2] ?? 'connect';
const modes = { connect, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, expected one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, url: WS_URL, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
// A refused upgrade leaves the response socket open for about a minute, so exit rather than wait for it.
process.exit(0);
