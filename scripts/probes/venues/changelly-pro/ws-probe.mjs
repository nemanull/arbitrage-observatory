// Changelly PRO public WebSocket probe: the full book channel and its sequence, the D20 snapshot channel, top of book, futures info, ticker, error replies, a batch of every perpetual on one socket, server pings and silence, and compression.
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// The documented socket limit is 10 messages a second per IP and 100 connections per IP, and the probe sends at most 6 frames in any one second and holds at most 2 sockets at once.
// Run from server/: node ../scripts/probes/venues/changelly-pro/ws-probe.mjs [book|compare|batch|silence|deflate]
//   book     orderbook/full on four perps for 60 s with a REST compare before close, orderbook/D20/100ms, orderbook/top/100ms, futures/info, ticker/1s and error replies on a second socket, about 65 s
//   compare  every 2 s for 30 s, the REST book at 20 levels against the orderbook/full book and the last orderbook/D20/100ms frame, about 33 s
//   batch    orderbook/full on every working perpetual on one socket for 45 s
//   silence  one socket with no subscription that answers pings, and one with no subscription that does not, for up to 95 s each, run together
//   deflate  asks for permessage-deflate once and prints what the server negotiates
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/changelly-pro/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api.pro.changelly.com/api/3/ws/public';
const API = 'https://api.pro.changelly.com/api/3';
const OUT = process.env.PROBE_OUT_DIR;
const BOOK = ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'BCHUSDT_PERP', 'MANAUSDT_PERP'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const round = (x) => Math.round(x * 10) / 10;
const q = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stats = (arr) => ({ n: arr.length, min: q(arr, 0), median: q(arr, 0.5), p90: q(arr, 0.9), max: q(arr, 1) });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(extra = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, ...extra });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: round(performance.now() - t0), t0 }));
    ws.once('error', reject);
  });
}

function descending(levels) {
  for (let i = 1; i < levels.length; i++) if (Number(levels[i][0]) > Number(levels[i - 1][0])) return false;
  return true;
}

function ascending(levels) {
  for (let i = 1; i < levels.length; i++) if (Number(levels[i][0]) < Number(levels[i - 1][0])) return false;
  return true;
}

// Per symbol state of orderbook/full: the book as two maps, the last sequence, and every counter the profile quotes.
function fullBookTracker() {
  const books = new Map();
  const stat = (sym) => {
    if (!books.has(sym)) {
      books.set(sym, { bids: new Map(), asks: new Map(), last: null, snapshots: 0, snapLevels: [], snapOrdered: [], updates: 0, gaps: [], repeats: 0, emptyUpdates: 0, zeroSizes: 0, bidsUnordered: 0, asksUnordered: 0, maxBids: 0, maxAsks: 0, frameGaps: [], lastRecv: null, firstSnapMs: null, lags: [], crossed: 0 });
    }
    return books.get(sym);
  };
  const apply = (side, levels) => {
    for (const [p, s] of levels) {
      if (Number(s) === 0) side.delete(p);
      else side.set(p, s);
    }
  };
  function onFrame(msg, recvMs, subscribedAt) {
    const kind = msg.snapshot ? 'snapshot' : msg.update ? 'update' : null;
    if (!kind) return false;
    for (const [sym, b] of Object.entries(msg[kind])) {
      const st = stat(sym);
      if (st.lastRecv !== null) st.frameGaps.push(recvMs - st.lastRecv);
      st.lastRecv = recvMs;
      st.lags.push(recvMs - b.t);
      if (kind === 'snapshot') {
        st.snapshots++;
        if (st.firstSnapMs === null) st.firstSnapMs = recvMs - subscribedAt;
        st.bids = new Map();
        st.asks = new Map();
        apply(st.bids, b.b ?? []);
        apply(st.asks, b.a ?? []);
        st.snapLevels.push(`${(b.b ?? []).length}/${(b.a ?? []).length}`);
        st.snapOrdered.push(descending(b.b ?? []) && ascending(b.a ?? []));
        st.last = b.s;
      } else {
        st.updates++;
        if (st.last === null) st.gaps.push(`update before snapshot s=${b.s}`);
        else if (b.s === st.last) st.repeats++;
        else if (b.s !== st.last + 1) st.gaps.push(`${st.last} to ${b.s}`);
        st.last = b.s;
        const bb = b.b ?? [];
        const aa = b.a ?? [];
        if (bb.length === 0 && aa.length === 0) st.emptyUpdates++;
        st.zeroSizes += [...bb, ...aa].filter((l) => Number(l[1]) === 0).length;
        if (!descending(bb)) st.bidsUnordered++;
        if (!ascending(aa)) st.asksUnordered++;
        apply(st.bids, bb);
        apply(st.asks, aa);
      }
      st.maxBids = Math.max(st.maxBids, st.bids.size);
      st.maxAsks = Math.max(st.maxAsks, st.asks.size);
      const bestBid = Math.max(...[...st.bids.keys()].map(Number));
      const bestAsk = Math.min(...[...st.asks.keys()].map(Number));
      if (st.bids.size && st.asks.size && bestBid >= bestAsk) st.crossed++;
    }
    return true;
  }
  return { books, onFrame };
}

