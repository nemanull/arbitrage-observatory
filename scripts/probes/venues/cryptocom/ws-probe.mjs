// Crypto.com Exchange market data WebSocket probe: book channel semantics, subscription modes, errors, a batch of every perpetual, the anchor channels, heartbeat and silence, deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Every socket waits 1 s after open before sending, as the documentation asks, and sends at most 4 frames per second against a published 100.
// Run from server/: node ../scripts/probes/venues/cryptocom/ws-probe.mjs [book|batch|silence|anchor|deflate]
//   book     book.X.50 deltas on five perpetuals, one spot pair and one dated future for 60 s with a REST book compare, eight subscription modes for 20 s, and error replies. About 62 s.
//   batch    book.X.50 on every active perpetual on one socket, and mark, index and funding for every perpetual on a second socket, for 45 s. About 55 s.
//   silence  six sockets that differ in whether they subscribe, answer the heartbeat and answer protocol pings, for 100 s.
//   anchor   mark, index, funding, estimated funding and ticker for BTCUSD-PERP for 15 s, every frame kept.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/cryptocom/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_MARKET = 'wss://stream.crypto.com/exchange/v1/market';
const API = 'https://api.crypto.com/exchange/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let nextId = 1;
const sub = (channels, extra = {}, id = nextId++) => ({ id, method: 'subscribe', params: { channels, ...extra }, nonce: Date.now() });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// Opens a socket, answers the server heartbeat unless told not to, and records pings, heartbeats and the close.
function open(name, { answerHeartbeat = true, deflate = false, autoPong = true } = {}) {
  const ws = new WebSocket(URL_MARKET, { perMessageDeflate: deflate, autoPong });
  const t0 = performance.now();
  const info = { name, openMs: null, extensions: null, protocolPings: 0, pingAtMs: [], heartbeats: [], heartbeatReplies: [], closed: null, error: null, upgradeHeaders: null };
  ws.on('upgrade', (res) => { info.upgradeHeaders = { status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null, cfRay: res.headers['cf-ray'] }; });
  ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; });
  ws.on('ping', () => { info.protocolPings++; info.pingAtMs.push(Math.round(performance.now() - t0)); });
  ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  ws.on('error', (e) => { info.error = e.message; });
  ws.on('message', (d) => {
    const s = d.toString();
    if (!s.includes('heartbeat')) return;
    const j = JSON.parse(s);
    const at = Date.now();
    if (j.method === 'public/heartbeat') {
      info.heartbeats.push({ atMs: Math.round(performance.now() - t0), id: j.id, localMinusIdMs: at - j.id, frame: s });
      if (answerHeartbeat) ws.send(JSON.stringify({ id: j.id, method: 'public/respond-heartbeat' }));
    } else if (j.method === 'public/respond-heartbeat') {
      info.heartbeatReplies.push(s);
    }
  });
  const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, info, ready, t0 };
}

const isAsc = (lv) => lv.every((l, i) => i === 0 || Number(l[0]) > Number(lv[i - 1][0]));
const isDesc = (lv) => lv.every((l, i) => i === 0 || Number(l[0]) < Number(lv[i - 1][0]));

class Book {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.u = null; this.maxLevels = 0; }
  reset(d) {
    this.bids = new Map(d.bids.map((l) => [l[0], l]));
    this.asks = new Map(d.asks.map((l) => [l[0], l]));
    this.u = d.u;
  }
  apply(d) {
    for (const l of d.update.bids ?? []) Number(l[1]) === 0 ? this.bids.delete(l[0]) : this.bids.set(l[0], l);
    for (const l of d.update.asks ?? []) Number(l[1]) === 0 ? this.asks.delete(l[0]) : this.asks.set(l[0], l);
    this.u = d.u;
    this.maxLevels = Math.max(this.maxLevels, this.bids.size, this.asks.size);
  }
  sorted() {
    return {
      bids: [...this.bids.values()].sort((a, b) => Number(b[0]) - Number(a[0])),
      asks: [...this.asks.values()].sort((a, b) => Number(a[0]) - Number(b[0])),
    };
  }
}

