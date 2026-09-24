// Coinone public WebSocket probe: ORDERBOOK frames (full book or delta, level count and order, id rule, repeats, REST compare), TICKER, TRADE and CHART samples, ping, errors, all KRW pairs on one socket, silence, deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode.
// At most three sockets at once, well inside the documented 20 connections per IP.
// Run from server/: node ../scripts/probes/venues/coinone/ws-probe.mjs [book|batch|silence|deflate]
//   book     ORDERBOOK on BTC, XRP, DOGE and TNSR for 70 s, SHORT format on a second socket, TICKER, TRADE, CHART, error cases, unsubscribe, PING and PONG, REST book compare. About 75 s.
//   batch    ORDERBOOK on every KRW pair on one socket for 60 s. About 65 s.
//   silence  three sockets that never send PING: no subscription, a quiet pair, a busy pair, held 120 s. About 120 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/coinone/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://stream.coinone.co.kr';
const V2 = 'https://api.coinone.co.kr/public/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const sub = (channel, tc, extra = {}) => JSON.stringify({ request_type: 'SUBSCRIBE', channel, topic: { quote_currency: 'KRW', target_currency: tc, ...(extra.topic ?? {}) }, ...(extra.format ? { format: extra.format } : {}) });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(label, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false, handshakeTimeout: 10_000 });
  const state = { ws, label, t0, openMs: null, closed: null, serverPings: 0, frames: 0, bytes: 0 };
  ws.on('upgrade', (res) => { state.extensions = res.headers['sec-websocket-extensions'] ?? null; state.upgradeHeaders = { server: res.headers.server ?? null }; });
  ws.on('open', () => { state.openMs = Date.now() - t0; });
  ws.on('ping', () => { state.serverPings++; });
  ws.on('close', (code, reason) => { state.closed = { code, reason: reason.toString(), afterMs: Date.now() - t0 }; });
  ws.on('error', (e) => { state.error = e.message; });
  state.ready = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  return state;
}

function levelsOf(d) {
  const a = d.asks ?? d.a ?? [];
  const b = d.bids ?? d.b ?? [];
  return { asks: a.map((l) => [Number(l.price ?? l.p), l.qty ?? l.q]), bids: b.map((l) => [Number(l.price ?? l.p), l.qty ?? l.q]) };
}
const isDesc = (a) => a.every((v, i) => i === 0 || v[0] < a[i - 1][0]);
const isAsc = (a) => a.every((v, i) => i === 0 || v[0] > a[i - 1][0]);

