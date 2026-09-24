// Bitlo public WebSocket probe: STOMP handshake, the /topic/market book deltas and their sequence against the REST snapshot, level order, size unit, a whole catalog on one socket, wildcards, errors, silence and compression.
// Public, unauthenticated, read-only. STOMP CONNECT and SUBSCRIBE only, never SEND, plus one line of non-STOMP text in errors. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitlo/ws-probe.mjs [book|batch|wildcard|ticker|errors|silence|handshake]
//   book      five markets for 60 s, seeded from the REST book, gap check, and a compare with a fresh REST book at the end. About 65 s.
//   batch     every trading market on one socket for 45 s. About 50 s.
//   wildcard  /topic/market/* and /topic/ticker/* for 15 s.
//   ticker    /topic/ticker/all and /topic/ticker-price for 20 s.
//   errors    unknown, malformed and duplicate subscriptions, frames before CONNECT, and the documented SockJS URL. About 25 s.
//   silence   four sockets that differ in what the client sends, for 90 s, or SILENCE_MS.
//   handshake offers permessage-deflate once and prints what the server negotiates, then connects with no STOMP subprotocol, as the engine does. About 7 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/bitlo/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api4.bitlo.com/ws/websocket'; // raw WebSocket transport of the SockJS endpoint, what www.bitlo.com uses
const SOCKJS_URL = 'wss://api4.bitlo.com/ws'; // the URL docs.bitlo.com prints
const API4 = 'https://api4.bitlo.com';
const BOOK_MARKETS = ['BTC-TRY', 'ETH-TRY', 'USDT-TRY', 'BTC-USDT', 'CHR-TRY'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000).replace(/\n/g, '\\n').replace(/\0/g, '\\0') + '\n');
}

const stomp = (command, headers = {}, body = '') => `${command}\n${Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n')}\n\n${body}\0`;

// One WebSocket message may hold several STOMP frames, and a lone EOL is a heart-beat.
function parseFrames(text) {
  const frames = [];
  for (const part of text.split('\0')) {
    if (part === '') continue;
    if (part.trim() === '') { frames.push({ command: 'HEARTBEAT' }); continue; }
    const trimmed = part.replace(/^[\r\n]+/, '');
    const split = trimmed.indexOf('\n\n');
    const head = split < 0 ? trimmed : trimmed.slice(0, split);
    const body = split < 0 ? '' : trimmed.slice(split + 2);
    const [command, ...lines] = head.split('\n');
    const headers = {};
    for (const l of lines) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i)] = l.slice(i + 1); }
    frames.push({ command, headers, body });
  }
  return frames;
}

function open(url, { deflate = false, connect = true, heartBeat = '0,0', onFrame = () => {}, name = 'ws', protocols = ['v12.stomp', 'v11.stomp', 'v10.stomp'] } = {}) {
  const t0 = Date.now();
  const ws = protocols ? new WebSocket(url, protocols, { perMessageDeflate: deflate }) : new WebSocket(url, { perMessageDeflate: deflate });
  const state = { ws, t0, frames: 0, bytes: 0, connected: null, closed: null, pings: 0, heartbeats: 0, extensions: null, protocol: null };
  ws.on('upgrade', (res) => { state.extensions = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('unexpected-response', (req, res) => {
    let b = '';
    res.on('data', (d) => { b += d; });
    res.on('end', () => { state.closed = { unexpected: res.statusCode, body: b.slice(0, 200), atMs: Date.now() - t0 }; });
  });
  ws.on('open', () => {
    state.openMs = Date.now() - t0;
    state.protocol = ws.protocol;
    if (connect) ws.send(stomp('CONNECT', { 'accept-version': '1.1,1.2', 'heart-beat': heartBeat, host: 'api4.bitlo.com' }));
  });
  ws.on('ping', () => { state.pings++; });
  ws.on('message', (data) => {
    const text = data.toString('utf8');
    state.bytes += data.length;
    capture(`${name}.txt`, `${Date.now() - t0}\t${text}`);
    for (const f of parseFrames(text)) {
      if (f.command === 'HEARTBEAT') { state.heartbeats++; continue; }
      state.frames++;
      if (f.command === 'CONNECTED' && !state.connected) state.connected = { atMs: Date.now() - t0, headers: f.headers };
      onFrame(f, Date.now());
    }
  });
  ws.on('close', (code, reason) => { state.closed ??= { code, reason: reason.toString(), atMs: Date.now() - t0 }; });
  ws.on('error', (e) => { state.error = e.message; });
  return state;
}

const waitFor = async (pred, ms) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(20); return pred(); };
const getJson = async (url) => { const r = await fetch(url); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null, text: t }; };
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] }; };

