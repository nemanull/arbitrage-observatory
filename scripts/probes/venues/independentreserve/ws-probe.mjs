// Independent Reserve WebSocket probe: the aggregated book at wss://websockets.independentreserve.com/orderbook/<depth>, its snapshot, deltas, CRC32 checksum, level order and window, heartbeat, silence, errors, and a batch of every listed pair on one socket.
// Also checks the documented order-level feed at the root path, which closed every socket on 2026-09-22.
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate offer.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/independentreserve/ws-probe.mjs [book|errors|batch|silence]
//   book     depth 50 on XBT/AUD, ETH/AUD, XBT/USD and ZRX/NZD on one socket for 45 s, with checksum checks and a REST book compare at the end. About 50 s.
//   errors   short sockets: unknown and malformed symbols, odd depths, subscribe and unsubscribe messages, duplicates, text that is not JSON, the documented root path, and a deflate offer. About 60 s.
//   batch    depth 50 on the 42 AUD pairs on one socket for 25 s, then on all 168 CCXT pairs on one socket for 25 s. About 55 s.
//   silence  three sockets for 125 s: no subscription, a quiet pair with no client frame, a quiet pair with a protocol ping every 20 s. About 125 s.
// Set PROBE_OUT_DIR to keep the first frames of each socket. Recorded in docs/profiles/independentreserve/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');
const ccxt = require('ccxt');

const WS = 'wss://websockets.independentreserve.com';
const API = 'https://api.independentreserve.com/Public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const captured = {};

function capture(name, text, max = 40) {
  if (!OUT) return;
  captured[name] = (captured[name] ?? 0) + 1;
  if (captured[name] > max) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), `${Date.now()} ${text.slice(0, 3000)}\n`);
}

// Opens a socket and resolves with a handle once it is open, refused or closed.
function open(url, name, opts = {}) {
  const t0 = Date.now();
  const h = { url, name, t0, frames: [], text: [], closed: null, refused: null, openMs: null, pings: 0, ext: null };
  h.ws = new WebSocket(url, { perMessageDeflate: false, ...opts });
  return new Promise((resolve) => {
    h.ws.on('upgrade', (res) => (h.ext = res.headers['sec-websocket-extensions'] ?? null));
    h.ws.on('unexpected-response', (req, res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        h.refused = { status: res.statusCode, message: res.statusMessage, body: b.slice(0, 200) };
        resolve(h);
      });
    });
    h.ws.on('open', () => {
      h.openMs = Date.now() - t0;
      resolve(h);
    });
    h.ws.on('ping', () => h.pings++);
    h.ws.on('message', (d) => {
      const s = d.toString();
      const at = Date.now();
      capture(name, s);
      let m;
      try {
        m = JSON.parse(s);
      } catch {
        h.text.push({ at, s: s.slice(0, 200) });
        return;
      }
      h.frames.push({ at, m, bytes: s.length });
      h.onFrame?.(m, at, s);
    });
    h.ws.on('close', (code, reason) => {
      h.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 };
      resolve(h);
    });
    h.ws.on('error', (e) => (h.error = e.message));
  });
}

const cksumValue = (v) => {
  const s = v.toFixed(8).replace('.', '');
  return String(Number(s));
};

// CCXT pro/independentreserve.js lines 209 to 235 and 240 to 247: top ten bids then top ten asks, price then volume, each at eight decimals without the point.
// The server sends the CRC unsigned, while CCXT computes it signed, so this compares unsigned.
function checksum(bids, asks, n = 10) {
  let p = '';
  for (let i = 0; i < Math.min(n, bids.length); i++) p += cksumValue(bids[i][0]) + cksumValue(bids[i][1]);
  for (let i = 0; i < Math.min(n, asks.length); i++) p += cksumValue(asks[i][0]) + cksumValue(asks[i][1]);
  return crc32(p) >>> 0;
}

class Book {
  constructor() {
    this.bids = new Map();
    this.asks = new Map();
  }
  reset(d) {
    this.bids.clear();
    this.asks.clear();
    for (const l of d.Bids ?? []) this.bids.set(l.Price, l.Volume);
    for (const l of d.Offers ?? []) this.asks.set(l.Price, l.Volume);
  }
  apply(d) {
    let repeats = 0;
    for (const [side, key] of [[this.bids, 'Bids'], [this.asks, 'Offers']]) {
      for (const l of d[key] ?? []) {
        if (l.Volume === 0) side.delete(l.Price);
        else {
          if (side.get(l.Price) === l.Volume) repeats++;
          side.set(l.Price, l.Volume);
        }
      }
    }
    return repeats;
  }
  sorted() {
    return {
      bids: [...this.bids].sort((a, b) => b[0] - a[0]),
      asks: [...this.asks].sort((a, b) => a[0] - b[0]),
    };
  }
}

