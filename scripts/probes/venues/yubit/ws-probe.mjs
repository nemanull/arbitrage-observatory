// YUBIT WebSocket probe: the web app's public futures socket, its book topics, level order, the b1 and a1 check, sequence fields, tickers.all, keepalive, silence and errors.
// YUBIT documents no public WebSocket, so the URL, topics and ping format are the ones the www.yubit.com futures web app uses, found in its script bundle.
// Public, unauthenticated and read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/yubit/ws-probe.mjs [book|tickers|batch|silence|deflate]
//   book     books-25 and books-200 on four USDT perps for 60 s, ticker fields, the inverse socket, and error cases, about 65 s
//   tickers  tickers.all for 30 s: rows per frame, fields, how often mark and index change, and per contract funding fields, about 32 s
//   batch    books-25 on 100 USDT perps on one connection for 40 s, about 45 s
//   silence  four sockets that differ only in whether they subscribe and whether they answer the server ping, for up to 90 s
//   deflate  asks for permessage-deflate once, then opens the binary variant the web app uses by default, about 8 s
// Set PROBE_OUT_DIR to keep raw frames, trimmed to 2,000 characters each.
// Recorded in docs/profiles/yubit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const LINEAR_URL = 'wss://www.yubit.com/realtime_public?v=2&bin=false';
const INVERSE_URL = 'wss://www.yubit.com/realtime?v=2&bin=false';
const BINARY_URL = 'wss://www.yubit.com/realtime_public?v=2&bin=true';
const CATALOG = 'https://www.yubit.com/mapi/trade/public/v1/market/dynamic_symbol';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
};

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(url, name, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false, headers: { Origin: 'https://www.yubit.com' } });
  ws.t0 = t0;
  ws.pings = [];
  ws.on('upgrade', (res) => log('upgrade', { name, status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, ms: Date.now() - t0 }));
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => log('refused', { name, status: res.statusCode, body: body.slice(0, 200) }));
  });
  ws.on('error', (e) => log('socket_error', { name, error: e.message }));
  ws.on('close', (code, reason) => log('close', { name, code, reason: reason.toString(), afterMs: Date.now() - t0 }));
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

// The server sends {"op":"ping","args":["<ms>"]} and the web app answers {"op":"pong","args":["<ms>"]}.
function answerPings(ws, name, answer = true) {
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const s = data.toString();
    if (!s.startsWith('{"op":"ping"')) return;
    const j = JSON.parse(s);
    ws.pings.push(Date.now() - ws.t0);
    if (ws.pings.length === 1) capture(`${name}.txt`, `server ping ${s}`);
    if (answer && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op: 'pong', args: j.args.map(String) }));
  });
}

const send = (ws, obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));

// A local book per stream, keyed by price string, checked against the b1 and a1 each delta carries.
class Book {
  constructor() {
    this.bids = new Map();
    this.asks = new Map();
  }
  apply(side, levels) {
    const m = side === 'b' ? this.bids : this.asks;
    for (const [p, q] of levels) {
      if (Number(q) === 0) m.delete(p);
      else m.set(p, q);
    }
  }
  bestBid() {
    let best = null;
    for (const p of this.bids.keys()) if (best === null || Number(p) > Number(best)) best = p;
    return best;
  }
  bestAsk() {
    let best = null;
    for (const p of this.asks.keys()) if (best === null || Number(p) < Number(best)) best = p;
    return best;
  }
}

const order = (levels) => {
  if (levels.length < 2) return 'n/a';
  let asc = true;
  let desc = true;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (b < a) asc = false;
    if (b > a) desc = false;
  }
  return asc ? 'ascending' : desc ? 'descending' : 'unordered';
};

