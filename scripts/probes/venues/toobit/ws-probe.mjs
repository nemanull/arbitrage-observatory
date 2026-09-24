// Toobit public WebSocket probe: the depth and diffDepth book topics, their versions and level order, the size unit, errors, keepalive, silence, deflate, and a batch of perpetuals per connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node ../scripts/probes/venues/toobit/ws-probe.mjs [all|book|batch|silence|deflate|frames]
//   all      silence in the background while book, batch and deflate run one after another. About 255 s of socket time.
//   book     depth and diffDepth on four perps for 75 s, a REST book compare, bookTicker, markPrice, index, and every error and variant case.
//   batch    depth on 150 perps on one socket and diffDepth on 300 more on another, 60 s.
//   silence  three sockets that differ only in what the client sends, for up to 250 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
//   frames   one BTC diffDepth snapshot and its first deltas, whole except for level arrays cut to three entries. About 6 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/toobit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://stream.toobit.com/quote/ws/v1';
const API = 'https://api.toobit.com';
const OUT = process.env.PROBE_OUT_DIR;
const BOOK_MS = 75_000;
const BATCH_MS = 60_000;
const SILENCE_MS = 250_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url = URL_WS, opts = {}) {
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  const t0 = performance.now();
  const info = { pings: [], closed: null, openMs: null, extensions: null, upgradeHeaders: null };
  ws.on('upgrade', (res) => { info.upgradeHeaders = res.headers; });
  ws.on('open', () => { info.openMs = Math.round(performance.now() - t0); info.extensions = ws.extensions; });
  ws.on('ping', (d) => info.pings.push({ atMs: Math.round(performance.now() - t0), data: d.toString() }));
  ws.on('close', (code, reason) => { info.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  ws.on('error', (e) => { info.error = e.message; });
  const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, info, ready, t0 };
}

const sub = (symbols, topic, params) => JSON.stringify({ symbol: symbols.join(','), topic, event: 'sub', ...(params ? { params } : {}) });
const isAsc = (l) => l.every((x, i) => i === 0 || Number(x[0]) > Number(l[i - 1][0]));
const isDesc = (l) => l.every((x, i) => i === 0 || Number(x[0]) < Number(l[i - 1][0]));
const vHead = (v) => Number(String(v).split('_')[0]);

// Perps ranked by 24 h quote volume, so the probe can pick busy, middling and quiet books.
async function ranked() {
  const tick = await (await fetch(`${API}/quote/v1/contract/ticker/24hr`)).json();
  const ei = await (await fetch(`${API}/api/v1/exchangeInfo`)).json();
  const live = new Set(ei.contracts.filter((c) => c.status === 'TRADING').map((c) => c.symbol));
  return tick.filter((t) => live.has(t.s)).sort((a, b) => Number(b.qv) - Number(a.qv)).map((t) => t.s);
}

class Book {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.maxLevels = 0; }
  reset(d) {
    this.bids.clear(); this.asks.clear();
    for (const [p, s] of d.b ?? []) if (Number(s) !== 0) this.bids.set(p, s);
    for (const [p, s] of d.a ?? []) if (Number(s) !== 0) this.asks.set(p, s);
  }
  apply(d) {
    for (const [p, s] of d.b ?? []) Number(s) === 0 ? this.bids.delete(p) : this.bids.set(p, s);
    for (const [p, s] of d.a ?? []) Number(s) === 0 ? this.asks.delete(p) : this.asks.set(p, s);
    this.maxLevels = Math.max(this.maxLevels, this.bids.size, this.asks.size);
  }
  top(n) {
    return {
      b: [...this.bids].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n),
      a: [...this.asks].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n),
    };
  }
}

const sameLevels = (x, y) => x.length === y.length && x.every((l, i) => Number(l[0]) === Number(y[i][0]) && Number(l[1]) === Number(y[i][1]));

