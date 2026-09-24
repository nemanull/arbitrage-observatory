// Kinesis WebSocket probe: the socket.io depth, snapshots and executions namespaces the kms.kinesis.money web app opens, their frames, keepalive, silence, errors and a batch of pairs.
// Public, unauthenticated and read-only. It speaks Engine.IO 4 and Socket.IO 5 by hand over `ws`, sends only the namespace connect and pongs, and opens sockets with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/venues/kinesis/ws-probe.mjs [book|errors|streams|silence|batch|deflate|all]
//   book     depth on four pairs for 75 s, one socket per pair, with a REST depth compare at the end
//   errors   unknown, lowercase and missing symbols, a bad path, and an emitted subscribe for a second pair, about 15 s
//   streams  the snapshots namespace and the public executions namespace for 30 s
//   silence  three sockets that differ only in whether they connect the namespace and answer pings, up to 90 s
//   batch    depth on 40 pairs at once for 30 s
//   deflate  offers permessage-deflate once and prints what the server negotiates
//   all      every mode in turn, about 4 minutes and 4 minutes of socket time
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/kinesis/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const ORIGIN = 'wss://fastapi.kinesis.money'; // the web app's `defaultApiRoot`, where its socket.io client connects
const DEPTH_PATH = '/notifications/market-data/v2/depth/';
const SNAP_PATH = '/notifications/market-data/v2/snapshots/';
const EXEC_PATH = '/notifications/order-data/executions/';
const API = 'https://fastapi.kinesis.money/api';
const OUT = process.env.PROBE_OUT_DIR;
const MODE = process.argv[2] ?? 'book';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 1500) + '\n');
}

const url = (path, query = {}) => `${ORIGIN}${path}?${new URLSearchParams({ ...query, EIO: '4', transport: 'websocket' })}`;

// One socket.io client: Engine.IO open packet `0{…}`, namespace connect `40`, events `42[name, data]`, server ping `2`, pong `3`.
function sio(name, u, { connect = true, pong = true, deflate = false } = {}) {
  const s = { name, t0: performance.now(), openMs: null, open: null, ackMs: null, ack: null, events: [], pings: [], closed: null, errors: [], frames: 0, bytes: 0 };
  s.ws = new WebSocket(u, { perMessageDeflate: deflate });
  s.ws.on('upgrade', (res) => { s.extensions = res.headers['sec-websocket-extensions'] ?? null; });
  s.ws.on('open', () => { s.openMs = performance.now() - s.t0; });
  s.ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    const at = performance.now() - s.t0;
    s.frames++;
    s.bytes += raw.length;
    capture(`${name}.txt`, `${Math.round(at)} ${text}`);
    if (text[0] === '0') {
      s.open = JSON.parse(text.slice(1));
      if (connect) s.ws.send('40');
    } else if (text === '2') {
      s.pings.push(at);
      if (pong) s.ws.send('3');
    } else if (text.startsWith('40')) {
      s.ackMs = at;
      s.ack = text;
    } else if (text.startsWith('44')) {
      s.errors.push(text);
    } else if (text.startsWith('42')) {
      const [event, data] = JSON.parse(text.slice(2));
      s.events.push({ at, event, data, len: text.length });
      s.onEvent?.(event, data, at);
    } else {
      s.errors.push(text.slice(0, 200));
    }
  });
  s.ws.on('unexpected-response', (_req, res) => { s.errors.push(`http ${res.statusCode}`); });
  s.ws.on('error', (e) => s.errors.push(e.message));
  s.ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - s.t0) }; });
  return s;
}

const close = (s) => { try { s.ws.close(); } catch {} };
const desc = (a) => a.every((x, i) => i === 0 || a[i - 1].price > x.price);
const asc = (a) => a.every((x, i) => i === 0 || a[i - 1].price < x.price);
const minGap = (t) => Math.round(Math.min(...t.slice(1).map((x, i) => x - t[i])));
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o) : typeof o);

