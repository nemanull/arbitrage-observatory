// BitDelta public stream probe: Socket.IO 4 over a raw WebSocket on wss://api.bitdelta.com, the derivatives quote events, the documented spot rooms, keepalive, silence, errors.
// Public, unauthenticated, read-only. The only credential sent is the literal guest token the website sends. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitdelta/ws-probe.mjs [prices|silence|errors|handshake]
//   prices     main namespace for 60 s: every event name, the futures_prices and prices_futures_v2 payloads, per contract update gaps, spreads, repeats, and any catalog contract never streamed,
//              joins the rooms BTCUSD, ETHUSD and ZENUSD (derivatives) and BTCUSDT and ETHUSDT (spot) to see which get futures_prices or orderbook_limited, plus the /price_change namespace. About 65 s.
//   silence    three sockets that differ only in the namespace connect and whether they answer the server ping, for up to 120 s.
//   errors     unknown room, unknown event, unknown namespace, namespace without auth, plain text, malformed packet, connect without auth. About 20 s.
//   handshake  open timings, the open packet, EIO=3, and what the server says to a permessage-deflate offer. About 15 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/bitdelta/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const HOST = 'wss://api.bitdelta.com';
const URL4 = `${HOST}/socket.io/?EIO=4&transport=websocket`;
const URL3 = `${HOST}/socket.io/?EIO=3&transport=websocket`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const stats = (a) => (a.length ? { n: a.length, min: Math.min(...a), median: median(a), p90: pct(a, 0.9), max: Math.max(...a) } : { n: 0 });
const trim = (s, n = 600) => (s.length > n ? s.slice(0, n) + `…(${s.length} chars)` : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), trim(text, 4000) + '\n');
}

