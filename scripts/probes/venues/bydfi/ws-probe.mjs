// BYDFi futures WebSocket probe: the documented stream host, then the socket the upgraded web app uses, its depth channels, sequence rule, level order, size unit, keepalive, silence and errors.
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bydfi/ws-probe.mjs [legacy|book|cadence|batch|silence|deflate|channels]
//   legacy    opens the two documented URLs on stream.bydfi.com and prints why they fail. A few seconds.
//   book      sub.depth and sub.depth.full on five contracts for 75 s, a REST seed and compare, the merged form, and error cases.
//   cadence   four sockets, one per form of the BTC_USDT book, for 30 s.
//   batch     sub.depth on 150 USDT contracts on one socket for 60 s.
//   silence   three sockets that differ only in what the client sends, for up to 75 s.
//   deflate   offers permessage-deflate once and prints what the server negotiates.
//   channels  ticker, tickers, funding, index and fair price channels for 20 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/bydfi/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const EDGE = 'wss://futures.bydfi.com/edge';
const LEGACY = ['wss://stream.bydfi.com/v1/public/fapi', 'wss://stream.bydfi.com/ws/BTC-USDT@depth'];
const REST = 'https://api.bydfi.com/api/v1/contract';
const OUT = process.env.PROBE_OUT_DIR;
const BOOK_SYMBOLS = ['BTC_USDT', 'ETH_USDT', 'BTC_USDC', 'BTC_USD'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj = {}) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

async function getJson(url) {
  const t0 = performance.now();
  const res = await fetch(url);
  const body = await res.json();
  return { status: res.status, ms: Math.round(performance.now() - t0), body };
}

function open(url, { deflate = false } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: deflate });
  const state = { ws, t0, openMs: null, closed: null, frames: 0, bytes: 0, binary: 0 };
  ws.on('open', () => (state.openMs = Math.round(performance.now() - t0)));
  ws.on('close', (code) => (state.closed = { code, atMs: Math.round(performance.now() - t0) }));
  ws.on('error', (e) => (state.error = e.code ?? e.message));
  return state;
}

const waitOpen = (s) =>
  new Promise((resolve) => {
    if (s.ws.readyState === WebSocket.OPEN) return resolve(true);
    s.ws.once('open', () => resolve(true));
    s.ws.once('error', () => resolve(false));
    s.ws.once('close', () => resolve(false));
  });

const send = (s, obj) => s.ws.readyState === WebSocket.OPEN && s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));

function parse(s, data, isBinary) {
  s.frames++;
  s.bytes += data.length;
  if (isBinary) s.binary++;
  try {
    return JSON.parse(data.toString('utf8'));
  } catch {
    return { unparsed: data.toString('utf8').slice(0, 200) };
  }
}

// Order check: bids descending, asks ascending, by position.
function ordered(levels, side) {
  for (let i = 1; i < levels.length; i++) {
    if (side === 'bids' ? levels[i][0] >= levels[i - 1][0] : levels[i][0] <= levels[i - 1][0]) return false;
  }
  return true;
}

async function legacyMode() {
  for (const url of LEGACY) {
    const s = open(url);
    const ok = await waitOpen(s);
    await sleep(200);
    log('legacy', { url, opened: ok, error: s.error ?? null, closed: s.closed });
    s.ws.terminate();
  }
}

