// CoinJar Exchange WebSocket probe: the Phoenix feed's book, native_book, ticker, trades and auction channels, delta and snapshot semantics, implied levels, keepalive, silence, errors, and every product on one connection.
// Public, unauthenticated and read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node ../scripts/probes/venues/coinjar/ws-probe.mjs [book|batch|silence|deflate]
//   book     book, native_book and ticker on five products plus trades, auction, an inactive product and error joins, with request_snapshot checks and a REST compare, 70 s.
//   batch    book on every product of the catalog on one connection, 60 s.
//   silence  four sockets that differ only in what the client joins and whether it sends the heartbeat, up to 100 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames, trimmed to 2,000 characters each.
// Recorded in docs/profiles/coinjar/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_ = 'wss://feed.exchange.coinjar.com/socket/websocket';
const API = 'https://api.exchange.coinjar.com';
const DATA = 'https://data.exchange.coinjar.com';
const OUT = process.env.PROBE_OUT_DIR;
const BOOKS = ['BTC-USDT', 'ETH-USDC', 'BTCUSD', 'POL-USDT', 'BNB-USDT'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
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

function open(opts = { perMessageDeflate: false }) {
  const t0 = Date.now();
  const ws = new WebSocket(URL_, opts);
  return new Promise((resolve, reject) => {
    ws.once('upgrade', (res) => (ws.upgradeHeaders = res.headers));
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0 }));
    ws.once('error', reject);
  });
}

let refSeq = 1;
const send = (ws, topic, event, payload = {}) => {
  const ref = refSeq++;
  ws.send(JSON.stringify({ topic, event, payload, ref }));
  return ref;
};

class Side {
  constructor(desc) {
    this.m = new Map();
    this.desc = desc;
  }
  apply(levels) {
    for (const [p, s] of levels) {
      if (Number(s) === 0) this.m.delete(p);
      else this.m.set(p, s);
    }
  }
  sorted() {
    return [...this.m].sort((a, b) => (this.desc ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0])));
  }
}
const ordered = (levels, desc) => levels.every((x, i) => i === 0 || (desc ? Number(x[0]) < Number(levels[i - 1][0]) : Number(x[0]) > Number(levels[i - 1][0])));
const diff = (book, snap) => {
  let count = 0;
  for (const [side, desc] of [['bids', true], ['asks', false]]) {
    const mine = book[side].sorted().slice(0, 40);
    const theirs = snap[side];
    const n = Math.max(mine.length, theirs.length);
    for (let i = 0; i < n; i++) {
      if (!mine[i] || !theirs[i] || mine[i][0] !== theirs[i][0] || mine[i][1] !== theirs[i][1]) count++;
    }
  }
  return count;
};

