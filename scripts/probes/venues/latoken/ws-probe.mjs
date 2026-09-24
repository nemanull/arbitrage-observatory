// LATOKEN spot WebSocket probe: STOMP handshake and heart-beats, the /v1/book snapshot and nonce chain, level order and window, REST comparison, a batch of pairs on one socket, silence, errors, other public channels and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/latoken/ws-probe.mjs [book|batch|silence|errors|channels|frames|deflate]
//   book      /v1/book on five pairs for 60 s with client heart-beats, then a REST book compare. About 70 s.
//   batch     /v1/book on the 100 most traded two-sided pairs on one socket for 45 s. About 50 s.
//   silence   four sockets that differ only in the STOMP CONNECT, heart-beats and subscription they send, for up to 75 s. About 75 s.
//   errors    unknown, tag-form and malformed destinations, a frame before CONNECT, a duplicate subscription id, and an unsubscribe then resubscribe. About 25 s.
//   channels  /v1/ticker, /v1/rate, /v1/trade, /v1/pair and /v1/currency for 15 s each at most. About 20 s.
//   frames    the CONNECTED frame, a trimmed ETH/USDT snapshot and three deltas, for the profile. About 5 s.
//   deflate   asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/latoken/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api.latoken.com/stomp';
const API = 'https://api.latoken.com';
const OUT = process.env.PROBE_OUT_DIR;
const USDT = '0c3a106d-bde3-4c13-a26e-3fd2394529e5';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function stomp(cmd, headers = {}, body = '') {
  const lines = Object.entries(headers).map(([k, v]) => `${k}:${v}`);
  return `${cmd}\n${lines.join('\n')}\n\n${body}\0`;
}

// One WebSocket message may hold heart-beat EOLs and one or more NUL-terminated STOMP frames.
function parseStomp(text) {
  const frames = [];
  let rest = text;
  let heartbeats = 0;
  while (rest.length > 0) {
    const eol = rest.match(/^\r?\n/);
    if (eol) {
      heartbeats++;
      rest = rest.slice(eol[0].length);
      continue;
    }
    const nul = rest.indexOf('\0');
    const raw = nul === -1 ? rest : rest.slice(0, nul);
    rest = nul === -1 ? '' : rest.slice(nul + 1);
    const split = raw.indexOf('\n\n');
    const head = split === -1 ? raw : raw.slice(0, split);
    const body = split === -1 ? '' : raw.slice(split + 2);
    const [cmd, ...hl] = head.split('\n');
    const headers = {};
    for (const h of hl) {
      const i = h.indexOf(':');
      if (i > 0 && !(h.slice(0, i) in headers)) headers[h.slice(0, i)] = h.slice(i + 1);
    }
    frames.push({ cmd, headers, body });
  }
  return { frames, heartbeats };
}

function open(label, { connect = true, heartBeat = '10000,10000', deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  const state = { ws, t0, label, connected: null, heartbeats: [], closed: null, frames: 0 };
  ws.on('upgrade', (res) => {
    state.upgrade = { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null };
  });
  ws.on('open', () => {
    state.openMs = Date.now() - t0;
    if (connect) ws.send(stomp('CONNECT', { 'accept-version': '1.1,1.2', 'heart-beat': heartBeat, host: 'api.latoken.com' }));
  });
  ws.on('close', (code, reason) => {
    state.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 };
  });
  ws.on('error', (e) => {
    state.error = e.message;
  });
  return state;
}

function levelsOrdered(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (dir === 'desc' ? b >= a : b <= a) return false;
  }
  return true;
}

const stats = (xs) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function getJson(path) {
  const res = await fetch(API + path);
  return res.json();
}

async function tickers() {
  return getJson('/v2/ticker');
}

// Keeps one subscription's book and chain statistics.
function makeTracker(symbol, dest) {
  return {
    symbol,
    dest,
    bids: new Map(),
    asks: new Map(),
    lastNonce: null,
    firstNonce: null,
    snapshot: null,
    frames: 0,
    bytes: 0,
    gaps: 0,
    repeats: 0,
    emptyDeltas: 0,
    unorderedBidDeltas: 0,
    unorderedAskDeltas: 0,
    crossed: 0,
    maxBids: 0,
    maxAsks: 0,
    lags: [],
    lastArrival: null,
    maxInterFrameMs: 0,
  };
}

