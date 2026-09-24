// Aivora futures WebSocket probe: depth and ticker channels, frame encoding, level order and window, idle repeats, errors, keepalive, silence, and every perpetual on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/aivora/ws-probe.mjs [book|batch|silence|deflate]
//   book     depth at the finest step on four perps and two tickers for 60 s, a REST book compare, then error cases. About 80 s.
//   batch    depth at the finest step on every tradable perp on one connection for 60 s. About 65 s.
//   silence  five sockets that differ only in whether they subscribe, answer the server ping, or send the documented client ping, for up to 120 s.
//   deflate  asks for permessage-deflate once, and opens the other socket URLs the site names. About 15 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/aivora/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://openapi.aivora.com/futures/ws';
const API = 'https://openapi.aivora.com/futures/open/fapi/v1';
const WEB_INFO = 'https://api.aivora.com/futures/api/common/public_info_v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel) => JSON.stringify({ event: 'sub', params: { channel, cb_id: '1' } });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

// Frames are documented as gzip, so a binary frame is inflated and a text frame is read as is.
function decode(data, isBinary) {
  if (!isBinary) return { text: data.toString('utf8'), gzip: false };
  try {
    return { text: gunzipSync(data).toString('utf8'), gzip: true };
  } catch {
    return { text: data.toString('utf8'), gzip: false };
  }
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false, handshakeTimeout: 15000 });
  ws.t0 = t0;
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => log('unexpected_response', { url, status: res.statusCode, body: body.slice(0, 200) }));
  });
  ws.on('error', (e) => log('socket_error', { url, error: e.message }));
  return ws;
}

async function webContracts() {
  const res = await fetch(WEB_INFO, { method: 'POST', headers: { 'Content-Type': 'application/json', 'exchange-client': 'pc' }, body: '{}' });
  const j = await res.json();
  return j.data.contractList.map((c) => ({ name: c.contractName, sub: c.subSymbol, step: c.coinResultVo.depthList[0], mult: c.multiplier }));
}

const depthChannel = (c) => `market_${c.sub}_depth_${c.step}`;

