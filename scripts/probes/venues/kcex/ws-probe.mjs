// KCEX futures WebSocket probe: book channels, version chain and gap rule, size unit against REST, anchor channels, keepalive, silence, errors, and a batch of perpetuals on one connection.
// KCEX publishes no API documentation, so the URL and methods are the ones the futures web app uses, found in its JavaScript bundle.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, and send a User-Agent, without which the handshake is refused with 403.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/kcex/ws-probe.mjs [book|batch|silence|deflate]
//   book     sub.depth with compress false and with the default, sub.depth.full limits, index, fair, funding and tickers channels, errors, REST compare. About 80 s.
//   batch    sub.depth on 100 USDT perpetuals on one connection for 60 s.
//   silence  four sockets that differ only in what the client sends or subscribes, for up to 120 s.
//   deflate  offers permessage-deflate once, opens once without a User-Agent, tries the compress and gzip parameters and a USDC contract for 5 s, then an unsubscribe. About 15 s.
// Set PROBE_OUT_DIR to keep a trimmed sample of raw frames. Recorded in docs/profiles/kcex/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_FUT = 'wss://www.kcex.com/fapi/edge';
const REST = 'https://www.kcex.com/fapi/v1';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : null);
const kept = {};

function capture(name, text, max = 40) {
  if (!OUT) return;
  kept[name] = (kept[name] ?? 0) + 1;
  if (kept[name] > max) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

async function rest(path) {
  const r = await fetch(`${REST}${path}`, { headers: { 'user-agent': UA } });
  return r.json();
}

function open(opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(URL_FUT, { perMessageDeflate: opts.deflate ?? false, headers: opts.noUa ? {} : { 'user-agent': UA } });
  ws.t0 = t0;
  return new Promise((resolve) => {
    ws.on('upgrade', (res) => (ws.upgrade = { ms: Date.now() - t0, status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null }));
    ws.on('unexpected-response', (_q, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ refused: { status: res.statusCode, server: res.headers.server, amz: !!res.headers['x-amz-request-id'], body: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160) } }));
    });
    ws.on('open', () => resolve({ ws, openMs: Date.now() - t0 }));
    ws.on('error', () => {});
  });
}

const send = (ws, o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));

// A book rebuilt from push.depth, with the top twenty kept per version for a later REST compare.
class Book {
  constructor(symbol) {
    this.symbol = symbol;
    this.bids = new Map();
    this.asks = new Map();
    this.last = null;
    this.buffer = [];
    this.seeded = false;
    this.gaps = 0;
    this.applied = 0;
    this.history = new Map();
    this.unsortedBids = 0;
    this.unsortedAsks = 0;
    this.emptyFrames = 0;
    this.merged = 0;
    this.maxLevels = 0;
    this.repeats = 0;
    this.gapSample = [];
  }
  seed(snap) {
    this.bids = new Map(snap.bids.map((l) => [l[0], l[1]]));
    this.asks = new Map(snap.asks.map((l) => [l[0], l[1]]));
    this.last = snap.version;
    this.seeded = true;
    const pending = this.buffer;
    this.buffer = [];
    let dropped = 0;
    let firstBegin = null;
    for (const d of pending) {
      const end = d.end ?? d.version;
      if (end <= this.last) {
        dropped++;
        continue;
      }
      if (firstBegin === null) firstBegin = d.begin ?? d.version;
      this.apply(d);
    }
    return { snapVersion: snap.version, buffered: pending.length, dropped, firstBeginAfterSnap: firstBegin };
  }
  onDelta(d) {
    if (!this.seeded) {
      this.buffer.push(d);
      return;
    }
    this.apply(d);
  }
  apply(d) {
    const begin = d.begin ?? d.version;
    const end = d.end ?? d.version;
    if (d.begin !== undefined) this.merged++;
    if (this.last !== null && begin > this.last + 1) {
      this.gaps++;
      if (this.gapSample.length < 3) this.gapSample.push({ expected: this.last + 1, got: begin, atIso: new Date().toISOString() });
    }
    if (this.last !== null && end <= this.last) {
      this.repeats++;
      return;
    }
    const desc = (a) => a.every((x, i) => i === 0 || a[i - 1][0] > x[0]);
    const asc = (a) => a.every((x, i) => i === 0 || a[i - 1][0] < x[0]);
    if (d.bids.length > 1 && !desc(d.bids)) this.unsortedBids++;
    if (d.asks.length > 1 && !asc(d.asks)) this.unsortedAsks++;
    if (!d.bids.length && !d.asks.length) this.emptyFrames++;
    for (const [p, v] of d.bids) v === 0 ? this.bids.delete(p) : this.bids.set(p, v);
    for (const [p, v] of d.asks) v === 0 ? this.asks.delete(p) : this.asks.set(p, v);
    this.last = end;
    this.applied++;
    this.maxLevels = Math.max(this.maxLevels, this.bids.size, this.asks.size);
    this.history.set(end, this.top(20));
    if (this.history.size > 5000) this.history.delete(this.history.keys().next().value);
  }
  top(n) {
    const b = [...this.bids].sort((x, y) => y[0] - x[0]).slice(0, n);
    const a = [...this.asks].sort((x, y) => x[0] - y[0]).slice(0, n);
    return { b, a };
  }
}

