// EarnBIT WebSocket probe: the depth channel's snapshot and delta semantics, cadence, level count and order, a book kept from the
// frames against the REST book, the depth limit and interval variants, error replies, whether a second market on one socket
// replaces the first, the state, price and deals channels, every market on its own socket, keepalive and silence, and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/earnbit/ws-probe.mjs [book|batch|session|deflate|errors]
//   book     depth on BTC_USDT, ETH_USDT and LTC_BTC for 60 s with a REST compare, a variants socket, a channels socket. About 65 s.
//   batch    depth on every market, one socket per market, counted for 45 s after the last socket opens. About 60 s.
//   session  five sockets that differ only in what the client sends or subscribes, for up to 100 s, with the snapshot times.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 3 s.
//   errors   an unknown market, a lowercase market, a bad limit, an unknown method and a non JSON frame, raw replies printed. About 11 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/earnbit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WS = 'wss://ws.earnbit.com/';
const API = 'https://api.earnbit.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const mode = process.argv[2] ?? 'book';
let nextId = 1;
const req = (method, params) => JSON.stringify({ method, params, id: nextId++ });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 6000) + '\n');
}

const stats = (xs) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

const sorted = (levels, dir) => levels.every((l, i) => i === 0 || (dir > 0 ? Number(l[0]) > Number(levels[i - 1][0]) : Number(l[0]) < Number(levels[i - 1][0])));
const order = (levels) => (levels.length < 2 ? 'short' : sorted(levels, 1) ? 'ascending' : sorted(levels, -1) ? 'descending' : 'mixed');

function open(label, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(URL_WS, { perMessageDeflate: opts.deflate ?? false });
  ws.t0 = t0;
  ws.label = label;
  ws.on('upgrade', (res) => {
    ws.openMs = Math.round(performance.now() - t0);
    ws.cfRay = res.headers['cf-ray'];
    ws.ext = res.headers['sec-websocket-extensions'];
  });
  ws.on('error', (e) => log('socket_error', { label, error: e.message }));
  return new Promise((resolve) => ws.once('open', () => resolve(ws)));
}

// A depth tracker keeps the book the way a feed would: a true first param replaces it, a false one merges levels by price.
function depthTracker(market) {
  return {
    market,
    snapshots: [],
    deltas: 0,
    emptyDeltas: 0,
    repeats: 0,
    gaps: [],
    last: undefined,
    lastBody: undefined,
    bids: new Map(),
    asks: new Map(),
    maxBids: 0,
    maxAsks: 0,
    crossed: 0,
    deltaBidOrder: {},
    deltaAskOrder: {},
    deltaLevels: [],
    zeroUnknown: 0,
    extraKeys: new Set(),
    tops: [],
    apply(full, book, now) {
      if (this.last !== undefined) this.gaps.push(Math.round(now - this.last));
      this.last = now;
      const body = JSON.stringify(book);
      if (body === this.lastBody) this.repeats++;
      this.lastBody = body;
      for (const k of Object.keys(book)) if (k !== 'asks' && k !== 'bids') this.extraKeys.add(k);
      const bids = book.bids ?? [];
      const asks = book.asks ?? [];
      if (full) {
        // A later snapshot is checked against the book kept from the deltas before it replaces that book.
        const kept = this.snapshots.length === 0 ? null : bids.filter(([p, q]) => this.bids.get(p) === q).length + asks.filter(([p, q]) => this.asks.get(p) === q).length;
        this.snapshots.push({ at: Math.round(now), bids: bids.length, asks: asks.length, bidOrder: order(bids), askOrder: order(asks), levelsEqualToKeptBook: kept });
        this.bids = new Map(bids.map(([p, s]) => [p, s]));
        this.asks = new Map(asks.map(([p, s]) => [p, s]));
      } else {
        this.deltas++;
        if (bids.length === 0 && asks.length === 0) this.emptyDeltas++;
        this.deltaBidOrder[order(bids)] = (this.deltaBidOrder[order(bids)] ?? 0) + 1;
        this.deltaAskOrder[order(asks)] = (this.deltaAskOrder[order(asks)] ?? 0) + 1;
        this.deltaLevels.push(bids.length + asks.length);
        for (const [side, levels] of [[this.bids, bids], [this.asks, asks]]) {
          for (const [p, s] of levels) {
            if (Number(s) === 0) {
              if (!side.has(p)) this.zeroUnknown++;
              side.delete(p);
            } else side.set(p, s);
          }
        }
      }
      this.maxBids = Math.max(this.maxBids, this.bids.size);
      this.maxAsks = Math.max(this.maxAsks, this.asks.size);
      const bb = Math.max(...[...this.bids.keys()].map(Number));
      const ba = Math.min(...[...this.asks.keys()].map(Number));
      if (this.bids.size && this.asks.size && bb >= ba) this.crossed++;
      const top = `${bb}|${ba}`;
      if (this.tops.at(-1)?.[1] !== top) this.tops.push([now, top]);
    },
    top(n) {
      const b = [...this.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0])).slice(0, n);
      const a = [...this.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, n);
      return { b, a };
    },
    summary() {
      return {
        market: this.market,
        snapshots: this.snapshots.length,
        firstSnapshot: this.snapshots[0],
        laterSnapshots: this.snapshots.slice(1),
        deltas: this.deltas,
        emptyDeltas: this.emptyDeltas,
        identicalRepeats: this.repeats,
        gapMs: stats(this.gaps),
        levelsPerDelta: stats(this.deltaLevels),
        maxBids: this.maxBids,
        maxAsks: this.maxAsks,
        endBids: this.bids.size,
        endAsks: this.asks.size,
        crossedAfterApply: this.crossed,
        deltaBidOrder: this.deltaBidOrder,
        deltaAskOrder: this.deltaAskOrder,
        zeroSizeForUnknownLevel: this.zeroUnknown,
        topChanges: this.tops.length - 1,
        extraKeys: [...this.extraKeys],
      };
    },
  };
}

