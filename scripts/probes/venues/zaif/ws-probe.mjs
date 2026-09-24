// Zaif WebSocket probe: the per pair stream at wss://ws.zaif.jp/stream, its book shape, cadence, level order, repeats, timestamps, keepalive, silence, errors, compression, and every catalog pair at once.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks once.
// Opens at most 3 sockets per second, inside the documented 4 connection starts per second per IP address.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/zaif/ws-probe.mjs [book|errors|silence|deflate|batch]
//   book     btc_jpy, eth_jpy, mona_jpy and xem_btc for 65 s, with one REST depth read of btc_jpy compared against the socket. About 70 s.
//   errors   unknown, uppercase, missing, token, event and empty pairs, a wrong path, and three sockets that send a JSON text frame, a non-JSON text frame or a protocol ping. About 15 s.
//   silence  three sockets that differ only in what the client sends, for 120 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates. About 3 s.
//   batch    one socket per catalog pair, all 56, opened at 3 per second and held to 50 s. About 55 s.
// Set PROBE_OUT_DIR to keep a few raw frames. Recorded in docs/profiles/zaif/websocket.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS = 'wss://ws.zaif.jp/stream';
const API = 'https://api.zaif.jp/api/1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

// "2026-09-23 13:27:40.795607" is Japan time, which has no daylight saving.
function jstToMs(ts) {
  return Date.parse(ts.replace(' ', 'T').slice(0, 23) + '+09:00');
}

function orderViolations(levels, desc) {
  let bad = 0;
  for (let i = 1; i < levels.length; i++) if (desc ? levels[i][0] >= levels[i - 1][0] : levels[i][0] <= levels[i - 1][0]) bad++;
  return bad;
}

function open(pair, opts = {}) {
  const url = pair === null ? WS : `${WS}?currency_pair=${pair}`;
  const t0 = Date.now();
  const ws = new WebSocket(opts.url ?? url, { perMessageDeflate: opts.deflate ?? false, handshakeTimeout: 10_000 });
  const st = { pair, t0, frames: [], openMs: null, close: null, error: null, pings: 0, pongs: [], unexpected: null, extensions: null };
  ws.on('upgrade', (res) => (st.extensions = res.headers['sec-websocket-extensions'] ?? null));
  ws.on('open', () => (st.openMs = Date.now() - t0));
  ws.on('ping', () => st.pings++);
  ws.on('pong', () => st.pongs.push(Date.now()));
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => (st.unexpected = { status: res.statusCode, body: body.slice(0, 160) }));
  });
  ws.on('message', (data, isBinary) => {
    const at = Date.now();
    const text = data.toString('utf8');
    st.frames.push({ at, text, isBinary });
    if (opts.onFrame) opts.onFrame(st, st.frames[st.frames.length - 1]);
  });
  ws.on('close', (code, reason) => (st.close = { code, reason: reason.toString(), atMs: Date.now() - t0 }));
  ws.on('error', (e) => (st.error = e.message));
  st.ws = ws;
  return st;
}

