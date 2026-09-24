// KoinBX futures WebSocket probe: the Socket.IO feed the koinbx.com/futures web app reads, matched frame by frame against Binance USD-M.
// Public, unauthenticated, read-only.
// The hub is Azure Web PubSub for Socket.IO, spoken here as raw Engine.IO 4 text frames over ws.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one socket of the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/koinbx/ws-probe.mjs [book|batch|silence|errors|deflate]
//   book     depth and markPrice on six contracts for 75 s beside Binance depth20 streams matched by update id, and Binance premiumIndex polled each second matched by mark time.
//            Also tests each frame against the Binance frame of the same u re-priced onto a contiguous grid, and logs the upgrade headers and the first raw frame of each kind.
//   batch    depth on 100 USDT perpetuals on one connection for 60 s, or as BATCH_QUOTE, BATCH_STEP, BATCH_N and BATCH_SECONDS say.
//   silence  four sockets that differ in what the client answers or sends, for up to 110 s.
//   errors   unknown symbols, wrong groupings, unknown topics, bulk topics, duplicate subscribe and unsubscribe on one socket, and two malformed frames on a socket each, in about 30 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames, and PROBE_CATALOG or PROBE_MARKETINFO to read a saved exchangeInfo or marketInfo reply.
// Recorded in docs/profiles/koinbx/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const HUB = 'wss://kbx-futures-prod.webpubsub.azure.com/clients/socketio/hubs/KoinBX_Trade_Hub/?EIO=4&transport=websocket';
const FAPI = 'https://futures-api.koinbx.com/api/v1';
const BINANCE_WS = 'wss://fstream.binance.com/stream?streams=';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: q(xs, 0), p50: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) });
const round = (x, d = 8) => Math.round(x * 10 ** d) / 10 ** d;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 1500) + '\n');
}

