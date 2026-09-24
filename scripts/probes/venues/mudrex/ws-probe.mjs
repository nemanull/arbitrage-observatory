// Mudrex public WebSocket probe: which streams exist, whether any book channel exists, the ticker snapshot as a catalog, cadence, errors, keepalive and silence.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/mudrex/ws-probe.mjs [streams|silence|deflate|mark]
//   streams  one socket for 45 s: ticker@1s over about 1,200 candidate symbols from Gate and every Bybit linear symbol, 1 s klines, book-like stream names, error cases,
//            JSON and protocol ping, plus a second short socket that tries 16 subscriptions against the documented cap of 15.
//            Compares Mudrex last and mark prices with one Bybit and one Gate bulk ticker read taken 20 s in. About 60 s.
//   silence  three sockets for up to 65 s: idle, subscribed with no client frame, subscribed with a protocol ping every 15 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates, then tries the /inverse and /spot siblings of the URL. About 10 s.
//   mark     1 s mark and last klines and ticker@1s for BTC, ETH and SOL for 40 s against Bybit tickers polled once a second per symbol.
// The server allows 10 new connections per minute per IP, and this probe opens at most 3 per mode.
// Set PROBE_OUT_DIR to keep the recognised symbol list and trimmed frames. Recorded in docs/profiles/mudrex/websocket.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://trade.mudrex.com/fapi/v1/price/ws/linear';
const GATE_CONTRACTS = 'https://api.gateio.ws/api/v4/futures/usdt/contracts';
const GATE_TICKERS = 'https://api.gateio.ws/api/v4/futures/usdt/tickers';
const BYBIT_INSTRUMENTS = 'https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000';
const BYBIT_TICKERS = 'https://api.bybit.com/v5/market/tickers?category=linear';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();
const since = () => Date.now() - t0;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function open(label, opts = {}) {
  const started = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve, reject) => {
    ws.once('upgrade', (res) => {
      log('upgrade', { label, status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server ?? null, via: res.headers.via ?? null });
    });
    ws.once('open', () => {
      log('open', { label, ms: Date.now() - started });
      resolve(ws);
    });
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        log('refused', { label, status: res.statusCode, body: body.slice(0, 300) });
        reject(new Error('refused'));
      });
    });
    ws.once('error', (e) => reject(e));
  });
}

let bybitKind = new Map();

async function candidates() {
  const names = new Set();
  const gate = await (await fetch(GATE_CONTRACTS)).json();
  for (const c of gate) names.add(c.name.replace('_', '').toLowerCase());
  const bybit = await (await fetch(BYBIT_INSTRUMENTS)).json();
  // Every Bybit linear symbol, so USDC perpetuals and dated futures are tried too.
  for (const i of bybit.result.list) names.add(i.symbol.toLowerCase());
  const kinds = {};
  for (const i of bybit.result.list) kinds[`${i.quoteCoin}/${i.contractType}`] = (kinds[`${i.quoteCoin}/${i.contractType}`] ?? 0) + 1;
  log('candidates', { gate: gate.length, bybit: bybit.result.list.length, bybitKinds: kinds, union: names.size });
  bybitKind = new Map(bybit.result.list.map((i) => [i.symbol.toLowerCase(), `${i.quoteCoin}/${i.contractType}`]));
  return [...names];
}

