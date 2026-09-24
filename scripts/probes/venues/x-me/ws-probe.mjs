// x.me futures WebSocket probe: book channel shape and cadence, gzip framing, keepalive, silence, errors, and every active perpetual on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/x-me/ws-probe.mjs [book|errors|batch|tickers|silence|deflate|spot]
//   book     depth_step0 on four perps, the BTC ticker and trade channels, for 45 s, with one REST depth read to compare sizes. About 50 s.
//   errors   short sockets for unknown and closed symbols, other depth steps, bad frames, a double subscription and an unsubscribe. About 20 s.
//   batch    depth_step0 on every active perp on one connection for 40 s.
//   tickers  the ticker channel, which carries mark, index and funds_rate, on every active perp on one connection for 40 s.
//   silence  three sockets for up to 100 s: subscribed and never answering pings, subscribed and answering every ping, unsubscribed and silent.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   spot     the spot socket, depth_step0 on BTCUSDT for 8 s, to name it in the coverage matrix.
// Set PROBE_OUT_DIR to keep a few raw frames. Recorded in docs/profiles/x-me/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FUT_URL = 'wss://futuresws.x.me/kline-api/ws';
const SPOT_URL = 'wss://ws.x.me/kline-api/ws';
const API = 'https://futuresopenapi.x.me/fapi/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel, cb = '1') => JSON.stringify({ event: 'sub', params: { channel, cb_id: cb } });
const unsub = (channel, cb = '1') => JSON.stringify({ event: 'unsub', params: { channel, cb_id: cb } });
const depthChannel = (contract) => `market_${contract.toLowerCase().replace(/-/g, '_').replace(/_usdt$/, 'usdt')}_depth_step0`;
const q = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);

function capture(name, text, max = 40) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  capture.n = capture.n || {};
  capture.n[name] = (capture.n[name] || 0) + 1;
  if (capture.n[name] <= max) appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Every frame the server sends is binary gzip. Returns the parsed object, the text, and the decode cost.
function decode(data, isBinary) {
  const t = process.hrtime.bigint();
  const text = isBinary ? gunzipSync(data).toString('utf8') : data.toString('utf8');
  let obj = null;
  try { obj = JSON.parse(text); } catch { obj = null; }
  return { obj, text, us: Number(process.hrtime.bigint() - t) / 1000, isBinary };
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false, handshakeTimeout: 10_000 });
  ws.t0 = t0;
  ws.on('upgrade', (res) => { ws.openMs = Date.now() - t0; ws.upgradeHeaders = res.headers; ws.status = res.statusCode; });
  ws.on('unexpected-response', (req, res) => {
    let b = '';
    res.on('data', (d) => (b += d)).on('end', () => log('refused', { url, status: res.statusCode, body: b.slice(0, 200) }));
  });
  ws.on('error', (e) => log('socket_error', { url, message: e.message }));
  return new Promise((resolve) => ws.once('open', () => resolve(ws)).once('close', () => resolve(ws)));
}

async function activeContracts() {
  const res = await fetch(`${API}/contracts`);
  const all = await res.json();
  return { active: all.filter((c) => c.status === 1), closed: all.filter((c) => c.status !== 1) };
}

