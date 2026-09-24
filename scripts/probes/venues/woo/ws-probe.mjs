// WOO X public WebSocket v3 probe: book channels, the prevTs chain, REST snapshot alignment, level order, RPI against non-RPI, keepalive, silence, limits, errors.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/woo/ws-probe.mjs [book|batch|silence|deflate]
//   book     orderbookupdate@<perp>@50 on four perps for 75 s with REST snapshot alignment and a final compare, plus orderbook10, bbo, markprice, indexprice, estfundingrate, ticker, and error cases. About 85 s.
//   batch    orderbookupdate@<perp>@50 on the 100 busiest perps on one socket for 60 s, then a 101st topic and a 21 topic request.
//   silence  four sockets that differ only in what the client sends or subscribes, for up to 120 s, or SILENCE_MS.
//   deflate  asks for permessage-deflate once, then tries the legacy v1 URL that CCXT Pro 4.5.68 uses, for 10 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/woo/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://wss.woox.io/v3/public';
const V1_URL = 'wss://wss.woox.io/ws/stream';
const API = 'https://api.woox.io';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let reqId = 0;
const sub = (params, cmd = 'SUBSCRIBE') => JSON.stringify({ id: String(++reqId), cmd, params });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

async function rest(path) {
  const res = await fetch(API + path);
  return res.json();
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('error', reject);
  });
}

// A book kept from deltas: price string to size number, per side.
function applySide(side, levels) {
  for (const [p, q] of levels) {
    if (Number(q) === 0) side.delete(Number(p));
    else side.set(Number(p), Number(q));
  }
}
const top = (side, n, desc) => [...side.entries()].sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, n);

