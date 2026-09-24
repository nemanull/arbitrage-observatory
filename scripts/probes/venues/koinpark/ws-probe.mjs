// Koinpark WebSocket probe: the undocumented MQTT over WebSocket feed the koinpark.com trade page uses, its book topics, their shape, level order, idle repeats, keepalive and silence.
// Public, unauthenticated, read-only. It subscribes only to public market topics, never to a user topic and never to a wildcard.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/koinpark/ws-probe.mjs [book|batch|silence|deflate|engineway]
//   book     book, trade and ticker topics of two delta pairs and four whole-book pairs plus one unknown pair for 90 s, REST books before and after, Binance depth beside each whole book. About 100 s.
//   batch    both book topic spellings for every pair in /publicApi/markets, plus the all-pairs ticker for each pair's liq flag, on one socket for 45 s.
//   silence  three sockets that differ only in what the client sends, for up to 100 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   engineway  opens the socket the way VenueFeed does, with no subprotocol, and sends a JSON text frame on another socket. About 10 s.
// Set PROBE_OUT_DIR to keep the first frames of each topic. Recorded in docs/profiles/koinpark/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://konprklvewebsktwss.koinpark.com';
const API = 'https://api.koinpark.com/publicApi';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// Minimal MQTT 3.1.1 codec, enough for CONNECT, SUBSCRIBE, PINGREQ and the packets that answer them.
function varint(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}
const str = (s) => {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
};
const packet = (type, body) => Buffer.concat([Buffer.from([type]), varint(body.length), body]);
function connectPacket(clientId, keepaliveS) {
  const ka = Buffer.alloc(2);
  ka.writeUInt16BE(keepaliveS);
  return packet(0x10, Buffer.concat([str('MQTT'), Buffer.from([4, 0x02]), ka, str(clientId)]));
}
function subscribePacket(id, topics) {
  const pid = Buffer.alloc(2);
  pid.writeUInt16BE(id);
  return packet(0x82, Buffer.concat([pid, ...topics.map((t) => Buffer.concat([str(t), Buffer.from([0])]))]));
}
const PINGREQ = Buffer.from([0xc0, 0]);

// Splits a byte stream into MQTT packets, since one WebSocket frame may carry several or part of one.
function makeParser(onPacket) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      let len = 0;
      let mul = 1;
      let i = 1;
      for (;;) {
        if (i >= buf.length) return;
        const b = buf[i++];
        len += (b & 0x7f) * mul;
        mul *= 128;
        if ((b & 0x80) === 0) break;
      }
      if (buf.length < i + len) return;
      const type = buf[0];
      const body = buf.subarray(i, i + len);
      buf = buf.subarray(i + len);
      onPacket(type, body);
    }
  };
}
function decode(type, body) {
  const kind = type >> 4;
  if (kind === 2) return { kind: 'CONNACK', session: body[0], code: body[1] };
  if (kind === 9) return { kind: 'SUBACK', id: body.readUInt16BE(0), codes: [...body.subarray(2)] };
  if (kind === 13) return { kind: 'PINGRESP' };
  if (kind === 3) {
    const qos = (type >> 1) & 3;
    const tlen = body.readUInt16BE(0);
    const topic = body.subarray(2, 2 + tlen).toString('utf8');
    const payload = body.subarray(2 + tlen + (qos > 0 ? 2 : 0));
    return { kind: 'PUBLISH', topic, qos, retain: type & 1, payload };
  }
  return { kind: `type${kind}` };
}

function openMqtt({ keepaliveS = 30, deflate = false, sendConnect = true } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, 'mqtt', { perMessageDeflate: deflate, handshakeTimeout: 10_000 });
  const handlers = [];
  const state = { t0, openMs: null, connack: null, closed: null, ws, frames: 0, bytes: 0, packets: 0 };
  ws.on('open', () => {
    state.openMs = Date.now() - t0;
    if (sendConnect) ws.send(connectPacket(`probe_${randomBytes(4).toString('hex')}`, keepaliveS));
  });
  const parse = makeParser((type, body) => {
    const p = decode(type, body);
    p.at = Date.now();
    state.packets++;
    if (p.kind === 'CONNACK') state.connack = { code: p.code, ms: p.at - t0 };
    for (const h of handlers) h(p);
  });
  ws.on('message', (data, isBinary) => {
    state.frames++;
    state.bytes += data.length;
    if (!isBinary) capture('text-frames.txt', data.toString());
    parse(data);
  });
  ws.on('close', (code, reason) => {
    state.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 };
  });
  ws.on('error', (e) => {
    state.error = e.message;
  });
  ws.on('upgrade', (res) => {
    state.headers = { protocol: res.headers['sec-websocket-protocol'], extensions: res.headers['sec-websocket-extensions'] ?? null, ray: res.headers['cf-ray'] };
  });
  return { state, on: (h) => handlers.push(h), send: (b) => ws.readyState === ws.OPEN && ws.send(b) };
}
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(20);
  }
  return false;
}

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const shape = (v, depth = 0) => {
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `len ${v.length}`] : [];
  if (v && typeof v === 'object' && depth < 3) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  return typeof v;
};
const lvl = (x) => (Array.isArray(x) ? [Number(x[0]), Number(x[1])] : [Number(x.price), Number(x.amount)]);

