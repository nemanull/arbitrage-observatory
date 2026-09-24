// bitcastle WebSocket probe: the MQTT over WebSocket feed at wss://socket.bitcastle.io/mqtt, futures book cadence, shape and level order,
// the futures book set against Bybit's linear book it names as its source, mark and last price topics, error cases, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in deflate mode.
// The MQTT 3.1.1 packets (CONNECT, SUBSCRIBE, PINGREQ, DISCONNECT) are built by hand here, since server/node_modules has no MQTT client.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitcastle/ws-probe.mjs [book|batch|silence|deflate]
//   book     four futures books, the mark, last price, funding, ticker and trade topics, error topics, beside Bybit's BTCUSDT and ETHUSDT books. About 75 s.
//   batch    every futures book of the catalog on one connection for 60 s, then a 15 s wildcard subscription. About 80 s.
//   silence  four sockets that differ only in MQTT keepalive and what they send, for up to 120 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames, trimmed. Recorded in docs/profiles/bitcastle/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const MQTT_URL = 'wss://socket.bitcastle.io/mqtt';
const BYBIT_URL = 'wss://stream.bybit.com/v5/public/linear';
const API = 'https://api.bitcastle.io/futures/v1';
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stats = (arr) => ({ n: arr.length, min: q(arr, 0), med: q(arr, 0.5), p90: q(arr, 0.9), max: q(arr, 1) });

// Keeps raw frames parseable but small: ten levels per side, five rows per list.
function capture(name, recv, topic, payload) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const j = JSON.parse(payload);
  const ob = j.data?.orderbook;
  if (ob) j.data.orderbook = { bids_n: ob.bids.length, asks_n: ob.asks.length, bids: ob.bids.slice(0, 10), asks: ob.asks.slice(0, 10) };
  else if (Array.isArray(j.data)) j.data = { rows: j.data.length, first: j.data.slice(0, 5) };
  appendFileSync(join(OUT, name), JSON.stringify({ recv, topic, payload: j }) + '\n');
}

// MQTT 3.1.1 framing.
const mqttString = (s) => {
  const b = Buffer.from(s, 'utf8');
  const l = Buffer.alloc(2);
  l.writeUInt16BE(b.length);
  return Buffer.concat([l, b]);
};
const remainingLength = (n) => {
  const out = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return Buffer.from(out);
};
const packet = (header, body) => Buffer.concat([Buffer.from([header]), remainingLength(body.length), body]);
const connectPacket = (clientId, keepaliveS) =>
  packet(0x10, Buffer.concat([mqttString('MQTT'), Buffer.from([4, 0x02, keepaliveS >> 8, keepaliveS & 255]), mqttString(clientId)]));
const subscribePacket = (id, topics) => {
  const pid = Buffer.alloc(2);
  pid.writeUInt16BE(id);
  return packet(0x82, Buffer.concat([pid, ...topics.map((t) => Buffer.concat([mqttString(t), Buffer.from([0])]))]));
};
const PINGREQ = Buffer.from([0xc0, 0]);
const DISCONNECT = Buffer.from([0xe0, 0]);

// Splits one WebSocket message into MQTT packets. The broker sent exactly one packet per message in every run, which this also counts.
function parsePackets(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const type = buf[i] >> 4;
    let j = i + 1;
    let mul = 1;
    let len = 0;
    let c;
    do {
      c = buf[j++];
      len += (c & 127) * mul;
      mul *= 128;
    } while (c & 128);
    const body = buf.subarray(j, j + len);
    if (type === 3) {
      const tl = body.readUInt16BE(0);
      out.push({ type, topic: body.subarray(2, 2 + tl).toString('utf8'), payload: body.subarray(2 + tl).toString('utf8') });
    } else {
      out.push({ type, body });
    }
    i = j + len;
  }
  return out;
}

const clientId = () => 'probe-' + Math.random().toString(36).slice(2, 10);

