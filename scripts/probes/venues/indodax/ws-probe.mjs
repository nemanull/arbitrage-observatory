// Indodax market data WebSocket probe (Centrifugo on wss://ws3.indodax.com/ws/): book cadence and levels, offsets, level order, size unit, keepalive, silence, errors, recovery, and a batch on one connection.
// Public, unauthenticated, read-only. The connect token is the static one printed in the official docs for everyone, not an account credential.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/indodax/ws-probe.mjs [book|errors|seed|batch|silence|deflate]
//   book     order book on six pairs plus the other public channels for 45 s, then a REST depth compare. About 50 s.
//   errors   subscribe before connect, unknown and misspelled channels, a duplicate, non-JSON, newline batching, recovery from an offset, a bad token, the alternate URL. About 25 s.
//   seed     reads the last book of five pairs from the channel history by recovering from one offset back, and compares it with REST. About 15 s.
//   batch    order book on 150 pairs over one connection for 45 s, each subscribe in its own frame.
//   silence  five sockets that differ only in what the client sends or answers, for up to 110 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/indodax/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://ws3.indodax.com/ws/';
const ALT_URL_WS = 'wss://indodax.com/ws/';
const API = 'https://indodax.com';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE5NDY2MTg0MTV9.UR1lBM6Eqh0yWz-PVirw1uPCxe60FdchR8eNVdsskeo';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), (text.length > 2000 ? `${text.slice(0, 1500)} … ${text.slice(-300)}` : text) + '\n');
}

function stats(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s.at(-1) };
}

// Opens a socket and resolves once it is open, recording every frame with its arrival time.
function open(url, { deflate = false, name = 'ws', autoPong = true } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: deflate, autoPong });
    const conn = { ws, t0, name, frames: [], pings: [], closed: null, upgrade: null, openMs: null };
    ws.on('upgrade', (res) => (conn.upgrade = { status: res.statusCode, server: res.headers.server, via: res.headers.via, ext: res.headers['sec-websocket-extensions'] ?? null }));
    ws.on('open', () => {
      conn.openMs = Date.now() - t0;
      resolve(conn);
    });
    ws.on('ping', () => conn.pings.push(Date.now() - t0));
    ws.on('message', (data, isBinary) => {
      const at = Date.now();
      const text = data.toString('utf8');
      conn.frames.push({ at, text, isBinary });
      capture(`${name}.txt`, `${at - t0} ${text}`);
    });
    ws.on('close', (code, reason) => (conn.closed = { at: Date.now() - t0, code, reason: reason.toString() }));
    ws.on('error', (e) => {
      conn.error = e.message;
      reject(e);
    });
  });
}

let nextId = 1;
const send = (conn, obj) => {
  const id = nextId++;
  conn.ws.send(JSON.stringify({ ...obj, id }));
  return id;
};
const connect = (conn, token = TOKEN) => send(conn, { params: { token } });
const subscribe = (conn, channel, extra = {}) => send(conn, { method: 1, params: { channel, ...extra } });

// A text frame may carry several newline separated JSON replies.
function* parsed(conn, from = 0) {
  for (const f of conn.frames.slice(from)) {
    for (const line of f.text.split('\n')) {
      if (line.trim() === '') continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        msg = { unparsable: line.slice(0, 120) };
      }
      yield { at: f.at, msg, bytes: line.length };
    }
  }
}

const severalMessages = (f) => f.text.split('\n').filter((l) => l.trim() !== '').length > 1;
const replyTo = (conn, id) => [...parsed(conn)].find((p) => p.msg.id === id);

function ordered(levels, descending) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (descending ? b >= a : b <= a) return false;
  }
  return true;
}

