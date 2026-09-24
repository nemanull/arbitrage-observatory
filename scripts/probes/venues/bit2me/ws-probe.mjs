// Bit2Me WebSocket probe: the Pro spot order-book channel (snapshot or delta, cadence, nonce, level order, depth, repeats),
// a REST book compare, error replies, many markets on one connection, keepalive and silence, deflate, and the documented
// futures socket next to a bogus path.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Subscribe frames are paced under the published 50 per second per connection.
// Run from server/: node ../scripts/probes/venues/bit2me/ws-probe.mjs [book|batch|session|deflate|futures]
//   book     order-book on five markets and public-trades on BTC/EUR for 40 s, a REST book compare, then error cases. About 75 s.
//   batch    order-book on every enabled market on one connection, one subscribe frame per market at 25 per second, held 40 s. About 55 s.
//   session  one socket that never subscribes or sends, held up to 100 s, and one subscribed to BTC/EUR that never pings, held 45 s. About 100 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 3 s.
//   futures  the documented futures URL with the documented frames and with Centrifugo frames, and a bogus path, 12 s each. About 13 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/bit2me/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const SPOT_URL = 'wss://ws.bit2me.com/v1/trading';
const FUTURES_URL = 'wss://ws.bit2me.com/v1/futures/connection/websocket';
const API = 'https://gateway.bit2me.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const sub = (symbol, name = 'order-book') => ({ event: 'subscribe', symbol, subscription: { name } });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 20000) + '\n');
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  const state = { ws, t0, frames: [], openMs: null, closed: null, pings: [], upgradeHeaders: null };
  ws.on('upgrade', (res) => (state.upgradeHeaders = res.headers));
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => log('refused', { url, status: res.statusCode, body: body.slice(0, 300) }));
  });
  ws.on('ping', () => state.pings.push(Math.round(performance.now() - t0)));
  ws.on('close', (code, reason) => (state.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }));
  ws.on('error', (e) => log('socket_error', { url, message: e.message }));
  state.ready = new Promise((resolve) => ws.on('open', () => {
    state.openMs = Math.round(performance.now() - t0);
    resolve();
  }));
  return state;
}

function levelsOk(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    if (dir === 'desc' ? levels[i][0] >= levels[i - 1][0] : levels[i][0] <= levels[i - 1][0]) return false;
  }
  return true;
}