// Opens one MQTT session and resolves once CONNACK arrives.
function openMqtt(label, { keepalive = 0, deflate = false, onPublish, onOther } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(MQTT_URL, 'mqtt', { perMessageDeflate: deflate });
    const s = { ws, label, t0, openMs: null, connackMs: null, packetsPerMessage: new Map(), nextId: 1, closed: null };
    ws.on('open', () => {
      s.openMs = Date.now() - t0;
      ws.send(connectPacket(clientId(), keepalive));
    });
    ws.on('message', (data) => {
      const now = Date.now();
      const pkts = parsePackets(Buffer.from(data));
      s.packetsPerMessage.set(pkts.length, (s.packetsPerMessage.get(pkts.length) || 0) + 1);
      for (const p of pkts) {
        if (p.type === 2) {
          s.connackMs = now - t0;
          s.connack = p.body.toString('hex');
          resolve(s);
        } else if (p.type === 3) {
          onPublish?.(p.topic, p.payload, now, data.length);
        } else {
          onOther?.(p, now);
        }
      }
    });
    ws.on('close', (code, reason) => {
      s.closed = { code, reason: reason.toString(), afterMs: Date.now() - t0 };
      resolve(s);
    });
    ws.on('error', (e) => {
      s.error = e.message;
      resolve(s);
    });
  });
}

function subscribe(s, topics) {
  const id = s.nextId++;
  s.ws.send(subscribePacket(id, topics));
  return id;
}

async function catalog() {
  const r = await fetch(`${API}/settings/pair`);
  const j = await r.json();
  return j.data.filter((p) => p.currency === 'usdt');
}

const precisionOf = (scale) => (scale === 0 ? '1' : (1 / 10 ** scale).toFixed(scale));

// Bybit side: a local book per symbol from orderbook.200 and a best bid and ask history from orderbook.1, both stamped on arrival.
function openBybit(symbols) {
  const ws = new WebSocket(BYBIT_URL, { perMessageDeflate: false });
  const state = { books: new Map(), bbo: new Map(), deepHist: new Map(), marks: new Map(), frames: 0 };
  for (const s of symbols) {
    state.books.set(s, { bids: new Map(), asks: new Map() });
    state.bbo.set(s, []);
    state.deepHist.set(s, []);
    state.marks.set(s, []);
  }
  const l1 = new Map(symbols.map((s) => [s, { bids: new Map(), asks: new Map() }]));
  const apply = (book, d, snapshot) => {
    if (snapshot) {
      book.bids.clear();
      book.asks.clear();
    }
    for (const [p, v] of d.b || []) (Number(v) === 0 ? book.bids.delete(p) : book.bids.set(p, v));
    for (const [p, v] of d.a || []) (Number(v) === 0 ? book.asks.delete(p) : book.asks.set(p, v));
  };
  const best = (m, side) => {
    let bp = null;
    for (const p of m.keys()) if (bp === null || (side === 'bid' ? Number(p) > Number(bp) : Number(p) < Number(bp))) bp = p;
    return bp === null ? null : [bp, m.get(bp)];
  };
  ws.on('open', () => {
    const args = symbols.flatMap((s) => [`orderbook.1.${s}`, `orderbook.200.${s}`, `tickers.${s}`]);
    ws.send(JSON.stringify({ op: 'subscribe', args }));
  });
  const ping = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ op: 'ping' })), 20_000);
  ws.on('message', (raw) => {
    const now = Date.now();
    const m = JSON.parse(raw.toString());
    if (!m.topic) return;
    state.frames++;
    const [kind, a, b] = m.topic.split('.');
    if (kind === 'orderbook') {
      const sym = b;
      if (a === '1') {
        const bk = l1.get(sym);
        apply(bk, m.data, m.type === 'snapshot');
        const bb = best(bk.bids, 'bid');
        const ba = best(bk.asks, 'ask');
        const h = state.bbo.get(sym);
        const last = h[h.length - 1];
        const cur = { t: now, bid: bb?.[0], bidSz: bb?.[1], ask: ba?.[0], askSz: ba?.[1] };
        if (!last || last.bid !== cur.bid || last.bidSz !== cur.bidSz || last.ask !== cur.ask || last.askSz !== cur.askSz) h.push(cur);
      } else {
        const bk = state.books.get(sym);
        apply(bk, m.data, m.type === 'snapshot');
        const h = state.deepHist.get(sym);
        h.push({ t: now, bids: new Map(bk.bids), asks: new Map(bk.asks) });
        while (h.length > 0 && now - h[0].t > 4000) h.shift();
      }
    } else if (kind === 'tickers' && m.data.markPrice) {
      state.marks.get(a).push({ t: now, mark: m.data.markPrice });
    }
  });
  return { ws, state, close: () => (clearInterval(ping), ws.close()) };
}

