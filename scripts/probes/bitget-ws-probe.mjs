// Bitget public WebSocket probe: the book channels on the v2 and v3 public sockets, their snapshot, sequence, checksum, level order and size unit, the keepalive, a silent connection, a 150 perp batch, and the ticker channels.
// Public, unauthenticated, read-only. Client messages stay under the published 10 per second per connection, and the batch stays under 1000 channels per connection.
// Run from server/: node ../scripts/probes/bitget-ws-probe.mjs [sections] [--out DIR] [--thin MAVUSDT,CELRUSDT]
// Sections: book (150 s), batch (70 s on v2), batch3 (the same 150 perps on v3 in frames of 10, 70 s), channels (25 s). Without a section list book, batch and channels run in that order.
// Recorded in docs/profiles/bitget/websocket.md.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const V2 = 'wss://ws.bitget.com/v2/ws/public';
const V3 = 'wss://ws.bitget.com/v3/ws/public';
const API = 'https://api.bitget.com';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = opt('--out') ?? path.join(os.tmpdir(), 'bitget-probe');
const THIN = (opt('--thin') ?? 'MAVUSDT,CELRUSDT').split(',');
const named = args.filter((a, i) => !a.startsWith('--') && !['--out', '--thin'].includes(args[i - 1]));
const SECTIONS = named.length ? named : ['book', 'batch', 'channels'];
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (section, data) => console.log(JSON.stringify({ section, ...data }));
const rawFile = path.join(OUT, 'ws-frames.jsonl');
const raw = (conn, text) => fs.appendFileSync(rawFile, JSON.stringify({ conn, at: Date.now(), text: text.length > 4000 ? text.slice(0, 4000) + `...(${text.length} chars)` : text }) + '\n');

// CRC32 signed, as ccxt/js/src/pro/bitget.js builds it for the classic books checksum: 25 levels, bid then ask, price:size strings joined by colons.
function crc32Signed(str) {
  return zlib.crc32(Buffer.from(str, 'utf8')) | 0;
}

// A local book keyed by the price string, so a checksum can reuse the strings exactly as sent.
class Book {
  constructor() { this.bids = new Map(); this.asks = new Map(); }
  reset(bids, asks) { this.bids.clear(); this.asks.clear(); this.apply(bids, asks); }
  apply(bids, asks) {
    for (const [p, s] of bids) { if (Number(s) === 0) this.bids.delete(p); else this.bids.set(p, [p, s]); }
    for (const [p, s] of asks) { if (Number(s) === 0) this.asks.delete(p); else this.asks.set(p, [p, s]); }
  }
  top(n) {
    const b = [...this.bids.values()].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
    const a = [...this.asks.values()].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
    return { b, a };
  }
  checksum() {
    const { b, a } = this.top(25);
    const parts = [];
    for (let i = 0; i < 25; i++) {
      if (i < b.length) parts.push(b[i][0], b[i][1]);
      if (i < a.length) parts.push(a[i][0], a[i][1]);
    }
    return crc32Signed(parts.join(':'));
  }
}

const ordered = (levels, dir) => levels.every((x, i) => i === 0 || (dir === 'desc' ? Number(x[0]) < Number(levels[i - 1][0]) : Number(x[0]) > Number(levels[i - 1][0])));

// Stats per (connection, channel, symbol).
function newStats() {
  return { snapshots: 0, updates: 0, otherActions: {}, bytes: 0, firstSnapshot: null, gaps: 0, gapSamples: [], seqNotIncreasing: 0, pseqZero: 0, snapshotSeqInFirstUpdateRange: null, checksumPresent: 0, checksumZero: 0, checksumOk: 0, checksumBad: 0, checksumBadSamples: [], unorderedFrames: 0, crossedAfterApply: 0, emptyUpdates: 0, identicalRepeats: 0, intervalsMs: [], maxDepthValues: {}, levelCounts: [] };
}

