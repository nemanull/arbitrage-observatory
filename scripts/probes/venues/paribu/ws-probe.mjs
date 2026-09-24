// Paribu public WebSocket probe: v2 orderbook snapshot and diff chain, level order and window, size against the REST book, heartbeats, other public channels, errors, subscription cap, keepalive and silence, the legacy stream, deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/paribu/ws-probe.mjs [book|channels|errors|batch|silence|legacy|deflate]
//   book      orderbook on five markets for 75 s, then a REST book compare. About 80 s.
//   channels  book-ticker, match-price and matches on four markets for 45 s.
//   errors    unknown, malformed and wrong-endpoint channels, bad frames, 65 channels in one frame, the subscribe rate. About 15 s.
//   batch     orderbook on every open market plus 64 book tickers on one socket for 60 s, to measure the cap and the throughput.
//   silence   four sockets that differ in pong and subscription, up to 110 s, or SILENCE_MS.
//   legacy    the older wss://api.paribu.com/stream endpoint for 20 s.
//   deflate   offers permessage-deflate on both endpoints and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames (capped). Recorded in docs/profiles/paribu/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const V2_URL = 'wss://api.paribu.com/v1/wapi/stream';
const LEGACY_URL = 'wss://api.paribu.com/stream';
const API = 'https://api.paribu.com';
const OUT = process.env.PROBE_OUT_DIR;
const CAPTURE_CAP = 2_000_000;
const SILENCE_MS = Number(process.env.SILENCE_MS ?? 110_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const f = join(OUT, name);
  try {
    if (statSync(f).size > CAPTURE_CAP) return;
  } catch {}
  appendFileSync(f, text + '\n');
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0), t0 }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => reject(new Error(`upgrade refused ${res.statusCode} ${body.slice(0, 200)}`)));
    });
  });
}

const sub = (channels, id) => JSON.stringify({ method: 'subscribe', channels, ...(id ? { id } : {}) });

function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

async function getJson(path) {
  const r = await fetch(API + path);
  return r.json();
}

async function openMarkets() {
  const cfg = await getJson('/initials/config?scope=markets');
  const tick = await getJson('/market/ticker');
  const vol = new Map(tick.map((t) => [t.market, Number(t.pair_volume)]));
  const all = Object.entries(cfg.payload.markets);
  const open = all.filter(([, m]) => m.unlisted !== true && m.suspended === undefined).map(([id]) => id);
  return { open, vol };
}

function isSorted(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (dir === 'desc' ? b >= a : b <= a) return false;
  }
  return true;
}

// A local book per market, kept by the documented rule, with counters for everything the profile reports.
function newTracker() {
  return {
    snapshots: 0, snapLevels: [], snapOrderOk: true, firstSnapMs: null, diffs: 0, emptyDiffs: 0, gaps: 0, drops: 0,
    heartbeats: 0, hbMatch: 0, hbMismatch: 0, hbGaps: [], lastHbAt: null, unorderedBid: 0, unorderedAsk: 0,
    frameGaps: [], lastFrameAt: null, lateMs: [], maxBids: 0, maxAsks: 0, seq: null, bids: new Map(), asks: new Map(),
    zeroNew: 0, firstDiffDelta: null, oneSided: 0,
  };
}

