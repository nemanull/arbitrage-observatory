// BitxEX futures WebSocket probe: handshake, depth snapshot and delta channels, sequence chain, level order, anchor channels, errors, keepalive, silence, deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// The socket is wss://bitxex.io/ws/market, built by the futures web bundle as origin + "/ws" + "/market", the XT.com futures layout.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitxex/ws-probe.mjs [book|errors|silence|deflate]
//   book     depth@<s>,50 and depth_update@<s>,100ms on five perps for 60 s, plus mark, index, funding and agg ticker channels on btc_usdt. About 65 s.
//   silence  one socket that subscribes nothing and sends nothing, and one that only sends "ping" every 20 s, for up to 70 s.
//   errors   one socket each for an unknown symbol, an unsupported depth level and a frame that is not JSON, 12 s each.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep the first raw frames. Recorded in docs/profiles/bitxex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync, inflateRawSync, gunzipSync } from 'node:zlib';

// server/node_modules went away when the TypeScript server moved to old_ts_server/ on 2026-09-24, so the pnpm virtual store is the fallback.
const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const storeRequire = createRequire(new URL('../../../../node_modules/.pnpm/ws@8.21.0_bufferutil@4.1.0/node_modules/ws/package.json', import.meta.url));
let WebSocket;
try { WebSocket = require('ws'); } catch { WebSocket = storeRequire('ws'); }

const URL_MARKET = 'wss://bitxex.io/ws/market';
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kept = 0;
function capture(text) {
  if (!OUT || kept > 400) return;
  kept++;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, 'frames.txt'), text.slice(0, 2000) + '\n');
}

function open(opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(URL_MARKET, { perMessageDeflate: false, headers: { 'user-agent': 'Mozilla/5.0', origin: 'https://bitxex.io' }, handshakeTimeout: 40_000, ...opts });
  ws.on('upgrade', (res) => log('upgrade', { ms: Date.now() - t0, ext: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server, ray: res.headers['cf-ray'] }));
  ws.on('unexpected-response', (_req, res) => log('refused', { status: res.statusCode, ms: Date.now() - t0 }));
  ws.on('error', (e) => log('error', { msg: String(e.message), ms: Date.now() - t0 }));
  return { ws, t0 };
}

async function book() {
  const syms = ['btc_usdt', 'eth_usdt', 'fhe_usdt', 'sndk_usdt', 'pdd_usdt'];
  const { ws, t0 } = open();
  const st = {};
  for (const s of syms) st[s] = { snaps: 0, deltas: 0, gaps: 0, chained: 0, last: null, lastRaw: null, emptyDeltas: 0, bidUnordered: 0, askUnordered: 0, maxGapMs: 0, lastAt: null, firstSnapMs: null, firstDeltaMs: null, snapLevels: null, snapOrder: null, deltaKeys: null, unsafeU: 0 };
  const other = {};
  let subAt = 0;
  ws.on('open', () => {
    log('open', { ms: Date.now() - t0 });
    subAt = Date.now();
    const params = syms.flatMap((s) => [`depth@${s},50`, `depth_update@${s},100ms`]).concat(['mark_price@btc_usdt', 'index_price@btc_usdt', 'funding_rate@btc_usdt', 'agg_ticker@btc_usdt']);
    ws.send(JSON.stringify({ method: 'SUBSCRIBE', params, id: 'sub1' }));
    ws.send('ping');
    log('sent', { params: params.length });
  });
  ws.on('message', (buf, isBinary) => {
    const now = Date.now();
    const text = buf.toString();
    capture(`${now} ${isBinary ? 'BIN' : 'TXT'} ${text}`);
    if (text === 'pong') { other.pong = (other.pong || 0) + 1; return; }
    let m; try { m = JSON.parse(text); } catch { other.nonjson = (other.nonjson || 0) + 1; return; }
    if (m.id || m.code !== undefined && !m.topic) { log('reply', { m, ms: now - subAt }); return; }
    const topic = m.topic;
    const d = m.data || {};
    const s = d.s;
    if ((topic === 'depth' || topic === 'depth_update') && st[s]) {
      const x = st[s];
      if (x.lastAt) x.maxGapMs = Math.max(x.maxGapMs, now - x.lastAt);
      x.lastAt = now;
      const rawU = /"u":(\d+)/.exec(text)?.[1];
      if (rawU && !Number.isSafeInteger(Number(rawU))) x.unsafeU++;
      if (topic === 'depth') {
        x.snaps++;
        if (x.firstSnapMs === null) { x.firstSnapMs = now - subAt; x.snapLevels = [d.b?.length, d.a?.length]; x.snapOrder = [(d.b || []).every((l, i) => i === 0 || +l[0] < +d.b[i - 1][0]), (d.a || []).every((l, i) => i === 0 || +l[0] > +d.a[i - 1][0])]; x.snapKeys = Object.keys(d); }
      } else {
        x.deltas++;
        if (x.firstDeltaMs === null) { x.firstDeltaMs = now - subAt; x.deltaKeys = Object.keys(d); }
        const rawFu = /"fu":(\d+)/.exec(text)?.[1];
        if (x.lastRaw !== null && rawFu) { if (BigInt(rawFu) === BigInt(x.lastRaw) + 1n) x.chained++; else x.gaps++; }
        if (rawU) x.lastRaw = rawU;
        if (!(d.b?.length) && !(d.a?.length)) x.emptyDeltas++;
        if (d.b?.length > 1 && !d.b.every((l, i) => i === 0 || +l[0] < +d.b[i - 1][0])) x.bidUnordered++;
        if (d.a?.length > 1 && !d.a.every((l, i) => i === 0 || +l[0] > +d.a[i - 1][0])) x.askUnordered++;
      }
      return;
    }
    other[topic || 'unknown'] = (other[topic || 'unknown'] || 0) + 1;
    if (!other['first_' + topic]) { other['first_' + topic] = text.slice(0, 400); }
  });
  ws.on('close', (code, reason) => log('close', { code, reason: reason.toString(), ms: Date.now() - t0 }));
  await sleep(45_000);
  if (ws.readyState === 1) ws.send('ping');
  await sleep(20_000);
  for (const [s, x] of Object.entries(st)) { delete x.lastAt; delete x.last; delete x.lastRaw; log('stream', { s, ...x }); }
  log('other', other);
  ws.terminate();
}

