// Upbit public WebSocket probe: the orderbook stream, its frame cadence and level order, REST agreement, all pairs on one socket, errors, keepalive and silence.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, and send no Origin header.
// Stays inside the documented 5 connections a second per IP and 5 messages a second, 100 a minute, per connection.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/upbit/ws-probe.mjs [book|batch|errors|silence|deflate]
//   book     orderbook on seven pairs plus ticker and trade on KRW-BTC for 30 s, two REST reads compared frame by frame, then SIMPLE format, the .15, .5 and unsupported .2 unit suffixes and level on a second socket for 8 s. About 45 s.
//   batch    orderbook on every listed pair in one subscribe frame on one socket for 30 s: frame rate, bytes, parse time, snapshot coverage, per pair silence. About 35 s.
//   errors   one socket per case: text PING, unknown and lower case codes, missing fields, bad JSON, an unsupported unit. Then a second subscribe, a protocol ping and a text PING on one socket. About 50 s.
//   silence  three sockets for up to 70 s: one sends and subscribes nothing, one sends one text PING and nothing else, one subscribes a quiet pair snapshot only. About 75 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates. About 3 s.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/upbit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api.upbit.com/websocket/v1';
const API = 'https://api.upbit.com/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(label, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  const s = { ws, label, t0, openMs: null, closed: null, pings: 0, pongs: 0, frames: [], binary: 0, text: 0, upgradeHeaders: null };
  ws.on('upgrade', (res) => { s.upgradeHeaders = res.headers; });
  ws.on('open', () => { s.openMs = Math.round(performance.now() - t0); });
  ws.on('ping', () => { s.pings++; });
  ws.on('pong', () => { s.pongs++; s.lastPongAt = performance.now(); });
  ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString(), atS: +((performance.now() - t0) / 1000).toFixed(2) }; });
  ws.on('error', (e) => { s.error = e.message; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) s.binary++; else s.text++;
    const at = performance.now();
    const raw = data.toString('utf8');
    s.frames.push({ at, wall: Date.now(), raw, bytes: data.length });
    if (opts.onFrame) opts.onFrame(raw, at, s);
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(s));
    ws.once('error', reject);
  });
}

const send = (s, obj) => s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
const sub = (items, format = 'DEFAULT') => [{ ticket: randomUUID() }, ...items, { format }];
// REST and the socket order the keys of a unit differently, so levels are compared as tuples.
const levels = (units) => JSON.stringify(units.map((u) => [u.ask_price, u.ask_size, u.bid_price, u.bid_size]));

async function getJson(path) {
  const sent = Date.now();
  const res = await fetch(API + path);
  return { json: await res.json(), sent, received: Date.now() };
}

async function pickPairs() {
  const krw = (await getJson('/ticker/all?quote_currencies=KRW')).json;
  await sleep(300);
  const btc = (await getJson('/ticker/all?quote_currencies=BTC')).json;
  const byTurnover = (a) => [...a].sort((x, y) => x.acc_trade_price_24h - y.acc_trade_price_24h);
  return { quietKrw: byTurnover(krw)[0].market, thinBtc: byTurnover(btc)[0].market };
}

