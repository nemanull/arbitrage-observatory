// Bitbase futures WebSocket probe: catalog from the ticker streams, the book channels, the anchor topics, errors, a batch of perpetuals on one connection, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// The URL is the one the Bitbase web app builds, getOrigin("fstream") plus "/ws/market", since Bitbase publishes no API documentation.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitbase/ws-probe.mjs [catalog|book|anchor|errors|batch|silence|deflate]
//   catalog  tickers and agg_tickers for 12 s: symbol count by quote, contract size implied by turnover. About 13 s.
//   book     depth_update (100 ms) and depth,50 on four perps for 60 s: chain rule, snapshot alignment, level order, window. About 62 s.
//   anchor   agg_tickers plus mark_price, index_price, fund_rate and agg_ticker on three perps for 65 s: cadence, coverage, premium. About 67 s.
//   errors   unknown, delisted and close-only symbols, a batch holding one unknown symbol, depth levels and intervals, bad topic, non-JSON, duplicate, unsubscribe, one spot check. About 35 s.
//   batch    depth_update on 150 perps on one connection for 45 s. About 50 s.
//   silence  five sockets that differ only in what the client sends or subscribes, for up to 70 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/bitbase/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FUT_URL = 'wss://fstream.bitbase.com/ws/market';
const SPOT_URL = 'wss://stream.bitbase.com/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
let reqId = 0;
const sub = (params, method = 'SUBSCRIBE') => JSON.stringify({ id: `p${++reqId}`, method, params });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url = FUT_URL, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve, reject) => {
    ws.once('upgrade', (res) => {
      ws.negotiated = res.headers['sec-websocket-extensions'] ?? null;
    });
    ws.once('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)));
    ws.once('error', reject);
    ws.once('open', () => {
      ws.openMs = Date.now() - t0;
      resolve(ws);
    });
  });
}

function parse(buf) {
  const s = buf.toString();
  try {
    return { s, j: JSON.parse(s) };
  } catch {
    return { s, j: null };
  }
}

// One tickers and agg_tickers read gives the live symbol list, since the REST catalog is behind a Cloudflare challenge from this host.
async function readCatalog(ms = 12_000) {
  const ws = await open();
  const tick = new Map();
  const agg = new Map();
  const aggFrames = [];
  const tickFrames = [];
  ws.on('message', (d) => {
    const { j } = parse(d);
    if (!j?.topic) return;
    if (j.topic === 'tickers') {
      tickFrames.push({ at: Date.now(), n: j.data.length });
      for (const r of j.data) tick.set(r.s, r);
    }
    if (j.topic === 'agg_tickers') {
      aggFrames.push({ at: Date.now(), n: j.data.length, bytes: d.length, lagMs: Date.now() - Math.max(...j.data.map((r) => r.t)) });
      for (const r of j.data) agg.set(r.s, r);
    }
  });
  ws.send(sub(['tickers']));
  ws.send(sub(['agg_tickers']));
  await sleep(ms);
  ws.terminate();
  return { tick, agg, aggFrames, tickFrames, openMs: ws.openMs };
}

