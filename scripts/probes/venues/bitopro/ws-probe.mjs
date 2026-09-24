// BitoPro WebSocket probe: the spot order book stream, its cadence and level order, what every frame carries, the timestamp fields,
// a REST book compare, the ticker and trade streams, the replies to wrong pairs, limits and paths, every pair on one socket,
// the server ping, what the server tolerates from a silent client, and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitopro/ws-probe.mjs [book|errors|batch|session|deflate] [seconds]
//   book     order-books at limit 20 for four pairs on one query URL for 60 s, a REST book compare every 15 s, then tickers and trades for 10 s each. About 90 s.
//   errors   one short socket per wrong pair, limit, path or client frame. About 80 s.
//   batch    every catalog pair at limit 20 on one query URL for 60 s, or the seconds given.
//   session  three sockets that differ in pair activity and whether they answer the server ping, for up to 120 s, or the seconds given.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 4 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/bitopro/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS = 'wss://stream.bitopro.com:443/ws/v1/pub';
const API = 'https://api.bitopro.com/v3';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const round = (x) => Math.round(x);
const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: pct(xs, 0), med: pct(xs, 50), p90: pct(xs, 90), max: pct(xs, 100) });
const captured = {};

// Keeps the first three frames of each kind, trimmed to 700 characters.
function capture(kind, text) {
  if (!OUT) return;
  captured[kind] = (captured[kind] ?? 0) + 1;
  if (captured[kind] > 3) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, 'frames.txt'), `${kind}\t${text.slice(0, 700)}\n`);
}

// Opens a socket and records the handshake, pings, frames and close, without throwing.
function watch(url, opts = {}) {
  const t0 = performance.now();
  const s = { url, openMs: null, handshake: null, pings: [], frames: [], close: null, error: null };
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false, autoPong: opts.autoPong ?? true });
  s.ws = ws;
  ws.on('upgrade', (res) => {
    s.extensions = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
      s.handshake = { status: res.statusCode, body: body.slice(0, 200) };
    });
  });
  ws.on('open', () => (s.openMs = round(performance.now() - t0)));
  ws.on('ping', () => s.pings.push(round(performance.now() - t0)));
  ws.on('message', (d, isBinary) => {
    const at = performance.now();
    const text = d.toString('utf8');
    s.frames.push({ at: round(at - t0), wall: Date.now(), bytes: d.length, isBinary, text });
    opts.onFrame?.(text, at, s);
  });
  ws.on('close', (code, reason) => (s.close = { code, reason: reason.toString(), atMs: round(performance.now() - t0) }));
  ws.on('error', (e) => (s.error = e.message));
  return s;
}

function end(s) {
  try {
    s.ws.terminate();
  } catch {
    // already closed
  }
}

function ordered(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price);
    const b = Number(levels[i].price);
    if (dir === 'desc' ? b >= a : b <= a) return false;
  }
  return true;
}

function cumulative(levels) {
  let sum = 0;
  for (const l of levels) {
    sum += Number(l.amount);
    if (Math.abs(sum - Number(l.total)) > 1e-9 * Math.max(1, sum)) return false;
  }
  return true;
}