function compare(book, snap) {
  const at = book.history.get(snap.version);
  if (!at) return { restVersion: snap.version, bookLast: book.last, exact: false };
  const eq = (x, y) => x.filter((l, i) => y[i] && l[0] === y[i][0] && l[1] === y[i][1]).length;
  return { restVersion: snap.version, exact: true, bidsEqual: eq(snap.bids.slice(0, 20), at.b), asksEqual: eq(snap.asks.slice(0, 20), at.a), of: Math.min(20, snap.bids.length) + Math.min(20, snap.asks.length) };
}

async function pickContracts() {
  const t = (await rest('/contract/ticker')).data.filter((r) => r.symbol.endsWith('_USDT'));
  const d = new Map((await rest('/contract/detail')).data.map((r) => [r.symbol, r]));
  const ranked = t.filter((r) => d.get(r.symbol) && !d.get(r.symbol).isHidden).sort((a, b) => b.amount24 - a.amount24);
  return { ranked, detail: d };
}

async function book() {
  const { ranked, detail } = await pickContracts();
  const quiet = ranked[Math.floor(ranked.length * 0.9)].symbol;
  log('contracts', { usdtVisible: ranked.length, quiet, quietAmount24: Math.round(ranked[Math.floor(ranked.length * 0.9)].amount24) });

  const o = await open();
  if (!o.ws) return log('refused', o.refused);
  const ws = o.ws;
  log('open', { ms: o.openMs, upgrade: ws.upgrade });
  const books = { BTC_USDT: new Book('BTC_USDT'), ETH_USDT: new Book('ETH_USDT'), [quiet]: new Book(quiet) };
  const counts = {};
  const channelTimes = {};
  const firstOf = {};
  const acks = [];
  const errors = [];
  const pongs = [];
  const pingSent = [];
  const tickers = { frames: 0, rows: 0, symbols: new Set(), ages: [], sizes: [] };
  const fullFrames = {};
  const parseUs = [];
  let bytes = 0;
  let binary = 0;

  ws.on('message', (data, isBinary) => {
    bytes += data.length;
    if (isBinary) {
      binary++;
      capture('binary.txt', data.toString('base64'), 5);
      return;
    }
    const t = process.hrtime.bigint();
    const m = JSON.parse(data.toString());
    parseUs.push(Number(process.hrtime.bigint() - t) / 1000);
    const ch = m.channel;
    counts[ch] = (counts[ch] ?? 0) + 1;
    const now = Date.now();
    (channelTimes[`${ch}:${m.symbol ?? ''}`] ??= []).push(now);
    if (!firstOf[ch]) {
      firstOf[ch] = true;
      capture('first-frames.jsonl', data.toString());
    }
    if (ch?.startsWith('rs.sub') || ch?.startsWith('rs.unsub')) acks.push({ ch, data: m.data, atMs: now - ws.t0 });
    else if (ch === 'rs.error') errors.push({ data: m.data, atMs: now - ws.t0 });
    else if (ch === 'pong') pongs.push(now - pingSent.shift());
    else if (ch === 'push.depth') {
      const b = books[m.symbol];
      if (b) b.onDelta(m.data);
      capture(`depth-${m.symbol}.jsonl`, data.toString(), 15);
    } else if (ch === 'push.depth.full') {
      const f = (fullFrames[m.symbol] ??= { n: 0, bids: [], asks: [], versions: [] });
      f.n++;
      f.bids.push(m.data.bids.length);
      f.asks.push(m.data.asks.length);
      f.versions.push(m.data.version);
      capture('depth-full.jsonl', data.toString(), 5);
    } else if (ch === 'push.tickers') {
      tickers.frames++;
      tickers.rows += m.data.length;
      tickers.sizes.push(m.data.length);
      for (const r of m.data) {
        tickers.symbols.add(r.symbol);
        if (r.symbol === 'BTC_USDT') tickers.ages.push(now - r.timestamp);
      }
    } else {
      capture(`other-${ch}.jsonl`, data.toString(), 5);
    }
  });
  let closed = null;
  ws.on('close', (code, reason) => (closed = { code, reason: reason.toString(), atMs: Date.now() - ws.t0 }));

  send(ws, { method: 'sub.depth', param: { symbol: 'BTC_USDT', compress: false } });
  send(ws, { method: 'sub.depth', param: { symbol: 'ETH_USDT' } });
  send(ws, { method: 'sub.depth', param: { symbol: quiet } });
  for (const [s, lim] of [['SOL_USDT', 5], ['XRP_USDT', 10], ['DOGE_USDT', 20], ['ADA_USDT', 50], ['SUI_USDT', 100]]) send(ws, { method: 'sub.depth.full', param: { symbol: s, limit: lim } });
  send(ws, { method: 'sub.index.price', param: { symbol: 'BTC_USDT' } });
  send(ws, { method: 'sub.fair.price', param: { symbol: 'BTC_USDT' } });
  send(ws, { method: 'sub.funding.rate', param: { symbol: 'BTC_USDT' } });
  send(ws, { method: 'sub.ticker', param: { symbol: 'BTC_USDT' } });
  send(ws, { method: 'sub.tickers', param: {} });
  send(ws, { method: 'sub.depth', param: { symbol: 'NOPE_USDT' } });
  send(ws, { method: 'sub.nope', param: { symbol: 'BTC_USDT' } });
  send(ws, 'not json');
  send(ws, { method: 'sub.depth', param: { symbol: 'ETH_USDT' } });

  // Seed each book from REST once a few deltas are buffered.
  await sleep(1500);
  for (const b of Object.values(books)) {
    const snap = (await rest(`/contract/depth/${b.symbol}?limit=100`)).data;
    log('seed', { symbol: b.symbol, ...b.seed(snap), restBids: snap.bids.length, restAsks: snap.asks.length });
  }

  const ping = setInterval(() => {
    pingSent.push(Date.now());
    send(ws, { method: 'ping' });
  }, 10_000);

  const compares = [];
  for (const at of [20_000, 40_000, 60_000]) {
    await sleep(at - (Date.now() - ws.t0));
    for (const s of ['BTC_USDT', 'ETH_USDT', quiet]) {
      const snap = (await rest(`/contract/depth/${s}?limit=20`)).data;
      await sleep(2000);
      compares.push({ symbol: s, ...compare(books[s], snap) });
    }
  }
  await sleep(Math.max(0, 78_000 - (Date.now() - ws.t0)));
  clearInterval(ping);
  send(ws, { method: 'unsub.depth', param: { symbol: 'ETH_USDT' } });
  await sleep(1000);
  ws.close();
  await sleep(300);

  const secs = (Date.now() - ws.t0) / 1000;
  log('acks', { acks });
  log('errors', { errors });
  log('pongs', { rttMs: pongs });
  log('counts', { counts, seconds: +secs.toFixed(1), binaryFrames: binary, kbPerSec: +(bytes / 1024 / secs).toFixed(1), parseUsMedian: +pct(parseUs, 0.5).toFixed(1) });
  for (const b of Object.values(books)) {
    const t = channelTimes[`push.depth:${b.symbol}`] ?? [];
    const gapsMs = t.slice(1).map((x, i) => x - t[i]);
    log('book', { symbol: b.symbol, frames: t.length, applied: b.applied, mergedFrames: b.merged, gaps: b.gaps, emptyFrames: b.emptyFrames, repeatedVersions: b.repeats, gapSample: b.gapSample, unsortedBidFrames: b.unsortedBids, unsortedAskFrames: b.unsortedAsks, maxLevelsHeld: b.maxLevels, longestSilenceMs: gapsMs.length ? Math.max(...gapsMs) : null, bidsHeld: b.bids.size, asksHeld: b.asks.size, sizeUnit: detail.get(b.symbol)?.contractSize });
  }
  log('compare_rest', { compares });
  log('depth_full', { frames: Object.fromEntries(Object.entries(fullFrames).map(([s, f]) => [s, { n: f.n, bids: [Math.min(...f.bids), Math.max(...f.bids)], asks: [Math.min(...f.asks), Math.max(...f.asks)], versionSteps: [...new Set(f.versions.slice(1).map((v, i) => v - f.versions[i]))].slice(0, 8) }])) });
  const iv = (k) => {
    const t = channelTimes[k] ?? [];
    const g = t.slice(1).map((x, i) => x - t[i]);
    return { n: t.length, medianGapMs: pct(g, 0.5), maxGapMs: g.length ? Math.max(...g) : null };
  };
  log('anchor_channels', { index: iv('push.index.price:BTC_USDT'), fair: iv('push.fair.price:BTC_USDT'), funding: iv('push.funding.rate:BTC_USDT'), ticker: iv('push.ticker:BTC_USDT'), tickers: { ...iv('push.tickers:'), rowsPerFrame: [Math.min(...tickers.sizes), pct(tickers.sizes, 0.5), Math.max(...tickers.sizes)], distinctSymbols: tickers.symbols.size, notInDetail: [...tickers.symbols].filter((x) => !detail.has(x)), btcRows: tickers.ages.length, btcAgeMs: [Math.min(...tickers.ages), pct(tickers.ages, 0.5), Math.max(...tickers.ages)] } });
  log('closed', { closed });
}

