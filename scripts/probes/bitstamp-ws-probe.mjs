// Read-only WebSocket probe of Bitstamp's public perpetual channels at wss://ws.bitstamp.net.
// Run from server/ on Node 24: node ../scripts/probes/bitstamp-ws-probe.mjs [outDir] [seconds] [index|spacing]
// Recorded in docs/profiles/bitstamp/websocket.md. The REST half is bitstamp-venue-probe.mjs.
// Four sockets for the stated window, 90 s by default: a targeted one, a batch of every perpetual book, an idle one with no subscription, and a short one that sends bad frames.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'bitstamp-probe'); // raw captures stay out of the repository
fs.mkdirSync(OUT, { recursive: true });
const SECONDS = Number(process.argv[3] ?? 90);
const URL_WS = 'wss://ws.bitstamp.net';
const REST = 'https://www.bitstamp.net/api/v2';
const PERPS = ['btcusd-perp', 'ethusd-perp', 'xrpusd-perp', 'solusd-perp', 'dogeusd-perp', 'suiusd-perp', 'adausd-perp', 'linkusd-perp', 'avaxusd-perp', 'hypeusd-perp', 'goldusd-perp', 'taousd-perp', 'asterusd-perp', 'paxgusd-perp', 'silverusd-perp', 'qqqusd-perp', 'ewyusd-perp', 'eurusd-perp', 'wtiusd-perp', 'brentusd-perp'];
const RECONCILE = ['btcusd-perp', 'asterusd-perp'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const samples = [];
const keep = (conn, text, note) => {
  if (samples.filter((s) => s.note === note).length < 4) samples.push({ conn, note, at: new Date().toISOString(), text: text.slice(0, 1500) });
};

function channelStats() {
  return { msgs: 0, bytes: 0, firstAt: 0, lastAt: 0, maxGapMs: 0, microBackwards: 0, microEqual: 0, identicalRepeats: 0, crossed: 0, bidsDesc: 0, bidsNotDesc: 0, asksAsc: 0, asksNotAsc: 0, bidLevels: [], askLevels: [], lagMs: [], prevMicro: null, prevData: null, zeroAmounts: 0, emptySides: 0 };
}

function open(name, onOpen, onFrame) {
  const conn = { name, channels: new Map(), control: [], pings: 0, pongs: 0, binaryFrames: 0, textFrames: 0, bytes: 0, closed: null, extensions: null, upgradeHeaders: null, openedAt: 0, heartbeatRtt: [] };
  const t0 = performance.now();
  const ws = new WebSocket(URL_WS, { perMessageDeflate: false });
  conn.ws = ws;
  ws.on('upgrade', (res) => (conn.upgradeHeaders = Object.fromEntries(Object.entries(res.headers).filter(([k]) => /sec-websocket|server|date|upgrade|connection/i.test(k)))));
  ws.on('open', () => {
    conn.connectMs = +(performance.now() - t0).toFixed(0);
    conn.openedAt = Date.now();
    conn.extensions = ws.extensions;
    onOpen(ws, conn);
  });
  ws.on('ping', () => {
    conn.pings++;
    (conn.pingAt ??= []).push(Date.now() - conn.openedAt);
  });
  ws.on('pong', () => conn.pongs++);
  ws.on('message', (data, isBinary) => {
    const recvAt = Date.now();
    const buf = Buffer.isBuffer(data) ? data : Buffer.concat([].concat(data));
    if (isBinary) conn.binaryFrames++;
    else conn.textFrames++;
    conn.bytes += buf.length;
    const text = buf.toString('utf8');
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      conn.control.push({ at: recvAt, nonJson: text.slice(0, 200) });
      return;
    }
    onFrame(j, text, recvAt, conn);
  });
  ws.on('close', (code, reason) => (conn.closed = { code, reason: reason.toString(), afterMs: Date.now() - conn.openedAt }));
  ws.on('error', (e) => conn.control.push({ at: Date.now(), error: e.message }));
  return conn;
}

