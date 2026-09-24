// GroveX public WebSocket probe: gzip framing, depth snapshots and their cadence, level order, acks and errors, keepalive and silence, a batch of markets on one socket.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/grovex/ws-probe.mjs [book|req|batch|silence|deflate]
//   book     depth_step0 on four markets, step1 and step2 on BTC, ticker and trades, an unknown symbol and bad frames, for 75 s, with REST and Binance compared every 10 s.
//   req      the documented req and review events, bad frames and unknown symbols each on a fresh socket, and unsub. About 40 s.
//   batch    depth_step0 on 100 USDT markets on one socket for 60 s.
//   silence  five sockets that differ only in what the client subscribes, answers or pings, for up to 75 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Frames arrive as binary gzip, so every frame is gunzipped before parsing.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw frames, trimmed. Recorded in docs/profiles/grovex/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.grovex.io/kline-api/ws';
const API = 'https://openapi.grovex.io';
const BINANCE = 'https://api.binance.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const ppm = (a, b) => round(((a - b) / b) * 1e6, 0);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2_000) + '\n');
}

function decode(data, isBinary) {
  const t0 = performance.now();
  let text;
  let gzip = false;
  if (isBinary && data[0] === 0x1f && data[1] === 0x8b) {
    text = gunzipSync(data).toString('utf8');
    gzip = true;
  } else {
    text = data.toString('utf8');
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { text, json, gzip, isBinary, wireBytes: data.length, decodeUs: (performance.now() - t0) * 1000 };
}

function open(label, { deflate = false, answerPing = true, onFrame } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  const state = { ws, label, t0, frames: 0, pings: [], protocolPings: 0, closed: null, openMs: null, ext: null };
  ws.on('upgrade', (res) => {
    state.ext = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('open', () => {
    state.openMs = Date.now() - t0;
  });
  ws.on('ping', () => state.protocolPings++);
  ws.on('message', (data, isBinary) => {
    state.frames++;
    const f = decode(data, isBinary);
    if (f.json && f.json.ping !== undefined) {
      state.pings.push(Date.now() - t0);
      if (state.pings.length <= 2) capture(`${label}-ping.txt`, f.text);
      if (answerPing) ws.send(JSON.stringify({ pong: f.json.ping }));
      return;
    }
    onFrame?.(f, state);
  });
  ws.on('close', (code, reason) => {
    state.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 };
  });
  ws.on('error', (e) => {
    state.error = e.message;
  });
  state.ready = new Promise((resolve) => {
    ws.once('open', resolve);
    ws.once('close', resolve);
    ws.once('error', resolve);
  });
  return state;
}

const sub = (channel, extra = {}) => JSON.stringify({ event: 'sub', params: { channel, cb_id: channel.split('_')[1] ?? 'x', ...extra } });

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'grovex-ws-probe' } });
  return r.json();
}

function sideStats(levels, wantDescending) {
  const prices = levels.map((l) => l[0]);
  const ordered = prices.every((p, i) => i === 0 || (wantDescending ? p < prices[i - 1] : p > prices[i - 1]));
  return { n: levels.length, ordered, best: prices[0] ?? null };
}