async function book() {
  const all = await webContracts();
  const pick = ['E-BTC-USDT', 'E-ETH-USDT', 'E-FARTCOIN-USDT', 'E-XAU-USDT'].map((n) => all.find((c) => c.name === n));
  const ws = open(WS_URL);
  const streams = new Map();
  const tickers = new Map();
  const control = [];
  const pings = [];
  let binary = 0;
  let text = 0;
  let gz = 0;
  let restCompare = null;
  const lastFrame = new Map();
  ws.on('upgrade', (res) => log('upgrade', { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null }));
  ws.on('open', () => {
    log('open', { ms: Date.now() - ws.t0 });
    for (const c of pick) {
      streams.set(depthChannel(c), { c, frames: 0, arrivals: [], bidLevels: [], askLevels: [], badOrder: 0, repeats: 0, subAt: Date.now(), firstMs: null, tsSamples: [], cumBad: 0 });
      ws.send(sub(depthChannel(c)));
    }
    for (const t of ['market_e_btcusdt', 'market_e_fartcoinusdt']) {
      tickers.set(t, { frames: 0, changes: {}, last: null, arrivals: [], markIsLast: 0, markIsIndex: 0 });
      ws.send(sub(t));
    }
    log('sent_subscribe', { channels: [...streams.keys(), ...tickers.keys()] });
  });
  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    if (isBinary) binary++;
    else text++;
    const d = decode(data, isBinary);
    if (d.gzip) gz++;
    let j;
    try {
      j = JSON.parse(d.text);
    } catch {
      control.push({ at: now - ws.t0, raw: d.text.slice(0, 200) });
      return;
    }
    if (j.ping !== undefined) {
      pings.push(now - ws.t0);
      if (pings.length === 1) log('server_ping', { frame: j, binary: isBinary });
      ws.send(JSON.stringify({ pong: j.ping }));
      return;
    }
    const s = streams.get(j.channel);
    if (s && j.tick) {
      capture('book.jsonl', JSON.stringify({ t: now, s: d.text.slice(0, 3000) }));
      s.frames++;
      if (s.firstMs === null) {
        s.firstMs = now - s.subAt;
        log('first_depth', { channel: j.channel, afterSubscribeMs: s.firstMs, envelopeKeys: Object.keys(j), tickKeys: Object.keys(j.tick), eventResp: j.eventResp ?? null, ts: j.ts, tickTs: j.tick.ts });
      }
      s.arrivals.push(now);
      const b = j.tick.bids ?? j.tick.buys ?? [];
      const a = j.tick.asks ?? [];
      s.bidLevels.push(b.length);
      s.askLevels.push(a.length);
      if (!b.every((x, i) => i === 0 || Number(x[0]) < Number(b[i - 1][0])) || !a.every((x, i) => i === 0 || Number(x[0]) > Number(a[i - 1][0]))) s.badOrder++;
      if (!b.every((x, i) => Number(x[2]) === b.slice(0, i + 1).reduce((acc, y) => acc + Number(y[1]), 0))) s.cumBad++;
      const key = JSON.stringify([b, a]);
      if (lastFrame.get(j.channel) === key) s.repeats++;
      lastFrame.set(j.channel, key);
      if (s.tsSamples.length < 3) s.tsSamples.push([j.ts, j.tick.ts]);
      s.last = { at: now, b, a };
      return;
    }
    const t = tickers.get(j.channel);
    if (t && j.tick) {
      t.frames++;
      t.arrivals.push(now);
      if (t.frames === 1) log('first_ticker', { channel: j.channel, frame: j });
      if (j.tick.sign_price === j.tick.close) t.markIsLast++;
      if (Number(j.tick.sign_price) === Number(j.tick.index_price)) t.markIsIndex++;
      if (t.last) for (const f of ['sign_price', 'index_price', 'funding_rate_last', 'funding_rate_next', 'last_fund_rate_third', 'close']) if (j.tick[f] !== t.last[f]) t.changes[f] = (t.changes[f] ?? 0) + 1;
      t.last = j.tick;
      return;
    }
    control.push({ at: now - ws.t0, frame: d.text.slice(0, 300) });
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString(), atMs: Date.now() - ws.t0 }));

  await sleep(30000);
  const btc = streams.get(depthChannel(pick[0]));
  const rest = await (await fetch(`${API}/depth?contractName=E-BTC-USDT&limit=30`)).json();
  const wsSide = btc.last;
  const restBid = new Map(rest.bids.map((x) => [x[0], x[1]]));
  const matchPrices = wsSide.b.filter((x) => restBid.has(x[0]));
  restCompare = { wsAgeMs: Date.now() - wsSide.at, sharedBidPrices: matchPrices.length, sameSizeAtSharedPrice: matchPrices.filter((x) => restBid.get(x[0]) === x[1]).length, wsTop: [wsSide.b[0], wsSide.a[0]], restTop: [rest.bids[0], rest.asks[0]], priceTextSame: wsSide.b[0][0].includes('.') === rest.bids[0][0].includes('.') };
  const anchorCompare = [];
  for (const [ch, name] of [['market_e_btcusdt', 'E-BTC-USDT'], ['market_e_fartcoinusdt', 'E-FARTCOIN-USDT']]) {
    const idx = await (await fetch(`${API}/index?contractName=${name}`)).json();
    const tk = tickers.get(ch).last ?? {};
    anchorCompare.push({ name, rest: idx, ws: { sign_price: tk.sign_price, index_price: tk.index_price, funding_rate_last: tk.funding_rate_last, funding_rate_next: tk.funding_rate_next, last_fund_rate_third: tk.last_fund_rate_third } });
  }
  await sleep(30000);

  for (const [ch, s] of streams) {
    const gaps = s.arrivals.slice(1).map((x, i) => x - s.arrivals[i]);
    log('depth_summary', { channel: ch, mult: s.c.mult, frames: s.frames, perSecond: +(s.frames / 60).toFixed(2), interArrivalMs: stats(gaps), bidLevels: stats(s.bidLevels), askLevels: stats(s.askLevels), framesOutOfOrder: s.badOrder, col3NotCumulative: s.cumBad, identicalToPrevious: s.repeats, tsSamples: s.tsSamples, lastTop: [s.last?.b[0], s.last?.a[0]] });
  }
  for (const [ch, t] of tickers) {
    const gaps = t.arrivals.slice(1).map((x, i) => x - t.arrivals[i]);
    log('ticker_summary', { channel: ch, frames: t.frames, interArrivalMs: stats(gaps), markEqualsLast: t.markIsLast, markEqualsIndex: t.markIsIndex, changes: t.changes, last: t.last && { sign_price: t.last.sign_price, index_price: t.last.index_price, funding_rate_last: t.last.funding_rate_last, funding_rate_next: t.last.funding_rate_next, last_fund_rate_third: t.last.last_fund_rate_third, admin_fund_rate_source: t.last.admin_fund_rate_source } });
  }
  log('rest_compare', restCompare);
  for (const a of anchorCompare) log('anchor_rest_vs_ws_ticker', a);
  log('frames_encoding', { binary, text, gzipDecoded: gz });
  log('server_pings', { count: pings.length, atMs: pings, gapsMs: pings.slice(1).map((x, i) => x - pings[i]) });
  log('control_frames', { count: control.length, first: control.slice(0, 5) });

  // Error cases on the same socket, with the good streams unsubscribed first so replies stand out.
  for (const ch of [...streams.keys(), ...tickers.keys()]) ws.send(JSON.stringify({ event: 'unsub', params: { channel: ch, cb_id: '1' } }));
  await sleep(2000);
  const seenAfterUnsub = new Map();
  ws.removeAllListeners('message');
  ws.on('message', (data, isBinary) => {
    const d = decode(data, isBinary);
    let j;
    try {
      j = JSON.parse(d.text);
    } catch {
      log('err_reply_nonjson', { raw: d.text.slice(0, 200) });
      return;
    }
    if (j.ping !== undefined) {
      ws.send(JSON.stringify({ pong: j.ping }));
      return;
    }
    const k = j.channel ?? j.event_rep ?? Object.keys(j).join(',');
    seenAfterUnsub.set(k, (seenAfterUnsub.get(k) ?? 0) + 1);
    if (seenAfterUnsub.get(k) === 1) log('err_reply', { key: k, frame: d.text.slice(0, 300) });
  });
  const cases = [
    'market_e_nopeusdt_depth_0.1',
    'market_e_btcusdt_depth_0.01',
    'market_e_btcusdt_depth_1',
    'market_e_btcusdt_depth_step0',
    'market_e_btcusdt_nope',
    'market_e_arusdt_depth_0.001',
    'market_e_btcusdc_depth_0.1',
    'market_btcusdt_depth_0.1',
    'market_e_btcusdt_trade_ticker',
    'market_e_btcusdt_deals',
    'market_e_btcusdt_kline_1min',
  ];
  for (const c of cases) {
    ws.send(sub(c));
    await sleep(300);
  }
  ws.send('not json');
  ws.send(sub('market_e_ethusdt_depth_0.01'));
  ws.send(sub('market_e_ethusdt_depth_0.01'));
  await sleep(6000);
  log('err_counts', { perKey: Object.fromEntries(seenAfterUnsub) });
  ws.terminate();
}

