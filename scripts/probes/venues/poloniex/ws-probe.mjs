// Poloniex futures v3 WebSocket probe: the book_lv2 chain on every perpetual, level order and window, size unit against the REST book, the other public channels, errors, keepalive, silence and deflate.
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/poloniex/ws-probe.mjs [book|channels|errors|silence|deflate]
//   book      book_lv2 on all 18 perpetuals on one socket for 60 s, ping every 20 s, two REST book compares. About 62 s.
//   channels  book at depth 20, tickers, index_price, mark_price and funding_rate for 35 s. About 37 s.
//   errors    unknown symbol and channel, double subscribe, text that is not JSON, plain ping, list_subscriptions, symbols all. About 12 s.
//   silence   three sockets: nothing sent, a subscription without ping, a subscription with ping every 20 s, for up to 100 s.
//   deflate   offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/poloniex/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUBLIC = 'wss://ws.poloniex.com/ws/v3/public';
const API = 'https://api.poloniex.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(url = URL_PUBLIC, deflate = false) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

async function symbols() {
  const r = await fetch(`${API}/v3/market/allInstruments`);
  const j = await r.json();
  return j.data.filter((d) => d.status === 'OPEN').map((d) => d.symbol);
}

async function restBook(symbol) {
  const r = await fetch(`${API}/v3/market/orderBook?symbol=${symbol}&limit=20`);
  return (await r.json()).data;
}

