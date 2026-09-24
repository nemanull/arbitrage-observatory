// OrangeX public WebSocket probe: the book.{instrument}.raw channel and the documented REST alignment, sequence, level order and size unit, the ticker, mark and index channels, errors, keepalive, silence, deflate, and a batch of perpetuals on one socket.
// Public, unauthenticated, read-only.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// The venue asks for at most 5 new sockets a minute and fewer than 10 at once, so every mode opens one to two sockets and the modes run one at a time.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/orangex/ws-probe.mjs [book|batch|silence|deflate]
//   book     book raw on four perps for 60 s, aligned to REST get_order_book as the docs say, checked against REST twice, plus ticker, markprice, price_index, trades, pings and every error case. One socket.
//   batch    book raw on 150 perps in one frame, then every other perp in a second frame, for 45 s. One socket.
//   silence  two sockets that never ping, one idle and one subscribed to a quiet book, for up to 90 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/orangex/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api.orangex.com/ws/api/v1';
const API = 'https://api.orangex.com/api/v1/public';
const OUT = process.env.PROBE_OUT_DIR;
const BOOK_MS = 60_000;
const BATCH_MS = 45_000;
const SILENCE_MS = 90_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function trim(obj) {
  return JSON.stringify(obj, (k, v) => (Array.isArray(v) && v.length > 3 && Array.isArray(v[0]) ? [...v.slice(0, 3), `…${v.length - 3} more`] : v));
}

function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

async function getJson(path) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${path}`);
  const body = await res.json();
  return { ms: Math.round(performance.now() - t0), body };
}

function open(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
    ws.once('upgrade', (res) => {
      ws.upgradeHeaders = res.headers;
    });
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected response ${res.statusCode}`)));
  });
}

// A local book kept by the documented recipe, with the top 20 of every applied change kept for an exact REST compare.
class LocalBook {
  constructor(id) {
    this.id = id;
    this.buf = [];
    this.bids = new Map();
    this.asks = new Map();
    this.last = null;
    this.synced = false;
    this.history = new Map(); // change_id to top 20 of both sides
    this.maxLevels = [0, 0];
  }

  applyLevels(side, levels) {
    const map = side === 'bids' ? this.bids : this.asks;
    for (const [action, price, amount] of levels) {
      // Keyed by number, because the socket pads prices and sizes that REST trims.
      if (action === 'delete' || Number(amount) === 0) map.delete(Number(price));
      else map.set(Number(price), Number(amount));
    }
  }

  top(n = 20) {
    const b = [...this.bids.entries()].sort((x, y) => y[0] - x[0]).slice(0, n);
    const a = [...this.asks.entries()].sort((x, y) => x[0] - y[0]).slice(0, n);
    return { b, a };
  }

  apply(d) {
    this.applyLevels('bids', d.bids ?? []);
    this.applyLevels('asks', d.asks ?? []);
    this.last = d.change_id;
    this.maxLevels = [Math.max(this.maxLevels[0], this.bids.size), Math.max(this.maxLevels[1], this.asks.size)];
    this.history.set(d.change_id, this.top());
    if (this.history.size > 400) this.history.delete(this.history.keys().next().value);
  }
}

function compareTop(local, rest) {
  let same = 0;
  let total = 0;
  for (const [side, key] of [
    ['b', 'bids'],
    ['a', 'asks'],
  ]) {
    const r = rest[key].slice(0, 20);
    for (let i = 0; i < r.length; i++) {
      total++;
      const l = local[side][i];
      if (l && Number(l[0]) === Number(r[i][0]) && Number(l[1]) === Number(r[i][1])) same++;
    }
  }
  return { same, total };
}

