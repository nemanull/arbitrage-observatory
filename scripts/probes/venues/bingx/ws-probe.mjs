// BingX perpetual swap WebSocket probe: gzip framing, book channels, sequence and level order, size unit, keepalive, silence, errors, and a batch of perpetuals on one connection.
// Public, unauthenticated and read-only.
// Every server frame is a binary gzip member, so the probe gunzips it and times that step.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Subscribes are paced at 9 per second, under the FAQ's "do not exceed 10/s".
// Run from server/: node ../scripts/probes/venues/bingx/ws-probe.mjs [book|batch|silence|deflate]
//   book     incrDepth on six perps for 60 s with a REST book compare, depth<N>@<ms> snapshots, bookTicker, markPrice, ticker, the coin-M socket and errors, about 65 s
//   batch    incrDepth on 199 USDT perps on one connection, REST reads of the books with the most id skips, then two more topics to cross the 200 topic cap, about 75 s
//   silence  three sockets that differ only in what the client subscribes and whether it answers Ping, for up to 90 s
//   deflate  asks for permessage-deflate once and prints what the server negotiates
// Set PROBE_OUT_DIR to keep raw frames.
// Recorded in docs/profiles/bingx/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const SWAP_URL = 'wss://open-api-swap.bingx.com/swap-market';
const CSWAP_URL = 'wss://open-api-cswap-ws.bingx.com/market';
const API = 'https://open-api.bingx.com/openApi';
const OUT = process.env.PROBE_OUT_DIR;
const BOOK_SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'TURBO-USDT', 'AIINU-USDT', 'BTC-USDC', 'NCCOGOLD2USD-USDT'];
const SUB_GAP_MS = 111;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);
const r1 = (x) => (x == null ? x : Math.round(x * 10) / 10);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Opens a socket and decodes every frame: binary frames are gunzipped, text frames are read as they are.
function openSocket(url, name, { answerPing = true, deflate = false, onFrame } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const s = { ws, name, t0, openMs: null, pings: [], pingSamples: [], textFrames: 0, binFrames: 0, zBytes: 0, rawBytes: 0, gunzipUs: [], parseUs: [], closed: null, protoPings: 0 };
  ws.on('open', () => (s.openMs = Date.now() - t0));
  ws.on('ping', () => s.protoPings++);
  ws.on('upgrade', (res) => (s.extensions = res.headers['sec-websocket-extensions'] ?? null));
  ws.on('message', (raw, isBinary) => {
    let text;
    if (isBinary) {
      s.binFrames++;
      s.zBytes += raw.length;
      const a = process.hrtime.bigint();
      text = gunzipSync(raw).toString('utf8');
      s.gunzipUs.push(Number(process.hrtime.bigint() - a) / 1000);
    } else {
      s.textFrames++;
      text = raw.toString('utf8');
    }
    s.rawBytes += text.length;
    const now = Date.now();
    if (text === 'Ping' || text.startsWith('{"ping"')) {
      s.pings.push(now - t0);
      if (s.pingSamples.length < 2) s.pingSamples.push({ binary: isBinary, text: text.slice(0, 120) });
      capture(`${name}.ping.txt`, text);
      if (answerPing) ws.send(text === 'Ping' ? 'Pong' : JSON.stringify({ pong: JSON.parse(text).ping, time: JSON.parse(text).time }));
      return;
    }
    let msg;
    const b = process.hrtime.bigint();
    try {
      msg = JSON.parse(text);
    } catch {
      log('non_json', { socket: name, text: text.slice(0, 200) });
      return;
    }
    s.parseUs.push(Number(process.hrtime.bigint() - b) / 1000);
    onFrame?.(msg, now, text);
  });
  ws.on('close', (code, reason) => (s.closed = { atMs: Date.now() - t0, code, reason: reason.toString() }));
  ws.on('error', (e) => log('socket_error', { socket: name, message: e.message }));
  return s;
}