async function tradingMarkets() {
  const c = await getJson(`${API4}/config`);
  return c.body.markets.filter((m) => m.tradingEnabled).map((m) => m.code);
}

function newTrack(market) {
  return { market, buffer: [], seeded: false, snapSeq: null, last: null, applied: 0, dropped: 0, gaps: [], firstAfterSnap: null, frames: 0, multiLevel: 0, spanFrames: 0, zero: 0, levelsMax: 0, bidOrderBad: 0, askOrderBad: 0, lagMs: [], arrivals: [], bids: new Map(), asks: new Map() };
}

function applyDelta(t, d) {
  for (const [p, s] of d.bids) { if (Number(s) === 0) t.bids.delete(p); else t.bids.set(p, s); }
  for (const [p, s] of d.asks) { if (Number(s) === 0) t.asks.delete(p); else t.asks.set(p, s); }
}

function onDelta(t, d, arrival) {
  t.frames++;
  t.arrivals.push(arrival);
  t.lagMs.push(arrival - d.timestamp);
  const n = d.bids.length + d.asks.length;
  if (n > 1) t.multiLevel++;
  if (d.endSequenceId !== d.beginSequenceId) t.spanFrames++;
  t.levelsMax = Math.max(t.levelsMax, n);
  t.zero += [...d.bids, ...d.asks].filter(([, s]) => Number(s) === 0).length;
  for (let i = 1; i < d.bids.length; i++) if (Number(d.bids[i][0]) >= Number(d.bids[i - 1][0])) t.bidOrderBad++;
  for (let i = 1; i < d.asks.length; i++) if (Number(d.asks[i][0]) <= Number(d.asks[i - 1][0])) t.askOrderBad++;
  if (!t.seeded) { t.buffer.push(d); return; }
  step(t, d);
}

function step(t, d) {
  if (d.endSequenceId <= t.last) { t.dropped++; return; }
  if (t.firstAfterSnap === null) t.firstAfterSnap = { begin: d.beginSequenceId, snapSeq: t.snapSeq, beginMinusSnap: d.beginSequenceId - t.snapSeq };
  if (d.beginSequenceId !== t.last + 1) t.gaps.push({ expected: t.last + 1, got: d.beginSequenceId });
  applyDelta(t, d);
  t.last = d.endSequenceId;
  t.applied++;
}

function seed(t, snap) {
  t.snapSeq = snap.sequenceId;
  t.last = snap.sequenceId;
  for (const l of snap.bids) t.bids.set(l['0'], l['1']);
  for (const l of snap.asks) t.asks.set(l['0'], l['1']);
  t.seeded = true;
  for (const d of t.buffer) step(t, d);
  t.buffer = [];
}

function sideArray(map, desc) {
  return [...map.entries()].map(([p, s]) => [Number(p), Number(s)]).sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0]));
}

