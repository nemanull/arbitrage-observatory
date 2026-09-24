// OSL WebSocket probe: the OSL HK v5 public book channels and the legacy v4 order book stream, keepalive and silence, errors,
// every HK pair on one connection, and the OSL Global spot and delisted perpetual streams.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/venues/osl/ws-probe.mjs [book|session|errors|batch|global|deflate]
//   book     v5 books15 on six pairs, books5 and ticker on BTCUSD, and v4 orderBook on the same six, for 60 s, then a REST compare.
//   session  five sockets that differ only in what the client subscribes and sends, for up to 75 s.
//   errors   unknown, unpublished and malformed subscriptions on v5, and unknown or malformed v4 URLs. About 35 s.
//   batch    all 22 published HK pairs on one v5 socket and one v4 socket for 30 s.
//   global   OSL Global spot books and the perpetual socket's depth and mark streams for 15 s, then one burst socket for 3 s.
//   deflate  offers permessage-deflate once per host and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/osl/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const V5 = 'wss://stream-hk.osl.com/ws/v5/public';
const V4 = 'wss://trade-hk.osl.com/ws/v4';
const GLB_SPOT = 'wss://stream-api.osl.com/v2/ws/public';
const GLB_PERP = 'wss://stream-api.osl.com/openapi/v1/ws';
const HK = 'https://trade-hk.osl.com';
const TRACKED = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BTCHKD', 'SEIUSD', 'POLHKD'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const count = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const isDesc = (lv) => lv.every((l, i) => i === 0 || Number(l[0]) < Number(lv[i - 1][0]));
const isAsc = (lv) => lv.every((l, i) => i === 0 || Number(l[0]) > Number(lv[i - 1][0]));
const decimals = (s) => (String(s).split('.')[1] ?? '').length;
const stats = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] } : null; };
// The v4 server sends {"action": "ping"} with a space, so a ping is recognised by parsing, never by substring.
const isV4Ping = (text) => { try { return JSON.parse(text).action === 'ping'; } catch { return false; } };
const sub5 = (channel, instIds) => JSON.stringify({ op: 'subscribe', args: instIds.map((instId) => ({ instType: 'SPOT', channel, instId })) });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url, opts = {}) {
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const t0 = performance.now();
  const info = { url, pings: [], closed: null, openMs: null, extensions: null, refused: null };
  ws.on('upgrade', (res) => { info.upgrade = { status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null, colo: (res.headers['cf-ray'] ?? '').split('-')[1] ?? null }; });
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => { info.refused = { status: res.statusCode, type: res.headers['content-type'] ?? null, body: body.slice(0, 300) }; });
  });
  ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; });
  ws.on('ping', (d) => info.pings.push({ atMs: Math.round(performance.now() - t0), data: d.toString() }));
  ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  ws.on('error', (e) => { info.error = e.message; });
  const ready = new Promise((resolve) => { ws.once('open', () => resolve(true)); ws.once('error', () => resolve(false)); ws.once('unexpected-response', () => resolve(false)); });
  return { ws, info, ready, t0 };
}