// Finds the last Bybit best bid and ask state equal to what the bitcastle frame shows, and the time that state began.
function matchBbo(hist, frame, recv, withSizes) {
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h.t > recv) continue;
    if (Number(h.ask) !== Number(frame.ask) || Number(h.bid) !== Number(frame.bid)) continue;
    if (withSizes && (Number(h.askSz) !== Number(frame.askSz) || Number(h.bidSz) !== Number(frame.bidSz))) continue;
    return recv - h.t;
  }
  return null;
}

// Classifies one side's wire order: best first, worst first, or neither.
function orderOf(levels, bestHigh) {
  const p = levels.map((l) => Number(l.price));
  let desc = true;
  let asc = true;
  for (let i = 1; i < p.length; i++) {
    if (p[i] >= p[i - 1]) desc = false;
    if (p[i] <= p[i - 1]) asc = false;
  }
  if (p.length < 2) return 'short';
  if (bestHigh) return desc ? 'best_first' : asc ? 'worst_first' : 'unsorted';
  return asc ? 'best_first' : desc ? 'worst_first' : 'unsorted';
}

const bestOf = (ob) => {
  let bid = null;
  let ask = null;
  for (const l of ob.bids) if (!bid || Number(l.price) > Number(bid.price)) bid = l;
  for (const l of ob.asks) if (!ask || Number(l.price) < Number(ask.price)) ask = l;
  return { bid: bid?.price, bidSz: bid?.amount, ask: ask?.price, askSz: ask?.amount };
};

// Compares one bitcastle frame with Bybit at arrival: the best bid and ask match, then the top 20 levels by price against the Bybit book at the matched instant.
function compareToBybit(bybit, sym, ob, now) {
  const hist = bybit.state.bbo.get(sym);
  const fr = bestOf(ob);
  const lagExact = matchBbo(hist, fr, now, true);
  const lagPrice = matchBbo(hist, fr, now, false);
  const cur = hist[hist.length - 1];
  const at = now - (lagExact ?? lagPrice ?? 0);
  const dh = bybit.state.deepHist.get(sym);
  let snap = null;
  for (let i = dh.length - 1; i >= 0; i--) if (dh[i].t <= at) { snap = dh[i]; break; }
  const res = { lagExact, lagPrice, crossed: fr.bid && fr.ask && Number(fr.bid) >= Number(fr.ask), spreadVsBybitNow: cur ? { castBid: fr.bid, castAsk: fr.ask, bybitBid: cur.bid, bybitAsk: cur.ask } : null };
  // Spreads in ppm of the mid, and how far each bitcastle touch sits behind Bybit's touch at arrival.
  if (cur && fr.bid && fr.ask) {
    const cb = Number(fr.bid);
    const ca = Number(fr.ask);
    const bb = Number(cur.bid);
    const ba = Number(cur.ask);
    res.castSpreadPpm = Math.round(((ca - cb) / ((ca + cb) / 2)) * 1e6);
    res.bybitSpreadPpm = Math.round(((ba - bb) / ((ba + bb) / 2)) * 1e6);
    res.bidBehindPpm = Math.round(((bb - cb) / bb) * 1e6);
    res.askBehindPpm = Math.round(((ca - ba) / ba) * 1e6);
  }
  if (!snap) return res;
  const top = (levels, bestHigh) => [...levels].sort((a, b) => (bestHigh ? b.price - a.price : a.price - b.price)).slice(0, 20);
  let present = 0;
  let eq = 0;
  let total = 0;
  for (const [side, levels] of [['bids', top(ob.bids, true)], ['asks', top(ob.asks, false)]]) {
    const m = new Map([...snap[side].entries()].map(([k, v]) => [Number(k), Number(v)]));
    for (const l of levels) {
      total++;
      if (m.has(Number(l.price))) {
        present++;
        if (m.get(Number(l.price)) === Number(l.amount)) eq++;
      }
    }
  }
  const byTop = [...snap.bids.keys()].map(Number).sort((a, b) => b - a).slice(0, 20);
  const castPrices = new Set(ob.bids.map((l) => Number(l.price)));
  res.present = total ? present / total : null;
  res.sizeEq = total ? eq / total : null;
  res.bybitTop20BidsKept = byTop.filter((p) => castPrices.has(p)).length / Math.max(1, byTop.length);
  // How deep the bitcastle bids reach inside Bybit's book: the rank in Bybit's bid ladder of bitcastle's 20th best bid.
  const castTop = top(ob.bids, true);
  const last = castTop[castTop.length - 1];
  res.bybitRankOfCast20thBid = last ? [...snap.bids.keys()].map(Number).filter((p) => p >= Number(last.price)).length : null;
  return res;
}

