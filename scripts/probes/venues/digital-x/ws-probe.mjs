// Digital X (formerly Korbit) public WebSocket probe: the orderbook channel, control messages and errors, every pair on one socket, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/digital-x/ws-probe.mjs [book|errors|batch|silence|deflate]
//   book     orderbook on two busy, one median, one quiet and one stopped pair for 60 s, with two REST book compares on btc_krw.
//   errors   acks, unknown and malformed requests, grouping level, ticker and trade samples, and the former korbit.co.kr host. About 25 s.
//   batch    orderbook for every launched pair in one subscribe frame on one socket for 45 s.
//   silence  three sockets that differ in what they send, for up to 120 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/digital-x/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws-api.digitalx.miraeasset.com/v2/public';
const OLD_WS_URL = 'wss://ws-api.korbit.co.kr/v2/public';
const API = 'https://api.digitalx.miraeasset.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const trim = (s, n = 600) => (s.length > n ? s.slice(0, n) + '…' : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), trim(text, 1500) + '\n');
}

function open(url = WS_URL, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0 }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

async function getJson(path) {
  const r = await fetch(API + path);
  return (await r.json()).data;
}

async function launchedByVolume() {
  const [pairs, tickers] = await Promise.all([getJson('/v2/currencyPairs'), getJson('/v2/tickers')]);
  const launched = new Set(pairs.filter((p) => p.status === 'launched').map((p) => p.symbol));
  const stopped = pairs.filter((p) => p.status === 'stopped').map((p) => p.symbol);
  const ranked = tickers.filter((t) => launched.has(t.symbol)).sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume));
  return { ranked, stopped };
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

function sideOrdered(levels, desc) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (desc ? b >= a : b <= a) return false;
  }
  return true;
}

const levelKey = (l) => `${l.price}:${l.qty}`;

