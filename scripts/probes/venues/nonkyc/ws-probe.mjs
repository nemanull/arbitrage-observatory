// NonKYC perpetuals WebSocket probe. perp.nonkyc.io is the Orderly builder `nonkyc`, so its book is Orderly's public stream.
// Measures the book topics (snapshot, deltas, the prevTs chain, level order, a rebuilt book against later snapshots), the anchor topics, errors, keepalive, silence, a batch of every shared market on one socket, and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode which asks once.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/nonkyc/ws-probe.mjs [book|batch|cap|silence|deflate|spot]
//   book     three markets, snapshot and delta topics, anchor topics and error cases on one socket for 60 s.
//   batch    every shared PERP_<BASE>_USDC market, snapshot and delta topics, on one socket for 45 s.
//   cap      the same 160 topics in a burst, paced at 25 ms, and split over two sockets, about 6 s each.
//   silence  two unsubscribed sockets for up to 120 s, one answers the server ping and one does not.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   spot     opens the NonKYC spot socket once and closes it, to record access only.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/nonkyc/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

// The only served path segment, hardcoded in the Orderly SDK, in the perp.nonkyc.io bundle and in CCXT Pro woofipro.js line 82.
const WS_URL = 'wss://ws-evm.orderly.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY';
const SPOT_WS = 'wss://ws.nonkyc.io';
const API = 'https://api.orderly.org';
const SHARED = /^PERP_[A-Z0-9]+_USDC$/;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};

let captured = 0;
function capture(name, text) {
  if (!OUT || captured > 400) return;
  captured++;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 1500) + '\n');
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

const sorted = (xs, dir) => xs.every((l, i) => i === 0 || (dir < 0 ? l[0] < xs[i - 1][0] : l[0] > xs[i - 1][0]));

function applyLevels(side, levels) {
  for (const [p, q] of levels) {
    if (q === 0) side.delete(p);
    else side.set(p, q);
  }
}
const top = (side, dir, n) => [...side.entries()].sort((a, b) => (dir < 0 ? b[0] - a[0] : a[0] - b[0])).slice(0, n);

// Rebuilds the book from the first snapshot and the delta chain, and compares it with every later snapshot at the same ts.
function replay(snaps, deltas) {
  if (!snaps.length) return { snapshots: 0 };
  const byPrev = new Map(deltas.map((d) => [d.prevTs, d]));
  const deltaTs = new Set(deltas.map((d) => d.ts));
  const s0 = snaps[0];
  const bids = new Map(s0.bids);
  const asks = new Map(s0.asks);
  let ts = s0.ts;
  let applied = 0;
  let equal = 0;
  let differ = 0;
  let unreached = 0;
  const later = new Map(snaps.slice(1).map((s) => [s.ts, s]));
  for (;;) {
    const d = byPrev.get(ts);
    if (!d) break;
    applyLevels(bids, d.bids);
    applyLevels(asks, d.asks);
    applied++;
    ts = d.ts;
    const s = later.get(ts);
    if (s) {
      const same = JSON.stringify(top(bids, -1, 20)) === JSON.stringify(s.bids.slice(0, 20)) && JSON.stringify(top(asks, 1, 20)) === JSON.stringify(s.asks.slice(0, 20));
      if (same) equal++;
      else differ++;
      later.delete(ts);
    }
  }
  for (const s of later.values()) if (s.ts > ts) unreached++;
  return {
    snapshots: snaps.length,
    snapshotTsOnDeltaChain: snaps.filter((s) => deltaTs.has(s.ts)).length,
    firstSnapshotDepth: [s0.bids.length, s0.asks.length],
    deltasApplied: applied,
    laterSnapshotsTop20Equal: equal,
    laterSnapshotsTop20Differ: differ,
    laterSnapshotsAfterChainEnd: unreached,
  };
}

