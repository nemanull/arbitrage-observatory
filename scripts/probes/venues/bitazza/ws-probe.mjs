// Bitazza WebSocket probe on the AlphaPoint gateway: Level 2 snapshot and update semantics, id order, level window, size unit, keepalive, silence, errors, and a batch of every running spot instrument on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which only asks what the server negotiates.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitazza/ws-probe.mjs [book|batch|window|silence|deflate]
//   book     SubscribeLevel2 depth 20 on five spot instruments for 45 s, Level 1, trades, a REST compare at the end, and every error case. About 55 s.
//   batch    SubscribeLevel2 depth 20 on every running instrument on one connection for 30 s. About 40 s.
//   window   BTCUSDT and SOLUSDT at depth 20 on one socket and depth 500 on another for 43 s, each book checked every 10 s against GetL2Snapshot asked on its own socket.
//   silence  three sockets that differ only in what the client sends or subscribes, for up to 120 s.
//   deflate  asks for permessage-deflate once on each gateway, and compares one snapshot from the Global and the Thailand gateway.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/bitazza/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_GLOBAL = 'wss://apexapi.bitazza.com/WSGateway/';
const WS_TH = 'wss://apexapi.bitazza.co.th/WSGateway/';
const API = 'https://apexapi.bitazza.com:8443/AP';
const OMS = 1;
const DEPTH = 20;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const stats = (xs) => (xs.length ? { n: xs.length, min: round(Math.min(...xs)), median: round(quantile(xs, 0.5)), p90: round(quantile(xs, 0.9)), max: round(Math.max(...xs)) } : { n: 0 });
const countBy = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

async function getJson(path) {
  const r = await fetch(`${API}/${path}`);
  return r.json();
}

// AlphaPoint frames carry the payload as a JSON string in `o`, and the client numbers its calls in `i`.
function open(url, { deflate = false } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  let seq = 0;
  ws.call = (n, o, m = 0) => {
    seq += 2;
    ws.send(JSON.stringify({ m, i: seq, n, o: JSON.stringify(o) }));
    return seq;
  };
  ws.opened = new Promise((resolve, reject) => {
    ws.once('upgrade', (res) => (ws.upgradeHeaders = res.headers));
    ws.once('open', () => resolve(performance.now() - t0));
    ws.once('error', reject);
  });
  return ws;
}

function parse(raw) {
  const f = JSON.parse(raw.toString('utf8'));
  let o = f.o;
  if (typeof o === 'string' && o.length) {
    try {
      o = JSON.parse(o);
    } catch {
      // Some replies are plain text inside o.
    }
  }
  return { ...f, o };
}

// A book keyed by price per side, applied the way CCXT ndax does: 0 new and 1 update store the size, 2 removes the level.
class Book {
  bids = new Map();
  asks = new Map();
  apply(e) {
    const side = e[9] === 0 ? this.bids : this.asks;
    if (e[3] === 2) side.delete(e[6]);
    else side.set(e[6], e[8]);
  }
  top(n) {
    const b = [...this.bids].sort((x, y) => y[0] - x[0]).slice(0, n);
    const a = [...this.asks].sort((x, y) => x[0] - y[0]).slice(0, n);
    return { b, a };
  }
}

function orderSteps(prices) {
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) asc++;
    else if (prices[i] < prices[i - 1]) desc++;
  }
  return { asc, desc };
}

async function pickInstruments() {
  const inst = await getJson(`GetInstruments?OMSId=${OMS}`);
  const summary = await getJson('summary');
  const vol = new Map(summary.map((s) => [s.trading_pairs.replace('_', ''), Number(s.quote_volume)]));
  const running = inst.filter((r) => r.SessionStatus === 'Running');
  const usdt = running.filter((r) => r.Product2Symbol === 'USDT').map((r) => ({ ...r, v: vol.get(r.Symbol) ?? 0 })).sort((a, b) => b.v - a.v);
  const active = usdt.filter((r) => r.v > 0);
  const bySymbol = (s) => running.find((r) => r.Symbol === s);
  return {
    all: running,
    stopped: inst.find((r) => r.SessionStatus === 'Stopped' && r.Product2Symbol === 'USDT'),
    sample: [bySymbol('BTCUSDT'), bySymbol('BTCTHB'), bySymbol('USDTTHB'), active[Math.floor(active.length / 2)], usdt.find((r) => r.v === 0)].filter(Boolean),
  };
}

