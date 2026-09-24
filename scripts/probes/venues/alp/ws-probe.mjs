// ALP.COM WebSocket probe: the market_depth and diff book channels on every spot pair, their cadence, level order and idle repeats, the server ping, errors, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/alp/ws-probe.mjs [book|errors|limits|silence [seconds]|deflate]
//   book     market_depth on all 22 pairs, diff on 20, trade.* and ticker.* over three sockets for 75 s, answering the server ping, with a REST book compare every 15 s. About 80 s.
//   errors   unknown pair, unknown topic, a per-pair ticker, a double subscribe, non-JSON text, an object frame, an unsubscribe, and frames past the 20 topic cap. About 20 s.
//   limits   the 20 topic budget per connection, whether unsubscribing frees it, and the largest frame the server reads. About 20 s.
//   silence  three sockets that differ in whether they subscribe and whether they answer the server's protocol ping, for 120 s or the seconds given.
//   deflate  asks for permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/alp/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://www.alp.com/ws';
const API = 'https://www.alp.com/api/v3';
const OUT = process.env.PROBE_OUT_DIR;
const SILENCE_MS = Math.min(120, Number(process.argv[3]) || 120) * 1000; // silence mode only, capped at 120 s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

function open(label, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(URL_WS, { perMessageDeflate: opts.deflate ?? false, autoPong: opts.autoPong ?? true });
  ws.on('upgrade', (res) => log('upgrade', { label, status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, ray: res.headers['cf-ray'] }));
  ws.on('unexpected-response', (_req, res) => log('refused', { label, status: res.statusCode }));
  ws.on('error', (e) => log('socketError', { label, message: e.message }));
  ws.on('ping', () => log('protocolPing', { label, atMs: Date.now() - t0 }));
  ws.on('pong', () => log('protocolPong', { label, atMs: Date.now() - t0 }));
  ws.t0 = t0;
  return ws;
}

// The server holds at most 20 topics per connection, so the 22 depth streams, the 20 diff streams and the two wildcards go on three sockets.
async function book() {
  const pairs = (await (await fetch(`${API}/pairs`)).json()).map((p) => p.name);
  const plans = [
    { label: 'depthA', topics: pairs.slice(0, 11).map((p) => `market_depth.${p}`).concat(['trade.*', 'ticker.*']) },
    { label: 'depthB', topics: pairs.slice(11).map((p) => `market_depth.${p}`) },
    { label: 'diff', topics: pairs.slice(0, 20).map((p) => `diff.${p}`) },
  ];
  const per = new Map(pairs.map((p) => [p, { p: 0, d: 0, arrivals: [], repeats: 0, last: null, firstPMs: null, bidsDesc: true, asksAsc: true, levels: [], sideEmpty: 0, lag: [] }]));
  const counts = {};
  const pings = {};
  let firstDiff = null;
  const compares = [];
  const sockets = plans.map((plan) => {
    const ws = open(plan.label);
    pings[plan.label] = [];
    ws.on('open', () => {
      log('open', { label: plan.label, ms: Date.now() - ws.t0 });
      ws.subAt = Date.now();
      for (let i = 0; i < plan.topics.length; i += 10) ws.send(JSON.stringify(['subscribe', ...plan.topics.slice(i, i + 10)]));
    });
    ws.on('close', (code) => log('close', { label: plan.label, code, atMs: Date.now() - ws.t0 }));
    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      const s = data.toString();
      if (isBinary) counts.binary = (counts.binary || 0) + 1;
      if (s === '1') {
        pings[plan.label].push(now - ws.t0);
        ws.send('2');
        counts.ping = (counts.ping || 0) + 1;
        return;
      }
      let j;
      try {
        j = JSON.parse(s);
      } catch {
        counts.unparsed = (counts.unparsed || 0) + 1;
        log('unparsed', { text: s.slice(0, 120) });
        return;
      }
      const type = j[0];
      counts[type] = (counts[type] || 0) + 1;
      capture(`${plan.label}.txt`, `${now} ${s.slice(0, 2000)}`);
      if (type === 'p') {
        const b = j[2];
        const st = per.get(b.Symbol);
        if (!st) return;
        st.p++;
        if (st.firstPMs === null) st.firstPMs = now - ws.subAt;
        st.arrivals.push(now);
        st.lag.push(now - j[1] * 1000);
        const key = JSON.stringify([b.Asks, b.Bids]);
        if (st.last === key) st.repeats++;
        st.last = key;
        st.lastBook = b;
        const bids = (b.Bids || []).map((l) => Number(l[0]));
        const asks = (b.Asks || []).map((l) => Number(l[0]));
        if (!bids.every((x, i) => i === 0 || x < bids[i - 1])) st.bidsDesc = false;
        if (!asks.every((x, i) => i === 0 || x > asks[i - 1])) st.asksAsc = false;
        st.levels.push(`${bids.length}/${asks.length}`);
        if (!bids.length || !asks.length) st.sideEmpty++;
      } else if (type === 'd') {
        const st = per.get(j[2]);
        if (st) st.d++;
        if (!firstDiff) {
          firstDiff = s.slice(0, 600);
          log('firstDiff', { atMs: now - ws.subAt, frame: firstDiff });
        }
      } else if (type === 'subscribe' || type === 'error' || type === 'welcome') {
        log('control', { label: plan.label, atMs: now - ws.t0, frame: s.slice(0, 160) + (s.length > 160 ? `… (${j.length - 2} topics)` : '') });
      } else if (type === 'tk' && counts.tk === 1) {
        log('firstTicker', { rows: j.length - 2, row: j[2] });
      }
    });
    return ws;
  });
  const cmp = setInterval(async () => {
    for (const pair of ['BTC_USDC', 'ETH_USDC', 'XRP_USDC']) {
      const st = per.get(pair);
      if (!st.lastBook) continue;
      const r = await (await fetch(`${API}/orderbook?pair=${pair}`)).json();
      const wb = st.lastBook.Bids.map((l) => `${Number(l[0])}:${Number(l[1])}`);
      const wa = st.lastBook.Asks.map((l) => `${Number(l[0])}:${Number(l[1])}`);
      const rb = r.buy.map((l) => `${l.price}:${l.amount}`);
      const ra = r.sell.map((l) => `${l.price}:${l.amount}`);
      const same = wb.filter((x, i) => x === rb[i]).length + wa.filter((x, i) => x === ra[i]).length;
      compares.push({ pair, sameLevelsOf40: same, touchEqual: wb[0] === rb[0] && wa[0] === ra[0], wsBookAgeMs: Date.now() - st.arrivals[st.arrivals.length - 1] });
    }
  }, 15000);
  await sleep(75000);
  clearInterval(cmp);
  for (const ws of sockets) ws.close();
  await sleep(500);
  log('counts', counts);
  log('serverPings', pings);
  const allGaps = [];
  for (const [pair, st] of per) {
    const gaps = st.arrivals.slice(1).map((x, i) => x - st.arrivals[i]);
    allGaps.push(...gaps);
    log('pair', { pair, pFrames: st.p, diffFrames: st.d, firstPMsAfterSubscribe: st.firstPMs, gapMs: stats(gaps), identicalRepeats: st.repeats, levelsBidAsk: [...new Set(st.levels)].slice(0, 4), sideEmptyFrames: st.sideEmpty, bidsDesc: st.bidsDesc, asksAsc: st.asksAsc, lagMsVsFrameSecond: stats(st.lag) });
  }
  const g = stats(allGaps);
  const nearSecond = allGaps.filter((x) => Math.abs(x - Math.round(x / 1000) * 1000) < 100).length;
  log('allPairsGap', { ...g, within100msOfWholeSecond: nearSecond });
  log('restCompare', { compares });
}