function applyBookFrame(tr, f, now, subAt) {
  const r = f.r;
  tr.lateMs.push(now - f.E);
  if (tr.lastFrameAt !== null) tr.frameGaps.push(now - tr.lastFrameAt);
  tr.lastFrameAt = now;
  if (r.t === 'snapshot') {
    tr.snapshots++;
    tr.snapLevels.push(`${(r.b ?? []).length}/${(r.a ?? []).length}`);
    if (!isSorted(r.b ?? [], 'desc') || !isSorted(r.a ?? [], 'asc')) tr.snapOrderOk = false;
    if (tr.firstSnapMs === null) tr.firstSnapMs = Math.round(now - subAt);
    tr.bids = new Map((r.b ?? []).map(([p, q]) => [p, q]));
    tr.asks = new Map((r.a ?? []).map(([p, q]) => [p, q]));
    tr.seq = r.sq;
    tr.expectFirstDiff = true;
    return;
  }
  if (r.t === 'heartbeat') {
    tr.heartbeats++;
    if (r.sq === tr.seq) tr.hbMatch++;
    else tr.hbMismatch++;
    if (tr.lastHbAt !== null) tr.hbGaps.push(now - tr.lastHbAt);
    tr.lastHbAt = now;
    return;
  }
  if (r.t !== 'diff') return;
  tr.diffs++;
  if (tr.expectFirstDiff) {
    tr.firstDiffDelta = r.sq - tr.seq;
    tr.expectFirstDiff = false;
  }
  if (tr.seq === null) return;
  if (r.sq <= tr.seq) {
    tr.drops++;
    return;
  }
  if (r.sq !== tr.seq + 1) tr.gaps++;
  tr.seq = r.sq;
  const b = r.b ?? [];
  const a = r.a ?? [];
  if (b.length === 0 && a.length === 0) tr.emptyDiffs++;
  if (b.length > 1 && !isSorted(b, 'desc')) tr.unorderedBid++;
  if (a.length > 1 && !isSorted(a, 'asc')) tr.unorderedAsk++;
  for (const [p, q] of b) {
    if (Number(q) === 0) {
      if (!tr.bids.has(p)) tr.zeroNew++;
      tr.bids.delete(p);
    } else tr.bids.set(p, q);
  }
  for (const [p, q] of a) {
    if (Number(q) === 0) {
      if (!tr.asks.has(p)) tr.zeroNew++;
      tr.asks.delete(p);
    } else tr.asks.set(p, q);
  }
  tr.maxBids = Math.max(tr.maxBids, tr.bids.size);
  tr.maxAsks = Math.max(tr.maxAsks, tr.asks.size);
  if (tr.bids.size === 0 || tr.asks.size === 0) tr.oneSided++;
}

function summary(tr) {
  const bestBid = Math.max(...[...tr.bids.keys()].map(Number));
  const bestAsk = Math.min(...[...tr.asks.keys()].map(Number));
  return {
    snapshots: tr.snapshots, snapLevels: tr.snapLevels.join(','), snapOrderOk: tr.snapOrderOk, firstSnapMs: tr.firstSnapMs,
    diffs: tr.diffs, emptyDiffs: tr.emptyDiffs, gaps: tr.gaps, drops: tr.drops, firstDiffDelta: tr.firstDiffDelta,
    heartbeats: tr.heartbeats, hbMatch: tr.hbMatch, hbMismatch: tr.hbMismatch, hbGapMs: stats(tr.hbGaps),
    unorderedBidDiffs: tr.unorderedBid, unorderedAskDiffs: tr.unorderedAsk, zeroForUnknownLevel: tr.zeroNew,
    maxFrameGapMs: tr.frameGaps.length ? Math.max(...tr.frameGaps) : null, heldLevels: `${tr.bids.size}/${tr.asks.size}`,
    maxHeld: `${tr.maxBids}/${tr.maxAsks}`, crossedAtEnd: bestBid >= bestAsk, oneSidedDiffs: tr.oneSided,
    eventAgeMs: stats(tr.lateMs.map(Math.round)),
  };
}

async function compareRest(market, tr) {
  const rest = await getJson(`/orderbook?market=${market}&limit=100`);
  const wsBids = [...tr.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, 20);
  const restBids = new Map(rest.bids.map(([p, q]) => [p, q]));
  const restPrices = new Map(rest.bids.map(([p, q]) => [Number(p), q]));
  let samePrice = 0;
  let sameSize = 0;
  let stringDiff = 0;
  for (const [p, q] of wsBids) {
    if (restPrices.has(Number(p))) {
      samePrice++;
      if (Number(restPrices.get(Number(p))) === Number(q)) sameSize++;
      if (!restBids.has(p)) stringDiff++;
    }
  }
  return { market, restSeq: rest.seq, wsSeq: tr.seq, restTop: [rest.bids[0], rest.asks[0]], wsTopBid: wsBids[0], top20BidsAtRestPrice: samePrice, sameSize, priceStringDiffers: stringDiff };
}