// v5 books channels push a whole snapshot each time, so the stats compare each frame with the previous one of the same stream.
function v5Tracker() {
  const streams = {};
  const other = [];
  return {
    streams,
    other,
    onFrame(text, at, bytes) {
      let j; try { j = JSON.parse(text); } catch { other.push({ at: Math.round(at), text: text.slice(0, 300) }); return; }
      if (!j.arg || !j.data) { other.push({ at: Math.round(at), frame: j }); return; }
      const key = `${j.arg.channel}:${j.arg.instId}`;
      const s = (streams[key] ??= { frames: 0, bytes: 0, actions: {}, intervals: [], identical: 0, bidLevels: [], askLevels: [], bidsNotDesc: 0, asksNotAsc: 0, sizeDecimals: {}, types: new Set(), ageMs: [], pushMinusData: [], envelopeTs: 0, first: null, last: null, lastAt: null, prev: null, keys: null });
      s.frames++; s.bytes += bytes;
      s.actions[j.action] = (s.actions[j.action] ?? 0) + 1;
      if (s.lastAt !== null) s.intervals.push(Math.round(at - s.lastAt));
      s.lastAt = at;
      if (j.ts !== undefined) s.envelopeTs++;
      const d = j.data[0];
      s.keys ??= { frame: Object.keys(j), data: Object.keys(d) };
      if (d.ts !== undefined) s.ageMs.push(Date.now() - Number(d.ts));
      if (d.ts !== undefined && j.ts !== undefined) s.pushMinusData.push(Number(j.ts) - Number(d.ts));
      if (d.bids) {
        const body = JSON.stringify([d.bids, d.asks]);
        if (s.prev === body) s.identical++;
        s.prev = body;
        s.bidLevels.push(d.bids.length); s.askLevels.push(d.asks.length);
        if (!isDesc(d.bids)) s.bidsNotDesc++;
        if (!isAsc(d.asks)) s.asksNotAsc++;
        for (const [p, q] of [...d.bids, ...d.asks]) { s.types.add(`${typeof p}/${typeof q}`); const k = decimals(q); s.sizeDecimals[k] = (s.sizeDecimals[k] ?? 0) + 1; }
      } else {
        const body = JSON.stringify(d);
        if (s.prev === body) s.identical++;
        s.prev = body;
      }
      s.first ??= text.slice(0, 700);
      s.last = { at, d };
    },
    summary() {
      return Object.fromEntries(Object.entries(streams).map(([k, s]) => [k, { frames: s.frames, bytes: s.bytes, actions: s.actions, intervalMs: stats(s.intervals), identicalToPrevious: s.identical, bidLevels: stats(s.bidLevels), askLevels: stats(s.askLevels), bidsNotDesc: s.bidsNotDesc, asksNotAsc: s.asksNotAsc, sizeDecimals: s.sizeDecimals, types: [...s.types], ageMs: stats(s.ageMs), pushMinusDataMs: stats(s.pushMinusData), envelopeTs: s.envelopeTs, keys: s.keys }]));
    },
  };
}

