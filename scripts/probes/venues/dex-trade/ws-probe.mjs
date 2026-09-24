// Dex-Trade socket probe: the Socket.IO book rooms read over a raw WebSocket, their sequenceId chain, the REST snapshot alignment, level semantics, keepalive, silence and errors.
// The documented client is socket.io-client, so this probe speaks Engine.IO v4 framing by hand: "40" joins the default namespace, "42[event, data]" is an event, the server sends "2" and expects "3".
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which only offers it.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/dex-trade/ws-probe.mjs [book|silence|deflate]
//   book     every book room of the catalog on one socket for 75 s, REST snapshots of five busy pairs taken after the subscribe and again at the end, plus an error socket for 12 s. About 80 s.
//   silence  four sockets for up to 110 s: answers pings, never answers pings, never joins the namespace, and an Engine.IO v3 client. About 110 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates, then reads the Engine.IO v3 and v4 polling handshakes. About 3 s.
// Set PROBE_OUT_DIR to keep every frame. Recorded in docs/profiles/dex-trade/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const API = 'https://api.dex-trade.com';
const WS4 = 'wss://socket.dex-trade.com/socket.io/?EIO=4&transport=websocket';
const WS3 = 'wss://socket.dex-trade.com/socket.io/?EIO=3&transport=websocket';
const OUT = process.env.PROBE_OUT_DIR;
const BUSY = ['AVDOUSDT', 'BIMUSDT', 'DRCUSDT', 'USDiUSDT', 'VRTUSDC'];
const HOLD_MS = 75_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const emit = (event, data) => '42' + JSON.stringify(data === undefined ? [event] : [event, data]);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

function open(url, name, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  ws.t0 = t0;
  ws.on('upgrade', (res) => log('upgrade', { socket: name, status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server, ms: Date.now() - t0 }));
  ws.on('unexpected-response', (req, res) => log('refused', { socket: name, status: res.statusCode }));
  ws.on('error', (e) => log('socket_error', { socket: name, message: e.message }));
  return ws;
}

// A book from the REST snapshot, keyed by the scaled integer rate the socket uses.
function restBook(d, dec) {
  const side = (a) => new Map(a.map((l) => [Math.round(l.rate * 10 ** dec.rate), Math.round(l.volume * 10 ** dec.base)]));
  return { buy: side(d.buy), sell: side(d.sell), seq: d.sequenceId };
}

function compareBooks(local, rest) {
  let equal = 0;
  let differ = 0;
  const diffs = [];
  for (const s of ['buy', 'sell']) {
    const keys = new Set([...local[s].keys(), ...rest[s].keys()]);
    for (const k of keys) {
      if (local[s].get(k) === rest[s].get(k)) equal++;
      else {
        differ++;
        if (diffs.length < 4) diffs.push({ side: s, rate: k, local: local[s].get(k) ?? null, rest: rest[s].get(k) ?? null });
      }
    }
  }
  return { equal, differ, diffs };
}

