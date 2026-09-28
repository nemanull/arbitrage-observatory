// Gleec BTC public WebSocket probe: orderbook/full on every perpetual, orderbook/D20/100ms, orderbook/top, futures/info, errors, server pings, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like the engine's book feeds.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/gleec-btc/ws-probe.mjs [book|silence|deflate]
//   book     60 s: orderbook/full on all working perpetuals on one socket (snapshot, sequence step, level order, window, REST compare),
//            orderbook/D20/100ms and orderbook/top/100ms and futures/info on a second socket, plus unknown symbol and bad frames.
//   silence  70 s: one socket that subscribes nothing and sends nothing, one that subscribes a quiet book, both log server pings and closes.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/gleec-btc/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUBLIC = 'wss://api.exchange.gleec.com/api/3/ws/public';
const API = 'https://api.exchange.gleec.com/api/3';
const OUT = process.env.PROBE_OUT_DIR;
const mode = process.argv[2] ?? 'book';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(name, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(URL_PUBLIC, { perMessageDeflate: false, ...opts });
  ws.on('open', () => log('open', { name, ms: Math.round(performance.now() - t0), ext: ws.extensions || null }));
  ws.on('ping', () => log('serverPing', { name, atS: +((performance.now() - t0) / 1000).toFixed(1) }));
  ws.on('close', (code, reason) => log('close', { name, code, reason: String(reason), atS: +((performance.now() - t0) / 1000).toFixed(2) }));
  ws.on('error', (e) => log('wsError', { name, message: e.message }));
  return new Promise((resolve) => ws.once('open', () => resolve(ws)));
}

