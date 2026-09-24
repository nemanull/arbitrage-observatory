// BigONE contract WebSocket probe: the URL-per-symbol depth channel, its sequence and level order, size unit against the REST book, error handshakes, the instruments channel, silence and keepalive, and the undocumented v3 realtime socket the web app uses.
// Public, unauthenticated and read-only.
// Never more than four sockets are open at once, because the documentation publishes a limit of 5 WebSocket connections per user.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bigone/ws-probe.mjs [book|errors|instruments|silence|v3|deflate]
//   book         depth@ on four contracts for 75 s, then a REST snapshot compare. About 80 s.
//   errors       one socket at a time: unknown, lowercase, disabled and inverse symbols, no symbol, unknown channel, a text frame. About 40 s.
//   instruments  the all-instruments channel for 30 s, cadence and fields. About 32 s.
//   silence      two sockets on a quiet contract for 120 s, one silent and one sending a protocol ping every 20 s.
//   v3           the undocumented wss://big.one/ws/contract/v3/realtime socket with a few topics, 30 s.
//   deflate      offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep the first frames of each stream.
// Recorded in docs/profiles/bigone/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS = 'wss://api.big.one/ws/contract/v2';
const REST = 'https://big.one/api/contract/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const trim = (s, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// Wire order of the price keys of one side, read from the raw text since a parsed object reorders integer-like keys.
function wireOrder(raw, side) {
  const m = new RegExp(`"${side}":\\{([^}]*)\\}`).exec(raw);
  if (!m) return 'absent';
  const keys = [...m[1].matchAll(/"([0-9.eE+-]+)"\s*:/g)].map((x) => Number(x[1]));
  if (keys.length < 2) return keys.length === 0 ? 'empty' : 'single';
  let desc = true;
  let asc = true;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] > keys[i - 1]) desc = false;
    if (keys[i] < keys[i - 1]) asc = false;
  }
  return desc ? 'descending' : asc ? 'ascending' : 'unordered';
}

function open(url, opts = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000, ...opts });
    ws.once('upgrade', (res) => {
      ws.upgradeHeaders = { extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server ?? null };
    });
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ ws: null, status: res.statusCode, body: trim(body, 200), openMs: Math.round(performance.now() - t0) }));
    });
    ws.once('error', (e) => resolve({ ws: null, error: e.message, openMs: Math.round(performance.now() - t0) }));
  });
}

