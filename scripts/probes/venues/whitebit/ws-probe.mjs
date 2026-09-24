// WhiteBIT WebSocket probe: the depth channel's snapshot, update id chain, keepalive snapshots, level order and window, size unit against REST, errors, the premium index push, keepalive and silence, compression, and a batch of every perpetual on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in deflate mode, which asks once to see what the server negotiates.
// Run from server/: node ../scripts/probes/venues/whitebit/ws-probe.mjs [book|batch|silence|deflate|legacy]
//   book     depth on four perps and one spot market for 70 s with a REST compare, bookTicker, premiumIndex for all perps, and an error socket. About 90 s.
//   batch    depth at 50 levels on every perpetual from /futures, one subscribe request per market, on one connection for 60 s.
//   silence  four sockets that differ only in what the client sends or subscribes, for up to 75 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   legacy   opens the deprecated host wss://api.whitebit.com/ws that CCXT Pro 4.5.68 still uses, pings it and reads one depth snapshot.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/whitebit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://wss.whitebit.com/ws';
const LEGACY_URL = 'wss://api.whitebit.com/ws';
const API = 'https://whitebit.com/api/v4/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let nextId = 1;
const req = (method, params, id = nextId++) => JSON.stringify({ id, method, params });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url, opts = {}) {
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const t0 = performance.now();
  const info = { url, pings: [], closed: null, openMs: null, extensions: null, upgradeHeaders: null };
  ws.on('upgrade', (res) => { info.upgradeHeaders = res.headers; });
  ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; });
  ws.on('ping', (d) => info.pings.push({ atMs: Math.round(performance.now() - t0), data: d.toString() }));
  ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  ws.on('error', (e) => { info.error = e.message; });
  const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, info, ready, t0 };
}

const isAsc = (l) => l.every((x, i) => i === 0 || Number(x[0]) > Number(l[i - 1][0]));
const isDesc = (l) => l.every((x, i) => i === 0 || Number(x[0]) < Number(l[i - 1][0]));

// A local book per market: replace on a snapshot, apply a delta only when past_update_id equals the stored update_id.
class Book {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.id = null; this.maxBids = 0; this.maxAsks = 0; }
  reset(d) {
    this.bids.clear(); this.asks.clear();
    for (const [p, s] of d.bids ?? []) this.bids.set(p, s);
    for (const [p, s] of d.asks ?? []) this.asks.set(p, s);
    this.id = d.update_id;
    this.track();
  }
  apply(d) {
    for (const [p, s] of d.bids ?? []) (s === '0' ? this.bids.delete(p) : this.bids.set(p, s));
    for (const [p, s] of d.asks ?? []) (s === '0' ? this.asks.delete(p) : this.asks.set(p, s));
    this.id = d.update_id;
    this.track();
  }
  track() { this.maxBids = Math.max(this.maxBids, this.bids.size); this.maxAsks = Math.max(this.maxAsks, this.asks.size); }
  top(n) {
    return {
      bids: [...this.bids].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n),
      asks: [...this.asks].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n),
    };
  }
}

function newStats() {
  return { snapshots: 0, keepaliveSnapshots: 0, deltas: 0, gaps: 0, gapSamples: [], snapshotIdJumps: [], bytes: 0, firstSnapshotMs: null, firstSnapshotLevels: null, snapshotBidsDesc: true, snapshotAsksAsc: true, deltaBidUnordered: 0, deltaAskUnordered: 0, emptyDeltas: 0, maxIdleMs: 0, lastAt: null, sizeTypes: new Set(), paramsShape: null, keepaliveGapsMs: [], lastSnapshotAt: null, lastFrameAt: null, maxLevelsInDelta: 0, eventLagMs: [], engineToEventMs: [], snapshotKeys: null, deltaKeys: null };
}

