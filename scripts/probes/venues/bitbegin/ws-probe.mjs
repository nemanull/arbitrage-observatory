// Bitbegin WebSocket probe: the Pusher protocol socket the web client uses, its public book and trade channels, keepalive, silence and compression.
// Public, unauthenticated, read-only. Only public Pusher channels are subscribed, with no auth field. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitbegin/ws-probe.mjs [book|silence|deflate]
//   book     one socket, the dashboard and trade-info channels of five pairs plus an unknown pair, for 90 s. About 92 s.
//   silence  two sockets for up to 120 s: one that subscribes nothing and sends nothing, one that subscribes a pair and answers server pings.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/bitbegin/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

// Host, key and query are what the web client's bundle passes to pusher-js 7.0.6 through Laravel Echo.
const URL_ = 'wss://api.bitbegin.io/app/test?protocol=7&client=js&version=7.0.6&flash=false';
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Coin ids from the landing page data: USDT is 2, the traded coin is the second id.
const PAIRS = { 'BTC/USDT': 1, 'ETH/USDT': 13, 'SHIB/USDT': 6, 'USDC/USDT': 3, 'LTC/USDT': 11 };
const UNKNOWN_ID = 999;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(URL_, { perMessageDeflate: opts.deflate ?? false, headers: { Origin: 'https://www.bitbegin.io' } });
  ws.t0 = t0;
  ws.on('upgrade', (res) => {
    ws.upgradeHeaders = res.headers;
  });
  return ws;
}

function parse(raw) {
  const f = JSON.parse(raw.toString('utf8'));
  let data = f.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {}
  }
  return { f, data };
}

function levelSummary(levels) {
  if (!Array.isArray(levels)) return { type: typeof levels };
  const prices = levels.map((l) => Number(l.price));
  const desc = prices.every((p, i) => i === 0 || p <= prices[i - 1]);
  const asc = prices.every((p, i) => i === 0 || p >= prices[i - 1]);
  return {
    n: levels.length,
    keys: levels[0] ? Object.keys(levels[0]).join(',') : '',
    first: levels[0] ?? null,
    last: levels.at(-1) ?? null,
    order: desc && asc ? 'flat' : desc ? 'descending' : asc ? 'ascending' : 'unordered',
  };
}