// Candidate checksum layouts: CRC32 over price and size strings, several orders, separators and depths.
function checksumHits(samples) {
  const orders = {
    interleaveBidFirst: (b, a, n) => { const o = []; for (let i = 0; i < n; i++) { if (b[i]) o.push(b[i]); if (a[i]) o.push(a[i]); } return o; },
    interleaveAskFirst: (b, a, n) => { const o = []; for (let i = 0; i < n; i++) { if (a[i]) o.push(a[i]); if (b[i]) o.push(b[i]); } return o; },
    bidsThenAsks: (b, a, n) => [...b.slice(0, n), ...a.slice(0, n)],
    asksThenBids: (b, a, n) => [...a.slice(0, n), ...b.slice(0, n)],
  };
  const fmts = { raw: (x) => x, number: (x) => String(Number(x)), noDot: (x) => x.replace('.', '').replace(/^0+/, '') };
  const hits = {};
  let tried = 0;
  for (const n of [1, 5, 10, 20, 25, 50]) for (const [on, of] of Object.entries(orders)) for (const sep of [':', '', ',', '|']) for (const [fn, ff] of Object.entries(fmts)) for (const withCount of [false, true]) {
    tried++;
    let m = 0;
    for (const s of samples) {
      const str = of(s.bids, s.asks, n).map((l) => (withCount ? [ff(l[0]), ff(l[1]), l[2]] : [ff(l[0]), ff(l[1])]).join(sep)).join(sep);
      const c = crc32(Buffer.from(str));
      if ((c | 0) === s.cs || c === s.cs) m++;
    }
    if (m > 0) hits[`${n}/${on}/${JSON.stringify(sep)}/${fn}/${withCount}`] = m;
  }
  return { tried, samples: samples.length, hits };
}

async function restJson(path) {
  const res = await fetch(`${API}/${path}`);
  return { status: res.status, body: await res.json(), arrivedAt: Date.now() };
}