function recordBook(conn, j, text, recvAt) {
  const ch = j.channel;
  let s = conn.channels.get(ch);
  if (!s) conn.channels.set(ch, (s = channelStats()));
  s.msgs++;
  s.bytes += text.length;
  if (s.firstAt === 0) s.firstAt = recvAt;
  else s.maxGapMs = Math.max(s.maxGapMs, recvAt - s.lastAt);
  s.lastAt = recvAt;
  const d = j.data ?? {};
  const micro = Number(d.microtimestamp);
  if (s.prevMicro !== null) {
    if (micro < s.prevMicro) s.microBackwards++;
    if (micro === s.prevMicro) s.microEqual++;
  }
  s.prevMicro = micro;
  if (Number.isFinite(micro)) s.lagMs.push(recvAt - micro / 1000);
  const body = JSON.stringify({ b: d.bids, a: d.asks });
  if (s.prevData === body) s.identicalRepeats++;
  s.prevData = body;
  const bids = d.bids ?? [];
  const asks = d.asks ?? [];
  if (bids.length === 0 || asks.length === 0) s.emptySides++;
  s.bidLevels.push(bids.length);
  s.askLevels.push(asks.length);
  const strict = !ch.startsWith('detail_'); // the per-order channel repeats a price once per resting order
  const desc = bids.every((x, i) => i === 0 || (strict ? Number(bids[i - 1][0]) > Number(x[0]) : Number(bids[i - 1][0]) >= Number(x[0])));
  const asc = asks.every((x, i) => i === 0 || (strict ? Number(asks[i - 1][0]) < Number(x[0]) : Number(asks[i - 1][0]) <= Number(x[0])));
  desc ? s.bidsDesc++ : s.bidsNotDesc++;
  asc ? s.asksAsc++ : s.asksNotAsc++;
  if (bids.length && asks.length && Number(bids[0][0]) >= Number(asks[0][0]) && ch.startsWith('order_book_')) s.crossed++;
  for (const x of [...bids, ...asks]) {
    if (Number(x[1]) === 0) {
      s.zeroAmounts++;
      (s.zeroSpellings ??= new Set()).add(x[1]);
    }
  }
}

function summarise(conn, seconds) {
  const out = { name: conn.name, connectMs: conn.connectMs, extensions: conn.extensions, upgradeHeaders: conn.upgradeHeaders, pingsFromServer: conn.pings, pingMsSinceOpen: conn.pingAt ?? [], pongs: conn.pongs, textFrames: conn.textFrames, binaryFrames: conn.binaryFrames, bytes: conn.bytes, bytesPerSec: Math.round(conn.bytes / seconds), closed: conn.closed, heartbeatRttMs: conn.heartbeatRtt, control: conn.control.slice(0, 40), controlCount: conn.control.length, channels: {} };
  const q = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] : null);
  for (const [ch, s] of conn.channels) {
    out.channels[ch] = { firstFrameMsAfterSubscribe: conn.subscribedAt ? s.firstAt - conn.subscribedAt : null, msgs: s.msgs, msgsPerSec: +(s.msgs / seconds).toFixed(2), bytes: s.bytes, avgBytes: s.msgs ? Math.round(s.bytes / s.msgs) : 0, maxGapMs: s.maxGapMs, microBackwards: s.microBackwards, microEqual: s.microEqual, identicalRepeats: s.identicalRepeats, crossed: s.crossed, bidsDesc: s.bidsDesc, bidsNotDesc: s.bidsNotDesc, asksAsc: s.asksAsc, asksNotAsc: s.asksNotAsc, zeroAmounts: s.zeroAmounts, zeroSpellings: [...(s.zeroSpellings ?? [])], emptySides: s.emptySides, bidLevels: { min: q(s.bidLevels, 0), med: q(s.bidLevels, 0.5), max: q(s.bidLevels, 0.999) }, askLevels: { min: q(s.askLevels, 0), med: q(s.askLevels, 0.5), max: q(s.askLevels, 0.999) }, lagMs: { min: q(s.lagMs, 0), med: q(s.lagMs, 0.5), p90: q(s.lagMs, 0.9), max: q(s.lagMs, 0.999) } };
  }
  return out;
}