function applyBookFrame(t, frame, arrival) {
  const msg = JSON.parse(frame.body);
  const { payload, nonce, timestamp } = msg;
  t.frames++;
  t.bytes += frame.body.length;
  t.lags.push(arrival - timestamp);
  if (t.lastArrival !== null) t.maxInterFrameMs = Math.max(t.maxInterFrameMs, arrival - t.lastArrival);
  t.lastArrival = arrival;
  const bid = payload.bid ?? [];
  const ask = payload.ask ?? [];
  if (t.firstNonce === null) {
    t.firstNonce = nonce;
    t.snapshot = {
      nonce,
      bids: bid.length,
      asks: ask.length,
      bidsOrdered: levelsOrdered(bid, 'desc'),
      asksOrdered: levelsOrdered(ask, 'asc'),
      changeEqualsQuantity: [...bid, ...ask].every((l) => l.quantityChange === l.quantity),
      zeroLevels: [...bid, ...ask].filter((l) => Number(l.quantity) === 0).length,
      bytes: frame.body.length,
      ageMs: arrival - timestamp,
    };
  } else {
    if (nonce === t.lastNonce) t.repeats++;
    else if (nonce !== t.lastNonce + 1) t.gaps++;
    if (bid.length === 0 && ask.length === 0) t.emptyDeltas++;
    if (!levelsOrdered(bid, 'desc')) t.unorderedBidDeltas++;
    if (!levelsOrdered(ask, 'asc')) t.unorderedAskDeltas++;
    // A delta may name one price twice, as two changes in a row, so levels are applied in array order.
    const dup = (xs) => new Set(xs.map((l) => l.price)).size < xs.length;
    if (dup(bid) || dup(ask)) t.repeatedPriceDeltas = (t.repeatedPriceDeltas ?? 0) + 1;
  }
  t.lastNonce = nonce;
  for (const l of bid) {
    if (Number(l.quantity) === 0) t.bids.delete(l.price);
    else t.bids.set(l.price, l.quantity);
  }
  for (const l of ask) {
    if (Number(l.quantity) === 0) t.asks.delete(l.price);
    else t.asks.set(l.price, l.quantity);
  }
  t.maxBids = Math.max(t.maxBids, t.bids.size);
  t.maxAsks = Math.max(t.maxAsks, t.asks.size);
  const bb = Math.max(...[...t.bids.keys()].map(Number));
  const ba = Math.min(...[...t.asks.keys()].map(Number));
  if (t.bids.size && t.asks.size && bb >= ba) t.crossed++;
  return msg;
}

function topLevels(map, dir, n) {
  return [...map.entries()]
    .map(([p, q]) => [Number(p), Number(q)])
    .sort((a, b) => (dir === 'desc' ? b[0] - a[0] : a[0] - b[0]))
    .slice(0, n);
}

function summarize(t, seconds) {
  return {
    symbol: t.symbol,
    snapshot: t.snapshot,
    frames: t.frames,
    framesPerSecond: Math.round((t.frames / seconds) * 10) / 10,
    firstNonce: t.firstNonce,
    lastNonce: t.lastNonce,
    gaps: t.gaps,
    repeats: t.repeats,
    emptyDeltas: t.emptyDeltas,
    unorderedBidDeltas: t.unorderedBidDeltas,
    unorderedAskDeltas: t.unorderedAskDeltas,
    repeatedPriceDeltas: t.repeatedPriceDeltas ?? 0,
    crossedAfterFrame: t.crossed,
    maxBids: t.maxBids,
    maxAsks: t.maxAsks,
    lagMs: stats(t.lags),
    maxInterFrameMs: t.maxInterFrameMs,
  };
}

