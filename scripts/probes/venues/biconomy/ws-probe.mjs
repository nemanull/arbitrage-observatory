// Biconomy.com futures WebSocket probe: book channels, versions and gaps, level order, full frame against an incrementally kept book, errors, keepalive, silence, a batch of perpetuals on one connection, the all-symbol ticker, and deflate.
// The socket is the one the biconomy.com futures web app opens, wss://openapi.biconomy.com/future/websocket, and it is not in the official API documentation.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/biconomy/ws-probe.mjs [book|limits|errors|batch|silence|tickers|deflate]
//   book     depth.full limit 20 on four perps and depth (incremental) on two, for 45 s, with a REST seed and a full-against-kept comparison.
//   limits   depth.full with limit 5, 10, 20, 30, 50, 100 and none, depth.step, and depth on BTC for its first deletion frame, for 8 s.
//   errors   unknown, delisted and lowercase symbols, the MEXC method name, unknown method, bad JSON, duplicate subscribe, ping. About 10 s.
//   batch    depth.full limit 20 on every active perp on one connection for 45 s.
//   silence  three sockets that differ only in what the client sends or subscribes, for up to SILENCE_MS (default 70,000 ms).
//   tickers  tickers (all symbols), ticker, index.price, fair.price and funding.rate on BTC_USDT for 20 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep a few trimmed frames. Recorded in docs/profiles/biconomy/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://openapi.biconomy.com/future/websocket';
const API = 'https://openapi.biconomy.com/future/api/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const kept = new Map();

function capture(name, text) {
  if (!OUT) return;
  const n = kept.get(name) ?? 0;
  if (n >= 5) return;
  kept.set(name, n + 1);
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 3000) + '\n');
}

