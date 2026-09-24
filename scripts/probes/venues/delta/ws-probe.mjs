// Delta Exchange global WebSocket probe: which URL serves which channel names, the book channels with sequence, checksum and level order, size unit against the REST book, the anchor channels, keepalive, silence, errors and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode which only asks and closes.
// The documented connection limit is 150 per 5 minutes per IP, and no mode here opens more than 8.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/delta/ws-probe.mjs [survey|book|errors|silence|deflate]
//   survey   both global URLs, legacy and compact channel names on BTCUSDT, first frame of each type. About 35 s.
//   book     the diff book channel on every perpetual for BOOK_MS (60 s by default) on the URL in BOOK_URL, with seq, checksum, order, REST compare, plus mark, index and funding channels.
//   errors   unknown symbol, unknown channel, text that is not JSON, a second subscribe, "all" on the diff channel, a mixed frame, and 101 symbols on it. About 40 s.
//   silence  four sockets that differ only in what the client sends or subscribes, held SILENCE_MS, 70 s by default.
//   deflate  asks for permessage-deflate once on each URL and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/delta/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const LEGACY_URL = 'wss://socket.delta.exchange';
const PUBLIC_URL = 'wss://public-socket.delta.exchange';
const API = 'https://api.delta.exchange/v2';
const PERPS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'PAXGUSDT'];
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const trim = (s, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), `${text}\n`);
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

const sub = (channels) => JSON.stringify({ type: 'subscribe', payload: { channels } });

async function survey() {
  const legacy = [
    { name: 'l2_updates', symbols: ['BTCUSDT'] },
    { name: 'l2_orderbook', symbols: ['BTCUSDT'] },
    { name: 'l1_orderbook', symbols: ['BTCUSDT'] },
    { name: 'v2/ticker', symbols: ['BTCUSDT'] },
    { name: 'mark_price', symbols: ['MARK:BTCUSDT'] },
    { name: 'funding_rate', symbols: ['BTCUSDT'] },
    { name: 'v2/spot_price', symbols: ['.DEXBTUSDT'] },
    { name: 'all_trades', symbols: ['BTCUSDT'] },
  ];
  const compact = [
    { name: 'ob_updates', symbols: ['BTCUSDT'] },
    { name: 'ob_l2', symbols: ['BTCUSDT'] },
    { name: 'ob_l1', symbols: ['BTCUSDT'] },
    { name: 'ticker', symbols: ['BTCUSDT'] },
    { name: 'spot_price', symbols: ['.DEXBTUSDT'] },
    { name: 'trades', symbols: ['BTCUSDT'] },
    { name: 'system_status' },
  ];
  for (const url of [LEGACY_URL, PUBLIC_URL]) {
    for (const [label, channels] of [
      ['legacy', legacy],
      ['compact', compact],
    ]) {
      let conn;
      try {
        conn = await open(url);
      } catch (e) {
        log('open_failed', { url, label, error: String(e) });
        continue;
      }
      const { ws, openMs } = conn;
      const first = new Map();
      const counts = {};
      const t0 = Date.now();
      ws.on('message', (raw) => {
        const text = raw.toString();
        let m;
        try {
          m = JSON.parse(text);
        } catch {
          log('non_json', { url, text: trim(text) });
          return;
        }
        const key = `${m.type}${m.action ? `:${m.action}` : ''}`;
        counts[key] = (counts[key] ?? 0) + 1;
        if (!first.has(key)) {
          first.set(key, Date.now() - t0);
          log('first', { url, label, key, atMs: Date.now() - t0, frame: trim(text, 700) });
          capture(`survey_${label}.txt`, `${url} ${text}`);
        }
      });
      let closed = null;
      ws.on('close', (code, reason) => (closed = { code, reason: String(reason), atMs: Date.now() - t0 }));
      ws.send(sub(channels));
      await sleep(8_000);
      log('survey_counts', { url, label, openMs, counts, closed });
      ws.terminate();
    }
  }
}

function checksum(book) {
  const asks = [...book.asks.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 10);
  const bids = [...book.bids.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 10);
  const s = `${asks.map(([p, q]) => `${p}:${q}`).join(',')}|${bids.map(([p, q]) => `${p}:${q}`).join(',')}`;
  return crc32(s) >>> 0;
}