async function bookMode() {
  const s = open(EDGE);
  if (!(await waitOpen(s))) return log('open_failed', { url: EDGE, error: s.error });
  log('open', { url: EDGE, ms: s.openMs });
  const inc = new Map(); // incremental channel state per symbol
  const full = new Map(); // full channel state per symbol
  const acks = [];
  const errors = [];
  const pongs = [];
  const firsts = {};
  let pingSent = 0;
  s.ws.on('message', (data, isBinary) => {
    const f = parse(s, data, isBinary);
    const ch = f.channel;
    if (!firsts[ch]) {
      firsts[ch] = true;
      capture('book-first.jsonl', JSON.stringify(f));
      log('first_frame', { channel: ch, sample: JSON.stringify(f).slice(0, 400) });
    }
    if (ch === 'pong') return pongs.push(Math.round(performance.now() - pingSent));
    if (ch?.startsWith('rs.')) {
      (ch === 'rs.error' ? errors : acks).push({ ch, data: f.data, ts: f.ts });
      return;
    }
    if (ch === 'push.depth') {
      const st = inc.get(f.symbol) ?? { frames: 0, gaps: 0, dups: 0, beginGaps: 0, multiStep: 0, versionNotEnd: 0, last: null, lastEnd: null, firstVersion: f.data.version, empty: 0, bidsUnordered: 0, asksUnordered: 0, deletes: 0, frameKeys: Object.keys(f.data).join(','), versions: [] };
      st.frames++;
      if (st.last !== null) {
        if (f.data.version === st.last) st.dups++;
        else if (f.data.version !== st.last + 1) st.gaps++;
        if (f.data.begin !== undefined && f.data.begin !== st.lastEnd + 1) st.beginGaps++;
      }
      if (f.data.end !== undefined && f.data.end !== f.data.begin) st.multiStep++;
      if (f.data.end !== undefined && f.data.version !== f.data.end) st.versionNotEnd++;
      st.last = f.data.version;
      st.lastEnd = f.data.end ?? f.data.version;
      if (st.versions.length < 2000) st.versions.push([f.data.begin ?? f.data.version, f.data.end ?? f.data.version]);
      const b = f.data.bids ?? [];
      const a = f.data.asks ?? [];
      if (b.length === 0 && a.length === 0) st.empty++;
      if (!ordered(b, 'bids')) st.bidsUnordered++;
      if (!ordered(a, 'asks')) st.asksUnordered++;
      st.deletes += [...b, ...a].filter((l) => l[1] === 0).length;
      inc.set(f.symbol, st);
      return;
    }
    if (ch === 'push.depth.full') {
      const st = full.get(f.symbol) ?? { frames: 0, repeats: 0, lastTop: null, sizes: [], bidsUnordered: 0, asksUnordered: 0, versionSteps: [], last: null, latest: null };
      st.frames++;
      const top = JSON.stringify([f.data.bids, f.data.asks]);
      if (top === st.lastTop) st.repeats++;
      st.lastTop = top;
      if (st.last !== null && st.versionSteps.length < 500) st.versionSteps.push(f.data.version - st.last);
      st.last = f.data.version;
      st.sizes.push([f.data.bids.length, f.data.asks.length]);
      if (!ordered(f.data.bids, 'bids')) st.bidsUnordered++;
      if (!ordered(f.data.asks, 'asks')) st.asksUnordered++;
      st.latest = f;
      full.set(f.symbol, st);
      return;
    }
  });
  const ping = setInterval(() => {
    pingSent = performance.now();
    send(s, { method: 'ping' });
  }, 15_000);
  for (const symbol of BOOK_SYMBOLS) {
    send(s, { method: 'sub.depth', param: { symbol } });
    send(s, { method: 'sub.depth.full', param: { symbol, limit: 20 } });
    await sleep(60);
  }
  send(s, { method: 'sub.depth', param: { symbol: 'SOL_USDT', compress: true } });
  await sleep(3_000);
  // Error cases, spaced so each reply can be attributed.
  const cases = [
    ['unknown symbol sub.depth', { method: 'sub.depth', param: { symbol: 'NOPE_USDT' } }],
    ['legacy symbol spelling', { method: 'sub.depth', param: { symbol: 'BTC-USDT' } }],
    ['full limit 30', { method: 'sub.depth.full', param: { symbol: 'ETH_USDT', limit: 30 } }],
    ['unknown method', { method: 'sub.nope', param: { symbol: 'BTC_USDT' } }],
    ['repeat sub.depth', { method: 'sub.depth', param: { symbol: 'BTC_USDT' } }],
    ['not json', 'hello'],
  ];
  for (const [name, frame] of cases) {
    const before = { acks: acks.length, errors: errors.length };
    send(s, frame);
    await sleep(2_000);
    log('case', { name, acks: acks.slice(before.acks), errors: errors.slice(before.errors), open: s.ws.readyState === WebSocket.OPEN });
  }
  // REST seed and compare against the incremental stream's version.
  const rest = await getJson(`${REST}/depth/BTC_USDT?limit=20`);
  const restV = rest.body.data?.version;
  const btc = inc.get('BTC_USDT');
  // A REST seed at version V lines up when some frame's range [begin, end] holds V + 1, or a frame ends at V.
  const ranges = btc?.versions ?? [];
  const nextFrame = ranges.find(([b, e]) => b <= restV + 1 && restV + 1 <= e);
  log('rest_seed', { status: rest.status, ms: rest.ms, restVersion: restV, wsFramesSeen: ranges.length, frameEndsAtRestVersion: ranges.some(([, e]) => e === restV), frameHoldsNextVersion: nextFrame ?? null, wsMin: ranges[0]?.[0], wsMax: btc?.last, restBids: rest.body.data?.bids.length, restAsks: rest.body.data?.asks.length, restBidsOrdered: ordered(rest.body.data?.bids ?? [], 'bids'), restAsksOrdered: ordered(rest.body.data?.asks ?? [], 'asks') });
  const fb = full.get('BTC_USDT')?.latest;
  if (fb && rest.body.data) {
    const restMap = new Map([...rest.body.data.bids, ...rest.body.data.asks].map((l) => [l[0], l[1]]));
    const wsTop = [...fb.data.bids.slice(0, 5), ...fb.data.asks.slice(0, 5)];
    log('size_compare', { fullVersion: fb.data.version, restVersion: restV, sameSize: wsTop.filter((l) => restMap.get(l[0]) === l[1]).length, of: wsTop.length, wsTouch: [fb.data.bids[0], fb.data.asks[0]], restTouch: [rest.body.data.bids[0], rest.body.data.asks[0]] });
  }
  await sleep(75_000 - Math.round(performance.now() - s.t0));
  clearInterval(ping);
  for (const [sym, st] of inc) {
    const { versions, ...rest2 } = st;
    log('inc_summary', { symbol: sym, ...rest2 });
  }
  for (const [sym, st] of full) {
    const steps = st.versionSteps;
    const levels = st.sizes.map((x) => x.join('x'));
    log('full_summary', { symbol: sym, frames: st.frames, repeats: st.repeats, bidsUnordered: st.bidsUnordered, asksUnordered: st.asksUnordered, levelCounts: [...new Set(levels)].slice(0, 5), versionStepMin: Math.min(...steps), versionStepMax: Math.max(...steps), negativeSteps: steps.filter((x) => x < 0).length });
  }
  log('session', { frames: s.frames, bytes: s.bytes, binaryFrames: s.binary, pongMs: pongs, acks: acks.length, acksSample: acks.slice(0, 2), closed: s.closed });
  s.ws.terminate();
}

