// Bitrue futures WebSocket probe: the depth channel, frame compression, level order, size unit, keepalive, silence, errors and a batch of perpetuals on one connection.
// Public, unauthenticated and read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitrue/ws-probe.mjs [book|batch|silence|deflate|web|lag]
//   book     depth_step0 on four contracts for 60 s with a REST book compare, a ticker, other depth steps, coin-M and error cases, about 70 s
//   batch    depth_step0 on N USDT perpetuals on one connection for 60 s, N from the second argument, 100 by default
//   silence  four sockets that differ only in whether they subscribe and whether they answer the server ping, for the seconds of the second argument, 120 by default and at most
//   deflate  asks for permessage-deflate once and prints what the server negotiates
//   web      the URL the futures web page uses, with the review request it sends, for 20 s
//   lag      BTC depth on both URLs beside a REST book poll every second for 40 s, matching books to date each socket frame
// Set PROBE_OUT_DIR to keep a few raw frames.
// Recorded in docs/profiles/bitrue/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_DOC = 'wss://fmarket-ws.bitrue.com/kline-api/ws';
const URL_WEB = 'wss://futuresws.bitrue.com/kline-api/ws';
const FAPI = 'https://fapi.bitrue.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel, cb_id = '') => JSON.stringify({ event: 'sub', params: { channel, cb_id } });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// The documentation says every frame but the heartbeat is gzip inside a binary frame, so both cases are decoded.
function decode(raw, isBinary) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  const t0 = performance.now();
  const text = gz ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  const t1 = performance.now();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const t2 = performance.now();
  return { gz, isBinary, text, json, wireBytes: buf.length, bytes: text.length, gunzipUs: (t1 - t0) * 1000, parseUs: (t2 - t1) * 1000 };
}

function open(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('error', reject);
  });
}

// The server pings with {"ping": <n>} and CCXT Pro answers {"pong": <same n>}.
function autoPong(ws, stats) {
  ws.on('message', (raw, isBinary) => {
    const d = decode(raw, isBinary);
    if (d.json && d.json.ping !== undefined) {
      stats.pings++;
      const now = Date.now();
      if (stats.lastPingAt) stats.pingGaps.push(now - stats.lastPingAt);
      stats.lastPingAt = now;
      stats.pingBinary[d.isBinary ? 'binary' : 'text']++;
      if (stats.answer) ws.send(JSON.stringify({ pong: d.json.ping }));
    }
  });
}

function bookStats(stream) {
  return { frames: 0, bids: [], asks: [], unorderedBids: 0, unorderedAsks: 0, identical: 0, last: null, tsGaps: [], lastTs: null, crossed: 0, first: null, maxTs: 0, backwards: 0, replays: 0, byTs: new Map(), ages: [], agesBackwards: [], freshest: null };
}

function checkBook(s, j, recv) {
  const t = j.tick ?? {};
  const content = JSON.stringify(t);
  // A frame whose ts is below the newest ts seen is a step back in time, and a replay when its book equals the one first sent with that ts.
  if (j.ts < s.maxTs) {
    s.backwards++;
    s.agesBackwards.push(recv - j.ts);
    if (s.byTs.get(j.ts) === content) s.replays++;
  } else {
    s.maxTs = j.ts;
    s.freshest = { recv, j };
  }
  if (!s.byTs.has(j.ts)) s.byTs.set(j.ts, content);
  s.ages.push(recv - j.ts);
  const bids = t.buys ?? [];
  const asks = t.asks ?? [];
  s.frames++;
  s.bids.push(bids.length);
  s.asks.push(asks.length);
  if (!bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0])) s.unorderedBids++;
  if (!asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0])) s.unorderedAsks++;
  if (bids.length && asks.length && bids[0][0] >= asks[0][0]) s.crossed++;
  const key = JSON.stringify(t);
  if (key === s.last) s.identical++;
  s.last = key;
  if (s.lastTs !== null) s.tsGaps.push(j.ts - s.lastTs);
  s.lastTs = j.ts;
  if (!s.first) s.first = { ts: j.ts, bids: bids.slice(0, 3), asks: asks.slice(0, 3), keys: Object.keys(j), tickKeys: Object.keys(t), types: [typeof bids[0]?.[0], typeof bids[0]?.[1]] };
}