async function book() {
  const pairs = ['usdtidr', 'btcidr', 'btcusdt', 'ethusdt', 'vcgusdt', 'xecusdt'];
  const conn = await open(URL_WS, { name: 'book' });
  log('open', { url: URL_WS, openMs: conn.openMs, upgrade: conn.upgrade });
  const connectId = connect(conn);
  const subs = {};
  for (const p of pairs) subs[`market:order-book-${p}`] = { id: subscribe(conn, `market:order-book-${p}`), sentAt: Date.now() };
  const others = ['chart:tick-btcidr', 'market:trade-activity-btcidr', 'market:summary-24h', 'chart:tick-btcusdt', 'market:trade-activity-btcusdt'];
  for (const ch of others) subs[ch] = { id: subscribe(conn, ch), sentAt: Date.now() };

  await sleep(20_000);
  const pingSent = Date.now();
  const pingId = send(conn, { method: 7 });
  await sleep(25_000);
  const pong = replyTo(conn, pingId);
  log('ping', { method: 7, reply: pong?.msg ?? null, rttMs: pong ? pong.at - pingSent : null });
  log('connect_reply', { reply: replyTo(conn, connectId)?.msg ?? null });

  const perChannel = {};
  for (const { at, msg, bytes } of parsed(conn)) {
    const ch = msg.result?.channel;
    if (!ch) continue;
    (perChannel[ch] ??= []).push({ at, data: msg.result.data, bytes });
  }

  for (const [ch, meta] of Object.entries(subs)) {
    const ack = replyTo(conn, meta.id);
    const pubs = perChannel[ch] ?? [];
    const row = { channel: ch, ack: ack?.msg ?? null, publications: pubs.length };
    if (pubs.length > 0) {
      row.firstAfterAckMs = ack ? pubs[0].at - ack.at : null;
      row.intervalMs = stats(pubs.slice(1).map((p, i) => p.at - pubs[i].at));
      row.bytes = stats(pubs.map((p) => p.bytes));
      const offsets = pubs.map((p) => p.data.offset);
      row.firstOffsetMinusAck = ack?.msg?.result?.offset !== undefined ? offsets[0] - ack.msg.result.offset : null;
      const steps = {};
      for (let i = 1; i < offsets.length; i++) steps[offsets[i] - offsets[i - 1]] = (steps[offsets[i] - offsets[i - 1]] ?? 0) + 1;
      row.offsetSteps = steps;
    }
    if (ch.startsWith('market:order-book-') && pubs.length > 0) {
      const books = pubs.map((p) => p.data.data);
      row.pairField = [...new Set(books.map((b) => b.pair))];
      row.bidLevels = stats(books.map((b) => (b.bid ?? []).length));
      row.askLevels = stats(books.map((b) => (b.ask ?? []).length));
      row.bidsDescending = books.filter((b) => ordered(b.bid ?? [], true)).length;
      row.asksAscending = books.filter((b) => ordered(b.ask ?? [], false)).length;
      row.crossed = books.filter((b) => b.bid?.length && b.ask?.length && Number(b.bid[0].price) >= Number(b.ask[0].price)).length;
      row.levelKeys = [...new Set(books.flatMap((b) => [...(b.bid ?? []), ...(b.ask ?? [])].map((l) => Object.keys(l).sort().join(','))))];
      row.valueTypes = [...new Set(books.flatMap((b) => [...(b.bid ?? []).slice(0, 1)].flatMap((l) => Object.values(l).map((v) => typeof v))))];
      const norm = (b) => JSON.stringify([(b.bid ?? []).map((l) => [l.price, ...Object.entries(l).filter(([k]) => k !== 'price').sort().map(([, v]) => v)]), (b.ask ?? []).map((l) => [l.price, ...Object.entries(l).filter(([k]) => k !== 'price').sort().map(([, v]) => v)])]);
      let repeats = 0;
      let touchChanges = 0;
      for (let i = 1; i < books.length; i++) {
        if (norm(books[i]) === norm(books[i - 1])) repeats++;
        const t = (b) => `${b.bid?.[0]?.price}/${b.bid?.[0] && Object.values(b.bid[0]).join()}/${b.ask?.[0]?.price}`;
        if (t(books[i]) !== t(books[i - 1])) touchChanges++;
      }
      row.identicalToPrevious = repeats;
      row.touchChanges = touchChanges;
      const last = books.at(-1);
      const base = ch.slice('market:order-book-'.length).replace(/(idr|usdt)$/, '');
      const quote = ch.endsWith('usdt') ? 'usdt' : 'idr';
      const top = last.bid?.[0];
      if (top) row.sizeCheck = { price: top.price, base: top[`${base}_volume`], quote: top[`${quote}_volume`], priceTimesBase: Number(top.price) * Number(top[`${base}_volume`]) };
      row.lastTouch = { bid: last.bid?.[0] ?? null, ask: last.ask?.[0] ?? null };
    }
    log('channel', row);
  }

  // Compare the last socket book of btcusdt with the REST depth read right after.
  const lastBtc = (perChannel['market:order-book-btcusdt'] ?? []).at(-1);
  const restAt = Date.now();
  const rest = await (await fetch(`${API}/api/depth/btcusdt?n=${restAt}`)).json();
  if (lastBtc) {
    const ws = lastBtc.data.data;
    const cmp = (wsSide, restSide) => {
      const n = Math.min(20, wsSide.length, restSide.length);
      let samePrice = 0;
      let sameSize = 0;
      for (let i = 0; i < n; i++) {
        if (Number(wsSide[i].price) === Number(restSide[i][0])) samePrice++;
        if (Number(wsSide[i].btc_volume) === Number(restSide[i][1])) sameSize++;
      }
      return { compared: n, samePrice, sameSize };
    };
    log('rest_compare', { pair: 'btcusdt', socketAgeMs: restAt - lastBtc.at, wsLevels: [ws.bid.length, ws.ask.length], restLevels: [rest.buy.length, rest.sell.length], bid: cmp(ws.bid, rest.buy), ask: cmp(ws.ask, rest.sell) });
  }
  const total = [...parsed(conn)];
  const t = performance.now();
  for (const f of conn.frames) JSON.parse(f.text.split('\n')[0]);
  log('totals', { frames: conn.frames.length, messages: total.length, bytes: total.reduce((a, p) => a + p.bytes, 0), parseUsPerFrame: Math.round(((performance.now() - t) * 1000) / conn.frames.length), serverPings: conn.pings, binaryFrames: conn.frames.filter((f) => f.isBinary).length, framesWithSeveralMessages: conn.frames.filter(severalMessages).length, framesEndingInNewline: conn.frames.filter((f) => f.text.endsWith('\n')).length });
  conn.ws.close();
  await sleep(500);
  log('close', { closed: conn.closed });
}

