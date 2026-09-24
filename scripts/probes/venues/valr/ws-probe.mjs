// VALR trade WebSocket probe: book channels, sequence and checksum, level order, size unit, mark and summary cadence, keepalive, silence, errors and subscribe semantics.
// Public, unauthenticated, read-only. No API key is sent, and sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/valr/ws-probe.mjs [book|subs|silence|deflate]
//   book     OB_L1_DIFF, MARK_PRICE_UPDATE and MARKET_SUMMARY_UPDATE on the four active perpetuals, AGGREGATED_ORDERBOOK_UPDATE and OB_L1_D20_SNAPSHOT on one each, for 75 s, with one REST book compare. About 80 s.
//   subs     subscribe semantics on one socket: a second subscribe of the same event, unknown, inactive, spot and lowercase pairs, unknown event, text that is not JSON, unsubscribe. About 45 s.
//   silence  three sockets that differ only in what the client sends, for up to 110 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/valr/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api.valr.com/ws/trade';
const API = 'https://api.valr.com';
const PERPS = ['BTCUSDTPERP', 'ETHUSDTPERP', 'XRPUSDTPERP', 'SOLUSDTPERP'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();
const rel = () => Date.now() - t0;
const captured = new Map();

function capture(kind, text, cap = 6) {
  if (!OUT) return;
  const n = captured.get(kind) ?? 0;
  if (n >= cap) return;
  captured.set(kind, n + 1);
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, `${kind}.jsonl`), text.slice(0, 4000) + '\n');
}

function open(label, deflate = false) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
    let headers = {};
    ws.on('upgrade', (res) => {
      headers = res.headers;
    });
    ws.once('open', () => {
      log('open', { label, ms: Date.now() - started, ext: headers['sec-websocket-extensions'] ?? null, server: headers.server ?? null, via: headers.via ?? null });
      resolve(ws);
    });
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        log('refused', { label, status: res.statusCode, body: body.slice(0, 300) });
        reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    ws.once('error', (e) => reject(e));
  });
}