function bookStats(frames) {
  const per = new Map();
  for (const f of frames) {
    let m;
    try { m = JSON.parse(f.raw); } catch { continue; }
    if (m.type !== 'orderbook') continue;
    let p = per.get(m.code);
    if (!p) { p = { n: 0, snap: 0, rt: 0, units: {}, levels: new Set(), gaps: [], lags: [], last: null, tsBack: 0, repeats: 0, askOrder: 0, bidOrder: 0, zeroSlots: 0, bytes: [], firstStreamType: m.stream_type, byTs: new Map() }; per.set(m.code, p); }
    p.n++;
    if (m.stream_type === 'SNAPSHOT') p.snap++; else p.rt++;
    const u = m.orderbook_units;
    p.units[u.length] = (p.units[u.length] ?? 0) + 1;
    p.levels.add(m.level);
    p.lags.push(f.wall - m.timestamp);
    p.mod100 ??= {};
    p.mod100[m.timestamp % 100] = (p.mod100[m.timestamp % 100] ?? 0) + 1;
    p.bytes.push(f.bytes);
    if (u.some((v, i) => i > 0 && v.ask_price > 0 && u[i - 1].ask_price > 0 && v.ask_price <= u[i - 1].ask_price)) p.askOrder++;
    if (u.some((v, i) => i > 0 && v.bid_price > 0 && u[i - 1].bid_price > 0 && v.bid_price >= u[i - 1].bid_price)) p.bidOrder++;
    if (u.some((v) => v.ask_size === 0 || v.bid_size === 0)) p.zeroSlots++;
    if (p.last) {
      p.gaps.push(f.at - p.last.at);
      if (m.timestamp < p.last.ts) p.tsBack++;
      if (levels(u) === p.last.units) p.repeats++;
    }
    p.last = { at: f.at, ts: m.timestamp, units: levels(u) };
    p.byTs.set(m.timestamp, levels(u));
    if (!p.zeroSample && u.some((v) => v.bid_size === 0 || v.ask_size === 0)) p.zeroSample = u.filter((v) => v.bid_size === 0 || v.ask_size === 0).slice(0, 2);
  }
  return per;
}

function summarize(per) {
  const out = {};
  for (const [code, p] of per) {
    out[code] = {
      frames: p.n, snapshot: p.snap, realtime: p.rt, first: p.firstStreamType, units: p.units, levels: [...p.levels],
      gapMs: { min: p.gaps.length ? Math.round(Math.min(...p.gaps)) : null, median: Math.round(median(p.gaps) ?? 0), max: p.gaps.length ? Math.round(Math.max(...p.gaps)) : null },
      lagMs: { min: Math.min(...p.lags), median: median(p.lags), max: Math.max(...p.lags) },
      timestampMod100: p.mod100, tsBackwards: p.tsBack, identicalRepeats: p.repeats, askOrderBreaks: p.askOrder, bidOrderBreaks: p.bidOrder, framesWithZeroSlot: p.zeroSlots, zeroSlotSample: p.zeroSample ?? null, medianBytes: median(p.bytes),
    };
  }
  return out;
}

