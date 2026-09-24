// Emirex socket.io probe: the book rooms of every spot pair, snapshot or not, sequenceId per room, a local book rebuilt from the REST book and checked against a second REST read, keepalive, silence, errors and compression.
// Public, unauthenticated, read-only. Emirex speaks socket.io (Engine.IO 4) over wss://socket.emirex.com/socket.io/, driven here with raw ws text frames and perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/emirex/ws-probe.mjs [book|errors|silence|deflate]
//   book     all twelve book rooms and hist_261 on one socket for 60 s, the REST book of three pairs as the base, a second REST read to compare. About 62 s.
//   errors   unknown rooms, bad payloads, a duplicate subscribe, an unsubscribe, text that is not a socket.io packet. About 20 s.
//   silence  two sockets: one subscribed that never answers the server ping, one that answers pings but never joins the namespace. Up to 75 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/emirex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://socket.emirex.com/socket.io/?EIO=4&transport=websocket';
const API = 'https://api.emirex.com';
const OUT = process.env.PROBE_OUT_DIR;
const SCALE = 1e8; // rate and volume arrive as integers of 1e-8
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let captured = 0;

function capture(name, text) {
  if (!OUT || captured > 3_000_000) return;
  mkdirSync(OUT, { recursive: true });
  const line = text.length > 2000 ? text.slice(0, 2000) + '…' : text;
  captured += line.length;
  appendFileSync(join(OUT, name), line + '\n');
}

const emit = (event, payload) => '42' + JSON.stringify(payload === undefined ? [event] : [event, payload]);

function open(label, { answerPings = true, joinNamespace = true, onEvent, deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  const state = { ws, t0, pings: [], opened: null, handshake: null, nsp: null, closed: null };
  ws.on('upgrade', (res) => {
    state.upgradeStatus = res.statusCode;
    state.extensions = res.headers['sec-websocket-extensions'] ?? null;
    state.cfRay = res.headers['cf-ray'];
  });
  ws.on('open', () => { state.opened = Date.now() - t0; });
  ws.on('message', (data) => {
    const s = data.toString();
    const at = Date.now();
    capture(`${label}.txt`, `${at} ${s}`);
    if (s.startsWith('0{')) {
      state.handshake = JSON.parse(s.slice(1));
      state.handshakeAt = at - t0;
      if (joinNamespace) ws.send('40');
      return;
    }
    if (s === '2') {
      state.pings.push(at - t0);
      if (answerPings) ws.send('3');
      return;
    }
    if (s.startsWith('40')) {
      state.nsp = { at: at - t0, body: s.slice(2) };
      onEvent?.('connect', null, at, s);
      return;
    }
    if (s.startsWith('42')) {
      let arr;
      try { arr = JSON.parse(s.slice(2)); } catch { onEvent?.('unparsed', s, at, s); return; }
      onEvent?.(arr[0], arr[1], at, s);
      return;
    }
    onEvent?.('other', s, at, s);
  });
  ws.on('close', (code, reason) => { state.closed = { at: Date.now() - t0, code, reason: reason.toString() }; });
  ws.on('error', (e) => { state.error = e.message; });
  return state;
}

async function getJson(url) {
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'user-agent': 'observatory-probe/1' } });
  const body = await r.json();
  return { status: r.status, body, ms: Date.now() - t0 };
}

// One room's book, keyed by the integer rate the socket sends.
function newBook() { return { buy: new Map(), sell: new Map(), seq: null }; }

function applyLevels(book, side, levels) {
  for (const [rateKey, lv] of Object.entries(levels)) {
    if (!lv || Object.keys(lv).length === 0) book[side].delete(Number(rateKey));
    else book[side].set(Number(rateKey), lv.volume);
  }
}