async function book() {
  const contracts = ['E-BTC-USDT', 'E-ETH-USDT', 'E-TRX-USDT', 'E-DOS-USDT'];
  const { active } = await activeContracts();
  const mult = Object.fromEntries(active.map((c) => [c.symbol, c.multiplier]));
  const ws = await open(FUT_URL);
  log('open', { url: FUT_URL, status: ws.status, openMs: ws.openMs, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, server: ws.upgradeHeaders?.server });
  const stats = {};
  const other = {};
  const pings = [];
  let textFrames = 0;
  const tSub = Date.now();
  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    if (!isBinary) textFrames++;
    const { obj, text, us } = decode(data, isBinary);
    if (!obj) return log('unparsed', { text: text.slice(0, 200) });
    if (obj.ping !== undefined) { pings.push(now - ws.t0); capture('ping.txt', text, 5); ws.send(JSON.stringify({ pong: obj.ping })); return; }
    const ch = obj.channel;
    const st = ch && stats[ch];
    if (st && obj.tick) {
      const bids = obj.tick.buys || [];
      const asks = obj.tick.asks || [];
      if (!st.n) { st.firstMs = now - tSub; st.firstKeys = Object.keys(obj).join(','); st.tickKeys = Object.keys(obj.tick).join(','); capture('first-book.txt', text, 8); }
      st.n++;
      st.bytes += data.length;
      st.us.push(us);
      if (st.last) st.gaps.push(now - st.last);
      st.last = now;
      st.bidLv.push(bids.length);
      st.askLv.push(asks.length);
      for (let i = 1; i < bids.length; i++) if (!(bids[i][0] < bids[i - 1][0])) { st.bidOrderBad++; break; }
      for (let i = 1; i < asks.length; i++) if (!(asks[i][0] > asks[i - 1][0])) { st.askOrderBad++; break; }
      if (bids.length && asks.length && bids[0][0] >= asks[0][0]) st.crossed++;
      if (!bids.length || !asks.length) st.oneSided++;
      const key = JSON.stringify(obj.tick);
      if (key === st.prevKey) st.repeats++;
      st.prevKey = key;
      if (bids.some((l) => l[1] === 0) || asks.some((l) => l[1] === 0)) st.zeroSize++;
      if (bids.some((l) => !Number.isInteger(l[1])) || asks.some((l) => !Number.isInteger(l[1]))) st.fracSize++;
      if (typeof bids[0]?.[0] !== 'number') st.nonNumber++;
      st.lastTick = obj.tick;
      st.lastTickAt = now;
      if (obj.ts !== undefined) st.tsLag.push(now - obj.ts);
      if (obj.tick.ts !== undefined) st.tickTsLag.push(now - obj.tick.ts);
      return;
    }
    const k = ch || obj.event_rep || 'other';
    other[k] = other[k] || { n: 0, first: null };
    other[k].n++;
    if (!other[k].first) { other[k].first = text.slice(0, 600); capture('other.txt', text, 20); }
  });
  for (const c of contracts) {
    const ch = depthChannel(c);
    stats[ch] = { contract: c, n: 0, bytes: 0, us: [], gaps: [], bidLv: [], askLv: [], bidOrderBad: 0, askOrderBad: 0, crossed: 0, oneSided: 0, repeats: 0, zeroSize: 0, fracSize: 0, nonNumber: 0, tsLag: [], tickTsLag: [] };
    ws.send(sub(ch, c));
  }
  ws.send(sub('market_e_btcusdt_ticker', 'tk'));
  ws.send(sub('market_e_btcusdt_trade_ticker', 'tr'));
  ws.send(sub('review', 'rv'));
  await sleep(20_000);
  // One REST depth read of BTC, compared with the last socket book seen before it.
  const btcCh = depthChannel('E-BTC-USDT');
  const sock = stats[btcCh].lastTick;
  const sockAt = stats[btcCh].lastTickAt;
  const t = Date.now();
  const rest = await (await fetch(`${API}/depth?contractName=E-BTC-USDT&limit=30`)).json();
  const restMs = Date.now() - t;
  const sockBid = new Map(sock.buys.map((l) => [l[0], l[1]]));
  const sockAsk = new Map(sock.asks.map((l) => [l[0], l[1]]));
  let same = 0, samePrice = 0;
  for (const [p, s] of rest.bids.concat(rest.asks)) {
    const m = sockBid.has(p) ? sockBid : sockAsk.has(p) ? sockAsk : null;
    if (m) { samePrice++; if (m.get(p) === s) same++; }
  }
  log('size_compare', { contract: 'E-BTC-USDT', multiplier: mult['E-BTC-USDT'], sockAgeMs: t - sockAt, restMs, restLevels: [rest.bids.length, rest.asks.length], sockTop: [sock.buys[0], sock.asks[0]], restTop: [rest.bids[0], rest.asks[0]], pricesInBoth: samePrice, sizesEqual: same });
  await sleep(25_000);
  ws.terminate();
  for (const st of Object.values(stats)) {
    log('stream', {
      contract: st.contract, multiplier: mult[st.contract], frames: st.n, firstMs: st.firstMs, firstKeys: st.firstKeys, tickKeys: st.tickKeys,
      gapMs: { min: q(st.gaps, 0), med: q(st.gaps, 0.5), p90: q(st.gaps, 0.9), max: q(st.gaps, 1) },
      bidLevels: [Math.min(...st.bidLv), Math.max(...st.bidLv)], askLevels: [Math.min(...st.askLv), Math.max(...st.askLv)],
      bidOrderBad: st.bidOrderBad, askOrderBad: st.askOrderBad, crossed: st.crossed, oneSided: st.oneSided, repeats: st.repeats, zeroSize: st.zeroSize, fracSize: st.fracSize, nonNumber: st.nonNumber,
      avgBytes: st.n ? Math.round(st.bytes / st.n) : 0, decodeUsMed: q(st.us, 0.5),
      tsLagMs: st.tsLag.length ? { min: q(st.tsLag, 0), med: q(st.tsLag, 0.5), max: q(st.tsLag, 1) } : null,
      tickTsLagMs: st.tickTsLag.length ? { min: q(st.tickTsLag, 0), med: q(st.tickTsLag, 0.5), max: q(st.tickTsLag, 1) } : null,
    });
  }
  for (const [k, v] of Object.entries(other)) log('other_channel', { channel: k, frames: v.n, first: v.first });
  log('pings', { count: pings.length, atMs: pings.slice(0, 12), textFrames });
}