async function errors() {
  // Subscribe before the connect command.
  const a = await open(URL_WS, { name: 'err_noconnect' });
  const aSub = subscribe(a, 'market:order-book-btcidr');
  await sleep(3000);
  log('subscribe_before_connect', { reply: replyTo(a, aSub)?.msg ?? null, frames: a.frames.map((f) => f.text.slice(0, 200)), closed: a.closed });
  a.ws.terminate();

  // A token that is not the published one.
  const b = await open(URL_WS, { name: 'err_badtoken' });
  const bId = connect(b, 'not-a-token');
  await sleep(3000);
  log('bad_token', { reply: replyTo(b, bId)?.msg ?? null, frames: b.frames.map((f) => f.text.slice(0, 200)), closed: b.closed });
  b.ws.terminate();

  // A connect command with no token at all.
  const b2 = await open(URL_WS, { name: 'err_notoken' });
  const b2Id = send(b2, { params: {} });
  await sleep(3000);
  log('no_token', { reply: replyTo(b2, b2Id)?.msg ?? null, frames: b2.frames.map((f) => f.text.slice(0, 200)), closed: b2.closed });
  b2.ws.terminate();

  const c = await open(URL_WS, { name: 'err_main' });
  connect(c);
  await sleep(500);
  const cases = {};
  for (const ch of ['market:order-book-nopeidr', 'market:order-book-BTCIDR', 'market:order-book-btc_idr', 'nope:foo', 'market:nope-btcidr', 'market:order-book-btcidr', 'market:order-book-btcidr']) {
    cases[`${ch}#${nextId}`] = subscribe(c, ch);
    await sleep(200);
  }
  // Two commands in one frame, separated by a newline, as the Centrifugo JSON protocol allows.
  const b1 = nextId++;
  const b2b = nextId++;
  c.ws.send(`${JSON.stringify({ method: 1, params: { channel: 'market:order-book-ethidr' }, id: b1 })}\n${JSON.stringify({ method: 1, params: { channel: 'market:order-book-solidr' }, id: b2b })}`);
  await sleep(6000);
  for (const [k, id] of Object.entries(cases)) log('subscribe_case', { channel: k.split('#')[0], reply: replyTo(c, id)?.msg ?? null });
  log('newline_batch', { first: replyTo(c, b1)?.msg ?? null, second: replyTo(c, b2b)?.msg ?? null });
  const several = c.frames.filter(severalMessages);
  log('server_frames', { of: c.frames.length, endingInNewline: c.frames.filter((f) => f.text.endsWith('\n')).length, withSeveralMessages: several.length, sample: several.slice(0, 2).map((f) => f.text.split('\n').map((l) => l.slice(0, 90))) });
  const byChannel = {};
  for (const p of parsed(c)) if (p.msg.result?.channel) byChannel[p.msg.result.channel] = (byChannel[p.msg.result.channel] ?? 0) + 1;
  log('publications_by_channel', { closed: c.closed, byChannel });

  // Recovery: note the offset, unsubscribe, wait, then resubscribe from that offset.
  const ch = 'market:order-book-usdtidr';
  const s1 = subscribe(c, ch);
  await sleep(1500);
  const offset = replyTo(c, s1)?.msg?.result?.offset;
  const epoch = replyTo(c, s1)?.msg?.result?.epoch;
  const u = send(c, { method: 2, params: { channel: ch } });
  await sleep(6000);
  const s2 = subscribe(c, ch, { recover: true, offset, epoch });
  await sleep(1500);
  const r2 = replyTo(c, s2)?.msg;
  log('recover', {
    unsubscribeReply: replyTo(c, u)?.msg ?? null,
    fromOffset: offset,
    reply: r2 ? { ...r2, result: { ...r2.result, publications: undefined, publicationCount: r2.result?.publications?.length ?? 0, publicationOffsets: (r2.result?.publications ?? []).map((p) => p.offset), firstPublicationKeys: r2.result?.publications?.[0] ? Object.keys(r2.result.publications[0].data ?? {}) : null } } : null,
  });

  // Text that is not JSON, last because it may end the session.
  const before = Date.now();
  c.ws.send('this is not json');
  await sleep(2000);
  log('not_json', { closed: c.closed, closedAfterMs: c.closed ? c.closed.at - (before - c.t0) : null });
  c.ws.terminate();

  // The alternate URL named in the troubleshooting section of the docs.
  try {
    const d = await open(ALT_URL_WS, { name: 'err_alt' });
    const dId = connect(d);
    await sleep(2000);
    log('alt_url', { url: ALT_URL_WS, openMs: d.openMs, upgrade: d.upgrade, reply: replyTo(d, dId)?.msg ?? null });
    d.ws.close();
  } catch (e) {
    log('alt_url', { url: ALT_URL_WS, error: e.message });
  }
  await sleep(500);
}