const send = (ws, obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
const subscribe = (ws, subs) => send(ws, { type: 'SUBSCRIBE', subscriptions: subs });

// Level book keyed by the price string as the wire spells it, so the checksum can be rebuilt from wire strings.
class Book {
  constructor() {
    this.bids = new Map();
    this.asks = new Map();
  }
  reset(b, a) {
    this.bids = new Map(b.map(([p, q]) => [p, q]));
    this.asks = new Map(a.map(([p, q]) => [p, q]));
  }
  apply(side, levels) {
    const m = side === 'b' ? this.bids : this.asks;
    for (const [p, q] of levels) {
      if (Number(q) === 0) m.delete(p);
      else m.set(p, q);
    }
  }
  sorted(side) {
    const m = side === 'b' ? this.bids : this.asks;
    const arr = [...m.entries()];
    arr.sort((x, y) => (side === 'b' ? Number(y[0]) - Number(x[0]) : Number(x[0]) - Number(y[0])));
    return arr;
  }
  checksum() {
    const b = this.sorted('b');
    const a = this.sorted('a');
    const parts = [];
    for (let i = 0; i < 25; i++) {
      if (b[i]) parts.push(`${b[i][0]}:${b[i][1]}`);
      if (a[i]) parts.push(`${a[i][0]}:${a[i][1]}`);
    }
    return crc32(parts.join(':')) >>> 0;
  }
}

const isDesc = (lv) => lv.every((x, i) => i === 0 || Number(lv[i - 1][0]) > Number(x[0]));
const isAsc = (lv) => lv.every((x, i) => i === 0 || Number(lv[i - 1][0]) < Number(x[0]));

function stats(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}

async function book() {
  const ws = await open('book');
  const perPair = new Map(PERPS.map((p) => [p, { snaps: 0, diffs: 0, gaps: 0, csOk: 0, csBad: 0, empty: 0, oneSided: 0, unorderedBid: 0, unorderedAsk: 0, maxBids: 0, maxAsks: 0, snapLevels: null, snapOrder: null, firstSnapMs: null, lastLc: null, maxGapMs: 0, lastArrive: null, lcLagMax: 0, seqStep: new Map(), book: new Book(), sq: null }]));
  const counts = {};
  const marks = new Map(PERPS.map((p) => [p, { arrivals: [], prices: [] }]));
  const summaries = new Map(PERPS.map((p) => [p, { arrivals: [], marks: [] }]));
  const agg = { n: 0, levels: [], seqs: [], arrivals: [] };
  const d20 = { n: 0, levels: [], arrivals: [] };
  let parseUs = 0;
  let parsed = 0;
  let bytes = 0;
  let pingSent = 0;
  const pongs = [];
  const other = [];
  const subAt = Date.now();

  ws.on('ping', () => log('server_ping', { t: rel() }));
  ws.on('close', (code, reason) => log('close', { label: 'book', t: rel(), code, reason: reason.toString() }));
  ws.on('message', (raw) => {
    const text = raw.toString();
    bytes += text.length;
    const ps = process.hrtime.bigint();
    const m = JSON.parse(text);
    parseUs += Number(process.hrtime.bigint() - ps) / 1000;
    parsed++;
    const now = Date.now();
    counts[m.type] = (counts[m.type] ?? 0) + 1;
    capture(m.type ?? 'untyped', text, m.type === 'OB_L1_DIFF' ? 10 : 4);

    if (m.type === 'OB_L1_SNAPSHOT' || m.type === 'OB_L1_DIFF') {
      const st = perPair.get(m.ps);
      if (!st) return other.push(text.slice(0, 200));
      const d = m.d;
      if (st.lastArrive !== null) st.maxGapMs = Math.max(st.maxGapMs, now - st.lastArrive);
      st.lastArrive = now;
      if (typeof d.lc === 'number') st.lcLagMax = Math.max(st.lcLagMax, now - d.lc);
      if (m.type === 'OB_L1_SNAPSHOT') {
        st.snaps++;
        if (st.firstSnapMs === null) st.firstSnapMs = now - subAt;
        st.snapLevels = [d.b?.length ?? 0, d.a?.length ?? 0];
        st.snapOrder = [isDesc(d.b ?? []), isAsc(d.a ?? [])];
        st.book.reset(d.b ?? [], d.a ?? []);
        st.sq = d.sq;
        if (typeof d.cs === 'number') (st.book.checksum() === d.cs ? st.csOk++ : st.csBad++);
      } else {
        st.diffs++;
        if (st.sq === null) st.gaps++;
        else {
          const step = d.sq - st.sq;
          st.seqStep.set(step, (st.seqStep.get(step) ?? 0) + 1);
          if (step !== 1) st.gaps++;
        }
        st.sq = d.sq;
        const b = d.b ?? [];
        const a = d.a ?? [];
        if (b.length === 0 && a.length === 0) st.empty++;
        if (b.length > 1 && !isDesc(b)) st.unorderedBid++;
        if (a.length > 1 && !isAsc(a)) st.unorderedAsk++;
        st.book.apply('b', b);
        st.book.apply('a', a);
        if (typeof d.cs === 'number') {
          if (st.book.checksum() === d.cs) st.csOk++;
          else {
            st.csBad++;
            if (st.csBad <= 2) log('checksum_miss', { pair: m.ps, sq: d.sq, got: d.cs, local: st.book.checksum() });
          }
        }
      }
      st.maxBids = Math.max(st.maxBids, st.book.bids.size);
      st.maxAsks = Math.max(st.maxAsks, st.book.asks.size);
      if (st.book.bids.size === 0 || st.book.asks.size === 0) st.oneSided++;
      return;
    }
    if (m.type === 'MARK_PRICE_UPDATE') {
      const s = marks.get(m.currencyPairSymbol);
      if (s) {
        s.arrivals.push(now);
        s.prices.push(m.data?.price);
      }
      return;
    }
    if (m.type === 'MARKET_SUMMARY_UPDATE') {
      const s = summaries.get(m.currencyPairSymbol);
      if (s) {
        s.arrivals.push(now);
        s.marks.push(m.data?.markPrice);
      }
      return;
    }
    if (m.type === 'AGGREGATED_ORDERBOOK_UPDATE') {
      agg.n++;
      agg.arrivals.push(now);
      agg.levels.push([m.data?.Bids?.length ?? 0, m.data?.Asks?.length ?? 0]);
      agg.seqs.push(m.data?.SequenceNumber);
      return;
    }
    if (m.type === 'OB_L1_D20_SNAPSHOT') {
      d20.n++;
      d20.arrivals.push(now);
      d20.levels.push([m.d?.b?.length ?? 0, m.d?.a?.length ?? 0]);
      return;
    }
    if (m.type === 'PONG') {
      pongs.push({ rtt: now - pingSent, text: text.slice(0, 200) });
      return;
    }
    other.push(text.slice(0, 300));
  });

  subscribe(ws, [
    { event: 'OB_L1_DIFF', pairs: PERPS },
    { event: 'MARK_PRICE_UPDATE', pairs: PERPS },
    { event: 'MARKET_SUMMARY_UPDATE', pairs: PERPS },
    { event: 'AGGREGATED_ORDERBOOK_UPDATE', pairs: ['BTCUSDTPERP'] },
    { event: 'OB_L1_D20_SNAPSHOT', pairs: ['ETHUSDTPERP'] },
  ]);
  const ping = setInterval(() => {
    pingSent = Date.now();
    send(ws, { type: 'PING' });
  }, 20_000);

  await sleep(60_000);
  const st = perPair.get('BTCUSDTPERP');
  const wsBids = st.book.sorted('b').slice(0, 10);
  const wsAsks = st.book.sorted('a').slice(0, 10);
  const res = await fetch(`${API}/v1/public/BTCUSDTPERP/orderbook`);
  const rest = await res.json();
  const restBids = rest.Bids.slice(0, 10).map((l) => [l.price, l.quantity]);
  const restAsks = rest.Asks.slice(0, 10).map((l) => [l.price, l.quantity]);
  const same = (x, y) => x.filter(([p, q]) => y.some(([p2, q2]) => Number(p2) === Number(p) && Number(q2) === Number(q))).length;
  log('rest_compare', { pair: 'BTCUSDTPERP', cache: res.headers.get('cache-control'), age: res.headers.get('age'), restLastChange: rest.LastChange, restSeq: rest.SequenceNumber, wsSq: st.sq, wsTop: [wsBids[0], wsAsks[0]], restTop: [restBids[0], restAsks[0]], bidsMatch: same(wsBids, restBids), asksMatch: same(wsAsks, restAsks), of: 10 });

  await sleep(15_000);
  clearInterval(ping);
  const elapsed = (Date.now() - subAt) / 1000;
  for (const [p, s] of perPair) {
    log('ob_l1_diff', { pair: p, snaps: s.snaps, firstSnapMs: s.firstSnapMs, snapLevels: s.snapLevels, snapOrder: s.snapOrder, diffs: s.diffs, gaps: s.gaps, seqStep: Object.fromEntries(s.seqStep), csOk: s.csOk, csBad: s.csBad, empty: s.empty, oneSided: s.oneSided, unorderedBid: s.unorderedBid, unorderedAsk: s.unorderedAsk, maxBids: s.maxBids, maxAsks: s.maxAsks, maxGapMs: s.maxGapMs, lcLagMaxMs: s.lcLagMax });
  }
  for (const [p, s] of marks) {
    const gaps = s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]);
    const repeats = s.prices.slice(1).filter((x, i) => x === s.prices[i]).length;
    log('mark', { pair: p, frames: s.prices.length, intervalMs: stats(gaps), distinct: new Set(s.prices).size, repeats, first: s.prices[0] });
  }
  for (const [p, s] of summaries) {
    const gaps = s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]);
    log('summary', { pair: p, frames: s.arrivals.length, intervalMs: stats(gaps), distinctMarks: new Set(s.marks).size });
  }
  const aggGaps = agg.arrivals.slice(1).map((t, i) => t - agg.arrivals[i]);
  const aggSeqMonotonic = agg.seqs.every((x, i) => i === 0 || x > agg.seqs[i - 1]);
  log('aggregated', { pair: 'BTCUSDTPERP', frames: agg.n, levels: [...new Set(agg.levels.map((l) => l.join('/')))].slice(0, 6), seqMonotonic: aggSeqMonotonic, intervalMs: stats(aggGaps) });
  const d20Gaps = d20.arrivals.slice(1).map((t, i) => t - d20.arrivals[i]);
  log('d20', { pair: 'ETHUSDTPERP', frames: d20.n, levels: [...new Set(d20.levels.map((l) => l.join('/')))].slice(0, 6), intervalMs: stats(d20Gaps) });
  log('totals', { seconds: elapsed, counts, framesPerSec: +(parsed / elapsed).toFixed(1), bytesPerSec: Math.round(bytes / elapsed), bytesPerFrame: Math.round(bytes / parsed), parseUsPerFrame: +(parseUs / parsed).toFixed(1), pongs, other: other.slice(0, 5) });
  ws.close();
}