async function shortSocket(label, frames, ms = 4000) {
  const ws = await open(FUT_URL);
  const got = [];
  ws.on('message', (data, isBinary) => {
    const { obj, text } = decode(data, isBinary);
    if (obj && obj.ping !== undefined) return;
    got.push(text.slice(0, 260));
  });
  let closed = null;
  ws.on('close', (code, reason) => (closed = { code, reason: reason.toString(), atMs: Date.now() - ws.t0 }));
  for (const f of frames) { ws.send(f); await sleep(150); }
  await sleep(ms);
  const summary = { label, frames: got.length, first: got.slice(0, 3), closed };
  ws.terminate();
  log('error_case', summary);
  return got;
}

async function errors() {
  const { closed } = await activeContracts();
  const closedName = closed[0]?.symbol ?? 'E-XTZ-USDT';
  await shortSocket('unknown symbol', [sub('market_e_nopeusdt_depth_step0')]);
  await shortSocket(`closed symbol ${closedName}`, [sub(depthChannel(closedName))]);
  await shortSocket('depth_step1', [sub('market_e_btcusdt_depth_step1')], 2500);
  await shortSocket('depth_step5', [sub('market_e_btcusdt_depth_step5')], 2500);
  await shortSocket('unknown channel', [sub('market_e_btcusdt_nope')]);
  await shortSocket('not json', ['hello'], 3000);
  await shortSocket('unknown event', [JSON.stringify({ event: 'nope', params: { channel: 'market_e_btcusdt_depth_step0', cb_id: '1' } })], 3000);
  await shortSocket('uppercase symbol', [sub('market_E_BTCUSDT_depth_step0')], 3000);
  await shortSocket('req event', [JSON.stringify({ event: 'req', params: { channel: 'market_e_btcusdt_depth_step0', cb_id: '1' } })], 3000);
  // Double subscription, then unsubscribe: count frames in each phase.
  const ws = await open(FUT_URL);
  let phase = 'double';
  const counts = { double: 0, afterUnsub: 0 };
  const acks = [];
  ws.on('message', (data, isBinary) => {
    const { obj, text } = decode(data, isBinary);
    if (!obj || obj.ping !== undefined) return;
    if (obj.tick) counts[phase]++;
    else acks.push(text.slice(0, 200));
  });
  ws.send(sub('market_e_btcusdt_depth_step0', 'a'));
  ws.send(sub('market_e_btcusdt_depth_step0', 'b'));
  await sleep(4000);
  ws.send(unsub('market_e_btcusdt_depth_step0', 'a'));
  await sleep(500);
  phase = 'afterUnsub';
  await sleep(3000);
  ws.terminate();
  log('double_and_unsub', { framesIn4sDouble: counts.double, framesIn3sAfterUnsub: counts.afterUnsub, nonBookFrames: acks.slice(0, 3) });
}

