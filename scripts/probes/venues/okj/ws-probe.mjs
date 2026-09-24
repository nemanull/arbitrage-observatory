// OKJ (OKCoin Japan) public WebSocket probe: book channels, sequence chain, checksum, level order and window, size unit against REST, keepalive, silence, errors, and every spot pair on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/okj/ws-probe.mjs [book|batch|silence|errors|deflate|v3] [seconds]
//   book     books on four pairs, plus books5, bbo-tbt and tickers on BTC-JPY, for 60 s, with a REST book compare at the end.
//   batch    books on every live spot pair on one connection for 45 s.
//   silence  four sockets: no subscription, a quiet book without ping, a quiet book with a text ping every 20 s, a text ping every 20 s and no subscription, for up to 75 s.
//            QUIET_PAIR picks the quiet book (default QTUM-JPY), CASES=name,name runs only those sockets.
//   errors   unknown pair, VIP-only channels, unknown channel, bad JSON, text ping, a duplicate subscription. About 8 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   v3       the legacy V3 socket for 6 s: whether its frames are binary and deflated inside the frame.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/okj/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUBLIC = 'wss://ws.okj.com:443/ws/v5/public';
const API = 'https://api.okj.com/api/v5';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();
const since = () => Date.now() - t0;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(url = URL_PUBLIC, opts = { perMessageDeflate: false }) {
  const opened = Date.now();
  const ws = new WebSocket(url, opts);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Date.now() - opened }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)));
  });
}

const sub = (args) => JSON.stringify({ op: 'subscribe', args });

// Checksum over the first 25 levels per side, alternating bid and ask, as the documentation describes.
function checksum(bids, asks) {
  const parts = [];
  for (let i = 0; i < 25; i++) {
    if (i < bids.length) parts.push(`${bids[i][0]}:${bids[i][1]}`);
    if (i < asks.length) parts.push(`${asks[i][0]}:${asks[i][1]}`);
  }
  return crc32(parts.join(':')) | 0;
}

// Local book kept with the price strings so the checksum string matches the wire.
class Book {
  constructor() {
    this.bids = new Map();
    this.asks = new Map();
  }
  reset(bids, asks) {
    this.bids.clear();
    this.asks.clear();
    this.apply(bids, asks);
  }
  apply(bids, asks) {
    for (const [p, s] of bids) (Number(s) === 0 ? this.bids.delete(p) : this.bids.set(p, s));
    for (const [p, s] of asks) (Number(s) === 0 ? this.asks.delete(p) : this.asks.set(p, s));
  }
  sorted() {
    const b = [...this.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0]));
    const a = [...this.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0]));
    return { b, a };
  }
}

const ordered = (side, desc) => side.every((l, i) => i === 0 || (desc ? Number(side[i - 1][0]) > Number(l[0]) : Number(side[i - 1][0]) < Number(l[0])));

async function restBook(instId) {
  const r = await fetch(`${API}/market/books?instId=${instId}&sz=400`);
  return (await r.json()).data[0];
}

