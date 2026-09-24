// BitKan WebSocket probe: the website's own futures socket, since BitKan publishes no WebSocket API.
// The URL wss://s.btckan.com:8080/contract and the frame shapes come from the website bundle https://cdn.bitkan.net/cdn/static/js/config-CiXgh45W.js and useServiceFactory-DTGi92t3.js, not from any documentation.
// It measures whether the socket opens, what a public mark price and trade subscription returns, how the mark and the trades compare with Binance USD-M at the same moment, what an unknown channel returns, how long a silent socket lives, and whether permessage-deflate is negotiated.
// Public, unauthenticated and read-only: no login channel, no account, no order.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitkan/ws-probe.mjs [mark|silence|deflate]
//   mark     contract_mark_price and contract_trade on BINANCE-BTC-USDT and BINANCE-ETH-USDT for 30 s, a Binance premiumIndex poll every second beside it, Binance aggTrades for the same window, one guessed book channel, about 35 s
//   silence  one socket that subscribes nothing and sends nothing, and one that only sends the website's ping every 15 s, for up to 90 s
//   deflate  asks for permessage-deflate once and prints what the server negotiates
// Set PROBE_OUT_DIR to keep raw frames.
// Recorded in docs/profiles/bitkan/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync, inflateRawSync, gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const CONTRACT_URL = 'wss://s.btckan.com:8080/contract';
const BINANCE_PREMIUM = 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=';
const OUT = process.env.PROBE_OUT_DIR;
const PING = { ping: 18212558000 }; // the website sends this literal every 15 s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// The website inflates binary frames with pako, so try zlib, raw deflate and gzip in turn.
function decode(data, isBinary) {
  if (!isBinary) return { kind: 'text', text: data.toString('utf8') };
  for (const [kind, fn] of [['zlib', inflateSync], ['raw', inflateRawSync], ['gzip', gunzipSync]]) {
    try {
      return { kind, text: fn(data).toString('utf8') };
    } catch {}
  }
  return { kind: 'binary-unknown', text: data.toString('hex').slice(0, 80) };
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000, ...opts });
  return new Promise((resolve) => {
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0, ext: ws.extensions }));
    ws.once('unexpected-response', (_req, res) => {
      log('refused', { url, status: res.statusCode, headers: res.headers });
      resolve({ ws: null, openMs: Date.now() - t0 });
    });
    ws.once('error', (err) => {
      log('error', { url, message: err.message });
      resolve({ ws: null, openMs: Date.now() - t0 });
    });
  });
}

