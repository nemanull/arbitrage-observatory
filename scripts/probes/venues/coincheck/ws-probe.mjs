// Coincheck public WebSocket probe: the orderbook channel on every pair, diff semantics against the REST book, level order, cadence, errors, keepalive, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coincheck/ws-probe.mjs [book|errors|silence|deflate]
//   book     every pair's orderbook channel and btc_jpy-trades on one socket for 60 s, with REST books of btc_jpy and eth_jpy at 3, 20, 38 and 55 s. About 62 s.
//   errors   non-JSON text, unknown type, unknown and delisted pairs, a duplicate subscribe, an unsubscribe, an array channel and the plural channels form. About 26 s.
//   silence  two unsubscribed sockets for up to 80 s, one silent and one sending a protocol ping every 20 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/coincheck/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws-api.coincheck.com/';
const API = 'https://coincheck.com/api';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null;
};
const stats = (xs) => ({ n: xs.length, min: pct(xs, 0), p10: pct(xs, 0.1), median: pct(xs, 0.5), p90: pct(xs, 0.9), max: pct(xs, 1) });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(deflate = false) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
    let upgrade = null;
    ws.on('upgrade', (res) => (upgrade = res.headers));
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0), upgrade }));
    ws.once('error', reject);
  });
}

async function restBook(pair) {
  const sent = Date.now();
  const res = await fetch(`${API}/order_books?pair=${pair}`);
  const json = await res.json();
  return { sent, arrived: Date.now(), bids: json.bids, asks: json.asks };
}

function toMap(levels) {
  const m = new Map();
  for (const [p, s] of levels) m.set(Number(p), Number(s));
  return m;
}

function apply(book, frame) {
  for (const [p, s] of frame.bids ?? []) (Number(s) === 0 ? book.bids.delete(Number(p)) : book.bids.set(Number(p), Number(s)));
  for (const [p, s] of frame.asks ?? []) (Number(s) === 0 ? book.asks.delete(Number(p)) : book.asks.set(Number(p), Number(s)));
}

function top(map, n, desc) {
  return [...map.entries()].sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, n);
}

// Counts how many of the reference's top n levels the candidate book holds at the same price and size.
function compare(book, ref, n) {
  const side = (mine, theirs, desc) => {
    const want = top(theirs, n, desc);
    let price = 0;
    let exact = 0;
    for (const [p, s] of want) {
      if (mine.has(p)) {
        price++;
        if (Math.abs(mine.get(p) - s) < 1e-12) exact++;
      }
    }
    const mineTop = top(mine, n, desc);
    const extra = mineTop.filter(([p]) => !theirs.has(p) && (desc ? p >= want[want.length - 1]?.[0] : p <= want[want.length - 1]?.[0])).length;
    return { price, exact, extraInsideRange: extra, best: mineTop[0]?.[0], refBest: want[0]?.[0] };
  };
  return { bids: side(book.bids, ref.bids, true), asks: side(book.asks, ref.asks, false) };
}