async function book() {
  const symbols = ['BTC/EUR', 'ETH/EUR', 'BTC/USDC', 'B2M/EUR', 'PERP/EUR'];
  const s = open(SPOT_URL);
  const per = new Map(symbols.map((x) => [x, { frames: 0, at: [], bids: [], asks: [], nonces: [], repeats: 0, last: null, keys: new Set(), levelWidths: new Set(), orderBad: 0, emptySide: 0, bytes: 0 }]));
  const others = [];
  let trades = 0;
  s.ws.on('message', (raw) => {
    const text = raw.toString();
    const at = Math.round(performance.now() - s.t0);
    const m = JSON.parse(text);
    if (m.event === 'order-book' && per.has(m.symbol)) {
      const p = per.get(m.symbol);
      p.frames++;
      p.bytes += text.length;
      p.at.push(at);
      Object.keys(m.data).forEach((k) => p.keys.add(k));
      p.bids.push(m.data.bids.length);
      p.asks.push(m.data.asks.length);
      p.nonces.push(m.data.nonce);
      for (const l of [...m.data.bids, ...m.data.asks]) p.levelWidths.add(l.length);
      if (!levelsOk(m.data.bids, 'desc') || !levelsOk(m.data.asks, 'asc')) p.orderBad++;
      if (m.data.bids.length === 0 || m.data.asks.length === 0) p.emptySide++;
      const body = JSON.stringify([m.data.bids, m.data.asks]);
      if (body === p.last) p.repeats++;
      p.last = body;
      p.latest = m.data;
      p.latestAt = Date.now();
      if (p.frames <= 2) capture('book-frames.jsonl', text);
    } else if (m.event === 'public-trades') {
      trades++;
      if (trades <= 2) capture('trade-frames.jsonl', text);
    } else {
      others.push({ at, text: text.slice(0, 300) });
    }
  });
  await s.ready;
  log('open', { url: SPOT_URL, openMs: s.openMs });
  const subAt = new Map();
  for (const x of symbols) {
    subAt.set(x, Math.round(performance.now() - s.t0));
    s.ws.send(JSON.stringify(sub(x)));
    await sleep(50);
  }
  s.ws.send(JSON.stringify(sub('BTC/EUR', 'public-trades')));

  await sleep(20_000);
  const rest = await (await fetch(`${API}/v2/trading/order-book?symbol=BTC/EUR`)).json();
  const wsBook = per.get('BTC/EUR').latest;
  const wsAge = Date.now() - per.get('BTC/EUR').latestAt;
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  let bidSame = 0;
  let askSame = 0;
  for (let i = 0; i < 20; i++) {
    if (same(wsBook?.bids[i], rest.bids[i])) bidSame++;
    if (same(wsBook?.asks[i], rest.asks[i])) askSame++;
  }
  log('rest_compare', {
    symbol: 'BTC/EUR',
    wsFrameAgeMs: wsAge,
    wsTouch: [wsBook?.bids[0], wsBook?.asks[0]],
    restTouch: [rest.bids[0], rest.asks[0]],
    top20Equal: { bids: bidSame, asks: askSame },
    wsNonce: wsBook?.nonce,
    restNonce: rest.nonce,
  });
  await sleep(20_000);

  for (const [x, p] of per) {
    const gaps = p.at.slice(1).map((t, i) => t - p.at[i]);
    const nonceSet = new Set(p.nonces);
    log('book_stream', {
      symbol: x,
      frames: p.frames,
      firstFrameMsAfterSubscribe: p.at.length ? p.at[0] - subAt.get(x) : null,
      intervalMs: { min: gaps.length ? Math.min(...gaps) : null, median: pct(gaps, 50), p90: pct(gaps, 90), max: gaps.length ? Math.max(...gaps) : null },
      bidsPerFrame: { min: Math.min(...p.bids), max: Math.max(...p.bids) },
      asksPerFrame: { min: Math.min(...p.asks), max: Math.max(...p.asks) },
      dataKeys: [...p.keys],
      levelWidths: [...p.levelWidths],
      framesOutOfOrder: p.orderBad,
      framesWithEmptySide: p.emptySide,
      identicalRepeats: p.repeats,
      distinctNonces: nonceSet.size,
      nonceSample: [...nonceSet].slice(0, 3),
      meanBytes: p.frames ? Math.round(p.bytes / p.frames) : null,
    });
  }
  log('trades', { frames: trades });
  log('control_frames', { frames: others });
  s.ws.close();

  const e = open(SPOT_URL);
  const replies = [];
  let phase = 'before';
  const ethFrames = {};
  e.ws.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.event === 'order-book') {
      const k = `${m.symbol} ${phase}`;
      ethFrames[k] = (ethFrames[k] ?? 0) + 1;
      return;
    }
    replies.push({ at: Math.round(performance.now() - e.t0), text: text.slice(0, 300) });
  });
  await e.ready;
  const cases = [
    ['unknown symbol', sub('NOPE/EUR')],
    ['frozen symbol', sub('B2M/USDR')],
    ['dash symbol', sub('BTC-EUR')],
    ['unknown channel', sub('BTC/EUR', 'nope')],
    ['missing symbol', { event: 'subscribe', subscription: { name: 'order-book' } }],
    ['first subscribe', sub('ETH/EUR')],
    ['double subscribe', sub('ETH/EUR')],
    ['unsubscribe', { event: 'unsubscribe', symbol: 'ETH/EUR', subscription: { name: 'order-book' } }],
    ['app ping', { event: 'ping' }],
    ['unknown event', { event: 'nope' }],
    ['private channel', { event: 'subscribe', subscription: { name: 'my-trades' } }],
  ];
  for (const [label, frame] of cases) {
    replies.push({ sent: label });
    e.ws.send(JSON.stringify(frame));
    if (label === 'double subscribe') {
      phase = 'after double subscribe';
      await sleep(8000);
      phase = 'after unsubscribe';
      continue;
    }
    if (label === 'first subscribe') {
      phase = 'after first subscribe';
      await sleep(8000);
      continue;
    }
    await sleep(900);
  }
  replies.push({ sent: 'not json' });
  e.ws.send('hello');
  await sleep(1500);
  await sleep(6000);
  log('error_cases', { replies, orderBookFramesByPhase: ethFrames, closed: e.closed });
  e.ws.close();
  await sleep(300);
}