// v4 orderBookL2 sends a partial, then insert, update and delete rows keyed by price and side, each message carrying bookVersionId.
function v4Tracker() {
  const syms = {};
  const other = [];
  const order = []; // [symbol, bookVersionId] in arrival order, bounded
  return {
    syms,
    other,
    order,
    onFrame(text, at, bytes) {
      let j; try { j = JSON.parse(text); } catch { other.push({ at: Math.round(at), text: text.slice(0, 300) }); return; }
      if (j.table !== 'orderBookL2') { other.push({ at: Math.round(at), frame: j }); return; }
      const s = (syms[j.symbol] ??= { frames: 0, bytes: 0, actions: {}, rows: [], ids: [], idDeltas: [], idDecreases: 0, idEqual: 0, partials: 0, heartbeats: 0, bids: new Map(), asks: new Map(), maxBids: 0, maxAsks: 0, sendTimes: new Set(), publishMinusSend: [], ageMs: [], deleteUnknown: 0, insertExisting: 0, updateUnknown: 0, sizeDecimals: {}, keys: {}, first: {} });
      s.frames++; s.bytes += bytes;
      s.actions[j.action] = (s.actions[j.action] ?? 0) + 1;
      s.keys[j.action] ??= Object.keys(j);
      s.first[j.action] ??= text.slice(0, 600);
      if (j.action === 'heartbeat') { s.heartbeats++; return; }
      if (j.bookVersionId !== undefined) {
        const last = s.ids.length ? s.ids[s.ids.length - 1] : null;
        // Messages that share a bookVersionId belong to one change, so the book is only whole once the next id arrives.
        if (last !== null && j.bookVersionId !== last) { s.maxBidsSettled = Math.max(s.maxBidsSettled ?? 0, s.bids.size); s.maxAsksSettled = Math.max(s.maxAsksSettled ?? 0, s.asks.size); }
        if (last !== null) {
          const dlt = j.bookVersionId - last;
          if (dlt < 0) s.idDecreases++;
          if (dlt === 0) s.idEqual++;
          s.idDeltas.push(dlt);
        }
        s.ids.push(j.bookVersionId);
        if (order.length < 20000) order.push([j.symbol, j.bookVersionId, j.action]);
      }
      if (j.sendTime) { s.sendTimes.add(j.sendTime); s.ageMs.push(Date.now() - j.sendTime); }
      if (j.publishTime && j.sendTime) s.publishMinusSend.push(j.publishTime - j.sendTime);
      s.rows.push(j.data?.length ?? 0);
      if (j.action === 'partial') { s.partials++; s.bids.clear(); s.asks.clear(); s.partialSides = count((j.data ?? []).map((r) => r.side)); }
      for (const r of j.data ?? []) {
        const side = r.side === 'Buy' ? s.bids : s.asks;
        if (r.size !== undefined) { const k = decimals(r.size); s.sizeDecimals[k] = (s.sizeDecimals[k] ?? 0) + 1; }
        if (j.action === 'delete') { if (!side.delete(r.price)) s.deleteUnknown++; }
        else if (j.action === 'insert') { if (side.has(r.price)) s.insertExisting++; side.set(r.price, r.size); }
        else if (j.action === 'update') { if (!side.has(r.price)) s.updateUnknown++; side.set(r.price, r.size); }
        else side.set(r.price, r.size);
      }
      s.maxBids = Math.max(s.maxBids, s.bids.size); s.maxAsks = Math.max(s.maxAsks, s.asks.size);
    },
    top(sym, n) {
      const s = syms[sym];
      if (!s) return null;
      return { bids: [...s.bids].sort((a, b) => b[0] - a[0]).slice(0, n), asks: [...s.asks].sort((a, b) => a[0] - b[0]).slice(0, n) };
    },
    summary() {
      return Object.fromEntries(Object.entries(syms).map(([k, s]) => {
        const perSec = count([...s.sendTimes].map((t) => Math.floor(t / 1000)));
        return [k, { frames: s.frames, bytes: s.bytes, actions: s.actions, partials: s.partials, heartbeats: s.heartbeats, rowsPerFrame: stats(s.rows), idDelta: stats(s.idDeltas), idDecreases: s.idDecreases, idEqualToPrevious: s.idEqual, idSign: count(s.ids.map((x) => Math.sign(x))), idFirstLast: [s.ids[0], s.ids[s.ids.length - 1]], distinctSendTimes: s.sendTimes.size, sendTimesPerSecond: stats(Object.values(perSec)), publishMinusSendMs: stats(s.publishMinusSend), ageMs: stats(s.ageMs), maxBids: s.maxBids, maxAsks: s.maxAsks, maxBidsSettled: s.maxBidsSettled, maxAsksSettled: s.maxAsksSettled, partialSides: s.partialSides, finalBids: s.bids.size, finalAsks: s.asks.size, deleteUnknown: s.deleteUnknown, insertExisting: s.insertExisting, updateUnknown: s.updateUnknown, sizeDecimals: s.sizeDecimals, keys: s.keys }];
      }));
    },
    crossSymbol() {
      let decreases = 0; let plusOne = 0;
      for (let i = 1; i < order.length; i++) {
        const dlt = order[i][1] - order[i - 1][1];
        if (dlt < 0) decreases++;
        if (dlt === 1) plusOne++;
      }
      return { messages: order.length, mergedDecreases: decreases, mergedPlusOne: plusOne };
    },
  };
}