function subscribeBooks(state, trackers, perMessage) {
  const bySub = new Map();
  trackers.forEach((t, i) => bySub.set(String(i), t));
  state.ws.on('message', (data, isBinary) => {
    const arrival = Date.now();
    state.frames++;
    state.binary = (state.binary ?? 0) + (isBinary ? 1 : 0);
    const { frames, heartbeats } = parseStomp(data.toString('utf8'));
    for (let h = 0; h < heartbeats; h++) state.heartbeats.push(arrival - state.t0);
    if (frames.length > 1) state.multiFrameMessages = (state.multiFrameMessages ?? 0) + 1;
    for (const f of frames) {
      if (f.cmd === 'CONNECTED') {
        state.connected = { atMs: arrival - state.t0, headers: f.headers };
        capture('connected.txt', JSON.stringify(f));
        trackers.forEach((t, i) => state.ws.send(stomp('SUBSCRIBE', { id: String(i), destination: t.dest, ack: 'auto' })));
        state.subscribedAt = arrival;
      } else if (f.cmd === 'MESSAGE') {
        const t = bySub.get(f.headers.subscription);
        if (!t) continue;
        const t0 = performance.now();
        const msg = applyBookFrame(t, f, arrival);
        state.parseUs = (state.parseUs ?? 0) + (performance.now() - t0) * 1000;
        if (t.frames === 1) t.firstFrameAfterSubscribeMs = arrival - state.subscribedAt;
        if (perMessage) perMessage(t, f, msg);
      } else {
        log('other_frame', { label: state.label, cmd: f.cmd, headers: f.headers, body: f.body.slice(0, 300) });
      }
    }
  });
}

async function book() {
  const all = await tickers();
  const pick = ['ETH/USDT', 'HBAR/USDT', 'USDC/USDT', 'BTC/USDT', 'LA/USDT'];
  const trackers = pick.map((s) => {
    const row = all.find((r) => r.symbol === s);
    return makeTracker(s, `/v1/book/${row.baseCurrency}/${row.quoteCurrency}`);
  });
  const state = open('book', { heartBeat: '5000,5000' });
  let keptDelta = 0;
  subscribeBooks(state, trackers, (t, f, msg) => {
    if (t.frames === 1) capture('book_snapshot.txt', JSON.stringify({ headers: f.headers, body: f.body.slice(0, 1500) }));
    else if (keptDelta < 20) {
      keptDelta++;
      capture('book_delta.txt', JSON.stringify({ headers: f.headers, body: f.body.slice(0, 800) }));
    }
  });
  const hb = setInterval(() => {
    if (state.ws.readyState === WebSocket.OPEN) state.ws.send('\n');
  }, 5000);
  const seconds = 60;
  await sleep(seconds * 1000);
  clearInterval(hb);
  log('session', { openMs: state.openMs, upgrade: state.upgrade, connected: state.connected, wsMessages: state.frames, binaryMessages: state.binary, multiFrameMessages: state.multiFrameMessages ?? 0, parseUsPerMessage: Math.round((state.parseUs ?? 0) / Math.max(1, state.frames)), closed: state.closed });
  const gaps = state.heartbeats.slice(1).map((x, i) => x - state.heartbeats[i]);
  log('server_heartbeats', { count: state.heartbeats.length, intervalMs: stats(gaps) });
  for (const t of trackers) log('book_summary', { ...summarize(t, seconds), firstFrameAfterSubscribeMs: t.firstFrameAfterSubscribeMs });
  // Compare the kept book with REST at the end, one pair a second.
  for (const t of trackers) {
    const rest = await getJson(`/v2/book/${t.symbol}?limit=20`);
    const wsBids = topLevels(t.bids, 'desc', 20);
    const wsAsks = topLevels(t.asks, 'asc', 20);
    const eq = (w, r) => w.filter((l, i) => r[i] && l[0] === Number(r[i].price) && l[1] === Number(r[i].quantity)).length;
    log('rest_compare', {
      symbol: t.symbol,
      wsTop: [wsBids[0], wsAsks[0]],
      restTop: [rest.bid[0] && [rest.bid[0].price, rest.bid[0].quantity], rest.ask[0] && [rest.ask[0].price, rest.ask[0].quantity]],
      equalBidLevels: `${eq(wsBids, rest.bid)} of ${Math.min(20, wsBids.length)}`,
      equalAskLevels: `${eq(wsAsks, rest.ask)} of ${Math.min(20, wsAsks.length)}`,
      wsBookSize: [t.bids.size, t.asks.size],
    });
    await sleep(1000);
  }
  state.ws.close();
  await sleep(300);
}

