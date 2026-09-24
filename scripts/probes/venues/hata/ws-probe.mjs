// Hata public WebSocket probe: the depth channel on both platforms, subscribe and error shapes, history and recovery, ping and silence, and compression.
// Public, unauthenticated, read-only. The only POST is the documented public token call, which needs no account. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hata/ws-probe.mjs [book|errors|silence|deflate|lag|twin]
//   book     depth on every pair of the global and the Malaysia platform, and trade and the undocumented ticker on two pairs, for 60 s, with a REST book compare at the end.
//   errors   channel name forms, unknown and wrong-platform symbols, a double subscribe, history, recovery, bad JSON, and connect without or with a wrong token. About 85 s.
//   silence  one socket that connects and never answers the server ping, one that never sends connect, for up to 100 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   lag      the busiest Malaysia pair's depth alone, then beside every pair, 30 s each, matched against REST book reads every 2 s. About 100 s.
//   twin     two sockets with every Malaysia depth channel, opened together, for 25 s, to tell a per socket ceiling from a per host one.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/hata/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const API = 'https://api.hata.io'; // global REST, and every /auth call for both platforms
const PLATFORMS = {
  ww: { ws: 'wss://websocket.hata.io/sapi/connection/websocket', rest: 'https://api.hata.io', token: '/auth/api/v2/ww/user-stream-key' },
  my: { ws: 'wss://websocket-my.hata.io/sapi/connection/websocket', rest: 'https://my-api.hata.io', token: '/auth/api/v2/my/user-stream-key' },
};
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();
const since = () => Date.now() - t0;
const capCount = new Map();

function capture(name, text, cap = 400) {
  if (!OUT) return;
  const n = (capCount.get(name) ?? 0) + 1;
  capCount.set(name, n);
  if (n > cap) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), `${Date.now()} ${text.slice(0, 4000)}\n`);
}

async function token(platform) {
  const res = await fetch(API + PLATFORMS[platform].token, { method: 'POST' });
  const body = await res.json();
  const claims = JSON.parse(Buffer.from(body.data.token.split('.')[1], 'base64url').toString());
  return { status: res.status, token: body.data.token, expiry: body.data.expiry, claims };
}

async function pairs(platform) {
  const res = await fetch(PLATFORMS[platform].rest + '/orderbook/api/v2/exchange-info');
  const body = await res.json();
  return body.data.map((p) => ({ id: p.txpair, quoteVolume: Number(p.quote_volume) }));
}

// One socket with Centrifugo framing: several JSON messages may share a frame, split on newline.
function open(url, { deflate = false, answerPing = true, name } = {}) {
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const s = { ws, name, opened: null, closed: null, pings: [], messages: [], handlers: [], frames: 0, bytes: 0, multi: 0, created: Date.now() };
  ws.on('upgrade', (res) => { s.extensions = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('open', () => { s.opened = Date.now(); });
  ws.on('ping', () => { s.protocolPings = (s.protocolPings ?? 0) + 1; });
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    s.frames++;
    s.bytes += raw.length;
    const parts = text.split('\n').filter((p) => p.length > 0);
    if (parts.length > 1) s.multi++;
    for (const part of parts) {
      const at = Date.now();
      let msg;
      try { msg = JSON.parse(part); } catch { log('unparsed', { name, part: part.slice(0, 200) }); continue; }
      capture(`${name}.jsonl`, part);
      if (Object.keys(msg).length === 0) {
        s.pings.push(at - s.created);
        if (answerPing) ws.send('{}');
        continue;
      }
      s.messages.push({ at, msg });
      for (const h of s.handlers) h(msg, at);
    }
  });
  ws.on('close', (code, reason) => { s.closed = { at: Date.now() - s.created, code, reason: reason.toString() }; });
  ws.on('error', (e) => { s.error = e.message; });
  return s;
}

function waitOpen(s, ms = 20_000) {
  return new Promise((resolve) => {
    if (s.opened) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    s.ws.once('open', () => { clearTimeout(t); resolve(true); });
    s.ws.once('close', () => { clearTimeout(t); resolve(false); });
  });
}

let nextId = 1;
function request(s, body, ms = 5_000) {
  const id = nextId++;
  const sentAt = Date.now();
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ id, timeout: true }), ms);
    s.handlers.push((msg, at) => {
      if (msg.id === id) { clearTimeout(t); resolve({ id, ms: at - sentAt, reply: msg }); }
    });
    s.ws.send(JSON.stringify({ id, ...body }));
  });
}

