// TruBit Pro futures market WebSocket probe: depthUpdate frame shape, depth, level order, snapshot or delta, size unit, frame rate, acknowledgements, errors, keepalive, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like the engine book feed, except the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/trubit-pro/ws-probe.mjs [book|rebuild|batch|silence|deflate]
//   book     depthUpdate on BTCUSDT, ETHUSDT, MASKUSDT for 45 s, plus an unknown symbol, tradeStatistics, guessed mark, index and funding channels, and three ping shapes.
//   rebuild  seeds BTCUSDT, ETHUSDT and MASKUSDT from the REST depth, applies depthUpdate by price for 60 s, and compares the rebuilt top 20 with a fresh REST depth every 6 s.
//   batch    depthUpdate on every perpetual on one connection for 30 s.
//   silence  one socket that subscribes and never sends again, one that never subscribes, up to 70 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/trubit-pro/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Loads from server/node_modules as the survey plan asks, and falls back to the root pnpm store once server/ no longer holds a Node install.
function load(name) {
  for (const anchor of ['../../../../server/package.json', '../../../../node_modules/.pnpm/probe-anchor.js']) {
    try {
      return createRequire(new URL(anchor, import.meta.url))(name);
    } catch {}
  }
  throw new Error(`cannot load ${name}`);
}
const WebSocket = load('ws');

const WS_URL = 'wss://api-futures.trubit.com/ws/market';
const API = 'https://api-futures.trubit.com/market/api/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 3000) + '\n');
}

function open(deflate = false) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  ws.t0 = t0;
  ws.frames = [];
  ws.on('ping', (d) => log('serverPing', { data: d.toString() }));
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      ws.openMs = Math.round(performance.now() - t0);
      resolve(ws);
    });
    ws.once('error', reject);
  });
}

const sub = (key, channel) => JSON.stringify({ op: 'subscribe', key, channel });

function analyse(frames, sym) {
  const f = frames.filter((x) => x.body?.key === sym && x.body.buyDepth);
  if (!f.length) return { sym, depthFrames: 0 };
  const gaps = f.slice(1).map((x, i) => x.t - f[i].t);
  const s = [...gaps].sort((a, b) => a - b);
  const bl = f.map((x) => x.body.buyDepth.length);
  const al = f.map((x) => x.body.sellDepth.length);
  const desc = f.filter((x) => x.body.buyDepth.every((l, i, a) => i === 0 || l.price < a[i - 1].price)).length;
  const asc = f.filter((x) => x.body.sellDepth.every((l, i, a) => i === 0 || l.price > a[i - 1].price)).length;
  let identical = 0;
  for (let i = 1; i < f.length; i++) if (JSON.stringify([f[i].body.buyDepth, f[i].body.sellDepth]) === JSON.stringify([f[i - 1].body.buyDepth, f[i - 1].body.sellDepth])) identical++;
  const zeroQty = f.filter((x) => [...x.body.buyDepth, ...x.body.sellDepth].some((l) => l.qty === 0)).length;
  const crossed = f.filter((x) => x.body.buyDepth[0] && x.body.sellDepth[0] && x.body.buyDepth[0].price >= x.body.sellDepth[0].price).length;
  const keys = [...new Set(f.flatMap((x) => Object.keys(x.body)))];
  const trades = f.map((x) => x.body.trades?.length ?? 0);
  return {
    sym,
    depthFrames: f.length,
    firstFrameMsAfterSubscribe: Math.round(f[0].t - (frames.subAt?.[sym] ?? f[0].t)),
    gapMs: { min: s[0], median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] },
    bidLevels: [Math.min(...bl), Math.max(...bl)],
    askLevels: [Math.min(...al), Math.max(...al)],
    bidsDescendingFrames: desc,
    asksAscendingFrames: asc,
    identicalToPrevious: identical,
    framesWithZeroQty: zeroQty,
    crossedFrames: crossed,
    keys,
    tradesPerFrame: [Math.min(...trades), Math.max(...trades)],
  };
}