async function book() {
  const pairs = ['KAU_C1USD', 'KAG_C1USD', 'BTC_C1USD', 'IMX_C1USD'];
  const socks = pairs.map((p) => {
    const s = sio(`depth-${p}`, url(DEPTH_PATH, { symbolId: p }));
    s.book = null;
    s.stats = { init: 0, bid: 0, ask: 0, other: 0, repeats: 0, fullSideLen: { bid: [], ask: [] }, orderOk: { bid: 0, ask: 0 }, orderBad: { bid: 0, ask: 0 }, gaps: [], last: null, prevSide: {}, keys: new Set(), symbolMismatch: 0, wallPhase: [], sideAt: { bid: [], ask: [] } };
    s.onEvent = (event, data, at) => {
      const st = s.stats;
      if (st.last !== null) st.gaps.push(at - st.last);
      st.last = at;
      st.keys.add(`${event}:${JSON.stringify(keysOf(data))}`);
      if ((Array.isArray(data) ? data[0] : data)?.symbolId !== p) st.symbolMismatch++;
      if (event === 'onInit') {
        const d = Array.isArray(data) ? data[0] : data;
        st.init++;
        s.book = { bid: d.bid, ask: d.ask };
        st.initShape = { isArray: Array.isArray(data), bid: d.bid?.length, ask: d.ask?.length, bidDesc: desc(d.bid ?? []), askAsc: asc(d.ask ?? []), atMs: Math.round(at), afterAckMs: s.ackMs === null ? null : Math.round(at - s.ackMs) };
      } else if (event === 'onChange') {
        const dir = data.direction;
        if (dir !== 'bid' && dir !== 'ask') { st.other++; return; }
        st[dir]++;
        st.wallPhase.push(Date.now() % 1000); // where in the wall-clock second the frame arrived
        st.sideAt[dir].push(at);
        st.fullSideLen[dir].push(data.depth.length);
        const ok = dir === 'bid' ? desc(data.depth) : asc(data.depth);
        st[ok ? 'orderOk' : 'orderBad'][dir]++;
        const sig = JSON.stringify(data.depth);
        if (st.prevSide[dir] === sig) st.repeats++;
        st.prevSide[dir] = sig;
        if (s.book) s.book[dir] = data.depth;
      } else {
        st.other++;
      }
    };
    return s;
  });
  await sleep(75_000);
  // Compare the socket's book with a REST read taken now.
  for (const s of socks) {
    const p = s.name.slice(6);
    const rest = await (await fetch(`${API}/exchange/depth/${p}`)).json();
    const cmp = (a = [], b = []) => { let eq = 0; for (let i = 0; i < Math.min(10, a.length, b.length); i++) if (a[i].price === b[i].price && a[i].amount === b[i].amount) eq++; return eq; };
    const st = s.stats;
    const sorted = [...st.gaps].sort((a, b) => a - b);
    log('depth', {
      pair: p, openMs: Math.round(s.openMs), open: s.open, ack: s.ack, ackMs: Math.round(s.ackMs), init: st.init, initShape: st.initShape,
      onChange: { bid: st.bid, ask: st.ask, other: st.other }, perSecond: +((st.bid + st.ask) / 75).toFixed(2), sideLen: { bid: [Math.min(...st.fullSideLen.bid), Math.max(...st.fullSideLen.bid)], ask: [Math.min(...st.fullSideLen.ask), Math.max(...st.fullSideLen.ask)] },
      orderOk: st.orderOk, orderBad: st.orderBad, identicalRepeats: st.repeats, wallPhaseMs: [Math.min(...st.wallPhase), Math.max(...st.wallPhase)], minSameSideGapMs: { bid: minGap(st.sideAt.bid), ask: minGap(st.sideAt.ask) }, gapMs: { median: Math.round(sorted[sorted.length >> 1] ?? 0), max: Math.round(sorted.at(-1) ?? 0) },
      pingsAtMs: s.pings.map(Math.round), keys: [...st.keys], symbolMismatch: st.symbolMismatch, errors: s.errors, closed: s.closed, frames: s.frames, bytes: s.bytes,
      restTop10Equal: { bid: cmp(s.book?.bid, rest.buy), ask: cmp(s.book?.ask, rest.sell) }, restLevels: { buy: rest.buy.length, sell: rest.sell.length }, socketLevels: { bid: s.book?.bid?.length, ask: s.book?.ask?.length },
    });
    const ex = s.events.find((e) => e.event === 'onChange');
    if (ex) log('onChange_example', { pair: p, direction: ex.data.direction, depthLen: ex.data.depth.length, head: ex.data.depth.slice(0, 2), keys: Object.keys(ex.data), frameBytes: ex.len });
    close(s);
  }
}

