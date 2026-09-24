// Azbit WebSocket probe: the futures book snapshot channel, its cadence, level count and order, repeats, error replies,
// every futures pair on one connection, keepalive and silence, deflate, and the lag of each Azbit book frame behind the
// identical book on Bybit's public linear socket, since the Azbit futures book looks like a copy of Bybit's.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/azbit/ws-probe.mjs [book|batch|session|deflate]
//   book     snapshots on six futures pairs for 60 s beside Bybit orderbook.50 on three of them, plus error cases. About 65 s.
//   batch    snapshots on every futures pair on one connection for 45 s.
//   session  three unsubscribed futures sockets for 75 s that differ in what the client sends, one subscribed for 120 s, and the /ping and /time routes. About 125 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/azbit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS = 'wss://ws.azbit.com';
const BOOK_PATH = '/futures/orderbooks-snapshots';
const BYBIT_WS = 'wss://stream.bybit.com/v5/public/linear';
const API = 'https://data.azbit.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => (xs.length ? { n: xs.length, min: Math.round(Math.min(...xs)), median: Math.round(pct(xs, 50)), p90: Math.round(pct(xs, 90)), max: Math.round(Math.max(...xs)) } : { n: 0 });
const sub = (pairs, method = 'subscribe') => JSON.stringify({ Method: method, CurrencyPairs: pairs });
const sigOf = (bids, asks, n = 5) => bids.slice(0, n).map(([p, q]) => `${p}x${q}`).join(',') + '|' + asks.slice(0, n).map(([p, q]) => `${p}x${q}`).join(',');

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  ws.t0 = t0;
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => log('refused', { url, status: res.statusCode, body: body.slice(0, 200) }));
  });
  ws.on('error', (e) => log('socket_error', { url, message: e.message }));
  return ws;
}

// Resolves with the open time in ms, or null when the handshake is refused or fails.
const opened = (ws) =>
  new Promise((resolve) => {
    ws.once('open', () => resolve(Date.now() - ws.t0));
    ws.once('error', () => resolve(null));
    ws.once('unexpected-response', () => resolve(null));
  });

