// HIBT contract WebSocket probe: depth, ticker and index channels, frame cadence and repeats, level order, a REST compare,
// the book against Binance at the same instant, keepalive and silence, errors, every contract on one socket, and compression.
// Public, unauthenticated, read-only, and the Binance streams in mirror are public too. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hibt/ws-probe.mjs [book|mirror|errors|session|batch|deflate]
//   book     20deep on six contracts, 5deep and 10deep on BTC, ticker, index and trade, for 45 s, then a REST depth, mark and index compare.
//   mirror   HIBT btc and eth 20deep and index beside Binance USD-M futures and spot book streams for 40 s: price gap, best lag, shared levels and size ratio.
//   errors   one socket per request: unknown, uppercase and unsupported topics, a bad event, non-JSON text, duplicate and unsubscribe, ping shapes. About 60 s.
//   session  five sockets that differ only in what the client subscribes and sends, for up to 120 s.
//   batch    every listed contract at 20deep on one socket for 30 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/hibt/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://fapi.hibt0.com/v2/ws';
const FAPI = 'https://fapi.hibt0.com/open-api';
const BN_FUT = 'wss://fstream.binance.com/stream?streams=';
const BN_SPOT = 'wss://stream.binance.com:9443/stream?streams=';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (topic) => JSON.stringify({ event: 'sub', topic });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const stats = (xs) => (xs.length ? { n: xs.length, min: Math.min(...xs), median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs) } : { n: 0 });

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  ws.t0 = t0;
  ws.on('error', (e) => log('socket_error', { url, message: e.message }));
  return new Promise((resolve) => {
    ws.on('upgrade', (res) => (ws.negotiated = res.headers['sec-websocket-extensions'] ?? null));
    ws.on('open', () => {
      ws.openMs = Date.now() - t0;
      resolve(ws);
    });
    ws.on('unexpected-response', (_req, res) => {
      log('refused', { url, status: res.statusCode });
      resolve(null);
    });
  });
}

// Flat depth arrays: [price, size, price, size, ...].
const pairs = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) out.push([Number(flat[i]), Number(flat[i + 1])]);
  return out;
};

