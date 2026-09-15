// Read-only WebSocket probe of Gemini perpetual market data on the current socket at ws.gemini.com and the archived v1 and v2 sockets at api.gemini.com.
// It checks the depth snapshot and the documented U and u overlap rule on every frame, level order, size unit against the REST book, idle repeats, keepalive, unknown symbols, and the mark and funding streams.
// Run from server/: OUT=<dir> WINDOW_S=75 node ../scripts/probes/gemini-ws-probe.mjs [sections]
// Sections default to depth,streams,snapN,v2,v1,idle,deflate, and they run concurrently. OUT, when set, receives one JSON file per section.
// Recorded in docs/profiles/gemini/websocket.md and docs/profiles/gemini/rest.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

// Package resolution follows the importing file, so the server's node_modules is named explicitly.
const WebSocket = createRequire(new URL('../../server/package.json', import.meta.url))('ws');

const OUT = process.env.OUT;
const WINDOW_MS = Number(process.env.WINDOW_S ?? 75) * 1000;
const IDLE_MS = Number(process.env.IDLE_S ?? 130) * 1000;
const SECTIONS = (process.argv[2] ?? 'depth,streams,snapN,v2,v1,idle,deflate').split(',');
const PERPS = ['avaxgusdperp', 'avaxusdcperp', 'btcgusdperp', 'btcusdcperp', 'ethgusdperp', 'ethusdcperp', 'hypegusdperp', 'hypeusdcperp', 'solgusdperp', 'solusdcperp', 'trumpgusdperp', 'xrpgusdperp', 'xrpusdcperp'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 600) => (s.length > n ? `${s.slice(0, n)}...(${s.length} chars)` : s);

function save(name, data) {
  const text = JSON.stringify(data);
  console.log(JSON.stringify({ section: name, ...(text.length < 5000 ? { data } : { bytes: text.length, note: 'full result in OUT' }) }));
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/ws-${name}.json`, JSON.stringify(data, null, 2));
  }
}

function open(url, options = { perMessageDeflate: false }) {
  const ws = new WebSocket(url, options);
  const info = { url, t0: Date.now(), serverPings: [], closes: [], errors: [], binaryFrames: 0 };
  ws.on('upgrade', (res) => (info.upgrade = { status: res.statusCode, headers: res.headers, ms: Date.now() - info.t0 }));
  ws.on('unexpected-response', (_req, res) => (info.unexpected = res.statusCode));
  ws.on('open', () => (info.openMs = Date.now() - info.t0));
  ws.on('ping', () => info.serverPings.push(Date.now() - info.t0));
  ws.on('close', (code, reason) => info.closes.push({ code, reason: reason.toString(), ms: Date.now() - info.t0 }));
  ws.on('error', (e) => info.errors.push(e.message));
  ws.on('message', (_d, isBinary) => isBinary && info.binaryFrames++);
  const ready = new Promise((resolve) => {
    ws.once('open', resolve);
    ws.once('close', resolve);
  });
  return { ws, info, ready };
}

function sortedDesc(levels) {
  for (let i = 1; i < levels.length; i++) if (Number(levels[i][0]) >= Number(levels[i - 1][0])) return false;
  return true;
}

function sortedAsc(levels) {
  for (let i = 1; i < levels.length; i++) if (Number(levels[i][0]) <= Number(levels[i - 1][0])) return false;
  return true;
}

async function restBook(symbol) {
  const r = await fetch(`https://api.gemini.com/v1/book/${symbol}?limit_bids=20&limit_asks=20`, { headers: { accept: 'application/json' } });
  return r.json();
}

