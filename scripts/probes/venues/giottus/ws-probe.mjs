// Giottus futures socket probe: the undocumented Socket.IO feed behind www.giottus.com/futures, compared against Binance USD-M on the same symbol.
// Giottus publishes no WebSocket in its API reference, so this reads the socket its own web page opens, and a feed would depend on an internal interface.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/giottus/ws-probe.mjs [book|session]
//   book     /futures namespace for 75 s, one socket per pair on BTC/USDT, BTC/INR and an unknown pair, beside Binance btcusdt bookTicker and depth20@100ms and a 1 s premiumIndex poll.
//            At 40 s the BTC/INR socket asks for ETH/INR as well, to see whether a second init2 adds or replaces.
//   session  one socket that answers Engine.IO pings and one that does not, for 60 s, plus one handshake that offers permessage-deflate.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/giottus/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const GIOTTUS_URL = 'wss://socket.giottus.com/socket.io/?EIO=4&transport=websocket';
const NAMESPACE = '/futures';
const ORIGIN = 'https://www.giottus.com';
const BINANCE_URL = 'wss://fstream.binance.com/stream?streams=btcusdt@bookTicker/btcusdt@depth20@100ms';
const BINANCE_MARK_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'; // polled each second, since the markPrice stream stayed silent here
const INR_PER_USDT = 104; // active_conversion_factors.INR.usdt_price on the futures page, see rest-probe.mjs futures
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function stats(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

// Engine.IO v4 text packets: 0 open, 2 ping, 3 pong, 40 namespace connect, 42 event, 43 ack, 44 connect error.
function parsePacket(s) {
  const type = s.slice(0, s[0] === '4' ? 2 : 1);
  let rest = s.slice(type.length);
  let nsp = '/';
  if (rest.startsWith('/')) {
    const comma = rest.indexOf(',');
    nsp = rest.slice(0, comma);
    rest = rest.slice(comma + 1);
  }
  const idMatch = rest.match(/^(\d+)/);
  const ackId = idMatch ? Number(idMatch[1]) : undefined;
  if (idMatch) rest = rest.slice(idMatch[1].length);
  let data;
  try {
    data = rest ? JSON.parse(rest) : undefined;
  } catch {
    data = rest;
  }
  return { type, nsp, ackId, data };
}

function openGiottus(label, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(GIOTTUS_URL, {
    perMessageDeflate: opts.deflate ?? false,
    headers: opts.noOrigin ? {} : { Origin: ORIGIN },
  });
  ws.on('upgrade', (res) =>
    log('upgrade', { label, status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null, cfRay: res.headers['cf-ray'] }),
  );
  ws.on('unexpected-response', (_req, res) => log('refused', { label, status: res.statusCode }));
  ws.on('open', () => log('open', { label, ms: Date.now() - t0 }));
  ws.on('error', (e) => log('error', { label, message: e.message }));
  return { ws, t0 };
}

const priceOf = (s) => Number(String(s).split(' ')[0]);
const key = (x) => Number(x).toFixed(8); // INR prices divided by 104 are compared after rounding, not bit for bit

async function book() {
  const binance = { tops: [], depths: [], marks: [] };
  const bws = new WebSocket(BINANCE_URL, { perMessageDeflate: false });
  bws.on('message', (buf) => {
    const now = Date.now();
    const m = JSON.parse(buf.toString());
    const d = m.data;
    if (m.stream.endsWith('@bookTicker')) binance.tops.push({ now, b: Number(d.b), a: Number(d.a), T: d.T });
    else if (m.stream.includes('@depth')) binance.depths.push({ now, bids: d.b, asks: d.a, T: d.T });
    if (binance.depths.length > 1000) binance.depths.shift();
    if (binance.tops.length > 100000) binance.tops.shift(); // a busy book sends several hundred tops a second
  });
  await new Promise((r) => bws.once('open', r));

  let polling = true;
  (async () => {
    while (polling) {
      const t = Date.now();
      try {
        const d = await (await fetch(BINANCE_MARK_URL)).json();
        binance.marks.push({ now: Date.now(), p: d.markPrice, i: d.indexPrice, r: d.lastFundingRate, T: d.nextFundingTime, E: d.time, s: d.estimatedSettlePrice });
      } catch {}
      await sleep(Math.max(0, 1000 - (Date.now() - t)));
    }
  })();

  const pairs = ['BTC/USDT', 'BTC/INR'];
  const books = { 'BTC/USDT': [], 'BTC/INR': [], 'ETH/INR': [], 'NOPE/USDT': [] };
  const marks = [];
  const counts = {};
  const sockets = {};
  let bytes = 0;
  let pings = 0;
  let firstEventAt = null;
  const t0 = Date.now();
  const firstFrames = new Set();
  const ackAt = {};
  const subscribe = (ws, pair) => {
    const sentAt = Date.now();
    ws.once('ack', (s) => {
      ackAt[pair] = Date.now();
      log('ack', { pair, ms: Date.now() - sentAt, raw: s.slice(0, 120) });
    });
    ws.send(`42${NAMESPACE},0${JSON.stringify(['init2', JSON.stringify({ coinpair: pair })])}`);
  };
  for (const pair of [...pairs, 'NOPE/USDT']) {
    const { ws, t0: s0 } = openGiottus(pair);
    sockets[pair] = ws;
    const primary = pair === 'BTC/USDT';
    ws.on('message', (buf) => {
      const now = Date.now();
      const s = buf.toString();
      const p = parsePacket(s);
      if (p.type === '0') {
        if (primary) log('handshake', { ...p.data, ms: now - s0 });
        ws.send(`40${NAMESPACE},`);
        return;
      }
      if (p.type === '2') {
        if (primary) pings++;
        ws.send('3');
        return;
      }
      if (p.type === '40') {
        if (primary) log('namespace', { data: p.data, ms: now - s0 });
        subscribe(ws, pair);
        return;
      }
      if (p.type === '43') {
        ws.emit('ack', s);
        capture('ack.txt', s);
        return;
      }
      if (p.type !== '42') {
        log('other', { pair, raw: s.slice(0, 200) });
        return;
      }
      const [event, payload] = p.data;
      if (event.startsWith('futurestopbidask_')) {
        const bp = event.slice('futurestopbidask_'.length);
        books[bp]?.push({ now, b: JSON.parse(payload), socket: pair });
      }
      if (!firstFrames.has(event)) {
        firstFrames.add(event);
        capture('first-frames.txt', s);
      }
      if (!primary) {
        if (!event.startsWith('futurestopbidask_') && !event.startsWith('futurestradehistory_') && event !== 'tickerdata' && event !== 'markprice' && event !== 'connection') log('other_event', { pair, event });
        return;
      }
      bytes += buf.length;
      counts[event] = (counts[event] || 0) + 1;
      firstEventAt ??= now;
      if (event === 'markprice') {
        const m = JSON.parse(payload);
        if (m.symbol === 'BTC/USDT' || m.symbol === 'BTC/INR') marks.push({ now, ...m });
      }
    });
  }
  setTimeout(() => subscribe(sockets['BTC/INR'], 'ETH/INR'), 40_000);
  const switchAt = t0 + 40_000;

  await sleep(75_000);
  const secs = (Date.now() - (firstEventAt ?? t0)) / 1000;
  polling = false;
  for (const w of Object.values(sockets)) w.terminate();
  bws.terminate();

  log('event_counts', { secs: Math.round(secs), counts, bytesPerSec: Math.round(bytes / secs), pings });
  log('unknown_pair', { bookFrames: books['NOPE/USDT'].length });
  const inrBefore = books['BTC/INR'].filter((f) => f.now < switchAt).length;
  const inrAfter = books['BTC/INR'].filter((f) => f.now >= switchAt + 3000).length;
  const ethInr = books['ETH/INR'].length;
  log('second_init2', { btcInrFramesBefore40s: inrBefore, btcInrFramesAfter43s: inrAfter, ethInrFrames: ethInr });

  for (const pair of pairs) {
    const frames = books[pair];
    const scale = pair.endsWith('/INR') ? INR_PER_USDT : 1;
    const gaps = frames.slice(1).map((f, i) => f.now - frames[i].now);
    const levelCounts = frames.map((f) => `${f.b.topbids?.length}/${f.b.topasks?.length}`);
    let bidsDesc = 0;
    let asksAsc = 0;
    let matchCurrentTop = 0;
    let matchSomeTop = 0;
    const lagLower = [];
    const bestDepthAge = [];
    const depthOverlap = [];
    let sizeEqual = 0;
    let sizeCompared = 0;
    let identical = 0;
    for (const [n, f] of frames.entries()) {
      if (n > 0 && JSON.stringify(f.b) === JSON.stringify(frames[n - 1].b)) identical++;
      const bids = f.b.topbids.map((l) => priceOf(l.price));
      const asks = f.b.topasks.map((l) => priceOf(l.price));
      if (bids.every((x, i) => i === 0 || x < bids[i - 1])) bidsDesc++;
      if (asks.every((x, i) => i === 0 || x > asks[i - 1])) asksAsc++;
      const gb = bids[0] / scale;
      const ga = asks[0] / scale;
      const before = binance.tops.filter((t) => t.now <= f.now);
      const cur = before[before.length - 1];
      const near = (x, y) => Math.abs(x - y) < 1e-6 * y;
      if (cur && near(cur.b, gb) && near(cur.a, ga)) matchCurrentTop++;
      for (let k = before.length - 1; k >= 0; k--) {
        if (near(before[k].b, gb) && near(before[k].a, ga)) {
          matchSomeTop++;
          const end = k + 1 < before.length ? before[k + 1].now : f.now;
          lagLower.push(f.now - end);
          break;
        }
      }
      // The Binance depth20 snapshot sharing the most Giottus levels, and how old it was when the Giottus frame arrived.
      const gLevels = new Set([
        ...f.b.topbids.map((l) => `b${key(priceOf(l.price) / scale)}|${priceOf(l.amount)}`),
        ...f.b.topasks.map((l) => `a${key(priceOf(l.price) / scale)}|${priceOf(l.amount)}`),
      ]);
      let best = null;
      for (const d of binance.depths) {
        if (d.now > f.now) continue;
        let hit = 0;
        for (const [px, q] of d.bids) if (gLevels.has(`b${key(px)}|${Number(q)}`)) hit++;
        for (const [px, q] of d.asks) if (gLevels.has(`a${key(px)}|${Number(q)}`)) hit++;
        if (!best || hit > best.hit || (hit === best.hit && d.now > best.now)) best = { hit, now: d.now };
      }
      if (best) {
        bestDepthAge.push(f.now - best.now);
        depthOverlap.push(best.hit);
      }
      const dcur = binance.depths.filter((d) => d.now <= f.now).pop();
      if (dcur) {
        const bq = new Map(dcur.bids.map(([px, q]) => [key(px), Number(q)]));
        for (const l of f.b.topbids.slice(0, 5)) {
          const q = bq.get(key(priceOf(l.price) / scale));
          if (q !== undefined) {
            sizeCompared++;
            if (Math.abs(q - priceOf(l.amount)) < 1e-9) sizeEqual++;
          }
        }
      }
    }
    log('book', {
      pair,
      frames: frames.length,
      firstFrameAfterAckMs: frames[0] ? frames[0].now - ackAt[pair] : null,
      interArrivalMs: stats(gaps),
      levelCounts: [...new Set(levelCounts)],
      identicalToPrevious: identical,
      bidsDescending: bidsDesc,
      asksAscending: asksAsc,
      topEqualsBinanceCurrent: matchCurrentTop,
      topEqualsSomeRecentBinance: matchSomeTop,
      lagLowerBoundMs: stats(lagLower),
      bestDepthSnapshotAgeMs: stats(bestDepthAge),
      levelsSharedWithBestSnapshot: stats(depthOverlap),
      sizeEqualToBinanceAtPrice: `${sizeEqual}/${sizeCompared}`,
      firstFrameKeys: frames[0] ? Object.keys(frames[0].b) : null,
      firstLevel: frames[0] ? frames[0].b.topbids[0] : null,
    });
  }

  for (const sym of ['BTC/USDT', 'BTC/INR']) {
    const ms = marks.filter((m) => m.symbol === sym);
    const scale = sym.endsWith('/INR') ? INR_PER_USDT : 1;
    const gaps = ms.slice(1).map((m, i) => m.now - ms[i].now);
    let changed = 0;
    let markMatches = 0;
    let indexMatches = 0;
    let rateMatches = 0;
    let nextMatches = 0;
    let settleMatches = 0;
    const lags = []; // against the first Binance poll showing this mark, an upper bound
    const lagsLatest = []; // against the last such poll stamped before arrival, a lower bound
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (i > 0 && m.mark_price !== ms[i - 1].mark_price) changed++;
      const mark = Number(m.mark_price) / scale;
      const same = binance.marks.filter((b) => b.now > m.now - 10_000 && b.now < m.now + 3_000 && Math.abs(Number(b.p) - mark) < 1e-6 * mark);
      const hit = same[0];
      if (hit) {
        markMatches++;
        lags.push(m.now - hit.E);
        const latest = same.filter((b) => b.E <= m.now).pop();
        if (latest) lagsLatest.push(m.now - latest.E);
        if (Math.abs(Number(hit.s) - Number(m.settle_price) / scale) < 1e-6 * mark) settleMatches++;
        if (Math.abs(Number(hit.i) - Number(m.index_price) / scale) < 1e-6 * mark) indexMatches++;
        if (Number(hit.r) === Number(m.funding_rate)) rateMatches++;
        if (Number(hit.T) === Number(m.next_funding_time)) nextMatches++;
      }
    }
    log('markprice', {
      symbol: sym,
      frames: ms.length,
      interArrivalMs: stats(gaps),
      markChanged: changed,
      markEqualsABinanceMark: markMatches,
      indexEqualsThatBinanceIndex: indexMatches,
      rateEqual: rateMatches,
      nextFundingEqual: nextMatches,
      settleEqualsEstimatedSettlePrice: settleMatches,
      arrivalMinusFirstBinanceMarkTimeMs: stats(lags),
      arrivalMinusLastBinanceMarkTimeMs: stats(lagsLatest),
      etsAgeMs: stats(ms.map((m) => m.now - m.ets * 1000)),
      sample: ms[0] ? { ...ms[0], now: undefined } : null,
    });
  }
  log('binance', { tops: binance.tops.length, marks: binance.marks.length, depthsKept: binance.depths.length });
}

