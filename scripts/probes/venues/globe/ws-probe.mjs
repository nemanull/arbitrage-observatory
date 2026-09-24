// Globe public WebSocket probe: depth channel cadence, levels and order, repeats, errors, product details, anchor channels, a batch of every active perpetual, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/globe/ws-probe.mjs [book|batch|silence|deflate|app]
//   book     depth on BTC, ETH, XLM, PEPE, a suspended and an unknown instrument, product-detail on every contract, index-price and market-overview, error cases, one REST book compare. About 60 s.
//   batch    depth on every Active perpetual on one socket for 45 s.
//   silence  two sockets that subscribe nothing and send no frame: one answers protocol pings for up to 90 s, one never answers them, for up to 60 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
//   app      the web app socket wss://globe.exchange/app/ws, depth on BTC-PERP for 10 s, to compare its cadence with the documented API socket.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/globe/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://globe.exchange/api/v1/ws';
const APP_URL = 'wss://globe.exchange/app/ws';
const API = 'https://globe.exchange/api/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const trim = (s, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0 }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

async function send(ws, obj, gapMs = 30) {
  ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  await sleep(gapMs);
}

function keyOf(sub) {
  return `${sub.channel}|${sub.instrument ?? ''}|${sub.grouping ?? ''}`;
}

// Tracks depth frames per subscription key: cadence, levels, order, identical repeats.
function depthStats() {
  const m = new Map();
  return {
    add(key, data, now) {
      let s = m.get(key);
      if (!s) {
        s = { n: 0, first: now, last: null, gaps: [], bidN: [], askN: [], bidUnordered: 0, askUnordered: 0, repeats: 0, crossed: 0, prev: null, empty: 0, touchUsd: [], top5Usd: [], stampLag: [] };
        m.set(key, s);
      }
      s.n++;
      if (s.last !== null) s.gaps.push(now - s.last);
      s.last = now;
      const bids = data.bids ?? [];
      const asks = data.asks ?? [];
      s.bidN.push(bids.length);
      s.askN.push(asks.length);
      if (bids.length === 0 || asks.length === 0) s.empty++;
      for (let i = 1; i < bids.length; i++) if (!(bids[i - 1].price > bids[i].price)) { s.bidUnordered++; break; }
      for (let i = 1; i < asks.length; i++) if (!(asks[i - 1].price < asks[i].price)) { s.askUnordered++; break; }
      if (bids.length && asks.length && bids[0].price >= asks[0].price) s.crossed++;
      if (bids.length && asks.length) {
        s.touchUsd.push(Math.min(bids[0].price * bids[0].volume, asks[0].price * asks[0].volume));
        const side5 = (xs) => xs.slice(0, 5).reduce((a, l) => a + l.price * l.volume, 0);
        s.top5Usd.push(Math.min(side5(bids), side5(asks)));
      }
      if (typeof data.timestamp === 'number') s.stampLag.push(now - data.timestamp);
      // Levels only, since the timestamp changes on every frame.
      const body = JSON.stringify([bids, asks]);
      if (body === s.prev) s.repeats++;
      s.prev = body;
      s.lastData = data;
    },
    summary() {
      const out = {};
      for (const [k, s] of m) {
        out[k] = {
          frames: s.n,
          gapMin: q(s.gaps, 0), gapMed: q(s.gaps, 0.5), gapP90: q(s.gaps, 0.9), gapMax: q(s.gaps, 1),
          bidLevels: [q(s.bidN, 0), q(s.bidN, 1)], askLevels: [q(s.askN, 0), q(s.askN, 1)],
          bidUnorderedFrames: s.bidUnordered, askUnorderedFrames: s.askUnordered,
          identicalRepeats: s.repeats, crossedFrames: s.crossed, oneSidedOrEmpty: s.empty,
          touchUsdMed: s.touchUsd.length ? Math.round(q(s.touchUsd, 0.5)) : null, top5UsdMed: s.top5Usd.length ? Math.round(q(s.top5Usd, 0.5)) : null,
          stampLagMed: q(s.stampLag, 0.5), stampLagMax: q(s.stampLag, 1),
        };
      }
      return out;
    },
    get: (k) => m.get(k),
  };
}

