// Young Platform public WebSocket probe: the SOR.OB book topic and its cadence, level order and snapshot age, the other public topics, acknowledgements and errors, keepalive, silence, and a batch of every catalog market on one socket.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/young-platform/ws-probe.mjs [book|batch|credits|silence|deflate]
//   book     SOR.OB on four markets plus SOR.PI, SOR.T, SOR.PUB_TRADES and SOR.OHLCV on BTC-EUR for 45 s, with error cases, an application ping and a REST compare.
//   batch    SOR.OB on every /public/markets market in one frame for 45 s, with no client ping.
//   credits  two sockets: the catalog one topic per frame on the first until refused, the refused topics on the second, then one unsubscribe and a retry. About 12 s.
//   silence  one socket that subscribes nothing and sends nothing, for up to 110 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/young-platform/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://api.youngplatform.com/api/socket/ws';
const REST = 'https://api.youngplatform.com/api/v1/trader';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return { n: 0 };
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: +s[0].toFixed(1), median: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), max: +s[s.length - 1].toFixed(1) };
}

function open(opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(URL_WS, { perMessageDeflate: false, ...opts });
  const info = { t0, pings: 0, openMs: null, ext: null, close: null };
  ws.on('upgrade', (res) => {
    info.ext = res.headers['sec-websocket-extensions'] ?? null;
    info.ray = res.headers['cf-ray'];
  });
  ws.on('ping', () => info.pings++);
  ws.on('close', (code, reason) => (info.close = { code, reason: reason.toString(), atMs: Date.now() - t0 }));
  ws.on('error', (e) => log('socketError', { message: e.message }));
  const ready = new Promise((resolve) => ws.on('open', () => { info.openMs = Date.now() - t0; resolve(); }));
  return { ws, info, ready };
}

// Per topic book statistics: cadence, levels, order, repeats, snapshot age at arrival.
function bookTracker() {
  const per = new Map();
  return {
    add(topic, data, arrival) {
      const [pair, bids, asks, ts] = data;
      let s = per.get(topic);
      if (!s) per.set(topic, (s = { pair, frames: 0, gaps: [], last: null, nb: [], na: [], bidsNotDesc: 0, asksNotAsc: 0, repeats: 0, prev: null, ages: [], tsBack: 0, prevTs: null, crossed: 0, empty: 0, first: null }));
      s.frames++;
      if (s.last !== null) s.gaps.push(arrival - s.last);
      s.last = arrival;
      s.nb.push(bids.length);
      s.na.push(asks.length);
      if (!bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]))) s.bidsNotDesc++;
      if (!asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]))) s.asksNotAsc++;
      const body = JSON.stringify([bids, asks]);
      if (body === s.prev) s.repeats++;
      s.prev = body;
      s.ages.push(arrival - ts);
      if (s.prevTs !== null && ts <= s.prevTs) s.tsBack++;
      s.prevTs = ts;
      if (bids.length && asks.length && Number(bids[0][0]) >= Number(asks[0][0])) s.crossed++;
      if (!bids.length || !asks.length) s.empty++;
      if (s.first === null) s.first = { top: [bids[0], asks[0]], ts };
      s.lastTop = [bids[0], asks[0]];
    },
    top(topic) {
      const s = per.get(topic);
      if (!s?.lastTop?.[0] || !s.lastTop[1]) return null;
      return { mid: (Number(s.lastTop[0][0]) + Number(s.lastTop[1][0])) / 2 };
    },
    report(tag) {
      for (const [topic, s] of per) {
        log(tag, { topic, frames: s.frames, gapMs: stats(s.gaps), levels: { bidsMin: Math.min(...s.nb), bidsMax: Math.max(...s.nb), asksMin: Math.min(...s.na), asksMax: Math.max(...s.na) }, bidsNotDesc: s.bidsNotDesc, asksNotAsc: s.asksNotAsc, identicalRepeats: s.repeats, ageMs: stats(s.ages), tsNotIncreasing: s.tsBack, crossed: s.crossed, oneSidedOrEmpty: s.empty });
      }
      return per;
    },
  };
}