async function book() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'SQQQUSDT'];
  const streams = new Map();
  for (const s of symbols) {
    const o = await open(`${WS}/depth@${s}`);
    if (!o.ws) {
      log('book_open_failed', { symbol: s, ...o });
      continue;
    }
    const st = {
      symbol: s, openMs: o.openMs, upgrade: o.ws.upgradeHeaders, openedAt: Date.now(), frames: 0, bytes: 0, binary: 0,
      snapshots: 0, deltas: 0, lastTo: null, chain: 0, gapHist: {}, overlap: 0, emptyDeltas: 0, repeats: 0, prevText: '',
      bids: new Map(), asks: new Map(), maxLevels: [0, 0], minLevelsAfterSnap: [Infinity, Infinity], bestMismatch: 0,
      order: {}, zeroSizes: 0, valueTypes: new Set(), maxGapMs: 0, lastAt: null, pings: 0, parseUs: [], keys: new Set(), firstFrameMs: null, crossed: 0,
    };
    st.ws = o.ws;
    streams.set(s, st);
    o.ws.on('ping', () => st.pings++);
    o.ws.on('close', (code) => log('book_close', { symbol: s, code, afterMs: Date.now() - st.openedAt }));
    o.ws.on('message', (data, isBinary) => {
      const now = Date.now();
      const text = data.toString('utf8');
      if (isBinary) st.binary++;
      st.frames++;
      st.bytes += data.length;
      if (st.lastAt !== null) st.maxGapMs = Math.max(st.maxGapMs, now - st.lastAt);
      else st.firstFrameMs = now - st.openedAt;
      st.lastAt = now;
      if (text === st.prevText) st.repeats++;
      st.prevText = text;
      const t0 = performance.now();
      const j = JSON.parse(text);
      st.parseUs.push(Math.round((performance.now() - t0) * 1000));
      for (const k of Object.keys(j)) st.keys.add(k);
      if (st.frames <= 3) capture(`depth-${s}.jsonl`, trim(text, 1500));
      for (const side of ['bids', 'asks']) {
        const o2 = wireOrder(text, side);
        const k = `${j.from === 0 ? 'snapshot' : 'delta'} ${side} ${o2}`;
        st.order[k] = (st.order[k] ?? 0) + 1;
        for (const v of Object.values(j[side] ?? {})) st.valueTypes.add(typeof v);
      }
      if (j.from === 0) {
        st.snapshots++;
        st.bids = new Map(Object.entries(j.bids ?? {}).map(([p, q]) => [Number(p), Number(q)]));
        st.asks = new Map(Object.entries(j.asks ?? {}).map(([p, q]) => [Number(p), Number(q)]));
        if (st.snapshots === 1) log('book_snapshot', { symbol: s, to: j.to, bidLevels: st.bids.size, askLevels: st.asks.size, bestPrices: j.bestPrices, firstFrameMs: st.firstFrameMs });
      } else {
        st.deltas++;
        if (st.lastTo !== null) {
          const gap = j.from - st.lastTo;
          const b = gap === 1 ? '1' : gap === 0 ? '0' : gap < 0 ? '<0' : gap <= 10 ? '2-10' : gap <= 1000 ? '11-1000' : '>1000';
          if (st.deltas <= 4) log('book_ids', { symbol: s, prevTo: st.lastTo, from: j.from, to: j.to, span: j.to - j.from });
          st.gapHist[b] = (st.gapHist[b] ?? 0) + 1;
          if (gap === 1) st.chain++;
        }
        const nb = Object.keys(j.bids ?? {}).length;
        const na = Object.keys(j.asks ?? {}).length;
        if (nb + na === 0) st.emptyDeltas++;
        for (const [p, q] of Object.entries(j.bids ?? {})) {
          if (Number(q) === 0) { st.zeroSizes++; st.bids.delete(Number(p)); } else st.bids.set(Number(p), Number(q));
        }
        for (const [p, q] of Object.entries(j.asks ?? {})) {
          if (Number(q) === 0) { st.zeroSizes++; st.asks.delete(Number(p)); } else st.asks.set(Number(p), Number(q));
        }
        st.minLevelsAfterSnap = [Math.min(st.minLevelsAfterSnap[0], st.bids.size), Math.min(st.minLevelsAfterSnap[1], st.asks.size)];
      }
      if (j.to - j.from > 0 && j.from !== 0) st.overlap++;
      if (j.from !== 0) st.spanMax = Math.max(st.spanMax ?? 0, j.to - j.from);
      st.lastTo = j.to;
      st.maxLevels = [Math.max(st.maxLevels[0], st.bids.size), Math.max(st.maxLevels[1], st.asks.size)];
      const bb = st.bids.size ? Math.max(...st.bids.keys()) : null;
      const ba = st.asks.size ? Math.min(...st.asks.keys()) : null;
      if (bb !== null && ba !== null && bb >= ba) st.crossed++;
      if (j.bestPrices && (Number(j.bestPrices.bid) !== bb || Number(j.bestPrices.ask) !== ba)) {
        st.bestMismatch++;
        if (st.bestMismatch <= 2) log('book_best_mismatch', { symbol: s, from: j.from, wire: j.bestPrices, local: { bid: bb, ask: ba } });
      }
    });
  }
  await sleep(75_000);

  // REST compare: sizes at the touch and the next levels against the local book, read at about the same instant.
  for (const st of streams.values()) {
    const res = await fetch(`${REST}/depth@${st.symbol}/snapshot`);
    const j = await res.json();
    let same = 0;
    let compared = 0;
    for (const [side, local] of [['bids', st.bids], ['asks', st.asks]]) {
      for (const [p, q] of Object.entries(j[side])) {
        compared++;
        if (local.get(Number(p)) === Number(q)) same++;
      }
    }
    const bb = Math.max(...st.bids.keys());
    const ba = Math.min(...st.asks.keys());
    log('book_rest_compare', { symbol: st.symbol, restTo: j.to, localTo: st.lastTo, restLevels: [Object.keys(j.bids).length, Object.keys(j.asks).length], localLevels: [st.bids.size, st.asks.size], sameSizeAtSamePrice: `${same}/${compared}`, localTouch: { bid: [bb, st.bids.get(bb)], ask: [ba, st.asks.get(ba)] }, restTouch: j.bestPrices });
  }
  for (const [s, st] of streams) {
    const secs = (Date.now() - st.openedAt) / 1000;
    log('book_summary', {
      symbol: s, openMs: st.openMs, upgrade: st.upgrade, frames: st.frames, perSec: Math.round((st.frames / secs) * 10) / 10, bytesPerSec: Math.round(st.bytes / secs), binary: st.binary,
      snapshots: st.snapshots, deltas: st.deltas, chainFromEqualsPrevToPlus1: st.chain, fromMinusPrevTo: st.gapHist, spanMax: st.spanMax, multiIdDeltas: st.overlap, emptyDeltas: st.emptyDeltas, identicalRepeats: st.repeats,
      zeroSizes: st.zeroSizes, maxLevels: st.maxLevels, minLevelsAfterSnapshot: st.minLevelsAfterSnap, bestPricesMismatch: st.bestMismatch, crossedLocal: st.crossed,
      order: st.order, valueTypes: [...st.valueTypes], keys: [...st.keys], maxGapMs: st.maxGapMs, serverPings: st.pings, parseUsMedian: pct(st.parseUs, 50),
    });
  }
  for (const st of streams.values()) st.ws.terminate();
}

