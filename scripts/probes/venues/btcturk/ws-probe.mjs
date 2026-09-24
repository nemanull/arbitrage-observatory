// BtcTurk spot WebSocket probe: the orderbook and obdiff channels, the ChangeSet chain, level order and window, size unit against REST, keepalive, silence, errors, and every pair on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// BtcTurk allows 15 connection requests per minute per IP, and no mode opens more than three sockets.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btcturk/ws-probe.mjs [book|batch|silence|deflate]
//   book     obdiff on five pairs for 60 s, checked against the orderbook channel's whole book as each one arrives and against the REST book, plus ticker, trade and error replies. About 65 s.
//   batch    obdiff on every TRADING pair on one connection for 60 s.
//   silence  three sockets that differ in whether they subscribe and whether they answer the server ping, for 110 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/btcturk/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws-feed-pro.btcturk.com/';
const API = 'https://api.btcturk.com/api/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const subFrame = (channel, event, join = true) => JSON.stringify([151, { type: 151, channel, event, join }]);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function stats(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

function open(label, opts = {}) {
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, ...opts });
  const t0 = performance.now();
  const info = { label, pings: [], closed: null, openMs: null, extensions: null, status: null };
  ws.on('upgrade', (res) => { info.status = res.statusCode; info.cfRay = res.headers['cf-ray']; info.extHeader = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('unexpected-response', (req, res) => { info.status = res.statusCode; log('unexpected_response', { label, status: res.statusCode, headers: res.headers }); });
  ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; });
  ws.on('ping', () => info.pings.push(Math.round(performance.now() - t0)));
  ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  ws.on('error', (e) => log('socket_error', { label, message: e.message }));
  ws.info = info;
  ws.t0 = t0;
  ws.ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}

// The book obdiff builds: the 431 snapshot replaces it, then each 432 applies CP 0 update, 1 new, 3 delete by price.
class Book {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.cs = null; this.maxBids = 0; this.maxAsks = 0; this.history = new Map(); }
  reset(m) {
    this.bids.clear(); this.asks.clear();
    for (const o of m.BO) this.bids.set(o.P, o.A);
    for (const o of m.AO) this.asks.set(o.P, o.A);
    this.cs = m.CS;
    this.remember();
  }
  apply(m, tally) {
    for (const [side, list] of [[this.bids, m.BO], [this.asks, m.AO]]) {
      for (const o of list) {
        tally[`cp${o.CP}`] = (tally[`cp${o.CP}`] ?? 0) + 1;
        const had = side.has(o.P);
        if (o.CP === 3) { if (!had) tally.deleteMissing = (tally.deleteMissing ?? 0) + 1; side.delete(o.P); }
        else {
          if (o.CP === 1 && had) tally.newExisting = (tally.newExisting ?? 0) + 1;
          if (o.CP === 0 && !had) tally.updateMissing = (tally.updateMissing ?? 0) + 1;
          if (Number(o.A) === 0) tally.zeroAmount = (tally.zeroAmount ?? 0) + 1;
          side.set(o.P, o.A);
        }
      }
    }
    this.cs = m.CS;
    this.maxBids = Math.max(this.maxBids, this.bids.size);
    this.maxAsks = Math.max(this.maxAsks, this.asks.size);
    this.remember();
  }
  top(n) {
    const bids = [...this.bids].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
    const asks = [...this.asks].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
    return { bids, asks };
  }
  remember() {
    this.history.set(this.cs, { json: JSON.stringify(this.top(20)), t: performance.now() });
    if (this.history.size > 400) this.history.delete(this.history.keys().next().value);
  }
}

const sortedDesc = (ps) => ps.every((p, i) => i === 0 || Number(ps[i - 1]) > Number(p));
const sortedAsc = (ps) => ps.every((p, i) => i === 0 || Number(ps[i - 1]) < Number(p));
const topOf = (m, n) => ({ bids: m.BO.slice(0, n).map((o) => [o.P, o.A]), asks: m.AO.slice(0, n).map((o) => [o.P, o.A]) });

async function pickPairs() {
  const t = await (await fetch(`${API}/ticker`)).json();
  const rows = t.data.map((r) => ({ pair: r.pair, quote: r.denominatorSymbol, notional: Number(r.volume) * Number(r.last) }));
  const quiet = (q) => rows.filter((r) => r.quote === q && r.notional > 0).sort((a, b) => a.notional - b.notional)[0].pair;
  return ['BTCTRY', 'BTCUSDT', 'ETHUSDT', quiet('USDT'), quiet('TRY')];
}