async function streams() {
  const cands = await candidates();
  const ws = await open('main');
  let id = 0;
  const pending = new Map();
  const replies = [];
  const send = (msg, note) => {
    const m = { id: ++id, ...msg };
    pending.set(m.id, { note, sentAt: Date.now() });
    ws.send(JSON.stringify(m));
    return m.id;
  };
  const sendRaw = (text, note) => {
    pending.set(`raw:${note}`, { note, sentAt: Date.now() });
    ws.send(text);
  };

  const stats = new Map(); // stream name to { n, gaps, lastAt, firstAt }
  const tick = { pushes: 0, assetsPerPush: [], gapMs: [], lastAt: 0, seen: new Map(), withMp: 0, rows: 0, snapshot: null, types: new Set() };
  const klineRepeats = new Map();
  let pongProto = null;
  let pingProtoAt = 0;
  let firstFrames = 0;

  ws.on('pong', () => {
    pongProto = Date.now() - pingProtoAt;
  });

  ws.on('message', (raw, isBinary) => {
    const text = raw.toString('utf8');
    if (isBinary) log('binary', { bytes: raw.length });
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      log('nonjson', { text: text.slice(0, 200) });
      return;
    }
    if (firstFrames < 40) {
      capture('ws-frames.txt', text.slice(0, 600));
      firstFrames++;
    }
    if (msg.stream === undefined) {
      const p = pending.get(msg.id);
      replies.push({ id: msg.id, note: p?.note, ms: p ? Date.now() - p.sentAt : null, reply: text.slice(0, 400) });
      return;
    }
    const now = Date.now();
    const st = stats.get(msg.stream) ?? { n: 0, gaps: [], lastAt: 0, firstAt: now };
    if (st.lastAt) st.gaps.push(now - st.lastAt);
    st.n++;
    st.lastAt = now;
    stats.set(msg.stream, st);
    if (msg.stream.startsWith('ticker@')) {
      const rows = Array.isArray(msg.data) ? msg.data : [];
      if (tick.snapshot === null) tick.snapshot = { rows: rows.length, atMs: since(), sample: rows.slice(0, 3) };
      tick.pushes++;
      tick.assetsPerPush.push(rows.length);
      if (tick.lastAt) tick.gapMs.push(now - tick.lastAt);
      tick.lastAt = now;
      for (const r of rows) {
        tick.rows++;
        if (r.mp !== undefined) tick.withMp++;
        tick.types.add(`${typeof r.p}/${typeof r.mp}`);
        tick.seen.set(r.s, { p: r.p, mp: r.mp, at: now });
      }
    } else if (msg.stream.includes('line@')) {
      const key = msg.stream;
      const prev = klineRepeats.get(key) ?? { same: 0, lastT: null, lastC: null, candles: new Set(), types: '' };
      const d = msg.data ?? {};
      if (prev.lastT === d.t && prev.lastC === d.c) prev.same++;
      prev.lastT = d.t;
      prev.lastC = d.c;
      prev.candles.add(d.t);
      prev.types = `t:${typeof d.t} c:${typeof d.c} ageS:${Math.round(now / 1000 - d.t)}`;
      klineRepeats.set(key, prev);
    }
  });
  ws.on('close', (code, reason) => log('close', { label: 'main', atMs: since(), code, reason: reason.toString() }));

  send({ method: 'LIST_SUBSCRIPTIONS' }, 'list before');
  await sleep(300);
  send({ method: 'SUBSCRIBE', params: ['ticker@1s'], assets: cands }, `ticker@1s over ${cands.length} candidates`);
  await sleep(500);
  send({ method: 'SUBSCRIBE', params: ['kline@1s@btcusdt', 'markKline@1s@btcusdt', 'kline@1m@btcusdt', 'markKline@1m@btcusdt'] }, 'four btc klines in one frame');
  await sleep(300);
  const bookish = ['depth@btcusdt', 'depth20@btcusdt', 'depth@100ms@btcusdt', 'orderbook@btcusdt', 'orderBook@btcusdt', 'bookTicker@btcusdt', 'trade@btcusdt', 'aggTrade@btcusdt', 'markPrice@btcusdt', 'index@btcusdt', 'indexKline@1s@btcusdt', 'funding@btcusdt', 'kline@5m@btcusdt'];
  for (const s of bookish) {
    send({ method: 'SUBSCRIBE', params: [s] }, `bookish ${s}`);
    await sleep(150);
  }
  send({ method: 'SUBSCRIBE', params: ['kline@1s@nopeusdt'] }, 'unknown symbol kline');
  await sleep(150);
  send({ method: 'SUBSCRIBE', params: ['kline@1s@ETHUSDT'] }, 'uppercase kline ETHUSDT');
  await sleep(150);
  send({ method: 'SUBSCRIBE', params: ['kline@1s@solusdt', 'depth@solusdt'] }, 'valid plus invalid in one frame');
  await sleep(150);
  send({ method: 'SUBSCRIBE', params: ['ticker@5s'], assets: ['nopeusdt'] }, 'ticker@5s unknown asset only');
  await sleep(150);
  send({ method: 'SUBSCRIBE', params: ['kline@1s@btcusdt'] }, 'duplicate kline@1s@btcusdt');
  await sleep(150);
  send({ method: 'UNSUBSCRIBE', params: ['kline@1s@xrpusdt'] }, 'unsubscribe not subscribed');
  await sleep(150);
  send({ method: 'FOO' }, 'unknown method');
  await sleep(150);
  sendRaw('not json', 'not json');
  await sleep(150);
  send({ method: 'PING' }, 'json PING');
  pingProtoAt = Date.now();
  ws.ping();
  await sleep(500);
  send({ method: 'LIST_SUBSCRIPTIONS' }, 'list after');

  // A second socket tries 16 single-stream subscriptions against the documented cap of 15.
  const capSocket = await open('cap');
  const capReplies = [];
  capSocket.on('message', (raw) => {
    const m = JSON.parse(raw.toString('utf8'));
    if (m.stream === undefined) capReplies.push(m);
  });
  const capSyms = ['btc', 'eth', 'sol', 'xrp', 'doge', 'ada', 'bnb', 'trx', 'avax', 'link', 'ltc', 'bch', 'dot', 'sui', 'near', 'apt'];
  for (let i = 0; i < capSyms.length; i++) {
    capSocket.send(JSON.stringify({ id: i + 1, method: 'SUBSCRIBE', params: [`kline@1m@${capSyms[i]}usdt`] }));
    await sleep(100);
  }
  await sleep(1500);
  const capOk = capReplies.filter((r) => r.result === 'success').length;
  log('cap', { sent: capSyms.length, success: capOk, errors: capReplies.filter((r) => r.error).map((r) => ({ id: r.id, error: r.error })) });
  capSocket.close();

  // One cross-venue read 20 s in, to see which price Mudrex last and mark follow.
  await sleep(Math.max(0, 20_000 - since()));
  const readAt = Date.now();
  const [bybit, gate] = await Promise.all([
    fetch(BYBIT_TICKERS).then((r) => r.json()),
    fetch(GATE_TICKERS).then((r) => r.json()),
  ]);
  const snapshotSeen = new Map(tick.seen);
  compare('bybit', snapshotSeen, readAt, new Map(bybit.result.list.map((t) => [t.symbol.toLowerCase(), { last: +t.lastPrice, mark: +t.markPrice, index: +t.indexPrice }])));
  compare('gate', snapshotSeen, readAt, new Map(gate.map((t) => [t.contract.replace('_', '').toLowerCase(), { last: +t.last, mark: +t.mark_price, index: +t.index_price }])));

  const pingTimer = setInterval(() => send({ method: 'PING' }, 'json PING keepalive'), 20_000);
  await sleep(Math.max(0, 45_000 - since()));
  clearInterval(pingTimer);

  for (const r of replies) log('reply', r);
  log('protoPong', { ms: pongProto });
  for (const [s, st] of stats) log('stream', { stream: s, frames: st.n, medianGapMs: median(st.gaps), maxGapMs: st.gaps.length ? Math.max(...st.gaps) : null });
  log('ticker', {
    snapshot: tick.snapshot,
    pushes: tick.pushes,
    medianAssetsPerPush: median(tick.assetsPerPush),
    maxAssetsPerPush: Math.max(...tick.assetsPerPush),
    medianGapMs: median(tick.gapMs),
    distinctAssets: tick.seen.size,
    rowsWithMp: `${tick.withMp}/${tick.rows}`,
    valueTypes: [...tick.types],
  });
  for (const [k, v] of klineRepeats) log('kline', { stream: k, identicalRepeats: v.same, distinctCandles: v.candles.size, last: v.types });
  const recognised = [...tick.seen.keys()].sort();
  const noMp = recognised.filter((s) => tick.seen.get(s).mp === undefined);
  const byKind = {};
  for (const s of recognised) byKind[bybitKind.get(s) ?? 'not on bybit'] = (byKind[bybitKind.get(s) ?? 'not on bybit'] ?? 0) + 1;
  log('recognised', { count: recognised.length, byBybitKind: byKind, withoutMarkInLastRow: noMp.length, sampleWithoutMark: noMp.slice(0, 10) });
  if (OUT) writeFileSync(join(OUT, 'mudrex-symbols.json'), JSON.stringify(recognised));
  ws.close();
  await sleep(300);
}

