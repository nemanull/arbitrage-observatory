// BitradeX futures WebSocket probe: topics, sequence fields, level order, size unit, keepalive, silence, errors and a batch of perpetuals on one socket.
// BitradeX publishes no socket documentation. The URL wss://fws.bitradex.ai/public, the frame {"method":"subscribe","params":[topic]} and the text ping come from the www.bitradex.ai _app bundle.
// Topic names are tried as candidates and the probe reports which ones answer.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like the engine's feeds.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitradex/ws-probe.mjs [topics|book|batch|silence|deflate]
//   topics   one socket, candidate topics on btc_usdt plus an unknown symbol and a malformed frame, 20 s.
//   book     depth_update at 100ms and depth at 20 levels on three perps for 45 s: sequence check, snapshot join, level order, REST depth compare.
//   batch    the same two topics on every trading perpetual on one socket for 30 s.
//   silence  two sockets, one silent and one that sends "ping" every 15 s, for up to 70 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames (capped). Recorded in docs/profiles/bitradex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Loads ws the way the engine did, through server/package.json, falling back to old_ts_server/ and the root pnpm store after the 2026-09-23 move.
function load(name) {
  for (const base of ['../../../../server/package.json', '../../../../old_ts_server/package.json', '../../../../package.json']) {
    try {
      return createRequire(new URL(base, import.meta.url))(name);
    } catch {}
  }
  const store = { ccxt: 'ccxt@4.5.68_protobufjs@7.6.6', ws: 'ws@8.21.1_bufferutil@4.1.0' }[name];
  return createRequire(new URL(`../../../../node_modules/.pnpm/${store}/node_modules/${name}/package.json`, import.meta.url))(name);
}
const WebSocket = load('ws');

const URL_PUB = 'wss://fws.bitradex.ai/public';
const API = 'https://www.bitradex.ai/v1/future-u/market';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let captured = 0;
function capture(name, text) {
  if (!OUT || captured > 2_000_000) return;
  captured += text.length;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(opts = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const ws = new WebSocket(URL_PUB, { perMessageDeflate: opts.deflate ?? false, headers: { 'User-Agent': 'node' } });
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0), ext: ws.extensions }));
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => reject(new Error(`HTTP ${res.statusCode} ${body.slice(0, 80)}`)));
    });
    ws.once('error', reject);
  });
}
const sub = (ws, topic, id) => ws.send(JSON.stringify({ method: 'subscribe', params: [topic], id: String(id) }));

