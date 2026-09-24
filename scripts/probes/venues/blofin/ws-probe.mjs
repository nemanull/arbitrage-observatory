// BloFin public WebSocket probe: whether the handshake is accepted from this host, and the books channel when it is.
// Public, unauthenticated and read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate offer in access.
// Handshakes are paced at one every 1.5 s, under the documented one new connection per second per IP.
// Run from server/: node ../scripts/probes/venues/blofin/ws-probe.mjs [access|book]
//   access  opens the live and the demo public socket, then the live socket once more offering permessage-deflate, and prints each upgrade answer, about 5 s
//   book    subscribes books on three perps for 30 s, checks prevSeqId against the last seqId, level order and the string ping, about 35 s
// A refused upgrade prints its status, the Cloudflare colo and server-timing, and whether the body is the restricted region page, and book then stops.
// Set PROBE_OUT_DIR to keep raw frames.
// Recorded in docs/profiles/blofin/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const LIVE = 'wss://openapi.blofin.com/ws/public';
const DEMO = 'wss://demo-trading-openapi.blofin.com/ws/public';
const BOOK_IDS = ['BTC-USDT', 'ETH-USDT', 'ZRX-USDT'];
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function capture(text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, 'ws-frames.jsonl'), text.slice(0, 2000) + '\n');
}

// Resolves with the open socket, or with the refused upgrade described.
function open(url, perMessageDeflate) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate });
    const done = (r) => resolve({ ...r, ms: Math.round(performance.now() - t0) });
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        req.destroy();
        done({
          ws: null,
          status: res.statusCode,
          type: res.headers['content-type'],
          colo: (res.headers['cf-ray'] ?? '').split('-')[1] ?? null,
          serverTiming: res.headers['server-timing'] ?? null,
          bytes: body.length,
          restricted: /restricted\s+countries\s+or\s+regions/.test(body),
        });
      });
    });
    ws.on('upgrade', (res) => (ws.extensionsHeader = res.headers['sec-websocket-extensions'] ?? null));
    ws.on('open', () => done({ ws, status: 101, extensions: ws.extensionsHeader }));
    ws.on('error', (e) => done({ ws: null, error: e.message }));
  });
}

async function access() {
  for (const [url, deflate] of [[LIVE, false], [DEMO, false], [LIVE, true]]) {
    const r = await open(url, deflate);
    log('handshake', { url, offeredDeflate: deflate, ...r, ws: undefined });
    r.ws?.close();
    await sleep(1500);
  }
}

async function book() {
  const r = await open(LIVE, false);
  log('handshake', { url: LIVE, ...r, ws: undefined });
  if (!r.ws) return;
  const ws = r.ws;
  const stats = Object.fromEntries(BOOK_IDS.map((id) => [id, { snapshots: 0, deltas: 0, gaps: 0, lastSeq: null, bidsUnordered: 0, asksUnordered: 0, maxGapMs: 0, lastAt: 0 }]));
  let pongs = 0;
  let firstPingAt = 0;
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    capture(text);
    if (text === 'pong') {
      pongs++;
      log('pong', { ms: Math.round(performance.now() - firstPingAt) });
      return;
    }
    const f = JSON.parse(text);
    if (f.event) {
      log('event', { frame: text.slice(0, 300) });
      return;
    }
    const s = stats[f.arg?.instId];
    if (!s || f.arg.channel !== 'books') return;
    const now = performance.now();
    if (s.lastAt) s.maxGapMs = Math.max(s.maxGapMs, Math.round(now - s.lastAt));
    s.lastAt = now;
    const d = f.data;
    if (f.action === 'snapshot') {
      s.snapshots++;
      if (s.snapshots === 1) log('snapshot', { instId: f.arg.instId, bids: d.bids.length, asks: d.asks.length, prevSeqId: d.prevSeqId, seqId: d.seqId, priceType: typeof d.bids[0]?.[0], top: [d.bids[0], d.asks[0]] });
    } else {
      s.deltas++;
      if (s.lastSeq !== null && String(d.prevSeqId) !== String(s.lastSeq)) s.gaps++;
    }
    for (let i = 1; i < d.bids.length; i++) if (Number(d.bids[i][0]) > Number(d.bids[i - 1][0])) { s.bidsUnordered++; break; }
    for (let i = 1; i < d.asks.length; i++) if (Number(d.asks[i][0]) < Number(d.asks[i - 1][0])) { s.asksUnordered++; break; }
    s.lastSeq = d.seqId;
  });
  ws.send(JSON.stringify({ op: 'subscribe', args: BOOK_IDS.map((instId) => ({ channel: 'books', instId })) }));
  await sleep(15_000);
  firstPingAt = performance.now();
  ws.send('ping');
  await sleep(15_000);
  for (const [id, s] of Object.entries(stats)) log('book_summary', { instId: id, ...s, lastAt: undefined });
  log('keepalive', { pongs });
  ws.close();
}

const mode = process.argv[2] ?? 'access';
if (mode === 'access') await access();
else if (mode === 'book') await book();
else console.error('mode is access or book');

// A refused upgrade leaves a handle open for about a minute, even after req.destroy(), so the probe exits explicitly.
process.exit(0);