async function bookMain(extraSymbols) {
  const symbols = ['BTCUSD-PERP', 'ETHUSD-PERP', 'NVDAUSD-PERP', ...extraSymbols, 'BTC_USD', 'BTCUSD-261225'];
  const WINDOW_MS = 60_000;
  const { ws, info, ready, t0 } = open('main');
  await ready;
  await sleep(1000);
  const st = Object.fromEntries(symbols.map((s) => [s, { snapshots: 0, deltas: 0, emptyDeltas: 0, gaps: 0, gapSamples: [], firstDeltaChainsFromSnapshot: null, snapshotKeys: null, snapshotLevels: null, snapshotBidsDesc: null, snapshotAsksAsc: null, deltaBidsUnordered: 0, deltaAsksUnordered: 0, valueTypes: new Set(), deletes: 0, maxIdleMs: 0, lastAt: null, firstSnapshotMs: null, ageMs: [], ttLagMs: [], deltaChannel: null, snapshotChannel: null, repeatedSameU: 0 }]));
  const books = Object.fromEntries(symbols.map((s) => [s, new Book()]));
  const acks = [];
  const other = [];
  const csSamples = [];
  const hist = { 'BTCUSD-PERP': [], 'ETHUSD-PERP': [] };
  const firstFrames = {};
  let frames = 0;
  let bytes = 0;
  ws.on('message', (data) => {
    const s = data.toString();
    frames++; bytes += data.length;
    capture('book_frames.jsonl', s);
    const at = performance.now() - t0;
    const j = JSON.parse(s);
    if (j.method === 'public/heartbeat' || j.method === 'public/respond-heartbeat') return;
    if (!j.result) { acks.push({ atMs: Math.round(at), frame: s.slice(0, 300) }); return; }
    const r = j.result;
    const x = st[r.instrument_name];
    if (!x || !r.channel?.startsWith('book')) { other.push(s.slice(0, 200)); return; }
    if (!firstFrames[`${r.instrument_name}|${r.channel}`]) firstFrames[`${r.instrument_name}|${r.channel}`] = s.slice(0, 700);
    const d = r.data[0];
    if (x.lastAt !== null) x.maxIdleMs = Math.max(x.maxIdleMs, Math.round(at - x.lastAt));
    x.lastAt = at;
    if (d.t) x.ageMs.push(Date.now() - d.t);
    if (d.t && d.tt) x.ttLagMs.push(d.t - d.tt);
    const bk = books[r.instrument_name];
    if (r.channel === 'book') {
      x.snapshots++;
      x.snapshotChannel = r.channel;
      if (x.firstSnapshotMs === null) x.firstSnapshotMs = Math.round(at);
      x.snapshotKeys = Object.keys(d);
      x.snapshotLevels = { bids: d.bids.length, asks: d.asks.length };
      x.snapshotBidsDesc = isDesc(d.bids);
      x.snapshotAsksAsc = isAsc(d.asks);
      for (const l of [...d.bids, ...d.asks]) for (const v of l) x.valueTypes.add(typeof v);
      bk.reset(d);
      return;
    }
    x.deltaChannel = r.channel;
    x.deltas++;
    const up = d.update ?? {};
    if (!(up.bids?.length) && !(up.asks?.length)) x.emptyDeltas++;
    if (up.bids?.length && !isDesc(up.bids)) x.deltaBidsUnordered++;
    if (up.asks?.length && !isAsc(up.asks)) x.deltaAsksUnordered++;
    for (const l of [...(up.bids ?? []), ...(up.asks ?? [])]) { for (const v of l) x.valueTypes.add(typeof v); if (Number(l[1]) === 0) x.deletes++; }
    if (bk.u === null) { x.gaps++; x.gapSamples.push({ reason: 'delta_before_snapshot', pu: d.pu }); return; }
    if (x.firstDeltaChainsFromSnapshot === null) x.firstDeltaChainsFromSnapshot = d.pu === bk.u;
    if (d.u === bk.u) x.repeatedSameU++;
    if (d.pu !== bk.u) { x.gaps++; if (x.gapSamples.length < 5) x.gapSamples.push({ expectedPu: bk.u, pu: d.pu, u: d.u }); }
    bk.apply(d);
    if (r.instrument_name === 'BTCUSD-PERP' && csSamples.length < 300) csSamples.push({ cs: d.cs, ...bk.sorted() });
    if (hist[r.instrument_name]) {
      const sorted = bk.sorted();
      hist[r.instrument_name].push({ u: d.u, t: d.t, bids: sorted.bids.slice(0, 20), asks: sorted.asks.slice(0, 20) });
      if (hist[r.instrument_name].length > 600) hist[r.instrument_name].shift();
    }
  });
  const subFrame = sub(symbols.map((s) => `book.${s}.50`), { book_subscription_type: 'SNAPSHOT_AND_UPDATE', book_update_frequency: 10 });
  ws.send(JSON.stringify(subFrame));
  log('book_subscribe_frame', { sentAtMs: Math.round(performance.now() - t0), frame: subFrame });

  // The REST book compare: the socket book at the nearest socket t against a REST read.
  await sleep(30_000);
  for (const sym of ['BTCUSD-PERP', 'ETHUSD-PERP']) {
    const r = await restJson(`public/get-book?instrument_name=${sym}&depth=50`);
    const d = r.body.result.data[0];
    const h = hist[sym];
    const near = h.reduce((best, x) => (best === null || Math.abs(x.t - d.t) < Math.abs(best.t - d.t) ? x : best), null);
    let priceEq = 0; let sizeEq = 0;
    for (let i = 0; i < 20; i++) {
      for (const side of ['bids', 'asks']) {
        const a = near?.[side][i]; const b = d[side][i];
        if (a && b && a[0] === b[0]) { priceEq++; if (a[1] === b[1]) sizeEq++; }
      }
    }
    log('rest_compare', { sym, restT: d.t, socketT: near?.t, tDiffMs: near ? near.t - d.t : null, samePriceOf40: priceEq, sameSizeOf40: sizeEq, socketTopBid: near?.bids[0], restTopBid: d.bids[0], socketTopAsk: near?.asks[0], restTopAsk: d.asks[0] });
  }
  await sleep(WINDOW_MS - 30_000);
  ws.close();
  await sleep(300);
  for (const [s, x] of Object.entries(st)) {
    const ages = x.ageMs.sort((a, b) => a - b);
    const tt = x.ttLagMs.sort((a, b) => a - b);
    log('book_stream', { s, snapshots: x.snapshots, deltas: x.deltas, emptyDeltas: x.emptyDeltas, gaps: x.gaps, gapSamples: x.gapSamples, firstDeltaChainsFromSnapshot: x.firstDeltaChainsFromSnapshot, repeatedSameU: x.repeatedSameU, snapshotChannel: x.snapshotChannel, deltaChannel: x.deltaChannel, snapshotKeys: x.snapshotKeys, snapshotLevels: x.snapshotLevels, snapshotBidsDesc: x.snapshotBidsDesc, snapshotAsksAsc: x.snapshotAsksAsc, deltaBidsUnordered: x.deltaBidsUnordered, deltaAsksUnordered: x.deltaAsksUnordered, deletes: x.deletes, valueTypes: [...x.valueTypes], maxBookLevels: books[s].maxLevels, heldLevels: { bids: books[s].bids.size, asks: books[s].asks.size }, maxIdleMs: x.maxIdleMs, firstSnapshotMs: x.firstSnapshotMs, ageMedianMs: ages[Math.floor(ages.length / 2)], ageMaxMs: ages.at(-1), tMinusTtMedianMs: tt[Math.floor(tt.length / 2)] });
  }
  log('book_acks', { acks });
  log('book_other', { count: other.length, sample: other.slice(0, 3) });
  log('book_first_frames', firstFrames);
  log('book_socket', { frames, bytes, seconds: WINDOW_MS / 1000, info });
  log('checksum', checksumHits(csSamples));
}