async function book() {
  const order = await ranked();
  const symbols = ['BTC-SWAP-USDT', 'ETH-SWAP-USDT', order[Math.floor(order.length / 2)], order[order.length - 5]];
  log('book_symbols', { symbols, rankedCount: order.length });
  const { ws, info, ready, t0 } = open();
  await ready;
  const at = () => Math.round(performance.now() - t0);
  const stats = {};
  for (const topic of ['depth', 'diffDepth']) for (const s of symbols) stats[`${topic}|${s}`] = { frames: 0, snapshots: 0, levels: [], bidsDesc: 0, asksAsc: 0, orderViolations: 0, vHeadBackwards: 0, vRepeats: 0, vFormats: new Set(), oValues: [], eValues: new Set(), keys: new Set(), identicalRepeats: 0, maxIdleMs: 0, lastAt: null, lastV: null, lastBody: null, firstAt: null, zeroSizes: 0, sizeTypes: new Set(), lastO: null, oGaps: 0, oGapSamples: [], oOnSnapshot: [], snapshotAtMs: [], firstDeltaAfterSnapshot: [], idOnlyDeltas: 0, v3Steps: {}, lastV3: null };
  const books = Object.fromEntries(symbols.map((s) => [s, new Book()]));
  const lastDepth = {}; // symbol to the last depth frame's data
  const consistency = Object.fromEntries(symbols.map((s) => [s, { compared: 0, top20Equal: 0, touchEqual: 0, sameV: 0, sameVEqual: 0, samples: [] }]));
  const controls = [];
  const other = {};
  const firsts = [];
  let msgs = 0; let bytes = 0;

  ws.on('message', (data, isBinary) => {
    msgs++; bytes += data.length;
    const text = data.toString();
    capture('book_frames.jsonl', text);
    let j; try { j = JSON.parse(text); } catch { controls.push({ atMs: at(), isBinary, text: text.slice(0, 200) }); return; }
    if (j.pong !== undefined || j.code !== undefined || j.event !== undefined) { controls.push({ atMs: at(), frame: j }); return; }
    const key = `${j.topic}|${j.symbol ?? j.params?.symbol ?? j.data?.s ?? ''}`;
    if (firsts.length < 30 && !firsts.some((f) => f.key === key && f.f === j.f)) firsts.push({ key, f: j.f, atMs: at(), text: text.slice(0, 700) });
    const st = stats[`${j.topic}|${j.symbol}`];
    if (!st) { other[key] = (other[key] ?? 0) + 1; return; }
    const now = at();
    if (st.lastAt !== null) st.maxIdleMs = Math.max(st.maxIdleMs, now - st.lastAt);
    if (st.firstAt === null) st.firstAt = now;
    st.lastAt = now;
    st.frames++;
    Object.keys(j).forEach((k) => st.keys.add(k));
    for (const d of j.data ?? []) {
      st.vFormats.add(String(d.v).split('_').length + ' parts');
      st.eValues.add(d.e);
      if (d.o !== undefined && st.oValues.length < 12) st.oValues.push(d.o);
      if (st.lastV !== null && vHead(d.v) < vHead(st.lastV)) st.vHeadBackwards++;
      if (st.lastV !== null && d.v === st.lastV) st.vRepeats++;
      const v3 = String(d.v).split('_')[2];
      if (v3 !== undefined) { if (st.lastV3 !== null) { const step = String(Number(v3) - st.lastV3); st.v3Steps[step] = (st.v3Steps[step] ?? 0) + 1; } st.lastV3 = Number(v3); }
      const prevV = st.lastV;
      st.lastV = d.v;
      const body = JSON.stringify([d.b, d.a]);
      if (body === st.lastBody) st.identicalRepeats++;
      st.lastBody = body;
      for (const [, s] of [...(d.b ?? []), ...(d.a ?? [])]) { st.sizeTypes.add(typeof s); if (Number(s) === 0) st.zeroSizes++; }
      if (!isDesc(d.b ?? []) || !isAsc(d.a ?? [])) st.orderViolations++;
      if (j.topic === 'depth') {
        st.levels.push(`${d.b?.length ?? 0}/${d.a?.length ?? 0}`);
        lastDepth[j.symbol] = { d, atMs: now };
        const c = consistency[j.symbol];
        const book = books[j.symbol];
        if (book.bids.size || book.asks.size) {
          const t = book.top(20);
          c.compared++;
          const eq = sameLevels(t.b, (d.b ?? []).slice(0, 20)) && sameLevels(t.a, (d.a ?? []).slice(0, 20));
          if (eq) c.top20Equal++;
          if (t.b[0]?.[0] === d.b?.[0]?.[0] && t.a[0]?.[0] === d.a?.[0]?.[0]) c.touchEqual++;
          if (book.lastV === d.v) { c.sameV++; if (eq) c.sameVEqual++; }
          if (!eq && c.samples.length < 3) c.samples.push({ depthV: d.v, diffV: book.lastV, depthTop: { b: d.b?.slice(0, 3), a: d.a?.slice(0, 3) }, diffTop: { b: t.b.slice(0, 3), a: t.a.slice(0, 3) } });
        }
      } else {
        const book = books[j.symbol];
        // The o field is 0 on a snapshot and counts deltas per symbol, so a delta whose o is not the last plus one is a gap.
        if (j.f === true) { st.snapshots++; st.snapshotAtMs.push(now); st.oOnSnapshot.push(d.o); st.levels.push(`snapshot ${d.b?.length ?? 0}/${d.a?.length ?? 0}`); book.reset(d); st.lastO = null; st.awaitFirst = prevV; }
        else {
          if (st.levels.length < 40) st.levels.push(`${d.b?.length ?? 0}/${d.a?.length ?? 0}`);
          if (!(d.b?.length) && !(d.a?.length)) st.idOnlyDeltas++;
          if (st.awaitFirst !== undefined) { st.firstDeltaAfterSnapshot.push({ o: d.o, sameVAsSnapshot: d.v === prevV, levels: `${d.b?.length ?? 0}/${d.a?.length ?? 0}` }); st.awaitFirst = undefined; }
          if (st.lastO !== null && d.o !== st.lastO + 1) { st.oGaps++; if (st.oGapSamples.length < 5) st.oGapSamples.push({ expected: st.lastO + 1, got: d.o, atMs: now }); }
          st.lastO = d.o;
          book.apply(d);
        }
        book.lastV = d.v;
      }
    }
  });

  // One frame per topic carries all four symbols, comma separated.
  ws.send(sub(symbols, 'depth', { binary: false }));
  ws.send(sub(symbols, 'diffDepth', { binary: false }));
  const sentAt = at();
  ws.send(sub(['BTC-SWAP-USDT'], 'bookTicker'));
  ws.send(sub(['BTC-SWAP-USDT'], 'markPrice'));
  ws.send(sub(['BTCUSDT'], 'index', { binary: false }));
  const pongs = [];
  const pingTimer = setInterval(() => { const ts = Date.now(); pongs.push({ sent: ts, sentAtMs: at() }); ws.send(JSON.stringify({ ping: ts })); }, 20_000);

  // Errors and variants on a second socket, so they cannot disturb the book counts above.
  const v = open();
  await v.ready;
  const vFrames = [];
  v.ws.on('message', (data, isBinary) => {
    const text = isBinary ? `<binary ${data.length} bytes, first bytes ${data.subarray(0, 4).toString('hex')}>` : data.toString();
    let j = null; try { j = isBinary ? null : JSON.parse(text); } catch {}
    const levels = j?.data?.[0] ? `${j.data[0].b?.length ?? '-'}/${j.data[0].a?.length ?? '-'}` : '-';
    if (vFrames.length < 400) vFrames.push({ atMs: Math.round(performance.now() - v.t0), text: text.slice(0, 400), key: j ? `${j.topic ?? (j.code !== undefined ? 'code ' + j.code : Object.keys(j).join(','))}|${j.symbol ?? ''}|f=${j.f}|limit=${j.params?.limit ?? '-'}` : text.slice(0, 40), levels });
  });
  const variants = [
    ['unknown symbol', sub(['NOPE-SWAP-USDT'], 'diffDepth', { binary: false })],
    ['unknown topic', sub(['BTC-SWAP-USDT'], 'nope')],
    ['not json', 'hello'],
    ['depth limit 5', sub(['SOL-SWAP-USDT'], 'depth', { binary: false, limit: 5 })],
    ['depth limit 100', sub(['XRP-SWAP-USDT'], 'depth', { binary: false, limit: 100 })],
    ['diffDepth binary true', sub(['ADA-SWAP-USDT'], 'diffDepth', { binary: true })],
    ['spot symbol on the same URL', sub(['BTCUSDT'], 'depth', { binary: false })],
    ['USDC perpetual', sub(['BTC-SWAP-USDC'], 'depth', { binary: false })],
    ['delisted perpetual', sub(['REN-SWAP-USDT'], 'diffDepth', { binary: false })],
    ['TBV perpetual', sub(['TBV_BTC-SWAP-TBV_USDT'], 'depth', { binary: false })],
    ['symbols with a space', JSON.stringify({ symbol: 'LINK-SWAP-USDT, DOT-SWAP-USDT', topic: 'depth', event: 'sub', params: { binary: false } })],
    ['no event', JSON.stringify({ symbol: 'BTC-SWAP-USDT', topic: 'depth' })],
  ];
  for (const [name, frame] of variants) { v.ws.send(frame); vFrames.push({ atMs: Math.round(performance.now() - v.t0), sent: name }); await sleep(400); }
  await sleep(4_000);
  // A duplicate subscribe and a cancel, on the main socket.
  const dupAt = at();
  ws.send(sub(['BTC-SWAP-USDT'], 'diffDepth', { binary: false }));
  await sleep(1_000);
  v.ws.send(JSON.stringify({ symbol: 'SOL-SWAP-USDT', topic: 'depth', event: 'cancel', params: { binary: false, limit: 5 } }));
  vFrames.push({ atMs: Math.round(performance.now() - v.t0), sent: 'cancel SOL depth' });
  await sleep(3_000);
  v.ws.close();
  const vSummary = {};
  const firstOfEach = {};
  for (const f of vFrames) {
    if (f.sent) continue;
    const k = f.key.startsWith('<binary') ? '<binary gzip>' : f.key;
    (vSummary[k] ??= { frames: 0, levels: {} }).frames++;
    vSummary[k].levels[f.levels] = (vSummary[k].levels[f.levels] ?? 0) + 1;
    firstOfEach[k] ??= f.text;
  }
  log('variants', { summary: vSummary, sequence: vFrames.filter((f) => f.sent || !/"topic"/.test(f.text)).slice(0, 60), firstOfEach, info: { ...v.info, upgradeHeaders: undefined } });

  // The REST book compare, half way through.
  await sleep(Math.max(0, 35_000 - at()));
  const compare = [];
  for (const s of symbols.slice(0, 2)) {
    const rest = await (await fetch(`${API}/quote/v1/depth?symbol=${s}&limit=20`)).json();
    const ws20 = lastDepth[s]?.d;
    const diff20 = books[s].top(20);
    const restB = new Map(rest.b.map(([p, q]) => [p, q]));
    compare.push({ symbol: s, restT: rest.t, wsDepthT: ws20?.t, restTop: { b: rest.b.slice(0, 3), a: rest.a.slice(0, 3) }, wsDepthTop: { b: ws20?.b?.slice(0, 3), a: ws20?.a?.slice(0, 3) }, diffTop: { b: diff20.b.slice(0, 3), a: diff20.a.slice(0, 3) }, samePriceSameSize: (ws20?.b ?? []).slice(0, 20).filter(([p, q]) => restB.get(p) === q).length });
    await sleep(1_100);
  }
  log('rest_compare', { compare });

  await sleep(Math.max(0, BOOK_MS - at()));
  clearInterval(pingTimer);
  ws.close();
  await sleep(300);
  const out = {};
  for (const [k, st] of Object.entries(stats)) {
    const lv = {}; for (const l of st.levels) lv[l] = (lv[l] ?? 0) + 1;
    out[k] = { frames: st.frames, perSecond: +(st.frames / ((BOOK_MS - (st.firstAt ?? 0)) / 1000)).toFixed(2), snapshots: st.snapshots, levels: Object.entries(lv).sort((a, b) => b[1] - a[1]).slice(0, 8), orderViolations: st.orderViolations, vFormats: [...st.vFormats], vHeadBackwards: st.vHeadBackwards, vRepeats: st.vRepeats, identicalRepeats: st.identicalRepeats, oValues: st.oValues, eValues: [...st.eValues], keys: [...st.keys], maxIdleMs: st.maxIdleMs, firstFrameAfterSubMs: st.firstAt === null ? null : st.firstAt - sentAt, zeroSizes: st.zeroSizes, sizeTypes: [...st.sizeTypes], oGaps: st.oGaps, oGapSamples: st.oGapSamples, oOnSnapshot: st.oOnSnapshot, snapshotAtMs: st.snapshotAtMs, firstDeltaAfterSnapshot: st.firstDeltaAfterSnapshot, idOnlyDeltas: st.idOnlyDeltas, v3Steps: st.v3Steps };
  }
  for (const p of pongs) { const c = controls.find((x) => x.frame?.pong === p.sent); p.rttMs = c ? c.atMs - p.sentAtMs : null; }
  log('book_stats', { duplicateSubscribeAtMs: dupAt, pongs, stats: out, diffBookMaxLevels: Object.fromEntries(symbols.map((s) => [s, books[s].maxLevels])), consistency, controls: controls.slice(0, 20), other, msgs, bytes, info: { ...info, upgradeHeaders: undefined } });
  log('book_firsts', { firsts });
}