function openSocket(url, name, onFrame) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const info = { name, url, openMs: null, extensions: null, binaryFrames: 0, textFrames: 0, bytes: 0, closed: null, pongs: [], errors: [] };
    ws.on('upgrade', (res) => { info.upgradeHeaders = { server: res.headers.server, via: res.headers.via, pop: res.headers['x-amz-cf-pop'], extensions: res.headers['sec-websocket-extensions'] ?? null }; });
    ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; resolve({ ws, info }); });
    ws.on('message', (data, isBinary) => {
      if (isBinary) info.binaryFrames++; else info.textFrames++;
      const text = data.toString('utf8');
      info.bytes += data.length;
      if (text === 'pong') {
        if (info.pingSentAt) { info.pongs.push(Date.now() - info.pingSentAt); info.pingSentAt = null; }
        raw(name, text);
        return;
      }
      onFrame(text, data.length);
    });
    ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
    ws.on('error', (e) => { info.errors.push(e.message); resolve({ ws, info }); });
  });
}

function makeHandler(name, stats, books, seqDigests, onControl) {
  const lastFrame = new Map();
  const lastAt = new Map();
  const lastSeq = new Map();
  const frameCounts = new Map();
  return (text, bytes) => {
    let j;
    try { j = JSON.parse(text); } catch { raw(name, text); onControl?.({ unparsed: text.slice(0, 200) }); return; }
    if (j.event || !j.data) { raw(name, text); onControl?.(j); return; }
    const arg = j.arg ?? {};
    const channel = arg.channel ?? arg.topic;
    const sym = arg.instId ?? arg.symbol;
    const key = `${channel}:${sym}`;
    const n = (frameCounts.get(key) ?? 0) + 1;
    frameCounts.set(key, n);
    if (n <= 4) raw(name, text);
    if (!channel?.startsWith('books')) { onControl?.(j); return; }
    const st = (stats[key] ??= newStats());
    st.bytes += bytes;
    const d = j.data[0];
    const bids = d.bids ?? d.b ?? [];
    const asks = d.asks ?? d.a ?? [];
    const now = Date.now();
    if (lastAt.has(key)) st.intervalsMs.push(now - lastAt.get(key));
    lastAt.set(key, now);
    const md = d.maxDepth ?? d.maxdepth;
    if (md !== undefined) st.maxDepthValues[md] = (st.maxDepthValues[md] ?? 0) + 1;
    if (!ordered(bids, 'desc') || !ordered(asks, 'asc')) st.unorderedFrames++;
    const body = JSON.stringify([bids, asks]);
    if (lastFrame.get(key) === body) st.identicalRepeats++;
    lastFrame.set(key, body);
    if (d.checksum !== undefined) { st.checksumPresent++; if (d.checksum === 0) st.checksumZero++; }
    const seq = Number(d.seq);
    const pseq = Number(d.pseq);
    if (j.action === 'snapshot') {
      st.snapshots++;
      st.levelCounts.push([bids.length, asks.length]);
      if (!st.firstSnapshot) st.firstSnapshot = { bids: bids.length, asks: asks.length, bytes, seq: d.seq, pseq: d.pseq, ts: d.ts, b0: bids[0], a0: asks[0], keys: Object.keys(d), topKeys: Object.keys(j) };
      if (channel === 'books') {
        const book = (books[key] ??= new Book());
        book.reset(bids, asks);
        st.snapshotSeq = seq;
        st.awaitFirstUpdate = true;
      }
      lastSeq.set(key, seq);
    } else if (j.action === 'update') {
      st.updates++;
      if (bids.length === 0 && asks.length === 0) st.emptyUpdates++;
      if (pseq === 0) st.pseqZero++;
      const prev = lastSeq.get(key);
      if (st.awaitFirstUpdate) {
        st.snapshotSeqInFirstUpdateRange = { snapshotSeq: st.snapshotSeq, firstUpdatePseq: pseq, firstUpdateSeq: seq, equalsPseq: st.snapshotSeq === pseq, inRange: pseq <= st.snapshotSeq && st.snapshotSeq <= seq };
        st.awaitFirstUpdate = false;
      } else if (prev !== undefined && pseq !== prev) {
        st.gaps++;
        if (st.gapSamples.length < 5) st.gapSamples.push({ prevSeq: prev, pseq, seq });
      }
      if (prev !== undefined && !(seq > prev)) st.seqNotIncreasing++;
      lastSeq.set(key, seq);
      const book = books[key];
      if (book) {
        book.apply(bids, asks);
        const { b, a } = book.top(1);
        if (b[0] && a[0] && Number(b[0][0]) >= Number(a[0][0])) st.crossedAfterApply++;
        if (d.checksum !== undefined && d.checksum !== 0) {
          const mine = book.checksum();
          if (mine === d.checksum) st.checksumOk++; else { st.checksumBad++; if (st.checksumBadSamples.length < 3) st.checksumBadSamples.push({ seq: d.seq, theirs: d.checksum, mine }); }
        }
        if (seqDigests && sym === 'BTCUSDT') {
          const t = book.top(20);
          seqDigests.set(seq, JSON.stringify(t));
        }
      }
    } else {
      st.otherActions[j.action] = (st.otherActions[j.action] ?? 0) + 1;
    }
  };
}