async function batch() {
  const pairs = await (await fetch(`${API}/api/pairs`)).json();
  const tickers = (await (await fetch(`${API}/api/ticker_all`)).json()).tickers;
  const usdt = pairs.filter((p) => p.base_currency === 'usdt').map((p) => p.id);
  const idr = pairs
    .filter((p) => p.base_currency === 'idr' && !p.is_maintenance)
    .map((p) => [p.id, Number(tickers[p.ticker_id]?.vol_idr ?? 0)])
    .sort((x, y) => y[1] - x[1])
    .map(([id]) => id);
  const chosen = [...usdt, ...idr].slice(0, 150);
  const conn = await open(URL_WS, { name: 'batch' });
  connect(conn);
  const ids = chosen.map((p) => [p, subscribe(conn, `market:order-book-${p}`)]);
  const sentAt = Date.now();
  await sleep(45_000);
  const all = [...parsed(conn)];
  const replies = new Map(all.filter((p) => p.msg.id !== undefined).map((p) => [p.msg.id, p]));
  const results = { ok: 0, error: {}, missing: 0 };
  let lastAck = 0;
  for (const [, id] of ids) {
    const r = replies.get(id);
    if (!r) results.missing++;
    else if (r.msg.error) results.error[JSON.stringify(r.msg.error)] = (results.error[JSON.stringify(r.msg.error)] ?? 0) + 1;
    else results.ok++;
    if (r) lastAck = Math.max(lastAck, r.at - sentAt);
  }
  const firstErrorIndex = ids.findIndex(([, id]) => replies.get(id)?.msg?.error);
  const pubs = all.filter((p) => p.msg.result?.channel);
  const channels = new Set(pubs.map((p) => p.msg.result.channel));
  const perSecond = {};
  for (const p of pubs) {
    const s = Math.floor((p.at - sentAt) / 1000);
    perSecond[s] = (perSecond[s] ?? 0) + 1;
  }
  const rates = Object.values(perSecond);
  const bytes = pubs.reduce((a, p) => a + p.bytes, 0);
  const t = performance.now();
  for (const f of conn.frames) JSON.parse(f.text.split('\n')[0]);
  const parseUs = ((performance.now() - t) * 1000) / conn.frames.length;
  const silentUsdt = usdt.filter((p) => !channels.has(`market:order-book-${p}`));
  log('batch', { requested: chosen.length, usdt: usdt.length, acks: results, firstErrorIndex, lastAckMs: lastAck, channelsDelivering: channels.size, silentUsdtPairs: silentUsdt, publications: pubs.length, perSecond: stats(rates), bytesPerSecond: Math.round(bytes / 45), bytesPerPublication: Math.round(bytes / Math.max(1, pubs.length)), parseUsPerFrame: Math.round(parseUs), framesWithSeveralMessages: conn.frames.filter(severalMessages).length, framesEndingInNewline: conn.frames.filter((f) => f.text.endsWith('\n')).length, closed: conn.closed, serverPings: conn.pings.length });
  conn.ws.close();
  await sleep(500);
}