function applySide(map, levels) {
  for (const [p, q] of levels) {
    if (Number(q) === 0) map.delete(p);
    else map.set(p, q);
  }
}

async function book() {
  const url = process.env.BOOK_URL ?? PUBLIC_URL;
  const compact = url === PUBLIC_URL && process.env.BOOK_LEGACY !== '1';
  const bookChannel = compact ? 'ob_updates' : 'l2_updates';
  const durationMs = Number(process.env.BOOK_MS ?? 60_000);
  const { ws, openMs } = await open(url);
  log('open', { url, openMs, bookChannel });
  const books = new Map();
  const stats = new Map();
  const other = {};
  const marks = new Map();
  const spots = new Map();
  const fundings = [];
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  const perSecond = [];
  let secCount = 0;
  const tick = setInterval(() => {
    perSecond.push(secCount);
    secCount = 0;
  }, 1000);
  const t0 = Date.now();
  const tSub = Date.now();
  ws.on('message', (raw) => {
    const recv = Date.now();
    frames++;
    secCount++;
    bytes += raw.length;
    const p0 = performance.now();
    const m = JSON.parse(raw.toString());
    parseUs += (performance.now() - p0) * 1000;
    if (m.type === bookChannel) {
      const sym = m.sy ?? m.symbol;
      const asks = m.a ?? m.asks ?? [];
      const bids = m.b ?? m.bids ?? [];
      const seq = m.seq ?? m.sequence_no;
      const st = stats.get(sym) ?? { snapshots: 0, updates: 0, gaps: 0, csOk: 0, csBad: 0, empty: 0, bidsUnordered: 0, asksUnordered: 0, maxGapMs: 0, last: null, snapAtMs: null, maxBid: 0, maxAsk: 0, errors: 0, tsLagMs: [] };
      if (st.last) st.maxGapMs = Math.max(st.maxGapMs, recv - st.last);
      st.last = recv;
      const ts = m.ts ?? m.timestamp;
      if (ts) st.tsLagMs.push(recv - ts / 1000);
      const isDesc = bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]));
      const isAsc = asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]));
      if (m.action === 'snapshot') {
        st.snapshots++;
        if (st.snapAtMs === null) st.snapAtMs = recv - tSub;
        const b = { bids: new Map(), asks: new Map(), seq };
        applySide(b.bids, bids);
        applySide(b.asks, asks);
        books.set(sym, b);
        st.snapBids = bids.length;
        st.snapAsks = asks.length;
        st.snapBidsDesc = isDesc;
        st.snapAsksAsc = isAsc;
        const cs = checksum(b);
        if (m.cs !== undefined) cs === m.cs ? st.csOk++ : st.csBad++;
        if (st.snapshots === 1) capture('book_snapshot.txt', trim(raw.toString(), 1500));
      } else if (m.action === 'update') {
        st.updates++;
        if (!isDesc) st.bidsUnordered++;
        if (!isAsc) st.asksUnordered++;
        if (bids.length === 0 && asks.length === 0) st.empty++;
        const b = books.get(sym);
        if (!b) {
          st.gaps++;
        } else {
          if (seq !== b.seq + 1) {
            st.gaps++;
            if (st.gaps <= 3) log('gap', { sym, expected: b.seq + 1, got: seq });
          }
          b.seq = seq;
          applySide(b.bids, bids);
          applySide(b.asks, asks);
          st.maxBid = Math.max(st.maxBid, b.bids.size);
          st.maxAsk = Math.max(st.maxAsk, b.asks.size);
          if (m.cs !== undefined) {
            const cs = checksum(b);
            if (cs === m.cs) st.csOk++;
            else {
              st.csBad++;
              if (st.csBad <= 2) log('checksum_mismatch', { sym, seq, got: m.cs, computed: cs });
            }
          }
        }
        if (st.updates === 1) capture('book_update.txt', trim(raw.toString(), 1500));
      } else {
        st.errors++;
        log('book_other_action', { frame: trim(raw.toString()) });
      }
      stats.set(sym, st);
      return;
    }
    const key = m.type;
    other[key] = (other[key] ?? 0) + 1;
    if (m.type === 'mark_price') {
      const sym = m.sy ?? m.symbol;
      const arr = marks.get(sym) ?? [];
      arr.push({ recv, p: m.p ?? m.price, ts: m.ts ?? m.timestamp });
      marks.set(sym, arr);
    } else if (m.type === 'spot_price' || m.type === 'v2/spot_price') {
      const sym = m.sy ?? m.s ?? m.symbol;
      const arr = spots.get(sym) ?? [];
      arr.push({ recv, p: m.p ?? m.price, ts: m.ts });
      spots.set(sym, arr);
    } else if (m.type === 'funding_rate') {
      fundings.push({ recv, ...m });
      if (fundings.length <= 2) log('funding_frame', { frame: trim(raw.toString(), 500) });
    } else if (m.type === 'subscriptions') {
      log('ack', { atMs: recv - tSub, frame: trim(raw.toString(), 900) });
    } else if (other[key] === 1) {
      log('other_first', { key, frame: trim(raw.toString(), 500) });
    }
  });
  let closed = null;
  ws.on('close', (code, reason) => (closed = { code, reason: String(reason), atMs: Date.now() - t0 }));
  const markSyms = PERPS.map((s) => `MARK:${s}`);
  const idx = ['.DEXBTUSDT', '.DEETHUSDT', '.DESOLUSDT', '.DEXRPUSDT', '.DEDOGEUSDT', '.DEPAXGUSDT'];
  ws.send(
    sub([
      { name: bookChannel, symbols: PERPS },
      { name: 'mark_price', symbols: markSyms },
      { name: compact ? 'spot_price' : 'v2/spot_price', symbols: idx },
      { name: 'funding_rate', symbols: PERPS },
    ]),
  );
  const keepalive = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 25_000);

  // Compare the maintained book with the REST book at 20 levels twice during the run.
  const compares = [];
  for (const at of [durationMs / 3, (2 * durationMs) / 3]) {
    await sleep(at - (Date.now() - t0));
    for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
      const b = books.get(sym);
      const res = await fetch(`${API}/l2orderbook/${sym}?depth=20`).then((r) => r.json());
      if (!b) continue;
      const restBids = res.result.buy.slice(0, 10);
      const restAsks = res.result.sell.slice(0, 10);
      let same = 0;
      let samePrice = 0;
      for (const l of restBids) {
        if (b.bids.has(l.price)) samePrice++;
        if (Number(b.bids.get(l.price)) === Number(l.size)) same++;
      }
      for (const l of restAsks) {
        if (b.asks.has(l.price)) samePrice++;
        if (Number(b.asks.get(l.price)) === Number(l.size)) same++;
      }
      const wsBest = [...b.bids.keys()].map(Number).sort((x, y) => y - x)[0];
      compares.push({ sym, sameSizeOf20: same, samePriceOf20: samePrice, restTopBid: restBids[0], wsTopBid: [wsBest, b.bids.get(String(wsBest)) ?? b.bids.get(restBids[0]?.price)], restSeq: res.result.last_sequence_no, wsSeq: b.seq });
    }
  }
  await sleep(Math.max(0, durationMs - (Date.now() - t0)));
  clearInterval(tick);
  clearInterval(keepalive);
  ws.terminate();
  log('compare_rest', { compares });
  for (const [sym, st] of stats) {
    const lags = st.tsLagMs.sort((a, b) => a - b);
    delete st.tsLagMs;
    delete st.last;
    log('book_stats', { sym, ...st, tsLagMedianMs: Math.round(lags[Math.floor(lags.length / 2)] ?? NaN) });
  }
  const sorted = [...perSecond].sort((a, b) => a - b);
  log('throughput', { url, frames, seconds: perSecond.length, medianPerS: sorted[Math.floor(sorted.length / 2)], peakPerS: sorted.at(-1), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Math.round(parseUs / frames), other, closed });
  for (const [sym, arr] of marks) {
    const gaps = arr.slice(1).map((x, i) => x.recv - arr[i].recv).sort((a, b) => a - b);
    const changes = arr.slice(1).filter((x, i) => x.p !== arr[i].p).length;
    log('mark_cadence', { sym, frames: arr.length, changes, medianGapMs: gaps[Math.floor(gaps.length / 2)], maxGapMs: gaps.at(-1), last: arr.at(-1).p, tsLagMs: arr.at(-1).ts ? arr.at(-1).recv - arr.at(-1).ts / 1000 : null });
  }
  for (const [sym, arr] of spots) {
    const gaps = arr.slice(1).map((x, i) => x.recv - arr[i].recv).sort((a, b) => a - b);
    const changes = arr.slice(1).filter((x, i) => x.p !== arr[i].p).length;
    log('spot_cadence', { sym, frames: arr.length, changes, medianGapMs: gaps[Math.floor(gaps.length / 2)], maxGapMs: gaps.at(-1), last: arr.at(-1).p });
  }
  const bySym = new Map();
  for (const f of fundings) {
    const sym = f.sy ?? f.symbol;
    const arr = bySym.get(sym) ?? [];
    arr.push(f);
    bySym.set(sym, arr);
  }
  for (const [sym, arr] of bySym) {
    const fr = arr.map((f) => f.fr ?? f.funding_rate);
    const gaps = arr.slice(1).map((x, i) => x.recv - arr[i].recv).sort((a, b) => a - b);
    const last = arr.at(-1);
    log('funding_cadence', { sym, frames: arr.length, distinctRates: new Set(fr).size, medianGapMs: gaps[Math.floor(gaps.length / 2)], last: { ...last, recv: undefined }, nextIso: new Date((last.nfr ?? last.next_funding_realization) / 1000).toISOString() });
  }
  // The ticker at the end, to set its funding_rate beside the channel's.
  const t = await fetch(`${API}/tickers?contract_types=perpetual_futures`).then((r) => r.json());
  log('ticker_funding', { rows: t.result.map((x) => [x.symbol, x.funding_rate, x.mark_price, x.spot_price]) });
}