// Two kinds of pair, told apart by the topic that delivers: `orderBookMatch_` carries deltas of Koinpark's own book, `orderbook_` carries a whole 20 level book.
const DELTA_PAIRS = ['BTC_USDT', 'ETH_USDT'];
const WHOLE_PAIRS = ['ETH_BTC', 'ZEC_USDT', 'FET_USDT', 'XRP_BTC'];
const BINANCE = { ETH_BTC: 'ETHBTC', ZEC_USDT: 'ZECUSDT' }; // compared level by level with Binance spot on each frame

async function restBook(pair) {
  const r = await fetch(`${API}/orderbook?market_pair=${pair}`);
  const j = await r.json();
  return { at: Date.now(), ts: j?.data?.timestamp, bids: (j?.data?.bids ?? []).map(lvl), asks: (j?.data?.asks ?? []).map(lvl), remaining: r.headers.get('ratelimit-remaining') };
}
const ordered = (bids, asks) => ({
  bidNotDesc: bids.some((x, i) => i > 0 && bids[i - 1][0] <= x[0]),
  askNotAsc: asks.some((x, i) => i > 0 && asks[i - 1][0] >= x[0]),
});
const sameLevels = (a, b, n) => a.slice(0, n).filter((x) => b.some((y) => y[0] === x[0] && y[1] === x[1])).length;