async function book() {
  const PAIRS = ['BTC', 'XRP', 'DOGE', 'TNSR'];
  const A = open('A');
  const B = open('B');
  await Promise.all([A.ready, B.ready]);
  log('open', { A: A.openMs, B: B.openMs });

  const stats = Object.fromEntries(PAIRS.map((p) => [p, { frames: 0, subAt: 0, firstMs: null, ackMs: null, firstBeforeAck: null, bidCounts: {}, askCounts: {}, bidsDesc: 0, asksAsc: 0, asksDesc: 0, crossed: 0, idNotIncreasing: 0, sameIdRepeat: 0, identicalRepeat: 0, identicalNewId: 0, lastId: null, lastBody: null, gaps: [], lastRecv: null, lagMs: [], afterUnsub: 0, oneSided: 0, empty: 0, sizeNumbers: 0 }]));
  const other = [];
  const pongs = [];
  let lastPingAt = 0;
  let unsubAt = null;
  const lastFrameByPair = {};
  const extraPairs = {};

  A.ws.on('message', (raw) => {
    const recv = Date.now();
    const text = raw.toString();
    let m;
    try { m = JSON.parse(text); } catch { other.push({ t: recv - A.t0, text: text.slice(0, 200) }); return; }
    if (m.response_type === 'PONG') { pongs.push(recv - lastPingAt); capture('pong.jsonl', text); return; }
    if (m.response_type === 'DATA' && m.channel === 'ORDERBOOK') {
      const d = m.data;
      const s = stats[d.target_currency];
      if (!s) {
        const u = (extraPairs[`${d.quote_currency}/${d.target_currency}`] ??= { frames: 0, first: text.slice(0, 300) });
        u.frames++;
        return;
      }
      s.frames++;
      if (unsubAt && d.target_currency === 'XRP' && recv > unsubAt + 1500) s.afterUnsub++;
      if (s.firstMs === null) { s.firstMs = recv - s.subAt; s.firstBeforeAck = s.ackMs === null; capture(`ob-${d.target_currency}-first.json`, text); }
      else if (s.frames <= 4) capture(`ob-${d.target_currency}-next.jsonl`, text);
      const { bids, asks } = levelsOf(d);
      s.bidCounts[bids.length] = (s.bidCounts[bids.length] ?? 0) + 1;
      s.askCounts[asks.length] = (s.askCounts[asks.length] ?? 0) + 1;
      if (isDesc(bids)) s.bidsDesc++;
      if (isAsc(asks)) s.asksAsc++;
      if (asks.length > 1 && isDesc(asks)) s.asksDesc++;
      if (bids.length && asks.length && bids[0][0] >= asks[asks.length - 1][0] && bids[0][0] >= Math.min(...asks.map((x) => x[0]))) s.crossed++;
      if (!bids.length || !asks.length) s.oneSided++;
      if (!bids.length && !asks.length) s.empty++;
      if ([...bids, ...asks].some((l) => typeof l[1] !== 'string')) s.sizeNumbers++;
      const id = BigInt(d.id);
      if (s.lastId !== null && id <= s.lastId) { s.idNotIncreasing++; if (id === s.lastId) s.sameIdRepeat++; }
      const body = JSON.stringify([d.bids, d.asks]);
      if (body === s.lastBody) { s.identicalRepeat++; if (id !== s.lastId) s.identicalNewId++; }
      s.lastBody = body;
      s.lastId = id;
      if (s.lastRecv !== null) s.gaps.push(recv - s.lastRecv);
      s.lastRecv = recv;
      s.lagMs.push(recv - d.timestamp);
      lastFrameByPair[d.target_currency] = { recv, d };
      return;
    }
    if (m.response_type === 'SUBSCRIBED' && m.channel === 'ORDERBOOK' && stats[m.data?.target_currency]) {
      const s = stats[m.data.target_currency];
      if (s.ackMs === null) s.ackMs = recv - s.subAt;
    }
    if (m.response_type === 'DATA' && ['TICKER', 'TRADE', 'CHART'].includes(m.channel)) {
      const k = `data_${m.channel}`;
      const n = other.filter((o) => o.kind === k).length;
      if (n < 2) { other.push({ kind: k, t: recv - A.t0, text: text.slice(0, 900) }); capture(`${m.channel}.jsonl`, text); }
      else other.push({ kind: k });
      return;
    }
    other.push({ kind: m.response_type, t: recv - A.t0, text: text.slice(0, 300) });
    capture('control.jsonl', text);
  });

  const shortFrames = [];
  B.ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.r !== 'DATA' || m.d?.tc !== 'BTC') return;
    if (shortFrames.length < 2) { shortFrames.push({ bytes: raw.length, text: text.slice(0, 400) }); capture('short.jsonl', text); }
    else shortFrames.push({ bytes: raw.length });
  });

  for (const p of PAIRS) { stats[p].subAt = Date.now(); A.ws.send(sub('ORDERBOOK', p)); }
  A.ws.send(sub('TICKER', 'BTC'));
  A.ws.send(sub('TRADE', 'BTC'));
  A.ws.send(sub('CHART', 'BTC', { topic: { interval: '1m' } }));
  B.ws.send(sub('ORDERBOOK', 'BTC', { format: 'SHORT' }));
  B.ws.send(sub('ORDERBOOK', 'XRP'));

  await sleep(3000);
  log('error_cases_start', { at: Date.now() - A.t0 });
  A.ws.send(sub('ORDERBOOK', 'NOPE'));
  await sleep(400);
  A.ws.send(JSON.stringify({ request_type: 'SUBSCRIBE', channel: 'ORDERBOOK', topic: { quote_currency: 'krw', target_currency: 'eth' } }));
  await sleep(400);
  A.ws.send(JSON.stringify({ request_type: 'subscribe', channel: 'ORDERBOOK', topic: { quote_currency: 'KRW', target_currency: 'ETH' } }));
  await sleep(400);
  A.ws.send(JSON.stringify({ request_type: 'SUBSCRIBE', channel: 'NOPE', topic: { quote_currency: 'KRW', target_currency: 'BTC' } }));
  await sleep(400);
  A.ws.send(JSON.stringify({ request_type: 'SUBSCRIBE', channel: 'ORDERBOOK', topic: { quote_currency: 'USDT', target_currency: 'BTC' } }));
  await sleep(400);
  A.ws.send('not json');
  await sleep(400);
  A.ws.send(sub('ORDERBOOK', 'BTC'));
  await sleep(400);
  A.ws.send(sub('ORDERBOOK', 'SOL', { format: 'short' }));

  for (let i = 0; i < 3; i++) {
    await sleep(i === 0 ? 2000 : 15000);
    lastPingAt = Date.now();
    A.ws.send(JSON.stringify({ request_type: 'PING' }));
  }

  await sleep(2000);
  const rest = await fetch(`${V2}/orderbook/KRW/BTC?size=16`).then((r) => r.json());
  const ws = lastFrameByPair.BTC?.d;
  if (ws) {
    const wl = levelsOf(ws);
    const rb = rest.bids.map((l) => [Number(l.price), l.qty]);
    const ra = rest.asks.map((l) => [Number(l.price), l.qty]);
    const wsAsksBest = [...wl.asks].sort((a, b) => a[0] - b[0]);
    const eqB = rb.filter((l, i) => wl.bids[i] && wl.bids[i][0] === l[0] && wl.bids[i][1] === l[1]).length;
    const eqA = ra.filter((l, i) => wsAsksBest[i] && wsAsksBest[i][0] === l[0] && wsAsksBest[i][1] === l[1]).length;
    log('rest_compare_btc', { wsId: ws.id, restId: rest.id, wsLevels: [wl.bids.length, wl.asks.length], restLevels: [rb.length, ra.length], bidsEqualByPosition: eqB, asksEqualByPositionAfterSortingWsAsc: eqA, wsBest: [wl.bids[0], wsAsksBest[0]], restBest: [rb[0], ra[0]] });
  }

  unsubAt = Date.now();
  A.ws.send(JSON.stringify({ request_type: 'UNSUBSCRIBE', channel: 'ORDERBOOK', topic: { quote_currency: 'KRW', target_currency: 'XRP' } }));
  await sleep(Math.max(0, 70_000 - (Date.now() - A.t0)));

  for (const [p, s] of Object.entries(stats)) {
    log('orderbook_stats', { pair: p, frames: s.frames, firstFrameMsAfterSubscribe: s.firstMs, ackMs: s.ackMs, firstBeforeAck: s.firstBeforeAck, bidCounts: s.bidCounts, askCounts: s.askCounts, bidsDescending: s.bidsDesc, asksAscending: s.asksAsc, asksDescending: s.asksDesc, crossed: s.crossed, oneSided: s.oneSided, empty: s.empty, sizesNotString: s.sizeNumbers, idNotIncreasing: s.idNotIncreasing, sameIdRepeat: s.sameIdRepeat, identicalBookRepeat: s.identicalRepeat, identicalBookWithNewId: s.identicalNewId, gapMs: { median: median(s.gaps), p90: pct(s.gaps, 0.9), max: s.gaps.length ? Math.max(...s.gaps) : null }, recvMinusTsMs: { min: s.lagMs.length ? Math.min(...s.lagMs) : null, median: median(s.lagMs), max: s.lagMs.length ? Math.max(...s.lagMs) : null }, framesAfterUnsubscribe: p === 'XRP' ? s.afterUnsub : undefined });
  }
  const counts = {};
  for (const o of other) counts[o.kind ?? 'text'] = (counts[o.kind ?? 'text'] ?? 0) + 1;
  log('other_counts', counts);
  for (const o of other.filter((x) => x.text)) log('other_frame', o);
  log('pongs', { rttMs: pongs });
  log('short_format', { btcFrames: shortFrames.length, medianBytes: median(shortFrames.map((f) => f.bytes)), sample: shortFrames.slice(0, 2) });
  log('extra_pairs', extraPairs);
  log('sessions', { A: { openMs: A.openMs, serverPings: A.serverPings, closed: A.closed }, B: { openMs: B.openMs, serverPings: B.serverPings, closed: B.closed } });
  A.ws.close();
  B.ws.close();
}

