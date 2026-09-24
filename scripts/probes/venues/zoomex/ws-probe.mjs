// Zoomex public WebSocket probe: book channels and depths, snapshot and sequence rule, level order and window, size unit against REST, ticker, errors, keepalive, silence, the whole linear catalog on one connection, deflate, and a same-instant compare with Bybit's public book stream.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/zoomex/ws-probe.mjs [book|mirror|tickers|errors|batch|silence|idle|deflate]
//   book     orderbook.50 on four linear perps for 50 s with a REST book compare, orderbook.1, 200, 500 and 1000, tickers, the inverse URL, and the retired v3 URL. About 60 s.
//   mirror   orderbook.50 on the same six symbols from Zoomex and from Bybit at once for 40 s, matching frames by update id and sampling both touches every 100 ms.
//   tickers  the ticker topic on Zoomex and Bybit for six perps for 20 s, beside Zoomex's REST ticker, comparing index, mark, funding and open interest.
//   errors   unknown symbol, unsupported depth, unknown topic and op, text that is not JSON, duplicate subscribe, a spot symbol, and the args length cap. About 15 s.
//   batch    orderbook.50 on every linear perp on one Zoomex connection and one Bybit connection for 40 s, classing each symbol as Bybit's book relayed or a separate book.
//   silence  four sockets that differ only in what the client sends or subscribes, on the quietest perp, for up to 110 s.
//   idle     three more sockets for up to 40 s: a quiet book with a 5 s ping, a protocol ping alone, and level 1 on the quiet book.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep a few trimmed frames. Recorded in docs/profiles/zoomex/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const LINEAR = 'wss://stream.zoomex.com/v5/public/linear';
const INVERSE = 'wss://stream.zoomex.com/v5/public/inverse';
const V3 = 'wss://stream.zoomex.com/v3/public';
const BYBIT_LINEAR = 'wss://stream.bybit.com/v5/public/linear';
const API = 'https://openapi.zoomex.com/cloud/trade/v3/market';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const kept = new Map();

// Keeps the first few frames of each kind, trimmed to three levels per side.
function capture(kind, text, limit = 2) {
  if (!OUT) return;
  const n = kept.get(kind) ?? 0;
  if (n >= limit) return;
  kept.set(kind, n + 1);
  mkdirSync(OUT, { recursive: true });
  let line = text;
  try {
    const j = JSON.parse(text);
    if (j.data && Array.isArray(j.data.b)) j.data.b = j.data.b.slice(0, 3);
    if (j.data && Array.isArray(j.data.a)) j.data.a = j.data.a.slice(0, 3);
    line = JSON.stringify(j);
  } catch {}
  appendFileSync(join(OUT, 'frames.txt'), `${kind} ${Date.now()} ${line}\n`);
}

function open(url, { deflate = false } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  let res;
  ws.once('upgrade', (r) => (res = r));
  return new Promise((resolve) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0), res }));
    ws.once('unexpected-response', (_req, res) => resolve({ ws, error: `http ${res.statusCode}`, res }));
    ws.once('error', (e) => resolve({ ws, error: String(e.message ?? e) }));
  });
}

const send = (ws, obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));

async function restBook(symbol, limit = 50) {
  const r = await fetch(`${API}/orderbook?category=linear&symbol=${symbol}&limit=${limit}`);
  return (await r.json()).result;
}

async function restLinearSymbols() {
  const r = await fetch(`${API}/tickers?category=linear`);
  const list = (await r.json()).result.list;
  return list.sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h)).map((x) => x.symbol);
}

