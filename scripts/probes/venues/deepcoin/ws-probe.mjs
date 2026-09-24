// Deepcoin perpetual WebSocket probe: the TopicID 25 book channel, its snapshot and delta semantics, level order, size unit against a REST book, the TopicID 7 ticker, keepalive, silence, errors, and a batch of perpetuals on one connection.
// Public, unauthenticated and read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/deepcoin/ws-probe.mjs [book|errors|batch|silence|deflate]
//   book     TopicID 25 on four USDT perps for 60 s with REST book compares at 20, 40 and 58 s, and TopicID 7 on the same four
//   errors   unknown, wrong precision, missing precision, inverse, duplicate, unknown topic, non-JSON text, a late resubscribe, three unsubscribe forms, about 21 s
//   batch    TopicID 25 on one connection for 45 s: batch [count] [subscribes per 100 ms], default every live USDT perp in one burst
//   silence  three sockets that differ only in what the client sends or subscribes, for up to 45 s
//   deflate  asks for permessage-deflate once, then tries the documented version=v2 URL with a v1 frame
// Set PROBE_OUT_DIR to keep raw frames, each trimmed to 4 KB.
// Recorded in docs/profiles/deepcoin/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const SWAP_URL = 'wss://stream.deepcoin.com/streamlet/trade/public/swap?platform=api';
const V2_URL = 'wss://stream.deepcoin.com/streamlet/trade/public/swap?platform=api&version=v2';
const API = 'https://api.deepcoin.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
let localNo = 1;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  try {
    if (statSync(file).size > 3_000_000) return;
  } catch {}
  appendFileSync(file, text.slice(0, 4096) + '\n');
}

async function getJson(path) {
  const res = await fetch(API + path);
  return res.json();
}

function sub(filterValue, topicId, action = '1', resumeNo = -1, no = localNo++) {
  return JSON.stringify({ SendTopicAction: { Action: action, FilterValue: filterValue, LocalNo: no, ResumeNo: resumeNo, TopicID: topicId } });
}

// BTC-USDT-SWAP becomes BTCUSDT, which is how the socket spells a perpetual.
const wireId = (instId) => instId.replace(/-SWAP$/, '').replace('-', '');
const bookFilter = (inst) => `DeepCoin_${wireId(inst.instId)}_${inst.tickSz}`;

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve, reject) => {
    ws.once('upgrade', (res) => (ws.upgradeHeaders = res.headers));
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0 }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

async function catalog() {
  const inst = (await getJson('/deepcoin/market/instruments?instType=SWAP')).data;
  const tickers = (await getJson('/deepcoin/market/tickers?instType=SWAP')).data;
  const vol = new Map(tickers.map((t) => [t.instId, Number(t.volCcy24h)]));
  const usdt = inst.filter((i) => i.quoteCcy === 'USDT' && i.state === 'live').sort((a, b) => (vol.get(b.instId) ?? 0) - (vol.get(a.instId) ?? 0));
  return { inst, usdt, vol };
}

function newBookState(inst) {
  return {
    inst, bids: new Map(), asks: new Map(), snaps: [], deltas: 0, levelsPerDelta: [], zeros: 0, crossed: 0, maxB: 0, maxA: 0,
    unorderedB: 0, unorderedA: 0, mtGaps: [], lastMt: null, identical: 0, lastRaw: null, noop: 0, deltaBeforeSnap: 0, lastArrival: null, maxQuietMs: 0,
    mtBackwards: 0, crossedAt: null, healedBySnapshot: 0, crossedNow: false, crossedEpisodes: 0, bigGaps: 0, lastGap: 0, crossAfterBigGap: 0,
  };
}

function isDesc(a) { return a.every((x, i) => i === 0 || x.P < a[i - 1].P); }
function isAsc(a) { return a.every((x, i) => i === 0 || x.P > a[i - 1].P); }

