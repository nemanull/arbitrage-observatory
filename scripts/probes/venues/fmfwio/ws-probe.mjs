// FMFW.io public WebSocket v3 probe for the USDT perpetual books: snapshot and update shape, the sequence rule, level order and window, size unit against REST, the partial book, top of book and futures/info channels, pings, silence, errors and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks for it once.
// Requests are spaced 200 ms apart, inside the documented 10 per second on /ws/public.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/fmfwio/ws-probe.mjs [book|batch|silence|errors|deflate]
//   book     orderbook/full on five perps, orderbook/D20/100ms on two, orderbook/top/100ms and futures/info, with REST book compares at a third, two thirds and the end. About 65 s.
//   batch    orderbook/full on every working perp on one socket for 60 s.
//   silence  three sockets that differ in what they subscribe and whether they answer pings, for up to 120 s.
//   errors   unknown symbol, channel, depth and speed, a duplicate, the expired and the untraded contract, a spot symbol, text that is not JSON. About 12 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// DURATION_S shortens the hold of book, batch and silence. Set PROBE_OUT_DIR to keep a capped sample of raw frames.
// Recorded in docs/profiles/fmfwio/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api.fmfw.io/api/3/ws/public';
const API = 'https://api.fmfw.io/api/3';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let reqId = 1;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  try {
    if (statSync(file).size > 1_000_000) return;
  } catch {}
  // Long frames keep five levels per side, so every captured line still parses.
  const kept = text.length > 4000 ? JSON.stringify(JSON.parse(text), (k, v) => (Array.isArray(v) && Array.isArray(v[0]) ? v.slice(0, 5) : v)) : text;
  appendFileSync(file, kept + '\n');
}

function open(opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false, autoPong: opts.autoPong ?? true });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('error', reject);
  });
}

function send(ws, method, ch, params) {
  const id = reqId++;
  ws.send(JSON.stringify({ method, ch, params, id }));
  return id;
}

async function workingPerps() {
  const r = await fetch(`${API}/public/symbol`);
  const body = await r.json();
  return Object.entries(body).filter(([, v]) => v.type === 'futures' && v.status === 'working').map(([id]) => id);
}

// One book per symbol, kept by price, with the sequence and the facts the profile needs.
function makeTracker() {
  const books = new Map();
  const stats = new Map();
  const st = (sym) => {
    let s = stats.get(sym);
    if (!s) {
      s = { snapshots: 0, updates: 0, gaps: 0, gapSamples: [], repeats: 0, emptyUpdates: 0, zeroInSnapshot: 0, snapBids: null, snapAsks: null, snapBidsDesc: null, snapAsksAsc: null, updBidsUnordered: 0, updAsksUnordered: 0, maxBids: 0, maxAsks: 0, oneSided: 0, maxIdleMs: 0, lastAt: null, firstSnapAfterMs: null, last: null, firstUpdateStep: null, steps: {} };
      stats.set(sym, s);
    }
    return s;
  };
  const apply = (map, levels) => {
    for (const [p, q] of levels) {
      if (Number(q) === 0) map.delete(p);
      else map.set(p, q);
    }
  };
  const desc = (arr) => arr.every((l, i) => i === 0 || Number(l[0]) < Number(arr[i - 1][0]));
  const asc = (arr) => arr.every((l, i) => i === 0 || Number(l[0]) > Number(arr[i - 1][0]));
  return {
    books,
    stats,
    onFull(kind, payload, now, subscribedAt) {
      for (const [sym, v] of Object.entries(payload)) {
        const s = st(sym);
        if (s.lastAt !== null) s.maxIdleMs = Math.max(s.maxIdleMs, now - s.lastAt);
        s.lastAt = now;
        const a = v.a ?? [];
        const b = v.b ?? [];
        if (kind === 'snapshot') {
          s.snapshots++;
          s.snapBids = b.length;
          s.snapAsks = a.length;
          s.snapBidsDesc = desc(b);
          s.snapAsksAsc = asc(a);
          s.zeroInSnapshot += [...a, ...b].filter((l) => Number(l[1]) === 0).length;
          s.firstSnapAfterMs ??= subscribedAt ? now - subscribedAt : null;
          const book = { bids: new Map(), asks: new Map() };
          apply(book.bids, b);
          apply(book.asks, a);
          books.set(sym, book);
          s.last = v.s;
        } else {
          s.updates++;
          if (a.length === 0 && b.length === 0) s.emptyUpdates++;
          if (!desc(b)) s.updBidsUnordered++;
          if (!asc(a)) s.updAsksUnordered++;
          if (s.last !== null) {
            const step = v.s - s.last;
            s.steps[step] = (s.steps[step] ?? 0) + 1;
            if (s.firstUpdateStep === null) s.firstUpdateStep = step;
            if (step === 0) s.repeats++;
            else if (step !== 1) {
              s.gaps++;
              if (s.gapSamples.length < 3) s.gapSamples.push([s.last, v.s]);
            }
          }
          s.last = v.s;
          const book = books.get(sym);
          if (book) {
            apply(book.bids, b);
            apply(book.asks, a);
          }
        }
        const book = books.get(sym);
        if (book) {
          s.maxBids = Math.max(s.maxBids, book.bids.size);
          s.maxAsks = Math.max(s.maxAsks, book.asks.size);
          if (book.bids.size === 0 || book.asks.size === 0) s.oneSided++;
          let bb = -Infinity;
          let ba = Infinity;
          for (const p of book.bids.keys()) bb = Math.max(bb, Number(p));
          for (const p of book.asks.keys()) ba = Math.min(ba, Number(p));
          if (bb >= ba) s.crossed = (s.crossed ?? 0) + 1;
        }
      }
    },
  };
}

