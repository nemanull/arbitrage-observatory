// CEX.IO Spot Trading public WebSocket probe: the order book channel, seqId chain, level order and window, keepalive, silence, errors, compression, a batch of books on one socket, and the legacy ws.cex.io socket.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks once to see what the server negotiates.
// Every subscribe costs one point of the documented 100 points a minute per IP, so no mode sends more than 45 requests.
// Run from server/: node ../scripts/probes/venues/cex/ws-probe.mjs [book|batch|silence|errors|deflate|legacy]
//   book [pair]       order_book_subscribe on five pairs for 60 s with a ping every 5 s, trade_subscribe on one, and one REST book compared with the kept book. About 65 s, 8 points.
//   batch             order_book_subscribe on 30 USD, USDT and USDC pairs in one burst on one socket for 45 s. About 50 s, 30 points.
//   silence [seconds] three sockets that differ only in what the client sends or subscribes, for up to 75 s by default. The 2026-09-23 run used 110.
//   errors            one socket each for an unknown pair, a lowercase pair, a slash pair, a missing oid, a duplicate subscribe with an unsubscribe, text that is not JSON, and an unsupported method. About 35 s.
//   deflate           asks for permessage-deflate once and prints what the server negotiates.
//   legacy            the older wss://ws.cex.io/ws socket that CCXT Pro 4.5.68 uses: its greeting, a public tickers room and an unauthenticated order-book-subscribe. About 20 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/cex/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://trade.cex.io/api/spot/ws-public';
const LEGACY_URL = 'wss://ws.cex.io/ws';
const API = 'https://trade.cex.io/api/spot/rest-public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
let oidCounter = 0;
const oid = (e) => `${Date.now()}_${++oidCounter}_${e}`;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url, { deflate = false, label = 'ws' } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const s = { ws, t0, label, frames: [], openMs: null, closed: null, bytes: 0 };
  ws.on('upgrade', (res) => {
    s.extensions = res.headers['sec-websocket-extensions'] ?? null;
    s.cfRay = res.headers['cf-ray'] ?? null;
  });
  ws.on('open', () => (s.openMs = Math.round(performance.now() - t0)));
  ws.on('message', (data, isBinary) => {
    const text = data.toString('utf8');
    s.bytes += data.length;
    const at = performance.now() - t0;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    s.frames.push({ at, text, json, isBinary });
    capture(`${label}.jsonl`, text);
    s.onFrame?.(json, text, at);
  });
  ws.on('ping', () => (s.serverPings = (s.serverPings ?? 0) + 1));
  ws.on('close', (code, reason) => (s.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }));
  ws.on('error', (e) => (s.error = e.message));
  return s;
}

const opened = (s) =>
  new Promise((resolve, reject) => {
    if (s.ws.readyState === WebSocket.OPEN) return resolve();
    s.ws.once('open', resolve);
    s.ws.once('error', reject);
    s.ws.once('unexpected-response', (req, res) => reject(new Error(`unexpected response ${res.statusCode}`)));
  });

const send = (s, obj) => s.ws.readyState === WebSocket.OPEN && s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
const subscribe = (s, pair) => send(s, { e: 'order_book_subscribe', oid: oid('order_book_subscribe'), data: { pair } });

