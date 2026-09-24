// Bittime USDT-M futures WebSocket probe: gzip framing, the depth_step0 book, ping and pong, silence, errors, and every perpetual on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bittime/ws-probe.mjs [book|silence|batch|deflate|hosts]
//   book     depth_step0 on four perps plus ticker and trades on BTC for 40 s, error cases, and a REST book compare. About 42 s.
//   silence  three sockets that differ only in whether they subscribe and whether they answer the server ping, for up to 40 s. The book mode is the subscribed socket that answers.
//   batch    depth_step0 on every perpetual on one connection for 45 s.
//   deflate  asks for permessage-deflate once on each of the two socket host names and prints what the server negotiates. About 10 s.
//   hosts    depth_step0 on BTC and ZRX, and the BTC ticker and trades, on the documented host and on the web page's host at once, for 20 s.
// Set PROBE_OUT_DIR to keep decompressed frames. Recorded in docs/profiles/bittime/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const DOC_URL = 'wss://fmarket-ws.bittime.com/kline-api/ws'; // the API docs
const WEB_URL = 'wss://futuresws-cfx.bittime.com/kline-api/ws'; // what the futures web page is handed by public_info
const FAPI = 'https://fapi.bittime.com/fapi/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (arr) => (arr.length ? { n: arr.length, min: Math.min(...arr), median: q(arr, 0.5), p90: q(arr, 0.9), max: Math.max(...arr) } : { n: 0 });
const sub = (channel, cb_id = '') => JSON.stringify({ event: 'sub', params: { channel, cb_id } });
const socketId = (rawMarketId) => rawMarketId.toLowerCase().replace(/-/g, '_').replace(/_usdt$/, 'usdt'); // E-BTC-USDT to e_btcusdt

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// Every data frame is gzip inside a binary WebSocket frame. Text frames are passed through.
function decode(data, isBinary) {
  const t = performance.now();
  let text;
  let gzip = isBinary;
  try { text = isBinary ? gunzipSync(data).toString('utf8') : data.toString('utf8'); } catch { text = data.toString('utf8'); gzip = false; }
  let json;
  try { json = JSON.parse(text); } catch { json = { unparsed: text.slice(0, 200) }; }
  return { text, json, gzip, us: (performance.now() - t) * 1000 };
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  ws.openedAt = new Promise((resolve) => {
    ws.on('upgrade', (res) => { ws.upgradeHeaders = res.headers; });
    ws.on('open', () => resolve(Date.now() - t0));
    ws.on('error', (e) => { log('socket_error', { url, error: e.message }); resolve(null); });
  });
  return ws;
}

async function restDepth(name) {
  const r = await fetch(`${FAPI}/depth?contractName=${name}&limit=100`);
  return r.json();
}

