// BitTrade public WebSocket probe: book channels, sequence chain and level order, size unit, heartbeat, silence, errors, and every online pair on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, and every frame arrives gzip compressed inside a binary frame.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bittrade/ws-probe.mjs [book|batch|silence|deflate]
//   book     depth.step0 on five pairs, mbp.150 with req snapshots on three, mbp.5, mbp.20, mbp.refresh.20 and bbo on btcjpy, mbp.refresh.20 on batjpy, an error socket, for 75 s, then a REST book compare and the depth version against the mbp seqNum.
//   batch    every online pair on mbp.150 with req snapshots paced at 10 a second on one socket, and on depth.step0 on a second socket, for 60 s. Add 'burst' to send every req at once.
//   silence  five sockets that differ only in what the client subscribes and answers, for up to 90 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/bittrade/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://api-cloud.bittrade.co.jp/ws';
const API = 'https://api-cloud.bittrade.co.jp';
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

const gz = { frames: 0, bytesIn: 0, bytesOut: 0, gunzipNs: 0n, parseNs: 0n, text: 0 };

function decode(raw, isBinary) {
  gz.frames++;
  gz.bytesIn += raw.length;
  let text;
  if (isBinary) {
    const a = process.hrtime.bigint();
    text = gunzipSync(raw).toString('utf8');
    gz.gunzipNs += process.hrtime.bigint() - a;
  } else {
    gz.text++;
    text = raw.toString('utf8');
  }
  gz.bytesOut += text.length;
  const b = process.hrtime.bigint();
  const msg = JSON.parse(text);
  gz.parseNs += process.hrtime.bigint() - b;
  return { msg, text };
}

function open(name, { pong = true, deflate = false, onMsg } = {}) {
  const ws = new WebSocket(URL_WS, { perMessageDeflate: deflate });
  const st = { name, ws, openMs: undefined, pings: [], closed: undefined, created: Date.now() };
  ws.on('open', () => {
    st.openMs = Date.now() - st.created;
    log('open', { name, ms: st.openMs, extensions: ws.extensions });
  });
  ws.on('message', (raw, isBinary) => {
    const { msg, text } = decode(raw, isBinary);
    if (msg.ping !== undefined) {
      st.pings.push(Date.now());
      if (st.pings.length === 1) capture(`${name}.txt`, text);
      if (pong) ws.send(JSON.stringify({ pong: msg.ping }));
      return;
    }
    onMsg?.(msg, text, st);
  });
  ws.on('close', (code, reason) => {
    st.closed = { atMs: Date.now() - st.created, code, reason: reason.toString() };
    log('close', { name, ...st.closed, pings: st.pings.length });
  });
  ws.on('error', (e) => log('error', { name, message: e.message }));
  st.ready = new Promise((r) => ws.once('open', r));
  return st;
}

function pingGaps(st) {
  const g = [];
  for (let i = 1; i < st.pings.length; i++) g.push(st.pings[i] - st.pings[i - 1]);
  return g;
}

const isDesc = (s) => s.every((l, i) => i === 0 || l[0] < s[i - 1][0]);
const isAsc = (s) => s.every((l, i) => i === 0 || l[0] > s[i - 1][0]);

async function restDepth(symbol) {
  const r = await fetch(`${API}/market/depth?symbol=${symbol}&type=step0`);
  return (await r.json()).tick;
}

