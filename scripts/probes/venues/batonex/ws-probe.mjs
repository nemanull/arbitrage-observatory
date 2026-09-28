// Batonex public quote WebSocket probe: book topics, versions and level order, size unit, errors, a batch of perpetuals on one connection, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like the engine's book feed, VenueFeed.ts.
// The URLs are those of the Batonex openapi docs at github.com/batonex/openapi, apidocs/05-websocket.md and 06-websocket-v2.md.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/batonex/ws-probe.mjs [book|errors|anchor|batch|silence|deflate]
//   book     v1 depth, diffDepth and mergedDepth plus v2 depth on four perps for 40 s: frame rate, version rule, level count and order, REST size compare. About 45 s.
//   errors   unknown symbol, spot symbol, bad topic, mark and funding topic guesses, non-JSON, duplicate subscribe, ping answer. About 15 s.
//   anchor   the index topic on every index symbol plus realtimes on two perps for 30 s: index formula names, cadence, age. About 32 s.
//   batch    v1 depth on every TRADING perp on one connection for 30 s. About 35 s.
//   silence  two sockets with a subscription, one that pings and one that never sends, for 70 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/batonex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_V1 = 'wss://wsapi.batonex.com/openapi/quote/ws/v1';
const WS_V2 = 'wss://wsapi.batonex.com/openapi/quote/ws/v2';
const API = 'https://api.batonex.com/openapi';
const OUT = process.env.PROBE_OUT_DIR;
const BOOK_SYMBOLS = ['BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'AAPL-USDT-PERP', 'EDGE-USDT-PERP'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url, name, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  ws.frames = [];
  ws.on('upgrade', (res) => log('upgrade', { name, ms: Date.now() - t0, ext: res.headers['sec-websocket-extensions'] ?? null }));
  ws.on('message', (buf, isBinary) => {
    const text = buf.toString();
    capture(`${name}.jsonl`, text);
    let msg = null;
    try { msg = JSON.parse(text); } catch { /* kept as text */ }
    ws.frames.push({ at: Date.now(), bytes: buf.length, isBinary, text, msg });
  });
  ws.on('close', (code, reason) => log('close', { name, code, reason: reason.toString(), afterMs: Date.now() - t0 }));
  ws.on('error', (e) => log('error', { name, message: e.message }));
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

const sub = (symbol, topic, params = {}) => JSON.stringify({ symbol, topic, event: 'sub', params: { binary: false, ...params } });

function sortedDesc(levels) { for (let i = 1; i < levels.length; i++) if (+levels[i][0] > +levels[i - 1][0]) return false; return true; }
function sortedAsc(levels) { for (let i = 1; i < levels.length; i++) if (+levels[i][0] < +levels[i - 1][0]) return false; return true; }

function summarise(frames, label) {
  const per = {};
  for (const f of frames) {
    const m = f.msg;
    if (!m || !m.data) continue;
    const items = Array.isArray(m.data) ? m.data : [m.data];
    for (const d of items) {
      const s = d.s ?? m.symbol ?? m.params?.symbol;
      const p = (per[s] ??= { frames: 0, first: null, fTrue: 0, versions: [], bidsMax: 0, asksMax: 0, bidsMin: 1e9, asksMin: 1e9, bidUnordered: 0, askUnordered: 0, repeats: 0, sameBook: 0, e: new Set(), maxGapMs: 0, lastAt: null, lastBook: null, crossed: 0 });
      p.frames++;
      if (m.f === true) p.fTrue++;
      if (p.first === null) p.first = { f: m.f, bids: d.b?.length, asks: d.a?.length };
      if (d.e !== undefined) p.e.add(d.e);
      const b = d.b ?? [], a = d.a ?? [];
      p.bidsMax = Math.max(p.bidsMax, b.length); p.asksMax = Math.max(p.asksMax, a.length);
      p.bidsMin = Math.min(p.bidsMin, b.length); p.asksMin = Math.min(p.asksMin, a.length);
      if (!sortedDesc(b)) p.bidUnordered++;
      if (!sortedAsc(a)) p.askUnordered++;
      if (b.length && a.length && +b[0][0] >= +a[0][0]) p.crossed++;
      if (p.versions.length && p.versions[p.versions.length - 1] === d.v) p.repeats++;
      const book = JSON.stringify([b.slice(0, 20), a.slice(0, 20)]);
      if (p.lastBook === book) p.sameBook++;
      p.lastBook = book;
      p.versions.push(d.v);
      if (p.lastAt) p.maxGapMs = Math.max(p.maxGapMs, f.at - p.lastAt);
      p.lastAt = f.at;
      p.lastTop = { bid: b[0], ask: a[0], t: d.t, v: d.v };
    }
  }
  for (const [s, p] of Object.entries(per)) {
    const parsed = p.versions.map((v) => String(v).split('_').map(Number));
    let decreasing = 0;
    for (let i = 1; i < parsed.length; i++) if (parsed[i][0] < parsed[i - 1][0]) decreasing++;
    log('book', { label, s, frames: p.frames, fTrue: p.fTrue, first: p.first, bids: [p.bidsMin, p.bidsMax], asks: [p.asksMin, p.asksMax], bidUnordered: p.bidUnordered, askUnordered: p.askUnordered, crossed: p.crossed, repeatedVersion: p.repeats, sameTop20AsPrevious: p.sameBook, versionDecreases: decreasing, e: [...p.e], versionsHead: p.versions.slice(0, 4), maxGapMs: p.maxGapMs, lastTop: p.lastTop });
  }
}

async function book() {
  const v1 = await open(WS_V1, 'book-v1');
  v1.send(sub(BOOK_SYMBOLS.join(','), 'depth'));
  const diff = await open(WS_V1, 'book-diff');
  diff.send(sub(BOOK_SYMBOLS.slice(0, 2).join(','), 'diffDepth'));
  const merged = await open(WS_V1, 'book-merged');
  merged.send(sub('BTC-SWAP-USDT', 'mergedDepth', { dumpScale: 1 }));
  const v2 = await open(WS_V2, 'book-v2');
  v2.send(JSON.stringify({ topic: 'depth', event: 'sub', params: { binary: false, symbol: 'BTC-SWAP-USDT' } }));
  const t0 = Date.now();
  const ping = setInterval(() => { for (const w of [v1, diff, merged, v2]) w.send(JSON.stringify({ ping: Date.now() })); }, 20_000);
  await sleep(38_000);
  const rest = await fetch(`${API}/quote/v1/contract/depth?symbol=BTC-SWAP-USDT&limit=20`).then((r) => r.json());
  clearInterval(ping);
  for (const [w, label] of [[v1, 'v1 depth'], [diff, 'v1 diffDepth'], [merged, 'v1 mergedDepth'], [v2, 'v2 depth']]) {
    const nonData = w.frames.filter((f) => !f.msg?.data).map((f) => f.text.slice(0, 200));
    const bytes = w.frames.reduce((n, f) => n + f.bytes, 0);
    log('socket', { label, frames: w.frames.length, seconds: (Date.now() - t0) / 1000, bytesPerFrame: Math.round(bytes / Math.max(1, w.frames.length)), binary: w.frames.filter((f) => f.isBinary).length, nonData: nonData.slice(0, 5) });
    summarise(w.frames, label);
    const first = w.frames.find((f) => f.msg?.data);
    if (first) log('firstFrame', { label, afterOpenMsg: first.at - t0, text: first.text.slice(0, 400) });
    w.close();
  }
  const lastBtc = [...v1.frames].reverse().find((f) => f.msg?.symbol === 'BTC-SWAP-USDT' || f.msg?.data?.[0]?.s === 'BTC-SWAP-USDT');
  if (lastBtc) {
    const d = lastBtc.msg.data[0];
    log('restCompare', { socketT: d.t, restT: rest.time, socketTopBids: d.b.slice(0, 5), restTopBids: rest.bids.slice(0, 5), socketTopAsks: d.a.slice(0, 3), restTopAsks: rest.asks.slice(0, 3) });
  }
}

async function errors() {
  const w = await open(WS_V1, 'errors');
  const sends = [
    sub('NOPE-SWAP-USDT', 'depth'),
    sub('BTCUSDT', 'depth'),
    sub('BTC-SWAP-USDT', 'nope'),
    sub('BTC-SWAP-USDT', 'markPrice'),
    sub('BTC-SWAP-USDT', 'indexPrice'),
    sub('BTCUSDT', 'index'),
    sub('BTC-SWAP-USDT', 'fundingRate'),
    sub('BTC-SWAP-USDT', 'realtimes'),
    'not json',
    sub('ETH-SWAP-USDT', 'depth'),
    sub('ETH-SWAP-USDT', 'depth'),
    JSON.stringify({ ping: 1790000000000 }),
  ];
  for (const s of sends) {
    const before = w.frames.length;
    const t = Date.now();
    w.send(s);
    await sleep(1_200);
    const got = w.frames.slice(before);
    const heads = got.filter((f) => !f.msg?.data || got.indexOf(f) === 0).slice(0, 2).map((f) => f.text.slice(0, 260));
    const topics = [...new Set(got.map((f) => `${f.msg?.topic}/${f.msg?.symbol ?? f.msg?.data?.[0]?.s}`))];
    log('reply', { sent: s.slice(0, 120), frames: got.length, firstAfterMs: got[0] ? got[0].at - t : null, topics, heads });
  }
  await sleep(2_000);
  const eth = w.frames.filter((f) => f.msg?.topic === 'depth' && f.msg?.symbol === 'ETH-SWAP-USDT');
  const vs = eth.map((f) => f.msg.data[0].v);
  log('duplicate', { ethFrames: eth.length, distinctVersions: new Set(vs).size });
  w.close();
}

async function batch() {
  const info = await fetch(`${API}/v1/brokerInfo`).then((r) => r.json());
  const symbols = info.contracts.filter((c) => c.status === 'TRADING').map((c) => c.symbol);
  const w = await open(WS_V1, 'batch');
  const t0 = Date.now();
  w.send(sub(symbols.join(','), 'depth'));
  await sleep(30_000);
  const secs = (Date.now() - t0) / 1000;
  const data = w.frames.filter((f) => f.msg?.data);
  const seen = new Map();
  for (const f of data) { const s = f.msg.symbol ?? f.msg.data[0]?.s; seen.set(s, (seen.get(s) ?? 0) + 1); }
  const missing = symbols.filter((s) => !seen.has(s));
  const bytes = w.frames.reduce((n, f) => n + f.bytes, 0);
  const t1 = performance.now();
  for (const f of data) JSON.parse(f.text);
  const parseUs = ((performance.now() - t1) * 1000) / Math.max(1, data.length);
  const firstAll = data.length ? Math.max(...symbols.filter((s) => seen.has(s)).map((s) => data.find((f) => (f.msg.symbol ?? f.msg.data[0]?.s) === s).at - t0)) : null;
  const counts = [...seen.values()].sort((a, b) => a - b);
  log('batch', { requested: symbols.length, delivering: seen.size, missing: missing.slice(0, 10), framesPerSec: +(data.length / secs).toFixed(1), kbPerSec: +(bytes / 1024 / secs).toFixed(1), bytesPerFrame: Math.round(bytes / Math.max(1, data.length)), parseUsPerFrame: +parseUs.toFixed(1), lastFirstFrameMs: firstAll, framesPerSymbolMinMedMax: [counts[0], counts[Math.floor(counts.length / 2)], counts[counts.length - 1]], nonData: w.frames.filter((f) => !f.msg?.data).slice(0, 3).map((f) => f.text.slice(0, 200)) });
  w.close();
}

async function silence() {
  const quiet = await open(WS_V1, 'silence-quiet');
  quiet.send(sub('EDGE-USDT-PERP', 'depth'));
  const pinger = await open(WS_V1, 'silence-ping');
  pinger.send(sub('EDGE-USDT-PERP', 'depth'));
  const bare = await open(WS_V1, 'silence-bare');
  let serverPings = 0;
  for (const w of [quiet, pinger, bare]) w.on('ping', () => serverPings++);
  const ping = setInterval(() => pinger.send(JSON.stringify({ ping: Date.now() })), 20_000);
  await sleep(70_000);
  clearInterval(ping);
  for (const [w, name] of [[quiet, 'subscribed, never sends'], [pinger, 'subscribed, pings every 20 s'], [bare, 'no subscription, never sends']]) {
    const gaps = []; for (let i = 1; i < w.frames.length; i++) gaps.push(w.frames[i].at - w.frames[i - 1].at);
    log('silence', { name, open: w.readyState === WebSocket.OPEN, frames: w.frames.length, maxGapMs: gaps.length ? Math.max(...gaps) : null, pongs: w.frames.filter((f) => f.msg?.pong).length });
    w.close();
  }
  log('serverProtocolPings', { count: serverPings });
}

async function anchor() {
  const info = await fetch(`${API}/v1/brokerInfo`).then((r) => r.json());
  const indices = [...new Set(info.contracts.filter((c) => c.status === 'TRADING').map((c) => c.index))];
  const w = await open(WS_V1, 'anchor');
  const t0 = Date.now();
  w.send(sub(indices.join(','), 'index'));
  w.send(sub('BTC-SWAP-USDT,EDGE-USDT-PERP', 'realtimes'));
  await sleep(30_000);
  const per = new Map();
  for (const f of w.frames) {
    if (f.msg?.topic !== 'index') continue;
    for (const d of f.msg.data ?? []) {
      const p = per.get(d.symbol) ?? { n: 0, changes: 0, last: null, formula: new Set(), maxAgeMs: 0 };
      p.n++;
      if (p.last !== null && p.last !== d.index) p.changes++;
      p.last = d.index;
      p.formula.add(String(d.formula).replace(/[0-9.]+(?=\[)/g, "x")); // the formula string carries each source value
      p.maxAgeMs = Math.max(p.maxAgeMs, f.at - d.time);
      per.set(d.symbol, p);
    }
  }
  const formulas = {};
  for (const [s, p] of per) for (const fm of p.formula) (formulas[fm] ??= []).push(s);
  const counts = [...per.values()].map((p) => p.n).sort((a, b) => a - b);
  log('index', { requested: indices.length, delivering: per.size, seconds: (Date.now() - t0) / 1000, framesPerIndexMinMedMax: [counts[0], counts[Math.floor(counts.length / 2)], counts[counts.length - 1]], formulas: Object.fromEntries(Object.entries(formulas).map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 12) }])), btc: per.get('BTCUSDT') && { n: per.get('BTCUSDT').n, changes: per.get('BTCUSDT').changes, maxAgeMs: per.get('BTCUSDT').maxAgeMs } });
  const rt = w.frames.filter((f) => f.msg?.topic === 'realtimes');
  log('realtimes', { frames: rt.length, keys: rt[0] ? Object.keys(rt[0].msg.data[0]) : null, sample: rt[0]?.text.slice(0, 400) });
  const idx = w.frames.find((f) => f.msg?.topic === 'index');
  log('indexFrame', { text: idx?.text.slice(0, 500) });
  w.close();
}

async function deflate() {
  const w = await open(WS_V1, 'deflate', { deflate: true });
  await sleep(1_000);
  log('deflate', { negotiated: w._extensions && Object.keys(w._extensions) });
  w.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, anchor, batch, silence, deflate };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
await modes[mode]();
setTimeout(() => process.exit(0), 500);