async function book() {
  const markets = ['PERP_BTC_USDC', 'PERP_ETH_USDC', 'PERP_WOO_USDC'];
  const { ws, openMs } = await open(WS_URL);
  log('open', { url: WS_URL, openMs });
  const t0 = Date.now();
  const snaps = new Map(markets.map((m) => [m, []]));
  const deltas = new Map(markets.map((m) => [m, []]));
  const lastTs = new Map();
  const gaps = new Map(markets.map((m) => [m, 0]));
  const firstFrameMs = {};
  const order = { snapBidsDesc: 0, snapAsksAsc: 0, snaps: 0, deltaBidsDesc: 0, deltaAsksAsc: 0, deltas: 0, emptyDeltas: 0, numberTypes: new Set() };
  const topicFrames = {};
  const pings = [];
  const acks = [];
  let pongMs = null;
  let pingSentAt = 0;
  const subAt = {};
  const firstSeen = new Set();

  ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString('utf8');
    let f;
    try {
      f = JSON.parse(text);
    } catch {
      log('non_json_frame', { text: text.slice(0, 200) });
      return;
    }
    if (f.event === 'ping') {
      pings.push(now - t0);
      ws.send(JSON.stringify({ event: 'pong', ts: now }));
      if (pings.length <= 2) capture('ping.txt', text);
      return;
    }
    if (f.event === 'pong') {
      pongMs = now - pingSentAt;
      capture('pong.txt', text);
      return;
    }
    if (f.topic === undefined) log('control_frame', { text: text.slice(0, 250), depth: f.data?.bids ? [f.data.bids.length, f.data.asks.length] : undefined });
    if (f.event && f.id) {
      acks.push({ id: f.id, event: f.event, success: f.success, errorMsg: f.errorMsg, afterSubMs: subAt[f.id] ? now - subAt[f.id] : null, hasData: f.data !== undefined });
      capture('acks.txt', text);
      return;
    }
    const topic = f.topic ?? 'none';
    topicFrames[topic] = (topicFrames[topic] ?? 0) + 1;
    if (!firstSeen.has(topic)) {
      firstSeen.add(topic);
      firstFrameMs[topic] = subAt[topic] ? now - subAt[topic] : null;
      capture('first-frames.txt', text);
    }
    const [sym, kind] = topic.split('@');
    if (kind === 'orderbook' && snaps.has(sym)) {
      const d = f.data;
      order.snaps++;
      if (sorted(d.bids, -1)) order.snapBidsDesc++;
      if (sorted(d.asks, 1)) order.snapAsksAsc++;
      order.numberTypes.add(`${typeof d.bids[0]?.[0]}/${typeof d.bids[0]?.[1]}`);
      order.maxSnapDepth = Math.max(order.maxSnapDepth ?? 0, d.bids.length, d.asks.length);
      snaps.get(sym).push({ ts: f.ts, bids: d.bids, asks: d.asks, at: now });
    } else if (kind === 'orderbookupdate' && deltas.has(sym)) {
      const d = f.data;
      order.deltas++;
      if (!d.bids.length && !d.asks.length) order.emptyDeltas++;
      if (sorted(d.bids, -1)) order.deltaBidsDesc++;
      if (sorted(d.asks, 1)) order.deltaAsksAsc++;
      const prev = lastTs.get(sym);
      if (prev !== undefined && d.prevTs !== prev) gaps.set(sym, gaps.get(sym) + 1);
      lastTs.set(sym, f.ts);
      deltas.get(sym).push({ ts: f.ts, prevTs: d.prevTs, bids: d.bids, asks: d.asks, at: now });
      if (deltas.get(sym).length === 3) capture('delta.txt', text);
    }
  });
  const closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString() })));

  const send = (obj) => {
    subAt[obj.id] = Date.now();
    if (obj.topic) subAt[obj.topic] = Date.now();
    ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  };
  for (const m of markets) {
    send({ id: `u-${m}`, event: 'subscribe', topic: `${m}@orderbookupdate` });
  }
  await sleep(1500);
  for (const m of markets) {
    send({ id: `s-${m}`, event: 'subscribe', topic: `${m}@orderbook` });
  }
  send({ id: 'bbo-btc', event: 'subscribe', topic: 'PERP_BTC_USDC@bbo' });
  send({ id: 'markprices', event: 'subscribe', topic: 'markprices' });
  send({ id: 'indexprices', event: 'subscribe', topic: 'indexprices' });
  send({ id: 'est-btc', event: 'subscribe', topic: 'PERP_BTC_USDC@estfundingrate' });
  send({ id: 'mark-btc', event: 'subscribe', topic: 'PERP_BTC_USDC@markprice' });
  await sleep(1000);
  send({ id: 'req-eth', event: 'request', params: { type: 'orderbook', symbol: 'PERP_ETH_USDC' } });
  send({ id: 'err-unknown-symbol', event: 'subscribe', topic: 'PERP_NOPE_USDC@orderbookupdate' });
  send({ id: 'err-unknown-topic', event: 'subscribe', topic: 'PERP_BTC_USDC@nope' });
  send({ id: 'err-duplicate', event: 'subscribe', topic: 'PERP_BTC_USDC@orderbookupdate' });
  send({ id: 'builder-market', event: 'subscribe', topic: 'PERP_BTC_USDC_mythos@orderbookupdate' });
  send({ id: 'err-no-id', event: 'subscribe' });
  ws.send('not json');
  await sleep(20_000);
  pingSentAt = Date.now();
  ws.send(JSON.stringify({ event: 'ping' }));
  await sleep(37_500);
  ws.close();
  const close = await closed;

  const secs = (Date.now() - t0) / 1000;
  log('acks', { acks });
  log('first_frame_after_subscribe_ms', firstFrameMs);
  log('topic_frames', { secs: Math.round(secs), topicFrames });
  log('server_pings', { count: pings.length, atMs: pings, clientPongMs: pongMs });
  log('order', { ...order, numberTypes: [...order.numberTypes] });
  for (const m of markets) {
    const ds = deltas.get(m);
    const ss = snaps.get(m);
    const intervals = ds.slice(1).map((d, i) => d.ts - ds[i].ts);
    const snapIntervals = ss.slice(1).map((s, i) => s.ts - ss[i].ts);
    log('book', {
      market: m,
      deltas: ds.length,
      gaps: gaps.get(m),
      deltaTsMod200: [...new Set(ds.map((d) => d.ts % 200))].slice(0, 5),
      deltaIntervalMs: { min: Math.min(...intervals), median: pct(intervals, 50), max: Math.max(...intervals) },
      snapIntervalMs: snapIntervals.length ? { min: Math.min(...snapIntervals), median: pct(snapIntervals, 50), max: Math.max(...snapIntervals) } : null,
      firstDeltaAgeAtArrivalMs: ds[0] ? ds[0].at - ds[0].ts : null,
      arrivalMinusTsMs: ds.length ? { median: pct(ds.map((d) => d.at - d.ts), 50), p90: pct(ds.map((d) => d.at - d.ts), 90) } : null,
      maxLevelsInDelta: Math.max(0, ...ds.map((d) => Math.max(d.bids.length, d.asks.length))),
      ...replay(ss, ds),
    });
  }
  log('close', { ...close, byClient: true });
}