async function batch() {
  const order = await ranked();
  const depthSet = order.filter((_, i) => i % 5 === 0).slice(0, 150);
  const diffSet = order.filter((s) => !depthSet.includes(s)).slice(0, 300);
  const run = async (topic, symbols) => {
    const { ws, info, ready, t0 } = open();
    await ready;
    const per = new Map();
    const perSecond = new Map();
    const controls = [];
    let msgs = 0; let bytes = 0; let parseNs = 0n;
    const lastO = new Map();
    let snapshots = 0; let deltas = 0; let oGaps = 0; let deltaBeforeSnapshot = 0;
    const oGapSamples = [];
    ws.on('message', (data) => {
      const p0 = process.hrtime.bigint();
      const j = JSON.parse(data.toString());
      parseNs += process.hrtime.bigint() - p0;
      if (j.topic !== topic) { if (controls.length < 10) controls.push(data.toString().slice(0, 200)); return; }
      msgs++; bytes += data.length;
      per.set(j.symbol, (per.get(j.symbol) ?? 0) + 1);
      if (topic === 'diffDepth') for (const d of j.data ?? []) {
        if (j.f === true) { snapshots++; lastO.set(j.symbol, null); continue; }
        const last = lastO.get(j.symbol);
        if (last === undefined) deltaBeforeSnapshot++;
        else if (last !== null && d.o !== last + 1) { oGaps++; if (oGapSamples.length < 5) oGapSamples.push({ symbol: j.symbol, expected: last + 1, got: d.o }); }
        lastO.set(j.symbol, d.o);
        deltas++;
      }
      const sec = Math.floor((performance.now() - t0) / 1000);
      perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    });
    const frame = sub(symbols, topic, { binary: false });
    ws.send(frame);
    const ping = setInterval(() => ws.send(JSON.stringify({ ping: Date.now() })), 20_000);
    await sleep(BATCH_MS);
    clearInterval(ping);
    ws.close();
    const secs = [...perSecond.values()].slice(2, -1).sort((a, b) => a - b);
    const silent = symbols.filter((s) => !per.has(s));
    log('batch', { topic, symbols: symbols.length, frameChars: frame.length, delivered: per.size, silent: silent.slice(0, 20), silentCount: silent.length, msgs, perSecondMedian: secs[Math.floor(secs.length / 2)], perSecondMax: secs[secs.length - 1], bytesPerSecond: Math.round(bytes / (BATCH_MS / 1000)), bytesPerFrame: Math.round(bytes / Math.max(1, msgs)), parseUsPerFrame: +(Number(parseNs) / 1000 / Math.max(1, msgs)).toFixed(1), snapshots, deltas, oGaps, oGapSamples, deltaBeforeSnapshot, controls, closed: info.closed, pings: info.pings.length });
  };
  await Promise.all([run('depth', depthSet), run('diffDepth', diffSet)]);
}