// Per pair tallies over the order book frames of one socket.
function bookTally() {
  const per = new Map();
  return {
    per,
    add(text, at) {
      let f;
      try {
        f = JSON.parse(text);
      } catch {
        return;
      }
      if (f.event !== 'ORDER_BOOK') return;
      let p = per.get(f.pair);
      if (!p) {
        p = { frames: 0, gaps: [], lastAt: null, lastBook: null, repeats: 0, topChanged: 0, lastTop: null, bids: [], asks: [], badOrder: 0, firstTotalCumulative: null, crossed: 0, lagMs: [], dtOffsetH: new Set(), keys: new Set(), limits: new Set(), scales: new Set(), ids: new Set(), dupIds: 0, emptySide: 0, last: null, firstAt: at, firstDecimals: null, laterDecimals: 0, zeroAmount: 0 };
        per.set(f.pair, p);
      }
      p.frames++;
      if (p.lastAt !== null) p.gaps.push(round(at - p.lastAt));
      p.lastAt = at;
      const book = JSON.stringify([f.bids, f.asks]);
      if (book === p.lastBook) p.repeats++;
      p.lastBook = book;
      const top = `${f.bids[0]?.price}/${f.bids[0]?.amount}/${f.asks[0]?.price}/${f.asks[0]?.amount}`;
      if (p.lastTop !== null && top !== p.lastTop) p.topChanged++;
      p.lastTop = top;
      p.bids.push(f.bids.length);
      p.asks.push(f.asks.length);
      if (f.bids.length === 0 || f.asks.length === 0) p.emptySide++;
      if (!ordered(f.bids, 'desc') || !ordered(f.asks, 'asc')) p.badOrder++;
      // The first frame carries exact amounts and later frames round them, so only the first can be checked for a running total.
      const decimals = Math.max(0, ...[...f.bids, ...f.asks].map((l) => (l.amount.split('.')[1] ?? '').length));
      if (p.frames === 1) {
        p.firstDecimals = decimals;
        p.firstTotalCumulative = cumulative(f.bids) && cumulative(f.asks);
      } else {
        p.laterDecimals = Math.max(p.laterDecimals, decimals);
      }
      p.zeroAmount += [...f.bids, ...f.asks].filter((l) => Number(l.amount) === 0).length;
      if (f.bids.length && f.asks.length && Number(f.bids[0].price) >= Number(f.asks[0].price)) p.crossed++;
      p.lagMs.push(Date.now() - f.timestamp);
      p.dtOffsetH.add(Math.round((Date.parse(f.datetime) - f.timestamp) / 3_600_000));
      Object.keys(f).forEach((k) => p.keys.add(k));
      p.limits.add(f.limit);
      p.scales.add(f.scale);
      if (p.ids.has(f.eventID)) p.dupIds++;
      p.ids.add(f.eventID);
      p.last = { f, at: Date.now() };
    },
    summary(pair) {
      const p = per.get(pair);
      if (!p) return { pair, frames: 0 };
      return {
        pair,
        frames: p.frames,
        gapMs: stats(p.gaps),
        repeats: p.repeats,
        topChanged: p.topChanged,
        bidLevels: [pct(p.bids, 0), pct(p.bids, 100)],
        askLevels: [pct(p.asks, 0), pct(p.asks, 100)],
        emptySide: p.emptySide,
        badOrder: p.badOrder,
        firstTotalCumulative: p.firstTotalCumulative,
        amountDecimals: { first: p.firstDecimals, laterMax: p.laterDecimals },
        zeroAmountLevels: p.zeroAmount,
        gapsOn200msGrid: p.gaps.filter((g) => Math.abs(g - 200 * Math.round(g / 200)) <= 25).length,
        crossed: p.crossed,
        lagMs: stats(p.lagMs),
        datetimeMinusTimestampHours: [...p.dtOffsetH],
        keys: [...p.keys],
        limits: [...p.limits],
        scales: [...p.scales],
        dupEventIds: p.dupIds,
      };
    },
  };
}

async function restBook(pair, limit) {
  const t0 = Date.now();
  const res = await fetch(`${API}/order-book/${pair.toLowerCase()}?limit=${limit}`);
  const body = await res.json();
  return { body, at: Date.now(), ms: Date.now() - t0 };
}