function summarizeBook(st) {
  const gaps = [];
  const offsets = [];
  const parseUs = [];
  let bidMax = 0, askMax = 0, bidMin = Infinity, askMin = Infinity, bidBad = 0, askBad = 0, crossed = 0, sameBook = 0, sameAll = 0, oneSided = 0, emptyBoth = 0, bytes = 0, exponent = 0, newTrades = 0, framesWithNewTrades = 0, tradesLen = new Set();
  let prevBook = null, prevText = null, prevAt = null, seenTids = new Set();
  const keys = new Set();
  for (const f of st.frames) {
    bytes += f.text.length;
    if (/\d[eE][-+]?\d/.test(f.text)) exponent++;
    const p0 = process.hrtime.bigint();
    const j = JSON.parse(f.text);
    parseUs.push(Number(process.hrtime.bigint() - p0) / 1000);
    Object.keys(j).forEach((k) => keys.add(k));
    if (prevAt !== null) gaps.push(f.at - prevAt);
    prevAt = f.at;
    if (j.timestamp) offsets.push(f.at - jstToMs(j.timestamp));
    const bids = j.bids ?? [], asks = j.asks ?? [];
    bidMax = Math.max(bidMax, bids.length); askMax = Math.max(askMax, asks.length);
    bidMin = Math.min(bidMin, bids.length); askMin = Math.min(askMin, asks.length);
    bidBad += orderViolations(bids, true); askBad += orderViolations(asks, false);
    if (bids.length && asks.length && bids[0][0] >= asks[0][0]) crossed++;
    if ((bids.length === 0) !== (asks.length === 0)) oneSided++;
    if (bids.length === 0 && asks.length === 0) emptyBoth++;
    const book = JSON.stringify([bids, asks]);
    if (prevBook === book) sameBook++;
    if (prevText !== null && prevText.replace(/"timestamp": ?"[^"]*"/, '') === f.text.replace(/"timestamp": ?"[^"]*"/, '')) sameAll++;
    prevBook = book; prevText = f.text;
    const trades = j.trades ?? [];
    tradesLen.add(trades.length);
    let fresh = 0;
    for (const t of trades) if (!seenTids.has(t.tid)) { seenTids.add(t.tid); fresh++; }
    if (f !== st.frames[0] && fresh > 0) { framesWithNewTrades++; newTrades += fresh; }
  }
  const spanS = st.frames.length > 1 ? (st.frames[st.frames.length - 1].at - st.frames[0].at) / 1000 : 0;
  return {
    pair: st.pair, openMs: st.openMs, firstFrameMs: st.frames[0] ? st.frames[0].at - st.t0 : null, frames: st.frames.length, spanS: Math.round(spanS),
    gapsMs: stats(gaps), levels: { bidMin, bidMax, askMin, askMax }, bidDescViolations: bidBad, askAscViolations: askBad, crossed, oneSided, emptyBoth,
    sameBookAsPrevious: sameBook, sameFrameExceptTimestamp: sameAll, framesWithNewTrades, newTrades, tradesArrayLengths: [...tradesLen],
    arrivalMinusTimestampMs: stats(offsets), bytesPerFrame: st.frames.length ? Math.round(bytes / st.frames.length) : 0, framesWithExponent: exponent,
    parseUs: stats(parseUs.map((x) => Math.round(x))), keys: [...keys].sort(), pings: st.pings, close: st.close, error: st.error,
  };
}

async function book() {
  const pairs = ['btc_jpy', 'eth_jpy', 'mona_jpy', 'xem_btc'];
  const socks = [];
  for (const p of pairs) {
    socks.push(open(p, { onFrame: (st, f) => { if (st.frames.length <= 2) capture(`book_${st.pair}.jsonl`, f.text); } }));
    await sleep(400);
  }
  await sleep(28_000);
  const rest = await fetch(`${API}/depth/btc_jpy`);
  const restAt = Date.now();
  const depth = await rest.json();
  const btc = socks[0];
  let nearest = null;
  for (const f of btc.frames) if (nearest === null || Math.abs(f.at - restAt) < Math.abs(nearest.at - restAt)) nearest = f;
  if (nearest) {
    const j = JSON.parse(nearest.text);
    const eq = (a, b) => a.filter((l, i) => b[i] && b[i][0] === l[0] && b[i][1] === l[1]).length;
    const restBids = new Map(depth.bids.slice(0, 20).map((l) => [l[0], l[1]]));
    const restAsks = new Map(depth.asks.slice(0, 20).map((l) => [l[0], l[1]]));
    const sizeMatch = j.bids.filter((l) => restBids.get(l[0]) === l[1]).length + j.asks.filter((l) => restAsks.get(l[0]) === l[1]).length;
    log('rest_vs_socket_btc_jpy', { frameAgeMs: restAt - nearest.at, samePositionBids: eq(j.bids, depth.bids), samePositionAsks: eq(j.asks, depth.asks), priceAndSizeMatchOf40: sizeMatch, restLevels: [depth.bids.length, depth.asks.length], socketLevels: [j.bids.length, j.asks.length], socketTop: [j.bids[0], j.asks[0]], restTop: [depth.bids[0], depth.asks[0]] });
  }
  await sleep(65_000 - (Date.now() - socks[0].t0));
  for (const s of socks) s.ws.close(1000);
  await sleep(1500);
  for (const s of socks) log('book', summarizeBook(s));
  const last = JSON.parse(btc.frames[btc.frames.length - 1].text);
  log('btc_jpy_last_frame_extras', { last_price: last.last_price, target_users: last.target_users, itayose_len: last.itayose_data?.length, itayose_nonEmpty: (last.itayose_data ?? []).filter((x) => Object.keys(x).length).length, trade0: last.trades?.[0], closeCodes: socks.map((s) => s.close?.code) });
}