async function book() {
  const topics = [];
  for (const p of [...DELTA_PAIRS, ...WHOLE_PAIRS]) topics.push(`orderbook_${p}`, `orderBookMatch_${p}`, `tradehistory_${p}`, `single_ticker_response_${p}`);
  topics.push('orderbook_NOPE_USDT', 'orderBookMatch_NOPE_USDT', 'all_ticker_response');
  const c = openMqtt({ keepaliveS: 30 });
  const stats = new Map();
  const pings = [];
  const mirror = [];
  const local = new Map(); // delta pairs: price maps seeded from REST
  let pingSentAt = 0;
  let subSentAt = 0;
  let suback = null;
  c.on((p) => {
    if (p.kind === 'SUBACK') suback = { codes: p.codes, ms: p.at - subSentAt };
    if (p.kind === 'PINGRESP') pings.push(p.at - pingSentAt);
    if (p.kind !== 'PUBLISH') return;
    const s = stats.get(p.topic) ?? { n: 0, bytes: 0, first: null, gaps: [], last: null, retain: 0, qos: 0, shape: null, repeats: 0, prevBook: null, levels: [], disorder: 0, crossed: 0, changes: 0, deletes: 0, keys: new Set() };
    stats.set(p.topic, s);
    s.n++;
    s.bytes += p.payload.length;
    s.retain += p.retain;
    s.qos = Math.max(s.qos, p.qos);
    if (s.first === null) s.first = p.at - subSentAt;
    if (s.last !== null) s.gaps.push(p.at - s.last);
    s.last = p.at;
    const text = p.payload.toString('utf8');
    if (s.n <= 3) capture(`${p.topic}.txt`, `${p.at} ${text.slice(0, 4000)}`);
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (!s.shape) s.shape = shape(m);
    for (const k of Object.keys(m)) s.keys.add(k);
    const pair = p.topic.replace(/^(orderbook|orderBookMatch)_/, '');
    if (Array.isArray(m?.data?.bids) && Array.isArray(m?.data?.asks)) {
      const bids = m.data.bids.map(lvl);
      const asks = m.data.asks.map(lvl);
      const key = JSON.stringify([bids, asks]);
      if (key === s.prevBook) s.repeats++;
      s.prevBook = key;
      s.levels.push(`${bids.length}/${asks.length}`);
      const o = ordered(bids, asks);
      if (o.bidNotDesc || o.askNotAsc) s.disorder++;
      if (bids.length && asks.length && bids[0][0] >= asks[0][0]) s.crossed++;
      s.lastBook = { bids, asks };
      if (BINANCE[pair] && p.topic.startsWith('orderbook_')) {
        const at = p.at;
        fetch(`https://api.binance.com/api/v3/depth?symbol=${BINANCE[pair]}&limit=100`)
          .then((r) => r.json())
          .then((b) => {
            const bb = b.bids.map(lvl);
            const ba = b.asks.map(lvl);
            const priceIn = (x, side) => side.some((y) => y[0] === x[0]);
            const ratios = [...bids, ...asks].map((x) => {
              const y = [...bb, ...ba].find((z) => z[0] === x[0]);
              return y ? x[1] / y[1] : null;
            }).filter((r) => r !== null);
            mirror.push({ pair, fetchLagMs: Date.now() - at, kpTop: [bids[0]?.[0], asks[0]?.[0]], bnTop: [bb[0][0], ba[0][0]], bidPricesOnBinance: bids.filter((x) => priceIn(x, bb)).length, askPricesOnBinance: asks.filter((x) => priceIn(x, ba)).length, sizeRatioMedian: median(ratios), sizeRatioMin: ratios.length ? Math.min(...ratios) : null, sizeRatioMax: ratios.length ? Math.max(...ratios) : null });
          })
          .catch((e) => mirror.push({ pair, error: e.message }));
      }
    }
    if (Array.isArray(m?.data?.changes)) {
      s.changes += m.data.changes.length;
      const book = local.get(pair);
      for (const [side, price, amount] of m.data.changes) {
        if (Number(amount) === 0) s.deletes++;
        if (!book) continue;
        const map = side === 'sell' ? book.asks : book.bids;
        if (Number(amount) === 0) map.delete(Number(price));
        else map.set(Number(price), Number(amount));
      }
    }
  });
  await waitFor(() => c.state.connack || c.state.closed, 10_000);
  log('connect', { openMs: c.state.openMs, connack: c.state.connack, headers: c.state.headers, closed: c.state.closed, error: c.state.error });
  if (!c.state.connack) return;
  subSentAt = Date.now();
  c.send(subscribePacket(1, topics));
  for (const pair of DELTA_PAIRS) {
    const b = await restBook(pair);
    local.set(pair, { bids: new Map(b.bids), asks: new Map(b.asks), seed: b });
    log('rest_seed', { pair, afterSubscribeMs: b.at - subSentAt, bidLevels: b.bids.length, askLevels: b.asks.length, tsAgeMs: b.at - b.ts, ...ordered(b.bids, b.asks), remaining: b.remaining });
  }
  const ping = setInterval(() => {
    pingSentAt = Date.now();
    c.send(PINGREQ);
  }, 15_000);
  await sleep(90_000);
  clearInterval(ping);
  log('suback', { ms: suback?.ms, codes: suback && [...new Set(suback.codes)] });
  log('pings', { rttMs: pings });
  for (const t of topics) {
    const s = stats.get(t);
    if (!s) continue;
    log('topic', { t, n: s.n, bytesPerMsg: Math.round(s.bytes / s.n), retain: s.retain, qos: s.qos, firstMs: s.first, gapMedMs: median(s.gaps), gapMinMs: s.gaps.length ? Math.min(...s.gaps) : null, gapMaxMs: s.gaps.length ? Math.max(...s.gaps) : null, keys: [...s.keys], levels: s.levels.length ? [...new Set(s.levels)] : undefined, identicalBooks: s.levels.length ? s.repeats : undefined, disorder: s.levels.length ? s.disorder : undefined, crossed: s.levels.length ? s.crossed : undefined, changes: s.changes || undefined, deletes: s.deletes || undefined, top: s.lastBook ? [s.lastBook.bids[0], s.lastBook.asks[0]] : undefined });
  }
  log('silent_topics', { topics: topics.filter((t) => !stats.has(t)) });
  for (const m of mirror) log('mirror', m);
  for (const pair of DELTA_PAIRS) {
    const b = await restBook(pair);
    const l = local.get(pair);
    const lb = [...l.bids].sort((x, y) => y[0] - x[0]);
    const la = [...l.asks].sort((x, y) => x[0] - y[0]);
    const seedSame = sameLevels(l.seed.bids, b.bids, 20) + sameLevels(l.seed.asks, b.asks, 20);
    log('rest_vs_local', { pair, deltas: stats.get(`orderBookMatch_${pair}`)?.changes ?? 0, bidsEqualTop20: sameLevels(lb, b.bids, 20), asksEqualTop20: sameLevels(la, b.asks, 20), levelsLocal: `${lb.length}/${la.length}`, levelsRest: `${b.bids.length}/${b.asks.length}`, seedEqualsEndTop40: seedSame, restTop: [b.bids[0], b.asks[0]], localTop: [lb[0], la[0]], remaining: b.remaining });
  }
  c.state.ws.close();
  await sleep(300);
  log('socket', { wsFrames: c.state.frames, mqttPackets: c.state.packets, bytes: c.state.bytes, closed: c.state.closed });
}

