// Bilaxy spot WebSocket probe: the one public stream, its depth frames, level order, cadence, idle repeats, the Binance comparison, errors, silence and many sockets from one host.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bilaxy/ws-probe.mjs [book|errors|silence|batch]
//   book     one socket per pair on BTC_USDT, ETH_USDT, DOT_USDT, CRV_ETH and XYO_ETH for 60 s, a REST book compare at limit 200, and Binance bookTicker beside it. About 65 s.
//   errors   no User-Agent, unknown, named and multiple symbols, a disabled pair, one client frame per socket, the permessage-deflate offer, and the socket.io path. About 60 s.
//   silence  three sockets that differ only in what the client sends, for up to 120 s.
//   batch    one socket per trade-enabled pair, opened four a second, held 20 s. About 50 s.
// Every socket sends a User-Agent header, because CloudFront answers 403 to an upgrade without one, which the errors mode shows.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/bilaxy/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const STREAM = 'wss://bilaxy.com/stream';
const API = 'https://newapi.bilaxy.com';
const BINANCE = 'wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker';
const UA = 'arbitrage-observatory-probe/1.0';
const PROTOCOL_PING = Symbol('protocol ping');
const OUT = process.env.PROBE_OUT_DIR;
const BOOK_PAIRS = { BTC_USDT: 113, ETH_USDT: 79, DOT_USDT: 887, CRV_ETH: 537, XYO_ETH: 864 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

function open(url, { headers = { 'User-Agent': UA }, deflate = false, onFrame, onClose } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate, headers });
  const s = { ws, t0, openMs: null, status: null, closed: null, pings: 0, frames: 0, ext: null };
  ws.on('upgrade', (res) => {
    s.status = res.statusCode;
    s.ext = res.headers['sec-websocket-extensions'] ?? null;
  });
  ws.on('open', () => (s.openMs = Date.now() - t0));
  ws.on('ping', () => s.pings++);
  ws.on('message', (d, isBinary) => {
    s.frames++;
    onFrame?.(String(d), Date.now(), isBinary);
  });
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      s.refused = { status: res.statusCode, server: res.headers.server, xcache: res.headers['x-cache'], pop: res.headers['x-amz-cf-pop'], title: (body.match(/<H1>([^<]*)<\/H1>/i) || [])[1] ?? body.slice(0, 80) };
    });
  });
  ws.on('error', (e) => (s.error = e.message));
  ws.on('close', (code, reason) => {
    s.closed = { code, reason: String(reason), afterMs: Date.now() - t0 };
    onClose?.(s);
  });
  return s;
}

function sortedDesc(levels) {
  for (let i = 1; i < levels.length; i++) if (levels[i][0] > levels[i - 1][0]) return false;
  return true;
}

function sortedAsc(levels) {
  for (let i = 1; i < levels.length; i++) if (levels[i][0] < levels[i - 1][0]) return false;
  return true;
}

async function restBook(pair, limit) {
  const t0 = Date.now();
  const res = await fetch(`${API}/v1/orderbook?pair=${pair}&limit=${limit}`, { headers: { 'User-Agent': UA } });
  const body = await res.json();
  return { ms: Date.now() - t0, body };
}

