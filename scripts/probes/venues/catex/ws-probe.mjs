// Catex spot WebSocket probe: STOMP over WebSocket at wss://www.catex.io/stream, the order list topics, snapshot on subscribe or not, level order, pushes per second, many pairs on one socket, heart-beats, silence, errors, deflate.
// Public, unauthenticated, read-only. Only /topic destinations are subscribed, never /user. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/catex/ws-probe.mjs [book|multi|errors|silence|deflate]
//   book     buy and sell order topics on BTC/USDT, ETH/USDT, QTUM/USDT and COSA/BTC, plus quote and trading on BTC/USDT, for 45 s with a REST compare. About 50 s.
//   multi    buy and sell order topics on every listed pair on one socket for 30 s. About 35 s.
//   errors   unknown and misspelled destinations, a SUBSCRIBE with no id, a frame that is not STOMP, a valid SUBSCRIBE after all that, a SUBSCRIBE before CONNECT. About 25 s.
//   silence  five sockets for up to 75 s: no CONNECT, a quiet or a busy subscription that never sends, and a quiet subscription that sends a newline or a receipt-bearing SUBSCRIBE every 20 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/catex/websocket.md.
import { createRequire } from 'node:module';
import https from 'node:https';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://www.catex.io/stream';
const API = 'https://www.catex.io';
const PROTOCOLS = ['v10.stomp', 'v11.stomp', 'v12.stomp']; // what the web page's stompjs client offers
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function getJson(path) {
  return new Promise((resolve) => {
    https
      .get(`${API}${path}`, { headers: { accept: 'application/json' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(undefined);
          }
        });
      })
      .on('error', () => resolve(undefined));
  });
}

const stomp = (command, headers = {}, body = '') =>
  `${command}\n${Object.entries(headers)
    .map(([k, v]) => `${k}:${v}\n`)
    .join('')}\n${body}\0`;

// A WebSocket message may hold a heart-beat (a bare newline) or one or more NUL terminated STOMP frames.
function parseStomp(text) {
  const frames = [];
  for (const part of text.split('\0')) {
    if (part.replace(/[\r\n]/g, '') === '') {
      if (part.length) frames.push({ command: 'HEARTBEAT' });
      continue;
    }
    const s = part.replace(/^[\r\n]+/, '');
    const split = s.indexOf('\n\n');
    const head = split < 0 ? s : s.slice(0, split);
    const body = split < 0 ? '' : s.slice(split + 2);
    const [command, ...lines] = head.split('\n');
    const headers = {};
    for (const l of lines) {
      const i = l.indexOf(':');
      if (i > 0 && !(l.slice(0, i) in headers)) headers[l.slice(0, i)] = l.slice(i + 1);
    }
    frames.push({ command: command.trim(), headers, body });
  }
  return frames;
}

function open(name, { deflate = false, protocols = PROTOCOLS } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(URL_WS, protocols, { perMessageDeflate: deflate, headers: { 'user-agent': 'observatory-probe/1.0' } });
  const s = { name, ws, t0, openMs: null, frames: [], closed: null, onFrame: null, rawCount: 0 };
  ws.on('upgrade', (res) => (s.upgradeHeaders = res.headers));
  ws.on('open', () => (s.openMs = Math.round(performance.now() - t0)));
  ws.on('message', (data, isBinary) => {
    s.rawCount++;
    const text = isBinary ? `<binary ${data.length} bytes>` : data.toString('utf8');
    const at = performance.now();
    for (const f of parseStomp(text)) {
      f.at = at;
      f.bytes = data.length;
      s.frames.push(f.command === 'MESSAGE' ? { command: f.command, at, dest: f.headers.destination } : f);
      s.onFrame?.(f);
    }
  });
  ws.on('close', (code, reason) => (s.closed = { code, reason: reason.toString(), afterS: +((performance.now() - t0) / 1000).toFixed(2) }));
  ws.on('error', (e) => (s.error = e.message));
  return new Promise((resolve) => {
    ws.once('open', () => resolve(s));
    ws.once('error', () => resolve(s));
    ws.once('unexpected-response', (req, res) => {
      s.refused = { status: res.statusCode, headers: res.headers };
      resolve(s);
    });
  });
}