// A local book kept from an mbp snapshot and its deltas.
function mbpTracker() {
  const streams = new Map();
  const get = (ch) => {
    if (!streams.has(ch)) streams.set(ch, { snap: 0, snapSeq: undefined, deltas: 0, beforeSnap: 0, chained: 0, gaps: 0, stale: 0, lastSeq: undefined, bids: new Map(), asks: new Map(), maxBids: 0, maxAsks: 0, unorderedBids: 0, unorderedAsks: 0, emptyDeltas: 0, firstDeltaAfterSnap: undefined, zeroSizesInSnap: 0 });
    return streams.get(ch);
  };
  return {
    streams,
    snapshot(ch, data) {
      const s = get(ch);
      if (s.snap > 0) {
        // A later snapshot is compared with the local book instead of replacing it.
        const top = (m, dir) => [...m.entries()].sort((x, y) => dir * (y[0] - x[0])).slice(0, 20);
        const lb = new Map(top(s.bids, 1));
        const la = new Map(top(s.asks, -1));
        s.laterSnaps = s.laterSnaps ?? [];
        s.laterSnaps.push({ snapSeq: data.seqNum, localSeq: s.lastSeq, top20BidsSame: data.bids.slice(0, 20).filter(([p, q]) => lb.get(p) === q).length, top20AsksSame: data.asks.slice(0, 20).filter(([p, q]) => la.get(p) === q).length });
        return;
      }
      s.snap++;
      s.snapSeq = data.seqNum;
      s.bids = new Map(data.bids.map(([p, q]) => [p, q]));
      s.asks = new Map(data.asks.map(([p, q]) => [p, q]));
      s.zeroSizesInSnap += data.bids.filter((l) => l[1] === 0).length + data.asks.filter((l) => l[1] === 0).length;
      s.snapOrder = { bidsDesc: isDesc(data.bids), asksAsc: isAsc(data.asks), bids: data.bids.length, asks: data.asks.length };
      s.pendingAlign = true;
      s.lastSeq = data.seqNum;
      // Deltas cached before the snapshot are replayed through the same path.
      const cached = s.cache ?? [];
      s.cache = [];
      s.replayed = cached.length;
      for (const t of cached) this.delta(ch, t, true);
    },
    delta(ch, tick, replay = false) {
      const s = get(ch);
      if (!replay) s.deltas++;
      if ((tick.bids?.length ?? 0) + (tick.asks?.length ?? 0) === 0) s.emptyDeltas++;
      if (tick.bids && tick.bids.length > 1 && !isDesc(tick.bids)) s.unorderedBids++;
      if (tick.asks && tick.asks.length > 1 && !isAsc(tick.asks)) s.unorderedAsks++;
      if (s.snapSeq === undefined) {
        s.beforeSnap++;
        s.cache = s.cache ?? [];
        if (s.cache.length < 2000) s.cache.push(tick);
        if (s.lastSeq !== undefined) {
          if (tick.prevSeqNum === s.lastSeq) s.preChained = (s.preChained ?? 0) + 1;
          else s.preGaps = (s.preGaps ?? 0) + 1;
        }
        s.lastSeq = tick.seqNum;
        return;
      }
      if (s.pendingAlign) {
        if (tick.seqNum <= s.snapSeq) {
          s.stale++;
          return;
        }
        s.firstDeltaAfterSnap = { snapSeq: s.snapSeq, prevSeqNum: tick.prevSeqNum, seqNum: tick.seqNum };
        s.pendingAlign = false;
      }
      if (tick.prevSeqNum === s.lastSeq) s.chained++;
      else {
        s.gaps++;
        s.firstGap = s.firstGap ?? { lastSeq: s.lastSeq, prevSeqNum: tick.prevSeqNum, seqNum: tick.seqNum, replay, snapSeq: s.snapSeq };
      }
      s.lastSeq = tick.seqNum;
      const step = tick.seqNum - tick.prevSeqNum;
      s.stepMin = Math.min(s.stepMin ?? step, step);
      s.stepMax = Math.max(s.stepMax ?? step, step);
      for (const [p, q] of tick.bids ?? []) q === 0 ? s.bids.delete(p) : s.bids.set(p, q);
      for (const [p, q] of tick.asks ?? []) q === 0 ? s.asks.delete(p) : s.asks.set(p, q);
      s.maxBids = Math.max(s.maxBids, s.bids.size);
      s.maxAsks = Math.max(s.maxAsks, s.asks.size);
    },
    summary(ch) {
      const s = get(ch);
      const { bids, asks, pendingAlign, cache, ...rest } = s;
      return { ch, ...rest, bidsNow: bids.size, asksNow: asks.size };
    },
    top(ch, n) {
      const s = get(ch);
      return {
        bids: [...s.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, n),
        asks: [...s.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, n),
      };
    },
  };
}

