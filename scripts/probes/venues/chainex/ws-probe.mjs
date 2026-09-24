// ChainEX push socket probe: the WAMP v1 handshake, what the per market topics carry, whether any frame holds book levels or a sequence, keepalive, silence, errors and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate question.
// Run from server/: node ../scripts/probes/venues/chainex/ws-probe.mjs [book|replay|errors|silence|deflate]
//   book     one socket, every marketUpdates-<id> topic plus sidebarStats and topBar for 75 s, with a REST book read after each market event. About 80 s.
//   replay   six active markets: seed a level book from REST, apply every order and order-delete event, and compare with REST every 15 s for 60 s. About 65 s, 30 requests.
//   errors   unknown topics, a duplicate subscribe, a CALL, an unknown message type and text that is not JSON, on one socket for 15 s.
//   silence  an idle socket that never subscribes and a socket subscribed to one dead market, both silent from the client for 70 s.
//   deflate  one socket that offers permessage-deflate for 5 s, and one that offers no WAMP subprotocol, the way VenueFeed opens a socket, and subscribes six active markets for 25 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/chainex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const PUSH_URL = 'wss://push.chainex.io:443/'; // PUSH_SERVER in the chainex.io web bundle
const API = 'https://api.chainex.io';
const APP = 'https://app.chainex.io/action';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const WAMP = { 0: 'WELCOME', 1: 'PREFIX', 2: 'CALL', 3: 'CALLRESULT', 4: 'CALLERROR', 5: 'SUBSCRIBE', 6: 'UNSUBSCRIBE', 7: 'PUBLISH', 8: 'EVENT' };

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Opens a socket and records the handshake, every frame, pings and the close.
function open(label, { protocols = ['wamp'], deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(PUSH_URL, protocols, { perMessageDeflate: deflate, handshakeTimeout: 15_000 });
  const s = { label, ws, t0, frames: [], pings: 0, pingAt: [], pongs: 0, openMs: null, closed: null, lastFrameAt: t0, maxGapMs: 0 };
  ws.on('upgrade', (res) => {
    log('handshake', { label, status: res.statusCode, protocol: res.headers['sec-websocket-protocol'] ?? null, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server, cfRay: res.headers['cf-ray'] });
  });
  ws.on('open', () => { s.openMs = Date.now() - t0; });
  ws.on('ping', () => { s.pings++; s.pingAt.push(Date.now() - t0); }); // ws answers each ping with a pong on its own
  ws.on('pong', () => { s.pongs++; });
  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    s.maxGapMs = Math.max(s.maxGapMs, now - s.lastFrameAt);
    s.lastFrameAt = now;
    const text = isBinary ? `<binary ${data.length} bytes>` : data.toString();
    let msg = null;
    try { msg = JSON.parse(text); } catch { /* not JSON */ }
    s.frames.push({ at: now - t0, text, msg, bytes: data.length });
    capture(`${label}.jsonl`, JSON.stringify({ at: now - t0, text }));
  });
  ws.on('unexpected-response', (_req, res) => {
    log('unexpected_response', { label, status: res.statusCode, headers: res.headers });
  });
  ws.on('error', (e) => log('socket_error', { label, error: String(e.message) }));
  ws.on('close', (code, reason) => { s.closed = { atMs: Date.now() - t0, code, reason: reason.toString() }; });
  s.ready = new Promise((resolve) => {
    ws.once('open', resolve);
    ws.once('close', resolve);
    ws.once('error', resolve);
  });
  return s;
}

const send = (s, arr) => { if (s.ws.readyState === WebSocket.OPEN) s.ws.send(typeof arr === 'string' ? arr : JSON.stringify(arr)); };
const gaps = (xs) => xs.slice(1).map((x, i) => x - xs[i]);
const summary = (s) => ({ label: s.label, openMs: s.openMs, frames: s.frames.length, pings: s.pings, pingGapsMs: gaps(s.pingAt), firstPingMs: s.pingAt[0] ?? null, pongs: s.pongs, maxGapMs: s.maxGapMs, closed: s.closed });

async function markets() {
  const r = await fetch(`${APP}/getMarkets`, { headers: { accept: 'application/json' } });
  const j = await r.json();
  return j.data.map((m) => ({ id: m.market_id, market: m.market, coin: m.coinCode, quote: m.exchangeCode }));
}

