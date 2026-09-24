// KuCoin Futures WebSocket probe: the tokenless UTA push socket and the classic token socket, book channels, sequence and level order, size unit, keepalive, silence, errors, and a batch of perpetuals on one connection.
// Public, unauthenticated and read-only.
// The classic socket takes the public token from POST /api/v1/bullet-public, which needs no credentials.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node ../scripts/probes/venues/kucoin/ws-probe.mjs [book|batch|silence|deflate]
//   book     UTA obu increment@10ms on six perps for 60 s with a REST book compare, UTA depth 50 and 1, UTA mark-price and funding channels, the classic level2 and level2Depth50 channels, instrument and errors, about 65 s
//   batch    UTA obu increment@10ms on 100 USDT perps on one connection, subscribes paced at 10 per second, then 45 s of data
//   silence  five sockets that differ only in what the client sends or subscribes, for up to 90 s
//   deflate  asks both endpoints for permessage-deflate once and prints what they negotiate
// Set PROBE_OUT_DIR to keep raw frames.
// Recorded in docs/profiles/kucoin/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const UTA_URL = 'wss://x-push-futures.kucoin.com';
const API = 'https://api-futures.kucoin.com';
const OUT = process.env.PROBE_OUT_DIR;
const SYMBOLS = ['XBTUSDTM', 'ETHUSDTM', 'INITUSDTM', 'XBTUSDCM', 'XBTUSDM', 'AAPLUSDTM'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let nextId = 1;
const id = () => `p${nextId++}`;
const utaSub = (symbol, depth = 'increment@10ms', channel = 'obu') => JSON.stringify({ id: id(), action: 'SUBSCRIBE', channel, tradeType: 'FUTURES', symbol, depth });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// The classic socket needs a token and an endpoint from the public bullet call.
async function classicUrl(connectId) {
  const t0 = performance.now();
  const res = await fetch(`${API}/api/v1/bullet-public`, { method: 'POST' });
  const body = await res.json();
  const srv = body.data.instanceServers[0];
  return { url: `${srv.endpoint}?token=${body.data.token}&connectId=${connectId}`, server: srv, tokenMs: Math.round(performance.now() - t0), status: res.status, remain: res.headers.get('gw-ratelimit-remaining') };
}

// A local book per symbol: replace on snapshot, apply a delta when it continues the chain, as the UTA documentation states it.
class Book {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.seq = null; this.maxLevels = 0; }
  reset(d) {
    this.bids.clear(); this.asks.clear();
    for (const [p, s] of d.b ?? []) if (Number(s) !== 0) this.bids.set(p, s);
    for (const [p, s] of d.a ?? []) if (Number(s) !== 0) this.asks.set(p, s);
    this.seq = d.C;
    this.maxLevels = Math.max(this.maxLevels, this.bids.size, this.asks.size);
  }
  apply(d) {
    for (const [p, s] of d.b ?? []) Number(s) === 0 ? this.bids.delete(p) : this.bids.set(p, s);
    for (const [p, s] of d.a ?? []) Number(s) === 0 ? this.asks.delete(p) : this.asks.set(p, s);
    this.seq = d.C;
    this.maxLevels = Math.max(this.maxLevels, this.bids.size, this.asks.size);
  }
  top(n) {
    const bids = [...this.bids].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
    const asks = [...this.asks].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
    return { bids, asks };
  }
}

function open(url, opts = {}) {
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const t0 = performance.now();
  const info = { pings: [], closed: null, openMs: null, extensions: null, upgradeHeaders: null };
  ws.on('upgrade', (res) => { info.upgradeHeaders = res.headers; });
  ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; });
  ws.on('ping', (d) => info.pings.push({ atMs: Math.round(performance.now() - t0), data: d.toString() }));
  ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  ws.on('error', (e) => { info.error = e.message; });
  const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, info, ready, t0 };
}

const isAsc = (levels) => levels.every((l, i) => i === 0 || Number(l[0]) > Number(levels[i - 1][0]));
const isDesc = (levels) => levels.every((l, i) => i === 0 || Number(l[0]) < Number(levels[i - 1][0]));