async function session() {
  // A socket that answers pings, a socket that never answers them, and a deflate offer.
  const results = {};
  const run = (label, answer) =>
    new Promise((resolve) => {
      const { ws, t0 } = openGiottus(label);
      const pingsAt = [];
      let handshake = null;
      ws.on('message', (buf) => {
        const s = buf.toString();
        if (s[0] === '0') {
          handshake = JSON.parse(s.slice(1));
          ws.send(`40${NAMESPACE},`);
        } else if (s === '2') {
          pingsAt.push(Date.now() - t0);
          if (answer) ws.send('3');
        }
      });
      ws.on('close', (code, reason) => {
        if (!results[label]) results[label] = { closedAtMs: Date.now() - t0, code, reason: reason.toString(), pingsAt, handshake };
        resolve();
      });
      setTimeout(() => {
        if (!results[label]) {
          results[label] = { stillOpenAtMs: Date.now() - t0, closedBy: 'probe', pingsAt, handshake };
          ws.terminate();
        }
      }, 60_000);
    });
  const deflate = new Promise((resolve) => {
    const { ws } = openGiottus('deflate', { deflate: true });
    ws.on('open', () => {
      log('deflate', { negotiated: ws.extensions || '(none)' });
      ws.terminate();
      resolve();
    });
    ws.on('error', resolve);
  });
  const noOrigin = new Promise((resolve) => {
    const { ws } = openGiottus('no-origin', { noOrigin: true });
    ws.on('message', (buf) => {
      const s = buf.toString();
      if (s[0] === '0') ws.send(`40${NAMESPACE},`);
      else if (s.startsWith('40')) {
        log('no_origin', { reply: s.slice(0, 120) });
        ws.terminate();
        resolve();
      }
    });
    ws.on('error', resolve);
    setTimeout(resolve, 10_000);
  });
  await Promise.all([run('answers-pings', true), run('silent', false), deflate, noOrigin]);
  for (const [label, r] of Object.entries(results)) log('session', { label, ...r });
}

const mode = process.argv[2] ?? 'book';
if (mode === 'book') await book();
else if (mode === 'session') await session();
else console.error('mode must be book or session');
process.exit(0);
