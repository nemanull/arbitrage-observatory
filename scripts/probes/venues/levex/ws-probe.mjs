// LeveX web client socket probe: the perpetual ticker catalog, the order book stream, keepalive, silence, errors and deflate.
// LeveX publishes no API, so this reads the socket its own web page opens for a logged-out visitor, wss://ws100.levex.com.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/levex/ws-probe.mjs [book|silence|deflate]
//   book     one socket for about 61 s: perp24HTicker, orderbook on BTCUSDT, then eight more books on the same socket, an unknown and a duplicate symbol, the USDC and coin-M twins, pings every 3 s like the web client.
//   silence  four sockets for up to 90 s: no frame at all, a busy book with no ping, pings every 3 s or every 20 s with no subscription.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/levex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://ws100.levex.com';
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function capture(name, text, limit = 4000) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, limit) + '\n');
}

// The web client appends a per page counter as ?no=<n> and adds a numeric id to every request.
function open(no, deflate = false) {
  const t0 = Date.now();
  const ws = new WebSocket(`${URL_WS}/?no=${no}`, {
    perMessageDeflate: deflate,
    headers: { Origin: 'https://levex.com' },
  });
  let id = 1;
  const pending = new Map();
  ws.t0 = t0;
  ws.req = (method, params) => {
    const rid = id++;
    pending.set(rid, { method, params, at: Date.now() });
    const text = JSON.stringify({ method, params, id: rid });
    capture(`out-${no}.jsonl`, text);
    ws.send(text);
    return rid;
  };
  ws.pending = pending;
  ws.on('unexpected-response', (_req, res) => log('refused', { no, status: res.statusCode, headers: res.headers }));
  return ws;
}

// Rows arrive as arrays whose column names ride on the snapshot as `keys`, which the web client zips back into objects.
function zip(rows, keys) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (Array.isArray(r) && keys ? Object.fromEntries(keys.map((k, i) => [k, r[i]])) : r));
}

const cmp = (a, b) => Number(a) - Number(b);