async function batch() {
  const markets = (await (await fetch(`${API}/v1/trading/market-config`)).json()).filter((m) => m.marketEnabled === 'enabled');
  const s = open(SPOT_URL);
  const per = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let acks = 0;
  const other = [];
  const perSecond = new Map();
  s.ws.on('message', (raw) => {
    const text = raw.toString();
    const t = process.hrtime.bigint();
    const m = JSON.parse(text);
    parseNs += process.hrtime.bigint() - t;
    if (m.event === 'order-book') {
      frames++;
      bytes += text.length;
      const sec = Math.floor((performance.now() - s.t0) / 1000);
      perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
      const p = per.get(m.symbol) ?? { n: 0, bids: 0, asks: 0, empty: 0, sig: '', nonces: new Set() };
      p.sig = Object.keys(m.data).sort().join(',') + ' w' + [...new Set([...m.data.bids, ...m.data.asks].map((l) => l.length))].join('');
      p.nonces.add(m.data.nonce);
      p.n++;
      p.bids = Math.max(p.bids, m.data.bids.length);
      p.asks = Math.max(p.asks, m.data.asks.length);
      if (m.data.bids.length === 0 || m.data.asks.length === 0) p.empty++;
      per.set(m.symbol, p);
    } else if (m.result === 'subscribed') {
      acks++;
    } else if (other.length < 5) {
      other.push(text.slice(0, 200));
    }
  });
  await s.ready;
  const t0 = performance.now();
  for (const m of markets) {
    s.ws.send(JSON.stringify(sub(m.symbol)));
    await sleep(40);
  }
  const sendMs = Math.round(performance.now() - t0);
  const holdFrom = Math.floor((performance.now() - s.t0) / 1000);
  await sleep(40_000);
  const secs = [...perSecond.entries()].filter(([k]) => k > holdFrom && k < holdFrom + 39).map(([, v]) => v);
  const counts = [...per.values()].map((p) => p.n);
  const silent = markets.filter((m) => !per.has(m.symbol)).map((m) => m.symbol);
  const maxBids = [...per.values()].map((p) => p.bids);
  log('batch', {
    markets: markets.length,
    subscribeSendMs: sendMs,
    acks,
    marketsWithFrames: per.size,
    silentMarkets: silent.length,
    silentSample: silent.slice(0, 12),
    framesPerMarket: { min: Math.min(...counts), median: pct(counts, 50), max: Math.max(...counts) },
    framesPerSecondDuringHold: { median: pct(secs, 50), max: Math.max(...secs) },
    totalFrames: frames,
    kbPerSecond: Math.round(bytes / 1024 / ((performance.now() - s.t0) / 1000)),
    meanFrameBytes: Math.round(bytes / frames),
    parseUsPerFrame: Math.round(Number(parseNs / BigInt(frames)) / 1000),
    maxBidLevels: { min: Math.min(...maxBids), median: pct(maxBids, 50), max: Math.max(...maxBids) },
    shapes: Object.entries([...per.entries()].reduce((acc, [k, p]) => {
      const key = `${p.sig} nonce ${p.nonces.size === 1 ? 'fixed' : 'changing'}`;
      acc[key] = acc[key] ?? { markets: 0, sample: [] };
      acc[key].markets++;
      if (acc[key].sample.length < 12) acc[key].sample.push(k);
      return acc;
    }, {})),
    marketsWithEmptySideFrames: [...per.entries()].filter(([, p]) => p.empty > 0).map(([k, p]) => `${k}:${p.empty}/${p.n}`).slice(0, 15),
    other,
    closed: s.closed,
  });
  s.ws.close();
  await sleep(300);
}

async function session() {
  const quiet = open(SPOT_URL);
  const subbed = open(SPOT_URL);
  let subbedFrames = 0;
  subbed.ws.on('message', () => subbedFrames++);
  let quietFrames = 0;
  quiet.ws.on('message', (raw) => {
    quietFrames++;
    capture('session-quiet.jsonl', raw.toString());
  });
  await Promise.all([quiet.ready, subbed.ready]);
  subbed.ws.send(JSON.stringify(sub('BTC/EUR')));
  const start = performance.now();
  while (performance.now() - start < 100_000 && !quiet.closed) {
    if (performance.now() - start > 45_000 && !subbed.closed) subbed.ws.terminate();
    await sleep(500);
  }
  log('session', {
    quiet: { openMs: quiet.openMs, frames: quietFrames, serverPingsAtMs: quiet.pings, closed: quiet.closed ?? 'open at 100 s' },
    subscribed: { openMs: subbed.openMs, frames: subbedFrames, serverPingsAtMs: subbed.pings, closed: subbed.closed },
  });
  quiet.ws.terminate();
  subbed.ws.terminate();
}

async function deflate() {
  const s = open(SPOT_URL, { deflate: true });
  await s.ready;
  log('deflate', { offered: true, extensions: s.upgradeHeaders?.['sec-websocket-extensions'] ?? null, negotiated: s.ws.extensions });
  s.ws.close();
  await sleep(500);
}

async function futures() {
  const variants = [
    ['documented', FUTURES_URL, [{ channel: 'orderbook:BTCUSDC_PERP' }, { channel: 'ticker:BTCUSDC_PERP' }, { channel: 'market-trades:ETHUSDC_PERP' }]],
    ['centrifugo', FUTURES_URL, [{ id: 1, connect: { name: 'probe' } }, { id: 2, subscribe: { channel: 'orderbook:BTCUSDC_PERP' } }]],
    ['bogus path control', 'wss://ws.bit2me.com/v1/nope', [sub('BTC/EUR')]],
    ['futures frame on the spot URL', SPOT_URL, [{ channel: 'orderbook:BTCUSDC_PERP' }, sub('BTCUSDC_PERP')]],
  ];
  const runs = variants.map(async ([label, url, frames]) => {
    const s = open(url);
    const got = [];
    s.ws.on('message', (raw) => got.push(raw.toString().slice(0, 200)));
    await s.ready;
    for (const f of frames) s.ws.send(JSON.stringify(f));
    await sleep(12_000);
    const status = s.upgradeHeaders ? 101 : null;
    s.ws.terminate();
    return { label, url, upgrade: status, openMs: s.openMs, frames: got.length, first: got.slice(0, 3), closedBeforeEnd: s.closed };
  });
  for (const r of await Promise.all(runs)) log('futures_socket', r);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, session, deflate, futures };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
