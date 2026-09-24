// Bullish public WebSocket probe: what production answers this host, and the book, tick and index channels, sequence ranges, level order, errors, keepalive, silence and deflate on the SimNext test environment.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Production refuses this host by location, so nothing here routes around that refusal, and SimNext is the venue's own public test environment.
// Run from server/: node ../scripts/probes/venues/bullish/ws-probe.mjs [access|book|batch|silence|deflate]
//   access   production handshakes on the five public market data paths, and once more with deflate offered. About 3 s.
//   book     l2Orderbook on four perps and l1Orderbook on one, tick, index data and every error case, with a REST book compare, for 60 s.
//   batch    l2Orderbook on every enabled SimNext perpetual on one socket for 30 s.
//   silence  four sockets that differ only in what the client sends or subscribes, for up to 120 s.
//   deflate  offers permessage-deflate once on SimNext and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/bullish/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const PROD_WS = 'wss://api.exchange.bullish.com';
const SIM_WS = 'wss://api.simnext.bullish-test.com';
const SIM_REST = 'https://api.simnext.bullish-test.com/trading-api';
const BOOK_PATH = '/trading-api/v1/market-data/orderbook';
const TICK_PATH = '/trading-api/v1/market-data/tick';
const TRADES_PATH = '/trading-api/v1/market-data/trades';
const INDEX_PATH = '/trading-api/v1/index-data';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let nextId = 1;
const command = (method, params = {}) => JSON.stringify({ jsonrpc: '2.0', type: 'command', method, params, id: String(nextId++) });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// Level arrays alternate price and size, so a cut keeps the first three levels.
function trim(frame) {
  const f = JSON.parse(JSON.stringify(frame));
  const d = f.data;
  if (d && Array.isArray(d.bids)) d.bids = d.bids.slice(0, 6);
  if (d && Array.isArray(d.asks)) d.asks = d.asks.slice(0, 6);
  if (d && Array.isArray(d.ammData)) d.ammData = d.ammData.slice(0, 1);
  return JSON.stringify(f);
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve) => {
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ ws: null, status: res.statusCode, ms: Date.now() - t0, ray: res.headers['cf-ray'], body: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) }));
    });
    ws.on('upgrade', (res) => (ws.extensionsHeader = res.headers['sec-websocket-extensions'] ?? null));
    ws.on('open', () => resolve({ ws, status: 101, ms: Date.now() - t0 }));
    ws.on('error', (e) => resolve({ ws: null, status: 'error', ms: Date.now() - t0, body: e.message }));
  });
}

async function access() {
  for (const path of [BOOK_PATH, TICK_PATH, `${TICK_PATH}/BTC-USDC-PERP`, TRADES_PATH, INDEX_PATH]) {
    const r = await open(PROD_WS + path);
    log('prod_ws', { path, status: r.status, ms: r.ms, ray: r.ray, body: r.body });
    r.ws?.terminate();
  }
  const d = await open(PROD_WS + BOOK_PATH, { perMessageDeflate: true });
  log('prod_ws_deflate', { status: d.status, body: d.body });
  d.ws?.terminate();
}

function bookStats() {
  return { frames: 0, types: {}, bidLevels: [], askLevels: [], bidOrderBad: 0, askOrderBad: 0, rangeWide: 0, gaps: 0, backwards: 0, repeats: 0, lastUpper: null, lastBody: null, gapsSeen: [], arrivals: [], pubMinusTs: [], arriveMinusPub: [], last: null };
}