// Diff reconstruction from a REST snapshot, as the documented algorithm asks.
// The diff and full channels are not stamped on the same instants, so each full snapshot is matched against any reconstructed state within 3 s.
// An intact diff chain matches most snapshots, and a lost diff diverges permanently, so the late share of matches is the gap test.
const recon = Object.fromEntries(RECONCILE.map((s) => [s, { buffered: [], book: null, snapshotMicro: null, discarded: 0, applied: 0, reconSigs: [], fullSigs: [], sizeUnit: null, recentFull: new Map() }]));
function applyDiff(book, d) {
  for (const [side, key] of [['bids', 'b'], ['asks', 'a']]) {
    for (const [p, a] of d[side] ?? []) {
      if (Number(a) === 0) book[key].delete(Number(p));
      else book[key].set(Number(p), Number(a));
    }
  }
}
function sigOfBook(book, n = 20) {
  const b = [...book.b.entries()].sort((x, y) => y[0] - x[0]).slice(0, n);
  const a = [...book.a.entries()].sort((x, y) => x[0] - y[0]).slice(0, n);
  return JSON.stringify([b, a]);
}
function sigOfSnapshot(d, n = 20) {
  const f = (xs) => xs.slice(0, n).map(([p, a]) => [Number(p), Number(a)]);
  return JSON.stringify([f(d.bids), f(d.asks)]);
}
function judge(r) {
  const out = { fullSnapshots: r.fullSigs.length, reconStates: r.reconSigs.length, matched: 0, lastThirdTotal: 0, lastThirdMatched: 0, reconMinusFullMs: [] };
  const cut = r.fullSigs.length ? r.fullSigs[Math.floor((r.fullSigs.length * 2) / 3)]?.micro ?? Infinity : Infinity;
  for (const f of r.fullSigs) {
    const hit = r.reconSigs.find((x) => Math.abs(x.micro - f.micro) <= 3_000_000 && x.sig === f.sig);
    if (hit) {
      out.matched++;
      if (out.reconMinusFullMs.length < 400) out.reconMinusFullMs.push(Math.round((hit.micro - f.micro) / 1000));
    }
    if (f.micro >= cut) {
      out.lastThirdTotal++;
      if (hit) out.lastThirdMatched++;
    }
  }
  const xs = [...out.reconMinusFullMs].sort((a, b) => a - b);
  out.reconMinusFullMs = xs.length ? { min: xs[0], med: xs[Math.floor(xs.length / 2)], max: xs[xs.length - 1] } : null;
  return out;
}

const targetedChannels = [
  ...RECONCILE.map((s) => `order_book_${s}`),
  ...RECONCILE.map((s) => `diff_order_book_${s}`),
  'order_book_ewyusd-perp',
  'detail_order_book_asterusd-perp',
  'live_orders_asterusd-perp',
  'live_trades_btcusd-perp',
  ...PERPS.map((s) => `funding_rate_${s}`),
  'order_book_fooxyz-perp',
];
const funding = new Map();
const liveOrders = { events: 0, chainBreaks: 0, nullPre: 0, lastId: null, sample: null };
const acks = [];

const targeted = open(
  'targeted',
  (ws, conn) => {
    for (const channel of targetedChannels) ws.send(JSON.stringify({ event: 'bts:subscribe', data: { channel } }));
    conn.subscribedAt = Date.now();
    const hb = setInterval(() => {
      conn.hbSentAt = performance.now();
      ws.send(JSON.stringify({ event: 'bts:heartbeat' }));
    }, 15_000);
    conn.timers = [hb];
  },
  (j, text, recvAt, conn) => {
    const ch = j.channel ?? '';
    if (j.event === 'bts:subscription_succeeded' || j.event === 'bts:error' || j.event === 'bts:heartbeat' || j.event === 'bts:request_reconnect' || j.event === 'bts:unsubscription_succeeded') {
      if (j.event === 'bts:heartbeat' && conn.hbSentAt) conn.heartbeatRtt.push(+(performance.now() - conn.hbSentAt).toFixed(1));
      conn.control.push({ at: recvAt, sinceSubMs: recvAt - conn.subscribedAt, event: j.event, channel: ch, data: j.data });
      keep(conn.name, text, j.event);
      if (j.event === 'bts:subscription_succeeded') acks.push(ch);
      return;
    }
    if (ch.startsWith('funding_rate_')) {
      const m = ch.slice('funding_rate_'.length);
      let f = funding.get(m);
      if (!f) funding.set(m, (f = { msgs: 0, firstAt: recvAt, lastAt: recvAt, gaps: [], rateChanges: 0, markChanges: 0, indexChanges: 0, prev: null, first: j, keys: Object.keys(j.data ?? {}), event: j.event }));
      else f.gaps.push(recvAt - f.lastAt);
      f.msgs++;
      f.lastAt = recvAt;
      const d = j.data ?? {};
      if (f.prev) {
        if (d.funding_rate !== f.prev.funding_rate) f.rateChanges++;
        if (d.mark_price !== f.prev.mark_price) f.markChanges++;
        if (d.index_price !== f.prev.index_price) f.indexChanges++;
      }
      f.prev = d;
      f.last = j;
      keep(conn.name, text, `funding ${j.event}`);
      return;
    }
    if (ch.startsWith('live_orders_')) {
      liveOrders.events++;
      if (j.pre_event_id === null) liveOrders.nullPre++;
      else if (liveOrders.lastId !== null && j.pre_event_id !== liveOrders.lastId) liveOrders.chainBreaks++;
      liveOrders.lastId = j.event_id;
      if (!liveOrders.sample) liveOrders.sample = text.slice(0, 800);
      recordBook(conn, { channel: ch, data: {} }, text, recvAt);
      return;
    }
    if (ch.startsWith('live_trades_')) {
      recordBook(conn, { channel: ch, data: {} }, text, recvAt);
      keep(conn.name, text, 'trade');
      return;
    }
    if (j.event === 'data' && ch.includes('order_book_')) {
      recordBook(conn, j, text, recvAt);
      const kind = ch.startsWith('diff_') ? 'diff' : ch.startsWith('detail_') ? 'detail' : 'full';
      keep(conn.name, text, `${kind} first frames`);
      const sym = ch.replace(/^(diff_|detail_)?order_book_/, '');
      const r = recon[sym];
      if (!r) return;
      const micro = Number(j.data.microtimestamp);
      if (kind === 'full') {
        r.recentFull.set(micro, j.data);
        if (r.recentFull.size > 50) r.recentFull.delete(r.recentFull.keys().next().value);
        if (r.book !== null) r.fullSigs.push({ micro, sig: sigOfSnapshot(j.data) });
      } else if (kind === 'diff') {
        if (r.book === null) r.buffered.push(j.data);
        else {
          applyDiff(r.book, j.data);
          r.applied++;
          r.reconSigs.push({ micro, sig: sigOfBook(r.book) });
        }
      }
      return;
    }
    conn.control.push({ at: recvAt, other: text.slice(0, 300) });
    keep(conn.name, text, 'other');
  },
);

