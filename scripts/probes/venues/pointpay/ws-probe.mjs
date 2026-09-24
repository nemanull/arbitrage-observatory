// PointPay WebSocket probe: the futures socket the web terminal uses, next to Bybit linear on the same topics, plus errors, a batch of every listed perpetual, silence, deflate, and the documented spot socket.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/pointpay/ws-probe.mjs [book|errors|batch|silence|deflate|spot]
//   book     orderbook.50 on four perpetuals, orderbook.200 and orderbook.1 on BTCUSDT, and tickers.BTCUSDT on PointPay and on Bybit at once for 60 s: gaps, level order, and which socket saw each update first.
//   errors   unknown symbol, a Bybit perpetual PointPay does not list, unsupported depth, unknown op, duplicate subscribe, text that is not JSON. About 15 s.
//   batch    orderbook.50 on every listed PointPay perpetual over one socket for 30 s.
//   silence  one socket with nothing subscribed and one subscribed without pings, up to 120 s.
//   deflate  one socket that offers permessage-deflate and one that does not, printing what the server negotiates and the handshake headers.
//   spot     the documented spot socket URLs: open, server.ping, server.time and depth.subscribe on BTC_USDT. About 15 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/pointpay/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const PP_URL = 'wss://ws-futures.pointpay.io/v5/public/linear';
const BYBIT_URL = 'wss://stream.bybit.com/v5/public/linear';
const SPOT_URLS = ['wss://exchange.pointpay.io/ws', 'wss://ws.pointpay.io/', 'wss://ws.pointech.cloud/'];
const FAPI = 'https://api.pointpay.io/fapi/v1/public/trade';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const trim = (s, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url, { deflate = false, name = 'socket' } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: deflate, handshakeTimeout: 10_000 });
    const info = { ws, name, openMs: null, headers: null, closed: null, errors: [] };
    ws.on('upgrade', (res) => (info.headers = res.headers));
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        info.errors.push({ status: res.statusCode, body: trim(body, 200) });
        resolve(info);
      });
    });
    ws.on('open', () => {
      info.openMs = Date.now() - t0;
      resolve(info);
    });
    ws.on('error', (e) => {
      info.errors.push({ message: e.message });
      resolve(info);
    });
    ws.on('close', (code, reason) => (info.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }));
  });
}

const sub = (args, id) => JSON.stringify({ req_id: id, op: 'subscribe', args });

async function pairs() {
  const r = await fetch(`${FAPI}/pairs`);
  const j = await r.json();
  return j.response.map((p) => p.pair);
}