function applyBook(stats, f, arrivedAt) {
  const d = f.data;
  stats.frames++;
  stats.types[`${f.type}/${f.dataType}`] = (stats.types[`${f.type}/${f.dataType}`] ?? 0) + 1;
  const bids = d.bids ?? [];
  const asks = d.asks ?? [];
  stats.bidLevels.push(bids.length / 2);
  stats.askLevels.push(asks.length / 2);
  const bp = bids.filter((_, i) => i % 2 === 0).map(Number);
  const ap = asks.filter((_, i) => i % 2 === 0).map(Number);
  if (!bp.every((p, i) => i === 0 || p < bp[i - 1])) stats.bidOrderBad++;
  if (!ap.every((p, i) => i === 0 || p > ap[i - 1])) stats.askOrderBad++;
  const [lo, hi] = d.sequenceNumberRange ?? [];
  if (lo !== hi) stats.rangeWide++;
  if (stats.lastUpper !== null) {
    if (lo !== stats.lastUpper + 1) {
      stats.gaps++;
      if (stats.gapsSeen.length < 5) stats.gapsSeen.push([stats.lastUpper, lo, hi]);
    }
    if (hi <= stats.lastUpper) stats.backwards++;
  }
  stats.lastUpper = hi;
  const body = JSON.stringify([bids, asks]);
  if (body === stats.lastBody) stats.repeats++;
  stats.lastBody = body;
  stats.arrivals.push(arrivedAt);
  stats.pubMinusTs.push(Number(d.publishedAtTimestamp) - Number(d.timestamp));
  stats.arriveMinusPub.push(arrivedAt - Number(d.publishedAtTimestamp));
  stats.last = { seq: hi, bids, asks, arrivedAt };
}