// Matches levels by price, since later frames round amounts to the pair's amountPrecision and the REST book does not.
function compare(ws, rest, precision) {
  const out = { pricesBoth: 0, amountExact: 0, amountEqualAfterRounding: 0, amountDiffers: 0, wsOnlyPrices: 0, restOnlyPrices: 0 };
  for (const side of ['bids', 'asks']) {
    const deepest = side === 'bids' ? Math.max(Number(ws[side].at(-1).price), Number(rest[side].at(-1).price)) : Math.min(Number(ws[side].at(-1).price), Number(rest[side].at(-1).price));
    const inside = (l) => (side === 'bids' ? Number(l.price) >= deepest : Number(l.price) <= deepest);
    const restBy = new Map(rest[side].filter(inside).map((l) => [Number(l.price), l.amount]));
    const wsBy = new Map(ws[side].filter(inside).map((l) => [Number(l.price), l.amount]));
    for (const [price, amount] of wsBy) {
      if (!restBy.has(price)) {
        out.wsOnlyPrices++;
        continue;
      }
      out.pricesBoth++;
      const r = restBy.get(price);
      if (Number(r) === Number(amount)) out.amountExact++;
      else if (Number(Number(r).toFixed(precision)) === Number(amount)) out.amountEqualAfterRounding++;
      else out.amountDiffers++;
    }
    for (const price of restBy.keys()) if (!wsBy.has(price)) out.restOnlyPrices++;
  }
  return out;
}

async function book() {
  const pairs = ['BTC_USDT', 'ETH_USDT', 'USDT_TWD', 'TON_USDT'];
  const catalog = (await (await fetch(`${API}/provisioning/trading-pairs`)).json()).data;
  const precision = Number(catalog.find((r) => r.pair === 'btc_usdt').amountPrecision);
  const tally = bookTally();
  const url = `${WS}/order-books?pairs=${pairs.map((p) => `${p}:20`).join(',')}`;
  const kept = [];
  const s = watch(url, { onFrame: (text, at) => {
    tally.add(text, at);
    capture('book', text);
    if (kept.length < 2 && text.includes('"pair":"BTC_USDT"')) kept.push(text);
  } });
  for (let i = 0; i < 4; i++) {
    await sleep(15_000);
    const lastWs = tally.per.get('BTC_USDT')?.last;
    const rest = await restBook('BTC_USDT', 20);
    if (lastWs) {
      log('rest_compare', { pair: 'BTC_USDT', amountPrecision: precision, ...compare(lastWs.f, rest.body, precision), wsFrameAgeMs: rest.at - lastWs.at, restMs: rest.ms, wsBest: [lastWs.f.bids[0]?.price, lastWs.f.asks[0]?.price], restBest: [rest.body.bids[0]?.price, rest.body.asks[0]?.price] });
    }
  }
  end(s);
  log('book_socket', { url, openMs: s.openMs, handshake: s.handshake, close: s.close, error: s.error, frames: s.frames.length, binary: s.frames.filter((f) => f.isBinary).length, pings: s.pings.length, pingGapMs: stats(s.pings.slice(1).map((t, i) => t - s.pings[i])), firstFrameMs: s.frames[0]?.at - s.openMs });
  for (const p of pairs) log('book_pair', tally.summary(p));
  // The first frame after the handshake and the one after it, three levels a side, as the profile quotes them.
  for (const [i, text] of kept.entries()) {
    const f = JSON.parse(text);
    log(i === 0 ? 'frame_first' : 'frame_later', { frame: JSON.stringify({ ...f, bids: f.bids.slice(0, 3), asks: f.asks.slice(0, 3) }) });
  }
  const first = tally.per.get('BTC_USDT')?.last?.f;
  if (first) log('size_unit', { pair: 'BTC_USDT', bestBid: first.bids[0], bestAsk: first.asks[0] });

  for (const stream of ['tickers/BTC_USDT', 'trades/BTC_USDT', `tickers?pairs=BTC_USDT,USDT_TWD`]) {
    const t = watch(`${WS}/${stream}`, { onFrame: (text) => capture(stream, text) });
    await sleep(10_000);
    end(t);
    log('stream', { stream, openMs: t.openMs, handshake: t.handshake, frames: t.frames.length, pings: t.pings.length, first: t.frames[0]?.text.slice(0, 500), events: [...new Set(t.frames.map((f) => f.text.slice(0, 40)))].slice(0, 3) });
  }
}

