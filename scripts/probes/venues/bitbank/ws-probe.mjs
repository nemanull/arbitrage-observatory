// Bitbank public stream probe: Socket.IO 4 over a raw WebSocket, depth_whole and depth_diff rooms, sequence ids, level order, local book check, keepalive, silence, errors.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/venues/bitbank/ws-probe.mjs [book|batch|silence|errors|handshake]
//   book       depth_whole and depth_diff on four pairs for 75 s, plus ticker, transactions and circuit_break_info on btc_jpy.
//              Rebuilds each book from the previous whole and the diffs up to the next whole's sequenceId and compares the top 20 levels,
//              and compares btc_jpy and xrp_jpy against the REST depth at the REST sequenceId. About 80 s.
//   batch      depth_whole and depth_diff on every pair on one connection for 60 s: frame rate, bytes, parse time.
//   silence    five sockets that differ only in the Socket.IO connect and whether they answer the server ping, for up to 120 s.
//   errors     unknown room, repeated join, leave-room, unknown event, malformed packet, plain text, an empty book. About 20 s.
//   handshake  open timings, the open packet, EIO=3, and what the server says to a permessage-deflate offer. About 10 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/bitbank/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL4 = 'wss://stream.bitbank.cc/socket.io/?EIO=4&transport=websocket';
const URL3 = 'wss://stream.bitbank.cc/socket.io/?EIO=3&transport=websocket';
const PUBLIC = 'https://public.bitbank.cc';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const stats = (a) => (a.length ? { n: a.length, min: Math.min(...a), median: median(a), p90: pct(a, 0.9), max: Math.max(...a) } : { n: 0 });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

// Opens an Engine.IO 4 socket. opts.connect sends the Socket.IO '40', opts.pong answers the server ping '2' with '3'.
function open(url, name, opts = {}) {
  const { connect = true, pong = true, deflate = false, onEvent = () => {} } = opts;
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const s = { ws, name, t0, pings: [], opened: null, openPacket: null, nsAck: null, closed: null, frames: 0 };
  ws.on('upgrade', (res) => { s.extensions = res.headers['sec-websocket-extensions'] ?? null; s.upgradeHeaders = { server: res.headers.server ?? null, via: res.headers.via ?? null, pop: res.headers['x-amz-cf-pop'] ?? null }; });
  ws.on('open', () => { s.opened = Math.round(performance.now() - t0); });
  ws.on('message', (buf) => {
    const text = buf.toString('utf8');
    const at = performance.now();
    s.frames++;
    capture(`${name}.txt`, `${Date.now()} ${text}`);
    if (text[0] === '0') { s.openPacket = JSON.parse(text.slice(1)); s.openAt = Math.round(at - t0); if (connect) ws.send('40'); return; }
    if (text === '2') { s.pings.push(Math.round(at - t0)); if (pong) ws.send('3'); return; }
    if (text.startsWith('40')) { s.nsAck = text; s.nsAt = Math.round(at - t0); onEvent('connected', null, text, at); return; }
    if (text.startsWith('42')) {
      const p0 = performance.now();
      const arr = JSON.parse(text.slice(2));
      onEvent(arr[0], arr[1], text, at, performance.now() - p0);
      return;
    }
    onEvent('other', null, text, at);
  });
  ws.on('close', (code, reason) => { s.closed = { atMs: Math.round(performance.now() - t0), code, reason: reason.toString() }; });
  ws.on('error', (e) => { s.error = e.message; });
  return s;
}

const joinRoom = (s, room) => s.ws.send(`42${JSON.stringify(['join-room', room])}`);

function orderOk(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (dir === 'desc' ? !(b < a) : !(b > a)) return false;
  }
  return true;
}

function bookFrom(whole) {
  return { bids: new Map(whole.bids.map(([p, q]) => [p, q])), asks: new Map(whole.asks.map(([p, q]) => [p, q])) };
}

function applyDiff(book, d) {
  for (const [p, q] of d.b ?? []) { if (Number(q) === 0) book.bids.delete(p); else book.bids.set(p, q); }
  for (const [p, q] of d.a ?? []) { if (Number(q) === 0) book.asks.delete(p); else book.asks.set(p, q); }
}