const batch = open(
  'batch-20-books',
  (ws, conn) => {
    for (const s of PERPS) ws.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: `order_book_${s}` } }));
    conn.subscribedAt = Date.now();
  },
  (j, text, recvAt, conn) => {
    if (j.event === 'data') recordBook(conn, j, text, recvAt);
    else conn.control.push({ at: recvAt, sinceSubMs: recvAt - conn.subscribedAt, event: j.event, channel: j.channel });
  },
);

const idle = open(
  'idle-no-subscription',
  (ws, conn) => {
    conn.subscribedAt = Date.now();
  },
  (j, text, recvAt, conn) => {
    conn.control.push({ at: recvAt, sinceOpenMs: recvAt - conn.openedAt, text: text.slice(0, 300) });
  },
);

// Seeds the reconstruction once the diff buffer has a few frames, as the documented algorithm asks.
async function seed(sym) {
  await sleep(4000);
  const t0 = Date.now();
  const res = await fetch(`${REST}/order_book/${sym}/?group=1`);
  const snap = await res.json();
  const r = recon[sym];
  r.snapshotMicro = Number(snap.microtimestamp);
  r.snapshotFetchMs = Date.now() - t0;
  r.snapshotLevels = { bids: snap.bids.length, asks: snap.asks.length };
  r.book = { b: new Map(snap.bids.map(([p, a]) => [Number(p), Number(a)])), a: new Map(snap.asks.map(([p, a]) => [Number(p), Number(a)])) };
  r.bufferedAtSeed = r.buffered.length;
  for (const d of r.buffered) {
    if (Number(d.microtimestamp) <= r.snapshotMicro) {
      r.discarded++;
      continue;
    }
    applyDiff(r.book, d);
    r.applied++;
  }
  r.buffered = [];
  r.reconSigs.push({ micro: r.snapshotMicro, sig: sigOfBook(r.book) });
  // Size unit: the REST level against the socket's own full snapshot nearest in time, at the same prices.
  const nearest = [...r.recentFull.entries()].sort((x, y) => Math.abs(x[0] - r.snapshotMicro) - Math.abs(y[0] - r.snapshotMicro))[0];
  if (nearest) {
    const restBids = new Map(snap.bids.slice(0, 20));
    const common = nearest[1].bids.slice(0, 20).filter(([p]) => restBids.has(p));
    r.sizeUnit = { socketMicro: nearest[0], restMicro: r.snapshotMicro, commonBidPrices: common.length, equalSizes: common.filter(([p, a]) => Number(restBids.get(p)) === Number(a)).length, example: common.slice(0, 3).map(([p, a]) => ({ price: p, socket: a, rest: restBids.get(p) })) };
  }
}