async function book() {
  const pairs = await catalog();
  const want = ['btc', 'eth', 'pi', 'layer'];
  const picks = want.map((c) => pairs.find((p) => p.coin === c)).filter(Boolean);
  const topicOf = (p) => `public/futures/orderbook/${p.coin}/usdt/${precisionOf(p.ob_default_price_scale)}`;
  log('picks', { picks: picks.map((p) => ({ pair: p.pair_name, target: p.target, scale: p.ob_default_price_scale, topic: topicOf(p) })) });
  const bybit = openBybit(['BTCUSDT', 'ETHUSDT']);
  await sleep(3000);
  const bySym = new Map([[topicOf(picks[0]), 'BTCUSDT'], [topicOf(picks[1]), 'ETHUSDT']]);
  const cmp = new Map([...bySym.keys()].map((t) => [t, []]));
  const topics = new Map();
  const frames = [];
  const s = await openMqtt('book', {
    onPublish: (topic, payload, now, bytes) => {
      topics.set(topic, (topics.get(topic) || 0) + 1);
      capture('book-frames.jsonl', now, topic, payload);
      frames.push({ topic, payload, now, bytes });
      if (bySym.has(topic)) cmp.get(topic).push(compareToBybit(bybit, bySym.get(topic), JSON.parse(payload).data.orderbook, now));
    },
    onOther: (p) => log('packet', { type: p.type, hex: p.body.toString('hex').slice(0, 60) }),
  });
  log('session', { open_ms: s.openMs, connack_ms: s.connackMs, connack: s.connack, subprotocol: s.ws.protocol, extensions: s.ws.extensions || '' });
  const bookTopics = picks.map(topicOf);
  const other = [
    'public/futures/markprice_update',
    'public/futures/lastprice_update',
    'public/futures/funding_rate',
    'public/futures/ticker_24h',
    'public/futures/market_trade/btc/usdt',
    'public/setting/update_futures_pair_category',
  ];
  const errors = ['public/futures/orderbook/nope/usdt/0.1', 'public/futures/orderbook/btc/usdt/1', 'public/futures/orderbook/btc/usdt/0.01'];
  const subAt = Date.now();
  subscribe(s, [...bookTopics, ...other]);
  subscribe(s, errors);
  await sleep(70_000);
  s.ws.send(DISCONNECT);
  bybit.close();
  await sleep(500);
  log('packets_per_ws_message', Object.fromEntries(s.packetsPerMessage));
  log('topic_counts', Object.fromEntries(topics));
  for (const t of errors) log('error_topic', { topic: t, frames: topics.get(t) || 0 });

  for (const [i, t] of bookTopics.entries()) {
    const fs = frames.filter((f) => f.topic === t);
    const gaps = [];
    const ages = [];
    const nb = [];
    const na = [];
    const order = {};
    let firstMs = null;
    const fields = new Set();
    let identical = 0;
    let oneSided = 0;
    let crossed = 0;
    let dupPrices = 0;
    let prev = null;
    for (const f of fs) {
      const j = JSON.parse(f.payload);
      Object.keys(j).forEach((k) => fields.add(k));
      Object.keys(j.data || {}).forEach((k) => fields.add('data.' + k));
      const ob = j.data.orderbook;
      if (firstMs === null) firstMs = f.now - subAt;
      nb.push(ob.bids.length);
      na.push(ob.asks.length);
      const k = `bids_${orderOf(ob.bids, true)}/asks_${orderOf(ob.asks, false)}`;
      order[k] = (order[k] || 0) + 1;
      if (ob.bids.length === 0 || ob.asks.length === 0) oneSided++;
      const b = bestOf(ob);
      if (b.bid && b.ask && Number(b.bid) >= Number(b.ask)) crossed++;
      const bp = ob.bids.map((l) => l.price);
      const ap = ob.asks.map((l) => l.price);
      if (new Set(bp).size < bp.length || new Set(ap).size < ap.length) dupPrices++;
      ages.push(f.now - Number(j.last_update));
      if (prev) gaps.push(f.now - prev.now);
      if (prev && JSON.stringify(ob) === JSON.stringify(JSON.parse(prev.payload).data.orderbook)) identical++;
      prev = f;
    }
    log('book_topic', {
      pair: picks[i].pair_name, target: picks[i].target, frames: fs.length, first_frame_after_sub_ms: firstMs,
      interval_ms: stats(gaps), bids: stats(nb), asks: stats(na), wire_order: order, one_sided_frames: oneSided, crossed_frames: crossed,
      frames_with_duplicate_prices: dupPrices, identical_to_previous: identical, server_age_ms: stats(ages), bytes: stats(fs.map((f) => f.bytes)), fields: [...fields],
    });
  }

  for (const [t, sym] of bySym) {
    const rs = cmp.get(t);
    const num = (k) => rs.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
    log('vs_bybit', {
      topic: t, bybit: sym, frames: rs.length,
      bbo_equal_with_sizes: num('lagExact').length, lag_ms_with_sizes: stats(num('lagExact')),
      bbo_equal_prices_only: num('lagPrice').length, lag_ms_prices_only: stats(num('lagPrice')),
      top20_levels_found_in_bybit_book: stats(num('present')), top20_sizes_equal_bybit: stats(num('sizeEq')),
      bybit_top20_bids_kept: stats(num('bybitTop20BidsKept')), bybit_rank_of_cast_20th_bid: stats(num('bybitRankOfCast20thBid')),
      cast_spread_ppm: stats(num('castSpreadPpm')), bybit_spread_ppm: stats(num('bybitSpreadPpm')), bid_behind_bybit_ppm: stats(num('bidBehindPpm')), ask_behind_bybit_ppm: stats(num('askBehindPpm')),
      crossed: rs.filter((r) => r.crossed).length, sample_unmatched: rs.filter((r) => r.lagPrice === null).slice(0, 3).map((r) => r.spreadVsBybitNow),
    });
  }

  // Mark against Bybit's mark.
  const marks = frames.filter((f) => f.topic === 'public/futures/markprice_update');
  const mg = [];
  for (let i = 1; i < marks.length; i++) mg.push(marks[i].now - marks[i - 1].now);
  const mcmp = [];
  for (const f of marks) {
    const j = JSON.parse(f.payload);
    for (const [coin, sym] of [['btc', 'BTCUSDT'], ['eth', 'ETHUSDT']]) {
      const row = j.data.find((r) => r.symbol === `${coin}/usdt`);
      const bm = bybit.state.marks.get(sym);
      const last = bm.filter((m) => m.t <= f.now).pop();
      const hit = bm.filter((m) => m.t <= f.now && Number(m.mark) === Number(row?.mark_price)).pop();
      mcmp.push({ pair: `${coin}/usdt`, equal_bybit_now: Number(row?.mark_price) === Number(last?.mark), bybit_value_age_ms: hit ? f.now - hit.t : null, cast: row?.mark_price, bybit_now: last?.mark });
    }
  }
  const ageOf = mcmp.map((r) => r.bybit_value_age_ms).filter((v) => v !== null);
  log('mark_topic', { frames: marks.length, interval_ms: stats(mg), rows: marks.length ? JSON.parse(marks[0].payload).data.length : 0, bytes: stats(marks.map((f) => f.bytes)), server_age_ms: stats(marks.map((f) => f.now - Number(JSON.parse(f.payload).last_update))) });
  log('mark_vs_bybit', { comparisons: mcmp.length, equal_bybit_now: mcmp.filter((r) => r.equal_bybit_now).length, found_in_bybit_history: ageOf.length, age_of_that_bybit_value_ms: stats(ageOf), sample: mcmp.slice(0, 4) });
  const lp = frames.filter((f) => f.topic === 'public/futures/lastprice_update');
  const lg = [];
  for (let i = 1; i < lp.length; i++) lg.push(lp[i].now - lp[i - 1].now);
  log('lastprice_topic', { frames: lp.length, interval_ms: stats(lg), rows: lp.length ? JSON.parse(lp[0].payload).data.length : 0 });
  const fr = frames.filter((f) => f.topic === 'public/futures/funding_rate');
  log('funding_topic', { frames: fr.length, first: fr[0]?.payload.slice(0, 300) ?? null });
  const tk = frames.filter((f) => f.topic === 'public/futures/ticker_24h');
  log('ticker_topic', { frames: tk.length, per_second: +(tk.length / 70).toFixed(1), rows_per_frame: stats(tk.map((f) => JSON.parse(f.payload).data.length)), fields: tk.length ? Object.keys(JSON.parse(tk[0].payload).data[0]) : [] });
  const tr = frames.filter((f) => f.topic.startsWith('public/futures/market_trade'));
  const tg = [];
  for (let i = 1; i < tr.length; i++) tg.push(Number(JSON.parse(tr[i].payload).data.create_time) - Number(JSON.parse(tr[i - 1].payload).data.create_time));
  log('trade_topic', { frames: tr.length, create_time_gaps_ms: stats(tg), sizes: [...new Set(tr.map((f) => JSON.parse(f.payload).data.gross_amount))].slice(0, 8) });
  log('bybit', { frames: bybit.state.frames, btc_bbo_states: bybit.state.bbo.get('BTCUSDT').length });
}