function applyBookFrame(st, m, rawText, arrival) {
  const r = m.r.map((x) => x.d);
  const b = r.filter((x) => x.D === '0');
  const a = r.filter((x) => x.D === '1');
  if (st.lastArrival !== null) st.maxQuietMs = Math.max(st.maxQuietMs, arrival - st.lastArrival);
  st.lastArrival = arrival;
  if (st.lastMt !== null) {
    st.lastGap = m.mt - st.lastMt;
    st.mtGaps.push(st.lastGap);
    if (m.mt < st.lastMt) st.mtBackwards++;
    if (st.lastGap > 300) st.bigGaps++; // the push runs every 200 ms, so a longer gap is a skipped push
  }
  st.lastMt = m.mt;
  if (m.t === 'f') {
    st.bids = new Map(b.map((x) => [x.P, x.V]));
    st.asks = new Map(a.map((x) => [x.P, x.V]));
    st.snaps.push({ at: arrival, bids: b.length, asks: a.length, bidsDesc: isDesc(b), asksAsc: isAsc(a), zeroSizes: r.filter((x) => x.V === 0).length });
    if (st.crossedNow) st.healedBySnapshot++;
    st.crossedNow = false;
    return;
  }
  if (st.snaps.length === 0) st.deltaBeforeSnap++;
  st.deltas++;
  st.levelsPerDelta.push(r.length);
  if (!isDesc(b)) st.unorderedB++;
  if (!isAsc(a)) st.unorderedA++;
  const body = JSON.stringify(m.r);
  if (body === st.lastRaw) st.identical++;
  st.lastRaw = body;
  let changed = 0;
  for (const x of b) {
    if (st.bids.get(x.P) !== x.V && !(x.V === 0 && !st.bids.has(x.P))) changed++;
    if (x.V === 0) { st.bids.delete(x.P); st.zeros++; } else st.bids.set(x.P, x.V);
  }
  for (const x of a) {
    if (st.asks.get(x.P) !== x.V && !(x.V === 0 && !st.asks.has(x.P))) changed++;
    if (x.V === 0) { st.asks.delete(x.P); st.zeros++; } else st.asks.set(x.P, x.V);
  }
  if (changed === 0) st.noop++;
  st.maxB = Math.max(st.maxB, st.bids.size);
  st.maxA = Math.max(st.maxA, st.asks.size);
  const crossed = st.bids.size > 0 && st.asks.size > 0 && Math.max(...st.bids.keys()) >= Math.min(...st.asks.keys());
  if (crossed) {
    st.crossed++;
    st.crossedAt ??= arrival;
    if (!st.crossedNow) {
      st.crossedEpisodes++;
      if (st.lastGap > 300) st.crossAfterBigGap++;
    }
  }
  st.crossedNow = crossed;
}

function sortedSide(map, desc) {
  return [...map.entries()].sort((x, y) => (desc ? y[0] - x[0] : x[0] - y[0]));
}

// Compares the local top 20 against a REST book read at the same moment.
async function restCompare(st) {
  const t0 = Date.now();
  const rest = (await getJson(`/deepcoin/market/books?instId=${st.inst.instId}&sz=20`)).data;
  const ms = Date.now() - t0;
  const out = { instId: st.inst.instId, ctVal: st.inst.ctVal, restMs: ms };
  for (const [side, desc] of [['bids', true], ['asks', false]]) {
    const local = sortedSide(st[side], desc).slice(0, 20);
    const restLv = rest[side].map(([p, s]) => [Number(p), Number(s)]);
    const restMap = new Map(restLv);
    const localSet = new Set(local.map((x) => x[0]));
    const samePrice = restLv.filter(([p]) => localSet.has(p)).length;
    const ratios = local.filter(([p]) => restMap.has(p)).map(([p, v]) => v / restMap.get(p));
    const sizeEqualAfterCtVal = local.filter(([p, v]) => restMap.has(p) && Math.abs(v * Number(st.inst.ctVal) - restMap.get(p)) < 1e-9 * Math.max(1, v)).length;
    out[side] = {
      restLevels: restLv.length, restOrder: desc ? isDesc(restLv.map(([P]) => ({ P }))) : isAsc(restLv.map(([P]) => ({ P }))),
      samePrice, medianRatioWsOverRest: median(ratios), sizeEqualAfterCtVal, localTop: local[0], restTop: restLv[0],
    };
  }
  return out;
}