async function book() {
  const topics = ['orderbook.50.BTCUSDT', 'orderbook.50.ETHUSDT', 'orderbook.50.ALGOUSDT', 'orderbook.50.AAPLUSDT', 'orderbook.200.BTCUSDT', 'orderbook.1.BTCUSDT', 'tickers.BTCUSDT'];
  const sockets = { pp: await open(PP_URL, { name: 'pp' }), by: await open(BYBIT_URL, { name: 'by' }) };
  log('open', { pp: { ms: sockets.pp.openMs, errors: sockets.pp.errors, server: sockets.pp.headers?.server, cfRay: sockets.pp.headers?.['cf-ray'] }, by: { ms: sockets.by.openMs, errors: sockets.by.errors } });
  if (!sockets.pp.openMs) return;
  const seen = { pp: new Map(), by: new Map() }; // `${topic}#${u}` to arrival ms
  const st = {};
  const pongs = { pp: [], by: [] };
  const firstFrames = {};
  let pingSentAt = {};
  for (const [k, s] of Object.entries(sockets)) {
    s.ws.on('message', (raw) => {
      const now = Date.now();
      const text = raw.toString();
      const m = JSON.parse(text);
      if (m.op === 'ping' || m.ret_msg === 'pong' || m.op === 'pong') {
        pongs[k].push({ rtt: now - (pingSentAt[k] ?? now), frame: trim(text, 200) });
        if (k === 'pp') capture('pp-control.jsonl', text);
        return;
      }
      if (m.op === 'subscribe') {
        log('ack', { socket: k, frame: trim(text, 300) });
        if (k === 'pp') capture('pp-control.jsonl', text);
        return;
      }
      if (!m.topic) {
        log('other', { socket: k, frame: trim(text, 300) });
        return;
      }
      const key = `${k}|${m.topic}`;
      const s = (st[key] ??= { frames: 0, snapshots: 0, deltas: 0, gaps: 0, emptyDeltas: 0, lastU: null, deltaBidsUnordered: 0, deltaAsksUnordered: 0, snapBidsDesc: null, snapAsksAsc: null, maxLevels: [0, 0], book: { b: new Map(), a: new Map() }, bytes: 0, lastArrival: null, maxGapMs: 0, repeatU: 0 });
      s.frames++;
      s.bytes += text.length;
      if (s.lastArrival) s.maxGapMs = Math.max(s.maxGapMs, now - s.lastArrival);
      s.lastArrival = now;
      if (!firstFrames[key]) {
        firstFrames[key] = true;
        if (k === 'pp') capture('pp-first-frames.jsonl', JSON.stringify(m.data?.b ? { ...m, data: { ...m.data, b: m.data.b.slice(0, 3), a: m.data.a.slice(0, 3) } } : m)); // first three levels per side
      }
      if (m.topic.startsWith('orderbook.')) {
        const d = m.data;
        const u = d.u;
        seen[k].set(`${m.topic}#${u}`, now);
        if (u === s.lastU) s.repeatU++; // a frame that repeats the previous update id
        if (m.type === 'snapshot') {
          s.snapshots++;
          s.book.b = new Map(d.b);
          s.book.a = new Map(d.a);
          s.snapBidsDesc = d.b.every((l, i) => i === 0 || Number(l[0]) < Number(d.b[i - 1][0]));
          s.snapAsksAsc = d.a.every((l, i) => i === 0 || Number(l[0]) > Number(d.a[i - 1][0]));
        } else {
          s.deltas++;
          if (s.lastU !== null && u !== s.lastU + 1) s.gaps++;
          if (d.b.length === 0 && d.a.length === 0) s.emptyDeltas++;
          if (!d.b.every((l, i) => i === 0 || Number(l[0]) < Number(d.b[i - 1][0]))) s.deltaBidsUnordered++;
          if (!d.a.every((l, i) => i === 0 || Number(l[0]) > Number(d.a[i - 1][0]))) s.deltaAsksUnordered++;
          for (const [p, q] of d.b) (q === '0' ? s.book.b.delete(p) : s.book.b.set(p, q));
          for (const [p, q] of d.a) (q === '0' ? s.book.a.delete(p) : s.book.a.set(p, q));
          if (k === 'pp' && s.deltas <= 2) capture('pp-deltas.jsonl', trim(text, 1500));
        }
        s.maxLevels = [Math.max(s.maxLevels[0], s.book.b.size), Math.max(s.maxLevels[1], s.book.a.size)];
        s.lastU = u;
      } else if (k === 'pp' && s.frames <= 3) {
        capture('pp-tickers.jsonl', trim(text, 1500));
      }
    });
    s.ws.send(sub(topics, `probe-${k}`));
  }
  const ping = setInterval(() => {
    for (const [k, s] of Object.entries(sockets)) {
      pingSentAt[k] = Date.now();
      s.ws.send(JSON.stringify({ req_id: `ping-${k}`, op: 'ping' }));
    }
  }, 20_000);
  await sleep(60_000);
  clearInterval(ping);
  for (const s of Object.values(sockets)) s.ws.close();
  for (const [key, s] of Object.entries(st)) {
    const { book: _b, lastArrival: _l, ...rest } = s;
    log('stream', { key, ...rest });
  }
  // which socket delivered the same update first
  for (const t of topics.filter((x) => x.startsWith('orderbook.'))) {
    const lead = [];
    let onlyPp = 0;
    for (const [id, at] of seen.pp) {
      if (!id.startsWith(`${t}#`)) continue;
      const b = seen.by.get(id);
      if (b === undefined) onlyPp++;
      else lead.push(at - b);
    }
    lead.sort((a, b) => a - b);
    const q = (p) => lead[Math.min(lead.length - 1, Math.floor(p * lead.length))];
    log('pp_minus_bybit_arrival_ms', { topic: t, matched: lead.length, onlyOnPointPay: onlyPp, min: lead[0], median: q(0.5), p90: q(0.9), max: lead[lead.length - 1] });
  }
  log('pongs', { pp: pongs.pp, by: pongs.by.map((p) => p.rtt) });
  log('closed', { pp: sockets.pp.closed, by: sockets.by.closed });
}