function trackBooks(ws, label, stats) {
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    stats.frames++;
    stats.bytes += text.length;
    if (text === 'pong') {
      stats.pongs++;
      return;
    }
    const tp = performance.now();
    const m = JSON.parse(text);
    stats.parseUs += (performance.now() - tp) * 1000;
    if (m.event) {
      if (m.event === 'subscribe') (stats.acked ??= new Set()).add(`${m.arg?.channel}|${m.arg?.instId}`);
      stats.events.push(m.event === 'error' ? `${m.event}:${m.code}:${m.msg}` : `${m.event}:${m.arg?.channel}:${m.arg?.instId ?? ''}`);
      if (stats.events.length <= 3) capture(`${label}-events.txt`, text);
      return;
    }
    const ch = m.arg?.channel;
    const id = m.arg?.instId;
    const key = `${ch}|${id}`;
    const s = (stats.per[key] ??= { frames: 0, snapshots: 0, updates: 0, gaps: 0, emptyKeepalive: 0, resets: 0, csOk: 0, csBad: 0, snapOrderOk: 0, deltaBidUnordered: 0, deltaAskUnordered: 0, maxBids: 0, maxAsks: 0, lastAt: 0, maxIdleMs: 0, firstAt: 0, book: new Book(), last: undefined, csFirstBad: undefined });
    const now = since();
    if (s.lastAt) s.maxIdleMs = Math.max(s.maxIdleMs, now - s.lastAt);
    else {
      s.firstAt = now;
      s.ackedBeforeData = stats.acked?.has(key) ?? false;
    }
    s.lastAt = now;
    s.frames++;
    const d = m.data?.[0];
    if (s.frames <= 3 && d) capture(`${label}-${ch}-${id}.txt`, `${now} ${JSON.stringify({ ...m, data: [{ ...d, asks: d.asks?.slice(0, 3), bids: d.bids?.slice(0, 3) }] })}`);
    if (!d) return;
    if (ch !== 'books') {
      s.lastData = d;
      return;
    }
    if (m.action === 'snapshot') {
      s.snapshots++;
      if (ordered(d.bids, true) && ordered(d.asks, false)) s.snapOrderOk++;
      s.snapLevels = [d.bids.length, d.asks.length];
      s.snapPrev = d.prevSeqId;
      s.book.reset(d.bids, d.asks);
      s.last = d.seqId;
    } else {
      s.updates++;
      if (s.last === undefined) s.gaps++;
      else if (d.prevSeqId !== s.last) s.gaps++;
      if (d.seqId < d.prevSeqId) s.resets++;
      if (d.bids.length === 0 && d.asks.length === 0) {
        s.emptyKeepalive++;
        if (d.prevSeqId === d.seqId) s.idleRepeat = (s.idleRepeat ?? 0) + 1;
      }
      if (!ordered(d.bids, true)) s.deltaBidUnordered++;
      if (!ordered(d.asks, false)) s.deltaAskUnordered++;
      s.book.apply(d.bids, d.asks);
      s.last = d.seqId;
    }
    const { b, a } = s.book.sorted();
    s.maxBids = Math.max(s.maxBids, b.length);
    s.maxAsks = Math.max(s.maxAsks, a.length);
    if (checksum(b, a) === d.checksum) s.csOk++;
    else {
      s.csBad++;
      s.csFirstBad ??= { seqId: d.seqId, action: m.action };
    }
    s.lastTs = Number(d.ts);
  });
}

function summarize(stats) {
  for (const [key, s] of Object.entries(stats.per)) {
    const { book, lastData, ...rest } = s;
    const { b, a } = book.sorted();
    log('stream', { key, ...rest, heldBids: b.length, heldAsks: a.length, top: b.length ? [b[0], a[0]] : lastData ? [lastData.bids?.[0], lastData.asks?.[0]] : undefined });
  }
}

async function bookMode(seconds) {
  const pairs = ['BTC-JPY', 'ETH-JPY', 'XRP-JPY', 'IOST-JPY'];
  const { ws, openMs } = await open();
  log('open', { url: URL_PUBLIC, openMs });
  const stats = { frames: 0, bytes: 0, pongs: 0, parseUs: 0, events: [], per: {} };
  trackBooks(ws, 'book', stats);
  let closed;
  ws.on('close', (code) => (closed = { code, at: since() }));
  const sentAt = since();
  ws.send(sub([...pairs.map((instId) => ({ channel: 'books', instId })), { channel: 'books5', instId: 'BTC-JPY' }, { channel: 'bbo-tbt', instId: 'BTC-JPY' }, { channel: 'tickers', instId: 'BTC-JPY' }]));
  const ping = setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 20_000);
  await sleep(seconds * 1000);
  clearInterval(ping);
  // Size unit and REST compare: sizes at the same price in the socket book and the REST book.
  for (const id of ['BTC-JPY', 'XRP-JPY']) {
    const rb = await restBook(id);
    const s = stats.per[`books|${id}`];
    const { b, a } = s.book.sorted();
    const wsMap = new Map([...b.slice(0, 20), ...a.slice(0, 20)]);
    const rest = [...rb.bids.slice(0, 20), ...rb.asks.slice(0, 20)];
    const same = rest.filter(([p, sz]) => wsMap.get(p) === sz).length;
    log('restCompare', { instId: id, compared: rest.length, equalSize: same, wsTop: [b[0], a[0]], restTop: [rb.bids[0].slice(0, 2), rb.asks[0].slice(0, 2)] });
  }
  ws.close();
  log('bookSummary', { seconds, frames: stats.frames, bytes: stats.bytes, pongs: stats.pongs, parseUsPerFrame: +(stats.parseUs / Math.max(1, stats.frames)).toFixed(1), events: stats.events, subscribeSentAtMs: sentAt, closed });
  summarize(stats);
}