function newStat() {
  return { snapshots: 0, snapshotAgeMs: [], snapshotBids: [], snapshotAsks: [], snapshotBidOrder: [], snapshotAskOrder: [], deltas: 0, replayed: 0, emptyDeltas: 0, deltaBidOrder: {}, deltaAskOrder: {}, bboMismatch: 0, bboMissing: 0, crossed: 0, maxBids: 0, maxAsks: 0, csBackwards: 0, csEqual: 0, tsStepMs: [], arrivalGapMs: [], repeats: 0, sizes: [] };
}

// Applies a books-N frame to the stream's book and records every check.
function onBookFrame(stats, books, j, arrival) {
  const topic = j.topic;
  const st = (stats[topic] ??= newStat());
  const d = j.data;
  const tsMs = j.ts / 1000;
  if (j.type === 'snapshot') {
    st.snapshots++;
    st.snapshotAgeMs.push(Math.round(arrival - tsMs));
    st.snapshotBids.push(d.b.length);
    st.snapshotAsks.push(d.a.length);
    st.snapshotBidOrder.push(order(d.b));
    st.snapshotAskOrder.push(order(d.a));
    const book = new Book();
    book.apply('b', d.b);
    book.apply('a', d.a);
    books[topic] = book;
    st.lastCs = j.cs;
    st.lastTs = tsMs;
    st.lastArrival = arrival;
    st.lastKey = null;
    st.sizes.push(...d.b.slice(-3).map((l) => l[1]));
    return;
  }
  const book = books[topic];
  if (!book) {
    st.deltaBeforeSnapshot = (st.deltaBeforeSnapshot ?? 0) + 1;
    return;
  }
  st.deltas++;
  if (arrival - tsMs > 1500) st.replayed++;
  const b = d.b ?? [];
  const a = d.a ?? [];
  if (b.length === 0 && a.length === 0) st.emptyDeltas++;
  const bo = order(b);
  const ao = order(a);
  st.deltaBidOrder[bo] = (st.deltaBidOrder[bo] ?? 0) + 1;
  st.deltaAskOrder[ao] = (st.deltaAskOrder[ao] ?? 0) + 1;
  const key = JSON.stringify([b, a]);
  if (key === st.lastKey) st.repeats++;
  st.lastKey = key;
  book.apply('b', b);
  book.apply('a', a);
  st.maxBids = Math.max(st.maxBids, book.bids.size);
  st.maxAsks = Math.max(st.maxAsks, book.asks.size);
  const bb = book.bestBid();
  const ba = book.bestAsk();
  if (d.b1 === undefined || d.a1 === undefined) st.bboMissing++;
  else if (Number(d.b1) !== Number(bb) || Number(d.a1) !== Number(ba)) {
    st.bboMismatch++;
    if (st.bboMismatch <= 2) st.firstMismatch = [...(st.firstMismatch ?? []), { b1: d.b1, a1: d.a1, local: [bb, ba] }];
  }
  if (bb !== null && ba !== null && Number(bb) >= Number(ba)) st.crossed++;
  if (j.cs < st.lastCs) st.csBackwards++;
  if (j.cs === st.lastCs) st.csEqual++;
  st.tsStepMs.push(Math.round(tsMs - st.lastTs));
  st.arrivalGapMs.push(arrival - st.lastArrival);
  st.lastCs = j.cs;
  st.lastTs = tsMs;
  st.lastArrival = arrival;
}

function summarize(stats) {
  for (const [topic, st] of Object.entries(stats)) {
    const live = st.arrivalGapMs.filter((g) => g > 0);
    log('book_stream', {
      topic,
      snapshots: st.snapshots,
      snapshotAgeMs: st.snapshotAgeMs,
      snapshotLevels: [st.snapshotBids, st.snapshotAsks],
      snapshotOrder: [st.snapshotBidOrder, st.snapshotAskOrder],
      deltas: st.deltas,
      replayedAtSubscribe: st.replayed,
      deltaBeforeSnapshot: st.deltaBeforeSnapshot ?? 0,
      emptyDeltas: st.emptyDeltas,
      repeats: st.repeats,
      deltaOrder: [st.deltaBidOrder, st.deltaAskOrder],
      bboMismatch: st.bboMismatch,
      bboMissing: st.bboMissing,
      firstMismatch: st.firstMismatch,
      crossed: st.crossed,
      maxLevels: [st.maxBids, st.maxAsks],
      csBackwards: st.csBackwards,
      csEqual: st.csEqual,
      tsStepMs: { median: median(st.tsStepMs), min: Math.min(...st.tsStepMs), max: Math.max(...st.tsStepMs) },
      liveGapMs: { median: median(live), p90: pct(live, 0.9), max: Math.max(0, ...live) },
      sampleSizes: st.sizes.slice(0, 3),
    });
  }
}

