// BitBNS public stream probe: Socket.IO 4 over a raw WebSocket, the spot order book and ticker sockets, the web app's futures rooms and index socket, keepalive, silence, errors.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitbns/ws-probe.mjs [book|all|futures|index|silence|errors]
//   book     order book sockets for BTC, ETH, SOL, XRP, DOGE, LTC and USDT on the INR market and BTC on the USDT market, plus the INR ticker socket, for 45 s.
//            Counts frames per type, checks level order, and compares the socket book with the REST book. About 50 s.
//   all      coin=ALL on the INR and USDT markets beside per-coin sockets for eight INR coins, for 45 s.
//            Counts the whole-market snapshot, the per-coin updates, their list lengths and level shapes, and whether a per-coin socket also pushed each update.
//   futures  the web app's futures socket on socket.bitbns.com: one socket walks all 20 instrument rooms, one holds BTC, one joins no room, for 40 s.
//   index    the web app's futures index socket, event index_price_all for every coin, for 30 s.
//   silence  on the spot and the futures host, three sockets each that differ only in the Socket.IO connect and whether they answer the server ping, for 60 s.
//   errors   unknown coin, no coin, ALL, lower case, EIO=3, unknown room, unknown event, text that is not a packet, and a permessage-deflate offer on both hosts. About 25 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/bitbns/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

const spotUrl = (market, query, eio = 4) =>
  `wss://ws${market}mv2.bitbns.com/socket.io/?EIO=${eio}&transport=websocket${query ? '&' + query : ''}`;
const FUTURES_URL = 'wss://socket.bitbns.com/bnsFuturesSocket/?EIO=4&transport=websocket';
const INDEX_URL = 'wss://socket.bitbns.com/bnsIndexSocket/?coin=all&EIO=4&transport=websocket';

// Opens one Socket.IO 4 client over a raw socket and records every packet.
function open(name, url, { connect = true, pong = true, deflate = false, onEvent } = {}) {
  const t0 = Date.now();
  const s = { name, url, t0, frames: 0, bytes: 0, pings: 0, events: {}, packets: {}, closed: null, openMs: null, handshake: null, connectAck: null, errors: [], ext: null };
  const ws = new WebSocket(url, { perMessageDeflate: deflate, handshakeTimeout: 15000 });
  s.ws = ws;
  ws.on('upgrade', (res) => { s.ext = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('open', () => { s.openMs = Date.now() - t0; });
  ws.on('message', (buf) => {
    const text = buf.toString();
    s.frames++;
    s.bytes += buf.length;
    const kind = text.match(/^\d+/)?.[0] ?? 'raw';
    s.packets[kind] = (s.packets[kind] ?? 0) + 1;
    capture(`${name}.txt`, `${Date.now() - t0}\t${text}`);
    if (kind === '0') {
      s.handshake = JSON.parse(text.slice(1));
      if (connect) ws.send('40');
    } else if (kind === '2') {
      s.pings++;
      if (pong) ws.send('3');
    } else if (kind === '40') {
      s.connectAck = { ms: Date.now() - t0, body: text.slice(0, 200) };
    } else if (kind === '42') {
      let arr;
      try { arr = JSON.parse(text.slice(2)); } catch { s.errors.push(text.slice(0, 200)); return; }
      const [ev, payload] = arr;
      s.events[ev] = (s.events[ev] ?? 0) + 1;
      onEvent?.(ev, payload, Date.now() - t0, text);
    } else if (kind === '44' || kind === '41') {
      s.errors.push(text.slice(0, 300));
    }
  });
  ws.on('close', (code, reason) => { s.closed = { ms: Date.now() - t0, code, reason: reason.toString() }; });
  ws.on('error', (e) => { s.errors.push(String(e.message)); });
  return s;
}

const summary = (s) => ({
  name: s.name, openMs: s.openMs, ext: s.ext, handshake: s.handshake, connectAck: s.connectAck, frames: s.frames, bytes: s.bytes,
  pings: s.pings, packets: s.packets, events: s.events, closed: s.closed, errors: s.errors.slice(0, 5),
});

// A "news" payload is a JSON string holding {type, data}, and data is itself a JSON string for the two book lists.
function parseNews(payload) {
  const outer = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const data = typeof outer.data === 'string' ? JSON.parse(outer.data) : outer.data;
  return { type: outer.type, data, keys: Object.keys(outer) };
}

function orderStats(list, side) {
  let bad = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1].rate, b = list[i].rate;
    if (side === 'buy' ? b > a : b < a) bad++;
  }
  return bad;
}