async function book() {
  const ids = ['btc_usdt', 'eth_usdt', 'shib_usdt', 'unitree_usdt', 'gold', 'crude'];
  const topics = [...ids.map((s) => `${s}.20deep`), 'btc_usdt.5deep', 'btc_usdt.10deep', 'btc_usdt.ticker', 'btc_usdt.index', 'eth_usdt.index', 'gold.index', 'btc_usdt.trade'];
  const ws = await open(URL_WS);
  log('open', { url: URL_WS, ms: ws.openMs });
  const per = new Map();
  const acks = [];
  let lastIndex = new Map();
  let lastBook = new Map();
  let firstSend;
  ws.on('message', (buf, isBinary) => {
    const now = Date.now();
    const text = buf.toString();
    capture('book.jsonl', `${now}\t${text}`);
    const m = JSON.parse(text);
    if (m.type === 'hello' || m.type === 'sub' || m.type === 'unsub') {
      if (m.type === 'sub') acks.push({ ms: now - firstSend, ...m.data });
      if (m.type === 'hello') log('hello', { frame: text, binary: isBinary });
      return;
    }
    const t = m.type;
    const s = (per.get(t) ?? per.set(t, { frames: 0, arr: [], tsGap: [], lagMs: [], repeats: 0, prev: null, levels: [], badOrder: 0, crossed: 0, first: now - firstSend, sci: 0 }).get(t));
    s.frames++;
    s.arr.push(now);
    if (s.lastTs) s.tsGap.push(m.ts - s.lastTs);
    s.lastTs = m.ts;
    s.lagMs.push(now - m.ts);
    const body = JSON.stringify(m.data);
    if (s.prev === body) s.repeats++;
    s.prev = body;
    if (/[0-9]e[-+]/i.test(body)) s.sci++;
    if (t.endsWith('deep')) {
      const b = pairs(m.data.bids);
      const a = pairs(m.data.asks);
      s.levels.push(`${b.length}/${a.length}`);
      if (!b.every((l, i) => i === 0 || l[0] < b[i - 1][0]) || !a.every((l, i) => i === 0 || l[0] > a[i - 1][0])) s.badOrder++;
      if (b.length && a.length && b[0][0] >= a[0][0]) s.crossed++;
      lastBook.set(t, { at: now, b, a });
      (s.tops ??= new Set()).add(`${b[0]?.join('/')}|${a[0]?.join('/')}`);
      if ('allAskAmount' in m.data) s.withTotals = (s.withTotals ?? 0) + 1;
      const idx = lastIndex.get(t.replace(/\.\d+deep$/, '.index'));
      if (idx && b.length && a.length) (s.midVsIndex ??= []).push(Math.round((((b[0][0] + a[0][0]) / 2 - idx.price) / idx.price) * 1e6));
    }
    if (t.endsWith('.index')) lastIndex.set(t, { at: now, price: Number(m.data.price), time: m.data.time });
  });
  firstSend = Date.now();
  for (const t of topics) ws.send(sub(t));
  // Compare the socket index and book with REST during the run.
  const cmp = [];
  for (let i = 0; i < 4; i++) {
    await sleep(10_000);
    const t0 = Date.now();
    const [c, mk, d] = await Promise.all([
      fetch(`${FAPI}/v2/market/contracts?symbol=btc_usdt`).then((r) => r.json()),
      fetch(`${FAPI}/v2/market/index?symbol=btc_usdt`).then((r) => r.json()),
      fetch(`${FAPI}/v2/market/depth?symbol=btc_usdt&limit=20`).then((r) => r.json()),
    ]);
    const at = Date.now();
    const wsIdx = lastIndex.get('btc_usdt.index');
    const wsBook = lastBook.get('btc_usdt.20deep');
    const restIndex = Number(c.data[0].index_price);
    const restMark = Number(mk.data[0].marketPrice);
    const rb = d.data.bid.map((l) => [Number(l[0]), Number(l[1])]);
    const sameLevels = wsBook ? wsBook.b.filter((l, j) => rb[j] && rb[j][0] === l[0] && rb[j][1] === l[1]).length : null;
    cmp.push({
      restMs: at - t0,
      wsIndex: wsIdx?.price,
      restIndex,
      restMark,
      wsIndexVsRestIndexPpm: wsIdx ? Math.round(((wsIdx.price - restIndex) / restIndex) * 1e6) : null,
      wsIndexVsRestMarkPpm: wsIdx ? Math.round(((wsIdx.price - restMark) / restMark) * 1e6) : null,
      restBookTop: [rb[0], d.data.ask[0]],
      wsBookTop: wsBook ? [wsBook.b[0], wsBook.a[0]] : null,
      bidLevelsEqualOf20: sameLevels,
      wsBookAgeMs: wsBook ? at - wsBook.at : null,
    });
  }
  await sleep(5_000);
  ws.close();
  log('acks', { count: acks.length, sample: acks.slice(0, 3), ms: stats(acks.map((a) => a.ms)) });
  for (const [t, s] of per) {
    const gaps = s.arr.slice(1).map((x, i) => x - s.arr[i]);
    const lv = s.levels.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
    log('topic', { topic: t, frames: s.frames, firstAfterSubMs: s.first, arrivalGapMs: stats(gaps), tsGapMs: stats(s.tsGap), arrivalMinusTsMs: stats(s.lagMs), identicalRepeats: s.repeats, sciNotationFrames: s.sci, levels: Object.keys(lv).length ? lv : undefined, badOrder: s.badOrder, crossed: s.crossed, midVsIndexPpm: s.midVsIndex ? stats(s.midVsIndex) : undefined, distinctTops: s.tops?.size, framesWithTotals: s.withTotals });
  }
  log('rest_compare', { rows: cmp });
}