// Returns the handler that keeps books and stats for depth_update frames.
function depthHandler(stats, books, t0, other) {
  return (j, bytes) => {
    const [isSnapshot, d, market] = j.params;
    const st = stats[market];
    if (!st) { other.push(`unrequested ${market}`); return; }
    const at = performance.now() - t0;
    st.bytes += bytes;
    if (st.paramsShape === null) st.paramsShape = j.params.map((p) => (Array.isArray(p) ? 'array' : typeof p));
    if (st.lastFrameAt !== null) st.maxIdleMs = Math.max(st.maxIdleMs, Math.round(at - st.lastFrameAt));
    st.lastFrameAt = at;
    if (typeof d.event_time === 'number' && st.eventLagMs.length < 2000) st.eventLagMs.push(Date.now() - d.event_time * 1000);
    if (typeof d.event_time === 'number' && typeof d.timestamp === 'number' && st.engineToEventMs.length < 2000) st.engineToEventMs.push((d.event_time - d.timestamp) * 1000);
    if (isSnapshot && st.snapshotKeys === null) st.snapshotKeys = Object.keys(d);
    if (!isSnapshot && st.deltaKeys === null) st.deltaKeys = Object.keys(d);
    for (const [, s] of [...(d.bids ?? []), ...(d.asks ?? [])]) st.sizeTypes.add(typeof s);
    const book = books[market];
    if (isSnapshot) {
      st.snapshots++;
      if (st.firstSnapshotMs === null) { st.firstSnapshotMs = Math.round(at); st.firstSnapshotLevels = { bids: d.bids?.length ?? 0, asks: d.asks?.length ?? 0, hasPast: 'past_update_id' in d }; }
      else {
        st.keepaliveSnapshots++;
        if (st.lastSnapshotAt !== null && st.keepaliveGapsMs.length < 20) st.keepaliveGapsMs.push(Math.round(at - Math.max(st.lastSnapshotAt, st.lastDeltaAt ?? 0)));
        if (st.snapshotIdJumps.length < 10) st.snapshotIdJumps.push(d.update_id - book.id);
      }
      st.lastSnapshotAt = at;
      if (!isDesc(d.bids ?? [])) st.snapshotBidsDesc = false;
      if (!isAsc(d.asks ?? [])) st.snapshotAsksAsc = false;
      book.reset(d);
      return;
    }
    st.deltas++;
    st.lastDeltaAt = at;
    const nb = d.bids?.length ?? 0;
    const na = d.asks?.length ?? 0;
    st.maxLevelsInDelta = Math.max(st.maxLevelsInDelta, nb, na);
    if (nb === 0 && na === 0) st.emptyDeltas++;
    if (d.bids && !isDesc(d.bids)) st.deltaBidUnordered++;
    if (d.asks && !isAsc(d.asks)) st.deltaAskUnordered++;
    if (book.id === null) { st.gaps++; st.gapSamples.push({ reason: 'delta_before_snapshot' }); return; }
    if (d.past_update_id !== book.id) { st.gaps++; if (st.gapSamples.length < 5) st.gapSamples.push({ stored: book.id, past: d.past_update_id, update: d.update_id }); }
    book.apply(d);
  };
}

function dist(xs) {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? { n: v.length, min: Math.round(v[0]), median: Math.round(v[Math.floor(v.length / 2)]), p90: Math.round(v[Math.floor(v.length * 0.9)]), max: Math.round(v.at(-1)) } : null;
}

function summarize(st, book) {
  const { lastAt, lastFrameAt, lastSnapshotAt, lastDeltaAt, sizeTypes, eventLagMs, engineToEventMs, ...rest } = st;
  return { ...rest, sizeTypes: [...sizeTypes], maxBidsHeld: book.maxBids, maxAsksHeld: book.maxAsks, arrivalMinusEventTimeMs: dist(eventLagMs), eventTimeMinusTimestampMs: dist(engineToEventMs) };
}

async function futuresRows() {
  const r = await fetch(`${API}/futures`);
  return (await r.json()).result;
}

