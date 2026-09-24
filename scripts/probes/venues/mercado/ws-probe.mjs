// Mercado Bitcoin WebSocket probe: the orderbook channel at several limits, whether each frame is a whole book, level order, cadence, idle repeats, errors, a batch of markets on one socket, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in deflate mode, which only asks once and prints what the server negotiates.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/mercado/ws-probe.mjs [book|limits|batch|quiet|silence|deflate]
//   book     orderbook limit 20 on four markets plus ticker and trade for 30 s with a REST compare, then error cases on a second socket. About 55 s.
//   limits   which depth each stream gets when one socket mixes limits 50, 20 and 200, and on single stream sockets at 200 and 100. Three sockets for 12 s.
//   batch    orderbook limit 20 on every CRYPTO market quoted in BRL, one subscribe frame each, on one socket for 30 s.
//   quiet    REST book of a few markets the batch never heard from, then their orderbook stream alone for 20 s. Pass ids as a comma list, default five.
//   silence  three sockets that differ only in what the client sends or subscribes, for up to 65 s each, run side by side.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/mercado/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.mercadobitcoin.net/ws';
const V4 = 'https://api.mercadobitcoin.net/api/v4';
const UA = 'arbitrage-observatory-probe';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2_000) + '\n');
}

function open(label, { userAgent = true, deflate = false } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, {
    perMessageDeflate: deflate,
    headers: userAgent ? { 'User-Agent': UA } : {},
  });
  const state = { ws, label, t0, openMs: undefined, closed: undefined, frames: [] };
  ws.on('open', () => {
    state.openMs = Math.round(performance.now() - t0);
  });
  ws.on('upgrade', (res) => {
    state.extensions = res.headers['sec-websocket-extensions'] ?? null;
    state.cfRay = res.headers['cf-ray'] ?? null;
  });
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => log('unexpected_response', { label, status: res.statusCode, body: body.slice(0, 300) }));
  });
  ws.on('ping', () => log('server_ping', { label, atMs: Math.round(performance.now() - t0) }));
  ws.on('close', (code, reason) => {
    state.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) };
  });
  ws.on('error', (e) => log('socket_error', { label, error: String(e.message) }));
  return state;
}

const waitOpen = (s) =>
  new Promise((resolve, reject) => {
    if (s.ws.readyState === WebSocket.OPEN) return resolve();
    s.ws.once('open', resolve);
    s.ws.once('error', reject);
  });

const sub = (name, id, limit) => JSON.stringify({ type: 'subscribe', subscription: { name, id, ...(limit ? { limit } : {}) } });

function order(levels) {
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i][0] > levels[i - 1][0]) asc++;
    else if (levels[i][0] < levels[i - 1][0]) desc++;
  }
  return asc && !desc ? 'asc' : desc && !asc ? 'desc' : levels.length < 2 ? 'n/a' : 'mixed';
}