function connect(s, heartBeat = '4000,4000') {
  return new Promise((resolve) => {
    const prev = s.onFrame;
    s.onFrame = (f) => {
      if (f.command === 'CONNECTED' || f.command === 'ERROR') {
        s.onFrame = prev;
        resolve(f);
      }
      prev?.(f);
    };
    s.ws.send(stomp('CONNECT', { 'accept-version': '1.2,1.1,1.0', 'heart-beat': heartBeat }));
    setTimeout(() => resolve({ command: 'TIMEOUT' }), 5000);
  });
}

function levelsOf(body) {
  try {
    const arr = JSON.parse(body);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function orderStats(arr, side) {
  const p = arr.map((x) => x.price);
  let best = true;
  for (let i = 1; i < p.length; i++) if (side === 'buy' ? p[i] > p[i - 1] : p[i] < p[i - 1]) best = false;
  return { n: p.length, bestFirst: best, dupes: p.length - new Set(p).size };
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null;
};

async function book() {
  const pairs = ['BTC/USDT', 'ETH/USDT', 'QTUM/USDT', 'COSA/BTC'];
  const s = await open('book');
  log('open', { ms: s.openMs, protocol: s.ws.protocol, extensions: s.upgradeHeaders?.['sec-websocket-extensions'] ?? null, cfRay: s.upgradeHeaders?.['cf-ray'], refused: s.refused });
  if (!s.openMs) return;
  const perDest = new Map();
  let heartbeatsIn = 0;
  let lastIn = performance.now();
  const msgIds = [];
  const tops = new Map();
  const crossedTops = [];
  let checks = 0;
  s.onFrame = (f) => {
    lastIn = performance.now();
    if (f.command === 'HEARTBEAT') return heartbeatsIn++;
    if (f.command !== 'MESSAGE') return log('frame', { command: f.command, headers: f.headers, body: f.body?.slice(0, 200) });
    const d = f.headers.destination;
    const mid = f.headers['message-id'] ?? '';
    const cut = mid.lastIndexOf('-');
    msgIds.push({ prefix: mid.slice(0, cut), n: Number(mid.slice(cut + 1)) });
    let e = perDest.get(d);
    if (!e) perDest.set(d, (e = { n: 0, first: null, times: [], sizes: [], repeats: 0, last: null, orderBad: 0, dupes: 0, bytes: 0, headers: f.headers, empty: 0, kinds: new Set() }));
    e.n++;
    e.bytes += f.bytes;
    if (e.first === null) {
      e.first = Math.round(f.at - subAt);
      capture('first-frames.txt', `${d} ${JSON.stringify(f.headers)} ${f.body.slice(0, 1500)}`);
    }
    e.times.push(f.at);
    if (f.body === e.last) e.repeats++;
    e.last = f.body;
    const arr = levelsOf(f.body);
    if (arr) {
      e.sizes.push(arr.length);
      if (arr.length === 0) e.empty++;
      const side = d.includes('/buy/') ? 'buy' : 'sell';
      const st = orderStats(arr, side);
      if (!st.bestFirst) e.orderBad++;
      e.dupes += st.dupes;
      for (const x of arr) e.kinds.add(`${typeof x.price}/${typeof x.amount}`);
      e.lastArr = arr;
      // Pair the newest list of each side, as a feed would, and count crossed or locked tops.
      const pair = d.split('/').slice(4).join('/');
      const t = tops.get(pair) ?? {};
      if (arr.length) t[side] = arr[0].price;
      tops.set(pair, t);
      if (t.buy !== undefined && t.sell !== undefined) {
        checks++;
        if (t.buy >= t.sell) crossedTops.push(`${pair} ${t.buy}/${t.sell}`);
      }
    }
  };
  const connected = await connect(s);
  log('connected', { command: connected.command, headers: connected.headers });
  // The server heart-beat interval the CONNECTED frame grants; answer at the client rate we asked for.
  const hb = setInterval(() => s.ws.readyState === 1 && s.ws.send('\n'), 4000);
  const subAt = performance.now();
  let id = 0;
  for (const p of pairs) {
    s.ws.send(stomp('SUBSCRIBE', { id: `sub-${id++}`, destination: `/topic/order/buy/${p}` }));
    s.ws.send(stomp('SUBSCRIBE', { id: `sub-${id++}`, destination: `/topic/order/sell/${p}` }));
  }
  s.ws.send(stomp('SUBSCRIBE', { id: `sub-${id++}`, destination: '/topic/quote/BTC/USDT' }));
  s.ws.send(stomp('SUBSCRIBE', { id: `sub-${id++}`, destination: '/topic/trading/BTC/USDT' }));
  // REST compare at 20 s: read the REST book and the last pushed list for BTC/USDT back to back.
  await sleep(20_000);
  const rest = await getJson('/api/order?market=BTC/USDT&limit=100');
  const buy = perDest.get('/topic/order/buy/BTC/USDT')?.lastArr ?? [];
  const sell = perDest.get('/topic/order/sell/BTC/USDT')?.lastArr ?? [];
  const cmp = (ws, rs) => {
    let eq = 0;
    for (let i = 0; i < Math.min(ws.length, rs.length); i++) if (ws[i].price === Number(rs[i][0]) && ws[i].amount === Number(rs[i][1])) eq++;
    return { wsLevels: ws.length, restLevels: rs.length, samePositionsEqual: eq, wsTop: ws[0] ? [ws[0].price, ws[0].amount] : null, restTop: rs[0] };
  };
  log('restCompare', { buy: cmp(buy, rest?.data?.bids ?? []), sell: cmp(sell, rest?.data?.asks ?? []) });
  capture('btc-buy-list.txt', JSON.stringify(buy));
  let maxGap = 0;
  const gapWatch = setInterval(() => (maxGap = Math.max(maxGap, performance.now() - lastIn)), 100);
  await sleep(25_000);
  clearInterval(gapWatch);
  clearInterval(hb);
  const durS = (performance.now() - subAt) / 1000;
  for (const [d, e] of perDest) {
    const gaps = e.times.slice(1).map((t, i) => t - e.times[i]);
    log('dest', {
      d,
      frames: e.n,
      perS: +(e.n / durS).toFixed(2),
      firstAfterSubMs: e.first,
      gapMs: { min: pct(gaps, 0), median: pct(gaps, 0.5), p90: pct(gaps, 0.9), max: pct(gaps, 1) },
      gapsUnder200ms: gaps.filter((g) => g < 200).length,
      identicalRepeats: e.repeats,
      levels: e.sizes.length ? { min: Math.min(...e.sizes), max: Math.max(...e.sizes), median: pct(e.sizes, 0.5) } : null,
      notBestFirst: e.orderBad,
      dupPrices: e.dupes,
      empty: e.empty,
      numberTypes: [...e.kinds],
      avgBytes: Math.round(e.bytes / e.n),
      headers: e.headers,
    });
  }
  for (const p of pairs) for (const side of ['buy', 'sell']) if (!perDest.has(`/topic/order/${side}/${p}`)) log('dest', { d: `/topic/order/${side}/${p}`, frames: 0 });
  const steps = msgIds.slice(1).map((m, i) => m.n - msgIds[i].n);
  const stepCounts = {};
  for (const st of steps) stepCounts[st === 1 ? '1' : st > 1 ? '>1' : '<=0'] = (stepCounts[st === 1 ? '1' : st > 1 ? '>1' : '<=0'] ?? 0) + 1;
  log('messageIds', { prefixes: [...new Set(msgIds.map((m) => m.prefix))].length, firstN: msgIds[0]?.n, lastN: msgIds.at(-1)?.n, stepCounts, maxStep: Math.max(...steps) });
  log('pairedTops', { checks, crossedOrLocked: crossedTops.length, samples: crossedTops.slice(0, 5) });
  log('bookSummary', { durS: +durS.toFixed(1), heartbeatsIn, maxInboundSilenceMs: Math.round(maxGap), closed: s.closed, rawMessages: s.rawCount });
  s.ws.send(stomp('DISCONNECT', { receipt: 'bye' }));
  await sleep(500);
  s.ws.close();
}

async function multi() {
  const summary = await getJson('/api/cmc/summary');
  const pairs = (summary ?? []).map((x) => x.trading_pairs.replace('_', '/'));
  const s = await open('multi');
  if (!s.openMs) return log('multiOpenFailed', { refused: s.refused, error: s.error });
  const perDest = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = new Map();
  let errors = 0;
  const levelCounts = {};
  const emptyDests = new Set();
  s.onFrame = (f) => {
    if (f.command === 'ERROR') {
      errors++;
      return log('frame', { command: f.command, headers: f.headers, body: f.body?.slice(0, 200) });
    }
    if (f.command !== 'MESSAGE') return;
    frames++;
    bytes += f.bytes;
    const t = process.hrtime.bigint();
    const parsed = JSON.parse(f.body);
    parseNs += process.hrtime.bigint() - t;
    perDest.set(f.headers.destination, (perDest.get(f.headers.destination) ?? 0) + 1);
    if (Array.isArray(parsed)) {
      levelCounts[parsed.length] = (levelCounts[parsed.length] ?? 0) + 1;
      if (parsed.length === 0) emptyDests.add(f.headers.destination);
    }
    const sec = Math.floor((f.at - s.t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
  };
  const c = await connect(s);
  log('connected', { command: c.command });
  const hb = setInterval(() => s.ws.readyState === 1 && s.ws.send('\n'), 4000);
  const t0 = performance.now();
  let id = 0;
  for (const p of pairs) {
    s.ws.send(stomp('SUBSCRIBE', { id: `sub-${id++}`, destination: `/topic/order/buy/${p}` }));
    s.ws.send(stomp('SUBSCRIBE', { id: `sub-${id++}`, destination: `/topic/order/sell/${p}` }));
  }
  await sleep(30_000);
  clearInterval(hb);
  const dur = (performance.now() - t0) / 1000;
  const counts = [...perSecond.values()];
  const deliveringPairs = new Set([...perDest.keys()].map((d) => d.split('/').slice(4).join('/')));
  const quietPairs = pairs.filter((p) => !deliveringPairs.has(p));
  log('multi', {
    pairs: pairs.length,
    subscriptions: id,
    destinationsDelivering: perDest.size,
    pairsDelivering: deliveringPairs.size,
    quietPairs: quietPairs.length,
    frames,
    framesPerS: +(frames / dur).toFixed(1),
    perSecond: { median: pct(counts, 0.5), max: pct(counts, 1) },
    bytesPerS: Math.round(bytes / dur),
    avgBytes: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: frames ? +(Number(parseNs / BigInt(frames)) / 1000).toFixed(1) : null,
    errors,
    levelsPerFrame: levelCounts,
    emptyFrameDests: [...emptyDests].slice(0, 6),
    closed: s.closed,
    top: [...perDest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
  });
  s.ws.close();
}

async function errors() {
  const s = await open('errors');
  if (!s.openMs) return log('errorsOpenFailed', { refused: s.refused });
  const seen = [];
  s.onFrame = (f) => {
    if (f.command === 'HEARTBEAT') return;
    seen.push(f.command === 'MESSAGE' ? { command: f.command, dest: f.headers.destination } : { command: f.command, headers: f.headers, body: f.body?.slice(0, 300) });
  };
  await connect(s);
  const cases = [
    ['/topic/order/buy/NOPE/USDT', 'unknown pair'],
    ['/topic/order/buy/BTC_USDT', 'underscore spelling'],
    ['/topic/order/buy/btc/usdt', 'lowercase'],
    ['/topic/nope/BTC/USDT', 'unknown topic'],
    ['/topic/order/BTC/USDT', 'no side'],
  ];
  let id = 0;
  for (const [d] of cases) s.ws.send(stomp('SUBSCRIBE', { id: `e-${id++}`, destination: d }));
  await sleep(6000);
  log('errorSubs', { cases: cases.map((c) => c[1]), framesSeen: seen.length, seen: seen.slice(0, 10), closed: s.closed });
  seen.length = 0;
  s.ws.send(stomp('SUBSCRIBE', { destination: '/topic/order/buy/BTC/USDT' }));
  await sleep(2000);
  log('subscribeNoId', { seen: seen.slice(0, 3), closed: s.closed });
  seen.length = 0;
  if (!s.closed) {
    s.ws.send('hello, not stomp');
    await sleep(2000);
    log('notStomp', { seen: seen.slice(0, 3), closed: s.closed });
  }
  seen.length = 0;
  if (!s.closed) {
    s.ws.send(stomp('SUBSCRIBE', { id: 'ok-1', destination: '/topic/order/buy/BTC/USDT' }));
    await sleep(5000);
    log('validAfterErrors', { messages: seen.filter((f) => f.command === 'MESSAGE').length, other: seen.filter((f) => f.command !== 'MESSAGE').slice(0, 2), closed: s.closed });
  }
  s.ws.close();
  const t = await open('subBeforeConnect');
  const seen2 = [];
  t.onFrame = (f) => seen2.push({ command: f.command, headers: f.headers, body: f.body?.slice(0, 300) });
  t.ws.send(stomp('SUBSCRIBE', { id: 'x', destination: '/topic/order/buy/BTC/USDT' }));
  await sleep(3000);
  log('subscribeBeforeConnect', { seen: seen2.slice(0, 3), closed: t.closed });
  if (!t.closed) {
    const c = await connect(t);
    await sleep(4000);
    log('connectAfterEarlySubscribe', { connect: c.command, messagesOnEarlySub: seen2.filter((f) => f.command === 'MESSAGE').length, closed: t.closed });
  }
  t.ws.close();
}

async function silence() {
  // Five sockets at once, differing only in what the client subscribes and sends after the handshake.
  const cases = [
    { name: 'no-connect-frame', connect: false },
    { name: 'quiet-sub-never-sends', connect: true, sub: '/topic/order/buy/COSA/BTC' },
    { name: 'busy-sub-never-sends', connect: true, sub: '/topic/order/buy/BTC/USDT' },
    { name: 'quiet-sub-newline-every-20s', connect: true, sub: '/topic/order/buy/COSA/BTC', every: () => '\n' },
    { name: 'quiet-sub-receipt-frame-every-20s', connect: true, sub: '/topic/order/buy/COSA/BTC', every: (i) => stomp('SUBSCRIBE', { id: `ka-${i}`, destination: '/topic/keepalive-probe', receipt: `r-${i}` }) },
  ];
  const socks = [];
  for (const c of cases) {
    const s = await open(c.name);
    s.hbIn = 0;
    s.receipts = 0;
    s.lastInAt = null;
    s.onFrame = (f) => {
      s.lastInAt = f.at;
      if (f.command === 'HEARTBEAT') s.hbIn++;
      if (f.command === 'RECEIPT') s.receipts++;
    };
    if (c.connect) {
      const r = await connect(s, '4000,4000');
      s.connected = r.headers?.['heart-beat'] ?? r.command;
      s.ws.send(stomp('SUBSCRIBE', { id: 'q', destination: c.sub }));
    }
    if (c.every) {
      let i = 0;
      s.timer = setInterval(() => s.ws.readyState === 1 && s.ws.send(c.every(i++)), 20_000);
    }
    socks.push(s);
  }
  const t0 = performance.now();
  while (performance.now() - t0 < 75_000 && socks.some((s) => !s.closed)) await sleep(250);
  for (const s of socks) {
    clearInterval(s.timer);
    log('silence', {
      name: s.name,
      openMs: s.openMs,
      connectedHeartBeat: s.connected ?? null,
      serverHeartbeats: s.hbIn,
      receipts: s.receipts,
      messages: s.frames.filter((f) => f.command === 'MESSAGE').length,
      lastInboundAtS: s.lastInAt ? +((s.lastInAt - s.t0) / 1000).toFixed(2) : null,
      other: s.frames.filter((f) => !['MESSAGE', 'HEARTBEAT', 'CONNECTED', 'RECEIPT'].includes(f.command)).slice(0, 2),
      closed: s.closed ?? 'open at 75 s',
    });
    if (!s.closed) s.ws.close();
  }
}

async function deflate() {
  const s = await open('deflate', { deflate: true });
  log('deflate', { status: s.refused?.status ?? 101, extensions: s.upgradeHeaders?.['sec-websocket-extensions'] ?? null, protocol: s.ws.protocol, server: s.upgradeHeaders?.server });
  s.ws.close();
  const n = await open('noProtocol', { protocols: [] });
  const c = n.openMs ? await connect(n) : null;
  log('noSubprotocol', { openMs: n.openMs, refused: n.refused?.status ?? null, protocol: n.ws.protocol, connect: c?.command ?? null, version: c?.headers?.version ?? null });
  n.ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, multi, errors, silence, deflate };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('done', { at: new Date().toISOString() });
setTimeout(() => process.exit(0), 300);