async function errors() {
  const cases = [
    ['unknown pair', 'order-books/NOPE_USDT:20'],
    ['lowercase pair', 'order-books/btc_usdt:20'],
    ['limit 30', 'order-books/BTC_USDT:30'],
    ['limit 50', 'order-books/BTC_USDT:50'],
    ['limit 100', 'order-books/BTC_USDT:100'],
    ['limit 7', 'order-books/BTC_USDT:7'],
    ['no limit', 'order-books/BTC_USDT'],
    ['two pairs in path', 'order-books/BTC_USDT:20,ETH_USDT:20'],
    ['one good one unknown', 'order-books?pairs=BTC_USDT:20,NOPE_USDT:20'],
    ['no pair', 'order-books'],
    ['unknown path', 'nope/BTC_USDT'],
    ['closed-looking pair ETH_BTC', 'order-books/ETH_BTC:20'],
  ];
  for (const [name, path] of cases) {
    const s = watch(`${WS}/${path}`);
    await sleep(5_000);
    end(s);
    const pairsSeen = new Set();
    const limits = new Set();
    let levels = null;
    for (const f of s.frames) {
      try {
        const j = JSON.parse(f.text);
        pairsSeen.add(j.pair);
        limits.add(j.limit);
        levels = [j.bids?.length, j.asks?.length];
      } catch {
        pairsSeen.add('not json');
      }
    }
    log('case', { name, path, openMs: s.openMs, handshake: s.handshake, close: s.close, error: s.error, frames: s.frames.length, pairs: [...pairsSeen], limits: [...limits], lastLevels: levels, first: s.frames[0]?.text.slice(0, 160) });
    await sleep(300);
  }

  // Text the client sends after the handshake, which the documentation never mentions.
  for (const text of ['hello', JSON.stringify({ action: 'subscribe', channel: 'order-books', pairs: ['ETH_USDT'] }), 'ping']) {
    const s = watch(`${WS}/order-books/TON_USDT:1`);
    await sleep(1_500);
    const before = s.frames.length;
    try {
      s.ws.send(text);
    } catch (e) {
      s.error = e.message;
    }
    await sleep(4_000);
    end(s);
    const after = s.frames.slice(before).map((f) => f.text.slice(0, 120));
    log('client_text', { sent: text, framesBefore: before, framesAfter: after.length, nonBook: after.filter((t) => !t.includes('ORDER_BOOK')).slice(0, 3), close: s.close, error: s.error });
  }
}