const trim = (o, n = 600) => JSON.stringify(o).slice(0, n);
const lvl = (l) => [Number(l.price), Number(l.qty)];

function orderOf(levels, desc) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price), b = Number(levels[i].price);
    if (desc ? b > a : b < a) return 'unordered';
    if (a === b) return 'duplicate';
  }
  return desc ? 'descending' : 'ascending';
}

async function book() {
  const summary = {};
  for (const platform of ['ww', 'my']) {
    const tk = await token(platform);
    log('token', { platform, status: tk.status, expiry: tk.expiry, claims: tk.claims, ttlSec: Number(tk.claims.exp) - Math.floor(Date.now() / 1000) });
    const list = (await pairs(platform)).sort((a, b) => b.quoteVolume - a.quoteVolume);
    const s = open(PLATFORMS[platform].ws, { name: `book-${platform}` });
    const ok = await waitOpen(s);
    log('open', { platform, ok, ms: ok ? s.opened - s.created : null, error: s.error, closed: s.closed });
    if (!ok) { s.ws.terminate(); continue; }
    const conn = await request(s, { connect: { token: tk.token, name: 'probe' } });
    log('connect', { platform, ms: conn.ms, reply: conn.reply });
    const stats = new Map();
    s.handlers.push((msg, at) => {
      const push = msg.push;
      if (!push?.pub) return;
      const ch = push.channel;
      const st = stats.get(ch) ?? { n: 0, gaps: 0, lastOffset: null, offsets: [], first: null, bidsMax: 0, asksMax: 0, bidsMin: 1e9, asksMin: 1e9, order: new Set(), crossed: 0, repeats: 0, last: null, tsLagMs: [], empty: 0, oneSided: 0, events: new Set() };
      stats.set(ch, st);
      st.n++;
      if (st.first === null) st.first = at;
      const off = push.pub.offset;
      if (st.lastOffset !== null && off !== st.lastOffset + 1) st.gaps++;
      st.lastOffset = off;
      if (st.offsets.length < 5) st.offsets.push(off);
      const d = push.pub.data;
      st.events.add(d?.event_name);
      if (typeof d?.ts === 'number') st.tsLagMs.push(at - d.ts * (d.ts < 1e12 ? 1000 : 1));
      if (ch.endsWith('@depth')) {
        const bids = d.data?.bids ?? [], asks = d.data?.asks ?? [];
        st.bidsMax = Math.max(st.bidsMax, bids.length); st.asksMax = Math.max(st.asksMax, asks.length);
        st.bidsMin = Math.min(st.bidsMin, bids.length); st.asksMin = Math.min(st.asksMin, asks.length);
        st.order.add(`bids ${orderOf(bids, true)}`); st.order.add(`asks ${orderOf(asks, false)}`);
        if (bids.length && asks.length && Number(bids[0].price) >= Number(asks[0].price)) st.crossed++;
        if (!bids.length && !asks.length) st.empty++;
        else if (!bids.length || !asks.length) st.oneSided++;
        const key = JSON.stringify(d.data);
        if (key === st.last) st.repeats++;
        st.last = key;
        st.lastBook = d.data;
        st.lastKeys = Object.keys(d.data ?? {});
      } else {
        st.sample = trim(d, 300);
      }
    });
    const channels = list.map((p) => `public:${p.id}@depth`).concat(list.slice(0, 2).flatMap((p) => [`public:${p.id}@trade`, `public:${p.id}@ticker`]));
    // Every subscribe goes in one frame, joined by newlines, which the documentation allows.
    const sentAt = Date.now();
    const ids = channels.map(() => nextId++);
    const acks = new Map();
    s.handlers.push((msg, at) => { if (ids.includes(msg.id)) acks.set(msg.id, { ms: at - sentAt, reply: msg }); });
    s.ws.send(channels.map((ch, i) => JSON.stringify({ id: ids[i], subscribe: { channel: ch } })).join('\n'));
    await sleep(3_000);
    const ackList = ids.map((id, i) => ({ ch: channels[i], ...(acks.get(id) ?? { missing: true }) }));
    log('acks', { platform, sent: channels.length, acked: ackList.filter((a) => !a.missing && !a.reply.error).length, errors: ackList.filter((a) => a.reply?.error).map((a) => ({ ch: a.ch, e: a.reply.error })), ackMs: ackList.filter((a) => a.ms).map((a) => a.ms).sort((a, b) => a - b).filter((_, i, arr) => i === 0 || i === arr.length - 1), sample: trim(ackList[0].reply, 400), withPublications: ackList.filter((a) => a.reply?.subscribe?.publications?.length).length });
    summary[platform] = { s, stats, channels, sentAt, ackList, list };
  }
  await sleep(57_000);
  for (const platform of Object.keys(summary)) {
    const { s, stats, channels, sentAt, list, ackList } = summary[platform];
    for (const ch of channels) {
      const st = stats.get(ch);
      const ackOffset = ackList.find((a) => a.ch === ch)?.reply?.subscribe?.offset ?? null;
      if (!st) { log('channel', { platform, ch, pushes: 0, ackOffset }); continue; }
      const lags = st.tsLagMs.sort((a, b) => a - b);
      log('channel', { platform, ch, pushes: st.n, gaps: st.gaps, ackOffset, firstIsAckPlusOne: ackOffset !== null && st.offsets[0] === ackOffset + 1, firstOffsets: st.offsets, lastOffset: st.lastOffset, firstPushAfterSubMs: st.first - sentAt, events: [...st.events], bids: [st.bidsMin, st.bidsMax], asks: [st.asksMin, st.asksMax], order: [...st.order], crossed: st.crossed, repeats: st.repeats, empty: st.empty, oneSided: st.oneSided, tsLagMs: lags.length ? [lags[0], lags[lags.length >> 1], lags[lags.length - 1]] : null, keys: st.lastKeys, sample: st.sample });
    }
    // REST compare on the busiest pair of the platform, top ten levels a side.
    const top = list[0].id;
    const st = stats.get(`public:${top}@depth`);
    const res = await fetch(`${PLATFORMS[platform].rest}/orderbook/api/orderbook?pair_name=${top}`);
    const rest = (await res.json()).data;
    if (st?.lastBook) {
      const same = (a, b) => a.slice(0, 10).map(lvl).filter((l, i) => b[i] && l[0] === Number(b[i].price) && l[1] === Number(b[i].qty)).length;
      log('restCompare', { platform, pair: top, wsLevels: [st.lastBook.bids.length, st.lastBook.asks.length], restLevels: [rest.bids.length, rest.asks.length], bidsTop10Equal: same(st.lastBook.bids, rest.bids), asksTop10Equal: same(st.lastBook.asks, rest.asks), wsTouch: [st.lastBook.bids[0], st.lastBook.asks[0]], restTouch: [rest.bids[0], rest.asks[0]] });
    }
    log('session', { platform, frames: s.frames, bytes: s.bytes, multiMessageFrames: s.multi, serverPingsAtMs: s.pings, protocolPings: s.protocolPings ?? 0, closed: s.closed, extensions: s.extensions });
    s.ws.close();
  }
  await sleep(500);
}