async function batch() {
  const r = await fetch(`${API}/markets`);
  const pairs = (await r.json()).data.map((m) => m.trading_pairs);
  const topics = [...pairs.flatMap((p) => [`orderbook_${p}`, `orderBookMatch_${p}`]), 'all_ticker_response'];
  const c = openMqtt({ keepaliveS: 30 });
  const per = new Map();
  const liq = new Map(); // pair to the `liq` flag its ticker carries
  let suback = null;
  let subSentAt = 0;
  let msgs = 0;
  let bytes = 0;
  const perSecond = new Map();
  c.on((p) => {
    if (p.kind === 'SUBACK') suback = { n: p.codes.length, failed: p.codes.filter((x) => x === 0x80).length, ms: p.at - subSentAt };
    if (p.kind !== 'PUBLISH') return;
    if (p.topic === 'all_ticker_response') {
      try {
        const t = JSON.parse(p.payload.toString('utf8'));
        liq.set(t.pair_name, t.liq);
      } catch {}
      return;
    }
    msgs++;
    bytes += p.payload.length;
    const sec = Math.floor((p.at - subSentAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const s = per.get(p.topic) ?? { n: 0, first: p.at - subSentAt, bids: 0, asks: 0, last: null, gaps: [] };
    s.n++;
    if (s.last !== null) s.gaps.push(p.at - s.last);
    s.last = p.at;
    if (s.n === 1) capture('batch-first-frames.txt', `${p.at} ${p.topic} ${p.payload.toString('utf8').slice(0, 3000)}`);
    try {
      const d = JSON.parse(p.payload.toString('utf8')).data;
      s.bids = d?.bids?.length ?? s.bids;
      s.asks = d?.asks?.length ?? s.asks;
    } catch {}
    per.set(p.topic, s);
  });
  await waitFor(() => c.state.connack || c.state.closed, 10_000);
  log('connect', { openMs: c.state.openMs, connack: c.state.connack, pairs: pairs.length, topics: topics.length });
  subSentAt = Date.now();
  c.send(subscribePacket(1, topics));
  const ping = setInterval(() => c.send(PINGREQ), 15_000);
  await sleep(45_000);
  clearInterval(ping);
  const t0 = Date.now();
  const parse0 = [...per.keys()].length;
  const ob = [...per].filter(([t]) => t.startsWith('orderbook_'));
  const obm = [...per].filter(([t]) => t.startsWith('orderBookMatch_'));
  const rates = [...perSecond.values()];
  log('suback', suback);
  log('batch', {
    topicsDelivering: parse0,
    orderbookTopics: ob.length,
    orderBookMatchTopics: obm.length,
    silentPairs: pairs.filter((p) => !per.has(`orderbook_${p}`) && !per.has(`orderBookMatch_${p}`)).length,
    bothSpellings: pairs.filter((p) => per.has(`orderbook_${p}`) && per.has(`orderBookMatch_${p}`)).length,
    msgs,
    msgsPerSecMedian: median(rates),
    msgsPerSecMax: rates.length ? Math.max(...rates) : 0,
    bytesPerSec: Math.round(bytes / 45),
    bytesPerMsg: msgs ? Math.round(bytes / msgs) : 0,
    firstFrameMsMedian: median(ob.map(([, s]) => s.first)),
    msgsPerTopicMedian: median(ob.map(([, s]) => s.n)),
    msgsPerTopicMin: ob.length ? Math.min(...ob.map(([, s]) => s.n)) : null,
    bidLevelsMedian: median(ob.map(([, s]) => s.bids)),
    askLevelsMedian: median(ob.map(([, s]) => s.asks)),
    emptySide: ob.filter(([, s]) => s.bids === 0 || s.asks === 0).map(([t, s]) => `${t} ${s.bids}/${s.asks}`),
    obmTopics: obm.map(([t, s]) => `${t} ${s.n}`).slice(0, 20),
    gapMedianMs: median(ob.flatMap(([, s]) => s.gaps)),
    gapMaxMs: Math.max(0, ...ob.flatMap(([, s]) => s.gaps)),
    delivering: ob.map(([t]) => t.slice('orderbook_'.length)),
    deliveringByQuote: ob.reduce((a, [t]) => ({ ...a, [t.split('_').at(-1)]: (a[t.split('_').at(-1)] ?? 0) + 1 }), {}),
    wsFrames: c.state.frames,
    mqttPackets: c.state.packets,
    tickerPairs: liq.size,
    liqCounts: [...liq.values()].reduce((a, v) => ({ ...a, [v]: (a[v] ?? 0) + 1 }), {}),
    wholeBookTopicWithLiq0: ob.filter(([t]) => liq.get(t.slice('orderbook_'.length)) === 0).length,
    deltaTopicWithLiq1: obm.filter(([t]) => liq.get(t.slice('orderBookMatch_'.length)) === 1).length,
    liq1Silent: pairs.filter((p) => liq.get(p) === 1 && !per.has(`orderbook_${p}`)).length,
    liq0ByQuote: pairs.filter((p) => liq.get(p) === 0).reduce((a, p) => ({ ...a, [p.split('_')[1]]: (a[p.split('_')[1]] ?? 0) + 1 }), {}),
    liq1ByQuote: pairs.filter((p) => liq.get(p) === 1).reduce((a, p) => ({ ...a, [p.split('_')[1]]: (a[p.split('_')[1]] ?? 0) + 1 }), {}),
    silentSample: pairs.filter((p) => !per.has(`orderbook_${p}`) && !per.has(`orderBookMatch_${p}`)).slice(0, 30),
    summarizeMs: Date.now() - t0,
  });
  c.state.ws.close();
  await sleep(300);
}

async function silence() {
  // A: CONNECT with keepalive 10 s and nothing after it. MQTT says the broker may close after 1.5 times the keepalive.
  // B: CONNECT with keepalive 0 and a book subscription, no PINGREQ, to see whether traffic alone keeps it.
  // C: WebSocket open but no CONNECT at all.
  const a = openMqtt({ keepaliveS: 10 });
  const b = openMqtt({ keepaliveS: 0 });
  const c = openMqtt({ sendConnect: false });
  let bMsgs = 0;
  b.on((p) => p.kind === 'PUBLISH' && bMsgs++);
  await waitFor(() => b.state.connack, 10_000);
  b.send(subscribePacket(1, ['orderbook_BTC_USDT']));
  const end = Date.now() + 100_000;
  while (Date.now() < end && !(a.state.closed && b.state.closed && c.state.closed)) await sleep(250);
  log('silence', {
    A_keepalive10_noPing: { connack: a.state.connack, closed: a.state.closed },
    B_keepalive0_subscribed: { connack: b.state.connack, closed: b.state.closed, msgs: bMsgs },
    C_noConnect: { openMs: c.state.openMs, closed: c.state.closed },
  });
  for (const s of [a, b, c]) if (!s.state.closed) s.state.ws.close();
  await sleep(300);
}

// What a socket opened the engine's way gets: no subprotocol, and a JSON text frame instead of an MQTT packet.
async function engineway() {
  const results = {};
  for (const [name, protocol, first] of [
    ['noSubprotocol_mqttConnect', undefined, () => connectPacket(`probe_${randomBytes(4).toString('hex')}`, 30)],
    ['mqttSubprotocol_jsonText', 'mqtt', () => JSON.stringify({ op: 'subscribe', args: ['orderbook_ETH_BTC'] })],
  ]) {
    const t0 = Date.now();
    const ws = new WebSocket(WS_URL, protocol, { perMessageDeflate: false, handshakeTimeout: 10_000 });
    const r = { packets: [] };
    ws.on('upgrade', (res) => (r.protocol = res.headers['sec-websocket-protocol'] ?? null));
    ws.on('unexpected-response', (_req, res) => (r.refused = res.statusCode));
    ws.on('open', () => {
      r.openMs = Date.now() - t0;
      ws.send(first());
    });
    ws.on('message', makeParser((type, body) => r.packets.push(decode(type, body).kind)));
    ws.on('close', (code) => (r.closed = { code, atMs: Date.now() - t0 }));
    ws.on('error', (e) => (r.error = e.message));
    await waitFor(() => r.closed || r.error, 8_000);
    if (!r.closed) ws.close();
    results[name] = r;
  }
  log('engineway', results);
}

async function deflate() {
  const c = openMqtt({ deflate: true });
  await waitFor(() => c.state.connack || c.state.closed, 10_000);
  log('deflate', { headers: c.state.headers, connack: c.state.connack });
  c.state.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, iso: new Date().toISOString() });
await { book, batch, silence, deflate, engineway }[mode]();
log('end', { iso: new Date().toISOString() });
process.exit(0);
