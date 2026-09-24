// Ourbit futures WebSocket probe: book channels, version chain, REST alignment, level order, size unit, other public channels, errors, a batch of perpetuals, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode that asks for it once.
// Run from server/: node ../scripts/probes/venues/ourbit/ws-probe.mjs [book|channels|errors|batch|silence|deflate]
//   book      sub.depth plain and with compress true on four perps, and sub.depth.full 20 on two, for HOLD_MS (default 72,000), each delta stream aligned to a REST snapshot by version and compared with REST at the end. About 80 s.
//   channels  ticker, tickers, fair.price, index.price, funding.rate and deal on BTC_USDT, fair.price and index.price on HEI_USDT, for 25 s, and the tickers rows against /detail.
//   errors    unknown symbol, unknown method, bad and undocumented limits, a lowercase symbol, text that is not JSON, a duplicate subscription and an unsubscribe. About 20 s.
//   batch     sub.depth on BATCH_N perps (default 150, evenly spaced by 24 h turnover) on one connection for BATCH_SECONDS (default 60). COMPRESS=1 adds compress true.
//   silence   up to four sockets that differ only in what the client sends or subscribes, for SILENCE_MS (default 100,000). SILENCE_PLANS=AB keeps two of them.
//   deflate   asks for permessage-deflate once, subscribes sub.depth with compress true and sub.tickers with gzip true, and counts binary frames.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/ourbit/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://futures.ourbit.com/edge';
const API = 'https://futures.ourbit.com/api/v1/contract';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const trim = (s, n = 300) => (s.length > n ? s.slice(0, n) + '…' : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(label, { deflate = false } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
    ws.on('open', () => {
      log('open', { label, ms: Date.now() - t0, extensions: ws.extensions || '' });
      resolve(ws);
    });
    ws.on('unexpected-response', (_req, res) => reject(new Error(`${label} HTTP ${res.statusCode}`)));
    ws.on('error', (e) => reject(e));
  });
}

