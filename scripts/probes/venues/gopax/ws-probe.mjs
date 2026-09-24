// GoPax WebSocket probe: unauthenticated handshake, order book snapshot and deltas, entry id rules, level order, a REST book compare, tickers channel, primus ping, silence, the 50 pair cap, errors and deflate.
// Public, unauthenticated, read-only. No API key is sent, although the documentation's examples sign one. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/venues/gopax/ws-probe.mjs [book|tickers|batch|silence|deflate]
//   book     SubscribeToOrderBook on six pairs for 75 s with pongs, a second socket with limit 20, error cases, then a REST level 2 compare. About 85 s.
//   tickers  SubscribeToTickers and SubscribeToTradingPair on XRP-KRW for 30 s: response size, TickerEvent cadence, trade events. About 32 s.
//   batch    SubscribeToOrderBook on the 50 most recently traded pairs plus a 51st on one socket for 60 s. About 62 s.
//   silence  three sockets for up to 100 s: subscribed without pongs, unsubscribed with pongs, unsubscribed without pongs.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/gopax/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://wsapi.gopax.co.kr';
const API = 'https://api.gopax.co.kr';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Opens a socket and records handshake status, open time, pings, close code and every frame to the handler.
function open(name, { pong = true, deflate = false, onFrame } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  const st = { name, t0, frames: 0, bytes: 0, pings: [], closed: null, openMs: null, ws };
  ws.on('upgrade', (res) => { st.upgrade = { status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null }; });
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => log('unexpected_response', { name, status: res.statusCode, body: body.slice(0, 300) }));
  });
  ws.on('open', () => { st.openMs = Date.now() - t0; });
  ws.on('ping', () => { st.protocolPings = (st.protocolPings ?? 0) + 1; });
  ws.on('message', (data, isBinary) => {
    const text = data.toString();
    st.frames++;
    st.bytes += text.length;
    if (isBinary) st.binary = (st.binary ?? 0) + 1;
    capture(`${name}.jsonl`, `${Date.now()} ${text}`);
    if (text.startsWith('"primus::ping::')) {
      st.pings.push(Date.now() - t0);
      if (pong) ws.send(text.replace('primus::ping::', 'primus::pong::'));
      return;
    }
    let msg;
    try { msg = JSON.parse(text); } catch { msg = { unparsed: text.slice(0, 200) }; }
    onFrame?.(msg, text, Date.now());
  });
  ws.on('close', (code, reason) => { st.closed = { code, reason: reason.toString(), at_ms: Date.now() - t0 }; });
  ws.on('error', (e) => { st.error = e.message; });
  st.ready = new Promise((resolve) => { ws.once('open', resolve); ws.once('close', resolve); ws.once('error', resolve); });
  return st;
}

const summary = (st) => ({ name: st.name, upgrade: st.upgrade, open_ms: st.openMs, frames: st.frames, bytes: st.bytes, binary: st.binary ?? 0, protocol_pings: st.protocolPings ?? 0, primus_pings_at_ms: st.pings, closed: st.closed, error: st.error });

async function restBook(pair) {
  const r = await fetch(`${API}/trading-pairs/${pair}/book?level=2`);
  return r.json();
}

// Book kept by price from the snapshot and each delta, using the documented "order by updatedAt, entryId" rule.
function newBook() { return { bid: new Map(), ask: new Map() }; }
function applyEntries(book, side, entries, stats) {
  for (const e of entries) {
    const old = book[side].get(e.price);
    if (old && (e.updatedAt < old.updatedAt || (e.updatedAt === old.updatedAt && e.entryId <= old.entryId))) stats.stale++;
    if (e.volume === 0) book[side].delete(e.price);
    else book[side].set(e.price, e);
  }
}

