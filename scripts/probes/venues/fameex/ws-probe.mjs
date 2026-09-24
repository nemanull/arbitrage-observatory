// FameEX futures WebSocket probe: book channel shape and cadence, gzip framing, keepalive, silence, errors, and a batch of perpetuals on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/fameex/ws-probe.mjs [book|errors|batch|silence|deflate|spot]
//   book     depth_step0 on four perps and the BTC ticker for 45 s, with one REST depth read to compare sizes. About 50 s.
//   errors   short sockets for unknown and closed symbols, depth_step1, bad frames, heartbeat variants, a double subscription and an unsubscribe. About 17 s.
//   batch    depth_step0 on every active perp on one connection for 40 s.
//   silence  three sockets for up to 75 s: subscribed and silent, subscribed with {"pong":ts} every 20 s, and unsubscribed and silent. The server's {"ping"} replies are never answered, because each client pong draws one ping back.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   spot     the documented spot socket, depth_step on BTCUSDT for 8 s, to name it in the coverage matrix.
// Set PROBE_OUT_DIR to keep a few raw frames. Recorded in docs/profiles/fameex/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FUT_URL = 'wss://futuresws.fameex.com/kline-api/ws';
const SPOT_URL = 'wss://wsapi.fameex.com/v1/ws/stream/public';
const API = 'https://futuresopenapi.fameex.com/fapi/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel, cb = '1') => JSON.stringify({ event: 'sub', params: { channel, cb_id: cb } });
const channelOf = (id, kind = 'depth_step0') => `market_e_${id.slice(2).replace(/-/g, '').toLowerCase()}_${kind}`; // E-BTC-USDT to market_e_btcusdt_depth_step0
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

// Opens a socket and decodes every frame: binary frames are gzip, text frames are plain.
function open(url, onFrame, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  const s = { ws, t0, frames: 0, bin: 0, text: 0, bytes: 0, rawBytes: 0, decodeUs: [], closed: null, pings: 0, openMs: null, headers: null };
  ws.on('upgrade', (res) => { s.headers = res.headers; });
  ws.on('open', () => { s.openMs = Date.now() - t0; opts.onOpen?.(ws, s); });
  ws.on('ping', () => { s.pings++; });
  ws.on('message', (d, isBin) => {
    const h0 = process.hrtime.bigint();
    let txt;
    try { txt = isBin ? gunzipSync(d).toString('utf8') : d.toString('utf8'); } catch { txt = null; }
    let msg = null;
    try { msg = txt === null ? null : JSON.parse(txt); } catch { msg = null; }
    s.decodeUs.push(Number(process.hrtime.bigint() - h0) / 1000);
    s.frames++; isBin ? s.bin++ : s.text++; s.rawBytes += d.length; s.bytes += txt ? txt.length : 0;
    onFrame(msg, txt, isBin, Date.now(), s);
  });
  ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }; });
  ws.on('error', (e) => { s.error = e.message; });
  return s;
}

async function restDepth(id, limit = 100) {
  const t = Date.now();
  const r = await fetch(`${API}/depth?contractName=${id}&limit=${limit}`);
  const j = await r.json();
  return { at: Date.now(), ms: Date.now() - t, j };
}

async function activeContracts() {
  const r = await fetch(`${API}/contracts`);
  return (await r.json()).filter((c) => c.status === 1);
}

function sorted(levels, dir) {
  for (let i = 1; i < levels.length; i++) if (dir * (levels[i][0] - levels[i - 1][0]) <= 0) return false;
  return true;
}