async function batchMode(seconds) {
  const r = await fetch(`${API}/public/instruments?instType=SPOT`);
  const ids = (await r.json()).data.filter((x) => x.state === 'live').map((x) => x.instId);
  const { ws, openMs } = await open();
  log('open', { url: URL_PUBLIC, openMs, pairs: ids.length });
  const stats = { frames: 0, bytes: 0, pongs: 0, parseUs: 0, events: [], per: {} };
  trackBooks(ws, 'batch', stats);
  let closed;
  ws.on('close', (code) => (closed = { code, at: since() }));
  const frame = sub(ids.map((instId) => ({ channel: 'books', instId })));
  const sentAt = since();
  ws.send(frame);
  const ping = setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 20_000);
  const perSecond = [];
  let prev = 0;
  const tick = setInterval(() => {
    perSecond.push(stats.frames - prev);
    prev = stats.frames;
  }, 1000);
  await sleep(seconds * 1000);
  clearInterval(ping);
  clearInterval(tick);
  ws.close();
  const per = Object.values(stats.per);
  const snapAt = per.map((s) => s.firstAt - sentAt).sort((a, b) => a - b);
  const sorted = [...perSecond].sort((a, b) => a - b);
  log('batchSummary', {
    seconds,
    subscribeFrameBytes: frame.length,
    acks: stats.events.filter((e) => e.startsWith('subscribe')).length,
    errors: stats.events.filter((e) => e.startsWith('error')),
    streams: per.length,
    snapshots: per.reduce((n, s) => n + s.snapshots, 0),
    lastSnapshotAfterMs: snapAt.at(-1),
    frames: stats.frames,
    framesPerSecondMedian: sorted[Math.floor(sorted.length / 2)],
    framesPerSecondMax: sorted.at(-1),
    bytesPerSecond: Math.round(stats.bytes / seconds),
    bytesPerFrame: Math.round(stats.bytes / Math.max(1, stats.frames)),
    parseUsPerFrame: +(stats.parseUs / Math.max(1, stats.frames)).toFixed(1),
    updates: per.reduce((n, s) => n + s.updates, 0),
    gaps: per.reduce((n, s) => n + s.gaps, 0),
    resets: per.reduce((n, s) => n + s.resets, 0),
    checksumOk: per.reduce((n, s) => n + s.csOk, 0),
    checksumBad: per.reduce((n, s) => n + s.csBad, 0),
    emptyKeepalive: per.reduce((n, s) => n + s.emptyKeepalive, 0),
    maxIdleMs: Math.max(...per.map((s) => s.maxIdleMs)),
    streamsSilentAfterSnapshot: Object.entries(stats.per).filter(([, s]) => s.updates === 0).map(([k]) => k.split('|')[1]).join(','),
    snapshotsOrdered: per.reduce((n, s) => n + s.snapOrderOk, 0),
    ackedBeforeData: per.filter((s) => s.ackedBeforeData).length,
    minSnapshotLevels: per.reduce((m, s) => [Math.min(m[0], s.snapLevels?.[0] ?? Infinity), Math.min(m[1], s.snapLevels?.[1] ?? Infinity)], [Infinity, Infinity]),
    maxHeldBids: Math.max(...per.map((s) => s.maxBids)),
    maxHeldAsks: Math.max(...per.map((s) => s.maxAsks)),
    deltaUnordered: per.reduce((n, s) => n + s.deltaBidUnordered + s.deltaAskUnordered, 0),
    closed,
  });
  for (const [key, s] of Object.entries(stats.per).sort((x, y) => y[1].maxIdleMs - x[1].maxIdleMs).slice(0, 5)) {
    log('quietest', { key, updates: s.updates, emptyKeepalive: s.emptyKeepalive, idleRepeat: s.idleRepeat ?? 0, maxIdleMs: s.maxIdleMs, held: [s.maxBids, s.maxAsks] });
  }
}

async function silenceMode(seconds) {
  const quiet = process.env.QUIET_PAIR ?? 'QTUM-JPY';
  const cases = [
    { name: 'no-subscription', subscribe: false, ping: false },
    { name: 'quiet-book-no-ping', subscribe: true, ping: false },
    { name: 'quiet-book-ping-20s', subscribe: true, ping: true },
    { name: 'ping-only-20s', subscribe: false, ping: true },
  ].filter((c) => !process.env.CASES || process.env.CASES.split(',').includes(c.name));
  await Promise.all(
    cases.map(async (c) => {
      const { ws, openMs } = await open();
      const r = { name: c.name, openMs, frames: 0, pongs: 0, protocolPings: 0, closed: undefined, lastFrameAt: 0, emptyKeepalive: 0, maxGapMs: 0 };
      const start = Date.now();
      let last = start;
      ws.on('ping', () => r.protocolPings++);
      ws.on('message', (raw) => {
        const t = raw.toString('utf8');
        const now = Date.now();
        r.maxGapMs = Math.max(r.maxGapMs, now - last);
        last = now;
        r.frames++;
        r.lastFrameAt = now - start;
        if (t === 'pong') r.pongs++;
        else if (t.includes('"bids":[]') && t.includes('"asks":[]')) {
          r.emptyKeepalive++;
          capture(`silence-${c.name}.txt`, `${now - start} ${t}`);
        }
      });
      const done = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString(), atMs: Date.now() - start })));
      if (c.subscribe) ws.send(sub([{ channel: 'books', instId: quiet }]));
      const ping = c.ping ? setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 20_000) : undefined;
      r.closed = await Promise.race([done, sleep(seconds * 1000).then(() => undefined)]);
      if (ping) clearInterval(ping);
      if (!r.closed) ws.terminate();
      log('silence', { quiet, ...r });
    }),
  );
}

