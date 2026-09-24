// OmniX (formerly CoinChief) futures WebSocket probe: the depth channel, frame compression, snapshot or delta, level order, size unit, keepalive, silence, errors, and a batch of contracts on one connection.
// The socket is the ChainUP futures market socket that the venue's own contract config names, wss://futuresws.coinchief.live/kline-api/ws.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/omnix/ws-probe.mjs [book|batch|silence|deflate]
//   book     depth_step0 on four contracts plus a ticker and trade channel for 60 s, a REST book compare, and error cases. About 75 s.
//   batch    depth_step0 on every contract on one connection for 60 s.
//   silence  three sockets that differ only in what the client subscribes and whether it answers pings, for up to 120 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep a few raw frames. Recorded in docs/profiles/omnix/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_ = 'wss://futuresws.coinchief.live/kline-api/ws';
const FAPI = 'https://futuresopenapi.coinchief.live';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel, cb = '1') => JSON.stringify({ event: 'sub', params: { channel, cb_id: cb } });
const chan = (contract) => `market_${contract.toLowerCase().replace(/-/g, '_').replace(/^e_(.*)_usdt$/, 'e_$1usdt')}_depth_step0`; // E-BTC-USDT to market_e_btcusdt_depth_step0

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Every frame is decoded here, so the stats show what arrived gzipped and what arrived as text.
function decode(data, isBinary) {
  if (!isBinary) return { text: data.toString('utf8'), gz: false, wire: data.length };
  const buf = Buffer.from(data);
  const t0 = performance.now();
  const text = gunzipSync(buf).toString('utf8');
  return { text, gz: true, wire: buf.length, gunzipUs: (performance.now() - t0) * 1000 };
}

function open(url = URL_, opts = { perMessageDeflate: false }) {
  const t0 = Date.now();
  const ws = new WebSocket(url, opts);
  const opened = new Promise((res, rej) => {
    ws.once('open', () => res(Date.now() - t0));
    ws.once('error', rej);
    ws.once('unexpected-response', (_req, resp) => rej(new Error(`HTTP ${resp.statusCode}`)));
  });
  return { ws, opened };
}

async function contracts() {
  const r = await fetch(`${FAPI}/fapi/v1/contracts`);
  return (await r.json()).map((c) => c.symbol);
}