async function errors() {
  const tk = await token('ww');
  const s = open(PLATFORMS.ww.ws, { name: 'errors' });
  await waitOpen(s);
  const before = await request(s, { subscribe: { channel: 'public:BTCUSDT@depth' } });
  log('beforeConnect', { reply: before.reply ?? 'timeout', closed: s.closed });
  let e = s;
  if (s.closed) {
    e = open(PLATFORMS.ww.ws, { name: 'errors2' });
    await waitOpen(e);
  }
  const conn = await request(e, { connect: { token: tk.token } });
  log('connect', { ms: conn.ms, reply: conn.reply });
  const cases = [
    'public:NOPEUSDT@depth', 'BTCUSDT@depth', 'public:btcusdt@depth', 'public:BTC_USDT@depth', 'public:BTCMYR@depth',
    'private:123456', 'public:BTCUSDT@ticker', 'public:BTCUSDT@depth20', 'public:BTCUSDT@candles_1', 'public:BTCUSDT@candles_1D', 'public:BTCUSDT@depth',
  ];
  let acked = null;
  for (const ch of cases) {
    const r = await request(e, { subscribe: { channel: ch } });
    if (ch === 'public:BTCUSDT@depth') acked = r.reply?.subscribe;
    log('subscribe', { ch, ms: r.ms, reply: r.timeout ? 'timeout' : trim(r.reply, 400) });
  }
  const twice = await request(e, { subscribe: { channel: 'public:BTCUSDT@depth' } });
  log('subscribeTwice', { reply: twice.timeout ? 'timeout' : trim(twice.reply, 300) });
  const hist = await request(e, { history: { channel: 'public:BTCUSDT@depth', limit: 1, reverse: true } });
  log('history', { reply: hist.timeout ? 'timeout' : trim(hist.reply, 800) });
  const hist0 = await request(e, { history: { channel: 'public:BTCUSDT@depth', limit: 0 } });
  log('historyTop', { reply: hist0.timeout ? 'timeout' : trim(hist0.reply, 400) });
  const pres = await request(e, { presence_stats: { channel: 'public:BTCUSDT@depth' } });
  log('presenceStats', { reply: pres.timeout ? 'timeout' : trim(pres.reply, 300) });
  // Recovery: leave the channel and come back asking for everything since an older offset.
  await request(e, { unsubscribe: { channel: 'public:BTCUSDT@depth' } });
  if (acked) {
    const rec = await request(e, { subscribe: { channel: 'public:BTCUSDT@depth', recover: true, epoch: acked.epoch, offset: Math.max(0, acked.offset - 3) } });
    const sub = rec.reply?.subscribe;
    log('recover', { askedFrom: Math.max(0, acked.offset - 3), reply: rec.timeout ? 'timeout' : { recovered: sub?.recovered, recoverable: sub?.recoverable, epoch: sub?.epoch, offset: sub?.offset, publications: sub?.publications?.map((p) => ({ offset: p.offset, bids: p.data?.data?.bids?.length, asks: p.data?.data?.asks?.length })), error: rec.reply?.error } });
    await request(e, { unsubscribe: { channel: 'public:BTCUSDT@depth' } });
    const bad = await request(e, { subscribe: { channel: 'public:BTCUSDT@depth', recover: true, epoch: 'nope', offset: 1 } });
    log('recoverWrongEpoch', { reply: bad.timeout ? 'timeout' : trim(bad.reply, 400) });
  }
  e.ws.send('not json');
  await sleep(4_000);
  log('badJson', { closed: e.closed, lastMessage: trim(e.messages.at(-1)?.msg ?? null, 200) });
  e.ws.close();

  // Connect variants on fresh sockets.
  const variants = [
    ['noToken', { connect: {} }, PLATFORMS.ww.ws],
    ['garbageToken', { connect: { token: 'abc' } }, PLATFORMS.ww.ws],
    ['myTokenOnGlobal', { connect: { token: (await token('my')).token } }, PLATFORMS.ww.ws],
  ];
  for (const [name, body, url] of variants) {
    const v = open(url, { name: `connect-${name}` });
    await waitOpen(v);
    const r = await request(v, body, 4_000);
    await sleep(500);
    log('connectVariant', { name, reply: r.timeout ? 'timeout' : trim(r.reply, 300), closed: v.closed });
    if (!r.timeout && !r.reply.error && !v.closed) {
      const sub = await request(v, { subscribe: { channel: 'public:BTCMYR@depth' } }, 4_000);
      await sleep(2_000);
      log('connectVariantSub', { name, reply: sub.timeout ? 'timeout' : trim(sub.reply, 300), pushes: v.messages.filter((m) => m.msg.push).length });
    }
    v.ws.close();
  }
  await sleep(300);
}