async function restBook(pair) {
  const res = await fetch(API + '/get_order_book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair }) });
  return { status: res.status, json: await res.json().catch(() => undefined) };
}

// Keeps one book per pair from order_book_subscribe and order_book_increment, and counts what the template asks for.
function bookKeeper() {
  const books = {};
  const stats = {};
  const st = (pair) =>
    (stats[pair] ??= {
      snapshots: 0,
      snapshotBids: [],
      snapshotAsks: [],
      snapshotBidsDescending: true,
      snapshotAsksAscending: true,
      snapshotAtMs: [],
      increments: 0,
      gaps: 0,
      lower: 0,
      emptyIncrements: 0,
      noChangeIncrements: 0,
      deleteLevels: 0,
      unorderedBidArrays: 0,
      unorderedAskArrays: 0,
      maxBids: 0,
      maxAsks: 0,
      maxGapMs: 0,
      intervals: [],
      wallMsInSecond: [],
      lastAt: null,
      numberTypes: new Set(),
      extraKeys: new Set(),
      crossed: 0,
    });
  const apply = (side, levels, s) => {
    let changed = false;
    for (const [p, q] of levels) {
      s.numberTypes.add(typeof p + '/' + typeof q);
      const size = Number(q);
      const prev = side.get(p);
      if (size === 0) {
        s.deleteLevels++;
        if (prev !== undefined) changed = true;
        side.delete(p);
      } else {
        if (prev !== size) changed = true;
        side.set(p, size);
      }
    }
    return changed;
  };
  const sorted = (m, desc) => [...m.entries()].map(([p, q]) => [Number(p), q]).sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0]));
  const onFrame = (json, at) => {
    if (!json || (json.e !== 'order_book_subscribe' && json.e !== 'order_book_increment')) return false;
    const d = json.data ?? {};
    if (!d.pair) return false;
    const s = st(d.pair);
    for (const k of Object.keys(d)) if (!['seqId', 'pair', 'bids', 'asks'].includes(k)) s.extraKeys.add(k);
    if (s.lastAt !== null) {
      s.maxGapMs = Math.max(s.maxGapMs, Math.round(at - s.lastAt));
      s.intervals.push(at - s.lastAt);
    }
    s.lastAt = at;
    s.wallMsInSecond.push(Date.now() % 1000);
    const bids = d.bids ?? [];
    const asks = d.asks ?? [];
    if (json.e === 'order_book_subscribe') {
      s.snapshots++;
      s.snapshotAtMs.push(Math.round(at));
      s.snapshotBids.push(bids.length);
      s.snapshotAsks.push(asks.length);
      if (!bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]))) s.snapshotBidsDescending = false;
      if (!asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]))) s.snapshotAsksAscending = false;
      books[d.pair] = { bids: new Map(), asks: new Map(), seq: d.seqId };
      apply(books[d.pair].bids, bids, s);
      apply(books[d.pair].asks, asks, s);
      return true;
    }
    s.increments++;
    const b = books[d.pair];
    if (!b) return true;
    if (d.seqId !== b.seq + 1) {
      if (d.seqId <= b.seq) s.lower++;
      else s.gaps++;
    }
    b.seq = d.seqId;
    if (bids.length === 0 && asks.length === 0) s.emptyIncrements++;
    if (!bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]))) s.unorderedBidArrays++;
    if (!asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]))) s.unorderedAskArrays++;
    const c1 = apply(b.bids, bids, s);
    const c2 = apply(b.asks, asks, s);
    if (!c1 && !c2 && (bids.length || asks.length)) s.noChangeIncrements++;
    s.maxBids = Math.max(s.maxBids, b.bids.size);
    s.maxAsks = Math.max(s.maxAsks, b.asks.size);
    const bb = sorted(b.bids, true)[0];
    const ba = sorted(b.asks, false)[0];
    if (bb && ba && bb[0] >= ba[0]) s.crossed++;
    return true;
  };
  const summary = () =>
    Object.fromEntries(
      Object.entries(stats).map(([pair, s]) => [
        pair,
        {
          ...s,
          numberTypes: [...s.numberTypes],
          extraKeys: [...s.extraKeys],
          lastAt: undefined,
          intervals: undefined,
          wallMsInSecond: undefined,
          intervalMs: s.intervals.length ? { min: Math.round(Math.min(...s.intervals)), median: Math.round(median(s.intervals)), max: Math.round(Math.max(...s.intervals)), under900: s.intervals.filter((x) => x < 900).length } : null,
          arrivalMsInWallSecond: s.wallMsInSecond.length ? { min: Math.min(...s.wallMsInSecond), median: median(s.wallMsInSecond), max: Math.max(...s.wallMsInSecond) } : null,
          finalBids: books[pair]?.bids.size,
          finalAsks: books[pair]?.asks.size,
          seq: books[pair]?.seq,
        },
      ]),
    );
  return { onFrame, summary, books, sorted, stats };
}

function startPing(s, everyMs) {
  const pings = [];
  const timer = setInterval(() => {
    pings.push(performance.now());
    send(s, { e: 'ping' });
  }, everyMs);
  s.pongRtts = [];
  s.onPong = () => {
    const t = pings.shift();
    if (t) s.pongRtts.push(Math.round(performance.now() - t));
  };
  return timer;
}

function otherEvents(s) {
  const counts = {};
  for (const f of s.frames) counts[f.json?.e ?? (f.json ? 'no_e' : 'not_json')] = (counts[f.json?.e ?? (f.json ? 'no_e' : 'not_json')] ?? 0) + 1;
  return counts;
}