// One socket per subscription mode, so each stream's cadence and channel names are seen on their own.
async function bookModes() {
  const modes = [
    { name: 'no_params', ch: 'book.ETHUSD-PERP.50', extra: {} },
    { name: 'snapshot_100', ch: 'book.ETHUSD-PERP.50', extra: { book_subscription_type: 'SNAPSHOT', book_update_frequency: 100 } },
    { name: 'snapshot_500', ch: 'book.ETHUSD-PERP.50', extra: { book_subscription_type: 'SNAPSHOT', book_update_frequency: 500 } },
    { name: 'delta_100', ch: 'book.ETHUSD-PERP.50', extra: { book_subscription_type: 'SNAPSHOT_AND_UPDATE', book_update_frequency: 100 } },
    { name: 'delta_10_depth10', ch: 'book.ETHUSD-PERP.10', extra: { book_subscription_type: 'SNAPSHOT_AND_UPDATE', book_update_frequency: 10 } },
    { name: 'snapshot_10', ch: 'book.ETHUSD-PERP.50', extra: { book_subscription_type: 'SNAPSHOT', book_update_frequency: 10 } },
    { name: 'delta_10_depth150', ch: 'book.ETHUSD-PERP.150', extra: { book_subscription_type: 'SNAPSHOT_AND_UPDATE', book_update_frequency: 10 } },
    { name: 'duplicate', ch: 'book.ETHUSD-PERP.50', extra: { book_subscription_type: 'SNAPSHOT_AND_UPDATE', book_update_frequency: 10 }, twice: true },
  ];
  const WINDOW_MS = 20_000;
  const runs = [];
  for (const m of modes) {
    const s = open(`mode_${m.name}`);
    runs.push({ m, s, stats: { replies: [], channels: {}, frames: 0, levels: new Set(), times: [], seenU: new Set(), repeatedU: 0, gaps: 0, lastU: null } });
    await sleep(200);
  }
  await Promise.all(runs.map((r) => r.s.ready));
  await sleep(1000);
  for (const r of runs) {
    r.s.ws.on('message', (d) => {
      const j = JSON.parse(d.toString());
      if (j.method?.includes('heartbeat')) return;
      if (!j.result) { r.stats.replies.push(d.toString().slice(0, 250)); return; }
      const c = j.result.channel;
      r.stats.channels[c] = (r.stats.channels[c] ?? 0) + 1;
      r.stats.frames++;
      r.stats.times.push(performance.now());
      const dd = j.result.data[0];
      if (c === 'book') r.stats.levels.add(`${dd.bids.length}/${dd.asks.length}`);
      if (dd.u !== undefined) { if (r.stats.seenU.has(dd.u)) r.stats.repeatedU++; r.stats.seenU.add(dd.u); }
      if (c === 'book.update') { if (r.stats.lastU !== null && dd.pu !== r.stats.lastU) r.stats.gaps++; }
      if (dd.u !== undefined) r.stats.lastU = dd.u;
    });
    r.s.ws.send(JSON.stringify(sub([r.m.ch], r.m.extra)));
    if (r.m.twice) { await sleep(300); r.s.ws.send(JSON.stringify(sub([r.m.ch], r.m.extra))); }
  }
  await sleep(WINDOW_MS);
  for (const r of runs) {
    r.s.ws.close();
    const gaps = r.stats.times.slice(1).map((t, i) => t - r.stats.times[i]).sort((a, b) => a - b);
    log('book_mode', { mode: r.m.name, channel: r.m.ch, params: r.m.extra, replies: r.stats.replies, channels: r.stats.channels, framesPerSecond: +(r.stats.frames / (WINDOW_MS / 1000)).toFixed(1), snapshotLevels: [...r.stats.levels].slice(0, 5), repeatedU: r.stats.repeatedU, chainBreaks: r.stats.gaps, interFrameMedianMs: Math.round(gaps[Math.floor(gaps.length / 2)] ?? 0), interFrameMinMs: Math.round(gaps[0] ?? 0) });
  }
}

