// Luno market stream probe: what wss://ws.luno.com/api/1/stream/:pair does for a client that sends no API key.
// The documented protocol starts with an API key message.
// On 2026-09-22 an empty JSON object in its place was answered with the book, so the book mode measures that undocumented keyless path.
// Public, unauthenticated and read-only: no credential of any kind is sent, and the private user stream is not opened.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate case, which only offers it.
// Run from server/: node ../scripts/probes/venues/luno/ws-probe.mjs [refusal|book]
//   refusal  six sockets in parallel, each capped at 60 s: silent, empty JSON object (capped at 15 s), text that is not JSON, protocol pings only, an unknown pair, and a deflate offer. About 60 s.
//   book     four pairs that each get an empty JSON object as the first frame, held 45 s: order-level snapshot, sequence, update kinds, keepalive, throughput, update age, and the aggregated top against REST orderbook_top.
//            Also an unknown pair and the empty ETHAUD book for 5 s each. About 50 s.
// Set PROBE_OUT_DIR to keep every frame. Recorded in docs/profiles/luno/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const BASE = 'wss://ws.luno.com/api/1/stream/';
const OUT = process.env.PROBE_OUT_DIR;
const CAP_MS = 60_000;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function run({ name, pair, deflate = false, onOpen, capMs = CAP_MS, onFrame }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const since = () => Math.round(performance.now() - t0);
    const frames = [];
    const pongs = [];
    const pingsFromServer = [];
    let openedAt = null;
    const ws = new WebSocket(BASE + pair, { perMessageDeflate: deflate, handshakeTimeout: 10_000 });
    const cap = setTimeout(() => {
      log('cap_reached', { name, ms: since() });
      ws.terminate();
    }, capMs);

    ws.on('upgrade', (res) => {
      log('upgrade', {
        name,
        status: res.statusCode,
        ms: since(),
        extensions: res.headers['sec-websocket-extensions'] ?? null,
        server: res.headers.server ?? null,
        cfRay: res.headers['cf-ray'] ?? null,
      });
    });
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        log('refused_handshake', { name, status: res.statusCode, ms: since(), headers: { server: res.headers.server, 'content-type': res.headers['content-type'] }, body: body.slice(0, 300) });
        clearTimeout(cap);
        resolve();
      });
    });
    ws.on('open', () => {
      openedAt = since();
      log('open', { name, ms: openedAt });
      onOpen?.(ws, since, pongs);
    });
    ws.on('message', (data, isBinary) => {
      const text = isBinary ? `<binary ${data.length} bytes>` : data.toString('utf8');
      frames.push({ ms: since(), bytes: data.length, text: text.slice(0, 300) });
      capture(`${name}.jsonl`, JSON.stringify({ ms: since(), text }));
      onFrame?.(text, data.length, since());
    });
    ws.on('ping', () => pingsFromServer.push(since()));
    ws.on('pong', () => pongs.push(since()));
    ws.on('error', (e) => log('error', { name, ms: since(), message: e.message }));
    ws.on('close', (code, reason) => {
      clearTimeout(cap);
      log('close', {
        name,
        ms: since(),
        openForMs: openedAt === null ? null : since() - openedAt,
        code,
        reason: reason.toString('utf8'),
        frames: frames.length,
        firstFrames: onFrame ? undefined : frames.slice(0, 4),
        pingsFromServer,
        pongs,
      });
      resolve();
    });
  });
}