async function batch() {
  const all = await tickers();
  const picked = all
    .filter((r) => Number(r.bestBid) > 0 && Number(r.bestAsk) > 0)
    .sort((a, b) => Number(b.volume24h) - Number(a.volume24h))
    .slice(0, 100);
  const trackers = picked.map((r) => makeTracker(r.symbol, `/v1/book/${r.baseCurrency}/${r.quoteCurrency}`));
  const state = open('batch', { heartBeat: '5000,5000' });
  let bytes = 0;
  const perSecond = new Map();
  state.ws.on('message', (d) => {
    bytes += d.length;
    const s = Math.floor((Date.now() - state.t0) / 1000);
    perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
  });
  subscribeBooks(state, trackers);
  const hb = setInterval(() => {
    if (state.ws.readyState === WebSocket.OPEN) state.ws.send('\n');
  }, 5000);
  const seconds = 45;
  await sleep(seconds * 1000);
  clearInterval(hb);
  const snapshots = trackers.filter((t) => t.firstNonce !== null);
  const firstAfter = snapshots.map((t) => t.firstFrameAfterSubscribeMs);
  const counts = [...perSecond.values()].slice(2, -1);
  log('batch', {
    subscribed: trackers.length,
    gotSnapshot: snapshots.length,
    firstNonceZero: snapshots.filter((t) => t.firstNonce === 0).length,
    snapshotAfterSubscribeMs: stats(firstAfter),
    snapshotLevels: stats(snapshots.map((t) => Math.max(t.snapshot.bids, t.snapshot.asks))),
    snapshotsAtLeast20PerSide: snapshots.filter((t) => t.snapshot.bids >= 20 && t.snapshot.asks >= 20).length,
    gaps: trackers.reduce((a, t) => a + t.gaps, 0),
    repeats: trackers.reduce((a, t) => a + t.repeats, 0),
    crossedAfterFrame: trackers.filter((t) => t.crossed > 0).map((t) => `${t.symbol}:${t.crossed}`).slice(0, 10),
    wsMessages: state.frames,
    messagesPerSecond: stats(counts),
    kbPerSecond: Math.round(bytes / seconds / 1024),
    parseUsPerMessage: Math.round((state.parseUs ?? 0) / Math.max(1, state.frames)),
    lagMs: stats(trackers.flatMap((t) => t.lags)),
    silentPairs: trackers.filter((t) => t.frames <= 1).length,
    closed: state.closed,
    error: state.error,
  });
  state.ws.close();
  await sleep(300);
}

async function silence() {
  const variants = [
    { label: 'no_connect_frame', opts: { connect: false } },
    { label: 'connect_heartbeat_0_0', opts: { heartBeat: '0,0' } },
    { label: 'connect_heartbeat_10000_10000_client_silent', opts: { heartBeat: '10000,10000' } },
    { label: 'connect_heartbeat_0_0_subscribed_busy_book', opts: { heartBeat: '0,0' }, busy: true },
  ];
  const eth = (await tickers()).find((r) => r.symbol === 'ETH/USDT');
  const states = variants.map((v) => {
    const s = open(v.label, v.opts);
    s.bookFrames = 0;
    s.ws.on('message', (d) => {
      const { frames, heartbeats } = parseStomp(d.toString('utf8'));
      for (let h = 0; h < heartbeats; h++) s.heartbeats.push(Date.now() - s.t0);
      for (const f of frames) {
        if (f.cmd === 'CONNECTED') {
          s.connected = { atMs: Date.now() - s.t0, heartBeat: f.headers['heart-beat'] };
          if (v.busy) s.ws.send(stomp('SUBSCRIBE', { id: '0', destination: `/v1/book/${eth.baseCurrency}/${eth.quoteCurrency}`, ack: 'auto' }));
        } else if (f.cmd === 'MESSAGE') s.bookFrames++;
        else log('frame', { label: s.label, cmd: f.cmd, headers: f.headers, body: f.body.slice(0, 200) });
      }
    });
    return s;
  });
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline && states.some((s) => s.closed === null)) await sleep(500);
  for (const s of states) {
    log('silence', { label: s.label, openMs: s.openMs, connected: s.connected, bookFrames: s.bookFrames, serverHeartbeatsAtMs: s.heartbeats.slice(0, 12), closed: s.closed ?? `open after ${Math.round((Date.now() - s.t0) / 1000)} s`, error: s.error });
    if (s.closed === null) s.ws.close();
  }
  await sleep(300);
}

