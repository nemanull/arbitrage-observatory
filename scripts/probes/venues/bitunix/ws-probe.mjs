// Bitunix futures WebSocket probe: book channels, level counts and order, idle repeats, size unit against REST, price channel, errors, keepalive, silence, a batch of perpetuals on one connection, and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// The venue allows 5 client messages per second per connection, pings and pongs included, so every mode sends at most about 2 per second.
// Run from server/: node ../scripts/probes/venues/bitunix/ws-probe.mjs [book|errors|batch|silence|pping|deflate]
//   book     depth_books, depth_book15, depth_book5, depth_book1, price and ticker on USDT-M, USDC-M and coin-M perps for 60 s, with a REST book compare. About 65 s.
//   errors   unknown, delisted, lowercase, preview and API-disabled symbols, unknown channel and op, bad JSON, duplicate subscribe, pings. About 15 s.
//   batch    depth_book15 on 300 USDT perps in one frame for 60 s, then 10 more to find the cap.
//   silence  four sockets that differ only in what the client sends, for up to 120 s.
//   pping    three sockets that send one protocol ping, with and without a subscription before it. About 25 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep a few trimmed frames. Recorded in docs/profiles/bitunix/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://fapi.bitunix.com/public/';
const API = 'https://fapi.bitunix.com/api/v1/futures/market';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const nowSec = () => Math.floor(Date.now() / 1000);
const sub = (args) => JSON.stringify({ op: 'subscribe', args });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 3000) + '\n');
}

async function getJson(path) {
  const res = await fetch(`${API}/${path}`);
  return res.json();
}

function pct(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// Quiet symbols come from the 24 h quote volume, so the choice follows the market of the day.
async function pickSymbols() {
  const [pairs, tickers] = await Promise.all([getJson('trading_pairs'), getJson('tickers')]);
  const vol = new Map(tickers.data.map((t) => [t.symbol, Number(t.quoteVol)]));
  const usdt = pairs.data
    .filter((p) => p.quote === 'USDT' && p.symbolStatus === 'OPEN' && p.isApiSupported)
    .map((p) => ({ symbol: p.symbol, vol: vol.get(p.symbol) ?? 0 }))
    .sort((a, b) => b.vol - a.vol);
  return { usdt, quiet: usdt[Math.floor(usdt.length * 0.85)].symbol };
}

function open(opts = { perMessageDeflate: false }) {
  const ws = new WebSocket(WS_URL, opts);
  const t0 = Date.now();
  ws.on('error', (e) => log('socket_error', { message: e.message }));
  return { ws, t0 };
}

function streamKey(j) {
  return `${j.ch}:${j.symbol ?? ''}`;
}

function orderOk(levels, desc) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]);
    const b = Number(levels[i][0]);
    if (desc ? b >= a : b <= a) return false;
  }
  return true;
}