async function book() {
  const { quietKrw, thinBtc } = await pickPairs();
  const codes = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', quietKrw, 'BTC-ETH', 'USDT-BTC', thinBtc];
  log('pairs', { codes });
  const s = await open('book');
  log('open', { ms: s.openMs });
  const frame = sub([{ type: 'orderbook', codes }, { type: 'ticker', codes: ['KRW-BTC'] }, { type: 'trade', codes: ['KRW-BTC'] }]);
  const sentAt = performance.now();
  send(s, frame);
  capture('book_subscribe.json', JSON.stringify(frame));
  const rest = [];
  for (const at of [10_000, 20_000]) {
    await sleep(at - (performance.now() - sentAt));
    const r = await getJson('/orderbook?markets=KRW-BTC,KRW-XRP,' + quietKrw);
    rest.push(r);
  }
  await sleep(30_000 - (performance.now() - sentAt));
  s.ws.terminate();

  const firstByCode = {};
  for (const f of s.frames) {
    const m = JSON.parse(f.raw);
    const key = `${m.type}:${m.code}`;
    if (!firstByCode[key]) firstByCode[key] = { ms: Math.round(f.at - sentAt), stream_type: m.stream_type };
  }
  const types = {};
  for (const f of s.frames) { const m = JSON.parse(f.raw); types[m.type] = (types[m.type] ?? 0) + 1; }
  log('book_frames', { total: s.frames.length, binary: s.binary, text: s.text, types, pings: s.pings, firstByCode });
  const per = bookStats(s.frames);
  log('book_stats', summarize(per));

  for (const [i, r] of rest.entries()) {
    for (const x of r.json) {
      const p = per.get(x.market);
      const wsAtTs = p?.byTs.get(x.timestamp);
      const wsTs = p ? [...p.byTs.keys()] : [];
      const newestWsBeforeRead = wsTs.filter((t) => t <= r.received).pop();
      log('rest_vs_ws', { read: i, market: x.market, restTs: x.timestamp, restLagMs: r.received - x.timestamp, wsHasSameTs: wsAtTs !== undefined, sameUnits: wsAtTs === levels(x.orderbook_units), newestWsTsBeforeRead: newestWsBeforeRead, restBehindWsMs: newestWsBeforeRead ? newestWsBeforeRead - x.timestamp : null });
    }
  }

  const tick = s.frames.map((f) => JSON.parse(f.raw)).find((m) => m.type === 'ticker');
  const trade = s.frames.map((f) => JSON.parse(f.raw)).find((m) => m.type === 'trade');
  const ob = s.frames.find((f) => f.raw.includes('"KRW-BTC"') && f.raw.includes('orderbook'));
  const obRt = s.frames.find((f) => f.raw.includes('"KRW-BTC"') && f.raw.includes('orderbook') && f.raw.includes('REALTIME'));
  capture('book_frames.jsonl', ob?.raw ?? '');
  capture('book_frames.jsonl', obRt?.raw ?? '');
  // The wire spelling of numbers is lost by JSON.parse, so the head of each raw frame is printed as it arrived.
  log('raw_heads', { snapshot: ob?.raw.slice(0, 330), realtime: obRt?.raw.slice(0, 330) });
  log('ticker_keys', { keys: tick ? Object.keys(tick) : null, market_state: tick?.market_state, stream_type: tick?.stream_type });
  log('trade_keys', { keys: trade ? Object.keys(trade) : null });
  const obm = ob ? JSON.parse(ob.raw) : null;
  log('orderbook_sample', obm ? { keys: Object.keys(obm), units: obm.orderbook_units.length, first2: obm.orderbook_units.slice(0, 2), stream_type: obm.stream_type, level: obm.level } : {});

  await sleep(500);
  const v = await open('variants');
  send(v, [{ ticket: randomUUID() }, { type: 'orderbook', codes: ['KRW-BTC.15', 'KRW-ETH.5', 'USDT-ETH.2'] }, { type: 'orderbook', codes: ['KRW-XRP'], level: 10 }, { type: 'orderbook', codes: ['USDT-BTC'], is_only_snapshot: true }, { format: 'SIMPLE' }]);
  await sleep(8_000);
  v.ws.terminate();
  const vs = {};
  for (const f of v.frames) {
    const m = JSON.parse(f.raw);
    const k = m.cd ?? m.code;
    vs[k] ??= { n: 0, units: new Set(), lv: new Set(), st: new Set(), keys: Object.keys(m) };
    vs[k].n++;
    vs[k].units.add((m.obu ?? m.orderbook_units)?.length);
    vs[k].lv.add(m.lv ?? m.level);
    vs[k].st.add(m.st ?? m.stream_type);
  }
  for (const k of Object.keys(vs)) vs[k] = { ...vs[k], units: [...vs[k].units], lv: [...vs[k].lv], st: [...vs[k].st] };
  log('variants', { frames: v.frames.length, byCode: vs });
  capture('variants.jsonl', v.frames.slice(0, 3).map((f) => f.raw).join('\n'));
}