async function book() {
  const DEPTH_PAIRS = ['btcjpy', 'ethjpy', 'xrpjpy', 'batjpy', 'soljpy'];
  const depthVersions = [];
  const mbpSeqs = new Set();
  const MBP_PAIRS = ['btcjpy', 'ethjpy', 'batjpy'];
  const depth = new Map();
  const acks = [];

  const a = open('depth', {
    onMsg: (msg, text) => {
      if (msg.subbed || msg.status) {
        acks.push({ sock: 'depth', since: since(), ...msg });
        capture('depth.txt', text);
        return;
      }
      if (!msg.ch) return;
      const s = depth.get(msg.ch) ?? { frames: 0, first: undefined, last: undefined, gaps: [], levels: [], order: 0, disorder: 0, repeats: 0, lastKey: undefined, keys: undefined, ageMs: [] };
      depth.set(msg.ch, s);
      const now = Date.now();
      if (s.frames === 0) {
        s.first = now - subAt;
        s.keys = { env: Object.keys(msg), tick: Object.keys(msg.tick ?? {}) };
        capture('depth.txt', text);
      } else s.gaps.push(now - s.last);
      s.frames++;
      s.last = now;
      const t = msg.tick;
      s.levels.push([t.bids?.length ?? 0, t.asks?.length ?? 0]);
      if (isDesc(t.bids ?? []) && isAsc(t.asks ?? [])) s.order++;
      else s.disorder++;
      const key = JSON.stringify([t.bids?.slice(0, 150), t.asks?.slice(0, 150)]);
      if (key === s.lastKey) s.repeats++;
      s.lastKey = key;
      if (t.ts) s.ageMs.push(now - t.ts);
      if (s.frames === 1) s.version = t.version;
      if (msg.ch === 'market.btcjpy.depth.step0') depthVersions.push(t.version);
    },
  });

  const mbp = mbpTracker();
  const mbpMeta = new Map();
  let reqAt;
  const b = open('mbp', {
    onMsg: (msg, text) => {
      if (msg.subbed || (msg.status && !msg.rep)) {
        acks.push({ sock: 'mbp', since: since(), ...msg });
        capture('mbp.txt', text);
        return;
      }
      if (msg.rep) {
        const m = mbpMeta.get(msg.rep) ?? {};
        m.snapMs = Date.now() - reqAt;
        m.snapKeys = { env: Object.keys(msg), data: Object.keys(msg.data ?? {}) };
        mbpMeta.set(msg.rep, m);
        capture('mbp.txt', text);
        if (msg.data) mbp.snapshot(msg.rep, msg.data);
        return;
      }
      if (!msg.ch) return;
      const m = mbpMeta.get(msg.ch) ?? { frames: 0, gapsMs: [] };
      mbpMeta.set(msg.ch, m);
      if (m.frames === 0) {
        m.firstMs = Date.now() - subAt;
        m.keys = { env: Object.keys(msg), tick: Object.keys(msg.tick ?? {}) };
        capture('mbp.txt', text);
      } else m.gapsMs.push(Date.now() - m.last);
      m.last = Date.now();
      m.frames++;
      if (m.frames === 3 || m.frames === 50) capture('mbp.txt', text);
      if (msg.ch.includes('.refresh.')) {
        m.levels = [msg.tick?.bids?.length, msg.tick?.asks?.length];
        m.seq = msg.tick?.seqNum;
        m.lastTick = msg.tick;
        m.seqRepeats = (m.seqRepeats ?? 0) + (m.prevSeq === msg.tick?.seqNum ? 1 : 0);
        m.prevSeq = msg.tick?.seqNum;
        return;
      }
      if (msg.ch.includes('.bbo')) return;
      if (msg.ch === 'market.btcjpy.mbp.150') mbpSeqs.add(msg.tick.seqNum);
      mbp.delta(msg.ch, msg.tick);
    },
  });

  const errs = [];
  const c = open('errors', {
    onMsg: (msg, text) => {
      errs.push({ since: since(), text: text.slice(0, 300) });
      capture('errors.txt', text);
    },
  });

  await Promise.all([a.ready, b.ready, c.ready]);
  const subAt = Date.now();
  for (const p of DEPTH_PAIRS) a.ws.send(JSON.stringify({ sub: `market.${p}.depth.step0`, id: `d-${p}` }));
  for (const p of MBP_PAIRS) b.ws.send(JSON.stringify({ sub: `market.${p}.mbp.150`, id: `m-${p}` }));
  for (const t of ['market.btcjpy.mbp.5', 'market.btcjpy.mbp.20', 'market.btcjpy.mbp.refresh.20', 'market.batjpy.mbp.refresh.20', 'market.btcjpy.bbo']) b.ws.send(JSON.stringify({ sub: t, id: t }));

  // Errors and edge cases on their own socket.
  const tests = [
    { sub: 'market.nopejpy.depth.step0', id: 'e1' },
    { sub: 'market.nopejpy.mbp.150', id: 'e2' },
    { sub: 'market.btcjpy.depth.step9', id: 'e3' },
    { sub: 'market.btcjpy.mbp.30', id: 'e4' },
    { sub: 'market.adaeth.depth.step0', id: 'e5' },
    { sub: 'market.btcjpy.nope', id: 'e6' },
    { unsub: 'market.btcjpy.trade.detail', id: 'e7' },
    { sub: 'market.batjpy.depth.step0', id: 'e8a' },
    { sub: 'market.batjpy.depth.step0', id: 'e8b' },
    { req: 'market.nopejpy.mbp.150', id: 'e9' },
    { ping: 'abc' },
    { sub: 'market.tonjpy.mbp.150', id: 'e11-suspend' },
    { sub: 'market.mvjpy.depth.step0', id: 'e12-offline' },
    { sub: 'market.btcjpy.depth.step0', id: 'e10', 'freq-ms': 1000 },
  ];
  for (const f of tests) c.ws.send(JSON.stringify(f));
  c.ws.send('not json');
  const pingSentAt = Date.now();
  c.ws.send(JSON.stringify({ ping: pingSentAt }));

  await sleep(2000);
  reqAt = Date.now();
  for (const p of MBP_PAIRS) b.ws.send(JSON.stringify({ req: `market.${p}.mbp.150`, id: `r-${p}` }));

  // A second req later tests whether a snapshot mid stream still aligns with the chain.
  await sleep(33000);
  reqAt = Date.now();
  b.ws.send(JSON.stringify({ req: 'market.btcjpy.mbp.150', id: 'r2-btcjpy' }));
  await sleep(38000);

  const rest = await restDepth('btcjpy');
  const local = mbp.top('market.btcjpy.mbp.150', 20);
  const restBid = new Map(rest.bids.slice(0, 40));
  const restAsk = new Map(rest.asks.slice(0, 40));
  const sameBid = local.bids.filter(([p, q]) => restBid.get(p) === q).length;
  const sameAsk = local.asks.filter(([p, q]) => restAsk.get(p) === q).length;
  log('rest_compare_btcjpy', { top20SameBids: sameBid, top20SameAsks: sameAsk, localTop: [local.bids[0], local.asks[0]], restTop: [rest.bids[0], rest.asks[0]], restVersion: rest.version });

  const lastMbp = Math.max(...mbpSeqs);
  const judged = depthVersions.filter((v) => v <= lastMbp);
  log('depth_version_vs_mbp_seq', { depthFrames: depthVersions.length, judged: judged.length, versionIsAnMbpSeqNum: judged.filter((v) => mbpSeqs.has(v)).length, first: depthVersions[0], mbpSeqRange: [Math.min(...mbpSeqs), lastMbp] });
  // The last refresh.20 frame against the local mbp.150 book, read at the same instant.
  const rf = mbpMeta.get('market.btcjpy.mbp.refresh.20')?.lastTick;
  if (rf) {
    const loc = mbp.top('market.btcjpy.mbp.150', 20);
    const same = (a, b) => a.filter(([p, q], i) => b[i] && b[i][0] === p && b[i][1] === q).length;
    log('refresh20_vs_mbp150', { refreshSeq: rf.seqNum, mbpSeq: mbp.streams.get('market.btcjpy.mbp.150')?.lastSeq, bidsSame: same(rf.bids, loc.bids), asksSame: same(rf.asks, loc.asks) });
  }
  for (const [ch, s] of depth) {
    const g = s.gaps.sort((x, y) => x - y);
    const ages = s.ageMs.sort((x, y) => x - y);
    const lv = s.levels;
    log('depth_stream', { ch, frames: s.frames, firstMs: s.first, gapMin: g[0], gapMedian: g[Math.floor(g.length / 2)], gapMax: g[g.length - 1], levelsMin: [Math.min(...lv.map((l) => l[0])), Math.min(...lv.map((l) => l[1]))], levelsMax: [Math.max(...lv.map((l) => l[0])), Math.max(...lv.map((l) => l[1]))], ordered: s.order, disordered: s.disorder, identicalRepeats: s.repeats, tickTsAgeMedian: ages[Math.floor(ages.length / 2)], tickTsAgeMax: ages[ages.length - 1], keys: s.keys, version: s.version });
  }
  for (const [ch, m] of mbpMeta) {
    const g = (m.gapsMs ?? []).sort((x, y) => x - y);
    log('mbp_meta', { ch, frames: m.frames, firstMs: m.firstMs, snapMs: m.snapMs, gapMin: g[0], gapMedian: g[Math.floor(g.length / 2)], gapMax: g[g.length - 1], keys: m.keys, snapKeys: m.snapKeys, levels: m.levels, seqRepeats: m.seqRepeats });
  }
  for (const ch of mbp.streams.keys()) log('mbp_chain', mbp.summary(ch));
  log('acks', { acks: acks.map((x) => JSON.stringify(x).slice(0, 200)) });
  log('errors', { errs });
  for (const s of [a, b, c]) log('pings', { name: s.name, count: s.pings.length, gaps: pingGaps(s) });
  log('gzip', { frames: gz.frames, textFrames: gz.text, bytesIn: gz.bytesIn, bytesOut: gz.bytesOut, gunzipUsPerFrame: Number(gz.gunzipNs / 1000n) / gz.frames, parseUsPerFrame: Number(gz.parseNs / 1000n) / gz.frames });
  for (const s of [a, b, c]) s.ws.terminate();
}