async function book() {
  const s = open('book');
  await waitOpen(s);
  log('open', { label: s.label, ms: s.openMs, extensions: s.extensions, cfRay: s.cfRay });

  const streams = [
    ['orderbook', 'BRLBTC', 20],
    ['orderbook', 'BRLETH', 20],
    ['orderbook', 'BRLUSDT', 20],
    ['orderbook', 'BRLCOMP', 20],
    ['ticker', 'BRLBTC'],
    ['trade', 'BRLBTC'],
  ];
  const stats = new Map();
  const control = [];
  const subAt = performance.now();
  let pongMs;
  let pingAt;
  s.ws.on('message', (buf, isBinary) => {
    const recv = performance.now();
    const recvWall = Date.now();
    const text = buf.toString('utf8');
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      control.push({ nonJson: text.slice(0, 200), isBinary });
      return;
    }
    if (m.type === 'pong') {
      pongMs = Math.round(recv - pingAt);
      control.push({ pong: text, ms: pongMs });
      capture('frames_control.txt', text);
      return;
    }
    if (m.type !== 'orderbook' && m.type !== 'ticker' && m.type !== 'trade') {
      control.push({ atMs: Math.round(recv - subAt), text: text.slice(0, 300) });
      capture('frames_control.txt', text);
      return;
    }
    const key = `${m.type}:${m.id}${m.limit ? ':' + m.limit : ''}`;
    let st = stats.get(key);
    if (!st) {
      st = { frames: 0, firstMs: Math.round(recv - subAt), gaps: [], last: undefined, lastRecv: recv, repeats: 0, bidLens: new Set(), askLens: new Set(), bidOrder: new Set(), askOrder: new Set(), types: undefined, tsLagMs: [], dataTsLagMs: [], crossed: 0, oneSided: 0, keys: Object.keys(m).join(','), dataKeys: Object.keys(m.data ?? {}).join(',') };
      stats.set(key, st);
      capture(`frames_${m.type}.txt`, text);
    } else {
      st.gaps.push(recv - st.lastRecv);
    }
    st.frames++;
    st.lastRecv = recv;
    if (typeof m.ts === 'number' || typeof m.ts === 'string') st.tsLagMs.push(recvWall - Number(BigInt(m.ts) / 1_000_000n));
    if (m.type === 'orderbook') {
      const d = m.data;
      const body = JSON.stringify([d.bids, d.asks]);
      if (body === st.last) st.repeats++;
      st.last = body;
      st.bidLens.add(d.bids?.length);
      st.askLens.add(d.asks?.length);
      st.bidOrder.add(order(d.bids ?? []));
      st.askOrder.add(order(d.asks ?? []));
      st.types = [typeof d.bids?.[0]?.[0], typeof d.bids?.[0]?.[1]];
      if (d.timestamp !== undefined) st.dataTsLagMs.push(recvWall - Number(BigInt(d.timestamp) / 1_000_000n));
      if (d.bids?.length && d.asks?.length && d.bids[0][0] >= d.asks[0][0]) st.crossed++;
      if (!d.bids?.length || !d.asks?.length) st.oneSided++;
      if (st.frames === 2) capture(`frames_orderbook_second.txt`, text);
      st.lastData = d;
    } else if (st.frames <= 3) {
      capture(`frames_${m.type}.txt`, text);
    }
  });

  for (const [name, id, limit] of streams) s.ws.send(sub(name, id, limit));
  const pinger = setInterval(() => {
    pingAt = performance.now();
    s.ws.send(JSON.stringify({ type: 'ping' }));
  }, 10_000);

  await sleep(10_000);
  // Compare the BTC socket book with the REST book at the same instant.
  const rest = await (await fetch(`${V4}/BTC-BRL/orderbook?limit=20`, { headers: { 'User-Agent': UA } })).json();
  const wsBook = stats.get('orderbook:BRLBTC:20')?.lastData;
  log('ws_vs_rest_keys', { keys: [...stats.keys()] });
  if (wsBook) {
    const restBids = rest.bids.map((l) => l.map(Number));
    const same = wsBook.bids.filter((l, i) => restBids[i] && restBids[i][0] === l[0] && restBids[i][1] === l[1]).length;
    log('ws_vs_rest', { wsTop: [wsBook.bids[0], wsBook.asks[0]], restTop: [rest.bids[0], rest.asks[0]], sameBidLevelsOf20: same });
  }
  await sleep(20_000);
  clearInterval(pinger);

  for (const [key, st] of stats) {
    const g = st.gaps.sort((a, b) => a - b);
    const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : undefined);
    log('stream', {
      key, frames: st.frames, firstMs: st.firstMs, keys: st.keys, dataKeys: st.dataKeys,
      gapMs: g.length ? { min: Math.round(g[0]), median: Math.round(g[Math.floor(g.length / 2)]), max: Math.round(g[g.length - 1]) } : null,
      repeats: st.repeats, bidLens: [...st.bidLens], askLens: [...st.askLens], bidOrder: [...st.bidOrder], askOrder: [...st.askOrder],
      types: st.types, tsLagMedianMs: med(st.tsLagMs), dataTsLagMedianMs: med(st.dataTsLagMs), crossed: st.crossed, oneSided: st.oneSided,
    });
  }
  log('control', { frames: control.slice(0, 12) });
  s.ws.close();

  await errorsCases();
}