async function book() {
  // The fifth pair had no bid in get_ticker on 2026-09-23, to see what a one-sided book sends. Pass another as the second argument.
  const pairs = ['BTC-USD', 'ETH-USDT', 'XRP-USD', 'MSTRX-USDC', process.argv[3] ?? 'COW-USD'];
  const s = open(WS_URL, { label: 'book' });
  const k = bookKeeper();
  const trades = [];
  s.onFrame = (json, text, at) => {
    if (json?.e === 'pong') s.onPong?.();
    if (json?.e === 'trade_subscribe' || json?.e === 'tradeHistorySnapshot' || json?.e === 'tradeUpdate' || (json?.e ?? '').startsWith('trade')) trades.push({ at, text: text.slice(0, 400) });
    k.onFrame(json, at);
  };
  await opened(s);
  await sleep(300);
  log('book_open', { openMs: s.openMs, cfRay: s.cfRay, extensions: s.extensions, first: s.frames[0]?.text, firstAtMs: s.frames[0] && Math.round(s.frames[0].at) });
  const subAt = {};
  for (const pair of pairs) {
    subAt[pair] = performance.now() - s.t0;
    subscribe(s, pair);
  }
  send(s, { e: 'trade_subscribe', oid: oid('trade_subscribe'), data: { pair: 'BTC-USD' } });
  send(s, { e: 'get_ticker', oid: oid('get_ticker'), data: { pairs: ['BTC-USD'] } });
  const ping = startPing(s, 5000);
  await sleep(60_000);
  clearInterval(ping);
  const summary = k.summary();
  for (const pair of pairs) if (summary[pair]) summary[pair].snapshotAfterSubscribeMs = summary[pair].snapshotAtMs.map((t) => Math.round(t - subAt[pair]));
  const acks = s.frames.filter((f) => f.json?.e === 'order_book_subscribe').map((f) => ({ ok: f.json.ok, oid: f.json.oid, seqId: f.json.data?.seqId, pair: f.json.data?.pair, bids: f.json.data?.bids?.length, asks: f.json.data?.asks?.length }));
  log('book_acks', { acks });
  for (const [pair, v] of Object.entries(summary)) log('book_pair', { pair, ...v, snapshotAtMs: undefined });
  log('book_events', { counts: otherEvents(s), bytes: s.bytes, frames: s.frames.length, serverPings: s.serverPings ?? 0, pongRtts: s.pongRtts, closed: s.closed });
  log('book_trades', { count: trades.length, first: trades.slice(0, 3) });
  const tick = s.frames.find((f) => f.json?.e === 'get_ticker');
  log('book_ticker', { text: tick?.text.slice(0, 400) });
  const firstInc = s.frames.find((f) => f.json?.e === 'order_book_increment' && f.json.data?.pair === 'BTC-USD');
  const snap = s.frames.find((f) => f.json?.e === 'order_book_subscribe' && f.json.data?.pair === 'BTC-USD');
  log('book_samples', { snapshotHead: snap?.text.slice(0, 500), incrementHead: firstInc?.text.slice(0, 500) });

  // Top of the kept BTC-USD book against one REST book read right after.
  const kept = k.books['BTC-USD'];
  const r = await restBook('BTC-USD');
  if (kept && r.json?.data) {
    const kb = k.sorted(kept.bids, true);
    const ka = k.sorted(kept.asks, false);
    const rb = r.json.data.bids;
    const ra = r.json.data.asks;
    let bidPriceEq = 0;
    let bidSizeEq = 0;
    let askPriceEq = 0;
    let askSizeEq = 0;
    const n = 20;
    for (let i = 0; i < n; i++) {
      if (kb[i] && rb[i] && kb[i][0] === Number(rb[i][0])) {
        bidPriceEq++;
        if (kb[i][1] === Number(rb[i][1])) bidSizeEq++;
      }
      if (ka[i] && ra[i] && ka[i][0] === Number(ra[i][0])) {
        askPriceEq++;
        if (ka[i][1] === Number(ra[i][1])) askSizeEq++;
      }
    }
    log('book_vs_rest', { restStatus: r.status, restBids: rb.length, restAsks: ra.length, keptBids: kb.length, keptAsks: ka.length, top20: { bidPriceEq, bidSizeEq, askPriceEq, askSizeEq }, keptTop: [kb[0], ka[0]], restTop: [rb[0], ra[0]] });
  } else {
    log('book_vs_rest', { restStatus: r.status });
  }
  s.ws.close();
  await sleep(300);
}