// One local book per topic, kept by the documented rule: a snapshot replaces the book, a delta applies when u is the last u plus one.
function makeTracker() {
  const topics = new Map();
  return {
    topics,
    onBook(topic, type, data, recvMs) {
      let t = topics.get(topic);
      if (!t) {
        t = { snapshots: 0, deltas: 0, gaps: 0, uOne: 0, emptyDeltas: 0, deltaBidsUnordered: 0, deltaAsksUnordered: 0, snapBidsDesc: 0, snapAsksAsc: 0, maxBids: 0, maxAsks: 0, repeats: 0, seqBackwards: 0, firstMs: recvMs, lastMs: recvMs, maxGapMs: 0, bids: new Map(), asks: new Map(), last: undefined, lastSeq: undefined, lastBody: '', snapshotAfterFirst: 0, snapLevels: [], interArrival: [] };
        topics.set(topic, t);
      }
      t.maxGapMs = Math.max(t.maxGapMs, recvMs - t.lastMs);
      if (t.snapshots + t.deltas > 0) t.interArrival.push(recvMs - t.lastMs);
      t.lastMs = recvMs;
      const b = data.b ?? [];
      const a = data.a ?? [];
      if (data.u === 1) t.uOne++;
      if (t.lastSeq !== undefined && data.seq < t.lastSeq) t.seqBackwards++;
      t.lastSeq = data.seq;
      const body = JSON.stringify([b, a]);
      if (type === 'snapshot') {
        if (t.snapshots > 0) t.snapshotAfterFirst++;
        t.snapshots++;
        t.snapLevels.push(`${b.length}/${a.length}`);
        if (b.every((x, i) => i === 0 || Number(b[i - 1][0]) > Number(x[0]))) t.snapBidsDesc++;
        if (a.every((x, i) => i === 0 || Number(a[i - 1][0]) < Number(x[0]))) t.snapAsksAsc++;
        t.bids = new Map(b.map(([p, s]) => [p, s]));
        t.asks = new Map(a.map(([p, s]) => [p, s]));
        t.last = data.u;
      } else {
        t.deltas++;
        if (t.last === undefined || data.u !== t.last + 1) t.gaps++;
        t.last = data.u;
        if (b.length === 0 && a.length === 0) t.emptyDeltas++;
        if (!b.every((x, i) => i === 0 || Number(b[i - 1][0]) > Number(x[0]))) t.deltaBidsUnordered++;
        if (!a.every((x, i) => i === 0 || Number(a[i - 1][0]) < Number(x[0]))) t.deltaAsksUnordered++;
        if (body === t.lastBody && body !== '[[],[]]') t.repeats++;
        for (const [p, s] of b) Number(s) === 0 ? t.bids.delete(p) : t.bids.set(p, s);
        for (const [p, s] of a) Number(s) === 0 ? t.asks.delete(p) : t.asks.set(p, s);
      }
      t.lastBody = body;
      t.maxBids = Math.max(t.maxBids, t.bids.size);
      t.maxAsks = Math.max(t.maxAsks, t.asks.size);
    },
    summary(topic) {
      const t = topics.get(topic);
      if (!t) return { topic, frames: 0 };
      const { bids, asks, lastBody, snapLevels, interArrival, ...rest } = t;
      const ia = [...interArrival].sort((x, y) => x - y);
      const q = (p) => ia[Math.min(ia.length - 1, Math.floor(ia.length * p))];
      const interArrivalMs = ia.length ? { p10: q(0.1), median: q(0.5), p90: q(0.9), max: ia[ia.length - 1] } : null;
      return { topic, ...rest, snapLevels: snapLevels.slice(0, 4), heldBids: bids.size, heldAsks: asks.size, spanMs: t.lastMs - t.firstMs, interArrivalMs };
    },
    top(topic, n) {
      const t = topics.get(topic);
      const b = [...t.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
      const a = [...t.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
      return { b, a, u: t.last };
    },
  };
}

function wire(ws, name, tracker, extra = {}) {
  const acks = [];
  const other = [];
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  ws.on('message', (raw) => {
    const recv = Date.now();
    frames++;
    bytes += raw.length;
    const text = raw.toString('utf8');
    const t0 = performance.now();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      other.push(text.slice(0, 200));
      return;
    }
    parseUs += (performance.now() - t0) * 1000;
    if (j.topic?.startsWith('orderbook.')) {
      capture(`${name}:${j.type}:${j.topic.split('.')[1]}`, text);
      tracker?.onBook(j.topic, j.type, j.data, recv);
      extra.onBook?.(j, recv, text);
    } else if (j.topic) {
      capture(`${name}:${j.topic.split('.')[0]}:${j.type}`, text);
      extra.onOther?.(j, recv);
    } else {
      capture(`${name}:control`, text, 12);
      acks.push({ at: recv, ...j });
    }
  });
  return { acks, other, stats: () => ({ frames, bytes, parseUsPerFrame: frames ? +(parseUs / frames).toFixed(1) : 0 }) };
}

async function book() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'CHRUSDT', 'AAPLUSDT'];
  const tracker = makeTracker();
  const o = await open(LINEAR);
  log('open', { url: LINEAR, ms: o.openMs, error: o.error, extensions: o.res?.headers?.['sec-websocket-extensions'] ?? null });
  const tickers = [];
  const w = wire(o.ws, 'linear', tracker, { onOther: (j, recv) => tickers.push({ recv, type: j.type, keys: Object.keys(j.data ?? {}), cs: j.cs, ts: j.ts }) });
  const subAt = Date.now();
  send(o.ws, { req_id: 'book50', op: 'subscribe', args: symbols.map((s) => `orderbook.50.${s}`) });
  // A request fails whole when one topic in it is refused, so each depth goes in its own request.
  for (const topic of ['orderbook.1.BTCUSDT', 'orderbook.1.CHRUSDT', 'orderbook.200.ETHUSDT', 'orderbook.500.BTCUSDT', 'orderbook.1000.BTCUSDT']) send(o.ws, { req_id: topic, op: 'subscribe', args: [topic] });
  send(o.ws, { req_id: 'ticker', op: 'subscribe', args: ['tickers.BTCUSDT', 'tickers.CHRUSDT'] });
  const pingAt = [];
  const ping = setInterval(() => {
    pingAt.push(Date.now());
    send(o.ws, { req_id: `p${pingAt.length}`, op: 'ping' });
  }, 20000);

  const inv = await open(INVERSE);
  const invTracker = makeTracker();
  const wi = wire(inv.ws, 'inverse', invTracker);
  send(inv.ws, { req_id: 'inv', op: 'subscribe', args: ['orderbook.50.BTCUSD', 'orderbook.50.ETHUSD'] });
  send(inv.ws, { req_id: 'linear_on_inverse', op: 'subscribe', args: ['orderbook.50.BTCUSDT'] });

  const v3 = await open(V3);
  log('open_v3', { url: V3, ms: v3.openMs, error: v3.error });
  let wv3;
  if (!v3.error) {
    wv3 = wire(v3.ws, 'v3', makeTracker());
    send(v3.ws, { req_id: 'v3', op: 'subscribe', args: ['orderbook.50.BTCUSDT'] });
  }
  v3.ws.on('close', (code) => log('v3_close', { code }));

  await sleep(10000);
  log('inverse', { open: inv.openMs, acks: wi.acks.map((a) => ({ success: a.success, ret_msg: a.ret_msg, req_id: a.req_id })), ...wi.stats(), btcusd: invTracker.summary('orderbook.50.BTCUSD'), ethusd: invTracker.summary('orderbook.50.ETHUSD'), linearOnInverse: invTracker.summary('orderbook.50.BTCUSDT') });
  inv.ws.terminate();
  if (wv3) log('v3', { acks: wv3.acks, ...wv3.stats(), other: wv3.other.slice(0, 3) });
  v3.ws.terminate();

  await sleep(38000);
  const rest = await restBook('BTCUSDT', 50);
  const local = tracker.top('orderbook.50.BTCUSDT', 20);
  const restMap = new Map([...rest.b, ...rest.a].map(([p, s]) => [p, s]));
  const localLevels = [...local.b, ...local.a];
  log('size_compare', {
    symbol: 'BTCUSDT',
    wsU: local.u,
    restU: rest.u,
    restTs: rest.ts,
    samePriceAndSize: localLevels.filter(([p, s]) => restMap.get(p) === s).length,
    priceOnlyInRest: localLevels.filter(([p]) => restMap.has(p)).length,
    of: localLevels.length,
    wsTop: [local.b[0], local.a[0]],
    restTop: [rest.b[0], rest.a[0]],
  });
  await sleep(2000);
  clearInterval(ping);
  log('acks', { subAt, acks: w.acks.map((a) => ({ dtMs: a.at - subAt, success: a.success, ret_msg: a.ret_msg, req_id: a.req_id, op: a.op, conn_id: a.conn_id })) });
  log('pong_times', { rtt: w.acks.filter((a) => a.op === 'ping' || a.ret_msg === 'pong').map((a, i) => a.at - pingAt[i]) });
  for (const topic of tracker.topics.keys()) log('topic', tracker.summary(topic));
  const tb = tickers.filter((t) => true);
  log('tickers', { frames: tb.length, snapshots: tb.filter((t) => t.type === 'snapshot').length, deltas: tb.filter((t) => t.type === 'delta').length, deltaKeySets: [...new Set(tb.filter((t) => t.type === 'delta').map((t) => t.keys.sort().join(',')))].slice(0, 6) });
  log('linear_stats', { ...w.stats(), other: w.other.slice(0, 3) });
  o.ws.terminate();
}

