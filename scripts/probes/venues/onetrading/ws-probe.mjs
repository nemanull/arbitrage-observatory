// One Trading WebSocket probe: the ORDER_BOOK channel on the dated futures, its unum counters, depth, level order, a REST compare, the other public channels, errors, keepalive and silence.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/onetrading/ws-probe.mjs [book|depth|channels|silence|deflate]
//   book      ORDER_BOOK depth 0 on every active DATED_FUTURE for 75 s, with 18 REST level 2 reads compared at equal unum. About 80 s.
//   depth     ORDER_BOOK at depth 5, 20 and 0 on BTC_USD_P and ADA_USD_P, three sockets for 30 s.
//   channels  BOOK_TICKER, PRICE_TICKS, MARKET_TICKER, then unknown, closed, replaced and updated subscriptions and bad frames. About 60 s.
//   silence   four sockets that differ only in what the client sends or subscribes, for 120 s, or SILENCE_MS.
//   deflate   offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/onetrading/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://streams.fast.onetrading.com';
const API = 'https://api.onetrading.com/fast/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(label, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  ws.t0 = t0;
  ws.label = label;
  ws.on('upgrade', (res) => {
    ws.openMs = Date.now() - t0;
    ws.ext = res.headers['sec-websocket-extensions'] ?? null;
    ws.ray = res.headers['cf-ray'] ?? null;
  });
  ws.on('unexpected-response', (_req, res) => log('refused', { label, status: res.statusCode }));
  ws.on('error', (e) => log('error', { label, message: e.message }));
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

async function datedFutures() {
  const res = await fetch(`${API}/instruments`);
  const rows = await res.json();
  return rows.filter((r) => r.type === 'DATED_FUTURE' && r.state === 'ACTIVE').map((r) => r.id);
}

const sub = (name, extra = {}) => JSON.stringify({ type: 'SUBSCRIBE', channels: [{ name, ...extra }] });

function newBook() {
  return { bids: new Map(), asks: new Map() };
}

function topLevels(b) {
  const bids = [...b.bids.entries()].map(([p, q]) => [Number(p), Number(q)]).sort((x, y) => y[0] - x[0]).slice(0, 10);
  const asks = [...b.asks.entries()].map(([p, q]) => [Number(p), Number(q)]).sort((x, y) => x[0] - y[0]).slice(0, 10);
  return JSON.stringify({ bids, asks });
}

function orderOk(levels, desc) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (desc ? b >= a : b <= a) return false;
  }
  return true;
}

