// BTSE futures WebSocket probe: the OSS book channel, its sequence and level order, the size unit, symbol spellings, errors, a batch of every perpetual, keepalive, silence and compression.
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btse/ws-probe.mjs [book|batch|silence|deflate|main|spelling]
//   book     update:<symbol>_0 on four perpetuals plus spelling and error cases for 50 s, then a REST book compare. About 55 s.
//   batch    every perpetual over two sockets, 100 topics on one and the rest on the other, for 45 s.
//   silence  five sockets that differ only in endpoint, subscription and client ping, for up to 110 s.
//   deflate  asks for permessage-deflate on the OSS and the main endpoint and prints what the server negotiates.
//   main     the main futures endpoint with the trade topic and the book topics for 15 s.
//   spelling the CCXT spelling BTC-PERP-USDT alone, then beside the socket spelling, then unsubscribed, about 26 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/btse/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const OSS_URL = 'wss://ws.btse.com/ws/oss/futures';
const MAIN_URL = 'wss://ws.btse.com/ws/futures';
const V1 = 'https://api.btse.com/public-api/market/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 700) + '\n');
}

async function perpsByVolume() {
  const m = await (await fetch(`${V1}/markets?types=${encodeURIComponent('["FuturesPerpetual"]')}`)).json();
  const t = await (await fetch(`${V1}/ticker/24hr?types=${encodeURIComponent('["FuturesPerpetual"]')}`)).json();
  const vol = new Map(t.data.map((r) => [r.symbol, Number(r.volume)]));
  return m.data.symbols
    .map((s) => ({ v1: s.symbol, legacy: s.tradeCurrency, category: s.category, contractSize: Number(s.contractSize), volume: vol.get(s.symbol) ?? 0 }))
    .sort((a, b) => b.volume - a.volume);
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0, t0 }));
    ws.once('error', reject);
  });
}

// One book per topic, kept from the snapshot and every delta, with the checks a feed would make.
function newTopicState() {
  return {
    frames: 0, snapshots: 0, deltas: 0, emptyDeltas: 0, gaps: 0, stepNot1: 0, firstDeltaChains: null,
    lastSeq: null, bids: new Map(), asks: new Map(), maxBids: 0, maxAsks: 0, snapBids: [], snapAsks: [],
    crossed: 0, deltaBidsUnordered: 0, deltaAsksUnordered: 0, deltaAsksAscending: 0, deltaAsksDescending: 0,
    snapBidsDesc: null, snapAsksAsc: null, snapAsksDesc: null, ages: [], lastAt: null, maxGapMs: 0, symbols: new Set(),
    zeroSizes: 0, types: new Set(), stringPrices: true, beforeSnapshot: 0, gapDetails: [], crossedBeforeGap: 0, prevAt: null,
  };
}

const isDesc = (xs) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) > Number(x[0]));
const isAsc = (xs) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) < Number(x[0]));