async function topics() {
  const { ws, openMs } = await open();
  log('open', { openMs });
  const first = new Map();
  const counts = {};
  ws.on('message', (buf) => {
    const s = buf.toString();
    capture('topics.txt', s.slice(0, 1500));
    let j;
    try { j = JSON.parse(s); } catch { return log('text', { s: s.slice(0, 80) }); }
    const key = j.event ?? j.topic ?? `reply:${j.id}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (!first.has(key)) { first.set(key, 1); log('first', { key, frame: s.slice(0, 400) }); }
  });
  const cands = ['depth_update@btc_usdt', 'depth_update@btc_usdt,100ms', 'depth_update@btc_usdt,1000ms', 'depth@btc_usdt,20', 'depth@btc_usdt,20,1000ms', 'depth@btc_usdt,50,100ms', 'mark_price@btc_usdt', 'index_price@btc_usdt', 'funding_rate@btc_usdt', 'fund_rate@btc_usdt', 'ticker@btc_usdt', 'agg_ticker@btc_usdt', 'agg_tickers', 'tickers', 'trade@btc_usdt', 'depth_update@nope_usdt', 'nope@btc_usdt'];
  let id = 1;
  for (const c of cands) { sub(ws, c, id++); await sleep(150); }
  ws.send('not json');
  ws.send('ping');
  await sleep(20_000);
  log('counts', counts);
  ws.terminate();
}

async function restDepth(symbol, level) {
  const t0 = performance.now();
  const r = await fetch(`${API}/public/q/depth?symbol=${symbol}&level=${level}`, { signal: AbortSignal.timeout(10_000) });
  const j = await r.json();
  return { ms: Math.round(performance.now() - t0), ...j.data };
}

async function book(symbols = ['btc_usdt', 'eth_usdt', 'xmr_usdt'], seconds = 45, topicFn = (s) => [`depth_update@${s},100ms`, `depth@${s},20`]) {
  const { ws, openMs } = await open();
  log('open', { openMs, n: symbols.length });
  const st = new Map(symbols.map((s) => [s, { frames: 0, gaps: 0, chained: 0, empty: 0, bidUnordered: 0, askUnordered: 0, lastU: null, keys: null, maxGapMs: 0, lastAt: 0, firstAt: 0, snaps: 0, snapRepeats: 0, lastSnapId: null, firstSnapId: null, firstDelta: null, snapLevels: null, snapOrder: null }]));
  let frames = 0, bytes = 0, acks = 0, pongs = 0, other = 0;
  const t0 = Date.now();
  ws.on('message', (buf) => {
    const s = buf.toString();
    frames++; bytes += s.length;
    if (s === 'pong') return pongs++;
    let j;
    try { j = JSON.parse(s); } catch { return other++; }
    if (!j.data || !j.event) { acks++; if (acks <= 3) log('reply', { frame: s.slice(0, 200) }); return; }
    const d = j.data;
    const x = st.get(d.s);
    if (!x) return other++;
    capture('book.txt', s.slice(0, 1200));
    if (j.topic === 'depth') {
      x.snaps++;
      if (x.lastSnapId === d.id) x.snapRepeats++;
      x.lastSnapId = d.id;
      if (x.firstSnapId === null) {
        x.firstSnapId = d.id;
        x.snapLevels = `${d.b?.length}/${d.a?.length}`;
        x.snapOrder = `bidsDesc=${(d.b ?? []).every((l, i) => !i || Number(l[0]) < Number(d.b[i - 1][0]))} asksAsc=${(d.a ?? []).every((l, i) => !i || Number(l[0]) > Number(d.a[i - 1][0]))}`;
      }
      return;
    }
    const now = Date.now();
    if (x.lastAt) x.maxGapMs = Math.max(x.maxGapMs, now - x.lastAt);
    else x.firstAt = now - t0;
    x.lastAt = now;
    x.frames++;
    if (!x.keys) { x.keys = Object.keys(d).join(','); log('firstFrame', { s: d.s, event: j.event, frame: s.slice(0, 500) }); }
    if (!(d.b?.length) && !(d.a?.length)) x.empty++;
    const bs = (d.b ?? []).map((l) => Number(l[0]));
    const as = (d.a ?? []).map((l) => Number(l[0]));
    if (bs.some((p, i) => i && p > bs[i - 1])) x.bidUnordered++;
    if (as.some((p, i) => i && p < as[i - 1])) x.askUnordered++;
    if (x.firstDelta === null) x.firstDelta = `pu=${d.pu} fu=${d.fu} u=${d.u} snapIdBefore=${x.lastSnapId}`;
    if (x.lastU !== null) { if (d.pu === x.lastU && Number(d.fu) === Number(d.pu) + 1) x.chained++; else x.gaps++; }
    x.lastU = d.u;
  });
  let id = 1;
  for (let i = 0; i < symbols.length; i += 10) {
    ws.send(JSON.stringify({ method: 'subscribe', params: symbols.slice(i, i + 10).flatMap(topicFn), id: String(id++) }));
    await sleep(100);
  }
  const ping = setInterval(() => ws.send('ping'), 15_000);
  if (symbols.length <= 5) {
    await sleep(5_000);
    for (const s of symbols.slice(0, 2)) {
      const r = await restDepth(s, 20);
      log('restDepth', { s, ms: r.ms, u: r.u, t: r.t, bids: r.b?.length, asks: r.a?.length, bidsDesc: r.b?.every((l, i) => !i || Number(l[0]) < Number(r.b[i - 1][0])), asksAsc: r.a?.every((l, i) => !i || Number(l[0]) > Number(r.a[i - 1][0])), wsLastU: st.get(s).lastU, top: [r.b?.[0], r.a?.[0]] });
    }
  }
  await sleep(seconds * 1000 - (symbols.length <= 5 ? 5_500 : 0));
  clearInterval(ping);
  const secs = (Date.now() - t0) / 1000;
  log('totals', { secs: Math.round(secs), frames, perSec: Math.round(frames / secs), bytesPerSec: Math.round(bytes / secs), acks, pongs, other });
  const rows = [...st.entries()];
  const silent = rows.filter(([, x]) => !x.frames).map(([s]) => s);
  log('snaps', { snaps: rows.reduce((a, [, x]) => a + x.snaps, 0), snapRepeats: rows.reduce((a, [, x]) => a + x.snapRepeats, 0) });
  const sum = (k) => rows.reduce((a, [, x]) => a + x[k], 0);
  log('seq', { symbols: rows.length, silent: silent.length, silentList: silent.slice(0, 20), chained: sum('chained'), gaps: sum('gaps'), empty: sum('empty'), bidUnordered: sum('bidUnordered'), askUnordered: sum('askUnordered') });
  if (rows.length <= 5) for (const [s, x] of rows) log('sym', { s, ...x });
  ws.terminate();
}

async function batch() {
  const r = await fetch(`${API}/public/symbol/list`, { signal: AbortSignal.timeout(10_000) });
  const syms = (await r.json()).data.filter((x) => x.tradeSwitch).map((x) => x.symbol);
  await book(syms, 30);
}

async function silence() {
  const run = async (label, sendPing) => {
    const { ws, openMs } = await open();
    const t0 = Date.now();
    let msgs = 0, pings = 0;
    ws.on('ping', () => pings++);
    ws.on('message', () => msgs++);
    const iv = sendPing ? setInterval(() => ws.send('ping'), 15_000) : null;
    return new Promise((res) => {
      const done = (code) => { clearInterval(iv); res({ label, openMs, closedAfterMs: code === 'held' ? null : Date.now() - t0, code, msgs, serverPings: pings }); };
      ws.once('close', (code) => done(code));
      setTimeout(() => { ws.terminate(); done('held'); }, 70_000);
    });
  };
  const out = await Promise.all([run('silent', false), run('ping15s', true)]);
  for (const o of out) log('silence', o);
}

async function deflate() {
  const { ws, openMs, ext } = await open({ deflate: true });
  log('deflate', { openMs, negotiated: ext || '(none)' });
  ws.terminate();
}

const mode = process.argv[2] ?? 'topics';
try {
  if (mode === 'topics') await topics();
  else if (mode === 'book') await book();
  else if (mode === 'batch') await batch();
  else if (mode === 'silence') await silence();
  else if (mode === 'deflate') await deflate();
  else console.log('modes: topics | book | batch | silence | deflate');
} catch (e) {
  log('error', { message: e.message });
}
process.exit(0);