async function book() {
  const { ranked, stopped } = await launchedByVolume();
  const busy = ['btc_krw', 'usdt_krw'];
  const median = ranked[Math.floor(ranked.length / 2)].symbol;
  const quiet = ranked[ranked.length - 1].symbol;
  const stop = stopped.includes('klay_krw') ? 'klay_krw' : stopped[0];
  const symbols = [...busy, median, quiet, stop];
  const { ws, openMs } = await open();
  log('open', { openMs, symbols });
  const st = {};
  for (const s of symbols) st[s] = { frames: 0, snapshots: 0, first: null, last: null, lastArr: null, gaps: [], lags: [], bidCounts: new Set(), askCounts: new Set(), unorderedBids: 0, unorderedAsks: 0, zeroQty: 0, identical: 0, changedLevels: [], dataTsBack: 0, amtSeen: 0, oneSided: 0, empty: 0, tsEqual: 0, sendMinusData: [] };
  const sent = Date.now();
  ws.on('message', (buf) => {
    const now = Date.now();
    const text = buf.toString();
    const m = JSON.parse(text);
    if (m.status) {
      log('control', { ms: now - sent, msg: m });
      capture('control.jsonl', text);
      return;
    }
    if (m.type !== 'orderbook') return;
    const s = st[m.symbol];
    if (!s) return;
    s.frames++;
    if (s.frames <= 3) capture(`book-${m.symbol}.jsonl`, JSON.stringify({ ...m, data: { ...m.data, bids: m.data.bids.slice(0, 3), asks: m.data.asks.slice(0, 3) } }));
    if (m.snapshot === true) s.snapshots++;
    if (s.first === null) s.first = { ms: now - sent, snapshot: m.snapshot, bids: m.data.bids.length, asks: m.data.asks.length, keys: Object.keys(m), dataKeys: Object.keys(m.data) };
    if (s.lastArr !== null) s.gaps.push(now - s.lastArr);
    s.lastArr = now;
    s.lags.push(now - m.timestamp);
    if (m.timestamp === m.data.timestamp) s.tsEqual++;
    s.sendMinusData.push(m.timestamp - m.data.timestamp);
    if (s.last && m.data.timestamp < s.last.data.timestamp) s.dataTsBack++;
    s.bidCounts.add(m.data.bids.length);
    s.askCounts.add(m.data.asks.length);
    if (!sideOrdered(m.data.bids, true)) s.unorderedBids++;
    if (!sideOrdered(m.data.asks, false)) s.unorderedAsks++;
    const all = [...m.data.bids, ...m.data.asks];
    if (all.some((l) => Number(l.qty) === 0)) s.zeroQty++;
    if (all.some((l) => l.amt != null)) s.amtSeen++;
    if ((m.data.bids.length === 0) !== (m.data.asks.length === 0)) s.oneSided++;
    if (m.data.bids.length === 0 && m.data.asks.length === 0) s.empty++;
    if (s.last) {
      const prev = new Set([...s.last.data.bids, ...s.last.data.asks].map(levelKey));
      const changed = all.filter((l) => !prev.has(levelKey(l))).length;
      if (changed === 0 && all.length === prev.size) s.identical++;
      s.changedLevels.push(changed);
    }
    s.last = m;
  });
  ws.send(JSON.stringify([{ requestId: 1, method: 'subscribe', type: 'orderbook', symbols }]));
  for (const at of [20000, 40000]) {
    await sleep(at - (Date.now() - sent));
    const r = await fetch(`${API}/v2/orderbook?symbol=btc_krw`);
    const rest = (await r.json()).data;
    const w = st.btc_krw.last;
    if (!w) continue;
    const wsSet = new Set([...w.data.bids, ...w.data.asks].map(levelKey));
    const restAll = [...rest.bids, ...rest.asks];
    log('restCompare', { atMs: at, restLevels: restAll.length, wsLevels: wsSet.size, matching: restAll.filter((l) => wsSet.has(levelKey(l))).length, restTs: rest.timestamp, wsDataTs: w.data.timestamp, restBidsDesc: sideOrdered(rest.bids, true), restAsksAsc: sideOrdered(rest.asks, false), restBestBid: rest.bids[0]?.price, wsBestBid: w.data.bids[0]?.price });
  }
  await sleep(60000 - (Date.now() - sent));
  ws.close();
  for (const [sym, s] of Object.entries(st)) {
    log('book', {
      sym, frames: s.frames, snapshots: s.snapshots, first: s.first,
      bidCounts: [...s.bidCounts].sort((a, b) => a - b), askCounts: [...s.askCounts].sort((a, b) => a - b),
      gapMs: { min: s.gaps.length ? Math.min(...s.gaps) : null, p10: pct(s.gaps, 10), p50: pct(s.gaps, 50), p90: pct(s.gaps, 90), max: s.gaps.length ? Math.max(...s.gaps) : null },
      lagMs: { min: s.lags.length ? Math.min(...s.lags) : null, p50: pct(s.lags, 50), max: s.lags.length ? Math.max(...s.lags) : null },
      sendMinusDataMs: { min: s.sendMinusData.length ? Math.min(...s.sendMinusData) : null, p50: pct(s.sendMinusData, 50), max: s.sendMinusData.length ? Math.max(...s.sendMinusData) : null },
      tsEqual: s.tsEqual, dataTsBack: s.dataTsBack, unorderedBids: s.unorderedBids, unorderedAsks: s.unorderedAsks, zeroQty: s.zeroQty, amtSeen: s.amtSeen,
      identical: s.identical, changedLevels: { p50: pct(s.changedLevels, 50), max: s.changedLevels.length ? Math.max(...s.changedLevels) : null },
      oneSided: s.oneSided, empty: s.empty,
      lastTouch: s.last ? { bid: s.last.data.bids[0], ask: s.last.data.asks[0] } : null,
    });
  }
}