async function errors() {
  const all = await tickers();
  const eth = all.find((r) => r.symbol === 'ETH/USDT');
  // A SUBSCRIBE sent before any CONNECT frame.
  const early = open('subscribe_before_connect', { connect: false });
  const earlySeen = { messages: 0, first: null };
  early.ws.on('open', () => early.ws.send(stomp('SUBSCRIBE', { id: '0', destination: `/v1/book/${eth.baseCurrency}/${eth.quoteCurrency}`, ack: 'auto' })));
  early.ws.on('message', (d) => {
    earlySeen.messages++;
    if (earlySeen.first === null) earlySeen.first = d.toString('utf8').slice(0, 250);
  });
  const state = open('errors', { heartBeat: '5000,5000' });
  const subs = {
    0: `/v1/book/${eth.baseCurrency}/${eth.quoteCurrency}`,
    1: '/v1/book/ETH/USDT',
    2: `/v1/book/00000000-0000-0000-0000-000000000000/${USDT}`,
    3: '/v1/book/NOPE/USDT',
    4: '/v1/nope',
  };
  const seen = {};
  state.ws.on('message', (d) => {
    const { frames } = parseStomp(d.toString('utf8'));
    for (const f of frames) {
      if (f.cmd === 'CONNECTED') {
        for (const [id, dest] of Object.entries(subs)) state.ws.send(stomp('SUBSCRIBE', { id, destination: dest, ack: 'auto' }));
      } else if (f.cmd === 'MESSAGE') {
        const id = f.headers.subscription;
        const msg = JSON.parse(f.body);
        if (!seen[id]) {
          seen[id] = { frames: 0, firstNonce: msg.nonce, firstBids: msg.payload.bid?.length, firstAsks: msg.payload.ask?.length };
          if (id !== '0') capture('error_first_frames.txt', JSON.stringify({ headers: f.headers, body: f.body.slice(0, 400) }));
        }
        seen[id].frames++;
        seen[id].lastNonce = msg.nonce;
      } else {
        log('error_frame', { cmd: f.cmd, headers: f.headers, body: f.body.slice(0, 300), atMs: Date.now() - state.t0 });
      }
    }
  });
  await sleep(6000);
  log('after_6s', { seen, closed: state.closed });
  log('subscribe_before_connect', { ...earlySeen, closed: early.closed, error: early.error });
  // An unsubscribe and a resubscribe of the same destination under a new id.
  state.ws.send(stomp('UNSUBSCRIBE', { id: '0' }));
  state.ws.send(stomp('SUBSCRIBE', { id: '9', destination: subs[0], ack: 'auto' }));
  await sleep(4000);
  log('after_resubscribe', { old: seen[0], resubscribed: seen[9], closed: state.closed });
  // Garbage goes to the other socket so that the duplicate id test below starts from a clean parser.
  const before = earlySeen.messages;
  early.ws.send('this is not a stomp frame\0');
  await sleep(3000);
  log('after_garbage', { closed: early.closed, messagesAfter: earlySeen.messages - before });
  if (state.closed === null) {
    // The same id again on a live subscription, which is last because it ends the session.
    state.ws.send(stomp('SUBSCRIBE', { id: '9', destination: subs[0], ack: 'auto' }));
    await sleep(3000);
    log('after_duplicate_id', { seen: seen[9], closed: state.closed });
  }
  for (const s of [state, early]) if (s.closed === null) s.ws.close();
  await sleep(300);
}

