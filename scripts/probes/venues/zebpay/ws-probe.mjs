// ZebPay futures WebSocket probe: the undocumented public Socket.IO feed the zebpay.com futures web app uses, its depth, mark and ticker streams, the pushed allContractDetails map, keepalive, silence, and how each book frame lines up with Binance USD-M's own stream.
// Public, unauthenticated, read-only. It speaks Engine.IO 4 and Socket.IO 4 text framing over a plain socket and joins only the default namespace, never /auth-stream.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/zebpay/ws-probe.mjs [book|batch|silence|deflate|engineway]
//   book       depth, markPrice and ticker streams of six pairs, variant, unknown and malformed subscriptions, and Binance depth20@500ms, depth20@100ms and REST premiumIndex beside them, for about 60 s.
//   batch      the depth stream of every active pair on one socket for 40 s.
//   silence    three sockets that differ only in what the client sends, for up to 90 s.
//   deflate    asks for permessage-deflate once and prints what the server negotiates.
//   engineway  opens the host the way VenueFeed would, without the Socket.IO path, and sends a JSON frame. About 10 s.
// Set PROBE_OUT_DIR to keep the first frames of each event. Recorded in docs/profiles/zebpay/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const SIO_URL = 'wss://futuresws.zebpay.com/socket.io/?EIO=4&transport=websocket';
const REST = 'https://futuresbe.zebpay.com/api/v1';
const BINANCE_WS = 'wss://fstream.binance.com/stream?streams=';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const captured = {};