const isDesc = (a) => a.every((l, i) => i === 0 || a[i - 1].Price > l.Price);
const isAsc = (a) => a.every((l, i) => i === 0 || a[i - 1].Price < l.Price);
const pct = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null;
};

function channelStats(h, depth) {
  const per = {};
  const beats = [];
  for (const { at, m, bytes } of h.frames) {
    if (m.Event === 'Heartbeat') {
      beats.push(at);
      continue;
    }
    if (!m.Channel) continue;
    const c = (per[m.Channel] ??= {
      book: new Book(),
      snapshots: 0,
      firstSnapshotMs: null,
      snapshotSizes: [],
      snapshotOrder: [],
      deltas: 0,
      deltaBeforeSnapshot: 0,
      emptyDeltas: 0,
      zeroEntries: 0,
      entries: 0,
      maxEntries: 0,
      unorderedDeltaSides: 0,
      repeats: 0,
      maxBids: 0,
      maxAsks: 0,
      ckOk: 0,
      ckBad: 0,
      ckOkAll: 0,
      ckHighBit: 0,
      firstBad: null,
      ages: [],
      bytes: 0,
      keys: new Set(),
      dataKeys: new Set(),
      lastAt: null,
      maxGapMs: 0,
      crossed: 0,
    });
    c.bytes += bytes;
    for (const k of Object.keys(m)) c.keys.add(k);
    for (const k of Object.keys(m.Data ?? {})) c.dataKeys.add(k);
    c.ages.push(at - m.Time);
    if (c.lastTime !== undefined && m.Time < c.lastTime) c.timeBackwards = (c.timeBackwards ?? 0) + 1;
    c.lastTime = m.Time;
    if (c.lastAt !== null) c.maxGapMs = Math.max(c.maxGapMs, at - c.lastAt);
    c.lastAt = at;
    const d = m.Data ?? {};
    if (m.Event === 'OrderBookSnapshot') {
      c.snapshots++;
      if (c.firstSnapshotMs === null) c.firstSnapshotMs = at - h.t0;
      c.snapshotSizes.push([(d.Bids ?? []).length, (d.Offers ?? []).length]);
      c.snapshotOrder.push(isDesc(d.Bids ?? []) && isAsc(d.Offers ?? []));
      c.snapshotCrossed = (d.Bids ?? []).length > 0 && (d.Offers ?? []).length > 0 && d.Bids[0].Price >= d.Offers[0].Price;
      c.book.reset(d);
      c.snapshotLevels ??= new Set([...(d.Bids ?? []), ...(d.Offers ?? [])].map((l) => l.Volume));
    } else if (m.Event === 'OrderBookChange') {
      if (c.snapshots === 0) {
        c.deltaBeforeSnapshot++;
        continue;
      }
      c.deltas++;
      const n = (d.Bids ?? []).length + (d.Offers ?? []).length;
      if (n === 0) c.emptyDeltas++;
      c.entries += n;
      c.maxEntries = Math.max(c.maxEntries, n);
      c.zeroEntries += [...(d.Bids ?? []), ...(d.Offers ?? [])].filter((l) => l.Volume === 0).length;
      if ((d.Bids ?? []).length > 1 && !isDesc(d.Bids)) c.unorderedDeltaSides++;
      if ((d.Offers ?? []).length > 1 && !isAsc(d.Offers)) c.unorderedDeltaSides++;
      c.repeats += c.book.apply(d);
    } else continue;
    const { bids, asks } = c.book.sorted();
    c.maxBids = Math.max(c.maxBids, bids.length);
    c.maxAsks = Math.max(c.maxAsks, asks.length);
    if (bids.length && asks.length && bids[0][0] >= asks[0][0]) c.crossed++;
    if (d.Crc32 !== undefined) {
      if (d.Crc32 >= 2 ** 31) c.ckHighBit++;
      const top = checksum(bids, asks, 10);
      if (top === d.Crc32) c.ckOk++;
      else {
        c.ckBad++;
        c.firstBad ??= { event: m.Event, got: d.Crc32, top10: top, bids: bids.length, asks: asks.length, atMs: at - h.t0, delta: c.deltas };
      }
      if (checksum(bids, asks, 1e9) === d.Crc32) c.ckOkAll++;
    }
  }
  const out = {};
  const secs = (Date.now() - h.t0) / 1000;
  for (const [ch, c] of Object.entries(per)) {
    out[ch] = {
      snapshots: c.snapshots,
      firstSnapshotMs: c.firstSnapshotMs,
      snapshotSizes: c.snapshotSizes.slice(0, 3),
      snapshotOrdered: c.snapshotOrder.every(Boolean),
      snapshotCrossed: c.snapshotCrossed ?? null,
      deltas: c.deltas,
      deltasPerSec: Math.round((c.deltas / secs) * 10) / 10,
      deltaBeforeSnapshot: c.deltaBeforeSnapshot,
      emptyDeltas: c.emptyDeltas,
      entriesPerDelta: c.deltas ? Math.round((c.entries / c.deltas) * 100) / 100 : null,
      maxEntries: c.maxEntries,
      zeroEntries: c.zeroEntries,
      unorderedDeltaSides: c.unorderedDeltaSides,
      sameVolumeRepeats: c.repeats,
      maxBidsHeld: c.maxBids,
      maxAsksHeld: c.maxAsks,
      crossedAfterFrame: c.crossed,
      crossedAtEnd: (() => {
        const { bids, asks } = c.book.sorted();
        return bids.length > 0 && asks.length > 0 && bids[0][0] >= asks[0][0];
      })(),
      checksumTop10Ok: c.ckOk,
      checksumTop10Bad: c.ckBad,
      checksumWholeBookOk: c.ckOkAll,
      checksumAboveInt32: c.ckHighBit,
      firstBad: c.firstBad,
      ageMs: { min: pct(c.ages, 0), median: pct(c.ages, 0.5), p99: pct(c.ages, 0.99), max: pct(c.ages, 1) },
      maxGapMs: c.maxGapMs,
      timeBackwards: c.timeBackwards ?? 0,
      bytes: c.bytes,
      keys: [...c.keys],
      dataKeys: [...c.dataKeys],
    };
  }
  const gaps = beats.slice(1).map((t, i) => t - beats[i]);
  return { per, out, heartbeats: beats.length, heartbeatGapMs: { min: pct(gaps, 0), median: pct(gaps, 0.5), max: pct(gaps, 1) } };
}