async function batch() {
  const info = await (await fetch(`${API}/v1/public/info`)).json();
  const markets = info.data.rows.filter((r) => SHARED.test(r.symbol)).map((r) => r.symbol);
  const { ws, openMs } = await open(WS_URL);
  log('open', { openMs, markets: markets.length });
  const t0 = Date.now();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSec = new Map();
  const lastTs = new Map();
  let gaps = 0;
  let deltas = 0;
  const snapSeen = new Set();
  let acksOk = 0;
  let acksFail = 0;
  let firstSnapAll = null;
  const failMsgs = {};
  ws.on('message', (raw) => {
    const s0 = process.hrtime.bigint();
    const f = JSON.parse(raw.toString('utf8'));
    parseNs += process.hrtime.bigint() - s0;
    frames++;
    bytes += raw.length;
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
    if (f.event === 'ping') {
      ws.send(JSON.stringify({ event: 'pong', ts: Date.now() }));
      return;
    }
    if (f.topic === undefined) {
      if (f.success) acksOk++;
      else {
        acksFail++;
        failMsgs[f.errorMsg] = (failMsgs[f.errorMsg] ?? 0) + 1;
      }
      return;
    }
    const [sym, kind] = (f.topic ?? '').split('@');
    if (kind === 'orderbookupdate') {
      deltas++;
      const prev = lastTs.get(sym);
      if (prev !== undefined && f.data.prevTs !== prev) gaps++;
      lastTs.set(sym, f.ts);
    } else if (kind === 'orderbook') {
      snapSeen.add(sym);
      if (snapSeen.size === markets.length && firstSnapAll === null) firstSnapAll = Date.now() - t0;
    }
  });
  for (const m of markets) ws.send(JSON.stringify({ id: `u-${m}`, event: 'subscribe', topic: `${m}@orderbookupdate` }));
  for (const m of markets) ws.send(JSON.stringify({ id: `s-${m}`, event: 'subscribe', topic: `${m}@orderbook` }));
  await sleep(45_000);
  ws.close();
  const secs = (Date.now() - t0) / 1000;
  const rates = [...perSec.entries()].filter(([s]) => s > 0 && s < Math.floor(secs)).map(([, n]) => n);
  log('batch', {
    secs: Math.round(secs),
    subscribeFrames: markets.length * 2,
    acksOk,
    acksFail,
    failMsgs,
    frames,
    framesPerSec: Math.round(frames / secs),
    medianPerSec: pct(rates, 50),
    peakPerSec: Math.max(...rates),
    bytesPerSec: Math.round(bytes / secs),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000,
    deltas,
    gaps,
    marketsWithDeltas: lastTs.size,
    marketsWithSnapshot: snapSeen.size,
    allSnapshotsWithinMs: firstSnapAll,
  });
}