async function errors() {
  const cases = [
    ['unknown', url(DEPTH_PATH, { symbolId: 'NOPE_C1USD' })],
    ['lowercase', url(DEPTH_PATH, { symbolId: 'kau_c1usd' })],
    ['missing', url(DEPTH_PATH)],
    ['badpath', url('/notifications/market-data/v2/nope/', { symbolId: 'KAU_C1USD' })],
  ];
  const socks = cases.map(([n, u]) => sio(`err-${n}`, u));
  // An emitted subscribe for a second pair on a KAU socket: frames for KAG would mean one socket can carry several pairs.
  const multi = sio('err-emit', url(DEPTH_PATH, { symbolId: 'KAU_C1USD' }));
  const emitted = setTimeout(() => {
    multi.ws.send('42["subscribe",{"symbolId":"KAG_C1USD"}]');
    multi.ws.send('42["subscribe","KAG_C1USD"]');
    multi.ws.send('42["join","KAG_C1USD"]');
  }, 2000);
  await sleep(15_000);
  clearTimeout(emitted);
  for (const s of [...socks, multi]) {
    const one = (d) => (Array.isArray(d) ? d[0] : d);
    const syms = [...new Set(s.events.map((e) => one(e.data)?.symbolId))];
    const init = one(s.events.find((e) => e.event === 'onInit')?.data);
    log('error_case', { name: s.name, openMs: s.openMs && Math.round(s.openMs), ack: s.ack, events: s.events.length, eventNames: [...new Set(s.events.map((e) => e.event))], symbolIds: syms, init: init ? { symbolId: init.symbolId, bid: init.bid?.length, ask: init.ask?.length } : null, errors: s.errors, closed: s.closed });
    close(s);
  }
}

async function streams() {
  const snap = sio('snapshots', url(SNAP_PATH));
  const exec = sio('executions-KAU_C1USD', url(EXEC_PATH, { symbolId: 'KAU_C1USD' }));
  await sleep(30_000);
  // Each event is a map from symbol to a row. onInit carries every symbol, onChange only the symbols that moved.
  const initRows = Object.values(snap.events.find((e) => e.event === 'onInit')?.data ?? {});
  const changeRows = snap.events.filter((e) => e.event === 'onChange').flatMap((e) => Object.values(e.data));
  const listed = new Set((await (await fetch(`${API}/tradeable-symbols/public?includeOrderRange=true&includeKvtPairs=true`)).json()).map((p) => p.id));
  const crossed = (rows) => rows.filter((r) => r.bidPrice > r.askPrice).length;
  log('snapshots', {
    openMs: Math.round(snap.openMs), ack: snap.ack, events: snap.events.length, initFrameBytes: snap.events.find((e) => e.event === 'onInit')?.len, maxFrameBytes: Math.max(...snap.events.map((e) => e.len)), perSecond: +(snap.events.length / 30).toFixed(2), eventNames: [...new Set(snap.events.map((e) => e.event))],
    initSymbols: initRows.length, initListed: initRows.filter((r) => listed.has(r.symbolId)).length, initUsdSuffix: initRows.filter((r) => r.symbolId.endsWith('_USD')).length, rowKeys: Object.keys(initRows[0] ?? {}),
    changeRows: changeRows.length, changeSymbols: new Set(changeRows.map((r) => r.symbolId)).size, rowsPerChange: +(changeRows.length / Math.max(1, snap.events.length - 1)).toFixed(1),
    crossedInit: crossed(initRows), crossedChange: crossed(changeRows), crossedExample: JSON.stringify(changeRows.find((r) => r.bidPrice > r.askPrice) ?? null).slice(0, 300), pings: snap.pings.length, errors: snap.errors, closed: snap.closed,
  });
  const init = exec.events.find((e) => e.event === 'onInit');
  log('executions', { openMs: Math.round(exec.openMs), ack: exec.ack, events: exec.events.length, eventNames: [...new Set(exec.events.map((e) => e.event))], initLen: Array.isArray(init?.data) ? init.data.length : null, initFirst: init && JSON.stringify(Array.isArray(init.data) ? init.data[0] : init.data).slice(0, 300), change: JSON.stringify(exec.events.find((e) => e.event === 'onChange')?.data ?? null).slice(0, 300), errors: exec.errors, closed: exec.closed });
  close(snap);
  close(exec);
}