function summarize(stats) {
  const out = {};
  for (const [k, s] of Object.entries(stats)) {
    const iv = [...s.intervalsMs].sort((a, b) => a - b);
    const lc = s.levelCounts;
    out[k] = { ...s, intervalsMs: iv.length ? { n: iv.length, min: iv[0], med: iv[Math.floor(iv.length / 2)], p90: iv[Math.floor(iv.length * 0.9)], max: iv[iv.length - 1] } : null, levelCounts: lc.length ? { first: lc[0], min: Math.min(...lc.map((x) => Math.min(...x))), max: Math.max(...lc.map((x) => Math.max(...x))) } : null, awaitFirstUpdate: undefined, snapshotSeq: undefined };
  }
  return out;
}

async function restDepth(symbol, productType = 'USDT-FUTURES') {
  const res = await fetch(`${API}/api/v2/mix/market/merge-depth?productType=${productType}&symbol=${symbol}&limit=5`);
  const j = await res.json();
  return { ts: j.data?.ts, bids: j.data?.bids, asks: j.data?.asks };
}

async function book() {
  const WINDOW_MS = 150_000;
  const statsA = {};
  const booksA = {};
  const digestsA = new Map();
  const controlA = [];
  const { ws: a, info: infoA } = await openSocket(V2, 'v2-main', makeHandler('v2-main', statsA, booksA, digestsA, (j) => controlA.push(j)));
  const statsB = {};
  const controlB = [];
  const { ws: b, info: infoB } = await openSocket(V2, 'v2-silent', makeHandler('v2-silent', statsB, {}, null, (j) => controlB.push(j)));
  const statsC = {};
  const booksC = {};
  const digestsC = new Map();
  const controlC = [];
  const { ws: c, info: infoC } = await openSocket(V3, 'v3-main', makeHandler('v3-main', statsC, booksC, digestsC, (j) => controlC.push(j)));

  const v2arg = (instType, channel, instId) => ({ instType, channel, instId });
  const v3arg = (instType, topic, symbol) => ({ instType, topic, symbol });
  const send = (ws, info, frame) => { ws.send(JSON.stringify(frame)); raw(info.name, '>> ' + JSON.stringify(frame)); };

  const t0 = Date.now();
  send(a, infoA, { op: 'subscribe', args: [v2arg('USDT-FUTURES', 'books', 'BTCUSDT'), ...THIN.map((s) => v2arg('USDT-FUTURES', 'books', s))] });
  send(b, infoB, { op: 'subscribe', args: [v2arg('USDT-FUTURES', 'books', THIN[0])] });
  send(c, infoC, { op: 'subscribe', args: [v3arg('usdt-futures', 'books', 'BTCUSDT'), v3arg('usdt-futures', 'books', THIN[0])] });

  // The REST book one moment after the first BTC snapshot, for the size unit.
  await sleep(1500);
  const rest = await restDepth('BTCUSDT');
  const wsTop = booksA['books:BTCUSDT']?.top(5);
  log('book', { sizeUnitCheck: { wsTop5: wsTop, restTop5: rest } });

  await sleep(500);
  send(a, infoA, { op: 'subscribe', args: [v2arg('USDT-FUTURES', 'books15', 'BTCUSDT'), v2arg('USDT-FUTURES', 'books15', THIN[0]), v2arg('USDT-FUTURES', 'books5', THIN[0]), v2arg('USDT-FUTURES', 'books1', THIN[0])] });
  await sleep(500);
  send(a, infoA, { op: 'subscribe', args: [v2arg('USDT-FUTURES', 'books50', 'BTCUSDT')] });
  await sleep(500);
  send(a, infoA, { op: 'subscribe', args: [v2arg('USDT-FUTURES', 'books', 'NOPEUSDT')] });
  await sleep(500);
  send(a, infoA, { op: 'subscribe', args: [v2arg('USDC-FUTURES', 'books', 'BTCPERP'), v2arg('COIN-FUTURES', 'books', 'BTCUSD')] });
  await sleep(500);
  send(a, infoA, { op: 'subscribe', args: [v2arg('USDT-FUTURES', 'books', 'BTCPERP')] });
  await sleep(500);
  send(c, infoC, { op: 'subscribe', args: [v3arg('usdt-futures', 'books50', 'BTCUSDT'), v3arg('usdt-futures', 'books', 'NOPEUSDT')] });
  await sleep(500);
  send(c, infoC, { op: 'subscribe', args: [v3arg('usdc-futures', 'books', 'BTCPERP'), v3arg('coin-futures', 'books', 'BTCUSD')] });

  // Pings on A and C every 25 s. B never pings, to see what the server does after two silent minutes.
  const pinger = setInterval(() => {
    for (const [ws, info] of [[a, infoA], [c, infoC]]) {
      if (ws.readyState === WebSocket.OPEN) { info.pingSentAt = Date.now(); ws.send('ping'); }
    }
  }, 25_000);

  // The size of the REST book again at the end, against the thin book.
  const waitLeft = WINDOW_MS - (Date.now() - t0) - 3000;
  await sleep(waitLeft);
  const restThin = await restDepth(THIN[0]);
  log('book', { sizeUnitCheckThin: { wsTop5: booksA[`books:${THIN[0]}`]?.top(5), restTop5: restThin } });
  await sleep(3000);
  clearInterval(pinger);

  // BTC top 20 on v2 and v3 at every sequence number both sockets published.
  let both = 0;
  let same = 0;
  const diffs = [];
  for (const [seq, dig] of digestsA) {
    if (!digestsC.has(seq)) continue;
    both++;
    if (digestsC.get(seq) === dig) same++; else if (diffs.length < 2) diffs.push({ seq, v2: JSON.parse(dig).b.slice(0, 3), v3: JSON.parse(digestsC.get(seq)).b.slice(0, 3) });
  }

  for (const ws of [a, b, c]) try { ws.close(); } catch {}
  await sleep(500);
  log('book', { connection: infoA, control: controlA, stats: summarize(statsA) });
  log('book', { connection: infoB, control: controlB, stats: summarize(statsB) });
  log('book', { connection: infoC, control: controlC, stats: summarize(statsC) });
  log('book', { v2VsV3BtcTop20: { seqsOnV2: digestsA.size, seqsOnV3: digestsC.size, seqsOnBoth: both, identicalTop20: same, diffs } });
}