const waitOpen = (s) => new Promise((res) => (s.ws.readyState === 1 ? res() : s.ws.once('open', res)));

function sub(s, dataType, reqType = 'sub') {
  const id = randomUUID();
  s.ws.send(JSON.stringify({ id, reqType, dataType }));
  return id;
}

function frameStats(s) {
  return {
    socket: s.name,
    openMs: s.openMs,
    binFrames: s.binFrames,
    textFrames: s.textFrames,
    zBytes: s.zBytes,
    rawBytes: s.rawBytes,
    gunzipUsP50: r1(pct(s.gunzipUs, 0.5)),
    gunzipUsP99: r1(pct(s.gunzipUs, 0.99)),
    parseUsP50: r1(pct(s.parseUs, 0.5)),
    parseUsP99: r1(pct(s.parseUs, 0.99)),
    pings: s.pings.length,
    pingGapsMs: s.pings.slice(1).map((t, i) => t - s.pings[i]).slice(0, 12),
    protoPings: s.protoPings,
    closed: s.closed,
  };
}

// Keeps one incrDepth book per symbol and checks the documented rule: an update's lastUpdateId is the previous one plus one.
function newTracker(symbol) {
  return { symbol, subAt: null, acks: [], snapshots: [], updates: 0, emptyUpdates: 0, gaps: [], repeats: 0, bidsUnordered: 0, asksUnordered: 0, deleteAbsent: 0, crossed: 0, maxBids: 0, maxAsks: 0, last: null, lastAt: null, maxGapMs: 0, intervals: [], bids: new Map(), asks: new Map(), firstUpdateDelta: null, snapshotOrder: [], seen: new Set(), skipped: [], asksDesc: 0, maxIdStep: 0 };
}

const isDesc = (lv) => lv.every((x, i) => i === 0 || +lv[i - 1][0] > +x[0]);
const isAsc = (lv) => lv.every((x, i) => i === 0 || +lv[i - 1][0] < +x[0]);

function applyIncr(t, data, now) {
  if (t.lastAt !== null) {
    const gap = now - t.lastAt;
    t.intervals.push(gap);
    if (gap > t.maxGapMs) t.maxGapMs = gap;
  }
  t.lastAt = now;
  const bids = data.bids ?? [];
  const asks = data.asks ?? [];
  if (data.action === 'all') {
    t.snapshots.push({ atMs: now - t.subAt, id: data.lastUpdateId, bids: bids.length, asks: asks.length });
    t.snapshotOrder.push({ bidsDesc: isDesc(bids), asksAsc: isAsc(asks) });
    t.bids = new Map(bids.map(([p, q]) => [p, q]));
    t.asks = new Map(asks.map(([p, q]) => [p, q]));
    t.last = data.lastUpdateId;
  } else {
    t.updates++;
    if (bids.length === 0 && asks.length === 0) t.emptyUpdates++;
    if (t.last === null) t.gaps.push({ kind: 'update_before_snapshot', got: data.lastUpdateId });
    else if (data.lastUpdateId === t.last) t.repeats++;
    else if (data.lastUpdateId !== t.last + 1) {
      t.gaps.push({ expected: t.last + 1, got: data.lastUpdateId, at: now });
      for (let id = t.last + 1; id < data.lastUpdateId && t.skipped.length < 5000; id++) t.skipped.push(id);
      t.maxIdStep = Math.max(t.maxIdStep, data.lastUpdateId - t.last);
    }
    t.seen.add(data.lastUpdateId);
    if (t.firstUpdateDelta === null && t.last !== null) t.firstUpdateDelta = data.lastUpdateId - t.last;
    if (!isDesc(bids)) t.bidsUnordered++;
    if (!isAsc(asks)) t.asksUnordered++;
    if (asks.length > 1 && isDesc(asks)) t.asksDesc++;
    for (const [p, q] of bids) {
      if (+q === 0) {
        if (!t.bids.delete(p)) t.deleteAbsent++;
      } else t.bids.set(p, q);
    }
    for (const [p, q] of asks) {
      if (+q === 0) {
        if (!t.asks.delete(p)) t.deleteAbsent++;
      } else t.asks.set(p, q);
    }
    t.last = data.lastUpdateId;
  }
  t.maxBids = Math.max(t.maxBids, t.bids.size);
  t.maxAsks = Math.max(t.maxAsks, t.asks.size);
  if (t.bids.size && t.asks.size) {
    const bb = Math.max(...[...t.bids.keys()].map(Number));
    const ba = Math.min(...[...t.asks.keys()].map(Number));
    if (bb >= ba) t.crossed++;
  }
}