async function book() {
  const syms = await symbols();
  const { ws, openMs } = await open();
  log('open', { url: URL_PUBLIC, openMs, symbols: syms.length });
  const state = new Map(); // symbol to { bids, asks, last, snapshots, deltas, gaps, ... }
  for (const s of syms) state.set(s, { bids: new Map(), asks: new Map(), last: null, snapshots: 0, deltas: 0, gaps: 0, emptyDeltas: 0, firstDeltaChains: null, maxBids: 0, maxAsks: 0, wireBids: [], wireAsks: [], snapUnordered: 0, deltaUnorderedBids: 0, deltaUnorderedAsks: 0, lastAt: null, maxIdle: 0, repeatIds: 0, zeroSize: 0, oneSided: 0, lidEqualsId: 0 });
  const acks = [];
  const other = [];
  const pongs = [];
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  let firstSnapshotMs = null;
  const perSecond = new Map();
  let pingSentAt = 0;
  const subAt = performance.now();
  const captured = new Set();

  ws.on('message', (raw) => {
    const at = performance.now();
    frames++;
    bytes += raw.length;
    const sec = Math.floor((at - subAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const p0 = process.hrtime.bigint();
    const msg = JSON.parse(raw.toString());
    parseUs += Number(process.hrtime.bigint() - p0) / 1000;
    if (msg.event === 'pong') {
      pongs.push(Math.round(at - pingSentAt));
      if (!captured.has('pong')) {
        captured.add('pong');
        capture('book-frames.jsonl', raw.toString());
      }
      return;
    }
    if (msg.event) {
      acks.push({ ms: Math.round(at - subAt), msg });
      capture('book-frames.jsonl', raw.toString());
      return;
    }
    if (msg.channel !== 'book_lv2') {
      other.push(raw.toString().slice(0, 200));
      return;
    }
    for (const d of msg.data) {
      const st = state.get(d.s);
      if (!st) {
        other.push(`unknown symbol ${d.s}`);
        continue;
      }
      if (st.lastAt !== null) st.maxIdle = Math.max(st.maxIdle, at - st.lastAt);
      st.lastAt = at;
      if (d.lid === d.id) st.lidEqualsId++;
      if (msg.action === 'snapshot') {
        if (firstSnapshotMs === null) firstSnapshotMs = Math.round(at - subAt);
        st.snapshots++;
        st.bids = new Map(d.bids.map(([p, q]) => [p, q]));
        st.asks = new Map(d.asks.map(([p, q]) => [p, q]));
        st.wireBids.push(d.bids.length);
        st.wireAsks.push(d.asks.length);
        const bd = d.bids.every((l, i) => i === 0 || Number(l[0]) < Number(d.bids[i - 1][0]));
        const aa = d.asks.every((l, i) => i === 0 || Number(l[0]) > Number(d.asks[i - 1][0]));
        if (!bd || !aa) st.snapUnordered++;
        if (st.snapshots === 1) st.snapshotLid = [d.lid, d.id];
        if (st.deltas > 0 || st.snapshots > 1) other.push(`snapshot ${d.s} number=${st.snapshots} after ${st.deltas} deltas lid=${d.lid} id=${d.id} ts=${d.ts} at=${Math.round(at - subAt)}ms`);
        st.last = d.id;
        const key = `snapshot-${d.s}`;
        if (!captured.has(key) && ['BTC_USDT_PERP', 'FIL_USDT_PERP'].includes(d.s)) {
          captured.add(key);
          capture('book-frames.jsonl', JSON.stringify({ ...msg, data: [{ ...d, bids: d.bids.slice(0, 3), asks: d.asks.slice(0, 3) }] }));
        }
      } else {
        st.deltas++;
        if (st.last === null) {
          st.gaps++;
          other.push(`delta before snapshot ${d.s} lid=${d.lid} id=${d.id} ts=${d.ts} at=${Math.round(at - subAt)}ms`);
        } else if (d.lid !== st.last) {
          st.gaps++;
          if (st.gaps <= 3) other.push(`gap ${d.s} last=${st.last} lid=${d.lid} id=${d.id}`);
        }
        if (d.id === st.last) st.repeatIds++;
        if (st.firstDeltaChains === null) st.firstDeltaChains = d.lid === st.last;
        st.last = d.id;
        if (d.bids.length === 0 && d.asks.length === 0) st.emptyDeltas++;
        if (d.bids.length > 1 && !d.bids.every((l, i) => i === 0 || Number(l[0]) < Number(d.bids[i - 1][0]))) st.deltaUnorderedBids++;
        if (d.asks.length > 1 && !d.asks.every((l, i) => i === 0 || Number(l[0]) > Number(d.asks[i - 1][0]))) st.deltaUnorderedAsks++;
        for (const [p, q] of d.bids) {
          if (Number(q) === 0) {
            st.zeroSize++;
            st.bids.delete(p);
          } else st.bids.set(p, q);
        }
        for (const [p, q] of d.asks) {
          if (Number(q) === 0) {
            st.zeroSize++;
            st.asks.delete(p);
          } else st.asks.set(p, q);
        }
        if (!captured.has('delta') && d.s === 'BTC_USDT_PERP' && d.bids.length + d.asks.length > 0) {
          captured.add('delta');
          capture('book-frames.jsonl', raw.toString());
        }
        if (!captured.has('empty-delta') && d.bids.length === 0 && d.asks.length === 0) {
          captured.add('empty-delta');
          capture('book-frames.jsonl', raw.toString());
        }
      }
      st.maxBids = Math.max(st.maxBids, st.bids.size);
      st.maxAsks = Math.max(st.maxAsks, st.asks.size);
      if (st.bids.size === 0 || st.asks.size === 0) st.oneSided++;
    }
  });
  const closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString() })));

  ws.send(JSON.stringify({ event: 'subscribe', channel: ['book_lv2'], symbols: syms }));
  const ping = setInterval(() => {
    pingSentAt = performance.now();
    ws.send(JSON.stringify({ event: 'ping' }));
  }, 20_000);

  const compare = async (label) => {
    for (const s of ['BTC_USDT_PERP', 'ETH_USDT_PERP', 'FIL_USDT_PERP']) {
      const rb = await restBook(s);
      const st = state.get(s);
      let same = 0;
      let checked = 0;
      for (const [p, q] of rb.bids.slice(0, 10)) {
        checked++;
        if (st.bids.get(p) === q) same++;
      }
      for (const [p, q] of rb.asks.slice(0, 10)) {
        checked++;
        if (st.asks.get(p) === q) same++;
      }
      const bestBid = [...st.bids.keys()].sort((a, b) => Number(b) - Number(a))[0];
      const bestAsk = [...st.asks.keys()].sort((a, b) => Number(a) - Number(b))[0];
      log('rest_compare', { label, symbol: s, sameOf20: `${same}/${checked}`, wsTouch: [bestBid, st.bids.get(bestBid), bestAsk, st.asks.get(bestAsk)], restTouch: [rb.bids[0], rb.asks[0]] });
    }
  };
  await sleep(10_000);
  await compare('t10');
  await sleep(30_000);
  await compare('t40');
  await sleep(20_000);
  clearInterval(ping);
  const elapsed = (performance.now() - subAt) / 1000;
  ws.close();
  const c = await closed;
  log('acks', { rows: acks.slice(0, 3).map((a) => ({ ms: a.ms, msg: JSON.stringify(a.msg).slice(0, 300) })), count: acks.length });
  log('other', { rows: other.slice(0, 8), count: other.length });
  const rows = [];
  let snaps = 0;
  let deltas = 0;
  let gaps = 0;
  for (const [s, st] of state) {
    snaps += st.snapshots;
    deltas += st.deltas;
    gaps += st.gaps;
    rows.push(`${s} snap=${st.snapshots} wire=${st.wireBids[0]}/${st.wireAsks[0]} firstLidId=${st.snapshotLid} deltas=${st.deltas} gaps=${st.gaps} firstChains=${st.firstDeltaChains} empty=${st.emptyDeltas} repeatId=${st.repeatIds} lidEqId=${st.lidEqualsId} maxBook=${st.maxBids}/${st.maxAsks} final=${st.bids.size}/${st.asks.size} unordered=${st.snapUnordered}/${st.deltaUnorderedBids}/${st.deltaUnorderedAsks} zero=${st.zeroSize} oneSided=${st.oneSided} maxIdleS=${(st.maxIdle / 1000).toFixed(1)}`);
  }
  log('book_per_symbol', { rows });
  const rates = [...perSecond.values()];
  log('book_totals', { seconds: Math.round(elapsed), frames, perSecondMedian: quantile(rates, 0.5), perSecondMax: Math.max(...rates), bytesPerSecond: Math.round(bytes / elapsed), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: +(parseUs / frames).toFixed(1), firstSnapshotMs, snapshots: snaps, deltas, gaps, pongMs: pongs, close: c });
}

