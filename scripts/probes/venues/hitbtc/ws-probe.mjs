// HitBTC public WebSocket v3 probe for the USDT perpetual books: snapshot and update shape, the sequence rule, level order and window, size unit against REST, the partial book and futures/info channels, pings, silence, errors and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks for it once.
// Requests are spaced at least 200 ms apart, inside the documented 10 per second on /ws/public.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hitbtc/ws-probe.mjs [book|batch|silence|errors|deflate]
//   book     orderbook/full on five perps, orderbook/D20/100ms on two, orderbook/top/100ms and futures/info, with a REST book compare at the end. About 70 s.
//   batch    orderbook/full on every working perp on one socket for 60 s, or orderbook/D20/100ms/batch with BATCH_CH=d20.
//   silence  three sockets that differ in what they subscribe and whether they answer pings, for up to 120 s.
//   errors   unknown symbol, channel, depth and speed, a duplicate, suspended, expired and empty contracts, a spot symbol, text that is not JSON. About 15 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// DURATION_S shortens the hold of book, batch and silence, so a rerun can stay inside the socket budget.
// Set PROBE_OUT_DIR to keep a capped sample of raw frames. Recorded in docs/profiles/hitbtc/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUBLIC = 'wss://api.hitbtc.com/api/3/ws/public';
const API = 'https://api.hitbtc.com/api/3';
const OUT = process.env.PROBE_OUT_DIR;
const DURATION_S = Number(process.env.DURATION_S ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const stats = (xs) => (xs.length ? { n: xs.length, min: Math.min(...xs), med: q(xs, 0.5), p90: q(xs, 0.9), max: Math.max(...xs) } : { n: 0 });
const r1 = (x) => Math.round(x * 10) / 10;
const kept = new Map();

function capture(name, text, cap = 40) {
  if (!OUT) return;
  const n = kept.get(name) ?? 0;
  if (n >= cap) return;
  kept.set(name, n + 1);
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url = URL_PUBLIC, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const ready = new Promise((resolve, reject) => {
    ws.once('open', () => resolve(r1(performance.now() - t0)));
    ws.once('error', reject);
  });
  return { ws, ready };
}

function send(ws, obj) {
  ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

async function workingPerps() {
  const sym = await (await fetch(`${API}/public/symbol`)).json();
  return Object.keys(sym).filter((k) => sym[k].type === 'futures' && sym[k].status === 'working');
}

// One book per symbol, kept from the orderbook/full snapshot and its updates.
function makeBookTracker(name) {
  const books = new Map();
  const st = {
    snapshots: {},
    snapshotLevels: {},
    snapshotZeroSizes: 0,
    updates: 0,
    updatesBySymbol: {},
    emptyUpdates: 0,
    gaps: [],
    repeatsOrBackwards: 0,
    firstUpdateAfterSnapshot: {},
    bidsNotDescending: 0,
    asksNotAscending: 0,
    snapshotBidsDescending: 0,
    snapshotAsksAscending: 0,
    frames: 0,
    multiSymbolFrames: 0,
    tAgeMs: [],
    maxGapMsBySymbol: {},
    lastAt: {},
    maxLevels: {},
    oneSided: {},
  };
  function sorted(side, desc) {
    const ps = side.map((l) => Number(l[0]));
    return ps.every((p, i) => i === 0 || (desc ? p < ps[i - 1] : p > ps[i - 1]));
  }
  function apply(book, side, levels) {
    for (const [p, s] of levels) {
      if (Number(s) === 0) book[side].delete(p);
      else book[side].set(p, s);
    }
  }
  function onFrame(msg, recvAt) {
    const kind = msg.snapshot ? 'snapshot' : msg.update ? 'update' : undefined;
    if (!kind) return false;
    st.frames++;
    const data = msg[kind];
    const ids = Object.keys(data);
    if (ids.length > 1) st.multiSymbolFrames++;
    for (const id of ids) {
      const item = data[id];
      st.tAgeMs.push(recvAt - item.t);
      const last = st.lastAt[id];
      if (last) st.maxGapMsBySymbol[id] = Math.max(st.maxGapMsBySymbol[id] ?? 0, recvAt - last);
      st.lastAt[id] = recvAt;
      const a = item.a ?? [];
      const b = item.b ?? [];
      if (kind === 'snapshot') {
        st.snapshots[id] = (st.snapshots[id] ?? 0) + 1;
        st.snapshotLevels[id] = `${b.length}b/${a.length}a`;
        st.snapshotZeroSizes += [...a, ...b].filter((l) => Number(l[1]) === 0).length;
        if (sorted(b, true)) st.snapshotBidsDescending++;
        if (sorted(a, false)) st.snapshotAsksAscending++;
        const book = { bids: new Map(), asks: new Map(), s: item.s, afterSnapshot: true };
        apply(book, 'bids', b);
        apply(book, 'asks', a);
        books.set(id, book);
        capture(`${name}-snapshot.jsonl`, JSON.stringify(msg), 6);
      } else {
        st.updates++;
        st.updatesBySymbol[id] = (st.updatesBySymbol[id] ?? 0) + 1;
        if (a.length === 0 && b.length === 0) st.emptyUpdates++;
        if (b.length > 1 && !sorted(b, true)) st.bidsNotDescending++;
        if (a.length > 1 && !sorted(a, false)) st.asksNotAscending++;
        const book = books.get(id);
        if (!book) {
          st.gaps.push(`${id}:update_before_snapshot`);
          continue;
        }
        if (book.afterSnapshot) {
          st.firstUpdateAfterSnapshot[id] = item.s - book.s;
          book.afterSnapshot = false;
        }
        if (item.s !== book.s + 1) {
          if (item.s <= book.s) st.repeatsOrBackwards++;
          else st.gaps.push(`${id}:${book.s}->${item.s}`);
        }
        book.s = item.s;
        apply(book, 'bids', b);
        apply(book, 'asks', a);
        capture(`${name}-update.jsonl`, JSON.stringify(msg), 20);
      }
      const book = books.get(id);
      st.maxLevels[id] = Math.max(st.maxLevels[id] ?? 0, book.bids.size, book.asks.size);
      if (book.bids.size === 0 || book.asks.size === 0) st.oneSided[id] = `${book.bids.size}b/${book.asks.size}a`;
    }
    return true;
  }
  function top(id, n) {
    const book = books.get(id);
    if (!book) return undefined;
    const bids = [...book.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
    const asks = [...book.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
    return { bids, asks, s: book.s };
  }
  return { st, onFrame, top, books };
}

async function book() {
  const hold = (DURATION_S || 60) * 1000;
  const fullIds = ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'SOLUSDT_PERP', 'HITUSDT_PERP', 'ZRXUSDT_PERP'];
  const { ws, ready } = open();
  const openMs = await ready;
  const t0 = Date.now();
  log('open', { url: URL_PUBLIC, openMs, extensions: ws.extensions });
  const tracker = makeBookTracker('full');
  const pings = [];
  const acks = [];
  const d20 = { frames: 0, bySymbol: {}, levels: new Set(), sDeltas: [], identicalRepeats: 0, lastBody: {}, lastS: {}, intervalMs: [], lastAt: {}, bidsDesc: 0, asksAsc: 0 };
  const top = { frames: 0, identicalRepeats: 0, last: undefined, intervalMs: [], lastAt: 0 };
  const info = { frames: 0, symbolsPerFrame: [], intervalMs: [], lastAt: 0, lastBySymbol: {}, changesBySymbol: {}, sample: undefined, tAgeMs: [] };
  const other = [];
  ws.on('ping', (d) => pings.push({ atS: r1((Date.now() - t0) / 1000), data: d.toString() }));
  ws.on('message', (raw) => {
    const recvAt = Date.now();
    const text = raw.toString();
    const msg = JSON.parse(text);
    if (msg.id !== undefined) {
      acks.push({ atMs: recvAt - t0, msg });
      capture('book-acks.jsonl', text);
      return;
    }
    if (msg.ch === 'orderbook/full') {
      tracker.onFrame(msg, recvAt);
      return;
    }
    if (msg.ch === 'orderbook/D20/100ms') {
      d20.frames++;
      capture('d20.jsonl', text, 10);
      for (const [id, item] of Object.entries(msg.data)) {
        d20.bySymbol[id] = (d20.bySymbol[id] ?? 0) + 1;
        d20.levels.add(`${item.b.length}b/${item.a.length}a`);
        const body = JSON.stringify([item.a, item.b]);
        if (d20.lastBody[id] === body) d20.identicalRepeats++;
        d20.lastBody[id] = body;
        if (d20.lastS[id] !== undefined) d20.sDeltas.push(item.s - d20.lastS[id]);
        d20.lastS[id] = item.s;
        if (d20.lastAt[id]) d20.intervalMs.push(recvAt - d20.lastAt[id]);
        d20.lastAt[id] = recvAt;
        const bp = item.b.map((l) => Number(l[0]));
        const ap = item.a.map((l) => Number(l[0]));
        if (bp.every((p, i) => i === 0 || p < bp[i - 1])) d20.bidsDesc++;
        if (ap.every((p, i) => i === 0 || p > ap[i - 1])) d20.asksAsc++;
      }
      return;
    }
    if (msg.ch === 'orderbook/top/100ms') {
      top.frames++;
      capture('top.jsonl', text, 5);
      const body = JSON.stringify({ ...msg.data.BTCUSDT_PERP, t: 0 });
      if (top.last === body) top.identicalRepeats++;
      top.last = body;
      if (top.lastAt) top.intervalMs.push(recvAt - top.lastAt);
      top.lastAt = recvAt;
      return;
    }
    if (msg.ch === 'futures/info') {
      info.frames++;
      capture('futures-info.jsonl', text.slice(0, 1500), 5);
      const ids = Object.keys(msg.data);
      info.symbolsPerFrame.push(ids.length);
      if (info.lastAt) info.intervalMs.push(recvAt - info.lastAt);
      info.lastAt = recvAt;
      for (const id of ids) {
        const row = msg.data[id];
        info.tAgeMs.push(recvAt - row.t);
        const prev = info.lastBySymbol[id];
        if (prev) {
          const ch = info.changesBySymbol[id] ?? {};
          for (const k of Object.keys(row)) if (prev[k] !== row[k]) ch[k] = (ch[k] ?? 0) + 1;
          info.changesBySymbol[id] = ch;
        }
        info.lastBySymbol[id] = row;
      }
      if (!info.sample) info.sample = msg.data.BTCUSDT_PERP;
      return;
    }
    other.push(text.slice(0, 300));
  });
  send(ws, { method: 'subscribe', ch: 'orderbook/full', params: { symbols: fullIds }, id: 1 });
  await sleep(1500);
  send(ws, { method: 'subscribe', ch: 'orderbook/D20/100ms', params: { symbols: ['BTCUSDT_PERP', 'HITUSDT_PERP'] }, id: 2 });
  await sleep(250);
  send(ws, { method: 'subscribe', ch: 'orderbook/top/100ms', params: { symbols: ['BTCUSDT_PERP'] }, id: 3 });
  await sleep(250);
  send(ws, { method: 'subscribe', ch: 'futures/info', params: { symbols: ['*'] }, id: 4 });
  await sleep(250);
  send(ws, { method: 'subscriptions', ch: 'orderbook/full', params: {}, id: 5 });
  await sleep(hold - 2250);

  // REST compare: the maintained full book against a REST depth=20 book read now.
  for (const id of ['BTCUSDT_PERP', 'HITUSDT_PERP']) {
    const rest = await (await fetch(`${API}/public/orderbook/${id}?depth=20`)).json();
    const mine = tracker.top(id, 20);
    const same = (xs, ys) => xs.filter((l, i) => ys[i] && ys[i][0] === l[0] && ys[i][1] === l[1]).length;
    log('rest_compare', {
      id,
      bidsEqual: same(rest.bid, mine.bids),
      asksEqual: same(rest.ask, mine.asks),
      restTop: { bid: rest.bid[0], ask: rest.ask[0] },
      wsTop: { bid: mine.bids[0], ask: mine.asks[0] },
    });
  }
  ws.close();
  const st = tracker.st;
  log('acks', { acks: acks.map((a) => ({ atMs: a.atMs, ...a.msg })) });
  log('full_summary', {
    holdS: hold / 1000,
    frames: st.frames,
    multiSymbolFrames: st.multiSymbolFrames,
    snapshots: st.snapshots,
    snapshotLevels: st.snapshotLevels,
    snapshotZeroSizes: st.snapshotZeroSizes,
    snapshotBidsDescending: st.snapshotBidsDescending,
    snapshotAsksAscending: st.snapshotAsksAscending,
    updates: st.updates,
    emptyUpdates: st.emptyUpdates,
    gaps: st.gaps.length,
    gapSample: st.gaps.slice(0, 5),
    repeatsOrBackwards: st.repeatsOrBackwards,
    firstUpdateMinusSnapshotS: st.firstUpdateAfterSnapshot,
    updateBidsNotDescending: st.bidsNotDescending,
    updateAsksNotAscending: st.asksNotAscending,
    maxLevelsHeld: st.maxLevels,
    oneSided: st.oneSided,
    maxSilenceMsBySymbol: st.maxGapMsBySymbol,
    tAgeMs: stats(st.tAgeMs),
  });
  log('d20_summary', {
    frames: d20.frames,
    bySymbol: d20.bySymbol,
    levelShapes: [...d20.levels],
    sDeltas: stats(d20.sDeltas),
    identicalRepeats: d20.identicalRepeats,
    intervalMs: stats(d20.intervalMs),
    bidsDescending: d20.bidsDesc,
    asksAscending: d20.asksAsc,
  });
  log('top_summary', { frames: top.frames, identicalRepeats: top.identicalRepeats, intervalMs: stats(top.intervalMs) });
  const btcCh = info.changesBySymbol.BTCUSDT_PERP ?? {};
  log('futures_info_summary', {
    frames: info.frames,
    symbolsPerFrame: stats(info.symbolsPerFrame),
    intervalMs: stats(info.intervalMs),
    tAgeMs: stats(info.tAgeMs),
    btcChanges: btcCh,
    hitChanges: info.changesBySymbol.HITUSDT_PERP ?? {},
    symbols: Object.keys(info.lastBySymbol).length,
    sample: info.sample,
  });
  log('pings', { count: pings.length, pings });
  log('other', { count: other.length, sample: other.slice(0, 5) });
}

async function batch() {
  const hold = (DURATION_S || 60) * 1000;
  const ids = await workingPerps();
  const d20 = process.env.BATCH_CH === 'd20';
  const ch = d20 ? 'orderbook/D20/100ms/batch' : 'orderbook/full';
  const { ws, ready } = open();
  const openMs = await ready;
  const t0 = Date.now();
  const tracker = makeBookTracker('batch');
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = new Map();
  const d20Symbols = {};
  let ack;
  let ackAt;
  ws.on('message', (raw) => {
    const recvAt = Date.now();
    const text = raw.toString();
    const p0 = process.hrtime.bigint();
    const msg = JSON.parse(text);
    parseNs += process.hrtime.bigint() - p0;
    if (msg.id !== undefined) {
      ack = msg;
      ackAt = recvAt - t0;
      return;
    }
    frames++;
    bytes += text.length;
    const sec = Math.floor((recvAt - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (d20) {
      for (const id of Object.keys(msg.data ?? {})) d20Symbols[id] = (d20Symbols[id] ?? 0) + 1;
      capture('batch-d20.jsonl', text, 3);
    } else tracker.onFrame(msg, recvAt);
  });
  send(ws, { method: 'subscribe', ch, params: { symbols: ids }, id: 1 });
  await sleep(hold);
  ws.close();
  const counts = [...perSecond.entries()].filter(([s]) => s >= 2).map(([, c]) => c);
  log('batch_summary', {
    ch,
    symbols: ids.length,
    openMs,
    ackAtMs: ackAt,
    ackSubscriptions: ack?.result?.subscriptions?.length,
    ackError: ack?.error,
    holdS: hold / 1000,
    frames,
    framesPerSecond: stats(counts),
    bytesPerSecond: Math.round(bytes / (hold / 1000)),
    bytesPerFrame: Math.round(bytes / Math.max(frames, 1)),
    parseUsPerFrame: r1(Number(parseNs / 1000n) / Math.max(frames, 1)),
  });
  if (d20) {
    const c = Object.values(d20Symbols);
    log('batch_d20', { symbolsSeen: c.length, updatesPerSymbol: stats(c) });
  } else {
    const st = tracker.st;
    log('batch_full', {
      snapshotSymbols: Object.keys(st.snapshots).length,
      snapshotsTotal: Object.values(st.snapshots).reduce((a, b) => a + b, 0),
      updates: st.updates,
      emptyUpdates: st.emptyUpdates,
      multiSymbolFrames: st.multiSymbolFrames,
      gaps: st.gaps.length,
      gapSample: st.gaps.slice(0, 5),
      repeatsOrBackwards: st.repeatsOrBackwards,
      oneSided: st.oneSided,
      silentSymbols: ids.filter((id) => !st.lastAt[id]),
      snapshotLevels: stats(Object.values(st.snapshotLevels).map((x) => Math.max(...x.split('/').map((y) => parseInt(y))))),
      updatesPerSymbol: stats(ids.map((id) => st.updatesBySymbol[id] ?? 0)),
      maxSilenceMs: stats(Object.values(st.maxGapMsBySymbol)),
    });
  }
}

async function silence() {
  const hold = (DURATION_S || 120) * 1000;
  const plans = [
    { name: 'idle_autopong', autoPong: true, sub: undefined },
    { name: 'idle_no_pong', autoPong: false, sub: undefined },
    { name: 'empty_book_no_pong', autoPong: false, sub: 'CELUSDT_PERP' },
  ];
  const results = await Promise.all(
    plans.map(async (p) => {
      const { ws, ready } = open(URL_PUBLIC, { autoPong: p.autoPong });
      await ready;
      const t0 = Date.now();
      const ev = { pings: [], frames: 0, lastFrameS: undefined };
      ws.on('ping', () => ev.pings.push(r1((Date.now() - t0) / 1000)));
      ws.on('message', (raw) => {
        ev.frames++;
        ev.lastFrameS = r1((Date.now() - t0) / 1000);
        if (ev.frames <= 2) ev[`frame${ev.frames}`] = raw.toString().slice(0, 300);
      });
      if (p.sub) send(ws, { method: 'subscribe', ch: 'orderbook/full', params: { symbols: [p.sub] }, id: 1 });
      const closed = await Promise.race([
        new Promise((resolve) => ws.once('close', (code, reason) => resolve({ closedAtS: r1((Date.now() - t0) / 1000), code, reason: reason.toString() }))),
        sleep(hold).then(() => ({ open: true, heldS: hold / 1000 })),
      ]);
      if (ws.readyState === WebSocket.OPEN) ws.close();
      return { name: p.name, ...closed, ...ev };
    }),
  );
  for (const r of results) log('silence', r);
}

async function errors() {
  const { ws, ready } = open();
  await ready;
  const t0 = Date.now();
  const seen = [];
  const dataBy = {};
  ws.on('message', (raw) => {
    const text = raw.toString();
    const msg = JSON.parse(text);
    if (msg.id !== undefined || msg.error) {
      seen.push({ atMs: Date.now() - t0, text: text.slice(0, 400) });
      return;
    }
    const d = msg.snapshot ?? msg.update ?? msg.data ?? {};
    for (const [id, item] of Object.entries(d)) {
      const k = `${msg.ch}|${id}`;
      if (!dataBy[k]) dataBy[k] = { frames: 0, snapshots: 0, first: JSON.stringify(item).slice(0, 200), kind: msg.snapshot ? 'snapshot' : msg.update ? 'update' : 'data' };
      dataBy[k].frames++;
      if (msg.snapshot) dataBy[k].snapshots++;
    }
  });
  let closed;
  ws.once('close', (code, reason) => (closed = { atMs: Date.now() - t0, code, reason: reason.toString() }));
  const reqs = [
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['NOPEUSDT_PERP'] }, id: 11 },
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['BTCUSDT_PERP', 'NOPEUSDT_PERP'] }, id: 12 },
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['BTCUSDT_PERP'] }, id: 13 },
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['PEPEUSDT_PERP', 'TONUSDT_PERP', 'CELUSDT_PERP'] }, id: 14 },
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['BTCUSDT'] }, id: 15 },
    { method: 'subscribe', ch: 'orderbook/D30/100ms', params: { symbols: ['BTCUSDT_PERP'] }, id: 16 },
    { method: 'subscribe', ch: 'orderbook/D20/200ms', params: { symbols: ['BTCUSDT_PERP'] }, id: 17 },
    { method: 'subscribe', ch: 'orderbook/nope', params: { symbols: ['BTCUSDT_PERP'] }, id: 18 },
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['*'] }, id: 19 },
    { method: 'nope', ch: 'orderbook/full', params: { symbols: ['BTCUSDT_PERP'] }, id: 20 },
    { method: 'subscribe', ch: 'orderbook/D20/100ms', params: { symbols: ['CELUSDT_PERP', 'PEPEUSDT_PERP'] }, id: 21 },
    { method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['btcusdt_perp'] }, id: 22 },
    { method: 'unsubscribe', ch: 'orderbook/full', params: { symbols: ['BTCUSDT_PERP'] }, id: 23 },
    'not json',
  ];
  for (const r of reqs) {
    send(ws, r);
    await sleep(400);
  }
  await sleep(6000);
  if (ws.readyState === WebSocket.OPEN) ws.close();
  for (const s of seen) log('reply', s);
  log('data_after_requests', dataBy);
  log('closed', { closed: closed ?? 'still open after the last request' });
}

async function deflate() {
  const { ws, ready } = open(URL_PUBLIC, { perMessageDeflate: true });
  await ready;
  log('deflate', { offered: 'permessage-deflate', negotiated: ws.extensions || '(none)' });
  ws.close();
  const { ws: ws2, ready: r2 } = open(URL_PUBLIC);
  ws2.on('upgrade', (res) => log('upgrade_headers', { headers: res.headers }));
  await r2;
  ws2.close();
}

const modes = { book, batch, silence, errors, deflate };
const mode = process.argv[2] ?? 'book';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
await modes[mode]();
setTimeout(() => process.exit(0), 500);