async function book() {
  const ws = open(0);
  const stats = new Map(); // symbol to book stats
  const pongs = [];
  const acks = [];
  const tickerFrames = [];
  let tickerKeys = null;
  const tickerSeen = new Map(); // symbol to { changes of index, mark, fundingRate, last, n }
  const methods = {};
  let firstTickerRows = [];
  let firstTickerAt = 0;
  const lagMs = []; // arrival time minus the frame's own timestamp, clock offset plus one way latency

  const st = (sym) => {
    if (!stats.has(sym)) {
      stats.set(sym, {
        snap: 0, inc: 0, snapTimes: [], incTimes: [], firstAt: null, depthVals: new Set(),
        bids: new Map(), asks: new Map(), maxBids: 0, maxAsks: 0,
        snapOrderOk: 0, snapOrderBad: 0, incUnsorted: 0, tsBack: 0, lastTs: null,
        crossedAfterInc: 0, snapMatches: 0, snapMismatches: 0, snapTsEqualsLastInc: 0, zeroSize: 0,
        multiLevelInc: 0, emptyInc: 0, sample: {},
      });
    }
    return stats.get(sym);
  };

  const topN = (m, side, n) => [...m.entries()].sort((a, b) => (side === 'bid' ? cmp(b[0], a[0]) : cmp(a[0], b[0]))).slice(0, n);

  ws.on('open', async () => {
    log('open', { ms: Date.now() - ws.t0 });
    const ping = setInterval(() => { if (ws.readyState === ws.OPEN) ws.req('server.ping', []); }, 3000);
    ws.req('server.ping', []);
    ws.req('perp24HTicker.subscribe', {});
    ws.req('orderbook.subscribe', { symbol: 'BTCUSDT' });
    await sleep(20000);
    for (const s of ['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'XAUUSDT', 'DOGEUSDT', 'TLMUSDT', 'KOUSDT', 'STORJUSDT']) ws.req('orderbook.subscribe', { symbol: s });
    await sleep(10000);
    ws.req('orderbook.subscribe', { symbol: 'NOPEUSDT' });
    ws.req('orderbook.subscribe', { symbol: 'BTCUSDT' });
    ws.req('nope.subscribe', {});
    await sleep(5000);
    ws.req('orderbook.subscribe', { symbol: 'BTCUSDC' });
    ws.req('orderbook.subscribe', { symbol: 'BTCUSD' });
    ws.req('orderbook.subscribe', { symbol: 'cBTCUSD' });
    await sleep(15000);
    ws.req('orderbook.unsubscribe', []);
    await sleep(8000);
    ws.send('not json');
    await sleep(3000);
    clearInterval(ping);
    ws.close();
  });

  ws.on('message', (raw) => {
    const at = Date.now();
    const text = raw.toString();
    let j;
    try { j = JSON.parse(text); } catch { log('nonjson', { text: text.slice(0, 200) }); return; }
    const m = j.method ?? (j.id ? 'reply' : 'other');
    methods[m] = (methods[m] ?? 0) + 1;
    if (m === 'reply') {
      const p = ws.pending.get(j.id);
      if (p?.method === 'server.ping') pongs.push(at - p.at);
      else acks.push({ ms: at - (p?.at ?? at), method: p?.method, params: p?.params, error: j.error, result: j.result });
      if (p?.method !== 'server.ping') capture('replies.jsonl', text);
      return;
    }
    if (m === 'perp24HTicker.update') {
      const d = j.data;
      if (d.keys) tickerKeys = d.keys;
      const rows = zip(d.tickers, tickerKeys);
      tickerFrames.push({ at: at - ws.t0, type: d.type, n: rows.length, bytes: text.length });
      if (d.type === 'snapshot') { capture('ticker.jsonl', text, 100000); firstTickerRows = rows; firstTickerAt = at; } else if (tickerFrames.length <= 3) capture('ticker.jsonl', text);
      for (const r of rows) {
        const s = tickerSeen.get(r.symbol) ?? { n: 0, idx: 0, mark: 0, fr: 0, lfr: 0, last: 0, prev: null, row: null };
        if (s.prev) {
          if (r.indexPrice !== undefined && r.indexPrice !== s.prev.indexPrice) s.idx++;
          if (r.markPrice !== undefined && r.markPrice !== s.prev.markPrice) s.mark++;
          if (r.fundingRate !== undefined && r.fundingRate !== s.prev.fundingRate) s.fr++;
          if (r.lastFundingRate !== undefined && r.lastFundingRate !== s.prev.lastFundingRate) s.lfr++;
          if (r.lastPrice !== undefined && r.lastPrice !== s.prev.lastPrice) s.last++;
        }
        s.n++;
        s.prev = { ...(s.prev ?? {}), ...r };
        s.row = s.prev;
        tickerSeen.set(r.symbol, s);
      }
      return;
    }
    if (m === 'orderbook.update') {
      const d = j.data;
      const s = st(d.symbol);
      s.depthVals.add(d.depth);
      if (s.firstAt === null) s.firstAt = at - ws.t0;
      const ts = BigInt(d.timestamp);
      if (d.type === 'incremental') lagMs.push(at - Number(ts / 1000000n));
      if (s.lastTs !== null && ts < s.lastTs) s.tsBack++;
      if (d.type === 'snapshot') {
        capture(`book-${d.symbol}.jsonl`, text);
        if (s.lastTs !== null && ts === s.lastTs) s.snapTsEqualsLastInc++;
        const bidsDesc = d.bids.every((l, i) => i === 0 || cmp(d.bids[i - 1][0], l[0]) > 0);
        const asksAsc = d.asks.every((l, i) => i === 0 || cmp(d.asks[i - 1][0], l[0]) < 0);
        if (bidsDesc && asksAsc) s.snapOrderOk++; else s.snapOrderBad++;
        if (s.snap > 0) {
          const mb = topN(s.bids, 'bid', d.bids.length).map((l) => l.join(':'));
          const ma = topN(s.asks, 'ask', d.asks.length).map((l) => l.join(':'));
          const same = JSON.stringify(mb) === JSON.stringify(d.bids.map((l) => l.join(':'))) && JSON.stringify(ma) === JSON.stringify(d.asks.map((l) => l.join(':')));
          if (same) s.snapMatches++; else { s.snapMismatches++; if (!s.sample.mismatch) s.sample.mismatch = { kept: [mb.slice(0, 3), ma.slice(0, 3)], snap: [d.bids.slice(0, 3), d.asks.slice(0, 3)] }; }
        }
        s.snap++;
        s.snapTimes.push(at);
        s.bids = new Map(d.bids.map((l) => [l[0], l[1]]));
        s.asks = new Map(d.asks.map((l) => [l[0], l[1]]));
        if (!s.sample.snapKeys) s.sample.snapKeys = Object.keys(d);
        if (d.bids.length === 0 || d.asks.length === 0) s.sample.oneSided = { bids: d.bids.length, asks: d.asks.length };
      } else {
        if (s.inc < 3 || (d.bids.length + d.asks.length > 2 && !s.sample.bigInc)) { capture(`book-${d.symbol}.jsonl`, text); if (d.bids.length + d.asks.length > 2) s.sample.bigInc = true; }
        s.inc++;
        s.incTimes.push(at);
        if (d.bids.length + d.asks.length === 0) s.emptyInc++;
        if (d.bids.length > 1 || d.asks.length > 1) s.multiLevelInc++;
        const bOrd = d.bids.every((l, i) => i === 0 || cmp(d.bids[i - 1][0], l[0]) > 0);
        const aOrd = d.asks.every((l, i) => i === 0 || cmp(d.asks[i - 1][0], l[0]) < 0);
        if (!bOrd || !aOrd) s.incUnsorted++;
        for (const [p, q] of d.bids) { if (Number(q) === 0) { s.zeroSize++; s.bids.delete(p); } else s.bids.set(p, q); }
        for (const [p, q] of d.asks) { if (Number(q) === 0) { s.zeroSize++; s.asks.delete(p); } else s.asks.set(p, q); }
        const bb = Math.max(...[...s.bids.keys()].map(Number));
        const ba = Math.min(...[...s.asks.keys()].map(Number));
        if (s.bids.size && s.asks.size && bb >= ba) s.crossedAfterInc++;
      }
      s.lastTs = ts;
      s.maxBids = Math.max(s.maxBids, s.bids.size);
      s.maxAsks = Math.max(s.maxAsks, s.asks.size);
      return;
    }
    capture('other.jsonl', text);
    log('other', { text: text.slice(0, 300) });
  });

  await new Promise((r) => ws.on('close', (code, reason) => { log('close', { code, reason: reason.toString(), ms: Date.now() - ws.t0 }); r(); }));

  log('methods', methods);
  pongs.sort(cmp);
  log('pong', { n: pongs.length, min: pongs[0], median: pongs[Math.floor(pongs.length / 2)], max: pongs.at(-1) });
  for (const a of acks) log('ack', a);
  const gaps = (arr) => arr.slice(1).map((t, i) => t - arr[i]).sort(cmp);
  for (const [sym, s] of stats) {
    const sg = gaps(s.snapTimes);
    const ig = gaps(s.incTimes);
    log('book', {
      sym, firstAtMs: s.firstAt, depth: [...s.depthVals], snap: s.snap, inc: s.inc,
      snapAtMs: s.snapTimes.map((t) => t - ws.t0),
      snapGapMs: sg.length ? { min: sg[0], median: sg[Math.floor(sg.length / 2)], max: sg.at(-1) } : null,
      incGapMaxMs: ig.at(-1) ?? null, emptyInc: s.emptyInc, multiLevelInc: s.multiLevelInc, zeroSize: s.zeroSize,
      snapOrderOk: s.snapOrderOk, snapOrderBad: s.snapOrderBad, incUnsorted: s.incUnsorted, tsBack: s.tsBack,
      crossedAfterInc: s.crossedAfterInc, snapMatchesKept: s.snapMatches, snapMismatchesKept: s.snapMismatches,
      snapTsEqualsLastInc: s.snapTsEqualsLastInc, maxBids: s.maxBids, maxAsks: s.maxAsks,
      touch: [topN(s.bids, 'bid', 1)[0], topN(s.asks, 'ask', 1)[0]], sample: s.sample,
    });
  }
  const tg = tickerFrames.map((f) => f.at);
  log('ticker', {
    frames: tickerFrames.length, types: tickerFrames.reduce((o, f) => ((o[f.type] = (o[f.type] ?? 0) + 1), o), {}),
    firstRows: tickerFrames[0]?.n, firstBytes: tickerFrames[0]?.bytes,
    incRows: (() => { const r = tickerFrames.filter((f) => f.type !== 'snapshot').map((f) => f.n).sort(cmp); return { min: r[0], median: r[Math.floor(r.length / 2)], max: r.at(-1) }; })(),
    incBytesMedian: (() => { const b = tickerFrames.filter((f) => f.type !== 'snapshot').map((f) => f.bytes).sort(cmp); return b[Math.floor(b.length / 2)]; })(),
    gapMaxMs: gaps(tg).at(-1) ?? null, gapMedianMs: gaps(tg)[Math.floor(gaps(tg).length / 2)] ?? null, keys: tickerKeys,
    symbols: tickerSeen.size,
  });
  const syms = [...tickerSeen.keys()];
  const bySuffix = {};
  for (const s of syms) { const k = s.endsWith('USDT') ? 'USDT' : s.endsWith('USDC') ? 'USDC' : s.endsWith('USD') ? 'USD' : 'other'; bySuffix[k] = (bySuffix[k] ?? 0) + 1; }
  log('catalog', { bySuffix, other: syms.filter((s) => !/(USDT|USDC|USD)$/.test(s)).slice(0, 20) });
  for (const sym of ['BTCUSDT', 'BTCUSDC', 'BTCUSD', 'ETHUSDT', 'XAUUSDT', 'STORJUSDT']) {
    const s = tickerSeen.get(sym);
    if (s) log('tickerRow', { sym, updates: s.n, indexChanges: s.idx, markChanges: s.mark, fundingChanges: s.fr, lastFundingChanges: s.lfr, lastChanges: s.last, row: s.row });
  }
  const fr = {};
  let markZero = 0, idxZero = 0, markOverIdx = [];
  for (const s of tickerSeen.values()) {
    fr[s.row.fundingRate] = (fr[s.row.fundingRate] ?? 0) + 1;
    if (!Number(s.row.markPrice)) markZero++;
    if (!Number(s.row.indexPrice)) idxZero++;
    else markOverIdx.push(Math.round((Number(s.row.markPrice) / Number(s.row.indexPrice) - 1) * 1e6));
  }
  markOverIdx.sort(cmp);
  lagMs.sort(cmp);
  log('clock', { n: lagMs.length, min: lagMs[0], p50: lagMs[Math.floor(lagMs.length / 2)], max: lagMs.at(-1) });
  const act = firstTickerRows.filter((r) => Number(r.markPrice) > 0);
  let eqLast = 0, eqMedian = 0, inBook = 0, idxMissing = 0, nearP1 = 0, betweenP1Last = 0;
  // Share of an 8 h interval left to the next 00:00, 08:00 or 16:00 UTC settlement, at the snapshot's arrival.
  const H8 = 8 * 3600e3;
  const tau = (Math.ceil(firstTickerAt / H8) * H8 - firstTickerAt) / H8;
  const prem = [];
  const unit = [];
  for (const r of act) {
    const m = Number(r.markPrice), b = Number(r.bidPrice), a = Number(r.askPrice), l = Number(r.lastPrice);
    if (m === l) eqLast++;
    if (m === [b, a, l].sort(cmp)[1]) eqMedian++;
    if (m >= b && m <= a) inBook++;
    if (Number(r.indexPrice) > 0) {
      prem.push(Math.round((m / Number(r.indexPrice) - 1) * 1e6));
      const p1 = Number(r.indexPrice) * (1 + Number(r.fundingRate) * tau); // index plus the funding still to accrue
      if (Math.abs(m / p1 - 1) < 20e-6) nearP1++;
      if (m >= Math.min(p1, l) * (1 - 1e-6) && m <= Math.max(p1, l) * (1 + 1e-6)) betweenP1Last++;
    } else idxMissing++;
    if (Number(r.volume) > 0 && !r.symbol.startsWith('c')) unit.push({ s: r.symbol, k: Number(r.turnover) / (Number(r.volume) * l) });
  }
  prem.sort(cmp);
  unit.sort((x, y) => x.k - y.k);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
  log('markShape', { active: act.length, inactive: firstTickerRows.length - act.length, markEqualsLast: eqLast, markEqualsMedianOfBidAskLast: eqMedian, markInsideBidAsk: inBook, activeWithoutIndex: idxMissing,
    tau: Number(tau.toFixed(4)), markWithin20ppmOfIndexTimesOnePlusRateTau: nearP1, markBetweenThatAndLast: betweenP1Last,
    premiumPpm: { n: prem.length, min: prem[0], p05: q(prem, 0.05), p50: q(prem, 0.5), p95: q(prem, 0.95), max: prem.at(-1) },
    bigPremium: act.filter((r) => Number(r.indexPrice) > 0 && Math.abs(Number(r.markPrice) / Number(r.indexPrice) - 1) > 0.005).map((r) => `${r.symbol} ${r.markPrice}/${r.indexPrice}`).slice(0, 12) });
  log('sizeUnit', { note: 'turnover / (volume x last), 1 means volume counts base units', n: unit.length, min: unit[0], p05: q(unit, 0.05)?.k, p50: q(unit, 0.5)?.k, p95: q(unit, 0.95)?.k, max: unit.at(-1), off: unit.filter((u) => Math.abs(u.k - 1) > 0.2).map((u) => `${u.s}:${u.k.toFixed(2)}`).slice(0, 20) });
  const fam = (sym) => (sym.startsWith('c') && sym.endsWith('USD') ? 'coinM' : sym.endsWith('USDC') ? 'USDC' : 'USDT');
  const activeBase = { USDT: new Set(), USDC: new Set(), coinM: new Set() };
  for (const r of act) activeBase[fam(r.symbol)].add(fam(r.symbol) === 'coinM' ? r.symbol.slice(1, -3) : r.symbol.replace(/USDC?T?$/, ''));
  log('families', { active: Object.fromEntries(Object.entries(activeBase).map(([k, v]) => [k, v.size])), onAllThree: [...activeBase.coinM].filter((b) => activeBase.USDC.has(b) && activeBase.USDT.has(b)) });
  log('coinM', { symbols: firstTickerRows.filter((r) => r.symbol.startsWith('c')).map((r) => `${r.symbol}${Number(r.markPrice) > 0 ? '' : ' (mark 0)'}`) });
  const inact = firstTickerRows.filter((r) => !(Number(r.markPrice) > 0));
  log('inactive', { n: inact.length, bidAskZero: inact.filter((r) => !Number(r.bidPrice) && !Number(r.askPrice)).length, indexZero: inact.filter((r) => !Number(r.indexPrice)).length, symbols: inact.map((r) => r.symbol) });
  for (const sym of ['MTLUSDT']) { const r = firstTickerRows.find((x) => x.symbol === sym); if (r) log('snapshotRow', { tau: Number(tau.toFixed(4)), row: r }); }
  log('tickerAll', { fundingRates: fr, markZero, idxZero, markPremiumPpm: { min: markOverIdx[0], p50: markOverIdx[Math.floor(markOverIdx.length / 2)], max: markOverIdx.at(-1) } });
}

async function silence() {
  const results = [];
  const run = (no, label, setup) => new Promise((resolve) => {
    const ws = open(no);
    let timer = null;
    let frames = 0;
    ws.on('open', () => { setup(ws, (t) => { timer = t; }); });
    ws.on('message', () => { frames++; });
    ws.on('ping', () => log('serverPing', { label, ms: Date.now() - ws.t0 }));
    ws.on('close', (code, reason) => { clearInterval(timer); results.push({ label, closedAtMs: Date.now() - ws.t0, code, reason: reason.toString(), frames }); resolve(); });
    ws.on('error', (e) => log('error', { label, e: e.message }));
    setTimeout(() => { if (ws.readyState === ws.OPEN) { ws.close(); } }, 90000);
  });
  await Promise.all([
    run(10, 'no frames', () => {}),
    run(11, 'busy book BTCUSDT, no ping', (ws) => ws.req('orderbook.subscribe', { symbol: 'BTCUSDT' })),
    run(12, 'ping every 3 s, no subscription', (ws, keep) => keep(setInterval(() => ws.req('server.ping', []), 3000))),
    run(13, 'ping every 20 s, no subscription', (ws, keep) => keep(setInterval(() => ws.req('server.ping', []), 20000))),
  ]);
  for (const r of results) log('silence', r);
}

async function deflate() {
  const ws = open(20, true);
  await new Promise((resolve) => {
    ws.on('upgrade', (res) => log('upgrade', { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server, pop: res.headers['x-amz-cf-pop'] }));
    ws.on('open', () => { log('open', { ms: Date.now() - ws.t0, negotiated: ws.extensions }); ws.close(); });
    ws.on('close', resolve);
    ws.on('error', (e) => { log('error', { e: e.message }); resolve(); });
  });
}

const mode = process.argv[2] ?? 'book';
if (mode === 'book') await book();
else if (mode === 'silence') await silence();
else if (mode === 'deflate') await deflate();
else console.log('modes: book | silence | deflate');
process.exit(0);