// Zoomex and Bybit books for the same symbols at once: frames matched by update id, and both touches sampled every 100 ms to count crosses between the two.
async function mirror() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'GMTUSDT', 'CHRUSDT', 'ZILUSDT'];
  const seen = new Map();
  const counts = { zoomex: 0, bybit: 0 };
  const fieldSame = { seq: 0, ts: 0, cts: 0 };
  const firstIds = {};
  const onBook = (venue) => (j, recv) => {
    counts[venue]++;
    const d = j.data;
    firstIds[`${venue}:${d.s}`] ??= { u: d.u, seq: d.seq, ts: j.ts, cts: j.cts, type: j.type };
    const key = `${d.s}|${d.u}|${j.type}`;
    const e = seen.get(key) ?? {};
    e[venue] = { recv, seq: d.seq, ts: j.ts, cts: j.cts, body: JSON.stringify([d.b, d.a]) };
    seen.set(key, e);
  };
  const zt = makeTracker();
  const bt = makeTracker();
  const [z, b] = await Promise.all([open(LINEAR), open(BYBIT_LINEAR)]);
  log('open', { zoomexMs: z.openMs, bybitMs: b.openMs });
  wire(z.ws, 'mirror-zoomex', zt, { onBook: onBook('zoomex') });
  wire(b.ws, 'mirror-bybit', bt, { onBook: onBook('bybit') });
  const sub = { op: 'subscribe', args: symbols.map((x) => `orderbook.50.${x}`) };
  send(z.ws, sub);
  send(b.ws, sub);
  const ping = setInterval(() => {
    send(z.ws, { op: 'ping' });
    send(b.ws, { op: 'ping' });
  }, 20000);
  const touch = Object.fromEntries(symbols.map((x) => [x, { samples: 0, sameTouch: 0, crossed: 0, maxCrossPpm: 0, midDiffPpm: [] }]));
  await sleep(3000);
  const sampler = setInterval(() => {
    for (const x of symbols) {
      const topic = `orderbook.50.${x}`;
      if (!zt.topics.has(topic) || !bt.topics.has(topic)) continue;
      const zb = zt.top(topic, 1);
      const bb = bt.top(topic, 1);
      if (!zb.b[0] || !zb.a[0] || !bb.b[0] || !bb.a[0]) continue;
      const t = touch[x];
      t.samples++;
      const [zBid, zAsk, bBid, bAsk] = [zb.b[0][0], zb.a[0][0], bb.b[0][0], bb.a[0][0]].map(Number);
      if (zBid === bBid && zAsk === bAsk) t.sameTouch++;
      const cross = Math.max(zBid - bAsk, bBid - zAsk);
      if (cross > 0) {
        t.crossed++;
        t.maxCrossPpm = Math.max(t.maxCrossPpm, Math.round((cross / bAsk) * 1e6));
      }
      t.midDiffPpm.push(Math.abs((zBid + zAsk) / (bBid + bAsk) - 1) * 1e6);
    }
  }, 100);
  await sleep(37000);
  clearInterval(sampler);
  clearInterval(ping);
  z.ws.terminate();
  b.ws.terminate();
  const perSymbol = {};
  for (const x of symbols) perSymbol[x] = { zoomex: 0, bybit: 0, matched: 0, sameLevels: 0 };
  const lags = [];
  for (const [key, e] of seen) {
    const sym = key.split('|')[0];
    if (e.zoomex) perSymbol[sym].zoomex++;
    if (e.bybit) perSymbol[sym].bybit++;
    if (!e.zoomex || !e.bybit) continue;
    perSymbol[sym].matched++;
    if (e.zoomex.body === e.bybit.body) perSymbol[sym].sameLevels++;
    if (e.zoomex.seq === e.bybit.seq) fieldSame.seq++;
    if (e.zoomex.ts === e.bybit.ts) fieldSame.ts++;
    if (e.zoomex.cts === e.bybit.cts) fieldSame.cts++;
    lags.push(e.zoomex.recv - e.bybit.recv);
  }
  lags.sort((x, y) => x - y);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  log('mirror', { frames: counts, perSymbol, fieldSame, lagZoomexMinusBybitMs: lags.length ? { n: lags.length, min: lags[0], p10: q(lags, 0.1), median: q(lags, 0.5), p90: q(lags, 0.9), max: lags[lags.length - 1] } : null });
  for (const x of symbols) {
    const t = touch[x];
    const m = t.midDiffPpm.sort((a, c) => a - c);
    log('touch_compare', { symbol: x, samples: t.samples, sameTouch: t.sameTouch, crossed: t.crossed, maxCrossPpm: t.maxCrossPpm, midDiffPpm: m.length ? { median: +q(m, 0.5).toFixed(1), p90: +q(m, 0.9).toFixed(1), max: +m[m.length - 1].toFixed(1) } : null, zoomexInterArrival: zt.summary(`orderbook.50.${x}`).interArrivalMs, bybitInterArrival: bt.summary(`orderbook.50.${x}`).interArrivalMs });
  }
  log('mirror_first_ids', firstIds);
}