async function book() {
  const futures = (await rest('/v3/public/futures')).data.rows;
  const quiet = futures.filter((r) => Number(r['24hAmount']) === 0 && r.symbol !== 'PERP_EWT_USDT').map((r) => r.symbol).sort()[0];
  const BOOKS = ['PERP_BTC_USDT', 'PERP_ETH_USDT', 'PERP_SOL_USDT', quiet];
  log('symbols', { books: BOOKS, quiet });

  const { ws, openMs } = await open(WS_URL);
  log('open', { url: WS_URL, openMs });
  const t0 = Date.now();
  const st = {};
  for (const s of BOOKS) st[s] = { frames: 0, empty: 0, gaps: 0, chained: 0, lastTs: undefined, first: undefined, maxIdleMs: 0, lastArrive: undefined, bidsUnordered: 0, asksUnordered: 0, maxLevelsInFrame: 0, buffer: [], book: undefined, snapTs: undefined, aligned: false, alignedLate: false, skippedBeforeAlign: 0, applied: 0 };
  const other = {};
  let lastBbo;
  const ob10 = { sameAsBbo: 0, tighterThanBbo: 0, other: 0 };
  const restLag = [];
  const acks = [];
  const pongs = [];
  const errors = [];
  let serverPings = 0;
  ws.on('ping', () => serverPings++);

  ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      errors.push({ nonJson: text.slice(0, 200) });
      return;
    }
    if (m.cmd) {
      if (m.cmd === 'PONG') pongs.push({ rttMs: now - (m.sentAt ?? now), frame: text.slice(0, 200) });
      else acks.push({ atMs: now - t0, frame: text.slice(0, 400) });
      capture('control.jsonl', text);
      return;
    }
    const topic = m.topic ?? '';
    const [kind, sym] = topic.split('@');
    if (kind === 'orderbookupdate' && st[sym]) {
      const s = st[sym];
      const d = m.data;
      s.frames++;
      if (s.frames <= 3) capture(`book-${sym}.jsonl`, text);
      if (s.lastArrive !== undefined) s.maxIdleMs = Math.max(s.maxIdleMs, now - s.lastArrive);
      s.lastArrive = now;
      if (s.first === undefined) s.first = { atMs: now - t0, prevTs: d.prevTs, ts: d.ts, envTs: m.ts, bids: d.bids.length, asks: d.asks.length, keys: Object.keys(d) };
      if ((d.bids?.length ?? 0) + (d.asks?.length ?? 0) === 0) s.empty++;
      s.maxLevelsInFrame = Math.max(s.maxLevelsInFrame, d.bids.length, d.asks.length);
      const bp = d.bids.map((l) => Number(l[0]));
      const ap = d.asks.map((l) => Number(l[0]));
      if (!bp.every((p, i) => i === 0 || p < bp[i - 1])) s.bidsUnordered++;
      if (!ap.every((p, i) => i === 0 || p > ap[i - 1])) s.asksUnordered++;
      if (s.lastTs !== undefined) {
        if (d.prevTs === s.lastTs) s.chained++;
        else {
          s.gaps++;
          if (s.gaps <= 3) log('gap', { symbol: sym, expectedPrevTs: s.lastTs, gotPrevTs: d.prevTs, ts: d.ts });
        }
      }
      s.lastTs = d.ts;
      if (s.book === undefined) s.buffer.push(d);
      else if (!s.aligned && d.prevTs === s.snapTs) {
        s.aligned = true;
        s.alignedLate = true;
      } else if (!s.aligned) s.skippedBeforeAlign++;
      if (s.book !== undefined && s.aligned) {
        applySide(s.book.bids, d.bids);
        applySide(s.book.asks, d.asks);
        s.applied++;
      }
      return;
    }
    other[topic] ??= { frames: 0, first: undefined, last: undefined, maxIdleMs: 0, lastArrive: undefined };
    const o = other[topic];
    o.frames++;
    if (o.lastArrive !== undefined) o.maxIdleMs = Math.max(o.maxIdleMs, now - o.lastArrive);
    o.lastArrive = now;
    if (o.first === undefined) {
      o.first = text.slice(0, 600);
      capture('other.jsonl', text);
    }
    o.last = m.data;
    if (kind === 'bbo' && sym === 'PERP_BTC_USDT') lastBbo = m.data;
    if (kind === 'orderbook10' && lastBbo) {
      const b = m.data.bids[0]?.[0];
      const a = m.data.asks[0]?.[0];
      if (Number(b) === Number(lastBbo.bp) && Number(a) === Number(lastBbo.ap)) ob10.sameAsBbo++;
      else if (Number(a) - Number(b) < Number(lastBbo.ap) - Number(lastBbo.bp)) ob10.tighterThanBbo++;
      else ob10.other++;
    }
  });
  ws.on('close', (code, reason) => log('close', { atMs: Date.now() - t0, code, reason: reason.toString() }));

  ws.send(sub(BOOKS.map((s) => `orderbookupdate@${s}@50`)));
  ws.send(sub(['orderbook10@PERP_BTC_USDT', 'bbo@PERP_BTC_USDT', 'markprice@PERP_BTC_USDT', 'indexprice@PERP_BTC_USDT', 'indexprice@SPOT_BTC_USDT', 'estfundingrate@PERP_BTC_USDT', 'ticker@PERP_BTC_USDT', 'orderbookupdaterpi@PERP_BTC_USDT@50']));

  // Seed each book from the REST snapshot after a short buffer, the documented recipe.
  await sleep(3000);
  for (const s of BOOKS) {
    const snap = await rest(`/v3/public/orderbook?symbol=${s}&maxLevel=50`);
    const S = st[s];
    S.snapTs = snap.timestamp;
    S.book = { bids: new Map(snap.data.bids.map((l) => [Number(l.price), Number(l.quantity)])), asks: new Map(snap.data.asks.map((l) => [Number(l.price), Number(l.quantity)])) };
    const idx = S.buffer.findIndex((d) => d.prevTs === snap.timestamp);
    const older = S.buffer.filter((d) => d.ts <= snap.timestamp).length;
    S.aligned = idx >= 0;
    if (idx >= 0) for (const d of S.buffer.slice(idx)) {
      applySide(S.book.bids, d.bids);
      applySide(S.book.asks, d.asks);
      S.applied++;
    }
    log('align', { symbol: s, snapTs: snap.timestamp, snapAgeMs: Date.now() - snap.timestamp, buffered: S.buffer.length, bufferedTsRange: S.buffer.length ? [S.buffer[0].prevTs, S.buffer[0].ts, S.buffer.at(-1).ts] : [], matchIndex: idx, bufferedAtOrBeforeSnap: older, aligned: S.aligned });
    S.buffer = [];
  }

  // Keepalive and control commands while the books run.
  const pingTimer = setInterval(() => ws.send(JSON.stringify({ cmd: 'PING', ts: Date.now() })), 10_000);
  await sleep(8000);
  ws.send(JSON.stringify({ id: 'list', cmd: 'LIST_SUBSCRIPTION' }));
  // Every 5 s, read the REST book and set its timestamp against the newest ts the socket had delivered.
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    for (const s of ['PERP_BTC_USDT', 'PERP_ETH_USDT']) {
      const wsBefore = st[s].lastTs;
      const t1 = Date.now();
      const snap = await rest(`/v3/public/orderbook?symbol=${s}&maxLevel=50`);
      restLag.push({ s, restTs: snap.timestamp, wsTsBefore: wsBefore, restBehindWsMs: wsBefore !== undefined ? wsBefore - snap.timestamp : null, restAgeAtRequestMs: t1 - snap.timestamp });
    }
  }
  for (const s of ['PERP_BTC_USDT', 'PERP_ETH_USDT']) {
    const rows = restLag.filter((r) => r.s === s && r.restBehindWsMs !== null);
    log('rest_lag', { symbol: s, samples: rows.length, restOlderThanWs: rows.filter((r) => r.restBehindWsMs > 0).length, maxBehindMs: Math.max(0, ...rows.map((r) => r.restBehindWsMs)), maxRestAgeMs: Math.max(...rows.map((r) => r.restAgeAtRequestMs)) });
  }
  log('orderbook10_vs_bbo', ob10);

  // Final compare: the book kept from deltas against a fresh REST snapshot, both non-RPI.
  for (const s of BOOKS) {
    const S = st[s];
    const snap = await rest(`/v3/public/orderbook?symbol=${s}&maxLevel=50`);
    if (!S.book) continue;
    const restB = snap.data.bids.slice(0, 20).map((l) => [Number(l.price), Number(l.quantity)]);
    const restA = snap.data.asks.slice(0, 20).map((l) => [Number(l.price), Number(l.quantity)]);
    const mine = { b: top(S.book.bids, 20, true), a: top(S.book.asks, 20, false) };
    const eq = (x, y) => x.filter((l, i) => y[i] && y[i][0] === l[0] && y[i][1] === l[1]).length;
    log('final_compare', { symbol: s, restTs: snap.timestamp, lastWsTs: S.lastTs, sameTs: snap.timestamp === S.lastTs, bidsEqual: `${eq(mine.b, restB)}/${restB.length}`, asksEqual: `${eq(mine.a, restA)}/${restA.length}`, wsTouch: [mine.b[0], mine.a[0]], restTouch: [restB[0], restA[0]], bookLevels: [S.book.bids.size, S.book.asks.size] });
  }
  for (const s of BOOKS) {
    const { buffer, book: b, ...rest } = st[s];
    log('book_stats', { symbol: s, ...rest, bookLevels: b ? [b.bids.size, b.asks.size] : null, runSec: Math.round((Date.now() - t0) / 1000) });
  }
  for (const [topic, o] of Object.entries(other)) log('other_topic', { topic, frames: o.frames, maxIdleMs: o.maxIdleMs, first: o.first });

  // RPI or not: which REST book does orderbook10 and bbo follow.
  const [nr, rp] = await Promise.all([rest('/v3/public/orderbook?symbol=PERP_BTC_USDT&maxLevel=10'), rest('/v3/public/orderbook?symbol=PERP_BTC_USDT&maxLevel=10&rpi=true')]);
  log('rpi_check', { ob10Last: other['orderbook10@PERP_BTC_USDT']?.last && { b: other['orderbook10@PERP_BTC_USDT'].last.bids[0], a: other['orderbook10@PERP_BTC_USDT'].last.asks[0] }, bboLast: other['bbo@PERP_BTC_USDT']?.last, restNonRpi: [nr.data.bids[0], nr.data.asks[0]], restRpi: [rp.data.bids[0], rp.data.asks[0]] });

  // Error cases on the live socket.
  const errCases = [
    ['unknown symbol', sub(['orderbookupdate@PERP_NOPE_USDT@50'])],
    ['unsupported depth', sub(['orderbookupdate@PERP_BTC_USDT@20'])],
    ['unknown topic', sub(['nope@PERP_BTC_USDT'])],
    ['duplicate', sub(['orderbookupdate@PERP_BTC_USDT@50'])],
    ['spot book', sub(['orderbookupdate@SPOT_BTC_USDT@50'])],
    ['lowercase cmd', JSON.stringify({ id: 'lc', cmd: 'subscribe', params: ['bbo@PERP_ETH_USDT'] })],
    ['v1 shaped frame', JSON.stringify({ id: 'v1', event: 'subscribe', topic: 'PERP_ETH_USDT@bbo' })],
    ['not json', 'hello'],
    ['21 topics', sub(futures.slice(0, 21).map((r) => `bbo@${r.symbol}`))],
  ];
  const before = acks.length;
  for (const [name, frame] of errCases) {
    ws.send(frame);
    await sleep(700);
    log('error_case', { name, replies: acks.slice(before).map((a) => a.frame) });
    acks.splice(before);
  }
  await sleep(500);
  log('non_json_replies', { errors });
  clearInterval(pingTimer);
  const pingT = Date.now();
  ws.ping();
  const pongMs = await new Promise((r) => {
    ws.once('pong', () => r(Date.now() - pingT));
    setTimeout(() => r(null), 3000);
  });
  log('session', { pongsToAppPing: pongs.length, samplePong: pongs[0]?.frame, protocolPongMs: pongMs, serverPings, acksDuringRun: acks.length });
  ws.close();
  await sleep(300);
}

