// Phemex WebSocket probe: book channels and their variants, sequence and level window, periodic snapshots, size unit, the all-symbol ticker and price ticks, keepalive, silence, errors, and the per connection and per client caps.
// Public, unauthenticated and read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node ../scripts/probes/venues/phemex/ws-probe.mjs [book|batch|silence|deflate]
//   book     orderbook_p on six perps for 125 s, long enough for two periodic snapshots, with a REST book compare, the coin-M orderbook, tick_p marks, the all-symbol ticker, variants of the depth arguments, errors and unsubscribe, on two sockets
//   batch    every listed linear perpetual on one socket, subscribes paced at 10 per second, then five more sockets at once for 40 s, about 60 s
//   silence  five sockets that differ only in what the client sends or subscribes, for up to 75 s
//   deflate  asks for permessage-deflate once and prints what the server negotiates
// Set PROBE_OUT_DIR to keep raw frames.
// Recorded in docs/profiles/phemex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://ws.phemex.com';
const API = 'https://api.phemex.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const nsToMs = (ns) => Number(BigInt(ns) / 1000000n);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(label, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(URL_WS, { perMessageDeflate: opts.deflate === true, handshakeTimeout: 10000 });
  const s = { ws, label, t0, openMs: null, closed: null, frames: 0, bytes: 0, serverPings: 0, handlers: [] };
  ws.on('upgrade', (res) => {
    s.upgrade = { status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server, pop: res.headers['x-amz-cf-pop'] };
  });
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      s.refused = { status: res.statusCode, body: body.slice(0, 300) };
      log('refused', { label, status: res.statusCode, headers: res.headers, body: body.slice(0, 300) });
    });
  });
  ws.on('open', () => (s.openMs = Date.now() - t0));
  ws.on('ping', () => s.serverPings++);
  ws.on('message', (d) => {
    s.frames++;
    s.bytes += d.length;
    const text = d.toString();
    capture(`${label}.frames`, `${Date.now()} ${text}`);
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return;
    }
    for (const h of s.handlers) h(j, text, Date.now());
  });
  ws.on('close', (code, reason) => (s.closed = { atMs: Date.now() - t0, code, reason: reason.toString() }));
  ws.on('error', (e) => (s.error = String(e.message)));
  s.ready = new Promise((resolve) => {
    ws.once('open', resolve);
    ws.once('close', resolve);
    ws.once('error', resolve);
  });
  s.send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  };
  return s;
}

async function restBook(symbol) {
  const res = await fetch(`${API}/md/v2/orderbook?symbol=${symbol}`);
  const j = await res.json();
  return { book: j.result.orderbook_p, seq: j.result.sequence, cache: res.headers.get('x-cache') };
}

function newBook() {
  return { bids: new Map(), asks: new Map() };
}

function applySide(map, levels) {
  for (const [p, q] of levels) {
    if (Number(q) === 0) map.delete(p);
    else map.set(p, q);
  }
}

function sorted(book, side) {
  const arr = [...book[side].entries()].map(([p, q]) => [Number(p), q, p]);
  arr.sort((a, b) => (side === 'bids' ? b[0] - a[0] : a[0] - b[0]));
  return arr;
}

function trim(book, n) {
  for (const side of ['bids', 'asks']) {
    const arr = sorted(book, side);
    for (const x of arr.slice(n)) book[side].delete(x[2]);
  }
}

function compareToSnapshot(local, snap) {
  let mismatch = 0;
  let extra = 0;
  for (const side of ['bids', 'asks']) {
    const want = new Map(snap[side]);
    const have = sorted(local, side).slice(0, 30);
    for (const [, q, p] of have) {
      if (!want.has(p)) extra++;
      else if (Number(want.get(p)) !== Number(q)) mismatch++;
    }
  }
  return { mismatch, extra };
}