async function subs() {
  const ws = await open('subs');
  let phase = 'start';
  const perPhase = {};
  ws.on('close', (code, reason) => log('close', { label: 'subs', t: rel(), code, reason: reason.toString() }));
  ws.on('message', (raw) => {
    const text = raw.toString();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return log('non_json', { phase, text: text.slice(0, 200) });
    }
    const key = `${m.type}:${m.ps ?? m.currencyPairSymbol ?? ''}`;
    perPhase[phase] ??= {};
    perPhase[phase][key] = (perPhase[phase][key] ?? 0) + 1;
    if (m.type === 'OB_L1_SNAPSHOT' || m.type === 'OB_L1_DIFF') return;
    log('frame', { phase, t: rel(), text: text.slice(0, 400) });
  });
  const step = async (name, action, wait) => {
    phase = name;
    action();
    await sleep(wait);
    log('phase', { phase: name, frames: perPhase[name] ?? {} });
  };
  await step('ping_unsubscribed', () => send(ws, { type: 'PING' }), 2_000);
  await step('sub_btc', () => subscribe(ws, [{ event: 'OB_L1_DIFF', pairs: ['BTCUSDTPERP'] }]), 6_000);
  await step('sub_eth_same_event', () => subscribe(ws, [{ event: 'OB_L1_DIFF', pairs: ['ETHUSDTPERP'] }]), 6_000);
  await step('sub_unknown_pair', () => subscribe(ws, [{ event: 'OB_L1_DIFF', pairs: ['BTCUSDTPERP', 'NOPEUSDTPERP'] }]), 5_000);
  await step('sub_inactive_perp', () => subscribe(ws, [{ event: 'MARK_PRICE_UPDATE', pairs: ['DOGEUSDTPERP'] }, { event: 'OB_L1_DIFF', pairs: ['DOGEUSDTPERP'] }]), 5_000);
  await step('sub_spot_and_lowercase', () => subscribe(ws, [{ event: 'OB_L1_DIFF', pairs: ['BTCUSDT', 'ethusdtperp'] }]), 5_000);
  await step('unknown_event', () => subscribe(ws, [{ event: 'NOPE_EVENT', pairs: ['BTCUSDTPERP'] }]), 3_000);
  await step('not_json', () => send(ws, 'hello'), 3_000);
  await step('unsubscribe', () => subscribe(ws, [{ event: 'OB_L1_DIFF', pairs: [] }]), 6_000);
  await step('ping_after', () => send(ws, { type: 'PING' }), 2_000);
  ws.close();
}