async function book() {
  const ws = open();
  const stats = new Map(); // channel|event to { n, bytes, firstAt, lastAt, gaps }
  const lastBook = new Map(); // channel to { buy, sell } level arrays
  const seen = new Set();
  const pingSent = [];
  let established;
  let controlLogged = 0;

  let subscribed = false;
  const subscribeAll = () => {
    if (subscribed || ws.readyState !== ws.OPEN) return;
    subscribed = true;
    const channels = [];
    for (const id of [...Object.values(PAIRS), UNKNOWN_ID]) channels.push(`dashboard-2-${id}`, `trade-info-2-${id}`);
    channels.push('bitbegin_public_chanel');
    for (const channel of channels) ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel } }));
    ws.send('not json');
    ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: 'dashboard-2-1' } }));
    log('subscribed', { channels: channels.length, sentAtMs: Date.now() - ws.t0, afterEstablished: established !== undefined });
  };

  ws.on('open', () => {
    log('open', { ms: Date.now() - ws.t0, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null });
    // A socket that never gets connection_established still receives the subscribes after 2 s, to record what the server does with them.
    setTimeout(subscribeAll, 2_000);
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString(), atMs: Date.now() - ws.t0 }));
  ws.on('error', (e) => log('error', { message: e.message }));
  ws.on('ping', () => log('protocol_ping', { atMs: Date.now() - ws.t0 }));

  ws.on('message', (raw) => {
    const now = Date.now();
    const { f, data } = parse(raw);
    const key = `${f.channel ?? '-'}|${f.event}`;
    const s = stats.get(key) ?? { n: 0, bytes: 0, firstAt: now - ws.t0, lastAt: 0, maxGap: 0 };
    if (s.n > 0) s.maxGap = Math.max(s.maxGap, now - ws.t0 - s.lastAt);
    s.n++;
    s.bytes += raw.length;
    s.lastAt = now - ws.t0;
    stats.set(key, s);
    if (!seen.has(key) || s.n === 3) {
      seen.add(key);
      capture('frames.jsonl', raw.toString('utf8'));
    }

    if (f.event === 'pusher:connection_established') {
      established = now;
      log('established', { ms: now - ws.t0, data });
      subscribeAll();
      return;
    }
    if (f.event === 'pusher:pong') {
      const sent = pingSent.shift();
      log('pong', { rttMs: sent ? now - sent : null, raw: raw.toString('utf8').slice(0, 120) });
      return;
    }
    if (f.event === 'pusher:ping') {
      log('server_ping', { atMs: now - ws.t0, raw: raw.toString('utf8').slice(0, 120) });
      ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      return;
    }
    if (f.event === 'pusher:error' || f.event === 'pusher_internal:subscription_succeeded' || f.event?.startsWith('pusher')) {
      if (controlLogged++ < 20) log('control', { raw: raw.toString('utf8').slice(0, 300), atMs: now - ws.t0 });
      return;
    }
    if (f.event === 'order_place') {
      const o = data?.orders ?? {};
      const entry = lastBook.get(f.channel) ?? {};
      if (o.order_type === 'buy' || o.order_type === 'sell') entry[o.order_type] = o.orders;
      if (o.order_type === 'buy_sell') {
        entry.buy = o.buy_orders;
        entry.sell = o.sell_orders;
      }
      lastBook.set(f.channel, entry);
      if (s.n <= 2) {
        log('order_place', {
          channel: f.channel,
          bytes: raw.length,
          dataKeys: Object.keys(data ?? {}).join(','),
          ordersKeys: Object.keys(o).join(','),
          order_type: o.order_type,
          orders: o.orders ? levelSummary(o.orders) : undefined,
          buy: o.buy_orders ? levelSummary(o.buy_orders) : undefined,
          sell: o.sell_orders ? levelSummary(o.sell_orders) : undefined,
        });
      }
      return;
    }
    if (s.n <= 2) {
      log('other_event', { channel: f.channel, event: f.event, bytes: raw.length, dataKeys: data && typeof data === 'object' ? Object.keys(data).join(',') : typeof data, sample: raw.toString('utf8').slice(0, 400) });
    }
  });

  const pinger = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    pingSent.push(Date.now());
    ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
  }, 30_000);

  await sleep(90_000);
  clearInterval(pinger);

  const runS = (Date.now() - ws.t0) / 1000;
  for (const [key, s] of [...stats.entries()].sort()) {
    log('stat', { key, n: s.n, perSec: +(s.n / runS).toFixed(2), avgBytes: Math.round(s.bytes / s.n), firstAtMs: s.firstAt, maxGapMs: s.maxGap });
  }
  for (const [channel, b] of lastBook) {
    const bids = (b.buy ?? []).map((l) => Number(l.price));
    const asks = (b.sell ?? []).map((l) => Number(l.price));
    log('last_book', {
      channel,
      bidLevels: bids.length,
      askLevels: asks.length,
      bestBid: bids.length ? Math.max(...bids) : null,
      bestAsk: asks.length ? Math.min(...asks) : null,
      bidOrder: levelSummary(b.buy ?? []).order,
      askOrder: levelSummary(b.sell ?? []).order,
    });
  }
  ws.close(1000);
  await sleep(500);
}

async function silence() {
  const results = [];
  const mk = (name, subscribe, answerPings) => {
    const ws = open();
    const r = { name, frames: 0, serverPings: 0, closeAtMs: null, code: null, protocolPings: 0 };
    results.push(r);
    ws.on('ping', () => r.protocolPings++);
    ws.on('message', (raw) => {
      r.frames++;
      const { f } = parse(raw);
      if (f.event === 'pusher:connection_established') {
        r.established = parse(raw).data;
        if (subscribe) ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: 'dashboard-2-1' } }));
      }
      if (f.event === 'pusher:ping') {
        r.serverPings++;
        r.lastPingAtMs = Date.now() - ws.t0;
        if (answerPings) ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      }
    });
    ws.on('close', (code) => {
      r.closeAtMs = Date.now() - ws.t0;
      r.code = code;
      log('close', { name, code, atMs: r.closeAtMs });
    });
    ws.on('error', (e) => log('error', { name, message: e.message }));
    return ws;
  };
  const a = mk('mute_unsubscribed', false, false);
  const b = mk('subscribed_answers_pings', true, true);
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000 && (a.readyState < 2 || b.readyState < 2)) await sleep(1_000);
  for (const r of results) log('silence', r);
  for (const ws of [a, b]) if (ws.readyState === ws.OPEN) ws.close(1000);
  await sleep(500);
}

async function deflate() {
  const ws = open({ deflate: true });
  await new Promise((res) => {
    ws.on('open', () => {
      log('deflate', { offered: true, negotiated: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, extensions: Object.keys(ws.extensions ?? {}) });
      res();
    });
    ws.on('error', (e) => {
      log('error', { message: e.message });
      res();
    });
  });
  ws.close(1000);
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