async function errors() {
  const { ws, openMs } = await open();
  log('open', { openMs });
  const t0 = Date.now();
  const firstData = {};
  const counts = {};
  ws.on('message', (buf) => {
    const text = buf.toString();
    let m;
    try { m = JSON.parse(text); } catch { log('nonJson', { ms: Date.now() - t0, text: trim(text, 200) }); return; }
    if (m.status) { log('control', { ms: Date.now() - t0, msg: m }); capture('errors.jsonl', text); return; }
    const k = `${m.type}:${m.symbol}`;
    counts[k] = (counts[k] || 0) + 1;
    if (!firstData[k]) {
      firstData[k] = true;
      const d = m.data || {};
      log('firstData', { ms: Date.now() - t0, key: k, snapshot: m.snapshot, keys: Object.keys(m), dataType: Array.isArray(d) ? 'array' : typeof d, sample: trim(text, 400) });
      capture('errors.jsonl', m.type === 'orderbook' ? JSON.stringify({ ...m, data: { ...d, bids: d.bids.slice(0, 2), asks: d.asks.slice(0, 2) } }) : text);
    }
  });
  ws.on('close', (code, reason) => log('close', { ms: Date.now() - t0, code, reason: reason.toString() }));
  const send = async (label, payload) => { log('send', { label, payload: trim(typeof payload === 'string' ? payload : JSON.stringify(payload), 200) }); ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload)); await sleep(1500); };
  await send('ack for a valid subscribe', [{ requestId: 1, method: 'subscribe', type: 'ticker', symbols: ['btc_krw'] }]);
  await send('unknown symbol with requestId', [{ requestId: 2, method: 'subscribe', type: 'orderbook', symbols: ['nope_krw'] }]);
  await send('unknown symbol without requestId', [{ method: 'subscribe', type: 'orderbook', symbols: ['nope2_krw'] }]);
  await send('uppercase symbol', [{ requestId: 3, method: 'subscribe', type: 'orderbook', symbols: ['BTC_KRW'] }]);
  await send('unknown type', [{ requestId: 4, method: 'subscribe', type: 'nope', symbols: ['btc_krw'] }]);
  await send('object instead of array', { requestId: 5, method: 'subscribe', type: 'orderbook', symbols: ['eth_krw'] });
  await send('text that is not JSON', 'hello');
  await send('stopped pair', [{ requestId: 6, method: 'subscribe', type: 'orderbook', symbols: ['klay_krw'] }]);
  await send('orderbook btc_krw', [{ requestId: 7, method: 'subscribe', type: 'orderbook', symbols: ['btc_krw'] }]);
  await send('orderbook btc_krw again', [{ requestId: 8, method: 'subscribe', type: 'orderbook', symbols: ['btc_krw'] }]);
  await send('trade btc_krw', [{ requestId: 9, method: 'subscribe', type: 'trade', symbols: ['btc_krw'] }]);
  await send('orderbook with grouping level 100000 on eth_krw', [{ requestId: 10, method: 'subscribe', type: 'orderbook', symbols: ['eth_krw'], level: '100000' }]);
  await send('orderbook with unsupported level 7 on xrp_krw', [{ requestId: 11, method: 'subscribe', type: 'orderbook', symbols: ['xrp_krw'], level: '7' }]);
  await send('unsubscribe orderbook btc_krw', [{ requestId: 12, method: 'unsubscribe', type: 'orderbook', symbols: ['btc_krw'] }]);
  const before = counts['orderbook:btc_krw'] || 0;
  await sleep(4000);
  log('afterUnsubscribe', { btcBookFramesIn4s: (counts['orderbook:btc_krw'] || 0) - before });
  log('counts', { elapsedMs: Date.now() - t0, counts });
  ws.close();
  await sleep(300);
  try {
    const old = await open(OLD_WS_URL);
    let n = 0;
    let first = null;
    old.ws.on('message', (buf) => { const m = JSON.parse(buf.toString()); if (m.type === 'orderbook') { n++; if (!first) first = { snapshot: m.snapshot, bids: m.data.bids.length, asks: m.data.asks.length }; } });
    old.ws.send(JSON.stringify([{ method: 'subscribe', type: 'orderbook', symbols: ['btc_krw'] }]));
    await sleep(3000);
    old.ws.close();
    log('formerHost', { url: OLD_WS_URL, openMs: old.openMs, orderbookFramesIn3s: n, first });
  } catch (e) {
    log('formerHost', { url: OLD_WS_URL, error: String(e) });
  }
}