async function bookMode() {
  const rows = await futuresRows();
  const markets = await (await fetch(`${API}/markets`)).json();
  const delisting = new Set(markets.filter((m) => m.delistedAt !== null).map((m) => m.name));
  const tradfi = new Set(markets.filter((m) => m.type === 'tradfiFutures').map((m) => m.name));
  // A quiet crypto perp: the lowest 24 h quote volume that is not in delisting.
  const quiet = rows.filter((r) => !delisting.has(r.ticker_id) && !tradfi.has(r.ticker_id)).sort((a, b) => Number(a.money_volume) - Number(b.money_volume))[0].ticker_id;
  const subs = [['BTC_PERP', 100], ['ETH_PERP', 20], ['SOL_PERP', 50], [quiet, 100], ['BTC_USDT', 20]];
  log('book_plan', { subs, quiet, quietVolume: rows.find((r) => r.ticker_id === quiet).money_volume });
  const WINDOW_MS = 70_000;

  const { ws, info, ready, t0 } = open(WS_URL);
  await ready;
  log('open', { url: WS_URL, openMs: info.openMs, extensions: info.upgradeHeaders?.['sec-websocket-extensions'] ?? null, server: info.upgradeHeaders?.server, cfRay: info.upgradeHeaders?.['cf-ray'] });
  const stats = Object.fromEntries(subs.map(([m]) => [m, newStats()]));
  const books = Object.fromEntries(subs.map(([m]) => [m, new Book()]));
  const other = [];
  const acks = [];
  const pongs = [];
  const firstFrames = [];
  const bookTicker = { frames: 0, sameTopRepeats: 0, lastTop: null, sample: null, idNonMonotonic: 0, lastId: null, messageMinusTransactionMs: [], arrivalMinusMessageMs: [] };
  const premium = { msgs: 0, recordsPerMsg: new Set(), gapsMs: [], lastAt: null, sample: null, btcIndexChanges: 0, btcMarkChanges: 0, btcLast: null, btcIndexMaxHoldMs: 0, btcIndexChangedAt: null, markEmpty: 0, series: { BTC_PERP: [], ETH_PERP: [] }, prevAll: null, indexChangedPerMsg: [], markChangedPerMsg: [], fundingChangedPerMsg: [], markets: null, serverMinusArrivalMs: [] };
  const onDepth = depthHandler(stats, books, t0, other);
  let binaryFrames = 0;
  let msgs = 0;
  let bytes = 0;
  const sentAt = {};

  ws.on('message', (data, isBinary) => {
    const text = data.toString();
    msgs++; bytes += data.length;
    if (isBinary) binaryFrames++;
    const at = performance.now() - t0;
    capture('book_frames.jsonl', text);
    if (firstFrames.length < 6) firstFrames.push({ atMs: Math.round(at), text: text.slice(0, 700) });
    let j; try { j = JSON.parse(text); } catch { other.push(text.slice(0, 200)); return; }
    if (j.result === 'pong') { pongs.push({ atMs: Math.round(at), rttMs: Math.round(at - (sentAt[j.id] ?? at)), frame: j }); return; }
    if (j.method === 'depth_update') { onDepth(j, data.length); return; }
    if (j.method === 'bookTicker_update') {
      bookTicker.frames++;
      const rec = j.params[0];
      if (!bookTicker.sample) bookTicker.sample = j;
      const top = rec.slice(4).join('|');
      if (top === bookTicker.lastTop) bookTicker.sameTopRepeats++;
      bookTicker.lastTop = top;
      if (bookTicker.lastId !== null && rec[3] <= bookTicker.lastId) bookTicker.idNonMonotonic++;
      bookTicker.lastId = rec[3];
      bookTicker.messageMinusTransactionMs.push((rec[1] - rec[0]) * 1000);
      bookTicker.arrivalMinusMessageMs.push(Date.now() - rec[1] * 1000);
      return;
    }
    if (j.method === 'premiumIndex_update') {
      premium.msgs++;
      if (!premium.sample) premium.sample = { ...j, params: j.params.slice(0, 2) };
      premium.recordsPerMsg.add(j.params.length);
      if (premium.lastAt !== null && premium.gapsMs.length < 200) premium.gapsMs.push(Math.round(at - premium.lastAt));
      premium.lastAt = at;
      premium.markEmpty += j.params.filter((r) => r[1] === '').length;
      if (!premium.markets) premium.markets = j.params.map((r) => r[0]);
      if (typeof j.params[0][5] === 'number') premium.serverMinusArrivalMs.push(Date.now() - j.params[0][5] * 1000);
      const cur = Object.fromEntries(j.params.map((r) => [r[0], r]));
      if (premium.prevAll) {
        let ic = 0; let mc = 0; let fc = 0;
        for (const [m, r] of Object.entries(cur)) { const p = premium.prevAll[m]; if (!p) continue; if (p[2] !== r[2]) ic++; if (p[1] !== r[1]) mc++; if (p[3] !== r[3]) fc++; }
        premium.indexChangedPerMsg.push(ic); premium.markChangedPerMsg.push(mc); premium.fundingChangedPerMsg.push(fc);
      }
      premium.prevAll = cur;
      for (const m of ['BTC_PERP', 'ETH_PERP']) {
        const r = cur[m]; const s = premium.series[m];
        if (r && (s.length === 0 || s.at(-1).mark !== r[1] || s.at(-1).index !== r[2] || s.at(-1).funding !== r[3])) s.push({ atS: Math.round(at / 100) / 10, mark: r[1], index: r[2], funding: r[3] });
      }
      const btc = j.params.find((r) => r[0] === 'BTC_PERP');
      if (btc) {
        if (premium.btcLast) {
          if (btc[2] !== premium.btcLast[2]) {
            premium.btcIndexChanges++;
            if (premium.btcIndexChangedAt !== null) premium.btcIndexMaxHoldMs = Math.max(premium.btcIndexMaxHoldMs, Math.round(at - premium.btcIndexChangedAt));
            premium.btcIndexChangedAt = at;
          }
          if (btc[1] !== premium.btcLast[1]) premium.btcMarkChanges++;
        } else premium.btcIndexChangedAt = at;
        premium.btcLast = btc;
      }
      return;
    }
    if ('id' in j && j.id !== null) { acks.push({ atMs: Math.round(at), frame: j }); return; }
    other.push(text.slice(0, 300));
  });

  const send = (method, params) => { const id = nextId++; sentAt[id] = performance.now() - t0; ws.send(req(method, params, id)); return id; };
  send('ping', []);
  for (const [m, limit] of subs) send('depth_subscribe', [m, limit, '0', true]);
  send('bookTicker_subscribe', ['BTC_PERP']);
  send('premiumIndex_subscribe', []);
  const pinger = setInterval(() => send('ping', []), 20_000);

  // REST compare on BTC_PERP after 20 s: top 20 sizes by price against the local book.
  await sleep(20_000);
  const rest = await (await fetch(`${API}/orderbook/BTC_PERP?limit=20`)).json();
  const local = books.BTC_PERP.top(20);
  const restBid = new Map(rest.bids); const restAsk = new Map(rest.asks);
  let equal = 0; let compared = 0;
  for (const [p, s] of local.bids) { if (restBid.has(p)) { compared++; if (restBid.get(p) === s) equal++; } }
  for (const [p, s] of local.asks) { if (restAsk.has(p)) { compared++; if (restAsk.get(p) === s) equal++; } }
  log('rest_compare', { market: 'BTC_PERP', restTop: { bid: rest.bids[0], ask: rest.asks[0] }, localTop: { bid: local.bids[0], ask: local.asks[0] }, pricesInBoth: compared, sizesEqual: equal, localBidsSample: local.bids.slice(0, 5), restBidsSample: rest.bids.slice(0, 5) });
  const pepe = await (await fetch(`${API}/orderbook/PEPE_PERP?limit=5`)).json();
  log('rest_units', { market: 'PEPE_PERP', bids: pepe.bids, asks: pepe.asks });

  await sleep(WINDOW_MS - 20_000);
  clearInterval(pinger);
  const elapsed = (performance.now() - t0) / 1000;
  log('book', { windowS: Math.round(elapsed), msgs, bytes, binaryFrames, acks: acks.slice(0, 12), pongs: pongs.slice(0, 5), serverPings: info.pings, firstFrames, other: other.slice(0, 5) });
  for (const [m] of subs) log('book_stats', { market: m, ...summarize(stats[m], books[m]) });
  const { lastTop, lastId, messageMinusTransactionMs, arrivalMinusMessageMs, ...bt } = bookTicker;
  log('book_ticker', { ...bt, messageMinusTransactionMs: dist(messageMinusTransactionMs), arrivalMinusMessageMs: dist(arrivalMinusMessageMs) });
  const g = [...premium.gapsMs].sort((a, b) => a - b);
  const { btcLast, lastAt, btcIndexChangedAt, gapsMs, series, prevAll, indexChangedPerMsg, markChangedPerMsg, fundingChangedPerMsg, markets: pmarkets, serverMinusArrivalMs, ...pr } = premium;
  const restIds = new Set(rows.map((r) => r.ticker_id));
  log('premium_index', { ...pr, recordsPerMsg: [...premium.recordsPerMsg], gapMs: g.length ? { min: g[0], median: g[Math.floor(g.length / 2)], max: g.at(-1) } : null, btcLast, notInRestFutures: (pmarkets ?? []).filter((m) => !restIds.has(m)), restNotInPush: [...restIds].filter((m) => !(pmarkets ?? []).includes(m)), recordLength: prevAll && Object.values(prevAll)[0].length, indexChangedPerMsg: dist(indexChangedPerMsg), markChangedPerMsg: dist(markChangedPerMsg), fundingChangedPerMsg: dist(fundingChangedPerMsg), arrivalMinusRecordFieldMs: dist(serverMinusArrivalMs) });
  log('premium_series', { series });
  ws.close();
  await errorSocket();
}