async function book() {
  const { sample, stopped } = await pickInstruments();
  log('book_sample', { instruments: sample.map((r) => ({ id: r.InstrumentId, symbol: r.Symbol })) });
  const ws = open(WS_GLOBAL);
  const openMs = await ws.opened;
  log('open', { url: WS_GLOBAL, ms: round(openMs), extensions: ws.upgradeHeaders['sec-websocket-extensions'] ?? null });

  const byId = new Map(sample.map((r) => [r.InstrumentId, { symbol: r.Symbol, book: new Book(), snap: null, events: 0, entries: 0, lastArrival: null, gaps: [], idBackwards: 0, lastMaxId: null, frameMixed: 0, withinFrameNotAscending: 0, deleteThenNew: 0, actionTypes: {}, maxBids: 0, maxAsks: 0, crossed: 0, lagNew: [], bidUnordered: 0, askUnordered: 0, eventI: [] }]));
  const callNames = new Map();
  const pings = new Map();
  const pingRtt = [];
  const socketEventI = [];
  const errors = [];
  const level1 = [];
  let trades = 0;
  let serverPings = 0;
  let emptyEvents = 0;
  ws.on('ping', () => serverPings++);

  ws.on('message', (raw) => {
    const now = Date.now();
    const f = parse(raw);
    if (f.n === 'Ping' && f.m === 1) {
      pingRtt.push(performance.now() - pings.get(f.i));
      capture('ping.jsonl', raw.toString());
      return;
    }
    if (f.n === 'SubscribeLevel2' && f.m === 1 && Array.isArray(f.o)) {
      const id = f.o[0]?.[7];
      const s = byId.get(id);
      if (!s) {
        log(f.o.length ? 'snapshot_unexpected' : 'snapshot_empty', { i: f.i, call: callNames.get(f.i), entries: f.o.length, frame: raw.toString().slice(0, 200) });
        return;
      }
      if (s.snap) {
        log('snapshot_again', { symbol: s.symbol, entries: f.o.length });
      }
      s.snap = { at: now, entries: f.o.length, ids: [...new Set(f.o.map((e) => e[0]))], bids: orderSteps(f.o.filter((e) => e[9] === 0).map((e) => e[6])), asks: orderSteps(f.o.filter((e) => e[9] === 1).map((e) => e[6])), sideOrder: f.o.map((e) => e[9]).join('').replace(/(.)\1+/g, '$1'), actionTypes: countBy(f.o, (e) => e[3]), i: f.i };
      s.lastMaxId = Math.max(...f.o.map((e) => e[0]));
      for (const e of f.o) s.book.apply(e);
      capture(`snapshot-${s.symbol}.json`, raw.toString());
      return;
    }
    if (f.n === 'Level2UpdateEvent' && f.m === 3) {
      socketEventI.push(f.i);
      if (!f.o.length) emptyEvents++;
      const ids = new Set(f.o.map((e) => e[7]));
      const s = byId.get(f.o[0]?.[7]);
      if (!s) return;
      if (ids.size > 1) s.frameMixed++;
      s.eventI.push(f.i);
      s.events++;
      s.entries += f.o.length;
      if (s.lastArrival) s.gaps.push(now - s.lastArrival);
      s.lastArrival = now;
      const fid = f.o.map((e) => e[0]);
      for (let k = 1; k < fid.length; k++) if (fid[k] <= fid[k - 1]) s.withinFrameNotAscending++;
      if (s.lastMaxId != null && Math.min(...fid) <= s.lastMaxId) s.idBackwards++;
      s.lastMaxId = Math.max(s.lastMaxId ?? 0, ...fid);
      for (let k = 0; k < f.o.length; k++) {
        const e = f.o[k];
        s.actionTypes[e[3]] = (s.actionTypes[e[3]] ?? 0) + 1;
        if (e[3] === 2 && f.o[k + 1] && f.o[k + 1][3] !== 2 && f.o[k + 1][6] === e[6] && f.o[k + 1][9] === e[9]) s.deleteThenNew++;
        if (e[3] !== 2) s.lagNew.push(now - e[2]);
        s.book.apply(e);
      }
      const bp = f.o.filter((e) => e[9] === 0).map((e) => e[6]);
      const ap = f.o.filter((e) => e[9] === 1).map((e) => e[6]);
      if (orderSteps(bp).asc > 0) s.bidUnordered++;
      if (orderSteps(ap).desc > 0) s.askUnordered++;
      s.maxBids = Math.max(s.maxBids, s.book.bids.size);
      s.maxAsks = Math.max(s.maxAsks, s.book.asks.size);
      const t = s.book.top(1);
      if (t.b[0] && t.a[0] && t.b[0][0] >= t.a[0][0]) s.crossed++;
      if (s.events <= 3) capture(`delta-${s.symbol}.jsonl`, raw.toString());
      return;
    }
    if (f.n === 'SubscribeLevel1' || f.n === 'Level1UpdateEvent') {
      level1.push({ at: now, m: f.m, bid: f.o?.BestBid, ask: f.o?.BestOffer, ts: f.o?.TimeStamp });
      if (level1.length <= 2) capture('level1.jsonl', raw.toString());
      return;
    }
    if (f.n === 'SubscribeTrades' || f.n === 'TradeDataUpdateEvent') {
      trades++;
      if (trades <= 2) capture('trades.jsonl', raw.toString());
      return;
    }
    errors.push({ m: f.m, i: f.i, n: f.n, call: callNames.get(f.i), o: typeof f.o === 'string' ? f.o.slice(0, 200) : JSON.stringify(f.o).slice(0, 200) });
    capture('other.jsonl', raw.toString());
  });
  ws.on('close', (code, reason) => log('close', { code, reason: String(reason) }));

  const t0 = Date.now();
  for (const r of sample) {
    const i = ws.call('SubscribeLevel2', { OMSId: OMS, InstrumentId: r.InstrumentId, Depth: DEPTH });
    callNames.set(i, `SubscribeLevel2 ${r.Symbol}`);
  }
  callNames.set(ws.call('SubscribeLevel1', { OMSId: OMS, InstrumentId: 7 }), 'SubscribeLevel1 BTCUSDT');
  callNames.set(ws.call('SubscribeTrades', { OMSId: OMS, InstrumentId: 7, IncludeLastCount: 2 }), 'SubscribeTrades BTCUSDT');
  await sleep(2000);
  // Error cases, each named by the call id it echoes.
  callNames.set(ws.call('SubscribeLevel2', { OMSId: OMS, Symbol: 'NOPEUSDT', Depth: DEPTH }), 'SubscribeLevel2 unknown symbol');
  callNames.set(ws.call('SubscribeLevel2', { OMSId: OMS, InstrumentId: 999999, Depth: DEPTH }), 'SubscribeLevel2 unknown id');
  callNames.set(ws.call('SubscribeLevel2', { OMSId: OMS, InstrumentId: 7 }), 'SubscribeLevel2 no depth');
  callNames.set(ws.call('SubscribeLevel2', { OMSId: OMS, Symbol: 'BTCUSDT', Depth: DEPTH }), 'SubscribeLevel2 duplicate BTCUSDT');
  callNames.set(ws.call('SubscribeLevel2', { OMSId: 2, InstrumentId: 7, Depth: DEPTH }), 'SubscribeLevel2 wrong OMS');
  callNames.set(ws.call('SubscribeLevel2', { OMSId: OMS, InstrumentId: stopped.InstrumentId, Depth: DEPTH }), `SubscribeLevel2 stopped ${stopped.Symbol}`);
  callNames.set(ws.call('NoSuchFunction', {}), 'unknown function');
  ws.send('not json');
  callNames.set(ws.call('GetL2Snapshot', { OMSId: OMS, InstrumentId: 7, Depth: 2 }), 'GetL2Snapshot over the socket');

  const pingTimer = setInterval(() => {
    const i = ws.call('Ping', {});
    pings.set(i, performance.now());
  }, 15_000);
  await sleep(43_000);
  clearInterval(pingTimer);

  // The REST snapshot next to the book the socket built, level by level.
  for (const [id, s] of byId) {
    const rest = await getJson(`GetL2Snapshot?OMSId=${OMS}&InstrumentId=${id}&Depth=${DEPTH}`);
    const rb = rest.filter((e) => e[9] === 0).map((e) => [e[6], e[8]]);
    const ra = rest.filter((e) => e[9] === 1).map((e) => [e[6], e[8]]);
    const mine = s.book.top(DEPTH);
    const same = (x, y) => x.filter((l, k) => y[k] && y[k][0] === l[0] && y[k][1] === l[1]).length;
    s.restCompare = { restBids: rb.length, restAsks: ra.length, bookBids: s.book.bids.size, bookAsks: s.book.asks.size, sameBids: same(rb, mine.b), sameAsks: same(ra, mine.a), restId: rest[0]?.[0], socketLastId: s.lastMaxId, restTouch: [rb[0]?.[0], ra[0]?.[0]], bookTouch: [mine.b[0]?.[0], mine.a[0]?.[0]] };
  }
  ws.close();
  await sleep(300);

  for (const [, s] of byId) {
    const { book: _b, gaps, lagNew, eventI, ...rest } = s;
    log('book_stream', { ...rest, frameGapMs: stats(gaps), newEntryAgeAtArrivalMs: stats(lagNew), eventIFirst: eventI.slice(0, 6) });
  }
  const iSteps = socketEventI.slice(1).map((v, k) => v - socketEventI[k]);
  log('socket_event_i', { emptyEvents, events: socketEventI.length, first: socketEventI.slice(0, 10), stepCounts: countBy(iSteps, (x) => x) });
  log('level1', { frames: level1.length, first: level1.slice(0, 2), gapsMs: stats(level1.slice(1).map((x, k) => x.at - level1[k].at)) });
  log('trades', { frames: trades });
  log('ping', { rttMs: stats(pingRtt), serverProtocolPings: serverPings });
  log('errors_and_other', { frames: errors });
  log('elapsed', { s: round((Date.now() - t0) / 1000) });
}