// order/fetchOrderbook is the route CCXT reads, and on the INR market Cloudflare passes it through uncached.
async function restBook(symbol) {
  const t = Date.now();
  const r = await fetch(`https://bitbns.com/order/fetchOrderbook?symbol=${symbol}`);
  const j = await r.json();
  return { ms: Date.now() - t, cf: r.headers.get('cf-cache-status'), bids: j.bids, asks: j.asks, timestamp: j.timestamp };
}

async function book() {
  const specs = [
    { name: 'inr-BTC', market: 'inr', coin: 'BTC', rest: 'BTC' },
    { name: 'inr-ETH', market: 'inr', coin: 'ETH', rest: 'ETH' },
    { name: 'usdt-BTC', market: 'usdt', coin: 'BTC', rest: 'BTCUSDT' },
    ...['SOL', 'XRP', 'DOGE', 'LTC', 'USDT'].map((coin) => ({ name: `inr-${coin}`, market: 'inr', coin, rest: coin })),
  ];
  const stats = {};
  const socks = specs.map((sp) => {
    const st = { buy: [], sell: [], trade: 0, keys: new Set(), types: {}, lastBuy: null, lastSell: null, badBuy: 0, badSell: 0, gapsMs: [], lastAt: null, sizeSample: null, identicalRepeats: 0, prevText: {} };
    stats[sp.name] = st;
    return open(sp.name, spotUrl(sp.market, `coin=${sp.coin}`), {
      onEvent: (ev, payload, ms, text) => {
        if (st.lastAt !== null) st.gapsMs.push(ms - st.lastAt);
        st.lastAt = ms;
        let n;
        try { n = parseNews(payload); } catch { st.types.unparsed = (st.types.unparsed ?? 0) + 1; return; }
        n.keys.forEach((k) => st.keys.add(k));
        st.types[`${ev}:${n.type}`] = (st.types[`${ev}:${n.type}`] ?? 0) + 1;
        if (st.prevText[n.type] === text) st.identicalRepeats++;
        st.prevText[n.type] = text;
        if (n.type === 'buyList') { st.buy.push({ ms, len: n.data.length }); st.lastBuy = n.data; st.badBuy += orderStats(n.data, 'buy') > 0 ? 1 : 0; if (!st.sizeSample) st.sizeSample = n.data.slice(0, 3); }
        if (n.type === 'sellList') { st.sell.push({ ms, len: n.data.length }); st.lastSell = n.data; st.badSell += orderStats(n.data, 'sell') > 0 ? 1 : 0; }
        if (n.type === 'tradeList') st.trade++;
        if (!st.firstFrames) st.firstFrames = [];
        if (st.firstFrames.length < 4) st.firstFrames.push({ ms, ev, type: n.type, len: Array.isArray(n.data) ? n.data.length : null, head: Array.isArray(n.data) ? n.data.slice(0, 2) : n.data });
      },
    });
  });
  const tick = { count: 0, sample: null, symbols: new Set(), keys: null };
  const tsock = open('inr-ticker', spotUrl('inr', 'withTicker=true&onlyTicker=true'), {
    onEvent: (ev, payload, ms) => {
      tick.count++;
      const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (!tick.sample) { tick.sample = JSON.stringify(obj).slice(0, 600); tick.ev = ev; tick.keys = Object.keys(obj).length; }
      Object.keys(obj ?? {}).forEach((k) => tick.symbols.add(k));
      if (!tick.firstMs) tick.firstMs = ms;
    },
  });
  await sleep(45_000);
  for (const sp of specs) {
    const r = await restBook(sp.rest);
    const st = stats[sp.name];
    const cmp = (sock, rest) => {
      if (!sock || !rest) return null;
      const n = Math.min(10, sock.length, rest.length);
      let priceEq = 0; const ratios = [];
      for (let i = 0; i < n; i++) {
        if (sock[i].rate === rest[i][0]) priceEq++;
        ratios.push(+(sock[i].btc / rest[i][1]).toPrecision(6));
      }
      return { n, priceEq, ratios: [...new Set(ratios)].slice(0, 5), sockTop: sock.slice(0, 2), restTop: rest.slice(0, 2) };
    };
    log('book', {
      name: sp.name, types: st.types, keys: [...st.keys], identicalRepeats: st.identicalRepeats,
      buyFrames: st.buy.length, buyLens: [...new Set(st.buy.map((b) => b.len))].slice(0, 8), sellFrames: st.sell.length, sellLens: [...new Set(st.sell.map((b) => b.len))].slice(0, 8),
      tradeFrames: st.trade, framesNotDescendingBids: st.badBuy, framesNotAscendingAsks: st.badSell,
      gapMs: st.gapsMs.length ? { min: Math.min(...st.gapsMs), max: Math.max(...st.gapsMs), median: st.gapsMs.sort((a, b) => a - b)[st.gapsMs.length >> 1] } : null,
      firstFrames: st.firstFrames,
      restMs: r.ms, restCf: r.cf, restTsAgeS: r.timestamp ? Math.round((Date.now() - r.timestamp) / 1000) : null, restBids: r.bids?.length, restAsks: r.asks?.length,
      bidCompare: cmp(st.lastBuy, r.bids), askCompare: cmp(st.lastSell, r.asks),
    });
  }
  log('ticker', { count: tick.count, event: tick.ev, firstMs: tick.firstMs, symbols: tick.symbols.size, sample: tick.sample });
  for (const s of [...socks, tsock]) { log('socket', summary(s)); s.ws.terminate(); }
}