async function book() {
  const { open: markets, vol } = await openMarkets();
  const quiet = markets.filter((m) => m.endsWith('_tl') && vol.get(m) > 0).sort((a, b) => vol.get(a) - vol.get(b))[0];
  const picks = ['btc_tl', 'eth_tl', 'usdt_tl', 'btc_usdt', quiet];
  log('book_markets', { picks, quietVolTry: vol.get(quiet) });
  const { ws, openMs } = await open(V2_URL);
  log('open', { url: V2_URL, openMs });
  const trackers = new Map(picks.map((m) => [m, newTracker()]));
  const pings = [];
  let subAt = 0;
  const kinds = {};
  let firstDiffShown = false;
  ws.on('ping', (d) => pings.push({ at: Math.round(performance.now()), data: d.toString() }));
  ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString();
    const f = JSON.parse(text);
    const k = `${f.e}:${f.r?.t}`;
    kinds[k] = (kinds[k] ?? 0) + 1;
    capture('book-frames.jsonl', text.length > 600 ? text.slice(0, 600) + '…' : text);
    if (f.e === 'status') {
      log('status_frame', { frame: f, msAfterSub: now - subAt });
      return;
    }
    if (f.r?.t === 'snapshot' && f.s === picks[4]) {
      log('snapshot_trimmed', { frame: JSON.stringify({ ...f, r: { ...f.r, b: f.r.b?.slice(0, 3), a: f.r.a?.slice(0, 3) } }), bids: f.r.b?.length, asks: f.r.a?.length });
    }
    if (f.r?.t === 'diff' && !firstDiffShown) {
      firstDiffShown = true;
      log('first_diff', { frame: text.slice(0, 400) });
    }
    const tr = trackers.get(f.s);
    if (tr && f.e === 'orderbook') applyBookFrame(tr, f, now, subAt);
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  subAt = Date.now();
  ws.send(sub(picks.map((m) => `orderbook:${m}`), 'book1'));
  await sleep(75_000);
  for (const [m, tr] of trackers) log('book_summary', { market: m, ...summary(tr) });
  for (const m of ['btc_tl', 'usdt_tl']) log('rest_compare', await compareRest(m, trackers.get(m)));
  log('frame_kinds', { kinds, serverPings: pings.length, pingTimesMs: pings.map((p) => p.at) });
  ws.close();
  await sleep(300);
}

async function channels() {
  const { open: markets, vol } = await openMarkets();
  const quiet = markets.filter((m) => m.endsWith('_tl') && vol.get(m) > 0).sort((a, b) => vol.get(a) - vol.get(b))[0];
  const picks = ['btc_tl', 'usdt_tl', 'xrp_tl', quiet];
  const { ws, openMs } = await open(V2_URL);
  log('open', { url: V2_URL, openMs, picks });
  const per = {};
  const samples = {};
  let subAt = 0;
  ws.on('message', (raw) => {
    const now = Date.now();
    const f = JSON.parse(raw.toString());
    if (f.e === 'status') {
      log('status_frame', { frame: f, msAfterSub: now - subAt });
      return;
    }
    const key = `${f.s}:${f.r?.t}`;
    const p = (per[key] ??= { n: 0, repeats: 0, last: null, gaps: [], lastAt: null, uBackOrSame: 0, lastU: null });
    p.n++;
    const body = JSON.stringify({ b: f.r.b, bq: f.r.bq, a: f.r.a, aq: f.r.aq });
    if (f.r.t === 'book-ticker') {
      if (p.last === body) p.repeats++;
      if (p.lastU !== null && f.r.u <= p.lastU) p.uBackOrSame++;
      p.lastU = f.r.u;
    }
    p.last = body;
    if (p.lastAt !== null) p.gaps.push(now - p.lastAt);
    p.lastAt = now;
    if (!samples[key]) samples[key] = raw.toString().slice(0, 300);
  });
  subAt = Date.now();
  const chans = picks.flatMap((m) => [`book-ticker:${m}`, `match-price:${m}`, `matches:${m}`]);
  ws.send(sub(chans, 'ch1'));
  await sleep(45_000);
  for (const [k, p] of Object.entries(per)) log('channel_summary', { key: k, frames: p.n, identicalRepeats: p.repeats, uNotIncreasing: p.uBackOrSame, gapMs: stats(p.gaps) });
  for (const [k, s] of Object.entries(samples)) log('channel_sample', { key: k, frame: s });
  ws.close();
  await sleep(300);
}

