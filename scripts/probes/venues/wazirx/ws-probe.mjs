// WazirX futures WebSocket probe: the depth stream against the REST book and Binance USD-M, partial depth forms, mark stream, errors, keepalive, silence, a batch of every contract, and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode which asks once to read the answer.
// The documented limit is 5 client messages per second per connection, so every mode sends at most one control frame per second on a socket.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/wazirx/ws-probe.mjs [book|forms|errors|silence|batch|coverage|deflate]
//   book     <symbol>@depth on BTCUSDT, ETHUSDT, BTCINR and a quiet served contract for about 72 s, beside Binance @depth, @depth@500ms and @depth@100ms, with a REST book compare. About 80 s.
//   forms    undocumented partial depth and book ticker spellings, and !markPrice@arr, for 20 s. About 25 s.
//   errors   unknown symbol, uppercase symbol, duplicate, unknown event, streams not an array, text that is not JSON. About 15 s.
//   silence  four sockets that differ only in what the client sends, subscribes or answers to server pings, for 100 s.
//   batch    <symbol>@depth for every contract on one connection for 30 s.
//   coverage every contract's depth stream in slices of 50, to see which contracts the socket serves. About 25 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/wazirx/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_F = 'wss://fstreamx.wazirx.com/stream';
const BINANCE_WS = 'wss://fstream.binance.com/stream';
const API = 'https://api.wazirx.com';
const BINANCE = 'https://fapi.binance.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const stats = (xs) => ({ n: xs.length, min: round(quantile(xs, 0)), median: round(quantile(xs, 0.5)), p90: round(quantile(xs, 0.9)), max: round(quantile(xs, 1)) });
const trim = (text, n = 600) => (text.length > n ? `${text.slice(0, n)}…` : text);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url, { deflate = false, label = 'ws' } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  ws.t0 = t0;
  ws.label = label;
  ws.on('upgrade', (res) => (ws.upgradeHeaders = res.headers));
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      ws.openMs = performance.now() - t0;
      resolve(ws);
    });
    ws.once('error', reject);
  });
}

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

function sortedDesc(levels) {
  return levels.every((x, i) => i === 0 || Number(x[0]) < Number(levels[i - 1][0]));
}
function sortedAsc(levels) {
  return levels.every((x, i) => i === 0 || Number(x[0]) > Number(levels[i - 1][0]));
}