function compare(venue, seen, readAt, other) {
  const lastPpm = [];
  const markPpm = [];
  const markVsLast = [];
  const markVsIndex = [];
  let matched = 0;
  let lastEqual = 0;
  let markEqual = 0;
  for (const [s, v] of seen) {
    const o = other.get(s);
    if (!o || !(o.last > 0)) continue;
    matched++;
    const lp = Math.abs(v.p / o.last - 1) * 1e6;
    lastPpm.push(lp);
    if (v.p === o.last) lastEqual++;
    if (v.mp !== undefined && o.mark > 0) {
      markPpm.push(Math.abs(v.mp / o.mark - 1) * 1e6);
      markVsLast.push(Math.abs(v.mp / o.last - 1) * 1e6);
      if (o.index > 0) markVsIndex.push(Math.abs(v.mp / o.index - 1) * 1e6);
      if (v.mp === o.mark) markEqual++;
    }
  }
  const q = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] : null);
  log('compare', {
    venue,
    readAtMs: readAt - t0,
    matched,
    lastEqual,
    markEqual,
    lastPpm: { p50: q(lastPpm, 0.5), p90: q(lastPpm, 0.9) },
    markVsTheirMarkPpm: { n: markPpm.length, p50: q(markPpm, 0.5), p90: q(markPpm, 0.9) },
    markVsTheirLastPpm: { p50: q(markVsLast, 0.5) },
    markVsTheirIndexPpm: { p50: q(markVsIndex, 0.5) },
  });
}