async function errorSocket() {
  const { ws, info, ready, t0 } = open(WS_URL);
  await ready;
  const frames = [];
  const depthSeen = {};
  const snapSeen = {};
  const lastU = {};
  const dupU = {};
  ws.on('message', (data) => {
    const text = data.toString();
    let j; try { j = JSON.parse(text); } catch { frames.push({ raw: text.slice(0, 200) }); return; }
    if (j.method === 'depth_update') { const m = j.params[2]; depthSeen[m] = (depthSeen[m] ?? 0) + 1; if (j.params[0]) snapSeen[m] = (snapSeen[m] ?? 0) + 1; const u = j.params[1].update_id; if (lastU[m] === u) dupU[m] = (dupU[m] ?? 0) + 1; lastU[m] = u; return; }
    if (j.method) return;
    frames.push({ atMs: Math.round(performance.now() - t0), frame: j });
  });
  const tries = [
    ['unknown market', 'depth_subscribe', ['NOPE_PERP', 20, '0', true]],
    ['limit 25', 'depth_subscribe', ['BTC_PERP', 25, '0', true]],
    ['limit 200', 'depth_subscribe', ['BTC_PERP', 200, '0', true]],
    ['three params', 'depth_subscribe', ['BTC_PERP', 20, '0']],
    ['unknown method', 'depth_nope', []],
    ['premiumIndex on spot', 'premiumIndex_subscribe', ['BTC_USDT']],
    ['private without auth', 'balanceSpot_subscribe', ['USDT']],
  ];
  for (const [label, method, params] of tries) {
    const id = nextId++;
    ws.send(req(method, params, id));
    await sleep(400);
    log('ws_error', { label, sent: { id, method, params }, reply: frames.find((f) => f.frame?.id === id)?.frame ?? null });
  }
  // multi_depth semantics: A then B with true keeps both, C with false keeps only C.
  depthSeen.ETH_PERP = 0; depthSeen.SOL_PERP = 0; depthSeen.XRP_PERP = 0;
  ws.send(req('depth_subscribe', ['ETH_PERP', 5, '0', true]));
  ws.send(req('depth_subscribe', ['SOL_PERP', 5, '0', true]));
  await sleep(3000);
  const both = { ...depthSeen };
  ws.send(req('depth_subscribe', ['XRP_PERP', 5, '0', false]));
  await sleep(1000);
  for (const k of Object.keys(depthSeen)) depthSeen[k] = 0;
  await sleep(4000);
  log('ws_multi_depth', { afterTwoTrueSubscribes: both, afterFalseSubscribeFramesIn4s: { ...depthSeen } });
  // The same market twice with true.
  for (const k of Object.keys(snapSeen)) snapSeen[k] = 0;
  ws.send(req('depth_subscribe', ['XRP_PERP', 5, '0', true]));
  await sleep(300);
  for (const k of Object.keys(depthSeen)) depthSeen[k] = 0;
  await sleep(4000);
  log('ws_same_market_twice', { framesIn4s: { ...depthSeen }, snapshotsSinceResubscribe: { ...snapSeen }, repeatedUpdateIds: { ...dupU } });
  const before = frames.length;
  const sentAtMs = Math.round(performance.now() - t0);
  ws.send('this is not json');
  await sleep(2000);
  log('ws_invalid_json', { sentAtMs, replies: frames.slice(before), closed: info.closed });
  if (!info.closed) ws.close();
}

