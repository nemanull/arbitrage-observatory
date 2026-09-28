// Mandala Exchange public WebSocket probe: full and partial book channels, sequence and level order, futures info, errors, all perpetuals on one socket, keepalive, silence, deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/mandala/ws-probe.mjs [book|batch|silence|deflate]
//   book     orderbook/full on three perps for 60 s, orderbook/D20/100ms on one, futures/info for all, errors. About 65 s.
//   batch    orderbook/full on every perpetual on one connection for 40 s.
//   silence  two sockets for 70 s: one that never subscribes, one subscribed that never answers the server ping.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/mandala/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// Loads a package the way the engine does, through server/package.json, falling back to old_ts_server/ and the root pnpm store while the server is being moved.
function load(name) {
  for (const base of ['../../../../server/package.json', '../../../../old_ts_server/package.json', '../../../../package.json']) {
    try { return createRequire(new URL(base, import.meta.url))(name); } catch {}
  }
  const store = { ccxt: 'ccxt@4.5.68_protobufjs@7.6.6', ws: 'ws@8.21.1_bufferutil@4.1.0' }[name];
  return createRequire(new URL(`../../../../node_modules/.pnpm/${store}/node_modules/${name}/package.json`, import.meta.url))(name);
}
const WebSocket = load('ws');

const URL_PUBLIC = 'wss://api.trade.mandala.exchange/api/3/ws/public';
const API = 'https://api.trade.mandala.exchange/api/3/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let reqId = 1;
const sub = (ch, symbols) => JSON.stringify({ method: 'subscribe', ch, params: { symbols }, id: reqId++ });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 1500) + '\n');
}

function open(opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(URL_PUBLIC, { perMessageDeflate: false, ...opts });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('error', reject);
  });
}

// Tracks one book channel per symbol: snapshot count, sequence steps, level order, crossed books.
function makeBook() {
  return { snapshots: 0, updates: 0, gaps: 0, repeats: 0, steps: {}, maxGapMs: 0, lastRecv: 0, lastS: undefined, bids: new Map(), asks: new Map(), crossed: 0, orderBad: 0, zeroInSnapshot: 0, emptyUpdates: 0, firstSnapshotMs: undefined, levels: [] };
}

function applySide(map, levels) {
  for (const [p, q] of levels) (Number(q) === 0 ? map.delete(p) : map.set(p, q));
}

function ordered(levels, desc) {
  const px = levels.map((l) => Number(l[0]));
  return px.every((p, i) => i === 0 || (desc ? p < px[i - 1] : p > px[i - 1]));
}