async function batch() {
  const { all } = await pickInstruments();
  const ws = open(WS_GLOBAL);
  const openMs = await ws.opened;
  log('open', { url: WS_GLOBAL, ms: round(openMs), instruments: all.length });
  const sentAt = new Map();
  const snapAt = [];
  const perInstrument = new Map();
  const errors = [];
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  let idBackwards = 0;
  let mixedAcrossInstruments = 0;
  let lastGlobalId = 0;
  let globalIdBackwards = 0;
  const perSecond = new Map();
  const eventI = [];
  const t0 = Date.now();
  ws.on('message', (raw) => {
    const p0 = performance.now();
    const f = parse(raw);
    parseUs += (performance.now() - p0) * 1000;
    frames++;
    bytes += raw.length;
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (f.n === 'SubscribeLevel2' && f.m === 1) {
      if (Array.isArray(f.o)) snapAt.push(performance.now() - sentAt.get(f.i));
      else errors.push({ i: f.i, o: JSON.stringify(f.o).slice(0, 160) });
      return;
    }
    if (f.n === 'Ping' && f.m === 1) return;
    if (f.n === 'Level2UpdateEvent' && Array.isArray(f.o)) {
      eventI.push(f.i);
      const ids = new Set(f.o.map((e) => e[7]));
      if (ids.size > 1) mixedAcrossInstruments++;
      const id = f.o[0][7];
      const minId = Math.min(...f.o.map((e) => e[0]));
      const maxId = Math.max(...f.o.map((e) => e[0]));
      const prev = perInstrument.get(id) ?? { events: 0, lastId: 0 };
      if (minId <= prev.lastId) idBackwards++;
      if (minId <= lastGlobalId) globalIdBackwards++;
      lastGlobalId = Math.max(lastGlobalId, maxId);
      perInstrument.set(id, { events: prev.events + 1, lastId: Math.max(prev.lastId, maxId) });
      return;
    }
    errors.push({ m: f.m, n: f.n, o: JSON.stringify(f.o).slice(0, 160) });
  });
  let closed = null;
  ws.on('close', (code, reason) => (closed = { code, reason: String(reason), atS: round((Date.now() - t0) / 1000) }));
  for (const r of all) {
    const i = ws.call('SubscribeLevel2', { OMSId: OMS, InstrumentId: r.InstrumentId, Depth: DEPTH });
    sentAt.set(i, performance.now());
    await sleep(20);
  }
  log('batch_subscribed', { frames: all.length, seconds: round((Date.now() - t0) / 1000, 2) });
  const ping = setInterval(() => ws.readyState === ws.OPEN && ws.call('Ping', {}), 15_000);
  await sleep(30_000);
  clearInterval(ping);
  const secs = [...perSecond.entries()].filter(([s]) => s >= 10).map(([, n]) => n);
  const elapsed = (Date.now() - t0) / 1000;
  ws.close();
  await sleep(300);
  const ev = [...perInstrument.values()].map((x) => x.events);
  log('batch', {
    snapshots: snapAt.length, snapshotAfterSendMs: stats(snapAt), errors: errors.slice(0, 5), errorCount: errors.length, closed,
    frames, framesPerSecondAfter10s: stats(secs), kbPerSecond: round(bytes / 1024 / elapsed), bytesPerFrame: round(bytes / frames), parseUsPerFrame: round(parseUs / frames, 2),
    instrumentsWithEvents: perInstrument.size, eventsPerInstrument: stats(ev), instrumentsWithNoEvent: all.length - perInstrument.size,
    frameMixedInstruments: mixedAcrossInstruments, perInstrumentIdBackwards: idBackwards, socketWideIdBackwards: globalIdBackwards,
    eventIFirst: eventI.slice(0, 5), eventISteps: countBy(eventI.slice(1).map((v, k) => v - eventI[k]), (x) => x),
  });
}