async function batch() {
  const pairs = await catalog();
  const topics = pairs.map((p) => `public/futures/orderbook/${p.coin}/usdt/${precisionOf(p.ob_default_price_scale)}`);
  const per = new Map();
  let bytes = 0;
  let count = 0;
  const perSecond = new Map();
  let parseNs = 0n;
  const levels = [];
  let oneSided = 0;
  let empty = 0;
  const s = await openMqtt('batch', {
    onPublish: (topic, payload, now, n) => {
      count++;
      bytes += n;
      const sec = Math.floor(now / 1000);
      perSecond.set(sec, (perSecond.get(sec) || 0) + 1);
      const t0 = process.hrtime.bigint();
      const j = JSON.parse(payload);
      parseNs += process.hrtime.bigint() - t0;
      const ob = j.data?.orderbook;
      if (ob) {
        levels.push(Math.min(ob.bids.length, ob.asks.length));
        if (ob.bids.length === 0 && ob.asks.length === 0) empty++;
        else if (ob.bids.length === 0 || ob.asks.length === 0) oneSided++;
      }
      per.set(topic, (per.get(topic) || 0) + 1);
    },
  });
  log('session', { open_ms: s.openMs, connack_ms: s.connackMs, topics: topics.length });
  const subAt = Date.now();
  subscribe(s, topics);
  await sleep(60_000);
  const secs = [...perSecond.values()].slice(1, -1);
  const silent = topics.filter((t) => !per.has(t));
  log('batch', {
    seconds: 60, frames: count, frames_per_s: +(count / 60).toFixed(1), per_second: stats(secs), kb_per_s: +(bytes / 60 / 1024).toFixed(1),
    bytes_per_frame: Math.round(bytes / Math.max(1, count)), parse_us_per_frame: +(Number(parseNs) / 1000 / Math.max(1, count)).toFixed(1),
    topics_delivering: per.size, silent_topics: silent, frames_per_topic: stats([...per.values()]), min_side_levels: stats(levels), one_sided_frames: oneSided, empty_frames: empty,
  });
  s.ws.send(DISCONNECT);
  await sleep(300);

  // One wildcard filter for every futures book.
  const wper = new Map();
  let wcount = 0;
  const w = await openMqtt('wildcard', {
    onPublish: (topic) => {
      wcount++;
      wper.set(topic, (wper.get(topic) || 0) + 1);
    },
    onOther: (p) => p.type === 9 && log('wildcard_suback', { hex: p.body.toString('hex') }),
  });
  subscribe(w, ['public/futures/orderbook/#']);
  await sleep(15_000);
  w.ws.send(DISCONNECT);
  log('wildcard', { filter: 'public/futures/orderbook/#', seconds: 15, frames: wcount, topics: wper.size, sample: [...wper.keys()].slice(0, 5) });
  await sleep(300);
}