async function batchMode() {
  const rows = await futuresRows();
  const ids = rows.map((r) => r.ticker_id);
  const LIMIT = 50;
  const WINDOW_MS = 60_000;
  const { ws, info, ready, t0 } = open(WS_URL);
  await ready;
  const stats = Object.fromEntries(ids.map((m) => [m, newStats()]));
  const books = Object.fromEntries(ids.map((m) => [m, new Book()]));
  const other = [];
  const errors = [];
  let acks = 0;
  const onDepth = depthHandler(stats, books, t0, other);
  let msgs = 0; let bytes = 0; let parseNs = 0n;
  const perSecond = [];
  let secondCount = 0; let secondStart = performance.now();
  ws.on('message', (data) => {
    msgs++; bytes += data.length; secondCount++;
    const now = performance.now();
    if (now - secondStart >= 1000) { perSecond.push(secondCount); secondCount = 0; secondStart = now; }
    const p0 = process.hrtime.bigint();
    const j = JSON.parse(data.toString());
    parseNs += process.hrtime.bigint() - p0;
    if (j.method === 'depth_update') { onDepth(j, data.length); return; }
    if (j.error) { errors.push(j); return; }
    if (j.result?.status === 'success') { acks++; return; }
    if (j.result === 'pong') return;
    other.push(JSON.stringify(j).slice(0, 200));
  });
  const subStart = performance.now();
  for (const m of ids) ws.send(req('depth_subscribe', [m, LIMIT, '0', true]));
  const pinger = setInterval(() => ws.send(req('ping', [])), 20_000);
  await sleep(WINDOW_MS);
  clearInterval(pinger);
  const all = ids.map((m) => stats[m]);
  const snapTimes = all.map((s) => s.firstSnapshotMs).filter((x) => x !== null).sort((a, b) => a - b);
  const ps = [...perSecond].sort((a, b) => a - b);
  log('batch', {
    markets: ids.length, limit: LIMIT, windowS: WINDOW_MS / 1000, acks, errors: errors.slice(0, 3), errorCount: errors.length,
    subscribeSendMs: Math.round(performance.now() - subStart - WINDOW_MS),
    withSnapshot: snapTimes.length, lastFirstSnapshotMs: snapTimes.at(-1), firstFirstSnapshotMs: snapTimes[0],
    noSnapshot: ids.filter((m) => stats[m].firstSnapshotMs === null),
    msgs, framesPerSecond: { mean: Math.round(msgs / (WINDOW_MS / 1000)), median: ps[Math.floor(ps.length / 2)], max: ps.at(-1) },
    bytesPerSecond: Math.round(bytes / (WINDOW_MS / 1000)), bytesPerFrame: Math.round(bytes / msgs), parseUsPerFrame: Number(parseNs / BigInt(msgs)) / 1000,
    deltas: all.reduce((a, s) => a + s.deltas, 0), gaps: all.reduce((a, s) => a + s.gaps, 0), gapSamples: ids.filter((m) => stats[m].gaps).slice(0, 5).map((m) => ({ m, samples: stats[m].gapSamples })),
    keepaliveSnapshots: all.reduce((a, s) => a + s.keepaliveSnapshots, 0),
    marketsWithKeepalive: all.filter((s) => s.keepaliveSnapshots > 0).length,
    maxIdleMsOverMarkets: Math.max(...all.map((s) => s.maxIdleMs)),
    maxBidsHeld: Math.max(...ids.map((m) => books[m].maxBids)), maxAsksHeld: Math.max(...ids.map((m) => books[m].maxAsks)),
    oneSided: ids.filter((m) => books[m].bids.size === 0 || books[m].asks.size === 0).map((m) => `${m} bids ${books[m].bids.size} asks ${books[m].asks.size}`),
    keepaliveIdJumps: { recorded: all.flatMap((s) => s.snapshotIdJumps).length, zero: all.flatMap((s) => s.snapshotIdJumps).filter((x) => x === 0).length, negative: all.flatMap((s) => s.snapshotIdJumps).filter((x) => x < 0).length, positive: all.flatMap((s) => s.snapshotIdJumps).filter((x) => x > 0).length, negativeSamples: all.flatMap((s) => s.snapshotIdJumps).filter((x) => x < 0).slice(0, 5) },
    keepaliveGapMs: dist(all.flatMap((s) => s.keepaliveGapsMs)),
    serverPings: info.pings.length, closed: info.closed, other: other.slice(0, 3),
  });
  ws.close();
}