async function errors() {
  const { ws, ready } = open('errors');
  await ready;
  await sleep(1000);
  const replies = [];
  const t0 = performance.now();
  ws.on('message', (d) => {
    const s = d.toString();
    const j = JSON.parse(s);
    if (j.method?.includes('heartbeat')) return;
    if (j.id === -1 && j.result) return; // data frames
    replies.push(`${Math.round(performance.now() - t0)}ms ${s.slice(0, 380)}`);
  });
  const cases = [
    ['unknown symbol', sub(['book.NOPEUSD-PERP.50'])],
    ['depth 20', sub(['book.BTCUSD-PERP.20'])],
    ['depth 150', sub(['book.BTCUSD-PERP.150'])],
    ['frequency 50', sub(['book.SOLUSD-PERP.50'], { book_subscription_type: 'SNAPSHOT_AND_UPDATE', book_update_frequency: 50 })],
    ['subscription type NOPE', sub(['book.XRPUSD-PERP.50'], { book_subscription_type: 'NOPE' })],
    ['unknown channel', sub(['nope.BTCUSD-PERP'])],
    ['index on the perp symbol', sub(['index.BTCUSD-PERP'])],
    ['mark on the index symbol', sub(['mark.BTCUSD-INDEX'])],
    ['duplicate first', sub(['book.DOGEUSD-PERP.50'])],
    ['duplicate second', sub(['book.DOGEUSD-PERP.50'])],
    ['no nonce', { id: nextId++, method: 'subscribe', params: { channels: ['ticker.ADAUSD-PERP'] } }],
    ['unsubscribe unknown', { id: nextId++, method: 'unsubscribe', params: { channels: ['book.LTCUSD-PERP.50'] }, nonce: Date.now() }],
    ['dated future book', sub(['book.BTCUSD-260925.50'])],
  ];
  for (const [name, frame] of cases) {
    log('error_case', { name, id: frame.id, atMs: Math.round(performance.now() - t0), frame });
    ws.send(JSON.stringify(frame));
    await sleep(300);
  }
  log('error_case', { name: 'not json', id: null, atMs: Math.round(performance.now() - t0) });
  ws.send('this is not json');
  await sleep(1500);
  const unknownMethod = { id: nextId++, method: 'public/nope', params: {}, nonce: Date.now() };
  log('error_case', { name: 'unknown method', id: unknownMethod.id, atMs: Math.round(performance.now() - t0), frame: unknownMethod });
  ws.send(JSON.stringify(unknownMethod));
  await sleep(1500);
  ws.close();
  log('error_replies', { replies });
}