async function errorsMode() {
  const { ws, openMs } = await open();
  const frames = [];
  ws.on('message', (raw) => {
    const t = raw.toString('utf8');
    frames.push(`${since()} ${t.slice(0, 300)}`);
  });
  let closed;
  ws.on('close', (code, reason) => (closed = { code, reason: reason.toString(), at: since() }));
  const steps = [
    ['ping text', 'ping'],
    ['unknown pair', sub([{ channel: 'books', instId: 'NOPE-JPY' }])],
    ['usdt pair', sub([{ channel: 'books', instId: 'BTC-USDT' }])],
    ['vip books50-l2-tbt', sub([{ channel: 'books50-l2-tbt', instId: 'BTC-JPY' }])],
    ['vip books-l2-tbt', sub([{ channel: 'books-l2-tbt', instId: 'BTC-JPY' }])],
    ['unknown channel', sub([{ channel: 'nope', instId: 'BTC-JPY' }])],
    ['mark-price channel', sub([{ channel: 'mark-price', instId: 'BTC-JPY' }])],
    ['index-tickers channel', sub([{ channel: 'index-tickers', instId: 'BTC-JPY' }])],
    ['funding-rate channel', sub([{ channel: 'funding-rate', instId: 'BTC-JPY' }])],
    ['books first', sub([{ channel: 'books', instId: 'LTC-JPY' }])],
    ['books duplicate', sub([{ channel: 'books', instId: 'LTC-JPY' }])],
    ['bad json', '{"op":"subscribe",'],
    ['after bad json', sub([{ channel: 'tickers', instId: 'ETH-JPY' }])],
  ];
  log('open', { openMs });
  for (const [name, text] of steps) {
    frames.push(`${since()} >> ${name}`);
    if (ws.readyState !== ws.OPEN) break;
    ws.send(text);
    await sleep(600);
  }
  ws.close();
  await sleep(300);
  for (const f of frames) {
    // Book payloads are long, so keep only their head.
    console.log(f.length > 260 ? f.slice(0, 260) + '…' : f);
  }
  log('errorsDone', { closed });
}

async function deflateMode() {
  const { ws, openMs } = await open(URL_PUBLIC, { perMessageDeflate: true });
  log('deflate', { openMs, negotiated: ws.extensions || '(none)' });
  ws.close();
  const plain = await open();
  log('noDeflate', { openMs: plain.openMs, negotiated: plain.ws.extensions || '(none)' });
  plain.ws.close();
}

async function v3Mode() {
  const url = 'wss://connect.okj.com:443/ws/v3';
  const { ws, openMs } = await open(url);
  let n = 0;
  ws.on('message', (raw, isBinary) => {
    if (++n > 4) return;
    let text;
    try {
      text = inflateRawSync(raw).toString('utf8');
    } catch {
      text = `(not raw deflate) ${raw.toString('utf8')}`;
    }
    log('v3frame', { isBinary, wireBytes: raw.length, inflated: text.length > 300 ? text.slice(0, 300) + '…' : text });
  });
  ws.send(JSON.stringify({ op: 'subscribe', args: ['spot/depth:BTC-JPY'] }));
  await sleep(6000);
  ws.close();
  log('v3', { url, openMs, negotiated: ws.extensions || '(none)', frames: n });
}

const mode = process.argv[2] ?? 'book';
const seconds = Number(process.argv[3] ?? { book: 60, batch: 45, silence: 75 }[mode] ?? 10);
log('start', { mode, seconds, at: new Date().toISOString() });
if (mode === 'book') await bookMode(seconds);
else if (mode === 'batch') await batchMode(seconds);
else if (mode === 'silence') await silenceMode(seconds);
else if (mode === 'errors') await errorsMode();
else if (mode === 'deflate') await deflateMode();
else if (mode === 'v3') await v3Mode();
log('end', { at: new Date().toISOString() });
process.exit(0);