async function batch() {
  const res = await fetch(`${API}/provisioning/trading-pairs`);
  const catalog = (await res.json()).data;
  const pairs = catalog.map((r) => r.pair.toUpperCase());
  const amountPrecision = new Map(catalog.map((r) => [r.pair.toUpperCase(), Number(r.amountPrecision)]));
  const url = `${WS}/order-books?pairs=${pairs.map((p) => `${p}:20`).join(',')}`;
  const tally = bookTally();
  let parseUs = [];
  const s = watch(url, { onFrame: (text, at) => {
    const t0 = performance.now();
    JSON.parse(text);
    parseUs.push((performance.now() - t0) * 1000);
    tally.add(text, at);
  } });
  await sleep(SECONDS * 1000);
  end(s);
  const openAt = s.openMs ?? 0;
  const perSecond = new Map();
  let bytes = 0;
  for (const f of s.frames) {
    const sec = Math.floor((f.at - openAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    bytes += f.bytes;
  }
  const rates = [...perSecond.values()];
  const firstFrame = [...tally.per.values()].map((p) => round(p.firstAt));
  const silent = pairs.filter((p) => !tally.per.has(p));
  const perPair = pairs.map((p) => tally.per.get(p)?.frames ?? 0);
  log('batch', {
    pairs: pairs.length,
    urlLength: url.length,
    openMs: s.openMs,
    handshake: s.handshake,
    close: s.close,
    frames: s.frames.length,
    framesPerSecond: stats(rates),
    seconds: SECONDS,
    bytesPerSecond: round(bytes / SECONDS),
    bytesPerFrame: round(bytes / Math.max(1, s.frames.length)),
    parseUs: stats(parseUs.map((x) => Math.round(x))),
    pairsWithFrames: tally.per.size,
    silent,
    framesPerPair: stats(perPair),
    maxGapPerPairMs: stats([...tally.per.values()].filter((p) => p.gaps.length > 0).map((p) => pct(p.gaps, 100))),
    pairsWithOneFrame: [...tally.per.entries()].filter(([, p]) => p.frames === 1).map(([k]) => k),
    repeatsTotal: [...tally.per.values()].reduce((a, p) => a + p.repeats, 0),
    badOrderTotal: [...tally.per.values()].reduce((a, p) => a + p.badOrder, 0),
    crossedTotal: [...tally.per.values()].reduce((a, p) => a + p.crossed, 0),
    emptySideTotal: [...tally.per.values()].reduce((a, p) => a + p.emptySide, 0),
    zeroAmountLevels: [...tally.per.values()].reduce((a, p) => a + p.zeroAmount, 0),
    firstFrameFinerThanAmountPrecision: [...tally.per.entries()].filter(([k, p]) => p.firstDecimals > amountPrecision.get(k)).length,
    laterWithinAmountPrecision: [...tally.per.entries()].filter(([k, p]) => p.frames > 1 && p.laterDecimals <= amountPrecision.get(k)).length,
    pairsWithLaterFrames: [...tally.per.values()].filter((p) => p.frames > 1).length,
    firstTotalCumulative: [...tally.per.values()].filter((p) => p.firstTotalCumulative).length,
    gapsOn200msGrid: [[...tally.per.values()].reduce((a, p) => a + p.gaps.filter((g) => Math.abs(g - 200 * Math.round(g / 200)) <= 25).length, 0), [...tally.per.values()].reduce((a, p) => a + p.gaps.length, 0)],
    laterDecimalsOverPrecision: [...tally.per.entries()].filter(([k, p]) => p.frames > 1 && p.laterDecimals > amountPrecision.get(k)).map(([k, p]) => `${k}:${p.laterDecimals}>${amountPrecision.get(k)}`),
    firstFrameSpreadMs: [Math.min(...firstFrame), Math.max(...firstFrame)],
    pings: s.pings.length,
  });
  const quiet = pairs.map((p) => ({ p, n: tally.per.get(p)?.frames ?? 0 })).sort((a, b) => a.n - b.n).slice(0, 6);
  const busy = pairs.map((p) => ({ p, n: tally.per.get(p)?.frames ?? 0 })).sort((a, b) => b.n - a.n).slice(0, 6);
  log('batch_extremes', { quiet, busy, lagMs: stats([...tally.per.values()].flatMap((p) => p.lagMs)) });
  parseUs = null;
}

async function session() {
  const sockets = [
    ['busy pair, answers pings', `${WS}/order-books/BTC_USDT:1`, true],
    ['quiet pair, answers pings', `${WS}/order-books/TON_USDT:1`, true],
    ['quiet pair, never answers pings', `${WS}/order-books/TON_USDT:1`, false],
  ];
  const watched = sockets.map(([name, url, autoPong]) => ({ name, s: watch(url, { autoPong }) }));
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000 && watched.some((w) => w.s.close === null)) await sleep(1_000);
  for (const { name, s } of watched) {
    const gaps = s.frames.slice(1).map((f, i) => f.at - s.frames[i].at);
    log('session', {
      name,
      openMs: s.openMs,
      frames: s.frames.length,
      maxFrameGapMs: pct(gaps, 100),
      pings: s.pings.length,
      pingGapMs: stats(s.pings.slice(1).map((t, i) => t - s.pings[i])),
      firstPingMs: s.pings[0] ?? null,
      close: s.close,
      error: s.error,
    });
    end(s);
  }
}

async function deflate() {
  const s = watch(`${WS}/order-books/BTC_USDT:1`, { deflate: true });
  await sleep(4_000);
  end(s);
  log('deflate', { offered: true, negotiated: s.extensions, openMs: s.openMs, frames: s.frames.length });
}

const mode = process.argv[2] ?? 'book';
const SECONDS = Number(process.argv[3] ?? (mode === 'session' ? 120 : 60));
log('start', { mode, at: new Date().toISOString() });
await { book, errors, batch, session, deflate }[mode]();
log('end', { at: new Date().toISOString() });
process.exit(0);