async function batch() {
  const all = await webContracts();
  const ws = open(WS_URL);
  const per = new Map(all.map((c) => [depthChannel(c), { n: 0, arr: [] }]));
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSec = new Map();
  const other = [];
  let subAt = 0;
  ws.on('open', () => {
    log('open', { ms: Date.now() - ws.t0, streams: per.size });
    subAt = Date.now();
    for (const ch of per.keys()) ws.send(sub(ch));
  });
  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    const d = decode(data, isBinary);
    const p0 = process.hrtime.bigint();
    let j;
    try {
      j = JSON.parse(d.text);
    } catch {
      other.push(d.text.slice(0, 120));
      return;
    }
    parseNs += process.hrtime.bigint() - p0;
    if (j.ping !== undefined) {
      ws.send(JSON.stringify({ pong: j.ping }));
      return;
    }
    const s = per.get(j.channel);
    if (!s) {
      other.push(d.text.slice(0, 200));
      return;
    }
    frames++;
    bytes += data.length;
    s.n++;
    s.arr.push(now);
    const sec = Math.floor((now - subAt) / 1000);
    perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString(), atMs: Date.now() - ws.t0 }));
  await sleep(62000);
  const silent = [...per].filter(([, s]) => s.n === 0).map(([k]) => k);
  const maxGap = [...per].map(([k, s]) => [k, Math.max(0, ...s.arr.slice(1).map((x, i) => x - s.arr[i]))]).sort((a, b) => b[1] - a[1]);
  const firstMs = [...per].map(([, s]) => (s.arr[0] ? s.arr[0] - subAt : null)).filter((x) => x !== null);
  const rates = [...perSec.entries()].filter(([s]) => s >= 2 && s < 60).map(([, n]) => n);
  log('batch_summary', { streams: per.size, frames, framesPerSecond: stats(rates), bytesPerFrame: Math.round(bytes / Math.max(frames, 1)), kbPerSecond: Math.round(bytes / 60 / 1024), parseUsPerFrame: +(Number(parseNs / 1000n) / Math.max(frames, 1)).toFixed(1), silentStreams: silent, firstFrameAfterSubscribeMs: stats(firstMs), framesPerStream: stats([...per.values()].map((s) => s.n)) });
  log('batch_longest_gaps_ms', { top: maxGap.slice(0, 8) });
  log('batch_other_frames', { count: other.length, first: other.slice(0, 4) });
  ws.terminate();
}