async function catalogRows() {
  const r = await fetch(CATALOG);
  const j = await r.json();
  return j.data.LinearPerpetual;
}

async function book() {
  const lin = await catalogRows();
  const names = new Set(lin.map((r) => r.symbolName));
  const syms = ['M1BTCUSDT', 'M1ETHUSDT', 'M1ONDOUSDT', 'M1KWEBUSDT'].filter((s) => names.has(s));
  log('symbols', { syms, lot: syms.map((s) => lin.find((r) => r.symbolName === s).lotSize) });

  const stats = {};
  const books = {};
  const acks = [];
  const tickerFields = {};
  let firstTicker = null;
  let trades = 0;
  const ws = await open(LINEAR_URL, 'book');
  answerPings(ws, 'book');
  ws.on('message', (data, isBinary) => {
    const arrival = Date.now();
    if (isBinary) return log('binary', { bytes: data.length });
    const s = data.toString();
    capture('book.txt', `${arrival - ws.t0} ${s}`);
    let j;
    try {
      j = JSON.parse(s);
    } catch {
      return acks.push({ atMs: arrival - ws.t0, text: s.slice(0, 200) });
    }
    if (j.topic?.startsWith('books-')) return onBookFrame(stats, books, j, arrival);
    if (j.topic?.startsWith('tickers-')) {
      for (const k of Object.keys(j.data)) tickerFields[k] = (tickerFields[k] ?? 0) + 1;
      if (j.type === 'snapshot' && !firstTicker) firstTicker = j;
      return;
    }
    if (j.topic?.startsWith('trades-')) return void trades++;
    if (j.op === 'ping') return;
    acks.push({ atMs: arrival - ws.t0, success: j.success, ret_msg: j.ret_msg, op: j.op, request: j.request, keys: Object.keys(j) });
  });

  send(ws, { op: 'subscribe', args: syms.map((s) => `books-25.${s}`) });
  await sleep(300);
  send(ws, { op: 'subscribe', args: syms.slice(0, 2).map((s) => `books-200.${s}`) });
  send(ws, { op: 'subscribe', args: ['tickers-100.M1BTCUSDT'] });
  send(ws, { op: 'subscribe', args: ['trades-100.M1BTCUSDT'] });
  await sleep(1500);
  // Error cases, each in its own frame so that one refusal cannot take the others with it.
  for (const topic of ['books-25.M1NOPEUSDT', 'books-25.BTCUSDT', 'books-20.M1BTCUSDT', 'books-50.M1BTCUSDT', 'books-80.M1BTCUSDT', 'books-25.BTCUSD', 'books-25.M1BTCUSDT', 'nope.M1BTCUSDT', 'index_quote_20.M1BTCUSDT', 'index_quote_20.BTCUSDT']) {
    send(ws, { op: 'subscribe', args: [topic] });
    await sleep(150);
  }
  // A new good topic beside a bad one shows whether one bad topic refuses the whole frame.
  send(ws, { op: 'subscribe', args: ['books-25.M1SOLUSDT', 'books-25.M1NOPE2USDT'] });
  send(ws, { op: 'nope', args: [] });
  send(ws, 'not json');
  send(ws, { op: 'ping', args: [String(Date.now())] });

  const inv = await open(INVERSE_URL, 'inverse');
  answerPings(inv, 'inverse');
  const invSeen = {};
  inv.on('message', (data) => {
    let j;
    try {
      j = JSON.parse(data.toString());
    } catch {
      return void (invSeen.text = (invSeen.text ?? 0) + 1);
    }
    const k = j.topic ? `${j.topic} ${j.type}` : `ack ${j.success} ${j.ret_msg}`;
    invSeen[k] = (invSeen[k] ?? 0) + 1;
    if (j.topic && invSeen[k] === 1) capture('inverse.txt', data.toString());
  });
  send(inv, { op: 'subscribe', args: ['books-25.BTCUSD'] });
  send(inv, { op: 'subscribe', args: ['books-25.M1BTCUSDT'] });
  await sleep(8000);
  inv.close();

  await sleep(50000);
  ws.close();
  await sleep(300);
  log('acks', { acks });
  log('inverse_socket', { seen: invSeen });
  log('server_pings', { atMs: ws.pings, gaps: ws.pings.slice(1).map((t, i) => t - ws.pings[i]) });
  log('mixed_frame', { goodTopicDelivered: stats['books-25.M1SOLUSDT'] !== undefined });
  log('ticker', { fields: tickerFields, trades, snapshot: firstTicker && Object.fromEntries(Object.entries(firstTicker.data).filter(([k]) => !/^p\d+P$|^pUtc/.test(k))) });
  summarize(stats);
}