async function book() {
  const pairs = ['BTCUSDT', 'ETHUSDT', 'AVAXUSDT', 'EURUSD', 'FIOUSDT', '$BTC_TOP'];
  const lagPairs = ['BTCUSDT', 'ETHUSDT', 'AVAXUSDT'];
  const seconds = 60;

  // Bybit linear orderbook.50, kept as a local book, every top five state stamped on first arrival.
  const bybitSeen = new Map(lagPairs.map((s) => [s, new Map()]));
  const bybitBooks = new Map();
  const by = open(BYBIT_WS);
  by.on('message', (raw) => {
    const now = Date.now();
    const m = JSON.parse(raw);
    if (!m.topic?.startsWith('orderbook.')) return;
    const s = m.data.s;
    if (m.type === 'snapshot') bybitBooks.set(s, { b: new Map(), a: new Map() });
    const bk = bybitBooks.get(s);
    if (!bk) return;
    for (const [p, q] of m.data.b) Number(q) === 0 ? bk.b.delete(Number(p)) : bk.b.set(Number(p), Number(q));
    for (const [p, q] of m.data.a) Number(q) === 0 ? bk.a.delete(Number(p)) : bk.a.set(Number(p), Number(q));
    const bids = [...bk.b].sort((x, y) => y[0] - x[0]);
    const asks = [...bk.a].sort((x, y) => x[0] - y[0]);
    const sig = sigOf(bids, asks);
    const seen = bybitSeen.get(s);
    if (!seen.has(sig)) seen.set(sig, now);
  });
  await opened(by);
  by.send(JSON.stringify({ op: 'subscribe', args: lagPairs.map((s) => `orderbook.50.${s}`) }));
  const byPing = setInterval(() => by.send(JSON.stringify({ op: 'ping' })), 20_000);

  // The Azbit book socket.
  const az = open(WS + BOOK_PATH);
  const openMs = await opened(az);
  log('azbit_open', { url: WS + BOOK_PATH, openMs });
  const per = new Map(pairs.map((p) => [p, { frames: 0, arrivals: [], repeats: 0, last: null, maxBids: 0, maxAsks: 0, minBids: Infinity, minAsks: Infinity, crossed: 0, bidsNotDesc: 0, asksNotAsc: 0, lags: [], unmatched: 0, empty: 0 }]));
  const control = [];
  const unknownCodes = new Set();
  let first = true;
  const subSentAt = Date.now();
  az.on('message', (raw, isBinary) => {
    const now = Date.now();
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.currencyPairCode === undefined) {
      control.push({ atMs: now - subSentAt, isBinary, text: text.slice(0, 200) });
      capture('azbit-control.txt', text);
      return;
    }
    const st = per.get(m.currencyPairCode);
    if (!st) {
      unknownCodes.add(m.currencyPairCode);
      return;
    }
    if (first) {
      first = false;
      capture('azbit-first-book.json', text);
      log('first_book_frame', { pair: m.currencyPairCode, atMsAfterSubscribe: now - subSentAt, bytes: raw.length, keys: Object.keys(m), levelKeys: Object.keys(m.bids?.[0] ?? m.asks?.[0] ?? {}) });
    }
    st.frames++;
    st.arrivals.push(now);
    const bids = (m.bids ?? []).map((l) => [l.price, l.quantity]);
    const asks = (m.asks ?? []).map((l) => [l.price, l.quantity]);
    if (!bids.length || !asks.length) st.empty++;
    st.maxBids = Math.max(st.maxBids, bids.length);
    st.maxAsks = Math.max(st.maxAsks, asks.length);
    st.minBids = Math.min(st.minBids, bids.length);
    st.minAsks = Math.min(st.minAsks, asks.length);
    if (bids.length && asks.length && bids[0][0] >= asks[0][0]) st.crossed++;
    if (!bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0])) st.bidsNotDesc++;
    if (!asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0])) st.asksNotAsc++;
    if (text === st.last) st.repeats++;
    st.last = text;
    const seen = bybitSeen.get(m.currencyPairCode);
    if (seen) {
      const t = seen.get(sigOf(bids, asks));
      if (t === undefined) st.unmatched++;
      else st.lags.push(now - t);
    }
  });
  az.send(sub(pairs));

  // Error cases on a second socket.
  const er = open(WS + BOOK_PATH);
  await opened(er);
  const erFrames = [];
  const erSent = Date.now();
  er.on('message', (raw) => {
    const t = raw.toString();
    let code;
    try {
      code = JSON.parse(t).currencyPairCode;
    } catch {}
    erFrames.push({ atMs: Date.now() - erSent, code, text: code === undefined ? t.slice(0, 200) : `book ${code}` });
  });
  const cases = [
    ['unknown pair', sub(['NOPEUSDT'])],
    ['underscore spelling', sub(['BTC_USDT'])],
    ['empty list', sub([])],
    ['Params synonym', JSON.stringify({ Method: 'subscribe', Params: ['XRPUSDT'] })],
    ['unknown method', JSON.stringify({ Method: 'nope', CurrencyPairs: ['BTCUSDT'] })],
    ['not JSON', 'hello'],
    ['ping text on the book route', JSON.stringify({ Params: ['ping'] })],
    ['subscribe SOLUSDT', sub(['SOLUSDT'])],
    ['same pair again', sub(['SOLUSDT'])],
  ];
  for (const [label, frame] of cases) {
    if (er.readyState !== WebSocket.OPEN) break;
    erFrames.push({ atMs: Date.now() - erSent, sent: label });
    er.send(frame);
    await sleep(1200);
  }
  if (er.readyState === WebSocket.OPEN) {
    erFrames.push({ atMs: Date.now() - erSent, sent: 'unsubscribe SOLUSDT and XRPUSDT' });
    er.send(sub(['SOLUSDT', 'XRPUSDT'], 'unsubscribe'));
    await sleep(3000);
  }
  // Summarize: control frames verbatim, book frames counted per pair and window.
  const summary = [];
  for (const f of erFrames) {
    const lastRow = summary[summary.length - 1];
    if (f.code !== undefined && lastRow && lastRow.book === f.text) {
      lastRow.count++;
      lastRow.lastAtMs = f.atMs;
    } else if (f.code !== undefined) summary.push({ book: f.text, count: 1, firstAtMs: f.atMs, lastAtMs: f.atMs });
    else summary.push(f);
  }
  log('error_cases', { closedEarly: er.readyState !== WebSocket.OPEN, frames: summary });
  er.on('close', (c, r) => log('error_socket_close', { code: c, reason: r.toString() }));
  er.close();

  await sleep(seconds * 1000 - (Date.now() - subSentAt));
  az.close();
  clearInterval(byPing);
  by.close();
  log('control_frames', { frames: control.slice(0, 5), unknownCodes: [...unknownCodes] });
  for (const [p, st] of per) {
    const gaps = st.arrivals.slice(1).map((t, i) => t - st.arrivals[i]);
    log('book_pair', {
      pair: p,
      frames: st.frames,
      firstAtMs: st.arrivals.length ? st.arrivals[0] - subSentAt : null,
      intervalMs: stats(gaps),
      identicalToPrevious: st.repeats,
      levels: { bids: [st.minBids, st.maxBids], asks: [st.minAsks, st.maxAsks] },
      emptySide: st.empty,
      crossed: st.crossed,
      bidsNotDescending: st.bidsNotDesc,
      asksNotAscending: st.asksNotAsc,
      ...(bybitSeen.has(p) ? { bybitStates: bybitSeen.get(p).size, matchedBybitTop5: st.lags.length, unmatched: st.unmatched, lagBehindBybitMs: stats(st.lags) } : {}),
    });
  }
}

