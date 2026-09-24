// Webot WebSocket probe: the DEPTH channel on wss://ws.pionex.us/wsPub, its snapshot semantics, level order and window, idle repeats, keepalive, silence, errors, compression and a whole-catalog batch on one connection.
// Webot (formerly Pionex.US) publishes no API documentation, so the frames are those of the Pionex open API docs, sent to the Pionex.US public stream host.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node ../scripts/probes/venues/webot/ws-probe.mjs [endpoints|book|errors|batch|silence|deflate]
//   endpoints  tries the documented Pionex path on the Webot and Pionex.US hosts, one DEPTH subscribe each, 3 s per URL.
//   book     DEPTH 20 on five spot pairs and TRADE on one for 45 s, then a REST book compare. About 50 s.
//   errors   unknown symbols, bad topics and limits, duplicates, non-JSON, unsubscribe. About 30 s.
//   batch    DEPTH 20 on every catalog symbol on one connection, one subscribe per BATCH_PACE_MS (default 120, 0 is one burst), then BATCH_HOLD_MS (default 30,000) of listening. About 80 s.
//   silence  three sockets that differ in what they subscribe and whether they answer PING, for up to SILENCE_CAP_MS (default 110,000).
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/webot/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_PUB = 'wss://ws.pionex.us/wsPub';
const API = 'https://api.webot.com';
const OUT = process.env.PROBE_OUT_DIR;
const PACE_MS = Number(process.env.BATCH_PACE_MS ?? 120); // gap between subscribe frames in the batch mode, 0 sends them in one burst
const HOLD_MS = Number(process.env.BATCH_HOLD_MS ?? 30_000); // how long the batch mode listens after the last subscribe
const SILENCE_CAP_MS = Number(process.env.SILENCE_CAP_MS ?? 110_000); // the silence mode closes any socket still open at this age
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url = URL_PUB, opts = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000, ...opts });
    ws.once('upgrade', (res) => { ws.upgradeHeaders = res.headers; });
    ws.once('open', () => { ws.openMs = Date.now() - t0; ws.t0 = t0; resolve(ws); });
    ws.once('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

const send = (ws, obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
const sub = (symbol, limit, topic = 'DEPTH') => ({ op: 'SUBSCRIBE', topic, symbol, ...(limit === undefined ? {} : { limit }) });

async function catalog() {
  const s = await (await fetch(`${API}/api/v1/common/symbols`)).json();
  const t = await (await fetch(`${API}/api/v1/market/tickers`)).json();
  return { symbols: s.data.symbols.map((x) => x.symbol), tickers: t.data.tickers };
}

function sideStats(levels, desc) {
  let misordered = 0;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (desc ? !(b < a) : !(b > a)) misordered++;
  }
  return misordered;
}

async function book() {
  const { tickers } = await catalog();
  const traded = tickers.filter((x) => Number(x.count) > 0).sort((a, b) => Number(a.count) - Number(b.count));
  const quiet = traded[Math.floor(traded.length * 0.1)].symbol;
  const watch = ['BTC_USDT', 'ETH_USDT', 'ZEC_USD', 'USDC_USD', quiet];
  const ws = await open();
  log('open', { url: URL_PUB, openMs: ws.openMs, extensions: ws.upgradeHeaders['sec-websocket-extensions'] ?? null, server: ws.upgradeHeaders.server ?? null, via: ws.upgradeHeaders.via ?? null, pop: ws.upgradeHeaders['x-amz-cf-pop'] ?? null });
  const st = new Map(watch.map((s) => [s, { frames: 0, bytes: 0, minBids: 1e9, maxBids: 0, minAsks: 1e9, maxAsks: 0, badBids: 0, badAsks: 0, repeats: 0, gaps: [], last: null, lastAt: 0, firstAt: null, ages: [], keys: null, crossed: 0 }]));
  const pings = [];
  const other = [];
  const trades = { frames: 0, records: 0, keys: null };
  const subAt = Date.now();
  ws.on('message', (buf) => {
    const at = Date.now();
    const text = buf.toString('utf8');
    const f = JSON.parse(text);
    if (f.op === 'PING') {
      pings.push(at - ws.t0);
      send(ws, { op: 'PONG', timestamp: Date.now() });
      if (pings.length === 1) { capture('book-frames.jsonl', text); log('first_ping', { text }); }
      return;
    }
    if (f.topic === 'DEPTH' && f.data) {
      const s = st.get(f.symbol);
      if (!s) return;
      if (s.frames < 3) capture('book-frames.jsonl', text.length > 1500 ? text.slice(0, 1500) + '…' : text);
      s.frames++;
      s.bytes += buf.length;
      s.keys ??= Object.keys(f);
      const { bids, asks } = f.data;
      s.minBids = Math.min(s.minBids, bids.length); s.maxBids = Math.max(s.maxBids, bids.length);
      s.minAsks = Math.min(s.minAsks, asks.length); s.maxAsks = Math.max(s.maxAsks, asks.length);
      s.badBids += sideStats(bids, true) ? 1 : 0;
      s.badAsks += sideStats(asks, false) ? 1 : 0;
      if (bids.length && asks.length && Number(bids[0][0]) >= Number(asks[0][0])) s.crossed++;
      const body = JSON.stringify(f.data);
      if (s.last === body) s.repeats++;
      if (s.lastAt) s.gaps.push(at - s.lastAt);
      s.firstAt ??= at - subAt;
      if (typeof f.timestamp === 'number') s.ages.push(at - f.timestamp);
      s.last = body;
      s.lastAt = at;
      return;
    }
    if (f.topic === 'TRADE' && f.data) {
      trades.frames++;
      trades.records += f.data?.length ?? 0;
      trades.keys ??= Object.keys(f);
      if (trades.frames <= 2) capture('book-frames.jsonl', text.slice(0, 800));
      return;
    }
    other.push(text.slice(0, 300));
    capture('book-frames.jsonl', text);
  });
  for (const s of watch) send(ws, sub(s, 20));
  send(ws, sub('BTC_USDT', undefined, 'TRADE'));
  await sleep(45_000);
  const restAt = Date.now();
  const rest = await (await fetch(`${API}/api/v1/market/depth?symbol=BTC_USDT&limit=20`)).json();
  const wsBtc = JSON.parse(st.get('BTC_USDT').last);
  const same = (a, b) => a.filter((l, i) => b[i] && l[0] === b[i][0] && l[1] === b[i][1]).length;
  log('rest_compare', { symbol: 'BTC_USDT', wsAgeAtRestMs: restAt - st.get('BTC_USDT').lastAt, bidsEqual: same(wsBtc.bids, rest.data.bids), asksEqual: same(wsBtc.asks, rest.data.asks), wsTop: [wsBtc.bids[0], wsBtc.asks[0]], restTop: [rest.data.bids[0], rest.data.asks[0]] });
  ws.terminate();
  for (const [sym, s] of st) {
    log('depth', {
      sym, frames: s.frames, perSec: +(s.frames / 45).toFixed(2), bytesPerFrame: s.frames ? Math.round(s.bytes / s.frames) : 0, firstFrameMs: s.firstAt, keys: s.keys,
      bids: [s.minBids, s.maxBids], asks: [s.minAsks, s.maxAsks], framesBidsMisordered: s.badBids, framesAsksMisordered: s.badAsks, crossed: s.crossed, identicalRepeats: s.repeats,
      gapMs: { median: pct(s.gaps, 0.5), p90: pct(s.gaps, 0.9), max: s.gaps.length ? Math.max(...s.gaps) : null },
      tsAgeMs: s.ages.length ? { min: Math.min(...s.ages), median: pct(s.ages, 0.5), max: Math.max(...s.ages) } : null,
    });
  }
  log('trade', trades);
  log('pings', { atMsSinceOpen: pings });
  log('other_frames', { frames: other.slice(0, 12) });
}

async function errors() {
  const { tickers } = await catalog();
  const dead = tickers.find((x) => Number(x.count) === 0)?.symbol;
  const ws = await open();
  const seen = [];
  const depthBy = new Map();
  ws.on('message', (buf) => {
    const text = buf.toString('utf8');
    const f = JSON.parse(text);
    if (f.op === 'PING') { send(ws, { op: 'PONG', timestamp: Date.now() }); return; }
    if (f.topic === 'DEPTH' && f.data) {
      const k = `${f.symbol}|${f.data.bids.length}/${f.data.asks.length}`;
      if (!depthBy.has(k)) capture('errors-frames.jsonl', text.slice(0, 600));
      depthBy.set(k, (depthBy.get(k) ?? 0) + 1);
      return;
    }
    seen.push({ at: Date.now(), text: text.slice(0, 260) });
    capture('errors-frames.jsonl', text);
  });
  const cases = [
    ['unknown symbol', sub('NOPE_USDT', 20)],
    ['lower case', sub('btc_usdt', 20)],
    ['perp suffix', sub('BTC_USDT_PERP', 20)],
    ['no traded pair 24h', sub(dead, 20)],
    ['unknown topic', sub('BTC_USDT', 20, 'NOPE')],
    ['unknown op', { op: 'NOPE', topic: 'DEPTH', symbol: 'BTC_USDT', limit: 20 }],
    ['no limit', sub('ETH_USDT')],
    ['limit 0', sub('ZEC_USD', 0)],
    ['limit 101', sub('ZEC_USDT', 101)],
    ['limit 1000', sub('SOL_USDT', 1000)],
    ['limit 50', sub('BTC_USD', 50)],
    ['limit 100', sub('BTC_USDC', 100)],
    ['limit as string', sub('ETH_USD', '20')],
    ['first BTC_USDT 20', sub('BTC_USDT', 20)],
    ['duplicate BTC_USDT 20', sub('BTC_USDT', 20)],
    ['BTC_USDT again at 5', sub('BTC_USDT', 5)],
    ['non JSON', 'hello'],
    ['client PING', { op: 'PING', timestamp: Date.now() }],
    ['unsubscribe BTC_USDT', { op: 'UNSUBSCRIBE', topic: 'DEPTH', symbol: 'BTC_USDT' }],
    ['unsubscribe never subscribed', { op: 'UNSUBSCRIBE', topic: 'DEPTH', symbol: 'DOGE_USDT' }],
  ];
  for (const [name, frame] of cases) {
    const before = seen.length;
    const at = Date.now();
    try { send(ws, frame); } catch (e) { log('send_error', { name, error: e.message }); break; }
    await sleep(1200);
    log('case', { name, sent: typeof frame === 'string' ? frame : frame, replies: seen.slice(before).map((r) => ({ ms: r.at - at, text: r.text })), open: ws.readyState === ws.OPEN });
    if (ws.readyState !== ws.OPEN) break;
  }
  await sleep(3000);
  log('depth_streams', Object.fromEntries(depthBy));
  ws.terminate();
}

async function batch() {
  const { symbols, tickers } = await catalog();
  const traded = new Set(tickers.filter((x) => Number(x.count) > 0).map((x) => x.symbol));
  const ws = await open();
  log('open', { openMs: ws.openMs, symbols: symbols.length });
  const acks = new Set();
  const refused = new Set();
  let lastSent = null;
  const errs = [];
  const delivering = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = [];
  let secFrames = 0;
  const tick = setInterval(() => { perSecond.push(secFrames); secFrames = 0; }, 1000);
  let closed = null;
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString(), atMs: Date.now() - ws.t0 }; });
  ws.on('message', (buf) => {
    const t0 = process.hrtime.bigint();
    const f = JSON.parse(buf.toString('utf8'));
    parseNs += process.hrtime.bigint() - t0;
    if (f.op === 'PING') { send(ws, { op: 'PONG', timestamp: Date.now() }); return; }
    if (f.topic === 'DEPTH' && f.data) {
      frames++; secFrames++; bytes += buf.length;
      delivering.set(f.symbol, (delivering.get(f.symbol) ?? 0) + 1);
      return;
    }
    if (f.type === 'SUBSCRIBED') { acks.add(f.symbol); return; }
    if (f.type === 'ERROR' && lastSent) refused.add(lastSent); // the error frame names no symbol, so it is pinned on the last subscribe sent
    if (errs.length < 400) errs.push(JSON.stringify(f).slice(0, 200));
  });
  const t0 = Date.now();
  for (const s of symbols) {
    if (ws.readyState !== ws.OPEN) break;
    lastSent = s;
    send(ws, sub(s, 20));
    if (PACE_MS) await sleep(PACE_MS);
  }
  log('sent', { frames: symbols.length, paceMs: PACE_MS, sendMs: Date.now() - t0, acksSoFar: acks.size, closed });
  frames = 0; bytes = 0; parseNs = 0n; perSecond.length = 0; delivering.clear();
  await sleep(HOLD_MS);
  clearInterval(tick);
  const errKinds = {};
  for (const e of errs) { const k = e.replace(/"symbol":"[^"]*"/, '"symbol":…').replace(/"timestamp":\d+/, '"timestamp":…'); errKinds[k] = (errKinds[k] ?? 0) + 1; }
  const counts = [...delivering.values()];
  log('batch', {
    subscribed: symbols.length, acks: acks.size, errors: errs.length, errKinds, delivering: delivering.size, closed,
    holdMs: HOLD_MS, frames, perSec: { median: pct(perSecond, 0.5), peak: Math.max(...perSecond), mean: +(frames / (HOLD_MS / 1000)).toFixed(1) }, bytesPerSec: Math.round(bytes / (HOLD_MS / 1000)), bytesPerFrame: frames ? Math.round(bytes / frames) : 0,
    parseUsPerFrame: frames ? +(Number(parseNs) / 1000 / frames).toFixed(1) : null,
    framesPerSymbol: { min: Math.min(...counts), median: pct(counts, 0.5), max: Math.max(...counts) },
    silent: symbols.filter((s) => !delivering.has(s)).length,
    refusedAttributed: refused.size, deliveringAcked: [...acks].filter((s) => delivering.has(s)).length, deliveringRefused: [...refused].filter((s) => delivering.has(s)).length,
    firstRefused: symbols.findIndex((s) => refused.has(s)),
    silentAcked: [...acks].filter((s) => !delivering.has(s)).length, silentTraded24h: symbols.filter((s) => !delivering.has(s) && traded.has(s)).length,
    silentAckedExamples: [...acks].filter((s) => !delivering.has(s)).slice(0, 8).map((s) => `${s}:${traded.has(s) ? 'traded' : 'no trade 24h'}`),
  });
  ws.terminate();
}