async function errors() {
  const cases = [
    ['unknown symbol', `${WS}/depth@NOPEUSDT`],
    ['lowercase symbol', `${WS}/depth@btcusdt`],
    ['disabled symbol', `${WS}/depth@EOSUSDT`],
    ['inverse symbol', `${WS}/depth@BTCUSD`],
    ['depth without symbol', `${WS}/depth`],
    ['unknown channel', `${WS}/nope@BTCUSDT`],
    ['CCXT host big.one', 'wss://big.one/ws/contract/v2/depth@BTCUSDT'],
    ['intro page base', 'wss://api.big.one/ws/v2'],
  ];
  for (const [name, url] of cases) {
    const o = await open(url);
    if (!o.ws) {
      log('ws_error_case', { name, url, status: o.status ?? null, body: o.body ?? null, error: o.error ?? null, ms: o.openMs });
      continue;
    }
    const got = [];
    let closed = null;
    o.ws.on('message', (d) => got.push(trim(d.toString('utf8'), 160)));
    o.ws.on('close', (code, reason) => (closed = { code, reason: reason.toString() }));
    await sleep(4000);
    log('ws_error_case', { name, url, status: 101, ms: o.openMs, frames: got.length, first: got[0] ?? null, closed });
    o.ws.terminate();
    await sleep(300);
  }
  // Text frames on an open depth socket, one at a time, so each reply can be attributed.
  const o = await open(`${WS}/depth@ETHUSDT`);
  const replies = [];
  let closed = null;
  let current = null;
  o.ws.on('message', (d) => {
    const t = d.toString('utf8');
    if (!t.includes('"bestPrices"')) replies.push({ after: current, text: trim(t, 120) });
  });
  o.ws.on('close', (code, reason) => (closed = { code, reason: reason.toString() }));
  await sleep(1500);
  for (const frame of ['hello', 'ping', JSON.stringify({ op: 'subscribe', args: [{ topic: 'depth', symbol: 'BTCUSDT' }] }), JSON.stringify({ ping: 1 })]) {
    current = frame;
    const t0 = Date.now();
    o.ws.send(frame);
    await sleep(2000);
    log('ws_text_frame', { sent: frame, replies: replies.filter((r) => r.after === frame).map((r) => r.text), closed, waitedMs: Date.now() - t0 });
  }
  o.ws.terminate();
}

async function instruments() {
  const o = await open(`${WS}/instruments`);
  if (!o.ws) return log('instruments_open_failed', o);
  const t0 = Date.now();
  const frames = [];
  const perSymbol = new Map();
  o.ws.on('message', (d) => {
    const now = Date.now() - t0;
    const text = d.toString('utf8');
    const j = JSON.parse(text);
    const rows = Array.isArray(j) ? j : [j];
    frames.push({ at: now, rows: rows.length, bytes: d.length });
    if (frames.length <= 2) capture('instruments.jsonl', trim(text, 1200));
    for (const r of rows) {
      const p = perSymbol.get(r.symbol) ?? { n: 0, idx: new Set(), keys: new Set() };
      p.n++;
      p.idx.add(r.indexPrice);
      for (const k of Object.keys(r)) p.keys.add(k);
      perSymbol.set(r.symbol, p);
    }
  });
  await sleep(30_000);
  o.ws.terminate();
  const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at);
  log('instruments_channel', {
    openMs: o.openMs, frames: frames.length, rowsPerFrame: { min: Math.min(...frames.map((f) => f.rows)), max: Math.max(...frames.map((f) => f.rows)) }, firstRows: frames[0]?.rows,
    bytesMedian: pct(frames.map((f) => f.bytes), 50), gapMs: { min: pct(gaps, 0), median: pct(gaps, 50), max: pct(gaps, 100) }, symbols: perSymbol.size,
    btc: perSymbol.has('BTCUSDT') ? { rows: perSymbol.get('BTCUSDT').n, distinctIndex: perSymbol.get('BTCUSDT').idx.size } : null,
    keys: perSymbol.size ? [...[...perSymbol.values()][0].keys] : [],
  });
}