async function book() {
  const BOOKS = ['BTCUSDT', 'ETHUSDT', 'u1000PEPEUSDT', 'SYNUSDT', 'PATHUSDT', 'BTCUSDC'];
  const A = open('A');
  const B = open('B');
  await Promise.all([A.ready, B.ready]);
  log('open', { A: A.openMs, B: B.openMs, upgradeA: A.upgrade, upgradeB: B.upgrade });

  const st = {};
  for (const s of BOOKS) st[s] = { snaps: [], deltas: 0, emptyDeltas: 0, lastSeq: null, seqDiffs: { 1: 0, '2-5': 0, '>5': 0, '<=0': 0 }, bidsUnordered: 0, asksUnordered: 0, maxUntrimmed: 0, trimmed: newBook(), untrimmed: newBook(), ageMs: [], maxGapMs: 0, lastAt: null, repeats: 0, lastText: null, oneSided: 0, depths: new Set(), periodic: [] };
  const acks = [];
  const other = { tick: {}, pack: { frames: 0, rows: [], types: {}, gaps: [] , lastAt: null }, coinM: null, trades: 0 };
  let firstAt = {};

  A.handlers.push((j, text, at) => {
    if ('id' in j && ('result' in j || 'error' in j) && !j.orderbook_p) {
      acks.push({ sock: 'A', at: at - A.t0, text: text.slice(0, 200) });
      return;
    }
    if (j.orderbook_p) {
      const s = st[j.symbol];
      if (!s) return;
      s.depths.add(j.depth);
      if (s.lastAt) s.maxGapMs = Math.max(s.maxGapMs, at - s.lastAt);
      s.lastAt = at;
      if (s.lastSeq !== null) {
        const d = j.sequence - s.lastSeq;
        s.seqDiffs[d <= 0 ? '<=0' : d === 1 ? 1 : d <= 5 ? '2-5' : '>5']++;
      }
      s.lastSeq = j.sequence;
      s.ageMs.push(at - nsToMs(j.timestamp));
      const bids = j.orderbook_p.bids;
      const asks = j.orderbook_p.asks;
      if (j.type === 'snapshot') {
        const snap = { at: at - A.t0, bids: bids.length, asks: asks.length, seq: j.sequence, bidsDesc: bids.every((x, i) => i === 0 || Number(x[0]) < Number(bids[i - 1][0])), asksAsc: asks.every((x, i) => i === 0 || Number(x[0]) > Number(asks[i - 1][0])) };
        if (s.snaps.length > 0) {
          snap.vsTrimmed = compareToSnapshot(s.trimmed, j.orderbook_p);
          snap.vsUntrimmed = compareToSnapshot(s.untrimmed, j.orderbook_p);
          snap.untrimmedLevels = s.untrimmed.bids.size + s.untrimmed.asks.size;
        } else {
          firstAt[j.symbol] = { top: { bid: bids[0], ask: asks[0] }, ts: j.timestamp, dts: j.dts, mts: j.mts };
          if (bids.length === 0 || asks.length === 0) s.oneSided++;
        }
        s.snaps.push(snap);
        s.trimmed = newBook();
        s.untrimmed = newBook();
        applySide(s.trimmed.bids, bids);
        applySide(s.trimmed.asks, asks);
        applySide(s.untrimmed.bids, bids);
        applySide(s.untrimmed.asks, asks);
        return;
      }
      s.deltas++;
      if (bids.length === 0 && asks.length === 0) s.emptyDeltas++;
      if (bids.length > 1 && !bids.every((x, i) => i === 0 || Number(x[0]) < Number(bids[i - 1][0]))) s.bidsUnordered++;
      if (asks.length > 1 && !asks.every((x, i) => i === 0 || Number(x[0]) > Number(asks[i - 1][0]))) s.asksUnordered++;
      const body = JSON.stringify(j.orderbook_p);
      if (body === s.lastText) s.repeats++;
      s.lastText = body;
      applySide(s.trimmed.bids, bids);
      applySide(s.trimmed.asks, asks);
      trim(s.trimmed, 30);
      applySide(s.untrimmed.bids, bids);
      applySide(s.untrimmed.asks, asks);
      s.maxUntrimmed = Math.max(s.maxUntrimmed, s.untrimmed.bids.size, s.untrimmed.asks.size);
      if (s.trimmed.bids.size === 0 || s.trimmed.asks.size === 0) s.oneSided++;
      return;
    }
    if (j.book && j.symbol === 'BTCUSD') {
      if (!other.coinM) other.coinM = { type: j.type, depth: j.depth, bid: j.book.bids[0], ask: j.book.asks[0], keys: Object.keys(j) };
      return;
    }
    if (j.tick_p || j.tick) {
      const t = j.tick_p || j.tick;
      const o = (other.tick[t.symbol] ||= { n: 0, changes: 0, last: null, firstAt: at - A.t0, lastAt: null, maxGapMs: 0 });
      if (o.lastAt !== null) o.maxGapMs = Math.max(o.maxGapMs, at - A.t0 - o.lastAt);
      o.n++;
      if (o.last !== null && o.last !== t.last) o.changes++;
      o.last = t.last;
      o.lastAt = at - A.t0;
      return;
    }
    if (j.method === 'perp_market24h_pack_p.update') {
      const p = other.pack;
      p.frames++;
      p.rows.push(j.data.length);
      p.types[j.type] = (p.types[j.type] || 0) + 1;
      if (p.lastAt !== null) p.gaps.push(at - p.lastAt);
      p.lastAt = at;
      if (!p.fields) p.fields = j.fields;
      if (!p.btc) p.btc = j.data.find((r) => r[0] === 'BTCUSDT');
      if (j.type === 'snapshot' && !p.snapshot) p.snapshot = { rows: j.data.length, unique: new Set(j.data.map((r) => r[0])).size };
      p.markRows = (p.markRows || 0) + j.data.length;
      p.markEqualsLast = (p.markEqualsLast || 0) + j.data.filter((r) => r[9] === r[4]).length;
      return;
    }
    if (j.trades_p) {
      other.trades++;
      if (!other.tradeFirst) other.tradeFirst = { type: j.type, n: j.trades_p.length, first: j.trades_p[0] };
    }
  });

  let id = 1;
  const t0 = Date.now();
  for (const s of BOOKS) A.send({ id: id++, method: 'orderbook_p.subscribe', params: [s] });
  A.send({ id: id++, method: 'orderbook.subscribe', params: ['BTCUSD'] });
  for (const s of ['.MBTCUSDT', '.BTCUSDT', '.BTCUSDTFR', '.MPATHUSDT', '.METHUSDT']) A.send({ id: id++, method: 'tick_p.subscribe', params: [s] });
  A.send({ id: id++, method: 'perp_market24h_pack_p.subscribe', params: [] });
  A.send({ id: id++, method: 'trade_p.subscribe', params: ['BTCUSDT'] });
  A.send({ id: 999, method: 'server.ping', params: [] });

  // Socket B holds the depth variants, the error cases and the unsubscribe.
  const variants = {};
  const bAcks = [];
  B.handlers.push((j, text, at) => {
    if ('id' in j && ('result' in j || 'error' in j) && !j.orderbook_p && !j.book) {
      bAcks.push({ at: at - B.t0, text: text.slice(0, 220) });
      return;
    }
    const b = j.orderbook_p || j.book;
    if (b && j.symbol) {
      const v = (variants[j.symbol] ||= { frames: 0, snaps: 0, depth: new Set(), maxLevels: 0, first: null, lastAt: null, gaps: [], afterUnsub: 0 });
      v.frames++;
      if (j.type === 'snapshot') v.snaps++;
      v.depth.add(j.depth);
      v.maxLevels = Math.max(v.maxLevels, b.bids.length, b.asks.length);
      if (v.lastAt) v.gaps.push(at - v.lastAt);
      v.lastAt = at;
      if (unsubAt && at > unsubAt + 1000) v.afterUnsub++;
    }
  });
  let unsubAt = null;
  const bSends = [
    ['ETHUSDT', true],
    ['SOLUSDT', false, 0],
    ['XRPUSDT', true, 30],
    ['DOGEUSDT', false, 10],
    ['ADAUSDT', false, 1],
    ['BTCUSDT', false, 20],
    ['NOPEUSDT'],
    ['BTCUSD'],
    ['LSKUSDT'],
  ];
  let bid = 100;
  for (const params of bSends) B.send({ id: bid++, method: 'orderbook_p.subscribe', params });
  B.send({ id: bid++, method: 'orderbook.subscribe', params: ['BTCUSDT'] });
  B.send({ id: bid++, method: 'nope.subscribe', params: [] });
  B.send('not json');
  B.send({ id: bid++, method: 'orderbook_p.subscribe', params: ['ETHUSDT', true] });
  B.send({ id: 0, method: 'server.ping', params: [] });

  // REST compare on BTCUSDT and u1000PEPEUSDT after 10 s.
  await sleep(10000);
  for (const sym of ['BTCUSDT', 'u1000PEPEUSDT']) {
    const r = await restBook(sym);
    const s = st[sym];
    const local = { bids: sorted(s.trimmed, 'bids').slice(0, 20), asks: sorted(s.trimmed, 'asks').slice(0, 20) };
    const rest = { bids: new Map(r.book.bids), asks: new Map(r.book.asks) };
    let same = 0;
    let shared = 0;
    for (const side of ['bids', 'asks']) for (const [, q, p] of local[side]) if (rest[side].has(p)) { shared++; if (Number(rest[side].get(p)) === Number(q)) same++; }
    log('size_vs_rest', { symbol: sym, restSeq: r.seq, wsSeq: s.lastSeq, cache: r.cache, sharedPrices: shared, sameSize: same, wsTop: { bid: local.bids[0]?.slice(2).concat(local.bids[0]?.[1]), ask: local.asks[0]?.slice(2).concat(local.asks[0]?.[1]) }, restTop: { bid: r.book.bids[0], ask: r.book.asks[0] } });
  }

  await sleep(10000);
  unsubAt = Date.now();
  B.send({ id: 777, method: 'orderbook_p.unsubscribe', params: [] });
  await sleep(5000);
  const pingAt = Date.now();
  let pongMs = null;
  A.handlers.push((j, text, at) => {
    if (j.id === 555 && j.result === 'pong' && pongMs === null) pongMs = at - pingAt;
  });
  A.send({ id: 555, method: 'server.ping', params: [] });

  const endAt = t0 + 125000;
  while (Date.now() < endAt) {
    A.send({ id: 0, method: 'server.ping', params: [] });
    B.send({ id: 0, method: 'server.ping', params: [] });
    await sleep(5000);
  }
  A.ws.close();
  B.ws.close();
  await sleep(300);

  log('acks_A', { acks: acks.slice(0, 16) });
  log('acks_B', { acks: bAcks.slice(0, 20) });
  log('pong_ms', { pongMs });
  for (const s of BOOKS) {
    const x = st[s];
    const ages = x.ageMs.sort((a, b) => a - b);
    log('book_stream', {
      symbol: s,
      depths: [...x.depths],
      snapshots: x.snaps,
      deltas: x.deltas,
      emptyDeltas: x.emptyDeltas,
      seqDiffs: x.seqDiffs,
      bidsUnordered: x.bidsUnordered,
      asksUnordered: x.asksUnordered,
      maxUntrimmedLevelsPerSide: x.maxUntrimmed,
      repeats: x.repeats,
      oneSided: x.oneSided,
      maxGapMs: x.maxGapMs,
      ageMs: { min: ages[0], median: ages[Math.floor(ages.length / 2)], max: ages[ages.length - 1] },
      first: firstAt[s],
    });
  }
  log('variants_B', Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { frames: v.frames, snaps: v.snaps, depth: [...v.depth], maxLevels: v.maxLevels, medianGapMs: v.gaps.sort((a, b) => a - b)[Math.floor(v.gaps.length / 2)], framesAfterUnsubscribe: v.afterUnsub }])));
  const p = other.pack;
  const g = p.gaps.sort((a, b) => a - b);
  log('ticker_pack', { frames: p.frames, types: p.types, rowsMin: Math.min(...p.rows), rowsMax: Math.max(...p.rows), gapMs: { min: g[0], median: g[Math.floor(g.length / 2)], max: g[g.length - 1] }, fields: p.fields, btc: p.btc, snapshot: p.snapshot, markEqualsLastRows: `${p.markEqualsLast} of ${p.markRows}` });
  log('ticks', other.tick);
  log('coinM_book', other.coinM);
  log('trades', { frames: other.trades, first: other.tradeFirst });
  log('sockets', { A: { frames: A.frames, bytes: A.bytes, serverPings: A.serverPings, closed: A.closed }, B: { frames: B.frames, serverPings: B.serverPings, closed: B.closed } });
}