function applyBook(st, d, now) {
  st.frames++;
  st.symbols.add(d.symbol);
  st.types.add(d.type);
  if (typeof d.timestamp === 'number') {
    st.ages.push(now - d.timestamp);
    if (st.firstAgeMs === undefined) st.firstAgeMs = now - d.timestamp;
    else st.laterMaxAgeMs = Math.max(st.laterMaxAgeMs ?? 0, now - d.timestamp);
  }
  if (st.lastAt !== null) st.maxGapMs = Math.max(st.maxGapMs, now - st.lastAt);
  st.prevAt = st.lastAt;
  st.lastAt = now;
  for (const l of [...(d.bids ?? []), ...(d.asks ?? [])]) {
    if (typeof l[0] !== 'string' || typeof l[1] !== 'string') st.stringPrices = false;
  }
  if (d.type === 'snapshot') {
    st.snapshots++;
    st.bids.clear();
    st.asks.clear();
    for (const [p, s] of d.bids) st.bids.set(p, s);
    for (const [p, s] of d.asks) st.asks.set(p, s);
    if (st.snapshots === 1) {
      st.snapBids = d.bids;
      st.snapAsks = d.asks;
      st.snapBidsDesc = isDesc(d.bids);
      st.snapAsksAsc = isAsc(d.asks);
      st.snapAsksDesc = isDesc(d.asks);
    }
    st.lastSeq = d.seqNum;
    st.snapSeq = d.seqNum;
    st.snapPrev = d.prevSeqNum;
  } else {
    st.deltas++;
    if (st.lastSeq === null) {
      st.beforeSnapshot++;
      return;
    }
    if (st.firstDeltaChains === null) st.firstDeltaChains = d.prevSeqNum === st.lastSeq;
    if (d.prevSeqNum !== st.lastSeq) {
      st.gaps++;
      // After a gap the local book is no longer trusted, so crossing counts only before the first gap.
      if (st.gapDetails.length < 5) st.gapDetails.push({ lastSeq: st.lastSeq, prevSeqNum: d.prevSeqNum, seqNum: d.seqNum, jump: d.prevSeqNum - st.lastSeq, sinceLastFrameMs: now - (st.prevAt ?? now), levels: (d.bids?.length ?? 0) + (d.asks?.length ?? 0) });
    }
    if (d.seqNum !== d.prevSeqNum + 1) st.stepNot1++;
    st.lastSeq = d.seqNum;
    if (!d.bids?.length && !d.asks?.length) st.emptyDeltas++;
    if (d.bids?.length > 1 && !isDesc(d.bids)) st.deltaBidsUnordered++;
    if (d.asks?.length > 1) {
      if (isAsc(d.asks)) st.deltaAsksAscending++;
      else if (isDesc(d.asks)) st.deltaAsksDescending++;
      else st.deltaAsksUnordered++;
    }
    for (const [p, s] of d.bids ?? []) {
      if (Number(s) === 0) {
        st.zeroSizes++;
        st.bids.delete(p);
      } else st.bids.set(p, s);
    }
    for (const [p, s] of d.asks ?? []) {
      if (Number(s) === 0) {
        st.zeroSizes++;
        st.asks.delete(p);
      } else st.asks.set(p, s);
    }
  }
  st.maxBids = Math.max(st.maxBids, st.bids.size);
  st.maxAsks = Math.max(st.maxAsks, st.asks.size);
  const bb = Math.max(...[...st.bids.keys()].map(Number));
  const ba = Math.min(...[...st.asks.keys()].map(Number));
  if (st.bids.size && st.asks.size && bb >= ba) {
    st.crossed++;
    if (st.gaps === 0) st.crossedBeforeGap++;
  }
}

function report(topic, st) {
  return {
    topic,
    frames: st.frames,
    snapshots: st.snapshots,
    snapSeq: st.snapSeq,
    snapPrev: st.snapPrev,
    snapLevels: [st.snapBids.length, st.snapAsks.length],
    snapBidsDesc: st.snapBidsDesc,
    snapAsksAsc: st.snapAsksAsc,
    snapAsksDesc: st.snapAsksDesc,
    deltas: st.deltas,
    beforeSnapshot: st.beforeSnapshot,
    firstDeltaChains: st.firstDeltaChains,
    gaps: st.gaps,
    stepNot1: st.stepNot1,
    emptyDeltas: st.emptyDeltas,
    zeroSizes: st.zeroSizes,
    deltaAsks: { ascending: st.deltaAsksAscending, descending: st.deltaAsksDescending, unordered: st.deltaAsksUnordered },
    deltaBidsNotDescending: st.deltaBidsUnordered,
    maxLevels: [st.maxBids, st.maxAsks],
    endLevels: [st.bids.size, st.asks.size],
    crossedAfterApply: st.crossed,
    crossedBeforeGap: st.crossedBeforeGap,
    gapDetails: st.gapDetails,
    symbols: [...st.symbols],
    types: [...st.types],
    stringLevels: st.stringPrices,
    ageMs: { median: pct(st.ages, 50), p90: pct(st.ages, 90), max: st.ages.length ? Math.max(...st.ages) : null, first: st.firstAgeMs, maxAfterFirst: st.laterMaxAgeMs ?? null },
    maxGapMs: st.maxGapMs,
  };
}

// Book frames are stored with the first three levels per side, so a capture stays small and still parses.
function trimmed(j) {
  const d = { ...j.data };
  if (Array.isArray(d.bids)) d.bids = d.bids.slice(0, 3);
  if (Array.isArray(d.asks)) d.asks = d.asks.slice(0, 3);
  return JSON.stringify({ topic: j.topic, data: d, levelsOnWire: [j.data.bids?.length, j.data.asks?.length] });
}