async function modeMark() {
  const { ws, openMs } = await open(CONTRACT_URL);
  log('open', { url: CONTRACT_URL, openMs });
  if (!ws) return;
  const t0 = Date.now();
  const stats = new Map(); // sub|pair to frame count, frame kinds, wire and inflated bytes, arrival lag
  const samples = []; // [ms since open, pair, mark, frame]
  const firsts = new Map();
  const trades = [];
  const serverPings = [];
  let pongs = 0;
  ws.on('message', (data, isBinary) => {
    const ms = Date.now() - t0;
    const { kind, text } = decode(data, isBinary);
    capture('bitkan-contract.jsonl', JSON.stringify({ ms, kind, text: text.slice(0, 2000) }));
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      log('unparsed', { ms, kind, text: text.slice(0, 200) });
      return;
    }
    if (msg.ping !== undefined) serverPings.push({ ms, offsetMs: Date.now() - msg.ping });
    if (msg.pong !== undefined || msg.ping !== undefined) {
      pongs++;
      if (pongs <= 2) log('keepalive_reply', { ms, kind, frame: text.slice(0, 200) });
      return;
    }
    const key = `${msg.sub ?? msg.channel ?? msg.type ?? '?'}|${msg.trade_pair ?? ''}`;
    const s = stats.get(key) ?? { n: 0, kinds: new Set(), wire: 0, json: 0, lag: [] };
    s.n++;
    s.kinds.add(kind);
    s.wire += data.length;
    s.json += text.length;
    if (typeof msg.time === 'number' && !msg.status) s.lag.push(Date.now() - msg.time);
    stats.set(key, s);
    if (!firsts.has(key)) {
      firsts.set(key, true);
      log('first_frame', { ms, kind, bytes: data.length, frame: text.slice(0, 600) });
    }
    if (msg.mark_price !== undefined) samples.push([ms, msg.trade_pair, Number(msg.mark_price), msg]);
    if (msg.sub === 'contract_trade' && msg.price !== undefined) trades.push({ ...msg, rx: Date.now() });
  });
  ws.on('close', (code, reason) => log('close', { ms: Date.now() - t0, code, reason: reason.toString() }));

  const subs = [
    { sub: 'contract_mark_price', trade_pair: 'BINANCE-BTC-USDT', exchange: 'binance', type: 'add' },
    { sub: 'contract_mark_price', trade_pair: 'BINANCE-ETH-USDT', exchange: 'binance', type: 'add' },
    { sub: 'contract_trade', trade_pair: 'BINANCE-BTC-USDT', exchange: 'binance', type: 'add' },
    { sub: 'contract_mark_price', trade_pair: 'BINANCE-NOPE-USDT', exchange: 'binance', type: 'add' },
    { sub: 'contract_depth', trade_pair: 'BINANCE-BTC-USDT', exchange: 'binance', type: 'add' }, // guessed name, no bundle uses it
  ];
  for (const s of subs) ws.send(JSON.stringify(s));
  log('sent', { subs });

  // Binance USD-M premiumIndex beside the socket, every second, to compare marks.
  const binance = [];
  const ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify(PING)), 15_000);
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    for (const sym of ['BTCUSDT', 'ETHUSDT']) {
      try {
        const res = await fetch(BINANCE_PREMIUM + sym);
        const j = await res.json();
        binance.push([Date.now() - t0, sym, Number(j.markPrice), Number(j.indexPrice), Number(j.lastFundingRate), j.time, j.nextFundingTime]);
      } catch (e) {
        log('binance_error', { message: e.message });
      }
    }
    await sleep(1_000);
  }
  clearInterval(ping);
  ws.close();
  await sleep(300);

  for (const [key, s] of stats) {
    s.lag.sort((x, y) => x - y);
    const lag = s.lag.length ? { min: s.lag[0], p50: s.lag[s.lag.length >> 1], max: s.lag.at(-1) } : null;
    log('stream', { key, frames: s.n, kinds: [...s.kinds], wireBytes: s.wire, jsonBytes: s.json, receiveMinusFrameTimeMs: lag });
  }
  log('keepalive', { replies: pongs, serverPings });
  await compareTrades(trades);

  // For each BitKan mark, the Binance mark read closest in time on the same symbol.
  for (const pair of ['BINANCE-BTC-USDT', 'BINANCE-ETH-USDT']) {
    const sym = pair.split('-').slice(1).join('');
    const mine = samples.filter((x) => x[1] === pair);
    const theirs = binance.filter((x) => x[1] === sym);
    const dec = (x) => (String(x).split('.')[1] ?? '').length;
    const round = (x, d) => Number(x.toFixed(d));
    let equal = 0;
    let rateEqual = 0;
    let indexEqual = 0;
    let nextEqual = 0;
    let maxPpm = 0;
    const gaps = [];
    for (let i = 1; i < mine.length; i++) gaps.push(mine[i][0] - mine[i - 1][0]);
    for (const [ms, , mark, msg] of mine) {
      let best = null;
      for (const b of theirs) if (!best || Math.abs(b[0] - ms) < Math.abs(best[0] - ms)) best = b;
      if (!best) continue;
      if (round(best[2], dec(msg.mark_price)) === mark) equal++;
      if (round(best[3], dec(msg.index_price)) === Number(msg.index_price)) indexEqual++;
      if (best[4] === Number(msg.rate)) rateEqual++;
      if (best[6] === msg.next_time) nextEqual++;
      maxPpm = Math.max(maxPpm, Math.abs(mark / best[2] - 1) * 1e6);
    }
    gaps.sort((a, b) => a - b);
    const last = mine.at(-1)?.[3];
    log('mark_compare', {
      pair,
      bitkanFrames: mine.length,
      binancePolls: theirs.length,
      markEqualToNearestBinanceRounded: equal,
      indexEqualToNearestBinanceRounded: indexEqual,
      rateEqualToBinanceLastFundingRate: rateEqual,
      nextTimeEqualToBinanceNextFundingTime: nextEqual,
      maxMarkDiffPpm: Math.round(maxPpm),
      gapMsMedian: gaps[Math.floor(gaps.length / 2)] ?? null,
      gapMsMax: gaps.at(-1) ?? null,
      lastBitkan: last ? { mark_price: last.mark_price, index_price: last.index_price, rate: last.rate, next_time: last.next_time, prev_time: last.prev_time, prev_rate: last.prev_rate, settle_price: last.settle_price } : null,
      lastBinance: theirs.at(-1)?.slice(2) ?? null,
    });
  }
}