// Bad frames on their own socket, so an error close cannot disturb the measurements above.
async function badFrames() {
  const replies = [];
  const conn = open('bad-frames', () => {}, (j, text, recvAt) => replies.push({ at: recvAt, text: text.slice(0, 300) }));
  await new Promise((r) => conn.ws.once('open', r));
  const send = async (label, payload) => {
    const before = replies.length;
    conn.ws.send(payload);
    await sleep(1500);
    replies.slice(before).forEach((x) => (x.after = label));
  };
  await send('non-json', 'hello');
  await send('missing channel', JSON.stringify({ event: 'bts:subscribe', data: {} }));
  await send('unknown event', JSON.stringify({ event: 'bts:ping' }));
  await send('spot channel', JSON.stringify({ event: 'bts:subscribe', data: { channel: 'order_book_btcusd' } }));
  await send('uppercase perp', JSON.stringify({ event: 'bts:subscribe', data: { channel: 'order_book_BTCUSD-PERP' } }));
  await send('name spelling', JSON.stringify({ event: 'bts:subscribe', data: { channel: 'order_book_BTC/USD-PERP' } }));
  await send('oversize 700 bytes', JSON.stringify({ event: 'bts:subscribe', data: { channel: `order_book_${'x'.repeat(650)}` } }));
  await sleep(1500);
  const state = conn.ws.readyState;
  conn.ws.close();
  await sleep(500);
  return { replies: replies.map((r) => ({ after: r.after, text: r.text.startsWith('{"event":"data"') ? r.text.slice(0, 120) + '...' : r.text })), control: conn.control, readyStateBeforeClose: state, closed: conn.closed };
}

// A deflate offer on its own socket, to see whether the server would negotiate compression if asked.
async function deflateOffer() {
  const ws = new WebSocket(URL_WS, { perMessageDeflate: true });
  const res = await new Promise((resolve) => {
    let headers = null;
    ws.on('upgrade', (r) => (headers = r.headers['sec-websocket-extensions'] ?? null));
    ws.on('open', () => resolve({ negotiatedExtensions: ws.extensions, responseHeader: headers }));
    ws.on('error', (e) => resolve({ error: e.message }));
  });
  ws.close();
  return res;
}