// The recommended book: the differential stream with a full snapshot on subscribe, every perpetual on one connection.
async function depth() {
  const { ws, info, ready } = open('wss://ws.gemini.com?snapshot=-1');
  await ready;
  const per = new Map(PERPS.map((s) => [s, { frames: 0, bytes: 0, snapshot: null, lastU: null, overlapEqual: 0, overlapInside: 0, stale: 0, gaps: [], uBelowU: 0, emptyFrames: 0, zeroLevels: 0, unsortedBidFrames: 0, unsortedAskFrames: 0, crossed: 0, lastAt: 0, maxSilenceMs: 0, minIntervalMs: Infinity, bids: new Map(), asks: new Map(), firstDeltas: [] }]));
  const out = { frames: [], ack: null, ackBeforeSnapshot: null, pings: [], unknownRoute: [], total: { frames: 0, bytes: 0 }, restCompare: [] };
  let sentAt = 0;
  const pending = new Map();

  ws.on('message', (d) => {
    const now = Date.now();
    const text = d.toString();
    out.total.frames++;
    out.total.bytes += d.length;
    const j = JSON.parse(text);
    if (j.id !== undefined) {
      if (j.id === 1) {
        out.ack = { text, ms: now - sentAt };
        if (out.ackBeforeSnapshot === null) out.ackBeforeSnapshot = true;
      } else if (pending.has(j.id)) {
        out.pings.push({ rttMs: now - pending.get(j.id), text });
        pending.delete(j.id);
      }
      return;
    }
    if (j.e !== 'depthUpdate') {
      if (out.unknownRoute.length < 5) out.unknownRoute.push(clip(text, 300));
      return;
    }
    const p = per.get(j.s);
    if (p === undefined) {
      if (out.unknownRoute.length < 5) out.unknownRoute.push(clip(text, 300));
      return;
    }
    if (out.ackBeforeSnapshot === null) out.ackBeforeSnapshot = false;
    p.frames++;
    p.bytes += d.length;
    if (p.lastAt > 0) {
      p.maxSilenceMs = Math.max(p.maxSilenceMs, now - p.lastAt);
      p.minIntervalMs = Math.min(p.minIntervalMs, now - p.lastAt);
    }
    p.lastAt = now;
    if (p.snapshot === null) {
      p.snapshot = { ms: now - sentAt, bytes: d.length, bids: j.b.length, asks: j.a.length, bidsDesc: sortedDesc(j.b), asksAsc: sortedAsc(j.a), U: j.U, u: j.u, bestBid: j.b[0], bestAsk: j.a[0], worstBid: j.b.at(-1), worstAsk: j.a.at(-1), E: j.E, text: clip(text, 500) };
      for (const [px, sz] of j.b) p.bids.set(px, sz);
      for (const [px, sz] of j.a) p.asks.set(px, sz);
      p.lastU = j.u;
      if (out.frames.length < 2) out.frames.push({ kind: 'snapshot', text: clip(text, 900) });
      return;
    }
    if (j.u < j.U) p.uBelowU++;
    if (j.U === p.lastU) p.overlapEqual++;
    else if (j.U < p.lastU && j.u > p.lastU) p.overlapInside++;
    else if (j.u <= p.lastU) p.stale++;
    else if (j.U > p.lastU) p.gaps.push({ lastU: p.lastU, U: j.U, u: j.u });
    p.lastU = Math.max(p.lastU, j.u);
    if (j.b.length === 0 && j.a.length === 0) p.emptyFrames++;
    if (j.b.length > 1 && !sortedDesc(j.b)) p.unsortedBidFrames++;
    if (j.a.length > 1 && !sortedAsc(j.a)) p.unsortedAskFrames++;
    for (const [px, sz] of j.b) {
      if (Number(sz) === 0) { p.zeroLevels++; p.bids.delete(px); } else p.bids.set(px, sz);
    }
    for (const [px, sz] of j.a) {
      if (Number(sz) === 0) { p.zeroLevels++; p.asks.delete(px); } else p.asks.set(px, sz);
    }
    const bb = Math.max(...[...p.bids.keys()].map(Number));
    const ba = Math.min(...[...p.asks.keys()].map(Number));
    if (p.bids.size && p.asks.size && bb >= ba) p.crossed++;
    if (p.firstDeltas.length < 3) p.firstDeltas.push({ recvLagMsVsE: now - Math.round(j.E / 1e6), text: clip(text, 400) });
    if (out.frames.length < 6 && out.frames.length >= 2) out.frames.push({ kind: 'delta', text: clip(text, 500) });
  });

  sentAt = Date.now();
  ws.send(JSON.stringify({ id: 1, method: 'subscribe', params: PERPS.map((s) => `${s}@depth@100ms`) }));
  const pingTimer = setInterval(() => {
    const id = 100 + out.pings.length + pending.size;
    pending.set(id, Date.now());
    ws.send(JSON.stringify({ id, method: 'ping' }));
  }, 15000);

  // Midway, the maintained books are compared with the REST book to confirm the size unit and the level set.
  await sleep(WINDOW_MS / 2);
  for (const s of ['btcgusdperp', 'trumpgusdperp', 'ethgusdperp']) {
    const rest = await restBook(s);
    const p = per.get(s);
    // The socket pads prices and sizes with trailing zeros, so levels are matched by numeric value.
    const wsLevels = new Map([...p.bids, ...p.asks].map(([px, sz]) => [Number(px), Number(sz)]));
    const restLevels = [...rest.bids, ...rest.asks];
    const samePrice = restLevels.filter((l) => wsLevels.has(Number(l.price)));
    const sameSize = samePrice.filter((l) => wsLevels.get(Number(l.price)) === Number(l.amount));
    out.restCompare.push({ symbol: s, restTopBid: rest.bids[0], restTopAsk: rest.asks[0], wsTopBid: topOf(p.bids, 'bid'), wsTopAsk: topOf(p.asks, 'ask'), restLevels: restLevels.length, wsLevels: wsLevels.size, restPricesInWs: samePrice.length, restPricesWithEqualSize: sameSize.length });
    await sleep(700);
  }
  await sleep(WINDOW_MS / 2 - 2500);
  clearInterval(pingTimer);
  ws.close();
  await sleep(500);

  const windowS = WINDOW_MS / 1000;
  const symbols = {};
  for (const [s, p] of per) {
    symbols[s] = { frames: p.frames, framesPerS: +(p.frames / windowS).toFixed(2), bytes: p.bytes, snapshot: p.snapshot, overlapEqual: p.overlapEqual, overlapInside: p.overlapInside, stale: p.stale, gaps: p.gaps.length, gapSamples: p.gaps.slice(0, 3), uBelowU: p.uBelowU, emptyFrames: p.emptyFrames, zeroLevels: p.zeroLevels, unsortedBidFrames: p.unsortedBidFrames, unsortedAskFrames: p.unsortedAskFrames, crossedAfterApply: p.crossed, minIntervalMs: p.minIntervalMs === Infinity ? null : p.minIntervalMs, maxSilenceMs: p.maxSilenceMs, bookLevelsAtEnd: [p.bids.size, p.asks.size], topAtEnd: [topOf(p.bids, 'bid'), topOf(p.asks, 'ask')], firstDeltas: p.firstDeltas };
  }
  const g = per.get('btcgusdperp');
  const c = per.get('btcusdcperp');
  out.btcGusdVsUsdcAtEnd = { gusdTop: [topOf(g.bids, 'bid'), topOf(g.asks, 'ask')], usdcTop: [topOf(c.bids, 'bid'), topOf(c.asks, 'ask')], sameLevelCount: [...g.bids].filter(([px, sz]) => c.bids.get(px) === sz).length, gusdLevels: g.bids.size, usdcLevels: c.bids.size, gusdLastU: g.lastU, usdcLastU: c.lastU };
  save('depth', { info, windowS, total: { ...out.total, perS: +(out.total.frames / windowS).toFixed(1), bytesPerS: Math.round(out.total.bytes / windowS) }, ack: out.ack, ackBeforeSnapshot: out.ackBeforeSnapshot, pings: out.pings, unknownRoute: out.unknownRoute, frames: out.frames, restCompare: out.restCompare, btcGusdVsUsdcAtEnd: out.btcGusdVsUsdcAtEnd, symbols });
}