async function book() {
  const ids = ['E-BTC-USDT', 'E-ETH-USDT', 'E-SOL-USDT', 'E-ZIL-USDT'];
  const mults = Object.fromEntries((await activeContracts()).filter((c) => ids.includes(c.symbol)).map((c) => [c.symbol, c.multiplier]));
  const st = Object.fromEntries(ids.map((id) => [channelOf(id), { id, n: 0, first: null, gaps: [], last: null, prevKey: null, repeats: 0, asksMax: 0, bidsMax: 0, asksMin: 1e9, bidsMin: 1e9, askOrderBad: 0, bidOrderBad: 0, crossed: 0, oneSided: 0, tsAgeMs: [], frames: [] }]));
  const ticker = { n: 0, gaps: [], last: null, keys: null };
  let subAt = 0;
  const s = open(FUT_URL, (m, txt, isBin, now) => {
    if (!m) return log('undecoded', { isBin, head: txt?.slice(0, 120) });
    const x = st[m.channel];
    if (x) {
      const t = m.tick;
      if (x.first === null) { x.first = now - subAt; capture('book-first.json', txt); }
      if (x.last !== null) x.gaps.push(now - x.last);
      x.last = now; x.n++;
      const key = JSON.stringify(t);
      if (key === x.prevKey) x.repeats++;
      x.prevKey = key;
      x.asksMax = Math.max(x.asksMax, t.asks.length); x.bidsMax = Math.max(x.bidsMax, t.buys.length);
      x.asksMin = Math.min(x.asksMin, t.asks.length); x.bidsMin = Math.min(x.bidsMin, t.buys.length);
      if (!sorted(t.asks, 1)) x.askOrderBad++;
      if (!sorted(t.buys, -1)) x.bidOrderBad++;
      if (t.asks.length && t.buys.length && t.asks[0][0] <= t.buys[0][0]) x.crossed++;
      if (!t.asks.length || !t.buys.length) x.oneSided++;
      if (typeof m.ts === 'number') x.tsAgeMs.push(now - m.ts);
      x.keys = Object.keys(m).join(',');
      x.tickKeys = Object.keys(t).join(',');
      if (x.id === 'E-BTC-USDT') { x.frames.push({ at: now, asks: t.asks.slice(0, 20), buys: t.buys.slice(0, 20) }); if (x.frames.length > 200) x.frames.shift(); }
      return;
    }
    if (m.channel?.endsWith('_ticker')) {
      if (ticker.last !== null) ticker.gaps.push(now - ticker.last);
      ticker.last = now; ticker.n++; ticker.keys = Object.keys(m.tick).join(',');
      if (ticker.n === 1) capture('ticker.json', txt);
      return;
    }
    log('other', { isBin, frame: txt.slice(0, 200) });
  }, {
    onOpen: (ws) => {
      subAt = Date.now();
      for (const id of ids) ws.send(sub(channelOf(id), id));
      ws.send(sub(channelOf('E-BTC-USDT', 'ticker'), 'tk'));
    },
  });
  await sleep(20_000);
  const rest = await restDepth('E-BTC-USDT', 100);
  await sleep(25_000);
  s.ws.terminate();
  log('socket', { openMs: s.openMs, frames: s.frames, bin: s.bin, text: s.text, rawBytes: s.rawBytes, bytes: s.bytes, protocolPings: s.pings, closed: s.closed, decodeUsP50: pct(s.decodeUs, 0.5), decodeUsP99: pct(s.decodeUs, 0.99) });
  for (const x of Object.values(st)) {
    log('book', { id: x.id, contractSize: mults[x.id], frames: x.n, firstMs: x.first, gapMin: pct(x.gaps, 0), gapP50: pct(x.gaps, 0.5), gapP90: pct(x.gaps, 0.9), gapMax: pct(x.gaps, 1), identicalRepeats: x.repeats, asks: [x.asksMin, x.asksMax], bids: [x.bidsMin, x.bidsMax], askNotAscending: x.askOrderBad, bidNotDescending: x.bidOrderBad, crossed: x.crossed, oneSided: x.oneSided, tsAgeP50: pct(x.tsAgeMs, 0.5), keys: x.keys, tickKeys: x.tickKeys });
  }
  log('ticker', { frames: ticker.n, gapP50: pct(ticker.gaps, 0.5), gapMax: pct(ticker.gaps, 1), keys: ticker.keys });
  // REST against the WS frame nearest in time, top 20 levels per side.
  const btc = st[channelOf('E-BTC-USDT')];
  const near = btc.frames.reduce((a, f) => (Math.abs(f.at - rest.at) < Math.abs(a.at - rest.at) ? f : a), btc.frames[0]);
  const rb = rest.j.bids.slice(0, 20), ra = rest.j.asks.slice(0, 20);
  const eq = (a, b) => a.filter((l, i) => b[i] && b[i][0] === l[0] && b[i][1] === l[1]).length;
  const samePx = (a, b) => a.filter((l) => b.some((m) => m[0] === l[0])).length;
  log('rest_vs_ws', { restMs: rest.ms, restTime: rest.j.time, restLevels: [rest.j.bids.length, rest.j.asks.length], wsFrameOffsetMs: near.at - rest.at, bidsEqual: eq(rb, near.buys), asksEqual: eq(ra, near.asks), bidPricesShared: samePx(rb, near.buys), askPricesShared: samePx(ra, near.asks), restTop: [rb[0], ra[0]], wsTop: [near.buys[0], near.asks[0]] });
}