async function book() {
  const pairs = ['BTC-KRW', 'USDT-KRW', 'XRP-KRW', 'ETH-KRW', 'ETH-USDC', 'SAND-KRW'];
  const per = Object.fromEntries(pairs.map((p) => [p, { snap: null, deltas: 0, emptyDeltas: 0, entries: 0, zero: 0, stale: 0, beforeSnap: 0, idsBelowSnapMax: 0, idGapsWithinFrame: 0, entryIdOrderInFrame: 0, bidOrder: [], askOrder: [], book: newBook(), lastId: 0, idJumps: [], leMax: [], firstDeltaAfterSnapMs: null, framesPerEntryCount: {} }]));
  const firstFrames = {};
  const others = [];
  let sentAt = 0;
  const main = open('book', {
    onFrame: (msg, text, now) => {
      if (!firstFrames[msg.n]) { firstFrames[msg.n] = text.slice(0, 700); }
      const o = msg.o ?? {};
      const p = per[o.tradingPairName];
      if (!p) { others.push(text.slice(0, 300)); return; }
      if (msg.n === 'SubscribeToOrderBook') {
        const ids = [...o.ask, ...o.bid].map((e) => e.entryId);
        p.snap = { at_ms_after_send: now - sentAt, asks: o.ask.length, bids: o.bid.length, maxEntryId: o.maxEntryId, maxIdInLevels: Math.max(...ids), keys: Object.keys(o), i: msg.i,
          ask_asc: o.ask.every((e, k) => k === 0 || e.price > o.ask[k - 1].price), bid_desc: o.bid.every((e, k) => k === 0 || e.price < o.bid[k - 1].price),
          bid_asc: o.bid.every((e, k) => k === 0 || e.price > o.bid[k - 1].price), best_bid: Math.max(...o.bid.map((e) => e.price)), best_ask: Math.min(...o.ask.map((e) => e.price)),
          oldest_days: Math.round((Date.now() / 1000 - Math.min(...[...o.ask, ...o.bid].map((e) => e.updatedAt))) / 86400), types: { price: typeof o.ask[0]?.price, volume: typeof o.ask[0]?.volume, updatedAt: typeof o.ask[0]?.updatedAt } };
        if (!p.snapTrim) p.snapTrim = JSON.stringify({ ...msg, o: { ...o, ask: o.ask.slice(0, 2), bid: o.bid.slice(0, 2) } });
        p.snapLevels = new Map([...o.ask.map((e) => [`ask:${e.price}`, e]), ...o.bid.map((e) => [`bid:${e.price}`, e])]);
        p.book = newBook();
        applyEntries(p.book, 'ask', o.ask, p);
        applyEntries(p.book, 'bid', o.bid, p);
        p.lastId = o.maxEntryId;
        return;
      }
      if (msg.n === 'OrderBookEvent') {
        p.deltas++;
        if (!p.snap) p.beforeSnap++;
        if (p.snap && p.firstDeltaAfterSnapMs === null) p.firstDeltaAfterSnapMs = now - sentAt;
        const all = [...o.ask, ...o.bid];
        p.framesPerEntryCount[all.length] = (p.framesPerEntryCount[all.length] ?? 0) + 1;
        if (all.length === 0) p.emptyDeltas++;
        p.entries += all.length;
        p.zero += all.filter((e) => e.volume === 0).length;
        const ids = all.map((e) => e.entryId).sort((a, b) => a - b);
        for (let k = 1; k < ids.length; k++) if (ids[k] !== ids[k - 1] + 1) p.idGapsWithinFrame++;
        if (p.snap && ids.length && ids[0] <= p.snap.maxEntryId) p.idsBelowSnapMax++;
        if (p.snap) {
          for (const [side, list] of [['ask', o.ask], ['bid', o.bid]]) {
            for (const e of list) if (e.entryId <= p.snap.maxEntryId) p.leMax.push({ side, entry: e, snapshot_level: p.snapLevels.get(`${side}:${e.price}`) ?? null });
          }
        }
        if (ids.length && p.snap) { p.idJumps.push(ids[0] - p.lastId); p.lastId = ids[ids.length - 1]; }
        if (o.bid.length > 1) p.bidOrder.push(o.bid.every((e, k) => k === 0 || e.price < o.bid[k - 1].price) ? 'desc' : o.bid.every((e, k) => k === 0 || e.price > o.bid[k - 1].price) ? 'asc' : 'mixed');
        if (o.ask.length > 1) p.askOrder.push(o.ask.every((e, k) => k === 0 || e.price > o.ask[k - 1].price) ? 'asc' : o.ask.every((e, k) => k === 0 || e.price < o.ask[k - 1].price) ? 'desc' : 'mixed');
        if (p.snap) { applyEntries(p.book, 'ask', o.ask, p); applyEntries(p.book, 'bid', o.bid, p); }
        return;
      }
      others.push(text.slice(0, 300));
    },
  });
  await main.ready;
  sentAt = Date.now();
  for (const pair of pairs) main.ws.send(JSON.stringify({ i: pair, n: 'SubscribeToOrderBook', o: { tradingPairName: pair } }));

  // A second socket: limit 20, limit 10, an unknown pair, a duplicate, a bad name, a non JSON text, an unknown request name, and the trading pair channel.
  const errFrames = [];
  const second = open('errors', { onFrame: (msg, text, now) => errFrames.push({ ms: now - second.t0, n: msg.n, i: msg.i, text: text.slice(0, 260), size: text.length }) });
  await second.ready;
  const sends = [
    { i: 1, n: 'SubscribeToOrderBook', o: { tradingPairName: 'XRP-KRW', limit: 20 } },
    { i: 2, n: 'SubscribeToOrderBook', o: { tradingPairName: 'ETH-KRW', limit: 10 } },
    { i: 3, n: 'SubscribeToOrderBook', o: { tradingPairName: 'NOPE-KRW' } },
    { i: 4, n: 'SubscribeToOrderBook', o: { tradingPairName: 'XRP-KRW', limit: 20 } },
    { i: 5, n: 'SubscribeToOrderBook', o: { tradingPairName: 'ZEC-KRW' } },
    { i: 6, n: 'SubscribeToNothing', o: {} },
    { i: 7, n: 'SubscribeToTradingPair', o: { tradingPairName: 'USDT-KRW' } },
    { i: 8, n: 'SubscribeToOrderBook', o: { tradingPairName: 'btc-krw' } },
  ];
  for (const f of sends) { second.ws.send(JSON.stringify(f)); await sleep(300); }
  second.ws.send('not json');
  await sleep(30_000);
  const errSummary = {};
  for (const f of errFrames) {
    const k = `${f.i ?? '-'}:${f.n}`;
    if (!errSummary[k]) errSummary[k] = { count: 0, first_ms: f.ms, first: f.text, first_size: f.size };
    errSummary[k].count++;
  }
  log('error_socket', { ...summary(second), replies: errSummary });
  second.ws.close();

  await sleep(45_000);
  const end = Date.now();
  log('book_socket', summary(main));
  for (const [pair, p] of Object.entries(per)) {
    const bids = [...p.book.bid.keys()].sort((a, b) => b - a);
    const asks = [...p.book.ask.keys()].sort((a, b) => a - b);
    log('book_pair', {
      pair, snap: p.snap, deltas: p.deltas, empty_deltas: p.emptyDeltas, entries: p.entries, zero_volume_entries: p.zero, entries_per_delta: p.framesPerEntryCount,
      delta_before_snapshot: p.beforeSnap, first_delta_after_send_ms: p.firstDeltaAfterSnapMs, first_id_not_above_snapshot_max: p.idsBelowSnapMax, id_gaps_within_frame: p.idGapsWithinFrame,
      first_id_minus_last_id: { min: Math.min(...p.idJumps), median: median(p.idJumps), max: Math.max(...p.idJumps), count: p.idJumps.length, equal_1: p.idJumps.filter((x) => x === 1).length },
      entries_at_or_below_snapshot_max: p.leMax.slice(0, 5), stale_entries: p.stale, delta_bid_order: countOf(p.bidOrder), delta_ask_order: countOf(p.askOrder),
      kept: { bids: bids.length, asks: asks.length, best_bid: bids[0], best_ask: asks[0], crossed: bids[0] >= asks[0] },
    });
  }
  log('book_other_frames', { count: others.length, first: others.slice(0, 3) });
  log('snapshot_trimmed', { BTC: per['BTC-KRW'].snapTrim, SAND: per['SAND-KRW'].snapTrim });
  log('first_frames', firstFrames);

  // REST compare at level 2, one call per 1.1 s.
  for (const pair of ['BTC-KRW', 'USDT-KRW', 'XRP-KRW', 'ETH-KRW']) {
    const r = await restBook(pair);
    const p = per[pair];
    const bids = [...p.book.bid.values()].sort((a, b) => b.price - a.price).slice(0, 20);
    const asks = [...p.book.ask.values()].sort((a, b) => a.price - b.price).slice(0, 20);
    const rb = new Map(r.bid.map((e) => [e[1], e[2]]));
    const ra = new Map(r.ask.map((e) => [e[1], e[2]]));
    log('rest_compare_top20', { pair, ms_after_socket_read: Date.now() - end, bid_price_match: bids.filter((e) => rb.has(e.price)).length, bid_size_match: bids.filter((e) => rb.get(e.price) === e.volume).length, ask_price_match: asks.filter((e) => ra.has(e.price)).length, ask_size_match: asks.filter((e) => ra.get(e.price) === e.volume).length, ws_best: [bids[0]?.price, asks[0]?.price], rest_best: [r.bid[0]?.[1], r.ask[0]?.[1]] });
    await sleep(1100);
  }
  main.ws.close();
}