async function book() {
  const markets = ['btcusdt', 'ethusdt', 'grxusdt', 'tigrinousdt'];
  const per = new Map(); // channel to stats
  const firstFrames = new Map();
  const others = [];
  const latest = new Map(); // channel to latest tick
  const trades = [];
  const s = open('book', {
    onFrame: (f, st) => {
      const j = f.json;
      const ch = j?.channel ?? '(none)';
      if (!per.has(ch)) per.set(ch, { frames: 0, arrivals: [], tsLag: [], sizes: [], same: 0, last: null, sides: null, incremental: 0, gzip: f.gzip, binary: f.isBinary });
      const p = per.get(ch);
      p.frames++;
      p.arrivals.push(Date.now());
      p.sizes.push(f.wireBytes);
      if (typeof j?.ts === 'number') p.tsLag.push(Date.now() - j.ts);
      if (!firstFrames.has(ch)) {
        firstFrames.set(ch, f.text);
        capture('book-first.txt', f.text);
      }
      const tick = j?.tick;
      // A trade printed strictly inside the book's own spread did not take a displayed level.
      if (ch === 'market_btcusdt_trade_ticker' && Array.isArray(tick?.data)) {
        const w = latest.get('market_btcusdt_depth_step0')?.tick;
        const bid = w?.buys?.[0]?.[0];
        const ask = w?.asks?.[0]?.[0];
        for (const t of tick.data) {
          const price = Number(t.price);
          const row = { price, side: t.side, vol: t.vol, bid, ask, inside: bid != null && ask != null && price > bid && price < ask };
          trades.push(row);
          getJson(`${BINANCE}/api/v3/ticker/bookTicker?symbol=BTCUSDT`)
            .then((bn) => {
              row.binanceBid = Number(bn.bidPrice);
              row.binanceAsk = Number(bn.askPrice);
            })
            .catch(() => {});
        }
      }
      if (tick && (tick.side || tick.price !== undefined)) p.incremental++;
      if (tick && (tick.asks || tick.buys || tick.bids)) {
        const key = JSON.stringify(tick);
        if (key === p.last) p.same++;
        p.last = key;
        p.sides = Object.keys(tick);
        latest.set(ch, { tick, at: Date.now(), ts: j.ts });
      }
      if (!j?.tick) {
        others.push({ atMs: Date.now() - st.t0, text: f.text.slice(0, 300) });
        capture('book-other.txt', f.text);
      }
    },
  });
  await s.ready;
  log('open', { openMs: s.openMs, ext: s.ext });
  const t0 = Date.now();
  for (const m of markets) s.ws.send(sub(`market_${m}_depth_step0`, { asks: 150, bids: 150 }));
  s.ws.send(sub('market_btcusdt_depth_step1', { asks: 150, bids: 150 }));
  s.ws.send(sub('market_btcusdt_depth_step2', { asks: 150, bids: 150 }));
  s.ws.send(sub('market_btcusdt_ticker'));
  s.ws.send(sub('market_btcusdt_trade_ticker'));
  s.ws.send(sub('market_nopeusdt_depth_step0', { asks: 150, bids: 150 }));
  s.ws.send(sub('market_BTCUSDT_depth_step0', { asks: 150, bids: 150 }));
  s.ws.send(sub('market_btcusdt_depth_step7', { asks: 150, bids: 150 }));
  s.ws.send(sub('market_ethusdt_depth_step0', { asks: 20, bids: 20 }));
  s.ws.send(JSON.stringify({ event: 'nope', params: { channel: 'market_btcusdt_ticker' } }));
  s.ws.send('not json');

  const compares = [];
  while (Date.now() - t0 < 75_000) {
    await sleep(10_000);
    const w = latest.get('market_btcusdt_depth_step0');
    try {
      const [tk, dept, bn] = await Promise.all([
        getJson(`${API}/open/api/get_ticker?symbol=btcusdt`),
        getJson(`${API}/open/api/market_dept?symbol=btcusdt&type=step0`),
        getJson(`${BINANCE}/api/v3/ticker/bookTicker?symbol=BTCUSDT`),
      ]);
      const wb = w?.tick?.buys?.[0]?.[0] ?? w?.tick?.bids?.[0]?.[0];
      const wa = w?.tick?.asks?.[0]?.[0];
      const bnMid = (Number(bn.bidPrice) + Number(bn.askPrice)) / 2;
      compares.push({
        wsBid: wb, wsAsk: wa, wsAgeMs: w ? Date.now() - w.at : null, tickerBuy: tk.data?.buy, tickerSell: tk.data?.sell,
        restBid: dept.data?.tick?.bids?.[0]?.[0], restAsk: dept.data?.tick?.asks?.[0]?.[0], binanceBid: Number(bn.bidPrice), binanceAsk: Number(bn.askPrice),
        wsSpreadPpm: ppm(wa, wb), wsBidVsBinancePpm: ppm(wb, bnMid), wsAskVsBinancePpm: ppm(wa, bnMid),
      });
    } catch (e) {
      compares.push({ error: e.message });
    }
  }
  for (const [ch, p] of per) {
    const gaps = p.arrivals.slice(1).map((t, i) => t - p.arrivals[i]);
    const tick = latest.get(ch)?.tick;
    const bids = tick?.buys ?? tick?.bids ?? [];
    log('channel', {
      ch, frames: p.frames, gzip: p.gzip, binary: p.binary, sides: p.sides, incremental: p.incremental, identicalRepeats: p.same,
      gapMs: gaps.length ? { min: Math.min(...gaps), median: quantile(gaps, 0.5), p90: quantile(gaps, 0.9), max: Math.max(...gaps) } : null,
      tsLagMs: p.tsLag.length ? { min: Math.min(...p.tsLag), median: quantile(p.tsLag, 0.5), max: Math.max(...p.tsLag) } : null,
      wireBytes: { median: quantile(p.sizes, 0.5), max: Math.max(...p.sizes) },
      bids: tick ? sideStats(bids, true) : null, asks: tick ? sideStats(tick.asks ?? [], false) : null,
    });
  }
  log('nonTick', { count: others.length, first: others.slice(0, 8) });
  log('trades', { count: trades.length, insideSpread: trades.filter((t) => t.inside).length, rows: trades.slice(0, 8) });
  log('compare', { rows: compares });
  log('session', { frames: s.frames, serverPings: s.pings.length, pingAtMs: s.pings.slice(0, 5), protocolPings: s.protocolPings, closed: s.closed });
  s.ws.close();
}