async function batch() {
  const futures = (await rest('/v3/public/futures')).data.rows;
  const syms = futures.sort((a, b) => Number(b['24hAmount']) - Number(a['24hAmount'])).slice(0, 101).map((r) => r.symbol);
  const main = syms.slice(0, 100);

  // The documented cap is 20 topics per request, so find the largest request the server accepts.
  const probe = await open(WS_URL);
  const sizeReplies = [];
  probe.ws.on('message', (raw) => sizeReplies.push(raw.toString()));
  let chunkSize = 1;
  let offset = 0;
  for (const n of [20, 19, 16, 11, 10, 6, 5]) {
    sizeReplies.length = 0;
    probe.ws.send(sub(futures.slice(offset, offset + n).map((r) => `ticker@${r.symbol}`)));
    offset += n;
    await sleep(800);
    const ack = sizeReplies.map((x) => JSON.parse(x)).find((x) => x.cmd);
    const ok = ack?.success === true;
    log('request_size', { topics: n, success: ok, accepted: Array.isArray(ack?.data) ? ack.data.length : ack?.data });
    if (ok && chunkSize === 1) chunkSize = n;
  }
  probe.ws.close();
  log('chunk_size', { chunkSize });

  const { ws, openMs } = await open(WS_URL);
  log('open', { openMs, topics: main.length });
  const st = new Map(main.map((s) => [s, { frames: 0, gaps: 0, last: undefined, snapLike: 0 }]));
  const acks = [];
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSec = [];
  let secFrames = 0;
  const t0 = Date.now();
  const tick = setInterval(() => {
    perSec.push(secFrames);
    secFrames = 0;
  }, 1000);
  ws.on('message', (raw) => {
    const p0 = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - p0;
    if (m.cmd) {
      acks.push({ atMs: Date.now() - t0, frame: raw.toString() });
      return;
    }
    frames++;
    secFrames++;
    bytes += raw.length;
    const sym = m.data?.s;
    const s = st.get(sym);
    if (!s) return;
    s.frames++;
    if (s.last !== undefined && m.data.prevTs !== s.last) s.gaps++;
    s.last = m.data.ts;
  });
  ws.on('close', (code) => log('close', { atMs: Date.now() - t0, code }));
  const subT = Date.now();
  for (let i = 0; i < main.length; i += chunkSize) {
    ws.send(sub(main.slice(i, i + chunkSize).map((s) => `orderbookupdate@${s}@50`)));
    await sleep(250);
  }
  await sleep(1000);
  log('acks_after_subscribe', { n: acks.length, successes: acks.filter((a) => a.frame.includes('"success":true')).length, topicsAccepted: acks.reduce((n, a) => n + (Array.isArray(JSON.parse(a.frame).data) ? JSON.parse(a.frame).data.length : 0), 0), lastAckMs: acks.at(-1)?.atMs, sample: acks[0]?.frame.slice(0, 200) });
  await sleep(1000);
  await sleep(58_000);
  clearInterval(tick);
  const all = [...st.values()];
  const idle = all.filter((s) => s.frames === 0).length;
  log('batch', { runSec: Math.round((Date.now() - subT) / 1000), frames, framesPerSec: { mean: Math.round(frames / 60), median: perSec.sort((a, b) => a - b)[Math.floor(perSec.length / 2)], peak: Math.max(...perSec) }, kbPerSec: Math.round(bytes / 60 / 1024), bytesPerFrame: frames ? Math.round(bytes / frames) : null, parseUsPerFrame: frames ? Number(parseNs / BigInt(frames)) / 1000 : null, gaps: all.reduce((a, s) => a + s.gaps, 0), topicsWithNoFrame: idle });
  acks.length = 0;
  ws.send(sub([`orderbookupdate@${syms[100]}@50`]));
  await sleep(1500);
  log('topic_101', { replies: acks.map((a) => a.frame.slice(0, 300)) });
  acks.length = 0;
  ws.send(JSON.stringify({ id: 'list', cmd: 'LIST_SUBSCRIPTION' }));
  await sleep(1000);
  log('list_after', { count: acks[0] ? JSON.parse(acks[0].frame).data?.length : null, reply: acks[0]?.frame.slice(0, 200) });
  ws.close();
  await sleep(300);
}