async function silence() {
  const tk = await token('ww');
  const mute = open(PLATFORMS.ww.ws, { name: 'mute', answerPing: false });
  const silent = open(PLATFORMS.ww.ws, { name: 'noconnect' });
  await Promise.all([waitOpen(mute), waitOpen(silent)]);
  const c = await request(mute, { connect: { token: tk.token } });
  await request(mute, { subscribe: { channel: 'public:BTCUSDT@depth' } });
  log('silenceStart', { connect: c.reply?.connect });
  const end = Date.now() + 100_000;
  while (Date.now() < end && !(mute.closed && silent.closed)) await sleep(500);
  for (const s of [mute, silent]) {
    log('silence', { name: s.name, serverPingsAtMs: s.pings, protocolPings: s.protocolPings ?? 0, closed: s.closed, pushes: s.messages.filter((m) => m.msg.push).length, lastMessage: trim(s.messages.at(-1)?.msg ?? null, 300) });
    if (!s.closed) s.ws.close();
  }
  await sleep(300);
}

// Delivery delay of the depth channel: the busiest Malaysia pair alone, then beside every other pair, each for 30 s, matched against REST reads every 2 s.
async function lag() {
  const list = (await pairs('my')).sort((a, b) => b.quoteVolume - a.quoteVolume);
  const top = list[0].id;
  const key = (book) => JSON.stringify([book.bids.slice(0, 5), book.asks.slice(0, 5)].map((side) => side.map((l) => [Number(l.price), Number(l.qty)])));
  for (const phase of ['alone', 'all']) {
    const tk = await token('my');
    const s = open(PLATFORMS.my.ws, { name: `lag-${phase}` });
    if (!(await waitOpen(s))) { log('lagOpen', { phase, error: s.error, closed: s.closed }); s.ws.terminate(); continue; }
    await request(s, { connect: { token: tk.token } });
    const frames = [];
    let bytes = 0;
    s.handlers.push((msg, at) => {
      const pub = msg.push?.pub;
      if (!pub) return;
      bytes += JSON.stringify(msg).length;
      if (msg.push.channel === `public:${top}@depth`) frames.push({ at, ts: pub.data.ts, offset: pub.offset, key: key(pub.data.data) });
    });
    const channels = phase === 'alone' ? [top] : list.map((p) => p.id);
    const subAt = Date.now();
    s.ws.send(channels.map((id) => JSON.stringify({ id: nextId++, subscribe: { channel: `public:${id}@depth` } })).join('\n'));
    const reads = [];
    const end = subAt + 30_000;
    while (Date.now() < end) {
      const a = Date.now();
      const res = await fetch(`${PLATFORMS.my.rest}/orderbook/api/orderbook?pair_name=${top}`);
      const body = await res.json();
      const b = Date.now();
      reads.push({ mid: (a + b) / 2, rtt: b - a, key: key(body.data) });
      await sleep(Math.max(0, 2_000 - (Date.now() - a)));
    }
    await sleep(15_000); // let a lagging socket catch up with the last reads
    const delays = [];
    let unmatched = 0;
    for (const r of reads) {
      const f = frames.find((x) => x.key === r.key && x.at >= r.mid - 5_000);
      if (f) delays.push(Math.round(f.at - r.mid)); else unmatched++;
    }
    const tsLag = frames.map((f) => f.at - f.ts * 1000);
    const pick = (arr, q) => { const v = [...arr].sort((x, y) => x - y); return v.length ? v[Math.floor(q * (v.length - 1))] : null; };
    const byTenS = [0, 1, 2, 3, 4].map((k) => frames.filter((f) => f.at - subAt >= k * 10_000 && f.at - subAt < (k + 1) * 10_000).map((f) => f.at - f.ts * 1000)).map((a) => pick(a, 0.5));
    log('lag', { phase, pair: top, channels: channels.length, frames: frames.length, bytesPerSec: Math.round(bytes / 45), restReads: reads.length, restRttMedian: pick(reads.map((r) => r.rtt), 0.5), matched: delays.length, unmatched, restToWsDelayMs: delays, tsLagMs: { min: pick(tsLag, 0), median: pick(tsLag, 0.5), max: pick(tsLag, 1) }, tsLagMedianPer10s: byTenS, gaps: frames.filter((f, i) => i > 0 && f.offset !== frames[i - 1].offset + 1).length });
    s.ws.close();
  }
  await sleep(300);
}