async function book() {
  const { quiet } = await pickSymbols();
  const args = [
    { symbol: 'BTCUSDT', ch: 'depth_books' },
    { symbol: quiet, ch: 'depth_books' },
    { symbol: 'BTCUSD', ch: 'depth_books' },
    ...['BTCUSDT', 'ETHUSDT', quiet, 'BTCUSD', 'BTCUSDC', 'ETHUSD'].map((symbol) => ({ symbol, ch: 'depth_book15' })),
    { symbol: 'ETHUSDT', ch: 'depth_book5' },
    { symbol: 'ETHUSDT', ch: 'depth_book1' },
    ...['BTCUSDT', quiet, 'BTCUSD', 'BTCUSDC'].map((symbol) => ({ symbol, ch: 'price' })),
    { symbol: 'BTCUSDT', ch: 'ticker' },
  ];
  log('book_start', { quiet, streams: args.length });

  const { ws, t0 } = open();
  const stats = new Map();
  const last = new Map();
  const controls = [];
  const priceChanges = new Map();
  let subSentAt = 0;

  ws.on('upgrade', (r) => log('upgrade', { status: r.statusCode, ext: r.headers['sec-websocket-extensions'] ?? null, ms: Date.now() - t0 }));
  ws.on('ping', () => log('server_ping', { ms: Date.now() - t0 }));
  ws.on('open', () => {
    log('open', { ms: Date.now() - t0 });
    subSentAt = Date.now();
    ws.send(sub(args));
  });

  ws.on('message', (m, isBinary) => {
    const at = Date.now();
    const text = m.toString();
    const p0 = process.hrtime.bigint();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      controls.push({ at: at - t0, isBinary, text: text.slice(0, 200) });
      return;
    }
    const parseUs = Number(process.hrtime.bigint() - p0) / 1000;

    if (!j.ch) {
      controls.push({ at: at - t0, text: text.slice(0, 300) });
      capture('bitunix-control.txt', text);
      return;
    }

    const key = streamKey(j);
    let s = stats.get(key);
    if (!s) {
      s = { frames: 0, bytes: 0, gaps: [], firstMs: at - subSentAt, bids: [], asks: [], badBidOrder: 0, badAskOrder: 0, repeats: 0, tsBack: 0, lag: [], parseUs: [], keys: Object.keys(j).join(','), dataKeys: Object.keys(j.data ?? {}).join(',') };
      stats.set(key, s);
      capture('bitunix-first-frames.txt', text);
    }
    const prev = last.get(key);
    s.frames++;
    s.bytes += text.length;
    s.parseUs.push(parseUs);
    s.lag.push(at - j.ts);
    if (prev) {
      s.gaps.push(at - prev.at);
      if (j.ts < prev.ts) s.tsBack++;
      if (JSON.stringify(j.data) === prev.data) s.repeats++;
    }

    if (j.ch.startsWith('depth_')) {
      const b = j.data?.b ?? [];
      const a = j.data?.a ?? [];
      s.bids.push(b.length);
      s.asks.push(a.length);
      if (!orderOk(b, true)) s.badBidOrder++;
      if (!orderOk(a, false)) s.badAskOrder++;
      if (j.ch === 'depth_books' && s.frames === 2) capture('bitunix-books-second.txt', text.slice(0, 600));
    }

    if (j.ch === 'price') {
      const pc = priceChanges.get(j.symbol) ?? { ip: 0, mp: 0, fr: 0, nft: 0, frames: 0, first: j.data, lastData: null };
      if (pc.lastData) {
        for (const f of ['ip', 'mp', 'fr', 'nft']) if (pc.lastData[f] !== j.data[f]) pc[f]++;
      }
      pc.frames++;
      pc.lastData = j.data;
      priceChanges.set(j.symbol, pc);
    }

    last.set(key, { at, ts: j.ts, data: JSON.stringify(j.data), levels: j.data });
  });

  let closed = null;
  ws.on('close', (code, reason) => {
    closed = { code, reason: reason.toString(), ms: Date.now() - t0 };
  });

  // REST compare at 30 s: the latest depth_book15 frame against the REST book fetched right after it.
  await sleep(30_000);
  for (const symbol of ['BTCUSDT', quiet, 'BTCUSD', 'BTCUSDC']) {
    const wsFrame = last.get(`depth_book15:${symbol}`);
    const t = Date.now();
    const rest = await getJson(`depth?symbol=${symbol}&limit=15`);
    const rb = rest.data?.bids ?? [];
    const ra = rest.data?.asks ?? [];
    const wb = wsFrame?.levels?.b ?? [];
    const wa = wsFrame?.levels?.a ?? [];
    const same = (x, y) => x.filter((l, i) => y[i] && Number(y[i][0]) === Number(l[0]) && Number(y[i][1]) === Number(l[1])).length;
    const samePrice = (x, y) => x.filter((l, i) => y[i] && Number(y[i][0]) === Number(l[0])).length;
    log('rest_compare', { symbol, restMs: Date.now() - t, wsAgeMs: wsFrame ? t - wsFrame.at : null, bidsSame: same(wb, rb), asksSame: same(wa, ra), bidPricesSame: samePrice(wb, rb), askPricesSame: samePrice(wa, ra), wsTopBid: wb[0], restTopBid: rb[0], wsTopAsk: wa[0], restTopAsk: ra[0], restNumberTypes: typeof rb[0]?.[0] });
  }
  const fr = await getJson('funding_rate/batch');
  for (const symbol of ['BTCUSDT', quiet, 'BTCUSD', 'BTCUSDC']) {
    const row = fr.data.find((d) => d.symbol === symbol);
    const pc = priceChanges.get(symbol);
    log('price_vs_rest', { symbol, ws: pc?.lastData, rest: row && { markPrice: row.markPrice, indexPrice: row.indexPrice, fundingRate: row.fundingRate, nextFundingTime: row.nextFundingTime } });
  }

  await sleep(30_000);
  ws.close();
  await sleep(300);

  for (const [key, s] of stats) {
    const secs = (Date.now() - subSentAt) / 1000;
    log('stream', {
      key,
      frames: s.frames,
      perSec: +(s.frames / secs).toFixed(2),
      kbPerFrame: +(s.bytes / s.frames / 1024).toFixed(1),
      firstMs: s.firstMs,
      gapMs: { min: pct(s.gaps, 0), med: pct(s.gaps, 50), max: pct(s.gaps, 100) },
      levels: s.bids.length ? { bids: [pct(s.bids, 0), pct(s.bids, 100)], asks: [pct(s.asks, 0), pct(s.asks, 100)] } : undefined,
      badOrder: s.bids.length ? [s.badBidOrder, s.badAskOrder] : undefined,
      repeats: s.repeats,
      tsBack: s.tsBack,
      lagMs: { min: pct(s.lag, 0), med: pct(s.lag, 50), max: pct(s.lag, 100) },
      parseUsMed: +pct(s.parseUs, 50).toFixed(1),
      keys: s.keys,
      dataKeys: s.dataKeys.slice(0, 60),
    });
  }
  for (const [symbol, pc] of priceChanges) log('price_changes', { symbol, frames: pc.frames, changed: { ip: pc.ip, mp: pc.mp, fr: pc.fr, nft: pc.nft }, first: pc.first });
  log('controls', { n: controls.length, first: controls.slice(0, 5) });
  log('closed', { closed });
}