async function batch() {
  const { ranked } = await pickContracts();
  const step = Math.floor(ranked.length / 100);
  const picks = ranked.filter((_, i) => i % step === 0).slice(0, 100).map((r) => r.symbol);
  const o = await open();
  if (!o.ws) return log('refused', o.refused);
  const ws = o.ws;
  const last = new Map();
  const frames = new Map(picks.map((s) => [s, 0]));
  let gaps = 0;
  const gapSample = [];
  let merged = 0;
  let n = 0;
  let bytes = 0;
  let acks = 0;
  const errors = [];
  const parseUs = [];
  const perSec = [];
  let sec = 0;
  const tick = setInterval(() => {
    perSec.push(sec);
    sec = 0;
  }, 1000);
  ws.on('message', (data) => {
    bytes += data.length;
    const t = process.hrtime.bigint();
    const m = JSON.parse(data.toString());
    parseUs.push(Number(process.hrtime.bigint() - t) / 1000);
    if (m.channel === 'rs.sub.depth') acks++;
    else if (m.channel === 'rs.error') errors.push(m.data);
    else if (m.channel === 'push.depth') {
      n++;
      sec++;
      frames.set(m.symbol, (frames.get(m.symbol) ?? 0) + 1);
      const d = m.data;
      const begin = d.begin ?? d.version;
      if (d.begin !== undefined) merged++;
      const p = last.get(m.symbol);
      if (p !== undefined && begin !== p + 1) {
        gaps++;
        if (gapSample.length < 5) gapSample.push({ symbol: m.symbol, expected: p + 1, got: begin, atIso: new Date().toISOString() });
      }
      last.set(m.symbol, d.end ?? d.version);
    }
  });
  const t0 = Date.now();
  for (const s of picks) send(ws, { method: 'sub.depth', param: { symbol: s } });
  const ping = setInterval(() => send(ws, { method: 'ping' }), 10_000);
  let closed = null;
  ws.on('close', (code) => (closed = code));
  await sleep(60_000);
  clearInterval(ping);
  clearInterval(tick);
  ws.close();
  const secs = (Date.now() - t0) / 1000;
  const silent = [...frames].filter(([, v]) => v === 0).map(([s]) => s);
  log('batch', { contracts: picks.length, acks, errors: errors.slice(0, 5), errorCount: errors.length, frames: n, mergedFrames: merged, gaps, gapSample, framesPerSec: +(n / secs).toFixed(1), medianPerSec: pct(perSec, 0.5), peakPerSec: Math.max(...perSec), kbPerSec: +(bytes / 1024 / secs).toFixed(1), bytesPerFrame: Math.round(bytes / Math.max(1, n)), parseUsMedian: +pct(parseUs, 0.5).toFixed(1), silentContracts: silent.length, silentSample: silent.slice(0, 10), closed });
}