async function book() {
  const watch = ['E-BTC-USDT', 'E-ETH-USDT', 'E-SOL-USDT', 'E-SYNX-USDT'];
  const { ws, opened } = open();
  const openMs = await opened;
  log('open', { url: URL_, openMs, extensions: ws.extensions });
  const st = {};
  const pings = [];
  const other = [];
  let gzFrames = 0, textFrames = 0, wireBytes = 0, textBytes = 0;
  const firstAt = {};
  const subAt = Date.now();
  let pongReplies = 0;
  const tradeLag = [];
  const depthLag = [];
  ws.on('message', (data, isBinary) => {
    const at = Date.now();
    const d = decode(data, isBinary);
    d.gz ? gzFrames++ : textFrames++;
    wireBytes += d.wire; textBytes += d.text.length;
    const m = JSON.parse(d.text);
    if (m.ping !== undefined) {
      pings.push({ at, ping: m.ping, gz: d.gz });
      ws.send(JSON.stringify({ pong: m.ping }));
      pongReplies++;
      if (pings.length === 1) capture('ping.txt', d.text);
      return;
    }
    const ch = m.channel;
    if (ch && m.tick && ch.endsWith('_depth_step0')) {
      const s = (st[ch] ??= { frames: 0, bidsN: new Set(), asksN: new Set(), bidsDesc: 0, asksAsc: 0, same: 0, prev: null, ts: [], keys: new Set(), tickKeys: new Set(), gaps: [], lastAt: 0, maxGap: 0, oneSided: 0, numTypes: new Set() });
      s.frames++;
      Object.keys(m).forEach((k) => s.keys.add(k));
      Object.keys(m.tick).forEach((k) => s.tickKeys.add(k));
      const bids = m.tick.buys ?? m.tick.bids ?? [];
      const asks = m.tick.asks ?? [];
      s.bidsN.add(bids.length); s.asksN.add(asks.length);
      if (bids.length && asks.length) s.numTypes.add(typeof bids[0][0] + '/' + typeof bids[0][1]);
      if (!bids.length || !asks.length) s.oneSided++;
      if (bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0])) s.bidsDesc++;
      if (asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0])) s.asksAsc++;
      const sig = JSON.stringify([bids, asks]);
      if (s.prev === sig) s.same++;
      s.prev = sig;
      s.ts.push(m.ts);
      depthLag.push(at - m.ts);
      if (s.lastAt) s.maxGap = Math.max(s.maxGap, at - s.lastAt);
      s.lastAt = at;
      s.last = { bids, asks, at, ts: m.ts };
      if (!firstAt[ch]) { firstAt[ch] = at - subAt; capture('depth_first.txt', d.text); }
      else if (s.frames === 2) capture('depth_second.txt', d.text);
      return;
    }
    if (ch?.endsWith('_trade_ticker') && Array.isArray(m.tick?.data)) {
      for (const t of m.tick.data) tradeLag.push(at - t.ts); // arrival minus the trade's own ms time, clock offset about 1 ms per rest-probe host
    }
    other.push({ at: at - subAt, text: d.text.slice(0, 300), gz: d.gz });
    if (other.length <= 30) capture('other.txt', d.text);
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }));
  for (const c of watch) ws.send(sub(chan(c)));
  ws.send(sub('market_e_btcusdt_ticker', 't'));
  ws.send(sub('market_e_btcusdt_trade_ticker', 'tr'));
  await sleep(1500);
  // Error cases, after the real subscriptions are live.
  ws.send(sub('market_e_nopeusdt_depth_step0', 'unknown'));
  ws.send(sub('market_btcusdt_depth_step0', 'spot-on-futures'));
  ws.send(sub('market_e_btcusdt_depth_step5', 'step5'));
  ws.send(sub('market_e_btcusdt_depth_step0', 'twice'));
  ws.send(sub('market_e_btcusdt_nope', 'badchannel'));
  ws.send('not json');
  ws.send(JSON.stringify({ event: 'unsub', params: { channel: chan('E-SOL-USDT'), cb_id: 'u' } }));
  const unsubAt = Date.now();
  await sleep(28_000);
  // REST book at one instant against the socket's last book, for the size unit.
  const rest = await (await fetch(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT&limit=30`)).json();
  const wsB = st[chan('E-BTC-USDT')]?.last;
  if (wsB) {
    const wsMap = new Map([...wsB.bids, ...wsB.asks].map(([p, q]) => [p, q]));
    const both = [...rest.bids, ...rest.asks].filter(([p]) => wsMap.has(p));
    log('size_compare', { restLevels: rest.bids.length + rest.asks.length, wsLevels: wsB.bids.length + wsB.asks.length, samePrice: both.length, sameSize: both.filter(([p, q]) => wsMap.get(p) === q).length, wsAgeMs: Date.now() - wsB.at, restTop: [rest.bids[0], rest.asks[0]], wsTop: [wsB.bids[0], wsB.asks[0]] });
  }
  await sleep(30_000);
  const dur = (Date.now() - subAt) / 1000;
  for (const [ch, s] of Object.entries(st)) {
    const tsd = s.ts.slice(1).map((t, i) => t - s.ts[i]);
    log('depth_stats', { ch, frames: s.frames, perSec: +(s.frames / dur).toFixed(2), firstMs: firstAt[ch], bidsN: [...s.bidsN], asksN: [...s.asksN], bidsDescFrames: s.bidsDesc, asksAscFrames: s.asksAsc, identicalToPrev: s.same, oneSided: s.oneSided, maxGapMs: s.maxGap, keys: [...s.keys], tickKeys: [...s.tickKeys], numTypes: [...s.numTypes], tsStepMin: Math.min(...tsd), tsStepMedian: tsd.sort((a, b) => a - b)[tsd.length >> 1], lastFrameAfterUnsubMs: ch === chan('E-SOL-USDT') ? s.lastAt - unsubAt : undefined });
  }
  const pingGaps = pings.slice(1).map((p, i) => p.at - pings[i].at);
  log('pings', { n: pings.length, gz: [...new Set(pings.map((p) => p.gz))], gapsMs: pingGaps, sample: pings[0]?.ping, pongReplies });
  const q = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? { n: s.length, min: s[0], median: s[s.length >> 1], max: s[s.length - 1] } : null; };
  log('lag', { tradeArrivalMinusTradeTsMs: q(tradeLag), depthArrivalMinusTsMs: q(depthLag) });
  log('frames', { gzFrames, textFrames, wireBytes, textBytes, ratio: +(textBytes / Math.max(1, wireBytes)).toFixed(2) });
  log('other_frames', { n: other.length, list: other.slice(0, 30) });
  ws.terminate();
}

async function batch() {
  const all = await contracts();
  const { ws, opened } = open();
  const openMs = await opened;
  const seen = new Map();
  let frames = 0, wire = 0, text = 0, gunzipUs = 0, parseUs = 0, errors = [];
  const perSec = new Map();
  const t0 = Date.now();
  ws.on('message', (data, isBinary) => {
    const d = decode(data, isBinary);
    const p0 = performance.now();
    const m = JSON.parse(d.text);
    parseUs += (performance.now() - p0) * 1000;
    if (m.ping !== undefined) { ws.send(JSON.stringify({ pong: m.ping })); return; }
    if (!m.tick) { errors.push(d.text.slice(0, 200)); return; }
    frames++; wire += d.wire; text += d.text.length; gunzipUs += d.gunzipUs ?? 0;
    seen.set(m.channel, (seen.get(m.channel) ?? 0) + 1);
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
  });
  for (const c of all) ws.send(sub(chan(c)));
  await sleep(60_000);
  const rates = [...perSec.values()].sort((a, b) => a - b);
  const counts = all.map((c) => [c, seen.get(chan(c)) ?? 0]);
  log('batch', { contracts: all.length, openMs, delivering: counts.filter(([, n]) => n > 0).length, silent: counts.filter(([, n]) => n === 0).map(([c]) => c), frames, perSecMedian: rates[rates.length >> 1], perSecMax: rates[rates.length - 1], wireKBps: +(wire / 60 / 1024).toFixed(1), textKBps: +(text / 60 / 1024).toFixed(1), bytesPerFrameWire: Math.round(wire / frames), gunzipUsPerFrame: +(gunzipUs / frames).toFixed(1), parseUsPerFrame: +(parseUs / frames).toFixed(1), quietest: counts.sort((a, b) => a[1] - b[1]).slice(0, 5), busiest: counts.slice(-3), otherFrames: errors.slice(0, 5) });
  ws.terminate();
}

async function silence() {
  const cases = [
    { name: 'sub_no_pong', subscribe: true, pong: false },
    { name: 'nosub_pong', subscribe: false, pong: true },
    { name: 'nosub_no_pong', subscribe: false, pong: false },
  ];
  const results = await Promise.all(cases.map(async (c) => {
    const { ws, opened } = open();
    await opened;
    const t0 = Date.now();
    let pings = 0, data = 0, lastPingAt = 0;
    return new Promise((res) => {
      const done = (why, code) => { res({ ...c, why, code, afterMs: Date.now() - t0, pings, data, lastPingMs: lastPingAt ? lastPingAt - t0 : null }); ws.terminate(); };
      ws.on('message', (d, isBinary) => {
        const m = JSON.parse(decode(d, isBinary).text);
        if (m.ping !== undefined) { pings++; lastPingAt = Date.now(); if (c.pong) ws.send(JSON.stringify({ pong: m.ping })); } else data++;
      });
      ws.on('ping', () => { pings += 1000; }); // a protocol level ping would show as a jump of 1000
      ws.on('close', (code) => done('closed', code));
      if (c.subscribe) ws.send(sub(chan('E-BTC-USDT')));
      setTimeout(() => done('timeout', null), 120_000);
    });
  }));
  for (const r of results) log('silence', r);
}

async function deflate() {
  const { ws, opened } = open(URL_, { perMessageDeflate: true });
  let hdr;
  ws.once('upgrade', (res) => { hdr = res.headers['sec-websocket-extensions']; });
  await opened;
  log('deflate', { requested: true, negotiated: hdr ?? null, extensions: ws.extensions });
  ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