function topOf(side, kind) {
  let best = null;
  for (const [px, sz] of side) {
    const n = Number(px);
    if (best === null || (kind === 'bid' ? n > Number(best[0]) : n < Number(best[0]))) best = [px, sz];
  }
  return best;
}

// Every other public stream, briefly, on one connection without the snapshot parameter.
async function streams() {
  const { ws, info, ready } = open('wss://ws.gemini.com');
  await ready;
  const replies = [];
  const kinds = new Map();
  const mark = new Map();
  ws.on('message', (d) => {
    const now = Date.now();
    const text = d.toString();
    const j = JSON.parse(text);
    if (j.id !== undefined) {
      replies.push({ ms: now - info.t0, text: clip(text, 700) });
      return;
    }
    let kind;
    if (j.e === 'depthUpdate') kind = 'depthUpdate';
    else if (j.e) kind = j.e;
    else if (j.lastUpdateId !== undefined) kind = `partial:${j.bids.length}x${j.asks.length}`.replace(/\d+x\d+/, 'depthN');
    else if (j.b !== undefined && j.B !== undefined) kind = 'bookTicker';
    else if (j.t !== undefined && j.p !== undefined) kind = 'trade';
    else kind = Object.keys(j).join(',');
    const key = `${kind}|${j.s ?? j.symbol ?? '?'}`;
    const k = kinds.get(key) ?? { n: 0, bytes: 0, first: clip(text, 700), firstMs: now - info.t0, identicalRepeats: 0, last: '', intervals: [] , lastAt: 0};
    k.n++;
    k.bytes += d.length;
    if (text === k.last) k.identicalRepeats++;
    if (k.lastAt && k.intervals.length < 40) k.intervals.push(now - k.lastAt);
    k.lastAt = now;
    k.last = text;
    kinds.set(key, k);
    if (j.e === 'markPrice') {
      const m = mark.get(j.s) ?? { n: 0, pChanges: 0, iChanges: 0, lastP: null, lastI: null, samples: [] };
      m.n++;
      if (m.lastP !== null && m.lastP !== j.p) m.pChanges++;
      if (m.lastI !== null && m.lastI !== j.i) m.iChanges++;
      m.lastP = j.p;
      m.lastI = j.i;
      if (m.samples.length < 2) m.samples.push(text);
      mark.set(j.s, m);
    }
  });
  const send = (id, method, params) => ws.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }));
  send(1, 'subscribe', ['btcgusdperp@depth@100ms', 'btcgusdperp@depth', 'BTCGUSDPERP@bookTicker', 'trumpgusdperp@bookTicker', 'btcgusdperp@depth20', 'trumpgusdperp@depth20@100ms', 'btcgusdperp@trade']);
  send(2, 'subscribe', PERPS.map((s) => `${s}@markPrice`));
  send(3, 'subscribe', PERPS.map((s) => `${s}@fundingAmount`));
  send(4, 'subscribe', ['nosuchperp@depth@100ms']);
  send(5, 'subscribe', ['ethgusdperp@depth20', 'nosuchperp@depth20', 'nosuchperp2@depth20']);
  send(6, 'list_subscriptions');
  send(7, 'conninfo');
  const tSend = Date.now();
  send(8, 'time');
  send(9, 'depth', { symbol: 'btcgusdperp', limit: 5 });
  send(10, 'subscribe', ['btcgusdperp@markPrice@1s']);
  send(11, 'bogus_method');
  await sleep(4000);
  // The mark stream's i field is compared with the REST index to see its scale.
  const rest = {};
  for (const s of ['btcgusdperp', 'trumpgusdperp', 'ethgusdperp', 'xrpgusdperp']) {
    rest[s] = await (await fetch(`https://api.gemini.com/v1/riskstats/${s}`)).json();
    await sleep(700);
  }
  await sleep(Math.max(0, WINDOW_MS - 7000));
  ws.close();
  await sleep(500);
  const timeReply = replies.find((r) => r.text.includes('serverTime'));
  const markVsRest = {};
  for (const [s, m] of mark) {
    const r = rest[s];
    markVsRest[s] = { ...m, restMark: r?.mark_price, restIndex: r?.index_price, iOverRestIndex: r ? Number(m.lastI) / Number(r.index_price) : null, pOverRestMark: r ? Number(m.lastP) / Number(r.mark_price) : null };
  }
  const kindsOut = {};
  for (const [k, v] of kinds) kindsOut[k] = { n: v.n, bytes: v.bytes, firstMs: v.firstMs, identicalRepeats: v.identicalRepeats, medianIntervalMs: v.intervals.sort((a, b) => a - b)[Math.floor(v.intervals.length / 2)] ?? null, first: v.first };
  save('streams', { info, windowS: WINDOW_MS / 1000, sentTimeAt: tSend, replies, timeReply, kinds: kindsOut, markVsRest });
}

