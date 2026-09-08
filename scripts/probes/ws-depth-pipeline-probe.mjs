// Whole universe depth through the client the feeds use, `ws`, with permessage-deflate on and then off.
// Every message is parsed, applied to a maintained book where the venue sends deltas, and its top twenty copied into a flat Float64Array block.
// The handler time is therefore the cost of the real pipeline and not of JSON.parse alone.
// Prints per venue message rate, decoded and wire bytes, handler time split into parse, apply and copy, top of book changes, and per mode process CPU, event loop delay and RSS.
// Run from anywhere: node scripts/probes/ws-depth-pipeline-probe.mjs [windowSeconds] [modes]
// Recorded in docs/research/2026-09-07-depth-stream-scaling.md.
import { createRequire } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';

// Package resolution follows the importing file, so the server's node_modules is named explicitly.
const WebSocket = createRequire(new URL('../../server/package.json', import.meta.url))('ws');

const WINDOW_MS = (Number(process.argv[2]) || 20) * 1000;
const MODES = (process.argv[3] || 'deflate,plain').split(',');
const SETTLE_MS = 5000; // after the last subscribe frame, before the window starts
const LEVELS = 20;
const COINBASE_PER_CONNECTION = 30; // level2 refuses more than about 30 products per connection

const json = async (url) => (await fetch(url, { signal: AbortSignal.timeout(15000) })).json();