async function book() {
  const depth = 50;
  const pairs = ['xbt-aud', 'eth-aud', 'xbt-usd', 'zrx-nzd'];
  const h = await open(`${WS}/orderbook/${depth}?subscribe=${pairs.join(',')}`, 'book.txt');
  log('open', { url: h.url, openMs: h.openMs, refused: h.refused, ext: h.ext });
  const t = performance.now();
  await sleep(45_000);
  const s = channelStats(h, depth);
  const control = h.frames.filter(({ m }) => !m.Channel && m.Event !== 'Heartbeat').map(({ m }) => JSON.stringify(m).slice(0, 300));
  log('control', { frames: control, text: h.text.slice(0, 5), textFrames: h.text.length, pings: h.pings, closed: h.closed });
  log('heartbeat', { count: s.heartbeats, gapMs: s.heartbeatGapMs });
  for (const [ch, o] of Object.entries(s.out)) log('channel', { ch, ...o });

  const parse = h.frames.slice(0, 2000).map(({ m }) => JSON.stringify(m));
  const p0 = performance.now();
  for (const x of parse) JSON.parse(x);
  const perParseUs = Math.round(((performance.now() - p0) / parse.length) * 1000 * 10) / 10;
  const secs = (performance.now() - t) / 1000;
  const bytes = h.frames.reduce((a, f) => a + f.bytes, 0);
  log('throughput', { frames: h.frames.length, perSec: Math.round(h.frames.length / secs), bytesPerSec: Math.round(bytes / secs), bytesPerFrame: Math.round(bytes / h.frames.length), parseUs: perParseUs });

  // The socket book against the REST book read at the end, by price and volume rather than by position.
  for (const [ch, q] of [['orderbook/50/btc/aud', 'aud'], ['orderbook/50/btc/usd', 'usd']]) {
    const c = s.per[ch];
    if (!c) continue;
    const rest = await fetch(`${API}/GetOrderBook?primaryCurrencyCode=xbt&secondaryCurrencyCode=${q}`).then((r) => r.json());
    const restAt = Date.now();
    const { bids, asks } = c.book.sorted();
    const has = (rows, l) => rows.some((x) => x.Price === l[0] && x.Volume === l[1]);
    const hasVol = (rows, l) => rows.some((x) => x.Volume === l[1]);
    const wsOnly = (side, rows) => side.slice(0, 20).filter((l) => !hasVol(rows, l));
    const restTop = (rows) => rows.slice(0, 20).map((x) => [x.Price, x.Volume]);
    const inWs = (side, rows) => restTop(rows).filter((l) => side.some((x) => x[0] === l[0] && x[1] === l[1])).length;
    const snap = c.snapshotLevels ?? new Set();
    log('rest_compare', {
      ch,
      socketFrameAgeAtRestMs: restAt - c.lastAt,
      socketCrossed: bids[0][0] >= asks[0][0],
      restCrossed: rest.BuyOrders[0].Price >= rest.SellOrders[0].Price,
      socketTop: [bids[0], asks[0]],
      restTop: [[rest.BuyOrders[0].Price, rest.BuyOrders[0].Volume], [rest.SellOrders[0].Price, rest.SellOrders[0].Volume]],
      restTop20BidsInSocket: inWs(bids, rest.BuyOrders),
      restTop20AsksInSocket: inWs(asks, rest.SellOrders),
      socketTop20BidsEqualInRest: bids.slice(0, 20).filter((l) => has(rest.BuyOrders, l)).length,
      socketTop20AsksEqualInRest: asks.slice(0, 20).filter((l) => has(rest.SellOrders, l)).length,
      socketOnlyBids: wsOnly(bids, rest.BuyOrders).slice(0, 4).map((l) => `${l[0]}x${l[1]}${snap.has(l[1]) ? ' since snapshot' : ''}`),
      socketOnlyAsks: wsOnly(asks, rest.SellOrders).slice(0, 4).map((l) => `${l[0]}x${l[1]}${snap.has(l[1]) ? ' since snapshot' : ''}`),
      socketBidsAboveSocketBestAsk: bids.filter((l) => l[0] >= asks[0][0]).length,
      socketAsksBelowSocketBestBid: asks.filter((l) => l[0] <= bids[0][0]).length,
      restCreated: rest.CreatedTimestampUtc,
    });
    await sleep(1000);
  }
  h.ws.terminate();
}