async function errors() {
  const cases = [
    ['unknown pair', 'nope_jpy'],
    ['uppercase pair', 'BTC_JPY'],
    ['token pair (is_token true)', 'zaif_jpy'],
    ['event pair', 'csbtc_btc'],
    ['empty book pair', 'zpg_jpy'],
    ['missing currency_pair', null],
    ['wrong path', 'x', `${WS.replace('/stream', '/nope')}?currency_pair=btc_jpy`],
  ];
  const socks = [];
  for (const [name, pair, url] of cases) {
    const st = open(pair, { url });
    st.name = name;
    socks.push(st);
    await sleep(400);
  }
  // Three sockets on one pair that differ only in what the client sends after 1.5 s.
  const talkers = [['json text frame', (ws) => ws.send(JSON.stringify({ event: 'ping' }))], ['non-JSON text frame', (ws) => ws.send('not json')], ['protocol ping', (ws) => ws.ping()]].map(([name, act]) => ({ name, act, st: open('btc_jpy') }));
  await sleep(1500);
  const sentAt = Date.now();
  for (const t of talkers) if (t.st.ws.readyState === WebSocket.OPEN) t.act(t.st.ws);
  await sleep(8000);
  for (const s of [...socks, ...talkers.map((t) => t.st)]) s.ws.terminate();
  for (const s of socks) {
    const first = s.frames[0] ? JSON.parse(s.frames[0].text) : null;
    log('error_case', { name: s.name, pair: s.pair, openMs: s.openMs, unexpected: s.unexpected, error: s.error, close: s.close, frames: s.frames.length, firstFrame: first ? { keys: Object.keys(first), bids: first.bids?.length, asks: first.asks?.length, currency_pair: first.currency_pair, text: s.frames[0].text.slice(0, 200) } : null });
  }
  for (const t of talkers) {
    const st = t.st;
    log('client_frame', { sent: t.name, pair: 'btc_jpy', framesAfterSend: st.frames.filter((f) => f.at >= sentAt).length, nonBookReplies: st.frames.filter((f) => f.at >= sentAt && !f.text.includes('"asks"')).map((f) => f.text.slice(0, 120)), pongMs: st.pongs.map((x) => x - sentAt), closeAfterSendMs: st.close ? st.close.atMs - (sentAt - st.t0) : null, close: st.close, error: st.error });
  }
}

async function silence() {
  const passiveBusy = open('btc_jpy');
  await sleep(400);
  const passiveQuiet = open('mona_btc');
  await sleep(400);
  const pinging = open('mona_btc');
  const rtts = [];
  const timer = setInterval(() => {
    if (pinging.ws.readyState !== WebSocket.OPEN) return;
    const t = Date.now();
    pinging.ws.once('pong', () => rtts.push(Date.now() - t));
    pinging.ws.ping();
  }, 20_000);
  const end = Date.now() + 120_000;
  while (Date.now() < end && [passiveBusy, passiveQuiet, pinging].some((s) => s.close === null)) await sleep(1000);
  clearInterval(timer);
  for (const [name, s] of [['passive btc_jpy', passiveBusy], ['passive mona_btc', passiveQuiet], ['protocol ping every 20 s, mona_btc', pinging]]) {
    const gaps = [];
    for (let i = 1; i < s.frames.length; i++) gaps.push(s.frames[i].at - s.frames[i - 1].at);
    log('silence', { name, openMs: s.openMs, frames: s.frames.length, maxGapMs: gaps.length ? Math.max(...gaps) : null, lastFrameAgoMs: s.frames.length ? Date.now() - s.frames[s.frames.length - 1].at : null, serverPings: s.pings, close: s.close, error: s.error, heldS: Math.round((Date.now() - s.t0) / 1000) });
    s.ws.terminate();
  }
  log('pong_rtt_ms', stats(rtts));
}

