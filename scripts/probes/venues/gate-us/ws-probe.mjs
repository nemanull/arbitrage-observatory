// Gate US spot WebSocket probe: the order_book_update diff channel against the documented REST recipe, the order_book snapshot channel, book_ticker, sequence gaps, level order, keepalive, silence, errors, compression, and every pair on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks once to see what the server negotiates.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/gate-us/ws-probe.mjs [book|batch|silence|errors|deflate]
//   book     order_book_update 100ms, order_book 20 at 100ms, book_ticker and tickers on five pairs for 60 s, with the REST with_id recipe replayed against the diffs. About 65 s, 5 REST requests.
//   batch    order_book_update on every pair on one socket and order_book 20 on every pair on a second, for 45 s. About 50 s, 1 REST request.
//   silence  four sockets that differ only in what they send or subscribe, one of them on a pair with an empty book, for up to 110 s. 1 REST request.
//   errors   unknown pair, bad level, bad interval, unknown channel, lower case pair, text that is not JSON, a duplicate subscribe and an unsubscribe, then the snapshot channel on every pair whose ticker lacks a bid or an ask. About 25 s, 1 plus one REST request per such pair.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/gate-us/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.gate.us/v4/';
const API = 'https://api.gate.us/api/v4';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const nowSec = () => Math.floor(Date.now() / 1000);
const frame = (channel, event, payload) => JSON.stringify({ time: nowSec(), channel, event, ...(payload === undefined ? {} : { payload }) });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(url = WS_URL, opts = { perMessageDeflate: false }) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, opts);
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0), ext: ws.extensions }));
    ws.once('unexpected-response', (_q, res) => reject(new Error(`http ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

const stats = (xs) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

const isDesc = (lv) => lv.every((l, i) => i === 0 || Number(l[0]) < Number(lv[i - 1][0]));
const isAsc = (lv) => lv.every((l, i) => i === 0 || Number(l[0]) > Number(lv[i - 1][0]));

async function book() {
  const pairs = ['BTC_USD', 'BTC_USDT', 'ETH_USDT', 'SOL_USD', 'SAND_USD'];
  const { ws, openMs } = await open();
  log('open', { url: WS_URL, openMs });
  const st = Object.fromEntries(pairs.map((p) => [p, { cache: [], lastU: undefined, gaps: 0, deltas: 0, emptyDeltas: 0, unorderedBids: 0, unorderedAsks: 0, snaps: 0, snapRepeats: 0, lastSnapId: undefined, snapLevels: [], snapGaps: [], bt: 0, btRepeats: 0, lastBt: undefined, tickers: 0, book: null, baseId: undefined, aligned: false, compared: 0, matched: 0, fullKey: 0, firstDeltaMs: undefined }]));
  const acks = [];
  const t0 = Date.now();

  ws.on('message', (raw) => {
    const text = raw.toString();
    const f = JSON.parse(text);
    if (f.event === 'subscribe' || f.event === 'unsubscribe') {
      acks.push({ channel: f.channel, payload: f.payload, status: f.result?.status, error: f.error });
      capture('acks.jsonl', text);
      return;
    }
    const r = f.result;
    const s = st[r?.s ?? r?.currency_pair];
    if (!s) return;
    if (f.channel === 'spot.order_book_update') {
      capture(`obu-${r.s}.jsonl`, text);
      s.deltas++;
      if (s.firstDeltaMs === undefined) s.firstDeltaMs = Date.now() - t0;
      if ('full' in r) s.fullKey++;
      if (!r.b?.length && !r.a?.length) s.emptyDeltas++;
      if (r.b?.length > 1 && !isDesc(r.b)) s.unorderedBids++;
      if (r.a?.length > 1 && !isAsc(r.a)) s.unorderedAsks++;
      if (s.lastU !== undefined && r.U !== s.lastU + 1) s.gaps++;
      s.lastU = r.u;
      if (!s.aligned) s.cache.push(r);
      else applyDelta(s, r);
    } else if (f.channel === 'spot.order_book') {
      capture(`ob20-${r.s}.jsonl`, text);
      s.snaps++;
      const nowMs = Date.now();
      if (s.firstSnapMs === undefined) s.firstSnapMs = nowMs - t0;
      if (s.lastSnapAt !== undefined) s.snapGaps.push(nowMs - s.lastSnapAt);
      s.lastSnapAt = nowMs;
      if (r.lastUpdateId === s.lastSnapId) s.snapRepeats++;
      s.lastSnapId = r.lastUpdateId;
      s.snapLevels.push(r.bids.length + '/' + r.asks.length);
      if (!isDesc(r.bids) || !isAsc(r.asks)) s.snapUnordered = (s.snapUnordered ?? 0) + 1;
      // Compare the book kept from REST plus diffs with the 20 level snapshot at the same id.
      if (s.aligned && s.book && s.book.id === r.lastUpdateId) {
        s.compared++;
        const mine = top(s.book, 20);
        if (JSON.stringify(mine.b) === JSON.stringify(r.bids.map((l) => [Number(l[0]), Number(l[1])])) && JSON.stringify(mine.a) === JSON.stringify(r.asks.map((l) => [Number(l[0]), Number(l[1])]))) s.matched++;
      }
    } else if (f.channel === 'spot.book_ticker') {
      capture(`bt-${r.s}.jsonl`, text);
      s.bt++;
      const k = `${r.b}|${r.B}|${r.a}|${r.A}`;
      if (k === s.lastBt) s.btRepeats++;
      s.lastBt = k;
    } else if (f.channel === 'spot.tickers') {
      capture(`tickers.jsonl`, text);
      s.tickers++;
    }
  });

  for (const p of pairs) ws.send(frame('spot.order_book_update', 'subscribe', [p, '100ms']));
  for (const p of pairs) ws.send(frame('spot.order_book', 'subscribe', [p, '20', '100ms']));
  ws.send(frame('spot.book_ticker', 'subscribe', pairs));
  ws.send(frame('spot.tickers', 'subscribe', pairs));

  // The documented recipe: cache diffs, read a REST book with its id, drop diffs older than it, apply the rest.
  await sleep(3000);
  for (const p of pairs) {
    const res = await fetch(`${API}/spot/order_book?currency_pair=${p}&limit=100&with_id=true&_=${Date.now()}`);
    const b = await res.json();
    const s = st[p];
    s.baseId = b.id;
    s.restAgeMs = Date.now() - b.current;
    s.restLevels = `${b.bids.length}/${b.asks.length}`;
    s.book = { id: b.id, bids: new Map(b.bids.map((l) => [Number(l[0]), Number(l[1])])), asks: new Map(b.asks.map((l) => [Number(l[0]), Number(l[1])])) };
    const firstU = s.cache[0]?.U;
    s.cacheSpan = s.cache.length ? `${s.cache[0].U}..${s.cache[s.cache.length - 1].u}` : 'empty';
    s.restVsFirstDelta = firstU === undefined ? 'no diff cached' : b.id + 1 < firstU ? 'rest older than first cached diff' : 'rest covered';
    s.aligned = true;
    for (const d of s.cache) {
      if (d.u < b.id + 1) continue;
      applyDelta(s, d);
    }
    s.cache = [];
    await sleep(250);
  }

  const pong = [];
  const pingTimer = setInterval(() => {
    const at = Date.now();
    const once = (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.channel === 'spot.pong') {
        pong.push(Date.now() - at);
        capture('pong.jsonl', raw.toString());
        ws.off('message', once);
      }
    };
    ws.on('message', once);
    ws.send(frame('spot.ping'));
  }, 15000);
  let protoPings = 0;
  ws.on('ping', () => protoPings++);

  await sleep(57000);
  clearInterval(pingTimer);
  ws.terminate();

  log('acks', { count: acks.length, failed: acks.filter((a) => a.status !== 'success') });
  for (const p of pairs) {
    const s = st[p];
    log('book', {
      pair: p, deltas: s.deltas, firstDeltaMs: s.firstDeltaMs, fullKey: s.fullKey, emptyDeltas: s.emptyDeltas, gaps: s.gaps, unorderedBids: s.unorderedBids, unorderedAsks: s.unorderedAsks,
      rest: { levels: s.restLevels, ageMs: s.restAgeMs, cacheSpan: s.cacheSpan, baseId: s.baseId, vsFirstDelta: s.restVsFirstDelta },
      keptLevels: s.book ? `${s.book.bids.size}/${s.book.asks.size}` : null, keptVsSnapshot: `${s.matched} of ${s.compared} equal`, recipeGaps: s.recipeGap ?? 0,
      snapshots: s.snaps, firstSnapMs: s.firstSnapMs, snapIntervalMs: stats(s.snapGaps), snapRepeats: s.snapRepeats, snapLevels: [...new Set(s.snapLevels)].slice(0, 6), snapUnordered: s.snapUnordered ?? 0,
      bookTicker: s.bt, btRepeats: s.btRepeats, tickers: s.tickers,
    });
  }
  log('keepalive', { protoPingsFromServer: protoPings, pongMs: pong });
}

function applyDelta(s, d) {
  if (s.book.id !== undefined && d.U > s.book.id + 1) s.recipeGap = (s.recipeGap ?? 0) + 1;
  for (const [p, q] of d.b ?? []) Number(q) === 0 ? s.book.bids.delete(Number(p)) : s.book.bids.set(Number(p), Number(q));
  for (const [p, q] of d.a ?? []) Number(q) === 0 ? s.book.asks.delete(Number(p)) : s.book.asks.set(Number(p), Number(q));
  s.book.id = d.u;
}

function top(book, n) {
  return {
    b: [...book.bids.entries()].sort((x, y) => y[0] - x[0]).slice(0, n),
    a: [...book.asks.entries()].sort((x, y) => x[0] - y[0]).slice(0, n),
  };
}

async function batch() {
  const res = await fetch(`${API}/spot/currency_pairs`);
  const pairs = (await res.json()).filter((p) => p.trade_status === 'tradable').map((p) => p.id);
  const runs = [
    { name: 'order_book_update 100ms', frames: pairs.map((p) => frame('spot.order_book_update', 'subscribe', [p, '100ms'])) },
    { name: 'order_book 20 100ms', frames: pairs.map((p) => frame('spot.order_book', 'subscribe', [p, '20', '100ms'])) },
  ];
  const results = await Promise.all(
    runs.map(async (run) => {
      const { ws, openMs } = await open();
      const r = { name: run.name, pairs: pairs.length, openMs, acksOk: 0, acksFail: 0, errors: {}, updates: 0, bytes: 0, parseUs: 0, perSec: {}, seen: new Set(), lastU: new Map(), gaps: 0, firstUpdateMs: [] };
      const sent = Date.now();
      let lastAckAt = 0;
      ws.on('message', (raw) => {
        const a = performance.now();
        const f = JSON.parse(raw.toString());
        r.parseUs += (performance.now() - a) * 1000;
        if (f.event === 'subscribe') {
          if (f.result?.status === 'success') r.acksOk++;
          else {
            r.acksFail++;
            const m = f.error?.message ?? 'no message';
            r.errors[m] = (r.errors[m] ?? 0) + 1;
          }
          lastAckAt = Date.now() - sent;
          return;
        }
        if (f.event !== 'update') return;
        r.updates++;
        r.bytes += raw.length;
        const sec = Math.floor((Date.now() - sent) / 1000);
        r.perSec[sec] = (r.perSec[sec] ?? 0) + 1;
        const id = f.result.s;
        if (!r.seen.has(id)) r.firstUpdateMs.push(Date.now() - sent);
        r.seen.add(id);
        if (f.channel === 'spot.order_book_update') {
          const last = r.lastU.get(id);
          if (last !== undefined && f.result.U !== last + 1) r.gaps++;
          r.lastU.set(id, f.result.u);
        }
      });
      for (const fr of run.frames) ws.send(fr);
      await sleep(45000);
      ws.terminate();
      const secs = Object.entries(r.perSec).filter(([k]) => Number(k) >= 2 && Number(k) < 45).map(([, v]) => v);
      return {
        name: r.name, pairs: r.pairs, openMs: r.openMs, acksOk: r.acksOk, acksFail: r.acksFail, errors: r.errors, lastAckMs: lastAckAt,
        updates: r.updates, pairsThatUpdated: r.seen.size, perSecond: stats(secs), bytesPerSecond: Math.round(r.bytes / 45), bytesPerFrame: Math.round(r.bytes / Math.max(1, r.updates)),
        parseUsPerFrame: Number((r.parseUs / Math.max(1, r.updates + r.acksOk + r.acksFail)).toFixed(1)), gaps: r.gaps, firstUpdateMs: stats(r.firstUpdateMs),
      };
    }),
  );
  for (const r of results) log('batch', r);
}

async function silence() {
  const quiet = 'ALGO_USD';
  const tk = await (await fetch(`${API}/spot/tickers`)).json();
  const empty = tk.find((t) => !Number(t.highest_bid) && !Number(t.lowest_ask))?.currency_pair ?? 'CP_USDT';
  const variants = [
    { name: `order_book_update on ${empty}, an empty book, no client frame`, sub: ['spot.order_book_update', [empty, '100ms']], appPing: false },
    { name: 'no subscribe, no client frame', sub: null, appPing: false },
    { name: `order_book_update on ${quiet}, no client frame`, sub: ['spot.order_book_update', [quiet, '100ms']], appPing: false },
    { name: 'no subscribe, spot.ping every 25 s', sub: null, appPing: true },
  ];
  const results = await Promise.all(
    variants.map(async (v) => {
      const { ws, openMs } = await open();
      const t0 = Date.now();
      const r = { name: v.name, openMs, protoPings: 0, frames: 0, updates: 0, closedAtMs: null, code: null, reason: '' };
      ws.on('ping', () => r.protoPings++);
      ws.on('message', (raw) => {
        r.frames++;
        if (JSON.parse(raw.toString()).event === 'update') r.updates++;
      });
      if (v.sub) ws.send(frame(v.sub[0], 'subscribe', v.sub[1]));
      const timer = v.appPing ? setInterval(() => ws.send(frame('spot.ping')), 25000) : null;
      let capped = false;
      await new Promise((resolve) => {
        const cap = setTimeout(() => {
          capped = true;
          resolve();
        }, 110000);
        ws.on('close', (code, reason) => {
          if (capped) return; // our own terminate after the cap
          r.closedAtMs = Date.now() - t0;
          r.code = code;
          r.reason = reason.toString();
          clearTimeout(cap);
          resolve();
        });
      });
      if (timer) clearInterval(timer);
      ws.terminate();
      return r;
    }),
  );
  for (const r of results) log('silence', r);
}

async function errors() {
  const cases = [
    ['spot.order_book_update', ['NOPE_USD', '100ms']],
    ['spot.order_book_update', ['BTC_USD', '1000ms']],
    ['spot.order_book_update', ['BTC_USD', '20ms']],
    ['spot.order_book_update', ['btc_usd', '100ms']],
    ['spot.order_book', ['NOPE_USD', '20', '100ms']],
    ['spot.order_book', ['BTC_USD', '30', '100ms']],
    ['spot.order_book', ['BTC_USD', '100', '1000ms']],
    ['spot.book_ticker', ['NOPE_USD']],
    ['spot.obu', ['ob.BTC_USD.50']],
    ['spot.nope', ['BTC_USD']],
  ];
  const { ws } = await open();
  const got = [];
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.event === 'update') return;
    got.push(f);
    capture('errors.jsonl', raw.toString());
  });
  for (const [ch, payload] of cases) {
    ws.send(frame(ch, 'subscribe', payload));
    await sleep(300);
  }
  ws.send('not json');
  await sleep(500);
  ws.send(frame('spot.order_book_update', 'subscribe', ['BTC_USD', '100ms']));
  await sleep(500);
  ws.send(frame('spot.order_book_update', 'subscribe', ['BTC_USD', '100ms']));
  await sleep(500);
  ws.send(frame('spot.order_book_update', 'unsubscribe', ['BTC_USD', '100ms']));
  await sleep(1500);
  const alive = ws.readyState === ws.OPEN;
  ws.terminate();
  for (const f of got) log('reply', { channel: f.channel, event: f.event, payload: f.payload, status: f.result?.status, error: f.error, keys: Object.keys(f) });
  log('after_not_json', { socketOpen: alive });

  // Pairs whose ticker shows no bid or no ask: what the snapshot channel sends for a one-sided or empty book.
  const tk = await (await fetch(`${API}/spot/tickers`)).json();
  const thin = tk.filter((t) => !Number(t.highest_bid) || !Number(t.lowest_ask)).map((t) => t.currency_pair);
  const { ws: ws2 } = await open();
  const first = {};
  ws2.on('message', (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.event !== 'update') return;
    const k = `${f.channel} ${f.result.s}`;
    if (!first[k]) first[k] = { bids: f.result.bids?.length ?? f.result.b?.length, asks: f.result.asks?.length ?? f.result.a?.length, frames: 0 };
    first[k].frames++;
  });
  for (const p of thin) ws2.send(frame('spot.order_book', 'subscribe', [p, '20', '100ms']));
  await sleep(8000);
  ws2.terminate();
  const rest = {};
  for (const p of thin) {
    const b = await (await fetch(`${API}/spot/order_book?currency_pair=${p}&limit=20`)).json();
    rest[p] = `${b.bids?.length}/${b.asks?.length}`;
    await sleep(200);
  }
  log('one_sided', { pairs: thin, restLevelsBidsAsks: rest, firstSnapshotIn8s: first });
}

async function deflate() {
  const { ws, openMs, ext } = await open(WS_URL, { perMessageDeflate: true });
  log('deflate', { openMs, negotiated: ext || '(none)' });
  ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const run = { book, batch, silence, errors, deflate }[mode];
if (!run) {
  console.error('mode: book|batch|silence|errors|deflate');
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