async function silenceMode() {
  const CAP_MS = 75_000;
  const rows = await futuresRows();
  const quiet = rows.sort((a, b) => Number(a.money_volume) - Number(b.money_volume))[1].ticker_id;
  const variants = [
    { id: 'idle', setup: () => {} },
    { id: 'subscribed_no_ping', setup: (ws) => ws.send(req('depth_subscribe', [quiet, 5, '0', true])) },
    { id: 'subscribed_app_ping_50s', setup: (ws, c) => { ws.send(req('depth_subscribe', [quiet, 5, '0', true])); c.timer = setInterval(() => ws.send(req('ping', [])), 50_000); } },
    { id: 'protocol_ping_20s', setup: (ws, c) => { c.timer = setInterval(() => ws.ping(), 20_000); } },
  ];
  const conns = [];
  for (const v of variants) {
    const c = { id: v.id, msgs: 0, lastMsgMs: null, pongs: 0 };
    const o = open(WS_URL);
    await o.ready;
    Object.assign(c, o);
    o.ws.on('message', () => { c.msgs++; c.lastMsgMs = Math.round(performance.now() - o.t0); });
    o.ws.on('pong', () => { c.pongs++; });
    v.setup(o.ws, c);
    conns.push(c);
  }
  const t = performance.now();
  while (performance.now() - t < CAP_MS && conns.some((c) => !c.info.closed)) await sleep(500);
  for (const c of conns) {
    clearInterval(c.timer);
    log('silence', { id: c.id, market: quiet, serverPings: c.info.pings.length, closed: c.info.closed, msgs: c.msgs, lastMsgMs: c.lastMsgMs, protocolPongs: c.pongs, capMs: CAP_MS });
    if (!c.info.closed) c.ws.close();
  }
}