async function book() {
  const { ws, info, ready } = open();
  await ready;
  log('open', { ms: info.openMs, ext: info.ext, ray: info.ray });
  const tracker = bookTracker();
  const counts = {};
  const others = [];
  const piValues = [];
  const piVersusMid = [];
  let firstPerTopic = {};
  const subAt = {};
  ws.on('message', (raw) => {
    const arrival = Date.now();
    const text = raw.toString();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      others.push({ dt: arrival - info.t0, nonJson: text.slice(0, 200) });
      return;
    }
    const type = m.type ?? '?';
    counts[type] = (counts[type] ?? 0) + 1;
    if (!firstPerTopic[type]) {
      firstPerTopic[type] = true;
      capture('first-frames.jsonl', text);
      if (type.startsWith('SOR.')) log('firstFrame', { type, afterSubscribeMs: subAt[type] ? arrival - subAt[type] : null, text: text.slice(0, 700) });
    }
    if (type.startsWith('SOR.PUB_TRADES.') && Array.isArray(m.data)) {
      const ts = m.data.map((x) => x.t);
      log('tradesFrame', { type, trades: m.data.length, newestAgeSec: Math.round((arrival - Math.max(...ts)) / 1000), oldestAgeSec: Math.round((arrival - Math.min(...ts)) / 1000), sides: [...new Set(m.data.map((x) => x.s))] });
    }
    if (type.startsWith('SOR.OB.') && Array.isArray(m.data)) tracker.add(type, m.data, arrival);
    else if (type === 'SOR.PI.BTC-EUR') {
      piValues.push(Number(m.data[0]));
      const top = tracker.top('SOR.OB.BTC-EUR');
      if (top) piVersusMid.push(Math.round(((Number(m.data[0]) - top.mid) / top.mid) * 1e6));
    }
    else if (!type.startsWith('SOR.')) others.push({ dt: arrival - info.t0, text: text.slice(0, 300) });
    capture('frames.jsonl', text);
  });
  const sub = (id, events) => {
    const at = Date.now();
    for (const e of events) subAt[e] = at;
    ws.send(JSON.stringify({ id, method: 'subscribe', events }));
  };
  sub('s1', ['SOR.OB.BTC-EUR', 'SOR.OB.ETH-EUR', 'SOR.OB.SOL-USDC', 'SOR.OB.YNG-EUR', 'SOR.PI.BTC-EUR', 'SOR.T.BTC-EUR', 'SOR.PUB_TRADES.BTC-EUR', 'SOR.OHLCV.BTC-EUR.1m']);
  await sleep(3000);
  sub('s2', ['SOR.OB.NOPE-EUR']);
  await sleep(500);
  sub('s3', ['SOR.OB.TRUMP-EUR']);
  await sleep(500);
  sub('s4', ['SOR.OB.btc-eur']);
  await sleep(500);
  sub('s5', ['SOR.OB.BTC-EUR']);
  await sleep(500);
  sub('s6', ['LEDGER']);
  await sleep(500);
  sub('s7', ['SOR.NOPE.BTC-EUR']);
  await sleep(500);
  ws.send(JSON.stringify({ id: 'x1', method: 'nope' }));
  await sleep(500);
  ws.send('not json');
  await sleep(500);
  ws.send(JSON.stringify({ id: 'p1', method: 'ping' }));
  const pingAt = Date.now();
  // One REST liquidity read beside the socket book of the same instant.
  await sleep(2000);
  const r = await fetch(`${REST}/public/liquidity/BTC-EUR`).then((x) => x.json());
  const restAt = Date.now();
  await sleep(1500);
  const per = tracker.report('bookInterim');
  const s = per.get('SOR.OB.BTC-EUR');
  log('restVersusSocket', { restTime: r.time, restTop: [r.bids[0], r.asks[0]], socketTop: s?.lastTop, socketTs: s?.prevTs ? new Date(s.prevTs).toISOString() : null, restAt: new Date(restAt).toISOString() });
  await sleep(30_000);
  ws.send(JSON.stringify({ id: 'p2', method: 'ping' }));
  await sleep(2000);
  ws.send(JSON.stringify({ id: 'u1', method: 'unsubscribe', events: ['SOR.OB.ETH-EUR'] }));
  const unsubAt = Date.now();
  await sleep(3000);
  ws.close();
  await sleep(300);
  tracker.report('book');
  const piChanges = piValues.filter((v, i) => i > 0 && v !== piValues[i - 1]).length;
  log('counts', { counts, serverPings: info.pings, piFrames: piValues.length, piChanges, piMinusObMidPpm: stats(piVersusMid), pingSentAtMs: pingAt - info.t0, unsubSentAtMs: unsubAt - info.t0, close: info.close });
  for (const o of others) log('control', o);
}