async function compareRest(tr) {
  const r = await fetch(`${API}/api/v1/public/depth/result?market=${tr.market}&limit=100`);
  const j = await r.json();
  const restB = [...j.bids].reverse().slice(0, 20);
  const restA = j.asks.slice(0, 20);
  const { b, a } = tr.top(20);
  const eq = (x, y) => x.filter((l, i) => y[i] && Number(y[i][0]) === Number(l[0]) && Number(y[i][1]) === Number(l[1])).length;
  const priceIn = (x, y) => {
    const set = new Set(y.map((l) => Number(l[0])));
    return x.filter((l) => set.has(Number(l[0]))).length;
  };
  log('rest_compare', {
    market: tr.market,
    wsTop: [b[0], a[0]],
    restTop: [restB[0], restA[0]],
    sameLevelTop20: { bids: eq(b, restB), asks: eq(a, restA) },
    samePriceTop20: { bids: priceIn(b, restB), asks: priceIn(a, restA) },
  });
}

async function book() {
  const markets = ['BTC_USDT', 'ETH_USDT', 'LTC_BTC'];
  const trackers = {};
  const sockets = [];
  for (const m of markets) {
    const ws = await open(`depth_${m}`);
    const tr = depthTracker(m);
    trackers[m] = tr;
    let subAt;
    let first = true;
    ws.on('message', (d) => {
      const now = performance.now();
      const text = d.toString();
      const msg = JSON.parse(text);
      if (msg.method === 'depth.update') {
        if (first) {
          log('first_depth', { market: m, afterSubscribeMs: Math.round(now - subAt), afterCreateMs: Math.round(now - ws.t0), full: msg.params[0], bytes: text.length });
          first = false;
        }
        if (tr.snapshots.length + tr.deltas < 3) capture(`depth_${m}.jsonl`, text);
        tr.apply(msg.params[0] === true, msg.params[1], now - ws.t0);
      } else {
        log('reply', { market: m, afterSubscribeMs: Math.round(now - subAt), text: text.slice(0, 160) });
      }
    });
    subAt = performance.now();
    ws.send(req('depth.subscribe', [m, 100, '0']));
    log('open', { label: ws.label, openMs: ws.openMs, cfRay: ws.cfRay, ext: ws.ext ?? null });
    sockets.push(ws);
  }

  // One socket walks through the limit and interval variants and the error cases, since a new depth subscribe replaces the last.
  const v = await open('variants');
  sockets.push(v);
  let current = null;
  const seen = [];
  v.on('message', (d) => {
    const text = d.toString();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      seen.push({ step: current, raw: text.slice(0, 120) });
      return;
    }
    if (msg.method === 'depth.update') {
      const [full, bk, market] = msg.params;
      const rec = seen.find((x) => x.step === current && x.market === market && x.kind === 'depth');
      if (rec) {
        rec.frames++;
        return;
      }
      const prices = [...(bk.bids ?? []), ...(bk.asks ?? [])].map((l) => l[0]);
      seen.push({ step: current, kind: 'depth', market, full, bids: bk.bids?.length ?? 0, asks: bk.asks?.length ?? 0, samplePrices: prices.slice(0, 3), frames: 1, ...(prices.length === 0 ? { raw: text.slice(0, 160) } : {}) });
    } else {
      seen.push({ step: current, kind: 'reply', text: text.slice(0, 200) });
    }
  });
  const steps = [
    ['limit 1', 'depth.subscribe', ['BTC_USDT', 1, '0']],
    ['limit 5', 'depth.subscribe', ['BTC_USDT', 5, '0']],
    ['limit 20', 'depth.subscribe', ['BTC_USDT', 20, '0']],
    ['limit 50', 'depth.subscribe', ['BTC_USDT', 50, '0']],
    ['limit 200', 'depth.subscribe', ['BTC_USDT', 200, '0']],
    ['limit 1000', 'depth.subscribe', ['BTC_USDT', 1000, '0']],
    ['interval 0.1', 'depth.subscribe', ['BTC_USDT', 20, '0.1']],
    ['interval 1', 'depth.subscribe', ['BTC_USDT', 20, '1']],
    ['interval 10', 'depth.subscribe', ['BTC_USDT', 20, '10']],
    ['second market', 'depth.subscribe', ['ETH_USDT', 20, '0']],
    ['unknown market', 'depth.subscribe', ['NOPE_USDT', 20, '0']],
    ['lowercase', 'depth.subscribe', ['btc_usdt', 20, '0']],
    ['limit 0', 'depth.subscribe', ['BTC_USDT', 0, '0']],
    ['limit text', 'depth.subscribe', ['BTC_USDT', 'abc', '0']],
    ['interval text', 'depth.subscribe', ['BTC_USDT', 20, 'abc']],
    ['no params', 'depth.subscribe', []],
    ['unknown method', 'nope.method', []],
    ['depth.query', 'depth.query', ['BTC_USDT', 5, '0']],
    ['unsubscribe', 'depth.unsubscribe', []],
    ['not json', null, null],
    ['ping after not json', 'server.ping', []],
    ['server.time', 'server.time', []],
  ];

  // The channels socket takes every market in one state and one price subscribe, and deals on two markets.
  const c = await open('channels');
  sockets.push(c);
  const chan = {};
  const replies = [];
  const lastState = {};
  c.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    if (msg.method) {
      const k = `${msg.method}:${msg.method === 'deals.update' || msg.method === 'state.update' || msg.method === 'price.update' ? msg.params[0] : '?'}`;
      chan[k] = (chan[k] ?? 0) + 1;
      if (msg.method === 'state.update') lastState[msg.params[0]] = msg.params[1];
      if (chan[k] === 1 && ['BTC_USDT'].includes(msg.params[0])) capture('channels.jsonl', d.toString());
    } else replies.push(d.toString().slice(0, 140));
  });
  const all = (await (await fetch(`${API}/api/v1/public/symbols`)).json()).result;
  c.send(req('state.subscribe', all));
  c.send(req('price.subscribe', all));
  c.send(req('deals.subscribe', ['BTC_USDT', 'ETH_USDT']));

  // The REST book is read once a second beside the BTC socket, and its touch is matched to the socket's touch history.
  const restReads = [];
  const btc = trackers.BTC_USDT;
  const btcT0 = sockets[0].t0;
  let polling = true;
  const restLoop = (async () => {
    while (polling) {
      const sent = performance.now();
      try {
        const j = await (await fetch(`${API}/api/v1/public/depth/result?market=BTC_USDT&limit=5`)).json();
        const got = performance.now();
        const top = `${Number(j.bids.at(-1)[0])}|${Number(j.asks[0][0])}`;
        const now = btc.tops.at(-1)?.[1];
        const past = btc.tops.findLastIndex((t) => t[1] === top);
        restReads.push({ same: top === now, lagMs: past < 0 ? null : top === now ? 0 : Math.round(got - btcT0 - btc.tops[past + 1][0]), sentMs: Math.round(sent - btcT0) });
      } catch (e) {
        restReads.push({ error: e.message });
      }
      await sleep(1000);
    }
  })();

  const started = Date.now();
  for (const [name, method, params] of steps) {
    current = name;
    if (method === null) v.send('not json');
    else v.send(req(method, params));
    await sleep(2500);
  }
  const left = 60_000 - (Date.now() - started);
  if (left > 0) await sleep(left);

  polling = false;
  await restLoop;
  log('rest_touch_vs_socket', {
    reads: restReads.length,
    sameAsSocketNow: restReads.filter((r) => r.same).length,
    matchedAnEarlierSocketTouch: restReads.filter((r) => !r.same && r.lagMs !== null).length,
    matchedNoSocketTouch: restReads.filter((r) => r.lagMs === null).length,
    lagWhenBehindMs: stats(restReads.filter((r) => !r.same && r.lagMs !== null).map((r) => r.lagMs)),
  });
  for (const m of markets) await compareRest(trackers[m]);
  for (const m of markets) log('depth_summary', trackers[m].summary());
  for (const s of seen) log('variant', s);
  const counts = Object.entries(chan).sort();
  log('channels', { replies, frames: Object.fromEntries(counts) });

  // The socket's 24 h statistics are compared with the REST tickers call read at the same moment.
  const rest = (await (await fetch(`${API}/api/v1/public/tickers`)).json()).result;
  for (const m of ['BTC_USDT', 'ETH_USDT', 'XRP_USDT', 'SOL_USDT']) {
    const w = lastState[m];
    const r = rest[m]?.ticker;
    log('state_vs_rest_ticker', { market: m, ws: w && [w.high, w.low, w.volume, w.deal, w.open], rest: r && [r.high, r.low, r.vol, r.deal, r.open] });
  }
  for (const s of sockets) s.terminate();
}