async function compareWithRest(books) {
  for (const [sym, st] of books) {
    const t0 = Date.now();
    const res = await fetch(`${API}/public/orderbook/${sym}?depth=20`);
    const rest = await res.json();
    const topBids = [...st.bids.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 20);
    const topAsks = [...st.asks.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 20);
    let same = 0;
    for (let i = 0; i < 20; i++) {
      if (rest.bid?.[i] && topBids[i] && rest.bid[i][0] === topBids[i][0] && rest.bid[i][1] === topBids[i][1]) same++;
      if (rest.ask?.[i] && topAsks[i] && rest.ask[i][0] === topAsks[i][0] && rest.ask[i][1] === topAsks[i][1]) same++;
    }
    log('rest_compare', { sym, restMs: Date.now() - t0, restTs: rest.timestamp, levelsEqualOf40: same, socketTop: [topBids[0], topAsks[0]], restTop: [rest.bid?.[0], rest.ask?.[0]] });
    await sleep(250);
  }
}

function summarize(books) {
  for (const [sym, st] of books) {
    log('full_book', {
      sym,
      snapshots: st.snapshots,
      firstSnapshotMs: st.firstSnapMs,
      snapLevels: st.snapLevels,
      snapOrdered: st.snapOrdered,
      updates: st.updates,
      gaps: st.gaps.slice(0, 5),
      gapCount: st.gaps.length,
      repeats: st.repeats,
      emptyUpdates: st.emptyUpdates,
      zeroSizes: st.zeroSizes,
      bidsUnordered: st.bidsUnordered,
      asksUnordered: st.asksUnordered,
      maxLevels: `${st.maxBids}/${st.maxAsks}`,
      crossedAfterApply: st.crossed,
      frameGapMs: stats(st.frameGaps),
      recvMinusTMs: stats(st.lags),
    });
  }
}