// The web client's own protocol: {"req": "sub_symbol", "symbol": s} per symbol, plus sub_tickers and sub_mark_prices for all symbols.
async function web() {
  const { ws, t0 } = open();
  const seen = {};
  const seq = {};
  let subAt = 0;
  ws.on('open', () => {
    subAt = Date.now();
    log('open', { ms: subAt - t0 });
    ws.send(JSON.stringify({ req: 'sub_symbol', symbol: process.argv[3] || 'btc_usdt' }));
    ws.send(JSON.stringify({ req: 'sub_mark_prices' }));
    ws.send(JSON.stringify({ req: 'sub_tickers' }));
  });
  ws.on('message', (buf, isBinary) => {
    const now = Date.now();
    let text = buf.toString();
    let codec = 'text';
    if (isBinary) {
      for (const [name, fn] of [['zlib', inflateSync], ['raw', inflateRawSync], ['gzip', gunzipSync]]) {
        try { text = fn(buf).toString(); codec = name; break; } catch {}
      }
    }
    if (text === 'ping') { seen.serverPing = (seen.serverPing || 0) + 1; ws.send('pong'); return; }
    let m; try { m = JSON.parse(text); } catch { seen.nonjson = (seen.nonjson || 0) + 1; capture(`${now} ${codec} ${text.slice(0, 300)}`); return; }
    const key = `${codec}:${m.channel || m.type || m.topic || m.event || m.req || Object.keys(m).join(',')}`;
    const x = (seen[key] ||= { n: 0, first: now - subAt, bytes: 0, maxGapMs: 0, last: now });
    x.maxGapMs = Math.max(x.maxGapMs, now - x.last); x.last = now;
    x.n++; x.bytes += text.length;
    if (x.n <= 3) capture(`${now} ${codec} ${buf.length}B ${text.slice(0, 1500)}`);
  });
  ws.on('close', (code) => log('close', { code, at: Date.now() - t0 }));
  const pinger = setInterval(() => ws.readyState === 1 && ws.send('ping'), 20_000);
  ws.on('ping', () => { seen.protocolPing = (seen.protocolPing || 0) + 1; });
  await sleep(Number(process.env.WEB_MS || 40_000));
  clearInterval(pinger);
  log('summary', { seenKeys: Object.keys(seen).length });
  for (const [k, v] of Object.entries(seen)) { if (v && typeof v === 'object') delete v.last; log('channel', { key: k, ...(typeof v === 'object' ? v : { n: v }) }); }
  ws.terminate();
}

async function errors() {
  const frames = [
    ['unknown', JSON.stringify({ method: 'SUBSCRIBE', params: ['depth_update@nope_usdt,100ms'], id: 'e1' })],
    ['badLevel', JSON.stringify({ method: 'SUBSCRIBE', params: ['depth@btc_usdt,30'], id: 'e2' })],
    ['notJson', 'not json'],
  ];
  for (const [name, f] of frames) {
    const { ws, t0 } = open();
    ws.on('open', () => ws.send(f));
    ws.on('message', (buf) => log('msg', { name, at: Date.now() - t0, text: buf.toString().slice(0, 300) }));
    ws.on('close', (code) => log('close', { name, code, at: Date.now() - t0 }));
    await sleep(12_000);
    ws.terminate();
  }
}

async function silence() {
  const a = open();
  const b = open();
  let bTimer;
  for (const [name, { ws, t0 }] of [['idle', a], ['pingOnly', b]]) {
    ws.on('open', () => {
      log('open', { name, ms: Date.now() - t0 });
      if (name === 'pingOnly') bTimer = setInterval(() => ws.readyState === 1 && ws.send('ping'), 20_000);
    });
    ws.on('ping', () => log('serverPing', { name, at: Date.now() - t0 }));
    ws.on('message', (buf) => log('msg', { name, at: Date.now() - t0, text: buf.toString().slice(0, 80) }));
    ws.on('close', (code) => log('close', { name, code, at: Date.now() - t0 }));
  }
  await sleep(70_000);
  clearInterval(bTimer);
  for (const { ws } of [a, b]) ws.terminate();
}

async function deflate() {
  const { ws } = open({ perMessageDeflate: true });
  await new Promise((r) => { ws.on('open', r); ws.on('error', r); setTimeout(r, 40_000); });
  ws.terminate();
}

const mode = process.argv[2] || 'book';
if (mode === 'book') await book();
else if (mode === 'silence') await silence();
else if (mode === 'deflate') await deflate();
else if (mode === 'errors') await errors();
else if (mode === 'web') await web();
else console.log('modes: book | errors | silence | deflate');
process.exit(0);