async function errors() {
  const { ws, t0 } = open();
  const events = [];
  const data = new Map();
  const firstFrame = new Map();
  let current = 'open';
  ws.on('ping', () => events.push({ during: current, at: Date.now() - t0, frame: 'server protocol ping' }));
  ws.on('pong', () => events.push({ during: current, at: Date.now() - t0, frame: 'protocol pong' }));
  ws.on('message', (m) => {
    const text = m.toString();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      events.push({ during: current, at: Date.now() - t0, frame: text.slice(0, 200) });
      return;
    }
    if (j.ch) {
      data.set(streamKey(j), (data.get(streamKey(j)) ?? 0) + 1);
      if (!firstFrame.has(streamKey(j))) firstFrame.set(streamKey(j), text.slice(0, 240));
      return;
    }
    events.push({ during: current, at: Date.now() - t0, frame: text.slice(0, 300) });
  });
  let closed = null;
  ws.on('close', (code, reason) => {
    closed = { code, reason: reason.toString(), at: Date.now() - t0, during: current };
  });
  await new Promise((r) => ws.once('open', r));

  const steps = [
    ['unknown symbol', sub([{ symbol: 'NOPEUSDT', ch: 'depth_book15' }])],
    ['unknown channel', sub([{ symbol: 'BTCUSDT', ch: 'nope_channel' }])],
    ['not json', 'hello'],
    ['delisted symbol MILKUSDT', sub([{ symbol: 'MILKUSDT', ch: 'depth_book15' }])],
    ['lowercase symbol', sub([{ symbol: 'btcusdt', ch: 'depth_book15' }])],
    ['preview symbol FDUSDUSDT', sub([{ symbol: 'FDUSDUSDT', ch: 'depth_book15' }])],
    ['api disabled symbol QQQUSDT', sub([{ symbol: 'QQQUSDT', ch: 'depth_book15' }])],
    ['subscribe ETHUSDT', sub([{ symbol: 'ETHUSDT', ch: 'depth_book15' }])],
    ['duplicate ETHUSDT', sub([{ symbol: 'ETHUSDT', ch: 'depth_book15' }])],
    ['no symbol', sub([{ ch: 'depth_book15' }])],
    ['unknown op', JSON.stringify({ op: 'nope' })],
    ['app ping', JSON.stringify({ op: 'ping', ping: nowSec() })],
    ['protocol ping', null],
    ['unsubscribe with channel key', JSON.stringify({ op: 'unsubscribe', args: [{ symbol: 'ETHUSDT', channel: 'depth_book15' }] })],
    ['unsubscribe with ch key', JSON.stringify({ op: 'unsubscribe', args: [{ symbol: 'ETHUSDT', ch: 'depth_book15' }] })],
  ];
  for (const [name, frame] of steps) {
    if (ws.readyState !== ws.OPEN) break;
    current = name;
    const before = new Map(data);
    const sentAt = Date.now();
    if (frame === null) ws.ping();
    else ws.send(frame);
    if (name.includes('ping')) {
      const reply = await new Promise((r) => {
        const onMessage = (m) => m.toString().includes('"pong"') && on();
        const t = setTimeout(() => {
          ws.off('message', onMessage);
          r(null);
        }, 700);
        const on = () => {
          clearTimeout(t);
          ws.off('message', onMessage);
          r(Date.now() - sentAt);
        };
        if (frame === null) ws.once('pong', on);
        else ws.on('message', onMessage);
      });
      log('rtt', { name, ms: reply });
    }
    await sleep(700);
    const newStreams = [...data.keys()].filter((k) => !before.has(k)).map((k) => firstFrame.get(k));
    log('step', { name, newStreams, replies: events.filter((e) => e.during === name).map((e) => e.frame) });
  }
  current = 'tail';
  const beforeTail = new Map(data);
  await sleep(3000);
  const tail = Object.fromEntries([...data].map(([k, n]) => [k, n - (beforeTail.get(k) ?? 0)]).filter(([, n]) => n > 0));
  log('tail', { framesIn3s: tail, replies: events.filter((e) => e.during === 'tail').map((e) => e.frame).slice(0, 5) });
  ws.close();
  await sleep(300);
  log('closed', { closed });
}