function topOf(book, n) {
  const bids = [...book.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
  const asks = [...book.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
  return { bids, asks };
}

// The REST book carries no sequence, so the compare is by price at the nearest instant.
async function restCompare(tracker, when) {
  for (const sym of ['BTCUSDT_PERP', 'ATOMUSDT_PERP']) {
    const rest = await (await fetch(`${API}/public/orderbook/${sym}?depth=20`)).json();
    const kept = tracker.books.get(sym);
    if (!kept) continue;
    const restMap = new Map([...rest.bid, ...rest.ask].map(([p, q]) => [p, q]));
    const top = topOf(kept, 20);
    let equal = 0;
    let samePrice = 0;
    for (const [p, q] of [...top.bids, ...top.asks]) {
      if (restMap.has(p)) {
        samePrice++;
        if (restMap.get(p) === q) equal++;
      }
    }
    log('restCompare', { when, sym, keptLevels: top.bids.length + top.asks.length, restLevels: rest.bid.length + rest.ask.length, pricesAlsoInRest: samePrice, sizesEqual: equal, keptTouch: [top.bids[0], top.asks[0]], restTouch: [rest.bid[0], rest.ask[0]] });
  }
}

async function book() {
  const hold = Number(process.env.DURATION_S ?? 60) * 1000;
  const full = ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'SOLUSDT_PERP', 'ATOMUSDT_PERP', 'GMTUSDT_PERP'];
  const tracker = makeTracker();
  const { ws, openMs } = await open();
  log('open', { url: WS_URL, openMs, extensions: ws.extensions });
  const subscribedAt = {};
  const pings = [];
  const counts = {};
  const d20 = new Map();
  const infoSeen = new Map();
  const acks = [];
  let lastD20 = new Map();
  const started = Date.now();
  ws.on('ping', () => pings.push(Date.now() - started));
  ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString('utf8');
    const m = JSON.parse(text);
    const ch = m.ch ?? (m.result ? 'result' : m.error ? 'error' : 'other');
    counts[ch] = (counts[ch] ?? 0) + 1;
    if (m.result || m.error) {
      acks.push({ at: now - started, ...m });
      capture('acks.jsonl', text);
      return;
    }
    if (m.ch === 'orderbook/full') {
      const kind = m.snapshot ? 'snapshot' : 'update';
      capture(`full-${kind}.jsonl`, text);
      const payload = m.snapshot ?? m.update;
      for (const sym of Object.keys(payload)) tracker.onFull(kind, { [sym]: payload[sym] }, now, subscribedAt[sym]);
    } else if (m.ch === 'orderbook/D20/100ms') {
      capture('d20.jsonl', text);
      for (const [sym, v] of Object.entries(m.data)) {
        const s = d20.get(sym) ?? { frames: 0, sameS: 0, sameContent: 0, sDecrease: 0, bids: 0, asks: 0, maxIdle: 0, lastAt: null };
        s.frames++;
        s.bids = v.b.length;
        s.asks = v.a.length;
        const prev = lastD20.get(sym);
        if (prev) {
          if (prev.s === v.s) s.sameS++;
          if (v.s < prev.s) s.sDecrease++;
          if (JSON.stringify(prev.a) === JSON.stringify(v.a) && JSON.stringify(prev.b) === JSON.stringify(v.b)) s.sameContent++;
        }
        if (s.lastAt !== null) s.maxIdle = Math.max(s.maxIdle, now - s.lastAt);
        s.lastAt = now;
        lastD20.set(sym, v);
        d20.set(sym, s);
        // The partial book and the full book share one sequence, so at an equal s the top twenty must be equal.
        const fs = tracker.stats.get(sym);
        const kept = tracker.books.get(sym);
        if (fs && kept) {
          const diff = v.s - fs.last;
          s.sMinusFull = s.sMinusFull ?? {};
          const key = diff === 0 ? '0' : diff > 0 ? '>0' : '<0';
          s.sMinusFull[key] = (s.sMinusFull[key] ?? 0) + 1;
          if (diff === 0) {
            const top = topOf(kept, 20);
            const same = JSON.stringify(top.bids) === JSON.stringify(v.b) && JSON.stringify(top.asks) === JSON.stringify(v.a);
            if (same) s.equalTop20 = (s.equalTop20 ?? 0) + 1;
            else s.unequalTop20 = (s.unequalTop20 ?? 0) + 1;
          }
        }
      }
    } else if (m.ch === 'futures/info') {
      capture('info.jsonl', text);
      for (const [sym, v] of Object.entries(m.data)) {
        const s = infoSeen.get(sym) ?? { frames: 0, lastT: null, tSteps: [], ageMs: [] };
        s.frames++;
        if (s.lastT !== null) s.tSteps.push(v.t - s.lastT);
        s.lastT = v.t;
        s.ageMs.push(now - v.t);
        infoSeen.set(sym, s);
      }
    } else if (m.ch === 'orderbook/top/100ms') {
      capture('top.jsonl', text);
    }
  });
  for (const sym of full) {
    subscribedAt[sym] = Date.now();
    send(ws, 'subscribe', 'orderbook/full', { symbols: [sym] });
    await sleep(200);
  }
  send(ws, 'subscribe', 'orderbook/D20/100ms', { symbols: ['BTCUSDT_PERP', 'ATOMUSDT_PERP'] });
  await sleep(200);
  send(ws, 'subscribe', 'orderbook/top/100ms', { symbols: ['BTCUSDT_PERP'] });
  await sleep(200);
  send(ws, 'subscribe', 'futures/info', { symbols: ['*'] });
  await sleep(200);
  send(ws, 'subscriptions', 'orderbook/full', {});
  for (let k = 0; k < 2; k++) {
    await sleep(hold / 3);
    await restCompare(tracker, 'mid run');
  }
  await sleep(hold / 3);

  await restCompare(tracker, 'end');
  ws.close();
  log('frames', { counts, seconds: Math.round((Date.now() - started) / 1000), pingsAtMs: pings });
  for (const a of acks) log('ack', { ...a, result: JSON.stringify(a.result)?.slice(0, 200) });
  for (const [sym, s] of tracker.stats) log('full', { sym, ...s, lastAt: undefined, last: undefined });
  for (const [sym, s] of d20) log('d20', { sym, ...s, lastAt: undefined });
  const infoAll = [...infoSeen.values()];
  const steps = infoAll.flatMap((s) => s.tSteps).sort((a, b) => a - b);
  const ages = infoAll.flatMap((s) => s.ageMs).sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
  log('futuresInfo', { contracts: infoSeen.size, framesPerContract: infoAll.map((s) => s.frames), tStepMs: { min: steps[0], median: q(steps, 0.5), max: steps[steps.length - 1] }, ageMs: { min: ages[0], median: q(ages, 0.5), max: ages[ages.length - 1] } });
}

