// Kanga Global WebSocket probe: the Socket.IO market feed the web app uses at wss://ws.kanga.global, spoken as raw Engine.IO 4 text packets over ws.
// Measures the handshake, the book frames (full side per frame, three price groupings, level order, size unit), a REST compare, unknown and repeated subscriptions, keepalive, silence and compression.
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/kanga/ws-probe.mjs [book|batch|silence|deflate]
//   book     five markets on one socket for 70 s, with unknown, underscore, lowercase, repeated and unsubscribed markets, bad packets, and a REST compare
//   batch    every USD-family market with 24 h volume on one socket for 60 s
//   silence  three sockets for up to 60 s: no namespace connect, no pong, and idle with pongs
//   deflate  offers permessage-deflate once, prints what the server negotiates, and reads the polling handshake
//   rooms    three sockets for 45 s: BTC-USDT only, ETH-USDT only, and BTC-USDT then ETH-USDT, to see which subscription keeps updating
//   fanout   ten sockets for 30 s, one busy USD-family market each, to see whether one host may hold a socket per market
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/kanga/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.kanga.global/socket.io/?EIO=4&transport=websocket';
const API = 'https://api.kanga.global';
const OUT = process.env.PROBE_OUT_DIR;
const MODE = process.argv[2] ?? 'book';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : null);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// One Socket.IO client over a raw socket: '0' is the Engine.IO open packet, '40' the namespace connect, '42' an event, '2' a server ping, '3' our pong.
function openSio(label, { connectNamespace = true, answerPings = true, deflate = false, onEvent = () => {}, onNamespace = () => {} } = {}) {
  const t0 = Date.now();
  const s = { label, t0, pings: [], closed: null, eio: null, nsAt: null, events: 0, bytes: 0, raw: [] };
  s.ws = new WebSocket(WS_URL, { perMessageDeflate: deflate });
  s.ws.on('upgrade', (res) => (s.extensions = res.headers['sec-websocket-extensions'] ?? null));
  s.ws.on('open', () => (s.openMs = Date.now() - t0));
  s.ws.on('message', (data, isBinary) => {
    const text = data.toString();
    s.bytes += text.length;
    if (isBinary) s.binary = (s.binary ?? 0) + 1;
    if (text.startsWith('0{')) {
      s.eio = JSON.parse(text.slice(1));
      s.eioMs = Date.now() - t0;
      if (connectNamespace) s.ws.send('40');
    } else if (text.startsWith('40')) {
      s.nsAt = Date.now();
      s.nsMs = s.nsAt - t0;
      s.nsPacket = text;
      onNamespace(s);
    } else if (text === '2') {
      s.pings.push(Date.now() - t0);
      if (answerPings) s.ws.send('3');
    } else if (text.startsWith('42')) {
      s.events++;
      onEvent(s, text);
    } else {
      s.raw.push({ atMs: Date.now() - t0, text: text.slice(0, 300) });
    }
  });
  s.ws.on('close', (code, reason) => (s.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }));
  s.ws.on('error', (e) => (s.error = e.message));
  s.emit = (...args) => s.ws.readyState === WebSocket.OPEN && s.ws.send('42' + JSON.stringify(args));
  return s;
}

async function restJson(path, init) {
  const r = await fetch(`${API}${path}`, init);
  return { status: r.status, json: await r.json(), arrived: Date.now() };
}