async function batch(v3 = false) {
  const WINDOW_MS = 70_000;
  const res = await fetch(`${API}/api/v2/mix/market/tickers?productType=USDT-FUTURES`);
  const tick = await res.json();
  const cres = await fetch(`${API}/api/v2/mix/market/contracts?productType=USDT-FUTURES`);
  const contracts = await cres.json();
  const rwa = new Set(contracts.data.filter((x) => x.isRwa === 'YES').map((x) => x.symbol));
  // The 150 busiest crypto perps by 24 h USDT volume, so the batch measures a realistic load.
  const symbols = tick.data.filter((t) => !rwa.has(t.symbol)).sort((x, y) => Number(y.usdtVolume) - Number(x.usdtVolume)).slice(0, 150).map((t) => t.symbol);
  const stats = {};
  const books = {};
  const control = [];
  let parseMs = 0;
  let maxFrame = 0;
  const name = v3 ? 'v3-batch' : 'v2-batch';
  const handler = makeHandler(name, stats, books, null, (j) => control.push(j));
  const { ws, info } = await openSocket(v3 ? V3 : V2, name, (text, bytes) => { maxFrame = Math.max(maxFrame, bytes); const t = performance.now(); handler(text, bytes); parseMs += performance.now() - t; });
  const frames = [];
  let cur = [];
  const argOf = (s) => (v3 ? { instType: 'usdt-futures', topic: 'books', symbol: s } : { instType: 'USDT-FUTURES', channel: 'books', instId: s });
  // v3 closed the socket with 1006 on frames of 25 or more books arguments on 2026-09-15, while frames of 20 or fewer worked, so v3 frames carry at most 10.
  const maxArgs = v3 ? 10 : Infinity;
  for (const s of symbols) {
    const next = [...cur, argOf(s)];
    if (JSON.stringify({ op: 'subscribe', args: next }).length > 4000 || next.length > maxArgs) { frames.push(cur); cur = [argOf(s)]; } else cur = next;
  }
  if (cur.length) frames.push(cur);
  const t0 = Date.now();
  for (const f of frames) {
    const frame = JSON.stringify({ op: 'subscribe', args: f });
    ws.send(frame);
    raw(name, `>> frame of ${f.length} args, ${frame.length} bytes`);
    await sleep(1100);
  }
  const subscribedAt = Date.now();
  const pinger = setInterval(() => { if (ws.readyState === WebSocket.OPEN) { info.pingSentAt = Date.now(); ws.send('ping'); } }, 25_000);
  const bytesAtSub = info.bytes;
  const msgsAtSub = info.textFrames;
  await sleep(WINDOW_MS - (Date.now() - t0));
  clearInterval(pinger);
  const windowS = (Date.now() - subscribedAt) / 1000;
  try { ws.close(); } catch {}
  await sleep(500);
  const s = summarize(stats);
  const acks = control.filter((x) => x.event === 'subscribe').length;
  const errors = control.filter((x) => x.event === 'error');
  let gaps = 0, snapshots = 0, updates = 0, crossed = 0, unordered = 0, checksumPresent = 0, checksumOk = 0, checksumBad = 0, noSnapshot = 0, snapshotBytes = 0, seqNotIncreasing = 0, notInRange = 0;
  for (const sym of symbols) {
    const x = s[`books:${sym}`];
    if (!x || x.snapshots === 0) { noSnapshot++; continue; }
    gaps += x.gaps; snapshots += x.snapshots; updates += x.updates; crossed += x.crossedAfterApply; unordered += x.unorderedFrames; checksumPresent += x.checksumPresent; checksumOk += x.checksumOk; checksumBad += x.checksumBad; snapshotBytes += x.firstSnapshot.bytes; seqNotIncreasing += x.seqNotIncreasing;
    if (x.snapshotSeqInFirstUpdateRange && !x.snapshotSeqInFirstUpdateRange.inRange) notInRange++;
  }
  const levels = symbols.map((sym) => s[`books:${sym}`]?.firstSnapshot).filter(Boolean).map((f) => Math.min(f.bids, f.asks)).sort((x, y) => x - y);
  log(name, { symbols: symbols.length, subscribeFrames: frames.map((f) => f.length), acks, errors, connection: info, windowAfterSubscribeS: round1(windowS), msgsPerS: round1((info.textFrames - msgsAtSub) / windowS), bytesPerS: Math.round((info.bytes - bytesAtSub) / windowS), maxFrameBytes: maxFrame, parseAndApplyMsTotal: Math.round(parseMs), snapshots, updates, gaps, seqNotIncreasing, snapshotSeqOutsideFirstUpdateRange: notInRange, crossedAfterApply: crossed, unorderedFrames: unordered, checksumPresent, checksumOk, checksumBad, symbolsWithoutSnapshot: noSnapshot, snapshotBytesTotal: snapshotBytes, snapshotMinSideLevels: { min: levels[0], med: levels[Math.floor(levels.length / 2)], max: levels[levels.length - 1] } });
}