async function tickers() {
  const lin = await catalogRows();
  const known = new Set(lin.map((r) => r.symbolName));
  const ws = await open(LINEAR_URL, 'tickers');
  answerPings(ws, 'tickers');
  const frames = [];
  const seen = new Set();
  const field = {};
  const last = new Map();
  const changes = { mp: new Map(), ip: new Map(), fr: new Map() };
  let parseUs = 0;
  let bytes = 0;
  let firstRowBTC = null;
  const notInCatalogRow = new Map();
  const per = {};
  let shape = null;
  ws.on('message', (data) => {
    const arrival = Date.now();
    const s = data.toString();
    if (s.startsWith('{"topic":"tickers-1')) {
      const j = JSON.parse(s);
      const f = (per[j.topic] ??= { frames: 0, snapshot: null, fr: new Set(), ft: new Set() });
      f.frames++;
      if (j.type === 'snapshot') f.snapshot = { fr: j.data.fr, pf: j.data.pf, nh: j.data.nh, ft: j.data.ft, frgs: j.data.frgs, mp: j.data.mp, ip: j.data.ip };
      if (j.data.fr !== undefined) f.fr.add(j.data.fr);
      if (j.data.ft !== undefined) f.ft.add(j.data.ft);
      return;
    }
    if (!s.includes('"tickers.all"') || s.startsWith('{"success"')) {
      if (!s.startsWith('{"op":"ping"')) log('other', { frame: s.slice(0, 200) });
      return;
    }
    const t0 = performance.now();
    const j = JSON.parse(s);
    parseUs += (performance.now() - t0) * 1000;
    bytes += s.length;
    if (frames.length < 2) capture('tickers.txt', s);
    frames.push({ at: arrival - ws.t0, rows: j.data.length, type: j.type ?? null });
    if (frames.length === 5) {
      const lin5 = j.data.filter((r) => known.has(r.s));
      const ppm = lin5.map((r) => Math.round(((Number(r.mp) - Number(r.ip)) / Number(r.ip)) * 1e6)).map(Math.abs);
      shape = {
        contracts: lin5.length,
        markEqualsLast: lin5.filter((r) => Number(r.mp) === Number(r.p)).length,
        markIndexAbsPpm: { median: median(ppm), p90: pct(ppm, 0.9), over10000: ppm.filter((x) => x > 10000).length, max: Math.max(...ppm) },
        zeroMarkOrIndex: lin5.filter((r) => !(Number(r.mp) > 0) || !(Number(r.ip) > 0)).length,
      };
    }
    for (const r of j.data) {
      seen.add(r.s);
      for (const k of Object.keys(r)) field[k] = (field[k] ?? 0) + 1;
      if (!known.has(r.s) && !notInCatalogRow.has(r.s)) notInCatalogRow.set(r.s, { s: r.s, p: r.p, mp: r.mp, ip: r.ip, v: r.v, ct: r.ct });
      if (r.s === 'M1BTCUSDT' && !firstRowBTC) firstRowBTC = Object.fromEntries(Object.entries(r).filter(([k]) => !/^p\d+P$|^pUtc/.test(k)));
      const prev = last.get(r.s) ?? {};
      for (const k of ['mp', 'ip', 'fr']) {
        if (r[k] !== undefined && prev[k] !== undefined && r[k] !== prev[k]) changes[k].set(r.s, (changes[k].get(r.s) ?? 0) + 1);
        if (r[k] !== undefined) prev[k] = r[k];
      }
      last.set(r.s, prev);
    }
  });
  send(ws, { op: 'subscribe', args: ['tickers.all'] });
  send(ws, { op: 'subscribe', args: ['tickers-1000.M1BTCUSDT', 'tickers-1000.M1ONDOUSDT', 'tickers-1000.M1NVDAUSDT', 'tickers-100.M1BTCUSDT'] });
  await sleep(30000);
  ws.close();
  const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at);
  const withAll = [...last.values()].filter((v) => v.mp !== undefined && v.ip !== undefined).length;
  const perSym = (m) => {
    const v = [...m.values()];
    return { contractsThatChanged: v.length, medianChanges: median(v), max: Math.max(0, ...v) };
  };
  log('tickers_all', {
    frames: frames.length,
    rowsPerFrame: { first: frames[0]?.rows, median: median(frames.map((f) => f.rows)), max: Math.max(...frames.map((f) => f.rows)) },
    gapMs: { median: median(gaps), max: Math.max(0, ...gaps) },
    typeField: [...new Set(frames.map((f) => f.type))],
    distinctSymbols: seen.size,
    inCatalog: [...seen].filter((s) => known.has(s)).length,
    catalogNotSeen: lin.length - [...seen].filter((s) => known.has(s)).length,
    notInCatalog: [...seen].filter((s) => !known.has(s)).slice(0, 10),
    withMarkAndIndex: withAll,
    fieldCounts: Object.fromEntries(Object.entries(field).filter(([k]) => !/^p\d+P$|^pUtc/.test(k))),
    markChanges: perSym(changes.mp),
    indexChanges: perSym(changes.ip),
    rateChanges: perSym(changes.fr),
    kbPerS: Math.round(bytes / 30 / 1024),
    parseUsPerFrame: Math.round(parseUs / Math.max(1, frames.length)),
    btcRow: firstRowBTC,
    fifthFrameShape: shape,
    majors: ['M1BTCUSDT', 'M1ETHUSDT', 'M1SOLUSDT'].map((sym) => [sym, changes.mp.get(sym) ?? 0, changes.ip.get(sym) ?? 0]),
    notInCatalogRows: [...notInCatalogRow.values()],
  });
  log('tickers_per_contract', Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { frames: v.frames, snapshot: v.snapshot, distinctFr: [...v.fr], distinctFt: [...v.ft] }])));
}