const WATCH = ['BTC', 'ETH', 'SOL', 'SHIB', 'LTC', 'USDT', 'XRP', 'DOGE'];

function levelShape(level) {
  return Object.keys(level).sort().map((k) => `${k}:${typeof level[k]}`).join(',');
}

async function all() {
  const allStats = {};
  const updates = [];
  const mk = (market) => {
    const st = { snapshotFrames: 0, snapshotCoins: new Set(), snapshotLens: [], updates: 0, emptyData: 0, byCoin: {}, shapes: {}, lens: [], wrongOrder: 0 };
    allStats[market] = st;
    return open(`all-${market}`, spotUrl(market, 'coin=ALL'), {
      onEvent: (ev, payload, ms) => {
        if (payload && typeof payload === 'object' && !('coin' in payload)) {
          st.snapshotFrames++;
          for (const [coin, v] of Object.entries(payload)) {
            st.snapshotCoins.add(coin);
            try { const n = parseNews(v); if (Array.isArray(n.data) && n.type !== 'tradeList') { st.snapshotLens.push(n.data.length); if (n.data[0]) st.shapes[levelShape(n.data[0])] = (st.shapes[levelShape(n.data[0])] ?? 0) + 1; } } catch {}
          }
          return;
        }
        if (payload && typeof payload === 'object' && 'coin' in payload) {
          if (!payload.data) { st.emptyData++; return; }
          let n; try { n = parseNews(payload.data); } catch { return; }
          st.updates++;
          st.byCoin[payload.coin] = (st.byCoin[payload.coin] ?? 0) + 1;
          if (Array.isArray(n.data)) {
            st.lens.push(n.data.length);
            if (n.data[0]) st.shapes[levelShape(n.data[0])] = (st.shapes[levelShape(n.data[0])] ?? 0) + 1;
            if (n.type !== 'tradeList' && orderStats(n.data.map((l) => ({ rate: Number(l.rate) })), n.type === 'buyList' ? 'buy' : 'sell') > 0) st.wrongOrder++;
          }
          updates.push({ market, coin: payload.coin, type: n.type, ms, len: Array.isArray(n.data) ? n.data.length : null });
        }
      },
    });
  };
  const inr = mk('inr');
  const usdt = mk('usdt');
  const per = {};
  const perSocks = WATCH.map((coin) => {
    per[coin] = [];
    return open(`coin-${coin}`, spotUrl('inr', `coin=${coin}`), {
      onEvent: (ev, payload, ms) => {
        let n; try { n = parseNews(payload); } catch { return; }
        per[coin].push({ ms, type: n.type, len: Array.isArray(n.data) ? n.data.length : null });
      },
    });
  });
  await sleep(45_000);
  for (const [market, st] of Object.entries(allStats)) {
    const lens = [...new Set(st.lens)].sort((a, b) => a - b);
    log('allMarket', {
      market, snapshotFrames: st.snapshotFrames, snapshotCoins: st.snapshotCoins.size, snapshotMaxLen: Math.max(0, ...st.snapshotLens), updates: st.updates, emptyDataFrames: st.emptyData,
      coinsUpdated: Object.keys(st.byCoin).length, topCoins: Object.entries(st.byCoin).sort((a, b) => b[1] - a[1]).slice(0, 8), updateLens: lens.slice(0, 12), levelShapes: st.shapes, framesOutOfOrder: st.wrongOrder,
    });
  }
  const perSummary = WATCH.map((coin) => {
    const inAll = updates.filter((u) => u.market === 'inr' && u.coin === coin);
    const after = per[coin].filter((f, i) => i >= 3);
    const matched = inAll.filter((u) => per[coin].some((f) => f.type === u.type && Math.abs(f.ms - u.ms) < 2000)).length;
    return { coin, allUpdates: inAll.length, perCoinFrames: per[coin].length, perCoinAfterSnapshot: after.length, perCoinTypes: [...new Set(after.map((f) => f.type))], matchedWithin2s: matched };
  });
  log('perCoin', { rows: perSummary });
  const gaps = updates.filter((u) => u.market === 'inr').map((u) => u.ms);
  log('updateTimes', { inrFirstMs: gaps[0] ?? null, inrLastMs: gaps.at(-1) ?? null, sample: updates.slice(0, 10) });
  for (const s of [inr, usdt, ...perSocks]) { const x = summary(s); log('socket', { name: x.name, openMs: x.openMs, frames: x.frames, bytes: x.bytes, pings: x.pings, closed: x.closed, errors: x.errors }); s.ws.terminate(); }
}

