// BitTap futures WebSocket probe: depth channel shape and cadence, the all-market mark price stream, errors, a batch of perpetuals on one connection, keepalive and silence, deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like the engine's book feeds.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bittap/ws-probe.mjs [book|mark|errors|batch|silence|deflate]
//   book     f_depth30 at the finest scale on four perps for 45 s, other depth levels on BTC, and a REST depth compare. About 50 s.
//   mark     f_markPrice_all and f_ticker_all for 60 s, cadence and how often mark, index and rate change.
//   errors   unknown symbol, wrong scale, settled symbol, unknown method, PING and time requests. About 10 s.
//   batch    f_depth30 on 150 open perps in one subscribe frame for 30 s.
//   silence  three sockets for 70 s: subscribed and silent, unsubscribed and silent, subscribed with an application PING every 20 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep a few raw frames. Recorded in docs/profiles/bittap/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://stream.bittap.com/endpoint?format=JSON';
const CATALOG_URL = 'https://api.bittap.com/asset/public/v1/exchange/info'; // web app catalog, carries depths and multiplier
const REST_DEPTH = 'https://openapi.bittap.com/fmapi/v1/depth';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

async function catalog() {
  const j = await (await fetch(CATALOG_URL)).json();
  return j.data.contractSymbols.filter((s) => s.status === 'OPEN');
}