async function book() {
  const a = await open();
  const b = await open();
  log('open', { url: WS_URL, openMs: [a.openMs, b.openMs], extensions: [a.ws.extensions, b.ws.extensions] });
  const tracker = fullBookTracker();
  const counts = {};
  const firsts = {};
  let subscribedAt = 0;
  const pings = { a: 0, b: 0 };
  a.ws.on('ping', () => pings.a++);
  b.ws.on('ping', () => pings.b++);

  a.ws.on('message', (raw) => {
    const recvMs = Date.now();
    const text = raw.toString();
    const msg = JSON.parse(text);
    if (tracker.onFrame(msg, recvMs, subscribedAt)) {
      const kind = msg.snapshot ? 'snapshot' : 'update';
      if (!firsts[`full_${kind}`]) {
        firsts[`full_${kind}`] = true;
        capture('full.txt', text);
        const trimmed = Object.fromEntries(Object.entries(msg[kind]).map(([sym, v]) => [sym, { ...v, a: (v.a ?? []).slice(0, 3), b: (v.b ?? []).slice(0, 3) }]));
        log('frame_full_' + kind, { recvMinusSubscribeMs: recvMs - subscribedAt, levels: Object.values(msg[kind]).map((v) => `${(v.b ?? []).length}/${(v.a ?? []).length}`), trimmed: JSON.stringify({ ch: msg.ch, [kind]: trimmed }) });
      }
      return;
    }
    log('reply_a', { recvMinusSubscribeMs: recvMs - subscribedAt, text: text.slice(0, 400) });
  });

  b.ws.on('message', (raw) => {
    const recvMs = Date.now();
    const text = raw.toString();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      log('reply_b_not_json', { text: text.slice(0, 200) });
      return;
    }
    const ch = msg.ch ?? (msg.id !== undefined ? `reply#${msg.id}` : 'other');
    counts[ch] = (counts[ch] ?? 0) + 1;
    if (msg.ch && (msg.data || msg.snapshot || msg.update)) {
      const payload = msg.data ?? msg.snapshot ?? msg.update;
      if (!firsts[ch]) {
        firsts[ch] = { n: 0, levels: [], ordered: [], seq: {}, repeats: 0, lastBody: {}, lags: [], lastRecv: {}, gaps: [] };
        capture('b.txt', text);
        log('frame_' + ch, { text: text.slice(0, 500) });
      }
      const f = firsts[ch];
      f.n++;
      for (const [sym, v] of Object.entries(payload)) {
        if (typeof v?.t === 'number') f.lags.push(recvMs - v.t);
        if (f.lastRecv[sym] !== undefined) f.gaps.push(recvMs - f.lastRecv[sym]);
        f.lastRecv[sym] = recvMs;
        if (v?.b && Array.isArray(v.b)) {
          f.levels.push(`${v.b.length}/${(v.a ?? []).length}`);
          f.ordered.push(descending(v.b) && ascending(v.a ?? []));
        }
        if (v?.s !== undefined) {
          const prev = f.seq[sym];
          f.seq[sym] = { first: prev?.first ?? v.s, last: v.s, steps: (prev?.steps ?? 0) + (prev ? v.s - prev.last : 0), frames: (prev?.frames ?? 0) + 1, stalls: (prev?.stalls ?? 0) + (prev && v.s === prev.last ? 1 : 0) };
        }
        const body = JSON.stringify({ ...v, t: undefined });
        if (f.lastBody[sym] === body) f.repeats++;
        f.lastBody[sym] = body;
      }
      return;
    }
    log('reply_b', { recvMinusSubscribeMs: recvMs - subscribedAt, text: text.slice(0, 400) });
  });

  subscribedAt = Date.now();
  a.ws.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/full', params: { symbols: BOOK }, id: 1 }));
  const bFrames = [
    { method: 'subscribe', ch: 'orderbook/D20/100ms', params: { symbols: BOOK }, id: 11 },
    { method: 'subscribe', ch: 'orderbook/top/100ms', params: { symbols: ['BTCUSDT_PERP', 'MANAUSDT_PERP'] }, id: 12 },
    { method: 'subscribe', ch: 'futures/info', params: { symbols: ['BTCUSDT_PERP', 'BCHUSDT_PERP'] }, id: 13 },
    { method: 'subscribe', ch: 'ticker/1s', params: { symbols: ['BTCUSDT_PERP'] }, id: 14 },
    { method: 'subscribe', ch: 'orderbook/D20/100ms/batch', params: { symbols: ['ETHUSDT_PERP', 'MANAUSDT_PERP'] }, id: 15 },
  ];
  for (const f of bFrames) b.ws.send(JSON.stringify(f));
  await sleep(1500);
  // Error cases on the second socket, spaced to stay under 10 messages a second.
  const errorFrames = [
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['NOPE_PERP'] }, id: 21 },
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['LUNAUSDT_PERP'] }, id: 22 },
    { method: 'subscribe', ch: 'orderbook/D30/100ms', params: { symbols: ['BTCUSDT_PERP'] }, id: 23 },
    { method: 'subscribe', ch: 'orderbook/nope', params: { symbols: ['BTCUSDT_PERP'] }, id: 24 },
    { method: 'nope', ch: 'orderbook/full', params: { symbols: ['BTCUSDT_PERP'] }, id: 25 },
    { method: 'subscribe', ch: 'orderbook/D20/100ms', params: { symbols: ['BTCUSDT_PERP'] }, id: 26 },
    { method: 'subscriptions', ch: 'orderbook/D20/100ms', params: {}, id: 27 },
  ];
  for (const f of errorFrames) {
    b.ws.send(JSON.stringify(f));
    await sleep(250);
  }
  b.ws.send('not json');
  await sleep(1000);
  a.ws.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['BTCUSDT_PERP'] }, id: 2 }));
  await sleep(55_000);
  const closed = { a: a.ws.readyState, b: b.ws.readyState };
  await compareWithRest(tracker.books);
  a.ws.send(JSON.stringify({ method: 'unsubscribe', ch: 'orderbook/full', params: { symbols: ['MANAUSDT_PERP'] }, id: 3 }));
  await sleep(500);
  a.ws.terminate();
  b.ws.terminate();
  summarize(tracker.books);
  for (const [ch, f] of Object.entries(firsts)) {
    if (typeof f !== 'object') continue;
    log('channel', { ch, frames: f.n, levels: [...new Set(f.levels)].slice(0, 6), orderedAll: f.ordered.every(Boolean), repeatsOfSameBody: f.repeats, seq: f.seq, recvMinusTMs: stats(f.lags), perSymbolGapMs: stats(f.gaps) });
  }
  log('book_session', { counts, pings, readyStateBeforeClose: closed });
}