// A frame that is not a JSON array drops the socket, so each step runs on the open socket or on a fresh one when the last step closed it.
async function errors() {
  const pairs = (await (await fetch(`${API}/pairs`)).json()).map((p) => p.name);
  const big = pairs.flatMap((p) => [`market_depth.${p}`, `diff.${p}`]).concat(['trade.*', 'ticker.*']);
  const steps = [
    ['unknown pair diff', JSON.stringify(['subscribe', 'diff.NOPE_USDT'])],
    ['unknown pair depth', JSON.stringify(['subscribe', 'market_depth.NOPE_USDT'])],
    ['unknown topic', JSON.stringify(['subscribe', 'nope.BTC_USDC'])],
    ['per pair ticker', JSON.stringify(['subscribe', 'ticker.BTC_USDC'])],
    ['depth once', JSON.stringify(['subscribe', 'market_depth.ZEC_USDC'])],
    ['depth twice', JSON.stringify(['subscribe', 'market_depth.ZEC_USDC'])],
    ['lower case pair', JSON.stringify(['subscribe', 'market_depth.btc_usdc'])],
    ['unsubscribe', JSON.stringify(['unsubscribe', 'market_depth.ZEC_USDC'])],
    ['unsubscribe never subscribed', JSON.stringify(['unsubscribe', 'diff.ETH_USDC'])],
    ['client ping text 1', '1'],
    ['client pong text 2 unprompted', '2'],
    ['21 topics in one frame', JSON.stringify(['subscribe', ...Array.from({ length: 21 }, (_, i) => `trade.P${i}_USDT`)])],
    ['46 real topics in one frame, as the first book run sent', JSON.stringify(['subscribe', ...big])],
    ['object frame', JSON.stringify({ op: 'subscribe', args: ['market_depth.BTC_USDC'] })],
    ['not json', 'hello'],
    ['empty array', '[]'],
  ];
  let ws = null;
  const connect = async () => {
    ws = open('errors');
    const me = ws;
    me.on('message', (d) => {
      const s = d.toString();
      if (s === '1') return me.send('2');
      if (/^\["(p|tk|t|d)"/.test(s)) return log('data', { head: s.slice(0, 80) });
      log('reply', { atMs: Date.now() - me.t0, frame: s.slice(0, 240) });
    });
    me.on('close', (c, r) => log('close', { code: c, reason: r.toString(), atMs: Date.now() - me.t0 }));
    await new Promise((r) => me.once('open', r));
  };
  for (const [what, frame] of steps) {
    if (!ws || ws.readyState !== ws.OPEN) await connect();
    log('send', { what, frame: frame.length > 120 ? `${frame.slice(0, 120)}… (${frame.length} bytes)` : frame });
    ws.send(frame);
    await sleep(1500);
  }
  await sleep(1000);
  if (ws.readyState === ws.OPEN) ws.close();
  await sleep(300);
}

// The server pings with protocol frames, which ws answers on its own unless autoPong is false.
// The engine keeps autoPong on, as socket B does.
async function silence() {
  const cases = [
    { label: 'A no subscribe, no pong', sub: null, autoPong: false },
    { label: 'B no subscribe, auto pong', sub: null, autoPong: true },
    { label: 'C quiet pair, no pong', sub: 'market_depth.USDC_USDT', autoPong: false },
  ];
  const done = cases.map(
    (c) =>
      new Promise((resolve) => {
        const ws = open(c.label, { autoPong: c.autoPong });
        const pings = [];
        const data = [];
        ws.on('open', () => {
          if (c.sub) ws.send(JSON.stringify(['subscribe', c.sub]));
        });
        ws.on('ping', () => pings.push(Date.now() - ws.t0));
        ws.on('message', (d) => {
          if (d.toString() === '1') pings.push(`text@${Date.now() - ws.t0}`);
          data.push(Date.now() - ws.t0);
        });
        const timer = setTimeout(() => ws.close(), SILENCE_MS);
        ws.on('close', (code, reason) => {
          clearTimeout(timer);
          const gaps = data.slice(1).map((x, i) => x - data[i]);
          log('silenceResult', { label: c.label, code, reason: reason.toString(), closedAtMs: Date.now() - ws.t0, protocolPingsAtMs: pings, dataFrames: data.length, lastDataAtMs: data[data.length - 1], maxDataGapMs: gaps.length ? Math.max(...gaps) : null });
          resolve();
        });
      }),
  );
  await Promise.all(done);
}

// Topic budget per connection and the largest frame the server reads, each on its own socket.
// Only a valid topic counts against the budget, so the budget cases use real depth, diff and trade topics.
async function limits() {
  const pairs = (await (await fetch(`${API}/pairs`)).json()).map((p) => p.name);
  const real = pairs.flatMap((p) => [`market_depth.${p}`, `diff.${p}`, `trade.${p}`]);
  const once = async (label, frames, gapMs) => {
    const ws = open(label);
    const replies = [];
    let closed = null;
    ws.on('message', (d) => {
      const s = d.toString();
      if (/^\["(subscribe|unsubscribe|error)"/.test(s)) replies.push(s.startsWith('["error"') ? JSON.parse(s)[2].slice(0, 40) : `${JSON.parse(s)[0]} ok ${JSON.parse(s).length - 2}`);
    });
    ws.on('close', (code) => (closed = code));
    await new Promise((r) => ws.once('open', r));
    for (const f of frames) {
      if (ws.readyState !== ws.OPEN) break;
      ws.send(f);
      await sleep(gapMs);
    }
    await sleep(1000);
    if (ws.readyState === ws.OPEN) ws.close();
    await sleep(200);
    log('limit', { label, frames: frames.length, bytes: frames.map((f) => f.length), replies, closedBy: closed === 1005 ? 'client' : closed });
  };
  const t = (i) => real[i];
  await once('21 single topic frames', Array.from({ length: 21 }, (_, i) => JSON.stringify(['subscribe', t(i)])), 300);
  await once('frames of 8, 8 and 8 topics', [0, 8, 16].map((k) => JSON.stringify(['subscribe', ...Array.from({ length: 8 }, (_, i) => t(k + i))])), 800);
  await once('12 topics, unsubscribe 12, then 12 more', [JSON.stringify(['subscribe', ...Array.from({ length: 12 }, (_, i) => t(i))]), JSON.stringify(['unsubscribe', ...Array.from({ length: 12 }, (_, i) => t(i))]), JSON.stringify(['subscribe', ...Array.from({ length: 12 }, (_, i) => t(20 + i))])], 800);
  for (const bytes of [800, 850]) {
    const pad = 'x'.repeat(bytes - JSON.stringify(['subscribe', 'trade.']).length);
    await once(`one frame of ${bytes} bytes`, [JSON.stringify(['subscribe', `trade.${pad}`])], 1000);
  }
}

async function deflate() {
  const ws = open('deflate', { deflate: true });
  await new Promise((r) => ws.once('open', r));
  await sleep(1500);
  ws.close();
  await sleep(300);
}

const mode = process.argv[2] || 'book';
log('mode', { mode, at: new Date().toISOString() });
await { book, errors, silence, deflate, limits }[mode]();