function route(frame, states, other, now, file) {
  let j;
  try {
    j = JSON.parse(frame);
  } catch {
    other.push({ at: now, text: frame.slice(0, 120) });
    capture(file, `${now} TEXT ${frame}`);
    return;
  }
  if (j.topic && j.data && states.has(j.topic)) {
    const st = states.get(j.topic);
    if (st.frames < 4) capture(file, `${now} ${trimmed(j)}`);
    applyBook(st, j.data, now);
    return;
  }
  if (j.topic && j.data) {
    const st = newTopicState();
    states.set(j.topic, st);
    capture(file, `${now} ${trimmed(j)}`);
    applyBook(st, j.data, now);
    return;
  }
  other.push({ at: now, text: j.event ? frame : frame.slice(0, 400) });
  capture(file, `${now} ${frame}`);
}

async function book() {
  const perps = await perpsByVolume();
  const crypto = perps.filter((p) => p.category === 'CRYPTO');
  const quiet = crypto.at(-1);
  const stock = perps.find((p) => p.category === 'STOCK');
  const picks = [perps.find((p) => p.legacy === 'BTC-PERP'), perps.find((p) => p.legacy === 'ETH-PERP'), quiet, stock];
  log('book_picks', { picks: picks.map((p) => `${p.legacy} cs=${p.contractSize} vol=${Math.round(p.volume)}`) });

  const { ws, openMs, t0 } = await open(OSS_URL);
  log('open', { url: OSS_URL, openMs, extensions: ws.extensions });
  const states = new Map();
  const other = [];
  const pongs = [];
  let pingSentAt = 0;
  let serverPings = 0;
  ws.on('ping', () => serverPings++);
  ws.on('message', (data) => {
    const now = Date.now();
    const text = data.toString();
    if (text === 'pong') {
      pongs.push(now - pingSentAt);
      return;
    }
    route(text, states, other, now, 'book.txt');
  });
  let closed = null;
  ws.on('close', (code) => (closed = { code, atMs: Date.now() - t0 }));

  const main = [...picks.map((p) => `update:${p.legacy}_0`), 'update:BTC-PERP-USDT_0', 'update:ETH-PERP-USDT_0', 'snapshotL1:ETH-PERP', 'snapshotL1:ETH-PERP_0'];
  ws.send(JSON.stringify({ op: 'subscribe', args: main }));
  const ping = setInterval(() => {
    pingSentAt = Date.now();
    ws.send('ping');
  }, 15_000);
  await sleep(3000);
  const edge = ['update:NOPE-PERP_0', 'update:BTC-PERP_9', 'update:BTC-PERP_0', 'update:BTC-PERP', 'update:BTC-PERP_1', 'foo:BTC-PERP', 'update:BTC-260925_0', 'update:BTC-260925-USDT_0'];
  ws.send(JSON.stringify({ op: 'subscribe', args: edge }));
  await sleep(1500);
  // One malformed request a second, so each reply can be matched to its request by time.
  const malformed = [JSON.stringify({ op: 'nope', args: ['update:BTC-PERP_0'] }), 'hello', JSON.stringify({ op: 'subscribe' }), JSON.stringify({ op: 'unsubscribe', args: ['update:ETH-PERP-USDT_0'] })];
  for (const m of malformed) {
    log('sent', { at: Date.now(), frame: m });
    ws.send(m);
    await sleep(1000);
  }
  await sleep(41_500);
  clearInterval(ping);

  // Size unit: the socket book against the REST book for BTC, at the same prices.
  const btc = states.get(`update:BTC-PERP_0`);
  const rest = await (await fetch(`${V1}/orderbook?symbol=BTC-PERP-USDT&depth=50`)).json();
  let same = 0;
  let compared = 0;
  const restBids = new Map(rest.data.bids.map(([p, s]) => [Number(p), Number(s)]));
  const topBids = [...btc.bids.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 20);
  for (const [p, s] of topBids) {
    if (!restBids.has(Number(p))) continue;
    compared++;
    if (restBids.get(Number(p)) === Number(s)) same++;
  }
  log('size_unit_btc', { socketTopBid: topBids[0], restTopBid: rest.data.bids[0], comparedTop20Bids: compared, equalSize: same, contractSize: picks[0].contractSize, topBidCoins: Number(topBids[0][1]) * picks[0].contractSize });
  ws.terminate();

  for (const [topic, st] of states) log('topic', report(topic, st));
  const acked = other.filter((o) => o.text.includes('"event":"subscribe"')).flatMap((o) => JSON.parse(o.text).channel);
  log('acked_but_silent', { topics: acked.filter((t) => !states.has(t)) });
  log('other_frames', { n: other.length, frames: other.slice(0, 20) });
  log('keepalive', { pongRttMs: pongs, serverPings, closed });
}