async function silence() {
  const cases = [
    { label: 'ka0_idle', keepalive: 0, sub: false, ping: 0 },
    { label: 'ka0_subscribed_mark', keepalive: 0, sub: true, ping: 0 },
    { label: 'ka30_no_ping', keepalive: 30, sub: false, ping: 0 },
    { label: 'ka30_ping_20s', keepalive: 30, sub: false, ping: 20_000 },
  ];
  const results = [];
  await Promise.all(
    cases.map(async (c) => {
      const pingSent = [];
      const rtt = [];
      let frames = 0;
      const s = await openMqtt(c.label, {
        keepalive: c.keepalive,
        onPublish: () => frames++,
        onOther: (p, now) => {
          if (p.type === 13 && pingSent.length) rtt.push(now - pingSent.shift());
        },
      });
      if (c.sub) subscribe(s, ['public/futures/markprice_update']);
      let timer = null;
      if (c.ping) timer = setInterval(() => { if (s.ws.readyState === s.ws.OPEN) { pingSent.push(Date.now()); s.ws.send(PINGREQ); } }, c.ping);
      const end = Date.now() + 120_000;
      while (Date.now() < end && !s.closed) await sleep(500);
      if (timer) clearInterval(timer);
      if (!s.closed) s.ws.send(DISCONNECT);
      results.push({ label: c.label, open_ms: s.openMs, connack: s.connack, closed: s.closed ?? 'open at 120 s', frames, pingresp_ms: rtt });
      await sleep(300);
    }),
  );
  for (const r of results) log('silence', r);
}