async function book() {
  const tick = await getJson(`${API}/fapi/v1/ticker/24hr`);
  const usdt = tick.filter((t) => t.symbol.endsWith('USDT')).sort((a, b) => Number(a.volume) - Number(b.volume));
  const w = await open(URL_F, { label: 'wazirx' });

  // The socket serves only some contracts, so the quiet contract is the lowest volume USDT contract the server acknowledges.
  const candidates = usdt.slice(0, 40).map((t) => `${t.symbol.toLowerCase()}@depth`);
  const quietStream = await new Promise((resolve) => {
    const onAck = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.event === 'subscribed' && m.id === 99) {
        w.off('message', onAck);
        const served = m.data.streams ?? [];
        resolve(candidates.find((c) => served.includes(c)) ?? 'btcusdt@depth');
      }
    };
    w.on('message', onAck);
    w.send(JSON.stringify({ event: 'subscribe', streams: candidates, id: 99 }));
  });
  await sleep(1100);
  w.send(JSON.stringify({ event: 'unsubscribe', streams: candidates, id: 98 }));
  await sleep(1100);
  const streams = ['btcusdt@depth', 'ethusdt@depth', 'btcinr@depth', quietStream];
  log('book_plan', { streams, quiet_volume_rank_among_usdt: candidates.indexOf(quietStream) + 1 });

  const b = await open(BINANCE_WS, { label: 'binance' });
  log('open', { wazirx_ms: round(w.openMs), binance_ms: round(b.openMs), wazirx_extensions: w.upgradeHeaders?.['sec-websocket-extensions'] ?? null });

  const per = new Map(streams.map((s) => [s, { frames: 0, arrivals: [], lags: [], levels: [], firstLevels: null, bidsUnordered: 0, asksUnordered: 0, zeros: 0, keys: new Set(), Es: [], Ts: [], book: { b: new Map(), a: new Map() }, frames_raw: [], last: null }]));
  const binE = { 'btcusdt@depth': new Set(), 'btcusdt@depth@500ms': new Set(), 'btcusdt@depth@100ms': new Set(), 'ethusdt@depth': new Set() };
  const binT = Object.fromEntries(Object.keys(binE).map((k) => [k, new Set()]));
  const other = [];
  const sentAt = {};
  w.on('message', (raw) => {
    const at = Date.now();
    const text = raw.toString();
    const m = JSON.parse(text);
    const st = per.get(m.stream);
    if (!st) {
      other.push({ at, text: trim(text, 400) });
      capture('wazirx-book-other.jsonl', text);
      return;
    }
    const d = m.data;
    st.frames++;
    if (st.frames <= 3) capture('wazirx-book-first.jsonl', trim(text, 3000));
    st.arrivals.push(at);
    st.lags.push(at - d.E);
    for (const k of Object.keys(d)) st.keys.add(k);
    st.frames_raw.push(JSON.stringify([d.b, d.a]));
    st.Es.push(d.E);
    st.Ts.push(d.T);
    const nb = d.b?.length ?? 0, na = d.a?.length ?? 0;
    st.levels.push(nb + na);
    st.last = d;
    if (st.firstLevels === null) st.firstLevels = [nb, na, at - sentAt.depth];
    if (!sortedDesc(d.b ?? [])) st.bidsUnordered++;
    if (!sortedAsc(d.a ?? [])) st.asksUnordered++;
    for (const [p, q] of d.b ?? []) { if (Number(q) === 0) { st.zeros++; st.book.b.delete(p); } else st.book.b.set(p, q); }
    for (const [p, q] of d.a ?? []) { if (Number(q) === 0) { st.zeros++; st.book.a.delete(p); } else st.book.a.set(p, q); }
  });
  b.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.stream && binE[m.stream]) {
      binE[m.stream].add(m.data.E);
      binT[m.stream].add(m.data.T);
    }
  });
  sentAt.depth = Date.now();
  const sub = { event: 'subscribe', streams };
  w.send(JSON.stringify(sub));
  b.send(JSON.stringify({ method: 'SUBSCRIBE', params: Object.keys(binE), id: 1 }));

  // Compare the book kept from frames against the REST book twice, at 35 s and 70 s.
  const compares = [];
  for (const wait of [35000, 35000]) {
    await sleep(wait);
    for (const sym of ['BTCUSDT', 'ETHUSDT']) {
      const rest = await getJson(`${API}/fapi/v1/depth?symbol=${sym}`);
      const st = per.get(`${sym.toLowerCase()}@depth`);
      const bids = [...st.book.b.entries()].sort((x, y) => Number(y[0]) - Number(x[0]));
      const asks = [...st.book.a.entries()].sort((x, y) => Number(x[0]) - Number(y[0]));
      const eq = (ws, rs) => rs.filter((r, i) => ws[i] && ws[i][0] === r[0] && Number(ws[i][1]) === Number(r[1])).length;
      const last = st.last;
      compares.push({ sym, restE: rest.E, lastFrameE: last.E, lastFrameT: last.T, lastFrameTouch: [last.b[0], last.a[0]], restTouch: [rest.bids[0], rest.asks[0]], lastFrameBidsEqualRest: eq(last.b, rest.bids), lastFrameAsksEqualRest: eq(last.a, rest.asks), deltaBookLevels: [bids.length, asks.length], deltaBookBidsEqualRest: eq(bids, rest.bids) });
    }
  }
  w.close();
  b.close();

  for (const [s, st] of per) {
    const gaps = st.arrivals.slice(1).map((x, i) => x - st.arrivals[i]);
    const eGaps = st.Es.slice(1).map((x, i) => x - st.Es[i]);
    const isBtc = s === 'btcusdt@depth', isEth = s === 'ethusdt@depth';
    const keys = isBtc ? ['btcusdt@depth', 'btcusdt@depth@500ms', 'btcusdt@depth@100ms'] : isEth ? ['ethusdt@depth'] : [];
    const match = keys.length ? Object.fromEntries(keys.map((k) => [k, { E_in_binance_E: st.Es.filter((e) => binE[k].has(e)).length, T_in_binance_T: st.Ts.filter((t) => binT[k].has(t)).length, T_in_binance_E: st.Ts.filter((t) => binE[k].has(t)).length }])) : null;
    // Frames whose 40 levels are exactly the previous frame's, the idle repeat.
    let repeats = 0;
    for (let i = 1; i < st.frames_raw.length; i++) if (st.frames_raw[i] === st.frames_raw[i - 1]) repeats++;
    log('depth_stream', {
      stream: s, frames: st.frames, keys: [...st.keys], first_frame_levels_bids_asks_ms_after_subscribe: st.firstLevels,
      levels_per_frame: stats(st.levels), interarrival_ms: stats(gaps), E_step_ms: stats(eGaps), arrival_minus_E_ms: stats(st.lags),
      E_equals_T: st.Es.filter((e, i) => e === st.Ts[i]).length, E_non_increasing: eGaps.filter((g) => g <= 0).length,
      bid_arrays_not_desc: st.bidsUnordered, ask_arrays_not_asc: st.asksUnordered, zero_sizes: st.zeros,
      E_minus_T_ms: stats(st.Es.map((e, i) => e - st.Ts[i])), identical_consecutive_level_sets: repeats,
      delta_book_levels_at_end: [st.book.b.size, st.book.a.size], matches_binance_event: match,
    });
  }
  log('binance_event_counts', Object.fromEntries(Object.entries(binE).map(([k, v]) => [k, v.size])));
  const btcE = new Set(per.get('btcusdt@depth').Es);
  log('inr_twin', { btcinr_frames: per.get('btcinr@depth').frames, btcinr_E_equal_to_a_btcusdt_E: per.get('btcinr@depth').Es.filter((e) => btcE.has(e)).length });
  log('ws_vs_rest', { compares });
  log('other_frames', { n: other.length, first: other.slice(0, 3) });
}