async function modeCatalog() {
  const { tick, agg, aggFrames, tickFrames, openMs } = await readCatalog();
  const byQuote = {};
  for (const s of new Set([...tick.keys(), ...agg.keys()])) {
    const q = s.split('_').pop();
    byQuote[q] = (byQuote[q] ?? 0) + 1;
  }
  log('catalog', {
    openMs,
    tickersSymbols: tick.size,
    aggSymbols: agg.size,
    union: new Set([...tick.keys(), ...agg.keys()]).size,
    byQuote,
    tickersFrames: tickFrames.length,
    tickersRowsPerFrame: tickFrames.map((f) => f.n),
    aggFrames: aggFrames.length,
    aggRowsPerFrame: aggFrames.map((f) => f.n),
    aggGapsMs: aggFrames.slice(1).map((f, i) => f.at - aggFrames[i].at),
    aggBytesPerFrame: aggFrames.map((f) => f.bytes),
    aggLagFromNewestRowMs: aggFrames.map((f) => f.lagMs),
  });
  // Turnover over amount over last price estimates the contract size in coins.
  const implied = [];
  for (const [s, r] of tick) {
    const a = Number(r.a);
    const v = Number(r.v);
    const c = Number(r.c);
    if (a > 0 && v > 0 && c > 0) implied.push({ s, v, est: v / (a * c) });
  }
  implied.sort((x, y) => y.v - x.v);
  const pow10 = (x) => 10 ** Math.round(Math.log10(x));
  const hist = {};
  for (const r of implied) hist[pow10(r.est)] = (hist[pow10(r.est)] ?? 0) + 1;
  log('implied_contract_size', {
    top: implied.slice(0, 8).map((r) => ({ s: r.s, usdVol: Math.round(r.v), est: Number(r.est.toPrecision(3)) })),
    histogramByPowerOf10: hist,
  });
  const sample = [...tick.values()][0];
  log('tickers_row_keys', { keys: Object.keys(sample ?? {}) });
  const aggSample = [...agg.values()][0];
  log('agg_row_keys', { keys: Object.keys(aggSample ?? {}) });
  const vols = implied.map((r) => r.v);
  log('volume_rank', { median: pct(vols, 50), p10: pct(vols, 10), p90: pct(vols, 90), under10k: vols.filter((v) => v < 10_000).length });
}

function pickSymbols(tick, n, quote = 'usdt') {
  return [...tick.values()]
    .filter((r) => r.s.endsWith(`_${quote}`))
    .sort((a, b) => Number(b.v) - Number(a.v))
    .map((r) => r.s)
    .filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / n)) === 0)
    .slice(0, n);
}