async function batch() {
  const markets = (await fetch(`${REST}/public/markets`).then((x) => x.json())).markets.map((x) => x.market);
  const { ws, info, ready } = open();
  await ready;
  log('open', { ms: info.openMs, ext: info.ext, markets: markets.length });
  const tracker = bookTracker();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = new Map();
  const acks = [];
  ws.on('message', (raw) => {
    const arrival = Date.now();
    frames++;
    bytes += raw.length;
    const t = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t;
    const sec = Math.floor((arrival - info.t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (m.type?.startsWith('SOR.OB.')) tracker.add(m.type, m.data, arrival);
    else acks.push(m.type === 'subscribe' ? { id: m.id, error: m.error, topicsInMessage: m.message?.split(',').length } : m);
  });
  ws.send(JSON.stringify({ id: 'b1', method: 'subscribe', events: markets.map((m) => `SOR.OB.${m}`) }));
  const start = Date.now();
  await sleep(45_000);
  const secs = (Date.now() - start) / 1000;
  ws.close();
  await sleep(300);
  const per = tracker.report('batchMarket');
  const silent = markets.filter((m) => !per.has(`SOR.OB.${m}`));
  const fps = [...perSecond.entries()].filter(([s]) => s >= 2 && s < 44).map(([, n]) => n);
  log('batch', { markets: markets.length, delivering: per.size, silent, frames, framesPerSec: +(frames / secs).toFixed(1), perSecond: stats(fps), bytesPerSec: Math.round(bytes / secs), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: +(Number(parseNs) / frames / 1000).toFixed(1), serverPings: info.pings, close: info.close, acks });
}

// Two sockets at once: the first takes the catalog one topic per frame until the server refuses, the second takes what is left, so a per connection cap shows apart from a per host cap.
async function credits() {
  const markets = (await fetch(`${REST}/public/markets`).then((x) => x.json())).markets.map((x) => x.market);
  const a = open();
  const b = open();
  await Promise.all([a.ready, b.ready]);
  const replies = { a: [], b: [] };
  const delivering = { a: new Set(), b: new Set() };
  for (const [k, s] of [['a', a], ['b', b]]) {
    s.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type?.startsWith('SOR.')) delivering[k].add(m.type);
      else if (m.type !== 'ping') replies[k].push(m);
    });
  }
  for (let i = 0; i < markets.length; i++) {
    a.ws.send(JSON.stringify({ id: `a${i}`, method: 'subscribe', events: [`SOR.OB.${markets[i]}`] }));
    await sleep(150);
  }
  a.ws.send(JSON.stringify({ id: 'a-pi', method: 'subscribe', events: ['SOR.PI.BTC-EUR'] }));
  await sleep(300);
  const refusedOnA = replies.a.filter((m) => m.error).map((m) => m.message);
  b.ws.send(JSON.stringify({ id: 'b-rest', method: 'subscribe', events: refusedOnA }));
  await sleep(300);
  // Freeing one topic on the first socket, then asking again for one it was refused.
  a.ws.send(JSON.stringify({ id: 'a-unsub', method: 'unsubscribe', events: [`SOR.OB.${markets[0]}`] }));
  await sleep(300);
  a.ws.send(JSON.stringify({ id: 'a-retry', method: 'subscribe', events: [refusedOnA.find((x) => x.startsWith('SOR.OB.'))] }));
  await sleep(6000);
  log('credits', {
    markets: markets.length,
    acceptedOnA: replies.a.filter((m) => m.type === 'subscribe' && !m.error).length,
    refusedOnA,
    firstRefusal: replies.a.find((m) => m.error),
    replyToB: replies.b.find((m) => m.id === 'b-rest'),
    unsubscribeReply: replies.a.find((m) => m.id === 'a-unsub'),
    retryReply: replies.a.find((m) => m.id === 'a-retry'),
    deliveringA: delivering.a.size,
    deliveringB: delivering.b.size,
  });
  a.ws.close();
  b.ws.close();
  await sleep(300);
}

async function silence() {
  const { ws, info, ready } = open();
  await ready;
  log('open', { ms: info.openMs });
  let msgs = 0;
  ws.on('message', () => msgs++);
  const until = Date.now() + 110_000;
  while (Date.now() < until && info.close === null) await sleep(250);
  if (info.close === null) ws.close();
  await sleep(300);
  log('silence', { heldMs: Date.now() - info.t0, serverPings: info.pings, messages: msgs, closedByServer: info.close && info.close.code !== 1005 ? info.close : null, close: info.close });
}

async function deflate() {
  const { ws, info, ready } = open({ perMessageDeflate: true });
  await ready;
  log('deflate', { offered: true, negotiated: info.ext });
  ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await book();
if (mode === 'batch') await batch();
if (mode === 'credits') await credits();
if (mode === 'silence') await silence();
if (mode === 'deflate') await deflate();
log('end', { at: new Date().toISOString() });
process.exit(0);