async function errors() {
  const cases = [
    ['unknown symbol', [sub('market_e_nopeusdt_depth_step0')]],
    ['closed contract E-HIFI-USDT (status 0)', [sub('market_e_hifiusdt_depth_step0')]],
    ['spot style symbol', [sub('market_btcusdt_depth_step0')]],
    ['uppercase symbol', [sub('market_e_BTCUSDT_depth_step0')]],
    ['step1', [sub('market_e_btcusdt_depth_step1')]],
    ['unknown channel', [sub('market_e_btcusdt_nope')]],
    ['double sub', [sub('market_e_btcusdt_ticker', 'a'), sub('market_e_btcusdt_ticker', 'b')]],
    ['unsub', [sub('market_e_btcusdt_ticker', 'a'), 'UNSUB']],
    ['not json', ['hello']],
    ['bare ping (documented)', [sub('market_e_btcusdt_ticker'), 'ping']],
    ['{"ping":ts}', [sub('market_e_btcusdt_ticker'), JSON.stringify({ ping: Date.now() })]],
    ['{"pong":ts}', [sub('market_e_btcusdt_ticker'), JSON.stringify({ pong: Date.now() })]],
    ['heartbeat event (spot doc)', [sub('market_e_btcusdt_ticker'), JSON.stringify({ event: 'heartbeat', params: { channel: 'ping' } })]],
  ];
  const sockets = cases.map(([name, frames]) => {
    const seen = [];
    const channels = {};
    const s = open(FUT_URL, (m, txt, isBin) => {
      const ch = m?.channel ?? '(none)';
      channels[ch] = (channels[ch] || 0) + 1;
      if (!m?.tick && seen.length < 3) seen.push(`${isBin ? 'bin' : 'text'} ${txt?.slice(0, 160)}`);
    }, {
      onOpen: async (ws) => {
        for (const f of frames) {
          if (f === 'UNSUB') { await sleep(2500); ws.send(JSON.stringify({ event: 'unsub', params: { channel: 'market_e_btcusdt_ticker', cb_id: 'a' } })); continue; }
          ws.send(f);
          await sleep(1200);
        }
      },
    });
    return { name, s, seen, channels };
  });
  await sleep(9_000);
  for (const { name, s, seen, channels } of sockets) {
    log('error_case', { name, openMs: s.openMs, closed: s.closed, frames: s.frames, channels, nonTick: seen });
    s.ws.terminate();
  }
  // Frames after an unsubscribe: counted on a fresh socket.
  const after = { n: 0, afterUnsub: 0 };
  let unsubAt = 0;
  const s2 = open(FUT_URL, (m) => { if (m?.tick) { after.n++; if (unsubAt && Date.now() > unsubAt + 1500) after.afterUnsub++; } else log('unsub_nontick', { m }); }, {
    onOpen: async (ws) => { ws.send(sub('market_e_btcusdt_depth_step0')); await sleep(3000); ws.send(JSON.stringify({ event: 'unsub', params: { channel: 'market_e_btcusdt_depth_step0', cb_id: '1' } })); unsubAt = Date.now(); },
  });
  await sleep(8_000);
  log('unsub', { framesTotal: after.n, framesLaterThan1500msAfterUnsub: after.afterUnsub, closed: s2.closed });
  s2.ws.terminate();
}

async function batch() {
  const all = await activeContracts();
  const perSec = new Map();
  const first = new Map();
  const count = new Map();
  const prev = new Map();
  const repeats = new Map();
  const levels = [];
  const decode = [];
  let subAt = 0;
  const s = open(FUT_URL, (m, txt, isBin, now, st) => {
    if (!m?.tick) return log('nontick', { frame: txt?.slice(0, 160) });
    const sec = Math.floor((now - subAt) / 1000);
    perSec.set(sec, (perSec.get(sec) || 0) + 1);
    if (!first.has(m.channel)) first.set(m.channel, now - subAt);
    count.set(m.channel, (count.get(m.channel) || 0) + 1);
    const key = JSON.stringify(m.tick);
    if (prev.get(m.channel) === key) repeats.set(m.channel, (repeats.get(m.channel) || 0) + 1);
    prev.set(m.channel, key);
    levels.push(Math.min(m.tick.asks.length, m.tick.buys.length));
    if (!m.tick.asks.length || !m.tick.buys.length) repeats.set('oneSided', (repeats.get('oneSided') || 0) + 1);
    decode.push(st.decodeUs[st.decodeUs.length - 1]);
  }, { onOpen: (ws) => { subAt = Date.now(); for (const c of all) ws.send(sub(channelOf(c.symbol), c.contractId ? String(c.contractId) : '1')); } });
  await sleep(40_000);
  s.ws.terminate();
  const secs = [...perSec.entries()].filter(([k]) => k >= 5 && k < 39).map(([, v]) => v);
  const never = all.filter((c) => !first.has(channelOf(c.symbol))).map((c) => c.symbol);
  const counts = [...count.values()];
  const rep = [...repeats.entries()].filter(([k]) => k !== 'oneSided').sort((a, b) => b[1] - a[1]);
  log('batch_per_contract', { framesPerContractMin: pct(counts, 0), framesPerContractP10: pct(counts, 0.1), framesPerContractP50: pct(counts, 0.5), framesPerContractMax: pct(counts, 1), contractsWithIdenticalRepeats: rep.length, topRepeats: rep.slice(0, 5), oneSidedFrames: repeats.get('oneSided') || 0, shallowerSideLevelsMin: pct(levels, 0), shallowerSideLevelsP10: pct(levels, 0.1), shallowerSideLevelsP50: pct(levels, 0.5), under20: levels.filter((l) => l < 20).length, quietest: [...count.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5) });
  log('batch', { contracts: all.length, openMs: s.openMs, frames: s.frames, closed: s.closed, delivered: first.size, never: never.slice(0, 30), neverCount: never.length, firstFrameMsP50: pct([...first.values()], 0.5), firstFrameMsMax: pct([...first.values()], 1), framesPerSecP50: pct(secs, 0.5), framesPerSecMax: pct(secs, 1), rawKBps: Math.round(s.rawBytes / 40 / 1024), jsonKBps: Math.round(s.bytes / 40 / 1024), rawBytesPerFrame: Math.round(s.rawBytes / s.frames), jsonBytesPerFrame: Math.round(s.bytes / s.frames), gunzipParseUsP50: pct(decode, 0.5), gunzipParseUsP99: pct(decode, 0.99) });
}

