// EXMO spot WebSocket probe: greeting, subscribe acknowledgement, book snapshot and deltas, level order, REST compare, client ping, server ping, silence, errors and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node ../scripts/probes/venues/exmo/ws-probe.mjs [book|errors|idle|bare|deflate]
//   book     order_book_updates on every listed pair, order_book_snapshots, ticker and trades on BTC_USDC, one socket for 100 s, client protocol ping every 20 s.
//   errors   unknown pair, a pair of the exmo.me catalog, unknown channel, text that is not JSON, duplicate subscribe, unknown method. About 12 s.
//   idle     one socket on a quiet ticker for 190 s to see the documented 3 minute server ping, and one socket with no subscription and no client frame for 120 s.
//   bare     the short rerun of the idle mode's second socket: no subscription and no client frame, for up to 60 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates, then reads the greeting of the exmo.me socket host. About 6 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/exmo/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUBLIC = 'wss://ws-api.exmo.com:443/v1/public';
const URL_ME = 'wss://ws-api.exmo.me:443/v1/public';
const API = 'https://api.exmo.com/v1.1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const trim = (s, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const state = { ws, t0, openMs: undefined, headers: undefined, closed: undefined, pings: [], pongs: [], frames: [] };
  ws.on('upgrade', (res) => (state.headers = res.headers));
  ws.on('open', () => (state.openMs = Math.round(performance.now() - t0)));
  ws.on('ping', () => state.pings.push(Math.round(performance.now() - t0)));
  ws.on('pong', () => state.pongs.push(performance.now()));
  ws.on('close', (code, reason) => (state.closed = { code, reason: reason.toString(), atS: +((performance.now() - t0) / 1000).toFixed(2) }));
  ws.on('error', (e) => log('socket_error', { url, message: e.message }));
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    state.frames.push({ at: performance.now(), wall: Date.now(), text });
  });
  return new Promise((resolve) => {
    ws.once('open', () => resolve(state));
    ws.once('close', () => resolve(state));
  });
}

async function listedPairs() {
  const r = await fetch(`${API}/pair_settings`);
  return Object.keys(await r.json());
}

async function restBook(pairs) {
  const r = await fetch(`${API}/order_book?pair=${pairs.join(',')}&limit=1000`);
  return r.json();
}

const isDesc = (side) => side.every((l, i) => i === 0 || Number(l[0]) < Number(side[i - 1][0]));
const isAsc = (side) => side.every((l, i) => i === 0 || Number(l[0]) > Number(side[i - 1][0]));