async function modeBook() {
  const { tick } = await readCatalog(4_000);
  const usdt = [...tick.values()].filter((r) => r.s.endsWith('_usdt')).sort((a, b) => Number(b.v) - Number(a.v));
  const mid = usdt[Math.floor(usdt.length / 2)]?.s;
  const thin = usdt[usdt.length - 5]?.s;
  const syms = ['btc_usdt', 'eth_usdt', mid, thin];
  log('book_symbols', { syms, thinUsdVol: Number(usdt[usdt.length - 5]?.v) });
  const ws = await open();
  const t0 = Date.now();
  const st = Object.fromEntries(
    syms.map((s) => [
      s,
      {
        deltas: 0, gaps: 0, fuMinusPu: {}, emptyDeltas: 0, zeroSizes: 0, bidUnordered: 0, askUnordered: 0,
        lastU: null, snaps: 0, snapIds: [], snapGapsMs: [], lastSnapAt: null, snapRepeatId: 0, snapLevels: [],
        snapBidsDesc: 0, snapAsksAsc: 0, deltaUs: [], firstSnapMs: null, firstDeltaMs: null, alignedAt: {}, maxDeltaMs: 0, lastDeltaAt: null,
        book: null, match: [], pending: [], lagMs: [], buffer: [], states: [], firstMismatch: [], spellings: new Map(), priceSpelledTwice: 0,
      },
    ]),
  );
  // Levels are keyed by numeric price, because one price arrives spelled "0.142" in one frame and "0.1420" in another.
  const applyLevels = (side, levels) => {
    for (const [p, q] of levels) {
      if (Number(q) === 0) side.delete(Number(p));
      else side.set(Number(p), Number(q));
    }
  };
  const spelledTwice = (x, levels) => {
    for (const [p] of levels) {
      const n = Number(p);
      const seen = x.spellings.get(n);
      if (seen === undefined) x.spellings.set(n, p);
      else if (seen !== p) x.priceSpelledTwice++;
    }
  };
  const applyDelta = (x, d) => {
    if (d.u <= x.book.u) return;
    if (d.fu > x.book.u + 1n) {
      x.bookBreaks = (x.bookBreaks ?? 0) + 1;
      x.book = null;
      x.pending = [];
      return;
    }
    applyLevels(x.book.b, d.b);
    applyLevels(x.book.a, d.a);
    x.book.u = d.u;
    const state = { u: d.u, b: topN(x.book.b, true, 20), a: topN(x.book.a, false, 20) };
    x.states.push(state);
    if (x.states.length > 60) x.states.shift();
    const keep = [];
    for (const snap of x.pending) {
      if (snap.id === d.u) compareSnap(x, state, snap);
      else if (snap.id > d.u) keep.push(snap);
      else x.snapNoBoundary = (x.snapNoBoundary ?? 0) + 1;
    }
    x.pending = keep;
  };
  const compareSnap = (x, state, snap) => {
    let same = 0;
    let total = 0;
    let first = null;
    for (const side of ['b', 'a']) {
      for (let i = 0; i < 20; i++) {
        const want = snap[side][i];
        if (!want) continue;
        total++;
        const got = state[side][i];
        if (got && got[0] === Number(want[0]) && got[1] === Number(want[1])) same++;
        else if (!first) first = { side, i, got, want };
      }
    }
    x.match.push({ same, total, touch: state.b[0]?.[0] === Number(snap.b[0]?.[0]) && state.a[0]?.[0] === Number(snap.a[0]?.[0]) });
    if (first) x.firstMismatch.push(`${first.side}${first.i}:${first.got?.[0] === Number(first.want[0]) ? 'size' : 'price'}`);
  };
  const topN = (side, desc, n) => [...side.entries()].sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, n);
  ws.on('message', (d) => {
    const at = Date.now();
    const { s, j } = parse(d);
    if (!j?.topic) {
      if (j?.id || s === 'pong') return;
      log('other', { s: s.slice(0, 200) });
      return;
    }
    const x = st[j.data?.s];
    if (!x) return;
    x.lagMs.push(at - j.data.t);
    if (j.topic === 'depth_update') {
      capture(`book-delta-${j.data.s}.jsonl`, s);
      x.deltas++;
      x.firstDeltaMs ??= at - t0;
      if (x.lastDeltaAt) x.maxDeltaMs = Math.max(x.maxDeltaMs, at - x.lastDeltaAt);
      x.lastDeltaAt = at;
      const pu = BigInt(j.data.pu);
      const fu = BigInt(j.data.fu);
      const u = BigInt(j.data.u);
      const k = String(fu - pu);
      x.fuMinusPu[k] = (x.fuMinusPu[k] ?? 0) + 1;
      if (x.lastU !== null && pu !== x.lastU) x.gaps++;
      x.lastU = u;
      x.deltaUs.push([fu, u]);
      const a = j.data.a ?? [];
      const b = j.data.b ?? [];
      if (!a.length && !b.length) x.emptyDeltas++;
      x.zeroSizes += [...a, ...b].filter(([, q]) => Number(q) === 0).length;
      if (b.some((l, i) => i > 0 && Number(l[0]) > Number(b[i - 1][0]))) x.bidUnordered++;
      if (a.some((l, i) => i > 0 && Number(l[0]) < Number(a[i - 1][0]))) x.askUnordered++;
      x.deltaLevelsMax = Math.max(x.deltaLevelsMax ?? 0, a.length, b.length);
      spelledTwice(x, [...a, ...b]);
      x.buffer.push({ fu, u, a, b });
      if (x.buffer.length > 60) x.buffer.shift();
      if (x.book) applyDelta(x, { fu, u, a, b });
    }
    if (j.topic === 'depth') {
      capture(`book-snap-${j.data.s}.jsonl`, s);
      x.snaps++;
      x.firstSnapMs ??= at - t0;
      const id = BigInt(j.data.id);
      if (x.snapIds.length && x.snapIds[x.snapIds.length - 1] === id) x.snapRepeatId++;
      x.snapIds.push(id);
      if (x.lastSnapAt) x.snapGapsMs.push(at - x.lastSnapAt);
      x.lastSnapAt = at;
      const a = j.data.a ?? [];
      const b = j.data.b ?? [];
      x.snapLevels.push([b.length, a.length]);
      spelledTwice(x, [...a, ...b]);
      if (b.every((l, i) => i === 0 || Number(l[0]) < Number(b[i - 1][0]))) x.snapBidsDesc++;
      if (a.every((l, i) => i === 0 || Number(l[0]) > Number(a[i - 1][0]))) x.snapAsksAsc++;
      // Where the snapshot id falls against the delta ranges seen so far.
      let where = 'after_all_deltas';
      for (const [fu, u] of x.deltaUs) {
        if (id === u) { where = 'equals_delta_u'; break; }
        if (id >= fu && id < u) { where = 'inside_delta'; break; }
      }
      if (where === 'after_all_deltas' && x.deltaUs.length && id < x.deltaUs[0][0]) where = 'before_first_delta';
      x.alignedAt[where] = (x.alignedAt[where] ?? 0) + 1;
      // The first snapshot seeds a kept book, buffered deltas newer than it are replayed, and every later snapshot is compared with the kept book at the same id.
      if (!x.book) {
        x.book = { b: new Map(b.map(([p, q]) => [Number(p), Number(q)])), a: new Map(a.map(([p, q]) => [Number(p), Number(q)])), u: id };
        x.bookInits = (x.bookInits ?? 0) + 1;
        for (const d of x.buffer) if (x.book) applyDelta(x, d);
      } else {
        const hit = x.states.find((r) => r.u === id);
        if (hit) compareSnap(x, hit, { b, a });
        else if (id > x.book.u) x.pending.push({ id, b, a });
        else x.snapNoBoundary = (x.snapNoBoundary ?? 0) + 1;
      }
    }
  });
  ws.send(sub(syms.flatMap((s) => [`depth_update@${s}`, `depth@${s},50`])));
  const pinger = setInterval(() => ws.send('ping'), 20_000);
  await sleep(60_000);
  clearInterval(pinger);
  ws.terminate();
  for (const s of syms) {
    const x = st[s];
    const m = x.match;
    log('book', {
      s,
      deltas: x.deltas,
      gaps: x.gaps,
      fuMinusPu: x.fuMinusPu,
      emptyDeltas: x.emptyDeltas,
      zeroSizes: x.zeroSizes,
      bidDeltaUnordered: x.bidUnordered,
      askDeltaUnordered: x.askUnordered,
      maxDeltaGapMs: x.maxDeltaMs,
      firstDeltaMs: x.firstDeltaMs,
      firstSnapMs: x.firstSnapMs,
      snaps: x.snaps,
      snapRepeatId: x.snapRepeatId,
      snapGapMs: { p50: pct(x.snapGapsMs, 50), max: pct(x.snapGapsMs, 100), min: pct(x.snapGapsMs, 0) },
      snapLevelsMinMax: [Math.min(...x.snapLevels.map((l) => l[0])), Math.max(...x.snapLevels.map((l) => l[0])), Math.min(...x.snapLevels.map((l) => l[1])), Math.max(...x.snapLevels.map((l) => l[1]))],
      snapBidsDesc: x.snapBidsDesc,
      snapAsksAsc: x.snapAsksAsc,
      snapIdVsDeltas: x.alignedAt,
      deltaLevelsMax: x.deltaLevelsMax,
      keptBook: { inits: x.bookInits ?? 0, breaks: x.bookBreaks ?? 0, snapsAtExactId: m.length, pendingAtEnd: x.pending.length, snapsWithNoBoundary: x.snapNoBoundary ?? 0, fullTop20Match: m.filter((r) => r.same === r.total).length, touchMatch: m.filter((r) => r.touch).length, medianSame: pct(m.map((r) => r.same), 50), medianTotal: pct(m.map((r) => r.total), 50) },
      firstMismatch: x.firstMismatch.slice(0, 12),
      priceSpelledTwice: x.priceSpelledTwice,
      priceSample: [...x.spellings.values()].slice(0, 4),
      lagMs: { p50: pct(x.lagMs, 50), p90: pct(x.lagMs, 90) },
    });
  }
}