// No book arrives on subscribe, so this asks the channel history for its last publication, which is a whole book.
// Subscribe to learn the offset, unsubscribe, then resubscribe with recover from one before it, and compare with the REST depth.
async function seed() {
  const pairs = ['xecusdt', 'vcgusdt', 'idxusdt', 'pundixusdt', 'btcusdt'];
  const conn = await open(URL_WS, { name: 'seed' });
  connect(conn);
  await sleep(500);
  for (const pair of pairs) {
    const ch = `market:order-book-${pair}`;
    const s1 = subscribe(conn, ch);
    await sleep(700);
    const ack = replyTo(conn, s1)?.msg?.result;
    send(conn, { method: 2, params: { channel: ch } });
    await sleep(300);
    const s2 = subscribe(conn, ch, { recover: true, offset: ack.offset - 1, epoch: ack.epoch });
    await sleep(700);
    const r = replyTo(conn, s2)?.msg;
    const pub = r?.result?.publications?.at(-1)?.data;
    const rest = await (await fetch(`${API}/api/depth/${pair}?n=${Date.now()}`)).json();
    const top = (lv) => (lv ? `${lv.price}` : null);
    log('seed', {
      pair,
      ackOffset: ack.offset,
      recovered: r?.result?.recovered ?? null,
      publications: r?.result?.publications?.length ?? 0,
      offsets: (r?.result?.publications ?? []).map((p) => p.offset),
      error: r?.error ?? null,
      levels: pub ? [pub.bid?.length ?? 0, pub.ask?.length ?? 0] : null,
      touch: pub ? [top(pub.bid?.[0]), top(pub.ask?.[0])] : null,
      restTouch: [rest.buy?.[0]?.[0] ?? null, rest.sell?.[0]?.[0] ?? null],
    });
    if (pair === 'btcusdt' && r) {
      const trimmed = structuredClone(r);
      for (const p of trimmed.result.publications ?? []) {
        p.data.bid = p.data.bid.slice(0, 2);
        p.data.ask = p.data.ask.slice(0, 2);
      }
      log('seed_reply_trimmed', { reply: trimmed });
    }
    send(conn, { method: 2, params: { channel: ch } });
    await sleep(300);
  }
  // One live push, trimmed to two levels a side, for the profile.
  const from = conn.frames.length;
  subscribe(conn, 'market:order-book-btcidr');
  const until = Date.now() + 8000;
  let live = null;
  while (!live && Date.now() < until) {
    await sleep(200);
    live = [...parsed(conn, from)].find((p) => p.msg.result?.channel === 'market:order-book-btcidr')?.msg ?? null;
  }
  if (live) {
    live.result.data.data.bid = live.result.data.data.bid.slice(0, 2);
    live.result.data.data.ask = live.result.data.data.ask.slice(0, 2);
  }
  log('live_push_trimmed', { frame: live });
  conn.ws.close();
  await sleep(300);
}