function open(label, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  ws.t0 = t0;
  ws.label = label;
  ws.on('upgrade', (res) => {
    ws.ext = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('close', (code, reason) => {
    ws.closedAt = Date.now() - t0;
    ws.closeCode = code;
    ws.closeReason = reason.toString();
  });
  ws.on('error', (e) => {
    ws.err = e.message;
  });
  ws.ready = new Promise((resolve) => ws.on('open', () => resolve(Date.now() - t0)));
  return ws;
}

const send = (ws, o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
const sub = (ws, method, params) => send(ws, params === undefined ? { method } : { method, params });
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function clockOffset() {
  let best = { rtt: Infinity, off: 0 };
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const j = await getJson(`${API}/ping`);
    const t1 = Date.now();
    if (t1 - t0 < best.rtt) best = { rtt: t1 - t0, off: j.data - (t0 + t1) / 2 };
  }
  return best;
}

const descending = (a) => a.every((l, i) => i === 0 || a[i - 1][0] > l[0]);
const ascending = (a) => a.every((l, i) => i === 0 || a[i - 1][0] < l[0]);

async function book() {
  const FULL = ['BTC_USDT', 'ETH_USDT', 'NATGAS_USDT', 'KNC_USDT'];
  const INC = ['BTC_USDT', 'KNC_USDT'];
  const DURATION = 45_000;
  const clock = await clockOffset();
  log('clock', { rtt: clock.rtt, serverMinusLocal: Math.round(clock.off) });
  const ws = open('book');
  const openMs = await ws.ready;
  log('open', { ms: openMs });

  const full = Object.fromEntries(FULL.map((s) => [s, { n: 0, ts: [], ages: [], bids: [], asks: [], orderBad: 0, sameVersion: 0, sameContent: 0, versionBack: 0, oneSided: 0, lastV: null, lastBody: null, byVersion: new Map() }]));
  const inc = Object.fromEntries(INC.map((s) => [s, { n: 0, buffered: [], seedV: null, lastV: null, gaps: 0, gapSamples: [], zero: 0, levels: 0, unsortedBids: 0, unsortedAsks: 0, firstAfterSeed: null, bids: new Map(), asks: new Map(), topByVersion: new Map(), cmpEqual: 0, cmpDiffer: 0, diffSample: null, stale: 0 }]));
  const acks = [];
  const other = {};

  const top = (m, side) => [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => (side === 'bid' ? b[0] - a[0] : a[0] - b[0])).slice(0, 20);
  const key = (bids, asks) => JSON.stringify([bids.map((l) => [l[0], l[1]]), asks.map((l) => [l[0], l[1]])]);

  const compare = (s) => {
    const st = inc[s];
    const f = full[s];
    for (const [v, body] of f.byVersion) {
      const local = st.topByVersion.get(v);
      if (local === undefined) continue;
      if (local === body) st.cmpEqual++;
      else {
        st.cmpDiffer++;
        st.diffSample ??= { v, local: local.slice(0, 200), full: body.slice(0, 200) };
      }
      f.byVersion.delete(v);
    }
  };

  const applyDelta = (s, d) => {
    const st = inc[s];
    for (const [p, v] of d.bids) v > 0 ? st.bids.set(p, v) : st.bids.delete(p);
    for (const [p, v] of d.asks) v > 0 ? st.asks.set(p, v) : st.asks.delete(p);
    st.lastV = d.version;
    st.topByVersion.set(d.version, key(top(st.bids, 'bid'), top(st.asks, 'ask')));
    if (st.topByVersion.size > 400) st.topByVersion.delete(st.topByVersion.keys().next().value);
    if (FULL.includes(s)) compare(s);
  };

  ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString();
    const m = JSON.parse(text);
    const ch = m.channel;
    if (ch === 'push.depth.full') {
      const f = full[m.s];
      f.n++;
      f.ts.push(m.ts);
      f.ages.push(now + clock.off - m.ts);
      f.bids.push(m.data.bids.length);
      f.asks.push(m.data.asks.length);
      if (!descending(m.data.bids) || !ascending(m.data.asks)) f.orderBad++;
      if (m.data.bids.length === 0 || m.data.asks.length === 0) f.oneSided++;
      if (f.lastV !== null && m.data.version === f.lastV) f.sameVersion++;
      if (f.lastV !== null && m.data.version < f.lastV) f.versionBack++;
      const body = key(m.data.bids, m.data.asks);
      if (f.lastBody === body) f.sameContent++;
      f.lastBody = body;
      f.lastV = m.data.version;
      f.byVersion.set(m.data.version, body);
      if (f.byVersion.size > 400) f.byVersion.delete(f.byVersion.keys().next().value);
      if (INC.includes(m.s)) compare(m.s);
      capture('depth-full.jsonl', text);
    } else if (ch === 'push.depth') {
      const st = inc[m.s];
      st.n++;
      const d = m.data;
      st.levels += d.bids.length + d.asks.length;
      st.zero += [...d.bids, ...d.asks].filter((l) => l[1] === 0).length;
      if (!descending(d.bids)) st.unsortedBids++;
      if (!ascending(d.asks)) st.unsortedAsks++;
      if (st.seedV === null) {
        st.buffered.push(d);
      } else {
        if (d.version <= st.seedV) {
          st.stale++;
        } else {
          if (st.lastV !== null && d.version !== st.lastV + 1) {
            st.gaps++;
            if (st.gapSamples.length < 3) st.gapSamples.push([st.lastV, d.version]);
          }
          st.firstAfterSeed ??= d.version - st.seedV;
          applyDelta(m.s, d);
        }
      }
      capture('depth-delta.jsonl', text);
    } else if (ch?.startsWith('response.')) {
      acks.push({ t: now - ws.t0, ch, data: m.data });
      capture('ack.jsonl', text);
    } else {
      other[ch] = (other[ch] ?? 0) + 1;
      if (ch === 'pong' || ch === 'clientId') capture('pong.jsonl', text);
    }
  });

  for (const s of FULL) sub(ws, 'subscribe.depth.full', { symbol: s, limit: 20 });
  for (const s of INC) sub(ws, 'subscribe.depth', { symbol: s });
  const ping = setInterval(() => sub(ws, 'ping'), 15_000);

  // Seed the incremental books from REST after the deltas have started to buffer.
  await sleep(1500);
  for (const s of INC) {
    const j = await getJson(`${API}/depth/${s}`);
    const st = inc[s];
    for (const [p, v] of j.data.bids) st.bids.set(p, v);
    for (const [p, v] of j.data.asks) st.asks.set(p, v);
    st.seedV = j.data.version;
    const buffered = st.buffered;
    st.buffered = [];
    st.bufferedCount = buffered.length;
    st.bufferedAtOrBelowSeed = buffered.filter((d) => d.version <= st.seedV).length;
    for (const d of buffered) {
      if (d.version <= st.seedV) continue;
      if (st.lastV !== null && d.version !== st.lastV + 1) st.gaps++;
      st.firstAfterSeed ??= d.version - st.seedV;
      applyDelta(s, d);
    }
    st.seedBids = j.data.bids.length;
    st.seedAsks = j.data.asks.length;
  }

  await sleep(DURATION);
  clearInterval(ping);
  ws.terminate();

  log('acks', { first: acks.slice(0, 3), count: acks.length });
  for (const [s, f] of Object.entries(full)) {
    const iv = f.ts.slice(1).map((t, i) => t - f.ts[i]);
    log('depthFull', {
      symbol: s,
      frames: f.n,
      perSecond: +(f.n / (DURATION / 1000)).toFixed(2),
      tsIntervalMs: { min: Math.min(...iv), median: median(iv), p90: q(iv, 0.9), max: Math.max(...iv) },
      ageMs: { min: Math.min(...f.ages).toFixed(0), median: median(f.ages)?.toFixed(0), max: Math.max(...f.ages).toFixed(0) },
      levels: { bidsMin: Math.min(...f.bids), bidsMax: Math.max(...f.bids), asksMin: Math.min(...f.asks), asksMax: Math.max(...f.asks) },
      orderBad: f.orderBad,
      oneSided: f.oneSided,
      sameVersionRepeats: f.sameVersion,
      sameContentRepeats: f.sameContent,
      versionBack: f.versionBack,
    });
  }
  for (const [s, st] of Object.entries(inc)) {
    log('depthIncremental', {
      symbol: s,
      deltas: st.n,
      perSecond: +(st.n / (DURATION / 1000)).toFixed(1),
      bufferedBeforeSeed: st.bufferedCount,
      bufferedAtOrBelowSeed: st.bufferedAtOrBelowSeed,
      seedLevels: [st.seedBids, st.seedAsks],
      firstAfterSeedMinusSeed: st.firstAfterSeed,
      staleAfterSeed: st.stale,
      gaps: st.gaps,
      gapSamples: st.gapSamples,
      levelsPerDelta: +(st.levels / Math.max(1, st.n)).toFixed(2),
      zeroSizeLevels: st.zero,
      unsortedBidArrays: st.unsortedBids,
      unsortedAskArrays: st.unsortedAsks,
      fullVsKeptTop20: { equal: st.cmpEqual, differ: st.cmpDiffer, diffSample: st.diffSample },
    });
  }
  log('otherChannels', other);
}