async function batch() {
  const perps = await perpsByVolume();
  const sockets = [perps.slice(0, 100), perps.slice(100)];
  const results = [];
  await Promise.all(
    sockets.map(async (slice, k) => {
      const { ws, openMs } = await open(OSS_URL);
      const states = new Map();
      const other = [];
      let frames = 0;
      let bytes = 0;
      let parseNs = 0n;
      const perSecond = new Map();
      ws.on('message', (data) => {
        const now = Date.now();
        frames++;
        bytes += data.length;
        const sec = Math.floor(now / 1000);
        perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
        const text = data.toString();
        const a = process.hrtime.bigint();
        try {
          JSON.parse(text);
        } catch {}
        parseNs += process.hrtime.bigint() - a;
        if (text === 'pong') return;
        route(text, states, other, now, `batch${k}.txt`);
      });
      let closed = null;
      ws.on('close', (code) => (closed = code));
      const start = Date.now();
      ws.send(JSON.stringify({ op: 'subscribe', args: slice.map((p) => `update:${p.legacy}_0`) }));
      const ping = setInterval(() => ws.send('ping'), 15_000);
      await sleep(45_000);
      clearInterval(ping);
      const secs = (Date.now() - start) / 1000;
      ws.terminate();
      const st = [...states.values()];
      const rates = [...perSecond.values()].slice(1, -1);
      const acks = other.filter((o) => o.text.includes('"event":"subscribe"'));
      const ackTopics = acks.reduce((n, o) => {
        try {
          return n + JSON.parse(o.text).channel.length;
        } catch {
          return n;
        }
      }, 0);
      results.push({
        socket: k,
        openMs,
        topicsSent: slice.length,
        ackFrames: acks.length,
        ackTopicsParsed: ackTopics,
        ackSample: acks[0]?.text.slice(0, 160),
        errors: other.filter((o) => o.text.includes('ERROR')).map((o) => o.text.slice(0, 240)).slice(0, 3),
        topicsWithSnapshot: st.filter((s) => s.snapshots > 0).length,
        snapshotsTotal: st.reduce((n, s) => n + s.snapshots, 0),
        deltas: st.reduce((n, s) => n + s.deltas, 0),
        gaps: st.reduce((n, s) => n + s.gaps, 0),
        crossed: st.reduce((n, s) => n + s.crossed, 0),
        crossedBeforeGap: st.reduce((n, s) => n + s.crossedBeforeGap, 0),
        crossedTopics: [...states.entries()].filter(([, s]) => s.crossed > 0).map(([t, s]) => `${t}:${s.crossed}`).slice(0, 10),
        gapTopics: [...states.entries()].filter(([, s]) => s.gaps > 0).map(([t, s]) => ({ t, frames: s.frames, gaps: s.gaps, details: s.gapDetails.slice(0, 3) })),
        maxLevelsBeforeAnyGap: Math.max(...st.filter((s) => s.gaps === 0).map((s) => Math.max(s.maxBids, s.maxAsks))),
        framesPerSecond: { mean: Math.round(frames / secs), median: pct(rates, 50), max: rates.length ? Math.max(...rates) : null },
        kbPerSecond: Math.round(bytes / secs / 1024),
        bytesPerFrame: Math.round(bytes / frames),
        parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000,
        maxLevels: Math.max(...st.map((s) => Math.max(s.maxBids, s.maxAsks))),
        quietestMaxGapMs: Math.max(...st.map((s) => s.maxGapMs)),
        topicsUnder5Frames: st.filter((s) => s.frames < 5).length,
        closed,
      });
    }),
  );
  for (const r of results.sort((a, b) => a.socket - b.socket)) log('batch_socket', r);
}