async function book() {
  const ids = ['BTC-USDT-PERPETUAL', 'ETH-USDT-PERPETUAL', 'SOL-USDT-PERPETUAL', 'CHR-USDT-PERPETUAL'];
  const { ws, openMs } = await open(WS_URL);
  log('open', { url: WS_URL, openMs, extensions: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null });
  const t0 = Date.now();
  const books = new Map(ids.map((id) => [id, new LocalBook(id)]));
  const st = new Map(ids.map((id) => [id, { frames: 0, prev: null, rawGaps: 0, dupes: 0, first: null, lastAt: null, maxIdle: 0, empty: 0, bidsNotDesc: 0, asksNotAsc: 0, actions: {}, keys: new Set(), tsLag: [], firstAt: null }]));
  const other = new Map(); // channel to { frames, first, times }
  const replies = new Map();
  const pingSent = new Map();
  const pingRtt = [];
  let textPong = [];
  const mp = { entries: [], ids: new Set(), mutAge: [], markEqUnd: 0, total: 0, btc: [] };
  let serverPings = 0;
  let frames = 0;

  ws.on('ping', () => serverPings++);
  ws.on('message', (raw, isBinary) => {
    frames++;
    const now = Date.now();
    const text = raw.toString('utf8');
    if (isBinary) log('binary_frame', { bytes: raw.length });
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      textPong.push({ at: now - t0, text: text.slice(0, 40) });
      return;
    }
    if (msg.id !== undefined) {
      // The server echoes a numeric id as a string.
      if (pingSent.has(Number(msg.id))) {
        pingRtt.push(now - pingSent.get(Number(msg.id)));
        if (!replies.has('ping')) replies.set('ping', msg);
        return;
      }
      replies.set(msg.id, { at: now - t0, msg });
      capture('ws-replies.jsonl', trim(msg));
      return;
    }
    if (msg.method !== 'subscription') {
      log('other_message', { text: text.slice(0, 300) });
      return;
    }
    const ch = msg.params.channel;
    const d = msg.params.data;
    const m = /^book\.(.+)\.raw$/.exec(ch);
    if (m && books.has(m[1])) {
      const s = st.get(m[1]);
      const b = books.get(m[1]);
      s.frames++;
      for (const k of Object.keys(d)) s.keys.add(k);
      if (s.first === null) {
        s.first = { at: now - t0, change_id: d.change_id, bids: d.bids?.length ?? 0, asks: d.asks?.length ?? 0, keys: Object.keys(d) };
        capture('ws-book-first.jsonl', trim(msg));
      } else if (s.frames <= 4) capture('ws-book-deltas.jsonl', trim(msg));
      if (s.prev !== null) {
        if (d.change_id === s.prev) s.dupes++;
        else if (d.change_id !== s.prev + 1) s.rawGaps++;
        s.maxIdle = Math.max(s.maxIdle, now - s.lastAt);
      }
      s.prev = d.change_id;
      s.lastAt = now;
      s.tsLag.push(now - Number(d.timestamp));
      if ((d.bids?.length ?? 0) + (d.asks?.length ?? 0) === 0) s.empty++;
      const bp = (d.bids ?? []).map((x) => Number(x[1]));
      const ap = (d.asks ?? []).map((x) => Number(x[1]));
      if (bp.some((p, i) => i > 0 && p >= bp[i - 1])) s.bidsNotDesc++;
      if (ap.some((p, i) => i > 0 && p <= ap[i - 1])) s.asksNotAsc++;
      for (const x of [...(d.bids ?? []), ...(d.asks ?? [])]) s.actions[x[0]] = (s.actions[x[0]] ?? 0) + 1;
      if (b.synced) {
        if (d.change_id <= b.last) return;
        if (d.change_id > b.last + 1) {
          s.syncGaps = (s.syncGaps ?? 0) + 1;
        }
        b.apply(d);
      } else b.buf.push(d);
      return;
    }
    const o = other.get(ch) ?? { frames: 0, first: null, times: [] };
    o.frames++;
    if (ch === 'markprice.perpetual.PERPETUAL') {
      mp.entries.push(d.length);
      for (const e of d) {
        mp.ids.add(e.instrument_name);
        mp.mutAge.push(now - Number(e.mut));
        if (e.mark_price === e.underlying_price) mp.markEqUnd++;
        mp.total++;
        if (e.instrument_name === 'BTC-USDT-PERPETUAL') mp.btc.push([e.mark_price, e.underlying_price]);
      }
    }
    o.times.push(now - t0);
    if (o.first === null) {
      o.first = trim(msg).slice(0, 700);
      capture('ws-other-first.jsonl', trim(msg));
    }
    other.set(ch, o);
  });
  const closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString(), at: Date.now() - t0 })));

  // Subscribe the four books in one frame, then each other case in its own frame.
  ws.send(rpc(1, '/public/subscribe', { channels: ids.map((id) => `book.${id}.raw`) }));
  const cases = [
    [2, '/public/subscribe', { channels: ['ticker.BTC-USDT-PERPETUAL.raw', 'trades.BTC-USDT-PERPETUAL.raw'] }],
    [3, '/public/subscribe', { channels: ['markprice.perpetual.PERPETUAL'] }],
    [4, '/public/subscribe', { channels: ['price_index.btc_usdt'] }],
    [15, '/public/subscribe', { channels: ['price_index.chr_usdt'] }],
    [16, '/public/subscribe', { channels: ['price_index.BTC-USDT'] }],
    [5, '/public/subscribe', { channels: ['book.NOPE-USDT-PERPETUAL.raw'] }],
    [6, '/public/subscribe', { channels: ['book.XRP-USDT-PERPETUAL.100ms'] }],
    [7, '/public/subscribe', { channels: ['book.XRP-USDT-PERPETUAL.none.20.100ms'] }],
    [8, '/public/subscribe', { channels: ['nope.XRP-USDT-PERPETUAL.raw'] }],
    [9, '/public/subscribe', { channels: ['book.BTC-USDT-PERPETUAL.raw'] }],
    [10, 'public/subscribe', { channels: ['book.ADA-USDT-PERPETUAL.raw'] }],
    [11, '/public/nope', {}],
    [12, '/public/subscribe', { channels: ['book.BTCUSDT.raw'] }],
    [13, '/public/subscribe', { channels: ['ticker.BTC-USDT-PERPETUAL.100ms'] }],
    [14, '/public/subscribe', {}],
  ];
  await sleep(300);
  for (const [id, method, params] of cases) {
    ws.send(rpc(id, method, params));
    await sleep(100);
  }
  ws.send('not json');
  ws.send('PING');

  // The documented keepalive is a ping every 5 s, as the text PING or /public/ping.
  let pingId = 1000;
  const keep = setInterval(() => {
    pingId++;
    pingSent.set(pingId, Date.now());
    ws.send(rpc(pingId, '/public/ping'));
  }, 5_000);

  // Align each book to a REST snapshot as the docs describe.
  await sleep(2_000);
  const syncInfo = {};
  for (const id of ids) {
    const b = books.get(id);
    const firstCid = b.buf[0]?.change_id;
    let snap;
    let tries = 0;
    do {
      tries++;
      snap = (await getJson(`get_order_book?instrument_name=${id}&depth=100`)).body.result;
      if (firstCid === undefined || snap.version >= firstCid - 1) break;
      await sleep(500);
    } while (tries < 4);
    const full = (await getJson(`get_order_book?instrument_name=${id}&depth=0`)).body.result;
    b.bids = new Map(snap.bids.map(([p, a]) => [Number(p), Number(a)]));
    b.asks = new Map(snap.asks.map(([p, a]) => [Number(p), Number(a)]));
    b.last = snap.version;
    const buffered = b.buf.length;
    const kept = b.buf.filter((d) => d.change_id > snap.version);
    const firstKept = kept[0]?.change_id;
    for (const d of kept) b.apply(d);
    b.synced = true;
    b.buf = [];
    syncInfo[id] = { firstCid, snapVersion: snap.version, tries, buffered, applied: kept.length, firstKeptIsNext: firstKept === undefined ? null : firstKept === snap.version + 1, fullDepthVersion: full.version, wsLastAtSync: st.get(id).prev, fullLevels: [full.bids.length, full.asks.length] };
  }
  log('book_sync', syncInfo);

  const checks = [];
  const check = async (label) => {
    for (const id of ['BTC-USDT-PERPETUAL', 'CHR-USDT-PERPETUAL']) {
      const rest = (await getJson(`get_order_book?instrument_name=${id}&depth=20`)).body.result;
      const b = books.get(id);
      const exact = b.history.get(rest.version);
      const now = b.top();
      checks.push({
        label,
        id,
        restVersion: rest.version,
        localLast: b.last,
        exactMatch: exact ? compareTop(exact, rest) : null,
        currentMatch: compareTop(now, rest),
        restTop: [rest.bids[0], rest.asks[0]],
        localTop: [now.b[0], now.a[0]],
      });
    }
  };
  await sleep(25_000);
  await check('at 30 s');
  await sleep(Math.max(0, BOOK_MS - (Date.now() - t0) - 3_000));
  await check('at end');
  clearInterval(keep);
  ws.close(1000);
  const close = await closed;

  log('book_compare', { checks });
  for (const id of ids) {
    const s = st.get(id);
    const b = books.get(id);
    log('book_stream', {
      id,
      frames: s.frames,
      perSecond: +(s.frames / (BOOK_MS / 1000)).toFixed(1),
      first: s.first,
      keys: [...s.keys],
      rawGaps: s.rawGaps,
      dupes: s.dupes,
      syncGaps: s.syncGaps ?? 0,
      emptyFrames: s.empty,
      maxIdleMs: s.maxIdle,
      bidsArraysNotDescending: s.bidsNotDesc,
      asksArraysNotAscending: s.asksNotAsc,
      actions: s.actions,
      timestampLagMs: stats(s.tsLag),
      maxLevelsHeld: b.maxLevels,
    });
  }
  for (const [ch, o] of other) {
    const gaps = o.times.slice(1).map((t, i) => t - o.times[i]);
    log('other_channel', { ch, frames: o.frames, gapMs: stats(gaps), first: o.first });
  }
  const catalog = (await getJson('get_instruments?currency=PERPETUAL')).body.result.map((x) => x.instrument_name);
  const liveIds = new Set(catalog);
  const ages = mp.mutAge.sort((a, b) => a - b);
  log('markprice_channel', {
    frames: mp.entries.length,
    entriesPerFrame: stats(mp.entries),
    distinctInstruments: mp.ids.size,
    inCatalog: [...mp.ids].filter((x) => liveIds.has(x)).length,
    catalogMissing: catalog.filter((x) => !mp.ids.has(x)).slice(0, 10),
    mutAgeMs: { median: ages[Math.floor(ages.length / 2)], p90: ages[Math.floor(ages.length * 0.9)], over60s: ages.filter((x) => x > 60_000).length },
    markEqualsUnderlying: `${mp.markEqUnd} of ${mp.total}`,
    btcFirstFive: mp.btc.slice(0, 5),
    btcDistinctMarks: new Set(mp.btc.map((x) => x[0])).size,
  });
  for (const [id, r] of [...replies.entries()].sort((a, b) => Number(a[0]) - Number(b[0]) || 0)) {
    if (id === 'ping') continue;
    log('reply', { id, at: r.at, msg: JSON.stringify(r.msg).slice(0, 400) });
  }
  log('keepalive', { pingRtt: stats(pingRtt), pingReply: JSON.stringify(replies.get('ping')), textReplies: textPong.slice(0, 4), serverProtocolPings: serverPings, totalFrames: frames, close });
}