async function limits() {
  const ws = open('limits');
  await ws.ready;
  const seen = {};
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.channel === 'push.depth.full' || m.channel === 'push.depth.step') {
      const k = `${m.channel}|${m.s}`;
      const e = (seen[k] ??= { n: 0, bids: new Set(), asks: new Set() });
      e.n++;
      e.bids.add(m.data.bids.length);
      e.asks.add(m.data.asks.length);
    } else if (m.channel === 'push.depth') {
      seen.deltas = (seen.deltas ?? 0) + 1;
      if ([...m.data.bids, ...m.data.asks].some((l) => l[1] === 0)) {
        seen.deletions = (seen.deletions ?? 0) + 1;
        if (seen.deletions === 1) log('firstDeletion', { frame: raw.toString() });
      }
    } else if (m.channel?.startsWith('response.')) {
      const k = `ack|${m.channel}|${m.data}`;
      seen[k] = (seen[k] ?? 0) + 1;
      if (m.channel === 'response.error') log('errorFrame', { frame: raw.toString() });
    }
  });
  const symbols = { 5: 'BTC_USDT', 10: 'ETH_USDT', 20: 'SOL_USDT', 30: 'XRP_USDT', 50: 'DOGE_USDT', 100: 'BNB_USDT' };
  for (const [limit, symbol] of Object.entries(symbols)) sub(ws, 'subscribe.depth.full', { symbol, limit: Number(limit) });
  sub(ws, 'subscribe.depth.full', { symbol: 'LINK_USDT' });
  sub(ws, 'subscribe.depth.step', { symbol: 'ADA_USDT', step: '0.0001' });
  sub(ws, 'subscribe.depth', { symbol: 'BTC_USDT' });
  await sleep(8000);
  ws.terminate();
  const out = {};
  for (const [k, v] of Object.entries(seen)) out[k] = typeof v === 'number' ? v : { n: v.n, bids: [...v.bids], asks: [...v.asks] };
  out.requestedDepthOn = 'BTC_USDT';
  log('limits', { requested: { ...symbols, none: 'LINK_USDT', step: 'ADA_USDT 0.0001' }, seen: out });
}