async function book() {
  const ids = await datedFutures();
  log('instruments', { count: ids.length, ids });
  const ws = await open('book');
  log('open', { ms: ws.openMs, ext: ws.ext, ray: ws.ray });
  const st = new Map(ids.map((id) => [id, {
    snaps: 0, updates: 0, changes: 0, emptyChanges: 0, snapBids: 0, snapAsks: 0, snapOrder: null,
    snapUnum: null, snapUnumSplit: null, firstUpdUnum: null, unumSteps: {}, unumSplit: 0, lastUnum: null,
    updOrderBad: 0, maxBids: 0, maxAsks: 0, crossed: 0, oneSided: 0, lastArrive: null, maxGapMs: 0,
    lagMs: [], snapAgeMs: null, book: newBook(), hist: new Map(),
  }]));
  const heartbeats = [];
  let subSent = 0;
  let bytes = 0;
  let frames = 0;
  let parseUs = 0;
  ws.on('message', (d) => {
    const arrive = Date.now();
    const text = d.toString();
    bytes += text.length;
    frames++;
    const p0 = process.hrtime.bigint();
    const m = JSON.parse(text);
    parseUs += Number(process.hrtime.bigint() - p0) / 1000;
    if (m.type === 'HEARTBEAT') { heartbeats.push(arrive - ws.t0); capture('book-heartbeat.jsonl', text); return; }
    if (m.type === 'SUBSCRIPTIONS') { log('ack', { ms: arrive - subSent, frame: text.slice(0, 300) }); capture('book-ack.jsonl', text); return; }
    const s = st.get(m.instrument_code);
    if (!s) { log('other', { frame: text.slice(0, 300) }); return; }
    if (s.lastArrive !== null) s.maxGapMs = Math.max(s.maxGapMs, arrive - s.lastArrive);
    s.lastArrive = arrive;
    const tMs = Number(BigInt(m.time) / 1000000n);
    if (m.type === 'ORDER_BOOK_SNAPSHOT') {
      s.snaps++;
      s.snapBids = m.bids.length;
      s.snapAsks = m.asks.length;
      s.snapOrder = `${orderOk(m.bids, true) ? 'bids desc' : 'bids NOT desc'}, ${orderOk(m.asks, false) ? 'asks asc' : 'asks NOT asc'}`;
      s.snapUnum = m.unum_bids ?? null;
      s.snapUnumSplit = m.unum_bids !== m.unum_asks;
      s.snapAgeMs = arrive - tMs;
      s.snapSinceSubMs = arrive - subSent;
      s.lastUnum = m.unum_bids ?? null;
      s.book = newBook();
      for (const [p, q] of m.bids) s.book.bids.set(p, q);
      for (const [p, q] of m.asks) s.book.asks.set(p, q);
      if (s.snaps === 1) capture('book-snapshot.jsonl', text);
    } else if (m.type === 'ORDER_BOOK_UPDATE') {
      s.updates++;
      s.lagMs.push(arrive - tMs);
      s.changes += m.changes.length;
      if (m.changes.length === 0) s.emptyChanges++;
      if (m.unum_bids !== m.unum_asks) s.unumSplit++;
      if (s.firstUpdUnum === null) s.firstUpdUnum = m.unum_bids;
      if (s.lastUnum !== null) {
        const step = m.unum_bids - s.lastUnum;
        const key = step === 1 ? '+1' : step === 0 ? '0' : step < 0 ? 'negative' : '>1';
        s.unumSteps[key] = (s.unumSteps[key] ?? 0) + 1;
      }
      s.lastUnum = m.unum_bids;
      const buys = m.changes.filter((c) => c[0] === 'BUY').map((c) => [c[1], c[2]]);
      const sells = m.changes.filter((c) => c[0] === 'SELL').map((c) => [c[1], c[2]]);
      if (!orderOk(buys, true) || !orderOk(sells, false)) s.updOrderBad++;
      for (const [side, p, q] of m.changes) {
        const map = side === 'BUY' ? s.book.bids : s.book.asks;
        if (Number(q) === 0) map.delete(p); else map.set(p, q);
      }
      if (s.updates <= 3) capture('book-update.jsonl', text);
      s.hist.set(m.unum_bids, topLevels(s.book));
      if (s.hist.size > 3000) s.hist.delete(s.hist.keys().next().value);
    } else {
      log('unknown_type', { frame: text.slice(0, 300) });
      return;
    }
    s.maxBids = Math.max(s.maxBids, s.book.bids.size);
    s.maxAsks = Math.max(s.maxAsks, s.book.asks.size);
    const bb = Math.max(...[...s.book.bids.keys()].map(Number));
    const ba = Math.min(...[...s.book.asks.keys()].map(Number));
    if (s.book.bids.size === 0 || s.book.asks.size === 0) s.oneSided++;
    else if (bb >= ba) s.crossed++;
  });
  let closed = null;
  ws.on('close', (code) => { closed = code; });
  subSent = Date.now();
  ws.send(sub('ORDER_BOOK', { depth: 0, instrument_codes: ids }));
  // REST level 2 carries the same unum as the socket's updates, so each read is compared with the socket book at that unum.
  const compares = [];
  for (let k = 0; k < 6; k++) {
    await sleep(12_000);
    for (const id of ['BTC_USD_P', 'ETH_USD_P', 'ADA_USD_P']) {
      const rest = await (await fetch(`${API}/order-book/${id}?level=2`)).json();
      compares.push({ id, rest });
    }
  }
  await sleep(3_000);
  log('socket', { closedEarly: closed, frames, kb: Math.round(bytes / 1024), framesPerSec: +(frames / 75).toFixed(1), meanParseUs: +(parseUs / frames).toFixed(1) });
  const hbGaps = heartbeats.slice(1).map((t, i) => t - heartbeats[i]);
  log('heartbeats', { count: heartbeats.length, firstMs: heartbeats[0], gapsMs: [Math.min(...hbGaps), Math.max(...hbGaps)] });
  for (const [id, s] of st) {
    const lag = s.lagMs.sort((a, b) => a - b);
    log('instrument', {
      id, snaps: s.snaps, snapLevels: [s.snapBids, s.snapAsks], snapOrder: s.snapOrder, snapAgeMs: s.snapAgeMs, snapSinceSubMs: s.snapSinceSubMs,
      snapUnum: s.snapUnum, firstUpdUnum: s.firstUpdUnum, firstUpdMinusSnap: s.firstUpdUnum - s.snapUnum, snapUnumSplit: s.snapUnumSplit, updates: s.updates, changes: s.changes,
      emptyChanges: s.emptyChanges, unumSteps: s.unumSteps, unumSplit: s.unumSplit, updOrderBad: s.updOrderBad,
      maxLevels: [s.maxBids, s.maxAsks], crossed: s.crossed, oneSided: s.oneSided, maxGapMs: s.maxGapMs,
      lagMs: lag.length ? [lag[0], lag[Math.floor(lag.length / 2)], lag[lag.length - 1]] : null,
    });
  }
  for (const { id, rest } of compares) {
    const s = st.get(id);
    const ws10 = s.hist.get(rest.unum_bids);
    const r10 = JSON.stringify({ bids: rest.bids.slice(0, 10).map((l) => [Number(l.price), Number(l.amount)]), asks: rest.asks.slice(0, 10).map((l) => [Number(l.price), Number(l.amount)]) });
    log('rest_compare', { id, restUnum: rest.unum_bids, restLevels: [rest.bids.length, rest.asks.length], wsHasUnum: ws10 !== undefined, top10Identical: ws10 === undefined ? null : ws10 === r10 });
  }
  ws.close(1000);
}

