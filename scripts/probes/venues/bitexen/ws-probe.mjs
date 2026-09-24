// Bitexen WebSocket probe: the undocumented socket.io v2 feed that the bitexen.com web app reads, for the one order book market USDTTRY.
// Bitexen documents no WebSocket, so the event names come from the web app bundle (s_m, sd, m_b, m_s, m_l, m_t, s_t, ts, s_ml, sdl, m_tl).
// Public, unauthenticated, read-only: no login frame is sent. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitexen/ws-probe.mjs [book|errors|silence|deflate]
//   book     subscribes s_m USDTTRY for 60 s, counts events, checks side lengths and level order, compares the socket book with one REST book. About 65 s.
//   errors   emits s_m for an unknown market and a resell market, s_ml, s_t, and a frame that is not socket.io. About 20 s.
//   silence  three sockets for up to 90 s: no ping and no subscription, no ping with a subscription, a client ping every 25 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames (trimmed to 8 KB each). Recorded in docs/profiles/bitexen/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://www.bitexen.com/v2/socket.io/?EIO=3&transport=websocket';
const REST = 'https://www.bitexen.com/api/v1';
const MARKET = 'USDTTRY';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 8192) + '\n');
}

// Engine.io v3 packet types: 0 open, 2 ping, 3 pong, 4 message. Socket.io v2 packet types inside a message: 0 connect, 2 event.
function open(label, { deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate, headers: { Origin: 'https://www.bitexen.com' } });
  const s = { ws, label, t0, openMs: null, closed: null, frames: [], events: new Map(), handlers: [] };
  ws.on('upgrade', (res) => { s.extensions = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('open', () => { s.openMs = Date.now() - t0; });
  ws.on('message', (buf, isBinary) => {
    const text = isBinary ? `<binary ${buf.length}>` : buf.toString('utf8');
    const at = Date.now();
    s.frames.push({ at, len: buf.length, head: text.slice(0, 2), text: text.length <= 40 ? text : null });
    capture(`${label}.txt`, `${at} ${text}`);
    let ev = null;
    if (text.startsWith('42')) {
      try { ev = JSON.parse(text.slice(2)); } catch { ev = null; }
    }
    if (ev) s.events.set(ev[0], (s.events.get(ev[0]) ?? 0) + 1);
    for (const h of s.handlers) h(text, ev, at);
  });
  ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }; });
  ws.on('error', (e) => { s.error = e.message; });
  return s;
}

const emit = (s, name, ...args) => s.ws.send('42' + JSON.stringify([name, ...args]));
const waitOpen = async (s) => { for (let i = 0; i < 100 && s.openMs === null && !s.error; i++) await sleep(50); };

function sideCheck(levels, side) {
  // Each level is [amount, price] as strings, per the web app's mapper ([e,t]) => ({orders_total_amount:e, orders_price:t}).
  const prices = levels.map((l) => Number(l[1]));
  let ordered = true;
  for (let i = 1; i < prices.length; i++) {
    if (side === 'bid' ? prices[i] >= prices[i - 1] : prices[i] <= prices[i - 1]) ordered = false;
  }
  return { n: levels.length, ordered, first: levels[0] ?? null, last: levels.at(-1) ?? null };
}