async function futures() {
  const r = await fetch('https://bitbns.com/futures-testnet/getInstDetails?network=mainnet');
  const insts = Object.values((await r.json())[0].data);
  const rooms = insts.map((i) => `news_${i.coin_name}`);
  // A frame names neither room nor instrument, so the walk joins one room per window and attributes frames by arrival time.
  let current = null;
  const perRoom = {};
  const walk = open('futures-walk', FUTURES_URL, {
    onEvent: (ev, payload, ms) => {
      if (!current) return;
      const row = perRoom[current];
      let n; try { n = parseNews(payload); } catch { row.unparsed++; return; }
      if (n.type === 'buyList') { row.bids = n.data.length; row.bestBid = n.data[0]?.rate ?? null; row.bidOrderBad = orderStats(n.data, 'buy'); row.bidShape = n.data[0] ? levelShape(n.data[0]) : null; }
      if (n.type === 'sellList') { row.asks = n.data.length; row.bestAsk = n.data[0]?.rate ?? null; row.askOrderBad = orderStats(n.data, 'sell'); }
      if (n.type === 'tradeList') { row.trades = n.data.length; row.lastTrade = n.data[0]?.time ?? null; row.lastRate = n.data[0]?.rate ?? null; }
      row.frames++;
      if (row.firstMs === null) row.firstMs = ms - row.sentMs;
    },
  });
  const btcFrames = [];
  const btc = open('futures-btc', FUTURES_URL, {
    onEvent: (ev, payload, ms) => { let n; try { n = parseNews(payload); } catch { n = { type: String(payload) }; } btcFrames.push({ ms, type: n.type, len: Array.isArray(n.data) ? n.data.length : null }); },
  });
  const noneFrames = [];
  const none = open('futures-none', FUTURES_URL, { onEvent: (ev, payload, ms) => noneFrames.push({ ms, ev, payload: String(payload).slice(0, 80) }) });
  await sleep(2000);
  btc.ws.send(`42${JSON.stringify(['switchRoom', 'news_BTCUSDTP'])}`);
  for (const room of rooms) {
    current = room;
    perRoom[room] = { frames: 0, unparsed: 0, bids: null, asks: null, trades: null, bestBid: null, bestAsk: null, lastTrade: null, lastRate: null, firstMs: null, sentMs: Date.now() - walk.t0 };
    walk.ws.send(`42${JSON.stringify(['switchRoom', room])}`);
    await sleep(1500);
  }
  current = null;
  await sleep(40_000 - 2000 - rooms.length * 1500);
  const rows = Object.entries(perRoom).map(([room, v]) => ({ room, ...v, sentMs: undefined }));
  log('futuresRooms', { rooms: rows.length, delivered: rows.filter((x) => x.frames > 0).length, twoSided: rows.filter((x) => x.bids > 0 && x.asks > 0).length, rows });
  log('futuresBtc', { frames: btcFrames.length, types: btcFrames.map((f) => `${f.ms}:${f.type}:${f.len}`) });
  log('futuresNoRoom', { frames: noneFrames.length, sample: noneFrames.slice(0, 4) });
  for (const x of [walk, btc, none]) { const y = summary(x); log('socket', { name: y.name, openMs: y.openMs, handshake: y.handshake, connectAck: y.connectAck, frames: y.frames, bytes: y.bytes, pings: y.pings, packets: y.packets, closed: y.closed, errors: y.errors }); x.ws.terminate(); }
}