async function batch() {
  const markets = (await fetch(`${V2}/markets/KRW`).then((r) => r.json())).markets.map((m) => m.target_currency);
  const S = open('batch');
  await S.ready;
  const acks = new Set();
  const snap = new Map();
  const last = new Map();
  const errors = [];
  let frames = 0;
  let bytes = 0;
  let maxBytes = 0;
  let parseNs = 0n;
  const perSec = new Map();
  let t0 = 0;
  S.ws.on('message', (raw) => {
    const recv = Date.now();
    const p0 = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - p0;
    if (m.response_type === 'SUBSCRIBED') { acks.add(m.data?.target_currency); return; }
    if (m.response_type === 'ERROR') { errors.push(m); return; }
    if (m.response_type !== 'DATA') return;
    frames++;
    bytes += raw.length;
    if (raw.length > maxBytes) maxBytes = raw.length;
    const sec = Math.floor((recv - t0) / 1000);
    perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
    const tc = m.data.target_currency;
    if (!snap.has(tc)) snap.set(tc, recv - t0);
    last.set(tc, recv);
  });
  t0 = Date.now();
  for (const tc of markets) S.ws.send(sub('ORDERBOOK', tc));
  log('batch_sent', { pairs: markets.length, sendMs: Date.now() - t0 });
  await sleep(60_000);
  const dur = (Date.now() - t0) / 1000;
  const secs = [...perSec.entries()].filter(([s]) => s >= 10).map(([, n]) => n);
  const snapTimes = [...snap.values()];
  log('batch_result', {
    pairs: markets.length,
    acks: acks.size,
    errors: errors.slice(0, 3),
    errorCount: errors.length,
    pairsWithFrame: snap.size,
    pairsWithoutFrame: markets.filter((m) => !snap.has(m)).slice(0, 20),
    firstFrameMs: { min: Math.min(...snapTimes), median: median(snapTimes), max: Math.max(...snapTimes) },
    pairsWithOnlyOneFrame: [...snap.keys()].filter((k) => last.get(k) - t0 === snap.get(k)).length,
    framesPerSecond: Math.round(frames / dur),
    perSecondAfter10s: { median: median(secs), max: secs.length ? Math.max(...secs) : null },
    kbPerSecond: Math.round(bytes / dur / 1024),
    bytesPerFrame: Math.round(bytes / frames),
    maxFrameBytes: maxBytes,
    parseUsPerFrame: Math.round(Number(parseNs / BigInt(frames + acks.size)) / 1000 * 10) / 10,
    serverPings: S.serverPings,
    closed: S.closed,
  });
  S.ws.close();
}