async function deflateMode() {
  const { ws, info, ready } = open(WS_URL, { perMessageDeflate: true });
  await ready;
  let first = null;
  ws.on('message', (d, isBinary) => { if (!first) first = { isBinary, text: d.toString().slice(0, 200) }; });
  ws.send(req('depth_subscribe', ['BTC_PERP', 5, '0', true]));
  await sleep(2000);
  log('deflate', { requested: true, negotiated: info.extensions, secWebSocketExtensions: info.upgradeHeaders?.['sec-websocket-extensions'] ?? null, first });
  ws.close();
}

async function legacyMode() {
  const { ws, info, ready, t0 } = open(LEGACY_URL);
  try { await ready; } catch (e) { log('legacy', { url: LEGACY_URL, error: e.message, info }); return; }
  const frames = [];
  ws.on('message', (d) => { if (frames.length < 4) frames.push({ atMs: Math.round(performance.now() - t0), text: d.toString().slice(0, 300) }); });
  ws.send(req('ping', []));
  ws.send(req('depth_subscribe', ['BTC_PERP', 5, '0', true]));
  await sleep(3000);
  log('legacy', { url: LEGACY_URL, openMs: info.openMs, cfRay: info.upgradeHeaders?.['cf-ray'], frames, closed: info.closed });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
log('start', { at: new Date().toISOString(), mode });
if (mode === 'book') await bookMode();
else if (mode === 'batch') await batchMode();
else if (mode === 'silence') await silenceMode();
else if (mode === 'deflate') await deflateMode();
else if (mode === 'legacy') await legacyMode();
else { console.error(`unknown mode ${mode}`); process.exit(1); }
log('end', { at: new Date().toISOString() });
process.exit(0);