async function short(url, name, ms, sendFrames = [], opts = {}) {
  const h = await open(url, name, opts);
  for (const [delay, f] of sendFrames) {
    await sleep(delay);
    if (h.ws.readyState === WebSocket.OPEN) h.ws.send(f);
  }
  const end = Date.now() + ms;
  while (Date.now() < end && !h.closed && !h.refused) await sleep(100);
  const events = {};
  for (const { m } of h.frames) {
    const k = `${m.Event ?? '?'} ${m.Channel ?? ''}`.trim();
    events[k] = (events[k] ?? 0) + 1;
  }
  const control = h.frames.filter(({ m }) => m.Event === 'Subscriptions' || m.Event === 'Error' || !m.Event).map(({ at, m }) => `+${at - h.t0}ms ${JSON.stringify(m).slice(0, 260)}`);
  log('case', { name, url: url.replace(WS, ''), sent: sendFrames.map((f) => f[1]), openMs: h.openMs, refused: h.refused, ext: h.ext, closed: h.closed, events, control: control.slice(0, 4), text: h.text.slice(0, 3).map((x) => `+${x.at - h.t0}ms ${x.s}`) });
  h.ws.terminate();
}

async function errors() {
  await short(`${WS}/orderbook/10?subscribe=nope-aud`, 'e-unknown.txt', 3000);
  await short(`${WS}/orderbook/10?subscribe=xbtaud`, 'e-malformed.txt', 3000);
  await short(`${WS}/orderbook/10?subscribe=xbt-eur`, 'e-eur.txt', 4000);
  await short(`${WS}/orderbook/10?subscribe=sol-usdt`, 'e-usdt-quote.txt', 6000);
  await short(`${WS}/orderbook/10?subscribe=BTC-AUD,Xbt-Aud`, 'e-spelling.txt', 3000);
  await short(`${WS}/orderbook/10?subscribe=xbt-aud,xbt-aud`, 'e-duplicate.txt', 3000);
  await short(`${WS}/orderbook/0?subscribe=xbt-aud`, 'e-depth0.txt', 3000);
  await short(`${WS}/orderbook/abc?subscribe=xbt-aud`, 'e-depthabc.txt', 3000);
  await short(`${WS}/orderbook/5000?subscribe=zrx-aud`, 'e-depth5000.txt', 3000);
  await short(`${WS}/orderbook/10`, 'e-message-sub.txt', 5000, [[500, JSON.stringify({ Event: 'Subscribe', Data: ['eth-aud', 'xbt-usd'] })]]);
  await short(`${WS}/orderbook/10?subscribe=eth-aud`, 'e-message-unsub.txt', 5000, [[1500, JSON.stringify({ Event: 'Unsubscribe', Data: ['eth-aud'] })]]);
  await short(`${WS}/orderbook/10?subscribe=eth-aud`, 'e-message-sub-channel.txt', 4000, [[500, JSON.stringify({ Event: 'Subscribe', Data: ['orderbook/10/xbt/usd'] })]]);
  await short(`${WS}/orderbook/10?subscribe=eth-aud`, 'e-notjson.txt', 3000, [[500, 'hello']]);
  await short(`${WS}/orderbook/10?subscribe=eth-aud`, 'e-deflate.txt', 2000, [], { perMessageDeflate: true });
  await short(`${WS}/?subscribe=orderbook-xbt,ticker-xbt`, 'e-root-query.txt', 3000);
  await short(`${WS}/`, 'e-root-message.txt', 3000, [[100, JSON.stringify({ Event: 'Subscribe', Data: ['orderbook-xbt'] })]]);
  await short(`${WS}/?subscribe=ticker-BTC-AUD`, 'e-root-ccxt-ticker.txt', 3000);
  for (const path of ['/', '/orderbook/10?subscribe=xbt-aud', '/nope']) {
    const r = await fetch(`https://websockets.independentreserve.com${path}`);
    log('http_get', { path, status: r.status, body: (await r.text()).slice(0, 120) });
  }
}