function compareToRest(book, rest) {
  const res = {};
  for (const side of ['buy', 'sell']) {
    const restLv = rest[side] ?? [];
    const local = [...book[side].entries()].sort((a, b) => (side === 'buy' ? b[0] - a[0] : a[0] - b[0]));
    let rateMismatch = 0;
    let volMismatch = 0;
    const n = Math.min(20, restLv.length, local.length);
    for (let i = 0; i < n; i++) {
      if (Math.round(restLv[i].rate * SCALE) !== local[i][0]) rateMismatch++;
      else if (Math.round(restLv[i].volume * SCALE) !== local[i][1]) volMismatch++;
    }
    const restKeys = new Set(restLv.map((l) => Math.round(l.rate * SCALE)));
    let missingLocally = 0;
    for (const k of restKeys) if (!book[side].has(k)) missingLocally++;
    let extraLocally = 0;
    for (const k of book[side].keys()) if (!restKeys.has(k)) extraLocally++;
    let sizeMismatchAllLevels = 0;
    for (const l of restLv) {
      const k = Math.round(l.rate * SCALE);
      if (book[side].has(k) && book[side].get(k) !== Math.round(l.volume * SCALE)) sizeMismatchAllLevels++;
    }
    res[side] = { restLevels: restLv.length, localLevels: local.length, top20Compared: n, rateMismatch, volMismatch, missingLocally, extraLocally, sizeMismatchAllLevels };
  }
  return res;
}