async function book() {
  const status = await (await fetch(`${API}/exchange_status`)).json();
  const pairs = status.exchange_status.map((r) => r.pair);
  const { ws, openMs, upgrade } = await open();
  log('open', { openMs, extensions: upgrade?.['sec-websocket-extensions'] ?? null, pairs: pairs.length });
  const t0 = Date.now();
  const per = new Map(pairs.map((p) => [p, { frames: 0, first: null, firstBids: null, firstAsks: null, maxBids: 0, maxAsks: 0, zero: 0, levels: 0, gaps: [], last: null, lag: [], unorderedBids: 0, unorderedAsks: 0, repeats: 0, prev: null, oneSided: 0, dupPrice: 0, zeroAfterNonZero: 0, groupUnsorted: 0 }]));
  const others = [];
  let trades = 0;
  let bytes = 0;
  let frames = 0;
  let parseNs = 0n;
  let serverPings = 0;
  const perSecond = new Map();
  const tracked = ['btc_jpy', 'eth_jpy'];
  const streamOnly = new Map(tracked.map((p) => [p, { bids: new Map(), asks: new Map() }]));
  const buffered = new Map(tracked.map((p) => [p, []]));
  ws.on('ping', () => serverPings++);
  ws.on('message', (data) => {
    const arrived = Date.now();
    const text = data.toString('utf8');
    bytes += text.length;
    frames++;
    const sec = Math.floor((arrived - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const a = process.hrtime.bigint();
    const msg = JSON.parse(text);
    parseNs += process.hrtime.bigint() - a;
    if (Array.isArray(msg) && Array.isArray(msg[0])) {
      trades++;
      if (trades <= 2) capture('frames.txt', 'trades ' + text.slice(0, 400));
      return;
    }
    if (!Array.isArray(msg) || typeof msg[0] !== 'string') {
      if (others.length < 10) others.push(text.slice(0, 200));
      return;
    }
    const [pair, body] = msg;
    const s = per.get(pair);
    if (!s) {
      if (others.length < 10) others.push(text.slice(0, 200));
      return;
    }
    s.frames++;
    const nb = body.bids?.length ?? 0;
    const na = body.asks?.length ?? 0;
    if (s.first === null) {
      s.first = arrived - t0;
      s.firstBids = nb;
      s.firstAsks = na;
      capture('frames.txt', 'first ' + text.slice(0, 600));
    } else if (s.frames <= 3) capture('frames.txt', 'delta ' + text.slice(0, 600));
    s.maxBids = Math.max(s.maxBids, nb);
    s.maxAsks = Math.max(s.maxAsks, na);
    if (nb === 0 || na === 0) s.oneSided++;
    for (const l of [...(body.bids ?? []), ...(body.asks ?? [])]) {
      s.levels++;
      if (Number(l[1]) === 0) s.zero++;
    }
    const bp = (body.bids ?? []).map((l) => Number(l[0]));
    const ap = (body.asks ?? []).map((l) => Number(l[0]));
    if (bp.some((p, i) => i > 0 && p >= bp[i - 1])) s.unorderedBids++;
    if (ap.some((p, i) => i > 0 && p <= ap[i - 1])) s.unorderedAsks++;
    for (const side of [body.bids ?? [], body.asks ?? []]) {
      if (new Set(side.map((l) => l[0])).size !== side.length) s.dupPrice++;
      const firstNonZero = side.findIndex((l) => Number(l[1]) !== 0);
      if (firstNonZero >= 0 && side.slice(firstNonZero).some((l) => Number(l[1]) === 0)) s.zeroAfterNonZero++;
    }
    const groupSorted = (side, desc) => [0, 1].every((g) => {
      const ps = side.filter((l) => (Number(l[1]) === 0) === (g === 0)).map((l) => Number(l[0]));
      return ps.every((p, i) => i === 0 || (desc ? p < ps[i - 1] : p > ps[i - 1]));
    });
    if (!groupSorted(body.bids ?? [], true) || !groupSorted(body.asks ?? [], false)) s.groupUnsorted++;
    const key = JSON.stringify([body.bids, body.asks]);
    if (key === s.prev) s.repeats++;
    s.prev = key;
    if (s.last !== null) s.gaps.push(arrived - s.last);
    s.last = arrived;
    s.lag.push(arrived - Number(body.last_update_at) * 1000);
    if (streamOnly.has(pair)) {
      apply(streamOnly.get(pair), body);
      buffered.get(pair).push({ arrived, body });
    }
  });
  ws.on('close', (code) => log('closed', { code, atMs: Date.now() - t0 }));
  for (const p of pairs) ws.send(JSON.stringify({ type: 'subscribe', channel: `${p}-orderbook` }));
  ws.send(JSON.stringify({ type: 'subscribe', channel: 'btc_jpy-trades' }));
  log('subscribed', { frames: pairs.length + 1, sendMs: Date.now() - t0 });

  await sleep(3000);
  const r0 = {};
  for (const p of tracked) r0[p] = await restBook(p);
  // Later REST books are compared with the r0 book kept up to date from the socket, since no frame carries a sequence id to align on.
  const refs = [];
  for (const at of [20000, 38000, 55000]) {
    await sleep(Math.max(0, t0 + at - Date.now()));
    const r = {};
    for (const p of tracked) r[p] = await restBook(p);
    refs.push({ at, r });
  }
  await sleep(Math.max(0, t0 + 60000 - Date.now()));
  ws.close();

  const durS = (Date.now() - t0) / 1000;
  const brief = (c) => ({ bids: `${c.bids.exact}/${c.bids.price}`, asks: `${c.asks.exact}/${c.asks.price}`, bestBid: c.bids.best === c.bids.refBest, bestAsk: c.asks.best === c.asks.refBest, extra: c.bids.extraInsideRange + c.asks.extraInsideRange });
  for (const p of tracked) {
    const maintained = (from, to, ref) => {
      const b = { bids: toMap(r0[p].bids), asks: toMap(r0[p].asks) };
      let crossed = 0;
      for (const f of buffered.get(p)) {
        if (f.arrived < from || f.arrived > to) continue;
        apply(b, f.body);
        const bb = top(b.bids, 1, true)[0]?.[0];
        const ba = top(b.asks, 1, false)[0]?.[0];
        if (bb !== undefined && ba !== undefined && bb >= ba) crossed++;
      }
      // A level the kept book holds inside the reference's top 20 range but the reference lacks, and when a later frame next touched that price.
      const fate = [];
      for (const [side, desc] of [['bids', true], ['asks', false]]) {
        const want = top(ref[side], 20, desc);
        const edge = want[want.length - 1]?.[0];
        for (const [price] of top(b[side], 20, desc)) {
          if (ref[side].has(price) || edge === undefined || (desc ? price < edge : price > edge)) continue;
          const next = buffered.get(p).find((f) => f.arrived > to && (f.body[side] ?? []).some((l) => Number(l[0]) === price));
          const lvl = next && next.body[side].find((l) => Number(l[0]) === price);
          fate.push({ side, price, nextTouchMs: next ? next.arrived - to : null, nextSize: lvl ? lvl[1] : null });
        }
      }
      return { ...brief(compare(b, ref, 20)), top50: brief(compare(b, ref, 50)), crossed, fate };
    };
    const checks = refs.map(({ at, r }) => {
      const ref = { bids: toMap(r[p].bids), asks: toMap(r[p].asks) };
      const nearest = Math.min(...buffered.get(p).map((f) => Math.abs(f.arrived - r[p].sent)));
      return {
        atS: at / 1000,
        restMs: r[p].arrived - r[p].sent,
        nearestFrameMs: nearest,
        toRequest: (({ fate, ...rest }) => rest)(maintained(r0[p].arrived, r[p].sent, ref)),
        toReplyPlus500: maintained(r0[p].arrived, r[p].arrived + 500, ref),
        fromR0Request: (({ fate, top50, ...rest }) => rest)(maintained(r0[p].sent, r[p].sent, ref)),
        r0Unchanged: brief(compare({ bids: toMap(r0[p].bids), asks: toMap(r0[p].asks) }, ref, 20)),
      };
    });
    const last = refs[refs.length - 1].r[p];
    log('diff_check', {
      pair: p,
      r0: { restMs: r0[p].arrived - r0[p].sent, levels: `${r0[p].bids.length}/${r0[p].asks.length}` },
      checks,
      streamOnlyTop20: brief(compare(streamOnly.get(p), { bids: toMap(last.bids), asks: toMap(last.asks) }, 20)),
      streamOnlyLevels: `${streamOnly.get(p).bids.size}/${streamOnly.get(p).asks.size}`,
    });
  }

  const rows = [...per.entries()].map(([pair, s]) => ({ pair, frames: s.frames, firstMs: s.first, first: `${s.firstBids}/${s.firstAsks}`, max: `${s.maxBids}/${s.maxAsks}`, levels: s.levels, zero: s.zero, oneSided: s.oneSided, repeats: s.repeats, dupPrice: s.dupPrice, zeroAfterNonZero: s.zeroAfterNonZero, groupUnsorted: s.groupUnsorted, unordered: `${s.unorderedBids}/${s.unorderedAsks}`, maxGapMs: s.gaps.length ? Math.max(...s.gaps) : null, medianGapMs: pct(s.gaps, 0.5), lagMs: s.lag.length ? { min: pct(s.lag, 0), median: pct(s.lag, 0.5), max: pct(s.lag, 1) } : null }));
  for (const r of rows) log('pair', r);
  const counts = [...perSecond.values()];
  log('summary', {
    durS: +durS.toFixed(1),
    frames,
    bookFrames: rows.reduce((a, r) => a + r.frames, 0),
    tradeFrames: trades,
    pairsWithFrames: rows.filter((r) => r.frames > 0).length,
    pairsSilent: rows.filter((r) => r.frames === 0).map((r) => r.pair),
    framesPerSecond: stats(counts),
    bytesPerSecond: Math.round(bytes / durS),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: +(Number(parseNs) / 1000 / Math.max(1, frames)).toFixed(1),
    serverPings,
    others,
    firstFrameMs: stats(rows.filter((r) => r.firstMs !== null).map((r) => r.firstMs)),
    firstFrameLevels: stats(rows.filter((r) => r.firstMs !== null).map((r) => Number(r.first.split('/')[0]) + Number(r.first.split('/')[1]))),
    btcGapMs: stats(per.get('btc_jpy').gaps),
    zeroShare: +(rows.reduce((a, r) => a + r.zero, 0) / Math.max(1, rows.reduce((a, r) => a + r.levels, 0))).toFixed(3),
    unorderedFrames: rows.reduce((a, r) => a + Number(r.unordered.split('/')[0]) + Number(r.unordered.split('/')[1]), 0),
    repeats: rows.reduce((a, r) => a + r.repeats, 0),
    dupPriceFrames: rows.reduce((a, r) => a + r.dupPrice, 0),
    zeroAfterNonZeroSides: rows.reduce((a, r) => a + r.zeroAfterNonZero, 0),
    groupUnsortedFrames: rows.reduce((a, r) => a + r.groupUnsorted, 0),
  });
}

async function errors() {
  const { ws, openMs } = await open();
  const t0 = Date.now();
  const counts = new Map();
  const lastText = new Map();
  let phase = 'start';
  let closed = null;
  ws.on('message', (data) => {
    const text = data.toString('utf8');
    let msg = null;
    try {
      msg = JSON.parse(text);
    } catch {}
    if (Array.isArray(msg) && typeof msg[0] === 'string') {
      const k = `${phase}:${msg[0]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (text === lastText.get(msg[0])) counts.set(k + ':identical_to_previous', (counts.get(k + ':identical_to_previous') ?? 0) + 1);
      lastText.set(msg[0], text);
      return;
    }
    log('non_book_frame', { phase, atMs: Date.now() - t0, text: text.slice(0, 200) });
  });
  ws.on('close', (code, reason) => (closed = { code, reason: reason.toString(), atMs: Date.now() - t0, phase }));
  log('open', { openMs });
  const step = async (name, frames, waitMs) => {
    phase = name;
    for (const f of frames) if (ws.readyState === ws.OPEN) ws.send(typeof f === 'string' ? f : JSON.stringify(f));
    await sleep(waitMs);
    log('phase', { name, readyState: ws.readyState, counts: Object.fromEntries([...counts.entries()].filter(([k]) => k.startsWith(name + ':'))) });
  };
  await step('garbage', ['hello', { type: 'nope' }, { foo: 1 }], 2000);
  await step('bad_pairs', [{ type: 'subscribe', channel: 'nope_jpy-orderbook' }, { type: 'subscribe', channel: 'BTC_JPY-orderbook' }, { type: 'subscribe', channel: 'fct_jpy-orderbook' }, { type: 'subscribe', channel: 'etc_btc-orderbook' }, { type: 'subscribe', channel: 'btc_jpy-nope' }], 3000);
  await step('sub_once', [{ type: 'subscribe', channel: 'btc_jpy-orderbook' }], 4000);
  await step('sub_twice', [{ type: 'subscribe', channel: 'btc_jpy-orderbook' }], 4000);
  await step('unsubscribe', [{ type: 'unsubscribe', channel: 'btc_jpy-orderbook' }], 4000);
  await step('array_channel', [{ type: 'subscribe', channel: ['eth_jpy-orderbook', 'xrp_jpy-orderbook'] }], 3000);
  // The private API documents a plural channels array, so the public socket is asked the same way.
  await step('channels_plural', [{ type: 'subscribe', channels: ['eth_jpy-orderbook', 'xrp_jpy-orderbook'] }], 3000);
  await step('unsubscribe_plural', [{ type: 'unsubscribe', channels: ['btc_jpy-orderbook'] }], 3000);
  log('errors_end', { closed, readyState: ws.readyState });
  ws.close();
}

async function silence() {
  const t0 = Date.now();
  const sockets = [
    { name: 'silent_unsubscribed', ping: false },
    { name: 'protocol_ping_20s', ping: true },
  ];
  await Promise.all(
    sockets.map(async (s) => {
      const { ws, openMs } = await open();
      let serverPings = 0;
      let pongs = 0;
      let frames = 0;
      ws.on('ping', () => serverPings++);
      ws.on('pong', () => pongs++);
      ws.on('message', () => frames++);
      const timer = s.ping ? setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 20000) : null;
      const result = await new Promise((resolve) => {
        const cap = setTimeout(() => resolve({ closed: false, atMs: Date.now() - t0 }), 80000);
        ws.on('close', (code, reason) => {
          clearTimeout(cap);
          resolve({ closed: true, code, reason: reason.toString(), atMs: Date.now() - t0 });
        });
      });
      if (timer) clearInterval(timer);
      if (ws.readyState === ws.OPEN) ws.close();
      log('silence', { socket: s.name, openMs, ...result, serverPings, pongs, frames });
    }),
  );
}

async function deflate() {
  const { ws, openMs, upgrade } = await open(true);
  log('deflate', { openMs, offered: 'permessage-deflate; client_max_window_bits', negotiated: upgrade?.['sec-websocket-extensions'] ?? null });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await book();
if (mode === 'errors') await errors();
if (mode === 'silence') await silence();
if (mode === 'deflate') await deflate();
log('end', { at: new Date().toISOString() });