async function silence() {
  const order = await ranked();
  const quiet = order[order.length - 3];
  const cases = [
    { name: 'no subscribe, no ping' },
    { name: `diffDepth ${quiet}, no ping`, frame: sub([quiet], 'diffDepth', { binary: false }) },
    { name: 'no subscribe, ping every 30 s', pingMs: 30_000 },
  ];
  const socks = [];
  for (const c of cases) {
    const s = open();
    await s.ready;
    s.frames = 0; s.lastFrameAtMs = null;
    s.ws.on('message', () => { s.frames++; s.lastFrameAtMs = Math.round(performance.now() - s.t0); });
    if (c.frame) s.ws.send(c.frame);
    if (c.pingMs) s.timer = setInterval(() => { if (s.ws.readyState === 1) s.ws.send(JSON.stringify({ ping: Date.now() })); }, c.pingMs);
    socks.push({ c, s });
  }
  const t0 = performance.now();
  while (performance.now() - t0 < SILENCE_MS && socks.some(({ s }) => !s.info.closed)) await sleep(1_000);
  for (const { c, s } of socks) {
    clearInterval(s.timer);
    log('silence', { case: c.name, closed: s.info.closed, serverPings: s.info.pings.length, frames: s.frames, lastFrameAtMs: s.lastFrameAtMs, heldMs: Math.round(performance.now() - s.t0) });
    if (!s.info.closed) s.ws.close();
  }
}