async function modeAnchor() {
  const syms = ['btc_usdt', 'eth_usdt', 'doge_usdt'];
  const ws = await open();
  const t0 = Date.now();
  const per = {};
  const agg = { frames: [], seen: new Map(), prem: new Map() };
  const note = (k, s, at, v) => {
    per[k] ??= {};
    per[k][s] ??= { n: 0, changes: 0, last: null, gaps: [], lastAt: null, lag: [], sample: null };
    const r = per[k][s];
    r.n++;
    if (r.last !== null && r.last !== v) r.changes++;
    r.last = v;
    if (r.lastAt) r.gaps.push(at - r.lastAt);
    r.lastAt = at;
  };
  ws.on('message', (d) => {
    const at = Date.now();
    const { s, j } = parse(d);
    if (!j?.topic) return;
    if (j.topic === 'agg_tickers') {
      capture('anchor-agg.jsonl', s);
      agg.frames.push({ at: at - t0, n: j.data.length });
      for (const r of j.data) {
        agg.seen.set(r.s, (agg.seen.get(r.s) ?? 0) + 1);
        const i = Number(r.i);
        const m = Number(r.m);
        if (i > 0 && m > 0) agg.prem.set(r.s, { ppm: Math.round(((m - i) / i) * 1e6), markEqLast: r.m === r.c, markEqMid: Number(r.m) === (Number(r.bp) + Number(r.ap)) / 2 });
      }
      return;
    }
    const sym = j.data?.s;
    if (!syms.includes(sym)) return;
    capture(`anchor-${j.topic}.jsonl`, s);
    if (j.topic === 'fund_rate') {
      note('fund_rate', sym, at, j.data.r);
      per.fund_rate[sym].times = [...(per.fund_rate[sym].times ?? []), new Date(j.data.t).toISOString().slice(11, 23)];
    }
    if (j.topic === 'mark_price') note('mark_price', sym, at, j.data.p);
    if (j.topic === 'index_price') note('index_price', sym, at, j.data.p);
    if (j.topic === 'agg_ticker') note('agg_ticker_mark', sym, at, j.data.m);
    const r = per[j.topic === 'agg_ticker' ? 'agg_ticker_mark' : j.topic]?.[sym];
    if (r) {
      r.lag.push(at - j.data.t);
      r.sample ??= s.slice(0, 300);
    }
  });
  ws.send(sub(['agg_tickers']));
  ws.send(sub(syms.flatMap((s) => [`mark_price@${s}`, `index_price@${s}`, `fund_rate@${s}`, `agg_ticker@${s}`])));
  const pinger = setInterval(() => ws.send('ping'), 20_000);
  await sleep(65_000);
  clearInterval(pinger);
  ws.terminate();
  for (const [k, bySym] of Object.entries(per)) {
    for (const [s, r] of Object.entries(bySym)) {
      log('anchor_topic', { topic: k, s, frames: r.n, eventTimesUtc: r.times, valueChanges: r.changes, gapMs: { p50: pct(r.gaps, 50), max: pct(r.gaps, 100) }, lagMs: { p50: pct(r.lag, 50), max: pct(r.lag, 100) }, last: r.last, sample: r.sample });
    }
  }
  const prem = [...agg.prem.values()];
  const abs = prem.map((p) => Math.abs(p.ppm));
  const counts = [...agg.seen.values()];
  log('agg_tickers', {
    frames: agg.frames.length,
    rowsPerFrame: agg.frames.map((f) => f.n),
    frameAtMs: agg.frames.map((f) => f.at),
    symbolsSeen: agg.seen.size,
    timesSeenPerSymbol: { min: pct(counts, 0), p50: pct(counts, 50), max: pct(counts, 100) },
    premiumAbsPpm: { p50: pct(abs, 50), p90: pct(abs, 90), p99: pct(abs, 99), max: pct(abs, 100) },
    over1pct: abs.filter((v) => v > 10_000).length,
    markEqualsLast: prem.filter((p) => p.markEqLast).length,
    markEqualsMid: prem.filter((p) => p.markEqMid).length,
    widest: [...agg.prem.entries()].sort((a, b) => Math.abs(b[1].ppm) - Math.abs(a[1].ppm)).slice(0, 6).map(([s, p]) => `${s}:${p.ppm}`),
  });
}