async function silence() {
  const futures = (await rest('/v3/public/futures')).data.rows;
  const quiet = futures.filter((r) => Number(r['24hAmount']) === 0 && r.symbol !== 'PERP_EWT_USDT').map((r) => r.symbol).sort()[0];
  const cases = [
    { name: 'no_sub_no_send' },
    { name: 'quiet_book_no_send', topic: `orderbookupdate@${quiet}@50` },
    { name: 'no_sub_protocol_ping_10s', protocolPingMs: 10_000 },
    { name: 'no_sub_app_ping_25s', appPingMs: 25_000 },
  ];
  const t0 = Date.now();
  const res = await Promise.all(
    cases.map(async (c) => {
      const { ws } = await open(WS_URL);
      const r = { name: c.name, closedAtMs: null, code: null, serverPings: 0, frames: 0, maxGapMs: 0 };
      let last = Date.now();
      ws.on('ping', () => r.serverPings++);
      ws.on('message', () => {
        r.frames++;
        r.maxGapMs = Math.max(r.maxGapMs, Date.now() - last);
        last = Date.now();
      });
      if (c.topic) ws.send(sub([c.topic]));
      const timers = [];
      if (c.protocolPingMs) timers.push(setInterval(() => ws.ping(), c.protocolPingMs));
      if (c.appPingMs) timers.push(setInterval(() => ws.send(JSON.stringify({ cmd: 'PING', ts: Date.now() })), c.appPingMs));
      let deadline = false;
      await new Promise((resolve) => {
        ws.on('close', (code) => {
          if (deadline) return; // the probe's own terminate below, not a server close
          r.closedAtMs = Date.now() - t0;
          r.code = code;
          resolve();
        });
        setTimeout(resolve, Number(process.env.SILENCE_MS ?? 120_000));
      });
      timers.forEach(clearInterval);
      r.maxGapMs = Math.max(r.maxGapMs, Date.now() - last);
      deadline = true;
      r.openAtDeadline = r.closedAtMs === null;
      ws.terminate();
      return r;
    }),
  );
  for (const r of res) log('silence', r);
}