async function errors() {
  const list = await pairs();
  const byt = await (await fetch('https://api.bybit.com/v5/market/tickers?category=linear')).json();
  const listed = new Set(list);
  const unlisted = byt.result.list.filter((t) => t.symbol.endsWith('USDT') && !listed.has(t.symbol)).sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h))[0]?.symbol;
  const s = await open(PP_URL);
  log('open', { ms: s.openMs, errors: s.errors });
  if (!s.openMs) return;
  const got = [];
  s.ws.on('message', (raw) => {
    const t = raw.toString();
    const m = JSON.parse(t);
    got.push({ at: Date.now(), topic: m.topic, type: m.type, frame: m.topic ? undefined : trim(t, 300) });
  });
  const cases = [
    ['unknown_symbol', sub(['orderbook.50.NOPEUSDT'], 'e1')],
    [`bybit_perp_not_listed_${unlisted}`, sub([`orderbook.50.${unlisted}`], 'e2')],
    ['unsupported_depth', sub(['orderbook.30.BTCUSDT'], 'e3')],
    ['lowercase_symbol', sub(['orderbook.50.btcusdt'], 'e4')],
    ['valid_once', sub(['orderbook.1.ETHUSDT'], 'e5')],
    ['duplicate', sub(['orderbook.1.ETHUSDT'], 'e6')],
    ['unknown_op', JSON.stringify({ req_id: 'e7', op: 'nope', args: [] })],
    ['not_json', 'hello'],
    ['private_topic_on_public_socket', sub(['order'], 'e8')],
  ];
  for (const [name, frame] of cases) {
    const from = got.length;
    s.ws.send(frame);
    await sleep(1500);
    const replies = got.slice(from);
    const topics = {};
    for (const r of replies) if (r.topic) topics[r.topic] = (topics[r.topic] ?? 0) + 1;
    log('case', { name, sent: trim(frame, 120), control: replies.filter((r) => !r.topic).map((r) => r.frame), topicFrames: topics });
  }
  await sleep(3000);
  const late = {};
  for (const r of got) if (r.topic) late[r.topic] = (late[r.topic] ?? 0) + 1;
  log('topics_after_all_cases', { late, closed: s.closed });
  s.ws.close();
}

async function batch() {
  const list = await pairs();
  const s = await open(PP_URL);
  log('open', { ms: s.openMs, errors: s.errors, markets: list.length });
  if (!s.openMs) return;
  const st = new Map();
  let frames = 0;
  let bytes = 0;
  const acks = [];
  const perSecond = [];
  let secFrames = 0;
  let parseUs = 0;
  const t0 = Date.now();
  s.ws.on('message', (raw) => {
    const text = raw.toString();
    const p0 = performance.now();
    const m = JSON.parse(text);
    parseUs += (performance.now() - p0) * 1000;
    if (m.op === 'subscribe') {
      acks.push({ success: m.success, ret_msg: m.ret_msg, at: Date.now() - t0 });
      return;
    }
    if (!m.topic) return;
    frames++;
    secFrames++;
    bytes += text.length;
    const x = st.get(m.topic) ?? { snap: 0, delta: 0, gaps: 0, lastU: null, firstAt: null };
    if (m.type === 'snapshot') {
      x.snap++;
      x.firstAt ??= Date.now() - t0;
    } else {
      x.delta++;
      if (x.lastU !== null && m.data.u !== x.lastU + 1) x.gaps++;
    }
    x.lastU = m.data.u;
    st.set(m.topic, x);
  });
  const tick = setInterval(() => {
    perSecond.push(secFrames);
    secFrames = 0;
  }, 1000);
  const topics = list.map((p) => `orderbook.50.${p}`);
  for (let i = 0; i < topics.length; i += 10) s.ws.send(sub(topics.slice(i, i + 10), `b${i}`));
  const ping = setInterval(() => s.ws.send(JSON.stringify({ op: 'ping' })), 20_000);
  await sleep(30_000);
  clearInterval(tick);
  clearInterval(ping);
  s.ws.close();
  const vals = [...st.values()];
  const firsts = vals.map((v) => v.firstAt).filter((v) => v !== null).sort((a, b) => a - b);
  const ps = [...perSecond].sort((a, b) => a - b);
  log('batch', { subscribeFrames: Math.ceil(topics.length / 10), acks: acks.length, ackFailures: acks.filter((a) => !a.success).map((a) => a.ret_msg), streamsWithSnapshot: vals.filter((v) => v.snap > 0).length, silentStreams: list.filter((p) => !st.has(`orderbook.50.${p}`)).slice(0, 20), snapshotsTotal: vals.reduce((a, v) => a + v.snap, 0), deltas: vals.reduce((a, v) => a + v.delta, 0), gaps: vals.reduce((a, v) => a + v.gaps, 0), lastSnapshotAtMs: firsts[firsts.length - 1], framesPerSecond: { median: ps[Math.floor(ps.length / 2)], max: ps[ps.length - 1], mean: Math.round(frames / 30) }, bytesPerSecond: Math.round(bytes / 30), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Math.round((parseUs / frames) * 10) / 10, closed: s.closed });
}