async function batch() {
  const all = (await getJson('/market/all')).json.map((m) => m.market);
  const s = await open('batch');
  let parseNs = 0n;
  let parsed = 0;
  const lastAt = new Map();
  const maxGap = new Map();
  const snapCodes = new Set();
  const perSec = new Map();
  let bytes = 0;
  const t0 = performance.now();
  s.ws.removeAllListeners('message');
  s.ws.on('message', (data) => {
    const at = performance.now();
    bytes += data.length;
    const a = process.hrtime.bigint();
    const m = JSON.parse(data.toString('utf8'));
    parseNs += process.hrtime.bigint() - a;
    parsed++;
    const sec = Math.floor((at - t0) / 1000);
    perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
    if (m.stream_type === 'SNAPSHOT') snapCodes.add(m.code);
    const prev = lastAt.get(m.code);
    if (prev !== undefined) maxGap.set(m.code, Math.max(maxGap.get(m.code) ?? 0, at - prev));
    lastAt.set(m.code, at);
    if (parsed === 1) capture('batch_first.json', data.toString('utf8'));
  });
  const frame = sub([{ type: 'orderbook', codes: all }]);
  log('batch_subscribe', { codes: all.length, frameBytes: JSON.stringify(frame).length });
  send(s, frame);
  await sleep(30_000);
  const end = performance.now();
  s.ws.terminate();
  const secs = [...perSec.entries()].filter(([k]) => k >= 2).map(([, v]) => v);
  const gaps = [...maxGap.values()];
  const silentWhole = all.filter((c) => !lastAt.has(c));
  const endGap = all.filter((c) => lastAt.has(c)).map((c) => end - lastAt.get(c));
  log('batch', {
    frames: parsed, seconds: +((end - t0) / 1000).toFixed(1), perSecond: { median: median(secs), max: Math.max(...secs), min: Math.min(...secs) },
    bytesPerSecond: Math.round(bytes / ((end - t0) / 1000)), bytesPerFrame: Math.round(bytes / parsed), parseUsPerFrame: +(Number(parseNs / BigInt(parsed)) / 1000).toFixed(1),
    codesWithSnapshot: snapCodes.size, codesWithAnyFrame: lastAt.size, codesSilentWholeRun: silentWhole.length,
    maxGapBetweenFramesMs: { p50: Math.round(median(gaps)), p90: Math.round(pct(gaps, 0.9)), max: Math.round(Math.max(...gaps)) },
    codesWithOnlyOneFrame: all.filter((c) => lastAt.has(c) && !maxGap.has(c)).length,
    silenceAtEndMs: { p50: Math.round(median(endGap)), p90: Math.round(pct(endGap, 0.9)), max: Math.round(Math.max(...endGap)) },
    closed: s.closed, error: s.error ?? null, pings: s.pings,
  });
}