async function universe() {
  const out = {};
  const b = await json('https://fapi.binance.com/fapi/v1/exchangeInfo');
  out.binance = b.symbols.filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING').map((s) => s.symbol);
  let cursor = '';
  const bybit = [];
  do {
    const r = await json(`https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
    bybit.push(...r.result.list.filter((i) => i.status === 'Trading' && i.contractType === 'LinearPerpetual').map((i) => i.symbol));
    cursor = r.result.nextPageCursor;
  } while (cursor);
  out.bybit = bybit;
  const o = await json('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
  out.okx = o.data.filter((i) => i.state === 'live').map((i) => i.instId);
  const k = await json('https://futures.kraken.com/derivatives/api/v3/instruments');
  out.krakenfutures = k.instruments.filter((i) => i.tradeable && i.symbol.startsWith('PF_')).map((i) => i.symbol);
  const c = await json('https://api.coinbase.com/api/v3/brokerage/market/products?product_type=FUTURE&contract_expiry_type=PERPETUAL');
  out.coinbase = (c.products ?? []).filter((p) => p.product_id.endsWith('-INTX') && p.status !== 'offline').map((p) => p.product_id);
  return out;
}

const chunk = (a, n) => { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };

// One sorted book per market: parallel price and size arrays, bids descending, asks ascending.
function lowerBound(prices, price, descending) {
  let lo = 0;
  let hi = prices.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const before = descending ? prices[mid] > price : prices[mid] < price;
    if (before) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function applyLevel(prices, sizes, price, size, descending) {
  const i = lowerBound(prices, price, descending);
  const found = i < prices.length && prices[i] === price;
  if (size === 0) {
    if (found) { prices.splice(i, 1); sizes.splice(i, 1); }
    return;
  }
  if (found) sizes[i] = size;
  else { prices.splice(i, 0, price); sizes.splice(i, 0, size); }
}

class Book {
  constructor() { this.bidP = []; this.bidS = []; this.askP = []; this.askS = []; }
  reset() { this.bidP.length = 0; this.bidS.length = 0; this.askP.length = 0; this.askS.length = 0; }
  bid(price, size) { applyLevel(this.bidP, this.bidS, price, size, true); }
  ask(price, size) { applyLevel(this.askP, this.askS, price, size, false); }
  // A snapshot side that arrives best first is pushed, which costs nothing next to inserting it.
  fillBids(levels, at) { for (let i = 0; i < levels.length; i++) { const l = at(levels[i]); this.bidP.push(l[0]); this.bidS.push(l[1]); } }
  fillAsks(levels, at) { for (let i = 0; i < levels.length; i++) { const l = at(levels[i]); this.askP.push(l[0]); this.askS.push(l[1]); } }
  levels() { return this.bidP.length + this.askP.length; }
}

const pair = (l) => [Number(l[0]), Number(l[1])];
const krakenLevel = (l) => [l.price, l.qty];

// Block: one range of LEVELS per market, exactly the cluster depth layout with markets in place of venue slots.
function createBlock(width) {
  return {
    bidP: new Float64Array(width * LEVELS), bidS: new Float64Array(width * LEVELS),
    askP: new Float64Array(width * LEVELS), askS: new Float64Array(width * LEVELS),
    bidN: new Uint8Array(width), askN: new Uint8Array(width),
    topB: new Float64Array(width), topA: new Float64Array(width), writtenAt: new Float64Array(width),
  };
}

function copyTop(blk, book, idx, now) {
  const base = idx * LEVELS;
  const nb = Math.min(book.bidP.length, LEVELS);
  const na = Math.min(book.askP.length, LEVELS);
  for (let l = 0; l < nb; l++) { blk.bidP[base + l] = book.bidP[l]; blk.bidS[base + l] = book.bidS[l]; }
  for (let l = 0; l < na; l++) { blk.askP[base + l] = book.askP[l]; blk.askS[base + l] = book.askS[l]; }
  blk.bidN[idx] = nb; blk.askN[idx] = na; blk.writtenAt[idx] = now;
  const tb = nb ? book.bidP[0] : 0;
  const ta = na ? book.askP[0] : 0;
  const changed = tb !== blk.topB[idx] || ta !== blk.topA[idx];
  blk.topB[idx] = tb; blk.topA[idx] = ta;
  return changed;
}

// Each venue: connection plan, subscribe frames, `sym(j)` for the market a data frame belongs to or null for a control frame,
// and `apply(j, book)` which mutates the book and returns whether the frame was a snapshot.
function venues(u) {
  return [
    { venue: 'binance', url: 'wss://fstream.binance.com/public/ws', symbols: u.binance, per: 200, frame: 100,
      sub: (s, i) => JSON.stringify({ method: 'SUBSCRIBE', params: s.map((x) => `${x.toLowerCase()}@depth20@100ms`), id: i + 1 }),
      sym: (j) => (j.e === 'depthUpdate' ? j.s : null),
      apply: (j, book) => { book.reset(); book.fillBids(j.b, pair); book.fillAsks(j.a, pair); return true; } },
    { venue: 'bybit', url: 'wss://stream.bybit.com/v5/public/linear', symbols: u.bybit, per: 200, frame: 200,
      sub: (s) => JSON.stringify({ op: 'subscribe', args: s.map((x) => `orderbook.50.${x}`) }),
      sym: (j) => (j.topic && j.topic.startsWith('orderbook.') ? j.data.s : null),
      apply: (j, book) => {
        const d = j.data;
        if (j.type === 'snapshot') { book.reset(); book.fillBids(d.b, pair); book.fillAsks(d.a, pair); return true; }
        for (let i = 0; i < d.b.length; i++) book.bid(Number(d.b[i][0]), Number(d.b[i][1]));
        for (let i = 0; i < d.a.length; i++) book.ask(Number(d.a[i][0]), Number(d.a[i][1]));
        return false;
      } },
    { venue: 'okx', url: 'wss://ws.okx.com:8443/ws/v5/public', symbols: u.okx, per: 250, frame: 200, stagger: 400,
      sub: (s, i) => JSON.stringify({ id: `s${i}`, op: 'subscribe', args: s.map((x) => ({ channel: 'books', instId: x })) }),
      sym: (j) => (j.arg && Array.isArray(j.data) ? j.arg.instId : null),
      apply: (j, book) => {
        const d = j.data[0];
        if (j.action === 'snapshot') { book.reset(); book.fillBids(d.bids, pair); book.fillAsks(d.asks, pair); return true; }
        for (let i = 0; i < d.bids.length; i++) book.bid(Number(d.bids[i][0]), Number(d.bids[i][1]));
        for (let i = 0; i < d.asks.length; i++) book.ask(Number(d.asks[i][0]), Number(d.asks[i][1]));
        return false;
      } },
    { venue: 'krakenfutures', url: 'wss://futures.kraken.com/ws/v1', symbols: u.krakenfutures, per: 100, frame: 100,
      sub: (s) => JSON.stringify({ event: 'subscribe', feed: 'book', product_ids: s }),
      sym: (j) => ((j.feed === 'book_snapshot' || j.feed === 'book') && j.product_id ? j.product_id : null),
      apply: (j, book) => {
        if (j.feed === 'book_snapshot') { book.reset(); book.fillBids(j.bids, krakenLevel); book.fillAsks(j.asks, krakenLevel); return true; }
        if (j.side === 'buy') book.bid(j.price, j.qty); else book.ask(j.price, j.qty);
        return false;
      } },
    { venue: 'coinbase', url: 'wss://advanced-trade-ws.coinbase.com', symbols: u.coinbase, per: COINBASE_PER_CONNECTION, frame: COINBASE_PER_CONNECTION, stagger: 300,
      sub: (s) => JSON.stringify({ type: 'subscribe', channel: 'level2', product_ids: s }),
      extra: JSON.stringify({ type: 'subscribe', channel: 'heartbeats' }),
      sym: (j) => (j.channel === 'l2_data' && j.events?.[0] ? j.events[0].product_id : null),
      apply: (j, book) => {
        const ev = j.events[0];
        const snapshot = ev.type === 'snapshot';
        if (snapshot) book.reset();
        const ups = ev.updates ?? [];
        for (let i = 0; i < ups.length; i++) {
          const up = ups[i];
          if (up.side === 'bid') book.bid(Number(up.price_level), Number(up.new_quantity)); else book.ask(Number(up.price_level), Number(up.new_quantity));
        }
        return snapshot;
      } },
  ];
}

function quantile(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(0);
}

async function runMode(u, mode) {
  const perMessageDeflate = mode === 'deflate';
  const plans = venues(u);
  const width = plans.reduce((n, p) => n + p.symbols.length, 0);
  const blk = createBlock(width);
  const hist = monitorEventLoopDelay({ resolution: 5 });
  const stats = {};
  const sockets = [];
  let nextIdx = 0;

  const openAll = plans.map(async (p) => {
    const idx = new Map(p.symbols.map((s) => [s, nextIdx++]));
    const books = new Map(p.symbols.map((s) => [s, new Book()]));
    const st = (stats[p.venue] = {
      symbols: p.symbols.length, connections: 0, extensions: new Set(), errors: 0, closes: 0, control: [],
      seen: new Set(), firstSnapshotMs: [], sockets: [], books,
      win: { msgs: 0, bytes: 0, parseMs: 0, applyMs: 0, copyMs: 0, data: 0, snapshots: 0, deltas: 0, topChanges: 0, unknown: 0 },
      inWindow: false,
    });
    const groups = chunk(p.symbols, p.per);
    for (let gi = 0; gi < groups.length; gi++) {
      if (p.stagger && gi > 0) await new Promise((f) => setTimeout(f, p.stagger));
      const g = groups[gi];
      await new Promise((resolve) => {
        const ws = new WebSocket(p.url, { perMessageDeflate });
        sockets.push(ws);
        st.connections++;
        let subAt = 0;
        ws.on('open', () => {
          st.extensions.add(ws.extensions || 'none');
          st.sockets.push(ws._socket);
          chunk(g, p.frame).forEach((s, i) => ws.send(p.sub(s, i)));
          if (p.extra) ws.send(p.extra);
          subAt = performance.now();
          resolve();
        });
        ws.on('error', (e) => { st.errors++; if (st.control.length < 3) st.control.push(`error ${e.message}`); resolve(); });
        ws.on('close', (code) => { st.closes++; if (st.control.length < 3) st.control.push(`close ${code}`); resolve(); });
        ws.on('message', (raw) => {
          const w = st.win;
          const inWindow = st.inWindow;
          const t0 = performance.now();
          const text = raw.toString('utf8');
          if (inWindow) { w.msgs++; w.bytes += text.length; }
          if (text === 'pong') return;
          let j;
          try { j = JSON.parse(text); } catch { return; }
          const sym = p.sym(j);
          const t1 = performance.now();
          if (inWindow) w.parseMs += t1 - t0;
          if (sym === null) { if (st.control.length < 3) st.control.push(text.slice(0, 140)); return; }
          const book = books.get(sym);
          if (book === undefined) { if (inWindow) w.unknown++; return; }
          const snapshot = p.apply(j, book);
          const t2 = performance.now();
          const changed = copyTop(blk, book, idx.get(sym), t2);
          const t3 = performance.now();
          if (inWindow) {
            w.applyMs += t2 - t1; w.copyMs += t3 - t2; w.data++;
            if (snapshot) w.snapshots++; else w.deltas++;
            if (changed) w.topChanges++;
          }
          if (snapshot && !st.seen.has(sym)) { st.seen.add(sym); st.firstSnapshotMs.push(performance.now() - subAt); }
        });
      });
    }
  });

  await Promise.all(openAll);
  await new Promise((f) => setTimeout(f, SETTLE_MS));

  const wire0 = {};
  for (const [v, st] of Object.entries(stats)) { wire0[v] = st.sockets.reduce((n, s) => n + (s?.bytesRead ?? 0), 0); st.inWindow = true; }
  hist.enable();
  const cpu0 = process.cpuUsage();
  const thread0 = process.threadCpuUsage(); // the event loop thread alone, so inflate on the threadpool shows up as the difference
  const t0 = performance.now();
  const mem0 = process.memoryUsage();
  await new Promise((f) => setTimeout(f, WINDOW_MS));
  const cpu1 = process.cpuUsage(cpu0);
  const thread1 = process.threadCpuUsage(thread0);
  const elapsed = performance.now() - t0;
  const mem1 = process.memoryUsage();
  hist.disable();
  for (const st of Object.values(stats)) st.inWindow = false;

  const sec = elapsed / 1000;
  const report = {
    mode, windowSec: +sec.toFixed(1), markets: width,
    cpuPercentOfOneCore: +((cpu1.user + cpu1.system) / 1000 / elapsed * 100).toFixed(1),
    cpuUserPercent: +(cpu1.user / 1000 / elapsed * 100).toFixed(1),
    cpuSystemPercent: +(cpu1.system / 1000 / elapsed * 100).toFixed(1),
    mainThreadCpuPercent: +((thread1.user + thread1.system) / 1000 / elapsed * 100).toFixed(1),
    eventLoopDelayMs: { p50: +(hist.percentile(50) / 1e6).toFixed(1), p99: +(hist.percentile(99) / 1e6).toFixed(1), max: +(hist.max / 1e6).toFixed(1) },
    rssMb: { start: +(mem0.rss / 1048576).toFixed(0), end: +(mem1.rss / 1048576).toFixed(0) },
    heapUsedMb: { start: +(mem0.heapUsed / 1048576).toFixed(0), end: +(mem1.heapUsed / 1048576).toFixed(0) },
    venues: {},
  };
  const total = { msgs: 0, bytes: 0, wire: 0, parseMs: 0, applyMs: 0, copyMs: 0, topChanges: 0, data: 0, levels: 0 };
  for (const [v, st] of Object.entries(stats)) {
    const w = st.win;
    const wire = st.sockets.reduce((n, s) => n + (s?.bytesRead ?? 0), 0) - wire0[v];
    let levels = 0;
    for (const b of st.books.values()) levels += b.levels();
    total.msgs += w.msgs; total.bytes += w.bytes; total.wire += wire; total.parseMs += w.parseMs; total.applyMs += w.applyMs; total.copyMs += w.copyMs;
    total.topChanges += w.topChanges; total.data += w.data; total.levels += levels;
    report.venues[v] = {
      symbols: st.symbols, connections: st.connections, extensions: [...st.extensions], errors: st.errors, closes: st.closes,
      coverage: `${st.seen.size}/${st.symbols}`,
      msgsPerSec: +(w.msgs / sec).toFixed(0), kbPerSec: +(w.bytes / 1024 / sec).toFixed(0), wireKbPerSec: +(wire / 1024 / sec).toFixed(0),
      wireOverDecoded: w.bytes ? +(wire / w.bytes).toFixed(2) : null, avgBytes: w.msgs ? +(w.bytes / w.msgs).toFixed(0) : 0,
      parseMsPerSec: +(w.parseMs / sec).toFixed(1), applyMsPerSec: +(w.applyMs / sec).toFixed(1), copyMsPerSec: +(w.copyMs / sec).toFixed(1),
      usPerMessage: w.data ? +((w.parseMs + w.applyMs + w.copyMs) * 1000 / w.data).toFixed(1) : null,
      snapshots: w.snapshots, deltas: w.deltas, unknownSymbolFrames: w.unknown,
      topChangesPerSec: +(w.topChanges / sec).toFixed(0), topChangeShare: w.data ? +(w.topChanges / w.data).toFixed(2) : null,
      bookLevelsHeld: levels,
      firstSnapshotMs: { p50: quantile(st.firstSnapshotMs, 0.5), p90: quantile(st.firstSnapshotMs, 0.9), max: quantile(st.firstSnapshotMs, 1) },
      control: st.control,
    };
  }
  report.total = {
    msgsPerSec: +(total.msgs / sec).toFixed(0), kbPerSec: +(total.bytes / 1024 / sec).toFixed(0), wireKbPerSec: +(total.wire / 1024 / sec).toFixed(0),
    parseMsPerSec: +(total.parseMs / sec).toFixed(1), applyMsPerSec: +(total.applyMs / sec).toFixed(1), copyMsPerSec: +(total.copyMs / sec).toFixed(1),
    handlerMsPerSec: +((total.parseMs + total.applyMs + total.copyMs) / sec).toFixed(1),
    usPerMessage: total.data ? +((total.parseMs + total.applyMs + total.copyMs) * 1000 / total.data).toFixed(1) : null,
    topChangesPerSec: +(total.topChanges / sec).toFixed(0),
    bookLevelsHeld: total.levels,
  };

  for (const ws of sockets) { try { ws.terminate(); } catch {} }
  return report;
}

const u = await universe();
console.log(JSON.stringify({ universe: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.length])) }));
for (let i = 0; i < MODES.length; i++) {
  if (i > 0) await new Promise((f) => setTimeout(f, 3000));
  console.log(JSON.stringify(await runMode(u, MODES[i])));
}
process.exit(0);