// The ticker topic on Zoomex and on Bybit for the four perps whose book is not relayed and two that are, beside Zoomex's REST ticker, to see whose index, mark and funding each source reports.
async function tickers() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'GMTUSDT', 'CHRUSDT', 'XRPUSDT'];
  const fields = ['indexPrice', 'markPrice', 'fundingRate', 'nextFundingTime', 'fundingCap', 'openInterest'];
  const state = { zoomex: new Map(), bybit: new Map() };
  const frames = { zoomex: 0, bybit: 0 };
  const markChanges = { zoomex: {}, bybit: {} };
  const onTicker = (venue) => (j) => {
    if (!j.topic?.startsWith('tickers.')) return;
    frames[venue]++;
    const d = j.data;
    const cur = state[venue].get(d.symbol) ?? {};
    if (d.markPrice !== undefined && d.markPrice !== cur.markPrice) markChanges[venue][d.symbol] = (markChanges[venue][d.symbol] ?? 0) + 1;
    state[venue].set(d.symbol, { ...cur, ...d });
  };
  const [z, b] = await Promise.all([open(LINEAR), open(BYBIT_LINEAR)]);
  wire(z.ws, 'tickers-zoomex', null, { onOther: onTicker('zoomex') });
  wire(b.ws, 'tickers-bybit', null, { onOther: onTicker('bybit') });
  const sub = { op: 'subscribe', args: symbols.map((x) => `tickers.${x}`) };
  send(z.ws, sub);
  send(b.ws, sub);
  await sleep(20000);
  const rest = await (await fetch(`${API}/tickers?category=linear`)).json();
  const restMap = new Map(rest.result.list.map((x) => [x.symbol, x]));
  z.ws.terminate();
  b.ws.terminate();
  for (const sym of symbols) {
    const zs = state.zoomex.get(sym) ?? {};
    const bs = state.bybit.get(sym) ?? {};
    const rs = restMap.get(sym) ?? {};
    const row = { symbol: sym, zoomexWsMarkChanges: markChanges.zoomex[sym] ?? 0, bybitWsMarkChanges: markChanges.bybit[sym] ?? 0 };
    for (const f of fields) row[f] = { zoomexWs: zs[f], zoomexRest: rs[f], bybitWs: bs[f] };
    log('ticker_compare', row);
  }
  log('ticker_frames', frames);
}