async function silence() {
  const quiet = 'SQQQUSDT';
  const a = await open(`${WS}/depth@${quiet}`);
  const b = await open(`${WS}/depth@${quiet}`);
  const t0 = Date.now();
  const st = { a: { frames: 0, pings: 0, close: null, lastFrameAt: null, maxGap: 0 }, b: { frames: 0, pings: 0, pongs: [], close: null, lastFrameAt: null, maxGap: 0 } };
  for (const [k, o] of [['a', a], ['b', b]]) {
    o.ws.on('message', () => {
      const now = Date.now() - t0;
      const s = st[k];
      if (s.lastFrameAt !== null) s.maxGap = Math.max(s.maxGap, now - s.lastFrameAt);
      s.lastFrameAt = now;
      s.frames++;
    });
    o.ws.on('ping', () => st[k].pings++);
    o.ws.on('close', (code) => (st[k].close = { code, atMs: Date.now() - t0 }));
  }
  let pingSentAt = 0;
  b.ws.on('pong', () => st.b.pongs.push(Date.now() - pingSentAt));
  const timer = setInterval(() => {
    if (b.ws.readyState === WebSocket.OPEN) {
      pingSentAt = Date.now();
      b.ws.ping();
    }
  }, 20_000);
  await sleep(120_000);
  clearInterval(timer);
  for (const k of ['a', 'b']) {
    const s = st[k];
    const lastFrameAt = s.lastFrameAt;
    log('silence', { socket: k === 'a' ? 'silent client' : 'protocol ping every 20 s', symbol: quiet, frames: s.frames, serverPings: s.pings, pongRttMs: s.pongs ?? null, close: s.close, maxGapBetweenFramesMs: s.maxGap, tailSilenceMs: lastFrameAt === null ? null : 120_000 - lastFrameAt, heldMs: Date.now() - t0 });
  }
  a.ws.terminate();
  b.ws.terminate();
}

async function v3() {
  const o = await open('wss://big.one/ws/contract/v3/realtime');
  if (!o.ws) return log('v3_open_failed', o);
  const got = [];
  o.ws.on('message', (d, isBinary) => got.push({ at: Date.now(), binary: isBinary, text: d.toString('utf8') }));
  o.ws.on('close', (code, reason) => log('v3_close', { code, reason: reason.toString() }));
  const subs = [
    { topic: 'instruments', symbol: 'BTCUSDT', gid: '1' },
    { topic: 'depth', symbol: 'BTCUSDT', gid: '2' },
    { topic: 'orderbook', symbol: 'ETHUSDT', gid: '3' },
    { topic: 'trades', symbol: 'BTCUSDT', gid: '4' },
    { topic: 'depth', symbol: 'NOPEUSDT', gid: '5' },
    { topic: 'orderBook', symbol: 'BTCUSDT', gid: '6' },
    { topic: 'book', symbol: 'BTCUSDT', gid: '7' },
    { topic: 'depths', symbol: 'BTCUSDT', gid: '8' },
    { topic: 'candlesticks', symbol: 'BTCUSDT', period: '1MIN', gid: '9' },
    { topic: 'instruments', symbol: 'NOPEUSDT', gid: '10' },
  ];
  for (const a of subs) {
    o.ws.send(JSON.stringify({ op: 'subscribe', args: [a] }));
    await sleep(300);
  }
  await sleep(20_000);
  o.ws.terminate();
  const byGid = {};
  const other = [];
  for (const g of got) {
    let j;
    try { j = JSON.parse(g.text); } catch { other.push(trim(g.text, 200)); continue; }
    const gid = j.arg?.gid ?? j.gid ?? 'none';
    const b = (byGid[gid] ??= { frames: 0, first: null, keys: null });
    b.frames++;
    if (!b.first) { b.first = trim(g.text, 500); b.keys = Object.keys(j); }
    if (b.frames <= 2) capture('v3.jsonl', trim(g.text, 1500));
  }
  log('v3', { openMs: o.openMs, frames: got.length, binary: got.filter((g) => g.binary).length, byGid, other: other.slice(0, 3) });
}

async function deflate() {
  const o = await open(`${WS}/depth@BTCUSDT`, { perMessageDeflate: true });
  if (!o.ws) return log('deflate_open_failed', o);
  let n = 0;
  o.ws.on('message', () => n++);
  await sleep(3000);
  log('deflate', { offered: 'permessage-deflate', negotiated: o.ws.upgradeHeaders?.extensions ?? null, extensionsObject: Object.keys(o.ws.extensions ?? {}), frames: n, openMs: o.openMs });
  o.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, instruments, silence, v3, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('mode', { name: mode, at: new Date().toISOString() });
await modes[mode]();
process.exit(0);