// UTA obu increment@10ms on SYMBOLS, with the documented chain rule and the strict O = last + 1 rule counted side by side.
async function utaBook() {
  const WINDOW_MS = 60_000;
  const { ws, info, ready, t0 } = open(UTA_URL);
  await ready;
  const stats = Object.fromEntries(SYMBOLS.map((s) => [s, { snapshots: 0, deltas: 0, emptyDeltas: 0, docGaps: 0, strictGaps: 0, overlaps: 0, gapSamples: [], bytes: 0, snapshotLevels: null, snapshotBidsDesc: null, snapshotAsksAsc: null, deltaBidOrderViolations: 0, deltaAskOrderViolations: 0, sizeTypes: new Set(), priceTypes: new Set(), maxIdleMs: 0, lastAt: null, snapshotAfterSubscribeMs: null, snapshotOEqualsC: null, deltaSpan: { min: Infinity, max: 0 }, binaryFrames: 0, textFrames: 0, pMinusMms: [] }]));
  const books = Object.fromEntries(SYMBOLS.map((s) => [s, new Book()]));
  const history = { XBTUSDTM: [], ETHUSDTM: [] };
  const acks = [];
  const pongs = [];
  const other = [];
  const firstFrames = [];
  let msgs = 0;
  let bytes = 0;
  let welcome = null;

  ws.on('message', (data, isBinary) => {
    const text = data.toString();
    msgs++; bytes += data.length;
    const at = performance.now() - t0;
    if (firstFrames.length < 6) firstFrames.push({ atMs: Math.round(at), isBinary, text: text.slice(0, 500) });
    capture('uta_obu_frames.jsonl', text);
    let j; try { j = JSON.parse(text); } catch { other.push(text.slice(0, 200)); return; }
    if (j.message === 'welcome') { welcome = { atMs: Math.round(at), isBinary, frame: j }; return; }
    if (j.type === 'pong') { pongs.push({ atMs: Math.round(at), frame: j }); return; }
    if ('result' in j || j.code || j.msg) { acks.push({ atMs: Math.round(at), isBinary, frame: j }); return; }
    if (j.T !== 'obu.FUTURES') { other.push(text.slice(0, 300)); return; }
    const d = j.d;
    const st = stats[d.s];
    if (!st) { other.push(`unrequested ${d.s}`); return; }
    isBinary ? st.binaryFrames++ : st.textFrames++;
    st.bytes += data.length;
    if (st.pMinusMms.length < 400) st.pMinusMms.push(Number(BigInt(j.P) / 1_000_000n) - Number(BigInt(d.M) / 1_000_000n));
    if (st.lastAt !== null) st.maxIdleMs = Math.max(st.maxIdleMs, Math.round(at - st.lastAt));
    st.lastAt = at;
    for (const [p, s] of [...(d.b ?? []), ...(d.a ?? [])]) { st.sizeTypes.add(typeof s); st.priceTypes.add(typeof p); }
    const book = books[d.s];
    if (j.t === 'snapshot') {
      st.snapshots++;
      if (st.snapshotAfterSubscribeMs === null) { st.snapshotAfterSubscribeMs = Math.round(at - subscribeAt); capture('uta_snapshot_first.jsonl', text); }
      st.snapshotLevels = { bids: d.b?.length ?? 0, asks: d.a?.length ?? 0 };
      st.snapshotBidsDesc = isDesc(d.b ?? []);
      st.snapshotAsksAsc = isAsc(d.a ?? []);
      st.snapshotOEqualsC = d.O === d.C;
      book.reset(d);
    } else {
      st.deltas++;
      if (!(d.b?.length) && !(d.a?.length)) st.emptyDeltas++;
      if (d.b?.length && !isDesc(d.b)) st.deltaBidOrderViolations++;
      if (d.a?.length && !isAsc(d.a)) st.deltaAskOrderViolations++;
      const span = d.C - d.O + 1;
      st.deltaSpan.min = Math.min(st.deltaSpan.min, span); st.deltaSpan.max = Math.max(st.deltaSpan.max, span);
      if (book.seq === null) { st.docGaps++; st.gapSamples.push({ reason: 'delta_before_snapshot', O: d.O }); return; }
      const docOk = d.O <= book.seq + 1 && d.C > book.seq;
      if (!docOk) { st.docGaps++; if (st.gapSamples.length < 5) st.gapSamples.push({ last: book.seq, O: d.O, C: d.C }); }
      if (d.O !== book.seq + 1) st.strictGaps++;
      if (d.O <= book.seq) st.overlaps++;
      book.apply(d);
    }
    if (history[d.s]) {
      history[d.s].push({ seq: book.seq, recv: Date.now(), ...book.top(20) });
      if (history[d.s].length > 600) history[d.s].shift();
    }
  });

  const subscribeAt = performance.now() - t0;
  for (const s of SYMBOLS) ws.send(utaSub(s));
  const pingTimer = setInterval(() => { ws.send(JSON.stringify({ id: id(), type: 'ping' })); }, 15_000);

  // The REST book compare: prices and sizes on both near the same sequence.
  await sleep(30_000);
  const compare = [];
  for (const sym of ['XBTUSDTM', 'ETHUSDTM']) {
    const res = await fetch(`${API}/api/v1/level2/depth20?symbol=${sym}`);
    const rest = (await res.json()).data;
    const h = history[sym];
    const below = [...h].reverse().find((x) => x.seq <= rest.sequence);
    const above = h.find((x) => x.seq >= rest.sequence);
    const score = (x) => {
      if (!x) return null;
      const restBids = new Map(rest.bids.map((l) => [Number(l[0]), l[1]]));
      const restAsks = new Map(rest.asks.map((l) => [Number(l[0]), l[1]]));
      let priceMatch = 0; let sizeMatch = 0;
      const one = (side, restSide) => { for (const [p, s] of side) { if (!restSide.has(Number(p))) continue; priceMatch++; if (Number(restSide.get(Number(p))) === Number(s)) sizeMatch++; } };
      one(x.bids, restBids); one(x.asks, restAsks);
      return { seq: x.seq, priceMatchOf40: priceMatch, sizeMatchOf40: sizeMatch, wsBid0: x.bids[0], wsAsk0: x.asks[0] };
    };
    compare.push({ sym, restSequence: rest.sequence, restTs: rest.ts, restBid0: rest.bids[0], restAsk0: rest.asks[0], restTypes: { price: typeof rest.bids[0]?.[0], size: typeof rest.bids[0]?.[1] }, below: score(below), above: score(above) });
    await sleep(1100);
  }
  log('uta_rest_compare', { compare });

  await sleep(Math.max(0, WINDOW_MS - (performance.now() - t0 - subscribeAt)));
  clearInterval(pingTimer);
  const windowSec = (performance.now() - t0 - subscribeAt) / 1000;
  ws.close();
  await sleep(300);
  for (const [sym, st] of Object.entries(stats)) {
    const { lastAt, sizeTypes, priceTypes, pMinusMms, ...rest } = st;
    const lag = [...pMinusMms].sort((a, b) => a - b);
    log('uta_obu_stats', { sym, windowSec: +windowSec.toFixed(1), msgPerSec: +((st.snapshots + st.deltas) / windowSec).toFixed(1), bytesPerSec: Math.round(st.bytes / windowSec), sizeTypes: [...sizeTypes], priceTypes: [...priceTypes], maxHeldLevels: books[sym].maxLevels, heldAtEnd: { bids: books[sym].bids.size, asks: books[sym].asks.size }, pushMinusMatchMs: lag.length ? { min: lag[0], median: lag[Math.floor(lag.length / 2)], max: lag.at(-1) } : null, ...rest });
  }
  log('uta_obu_session', { msgs, bytes, msgPerSec: +(msgs / windowSec).toFixed(1), openMs: info.openMs, extensions: info.extensions, upgradeHeaders: info.upgradeHeaders, serverPings: info.pings, closed: info.closed, welcome, acks, pongs, other: other.slice(0, 5), firstFrames });
}