function q(a) {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return { min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
}

function summary(stats) {
  const gaps = stats.arrivals.map((t, i) => (i === 0 ? null : t - stats.arrivals[i - 1])).filter((x) => x !== null);
  return {
    frames: stats.frames,
    types: stats.types,
    bidLevels: q(stats.bidLevels),
    askLevels: q(stats.askLevels),
    bidOrderBad: stats.bidOrderBad,
    askOrderBad: stats.askOrderBad,
    rangeLowerNotUpper: stats.rangeWide,
    seqGaps: stats.gaps,
    seqGapSamples: stats.gapsSeen,
    seqBackwards: stats.backwards,
    identicalRepeats: stats.repeats,
    interFrameMs: q(gaps),
    publishedMinusTimestampMs: q(stats.pubMinusTs),
    arrivalMinusPublishedMs: q(stats.arriveMinusPub),
  };
}

async function book() {
  const perps = ['BTC-USDC-PERP', 'ETH-USDC-PERP', 'CHZ-USDC-PERP', 'CD20-USDC-PERP'];
  const created = Date.now();
  const a = await open(SIM_WS + BOOK_PATH);
  log('sim_open', { path: BOOK_PATH, status: a.status, ms: a.ms });
  const stats = Object.fromEntries(perps.map((p) => [p, bookStats()]));
  const l1 = { frames: 0, types: {}, seqs: [], sizes: [] };
  const control = [];
  const firstSeen = {};
  const sentAt = {};
  let pongs = 0;
  let protocolPings = 0;
  a.ws.on('ping', () => protocolPings++);
  a.ws.on('message', (raw) => {
    const arrivedAt = Date.now();
    const f = JSON.parse(raw.toString('utf8'));
    if (f.dataType === 'V1TALevel2') {
      const s = f.data.symbol;
      if (!firstSeen[s]) {
        firstSeen[s] = { type: f.type, msAfterSubscribe: arrivedAt - sentAt[`l2|${s}`], msAfterCreate: arrivedAt - created, levels: [f.data.bids.length / 2, f.data.asks.length / 2], range: f.data.sequenceNumberRange };
        capture('sim-book-first.jsonl', trim(f));
      }
      if (stats[s]) applyBook(stats[s], f, arrivedAt);
      else control.push({ at: arrivedAt - created, unexpectedBook: s, type: f.type });
      return;
    }
    if (f.dataType === 'V1TALevel1') {
      l1.frames++;
      l1.types[f.type] = (l1.types[f.type] ?? 0) + 1;
      l1.seqs.push(Number(f.data.sequenceNumber));
      if (l1.frames <= 2) capture('sim-l1.jsonl', JSON.stringify(f));
      return;
    }
    if (f.result?.message === 'Keep alive pong') pongs++;
    control.push({ at: arrivedAt - created, frame: JSON.stringify(f).slice(0, 260) });
    capture('sim-control.jsonl', JSON.stringify(f));
  });

  const send = (key, text) => {
    sentAt[key] = Date.now();
    a.ws.send(text);
  };
  for (const p of perps) send(`l2|${p}`, command('subscribe', { topic: 'l2Orderbook', symbol: p }));
  send('l1|BTC', command('subscribe', { topic: 'l1Orderbook', symbol: 'BTC-USDC-PERP' }));

  const t = await open(SIM_WS + TICK_PATH);
  const tick = { frames: 0, types: {}, bySym: {}, fields: null, control: [] };
  t.ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString('utf8'));
    if (f.dataType) {
      tick.frames++;
      tick.types[`${f.type}/${f.dataType}`] = (tick.types[`${f.type}/${f.dataType}`] ?? 0) + 1;
      const s = f.data.symbol;
      const b = (tick.bySym[s] ??= { frames: 0, marks: [], rates: [], created: [] });
      b.frames++;
      b.marks.push(f.data.markPrice);
      b.rates.push(f.data.fundingRate);
      b.created.push(f.data.createdAtTimestamp);
      tick.fields ??= Object.keys(f.data).filter((k) => k !== 'ammData');
      if (b.frames === 1) capture('sim-tick.jsonl', trim(f));
    } else {
      tick.control.push(JSON.stringify(f).slice(0, 220));
    }
  });
  t.ws.send(command('subscribe', { topic: 'tick', symbol: 'BTC-USDC-PERP' }));
  t.ws.send(command('subscribe', { topic: 'tick', symbol: 'CHZ-USDC-PERP' }));
  t.ws.send(command('subscribe', { topic: 'tick', symbol: 'NOPE-USDC-PERP' }));

  const x = await open(SIM_WS + INDEX_PATH);
  const index = { frames: 0, bySym: {}, control: [] };
  x.ws.on('message', (raw) => {
    const arrivedAt = Date.now();
    const f = JSON.parse(raw.toString('utf8'));
    if (f.dataType) {
      index.frames++;
      const s = f.data.assetSymbol;
      const b = (index.bySym[s] ??= { frames: 0, types: {}, prices: [], arrivals: [], lag: [] });
      b.frames++;
      b.types[f.type] = (b.types[f.type] ?? 0) + 1;
      b.prices.push(f.data.price);
      b.arrivals.push(arrivedAt);
      b.lag.push(arrivedAt - Number(f.data.updatedAtTimestamp));
      if (b.frames === 1) capture('sim-index.jsonl', JSON.stringify(f));
    } else {
      index.control.push(JSON.stringify(f).slice(0, 220));
    }
  });
  x.ws.send(command('subscribe', { topic: 'indexPrice', assetSymbol: 'BTC' }));
  x.ws.send(command('subscribe', { topic: 'indexPrice', assetSymbol: 'CD20' }));
  x.ws.send(command('subscribe', { topic: 'indexPrice', assetSymbol: 'NOPE' }));

  await sleep(5000);
  log('sim_first_frames', { firstSeen });
  const errorCases = [
    ['unknown symbol', command('subscribe', { topic: 'l2Orderbook', symbol: 'NOPE-USDC-PERP' })],
    ['disabled perp', command('subscribe', { topic: 'l2Orderbook', symbol: 'FTM-USDC-PERP' })],
    ['bad topic', command('subscribe', { topic: 'abcde', symbol: 'BTC-USDC-PERP' })],
    ['duplicate', command('subscribe', { topic: 'l2Orderbook', symbol: 'BTC-USDC-PERP' })],
    ['missing symbol', command('subscribe', { topic: 'l2Orderbook' })],
    ['spot on same socket', command('subscribe', { topic: 'l2Orderbook', symbol: 'BTCUSDC' })],
    ['unknown method', command('nope', {})],
    ['not json', 'hello'],
    ['keepalive', command('keepalivePing')],
  ];
  for (const [name, text] of errorCases) {
    const before = control.length;
    a.ws.send(text);
    await sleep(1500);
    log('sim_case', { name, sent: text.slice(0, 160), replies: control.slice(before).map((c) => c.frame ?? c) });
  }

  await sleep(12000);
  const r = await fetch(`${SIM_REST}/v1/markets/BTC-USDC-PERP/orderbook/hybrid`);
  const rest = await r.json();
  const ws = stats['BTC-USDC-PERP'].last;
  const wsBids = new Map();
  for (let i = 0; i < ws.bids.length; i += 2) wsBids.set(ws.bids[i], ws.bids[i + 1]);
  const top = rest.bids.slice(0, 40);
  log('sim_rest_compare', {
    restSeq: rest.sequenceNumber,
    wsSeq: ws.seq,
    restBids: rest.bids.length,
    restAsks: rest.asks.length,
    top40BidPricesOnSocket: top.filter((l) => wsBids.has(l.price)).length,
    top40BidSizesEqual: top.filter((l) => wsBids.get(l.price) === l.priceLevelQuantity).length,
    restTouch: [rest.bids[0], rest.asks[0]],
    wsTouch: [ws.bids.slice(0, 2), ws.asks.slice(0, 2)],
  });

  await sleep(Math.max(0, 60000 - (Date.now() - created)));
  for (const p of perps) log('sim_book', { symbol: p, ...summary(stats[p]) });
  const l1Gaps = l1.seqs.filter((s, i) => i > 0 && s !== l1.seqs[i - 1] + 1).length;
  log('sim_l1', { frames: l1.frames, types: l1.types, seqGaps: l1Gaps, firstSeq: l1.seqs[0], lastSeq: l1.seqs[l1.seqs.length - 1] });
  log('sim_control', { pongs, protocolPings, unexpected: control.filter((c) => c.unexpectedBook) });
  for (const [s, b] of Object.entries(tick.bySym)) {
    const ch = (v) => v.filter((y, i) => i > 0 && y !== v[i - 1]).length;
    log('sim_tick_ws', { symbol: s, frames: b.frames, markChanges: ch(b.marks), rateChanges: ch(b.rates), createdChanges: ch(b.created), rates: [...new Set(b.rates)] });
  }
  log('sim_tick_ws_meta', { types: tick.types, fields: tick.fields, control: tick.control });
  for (const [s, b] of Object.entries(index.bySym)) {
    const gaps = b.arrivals.map((v, i) => (i === 0 ? null : v - b.arrivals[i - 1])).filter((v) => v !== null);
    log('sim_index_ws', { asset: s, frames: b.frames, types: b.types, priceChanges: b.prices.filter((y, i) => i > 0 && y !== b.prices[i - 1]).length, interFrameMs: q(gaps), arrivalMinusUpdatedMs: q(b.lag) });
  }
  log('sim_index_ws_meta', { control: index.control });
  const closes = [];
  for (const s of [a, t, x]) {
    const t0 = Date.now();
    s.ws.on('close', (code) => closes.push({ code, ms: Date.now() - t0 }));
    s.ws.close(1000);
  }
  await sleep(3000);
  log('sim_client_close', { closes });
}