// Opens one Engine.IO 4 socket and hands every text packet to onPacket. Answers the server ping unless told not to.
function open(url, { answerPing = true, onPacket = () => {}, deflate = false } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const s = { ws, t0, openMs: null, pings: [], closed: null, handshake: null, extensions: null };
  ws.on('upgrade', (res) => { s.extensions = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('open', () => { s.openMs = Date.now() - t0; });
  ws.on('message', (data, isBinary) => {
    const text = isBinary ? `<binary ${data.length} bytes>` : data.toString('utf8');
    if (text[0] === '0' && !s.handshake) s.handshake = text;
    if (text === '2') {
      s.pings.push(Date.now() - t0);
      if (answerPing) ws.send('3');
    }
    onPacket(text, Date.now());
  });
  ws.on('close', (code, reason) => { s.closed = { atMs: Date.now() - t0, code, reason: reason.toString() }; });
  ws.on('error', (e) => { s.error = e.message; });
  return s;
}

// Splits a Socket.IO packet into namespace and event array, for type 42 only.
function parseEvent(text) {
  if (!text.startsWith('42')) return null;
  let rest = text.slice(2);
  let nsp = '/';
  if (rest.startsWith('/')) {
    const comma = rest.indexOf(',');
    nsp = rest.slice(0, comma);
    rest = rest.slice(comma + 1);
  }
  try {
    const arr = JSON.parse(rest);
    return { nsp, name: arr[0], args: arr.slice(1), bytes: text.length };
  } catch {
    return { nsp, name: '<unparsed>', args: [], bytes: text.length };
  }
}

// prices_futures_v2 rows are [symbol, bid, ask, status, marketClosed, mid, tsMs].
// futures_prices is one contract per event: [symbol, mid, bid, ask, marketClosed, tsMs].
function quoteOf(name, args) {
  if (name === 'prices_futures_v2') {
    return (Array.isArray(args[0]) ? args[0] : []).map((r) => ({ sym: r[0], bid: r[1], ask: r[2], status: r[3], closed: r[4], mid: r[5], ts: r[6] }));
  }
  if (name === 'futures_prices') {
    const [sym, mid, bid, ask, closed, ts] = args;
    return [{ sym, bid, ask, closed, mid, ts }];
  }
  return [];
}

async function prices() {
  const events = new Map(); // `${nsp} ${name}` to { n, bytes, first }
  const quotes = new Map(); // `${event} ${symbol}` to arrival times, spreads and ages
  const books = new Map(); // orderbook_limited pair to level counts and order checks
  const statuses = new Map();
  const rowsPerFrame = [];
  const control = [];
  let t0 = 0;
  const onPacket = (text, at) => {
    if (!text.startsWith('42')) {
      if (text !== '2' && text !== '3') control.push(trim(text, 300));
      capture('control.txt', text);
      return;
    }
    const ev = parseEvent(text);
    const key = `${ev.nsp} ${ev.name}`;
    const e = events.get(key) ?? { n: 0, bytes: 0, first: trim(text, 500), firstAt: at - t0 };
    e.n++;
    e.bytes += ev.bytes;
    events.set(key, e);
    capture(`${ev.nsp.replace('/', '_') || 'main'}-${ev.name}.txt`, text);
    if (ev.name === 'prices_futures_v2') rowsPerFrame.push(quoteOf(ev.name, ev.args).length);
    for (const r of quoteOf(ev.name, ev.args)) {
      const k = `${ev.name} ${r.sym}`;
      const q = quotes.get(k) ?? { at: [], spreadPpm: [], ageMs: [], midOk: 0, midBad: 0, crossed: 0, repeats: 0, last: null };
      const bidAsk = `${r.bid}/${r.ask}`;
      if (q.last === bidAsk) q.repeats++; // same bid and ask again, with a new timestamp
      q.last = bidAsk;
      q.at.push(at);
      if (r.bid > 0 && r.ask > 0) q.spreadPpm.push(Math.round(((r.ask - r.bid) / ((r.ask + r.bid) / 2)) * 1e6));
      if (r.ask < r.bid) q.crossed++;
      if (Math.abs((r.bid + r.ask) / 2 - r.mid) <= Math.abs(r.mid) * 1e-6 + 1e-9) q.midOk++; else q.midBad++;
      if (typeof r.ts === 'number') q.ageMs.push(at - r.ts);
      quotes.set(k, q);
      if (r.status !== undefined) statuses.set(`${r.status} closed=${r.closed}`, (statuses.get(`${r.status} closed=${r.closed}`) ?? 0) + 1);
    }
    if (ev.name === 'orderbook_limited') {
      const b = ev.args[0] ?? {};
      const k = b.pair ?? '<no pair>';
      const x = books.get(k) ?? { n: 0, bids: [], asks: [], bidsDesc: 0, asksAsc: 0, keys: Object.keys(b).join(','), best: null };
      x.n++;
      const bids = b.bids ?? [], asks = b.asks ?? [];
      x.bids.push(bids.length);
      x.asks.push(asks.length);
      if (bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0])) x.bidsDesc++;
      if (asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0])) x.asksAsc++;
      x.best = [bids[0], asks[0]];
      books.set(k, x);
    }
  };
  // The website's catalog call, to name any contract the stream never sends.
  const catalog = (await (await fetch('https://api.bitdelta.com/api/v1/futures/market/snapshot')).json()).data.futures.map((f) => f.symbol);
  const main = open(URL4, { onPacket });
  t0 = main.t0;
  await new Promise((r) => main.ws.once('open', r));
  main.ws.send('40{"token":"guest"}');
  main.ws.send('40/price_change,{"token":"guest"}');
  await sleep(5000);
  log('handshake', { openMs: main.openMs, handshake: main.handshake, control });
  const joinAt = Date.now();
  for (const room of ['BTCUSD', 'ETHUSD', 'ZENUSD', 'BTCUSDT', 'ETHUSDT']) main.ws.send(`42["join","${room}"]`);
  await sleep(55000);
  main.ws.close();
  const seconds = (Date.now() - main.t0) / 1000;
  for (const [k, e] of events) log('event', { key: k, n: e.n, perSec: +(e.n / seconds).toFixed(2), avgBytes: Math.round(e.bytes / e.n), firstAtMs: e.firstAt, first: e.first });
  log('control', { joinAtMs: joinAt - main.t0, packets: control.slice(0, 12) });
  log('statuses', Object.fromEntries(statuses));
  const rows = [];
  for (const [k, q] of quotes) {
    const gaps = q.at.slice(1).map((t, i) => t - q.at[i]);
    rows.push({ k, n: q.at.length, repeats: q.repeats, gap: stats(gaps), spreadPpm: stats(q.spreadPpm), ageMs: stats(q.ageMs), midOk: q.midOk, midBad: q.midBad, crossed: q.crossed });
  }
  rows.sort((a, b) => b.n - a.n);
  const v2 = rows.filter((r) => r.k.startsWith('prices_futures_v2'));
  log('v2_summary', { rowsPerFrame: stats(rowsPerFrame), symbols: v2.length, updates: v2.reduce((s, r) => s + r.n, 0), perSymbol: stats(v2.map((r) => r.n)), maxGapMs: stats(v2.map((r) => r.gap.max ?? 0)), medianSpreadPpm: stats(v2.map((r) => r.spreadPpm.median ?? 0)), medianAgeMs: stats(v2.map((r) => r.ageMs.median ?? 0)), crossed: v2.reduce((s, r) => s + r.crossed, 0), repeats: v2.reduce((s, r) => s + r.repeats, 0), midBad: v2.reduce((s, r) => s + r.midBad, 0) });
  const streamed = new Set(v2.map((r) => r.k.split(' ')[1]));
  log('v2_coverage', { catalog: catalog.length, streamed: streamed.size, neverStreamed: catalog.filter((c) => !streamed.has(c)) });
  for (const r of rows.filter((x) => /(BTCUSD|ETHUSD|SOLUSD|XRPUSD|BTCETH|ZENUSD|IOSUSD|SNXUSD)$/.test(x.k))) log('quote', r);
  for (const [k, x] of books) log('orderbook_limited', { pair: k, n: x.n, keys: x.keys, bids: stats(x.bids), asks: stats(x.asks), bidsDescending: x.bidsDesc, asksAscending: x.asksAsc, lastBest: x.best });
  log('pings', { atMs: main.pings });
}