async function batch() {
  const hold = Number(process.env.DURATION_S ?? 60) * 1000;
  const perps = await workingPerps();
  const tracker = makeTracker();
  const { ws, openMs } = await open();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = [];
  let secCount = 0;
  const started = Date.now();
  const timer = setInterval(() => {
    perSecond.push(secCount);
    secCount = 0;
  }, 1000);
  ws.on('message', (raw) => {
    const now = Date.now();
    frames++;
    secCount++;
    bytes += raw.length;
    const t0 = process.hrtime.bigint();
    const m = JSON.parse(raw.toString('utf8'));
    parseNs += process.hrtime.bigint() - t0;
    if (m.ch === 'orderbook/full') {
      const kind = m.snapshot ? 'snapshot' : 'update';
      tracker.onFull(kind, m.snapshot ?? m.update, now, null);
    } else if (m.error) log('error', m);
    else if (m.result) log('ack', { subscriptions: m.result.subscriptions?.length });
  });
  send(ws, 'subscribe', 'orderbook/full', { symbols: perps });
  await sleep(hold);
  clearInterval(timer);
  ws.close();
  const secs = (Date.now() - started) / 1000;
  const sorted = [...perSecond].sort((a, b) => a - b);
  let gaps = 0;
  let updates = 0;
  let snaps = 0;
  let maxIdle = 0;
  let idleSym = null;
  for (const [sym, s] of tracker.stats) {
    gaps += s.gaps;
    updates += s.updates;
    snaps += s.snapshots;
    if (s.maxIdleMs > maxIdle) {
      maxIdle = s.maxIdleMs;
      idleSym = sym;
    }
  }
  log('batch', { openMs, perps: perps.length, withSnapshot: [...tracker.stats.values()].filter((s) => s.snapshots > 0).length, snaps, updates, gaps, seconds: Math.round(secs), framesPerSecond: Math.round(frames / secs), medianPerSecond: sorted[Math.floor(sorted.length / 2)], peakPerSecond: sorted[sorted.length - 1], bytesPerSecond: Math.round(bytes / secs), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000, maxIdleMs: maxIdle, idleSym });
  for (const [sym, s] of tracker.stats) log('batchSym', { sym, updates: s.updates, gaps: s.gaps, maxIdleMs: s.maxIdleMs, maxBids: s.maxBids, maxAsks: s.maxAsks, snapBids: s.snapBids, snapAsks: s.snapAsks });
}