async function bookMode() {
  const sym = (await getJson(`${API}/v1/public/symbols`)).body.data;
  const idToPair = new Map(sym.map((p) => [`book_${p.id}`, p.pair]));
  const rooms = new Map(); // room to stats
  for (const room of idToPair.keys()) rooms.set(room, { acks: 0, frames: 0, levels: 0, multiLevelFrames: 0, bothSideFrames: 0, deletes: 0, seqPrev: null, seqStep1: 0, seqGaps: [], seqBackwards: 0, firstFrameMs: null, lastAt: null, maxGapMs: 0, lagMs: [], arrays: 0 });
  const tracked = new Set(['book_261', 'book_751', 'book_851']);
  const books = new Map([...tracked].map((r) => [r, { book: newBook(), buffer: [], based: false, applied: 0, droppedOld: 0, chainBreaks: 0 }]));
  const acks = [];
  const others = [];
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let subAt = null;
  let st;
  const sample = { first: null, del: null, hist: null, ack: null };

  const handleBook = (msg, at) => {
    const room = msg.room;
    const r = rooms.get(room);
    if (!r) { others.push({ unknownRoom: room }); return; }
    r.frames++;
    if (r.firstFrameMs === null) r.firstFrameMs = at - subAt;
    if (r.lastAt !== null) r.maxGapMs = Math.max(r.maxGapMs, at - r.lastAt);
    r.lastAt = at;
    const d = msg.data ?? {};
    const sides = ['buy', 'sell'].filter((s) => d[s]);
    if (sides.length === 2) r.bothSideFrames++;
    let n = 0;
    for (const s of sides) for (const [, lv] of Object.entries(d[s])) {
      n++;
      if (!lv || Object.keys(lv).length === 0) r.deletes++;
      else if (typeof lv.time === 'number') r.lagMs.push(at - lv.time);
    }
    r.levels += n;
    if (n > 1) r.multiLevelFrames++;
    const seq = d.sequenceId;
    if (r.seqPrev !== null) {
      if (seq === r.seqPrev + 1) r.seqStep1++;
      else if (seq > r.seqPrev + 1) r.seqGaps.push(seq - r.seqPrev);
      else r.seqBackwards++;
    }
    r.seqPrev = seq;
    const b = books.get(room);
    if (b) {
      if (!b.based) b.buffer.push(d);
      else applyDelta(b, d);
    }
  };

  const applyDelta = (b, d) => {
    if (d.sequenceId <= b.book.seq) { b.droppedOld++; return; }
    if (d.sequenceId !== b.book.seq + 1) b.chainBreaks++;
    for (const s of ['buy', 'sell']) if (d[s]) applyLevels(b.book, s, d[s]);
    b.book.seq = d.sequenceId;
    b.applied++;
  };

  st = open('book', {
    onEvent: (event, payload, at, raw) => {
      frames++;
      bytes += raw.length;
      if (event === 'connect') {
        subAt = Date.now();
        for (const room of rooms.keys()) st.ws.send(emit('subscribe', { type: 'book', event: room }));
        st.ws.send(emit('subscribe', { type: 'hist', event: 'hist_261' }));
        return;
      }
      if (event === 'subscribe') {
        acks.push({ ms: at - subAt, payload });
        if (!sample.ack) sample.ack = raw;
        const r = rooms.get(payload?.room);
        if (r) r.acks++;
        return;
      }
      if (event === 'message' && Array.isArray(payload)) {
        const t0 = process.hrtime.bigint();
        JSON.parse(raw.slice(2));
        parseNs += process.hrtime.bigint() - t0;
        for (const msg of payload) {
          if (msg.type === 'book') {
            handleBook(msg, at);
            const lv = Object.values(msg.data.buy ?? msg.data.sell ?? {})[0];
            if (!sample.first && lv && Object.keys(lv).length) sample.first = raw;
            if (!sample.del && lv && Object.keys(lv).length === 0) sample.del = raw;
          } else if (msg.type === 'hist') {
            if (!sample.hist) sample.hist = raw;
            others.push({ hist: true });
          } else others.push({ type: msg.type, room: msg.room });
        }
        if (payload.length > 1) for (const m of payload) if (rooms.get(m.room)) rooms.get(m.room).arrays++;
        return;
      }
      others.push({ event, raw: String(raw).slice(0, 200) });
    },
  });

  // Base the tracked books on a REST read taken after the subscriptions, so buffered deltas bridge the gap.
  await sleep(3000);
  for (const room of tracked) {
    const pair = idToPair.get(room);
    const rest = await getJson(`${API}/v1/public/book?pair=${pair}`);
    const b = books.get(room);
    const d = rest.body.data;
    b.book.seq = d.sequenceId;
    for (const s of ['buy', 'sell']) for (const lv of d[s]) b.book[s].set(Math.round(lv.rate * SCALE), Math.round(lv.volume * SCALE));
    b.restSeq = d.sequenceId;
    b.firstBuffered = b.buffer[0]?.sequenceId ?? null;
    b.based = true;
    for (const delta of b.buffer) applyDelta(b, delta);
    b.buffer = [];
    log('rest_base', { room, pair, restSeq: d.sequenceId, restMs: rest.ms, firstBufferedSeq: b.firstBuffered, bids: d.buy.length, asks: d.sell.length });
  }

  await sleep(55_000);
  // Compare each tracked book with a fresh REST read, noting how far the two sequence ids are apart.
  for (const room of tracked) {
    const pair = idToPair.get(room);
    const b = books.get(room);
    const seqBefore = b.book.seq;
    const rest = await getJson(`${API}/v1/public/book?pair=${pair}`);
    const d = rest.body.data;
    log('rest_compare', { room, pair, localSeq: seqBefore, localSeqAfterRead: b.book.seq, restSeq: d.sequenceId, applied: b.applied, droppedOld: b.droppedOld, chainBreaks: b.chainBreaks, cmp: compareToRest(b.book, d) });
  }
  const seconds = (Date.now() - subAt) / 1000;
  st.ws.close();
  await sleep(300);

  log('session', { upgrade: st.upgradeStatus, cfRay: st.cfRay, openMs: st.opened, handshake: st.handshake, handshakeMs: st.handshakeAt, nsp: st.nsp, pingsAtMs: st.pings, closed: st.closed });
  log('acks', { count: acks.length, msFirst: acks[0]?.ms, msLast: acks.at(-1)?.ms, payloads: acks.map((a) => a.payload?.room ?? JSON.stringify(a.payload)) });
  for (const [room, r] of rooms) {
    const lag = r.lagMs.sort((a, b) => a - b);
    log('room', { room, pair: idToPair.get(room), acks: r.acks, frames: r.frames, levels: r.levels, multiLevelFrames: r.multiLevelFrames, bothSideFrames: r.bothSideFrames, arraysOfMany: r.arrays, deletes: r.deletes, firstFrameMs: r.firstFrameMs, maxGapMs: r.maxGapMs, seqStep1: r.seqStep1, seqGaps: r.seqGaps.slice(0, 10), seqGapCount: r.seqGaps.length, seqBackwards: r.seqBackwards, lastSeq: r.seqPrev, lagMs: lag.length ? { min: lag[0], median: lag[Math.floor(lag.length / 2)], max: lag.at(-1) } : null });
  }
  log('throughput', { seconds: Math.round(seconds), frames, framesPerSecond: +(frames / seconds).toFixed(1), bytesPerSecond: Math.round(bytes / seconds), bytesPerFrame: Math.round(bytes / Math.max(1, frames)), parseUsPerMessageFrame: frames ? +(Number(parseNs) / 1000 / frames).toFixed(1) : null });
  log('others', { count: others.length, histFrames: others.filter((o) => o.hist).length, sample: others.filter((o) => !o.hist).slice(0, 5) });
  log('samples', { ack: sample.ack, first: sample.first, del: sample.del, hist: sample.hist?.slice(0, 400) });
}