async function bookMode() {
  const { ws, openMs } = await open();
  const t0 = Date.now();
  log('open', { openMs, extensions: ws.upgradeHeaders['sec-websocket-extensions'] ?? null, ray: ws.upgradeHeaders['cf-ray'] });
  const refs = new Map();
  const sentAt = new Map();
  const state = {};
  const other = {};
  const native = {};
  const joinTopics = [
    ...BOOKS.map((id) => `book:${id}`),
    ...BOOKS.slice(0, 3).map((id) => `native_book:${id}`),
    ...BOOKS.slice(0, 3).map((id) => `ticker:${id}`),
    'ticker:POL-USDT',
    'trades:BTC-USDT',
    'auction:BTC-USDT',
    'book:NOPE',
    'book:btc-usdt',
    'foo:BTC-USDT',
    'native_book:NOPE',
    'book:XRPBTC',
    'book:BTCEUR',
  ];
  for (const topic of joinTopics) {
    const ref = send(ws, topic, 'phx_join');
    refs.set(ref, topic);
    sentAt.set(ref, Date.now());
  }
  for (const id of BOOKS) state[id] = { init: null, updates: 0, empty: 0, bidOrdered: 0, askOrdered: 0, bidArrays: 0, askArrays: 0, zero: 0, repeats: 0, last: null, gaps: [], lastAt: null, maxBids: 0, maxAsks: 0, crossed: 0, keys: new Set(), snapDiffs: [], snaps: 0, book: null };
  const replies = [];
  const heartbeats = [];
  const marks = [];
  const markCheck = (id, t, source) => {
    const nb = native[id].book.bids.sorted()[0];
    const na = native[id].book.asks.sorted()[0];
    if (!nb || !na || t.last === null || t.last === false) return;
    const med = (a, b, c) => [a, b, c].sort((x, y) => x - y)[1];
    const nativeMedian = med(Number(nb[0]), Number(na[0]), Number(t.last));
    const tickerMedian = med(Number(t.bid), Number(t.ask), Number(t.last));
    marks.push({ id, source, mark: t.mark_price, last: t.last, bid: t.bid, ask: t.ask, nativeBid: nb[0], nativeAsk: na[0], markIsNativeMedian: Number(t.mark_price) === nativeMedian, markIsTickerMedian: Number(t.mark_price) === tickerMedian });
  };
  ws.on('ping', () => log('server_ping', { at: Date.now() - t0 }));
  ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    const [kind, id] = m.topic.split(':');
    capture(`book-${kind}.txt`, `${Date.now() - t0} ${text}`);
    if (m.event === 'phx_reply') {
      const topic = refs.get(m.ref) ?? m.topic;
      const ms = sentAt.has(m.ref) ? Date.now() - sentAt.get(m.ref) : null;
      if (m.topic === 'phoenix') heartbeats.push(ms);
      else replies.push({ topic, ref: m.ref, ms, status: m.payload.status, response: m.payload.response });
      return;
    }
    if (kind === 'book' && state[id]) {
      const s = state[id];
      const p = m.payload;
      Object.keys(p).forEach((k) => s.keys.add(k));
      if (m.event === 'init') {
        s.init = { at: Date.now() - t0, bids: p.bids.length, asks: p.asks.length, bidsDescending: ordered(p.bids, true), asksAscending: ordered(p.asks, false), best: [p.bids[0]?.[0] ?? null, p.asks[0]?.[0] ?? null] };
        s.book = { bids: new Side(true), asks: new Side(false) };
        s.book.bids.apply(p.bids);
        s.book.asks.apply(p.asks);
        return;
      }
      if (m.event === 'snapshot') {
        s.snaps++;
        if (s.book) s.snapDiffs.push(diff(s.book, p));
        s.book = { bids: new Side(true), asks: new Side(false) };
        s.book.bids.apply(p.bids);
        s.book.asks.apply(p.asks);
        return;
      }
      if (m.event !== 'update') {
        log('book_event', { id, event: m.event });
        return;
      }
      const now = Date.now();
      if (s.lastAt !== null) s.gaps.push(now - s.lastAt);
      s.lastAt = now;
      s.updates++;
      if (p.bids.length === 0 && p.asks.length === 0) s.empty++;
      if (p.bids.length > 1) {
        s.bidArrays++;
        if (ordered(p.bids, true)) s.bidOrdered++;
      }
      if (p.asks.length > 1) {
        s.askArrays++;
        if (ordered(p.asks, false)) s.askOrdered++;
      }
      s.zero += [...p.bids, ...p.asks].filter((l) => Number(l[1]) === 0).length;
      const key = JSON.stringify(p);
      if (key === s.last) s.repeats++;
      s.last = key;
      if (!s.book) return;
      s.book.bids.apply(p.bids);
      s.book.asks.apply(p.asks);
      s.maxBids = Math.max(s.maxBids, s.book.bids.m.size);
      s.maxAsks = Math.max(s.maxAsks, s.book.asks.m.size);
      const bb = s.book.bids.sorted()[0];
      const ba = s.book.asks.sorted()[0];
      if (bb && ba && Number(bb[0]) >= Number(ba[0])) s.crossed++;
      return;
    }
    if (kind === 'native_book') {
      const n = (native[id] ??= { init: null, updates: 0, keys: new Set(), book: null, gaps: [], lastAt: null });
      Object.keys(m.payload).forEach((k) => n.keys.add(k));
      if (m.event === 'init') {
        n.init = { bids: m.payload.bids?.length, asks: m.payload.asks?.length, best: [m.payload.bids?.[0], m.payload.asks?.[0]] };
        n.book = { bids: new Side(true), asks: new Side(false) };
        n.book.bids.apply(m.payload.bids ?? []);
        n.book.asks.apply(m.payload.asks ?? []);
      } else {
        n.updates++;
        n.events ??= {};
        n.events[m.event] = (n.events[m.event] ?? 0) + 1;
        n.sample ??= text.slice(0, 400);
        if (n.lastAt !== null) n.gaps.push(Date.now() - n.lastAt);
        n.lastAt = Date.now();
        if (n.book && m.payload.bids) {
          n.book.bids.apply(m.payload.bids);
          n.book.asks.apply(m.payload.asks ?? []);
        }
      }
      return;
    }
    if (kind === 'ticker' && native[id]?.book) markCheck(id, m.payload, 'ws');
    const k = `${m.topic} ${m.event}`;
    other[k] ??= { n: 0, keys: new Set(), sample: text.slice(0, 500) };
    other[k].n++;
    Object.keys(m.payload ?? {}).forEach((x) => other[k].keys.add(x));
  });
  let closed = null;
  ws.on('close', (code, reason) => (closed = { code, reason: String(reason), at: Date.now() - t0 }));

  const hb = setInterval(() => {
    const ref = send(ws, 'phoenix', 'heartbeat');
    sentAt.set(ref, Date.now());
  }, 20_000);
  const heartbeatAt = Date.now();
  const hbRef = send(ws, 'phoenix', 'heartbeat');
  sentAt.set(hbRef, heartbeatAt);

  await sleep(3000);
  const dup = send(ws, 'book:BTC-USDT', 'phx_join');
  refs.set(dup, 'book:BTC-USDT (second join)');
  sentAt.set(dup, Date.now());
  const bad = send(ws, 'book:XRPBTC', 'nope_event');
  refs.set(bad, 'book:XRPBTC nope_event');
  sentAt.set(bad, Date.now());
  const unjoined = send(ws, 'book:LTCBTC', 'request_snapshot');
  refs.set(unjoined, 'book:LTCBTC request_snapshot without join');
  sentAt.set(unjoined, Date.now());

  for (let i = 0; i < 4; i++) {
    await sleep(15_000);
    for (const id of BOOKS.slice(0, 4)) {
      const ref = send(ws, `book:${id}`, 'request_snapshot');
      refs.set(ref, `book:${id} request_snapshot`);
      sentAt.set(ref, Date.now());
    }
  }
  await sleep(3000);
  const rest = await (await fetch(`${DATA}/products/BTC-USDT/book?level=2&nonce=${Date.now()}`)).json();
  const restDiff = state['BTC-USDT'].book ? diff(state['BTC-USDT'].book, rest) : null;
  const restTop = [rest.bids[0], rest.asks[0]];
  const wsTop = state['BTC-USDT'].book ? [state['BTC-USDT'].book.bids.sorted()[0], state['BTC-USDT'].book.asks.sorted()[0]] : null;
  for (const id of Object.keys(native)) {
    const t = await (await fetch(`${DATA}/products/${id}/ticker?nonce=${Date.now()}`)).json();
    if (native[id].book) markCheck(id, t, 'rest');
  }
  const leaveRef = send(ws, 'book:POL-USDT', 'phx_leave');
  refs.set(leaveRef, 'book:POL-USDT phx_leave');
  sentAt.set(leaveRef, Date.now());
  await sleep(1500);
  const notJsonAt = Date.now();
  ws.send('not json');
  await sleep(1500);
  log('not_json', { closedAfterMs: closed ? closed.at - (notJsonAt - t0) : null, closed });
  clearInterval(hb);
  ws.close();
  await sleep(300);

  const byTopic = {};
  for (const r of replies) (byTopic[r.topic] ??= []).push({ status: r.status, ms: r.ms, response: r.response });
  log('replies', { byTopic });
  log('heartbeat', { replyMs: heartbeats });
  for (const id of BOOKS) {
    const s = state[id];
    log('book', {
      id,
      init: s.init,
      payloadKeys: [...s.keys],
      updates: s.updates,
      emptyUpdates: s.empty,
      repeatedIdenticalUpdates: s.repeats,
      zeroSizeLevels: s.zero,
      bidArraysOfTwoOrMore: s.bidArrays,
      bidArraysDescending: s.bidOrdered,
      askArraysOfTwoOrMore: s.askArrays,
      askArraysAscending: s.askOrdered,
      interUpdateMs: stats(s.gaps),
      maxLevelsHeld: [s.maxBids, s.maxAsks],
      crossedAfterUpdate: s.crossed,
      snapshots: s.snaps,
      snapshotDiffsTop40: s.snapDiffs,
    });
  }
  for (const [id, n] of Object.entries(native)) {
    const b = state[id]?.book;
    let nativeShare = null;
    if (b && n.book) {
      const top = [...b.bids.sorted().slice(0, 40), ...b.asks.sorted().slice(0, 40)];
      const nat = new Map([...n.book.bids.m, ...n.book.asks.m]);
      nativeShare = { levels: top.length, samePrice: top.filter(([p]) => nat.has(p)).length, sameSize: top.filter(([p, s]) => nat.get(p) === s).length };
    }
    log('native_book', { id, init: n.init, updates: n.updates, events: n.events, keys: [...n.keys], interUpdateMs: stats(n.gaps), sample: n.sample, finalNative: n.book ? [n.book.bids.m.size, n.book.asks.m.size, n.book.bids.sorted()[0], n.book.asks.sorted()[0]] : null, l2TopLevelsAlsoNative: nativeShare });
  }
  for (const [k, v] of Object.entries(other)) log('other', { topic: k, n: v.n, keys: [...v.keys], sample: v.sample });
  log('mark_check', { frames: marks.length, nativeMedian: marks.filter((x) => x.markIsNativeMedian).length, tickerMedian: marks.filter((x) => x.markIsTickerMedian).length, misses: marks.filter((x) => !x.markIsNativeMedian).slice(0, 4), sample: marks.slice(-3) });
  log('rest_compare', { id: 'BTC-USDT', differingLevelsTop40: restDiff, restTop, wsTop });
  log('closed', { closed, seconds: Math.round((Date.now() - t0) / 1000) });
}