// Whether the delivery ceiling is per socket or per host: two sockets with every Malaysia depth channel, opened together, for 25 s.
async function twin() {
  const list = (await pairs('my')).map((p) => p.id);
  const socks = [];
  for (const name of ['twin-a', 'twin-b']) {
    const tk = await token('my');
    socks.push({ s: open(PLATFORMS.my.ws, { name }), tk, bytes: 0, frames: 0, lags: [] });
  }
  await Promise.all(socks.map((x) => waitOpen(x.s)));
  for (const x of socks) {
    if (!x.s.opened) { log('twinOpen', { name: x.s.name, error: x.s.error }); continue; }
    await request(x.s, { connect: { token: x.tk.token } });
    x.s.handlers.push((msg, at) => {
      if (!msg.push?.pub) return;
      x.frames++;
      x.bytes += JSON.stringify(msg).length;
      x.lags.push(at - msg.push.pub.data.ts * 1000);
    });
  }
  const start = Date.now();
  for (const x of socks) if (x.s.opened) x.s.ws.send(list.map((id) => JSON.stringify({ id: nextId++, subscribe: { channel: `public:${id}@depth` } })).join('\n'));
  await sleep(25_000);
  const secs = (Date.now() - start) / 1000;
  for (const x of socks) {
    const v = [...x.lags].sort((a, b) => a - b);
    log('twin', { name: x.s.name, frames: x.frames, bytesPerSec: Math.round(x.bytes / secs), tsLagMs: v.length ? { min: v[0], median: v[v.length >> 1], max: v[v.length - 1] } : null });
    x.s.ws.close();
  }
  await sleep(300);
}

async function deflate() {
  const s = open(PLATFORMS.ww.ws, { deflate: true, name: 'deflate' });
  const ok = await waitOpen(s);
  log('deflate', { ok, offered: 'permessage-deflate', negotiated: s.extensions });
  s.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, silence, deflate, lag, twin };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, ms: since() });
process.exit(0);
