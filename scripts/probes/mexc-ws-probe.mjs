// MEXC futures WebSocket at wss://contract.mexc.com/edge: the depth channels, the sequence rule, level order, size unit, keepalive, silence, errors and the anchor channels.
// Public, unauthenticated and read-only. Opened with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/mexc-ws-probe.mjs [small] [batch] [batchfull] [channels] [silence] [gzip]
// With no phase named, all six run, gzip, small and silence together, then batch, batchfull and channels, in about six minutes.
// Raw frames go to $MEXC_PROBE_OUT, default <tmpdir>/mexc-probe. Recorded in docs/profiles/mexc/websocket.md.
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = requireServer('ws');
const OUT = process.env.MEXC_PROBE_OUT ?? path.join(os.tmpdir(), 'mexc-probe');
fs.mkdirSync(OUT, { recursive: true });

const URL_EDGE = 'wss://contract.mexc.com/edge';
const REST = 'https://api.mexc.com/api/v1/contract';
const SMALL_MS = 80_000;
const BATCH_MS = 60_000;
const BATCH_SIZE = 150;
const PING_MS = 15_000;

const phases = new Set(process.argv.slice(2));
const want = (p) => phases.size === 0 || phases.has(p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const print = (label, o) => console.log(JSON.stringify({ phase: label, ...o }));
const getJson = async (u) => (await fetch(u)).json();

// Decodes a frame, gunzipping a binary one, and reports which it was.
function decode(data, isBinary) {
  if (!isBinary) return { text: data.toString('utf8'), kind: 'text' };
  try {
    return { text: zlib.gunzipSync(data).toString('utf8'), kind: 'binary-gzip' };
  } catch {
    try {
      return { text: zlib.inflateRawSync(data).toString('utf8'), kind: 'binary-deflate' };
    } catch {
      return { text: null, kind: `binary-unknown ${data.subarray(0, 4).toString('hex')}` };
    }
  }
}

function open(id, onFrame, { log = 300, ping = PING_MS } = {}) {
  const file = fs.createWriteStream(path.join(OUT, `ws-${id}.jsonl`));
  const c = { id, t0: Date.now(), frames: 0, bytes: 0, kinds: {}, logged: 0, pongs: [], lastPingAt: 0, closed: null };
  c.ws = new WebSocket(URL_EDGE, { perMessageDeflate: false });
  c.ready = new Promise((resolve) => c.ws.once('open', resolve));
  c.ws.on('upgrade', (res) => (c.extensions = res.headers['sec-websocket-extensions'] ?? null));
  c.ws.on('open', () => {
    c.openMs = Date.now() - c.t0;
    if (ping > 0) {
      c.pingTimer = setInterval(() => {
        c.lastPingAt = Date.now();
        c.ws.send(JSON.stringify({ method: 'ping' }));
      }, ping);
    }
  });
  c.ws.on('message', (data, isBinary) => {
    const now = Date.now();
    c.frames++;
    c.bytes += data.length;
    const d = decode(data, isBinary);
    c.kinds[d.kind] = (c.kinds[d.kind] ?? 0) + 1;
    if (c.logged < log) {
      c.logged++;
      file.write(JSON.stringify({ at: now - c.t0, kind: d.kind, wireBytes: data.length, text: d.text?.slice(0, 4000) }) + '\n');
    }
    if (d.text === null) return;
    let j;
    try {
      j = JSON.parse(d.text);
    } catch {
      return;
    }
    if (j.channel === 'pong') c.pongs.push({ rtt: now - c.lastPingAt, frame: d.text });
    onFrame(j, now, d, data.length);
  });
  c.ws.on('close', (code, reason) => {
    c.closed = { code, reason: reason.toString(), afterMs: Date.now() - c.t0 };
    clearInterval(c.pingTimer);
    file.end();
  });
  c.ws.on('error', (e) => (c.error = e.message));
  c.send = (o) => c.ws.send(JSON.stringify(o));
  c.close = () => {
    clearInterval(c.pingTimer);
    try {
      c.ws.close();
    } catch {}
  };
  return c;
}

// Per symbol state for the incremental channel: the begin and end chain, level order inside a frame, and a book seeded from REST.
function depthTracker() {
  const s = new Map();
  const of = (sym) => {
    if (!s.has(sym)) s.set(sym, { frames: 0, gaps: 0, gapSamples: [], overlaps: 0, versionNotEnd: 0, beginGtEnd: 0, first: null, lastEnd: null, repeats: 0, lastText: null, emptyFrames: 0, levelsMax: 0, bidsSortedDesc: 0, bidsUnsorted: 0, multiLevelBidFrames: 0, zeroSizeLevels: 0, fields: new Set(), cts: 0, maxGapMs: 0, lastAt: null });
    return s.get(sym);
  };
  return {
    s,
    apply(sym, data, now, text) {
      const t = of(sym);
      t.frames++;
      for (const k of Object.keys(data)) t.fields.add(k);
      if (t.lastAt !== null) t.maxGapMs = Math.max(t.maxGapMs, now - t.lastAt);
      t.lastAt = now;
      if (t.first === null) t.first = { begin: data.begin, end: data.end, version: data.version, bids: data.bids?.length, asks: data.asks?.length };
      if (data.end !== undefined && data.version !== data.end) t.versionNotEnd++;
      if (data.begin > data.end) t.beginGtEnd++;
      // A merged frame carries begin and end, and an unmerged one (compress false) carries only version, which is then its own begin and end.
      const begin = data.begin ?? data.version;
      const end = data.end ?? data.version;
      if (t.lastEnd !== null) {
        if (begin === t.lastEnd + 1) {
          // chained
        } else if (begin <= t.lastEnd) {
          t.overlaps++;
        } else {
          t.gaps++;
          if (t.gapSamples.length < 5) t.gapSamples.push({ expected: t.lastEnd + 1, gotBegin: begin, gotEnd: end });
        }
      }
      t.lastEnd = end;
      const bids = data.bids ?? [];
      const asks = data.asks ?? [];
      if (bids.length + asks.length === 0) t.emptyFrames++;
      t.levelsMax = Math.max(t.levelsMax, bids.length + asks.length);
      if (bids.length > 1) {
        t.multiLevelBidFrames++;
        if (bids.every((l, i) => i === 0 || bids[i - 1][0] > l[0])) t.bidsSortedDesc++;
        else t.bidsUnsorted++;
      }
      for (const l of [...bids, ...asks]) if (l[1] === 0) t.zeroSizeLevels++;
      if (data.cts !== undefined && data.cts !== null) t.cts++;
      const body = JSON.stringify({ b: data.bids, a: data.asks, v: data.version });
      if (body === t.lastText) t.repeats++;
      t.lastText = body;
    },
    summary() {
      return Object.fromEntries([...s].map(([k, v]) => [k, { ...v, fields: [...v.fields], lastText: undefined, lastAt: undefined }]));
    },
  };
}

// A book rebuilt the documented way: REST snapshot, then every delta whose end is past the snapshot version.
class LocalBook {
  constructor(snapshot) {
    this.version = snapshot.version;
    this.bids = new Map(snapshot.bids.map((l) => [l[0], l[1]]));
    this.asks = new Map(snapshot.asks.map((l) => [l[0], l[1]]));
    this.applied = 0;
    this.skipped = 0;
    this.straddled = 0;
    this.crossedAfterApply = 0;
  }
  apply(d) {
    const begin = d.begin ?? d.version;
    const end = d.end ?? d.version;
    if (end <= this.version) {
      this.skipped++;
      return;
    }
    if (begin <= this.version) this.straddled++;
    for (const [p, q] of d.bids ?? []) q === 0 ? this.bids.delete(p) : this.bids.set(p, q);
    for (const [p, q] of d.asks ?? []) q === 0 ? this.asks.delete(p) : this.asks.set(p, q);
    this.version = end;
    this.applied++;
    const bb = Math.max(...this.bids.keys());
    const ba = Math.min(...this.asks.keys());
    if (bb >= ba) this.crossedAfterApply++;
  }
  top(n) {
    return {
      bids: [...this.bids].sort((a, b) => b[0] - a[0]).slice(0, n),
      asks: [...this.asks].sort((a, b) => a[0] - b[0]).slice(0, n),
    };
  }
}

async function smallPhase() {
  const incSyms = ['BTC_USDT', 'RIF_USDT', 'CSPR_USDT', 'BTC_USD', 'BTC_USDC'];
  const inc = depthTracker();
  const acks = [];
  const errors = [];
  const other = {};
  // BTC_USDT is rebuilt from the default merged stream and ETH_USDT from the unmerged one, each seeded from REST.
  // The book applies each delta two seconds after it arrived, so a REST read taken later still finds the book behind its version and can be compared at that version.
  const DELAY_MS = 2_000;
  const books = { BTC_USDT: { local: null, queue: [], checks: [] }, ETH_USDT: { local: null, queue: [], checks: [] } };
  const onBookDelta = (sym, data, now) => {
    const b = books[sym];
    if (b) b.queue.push({ at: now, data });
  };
  const drain = (b, force = false) => {
    const now = Date.now();
    while (b.queue.length > 0 && (force || now - b.queue[0].at >= DELAY_MS)) {
      const { data } = b.queue.shift();
      const end = data.end ?? data.version;
      for (const chk of b.checks) {
        if (chk.done || end < chk.version) continue;
        // This delta reaches the read's version, so the book before it is compared when the version matches exactly, and the book after it otherwise.
        if (b.local.version === chk.version) settle(b, chk);
      }
      b.local.apply(data);
      for (const chk of b.checks) if (!chk.done && b.local.version >= chk.version) settle(b, chk);
    }
  };
  const settle = (b, chk) => {
    chk.done = true;
    const mine = b.local.top(20);
    const diff = (x, y) => x.filter((l, i) => !y[i] || y[i][0] !== l[0] || y[i][1] !== l[1]).length;
    chk.result = {
      restVersion: chk.version,
      localVersion: b.local.version,
      exact: b.local.version === chk.version,
      bidMismatchesTop20: diff(mine.bids, chk.bids),
      askMismatchesTop20: diff(mine.asks, chk.asks),
    };
  };
  const perSymBytes = {};
  const c = open('small-incremental', (j, now, d, wireBytes) => {
    if (j.channel === 'push.depth') {
      inc.apply(j.symbol, j.data, now, d.text);
      perSymBytes[j.symbol] = (perSymBytes[j.symbol] ?? 0) + wireBytes;
      onBookDelta(j.symbol, j.data, now);
      return;
    }
    if (j.channel?.startsWith('rs.')) (j.channel === 'rs.error' ? errors : acks).push({ at: now - c.t0, frame: d.text });
    else if (j.channel !== 'pong') other[j.channel] = (other[j.channel] ?? 0) + 1;
  });
  await c.ready;
  for (const sym of incSyms) c.send({ method: 'sub.depth', param: { symbol: sym } });
  c.send({ method: 'sub.depth', param: { symbol: 'ETH_USDT', compress: false } });
  c.send({ method: 'sub.depth', param: { symbol: 'NOPE_USDT' } });

  // A second connection carries the full depth channel at 20 levels, so its frames cannot mix with the incremental ones.
  const full = {};
  const fullAcks = [];
  const f = open('small-full', (j, now, d) => {
    if (j.channel?.startsWith('rs.')) {
      fullAcks.push({ at: now - f.t0, frame: d.text });
      return;
    }
    if (j.channel === 'pong' || !j.symbol) return;
    const key = `${j.channel} ${j.symbol}`;
    const t = (full[key] ??= { frames: 0, levels: {}, versionSteps: [], lastVersion: null, repeats: 0, lastBody: null, bidsDesc: 0, asksAsc: 0, fields: new Set(), first: null, lastAt: null, maxGapMs: 0 });
    t.frames++;
    for (const k of Object.keys(j.data ?? {})) t.fields.add(k);
    const b = j.data?.bids ?? [];
    const a = j.data?.asks ?? [];
    t.levels[`${b.length}/${a.length}`] = (t.levels[`${b.length}/${a.length}`] ?? 0) + 1;
    if (b.every((l, i) => i === 0 || b[i - 1][0] > l[0])) t.bidsDesc++;
    if (a.every((l, i) => i === 0 || a[i - 1][0] < l[0])) t.asksAsc++;
    if (t.first === null) t.first = d.text.slice(0, 400);
    if (t.lastVersion !== null && t.versionSteps.length < 40) t.versionSteps.push(j.data.version - t.lastVersion);
    t.lastVersion = j.data.version;
    const body = JSON.stringify([b, a]);
    if (body === t.lastBody) t.repeats++;
    t.lastBody = body;
    if (t.lastAt !== null) t.maxGapMs = Math.max(t.maxGapMs, now - t.lastAt);
    t.lastAt = now;
  });
  await f.ready;
  for (const sym of ['BTC_USDT', 'RIF_USDT']) f.send({ method: 'sub.depth.full', param: { symbol: sym, limit: 20 } });

  // Seed both books from REST a few seconds in, the way the documented maintenance does, then read REST again every eight seconds.
  await sleep(5_000);
  for (const sym of Object.keys(books)) {
    const snap = await getJson(`${REST}/depth/${sym}?limit=1000`);
    const b = books[sym];
    b.seedVersion = snap.data.version;
    b.local = new LocalBook(snap.data);
    b.queuedAtSeed = b.queue.length;
  }
  const drainer = setInterval(() => Object.values(books).forEach((b) => drain(b)), 50);
  const checkUntil = c.t0 + SMALL_MS - 10_000;
  while (Date.now() < checkUntil) {
    await sleep(8_000);
    for (const sym of Object.keys(books)) {
      const r = await getJson(`${REST}/depth/${sym}?limit=20`);
      const b = books[sym];
      b.checks.push({ version: r.data.version, behindAtArrival: r.data.version <= b.local.version, bids: r.data.bids.map((l) => [l[0], l[1]]), asks: r.data.asks.map((l) => [l[0], l[1]]), done: r.data.version <= b.local.version });
    }
  }
  await sleep(Math.max(0, c.t0 + SMALL_MS - Date.now()));
  clearInterval(drainer);
  Object.values(books).forEach((b) => drain(b, true));
  const windowS = (Date.now() - c.t0) / 1000;
  c.close();
  f.close();
  await sleep(500);

  const ccxt = requireServer('ccxt');
  const ex = new ccxt.mexc();
  await ex.loadMarkets();
  const cs = ex.market('BTC/USDT:USDT').contractSize;
  print('small.incremental', {
    url: URL_EDGE,
    openMs: c.openMs,
    extensionsNegotiated: c.extensions,
    windowS: +windowS.toFixed(1),
    frames: c.frames,
    framesPerS: +(c.frames / windowS).toFixed(1),
    bytesPerS: Math.round(c.bytes / windowS),
    frameKinds: c.kinds,
    perSymbolBytesPerS: Object.fromEntries(Object.entries(perSymBytes).map(([k, v]) => [k, Math.round(v / windowS)])),
    acks,
    errors,
    otherChannels: other,
    pongs: c.pongs,
    closed: c.closed,
    perSymbol: inc.summary(),
  });
  const restNow = await getJson(`${REST}/depth/BTC_USDT?limit=5`);
  print('small.localBook', {
    books: Object.fromEntries(Object.entries(books).map(([sym, b]) => [sym, {
      seedVersion: b.seedVersion,
      queuedAtSeed: b.queuedAtSeed,
      applied: b.local.applied,
      skipped: b.local.skipped,
      straddled: b.local.straddled,
      crossedAfterApply: b.local.crossedAfterApply,
      checks: b.checks.map((chk) => chk.result ?? { restVersion: chk.version, behindBookAtArrival: chk.behindAtArrival, notReached: !chk.behindAtArrival }),
    }])),
    sizeUnit: { contractSize: cs, restBestBidContracts: restNow.data.bids[0][1], restBestBidCoins: +(restNow.data.bids[0][1] * cs).toFixed(6) },
  });
  print('small.full', {
    openMs: f.openMs,
    frames: f.frames,
    frameKinds: f.kinds,
    acks: fullAcks,
    closed: f.closed,
    perSymbol: Object.fromEntries(Object.entries(full).map(([k, v]) => [k, { ...v, fields: [...v.fields], lastBody: undefined, lastAt: undefined }])),
  });
}

async function silencePhase() {
  // No ping on either connection. One subscribes nothing, the other receives depth traffic all along.
  const idle = open('silence-idle', () => {}, { ping: 0, log: 20 });
  const busy = open('silence-busy', () => {}, { ping: 0, log: 5 });
  await Promise.all([idle.ready, busy.ready]);
  busy.send({ method: 'sub.depth', param: { symbol: 'BTC_USDT' } });
  const until = Date.now() + 100_000;
  while (Date.now() < until && (idle.closed === null || busy.closed === null)) await sleep(250);
  const idleResult = { closed: idle.closed, frames: idle.frames };
  const busyResult = { closed: busy.closed, frames: busy.frames };
  idle.close();
  busy.close();
  print('silence', { idleNoSubscriptionNoPing: idleResult, busyDepthNoPing: busyResult, waitedUpToS: 100 });
}

async function batchSymbols() {
  const tick = await getJson(`${REST}/ticker`);
  const detail = await getJson(`${REST}/detail`);
  const live = new Set(detail.data.filter((d) => d.state === 0 && d.apiAllowed).map((d) => d.symbol));
  return tick.data
    .filter((t) => live.has(t.symbol) && t.symbol.endsWith('_USDT'))
    .sort((a, b) => b.amount24 - a.amount24)
    .slice(0, BATCH_SIZE)
    .map((t) => t.symbol);
}

async function batchPhase() {
  const syms = await batchSymbols();
  const inc = depthTracker();
  const acks = { success: 0, other: [] };
  const errors = [];
  const c = open('batch', (j, now, d) => {
    if (j.channel === 'push.depth') inc.apply(j.symbol, j.data, now, d.text);
    else if (j.channel === 'rs.sub.depth') j.data === 'success' ? acks.success++ : acks.other.push(d.text);
    else if (j.channel === 'rs.error') errors.push(d.text);
  }, { log: 50 });
  await c.ready;
  // Twenty subscribe frames per second, since no client message rate is published.
  const tSub = Date.now();
  for (let i = 0; i < syms.length; i++) {
    c.send({ method: 'sub.depth', param: { symbol: syms[i] } });
    if (i % 20 === 19) await sleep(1000);
  }
  const subscribeMs = Date.now() - tSub;
  const start = Date.now();
  const startFrames = c.frames;
  const startBytes = c.bytes;
  await sleep(BATCH_MS);
  const windowS = (Date.now() - start) / 1000;
  const summary = inc.summary();
  const perSym = Object.values(summary);
  const totalGaps = perSym.reduce((n, v) => n + v.gaps, 0);
  const symsWithGaps = Object.entries(summary).filter(([, v]) => v.gaps > 0).map(([k, v]) => ({ sym: k, gaps: v.gaps, samples: v.gapSamples }));
  const framesPerSym = perSym.map((v) => v.frames).sort((a, b) => a - b);
  c.close();
  await sleep(500);
  print('batch', {
    subscribed: syms.length,
    subscribeMs,
    acks,
    errors: errors.slice(0, 5),
    symbolsWithFrames: perSym.length,
    windowS: +windowS.toFixed(1),
    framesPerS: +((c.frames - startFrames) / windowS).toFixed(1),
    bytesPerS: Math.round((c.bytes - startBytes) / windowS),
    frameKinds: c.kinds,
    totalDeltas: perSym.reduce((n, v) => n + v.frames, 0),
    totalGaps,
    totalOverlaps: perSym.reduce((n, v) => n + v.overlaps, 0),
    versionNotEndFrames: perSym.reduce((n, v) => n + v.versionNotEnd, 0),
    symsWithGaps: symsWithGaps.slice(0, 10),
    framesPerSymbol: { min: framesPerSym[0], med: framesPerSym[Math.floor(framesPerSym.length / 2)], max: framesPerSym[framesPerSym.length - 1] },
    maxInterFrameGapMsPerSymbol: { med: perSym.map((v) => v.maxGapMs).sort((a, b) => a - b)[Math.floor(perSym.length / 2)] },
    pongs: c.pongs.length,
    closed: c.closed,
  });
}

// The full depth channel at 20 levels for the same slice: every push replaces the book, so the checks are cadence, levels, order and bytes.
async function batchFullPhase() {
  const syms = await batchSymbols();
  const per = new Map();
  const acks = { success: 0, other: [] };
  const errors = [];
  const c = open('batchfull', (j, now, d, wireBytes) => {
    if (j.channel === 'push.depth.full') {
      const t = per.get(j.symbol) ?? { frames: 0, lastAt: null, gaps: [], levels: {}, unsorted: 0, bytes: 0, lastVersion: null, versionBackwards: 0 };
      t.frames++;
      t.bytes += wireBytes;
      if (t.lastAt !== null) t.gaps.push(now - t.lastAt);
      t.lastAt = now;
      const b = j.data.bids;
      const a = j.data.asks;
      t.levels[`${b.length}/${a.length}`] = (t.levels[`${b.length}/${a.length}`] ?? 0) + 1;
      if (!b.every((l, i) => i === 0 || b[i - 1][0] > l[0]) || !a.every((l, i) => i === 0 || a[i - 1][0] < l[0])) t.unsorted++;
      if (t.lastVersion !== null && j.data.version < t.lastVersion) t.versionBackwards++;
      t.lastVersion = j.data.version;
      per.set(j.symbol, t);
    } else if (j.channel === 'rs.sub.depth.full') j.data === 'success' ? acks.success++ : acks.other.push(d.text);
    else if (j.channel === 'rs.error') errors.push(d.text);
  }, { log: 20 });
  await c.ready;
  const tSub = Date.now();
  for (let i = 0; i < syms.length; i++) {
    c.send({ method: 'sub.depth.full', param: { symbol: syms[i], limit: 20 } });
    if (i % 20 === 19) await sleep(1000);
  }
  const subscribeMs = Date.now() - tSub;
  const start = Date.now();
  const f0 = c.frames;
  const b0 = c.bytes;
  await sleep(BATCH_MS);
  const windowS = (Date.now() - start) / 1000;
  c.close();
  await sleep(500);
  const all = [...per.values()];
  const maxGap = all.map((t) => Math.max(0, ...t.gaps)).sort((x, y) => x - y);
  const medGap = all.map((t) => [...t.gaps].sort((x, y) => x - y)[Math.floor(t.gaps.length / 2)] ?? null).filter((x) => x !== null).sort((x, y) => x - y);
  const levels = {};
  for (const t of all) for (const [k, v] of Object.entries(t.levels)) levels[k] = (levels[k] ?? 0) + v;
  print('batchfull', {
    subscribed: syms.length,
    subscribeMs,
    acks,
    errors: errors.slice(0, 5),
    symbolsWithFrames: all.length,
    windowS: +windowS.toFixed(1),
    framesPerS: +((c.frames - f0) / windowS).toFixed(1),
    bytesPerS: Math.round((c.bytes - b0) / windowS),
    frameKinds: c.kinds,
    levelShapes: levels,
    unsortedFrames: all.reduce((n, t) => n + t.unsorted, 0),
    versionBackwards: all.reduce((n, t) => n + t.versionBackwards, 0),
    medianInterFrameMsPerSymbol: { min: medGap[0], med: medGap[Math.floor(medGap.length / 2)], max: medGap[medGap.length - 1] },
    maxInterFrameMsPerSymbol: { min: maxGap[0], med: maxGap[Math.floor(maxGap.length / 2)], max: maxGap[maxGap.length - 1] },
    btc: per.get('BTC_USDT') ? { frames: per.get('BTC_USDT').frames, medGapMs: [...per.get('BTC_USDT').gaps].sort((x, y) => x - y)[Math.floor(per.get('BTC_USDT').gaps.length / 2)] } : null,
    pongs: c.pongs.length,
    closed: c.closed,
  });
}

async function channelsPhase() {
  const results = {};
  const record = (name) => (j, now, d, wireBytes) => {
    const r = (results[name] ??= { frames: 0, kinds: {}, channels: {}, samples: {}, tickersRows: [] });
    r.frames++;
    r.kinds[d.kind] = (r.kinds[d.kind] ?? 0) + 1;
    const key = `${j.channel} ${j.symbol ?? ''}`.trim();
    r.channels[key] = (r.channels[key] ?? 0) + 1;
    if (j.channel === 'push.tickers') r.tickersRows.push({ rows: j.data.length, wireBytes, hasFundingRate: j.data.some((x) => 'fundingRate' in x) });
    const list = (r.samples[key] ??= []);
    if (list.length < 2 && j.channel !== 'pong') list.push({ wireBytes, kind: d.kind, text: d.text.slice(0, 600) });
  };
  const a = open('channels-default', record('default gzip param absent'), { log: 40 });
  const b = open('channels-gzip-false', record('gzip false'), { log: 40 });
  await Promise.all([a.ready, b.ready]);
  a.send({ method: 'sub.tickers', param: {} });
  b.send({ method: 'sub.tickers', param: {}, gzip: false });
  for (const [c, extra] of [[a, {}], [b, { gzip: false }]]) {
    c.send({ method: 'sub.ticker', param: { symbol: 'BTC_USDT' }, ...extra });
    c.send({ method: 'sub.funding.rate', param: { symbol: 'BTC_USDT' }, ...extra });
    c.send({ method: 'sub.index.price', param: { symbol: 'BTC_USDT' }, ...extra });
    c.send({ method: 'sub.fair.price', param: { symbol: 'BTC_USDT' }, ...extra });
    c.send({ method: 'sub.index.price', param: { symbol: 'BTC_USD' }, ...extra });
    c.send({ method: 'sub.deal', param: { symbol: 'BTC_USDT' }, ...extra });
  }
  await sleep(25_000);
  a.close();
  b.close();

  // The documented host moved to api.mexc.com for REST, so the same path there is tried once and its answer recorded.
  const alt = await new Promise((resolve) => {
    const ws = new WebSocket('wss://api.mexc.com/edge', { perMessageDeflate: false });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ result: 'no open within 8 s' });
    }, 8000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve({ result: 'opened' });
    });
    ws.on('unexpected-response', (req, res) => {
      clearTimeout(timer);
      resolve({ result: 'http', status: res.statusCode });
      req.destroy();
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      resolve({ result: 'error', message: e.message });
    });
  });
  await sleep(500);
  print('channels', { windowS: 25, results, apiHostEdge: alt });
}