async function book() {
  const pairs = await listedPairs();
  const s = await open(URL_PUBLIC);
  log('open', { url: URL_PUBLIC, openMs: s.openMs, extensions: s.headers?.['sec-websocket-extensions'] ?? null, server: s.headers?.server ?? null });
  await sleep(500);
  const greeting = s.frames[0];
  if (greeting) {
    const g = JSON.parse(greeting.text);
    log('greeting', { frame: g, localMinusTsMs: greeting.wall - g.ts });
    capture('greeting.json', greeting.text);
  }

  const topics = [
    ...pairs.map((p) => `spot/order_book_updates:${p}`),
    'spot/order_book_snapshots:BTC_USDC',
    'spot/order_book_snapshots:ETH_USDC',
    'spot/ticker:BTC_USDC',
    'spot/trades:BTC_USDC',
  ];
  const subAt = performance.now();
  const subFrame = { id: 1, method: 'subscribe', topics };
  s.ws.send(JSON.stringify(subFrame));
  log('subscribe_sent', { topics: topics.length, frameBytes: JSON.stringify(subFrame).length });

  const pingTimer = setInterval(() => {
    const sent = performance.now();
    s.ws.ping();
    s.ws.once('pong', () => log('client_ping_pong', { rttMs: Math.round(performance.now() - sent) }));
  }, 20_000);

  const restAt = Date.now();
  const rest = await restBook(pairs);

  await sleep(100_000);
  clearInterval(pingTimer);
  s.ws.close();
  await sleep(300);

  const perTopic = {};
  const offsets = [];
  let acks = 0;
  let other = [];
  let snapshotOrder = { bidsDesc: 0, asksAsc: 0, n: 0 };
  let deltaOrder = { bidsNotDesc: 0, asksNotAsc: 0, n: 0 };
  const snapshotsVsRest = [];
  const firstAckMs = [];
  const firstSnapMs = [];
  const topicSeenBeforeAck = [];
  const acked = new Set();

  for (const f of s.frames.slice(1)) {
    const m = JSON.parse(f.text);
    if (typeof m.ts === 'number') offsets.push(f.wall - m.ts);
    if (m.event === 'subscribed') {
      acks++;
      acked.add(m.topic);
      firstAckMs.push(Math.round(f.at - subAt));
      if (acks <= 2) capture('ack.json', f.text);
      continue;
    }
    if (m.event !== 'snapshot' && m.event !== 'update') {
      other.push(trim(f.text));
      continue;
    }
    const t = (perTopic[m.topic] ??= { snapshot: 0, update: 0, emptyUpdate: 0, lastAt: subAt, maxGapMs: 0, firstAt: undefined, levels: undefined, keys: Object.keys(m).join(',') });
    t.maxGapMs = Math.max(t.maxGapMs, Math.round(f.at - t.lastAt));
    t.lastAt = f.at;
    if (!acked.has(m.topic)) topicSeenBeforeAck.push(m.topic);
    t.firstAt ??= Math.round(f.at - subAt);
    const channel = m.topic.split(':')[0];
    if (m.event === 'snapshot' && channel !== 'spot/order_book_updates') {
      t.snapshot++;
      capture(`${channel.replace('/', '_')}_snapshot.json`, trim(f.text, 2000));
    } else if (m.event === 'snapshot') {
      t.snapshot++;
      firstSnapMs.push(Math.round(f.at - subAt));
      const d = m.data;
      t.levels = { bid: d.bid?.length, ask: d.ask?.length };
      snapshotOrder.n++;
      if (isDesc(d.bid ?? [])) snapshotOrder.bidsDesc++;
      if (isAsc(d.ask ?? [])) snapshotOrder.asksAsc++;
      const pair = m.topic.split(':')[1];
      const r = rest[pair];
      if (r) snapshotsVsRest.push({ pair, sameBid: JSON.stringify(r.bid) === JSON.stringify(d.bid), sameAsk: JSON.stringify(r.ask) === JSON.stringify(d.ask) });
      if (t.snapshot === 1 && (pair === 'BTC_USDC' || pair === 'XRP_USDC')) capture('snapshot.json', f.text);
    } else {
      t.update++;
      if (channel === 'spot/order_book_updates') {
        const d = m.data ?? {};
        if ((d.bid?.length ?? 0) + (d.ask?.length ?? 0) === 0) t.emptyUpdate++;
        deltaOrder.n++;
        if (!isDesc(d.bid ?? [])) deltaOrder.bidsNotDesc++;
        if (!isAsc(d.ask ?? [])) deltaOrder.asksNotAsc++;
        capture('delta.jsonl', f.text);
      } else {
        capture(`${channel.replace('/', '_')}.jsonl`, trim(f.text, 2000));
      }
    }
  }

  log('summary', {
    frames: s.frames.length,
    acks,
    firstAckMs: firstAckMs.length ? [Math.min(...firstAckMs), Math.max(...firstAckMs)] : null,
    firstSnapshotMs: firstSnapMs.length ? [Math.min(...firstSnapMs), Math.max(...firstSnapMs)] : null,
    topicsWithData: Object.keys(perTopic).length,
    topicSeenBeforeAck: topicSeenBeforeAck.length,
    serverPingsAtMs: s.pings,
    closed: s.closed,
    localMinusTsMs: offsets.length ? { min: Math.min(...offsets), max: Math.max(...offsets), n: offsets.length } : null,
    restFetchedAt: new Date(restAt).toISOString(),
  });
  log('snapshot_order', snapshotOrder);
  log('delta_order', deltaOrder);
  log('snapshot_vs_rest', { n: snapshotsVsRest.length, bothSidesEqual: snapshotsVsRest.filter((x) => x.sameBid && x.sameAsk).length, differ: snapshotsVsRest.filter((x) => !(x.sameBid && x.sameAsk)).map((x) => x.pair) });
  for (const [topic, t] of Object.entries(perTopic)) {
    const { lastAt, ...rest } = t;
    log('topic', { topic, ...rest });
  }
  for (const o of other.slice(0, 5)) log('other_frame', { text: o });
}