function top(book, n) {
  const bids = [...book.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
  const asks = [...book.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
  return { bids, asks };
}

function sameTop(a, b, n) {
  const x = top(a, n);
  const y = top(b, n);
  const eq = (u, v) => u.length === v.length && u.every((l, i) => Number(l[0]) === Number(v[i][0]) && Number(l[1]) === Number(v[i][1]));
  return eq(x.bids, y.bids) && eq(x.asks, y.asks);
}

async function book() {
  const pairs = ['btc_jpy', 'xrp_jpy', 'eth_jpy', 'bat_jpy'];
  const st = Object.fromEntries(pairs.map((p) => [p, {
    wholes: [], diffs: [], wholeAt: [], diffAt: [], sDelta: [], nonMonotonic: 0, lagMs: [], firstWholeMs: null, firstDiffMs: null,
    wholeLevels: [], wholeBidOrder: 0, wholeAskOrder: 0, diffBidUnordered: 0, diffAskUnordered: 0, diffLevels: [], emptyDiffs: 0,
    behindAtArrival: [], checks: { match: 0, mismatch: 0, noDiffSame: 0, noDiffChanged: 0 }, extraKeys: new Set(), sizeTypes: new Set(), seqTypes: new Set(),
  }]));
  const other = { ticker: [], transactions: 0, circuit: [] };
  let joinAt = 0;
  const s = open(URL4, 'book', {
    onEvent: (ev, payload, text, at) => {
      if (ev === 'connected') {
        joinAt = performance.now();
        for (const p of pairs) { joinRoom(s, `depth_whole_${p}`); joinRoom(s, `depth_diff_${p}`); }
        joinRoom(s, 'ticker_btc_jpy'); joinRoom(s, 'transactions_btc_jpy'); joinRoom(s, 'circuit_break_info_btc_jpy');
        return;
      }
      if (ev !== 'message') { log('unexpected', { ev, text: text.slice(0, 300) }); return; }
      const room = payload.room_name;
      const data = payload.message.data;
      const wall = Date.now();
      if (room.startsWith('ticker_')) { other.ticker.push({ at: wall, ts: data.timestamp, pid: payload.message.pid }); if (other.ticker.length === 1) log('frame_ticker', { text: text.slice(0, 400) }); return; }
      if (room.startsWith('transactions_')) { other.transactions++; if (other.transactions === 1) log('frame_transactions', { text: text.slice(0, 400) }); return; }
      if (room.startsWith('circuit_break_info_')) { other.circuit.push(wall); if (other.circuit.length === 1) log('frame_circuit', { text: text.slice(0, 500) }); return; }
      const pair = room.replace(/^depth_(whole|diff)_/, '');
      const p = st[pair];
      if (room.startsWith('depth_whole_')) {
        p.firstWholeMs ??= Math.round(at - joinAt);
        p.wholeAt.push(wall);
        p.seqTypes.add(typeof data.sequenceId);
        p.wholeLevels.push([data.bids.length, data.asks.length]);
        if (orderOk(data.bids, 'desc')) p.wholeBidOrder++;
        if (orderOk(data.asks, 'asc')) p.wholeAskOrder++;
        const seq = Number(data.sequenceId);
        const lastDiffS = p.diffs.length ? Number(p.diffs[p.diffs.length - 1].s) : null;
        p.behindAtArrival.push(lastDiffS === null ? null : lastDiffS - seq);
        // Rebuild the previous whole plus the diffs in (prevSeq, seq] and compare with this whole.
        const prev = p.wholes[p.wholes.length - 1];
        if (prev) {
          const prevSeq = Number(prev.sequenceId);
          const firstDiff = p.diffs.find((d) => Number(d.s) > prevSeq);
          if (!firstDiff || Number(firstDiff.s) > seq) {
            // No diff in the interval, so the new whole should equal the previous one.
            if (sameTop(bookFrom(prev), bookFrom(data), 20)) p.checks.noDiffSame++; else p.checks.noDiffChanged++;
          } else {
            const b = bookFrom(prev);
            for (const d of p.diffs) { const ds = Number(d.s); if (ds > prevSeq && ds <= seq) applyDiff(b, d); }
            if (sameTop(b, bookFrom(data), 20)) p.checks.match++; else { p.checks.mismatch++; if (p.checks.mismatch <= 2) log('mismatch', { pair, prevSeq, seq, local: top(b, 3), whole: top(bookFrom(data), 3) }); }
          }
        }
        p.wholes.push({ bids: data.bids, asks: data.asks, sequenceId: data.sequenceId, timestamp: data.timestamp });
        if (p.wholes.length === 1 && (pair === 'btc_jpy' || pair === 'bat_jpy')) log('frame_whole_trimmed', { room, data: { ...data, asks: data.asks.slice(0, 3), bids: data.bids.slice(0, 3) } });
        return;
      }
      p.firstDiffMs ??= Math.round(at - joinAt);
      p.diffAt.push(wall);
      p.lagMs.push(wall - data.t);
      for (const k of Object.keys(data)) if (!['a', 'b', 't', 's'].includes(k)) p.extraKeys.add(k);
      for (const [, q] of [...(data.b ?? []), ...(data.a ?? [])]) p.sizeTypes.add(typeof q);
      p.diffLevels.push((data.b?.length ?? 0) + (data.a?.length ?? 0));
      if ((data.b?.length ?? 0) + (data.a?.length ?? 0) === 0) p.emptyDiffs++;
      if (data.b && data.b.length > 1 && !orderOk(data.b, 'desc')) p.diffBidUnordered++;
      if (data.a && data.a.length > 1 && !orderOk(data.a, 'asc')) p.diffAskUnordered++;
      const prevDiff = p.diffs[p.diffs.length - 1];
      if (prevDiff) { const dd = Number(data.s) - Number(prevDiff.s); p.sDelta.push(dd); if (dd <= 0) p.nonMonotonic++; }
      p.diffs.push(data);
      if (p.diffs.length === 3 && pair === 'btc_jpy') log('frame_diff', { pair, text: text.slice(0, 600) });
    },
  });
  // Compare against the REST depth at its own sequenceId, twice.
  const restChecks = [];
  for (const at of [30000, 60000]) {
    setTimeout(async () => {
      for (const pair of ['btc_jpy', 'xrp_jpy']) {
        const r = await (await fetch(`${PUBLIC}/${pair}/depth`)).json();
        const R = Number(r.data.sequenceId);
        const p = st[pair];
        // Wait until the socket has passed the REST sequenceId, so every diff up to it is in hand.
        for (let i = 0; i < 20 && !(p.diffs.length && Number(p.diffs[p.diffs.length - 1].s) >= R); i++) await sleep(250);
        const lastS = p.diffs.length ? Number(p.diffs[p.diffs.length - 1].s) : null;
        const base = [...p.wholes].reverse().find((w) => Number(w.sequenceId) <= R);
        if (!base) { restChecks.push({ pair, R, result: 'no whole at or before' }); continue; }
        const b = bookFrom(base);
        for (const d of p.diffs) { const ds = Number(d.s); if (ds > Number(base.sequenceId) && ds <= R) applyDiff(b, d); }
        const rb = bookFrom(r.data);
        const x = top(b, 20);
        const y = top(rb, 20);
        const eqSide = (u, v) => u.filter((l, i) => v[i] && Number(l[0]) === Number(v[i][0]) && Number(l[1]) === Number(v[i][1])).length;
        restChecks.push({ pair, restSeq: R, socketLastS: lastS, restAgeMs: Date.now() - r.data.timestamp, baseWholeSeq: base.sequenceId, bidsEqual: eqSide(x.bids, y.bids), asksEqual: eqSide(x.asks, y.asks), restLevels: [r.data.bids.length, r.data.asks.length], ...(eqSide(x.bids, y.bids) + eqSide(x.asks, y.asks) < 40 ? { localTop: { b: x.bids.slice(0, 2), a: x.asks.slice(0, 2) }, restTop: { b: y.bids.slice(0, 2), a: y.asks.slice(0, 2) } } : {}) });
      }
    }, at);
  }
  await sleep(75000);
  s.ws.close();
  await sleep(500);
  log('session', { opened: s.opened, openPacket: s.openPacket, openAt: s.openAt, nsAck: s.nsAck, nsAt: s.nsAt, pings: s.pings, frames: s.frames, closed: s.closed });
  for (const pair of pairs) {
    const p = st[pair];
    const wi = p.wholeAt.slice(1).map((t, i) => t - p.wholeAt[i]);
    const di = p.diffAt.slice(1).map((t, i) => t - p.diffAt[i]);
    log('pair', {
      pair, wholes: p.wholes.length, diffs: p.diffs.length, firstWholeMs: p.firstWholeMs, firstDiffMs: p.firstDiffMs,
      wholeIntervalMs: stats(wi), diffIntervalMs: stats(di), maxDiffGapMs: di.length ? Math.max(...di) : null,
      wholeLevels: { bids: stats(p.wholeLevels.map((l) => l[0])), asks: stats(p.wholeLevels.map((l) => l[1])) },
      wholeOrderOk: { bids: p.wholeBidOrder, asks: p.wholeAskOrder }, diffUnordered: { bids: p.diffBidUnordered, asks: p.diffAskUnordered },
      levelsPerDiff: stats(p.diffLevels), emptyDiffs: p.emptyDiffs, extraKeys: [...p.extraKeys], sizeTypes: [...p.sizeTypes], wholeSeqTypes: [...p.seqTypes],
      sDelta: stats(p.sDelta), sDeltaOne: p.sDelta.filter((d) => d === 1).length, nonMonotonic: p.nonMonotonic,
      wholeBehindLastDiffAtArrival: stats(p.behindAtArrival.filter((x) => x !== null)), checks: p.checks, arrivalMinusT: stats(p.lagMs),
    });
  }
  const ti = other.ticker.slice(1).map((t, i) => t.at - other.ticker[i].at);
  log('other', { tickerFrames: other.ticker.length, tickerIntervalMs: stats(ti), transactions: other.transactions, circuitFrames: other.circuit.length, circuitIntervalMs: stats(other.circuit.slice(1).map((t, i) => t - other.circuit[i])) });
  for (const c of restChecks) log('rest_compare', c);
  // Cross-pair sequence: the ids of different pairs interleave, which would explain the non-consecutive rule.
  const firstS = Object.fromEntries(pairs.map((pp) => [pp, st[pp].diffs[0]?.s ?? null]));
  log('first_s_per_pair', firstS);
}

async function batch() {
  const pairs = (await (await fetch('https://api.bitbank.cc/v1/spot/pairs')).json()).data.pairs.map((p) => p.name);
  let frames = 0;
  let bytes = 0;
  const parseUs = [];
  const perPair = new Map(pairs.map((p) => [p, { whole: 0, diff: 0 }]));
  const perSecond = [];
  let secFrames = 0;
  const s = open(URL4, 'batch', {
    onEvent: (ev, payload, text, at, parseMs) => {
      if (ev === 'connected') { for (const p of pairs) { joinRoom(s, `depth_whole_${p}`); joinRoom(s, `depth_diff_${p}`); } return; }
      if (ev !== 'message') return;
      frames++; secFrames++; bytes += text.length; parseUs.push(parseMs * 1000);
      const room = payload.room_name;
      const pair = room.replace(/^depth_(whole|diff)_/, '');
      const c = perPair.get(pair);
      if (c) { if (room.startsWith('depth_whole_')) c.whole++; else c.diff++; }
    },
  });
  const tick = setInterval(() => { perSecond.push(secFrames); secFrames = 0; }, 1000);
  await sleep(60000);
  clearInterval(tick);
  s.ws.close();
  await sleep(300);
  const silent = [...perPair.entries()].filter(([, c]) => c.whole === 0).map(([p]) => p);
  const noDiff = [...perPair.entries()].filter(([, c]) => c.diff === 0).map(([p]) => p);
  log('batch', {
    pairs: pairs.length, rooms: pairs.length * 2, frames, framesPerSecond: Math.round(frames / 60), perSecond: stats(perSecond), bytesPerSecond: Math.round(bytes / 60),
    bytesPerFrame: Math.round(bytes / Math.max(frames, 1)), parseUs: stats(parseUs.map((x) => Math.round(x))), pairsWithNoWhole: silent, pairsWithNoDiff: noDiff.length,
    wholesPerPair: stats([...perPair.values()].map((c) => c.whole)), diffsPerPair: stats([...perPair.values()].map((c) => c.diff)), pings: s.pings, closed: s.closed,
  });
}

async function silence() {
  const cases = [
    ['A_connect_pong_noRoom', { connect: true, pong: true }],
    ['B_connect_noPong_noRoom', { connect: true, pong: false }],
    ['C_noConnect_pong', { connect: false, pong: true }],
    ['D_connect_noPong_room', { connect: true, pong: false, room: 'depth_diff_btc_jpy' }],
    ['E_nothing', { connect: false, pong: false }],
  ];
  const socks = cases.map(([name, o]) => {
    const s = open(URL4, `silence-${name}`, { ...o, onEvent: (ev) => { if (ev === 'connected' && o.room) joinRoom(s, o.room); } });
    return s;
  });
  const start = Date.now();
  while (Date.now() - start < 120000 && socks.some((s) => !s.closed)) await sleep(500);
  const heldMs = Date.now() - start;
  const openAtEnd = new Map(socks.map((s) => [s, s.closed === null]));
  for (const s of socks) { if (!s.closed) s.ws.close(); }
  await sleep(300);
  for (const s of socks) log('silence', { name: s.name, pings: s.pings, frames: s.frames, closedByServer: openAtEnd.get(s) ? null : s.closed, openWhenProbeClosedAtMs: openAtEnd.get(s) ? heldMs : null });
}

async function errors() {
  const replies = [];
  const s = open(URL4, 'errors', {
    onEvent: (ev, payload, text, at) => {
      if (ev === 'connected') return;
      replies.push({ ev, room: payload?.room_name ?? null, text: text.slice(0, 300) });
    },
  });
  await sleep(1500);
  const step = async (label, frame, wait = 2500) => {
    const before = replies.length;
    s.ws.send(frame);
    await sleep(wait);
    const got = replies.slice(before);
    const rooms = {};
    for (const r of got) rooms[r.room ?? r.ev] = (rooms[r.room ?? r.ev] ?? 0) + 1;
    log('error_step', { label, frame, replies: got.length, byRoom: rooms, first: got.find((r) => r.ev !== 'message' || !r.room?.startsWith('depth_diff_btc'))?.text ?? got[0]?.text ?? null, closed: s.closed });
  };
  await step('unknown room', '42["join-room","depth_diff_nope_jpy"]');
  await step('empty book whole, suspended pair', '42["join-room","depth_whole_mkr_jpy"]', 6000);
  await step('circuit break of suspended pair', '42["join-room","circuit_break_info_mkr_jpy"]', 3000);
  await step('join btc diff', '42["join-room","depth_diff_btc_jpy"]', 1500);
  await step('join btc diff again', '42["join-room","depth_diff_btc_jpy"]', 1500);
  await step('leave-room', '42["leave-room","depth_diff_btc_jpy"]', 2500);
  await step('unknown event', '42["nope","depth_diff_btc_jpy"]');
  await step('plain text', 'hello');
  log('errors_socket', { closed: s.closed, pings: s.pings });
  if (!s.closed) s.ws.close();
  const s2 = open(URL4, 'errors2', {});
  await sleep(1500);
  s2.ws.send('42["join-room"');
  await sleep(2500);
  log('malformed_socketio', { frame: '42["join-room"', closed: s2.closed, frames: s2.frames });
  if (!s2.closed) s2.ws.close();
  await sleep(300);
}

async function handshake() {
  for (const [label, url, deflate] of [['eio4', URL4, false], ['eio4_deflate_offer', URL4, true], ['eio3', URL3, false]]) {
    let first = null;
    const s = open(url, `hs-${label}`, { deflate, connect: false, onEvent: (ev, p, text) => { first ??= text.slice(0, 200); } });
    s.ws.once('message', (b) => { first ??= b.toString().slice(0, 200); });
    await sleep(2500);
    log('handshake', { label, opened: s.opened, openAt: s.openAt, openPacket: s.openPacket, extensions: s.extensions ?? null, upgradeHeaders: s.upgradeHeaders ?? null, first, closed: s.closed, error: s.error ?? null });
    if (!s.closed) s.ws.close();
    await sleep(300);
  }
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, errors, handshake };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
