// CoinEx v2 WebSocket probe: frame encoding, subscribe acknowledgements, the futures and spot depth channels, server.ping, unknown symbols, and an idle socket.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coinex/ws-probe.mjs [book|idle|deflate|all]
//   book     futures depth 50 on four perps, bbo and state on BTCUSDT, an unknown market, server.ping, then spot depth 50 on BTCUSDT, 45 s in total.
//   idle     one futures socket that subscribes nothing and sends nothing, closed by the probe after 90 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   all      every futures market from the REST catalog in one depth.subscribe frame, then counts the books that hold a level, 12 s.
// Set PROBE_OUT_DIR to keep the first frames of each kind. Recorded in docs/profiles/coinex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FUTURES_URL = 'wss://socket.coinex.com/v2/futures';
const SPOT_URL = 'wss://socket.coinex.com/v2/spot';
const OUT = process.env.PROBE_OUT_DIR;
const PERPS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BTCUSDC'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Returns the decoded text and how the frame arrived: text, binary gzip, or binary plain.
function decode(data, isBinary) {
  if (!isBinary) return { text: data.toString('utf8'), enc: 'text' };
  const buf = Buffer.from(data);
  if (buf[0] === 0x1f && buf[1] === 0x8b) return { text: gunzipSync(buf).toString('utf8'), enc: 'gzip', wire: buf.length };
  return { text: buf.toString('utf8'), enc: 'binary' };
}

function open(url, options = { perMessageDeflate: false }) {
  const t0 = Date.now();
  const ws = new WebSocket(url, options);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0, ext: ws.extensions }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

async function book() {
  const { ws, openMs } = await open(FUTURES_URL);
  log('open', { url: FUTURES_URL, openMs });
  const stats = { enc: {}, methods: {}, depth: {} };
  const sentAt = {};
  let id = 0;
  const send = (method, params) => {
    const req = { method, params, id: ++id };
    sentAt[req.id] = Date.now();
    ws.send(JSON.stringify(req));
    return req.id;
  };

  ws.on('message', (data, isBinary) => {
    const { text, enc, wire } = decode(data, isBinary);
    stats.enc[enc] = (stats.enc[enc] ?? 0) + 1;
    const msg = JSON.parse(text);
    const key = msg.method ?? `reply:${msg.id}`;
    stats.methods[key] = (stats.methods[key] ?? 0) + 1;
    if (msg.method === undefined) {
      log('reply', { id: msg.id, rttMs: Date.now() - sentAt[msg.id], enc, wire, text: text.slice(0, 300) });
      capture('futures-replies.jsonl', text);
      return;
    }
    if (msg.method === 'depth.update') {
      const d = msg.data;
      const s = (stats.depth[d.market] ??= { full: 0, delta: 0, maxAsks: 0, maxBids: 0, first: null, lastUpdatedAt: null, checksums: new Set() });
      if (d.is_full) s.full++;
      else s.delta++;
      s.maxAsks = Math.max(s.maxAsks, d.depth.asks.length);
      s.maxBids = Math.max(s.maxBids, d.depth.bids.length);
      s.checksums.add(d.depth.checksum);
      s.lastUpdatedAt = d.depth.updated_at;
      if (s.first === null) {
        s.first = Date.now();
        log('depth-first', { market: d.market, enc, wire, text: text.slice(0, 400) });
      }
      capture('futures-depth.jsonl', text);
      return;
    }
    if ((stats.methods[key] ?? 0) <= 2) {
      log('push', { method: msg.method, enc, text: text.slice(0, 500) });
      capture('futures-push.jsonl', text);
    }
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));

  send('server.ping', {});
  await sleep(1000);
  send('depth.subscribe', { market_list: PERPS.map((m) => [m, 50, '0', true]) });
  send('bbo.subscribe', { market_list: ['BTCUSDT'] });
  send('state.subscribe', { market_list: ['BTCUSDT'] });
  send('index.subscribe', { market_list: ['BTCUSDT'] });
  send('depth.subscribe', { market_list: [['NOPEUSDT', 50, '0', true]] });
  send('depth.subscribe', { market_list: [['BTCUSDT', 30, '0', true]] });
  send('nope.subscribe', { market_list: ['BTCUSDT'] });
  await sleep(28_000);
  send('server.ping', {});
  await sleep(1000);
  ws.close();
  const depth = Object.fromEntries(Object.entries(stats.depth).map(([k, v]) => [k, { ...v, checksums: [...v.checksums].slice(0, 5) }]));
  log('futures-summary', { enc: stats.enc, methods: stats.methods, depth });

  const spot = await open(SPOT_URL);
  log('open', { url: SPOT_URL, openMs: spot.openMs });
  const spotStats = { enc: {}, full: 0, delta: 0, maxAsks: 0, maxBids: 0, asksAscending: 0, bidsDescending: 0, snapshots: 0 };
  spot.ws.on('message', (data, isBinary) => {
    const { text, enc } = decode(data, isBinary);
    spotStats.enc[enc] = (spotStats.enc[enc] ?? 0) + 1;
    const msg = JSON.parse(text);
    if (msg.method !== 'depth.update') {
      log('spot-reply', { text: text.slice(0, 300) });
      return;
    }
    const d = msg.data.depth;
    if (msg.data.is_full) {
      spotStats.full++;
      const a = d.asks.map((l) => Number(l[0]));
      const b = d.bids.map((l) => Number(l[0]));
      spotStats.snapshots++;
      if (a.every((p, i) => i === 0 || p > a[i - 1])) spotStats.asksAscending++;
      if (b.every((p, i) => i === 0 || p < b[i - 1])) spotStats.bidsDescending++;
      if (spotStats.full === 1) log('spot-first', { text: JSON.stringify({ ...msg, data: { ...msg.data, depth: { ...d, asks: d.asks.slice(0, 3), bids: d.bids.slice(0, 3) } } }) });
    } else {
      spotStats.delta++;
      if (spotStats.delta === 1) log('spot-delta', { text: text.slice(0, 400) });
    }
    spotStats.maxAsks = Math.max(spotStats.maxAsks, d.asks.length);
    spotStats.maxBids = Math.max(spotStats.maxBids, d.bids.length);
  });
  spot.ws.send(JSON.stringify({ method: 'depth.subscribe', params: { market_list: [['BTCUSDT', 50, '0', true]] }, id: 1 }));
  await sleep(15_000);
  spot.ws.close();
  log('spot-summary', spotStats);
}