async function silence() {
  const specs = [
    { label: 'nothing', setup: () => {} },
    { label: 'mark_sub_no_ping', setup: (ws) => subscribe(ws, [{ event: 'MARK_PRICE_UPDATE', pairs: ['BTCUSDTPERP'] }]) },
    { label: 'ping_25s_no_sub', setup: (ws, timers) => timers.push(setInterval(() => send(ws, { type: 'PING' }), 25_000)) },
  ];
  const done = specs.map(async (spec) => {
    const ws = await open(spec.label);
    const opened = Date.now();
    const timers = [];
    let frames = 0;
    let serverPings = 0;
    ws.on('ping', () => serverPings++);
    ws.on('message', (raw) => {
      frames++;
      if (frames <= 2) log('frame', { label: spec.label, t: Date.now() - opened, text: raw.toString().slice(0, 200) });
    });
    spec.setup(ws, timers);
    const closed = new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: reason.toString(), afterMs: Date.now() - opened })));
    const result = await Promise.race([closed, sleep(110_000).then(() => null)]);
    timers.forEach(clearInterval);
    log('silence', { label: spec.label, closed: result, stillOpenAt110s: result === null, frames, serverPings });
    if (result === null) ws.close();
  });
  await Promise.all(done);
}

async function deflate() {
  const ws = await open('deflate', true);
  await sleep(1_000);
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, subs, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString(), seconds: rel() / 1000 });
process.exit(0);