async function silence() {
  const variants = {
    'sub, sends nothing': { sub: true, answer: false, every: 0 },
    'sub, sends {"pong":ts} every 20 s': { sub: true, answer: false, every: 20_000 },
    'no sub, sends nothing': { sub: false, answer: false, every: 0 },
  };
  const socks = Object.entries(variants).map(([name, v]) => {
    const pings = [];
    const s = open(FUT_URL, (m, txt, isBin, now, st) => {
      if (m && 'ping' in m) {
        pings.push({ atMs: now - st.t0, value: m.ping, bin: isBin });
        if (v.answer) st.ws.send(JSON.stringify({ pong: m.ping }));
      } else if (m && !m.tick) log('silence_other', { name, frame: txt?.slice(0, 160) });
    }, {
      onOpen: (ws) => {
        if (v.sub) ws.send(sub('market_e_btcusdt_ticker'));
        if (v.every) { const t = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ pong: Date.now() })), v.every); t.unref(); }
      },
    });
    return { name, s, pings };
  });
  const end = Date.now() + 75_000;
  while (Date.now() < end && socks.some((x) => x.s.closed === null)) await sleep(500);
  for (const { name, s, pings } of socks) {
    log('silence', { name, openMs: s.openMs, closed: s.closed, frames: s.frames, protocolPings: s.pings, appPings: pings.length, firstPings: pings.slice(0, 4), pingGapsMs: pings.slice(1).map((p, i) => p.atMs - pings[i].atMs).slice(0, 12) });
    s.ws.terminate();
  }
}

async function deflate() {
  const s = open(FUT_URL, () => {}, { deflate: true, onOpen: (ws) => ws.send(sub('market_e_btcusdt_ticker')) });
  await sleep(3_000);
  log('deflate', { openMs: s.openMs, extensions: s.headers?.['sec-websocket-extensions'] ?? null, frames: s.frames, bin: s.bin, text: s.text, closed: s.closed });
  s.ws.terminate();
  const p = open(FUT_URL, () => {}, { onOpen: (ws) => ws.send(sub('market_e_btcusdt_ticker')) });
  await sleep(2_000);
  const h = p.headers ?? {};
  log('upgrade_headers', { server: h.server, setCookie: (h['set-cookie'] ?? []).map((c) => c.split('=')[0]), xCdn: h['x-cdn'] ?? null, xIid: h['x-iinfo'] ? 'present' : null });
  p.ws.terminate();
}

async function spot() {
  const seen = [];
  const s = open(SPOT_URL, (m, txt, isBin) => { if (seen.length < 4) seen.push(`${isBin ? 'bin' : 'text'} ${txt?.slice(0, 220)}`); }, {
    onOpen: (ws) => ws.send(JSON.stringify({ event: 'sub', params: { channel: 'market_btcusdt_depth_step', cb_id: '1' } })),
  });
  await sleep(8_000);
  log('spot', { url: SPOT_URL, openMs: s.openMs, frames: s.frames, bin: s.bin, text: s.text, closed: s.closed, error: s.error ?? null, first: seen });
  s.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, deflate, spot };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(2); }
await modes[mode]();
process.exit(0);