async function batch() {
  const all = (await (await fetch(`${API}/api/v1/public/symbols`)).json()).result;
  const perMarket = {};
  const opens = [];
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const closes = [];
  const sockets = [];
  const perSecond = [];
  for (const m of all) {
    const ws = await open(`batch_${m}`);
    opens.push(ws.openMs);
    perMarket[m] = { snap: 0, delta: 0 };
    ws.on('message', (d) => {
      const t = process.hrtime.bigint();
      const msg = JSON.parse(d.toString());
      parseNs += process.hrtime.bigint() - t;
      frames++;
      bytes += d.length;
      if (msg.method === 'depth.update') {
        if (msg.params[0] === true) perMarket[m].snap++;
        else perMarket[m].delta++;
      }
    });
    ws.on('close', (code) => closes.push([m, code]));
    ws.send(req('depth.subscribe', [m, 100, '0']));
    sockets.push(ws);
  }
  log('batch_open', { sockets: sockets.length, openMs: stats(opens), framesWhileOpening: frames });

  // The counters restart once every socket is open, so the rates cover the 45 s window only.
  frames = 0;
  bytes = 0;
  parseNs = 0n;
  for (const m of all) perMarket[m] = { snap: 0, delta: 0 };
  let lastFrames = 0;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    perSecond.push(frames - lastFrames);
    lastFrames = frames;
  }
  const deltas = Object.values(perMarket).map((x) => x.delta);
  log('batch_summary', {
    seconds: 45,
    frames,
    framesPerSecond: stats(perSecond),
    bytesPerSecond: Math.round(bytes / 45),
    bytesPerFrame: Math.round(bytes / Math.max(1, frames)),
    parseMicrosPerFrame: Number(parseNs / BigInt(Math.max(1, frames))) / 1000,
    laterSnapshotsPerMarket: stats(Object.values(perMarket).map((x) => x.snap)),
    deltasPerMarket: stats(deltas),
    quietest: Object.entries(perMarket).sort((a, b) => a[1].delta - b[1].delta).slice(0, 4),
    closes,
  });
  for (const s of sockets) s.terminate();
}