async function book() {
  const symbols = JSON.parse(await (await fetch(API + '/public/symbol')).text());
  const perps = Object.entries(symbols).filter(([, v]) => v.type === 'futures' && v.status === 'working').map(([k]) => k);
  const st = {};
  const books = {};
  let fullFrames = 0;
  let fullBytes = 0;
  let parseUs = 0;
  let seenFirstUpdate = {};
  const a = await open('full');
  const tSub = performance.now();
  a.on('message', (buf) => {
    const text = buf.toString();
    const p0 = performance.now();
    const m = JSON.parse(text);
    parseUs += (performance.now() - p0) * 1000;
    fullFrames++;
    fullBytes += text.length;
    if (m.result || m.error) { log('fullReply', { m: JSON.stringify(m).slice(0, 400) }); capture('full-replies.txt', text); return; }
    const kind = m.snapshot ? 'snapshot' : m.update ? 'update' : 'other';
    if (kind === 'other') { log('fullOther', { m: text.slice(0, 300) }); return; }
    for (const [sym, v] of Object.entries(m[kind])) {
      const s = (st[sym] ??= { snapshots: 0, updates: 0, steps: {}, gaps: 0, emptyUpdates: 0, bidsNotDesc: 0, asksNotAsc: 0, maxBids: 0, maxAsks: 0, zeroInSnapshot: 0, firstSnapMs: null, maxQuietS: 0, lastAt: performance.now(), lastSeq: null });
      const now = performance.now();
      s.maxQuietS = Math.max(s.maxQuietS, (now - s.lastAt) / 1000);
      s.lastAt = now;
      const bids = v.b ?? [];
      const asks = v.a ?? [];
      if (!bids.every((x, i) => i === 0 || +x[0] < +bids[i - 1][0])) s.bidsNotDesc++;
      if (!asks.every((x, i) => i === 0 || +x[0] > +asks[i - 1][0])) s.asksNotAsc++;
      if (kind === 'snapshot') {
        s.snapshots++;
        if (s.firstSnapMs === null) s.firstSnapMs = Math.round(now - tSub);
        s.zeroInSnapshot += [...bids, ...asks].filter((x) => +x[1] === 0).length;
        books[sym] = { b: new Map(bids.map((x) => [x[0], x[1]])), a: new Map(asks.map((x) => [x[0], x[1]])) };
        capture('full-snapshot.txt', JSON.stringify({ sym, t: v.t, s: v.s, b: bids.slice(0, 3), a: asks.slice(0, 3), nb: bids.length, na: asks.length }));
      } else {
        s.updates++;
        if (!bids.length && !asks.length) s.emptyUpdates++;
        const step = s.lastSeq === null ? 'none' : String(v.s - s.lastSeq);
        s.steps[step] = (s.steps[step] ?? 0) + 1;
        if (s.lastSeq !== null && v.s !== s.lastSeq + 1) s.gaps++;
        if (!seenFirstUpdate[sym]) { seenFirstUpdate[sym] = true; capture('full-update.txt', JSON.stringify({ sym, t: v.t, s: v.s, b: bids.slice(0, 3), a: asks.slice(0, 3) })); }
        const bk = books[sym];
        if (bk) {
          for (const [p, q] of bids) (+q === 0 ? bk.b.delete(p) : bk.b.set(p, q));
          for (const [p, q] of asks) (+q === 0 ? bk.a.delete(p) : bk.a.set(p, q));
        }
      }
      s.lastSeq = v.s;
      if (books[sym]) { s.maxBids = Math.max(s.maxBids, books[sym].b.size); s.maxAsks = Math.max(s.maxAsks, books[sym].a.size); }
    }
  });
  a.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/full', params: { symbols: perps }, id: 1 }));

  const b = await open('partial');
  const partial = {};
  b.on('message', (buf) => {
    const text = buf.toString();
    const m = JSON.parse(text);
    if (m.result || m.error) { log('partialReply', { m: JSON.stringify(m).slice(0, 400) }); capture('partial-replies.txt', text); return; }
    const ch = m.ch;
    const body = m.data ?? m.snapshot ?? m.update;
    const kind = m.data ? 'data' : m.snapshot ? 'snapshot' : m.update ? 'update' : 'other';
    const c = (partial[ch] ??= { frames: 0, kinds: {}, symbols: new Set(), levels: new Set(), seqSteps: {}, lastSeq: {}, sample: null });
    c.frames++;
    c.kinds[kind] = (c.kinds[kind] ?? 0) + 1;
    for (const [sym, v] of Object.entries(body ?? {})) {
      c.symbols.add(sym);
      if (v.b) c.levels.add(`${v.b.length}/${v.a.length}`);
      if (v.s !== undefined) {
        if (c.lastSeq[sym] !== undefined) { const d = v.s - c.lastSeq[sym]; const k = d === 0 ? '0' : d === 1 ? '1' : d > 1 ? '>1' : '<0'; c.seqSteps[k] = (c.seqSteps[k] ?? 0) + 1; }
        c.lastSeq[sym] = v.s;
      }
    }
    if (!c.sample) { c.sample = text.slice(0, 600); capture('partial-sample.txt', text); }
  });
  b.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/D20/100ms', params: { symbols: ['BTCUSDT_PERP', 'MANAUSDT_PERP'] }, id: 2 }));
  b.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/top/100ms', params: { symbols: ['BTCUSDT_PERP'] }, id: 3 }));
  b.send(JSON.stringify({ method: 'subscribe', ch: 'futures/info', params: { symbols: ['*'] }, id: 4 }));
  await sleep(1500);
  b.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['NOPE_PERP'] }, id: 5 }));
  b.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/D30/100ms', params: { symbols: ['BTCUSDT_PERP'] }, id: 6 }));
  b.send(JSON.stringify({ method: 'subscribe', ch: 'nope/channel', params: { symbols: ['BTCUSDT_PERP'] }, id: 7 }));
  b.send('not json');
  b.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['TONUSDT_PERP'] }, id: 8 }));
  b.send(JSON.stringify({ method: 'subscriptions', ch: 'orderbook/full', params: {}, id: 9 }));

  await sleep(28000);
  // REST compare at mid run for BTC.
  const rest = JSON.parse(await (await fetch(API + '/public/orderbook/BTCUSDT_PERP?depth=20')).text());
  const bk = books.BTCUSDT_PERP;
  if (bk) {
    const sb = [...bk.b.entries()].sort((x, y) => +y[0] - +x[0]).slice(0, 20);
    let same = 0;
    for (const [p, q] of rest.bid) if (sb.find((x) => +x[0] === +p && +x[1] === +q)) same++;
    log('restCompare', { sym: 'BTCUSDT_PERP', restTop20BidsMatchingSocket: same, socketTouch: sb[0], restTouch: rest.bid[0] });
  }
  await sleep(30000);
  const secs = (performance.now() - tSub) / 1000;
  log('fullSummary', { symbols: Object.keys(st).length, subscribed: perps.length, secs: +secs.toFixed(1), frames: fullFrames, fps: +(fullFrames / secs).toFixed(1), bytesPerS: Math.round(fullBytes / secs), parseUsPerFrame: +(parseUs / fullFrames).toFixed(1) });
  for (const [sym, s] of Object.entries(st)) {
    if (['BTCUSDT_PERP', 'ETHUSDT_PERP', 'MANAUSDT_PERP', 'TRUMPUSDT_PERP'].includes(sym)) log('fullSym', { sym, ...s, lastAt: undefined, maxQuietS: +s.maxQuietS.toFixed(1) });
  }
  const agg = { gaps: 0, snapshotsOver1: 0, bidsNotDesc: 0, asksNotAsc: 0, noSnapshot: perps.filter((p) => !st[p]).length, updates: 0, maxLevels: 0, zeroInSnapshot: 0, maxQuietS: 0 };
  for (const s of Object.values(st)) { agg.gaps += s.gaps; if (s.snapshots > 1) agg.snapshotsOver1++; agg.bidsNotDesc += s.bidsNotDesc; agg.asksNotAsc += s.asksNotAsc; agg.updates += s.updates; agg.maxLevels = Math.max(agg.maxLevels, s.maxBids, s.maxAsks); agg.zeroInSnapshot += s.zeroInSnapshot; agg.maxQuietS = Math.max(agg.maxQuietS, +s.maxQuietS.toFixed(1)); }
  log('fullAggregate', agg);
  for (const [ch, c] of Object.entries(partial)) log('partialSummary', { ch, frames: c.frames, kinds: c.kinds, symbols: c.symbols.size, levels: [...c.levels].slice(0, 6), seqSteps: c.seqSteps, sample: c.sample.slice(0, 350) });
  a.close();
  b.close();
  await sleep(500);
}

async function silence() {
  const quiet = await open('noSubNoSend');
  quiet.on('message', (m) => log('quietMsg', { m: m.toString().slice(0, 200) }));
  const sub = await open('subQuietBook');
  let n = 0;
  sub.on('message', () => n++);
  sub.send(JSON.stringify({ method: 'subscribe', ch: 'orderbook/full', params: { symbols: ['TRUMPUSDT_PERP'] }, id: 1 }));
  await sleep(70000);
  log('silenceEnd', { quietState: quiet.readyState, subState: sub.readyState, subFrames: n });
  quiet.close();
  sub.close();
  await sleep(500);
}

async function deflate() {
  const ws = await open('deflate', { perMessageDeflate: true });
  ws.on('upgrade', () => {});
  log('deflate', { negotiated: ws.extensions || '(none)' });
  ws.close();
  await sleep(300);
}

if (mode === 'book') await book();
if (mode === 'silence') await silence();
if (mode === 'deflate') await deflate();
