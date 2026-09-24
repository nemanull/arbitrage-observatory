// BTC Trade UA socket probe: the only WebSocket the venue runs, wss://btc-trade.com.ua/ws/time, which its trading page opens with an empty token.
// It is undocumented, so this probe measures what it is: the handshake, the time_object answer to a ping, the get requests the page tunnels through it, errors, pushes, keepalive and silence.
// Public, unauthenticated, read-only. Every socket opens with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// The deflate case sends the extension offer as a raw header on that same client, so the probe only reports whether the server would negotiate it.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btc-trade-ua/ws-probe.mjs [handshake|rpc|silence]
//   handshake  seven opens that differ in path, host, token, Origin and deflate offer, each answering one ping. About 35 s.
//   rpc        one socket per request: the get paths the trading page uses, other request shapes, and text that is not JSON. About 90 s, since a syncget socket takes 35 s to close.
//   silence    two sockets for up to 110 s, one pinging every 6 s like the page with a get every 20 s, one sending nothing, logging every frame and state change.
// Trade participant names are never printed. Recorded in docs/profiles/btc-trade-ua/websocket.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_TIME = 'wss://btc-trade.com.ua/ws/time';
const KYIV_OFFSET_S = 10_800; // the page subtracts three hours from time_object.time before it shows it
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const redact = (s) => s.replace(/"user":\s*"[^"]*"/g, '"user":"<redacted>"');

function describe(text) {
  try {
    const j = JSON.parse(text);
    const keys = Object.keys(j);
    if (j.result) return keys.join(',') + ' result:' + Object.keys(j.result).join(',');
    return keys.join(',');
  } catch {
    return 'not json';
  }
}

function open(url, { headers = {}, holdMs = 5000, sends = [] } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = { url, headers: Object.keys(headers), frames: [] };
    const ws = new WebSocket(url, { perMessageDeflate: false, headers, handshakeTimeout: 10000 });
    let closeTimer;
    ws.on('upgrade', (res) => {
      out.upgradeStatus = res.statusCode;
      out.server = res.headers.server;
      out.extensions = res.headers['sec-websocket-extensions'] ?? null;
    });
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        out.refused = { status: res.statusCode, contentType: res.headers['content-type'], body: body.slice(0, 160).replace(/\s+/g, ' ') };
        resolve(out);
      });
    });
    ws.on('open', () => {
      out.openMs = Date.now() - t0;
      for (const [at, msg] of sends) {
        setTimeout(() => {
          if (ws.readyState !== ws.OPEN) return;
          ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
          out.frames.push({ ms: Date.now() - t0, sent: typeof msg === 'string' ? msg : JSON.stringify(msg) });
        }, at);
      }
      closeTimer = setTimeout(() => ws.close(1000), holdMs);
    });
    ws.on('message', (d) => {
      const text = d.toString('utf8');
      out.frames.push({ ms: Date.now() - t0, bytes: text.length, kind: describe(text), text: redact(text).slice(0, 220) });
    });
    ws.on('ping', () => out.frames.push({ ms: Date.now() - t0, serverPing: true }));
    ws.on('error', (e) => { out.error = e.message; });
    ws.on('close', (code, reason) => {
      clearTimeout(closeTimer);
      out.close = { code, reason: String(reason), atMs: Date.now() - t0 };
      resolve(out);
    });
  });
}

async function handshake() {
  const cases = [
    ['empty token', `${URL_TIME}?token=`, {}],
    ['empty token with Origin', `${URL_TIME}?token=`, { Origin: 'https://btc-trade.com.ua' }],
    ['no token parameter', URL_TIME, {}],
    ['made up token', `${URL_TIME}?token=0000`, {}],
    ['deflate offered as a raw header', `${URL_TIME}?token=`, { 'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits' }],
    ['unknown path', 'wss://btc-trade.com.ua/ws/nope', {}],
    ['alternate host from main.js', 'wss://btc-trade.app/ws/time?token=', {}],
  ];
  for (const [name, url, headers] of cases) {
    const r = await open(url, { headers, holdMs: 3500, sends: [[1500, { ping: true }]] });
    log('handshake', { name, ...r });
    await sleep(800);
  }
}

async function rpc() {
  const cases = [
    { get: 'api/trades/buy/btc_uah' },
    { get: 'api/trades/sell/btc_uah' },
    { get: 'api/deals/btc_uah' },
    { get: 'api/deals/btc_uah?ts=2026-09-22' },
    { get: 'api/japan_stat/high/btc_uah' },
    { get: 'api/ticker' },
    { get: 'api/market_prices' },
    { get: '/api/trades/buy/btc_uah' },
    { syncget: 'api/trades/buy/btc_uah' },
    { subscribe: 'btc_uah' },
    'not json',
  ];
  for (const msg of cases) {
    const r = await open(`${URL_TIME}?token=`, { holdMs: 5000, sends: [[300, msg], [2500, { ping: true }]] });
    log('rpc', { request: typeof msg === 'string' ? msg : JSON.stringify(msg), openMs: r.openMs, frames: r.frames, close: r.close, error: r.error });
    await sleep(700);
  }
}

async function silence() {
  const holdMs = 110_000;
  const t0 = Date.now();
  const states = [];
  const clock = [];
  const talker = open(`${URL_TIME}?token=`, {
    holdMs,
    sends: [
      ...Array.from({ length: Math.floor(holdMs / 6000) }, (_, i) => [1000 + i * 6000, { ping: true }]),
      ...Array.from({ length: Math.floor(holdMs / 20000) }, (_, i) => [4000 + i * 20000, { get: 'api/deals/btc_uah' }]),
    ],
  });
  const mute = open(`${URL_TIME}?token=`, { holdMs });
  const [a, b] = await Promise.all([talker, mute]);
  const localAt = (ms) => t0 + ms;
  for (const f of a.frames) {
    if (!f.text) continue;
    try {
      const j = JSON.parse(f.text.length < 220 ? f.text : '{}');
      const to = j.time_object;
      if (to) {
        states.push(to.state);
        clock.push(to.time - KYIV_OFFSET_S - Math.round(localAt(f.ms) / 1000));
      }
    } catch { /* trimmed frame */ }
  }
  const sent = a.frames.filter((f) => f.sent).map((f) => f.ms);
  const unsolicited = a.frames.filter((f) => !f.sent && !sent.some((s) => f.ms >= s && f.ms - s < 2000));
  log('silence_talker', {
    openMs: a.openMs, close: a.close, error: a.error, framesIn: a.frames.filter((f) => !f.sent).length, sent: sent.length,
    serverPings: a.frames.filter((f) => f.serverPing).length,
    kinds: a.frames.filter((f) => f.kind).reduce((m, f) => { m[f.kind] = (m[f.kind] || 0) + 1; return m; }, {}),
    distinctStates: [...new Set(states)].map((s) => `${s}=${new Date((s - KYIV_OFFSET_S) * 1000).toISOString()}`),
    clockOffsetS: [...new Set(clock)],
    unsolicited: unsolicited.slice(0, 5),
  });
  log('silence_talker_frames', { first: a.frames.slice(0, 6), last: a.frames.slice(-3) });
  log('silence_mute', { openMs: b.openMs, close: b.close, error: b.error, frames: b.frames });
}

const mode = process.argv[2] ?? 'handshake';
const modes = { handshake, rpc, silence };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, expected one of ${Object.keys(modes).join(', ')}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