async function silence() {
  const socks = [
    sio('silent-no-connect-no-pong', url(DEPTH_PATH, { symbolId: 'IMX_C1USD' }), { connect: false, pong: false }),
    sio('silent-connected-no-pong', url(DEPTH_PATH, { symbolId: 'IMX_C1USD' }), { connect: true, pong: false }),
    sio('normal-connected-pong', url(DEPTH_PATH, { symbolId: 'IMX_C1USD' }), { connect: true, pong: true }),
  ];
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000 && socks.some((s) => s.closed === null)) await sleep(500);
  for (const s of socks) {
    log('silence', { name: s.name, open: s.open, pingsAtMs: s.pings.map(Math.round), events: s.events.length, closed: s.closed, errors: s.errors });
    close(s);
  }
}

async function batch() {
  const res = await (await fetch(`${API}/tradeable-symbols/public?includeOrderRange=true&includeKvtPairs=true`)).json();
  const pairs = res.map((p) => p.id).slice(0, 40);
  const socks = pairs.map((p) => sio(`batch-${p}`, url(DEPTH_PATH, { symbolId: p })));
  await sleep(30_000);
  const opened = socks.filter((s) => s.openMs !== null);
  const inits = socks.filter((s) => s.events.some((e) => e.event === 'onInit'));
  const changes = socks.reduce((a, s) => a + s.events.filter((e) => e.event === 'onChange').length, 0);
  const bytes = socks.reduce((a, s) => a + s.bytes, 0);
  const frames = socks.reduce((a, s) => a + s.frames, 0);
  const openMs = opened.map((s) => s.openMs).sort((a, b) => a - b);
  log('batch', { sockets: socks.length, opened: opened.length, withInit: inits.length, onChangePerSecond: +(changes / 30).toFixed(1), framesPerSecond: +(frames / 30).toFixed(1), bytesPerSecond: Math.round(bytes / 30), bytesPerFrame: Math.round(bytes / frames), openMs: { min: Math.round(openMs[0]), median: Math.round(openMs[openMs.length >> 1]), max: Math.round(openMs.at(-1)) }, quietPairs: socks.filter((s) => !s.events.some((e) => e.event === 'onChange')).map((s) => s.name.slice(6)), errors: socks.flatMap((s) => s.errors).slice(0, 5), closed: socks.filter((s) => s.closed).length });
  // Parse cost: one onChange frame parsed 10,000 times.
  const sample = socks.flatMap((s) => s.events).find((e) => e.event === 'onChange');
  if (sample) {
    const text = '42' + JSON.stringify([sample.event, sample.data]);
    const t = performance.now();
    for (let i = 0; i < 10_000; i++) JSON.parse(text.slice(2));
    log('parse_cost', { frameBytes: text.length, usPerParse: +(((performance.now() - t) * 1000) / 10_000).toFixed(1) });
  }
  socks.forEach(close);
}

async function deflate() {
  const s = sio('deflate', url(DEPTH_PATH, { symbolId: 'KAU_C1USD' }), { deflate: true });
  await sleep(5_000);
  log('deflate', { offered: 'permessage-deflate', negotiated: s.extensions ?? null, frames: s.frames, errors: s.errors });
  close(s);
}

const modes = { book, errors, streams, silence, batch, deflate };
if (MODE === 'all') for (const m of Object.values(modes)) await m();
else await modes[MODE]();
await sleep(300);
process.exit(0);
