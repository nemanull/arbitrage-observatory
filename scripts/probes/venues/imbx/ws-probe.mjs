// IMBX futures WebSocket probe: handshake refusals by User-Agent, frame encoding, the depth channel's levels, order, cadence and repeats, keepalive, silence, errors, and every perpetual on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// IMBX publishes no API documentation, so the URL, frames and channel names are the ones its own web client uses, read from https://www.imbx.io/futures bundles on 2026-09-22.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/imbx/ws-probe.mjs [ua|book|batch|silence]
//   ua       upgrade with no User-Agent, a curl one and `node`, on the futures and the spot URL, and one permessage-deflate offer. About 10 s.
//   book     depth_step0 on four perps for 60 s with ticker and trade_ticker, a REST touch compare, then errors and odd subscriptions. About 80 s.
//   batch    depth_step0 on every listed perp on one connection for 45 s.
//   silence  three sockets that differ in what the client subscribes and answers, for up to 120 s.
// The load balancer blocked this host, sockets included, a few minutes after about 250 REST requests in five minutes on 2026-09-23, so space the runs out.
// A refused request prints a `refused` line and exits with code 2.
// Set PROBE_OUT_DIR to keep a few decoded frames. Recorded in docs/profiles/imbx/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FUTURES_URL = 'wss://futuresws.imbx.io/kline-api/ws';
const SPOT_URL = 'wss://ws.imbx.io/kline-api/ws';
const PUBLIC_INFO = 'https://lf-api.imbx.io/common/public_info';
const PRICE_LIST = 'https://lf-api.imbx.io/common/price_list';
const UA = { 'User-Agent': 'node' }; // the WAF refuses a socket with no User-Agent, see mode ua
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel, cb) => ({ event: 'sub', params: { channel, cb_id: cb } });
const depthChannel = (id, step = 0) => `market_${id}_depth_step${step}`;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Every server frame seen on this host is a gzip member inside a binary WebSocket message.
function decode(data, isBinary) {
  const gz = isBinary && data[0] === 0x1f && data[1] === 0x8b;
  const t = process.hrtime.bigint();
  const text = gz ? zlib.gunzipSync(data).toString('utf8') : data.toString('utf8');
  const json = JSON.parse(text);
  return { gz, isBinary, text, json, us: Number(process.hrtime.bigint() - t) / 1000 };
}

// The load balancer answers a refusal with an HTML 403, which no mode can use, so the run stops and says so.
function refused(what, status, server, body) {
  log('refused', { what, status, server, body: String(body ?? '').replace(/\s+/g, ' ').slice(0, 120), at: new Date().toISOString() });
  process.exit(2);
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return refused(url, res.status, res.headers.get('server'), text); }
}

function open(url, headers = UA, extra = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, headers, ...extra });
    let status = null;
    let ext = null;
    ws.on('upgrade', (res) => { status = res.statusCode; ext = res.headers['sec-websocket-extensions'] ?? null; });
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ ws: null, status: res.statusCode, server: res.headers.server, body: body.replace(/\s+/g, ' ').slice(0, 120), ms: Date.now() - t0 }));
    });
    ws.on('open', () => resolve({ ws, status, ext, ms: Date.now() - t0 }));
    ws.on('error', (e) => { if (status === null) resolve({ ws: null, status: 'error', error: e.message, ms: Date.now() - t0 }); });
  });
}

async function modeUa() {
  for (const [name, headers] of [['none', {}], ['curl', { 'User-Agent': 'curl/8.14.1' }], ['node', UA]]) {
    for (const url of [FUTURES_URL, SPOT_URL]) {
      const r = await open(url, headers);
      log('ua', { url, userAgent: name, status: r.status, server: r.server, body: r.body, ms: r.ms });
      r.ws?.close();
      await sleep(300);
    }
  }
  const r = await open(FUTURES_URL, UA, { perMessageDeflate: true });
  log('deflate_offer', { status: r.status, negotiated: r.ext });
  if (r.ws) {
    const first = await new Promise((resolve) => {
      r.ws.once('message', (d, b) => resolve(decode(d, b)));
      r.ws.send(JSON.stringify(sub(depthChannel('e_btcusdt'), 'e_btcusdt')));
      setTimeout(() => resolve(null), 5000);
    });
    log('deflate_first_frame', { gzipInside: first?.gz, binary: first?.isBinary });
    r.ws.close();
  }
}

function levelStats(side, dir) {
  let bad = 0;
  for (let i = 1; i < side.length; i++) if (dir * (side[i][0] - side[i - 1][0]) <= 0) bad++;
  return bad;
}