async function silence() {
  const specs = [
    { name: 'A subscribed, never answers PING', subscribe: true, pong: false },
    { name: 'B unsubscribed, answers PING', subscribe: false, pong: true },
    { name: 'C unsubscribed, never answers PING', subscribe: false, pong: false },
  ];
  const results = await Promise.all(specs.map(async (spec) => {
    const ws = await open();
    const pings = [];
    let depth = 0;
    let lastDepthMs = null;
    return await new Promise((resolve) => {
      const end = (why, code, reason) => { clearTimeout(timer); ws.terminate(); resolve({ name: spec.name, why, code, reason, closedAtMs: Date.now() - ws.t0, pingsAtMs: pings, depthFrames: depth, lastDepthMs }); };
      const timer = setTimeout(() => end('still open at cap'), SILENCE_CAP_MS);
      ws.on('message', (buf) => {
        const f = JSON.parse(buf.toString('utf8'));
        if (f.op === 'PING') { pings.push(Date.now() - ws.t0); if (spec.pong) send(ws, { op: 'PONG', timestamp: Date.now() }); return; }
        if (f.topic === 'DEPTH') { depth++; lastDepthMs = Date.now() - ws.t0; }
        else capture('silence-frames.jsonl', `${spec.name}: ${buf.toString('utf8').slice(0, 300)}`);
      });
      ws.on('close', (code, reason) => end('closed', code, reason.toString()));
      if (spec.subscribe) send(ws, sub('BTC_USDT', 5));
    });
  }));
  for (const r of results) log('silence', r);
}