async function batch() {
  const lin = await catalogRows();
  const pick = lin.filter((_, i) => i % 5 === 0).slice(0, 100).map((r) => r.symbolName);
  const ws = await open(LINEAR_URL, 'batch');
  answerPings(ws, 'batch');
  const stats = {};
  const books = {};
  const acks = [];
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  let firstFrameAt = null;
  ws.on('message', (data) => {
    const arrival = Date.now();
    const s = data.toString();
    const t0 = performance.now();
    const j = JSON.parse(s);
    parseUs += (performance.now() - t0) * 1000;
    if (j.topic?.startsWith('books-')) {
      frames++;
      bytes += s.length;
      firstFrameAt ??= arrival;
      return onBookFrame(stats, books, j, arrival);
    }
    if (j.success !== undefined) acks.push([j.success, j.ret_msg, j.request?.args?.length]);
  });
  const sentAt = Date.now();
  for (let i = 0; i < pick.length; i += 50) send(ws, { op: 'subscribe', args: pick.slice(i, i + 50).map((s) => `books-25.${s}`) });
  await sleep(40000);
  ws.close();
  const all = Object.values(stats);
  const secs = (Date.now() - sentAt) / 1000;
  log('batch', {
    contracts: pick.length,
    acks,
    streamsWithSnapshot: all.filter((s) => s.snapshots > 0).length,
    snapshotsTotal: all.reduce((n, s) => n + s.snapshots, 0),
    deltas: all.reduce((n, s) => n + s.deltas, 0),
    bboMismatch: all.reduce((n, s) => n + s.bboMismatch, 0),
    crossed: all.reduce((n, s) => n + s.crossed, 0),
    csBackwards: all.reduce((n, s) => n + s.csBackwards, 0),
    framesPerS: Math.round(frames / secs),
    kbPerS: Math.round(bytes / secs / 1024),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: Math.round(parseUs / Math.max(1, frames)),
    medianTsStepMs: median(all.flatMap((s) => s.tsStepMs)),
    maxLiveGapMs: Math.max(0, ...all.flatMap((s) => s.arrivalGapMs)),
    streamsWithGapOver10s: all.filter((s) => s.arrivalGapMs.some((g) => g > 10000)).length,
    maxLevels: [Math.max(...all.map((s) => s.maxBids)), Math.max(...all.map((s) => s.maxAsks))],
    snapshotBidOrder: [...new Set(all.flatMap((s) => s.snapshotBidOrder))],
    firstFrameAfterMs: firstFrameAt - sentAt,
  });
}