async function book() {
  const s = open('book');
  await waitOpen(s);
  const got = { sd: [], m_b: [], m_s: [], m_l: [], m_t: [] };
  let lastBid = null, lastAsk = null, sdFirst = null, pingSentAt = null, pongMs = [];
  s.handlers.push((text, ev, at) => {
    if (text === '3' && pingSentAt) { pongMs.push(at - pingSentAt); pingSentAt = null; }
    if (!ev) return;
    const [name, data] = ev;
    if (name in got) got[name].push({ at, data });
    if (name === 'sd' && !sdFirst) sdFirst = { at, data };
    if (name === 'm_b' || (name === 'sd' && data?.b)) lastBid = name === 'sd' ? data.b : data;
    if (name === 'm_s' || (name === 'sd' && data?.s)) lastAsk = name === 'sd' ? data.s : data;
  });
  await sleep(500);
  const subAt = Date.now();
  emit(s, 's_m', MARKET);
  const ping = setInterval(() => { pingSentAt = Date.now(); s.ws.send('2'); }, 25_000);
  await sleep(60_000);
  clearInterval(ping);
  const restT0 = Date.now();
  const rest = await (await fetch(`${REST}/order_book/${MARKET}/`)).json();
  const restMs = Date.now() - restT0;
  s.ws.close();
  await sleep(300);

  log('open', { openMs: s.openMs, extensions: s.extensions, firstFrames: s.frames.slice(0, 3).map((f) => f.head) });
  log('events', { counts: Object.fromEntries(s.events), frames: s.frames.length, bytes: s.frames.reduce((a, f) => a + f.len, 0) });
  if (sdFirst) {
    const d = sdFirst.data;
    log('sd_first', { msAfterSubscribe: sdFirst.at - subAt, keys: Object.keys(d), bid: sideCheck(d.b ?? [], 'bid'), ask: sideCheck(d.s ?? [], 'ask'), trades: (d.l ?? []).length, lt: d.lt, firstTrade: d.l?.[0] ?? null, tickerLen: (d.t ?? []).length, ticker: d.t, bytes: JSON.stringify(d).length });
  } else {
    log('sd_first', { none: true });
  }
  for (const k of ['m_b', 'm_s']) {
    const arr = got[k];
    const lens = arr.map((x) => x.data.length);
    const gaps = arr.slice(1).map((x, i) => x.at - arr[i].at);
    const ordered = arr.every((x) => sideCheck(x.data, k === 'm_b' ? 'bid' : 'ask').ordered);
    let repeats = 0;
    for (let i = 1; i < arr.length; i++) if (JSON.stringify(arr[i].data) === JSON.stringify(arr[i - 1].data)) repeats++;
    log(k, { frames: arr.length, lenMin: Math.min(...lens), lenMax: Math.max(...lens), allOrdered: ordered, identicalToPrevious: repeats, gapMsMin: Math.min(...gaps), gapMsMedian: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)], gapMsMax: Math.max(...gaps), gapsOver600: gaps.filter((g) => g > 600).length });
  }
  log('m_t', { frames: got.m_t.length, sample: got.m_t[0]?.data ?? null });
  log('m_l', { frames: got.m_l.length, sample: got.m_l[0]?.data?.slice?.(0, 2) ?? null });
  log('pong', { pongMs });
  if (rest?.data && lastBid && lastAsk) {
    const rb = rest.data.buyers.map((l) => [l.orders_total_amount, l.orders_price]);
    const ra = rest.data.sellers.map((l) => [l.orders_total_amount, l.orders_price]);
    const match = (a, b, n) => { let m = 0; for (let i = 0; i < n; i++) if (a[i] && b[i] && a[i][0] === b[i][0] && a[i][1] === b[i][1]) m++; return m; };
    log('rest_compare', { restMs, restBids: rb.length, restAsks: ra.length, restBidOrder: sideCheck(rb, 'bid'), restAskOrder: sideCheck(ra, 'ask'), top10BidsEqual: match(rb, lastBid, 10), top10AsksEqual: match(ra, lastAsk, 10), wsTopBid: lastBid[0], restTopBid: rb[0], wsTopAsk: lastAsk[0], restTopAsk: ra[0] });
  }
  log('closed', s.closed ?? {});
}

async function errors() {
  const s = open('errors');
  await waitOpen(s);
  const seen = [];
  s.handlers.push((text, ev, at) => seen.push({ ms: at - s.t0, frame: text.slice(0, 220) }));
  await sleep(500);
  const steps = [
    ['s_m NOPETRY', () => emit(s, 's_m', 'NOPETRY')],
    ['s_m BTCTRY (resell market)', () => emit(s, 's_m', 'BTCTRY')],
    ['s_m lowercase usdttry', () => emit(s, 's_m', 'usdttry')],
    ['s_ml USDTTRY (light)', () => emit(s, 's_ml', MARKET)],
    ['s_t (all tickers)', () => emit(s, 's_t')],
    ['unknown event nope', () => emit(s, 'nope', MARKET)],
    ['not socket.io text', () => s.ws.send('hello')],
  ];
  for (const [label, fn] of steps) {
    const from = seen.length;
    const sentMs = Date.now() - s.t0;
    fn();
    await sleep(2500);
    const after = seen.slice(from);
    const names = {};
    for (const x of after) { const k = x.frame.startsWith('42') ? (x.frame.match(/^42\["([^"]+)"/)?.[1] ?? '42?') : x.frame.slice(0, 12); names[k] = (names[k] ?? 0) + 1; }
    log('step', { label, frames: after.length, names, first: after[0]?.frame ?? null, socketOpen: s.ws.readyState === 1 });
    if (s.ws.readyState !== 1) { await sleep(100); log('closed_after_step', { label, closeMsAfterSend: s.closed ? s.closed.atMs - sentMs : null }); break; }
  }
  log('opening', { openMs: s.openMs, frames: seen.slice(0, 2) });
  s.ws.close();
  await sleep(300);
  log('closed', s.closed ?? {});
}

async function silence() {
  const a = open('silent-nosub');
  const b = open('silent-sub');
  const c = open('ping-sub');
  await Promise.all([waitOpen(a), waitOpen(b), waitOpen(c)]);
  await sleep(500);
  emit(b, 's_m', MARKET);
  emit(c, 's_m', MARKET);
  const ping = setInterval(() => c.ws.send('2'), 25_000);
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000 && [a, b, c].some((s) => !s.closed)) await sleep(500);
  clearInterval(ping);
  for (const s of [a, b, c]) {
    const lastFrame = s.frames.at(-1);
    log('socket', { label: s.label, openMs: s.openMs, closed: s.closed, frames: s.frames.length, serverPings: s.frames.filter((f) => f.head === '2').length, pongs: s.frames.filter((f) => f.head === '3').length, lastFrameMs: lastFrame ? lastFrame.at - s.t0 : null, lastFrameText: lastFrame?.text ?? null });
    if (!s.closed) s.ws.close();
  }
  await sleep(300);
}

async function deflate() {
  const s = open('deflate', { deflate: true });
  await waitOpen(s);
  await sleep(1000);
  log('deflate', { openMs: s.openMs, extensions: s.extensions ?? null, error: s.error ?? null, firstFrame: s.frames[0]?.head ?? null });
  s.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, silence, deflate };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await modes[mode]();
process.exit(0);