async function endpoints() {
  const urls = [URL_PUB, 'wss://ws.webot.com/wsPub', 'wss://stream.webot.com/wsPub', 'wss://api.webot.com/wsPub', 'wss://ws.pionex.us/ws'];
  for (const url of urls) {
    const t0 = Date.now();
    const result = await new Promise((resolve) => {
      let frames = 0;
      let first = null;
      const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 8000 });
      const done = (outcome) => { clearTimeout(timer); ws.removeAllListeners(); ws.on('error', () => {}); ws.terminate(); resolve({ url, outcome, frames, first }); };
      const timer = setTimeout(() => done(`open for 3 s, ${Date.now() - t0} ms total`), 3000 + 8000);
      ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => done(`http ${res.statusCode} ${body.slice(0, 120).trim()}`));
      });
      ws.on('error', (e) => done(`error ${e.code ?? e.message}`));
      ws.on('open', () => {
        const openMs = Date.now() - t0;
        send(ws, sub('BTC_USDT', 5));
        setTimeout(() => done(`open in ${openMs} ms`), 3000);
      });
      ws.on('message', (d) => { frames++; first ??= d.toString('utf8').slice(0, 120); });
    });
    log('endpoint', result);
  }
}

async function deflate() {
  const ws = await open(URL_PUB, { perMessageDeflate: true });
  log('deflate', { offered: true, negotiated: ws.upgradeHeaders['sec-websocket-extensions'] ?? null, openMs: ws.openMs });
  let n = 0;
  ws.on('message', () => { n++; });
  send(ws, sub('BTC_USDT', 5));
  await sleep(3000);
  log('deflate_frames', { frames: n });
  ws.terminate();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
const modes = { endpoints, book, errors, batch, silence, deflate };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
await modes[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