// A socket that subscribes a list of frames, classifies what comes back and logs a summary.
async function channelTest(url, label, subs, windowMs, classify, afterWelcome = false) {
  const { ws, info, ready, t0 } = open(url);
  await ready;
  const frames = [];
  const counts = {};
  const state = {};
  let sent = false;
  const sendAll = () => { if (sent) return; sent = true; for (const s of subs) ws.send(s); };
  ws.on('message', (data, isBinary) => {
    const text = data.toString();
    const at = Math.round(performance.now() - t0);
    capture(`${label}.jsonl`, text);
    let j; try { j = JSON.parse(text); } catch { frames.push({ at, isBinary, text: text.slice(0, 200) }); return; }
    const key = j.T ?? `${j.type ?? ''}|${j.topic ?? ''}|${j.subject ?? ''}|${j.message ?? ''}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (frames.length < 14 || counts[key] <= 2) frames.push({ at, isBinary, text: text.slice(0, 600) });
    classify?.(j, state, at);
    if (afterWelcome && (j.type === 'welcome' || j.message === 'welcome')) sendAll();
  });
  if (!afterWelcome) sendAll();
  await sleep(windowMs);
  ws.close();
  await sleep(300);
  log('channel', { label, openMs: info.openMs, windowMs, counts, state, closed: info.closed, serverPings: info.pings.length, frames: frames.slice(0, 24) });
}

// Classic level2: one change per frame, per symbol sequence, and whether it chains by one.
function classicClassifier(j, state) {
  if (j.type !== 'message') return;
  if (j.subject === 'level2' && j.topic.startsWith('/contractMarket/level2:')) {
    const sym = j.topic.split(':')[1];
    const st = (state[`level2:${sym}`] ??= { frames: 0, gaps: 0, repeats: 0, last: null, snEqualsSeq: 0, changeFields: null });
    st.frames++;
    if (j.sn === j.data.sequence) st.snEqualsSeq++;
    st.changeFields = j.data.change.split(',').length;
    if (st.last !== null) { if (j.data.sequence === st.last) st.repeats++; else if (j.data.sequence !== st.last + 1) st.gaps++; }
    st.last = j.data.sequence;
  }
  if (j.topic?.startsWith('/contractMarket/level2Depth50:')) {
    const sym = j.topic.split(':')[1];
    const st = (state[`depth50:${sym}`] ??= { frames: 0, levels: null, bidsDesc: 0, asksAsc: 0, sizeType: null, seqRepeats: 0, lastSeq: null, snMinusTs: null, intervals: [] , lastTs: null });
    st.frames++;
    const d = j.data;
    st.levels = { bids: d.bids.length, asks: d.asks.length };
    if (isDesc(d.bids)) st.bidsDesc++;
    if (isAsc(d.asks)) st.asksAsc++;
    st.sizeType = typeof d.bids[0]?.[1];
    if (st.lastSeq === d.sequence) st.seqRepeats++;
    st.lastSeq = d.sequence;
    if (st.lastTs !== null && st.intervals.length < 50) st.intervals.push(d.ts - st.lastTs);
    st.lastTs = d.ts;
    st.snMinusTs = j.sn - d.ts;
  }
  if (j.subject === 'mark.index.price' || j.subject === 'funding.rate') {
    const st = (state[`${j.subject}`] ??= { frames: 0, last: null });
    st.frames++; st.last = j.data;
  }
}

// UTA side channels: depth 50 and depth 1 snapshots, mark-price, funding-fee.
function utaSideClassifier(j, state) {
  if (j.T === 'obu.FUTURES') {
    const st = (state[`obu:${j.d.s}:${j.dp}`] ??= { frames: 0, types: {}, levels: null, bidsDesc: 0, asksAsc: 0, sameCRepeats: 0, lastC: null, intervalsMs: [], lastP: null });
    st.frames++;
    st.types[j.t] = (st.types[j.t] ?? 0) + 1;
    st.levels = { bids: j.d.b.length, asks: j.d.a.length };
    if (isDesc(j.d.b)) st.bidsDesc++;
    if (isAsc(j.d.a)) st.asksAsc++;
    if (st.lastC === j.d.C) st.sameCRepeats++;
    st.lastC = j.d.C;
    const pMs = Number(BigInt(j.P) / 1_000_000n);
    if (st.lastP !== null && st.intervalsMs.length < 40) st.intervalsMs.push(pMs - st.lastP);
    st.lastP = pMs;
  } else if (j.T) {
    const st = (state[j.T] ??= { frames: 0, first: null, last: null, rows: null });
    st.frames++;
    if (!st.first) st.first = JSON.stringify(j).slice(0, 400);
    st.last = JSON.stringify(j).slice(0, 400);
    if (Array.isArray(j.d)) st.rows = j.d.length;
  }
}

async function bookMode() {
  const classic = await classicUrl('probebook');
  log('classic_token', { server: classic.server, tokenMs: classic.tokenMs, status: classic.status, remain: classic.remain });
  await Promise.all([
    utaBook(),
    (async () => {
      await sleep(500);
      await channelTest(UTA_URL, 'uta_side', [
        utaSub('ETHUSDTM', '50'),
        utaSub('INITUSDTM', '50'),
        utaSub('XBTUSDTM', '1'),
        JSON.stringify({ id: id(), action: 'SUBSCRIBE', channel: 'mark-price', symbol: 'XBTUSDTM' }),
        JSON.stringify({ id: id(), action: 'SUBSCRIBE', channel: 'funding-fee', symbol: 'XBTUSDTM' }),
        JSON.stringify({ id: id(), action: 'SUBSCRIBE', channel: 'funding-fee-all-symbols' }),
      ], 62_000, utaSideClassifier, true);
    })(),
    (async () => {
      await sleep(1000);
      await channelTest(classic.url, 'classic', [
        JSON.stringify({ id: id(), type: 'subscribe', topic: '/contractMarket/level2:XBTUSDTM,INITUSDTM', response: true }),
        JSON.stringify({ id: id(), type: 'subscribe', topic: '/contractMarket/level2Depth50:XBTUSDTM,ETHUSDTM,INITUSDTM', response: true }),
        JSON.stringify({ id: id(), type: 'subscribe', topic: '/contract/instrument:XBTUSDTM', response: true }),
        JSON.stringify({ id: id(), type: 'ping' }),
      ], 30_000, classicClassifier, true);
    })(),
    (async () => {
      await sleep(1500);
      await channelTest(UTA_URL, 'uta_errors', [
        utaSub('NOPEUSDTM'),
        utaSub('XBTUSDTM', '20'),
        utaSub('XBT-USDT'),
        JSON.stringify({ id: id(), action: 'SUBSCRIBE', channel: 'obu', tradeType: 'SPOT', symbol: 'XBTUSDTM', depth: '50' }),
        JSON.stringify({ id: id(), action: 'SUBSCRIBE', channel: 'nope', tradeType: 'FUTURES', symbol: 'XBTUSDTM' }),
        JSON.stringify({ id: id(), action: 'SUBSCRIBE', channel: 'obu', tradeType: 'FUTURES', symbols: ['XBTUSDTM', 'ETHUSDTM'], depth: '1' }),
        utaSub('ESIMUSDTM', 'increment@10ms'),
        utaSub('ESIMUSDTM', 'increment@10ms'),
        utaSub('XBTMZ26', '1'),
        utaSub('XBTUSDTM', 'increment'),
        'not json',
      ], 12_000, utaSideClassifier, true);
    })(),
    (async () => {
      await sleep(2000);
      const c2 = await classicUrl('probeerrors');
      await channelTest(c2.url, 'classic_errors', [
        JSON.stringify({ id: id(), type: 'subscribe', topic: '/contractMarket/level2:NOPEUSDTM', response: true }),
        JSON.stringify({ id: id(), type: 'subscribe', topic: '/contractMarket/level2Depth20:XBTUSDTM', response: true }),
        JSON.stringify({ id: id(), type: 'subscribe', topic: '/contractMarket/nope:XBTUSDTM', response: true }),
        JSON.stringify({ id: id(), type: 'subscribe', topic: '/contractMarket/level2Depth50:XBTUSDTM', response: true }),
        JSON.stringify({ id: id(), type: 'subscribe', topic: '/contractMarket/level2Depth50:XBTUSDTM', response: true }),
        'not json',
      ], 8_000, classicClassifier, true);
    })(),
  ]);
}

// 100 USDT perpetuals on one UTA connection, one subscribe frame per symbol, ten per second.
async function batchMode() {
  const active = (await (await fetch(`${API}/api/v1/contracts/active`)).json()).data
    .filter((x) => x.nextFundingRateTime != null && x.settleCurrency === 'USDT' && x.marketStage === 'NORMAL')
    .sort((a, b) => b.turnoverOf24h - a.turnoverOf24h);
  const picked = active.filter((_, i) => i % Math.floor(active.length / 100) === 0).slice(0, 100).map((x) => x.symbol);
  const WINDOW_MS = 45_000;
  const { ws, info, ready, t0 } = open(UTA_URL);
  await ready;
  const last = new Map();
  const snaps = new Set();
  let msgs = 0; let bytes = 0; let gaps = 0; let strictGaps = 0; let parseNs = 0n; let acksOk = 0; let acksOther = []; let peak = 0; let perSec = 0; let secStart = performance.now();
  const secCounts = [];
  ws.on('message', (data) => {
    msgs++; bytes += data.length; perSec++;
    const now = performance.now();
    if (now - secStart >= 1000) { secCounts.push(perSec); peak = Math.max(peak, perSec); perSec = 0; secStart = now; }
    const p0 = process.hrtime.bigint();
    const j = JSON.parse(data.toString());
    parseNs += process.hrtime.bigint() - p0;
    if ('result' in j) { if (j.result === true) acksOk++; else acksOther.push(j); return; }
    if (j.T !== 'obu.FUTURES') return;
    const d = j.d;
    if (j.t === 'snapshot') { snaps.add(d.s); last.set(d.s, d.C); return; }
    const prev = last.get(d.s);
    if (prev === undefined) { gaps++; return; }
    if (!(d.O <= prev + 1 && d.C > prev)) gaps++;
    if (d.O !== prev + 1) strictGaps++;
    last.set(d.s, d.C);
  });
  const subStart = performance.now();
  for (let i = 0; i < picked.length; i++) {
    ws.send(utaSub(picked[i]));
    if (i % 10 === 9) await sleep(1000);
  }
  const subscribeMs = Math.round(performance.now() - subStart);
  const pingTimer = setInterval(() => ws.send(JSON.stringify({ id: id(), type: 'ping' })), 15_000);
  await sleep(WINDOW_MS);
  clearInterval(pingTimer);
  const sec = (performance.now() - t0) / 1000;
  ws.close();
  await sleep(300);
  const sorted = [...secCounts].sort((a, b) => a - b);
  log('batch', { streams: picked.length, subscribeMs, acksOk, acksOther: acksOther.slice(0, 5), snapshots: snaps.size, missingSnapshot: picked.filter((s) => !snaps.has(s)), msgs, gaps, strictGaps, seconds: +sec.toFixed(1), msgPerSec: +(msgs / sec).toFixed(1), medianPerSec: sorted[Math.floor(sorted.length / 2)], peakPerSec: peak, bytesPerSec: Math.round(bytes / sec), bytesPerMsg: Math.round(bytes / msgs), parseUsPerMsg: +(Number(parseNs / BigInt(msgs)) / 1000).toFixed(1), closed: info.closed, first: picked.slice(0, 5), last: picked.slice(-5) });
}

// Five sockets that differ only in what the client sends, to find the silence each endpoint tolerates.
async function silenceMode() {
  const WINDOW_MS = 90_000;
  const variants = [
    { label: 'uta_sub_no_ping', url: UTA_URL, subs: [utaSub('INITUSDTM', '1')], ping: 0 },
    { label: 'uta_nosub_no_ping', url: UTA_URL, subs: [], ping: 0 },
    { label: 'uta_sub_ping_15s', url: UTA_URL, subs: [utaSub('INITUSDTM', '1')], ping: 15_000 },
    { label: 'classic_sub_no_ping', url: null, subs: [JSON.stringify({ id: id(), type: 'subscribe', topic: '/contractMarket/level2Depth5:INITUSDTM', response: true })], ping: 0 },
    { label: 'classic_nosub_no_ping', url: null, subs: [], ping: 0 },
  ];
  await Promise.all(variants.map(async (v, i) => {
    await sleep(i * 300);
    const url = v.url ?? (await classicUrl(`silence${i}`)).url;
    const { ws, info, ready } = open(url);
    await ready;
    let frames = 0; let lastFrameMs = null; let pongs = 0; const firsts = [];
    const t0 = performance.now();
    ws.on('message', (d) => { frames++; lastFrameMs = Math.round(performance.now() - t0); const s = d.toString(); if (firsts.length < 3) firsts.push(s.slice(0, 200)); if (s.includes('pong')) pongs++; });
    for (const s of v.subs) ws.send(s);
    const timer = v.ping ? setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ id: id(), type: 'ping' })), v.ping) : null;
    const until = Date.now() + WINDOW_MS;
    while (Date.now() < until && info.closed === null) await sleep(250);
    if (timer) clearInterval(timer);
    const closedByServer = info.closed !== null;
    if (!closedByServer) ws.close();
    await sleep(200);
    log('silence', { label: v.label, closedByServer, closed: closedByServer ? info.closed : null, openMs: info.openMs, frames, lastFrameMs, pongs, serverPings: info.pings, firsts });
  }));
}

async function deflateMode() {
  for (const [label, url] of [['uta', UTA_URL], ['classic', (await classicUrl('deflate')).url]]) {
    const { ws, info, ready } = open(url, { perMessageDeflate: true });
    await ready;
    await sleep(1500);
    ws.close();
    await sleep(200);
    log('deflate', { label, extensions: info.extensions, secWebSocketExtensions: info.upgradeHeaders?.['sec-websocket-extensions'] ?? null, upgradeHeaders: info.upgradeHeaders });
  }
}

const mode = process.argv[2] ?? 'book';
if (mode === 'book') await bookMode();
else if (mode === 'batch') await batchMode();
else if (mode === 'silence') await silenceMode();
else if (mode === 'deflate') await deflateMode();
else { console.error(`unknown mode ${mode}`); process.exit(1); }