// Opens one Socket.IO client over raw ws.
// Events arrive as '42["name", payload]'.
function openIo(label, { answerPing = true, connectNs = true, deflate = false, onEvent = () => {}, onRaw = () => {} } = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(HUB, { perMessageDeflate: deflate });
  const io = { ws, label, t0, openMs: null, closeAt: null, closeCode: null, pings: 0, lastFrameAt: t0, frames: 0, connected: false, extensions: null, raw: new Map() };
  io.ready = new Promise((resolve) => (io.resolveReady = resolve));
  io.emit = (name, payload) => ws.readyState === ws.OPEN && ws.send('42' + JSON.stringify(payload === undefined ? [name] : [name, payload]));
  ws.on('upgrade', (res) => {
    io.extensions = res.headers['sec-websocket-extensions'] ?? null;
    io.upgrade = { status: res.statusCode, headers: res.headers };
  });
  ws.on('open', () => (io.openMs = Date.now() - t0));
  ws.on('unexpected-response', (_req, res) => log('unexpectedResponse', { label, status: res.statusCode }));
  ws.on('message', (data) => {
    const s = data.toString();
    const at = Date.now();
    io.frames++;
    io.lastFrameAt = at;
    // First raw text of each kind, kept for quoting: '0' open, '40' connect, '2' ping, and each 42 event per symbol.
    const kind = s.startsWith('42') ? s.slice(2, 120).replace(/^\["([^"]+)".*?"s":"([^"]+)".*$/, '$1:$2').replace(/^\["([^"]+)".*$/, '$1') : s.slice(0, 2);
    if (!io.raw.has(kind)) io.raw.set(kind, { atMs: at - t0, text: s.slice(0, 1400) });
    onRaw(s, at);
    if (s === '2') {
      io.pings++;
      if (answerPing) ws.send('3');
      return;
    }
    if (s.startsWith('0')) {
      io.handshake = JSON.parse(s.slice(1));
      if (connectNs) ws.send('40');
      return;
    }
    if (s.startsWith('40')) {
      io.connected = true;
      io.connectMs = at - t0;
      io.resolveReady();
      return;
    }
    if (s.startsWith('42')) {
      const [name, payload] = JSON.parse(s.slice(2));
      onEvent(name, payload, at, s.length);
      return;
    }
    log('otherFrame', { label, frame: s.slice(0, 300) });
  });
  ws.on('close', (code, reason) => {
    io.closeAt = Date.now() - t0;
    io.closeCode = code;
    io.closeReason = reason.toString();
    io.resolveReady();
  });
  ws.on('error', (e) => log('socketError', { label, message: e.message }));
  return io;
}

async function loadCatalog() {
  const file = process.env.PROBE_CATALOG;
  if (file) return JSON.parse(readFileSync(file, 'utf8')).data.pairs;
  const res = await fetch(`${FAPI}/exchange/exchangeInfo`, { signal: AbortSignal.timeout(120_000) });
  return (await res.json()).data.pairs;
}

// marketInfo only ranks contracts by volume, so a saved copy in PROBE_MARKETINFO serves when the live call is slow.
async function loadMarketInfo() {
  const file = process.env.PROBE_MARKETINFO;
  if (file) return JSON.parse(readFileSync(file, 'utf8')).data;
  return (await (await fetch(`${FAPI}/market/marketInfo`, { signal: AbortSignal.timeout(30_000) })).json()).data;
}

const topicOf = (pairs, sym, kind = 'depth') => {
  if (kind === 'markPrice') return `${sym.toLowerCase()}@markPrice`;
  const g = pairs.find((p) => p.pair === sym)?.depthGrouping?.[0] ?? '1';
  return `${sym.toLowerCase()}@depth_${g}`;
};

const INR_PER_USDT = 95.55; // the fixed factor of rest.md section 4
const decimals = (x) => (String(x).split('.')[1] ?? '').length;
const tally = (c, k) => (c[k] = (c[k] ?? 0) + 1);

// Tests whether a KoinBX frame is Binance's depth20 frame of the same u, re-priced onto a contiguous grid of one depthGrouping step.
// Ticks are counted from Binance's touch in USDT, so an INR level is divided by INR_PER_USDT first.
function ladder(sym, frames, binanceOf, pair) {
  const step = Number(pair.depthGrouping[0]);
  const inr = sym.endsWith('INR');
  const usd = (p) => (inr ? p / INR_PER_USDT : p);
  const tol = inr ? 0.11 : 1e-6; // INR levels are whole rupees, not always the nearest one, and one rupee is about 0.105 of a 0.1 USDT tick on BTCINR
  const out = { step, frames: 0, matched: 0, kbGrid: 0, kbContiguous: 0, bnContiguous: 0, bnGappedKbContiguous: 0, bidOffsetTicks: {}, askOffsetTicks: {}, sizesSameByIndex: 0, bidShift: {}, askShift: {}, idsEqual: { U: 0, pu: 0, E: 0, T: 0 }, sourceStream: {}, deepBidPpm: [], deepAskPpm: [], extras: {}, framesWithExtra: 0, priceDecimalsOver: 0, sizeDecimalsOver: 0, levels: 0, crossedOrLocked: 0, example: null, insertExample: null };
  for (const f of frames) {
    out.frames++;
    for (const [p, q] of [...f.b, ...f.a]) {
      out.levels++;
      if (decimals(p) > Number(pair.pricePrecision)) out.priceDecimalsOver++;
      if (decimals(q) > Number(pair.quantityPrecision)) out.sizeDecimalsOver++;
    }
    const kb = f.b.map((l) => [Number(l[0]), Number(l[1])]).sort((x, y) => y[0] - x[0]);
    const ka = f.a.map((l) => [Number(l[0]), Number(l[1])]).sort((x, y) => x[0] - y[0]);
    if (kb.length && ka.length && kb[0][0] >= ka[0][0]) out.crossedOrLocked++;
    const m = binanceOf(f);
    if (!m || !kb.length || !ka.length) continue;
    out.matched++;
    for (const k of ['U', 'pu', 'E', 'T']) if (f[k] === m[k]) out.idsEqual[k]++;
    // Which Binance stream sent a frame with this u and the same U and pu, which names the stream KoinBX copies.
    const same = Object.entries(m.ids ?? {}).filter(([, v]) => v === `${f.U}:${f.pu}`).map(([k]) => k).sort().join('+') || 'none';
    tally(out.sourceStream, same);
    const bb = m.b.map((l) => [Number(l[0]), Number(l[1])]);
    const ba = m.a.map((l) => [Number(l[0]), Number(l[1])]);
    const bidT = kb.map(([p]) => (bb[0][0] - usd(p)) / step);
    const askT = ka.map(([p]) => (usd(p) - ba[0][0]) / step);
    const onGrid = [...bidT, ...askT].every((t) => Math.abs(t - Math.round(t)) < tol);
    const run = (t) => t.every((x, i) => i === 0 || Math.round(x) - Math.round(t[i - 1]) === 1);
    const kbC = onGrid && run(bidT) && run(askT);
    const bnC = bb.every((l, i) => i === 0 || Math.abs(bb[i - 1][0] - l[0] - step) < step * 1e-6) && ba.every((l, i) => i === 0 || Math.abs(l[0] - ba[i - 1][0] - step) < step * 1e-6);
    if (onGrid) out.kbGrid++;
    if (kbC) out.kbContiguous++;
    if (bnC) out.bnContiguous++;
    if (!bnC && kbC) {
      out.bnGappedKbContiguous++;
      if (!out.example) out.example = { u: f.u, bids: kb.slice(0, 6).map((l, i) => `${f.b.find((x) => Number(x[0]) === l[0])[0]}@${l[1]}|${m.b[i][0]}@${m.b[i][1]}`), asks: ka.slice(0, 6).map((l, i) => `${f.a.find((x) => Number(x[0]) === l[0])[0]}@${l[1]}|${m.a[i][0]}@${m.a[i][1]}`) };
    }
    tally(out.bidOffsetTicks, Math.round(bidT[0]));
    tally(out.askOffsetTicks, Math.round(askT[0]));
    const n = Math.min(kb.length, bb.length, ka.length, ba.length);
    if (kb.every((l, i) => i >= n || l[1] === bb[i][1]) && ka.every((l, i) => i >= n || l[1] === ba[i][1])) out.sizesSameByIndex++;
    // The shift that lines KoinBX sizes up with Binance sizes best: 1 means one level KoinBX has and Binance does not, at the front.
    const shift = (k, b) => {
      let best = [0, -1];
      for (let sh = 0; sh <= 3; sh++) {
        let hit = 0;
        for (let i = 0; i + sh < k.length && i < b.length; i++) if (k[i + sh][1] === b[i][1]) hit++;
        if (hit > best[1]) best = [sh, hit];
      }
      return best[0];
    };
    const bs = shift(kb, bb);
    const as = shift(ka, ba);
    tally(out.bidShift, bs);
    tally(out.askShift, as);
    // Levels KoinBX shows beyond Binance's: an inserted level at the front, or more size than Binance at the same level index.
    const before = Object.values(out.extras).reduce((x, y) => x + y, 0);
    const extrasOf = (side, k, b, sh) => {
      for (let i = 0; i < sh; i++) tally(out.extras, `${side} ${k[i][0]} ${k[i][1]} inserted`);
      for (let i = 0; i + sh < k.length && i < b.length; i++) if (k[i + sh][1] !== b[i][1]) tally(out.extras, `${side} ${k[i + sh][0]} ${round(k[i + sh][1] - b[i][1])} added`);
    };
    extrasOf('bid', kb, bb, bs);
    extrasOf('ask', ka, ba, as);
    if (Object.values(out.extras).reduce((x, y) => x + y, 0) > before) out.framesWithExtra++;
    if ((bs > 0 || as > 0) && !out.insertExample) out.insertExample = { u: f.u, bids: kb.slice(0, 4).map((l, i) => `${l[0]}@${l[1]}|${bb[i][0]}@${bb[i][1]}`), asks: ka.slice(0, 4).map((l, i) => `${l[0]}@${l[1]}|${ba[i][0]}@${ba[i][1]}`) };
    // How much better the deepest shared level looks on KoinBX than on Binance, for the same size, in ppm.
    // Positive means better for the taker.
    out.deepBidPpm.push(Math.round(((usd(kb[n - 1][0]) - bb[n - 1][0]) / bb[n - 1][0]) * 1e6));
    out.deepAskPpm.push(Math.round(((ba[n - 1][0] - usd(ka[n - 1][0])) / ba[n - 1][0]) * 1e6));
  }
  const extras = Object.entries(out.extras).sort((x, y) => y[1] - x[1]);
  return { ...out, extras: extras.slice(0, 10), extraKinds: extras.length, deepBidPpm: stats(out.deepBidPpm), deepAskPpm: stats(out.deepAskPpm) };
}

async function book() {
  const pairs = await loadCatalog();
  const mi = await loadMarketInfo();
  const usdt = pairs.filter((p) => p.quoteAsset === 'USDT' && p.contractType === 'PERPETUAL').sort((a, b) => Number(mi[a.pair]?.quoteAssetVolume ?? 0) - Number(mi[b.pair]?.quoteAssetVolume ?? 0));
  const quiet = usdt[0].pair;
  const syms = ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', quiet, 'XAUUSDT', 'BTCINR'];
  const binanceOf = (s) => (s.endsWith('INR') ? s.replace(/INR$/, 'USDT') : s);
  log('symbols', { syms, quiet, topics: syms.map((s) => topicOf(pairs, s)) });

  const bnFrames = new Map(); // `${sym}:${u}` to { at, stream, b, a }
  const bnMark = new Map(); // symbol to every Binance markPriceUpdate, in arrival order
  const bnSyms = [...new Set(syms.map(binanceOf))].map((s) => s.toLowerCase());
  // Binance markPrice streams sent nothing to this host in earlier sessions, so the Binance mark comes from one premiumIndex call per symbol per second.
  const streams = bnSyms.flatMap((s) => [`${s}@depth20@500ms`, `${s}@depth20`, `${s}@depth20@100ms`]);
  const bn = new WebSocket(BINANCE_WS + streams.join('/'), { perMessageDeflate: false });
  bn.on('message', (raw) => {
    const at = Date.now();
    const { stream, data } = JSON.parse(raw.toString());
    if (data.e === 'depthUpdate') {
      const key = `${data.s}:${data.u}`;
      const name = stream.split('@').slice(1).join('@');
      if (!bnFrames.has(key)) bnFrames.set(key, { at, stream: name, b: data.b, a: data.a, U: data.U, pu: data.pu, E: data.E, T: data.T, ids: {} });
      bnFrames.get(key).ids[name] = `${data.U}:${data.pu}`; // every Binance stream that sent this u, with its own U and pu

    }
  });
  await new Promise((r) => bn.once('open', r));
  const markSyms = ['BTCUSDT', 'ETHUSDT', quiet];
  let polling = true;
  const pollMarks = async () => {
    while (polling) {
      const t0 = Date.now();
      await Promise.all(
        markSyms.map(async (sym) => {
          try {
            const r = await (await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`, { signal: AbortSignal.timeout(3000) })).json();
            if (!bnMark.has(sym)) bnMark.set(sym, []);
            // premiumIndex `time` is the instant of the mark, so it plays the part of the stream's E.
            bnMark.get(sym).push({ E: r.time, p: r.markPrice, i: r.indexPrice, P: r.estimatedSettlePrice, r: r.lastFundingRate, T: r.nextFundingTime });
          } catch {}
        }),
      );
      await sleep(Math.max(0, 1000 - (Date.now() - t0)));
    }
  };
  const poller = pollMarks();

  const per = new Map();
  const marks = [];
  const acks = [];
  let firstDepth = null;
  const io = openIo('book', {
    onEvent: (name, d, at, len) => {
      if (name === 'subscriptionStatus') {
        acks.push({ at: at - io.t0, ...d });
        capture('ack.txt', JSON.stringify(d));
        return;
      }
      if (name === 'depthUpdate') {
        if (!firstDepth) firstDepth = at;
        capture(`depth-${d.s}.txt`, JSON.stringify(d));
        let s = per.get(d.s);
        if (!s) per.set(d.s, (s = { frames: [], levels: new Set(), bidOrder: new Set(), askOrder: new Set(), chain: 0, chainBreak: 0, bytes: [], idle: 0, last: null }));
        s.bytes.push(len);
        s.levels.add(`${d.b.length}/${d.a.length}`);
        const bp = d.b.map((l) => Number(l[0]));
        const ap = d.a.map((l) => Number(l[0]));
        s.bidOrder.add(bp.every((p, i) => i === 0 || p > bp[i - 1]) ? 'ascending' : bp.every((p, i) => i === 0 || p < bp[i - 1]) ? 'descending' : 'mixed');
        s.askOrder.add(ap.every((p, i) => i === 0 || p > ap[i - 1]) ? 'ascending' : 'mixed');
        if (s.last) {
          if (d.pu === s.last.u) s.chain++;
          else s.chainBreak++;
          if (JSON.stringify(d.b) === JSON.stringify(s.last.b) && JSON.stringify(d.a) === JSON.stringify(s.last.a)) s.idle++;
        }
        s.frames.push({ at, E: d.E, T: d.T, U: d.U, u: d.u, pu: d.pu, b: d.b, a: d.a });
        s.last = d;
        return;
      }
      if (name === 'markPriceUpdate') {
        capture(`mark-${d.s}.txt`, JSON.stringify(d));
        marks.push({ at, ...d });
        return;
      }
      capture('other.txt', JSON.stringify([name, d]));
    },
  });
  await io.ready;
  const subAt = Date.now();
  io.emit('subscribe', { params: [...syms.map((s) => topicOf(pairs, s)), ...['BTCUSDT', 'ETHUSDT', 'BTCINR', quiet].map((s) => topicOf(pairs, s, 'markPrice'))] });
  const pingAt = Date.now();
  let pongMs = null;
  const pongWatch = (s) => s.startsWith('42["pong"') && pongMs === null && (pongMs = Date.now() - pingAt);
  io.ws.on('message', (d) => pongWatch(d.toString()));
  io.emit('ping');
  await sleep(75_000);
  polling = false;
  await poller;
  io.ws.close();
  bn.close();

  log('session', { openMs: io.openMs, connectMs: io.connectMs, handshake: io.handshake, firstDepthAfterSubscribeMs: firstDepth ? firstDepth - subAt : null, pingsFromServer: io.pings, clientPingPongMs: pongMs, closedEarly: io.closeCode });
  log('acks', { acks: acks.map((a) => ({ at: a.at, action: a.action, subscribed: a.subscribed?.length, alreadySubscribed: a.alreadySubscribed?.length, keys: Object.keys(a).join(',') })) });
  const h = io.upgrade?.headers ?? {};
  log('upgrade', { status: io.upgrade?.status, headers: Object.fromEntries(Object.entries(h).filter(([k]) => !/^(set-cookie|date)$/.test(k))) });
  for (const [kind, r] of io.raw) log('raw', { kind, ...r });
  for (const [sym, s] of per) {
    const bnSym = binanceOf(sym);
    const eGaps = s.frames.slice(1).map((f, i) => f.E - s.frames[i].E);
    const arrGaps = s.frames.slice(1).map((f, i) => f.at - s.frames[i].at);
    const lagE = s.frames.map((f) => f.at - f.E);
    const matched = [];
    const streamsHit = {};
    let varyExample = null; // koinbx price@size|binance price@size by level, best first
    for (const f of s.frames) {
      const m = bnFrames.get(`${bnSym}:${f.u}`);
      if (!m) continue;
      streamsHit[m.stream] = (streamsHit[m.stream] ?? 0) + 1;
      const kb = [...f.b].map((l) => [Number(l[0]), Number(l[1])]).sort((x, y) => y[0] - x[0]);
      const ka = [...f.a].map((l) => [Number(l[0]), Number(l[1])]).sort((x, y) => x[0] - y[0]);
      const bb = m.b.map((l) => [Number(l[0]), Number(l[1])]);
      const ba = m.a.map((l) => [Number(l[0]), Number(l[1])]);
      const n = Math.min(kb.length, bb.length, ka.length, ba.length);
      const bidOff = new Set();
      const askOff = new Set();
      const sizeRatio = [];
      const priceRatio = new Set();
      for (let i = 0; i < n; i++) {
        bidOff.add(round(kb[i][0] - bb[i][0]));
        askOff.add(round(ka[i][0] - ba[i][0]));
        priceRatio.add(round(kb[i][0] / bb[i][0], 3));
        if (bb[i][1] > 0) sizeRatio.push(round(kb[i][1] / bb[i][1], 3));
        if (ba[i][1] > 0) sizeRatio.push(round(ka[i][1] / ba[i][1], 3));
      }
      if (!varyExample && (bidOff.size > 1 || askOff.size > 1)) varyExample = { bids: kb.slice(0, 8).map((l, i) => `${l[0]}@${l[1]}|${bb[i][0]}@${bb[i][1]}`), asks: ka.slice(0, 8).map((l, i) => `${l[0]}@${l[1]}|${ba[i][0]}@${ba[i][1]}`) };
      matched.push({ lag: f.at - m.at, bidOff: [...bidOff], askOff: [...askOff], sizeRatio, priceRatio: [...priceRatio], spreadKb: ka[0][0] - kb[0][0], spreadBn: ba[0][0] - bb[0][0], touchKb: [kb[0][0], ka[0][0]], touchBn: [bb[0][0], ba[0][0]] });
    }
    const offs = (k) => {
      const c = {};
      for (const m of matched) {
        const key = m[k].length === 1 ? String(m[k][0]) : `varies(${m[k].length})`;
        c[key] = (c[key] ?? 0) + 1;
      }
      return c;
    };
    const ratios = matched.flatMap((m) => m.sizeRatio);
    log('depth', {
      sym,
      frames: s.frames.length,
      levels: [...s.levels],
      bidOrder: [...s.bidOrder],
      askOrder: [...s.askOrder],
      puEqualsPrevU: s.chain,
      puNotPrevU: s.chainBreak,
      identicalToPrevious: s.idle,
      eventGapMs: stats(eGaps),
      arrivalGapMs: stats(arrGaps),
      arrivalMinusE: stats(lagE),
      bytes: stats(s.bytes),
      matchedToBinanceU: matched.length,
      binanceStream: streamsHit,
      lagBehindBinanceMs: stats(matched.map((m) => m.lag)),
      bidMinusBinanceByLevel: sym === bnSym ? offs('bidOff') : undefined,
      askMinusBinanceByLevel: sym === bnSym ? offs('askOff') : undefined,
      priceRatioByLevel: sym !== bnSym ? offs('priceRatio') : undefined,
      sizeRatio: stats(ratios),
      sizeRatioEqualOne: ratios.filter((r) => r === 1).length,
      exampleTouch: matched[0] ? { koinbx: matched[0].touchKb, binance: matched[0].touchBn } : undefined,
      varyExample: sym === bnSym ? varyExample : undefined,
    });
    log('ladder', { sym, ...ladder(sym, s.frames, (f) => bnFrames.get(`${bnSym}:${f.u}`), pairs.find((p) => p.pair === sym)) });
  }
  const bySym = new Map();
  for (const m of marks) {
    if (!bySym.has(m.s)) bySym.set(m.s, []);
    bySym.get(m.s).push(m);
  }
  for (const [sym, ms] of bySym) {
    const bnSym = binanceOf(sym);
    let same = { p: 0, i: 0, P: 0, r: 0, T: 0, n: 0 };
    const pGap = [];
    const iGap = [];
    const nearest = (m) => {
      let best = null;
      for (const b of bnMark.get(bnSym) ?? []) if (!best || Math.abs(b.E - m.E) < Math.abs(best.E - m.E)) best = b;
      return best && Math.abs(best.E - m.E) <= 500 ? best : null;
    };
    const eDelta = [];
    for (const m of ms) {
      const b = nearest(m);
      if (!b) continue;
      eDelta.push(m.E - b.E);
      same.n++;
      // Equal means the Binance number rounded to the decimals KoinBX printed gives the KoinBX string.
      const dec = (x) => (String(x).split('.')[1] ?? '').length;
      for (const k of ['p', 'i', 'P']) if (Number(b[k]).toFixed(dec(m[k])) === Number(m[k]).toFixed(dec(m[k]))) same[k]++;
      for (const k of ['r', 'T']) if (Number(m[k]) === Number(b[k])) same[k]++;
      pGap.push(Math.round(((Number(m.p) - Number(b.p)) / Number(b.p)) * 1e6));
      iGap.push(Math.round(((Number(m.i) - Number(b.i)) / Number(b.i)) * 1e6));
    }
    const changes = (k) => ms.reduce((n, m, i) => n + (i > 0 && m[k] !== ms[i - 1][k] ? 1 : 0), 0);
    log('markPrice', {
      sym,
      frames: ms.length,
      keys: Object.keys(ms[0]).filter((k) => k !== 'at').join(','),
      eventGapMs: stats(ms.slice(1).map((m, i) => m.E - ms[i].E)),
      arrivalMinusE: stats(ms.map((m) => m.at - m.E)),
      changes: { p: changes('p'), i: changes('i'), P: changes('P'), r: changes('r'), T: changes('T'), lr: changes('lr'), ap: changes('ap'), st: changes('st') },
      matchedBinanceWithin500ms: same.n,
      koinbxEMinusBinanceE: stats(eDelta),
      koinbxEWholeSecond: ms.filter((m) => m.E % 1000 === 0).length,
      offSecondSample: ms.filter((m) => m.E % 1000 !== 0).slice(0, 3).map((m) => `${m.E} binance ${nearest(m)?.E ?? 'none'}`).join(', '),
      equalToBinance: same,
      markGapPpm: stats(pGap),
      indexGapPpm: stats(iGap),
      last: { p: ms.at(-1).p, ap: ms.at(-1).ap, P: ms.at(-1).P, i: ms.at(-1).i, r: ms.at(-1).r, lr: ms.at(-1).lr, T: ms.at(-1).T, st: ms.at(-1).st },
      binanceNearestToLast: (({ p, i, P, r, T, E }) => ({ p, i, P, r, T, E }))(nearest(ms.at(-1)) ?? {}),
    });
  }
}

async function batch() {
  const pairs = await loadCatalog();
  const mi = await loadMarketInfo();
  // BATCH_QUOTE=ALL takes INR contracts too, BATCH_STEP=1 BATCH_N=329 takes every USDT contract.
  const quote = process.env.BATCH_QUOTE ?? 'USDT';
  const step = Number(process.env.BATCH_STEP ?? 3);
  const size = Number(process.env.BATCH_N ?? 100);
  const seconds = Number(process.env.BATCH_SECONDS ?? 60);
  const usdt = pairs.filter((p) => quote === 'ALL' || p.quoteAsset === quote).sort((a, b) => Number(mi[b.pair]?.quoteAssetVolume ?? 0) - Number(mi[a.pair]?.quoteAssetVolume ?? 0));
  const chosen = usdt.filter((_, i) => i % step === 0).slice(0, size).map((p) => p.pair);
  const perSym = new Map();
  let bytes = 0;
  let parseUs = 0;
  let frames = 0;
  const perSecond = [];
  let second = 0;
  let ack = null;
  const io = openIo('batch', {
    onRaw: (s) => {
      if (!s.startsWith('42["depthUpdate"')) return;
      const t = process.hrtime.bigint();
      const [, d] = JSON.parse(s.slice(2));
      parseUs += Number(process.hrtime.bigint() - t) / 1000;
      bytes += s.length;
      frames++;
      second++;
      const at = Date.now();
      const p = perSym.get(d.s) ?? { n: 0, last: at, maxGap: 0 };
      p.maxGap = Math.max(p.maxGap, at - p.last);
      p.last = at;
      p.n++;
      perSym.set(d.s, p);
    },
    onEvent: (name, d) => {
      if (name === 'subscriptionStatus') ack = { atMs: Date.now() - io.t0, subscribed: d.subscribed?.length, alreadySubscribed: d.alreadySubscribed?.length, keys: Object.keys(d).join(',') };
    },
  });
  await io.ready;
  const subAt = Date.now();
  io.emit('subscribe', { params: chosen.map((s) => topicOf(pairs, s)) });
  const tick = setInterval(() => {
    perSecond.push(second);
    second = 0;
  }, 1000);
  await sleep(seconds * 1000);
  clearInterval(tick);
  io.ws.close();
  const counts = [...perSym.values()].map((p) => p.n);
  log('batch', {
    requested: chosen.length,
    ack,
    delivering: perSym.size,
    silent: chosen.filter((s) => !perSym.has(s)).join(' '),
    frames,
    framesPerSecond: stats(perSecond),
    seconds,
    subscribeFrameBytes: JSON.stringify(['subscribe', { params: chosen.map((s) => topicOf(pairs, s)) }]).length + 2,
    bytesPerSecond: Math.round(bytes / seconds),
    bytesPerFrame: Math.round(bytes / Math.max(frames, 1)),
    parseUsPerFrame: Math.round(parseUs / Math.max(frames, 1)),
    framesPerSymbol: stats(counts),
    maxGapPerSymbolMs: stats([...perSym.values()].map((p) => p.maxGap)),
    quietest: [...perSym.entries()].sort((x, y) => x[1].n - y[1].n).slice(0, 5).map(([sym, p]) => `${sym} ${p.n}`).join(', '),
    closedEarly: io.closeCode,
    subscribedAtMs: subAt - io.t0,
  });
}

async function silence() {
  const quietTopic = 'irysusdt@depth_0.00001';
  const sockets = [
    openIo('A: connected, answers pings, no subscription'),
    openIo('B: subscribed, never answers pings', { answerPing: false }),
    openIo('C: subscribed, answers pings, never re-subscribes'),
    openIo('D: never sends the namespace connect', { connectNs: false }),
  ];
  const frames = new Map(sockets.map((s) => [s.label, []]));
  for (const s of sockets) s.ws.on('message', (d) => d.toString().startsWith('42["depthUpdate"') && frames.get(s.label).push(Date.now() - s.t0));
  await Promise.all(sockets.slice(0, 3).map((s) => s.ready));
  sockets[1].emit('subscribe', { params: ['btcusdt@depth_0.1'] });
  sockets[2].emit('subscribe', { params: [process.env.QUIET_TOPIC ?? quietTopic, 'ethusdt@depth_0.01'] });
  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline && sockets.some((s) => s.closeAt === null)) await sleep(500);
  for (const s of sockets) {
    const f = frames.get(s.label);
    log('silence', { label: s.label, openMs: s.openMs, connectMs: s.connectMs ?? null, serverPings: s.pings, closedAtMs: s.closeAt, closeCode: s.closeCode, closeReason: s.closeReason, depthFrames: f.length, lastDepthFrameAtMs: f.at(-1) ?? null, depthFramesAfter60s: f.filter((t) => t > 60_000).length });
    if (s.closeAt === null) s.ws.close();
  }
}

async function errors() {
  const events = [];
  const others = [];
  const io = openIo('errors', {
    onEvent: (name, d, at) => {
      const t = at - io.t0;
      if (Array.isArray(d) || d?.s !== undefined || d?.e !== undefined) {
        const k = `${name}:${d?.s ?? (Array.isArray(d) ? 'array' : d?.e)}`;
        const e = events.find((x) => x.k === k);
        if (e) {
          e.n++;
          e.lastAt = t;
          if (Array.isArray(d)) e.lengths.add(d.length);
        } else events.push({ k, n: 1, firstAt: t, lastAt: t, lengths: new Set(Array.isArray(d) ? [d.length] : []), symbols: Array.isArray(d) ? d.map((x) => x.s) : undefined, sample: JSON.stringify(d).slice(0, 400) });
        return;
      }
      others.push({ at: t, name, d: String(JSON.stringify(d)).slice(0, 300) });
    },
    onRaw: (s, at) => {
      if (!s.startsWith('42') && s !== '2' && !s.startsWith('0') && !s.startsWith('40')) others.push({ at: at - io.t0, raw: s.slice(0, 300) });
    },
  });
  // Malformed frames get a socket each, so one that silences a session cannot hide what the next one does.
  // A subscribe whose params is a string silenced every socket of this host for 26 to 39 s on 2026-09-23, so it is never sent again.
  // An unknown event name went out alongside it, so its effect is unknown, and it is not sent either.
  const sideCases = [
    ['params missing', (x) => x.emit('subscribe', { topics: ['xrpusdt@depth_0.0001'] })],
    ['text that is not a packet', (x) => x.ws.send('hello')],
  ];
  const sides = sideCases.map(([label, bad]) => {
    const seen = [];
    const x = openIo(label, { onRaw: (s, at) => s !== '2' && !s.startsWith('0') && seen.push({ at: at - x.t0, raw: s.slice(0, 160) }) });
    return { label, bad, seen, x };
  });
  await Promise.all([io.ready, ...sides.map((s) => s.x.ready)]);
  const sideRun = (async () => {
    for (const s of sides) s.badAt = Date.now() - s.x.t0;
    for (const s of sides) s.bad(s.x);
    await sleep(2000);
    for (const s of sides) s.x.emit('subscribe', { params: ['xrpusdt@depth_0.0001'] });
    await sleep(3000);
    for (const s of sides) s.x.emit('ping');
    await sleep(2000);
    for (const s of sides) if (s.x.closeAt === null) s.x.ws.close();
  })();
  const steps = [
    ['client ping', () => io.emit('ping')],
    ['unknown symbol', () => io.emit('subscribe', { params: ['nopeusdt@depth_0.1'] })],
    ['wrong grouping', () => io.emit('subscribe', { params: ['ethusdt@depth_1'] })],
    ['no grouping', () => io.emit('subscribe', { params: ['solusdt@depth'] })],
    ['uppercase topic', () => io.emit('subscribe', { params: ['BNBUSDT@depth_0.01'] })],
    ['unknown stream', () => io.emit('subscribe', { params: ['btcusdt@nope'] })],
    ['duplicate subscribe', () => io.emit('subscribe', { params: ['btcusdt@depth_0.1', 'btcusdt@depth_0.1'] })],
    ['ticker', () => io.emit('subscribe', { params: ['btcusdt@ticker'] })],
    ['aggTrade', () => io.emit('subscribe', { params: ['btcusdt@aggTrade'] })],
    ['kline', () => io.emit('subscribe', { params: ['btcusdt@kline_1m'] })],
    ['mark kline', () => io.emit('subscribe', { params: ['btcusdt@mpKline_1m'] })],
    ['bulk mark', () => io.emit('subscribe', { params: ['!markPrice@arr'] })],
    ['tickerArr', () => io.emit('subscribe', { params: ['tickerArr'] })],
    ['unsubscribe', () => io.emit('unsubscribe', { params: ['btcusdt@depth_0.1', 'btcusdt@ticker', 'btcusdt@aggTrade', 'btcusdt@kline_1m', 'btcusdt@mpKline_1m', '!markPrice@arr', 'tickerArr'] })],
    ['client ping after unsubscribe', () => io.emit('ping')],
  ];
  for (const [name, fn] of steps) {
    others.push({ at: Date.now() - io.t0, step: name });
    fn();
    await sleep(name === 'unsubscribe' ? 5000 : 1500);
  }
  await sleep(1500);
  io.ws.close();
  await sideRun;
  for (const o of others) log('reply', o);
  const catalog = process.env.PROBE_CATALOG ? new Set(JSON.parse(readFileSync(process.env.PROBE_CATALOG, 'utf8')).data.pairs.map((p) => p.pair)) : null;
  for (const e of events) {
    const outside = e.symbols && catalog ? e.symbols.filter((x) => !catalog.has(x)) : undefined;
    const inside = e.symbols && catalog ? e.symbols.filter((x) => catalog.has(x)).length : undefined;
    log('stream', { ...e, symbols: undefined, lengths: [...e.lengths], inCatalog: inside, notInCatalog: outside?.length, notInCatalogSample: outside?.slice(0, 12).join(' ') });
  }
  log('errorsSession', { closeCode: io.closeCode, closeReason: io.closeReason, closeAtMs: io.closeAt });
  for (const s of sides) log('side', { label: s.label, badAtMs: s.badAt, closeAtMs: s.x.closeAt, closeCode: s.x.closeCode, closeReason: s.x.closeReason, framesAfterConnect: s.seen.filter((f) => f.at >= s.badAt).slice(0, 6), depthFrames: s.seen.filter((f) => f.raw.startsWith('42["depthUpdate"')).length });
}

async function deflate() {
  const io = openIo('deflate', { deflate: true });
  await io.ready;
  await sleep(1000);
  log('deflate', { offered: 'permessage-deflate', negotiated: io.extensions, openMs: io.openMs });
  io.ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, errors, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