// Each BitKan trade set against Binance USD-M aggTrades by price, quantity and side, and each Binance aggTrade looked up on BitKan.
async function compareTrades(trades) {
  if (trades.length === 0) return;
  const from = trades[0].time - 2_000;
  const to = trades.at(-1).time;
  let agg = [];
  let start = from;
  for (let k = 0; k < 5; k++) {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=BTCUSDT&limit=1000&startTime=${start}&endTime=${to}`);
    const page = await res.json();
    agg = agg.concat(page);
    if (page.length < 1000) break;
    start = page.at(-1).T + 1;
  }
  const offsets = [];
  const arrival = [];
  let sideAgree = 0;
  for (const t of trades) {
    const hits = agg.filter((a) => Number(a.p) === Number(t.price) && Number(a.q) === Number(t.volume));
    if (hits.length === 0) continue;
    const best = hits.reduce((p, a) => (Math.abs(a.T - t.time) < Math.abs(p.T - t.time) ? a : p));
    offsets.push(t.time - best.T);
    arrival.push(t.rx - best.T);
    if ((t.type === '1') === (best.m === false)) sideAgree++;
  }
  // Binance aggTrades inside the BitKan window, less the last 600 ms whose relay may not have arrived before the socket closed.
  const seen = new Set(trades.map((t) => `${Number(t.price)}|${Number(t.volume)}`));
  const inside = agg.filter((a) => a.T >= trades[0].time - 500 && a.T <= to - 600);
  offsets.sort((a, b) => a - b);
  arrival.sort((a, b) => a - b);
  log('trade_compare', {
    receiveHereMinusBinanceT: { min: arrival[0], p50: arrival[arrival.length >> 1], max: arrival.at(-1) },
    bitkanTrades: trades.length,
    matchedByPriceAndQty: offsets.length,
    sideAgreeType1IsBuy: sideAgree,
    bitkanTimeMinusBinanceT: { min: offsets[0], p50: offsets[offsets.length >> 1], max: offsets.at(-1) },
    binanceAggInWindow: inside.length,
    binanceAggFoundOnBitkan: inside.filter((a) => seen.has(`${Number(a.p)}|${Number(a.q)}`)).length,
  });
}

async function modeSilence() {
  const a = await open(CONTRACT_URL);
  const b = await open(CONTRACT_URL);
  log('open', { silentMs: a.openMs, pingOnlyMs: b.openMs });
  const t0 = Date.now();
  const closed = {};
  for (const [name, c] of [['silent', a], ['ping_only', b]]) {
    if (!c.ws) continue;
    c.ws.on('ping', () => log('server_ping', { name, ms: Date.now() - t0 }));
    c.ws.on('message', (data, isBinary) => log('message', { name, ms: Date.now() - t0, frame: decode(data, isBinary).text.slice(0, 120) }));
    c.ws.on('close', (code) => {
      closed[name] = { ms: Date.now() - t0, code };
      log('close', { name, ms: Date.now() - t0, code });
    });
  }
  const ping = setInterval(() => b.ws?.readyState === 1 && b.ws.send(JSON.stringify(PING)), 15_000);
  const until = Date.now() + 90_000;
  while (Date.now() < until && Object.keys(closed).length < 2) await sleep(500);
  clearInterval(ping);
  log('silence_result', { closed, heldMs: Date.now() - t0 });
  a.ws?.terminate();
  b.ws?.terminate();
}

async function modeDeflate() {
  const { ws, openMs, ext } = await open(CONTRACT_URL, { perMessageDeflate: true });
  log('deflate', { openMs, negotiated: ws ? ws._req?.res?.headers?.['sec-websocket-extensions'] ?? null : null, extensions: ext ? Object.keys(ext) : null });
  ws?.terminate();
}

const mode = process.argv[2] ?? 'mark';
const run = { mark: modeMark, silence: modeSilence, deflate: modeDeflate }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