async function forms() {
  const w = await open(URL_F);
  const seen = new Map();
  const replies = [];
  w.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.stream) {
      const s = seen.get(m.stream) ?? { frames: 0, first: null, lastAt: 0, gaps: [], symbols: new Set(), rows: [] };
      if (Array.isArray(m.data)) {
        for (const r of m.data) s.symbols.add(r.s);
        s.rows.push(m.data.length);
      }
      const at = Date.now();
      if (s.lastAt) s.gaps.push(at - s.lastAt);
      s.lastAt = at;
      s.frames++;
      if (!s.first) s.first = trim(text, 700);
      seen.set(m.stream, s);
      if (s.frames <= 2) capture('wazirx-forms.jsonl', trim(text, 3000));
    } else {
      replies.push(trim(text, 300));
    }
  });
  const tries = [['btcusdt@depth20@100ms', 'btcusdt@depth10@100ms', 'btcusdt@depth5@100ms'], ['btcusdt@depth20', 'btcusdt@depth@100ms', 'btcusdt@depth@500ms'], ['btcusdt@bookTicker', 'btcusdt@trades', 'btcusdt@aggTrade'], ['!markPrice@arr', 'btcusdt@markPrice', '!ticker@arr'], ['btcusdt@kline_1m']];
  for (const streams of tries) {
    w.send(JSON.stringify({ event: 'subscribe', streams }));
    await sleep(1100);
  }
  await sleep(20000);
  w.close();
  log('forms_replies', { replies });
  for (const [s, v] of seen) {
    log('form_stream', { stream: s, frames: v.frames, interarrival_ms: stats(v.gaps), distinct_symbols: v.symbols.size || null, rows_per_frame: v.rows.length ? stats(v.rows) : null, first: v.first });
  }
}