async function batch() {
  const markets = await (await fetch(`${SIM_REST}/v1/markets?marketType=PERPETUAL`)).json();
  const perps = markets.filter((m) => m.marketEnabled).map((m) => m.symbol);
  const a = await open(SIM_WS + BOOK_PATH);
  log('sim_open', { path: BOOK_PATH, status: a.status, ms: a.ms });
  const stats = Object.fromEntries(perps.map((p) => [p, bookStats()]));
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let acks = 0;
  let nacks = 0;
  const perSecond = new Map();
  const oneSided = [];
  a.ws.on('message', (raw) => {
    const arrivedAt = Date.now();
    frames++;
    bytes += raw.length;
    const t0 = process.hrtime.bigint();
    const f = JSON.parse(raw.toString('utf8'));
    parseNs += process.hrtime.bigint() - t0;
    const sec = Math.floor(arrivedAt / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (f.dataType === 'V1TALevel2' && stats[f.data.symbol]) {
      if (stats[f.data.symbol].frames === 0 && (f.data.bids.length === 0 || f.data.asks.length === 0)) {
        oneSided.push({ symbol: f.data.symbol, bidsKey: Array.isArray(f.data.bids), asksKey: Array.isArray(f.data.asks), bids: f.data.bids.length / 2, asks: f.data.asks.length / 2 });
        capture('sim-batch-onesided.jsonl', trim(f));
      }
      applyBook(stats[f.data.symbol], f, arrivedAt);
    } else if (f.result) acks++;
    else if (f.error) nacks++;
  });
  const t0 = Date.now();
  for (const p of perps) a.ws.send(command('subscribe', { topic: 'l2Orderbook', symbol: p }));
  await sleep(30000);
  const secs = [...perSecond.values()].slice(1, -1);
  let gaps = 0;
  let wide = 0;
  let updates = 0;
  const silent = [];
  const levels = [];
  for (const p of perps) {
    const s = stats[p];
    gaps += s.gaps;
    wide += s.rangeWide;
    updates += Object.entries(s.types).filter(([k]) => k.startsWith('update')).reduce((n, [, v]) => n + v, 0);
    if (s.frames === 0) silent.push(p);
    levels.push([p, s.frames, Math.max(...s.bidLevels, 0), Math.max(...s.askLevels, 0)]);
  }
  log('sim_batch', {
    perps: perps.length,
    seconds: (Date.now() - t0) / 1000,
    acks,
    nacks,
    frames,
    framesPerSecond: q(secs),
    bytesPerSecond: Math.round(bytes / 30),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseUsPerFrame: Number(parseNs / BigInt(Math.max(1, frames))) / 1000,
    seqGaps: gaps,
    rangeLowerNotUpper: wide,
    updateFrames: updates,
    silentPerps: silent,
  });
  log('sim_batch_levels', { perSymbolFramesMaxBidsMaxAsks: levels });
  log('sim_batch_onesided', { firstFrames: oneSided });
  a.ws.close();
  await sleep(500);
}

async function silence() {
  const cases = [
    ['bare', null, 0],
    ['subscribed_no_ping', command('subscribe', { topic: 'l1Orderbook', symbol: 'CHZ-USDC-PERP' }), 0],
    ['ping_every_30s', null, 30000],
    ['busy_book_no_ping', command('subscribe', { topic: 'l2Orderbook', symbol: 'BTC-USDC-PERP' }), 0],
  ];
  const results = await Promise.all(
    cases.map(async ([name, sub, pingMs]) => {
      const t0 = Date.now();
      const r = await open(SIM_WS + BOOK_PATH);
      let frames = 0;
      let pongs = 0;
      let protocolPings = 0;
      let lastFrameAt = null;
      r.ws.on('ping', () => protocolPings++);
      r.ws.on('message', (raw) => {
        frames++;
        lastFrameAt = Date.now() - t0;
        if (String(raw).includes('Keep alive pong')) pongs++;
      });
      if (sub) r.ws.send(sub);
      const timer = pingMs ? setInterval(() => r.ws.readyState === 1 && r.ws.send(command('keepalivePing')), pingMs) : null;
      const closed = await new Promise((resolve) => {
        const limit = setTimeout(() => resolve(null), 120000);
        r.ws.on('close', (code, reason) => {
          clearTimeout(limit);
          resolve({ code, reason: String(reason), atMs: Date.now() - t0 });
        });
      });
      if (timer) clearInterval(timer);
      const heldMs = Date.now() - t0;
      if (!closed) r.ws.close();
      return { name, openMs: r.ms, closed, heldMs, frames, pongs, protocolPings, lastFrameAt };
    }),
  );
  for (const r of results) log('sim_silence', r);
  await sleep(500);
}

async function deflate() {
  const r = await open(SIM_WS + BOOK_PATH, { perMessageDeflate: true });
  log('sim_deflate', { status: r.status, extensions: r.ws?.extensionsHeader ?? null, negotiated: r.ws ? Object.keys(r.ws._extensions ?? {}) : null });
  if (r.ws) {
    let n = 0;
    r.ws.on('message', () => n++);
    r.ws.send(command('subscribe', { topic: 'l1Orderbook', symbol: 'BTC-USDC-PERP' }));
    await sleep(3000);
    log('sim_deflate_frames', { frames: n });
    r.ws.close();
  }
  await sleep(300);
}

const mode = process.argv[2] ?? 'access';
const modes = { access, book, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