function trackerSummary(t) {
  return {
    symbol: t.symbol,
    acks: t.acks,
    snapshots: t.snapshots.slice(0, 4),
    snapshotCount: t.snapshots.length,
    snapshotOrder: t.snapshotOrder.slice(0, 2),
    updates: t.updates,
    emptyUpdates: t.emptyUpdates,
    firstUpdateDelta: t.firstUpdateDelta,
    gaps: t.gaps.length,
    gapSamples: t.gaps.slice(0, 3),
    skippedIds: t.skipped.length,
    skippedArrivedLater: t.skipped.filter((id) => t.seen.has(id)).length,
    maxIdStep: t.maxIdStep,
    updatesWithAsksDescending: t.asksDesc,
    repeats: t.repeats,
    bidsUnordered: t.bidsUnordered,
    asksUnordered: t.asksUnordered,
    deleteAbsent: t.deleteAbsent,
    crossedAfterApply: t.crossed,
    maxBids: t.maxBids,
    maxAsks: t.maxAsks,
    heldBids: t.bids.size,
    heldAsks: t.asks.size,
    intervalP50: pct(t.intervals, 0.5),
    maxGapMs: t.maxGapMs,
  };
}

async function restDepth(symbol, limit) {
  const r = await fetch(`${API}/swap/v2/quote/depth?symbol=${symbol}&limit=${limit}`);
  return (await r.json()).data;
}

// Compares the maintained book with the REST book at the same prices, in both the `bids` and the `bidsCoin` units.
async function sizeCompare(t) {
  const d = await restDepth(t.symbol, 100);
  const restBids = new Map(d.bids.map(([p, q]) => [String(+p), +q]));
  const restCoin = new Map((d.bidsCoin ?? []).map(([p, q]) => [String(+p), +q]));
  const top = [...t.bids.entries()].sort((a, b) => +b[0] - +a[0]).slice(0, 20);
  let eqBids = 0;
  let eqCoin = 0;
  let found = 0;
  for (const [p, q] of top) {
    const k = String(+p);
    if (restBids.has(k)) found++;
    if (restBids.get(k) === +q) eqBids++;
    if (restCoin.get(k) === +q) eqCoin++;
  }
  const side = (rest, mine, desc) => {
    const lv = rest.map(([p, q]) => [+p, +q]);
    const lo = Math.min(...lv.map((x) => x[0]));
    const hi = Math.max(...lv.map((x) => x[0]));
    const r = new Map(lv.map(([p, q]) => [p, q]));
    let equal = 0;
    let differ = 0;
    let missing = 0;
    let extra = 0;
    for (const [p, q] of r) {
      const m = [...mine.entries()].find(([k]) => +k === p);
      if (!m) missing++;
      else if (+m[1] === q) equal++;
      else differ++;
    }
    for (const k of mine.keys()) if (+k >= lo && +k <= hi && !r.has(+k)) extra++;
    return { equal, differ, missing, extra };
  };
  return { symbol: t.symbol, compared: top.length, pricesFound: found, equalToBids: eqBids, equalToBidsCoin: eqCoin, wsTop: top.slice(0, 2), restTop: d.bids.slice(0, 2), restCoinTop: (d.bidsCoin ?? []).slice(0, 2), restLevels: [d.bids.length, d.asks.length], restT: d.T, gapsSoFar: t.gaps.length, bids100: side(d.bids, t.bids), asks100: side(d.asks, t.asks) };
}