async function book() {
  const durMs = 60_000;
  const stats = {};
  const binance = { BTC_USDT: [], ETH_USDT: [] };
  const sockets = [];

  const bn = new WebSocket(BINANCE, { perMessageDeflate: false });
  bn.on('message', (d) => {
    const m = JSON.parse(String(d));
    const key = m.data?.s === 'BTCUSDT' ? 'BTC_USDT' : m.data?.s === 'ETHUSDT' ? 'ETH_USDT' : null;
    if (key) binance[key].push([Date.now(), (Number(m.data.b) + Number(m.data.a)) / 2]);
  });
  bn.on('error', (e) => log('binance_error', { message: e.message }));

  for (const [pair, id] of Object.entries(BOOK_PAIRS)) {
    const st = (stats[pair] = { id, methods: {}, depth: [], gaps: [], lastArr: null, prev: null, repeats: 0, bidsNotDesc: 0, asksNotAsc: 0, crossed: 0, bLen: [], aLen: [], farBids: [], farAsks: [], age: [], tsBack: 0, totalMismatch: 0, symbols: new Set(), changedTop20: [], latest: null, firstMs: null, touchSideMissing: 0, changeGaps: [], lastChange: null });
    const s = open(`${STREAM}?symbol=${id}`, {
      onFrame: (text, arr) => {
        let m;
        try {
          m = JSON.parse(text);
        } catch {
          st.methods.nonjson = (st.methods.nonjson ?? 0) + 1;
          return;
        }
        st.methods[m.method] = (st.methods[m.method] ?? 0) + 1;
        st.symbols.add(String(m.symbol));
        if (st.methods[m.method] <= 2) capture(`${pair}.${m.method}.jsonl`, `${arr} ${text}`);
        if (m.method !== 'depth') return;
        const r = m.result;
        if (st.firstMs === null) st.firstMs = arr - s.t0;
        if (st.lastArr !== null) st.gaps.push(arr - st.lastArr);
        st.lastArr = arr;
        st.age.push(arr - r.ts);
        const b = r.b ?? [];
        const a = r.a ?? [];
        st.bLen.push(b.length);
        st.aLen.push(a.length);
        if (!sortedDesc(b)) st.bidsNotDesc++;
        if (!sortedAsc(a)) st.asksNotAsc++;
        if (b.length && a.length && b[0][0] >= a[0][0]) st.crossed++;
        const mid = b.length && a.length ? (b[0][0] + a[0][0]) / 2 : null;
        // A frame whose best bid sits more than 1 % under the best ask, or which lacks a side, is wide or one-sided.
        if (!b.length || !a.length || b[0][0] < a[0][0] * 0.99) st.touchSideMissing++;
        const tight = b.length && a.length && b[0][0] >= a[0][0] * 0.99 ? mid : null;
        if (mid) {
          st.farBids.push(b.filter((l) => l[0] < mid * 0.95).length);
          st.farAsks.push(a.filter((l) => l[0] > mid * 1.05).length);
        }
        for (const l of [...b, ...a]) if (Math.abs(l[0] * l[1] - l[2]) > Math.max(1e-6, l[2] * 1e-6)) st.totalMismatch++;
        const key = JSON.stringify([b, a]);
        if (st.prev !== null) {
          if (st.prev.key === key) st.repeats++;
          else {
            if (st.lastChange !== null) st.changeGaps.push(arr - st.lastChange);
            st.lastChange = arr;
          }
          if (r.ts < st.prev.ts) st.tsBack++;
          const prevSet = new Set([...st.prev.b.slice(0, 20), ...st.prev.a.slice(0, 20)].map((l) => l[0] + ':' + l[1]));
          st.changedTop20.push([...b.slice(0, 20), ...a.slice(0, 20)].filter((l) => !prevSet.has(l[0] + ':' + l[1])).length);
        }
        st.prev = { key, ts: r.ts, b, a };
        st.latest = { arr, ts: r.ts, b, a, mid };
        st.depth.push([arr, tight]);
      },
    });
    sockets.push([pair, s]);
  }

  await sleep(20_000);
  for (const pair of ['BTC_USDT', 'CRV_ETH']) {
    const st = stats[pair];
    const before = st.latest;
    const { ms, body } = await restBook(pair, 200);
    const after = st.latest;
    const ws = after ?? before;
    if (!ws) {
      log('rest_compare', { pair, note: 'no ws depth yet' });
      continue;
    }
    const restB = body.bids.map(([p, q]) => [Number(p), Number(q)]);
    const restA = body.asks.map(([p, q]) => [Number(p), Number(q)]);
    const match = (wsSide, restSide) => wsSide.slice(0, 20).filter((l) => restSide.some((r) => r[0] === l[0] && r[1] === l[1])).length;
    log('rest_compare', { pair, restMs: ms, restLevels: [restB.length, restA.length], wsLevels: [ws.b.length, ws.a.length], restTouch: [restB[0], restA[0]], wsTouch: [ws.b[0]?.slice(0, 2), ws.a[0]?.slice(0, 2)], wsTop20InRest: [match(ws.b, restB), match(ws.a, restA)], restTsMinusWsTs: body.timestamp - ws.ts });
  }
  await sleep(durMs - 20_000);

  for (const [pair, s] of sockets) {
    const st = stats[pair];
    log('book', {
      pair,
      id: st.id,
      status: s.status,
      openMs: s.openMs,
      firstDepthMs: st.firstMs,
      pings: s.pings,
      closed: s.closed,
      methods: st.methods,
      symbolField: [...st.symbols],
      depthFrames: st.depth.length,
      gapMs: { min: pct(st.gaps, 0), p50: pct(st.gaps, 0.5), p90: pct(st.gaps, 0.9), max: pct(st.gaps, 1) },
      bidLevels: [pct(st.bLen, 0), pct(st.bLen, 1)],
      askLevels: [pct(st.aLen, 0), pct(st.aLen, 1)],
      farBeyond5pct: { bids: [pct(st.farBids, 0), pct(st.farBids, 1)], asks: [pct(st.farAsks, 0), pct(st.farAsks, 1)] },
      bidsNotDesc: st.bidsNotDesc,
      asksNotAsc: st.asksNotAsc,
      crossed: st.crossed,
      identicalRepeats: st.repeats,
      contentChangeGapMs: { min: pct(st.changeGaps, 0), p50: pct(st.changeGaps, 0.5), max: pct(st.changeGaps, 1), n: st.changeGaps.length },
      wideOrOneSidedFrames: st.touchSideMissing,
      tsWentBack: st.tsBack,
      totalNotPriceTimesAmount: st.totalMismatch,
      top40LevelsChangedPerFrame: { p50: pct(st.changedTop20, 0.5), max: pct(st.changedTop20, 1), zero: st.changedTop20.filter((x) => x === 0).length },
      arrivalMinusTsMs: { min: pct(st.age, 0), p50: pct(st.age, 0.5), max: pct(st.age, 1) },
      lastTouch: st.latest ? [st.latest.b[0], st.latest.a[0]] : null,
    });
  }

  for (const pair of ['BTC_USDT', 'ETH_USDT']) {
    const bnSeries = binance[pair];
    const bl = stats[pair].depth.filter((x) => x[1] !== null && x[0] > stats[pair].depth[0][0] + 10_000);
    if (bnSeries.length < 10 || bl.length < 5) {
      log('binance_compare', { pair, note: 'not enough data', binanceTicks: bnSeries.length, bilaxyFrames: bl.length });
      continue;
    }
    const at = (t) => {
      let lo = 0;
      let hi = bnSeries.length - 1;
      if (t < bnSeries[0][0]) return null;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bnSeries[mid][0] <= t) lo = mid;
        else hi = mid - 1;
      }
      return bnSeries[lo][1];
    };
    const errAt = (tau) => {
      const e = [];
      for (const [t, m] of bl) {
        const b = at(t - tau);
        if (b) e.push((Math.abs(m - b) / b) * 1e6);
      }
      return e;
    };
    // The lag that best explains the Bilaxy mid as a delayed Binance mid, by median error, over frames whose touch is two-sided.
    let best = { tau: 0, med: Infinity };
    const curve = [];
    for (let tau = 0; tau <= 10_000; tau += 50) {
      const e = errAt(tau);
      const med = pct(e, 0.5);
      if (tau % 1000 === 0) curve.push([tau, Math.round(med * 10) / 10]);
      if (e.length > bl.length / 2 && med < best.med) best = { tau, med };
    }
    const e0 = errAt(0);
    log('binance_compare', { pair, binanceTicks: bnSeries.length, bilaxyFrames: bl.length, midDiffPpmAtLag0: { p50: Math.round(pct(e0, 0.5) * 10) / 10, p90: Math.round(pct(e0, 0.9)), max: Math.round(pct(e0, 1)) }, bestLagMs: best.tau, medianDiffPpmAtBestLag: Math.round(best.med * 10) / 10, medianPpmByLagMs: curve });
  }

  for (const [, s] of sockets) s.ws.terminate();
  bn.terminate();
}