async function errors() {
  const w = await open(URL_F);
  const replies = [];
  const ethE = [];
  w.on('message', (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.stream === 'ethusdt@depth') ethE.push(m.data.E);
    replies.push({ at: Date.now(), control: m.event !== undefined, text: trim(text, 300) });
  });
  w.on('close', (code, reason) => replies.push({ control: true, text: `close ${code} ${reason.toString()}` }));
  const cases = [
    { event: 'subscribe', streams: ['nopeusdt@depth'] },
    { event: 'subscribe', streams: ['BTCUSDT@depth'] },
    { event: 'subscribe', streams: ['btcusdt@nope'] },
    { event: 'subscribe', streams: ['ethusdt@depth'] },
    { event: 'subscribe', streams: ['ethusdt@depth'] },
    { event: 'list_subscriptions' },
    { event: 'nope', streams: ['btcusdt@depth'] },
    { event: 'subscribe', streams: 'btcusdt@depth' },
    { event: 'subscribe', streams: ['btcusdt@depth'], id: -1 },
    { event: 'subscribe', streams: ['btcusdt@depth'], id: 7 },
    { event: 'unsubscribe', streams: ['ethusdt@depth'] },
    'not json',
    { event: 'ping' },
  ];
  for (const c of cases) {
    const text = typeof c === 'string' ? c : JSON.stringify(c);
    const before = replies.length;
    w.send(text);
    await sleep(1500);
    const got = replies.slice(before);
    log('error_case', { sent: text, replies: got.filter((r) => r.control).map((r) => r.text).slice(0, 3), stream_frames: got.filter((r) => !r.control).length });
  }
  w.close();
  log('duplicate_subscribe', { eth_frames: ethE.length, eth_distinct_E: new Set(ethE).size });
}

async function silence() {
  const plans = [
    { name: 'nothing_auto_pong', sub: null, ping: null, autoPong: true },
    { name: 'nothing_no_pong', sub: null, ping: null, autoPong: false },
    { name: 'sub_btc_auto_pong', sub: ['btcusdt@depth'], ping: null, autoPong: true },
    { name: 'app_ping_20s_auto_pong', sub: null, ping: 'app', autoPong: true },
  ];
  const results = [];
  await Promise.all(plans.map(async (p) => {
    const t0 = Date.now();
    const ws = new WebSocket(URL_F, { perMessageDeflate: false, autoPong: p.autoPong });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const r = { name: p.name, frames: 0, serverPingAt: [], serverPingPayload: null, appPongs: [], closeAt: null, code: null, reason: null, lastFrameAt: null };
    ws.on('ping', (data) => { r.serverPingAt.push(round((Date.now() - t0) / 1000)); r.serverPingPayload = data.toString(); });
    ws.on('message', (raw) => {
      r.frames++;
      r.lastFrameAt = round((Date.now() - t0) / 1000);
      const text = raw.toString();
      if (text.includes('"pong"')) r.appPongs.push(trim(text, 120));
    });
    if (p.sub) ws.send(JSON.stringify({ event: 'subscribe', streams: p.sub }));
    const timer = p.ping ? setInterval(() => ws.send(JSON.stringify({ event: 'ping' })), 20000) : null;
    await new Promise((resolve) => {
      const stop = setTimeout(() => { ws.close(); resolve(); }, 100000);
      ws.on('close', (code, reason) => {
        if (r.closeAt === null) { r.closeAt = round((Date.now() - t0) / 1000); r.code = code; r.reason = reason.toString(); }
        clearTimeout(stop);
        resolve();
      });
    });
    if (timer) clearInterval(timer);
    r.appPongs = r.appPongs.slice(0, 1);
    results.push(r);
  }));
  for (const r of results) log('silence', r);
}