async function errors() {
  const o = await open(LINEAR);
  const et = makeTracker();
  const w = wire(o.ws, 'errors', et);
  const cases = [
    { req_id: 'unknown_symbol', op: 'subscribe', args: ['orderbook.50.NOPEUSDT'] },
    { req_id: 'depth_30', op: 'subscribe', args: ['orderbook.30.BTCUSDT'] },
    { req_id: 'unknown_topic', op: 'subscribe', args: ['nope.BTCUSDT'] },
    { req_id: 'lowercase', op: 'subscribe', args: ['orderbook.50.btcusdt'] },
    { req_id: 'inverse_symbol', op: 'subscribe', args: ['orderbook.50.BTCUSD'] },
    { req_id: 'mixed', op: 'subscribe', args: ['orderbook.50.ETHUSDT', 'orderbook.50.NOPE2USDT'] },
    { req_id: 'first', op: 'subscribe', args: ['orderbook.50.CHRUSDT'] },
    { req_id: 'duplicate', op: 'subscribe', args: ['orderbook.50.CHRUSDT'] },
    { req_id: 'unknown_op', op: 'nope', args: [] },
    'not json',
    { req_id: 'unsub', op: 'unsubscribe', args: ['orderbook.50.CHRUSDT'] },
    { req_id: 'ping', op: 'ping' },
  ];
  for (const c of cases) {
    send(o.ws, c);
    await sleep(700);
  }
  await sleep(3000);
  o.ws.on('close', (code) => log('errors_close', { code }));
  log('error_acks', { acks: w.acks.map(({ at, ...rest }) => rest), other: w.other });
  log('error_streams', { topics: [...et.topics.entries()].map(([k, t]) => `${k}:${t.snapshots}s/${t.deltas}d`), stats: w.stats() });
  o.ws.terminate();

  // The documented cap is 21,000 characters of args per connection, so one socket asks for more than that in one frame.
  const symbols = await restLinearSymbols();
  const args = [...symbols.map((s) => `orderbook.1.${s}`), ...symbols.map((s) => `publicTrade.${s}`)];
  const cap = await open(LINEAR);
  const wc = wire(cap.ws, 'cap', null);
  let closed;
  cap.ws.on('close', (code, reason) => (closed = { code, reason: reason.toString() }));
  send(cap.ws, { req_id: 'cap', op: 'subscribe', args });
  await sleep(4000);
  log('args_cap', { topics: args.length, chars: args.join('').length, jsonChars: JSON.stringify(args).length, acks: wc.acks.map(({ at, ...rest }) => ({ ...rest, ret_msg: String(rest.ret_msg).slice(0, 300) })), frames: wc.stats().frames, closed });
  cap.ws.terminate();
}