async function errors() {
  const { ws, openMs } = await open(V2_URL);
  log('open', { url: V2_URL, openMs });
  const t0 = Date.now();
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.e === 'status') log('reply', { ms: Date.now() - t0, frame: f });
    else if (f.r?.t === 'snapshot') log('reply', { ms: Date.now() - t0, snapshotFor: f.s, levels: `${f.r.b?.length}/${f.r.a?.length}`, frame: raw.length < 300 ? raw.toString() : undefined });
  });
  ws.on('close', (code, reason) => log('close', { ms: Date.now() - t0, code, reason: reason.toString() }));
  const frames = [
    ['unknown market', sub(['orderbook:nope_tl'], 'e1')],
    ['unknown channel', sub(['trades:btc_tl'], 'e2')],
    ['malformed', sub(['orderbook'], 'e3')],
    ['uppercase market', sub(['orderbook:BTC_TL'], 'e4')],
    ['user channel on stream', sub(['orders'], 'e5')],
    ['suspended and pre-launch markets', sub(['orderbook:agix_tl', 'orderbook:ton_tl'], 'e6')],
    ['mixed good and bad', sub(['book-ticker:eth_tl', 'orderbook:nope2_tl'], 'e7')],
    ['duplicate subscribe', sub(['book-ticker:eth_tl'], 'e8')],
    ['no id', sub(['match-price:eth_tl'])],
    ['id 65 chars', sub(['match-price:xrp_tl'], 'x'.repeat(65))],
    ['65 channels', sub(Array.from({ length: 65 }, (_, i) => `match-price:m${i}_tl`), 'e11')],
    ['empty channels', JSON.stringify({ method: 'subscribe', channels: [], id: 'e12' })],
    ['missing method', JSON.stringify({ channels: ['orderbook:btc_tl'], id: 'e13' })],
    ['invalid method', JSON.stringify({ method: 'sub', channels: ['orderbook:btc_tl'], id: 'e14' })],
    ['not json', 'hello'],
    ['unsubscribe', JSON.stringify({ method: 'unsubscribe', channels: ['book-ticker:eth_tl'], id: 'e16' })],
    ['unsubscribe never subscribed', JSON.stringify({ method: 'unsubscribe', channels: ['book-ticker:xrp_tl'], id: 'e17' })],
  ];
  for (const [label, frame] of frames) {
    log('send', { ms: Date.now() - t0, label });
    ws.send(frame);
    await sleep(400);
  }
  log('send', { ms: Date.now() - t0, label: 'twelve subscribe frames within about 120 ms' });
  for (let i = 0; i < 12; i++) ws.send(sub([`match-price:btc_tl`], `r${i}`));
  await sleep(3000);
  ws.close();
  await sleep(300);
}