async function batch(burst = false) {
  const r = await fetch(`${API}/v1/common/symbols`);
  const pairs = (await r.json()).data.filter((x) => x.state === 'online').map((x) => x.symbol);
  const mbp = mbpTracker();
  const perSec = new Map();
  let frames = 0;
  const firstSnap = new Map();
  let reqAt;
  const acked = { mbp: 0, depth: 0 };
  const m = open('batch-mbp', {
    onMsg: (msg) => {
      if (msg.subbed) acked.mbp++;
      frames++;
      const sec = Math.floor(since() / 1000);
      perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
      if (msg.rep && msg.data) {
        firstSnap.set(msg.rep, Date.now() - reqAt);
        mbp.snapshot(msg.rep, msg.data);
      } else if (msg.ch && msg.tick) mbp.delta(msg.ch, msg.tick);
      else if (msg.status === 'error' && !String(msg['err-msg']).startsWith('429')) log('batch_error', { msg });
    },
  });
  const d = open('batch-depth', {
    onMsg: (msg, text, st) => {
      if (msg.subbed) acked.depth++;
      st.frames = (st.frames ?? 0) + 1;
      if (msg.status === 'error') log('batch_error', { msg });
    },
  });
  await Promise.all([m.ready, d.ready]);
  const g0 = { ...gz };
  const start = Date.now();
  for (const p of pairs) m.ws.send(JSON.stringify({ sub: `market.${p}.mbp.150`, id: `s-${p}` }));
  for (const p of pairs) d.ws.send(JSON.stringify({ sub: `market.${p}.depth.step0`, id: `d-${p}` }));
  await sleep(1500);
  reqAt = Date.now();
  // A burst of 45 req frames got 21 refusals with 429 on 2026-09-23, so the default paces them at 10 a second.
  let refused = 0;
  m.ws.on('message', (raw) => {
    const t = gunzipSync(raw).toString('utf8');
    if (t.includes('429 too many request')) refused++;
  });
  for (const p of pairs) {
    m.ws.send(JSON.stringify({ req: `market.${p}.mbp.150`, id: `r-${p}` }));
    if (!burst) await sleep(100);
  }
  await sleep(58500 - (burst ? 0 : pairs.length * 100));
  const secs = Math.round((Date.now() - start) / 1000);
  const counts = [...perSec.values()].sort((x, y) => x - y);
  let gaps = 0;
  let chained = 0;
  let stale = 0;
  let maxLevels = 0;
  let stepMin = Infinity;
  let stepMax = 0;
  for (const ch of mbp.streams.keys()) {
    const s = mbp.summary(ch);
    if (s.stepMin !== undefined) stepMin = Math.min(stepMin, s.stepMin);
    if (s.stepMax !== undefined) stepMax = Math.max(stepMax, s.stepMax);
    gaps += s.gaps;
    chained += s.chained;
    stale += s.stale;
    maxLevels = Math.max(maxLevels, s.maxBids, s.maxAsks);
  }
  const snapTimes = [...firstSnap.values()].sort((x, y) => x - y);
  log('batch', {
    pairs: pairs.length,
    secs,
    mbpFrames: frames,
    mbpFramesPerSecMedian: counts[Math.floor(counts.length / 2)],
    mbpFramesPerSecMax: counts[counts.length - 1],
    acked,
    reqMode: burst ? 'burst' : 'paced 100 ms',
    snapshots: firstSnap.size,
    refused429: refused,
    snapMsMin: snapTimes[0],
    snapMsMax: snapTimes[snapTimes.length - 1],
    chained,
    gaps,
    staleDropped: stale,
    maxLevels,
    seqStep: [stepMin, stepMax],
    depthFrames: d.frames,
    depthFramesPerSec: +(d.frames / secs).toFixed(1),
    gzBytesInPerSec: Math.round((gz.bytesIn - g0.bytesIn) / secs),
    jsonBytesPerSec: Math.round((gz.bytesOut - g0.bytesOut) / secs),
    gunzipUsPerFrame: +(Number(gz.gunzipNs / 1000n) / gz.frames).toFixed(1),
    parseUsPerFrame: +(Number(gz.parseNs / 1000n) / gz.frames).toFixed(1),
  });
  for (const ch of ['market.btcjpy.mbp.150', 'market.xrpjpy.mbp.150', 'market.soljpy.mbp.150']) log('batch_stream', mbp.summary(ch));
  for (const ch of mbp.streams.keys()) {
    const s = mbp.summary(ch);
    if (s.gaps > 0 || s.snap === 0) log('batch_odd_stream', { ch, snap: s.snap, deltas: s.deltas, gaps: s.gaps, firstGap: s.firstGap, stale: s.stale, replayed: s.replayed });
  }
  const noDelta = pairs.filter((p) => !mbp.streams.has(`market.${p}.mbp.150`));
  log('batch_silent_pairs', { count: noDelta.length, pairs: noDelta });
  m.ws.terminate();
  d.ws.terminate();
}