async function errorsCases() {
  const s = open('errors');
  await waitOpen(s);
  const replies = [];
  let t = performance.now();
  let unsubAt;
  let solAfterUnsub = 0;
  s.ws.on('message', (buf) => {
    const text = buf.toString('utf8');
    const m = JSON.parse(text);
    if (m.type === 'orderbook' || m.type === 'ticker' || m.type === 'trade') {
      const key = `${m.type}:${m.id}`;
      if (m.id === 'BRLSOL' && unsubAt !== undefined) solAfterUnsub++;
      if (!replies.find((r) => r.data === key)) replies.push({ data: key, bids: m.data?.bids?.length, asks: m.data?.asks?.length, atMs: Math.round(performance.now() - t) });
      return;
    }
    replies.push({ text: text.slice(0, 200), atMs: Math.round(performance.now() - t) });
    capture('frames_errors.txt', text);
  });
  const cases = [
    ['valid then duplicate', sub('orderbook', 'BRLSOL', 20)],
    ['duplicate', sub('orderbook', 'BRLSOL', 20)],
    ['same id other limit', sub('orderbook', 'BRLSOL', 50)],
    ['unknown id', sub('orderbook', 'BRLNOPE', 20)],
    ['v4 spelling', sub('orderbook', 'SOL-BRL', 20)],
    ['limit 30', sub('orderbook', 'BRLXRP', 30)],
    ['no limit', sub('orderbook', 'BRLADA')],
    ['name trades', sub('trades', 'BRLBTC')],
    ['unknown name', sub('nope', 'BRLBTC')],
    ['usdt quoted pair', sub('orderbook', 'USDTBTC', 20)],
    ['digital asset', sub('orderbook', 'BRLRFDCS21', 20)],
    ['unknown type', JSON.stringify({ type: 'nope' })],
    ['not json', 'hello'],
    ['unsubscribe not subscribed', JSON.stringify({ type: 'unsubscribe', subscription: { name: 'orderbook', id: 'BRLLTC', limit: 20 } })],
    ['unsubscribe SOL', JSON.stringify({ type: 'unsubscribe', subscription: { name: 'orderbook', id: 'BRLSOL', limit: 20 } })],
  ];
  for (const [name, frame] of cases) {
    t = performance.now();
    replies.push({ case: name });
    if (name === 'unsubscribe SOL') unsubAt = performance.now();
    s.ws.send(frame);
    await sleep(1_500);
  }
  await sleep(2_000);
  log('error_cases', { replies });
  log('unsubscribe', { solFramesInThe3500msAfterUnsubscribe: solAfterUnsub });
  log('errors_socket', { closed: s.closed ?? 'open' });
  s.ws.close();
}

async function batch() {
  const symbols = await (await fetch(`${V4}/symbols`, { headers: { 'User-Agent': UA } })).json();
  const ids = symbols.symbol
    .map((sym, i) => ({ sym, i }))
    .filter(({ i }) => symbols.type[i] === 'CRYPTO' && symbols.currency[i] === 'BRL')
    .map(({ i }) => `BRL${symbols['base-currency'][i]}`);
  const s = open('batch');
  await waitOpen(s);
  const acks = new Set();
  const firstBook = new Map();
  const errors = [];
  let frames = 0;
  let bytes = 0;
  let parseUs = 0;
  const perSecond = [];
  let secFrames = 0;
  const t0 = performance.now();
  s.ws.on('message', (buf) => {
    frames++;
    secFrames++;
    bytes += buf.length;
    const p0 = performance.now();
    const m = JSON.parse(buf.toString('utf8'));
    parseUs += (performance.now() - p0) * 1000;
    if (m.type === 'orderbook') {
      if (!firstBook.has(m.id)) firstBook.set(m.id, Math.round(performance.now() - t0));
    } else if (m.type === 'error') errors.push(m.message);
    else if (m.id && m.name) acks.add(m.id);
  });
  const tick = setInterval(() => {
    perSecond.push(secFrames);
    secFrames = 0;
  }, 1_000);
  for (const id of ids) s.ws.send(sub('orderbook', id, 20));
  log('batch_sent', { subscriptions: ids.length, sendMs: Math.round(performance.now() - t0) });
  const pinger = setInterval(() => s.ws.readyState === WebSocket.OPEN && s.ws.send(JSON.stringify({ type: 'ping' })), 10_000);
  await sleep(30_000);
  clearInterval(pinger);
  clearInterval(tick);
  const elapsed = (performance.now() - t0) / 1000;
  const errCount = {};
  for (const e of errors) errCount[e] = (errCount[e] ?? 0) + 1;
  const firsts = [...firstBook.values()].sort((a, b) => a - b);
  const steady = perSecond.slice(5);
  log('batch_result', {
    subscriptions: ids.length, acks: acks.size, booksWithAFrame: firstBook.size, errors: errCount,
    firstBookMs: firsts.length ? { min: firsts[0], median: firsts[Math.floor(firsts.length / 2)], max: firsts[firsts.length - 1] } : null,
    frames, framesPerSecond: Math.round(frames / elapsed), steadyPerSecond: { median: [...steady].sort((a, b) => a - b)[Math.floor(steady.length / 2)], max: Math.max(...steady) },
    bytesPerSecond: Math.round(bytes / elapsed), bytesPerFrame: Math.round(bytes / frames), parseUsPerFrame: Math.round(parseUs / frames), closed: s.closed ?? 'open',
  });
  const silent = ids.filter((id) => !firstBook.has(id));
  log('batch_silent_books', { count: silent.length, sample: silent.slice(0, 15) });
  s.ws.close();
}

