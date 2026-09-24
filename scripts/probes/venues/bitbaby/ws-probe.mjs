// Bitbaby futures WebSocket probe: the web app's market socket, its depth and ticker channels, frame compression, level order, size unit, keepalive, silence and a batch of every perpetual on one connection.
// Bitbaby publishes no working API documentation, so the socket URL, the `compress` query and the channel names come from the web app's own bundle, see docs/profiles/bitbaby/websocket.md.
// Public, unauthenticated, read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitbaby/ws-probe.mjs [book|silence|batch|tickers|deflate]
//   book     depth and ticker on five perpetuals over a compressed and an uncompressed socket for 60 s, error cases, and a Binance book read beside it, about 65 s.
//   silence  four sockets that differ only in what the client subscribes and answers, for up to 120 s.
//   batch    the finest depth of every perpetual in the catalog on one connection for 60 s.
//   tickers  the ticker channel of every perpetual on one connection for 60 s, for the anchor fields and their cadence.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames.
// Recorded in docs/profiles/bitbaby/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://web-api.bitbaby.com/futures/ws';
const CATALOG_URL = 'https://web-api.bitbaby.com/futures/api/common/public_info_v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// With `compress=1` every frame is a binary zlib stream flushed without its trailer, so it needs a sync-flush inflate.
function decode(data, isBinary) {
  if (!isBinary) return { text: data.toString('utf8'), wire: 'text' };
  return { text: zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8'), wire: 'zlib' };
}

async function catalog() {
  const res = await fetch(CATALOG_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const body = await res.json();
  return body.data.contractList;
}

function channelOf(c, kind) {
  return kind === 'ticker' ? `market_${c.subSymbol}` : `market_${c.subSymbol}_depth_${c.coinResultVo.depthList[0]}`;
}

function open(url, name, onFrame, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  const st = { name, t0, openMs: null, closeMs: null, closeCode: null, frames: 0, bytes: 0, inflated: 0, pings: 0, protoPings: 0, wire: {} };
  ws.on('upgrade', (res) => { st.extensions = res.headers['sec-websocket-extensions'] ?? null; });
  ws.on('open', () => { st.openMs = Date.now() - t0; opts.onOpen?.(ws); });
  ws.on('ping', () => { st.protoPings++; });
  ws.on('message', (data, isBinary) => {
    st.frames++;
    st.bytes += data.length;
    let d;
    try { d = decode(data, isBinary); } catch (e) { log('decode_error', { name, err: e.message }); return; }
    st.inflated += d.text.length;
    st.wire[d.wire] = (st.wire[d.wire] ?? 0) + 1;
    let j;
    try { j = JSON.parse(d.text); } catch { log('non_json', { name, text: d.text.slice(0, 200) }); return; }
    if (j.ping !== undefined) {
      st.pings++;
      (st.pingAtMs ??= []).push(Date.now() - t0);
      if (opts.pong !== false) ws.send(JSON.stringify({ pong: j.ping }));
    }
    onFrame(j, d, Date.now());
  });
  ws.on('close', (code, reason) => { st.closeMs = Date.now() - t0; st.closeCode = code; st.closeReason = reason.toString(); });
  ws.on('error', (e) => { st.error = e.message; });
  return { ws, st };
}

const sub = (ws, channel, id) => ws.send(JSON.stringify({ event: 'sub', params: { channel, cb_id: String(id) } }));

// Each depth frame is checked against the previous frame of the same stream to tell a full snapshot from a delta.
function bookStats() {
  return { frames: 0, gaps: [], last: null, lastAt: null, bidLv: [], askLv: [], bidOrderBad: 0, askOrderBad: 0, identical: 0, zeroSize: 0, keys: new Set(), crossed: 0, cumOk: 0, cumBad: 0 };
}

function checkBook(s, tick, at) {
  s.frames++;
  if (s.lastAt !== null) s.gaps.push(at - s.lastAt);
  s.lastAt = at;
  for (const k of Object.keys(tick)) s.keys.add(k);
  const bids = tick.buys ?? tick.bids ?? [];
  const asks = tick.asks ?? [];
  s.bidLv.push(bids.length);
  s.askLv.push(asks.length);
  for (let i = 1; i < bids.length; i++) if (Number(bids[i][0]) >= Number(bids[i - 1][0])) { s.bidOrderBad++; break; }
  for (let i = 1; i < asks.length; i++) if (Number(asks[i][0]) <= Number(asks[i - 1][0])) { s.askOrderBad++; break; }
  for (const l of [...bids, ...asks]) if (Number(l[1]) === 0) s.zeroSize++;
  if (bids.length && asks.length && Number(bids[0][0]) >= Number(asks[0][0])) s.crossed++;
  // The third element looked like a running sum of sizes from the touch.
  let cum = 0;
  let ok = true;
  for (const l of asks) { cum += Number(l[1]); if (l.length > 2 && Math.abs(cum - Number(l[2])) > 1e-6 * Math.max(1, cum)) ok = false; }
  if (ok) s.cumOk++; else s.cumBad++;
  const sig = JSON.stringify([bids, asks]);
  if (s.last === sig) s.identical++;
  s.last = sig;
  s.top = { bid: bids[0], ask: asks[0] };
}

function summarizeBook(stream, s) {
  return {
    stream,
    frames: s.frames,
    gapMs: { min: q(s.gaps, 0), p50: q(s.gaps, 0.5), p90: q(s.gaps, 0.9), max: q(s.gaps, 1) },
    bidLevels: { min: q(s.bidLv, 0), max: q(s.bidLv, 1) },
    askLevels: { min: q(s.askLv, 0), max: q(s.askLv, 1) },
    bidsNotDescending: s.bidOrderBad,
    asksNotAscending: s.askOrderBad,
    zeroSizeLevels: s.zeroSize,
    crossed: s.crossed,
    identicalToPrevious: s.identical,
    askCumulativeColumnOk: s.cumOk,
    askCumulativeColumnBad: s.cumBad,
    tickKeys: [...s.keys],
    top: s.top,
  };
}

async function binanceTop(symbol) {
  try {
    const t = Date.now();
    const r = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=5`);
    const j = await r.json();
    return { symbol, ms: Date.now() - t, bid: j.bids?.[0], ask: j.asks?.[0] };
  } catch (e) {
    return { symbol, error: e.message };
  }
}

async function book() {
  const cl = await catalog();
  const pick = ['E-BTC-USDT', 'E-ETH-USDT', 'E-IOTX-USDT', 'E-BTC-USDC', 'E-XAU-USDT'].map((n) => cl.find((c) => c.contractName === n)).filter(Boolean);
  log('picked', { contracts: pick.map((c) => ({ name: c.contractName, sub: c.subSymbol, multiplier: c.multiplier, depthList: c.coinResultVo.depthList })) });
  const stats = new Map();
  const acks = [];
  const errors = [];
  const tickers = new Map();
  let firstFrameAt = new Map();
  let subAt = null;
  const onFrame = (tag) => (j, d, at) => {
    if (j.ping !== undefined) { capture('ping.jsonl', d.text); return; }
    if (j.eventResp || j.event_rep) { acks.push({ tag, channel: j.channel, eventResp: j.eventResp ?? j.event_rep, hasTick: j.tick !== undefined, status: j.status, code: j.code }); capture('ack.jsonl', d.text); }
    if (j.channel === undefined || j.tick === undefined) { errors.push({ tag, text: d.text.slice(0, 300) }); capture('other.jsonl', d.text); return; }
    const key = `${tag}|${j.channel}`;
    if (!firstFrameAt.has(key) && subAt !== null) firstFrameAt.set(key, at - subAt);
    if (j.channel.includes('_depth_')) {
      if (!stats.has(key)) { stats.set(key, bookStats()); capture('depth-first.jsonl', d.text); }
      checkBook(stats.get(key), j.tick, at);
    } else {
      const t = tickers.get(key) ?? { frames: 0, gaps: [], lastAt: null, keys: new Set(), changes: {}, prev: null, lastTs: null, tsBehind: [] };
      t.frames++;
      if (t.lastAt !== null) t.gaps.push(at - t.lastAt);
      t.lastAt = at;
      for (const k of Object.keys(j.tick)) t.keys.add(k);
      for (const k of ['sign_price', 'index_price', 'funding_rate_last', 'funding_rate_next', 'last_fund_rate_third', 'close']) {
        if (t.prev && t.prev[k] !== j.tick[k]) t.changes[k] = (t.changes[k] ?? 0) + 1;
      }
      if (typeof j.tick.ts === 'number') t.tsBehind.push(at - j.tick.ts);
      t.prev = j.tick;
      if (t.frames === 1) capture('ticker-first.jsonl', d.text);
      tickers.set(key, t);
    }
  };

  const z = open(`${WS_URL}?compress=1`, 'zlib', onFrame('zlib'), {
    onOpen: (ws) => {
      subAt = Date.now();
      let id = 1;
      for (const c of pick) sub(ws, channelOf(c, 'depth'), id++);
      sub(ws, channelOf(pick[0], 'ticker'), id++);
      sub(ws, channelOf(pick[2], 'ticker'), id++);
    },
  });
  const t = open(WS_URL, 'text', onFrame('text'), {
    onOpen: (ws) => {
      sub(ws, channelOf(pick[0], 'depth'), 1);
      sub(ws, channelOf(pick[2], 'depth'), 2);
    },
  });
  // Error cases on a third socket, so they cannot disturb the measured streams.
  // Each action gets a window, and the window records every non-ping frame, reduced to its envelope.
  const errFrames = [];
  const windows = [];
  let win = null;
  const e = open(`${WS_URL}?compress=1`, 'errors', (j) => {
    if (j.ping !== undefined) return;
    const env = { channel: j.channel, eventResp: j.eventResp, tick: j.tick === undefined ? undefined : 'present', other: j.channel === undefined ? JSON.stringify(j).slice(0, 200) : undefined };
    errFrames.push(env);
    if (win) { win.frames++; if (j.eventResp || !j.channel) win.envelopes.push(env); }
  }, {
    onOpen: async (ws) => {
      const act = async (name, send, ms) => {
        win = { name, frames: 0, envelopes: [] };
        send();
        await sleep(ms);
        windows.push({ ...win, envelopes: win.envelopes.slice(0, 3) });
      };
      await act('unknown symbol', () => sub(ws, 'market_e_nopeusdt_depth_0.1', 1), 2000);
      await act('precision not in depthList', () => sub(ws, 'market_e_btcusdt_depth_0.01', 2), 2000);
      await act('step0 name', () => sub(ws, 'market_e_btcusdt_depth_step0', 3), 2000);
      await act('valid depth', () => sub(ws, 'market_e_btcusdt_depth_0.1', 4), 3000);
      await act('same depth again', () => sub(ws, 'market_e_btcusdt_depth_0.1', 5), 3000);
      await act('text that is not JSON', () => ws.send('hello'), 3000);
      await act('unknown event', () => ws.send(JSON.stringify({ event: 'nope', params: { channel: 'market_e_btcusdt_depth_0.1', cb_id: '6' } })), 3000);
      await act('unsub', () => ws.send(JSON.stringify({ event: 'unsub', params: { channel: 'market_e_btcusdt_depth_0.1', cb_id: '7' } })), 4000);
      log('error_windows', { windows, readyState: ws.readyState });
      ws.close();
    },
  });

  await sleep(20_000);
  const bn = [await binanceTop('BTCUSDT'), await binanceTop('IOTXUSDT')];
  const bbNow = {};
  for (const [k, s] of stats) if (k.startsWith('zlib|') && (k.includes('btcusdt_') || k.includes('iotxusdt_'))) bbNow[k] = s.top;
  log('binance_compare', { bitbaby: bbNow, binance: bn });
  await sleep(40_000);
  z.ws.terminate();
  t.ws.terminate();
  e.ws.terminate();

  for (const s of [z.st, t.st, e.st]) log('socket', { ...s, t0: undefined, kbPerS: +(s.bytes / 1024 / 60).toFixed(1) });
  log('acks', { count: acks.length, sample: acks.slice(0, 8) });
  log('first_frame_ms_after_sub', Object.fromEntries(firstFrameAt));
  for (const [k, s] of stats) log('book', summarizeBook(k, s));
  for (const [k, tk] of tickers) log('ticker', { stream: k, frames: tk.frames, gapP50: q(tk.gaps, 0.5), gapMax: q(tk.gaps, 1), changes: tk.changes, arrivalMinusTickTs: { min: q(tk.tsBehind, 0), p50: q(tk.tsBehind, 0.5), max: q(tk.tsBehind, 1) }, keys: [...tk.keys] });
  log('error_socket_frames', { count: errFrames.length });
  log('non_data_frames', { count: errors.length, sample: errors.slice(0, 4) });
}

async function silence() {
  const cl = await catalog();
  const quiet = cl.find((c) => c.contractName === 'E-IOTX-USDT') ?? cl[cl.length - 1];
  const socks = [
    open(`${WS_URL}?compress=1`, 'no_sub_no_pong', () => {}, { pong: false }),
    open(`${WS_URL}?compress=1`, 'sub_no_pong', () => {}, { pong: false, onOpen: (ws) => sub(ws, channelOf(quiet, 'depth'), 1) }),
    open(`${WS_URL}?compress=1`, 'no_sub_with_pong', () => {}, {}),
    open(`${WS_URL}?compress=1`, 'sub_with_pong', () => {}, { onOpen: (ws) => sub(ws, channelOf(quiet, 'depth'), 1) }),
  ];
  const until = Date.now() + 120_000;
  while (Date.now() < until && socks.some((s) => s.st.closeMs === null)) await sleep(500);
  for (const s of socks) { if (s.st.closeMs === null) s.ws.terminate(); log('silence', { ...s.st, t0: undefined }); }
}

async function batch() {
  const cl = await catalog();
  const streams = new Map();
  let parseUs = 0;
  let parsed = 0;
  let subAt = 0;
  const firstAt = [];
  const s = open(`${WS_URL}?compress=1`, 'batch', (j, d, at) => {
    if (!j.channel || !j.tick) return;
    const n = streams.get(j.channel) ?? 0;
    if (n === 0) firstAt.push(at - subAt);
    streams.set(j.channel, n + 1);
  }, {
    onOpen: (ws) => {
      subAt = Date.now();
      cl.forEach((c, i) => sub(ws, channelOf(c, 'depth'), i + 1));
    },
  });
  // Time inflate plus JSON.parse on a sample of frames outside the socket handler.
  const sample = [];
  s.ws.on('message', (data, isBinary) => { if (sample.length < 2000) sample.push([data, isBinary]); });
  const perSecond = [];
  let lastFrames = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    perSecond.push(s.st.frames - lastFrames);
    lastFrames = s.st.frames;
  }
  s.ws.terminate();
  const t = process.hrtime.bigint();
  for (const [data, isBinary] of sample) { JSON.parse(decode(data, isBinary).text); parsed++; }
  parseUs = Number(process.hrtime.bigint() - t) / 1000 / Math.max(1, parsed);
  const silent = cl.filter((c) => !streams.has(channelOf(c, 'depth'))).map((c) => c.contractName);
  log('batch', {
    subscribed: cl.length,
    streamsDelivering: streams.size,
    silentStreams: silent.slice(0, 20),
    silentCount: silent.length,
    frames: s.st.frames,
    framesPerSecond: { p50: q(perSecond, 0.5), max: q(perSecond, 1), mean: +(s.st.frames / 60).toFixed(1) },
    wireKBPerS: +(s.st.bytes / 1024 / 60).toFixed(1),
    inflatedKBPerS: +(s.st.inflated / 1024 / 60).toFixed(1),
    bytesPerFrameWire: Math.round(s.st.bytes / Math.max(1, s.st.frames)),
    bytesPerFrameInflated: Math.round(s.st.inflated / Math.max(1, s.st.frames)),
    inflateParseUsPerFrame: +parseUs.toFixed(1),
    firstFrameMs: { p50: q(firstAt, 0.5), max: q(firstAt, 1) },
    perStreamFrames: { min: q([...streams.values()], 0), p50: q([...streams.values()], 0.5), max: q([...streams.values()], 1) },
    closeCode: s.st.closeCode,
    error: s.st.error,
  });
}

async function tickers() {
  const cl = await catalog();
  const per = new Map();
  let subAt = 0;
  const s = open(`${WS_URL}?compress=1`, 'tickers', (j, d, at) => {
    if (!j.channel || !j.tick) return;
    const p = per.get(j.channel) ?? { n: 0, first: at - subAt, last: at, maxGap: 0, markChanges: 0, prevMark: null, zeroMark: 0, source: {} };
    if (p.n > 0) p.maxGap = Math.max(p.maxGap, at - p.last);
    p.last = at;
    p.n++;
    if (p.prevMark !== null && p.prevMark !== j.tick.sign_price) p.markChanges++;
    p.prevMark = j.tick.sign_price;
    if (!(Number(j.tick.sign_price) > 0)) p.zeroMark++;
    p.source[j.tick.admin_fund_rate_source] = (p.source[j.tick.admin_fund_rate_source] ?? 0) + 1;
    per.set(j.channel, p);
  }, { onOpen: (ws) => { subAt = Date.now(); cl.forEach((c, i) => sub(ws, channelOf(c, 'ticker'), i + 1)); } });
  await sleep(60_000);
  const end = Date.now();
  s.ws.terminate();
  // A stream's worst silence includes the tail from its last frame to the end of the run.
  const gaps = [...per.values()].map((p) => Math.max(p.maxGap, end - p.last));
  const src = {};
  for (const p of per.values()) for (const [k, n] of Object.entries(p.source)) src[k] = (src[k] ?? 0) + n;
  log('tickers', {
    subscribed: cl.length,
    streamsDelivering: per.size,
    frames: s.st.frames,
    framesPerSecond: +(s.st.frames / 60).toFixed(1),
    wireKBPerS: +(s.st.bytes / 1024 / 60).toFixed(1),
    perStreamFrames: { min: q([...per.values()].map((p) => p.n), 0), p50: q([...per.values()].map((p) => p.n), 0.5), max: q([...per.values()].map((p) => p.n), 1) },
    worstSilenceMs: { p50: q(gaps, 0.5), p90: q(gaps, 0.9), max: q(gaps, 1) },
    streamsSilentOver10s: gaps.filter((g) => g > 10_000).length,
    streamsWithMarkZeroOrMissing: [...per.values()].filter((p) => p.zeroMark > 0).length,
    fundRateSource: src,
  });
}

async function deflate() {
  const s = open(WS_URL, 'deflate', () => {}, { deflate: true });
  await sleep(4000);
  s.ws.terminate();
  log('deflate', { extensions: s.st.extensions, openMs: s.st.openMs, error: s.st.error });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, silence, batch, tickers, deflate };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
await modes[mode]();
process.exit(0);