async function batch() {
  const ex = new ccxt.independentreserve();
  const markets = Object.values(await ex.loadMarkets());
  const all = markets.map((m) => m.id.replace('/', '-').toLowerCase());
  await batchRun('aud-only', all.filter((p) => p.endsWith('-aud')), 25);
  await batchRun('all', all, 25);
}

async function batchRun(label, pairs, seconds) {
  const url = `${WS}/orderbook/50?subscribe=${pairs.join(',')}`;
  const h = await open(url, `batch-${label}.txt`, {});
  log('open', { label, pairs: pairs.length, urlLength: url.length, openMs: h.openMs, refused: h.refused, closed: h.closed });
  const t = performance.now();
  const perSecond = [];
  let last = 0;
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    perSecond.push(h.frames.length - last);
    last = h.frames.length;
  }
  const secs = (performance.now() - t) / 1000;
  const s = channelStats(h, 50);
  const subs = h.frames.find(({ m }) => m.Event === 'Subscriptions')?.m.Data ?? [];
  const rows = Object.entries(s.out);
  const sum = (k) => rows.reduce((a, [, o]) => a + o[k], 0);
  const bytes = h.frames.reduce((a, f) => a + f.bytes, 0);
  const silent = pairs.filter((p) => !s.out[`orderbook/50/${p.replace('xbt', 'btc').replace('-', '/')}`]);
  const snapshotMs = rows.map(([, o]) => o.firstSnapshotMs).filter((x) => x !== null);
  log('batch', {
    label,
    subscriptionsAcked: subs.length,
    channelsWithFrames: rows.length,
    withSnapshot: rows.filter(([, o]) => o.snapshots > 0).length,
    lastFirstSnapshotMs: Math.max(...snapshotMs),
    silentPairs: silent.slice(0, 10),
    frames: h.frames.length,
    perSec: { median: pct(perSecond, 0.5), max: pct(perSecond, 1), mean: Math.round(h.frames.length / secs) },
    bytesPerSec: Math.round(bytes / secs),
    deltas: sum('deltas'),
    checksumTop10Ok: sum('checksumTop10Ok'),
    checksumTop10Bad: sum('checksumTop10Bad'),
    crossedAfterFrame: sum('crossedAfterFrame'),
    timeBackwards: sum('timeBackwards'),
    channelsCrossedAtEnd: rows.filter(([, o]) => o.crossedAtEnd).length,
    maxBidsHeld: Math.max(...rows.map(([, o]) => o.maxBidsHeld)),
    maxAsksHeld: Math.max(...rows.map(([, o]) => o.maxAsksHeld)),
    snapshotsUnder50: rows.filter(([, o]) => o.snapshotSizes[0] && (o.snapshotSizes[0][0] < 50 || o.snapshotSizes[0][1] < 50)).length,
    heartbeats: s.heartbeats,
    textFrames: h.text.length,
    closed: h.closed,
  });
  const bad = rows.filter(([, o]) => o.checksumTop10Bad > 0).map(([ch, o]) => `${ch} bad ${o.checksumTop10Bad} ok ${o.checksumTop10Ok}`);
  log('batch_checksum_bad', { channels: bad.length, rows: bad.slice(0, 10) });
  const firstBadMs = rows.filter(([, o]) => o.firstBad).map(([, o]) => o.firstBad.atMs);
  const firstBadDelta = rows.filter(([, o]) => o.firstBad).map(([, o]) => o.firstBad.delta);
  log('batch_first_bad', { atMs: { min: pct(firstBadMs, 0), median: pct(firstBadMs, 0.5), max: pct(firstBadMs, 1) }, deltaIndex: { min: pct(firstBadDelta, 0), median: pct(firstBadDelta, 0.5), max: pct(firstBadDelta, 1) }, onSnapshot: rows.filter(([, o]) => o.firstBad?.event === 'OrderBookSnapshot').map(([ch, o]) => `${ch} ${JSON.stringify(o.snapshotSizes[0])}`) });
  const lagMs = h.frames.map((f) => f.at - f.m.Time).filter((x) => Number.isFinite(x));
  log('batch_age_ms', { min: pct(lagMs, 0), median: pct(lagMs, 0.5), p99: pct(lagMs, 0.99), max: pct(lagMs, 1) });
  const quiet = rows.map(([ch, o]) => [ch, o.deltas]).sort((a, b) => a[1] - b[1]);
  log('batch_quietest', { rows: quiet.slice(0, 8).map((r) => r.join(' ')), busiest: quiet.slice(-5).map((r) => r.join(' ')) });
  const byQuote = {};
  for (const [ch, o] of rows) {
    const q = ch.split('/')[3];
    byQuote[q] = (byQuote[q] ?? 0) + o.deltas;
  }
  log('batch_deltas_by_quote', byQuote);
  h.ws.terminate();
}