async function batch() {
  // A fixed list of 30 pairs from the USD, USDT and USDC books, picked from the 2026-09-23 catalog, so the mode spends no REST point.
  const pairs = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'LTC-USD', 'LINK-USD', 'AVAX-USD', 'DOT-USD', 'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'ADA-USDT', 'DOGE-USDT', 'TRX-USDT', 'LINK-USDT', 'SHIB-USDT', 'PEPE-USDT', 'BTC-USDC', 'ETH-USDC', 'SOL-USDC', 'XRP-USDC', 'ADA-USDC', 'ATOM-USD', 'NEAR-USD', 'UNI-USD', 'BCH-USD', 'XLM-USD'];
  const s = open(WS_URL, { label: 'batch' });
  const k = bookKeeper();
  let parseUs = 0;
  let parsed = 0;
  const perSecond = new Map();
  const errors = [];
  s.onFrame = (json, text, at) => {
    const t = performance.now();
    JSON.parse(text);
    parseUs += (performance.now() - t) * 1000;
    parsed++;
    const sec = Math.floor(at / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (json?.e === 'pong') s.onPong?.();
    if (json?.data?.error || json?.error) errors.push(text.slice(0, 300));
    k.onFrame(json, at);
  };
  await opened(s);
  await sleep(300);
  const t0 = performance.now();
  for (const pair of pairs) subscribe(s, pair);
  const ping = startPing(s, 5000);
  const start = performance.now();
  await sleep(45_000);
  clearInterval(ping);
  const summary = k.summary();
  const snapshotted = Object.values(summary).filter((v) => v.snapshots > 0);
  const lastSnapshotMs = Math.max(...snapshotted.map((v) => Math.max(...v.snapshotAtMs))) - (t0 - s.t0);
  const totals = snapshotted.reduce(
    (a, v) => ({ increments: a.increments + v.increments, gaps: a.gaps + v.gaps, lower: a.lower + v.lower, empty: a.empty + v.emptyIncrements, noChange: a.noChange + v.noChangeIncrements, crossed: a.crossed + v.crossed }),
    { increments: 0, gaps: 0, lower: 0, empty: 0, noChange: 0, crossed: 0 },
  );
  const secs = [...perSecond.entries()].filter(([sec]) => sec * 1000 > start - s.t0 + 2000).map(([, n]) => n);
  const snapBids = snapshotted.map((v) => v.snapshotBids[0]);
  const snapAsks = snapshotted.map((v) => v.snapshotAsks[0]);
  log('batch', {
    pairs: pairs.length,
    snapshotted: snapshotted.length,
    lastSnapshotAfterFirstSubscribeMs: Math.round(lastSnapshotMs),
    ...totals,
    framesPerSecondMedian: median(secs),
    framesPerSecondMax: Math.max(...secs),
    bytesPerSecond: Math.round(s.bytes / 45),
    bytesPerFrame: Math.round(s.bytes / s.frames.length),
    parseUsPerFrame: Math.round((parseUs / parsed) * 10) / 10,
    snapshotBidsMin: Math.min(...snapBids),
    snapshotBidsMax: Math.max(...snapBids),
    snapshotAsksMin: Math.min(...snapAsks),
    snapshotAsksMax: Math.max(...snapAsks),
    maxGapMsMax: Math.max(...snapshotted.map((v) => v.maxGapMs)),
    quietest: snapshotted.map((v, i) => [Object.keys(summary)[i], v.increments]).sort((a, b) => a[1] - b[1]).slice(0, 5),
    busiest: snapshotted.map((v, i) => [Object.keys(summary)[i], v.increments]).sort((a, b) => b[1] - a[1]).slice(0, 3),
    missing: pairs.filter((p) => !summary[p]),
    errors: errors.slice(0, 5),
    events: otherEvents(s),
    closed: s.closed,
    pongRtts: s.pongRtts,
  });
  s.ws.close();
  await sleep(300);
}

async function silence() {
  const a = open(WS_URL, { label: 'silence_nothing' });
  const b = open(WS_URL, { label: 'silence_subscribed' });
  const c = open(WS_URL, { label: 'silence_ping' });
  await Promise.all([opened(a), opened(b), opened(c)]);
  subscribe(b, 'ADA-USD');
  const ping = startPing(c, 5000);
  c.onFrame = (json) => json?.e === 'pong' && c.onPong?.();
  const capMs = Number(process.argv[3] ?? 75) * 1000;
  const t0 = performance.now();
  while (performance.now() - t0 < capMs && [a, b, c].some((s) => !s.closed)) await sleep(250);
  clearInterval(ping);
  for (const s of [a, b, c]) {
    const tail = s.frames.slice(-2).map((f) => ({ atMs: Math.round(f.at), text: f.text.slice(0, 120) }));
    log('silence', { label: s.label, openMs: s.openMs, frames: s.frames.length, events: otherEvents(s), closed: s.closed ?? `open at ${capMs / 1000} s`, serverPings: s.serverPings ?? 0, tail, pongRtts: s.pongRtts });
    if (!s.closed) s.ws.close();
  }
  await sleep(300);
}

async function errorsMode() {
  const cases = [
    ['unknown_pair', [{ e: 'order_book_subscribe', oid: oid('x'), data: { pair: 'NOPE-USD' } }]],
    ['lowercase_pair', [{ e: 'order_book_subscribe', oid: oid('x'), data: { pair: 'btc-usd' } }]],
    ['slash_pair', [{ e: 'order_book_subscribe', oid: oid('x'), data: { pair: 'BTC/USD' } }]],
    ['missing_oid', [{ e: 'order_book_subscribe', data: { pair: 'ADA-USD' } }]],
    ['duplicate_then_unsubscribe', [{ e: 'order_book_subscribe', oid: oid('a'), data: { pair: 'ADA-USD' } }, { e: 'order_book_subscribe', oid: oid('b'), data: { pair: 'ADA-USD' } }, { e: 'order_book_unsubscribe', oid: oid('c'), data: { pair: 'ADA-USD' } }]],
    ['not_json', ['this is not json']],
    ['unsupported_method', [{ e: 'nope_method', oid: oid('x'), data: {} }]],
  ];
  for (const [name, frames] of cases) {
    const s = open(WS_URL, { label: `errors_${name}` });
    await opened(s);
    await sleep(300);
    const sentAt = performance.now() - s.t0;
    for (const f of frames) {
      send(s, f);
      await sleep(400);
    }
    const ping = startPing(s, 3000);
    await sleep(3500);
    clearInterval(ping);
    const replies = s.frames.filter((f) => f.at >= sentAt && f.json?.e !== 'pong').map((f) => ({ atMs: Math.round(f.at - sentAt), text: f.text.slice(0, 260) }));
    log('error_case', { name, replies: replies.slice(0, 6), replyCount: replies.length, events: otherEvents(s), closed: s.closed ?? null });
    if (!s.closed) s.ws.close();
    await sleep(300);
  }
}

async function deflate() {
  const s = open(WS_URL, { deflate: true, label: 'deflate' });
  await opened(s);
  await sleep(1500);
  log('deflate', { url: WS_URL, offered: 'permessage-deflate', negotiated: s.extensions ?? null, openMs: s.openMs, first: s.frames[0]?.text });
  s.ws.close();
  const l = open(LEGACY_URL, { deflate: true, label: 'deflate_legacy' });
  await opened(l).catch((e) => log('deflate_legacy_error', { error: e.message }));
  await sleep(1500);
  log('deflate', { url: LEGACY_URL, offered: 'permessage-deflate', negotiated: l.extensions ?? null, openMs: l.openMs, first: l.frames[0]?.text });
  l.ws.close();
  await sleep(300);
}

async function legacy() {
  const s = open(LEGACY_URL, { label: 'legacy' });
  s.onFrame = (json) => {
    if (json?.e === 'ping') send(s, { e: 'pong' });
  };
  try {
    await opened(s);
  } catch (e) {
    log('legacy_error', { error: e.message });
    return;
  }
  await sleep(1000);
  log('legacy_open', { openMs: s.openMs, cfRay: s.cfRay, first: s.frames.slice(0, 2).map((f) => f.text.slice(0, 200)) });
  send(s, { e: 'subscribe', rooms: ['tickers'] });
  send(s, { e: 'order-book-subscribe', data: { pair: ['BTC', 'USD'], subscribe: true, depth: 0 }, oid: oid('order-book-subscribe') });
  await sleep(15_000);
  const byEvent = {};
  for (const f of s.frames) {
    const e = f.json?.e ?? 'other';
    (byEvent[e] ??= []).push(f.text.slice(0, 260));
  }
  log('legacy', { events: Object.fromEntries(Object.entries(byEvent).map(([e, l]) => [e, { count: l.length, first: l[0] }])), serverPings: s.serverPings ?? 0, closed: s.closed ?? null });
  s.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, errors: errorsMode, deflate, legacy };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