async function mirror() {
  const ids = ['btc', 'eth'];
  const hibt = await open(URL_WS);
  const fut = await open(BN_FUT + ids.map((s) => `${s}usdt@bookTicker/${s}usdt@depth20@100ms`).join('/'));
  const spot = await open(BN_SPOT + ids.map((s) => `${s}usdt@bookTicker`).join('/'));
  log('open', { hibtMs: hibt?.openMs, binanceFutMs: fut?.openMs, binanceSpotMs: spot?.openMs });
  const series = { hibt: {}, hibtIndex: {}, fut: {}, spot: {} };
  const futDepth = {};
  const levelHits = { btc: { levels: 0, pricePresent: 0, sameSize: 0, ratios: [] }, eth: { levels: 0, pricePresent: 0, sameSize: 0, ratios: [] } };
  const spreads = { hibt: { btc: [], eth: [] }, fut: { btc: [], eth: [] } };
  for (const id of ids) for (const k of Object.keys(series)) series[k][id] = [];
  hibt.on('message', (buf) => {
    const now = Date.now();
    const m = JSON.parse(buf.toString());
    if (m.type?.endsWith('.index')) {
      series.hibtIndex[m.type.split('_')[0]].push([now, Number(m.data.price)]);
      return;
    }
    if (!m.type?.endsWith('20deep')) return;
    const id = m.type.split('_')[0];
    const b = pairs(m.data.bids);
    const a = pairs(m.data.asks);
    if (!b.length || !a.length) return;
    series.hibt[id].push([now, (b[0][0] + a[0][0]) / 2]);
    spreads.hibt[id].push(Math.round(((a[0][0] - b[0][0]) / b[0][0]) * 1e6));
    const fd = futDepth[id];
    if (fd) {
      const bn = new Map([...fd.b, ...fd.a].map((l) => [l[0], l[1]]));
      const h = levelHits[id];
      for (const l of [...b, ...a]) {
        h.levels++;
        if (bn.has(l[0])) {
          h.pricePresent++;
          if (bn.get(l[0]) === l[1]) h.sameSize++;
          h.ratios.push(l[1] / bn.get(l[0]));
        }
      }
    }
    capture('mirror-hibt.jsonl', `${now}\t${JSON.stringify({ type: m.type, ts: m.ts, b: b.slice(0, 3), a: a.slice(0, 3) })}`);
  });
  const onBinance = (key) => (buf) => {
    const now = Date.now();
    const m = JSON.parse(buf.toString());
    const id = m.stream.slice(0, 3);
    if (m.stream.endsWith('bookTicker')) {
      const bid = Number(m.data.b);
      const ask = Number(m.data.a);
      series[key][id].push([now, (bid + ask) / 2]);
      if (key === 'fut') spreads.fut[id].push(Math.round(((ask - bid) / bid) * 1e6));
    } else {
      futDepth[id] = { b: m.data.b.map((l) => [Number(l[0]), Number(l[1])]), a: m.data.a.map((l) => [Number(l[0]), Number(l[1])]) };
    }
  };
  fut.on('message', onBinance('fut'));
  spot.on('message', onBinance('spot'));
  for (const t of ['btc_usdt.20deep', 'eth_usdt.20deep', 'btc_usdt.index', 'eth_usdt.index']) hibt.send(sub(t));
  await sleep(40_000);
  for (const w of [hibt, fut, spot]) w.close();

  // Value of a series at time t: the last point at or before t.
  const at = (s, t) => {
    let lo = 0;
    let hi = s.length - 1;
    if (!s.length || s[0][0] > t) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid][0] <= t) lo = mid;
      else hi = mid - 1;
    }
    return s[lo][1];
  };
  for (const id of ids) {
    for (const [what, h] of [['book mid', series.hibt[id]], ['index', series.hibtIndex[id]]])
    for (const ref of ['fut', 'spot']) {
      const r = series[ref][id];
      const gaps = [];
      for (const [t, v] of h) {
        const x = at(r, t);
        if (x) gaps.push(Math.round(((v - x) / x) * 1e6));
      }
      // Best lag: HIBT mid at t against the reference mid at t minus lag.
      const byLag = [];
      for (let lag = 0; lag <= 3000; lag += 50) {
        let sum = 0;
        let n = 0;
        for (const [t, v] of h) {
          const x = at(r, t - lag);
          if (x) {
            sum += Math.abs(((v - x) / x) * 1e6);
            n++;
          }
        }
        byLag.push([lag, n ? sum / n : Infinity]);
      }
      byLag.sort((a, b) => a[1] - b[1]);
      const zero = byLag.find((x) => x[0] === 0);
      log('mirror_mid', { id, hibt: what, ref, hibtFrames: h.length, refUpdates: r.length, midGapPpm: stats(gaps), bestLagMs: byLag[0][0], meanAbsPpmAtBest: Math.round(byLag[0][1] * 10) / 10, meanAbsPpmAtZero: Math.round(zero[1] * 10) / 10 });
    }
    const lh = levelHits[id];
    log('mirror_levels', { id, hibtLevels: lh.levels, priceAlsoInBinanceFutDepth20: lh.pricePresent, sameSizeAsBinance: lh.sameSize, sizeRatio: stats(lh.ratios.map((x) => Math.round(x * 1000) / 1000)) });
    log('spread_ppm', { id, hibt: stats(spreads.hibt[id]), binanceFut: stats(spreads.fut[id]) });
  }
}

