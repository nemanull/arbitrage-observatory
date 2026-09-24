// Bit2c WebSocket probe: Bit2c documents no WebSocket API, so this measures the ASP.NET SignalR hub the web site itself opens, as an anonymous visitor would.
// It records the negotiate reply, which hub methods the server pushes, the shape and cadence of the order book push against the REST book, keepalives, and whether the server negotiates permessage-deflate.
// Public, unauthenticated, read-only. Nothing is ever invoked on the hub. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bit2c/ws-probe.mjs [hub|deflate|bogus]
//   hub      negotiate, connect, start, then listen for 100 s, with one REST orderbook-top read every 10 s to compare against the pushed book.
//   deflate  connects once offering permessage-deflate and prints what the server negotiates, then closes.
//   bogus    connects with a hub name that does not exist and with a made up connection token, and prints what the server answers.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/bit2c/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const HOST = 'bit2c.co.il';
const CONNECTION_DATA = JSON.stringify([{ name: 'tradehub' }]);
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function qs(params) {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

async function negotiate(connectionData = CONNECTION_DATA) {
  const t0 = performance.now();
  const res = await fetch(`https://${HOST}/signalr/negotiate?${qs({ clientProtocol: '1.5', connectionData, _: Date.now() })}`);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const shown = body ? { ...body, ConnectionToken: `<${body.ConnectionToken?.length} chars>`, ConnectionId: '<trimmed>' } : text.slice(0, 200);
  log('negotiate', { status: res.status, ms, body: shown });
  return body;
}

function connectUrl(token, connectionData = CONNECTION_DATA) {
  return `wss://${HOST}/signalr/connect?${qs({ transport: 'webSockets', clientProtocol: '1.5', connectionToken: token, connectionData, tid: 3 })}`;
}

function open(url, perMessageDeflate = false) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate, headers: { Origin: `https://${HOST}` } });
    const done = (result) => resolve({ ws, ms: Math.round(performance.now() - t0), ...result });
    ws.once('upgrade', (res) => done({ extensions: res.headers['sec-websocket-extensions'] ?? null }));
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => done({ refused: { status: res.statusCode, body: body.slice(0, 200).replace(/\s+/g, ' ') } }));
    });
    ws.once('error', (e) => done({ error: String(e.message) }));
  });
}

async function start(token, connectionData = CONNECTION_DATA) {
  const res = await fetch(`https://${HOST}/signalr/start?${qs({ transport: 'webSockets', clientProtocol: '1.5', connectionToken: token, connectionData, _: Date.now() })}`);
  const text = await res.text();
  log('start', { status: res.status, body: text.slice(0, 120) });
}

async function restTop(pair) {
  const res = await fetch(`https://${HOST}/Exchanges/${pair}/orderbook-top.json`);
  return res.json();
}

// The pushed book is compared level by level against a REST read taken at about the same moment.
// Pushed levels are {Price, Amount} objects and REST levels are [price, amount] arrays.
const lv = (l) => (Array.isArray(l) ? [Number(l[0]), Number(l[1])] : [Number(l.Price), Number(l.Amount)]);
function sameLevels(a, b, n) {
  let prices = 0;
  let both = 0;
  for (let i = 0; i < n; i++) {
    if (!a[i] || !b[i]) continue;
    const [pa, sa] = lv(a[i]);
    const [pb, sb] = lv(b[i]);
    if (pa === pb) prices++;
    if (pa === pb && Math.abs(sa - sb) <= 1e-8 * Math.max(1, sa)) both++;
  }
  return { prices, both };
}

function ordered(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const [p0] = lv(levels[i - 1]);
    const [p1] = lv(levels[i]);
    if (dir === 'desc' ? !(p1 < p0) : !(p1 > p0)) return false;
  }
  return true;
}

function describeArg(arg) {
  if (Array.isArray(arg)) return { array: arg.length, first: JSON.stringify(arg[0])?.slice(0, 200) };
  if (arg && typeof arg === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(arg)) {
      out[k] = Array.isArray(v) ? `array(${v.length}) first=${JSON.stringify(v[0])?.slice(0, 80)}` : typeof v === 'object' && v !== null ? `object(${Object.keys(v).slice(0, 12).join(',')})` : JSON.stringify(v)?.slice(0, 60);
    }
    return out;
  }
  return JSON.stringify(arg)?.slice(0, 200);
}