async function batch() {
  const pairs = (await (await fetch(`${API}/api/futures/exchange-data/pairs`)).json()).map((p) => p.currencyPairCode);
  const seconds = 45;
  const az = open(WS + BOOK_PATH);
  const openMs = await opened(az);
  const per = new Map();
  let frames = 0, bytes = 0, parseUs = 0, control = [];
  const t0 = Date.now();
  az.on('message', (raw) => {
    frames++;
    bytes += raw.length;
    const p0 = performance.now();
    const m = JSON.parse(raw);
    parseUs += (performance.now() - p0) * 1000;
    if (m.currencyPairCode === undefined) {
      control.push(raw.toString().slice(0, 120));
      return;
    }
    const a = per.get(m.currencyPairCode) ?? [];
    a.push(Date.now());
    per.set(m.currencyPairCode, a);
  });
  az.send(sub(pairs));
  const perSecond = [];
  let lastFrames = 0;
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    perSecond.push(frames - lastFrames);
    lastFrames = frames;
  }
  az.close();
  const medians = [], maxGaps = [], firsts = [];
  for (const a of per.values()) {
    firsts.push(a[0] - t0);
    const g = a.slice(1).map((t, i) => t - a[i]);
    if (g.length) {
      medians.push(pct(g, 50));
      maxGaps.push(Math.max(...g));
    }
  }
  const worst = [...per].map(([p, a]) => [p, a.length]).sort((x, y) => x[1] - y[1]).slice(0, 5);
  log('batch', {
    subscribed: pairs.length,
    openMs,
    control,
    pairsDelivered: per.size,
    silentPairs: pairs.filter((p) => !per.has(p)),
    frames,
    framesPerSecond: stats(perSecond),
    kbPerSecond: Math.round(bytes / seconds / 1024),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: Math.round(parseUs / frames),
    firstFrameMs: stats(firsts),
    perPairMedianIntervalMs: stats(medians),
    perPairMaxGapMs: stats(maxGaps),
    fewestFrames: worst,
  });
}