function open(label, { deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  const st = { label, t0, pings: 0, frames: 0, closed: null };
  ws.on('upgrade', (r) => log('upgrade', { label, status: r.statusCode, ext: r.headers['sec-websocket-extensions'] ?? null, cfRay: r.headers['cf-ray'] }));
  ws.on('ping', () => st.pings++);
  ws.on('close', (code, reason) => {
    st.closed = { code, reason: reason.toString(), afterMs: Date.now() - t0 };
    log('close', { label, ...st.closed, frames: st.frames, serverPings: st.pings });
  });
  ws.on('error', (e) => log('error', { label, message: e.message }));
  const ready = new Promise((res) => ws.on('open', () => { log('open', { label, ms: Date.now() - t0 }); res(); }));
  return { ws, st, ready };
}

const send = (ws, method, params, id) => ws.send(JSON.stringify({ method, ...(params ? { params } : {}), id }));

async function book() {
  const cat = await catalog();
  const pick = ['BTC-USDT-M', 'ETH-USDT-M', 'LSK-USDT-M', 'NMR-USDT-M'].map((id) => cat.find((s) => s.symbolId === id)).filter(Boolean);
  const streams = pick.map((s) => `f_depth30@${s.symbolId}_${s.depths[0]}`);
  const extra = ['f_depth5', 'f_depth10', 'f_depth20', 'f_depth50', 'f_depth100', 'f_depth'].map((l) => `${l}@BTC-USDT-M_0.1`);
  const { ws, st, ready } = open('book');
  const per = {};
  const acks = [];
  ws.on('message', (d) => {
    st.frames++;
    const m = JSON.parse(d.toString());
    if (!m.e) { acks.push(m); capture('book-acks.txt', d.toString()); return; }
    const key = `${m.e}@${m.s}_${m.i}`;
    const p = (per[key] ??= { n: 0, first: Date.now() - st.t0, idDown: 0, idSame: 0, sameBody: 0, bidsMin: 1e9, bidsMax: 0, asksMin: 1e9, asksMax: 0, bidOrderBad: 0, askOrderBad: 0, crossed: 0, gaps: [], last: null, lastBody: null, lastAt: 0, sizes: new Set() });
    p.n++;
    if (p.n <= 2) capture('book-frames.txt', d.toString());
    const body = JSON.stringify([m.bids, m.asks]);
    if (p.last !== null) {
      if (m.lastUpdateId < p.last) p.idDown++;
      if (m.lastUpdateId === p.last) p.idSame++;
      if (body === p.lastBody) p.sameBody++;
      p.gaps.push(Date.now() - p.lastAt);
    }
    p.last = m.lastUpdateId; p.lastBody = body; p.lastAt = Date.now();
    p.bidsMin = Math.min(p.bidsMin, m.bids.length); p.bidsMax = Math.max(p.bidsMax, m.bids.length);
    p.asksMin = Math.min(p.asksMin, m.asks.length); p.asksMax = Math.max(p.asksMax, m.asks.length);
    for (let k = 1; k < m.bids.length; k++) if (+m.bids[k][0] >= +m.bids[k - 1][0]) { p.bidOrderBad++; break; }
    for (let k = 1; k < m.asks.length; k++) if (+m.asks[k][0] <= +m.asks[k - 1][0]) { p.askOrderBad++; break; }
    if (m.bids.length && m.asks.length && +m.bids[0][0] >= +m.asks[0][0]) p.crossed++;
    for (const [, q] of m.bids.concat(m.asks)) if (+q === 0) p.sizes.add('zero');
    p.lastFrame = m;
  });
  await ready;
  send(ws, 'SUBSCRIBE', streams, 1);
  await sleep(500);
  send(ws, 'SUBSCRIBE', extra, 2);
  await sleep(45_000);
  // REST compare on BTC at the same scale, against the last socket frame.
  const r = await (await fetch(`${REST_DEPTH}?symbolId=BTC-USDT-M&scale=0.1`)).json();
  const sock = per['f_depth30@BTC-USDT-M_0.1']?.lastFrame;
  if (sock && r.data) {
    const sBid = new Map(sock.bids), rBid = new Map(r.data.bids);
    let same = 0; for (const [p, q] of rBid) if (sBid.get(p) === q) same++;
    log('rest-compare', { restE: r.data.e, restBids: r.data.bids.length, restAsks: r.data.asks.length, restId: r.data.lastUpdateId, sockId: sock.lastUpdateId, bidLevelsEqual: same, restTopBid: r.data.bids[0], sockTopBid: sock.bids[0] });
  }
  ws.terminate();
  log('acks', { acks: acks.slice(0, 6) });
  for (const [k, p] of Object.entries(per)) {
    const g = p.gaps.sort((a, b) => a - b);
    const q = (f) => g.length ? g[Math.min(g.length - 1, Math.floor(f * g.length))] : null;
    log('stream', { key: k, frames: p.n, firstMs: p.first, idDown: p.idDown, idSame: p.idSame, identicalBody: p.sameBody, bids: [p.bidsMin, p.bidsMax], asks: [p.asksMin, p.asksMax], bidOrderBad: p.bidOrderBad, askOrderBad: p.askOrderBad, crossed: p.crossed, zeroSizes: p.sizes.has('zero'), gapMs: { p10: q(0.1), p50: q(0.5), p90: q(0.9), max: g.at(-1) ?? null } });
  }
}

async function mark() {
  const cat = await catalog();
  const openIds = new Set(cat.map((s) => s.symbolId));
  const { ws, st, ready } = open('mark');
  const all = { n: 0, sizes: [], eGaps: [], lastE: 0, syms: new Set(), keys: new Set() };
  const chg = {}; // symbol to {p, I, r, T, changes}
  const tick = { n: 0, syms: new Set(), keys: new Set() };
  ws.on('message', (d) => {
    st.frames++;
    const m = JSON.parse(d.toString());
    if (!Array.isArray(m.data)) { if (!m.e) capture('mark-acks.txt', d.toString()); return; }
    const e = m.data[0]?.e;
    if (e === 'f_markPrice') {
      all.n++; all.sizes.push(m.data.length); if (all.lastE) all.eGaps.push(m.E - all.lastE); all.lastE = m.E;
      if (all.n <= 1) capture('mark-all.txt', d.toString());
      for (const x of m.data) {
        all.syms.add(x.s); Object.keys(x).forEach((k) => all.keys.add(k));
        const c = (chg[x.s] ??= { p: x.p, I: x.I, r: x.r, T: x.T, dp: 0, dI: 0, dr: 0, dT: 0, seen: 0 });
        c.seen++;
        for (const f of ['p', 'I', 'r', 'T']) if (x[f] !== c[f]) { c['d' + f]++; c[f] = x[f]; }
      }
    } else {
      tick.n++; for (const x of m.data) { tick.syms.add(x.s); Object.keys(x).forEach((k) => tick.keys.add(k)); }
      if (tick.n <= 1) capture('ticker-all.txt', d.toString());
    }
  });
  await ready;
  send(ws, 'SUBSCRIBE', ['f_markPrice_all', 'f_ticker_all'], 1);
  await sleep(60_000);
  ws.terminate();
  const vals = Object.entries(chg);
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const missing = [...openIds].filter((s) => !all.syms.has(s));
  const extraSyms = [...all.syms].filter((s) => !openIds.has(s));
  const tHist = {}; for (const [, c] of vals) { const k = new Date(c.T).toISOString(); tHist[k] = (tHist[k] || 0) + 1; }
  log('mark-all', { frames: all.n, symbolsPerFrame: [Math.min(...all.sizes), Math.max(...all.sizes)], eGapMs: { min: Math.min(...all.eGaps), med: med(all.eGaps), max: Math.max(...all.eGaps) }, symbols: all.syms.size, openCatalog: openIds.size, missingFromStream: missing.slice(0, 20), missingCount: missing.length, notInOpenCatalog: extraSyms.slice(0, 20), fields: [...all.keys] });
  log('mark-changes', {
    medianSeen: med(vals.map(([, c]) => c.seen)),
    markChangesMedian: med(vals.map(([, c]) => c.dp)), indexChangesMedian: med(vals.map(([, c]) => c.dI)), rateChangesMedian: med(vals.map(([, c]) => c.dr)),
    markNeverChanged: vals.filter(([, c]) => c.dp === 0).length, indexNeverChanged: vals.filter(([, c]) => c.dI === 0).length, rateChangedAtAll: vals.filter(([, c]) => c.dr > 0).length,
    btc: chg['BTC-USDT-M'], lsk: chg['LSK-USDT-M'], nextFundingHistogram: tHist,
  });
  log('ticker-all', { frames: tick.n, symbols: tick.syms.size, fields: [...tick.keys] });
}

async function errors() {
  const { ws, st, ready } = open('errors');
  const got = [];
  const depth = {};
  let at = 'start';
  ws.on('message', (d) => {
    st.frames++;
    const s = d.toString();
    if (s.startsWith('{"e":"f_depth')) { const m = JSON.parse(s); const k = `${m.s}_${m.i} ids:`; depth[k] = depth[k] ?? new Set(); depth[k].add(m.lastUpdateId); return; }
    got.push(`after ${at}: ${s.slice(0, 300)}`);
  });
  await ready;
  const cases = [
    ['SUBSCRIBE', ['f_depth30@NOPE-USDT-M_0.1'], 'unknown'],
    ['SUBSCRIBE', ['f_depth30@BTC-USDT-M_0.5'], 'badscale'],
    ['SUBSCRIBE', ['f_depth30@BTC-USDT-M'], 'noscale'],
    ['SUBSCRIBE', ['f_depth30@TON-USDT-M_0.0001'], 'settled'],
    ['SUBSCRIBE', ['f_nope@BTC-USDT-M'], 'badchannel'],
    ['SUBSCRIBE', ['f_markPrice@NOPE-USDT-M'], 'markUnknown'],
    ['FOO', ['x'], 'badmethod'],
    ['PING', null, 'ping'],
    ['time', null, 'time'],
  ];
  for (const [m, p, id] of cases) { at = id; send(ws, m, p, id); await sleep(1_500); }
  at = 'not json';
  ws.send('not json');
  await sleep(2_000);
  ws.terminate();
  log('replies', { replies: got, depthStreams: Object.fromEntries(Object.entries(depth).map(([k, v]) => [k, v.size])) });
}

async function batch() {
  const cat = await catalog();
  const pick = cat.slice(0, 150);
  const streams = pick.map((s) => `f_depth30@${s.symbolId}_${s.depths[0]}`);
  const { ws, st, ready } = open('batch');
  const seen = new Map();
  let firstAll = null;
  const acks = [];
  ws.on('message', (d) => {
    st.frames++;
    const m = JSON.parse(d.toString());
    if (!m.e) { acks.push(JSON.stringify(m).slice(0, 300)); return; }
    const k = `${m.s}_${m.i}`;
    seen.set(k, (seen.get(k) || 0) + 1);
    if (seen.size === pick.length && !firstAll) firstAll = Date.now() - sent;
  });
  await ready;
  const sent = Date.now();
  send(ws, 'SUBSCRIBE', streams, 1);
  await sleep(30_000);
  ws.terminate();
  const counts = [...seen.values()].sort((a, b) => a - b);
  const silent = pick.filter((s) => !seen.has(`${s.symbolId}_${s.depths[0]}`)).map((s) => s.symbolId);
  log('batch', { subscribed: streams.length, frameBytes: JSON.stringify({ method: 'SUBSCRIBE', params: streams, id: 1 }).length, acks, delivering: seen.size, allDeliveredAfterMs: firstAll, totalFrames: st.frames, perStream: { min: counts[0], med: counts[Math.floor(counts.length / 2)], max: counts.at(-1) }, silent: silent.slice(0, 20) });
}

async function silence() {
  const a = open('subscribed-silent');
  const b = open('unsubscribed-silent');
  const c = open('subscribed-app-ping');
  const replies = [];
  for (const x of [a, b, c]) x.ws.on('message', (d) => { x.st.frames++; if (x === c && !d.toString().startsWith('{"e"')) replies.push({ at: Date.now() - x.st.t0, s: d.toString().slice(0, 120) }); });
  await Promise.all([a.ready, b.ready, c.ready]);
  send(a.ws, 'SUBSCRIBE', ['f_depth30@LSK-USDT-M_0.0001'], 1);
  send(c.ws, 'SUBSCRIBE', ['f_depth30@LSK-USDT-M_0.0001'], 1);
  const timer = setInterval(() => { if (c.ws.readyState === 1) send(c.ws, 'PING', null, 'p' + Date.now()); }, 20_000);
  await sleep(70_000);
  clearInterval(timer);
  for (const x of [a, b, c]) { log('silence', { label: x.st.label, closed: x.st.closed, frames: x.st.frames, serverPings: x.st.pings }); x.ws.terminate(); }
  log('app-ping-replies', { replies: replies.slice(0, 8) });
}

async function deflate() {
  const { ws, ready } = open('deflate', { deflate: true });
  await ready;
  log('deflate', { negotiated: ws.extensions || '(none)' });
  ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, mark, errors, batch, silence, deflate };
if (!modes[mode]) { console.error('unknown mode', mode); process.exit(1); }
await modes[mode]();
process.exit(0);