const send = (ws, obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
const sub = (method, param) => ({ method, param });

async function restDepth(symbol, limit) {
  const res = await fetch(`${API}/depth/${symbol}${limit ? `?limit=${limit}` : ''}`);
  return (await res.json()).data;
}

function sortedDesc(levels) {
  return levels.every((l, i) => i === 0 || levels[i - 1][0] > l[0]);
}
function sortedAsc(levels) {
  return levels.every((l, i) => i === 0 || levels[i - 1][0] < l[0]);
}

async function book() {
  const symbols = ['BTC_USDT', 'ETH_USDT', 'HEI_USDT', 'AMD_USDT'];
  const fullSymbols = ['BTC_USDT', 'HEI_USDT'];
  const holdMs = Number(process.env.HOLD_MS ?? 72000);
  // Two delta sockets: plain sub.depth, and sub.depth with compress true, which merges deltas into one frame spanning begin to end.
  const streams = [
    { label: 'delta', compress: false },
    { label: 'merged', compress: true },
  ];
  for (const x of streams) {
    x.ws = await open(x.label);
    x.st = {};
    x.books = {};
    for (const s of symbols) x.st[s] = { frames: 0, empty: 0, gaps: 0, dupes: 0, last: null, first: null, bidUnsorted: 0, askUnsorted: 0, maxGapMs: 0, lastAt: null, tsAgeMs: [], intervals: [], buffered: [], aligned: null, zeroSize: 0, levelsPerFrame: [] };
  }
  const b = await open('full');
  const fst = {};
  for (const s of fullSymbols) fst[s] = { frames: 0, identicalRepeats: 0, prev: null, levels: [], versions: [], versionSteps: [], intervalsMs: [], lastAt: null, first: null };
  const subAt = Date.now();
  const pings = [];
  const pingSent = { delta: [], merged: [], full: [] };
  const onDelta = (x) => (raw) => {
    const at = Date.now();
    const text = raw.toString();
    const m = JSON.parse(text);
    capture(`book-${x.label}.jsonl`, trim(text, 2000));
    if (m.channel === 'pong') {
      pings.push({ label: x.label, rttMs: at - (pingSent[x.label].shift() ?? at), serverToArrivalMs: at - m.data });
      return;
    }
    if (m.channel !== 'push.depth') {
      log('control', { label: x.label, frame: trim(text, 300) });
      return;
    }
    const s = x.st[m.symbol];
    if (!s) return;
    const d = m.data;
    const v0 = d.version ?? d.begin;
    const v1 = d.version ?? d.end;
    s.frames++;
    if (!s.first) s.first = { afterSubMs: at - subAt, keys: Object.keys(d), sample: trim(text, 400) };
    if (s.lastAt) {
      s.maxGapMs = Math.max(s.maxGapMs, at - s.lastAt);
      s.intervals.push(at - s.lastAt);
    }
    s.lastAt = at;
    s.tsAgeMs.push(at - m.ts);
    if (d.bids.length === 0 && d.asks.length === 0) s.empty++;
    if (!sortedDesc(d.bids)) s.bidUnsorted++;
    if (!sortedAsc(d.asks)) s.askUnsorted++;
    s.levelsPerFrame.push(d.bids.length + d.asks.length);
    for (const l of [...d.bids, ...d.asks]) if (l[1] === 0) s.zeroSize++;
    if (s.last !== null) {
      if (v0 === s.last) s.dupes++;
      else if (v0 !== s.last + 1) s.gaps++;
    }
    s.last = v1;
    const delta = { v0, v1, bids: d.bids, asks: d.asks };
    if (!x.books[m.symbol]) s.buffered.push(delta);
    else applyDelta(x.books[m.symbol], delta, s);
  };
  for (const x of streams) {
    x.ws.on('message', onDelta(x));
    for (const s of symbols) send(x.ws, sub('sub.depth', x.compress ? { symbol: s, compress: true } : { symbol: s }));
  }
  b.on('message', (raw) => {
    const at = Date.now();
    const text = raw.toString();
    const m = JSON.parse(text);
    capture('book-full.jsonl', trim(text, 2000));
    if (m.channel === 'pong') {
      pings.push({ label: 'full', rttMs: at - (pingSent.full.shift() ?? at), serverToArrivalMs: at - m.data });
      return;
    }
    if (m.channel !== 'push.depth.full') {
      log('control', { label: 'full', frame: trim(text, 300) });
      return;
    }
    const f = fst[m.symbol];
    if (!f) return;
    f.frames++;
    if (!f.first) f.first = { afterSubMs: at - subAt, sample: trim(text, 400) };
    const key = JSON.stringify([m.data.bids, m.data.asks]);
    if (f.prev === key) f.identicalRepeats++;
    f.prev = key;
    f.levels.push(`${m.data.bids.length}/${m.data.asks.length}`);
    if (f.versions.length) f.versionSteps.push(m.data.version - f.versions.at(-1));
    f.versions.push(m.data.version);
    if (f.lastAt) f.intervalsMs.push(at - f.lastAt);
    f.lastAt = at;
  });
  for (const s of fullSymbols) send(b, sub('sub.depth.full', { symbol: s, limit: 20 }));
  const ping = setInterval(() => {
    for (const x of streams) {
      pingSent[x.label].push(Date.now());
      send(x.ws, { method: 'ping' });
    }
    pingSent.full.push(Date.now());
    send(b, { method: 'ping' });
  }, 15000);
  // No delta stream sends a snapshot, so the REST book is the base, aligned by version like the old contract doc says.
  await sleep(3000);
  for (const s of symbols) {
    const snap = await restDepth(s);
    for (const x of streams) {
      const st = x.st[s];
      const bk = { bids: new Map(snap.bids.map((l) => [l[0], l[1]])), asks: new Map(snap.asks.map((l) => [l[0], l[1]])), version: snap.version };
      const pending = st.buffered.filter((d) => d.v1 > snap.version);
      st.aligned = { restVersion: snap.version, buffered: st.buffered.length, bufferedFirst: st.buffered[0]?.v0, firstUsable: pending[0] ? [pending[0].v0, pending[0].v1] : null, covers: pending.length === 0 || (pending[0].v0 <= snap.version + 1 && pending[0].v1 >= snap.version + 1) };
      for (const d of pending) applyDelta(bk, d, st, true);
      x.books[s] = bk;
    }
  }
  await sleep(holdMs);
  clearInterval(ping);
  // Compare each maintained top 20 against a fresh REST book at the nearest version.
  for (const s of symbols) {
    const snap = await restDepth(s, 20);
    const rb = new Map(snap.bids.map((l) => [l[0], l[1]]));
    const ra = new Map(snap.asks.map((l) => [l[0], l[1]]));
    for (const x of streams) {
      const bk = x.books[s];
      const st = x.st[s];
      const topB = [...bk.bids.keys()].sort((p, q) => q - p).slice(0, 20);
      const topA = [...bk.asks.keys()].sort((p, q) => p - q).slice(0, 20);
      const same = topB.filter((p) => rb.get(p) === bk.bids.get(p)).length + topA.filter((p) => ra.get(p) === bk.asks.get(p)).length;
      const iv = [...st.intervals].sort((p, q) => p - q);
      log('bookSummary', {
        stream: x.label,
        symbol: s,
        frames: st.frames,
        empty: st.empty,
        gaps: st.gaps,
        dupes: st.dupes,
        applyGaps: st.applyGaps ?? 0,
        zeroSizeLevels: st.zeroSize,
        bidUnsorted: st.bidUnsorted,
        askUnsorted: st.askUnsorted,
        maxLevelsPerFrame: Math.max(0, ...st.levelsPerFrame),
        intervalMs: { median: iv[Math.floor(iv.length / 2)], p90: iv[Math.floor(iv.length * 0.9)], max: iv.at(-1) },
        tsAgeMedianMs: [...st.tsAgeMs].sort((p, q) => p - q)[Math.floor(st.tsAgeMs.length / 2)],
        first: st.first,
        aligned: st.aligned,
        localLevels: `${bk.bids.size}/${bk.asks.size}`,
        restVersion: snap.version,
        localVersion: bk.version,
        top40Equal: same,
        crossed: topB[0] >= topA[0],
        touch: [[topB[0], bk.bids.get(topB[0])], [topA[0], bk.asks.get(topA[0])]],
        restTouch: [snap.bids[0], snap.asks[0]],
      });
    }
  }
  for (const s of fullSymbols) {
    const f = fst[s];
    const iv = f.intervalsMs.sort((p, q) => p - q);
    const steps = f.versionSteps;
    log('fullSummary', { symbol: s, frames: f.frames, identicalRepeats: f.identicalRepeats, levels: [...new Set(f.levels)].slice(0, 5), intervalMs: { min: iv[0], median: iv[Math.floor(iv.length / 2)], max: iv.at(-1) }, versionStep: { min: Math.min(...steps), max: Math.max(...steps), zero: steps.filter((v) => v === 0).length }, first: f.first });
  }
  log('pong', { pings });
  for (const x of streams) x.ws.close();
  b.close();
}

// Sizes are absolute, so a merged frame that overlaps the snapshot is applied whole.
function applyDelta(book, d, st, aligning = false) {
  if (!aligning && d.v0 !== book.version + 1) st.applyGaps = (st.applyGaps ?? 0) + 1;
  for (const [p, q] of d.bids) q === 0 ? book.bids.delete(p) : book.bids.set(p, q);
  for (const [p, q] of d.asks) q === 0 ? book.asks.delete(p) : book.asks.set(p, q);
  book.version = d.v1;
}

async function channels() {
  const detail = new Set((await (await fetch(`${API}/detail`)).json()).data.map((x) => x.symbol));
  const ws = await open('channels');
  const counts = {};
  const tickerRows = [];
  const samples = {};
  const subAt = Date.now();
  ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    const key = m.symbol ? `${m.channel} ${m.symbol}` : m.channel;
    counts[key] = (counts[key] ?? 0) + 1;
    if (m.channel === 'push.tickers') tickerRows.push(m.data.length);
    if (!samples[m.channel]) {
      samples[m.channel] = m.channel === 'push.tickers' ? { rows: m.data.length, keys: Object.keys(m.data[0] ?? {}), btc: m.data.find((x) => x.symbol === 'BTC_USDT'), afterSubMs: Date.now() - subAt } : trim(text, 500);
    }
    if (m.channel === 'push.tickers') samples.lastTickers = m.data.map((x) => x.symbol);
    capture('channels.jsonl', trim(text, 1500));
  });
  send(ws, sub('sub.ticker', { symbol: 'BTC_USDT' }));
  send(ws, sub('sub.tickers', {}));
  send(ws, sub('sub.fair.price', { symbol: 'BTC_USDT' }));
  send(ws, sub('sub.index.price', { symbol: 'BTC_USDT' }));
  send(ws, sub('sub.funding.rate', { symbol: 'BTC_USDT' }));
  send(ws, sub('sub.deal', { symbol: 'BTC_USDT' }));
  send(ws, sub('sub.fair.price', { symbol: 'HEI_USDT' }));
  send(ws, sub('sub.index.price', { symbol: 'HEI_USDT' }));
  await sleep(25000);
  log('channelCounts', { seconds: 25, counts, tickerRowsPerPush: [...new Set(tickerRows)] });
  const last = samples.lastTickers ?? [];
  log('tickersVsCatalog', { rows: last.length, notInDetail: last.filter((x) => !detail.has(x)).length, sampleNotInDetail: last.filter((x) => !detail.has(x)).slice(0, 12), detailNotInTickers: [...detail].filter((x) => !last.includes(x)).length });
  delete samples.lastTickers;
  for (const [k, v] of Object.entries(samples)) log('sample', { channel: k, v });
  ws.close();
}