async function silence() {
  const variants = [
    { id: 'A_nosub_nopong', subscribe: false, pong: false },
    { id: 'B_nosub_pong', subscribe: false, pong: true },
    { id: 'C_sub_nopong', subscribe: true, pong: false },
    { id: 'D_sub_pong', subscribe: true, pong: true },
    { id: 'E_sub_clientping', subscribe: true, pong: false, clientPing: true },
  ];
  const until = Date.now() + 120000;
  const done = variants.map(
    (v) =>
      new Promise((resolve) => {
        const ws = open(WS_URL);
        const pings = [];
        const replies = [];
        let data = 0;
        let beat = null;
        ws.on('open', () => {
          if (v.subscribe) ws.send(sub('market_e_xauusdt_depth_0.01'));
          // The documentation shows {"ping": "ping"} under "send a heartbeat within 30 s".
          if (v.clientPing) beat = setInterval(() => ws.send(JSON.stringify({ ping: 'ping' })), 10000);
        });
        ws.on('message', (d, isBinary) => {
          const x = decode(d, isBinary);
          let j = null;
          try {
            j = JSON.parse(x.text);
          } catch {}
          if (j?.ping !== undefined) {
            pings.push(Date.now() - ws.t0);
            if (v.pong) ws.send(JSON.stringify({ pong: j.ping }));
          } else if (j && !j.channel) {
            if (replies.length < 3) replies.push(x.text.slice(0, 120));
          } else data++;
        });
        ws.on('ping', () => log('protocol_ping', { id: v.id, atMs: Date.now() - ws.t0 }));
        const timer = setTimeout(() => {
          clearInterval(beat);
          log('silence_result', { id: v.id, closed: false, openForMs: Date.now() - ws.t0, pingsAtMs: pings, dataFrames: data, otherReplies: replies });
          ws.terminate();
          resolve();
        }, until - Date.now());
        ws.on('close', (code, reason) => {
          clearTimeout(timer);
          clearInterval(beat);
          log('silence_result', { id: v.id, closed: true, code, reason: reason.toString(), closedAtMs: Date.now() - ws.t0, pingsAtMs: pings, dataFrames: data, otherReplies: replies });
          resolve();
        });
      }),
  );
  await Promise.all(done);
}

async function deflate() {
  await new Promise((resolve) => {
    const ws = open(WS_URL, { deflate: true });
    ws.on('upgrade', (res) => log('deflate_offer', { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null }));
    ws.on('open', () => ws.send(sub('market_e_btcusdt_depth_0.1')));
    let n = 0;
    ws.on('message', (d, isBinary) => {
      n++;
      if (n <= 2) log('deflate_frame', { binary: isBinary, bytes: d.length, head: decode(d, isBinary).text.slice(0, 80) });
    });
    setTimeout(() => {
      ws.terminate();
      resolve();
    }, 4000);
  });
  for (const url of ['wss://futuresws.aivora.com/kline-api/ws', 'wss://ws.aivora.com/spot', 'wss://openapi.aivora.com/spot/ws', 'wss://ws.aivora.com/kline-api/ws']) {
    await new Promise((resolve) => {
      const ws = open(url);
      const t = setTimeout(() => {
        ws.terminate();
        resolve();
      }, 3000);
      ws.on('upgrade', (res) => log('other_url', { url, status: res.statusCode, ms: Date.now() - ws.t0 }));
      ws.on('error', () => {
        clearTimeout(t);
        resolve();
      });
      ws.on('open', () => {
        clearTimeout(t);
        ws.terminate();
        resolve();
      });
    });
  }
}

const modes = { book, batch, silence, deflate };
const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