// Each request gets its own socket, because one malformed request closes the socket it was sent on.
async function oneShot(name, frames, waitMs = 3_000) {
  const got = [];
  const s = open(`req-${name}`, { onFrame: (f) => got.push({ at: Date.now(), text: f.text, gzip: f.gzip }) });
  await s.ready;
  const t0 = Date.now();
  for (const f of frames) s.ws.send(typeof f === 'string' ? f : JSON.stringify(f));
  await sleep(waitMs);
  for (const f of got) capture('req-frames.txt', `${name}: ${f.text}`);
  log('req', { name, frames: got.length, closed: s.closed, show: got.slice(0, 3).map((f) => ({ atMs: f.at - t0, gzip: f.gzip, text: f.text.slice(0, 240) })) });
  s.ws.terminate();
  return got;
}

async function req() {
  await oneShot('trade history', [{ event: 'req', params: { channel: 'market_btcusdt_trade_ticker', cb_id: 'btcusdt', top: 5 } }]);
  await oneShot('kline history', [{ event: 'req', params: { channel: 'market_btcusdt_kline_1min', cb_id: 'btcusdt' } }]);
  await oneShot('kline history with empty endIdx', [{ event: 'req', params: { channel: 'market_btcusdt_kline_1min', cb_id: 'btcusdt', endIdx: '', pageSize: 3 } }]);
  await oneShot('review', [{ event: 'req', params: { channel: 'review' } }]);
  await oneShot('depth as req', [{ event: 'req', params: { channel: 'market_btcusdt_depth_step0', cb_id: 'btcusdt' } }]);
  for (const n of [5, 20, 150]) {
    const got = await oneShot(`depth asks and bids ${n}`, [sub('market_btcusdt_depth_step0', { asks: n, bids: n })], 2_000);
    const tick = got.map((f) => JSON.parse(f.text)).find((j) => j.tick)?.tick;
    log('depthParam', { requested: n, snapshots: got.length, asks: tick?.asks?.length ?? null, buys: tick?.buys?.length ?? null });
  }
  await oneShot('not json', ['not json']);
  await oneShot('unknown symbol', [sub('market_nopeusdt_depth_step0', { asks: 150, bids: 150 })]);
  await oneShot('unknown event', [{ event: 'nope', params: { channel: 'market_btcusdt_ticker' } }]);

  // Unsubscribe: count frames on the channel after the unsub is sent.
  const frames = [];
  const s = open('req-unsub', { onFrame: (f) => frames.push({ at: Date.now(), text: f.text }) });
  await s.ready;
  s.ws.send(sub('market_ethusdt_depth_step0', { asks: 150, bids: 150 }));
  await sleep(1_500);
  s.ws.send(JSON.stringify({ event: 'unsub', params: { channel: 'market_ethusdt_depth_step0', cb_id: 'ethusdt' } }));
  const unsubAt = Date.now();
  await sleep(14_000);
  log('unsub', { framesBefore: frames.filter((f) => f.at <= unsubAt).length, framesAfter: frames.filter((f) => f.at > unsubAt).length, after: frames.filter((f) => f.at > unsubAt).map((f) => f.text.slice(0, 120)).slice(0, 3), closed: s.closed });
  s.ws.terminate();
}

