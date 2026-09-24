// Paymium public socket probe: the socket.io 1.x stream on BTC/EUR, its handshake, event shapes, level updates against the REST depth, keepalive, silence and error replies.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check in `variants`.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/paymium/ws-probe.mjs [book|variants|silence]
//   book      joins /public on wss://paymium.com/ws/socket.io for 75 s, keeps a book from one REST depth plus the stream, compares it with a second REST depth. About 80 s.
//   variants  EIO=4, no namespace join, an unknown namespace, text that is not a packet, a made-up event, a deflate offer, the web app host. About 40 s.
//   silence   three sockets for 70 s: joined without pings, bare without pings, bare with an Engine.IO ping every 10 s. The first run held the first two for 110 s.
// Set PROBE_OUT_DIR to keep raw packets. Recorded in docs/profiles/paymium/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://paymium.com/ws/socket.io/?EIO=3&transport=websocket';
const DEPTH_URL = 'https://paymium.com/api/v1/data/eur/depth';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();
const rel = () => Date.now() - t0;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Engine.IO 3 packet: first char is the type, socket.io 1.x message packets are `4` plus a socket.io type and an optional `/nsp,` prefix.
function parsePacket(text) {
  const eio = text[0];
  if (eio !== '4') return { eio, body: text.slice(1) };
  const sio = text[1];
  let rest = text.slice(2);
  let nsp = '/';
  if (rest.startsWith('/')) {
    const comma = rest.indexOf(',');
    nsp = comma === -1 ? rest : rest.slice(0, comma);
    rest = comma === -1 ? '' : rest.slice(comma + 1);
  }
  let data;
  try {
    data = rest ? JSON.parse(rest) : undefined;
  } catch {
    data = rest;
  }
  return { eio, sio, nsp, data };
}

function open(url, opts = {}) {
  const started = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  ws.openedIn = new Promise((resolve) => {
    ws.on('upgrade', (res) => (ws.upgradeHeaders = res.headers));
    ws.on('open', () => resolve(Date.now() - started));
    ws.on('error', (e) => resolve(`error ${e.message}`));
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(`http ${res.statusCode} ${body.slice(0, 200)}`));
    });
  });
  return ws;
}

async function restDepth() {
  const started = Date.now();
  const res = await fetch(DEPTH_URL);
  const body = await res.json();
  return { ms: Date.now() - started, at: Date.now(), body };
}

const num = (s) => Number(s);

function bookFromRest(body) {
  const bids = new Map(body.bids.map((l) => [num(l.price), num(l.amount)]));
  const asks = new Map(body.asks.map((l) => [num(l.price), num(l.amount)]));
  return { bids, asks };
}

function top(map, n, desc) {
  return [...map.entries()].filter(([, a]) => a > 0).sort((x, y) => (desc ? y[0] - x[0] : x[0] - y[0])).slice(0, n);
}