async function batch() {
  const { open: markets } = await openMarkets();
  const list = markets;
  const { ws, openMs } = await open(V2_URL);
  log('open', { url: V2_URL, openMs, markets: list.length, openMarkets: markets.length });
  const trackers = new Map(list.map((m) => [m, newTracker()]));
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = [];
  let secFrames = 0;
  const statuses = [];
  let bookTickers = 0;
  let subAt = Date.now();
  const tick = setInterval(() => {
    perSecond.push(secFrames);
    secFrames = 0;
  }, 1000);
  ws.on('message', (raw) => {
    const now = Date.now();
    const t = process.hrtime.bigint();
    const f = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t;
    frames++;
    secFrames++;
    bytes += raw.length;
    if (f.r?.t === 'book-ticker') {
      bookTickers++;
      return;
    }
    if (f.e === 'status') {
      statuses.push({ ms: now - subAt, t: f.r.t, id: f.r.id, code: f.r.code, msg: f.r.msg, n: f.r.channels?.length });
      return;
    }
    const tr = trackers.get(f.s);
    if (tr) applyBookFrame(tr, f, now, subAt);
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  subAt = Date.now();
  for (let i = 0; i < list.length; i += 64) {
    ws.send(sub(list.slice(i, i + 64).map((m) => `orderbook:${m}`), `b${i / 64}`));
    await sleep(250);
  }
  // Book tickers on top push the channel count past the documented default cap of 256.
  ws.send(sub(list.slice(0, 64).map((m) => `book-ticker:${m}`), 'bt'));
  await sleep(60_000);
  clearInterval(tick);
  const all = [...trackers.values()];
  const withSnap = all.filter((t) => t.snapshots > 0).length;
  const snapTimes = all.filter((t) => t.firstSnapMs !== null).map((t) => t.firstSnapMs);
  log('batch_status', { statuses });
  log('batch_summary', {
    markets: list.length, bookTickers, withSnapshot: withSnap, lastSnapshotMs: Math.max(...snapTimes), frames, framesPerSecond: stats(perSecond.slice(2)),
    kbPerSecond: Math.round(bytes / 1024 / 60), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000,
    gaps: all.reduce((s, t) => s + t.gaps, 0), drops: all.reduce((s, t) => s + t.drops, 0), diffs: all.reduce((s, t) => s + t.diffs, 0),
    heartbeats: all.reduce((s, t) => s + t.heartbeats, 0), hbMismatch: all.reduce((s, t) => s + t.hbMismatch, 0),
    snapLevels: stats(all.filter((t) => t.snapshots).map((t) => Number(t.snapLevels[0].split('/')[0]))),
    snapLevelsAsk: stats(all.filter((t) => t.snapshots).map((t) => Number(t.snapLevels[0].split('/')[1]))),
    under20: all.filter((t) => t.snapshots && t.snapLevels[0].split('/').some((n) => Number(n) < 20)).length,
    maxFrameGapMs: stats(all.map((t) => (t.frameGaps.length ? Math.max(...t.frameGaps) : 0))),
    oneSidedAtEnd: all.filter((t) => t.snapshots && (t.bids.size === 0 || t.asks.size === 0)).length,
    crossedAtEnd: all.filter((t) => t.snapshots && t.bids.size && t.asks.size && Math.max(...[...t.bids.keys()].map(Number)) >= Math.min(...[...t.asks.keys()].map(Number))).length,
  });
  ws.close();
  await sleep(300);
}

async function silence() {
  const cases = [
    { name: 'auto pong, no subscription', autoPong: true, subscribe: false },
    { name: 'no pong, no subscription', autoPong: false, subscribe: false },
    { name: 'no pong, subscribed btc_tl', autoPong: false, subscribe: true },
    { name: 'auto pong, subscribed quiet market', autoPong: true, subscribe: true, quiet: true },
  ];
  const { open: markets, vol } = await openMarkets();
  const quiet = markets.filter((m) => m.endsWith('_tl') && vol.get(m) > 0).sort((a, b) => vol.get(a) - vol.get(b))[0];
  const results = await Promise.all(
    cases.map(async (c) => {
      const { ws, openMs, t0 } = await open(V2_URL, { autoPong: c.autoPong });
      const rec = { name: c.name, openMs, pings: [], frames: 0, close: null };
      ws.on('ping', () => rec.pings.push(Math.round((performance.now() - t0) / 100) / 10));
      ws.on('message', () => rec.frames++);
      if (c.subscribe) ws.send(sub([`orderbook:${c.quiet ? quiet : 'btc_tl'}`], 's'));
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          ws.close();
          resolve();
        }, SILENCE_MS);
        ws.on('close', (code, reason) => {
          rec.close = { atS: Math.round((performance.now() - t0) / 100) / 10, code, reason: reason.toString() };
          clearTimeout(timer);
          resolve();
        });
      });
      return rec;
    }),
  );
  for (const r of results) log('silence', r);
  log('silence_quiet_market', { quiet });
}