async function errors() {
  const url = process.env.BOOK_URL ?? PUBLIC_URL;
  const compact = url === PUBLIC_URL;
  const bookChannel = compact ? 'ob_updates' : 'l2_updates';
  const { ws } = await open(url);
  const t0 = Date.now();
  const seen = {};
  ws.on('message', (raw) => {
    const text = raw.toString();
    let m = {};
    try {
      m = JSON.parse(text);
    } catch {}
    const key = `${m.type}:${m.action ?? ''}:${m.sy ?? m.symbol ?? ''}`;
    seen[key] = (seen[key] ?? 0) + 1;
    if (m.type === 'subscriptions' || m.type === 'error' || m.action === 'error' || m.error || m.type === 'pong' || seen[key] === 1) {
      if (m.type === bookChannel && m.action !== 'error' && seen[key] > 1) return;
      log('reply', { atMs: Date.now() - t0, frame: trim(text, 600) });
    }
  });
  let closed = null;
  ws.on('close', (code, reason) => (closed = { code, reason: String(reason), atMs: Date.now() - t0 }));
  const step = async (label, text, wait = 3000) => {
    log('send', { label, atMs: Date.now() - t0 });
    ws.send(text);
    await sleep(wait);
  };
  await step('unknown symbol', sub([{ name: bookChannel, symbols: ['NOPEUSDT'] }]));
  await step('unknown channel', sub([{ name: 'nope_channel', symbols: ['BTCUSDT'] }]));
  await step('not json', 'hello');
  await step('app ping', JSON.stringify({ type: 'ping' }));
  await step('subscribe DOGEUSDT', sub([{ name: bookChannel, symbols: ['DOGEUSDT'] }]));
  await step('subscribe DOGEUSDT again', sub([{ name: bookChannel, symbols: ['DOGEUSDT'] }]));
  await step('all on diff channel', sub([{ name: bookChannel, symbols: ['all'] }]));
  await step('spot product on diff channel', sub([{ name: bookChannel, symbols: ['BTC_USDT'] }]));
  await step('no symbols', sub([{ name: bookChannel }]));
  await step('valid and other-URL channel in one frame', sub([{ name: bookChannel, symbols: ['XRPUSDT'] }, { name: compact ? 'l2_updates' : 'ob_updates', symbols: ['XRPUSDT'] }]));
  log('closed_after_errors', { closed, seen });
  ws.terminate();

  // 101 symbols on one socket, from the option catalog, against the documented cap of 100.
  const products = await fetch(`${API}/products?contract_types=call_options,put_options`).then((r) => r.json());
  const opts = products.result.slice(0, 101).map((p) => p.symbol);
  const c2 = await open(url);
  let acks = 0;
  const snaps = new Set();
  const replies = [];
  c2.ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'subscriptions') {
      acks++;
      replies.push(trim(raw.toString(), 500));
    } else if (m.action === 'snapshot') snaps.add(m.sy ?? m.symbol);
    else if (m.action === 'error' || m.type === 'error') replies.push(trim(raw.toString(), 300));
  });
  let closed2 = null;
  c2.ws.on('close', (code, reason) => (closed2 = { code, reason: String(reason) }));
  c2.ws.send(sub([{ name: bookChannel, symbols: [...PERPS, ...opts.slice(0, 95)] }]));
  await sleep(5000);
  c2.ws.send(sub([{ name: bookChannel, symbols: opts.slice(95, 101) }]));
  await sleep(5000);
  log('cap_test', { requested: PERPS.length + 101, acks, snapshots: snaps.size, replies: replies.slice(0, 4), closed2 });
  c2.ws.terminate();
}