async function batch() {
  const { active } = await activeContracts();
  const ws = await open(FUT_URL);
  log('open', { streams: active.length, openMs: ws.openMs });
  const perStream = new Map(active.map((c) => [depthChannel(c.symbol), 0]));
  let frames = 0, bytes = 0, other = 0;
  const us = [];
  const perSec = [];
  let secCount = 0;
  const tick = setInterval(() => { perSec.push(secCount); secCount = 0; }, 1000);
  const t0 = Date.now();
  let lastFirst = 0;
  ws.on('message', (data, isBinary) => {
    const d = decode(data, isBinary);
    if (d.obj && d.obj.ping !== undefined) { ws.send(JSON.stringify({ pong: d.obj.ping })); return; }
    if (d.obj?.tick && perStream.has(d.obj.channel)) {
      if (perStream.get(d.obj.channel) === 0) lastFirst = Date.now() - t0;
      perStream.set(d.obj.channel, perStream.get(d.obj.channel) + 1);
      frames++; secCount++; bytes += data.length; us.push(d.us);
    } else other++;
  });
  for (const c of active) ws.send(sub(depthChannel(c.symbol), c.symbol));
  const subMs = Date.now() - t0;
  await sleep(40_000);
  clearInterval(tick);
  ws.terminate();
  const silent = [...perStream].filter(([, n]) => n === 0).map(([ch]) => ch);
  const counts = [...perStream.values()];
  log('batch', {
    streams: active.length, subscribeSendMs: subMs, lastFirstFrameMs: lastFirst, frames, framesPerSec: +(frames / 40).toFixed(1),
    perSec: { med: q(perSec, 0.5), max: q(perSec, 1) }, bytesPerSec: Math.round(bytes / 40), avgBytes: Math.round(bytes / Math.max(frames, 1)),
    decodeParseUs: { med: +q(us, 0.5).toFixed(1), p90: +q(us, 0.9).toFixed(1) }, framesPerStream: { min: q(counts, 0), med: q(counts, 0.5), max: q(counts, 1) },
    silentStreams: silent.length, silentSample: silent.slice(0, 10), otherFrames: other,
  });
}

