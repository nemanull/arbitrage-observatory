// Tapbit WebSocket probe: whether this host can open the documented public socket, and if it can, the book and ticker channels of the USDT perpetuals and of spot.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, one socket at a time, at most one open per second as documented.
// Run from server/: node ../scripts/probes/venues/tapbit/ws-probe.mjs [access|book|silence|deflate]
//   access   opens the socket three times and prints the handshake result: open time and the first frames, or the refusal status, headers and body.
//   book     perpetual and spot book topics at several depths, ticker.all, unknown and bad-depth topics, for 60 s: first action, version chain, level order, pings.
//   silence  one socket that never answers the server's ping, for up to 60 s, to see when the server closes it.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/tapbit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://ws-openapi.tapbit.com/stream/ws'; // one URL for spot and perpetuals, per the docs
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Resolves with the open socket, or with the refusal the handshake produced.
function open(options = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(URL_WS, { perMessageDeflate: false, handshakeTimeout: 15_000, ...options });
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('unexpected-response', (req, res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          refused: {
            status: res.statusCode,
            server: res.headers.server,
            xCache: res.headers['x-cache'],
            pop: res.headers['x-amz-cf-pop'],
            contentType: res.headers['content-type'],
            body: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
          },
          ms: Math.round(performance.now() - t0),
        });
        req.destroy();
      });
    });
    ws.once('error', (e) => resolve({ error: e.message, ms: Math.round(performance.now() - t0) }));
  });
}

async function access() {
  for (let i = 0; i < 3; i++) {
    const r = await open();
    if (!r.ws) {
      log('access', { i, ...r });
      await sleep(1500);
      continue;
    }
    const frames = [];
    let pings = 0;
    r.ws.on('ping', () => pings++);
    r.ws.on('message', (d, isBinary) => frames.push({ isBinary, text: d.toString('utf8').slice(0, 160) }));
    await sleep(8000);
    log('access', { i, openMs: r.openMs, protocolPingsIn8s: pings, frames: frames.slice(0, 5), frameCount: frames.length });
    r.ws.terminate();
    await sleep(1500);
  }
}

// Book topics: the version chain, first action, level order and level counts, per topic.
async function book() {
  const r = await open();
  if (!r.ws) {
    log('book', { refused: true, ...r });
    return;
  }
  const ws = r.ws;
  log('open', { openMs: r.openMs });
  const topics = [
    'usdt/orderBook.BTC-SWAP.50',
    'usdt/orderBook.ETH-SWAP.200',
    'usdt/orderBook.DOGE-SWAP',
    'spot/orderBook.BTCUSDT.50',
  ];
  const state = new Map();
  let pings = 0;
  let textPings = 0;
  const other = [];
  ws.on('ping', () => pings++);
  ws.on('message', (d, isBinary) => {
    const text = d.toString('utf8');
    if (isBinary) {
      other.push({ binary: true, bytes: d.length });
      return;
    }
    if (text === 'ping' || text === 'pong') {
      textPings++;
      return;
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      other.push({ notJson: text.slice(0, 120) });
      return;
    }
    if (!msg.topic || !Array.isArray(msg.data)) {
      other.push(msg);
      capture('control.jsonl', text);
      return;
    }
    let s = state.get(msg.topic);
    if (!s) {
      s = { frames: 0, actions: {}, firstAction: msg.action, gaps: 0, nonIncreasing: 0, steps: {}, bidDisorder: 0, askDisorder: 0, maxBids: 0, maxAsks: 0, last: undefined };
      state.set(msg.topic, s);
      capture('first-frames.jsonl', text);
    }
    s.frames++;
    s.actions[msg.action] = (s.actions[msg.action] ?? 0) + 1;
    for (const item of msg.data) {
      const v = item.version;
      if (s.last !== undefined) {
        const step = v - s.last;
        const key = step > 5 ? '>5' : String(step);
        s.steps[key] = (s.steps[key] ?? 0) + 1;
        if (step <= 0) s.nonIncreasing++;
        if (step !== 1) s.gaps++;
      }
      s.last = v;
      const bids = item.bids ?? [];
      const asks = item.asks ?? [];
      s.maxBids = Math.max(s.maxBids, bids.length);
      s.maxAsks = Math.max(s.maxAsks, asks.length);
      for (let i = 1; i < bids.length; i++) if (Number(bids[i][0]) > Number(bids[i - 1][0])) { s.bidDisorder++; break; }
      for (let i = 1; i < asks.length; i++) if (Number(asks[i][0]) < Number(asks[i - 1][0])) { s.askDisorder++; break; }
      s.types = `${typeof bids[0]?.[0]}/${typeof bids[0]?.[1]}`;
    }
    if (s.frames === 2) capture('second-frames.jsonl', text);
  });
  ws.send(JSON.stringify({ op: 'subscribe', args: topics }));
  await sleep(2000);
  ws.send(JSON.stringify({ op: 'subscribe', args: ['usdt/orderBook.NOPE-SWAP.50'] }));
  await sleep(1000);
  ws.send(JSON.stringify({ op: 'subscribe', args: ['usdt/orderBook.BTC-SWAP.30'] }));
  await sleep(1000);
  ws.send(JSON.stringify({ op: 'subscribe', args: ['usdt/ticker.all'] }));
  await sleep(1000);
  ws.send('not json');
  await sleep(55_000);
  ws.terminate();
  for (const [topic, s] of state) {
    delete s.last;
    log('topic', { topic, ...s });
  }
  log('session', { protocolPings: pings, textPings, other: other.slice(0, 8), otherCount: other.length });
}

async function silence() {
  const r = await open({ autoPong: false });
  if (!r.ws) {
    log('silence', { refused: true, ...r });
    return;
  }
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  const pings = [];
  r.ws.on('ping', () => pings.push(at()));
  r.ws.on('message', (d) => {
    const t = d.toString('utf8');
    if (t === 'ping') pings.push(`text@${at()}`);
  });
  const closed = await Promise.race([
    new Promise((res) => r.ws.once('close', (code, reason) => res({ code, reason: reason.toString(), ms: at() }))),
    sleep(60_000).then(() => null),
  ]);
  log('silence', { pings, closed });
  r.ws.terminate();
}

async function deflate() {
  const r = await open({ perMessageDeflate: true });
  if (!r.ws) {
    log('deflate', { refused: true, ...r });
    return;
  }
  log('deflate', { extensions: r.ws.extensions || '(none)' });
  r.ws.terminate();
}

const mode = process.argv[2] ?? 'access';
const modes = { access, book, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