async function book() {
  const DURATION = 60_000;
  const pairs = await pickPairs();
  log('pairs', { pairs });

  const a = open('obdiff');
  const b = open('orderbook');
  await Promise.all([a.ready, b.ready]);
  log('open', { obdiffMs: a.info.openMs, orderbookMs: b.info.openMs, status: a.info.status, cfRay: a.info.cfRay });

  const books = new Map(pairs.map((p) => [p, new Book()]));
  const per = new Map(pairs.map((p) => [p, { snapshots: [], deltas: 0, gaps: [], tally: {}, frames: [], unorderedBids: 0, unorderedAsks: 0, emptyDeltas: 0 }]));
  const control = [];
  const sentAt = performance.now();

  a.on('message', (raw) => {
    const now = performance.now();
    const s = raw.toString();
    capture('obdiff.jsonl', `${Math.round(now - a.t0)} ${s}`);
    const [type, m] = JSON.parse(s);
    if (type === 431 || type === 432) {
      const st = per.get(m.PS);
      const bk = books.get(m.PS);
      st.frames.push(now);
      if (type === 431) {
        st.snapshots.push({ atMsAfterSub: Math.round(now - sentAt), CS: m.CS, bids: m.BO.length, asks: m.AO.length, bidsDesc: sortedDesc(m.BO.map((o) => o.P)), asksAsc: sortedAsc(m.AO.map((o) => o.P)), keys: Object.keys(m).join(',') });
        if (st.snapshots.length === 1 && m.PS === 'BTCUSDT') log('snapshot_frame', { trimmedTo3Levels: JSON.stringify([type, { ...m, AO: m.AO.slice(0, 3), BO: m.BO.slice(0, 3) }]) });
        bk.reset(m);
        return;
      }
      st.deltas += 1;
      if (m.AO.length === 0 && m.BO.length === 0) st.emptyDeltas += 1;
      if (m.BO.length > 1 && !sortedDesc(m.BO.map((o) => o.P))) st.unorderedBids += 1;
      if (m.AO.length > 1 && !sortedAsc(m.AO.map((o) => o.P))) st.unorderedAsks += 1;
      if (bk.cs === null) { st.gaps.push({ reason: 'delta_before_snapshot', CS: m.CS }); return; }
      if (m.CS !== bk.cs + 1) st.gaps.push({ expected: bk.cs + 1, got: m.CS });
      bk.apply(m, st.tally);
      const f = full.get(m.PS);
      const now2 = performance.now();
      const json = bk.history.get(bk.cs).json;
      f.pending = f.pending.filter((x) => {
        if (x.json === json) { f.fullFirstMs.push(Math.round(now2 - x.t)); return false; }
        return true;
      });
      if (st.deltas <= 1) log('first_delta', { pair: m.PS, frame: s.slice(0, 300) });
      return;
    }
    control.push({ socket: 'obdiff', atMs: Math.round(now - a.t0), frame: s.slice(0, 200) });
  });

  // The orderbook channel pushes a whole book, which checks the obdiff book built from the deltas.
  const full = new Map(pairs.map((p) => [p, { frames: [], sameCsRepeats: 0, lastCs: null, lastBody: null, identicalRepeats: 0, compared: 0, equal: 0, csShared: 0, levelsEqual: 0, levelsSeen: 0, csGap: [], pending: [], fullFirstMs: [], obdiffFirstMs: [], expired: 0, firstCs: null, lastCs2: null, firstMismatch: null, levels: [] }]));
  const b402 = { frames: 0, identical: 0, last: null };
  const b401 = { frames: 0, items: [] };
  const trades = { t421: 0, t422: 0, first421: null };
  b.on('message', (raw) => {
    const now = performance.now();
    const s = raw.toString();
    capture('orderbook.jsonl', `${Math.round(now - b.t0)} ${s}`);
    const [type, m] = JSON.parse(s);
    if (type === 431) {
      const f = full.get(m.PS);
      f.frames.push(now);
      if (!f.first) f.first = { CS: m.CS, keys: Object.keys(m).join(','), bids: m.BO.length, asks: m.AO.length, bidsDesc: sortedDesc(m.BO.map((o) => o.P)), asksAsc: sortedAsc(m.AO.map((o) => o.P)), atMsAfterSub: Math.round(now - sentAt) };
      f.levels.push([m.BO.length, m.AO.length]);
      const body = JSON.stringify([m.BO, m.AO]);
      if (m.CS === f.lastCs) f.sameCsRepeats += 1;
      if (body === f.lastBody) f.identicalRepeats += 1;
      f.lastCs = m.CS; f.lastBody = body;
      if (books.get(m.PS).history.has(m.CS)) f.csShared += 1;
      const bk = books.get(m.PS);
      if (bk.cs === null) return;
      f.firstCs ??= m.CS; f.lastCs2 = m.CS;
      // Which channel shows a given book first: an equal obdiff state already seen, or one that arrives later.
      const theirJson = JSON.stringify(topOf(m, 20));
      const seen = [...bk.history.values()].reverse().find((h) => h.json === theirJson);
      if (seen) f.obdiffFirstMs.push(Math.round(now - seen.t));
      else { f.expired += f.pending.filter((x) => now - x.t > 5000).length; f.pending = f.pending.filter((x) => now - x.t <= 5000); f.pending.push({ json: theirJson, t: now }); }
      // The two channels count ChangeSet separately, so the check is the obdiff book as it stands when the full book arrives.
      const mine = bk.top(20);
      const theirs = topOf(m, 20);
      f.compared += 1;
      if (JSON.stringify(mine) === JSON.stringify(theirs)) f.equal += 1;
      else if (!f.firstMismatch) f.firstMismatch = { fullCS: m.CS, obdiffCS: bk.cs, mine: JSON.stringify(mine).slice(0, 200), theirs: JSON.stringify(theirs).slice(0, 200) };
      const theirBids = new Map(theirs.bids), theirAsks = new Map(theirs.asks);
      f.levelsEqual += mine.bids.filter(([p, a]) => theirBids.get(p) === a).length + mine.asks.filter(([p, a]) => theirAsks.get(p) === a).length;
      f.levelsSeen += mine.bids.length + mine.asks.length;
      f.csGap.push(m.CS - bk.cs);
      return;
    }
    if (type === 402) { b402.frames += 1; if (s === b402.last) b402.identical += 1; b402.last = s; if (b402.frames === 1) log('ticker_pair_frame', { frame: s.slice(0, 500) }); return; }
    if (type === 401) { b401.frames += 1; b401.items.push(m.items?.length); if (b401.frames === 1) log('ticker_all_frame', { frame: s.slice(0, 400) }); return; }
    if (type === 421) { trades.t421 += 1; if (!trades.first421) trades.first421 = { items: m.items?.length, frame: s.slice(0, 260) }; return; }
    if (type === 422) { trades.t422 += 1; if (trades.t422 === 1) log('trade_single_frame', { frame: s.slice(0, 300) }); return; }
    control.push({ socket: 'orderbook', atMs: Math.round(now - b.t0), frame: s.slice(0, 200) });
  });

  for (const p of pairs) a.send(subFrame('obdiff', p));
  for (const p of pairs) b.send(subFrame('orderbook', p));
  b.send(subFrame('ticker', 'BTCUSDT'));
  b.send(subFrame('ticker', 'all'));
  b.send(subFrame('trade', 'BTCUSDT'));

  // Error replies, on their own socket so a refusal cannot close the measured ones.
  await sleep(1500);
  const e = open('errors');
  await e.ready;
  const errReplies = [];
  e.on('message', (raw) => errReplies.push({ atMs: Math.round(performance.now() - e.t0), frame: raw.toString().slice(0, 240) }));
  const probes = [
    ['obdiff NOPETRY', subFrame('obdiff', 'NOPETRY')],
    ['obdiff lowercase btcusdt', subFrame('obdiff', 'btcusdt')],
    ['obdiff event all', subFrame('obdiff', 'all')],
    ['channel nope', subFrame('nope', 'BTCUSDT')],
    ['obdiff BTCUSDT', subFrame('obdiff', 'BTCUSDT')],
    ['obdiff BTCUSDT again', subFrame('obdiff', 'BTCUSDT')],
    ['obdiff BTCUSDT leave', subFrame('obdiff', 'BTCUSDT', false)],
    ['obdiff event array', JSON.stringify([151, { type: 151, channel: 'obdiff', event: ['ETHTRY', 'XRPTRY'], join: true }])],
    ['type 999', JSON.stringify([999, { type: 999 }])],
    ['object not array', JSON.stringify({ type: 151, channel: 'obdiff', event: 'SOLTRY', join: true })],
    ['not json', 'hello'],
  ];
  for (const [name, frame] of probes) {
    const before = errReplies.length;
    e.send(frame);
    await sleep(900);
    const replies = errReplies.slice(before);
    const counts = {};
    for (const r of replies) { const t = r.frame.slice(1, 4); counts[t] = (counts[t] ?? 0) + 1; }
    log('error_probe', { name, replies: replies.length, counts, first: replies.filter((r) => !/^\[43[12]/.test(r.frame)).slice(0, 2).map((r) => r.frame) });
  }
  log('error_socket', { closed: e.info.closed, stillOpen: e.readyState === WebSocket.OPEN });
  e.terminate();

  // REST book against the obdiff book, read while both run.
  await sleep(Math.max(0, 30_000 - (performance.now() - sentAt)));
  for (const pair of ['BTCUSDT', 'BTCTRY']) {
    const r0 = performance.now();
    const rest = await (await fetch(`${API}/orderbook?pairSymbol=${pair}&limit=100`)).json();
    const d = rest.data;
    const bk = books.get(pair);
    const mine = bk.top(20);
    const restBids = new Map(d.bids.map(([p, s]) => [Number(p), Number(s)]));
    const restAsks = new Map(d.asks.map(([p, s]) => [Number(p), Number(s)]));
    const sameBid = mine.bids.filter(([p, s]) => restBids.get(Number(p)) === Number(s)).length;
    const sameAsk = mine.asks.filter(([p, s]) => restAsks.get(Number(p)) === Number(s)).length;
    log('rest_compare', {
      pair, restMs: Math.round(performance.now() - r0), restLevels: [d.bids.length, d.asks.length], restTsAgeMs: Date.now() - d.timestamp,
      restBidsDesc: sortedDesc(d.bids.map((x) => x[0])), restAsksAsc: sortedAsc(d.asks.map((x) => x[0])),
      top20SizeEqual: { bids: sameBid, asks: sameAsk }, wsTouch: [mine.bids[0], mine.asks[0]], restTouch: [d.bids[0], d.asks[0]],
    });
  }

  await sleep(Math.max(0, DURATION - (performance.now() - sentAt)));
  for (const p of pairs) {
    const st = per.get(p);
    const bk = books.get(p);
    const f = full.get(p);
    const gapsBetween = st.frames.slice(1).map((t, i) => Math.round(t - st.frames[i]));
    const fullGaps = f.frames.slice(1).map((t, i) => Math.round(t - f.frames[i]));
    log('obdiff_summary', {
      pair: p, snapshots: st.snapshots, deltas: st.deltas, emptyDeltas: st.emptyDeltas, gaps: st.gaps.length, firstGaps: st.gaps.slice(0, 3), tally: st.tally,
      unorderedBids: st.unorderedBids, unorderedAsks: st.unorderedAsks, csAdvance: bk.cs - st.snapshots[0]?.CS, levelsNow: [bk.bids.size, bk.asks.size], maxLevels: [bk.maxBids, bk.maxAsks],
      intervalMs: stats(gapsBetween), longestSilenceMs: gapsBetween.length ? Math.max(...gapsBetween) : null,
    });
    log('orderbook_summary', {
      pair: p, frames: f.frames.length, intervalMs: stats(fullGaps), sameCsRepeats: f.sameCsRepeats, identicalRepeats: f.identicalRepeats,
      levels: stats(f.levels.map((x) => Math.max(...x))), compared: f.compared, equalTop20: f.equal, top20LevelsEqual: `${f.levelsEqual}/${f.levelsSeen}`, csSharedWithObdiff: f.csShared, fullCsMinusObdiffCs: stats(f.csGap), fullCsAdvance: f.lastCs2 - f.firstCs, sameBookSeenOnObdiffFirstMs: stats(f.obdiffFirstMs), sameBookSeenOnFullFirstMs: stats(f.fullFirstMs), fullBooksNeverOnObdiff: f.expired + f.pending.length, firstFrame: f.first, firstMismatch: f.firstMismatch,
    });
  }
  log('ticker_trade', { tickerPairFrames: b402.frames, tickerPairIdenticalRepeats: b402.identical, tickerAllFrames: b401.frames, tickerAllItems: stats(b401.items), trades });
  log('control_frames', { frames: control.slice(0, 20) });
  log('pings', { obdiff: a.info.pings, orderbook: b.info.pings, closed: [a.info.closed, b.info.closed] });
  a.terminate();
  b.terminate();
}

async function batch() {
  const DURATION = 60_000;
  const info = await (await fetch(`${API}/server/exchangeinfo`)).json();
  const pairs = info.data.symbols.filter((s) => s.status === 'TRADING').map((s) => s.name);
  const ws = open('batch');
  await ws.ready;
  log('open', { ms: ws.info.openMs, pairs: pairs.length });
  const books = new Map();
  const acks = [];
  const snapAt = new Map();
  let frames = 0, bytes = 0, parseNs = 0n, gaps = 0, resnaps = 0, deltasBeforeSnap = 0;
  const perSecond = new Map();
  const sentAt = performance.now();
  const firstGaps = [];
  ws.on('message', (raw) => {
    const now = performance.now();
    const t = process.hrtime.bigint();
    const [type, m] = JSON.parse(raw);
    parseNs += process.hrtime.bigint() - t;
    frames += 1; bytes += raw.length;
    const sec = Math.floor((now - sentAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (type === 100) { acks.push(m); return; }
    if (type === 431) { if (snapAt.has(m.PS)) resnaps += 1; else snapAt.set(m.PS, now - sentAt); books.set(m.PS, m.CS); return; }
    if (type === 432) {
      const last = books.get(m.PS);
      if (last === undefined) { deltasBeforeSnap += 1; return; }
      if (m.CS !== last + 1) { gaps += 1; if (firstGaps.length < 5) firstGaps.push({ pair: m.PS, expected: last + 1, got: m.CS }); }
      books.set(m.PS, m.CS);
    }
  });
  for (const p of pairs) ws.send(subFrame('obdiff', p));
  log('subscribed', { frames: pairs.length, sendMs: Math.round(performance.now() - sentAt) });
  await sleep(DURATION);
  const secs = [...perSecond.entries()].filter(([s]) => s >= 5 && s < 60).map(([, n]) => n);
  const snapTimes = [...snapAt.values()];
  log('batch_summary', {
    pairs: pairs.length, acks: acks.length, acksOk: acks.filter((x) => x.ok).length, snapshots: snapAt.size, lastSnapshotMs: Math.round(Math.max(...snapTimes)),
    resnapshots: resnaps, deltasBeforeSnapshot: deltasBeforeSnap, frames, framesPerSecondAfter5s: stats(secs), bytesPerSecond: Math.round(bytes / (DURATION / 1000)),
    bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000, gaps, firstGaps, pings: ws.info.pings.length, closed: ws.info.closed,
  });
  ws.terminate();
}

async function silence() {
  const DURATION = 110_000;
  const sockets = [
    { label: 'no-sub, answers ping', opts: {}, sub: null },
    { label: 'no-sub, ignores ping', opts: { autoPong: false }, sub: null },
    { label: 'quiet obdiff, ignores ping', opts: { autoPong: false }, sub: 'quiet' },
  ];
  const t = await (await fetch(`${API}/ticker`)).json();
  const quietPair = t.data.filter((r) => r.denominatorSymbol === 'USDT' && Number(r.volume) > 0).sort((a, b) => Number(a.volume) * Number(a.last) - Number(b.volume) * Number(b.last))[0].pair;
  const opened = [];
  for (const s of sockets) {
    const ws = open(s.label, s.opts);
    await ws.ready;
    ws.frames = 0;
    ws.lastFrame = 0;
    ws.on('message', () => { ws.frames += 1; ws.lastFrame = Math.round(performance.now() - ws.t0); });
    if (s.sub) ws.send(subFrame('obdiff', quietPair));
    opened.push(ws);
    await sleep(2000);
  }
  await sleep(DURATION);
  for (const ws of opened) {
    log('silence_summary', { label: ws.info.label, quietPair: ws.info.label.includes('quiet') ? quietPair : undefined, frames: ws.frames, lastFrameMs: ws.lastFrame, pings: ws.info.pings, closed: ws.info.closed });
    ws.terminate();
  }
}

async function deflate() {
  const ws = open('deflate', { perMessageDeflate: true });
  await ws.ready;
  await sleep(1500);
  log('deflate', { extensionHeader: ws.info.extHeader, negotiated: ws.extensions, openMs: ws.info.openMs });
  ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, utc: new Date().toISOString() });
await modes[mode]();
log('end', { mode, utc: new Date().toISOString() });
process.exit(0);
