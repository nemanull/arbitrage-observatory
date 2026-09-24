// MGBX futures WebSocket probe: the per-symbol push (book snapshot, per-level deltas, ticker, index, mark), one symbol per socket, control replies, keepalive and silence, a fan-out of sockets, and the market-wide channels.
// MGBX publishes no API documentation, so the URL and request frames are the ones the www.mgbx.com web app sends, read from its JavaScript bundle on 2026-09-22.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate mode that asks for it once.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/mgbx/ws-probe.mjs [book|control|silence|fanout|bulk|mirror|deflate]
//   book     four sockets, one symbol each, for 60 s: snapshot cadence and depth, delta ids, delta replay against the next snapshot, level order, number format.
//   control  one socket: each ping shape, the kline style subscribe, a second symbol, unsubscribe, unknown symbol, then a frame that is not JSON. About 30 s.
//   silence  three sockets for 120 s: no subscription and no client frame, a subscription and no client frame, a subscription with a text ping every 10 s.
//   fanout   30 sockets opened in sequence, one of the 30 busiest symbols each, held 30 s: open time, refusals, total frame rate and parse cost.
//   bulk     sub_tickers and sub_mark_prices for 30 s: cadence and rows.
//   mirror   MGBX snapshots of BTC and ETH against Binance USDT-M bookTicker for 60 s: the delay at which the two touches agree, and crosses at arrival.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/mgbx/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_MARKET = 'wss://www.mgbx.com/ws/market';
const REST = 'https://www.mgbx.com/futures/fapi/market/v1/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const stats = (arr) => (arr.length ? { n: arr.length, min: Math.min(...arr), median: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) } : { n: 0 });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Opens a socket and resolves once it is open or failed; every frame goes to onFrame with its arrival time.
function open(url, onFrame, opts = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false, handshakeTimeout: 6_000 });
    const info = { ws, t0, openMs: null, closed: null, refused: null, extensions: null };
    ws.on('upgrade', (res) => (info.extensions = res.headers['sec-websocket-extensions'] ?? null));
    ws.on('open', () => {
      info.openMs = Date.now() - t0;
      resolve(info);
    });
    ws.on('unexpected-response', (_req, res) => {
      info.refused = res.statusCode;
      resolve(info);
    });
    ws.on('error', (e) => {
      info.error = e.message;
      resolve(info);
    });
    ws.on('close', (code, reason) => (info.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }));
    ws.on('ping', () => (info.protocolPings = (info.protocolPings ?? 0) + 1));
    ws.on('message', (data, isBinary) => onFrame(data, isBinary, Date.now()));
  });
}

// A fresh connection to this host hangs about a third of the time, so every open is tried up to three times.
async function openRetry(url, onFrame, opts = {}) {
  let info;
  for (let tries = 1; tries <= 3; tries++) {
    info = await open(url, onFrame, opts);
    info.tries = tries;
    if (info.openMs !== null) return info;
    info.ws.terminate();
  }
  return info;
}

const send = (ws, obj) => ws.readyState === ws.OPEN && ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));