async function silence() {
  const cases = [
    ['no-subscription', `${WS}/orderbook/10`, null],
    ['quiet-no-client-frame', `${WS}/orderbook/10?subscribe=audm-aud`, null],
    ['quiet-protocol-ping-20s', `${WS}/orderbook/10?subscribe=audx-aud`, 20_000],
  ];
  const hs = await Promise.all(cases.map(([n, u]) => open(u, `s-${n}.txt`)));
  const pongs = hs.map(() => []);
  hs.forEach((h, i) => {
    h.ws.on('pong', () => pongs[i].push(Date.now() - h.t0));
    const every = cases[i][2];
    if (every) {
      const timer = setInterval(() => h.ws.readyState === WebSocket.OPEN && h.ws.ping(), every);
      timer.unref();
    }
  });
  const end = Date.now() + 125_000;
  while (Date.now() < end && hs.some((h) => !h.closed)) await sleep(500);
  hs.forEach((h, i) => {
    const s = channelStats(h, 10);
    const book = Object.values(s.out)[0];
    log('silence', {
      case: cases[i][0],
      openMs: h.openMs,
      heldS: Math.round((Date.now() - h.t0) / 1000),
      closed: h.closed,
      heartbeats: s.heartbeats,
      heartbeatGapMs: s.heartbeatGapMs,
      bookFrames: book ? book.snapshots + book.deltas : 0,
      bookMaxGapMs: book?.maxGapMs ?? null,
      maxAnyFrameGapMs: Math.max(0, ...h.frames.slice(1).map((f, j) => f.at - h.frames[j].at)),
      serverPings: h.pings,
      pongsAtMs: pongs[i].slice(0, 7),
    });
    h.ws.terminate();
  });
}

const mode = process.argv[2] ?? 'book';
const run = { book, errors, batch, silence }[mode];
if (!run) {
  console.error('mode must be book, errors, batch or silence');
  process.exit(1);
}
await run();
process.exit(0);