async function errors() {
  const s = await open(URL_PUBLIC);
  log('open', { openMs: s.openMs });
  const sends = [
    ['unknown pair', JSON.stringify({ id: 11, method: 'subscribe', topics: ['spot/order_book_updates:NOPE_USDC'] })],
    ['pair of the exmo.me catalog', JSON.stringify({ id: 12, method: 'subscribe', topics: ['spot/order_book_updates:BTC_USDT'] })],
    ['unknown channel', JSON.stringify({ id: 13, method: 'subscribe', topics: ['spot/nope:BTC_USDC'] })],
    ['first subscribe', JSON.stringify({ id: 14, method: 'subscribe', topics: ['spot/order_book_updates:BTC_USDC'] })],
    ['duplicate subscribe', JSON.stringify({ id: 15, method: 'subscribe', topics: ['spot/order_book_updates:BTC_USDC'] })],
    ['unsubscribe never subscribed', JSON.stringify({ id: 16, method: 'unsubscribe', topics: ['spot/ticker:ETH_USDC'] })],
    ['unknown method', JSON.stringify({ id: 17, method: 'nope', topics: ['spot/ticker:BTC_USDC'] })],
    ['no id', JSON.stringify({ method: 'subscribe', topics: ['spot/ticker:XRP_USDC'] })],
    ['lower case pair', JSON.stringify({ id: 18, method: 'subscribe', topics: ['spot/order_book_updates:btc_usdc'] })],
    ['text that is not JSON', 'hello'],
  ];
  for (const [name, text] of sends) {
    const before = s.frames.length;
    if (s.ws.readyState !== WebSocket.OPEN) {
      log('error_case', { name, skipped: 'socket closed', closed: s.closed });
      continue;
    }
    s.ws.send(text);
    await sleep(1_000);
    const replies = s.frames.slice(before).map((f) => trim(f.text, 300));
    log('error_case', { name, sent: text, replies });
    for (const r of replies) capture('errors.jsonl', r);
  }
  await sleep(1_000);
  log('after', { stillOpen: s.ws.readyState === WebSocket.OPEN, closed: s.closed });
  s.ws.close();
}

async function idle() {
  const a = await open(URL_PUBLIC);
  const b = await open(URL_PUBLIC);
  a.ws.send(JSON.stringify({ id: 1, method: 'subscribe', topics: ['spot/ticker:XTZ_USDC'] }));
  log('idle_opened', { tickerSocketMs: a.openMs, bareSocketMs: b.openMs });
  const bStop = setTimeout(() => b.ws.close(), 120_000);
  for (let i = 0; i < 19; i++) {
    await sleep(10_000);
    if (a.closed && b.closed) break;
  }
  clearTimeout(bStop);
  a.ws.close();
  await sleep(300);
  const kinds = (st) => st.frames.map((f) => JSON.parse(f.text).event).reduce((o, e) => ((o[e] = (o[e] ?? 0) + 1), o), {});
  log('idle_ticker_socket', { heldS: 190, serverPingsAtMs: a.pings, frames: a.frames.length, events: kinds(a), closed: a.closed });
  log('idle_bare_socket', { plannedS: 120, serverPingsAtMs: b.pings, frames: b.frames.length, events: kinds(b), closed: b.closed });
  const tickerFrames = a.frames.filter((f) => f.text.includes('"update"'));
  if (tickerFrames.length) {
    const gaps = tickerFrames.map((f, i) => (i ? Math.round(f.at - tickerFrames[i - 1].at) : 0)).slice(1);
    log('idle_ticker_updates', { n: tickerFrames.length, gapsMs: gaps.slice(0, 30), first: trim(tickerFrames[0].text, 300) });
    capture('ticker_idle.jsonl', tickerFrames.map((f) => f.text).join('\n'));
  }
}

async function bare() {
  const b = await open(URL_PUBLIC);
  log('bare_opened', { openMs: b.openMs });
  for (let i = 0; i < 12 && !b.closed; i++) await sleep(5_000);
  if (!b.closed) b.ws.close();
  await sleep(300);
  log('bare_socket', { plannedS: 60, serverPingsAtMs: b.pings, frames: b.frames.length, first: b.frames[0] ? trim(b.frames[0].text, 200) : null, closed: b.closed });
}

async function deflate() {
  const s = await open(URL_PUBLIC, { perMessageDeflate: true });
  log('deflate_offer', { openMs: s.openMs, extensions: s.headers?.['sec-websocket-extensions'] ?? null });
  await sleep(1_500);
  s.ws.close();
  const m = await open(URL_ME);
  await sleep(2_000);
  log('exmo_me_socket', { url: URL_ME, openMs: m.openMs, closed: m.closed, firstFrame: m.frames[0] ? trim(m.frames[0].text, 300) : null });
  if (m.ws.readyState === WebSocket.OPEN) {
    m.ws.send(JSON.stringify({ id: 1, method: 'subscribe', topics: ['spot/order_book_updates:BTC_USDT'] }));
    await sleep(2_000);
    log('exmo_me_subscribe', { replies: m.frames.slice(1, 4).map((f) => trim(f.text, 400)) });
  }
  m.ws.close();
}

const modes = { book, errors, idle, bare, deflate };
const mode = process.argv[2] ?? 'book';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