async function silence() {
  const { ranked } = await pickContracts();
  const quiet = ranked[Math.floor(ranked.length * 0.9)].symbol;
  const cases = [
    { name: 'nothing', sub: null, ping: 0 },
    { name: 'sub_quiet_no_ping', sub: quiet, ping: 0 },
    { name: 'sub_btc_no_ping', sub: 'BTC_USDT', ping: 0 },
    { name: 'no_sub_ping_20s', sub: null, ping: 20_000 },
  ];
  const results = await Promise.all(
    cases.map(async (c) => {
      const o = await open();
      if (!o.ws) return { ...c, refused: o.refused };
      const ws = o.ws;
      let frames = 0;
      let serverPings = 0;
      let lastFrame = Date.now();
      let lastText = null;
      ws.on('ping', () => serverPings++);
      ws.on('message', (d) => {
        frames++;
        lastFrame = Date.now();
        lastText = d.toString().slice(0, 160);
      });
      if (c.sub) send(ws, { method: 'sub.depth', param: { symbol: c.sub } });
      const timer = c.ping ? setInterval(() => send(ws, { method: 'ping' }), c.ping) : null;
      const res = await new Promise((resolve) => {
        const cap = setTimeout(() => resolve({ closedAtS: null }), 120_000);
        ws.on('close', (code, reason) => {
          clearTimeout(cap);
          resolve({ closedAtS: +((Date.now() - ws.t0) / 1000).toFixed(2), code, reason: reason.toString(), sinceLastFrameS: +((Date.now() - lastFrame) / 1000).toFixed(2) });
        });
      });
      if (timer) clearInterval(timer);
      ws.terminate();
      return { name: c.name, sub: c.sub, frames, serverPings, ...res, lastText: res.closedAtS ? lastText : undefined };
    }),
  );
  log('silence', { quiet, results });
}