// A depth limited subscription may leave levels behind when they fall out of the window, so both depths are checked against the whole book.
// The check asks GetL2Snapshot over the same socket, so the reply is ordered with the events the book already applied.
async function windowCheck() {
  const inst = await getJson(`GetInstruments?OMSId=${OMS}`);
  const pick = ['BTCUSDT', 'SOLUSDT'].map((s) => inst.find((r) => r.Symbol === s));
  const depths = [DEPTH, 500];
  const sockets = [];
  const eventCounts = new Map();
  for (const depth of depths) {
    const ws = open(WS_GLOBAL);
    await ws.opened;
    sockets.push(ws);
    const books = new Map();
    const lastId = new Map();
    ws.on('message', (raw) => {
      const f = parse(raw);
      if (!Array.isArray(f.o) || !f.o.length) return;
      const id = f.o[0][7];
      const maxId = Math.max(...f.o.map((e) => e[0]));
      if (f.n === 'SubscribeLevel2' && f.m === 1) {
        books.set(id, new Book());
        log('window_snapshot', { depth, instrument: id, entries: f.o.length });
      } else if (f.n === 'Level2UpdateEvent') {
        eventCounts.set(`${id}@${depth}`, (eventCounts.get(`${id}@${depth}`) ?? 0) + 1);
      } else if (f.n === 'GetL2Snapshot') {
        const book = books.get(id);
        const sb = new Map(f.o.filter((e) => e[9] === 0).map((e) => [e[6], e[8]]));
        const sa = new Map(f.o.filter((e) => e[9] === 1).map((e) => [e[6], e[8]]));
        const snapTop = { b: [...sb].sort((x, y) => y[0] - x[0]).slice(0, DEPTH), a: [...sa].sort((x, y) => x[0] - y[0]).slice(0, DEPTH) };
        const mine = book.top(DEPTH);
        const sameTop = (x, y) => x.filter((l, k) => y[k] && y[k][0] === l[0] && y[k][1] === l[1]).length;
        // A phantom is a level the socket book holds inside the snapshot's top 20 price range that the snapshot does not have at all.
        const phantoms = (side, snapSide, top, better) => {
          const edge = top[top.length - 1]?.[0];
          return [...side.keys()].filter((p) => !snapSide.has(p) && edge !== undefined && better(p, edge)).length;
        };
        log('window_compare', {
          depth, instrument: id, snapshotIdMinusBookId: maxId - (lastId.get(id) ?? 0), snapshotLevels: [sb.size, sa.size], bookLevels: [book.bids.size, book.asks.size],
          sameTop20: [sameTop(snapTop.b, mine.b), sameTop(snapTop.a, mine.a)],
          phantomInsideTop20: [phantoms(book.bids, sb, snapTop.b, (p, e) => p >= e), phantoms(book.asks, sa, snapTop.a, (p, e) => p <= e)],
          bookLevelsNotInSnapshot: [[...book.bids.keys()].filter((p) => !sb.has(p)).length, [...book.asks.keys()].filter((p) => !sa.has(p)).length],
        });
        return;
      } else {
        return;
      }
      for (const e of f.o) books.get(id).apply(e);
      lastId.set(id, Math.max(lastId.get(id) ?? 0, maxId));
    });
    for (const r of pick) ws.call('SubscribeLevel2', { OMSId: OMS, InstrumentId: r.InstrumentId, Depth: depth });
  }
  const t0 = Date.now();
  for (const at of [10, 20, 30, 40]) {
    await sleep(Math.max(0, t0 + at * 1000 - Date.now()));
    for (const ws of sockets) for (const r of pick) ws.call('GetL2Snapshot', { OMSId: OMS, InstrumentId: r.InstrumentId, Depth: 500 });
  }
  await sleep(3000);
  log('window_events', Object.fromEntries(eventCounts));
  for (const ws of sockets) ws.close();
  await sleep(300);
}