async function book() {
  const tracks = Object.fromEntries(BOOK_MARKETS.map((m) => [m, newTrack(m)]));
  const receipts = {};
  let subAt = 0;
  const firstFrameMs = {};
  const s = open(WS_URL, {
    name: 'book',
    onFrame: (f, arrival) => {
      if (f.command === 'RECEIPT') { receipts[f.headers['receipt-id']] = arrival - subAt; return; }
      if (f.command !== 'MESSAGE') { log('frame', { command: f.command, headers: f.headers, body: f.body?.slice(0, 200) }); return; }
      const d = JSON.parse(f.body);
      const t = tracks[d.market];
      if (!t) return;
      firstFrameMs[d.market] ??= arrival - subAt;
      onDelta(t, d, arrival);
    },
  });
  await waitFor(() => s.connected, 5000);
  log('connected', { openMs: s.openMs, protocol: s.protocol, connected: s.connected });
  subAt = Date.now();
  BOOK_MARKETS.forEach((m, i) => s.ws.send(stomp('SUBSCRIBE', { id: `sub-${i}`, destination: `/topic/market/${m}`, receipt: `r-${m}` })));
  await sleep(1000);
  for (const m of BOOK_MARKETS) {
    const r = await getJson(`${API4}/market/orderbook?market=${m}`);
    seed(tracks[m], r.body);
  }
  await sleep(59000);
  const finalSnaps = {};
  for (const m of BOOK_MARKETS) finalSnaps[m] = (await getJson(`${API4}/market/orderbook?market=${m}`)).body;
  await sleep(1500);
  s.ws.close();
  await sleep(300);
  log('receipts', { msAfterSubscribe: receipts, firstFrameMsAfterSubscribe: firstFrameMs });
  for (const m of BOOK_MARKETS) {
    const t = tracks[m];
    const snap = finalSnaps[m];
    const bids = sideArray(t.bids, true);
    const asks = sideArray(t.asks, false);
    const cmp = (local, rest) => { let eq = 0; const n = Math.min(20, rest.length); for (let i = 0; i < n; i++) if (local[i] && local[i][0] === Number(rest[i]['0']) && local[i][1] === Number(rest[i]['1'])) eq++; return `${eq}/${n}`; };
    const gapsBetween = t.arrivals.slice(1).map((a, i) => a - t.arrivals[i]);
    log('book_market', {
      market: m, frames: t.frames, applied: t.applied, droppedBeforeSnap: t.dropped, firstAfterSnap: t.firstAfterSnap, gaps: t.gaps.length, gapSample: t.gaps.slice(0, 3),
      multiLevelFrames: t.multiLevel, spanFrames: t.spanFrames, maxLevelsInFrame: t.levelsMax, zeroSizeLevels: t.zero, bidOrderBad: t.bidOrderBad, askOrderBad: t.askOrderBad,
      lagMs: t.lagMs.length ? stats(t.lagMs) : null, maxSilenceMs: gapsBetween.length ? Math.max(...gapsBetween) : null,
      localLevels: { bids: bids.length, asks: asks.length }, lastSeq: t.last, restSeq: snap.sequenceId,
      top20Match: { bids: cmp(bids, snap.bids), asks: cmp(asks, snap.asks) }, crossed: bids[0] && asks[0] ? bids[0][0] >= asks[0][0] : null,
    });
  }
  log('book_session', { frames: s.frames, bytes: s.bytes, pings: s.pings, heartbeats: s.heartbeats, closed: s.closed });
}

async function batch() {
  const markets = await tradingMarkets();
  const last = {};
  const seen = new Set();
  let gaps = 0;
  let multiLevel = 0;
  let emptyFrames = 0;
  let spanFrames = 0;
  let maxLevels = 0;
  let orderBad = 0;
  let msgs = 0;
  let parseNs = 0n;
  let bytes = 0;
  const perSecond = [];
  let receiptMs = null;
  let subAt = 0;
  let lastArrival = 0;
  let maxGapMs = 0;
  const s = open(WS_URL, {
    name: 'batch',
    onFrame: (f, arrival) => {
      if (f.command === 'RECEIPT') { receiptMs = arrival - subAt; return; }
      if (f.command !== 'MESSAGE') { log('frame', { command: f.command, headers: f.headers, body: f.body?.slice(0, 200) }); return; }
      if (lastArrival) maxGapMs = Math.max(maxGapMs, arrival - lastArrival);
      lastArrival = arrival;
      const a = process.hrtime.bigint();
      const d = JSON.parse(f.body);
      parseNs += process.hrtime.bigint() - a;
      msgs++;
      bytes += f.body.length;
      seen.add(d.market);
      const n = d.bids.length + d.asks.length;
      if (n > 1) multiLevel++;
      if (n === 0) emptyFrames++;
      maxLevels = Math.max(maxLevels, n);
      if (d.endSequenceId !== d.beginSequenceId) spanFrames++;
      for (let i = 1; i < d.bids.length; i++) if (Number(d.bids[i][0]) >= Number(d.bids[i - 1][0])) orderBad++;
      for (let i = 1; i < d.asks.length; i++) if (Number(d.asks[i][0]) <= Number(d.asks[i - 1][0])) orderBad++;
      if (last[d.market] !== undefined && d.beginSequenceId !== last[d.market] + 1) gaps++;
      last[d.market] = d.endSequenceId;
    },
  });
  await waitFor(() => s.connected, 5000);
  subAt = Date.now();
  markets.forEach((m, i) => s.ws.send(stomp('SUBSCRIBE', { id: `sub-${i}`, destination: `/topic/market/${m}`, ...(i === markets.length - 1 ? { receipt: 'last' } : {}) })));
  const subSentMs = Date.now() - subAt;
  let prev = 0;
  for (let i = 0; i < 45; i++) { await sleep(1000); perSecond.push(msgs - prev); prev = msgs; }
  s.ws.close();
  await sleep(300);
  log('batch', { subscriptions: markets.length, subscribeSendMs: subSentMs, lastReceiptMs: receiptMs, seconds: 45, messages: msgs, marketsThatDelivered: seen.size, gaps, multiLevelFrames: multiLevel, emptyFrames, spanFrames, maxLevelsInFrame: maxLevels, levelsOutOfBookOrder: orderBad, perSecond: stats(perSecond), maxGapBetweenMessagesMs: maxGapMs, bodyBytesPerSecond: Math.round(bytes / 45), wireBytes: s.bytes, parseUsPerMessage: msgs ? Number(parseNs / BigInt(msgs)) / 1000 : null, closed: s.closed, error: s.error ?? null });
}