async function book() {
  const syms = ['BTCUSDT', 'ETHUSDT', 'MASKUSDT'];
  const ws = await open();
  log('open', { url: WS_URL, openMs: ws.openMs, extensions: ws.extensions });
  const frames = [];
  frames.subAt = {};
  const others = [];
  const early = {};
  ws.on('message', (data, isBinary) => {
    const t = performance.now();
    const text = isBinary ? `<binary ${data.length} bytes>` : data.toString();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    capture('book.jsonl', JSON.stringify({ t: Math.round(t - ws.t0), body: body?.trades ? { ...body, trades: body.trades.length } : (body ?? text) }));
    if (body?.buyDepth && (early[body.key] = (early[body.key] || 0) + 1) <= 2) {
      const z = (a) => a.filter((l) => l.qty === 0).length;
      log('earlyFrame', { key: body.key, n: early[body.key], ms: Math.round(t - ws.t0), bids: body.buyDepth.length, zeroBids: z(body.buyDepth), asks: body.sellDepth.length, zeroAsks: z(body.sellDepth), trades: body.trades?.length });
    }
    if (body?.buyDepth) frames.push({ t, body });
    else others.push({ t: Math.round(t - ws.t0), text: text.slice(0, 300) });
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  for (const s of syms) {
    frames.subAt[s] = performance.now();
    ws.send(sub(s, 'depthUpdate'));
  }
  await sleep(3000);
  log('firstBtcFrame', { sample: JSON.stringify(frames.find((x) => x.body.key === 'BTCUSDT')?.body).slice(0, 700) });

  // REST compare at nearly the same instant: is the socket frame the same 20-level book in the same unit?
  const rest = await (await fetch(`${API}/depth/list?symbol=BTCUSDT&level=20`)).json();
  const latest = [...frames].reverse().find((x) => x.body.key === 'BTCUSDT')?.body;
  if (latest) {
    const rb = new Map(rest.result.buyDepth.map((l) => [l.price, l.qty]));
    const same = latest.buyDepth.filter((l) => rb.get(l.price) === l.qty).length;
    log('restCompare', { socketTopBid: latest.buyDepth[0], restTopBid: rest.result.buyDepth[0], bidLevelsEqualQtyAtSamePrice: same, of: latest.buyDepth.length });
  }

  const extra = [
    sub('NOPEUSDT', 'depthUpdate'),
    sub('BTCUSDT', 'tradeStatistics'),
    sub('BTCUSDT', 'markPrice'),
    sub('BTCUSDT', 'indexPrice'),
    sub('BTCUSDT', 'fundingRate'),
    sub('BTCUSDT', 'openInterest'),
    JSON.stringify({ op: 'subscribe', key: 'BTCUSDT' }),
    'not json',
  ];
  for (const f of extra) {
    ws.send(f);
    await sleep(300);
  }
  for (const p of ['ping', JSON.stringify({ op: 'ping' }), JSON.stringify({ ping: Date.now() })]) {
    const before = others.length;
    ws.send(p);
    await sleep(1500);
    log('pingShape', { sent: p, replies: others.slice(before).map((x) => x.text.slice(0, 120)) });
  }
  const t0 = performance.now();
  await new Promise((r) => {
    ws.once('pong', () => {
      log('protocolPong', { ms: Math.round(performance.now() - t0) });
      r();
    });
    ws.ping();
    setTimeout(r, 3000);
  });
  await sleep(45000 - 3000 - extra.length * 300 - 4500 - 3000);
  ws.close();
  await sleep(300);
  for (const s of syms) log('depth', analyse(frames, s));
  const kinds = {};
  for (const o of others) {
    let k = 'text';
    try {
      const b = JSON.parse(o.text);
      k = Object.keys(b).sort().join(',');
    } catch {}
    kinds[k] = (kinds[k] || 0) + 1;
  }
  log('nonDepthFrameKinds', kinds);
  const seen = new Set();
  for (const o of others) {
    let k;
    try {
      k = Object.keys(JSON.parse(o.text)).sort().join(',');
    } catch {
      k = 'text';
    }
    if (seen.has(k)) continue;
    seen.add(k);
    log('nonDepthSample', o);
  }
}

async function rebuild() {
  const syms = ['BTCUSDT', 'ETHUSDT', 'MASKUSDT'];
  const books = {};
  const ws = await open();
  const pending = {};
  ws.on('message', (data) => {
    let b;
    try {
      b = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!b.buyDepth) return;
    if (!books[b.key]) {
      (pending[b.key] ||= []).push(b);
      return;
    }
    apply(books[b.key], b);
  });
  const apply = (book, b) => {
    for (const [side, arr] of [['bids', b.buyDepth], ['asks', b.sellDepth]]) {
      for (const l of arr) {
        if (l.qty === 0) book[side].delete(l.price);
        else book[side].set(l.price, l.qty);
      }
    }
  };
  for (const s of syms) ws.send(sub(s, 'depthUpdate'));
  await sleep(1500);
  for (const s of syms) {
    const r = (await (await fetch(`${API}/depth/list?symbol=${s}&level=20`)).json()).result;
    books[s] = { bids: new Map(r.buyDepth.map((l) => [l.price, l.qty])), asks: new Map(r.sellDepth.map((l) => [l.price, l.qty])) };
    log('seed', { s, bufferedFramesDropped: pending[s]?.length ?? 0 });
  }
  const top = (m, desc) => [...m.entries()].sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, 20);
  const stats = Object.fromEntries(syms.map((s) => [s, { checks: 0, touchEqual: 0, levelsEqual: [], crossed: 0, maxLocalLevels: 0 }]));
  for (let i = 0; i < 10; i++) {
    await sleep(6000);
    for (const s of syms) {
      const r = (await (await fetch(`${API}/depth/list?symbol=${s}&level=20`)).json()).result;
      const lb = top(books[s].bids, true);
      const la = top(books[s].asks, false);
      const rb = r.buyDepth.map((l) => [l.price, l.qty]);
      const ra = r.sellDepth.map((l) => [l.price, l.qty]);
      const eq = (x, y) => x.filter((l, j) => y[j] && y[j][0] === l[0] && y[j][1] === l[1]).length;
      const st = stats[s];
      st.checks++;
      if (lb[0]?.[0] === rb[0]?.[0] && la[0]?.[0] === ra[0]?.[0]) st.touchEqual++;
      st.levelsEqual.push(eq(lb, rb) + eq(la, ra));
      if (lb[0] && la[0] && lb[0][0] >= la[0][0]) st.crossed++;
      st.maxLocalLevels = Math.max(st.maxLocalLevels, books[s].bids.size, books[s].asks.size);
    }
  }
  ws.close();
  for (const s of syms) log('rebuild', { s, ...stats[s], levelsEqualOf40: stats[s].levelsEqual.join(',') });
}

async function batch() {
  const syms = (await (await fetch(`${API}/basic/refData`)).json()).result.map((x) => x.symbol);
  const ws = await open();
  const frames = [];
  frames.subAt = {};
  let bytes = 0;
  const other = [];
  ws.on('message', (data) => {
    bytes += data.length;
    const t = performance.now();
    let body = null;
    try {
      body = JSON.parse(data.toString());
    } catch {}
    if (body?.buyDepth) frames.push({ t, body });
    else other.push(data.toString().slice(0, 200));
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  const t0 = performance.now();
  for (const s of syms) {
    frames.subAt[s] = performance.now();
    ws.send(sub(s, 'depthUpdate'));
  }
  await sleep(30000);
  ws.close();
  const per = syms.map((s) => analyse(frames, s));
  const withFrames = per.filter((p) => p.depthFrames > 0);
  const firsts = withFrames.map((p) => p.firstFrameMsAfterSubscribe).sort((a, b) => a - b);
  log('batch', {
    streams: syms.length,
    streamsDelivering: withFrames.length,
    frames: frames.length,
    kbPerSecond: Math.round(bytes / 30 / 1024),
    firstFrameMs: [firsts[0], firsts[firsts.length >> 1], firsts[firsts.length - 1]],
    framesPerStream: per.map((p) => p.depthFrames).sort((a, b) => a - b),
    maxGapMs: per.map((p) => p.gapMs?.max ?? null).sort((a, b) => b - a).slice(0, 5),
    minLevels: Math.min(...withFrames.map((p) => Math.min(p.bidLevels[0], p.askLevels[0]))),
    crossedFrames: per.reduce((a, p) => a + (p.crossedFrames || 0), 0),
    otherFrames: other.length,
    otherSample: other.slice(0, 3),
    elapsedMs: Math.round(performance.now() - t0),
  });
}

async function silence() {
  const quiet = await open();
  const idle = await open();
  const t0 = performance.now();
  let n = 0;
  quiet.on('message', () => n++);
  quiet.send(sub('BTCUSDT', 'depthUpdate'));
  for (const [name, ws] of [['subscribedNeverSends', quiet], ['neverSubscribes', idle]]) {
    ws.on('ping', () => log('serverPing', { name, atMs: Math.round(performance.now() - t0) }));
    ws.on('close', (code, reason) => log('close', { name, code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }));
  }
  await sleep(70000);
  log('silenceEnd', { quietOpen: quiet.readyState === WebSocket.OPEN, idleOpen: idle.readyState === WebSocket.OPEN, framesOnQuiet: n, elapsedMs: Math.round(performance.now() - t0) });
  quiet.terminate();
  idle.terminate();
}

async function deflate() {
  const ws = await open(true);
  log('deflate', { extensions: ws._extensions ? Object.keys(ws._extensions) : null, header: ws.extensions });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
await { book, rebuild, batch, silence, deflate }[mode]();
setTimeout(() => process.exit(0), 500);