async function errors() {
  // An error reply closes the socket, so every case gets a socket of its own, opened at most twice a second.
  const cases = [
    ['text PING', 'PING', 2_000],
    ['unknown code', sub([{ type: 'orderbook', codes: ['KRW-NOPE'] }]), 2_000],
    ['unknown and known code', sub([{ type: 'orderbook', codes: ['KRW-NOPE', 'KRW-BTC'] }]), 2_000],
    ['lower case code', sub([{ type: 'orderbook', codes: ['krw-btc'] }]), 2_000],
    ['missing ticket', [{ type: 'orderbook', codes: ['KRW-BTC'] }, { format: 'DEFAULT' }], 2_000],
    ['missing type', [{ ticket: randomUUID() }, { codes: ['KRW-BTC'] }, { format: 'DEFAULT' }], 2_000],
    ['missing codes', [{ ticket: randomUUID() }, { type: 'orderbook' }, { format: 'DEFAULT' }], 2_000],
    ['missing format', [{ ticket: randomUUID() }, { type: 'orderbook', codes: ['KRW-BTC'], is_only_snapshot: true }], 2_000],
    ['unknown type', sub([{ type: 'nope', codes: ['KRW-BTC'] }]), 2_000],
    ['not json', 'hello', 2_000],
    ['json object not array', { ticket: 'x', type: 'orderbook', codes: ['KRW-BTC'] }, 2_000],
    ['unit 20', sub([{ type: 'orderbook', codes: ['KRW-ETH.20'], is_only_snapshot: true }]), 2_000],
    ['level on BTC market', sub([{ type: 'orderbook', codes: ['BTC-ETH'], level: 100 }]), 2_000],
  ];
  for (const [label, msg, holdMs] of cases) {
    const s = await open(label);
    const sentAt = performance.now();
    send(s, msg);
    await sleep(holdMs);
    s.ws.terminate();
    const kinds = {};
    const samples = [];
    for (const f of s.frames) {
      let m = null;
      try { m = JSON.parse(f.raw); } catch { /* raw text */ }
      const k = m?.type ? `${m.type}:${m.code}:${m.orderbook_units?.length ?? ''}:${m.stream_type}` : m?.error ? `error:${m.error.name}` : m?.status ? `status:${m.status}` : 'other';
      kinds[k] = (kinds[k] ?? 0) + 1;
      if (!m?.type && samples.length < 2) samples.push({ ms: Math.round(f.at - sentAt), raw: f.raw.slice(0, 200) });
    }
    log('case', { case: label, frames: s.frames.length, kinds, samples, closed: s.closed ? { ...s.closed, afterSendMs: Math.round(s.t0 + s.closed.atS * 1000 - sentAt) } : null, binary: s.binary, text: s.text });
    await sleep(600);
  }

  const r = await open('replace');
  send(r, sub([{ type: 'orderbook', codes: ['KRW-BTC'] }]));
  await sleep(3_000);
  const cut = r.frames.length;
  send(r, sub([{ type: 'orderbook', codes: ['KRW-ETH'] }]));
  await sleep(4_000);
  const after = {};
  for (const f of r.frames.slice(cut)) { const m = JSON.parse(f.raw); after[`${m.code}:${m.stream_type}`] = (after[`${m.code}:${m.stream_type}`] ?? 0) + 1; }
  const before = {};
  for (const f of r.frames.slice(0, cut)) { const m = JSON.parse(f.raw); before[m.code] = (before[m.code] ?? 0) + 1; }
  const pingAt = performance.now();
  r.ws.ping();
  await sleep(1_500);
  const textPingAt = performance.now();
  const cut2 = r.frames.length;
  send(r, 'PING');
  await sleep(2_500);
  const status = r.frames.slice(cut2).filter((f) => f.raw.includes('status')).map((f) => ({ ms: Math.round(f.at - textPingAt), raw: f.raw }));
  log('replace', { before, afterSecondSubscribe: after, protocolPongMs: r.lastPongAt ? Math.round(r.lastPongAt - pingAt) : null, textPingOnSubscribedSocket: status, closed: r.closed });
  r.ws.terminate();
}

async function silence() {
  const krw = (await getJson('/ticker/all?quote_currencies=KRW')).json;
  const quiet = [...krw].sort((x, y) => x.acc_trade_price_24h - y.acc_trade_price_24h)[0].market;
  const idle = await open('idle');
  await sleep(400);
  const pinged = await open('text-ping-once');
  send(pinged, 'PING');
  await sleep(400);
  const snap = await open(`snapshot-only ${quiet}`);
  send(snap, sub([{ type: 'orderbook', codes: [quiet], is_only_snapshot: true }]));
  const start = performance.now();
  const all = [idle, pinged, snap];
  while (performance.now() - start < 70_000 && !all.every((s) => s.closed)) await sleep(1_000);
  for (const s of all) {
    const times = s.frames.map((f) => +((f.at - s.t0) / 1000).toFixed(1));
    log('silence', { socket: s.label, closed: s.closed ?? `open at ${((performance.now() - s.t0) / 1000).toFixed(1)} s`, serverPings: s.pings, frames: s.frames.length, frameTimesS: times.slice(0, 20), firstFrame: s.frames[0]?.raw.slice(0, 80) ?? null });
    s.ws.terminate();
  }
}

async function deflate() {
  const s = await open('deflate', { deflate: true });
  log('deflate', { openMs: s.openMs, extensions: s.upgradeHeaders?.['sec-websocket-extensions'] ?? null, negotiated: s.ws.extensions || null, server: s.upgradeHeaders?.server ?? null });
  s.ws.terminate();
  await sleep(300);
  const p = await open('plain');
  log('plain', { openMs: p.openMs, extensions: p.upgradeHeaders?.['sec-websocket-extensions'] ?? null, headers: p.upgradeHeaders });
  p.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, errors, silence, deflate };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
log('mode', { mode, at: new Date().toISOString() });
await modes[mode]();
process.exit(0);