async function restJson(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${REST}/${path}`, { signal: AbortSignal.timeout(5000) });
      return await r.json();
    } catch {}
  }
  return null;
}

// Book state from push.deep.full, with push.deep applied by price, for the replay check.
class Book {
  constructor() {
    this.bids = new Map();
    this.asks = new Map();
  }
  reset(full) {
    this.bids = new Map(full.b.map(([p, q]) => [p, q]));
    this.asks = new Map(full.a.map(([p, q]) => [p, q]));
  }
  apply(d) {
    const side = d.ba === 1 ? this.bids : this.asks;
    if (Number(d.q) === 0) side.delete(d.p);
    else side.set(d.p, d.q);
  }
  top(n) {
    const b = [...this.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
    const a = [...this.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
    return { b, a };
  }
}

async function book() {
  const agg = await restJson('q/agg-tickers');
  const byAmount = (agg?.data ?? []).filter((x) => !/^(btc|eth|xau)_/.test(x.s)).sort((x, y) => Number(x.v) - Number(y.v));
  const quiet = byAmount[Math.floor(byAmount.length * 0.1)]?.s ?? 'lsk_usdt';
  const symbols = ['btc_usdt', 'eth_usdt', quiet, 'xau_usdt'];
  const list = await restJson('symbol/list');
  const cs = new Map((list?.data ?? []).map((x) => [x.symbol, x.contractSize]));
  log('symbols', { symbols, quietVolumeUsdt: byAmount[Math.floor(byAmount.length * 0.1)]?.v });
  const per = new Map();
  const sockets = [];
  for (const s of symbols) {
    const st = { s, counts: {}, fullGaps: [], lastFullAt: null, firstFullMs: null, fullLevels: [], idStep: [], idBackwards: 0, deepBeforeFull: 0, deepStale: 0, fullOrderBad: 0, crossedFull: 0, sci: 0, sizeKinds: {}, replay: { compared: 0, top20Equal: 0, touchEqual: 0, firstDiffRank: [], priceDiffs: [] }, book: new Book(), fullId: null, lastDeepId: null, lastDeepAt: null, maxQuietMs: 0, lastBookFrameAt: null, ba: {}, deepTAge: [], deltasBetweenFull: [], deltasSinceFull: 0, firstFull: null };
    per.set(s, st);
    let info;
    const onFrame = (data, isBinary, at) => {
      const text = isBinary ? `<binary ${data.length} bytes>` : data.toString('utf8');
      let j;
      try {
        j = JSON.parse(text);
      } catch {
        st.counts[`text:${text.slice(0, 16)}`] = (st.counts[`text:${text.slice(0, 16)}`] || 0) + 1;
        return;
      }
      const ch = j.channel ?? `code:${j.code}`;
      st.counts[ch] = (st.counts[ch] || 0) + 1;
      if (st.counts[ch] <= 3) capture(`book-${s}.txt`, `${at - info.t0} ${text}`);
      if (ch === 'push.deep.full' || ch === 'push.deep') {
        if (st.lastBookFrameAt) st.maxQuietMs = Math.max(st.maxQuietMs, at - st.lastBookFrameAt);
        st.lastBookFrameAt = at;
      }
      if (ch === 'push.deep.full') {
        const d = j.data;
        if (st.firstFullMs === null) {
          st.firstFullMs = at - info.t0;
          st.firstFull = { id: d.id, bids: d.b.length, asks: d.a.length };
        }
        if (st.lastFullAt) st.fullGaps.push(at - st.lastFullAt);
        st.lastFullAt = at;
        st.fullLevels.push(`${d.b.length}/${d.a.length}`);
        const desc = d.b.every((l, k) => k === 0 || Number(l[0]) < Number(d.b[k - 1][0]));
        const asc = d.a.every((l, k) => k === 0 || Number(l[0]) > Number(d.a[k - 1][0]));
        if (!desc || !asc) st.fullOrderBad++;
        if (d.b[0] && d.a[0] && Number(d.b[0][0]) >= Number(d.a[0][0])) st.crossedFull++;
        for (const l of [...d.b, ...d.a]) {
          if (/e/i.test(l[1])) st.sci++;
          const k = typeof l[1];
          st.sizeKinds[k] = (st.sizeKinds[k] || 0) + 1;
        }
        // Replay: the book built from the previous snapshot plus the deltas since, against this snapshot.
        if (st.fullId !== null) {
          const mine = st.book.top(20);
          st.replay.compared++;
          const same = (x, y) => x.length === y.length && x.every((l, k) => l[0] === y[k][0] && Number(l[1]) === Number(y[k][1]));
          if (same(mine.b, d.b.slice(0, 20)) && same(mine.a, d.a.slice(0, 20))) st.replay.top20Equal++;
          else {
            // How far from the touch the first difference sits, and whether it is a price or only a size.
            const firstDiff = (x, y) => x.findIndex((l, k) => !y[k] || l[0] !== y[k][0] || Number(l[1]) !== Number(y[k][1]));
            const rb = firstDiff(mine.b, d.b.slice(0, 20));
            const ra = firstDiff(mine.a, d.a.slice(0, 20));
            const rank = Math.min(rb === -1 ? 99 : rb, ra === -1 ? 99 : ra);
            st.replay.firstDiffRank.push(rank);
            const priceSet = (x) => new Set(x.map((l) => l[0]));
            const pb = priceSet(d.b.slice(0, 20));
            const pa = priceSet(d.a.slice(0, 20));
            const priceDiffs = mine.b.filter((l) => !pb.has(l[0])).length + mine.a.filter((l) => !pa.has(l[0])).length;
            st.replay.priceDiffs.push(priceDiffs);
          }
          if (mine.b[0]?.[0] === d.b[0]?.[0] && mine.a[0]?.[0] === d.a[0]?.[0]) st.replay.touchEqual++;
          st.deltasBetweenFull.push(st.deltasSinceFull);
        }
        st.deltasSinceFull = 0;
        st.book.reset(d);
        st.fullId = BigInt(d.id);
        return;
      }
      if (ch === 'push.deep') {
        const d = j.data;
        st.ba[d.ba] = (st.ba[d.ba] || 0) + 1;
        st.deepTAge.push(at - d.t);
        const id = BigInt(d.id);
        if (st.lastDeepId !== null) {
          if (id <= st.lastDeepId) st.idBackwards++;
          else st.idStep.push(Number(id - st.lastDeepId));
        }
        st.lastDeepId = id;
        if (st.fullId === null) {
          st.deepBeforeFull++;
          return;
        }
        if (id <= st.fullId) st.deepStale++;
        st.deltasSinceFull++;
        st.book.apply(d);
      }
    };
    info = await openRetry(URL_MARKET, onFrame);
    log('open', { s, tries: info.tries, openMs: info.openMs, refused: info.refused, error: info.error });
    info.subAt = Date.now();
    send(info.ws, { req: 'sub_symbol', symbol: s });
    sockets.push(info);
  }
  await sleep(60_000);
  // Size unit: the REST book read now against the last snapshot of the same socket, matched by price.
  for (const s of symbols) {
    const st = per.get(s);
    const r = await restJson(`q/depth?symbol=${s}&level=20`);
    const rest = new Map([...(r?.data?.b ?? []), ...(r?.data?.a ?? [])].map((l) => [l[0], Number(l[1])]));
    const top = st.book.top(20);
    const ws = [...top.b, ...top.a];
    const shared = ws.filter((l) => rest.has(l[0]));
    const equal = shared.filter((l) => rest.get(l[0]) === Number(l[1])).length;
    log('rest_vs_ws', { s, restTouch: [r?.data?.b?.[0], r?.data?.a?.[0]], wsTouch: [top.b[0], top.a[0]], sharedPrices: `${shared.length} of ${ws.length}`, equalSizes: equal });
  }
  for (const info of sockets) info.ws.terminate();
  for (const st of per.values()) {
    const steps = st.idStep;
    const stepOne = steps.filter((x) => x === 1).length;
    log('book_summary', {
      s: st.s,
      contractSize: cs.get(st.s),
      counts: st.counts,
      firstFullMs: st.firstFullMs,
      firstFull: st.firstFull,
      fullGapMs: stats(st.fullGaps),
      fullLevels: Object.entries(st.fullLevels.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).slice(0, 6),
      fullOrderBad: st.fullOrderBad,
      crossedFull: st.crossedFull,
      sciSizes: st.sci,
      sizeKinds: st.sizeKinds,
      deepSides: st.ba,
      deepIdSteps: { n: steps.length, stepOne, backwards: st.idBackwards, largest: steps.length ? Math.max(...steps) : null },
      deepBeforeFirstFull: st.deepBeforeFull,
      deepAtOrBelowFullId: st.deepStale,
      deltasBetweenFull: stats(st.deltasBetweenFull),
      replay: { compared: st.replay.compared, top20Equal: st.replay.top20Equal, touchEqual: st.replay.touchEqual, mismatchFirstDiffRank: stats(st.replay.firstDiffRank), mismatchLevelsAtOtherPrices: stats(st.replay.priceDiffs) },
      deepTAgeMs: stats(st.deepTAge),
      maxBookSilenceMs: st.maxQuietMs,
    });
  }
}

async function control() {
  const seen = [];
  const t0 = Date.now();
  const info = await openRetry(URL_MARKET, (data, isBinary, at) => {
    const text = isBinary ? `<binary ${data.length}>` : data.toString('utf8');
    let key = text.slice(0, 40);
    try {
      const j = JSON.parse(text);
      key = j.channel ? `${j.channel} ${j.data?.s ?? (Array.isArray(j.data) ? 'array' : '')}` : text.slice(0, 160);
    } catch {}
    seen.push({ at: at - t0, key });
    capture('control.txt', `${at - t0} ${text}`);
  });
  log('open', { tries: info.tries, openMs: info.openMs, refused: info.refused, extensions: info.extensions });
  const step = async (label, frame, wait = 2500) => {
    const from = Date.now() - t0;
    send(info.ws, frame);
    await sleep(wait);
    const got = seen.filter((x) => x.at >= from);
    const byKey = {};
    for (const g of got) byKey[g.key] = (byKey[g.key] || 0) + 1;
    log('step', { label, frame: typeof frame === 'string' ? frame : JSON.stringify(frame), replies: Object.entries(byKey).slice(0, 12) });
  };
  await step('subscribe btc', { req: 'sub_symbol', symbol: 'btc_usdt' });
  await step('text ping', 'ping', 1500);
  await step('json ping', { ping: Date.now() }, 1500);
  await step('PONG frame', { method: 'PONG', E: Date.now() }, 1500);
  await step('kline style subscribe', { method: 'subscribe', params: ['kline@btc_usdt,1m'] }, 4000);
  await step('kline style depth', { method: 'subscribe', params: ['depth@btc_usdt,20', 'depth_update@btc_usdt'] });
  await step('subscribe eth on the same socket', { req: 'sub_symbol', symbol: 'eth_usdt' });
  await step('unsubscribe', { req: 'unsub_symbol' });
  await step('unknown symbol', { req: 'sub_symbol', symbol: 'nope_usdt' });
  await step('uppercase symbol', { req: 'sub_symbol', symbol: 'BTC_USDT' });
  await step('unknown req', { req: 'sub_nope' });
  // Last, because the first run showed the server closing the socket on a frame that is not JSON.
  await step('not JSON', 'hello');
  log('close', { closed: info.closed, protocolPings: info.protocolPings ?? 0 });
  info.ws.terminate();
}

async function silence() {
  const cases = [
    { name: 'no subscription, no client frame', sub: false, ping: false },
    { name: 'btc subscription, no client frame', sub: true, ping: false },
    { name: 'btc subscription, text ping every 10 s', sub: true, ping: true },
  ];
  const infos = [];
  for (const c of cases) {
    const st = { name: c.name, frames: 0, serverPings: [], lastFrameAt: null, maxGapMs: 0, pongs: 0 };
    let info;
    info = await openRetry(URL_MARKET, (data, _b, at) => {
      const text = data.toString('utf8');
      st.frames++;
      if (st.lastFrameAt) st.maxGapMs = Math.max(st.maxGapMs, at - st.lastFrameAt);
      st.lastFrameAt = at;
      if (/ping/i.test(text) && !text.includes('"channel"')) st.serverPings.push({ at: at - info.t0, text: text.slice(0, 80) });
      if (/pong/i.test(text)) st.pongs++;
    });
    if (c.sub) send(info.ws, { req: 'sub_symbol', symbol: 'btc_usdt' });
    if (c.ping) {
      const timer = setInterval(() => send(info.ws, 'ping'), 10_000);
      timer.unref();
    }
    infos.push({ info, st });
  }
  await sleep(120_000);
  for (const { info, st } of infos) {
    log('silence', { name: st.name, tries: info.tries, closed: info.closed, frames: st.frames, maxGapMs: st.maxGapMs, serverPings: st.serverPings.slice(0, 4), serverPingCount: st.serverPings.length, pongs: st.pongs, protocolPings: info.protocolPings ?? 0 });
    info.ws.terminate();
  }
}

async function fanout() {
  const agg = await restJson('q/agg-tickers');
  const top = (agg?.data ?? []).sort((x, y) => Number(y.v) - Number(x.v)).slice(0, 30).map((x) => x.s);
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = [];
  const opens = [];
  const infos = [];
  let retries = 0;
  for (const s of top) {
    const info = await openRetry(URL_MARKET, (data) => {
      frames++;
      bytes += data.length;
      const t = process.hrtime.bigint();
      try {
        JSON.parse(data.toString('utf8'));
      } catch {} // the bare `succeed` acknowledgement is not JSON
      parseNs += process.hrtime.bigint() - t;
    });
    opens.push(info.openMs ?? `refused ${info.refused ?? info.error}`);
    retries += info.tries - 1;
    send(info.ws, { req: 'sub_symbol', symbol: s });
    infos.push(info);
  }
  log('fanout_open', { sockets: top.length, openMs: stats(opens.filter((x) => typeof x === 'number')), failed: opens.filter((x) => typeof x !== 'number'), hungOpensRetried: retries });
  const startFrames = frames;
  const t0 = Date.now();
  let last = frames;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    perSecond.push(frames - last);
    last = frames;
  }
  const secs = (Date.now() - t0) / 1000;
  const closed = infos.filter((x) => x.closed).map((x) => x.closed);
  log('fanout', { secs, frames: frames - startFrames, framesPerSecond: stats(perSecond), kbPerSecond: Math.round(bytes / 1024 / secs), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000, closed });
  for (const info of infos) info.ws.terminate();
}

async function bulk() {
  const st = { counts: {}, times: {}, rows: {} };
  const info = await openRetry(URL_MARKET, (data, _b, at) => {
    let j;
    try {
      j = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    const ch = j.channel ?? `code:${j.code}`;
    st.counts[ch] = (st.counts[ch] || 0) + 1;
    if (Array.isArray(j.data)) {
      (st.times[ch] ??= []).push(at);
      (st.rows[ch] ??= []).push(j.data.length);
      if (st.counts[ch] === 1) capture('bulk.txt', JSON.stringify({ ...j, data: j.data.slice(0, 3) }));
    }
  });
  log('open', { tries: info.tries, openMs: info.openMs, error: info.error, refused: info.refused });
  send(info.ws, { req: 'sub_tickers' });
  send(info.ws, { req: 'sub_mark_prices' });
  await sleep(30_000);
  info.ws.terminate();
  for (const ch of Object.keys(st.times)) {
    const t = st.times[ch];
    log('bulk', { channel: ch, frames: t.length, gapMs: stats(t.slice(1).map((x, k) => x - t[k])), rows: stats(st.rows[ch]) });
  }
  log('bulk_counts', st.counts);
}

// MGBX touch against Binance USDT-M bookTicker on the same symbols: which delay makes the two agree, and how often MGBX crosses Binance at arrival.
async function mirror() {
  const pairs = [['btc_usdt', 'BTCUSDT'], ['eth_usdt', 'ETHUSDT']];
  const bn = new Map(pairs.map(([, b]) => [b, []])); // arrival ms, bid, ask
  const mg = new Map(pairs.map(([m]) => [m, []]));
  const streams = pairs.map(([, b]) => `${b.toLowerCase()}@bookTicker`).join('/');
  const binance = await openRetry(`wss://fstream.binance.com/stream?streams=${streams}`, (data, _b, at) => {
    const j = JSON.parse(data.toString('utf8'));
    const d = j.data;
    if (d?.s && bn.has(d.s)) bn.get(d.s).push([at, Number(d.b), Number(d.a)]);
  });
  log('open', { venue: 'binance', tries: binance.tries, openMs: binance.openMs });
  const sockets = [];
  for (const [m] of pairs) {
    const info = await openRetry(URL_MARKET, (data, _b, at) => {
      let j;
      try {
        j = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      if (j.channel === 'push.deep.full') mg.get(m).push([at, Number(j.data.b[0][0]), Number(j.data.a[0][0])]);
    });
    log('open', { venue: 'mgbx', s: m, tries: info.tries, openMs: info.openMs });
    send(info.ws, { req: 'sub_symbol', symbol: m });
    sockets.push(info);
  }
  await sleep(60_000);
  for (const info of [binance, ...sockets]) info.ws.terminate();
  for (const [m, b] of pairs) {
    const ref = bn.get(b);
    const snaps = mg.get(m).filter(([at]) => at - 3000 > ref[0]?.[0]);
    const at = (t) => {
      let lo = 0;
      let hi = ref.length - 1;
      if (!ref.length || ref[0][0] > t) return null;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ref[mid][0] <= t) lo = mid;
        else hi = mid - 1;
      }
      return ref[lo];
    };
    // For each delay: how many snapshots match the Binance bid, and the median gap between the two mids in ppm.
    const byLag = {};
    for (let lag = 0; lag <= 2000; lag += 250) {
      let bidEq = 0;
      const gaps = [];
      for (const [t, bid, ask] of snaps) {
        const r = at(t - lag);
        if (!r) continue;
        if (r[1] === bid) bidEq++;
        gaps.push(Math.abs(Math.round(((bid + ask) / (r[1] + r[2]) - 1) * 1e6)));
      }
      byLag[lag] = { bidEq, midGapPpm: pct(gaps, 50) };
    }
    const spread = snaps.map(([, bid, ask]) => Math.round((ask / bid - 1) * 1e6));
    const bnSpread = ref.map(([, bid, ask]) => Math.round((ask / bid - 1) * 1e6));
    let crossed = 0;
    const crossPpm = [];
    for (const [t, bid, ask] of snaps) {
      const r = at(t);
      if (!r) continue;
      if (bid > r[2]) (crossed++, crossPpm.push(Math.round((bid / r[2] - 1) * 1e6)));
      else if (ask < r[1]) (crossed++, crossPpm.push(Math.round((r[1] / ask - 1) * 1e6)));
    }
    log('mirror', { s: m, binanceTicks: ref.length, mgbxSnapshots: snaps.length, byLagMs: byLag, spreadPpm: { mgbx: pct(spread, 50), binance: pct(bnSpread, 50) }, crossedBinanceAtArrival: crossed, crossPpm: stats(crossPpm) });
  }
}

async function deflate() {
  const info = await openRetry(URL_MARKET, () => {}, { deflate: true });
  log('deflate', { tries: info.tries, openMs: info.openMs, negotiated: info.extensions });
  info.ws.terminate();
}

const modes = { book, control, silence, fanout, bulk, mirror, deflate };
const mode = process.argv[2] ?? 'book';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