async function silence() {
  const { sample } = await pickInstruments();
  const quiet = sample[sample.length - 1];
  const cases = [
    { name: 'no_subscribe_no_send', setup: () => {} },
    { name: `subscribe_${quiet.Symbol}_no_ping`, setup: (ws) => ws.call('SubscribeLevel2', { OMSId: OMS, InstrumentId: quiet.InstrumentId, Depth: DEPTH }) },
    { name: 'no_subscribe_app_ping_30s', setup: (ws) => (ws.timer = setInterval(() => ws.call('Ping', {}), 30_000)) },
  ];
  const t0 = Date.now();
  const results = await Promise.all(
    cases.map(async (c) => {
      const ws = open(WS_GLOBAL);
      await ws.opened;
      const opened = Date.now();
      let frames = 0;
      let serverPings = 0;
      let lastFrameAt = opened;
      ws.on('message', () => {
        frames++;
        lastFrameAt = Date.now();
      });
      ws.on('ping', () => serverPings++);
      c.setup(ws);
      return new Promise((resolve) => {
        const done = (how, code) => {
          clearInterval(ws.timer);
          resolve({ case: c.name, how, code, openS: round((Date.now() - opened) / 1000, 2), frames, serverPings, longestQuietS: round((Date.now() - lastFrameAt) / 1000, 1) });
        };
        ws.on('close', (code) => done('server_or_network_close', code));
        setTimeout(() => {
          if (ws.readyState === ws.OPEN) {
            ws.removeAllListeners('close');
            ws.close();
            done('still_open_at_limit', null);
          }
        }, 120_000);
      });
    }),
  );
  for (const r of results) log('silence', r);
  log('elapsed', { s: round((Date.now() - t0) / 1000) });
}