// The web app's chart header reads index prices for every futures coin from this socket, keyed by coin_id.
async function index() {
  const r = await fetch('https://bitbns.com/futures-testnet/getInstDetails?network=mainnet');
  const insts = Object.values((await r.json())[0].data);
  const frames = [];
  const values = {};
  const s = open('index', INDEX_URL, {
    onEvent: (ev, payload, ms) => {
      frames.push({ ms, ev, keys: payload && typeof payload === 'object' ? Object.keys(payload).length : null });
      if (payload && typeof payload === 'object') {
        for (const [k, v] of Object.entries(payload)) { values[k] ??= []; values[k].push(v); }
        if (frames.length === 1) log('indexFirst', { ev, payload: JSON.stringify(payload).slice(0, 700) });
      }
    },
  });
  await sleep(30_000);
  const gaps = frames.slice(1).map((f, i) => f.ms - frames[i].ms);
  const byInst = insts.map((i) => {
    const v = values[String(i.coin_id)] ?? [];
    return { inst: i.coin_name, coin_id: i.coin_id, readings: v.length, distinct: new Set(v.map((x) => JSON.stringify(x))).size, last: v.at(-1) ?? null };
  });
  log('index', { frames: frames.length, events: [...new Set(frames.map((f) => f.ev))], firstMs: frames[0]?.ms ?? null, gapMs: gaps.length ? { min: Math.min(...gaps), median: gaps.sort((a, b) => a - b)[gaps.length >> 1], max: Math.max(...gaps) } : null, keysPerFrame: [...new Set(frames.map((f) => f.keys))], byInst });
  const y = summary(s);
  log('socket', { name: y.name, openMs: y.openMs, handshake: y.handshake, connectAck: y.connectAck, frames: y.frames, bytes: y.bytes, pings: y.pings, packets: y.packets, closed: y.closed, errors: y.errors });
  s.ws.terminate();
}