async function deflate() {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: true });
  await new Promise((r) => ws.once('upgrade', (res) => {
    log('deflate', { offered: true, negotiated: res.headers['sec-websocket-extensions'] ?? null, openMs: Math.round(performance.now() - t0) });
    r();
  }));
  ws.terminate();

  const res = await new Promise((resolve) => {
    const out = { url: V1_URL, open: false, frames: 0, first: [], closeCode: null, error: null };
    const v1 = new WebSocket(V1_URL, { perMessageDeflate: false });
    const done = () => {
      v1.terminate();
      resolve(out);
    };
    v1.on('unexpected-response', (_req, r) => {
      out.error = `HTTP ${r.statusCode}`;
      done();
    });
    v1.on('error', (e) => {
      out.error ??= e.message;
    });
    v1.on('open', () => {
      out.open = true;
      v1.send(JSON.stringify({ id: '1', event: 'subscribe', topic: 'PERP_BTC_USDT@orderbookupdate' }));
      v1.send(JSON.stringify({ id: '2', event: 'subscribe', topic: 'PERP_BTC_USDT@bbo' }));
    });
    v1.on('message', (raw) => {
      out.frames++;
      if (out.first.length < 3) out.first.push(raw.toString().slice(0, 300));
    });
    v1.on('close', (code) => {
      out.closeCode = code;
    });
    setTimeout(done, 10_000);
  });
  log('legacy_v1', res);
}

const modes = { book, batch, silence, deflate };
const mode = process.argv[2] ?? 'book';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