// The gzip knob turned on, plus replies to a wrong limit, an unknown method and a repeated subscribe.
async function gzipPhase() {
  const r = { frames: 0, kinds: {}, channels: {}, samples: {} };
  const c = open('gzip-true', (j, now, d, wireBytes) => {
    const key = `${j.channel} ${j.symbol ?? ''}`.trim();
    r.channels[key] = (r.channels[key] ?? 0) + 1;
    const list = (r.samples[key] ??= []);
    if (list.length < 1) list.push({ wireBytes, kind: d.kind, text: d.text.slice(0, 300) });
  }, { log: 40 });
  await c.ready;
  c.send({ method: 'sub.tickers', param: {}, gzip: true });
  c.send({ method: 'sub.depth', param: { symbol: 'BTC_USDT' }, gzip: true });
  c.send({ method: 'sub.deal', param: { symbol: 'BTC_USDT' }, gzip: true });
  c.send({ method: 'sub.depth.full', param: { symbol: 'ETH_USDT', limit: 50 } });
  c.send({ method: 'sub.nope', param: { symbol: 'BTC_USDT' } });
  await sleep(2_000);
  c.send({ method: 'sub.depth', param: { symbol: 'BTC_USDT' } });
  await sleep(10_000);
  c.close();
  await sleep(500);
  print('gzip', { frames: c.frames, frameKinds: c.kinds, channels: r.channels, samples: r.samples, closed: c.closed });
}

const tasks = [];
if (want('gzip')) tasks.push(gzipPhase());
if (want('small')) tasks.push(smallPhase());
if (want('silence')) tasks.push(silencePhase());
await Promise.all(tasks);
if (want('batch')) await batchPhase();
if (want('batchfull')) await batchFullPhase();
if (want('channels')) await channelsPhase();
process.exit(0);
