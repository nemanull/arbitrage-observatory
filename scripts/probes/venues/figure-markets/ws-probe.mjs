// Figure Markets public WebSocket probe: ORDER_BOOK and MARKET frames, whether a book frame is whole or a delta, level order, sizes against the REST book, errors, the 50 channel cap, keepalive, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/figure-markets/ws-probe.mjs [book|errors|cap|silence|deflate]
//   book     ORDER_BOOK on the crypto spot markets, MARKET on two, TRADES on one, for 60 s, with a REST book compare at 20 s. About 62 s.
//   errors   one socket sends each documented error case and a few undocumented ones, 700 ms apart. About 15 s.
//   cap      one socket sends 52 subscriptions 50 ms apart to find the documented cap of 50. About 10 s.
//   silence  four sockets that differ only in what the client subscribes or sends, for up to 100 s, or SILENCE_SECONDS.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames, trimmed. Recorded in docs/profiles/figure-markets/websocket.md.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://www.figuremarkets.com/service-hft-exchange-websocket/ws/v1';
const REST = 'https://api.figuremarkets.com/public/v1';
const OUT = process.env.PROBE_OUT_DIR;
const SILENCE_MS = Number(process.env.SILENCE_SECONDS ?? 100) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();
const rel = () => Date.now() - t0;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url = WS_URL, opts = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
    let upgradeHeaders = {};
    ws.on('upgrade', (res) => { upgradeHeaders = res.headers; });
    ws.once('open', () => resolve({ ws, openMs: Date.now() - started, upgradeHeaders }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected-response ${res.statusCode}`)));
  });
}

// Histogram of intervals rounded to the nearest 50 ms.
const bins = (xs) => xs.reduce((h, x) => { const b = Math.round(x / 50) * 50; h[b] = (h[b] ?? 0) + 1; return h; }, {});

const sub = (channel, symbol, extra = {}) => ({ action: 'SUBSCRIBE', channelUuid: randomUUID(), channel, symbol, ...extra });

// Stats for one ORDER_BOOK stream, built frame by frame.
function bookStats() {
  return {
    frames: 0, bidsMin: Infinity, bidsMax: 0, asksMin: Infinity, asksMax: 0,
    bidsNotDesc: 0, asksNotAsc: 0, totalsNotCumulative: 0, zeroQty: 0,
    identicalRepeats: 0, emptySide: 0, gaps: [], keys: new Set(), levelKeys: new Set(), numberTypes: new Set(),
    last: undefined, lastAt: undefined, firstAt: undefined,
  };
}

function checkSide(levels, ascending) {
  let bad = false;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price), b = Number(levels[i].price);
    if (ascending ? !(b > a) : !(b < a)) bad = true;
  }
  return bad;
}

function cumulativeBad(levels) {
  let sum = 0;
  for (const l of levels) {
    sum += Number(l.quantity);
    if (l.total !== undefined && Math.abs(Number(l.total) - sum) > 1e-9 * Math.max(1, sum)) return true;
  }
  return false;
}

async function restBook(symbol, query = '') {
  const started = Date.now();
  const res = await fetch(`${REST}/markets/${symbol}/orderbook${query}`);
  const body = await res.json();
  return { status: res.status, ms: Date.now() - started, body };
}

async function modeBook() {
  const catalog = await (await fetch(`${REST}/markets?size=50`)).json();
  const crypto = catalog.data.filter((m) => m.marketType === 'CRYPTO').map((m) => m.symbol);
  const { ws, openMs, upgradeHeaders } = await open();
  log('open', { openMs, extensions: upgradeHeaders['sec-websocket-extensions'] ?? null, cryptoMarkets: crypto.length });

  const streams = new Map(); // channelUuid to { channel, symbol, stats }
  const frames = [
    ...crypto.map((s) => sub('ORDER_BOOK', s)),
    sub('MARKET', 'BTC-USD-2S'),
    sub('MARKET', 'UNI-USD'),
    sub('TRADES', 'UNI-USD'),
  ];
  for (const f of frames) streams.set(f.channelUuid, { channel: f.channel, symbol: f.symbol, stats: bookStats(), marketLag: [] });

  let serverPings = 0, pongs = [], other = 0, bytes = 0, lastPingAt = 0;
  const arrivals = []; // every ORDER_BOOK frame arrival, for the publish tick
  const controlSamples = [];
  ws.on('ping', () => { serverPings++; });
  ws.on('pong', () => { pongs.push(Date.now() - lastPingAt); });
  const subscribedAt = Date.now();

  ws.on('message', (raw) => {
    const now = Date.now();
    bytes += raw.length;
    const text = raw.toString('utf8');
    let msg;
    try { msg = JSON.parse(text); } catch { controlSamples.push(text.slice(0, 300)); return; }
    const s = msg && !Array.isArray(msg) ? streams.get(msg.channelUuid) : undefined;
    if (!s) { other++; if (controlSamples.length < 8) controlSamples.push(text.slice(0, 400)); capture('control.jsonl', `${now} ${text}`); return; }
    capture(`${s.channel}-${s.symbol}.jsonl`, `${now} ${text}`);
    const st = s.stats;
    st.frames++;
    for (const k of Object.keys(msg)) st.keys.add(k);
    if (st.firstAt === undefined) { st.firstAt = now; st.firstMs = now - subscribedAt; }
    if (st.lastAt !== undefined) st.gaps.push(now - st.lastAt);
    st.lastAt = now;
    if (s.channel === 'MARKET') {
      if (msg.publishTime) s.marketLag.push(now - Date.parse(msg.publishTime));
      st.lastMsg = msg;
      return;
    }
    if (s.channel !== 'ORDER_BOOK') { st.lastMsg = msg; return; }
    arrivals.push(now);
    (st.sizes ??= []).push(raw.length);
    const bids = msg.bids ?? [], asks = msg.asks ?? [];
    for (const l of [...bids, ...asks]) { for (const k of Object.keys(l)) st.levelKeys.add(k); st.numberTypes.add(typeof l.price + '/' + typeof l.quantity); if (Number(l.quantity) === 0) st.zeroQty++; }
    st.bidsMin = Math.min(st.bidsMin, bids.length); st.bidsMax = Math.max(st.bidsMax, bids.length);
    st.asksMin = Math.min(st.asksMin, asks.length); st.asksMax = Math.max(st.asksMax, asks.length);
    if (bids.length === 0 || asks.length === 0) st.emptySide++;
    if (checkSide(bids, false)) st.bidsNotDesc++;
    if (checkSide(asks, true)) st.asksNotAsc++;
    if (cumulativeBad(bids) || cumulativeBad(asks)) st.totalsNotCumulative++;
    const key = JSON.stringify({ bids, asks });
    if (st.last === key) st.identicalRepeats++;
    st.last = key;
    st.lastMsg = msg;
  });

  for (const f of frames) ws.send(JSON.stringify(f));
  const ping = setInterval(() => { lastPingAt = Date.now(); ws.ping(); }, 20_000);

  await sleep(5_000);
  ws.send(JSON.stringify({ action: 'LIST_SUBSCRIPTIONS' }));
  await sleep(15_000);

  // Compare the latest socket book for BTC with the REST book read now.
  const btc = [...streams.values()].find((s) => s.channel === 'ORDER_BOOK' && s.symbol === 'BTC-USD-2S');
  const rest = await restBook('BTC-USD-2S');
  const wsBook = btc?.stats.lastMsg;
  if (wsBook) {
    const same = (a, b) => a.length === b.length && a.every((l, i) => Number(l.price) === Number(b[i].price) && Number(l.quantity) === Number(b[i].quantity));
    log('rest_compare', {
      restStatus: rest.status, restMs: rest.ms, restTimestamp: rest.body.timestamp,
      restBids: rest.body.bids.length, restAsks: rest.body.asks.length, wsBids: wsBook.bids.length, wsAsks: wsBook.asks.length,
      bidsEqual: same(wsBook.bids, rest.body.bids), asksEqual: same(wsBook.asks, rest.body.asks),
      wsTop: { bid: wsBook.bids[0], ask: wsBook.asks[0] }, restTop: { bid: rest.body.bids[0], ask: rest.body.asks[0] },
      wsSocketAgeMs: Date.now() - btc.stats.lastAt,
    });
  }

  await sleep(40_000);
  clearInterval(ping);

  for (const s of streams.values()) {
    const st = s.stats;
    const g = [...st.gaps].sort((a, b) => a - b);
    const pct = (p) => (g.length ? g[Math.min(g.length - 1, Math.floor(p * g.length))] : null);
    const row = { channel: s.channel, symbol: s.symbol, frames: st.frames, firstMs: st.firstMs ?? null, gapMedian: pct(0.5), gapMax: g.length ? g[g.length - 1] : null, keys: [...st.keys].join(',') };
    if (s.channel === 'ORDER_BOOK') {
      const z = [...(st.sizes ?? [])].sort((a, b) => a - b);
      row.bytesMedian = z.length ? z[Math.floor(z.length / 2)] : null;
      row.gapBins50ms = bins(st.gaps);
    }
    if (s.channel === 'ORDER_BOOK') Object.assign(row, {
      bids: `${st.bidsMin === Infinity ? 0 : st.bidsMin}-${st.bidsMax}`, asks: `${st.asksMin === Infinity ? 0 : st.asksMin}-${st.asksMax}`,
      bidsNotDesc: st.bidsNotDesc, asksNotAsc: st.asksNotAsc, totalsNotCumulative: st.totalsNotCumulative, zeroQty: st.zeroQty,
      identicalRepeats: st.identicalRepeats, emptySide: st.emptySide, levelKeys: [...st.levelKeys].join(','), types: [...st.numberTypes].join(','),
    });
    if (s.channel === 'MARKET' && s.marketLag.length) {
      const l = [...s.marketLag].sort((a, b) => a - b);
      row.publishLagMs = { min: l[0], median: l[Math.floor(l.length / 2)], max: l[l.length - 1] };
      row.sample = JSON.stringify(s.stats.lastMsg).slice(0, 400);
    }
    if (s.channel === 'TRADES' && s.stats.lastMsg) row.sample = JSON.stringify(s.stats.lastMsg).slice(0, 300);
    log('stream', row);
  }
  // Frames from all books within 40 ms of each other are one publish burst.
  arrivals.sort((a, b) => a - b);
  const starts = [];
  for (let i = 0; i < arrivals.length; i++) if (i === 0 || arrivals[i] - arrivals[i - 1] >= 40) starts.push(arrivals[i]);
  const burstGaps = starts.slice(1).map((t, i) => t - starts[i]);
  log('publish_tick', { bookFrames: arrivals.length, bursts: starts.length, burstGapBins50ms: bins(burstGaps), burstGapMin: Math.min(...burstGaps), burstGapMax: Math.max(...burstGaps) });
  const btcLast = btc?.stats.lastMsg;
  if (btcLast) log('btc_book_sample', { bids: btcLast.bids.slice(0, 3), asks: btcLast.asks.slice(0, 3) });
  log('session', { seconds: Math.round(rel() / 1000), serverPings, pongRttMs: pongs, otherFrames: other, bytes, controlSamples });
  ws.close();
}

async function modeErrors() {
  const { ws, openMs } = await open();
  log('open', { openMs });
  const replies = [];
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    let msg; try { msg = JSON.parse(text); } catch { msg = undefined; }
    // Book frames are long, so only their shape is kept.
    if (msg && (msg.asks || msg.bids)) replies.push({ at: rel(), book: true, channelUuid: msg.channelUuid, bids: msg.bids?.length, asks: msg.asks?.length, top: { bid: msg.bids?.[0], ask: msg.asks?.[0] } });
    else replies.push({ at: rel(), text: text.slice(0, 300) });
    capture('errors.jsonl', `${Date.now()} ${text}`);
  });
  ws.on('close', (code, reason) => replies.push({ at: rel(), close: code, reason: reason.toString() }));
  const a = randomUUID(), b = randomUUID(), c = randomUUID();
  const steps = [
    ['unknown_symbol', { action: 'SUBSCRIBE', channelUuid: randomUUID(), channel: 'ORDER_BOOK', symbol: 'NOPE-USD' }],
    ['subscribe_ok', { action: 'SUBSCRIBE', channelUuid: a, channel: 'ORDER_BOOK', symbol: 'HASH-USD' }],
    ['duplicate_uuid', { action: 'SUBSCRIBE', channelUuid: a, channel: 'ORDER_BOOK', symbol: 'LINK-USD' }],
    ['same_stream_new_uuid', { action: 'SUBSCRIBE', channelUuid: b, channel: 'ORDER_BOOK', symbol: 'HASH-USD' }],
    ['unsubscribe_unknown', { action: 'UNSUBSCRIBE', channelUuid: randomUUID() }],
    ['unknown_channel', { action: 'SUBSCRIBE', channelUuid: randomUUID(), channel: 'NOPE', symbol: 'HASH-USD' }],
    ['private_channel', { action: 'SUBSCRIBE', channelUuid: randomUUID(), channel: 'ADDRESS_ORDERS', symbol: 'HASH-USD' }],
    ['not_json', 'hello'],
    ['uuid_not_uuid', { action: 'SUBSCRIBE', channelUuid: 'abc', channel: 'ORDER_BOOK', symbol: 'LINK-USDC' }],
    ['missing_symbol', { action: 'SUBSCRIBE', channelUuid: randomUUID(), channel: 'ORDER_BOOK' }],
    ['action_ping', { action: 'PING' }],
    ['tick_size_10', { action: 'SUBSCRIBE', channelUuid: c, channel: 'ORDER_BOOK', symbol: 'BTC-USD-2S', tickSize: '10' }],
    ['non_crypto_book', { action: 'SUBSCRIBE', channelUuid: randomUUID(), channel: 'ORDER_BOOK', symbol: 'FIGR_HELOC-USD' }],
    ['lowercase_symbol', { action: 'SUBSCRIBE', channelUuid: randomUUID(), channel: 'ORDER_BOOK', symbol: 'eth-usd' }],
    ['list', { action: 'LIST_SUBSCRIPTIONS' }],
    ['unsubscribe_ok', { action: 'UNSUBSCRIBE', channelUuid: a }],
  ];
  for (const [label, frame] of steps) {
    replies.push({ at: rel(), sent: label });
    ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
    await sleep(700);
  }
  await sleep(2_000);
  ws.close();
  await sleep(300);
  // Print sent labels with the replies that followed them, dropping repeated book frames after the first two per stream.
  const seen = new Map();
  for (const r of replies) {
    if (r.book) { const n = (seen.get(r.channelUuid) ?? 0) + 1; seen.set(r.channelUuid, n); if (n > 2) continue; }
    log('e', r);
  }
  log('book_frames_per_uuid', { counts: Object.fromEntries([...seen].map(([k, v]) => [k === a ? 'a:HASH-USD' : k === b ? 'b:HASH-USD' : k === c ? 'c:BTC tick 10' : k.slice(0, 8), v])) });
}

async function modeCap() {
  const catalog = await (await fetch(`${REST}/markets?size=50`)).json();
  const crypto = catalog.data.filter((m) => m.marketType === 'CRYPTO').map((m) => m.symbol);
  // ORDER_BOOK on a market that is not CRYPTO is dropped without an error, so only streams that register are counted toward the cap.
  const frames = [
    ...catalog.data.map((m) => sub('MARKET', m.symbol)),
    ...crypto.map((s) => sub('ORDER_BOOK', s)),
    ...crypto.map((s) => sub('TRADES', s)),
  ];
  const burst = frames.slice(0, 52);
  const { ws, openMs } = await open();
  const uuids = new Map(burst.map((f, i) => [f.channelUuid, i + 1]));
  const firstFrame = new Map();
  const errors = [];
  let closed = null;
  let sentCount = 0;
  let listed = null, listedChannels = null;
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    let msg; try { msg = JSON.parse(text); } catch { errors.push(text.slice(0, 200)); return; }
    if (Array.isArray(msg)) { listed = msg.length; listedChannels = [...new Set(msg.map((m) => m.channel))]; return; }
    if (msg.code !== undefined) { errors.push({ at: rel(), afterSent: sentCount, msg }); return; }
    const n = uuids.get(msg.channelUuid);
    if (n && !firstFrame.has(n)) firstFrame.set(n, rel());
  });
  ws.on('close', (code) => { closed = code; });
  // Sent 50 ms apart so each error can be tied to the frame before it.
  for (const f of burst) { ws.send(JSON.stringify(f)); sentCount++; await sleep(50); }
  await sleep(5_000);
  ws.send(JSON.stringify({ action: 'LIST_SUBSCRIPTIONS' }));
  await sleep(1_500);
  const silent = [...uuids.values()].filter((n) => !firstFrame.has(n));
  log('cap', { openMs, sent: burst.length, streamsWithAFrame: firstFrame.size, silentStreamNumbers: silent, listed, listedChannels, errors, closed });
  ws.close();
}

async function modeSilence() {
  const plans = [
    { name: 'A_no_sub_silent', subscribe: false, ping: null },
    { name: 'B_quiet_sub_silent', subscribe: true, ping: null },
    { name: 'C_quiet_sub_protocol_ping_20s', subscribe: true, ping: 'protocol' },
    { name: 'D_no_sub_protocol_ping_20s', subscribe: false, ping: 'protocol' },
  ];
  const results = await Promise.all(plans.map(async (p) => {
    const { ws, openMs } = await open();
    const started = Date.now();
    const r = { name: p.name, openMs, serverPings: 0, pongs: 0, frames: 0, lastFrameAtS: null, closeAtS: null, closeCode: null };
    ws.on('ping', () => { r.serverPings++; });
    ws.on('pong', () => { r.pongs++; });
    ws.on('message', () => { r.frames++; r.lastFrameAtS = (Date.now() - started) / 1000; });
    let timer;
    const done = new Promise((resolve) => ws.on('close', (code) => { r.closeAtS = (Date.now() - started) / 1000; r.closeCode = code; clearInterval(timer); resolve(); }));
    if (p.subscribe) ws.send(JSON.stringify(sub('ORDER_BOOK', 'HASH-USDC')));
    if (p.ping === 'protocol') timer = setInterval(() => ws.ping(), 20_000);
    await Promise.race([done, sleep(SILENCE_MS)]);
    clearInterval(timer);
    if (r.closeAtS === null) { r.stillOpenAtS = (Date.now() - started) / 1000; ws.close(); }
    return r;
  }));
  for (const r of results) log('silence', r);
}

async function modeDeflate() {
  const { ws, openMs, upgradeHeaders } = await open(WS_URL, { perMessageDeflate: true });
  log('deflate', { openMs, negotiated: upgradeHeaders['sec-websocket-extensions'] ?? null, server: upgradeHeaders['server'] ?? null, via: upgradeHeaders['via'] ?? null });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book: modeBook, errors: modeErrors, cap: modeCap, silence: modeSilence, deflate: modeDeflate };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, seconds: Math.round(rel() / 1000) });
process.exit(0);