// A positive snapshot parameter asks for the top N levels.
async function snapN() {
  const results = [];
  for (const n of [20, 0]) {
    const { ws, info, ready } = open(`wss://ws.gemini.com?snapshot=${n}`);
    await ready;
    const frames = [];
    ws.on('message', (d) => frames.length < 3 && frames.push(clip(d.toString(), 300)));
    ws.send(JSON.stringify({ id: 1, method: 'subscribe', params: ['btcgusdperp@depth@100ms', 'ethgusdperp@depth@100ms'] }));
    await sleep(4000);
    ws.close();
    const first = frames.map((f) => f).find((f) => f.includes('depthUpdate'));
    results.push({ snapshotParam: n, openMs: info.openMs, first3: frames, firstDepthLevels: first ? (() => { try { const j = JSON.parse(first.split('...(')[0]); return [j.b.length, j.a.length]; } catch { return 'clipped'; } })() : null });
    await sleep(500);
  }
  save('snapN', results);
}

// The archived v2 socket, which still carries the documented mark_price and funding_amount feeds.
async function v2() {
  const { ws, info, ready } = open('wss://api.gemini.com/v2/marketdata');
  await ready;
  const upper = PERPS.map((s) => s.toUpperCase());
  const per = new Map();
  const other = [];
  const heartbeats = [];
  let l2 = { initial: null, updates: 0, trades: 0, perSymbol: {} };
  ws.on('message', (d) => {
    const now = Date.now();
    const text = d.toString();
    const j = JSON.parse(text);
    if (j.type === 'heartbeat') {
      heartbeats.push({ ms: now - info.t0, text });
      return;
    }
    if (j.type === 'mark_price_updates' || j.type === 'funding_amount_updates') {
      const p = per.get(j.symbol) ?? { mark: { n: 0, markChanges: 0, indexChanges: 0, last: null, intervals: [], lastAt: 0, first: null }, funding: { n: 0, amountChanges: 0, rateChanges: 0, last: null, intervals: [], lastAt: 0, first: null, rateOverAmountOverMark: [], realized: {}, fundingDateTimes: new Set(), intervalMinutes: new Set() } };
      const bucket = j.type === 'mark_price_updates' ? p.mark : p.funding;
      bucket.n++;
      if (bucket.lastAt && bucket.intervals.length < 40) bucket.intervals.push(now - bucket.lastAt);
      bucket.lastAt = now;
      if (bucket.first === null) bucket.first = clip(text, 600);
      for (const c of j.changes) {
        if (j.type === 'mark_price_updates') {
          if (bucket.last) {
            if (bucket.last.mark_price !== c.mark_price) bucket.markChanges++;
            if (bucket.last.spot_index !== c.spot_index) bucket.indexChanges++;
          }
        } else {
          if (bucket.last) {
            if (bucket.last.funding_amount !== c.funding_amount) bucket.amountChanges++;
            if (bucket.last.funding_rate !== c.funding_rate) bucket.rateChanges++;
          }
          bucket.realized[c.is_realized] = (bucket.realized[c.is_realized] ?? 0) + 1;
          bucket.fundingDateTimes.add(c.funding_date_time);
          bucket.intervalMinutes.add(c.funding_interval_in_minutes);
          if (bucket.rateOverAmountOverMark.length < 6) bucket.rateOverAmountOverMark.push({ rate: c.funding_rate, amount: c.funding_amount, mark: c.mark_price, amountOverMarkPct: (Number(c.funding_amount) / Number(c.mark_price)) * 100, ts: c.timestamp });
          if (c.is_realized === true && !bucket.realizedSample) bucket.realizedSample = clip(text, 600);
        }
        bucket.last = c;
      }
      per.set(j.symbol, p);
      return;
    }
    if (j.type === 'l2_updates') {
      const s = (l2.perSymbol[j.symbol] ??= { frames: 0, changes: 0, first: null });
      s.frames++;
      s.changes += j.changes.length;
      if (s.first === null) {
        const bids = j.changes.filter((c) => c[0] === 'buy');
        const asks = j.changes.filter((c) => c[0] === 'sell');
        s.first = { changes: j.changes.length, bids: bids.length, asks: asks.length, trades: j.trades?.length ?? 0, bidsDesc: sortedDesc(bids.map((c) => [c[1], c[2]])), asksAsc: sortedAsc(asks.map((c) => [c[1], c[2]])), keys: Object.keys(j), text: clip(text, 500) };
      } else if (!s.delta) s.delta = clip(text, 300);
      return;
    }
    if (j.type === 'trade') {
      l2.trades++;
      return;
    }
    if (other.length < 8) other.push({ ms: now - info.t0, text: clip(text, 400) });
  });
  ws.send(JSON.stringify({ type: 'subscribe', subscriptions: [{ name: 'l2', symbols: ['BTCGUSDPERP', 'TRUMPGUSDPERP'] }, { name: 'mark_price', symbols: upper }, { name: 'funding_amount', symbols: upper }] }));
  await sleep(3000);
  ws.send(JSON.stringify({ type: 'subscribe', subscriptions: [{ name: 'mark_price', symbols: ['NOSUCHPERP'] }] }));
  ws.send(JSON.stringify({ type: 'subscribe', subscriptions: [{ name: 'l2', symbols: ['btcgusdperp'] }] }));
  await sleep(WINDOW_MS - 3000);
  ws.close();
  await sleep(500);
  const symbols = {};
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? null;
  for (const [s, p] of per) {
    symbols[s] = {
      mark: { n: p.mark.n, markChanges: p.mark.markChanges, indexChanges: p.mark.indexChanges, medianIntervalMs: med(p.mark.intervals), last: p.mark.last, first: p.mark.first },
      funding: { n: p.funding.n, amountChanges: p.funding.amountChanges, rateChanges: p.funding.rateChanges, medianIntervalMs: med(p.funding.intervals), realized: p.funding.realized, fundingDateTimes: [...p.funding.fundingDateTimes], intervalMinutes: [...p.funding.intervalMinutes], samples: p.funding.rateOverAmountOverMark, realizedSample: p.funding.realizedSample ?? null, first: p.funding.first },
    };
  }
  const hbIntervals = heartbeats.slice(1).map((h, i) => h.ms - heartbeats[i].ms);
  save('v2', { info, windowS: WINDOW_MS / 1000, heartbeats: { n: heartbeats.length, medianIntervalMs: med(hbIntervals), first: heartbeats[0]?.text }, l2, other, symbols });
}