// Every linear perp on one Zoomex socket, and the same topics on one Bybit socket, so each symbol can be classed as Bybit's own book relayed or a separate book.
async function batch() {
  const symbols = await restLinearSymbols();
  const tracker = makeTracker();
  const ids = new Map(); // symbol to { z: Set of u|seq, b: Set of u|seq, zFrames, bFrames, zRecv: Map, lags: [] }
  const entry = (s) => {
    let e = ids.get(s);
    if (!e) {
      e = { z: new Set(), b: new Set(), zFrames: 0, bFrames: 0, zRecv: new Map(), bRecv: new Map(), lags: [] };
      ids.set(s, e);
    }
    return e;
  };
  const [o, by] = await Promise.all([open(LINEAR), open(BYBIT_LINEAR)]);
  const w = wire(o.ws, 'batch', tracker, {
    onBook: (j, recv) => {
      const e = entry(j.data.s);
      e.zFrames++;
      const k = `${j.data.u}|${j.data.seq}`;
      e.z.add(k);
      if (e.bRecv.has(k)) e.lags.push(recv - e.bRecv.get(k));
      else if (e.zRecv.size < 400) e.zRecv.set(k, recv);
    },
  });
  wire(by.ws, 'batch-bybit', null, {
    onBook: (j, recv) => {
      const e = entry(j.data.s);
      e.bFrames++;
      const k = `${j.data.u}|${j.data.seq}`;
      e.b.add(k);
      if (e.zRecv.has(k)) e.lags.push(e.zRecv.get(k) - recv);
      else if (e.bRecv.size < 4000) e.bRecv.set(k, recv);
    },
  });
  const args = symbols.map((s) => `orderbook.50.${s}`);
  const subAt = Date.now();
  for (let i = 0; i < args.length; i += 200) {
    send(o.ws, { req_id: `b${i}`, op: 'subscribe', args: args.slice(i, i + 200) });
    send(by.ws, { req_id: `b${i}`, op: 'subscribe', args: args.slice(i, i + 200) });
  }
  let closed;
  o.ws.on('close', (code) => (closed = { code, atMs: Date.now() - subAt }));
  const perSecond = [];
  let lastFrames = 0;
  const tick = setInterval(() => {
    const f = w.stats().frames;
    perSecond.push(f - lastFrames);
    lastFrames = f;
  }, 1000);
  const ping = setInterval(() => {
    send(o.ws, { op: 'ping' });
    send(by.ws, { op: 'ping' });
  }, 20000);
  const seconds = 40;
  await sleep(seconds * 1000);
  clearInterval(tick);
  clearInterval(ping);
  o.ws.terminate();
  by.ws.terminate();
  const sums = [...tracker.topics.values()];
  const snapTimes = sums.map((t) => t.firstMs - subAt).sort((a, b) => a - b);
  const s = [...perSecond].sort((a, b) => a - b);
  const stats = w.stats();
  log('batch', {
    symbols: args.length,
    argsChars: args.join('').length,
    acks: w.acks.filter((a) => a.op === 'subscribe').map((a) => `${a.req_id}:${a.success}:${a.ret_msg}`),
    topicsWithFrames: sums.length,
    topicsWithSnapshot: sums.filter((t) => t.snapshots > 0).length,
    allSnapshotsWithinMs: snapTimes[snapTimes.length - 1],
    deltas: sums.reduce((n, t) => n + t.deltas, 0),
    gaps: sums.reduce((n, t) => n + t.gaps, 0),
    extraSnapshots: sums.reduce((n, t) => n + t.snapshotAfterFirst, 0),
    uOne: sums.reduce((n, t) => n + t.uOne, 0),
    emptyDeltas: sums.reduce((n, t) => n + t.emptyDeltas, 0),
    snapshotsOrdered: sums.filter((t) => t.snapBidsDesc === t.snapshots && t.snapAsksAsc === t.snapshots).length,
    deltasUnordered: sums.reduce((n, t) => n + t.deltaBidsUnordered + t.deltaAsksUnordered, 0),
    seqBackwards: sums.reduce((n, t) => n + t.seqBackwards, 0),
    framesPerSecond: { median: s[s.length >> 1], max: s[s.length - 1], min: s[0] },
    bytesPerSecond: Math.round(stats.bytes / seconds),
    bytesPerFrame: Math.round(stats.bytes / stats.frames),
    parseUsPerFrame: stats.parseUsPerFrame,
    maxQuietGapMs: Math.max(...sums.map((t) => t.maxGapMs)),
    topicsQuietOver10s: sums.filter((t) => t.maxGapMs > 10000).length,
    heldLevelsMax: Math.max(...sums.map((t) => Math.max(t.maxBids, t.maxAsks))),
    closed,
  });
  const relayed = [];
  const separate = [];
  const unclear = [];
  const lags = [];
  for (const [sym, e] of ids) {
    let shared = 0;
    for (const k of e.z) if (e.b.has(k)) shared++;
    if (shared > 0 && shared === e.z.size) relayed.push(sym);
    else if (shared === 0 && e.z.size > 0 && e.b.size > 0) separate.push({ sym, zFrames: e.zFrames, bFrames: e.bFrames });
    else unclear.push({ sym, shared, z: e.z.size, b: e.b.size });
    lags.push(...e.lags);
  }
  lags.sort((x, y) => x - y);
  const q = (p) => lags[Math.min(lags.length - 1, Math.floor(lags.length * p))];
  const zfps = (list) => {
    const v = list.map((x) => x.zFrames / seconds).sort((a, b) => a - b);
    return v.length ? { median: +v[v.length >> 1].toFixed(2), max: +v[v.length - 1].toFixed(2) } : null;
  };
  const bfps = (list) => {
    const v = list.map((x) => x.bFrames / seconds).sort((a, b) => a - b);
    return v.length ? { median: +v[v.length >> 1].toFixed(2), max: +v[v.length - 1].toFixed(2) } : null;
  };
  log('relay_classes', {
    relayedBybitBook: relayed.length,
    separateBook: separate.length,
    unclear: unclear.length,
    separateSymbols: separate.map((x) => x.sym),
    separateZoomexFramesPerSecond: zfps(separate),
    separateBybitFramesPerSecond: bfps(separate),
    unclearSample: unclear.slice(0, 10),
    relayLagZoomexMinusBybitMs: lags.length ? { n: lags.length, min: lags[0], p10: q(0.1), median: q(0.5), p90: q(0.9), p99: q(0.99), max: lags[lags.length - 1] } : null,
  });
}