async function silence() {
  const variants = [
    ['sub_pong', true, true],
    ['sub_nopong', true, false],
    ['nosub_pong', false, true],
    ['nosub_nopong', false, false],
  ];
  const sockets = [];
  for (const [name, sub, pong] of variants) {
    const ws = await open(LINEAR_URL, name);
    answerPings(ws, name, pong);
    let frames = 0;
    ws.on('message', () => frames++);
    ws.on('close', () => log('silence_close', { name, afterMs: Date.now() - ws.t0, frames, pings: ws.pings.length, lastPingAtMs: ws.pings.at(-1) ?? null }));
    if (sub) send(ws, { op: 'subscribe', args: ['books-25.M1BTCUSDT'] });
    sockets.push([name, ws, () => frames]);
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 90000 && sockets.some(([, ws]) => ws.readyState === ws.OPEN)) await sleep(1000);
  for (const [name, ws, frames] of sockets) {
    if (ws.readyState === ws.OPEN) {
      log('silence_open', { name, afterMs: Date.now() - ws.t0, frames: frames(), pings: ws.pings.length, pingGaps: ws.pings.slice(1).map((t, i) => t - ws.pings[i]).slice(0, 6) });
      ws.close();
    }
  }
  await sleep(300);
}

async function deflate() {
  const ws = await open(LINEAR_URL, 'deflate', { deflate: true });
  await sleep(1500);
  ws.close();
  const bin = await open(BINARY_URL, 'binary');
  answerPings(bin, 'binary');
  const kinds = {};
  bin.on('message', (data, isBinary) => {
    const k = isBinary ? `binary first bytes ${data.subarray(0, 4).toString('hex')}` : `text ${data.toString().slice(0, 40)}`;
    kinds[k] = (kinds[k] ?? 0) + 1;
  });
  send(bin, { op: 'subscribe', args: ['books-25.M1BTCUSDT'] });
  await sleep(5000);
  bin.close();
  log('binary_variant', { kinds });
}

const mode = process.argv[2] ?? 'book';
const run = { book, tickers, batch, silence, deflate }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
