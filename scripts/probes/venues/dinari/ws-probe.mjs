// Dinari WebSocket probe: handshake, what the documented market data socket answers to a client that never authenticates, error frames, server pings, idle lifetime and permessage-deflate negotiation.
// Public, unauthenticated, read-only. It never sends the authenticate command or any credential, and it subscribes only market data.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/dinari/ws-probe.mjs [probe|silence|deflate|all]
//   probe    one socket: unauthenticated market_data_subscribe for quotes and L2, an unknown command, text that is not JSON, then 30 s of listening. About 45 s.
//   silence  one socket that sends nothing for up to 90 s, and one that sends only protocol pings every 15 s.
//   deflate  offers permessage-deflate once on the production and sandbox hosts and prints what each negotiates.
//   all      probe, deflate, then silence (the default). About 2.5 min.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/dinari/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_LIVE = 'wss://ws.api.dinari.com';
const URL_SANDBOX = 'wss://ws.api.sandbox.dinari.com';
const AAPL = '0196ea6d-b6de-70d5-ae41-9525959ef309'; // stock id of AAPL, from the app catalog
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// Opens a socket and records the upgrade reply, every frame, pings and the close, with times relative to creation.
function open(name, url, { deflate = false } = {}) {
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  const ws = new WebSocket(url, { perMessageDeflate: deflate, handshakeTimeout: 15_000 });
  const state = { ws, frames: [], closed: null, opened: null, pings: 0 };
  state.done = new Promise((resolve) => {
    ws.on('upgrade', (res) => {
      log('upgrade', { name, ms: at(), status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server ?? null, cfRay: res.headers['cf-ray'] ?? null });
    });
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        log('refused', { name, ms: at(), status: res.statusCode, headers: { 'content-type': res.headers['content-type'], server: res.headers.server, 'cf-ray': res.headers['cf-ray'] }, body: body.slice(0, 300) });
        state.closed = { refused: res.statusCode, ms: at() };
        resolve();
      });
    });
    ws.on('open', () => { state.opened = at(); log('open', { name, ms: state.opened }); });
    ws.on('message', (data, isBinary) => {
      const text = isBinary ? `<binary ${data.length} bytes>` : data.toString();
      state.frames.push({ ms: at(), text });
      capture(`${name}.log`, `${at()} ${text}`);
      log('frame', { name, ms: at(), bytes: data.length, binary: isBinary, text: text.slice(0, 400) });
    });
    ws.on('ping', () => { state.pings++; log('server_ping', { name, ms: at() }); });
    ws.on('pong', () => log('pong', { name, ms: at() }));
    ws.on('close', (code, reason) => {
      state.closed = { code, reason: reason.toString(), ms: at() };
      log('close', { name, ...state.closed });
      resolve();
    });
    ws.on('error', (e) => log('error', { name, ms: at(), message: e.message }));
  });
  state.send = (obj) => {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (ws.readyState === ws.OPEN) { ws.send(text); log('sent', { name, ms: at(), text: text.slice(0, 200) }); }
  };
  state.ping = () => { if (ws.readyState === ws.OPEN) { ws.ping(); log('sent_ping', { name, ms: at() }); } };
  state.whenOpen = () => new Promise((r) => { if (ws.readyState === ws.OPEN) r(true); else { ws.once('open', () => r(true)); state.done.then(() => r(false)); } });
  return state;
}

async function probe() {
  const s = open('probe', URL_LIVE);
  if (!(await s.whenOpen())) return;
  await sleep(3000); // anything the server says first
  s.send({ command: 'market_data_subscribe', data: { stock_dfn_quotes: [AAPL] } });
  await sleep(4000);
  s.send({ command: 'market_data_subscribe', data: { stock_dfn_l2: [AAPL], stock_dfn_quotes: ['*'] } });
  await sleep(4000);
  s.send({ command: 'nope', data: {} });
  await sleep(3000);
  s.send('not json');
  await sleep(3000);
  s.ping();
  await Promise.race([s.done, sleep(30_000)]);
  log('probe_summary', { frames: s.frames.length, pings: s.pings, closed: s.closed });
  if (!s.closed) { s.ws.close(1000); await s.done; }
}

async function silence() {
  const quiet = open('silent', URL_LIVE);
  const pinger = open('pinger', URL_LIVE);
  await Promise.all([quiet.whenOpen(), pinger.whenOpen()]);
  const timer = setInterval(() => pinger.ping(), 15_000);
  await Promise.race([Promise.all([quiet.done, pinger.done]), sleep(90_000)]);
  clearInterval(timer);
  log('silence_summary', { silent: { frames: quiet.frames.length, pings: quiet.pings, closed: quiet.closed }, pinger: { frames: pinger.frames.length, pings: pinger.pings, closed: pinger.closed } });
  for (const s of [quiet, pinger]) if (!s.closed) { s.ws.close(1000); await s.done; }
}

async function deflate() {
  for (const url of [URL_LIVE, URL_SANDBOX]) {
    const s = open(`deflate ${url}`, url, { deflate: true });
    const ok = await s.whenOpen();
    if (ok) { await sleep(1000); s.ws.close(1000); }
    await Promise.race([s.done, sleep(5000)]);
  }
}

const mode = process.argv[2] ?? 'all';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'probe' || mode === 'all') await probe();
if (mode === 'deflate' || mode === 'all') await deflate();
if (mode === 'silence' || mode === 'all') await silence();
log('end', { at: new Date().toISOString() });
process.exit(0);