async function deflate() {
  for (const url of [WS_GLOBAL, WS_TH]) {
    const ws = open(url, { deflate: true });
    const ms = await ws.opened;
    log('deflate_offer', { url, openMs: round(ms), negotiated: ws.upgradeHeaders['sec-websocket-extensions'] ?? null, server: ws.upgradeHeaders.server ?? null });
    ws.close();
    await sleep(300);
  }
  // Both gateways subscribed at the same instant: a shared engine gives the same id and touch.
  const snaps = await Promise.all(
    [WS_GLOBAL, WS_TH].map(async (url) => {
      const ws = open(url);
      await ws.opened;
      return new Promise((resolve) => {
        ws.on('message', (raw) => {
          const f = parse(raw);
          if (f.n === 'SubscribeLevel2' && Array.isArray(f.o)) {
            ws.close();
            const bid = f.o.find((e) => e[9] === 0);
            const ask = f.o.find((e) => e[9] === 1);
            resolve({ url, id: f.o[0][0], bid: bid?.[6], ask: ask?.[6], at: Date.now() });
          }
        });
        ws.call('SubscribeLevel2', { OMSId: OMS, InstrumentId: 7, Depth: 5 });
      });
    }),
  );
  log('gateway_compare_BTCUSDT', { snaps });
}

const modes = { book, batch, window: windowCheck, silence, deflate };
const arg = process.argv[2] ?? 'book';
if (!modes[arg]) throw new Error(`unknown mode ${arg}`);
log('start', { mode: arg, at: new Date().toISOString() });
await modes[arg]();
log('end', { at: new Date().toISOString() });
process.exit(0);