async function modeBook() {
  const info = await postJson(PUBLIC_INFO, {});
  const contracts = info.data.contractList;
  const pick = ['E-BTC-USDT', 'E-ETH-USDT', 'E-COPPER-USDT', 'E-NVDA-USDT'].map((n) => contracts.find((c) => c.contractName === n));
  const r = await open(FUTURES_URL);
  log('open', { url: FUTURES_URL, status: r.status, ms: r.ms });
  if (!r.ws) refused(FUTURES_URL, r.status, r.server, r.body);
  const ws = r.ws;
  const t0 = Date.now();
  const st = new Map();
  const pings = [];
  let pongReplies = 0;
  let clientPingSentAt = 0;
  const wire = { frames: 0, wireBytes: 0, jsonBytes: 0, gz: 0, text: 0, us: [] };
  const firstByChannel = new Map();
  let lastBook = new Map();
  const others = [];

  ws.on('message', (d, b) => {
    const now = Date.now();
    const m = decode(d, b);
    wire.frames++; wire.wireBytes += d.length; wire.jsonBytes += m.text.length; wire.us.push(m.us);
    m.gz ? wire.gz++ : wire.text++;
    const j = m.json;
    if (j.ping !== undefined) { pings.push({ at: now - t0, ping: j.ping }); ws.send(JSON.stringify({ pong: j.ping })); return; }
    if (j.pong !== undefined) { pongReplies++; log('client_ping_answer', { rttMs: now - clientPingSentAt, frame: m.text }); return; }
    if (!j.channel) { others.push(m.text.slice(0, 300)); return; }
    if (!firstByChannel.has(j.channel)) { firstByChannel.set(j.channel, now - t0); capture('first-frames.jsonl', m.text); }
    let s = st.get(j.channel);
    if (!s) { s = { n: 0, repeats: 0, last: null, gaps: [], lastAt: 0, bids: [], asks: [], badBid: 0, badAsk: 0, crossed: 0, oneSided: 0, empty: 0, tsMs0: 0, tsAges: [], keys: Object.keys(j).join(',') }; st.set(j.channel, s); }
    s.n++;
    if (s.lastAt) s.gaps.push(now - s.lastAt);
    s.lastAt = now;
    const body = JSON.stringify(j.tick);
    if (body === s.last) s.repeats++;
    s.last = body;
    if (typeof j.ts === 'number') { if (j.ts % 1000 === 0) s.tsMs0++; s.tsAges.push(now - j.ts); }
    if (j.channel.includes('_depth_step')) {
      const bids = j.tick.buys ?? [];
      const asks = j.tick.asks ?? [];
      s.bids.push(bids.length); s.asks.push(asks.length);
      s.badBid += levelStats(bids, -1) > 0 ? 1 : 0;
      s.badAsk += levelStats(asks, 1) > 0 ? 1 : 0;
      if (bids.length && asks.length && bids[0][0] >= asks[0][0]) {
        s.crossed++;
        if (s.crossed <= 2) log('crossed_frame', { ch: j.channel, ts: j.ts, bids: bids.slice(0, 3), asks: asks.slice(0, 3), bidsBelowBestAsk: bids.filter((l) => l[0] < asks[0][0]).length });
      }
      if (!bids.length && !asks.length) s.empty++; else if (!bids.length || !asks.length) s.oneSided++;
      lastBook.set(j.channel, { bid: bids[0], ask: asks[0], at: now });
    }
  });
  ws.on('close', (c) => log('close', { code: c, atMs: Date.now() - t0 }));

  const frames = [];
  for (const c of pick) {
    frames.push(sub(depthChannel(c.subSymbol), c.subSymbol));
  }
  frames.push(sub('market_e_btcusdt_ticker', 'e_btcusdt'), sub('market_e_btcusdt_trade_ticker', 'e_btcusdt'), sub('market_e_btcusdt_nope', 'e_btcusdt'));
  for (const f of frames) ws.send(JSON.stringify(f));
  log('subscribed', { channels: frames.map((f) => f.params.channel), multiplier: pick.map((c) => [c.contractName, c.multiplier]) });

  // REST touch compare at 20 s and 40 s, against the bulk price_list read at the same instant.
  for (const at of [20000, 40000]) {
    await sleep(at - (Date.now() - t0));
    const pl = await postJson(PRICE_LIST, {});
    const readAt = Date.now();
    const rows = Object.assign({}, ...pl.data);
    for (const c of pick) {
      const b = lastBook.get(depthChannel(c.subSymbol));
      const p = rows[c.contractName];
      log('touch_vs_price_list', { contract: c.contractName, wsBid: b?.bid, wsAsk: b?.ask, wsAgeMs: b ? readAt - b.at : null, restBuyOne: p?.buyOne, restSellOne: p?.sellOne, mark: p?.tagPrice });
    }
  }
  await sleep(45000 - (Date.now() - t0));
  clientPingSentAt = Date.now();
  ws.send(JSON.stringify({ ping: clientPingSentAt }));
  await sleep(60000 - (Date.now() - t0));

  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  for (const [ch, s] of st) {
    log('channel', {
      ch, keys: s.keys, frames: s.n, perSec: +(s.n / 60).toFixed(2), identicalRepeats: s.repeats,
      gapMs: { p50: q(s.gaps, 0.5), p90: q(s.gaps, 0.9), max: q(s.gaps, 1) },
      levels: s.bids.length ? { bidsMin: Math.min(...s.bids), bidsMax: Math.max(...s.bids), asksMin: Math.min(...s.asks), asksMax: Math.max(...s.asks) } : undefined,
      framesWithBidsNotDescending: s.bids.length ? s.badBid : undefined, framesWithAsksNotAscending: s.bids.length ? s.badAsk : undefined,
      crossed: s.crossed, oneSided: s.oneSided, empty: s.empty,
      tsWholeSecond: s.tsMs0, tsAgeMs: { p50: q(s.tsAges, 0.5), min: q(s.tsAges, 0), max: q(s.tsAges, 1) },
      firstFrameMs: firstByChannel.get(ch),
    });
  }
  log('wire', { frames: wire.frames, gzipFrames: wire.gz, textFrames: wire.text, wireBytesPerFrame: Math.round(wire.wireBytes / wire.frames), jsonBytesPerFrame: Math.round(wire.jsonBytes / wire.frames), decodeUsP50: q(wire.us, 0.5) });
  log('server_pings', { count: pings.length, atMs: pings.map((p) => p.at), values: pings.slice(0, 3).map((p) => p.ping), pongReplies });
  if (others.length) log('other_frames', { frames: others.slice(0, 5) });

  // Errors and odd subscriptions on the same socket, each given 4 s.
  const probes = [
    ['unknown symbol', sub(depthChannel('e_nopeusdt'), 'e_nopeusdt')],
    ['step1 BTC', sub(depthChannel('e_btcusdt', 1), 'e_btcusdt')],
    ['step5 BTC', sub(depthChannel('e_btcusdt', 5), 'e_btcusdt')],
    ['delisted STX', sub(depthChannel('e_stxusdt'), 'e_stxusdt')],
    ['duplicate BTC step0', sub(depthChannel('e_btcusdt'), 'e_btcusdt')],
    ['unknown event', { event: 'nope', params: { channel: depthChannel('e_ethusdt'), cb_id: 'e_ethusdt' } }],
    ['review event', { event: 'req', params: { channel: depthChannel('e_ethusdt'), cb_id: 'e_ethusdt' } }],
    ['unsub ETH', { event: 'unsub', params: { channel: depthChannel('e_ethusdt'), cb_id: 'e_ethusdt' } }],
    ['not json', 'hello'],
  ];
  for (const [name, f] of probes) {
    const seen = [];
    const control = [];
    let prev = null;
    let twins = 0; // identical frames on one channel less than 5 ms apart, the sign of a doubled subscription
    const onMsg = (d, b) => {
      const m = decode(d, b);
      if (m.json.ping !== undefined) return;
      if (m.json.tick === undefined) control.push(m.text.slice(0, 300));
      const at = Date.now();
      if (prev && prev.text === m.text && at - prev.at < 5) twins++;
      prev = { text: m.text, at };
      seen.push(m.json);
    };
    ws.on('message', onMsg);
    const before = st.get(depthChannel('e_ethusdt'))?.n ?? 0;
    ws.send(typeof f === 'string' ? f : JSON.stringify(f));
    await sleep(4000);
    ws.off('message', onMsg);
    const wanted = typeof f === 'string' ? null : f.params?.channel;
    const mine = wanted ? seen.filter((j) => j.channel === wanted && j.tick !== undefined) : [];
    const trimmed = mine.slice(0, 1).map((j) => JSON.stringify(j, (k, v) => (Array.isArray(v) && v.length > 2 ? [v[0], `…${v.length}`] : v)).slice(0, 300));
    log('odd', { name, dataFramesOnChannel: mine.length, firstData: trimmed, controlFrames: control.slice(0, 2), identicalTwinsUnder5ms: twins, ethFramesDuring: (st.get(depthChannel('e_ethusdt'))?.n ?? 0) - before, open: ws.readyState === 1 });
  }
  ws.close();
}