async function book() {
  const symbols = (await getJson(`${API}/v1/public/symbols`)).data;
  const byId = new Map(symbols.map((s) => [`book_${s.id}`, s]));
  const byPair = new Map(symbols.map((s) => [s.pair, s]));
  const dec = (s) => ({ rate: s.rate_decimal, base: s.base_decimal, quote: s.quote_decimal });
  const rooms = {};
  const buffers = new Map(); // room to deltas received before its snapshot is applied
  const books = new Map(); // room to { buy, sell, seq }
  const align = {};
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let acks = 0;
  const ackTimes = [];
  const pings = [];
  const shapes = { set: 0, del: 0, multiLevel: 0, bothSides: 0, multiElement: 0, priceMismatch: 0, levelKeys: new Set(), setKeys: new Set() };
  const ages = [];
  const samples = {};
  let subscribedAt = 0;
  let lastFrameAt = 0;

  const ws = open(WS4, 'book');
  ws.on('message', (buf) => {
    const now = Date.now();
    const s = buf.toString();
    frames++;
    bytes += buf.length;
    capture('book-frames.txt', `${now} ${s.slice(0, 2000)}`);
    if (s === '2') {
      pings.push(now - ws.t0);
      ws.send('3');
      return;
    }
    if (s.startsWith('0')) {
      log('engine_open', { frame: s, ms: now - ws.t0 });
      ws.send('40');
      return;
    }
    if (s.startsWith('40')) {
      log('namespace_open', { frame: s, ms: now - ws.t0 });
      subscribedAt = now;
      for (const room of byId.keys()) ws.send(emit('subscribe', { type: 'book', event: room }));
      ws.send(emit('subscribe', { type: 'hist', event: `hist_${byPair.get('AVDOUSDT').id}` }));
      return;
    }
    if (!s.startsWith('42')) {
      log('other_packet', { frame: s.slice(0, 200) });
      return;
    }
    const t = process.hrtime.bigint();
    const [event, payload] = JSON.parse(s.slice(2));
    parseNs += process.hrtime.bigint() - t;
    if (event === 'subscribe') {
      acks++;
      ackTimes.push(now - subscribedAt);
      if (acks === 1) log('ack_first', { frame: s, after_subscribe_ms: now - subscribedAt });
      return;
    }
    if (event !== 'message') {
      log('other_event', { frame: s.slice(0, 300) });
      return;
    }
    if (payload.length > 1) shapes.multiElement++;
    for (const m of payload) {
      if (m.type !== 'book') {
        if (!samples[m.type]) {
          samples[m.type] = s.slice(0, 600);
          log('sample_other_type', { type: m.type, frame: samples[m.type] });
        }
        continue;
      }
      lastFrameAt = now;
      const room = m.room;
      const r = (rooms[room] ??= { n: 0, gaps: 0, dups: 0, back: 0, last: undefined, first: m.data.sequenceId, maxIdleMs: 0, lastAt: subscribedAt });
      r.n++;
      r.maxIdleMs = Math.max(r.maxIdleMs, now - r.lastAt);
      r.lastAt = now;
      const q = m.data.sequenceId;
      if (r.last !== undefined) {
        if (q === r.last) r.dups++;
        else if (q < r.last) r.back++;
        else if (q !== r.last + 1) r.gaps++;
      }
      r.last = q;
      const sides = ['buy', 'sell'].filter((x) => m.data[x]);
      if (sides.length === 0) {
        shapes.noSide = (shapes.noSide ?? 0) + 1;
        if (!samples.noSide) log('sample_no_side', { frame: (samples.noSide = s.slice(0, 400)) });
        continue;
      }
      if (sides.length > 1) shapes.bothSides++;
      let levels = 0;
      for (const side of sides) {
        for (const [k, v] of Object.entries(m.data[side])) {
          levels++;
          const keys = Object.keys(v);
          if (keys.length === 0) shapes.del++;
          else {
            shapes.set++;
            shapes.setKeys.add(keys.join(','));
            if (String(v.rate) !== k) shapes.levelKeys.add(`key ${k} rate ${v.rate}`);
            if (typeof v.time === 'number') ages.push(now - v.time);
            const sym = byId.get(room);
            const want = (v.volume / 10 ** sym.base_decimal) * (v.rate / 10 ** sym.rate_decimal) * 10 ** sym.quote_decimal;
            if (Math.abs(want - v.price) > Math.max(2, v.price * 1e-6)) shapes.priceMismatch++;
          }
        }
      }
      if (levels > 1) shapes.multiLevel++;
      if (!samples[`set ${sides[0]}`] && shapes.set > 0 && Object.keys(Object.values(m.data[sides[0]])[0]).length > 0) {
        samples[`set ${sides[0]}`] = s;
        log('sample_set', { frame: s });
      }
      if (!samples.del && Object.keys(Object.values(m.data[sides[0]])[0]).length === 0) {
        samples.del = s;
        log('sample_delete', { frame: s });
      }
      // Local book for the pairs that got a REST snapshot.
      if (books.has(room)) applyDelta(books.get(room), m.data, align[room]);
      else if (buffers.has(room)) buffers.get(room).push(m.data);
    }
  });

  function applyDelta(b, data, a) {
    if (data.sequenceId <= b.seq) {
      a.dropped_before_snapshot++;
      return;
    }
    if (data.sequenceId !== b.seq + 1) a.chain_breaks++;
    if (a.first_applied === null) a.first_applied = data.sequenceId;
    for (const side of ['buy', 'sell']) {
      for (const [k, v] of Object.entries(data[side] ?? {})) {
        if (Object.keys(v).length === 0) b[side].delete(Number(k));
        else b[side].set(Number(k), v.volume);
      }
    }
    b.seq = data.sequenceId;
    a.applied++;
  }

  // Snapshots after the subscribe, buffering deltas until each arrives.
  while (!subscribedAt) await sleep(50);
  await sleep(1500);
  for (const p of BUSY) {
    const sym = byPair.get(p);
    const room = `book_${sym.id}`;
    buffers.set(room, []);
    const t = Date.now();
    const wsSeqAtRequest = rooms[room]?.last ?? null; // the socket's last sequenceId when the REST call left
    const snap = (await getJson(`${API}/v1/public/book?pair=${p}`)).data;
    const b = restBook(snap, dec(sym));
    const pending = buffers.get(room);
    buffers.delete(room);
    align[room] = { pair: p, snapshot_seq: snap.sequenceId, ws_seq_at_request: wsSeqAtRequest, ws_seq_at_reply: rooms[room]?.last ?? null, rest_ms: Date.now() - t, buffered: pending.length, dropped_before_snapshot: 0, chain_breaks: 0, first_applied: null, applied: 0, rest_levels: `${snap.buy.length}/${snap.sell.length}` };
    for (const d of pending) applyDelta(b, d, align[room]);
    books.set(room, b);
    await sleep(700);
  }

  const errors = errorSocket();
  await sleep(HOLD_MS - 1500 - BUSY.length * 900);
  await errors;

  // Final comparison: read REST again and compare where the sequenceIds match.
  for (const [room, b] of books) {
    const a = align[room];
    const sym = byId.get(room);
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = (await getJson(`${API}/v1/public/book?pair=${a.pair}`)).data;
      const rest = restBook(snap, dec(sym));
      result = { attempt, rest_seq: snap.sequenceId, local_seq: b.seq, ...compareBooks(b, rest) };
      if (snap.sequenceId === b.seq) break;
      await sleep(600);
    }
    log('alignment', { room, ...a, final: result, local_levels: `${b.buy.size}/${b.sell.size}` });
  }
  const held = (Date.now() - subscribedAt) / 1000;
  ws.close();
  const active = Object.entries(rooms).sort((x, y) => y[1].n - x[1].n);
  log('rooms', {
    subscribed: byId.size,
    acked: acks,
    ack_ms: { min: Math.min(...ackTimes), max: Math.max(...ackTimes) },
    rooms_with_frames: active.length,
    held_s: Math.round(held),
    per_room: active.map(([k, v]) => `${byId.get(k)?.pair ?? k} n${v.n} gaps${v.gaps} dups${v.dups} back${v.back} idle${Math.round(v.maxIdleMs / 1000)}s`),
  });
  log('shapes', { ...shapes, levelKeys: [...shapes.levelKeys].slice(0, 3), setKeys: [...shapes.setKeys] });
  const sorted = [...ages].sort((x, y) => x - y);
  log('update_age_ms', { n: sorted.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], max: sorted[sorted.length - 1] });
  log('throughput', { frames, frames_per_s: +(frames / held).toFixed(2), bytes_per_s: Math.round(bytes / held), bytes_per_frame: Math.round(bytes / frames), parse_us_per_frame: +(Number(parseNs) / frames / 1000).toFixed(1), server_pings_at_ms: pings, last_book_frame_s_before_close: Math.round((Date.now() - lastFrameAt) / 1000) });
}