async function book() {
  const WINDOW = 60_000;
  const a = open(V5);
  const b = open(`${V4}?subscribe=${TRACKED.map((s) => `orderBook:${s}`).join(',')}`);
  const t5 = v5Tracker();
  const t4 = v4Tracker();
  let subAt = null;
  const firstAfterSub = {};
  a.ws.on('message', (d) => {
    const text = d.toString(); const at = performance.now() - a.t0;
    capture('v5_book.jsonl', text);
    t5.onFrame(text, at, d.length);
    try { const j = JSON.parse(text); if (j.arg && subAt !== null) { const k = `${j.event ?? j.action}:${j.arg.channel}:${j.arg.instId}`; firstAfterSub[k] ??= Math.round(performance.now() - subAt); } } catch {}
  });
  b.ws.on('message', (d) => { const text = d.toString(); capture('v4_book.jsonl', text); t4.onFrame(text, performance.now() - b.t0, d.length); });
  b.ws.on('message', (d) => { if (isV4Ping(d.toString())) b.ws.send(JSON.stringify({ action: 'pong' })); });
  await Promise.all([a.ready, b.ready]);
  subAt = performance.now();
  a.ws.send(sub5('books15', TRACKED));
  a.ws.send(sub5('books5', ['BTCUSD']));
  a.ws.send(sub5('ticker', ['BTCUSD']));
  const pinger = setInterval(() => a.ws.send('ping'), 20_000);
  await sleep(WINDOW);
  clearInterval(pinger);
  // The REST book is read while both sockets are still open, and each source is compared at its latest frame.
  const restAt = Date.now();
  const rest = await (await fetch(`${HK}/api/v5/order/depth?symbol=BTCUSD&limit=20`)).json();
  const v5last = t5.streams['books15:BTCUSD']?.last;
  const v4top = t4.top('BTCUSD', 15);
  const numEq = (x, y) => x && y && Number(x[0]) === Number(y[0]) && Number(x[1]) === Number(y[1]);
  const cmp = (src) => src ? { bidsEqual: rest.bids.slice(0, 15).filter((l, i) => numEq(l, src.bids[i])).length, asksEqual: rest.asks.slice(0, 15).filter((l, i) => numEq(l, src.asks[i])).length } : null;
  log('book_compare', {
    restId: rest.lastUpdateId, restTop: [rest.bids[0], rest.asks[0]],
    v5AgeMs: v5last ? Math.round(restAt - (performance.timeOrigin + a.t0 + v5last.at)) : null, v5Top: v5last ? [v5last.d.bids[0], v5last.d.asks[0]] : null, v5VsRest: cmp(v5last?.d),
    v4Top: v4top ? [v4top.bids[0], v4top.asks[0]] : null, v4VsRest: cmp(v4top),
    v5VsV4: v5last && v4top ? { bidsEqual: v5last.d.bids.filter((l, i) => numEq(l, v4top.bids[i])).length, asksEqual: v5last.d.asks.filter((l, i) => numEq(l, v4top.asks[i])).length } : null,
  });
  a.ws.close(); b.ws.close();
  await sleep(300);
  log('v5_book', { open: a.info, firstAfterSubscribeMs: firstAfterSub, streams: t5.summary(), other: t5.other.slice(0, 12) });
  for (const [k, s] of Object.entries(t5.streams)) log('v5_first_frame', { stream: k, text: s.first });
  log('v4_book', { open: b.info, symbols: t4.summary(), merged: t4.crossSymbol(), other: t4.other.slice(0, 12) });
  for (const [k, s] of Object.entries(t4.syms)) log('v4_first_frames', { symbol: k, first: s.first });
}