async function errors() {
  const ws = await open('errors');
  const pushes = {};
  let step = 'none';
  ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    if (typeof m.channel === 'string' && m.channel.startsWith('push.')) {
      const key = `${m.channel} ${m.symbol}`;
      pushes[key] ??= { frames: 0, maxLevels: 0, firstAfterStep: step };
      pushes[key].frames++;
      pushes[key].maxLevels = Math.max(pushes[key].maxLevels, (m.data.bids?.length ?? 0), (m.data.asks?.length ?? 0));
      return;
    }
    log('reply', { step, frame: trim(text, 300) });
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  const steps = [
    ['unknown symbol', sub('sub.depth', { symbol: 'NOPE_USDT' })],
    ['unknown symbol full', sub('sub.depth.full', { symbol: 'NOPE_USDT', limit: 20 })],
    ['full limit 30', sub('sub.depth.full', { symbol: 'ETH_USDT', limit: 30 })],
    ['full limit 50', sub('sub.depth.full', { symbol: 'SOL_USDT', limit: 50 })],
    ['unknown method', sub('sub.nope', { symbol: 'BTC_USDT' })],
    ['no param', { method: 'sub.depth' }],
    ['lowercase symbol', sub('sub.depth', { symbol: 'btc_usdt' })],
    ['subscribe', sub('sub.depth', { symbol: 'BTC_USDT' })],
    ['duplicate', sub('sub.depth', { symbol: 'BTC_USDT' })],
    ['unsubscribe', sub('unsub.depth', { symbol: 'BTC_USDT' })],
    ['not json', 'hello'],
    ['ping', { method: 'ping' }],
  ];
  for (const [what, frame] of steps) {
    step = what;
    log('send', { what, frame });
    const before = JSON.stringify(pushes);
    send(ws, frame);
    await sleep(1500);
    if (what === 'unsubscribe' || what === 'duplicate') log('pushesAfter', { what, before: JSON.parse(before)['push.depth BTC_USDT'], now: pushes['push.depth BTC_USDT'] });
  }
  await sleep(2000);
  log('pushes', pushes);
  ws.close();
}