async function batch() {
  const res = await fetch(`${API}/public/symbol`);
  const symbols = Object.entries(await res.json()).filter(([, m]) => m.type === 'futures' && m.status === 'working').map(([id]) => id);
  const c = await open();
  const tracker = fullBookTracker();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = new Map();
  let subscribedAt = Date.now();
  let ack = null;
  c.ws.on('message', (raw) => {
    const recvMs = Date.now();
    frames++;
    bytes += raw.length;
    const t0 = process.hrtime.bigint();
    const msg = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t0;
    const sec = Math.floor((recvMs - subscribedAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (!tracker.onFrame(msg, recvMs, subscribedAt)) ack = raw.toString().slice(0, 600);
  });
  subscribedAt = Date.now();
  c.ws.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/full', params: { symbols }, id: 1 }));
  await sleep(45_000);
  c.ws.terminate();
  const rates = [...perSecond.entries()].filter(([s]) => s >= 1 && s < 45).map(([, n]) => n);
  let gaps = 0;
  let updates = 0;
  const snaps = [];
  for (const [, st] of tracker.books) {
    gaps += st.gaps.length;
    updates += st.updates;
    snaps.push(st.firstSnapMs);
  }
  log('batch', { symbols: symbols.length, openMs: c.openMs, ack, booksSeen: tracker.books.size, updates, gaps, snapshotArrivalMs: stats(snaps.filter((x) => x !== null)), framesPerSecond: stats(rates), frames, kbPerSecond: round(bytes / 45 / 1024), bytesPerFrame: Math.round(bytes / frames), parseMicrosPerFrame: round(Number(parseNs) / frames / 1000) });
  for (const [sym, st] of tracker.books) log('batch_book', { sym, updates: st.updates, gaps: st.gapCount ?? st.gaps.length, maxFrameGapMs: st.frameGaps.length ? Math.max(...st.frameGaps) : null, levels: `${st.maxBids}/${st.maxAsks}`, crossed: st.crossed });
}

// Every 2 s for 30 s, reads the REST book at 20 levels and compares it with the orderbook/full book and the last orderbook/D20/100ms frame held at that moment.
async function compare() {
  const full = await open();
  const d20 = await open();
  const tracker = fullBookTracker();
  const lastD20 = new Map();
  full.ws.on('message', (raw) => tracker.onFrame(JSON.parse(raw.toString()), Date.now(), 0));
  d20.ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.data) for (const [sym, v] of Object.entries(msg.data)) lastD20.set(sym, v);
  });
  full.ws.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/full', params: { symbols: BOOK }, id: 1 }));
  d20.ws.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/D20/100ms', params: { symbols: BOOK }, id: 1 }));
  await sleep(2000);
  const tally = {};
  for (let i = 0; i < 15; i++) {
    const sym = BOOK[i % BOOK.length];
    const res = await fetch(`${API}/public/orderbook/${sym}?depth=20`);
    const rest = await res.json();
    const st = tracker.books.get(sym);
    const fb = [...st.bids.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 20);
    const fa = [...st.asks.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 20);
    const d = lastD20.get(sym);
    const eq = (x, y) => {
      let n = 0;
      for (let k = 0; k < 20; k++) if (x?.[k] && y?.[k] && x[k][0] === y[k][0] && x[k][1] === y[k][1]) n++;
      return n;
    };
    const row = { restVsFull: eq(rest.bid, fb) + eq(rest.ask, fa), restVsD20: eq(rest.bid, d?.b) + eq(rest.ask, d?.a), fullVsD20: eq(fb, d?.b) + eq(fa, d?.a) };
    tally[sym] = [...(tally[sym] ?? []), `${row.restVsFull}/${row.restVsD20}/${row.fullVsD20}`];
    if (i < 4) log('compare_top', { sym, rest: [rest.bid?.[0], rest.ask?.[0]], full: [fb[0], fa[0]], d20: [d?.b?.[0], d?.a?.[0]], restTs: rest.timestamp, d20T: d ? new Date(d.t).toISOString() : null });
    await sleep(2000);
  }
  full.ws.terminate();
  d20.ws.terminate();
  log('compare', { note: 'equal levels of 40, as REST vs full / REST vs D20 / full vs D20', tally });
}