const summary = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
};

async function book() {
  const { ws, openMs } = await open(URL_DOC);
  log('open', { url: URL_DOC, openMs });
  const pingStats = { pings: 0, pingGaps: [], lastPingAt: 0, pingBinary: { binary: 0, text: 0 }, answer: true };
  autoPong(ws, pingStats);
  const streams = ['e_btcusdt', 'e_ethusdt', 'e_lskusdt', 'e_btcusdc'];
  const books = Object.fromEntries(streams.map((s) => [`market_${s}_depth_step0`, bookStats()]));
  const other = {};
  const firstOf = {};
  const unknownFrames = [];
  const cost = { gunzip: [], parse: [], wire: [], plain: [] };
  let t0 = Date.now();
  ws.on('message', (raw, isBinary) => {
    const d = decode(raw, isBinary);
    const j = d.json;
    if (!j) { unknownFrames.push({ at: Date.now() - t0, gz: d.gz, text: d.text.slice(0, 200) }); return; }
    if (j.ping !== undefined) { if (!firstOf.ping) { firstOf.ping = { at: Date.now() - t0, isBinary, gz: d.gz, text: d.text }; capture('ping.txt', d.text); } return; }
    if (d.gz) { cost.gunzip.push(d.gunzipUs); cost.parse.push(d.parseUs); cost.wire.push(d.wireBytes); cost.plain.push(d.bytes); }
    const ch = j.channel ?? j.event_rep ?? j.event ?? 'none';
    const kind = j.tick ? 'data' : 'ctrl';
    const key = `${ch}|${kind}`;
    if (!firstOf[key]) { firstOf[key] = { at: Date.now() - t0, isBinary, gz: d.gz, text: d.text.slice(0, 600) }; capture('first-frames.txt', d.text); }
    if (books[ch] && j.tick) { checkBook(books[ch], j, Date.now()); return; }
    other[key] = (other[key] ?? 0) + 1;
  });
  for (const s of streams) ws.send(sub(`market_${s}_depth_step0`, s));
  ws.send(sub('market_e_btcusdt_ticker', 'e_btcusdt'));
  ws.send(sub('market_e_btcusdt_depth_step1', 'e_btcusdt'));
  ws.send(sub('market_e_btcusd_depth_step0', 'e_btcusd'));
  ws.send(sub('market_e_btcusdt_trade_ticker', 'e_btcusdt'));
  await sleep(20000);
  // Size unit: socket sizes against the REST book at the same prices, read as close together as possible.
  const rest = await (await fetch(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT&limit=30`)).json();
  const sock = books['market_e_btcusdt_depth_step0'].freshest;
  if (sock) {
    const sb = new Map(sock.j.tick.buys.map((l) => [l[0], l[1]]));
    let same = 0; let samePrice = 0;
    for (const [p, q] of rest.bids) { if (sb.has(p)) { samePrice++; if (sb.get(p) === q) same++; } }
    log('size_compare', { socket_ts: sock.j.ts, socket_recv: sock.recv, rest_time: rest.time, socket_top: sock.j.tick.buys.slice(0, 2), rest_top: rest.bids.slice(0, 2), prices_in_both: samePrice, sizes_equal: same, contractSize: 0.0001 });
  }
  const eth = await (await fetch(`${FAPI}/fapi/v1/depth?contractName=E-ETH-USDT&limit=5`)).json();
  const se = books['market_e_ethusdt_depth_step0'].freshest;
  if (se) log('size_compare_eth', { socket_top: se.j.tick.buys.slice(0, 2), rest_top: eth.bids.slice(0, 2), contractSize: 0.001 });
  // Error cases, each on the same socket.
  ws.send(sub('market_e_nopeusdt_depth_step0', 'e_nopeusdt'));
  ws.send(sub('market_E_BTCUSDT_depth_step0', 'x'));
  ws.send(sub('market_e_btcusdt_depth_step9', 'x'));
  ws.send(sub('market_e_btcusdt_nope', 'x'));
  ws.send(JSON.stringify({ event: 'nope', params: {} }));
  ws.send('not json');
  ws.send(sub('market_e_btcusdt_depth_step0', 'dup'));
  await sleep(40000);
  const closed = ws.readyState !== WebSocket.OPEN;
  ws.close();
  for (const [ch, s] of Object.entries(books)) {
    log('book_stream', { ch, frames: s.frames, per_s: +(s.frames / 60).toFixed(2), bids: summary(s.bids), asks: summary(s.asks), unorderedBids: s.unorderedBids, unorderedAsks: s.unorderedAsks, crossed: s.crossed, identical_to_previous: s.identical, ts_gap_ms: summary(s.tsGaps), backwards: s.backwards, replays_of_an_earlier_ts: s.replays, age_ms: summary(s.ages), age_ms_backwards: summary(s.agesBackwards), first: s.first });
  }
  log('first_frames', { firstOf });
  log('other_counts', { other, unknownFrames: unknownFrames.slice(0, 6) });
  log('cost', { frames: cost.gunzip.length, gunzip_us: summary(cost.gunzip.map(Math.round)), parse_us: summary(cost.parse.map(Math.round)), wire_bytes: summary(cost.wire), plain_bytes: summary(cost.plain) });
  log('pings', { pings: pingStats.pings, gaps_ms: summary(pingStats.pingGaps), kind: pingStats.pingBinary, closed_early: closed });
}

async function batch(n) {
  const lin = await (await fetch(`${FAPI}/fapi/v1/contracts`)).json();
  const usdt = lin.filter((c) => c.symbol.endsWith('-USDT')).map((c) => 'e_' + c.symbol.split('-')[1].toLowerCase() + 'usdt');
  const step = Math.max(1, Math.floor(usdt.length / n));
  const picked = usdt.filter((_, i) => i % step === 0).slice(0, n);
  const { ws, openMs } = await open(URL_DOC);
  const pingStats = { pings: 0, pingGaps: [], lastPingAt: 0, pingBinary: { binary: 0, text: 0 }, answer: true };
  autoPong(ws, pingStats);
  const seen = new Map();
  const perSecond = [];
  let frames = 0; let wire = 0; let plain = 0; let cpu = 0;
  const ctrl = {};
  const t0 = Date.now();
  let closeInfo = null;
  ws.on('close', (code, reason) => { closeInfo = { code, reason: reason.toString(), at_s: (Date.now() - t0) / 1000 }; });
  ws.on('message', (raw, isBinary) => {
    const d = decode(raw, isBinary);
    if (!d.json || d.json.ping !== undefined) return;
    const ch = d.json.channel;
    if (!d.json.tick) { const k = (d.json.event_rep ?? '') + '|' + (d.json.status ?? '') + '|' + (d.json.msg ?? d.json.err_msg ?? ''); ctrl[k] = (ctrl[k] ?? 0) + 1; return; }
    frames++; wire += d.wireBytes; plain += d.bytes; cpu += d.gunzipUs + d.parseUs;
    if (!seen.has(ch)) seen.set(ch, Date.now() - t0);
  });
  const sendT0 = Date.now();
  for (const s of picked) ws.send(sub(`market_${s}_depth_step0`, s));
  let prev = 0;
  for (let i = 0; i < 60 && !closeInfo; i++) { await sleep(1000); perSecond.push(frames - prev); prev = frames; }
  if (!closeInfo) ws.close();
  const firsts = [...seen.values()].sort((a, b) => a - b);
  log('batch', { requested: picked.length, openMs, streams_delivering: seen.size, all_first_frames_within_ms: firsts[firsts.length - 1], frames, frames_per_s: summary(perSecond), wire_kb_per_s: +(wire / 1024 / perSecond.length).toFixed(1), plain_kb_per_s: +(plain / 1024 / perSecond.length).toFixed(1), wire_bytes_per_frame: Math.round(wire / frames), plain_bytes_per_frame: Math.round(plain / frames), gunzip_plus_parse_us_per_frame: Math.round(cpu / frames), ctrl, pings: pingStats.pings, closed: closeInfo });
  const silent = picked.filter((s) => !seen.has(`market_${s}_depth_step0`));
  log('batch_silent_streams', { count: silent.length, streams: silent.slice(0, 15) });
}

async function silence(seconds) {
  const variants = [
    { name: 'sub_answers_ping', subscribe: true, answer: true },
    { name: 'sub_ignores_ping', subscribe: true, answer: false },
    { name: 'nosub_answers_ping', subscribe: false, answer: true },
    { name: 'nosub_ignores_ping', subscribe: false, answer: false },
  ];
  const results = await Promise.all(variants.map(async (v) => {
    const { ws, openMs } = await open(URL_DOC);
    const t0 = Date.now();
    const stats = { pings: 0, pingGaps: [], lastPingAt: 0, pingBinary: { binary: 0, text: 0 }, answer: v.answer };
    let protoPings = 0; let dataFrames = 0; let firstPingAt = null;
    autoPong(ws, stats);
    ws.on('ping', () => protoPings++);
    ws.on('message', (raw, isBinary) => { const d = decode(raw, isBinary); if (d.json?.ping !== undefined) { firstPingAt ??= Date.now() - t0; } else dataFrames++; });
    if (v.subscribe) ws.send(sub('market_e_lskusdt_depth_step0', 'e_lskusdt'));
    const close = await new Promise((resolve) => {
      const timer = setTimeout(() => { resolve({ code: null, reason: `still open at ${seconds} s`, at_s: seconds }); ws.close(); }, seconds * 1000);
      ws.on('close', (code, reason) => { clearTimeout(timer); resolve({ code, reason: reason.toString(), at_s: (Date.now() - t0) / 1000 }); });
    });
    return { ...v, openMs, close, pings: stats.pings, firstPingAt, ping_gaps_ms: summary(stats.pingGaps), protoPings, dataFrames };
  }));
  for (const r of results) log('silence', r);
}

async function deflate() {
  const { ws, openMs } = await open(URL_DOC, { deflate: true });
  log('deflate', { openMs, negotiated_extensions: ws.extensions || '(none)' });
  ws.on('message', (raw, isBinary) => {
    const d = decode(raw, isBinary);
    if (d.json?.tick) { log('deflate_frame', { gz_inside: d.gz, isBinary, wireBytes: d.wireBytes }); ws.close(); }
  });
  ws.send(sub('market_e_btcusdt_depth_step0', 'e_btcusdt'));
  await sleep(3000);
  if (ws.readyState === WebSocket.OPEN) ws.close();
}

async function web() {
  const { ws, openMs } = await open(URL_WEB);
  log('open', { url: URL_WEB, openMs });
  const pingStats = { pings: 0, pingGaps: [], lastPingAt: 0, pingBinary: { binary: 0, text: 0 }, answer: true };
  autoPong(ws, pingStats);
  const counts = {};
  const firstOf = {};
  ws.on('message', (raw, isBinary) => {
    const d = decode(raw, isBinary);
    if (!d.json || d.json.ping !== undefined) return;
    const ch = d.json.channel ?? d.json.event_rep ?? 'none';
    counts[ch] = (counts[ch] ?? 0) + 1;
    if (!firstOf[ch]) {
      firstOf[ch] = { gz: d.gz, bytes: d.bytes, text: d.text.slice(0, 700) };
      if (ch === 'review') {
        const data = d.json.data ?? d.json.tick ?? [];
        const rows = Array.isArray(data) ? data : Object.values(data);
        firstOf[ch].rows = rows.length;
        firstOf[ch].rowKeys = rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : null;
      }
      capture('web-first-frames.txt', d.text);
    }
  });
  ws.send(sub('market_e_btcusdt_depth_step0', 'e_btcusdt'));
  ws.send(JSON.stringify({ event: 'req', params: { channel: 'review' } }));
  ws.send(sub('market_e_btcusdt_ticker', 'e_btcusdt'));
  await sleep(20000);
  ws.close();
  log('web', { counts, pings: pingStats.pings, firstOf });
}

// Each socket book is matched to the REST replies whose top five levels per side are identical, which dates the socket book on the server clock.
async function lag() {
  const key = (bids, asks) => JSON.stringify([bids.slice(0, 5), asks.slice(0, 5)]);
  const rest = new Map(); // top five key to the earliest REST `time` that showed it
  const frames = { doc: [], web: [] };
  const trades = { doc: [], web: [] };
  const sockets = [];
  for (const [name, url] of [['doc', URL_DOC], ['web', URL_WEB]]) {
    const { ws } = await open(url);
    autoPong(ws, { pings: 0, pingGaps: [], lastPingAt: 0, pingBinary: { binary: 0, text: 0 }, answer: true });
    ws.on('message', (raw, isBinary) => {
      const d = decode(raw, isBinary);
      const j = d.json;
      if (!j?.tick) return;
      const recv = Date.now();
      if (j.channel === 'market_e_btcusdt_depth_step0') frames[name].push({ recv, ts: j.ts, k: key(j.tick.buys, j.tick.asks) });
      if (j.channel === 'market_e_btcusdt_trade_ticker') for (const t of j.tick.data ?? []) trades[name].push({ recv, ts: t.ts, frameTs: j.ts });
    });
    ws.send(sub('market_e_btcusdt_depth_step0', 'e_btcusdt'));
    ws.send(sub('market_e_btcusdt_trade_ticker', 'e_btcusdt'));
    sockets.push(ws);
  }
  const restTimes = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const a = Date.now();
    const r = await (await fetch(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT&limit=5`)).json();
    const b = Date.now();
    restTimes.push({ sent: a, recv: b, time: r.time });
    const k = key(r.bids, r.asks);
    if (!rest.has(k)) rest.set(k, { time: r.time, recv: b });
    const wait = 1000 - (Date.now() - a);
    if (wait > 0) await sleep(wait);
  }
  for (const ws of sockets) ws.close();
  for (const name of ['doc', 'web']) {
    const matched = frames[name].filter((f) => rest.has(f.k));
    log('lag', {
      url: name === 'doc' ? URL_DOC : URL_WEB, frames: frames[name].length, matched_to_a_rest_book: matched.length,
      recv_minus_rest_time_ms: summary(matched.map((f) => f.recv - rest.get(f.k).time)),
      recv_minus_rest_arrival_ms: summary(matched.map((f) => f.recv - rest.get(f.k).recv)),
      recv_minus_frame_ts_ms: summary(frames[name].map((f) => f.recv - f.ts)),
      first_12_ages_ms: frames[name].slice(0, 12).map((f) => f.recv - f.ts),
      trades: trades[name].length, recv_minus_trade_ts_ms: summary(trades[name].map((t) => t.recv - t.ts)),
    });
  }
  log('rest_poll', { replies: restTimes.length, distinct_books: rest.size, recv_minus_time_ms: summary(restTimes.map((r) => r.recv - r.time)), rtt_ms: summary(restTimes.map((r) => r.recv - r.sent)) });
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await book();
else if (mode === 'batch') await batch(Number(process.argv[3] ?? 100));
else if (mode === 'silence') await silence(Math.min(120, Number(process.argv[3] ?? 120)));
else if (mode === 'deflate') await deflate();
else if (mode === 'web') await web();
else if (mode === 'lag') await lag();
else { console.error('unknown mode', mode); process.exit(2); }
log('done', { at: new Date().toISOString() });