// The archived v1 per-symbol socket, for its socket_sequence rule on a perpetual.
async function v1() {
  const { ws, info, ready } = open('wss://api.gemini.com/v1/marketdata/BTCGUSDPERP?heartbeat=true');
  await ready;
  const seqs = [];
  const firsts = [];
  let gaps = 0;
  ws.on('message', (d) => {
    const j = JSON.parse(d.toString());
    if (firsts.length < 3) firsts.push(clip(d.toString(), 400));
    if (seqs.length && j.socket_sequence !== seqs.at(-1) + 1) gaps++;
    seqs.push(j.socket_sequence);
  });
  await sleep(12000);
  ws.close();
  await sleep(300);
  save('v1', { info, frames: seqs.length, firstSequence: seqs[0], lastSequence: seqs.at(-1), gaps, firsts });
}

// A connection that subscribes nothing and sends nothing, to see whether the server pings, repeats or closes it.
async function idle() {
  const { ws, info, ready } = open('wss://ws.gemini.com');
  await ready;
  let frames = 0;
  ws.on('message', () => frames++);
  const quiet = open('wss://ws.gemini.com');
  await quiet.ready;
  let quietFrames = 0;
  let quietLast = 0;
  let quietMaxGap = 0;
  quiet.ws.on('message', () => {
    const now = Date.now();
    if (quietLast) quietMaxGap = Math.max(quietMaxGap, now - quietLast);
    quietLast = now;
    quietFrames++;
  });
  quiet.ws.send(JSON.stringify({ id: 1, method: 'subscribe', params: ['avaxusdcperp@depth@100ms'] }));
  await sleep(IDLE_MS);
  const stillOpen = ws.readyState === WebSocket.OPEN;
  const quietOpen = quiet.ws.readyState === WebSocket.OPEN;
  ws.close();
  quiet.ws.close();
  await sleep(500);
  save('idle', { idleS: IDLE_MS / 1000, noSubscription: { info, frames, stillOpen }, quietSubscriptionNoPings: { info: quiet.info, frames: quietFrames, maxGapMs: quietMaxGap, stillOpen: quietOpen } });
}