async function batch() {
  const syms = (await getJson(`${API}/open/api/common/symbols`)).data.filter((m) => m.count_coin === 'USDT').map((m) => m.symbol).slice(0, 100);
  const per = new Map();
  let bytes = 0;
  let decodeUs = [];
  const perSecond = new Map();
  let first = null;
  let full = 0;
  let incremental = 0; // frames that are not a whole asks and buys snapshot
  const s = open('batch', {
    onFrame: (f) => {
      bytes += f.wireBytes;
      decodeUs.push(f.decodeUs);
      const sec = Math.floor(Date.now() / 1000);
      perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
      const ch = f.json?.channel;
      if (!ch) return;
      if (first == null) first = Date.now();
      per.set(ch, (per.get(ch) ?? 0) + 1);
      const tick = f.json.tick;
      if (tick && Array.isArray(tick.asks) && Array.isArray(tick.buys)) full++;
      else incremental++;
    },
  });
  await s.ready;
  const tSub = Date.now();
  for (const m of syms) s.ws.send(sub(`market_${m}_depth_step0`, { asks: 150, bids: 150 }));
  await sleep(60_000);
  const counts = [...per.values()];
  const rates = [...perSecond.values()];
  log('batch', {
    subscribed: syms.length, channelsDelivering: per.size, firstFrameAfterSubMs: first ? first - tSub : null, frames: counts.reduce((a, b) => a + b, 0),
    framesPerChannel: { min: Math.min(...counts), median: quantile(counts, 0.5), max: Math.max(...counts) }, fullSnapshots: full, otherFrames: incremental,
    framesPerSecond: { median: quantile(rates, 0.5), max: Math.max(...rates) }, wireKBps: round(bytes / 60 / 1024, 1),
    gunzipAndParseUs: { median: round(quantile(decodeUs, 0.5), 0), p90: round(quantile(decodeUs, 0.9), 0) },
    silent: syms.filter((m) => !per.has(`market_${m}_depth_step0`)).slice(0, 20), serverPings: s.pings.length, closed: s.closed,
  });
  s.ws.close();
}

async function silence() {
  const replies = { appPing: [], pong: 0 };
  const a = open('silence-nosub-noanswer', { answerPing: false });
  const b = open('silence-sub-noanswer', { answerPing: false });
  const c = open('silence-sub-answer', { answerPing: true });
  const d = open('silence-nosub-protocolping');
  const e = open('silence-nosub-appping', { onFrame: (f) => replies.appPing.push(f.text.slice(0, 120)) });
  await Promise.all([a.ready, b.ready, c.ready, d.ready, e.ready]);
  d.ws.on('pong', () => replies.pong++);
  b.ws.send(sub('market_btcusdt_depth_step0', { asks: 150, bids: 150 }));
  c.ws.send(sub('market_btcusdt_depth_step0', { asks: 150, bids: 150 }));
  const t0 = Date.now();
  let lastPing = 0;
  while (Date.now() - t0 < 75_000 && [a, b, c, d, e].some((s) => !s.closed)) {
    if (Date.now() - lastPing >= 20_000) {
      lastPing = Date.now();
      if (!d.closed) d.ws.ping();
      if (!e.closed) e.ws.send(JSON.stringify({ ping: Date.now() }));
    }
    await sleep(1_000);
  }
  for (const s of [a, b, c, d, e]) {
    log('silence', { label: s.label, openMs: s.openMs, frames: s.frames, serverPings: s.pings.length, firstPingMs: s.pings[0] ?? null, protocolPings: s.protocolPings, closed: s.closed ?? 'open at 75 s' });
    s.ws.terminate();
  }
  log('clientPings', { protocolPongs: replies.pong, appPingReplies: replies.appPing.length, firstReply: replies.appPing[0] ?? null });
}

async function deflate() {
  const s = open('deflate', { deflate: true });
  await s.ready;
  log('deflate', { offered: true, negotiated: s.ext, openMs: s.openMs });
  s.ws.close();
  await sleep(500);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, req, batch, silence, deflate };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('done', { at: new Date().toISOString() });
setTimeout(() => process.exit(0), 500);