async function silence() {
  const url = process.env.BOOK_URL ?? PUBLIC_URL;
  const compact = url === PUBLIC_URL;
  const bookChannel = compact ? 'ob_updates' : 'l2_updates';
  const holdMs = Number(process.env.SILENCE_MS ?? 70_000);
  const variants = [
    { id: 'A_nothing', setup: () => {} },
    { id: 'B_enable_heartbeat', setup: (ws) => ws.send(JSON.stringify({ type: 'enable_heartbeat' })) },
    { id: 'C_quiet_book_only', setup: (ws) => ws.send(sub([{ name: bookChannel, symbols: ['DOGEUSDT'] }])) },
    { id: 'D_app_ping_25s', setup: (ws, timers) => timers.push(setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 25_000)) },
  ];
  const results = await Promise.all(
    variants.map(async (v) => {
      const { ws } = await open(url);
      const t0 = Date.now();
      const timers = [];
      const r = { id: v.id, frames: 0, heartbeats: [], pongs: 0, protoPings: 0, closed: null, types: {} };
      ws.on('ping', () => r.protoPings++);
      ws.on('message', (raw) => {
        r.frames++;
        const m = JSON.parse(raw.toString());
        r.types[m.type] = (r.types[m.type] ?? 0) + 1;
        if (m.type === 'heartbeat') r.heartbeats.push(Date.now() - t0);
        if (m.type === 'pong') r.pongs++;
        if (r.types[m.type] === 1 && (m.type === 'heartbeat' || m.type === 'pong')) log('keepalive_frame', { id: v.id, frame: trim(raw.toString(), 300) });
      });
      const done = new Promise((resolve) => {
        ws.on('close', (code, reason) => {
          if (!r.heldToEnd) r.closed = { code, reason: String(reason), atMs: Date.now() - t0 };
          resolve();
        });
      });
      v.setup(ws, timers);
      await Promise.race([done, sleep(holdMs)]);
      timers.forEach(clearInterval);
      if (!r.closed) r.heldToEnd = true;
      ws.terminate();
      return r;
    }),
  );
  for (const r of results) log('silence', r);
}

async function deflate() {
  for (const url of [LEGACY_URL, PUBLIC_URL]) {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: true });
    await new Promise((resolve) => {
      ws.once('upgrade', (res) => log('upgrade', { url, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server ?? null, ms: Math.round(performance.now() - t0) }));
      ws.once('open', resolve);
      ws.once('error', (e) => {
        log('error', { url, error: String(e) });
        resolve();
      });
    });
    ws.terminate();
  }
}

const mode = process.argv[2] ?? 'survey';
const modes = { survey, book, errors, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