async function silence() {
  const specs = [
    { label: 'idle', subscribe: false, protoPingMs: 0 },
    { label: 'subscribed-no-client-frame', subscribe: true, protoPingMs: 0 },
    { label: 'subscribed-protocol-ping-15s', subscribe: true, protoPingMs: 15_000 },
  ];
  const done = [];
  for (const spec of specs) {
    const ws = await open(spec.label);
    const openedAt = Date.now();
    let frames = 0;
    let serverPings = 0;
    ws.on('message', () => frames++);
    ws.on('ping', () => serverPings++);
    if (spec.subscribe) ws.send(JSON.stringify({ id: 1, method: 'SUBSCRIBE', params: ['ticker@1s'], assets: ['btcusdt', 'ethusdt'] }));
    const timer = spec.protoPingMs ? setInterval(() => ws.readyState === ws.OPEN && ws.ping(), spec.protoPingMs) : null;
    done.push(
      new Promise((resolve) => {
        const cap = setTimeout(() => {
          log('silence', { label: spec.label, closedAfterMs: null, openFor: Date.now() - openedAt, frames, serverPings });
          ws.__logged = true;
          ws.close();
          resolve();
        }, 65_000);
        ws.on('close', (code, reason) => {
          clearTimeout(cap);
          if (timer) clearInterval(timer);
          if (ws.__logged) return resolve();
          ws.__logged = true;
          log('silence', { label: spec.label, closedAfterMs: Date.now() - openedAt, code, reason: reason.toString(), frames, serverPings });
          resolve();
        });
      }).finally(() => {
        ws.__logged = true;
        if (timer) clearInterval(timer);
      }),
    );
  }
  await Promise.all(done);
}