async function batch() {
  const tick = (await getJson('tickers?currency=PERPETUAL')).body.result;
  tick.sort((a, b) => Number(b.stats.turnover ?? 0) - Number(a.stats.turnover ?? 0));
  const all = tick.map((t) => t.instrument_name);
  const first = all.filter((_, i) => i % 3 === 0).slice(0, 150);
  const rest = all.filter((id) => !first.includes(id));
  const { ws, openMs } = await open(WS_URL);
  const t0 = Date.now();
  const seen = new Map();
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  let gaps = 0;
  let pongs = 0;
  const perSec = new Map();
  const acks = {};
  ws.on('message', (raw) => {
    frames++;
    bytes += raw.length;
    const p0 = performance.now();
    const msg = JSON.parse(raw.toString('utf8'));
    parseUs += (performance.now() - p0) * 1000;
    const sec = Math.floor((Date.now() - t0) / 1000);
    perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
    if (msg.id !== undefined) {
      if (msg.id >= 1000) pongs++;
      else acks[msg.id] = { at: Date.now() - t0, result: Array.isArray(msg.result) ? msg.result.length : msg.result, error: msg.error };
      return;
    }
    const d = msg.params?.data;
    const id = /^book\.(.+)\.raw$/.exec(msg.params?.channel ?? '')?.[1];
    if (!id) return;
    const prev = seen.get(id);
    if (prev !== undefined && d.change_id !== prev + 1) gaps++;
    seen.set(id, d.change_id);
  });
  const closed = new Promise((r) => ws.once('close', (code) => r({ code, at: Date.now() - t0 })));
  ws.send(rpc(1, '/public/subscribe', { channels: first.map((id) => `book.${id}.raw`) }));
  let pingId = 1000;
  const keep = setInterval(() => ws.send(rpc(++pingId, '/public/ping')), 5_000);
  await sleep(10_000);
  const firstSeen = seen.size;
  const framesAt10 = frames;
  ws.send(rpc(2, '/public/subscribe', { channels: rest.map((id) => `book.${id}.raw`) }));
  await sleep(BATCH_MS - 10_000);
  clearInterval(keep);
  ws.close(1000);
  const close = await closed;
  const secs = [...perSec.entries()].filter(([s]) => s >= 12 && s < BATCH_MS / 1000 - 1).map(([, n]) => n);
  log('batch', {
    openMs,
    firstFrameStreams: first.length,
    secondFrameStreams: rest.length,
    acks,
    deliveredAfter10s: firstSeen,
    framesFirst10s: framesAt10,
    deliveredTotal: seen.size,
    silentStreams: all.filter((id) => !seen.has(id)).length,
    silentExamples: all.filter((id) => !seen.has(id)).slice(0, 8),
    framesPerSecondAllStreams: stats(secs),
    totalFrames: frames,
    bytesPerSecond: Math.round(bytes / (BATCH_MS / 1000)),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: +(parseUs / frames).toFixed(1),
    changeIdGaps: gaps,
    pongs,
    close,
  });
}