// Sends the same 160 topics once in a burst and once paced, each on a fresh socket, and counts acknowledgements and refusals.
async function cap() {
  const info = await (await fetch(`${API}/v1/public/info`)).json();
  const markets = info.data.rows.filter((r) => SHARED.test(r.symbol)).map((r) => r.symbol);
  const topics = [...markets.map((m) => `${m}@orderbookupdate`), ...markets.map((m) => `${m}@orderbook`)];
  for (const [label, gapMs] of [['burst', 0], ['paced_25ms', 25], ['two_sockets_80_each', 0]]) {
    const sockets = label === 'two_sockets_80_each' ? [topics.filter((t) => t.endsWith('update')), topics.filter((t) => !t.endsWith('update'))] : [topics];
    const results = [];
    for (const list of sockets) {
      const { ws } = await open(WS_URL);
      let ok = 0;
      const fail = {};
      const snapped = new Set();
      let close = null;
      ws.on('close', (code) => (close = code));
      ws.on('message', (raw) => {
        const f = JSON.parse(raw.toString('utf8'));
        if (f.event === 'ping') return ws.send(JSON.stringify({ event: 'pong', ts: Date.now() }));
        if (f.topic === undefined) {
          if (f.success) ok++;
          else fail[f.errorMsg] = (fail[f.errorMsg] ?? 0) + 1;
        } else snapped.add(f.topic);
      });
      for (const t of list) {
        ws.send(JSON.stringify({ id: t, event: 'subscribe', topic: t }));
        if (gapMs) await sleep(gapMs);
      }
      await sleep(6000);
      results.push({ sent: list.length, acked: ok, fail, topicsDelivering: snapped.size, closeCode: close });
      ws.close();
    }
    log('cap', { label, results });
  }
}

async function silence() {
  const run = async (label, answer) => {
    const { ws, openMs } = await open(WS_URL);
    const t0 = Date.now();
    const pings = [];
    ws.on('message', (raw) => {
      const f = JSON.parse(raw.toString('utf8'));
      if (f.event === 'ping') {
        pings.push(Date.now() - t0);
        if (answer) ws.send(JSON.stringify({ event: 'pong', ts: Date.now() }));
      }
    });
    const timer = setTimeout(() => ws.close(1000, 'probe done'), 120_000);
    const close = await new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString() })));
    clearTimeout(timer);
    const lifeMs = Date.now() - t0;
    log('silence', { label, openMs, lifeMs, closedByProbe: lifeMs >= 119_900, pingCount: pings.length, firstPingMs: pings[0] ?? null, lastPingMs: pings.at(-1) ?? null, pingSpacingMs: pings.slice(1).map((p, i) => p - pings[i]).slice(0, 4), ...close });
  };
  await Promise.all([run('no_pong_no_subscription', false), run('pong_no_subscription', true)]);
}

async function deflate() {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: true });
  await new Promise((resolve, reject) => {
    ws.once('upgrade', (res) => log('deflate_upgrade', { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server ?? null }));
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  log('deflate_open', { openMs: Math.round(performance.now() - t0), negotiated: ws.extensions });
  ws.close();
}

async function spot() {
  try {
    const { ws, openMs } = await open(SPOT_WS);
    log('spot_open', { url: SPOT_WS, openMs });
    ws.close();
  } catch (e) {
    log('spot_open_failed', { url: SPOT_WS, error: String(e.message ?? e) });
  }
}

const mode = process.argv[2] ?? 'book';
const fn = { book, batch, cap, silence, deflate, spot }[mode];
if (!fn) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await fn();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