async function silence() {
  const cases = [
    { name: 'connect_answer_ping', connect: true, answerPing: true },
    { name: 'connect_no_pong', connect: true, answerPing: false },
    { name: 'no_connect_answer_ping', connect: false, answerPing: true },
  ];
  const socks = cases.map((c) => {
    const counts = { events: 0 };
    const s = open(URL4, { answerPing: c.answerPing, onPacket: (t) => { if (t.startsWith('42')) counts.events++; } });
    s.ws.once('open', () => { if (c.connect) s.ws.send('40{"token":"guest"}'); });
    return { c, s, counts };
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && socks.some((x) => !x.s.closed)) await sleep(500);
  for (const x of socks) {
    log('silence', { case: x.c.name, handshake: x.s.handshake, pingsAtMs: x.s.pings, events: x.counts.events, closed: x.s.closed ?? 'open at 120 s' });
    if (!x.s.closed) x.s.ws.close();
  }
}

async function errors() {
  const got = [];
  const s = open(URL4, { onPacket: (t, at) => { if (t !== '2') got.push({ atMs: at - s.t0, text: trim(t, 300) }); } });
  await new Promise((r) => s.ws.once('open', r));
  const steps = [
    ['connect main', '40{"token":"guest"}'],
    ['join unknown room', '42["join","NOPEUSD"]'],
    ['join lower case spot', '42["join","btcusdt"]'],
    ['join twice', '42["join","BTCUSDT"]'],
    ['join twice again', '42["join","BTCUSDT"]'],
    ['leave', '42["leave","BTCUSDT"]'],
    ['unknown event', '42["subscribe","BTCUSD"]'],
    ['unknown namespace', '40/nope,{"token":"guest"}'],
    ['namespace without auth', '40/price_change,'],
    ['plain text', 'hello'],
    ['malformed socket.io packet', '42[not json'],
  ];
  for (const [name, frame] of steps) {
    const before = got.length;
    const at = Date.now() - s.t0;
    if (s.ws.readyState !== WebSocket.OPEN) { log('error_step', { name, skipped: 'socket closed', closed: s.closed }); continue; }
    s.ws.send(frame);
    await sleep(1500);
    const replies = got.slice(before).filter((g) => !/^42\["(futures_prices|prices_futures_v2|prices|orderbook_limited|trades|spot_v2|campaign_leaderboard)"/.test(g.text.replace(/^42\/[a-z_]+,/, '42')));
    const streamed = got.slice(before).length - replies.length;
    log('error_step', { name, frame, sentAtMs: at, replies: replies.slice(0, 4), streamedEvents: streamed, closed: s.closed });
  }
  // A second socket connects with no auth object at all.
  const got2 = [];
  const s2 = open(URL4, { onPacket: (t) => got2.push(trim(t, 300)) });
  await new Promise((r) => s2.ws.once('open', r));
  s2.ws.send('40');
  await sleep(3000);
  log('connect_without_auth', { packets: got2.filter((t) => !t.startsWith('42')).slice(0, 5), events: got2.filter((t) => t.startsWith('42')).length, closed: s2.closed });
  s.ws.close();
  s2.ws.close();
}

async function handshake() {
  for (let i = 0; i < 3; i++) {
    const s = open(URL4);
    await new Promise((r) => { s.ws.once('open', r); s.ws.once('error', r); });
    await sleep(800);
    log('open', { i, openMs: s.openMs, handshake: s.handshake, extensions: s.extensions, error: s.error });
    s.ws.close();
  }
  const d = open(URL4, { deflate: true });
  await new Promise((r) => { d.ws.once('open', r); d.ws.once('error', r); });
  await sleep(800);
  log('deflate_offer', { openMs: d.openMs, extensions: d.extensions, error: d.error });
  d.ws.close();
  const e3 = open(URL3);
  await new Promise((r) => { e3.ws.once('open', r); e3.ws.once('error', r); e3.ws.once('close', r); });
  await sleep(1500);
  log('eio3', { openMs: e3.openMs, handshake: e3.handshake, error: e3.error, closed: e3.closed });
  e3.ws.close();
  const bare = open(`${HOST}/`);
  await new Promise((r) => { bare.ws.once('open', r); bare.ws.once('error', r); bare.ws.once('close', r); });
  await sleep(1500);
  log('root_path', { url: `${HOST}/`, openMs: bare.openMs, error: bare.error, closed: bare.closed });
  bare.ws.close();
}

const mode = process.argv[2] ?? 'prices';
const modes = { prices, silence, errors, handshake };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