async function channels() {
  const syms = await symbols();
  const { ws, openMs } = await open();
  log('open', { openMs });
  const counts = new Map();
  const samples = new Map();
  const bookState = new Map();
  const t0 = performance.now();
  ws.on('message', (raw) => {
    const text = raw.toString();
    const msg = JSON.parse(text);
    const ch = msg.channel ?? `event:${msg.event}`;
    if (msg.event) {
      if (!samples.has(`ack:${ch}`)) samples.set(`ack:${ch}`, text.slice(0, 300));
      return;
    }
    for (const d of msg.data ?? []) {
      const key = `${ch}|${d.s}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (ch === 'book') {
        const b = bookState.get(d.s) ?? { frames: 0, same: 0, prev: null, levels: [], ids: [] };
        b.frames++;
        const sig = JSON.stringify([d.bids, d.asks]);
        if (b.prev === sig) b.same++;
        b.prev = sig;
        b.levels.push(`${d.bids.length}/${d.asks.length}`);
        b.ids.push(d.id);
        bookState.set(d.s, b);
      }
    }
    if (!samples.has(ch)) {
      const trimmed = ch === 'book' ? JSON.stringify({ ...msg, data: msg.data.map((d) => ({ ...d, bids: d.bids.slice(0, 2), asks: d.asks.slice(0, 2) })) }) : text;
      samples.set(ch, trimmed.slice(0, 600));
      capture('channel-frames.jsonl', trimmed);
    }
  });
  ws.send(JSON.stringify({ event: 'subscribe', channel: ['book'], symbols: ['BTC_USDT_PERP', 'FIL_USDT_PERP'], depth: 20 }));
  ws.send(JSON.stringify({ event: 'subscribe', channel: ['tickers', 'index_price', 'mark_price', 'funding_rate'], symbols: syms }));
  const ping = setInterval(() => ws.send(JSON.stringify({ event: 'ping' })), 20_000);
  await sleep(35_000);
  clearInterval(ping);
  const secs = (performance.now() - t0) / 1000;
  ws.close();
  const byChannel = {};
  for (const [k, n] of counts) {
    const [ch, s] = k.split('|');
    byChannel[ch] ??= {};
    byChannel[ch][s] = n;
  }
  const summary = {};
  for (const [ch, m] of Object.entries(byChannel)) {
    const vals = Object.values(m);
    summary[ch] = { symbols: vals.length, min: Math.min(...vals), median: quantile(vals, 0.5), max: Math.max(...vals), btc: m.BTC_USDT_PERP, fil: m.FIL_USDT_PERP };
  }
  log('channel_counts', { seconds: Math.round(secs), summary });
  for (const [s, b] of bookState) {
    const idsIncreasing = b.ids.every((x, i) => i === 0 || x > b.ids[i - 1]);
    const steps = b.ids.slice(1).map((x, i) => x - b.ids[i]);
    log('book_depth20', { symbol: s, frames: b.frames, identicalToPrevious: b.same, levels: [...new Set(b.levels)], idsIncreasing, idStepMin: Math.min(...steps), idStepMax: Math.max(...steps) });
  }
  for (const [ch, text] of samples) log('sample', { ch, text });
}

async function errors() {
  const { ws } = await open();
  const got = [];
  const t0 = performance.now();
  ws.on('message', (raw) => {
    const text = raw.toString();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      got.push({ ms: Math.round(performance.now() - t0), text: text.slice(0, 200) });
      return;
    }
    if (msg.channel === 'book_lv2' && msg.data) {
      got.push({ ms: Math.round(performance.now() - t0), text: `book_lv2 ${msg.action} ${msg.data.map((d) => d.s).join(',')}` });
      return;
    }
    got.push({ ms: Math.round(performance.now() - t0), text: text.slice(0, 300) });
  });
  const closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString() })));
  const steps = [
    ['unknown symbol', { event: 'subscribe', channel: ['book_lv2'], symbols: ['NOPE_USDT_PERP'] }],
    ['spot symbol', { event: 'subscribe', channel: ['book_lv2'], symbols: ['BTC_USDT'] }],
    ['unknown channel', { event: 'subscribe', channel: ['nope'], symbols: ['BTC_USDT_PERP'] }],
    ['first subscribe', { event: 'subscribe', channel: ['book_lv2'], symbols: ['FIL_USDT_PERP'] }],
    ['double subscribe', { event: 'subscribe', channel: ['book_lv2'], symbols: ['FIL_USDT_PERP'] }],
    ['list', { event: 'list_subscriptions' }],
    ['not json', 'hello'],
    ['plain ping', 'ping'],
    ['json ping', { event: 'ping' }],
    ['unsubscribe', { event: 'unsubscribe', channel: ['book_lv2'], symbols: ['FIL_USDT_PERP'] }],
    ['unsubscribe again', { event: 'unsubscribe', channel: ['book_lv2'], symbols: ['FIL_USDT_PERP'] }],
    ['symbols all', { event: 'subscribe', channel: ['book_lv2'], symbols: ['all'] }],
    ['book depth 30', { event: 'subscribe', channel: ['book'], symbols: ['BTC_USDT_PERP'], depth: 30 }],
  ];
  for (const [label, frame] of steps) {
    const mark = got.length;
    ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
    await sleep(800);
    const replies = got.slice(mark);
    const books = replies.filter((g) => g.text.startsWith('book_lv2'));
    log('error_step', { label, sent: typeof frame === 'string' ? frame : JSON.stringify(frame), replies: replies.filter((g) => !g.text.startsWith('book_lv2')).slice(0, 3), bookFrames: books.length, bookSnapshots: books.filter((b) => b.text.startsWith('book_lv2 snapshot')).length, bookSymbols: [...new Set(books.flatMap((b) => b.text.split(' ')[2].split(',')))].length });
  }
  ws.close();
  log('close', await closed);
}

async function silence() {
  const cases = [
    { name: 'idle', sub: null, pingMs: null },
    { name: 'sub_no_ping', sub: 'BTC_USDT_PERP', pingMs: null },
    { name: 'sub_ping_20s', sub: 'FIL_USDT_PERP', pingMs: 20_000 },
  ];
  const runs = cases.map(async (c) => {
    const { ws, openMs } = await open();
    const t0 = performance.now();
    let frames = 0;
    let lastFrame = 0;
    let serverPings = 0;
    ws.on('message', () => {
      frames++;
      lastFrame = performance.now() - t0;
    });
    ws.on('ping', () => serverPings++);
    if (c.sub) ws.send(JSON.stringify({ event: 'subscribe', channel: ['book_lv2'], symbols: [c.sub] }));
    const timer = c.pingMs ? setInterval(() => ws.send(JSON.stringify({ event: 'ping' })), c.pingMs) : null;
    const result = await Promise.race([
      new Promise((r) => ws.once('close', (code, reason) => r({ closedAtS: +((performance.now() - t0) / 1000).toFixed(2), code, reason: reason.toString() }))),
      sleep(100_000).then(() => ({ closedAtS: null, openFor: 100 })),
    ]);
    if (timer) clearInterval(timer);
    if (ws.readyState === ws.OPEN) ws.close();
    log('silence', { case: c.name, openMs, frames, lastFrameS: +(lastFrame / 1000).toFixed(2), serverPings, ...result });
  });
  await Promise.all(runs);
}

async function deflate() {
  const { ws, openMs } = await open(URL_PUBLIC, true);
  log('deflate', { openMs, negotiated: ws.extensions || '(none)' });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const run = { book, channels, errors, silence, deflate }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { at: new Date().toISOString() });
process.exit(0);