async function silence() {
  const variants = [
    { name: 'nothing', sub: false, appPing: false, protoPing: false },
    { name: 'sub_no_ping', sub: true, appPing: false, protoPing: false },
    { name: 'sub_app_ping_20s', sub: true, appPing: true, protoPing: false },
    { name: 'no_sub_app_ping_5s', sub: false, appPing: false, fastPing: true },
  ];
  // The quietest perp by 24 h turnover, so a subscribed socket can go long without a book frame.
  const quiet = (await restLinearSymbols()).at(-1);
  log('silence_symbol', { quiet });
  const runs = [];
  for (const v of variants) {
    const o = await open(LINEAR);
    const t0 = Date.now();
    const r = { name: v.name, frames: 0, serverPings: 0, closedAtMs: null, code: null, maxQuietMs: 0 };
    let last = t0;
    o.ws.on('message', () => {
      r.frames++;
      r.maxQuietMs = Math.max(r.maxQuietMs, Date.now() - last);
      last = Date.now();
    });
    o.ws.on('ping', () => r.serverPings++);
    o.ws.on('close', (code) => {
      r.closedAtMs = Date.now() - t0;
      r.code = code;
    });
    if (v.sub) send(o.ws, { op: 'subscribe', args: [`orderbook.50.${quiet}`] });
    const timers = [];
    if (v.appPing) timers.push(setInterval(() => o.ws.readyState === 1 && send(o.ws, { op: 'ping' }), 20000));
    if (v.fastPing) timers.push(setInterval(() => o.ws.readyState === 1 && send(o.ws, { op: 'ping' }), 5000));
    runs.push({ r, o, timers });
  }
  for (let i = 0; i < 110 && runs.some((x) => x.r.closedAtMs === null); i++) await sleep(1000);
  for (const { r, o, timers } of runs) {
    timers.forEach(clearInterval);
    log('silence', r);
    o.ws.terminate();
  }
}