async function idle() {
  const { ws, openMs } = await open(FUTURES_URL);
  const t0 = Date.now();
  log('open', { url: FUTURES_URL, openMs });
  let pings = 0;
  ws.on('ping', () => pings++);
  const closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString(), afterMs: Date.now() - t0 })));
  const result = await Promise.race([closed, sleep(90_000).then(() => null)]);
  if (result === null) {
    ws.close();
    log('idle', { closedByServer: false, heldMs: Date.now() - t0, serverPings: pings });
  } else {
    log('idle', { closedByServer: true, ...result, serverPings: pings });
  }
}

async function deflate() {
  const { ws, openMs, ext } = await open(FUTURES_URL, { perMessageDeflate: true });
  log('deflate', { openMs, negotiated: ext || null });
  ws.close();
}

async function all() {
  const res = await fetch('https://api.coinex.com/v2/futures/market');
  const markets = (await res.json()).data.map((r) => r.market);
  const { ws, openMs } = await open(FUTURES_URL);
  log('open', { url: FUTURES_URL, openMs, markets: markets.length });
  const books = new Map();
  let reply = null;
  ws.on('message', (data, isBinary) => {
    const msg = JSON.parse(decode(data, isBinary).text);
    if (msg.method === undefined) reply = msg;
    else if (msg.method === 'depth.update') {
      const d = msg.data.depth;
      books.set(msg.data.market, { asks: d.asks.length, bids: d.bids.length, full: msg.data.is_full });
    }
  });
  const frame = JSON.stringify({ method: 'depth.subscribe', params: { market_list: markets.map((m) => [m, 50, '0', true]) }, id: 1 });
  ws.send(frame);
  await sleep(12_000);
  ws.close();
  const withLevels = [...books].filter(([, b]) => b.asks + b.bids > 0);
  log('all', { frameBytes: frame.length, reply, booksReceived: books.size, withLevels: withLevels.length, sample: withLevels.slice(0, 5) });
}

const mode = process.argv[2] ?? 'book';
await ({ book, idle, deflate, all })[mode]();
process.exit(0);