async function errors() {
  const ws = open('errors');
  const openMs = await ws.ready;
  const frames = [];
  ws.on('message', (raw) => {
    const text = raw.toString();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      frames.push({ t: Date.now() - ws.t0, nonJson: text.slice(0, 120) });
      return;
    }
    if (m.channel === 'push.depth.full' || m.channel === 'push.depth') {
      const k = `${m.channel}|${m.s}`;
      frames.counts ??= {};
      frames.counts[k] = (frames.counts[k] ?? 0) + 1;
      return;
    }
    frames.push({ t: Date.now() - ws.t0, text: text.slice(0, 200) });
    if (m.channel === 'response.error') capture('error.jsonl', text);
  });
  const step = async (label, o) => {
    frames.push({ sent: label });
    send(ws, o);
    await sleep(700);
  };
  await step('unknown symbol', { method: 'subscribe.depth.full', params: { symbol: 'NOPE_USDT', limit: 20 } });
  await step('delisted LRC_USDT', { method: 'subscribe.depth.full', params: { symbol: 'LRC_USDT', limit: 20 } });
  await step('lowercase', { method: 'subscribe.depth.full', params: { symbol: 'btc_usdt', limit: 20 } });
  await step('MEXC name sub.depth', { method: 'sub.depth', param: { symbol: 'ETH_USDT' } });
  await step('unknown method', { method: 'subscribe.nope', params: { symbol: 'BTC_USDT' } });
  await step('not JSON', 'hello');
  await step('first BTC full', { method: 'subscribe.depth.full', params: { symbol: 'BTC_USDT', limit: 20 } });
  await step('duplicate BTC full', { method: 'subscribe.depth.full', params: { symbol: 'BTC_USDT', limit: 20 } });
  await step('missing params', { method: 'subscribe.depth.full' });
  await step('ping', { method: 'ping' });
  await step('unsubscribe BTC full', { method: 'unsubscribe.depth.full', params: { symbol: 'BTC_USDT', limit: 20 } });
  await sleep(1500);
  const after = { ...(frames.counts ?? {}) };
  await sleep(2000);
  ws.terminate();
  log('errorsOpen', { ms: openMs, closed: ws.closedAt ?? null, code: ws.closeCode ?? null });
  for (const f of frames) log('frame', f);
  log('pushCounts', { atUnsubPlus1500: after, final: frames.counts ?? {} });
}

async function batch() {
  const detail = await getJson(`${API}/detailV2?client=web`);
  const symbols = detail.data.filter((c) => c.state === 0).map((c) => c.symbol);
  const DURATION = 45_000;
  const ws = open('batch');
  const openMs = await ws.ready;
  const per = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSec = [];
  let secCount = 0;
  const errs = [];
  let acks = 0;
  let firstFrameAt = null;
  let t0 = Date.now();
  const tick = setInterval(() => {
    perSec.push(secCount);
    secCount = 0;
  }, 1000);
  ws.on('message', (raw) => {
    const t = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t;
    if (m.channel === 'push.depth.full') {
      frames++;
      secCount++;
      bytes += raw.length;
      firstFrameAt ??= Date.now() - ws.t0;
      const e = per.get(m.s) ?? { n: 0, bids: 0, asks: 0, first: Date.now() - t0 };
      e.n++;
      e.bids = Math.max(e.bids, m.data.bids.length);
      e.asks = Math.max(e.asks, m.data.asks.length);
      per.set(m.s, e);
    } else if (m.channel === 'response.error') errs.push(m.data);
    else if (m.channel === 'response.subscribe.depth.full') acks++;
  });
  t0 = Date.now();
  for (const s of symbols) sub(ws, 'subscribe.depth.full', { symbol: s, limit: 20 });
  const sendMs = Date.now() - t0;
  const ping = setInterval(() => sub(ws, 'ping'), 15_000);
  await sleep(DURATION);
  clearInterval(ping);
  clearInterval(tick);
  ws.terminate();
  const counts = [...per.values()].map((e) => e.n);
  const firsts = [...per.values()].map((e) => e.first);
  const thin = [...per.entries()].filter(([, e]) => e.bids < 20 || e.asks < 20).map(([s, e]) => `${s}:${e.bids}/${e.asks}`);
  log('batch', {
    subscribed: symbols.length,
    sendMs,
    openMs,
    acks,
    errors: errs.slice(0, 5),
    firstFrameMs: firstFrameAt,
    symbolsDelivered: per.size,
    silent: symbols.filter((s) => !per.has(s)).slice(0, 20),
    frames,
    framesPerSecond: { mean: +(frames / (DURATION / 1000)).toFixed(0), median: median(perSec.slice(2)), max: Math.max(...perSec) },
    kbPerSecond: +(bytes / 1024 / (DURATION / 1000)).toFixed(1),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: +(Number(parseNs) / 1000 / Math.max(1, frames)).toFixed(1),
    framesPerSymbol: { min: Math.min(...counts), median: median(counts), max: Math.max(...counts) },
    firstFrameAfterSubscribeMs: { min: Math.min(...firsts), median: median(firsts), p90: q(firsts, 0.9), max: Math.max(...firsts), within1s: firsts.filter((x) => x <= 1000).length, within5s: firsts.filter((x) => x <= 5000).length },
    symbolsUnder20Levels: thin.length,
    thinSample: thin.slice(0, 10),
    closedEarly: ws.closedAt ?? null,
  });
}