async function batchMode() {
  const products = await (await fetch(`${API}/products`)).json();
  const ids = products.map((p) => p.id);
  const { ws, openMs } = await open();
  const t0 = Date.now();
  const joined = new Map();
  let ok = 0;
  let err = 0;
  const errors = [];
  let inits = 0;
  let firstInitAll = null;
  let frames = 0;
  let bytes = 0;
  const perSecond = new Map();
  let parseNs = 0n;
  const withInit = new Set();
  const updatesPer = new Map();
  ws.on('message', (raw) => {
    const t = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t;
    frames++;
    bytes += raw.length;
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (m.event === 'phx_reply') {
      if (m.payload.status === 'ok') ok++;
      else {
        err++;
        errors.push([m.topic, m.payload.response]);
      }
    } else if (m.event === 'init') {
      inits++;
      withInit.add(m.topic);
      if (withInit.size === ids.length) firstInitAll = Date.now() - t0;
    } else if (m.event === 'update') {
      updatesPer.set(m.topic, (updatesPer.get(m.topic) ?? 0) + 1);
    }
  });
  let closed = null;
  ws.on('close', (code, reason) => (closed = { code, reason: String(reason), at: Date.now() - t0 }));
  for (const id of ids) joined.set(send(ws, `book:${id}`, 'phx_join'), id);
  const sentMs = Date.now() - t0;
  const hb = setInterval(() => send(ws, 'phoenix', 'heartbeat'), 20_000);
  await sleep(60_000);
  clearInterval(hb);
  ws.close();
  await sleep(300);
  const rates = [...perSecond.entries()].filter(([s]) => s >= 5 && s < 60).map(([, n]) => n);
  const counts = ids.map((id) => updatesPer.get(`book:${id}`) ?? 0);
  log('batch', {
    openMs,
    topics: ids.length,
    joinsSentInMs: sentMs,
    acksOk: ok,
    acksError: err,
    errors: errors.slice(0, 5),
    inits,
    allInitsBy: firstInitAll,
    frames,
    kbPerSecond: Math.round(bytes / 60 / 1024),
    bytesPerFrame: Math.round(bytes / frames),
    framesPerSecondAfter5s: stats(rates),
    parseMicrosPerFrame: Math.round(Number(parseNs / BigInt(frames)) / 100) / 10,
    topicsWithNoUpdateIn60s: counts.filter((n) => n === 0).length,
    updatesPerTopic: stats(counts),
    closed,
  });
}