async function wildcard() {
  const per = {};
  const last = {};
  let gaps = 0;
  const tickerSample = {};
  const s = open(WS_URL, {
    name: 'wildcard',
    onFrame: (f, arrival) => {
      if (f.command !== 'MESSAGE') { if (f.command !== 'CONNECTED') log('frame', { command: f.command, headers: f.headers, body: f.body?.slice(0, 200) }); return; }
      const id = f.headers.subscription;
      const p = (per[id] ??= { messages: 0, destinations: new Set() });
      p.messages++;
      p.destinations.add(f.headers.destination);
      if (id === 'w-market') {
        const d = JSON.parse(f.body);
        if (last[d.market] !== undefined && d.beginSequenceId !== last[d.market] + 1) gaps++;
        last[d.market] = d.endSequenceId;
      }
      if (id === 'w-ticker' && f.headers.destination === '/topic/ticker/BTC-TRY') (tickerSample.arrivals ??= []).push(arrival), (tickerSample.body = f.body.slice(0, 400));
    },
  });
  await waitFor(() => s.connected, 5000);
  s.ws.send(stomp('SUBSCRIBE', { id: 'w-market', destination: '/topic/market/*' }));
  s.ws.send(stomp('SUBSCRIBE', { id: 'w-ticker', destination: '/topic/ticker/*' }));
  s.ws.send(stomp('SUBSCRIBE', { id: 'w-all', destination: '/topic/market/all' }));
  await sleep(15000);
  s.ws.close();
  await sleep(300);
  for (const [id, p] of Object.entries(per)) {
    const ds = [...p.destinations];
    log('wildcard', { subscription: id, messages: p.messages, destinations: ds.length, includesTickerAll: ds.includes('/topic/ticker/all'), sample: ds.slice(0, 4) });
  }
  const a = tickerSample.arrivals ?? [];
  log('wildcard_detail', { marketStarGaps: gaps, marketsSeenViaStar: Object.keys(last).length, allSubscriptionMessages: per['w-all']?.messages ?? 0, btcTryTickerPushes: a.length, btcTryTickerIntervalMs: a.length > 1 ? stats(a.slice(1).map((x, i) => x - a[i])) : null, btcTryTickerBody: tickerSample.body ?? null, closed: s.closed });
}