async function errors() {
  const cases = [];
  const run = async (name, url, opts = {}, sendAfterOpen = [], holdMs = 5000) => {
    const got = [];
    const s = open(url, { ...opts, onFrame: (text, arr, bin) => got.push({ dt: arr - s.t0, bin, text: text.slice(0, 160) }) });
    // Client frames go out 1.5 s after the open, so the reply or the close can be told apart from the handshake.
    s.ws.on('open', () => {
      setTimeout(() => {
        for (const f of sendAfterOpen) {
          if (s.ws.readyState !== 1) break;
          if (f === PROTOCOL_PING) s.ws.ping();
          else s.ws.send(f);
          s.sentAt ??= Date.now() - s.t0;
        }
      }, 1500);
    });
    await sleep(holdMs);
    const methods = {};
    for (const g of got) {
      const m = (g.text.match(/"method":"(\w+)"/) || [])[1] ?? 'other';
      methods[m] = (methods[m] ?? 0) + 1;
    }
    const nonDepth = got.filter((g) => !/"method":"(depth|ticker|trade)"/.test(g.text)).slice(0, 3);
    log('case', { name, sentAtMs: s.sentAt ?? null, status: s.status, refused: s.refused, openMs: s.openMs, ext: s.ext, pings: s.pings, frames: got.length, methods, firstFrame: got[0] ? { dt: got[0].dt, text: got[0].text.slice(0, 100) } : null, nonDepthFrames: nonDepth, closed: s.closed, error: s.error });
    s.ws.terminate();
    await sleep(300);
  };
  await run('no_user_agent', `${STREAM}?symbol=113`, { headers: {} }, [], 2000);
  await run('unknown_symbol_999999', `${STREAM}?symbol=999999`);
  await run('named_symbol_BTC_USDT', `${STREAM}?symbol=BTC_USDT`);
  await run('no_symbol', STREAM);
  await run('two_symbols_comma', `${STREAM}?symbol=113,79`);
  await run('two_symbol_params', `${STREAM}?symbol=113&symbol=79`);
  await run('disabled_pair_BNB', `${STREAM}?symbol=${process.env.DISABLED_ID ?? 1}`);
  for (const [name, f] of [['send_text_ping', 'ping'], ['send_json_method_ping', '{"method":"ping"}'], ['send_engineio_2', '2'], ['send_subscribe_like', '{"method":"subscribe","symbol":79}'], ['send_protocol_ping', PROTOCOL_PING]]) {
    await run(name, `${STREAM}?symbol=864`, {}, [f], 4500);
  }
  await run('deflate_offer', `${STREAM}?symbol=113`, { deflate: true }, [], 3000);
  await run('socket_io_path', 'wss://bilaxy.com/socket.io/?symbol=113&deep=4&token=dev&transport=websocket', {}, [], 4000);
}