// Mudrex mark and last against Bybit's, polled once a second per symbol, to see whether either is passed through and with what lag.
async function mark() {
  const syms = ['btcusdt', 'ethusdt', 'solusdt'];
  const bybit = new Map(syms.map((s) => [s, []])); // arrival ms, mark, last, index
  const mud = new Map(syms.map((s) => [s, { mark: [], last: [], tickerMp: [] }]));
  const ws = await open('mark');
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString('utf8'));
    const now = Date.now();
    if (m.stream?.startsWith('markKline@1s@')) mud.get(m.data.s)?.mark.push([now, m.data.c, m.data.t]);
    else if (m.stream?.startsWith('kline@1s@')) mud.get(m.data.s)?.last.push([now, m.data.c, m.data.t]);
    else if (m.stream === 'ticker@1s') for (const r of m.data) mud.get(r.s)?.tickerMp.push([now, r.mp, r.p]);
  });
  ws.send(JSON.stringify({ id: 1, method: 'SUBSCRIBE', params: [...syms.map((s) => `markKline@1s@${s}`), ...syms.map((s) => `kline@1s@${s}`), 'ticker@1s'], assets: syms }));
  const ping = setInterval(() => ws.ping(), 15_000);
  const until = Date.now() + 40_000;
  while (Date.now() < until) {
    const tick = Date.now();
    await Promise.all(
      syms.map(async (s) => {
        const j = await (await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s.toUpperCase()}`)).json();
        const t = j.result.list[0];
        bybit.get(s).push([Date.now(), +t.markPrice, +t.lastPrice, +t.indexPrice]);
      }),
    );
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  clearInterval(ping);
  ws.close();
  for (const s of syms) {
    const b = bybit.get(s);
    const md = mud.get(s);
    const judge = (series, col) => {
      let exactNow = 0;
      let exactWithin10s = 0;
      const lags = [];
      const ppm = [];
      for (const [at, v] of series) {
        const before = b.filter((x) => x[0] <= at + 500);
        if (before.length === 0) continue;
        const nearest = before[before.length - 1];
        ppm.push(Math.abs(v / nearest[col] - 1) * 1e6);
        if (v === nearest[col]) exactNow++;
        const hit = [...before].reverse().find((x) => x[col] === v && at - x[0] < 10_000);
        if (hit) {
          exactWithin10s++;
          lags.push(at - hit[0]);
        }
      }
      return { n: series.length, exactNearest: exactNow, exactWithin10s, medianLagMs: median(lags), p50ppm: median(ppm), maxPpm: ppm.length ? Math.max(...ppm) : null };
    };
    log('mark', {
      symbol: s,
      bybitPolls: b.length,
      bybitDistinctMarks: new Set(b.map((x) => x[1])).size,
      mudrexMarkKline1s: judge(md.mark, 1),
      mudrexMarkKlineVsBybitIndex: judge(md.mark, 3),
      mudrexMarkKlineVsBybitLast: judge(md.mark, 2),
      mudrexLastKline1s: judge(md.last, 2),
      mudrexTickerMp: judge(md.tickerMp.map(([a, mp]) => [a, mp]), 1),
      sampleMud: md.mark.slice(-2),
      sampleBybit: b.slice(-2),
    });
  }
}

async function deflate() {
  const ws = await open('deflate', { deflate: true });
  await sleep(1500);
  ws.close();
  await sleep(300);
  // The documented path ends in /linear, so the obvious siblings are tried once each.
  for (const path of ['inverse', 'spot']) {
    const url = WS_URL.replace(/linear$/, path);
    const started = Date.now();
    await new Promise((resolve) => {
      const other = new WebSocket(url, { perMessageDeflate: false });
      other.once('open', () => {
        log('sibling', { url, opened: true, ms: Date.now() - started });
        other.send(JSON.stringify({ id: 1, method: 'SUBSCRIBE', params: ['ticker@1s'], assets: ['btcusdt'] }));
        other.on('message', (raw) => log('siblingFrame', { url, frame: raw.toString('utf8').slice(0, 200) }));
        setTimeout(() => {
          other.close();
          resolve();
        }, 3000);
      });
      other.once('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          log('sibling', { url, opened: false, status: res.statusCode, body: body.slice(0, 200) });
          resolve();
        });
      });
      other.once('error', (e) => {
        log('sibling', { url, opened: false, error: e.message });
        resolve();
      });
    });
  }
}

const mode = process.argv[2] ?? 'streams';
log('start', { mode, iso: new Date().toISOString() });
if (mode === 'streams') await streams();
else if (mode === 'silence') await silence();
else if (mode === 'deflate') await deflate();
else if (mode === 'mark') await mark();
else throw new Error(`unknown mode ${mode}`);
log('end', { mode, wallMs: since() });
process.exit(0);