function capture(name, text) {
  if (!OUT) return;
  captured[name] = (captured[name] ?? 0) + 1;
  if (captured[name] > 3) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// One Socket.IO client over a raw socket: answers the Engine.IO ping unless told not to, joins "/" unless told not to, and hands every event to onEvent.
function sio({ answerPing = true, join = true, onEvent = () => {}, onRaw = () => {}, deflate = false } = {}) {
  const t0 = Date.now();
  const s = { t0, pings: [], events: 0, closed: null, open: null };
  const ws = new WebSocket(SIO_URL, { perMessageDeflate: deflate });
  s.ws = ws;
  s.ready = new Promise((resolve) => { s.resolveReady = resolve; });
  ws.on('upgrade', (res) => { s.extensions = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('open', () => { s.open = Date.now() - t0; });
  ws.on('error', (e) => { s.error = e.message; });
  ws.on('close', (code, reason) => { s.closed = { atMs: Date.now() - t0, code, reason: String(reason) }; });
  ws.on('message', (raw) => {
    const text = raw.toString();
    const at = Date.now();
    onRaw(text, at);
    if (text === '2') {
      s.pings.push(at - t0);
      if (answerPing) ws.send('3');
      return;
    }
    if (text.startsWith('0')) {
      s.handshake = JSON.parse(text.slice(1));
      capture('engineio-open.txt', text);
      if (join) ws.send('40');
      else s.resolveReady();
      return;
    }
    if (text.startsWith('40')) {
      s.nsAck = text;
      capture('socketio-connect.txt', text);
      s.resolveReady();
      return;
    }
    if (text.startsWith('43') || text.startsWith('44') || text.startsWith('41')) {
      capture('socketio-other.txt', text);
      s.other = (s.other ?? []).concat(text.slice(0, 300));
      return;
    }
    if (text.startsWith('42')) {
      s.events++;
      const [name, payload] = JSON.parse(text.slice(2));
      capture(`event-${name}.txt`, text);
      onEvent(name, payload, at, text.length);
    }
  });
  s.emit = (name, payload, ackId) => ws.send(`42${ackId ?? ''}${JSON.stringify([name, payload])}`);
  return s;
}

async function pairsInfo() {
  const r = await fetch(`${REST}/exchange/exchangeInfo`);
  const j = await r.json();
  return new Map(j.data.pairs.map((p) => [p.pair, p]));
}

async function book() {
  const info = await pairsInfo();
  const pairs = ['BTCUSDT', 'ETHUSDT', 'ENJUSDT', 'MMTUSDT', 'XAUUSDT', 'BTCINR'];
  const stream = (p) => `${p.toLowerCase()}@depth_${info.get(p).depthGrouping[0]}`;
  const stats = new Map(pairs.map((p) => [p, { frames: 0, levels: [], bidAsc: 0, bidDesc: 0, askAsc: 0, pairsOk: 0, puChain: 0, puBreak: 0, uRepeat: 0, lagE: [], gapsMs: [], lastAt: null, last: null, full20: 0, emptySide: 0, sizes: [] }]));
  const marks = new Map();
  const events = {};
  const zebByU = new Map();

  const z = sio({
    onEvent: (name, d, at, len) => {
      events[name] = events[name] ?? { n: 0, bytes: 0, rows: [] };
      events[name].n++;
      events[name].bytes += len;
      if (name === 'allContractDetails') events[name].rows.push(Object.keys(d).length);
      if (name === 'markPriceUpdate') {
        const m = marks.get(d.s) ?? { n: 0, lag: [], p: new Set(), i: new Set(), r: new Set(), T: new Set(), gaps: [], last: null, sample: d };
        m.n++; m.lag.push(at - d.E); m.p.add(d.p); m.i.add(d.i); m.r.add(d.r); m.T.add(d.T);
        if (m.last) m.gaps.push(d.E - m.last);
        m.last = d.E;
        m.lastFrame = d;
        marks.set(d.s, m);
      }
      if (name !== 'depthUpdate') return;
      const st = stats.get(d.s);
      if (!st) { events.unexpectedDepth = (events.unexpectedDepth ?? 0) + 1; return; }
      st.frames++;
      st.levels.push(`${d.b.length}/${d.a.length}`);
      if (d.b.length === 20 && d.a.length === 20) st.full20++;
      if (d.b.length === 0 || d.a.length === 0) st.emptySide++;
      const asc = (arr) => arr.every((l, i) => i === 0 || Number(l[0]) > Number(arr[i - 1][0]));
      const desc = (arr) => arr.every((l, i) => i === 0 || Number(l[0]) < Number(arr[i - 1][0]));
      if (asc(d.b)) st.bidAsc++;
      if (desc(d.b)) st.bidDesc++;
      if (asc(d.a)) st.askAsc++;
      if (d.b.every((l) => typeof l[0] === 'string' && typeof l[1] === 'string')) st.pairsOk++;
      if (st.last) {
        if (d.pu === st.last.u) st.puChain++; else st.puBreak++;
        if (d.u === st.last.u) st.uRepeat++;
        st.gapsMs.push(at - st.lastAt);
      }
      st.lagE.push(at - d.E);
      st.last = d;
      st.lastAt = at;
      if (d.s === 'BTCUSDT' || d.s === 'ETHUSDT' || d.s === 'BTCINR') zebByU.set(`${d.s}:${d.u}`, { at, d });
    },
  });

  // Binance's own streams for BTCUSDT and ETHUSDT, to line frames up by update id or event time.
  const binByU = new Map();
  const binByE = new Map();
  const binLag = {};
  const bws = new WebSocket(BINANCE_WS + 'btcusdt@depth20@500ms/ethusdt@depth20@500ms/btcusdt@depth20@100ms/ethusdt@depth20@100ms', { perMessageDeflate: false });
  bws.on('message', (raw) => {
    const at = Date.now();
    const { stream, data } = JSON.parse(raw.toString());
    const speed = stream.endsWith('@100ms') ? '100ms' : '500ms';
    binByU.set(`${data.s}:${data.u}`, { at, d: data, speed });
    binByE.set(`${data.s}:${data.E}`, { at, d: data, speed });
    (binLag[`${data.s}@${speed}`] ??= []).push(at - data.E);
  });
  const premium = [];
  const premiumTimer = setInterval(async () => {
    const r = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT').then((x) => x.json()).catch(() => null);
    const z = marks.get('BTCUSDT')?.lastFrame;
    if (r && z) premium.push({ zeb: { E: z.E, p: z.p, i: z.i, P: z.P, r: z.r, T: z.T }, binance: { time: r.time, markPrice: r.markPrice, indexPrice: r.indexPrice, estimatedSettlePrice: r.estimatedSettlePrice, lastFundingRate: r.lastFundingRate, nextFundingTime: r.nextFundingTime } });
  }, 10000);

  await z.ready;
  log('handshake', { openMs: z.open, engineio: z.handshake, nsAck: z.nsAck });
  const t = Date.now();
  z.emit('subscribe', { params: pairs.map(stream) }, 1);
  z.emit('subscribe', { params: ['btcusdt@markPrice', 'btcinr@markPrice', 'btcusdt@ticker'] });
  log('subscribed', { streams: pairs.map(stream), afterMs: Date.now() - t });

  // Variants, one socket each for 8 s: other groupings, a level count, upper case, unknown and inactive pairs, and an unknown event name.
  const variantStreams = ['btcusdt@depth_1', 'btcusdt@depth_10', 'ethusdt@depth20', 'ethusdt@depth', 'SOLUSDT@depth_0.01', 'nopeusdt@depth_0.1', 'aiainr@depth_1', 'nope:btcusdt@depth_0.1'];
  const variantSockets = variantStreams.map((spec) => {
    const r = { spec, depth: 0, levels: new Set(), offGrid: 0, prices: 0 };
    const [event, streamName] = spec.startsWith('nope:') ? ['nope', spec.slice(5)] : ['subscribe', spec];
    const grid = Number(spec.split('@depth_')[1] ?? NaN);
    r.s = sio({ onEvent: (name, d) => {
      if (name !== 'depthUpdate') return;
      r.depth++;
      r.levels.add(`${d.b.length}/${d.a.length}`);
      if (Number.isFinite(grid)) for (const [p] of [...d.b, ...d.a]) { r.prices++; const q = Number(p) / grid; if (Math.abs(q - Math.round(q)) > 1e-6) r.offGrid++; }
    } });
    r.s.ready.then(() => r.s.emit(event, { params: [streamName] }, 5));
    return r;
  });
  await sleep(8000);
  for (const r of variantSockets) {
    log('variant', { spec: r.spec, depthFrames: r.depth, levels: [...r.levels], pricesOffGrid: r.offGrid, prices: r.prices, ack: r.s.other ?? null, closed: r.s.closed });
    r.s.ws.close();
  }
  // A malformed Socket.IO packet.
  const bad = sio();
  await bad.ready;
  const badAt = Date.now();
  bad.ws.send('42["subscribe"');
  await sleep(4000);
  log('malformed_packet', { sent: '42["subscribe"', closed: bad.closed, closedAfterSendMs: bad.closed ? bad.closed.atMs - (badAt - bad.t0) : null });
  if (bad.ws.readyState === WebSocket.OPEN) bad.ws.close();

  // Unsubscribe one stream and see whether it stops.
  await sleep(20000);
  const before = stats.get('ENJUSDT').frames;
  z.emit('unsubscribe', { params: [stream('ENJUSDT')] });
  await sleep(24000);
  log('unsubscribe', { stream: stream('ENJUSDT'), framesBefore: before, framesAfter: stats.get('ENJUSDT').frames - before });

  clearInterval(premiumTimer);
  z.ws.close();
  bws.close();
  await sleep(300);

  log('socket', { pings: z.pings, closed: z.closed, other: z.other ?? null, extensions: z.extensions });
  for (const [p, st] of stats) {
    const lv = st.levels.reduce((a, x) => { a[x] = (a[x] ?? 0) + 1; return a; }, {});
    log('depth_stream', {
      pair: p, grouping: info.get(p).depthGrouping[0], frames: st.frames, levels: lv, full20: st.full20, emptySide: st.emptySide,
      bidsAscending: st.bidAsc, bidsDescending: st.bidDesc, asksAscending: st.askAsc, stringPairs: st.pairsOk,
      puEqualsPrevU: st.puChain, puBreak: st.puBreak, uRepeat: st.uRepeat,
      gapMs: { median: median(st.gapsMs), p90: pct(st.gapsMs, 0.9), max: st.gapsMs.length ? Math.max(...st.gapsMs) : null },
      recvMinusE: { min: st.lagE.length ? Math.min(...st.lagE) : null, median: median(st.lagE), p90: pct(st.lagE, 0.9), max: st.lagE.length ? Math.max(...st.lagE) : null },
    });
  }
  for (const [s, m] of marks) {
    log('mark_stream', { s, frames: m.n, EgapMs: { median: median(m.gaps), max: m.gaps.length ? Math.max(...m.gaps) : null }, recvMinusE: { median: median(m.lag), max: Math.max(...m.lag) }, distinct: { p: m.p.size, i: m.i.size, r: m.r.size, T: [...m.T] }, sample: m.sample });
  }
  for (const [name, e] of Object.entries(events)) {
    if (typeof e === 'number') { log('event', { name, n: e }); continue; }
    log('event', { name, frames: e.n, bytesPerFrame: Math.round(e.bytes / e.n), rows: e.rows.length ? [Math.min(...e.rows), Math.max(...e.rows)] : undefined });
  }

  // Relay check: the same Binance update id on both sockets, with the arrival gap and the price offset at equal sizes.
  // BTCINR frames are matched to Binance's BTCUSDT frames by event time, and their offset is read as the ratio of mids.
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'BTCINR']) {
    const bsym = sym.replace(/INR$/, 'USDT');
    const lag = [], bidOff = [], askOff = [], sameSizes = [], midRatio = [];
    let zebFrames = 0, matched = 0, sameE = 0;
    const bySpeed = {};
    for (const [k, zf] of zebByU) {
      if (!k.startsWith(sym + ':')) continue;
      zebFrames++;
      const bf = binByU.get(`${bsym}:${zf.d.u}`) ?? binByE.get(`${bsym}:${zf.d.E}`);
      if (!bf) continue;
      matched++;
      bySpeed[bf.speed] = (bySpeed[bf.speed] ?? 0) + 1;
      lag.push(zf.at - bf.at);
      if (zf.d.E === bf.d.E) sameE++;
      const zs = zf.d.b.map((l) => l[1]).sort().join(), bs = bf.d.b.map((l) => l[1]).sort().join();
      sameSizes.push(zs === bs);
      const zBidTop = Math.max(...zf.d.b.map((l) => Number(l[0]))), bBidTop = Math.max(...bf.d.b.map((l) => Number(l[0])));
      const zAskTop = Math.min(...zf.d.a.map((l) => Number(l[0]))), bAskTop = Math.min(...bf.d.a.map((l) => Number(l[0])));
      midRatio.push((zBidTop + zAskTop) / (bBidTop + bAskTop));
      if (sym === bsym) {
        bidOff.push(+(bBidTop - zBidTop).toFixed(8));
        askOff.push(+(zAskTop - bAskTop).toFixed(8));
      }
    }
    log('relay', {
      sym, zebFrames, binanceFrames: [...binByU.keys()].filter((k) => k.startsWith(bsym + ':')).length, midRatio: midRatio.length ? [+Math.min(...midRatio).toFixed(4), +Math.max(...midRatio).toFixed(4)] : null, matchedByUorE: matched, matchedStream: bySpeed, sameE,
      binanceOwnRecvMinusE: Object.fromEntries(Object.entries(binLag).filter(([k]) => k.startsWith(bsym)).map(([k, v]) => [k, { median: median(v), p90: pct(v, 0.9) }])),
      bidSizeMultisetEqual: sameSizes.filter(Boolean).length,
      zebMinusBinanceArrivalMs: { min: lag.length ? Math.min(...lag) : null, median: median(lag), p90: pct(lag, 0.9), max: lag.length ? Math.max(...lag) : null },
      bidTopMarkdown: Object.entries(bidOff.reduce((a, x) => { a[x] = (a[x] ?? 0) + 1; return a; }, {})),
      askTopMarkup: Object.entries(askOff.reduce((a, x) => { a[x] = (a[x] ?? 0) + 1; return a; }, {})),
    });
  }
  // Mark relay: the latest ZebPay mark frame next to Binance's premiumIndex read at the same moment.
  for (const p of premium) log('mark_vs_binance_rest', p);
}

async function batch() {
  const info = await pairsInfo();
  const act = await (await fetch(`${REST}/market/markets`)).json();
  const pairs = act.data.symbols.map((s) => s.symbol);
  const seen = new Map();
  let frames = 0, bytes = 0, parseUs = 0;
  const perSec = [];
  let secFrames = 0;
  const z = sio({
    onRaw: (text) => {
      if (!text.startsWith('42["depthUpdate"')) return;
      const t0 = performance.now();
      const [, d] = JSON.parse(text.slice(2));
      parseUs += (performance.now() - t0) * 1000;
      frames++; secFrames++; bytes += text.length;
      seen.set(d.s, (seen.get(d.s) ?? 0) + 1);
    },
  });
  await z.ready;
  const t = Date.now();
  z.emit('subscribe', { params: pairs.map((p) => `${p.toLowerCase()}@depth_${info.get(p).depthGrouping[0]}`) });
  const tick = setInterval(() => { perSec.push(secFrames); secFrames = 0; }, 1000);
  await sleep(40000);
  clearInterval(tick);
  const secs = (Date.now() - t) / 1000;
  z.ws.close();
  const counts = [...seen.values()];
  const silent = pairs.filter((p) => !seen.has(p));
  log('batch', {
    streams: pairs.length, delivering: seen.size, silent: silent.length, silentSample: silent.slice(0, 15), seconds: Math.round(secs),
    framesPerSec: Math.round(frames / secs), perSecMedian: median(perSec.slice(2)), perSecMax: Math.max(...perSec.slice(2)),
    kbPerSec: Math.round(bytes / secs / 1024), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: +(parseUs / frames).toFixed(1),
    framesPerStream: { min: Math.min(...counts), median: median(counts), max: Math.max(...counts) }, pings: z.pings, closed: z.closed,
  });
}

async function silence() {
  const a = sio({ answerPing: false });
  const b = sio({ answerPing: true });
  const c = sio({ join: false, answerPing: true });
  await sleep(90000);
  for (const [name, s] of [['no_pong_joined', a], ['pong_joined_no_subscribe', b], ['pong_not_joined', c]]) {
    log('silence', { name, handshake: s.handshake, pings: s.pings, events: s.events, closed: s.closed });
    if (s.ws.readyState === WebSocket.OPEN) s.ws.close();
  }
}

async function deflate() {
  const s = sio({ deflate: true });
  await s.ready;
  await sleep(2500);
  log('deflate', { extensions: s.extensions, events: s.events });
  s.ws.close();
}

async function engineway() {
  for (const url of ['wss://futuresws.zebpay.com', 'wss://futuresws.zebpay.com/socket.io/?EIO=3&transport=websocket']) {
    const res = await new Promise((resolve) => {
      const ws = new WebSocket(url, { perMessageDeflate: false });
      const frames = [];
      const out = { url };
      ws.on('unexpected-response', (req, r) => { out.status = r.statusCode; resolve(out); });
      ws.on('error', (e) => { out.error = e.message; resolve(out); });
      ws.on('open', () => { out.open = true; ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdt@depth_0.1'] })); });
      ws.on('message', (m) => frames.push(m.toString().slice(0, 200)));
      ws.on('close', (code) => { out.close = code; out.frames = frames; resolve(out); });
      setTimeout(() => { out.frames = frames; ws.close(); resolve(out); }, 4000);
    });
    log('engineway', res);
  }
  // A JSON frame on a joined Socket.IO socket, the only thing VenueFeed's subscribe path can send.
  let depth = 0;
  const s = sio({ onEvent: (name) => { if (name === 'depthUpdate') depth++; } });
  await s.ready;
  s.ws.send(JSON.stringify(['subscribe', { params: ['btcusdt@depth_0.1'] }]));
  await sleep(3000);
  log('engineway_json_on_sio', { depthEvents: depth, allEvents: s.events, closed: s.closed });
  s.ws.close();
}

const mode = process.argv[2] ?? 'book';
const run = { book, batch, silence, deflate, engineway }[mode];
if (!run) throw new Error(`unknown mode ${mode}`);
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