async function session() {
  const LIMIT = 75_000;
  const socks = {
    v5_nothing: open(V5),
    v5_ping_text_only: open(V5),
    v5_sub_no_ping: open(V5),
    v4_quiet_answers_ping: open(`${V4}?subscribe=orderBook:POLHKD`),
    v4_quiet_ignores_ping: open(`${V4}?subscribe=orderBook:POLHKD`),
  };
  const traffic = {};
  for (const [name, s] of Object.entries(socks)) {
    traffic[name] = { frames: 0, lastAt: null, maxGapMs: 0, actions: {}, pingAtMs: [], samples: [] };
    s.ws.on('message', (d) => {
      const t = traffic[name]; const at = performance.now() - s.t0; const text = d.toString();
      t.frames++;
      if (t.lastAt !== null) t.maxGapMs = Math.max(t.maxGapMs, Math.round(at - t.lastAt));
      t.lastAt = at;
      try { const j = JSON.parse(text); const k = j.action ?? j.event ?? 'other'; t.actions[k] = (t.actions[k] ?? 0) + 1; if (j.action === 'ping' && t.pingAtMs.length < 20) t.pingAtMs.push(Math.round(at)); } catch { t.actions[text] = (t.actions[text] ?? 0) + 1; }
      if (!text.includes('"bids"') && !text.includes('"data":[{"symbol"') && !isV4Ping(text) && t.samples.length < 10) t.samples.push({ atMs: Math.round(at), text: text.slice(0, 200) });
      if (name === 'v4_quiet_answers_ping' && isV4Ping(text)) s.ws.send(JSON.stringify({ action: 'pong' }));
    });
  }
  await Promise.all(Object.values(socks).map((s) => s.ready));
  socks.v5_sub_no_ping.ws.send(sub5('books5', ['SEIUSD']));
  const pinger = setInterval(() => { if (socks.v5_ping_text_only.ws.readyState === 1) socks.v5_ping_text_only.ws.send('ping'); }, 20_000);
  const start = performance.now();
  while (performance.now() - start < LIMIT && Object.values(socks).some((s) => !s.info.closed)) await sleep(500);
  clearInterval(pinger);
  for (const s of Object.values(socks)) if (!s.info.closed) s.ws.close();
  await sleep(300);
  for (const [name, s] of Object.entries(socks)) log('session', { name, openMs: s.info.openMs, closed: s.info.closed, protocolPings: s.info.pings.length, pingSample: s.info.pings.slice(0, 3), ...traffic[name] });
}

async function errors() {
  const a = open(V5);
  const frames = [];
  const bookFrames = {};
  a.ws.on('message', (d) => {
    const text = d.toString();
    try {
      const j = JSON.parse(text);
      if (j.action && j.arg) {
        // A duplicate subscription would show as the same data ts arriving twice, and an unsubscribe as frames stopping.
        const k = `${j.arg.channel}:${j.arg.instId}`;
        const b = (bookFrames[k] ??= { frames: 0, firstAtMs: null, lastAtMs: null, repeatedTs: 0, seen: new Set() });
        const at = Math.round(performance.now() - a.t0);
        b.frames++; b.firstAtMs ??= at; b.lastAtMs = at;
        const ts = j.data?.[0]?.ts;
        if (b.seen.has(ts)) b.repeatedTs++;
        b.seen.add(ts);
        return;
      }
    } catch {}
    frames.push({ atMs: Math.round(performance.now() - a.t0), text: text.slice(0, 400) });
  });
  await a.ready;
  const sends = [
    sub5('books15', ['NOPEUSD']),
    sub5('books15', ['XRPUSD']),
    sub5('books50', ['BTCUSD']),
    JSON.stringify({ op: 'subscribe', args: [{ instType: 'MARGIN', channel: 'books15', instId: 'BTCUSD' }] }),
    JSON.stringify({ op: 'foo', args: [] }),
    'hello',
    sub5('books15', ['BTCUSD']),
    sub5('books15', ['BTCUSD']),
    sub5('books15', ['btcusd']),
    'ping',
    JSON.stringify({ op: 'ping' }),
    JSON.stringify({ id: '1', op: 'ping' }),
    JSON.stringify({ op: 'unsubscribe', args: [{ instType: 'SPOT', channel: 'books15', instId: 'BTCUSD' }] }),
  ];
  for (const s of sends) { frames.push({ atMs: Math.round(performance.now() - a.t0), sent: s }); a.ws.send(s); await sleep(900); }
  await sleep(2500);
  a.ws.close();
  await sleep(300);
  for (const b of Object.values(bookFrames)) delete b.seen;
  log('v5_errors', { open: a.info, bookFramesPerStream: bookFrames, frames });
  for (const q of ['subscribe=orderBook:NOPEUSD', 'subscribe=orderBook:BTCUSD,orderBook:NOPEUSD', 'subscribe=orderBook:XRPUSD', '', 'subscribe=orderBook:btcusd']) {
    const s = open(q ? `${V4}?${q}` : V4);
    const got = [];
    s.ws.on('message', (d) => { if (got.length < 3) got.push(d.toString().slice(0, 250)); });
    const ok = await s.ready;
    if (ok) { s.ws.send('hello'); await sleep(2500); s.ws.close(); } else await sleep(500);
    await sleep(300);
    log('v4_url', { query: q, opened: ok, refused: s.info.refused, error: s.info.error, closed: s.info.closed, frames: got });
  }
}