async function channels() {
  const all = await tickers();
  const eth = all.find((r) => r.symbol === 'ETH/USDT');
  const dests = [
    '/v1/ticker',
    `/v1/ticker/${eth.baseCurrency}/${eth.quoteCurrency}`,
    `/v1/rate/${eth.baseCurrency}/${eth.quoteCurrency}`,
    '/v1/rate/USDT',
    `/v1/trade/${eth.baseCurrency}/${eth.quoteCurrency}`,
    '/v1/pair',
    '/v1/currency',
  ];
  const state = open('channels', { heartBeat: '5000,5000' });
  const seen = Object.fromEntries(dests.map((d, i) => [i, { dest: d, frames: 0, bytes: 0, maxRows: 0 }]));
  state.ws.on('message', (d) => {
    const { frames } = parseStomp(d.toString('utf8'));
    for (const f of frames) {
      if (f.cmd === 'CONNECTED') dests.forEach((dest, i) => state.ws.send(stomp('SUBSCRIBE', { id: String(i), destination: dest, ack: 'auto' })));
      else if (f.cmd === 'MESSAGE') {
        const s = seen[f.headers.subscription];
        const msg = JSON.parse(f.body);
        s.frames++;
        s.bytes += f.body.length;
        const rows = Array.isArray(msg.payload) ? msg.payload.length : 1;
        s.maxRows = Math.max(s.maxRows, rows);
        if (s.frames === 1) {
          s.firstNonce = msg.nonce;
          const sample = Array.isArray(msg.payload) ? msg.payload.find((r) => r.symbol === 'ETH/USDT' || r.baseCurrency === eth.baseCurrency) ?? msg.payload[0] : msg.payload;
          s.sample = JSON.stringify({ ...msg, payload: sample }).slice(0, 700);
        }
      } else log('frame', { cmd: f.cmd, headers: f.headers, body: f.body.slice(0, 300) });
    }
  });
  await sleep(15000);
  for (const s of Object.values(seen)) log('channel', s);
  state.ws.close();
  await sleep(300);
}

// Prints the CONNECTED frame, the ETH/USDT snapshot cut to two levels per side, and the next three deltas, for the profile's captured frames.
async function frames() {
  const all = await tickers();
  const eth = all.find((r) => r.symbol === 'ETH/USDT');
  const state = open('frames', { heartBeat: '5000,5000' });
  let n = 0;
  state.ws.on('message', (d) => {
    const { frames: fs } = parseStomp(d.toString('utf8'));
    for (const f of fs) {
      if (f.cmd === 'CONNECTED') {
        log('connected', { headers: f.headers });
        state.ws.send(stomp('SUBSCRIBE', { id: '0', destination: `/v1/book/${eth.baseCurrency}/${eth.quoteCurrency}`, ack: 'auto' }));
      } else if (f.cmd === 'MESSAGE' && n < 4) {
        n++;
        const msg = JSON.parse(f.body);
        const full = { bids: msg.payload.bid.length, asks: msg.payload.ask.length, bytes: f.body.length };
        msg.payload.ask = msg.payload.ask.slice(0, 2);
        msg.payload.bid = msg.payload.bid.slice(0, 2);
        log(n === 1 ? 'snapshot' : 'delta', { headers: f.headers, full, body: msg });
      }
    }
  });
  await sleep(4000);
  state.ws.close();
  await sleep(300);
}

async function deflate() {
  const s = open('deflate', { deflate: true });
  await sleep(2500);
  log('deflate', { upgrade: s.upgrade, openMs: s.openMs, closed: s.closed, error: s.error });
  s.ws.close();
  await sleep(300);
}

const modes = { book, batch, silence, errors, channels, frames, deflate };
const mode = process.argv[2] ?? 'book';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