async function depth() {
  const socks = [];
  for (const d of [5, 20, 0]) {
    const ws = await open(`depth${d}`);
    const s = { snapLevels: {}, maxLevels: {}, books: {}, updates: 0, deletesOutside: 0 };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'ORDER_BOOK_SNAPSHOT') {
        s.snapLevels[m.instrument_code] = [m.bids.length, m.asks.length];
        s.books[m.instrument_code] = { bids: new Map(m.bids), asks: new Map(m.asks) };
      } else if (m.type === 'ORDER_BOOK_UPDATE') {
        s.updates++;
        const b = s.books[m.instrument_code];
        if (!b) return;
        for (const [side, p, q] of m.changes) {
          const map = side === 'BUY' ? b.bids : b.asks;
          if (Number(q) === 0) { if (!map.has(p)) s.deletesOutside++; map.delete(p); } else map.set(p, q);
        }
        const prev = s.maxLevels[m.instrument_code] ?? [0, 0];
        s.maxLevels[m.instrument_code] = [Math.max(prev[0], b.bids.size), Math.max(prev[1], b.asks.size)];
      } else if (m.type !== 'HEARTBEAT') {
        log('frame', { label: ws.label, frame: JSON.stringify(m).slice(0, 300) });
      }
    });
    ws.send(sub('ORDER_BOOK', { depth: d, instrument_codes: ['BTC_USD_P', 'ADA_USD_P'] }));
    socks.push([d, ws, s]);
  }
  await sleep(30_000);
  for (const [d, ws, s] of socks) {
    log('depth', { depth: d, snapLevels: s.snapLevels, maxLevelsHeld: s.maxLevels, updates: s.updates, deletesOfUnknownLevel: s.deletesOutside });
    ws.close(1000);
  }
}