async function legacy() {
  const { ws, openMs } = await open(LEGACY_URL);
  log('open', { url: LEGACY_URL, openMs });
  const per = {};
  const acks = [];
  const diffSeqs = new Set();
  let diffDup = 0;
  let diffGap = 0;
  let lastDiff = null;
  const t0 = Date.now();
  ws.on('ping', () => (per.ping = (per.ping ?? 0) + 1));
  ws.on('message', (raw) => {
    const text = raw.toString();
    let f;
    try {
      f = JSON.parse(text);
    } catch {
      log('non_json', { text: text.slice(0, 200) });
      return;
    }
    if (f.code === 100 || f.code === 201) acks.push(text.slice(0, 160));
    if (f.event === 'diff') {
      const sq = f.data.seq;
      if (diffSeqs.has(sq)) diffDup++;
      else if (lastDiff !== null && sq !== lastDiff + 1) diffGap++;
      diffSeqs.add(sq);
      lastDiff = Math.max(lastDiff ?? sq, sq);
    }
    const key = f.e ?? f.event ?? f.chan ?? (f.error ? 'error' : f.price ? 'match' : Object.keys(f).join(','));
    const p = (per[key] ??= { n: 0, first: null, firstMs: null });
    p.n++;
    if (!p.first) {
      p.first = text.slice(0, 350);
      p.firstMs = Date.now() - t0;
    }
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  ws.send(sub(['orderbook-diff:btc_tl', 'ticker24h:btc_tl', 'book-ticker:btc_tl', 'orderbook:btc_tl', 'matches:btc_tl'], 'l1'));
  await sleep(500);
  ws.send(sub(['orderbook-diff:nope_tl'], 'l2'));
  await sleep(500);
  ws.send(sub(['nope:btc_tl'], 'l3'));
  await sleep(20_000);
  for (const [k, p] of Object.entries(per)) log('legacy_channel', { key: k, ...(typeof p === 'object' ? p : { n: p }) });
  log('legacy_acks', { acks });
  log('legacy_diff_seq', { distinct: diffSeqs.size, duplicates: diffDup, gaps: diffGap });
  ws.close();
  await sleep(300);
}

async function deflate() {
  for (const url of [V2_URL, LEGACY_URL]) {
    const ws = new WebSocket(url, { perMessageDeflate: true });
    const ext = await new Promise((resolve) => {
      ws.once('upgrade', (res) => resolve(res.headers['sec-websocket-extensions'] ?? null));
      ws.once('error', (e) => resolve(`error ${e.message}`));
    });
    log('deflate', { url, negotiated: ext });
    ws.close();
  }
  const ws = new WebSocket(V2_URL, { perMessageDeflate: false });
  const headers = await new Promise((resolve) => ws.once('upgrade', (res) => resolve(res.headers)));
  log('upgrade_headers', { server: headers.server, cfRay: headers['cf-ray'], extensions: headers['sec-websocket-extensions'] ?? null });
  ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const runs = { book, channels, errors, batch, silence, legacy, deflate };
if (!runs[mode]) throw new Error(`unknown mode ${mode}`);
log('start', { mode, at: new Date().toISOString() });
await runs[mode]();
log('done', { at: new Date().toISOString() });
