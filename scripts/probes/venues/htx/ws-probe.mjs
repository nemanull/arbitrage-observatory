// HTX WebSocket probe: gzip framing, the incremental depth channel and its version rule, level order, size unit, other book channels, errors, keepalive, silence, a batch of perpetuals, deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/htx/ws-probe.mjs [book|batch|silence|deflate|extras]
//   book     size_20 incremental on five USDT-M perps for 75 s with a REST depth compare, size_150, depth.step6, bbo, errors. About 80 s.
//   batch    size_20 incremental on 150 USDT-M perps on one connection for 60 s, subscribed at 40 per second. About 70 s.
//   silence  four sockets that differ in whether they subscribe and whether they answer pings, for up to 120 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   extras   coin-M swap-ws, mark price kline on two URLs, public funding topic on the notification URL, a subscribe burst. About 30 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/htx/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const LINEAR_URL = 'wss://api.hbdm.com/linear-swap-ws';
const INVERSE_URL = 'wss://api.hbdm.com/swap-ws';
const INDEX_URL = 'wss://api.hbdm.com/ws_index';
const NOTIFY_URL = 'wss://api.hbdm.com/linear-swap-notification';
const API = 'https://api.hbdm.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const WATCH = ['BTC-USDT', 'ETH-USDT', 'DOGE-USDT', 'STEEM-USDT', 'XAU-USDT'];

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

const stats = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