async function silence() {
  const hold = Number(process.env.DURATION_S ?? 120) * 1000;
  const cases = [
    { name: 'idle-autopong', autoPong: true, subscribe: null },
    { name: 'idle-no-pong', autoPong: false, subscribe: null },
    { name: 'quiet-sub-no-pong', autoPong: false, subscribe: 'ATOMUSDT_PERP' },
  ];
  const results = await Promise.all(
    cases.map(async (c) => {
      const { ws } = await open({ autoPong: c.autoPong });
      const started = Date.now();
      const r = { name: c.name, pingsAtMs: [], frames: 0, closedAtMs: null, code: null, reason: null };
      ws.on('ping', () => r.pingsAtMs.push(Date.now() - started));
      ws.on('message', () => r.frames++);
      if (c.subscribe) send(ws, 'subscribe', 'orderbook/full', { symbols: [c.subscribe] });
      await new Promise((resolve) => {
        const t = setTimeout(resolve, hold);
        ws.on('close', (code, reason) => {
          r.closedAtMs = Date.now() - started;
          r.code = code;
          r.reason = reason.toString();
          clearTimeout(t);
          resolve();
        });
      });
      if (ws.readyState === ws.OPEN) ws.close();
      return r;
    }),
  );
  for (const r of results) log('silence', r);
}

async function errors() {
  const { ws, openMs } = await open();
  log('open', { openMs });
  const started = Date.now();
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    const m = JSON.parse(text);
    if (m.result !== undefined || m.error) log('reply', { at: Date.now() - started, frame: text.slice(0, 400) });
    else {
      const sym = Object.keys(m.snapshot ?? m.update ?? m.data ?? {})[0];
      const v = (m.snapshot ?? m.update ?? m.data ?? {})[sym];
      log('data', { at: Date.now() - started, ch: m.ch, kind: m.snapshot ? 'snapshot' : m.update ? 'update' : 'data', sym, bids: v?.b?.length, asks: v?.a?.length, s: v?.s });
    }
  });
  const tries = [
    ['subscribe', 'orderbook/full', { symbols: ['NOPEUSDT_PERP'] }],
    ['subscribe', 'orderbook/full', { symbols: ['BTCUSDT_PERP', 'NOPEUSDT_PERP'] }],
    ['subscribe', 'orderbook/full', { symbols: ['BTCUSDT_PERP'] }],
    ['subscribe', 'orderbook/nope', { symbols: ['BTCUSDT_PERP'] }],
    ['subscribe', 'orderbook/D30/100ms', { symbols: ['BTCUSDT_PERP'] }],
    ['subscribe', 'orderbook/D20/50ms', { symbols: ['BTCUSDT_PERP'] }],
    ['subscribe', 'orderbook/full', { symbols: ['LUNAUSDT_PERP'] }],
    ['subscribe', 'orderbook/full', { symbols: ['CELUSDT_PERP'] }],
    ['subscribe', 'orderbook/full', { symbols: ['BTCUSDT'] }],
    ['subscribe', 'orderbook/full', { symbols: ['*'] }],
    ['unsubscribe', 'orderbook/full', { symbols: ['BTCUSDT'] }],
    ['subscriptions', 'orderbook/full', {}],
  ];
  for (const [method, ch, params] of tries) {
    log('send', { method, ch, params });
    send(ws, method, ch, params);
    await sleep(700);
  }
  log('send', { text: 'not json' });
  ws.send('not json');
  await sleep(1500);
  log('state', { readyState: ws.readyState });
  ws.close();
}

async function deflate() {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: true });
  let hdr = null;
  ws.once('upgrade', (res) => {
    hdr = res.headers['sec-websocket-extensions'] ?? null;
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  log('deflate', { openMs: Math.round(performance.now() - t0), negotiated: ws.extensions || '(none)', header: hdr });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, errors, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