async function ticker() {
  const arr = { 'tk-all': [], 'tk-price': [] };
  let prevTouch = null;
  let touchChanges = 0;
  let pricePushes = 0;
  const rowsWithTouch = [];
  const priceSymbols = new Set();
  const btcPrice = [];
  const samples = {};
  const s = open(WS_URL, {
    name: 'ticker',
    onFrame: (f, arrival) => {
      if (f.command !== 'MESSAGE') { if (f.command !== 'CONNECTED') log('frame', { command: f.command, headers: f.headers, body: f.body?.slice(0, 200) }); return; }
      const id = f.headers.subscription;
      arr[id]?.push({ arrival, bytes: f.body.length });
      const j = JSON.parse(f.body);
      samples[id] ??= Array.isArray(j) ? { rows: j.length, first: j[0] } : j;
      if (id === 'tk-all') {
        rowsWithTouch.push(j.filter((x) => Number(x.bid) > 0 || Number(x.ask) > 0).length);
        const row = j.find((x) => x.marketCode === 'BTC-TRY');
        const touch = `${row?.bid}|${row?.ask}`;
        if (prevTouch !== null && touch !== prevTouch) touchChanges++;
        prevTouch = touch;
      } else { pricePushes++; priceSymbols.add(j.symbol); if (j.symbol === 'BTC') btcPrice.push(j); }
    },
  });
  await waitFor(() => s.connected, 5000);
  s.ws.send(stomp('SUBSCRIBE', { id: 'tk-all', destination: '/topic/ticker/all' }));
  s.ws.send(stomp('SUBSCRIBE', { id: 'tk-price', destination: '/topic/ticker-price' }));
  await sleep(20000);
  s.ws.close();
  await sleep(300);
  for (const [id, xs] of Object.entries(arr)) {
    const gaps = xs.slice(1).map((x, i) => x.arrival - xs[i].arrival);
    log('ticker_channel', { subscription: id, pushes: xs.length, intervalMs: gaps.length ? stats(gaps) : null, bytes: xs.length ? stats(xs.map((x) => x.bytes)) : null, sample: JSON.stringify(samples[id] ?? null).slice(0, 500) });
  }
  log('ticker_touch', { btcTryTouchChangesAcrossTickerAllPushes: touchChanges, tickerAllRowsWithNonZeroBidOrAsk: rowsWithTouch.length ? stats(rowsWithTouch) : null, tickerPricePushes: pricePushes, tickerPriceDistinctSymbols: priceSymbols.size, btcTickerPrice: btcPrice.slice(0, 3) });
}

async function errors() {
  const got = [];
  const s = open(WS_URL, {
    name: 'errors',
    onFrame: (f) => {
      if (f.command === 'CONNECTED') return;
      got.push({ command: f.command, subscription: f.headers?.subscription, destination: f.headers?.destination, receipt: f.headers?.['receipt-id'], message: f.headers?.message, body: f.body?.slice(0, 160) });
    },
  });
  await waitFor(() => s.connected, 5000);
  const send = (cmd, h) => s.ws.send(stomp(cmd, h));
  send('SUBSCRIBE', { id: 'e1', destination: '/topic/market/NOPE-TRY', receipt: 'e1' });
  send('SUBSCRIBE', { id: 'e2', destination: '/topic/market/btc-try', receipt: 'e2' });
  send('SUBSCRIBE', { id: 'e3', destination: '/topic/nope', receipt: 'e3' });
  send('SUBSCRIBE', { id: 'e4', destination: '/queue/nope', receipt: 'e4' });
  send('SUBSCRIBE', { id: 'd1', destination: '/topic/market/*', receipt: 'd1' });
  send('SUBSCRIBE', { id: 'd2', destination: '/topic/market/*', receipt: 'd2' });
  await sleep(10000);
  const counts = {};
  for (const g of got) { const k = `${g.command} ${g.subscription ?? g.receipt ?? ''}`; counts[k] = (counts[k] ?? 0) + 1; }
  log('errors_subscriptions', { counts, nonMessage: got.filter((g) => g.command !== 'MESSAGE').slice(0, 10) });
  send('SUBSCRIBE', { destination: '/topic/market/ETH-TRY', receipt: 'noid' });
  await sleep(1500);
  log('errors_missing_id', { after: got.filter((g) => g.command !== 'MESSAGE').slice(-3), closed: s.closed });
  const before = got.length;
  if (s.ws.readyState === WebSocket.OPEN) { s.ws.send('hello'); await sleep(5000); }
  log('errors_garbage', { after: got.filter((g) => g.command !== 'MESSAGE').slice(-2), messagesIn5sAfter: got.length - before, closed: s.closed });
  s.ws.close();

  const early = open(WS_URL, { name: 'early', connect: false, onFrame: (f) => log('early_frame', { command: f.command, headers: f.headers, body: f.body?.slice(0, 200) }) });
  await waitFor(() => early.openMs !== undefined, 5000);
  early.ws.send(stomp('SUBSCRIBE', { id: 'x', destination: '/topic/market/BTC-TRY' }));
  await sleep(2500);
  log('subscribe_before_connect', { frames: early.frames, closed: early.closed });
  early.ws.close();

  const sj = open(SOCKJS_URL, { name: 'sockjs', connect: false });
  await sleep(2500);
  log('documented_sockjs_url', { url: SOCKJS_URL, openMs: sj.openMs ?? null, closed: sj.closed, error: sj.error ?? null });
  try { sj.ws.terminate(); } catch {}
  const sess = open(`${SOCKJS_URL}/000/probe${Date.now() % 100000}/websocket`, { name: 'sockjs-session', connect: false });
  const raw = [];
  sess.ws.on('message', (d) => raw.push(d.toString().slice(0, 120)));
  await sleep(2500);
  log('sockjs_session_url', { openMs: sess.openMs ?? null, firstMessages: raw.slice(0, 3), closed: sess.closed, error: sess.error ?? null });
  try { sess.ws.terminate(); } catch {}
  await sleep(300);
}

