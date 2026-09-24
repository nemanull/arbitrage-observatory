// Buda realtime WebSocket probe: the Nchan book and trades channels, delta semantics against the REST book, book-sync snapshots, errors, keepalive, silence, deflate and Nchan message ids.
// Public, unauthenticated, read-only. It never sends a text frame, because an Nchan location that also publishes would forward it to the channel.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/buda/ws-probe.mjs [book [seconds]|errors|silence [seconds]|deflate|meta]
//   book     every book and trades channel on one socket, books seeded from REST and checked against REST and book-sync. Default 60 s, and 200 s or more catches a book-sync.
//   errors   one 2.5 s socket per malformed or unknown channel URL, and a client protocol ping. About 28 s.
//   silence  [seconds] a quiet channel with automatic pong and one without, default 60 s.
//   deflate  offers permessage-deflate and prints what the server negotiates. About 3 s.
//   meta     the ws+meta.nchan subprotocol: ids on one channel for 12 s, a resume with last_event_id, buffer depth, ids and a resume on three channels. About 40 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/buda/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const API = 'https://www.buda.com/api/v2';
const WS = 'wss://realtime.buda.com/sub';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const chan = (kind, name) => `${kind}%40${name.replace('-', '')}`;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function pct(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function getJson(path) {
  const res = await fetch(API + path);
  return { status: res.status, json: await res.json() };
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, opts.protocol, { perMessageDeflate: opts.deflate ?? false, autoPong: opts.autoPong ?? true, headers: opts.headers });
  const info = { url, t0, openMs: null, upgrade: null, refused: null, pings: [], closed: null, error: null };
  ws.on('upgrade', (res) => {
    info.upgrade = { status: res.statusCode, extensions: res.headers['sec-websocket-extensions'] ?? null, protocol: res.headers['sec-websocket-protocol'] ?? null, cfRay: res.headers['cf-ray'] };
  });
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
      info.refused = { status: res.statusCode, contentType: res.headers['content-type'], body: body.slice(0, 200) };
    });
  });
  ws.on('open', () => (info.openMs = Date.now() - t0));
  ws.on('ping', () => info.pings.push(Date.now() - t0));
  ws.on('close', (code, reason) => (info.closed = { code, reason: reason.toString(), atMs: Date.now() - t0 }));
  ws.on('error', (e) => (info.error = e.message));
  return { ws, info };
}

// Book kept as price number to size number, increments applied as the documentation describes.
function makeBook(snapshot) {
  const book = { bids: new Map(), asks: new Map() };
  for (const [p, s] of snapshot.bids) book.bids.set(Number(p), Number(s));
  for (const [p, s] of snapshot.asks) book.asks.set(Number(p), Number(s));
  return book;
}

function top(book, side, n) {
  const levels = [...book[side].entries()].filter(([, s]) => s > 1e-12);
  levels.sort((a, b) => (side === 'bids' ? b[0] - a[0] : a[0] - b[0]));
  return levels.slice(0, n);
}

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

// Matches each of the reference's top n levels by price and size, so one inserted level does not shift every comparison.
// Also checks the whole book, level by level, and names up to three differing levels.
function compare(book, snapshot, n, recent) {
  const ref = makeBook(snapshot);
  const out = {};
  const diffs = [];
  for (const side of ['bids', 'asks']) {
    const theirs = top(ref, side, n);
    let match = 0;
    for (const [p, sz] of theirs) if (near(book[side].get(p) ?? 0, sz)) match++;
    out[side] = `${match}/${theirs.length}`;
    const prices = new Set([...book[side].keys(), ...ref[side].keys()]);
    for (const p of prices) {
      const a = book[side].get(p) ?? 0;
      const b = ref[side].get(p) ?? 0;
      if (Math.abs(a) <= 1e-12 && Math.abs(b) <= 1e-12) continue;
      if (!near(a, b)) {
        const d = { side, price: p, mine: a, theirs: b };
        if (recent) d.recentAtPrice = recent.filter((x) => x.side === side && x.price === p).map((x) => [x.agoMs, x.delta]);
        diffs.push(d);
      }
    }
  }
  out.allLevelsDiffer = diffs.length;
  if (diffs.length) out.diffs = diffs.slice(0, 3);
  return out;
}