function bookRun(pair, restAtMs) {
  const st = { pair, snapshot: null, updates: 0, gaps: [], kinds: {}, empty: 0, emptyGapsMs: [], trades: 0, tradeSample: null, statusUpdates: [], bytes: 0, perSecond: {}, parseUs: [], unknownDelete: 0, lastSeq: null, compare: null, updateAgeMs: [] };
  const orders = new Map(); // order id to [side, price, volume]
  let lastEmpty = null;
  const agg = (side) => {
    const m = new Map();
    for (const [s, p, v] of orders.values()) if (s === side) m.set(p, (m.get(p) ?? 0) + v);
    return [...m.entries()].sort((a, b) => (side === 'BID' ? b[0] - a[0] : a[0] - b[0]));
  };
  const onFrame = (text, bytes, ms) => {
    st.bytes += bytes;
    const sec = Math.floor(ms / 1000);
    st.perSecond[sec] = (st.perSecond[sec] ?? 0) + 1;
    if (text === '' || text === '""') {
      st.empty++;
      if (lastEmpty !== null) st.emptyGapsMs.push(ms - lastEmpty);
      lastEmpty = ms;
      return;
    }
    const t0 = performance.now();
    const m = JSON.parse(text);
    st.parseUs.push((performance.now() - t0) * 1000);
    if (m.error_code) {
      st.error = m;
      return;
    }
    if (m.asks) {
      orders.clear();
      for (const l of m.bids) orders.set(l.id, ['BID', Number(l.price), Number(l.volume)]);
      for (const l of m.asks) orders.set(l.id, ['ASK', Number(l.price), Number(l.volume)]);
      const bidP = m.bids.map((l) => Number(l.price));
      const askP = m.asks.map((l) => Number(l.price));
      st.snapshot = { ms, bytes, sequence: m.sequence, bids: m.bids.length, asks: m.asks.length, uniqueBidPrices: new Set(bidP).size, uniqueAskPrices: new Set(askP).size, bidsDesc: bidP.every((p, i) => i === 0 || p <= bidP[i - 1]), asksAsc: askP.every((p, i) => i === 0 || p >= askP[i - 1]), status: m.status, tsAgeMs: Date.now() - m.timestamp };
      st.lastSeq = Number(m.sequence);
      return;
    }
    const seq = Number(m.sequence);
    if (st.lastSeq !== null && seq !== st.lastSeq + 1) st.gaps.push([st.lastSeq, seq]);
    st.lastSeq = seq;
    st.updates++;
    st.updateAgeMs.push(Date.now() - m.timestamp);
    const k = [m.create_update ? 'C' : '', m.delete_update ? 'D' : '', m.trade_updates?.length ? 'T' : '', m.status_update ? 'S' : ''].join('') || 'none';
    st.kinds[k] = (st.kinds[k] ?? 0) + 1;
    for (const t of m.trade_updates ?? []) {
      st.trades++;
      st.tradeSample ??= { frame: text.slice(0, 600) };
      const o = orders.get(t.maker_order_id);
      if (o) {
        o[2] = Math.max(0, o[2] - Number(t.base));
        if (o[2] <= 1e-12) orders.delete(t.maker_order_id);
      }
    }
    if (m.create_update) orders.set(m.create_update.order_id, [m.create_update.type, Number(m.create_update.price), Number(m.create_update.volume)]);
    if (m.delete_update) {
      if (!orders.delete(m.delete_update.order_id)) st.unknownDelete++;
    }
    if (m.status_update) st.statusUpdates.push(m.status_update);
  };
  const restTimer = setTimeout(async () => {
    const t0 = Date.now();
    const res = await fetch(`https://api.luno.com/api/1/orderbook_top?pair=${pair}`);
    const rest = await res.json();
    const bids = agg('BID').slice(0, 5);
    const asks = agg('ASK').slice(0, 5);
    const eq = (ws, r) => ws.filter((l, i) => r[i] && Number(r[i].price) === l[0] && Math.abs(Number(r[i].volume) - l[1]) < 1e-9).length;
    st.compare = { restMs: Date.now() - t0, bidsEqual: eq(bids, rest.bids), asksEqual: eq(asks, rest.asks), wsTop: [bids[0], asks[0]], restTop: [rest.bids[0], rest.asks[0]] };
  }, restAtMs);
  return run({ name: `book_${pair}`, pair, capMs: 45_000, onFrame, onOpen: (ws) => ws.send('{}') }).then(() => {
    clearTimeout(restTimer);
    const rates = Object.values(st.perSecond);
    const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
    log('book_summary', {
      ...st,
      perSecond: undefined,
      parseUs: st.parseUs.length ? { median: Math.round(q(st.parseUs, 0.5)), p90: Math.round(q(st.parseUs, 0.9)) } : null,
      gaps: st.gaps.length,
      gapSample: st.gaps.slice(0, 3),
      emptyGapsMs: st.emptyGapsMs.slice(0, 8),
      updateAgeMs: st.updateAgeMs.length ? { min: Math.min(...st.updateAgeMs), median: q(st.updateAgeMs, 0.5), p90: q(st.updateAgeMs, 0.9), max: Math.max(...st.updateAgeMs) } : null,
      framesPerSecond: rates.length ? { median: q(rates, 0.5), max: Math.max(...rates) } : null,
      bytesPerSecond: Math.round(st.bytes / 45),
    });
  });
}

const mode = process.argv[2] ?? 'refusal';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') {
  await Promise.all([
    bookRun('XBTUSDT', 30_000),
    bookRun('ETHUSDT', 30_500),
    bookRun('XBTZAR', 31_000),
    bookRun('PAXGUSDT', 31_500),
    run({ name: 'unknown_pair_empty_object', pair: 'NOPEUSDT', capMs: 15_000, onOpen: (ws) => ws.send('{}') }),
    run({ name: 'empty_book_ETHAUD', pair: 'ETHAUD', capMs: 5_000, onOpen: (ws) => ws.send('{}') }),
  ]);
} else await Promise.all([
  run({ name: 'silent', pair: 'XBTUSDT' }),
  run({ name: 'empty_object', pair: 'XBTUSDT', capMs: 15_000, onOpen: (ws) => ws.send('{}') }),
  run({ name: 'not_json', pair: 'XBTUSDT', onOpen: (ws) => ws.send('hello') }),
  run({
    name: 'protocol_ping',
    pair: 'XBTUSDT',
    onOpen: (ws) => {
      ws.ping();
      const t = setInterval(() => (ws.readyState === ws.OPEN ? ws.ping() : clearInterval(t)), 5_000);
    },
  }),
  run({ name: 'unknown_pair', pair: 'NOPEUSDT' }),
  run({ name: 'deflate_offer', pair: 'XBTUSDT', deflate: true }),
]);
log('end', { at: new Date().toISOString() });