async function session() {
  const cases = [
    ['A_silent_unsubscribed', false, null],
    ['B_silent_subscribed', true, null],
    ['C_subscribed_app_ping_20s', true, 'app'],
    ['D_unsubscribed_app_ping_20s', false, 'app'],
    ['E_unsubscribed_protocol_ping_20s', false, 'proto'],
  ];
  const results = {};
  const sockets = [];
  for (const [label, sub, ping] of cases) {
    const ws = await open(label);
    const r = { serverPings: 0, frames: 0, pongMs: [], closedAtMs: null, code: null };
    results[label] = r;
    let pingAt = 0;
    ws.on('ping', () => r.serverPings++);
    ws.on('pong', () => r.pongMs.push(Math.round(performance.now() - pingAt)));
    ws.on('message', (d) => {
      r.frames++;
      const msg = JSON.parse(d.toString());
      // Full snapshots after the first one arrive for every subscriber at the same instant, so their wall clock times are kept.
      if (msg.method === 'depth.update' && msg.params[0] === true) (r.snapshotsUtc ??= []).push(new Date().toISOString().slice(11, 23));
      if (msg.result === 'pong') {
        r.pongMs.push(Math.round(performance.now() - pingAt));
        if (!r.pongFrame) r.pongFrame = d.toString();
      }
    });
    ws.on('close', (code, reason) => {
      r.closedAtMs = Math.round(performance.now() - ws.t0);
      r.code = code;
      r.reason = reason.toString();
    });
    if (sub) ws.send(req('depth.subscribe', ['BTC_USDT', 20, '0']));
    if (ping) {
      const t = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        pingAt = performance.now();
        if (ping === 'app') ws.send(req('server.ping', []));
        else ws.ping();
      }, 20_000);
      t.unref();
    }
    sockets.push(ws);
  }
  for (let s = 0; s < 100; s += 5) {
    await sleep(5000);
    if (Object.values(results).every((r) => r.closedAtMs !== null)) break;
  }
  for (const [label, r] of Object.entries(results)) log('session', { label, ...r, pongMs: stats(r.pongMs) });
  for (const s of sockets) s.terminate();
}

// A short run of only the error cases, printing every raw frame, for the captures in the profile.
async function errors() {
  const ws = await open('errors');
  ws.on('message', (d) => log('frame', { text: d.toString().slice(0, 200) }));
  ws.on('close', (code) => log('close', { code }));
  const steps = [
    req('depth.subscribe', ['NOPE_USDT', 20, '0']),
    req('depth.subscribe', ['btc_usdt', 20, '0']),
    req('depth.subscribe', ['BTC_USDT', 200, '0']),
    req('nope.method', []),
    'not json',
    req('server.ping', []),
    req('server.time', []),
  ];
  for (const f of steps) {
    log('sent', { text: f });
    ws.send(f);
    await sleep(1500);
  }
  ws.terminate();
}

async function deflate() {
  const ws = await open('deflate', { deflate: true });
  log('deflate', { openMs: ws.openMs, negotiated: ws.ext ?? null, cfRay: ws.cfRay });
  ws.terminate();
}

if (mode === 'book') await book();
else if (mode === 'batch') await batch();
else if (mode === 'session') await session();
else if (mode === 'deflate') await deflate();
else if (mode === 'errors') await errors();
else console.log('modes: book | batch | session | deflate | errors');
process.exit(0);