async function silence() {
  const quiet = 'market:order-book-vcgusdt';
  const a = await open(URL_WS, { name: 'sil_a' });
  const b = await open(URL_WS, { name: 'sil_b' });
  const c = await open(URL_WS, { name: 'sil_c' });
  const d = await open(URL_WS, { name: 'sil_d' });
  const e = await open(URL_WS, { name: 'sil_e', autoPong: false });
  connect(b);
  connect(c);
  subscribe(c, quiet);
  connect(d);
  subscribe(d, quiet);
  connect(e);
  subscribe(e, quiet);
  const ping = setInterval(() => d.ws.readyState === WebSocket.OPEN && send(d, { method: 7 }), 25_000);
  const start = Date.now();
  while (Date.now() - start < 110_000 && [a, b, c, d, e].some((x) => x.closed === null)) await sleep(1000);
  clearInterval(ping);
  const describe = (x, what) => ({
    socket: x.name,
    what,
    closed: x.closed,
    serverPings: x.pings,
    frames: x.frames.length,
    publications: [...parsed(x)].filter((p) => p.msg.result?.channel).length,
    lastFrameMs: x.frames.length ? x.frames.at(-1).at - x.t0 : null,
    emptyFrames: x.frames.filter((f) => f.text.trim() === '{}' || f.text.trim() === '').length,
  });
  log('silence', describe(a, 'open only, nothing sent'));
  log('silence', describe(b, 'connect command only'));
  log('silence', describe(c, `connect and ${quiet}, no ping`));
  log('silence', describe(d, `connect and ${quiet}, method 7 every 25 s`));
  log('silence', describe(e, `connect and ${quiet}, server pings left unanswered`));
  for (const x of [a, b, c, d, e]) x.ws.terminate();
}

async function deflate() {
  const conn = await open(URL_WS, { deflate: true, name: 'deflate' });
  log('deflate', { offered: 'permessage-deflate', upgrade: conn.upgrade });
  conn.ws.close();
  await sleep(300);
  const plain = await open(URL_WS, { name: 'plain' });
  log('no_deflate', { upgrade: plain.upgrade });
  plain.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, seed, batch, silence, deflate };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
log('mode', { name: mode, at: new Date().toISOString() });
await modes[mode]();
process.exit(0);