async function batch() {
  const n = Number(process.env.BATCH_N ?? 150);
  const seconds = Number(process.env.BATCH_SECONDS ?? 60);
  const compress = process.env.COMPRESS === '1';
  const tickers = (await (await fetch(`${API}/ticker`)).json()).data.sort((p, q) => q.amount24 - p.amount24);
  const step = Math.max(1, Math.floor(tickers.length / n));
  const symbols = tickers.filter((_, i) => i % step === 0).slice(0, n).map((x) => x.symbol);
  const ws = await open('batch');
  const last = new Map();
  let frames = 0;
  let bytes = 0;
  let gaps = 0;
  let acks = 0;
  let errs = 0;
  let parseNs = 0n;
  const perSec = [];
  let secFrames = 0;
  const seen = new Set();
  let firstAll = null;
  const t0 = Date.now();
  ws.on('message', (raw) => {
    const t = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t;
    if (m.channel === 'rs.sub.depth') acks++;
    else if (m.channel === 'rs.error') errs++;
    if (m.channel !== 'push.depth') return;
    frames++;
    secFrames++;
    bytes += raw.length;
    seen.add(m.symbol);
    if (!firstAll && seen.size === symbols.length) firstAll = Date.now() - t0;
    const lv = last.get(m.symbol);
    if (lv !== undefined && (m.data.version ?? m.data.begin) !== lv + 1) gaps++;
    last.set(m.symbol, m.data.version ?? m.data.end);
  });
  ws.on('close', (code) => log('close', { code, afterMs: Date.now() - t0, framesBeforeClose: frames, lastSeconds: perSec.slice(-5) }));
  for (const s of symbols) send(ws, sub('sub.depth', compress ? { symbol: s, compress: true } : { symbol: s }));
  const tick = setInterval(() => {
    perSec.push(secFrames);
    secFrames = 0;
  }, 1000);
  const ping = setInterval(() => send(ws, { method: 'ping' }), 15000);
  await sleep(seconds * 1000);
  clearInterval(tick);
  clearInterval(ping);
  const sorted = [...perSec].sort((p, q) => p - q);
  log('batchSummary', { compress, seconds, subscribed: symbols.length, acks, errors: errs, symbolsSeen: seen.size, allSeenAfterMs: firstAll, frames, gaps, framesPerSec: { median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1), first15s: perSec.slice(0, 15) }, kbPerSec: Math.round(bytes / seconds / 1024), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Number(parseNs / BigInt(Math.max(frames, 1))) / 1000 });
  ws.close();
}