// Three client behaviours on each host: connect and answer pings, connect and never answer, never send the Socket.IO connect.
async function silence() {
  const hosts = { spot: spotUrl('inr', 'coin=BTC'), futures: FUTURES_URL };
  const socks = [];
  for (const [host, url] of Object.entries(hosts)) {
    socks.push(open(`${host}-connect-pong`, url, { connect: true, pong: true }));
    socks.push(open(`${host}-connect-nopong`, url, { connect: true, pong: false }));
    socks.push(open(`${host}-noconnect-pong`, url, { connect: false, pong: true }));
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) await sleep(1000);
  for (const s of socks) { const y = summary(s); log('silence', { name: y.name, openMs: y.openMs, handshake: y.handshake, frames: y.frames, pings: y.pings, packets: y.packets, closed: y.closed, errors: y.errors }); s.ws.terminate(); }
}

async function errors() {
  const cases = [
    ['spot-unknown-coin', spotUrl('inr', 'coin=NOPE')],
    ['spot-no-coin', spotUrl('inr', '')],
    ['spot-all-coins', spotUrl('inr', 'coin=ALL')],
    ['spot-lower-case', spotUrl('inr', 'coin=btc')],
    ['spot-eio3', spotUrl('inr', 'coin=BTC', 3)],
    ['spot-unknown-event', spotUrl('inr', 'coin=BTC')],
    ['spot-not-a-packet', spotUrl('inr', 'coin=BTC')],
    ['futures-unknown-room', FUTURES_URL],
    ['futures-unknown-event', FUTURES_URL],
    ['futures-not-a-packet', FUTURES_URL],
  ];
  const socks = cases.map(([name, url]) => {
    const firsts = [];
    const s = open(name, url, {
      // The EIO=3 server connects the default namespace by itself, so the probe does not send 40 there.
      connect: !name.endsWith('eio3'),
      onEvent: (ev, payload, ms) => {
        if (firsts.length >= 3) return;
        let n; try { n = parseNews(payload); } catch { n = { type: 'unparsed' }; }
        firsts.push({ ms, ev, type: n.type ?? null, len: Array.isArray(n.data) ? n.data.length : null, payload: Array.isArray(n.data) ? JSON.stringify(n.data.slice(0, 1)) : String(payload).slice(0, 80) });
      },
    });
    s.firsts = firsts;
    return s;
  });
  const deflate = [open('spot-deflate-offer', spotUrl('inr', 'coin=BTC'), { deflate: true }), open('futures-deflate-offer', FUTURES_URL, { deflate: true })];
  await sleep(4000);
  const by = (n) => socks.find((s) => s.name === n);
  const send = (n, text) => { const s = by(n); if (s.ws.readyState === 1) { s.sentAt = Date.now() - s.t0; s.ws.send(text); } };
  send('spot-eio3', '2');
  send('spot-unknown-event', `42${JSON.stringify(['nope', 'x'])}`);
  send('spot-not-a-packet', 'hello');
  send('futures-unknown-room', `42${JSON.stringify(['switchRoom', 'news_NOPEUSDTP'])}`);
  send('futures-unknown-event', `42${JSON.stringify(['nope', 'x'])}`);
  send('futures-not-a-packet', 'hello');
  await sleep(20_000);
  for (const s of socks) { const y = summary(s); log('errors', { name: y.name, handshake: y.handshake, connectAck: y.connectAck, frames: y.frames, bytes: y.bytes, packets: y.packets, events: y.events, sentAt: s.sentAt ?? null, closed: y.closed, errors: y.errors, firsts: s.firsts }); s.ws.terminate(); }
  for (const d of deflate) { log('deflate', { name: d.name, ext: d.ext, openMs: d.openMs, frames: d.frames, closed: d.closed, errors: d.errors }); d.ws.terminate(); }
}

const mode = process.argv[2] ?? 'book';
const modes = { book, all, futures, index, silence, errors };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