async function batch() {
  // Every listed linear perpetual, busiest first, which is more than the documented 20 per connection.
  const res = await fetch(`${API}/public/products`);
  const listed = new Set((await res.json()).data.perpProductsV2.filter((p) => p.status === 'Listed').map((p) => p.symbol));
  const tres = await fetch(`${API}/md/v3/ticker/24hr/all`);
  const rows = (await tres.json()).result.filter((r) => listed.has(r.symbol)).sort((a, b) => Number(b.turnoverRv) - Number(a.turnoverRv));
  const syms = rows.map((r) => r.symbol);
  const S = open('batch');
  await S.ready;
  const acks = {};
  const frames = {};
  const snaps = {};
  let parseNs = 0n;
  let parsed = 0;
  let windowStart = null;
  const perSecond = [];
  let inSecond = 0;
  S.ws.on('message', (d) => {
    const a = process.hrtime.bigint();
    JSON.parse(d.toString());
    parseNs += process.hrtime.bigint() - a;
    parsed++;
    const now = Date.now();
    if (windowStart === null) windowStart = now;
    while (now - windowStart >= 1000) {
      perSecond.push(inSecond);
      inSecond = 0;
      windowStart += 1000;
    }
    inSecond++;
  });
  S.handlers.push((j) => {
    if ('id' in j && ('result' in j || 'error' in j) && !j.orderbook_p) acks[j.id] = j.error ? `${j.error.code} ${j.error.message}` : 'ok';
    if (j.orderbook_p) {
      frames[j.symbol] = (frames[j.symbol] || 0) + 1;
      if (j.type === 'snapshot') snaps[j.symbol] = (snaps[j.symbol] || 0) + 1;
    }
  });
  const subStart = Date.now();
  for (let i = 0; i < syms.length; i++) {
    S.send({ id: i + 1, method: 'orderbook_p.subscribe', params: [syms[i]] });
    await sleep(100);
    if (i % 25 === 24) S.send({ id: 0, method: 'server.ping', params: [] });
  }
  await sleep(3000);
  const ackCounts = {};
  for (let i = 0; i < syms.length; i++) ackCounts[acks[i + 1] ?? 'none'] = (ackCounts[acks[i + 1] ?? 'none'] || 0) + 1;
  const firstNotOk = syms.findIndex((_, i) => acks[i + 1] !== 'ok');
  log('batch_acks', { subscribed: syms.length, subscribeMs: Date.now() - subStart - 3000, ackCounts, firstNotOk: firstNotOk < 0 ? null : `${firstNotOk + 1}:${syms[firstNotOk]}:${acks[firstNotOk + 1]}` });
  const steadyFrom = perSecond.length;

  // Five more sockets at once, for six open on this host.
  const extra = [];
  for (let i = 0; i < 5; i++) extra.push(open(`extra${i}`));
  await Promise.all(extra.map((x) => x.ready));
  const extraAcks = {};
  // The last extra socket names two symbols in one frame, to see whether params carries more than one.
  extra.forEach((x, i) => {
    x.symbols = new Set();
    x.handlers.push((j) => {
      if (j.id === 1) extraAcks[x.label] = j.error ? `${j.error.code} ${j.error.message}` : JSON.stringify(j.result);
      if (j.orderbook_p) x.symbols.add(j.symbol);
    });
    const params = i === 4 ? [syms[4], syms[5]] : [syms[i]];
    extraAcks[`${x.label}_params`] = params.join(',');
    x.send({ id: 1, method: 'orderbook_p.subscribe', params });
  });
  const t0 = Date.now();
  let pings = 0;
  while (Date.now() - t0 < 40000) {
    S.send({ id: 0, method: 'server.ping', params: [] });
    for (const x of extra) x.send({ id: 0, method: 'server.ping', params: [] });
    pings++;
    await sleep(5000);
  }
  const counts = syms.map((s) => frames[s] || 0);
  const steady = perSecond.slice(steadyFrom).sort((a, b) => a - b);
  log('batch_frames', {
    symbols: syms.length,
    delivering: counts.filter((c) => c > 0).length,
    withSnapshot: Object.keys(snaps).length,
    silent: syms.filter((s) => !frames[s]),
    busiest: syms.slice(0, 5).map((s) => `${s}:${frames[s] || 0}`),
    total: S.frames,
    bytesPerFrame: Math.round(S.bytes / S.frames),
    steadyPerSecond: { median: steady[Math.floor(steady.length / 2)], max: steady[steady.length - 1], kbPerSecond: Math.round(S.bytes / 1024 / ((Date.now() - subStart) / 1000)) },
    parseUsPerFrame: Number(parseNs / BigInt(parsed)) / 1000,
  });
  log('extra_sockets', { sockets: extra.map((x) => ({ label: x.label, openMs: x.openMs, refused: x.refused ?? null, closed: x.closed, error: x.error ?? null, frames: x.frames, symbols: [...x.symbols] })), acks: extraAcks });
  S.ws.close();
  for (const x of extra) x.ws.close();
  await sleep(300);
  log('batch_socket', { closed: S.closed });
}