async function book() {
  const contracts = ['E-BTC-USDT', 'E-ETH-USDT', 'E-ZRX-USDT', 'E-XAUT-USDT'];
  const ws = open(DOC_URL);
  const openMs = await ws.openedAt;
  log('open', { url: DOC_URL, openMs, headers: ws.upgradeHeaders });
  const t0 = Date.now();
  const per = new Map(contracts.map((c) => [`market_${socketId(c)}_depth_step0`, { name: c, frames: 0, bids: [], asks: [], bidsDesc: 0, asksAsc: 0, crossed: 0, repeats: 0, prev: null, arrivals: [], tsLag: [], last: null, firstAt: null, keys: null }]));
  const other = [];
  const side = { ticker: [], trade: 0, tickerLag: [], tradeLag: [] };
  const pings = [];
  let binary = 0, text = 0, bytes = 0, parseUs = [];
  ws.on('message', (data, isBinary) => {
    const at = Date.now();
    isBinary ? binary++ : text++;
    bytes += data.length;
    const { text: txt, json, us, gzip } = decode(data, isBinary);
    parseUs.push(us);
    if (json.ping !== undefined) {
      pings.push({ at: at - t0, ping: json.ping, binary: isBinary });
      if (pings.length <= 2) capture('book-frames.jsonl', txt);
      ws.send(JSON.stringify({ pong: json.ping }));
      return;
    }
    const s = per.get(json.channel);
    if (s && json.tick) {
      s.frames++;
      if (!s.keys) { s.keys = { top: Object.keys(json), tick: Object.keys(json.tick) }; s.firstAt = at - t0; capture('book-frames.jsonl', txt.slice(0, 3000)); }
      const b = json.tick.buys ?? [], a = json.tick.asks ?? [];
      s.bids.push(b.length); s.asks.push(a.length);
      if (b.every((l, i) => i === 0 || l[0] < b[i - 1][0])) s.bidsDesc++;
      if (a.every((l, i) => i === 0 || l[0] > a[i - 1][0])) s.asksAsc++;
      if (b.length && a.length && b[0][0] >= a[0][0]) s.crossed++;
      const body = JSON.stringify(json.tick);
      if (body === s.prev) s.repeats++;
      s.prev = body;
      s.arrivals.push(at);
      if (json.ts) s.tsLag.push(at - json.ts);
      s.last = { at, tick: json.tick };
      return;
    }
    if (json.channel === 'market_e_btcusdt_ticker') { side.ticker.push(at); side.tickerLag.push(at - json.ts); if (side.ticker.length <= 2) capture('book-frames.jsonl', txt); return; }
    if (json.channel === 'market_e_btcusdt_trade_ticker') { side.trade++; side.tradeLag.push(at - json.tick.ts); if (side.trade <= 2) capture('book-frames.jsonl', txt); return; }
    if (other.length < 30) other.push({ at: at - t0, binary: isBinary, gzip, frame: txt.slice(0, 400) });
    capture('book-frames.jsonl', txt.slice(0, 3000));
  });
  ws.on('close', (code, reason) => log('close', { at: Date.now() - t0, code, reason: reason.toString() }));

  const subAt = Date.now();
  for (const [ch] of per) ws.send(sub(ch, `cb_${ch}`));
  ws.send(sub('market_e_btcusdt_ticker', 'cb_ticker'));
  ws.send(sub('market_e_btcusdt_trade_ticker', 'cb_trade'));
  await sleep(5000);
  // Error cases, each tagged by cb_id where the frame allows it.
  ws.send(sub('market_e_nopeusdt_depth_step0', 'cb_unknown_symbol'));
  ws.send(sub('market_E_BTCUSDT_depth_step0', 'cb_uppercase'));
  ws.send(sub('market_e_btcusdt_depth_step9', 'cb_bad_step'));
  ws.send(sub('market_e_btcusdt_depth_step0', 'cb_duplicate'));
  ws.send(JSON.stringify({ event: 'nope', params: { channel: 'market_e_btcusdt_ticker' } }));
  ws.send('not json');
  await sleep(35_000);

  // Compare the last socket book of BTC with the REST book read now.
  const busy = per.get('market_e_btcusdt_depth_step0');
  const rest = await restDepth('E-BTC-USDT');
  const wsBook = busy.last.tick;
  const restBids = new Map(rest.bids.map(([p, s]) => [p, s]));
  const restAsks = new Map(rest.asks.map(([p, s]) => [p, s]));
  const same = (lv, m) => lv.filter(([p, s]) => m.get(p) === s).length;
  log('rest_compare', { restAgeMs: Date.now() - rest.time, wsAgeMs: Date.now() - busy.last.at, wsLevels: `${wsBook.buys.length}/${wsBook.asks.length}`, restLevels: `${rest.bids.length}/${rest.asks.length}`, bidsSameSize: same(wsBook.buys, restBids), asksSameSize: same(wsBook.asks, restAsks), wsTop: [wsBook.buys[0], wsBook.asks[0]], restTop: [rest.bids[0], rest.asks[0]] });
  ws.close();
  await sleep(300);

  for (const [ch, s] of per) {
    const gaps = s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]);
    log('depth_channel', { name: s.name, channel: ch, firstFrameAfterSubMs: s.firstAt === null ? null : s.firstAt - (subAt - t0), frames: s.frames, bidLevels: stats(s.bids), askLevels: stats(s.asks), bidsDescending: s.bidsDesc, asksAscending: s.asksAsc, crossed: s.crossed, identicalRepeats: s.repeats, gapMs: stats(gaps), tsLagMs: stats(s.tsLag), keys: s.keys });
  }
  const pingGaps = pings.slice(1).map((p, i) => p.at - pings[i].at);
  log('pings', { count: pings.length, binary: pings.filter((p) => p.binary).length, gapMs: stats(pingGaps), first: pings[0] });
  log('frames', { binary, text, bytes, decodeAndParseUs: stats(parseUs.map(Math.round)) });
  log('ticker_trade', { tickerFrames: side.ticker.length, tickerGapMs: stats(side.ticker.slice(1).map((t, i) => t - side.ticker[i])), tradeFrames: side.trade, tickerTsLagMs: stats(side.tickerLag), tradeTsLagMs: stats(side.tradeLag) });
  log('other_frames', { count: other.length, frames: other });
}