async function deflate() {
  const st = open('btc_jpy', { deflate: true });
  await sleep(3000);
  log('deflate', { offered: 'permessage-deflate', negotiated: st.extensions, frames: st.frames.length, openMs: st.openMs });
  st.ws.terminate();
}

async function batch() {
  const pairs = (await (await fetch(`${API}/currency_pairs/all`)).json()).map((p) => ({ pair: p.currency_pair, isToken: p.is_token }));
  const socks = [];
  const start = Date.now();
  for (const p of pairs) {
    const st = open(p.pair, { onFrame: (x, f) => { if (x.frames.length === 1) capture('batch_first.jsonl', f.text); } });
    st.isToken = p.isToken;
    socks.push(st);
    await sleep(334);
  }
  const openedS = (Date.now() - start) / 1000;
  await sleep(Math.max(0, 50_000 - (Date.now() - start)));
  const heldS = (Date.now() - start) / 1000;
  for (const s of socks) s.ws.terminate();
  const firstMs = socks.filter((s) => s.frames.length).map((s) => s.frames[0].at - s.t0);
  const frames = socks.reduce((a, s) => a + s.frames.length, 0);
  const windowStart = start + openedS * 1000; // every socket is open from here, so the rate counts only this window
  const windowS = (Date.now() - windowStart) / 1000;
  const inWindow = socks.flatMap((s) => s.frames.filter((f) => f.at >= windowStart));
  const windowBytes = inWindow.reduce((b, f) => b + f.text.length, 0);
  const delivering = socks.filter((s) => s.frames.length > 0);
  const oneFrame = socks.filter((s) => s.frames.length === 1).map((s) => s.pair);
  const silent = socks.filter((s) => s.frames.length === 0).map((s) => `${s.pair}:${s.unexpected?.status ?? s.close?.code ?? s.error ?? 'open'}`);
  const closed = socks.filter((s) => s.close !== null).map((s) => `${s.pair}:${s.close.code}@${s.close.atMs}`);
  log('batch', { sockets: socks.length, openedInS: Math.round(openedS), heldS: Math.round(heldS), opened: socks.filter((s) => s.openMs !== null).length, refused: socks.filter((s) => s.unexpected).map((s) => `${s.pair}:${s.unexpected.status}`), delivering: delivering.length, deliveringTokenPairs: delivering.filter((s) => s.isToken).length, onlyFirstFrame: oneFrame.length, silent, closedEarly: closed, firstFrameMs: stats(firstMs), framesTotal: frames, windowS: Math.round(windowS), framesPerS: Math.round((inWindow.length / windowS) * 10) / 10, kbPerS: Math.round(windowBytes / 1024 / windowS) });
  const busiest = [...socks].sort((a, b) => b.frames.length - a.frames.length).slice(0, 8).map((s) => `${s.pair}:${s.frames.length}`);
  log('batch_busiest', { busiest, onlyFirstFrame: oneFrame });
  const levels = socks.filter((s) => s.frames.length).map((s) => { const j = JSON.parse(s.frames[s.frames.length - 1].text); return `${s.pair}:${j.bids?.length ?? 'x'}/${j.asks?.length ?? 'x'}`; });
  log('batch_levels_bids_asks', { levels });
}

const modes = { book, errors, silence, deflate, batch };
const arg = process.argv[2] ?? 'book';
if (!modes[arg]) throw new Error(`unknown mode ${arg}`);
log('start', { mode: arg, at: new Date().toISOString() });
await modes[arg]();
log('end', { at: new Date().toISOString() });
process.exit(0);