async function book() {
  // A perpetual with an empty side right now, when one exists, and the quietest perpetual by 24 h value.
  const tick = (await restJson('public/get-tickers')).body.result.data.filter((x) => x.i.endsWith('-PERP'));
  const oneSided = tick.find((x) => x.b === null || x.k === null)?.i;
  const quiet = tick.sort((a, b) => Number(a.vv) - Number(b.vv))[0].i;
  log('book_extra_symbols', { oneSided, quiet });
  await Promise.all([bookMain([quiet, ...(oneSided ? [oneSided] : [])]), (async () => { await sleep(2000); await bookModes(); await errors(); })()]);
}

async function subscribeInFrames(ws, channels, perFrame, gapMs, extra = {}) {
  const ids = [];
  for (let i = 0; i < channels.length; i += perFrame) {
    const f = sub(channels.slice(i, i + perFrame), extra);
    ids.push(f.id);
    ws.send(JSON.stringify(f));
    await sleep(gapMs);
  }
  return ids;
}

async function batch() {
  const perps = (await restJson('public/get-instruments')).body.result.data.filter((x) => x.inst_type === 'PERPETUAL_SWAP' && x.tradable);
  const WINDOW_MS = 45_000;
  const A = open('batch_books');
  const B = open('batch_anchor');
  await Promise.all([A.ready, B.ready]);
  await sleep(1000);

  const a = { acks: 0, errors: [], snapshots: new Set(), deltas: 0, gaps: 0, frames: 0, bytes: 0, parseNs: 0n, perSecond: [], lastU: new Map(), firstSubAt: 0 };
  A.ws.on('message', (d) => {
    const t = process.hrtime.bigint();
    const j = JSON.parse(d.toString());
    a.parseNs += process.hrtime.bigint() - t;
    a.frames++; a.bytes += d.length;
    const sec = Math.floor((performance.now() - a.firstSubAt) / 1000);
    a.perSecond[sec] = (a.perSecond[sec] ?? 0) + 1;
    if (j.method?.includes('heartbeat')) return;
    if (!j.result) { if (j.code === 0) a.acks++; else a.errors.push(d.toString().slice(0, 250)); return; }
    const r = j.result; const dd = r.data[0];
    if (r.channel === 'book') { a.snapshots.add(r.instrument_name); a.lastU.set(r.instrument_name, dd.u); return; }
    a.deltas++;
    if (a.lastU.get(r.instrument_name) !== dd.pu) a.gaps++;
    a.lastU.set(r.instrument_name, dd.u);
  });
  const b = { acks: 0, errors: [], perChannel: new Map(), firstData: new Set(), frames: 0 };
  B.ws.on('message', (d) => {
    const j = JSON.parse(d.toString());
    if (j.method?.includes('heartbeat')) return;
    b.frames++;
    if (!j.result) { if (j.code === 0) b.acks++; else b.errors.push(d.toString().slice(0, 250)); return; }
    const k = j.result.subscription;
    const x = b.perChannel.get(k) ?? { n: 0, last: null, maxGapMs: 0, values: new Set(), lastT: null, tRepeats: 0 };
    const now = performance.now();
    if (x.last !== null) x.maxGapMs = Math.max(x.maxGapMs, now - x.last);
    x.last = now; x.n++;
    const v = j.result.data[0];
    x.values.add(v.v);
    if (x.lastT === v.t) x.tRepeats++;
    x.lastT = v.t;
    b.perChannel.set(k, x);
    if (j.id !== -1) b.firstData.add(k);
  });

  a.firstSubAt = performance.now();
  const bookChannels = perps.map((p) => `book.${p.symbol}.50`);
  const anchorChannels = perps.flatMap((p) => [`mark.${p.symbol}`, `index.${p.underlying_symbol}`, `funding.${p.symbol}`]);
  const tSubA = performance.now();
  const [idsA, idsB] = await Promise.all([
    subscribeInFrames(A.ws, bookChannels, 100, 250, { book_subscription_type: 'SNAPSHOT_AND_UPDATE', book_update_frequency: 10 }),
    subscribeInFrames(B.ws, anchorChannels, 100, 250),
  ]);
  log('batch_subscribed', { bookChannels: bookChannels.length, bookFrames: idsA.length, anchorChannels: anchorChannels.length, anchorFrames: idsB.length, sendMs: Math.round(performance.now() - tSubA) });
  await sleep(15_000);
  log('batch_snapshots_after_15s', { withSnapshot: a.snapshots.size, of: perps.length });
  await sleep(WINDOW_MS - 15_000);
  A.ws.close(); B.ws.close();
  await sleep(300);
  const steady = a.perSecond.slice(10, 44).filter((x) => x !== undefined).sort((x, y) => x - y);
  log('batch_books', { perps: perps.length, acks: a.acks, errors: a.errors.slice(0, 5), errorCount: a.errors.length, withSnapshot: a.snapshots.size, missingSnapshot: perps.filter((p) => !a.snapshots.has(p.symbol)).map((p) => p.symbol).slice(0, 20), deltas: a.deltas, gaps: a.gaps, frames: a.frames, framesPerSecondAvg: Math.round(a.frames / (WINDOW_MS / 1000)), steadyMedianPerSecond: steady[Math.floor(steady.length / 2)], steadyMaxPerSecond: steady.at(-1), bytesPerSecond: Math.round(a.bytes / (WINDOW_MS / 1000)), bytesPerFrame: Math.round(a.bytes / a.frames), parseUsPerFrame: +(Number(a.parseNs) / a.frames / 1000).toFixed(1), closed: A.info.closed, heartbeats: A.info.heartbeats.length });
  const kinds = { mark: [], index: [], funding: [] };
  for (const [k, x] of b.perChannel) kinds[k.split('.')[0]]?.push(x);
  const summary = Object.fromEntries(Object.entries(kinds).map(([k, xs]) => {
    const n = xs.map((x) => x.n).sort((p, q) => p - q);
    const g = xs.map((x) => x.maxGapMs).sort((p, q) => p - q);
    return [k, { channelsWithData: xs.length, framesMin: n[0], framesMedian: n[Math.floor(n.length / 2)], framesMax: n.at(-1), maxGapMedianMs: Math.round(g[Math.floor(g.length / 2)] ?? 0), maxGapMaxMs: Math.round(g.at(-1) ?? 0), distinctValuesMedian: xs.map((x) => x.values.size).sort((p, q) => p - q)[Math.floor(xs.length / 2)], tRepeatsTotal: xs.reduce((s, x) => s + x.tRepeats, 0) }];
  }));
  log('batch_anchor', { channels: anchorChannels.length, acks: b.acks, errors: b.errors.slice(0, 5), errorCount: b.errors.length, dataInSubscribeReply: b.firstData.size, frames: b.frames, summary, closed: B.info.closed, heartbeats: B.info.heartbeats.length });
}