async function book() {
  const list = await markets();
  const byTopic = Object.fromEntries(list.map((m) => [`marketUpdates-${m.id}`, m]));
  const s = open('book');
  await s.ready;
  await sleep(500);
  const welcome = s.frames[0];
  log('welcome', { openMs: s.openMs, firstFrame: welcome?.text.slice(0, 300), type: WAMP[welcome?.msg?.[0]] ?? null });
  const subAt = Date.now();
  for (const topic of Object.keys(byTopic)) send(s, [5, topic]);
  send(s, [5, 'sidebarStats']);
  send(s, [5, 'topBar']);
  log('subscribed', { topics: Object.keys(byTopic).length + 2, atMs: subAt - s.t0, sample: JSON.stringify([5, Object.keys(byTopic)[0]]) });

  const restReads = [];
  let lastRest = 0;
  const seenFrames = new Set();
  const until = Date.now() + 75_000;
  while (Date.now() < until) {
    for (const f of s.frames) {
      if (seenFrames.has(f)) continue;
      seenFrames.add(f);
      const m = byTopic[f.msg?.[1]];
      if (f.msg?.[0] !== 8 || !m || restReads.length >= 20 || Date.now() - lastRest < 1000) continue;
      lastRest = Date.now();
      const r = await fetch(`${API}/market/orders/${m.coin}/${m.quote}/ALL/5`);
      const j = await r.json().catch(() => null);
      restReads.push({ market: m.market, afterEventMs: Date.now() - (s.t0 + f.at), messageType: f.msg[2]?.messageType, bid: j?.data?.[0]?.orders?.[0]?.price, ask: j?.data?.[1]?.orders?.[0]?.price });
    }
    await sleep(200);
  }
  s.ws.close(1000);
  await sleep(500);

  const events = s.frames.filter((f) => f.msg?.[0] === 8);
  const other = s.frames.filter((f) => f.msg?.[0] !== 8);
  const perTopic = {};
  const types = {};
  const keys = {};
  for (const f of events) {
    const topic = f.msg[1];
    perTopic[topic] = (perTopic[topic] ?? 0) + 1;
    const p = f.msg[2];
    const t = `${topic.startsWith('marketUpdates-') ? 'marketUpdates' : topic}:${p?.messageType ?? typeof p}`;
    types[t] = (types[t] ?? 0) + 1;
    keys[t] ??= p && typeof p === 'object' ? Object.keys(p) : [];
  }
  const bookish = events.filter((f) => /bids|asks|"buy"|"sell"|orders|depth|sequence|seq|nonce/i.test(JSON.stringify(f.msg[2] ?? '')));
  log('book_summary', { ...summary(s), sinceSubscribeMs: Date.now() - subAt, events: events.length, nonEvents: other.length, perTopic, types, bytes: s.frames.reduce((a, f) => a + f.bytes, 0) });
  log('payload_keys', keys);
  log('bookish_payloads', { count: bookish.length, sample: bookish.slice(0, 3).map((f) => f.text.slice(0, 400)) });
  const firstPerType = {};
  for (const f of events) {
    const k = `${f.msg[1].startsWith('marketUpdates-') ? 'marketUpdates' : f.msg[1]}:${f.msg[2]?.messageType ?? ''}`;
    firstPerType[k] ??= f.text.slice(0, 700);
  }
  log('first_frame_per_type', firstPerType);
  log('first_events_after_subscribe', { rows: events.slice(0, 4).map((f) => ({ afterSubscribeMs: s.t0 + f.at - subAt, type: f.msg[2]?.messageType ?? f.msg[2]?.topic, time: f.msg[2]?.time ?? f.msg[2]?.date })) });
  const deletes = events.filter((f) => f.msg[2]?.messageType === 'order-delete');
  const ageS = deletes.map((f) => Math.round((s.t0 + f.at - Date.parse(`${f.msg[2].time.replace(' ', 'T')}Z`)) / 1000));
  log('order_delete_time_age_s', { n: ageS.length, min: Math.min(...ageS), max: Math.max(...ageS) });
  log('non_event_frames', { sample: other.slice(0, 5).map((f) => f.text.slice(0, 300)) });
  log('rest_after_event', { reads: restReads });
}

const REPLAY_MARKETS = ['USDT/ZAR', 'ETH/ZAR', 'AVAX/ZAR', 'BNB/ZAR', 'BTC/ZAR', 'XRP/USDT'];

async function restBook(m) {
  const r = await fetch(`${API}/market/orders/${m.coin}/${m.quote}/ALL/200`);
  const j = await r.json();
  const side = (t) => new Map((j.data.find((x) => x.type === t)?.orders ?? []).map((o) => [Number(o.price), Number(o.amount)]));
  return { buy: side('buy'), sell: side('sell'), at: Date.now() };
}

function diff(local, rest) {
  let same = 0;
  const bad = [];
  for (const t of ['buy', 'sell']) {
    const prices = new Set([...local[t].keys(), ...rest[t].keys()]);
    for (const p of prices) {
      const a = local[t].get(p) ?? 0;
      const b = rest[t].get(p) ?? 0;
      if (Math.abs(a - b) <= 1e-8) same++;
      else bad.push(`${t} ${p}: local ${a.toFixed(8)} rest ${b.toFixed(8)}`);
    }
  }
  return { same, differ: bad.length, sample: bad.slice(0, 3) };
}