async function book() {
  const ws = open(WS_URL);
  const packets = [];
  const counts = {};
  const keyCombos = {};
  const levelFields = {};
  const levelTypes = {};
  const perFrameLevels = [];
  const pricesFrames = [];
  let pricesSample;
  const streamTimes = [];
  let pingSentAt = 0;
  const pongRtts = [];
  let serverPings = 0;
  let openInfo;
  let nsAck;
  let seed;
  const applied = [];
  const beforeSeed = [];

  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    const now = rel();
    capture('book.txt', `${now} ${text}`);
    const p = parsePacket(text);
    counts[`eio${p.eio}${p.sio ?? ''}`] = (counts[`eio${p.eio}${p.sio ?? ''}`] ?? 0) + 1;
    if (p.eio === '0') openInfo = { at: now, body: p.body };
    else if (p.eio === '3') pongRtts.push(Date.now() - pingSentAt);
    else if (p.eio === '2') serverPings++;
    else if (p.eio === '4' && p.sio === '0') nsAck = { at: now, text };
    else if (p.eio === '4' && p.sio === '2') {
      const [event, payload] = p.data;
      counts[`event:${event}@${p.nsp}`] = (counts[`event:${event}@${p.nsp}`] ?? 0) + 1;
      if (event !== 'stream' || typeof payload !== 'object') return;
      streamTimes.push(now);
      const combo = Object.keys(payload).sort().join('+');
      keyCombos[combo] = (keyCombos[combo] ?? 0) + 1;
      if (payload.prices) {
        pricesFrames.push({ at: now, bytes: text.length, pairs: Object.keys(payload.prices).length });
        if (!pricesSample) pricesSample = { keys: Object.keys(payload.prices), btceur: payload.prices.btceur };
      }
      if (packets.length < 12 && !payload.prices) packets.push(text.slice(0, 700));
      for (const side of ['bids', 'asks']) {
        if (!Array.isArray(payload[side])) continue;
        perFrameLevels.push(payload[side].length);
        for (const l of payload[side]) {
          const f = Object.keys(l).sort().join(',');
          levelFields[f] = (levelFields[f] ?? 0) + 1;
          const ty = `price:${typeof l.price} amount:${typeof l.amount} ts:${typeof l.timestamp}`;
          levelTypes[ty] = (levelTypes[ty] ?? 0) + 1;
          const u = { side, price: num(l.price), amount: num(l.amount), ts: l.timestamp, recv: Date.now() };
          (seed ? applied : beforeSeed).push(u);
        }
      }
    }
  });
  ws.on('close', (code, reason) => log('close', { at: rel(), code, reason: reason.toString() }));

  log('open', { url: WS_URL, openedInMs: await ws.openedIn, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null });
  await sleep(300);
  log('handshake', { openInfo, countsSoFar: { ...counts } });
  const joinSentAt = rel();
  ws.send('40/public');
  await sleep(1500);
  log('namespace', { joinSentAt, ack: nsAck });

  // Seed after the join so that every update the stream sends from here on lands after the seed.
  seed = await restDepth();
  const bk = bookFromRest(seed.body);
  log('seed', { restMs: seed.ms, version: seed.body.version, bids: seed.body.bids.length, asks: seed.body.asks.length });

  const pingEvery = openInfo ? JSON.parse(openInfo.body).pingInterval : 10000;
  const pinger = setInterval(() => {
    pingSentAt = Date.now();
    ws.send('2');
  }, pingEvery);

  await sleep(73_000);
  clearInterval(pinger);

  const nBeforeEnd = applied.length;
  const end = await restDepth();
  const nDuringEnd = applied.length - nBeforeEnd;
  for (const u of applied.slice(0, nBeforeEnd)) {
    const m = u.side === 'bids' ? bk.bids : bk.asks;
    if (u.amount === 0) m.delete(u.price);
    else m.set(u.price, u.amount);
  }
  const rb = bookFromRest(end.body);
  const cmp = (mine, theirs, desc) => {
    const a = top(mine, 20, desc);
    const b = top(theirs, 20, desc);
    let equal = 0;
    for (let i = 0; i < 20; i++) if (a[i] && b[i] && a[i][0] === b[i][0] && a[i][1] === b[i][1]) equal++;
    return { equal, mineTop: a.slice(0, 3), restTop: b.slice(0, 3) };
  };
  const gaps = [];
  for (let i = 1; i < streamTimes.length; i++) gaps.push(streamTimes[i] - streamTimes[i - 1]);
  gaps.sort((x, y) => x - y);
  const zeroAmounts = applied.filter((u) => u.amount === 0).length;
  const tsSamples = applied.slice(0, 3).map((u) => ({ ts: u.ts, recvS: Math.floor(u.recv / 1000) }));
  const tsLagS = applied.filter((u) => typeof u.ts === 'number' && u.ts > 0).map((u) => u.recv / 1000 - u.ts).sort((x, y) => x - y);
  log('summary', {
    counts,
    keyCombos,
    levelFields,
    levelTypes,
    updatesBeforeSeed: beforeSeed.length,
    updatesAfterSeed: nBeforeEnd,
    updatesDuringEndFetch: nDuringEnd,
    zeroAmounts,
    levelsPerSideFrame: { max: Math.max(0, ...perFrameLevels), frames: perFrameLevels.length },
    streamFrames: streamTimes.length,
    gapMs: gaps.length ? { median: gaps[Math.floor(gaps.length / 2)], max: gaps[gaps.length - 1] } : null,
    tsSamples,
    tsLagS: tsLagS.length ? { min: tsLagS[0].toFixed(1), median: tsLagS[Math.floor(tsLagS.length / 2)].toFixed(1), max: tsLagS[tsLagS.length - 1].toFixed(1) } : null,
    pongRttMs: pongRtts,
    serverPings,
    endRest: { ms: end.ms, version: end.body.version, versionDelta: end.body.version - seed.body.version },
    bids: cmp(bk.bids, rb.bids, true),
    asks: cmp(bk.asks, rb.asks, false),
  });
  const pGaps = pricesFrames.slice(1).map((f, i) => f.at - pricesFrames[i].at);
  log('prices', { frames: pricesFrames.length, bytes: pricesFrames.map((f) => f.bytes), gapsMs: pGaps, pairs: pricesSample?.keys.length, keys: pricesSample?.keys.join(','), btceur: pricesSample?.btceur });
  for (const p of packets.slice(0, 6)) log('sample', { text: p });
  ws.close();
  await sleep(300);
}