async function deflate() {
  const { ws, info, ready } = open(URL_WS, { perMessageDeflate: true });
  await ready;
  await sleep(500);
  log('deflate', { offered: true, negotiated: info.extensions, header: info.upgradeHeaders?.['sec-websocket-extensions'] ?? null, server: info.upgradeHeaders?.server, cfRay: info.upgradeHeaders?.['cf-ray'], openMs: info.openMs });
  ws.close();
}

// Whole frames for the profile, with every level array cut to its first three entries and nothing else changed.
async function frames() {
  const { ws, ready } = open();
  await ready;
  const out = [];
  const trim = (j) => ({ ...j, data: (j.data ?? []).map((d) => ({ ...d, ...(d.b ? { b: d.b.slice(0, 3) } : {}), ...(d.a ? { a: d.a.slice(0, 3) } : {}), levels: `${d.b?.length ?? 0}/${d.a?.length ?? 0}` })) });
  ws.on('message', (data) => {
    const j = JSON.parse(data.toString());
    if (j.topic === 'diffDepth' && out.length < 4) out.push(trim(j));
  });
  ws.send(sub(['BTC-SWAP-USDT'], 'diffDepth', { binary: false }));
  await sleep(6_000);
  ws.close();
  for (const f of out) log('frame', { frame: f });
}

async function all() {
  const s = silence();
  await book();
  await batch();
  await deflate();
  await s;
}

const mode = process.argv[2] ?? 'all';
const run = { all, book, batch, silence, deflate, frames }[mode];
if (!run) { console.error(`unknown mode ${mode}`); process.exit(1); }
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