// Offers permessage-deflate to both hosts to see whether either negotiates it.
async function deflate() {
  const out = [];
  for (const url of ['wss://ws.gemini.com', 'wss://api.gemini.com/v2/marketdata']) {
    const offered = open(url, { perMessageDeflate: true });
    await offered.ready;
    const refused = open(url, { perMessageDeflate: false });
    await refused.ready;
    out.push({ url, offeredExtensions: offered.ws.extensions, offeredHeader: offered.info.upgrade?.headers['sec-websocket-extensions'] ?? null, refusedExtensions: refused.ws.extensions, openMs: [offered.info.openMs, refused.info.openMs] });
    offered.ws.close();
    refused.ws.close();
    await sleep(500);
  }
  save('deflate', out);
}

// Watches one hourly settlement: both funding streams and the REST funding call every 10 s for SETTLE_S seconds, so start it about a minute before the hour.
// Run on its own: SETTLE_S=180 node ../scripts/probes/gemini-ws-probe.mjs settle
async function settle() {
  const settleMs = Number(process.env.SETTLE_S ?? 180) * 1000;
  const events = [];
  const t0 = Date.now();
  const cur = open('wss://ws.gemini.com');
  const old = open('wss://api.gemini.com/v2/marketdata');
  await Promise.all([cur.ready, old.ready]);
  cur.ws.on('message', (d) => {
    const j = JSON.parse(d.toString());
    if (j.e === 'fundingAmount') events.push({ at: new Date().toISOString(), src: 'ws.gemini.com', text: d.toString() });
  });
  old.ws.on('message', (d) => {
    const j = JSON.parse(d.toString());
    if (j.type === 'funding_amount_updates') events.push({ at: new Date().toISOString(), src: 'v2', text: d.toString() });
  });
  cur.ws.send(JSON.stringify({ id: 1, method: 'subscribe', params: ['btcgusdperp@fundingAmount', 'trumpgusdperp@fundingAmount'] }));
  old.ws.send(JSON.stringify({ type: 'subscribe', subscriptions: [{ name: 'funding_amount', symbols: ['BTCGUSDPERP', 'TRUMPGUSDPERP'] }] }));
  while (Date.now() - t0 < settleMs) {
    const started = Date.now();
    const r = await fetch('https://api.gemini.com/v1/fundingamount/btcgusdperp').then((x) => x.json()).catch((e) => ({ error: e.message }));
    events.push({ at: new Date().toISOString(), src: 'rest', ms: Date.now() - started, text: JSON.stringify(r) });
    await sleep(Math.max(0, 10000 - (Date.now() - started)));
  }
  cur.ws.close();
  old.ws.close();
  await sleep(300);
  save('settle', events);
}