// Levels in the top 20 of either side where the maintained book and the REST book disagree, keyed by side and price, valued by the socket's size.
async function top20Mismatch(t) {
  const d = await restDepth(t.symbol, 20);
  const out = new Map();
  for (const [side, rest, mine] of [['bid', d.bids, t.bids], ['ask', d.asks, t.asks]]) {
    const r = new Map(rest.map(([p, q]) => [+p, +q]));
    const lo = Math.min(...r.keys());
    const hi = Math.max(...r.keys());
    const m = new Map([...mine.entries()].map(([p, q]) => [+p, +q]));
    for (const [p, q] of r) if (m.get(p) !== q) out.set(`${side} ${p}`, m.get(p) ?? 'absent');
    for (const [p, q] of m) if (p >= lo && p <= hi && !r.has(p)) out.set(`${side} ${p}`, q);
  }
  return out;
}

async function book() {
  const trackers = new Map(BOOK_SYMBOLS.map((s) => [s, newTracker(s)]));
  const acksById = new Map();
  let firstSnap = false;
  let firstUpd = false;
  const A = openSocket(SWAP_URL, 'A-incr', {
    onFrame: (m, now, text) => {
      if (m.dataType === '' || m.dataType === undefined) {
        const who = acksById.get(m.id);
        if (who) trackers.get(who).acks.push({ code: m.code, msg: m.msg, atMs: now - trackers.get(who).subAt });
        capture('A.ack.txt', text);
        return;
      }
      const [sym, ch] = m.dataType.split('@');
      const t = trackers.get(sym);
      if (!t || ch !== 'incrDepth' || !m.data) return log('A_other', { text: text.slice(0, 200) });
      if (m.data.action === 'all' && !firstSnap) {
        firstSnap = true;
        capture('A.snapshot.txt', JSON.stringify({ ...m, data: { ...m.data, bids: m.data.bids.slice(0, 3), asks: m.data.asks.slice(0, 3) } }));
      }
      if (m.data.action === 'update' && !firstUpd) (firstUpd = true), capture('A.update.txt', text);
      applyIncr(t, m.data, now);
    },
  });

  const snapFrames = new Map();
  const B = openSocket(SWAP_URL, 'B-snap', {
    onFrame: (m, now, text) => {
      const k = m.dataType || `ack:${m.id?.slice(0, 8)}`;
      const e = snapFrames.get(k) ?? { n: 0, times: [], levels: new Set(), keys: null, sample: null, repeats: 0, prev: null, code: m.code, msg: m.msg };
      e.n++;
      e.times.push(now);
      if (m.data) {
        const d = m.data;
        e.keys ??= Object.keys(d).join(',');
        if (Array.isArray(d.bids)) e.levels.add(`${d.bids.length}/${d.asks?.length}`);
        const body = JSON.stringify({ ...d, T: undefined, E: undefined, time: undefined, ts: undefined });
        if (body === e.prev) e.repeats++;
        e.prev = body;
        e.sample ??= text.slice(0, 400);
      }
      snapFrames.set(k, e);
    },
  });

  const cData = {};
  const C = openSocket(CSWAP_URL, 'C-cswap', {
    onFrame: (m, now, text) => {
      if (m.dataType && m.data) {
        cData[m.dataType] ??= { frames: 0, times: [], sample: text.slice(0, 260) };
        cData[m.dataType].frames++;
        cData[m.dataType].times.push(now);
        return;
      }
      log('C_control', { atMs: now - C.t0, text: text.slice(0, 200) });
    },
  });

  const errorReplies = [];
  const dataCounts = {};
  const E = openSocket(SWAP_URL, 'E-errors', {
    onFrame: (m, now, text) => {
      if (m.dataType && m.data) {
        dataCounts[m.dataType] = (dataCounts[m.dataType] ?? 0) + 1;
        return;
      }
      errorReplies.push({ atMs: now - E.t0, text: text.slice(0, 220) });
    },
  });

  await Promise.all([waitOpen(A), waitOpen(B), waitOpen(C), waitOpen(E)]);
  log('open', { A: A.openMs, B: B.openMs, C: C.openMs, E: E.openMs });

  for (const s of BOOK_SYMBOLS) {
    const t = trackers.get(s);
    t.subAt = Date.now();
    acksById.set(sub(A, `${s}@incrDepth`), s);
    await sleep(SUB_GAP_MS);
  }
  for (const dt of ['BTC-USDT@depth20@200ms', 'ETH-USDT@depth100@500ms', 'AIINU-USDT@depth20@500ms', 'BTC-USDT@depth50', 'BTC-USDT@bookTicker', 'BTC-USDT@markPrice', 'AIINU-USDT@markPrice', 'BTC-USDT@ticker']) {
    sub(B, dt);
    await sleep(SUB_GAP_MS);
  }
  for (const dt of ['BTC-USD@depth20', 'BTC-USD@incrDepth', 'BTC-USDT@incrDepth']) {
    sub(C, dt);
    await sleep(SUB_GAP_MS);
  }
  const errorCases = ['NOPE-USDT@incrDepth', 'BTC-USDT@incrDepth', 'BTC-USDT@incrDepth', 'BTC-USDT@nope', 'BTC-USD@incrDepth', 'NCCOCOFFEE2USD-USDT@incrDepth', 'POWER-USDT@incrDepth', 'BTC-USDT@depth30@200ms', 'btc-usdt@incrDepth'];
  const sentById = new Map();
  for (const dt of errorCases) {
    sentById.set(sub(E, dt), dt);
    await sleep(SUB_GAP_MS * 3);
  }
  E.ws.send('hello');
  sentById.set('none', 'text hello');
  await sleep(SUB_GAP_MS * 3);
  const arrId = randomUUID();
  E.ws.send(JSON.stringify({ id: arrId, reqType: 'sub', dataType: ['ETH-USDT@bookTicker', 'SOL-USDT@bookTicker'] }));
  sentById.set(arrId, 'dataType as array');

  await sleep(12_000);
  C.ws.terminate();
  E.ws.terminate();
  for (const v of Object.values(cData)) (v.intervalP50 = pct(v.times.slice(1).map((t, i) => t - v.times[i]), 0.5)), delete v.times;
  log('coin_m', { ...frameStats(C), data: cData });
  const replies = errorReplies.map((e) => {
    const id = e.text.match(/"id":"([^"]+)"/)?.[1];
    return `${sentById.get(id) ?? 'no id'} => ${e.text.replace(/"id":"[^"]*",?/, '')}`;
  });
  log('errors', { replies, dataFramesByType: dataCounts });

  await sleep(13_000);
  B.ws.terminate();
  const snap = {};
  for (const [k, e] of snapFrames) {
    const gaps = e.times.slice(1).map((t, i) => t - e.times[i]);
    snap[k] = { frames: e.n, intervalP50: pct(gaps, 0.5), maxGap: gaps.length ? Math.max(...gaps) : null, levels: [...e.levels].slice(0, 4), identicalRepeats: e.repeats, keys: e.keys, code: e.code, msg: e.msg, sample: e.sample?.slice(0, 260) };
  }
  log('snapshot_channels', snap);
  log('B_stats', frameStats(B));

  await sleep(34_000);
  const compares = [];
  for (const s of BOOK_SYMBOLS) compares.push(await sizeCompare(trackers.get(s)));
  A.ws.terminate();
  for (const t of trackers.values()) log('incrDepth', trackerSummary(t));
  for (const c of compares) log('size_compare', c);
  log('A_stats', frameStats(A));
  log('ping_samples', { A: A.pingSamples });
}