async function deflate() {
  const s = await openMqtt('deflate', { deflate: true });
  log('deflate', { offered: 'permessage-deflate', negotiated: s.ws.extensions || '(none)', subprotocol: s.ws.protocol, connack: s.connack });
  s.ws.send(DISCONNECT);
  await sleep(300);
  // A handshake without the mqtt subprotocol.
  await new Promise((resolve) => {
    const ws = new WebSocket(MQTT_URL, { perMessageDeflate: false });
    const t0 = Date.now();
    ws.on('open', () => {
      log('no_subprotocol', { opened: true, protocol: ws.protocol });
      ws.send(connectPacket(clientId(), 0));
    });
    ws.on('message', (d) => log('no_subprotocol_reply', { hex: Buffer.from(d).toString('hex').slice(0, 20) }));
    ws.on('unexpected-response', (req, res) => { log('no_subprotocol', { status: res.statusCode }); resolve(); });
    ws.on('close', (code) => { log('no_subprotocol_close', { code, after_ms: Date.now() - t0 }); resolve(); });
    ws.on('error', (e) => { log('no_subprotocol_error', { error: e.message }); resolve(); });
    setTimeout(() => { ws.close(); resolve(); }, 5000);
  });
  // Text that is not an MQTT packet.
  await new Promise((resolve) => {
    const ws = new WebSocket(MQTT_URL, 'mqtt', { perMessageDeflate: false });
    const t0 = Date.now();
    ws.on('open', () => ws.send('{"op":"subscribe"}'));
    ws.on('message', (d) => log('garbage_reply', { hex: Buffer.from(d).toString('hex').slice(0, 20) }));
    ws.on('close', (code, reason) => { log('garbage_close', { code, reason: reason.toString(), after_ms: Date.now() - t0 }); resolve(); });
    setTimeout(() => { ws.close(); resolve(); }, 5000);
  });
}

const mode = process.argv[2] || 'book';
const modes = { book, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