async function variant(name, url, steps, holdMs = 5000, opts = {}) {
  const ws = open(url, opts);
  const got = [];
  let closed = null;
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    capture(`variant-${name}.txt`, `${rel()} ${text}`);
    if (got.length < 6) got.push(text.slice(0, 220));
    else got.push('.');
  });
  ws.on('close', (code, reason) => (closed = { code, reason: reason.toString() }));
  const openedIn = await ws.openedIn;
  if (typeof openedIn === 'number') {
    for (const s of steps) {
      await sleep(400);
      if (ws.readyState === ws.OPEN) ws.send(s);
    }
    await sleep(holdMs);
  }
  const dots = got.filter((g) => g === '.').length;
  log('variant', { name, url, sent: steps, openedIn, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, first: got.filter((g) => g !== '.'), more: dots, closed });
  if (ws.readyState === ws.OPEN) ws.close();
  await sleep(200);
}

async function variants() {
  await variant('eio4', 'wss://paymium.com/ws/socket.io/?EIO=4&transport=websocket', ['40/public'], 4000);
  await variant('no-join', WS_URL, [], 6000);
  await variant('unknown-nsp', WS_URL, ['40/nope'], 4000);
  await variant('not-a-packet', WS_URL, ['40/public', 'hello', '{"op":"subscribe"}'], 4000);
  await variant('made-up-event', WS_URL, ['40/public', '42/public,["subscribe","BTC-EUR"]'], 4000);
  await variant('deflate-offer', WS_URL, ['40/public'], 2000, { perMessageDeflate: true });
  await variant('no-eio', 'wss://paymium.com/ws/socket.io/?transport=websocket', ['40/public'], 2000);
  await variant('web-app-host', 'wss://account.paymium.com/socket.io/?EIO=4&transport=websocket', ['40/public'], 2000);
}

async function silence() {
  const make = (name, join, pingMs = 0) => {
    const ws = open(WS_URL);
    const s = { name, frames: 0, lastFrameAt: null, closed: null };
    ws.on('message', (raw) => {
      s.frames++;
      s.lastFrameAt = rel();
      capture(`silence-${name}.txt`, `${rel()} ${raw.toString('utf8').slice(0, 300)}`);
    });
    ws.on('close', (code, reason) => (s.closed = { at: rel(), code, reason: reason.toString() }));
    ws.openedIn.then((ms) => {
      s.openedIn = ms;
      if (join && ws.readyState === ws.OPEN) ws.send('40/public');
      if (pingMs) {
        const t = setInterval(() => (ws.readyState === ws.OPEN ? ws.send('2') : clearInterval(t)), pingMs);
        ws.on('close', () => clearInterval(t));
      }
    });
    return { ws, s };
  };
  const a = make('joined-no-ping', true);
  const b = make('bare-no-ping', false);
  const c = make('bare-ping-10s', false, 10_000);
  for (let i = 0; i < 7; i++) {
    await sleep(10_000);
    log('tick', { at: rel(), joined: { frames: a.s.frames, closed: a.s.closed }, bare: { frames: b.s.frames, closed: b.s.closed }, barePing: { frames: c.s.frames, closed: c.s.closed } });
    if (a.s.closed && b.s.closed && c.s.closed) break;
  }
  log('silence', { joined: a.s, bare: b.s, barePing: c.s });
  for (const x of [a, b, c]) if (x.ws.readyState === x.ws.OPEN) x.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, iso: new Date().toISOString() });
if (mode === 'book') await book();
else if (mode === 'variants') await variants();
else if (mode === 'silence') await silence();
else console.error('mode must be book, variants or silence');
process.exit(0);