// Each request is sent alone and replies are read for 1.2 s, because an error reply is plain text with no id.
async function modeErrors() {
  const ws = await open();
  let inbox = [];
  const t0 = Date.now();
  let invalidSoFar = 0;
  const firstOf = new Map();
  ws.on('message', (d) => {
    const { s, j } = parse(d);
    if (s === 'Invalid method') invalidSoFar++;
    if (s === 'pong' && keepalive) return;
    if (j?.topic && /icx|rcat/.test(j.event) && !firstOf.has(j.event)) {
      firstOf.set(j.event, s.slice(0, 300));
      log('delisted_frame', { event: j.event, frame: s.slice(0, 300) });
    }
    inbox.push(j?.topic ? `${j.event}` : s.slice(0, 200));
  });
  // The server drops a socket that has not sent a text ping for about 30 s, see the silence mode, so the case list pings every 15 s.
  let keepalive = false;
  const pinger = setInterval(() => { keepalive = true; ws.send('ping'); }, 15_000);
  let terminatedByProbe = false;
  ws.on('close', (code, reason) => log('errors_socket_closed', { atMs: Date.now() - t0, code, reason: reason.toString(), terminatedByProbe, invalidRepliesBefore: invalidSoFar }));
  const tryOne = async (label, frame, waitMs = 1_200) => {
    inbox = [];
    ws.send(frame);
    await sleep(waitMs);
    const events = {};
    const other = [];
    for (const m of inbox) {
      if (m.includes('@') && !m.startsWith('{')) events[m] = (events[m] ?? 0) + 1;
      else other.push(m);
    }
    log('error_case', { label, sent: frame.slice(0, 160), replies: other.slice(0, 3), streams: events });
  };
  await tryOne('ping text', 'ping');
  await tryOne('unknown symbol depth_update', sub(['depth_update@nope_usdt']));
  await tryOne('unknown symbol depth,50', sub(['depth@nope_usdt,50']));
  await tryOne('upper case symbol', sub(['depth_update@BTC_USDT']));
  for (const lv of [5, 10, 20, 30, 50, 100]) await tryOne(`depth level ${lv}`, sub([`depth@sol_usdt,${lv}`]), 2_200);
  await tryOne('depth 50 with 100ms', sub(['depth@xrp_usdt,50,100ms']), 2_200);
  await tryOne('depth_update 100ms explicit', sub(['depth_update@xrp_usdt,100ms']), 1_500);
  await tryOne('depth_update 250ms', sub(['depth_update@ada_usdt,250ms']), 1_500);
  await tryOne('depth_update 1000ms', sub(['depth_update@ada_usdt,1000ms']), 2_200);
  await tryOne('delisted 2026-09-18 icx_usdt', sub(['depth_update@icx_usdt']));
  await tryOne('delisted 2026-09-22 rcat_usdt', sub(['depth_update@rcat_usdt']));
  await tryOne('close-only until 2026-09-25 pipedog_usdt', sub(['depth_update@pipedog_usdt', 'depth@pipedog_usdt,50']), 2_200);
  await tryOne('batch with one unknown symbol in the middle', sub(['depth_update@ltc_usdt', 'depth_update@nope_usdt', 'depth_update@link_usdt']), 1_500);
  await tryOne('unknown topic', sub(['nonsense@btc_usdt']));
  await tryOne('all-symbol mark_price', sub(['mark_price']));
  await tryOne('duplicate subscribe', sub(['depth_update@xrp_usdt,100ms']), 1_000);
  await tryOne('lower case method', JSON.stringify({ id: 'lc', method: 'subscribe', params: ['ticker@btc_usdt'] }), 1_500);
  await tryOne('no method', JSON.stringify({ id: 'nm', params: ['ticker@btc_usdt'] }));
  await tryOne('not json', 'hello');
  await tryOne('unsubscribe the valid streams', sub(['depth@sol_usdt,5', 'depth@sol_usdt,10', 'depth@sol_usdt,20', 'depth@sol_usdt,50', 'depth@xrp_usdt,50,100ms', 'depth_update@xrp_usdt,100ms', 'depth_update@ada_usdt,250ms', 'depth_update@ada_usdt,1000ms', 'ticker@btc_usdt', 'depth_update@pipedog_usdt', 'depth@pipedog_usdt,50', 'depth_update@ltc_usdt', 'depth_update@link_usdt'], 'UNSUBSCRIBE'), 2_000);
  await tryOne('after unsubscribe', 'ping', 2_000);
  clearInterval(pinger);
  terminatedByProbe = true;
  ws.terminate();
  // A fresh socket sends one invalid subscription every 500 ms, to see whether invalid requests end the session.
  const bad = await open();
  const b0 = Date.now();
  let sent = 0;
  let badReplies = 0;
  let badClosed = null;
  bad.on('message', (d) => { if (d.toString() === 'Invalid method') badReplies++; });
  bad.on('close', (code, reason) => { badClosed = { atMs: Date.now() - b0, code, reason: reason.toString(), sent, badReplies }; });
  while (!badClosed && sent < 15) {
    bad.send(sub([`depth_update@nope${sent}_usdt`]));
    sent++;
    await sleep(500);
  }
  await sleep(1_500);
  if (!badClosed) bad.terminate();
  log('invalid_burst', { closed: badClosed ?? `open after ${sent} invalid requests`, badReplies });
  // Spot is only named in the coverage matrix, so one subscribe proves the spot socket exists.
  try {
    const sp = await open(SPOT_URL);
    let first = [];
    sp.on('message', (d) => first.push(d.toString().slice(0, 240)));
    sp.send(JSON.stringify({ id: 's1', method: 'subscribe', params: ['depth@btc_usdt,20'] }));
    await sleep(2_500);
    sp.terminate();
    log('spot_socket', { url: SPOT_URL, openMs: sp.openMs, frames: first.length, first: first.slice(0, 2) });
  } catch (e) {
    log('spot_socket', { url: SPOT_URL, error: e.message });
  }
}