async function errorSocket() {
  const ws = open(WS4, 'errors');
  const cases = [
    ['unknown numeric room', emit('subscribe', { type: 'book', event: 'book_999999999' })],
    ['room named by pair', emit('subscribe', { type: 'book', event: 'book_ELGUSDT' })],
    ['unknown type', emit('subscribe', { type: 'nope', event: 'nope_7951' })],
    ['string payload', emit('subscribe', 'book_7951')],
    ['same room twice', emit('subscribe', { type: 'book', event: 'book_7951' })],
    ['same room twice, second', emit('subscribe', { type: 'book', event: 'book_7951' })],
    ['unsubscribe', emit('unsubscribe', 'book_7951')],
    ['unknown event', emit('nope', { a: 1 })],
    ['text that is not a packet', 'hello'],
  ];
  const replies = [];
  let closed = null;
  ws.on('close', (code, reason) => (closed = { code, reason: reason.toString(), at_ms: Date.now() - ws.t0 }));
  ws.on('message', (buf) => {
    const s = buf.toString();
    capture('error-frames.txt', `${Date.now()} ${s.slice(0, 1000)}`);
    if (s === '2') return ws.send('3');
    if (s.startsWith('0')) return ws.send('40');
    if (s.startsWith('40')) {
      (async () => {
        for (const [name, frame] of cases) {
          if (ws.readyState !== ws.OPEN) break;
          replies.push({ sent: name, at_ms: Date.now() - ws.t0 });
          ws.send(frame);
          await sleep(800);
        }
      })();
      return;
    }
    replies.push({ got: s.slice(0, 200), at_ms: Date.now() - ws.t0 });
  });
  await sleep(12_000);
  const state = ws.readyState;
  ws.close();
  log('errors', { replies, closed_by_server: closed, ready_state_at_end: state });
}