async function bookMode() {
  const { usdt, vol } = await catalog();
  const pick = [usdt.find((i) => i.instId === 'BTC-USDT-SWAP'), usdt.find((i) => i.instId === 'ETH-USDT-SWAP'), usdt[usdt.length >> 1], usdt[usdt.length - 1]];
  log('markets', { picks: pick.map((i) => ({ instId: i.instId, tickSz: i.tickSz, ctVal: i.ctVal, lotSz: i.lotSz, quoteVol24h: Math.round(vol.get(i.instId)) })) });
  const { ws, openMs } = await open(SWAP_URL);
  log('open', { openMs, pop: ws.upgradeHeaders?.['x-amz-cf-pop'], extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null });
  const books = new Map(pick.map((i) => [wireId(i.instId), newBookState(i)]));
  const tick = new Map(pick.map((i) => [wireId(i.instId), { frames: 0, M: new Set(), D: new Set(), E: new Set(), PF: new Set(), last: null, firstAt: null, maxQuietMs: 0, lastAt: null, uAge: [] }]));
  const acks = [];
  const pongs = [];
  let pingSent = 0;
  let serverPings = 0;
  let frames = 0;
  let bytes = 0;
  const t0 = Date.now();
  ws.on('ping', () => serverPings++);
  ws.on('message', (data) => {
    const arrival = Date.now();
    const text = data.toString();
    frames++;
    bytes += data.length;
    capture('book.txt', `${arrival} ${text}`);
    if (text === 'pong') { pongs.push(arrival - pingSent); return; }
    const m = JSON.parse(text);
    if (m.a === 'RecvTopicAction') { acks.push({ ms: arrival - t0, m: m.m, F: m.r?.[0]?.d?.F, T: m.r?.[0]?.d?.T }); return; }
    if (m.a === 'PMO') {
      const st = books.get(m.r?.[0]?.d?.I);
      if (st) applyBookFrame(st, m, text, arrival);
      return;
    }
    if (m.a === 'PO') {
      for (const x of m.r) {
        const tk = tick.get(x.d.I);
        if (!tk) continue;
        if (tk.lastAt !== null) tk.maxQuietMs = Math.max(tk.maxQuietMs, arrival - tk.lastAt);
        tk.lastAt = arrival;
        tk.frames++;
        tk.firstAt ??= arrival - t0;
        tk.M.add(x.d.M); tk.D.add(x.d.D); tk.E.add(x.d.E); tk.PF.add(x.d.PF);
        tk.uAge.push(arrival - x.d.U);
        tk.last = x.d;
      }
    }
  });
  for (const i of pick) ws.send(sub(bookFilter(i), '25'));
  for (const i of pick) ws.send(sub(`DeepCoin_${wireId(i.instId)}`, '7'));
  const ping = setInterval(() => { pingSent = Date.now(); ws.send('ping'); }, 10_000);
  const compares = [];
  for (const at of [20_000, 40_000, 58_000]) {
    await sleep(at - (Date.now() - t0));
    for (const st of books.values()) compares.push({ atS: Math.round((Date.now() - t0) / 1000), ...(await restCompare(st)) });
    const mark = (await getJson('/deepcoin/market/mark-price?instType=SWAP')).data;
    const rates = (await getJson('/deepcoin/trade/fund-rate/current-funding-rate?instType=SwapU')).data.current_fund_rates;
    const cycle = (await getJson('/deepcoin/trade/funding-rate?instType=SwapU')).data;
    for (const [id, tk] of tick) {
      const r = mark.find((x) => wireId(x.instId) === id);
      const rate = rates.find((x) => x.instrumentId === id)?.fundingRate;
      const next = cycle.find((x) => x.instrumentID === id)?.nextSettleTime;
      if (tk.last && r) compares.push({ atS: Math.round((Date.now() - t0) / 1000), ticker: id, wsM: tk.last.M, restMark: r.markPx, wsD: tk.last.D, wsE: tk.last.E, restRate: rate, wsPF: tk.last.PF, restNextSettle: next, restMarkTs: r.ts, wsU: tk.last.U });
    }
  }
  await sleep(60_000 - (Date.now() - t0));
  clearInterval(ping);
  ws.close();
  log('acks', { acks });
  for (const [id, st] of books) {
    log('book', {
      id, filter: bookFilter(st.inst), snaps: st.snaps, deltas: st.deltas, deltaBeforeSnap: st.deltaBeforeSnap,
      levelsPerDelta: { min: Math.min(...st.levelsPerDelta), median: median(st.levelsPerDelta), max: Math.max(...st.levelsPerDelta) },
      mtGapMs: { min: Math.min(...st.mtGaps), median: median(st.mtGaps), p90: pct(st.mtGaps, 0.9), max: Math.max(...st.mtGaps) }, mtBackwards: st.mtBackwards,
      gapsOver300Ms: st.bigGaps, zeroSizeLevels: st.zeros, crossedAfterDelta: st.crossed, maxLevels: [st.maxB, st.maxA], finalLevels: [st.bids.size, st.asks.size],
      unorderedDeltaArrays: [st.unorderedB, st.unorderedA], identicalToPrevious: st.identical, noopDeltas: st.noop, maxQuietMs: st.maxQuietMs,
    });
  }
  for (const [id, tk] of tick) log('ticker', { id, frames: tk.frames, firstAtMs: tk.firstAt, maxQuietMs: tk.maxQuietMs, distinctM: tk.M.size, distinctD: tk.D.size, distinctE: tk.E.size, distinctPF: tk.PF.size, uAgeAtArrivalMs: { min: Math.min(...tk.uAge), median: median(tk.uAge), max: Math.max(...tk.uAge) }, keys: tk.last ? Object.keys(tk.last) : [] });
  for (const c of compares) log('compare', c);
  log('session', { frames, bytes, pongRttMs: pongs, serverPings });
}