async function book() {
  const syms = ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'ZECUSDT_PERP'];
  const { ws, openMs } = await open();
  const t0 = performance.now();
  log('open', { openMs });
  const books = Object.fromEntries(syms.map((s) => [s, makeBook()]));
  const partial = { frames: 0, seqs: [], repeatsSameS: 0, levelCounts: new Set(), lastS: undefined, ageMs: [] };
  const info = { frames: 0, symbols: new Set(), perSymbol: {}, sample: undefined, lastT: {} };
  const acks = [];
  let pings = 0;
  ws.on('ping', () => pings++);
  ws.on('message', (buf) => {
    const recv = performance.now();
    const text = buf.toString();
    const m = JSON.parse(text);
    if (m.id !== undefined || m.error) {
      acks.push({ atMs: Math.round(recv - t0), msg: text.slice(0, 300) });
      capture('acks.txt', text);
      return;
    }
    if (m.ch === 'orderbook/full') {
      const kind = m.snapshot ? 'snapshot' : 'update';
      for (const [s, d] of Object.entries(m.snapshot ?? m.update)) {
        const b = books[s];
        if (!b) continue;
        if (b.lastRecv) b.maxGapMs = Math.max(b.maxGapMs, recv - b.lastRecv);
        b.lastRecv = recv;
        if (kind === 'snapshot') {
          b.snapshots++;
          b.firstSnapshotMs ??= Math.round(recv - t0);
          b.bids = new Map(); b.asks = new Map();
          b.zeroInSnapshot += [...d.b, ...d.a].filter((l) => Number(l[1]) === 0).length;
          b.levels.push([d.b.length, d.a.length]);
          if (!ordered(d.b, true) || !ordered(d.a, false)) b.orderBad++;
          capture(`snapshot-${s}.txt`, text);
        } else {
          b.updates++;
          if (d.a.length === 0 && d.b.length === 0) b.emptyUpdates++;
          if (b.updates <= 3) capture(`update-${s}.txt`, text);
          const step = d.s - b.lastS;
          b.steps[step] = (b.steps[step] ?? 0) + 1;
          if (step === 0) b.repeats++;
          else if (step !== 1) b.gaps++;
          if (!ordered(d.b, true) || !ordered(d.a, false)) b.orderBad++;
        }
        b.lastS = d.s;
        applySide(b.bids, d.b); applySide(b.asks, d.a);
        const bb = Math.max(...[...b.bids.keys()].map(Number));
        const ba = Math.min(...[...b.asks.keys()].map(Number));
        if (b.bids.size && b.asks.size && bb >= ba) b.crossed++;
        b.top = [bb, ba];
      }
      return;
    }
    if (m.ch === 'orderbook/D20/100ms') {
      for (const [, d] of Object.entries(m.data)) {
        partial.frames++;
        partial.levelCounts.add(`${d.b.length}/${d.a.length}`);
        if (partial.lastS === d.s) partial.repeatsSameS++;
        partial.lastS = d.s;
        partial.ageMs.push(Date.now() - d.t);
        if (partial.frames <= 2) capture('partial.txt', text);
      }
      return;
    }
    if (m.ch === 'futures/info') {
      info.frames++;
      for (const [s, d] of Object.entries(m.data)) {
        info.symbols.add(s);
        info.perSymbol[s] = (info.perSymbol[s] ?? 0) + 1;
        info.sample ??= { s, d };
      }
      if (info.frames <= 2) capture('futures-info.txt', text);
      return;
    }
    capture('other.txt', text);
  });
  ws.send(sub('orderbook/full', syms));
  ws.send(sub('orderbook/D20/100ms', ['BTCUSDT_PERP']));
  ws.send(sub('futures/info', ['*']));
  await sleep(2000);
  ws.send(sub('orderbook/full', ['NOPEUSDT_PERP']));
  ws.send(sub('orderbook/D25/100ms', ['BTCUSDT_PERP']));
  ws.send(JSON.stringify({ method: 'ping', id: reqId++ }));
  ws.send('not json');
  await sleep(58000);
  ws.close();
  const rest = await (await fetch(`${API}/orderbook/BTCUSDT_PERP?depth=5`)).json();
  log('acks', { acks });
  for (const [s, b] of Object.entries(books)) {
    log('book_full', { s, snapshots: b.snapshots, firstSnapshotMs: b.firstSnapshotMs, snapshotLevels: b.levels, zeroInSnapshot: b.zeroInSnapshot, updates: b.updates, emptyUpdates: b.emptyUpdates, steps: b.steps, gaps: b.gaps, repeats: b.repeats, orderBad: b.orderBad, crossed: b.crossed, maxGapMs: Math.round(b.maxGapMs), localTop: b.top, bookSize: [b.bids.size, b.asks.size] });
  }
  log('rest_compare', { restTop: [rest.bid?.[0], rest.ask?.[0]] });
  partial.ageMs.sort((a, b) => a - b);
  log('book_partial', { frames: partial.frames, levelCounts: [...partial.levelCounts], repeatsSameS: partial.repeatsSameS, ageMsMedian: partial.ageMs[partial.ageMs.length >> 1], ageMsMax: partial.ageMs.at(-1) });
  log('futures_info_ws', { frames: info.frames, symbols: info.symbols.size, btcPushes: info.perSymbol.BTCUSDT_PERP, sample: info.sample });
  log('session', { serverPings: pings, heldMs: Math.round(performance.now() - t0) });
}

async function batch() {
  const cat = await (await fetch(`${API}/symbol`)).json();
  const perps = Object.entries(cat).filter(([, s]) => s.type === 'futures').map(([k]) => k);
  const { ws, openMs } = await open();
  const t0 = performance.now();
  const seen = {};
  let gaps = 0, updates = 0, ack;
  const lastS = {};
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    if (m.id !== undefined) { ack = { atMs: Math.round(performance.now() - t0), n: m.result?.subscriptions?.length, error: m.error }; return; }
    if (m.ch !== 'orderbook/full') return;
    for (const [s, d] of Object.entries(m.snapshot ?? m.update)) {
      if (m.snapshot) { seen[s] ??= Math.round(performance.now() - t0); }
      else { updates++; if (lastS[s] !== undefined && d.s !== lastS[s] + 1) gaps++; }
      lastS[s] = d.s;
    }
  });
  ws.send(sub('orderbook/full', perps));
  await sleep(40000);
  ws.close();
  const times = Object.values(seen).sort((a, b) => a - b);
  log('batch', { openMs, perps: perps.length, ack, snapshots: times.length, firstMs: times[0], lastMs: times.at(-1), updates, gaps, noSnapshot: perps.filter((p) => seen[p] === undefined) });
}

async function silence() {
  const results = [];
  const run = async (name, opts, subscribe) => {
    const { ws } = await open(opts);
    const t0 = performance.now();
    let pings = 0, frames = 0;
    ws.on('ping', () => pings++);
    ws.on('message', () => frames++);
    if (subscribe) ws.send(sub('orderbook/D5/1000ms', ['BTCUSDT_PERP']));
    const closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) })));
    const res = await Promise.race([closed, sleep(70000).then(() => null)]);
    if (!res) ws.terminate();
    results.push({ name, pings, frames, closed: res ?? 'open at 70 s' });
  };
  await Promise.all([run('no_subscribe_autopong', {}, false), run('subscribed_no_pong', { autoPong: false }, true)]);
  log('silence', { results });
}

async function deflate() {
  const ws = new WebSocket(URL_PUBLIC, { perMessageDeflate: true });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  log('deflate', { negotiated: ws.extensions || '(none)' });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
await ({ book, batch, silence, deflate })[mode]();
process.exit(0);