async function silence() {
  const perps = await perpsByVolume();
  const quiet = perps.filter((p) => p.category === 'CRYPTO').at(-1).legacy;
  const cases = [
    { name: 'oss_nothing', url: OSS_URL, sub: null, ping: false },
    { name: 'oss_sub_quiet_no_ping', url: OSS_URL, sub: `update:${quiet}_0`, ping: false },
    { name: 'oss_sub_quiet_ping15', url: OSS_URL, sub: `update:${quiet}_0`, ping: true },
    { name: 'main_nothing', url: MAIN_URL, sub: null, ping: false },
    { name: 'main_ping15', url: MAIN_URL, sub: null, ping: true },
  ];
  const out = await Promise.all(
    cases.map(async (c) => {
      const { ws, t0 } = await open(c.url);
      const r = { name: c.name, frames: 0, lastFrameMs: null, serverPingsAtMs: [], closeCode: null, closeMs: null, pongs: 0, survived: false };
      ws.on('ping', () => r.serverPingsAtMs.push(Date.now() - t0));
      ws.on('message', (d) => {
        r.frames++;
        r.lastFrameMs = Date.now() - t0;
        if (d.toString() === 'pong') r.pongs++;
      });
      if (c.sub) ws.send(JSON.stringify({ op: 'subscribe', args: [c.sub] }));
      const ping = c.ping ? setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 15_000) : null;
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          r.survived = true;
          resolve();
        }, 110_000);
        ws.on('close', (code) => {
          if (r.survived) return;
          r.closeCode = code;
          r.closeMs = Date.now() - t0;
          clearTimeout(timer);
          resolve();
        });
      });
      if (ping) clearInterval(ping);
      ws.terminate();
      return r;
    }),
  );
  log('silence_quiet_topic', { quiet });
  for (const r of out) log('silence', r);
}

async function deflate() {
  for (const url of [OSS_URL, MAIN_URL]) {
    const ws = new WebSocket(url, { perMessageDeflate: true });
    const header = await new Promise((resolve) => {
      ws.once('upgrade', (res) => resolve(res.headers['sec-websocket-extensions'] ?? null));
      ws.once('error', (e) => resolve(`error ${e.message}`));
    });
    await new Promise((r) => (ws.readyState === ws.OPEN ? r() : ws.once('open', r)));
    log('deflate', { url, negotiated: header, extensions: ws.extensions });
    ws.terminate();
  }
}

async function mainEndpoint() {
  const { ws, openMs } = await open(MAIN_URL);
  const counts = {};
  const firsts = {};
  ws.on('message', (d) => {
    const t = d.toString();
    let k = 'text';
    try {
      const j = JSON.parse(t);
      k = j.topic ?? j.event ?? (j.severity ? 'error' : 'other');
    } catch {}
    counts[k] = (counts[k] ?? 0) + 1;
    if (!firsts[k]) firsts[k] = t.slice(0, 300);
    capture('main.txt', t);
  });
  ws.send(JSON.stringify({ op: 'subscribe', args: ['tradeHistoryApiV3:BTC-PERP', 'update:BTC-PERP_0', 'snapshotL1:BTC-PERP', 'tradeHistoryApiV3:BTC-PERP-USDT'] }));
  ws.send('ping');
  await sleep(15_000);
  ws.terminate();
  log('main', { url: MAIN_URL, openMs, counts, firsts });
}

// The CCXT spelling alone on a fresh socket, then the socket spelling beside it, then an unsubscribe of the CCXT spelling.
async function spelling() {
  const { ws } = await open(OSS_URL);
  const seen = [];
  let phase = 'ccxt_only';
  ws.on('message', (d) => {
    const t = d.toString();
    if (t === 'pong') return;
    const j = JSON.parse(t);
    seen.push({ phase, key: j.topic ? `${j.topic}|${j.data?.type}|${j.data?.symbol}` : t.slice(0, 160) });
    if (!j.topic) capture('spelling.txt', t);
  });
  ws.send(JSON.stringify({ op: 'subscribe', args: ['update:SOL-PERP-USDT_0', 'snapshotL1:XRP-PERP-USDT'] }));
  await sleep(10_000);
  phase = 'both';
  ws.send(JSON.stringify({ op: 'subscribe', args: ['update:SOL-PERP_0'] }));
  await sleep(8_000);
  phase = 'after_unsubscribe_ccxt';
  ws.send(JSON.stringify({ op: 'unsubscribe', args: ['update:SOL-PERP-USDT_0'] }));
  await sleep(8_000);
  ws.terminate();
  const counts = {};
  for (const x of seen) counts[`${x.phase} ${x.key}`] = (counts[`${x.phase} ${x.key}`] ?? 0) + 1;
  log('spelling', { counts });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate, main: mainEndpoint, spelling };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