async function silence() {
  const variants = [
    ['nothing sent', {}, async () => {}],
    ['one ping at 1 s then nothing', {}, async (s) => {
      await sleep(1_000);
      s.ws.send(JSON.stringify({ type: 'ping' }));
    }],
    ['no User-Agent, subscribe busy book at once, nothing after', { userAgent: false }, async (s) => s.ws.send(sub('orderbook', 'BRLBTC', 10))],
  ];
  const sockets = variants.map(([label, opts]) => open(label, opts));
  const lastFrame = new Map();
  const counts = new Map();
  await Promise.all(
    sockets.map(async (s, i) => {
      s.ws.on('message', (buf) => {
        lastFrame.set(s.label, Math.round(performance.now() - s.t0));
        counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
        if ((counts.get(s.label) ?? 0) <= 2) capture('frames_silence.txt', `${s.label}: ${buf.toString('utf8').slice(0, 300)}`);
      });
      try {
        await waitOpen(s);
      } catch {
        return;
      }
      await variants[i][2](s);
    }),
  );
  const deadline = performance.now() + 65_000;
  while (performance.now() < deadline && sockets.some((s) => !s.closed)) await sleep(250);
  for (const s of sockets) {
    log('silence', { label: s.label, openMs: s.openMs, frames: counts.get(s.label) ?? 0, lastFrameAtMs: lastFrame.get(s.label) ?? null, closed: s.closed ?? 'open after 65 s' });
    if (!s.closed) s.ws.terminate();
  }
}

// Which depth each stream gets when one socket subscribes several limits, and when a socket holds a single stream.
async function limits() {
  const plan = [
    ['mixed', [['BRLBTC', 50, 0], ['BRLETH', 20, 4_000], ['BRLUSDT', 200, 8_000]]],
    ['alone 200', [['BRLSOL', 200, 0]]],
    ['alone 100', [['BRLXRP', 100, 0]]],
  ];
  const results = [];
  await Promise.all(
    plan.map(async ([label, subs]) => {
      const s = open(label);
      await waitOpen(s);
      const t0 = performance.now();
      const seen = [];
      s.ws.on('message', (buf) => {
        const m = JSON.parse(buf.toString('utf8'));
        if (m.type !== 'orderbook') return;
        const at = Math.round((performance.now() - t0) / 1000);
        const tag = `${m.id} limit ${m.limit} levels ${m.data.bids.length}/${m.data.asks.length}`;
        const last = seen.findLast((x) => x.id === m.id);
        if (!last || last.tag !== tag) seen.push({ id: m.id, tag, fromS: at });
      });
      for (const [id, limit, at] of subs) {
        const wait = at - (performance.now() - t0);
        if (wait > 0) await sleep(wait);
        s.ws.send(sub('orderbook', id, limit));
      }
      await sleep(12_000 - (performance.now() - t0));
      results.push({ label, changes: seen.map((x) => `${x.tag} from ${x.fromS} s`) });
      s.ws.close();
    }),
  );
  for (const r of results) log('limits', r);
}

// Whether a book that does not change gets a frame after the subscribe, set against its REST book.
async function quiet() {
  const ids = (process.argv[3] ?? 'BRLWCT,BRLRLC,BRLBADGER,BRLRON,BRLBERA').split(',');
  for (const id of ids) {
    const r = await fetch(`${V4}/${id.slice(3)}-BRL/orderbook?limit=20`, { headers: { 'User-Agent': UA } });
    const j = await r.json();
    log('quiet_rest', { id, status: r.status, bids: j.bids?.length, asks: j.asks?.length, top: [j.bids?.[0]?.[0], j.asks?.[0]?.[0]] });
    await sleep(1_100);
  }
  const s = open('quiet');
  await waitOpen(s);
  const t0 = performance.now();
  const first = new Map();
  const counts = new Map();
  s.ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString('utf8'));
    if (m.type !== 'orderbook') return;
    if (!first.has(m.id)) first.set(m.id, Math.round(performance.now() - t0));
    counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  });
  for (const id of ids) s.ws.send(sub('orderbook', id, 20));
  const pinger = setInterval(() => s.ws.send(JSON.stringify({ type: 'ping' })), 10_000);
  await sleep(20_000);
  clearInterval(pinger);
  for (const id of ids) log('quiet_ws', { id, firstFrameMs: first.get(id) ?? null, frames: counts.get(id) ?? 0 });
  s.ws.close();
}

async function deflate() {
  const s = open('deflate', { deflate: true });
  await waitOpen(s);
  let first;
  s.ws.on('message', (buf) => {
    if (!first) first = buf.toString('utf8').slice(0, 120);
  });
  s.ws.send(sub('orderbook', 'BRLBTC', 10));
  await sleep(3_000);
  log('deflate', { offered: 'permessage-deflate', negotiated: s.extensions, openMs: s.openMs, first });
  s.ws.close();
}

const mode = process.argv[2] ?? 'book';
const run = { book, limits, batch, quiet, silence, deflate }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