async function modeBatch() {
  const info = await postJson(PUBLIC_INFO, {});
  const contracts = info.data.contractList;
  const r = await open(FUTURES_URL);
  if (!r.ws) refused(FUTURES_URL, r.status, r.server, r.body);
  const ws = r.ws;
  const t0 = Date.now();
  const per = new Map();
  let frames = 0;
  let bytes = 0;
  let json = 0;
  const us = [];
  const perSecond = new Map();
  ws.on('message', (d, b) => {
    const m = decode(d, b);
    if (m.json.ping !== undefined) { ws.send(JSON.stringify({ pong: m.json.ping })); return; }
    frames++; bytes += d.length; json += m.text.length; us.push(m.us);
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const p = per.get(m.json.channel) ?? { n: 0, first: Date.now() - t0, maxLevels: 0, empty: 0 };
    p.n++;
    const lv = Math.max(m.json.tick?.buys?.length ?? 0, m.json.tick?.asks?.length ?? 0);
    p.maxLevels = Math.max(p.maxLevels, lv);
    if (lv === 0) p.empty++;
    per.set(m.json.channel, p);
  });
  ws.send(JSON.stringify(sub(depthChannel(contracts[0].subSymbol), contracts[0].subSymbol)));
  for (const c of contracts.slice(1)) ws.send(JSON.stringify(sub(depthChannel(c.subSymbol), c.subSymbol)));
  log('batch_subscribed', { streams: contracts.length, openMs: r.ms });
  await sleep(45000);
  const secs = [...perSecond.entries()].filter(([s]) => s >= 2 && s < 45).map(([, n]) => n).sort((a, b) => a - b);
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  log('batch', {
    streamsDelivering: per.size, framesTotal: frames, framesPerSec: +(frames / 45).toFixed(1), medianPerSec: secs[Math.floor(secs.length / 2)], peakPerSec: secs.at(-1),
    wireKBps: +(bytes / 45 / 1024).toFixed(1), jsonKBps: +(json / 45 / 1024).toFixed(1), wireBytesPerFrame: Math.round(bytes / frames), decodeAndParseUsP50: q(us, 0.5), decodeAndParseUsP99: q(us, 0.99),
    firstFrameMsMax: Math.max(...[...per.values()].map((p) => p.first)),
  });
  const rows = [...per.entries()].map(([ch, p]) => `${ch.replace('market_e_', '').replace('_depth_step0', '')}:${p.n}/${p.maxLevels}${p.empty ? `/empty${p.empty}` : ''}`);
  log('batch_per_stream', { framesPerStreamAndMaxLevels: rows.join(' ') });
  ws.close();
}