async function silence() {
  const variants = [
    { id: 'sub, no pong', subscribe: true, pong: false },
    { id: 'no sub+pong', subscribe: false, pong: true },
    { id: 'no sub, no pong', subscribe: false, pong: false },
  ];
  const t0 = Date.now();
  const done = variants.map(async (v) => {
    const ws = open(DOC_URL);
    await ws.openedAt;
    const st = { pings: 0, frames: 0, closedAt: null, code: null, lastFrameAt: null };
    ws.on('message', (data, isBinary) => {
      const { json } = decode(data, isBinary);
      st.lastFrameAt = Date.now() - t0;
      if (json.ping !== undefined) { st.pings++; if (v.pong) ws.send(JSON.stringify({ pong: json.ping })); return; }
      st.frames++;
    });
    const closed = new Promise((r) => ws.on('close', (code, reason) => { st.closedAt = Date.now() - t0; st.code = code; st.reason = reason.toString(); r(); }));
    if (v.subscribe) ws.send(sub('market_e_btcusdt_depth_step0'));
    await Promise.race([closed, sleep(40_000)]);
    if (st.closedAt === null) ws.terminate();
    log('silence', { variant: v.id, ...st, openFor: st.closedAt ?? 'still open at 40 s' });
  });
  await Promise.all(done);
}