async function silence() {
  const specs = [
    { name: 'subscribed_answers', subscribe: true, answer: true },
    { name: 'subscribed_silent', subscribe: true, answer: false },
    { name: 'idle_answers', subscribe: false, answer: true },
    { name: 'idle_silent', subscribe: false, answer: false },
    { name: 'subscribed_silent_no_pong', subscribe: true, answer: false, autoPong: false },
    { name: 'idle_silent_no_pong', subscribe: false, answer: false, autoPong: false },
  ];
  const socks = specs.map((s) => ({ s, o: open(s.name, { answerHeartbeat: s.answer, autoPong: s.autoPong ?? true }) }));
  await Promise.all(socks.map((x) => x.o.ready));
  await sleep(1000);
  for (const x of socks) if (x.s.subscribe) x.o.ws.send(JSON.stringify(sub(['ticker.WALUSD-PERP'])));
  await sleep(100_000);
  for (const x of socks) {
    if (x.o.ws.readyState === WebSocket.OPEN) x.o.ws.close();
    const p = x.o.info.pingAtMs;
    log('silence', { ...x.s, openMs: x.o.info.openMs, protocolPings: x.o.info.protocolPings, pingIntervalsMs: p.slice(1).map((t, i) => t - p[i]), heartbeatsAtMs: x.o.info.heartbeats.map((h) => h.atMs), heartbeatLocalMinusIdMs: x.o.info.heartbeats.map((h) => h.localMinusIdMs), heartbeatFrame: x.o.info.heartbeats[0]?.frame, heartbeatReplies: x.o.info.heartbeatReplies, closed: x.o.info.closed });
  }
}