async function silence() {
  const cases = {
    quiet_pair_no_client_frames: { url: `${STREAM}?symbol=864`, send: null },
    busy_pair_no_client_frames: { url: `${STREAM}?symbol=113`, send: null },
    quiet_pair_protocol_ping_10s: { url: `${STREAM}?symbol=864`, send: 'ping' },
  };
  const res = {};
  for (const [name, c] of Object.entries(cases)) {
    const r = (res[name] = { frames: 0, gaps: [], last: null, pongs: 0 });
    const s = open(c.url, {
      onFrame: (_t, arr) => {
        r.frames++;
        if (r.last !== null) r.gaps.push(arr - r.last);
        r.last = arr;
      },
    });
    s.ws.on('pong', () => r.pongs++);
    r.s = s;
    if (c.send === 'ping') {
      r.timer = setInterval(() => s.ws.readyState === 1 && s.ws.ping(), 10_000);
    }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000 && Object.values(res).some((r) => !r.s.closed)) await sleep(1000);
  for (const [name, r] of Object.entries(res)) {
    clearInterval(r.timer);
    log('silence', { name, status: r.s.status, openMs: r.s.openMs, heldMs: r.s.closed?.afterMs ?? Date.now() - r.s.t0, closed: r.s.closed, serverPings: r.s.pings, pongs: r.pongs, frames: r.frames, maxGapMs: pct(r.gaps, 1), p50GapMs: pct(r.gaps, 0.5) });
    r.s.ws.terminate();
  }
}

async function batch() {
  const res = await fetch(`${API}/v1/pairs`, { headers: { 'User-Agent': UA } });
  const pairs = Object.entries(await res.json()).filter(([, v]) => v.trade_enabled);
  const socks = [];
  const t0 = Date.now();
  for (const [name, v] of pairs) {
    const r = { name, frames: 0, bytes: 0, depth: 0, firstDepth: null };
    r.s = open(`${STREAM}?symbol=${v.pair_id}`, {
      onFrame: (text, arr) => {
        r.frames++;
        r.bytes += text.length;
        if (text.includes('"method":"depth"')) {
          r.depth++;
          if (r.firstDepth === null) r.firstDepth = arr - r.s.t0;
        }
      },
    });
    socks.push(r);
    await sleep(250);
  }
  const openedIn = Date.now() - t0;
  await sleep(20_000);
  const opened = socks.filter((r) => r.s.status === 101);
  const refused = socks.filter((r) => r.s.refused).map((r) => ({ name: r.name, ...r.s.refused }));
  const noDepth = socks.filter((r) => r.depth === 0).map((r) => r.name);
  const openMs = opened.map((r) => r.s.openMs).filter((x) => x !== null);
  const firstDepth = socks.map((r) => r.firstDepth).filter((x) => x !== null);
  const frames = socks.reduce((x, r) => x + r.frames, 0);
  const bytes = socks.reduce((x, r) => x + r.bytes, 0);
  const secs = (Date.now() - t0) / 1000;
  log('batch', { sockets: socks.length, openedIn, upgraded: opened.length, refused: refused.slice(0, 5), refusedCount: refused.length, closedEarly: socks.filter((r) => r.s.closed).map((r) => [r.name, r.s.closed]).slice(0, 5), openMs: { min: pct(openMs, 0), p50: pct(openMs, 0.5), max: pct(openMs, 1) }, firstDepthMs: { min: pct(firstDepth, 0), p50: pct(firstDepth, 0.5), max: pct(firstDepth, 1) }, pairsWithNoDepth: noDepth.length, noDepthSample: noDepth.slice(0, 10), framesTotal: frames, framesPerSecond: Math.round(frames / secs), bytesPerSecond: Math.round(bytes / secs), bytesPerFrame: Math.round(bytes / (frames || 1)) });
  for (const r of socks) r.s.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
await ({ book, errors, silence, batch }[mode] ?? book)();
log('end', { at: new Date().toISOString() });
process.exit(0);