async function bookMode(seconds) {
  const { json } = await getJson('/markets');
  const markets = json.markets.map((m) => m.name);
  const channels = [...markets.map((n) => chan('book', n)), ...markets.map((n) => chan('trades', n))];
  const url = `${WS}?channel=${channels.join(',')}`;
  log('plan', { markets: markets.length, channels: channels.length, urlLength: url.length });

  // The ws+meta.nchan subprotocol prefixes each frame with an Nchan id, which gives a per channel chain to check.
  const { ws, info } = open(url, { protocol: 'ws+meta.nchan' });
  const chains = channels.map(() => ({ last: null, n: 0, breaks: 0 }));
  let noId = 0;
  const state = new Map(markets.map((n) => [n.toUpperCase(), { book: null, frames: 0, trades: 0, preSeed: 0, applied: 0, negative: 0, negOnMissing: 0, lastTs: 0, tsBack: 0, lastAt: 0, maxGapMs: 0, syncs: [], recent: [], negativeAfterSync: 0, olderThanSync: 0, syncTs: 0 }]));
  const lat = [];
  const perSecond = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  let nonJson = 0;
  let firstFrames = 0;
  const evCounts = {};
  const sameTs = new Map();

  ws.on('message', (data) => {
    const now = Date.now();
    const raw = data.toString();
    frames++;
    let text = raw;
    const cut = raw.indexOf('\n\n');
    const idLine = raw.startsWith('id:') && cut > 0 ? /^id: ?([^\n]*)/.exec(raw)[1] : null;
    if (idLine) {
      text = raw.slice(cut + 2);
      // Multiplexed id: <seconds>:<tag per channel>, the delivering channel's tag in brackets.
      const [secPart, tagPart] = idLine.split(':');
      const tags = tagPart.split(',');
      const i = tags.findIndex((x) => x.startsWith('['));
      if (i >= 0) {
        const c = chains[i];
        const cur = [Number(secPart), Number(tags[i].slice(1, -1))];
        if (c.last && !((cur[0] === c.last[0] && cur[1] === c.last[1] + 1) || (cur[0] > c.last[0] && cur[1] === 0))) c.breaks++;
        c.last = cur;
        c.n++;
      }
    } else {
      noId++;
    }
    bytes += text.length;
    const sec = Math.floor((now - info.t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const t = process.hrtime.bigint();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      nonJson++;
      return;
    }
    parseNs += process.hrtime.bigint() - t;
    if (firstFrames < 40) {
      capture('book-first.jsonl', `${now - info.t0} ${raw.slice(0, 400).replace(/\n/g, ' | ')}`);
      firstFrames++;
    }
    const key = `${msg.ev} keys=${Object.keys(msg).join(',')}`;
    evCounts[key] = (evCounts[key] ?? 0) + 1;
    const mk = msg.mk;
    const st = state.get(mk);
    if (!st) return;
    const ts = Number(msg.ts);
    if (Number.isFinite(ts)) {
      lat.push(now - ts * 1000);
      if (ts < st.lastTs) st.tsBack++;
      st.lastTs = Math.max(st.lastTs, ts);
      sameTs.set(`${mk} ${msg.ts}`, (sameTs.get(`${mk} ${msg.ts}`) ?? 0) + 1);
    }
    if (st.lastAt) st.maxGapMs = Math.max(st.maxGapMs, now - st.lastAt);
    st.lastAt = now;

    if (msg.ev === 'trade-created') {
      st.trades++;
      if (st.trades === 1) capture('trade.jsonl', text.slice(0, 400));
      return;
    }
    st.frames++;
    if (msg.ev === 'book-sync') {
      const ob = msg.order_book;
      capture('book-sync.jsonl', text.slice(0, 1500));
      const rec = { atMs: now - info.t0, ts: msg.ts, keys: Object.keys(ob ?? {}), bids: ob?.bids?.length, asks: ob?.asks?.length };
      if (ob?.bids && ob?.asks) {
        let bidBad = 0;
        let askBad = 0;
        for (let i = 1; i < ob.bids.length; i++) if (Number(ob.bids[i][0]) >= Number(ob.bids[i - 1][0])) bidBad++;
        for (let i = 1; i < ob.asks.length; i++) if (Number(ob.asks[i][0]) <= Number(ob.asks[i - 1][0])) askBad++;
        rec.order = { bidsNotDescending: bidBad, asksNotAscending: askBad };
        const recent = st.recent.filter((x) => now - x.at <= 3000).map((x) => ({ ...x, agoMs: now - x.at }));
        rec.lastDeltaTsBefore = st.recent.at(-1)?.ts ?? null;
        if (st.book) rec.vsMaintained = compare(st.book, ob, 20, recent);
        st.book = makeBook(ob);
        st.syncTs = Number(msg.ts);
      }
      st.syncs.push(rec);
      return;
    }
    if (msg.ev !== 'book-changed') return;
    if (!st.book) {
      st.preSeed++;
      return;
    }
    const [side, p, d] = msg.change;
    const price = Number(p);
    const delta = Number(d);
    if (st.syncTs && Number(msg.ts) < st.syncTs) st.olderThanSync++;
    st.recent.push({ at: now, ts: Number(msg.ts), side, price, delta });
    if (st.recent.length > 300) st.recent.splice(0, 100);
    const had = st.book[side].get(price);
    if (had === undefined && delta < 0) st.negOnMissing++;
    const next = (had ?? 0) + delta;
    if (next < -1e-9) {
      st.negative++;
      if (st.syncTs) st.negativeAfterSync++;
    }
    if (Math.abs(next) <= 1e-12) st.book[side].delete(price);
    else st.book[side].set(price, next);
    st.applied++;
  });

  await new Promise((r) => ws.once('open', r));
  log('open', { openMs: info.openMs, upgrade: info.upgrade });

  // Seed every book from REST, one call per 700 ms, and apply only deltas that arrive after the reply.
  const seedMs = [];
  for (const n of markets) {
    const t0 = Date.now();
    const { json: b } = await getJson(`/markets/${n}/order_book`);
    seedMs.push(Date.now() - t0);
    state.get(n.toUpperCase()).book = makeBook(b.order_book);
    await sleep(700);
  }
  log('seeded', { restMs: [pct(seedMs, 50), Math.max(...seedMs)] });

  const endAt = info.t0 + seconds * 1000;
  while (Date.now() < endAt - 26 * 800) await sleep(500);

  const finals = {};
  for (const n of markets) {
    const { json: b } = await getJson(`/markets/${n}/order_book`);
    const st = state.get(n.toUpperCase());
    const at = Date.now();
    finals[n] = compare(st.book, b.order_book, 20, st.recent.filter((x) => at - x.at <= 3000).map((x) => ({ ...x, agoMs: at - x.at })));
    const bids = top(st.book, 'bids', 1)[0];
    const asks = top(st.book, 'asks', 1)[0];
    finals[n].crossed = bids && asks ? bids[0] >= asks[0] : null;
    await sleep(700);
  }
  ws.terminate();

  const elapsed = (Date.now() - info.t0) / 1000;
  const rates = [...perSecond.values()];
  const tsGroups = [...sameTs.values()];
  log('throughput', {
    seconds: Math.round(elapsed),
    frames,
    perSecondMean: Math.round((frames / elapsed) * 10) / 10,
    perSecondMedian: pct(rates, 50),
    perSecondMax: Math.max(...rates),
    bytesPerSecond: Math.round(bytes / elapsed),
    bytesPerFrame: Math.round(bytes / frames),
    parseUsPerFrame: Math.round(Number(parseNs / BigInt(Math.max(1, frames - nonJson))) / 100) / 10,
    nonJson,
  });
  log('events', evCounts);
  log('arrival_minus_ts_ms', { n: lat.length, min: Math.round(Math.min(...lat)), p50: Math.round(pct(lat, 50)), p90: Math.round(pct(lat, 90)), p99: Math.round(pct(lat, 99)), max: Math.round(Math.max(...lat)) });
  log('same_ts', { groups: tsGroups.length, multi: tsGroups.filter((x) => x > 1).length, largest: Math.max(...tsGroups) });
  log('pings', { serverPingsAtMs: info.pings, closed: info.closed });
  log('id_chains', {
    protocol: info.upgrade?.protocol,
    framesWithoutId: noId,
    channelsWithFrames: chains.filter((c) => c.n > 0).length,
    idsChecked: chains.reduce((a, c) => a + c.n, 0),
    breaks: chains.reduce((a, c) => a + c.breaks, 0),
    breaksBy: Object.fromEntries(channels.map((ch, i) => [ch, chains[i].breaks]).filter(([, b]) => b > 0)),
  });
  for (const n of markets) {
    const st = state.get(n.toUpperCase());
    log('market', {
      mk: n.toUpperCase(),
      bookFrames: st.frames,
      trades: st.trades,
      preSeed: st.preSeed,
      applied: st.applied,
      negative: st.negative,
      negativeAfterSync: st.negativeAfterSync,
      deltasOlderThanSync: st.olderThanSync,
      negOnMissing: st.negOnMissing,
      tsBack: st.tsBack,
      maxGapS: Math.round(st.maxGapMs / 100) / 10,
      syncs: st.syncs,
      final: finals[n],
    });
  }
}

async function hold(url, ms, opts) {
  const s = open(url, opts);
  const got = [];
  s.ws.on('message', (d) => got.push(d.toString().slice(0, 200)));
  await sleep(ms);
  s.ws.terminate();
  await sleep(200);
  return { ...s.info, frames: got.length, first: got[0] ?? null };
}

async function errors() {
  const variants = [
    ['unknown market', `${WS}?channel=book%40nopeclp`],
    ['dash in id', `${WS}?channel=book%40btc-clp`],
    ['upper case id', `${WS}?channel=book%40BTCCLP`],
    ['unknown channel kind', `${WS}?channel=nope%40btcclp`],
    ['raw @', `${WS}?channel=book@btcclp`],
    ['no channel param', WS],
    ['empty channel', `${WS}?channel=`],
    ['bare market', `${WS}?channel=btcclp`],
    ['wrong path', 'wss://realtime.buda.com/nope?channel=book%40btcclp'],
  ];
  for (const [name, url] of variants) {
    const r = await hold(url, 2500);
    log('variant', { name, url: url.replace(WS, ''), openMs: r.openMs, upgrade: r.upgrade?.status ?? null, refused: r.refused, frames: r.frames, first: r.first, closed: r.closed, error: r.error });
  }

  // A client protocol ping, which the engine's keepalive could send.
  const s = open(`${WS}?channel=book%40ltcpen`);
  await new Promise((r) => s.ws.once('open', r));
  const pongs = [];
  s.ws.on('pong', () => pongs.push(Date.now()));
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    s.ws.ping();
    await sleep(1000);
    if (pongs[i]) pongs[i] -= t;
  }
  s.ws.terminate();
  log('client_ping', { pongMs: pongs });
}