// Opens a socket, gunzips every frame, answers the server ping unless told not to, and hands parsed frames to onFrame.
function open(url, { name, answerPings = true, deflate = false, onFrame = () => {}, capFile } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const st = { name, frames: 0, binary: 0, text: 0, zBytes: 0, rawBytes: 0, gunzipUs: [], parseUs: [], pings: [], lastPing: null, openMs: null, closed: null, pongRtt: [] };
  ws.on('upgrade', (res) => {
    st.extensions = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('open', () => {
    st.openMs = Math.round(performance.now() - t0);
    st.openedAt = Date.now();
  });
  ws.on('message', (data, isBinary) => {
    st.frames++;
    let text;
    if (isBinary) {
      st.binary++;
      st.zBytes += data.length;
      const g0 = process.hrtime.bigint();
      text = gunzipSync(data).toString('utf8');
      st.gunzipUs.push(Number(process.hrtime.bigint() - g0) / 1000);
    } else {
      st.text++;
      text = data.toString('utf8');
    }
    st.rawBytes += text.length;
    const p0 = process.hrtime.bigint();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      log('unparsed', { name, text: text.slice(0, 200) });
      return;
    }
    st.parseUs.push(Number(process.hrtime.bigint() - p0) / 1000);
    if (capFile && st.frames <= 400) capture(capFile, text.slice(0, 2000));
    if (msg.ping !== undefined) {
      const now = Date.now();
      if (st.lastPing) st.pings.push(now - st.lastPing);
      st.lastPing = now;
      if (st.firstPingText === undefined) st.firstPingText = text;
      if (answerPings) ws.send(JSON.stringify({ pong: msg.ping }));
      return;
    }
    if (msg.op === 'ping') {
      const now = Date.now();
      if (st.lastPing) st.pings.push(now - st.lastPing);
      st.lastPing = now;
      if (st.firstPingText === undefined) st.firstPingText = text;
      if (answerPings) ws.send(JSON.stringify({ op: 'pong', ts: msg.ts }));
      return;
    }
    if (msg.pong !== undefined && st.clientPingAt) {
      st.pongRtt.push(Date.now() - st.clientPingAt);
      st.pongText = text;
    }
    onFrame(msg, text);
  });
  ws.on('close', (code, reason) => {
    st.closed = { code, reason: reason.toString(), afterMs: st.openedAt ? Date.now() - st.openedAt : null };
  });
  ws.on('error', (e) => {
    st.error = e.message;
  });
  const ready = new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  return { ws, st, ready };
}

const summary = (st) => ({
  name: st.name,
  openMs: st.openMs,
  frames: st.frames,
  binary: st.binary,
  text: st.text,
  zBytes: st.zBytes,
  rawBytes: st.rawBytes,
  ratio: st.zBytes ? +(st.rawBytes / st.zBytes).toFixed(2) : null,
  gunzipUs: stats(st.gunzipUs.map((x) => Math.round(x))),
  parseUs: stats(st.parseUs.map((x) => Math.round(x))),
  pingGapMs: stats(st.pings),
  closed: st.closed,
  error: st.error,
  extensions: st.extensions,
});

// Local book per stream, with version chain and order checks.
function bookTracker() {
  const books = new Map();
  const get = (ch) => {
    if (!books.has(ch)) books.set(ch, { snapshots: 0, deltas: 0, empty: 0, gaps: 0, gapSamples: [], last: null, bids: new Map(), asks: new Map(), maxBids: 0, maxAsks: 0, snapBidDesc: 0, snapAskAsc: 0, deltaBidUnordered: 0, deltaAskUnordered: 0, lastAt: null, maxIdle: 0, firstAt: null, beforeSnap: 0, crossed: 0, idHasMrid: 0, tsLagMs: [] });
    return books.get(ch);
  };
  const ordered = (lv, desc) => lv.every((l, i) => i === 0 || (desc ? l[0] < lv[i - 1][0] : l[0] > lv[i - 1][0]));
  function apply(msg) {
    const t = msg.tick;
    const b = get(msg.ch);
    const now = Date.now();
    if (b.lastAt) b.maxIdle = Math.max(b.maxIdle, now - b.lastAt);
    b.lastAt = now;
    if (!b.firstAt) b.firstAt = now;
    b.tsLagMs.push(now - t.ts);
    const bids = t.bids ?? [];
    const asks = t.asks ?? [];
    if (t.event === 'snapshot') {
      b.snapshots++;
      if (b.snapshots === 1) b.firstSnapshot = { at: now, levels: [bids.length, asks.length] };
      b.bids = new Map(bids.map((l) => [l[0], l[1]]));
      b.asks = new Map(asks.map((l) => [l[0], l[1]]));
      if (ordered(bids, true)) b.snapBidDesc++;
      if (ordered(asks, false)) b.snapAskAsc++;
      b.last = t.version;
      return;
    }
    if (b.last === null) {
      b.beforeSnap++;
      return;
    }
    b.deltas++;
    if (t.version !== b.last + 1) {
      b.gaps++;
      if (b.gapSamples.length < 5) b.gapSamples.push([b.last, t.version]);
    }
    b.last = t.version;
    if (!bids.length && !asks.length) b.empty++;
    if (bids.length > 1 && !ordered(bids, true)) b.deltaBidUnordered++;
    if (asks.length > 1 && !ordered(asks, false)) b.deltaAskUnordered++;
    for (const [p, s] of bids) s === 0 ? b.bids.delete(p) : b.bids.set(p, s);
    for (const [p, s] of asks) s === 0 ? b.asks.delete(p) : b.asks.set(p, s);
    b.maxBids = Math.max(b.maxBids, b.bids.size);
    b.maxAsks = Math.max(b.maxAsks, b.asks.size);
    const bb = Math.max(...b.bids.keys());
    const ba = Math.min(...b.asks.keys());
    if (b.bids.size && b.asks.size && bb >= ba) b.crossed++;
  }
  const top = (ch, n) => {
    const b = books.get(ch);
    if (!b) return null;
    return {
      bids: [...b.bids.entries()].sort((x, y) => y[0] - x[0]).slice(0, n),
      asks: [...b.asks.entries()].sort((x, y) => x[0] - y[0]).slice(0, n),
    };
  };
  return { books, apply, top };
}

async function book() {
  const tr = bookTracker();
  const acks = [];
  const errors = [];
  const other = {};
  const firstOf = {};
  const onFrame = (msg, text) => {
    if (msg.subbed || msg.status) {
      acks.push(text.slice(0, 300));
      return;
    }
    if (msg['err-code'] || msg.status === 'error') {
      errors.push(text.slice(0, 300));
      return;
    }
    if (msg.ch?.endsWith('.high_freq')) {
      if (!firstOf[msg.tick.event]) firstOf[msg.tick.event] = text.slice(0, 900);
      tr.apply(msg);
      return;
    }
    if (msg.ch) {
      const k = msg.ch;
      other[k] = other[k] ?? { n: 0, first: text.slice(0, 700), lastTickTs: null, levels: [] };
      other[k].n++;
      if (Array.isArray(msg.tick?.bids)) other[k].levels.push(`${msg.tick.bids.length}/${msg.tick.asks.length}`);
      other[k].lastTickTs = msg.tick?.ts;
      return;
    }
    errors.push(text.slice(0, 300));
  };
  const a = open(LINEAR_URL, { name: 'linear', onFrame, capFile: 'book_frames.txt' });
  await a.ready;
  const subAt = Date.now();
  let id = 0;
  for (const c of WATCH) a.ws.send(JSON.stringify({ sub: `market.${c}.depth.size_20.high_freq`, data_type: 'incremental', id: `id${++id}` }));
  a.ws.send(JSON.stringify({ sub: 'market.BTC-USDT.depth.size_150.high_freq', data_type: 'incremental', id: `id${++id}` }));
  a.ws.send(JSON.stringify({ sub: 'market.ETH-USDT.depth.step6', id: `id${++id}` }));
  a.ws.send(JSON.stringify({ sub: 'market.BTC-USDT.bbo', id: `id${++id}` }));
  await sleep(1500);
  // Errors and odd requests, each with its own id.
  const odd = [
    { sub: 'market.NOPE-USDT.depth.size_20.high_freq', data_type: 'incremental', id: 'e-unknown' },
    { sub: 'market.BTC-USDT.depth.size_30.high_freq', data_type: 'incremental', id: 'e-size30' },
    { sub: 'market.BTC-USDT.depth.size_5.high_freq', data_type: 'incremental', id: 'e-size5' },
    { sub: 'market.BTC-USDT.depth.size_400.high_freq', data_type: 'incremental', id: 'e-size400' },
    { sub: 'market.BTC-USDT.depth.size_20.high_freq', data_type: 'incremental', id: 'e-dup' },
    { sub: 'market.btc-usdt.depth.size_20.high_freq', data_type: 'incremental', id: 'e-lower' },
    { sub: 'market.BTC-USD.depth.size_20.high_freq', data_type: 'incremental', id: 'e-family' },
    { sub: 'market.BTC-USDT.nope', id: 'e-channel' },
    { sub: 'market.CYBER-USDT.depth.size_20.high_freq', data_type: 'incremental', id: 'e-suspended' },
    { sub: 'market.ETH-USDT.depth.size_20.high_freq', id: 'e-snapshot-type' },
  ];
  for (const f of odd) a.ws.send(JSON.stringify(f));
  a.ws.send('not json');
  await sleep(300);
  a.st.clientPingAt = Date.now();
  a.ws.send(JSON.stringify({ ping: Date.now() }));
  await sleep(20000);
  // REST compare at the touch while the socket runs.
  const cmp = {};
  for (const c of ['BTC-USDT', 'ETH-USDT', 'STEEM-USDT']) {
    const r = await (await fetch(`${API}/linear-swap-ex/market/depth?contract_code=${c}&type=step0`)).json();
    const local = tr.top(`market.${c}.depth.size_20.high_freq`, 10);
    const restB = new Map(r.tick.bids.slice(0, 20).map((l) => [l[0], l[1]]));
    const restA = new Map(r.tick.asks.slice(0, 20).map((l) => [l[0], l[1]]));
    let same = 0;
    let n = 0;
    for (const [p, s] of local.bids) {
      n++;
      if (restB.get(p) === s) same++;
    }
    for (const [p, s] of local.asks) {
      n++;
      if (restA.get(p) === s) same++;
    }
    cmp[c] = { sameSizeAtSamePrice: same, of: n, wsTop: [local.bids[0], local.asks[0]], restTop: [r.tick.bids[0], r.tick.asks[0]] };
  }
  log('restCompare', cmp);
  await sleep(Math.max(0, 75000 - (Date.now() - subAt)));
  a.ws.close();
  await sleep(300);
  log('socket', summary(a.st));
  log('clientPing', { rtt: a.st.pongRtt, pongText: a.st.pongText, serverPing: a.st.firstPingText });
  log('acks', { n: acks.length, acks });
  log('errors', { n: errors.length, errors });
  for (const [ch, b] of tr.books) {
    log('stream', { ch, snapshots: b.snapshots, firstSnapshotMs: b.firstSnapshot ? b.firstSnapshot.at - subAt : null, firstLevels: b.firstSnapshot?.levels, deltas: b.deltas, empty: b.empty, gaps: b.gaps, gapSamples: b.gapSamples, beforeSnap: b.beforeSnap, maxBids: b.maxBids, maxAsks: b.maxAsks, snapBidDesc: b.snapBidDesc, snapAskAsc: b.snapAskAsc, deltaBidUnordered: b.deltaBidUnordered, deltaAskUnordered: b.deltaAskUnordered, crossed: b.crossed, maxIdleMs: b.maxIdle, tsLag: stats(b.tsLagMs) });
  }
  for (const [k, v] of Object.entries(other)) {
    const kinds = {};
    for (const l of v.levels) kinds[l] = (kinds[l] ?? 0) + 1;
    log('otherChannel', { ch: k, n: v.n, levelCounts: kinds, first: v.first.slice(0, 400) });
  }
  log('firstFrames', firstOf);
}

async function batch() {
  const merged = await (await fetch(`${API}/linear-swap-ex/market/detail/batch_merged?business_type=swap`)).json();
  const info = await (await fetch(`${API}/linear-swap-api/v1/swap_contract_info?business_type=swap`)).json();
  const active = new Set(info.data.filter((r) => r.contract_status === 1).map((r) => r.contract_code));
  const ranked = merged.ticks.filter((t) => active.has(t.contract_code)).sort((x, y) => Number(y.trade_turnover) - Number(x.trade_turnover)).map((t) => t.contract_code);
  const pick = ranked.filter((_, i) => i % 2 === 0).slice(0, 150);
  const tr = bookTracker();
  const errors = [];
  let acks = 0;
  const perSec = new Map();
  const a = open(LINEAR_URL, {
    name: 'batch',
    onFrame: (msg, text) => {
      if (msg.subbed) {
        acks++;
        return;
      }
      if (msg.ch?.endsWith('.high_freq')) {
        const s = Math.floor(Date.now() / 1000);
        perSec.set(s, (perSec.get(s) ?? 0) + 1);
        tr.apply(msg);
        return;
      }
      errors.push(text.slice(0, 200));
    },
  });
  await a.ready;
  const t0 = Date.now();
  for (let i = 0; i < pick.length; i++) {
    a.ws.send(JSON.stringify({ sub: `market.${pick[i]}.depth.size_20.high_freq`, data_type: 'incremental', id: `b${i}` }));
    if (i % 40 === 39) await sleep(1100);
  }
  log('subscribed', { n: pick.length, ms: Date.now() - t0 });
  await sleep(60000);
  a.ws.close();
  await sleep(300);
  const all = [...tr.books.values()];
  const rates = [...perSec.values()].slice(2, -1);
  log('batch', {
    streams: tr.books.size,
    acks,
    errors: errors.slice(0, 5),
    errorCount: errors.length,
    snapshots: all.reduce((s, b) => s + b.snapshots, 0),
    deltas: all.reduce((s, b) => s + b.deltas, 0),
    empty: all.reduce((s, b) => s + b.empty, 0),
    gaps: all.reduce((s, b) => s + b.gaps, 0),
    gapStreams: all.filter((b) => b.gaps > 0).length,
    crossed: all.reduce((s, b) => s + b.crossed, 0),
    maxLevels: Math.max(...all.map((b) => Math.max(b.maxBids, b.maxAsks))),
    maxIdleMs: stats(all.map((b) => b.maxIdle)),
    framesPerSecond: stats(rates),
  });
  log('socket', summary(a.st));
}

async function silence() {
  const quiet = 'STEEM-USDT';
  const mk = (name, sub, answerPings) => {
    const s = open(LINEAR_URL, { name, answerPings });
    s.ready.then(() => {
      if (sub) s.ws.send(JSON.stringify({ sub: `market.${quiet}.depth.size_20.high_freq`, data_type: 'incremental', id: name }));
    });
    return s;
  };
  const socks = [mk('nosub-pong', false, true), mk('nosub-nopong', false, false), mk('sub-nopong', true, false), mk('sub-pong', true, true)];
  const start = Date.now();
  while (Date.now() - start < 120000 && socks.some((s) => !s.st.closed)) await sleep(500);
  for (const s of socks) if (!s.st.closed) s.ws.close();
  await sleep(300);
  for (const s of socks) log('silence', { name: s.st.name, frames: s.st.frames, pingGapMs: stats(s.st.pings), closed: s.st.closed, firstPing: s.st.firstPingText });
}

async function deflate() {
  const s = open(LINEAR_URL, { name: 'deflate', deflate: true });
  await s.ready;
  s.ws.send(JSON.stringify({ sub: 'market.BTC-USDT.bbo', id: 'd1' }));
  await sleep(3000);
  s.ws.close();
  await sleep(200);
  log('deflate', { extensions: s.st.extensions, binary: s.st.binary, text: s.st.text, frames: s.st.frames });
}

async function extras() {
  const seen = [];
  const counts = {};
  const closes = {};
  const note = (name) => (msg, text) => {
    const k = `${name} ${msg.ch ?? msg.topic ?? msg.subbed ?? msg.op ?? 'other'}`;
    counts[k] = (counts[k] ?? 0) + 1;
    if (msg.ch?.includes('.mark_price.') || msg.ch?.includes('.index.')) {
      closes[msg.ch] = closes[msg.ch] ?? { distinct: new Set(), frames: 0 };
      closes[msg.ch].frames++;
      closes[msg.ch].distinct.add(msg.tick.close);
    }
    if (msg.topic === 'public.*.funding_rate' && Array.isArray(msg.data)) {
      counts.fundingRows = (counts.fundingRows ?? 0) + msg.data.length;
      for (const r of msg.data) (counts.fundingContracts ??= new Set()).add(r.contract_code);
    }
    if (seen.filter((x) => x.name === name).length < 4) seen.push({ name, text: text.slice(0, 500) });
  };
  const inv = open(INVERSE_URL, { name: 'swap-ws', onFrame: note('swap-ws') });
  const lin = open(LINEAR_URL, { name: 'linear-mark', onFrame: note('linear-mark') });
  const idx = open(INDEX_URL, { name: 'ws_index', onFrame: note('ws_index') });
  const ntf = open(NOTIFY_URL, { name: 'notification', onFrame: note('notification') });
  await Promise.allSettled([inv.ready, lin.ready, idx.ready, ntf.ready]);
  inv.ws.send(JSON.stringify({ sub: 'market.BTC-USD.depth.size_20.high_freq', data_type: 'incremental', id: 'i1' }));
  inv.ws.send(JSON.stringify({ sub: 'market.BTC-USDT.depth.size_20.high_freq', data_type: 'incremental', id: 'i2' }));
  lin.ws.send(JSON.stringify({ sub: 'market.BTC-USDT.mark_price.1min', id: 'm1' }));
  idx.ws.send(JSON.stringify({ sub: 'market.BTC-USDT.mark_price.1min', id: 'm2' }));
  idx.ws.send(JSON.stringify({ sub: 'market.BTC-USDT.index.1min', id: 'm3' }));
  ntf.ws.send(JSON.stringify({ op: 'sub', cid: 'f1', topic: 'public.BTC-USDT.funding_rate' }));
  ntf.ws.send(JSON.stringify({ op: 'sub', cid: 'f2', topic: 'public.*.funding_rate' }));
  await sleep(15000);
  // A burst of 60 subscribe frames on a fresh socket, against the documented 40 per second.
  let burstAcks = 0;
  const burstErr = [];
  const burst = open(LINEAR_URL, {
    name: 'burst',
    onFrame: (msg, text) => {
      if (msg.subbed) burstAcks++;
      else if (msg.status === 'error' || msg['err-code']) burstErr.push(text.slice(0, 200));
    },
  });
  await burst.ready;
  const info = await (await fetch(`${API}/linear-swap-api/v1/swap_contract_info?business_type=swap`)).json();
  const codes = info.data.filter((r) => r.contract_status === 1).map((r) => r.contract_code).slice(0, 60);
  codes.forEach((c, i) => burst.ws.send(JSON.stringify({ sub: `market.${c}.bbo`, id: `x${i}` })));
  await sleep(8000);
  for (const s of [inv, lin, idx, ntf, burst]) s.ws.close();
  await sleep(300);
  log('burst', { sent: codes.length, acks: burstAcks, errors: burstErr.length, sample: burstErr.slice(0, 3), closed: burst.st.closed });
  for (const s of [inv, lin, idx, ntf]) log('socket', summary(s.st));
  for (const x of seen) log('frame', x);
  if (counts.fundingContracts) counts.fundingContracts = counts.fundingContracts.size;
  log('counts', counts);
  log('klineCloses', Object.fromEntries(Object.entries(closes).map(([k, v]) => [k, { frames: v.frames, distinctCloses: v.distinct.size }])));
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate, extras };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