async function modeSilence() {
  const cases = [
    { name: 'no subscription, no pong', subscribe: false, pong: false },
    { name: 'subscribed, no pong', subscribe: true, pong: false },
    { name: 'subscribed, pong', subscribe: true, pong: true },
  ];
  const t0 = Date.now();
  const results = await Promise.all(cases.map(async (c) => {
    const r = await open(FUTURES_URL);
    if (!r.ws) refused(FUTURES_URL, r.status, r.server, r.body);
    const ws = r.ws;
    const pings = [];
    let frames = 0;
    return new Promise((resolve) => {
      const done = (why, code) => resolve({ ...c, why, code, closedAtMs: Date.now() - t0, pingsAtMs: pings, frames });
      ws.on('message', (d, b) => {
        const m = decode(d, b);
        if (m.json.ping !== undefined) { pings.push(Date.now() - t0); if (c.pong) ws.send(JSON.stringify({ pong: m.json.ping })); return; }
        frames++;
      });
      ws.on('ping', () => pings.push(`proto@${Date.now() - t0}`));
      let clientClosed = false;
      ws.on('close', (code) => done(clientClosed ? 'client closed at 120 s' : 'server closed', code));
      if (c.subscribe) ws.send(JSON.stringify(sub(depthChannel('e_copperusdt'), 'e_copperusdt')));
      setTimeout(() => { if (ws.readyState === 1) { clientClosed = true; ws.close(); } }, 120000);
    });
  }));
  for (const r of results) log('silence', r);
}

const mode = process.argv[2] ?? 'book';
const modes = { ua: modeUa, book: modeBook, batch: modeBatch, silence: modeSilence };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