async function modeBatch() {
  const { tick } = await readCatalog(4_000);
  const syms = pickSymbols(tick, 150);
  const ws = await open();
  const acks = [];
  const invalid = [];
  const st = new Map(syms.map((s) => [s, { n: 0, gaps: 0, lastU: null }]));
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSec = new Map();
  const t0 = Date.now();
  ws.on('message', (d) => {
    const at = Date.now();
    const s = d.toString();
    const p0 = process.hrtime.bigint();
    let j = null;
    if (s === 'pong') return;
    try { j = JSON.parse(s); } catch { invalid.push(s.slice(0, 100)); return; }
    parseNs += process.hrtime.bigint() - p0;
    if (!j.topic) { if (j.id) acks.push({ ms: at - t0, code: j.code }); return; }
    frames++;
    bytes += d.length;
    const sec = Math.floor((at - t0) / 1000);
    perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
    const x = st.get(j.data.s);
    if (!x) return;
    x.n++;
    const pu = BigInt(j.data.pu);
    if (x.lastU !== null && pu !== x.lastU) x.gaps++;
    x.lastU = BigInt(j.data.u);
  });
  ws.send(sub(syms.map((s) => `depth_update@${s}`)));
  const pinger = setInterval(() => ws.send('ping'), 20_000);
  await sleep(45_000);
  clearInterval(pinger);
  ws.terminate();
  const rates = [...perSec.entries()].filter(([s]) => s >= 2 && s < 44).map(([, n]) => n);
  const counts = [...st.values()].map((x) => x.n);
  log('batch', {
    streams: syms.length,
    openMs: ws.openMs,
    acks,
    nonJsonReplies: invalid.length,
    nonJsonSample: invalid.slice(0, 2),
    streamsDelivering: counts.filter((n) => n > 0).length,
    silentStreams: syms.filter((s) => st.get(s).n === 0).slice(0, 10),
    gaps: [...st.values()].reduce((a, x) => a + x.gaps, 0),
    frames,
    framesPerSec: { mean: Math.round(frames / 45), p50: pct(rates, 50), max: pct(rates, 100) },
    bytesPerSec: Math.round(bytes / 45),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: Number(parseNs / BigInt(Math.max(1, frames))) / 1000,
  });
}