// The ticker channel carries mark, index and funds_rate, so it is measured as a candidate anchor source for every active perp.
async function tickers() {
  const { active } = await activeContracts();
  const ws = await open(FUT_URL);
  const tickerChannel = (s) => depthChannel(s).replace(/_depth_step0$/, '_ticker');
  const per = new Map(active.map((c) => [tickerChannel(c.symbol), { n: 0, gaps: [], last: 0, markChanges: 0, indexChanges: 0, rateChanges: 0, prev: null, zeroMark: 0 }]));
  const t0 = Date.now();
  let frames = 0, bytes = 0, sample = null, fields = [];
  ws.on('message', (data, isBinary) => {
    const d = decode(data, isBinary);
    if (d.obj && d.obj.ping !== undefined) { ws.send(JSON.stringify({ pong: d.obj.ping })); return; }
    const st = d.obj && per.get(d.obj.channel);
    if (!st || !d.obj.tick) return;
    const now = Date.now();
    frames++; bytes += data.length;
    if (!sample) { sample = d.text.slice(0, 500); fields = Object.keys(d.obj.tick); }
    if (st.last) st.gaps.push(now - st.last);
    st.last = now;
    st.n++;
    const t = d.obj.tick;
    if (Number(t.mark) === 0) st.zeroMark++;
    if (st.prev) {
      if (t.mark !== st.prev.mark) st.markChanges++;
      if (t.index !== st.prev.index) st.indexChanges++;
      if (t.funds_rate !== st.prev.funds_rate) st.rateChanges++;
    }
    st.prev = t;
  });
  for (const c of active) ws.send(sub(tickerChannel(c.symbol), c.symbol));
  await sleep(40_000);
  ws.terminate();
  const rows = [...per.values()];
  const maxGaps = rows.filter((r) => r.gaps.length).map((r) => Math.max(...r.gaps));
  const allGaps = rows.flatMap((r) => r.gaps);
  log('tickers', {
    streams: active.length, elapsedMs: Date.now() - t0, frames, framesPerSec: +(frames / 40).toFixed(1), avgBytes: Math.round(bytes / Math.max(frames, 1)),
    silentStreams: rows.filter((r) => r.n === 0).length, streamsUnder20Frames: rows.filter((r) => r.n < 20).length,
    framesPerStream: { min: q(rows.map((r) => r.n), 0), med: q(rows.map((r) => r.n), 0.5), max: q(rows.map((r) => r.n), 1) },
    gapMs: { med: q(allGaps, 0.5), p90: q(allGaps, 0.9), p99: q(allGaps, 0.99) }, worstStreamMaxGapMs: { med: q(maxGaps, 0.5), max: q(maxGaps, 1) },
    markChangesMed: q(rows.map((r) => r.markChanges), 0.5), indexChangesMed: q(rows.map((r) => r.indexChanges), 0.5), rateChangesMed: q(rows.map((r) => r.rateChanges), 0.5),
    streamsWithZeroMark: rows.filter((r) => r.zeroMark).length, fields, sample,
  });
}

async function silence() {
  const mk = async (label, subscribe, answer) => {
    const ws = await open(FUT_URL);
    const s = { label, pings: [], books: 0, close: null };
    ws.on('message', (data, isBinary) => {
      const { obj } = decode(data, isBinary);
      if (obj && obj.ping !== undefined) { s.pings.push(Date.now() - ws.t0); if (answer) ws.send(JSON.stringify({ pong: obj.ping })); return; }
      if (obj?.tick) s.books++;
    });
    ws.on('close', (code, reason) => (s.close = { code, reason: reason.toString(), atMs: Date.now() - ws.t0 }));
    if (subscribe) ws.send(sub('market_e_btcusdt_depth_step0'));
    s.ws = ws;
    return s;
  };
  const socks = [await mk('subscribed, never answers ping', true, false), await mk('subscribed, answers every ping', true, true), await mk('unsubscribed, silent', false, false)];
  const t0 = Date.now();
  while (Date.now() - t0 < 100_000 && socks.some((s) => !s.close)) await sleep(500);
  for (const s of socks) {
    s.ws.terminate();
    log('silence', { label: s.label, pingsAtMs: s.pings.slice(0, 15), pingCount: s.pings.length, books: s.books, close: s.close ?? 'open at 100 s' });
  }
}

async function deflate() {
  const ws = await open(FUT_URL, { deflate: true });
  log('deflate', { status: ws.status, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, headers: ws.upgradeHeaders });
  ws.terminate();
}

async function spot() {
  const ws = await open(SPOT_URL);
  log('open', { url: SPOT_URL, status: ws.status, openMs: ws.openMs });
  let n = 0, first = null, pings = 0;
  ws.on('message', (data, isBinary) => {
    const { obj, text } = decode(data, isBinary);
    if (obj && obj.ping !== undefined) { pings++; return; }
    n++;
    if (!first) first = text.slice(0, 400);
  });
  ws.send(sub('market_btcusdt_depth_step0'));
  await sleep(8000);
  ws.terminate();
  log('spot', { frames: n, pings, first });
}

const mode = process.argv[2] || 'book';
const modes = { book, errors, batch, tickers, silence, deflate, spot };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