async function replay() {
  const list = await markets();
  const pick = REPLAY_MARKETS.map((n) => list.find((m) => m.market === n)).filter(Boolean);
  const s = open('replay');
  await s.ready;
  await sleep(300);
  for (const m of pick) send(s, [5, `marketUpdates-${m.id}`]);
  await sleep(1500);
  const local = {};
  for (const m of pick) local[m.id] = await restBook(m);
  const applied = Object.fromEntries(pick.map((m) => [m.id, { order: 0, 'order-delete': 0, other: {} }]));
  let cursor = 0;
  const apply = () => {
    for (; cursor < s.frames.length; cursor++) {
      const f = s.frames[cursor];
      if (f.msg?.[0] !== 8) continue;
      const id = f.msg[1].replace('marketUpdates-', '');
      const p = f.msg[2];
      const book = local[id];
      if (!book || s.t0 + f.at < book.at) continue; // before this market's seed arrived
      const kind = p?.messageType ?? p?.topic ?? 'none';
      if ((kind === 'order' || kind === 'order-delete') && (p.order === 'buy' || p.order === 'sell')) {
        const side = book[p.order];
        const price = Number(p.price);
        const next = (side.get(price) ?? 0) + (kind === 'order' ? 1 : -1) * Number(p.amount);
        if (Math.abs(next) <= 1e-9) side.delete(price);
        else side.set(price, next);
        applied[id][kind]++;
      } else {
        applied[id].other[kind] = (applied[id].other[kind] ?? 0) + 1;
        if (kind !== 'NEW_TRADE_BUCKET' && kind !== 'sidebar') log('replay_other_event', { market: id, frame: f.text.slice(0, 400) });
      }
    }
  };
  for (let round = 1; round <= 4; round++) {
    await sleep(15_000);
    apply();
    const rows = [];
    for (const m of pick) {
      const rest = await restBook(m);
      await sleep(300);
      apply();
      rows.push({ market: m.market, ...diff(local[m.id], rest), applied: { ...applied[m.id], other: undefined }, other: applied[m.id].other });
    }
    log('replay_round', { round, atS: Math.round((Date.now() - s.t0) / 1000), rows });
  }
  s.ws.close(1000);
  await sleep(300);
  log('replay_summary', summary(s));
}

async function errors() {
  const s = open('errors');
  await s.ready;
  await sleep(500);
  const mark = () => s.frames.length;
  const steps = [
    ['subscribe unknown market id', [5, 'marketUpdates-999999']],
    ['subscribe unknown topic', [5, 'nope']],
    ['subscribe BTC/ZAR', [5, 'marketUpdates-57']],
    ['subscribe BTC/ZAR again', [5, 'marketUpdates-57']],
    ['unsubscribe BTC/ZAR', [6, 'marketUpdates-57']],
    ['call unknown procedure', [2, 'probe-call-1', 'getOrderBook', 'BTC/ZAR']],
    ['prefix', [1, 'cx', 'http://chainex.io/']],
    ['unknown message type', [99, 'x']],
    ['text that is not JSON', 'hello'],
  ];
  for (const [name, frame] of steps) {
    const before = mark();
    send(s, frame);
    await sleep(1200);
    log('error_case', { name, sent: typeof frame === 'string' ? frame : JSON.stringify(frame), replies: s.frames.slice(before).map((f) => f.text.slice(0, 300)), socketState: s.ws.readyState, closed: s.closed });
    if (s.closed) break;
  }
  await sleep(2000);
  if (!s.closed) s.ws.close(1000);
  await sleep(300);
  log('errors_summary', summary(s));
}

async function silence() {
  const idle = open('idle');
  const quiet = open('quiet-subscribed');
  await Promise.all([idle.ready, quiet.ready]);
  await sleep(500);
  send(quiet, [5, 'marketUpdates-199']); // ZARP/ZAR, no trade for weeks on 2026-09-22
  const until = Date.now() + 70_000;
  while (Date.now() < until && !(idle.closed && quiet.closed)) await sleep(500);
  for (const s of [idle, quiet]) {
    if (!s.closed) s.ws.close(1000);
  }
  await sleep(500);
  log('silence', { heldMs: 70_000, sockets: [summary(idle), summary(quiet)], quietFrames: quiet.frames.slice(0, 3).map((f) => f.text.slice(0, 200)) });
}

async function deflate() {
  const d = open('deflate', { deflate: true });
  const n = open('no-subprotocol', { protocols: [] });
  await Promise.all([d.ready, n.ready]);
  await sleep(500);
  const list = await markets();
  for (const name of REPLAY_MARKETS) {
    const m = list.find((x) => x.market === name);
    if (m) send(n, [5, `marketUpdates-${m.id}`]);
  }
  await sleep(4500);
  if (!d.closed) d.ws.close(1000);
  await sleep(20_000);
  if (!n.closed) n.ws.close(1000);
  await sleep(300);
  log('deflate', { sockets: [d, n].map((s) => ({ ...summary(s), extensions: s.ws.extensions, protocol: s.ws.protocol, firstFrame: s.frames[0]?.text.slice(0, 200) })) });
  const kinds = {};
  for (const f of n.frames) {
    const k = f.msg?.[0] === 8 ? `event:${f.msg[2]?.messageType ?? f.msg[2]?.topic}` : `type ${f.msg?.[0]}`;
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  log('no_subprotocol_frames', { kinds, first: n.frames.slice(0, 2).map((f) => f.text.slice(0, 200)) });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, replay, errors, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, expected one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