async function silenceMode() {
  const cases = [
    { name: 'no_join_no_heartbeat', join: null, heartbeatMs: 0 },
    { name: 'join_busy_no_heartbeat', join: 'book:BTC-USDT', heartbeatMs: 0 },
    { name: 'join_quiet_no_heartbeat', join: 'book:POL-USDT', heartbeatMs: 0 },
    { name: 'no_join_heartbeat_30s', join: null, heartbeatMs: 30_000 },
  ];
  const t0 = Date.now();
  const results = await Promise.all(
    cases.map(async (c) => {
      const { ws, openMs } = await open();
      const opened = Date.now();
      let frames = 0;
      let lastFrame = null;
      let pings = 0;
      ws.on('ping', () => pings++);
      ws.on('message', () => {
        frames++;
        lastFrame = Date.now() - opened;
      });
      if (c.join) send(ws, c.join, 'phx_join');
      const hb = c.heartbeatMs ? setInterval(() => send(ws, 'phoenix', 'heartbeat'), c.heartbeatMs) : null;
      const closed = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 100_000);
        ws.on('close', (code, reason) => {
          clearTimeout(timer);
          resolve({ code, reason: String(reason), afterMs: Date.now() - opened });
        });
      });
      if (hb) clearInterval(hb);
      if (!closed) ws.close();
      return { name: c.name, openMs, frames, lastFrameMs: lastFrame, serverPings: pings, closed: closed ?? 'open at 100 s' };
    }),
  );
  for (const r of results) log('silence', r);
  log('silence_done', { seconds: Math.round((Date.now() - t0) / 1000) });
}

async function deflateMode() {
  const { ws, openMs } = await open({ perMessageDeflate: true });
  log('deflate', { openMs, extensions: ws.upgradeHeaders['sec-websocket-extensions'] ?? null });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await bookMode();
else if (mode === 'batch') await batchMode();
else if (mode === 'silence') await silenceMode();
else if (mode === 'deflate') await deflateMode();
log('done', { mode, at: new Date().toISOString() });