// Compares the archived v2 mark and spot index with the REST riskstats reading of the same moment, one symbol every 5 s.
// Run on its own: node ../scripts/probes/gemini-ws-probe.mjs anchorcheck
async function anchorcheck() {
  const { ws, ready } = open('wss://api.gemini.com/v2/marketdata');
  await ready;
  const latest = new Map();
  ws.on('message', (d) => {
    const j = JSON.parse(d.toString());
    if (j.type === 'mark_price_updates') latest.set(j.symbol, { ...j.changes.at(-1), at: Date.now() });
  });
  const gusd = PERPS.filter((s) => s.includes('gusd'));
  ws.send(JSON.stringify({ type: 'subscribe', subscriptions: [{ name: 'mark_price', symbols: gusd.map((s) => s.toUpperCase()) }] }));
  await sleep(6000);
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const s = gusd[i % gusd.length];
    const r = await (await fetch(`https://api.gemini.com/v1/riskstats/${s}`)).json();
    const v = latest.get(s.toUpperCase());
    rows.push({ symbol: s, restMark: r.mark_price, restIndex: r.index_price, v2Mark: v?.mark_price ?? null, v2Index: v?.spot_index ?? null, v2AgeMs: v ? Date.now() - v.at : null, markDiffPpm: v ? Math.round((Number(v.mark_price) / Number(r.mark_price) - 1) * 1e6) : null, indexDiffPpm: v ? Math.round((Number(v.spot_index) / Number(r.index_price) - 1) * 1e6) : null });
    await sleep(5000);
  }
  ws.close();
  await sleep(300);
  save('anchorcheck', rows);
}

const RUN = { depth, streams, snapN, v2, v1, idle, deflate, settle, anchorcheck };
const began = Date.now();
await Promise.all(SECTIONS.map(async (name) => {
  try {
    await RUN[name]();
  } catch (e) {
    console.log(JSON.stringify({ section: name, error: String(e.stack ?? e).slice(0, 500) }));
  }
}));
console.log(JSON.stringify({ done: true, wallMs: Date.now() - began, at: new Date().toISOString() }));
process.exit(0);