// Three sockets that separate the two readings of the silence result: a quiet book with a 5 s ping, a protocol ping with no subscription, and level 1 on the same quiet book, which repeats a snapshot every 3 s.
async function idle() {
  const quiet = (await restLinearSymbols()).at(-1);
  log('idle_symbol', { quiet });
  const variants = [
    { name: 'sub50_app_ping_5s', topic: `orderbook.50.${quiet}`, appPing: true },
    { name: 'no_sub_protocol_ping_5s', protoPing: true },
    { name: 'sub1_no_ping', topic: `orderbook.1.${quiet}` },
  ];
  const runs = [];
  for (const v of variants) {
    const o = await open(LINEAR);
    const t0 = Date.now();
    const r = { name: v.name, frames: 0, pongs: 0, closedAtMs: null, code: null, maxQuietMs: 0 };
    let last = t0;
    o.ws.on('message', () => {
      r.frames++;
      r.maxQuietMs = Math.max(r.maxQuietMs, Date.now() - last);
      last = Date.now();
    });
    o.ws.on('pong', () => r.pongs++);
    o.ws.on('close', (code) => {
      r.closedAtMs = Date.now() - t0;
      r.code = code;
    });
    if (v.topic) send(o.ws, { op: 'subscribe', args: [v.topic] });
    const timers = [];
    if (v.appPing) timers.push(setInterval(() => o.ws.readyState === 1 && send(o.ws, { op: 'ping' }), 5000));
    if (v.protoPing) timers.push(setInterval(() => o.ws.readyState === 1 && o.ws.ping(), 5000));
    runs.push({ r, o, timers });
  }
  for (let i = 0; i < 40 && runs.some((x) => x.r.closedAtMs === null); i++) await sleep(1000);
  for (const { r, o, timers } of runs) {
    timers.forEach(clearInterval);
    log('idle', r);
    o.ws.terminate();
  }
}

async function deflate() {
  const o = await open(LINEAR, { deflate: true });
  log('deflate', { offered: true, negotiated: o.res?.headers?.['sec-websocket-extensions'] ?? null, wsExtensions: o.ws.extensions });
  o.ws.terminate();
  const p = await open(LINEAR);
  log('no_deflate', { negotiated: p.res?.headers?.['sec-websocket-extensions'] ?? null, openMs: p.openMs });
  p.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, mirror, tickers, errors, batch, silence, idle, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