// Optional mode: node ../scripts/probes/bitstamp-ws-probe.mjs outDir 60 index
// Reads Bitstamp's index from the funding_rate_ channel beside Binance's premiumIndex for the same coins, once a second, to see whether a flat Bitstamp index is a flat market.
if (process.argv[4] === 'index') {
  const pairs = { 'btcusd-perp': 'BTCUSDT', 'asterusd-perp': 'ASTERUSDT', 'linkusd-perp': 'LINKUSDT', 'avaxusd-perp': 'AVAXUSDT' };
  const seen = Object.fromEntries(Object.keys(pairs).map((k) => [k, { bitstamp: [], binance: [] }]));
  const ws = new WebSocket(URL_WS, { perMessageDeflate: false });
  ws.on('open', () => Object.keys(pairs).forEach((m) => ws.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: `funding_rate_${m}` } }))));
  ws.on('message', (raw) => {
    const j = JSON.parse(raw.toString());
    if (j.event === 'funding_rate_saved') seen[j.data.market]?.bitstamp.push(j.data.index_price);
  });
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    const t = Date.now();
    await Promise.all(
      Object.entries(pairs).map(async ([m, sym]) => {
        const r = await (await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`)).json();
        seen[m].binance.push(r.indexPrice);
      }),
    );
    await sleep(1000 - (Date.now() - t));
  }
  ws.close();
  const changes = (xs) => xs.slice(1).filter((x, i) => x !== xs[i]).length;
  const range = (xs) => {
    const n = xs.map(Number);
    return { min: Math.min(...n), max: Math.max(...n), spreadPpm: Math.round((Math.max(...n) / Math.min(...n) - 1) * 1e6) };
  };
  const result = Object.fromEntries(Object.entries(seen).map(([m, v]) => [m, { bitstampReads: v.bitstamp.length, bitstampIndexChanges: changes(v.bitstamp), bitstampRange: range(v.bitstamp), binanceReads: v.binance.length, binanceIndexChanges: changes(v.binance), binanceRange: range(v.binance) }]));
  fs.writeFileSync(path.join(OUT, 'ws-index-compare.json'), JSON.stringify({ ranAt: new Date(end - SECONDS * 1000).toISOString(), seconds: SECONDS, result }, null, 1));
  console.log(JSON.stringify(result, null, 1));
  process.exit(0);
}

// Optional mode: node ../scripts/probes/bitstamp-ws-probe.mjs outDir 30 spacing
// Records the spacing between frames of the full book, the diff book, the spot book and the funding push for BTC, and keeps the raw frames.
if (process.argv[4] === 'spacing') {
  const channels = ['order_book_btcusd-perp', 'diff_order_book_btcusd-perp', 'funding_rate_btcusd-perp', 'order_book_btcusd'];
  const micros = Object.fromEntries(channels.map((c) => [c, []]));
  const raw = fs.createWriteStream(path.join(OUT, 'ws-spacing-raw.jsonl'));
  const ws = new WebSocket(URL_WS, { perMessageDeflate: false });
  ws.on('open', () => {
    channels.forEach((channel) => ws.send(JSON.stringify({ event: 'bts:subscribe', data: { channel } })));
    setTimeout(() => ws.close(), SECONDS * 1000);
  });
  ws.on('message', (m) => {
    const text = m.toString();
    raw.write(`${Date.now()}\t${text}\n`);
    const j = JSON.parse(text);
    if (j.event === 'data') micros[j.channel]?.push(Number(j.data.microtimestamp));
    if (j.event === 'funding_rate_saved') micros[j.channel]?.push(Number(j.data.timestamp) * 1e6);
  });
  await new Promise((r) => ws.on('close', r));
  const bucket = (ms) => (ms < 150 ? 'under 150' : ms < 250 ? '150 to 250' : ms < 500 ? '250 to 500' : ms < 1000 ? '500 to 1000' : '1000 and over');
  const result = Object.fromEntries(
    Object.entries(micros).map(([c, xs]) => {
      const gaps = xs.slice(1).map((x, i) => Math.round((x - xs[i]) / 1000));
      const hist = {};
      gaps.forEach((g) => (hist[bucket(g)] = (hist[bucket(g)] ?? 0) + 1));
      return [c, { frames: xs.length, minGapMs: gaps.length ? Math.min(...gaps) : null, gapHistogramMs: hist }];
    }),
  );
  fs.writeFileSync(path.join(OUT, 'ws-spacing.json'), JSON.stringify({ ranAt: new Date().toISOString(), seconds: SECONDS, result }, null, 1));
  console.log(JSON.stringify(result, null, 1));
  process.exit(0);
}

const started = Date.now();
await Promise.all(RECONCILE.map(seed));
const deflate = await deflateOffer();
const bad = await badFrames();
const remaining = SECONDS * 1000 - (Date.now() - started);
if (remaining > 0) await sleep(remaining);
for (const c of [targeted, batch, idle]) {
  for (const t of c.timers ?? []) clearInterval(t);
}
// A heartbeat on the idle socket at the very end, to show it is still answered after the idle window.
idle.ws.send(JSON.stringify({ event: 'bts:heartbeat' }));
await sleep(1500);
const seconds = (Date.now() - started) / 1000;
for (const c of [targeted, batch, idle]) c.ws.close();
await sleep(800);

const report = {
  ranAt: new Date(started).toISOString(),
  seconds: +seconds.toFixed(1),
  acksReceived: acks.length,
  subscriptionsSent: targetedChannels.length,
  targeted: summarise(targeted, seconds),
  batch: summarise(batch, seconds),
  idle: summarise(idle, seconds),
  reconcile: Object.fromEntries(Object.entries(recon).map(([s, r]) => [s, { snapshotMicro: r.snapshotMicro, snapshotFetchMs: r.snapshotFetchMs, snapshotLevels: r.snapshotLevels, bufferedAtSeed: r.bufferedAtSeed, discarded: r.discarded, applied: r.applied, sizeUnit: r.sizeUnit, ...judge(r) }])),
  funding: Object.fromEntries([...funding.entries()].map(([m, f]) => [m, { msgs: f.msgs, event: f.event, keys: f.keys, gapMs: f.gaps.length ? { min: Math.min(...f.gaps), max: Math.max(...f.gaps), med: [...f.gaps].sort((a, b) => a - b)[Math.floor(f.gaps.length / 2)] } : null, rateChanges: f.rateChanges, markChanges: f.markChanges, indexChanges: f.indexChanges, first: f.first, last: f.last }])),
  fundingChannelsSilent: PERPS.filter((s) => !funding.has(s)),
  liveOrders,
  deflate,
  badFrames: bad,
  samples,
};
fs.writeFileSync(path.join(OUT, 'ws-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(0);