async function silence() {
  const idle = await open(PP_URL, { name: 'idle' });
  const quiet = await open(PP_URL, { name: 'subscribed_no_ping' });
  let quietFrames = 0;
  let lastQuiet = null;
  let maxQuietGap = 0;
  quiet.ws.on('message', (raw) => {
    const now = Date.now();
    const m = JSON.parse(raw.toString());
    if (!m.topic) return;
    quietFrames++;
    if (lastQuiet) maxQuietGap = Math.max(maxQuietGap, now - lastQuiet);
    lastQuiet = now;
  });
  let idlePings = 0;
  idle.ws.on('ping', () => idlePings++);
  let quietPings = 0;
  quiet.ws.on('ping', () => quietPings++);
  quiet.ws.send(sub(['orderbook.50.AAPLUSDT'], 'q1'));
  const end = Date.now() + 120_000;
  while (Date.now() < end && (!idle.closed || !quiet.closed)) await sleep(1000);
  log('silence', { idle: { closed: idle.closed, serverPings: idlePings }, subscribedNoPing: { closed: quiet.closed, serverPings: quietPings, frames: quietFrames, maxGapMs: maxQuietGap } });
  idle.ws.terminate();
  quiet.ws.terminate();
}

async function deflate() {
  for (const d of [true, false]) {
    const s = await open(PP_URL, { deflate: d });
    log('deflate', { offered: d, openMs: s.openMs, extensions: s.headers?.['sec-websocket-extensions'] ?? null, server: s.headers?.server, cfRay: s.headers?.['cf-ray'], errors: s.errors });
    s.ws.close();
    await sleep(500);
  }
}

async function spot() {
  for (const url of SPOT_URLS) {
    const s = await open(url);
    const replies = [];
    if (s.openMs) {
      s.ws.on('message', (raw) => replies.push({ at: Date.now(), frame: trim(raw.toString(), 200) }));
      const t0 = Date.now();
      s.ws.send(JSON.stringify({ method: 'server.ping', params: [], id: 1 }));
      s.ws.send(JSON.stringify({ method: 'server.time', params: [], id: 2 }));
      s.ws.send(JSON.stringify({ method: 'depth.subscribe', params: ['BTC_USDT', 20, '0'], id: 3 }));
      await sleep(4000);
      log('spot', { url, openMs: s.openMs, replies: replies.slice(0, 4).map((r) => ({ ms: r.at - t0, frame: r.frame })), frames: replies.length, localNow: Date.now() });
      s.ws.close();
    } else {
      log('spot', { url, errors: s.errors });
    }
  }
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, deflate, spot };
log('mode', { mode, at: new Date().toISOString() });
await modes[mode]();
process.exit(0);