async function batch() {
  const syms = (await (await fetch(`${HK}/api/v5/book/ticker`)).json()).map((x) => x.symbol);
  const a = open(V5);
  const b = open(`${V4}?subscribe=${syms.map((s) => `orderBook:${s}`).join(',')}`);
  const t5 = v5Tracker();
  const t4 = v4Tracker();
  const parse = { v5: [], v4: [] };
  const perSec = { v5: {}, v4: {} };
  const tally = (k, text) => { const t0 = performance.now(); JSON.parse(text); parse[k].push((performance.now() - t0) * 1000); const sec = Math.floor(Date.now() / 1000); perSec[k][sec] = (perSec[k][sec] ?? 0) + 1; };
  a.ws.on('message', (d) => { const text = d.toString(); tally('v5', text); t5.onFrame(text, performance.now() - a.t0, d.length); });
  b.ws.on('message', (d) => { const text = d.toString(); tally('v4', text); t4.onFrame(text, performance.now() - b.t0, d.length); if (isV4Ping(text)) b.ws.send(JSON.stringify({ action: 'pong' })); });
  await Promise.all([a.ready, b.ready]);
  a.ws.send(sub5('books15', syms));
  await sleep(30_000);
  a.ws.close(); b.ws.close();
  await sleep(300);
  const sum5 = t5.summary(); const sum4 = t4.summary();
  const v5bytes = Object.values(sum5).reduce((x, s) => x + s.bytes, 0);
  const v4bytes = Object.values(sum4).reduce((x, s) => x + s.bytes, 0);
  const inner = (o) => Object.values(o).slice(1, -1);
  log('batch', {
    pairs: syms.length, v4UrlLength: b.info.url.length,
    v5: { open: a.info, streams: Object.keys(sum5).length, frames: Object.values(sum5).reduce((x, s) => x + s.frames, 0), bytesPerSecond: Math.round(v5bytes / 30), framesPerSecond: stats(inner(perSec.v5)), parseUs: stats(parse.v5.map((x) => Math.round(x))), perStreamFrames: stats(Object.values(sum5).map((s) => s.frames)), identicalShare: Object.values(sum5).reduce((x, s) => x + s.identicalToPrevious, 0), levels: stats(Object.values(sum5).map((s) => s.bidLevels?.max ?? 0)), other: t5.other.slice(0, 3) },
    v4: { open: b.info, symbols: Object.keys(sum4).length, frames: Object.values(sum4).reduce((x, s) => x + s.frames, 0), bytesPerSecond: Math.round(v4bytes / 30), framesPerSecond: stats(inner(perSec.v4)), parseUs: stats(parse.v4.map((x) => Math.round(x))), partials: Object.values(sum4).reduce((x, s) => x + s.partials, 0), maxLevels: stats(Object.values(sum4).map((s) => Math.max(s.maxBids, s.maxAsks))), idDecreases: Object.values(sum4).reduce((x, s) => x + s.idDecreases, 0), merged: t4.crossSymbol(), deleteUnknown: Object.values(sum4).reduce((x, s) => x + s.deleteUnknown, 0), other: t4.other.slice(0, 3) },
  });
  log('batch_v5_levels', Object.fromEntries(Object.entries(sum5).map(([k, s]) => [k, [s.bidLevels?.max, s.askLevels?.max, s.frames]])));
  log('batch_v4_levels', Object.fromEntries(Object.entries(sum4).map(([k, s]) => [k, { partial: s.partialSides, settled: [s.maxBidsSettled ?? null, s.maxAsksSettled ?? null], transient: [s.maxBids, s.maxAsks], frames: s.frames }])));
}