async function batch() {
  const info = await getJson(`${API}/fapi/v1/exchangeInfo`);
  const streams = info.symbols.map((s) => `${s.symbol.toLowerCase()}@depth`);
  const w = await open(URL_F);
  let frames = 0, bytes = 0, parseNs = 0n;
  const perStream = new Map();
  const perSec = [];
  let acks = [];
  let sec = 0;
  const timer = setInterval(() => { perSec.push(sec); sec = 0; }, 1000);
  w.on('message', (raw) => {
    const t = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t;
    if (!m.stream) {
      acks.push(m.event === 'subscribed' ? { event: m.event, acked_streams: m.data.streams?.length ?? null, acked: m.data.streams } : { event: m.event, text: trim(raw.toString(), 200) });
      return;
    }
    frames++; sec++;
    bytes += raw.length;
    perStream.set(m.stream, (perStream.get(m.stream) ?? 0) + 1);
  });
  w.send(JSON.stringify({ event: 'subscribe', streams }));
  await sleep(30000);
  clearInterval(timer);
  w.close();
  const counts = [...perStream.values()];
  const acked = new Set(acks.flatMap((a) => a.acked ?? []));
  log('batch_acks', { acks: acks.map((a) => ({ event: a.event, acked_streams: a.acked_streams, text: a.text })), not_acked: streams.filter((s) => !acked.has(s)) });
  log('batch', { streams: streams.length, delivered_streams: perStream.size, frames, frames_per_s: stats(perSec), bytes_per_s: round(bytes / 30), bytes_per_frame: round(bytes / Math.max(frames, 1)), parse_us_per_frame: round(Number(parseNs) / 1000 / Math.max(frames, 1), 2), frames_per_stream: stats(counts), silent_streams: streams.filter((s) => !perStream.has(s)).slice(0, 10), silent_count: streams.filter((s) => !perStream.has(s)).length });
}

// Which contracts the socket serves: every depth stream subscribed in slices of 50, one frame every 1.5 s, then 10 s of delivery.
async function coverage() {
  const [info, tick] = await Promise.all([getJson(`${API}/fapi/v1/exchangeInfo`), getJson(`${API}/fapi/v1/ticker/24hr`)]);
  const syms = info.symbols;
  const streams = syms.map((s) => `${s.symbol.toLowerCase()}@depth`);
  const w = await open(URL_F);
  const acked = new Set();
  const delivered = new Set();
  const nullAcks = [];
  w.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.stream) delivered.add(m.stream);
    else if (m.event === 'subscribed') {
      if (m.data.streams === null) nullAcks.push(m.id);
      for (const s of m.data.streams ?? []) acked.add(s);
    }
  });
  for (let i = 0; i < streams.length; i += 50) {
    w.send(JSON.stringify({ event: 'subscribe', streams: streams.slice(i, i + 50), id: i / 50 + 1 }));
    await sleep(1500);
  }
  await sleep(10000);
  w.close();
  const vol = new Map(tick.map((t) => [t.symbol, Number(t.volume)]));
  const by = (pred) => syms.filter(pred).length;
  const served = (s) => acked.has(`${s.symbol.toLowerCase()}@depth`);
  const cat = (s) => (s.categories ?? []).some((c) => c <= 3) ? 'tradfi' : 'crypto';
  const summary = {};
  for (const s of syms) {
    const k = `${s.quoteAsset}/${cat(s)}/${served(s) ? 'served' : 'not_served'}`;
    summary[k] = (summary[k] ?? 0) + 1;
  }
  const volServed = syms.filter(served).map((s) => vol.get(s.symbol));
  const volNot = syms.filter((s) => !served(s)).map((s) => vol.get(s.symbol));
  log('coverage', { contracts: syms.length, acked: acked.size, delivered_in_10s: delivered.size, acked_not_delivered: [...acked].filter((s) => !delivered.has(s)).slice(0, 10), null_ack_ids: nullAcks, summary, quote_volume_served: stats(volServed), quote_volume_not_served: stats(volNot) });
  log('coverage_not_served_usdt', { symbols: syms.filter((s) => s.quoteAsset === 'USDT' && !served(s)).map((s) => s.symbol) });
  log('coverage_served_inr', { symbols: syms.filter((s) => s.quoteAsset === 'INR' && served(s)).map((s) => s.symbol) });
}

async function deflate() {
  const w = await open(URL_F, { deflate: true });
  log('deflate', { offered: 'permessage-deflate', negotiated: w.upgradeHeaders?.['sec-websocket-extensions'] ?? null, open_ms: round(w.openMs), headers: w.upgradeHeaders });
  w.close();
  const plain = await open(URL_F);
  log('plain', { open_ms: round(plain.openMs), extensions: plain.upgradeHeaders?.['sec-websocket-extensions'] ?? null });
  plain.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, forms, errors, silence, batch, coverage, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