async function marketList() {
  const r = await restJson('/api/markets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return new Map(r.json.items.map((m) => [m.id, m]));
}

function decimals(x) {
  const s = String(x);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

// A side frame is {"0": levels, "1": levels, ...}, one array per price grouping, each level [size, price] as JSON numbers.
function sideStats(data, side) {
  const keys = Object.keys(data);
  const out = { keys, levels: keys.map((k) => data[k].length), ordered: true, maxDecimals: {}, arrays: true };
  for (const k of keys) {
    const lv = data[k];
    if (!Array.isArray(lv)) {
      out.arrays = false;
      continue;
    }
    out.maxDecimals[k] = Math.max(0, ...lv.map((l) => decimals(l[1])));
    for (let i = 1; i < lv.length; i++) {
      const ok = side === 'bid' ? lv[i - 1][1] > lv[i][1] : lv[i - 1][1] < lv[i][1];
      if (!ok) out.ordered = false;
    }
  }
  return out;
}

function newTrack() {
  return { frames: 0, repeats: 0, last: null, lastAt: null, gaps: [], firstMs: null, keys: new Set(), levels: new Set(), unordered: 0, maxDecimals: {}, lastData: null, arrivals: [] };
}

async function book() {
  const catalog = await marketList();
  const markets = ['BTC-USDC', 'BTC-USDT', 'ETH-USDT', 'NEAR-USDT', 'BTC-oPLN'];
  const probes = ['NOPE-USDT', 'BTC_USDT', 'btc-usdt'];
  const tracks = new Map();
  const other = {};
  const subAt = new Map();
  const after = { dupFramesWithin2s: null, unsubscribedFramesAfter: 0, dupTimeline: [] };
  let dupAt = null;
  let unsubAt = null;
  const s = openSio('book', {
    onNamespace: (s) => {
      // An ack id after '42' asks the server to answer with '43<id>'.
      s.ws.send('420' + JSON.stringify(['subscribe market', markets[0]]));
      subAt.set(markets[0], Date.now());
      for (const m of markets.slice(1)) {
        s.emit('subscribe market', m);
        subAt.set(m, Date.now());
      }
    },
    onEvent: (s, text) => {
      const [ev, data, id, ...rest] = JSON.parse(text.slice(2));
      if (ev !== 'bid' && ev !== 'ask') {
        const k = `${ev} ${id}`;
        other[k] ??= { n: 0, extraArgs: rest.length, sample: text.slice(0, 220) };
        other[k].n++;
        capture('other.txt', text);
        return;
      }
      const key = `${id} ${ev}`;
      if (!tracks.has(key)) tracks.set(key, newTrack());
      const t = tracks.get(key);
      const now = Date.now();
      if (t.firstMs === null) t.firstMs = subAt.has(id) ? now - subAt.get(id) : null;
      t.frames++;
      t.arrivals.push(now - s.t0);
      const body = JSON.stringify(data);
      if (body === t.last) t.repeats++;
      if (dupAt !== null && id === 'BTC-USDT' && now - dupAt < 3000) after.dupTimeline.push({ side: ev, msAfterRepeat: now - dupAt, sameAsPrevious: body === t.last });
      if (t.lastAt !== null) t.gaps.push(now - t.lastAt);
      t.last = body;
      t.lastAt = now;
      t.lastData = data;
      const st = sideStats(data, ev);
      st.keys.forEach((k) => t.keys.add(k));
      st.levels.forEach((n) => t.levels.add(n));
      if (!st.ordered) t.unordered++;
      for (const [k, d] of Object.entries(st.maxDecimals)) t.maxDecimals[k] = Math.max(t.maxDecimals[k] ?? 0, d);
      if (dupAt !== null && id === 'BTC-USDT' && now - dupAt < 2000) after.dupFramesWithin2s = (after.dupFramesWithin2s ?? 0) + 1;
      if (unsubAt !== null && id === 'BTC-oPLN') after.unsubscribedFramesAfter++;
      if (t.frames <= 2) capture('book.txt', text);
    },
  });
  await sleep(10_000);
  for (const p of probes) {
    s.emit('subscribe market', p);
    subAt.set(p, Date.now());
  }
  await sleep(5_000);
  dupAt = Date.now();
  s.emit('subscribe market', 'BTC-USDT');
  await sleep(25_000);
  unsubAt = Date.now();
  s.emit('unsubscribe market', 'BTC-oPLN');
  await sleep(25_000);

  // REST compare at the end, against the last full-precision frame of each side.
  for (const m of ['BTC-USDC', 'BTC-USDT']) {
    const r = await restJson(`/api/v2/market/orderbook/raw?market=${m}`);
    const p = String(catalog.get(m).pricePrecision);
    for (const [ev, restSide] of [['bid', r.json.bids], ['ask', r.json.asks]]) {
      const t = tracks.get(`${m} ${ev}`);
      const ws = t?.lastData?.[p] ?? [];
      const n = Math.min(20, ws.length, restSide.length);
      let price = 0;
      let both = 0;
      for (let i = 0; i < n; i++) {
        if (ws[i][1] === Number(restSide[i][0])) price++;
        if (ws[i][1] === Number(restSide[i][0]) && ws[i][0] === Number(restSide[i][1])) both++;
      }
      log('rest compare', { market: m, side: ev, fullPrecisionKey: p, compared: n, samePrice: price, samePriceAndSize: both, wsTop: ws[0], restTop: restSide[0], restAgeMs: r.arrived - r.json.timestamp, wsFrameAgeMs: t ? Date.now() - t.lastAt : null });
    }
  }
  // Grouping check on the last BTC-USDT frames: a coarser key rounds bids down and asks up.
  for (const ev of ['bid', 'ask']) {
    const d = tracks.get(`BTC-USDT ${ev}`)?.lastData;
    if (d) log('grouping', { side: ev, bestPerKey: Object.fromEntries(Object.entries(d).map(([k, lv]) => [k, lv[0]])) });
  }
  s.ws.send('42["nope"]');
  await sleep(1500);
  s.ws.send('42not json');
  await sleep(2500);
  after.openAfterBadPackets = s.ws.readyState === WebSocket.OPEN && s.closed === null;
  s.ws.close();
  await sleep(300);

  log('handshake', { openMs: s.openMs, eioMs: s.eioMs, eio: s.eio, nsMs: s.nsMs, nsPacket: s.nsPacket, extensions: s.extensions });
  for (const [key, t] of tracks) {
    const [id] = key.split(' ');
    log('side', { key, pricePrecision: catalog.get(id)?.pricePrecision ?? null, frames: t.frames, firstFrameMs: t.firstMs, repeats: t.repeats, gapMinMs: t.gaps.length ? Math.min(...t.gaps) : null, gapMedianMs: pct(t.gaps, 0.5), gapMaxMs: t.gaps.length ? Math.max(...t.gaps) : null, keys: [...t.keys], levelsPerKey: [...t.levels], unorderedFrames: t.unordered, maxPriceDecimalsPerKey: t.maxDecimals, arrivalsMs: t.arrivals.slice(0, 16) });
  }
  log('never served', { markets: [...markets, ...probes].filter((m) => !tracks.has(`${m} bid`) && !tracks.has(`${m} ask`)) });
  log('other events', other);
  log('after', after);
  log('pings', { n: s.pings.length, intervalsMs: s.pings.slice(1).map((t, i) => t - s.pings[i]).slice(0, 8) });
  log('non-event packets', { packets: s.raw.slice(0, 10) });
  log('close', { closed: s.closed, error: s.error ?? null });
}

async function batch() {
  const catalog = await marketList();
  const ticker = (await restJson('/api/v2/market/ticker')).json;
  const markets = [...catalog.values()]
    .filter((m) => ['USDT', 'USDC', 'oUSD'].includes(m.payingCurrency) && Number(ticker[m.id]?.quote_volume ?? 0) > 0)
    .map((m) => m.id);
  const per = new Map(markets.map((m) => [m, { bid: 0, ask: 0, first: null }]));
  const bySecond = new Map();
  const parseUs = [];
  let subAt = 0;
  let frames = 0;
  let bytes = 0;
  const byEvent = {};
  const emptySides = [];
  const s = openSio('batch', {
    onNamespace: (s) => {
      subAt = Date.now();
      for (const m of markets) s.emit('subscribe market', m);
    },
    onEvent: (s, text) => {
      const t0 = performance.now();
      const [ev, data, id] = JSON.parse(text.slice(2));
      parseUs.push((performance.now() - t0) * 1000);
      if ((ev === 'bid' || ev === 'ask') && Object.values(data).every((lv) => lv.length === 0)) emptySides.push(`${id} ${ev}`);
      frames++;
      bytes += text.length;
      byEvent[ev] ??= { frames: 0, bytes: 0 };
      byEvent[ev].frames++;
      byEvent[ev].bytes += text.length;
      const sec = Math.floor((Date.now() - subAt) / 1000);
      bySecond.set(sec, (bySecond.get(sec) ?? 0) + 1);
      const p = per.get(id);
      if (!p || (ev !== 'bid' && ev !== 'ask')) return;
      p[ev]++;
      p.first ??= Date.now() - subAt;
    },
  });
  await sleep(62_000);
  s.ws.close();
  await sleep(300);
  const secs = [...bySecond.entries()].filter(([k]) => k >= 5 && k < 60).map(([, v]) => v);
  const firsts = [...per.values()].map((p) => p.first).filter((x) => x !== null);
  log('batch', {
    subscribed: markets.length, openMs: s.openMs, nsMs: s.nsMs, frames, bytes, perSecondMedian: pct(secs, 0.5), perSecondMax: Math.max(0, ...secs),
    bytesPerSecond: Math.round(bytes / 60), bytesPerFrame: Math.round(bytes / Math.max(1, frames)), parseUsMedian: Math.round(pct(parseUs, 0.5) ?? 0),
    withBidAndAsk: [...per.values()].filter((p) => p.bid && p.ask).length, withNothing: [...per.entries()].filter(([, p]) => !p.bid && !p.ask).map(([m]) => m),
    firstFrameMsMedian: pct(firsts, 0.5), firstFrameMsMax: firsts.length ? Math.max(...firsts) : null,
    sideFramesPerMarketMedian: pct([...per.values()].map((p) => p.bid + p.ask), 0.5), closed: s.closed,
    byEvent, emptySides, sideUpdatesAfterSnapshot: [...per.values()].reduce((n, p) => n + Math.max(0, p.bid - 1) + Math.max(0, p.ask - 1), 0),
    marketsWithUpdates: [...per.values()].filter((p) => p.bid > 1 || p.ask > 1).length,
    busiest: [...per.entries()].sort((x, y) => y[1].bid + y[1].ask - x[1].bid - x[1].ask).slice(0, 6).map(([m, p]) => `${m} ${p.bid}/${p.ask}`),
  });
}

async function silence() {
  const a = openSio('no namespace connect', { connectNamespace: false });
  const b = openSio('subscribed, no pong', { answerPings: false, onNamespace: (s) => s.emit('subscribe market', 'BTC-USDC') });
  const c = openSio('idle with pongs');
  const all = [a, b, c];
  const start = Date.now();
  while (Date.now() - start < 60_000 && all.some((s) => !s.closed)) await sleep(500);
  for (const s of all) {
    if (!s.closed) s.ws.close();
  }
  await sleep(300);
  for (const s of all) log('silence', { label: s.label, eio: s.eio, pings: s.pings.length, firstPingMs: s.pings[0] ?? null, events: s.events, closed: s.closed, stillOpenAt60s: s.closed?.atMs >= 60_000 || false, error: s.error ?? null });
}

async function deflate() {
  const s = openSio('deflate', { deflate: true });
  await sleep(4_000);
  s.ws.close();
  await sleep(300);
  log('deflate', { extensions: s.extensions, eio: s.eio, closed: s.closed });
  const r = await fetch('https://ws.kanga.global/socket.io/?EIO=4&transport=polling');
  const text = await r.text();
  log('polling handshake', { status: r.status, body: text.slice(0, 200) });
  const r3 = await fetch('https://ws.kanga.global/socket.io/?EIO=3&transport=polling');
  log('EIO 3 polling handshake', { status: r3.status, body: (await r3.text()).slice(0, 160) });
}

function countingSocket(label, subscriptions) {
  const counts = {};
  const s = openSio(label, {
    onNamespace: (s) => subscriptions.forEach(([delayMs, m]) => setTimeout(() => { s.emit('subscribe market', m); counts[`subscribed ${m} at`] = Date.now() - s.t0; }, delayMs)),
    onEvent: (s, text) => {
      const [ev, , id] = JSON.parse(text.slice(2));
      if (ev !== 'bid' && ev !== 'ask') return;
      const k = `${id} ${ev}`;
      counts[k] ??= [];
      counts[k].push(Date.now() - s.t0);
    },
  });
  s.counts = counts;
  return s;
}

async function rooms() {
  const a = countingSocket('BTC-USDT only', [[0, 'BTC-USDT']]);
  const b = countingSocket('ETH-USDT only', [[0, 'ETH-USDT']]);
  const c = countingSocket('BTC-USDT then ETH-USDT', [[0, 'BTC-USDT'], [3000, 'ETH-USDT']]);
  await sleep(45_000);
  for (const s of [a, b, c]) s.ws.close();
  await sleep(300);
  for (const s of [a, b, c]) log('rooms', { label: s.label, closed: s.closed, frames: Object.fromEntries(Object.entries(s.counts).map(([k, v]) => [k, Array.isArray(v) ? { n: v.length, arrivalsMs: v.slice(0, 12) } : v])) });
}

async function fanout() {
  const ticker = (await restJson('/api/v2/market/ticker')).json;
  const busy = Object.entries(ticker)
    .filter(([id]) => /-(USDT|USDC)$/.test(id))
    .sort((x, y) => Number(y[1].quote_volume) - Number(x[1].quote_volume))
    .slice(0, 10)
    .map(([id]) => id);
  const sockets = busy.map((m) => countingSocket(m, [[0, m]]));
  await sleep(30_000);
  for (const s of sockets) s.ws.close();
  await sleep(300);
  for (const s of sockets) {
    const n = (k) => (Array.isArray(s.counts[k]) ? s.counts[k].length : 0);
    log('fanout', { market: s.label, openMs: s.openMs ?? null, nsMs: s.nsMs ?? null, bidFrames: n(`${s.label} bid`), askFrames: n(`${s.label} ask`), closed: s.closed, error: s.error ?? null });
  }
}

log('start', { mode: MODE, at: new Date().toISOString() });
if (MODE === 'book') await book();
else if (MODE === 'batch') await batch();
else if (MODE === 'silence') await silence();
else if (MODE === 'deflate') await deflate();
else if (MODE === 'rooms') await rooms();
else if (MODE === 'fanout') await fanout();
log('end', { at: new Date().toISOString() });