const round1 = (x) => Math.round(x * 10) / 10;

async function channels() {
  const WINDOW_MS = 25_000;
  const frames = {};
  const control = [];
  const onFrame = (name) => (text) => {
    let j; try { j = JSON.parse(text); } catch { return; }
    if (j.event || !j.data) { control.push({ name, j }); raw(name, text); return; }
    const arg = j.arg ?? {};
    const key = `${name}:${arg.channel ?? arg.topic}:${arg.instId ?? arg.symbol}`;
    const f = (frames[key] ??= { n: 0, first: null, marks: new Set(), indexes: new Set(), rates: new Set(), nextFunding: new Set(), keys: null, intervals: [], lastAt: 0 });
    f.n++;
    const now = Date.now();
    if (f.lastAt) f.intervals.push(now - f.lastAt);
    f.lastAt = now;
    const d = j.data[0];
    if (!f.first) { f.first = text.slice(0, 1500); f.keys = Object.keys(d); raw(name, text); }
    if (d.markPrice !== undefined) f.marks.add(d.markPrice);
    if (d.indexPrice !== undefined) f.indexes.add(d.indexPrice);
    if (d.fundingRate !== undefined) f.rates.add(d.fundingRate);
    if (d.nextFundingTime !== undefined) f.nextFunding.add(d.nextFundingTime);
  };
  const { ws: a, info: ia } = await openSocket(V2, 'v2-channels', onFrame('v2'));
  const { ws: c, info: ic } = await openSocket(V3, 'v3-channels', onFrame('v3'));
  a.send(JSON.stringify({ op: 'subscribe', args: [{ instType: 'USDT-FUTURES', channel: 'ticker', instId: 'BTCUSDT' }, { instType: 'USDT-FUTURES', channel: 'ticker', instId: THIN[0] }, { instType: 'USDT-FUTURES', channel: 'books1', instId: 'BTCUSDT' }] }));
  await sleep(300);
  a.send(JSON.stringify({ op: 'subscribe', args: [{ instType: 'USDT-FUTURES', channel: 'trade', instId: 'BTCUSDT' }, { instType: 'USDT-FUTURES', channel: 'markPrice', instId: 'BTCUSDT' }, { instType: 'USDT-FUTURES', channel: 'funding', instId: 'BTCUSDT' }] }));
  c.send(JSON.stringify({ op: 'subscribe', args: [{ instType: 'usdt-futures', topic: 'ticker', symbol: 'BTCUSDT' }, { instType: 'usdt-futures', topic: 'ticker', symbol: THIN[0] }, { instType: 'usdt-futures', topic: 'books1', symbol: 'BTCUSDT' }] }));
  await sleep(WINDOW_MS);
  for (const ws of [a, c]) try { ws.close(); } catch {}
  await sleep(300);
  const out = {};
  for (const [k, f] of Object.entries(frames)) {
    const iv = f.intervals.sort((x, y) => x - y);
    out[k] = { frames: f.n, keys: f.keys, distinctMark: f.marks.size, distinctIndex: f.indexes.size, distinctRate: f.rates.size, nextFundingTime: [...f.nextFunding], intervalMs: iv.length ? { min: iv[0], med: iv[Math.floor(iv.length / 2)], max: iv[iv.length - 1] } : null, first: f.first };
  }
  log('channels', { windowS: WINDOW_MS / 1000, control, frames: out, connections: [ia, ic] });
}

const table = { book, batch: () => batch(false), batch3: () => batch(true), channels };
log('run', { startedAt: new Date().toISOString(), sections: SECTIONS, thin: THIN, out: OUT, node: process.version });
for (const s of SECTIONS) {
  try { await table[s](); } catch (e) { log(s, { error: String(e.stack ?? e) }); }
}
log('run', { finishedAt: new Date().toISOString() });
process.exit(0);