async function bookMode() {
  const { ws, openMs } = await open(WS_URL);
  log('open', { url: WS_URL, openMs, extensions: ws.extensions ?? null });
  const t0 = Date.now();
  const depth = depthStats();
  const firstFrameAt = new Map();
  const subSentAt = new Map();
  const others = [];
  const keysSeen = new Map();
  const productDetail = {};
  const overview = new Map();
  let productList = null;
  let serverPings = 0;
  ws.on('ping', () => serverPings++);
  ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString('utf8');
    capture('book.jsonl', `${now} ${text}`);
    let msg;
    try { msg = JSON.parse(text); } catch { others.push({ at: now - t0, text: trim(text) }); return; }
    const sub = msg.subscription;
    if (!sub) { others.push({ at: now - t0, text: trim(text) }); return; }
    const k = keyOf(sub);
    if (!firstFrameAt.has(k)) {
      firstFrameAt.set(k, now);
      keysSeen.set(k, { topKeys: Object.keys(msg), subKeys: Object.keys(sub), dataKeys: msg.data && !Array.isArray(msg.data) ? Object.keys(msg.data) : Array.isArray(msg.data) ? `array(${msg.data.length})` : typeof msg.data, sample: trim(text, 600) });
    }
    if (sub.channel === 'depth') depth.add(k, msg.data, now);
    else if (sub.channel === 'product-list') productList = msg.data;
    else if (sub.channel === 'product-detail') productDetail[sub.instrument] = msg.data;
    else if (sub.channel === 'market-overview' || sub.channel === 'index-price') {
      let o = overview.get(k);
      if (!o) { o = { n: 0, at: [], fields: {} }; overview.set(k, o); }
      o.n++;
      o.at.push(now);
      for (const f of Object.keys(msg.data ?? {})) o.fields[f] = (o.fields[f] ?? 0) + 1;
      o.lastData = msg.data;
    }
  });
  ws.on('close', (code, reason) => log('close', { atMs: Date.now() - t0, code, reason: reason.toString() }));

  const sub = async (o) => { subSentAt.set(keyOf(o), Date.now()); await send(ws, { command: 'subscribe', ...o }); };
  await sub({ channel: 'product-list' });
  for (const inst of ['BTC-PERP', 'ETH-PERP', 'XLM-PERP', 'PEPE-PERP', 'IOTA-PERP', 'NOPE-PERP']) await sub({ channel: 'depth', instrument: inst });
  await sub({ channel: 'depth', instrument: 'ETH-PERP', grouping: 10 });
  await sub({ channel: 'index-price', instrument: 'BTC-PERP' });
  await sub({ channel: 'market-overview', instrument: 'BTC-PERP' });
  await sub({ channel: 'market-overview', instrument: 'XLM-PERP' });
  await sub({ channel: 'open-interest', instrument: 'BTC-PERP' });
  await sleep(1500);
  // Error cases, each after a pause so its reply can be matched by time.
  const errCases = [
    ['duplicate depth BTC-PERP', { command: 'subscribe', channel: 'depth', instrument: 'BTC-PERP' }],
    ['unknown channel', { command: 'subscribe', channel: 'nope', instrument: 'BTC-PERP' }],
    ['depth without instrument', { command: 'subscribe', channel: 'depth' }],
    ['unknown command', { command: 'nope' }],
    ['text that is not JSON', 'hello'],
    ['depth bad grouping 3', { command: 'subscribe', channel: 'depth', instrument: 'BTC-PERP', grouping: 3 }],
    ['depth spot instrument BTC/USDT', { command: 'subscribe', channel: 'depth', instrument: 'BTC/USDT' }],
  ];
  for (const [name, frame] of errCases) {
    const before = others.length;
    const at = Date.now() - t0;
    await send(ws, frame, 1200);
    log('error_case', { name, sentAtMs: at, replies: others.slice(before).map((o) => o.text) });
  }
  // Product detail for every instrument in the REST contracts list.
  const contracts = await (await fetch(`${API}/ticker/contracts`)).json();
  const instruments = contracts.map((c) => c.instrument);
  for (const inst of instruments) await sub({ channel: 'product-detail', instrument: inst });
  // One REST book read against the socket's last BTC frame.
  await sleep(2000);
  const rest = await (await fetch(`${API}/ticker/orderbook?instrument=BTC-PERP`)).json();
  const sock = depth.get('depth|BTC-PERP|')?.lastData;
  if (sock && rest.bids) {
    const top = (arr, restArr) => arr.slice(0, 10).map((l, i) => ({ s: [l.price, l.volume], r: restArr[i] ?? null }));
    log('rest_vs_socket_btc', { restBidLevels: rest.bids.length, restAskLevels: rest.asks.length, bids: top(sock.bids, rest.bids).slice(0, 5), asks: top(sock.asks, rest.asks).slice(0, 5), sameTopBid: sock.bids[0]?.price === rest.bids[0]?.[0], sameTopAsk: sock.asks[0]?.price === rest.asks[0]?.[0] });
  }
  // Protocol ping round trips, to split the depth stamp to arrival gap into path and clock.
  const rtts = [];
  let pingSent = 0;
  ws.on('pong', () => rtts.push(Date.now() - pingSent));
  for (let i = 0; i < 5; i++) {
    pingSent = Date.now();
    ws.ping();
    await sleep(1000);
  }
  log('client_ping_rtt_ms', { rtts });
  while (Date.now() - t0 < 60_000) await sleep(500);
  ws.close();
  await sleep(300);

  log('keys', Object.fromEntries(keysSeen));
  log('first_frame_ms', Object.fromEntries([...firstFrameAt].map(([k, v]) => [k, subSentAt.has(k) ? v - subSentAt.get(k) : null])));
  log('never_delivered', { keys: [...subSentAt.keys()].filter((k) => !firstFrameAt.has(k)) });
  log('depth', depth.summary());
  for (const k of ['depth|BTC-PERP|', 'depth|XLM-PERP|', 'depth|PEPE-PERP|', 'depth|ETH-PERP|10']) {
    const d = depth.get(k)?.lastData;
    if (d) log('depth_last', { k, bids: d.bids.slice(0, 3), asks: d.asks.slice(0, 3), bidN: d.bids.length, askN: d.asks.length });
  }
  for (const [k, o] of overview) {
    const gaps = o.at.slice(1).map((t, i) => t - o.at[i]);
    log('overview', { k, pushes: o.n, gapMed: q(gaps, 0.5), gapMin: q(gaps, 0), gapMax: q(gaps, 1), fieldCounts: o.fields, last: o.lastData });
  }
  if (Array.isArray(productList)) {
    const byCat = {};
    for (const p of productList) byCat[p.category] = (byCat[p.category] ?? 0) + 1;
    log('product_list', { n: productList.length, byCategory: byCat, perps: productList.filter((p) => p.category !== 'Spot').map((p) => p.symbol) });
  }
  const pd = Object.entries(productDetail);
  log('product_detail_count', { n: pd.length, of: instruments.length });
  for (const [inst, d] of pd) log('product_detail', { inst, ...d });
  log('others', { n: others.length, sample: others.slice(0, 12) });
  log('server_pings', { n: serverPings });
}
async function batchMode() {
  const contracts = await (await fetch(`${API}/ticker/contracts`)).json();
  const active = contracts.filter((c) => c.product_status === 'Active').map((c) => c.instrument);
  const { ws, openMs } = await open(WS_URL);
  log('open', { openMs, instruments: active.length });
  const depth = depthStats();
  let frames = 0, bytes = 0, parseNs = 0n;
  const perSecond = new Map();
  let t0 = Date.now();
  ws.on('message', (raw) => {
    const now = Date.now();
    frames++;
    bytes += raw.length;
    const a = process.hrtime.bigint();
    const msg = JSON.parse(raw.toString('utf8'));
    parseNs += process.hrtime.bigint() - a;
    const sec = Math.floor((now - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (msg.subscription?.channel === 'depth') depth.add(msg.subscription.instrument, msg.data, now);
    else capture('batch-other.jsonl', `${now} ${trim(raw.toString('utf8'))}`);
  });
  ws.on('close', (code) => log('close', { atMs: Date.now() - t0, code }));
  t0 = Date.now();
  for (const inst of active) await send(ws, { command: 'subscribe', channel: 'depth', instrument: inst }, 25);
  await sleep(45_000);
  ws.close();
  await sleep(300);
  const secs = [...perSecond.entries()].filter(([s]) => s >= 2 && s < 44).map(([, n]) => n);
  const sum = depth.summary();
  log('batch', {
    instruments: active.length, delivered: Object.keys(sum).length, frames, bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    framesPerSecondMed: q(secs, 0.5), framesPerSecondMax: q(secs, 1), bytesPerSecond: Math.round(bytes / 45),
    parseUsPerFrame: Number(parseNs / BigInt(Math.max(1, frames))) / 1000,
  });
  const rows = Object.entries(sum).map(([k, s]) => `${k} n=${s.frames} gapMed=${s.gapMed} gapMax=${s.gapMax} bids=${s.bidLevels.join('-')} asks=${s.askLevels.join('-')} sameLevels=${s.identicalRepeats} unord=${s.bidUnorderedFrames}/${s.askUnorderedFrames} crossed=${s.crossedFrames} empty=${s.oneSidedOrEmpty} touchUsdMed=${s.touchUsdMed} top5UsdMed=${s.top5UsdMed} stampLagMed=${s.stampLagMed}`);
  for (const r of rows) console.log(r);
  const missing = active.filter((a) => !sum[a]);
  log('missing', { missing });
}

async function silenceMode() {
  const t0 = Date.now();
  const mk = async (name, limitMs, opts = {}) => {
    const { ws, openMs } = await open(WS_URL, opts);
    const s = { name, openMs, frames: 0, pings: 0, pingAt: [], closed: null };
    ws.on('ping', () => { s.pings++; s.pingAt.push(Date.now() - t0); });
    ws.on('message', () => { s.frames++; });
    ws.on('close', (code, reason) => { s.closed = { atMs: Date.now() - t0, code, reason: reason.toString() }; log('close', { name, ...s.closed }); });
    return { ws, s, limitMs };
  };
  // ws answers a protocol ping with a pong by default, as the engine's sockets do, so the first socket still answers pings.
  const a = await mk('nothing_sent_auto_pong', 90_000);
  const b = await mk('no_pong', 60_000, { autoPong: false });
  const socks = [a, b];
  while (socks.some((x) => x.s.closed === null && Date.now() - t0 < x.limitMs)) await sleep(250);
  for (const x of socks) {
    if (x.s.closed === null) x.ws.close();
    log('silence', { ...x.s, pingAt: x.s.pingAt.slice(0, 6) });
  }
  await sleep(300);
}

async function deflateMode() {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: true });
  const res = await new Promise((resolve, reject) => {
    ws.once('upgrade', (r) => resolve(r.headers));
    ws.once('error', reject);
  });
  log('deflate', { openMs: Date.now() - t0, secWebSocketExtensions: res['sec-websocket-extensions'] ?? null, server: res.server ?? null, cfRay: res['cf-ray'] ?? null });
  await sleep(500);
  ws.close();
  await sleep(200);
}

async function appMode() {
  let ws, openMs;
  try {
    ({ ws, openMs } = await open(APP_URL));
  } catch (e) {
    log('app_open_failed', { error: String(e) });
    return;
  }
  log('app_open', { openMs });
  const depth = depthStats();
  const others = [];
  ws.on('message', (raw) => {
    const now = Date.now();
    const text = raw.toString('utf8');
    capture('app.jsonl', `${now} ${text}`);
    let msg;
    try { msg = JSON.parse(text); } catch { others.push(trim(text)); return; }
    if (msg.subscription?.channel === 'depth') depth.add(msg.subscription.instrument, msg.data, now);
    else others.push(trim(text, 300));
  });
  ws.on('close', (code) => log('close', { code }));
  await send(ws, { command: 'subscribe', channel: 'depth', instrument: 'BTC-PERP' });
  await sleep(10_000);
  ws.close();
  await sleep(300);
  log('app_depth', depth.summary());
  log('app_others', { n: others.length, sample: others.slice(0, 5) });
}

const mode = process.argv[2] ?? 'book';
const modes = { book: bookMode, batch: batchMode, silence: silenceMode, deflate: deflateMode, app: appMode };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