async function errorsMode() {
  const events = [];
  let st;
  const t = () => Date.now() - st.t0;
  let deliveredAfterUnsub = 0;
  let unsubAt = null;
  let book261Frames = 0;
  let duplicateSeq = 0;
  const seen261 = new Set();
  st = open('errors', {
    onEvent: (event, payload, at, raw) => {
      if (event === 'message' && Array.isArray(payload)) {
        for (const m of payload) {
          if (m.room === 'book_261') {
            book261Frames++;
            const seq = m.data?.sequenceId;
            if (seen261.has(seq)) duplicateSeq++;
            seen261.add(seq);
          }
          if (unsubAt && m.room === 'book_261' && at > unsubAt + 1000) deliveredAfterUnsub++;
          if (!events.some((e) => e.room === m.room && e.event === 'message')) events.push({ ms: at - st.t0, event, room: m.room, type: m.type, raw: String(raw).slice(0, 160) });
        }
        return;
      }
      events.push({ ms: at - st.t0, event, raw: String(raw).slice(0, 200) });
    },
  });
  while (!st.nsp && Date.now() - st.t0 < 5000) await sleep(50);
  const sends = [
    ['unknown numeric room', emit('subscribe', { type: 'book', event: 'book_999999' })],
    ['pair name instead of id', emit('subscribe', { type: 'book', event: 'book_BTCUSDC' })],
    ['unknown type', emit('subscribe', { type: 'nope', event: 'nope_1' })],
    ['missing event', emit('subscribe', { type: 'book' })],
    ['string payload', emit('subscribe', 'book_261')],
    ['book_261', emit('subscribe', { type: 'book', event: 'book_261' })],
    ['book_261 again', emit('subscribe', { type: 'book', event: 'book_261' })],
    ['unknown event', emit('nope', { a: 1 })],
  ];
  for (const [what, frame] of sends) {
    events.push({ ms: t(), sent: what, frame });
    st.ws.send(frame);
    await sleep(300);
  }
  await sleep(6000);
  events.push({ ms: t(), sent: 'unsubscribe book_261', frame: emit('unsubscribe', 'book_261') });
  st.ws.send(emit('unsubscribe', 'book_261'));
  unsubAt = Date.now();
  await sleep(6000);
  events.push({ ms: t(), sent: 'text that is not a packet', frame: 'hello' });
  st.ws.send('hello');
  await sleep(2000);
  events.push({ ms: t(), sent: 'broken event packet', frame: '42[' });
  if (st.ws.readyState === st.ws.OPEN) st.ws.send('42[');
  await sleep(2000);
  if (st.ws.readyState === st.ws.OPEN) st.ws.close();
  await sleep(300);
  for (const e of events) log('errors_event', e);
  log('errors_summary', { book261Frames, duplicateSeqOnBook261: duplicateSeq, deliveredOnBook261AfterUnsubscribe: deliveredAfterUnsub, closed: st.closed, error: st.error ?? null });
}

async function silenceMode() {
  const a = open('silence-nopong', {
    answerPings: false,
    onEvent: (event) => { if (event === 'connect') a.ws.send(emit('subscribe', { type: 'book', event: 'book_851' })); },
  });
  const b = open('silence-nonsp', { joinNamespace: false });
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline && (!a.closed || !b.closed)) await sleep(250);
  for (const [name, s] of [['subscribed, never answers ping', a], ['answers ping, never sends 40', b]]) {
    log('silence', { name, handshake: s.handshake, pingsAtMs: s.pings, nspAtMs: s.nsp?.at ?? null, closed: s.closed ?? `open at ${Date.now() - s.t0} ms` });
    if (!s.closed) s.ws.terminate();
  }
}

async function deflateMode() {
  const s = open('deflate', { deflate: true });
  await sleep(2500);
  log('deflate', { upgrade: s.upgradeStatus, offered: 'permessage-deflate', negotiated: s.extensions, handshake: s.handshake });
  s.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
await ({ book: bookMode, errors: errorsMode, silence: silenceMode, deflate: deflateMode })[mode]();
log('end', { at: new Date().toISOString() });
setTimeout(() => process.exit(0), 200);