async function batchSymbols(n) {
  const t = await getJson(`${REST}/ticker`);
  const usdt = t.body.data.filter((x) => x.symbol.endsWith('_USDT')).sort((a, b) => b.amount24 - a.amount24);
  const step = Math.max(1, Math.floor(usdt.length / n));
  return usdt.filter((_, i) => i % step === 0).slice(0, n).map((x) => x.symbol);
}

async function batchMode() {
  const symbols = await batchSymbols(150);
  const s = open(EDGE);
  if (!(await waitOpen(s))) return log('open_failed', { error: s.error });
  const st = new Map();
  let acks = 0;
  let errors = 0;
  const perSecond = new Map();
  let parseNs = 0n;
  s.ws.on('message', (data, isBinary) => {
    const t0 = process.hrtime.bigint();
    const f = parse(s, data, isBinary);
    parseNs += process.hrtime.bigint() - t0;
    const sec = Math.floor((performance.now() - s.t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    if (f.channel === 'rs.sub.depth') acks++;
    else if (f.channel === 'rs.error') errors++;
    else if (f.channel === 'push.depth') {
      // The default form merges several versions into one frame, so the chain is begin equal to the previous end plus one.
      const x = st.get(f.symbol) ?? { frames: 0, gaps: 0, lastEnd: null };
      x.frames++;
      if (x.lastEnd !== null && f.data.begin !== x.lastEnd + 1) x.gaps++;
      x.lastEnd = f.data.end;
      st.set(f.symbol, x);
    }
  });
  const ping = setInterval(() => send(s, { method: 'ping' }), 15_000);
  const subStart = performance.now();
  for (const symbol of symbols) {
    send(s, { method: 'sub.depth', param: { symbol } });
    await sleep(50);
  }
  const subMs = Math.round(performance.now() - subStart);
  await sleep(60_000);
  clearInterval(ping);
  const counts = [...perSecond.entries()].filter(([sec]) => sec >= 10).map(([, c]) => c).sort((a, b) => a - b);
  const all = [...st.values()];
  log('batch', { symbols: symbols.length, subscribeMs: subMs, acks, errors, delivering: all.length, silent: symbols.length - all.length, gaps: all.reduce((a, x) => a + x.gaps, 0), frames: s.frames, bytes: s.bytes, fpsMedian: counts[counts.length >> 1], fpsMax: counts[counts.length - 1], bytesPerFrame: Math.round(s.bytes / s.frames), parseUsPerFrame: Number(parseNs / BigInt(s.frames)) / 1000, closed: s.closed });
  s.ws.terminate();
}

async function silenceMode() {
  const variants = [
    ['no sub, no ping', () => {}],
    ['sub depth, no ping', (s) => send(s, { method: 'sub.depth', param: { symbol: 'BTC_USDT' } })],
    ['no sub, ping every 20 s', (s) => (s.timer = setInterval(() => send(s, { method: 'ping' }), 20_000))],
  ];
  const socks = [];
  for (const [name, setup] of variants) {
    const s = open(EDGE);
    await waitOpen(s);
    s.ws.on('message', (d, b) => parse(s, d, b));
    setup(s);
    socks.push([name, s]);
  }
  const t0 = performance.now();
  while (performance.now() - t0 < 75_000 && socks.some(([, s]) => !s.closed)) await sleep(250);
  for (const [name, s] of socks) {
    clearInterval(s.timer);
    log('silence', { variant: name, frames: s.frames, closed: s.closed, stillOpenAtMs: s.closed ? null : Math.round(performance.now() - s.t0) });
    s.ws.terminate();
  }
}

async function deflateMode() {
  const s = open(EDGE, { deflate: true });
  const headers = await new Promise((resolve) => {
    s.ws.once('upgrade', (res) => resolve(res.headers));
    s.ws.once('error', () => resolve(null));
  });
  await waitOpen(s);
  s.ws.on('message', (d, b) => parse(s, d, b));
  send(s, { method: 'sub.depth.full', param: { symbol: 'BTC_USDT', limit: 5 } });
  await sleep(3_000);
  log('deflate', { extensions: headers?.['sec-websocket-extensions'] ?? null, negotiated: s.ws.extensions, frames: s.frames, binaryFrames: s.binary });
  s.ws.terminate();
}

async function channelsMode() {
  const s = open(EDGE);
  if (!(await waitOpen(s))) return log('open_failed', { error: s.error });
  const seen = new Map();
  s.ws.on('message', (data, isBinary) => {
    const f = parse(s, data, isBinary);
    const k = f.channel;
    if (!seen.has(k)) capture('channels-first.jsonl', JSON.stringify(f));
    const x = seen.get(k) ?? { n: 0, sample: JSON.stringify(f).slice(0, 350) };
    x.n++;
    seen.set(k, x);
  });
  send(s, { method: 'sub.ticker', param: { symbol: 'BTC_USDT' } });
  send(s, { method: 'sub.tickers', param: {} });
  send(s, { method: 'sub.funding.rate', param: { symbol: 'BTC_USDT' } });
  send(s, { method: 'sub.index.price', param: { symbol: 'BTC_USDT' } });
  send(s, { method: 'sub.fair.price', param: { symbol: 'BTC_USDT' } });
  send(s, { method: 'sub.deal', param: { symbol: 'BTC_USDT' } });
  await sleep(20_000);
  for (const [k, x] of seen) log('channel', { channel: k, frames: x.n, sample: x.sample });
  s.ws.terminate();
}

// One socket per form of the BTC_USDT book, so each push cadence is measured alone.
async function cadenceMode() {
  const forms = [
    ['sub.depth default', { method: 'sub.depth', param: { symbol: 'BTC_USDT' } }],
    ['sub.depth compress true', { method: 'sub.depth', param: { symbol: 'BTC_USDT', compress: true } }],
    ['sub.depth compress false', { method: 'sub.depth', param: { symbol: 'BTC_USDT', compress: false } }],
    ['sub.depth.full limit 20', { method: 'sub.depth.full', param: { symbol: 'BTC_USDT', limit: 20 } }],
  ];
  const socks = [];
  for (const [name, frame] of forms) {
    const s = open(EDGE);
    await waitOpen(s);
    const st = { name, ts: [], multiStep: 0, beginGaps: 0, lastEnd: null, levels: [] };
    s.ws.on('message', (data, isBinary) => {
      const f = parse(s, data, isBinary);
      if (!f.channel?.startsWith('push.')) return;
      st.ts.push(f.ts);
      const d = f.data;
      if (d.begin !== undefined) {
        if (d.end !== d.begin) st.multiStep++;
        if (st.lastEnd !== null && d.begin !== st.lastEnd + 1) st.beginGaps++;
        st.lastEnd = d.end;
      }
      st.levels.push((d.bids?.length ?? 0) + (d.asks?.length ?? 0));
    });
    s.timer = setInterval(() => send(s, { method: 'ping' }), 15_000);
    send(s, frame);
    socks.push([s, st]);
  }
  await sleep(30_000);
  for (const [s, st] of socks) {
    clearInterval(s.timer);
    const gaps = st.ts.slice(1).map((t, i) => t - st.ts[i]).sort((a, b) => a - b);
    const lv = [...st.levels].sort((a, b) => a - b);
    const t0 = st.ts[0];
    const pauses = st.ts.slice(1).map((t, i) => [st.ts[i] - t0, t - st.ts[i]]).filter(([, d]) => d >= 500).map(([at, d]) => `${at}+${d}`);
    const perSec = new Map();
    for (const t of st.ts) perSec.set(Math.floor((t - t0) / 1000), (perSec.get(Math.floor((t - t0) / 1000)) ?? 0) + 1);
    const secs = [...Array(30).keys()].map((k) => perSec.get(k) ?? 0);
    log('cadence', { form: st.name, frames: st.ts.length, intervalMsMin: gaps[0], intervalMsMedian: gaps[gaps.length >> 1], intervalMsMax: gaps[gaps.length - 1], multiStep: st.multiStep, beginGaps: st.beginGaps, levelsPerFrameMedian: lv[lv.length >> 1], pausesAtPlusMs: pauses.slice(0, 12), framesPerSecond: secs.join(' ') });
    s.ws.terminate();
  }
}

const modes = { legacy: legacyMode, cadence: cadenceMode, book: bookMode, batch: batchMode, silence: silenceMode, deflate: deflateMode, channels: channelsMode };
const picked = process.argv.slice(2);
for (const m of picked.length ? picked : Object.keys(modes)) {
  log('mode', { mode: m, at: new Date().toISOString() });
  await modes[m]();
}
process.exit(0);