async function silenceOne(name, options) {
  const t0 = Date.now();
  const c = await open(options);
  const pings = [];
  let frames = 0;
  c.ws.on('ping', () => pings.push(Date.now() - t0));
  c.ws.on('message', () => frames++);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      c.ws.terminate();
      resolve({ name, openMs: c.openMs, closed: false, heldMs: Date.now() - t0, pingsAtMs: pings, frames });
    }, 95_000);
    c.ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ name, openMs: c.openMs, closed: true, code, reason: reason.toString(), closedAtMs: Date.now() - t0, pingsAtMs: pings, frames });
    });
  });
}

async function silence() {
  const results = await Promise.all([silenceOne('no_subscription_answers_pings', {}), silenceOne('no_subscription_ignores_pings', { autoPong: false })]);
  for (const r of results) log('silence', r);
}

async function deflate() {
  const c = await open({ perMessageDeflate: true });
  const header = await new Promise((resolve) => {
    c.ws.once('upgrade', () => {});
    resolve(c.ws.extensions);
  });
  let first = null;
  c.ws.on('message', (raw) => {
    if (!first) first = raw.toString().slice(0, 200);
  });
  c.ws.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/top/1000ms', params: { symbols: ['BTCUSDT_PERP'] }, id: 1 }));
  await sleep(2500);
  c.ws.terminate();
  log('deflate', { openMs: c.openMs, negotiatedExtensions: header || '(none)', firstFrame: first });
}

const mode = process.argv[2] ?? 'book';
if (mode === 'book') await book();
if (mode === 'batch') await batch();
if (mode === 'silence') await silence();
if (mode === 'deflate') await deflate();
if (mode === 'compare') await compare();
