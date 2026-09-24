// INEX WebSocket probe: the documented Open API socket's handshake without a token, then the website's own market socket, its book channel, frame encoding, keepalive, silence and errors.
// Public, unauthenticated, read-only. No account, no key, no JWT, no private channel, no order. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/inex/ws-probe.mjs [official|book|errors|silence|deflate|all]
//   official  the documented wss://api.inexcoin.com/open-api/ws handshake with no token, and the documented subscribe if it ever opens. About 1 s when refused, 5 s if it opens.
//   book      market_<pair>_depth_step0 for all 11 pairs on one website socket for 75 s: levels, order, repeats, frame ages, pings, throughput. About 78 s.
//   errors    unknown pair, upper case pair, other depth steps, ticker and trade channels, a duplicate and a non-JSON frame, on one socket for 15 s. About 16 s.
//   silence   three sockets for up to 90 s: unsubscribed answering pings, unsubscribed not answering, subscribed not answering. About 91 s.
//   deflate   asks for permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/inex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const OFFICIAL_URL = 'wss://api.inexcoin.com/open-api/ws'; // https://docs.inex.im/docs/ws-orderbook
const SITE_URL = 'wss://socket.inexcoin.com/kline-api/ws'; // the website's socket, not documented
const PAIRS = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'trxusdt', 'avaxusdt', 'aaveusdt', 'ldousdt', 'ondousdt', 'qiusdt', 'eseusdt'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel) => JSON.stringify({ event: 'sub', params: { channel, cb_id: channel.split('_')[1] } });
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

// Website frames are binary zlib streams (78 9c) that inflate to JSON text.
function decode(data, isBinary) {
  const t0 = performance.now();
  const text = isBinary ? inflateSync(data).toString('utf8') : data.toString('utf8');
  const msg = JSON.parse(text);
  return { msg, text, us: (performance.now() - t0) * 1000 };
}

function open(url, options = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...options });
  const state = { ws, t0, openMs: null, closed: null, pings: [], upgrade: null, refused: null };
  ws.on('upgrade', (res) => { state.upgrade = { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null }; });
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => { state.refused = { status: res.statusCode, ms: Date.now() - t0, contentType: res.headers['content-type'], body: body.slice(0, 200) }; });
  });
  ws.on('open', () => { state.openMs = Date.now() - t0; });
  ws.on('ping', () => state.pings.push(Date.now() - t0));
  ws.on('close', (code, reason) => { state.closed = { atMs: Date.now() - t0, code, reason: reason.toString() }; });
  ws.on('error', (e) => { state.error = e.message; });
  return state;
}

async function waitOpen(state, ms = 10_000) {
  const end = Date.now() + ms;
  while (state.openMs === null && !state.refused && !state.closed && !state.error && Date.now() < end) await sleep(20);
  return state.openMs !== null;
}

async function official() {
  const s = open(OFFICIAL_URL);
  const ok = await waitOpen(s);
  await sleep(300);
  if (!ok) {
    log('official', { url: OFFICIAL_URL, opened: false, refused: s.refused, error: s.error ?? null });
    return;
  }
  const frames = [];
  s.ws.on('message', (d) => frames.push(d.toString().slice(0, 300)));
  s.ws.send(JSON.stringify({ type: 'subscribe', channel: 'orderbook_BTC-USDT' }));
  await sleep(4000);
  s.ws.terminate();
  log('official', { url: OFFICIAL_URL, opened: true, openMs: s.openMs, frames: frames.length, first: frames.slice(0, 3) });
}