async function batch() {
  const list = await (await fetch(`${FAPI}/contracts`)).json();
  const names = list.map((c) => c.symbol);
  const ws = open(DOC_URL);
  await ws.openedAt;
  const counts = new Map(names.map((n) => [`market_${socketId(n)}_depth_step0`, { frames: 0, arrivals: [] }]));
  const perSecond = new Map();
  let frames = 0, wireBytes = 0, jsonBytes = 0, pings = 0, others = [];
  const us = [];
  const t0 = Date.now();
  ws.on('message', (data, isBinary) => {
    const at = Date.now();
    const d = decode(data, isBinary);
    us.push(d.us);
    if (d.json.ping !== undefined) { pings++; ws.send(JSON.stringify({ pong: d.json.ping })); return; }
    const c = counts.get(d.json.channel);
    if (!c) { if (others.length < 5) others.push(d.text.slice(0, 200)); return; }
    c.frames++; c.arrivals.push(at);
    frames++; wireBytes += data.length; jsonBytes += d.text.length;
    const sec = Math.floor((at - t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
  });
  ws.on('close', (code) => log('close', { at: Date.now() - t0, code }));
  for (const ch of counts.keys()) ws.send(sub(ch));
  await sleep(45_000);
  ws.close();
  const per = [...counts.entries()].map(([ch, c]) => ({ ch, frames: c.frames, maxGap: c.arrivals.length > 1 ? Math.max(...c.arrivals.slice(1).map((t, i) => t - c.arrivals[i])) : null }));
  per.sort((a, b) => a.frames - b.frames);
  const rates = [...perSecond.values()];
  log('batch', { streams: names.length, silentStreams: per.filter((p) => p.frames === 0).map((p) => p.ch), frames, pings, framesPerSecond: stats(rates), wireBytesPerFrame: Math.round(wireBytes / frames), jsonBytesPerFrame: Math.round(jsonBytes / frames), wireKBps: Math.round(wireBytes / 45 / 1024), jsonKBps: Math.round(jsonBytes / 45 / 1024), gunzipAndParseUs: stats(us.map(Math.round)), framesPerStream: stats(per.map((p) => p.frames)), quietest: per.slice(0, 4), maxGapMs: stats(per.filter((p) => p.maxGap !== null).map((p) => p.maxGap)), others });
}

async function deflate() {
  for (const url of [DOC_URL, WEB_URL]) {
    const ws = open(url, { perMessageDeflate: true });
    const openMs = await ws.openedAt;
    let frames = 0, first = null;
    ws.on('message', (data, isBinary) => { const d = decode(data, isBinary); if (d.json.ping !== undefined) { ws.send(JSON.stringify({ pong: d.json.ping })); return; } frames++; if (!first) first = { binary: isBinary, channel: d.json.channel, bids: d.json.tick?.buys?.length }; });
    ws.send(sub('market_e_btcusdt_depth_step0'));
    await sleep(4000);
    log('deflate', { url, openMs, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, negotiated: ws.extensions, framesIn4s: frames, first });
    ws.close();
  }
}

// The same two streams on the documented host and on the host the web page uses, side by side.
async function hosts() {
  const channels = ['market_e_btcusdt_depth_step0', 'market_e_zrxusdt_depth_step0'];
  const extra = ['market_e_btcusdt_ticker', 'market_e_btcusdt_trade_ticker'];
  const run = async (url) => {
    const ws = open(url);
    const openMs = await ws.openedAt;
    const st = Object.fromEntries(channels.map((c) => [c, { frames: 0, bids: [], asks: [], lag: [], arrivals: [], last: null }]));
    ws.on('message', (data, isBinary) => {
      const at = Date.now();
      const d = decode(data, isBinary);
      if (d.json.ping !== undefined) { ws.send(JSON.stringify({ pong: d.json.ping })); return; }
      if (d.json.channel === extra[0]) { tk.frames++; tk.close = d.json.tick.close; tk.vol = d.json.tick.vol; return; }
      if (d.json.channel === extra[1]) { tr.frames++; tr.trades += d.json.tick.data?.length ?? 0; tr.last = d.json.tick.data?.at(-1); return; }
      const s = st[d.json.channel];
      if (!s || !d.json.tick) return;
      s.frames++; s.bids.push(d.json.tick.buys.length); s.asks.push(d.json.tick.asks.length); s.lag.push(at - d.json.ts); s.arrivals.push(at);
      s.last = { at, bids: d.json.tick.buys.slice(0, 3), asks: d.json.tick.asks.slice(0, 3), bidSum: d.json.tick.buys.reduce((x, l) => x + l[1], 0), askSum: d.json.tick.asks.reduce((x, l) => x + l[1], 0) };
    });
    const tk = { frames: 0 }, tr = { frames: 0, trades: 0 };
    for (const c of [...channels, ...extra]) ws.send(sub(c));
    await sleep(20_000);
    ws.close();
    return { url, openMs, streams: Object.fromEntries(Object.entries(st).map(([c, s]) => [c, { frames: s.frames, bidLevels: stats(s.bids), askLevels: stats(s.asks), tsLagMs: stats(s.lag), gapMs: stats(s.arrivals.slice(1).map((t, i) => t - s.arrivals[i])) }])), ticker: tk, trades: tr, last: Object.fromEntries(Object.entries(st).map(([c, s]) => [c, s.last])) };
  };
  const results = await Promise.all([run(DOC_URL), run(WEB_URL)]);
  const at = Date.now();
  const rest = await Promise.all(['E-BTC-USDT', 'E-ZRX-USDT'].map(async (n) => { const j = await restDepth(n); return { n, age: at - j.time, levels: `${j.bids.length}/${j.asks.length}`, bids: j.bids.slice(0, 3), asks: j.asks.slice(0, 3) }; }));
  for (const r of results) { const { last, ...rest } = r; log('host', rest); log('host_top', { url: r.url, readAt: at, last }); }
  log('rest_top', { rest });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, silence, batch, deflate, hosts };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
setTimeout(() => process.exit(0), 500);