async function silence() {
  const socks = [open('no_sub'), open('quiet_TNSR'), open('busy_BTC')];
  await Promise.all(socks.map((s) => s.ready));
  const lastMsg = socks.map(() => null);
  socks.forEach((s, i) => s.ws.on('message', (raw) => { lastMsg[i] = { at: Date.now() - s.t0, text: raw.toString().slice(0, 120) }; s.frames++; }));
  socks[1].ws.send(sub('ORDERBOOK', 'TNSR'));
  socks[2].ws.send(sub('ORDERBOOK', 'BTC'));
  const start = Date.now();
  while (Date.now() - start < 120_000 && socks.some((s) => !s.closed)) await sleep(1000);
  for (const [i, s] of socks.entries()) log('silence', { label: s.label, openMs: s.openMs, heldMs: Date.now() - s.t0, frames: s.frames, serverPings: s.serverPings, closed: s.closed, lastMsg: lastMsg[i] });
  socks.forEach((s) => s.ws.close());
}

async function deflate() {
  const s = open('deflate', { deflate: true });
  await s.ready;
  const first = await new Promise((res) => s.ws.once('message', (raw) => res(raw.toString())));
  log('deflate', { openMs: s.openMs, negotiatedExtensions: s.extensions, upgrade: s.upgradeHeaders, firstFrame: first });
  s.ws.close();
  const p = open('plain');
  await p.ready;
  const f2 = await new Promise((res) => p.ws.once('message', (raw) => res(raw.toString())));
  log('plain', { openMs: p.openMs, negotiatedExtensions: p.extensions, firstFrame: f2 });
  p.ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate };
log('mode', { name: mode, at: new Date().toISOString() });
await modes[mode]();
await sleep(300);
process.exit(0);