async function one(label, frames, waitMs = 4_000, subFirst = null) {
  const ws = await open(URL_WS);
  const got = [];
  let closed = null;
  ws.on('message', (buf) => {
    const t = buf.toString();
    if (!t.includes('"hello"')) got.push(t.slice(0, 220));
  });
  ws.on('close', (code) => (closed = { code, atMs: Date.now() - ws.t0 }));
  if (subFirst) {
    ws.send(sub(subFirst));
    await sleep(1_500);
  }
  const before = got.length;
  const sentAt = Date.now() - ws.t0;
  for (const f of frames) ws.send(f);
  await sleep(waitMs);
  if (ws.readyState === ws.OPEN) ws.close();
  const after = got.slice(before);
  const types = after.reduce((m, t) => {
    const k = t.match(/"type":"([^"]+)"/)?.[1] ?? t.slice(0, 40);
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  log('error_case', { label, sent: frames.map((f) => f.slice(0, 80)), sentAtMs: sentAt, replies: types, firstReply: after.find((t) => !/deep"/.test(t.slice(0, 40))) ?? after[0], closed });
}

async function errors() {
  await one('unknown symbol', [sub('nope_usdt.20deep')]);
  await one('uppercase symbol', [sub('BTC_USDT.20deep')]);
  await one('unsupported depth 50deep', [sub('btc_usdt.50deep')]);
  await one('unsupported depth 15deep', [sub('btc_usdt.15deep')]);
  await one('delisted-looking contract sse_usdt', [sub('sse_usdt.20deep')]);
  await one('event subscribe', [JSON.stringify({ event: 'subscribe', topic: 'btc_usdt.20deep' })]);
  await one('no event key', [JSON.stringify({ op: 'ping' })]);
  await one('non-JSON text', ['ping']);
  await one('event ping', [JSON.stringify({ event: 'ping' })]);
  await one('duplicate sub', [sub('eth_usdt.20deep')], 3_000, 'eth_usdt.20deep');
  await one('unsub', [JSON.stringify({ event: 'unsub', topic: 'eth_usdt.20deep' })], 3_000, 'eth_usdt.20deep');
  await one('array topic', [JSON.stringify({ event: 'sub', topic: ['btc_usdt.20deep', 'eth_usdt.20deep'] })]);
  await one('comma topic', [sub('btc_usdt.20deep,eth_usdt.20deep')]);
}

async function session() {
  const plans = [
    { label: 'nothing', subTopic: null, every: null },
    { label: 'sub busy, silent client', subTopic: 'btc_usdt.20deep', every: null },
    { label: 'sub frozen crude, silent client', subTopic: 'crude.20deep', every: null },
    { label: 'no sub, protocol ping 10 s', subTopic: null, every: 'protocol' },
    { label: 'no sub, event ping 10 s', subTopic: null, every: 'event' },
  ];
  const results = await Promise.all(
    plans.map(async (p) => {
      const ws = await open(URL_WS);
      const r = { label: p.label, frames: 0, serverPings: 0, serverPingAtMs: [], pongs: 0, lastFrameMs: null, closed: null };
      ws.on('message', () => {
        r.frames++;
        r.lastFrameMs = Date.now() - ws.t0;
      });
      ws.on('ping', () => {
        r.serverPings++;
        r.serverPingAtMs.push(Date.now() - ws.t0);
      });
      ws.on('pong', () => r.pongs++);
      if (p.subTopic) ws.send(sub(p.subTopic));
      const timer = p.every
        ? setInterval(() => {
            if (ws.readyState !== ws.OPEN) return;
            if (p.every === 'protocol') ws.ping();
            else ws.send(JSON.stringify({ event: 'ping' }));
          }, 10_000)
        : null;
      await new Promise((resolve) => {
        ws.on('close', (code, reason) => {
          r.closed = { code, reason: reason.toString(), atMs: Date.now() - ws.t0 };
          resolve();
        });
        setTimeout(resolve, 120_000);
      });
      if (timer) clearInterval(timer);
      if (ws.readyState === ws.OPEN) ws.close();
      return r;
    }),
  );
  for (const r of results) log('session', r);
}

async function batch() {
  const res = await fetch(`${FAPI}/v2/market/contracts`).then((r) => r.json());
  const ids = res.data.map((c) => c.ticker_id);
  const ws = await open(URL_WS);
  const per = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let acks = 0;
  const other = [];
  const perSecond = [];
  let secCount = 0;
  const secTimer = setInterval(() => {
    perSecond.push(secCount);
    secCount = 0;
  }, 1000);
  ws.on('message', (buf) => {
    const t0 = process.hrtime.bigint();
    const m = JSON.parse(buf.toString());
    parseNs += process.hrtime.bigint() - t0;
    if (m.type === 'sub') return void acks++;
    if (m.type === 'hello') return;
    if (!m.type?.endsWith('deep')) return void other.push(buf.toString().slice(0, 160));
    frames++;
    secCount++;
    bytes += buf.length;
    per.set(m.type, (per.get(m.type) ?? 0) + 1);
  });
  const sentAt = Date.now();
  for (const id of ids) ws.send(sub(`${id}.20deep`));
  await sleep(30_000);
  clearInterval(secTimer);
  ws.close();
  const counts = ids.map((id) => per.get(`${id}.20deep`) ?? 0);
  log('batch', {
    contracts: ids.length,
    acks,
    silent: ids.filter((id) => !per.get(`${id}.20deep`)),
    framesPerContract: stats(counts),
    framesPerSecond: stats(perSecond.slice(2)),
    bytesPerSecond: Math.round(bytes / ((Date.now() - sentAt) / 1000)),
    bytesPerFrame: Math.round(bytes / frames),
    parseMicrosPerFrame: Math.round(Number(parseNs / BigInt(frames || 1)) / 100) / 10,
    other: other.slice(0, 3),
  });
}

async function deflate() {
  const ws = await open(URL_WS, { deflate: true });
  log('deflate', { offered: true, negotiated: ws.negotiated });
  ws.close();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
await { book, mirror, errors, session, batch, deflate }[mode]();
log('end', { at: new Date().toISOString() });
setTimeout(() => process.exit(0), 500);