async function silence() {
  const cases = [
    { label: 'nothing', sub: null, ping: null },
    { label: 'sub_busy_no_ping', sub: 'BTCUSDT', ping: null },
    { label: 'sub_quiet_no_ping', sub: 'PATHUSDT', ping: null },
    { label: 'app_ping_10s', sub: null, ping: 'app' },
    { label: 'protocol_ping_10s', sub: null, ping: 'protocol' },
  ];
  const socks = cases.map((c) => ({ c, s: open(c.label) }));
  await Promise.all(socks.map((x) => x.s.ready));
  const lastFrame = {};
  for (const { c, s } of socks) {
    s.pongs = 0;
    s.ws.on('pong', () => s.pongs++);
    s.handlers.push((j, text, at) => {
      lastFrame[c.label] = at - s.t0;
      if (j.result === 'pong') s.pongs++;
    });
    if (c.sub) s.send({ id: 1, method: 'orderbook_p.subscribe', params: [c.sub] });
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 75000 && socks.some((x) => x.s.closed === null)) {
    await sleep(1000);
    const el = Date.now() - t0;
    if (el % 10000 < 1000) {
      for (const { c, s } of socks) {
        if (s.ws.readyState !== s.ws.OPEN) continue;
        if (c.ping === 'app') s.send({ id: 0, method: 'server.ping', params: [] });
        if (c.ping === 'protocol') s.ws.ping();
      }
    }
  }
  for (const { s } of socks) if (s.ws.readyState === s.ws.OPEN) s.ws.close();
  await sleep(300);
  for (const { c, s } of socks) log('silence', { label: c.label, openMs: s.openMs, frames: s.frames, pongs: s.pongs, serverPings: s.serverPings, closedAtMs: s.closed?.atMs, code: s.closed?.code, reason: s.closed?.reason, lastFrameMs: lastFrame[c.label] ?? null });
}

async function deflate() {
  const s = open('deflate', { deflate: true });
  await s.ready;
  log('deflate', { openMs: s.openMs, upgrade: s.upgrade, negotiated: s.ws.extensions });
  s.ws.close();
  await sleep(300);
}

const mode = process.argv[2] || 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await book();
else if (mode === 'batch') await batch();
else if (mode === 'silence') await silence();
else if (mode === 'deflate') await deflate();
log('done', { at: new Date().toISOString() });
process.exit(0);