async function silence() {
  const sockets = [
    open('sub-pong', { pong: true }),
    open('sub-nopong', { pong: false }),
    open('nosub-pong', { pong: true }),
    open('nosub-nopong', { pong: false }),
    open('nosub-nopong-clientping', { pong: false }),
  ];
  await Promise.all(sockets.map((s) => s.ready));
  sockets[0].ws.send(JSON.stringify({ sub: 'market.btcjpy.bbo', id: 'a' }));
  sockets[1].ws.send(JSON.stringify({ sub: 'market.btcjpy.bbo', id: 'b' }));
  const clientPing = setInterval(() => {
    const s = sockets[4];
    if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ ping: Date.now() }));
  }, 5000);
  const end = Date.now() + 90000;
  while (Date.now() < end && sockets.some((s) => !s.closed)) await sleep(500);
  clearInterval(clientPing);
  for (const s of sockets) {
    log('silence', { name: s.name, closed: s.closed ?? 'open at 90 s', pings: s.pings.length, pingGaps: pingGaps(s) });
    s.ws.terminate();
  }
}

async function deflate() {
  const s = open('deflate', { deflate: true, pong: true });
  await s.ready;
  let first;
  s.ws.once('message', (raw, isBinary) => {
    first = { isBinary, bytes: raw.length, gzipMagic: raw[0] === 0x1f && raw[1] === 0x8b };
  });
  s.ws.send(JSON.stringify({ sub: 'market.btcjpy.bbo', id: 'x' }));
  await sleep(3000);
  log('deflate', { negotiated: s.ws.extensions, firstFrame: first });
  s.ws.terminate();
  const p = open('plain', { deflate: false, pong: true });
  await p.ready;
  p.ws.once('message', (raw, isBinary) => {
    first = { isBinary, bytes: raw.length, gzipMagic: raw[0] === 0x1f && raw[1] === 0x8b };
  });
  p.ws.send(JSON.stringify({ sub: 'market.btcjpy.bbo', id: 'y' }));
  await sleep(3000);
  log('plain', { negotiated: p.ws.extensions, firstFrame: first });
  p.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
await { book, batch, silence, deflate }[mode](process.argv[3] === 'burst');
log('done', { mode, secs: Math.round(since() / 1000) });
process.exit(0);