function countOf(a) { return a.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {}); }

async function tickers() {
  const events = [];
  const pairFrames = {};
  let resp = null;
  let tickerSample = null;
  const st = open('tickers', {
    onFrame: (msg, text, now) => {
      if (msg.n === 'SubscribeToTickers') resp = { ms: now - st.t0, size: text.length, rows: msg.o?.data?.length, keys: msg.o?.data?.[0] && Object.keys(msg.o.data[0]), i: msg.i };
      else if (msg.n === 'TickerEvent') {
        const k = Object.keys(msg.o ?? {});
        events.push({ ms: now - st.t0, pairs: k.length, size: text.length, sample: k.slice(0, 4) });
        if (!tickerSample) tickerSample = JSON.stringify({ ...msg, o: { [k[0]]: msg.o[k[0]] } });
      } else {
        const key = msg.n ?? 'unparsed';
        pairFrames[key] ??= { count: 0, first: key === 'SubscribeToTradingPair' ? `${text.slice(0, 160)} … ${text.length} bytes` : text.slice(0, 400) };
        pairFrames[key].count++;
      }
    },
  });
  await st.ready;
  st.ws.send(JSON.stringify({ i: 't', n: 'SubscribeToTickers', o: {} }));
  st.ws.send(JSON.stringify({ i: 'p', n: 'SubscribeToTradingPair', o: { tradingPairName: 'XRP-KRW' } }));
  await sleep(30_000);
  const gaps = events.slice(1).map((e, k) => e.ms - events[k].ms);
  log('tickers_socket', { ...summary(st), response: resp, events: events.length, gap_ms: { min: Math.min(...gaps), median: median(gaps), max: Math.max(...gaps) }, pairs_per_event: countOf(events.map((e) => e.pairs)), first_events: events.slice(0, 3), ticker_sample: tickerSample, trading_pair_frames: pairFrames });
  st.ws.close();
}