async function silence(seconds) {
  const url = `${WS}?channel=book%40ltcpen`;
  const a = open(url, { autoPong: true });
  const b = open(url, { autoPong: false });
  const counts = { a: 0, b: 0 };
  a.ws.on('message', () => counts.a++);
  b.ws.on('message', () => counts.b++);
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until && (!a.info.closed || !b.info.closed)) await sleep(250);
  for (const s of [a, b]) if (!s.info.closed) s.ws.terminate();
  await sleep(200);
  log('silence_autopong', { openMs: a.info.openMs, pings: a.info.pings, frames: counts.a, closed: a.info.closed });
  log('silence_no_pong', { openMs: b.info.openMs, pings: b.info.pings, frames: counts.b, closed: b.info.closed });
}

async function deflate() {
  const r = await hold(`${WS}?channel=book%40btcclp`, 3000, { deflate: true });
  log('deflate', { upgrade: r.upgrade, frames: r.frames });
}

async function meta() {
  const url = `${WS}?channel=book%40btcclp`;
  const s = open(url, { protocol: 'ws+meta.nchan' });
  const got = [];
  s.ws.on('message', (d) => got.push({ at: Date.now(), text: d.toString() }));
  await sleep(12_000);
  s.ws.terminate();
  await sleep(200);
  log('meta_upgrade', { upgrade: s.info.upgrade, refused: s.info.refused, frames: got.length });
  for (const g of got.slice(0, 3)) {
    log('meta_frame', { raw: g.text.slice(0, 300) });
    capture('meta.txt', g.text.slice(0, 600));
  }
  const ids = got.map((g) => /^id: ?([^\n]*)/m.exec(g.text)?.[1] ?? null);
  const withId = ids.filter(Boolean);
  // An Nchan id is <unix seconds>:<n>, so the next id is the same second with n + 1, or a later second with n = 0.
  let breaks = 0;
  for (let i = 1; i < withId.length; i++) {
    const [s0, n0] = withId[i - 1].split(':').map(Number);
    const [s1, n1] = withId[i].split(':').map(Number);
    if (!((s1 === s0 && n1 === n0 + 1) || (s1 > s0 && n1 === 0))) breaks++;
  }
  log('meta_ids', { withId: withId.length, chainBreaks: breaks, first: withId.slice(0, 5), last: withId.slice(-3) });
  if (withId.length < 10) return;

  // Resume from an id about halfway through, and see whether the server replays what came after it.
  const mid = Math.floor(withId.length / 2);
  const from = withId[mid];
  const r = open(`${url}&last_event_id=${encodeURIComponent(from)}`, { protocol: 'ws+meta.nchan' });
  const replay = [];
  r.ws.on('message', (d) => replay.push({ at: Date.now() - r.info.t0, id: /^id: ?([^\n]*)/m.exec(d.toString())?.[1] ?? null }));
  await sleep(5000);
  r.ws.terminate();
  const expected = withId.slice(mid + 1);
  const replayIds = replay.map((x) => x.id);
  log('meta_resume', {
    from,
    openMs: r.info.openMs,
    refused: r.info.refused,
    received: replay.length,
    firstArrivalsMs: replay.slice(0, 5).map((x) => x.at),
    firstIds: replayIds.slice(0, 5),
    missedAfterFrom: expected.length,
    replayedOfThose: expected.filter((id) => replayIds.includes(id)).length,
  });

  // How far back the buffer reaches: resume from a synthetic id minutes in the past.
  for (const back of [300, 3600]) {
    const since = `${Math.floor(Date.now() / 1000) - back}:0`;
    const d = open(`${url}&last_event_id=${encodeURIComponent(since)}`, { protocol: 'ws+meta.nchan' });
    const early = [];
    d.ws.on('message', (m) => early.push({ at: Date.now() - d.info.t0, id: /^id: ?([^\n]*)/m.exec(m.toString())?.[1] ?? null }));
    await sleep(3000);
    d.ws.terminate();
    const burst = early.filter((x) => x.at <= d.info.openMs + 300);
    log('meta_depth', { backSeconds: back, since, received: early.length, inFirst300ms: burst.length, oldestId: burst[0]?.id ?? null, newestBurstId: burst.at(-1)?.id ?? null });
  }

  // Ids on a socket that carries three channels, then a resume of all three from one multiplexed id.
  const muxUrl = `${WS}?channel=book%40btcclp,book%40usdtclp,book%40usdcclp`;
  const m2 = open(muxUrl, { protocol: 'ws+meta.nchan' });
  const raw2 = [];
  m2.ws.on('message', (d) => raw2.push(d.toString()));
  await sleep(8_000);
  m2.ws.terminate();
  const idOf = (t) => /^id: ?([^\n]*)/.exec(t)?.[1] ?? null;
  const mkOf = (t) => /"mk":"([^"]+)"/.exec(t)?.[1] ?? '';
  const byMk = {};
  for (const t of raw2) byMk[mkOf(t)] = (byMk[mkOf(t)] ?? 0) + 1;
  log('meta_multiplex', { frames: raw2.length, byMk, samples: raw2.slice(0, 3).map((t) => `${idOf(t)} ${mkOf(t)}`), otherSamples: raw2.filter((t) => mkOf(t) !== 'BTC-CLP').slice(0, 3).map((t) => `${idOf(t)} ${mkOf(t)}`) });
  if (raw2.length < 10) return;
  const half = Math.floor(raw2.length / 2);
  const muxFrom = idOf(raw2[half]);
  const later = raw2.slice(half + 1).map((t) => `${idOf(t)} ${mkOf(t)}`);
  const r2 = open(`${muxUrl}&last_event_id=${encodeURIComponent(muxFrom)}`, { protocol: 'ws+meta.nchan' });
  const got2 = [];
  r2.ws.on('message', (d) => got2.push(`${idOf(d.toString())} ${mkOf(d.toString())}`));
  await sleep(4000);
  r2.ws.terminate();
  log('meta_multiplex_resume', { from: muxFrom, missedAfterFrom: later.length, replayedOfThose: later.filter((x) => got2.includes(x)).length, firstReplayed: got2.slice(0, 3) });
}

const mode = process.argv[2] ?? 'book';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'book') await bookMode(Number(process.argv[3] ?? 60));
else if (mode === 'errors') await errors();
else if (mode === 'silence') await silence(Number(process.argv[3] ?? 60));
else if (mode === 'deflate') await deflate();
else if (mode === 'meta') await meta();
else console.log('modes: book [seconds] | errors | silence [seconds] | deflate | meta');
log('end', { at: new Date().toISOString() });
process.exit(0);