async function hub() {
  const neg = await negotiate();
  if (!neg?.ConnectionToken) return;
  const { ws, ms, refused, error, extensions } = await open(connectUrl(neg.ConnectionToken));
  log('open', { ms, refused, error, extensions });
  if (refused || error) return;

  const t0 = Date.now();
  const methods = new Map(); // method name to { count, arrivals, sampleShown }
  let keepalives = 0;
  const keepaliveAt = [];
  let frames = 0;
  let bytes = 0;
  let lastBook = null;
  const bookTouches = [];
  const perPair = new Map(); // pair to { pushes, repeats, unordered, levels, last }
  const methodsPerFrame = new Map();
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    frames++;
    bytes += text.length;
    const at = Date.now() - t0;
    if (text === '{}') {
      keepalives++;
      keepaliveAt.push(at);
      if (keepalives === 1) capture('frames.txt', `${at} ${text}`);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      log('non_json', { at, text: text.slice(0, 200) });
      return;
    }
    if (msg.S !== undefined || !msg.M || msg.M.length === 0) {
      log('control', { at, keys: Object.keys(msg), S: msg.S, G: msg.G ? '<present>' : undefined, M: msg.M?.length, text: text.slice(0, 160) });
      capture('frames.txt', `${at} ${text}`);
      return;
    }
    methodsPerFrame.set(msg.M.length, (methodsPerFrame.get(msg.M.length) ?? 0) + 1);
    for (const m of msg.M) {
      if (m.M.startsWith('UpdateOrderBook_')) {
        const pair = m.M.slice('UpdateOrderBook_'.length);
        const p = perPair.get(pair) ?? { pushes: 0, repeats: 0, unordered: 0, levels: new Set(), last: null };
        const body = JSON.stringify(m.A[0]);
        p.pushes++;
        if (body === p.last) p.repeats++;
        p.last = body;
        const bk = m.A[0] ?? {};
        if (!ordered(bk.Bids ?? [], 'desc') || !ordered(bk.Asks ?? [], 'asc')) p.unordered++;
        p.levels.add(`${bk.Bids?.length}/${bk.Asks?.length}`);
        perPair.set(pair, p);
      }
      const name = `${m.H}.${m.M}`;
      const entry = methods.get(name) ?? { count: 0, arrivals: [], shown: false, bytes: 0 };
      entry.count++;
      entry.arrivals.push(at);
      entry.bytes += JSON.stringify(m.A).length;
      if (!entry.shown) {
        entry.shown = true;
        log('method_first', { at, name, args: m.A.length, shape: m.A.map(describeArg) });
        capture('frames.txt', `${at} ${text}`);
      }
      methods.set(name, entry);
      if (m.M === 'UpdateOrderBook_BtcNis') {
        lastBook = { at, book: m.A[0] };
        const b = m.A[0];
        const bids = b?.bids ?? b?.Bids;
        const asks = b?.asks ?? b?.Asks;
        if (Array.isArray(bids) && Array.isArray(asks)) bookTouches.push(`${lv(bids[0] ?? {})}|${lv(asks[0] ?? {})}`);
      }
    }
  });
  const closed = new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: String(reason), atMs: Date.now() - t0 })));

  await start(neg.ConnectionToken);

  const seconds = 100;
  const compares = [];
  for (let s = 10; s <= seconds; s += 10) {
    const r = await Promise.race([sleep(10_000).then(() => null), closed]);
    if (r) {
      log('closed_early', r);
      break;
    }
    if (lastBook) {
      const rest = await restTop('BtcNis');
      const b = lastBook.book;
      const bids = b?.bids ?? b?.Bids ?? [];
      const asks = b?.asks ?? b?.Asks ?? [];
      const bq = sameLevels(bids, rest.bids, 10);
      const aq = sameLevels(asks, rest.asks, 10);
      compares.push(`age ${Date.now() - t0 - lastBook.at} ms, levels ${bids.length}/${asks.length} vs ${rest.bids.length}/${rest.asks.length}, bid price ${bq.prices} size ${bq.both}, ask price ${aq.prices} size ${aq.both}`);
    }
  }
  ws.close(1000);
  const closeInfo = await Promise.race([closed, sleep(3000).then(() => ({ code: 'timeout' }))]);

  const gaps = (a) => a.slice(1).map((x, i) => x - a[i]);
  const q = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : null);
  log('summary', { seconds, frames, bytes, keepalives, keepaliveGapMs: { min: q(gaps(keepaliveAt), 0), median: q(gaps(keepaliveAt), 0.5), max: q(gaps(keepaliveAt), 1) }, closeInfo });
  for (const [name, e] of [...methods.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const g = gaps(e.arrivals);
    log('method', { name, count: e.count, avgBytes: Math.round(e.bytes / e.count), gapMs: { min: q(g, 0), median: q(g, 0.5), max: q(g, 1) } });
  }
  for (const [pair, p] of perPair) log('pair_pushes', { pair, pushes: p.pushes, identicalToPrevious: p.repeats, unordered: p.unordered, levels: [...p.levels] });
  log('methods_per_frame', Object.fromEntries(methodsPerFrame));
  const touchChanges = bookTouches.filter((t, i) => i > 0 && t !== bookTouches[i - 1]).length;
  log('btc_book', { pushes: bookTouches.length, touchChanges, compares });
}

async function deflate() {
  const neg = await negotiate();
  if (!neg?.ConnectionToken) return;
  const { ws, ms, refused, error, extensions } = await open(connectUrl(neg.ConnectionToken), true);
  log('deflate', { ms, refused, error, offered: 'permessage-deflate', negotiated: extensions });
  if (ws.readyState === WebSocket.OPEN) ws.close(1000);
  await sleep(500);
}

async function bogus() {
  const neg = await negotiate(JSON.stringify([{ name: 'nopehub' }]));
  const fake = await open(connectUrl('not-a-real-token'));
  log('bogus_token', { ms: fake.ms, refused: fake.refused, error: fake.error });
  if (fake.ws.readyState === WebSocket.OPEN) fake.ws.close(1000);
  if (neg?.ConnectionToken) {
    const r = await open(connectUrl(neg.ConnectionToken, JSON.stringify([{ name: 'nopehub' }])));
    log('bogus_hub', { ms: r.ms, refused: r.refused, error: r.error });
    if (r.ws.readyState === WebSocket.OPEN) r.ws.close(1000);
  }
  await sleep(500);
}

const mode = process.argv[2] ?? 'hub';
if (mode === 'hub') await hub();
else if (mode === 'deflate') await deflate();
else if (mode === 'bogus') await bogus();
else console.error('unknown mode', mode);