async function deflate() {
  const o = await open({ deflate: true });
  if (o.ws) {
    log('deflate_offer', { upgrade: o.ws.upgrade });
    let bin = 0;
    let txt = 0;
    o.ws.on('message', (_d, isBinary) => (isBinary ? bin++ : txt++));
    send(o.ws, { method: 'sub.depth', param: { symbol: 'BTC_USDT' } });
    await sleep(3000);
    o.ws.close();
    log('deflate_frames', { text: txt, binary: bin });
  } else log('deflate_offer', { refused: o.refused });
  const n = await open({ noUa: true });
  log('no_user_agent', n.ws ? { opened: true } : { refused: n.refused });
  n.ws?.close();
  // The web app sends compress true on sub.deal, and MEXC merges depth frames under compress true.
  const g = await open();
  if (g.ws) {
    const per = {};
    const sample = {};
    g.ws.on('message', (d, isBinary) => {
      if (isBinary) return void (per.binary = (per.binary ?? 0) + 1);
      const m = JSON.parse(d.toString());
      if (m.channel !== 'push.depth' && m.channel !== 'push.deal') {
        per[m.channel] = (per[m.channel] ?? 0) + 1;
        return void (sample[m.channel] ??= d.toString().slice(0, 200));
      }
      const k = `${m.channel}:${m.symbol}`;
      const e = (per[k] ??= { frames: 0, merged: 0, maxLevels: 0 });
      e.frames++;
      if (m.data?.begin !== undefined) e.merged++;
      if (m.channel === 'push.depth') e.maxLevels = Math.max(e.maxLevels, m.data.bids.length + m.data.asks.length);
      sample[k] ??= d.toString().slice(0, 240);
    });
    send(g.ws, { method: 'sub.depth', param: { symbol: 'BTC_USDT', compress: true } });
    send(g.ws, { method: 'sub.depth', param: { symbol: 'ETH_USDT', gzip: true } });
    send(g.ws, { method: 'sub.depth', param: { symbol: 'SOL_USDT', compress: false } });
    send(g.ws, { method: 'sub.deal', param: { symbol: 'DOGE_USDT', compress: true } });
    send(g.ws, { method: 'sub.depth', param: { symbol: 'BTC_USDC' } });
    await sleep(5000);
    send(g.ws, { method: 'unsub.depth', param: { symbol: 'SOL_USDT' } });
    await sleep(3000);
    g.ws.close();
    log('compress_param', { per, sample });
  }
}

const mode = process.argv[2] ?? 'book';
const run = { book, batch, silence, deflate }[mode];
if (!run) {
  console.error('mode must be book, batch, silence or deflate');
  process.exit(1);
}
await run();
process.exit(0);