async function book() {
  const s = open(SITE_URL);
  if (!(await waitOpen(s))) {
    log('book', { opened: false, refused: s.refused, error: s.error ?? null });
    return;
  }
  const subAt = Date.now();
  const per = new Map(PAIRS.map((p) => [p, { acks: 0, ackMs: null, frames: 0, firstMs: null, gaps: [], lastAt: null, lastBook: null, repeats: 0, bidLv: [], askLv: [], bidDisorder: 0, askDisorder: 0, crossed: 0, empty: 0, ages: [], ackAge: null, tsBack: 0, lastTs: null, zeroSizes: 0, spreadPpm: null, touchQuote: null, bookQuote: null, sample: null }]));
  let frames = 0, wireBytes = 0, textBytes = 0, other = 0;
  const decodeUs = [];
  const perSecond = new Map();
  s.ws.on('message', (data, isBinary) => {
    const at = Date.now();
    frames++;
    wireBytes += data.length;
    const { msg, text, us } = decode(data, isBinary);
    textBytes += text.length;
    decodeUs.push(us);
    const sec = Math.floor((at - subAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (msg.ping !== undefined) {
      other++;
      capture('book-other.jsonl', text);
      s.ws.send(JSON.stringify({ pong: msg.ping }));
      return;
    }
    const pair = typeof msg.channel === 'string' ? msg.channel.split('_')[1] : null;
    const st = per.get(pair);
    if (!st) { other++; capture('book-other.jsonl', text); return; }
    if (msg.event_rep === 'subed') {
      st.acks++;
      st.ackMs = at - subAt;
      st.ackAge = at - msg.ts;
      capture('book-acks.jsonl', text);
      return;
    }
    if (!msg.tick) { other++; capture('book-other.jsonl', text); return; }
    capture(`book-${pair}.jsonl`, `${at} ${text}`);
    st.frames++;
    if (st.firstMs === null) st.firstMs = at - subAt;
    if (st.lastAt !== null) st.gaps.push(at - st.lastAt);
    st.lastAt = at;
    const buys = msg.tick.buys ?? [];
    const asks = msg.tick.asks ?? [];
    const key = JSON.stringify([buys, asks]);
    if (key === st.lastBook) st.repeats++;
    st.lastBook = key;
    st.bidLv.push(buys.length);
    st.askLv.push(asks.length);
    if (buys.length === 0 || asks.length === 0) st.empty++;
    for (let i = 1; i < buys.length; i++) if (Number(buys[i][0]) >= Number(buys[i - 1][0])) { st.bidDisorder++; break; }
    for (let i = 1; i < asks.length; i++) if (Number(asks[i][0]) <= Number(asks[i - 1][0])) { st.askDisorder++; break; }
    st.zeroSizes += [...buys, ...asks].filter((l) => Number(l[1]) === 0).length;
    if (buys.length && asks.length) {
      const bb = Number(buys[0][0]), ba = Number(asks[0][0]);
      if (bb >= ba) st.crossed++;
      st.spreadPpm = Math.round(((ba - bb) / ((ba + bb) / 2)) * 1e6);
      st.touchQuote = [Math.round(bb * Number(buys[0][1]) * 100) / 100, Math.round(ba * Number(asks[0][1]) * 100) / 100];
      const side = (lv) => Math.round(lv.reduce((sum, l) => sum + Number(l[0]) * Number(l[1]), 0));
      st.bookQuote = [side(buys), side(asks)];
    }
    st.ages.push(at - msg.ts);
    if (st.lastTs !== null && msg.ts < st.lastTs) st.tsBack++;
    st.lastTs = msg.ts;
    if (!st.sample) st.sample = { types: { price: typeof buys[0]?.[0], size: typeof buys[0]?.[1] }, keys: Object.keys(msg), tickKeys: Object.keys(msg.tick) };
  });

  for (const p of PAIRS) s.ws.send(sub(`market_${p}_depth_step0`));
  await sleep(75_000);
  const heldMs = Date.now() - subAt;
  s.ws.terminate();

  log('bookSocket', { url: SITE_URL, openMs: s.openMs, upgrade: s.upgrade, heldMs, closedEarly: s.closed, frames, perSecondMedian: median([...perSecond.values()]), perSecondMax: Math.max(...perSecond.values()), wireBytesPerFrame: Math.round(wireBytes / frames), textBytesPerFrame: Math.round(textBytes / frames), decodeUsMedian: Math.round(median(decodeUs)), otherFrames: other, protocolPingsAtMs: s.pings });
  for (const [p, st] of per) {
    log('bookPair', { pair: p, acks: st.acks, ackMs: st.ackMs, ackAgeMs: st.ackAge, frames: st.frames, firstMs: st.firstMs, gapMedianMs: median(st.gaps), gapMaxMs: st.gaps.length ? Math.max(...st.gaps) : null, repeats: st.repeats, bidLevels: [Math.min(...st.bidLv), Math.max(...st.bidLv)], askLevels: [Math.min(...st.askLv), Math.max(...st.askLv)], empty: st.empty, bidDisorder: st.bidDisorder, askDisorder: st.askDisorder, crossed: st.crossed, zeroSizes: st.zeroSizes, ageMsMin: st.ages.length ? Math.min(...st.ages) : null, ageMsMedian: median(st.ages), ageMsMax: st.ages.length ? Math.max(...st.ages) : null, tsBack: st.tsBack, spreadPpm: st.spreadPpm, touchQuoteUsdt: st.touchQuote, bookQuoteUsdt: st.bookQuote });
  }
  const s0 = [...per.values()].find((x) => x.sample);
  log('bookShape', { sample: s0?.sample ?? null });
}

async function errors() {
  const s = open(SITE_URL);
  if (!(await waitOpen(s))) {
    log('errors', { opened: false, refused: s.refused, error: s.error ?? null });
    return;
  }
  const t0 = Date.now();
  const seen = [];
  s.ws.on('message', (data, isBinary) => {
    let text;
    try { text = decode(data, isBinary).text; } catch (e) { text = 'undecodable ' + data.toString('hex').slice(0, 40); }
    seen.push({ ms: Date.now() - t0, text: text.slice(0, 260) });
    capture('errors.jsonl', text);
    const m = text.match(/"ping":(\d+)/);
    if (m) s.ws.send(JSON.stringify({ pong: Number(m[1]) }));
  });
  const sends = [
    sub('market_nopeusdt_depth_step0'),
    sub('market_BTCUSDT_depth_step0'),
    sub('market_btcusdt_depth_step1'),
    sub('market_btcusdt_depth_step2'),
    sub('market_btcusdt_depth_step9'),
    sub('market_btcusdt_ticker'),
    sub('market_btcusdt_trade_ticker'),
    sub('market_ethusdt_depth_step0'),
    sub('market_ethusdt_depth_step0'),
    JSON.stringify({ event: 'nope', params: { channel: 'market_btcusdt_depth_step0', cb_id: 'x' } }),
    'not json',
  ];
  for (const f of sends) { s.ws.send(f); await sleep(250); }
  await sleep(15_000 - sends.length * 250);
  s.ws.terminate();
  const summary = new Map();
  for (const f of seen) {
    const ch = (f.text.match(/"channel":"([^"]*)"/) ?? [])[1] ?? 'none';
    const rep = (f.text.match(/"event_rep":"([^"]*)"/) ?? [])[1] ?? '';
    const k = `${ch}|${rep}|${f.text.includes('"tick"') ? 'tick' : ''}`;
    const e = summary.get(k) ?? { n: 0, first: f };
    e.n++;
    summary.set(k, e);
  }
  log('errorsSocket', { openMs: s.openMs, closed: s.closed, frames: seen.length });
  for (const [k, e] of summary) log('errorsKind', { kind: k, n: e.n, firstMs: e.first.ms, first: e.first.text });
}

async function silence() {
  const a = open(SITE_URL);
  const b = open(SITE_URL, { autoPong: false });
  const c = open(SITE_URL, { autoPong: false });
  await Promise.all([waitOpen(a), waitOpen(b), waitOpen(c)]);
  const counts = { a: 0, b: 0, c: 0 };
  a.ws.on('message', () => counts.a++);
  b.ws.on('message', () => counts.b++);
  c.ws.on('message', () => counts.c++);
  c.ws.send(sub('market_btcusdt_depth_step0'));
  const end = Date.now() + 90_000;
  while (Date.now() < end && !(a.closed && b.closed && c.closed)) await sleep(250);
  for (const [name, s, what] of [['a', a, 'unsubscribed, answers protocol pings'], ['b', b, 'unsubscribed, never answers'], ['c', c, 'subscribed btcusdt depth, never answers']]) {
    log('silence', { socket: name, what, openMs: s.openMs, protocolPingsAtMs: s.pings, messages: counts[name], closed: s.closed ?? 'open at 90 s' });
    s.ws.terminate();
  }
}

async function deflate() {
  const s = open(SITE_URL, { perMessageDeflate: true });
  await waitOpen(s);
  await sleep(500);
  log('deflate', { url: SITE_URL, openMs: s.openMs, upgrade: s.upgrade });
  s.ws.terminate();
}

const mode = process.argv[2] ?? 'all';
const t0 = Date.now();
log('start', { mode, at: new Date().toISOString() });
if (mode === 'official' || mode === 'all') await official();
if (mode === 'deflate' || mode === 'all') await deflate();
if (mode === 'errors' || mode === 'all') await errors();
if (mode === 'book' || mode === 'all') await book();
if (mode === 'silence' || mode === 'all') await silence();
log('done', { seconds: Math.round((Date.now() - t0) / 1000) });
process.exit(0);