async function session() {
  const idleSeconds = 75; // the silent socket of the first run closed at 60.6 s
  const subscribedSeconds = 120;
  const watch = (ws, name) => {
    const st = { name, frames: 0, serverPings: [], pongs: 0, texts: [], closed: null };
    ws.on('ping', () => st.serverPings.push(Math.round((Date.now() - ws.t0) / 1000)));
    ws.on('pong', () => st.pongs++);
    ws.on('message', (raw) => {
      st.frames++;
      const t = raw.toString();
      if (!t.includes('currencyPairCode') && st.texts.length < 6) st.texts.push([Math.round((Date.now() - ws.t0) / 100) / 10, t.slice(0, 120)]);
    });
    ws.on('close', (code, reason) => (st.closed = { code, reason: reason.toString(), atS: Math.round((Date.now() - ws.t0) / 100) / 10 }));
    return st;
  };
  const sockets = [
    ['no subscription, no client frame', idleSeconds, null],
    ['no subscription, protocol ping every 20 s', idleSeconds, (ws) => ws.ping()],
    ['no subscription, {"Params":["ping"]} every 20 s', idleSeconds, (ws) => ws.send(JSON.stringify({ Params: ['ping'] }))],
    ['EURUSD subscribed, no client frame', subscribedSeconds, null],
  ].map(([name, seconds, every]) => {
    const ws = open(WS + BOOK_PATH);
    return { ws, seconds, every, st: watch(ws, name) };
  });
  await Promise.all(sockets.map((s) => opened(s.ws)));
  sockets[3].ws.send(sub(['EURUSD']));
  const timers = sockets.filter((s) => s.every).map((s) => setInterval(() => s.ws.readyState === WebSocket.OPEN && s.every(s.ws), 20_000));

  // The /ping and /time routes, each briefly.
  for (const [path, frame] of [['/ping', JSON.stringify({ Params: ['ping'] })], ['/ping', JSON.stringify({ Params: 'ping' })], ['/time', JSON.stringify({ Params: '' })]]) {
    const ws = open(WS + path);
    const replies = [];
    let sentAt = 0;
    ws.on('message', (raw) => replies.push([Date.now() - sentAt, raw.toString().slice(0, 120)]));
    const ms = await opened(ws);
    if (ms === null) {
      await sleep(500);
      continue;
    }
    sentAt = Date.now();
    ws.send(frame);
    await sleep(3000);
    ws.close();
    log('route', { path, sent: frame, openMs: ms, repliesMsAfterSend: replies });
  }

  const t0 = Date.now();
  while (sockets.some((s) => s.ws.readyState === WebSocket.OPEN && Date.now() - s.ws.t0 < s.seconds * 1000)) {
    for (const s of sockets) if (s.ws.readyState === WebSocket.OPEN && Date.now() - s.ws.t0 >= s.seconds * 1000) s.ws.close();
    await sleep(500);
    if (Date.now() - t0 > subscribedSeconds * 1000) break;
  }
  timers.forEach(clearInterval);
  for (const s of sockets) {
    const openFor = Math.round((Date.now() - s.ws.t0) / 1000);
    const closedByServer = s.st.closed !== null && s.st.closed.atS < s.seconds - 1;
    if (s.ws.readyState === WebSocket.OPEN) s.ws.close();
    log('session', { ...s.st, heldForS: s.seconds, closedByServer, observedForS: openFor });
  }
}

async function deflate() {
  for (const d of [true, false]) {
    const ws = open(WS + BOOK_PATH, { deflate: d });
    const [res] = await Promise.all([new Promise((resolve) => ws.once('upgrade', (r) => resolve(r.headers))), opened(ws)]);
    log('deflate', { offered: d, secWebsocketExtensions: res['sec-websocket-extensions'] ?? null, server: res.server, cfRay: res['cf-ray'] });
    ws.close();
    await sleep(300);
  }
}

const mode = process.argv[2] ?? 'book';
if (mode === 'book') await book();
else if (mode === 'batch') await batch();
else if (mode === 'session') await session();
else if (mode === 'deflate') await deflate();
else console.log('unknown mode', mode);
setTimeout(() => process.exit(0), 1500);