async function silence() {
  const results = {};
  const run = (name, url, behave) =>
    new Promise((resolve) => {
      const ws = open(url, name);
      const r = (results[name] = { pings: [], frames: 0, close: null });
      let clientPing;
      ws.on('message', (buf) => {
        const s = buf.toString();
        r.frames++;
        if (s === '2') {
          r.pings.push(Date.now() - ws.t0);
          if (behave.answer) ws.send('3');
          return;
        }
        if (s === '3') {
          r.pongs = (r.pongs ?? 0) + 1;
          return;
        }
        if (s.startsWith('0') || /^\d+:0/.test(s)) {
          r.open = s.slice(0, 160);
          // A v3 server joins the default namespace itself and sends "40", so only a v4 client asks.
          if (behave.join && url !== WS3) ws.send('40');
          if (behave.clientPing) clientPing = setInterval(() => ws.readyState === ws.OPEN && ws.send('2'), 25_000);
          return;
        }
        if (s.startsWith('40')) {
          r.joined = s.slice(0, 80);
          if (behave.subscribe) ws.send(emit('subscribe', { type: 'book', event: 'book_21811' }));
          return;
        }
        if (s.startsWith('42["subscribe"')) r.acked = true;
        if (s.startsWith('42["message"')) r.book_frames = (r.book_frames ?? 0) + 1;
      });
      ws.on('close', (code, reason) => {
        r.close = { code, reason: reason.toString(), at_ms: Date.now() - ws.t0 };
        clearInterval(clientPing);
        resolve();
      });
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) ws.close();
      }, 110_000);
    });
  await Promise.all([
    run('answers pings, joined, subscribed', WS4, { answer: true, join: true, subscribe: true }),
    run('never answers pings, joined, subscribed', WS4, { answer: false, join: true, subscribe: true }),
    run('answers pings, never joins the namespace', WS4, { answer: true, join: false }),
    run('Engine.IO v3, client pings every 25 s, subscribed', WS3, { answer: true, join: true, subscribe: true, clientPing: true }),
  ]);
  for (const [name, r] of Object.entries(results)) log('silence', { socket: name, ...r });
}

async function deflate() {
  const ws = open(WS4, 'deflate', { perMessageDeflate: true });
  await new Promise((resolve) => {
    ws.on('message', (buf) => {
      log('deflate_first_frame', { frame: buf.toString().slice(0, 160) });
      ws.close();
      resolve();
    });
    setTimeout(resolve, 5000);
  });
  // The Engine.IO handshake over plain HTTP polling, which names the protocol version the server speaks.
  for (const eio of [3, 4]) {
    const res = await fetch(`https://socket.dex-trade.com/socket.io/?EIO=${eio}&transport=polling`);
    log('polling_handshake', { eio, status: res.status, body: (await res.text()).slice(0, 160) });
  }
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await book();
if (mode === 'silence') await silence();
if (mode === 'deflate') await deflate();
log('end', { at: new Date().toISOString() });
process.exit(0);