async function silence() {
  const LIMIT = Number(process.env.SILENCE_MS ?? 70_000);
  const a = open('A no subscribe, no ping');
  const b = open('B subscribe KNC_USDT full, no ping');
  const c = open('C ping every 15 s, no subscribe');
  await Promise.all([a.ready, b.ready, c.ready]);
  const lastFrame = new Map();
  for (const ws of [a, b, c]) {
    ws.frames = 0;
    ws.on('message', () => {
      ws.frames++;
      lastFrame.set(ws.label, Date.now() - ws.t0);
    });
    ws.on('ping', () => {
      ws.serverPings = (ws.serverPings ?? 0) + 1;
    });
  }
  sub(b, 'subscribe.depth.full', { symbol: 'KNC_USDT', limit: 20 });
  const ping = setInterval(() => c.readyState === 1 && sub(c, 'ping'), 15_000);
  const start = Date.now();
  while (Date.now() - start < LIMIT && [a, b, c].some((w) => w.readyState === 1)) await sleep(500);
  clearInterval(ping);
  for (const ws of [a, b, c]) {
    log('silence', { socket: ws.label, closedAtMs: ws.closedAt ?? null, code: ws.closeCode ?? null, reason: ws.closeReason ?? null, frames: ws.frames, lastFrameMs: lastFrame.get(ws.label) ?? null, serverProtocolPings: ws.serverPings ?? 0, err: ws.err ?? null });
    ws.terminate();
  }
}

async function tickers() {
  const ws = open('tickers');
  await ws.ready;
  const stats = {};
  const samples = {};
  let allFrameSymbols = [];
  ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    const ch = m.channel;
    stats[ch] = (stats[ch] ?? 0) + 1;
    if (ch === 'push.tickers') {
      allFrameSymbols.push(Array.isArray(m.data) ? m.data.length : -1);
      samples[ch] ??= { keys: Object.keys(m.data?.[0] ?? {}), first: JSON.stringify(m.data?.[0]).slice(0, 400), bytes: text.length };
    } else if (!samples[ch]) samples[ch] = text.slice(0, 500);
  });
  sub(ws, 'subscribe.tickers', { timezone: '24H' });
  sub(ws, 'subscribe.ticker', { symbol: 'BTC_USDT' });
  sub(ws, 'subscribe.index.price', { symbol: 'BTC_USDT' });
  sub(ws, 'subscribe.fair.price', { symbol: 'BTC_USDT' });
  sub(ws, 'subscribe.funding.rate', { symbol: 'BTC_USDT' });
  await sleep(20_000);
  ws.terminate();
  log('tickerCounts', { in20s: stats, symbolsPerTickersFrame: { min: Math.min(...allFrameSymbols), max: Math.max(...allFrameSymbols) } });
  for (const [ch, s] of Object.entries(samples)) log('sample', { ch, s });
}

async function deflate() {
  const ws = open('deflate', { deflate: true });
  const ms = await ws.ready;
  let binary = 0;
  let text = 0;
  ws.on('message', (raw, isBinary) => (isBinary ? binary++ : text++));
  sub(ws, 'subscribe.depth.full', { symbol: 'BTC_USDT', limit: 20 });
  await sleep(3000);
  ws.terminate();
  log('deflate', { openMs: ms, negotiated: ws.ext, textFrames: text, binaryFrames: binary });
  const plain = open('plain');
  await plain.ready;
  let pb = 0;
  let pt = 0;
  plain.on('message', (raw, isBinary) => (isBinary ? pb++ : pt++));
  sub(plain, 'subscribe.depth.full', { symbol: 'BTC_USDT', limit: 20 });
  await sleep(2000);
  plain.terminate();
  log('plain', { negotiated: plain.ext, textFrames: pt, binaryFrames: pb });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, limits, errors, batch, silence, tickers, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