async function modeSilence() {
  const { tick } = await readCatalog(4_000);
  const usdt = [...tick.values()].filter((r) => r.s.endsWith('_usdt')).sort((a, b) => Number(a.v) - Number(b.v));
  const quiet = usdt[3]?.s;
  log('silence_symbol', { quiet, usdVol: Number(usdt[3]?.v) });
  const cases = [
    { name: 'no sub, no client frame', subscribe: false, ping: 0 },
    { name: 'quiet sub, no client frame', subscribe: true, ping: 0 },
    { name: 'no sub, text ping every 20 s', subscribe: false, ping: 20_000 },
    { name: 'quiet sub, text ping every 20 s', subscribe: true, ping: 20_000 },
    { name: 'quiet sub, text ping every 20 s, unsubscribe at 10 s', subscribe: true, ping: 20_000, unsubscribeAt: 10_000 },
  ];
  const HOLD = 70_000;
  await Promise.all(
    cases.map(async (c) => {
      const ws = await open();
      const t0 = Date.now();
      let serverPings = 0;
      let frames = 0;
      let lastFrameAt = t0;
      let maxQuietMs = 0;
      let closed = null;
      let pongMs = [];
      let sentAt = 0;
      ws.on('ping', () => serverPings++);
      ws.on('message', (d) => {
        const now = Date.now();
        frames++;
        maxQuietMs = Math.max(maxQuietMs, now - lastFrameAt);
        lastFrameAt = now;
        if (d.toString() === 'pong' && sentAt) pongMs.push(now - sentAt);
      });
      ws.on('close', (code, reason) => { closed = { atMs: Date.now() - t0, code, reason: reason.toString() }; });
      if (c.subscribe) ws.send(sub([`depth_update@${quiet}`]));
      if (c.unsubscribeAt) setTimeout(() => ws.readyState === ws.OPEN && ws.send(sub([`depth_update@${quiet}`], 'UNSUBSCRIBE')), c.unsubscribeAt);
      const timer = c.ping ? setInterval(() => { sentAt = Date.now(); if (ws.readyState === ws.OPEN) ws.send('ping'); }, c.ping) : null;
      while (!closed && Date.now() - t0 < HOLD) await sleep(250);
      if (timer) clearInterval(timer);
      if (!closed) ws.terminate();
      log('silence', { case: c.name, closed: closed ?? `open at ${HOLD} ms`, serverProtocolPings: serverPings, frames, maxQuietMs, pongMs });
    }),
  );
}

async function modeDeflate() {
  const ws = await open(FUT_URL, { deflate: true });
  log('deflate', { offered: 'permessage-deflate', negotiated: ws.negotiated, openMs: ws.openMs });
  let bin = 0;
  let text = 0;
  ws.on('message', (_d, isBinary) => (isBinary ? bin++ : text++));
  ws.send(sub(['depth_update@btc_usdt']));
  await sleep(2_000);
  ws.terminate();
  const plain = await open(FUT_URL);
  log('deflate', { offered: 'none', negotiated: plain.negotiated, openMs: plain.openMs, framesWithDeflateSocket: { text, binary: bin } });
  plain.terminate();
}

const modes = { catalog: modeCatalog, book: modeBook, anchor: modeAnchor, errors: modeErrors, batch: modeBatch, silence: modeSilence, deflate: modeDeflate };
const mode = process.argv[2] ?? 'catalog';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