async function activeSymbols() {
  const [c, p, tk] = await Promise.all(
    ['swap/v2/quote/contracts', 'swap/v2/quote/premiumIndex', 'swap/v2/quote/ticker'].map((u) => fetch(`${API}/${u}`).then((r) => r.json())),
  );
  const inIndex = new Set(p.data.map((r) => r.symbol));
  const active = new Set(c.data.filter((r) => r.apiStateOpen === 'true' && r.apiStateClose === 'true' && r.status === 1 && inIndex.has(r.symbol) && r.currency === 'USDT' && !r.symbol.startsWith('NC')).map((r) => r.symbol));
  return tk.data.filter((r) => active.has(r.symbol)).sort((a, b) => +b.quoteVolume - +a.quoteVolume).map((r) => r.symbol);
}

async function batch() {
  const ranked = await activeSymbols();
  const step = ranked.length / 199;
  const picks = [...new Set(Array.from({ length: 199 }, (_, i) => ranked[Math.floor(i * step)]))];
  const extra = ranked.filter((s) => !picks.includes(s)).slice(0, 2);
  const trackers = new Map(picks.concat(extra).map((s) => [s, newTracker(s)]));
  const acks = [];
  const topicById = new Map();
  const extraFrames = Object.fromEntries(extra.map((s) => [`${s}@incrDepth`, 0]));
  const perSecond = new Map();
  const S = openSocket(SWAP_URL, 'batch', {
    onFrame: (m, now, text) => {
      if (!m.dataType) {
        acks.push({ code: m.code, msg: m.msg, id: m.id, topic: topicById.get(m.id) });
        return;
      }
      if (extraFrames[m.dataType] !== undefined) extraFrames[m.dataType]++;
      const sec = Math.floor(now / 1000);
      perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
      const t = trackers.get(m.dataType.split('@')[0]);
      if (t && m.data) applyIncr(t, m.data, now);
    },
  });
  await waitOpen(S);
  log('batch_open', { ranked: ranked.length, picks: picks.length, openMs: S.openMs });
  const t0 = Date.now();
  for (const s of picks) {
    trackers.get(s).subAt = Date.now();
    topicById.set(sub(S, `${s}@incrDepth`), s);
    await sleep(SUB_GAP_MS);
  }
  log('batch_subscribed', { ms: Date.now() - t0, acks: acks.length, failed: acks.filter((a) => a.code !== 0).length });
  const z0 = S.zBytes;
  const r0 = S.rawBytes;
  const g0 = S.gunzipUs.length;
  const w0 = Date.now();
  await sleep(35_000);
  const window = (Date.now() - w0) / 1000;
  const secs = [...perSecond.entries()].filter(([k]) => k * 1000 >= w0 && (k + 1) * 1000 <= Date.now()).map(([, v]) => v);
  const byGaps = [...trackers.values()].filter((t) => picks.includes(t.symbol) && t.gaps.length > 0).sort((a, b) => b.gaps.length - a.gaps.length).slice(0, 6);
  const compares = [];
  const firstRead = new Map();
  for (const t of byGaps) {
    const c = await sizeCompare(t);
    firstRead.set(t.symbol, await top20Mismatch(t));
    compares.push({ symbol: t.symbol, gaps: t.gaps.length, bids100: c.bids100, asks100: c.asks100, restLevels: c.restLevels });
  }
  await sleep(5_000);
  for (const c of compares) {
    const t = trackers.get(c.symbol);
    const a = firstRead.get(c.symbol);
    const b = await top20Mismatch(t);
    c.top20MismatchFirst = a.size;
    c.top20MismatchSecond = b.size;
    c.persistentStale = [...a.entries()].filter(([k, v]) => b.has(k) && b.get(k) === v).map(([k, v]) => `${k} ws ${v}`);
    c.gapsAfter = t.gaps.length;
  }
  const ackBefore = acks.length;
  for (const s of extra) {
    trackers.get(s).subAt = Date.now();
    topicById.set(sub(S, `${s}@incrDepth`), s);
    await sleep(SUB_GAP_MS);
  }
  await sleep(4_000);
  S.ws.terminate();
  const ts = [...trackers.values()].filter((t) => picks.includes(t.symbol));
  const withSnap = ts.filter((t) => t.snapshots.length > 0);
  const snapLatency = withSnap.map((t) => t.snapshots[0].atMs);
  log('batch', {
    streams: picks.length,
    acked: ackBefore,
    ackCodes: [...new Set(acks.slice(0, ackBefore).map((a) => `${a.code}:${a.msg}`))],
    withSnapshot: withSnap.length,
    snapshotLatencyP50: pct(snapLatency, 0.5),
    snapshotLatencyMax: Math.max(...snapLatency),
    snapshotLevels: pct(withSnap.map((t) => t.snapshots[0].bids + t.snapshots[0].asks), 0.5),
    extraSnapshots: ts.reduce((a, t) => a + Math.max(0, t.snapshots.length - 1), 0),
    updates: ts.reduce((a, t) => a + t.updates, 0),
    gaps: ts.reduce((a, t) => a + t.gaps.length, 0),
    gapSamples: ts.flatMap((t) => t.gaps.map((g) => ({ s: t.symbol, ...g, at: undefined }))).slice(0, 5),
    streamsWithGap: ts.filter((t) => t.gaps.length > 0).length,
    gapsPerStreamMax: Math.max(...ts.map((t) => t.gaps.length)),
    gapSeconds: new Set(ts.flatMap((t) => t.gaps.map((g) => Math.floor(g.at / 1000)))).size,
    skippedIds: ts.reduce((a, t) => a + t.skipped.length, 0),
    skippedArrivedLater: ts.reduce((a, t) => a + t.skipped.filter((id) => t.seen.has(id)).length, 0),
    maxIdStep: Math.max(...ts.map((t) => t.maxIdStep)),
    repeats: ts.reduce((a, t) => a + t.repeats, 0),
    crossed: ts.reduce((a, t) => a + t.crossed, 0),
    windowS: r1(window),
    framesPerSecMedian: pct(secs, 0.5),
    framesPerSecMax: secs.length ? Math.max(...secs) : null,
    zBytesPerSec: Math.round((S.zBytes - z0) / window),
    rawBytesPerSec: Math.round((S.rawBytes - r0) / window),
    framesInWindow: S.gunzipUs.length - g0,
    maxSilencePerStreamP50: pct(ts.map((t) => t.maxGapMs), 0.5),
    maxSilencePerStreamMax: Math.max(...ts.map((t) => t.maxGapMs)),
  });
  log('batch_gap_books', { compares });
  log('batch_cap', { extraTopics: extra, replies: acks.slice(ackBefore).map((a) => `${a.topic}: ${a.code} ${a.msg}`), framesPerExtraTopic: extraFrames });
  log('batch_stats', frameStats(S));
}

async function silence() {
  const quiet = (await activeSymbols()).at(-1);
  const socks = [
    openSocket(SWAP_URL, 'no-sub-pong', { answerPing: true }),
    openSocket(SWAP_URL, 'no-sub-no-pong', { answerPing: false }),
    openSocket(SWAP_URL, `sub-${quiet}-no-pong`, { answerPing: false }),
  ];
  await Promise.all(socks.map(waitOpen));
  sub(socks[2], `${quiet}@incrDepth`);
  const end = Date.now() + 90_000; // the cap on a silence test
  while (Date.now() < end && socks.some((s) => !s.closed)) await sleep(500);
  for (const s of socks) {
    const survived = s.closed === null;
    if (survived) s.ws.terminate();
    log('silence', { ...frameStats(s), survived, closed: survived ? null : s.closed });
  }
}

async function deflate() {
  const s = openSocket(SWAP_URL, 'deflate', { deflate: true });
  await waitOpen(s);
  sub(s, 'BTC-USDT@bookTicker');
  await sleep(3_000);
  s.ws.terminate();
  log('deflate', { extensionsNegotiated: s.extensions, binFrames: s.binFrames, textFrames: s.textFrames, openMs: s.openMs });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