async function global() {
  const a = open(GLB_SPOT);
  const b = open(GLB_PERP);
  const t5 = v5Tracker();
  const perp = { frames: 0, byParam: {}, samples: [], other: [] };
  a.ws.on('message', (d) => { const text = d.toString(); capture('glb_spot.jsonl', text); t5.onFrame(text, performance.now() - a.t0, d.length); });
  b.ws.on('message', (d) => {
    const text = d.toString(); capture('glb_perp.jsonl', text);
    perp.frames++;
    let j; try { j = JSON.parse(text); } catch { perp.other.push(text.slice(0, 200)); return; }
    if (j.param) { perp.byParam[j.param] = (perp.byParam[j.param] ?? 0) + 1; if (perp.samples.length < 4 || !perp.samples.some((x) => x.startsWith(`{"eventType":"${j.eventType}"`))) perp.samples.push(text.slice(0, 700)); } else perp.other.push(text.slice(0, 300));
  });
  await Promise.all([a.ready, b.ready]);
  // One subscribe frame carries every stream, because two frames sent back to back closed the socket with 30007 once on 2026-09-22.
  a.ws.send(JSON.stringify({ op: 'subscribe', args: [['books15', 'BTCUSD'], ['books15', 'POLUSD'], ['books5', 'BTCUSD']].map(([channel, instId]) => ({ instType: 'SPOT', channel, instId })) }));
  b.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdc@depth50', 'shibusdc@depth50', 'ethusdc@depth50', '!markPrice@arr', 'btcusdc@24hrTicker'], id: '1' }));
  await sleep(5000);
  a.ws.send('ping'); b.ws.send('ping');
  b.ws.send(JSON.stringify({ method: 'LIST_SUBSCRIPTIONS', id: '2' }));
  b.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['nopeusdc@depth50'], id: '3' }));
  await sleep(10_000);
  a.ws.close(); b.ws.close();
  // The burst socket repeats the two back to back frames once, to see whether the 30007 refusal recurs.
  const c = open(GLB_SPOT);
  const burst = [];
  c.ws.on('message', (d) => burst.push(d.toString().slice(0, 200)));
  await c.ready;
  c.ws.send(sub5('books15', ['BTCUSD']));
  c.ws.send(sub5('books5', ['BTCUSD']));
  await sleep(3000);
  if (!c.info.closed) c.ws.close();
  await sleep(300);
  log('glb_spot', { open: a.info, streams: t5.summary(), other: t5.other.slice(0, 6) });
  log('glb_spot_burst', { closed: c.info.closed, frames: burst.slice(0, 5) });
  for (const [k, s] of Object.entries(t5.streams)) log('glb_spot_first', { stream: k, text: s.first });
  log('glb_perp', { open: b.info, frames: perp.frames, byParam: perp.byParam, other: perp.other.slice(0, 8) });
  for (const s of perp.samples) log('glb_perp_sample', { text: s });
}

async function deflate() {
  for (const url of [V5, `${V4}?subscribe=orderBook:BTCUSD`, GLB_SPOT, GLB_PERP]) {
    const s = open(url, { perMessageDeflate: true });
    await s.ready;
    await sleep(800);
    s.ws.close();
    await sleep(200);
    log('deflate', { url, openMs: s.info.openMs, negotiated: s.info.extensions, header: s.info.upgrade });
  }
}

const mode = process.argv[2] ?? 'book';
const run = { book, session, errors, batch, global, deflate }[mode];
if (!run) { console.error(`unknown mode ${mode}`); process.exit(1); }
await run();
process.exit(0);