async function silence() {
  const t0 = Date.now();
  const socks = [];
  for (const [label, sub] of [
    ['idle, never sends', null],
    ['subscribed to CHR book, never pings', 'book.CHR-USDT-PERPETUAL.raw'],
  ]) {
    const { ws, openMs } = await open(WS_URL);
    const s = { label, openMs, frames: 0, lastFrameAt: null, serverPings: 0, close: null };
    ws.on('message', () => {
      s.frames++;
      s.lastFrameAt = Date.now() - t0;
    });
    ws.on('ping', () => s.serverPings++);
    s.closed = new Promise((r) =>
      ws.once('close', (code, reason) => {
        s.close = { code, reason: reason.toString(), at: Date.now() - t0 };
        r();
      }),
    );
    if (sub) ws.send(rpc(1, '/public/subscribe', { channels: [sub] }));
    s.ws = ws;
    socks.push(s);
  }
  await Promise.race([Promise.all(socks.map((s) => s.closed)), sleep(SILENCE_MS)]);
  for (const s of socks) {
    if (!s.close) s.ws.close(1000);
    log('silence', { label: s.label, openMs: s.openMs, frames: s.frames, lastFrameAtMs: s.lastFrameAt, serverPings: s.serverPings, close: s.close ?? `still open at ${SILENCE_MS} ms` });
  }
}

async function deflate() {
  const { ws, openMs } = await open(WS_URL, { perMessageDeflate: true });
  log('deflate', { openMs, negotiated: ws.upgradeHeaders?.['sec-websocket-extensions'] ?? null, headers: ws.upgradeHeaders });
  await sleep(1_000);
  ws.close(1000);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, deflate };
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