async function batch() {
  const { usdt } = await pickSymbols();
  const chosen = usdt.slice(0, 310).map((u) => u.symbol);
  const first = chosen.slice(0, 300);
  const extra = chosen.slice(300);
  const { ws, t0 } = open();
  const per = new Map();
  const firstAt = new Map();
  const perSecond = new Map();
  const controls = [];
  const lastData = new Map();
  const repeats = new Map();
  const emptySide = new Set();
  let bytes = 0;
  let frames = 0;
  let parseNs = 0n;
  let sentAt = 0;
  ws.on('message', (m) => {
    const text = m.toString();
    const p0 = process.hrtime.bigint();
    const j = JSON.parse(text);
    parseNs += process.hrtime.bigint() - p0;
    if (!j.ch) {
      controls.push({ at: Date.now() - t0, text: text.slice(0, 300) });
      return;
    }
    frames++;
    bytes += text.length;
    const sec = Math.floor((Date.now() - sentAt) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    per.set(j.symbol, (per.get(j.symbol) ?? 0) + 1);
    if (!firstAt.has(j.symbol)) firstAt.set(j.symbol, Date.now() - sentAt);
    // A push whose levels equal the previous push of the same stream is an idle repeat.
    const data = JSON.stringify(j.data);
    if (lastData.get(j.symbol) === data) repeats.set(j.symbol, (repeats.get(j.symbol) ?? 0) + 1);
    lastData.set(j.symbol, data);
    if (j.data?.b?.length === 0 || j.data?.a?.length === 0 || j.data?.b?.[0]?.[0] === '' || j.data?.a?.[0]?.[0] === '') emptySide.add(j.symbol);
  });
  let closed = null;
  ws.on('close', (code, reason) => {
    closed = { code, reason: reason.toString(), at: Date.now() - t0 };
  });
  await new Promise((r) => ws.once('open', r));
  sentAt = Date.now();
  ws.send(sub(first.map((symbol) => ({ symbol, ch: 'depth_book15' }))));
  await sleep(10_000);
  const deliveringAt10s = first.filter((s) => per.has(s)).length;
  ws.send(sub(extra.map((symbol) => ({ symbol, ch: 'depth_book15' }))));
  await sleep(50_000);
  const secs = (Date.now() - sentAt) / 1000;
  const counts = [...perSecond.entries()].filter(([s]) => s >= 1 && s < Math.floor(secs)).map(([, n]) => n);
  const lastFirst = Math.max(...first.filter((s) => firstAt.has(s)).map((s) => firstAt.get(s)));
  log('batch', {
    subscribed: first.length,
    deliveringAt10s,
    lastFirstFrameMs: lastFirst,
    silent: first.filter((s) => !per.has(s)).slice(0, 20),
    extraDelivering: extra.filter((s) => per.has(s)).length,
    extraSent: extra.length,
    framesPerSec: { mean: +(frames / secs).toFixed(0), median: pct(counts, 50), peak: pct(counts, 100) },
    kbPerSec: +(bytes / secs / 1024).toFixed(0),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: +(Number(parseNs) / 1000 / frames).toFixed(1),
    quietestStreamFrames: pct([...per.values()], 0),
    busiestStreamFrames: pct([...per.values()], 100),
    repeatFrames: [...repeats.values()].reduce((a, b) => a + b, 0),
    streamsWithRepeats: repeats.size,
    mostRepeats: [...repeats].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}:${n}/${per.get(k)}`),
    streamsWithAnEmptySide: [...emptySide].slice(0, 10),
    controls: controls.slice(0, 6),
  });
  ws.close();
  await sleep(300);
  log('closed', { closed });
}

async function silence() {
  const { quiet } = await pickSymbols();
  const plans = [
    { name: 'nothing sent', setup: () => {} },
    { name: 'quiet book15, no ping', setup: (ws) => ws.send(sub([{ symbol: quiet, ch: 'depth_book15' }])) },
    { name: 'no subscription, app ping every 20 s', setup: (ws, timers) => timers.push(setInterval(() => ws.send(JSON.stringify({ op: 'ping', ping: nowSec() })), 20_000)) },
    { name: 'no subscription, protocol ping every 20 s', setup: (ws, timers) => timers.push(setInterval(() => ws.ping(), 20_000)) },
  ];
  const results = await Promise.all(
    plans.map(
      (plan) =>
        new Promise((resolve) => {
          const { ws, t0 } = open();
          const timers = [];
          const seen = { frames: 0, serverPings: 0, pongs: 0, lastFrameAt: 0 };
          ws.on('ping', () => seen.serverPings++);
          ws.on('pong', () => seen.pongs++);
          ws.on('message', (m) => {
            seen.frames++;
            seen.lastFrameAt = Date.now() - t0;
            if (m.toString().includes('pong')) seen.pongs++;
          });
          ws.on('open', () => plan.setup(ws, timers));
          const done = (closed) => {
            timers.forEach(clearInterval);
            resolve({ name: plan.name, closed, ...seen });
          };
          ws.on('close', (code, reason) => done({ code, reason: reason.toString(), atMs: Date.now() - t0 }));
          setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.removeAllListeners('close');
              ws.close();
              done(null);
            }
          }, 120_000);
        }),
    ),
  );
  for (const r of results) log('silence', { quiet, ...r });
}

// Whether a protocol ping keeps a socket, breaks it, or depends on what the socket sent before.
async function pping() {
  const plans = [
    { name: 'no subscription, protocol ping at 5 s', subscribe: false, at: 5_000 },
    { name: 'no subscription, protocol ping at 20 s', subscribe: false, at: 20_000 },
    { name: 'subscribed, protocol ping at 5 s', subscribe: true, at: 5_000 },
  ];
  const results = await Promise.all(
    plans.map(
      (plan) =>
        new Promise((resolve) => {
          const { ws, t0 } = open();
          const seen = { pongAt: null, closed: null };
          let pingAt = 0;
          ws.on('pong', () => (seen.pongAt = Date.now() - pingAt));
          ws.on('open', () => {
            if (plan.subscribe) ws.send(sub([{ symbol: 'ETHUSDT', ch: 'depth_book1' }]));
            setTimeout(() => {
              pingAt = Date.now();
              ws.ping();
            }, plan.at);
          });
          ws.on('close', (code) => (seen.closed = { code, atMs: Date.now() - t0 }));
          setTimeout(() => {
            ws.close();
            resolve({ name: plan.name, pongAfterMs: seen.pongAt, closed: seen.closed });
          }, 25_000);
        }),
    ),
  );
  for (const r of results) log('pping', r);
}

async function deflate() {
  const { ws, t0 } = open({ perMessageDeflate: true });
  ws.on('upgrade', (r) => log('deflate_upgrade', { status: r.statusCode, ext: r.headers['sec-websocket-extensions'] ?? null, ms: Date.now() - t0 }));
  let n = 0;
  ws.on('message', (m, isBinary) => {
    if (n++ < 2) log('deflate_frame', { isBinary, text: m.toString().slice(0, 120) });
  });
  await new Promise((r) => ws.once('open', r));
  ws.send(sub([{ symbol: 'BTCUSDT', ch: 'depth_book1' }]));
  await sleep(1500);
  ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, pping, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('run', { mode, at: new Date().toISOString() });
await modes[mode]();
process.exit(0);
