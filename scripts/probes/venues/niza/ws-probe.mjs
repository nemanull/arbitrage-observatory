// Niza.fun perpetuals WebSocket probe. Niza.fun is the Orderly builder `niza`, so its book is Orderly's public market data stream.
// Measures the book channels (snapshot, delta chain, level order, size unit), the anchor topics, errors, keepalive and silence, deflate, and all 80 shared perpetuals on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node ../scripts/probes/venues/niza/ws-probe.mjs [book|batch|silence|deflate]
//   book     orderbookupdate, orderbook, request orderbook, bbo and anchor topics on four perps, local book replay, errors. About 65 s.
//   batch    orderbookupdate on every shared USDC perpetual on one connection for 60 s.
//   silence  four sockets that differ in what the client answers, sends or subscribes, for up to 120 s.
//   deflate  asks for permessage-deflate once, then tries the stream path without and with several account ids. About 25 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/niza/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const BASE = 'wss://ws-evm.orderly.org/ws/stream';
// The path segment is documented as the account id. This value is the one the Orderly SDK in niza.fun and CCXT woofipro both hardcode for the public socket.
// Every other value tried in the deflate mode is refused on the upgrade or closed by the server within milliseconds.
const ACCOUNT = 'OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY';
const API = 'https://api.orderly.org';
const OUT = process.env.PROBE_OUT_DIR;
const SHARED = /^PERP_[A-Z0-9]+_USDC$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let nextId = 1;
const sub = (topic) => JSON.stringify({ id: `p${nextId++}`, event: 'subscribe', topic });
const request = (symbol) => JSON.stringify({ id: `r${nextId++}`, event: 'request', params: { type: 'orderbook', symbol } });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve, reject) => {
    ws.once('upgrade', (res) => (ws.upgradeHeaders = res.headers));
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0 }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

const levelsDesc = (xs) => xs.every((l, i) => i === 0 || l[0] < xs[i - 1][0]);
const levelsAsc = (xs) => xs.every((l, i) => i === 0 || l[0] > xs[i - 1][0]);

function applyLevels(side, levels) {
  for (const [p, q] of levels) {
    if (q === 0) side.delete(p);
    else side.set(p, q);
  }
}
const top = (side, desc, n) => [...side.entries()].sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, n);