// Long enough to see the idle close near 61 s and a socket that outlives it.
const SILENCE_MS = Number(process.env.SILENCE_MS ?? 90000);

async function silence() {
  const ticker = await getJson(`${API4}/market/ticker/all`);
  const config = await getJson(`${API4}/config`);
  const trading = new Set(config.body.markets.filter((m) => m.tradingEnabled).map((m) => m.code));
  const quiet = ticker.body.filter((x) => trading.has(x.marketCode) && Number(x.bid) > 0).sort((a, b) => Number(a.notionalVolume24h) - Number(b.notionalVolume24h))[0].marketCode;
  const sockets = {
    A_no_connect: open(WS_URL, { name: 'silA', connect: false }),
    B_connect_only: open(WS_URL, { name: 'silB' }),
    C_quiet_sub_no_client_traffic: open(WS_URL, { name: 'silC' }),
    D_quiet_sub_client_eol_10s: open(WS_URL, { name: 'silD', heartBeat: '10000,10000' }),
  };
  await waitFor(() => sockets.C_quiet_sub_no_client_traffic.connected && sockets.D_quiet_sub_client_eol_10s.connected, 5000);
  sockets.C_quiet_sub_no_client_traffic.ws.send(stomp('SUBSCRIBE', { id: 'q', destination: `/topic/market/${quiet}` }));
  sockets.D_quiet_sub_client_eol_10s.ws.send(stomp('SUBSCRIBE', { id: 'q', destination: `/topic/market/${quiet}` }));
  const eol = setInterval(() => { const w = sockets.D_quiet_sub_client_eol_10s.ws; if (w.readyState === WebSocket.OPEN) w.send('\n'); }, 10000);
  const t0 = Date.now();
  while (Date.now() - t0 < SILENCE_MS && Object.values(sockets).some((s) => !s.closed)) await sleep(500);
  clearInterval(eol);
  for (const [k, s] of Object.entries(sockets)) {
    log('silence', { socket: k, quietMarket: quiet, connectedHeartBeat: s.connected?.headers?.['heart-beat'] ?? null, frames: s.frames, serverPings: s.pings, stompHeartbeats: s.heartbeats, closed: s.closed ?? `open at ${Math.round((Date.now() - s.t0) / 1000)} s` });
    try { s.ws.terminate(); } catch {}
  }
}

async function handshake() {
  const d = open(WS_URL, { deflate: true, name: 'deflate' });
  await waitFor(() => d.connected, 5000);
  log('deflate', { offered: 'permessage-deflate', negotiated: d.extensions, protocol: d.protocol, connected: d.connected });
  d.ws.close();
  let frames = 0;
  const n = open(WS_URL, { protocols: null, name: 'noproto', onFrame: (f) => { if (f.command === 'MESSAGE') frames++; } });
  await waitFor(() => n.connected, 5000);
  n.ws.send(stomp('SUBSCRIBE', { id: 'all', destination: '/topic/market/*' }));
  await sleep(5000);
  log('no_subprotocol', { requested: 'none', protocol: n.protocol || null, openMs: n.openMs ?? null, connected: n.connected, marketMessagesIn5s: frames, extensions: n.extensions, closed: n.closed });
  n.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, wildcard, ticker, errors, silence, handshake };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