async function errorsMode() {
  const { usdt } = await catalog();
  const btc = usdt.find((i) => i.instId === 'BTC-USDT-SWAP');
  const { ws } = await open(SWAP_URL);
  const t0 = Date.now();
  const seen = [];
  const counts = new Map();
  const snapshots = [];
  ws.on('message', (data) => {
    const text = data.toString();
    capture('errors.txt', `${Date.now()} ${text}`);
    let m;
    try { m = JSON.parse(text); } catch { seen.push({ ms: Date.now() - t0, text: text.slice(0, 200) }); return; }
    if (m.a === 'PMO' || m.a === 'PO') {
      const key = `${m.a}:${m.r?.[0]?.d?.I}:${m.t ?? ''}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (m.t === 'f') snapshots.push(`${m.r[0].d.I}@${Date.now() - t0}`);
      return;
    }
    seen.push({ ms: Date.now() - t0, text: text.slice(0, 300) });
  });
  const cases = [
    ['valid', sub(bookFilter(btc), '25')],
    ['duplicate', sub(bookFilter(btc), '25')],
    ['unknown symbol', sub('DeepCoin_NOPEUSDT_0.1', '25')],
    ['wrong precision', sub('DeepCoin_BTCUSDT_1', '25')],
    ['coarser precision', sub('DeepCoin_BTCUSDT_0.5', '25')],
    ['missing precision', sub('DeepCoin_BTCUSDT', '25')],
    ['instId spelling', sub('DeepCoin_BTC-USDT-SWAP_0.1', '25')],
    ['two filters in one', sub('DeepCoin_ETHUSDT_0.01,DeepCoin_SOLUSDT_0.01', '25')],
    ['inverse LTCUSD at tickSz', sub('DeepCoin_LTCUSD_0.01', '25')],
    ['inverse ETHUSD at tickSz', sub('DeepCoin_ETHUSD_0.05', '25')],
    ['inverse ETHUSD ticker', sub('DeepCoin_ETHUSD', '7')],
    ['unknown topic', sub('DeepCoin_BTCUSDT', '99')],
    ['repeated LocalNo', sub('DeepCoin_ETHUSDT', '7', '1', -1, 1)],
    ['lowercase key', JSON.stringify({ sendTopicAction: { Action: '1', FilterValue: 'DeepCoin_XRPUSDT_0.0001', LocalNo: localNo++, ResumeNo: -1, TopicID: '25' } })],
    ['not JSON', 'hello'],
  ];
  for (const [label, frame] of cases) {
    seen.push({ ms: Date.now() - t0, sent: label });
    ws.send(frame);
    await sleep(300);
  }
  await sleep(3000);
  seen.push({ ms: Date.now() - t0, sent: 'resubscribe XRPUSDT book, a second time on the same socket' });
  ws.send(sub('DeepCoin_XRPUSDT_0.0001', '25'));
  await sleep(1000);
  const before = counts.get('PMO:BTCUSDT:i') ?? 0;
  seen.push({ ms: Date.now() - t0, sent: 'unsubscribe BTCUSDT book, Action 2' });
  ws.send(sub(bookFilter(btc), '25', '2'));
  await sleep(4000);
  const mid = counts.get('PMO:BTCUSDT:i') ?? 0;
  seen.push({ ms: Date.now() - t0, sent: 'unsubscribe BTCUSDT book, Action 2, with the LocalNo 1 of the subscription' });
  ws.send(sub(bookFilter(btc), '25', '2', -1, 1));
  await sleep(4000);
  const mid2 = counts.get('PMO:BTCUSDT:i') ?? 0;
  seen.push({ ms: Date.now() - t0, sent: 'unsubscribe all, Action 0' });
  ws.send(sub(bookFilter(btc), '25', '0'));
  await sleep(4000);
  const end = counts.get('PMO:BTCUSDT:i') ?? 0;
  const after = new Map(counts);
  ws.close();
  for (const s of seen) log('seen', s);
  log('counts', { snapshots, streams: Object.fromEntries(after), btcDeltas: { beforeUnsub: before, afterAction2NewLocalNo: mid, afterAction2LocalNo1: mid2, afterAction0: end } });
}

async function batchMode() {
  const { usdt: live } = await catalog();
  const count = Number(process.argv[3] ?? live.length);
  const perTick = Number(process.argv[4] ?? live.length); // subscribe frames sent per 100 ms
  const usdt = live.slice(0, count);
  const { ws, openMs } = await open(SWAP_URL);
  log('open', { openMs, markets: usdt.length, subscribesPer100Ms: perTick });
  const books = new Map(usdt.map((i) => [wireId(i.instId), newBookState(i)]));
  const acks = { success: 0, other: [] };
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  let firstSnapAt = null;
  let lastSnapAt = null;
  const perSecond = new Map();
  const t0 = Date.now();
  let closed = null;
  let lastFrameMs = null;
  ws.on('close', (code, reason) => (closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }));
  ws.on('message', (data) => {
    const arrival = Date.now();
    lastFrameMs = arrival - t0;
    frames++;
    bytes += data.length;
    const sec = Math.floor((arrival - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const text = data.toString();
    if (text === 'pong') return;
    const p0 = process.hrtime.bigint();
    const m = JSON.parse(text);
    parseUs += Number(process.hrtime.bigint() - p0) / 1000;
    if (m.a === 'RecvTopicAction') {
      if (m.m === 'Success') acks.success++;
      else acks.other.push(`${m.r?.[0]?.d?.F}: ${m.m}`);
      return;
    }
    if (m.a !== 'PMO') return;
    const st = books.get(m.r?.[0]?.d?.I);
    if (!st) return;
    if (OUT) (st.raw ??= []).push(`${arrival} ${text}`);
    if (m.t === 'f') { firstSnapAt ??= arrival - t0; lastSnapAt = arrival - t0; }
    applyBookFrame(st, m, text, arrival);
  });
  for (let k = 0; k < usdt.length; k += perTick) {
    for (const i of usdt.slice(k, k + perTick)) ws.send(sub(bookFilter(i), '25'));
    if (k + perTick < usdt.length) await sleep(100);
  }
  const sentMs = Date.now() - t0;
  const ping = setInterval(() => ws.send('ping'), 10_000);
  await sleep(45_000);
  // A crossed stream is read against REST before the socket closes, to name the levels the socket left behind.
  for (const st of [...books.values()].filter((x) => x.crossedNow).slice(0, 4)) {
    const c = await restCompare(st);
    const rest = (await getJson(`/deepcoin/market/books?instId=${st.inst.instId}&sz=400`)).data;
    const restB = new Set(rest.bids.map(([p]) => Number(p)));
    const restA = new Set(rest.asks.map(([p]) => Number(p)));
    const bestRestBid = Number(rest.bids[0]?.[0]);
    const bestRestAsk = Number(rest.asks[0]?.[0]);
    const staleBids = sortedSide(st.bids, true).filter(([p]) => p >= bestRestAsk && !restB.has(p)).slice(0, 5);
    const staleAsks = sortedSide(st.asks, false).filter(([p]) => p <= bestRestBid && !restA.has(p)).slice(0, 5);
    log('crossed', { instId: st.inst.instId, crossedAtMs: st.crossedAt - t0, snaps: st.snaps.map((x) => x.at - t0), localTop: [c.bids.localTop, c.asks.localTop], restTop: [c.bids.restTop, c.asks.restTop], staleBids, staleAsks });
    if (OUT) for (const line of st.raw) capture(`crossed-${wireId(st.inst.instId)}.txt`, line);
  }
  clearInterval(ping);
  const closedBefore = closed;
  ws.close();
  closed = closedBefore;
  const all = [...books.values()];
  const rates = [...perSecond.entries()].filter(([s]) => s >= 5 && s < 45).map(([, n]) => n);
  log('batch', {
    markets: usdt.length, subscribeBurstMs: sentMs, closedBeforeEnd: closed, lastFrameMs, frames, acks: { success: acks.success, other: acks.other.slice(0, 10), otherCount: acks.other.length },
    withSnapshot: all.filter((s) => s.snaps.length > 0).length, withTwoSnapshots: all.filter((s) => s.snaps.length > 1).length,
    firstSnapMs: firstSnapAt, lastSnapMs: lastSnapAt, withoutSnapshot: all.filter((s) => s.snaps.length === 0).map((s) => s.inst.instId).slice(0, 20),
    noDeltaAfterSnapshot: all.filter((s) => s.snaps.length > 0 && s.deltas === 0).length, deltaBeforeSnap: all.reduce((n, s) => n + s.deltaBeforeSnap, 0),
    crossedStreams: all.filter((s) => s.crossed > 0).map((s) => `${s.inst.instId}:${s.crossed}/${s.deltas}`).slice(0, 20),
    crossedStreamCount: all.filter((s) => s.crossed > 0).length, crossedEpisodes: all.reduce((n, s) => n + s.crossedEpisodes, 0),
    crossedHealedBySnapshot: all.reduce((n, s) => n + s.healedBySnapshot, 0), crossedAtEnd: all.filter((s) => s.crossedNow).length,
    mtBackwards: all.reduce((n, s) => n + s.mtBackwards, 0), crossedEpisodesRightAfterGapOver300Ms: all.reduce((n, s) => n + s.crossAfterBigGap, 0),
    gapsOver300Ms: all.reduce((n, s) => n + s.bigGaps, 0), streamsWithGapOver300Ms: all.filter((s) => s.bigGaps > 0).length,
    deltasPerStream: { min: Math.min(...all.map((s) => s.deltas)), p10: pct(all.map((s) => s.deltas), 0.1), median: median(all.map((s) => s.deltas)), max: Math.max(...all.map((s) => s.deltas)) },
    streamsUnder100Deltas: all.filter((s) => s.deltas < 100).length,
    framesPerSecond: { median: median(rates), max: Math.max(...rates), mean: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) },
    bytesPerSecond: Math.round(bytes / 45), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: +(parseUs / frames).toFixed(1),
    snapshotLevels: { medianBids: median(all.filter((s) => s.snaps[0]).map((s) => s.snaps[0].bids)), maxBids: Math.max(...all.filter((s) => s.snaps[0]).map((s) => s.snaps[0].bids)), under20: all.filter((s) => s.snaps[0] && (s.snaps[0].bids < 20 || s.snaps[0].asks < 20)).length },
    maxQuietMs: { median: median(all.map((s) => s.maxQuietMs)), max: Math.max(...all.map((s) => s.maxQuietMs)) },
  });
}

async function silenceMode() {
  const { usdt } = await catalog();
  const quiet = usdt[usdt.length - 1];
  const variants = [
    ['nothing', false, false],
    ['subscribed, no ping', true, false],
    ['subscribed, ping every 10 s', true, true],
  ];
  const results = await Promise.all(variants.map(async ([label, subscribe, ping]) => {
    const { ws } = await open(SWAP_URL);
    const t0 = Date.now();
    let frames = 0;
    let pongs = 0;
    let serverPings = 0;
    let timer = null;
    ws.on('message', (d) => { frames++; if (d.toString() === 'pong') pongs++; });
    ws.on('ping', () => serverPings++);
    if (subscribe) ws.send(sub(bookFilter(quiet), '25'));
    if (ping) timer = setInterval(() => ws.send('ping'), 10_000);
    const closed = await Promise.race([
      new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString(), atMs: Date.now() - t0 }))),
      sleep(45_000).then(() => null),
    ]);
    clearInterval(timer);
    if (!closed) ws.terminate();
    return { label, instId: subscribe ? quiet.instId : null, closed: closed ?? 'open at 45 s', frames, pongs, serverPings };
  }));
  for (const r of results) log('silence', r);
}

async function deflateMode() {
  const { ws } = await open(SWAP_URL, { perMessageDeflate: true });
  log('deflate', { extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null });
  ws.close();
  const { ws: v2, openMs } = await open(V2_URL);
  const got = [];
  const t0 = Date.now();
  v2.on('message', (d) => got.push({ ms: Date.now() - t0, text: d.toString().slice(0, 300) }));
  const closed = new Promise((r) => v2.once('close', (code) => r({ code, atMs: Date.now() - t0 })));
  v2.send(sub('DeepCoin_BTCUSDT_0.1', '25'));
  v2.send(sub('DeepCoin_BTCUSDT', '7'));
  v2.send('ping');
  const res = await Promise.race([closed, sleep(12_000).then(() => null)]);
  if (!res) v2.close();
  log('v2', { openMs, frames: got.length, first: got.slice(0, 5), closed: res ?? 'open at 12 s' });
}

const mode = process.argv[2] ?? 'book';
const modes = { book: bookMode, errors: errorsMode, batch: batchMode, silence: silenceMode, deflate: deflateMode };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