async function batch() {
  const { ranked } = await launchedByVolume();
  const symbols = ranked.map((t) => t.symbol);
  const { ws, openMs } = await open();
  log('open', { openMs, symbols: symbols.length });
  const per = {};
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let firstAllSnapMs = null;
  const perSecond = new Map();
  const t0 = Date.now();
  ws.on('message', (buf) => {
    const a = process.hrtime.bigint();
    const m = JSON.parse(buf.toString());
    parseNs += process.hrtime.bigint() - a;
    if (m.status) { log('control', { msg: m }); return; }
    frames++;
    bytes += buf.length;
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) || 0) + 1);
    const p = (per[m.symbol] ||= { n: 0, snap: 0, last: 0, maxGap: 0, levels: 0 });
    if (p.last) p.maxGap = Math.max(p.maxGap, Date.now() - p.last);
    p.last = Date.now();
    p.n++;
    p.levels = Math.max(p.levels, m.data.bids.length + m.data.asks.length);
    if (m.snapshot === true) p.snap++;
    if (firstAllSnapMs === null && Object.values(per).filter((x) => x.snap > 0).length === symbols.length) firstAllSnapMs = Date.now() - t0;
  });
  ws.on('close', (code) => log('close', { ms: Date.now() - t0, code }));
  ws.send(JSON.stringify([{ requestId: 1, method: 'subscribe', type: 'orderbook', symbols }]));
  await sleep(45000);
  ws.close();
  const secs = [...perSecond.values()];
  const counts = Object.values(per).map((p) => p.n);
  const withSnap = Object.values(per).filter((p) => p.snap > 0).length;
  const silentAfterSnap = Object.entries(per).filter(([, p]) => p.n === 1).length;
  log('batch', {
    symbols: symbols.length, symbolsWithFrames: Object.keys(per).length, withSnapshot: withSnap, allSnapshotsInMs: firstAllSnapMs,
    frames, framesPerSec: +(frames / 45).toFixed(1), medianPerSec: pct(secs, 50), peakPerSec: Math.max(...secs),
    kbPerSec: +(bytes / 45 / 1024).toFixed(1), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: +(Number(parseNs) / frames / 1000).toFixed(1),
    framesPerSymbol: { p50: pct(counts, 50), max: Math.max(...counts) }, onlySnapshot: silentAfterSnap,
    maxGapMsBusiest: per[symbols[0]]?.maxGap, maxLevels: Math.max(...Object.values(per).map((p) => p.levels)),
  });
}

async function silence() {
  const { ranked } = await launchedByVolume();
  const quiet = ranked[ranked.length - 1].symbol;
  const specs = [
    { name: 'idle-no-subscribe', sub: null, ping: false },
    { name: `quiet-book-${quiet}`, sub: quiet, ping: false },
    { name: 'no-subscribe-client-ping-20s', sub: null, ping: true },
  ];
  const t0 = Date.now();
  const runs = specs.map(async (spec) => {
    const { ws, openMs } = await open();
    const opened = Date.now();
    const s = { name: spec.name, openMs, serverPings: 0, pingAtMs: [], pongs: 0, pongRttMs: [], frames: 0, lastFrameMs: null, closedMs: null, code: null };
    let pingSent = 0;
    ws.on('ping', (data) => { s.serverPings++; s.pingAtMs.push(Date.now() - opened); if (s.serverPings === 1) s.pingPayload = data.toString(); });
    ws.on('pong', () => { s.pongs++; if (pingSent) s.pongRttMs.push(Date.now() - pingSent); });
    ws.on('message', () => { s.frames++; s.lastFrameMs = Date.now() - t0; });
    if (spec.sub) ws.send(JSON.stringify([{ method: 'subscribe', type: 'orderbook', symbols: [spec.sub] }]));
    const timer = spec.ping ? setInterval(() => { pingSent = Date.now(); ws.ping(); }, 20000) : null;
    await new Promise((resolve) => {
      ws.on('close', (code) => { s.closedMs = Date.now() - t0; s.code = code; resolve(); });
      setTimeout(() => { ws.close(); resolve(); }, 120000);
    });
    if (timer) clearInterval(timer);
    log('silence', s);
  });
  await Promise.all(runs);
}

async function deflate() {
  const ws = new WebSocket(WS_URL, { perMessageDeflate: true });
  await new Promise((resolve, reject) => {
    ws.on('upgrade', (res) => log('deflate', { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server ?? null }));
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.close();
}

const mode = process.argv[2] || 'book';
const modes = { book, errors, batch, silence, deflate };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, utc: new Date().toISOString() });
await modes[mode]();
log('end', { mode, utc: new Date().toISOString() });
process.exit(0);