async function batch() {
  const r = await fetch(`${API}/tickers`);
  const tk = await r.json();
  const cat = new Set((await (await fetch(`${API}/trading-pairs`)).json()).map((x) => x.name));
  const listed = tk.filter((x) => cat.has(x.tradingPairName)).sort((a, b) => b.lastTraded - a.lastTraded).map((x) => x.tradingPairName);
  const chosen = listed.slice(0, 51);
  const snaps = new Map();
  const deltas = new Map();
  const replies = [];
  let sentAt = 0;
  const st = open('batch', {
    onFrame: (msg, text, now) => {
      const pair = msg.o?.tradingPairName;
      if (msg.n === 'SubscribeToOrderBook' && pair) snaps.set(pair, now - sentAt);
      else if (msg.n === 'OrderBookEvent' && pair) deltas.set(pair, (deltas.get(pair) ?? 0) + 1);
      else replies.push(text.slice(0, 300));
    },
  });
  await st.ready;
  sentAt = Date.now();
  for (const pair of chosen) st.ws.send(JSON.stringify({ i: pair, n: 'SubscribeToOrderBook', o: { tradingPairName: pair } }));
  await sleep(60_000);
  const snapMs = [...snaps.values()];
  const totalDeltas = [...deltas.values()].reduce((a, b) => a + b, 0);
  log('batch_socket', {
    ...summary(st), subscribed: chosen.length, snapshots: snaps.size, snapshot_ms: { min: Math.min(...snapMs), median: median(snapMs), max: Math.max(...snapMs) },
    missing_snapshot: chosen.filter((p) => !snaps.has(p)), pairs_with_delta: deltas.size, deltas: totalDeltas, deltas_per_s: +(totalDeltas / 60).toFixed(2),
    top_delta_pairs: [...deltas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6), fifty_first: chosen[50], replies: replies.slice(0, 5),
  });
  st.ws.close();
}

async function silence() {
  const sockets = [
    open('sub_no_pong', { pong: false }),
    open('nosub_pong', { pong: true }),
    open('nosub_no_pong', { pong: false }),
  ];
  await Promise.all(sockets.map((s) => s.ready));
  sockets[0].ws.send(JSON.stringify({ n: 'SubscribeToOrderBook', o: { tradingPairName: 'XRP-KRW' } }));
  const until = Date.now() + 100_000;
  while (Date.now() < until && sockets.some((s) => !s.closed)) await sleep(500);
  for (const s of sockets) { log('silence_socket', summary(s)); if (!s.closed) s.ws.close(); }
}

async function deflate() {
  const st = open('deflate', { deflate: true });
  await st.ready;
  await sleep(1500);
  log('deflate', { upgrade: st.upgrade, open_ms: st.openMs, frames: st.frames });
  st.ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, tickers, batch, silence, deflate };
const started = new Date().toISOString();
await modes[mode]();
log('done', { mode, started, ended: new Date().toISOString() });
await sleep(300);
process.exit(0);
