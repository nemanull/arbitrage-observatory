// GMO Coin public WebSocket probe: the orderbooks channel on every leverage symbol, frame shape and cadence, level order, repeats, a REST compare, ticker and trades, errors, server pings, silence and deflate.
// Public, unauthenticated, read-only. Subscribes are spaced 1.1 s apart, inside the documented 1 subscribe per second per IP.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in deflate mode.
// Run from server/: node ../scripts/probes/venues/gmo-coin/ws-probe.mjs [book|silence|deflate]
//   book     one socket, orderbooks on the 12 leverage symbols and spot BTC, ticker and trades on BTC_JPY, four error cases, held 100 s from open. About 100 s.
//   silence  two sockets that never subscribe, one silent and one sending a protocol ping every 20 s, each held up to 100 s: server pings, pongs and who closes. About 100 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep the first frames per symbol and every control frame. Recorded in docs/profiles/gmo-coin/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUBLIC = 'wss://api.coin.z.com/ws/public/v1';
const API = 'https://api.coin.z.com/public';
const OUT = process.env.PROBE_OUT_DIR;
const SUBSCRIBE_GAP_MS = 1_100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => { const s = sorted(a); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = sorted(a); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(options = {}) {
  const t0 = performance.now();
  const socket = new WebSocket(URL_PUBLIC, { perMessageDeflate: false, ...options });
  return new Promise((resolve, reject) => {
    let extensions = null;
    socket.on('upgrade', (res) => { extensions = res.headers['sec-websocket-extensions'] ?? null; });
    socket.once('open', () => resolve({ socket, openMs: Math.round(performance.now() - t0), extensions }));
    socket.once('error', reject);
    socket.once('unexpected-response', (_req, res) => reject(new Error(`unexpected response ${res.statusCode}`)));
  });
}

async function book() {
  const tickerReply = await (await fetch(`${API}/v1/ticker`)).json();
  const leverage = tickerReply.data.map((x) => x.symbol).filter((s) => s.endsWith('_JPY')).sort();
  const bookSymbols = [...leverage, 'BTC'];

  const { socket, openMs, extensions } = await open();
  const openedAt = Date.now();
  log('open', { url: URL_PUBLIC, openMs, extensions });

  const stats = new Map();
  const pings = [];
  const control = [];
  const other = { ticker: 0, trades: 0 };
  let firstTicker = null;
  let firstTrade = null;
  let lastBtcJpy = null;
  let closed = null;
  const bytes = [];
  const parseUs = [];

  socket.on('ping', (data) => { pings.push(Date.now() - openedAt); capture('control.txt', `ping at ${Date.now() - openedAt} ms payload ${data.toString('hex')}`); });
  socket.on('close', (code, reason) => { closed = { code, reason: reason.toString(), atMs: Date.now() - openedAt }; });

  socket.on('message', (raw) => {
    const recv = Date.now();
    bytes.push(raw.length);
    const t0 = performance.now();
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { control.push({ atMs: recv - openedAt, text: raw.toString('utf8').slice(0, 300) }); return; }
    parseUs.push((performance.now() - t0) * 1000);

    if (msg.channel === 'orderbooks') {
      const s = stats.get(msg.symbol) ?? { frames: 0, bids: [], asks: [], gaps: [], ages: [], repeats: 0, repeatGaps: [], tsSteps: [], badBidOrder: 0, badAskOrder: 0, crossed: 0, oneSided: 0, lastRecv: null, lastBody: null, firstAtMs: null, tsRegress: 0, lastTs: null };
      s.frames++;
      if (s.firstAtMs === null) s.firstAtMs = recv - openedAt;
      s.bids.push(msg.bids.length);
      s.asks.push(msg.asks.length);
      if (s.lastRecv !== null) s.gaps.push(recv - s.lastRecv);
      s.lastRecv = recv;
      const ts = Date.parse(msg.timestamp);
      s.ages.push(recv - ts);
      if (s.lastTs !== null && ts < s.lastTs) s.tsRegress++;
      if (s.lastTs !== null) s.tsSteps.push(ts - s.lastTs);
      s.lastTs = ts;
      const body = JSON.stringify([msg.bids, msg.asks]);
      if (body === s.lastBody) { s.repeats++; s.repeatGaps.push(s.gaps[s.gaps.length - 1]); }
      s.lastBody = body;
      const b = msg.bids.map((l) => Number(l.price));
      const a = msg.asks.map((l) => Number(l.price));
      if (!b.every((p, i) => i === 0 || p < b[i - 1])) s.badBidOrder++;
      if (!a.every((p, i) => i === 0 || p > a[i - 1])) s.badAskOrder++;
      if (b.length && a.length && b[0] >= a[0]) s.crossed++;
      if (!b.length || !a.length) s.oneSided++;
      stats.set(msg.symbol, s);
      if (s.frames <= 2) capture(`orderbooks-${msg.symbol}.txt`, raw.toString('utf8'));
      if (msg.symbol === 'BTC_JPY') lastBtcJpy = { msg, recv };
      return;
    }
    if (msg.channel === 'ticker') { other.ticker++; firstTicker ??= msg; return; }
    if (msg.channel === 'trades') { other.trades++; firstTrade ??= msg; return; }
    control.push({ atMs: recv - openedAt, text: raw.toString('utf8').slice(0, 300) });
    capture('control.txt', raw.toString('utf8').slice(0, 2000));
  });

  const send = (obj) => {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    socket.send(text);
    capture('control.txt', `sent at ${Date.now() - openedAt} ms ${text}`);
  };

  const subscribeAt = {};
  for (const symbol of bookSymbols) {
    subscribeAt[symbol] = Date.now() - openedAt;
    send({ command: 'subscribe', channel: 'orderbooks', symbol });
    await sleep(SUBSCRIBE_GAP_MS);
  }
  send({ command: 'subscribe', channel: 'ticker', symbol: 'BTC_JPY' });
  await sleep(SUBSCRIBE_GAP_MS);
  send({ command: 'subscribe', channel: 'trades', symbol: 'BTC_JPY' });
  await sleep(SUBSCRIBE_GAP_MS);

  const errorCases = [
    { command: 'subscribe', channel: 'orderbooks', symbol: 'NOPE_JPY' },
    { command: 'subscribe', channel: 'nope', symbol: 'BTC_JPY' },
    'not json',
    { command: 'subscribe', channel: 'orderbooks', symbol: 'BTC_JPY' },
  ];
  for (const c of errorCases) {
    const before = control.length;
    send(c);
    await sleep(SUBSCRIBE_GAP_MS);
    log('error_case', { sent: c, replies: control.slice(before).map((x) => x.text), socketOpen: socket.readyState === WebSocket.OPEN });
  }

  // Compare one BTC_JPY socket frame with a REST read taken right after it arrives.
  await sleep(2_000);
  if (lastBtcJpy) {
    const ws = lastBtcJpy.msg;
    const rest = (await (await fetch(`${API}/v1/orderbooks?symbol=BTC_JPY&n=${Date.now()}`)).json()).data;
    const same = (x, y) => x.slice(0, 20).filter((l, i) => y[i] && l.price === y[i].price && l.size === y[i].size).length;
    log('rest_compare_BTC_JPY', { wsAgeAtRestMs: Date.now() - lastBtcJpy.recv, wsLevels: [ws.bids.length, ws.asks.length], restLevels: [rest.bids.length, rest.asks.length], top20BidsEqual: same(ws.bids, rest.bids), top20AsksEqual: same(ws.asks, rest.asks), wsTouch: [ws.bids[0], ws.asks[0]], restTouch: [rest.bids[0], rest.asks[0]] });
  }

  const holdUntil = openedAt + 100_000;
  while (Date.now() < holdUntil && !closed) await sleep(500);
  socket.close();
  await sleep(300);

  const heldMs = Date.now() - openedAt;
  log('session', { heldMs, pingsAtMs: pings, closed, frames: bytes.length, bytes: { median: median(bytes), p90: pct(bytes, 0.9), max: Math.max(...bytes), total: bytes.reduce((s, x) => s + x, 0) }, parseUs: { median: Math.round(median(parseUs)), p90: Math.round(pct(parseUs, 0.9)) } });
  for (const symbol of bookSymbols) {
    const s = stats.get(symbol);
    if (!s) { log('orderbooks', { symbol, frames: 0 }); continue; }
    log('orderbooks', {
      symbol, frames: s.frames, firstAfterSubscribeMs: s.firstAtMs - subscribeAt[symbol],
      levels: { bids: [Math.min(...s.bids), Math.max(...s.bids)], asks: [Math.min(...s.asks), Math.max(...s.asks)] },
      gapMs: s.gaps.length ? { min: Math.min(...s.gaps), median: median(s.gaps), p90: pct(s.gaps, 0.9), max: Math.max(...s.gaps) } : null,
      ageMs: { min: Math.min(...s.ages), median: median(s.ages), p90: pct(s.ages, 0.9), max: Math.max(...s.ages) },
      timestampStepMs: s.tsSteps.length ? { min: Math.min(...s.tsSteps), median: median(s.tsSteps), max: Math.max(...s.tsSteps), within15msOf505Grid: s.tsSteps.filter((d) => Math.abs(d - Math.round(d / 505) * 505) <= 15).length } : null,
      repeats: s.repeats, repeatGapMs: s.repeatGaps.length ? { min: Math.min(...s.repeatGaps), median: median(s.repeatGaps), max: Math.max(...s.repeatGaps) } : null, badBidOrder: s.badBidOrder, badAskOrder: s.badAskOrder, crossed: s.crossed, oneSided: s.oneSided, timestampRegress: s.tsRegress,
    });
  }
  log('ticker_trades', { ticker: other.ticker, trades: other.trades, firstTicker, firstTrade });
  log('control_frames', { count: control.length, first: control.slice(0, 6) });
}

// Two sockets that never subscribe: A sends nothing, B sends a protocol ping every 20 s. Both answer server pings through the ws library.
async function silence() {
  const run = async (name, pingEveryMs, holdMs) => {
    const { socket, openMs } = await open();
    const openedAt = Date.now();
    const pings = [];
    const pongs = [];
    let closed = null;
    let messages = 0;
    let sentAt = 0;
    socket.on('ping', () => pings.push(Date.now() - openedAt));
    socket.on('pong', () => pongs.push({ atMs: Date.now() - openedAt, rttMs: Date.now() - sentAt }));
    socket.on('message', () => messages++);
    socket.on('close', (code, reason) => { closed = { code, reason: reason.toString(), atMs: Date.now() - openedAt }; });
    const timer = pingEveryMs ? setInterval(() => { if (socket.readyState === WebSocket.OPEN) { sentAt = Date.now(); socket.ping(); } }, pingEveryMs) : null;
    while (Date.now() - openedAt < holdMs && !closed) await sleep(250);
    if (timer) clearInterval(timer);
    if (!closed) socket.close();
    log('silence', { socket: name, openMs, clientPingEveryMs: pingEveryMs, heldMs: Date.now() - openedAt, serverPingsAtMs: pings, pongs, messages, closedByServer: closed });
  };
  await Promise.all([run('A no traffic', 0, 100_000), run('B client ping', 20_000, 100_000)]);
}

async function deflate() {
  const { socket, openMs, extensions } = await open({ perMessageDeflate: true });
  log('deflate', { openMs, offered: 'permessage-deflate', negotiated: extensions });
  socket.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
if (mode === 'book') await book();
if (mode === 'silence') await silence();
if (mode === 'deflate') await deflate();
process.exit(0);