// The anchor channels of one perpetual, with every frame kept, for their shapes and cadence.
async function anchor() {
  const { ws, info, ready, t0 } = open('anchor');
  await ready;
  await sleep(1000);
  const seen = {};
  ws.on('message', (d) => {
    const s = d.toString();
    capture('anchor_frames.jsonl', s);
    const j = JSON.parse(s);
    if (!j.result) return;
    const k = j.result.subscription;
    const x = (seen[k] ??= { frames: 0, first: s.slice(0, 400), atMs: [], ts: [], lags: [] });
    x.frames++;
    x.atMs.push(Math.round(performance.now() - t0));
    x.ts.push(j.result.data[0].t);
    x.lags.push(Date.now() - j.result.data[0].t);
  });
  const f = sub(['mark.BTCUSD-PERP', 'index.BTCUSD-INDEX', 'funding.BTCUSD-PERP', 'estimatedfunding.BTCUSD-PERP', 'ticker.BTCUSD-PERP']);
  ws.send(JSON.stringify(f));
  await sleep(15_000);
  ws.close();
  await sleep(200);
  for (const [k, x] of Object.entries(seen)) {
    const secs = x.ts.map((t) => new Date(t).getUTCSeconds());
    const lags = [...x.lags].sort((a, b) => a - b);
    log('anchor_channel', { subscription: k, frames: x.frames, seconds: 15, first: x.first, tSecondsOfMinute: [...new Set(secs)].slice(0, 20), arrivalMinusTMedianMs: lags[Math.floor(lags.length / 2)], arrivalMinusTMaxMs: lags.at(-1) });
  }
  log('anchor_socket', { heartbeats: info.heartbeats.length, closed: info.closed });
}

async function deflate() {
  const { ws, info, ready } = open('deflate', { deflate: true });
  await ready;
  await sleep(300);
  ws.close();
  await sleep(200);
  log('deflate', { offered: true, negotiatedHeader: info.upgradeHeaders?.ext, extensions: info.extensions, cfRay: info.upgradeHeaders?.cfRay, openMs: info.openMs });
}

const mode = process.argv[2] ?? 'book';
const run = { book, batch, silence, anchor, deflate }[mode];
if (!run) { console.error(`unknown mode ${mode}`); process.exit(1); }
await run();
process.exit(0);