async function channels() {
  const ws = await open('channels');
  const seen = {};
  let phase = 'start';
  const bookUpdates = {}; // phase label to instrument to ORDER_BOOK_UPDATE count
  ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    const key = m.type ?? (m.error ? 'error' : 'none');
    seen[key] = (seen[key] ?? 0) + 1;
    if (m.type === 'ORDER_BOOK_UPDATE') {
      bookUpdates[phase] ??= {};
      bookUpdates[phase][m.instrument_code] = (bookUpdates[phase][m.instrument_code] ?? 0) + 1;
    }
    if (m.type === 'PRICE_TICK_HISTORY') {
      log('price_tick_history', { at: Date.now() - ws.t0, instrument: m.instrument_code, ticks: m.history.length, oldest: new Date(m.history[0].time / 1e6).toISOString(), newest: new Date(m.history.at(-1).time / 1e6).toISOString() });
      return;
    }
    if (m.type === 'ORDER_BOOK_SNAPSHOT') {
      log('snapshot', { at: Date.now() - ws.t0, phase, instrument: m.instrument_code, levels: [m.bids.length, m.asks.length], unum: m.unum_bids ?? null });
      return;
    }
    if (seen[key] <= 2 || key === 'error' || key === 'SUBSCRIPTIONS' || key === 'SUBSCRIPTION_UPDATED' || key === 'UNSUBSCRIBED') {
      log('frame', { at: Date.now() - ws.t0, frame: text.slice(0, 500) });
      capture('channels.jsonl', text);
    }
  });
  ws.on('close', (code, reason) => log('close', { at: Date.now() - ws.t0, code, reason: reason.toString() }));
  const ob = (codes) => sub('ORDER_BOOK', { depth: 0, instrument_codes: codes });
  const steps = [
    ['BOOK_TICKER, no instrument list', sub('BOOK_TICKER'), 2500],
    ['BOOK_TICKER BTC_USD_P and ETH_USD_P', sub('BOOK_TICKER', { instrument_codes: ['BTC_USD_P', 'ETH_USD_P'] }), 8000],
    ['PRICE_TICKS BTC_USD_P and ADA_USD_P', sub('PRICE_TICKS', { instrument_codes: ['BTC_USD_P', 'ADA_USD_P'] }), 4000],
    ['MARKET_TICKER INLINE', sub('MARKET_TICKER', { price_points_mode: 'INLINE', instrument_codes: ['BTC_USD_P', 'ETH_USD_P'] }), 12000],
    ['ORDER_BOOK unknown NOPE_USD_P', ob(['NOPE_USD_P']), 2500],
    ['ORDER_BOOK closed BTC_EUR_P', ob(['BTC_EUR_P']), 3000],
    ['ORDER_BOOK SOL_USD_P', ob(['SOL_USD_P']), 4000],
    ['ORDER_BOOK BTC_USD_P as a second SUBSCRIBE', ob(['BTC_USD_P']), 5000],
    ['UPDATE_SUBSCRIPTION to BTC_USD_P and ETH_USD_P', JSON.stringify({ type: 'UPDATE_SUBSCRIPTION', channels: [{ name: 'ORDER_BOOK', depth: 0, instrument_codes: ['BTC_USD_P', 'ETH_USD_P'] }] }), 4000],
    ['two channels in one SUBSCRIBE', JSON.stringify({ type: 'SUBSCRIBE', channels: [{ name: 'PRICE_TICKS', instrument_codes: ['ETH_USD_P'] }, { name: 'ORDER_BOOK', depth: 0, instrument_codes: ['SOL_USD_P'] }] }), 2500],
    ['unknown channel FOO', sub('FOO'), 2500],
    ['UNSUBSCRIBE PRICE_TICKS', JSON.stringify({ type: 'UNSUBSCRIBE', channels: ['PRICE_TICKS'] }), 2500],
    ['unknown type HELLO', JSON.stringify({ type: 'HELLO' }), 2500],
    ['text that is not JSON', 'not json', 3000],
  ];
  for (const [label, frame, waitMs] of steps) {
    log('send', { at: Date.now() - ws.t0, label });
    if (ws.readyState !== ws.OPEN) { log('skipped', { label, reason: 'socket closed' }); continue; }
    phase = label;
    ws.send(frame);
    await sleep(waitMs);
  }
  log('seen', { seen });
  log('book_updates_by_phase', { bookUpdates });
  if (ws.readyState === ws.OPEN) ws.close(1000);
}

async function silence() {
  const specs = [
    ['bare', {}],
    ['bare+protocol-ping-20s', { ping: 20_000 }],
    ['orderbook-BTC', { subscribe: true }],
    ['orderbook-BTC+protocol-ping-20s', { subscribe: true, ping: 20_000 }],
  ];
  const results = [];
  await Promise.all(specs.map(async ([label, o]) => {
    const ws = await open(label);
    const r = { label, heartbeats: [], pongs: 0, frames: 0, closedAt: null, code: null };
    results.push(r);
    ws.on('pong', () => r.pongs++);
    ws.on('ping', () => { r.serverPings = (r.serverPings ?? 0) + 1; });
    ws.on('message', (raw) => {
      r.frames++;
      const m = JSON.parse(raw.toString());
      if (m.type === 'HEARTBEAT') r.heartbeats.push(Date.now() - ws.t0);
    });
    ws.on('close', (code) => { r.closedAt = Date.now() - ws.t0; r.code = code; });
    if (o.subscribe) ws.send(sub('ORDER_BOOK', { depth: 0, instrument_codes: ['BTC_USD_P'] }));
    let t = null;
    if (o.ping) t = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping(); }, o.ping);
    await sleep(Number(process.env.SILENCE_MS ?? 120_000));
    if (t) clearInterval(t);
    if (ws.readyState === ws.OPEN) ws.close(1000);
  }));
  for (const r of results) {
    const gaps = r.heartbeats.slice(1).map((x, i) => x - r.heartbeats[i]);
    log('silence', { label: r.label, frames: r.frames, heartbeats: r.heartbeats.length, firstHeartbeatMs: r.heartbeats[0] ?? null, heartbeatGapMs: gaps.length ? [Math.min(...gaps), Math.max(...gaps)] : null, pongs: r.pongs, serverPings: r.serverPings ?? 0, closedAtMs: r.closedAt, code: r.code });
  }
}

async function deflate() {
  const ws = await open('deflate', { deflate: true });
  log('deflate', { offered: true, negotiated: ws.ext, openMs: ws.openMs });
  ws.close(1000);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, depth, channels, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