async function silence() {
  const t0 = Date.now();
  const only = process.env.SILENCE_PLANS ?? 'ABCD';
  const plans = [
    ['A no sub, no ping', false, 0],
    ['B sub quiet, no ping', true, 0],
    ['C sub quiet, ping 20 s', true, 20000],
    ['D no sub, ping 20 s', false, 20000],
  ].filter(([label]) => only.includes(label[0]));
  const sockets = [];
  for (const [label, subscribe, pingMs] of plans) {
    const ws = await open(label);
    const st = { frames: 0, serverPings: 0 };
    ws.on('message', () => st.frames++);
    ws.on('ping', () => st.serverPings++);
    ws.on('close', (code, reason) => log('close', { label, afterMs: Date.now() - t0, code, reason: reason.toString(), frames: st.frames, serverPings: st.serverPings }));
    if (subscribe) send(ws, sub('sub.depth', { symbol: 'HEI_USDT' }));
    const timer = pingMs ? setInterval(() => ws.readyState === ws.OPEN && send(ws, { method: 'ping' }), pingMs) : null;
    sockets.push({ ws, st, timer, label });
  }
  await sleep(Number(process.env.SILENCE_MS ?? 100000));
  for (const s of sockets) {
    if (s.timer) clearInterval(s.timer);
    if (s.ws.readyState === s.ws.OPEN) {
      log('stillOpen', { label: s.label, afterMs: Date.now() - t0, frames: s.st.frames, serverPings: s.st.serverPings });
      s.ws.close();
    }
  }
  await sleep(500);
}

async function deflate() {
  const ws = await open('deflate', { deflate: true });
  let n = 0;
  let binary = 0;
  ws.on('message', (raw, isBinary) => {
    n++;
    if (isBinary) binary++;
    if (n > 4) return;
    let decoded = '';
    if (isBinary) {
      try {
        decoded = gunzipSync(raw).toString();
      } catch {
        try {
          decoded = inflateSync(raw).toString();
        } catch {
          decoded = 'not gzip or zlib';
        }
      }
    }
    log('frame', { isBinary, bytes: raw.length, text: isBinary ? trim(decoded, 200) : trim(raw.toString(), 200) });
  });
  send(ws, sub('sub.depth', { symbol: 'BTC_USDT', compress: true }));
  await sleep(3000);
  send(ws, sub('sub.tickers', { gzip: true }));
  send(ws, { method: 'sub.tickers', param: {}, gzip: true });
  await sleep(3000);
  log('frames', { n, binary });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, channels, errors, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