async function restBook(symbol, max) {
  const res = await fetch(`${API}/v1/public/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'orderbook', symbol, max_level: max }) });
  return (await res.json()).data;
}

async function book() {
  const symbols = ['PERP_BTC_USDC', 'PERP_ETH_USDC', 'PERP_CL_USDC', 'PERP_MERL_USDC'];
  const { ws, openMs } = await open(`${BASE}/${ACCOUNT}`);
  const t0 = Date.now();
  log('open', { url: `${BASE}/${ACCOUNT}`, openMs, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null });

  const st = {};
  for (const s of symbols) {
    st[s] = {
      upd: 0, emptyUpd: 0, gaps: 0, chainOk: 0, firstUpd: null, lastTs: null, bidUnordered: 0, askUnordered: 0, maxLevelsInUpd: 0,
      snaps: 0, snapLevels: [], snapOrder: [0, 0], snapTsDiffToFrame: [],
      reqs: [], local: null, compare: { match: 0, mismatch: 0, examples: [] }, subAt: null, firstUpdAfterMs: null, firstSnapAfterMs: null, maxUpdGapMs: 0, lastUpdAt: null,
    };
  }
  const topics = {};
  const acks = [];
  const pings = [];
  const others = [];
  const replies = []; // every ack, request reply and unparsed frame, in order, for the error probes
  let pongs = 0;

  ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      others.push(text.slice(0, 200));
      replies.push(text.slice(0, 200));
      return;
    }
    if (m.event === 'ping') {
      pings.push(now - t0);
      ws.send(JSON.stringify({ event: 'pong' }));
      if (pings.length === 1) capture('book-ping.json', text);
      return;
    }
    if (m.event === 'pong') {
      pongs++;
      replies.push(text.slice(0, 200));
      capture('book-pong.json', text);
      return;
    }
    if (m.event === 'subscribe' || m.event === 'unsubscribe') {
      acks.push({ id: m.id, success: m.success, errorMsg: m.errorMsg, afterMs: now - t0 });
      replies.push(text.slice(0, 200));
      capture('book-acks.json', text);
      return;
    }
    if (m.event === 'request') {
      const d = m.data;
      const s = d?.symbol;
      capture('book-request.json', text);
      if (!st[s]) {
        others.push(text.slice(0, 300));
        replies.push(text.slice(0, 200));
        return;
      }
      st[s].reqs.push({ ts: d.ts, frameTs: m.ts, bids: d.bids.length, asks: d.asks.length, bidsDesc: levelsDesc(d.bids), asksAsc: levelsAsc(d.asks), lastUpdTs: st[s].lastTs, afterMs: now - t0 });
      if (!st[s].local) st[s].local = { ts: d.ts, bids: new Map(d.bids), asks: new Map(d.asks), pending: [] };
      return;
    }
    const topic = m.topic;
    if (!topic) {
      others.push(text.slice(0, 300));
      replies.push(text.slice(0, 200)); // an error reply carries `id` and `success: false` but no `event`
      return;
    }
    const tp = topics[topic] ?? (topics[topic] = { n: 0, firstAfterMs: now - t0, bytes: 0, sample: text.slice(0, 400) });
    tp.n++;
    tp.bytes += text.length;
    const [sym, kind] = topic.split('@');
    const s = st[sym];
    if (kind === 'orderbookupdate' && s) {
      const d = m.data;
      capture(`book-upd-${sym}.jsonl`, text);
      s.upd++;
      if (s.lastUpdAt) s.maxUpdGapMs = Math.max(s.maxUpdGapMs, now - s.lastUpdAt);
      s.lastUpdAt = now;
      if (s.firstUpdAfterMs === null) s.firstUpdAfterMs = now - s.subAt;
      if (!s.firstUpd) s.firstUpd = { ts: m.ts, prevTs: d.prevTs, bids: d.bids.length, asks: d.asks.length, keys: Object.keys(d) };
      if (d.bids.length === 0 && d.asks.length === 0) s.emptyUpd++;
      s.maxLevelsInUpd = Math.max(s.maxLevelsInUpd, d.bids.length, d.asks.length);
      if (!levelsDesc(d.bids)) s.bidUnordered++;
      if (!levelsAsc(d.asks)) s.askUnordered++;
      if (s.lastTs !== null) {
        if (d.prevTs === s.lastTs) s.chainOk++;
        else {
          s.gaps++;
          if (s.gaps <= 3) log('gap', { symbol: sym, expected: s.lastTs, prevTs: d.prevTs, ts: m.ts });
        }
      }
      s.lastTs = m.ts;
      if (s.local) {
        if (m.ts <= s.local.ts) s.local.skippedOld = (s.local.skippedOld ?? 0) + 1;
        else {
          if (s.local.firstAppliedPrevTs === undefined) s.local.firstAppliedPrevTs = d.prevTs;
          applyLevels(s.local.bids, d.bids);
          applyLevels(s.local.asks, d.asks);
          s.local.appliedTs = m.ts;
        }
      }
      return;
    }
    if (kind === 'orderbook' && s) {
      const d = m.data;
      capture(`book-snap-${sym}.jsonl`, text);
      s.snaps++;
      if (s.firstSnapAfterMs === null) s.firstSnapAfterMs = now - s.subAt;
      s.snapLevels.push(Math.max(d.bids.length, d.asks.length));
      if (levelsDesc(d.bids) && levelsAsc(d.asks)) s.snapOrder[0]++;
      else s.snapOrder[1]++;
      // Compare the pushed snapshot with the book replayed from the requested snapshot and every delta applied so far.
      if (s.local?.appliedTs !== undefined && s.local.appliedTs === m.ts) {
        const want = { b: d.bids.slice(0, 20), a: d.asks.slice(0, 20) };
        const got = { b: top(s.local.bids, true, 20), a: top(s.local.asks, false, 20) };
        const same = JSON.stringify(want) === JSON.stringify(got);
        if (same) s.compare.match++;
        else {
          s.compare.mismatch++;
          if (s.compare.examples.length < 1) s.compare.examples.push({ ts: m.ts, want: [want.b[0], want.a[0]], got: [got.b[0], got.a[0]] });
        }
      } else if (s.local) {
        s.compare.unaligned = (s.compare.unaligned ?? 0) + 1;
      }
      return;
    }
  });
  ws.on('close', (code, reason) => log('closed', { afterMs: Date.now() - t0, code, reason: reason.toString() }));
  await sleep(500);
  if (ws.readyState !== ws.OPEN) return;

  for (const s of symbols) {
    st[s].subAt = Date.now();
    ws.send(sub(`${s}@orderbookupdate`));
    ws.send(sub(`${s}@orderbook`));
  }
  await sleep(1500);
  for (const s of symbols) ws.send(request(s));
  for (const t of ['PERP_BTC_USDC@bbo', 'PERP_MERL_USDC@bbo', 'PERP_BTC_USDC@markprice', 'SPOT_BTC_USDC@indexprice', 'PERP_BTC_USDC@indexprice', 'markprices', 'indexprices', 'PERP_BTC_USDC@estfundingrate', 'PERP_BTC_USDC@ticker', 'maintenance_status']) ws.send(sub(t));

  // Errors.
  await sleep(2000);
  const errFrames = [
    ['unknown symbol', sub('PERP_NOPE_USDC@orderbookupdate')],
    ['unknown topic', sub('PERP_BTC_USDC@nope')],
    ['duplicate', sub('PERP_BTC_USDC@orderbookupdate')],
    ['builder market', sub('PERP_AAPL_USDC_mythos@orderbookupdate')],
    ['reduce only builder market', sub('PERP_ALPIX_USDC_alpix@orderbookupdate')],
    ['no id', JSON.stringify({ event: 'subscribe', topic: 'PERP_ETH_USDC@bbo' })],
    ['request unknown', JSON.stringify({ id: 'rX', event: 'request', params: { type: 'orderbook', symbol: 'PERP_NOPE_USDC' } })],
    ['not json', 'hello'],
    ['client ping', JSON.stringify({ event: 'ping' })],
  ];
  for (const [label, f] of errFrames) {
    const before = replies.length;
    ws.send(f);
    await sleep(700);
    log('error_probe', { label, sent: f.slice(0, 120), replies: replies.slice(before, before + 3), socketOpen: ws.readyState === ws.OPEN });
  }

  // Size unit: the socket's top levels against the zero-auth REST book read at about the same time.
  const snapNow = {};
  const onSnap = (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.topic === 'PERP_ETH_USDC@orderbook' && !snapNow.eth) snapNow.eth = m;
  };
  ws.on('message', onSnap);
  await sleep(1200);
  const rest = await restBook('PERP_ETH_USDC', 20);
  ws.off('message', onSnap);
  if (snapNow.eth && rest) {
    const ws10 = new Map(snapNow.eth.data.bids.slice(0, 10).concat(snapNow.eth.data.asks.slice(0, 10)));
    let same = 0;
    let priced = 0;
    for (const l of rest.bids.slice(0, 10).concat(rest.asks.slice(0, 10))) {
      const q = ws10.get(Number(l.price));
      if (q !== undefined) {
        priced++;
        if (q === Number(l.quantity)) same++;
      }
    }
    log('size_unit', { symbol: 'PERP_ETH_USDC', wsTs: snapNow.eth.ts, restTs: rest.ts, wsTop: [snapNow.eth.data.bids[0], snapNow.eth.data.asks[0]], restTop: [rest.bids[0], rest.asks[0]], pricesInBoth: priced, sameSize: same });
  }

  await sleep(Math.max(0, 30_000 - (Date.now() - t0)));
  for (const s of symbols) ws.send(request(s));
  await sleep(Math.max(0, 62_000 - (Date.now() - t0)));
  ws.close();
  await sleep(300);

  log('acks', { n: acks.length, failed: acks.filter((a) => !a.success).map((a) => `${a.id} ${a.errorMsg}`), firstAckMs: acks[0]?.afterMs });
  log('keepalive', { serverPingsAtMs: pings, pongs });
  for (const s of symbols) {
    const x = st[s];
    log('book_symbol', {
      symbol: s,
      updates: x.upd, emptyUpdates: x.emptyUpd, chainOk: x.chainOk, gaps: x.gaps, maxUpdGapMs: x.maxUpdGapMs, firstUpdAfterSubMs: x.firstUpdAfterMs, firstUpd: x.firstUpd, maxLevelsInOneUpd: x.maxLevelsInUpd,
      unorderedBidArrays: x.bidUnordered, unorderedAskArrays: x.askUnordered,
      snapshots: x.snaps, firstSnapAfterSubMs: x.firstSnapAfterMs, snapLevels: [Math.min(...x.snapLevels), Math.max(...x.snapLevels)], snapOrdered: x.snapOrder,
      requests: x.reqs, localSkippedOld: x.local?.skippedOld, localFirstAppliedPrevTs: x.local?.firstAppliedPrevTs, replayVsPushed: x.compare,
    });
  }
  for (const [t, v] of Object.entries(topics)) if (!/orderbook/.test(t)) log('topic', { topic: t, frames: v.n, firstAfterMs: v.firstAfterMs, avgBytes: Math.round(v.bytes / v.n), sample: v.sample.slice(0, 300) });
  log('others', { n: others.length, sample: others.slice(0, 5) });
}

async function batch() {
  const info = await (await fetch(`${API}/v1/public/info`)).json();
  const symbols = info.data.rows.filter((r) => SHARED.test(r.symbol) && r.status === 'ACTIVE').map((r) => r.symbol);
  const { ws, openMs } = await open(`${BASE}/${ACCOUNT}`);
  const t0 = Date.now();
  const per = new Map(symbols.map((s) => [s, { n: 0, last: null, gaps: 0 }]));
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let acks = 0;
  let fails = [];
  const perSecond = new Map();
  ws.on('message', (raw) => {
    const a = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - a;
    if (m.event === 'ping') return ws.send(JSON.stringify({ event: 'pong' }));
    if (m.event === 'subscribe') {
      acks++;
      if (!m.success) fails.push(m.errorMsg);
      return;
    }
    if (!m.topic) return;
    frames++;
    bytes += raw.length;
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const p = per.get(m.topic.split('@')[0]);
    if (!p) return;
    p.n++;
    if (p.last !== null && m.data.prevTs !== p.last) p.gaps++;
    p.last = m.ts;
  });
  for (const s of symbols) ws.send(sub(`${s}@orderbookupdate`));
  await sleep(60_000);
  ws.close();
  const secs = [...perSecond.values()].sort((a, b) => a - b);
  const counts = [...per.entries()].map(([s, p]) => [s, p.n]).sort((a, b) => a[1] - b[1]);
  log('batch', {
    openMs, symbols: symbols.length, acks, fails, frames, framesPerSecond: Math.round(frames / 60), medianPerSecond: secs[Math.floor(secs.length / 2)], peakPerSecond: secs[secs.length - 1],
    bytesPerSecond: Math.round(bytes / 60), bytesPerFrame: Math.round(bytes / Math.max(1, frames)), parseUsPerFrame: Number(parseNs / BigInt(Math.max(1, frames))) / 1000,
    gaps: [...per.values()].reduce((a, p) => a + p.gaps, 0), silent: counts.filter(([, n]) => n === 0).map(([s]) => s), fewest: counts.slice(0, 5), most: counts.slice(-3),
  });
}

async function silence() {
  const cases = [
    { name: 'idle, ignores pings', answer: false, subscribe: false, clientPing: false },
    { name: 'idle, answers pings', answer: true, subscribe: false, clientPing: false },
    { name: 'subscribed quiet, ignores pings', answer: false, subscribe: true, clientPing: false },
    { name: 'idle, ignores pings, client ping every 10 s', answer: false, subscribe: false, clientPing: true },
  ];
  const limit = 120_000;
  await Promise.all(
    cases.map(async (c) => {
      const { ws } = await open(`${BASE}/${ACCOUNT}`);
      const t0 = Date.now();
      const pings = [];
      let frames = 0;
      let pongs = 0;
      let timer;
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.event === 'ping') {
          pings.push(Date.now() - t0);
          if (c.answer) ws.send(JSON.stringify({ event: 'pong' }));
        } else if (m.event === 'pong') pongs++;
        else frames++;
      });
      if (c.subscribe) ws.send(sub('PERP_MERL_USDC@orderbookupdate'));
      if (c.clientPing) timer = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'ping' })), 10_000);
      const closed = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), limit);
        ws.on('close', (code, reason) => {
          clearTimeout(t);
          resolve({ code, reason: reason.toString(), afterMs: Date.now() - t0 });
        });
      });
      clearInterval(timer);
      if (!closed) ws.terminate();
      log('silence', { case: c.name, closed: closed ?? `open at ${limit} ms`, serverPingsAtMs: pings, pongsReceived: pongs, otherFrames: frames });
    }),
  );
}

async function deflate() {
  try {
    const { ws, openMs } = await open(`${BASE}/${ACCOUNT}`, { deflate: true });
    log('deflate', { openMs, negotiated: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null });
    ws.close();
  } catch (e) {
    log('deflate', { error: e.message });
  }
  const rand = (n, abc) => Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (const [label, url] of [
    ['no account segment', BASE],
    ['trailing slash', `${BASE}/`],
    ['SDK and CCXT id', `${BASE}/${ACCOUNT}`],
    ['SDK id with its last character changed', `${BASE}/${ACCOUNT.slice(0, -1)}Z`],
    ['random 40 alphanumerics', `${BASE}/${rand(40, alnum)}`],
    ['short word', `${BASE}/observatoryprobe`],
    ['0x and 64 zeros', `${BASE}/0x${'0'.repeat(64)}`],
    ['0x and 64 random hex', `${BASE}/0x${rand(64, '0123456789abcdef')}`],
  ]) {
    try {
      const { ws, openMs } = await open(url);
      const t0 = Date.now();
      let frames = 0;
      let ack = null;
      let closed = null;
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.event === 'subscribe') ack = m;
        else if (m.topic) frames++;
      });
      ws.on('close', (code, reason) => (closed = { code, reason: reason.toString(), afterMs: Date.now() - t0 }));
      ws.send(sub('PERP_BTC_USDC@bbo'));
      await sleep(3000);
      ws.close();
      log('path', { label, openMs, closedByServer: closed, ack, bboFramesIn3s: frames });
    } catch (e) {
      log('path', { label, error: e.message });
    }
  }
}

const mode = process.argv[2] ?? 'book';
const run = { book, batch, silence, deflate }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await run();
process.exit(0);
