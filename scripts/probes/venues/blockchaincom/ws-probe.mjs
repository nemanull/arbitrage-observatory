// Blockchain.com Exchange WebSocket probe: the l2 and l3 book channels, seqnum continuity, level order, heartbeat, the Origin header, errors, compression, silence, and every open symbol on one connection.
// Public, unauthenticated, read-only: anonymous channels only, no auth channel. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks once to see what the server negotiates.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/blockchaincom/ws-probe.mjs [book|errors|origin|deflate|batch|silence]
//   book     heartbeat, l2 on five symbols, l3, ticker, trades, symbols and prices on one socket for 45 s, with a REST book compare. About 50 s.
//   errors   unknown, closed and malformed symbols, an unknown channel, bad JSON, a duplicate subscribe and an unsubscribe. About 20 s.
//   origin   opens without the documented Origin header and with a foreign one, and reports what the handshake returns. About 15 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates. About 3 s.
//   batch    l2 on every open symbol on one connection for 45 s. About 50 s.
//   silence  two sockets that never send after the handshake, one with an l2 subscription and one without, for up to 110 s.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/blockchaincom/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.blockchain.info/mercury-gateway/v1/ws';
const ORIGIN = 'https://exchange.blockchain.com';
const API = 'https://api.blockchain.com/v3/exchange';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

// Opens a socket and records every frame with its arrival time, the seqnum chain, and protocol pings.
function openSocket(label, { headers = { Origin: ORIGIN }, deflate = false } = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { headers, perMessageDeflate: deflate });
  const s = {
    label,
    ws,
    frames: [],
    gaps: [],
    lastSeq: undefined,
    pings: 0,
    pingAt: [],
    openMs: undefined,
    closed: undefined,
    upgradeHeaders: undefined,
    unexpected: undefined,
    error: undefined,
    bytes: 0,
  };
  ws.on('upgrade', (res) => {
    s.upgradeHeaders = { ext: res.headers['sec-websocket-extensions'] ?? null, cfRay: res.headers['cf-ray'] ?? null };
  });
  let refused;
  const refusedP = new Promise((r) => (refused = r));
  // With this listener registered, ws emits neither error nor close for a non-101 reply, so the probe ends the request itself.
  ws.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
      s.unexpected = { status: res.statusCode, body: body.slice(0, 200), server: res.headers.server ?? null, cfRay: res.headers['cf-ray'] ?? null };
      req.destroy();
      refused(false);
    });
  });
  ws.on('open', () => (s.openMs = Math.round(performance.now() - t0)));
  ws.on('ping', () => {
    s.pings++;
    s.pingAt.push(performance.now());
  });
  ws.on('error', (e) => (s.error = String(e.message)));
  ws.on('close', (code, reason) => {
    s.closed = { code, reason: String(reason), atS: Math.round((performance.now() - t0) / 10) / 100 };
  });
  ws.on('message', (raw, isBinary) => {
    const text = raw.toString('utf8');
    s.bytes += raw.length;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      msg = { unparsed: text.slice(0, 200), isBinary };
    }
    const at = performance.now();
    s.frames.push({ at, msg, len: raw.length });
    if (typeof msg.seqnum === 'number') {
      if (s.lastSeq !== undefined && msg.seqnum !== s.lastSeq + 1) s.gaps.push([s.lastSeq, msg.seqnum]);
      s.lastSeq = msg.seqnum;
    }
    capture(`${label}.jsonl`, text);
  });
  s.opened = Promise.race([
    refusedP,
    new Promise((resolve) => {
      ws.once('open', () => resolve(true));
      ws.once('close', () => resolve(false));
      ws.once('error', () => resolve(false));
    }),
    sleep(15_000).then(() => false),
  ]);
  return s;
}

const send = (s, obj) => s.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
const sub = (channel, extra = {}) => ({ action: 'subscribe', channel, ...extra });

function key(m) {
  return `${m.channel ?? '?'}|${m.symbol ?? ''}|${m.event ?? '?'}`;
}

function eventCounts(s) {
  const c = {};
  for (const f of s.frames) c[key(f.msg)] = (c[key(f.msg)] ?? 0) + 1;
  return c;
}

function isDesc(levels) {
  return levels.every((l, i) => i === 0 || levels[i - 1].px >= l.px);
}

function isAsc(levels) {
  return levels.every((l, i) => i === 0 || levels[i - 1].px <= l.px);
}

function trim(m) {
  const c = { ...m };
  for (const k of ['bids', 'asks']) if (Array.isArray(c[k]) && c[k].length > 3) c[k] = [...c[k].slice(0, 3), `…${c[k].length - 3} more`];
  return JSON.stringify(c).slice(0, 500);
}

function firstOf(s, pred) {
  const f = s.frames.find((x) => pred(x.msg));
  return f ? trim(f.msg) : null;
}

async function book() {
  const s = openSocket('book');
  const t0 = performance.now();
  if (!(await s.opened)) return log('book_open_failed', { unexpected: s.unexpected, error: s.error, closed: s.closed });
  log('open', { ms: s.openMs, ext: s.upgradeHeaders });
  const l2 = ['BTC-USD', 'ETH-USD', 'XRP-USDT', 'STX-USD', 'TRX-USDT'];
  send(s, sub('heartbeat'));
  for (const sym of l2) send(s, sub('l2', { symbol: sym }));
  send(s, sub('l3', { symbol: 'BTC-USD' }));
  send(s, sub('ticker', { symbol: 'BTC-USD' }));
  send(s, sub('trades', { symbol: 'BTC-USD' }));
  send(s, sub('symbols', { symbol: 'BTC-USD' }));
  send(s, sub('prices', { symbol: 'BTC-USD', granularity: 60 }));
  const sentAt = performance.now();
  await sleep(45_000);
  const restAt = new Date().toISOString();
  const rest = await fetch(`${API}/l2/BTC-USD`).then((r) => r.json());
  const kr = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD').then((r) => r.json()).catch(() => null);
  const k = kr?.result && Object.values(kr.result)[0];
  const krakenMid = k ? (Number(k.a[0]) + Number(k.b[0])) / 2 : null;
  s.ws.close();
  await sleep(300);

  log('book_counts', { frames: s.frames.length, bytes: s.bytes, events: eventCounts(s), seqFirst: s.frames[0]?.msg.seqnum, seqLast: s.lastSeq, gaps: s.gaps, pings: s.pings, closed: s.closed });

  const hb = s.frames.filter((f) => f.msg.channel === 'heartbeat' && f.msg.event === 'updated').map((f) => f.at);
  log('heartbeat', { count: hb.length, intervalsMs: hb.slice(1).map((t, i) => Math.round(t - hb[i])) });

  for (const sym of l2) {
    const mine = s.frames.filter((f) => f.msg.channel === 'l2' && f.msg.symbol === sym);
    const ack = mine.find((f) => f.msg.event === 'subscribed');
    const snaps = mine.filter((f) => f.msg.event === 'snapshot');
    const ups = mine.filter((f) => f.msg.event === 'updated');
    const snap = snaps[0]?.msg;
    const bookMap = { bids: new Map(), asks: new Map() };
    if (snap) for (const side of ['bids', 'asks']) for (const l of snap[side]) bookMap[side].set(l.px, l.qty);
    let zeroQty = 0;
    for (const u of ups) for (const side of ['bids', 'asks']) for (const l of u.msg[side] ?? []) {
      if (l.qty === 0) {
        zeroQty++;
        bookMap[side].delete(l.px);
      } else bookMap[side].set(l.px, l.qty);
    }
    const upTs = ups.map((u) => Date.parse(u.msg.timestamp)).filter(Number.isFinite);
    log('l2', {
      sym,
      ackMsAfterSend: ack ? Math.round(ack.at - sentAt) : null,
      snapshots: snaps.length,
      snapMsAfterSend: snaps[0] ? Math.round(snaps[0].at - sentAt) : null,
      snapLevels: snap ? [snap.bids.length, snap.asks.length] : null,
      snapBidsDesc: snap ? isDesc(snap.bids) : null,
      snapAsksAsc: snap ? isAsc(snap.asks) : null,
      snapHasTimestamp: snap ? 'timestamp' in snap : null,
      updates: ups.length,
      updateLevels: ups.reduce((n, u) => n + (u.msg.bids?.length ?? 0) + (u.msg.asks?.length ?? 0), 0),
      zeroQty,
      emptyUpdates: ups.filter((u) => !(u.msg.bids?.length) && !(u.msg.asks?.length)).length,
      updateAgeMs: upTs.length ? { min: Math.min(...ups.map((u) => Math.round(Date.now() - (performance.now() - u.at) - Date.parse(u.msg.timestamp)))), max: Math.max(...ups.map((u) => Math.round(Date.now() - (performance.now() - u.at) - Date.parse(u.msg.timestamp)))) } : null,
      endBook: [bookMap.bids.size, bookMap.asks.size],
    });
  }

  const wsBtc = s.frames.filter((f) => f.msg.channel === 'l2' && f.msg.symbol === 'BTC-USD' && f.msg.event !== 'subscribed');
  const bm = { bids: new Map(), asks: new Map() };
  for (const f of wsBtc) {
    if (f.msg.event === 'snapshot') {
      bm.bids.clear();
      bm.asks.clear();
    }
    for (const side of ['bids', 'asks']) for (const l of f.msg[side] ?? []) (l.qty === 0 ? bm[side].delete(l.px) : bm[side].set(l.px, l.qty));
  }
  const restMid = rest.bids?.length && rest.asks?.length ? (rest.bids[0].px + rest.asks[0].px) / 2 : null;
  const lastCandle = s.frames.filter((f) => f.msg.channel === 'prices' && f.msg.event === 'updated').pop()?.msg.price ?? null;
  const markPrice = s.frames.find((f) => f.msg.channel === 'ticker' && f.msg.mark_price !== undefined)?.msg.mark_price ?? null;
  log('reference', { restAt, restMid, lastCandle, krakenMid, markPrice, markVsKrakenPpm: markPrice && krakenMid ? Math.round(((markPrice - krakenMid) / krakenMid) * 1e6) : null });
  log('rest_compare_btc_usd', {
    wsBids: [...bm.bids.entries()],
    wsAsks: [...bm.asks.entries()],
    restBids: rest.bids.map((l) => [l.px, l.qty]),
    restAsks: rest.asks.map((l) => [l.px, l.qty]),
  });

  log('sample_ack', { frame: firstOf(s, (m) => m.event === 'subscribed' && m.channel === 'l2') });
  log('sample_snapshot', { frame: firstOf(s, (m) => m.event === 'snapshot' && m.channel === 'l2' && m.symbol === 'BTC-USD') });
  log('sample_update', { frame: firstOf(s, (m) => m.event === 'updated' && m.channel === 'l2') });
  log('sample_update_zero', { frame: firstOf(s, (m) => m.event === 'updated' && m.channel === 'l2' && [...(m.bids ?? []), ...(m.asks ?? [])].some((l) => l.qty === 0)) });
  log('sample_empty_snapshot', { frame: firstOf(s, (m) => m.event === 'snapshot' && m.channel === 'l2' && m.symbol === 'STX-USD') });
  log('sample_trx', { frames: s.frames.filter((f) => f.msg.symbol === 'TRX-USDT').slice(0, 3).map((f) => trim(f.msg)) });
  log('sample_l3', { snapshot: firstOf(s, (m) => m.channel === 'l3' && m.event === 'snapshot'), update: firstOf(s, (m) => m.channel === 'l3' && m.event === 'updated') });
  log('sample_heartbeat', { frame: firstOf(s, (m) => m.channel === 'heartbeat' && m.event === 'updated') });
  for (const ch of ['ticker', 'trades', 'symbols', 'prices']) {
    log(`sample_${ch}`, { frames: s.frames.filter((f) => f.msg.channel === ch).slice(0, 3).map((f) => trim(f.msg)) });
  }
  log('book_wall_s', { s: Math.round((performance.now() - t0) / 1000) });
}

async function errors() {
  const s = openSocket('errors');
  if (!(await s.opened)) return log('open_failed', { unexpected: s.unexpected, error: s.error });
  const cases = [
    ['unknown symbol', sub('l2', { symbol: 'NOPE-USD' })],
    ['closed symbol', sub('l2', { symbol: 'TFUEL-USDC' })],
    ['lowercase symbol', sub('l2', { symbol: 'btc-usd' })],
    ['no symbol', sub('l2')],
    ['unknown channel', sub('nope', { symbol: 'BTC-USD' })],
    ['no action', { channel: 'l2', symbol: 'BTC-USD' }],
    ['not json', 'hello'],
    ['first subscribe', sub('l2', { symbol: 'BTC-USD' })],
    ['duplicate subscribe', sub('l2', { symbol: 'BTC-USD' })],
    ['ticker unknown symbol', sub('ticker', { symbol: 'NOPE-USD' })],
  ];
  for (const [name, frame] of cases) {
    const before = s.frames.length;
    send(s, frame);
    await sleep(1200);
    log('case', { name, sent: typeof frame === 'string' ? frame : JSON.stringify(frame), replies: s.frames.slice(before).filter((f) => f.msg.channel !== 'l2' || f.msg.event !== 'updated').slice(0, 3).map((f) => trim(f.msg)), closed: s.closed ?? null });
    if (s.closed) break;
  }
  if (!s.closed) {
    const before = s.frames.length;
    send(s, { action: 'unsubscribe', channel: 'l2', symbol: 'BTC-USD' });
    await sleep(1500);
    const unsubAt = s.frames.slice(before).find((f) => f.msg.event === 'unsubscribed');
    const mark = s.frames.length;
    await sleep(8000);
    log('unsubscribe', { reply: unsubAt ? trim(unsubAt.msg) : null, repliesAfter: s.frames.slice(before, mark).map((f) => trim(f.msg)).slice(0, 3), l2FramesIn8sAfter: s.frames.slice(mark).filter((f) => f.msg.channel === 'l2').length });
  }
  log('errors_seq', { gaps: s.gaps, lastSeq: s.lastSeq });
  s.ws.close();
  await sleep(300);
}

async function origin() {
  for (const [name, headers] of [['no Origin', {}], ['foreign Origin', { Origin: 'https://example.com' }], ['documented Origin', { Origin: ORIGIN }]]) {
    const s = openSocket(`origin_${name.replace(' ', '_')}`, { headers });
    const ok = await s.opened;
    let data = 0;
    if (ok) {
      send(s, sub('l2', { symbol: 'BTC-USD' }));
      await sleep(3000);
      data = s.frames.length;
      s.ws.close();
    }
    await sleep(500);
    log('origin', { name, opened: ok, openMs: s.openMs ?? null, framesIn3s: data, first: s.frames[0] ? trim(s.frames[0].msg) : null, unexpected: s.unexpected ?? null, error: s.error ?? null, closed: s.closed ?? null });
  }
}

async function deflate() {
  const s = openSocket('deflate', { deflate: true });
  const ok = await s.opened;
  log('deflate', { opened: ok, negotiated: s.upgradeHeaders?.ext ?? null, unexpected: s.unexpected ?? null });
  if (ok) {
    send(s, sub('l2', { symbol: 'BTC-USD' }));
    await sleep(1500);
    log('deflate_frames', { frames: s.frames.length, first: s.frames[0] ? trim(s.frames[0].msg) : null });
    s.ws.close();
  }
  await sleep(300);
}

async function batch() {
  const symbols = await fetch(`${API}/symbols`).then((r) => r.json());
  const open = Object.entries(symbols).filter(([, v]) => v.status === 'open').map(([k]) => k);
  const s = openSocket('batch');
  if (!(await s.opened)) return log('open_failed', { unexpected: s.unexpected, error: s.error });
  const sentAt = performance.now();
  for (const sym of open) send(s, sub('l2', { symbol: sym }));
  await sleep(45_000);
  s.ws.close();
  await sleep(300);
  const bySym = {};
  for (const f of s.frames) {
    const m = f.msg;
    if (m.channel !== 'l2') continue;
    const e = (bySym[m.symbol] ??= { ack: 0, snap: 0, upd: 0, rej: 0, levels: null, lastSnapAt: 0 });
    if (m.event === 'subscribed') e.ack++;
    if (m.event === 'snapshot') {
      e.snap++;
      e.levels = `${m.bids.length}x${m.asks.length}`;
      e.lastSnapAt = f.at;
    }
    if (m.event === 'updated') e.upd++;
    if (m.event === 'rejected') e.rej++;
  }
  const vals = Object.values(bySym);
  const lastSnap = Math.max(...vals.map((v) => v.lastSnapAt));
  const hist = {};
  for (const v of vals) hist[v.levels ?? 'none'] = (hist[v.levels ?? 'none'] ?? 0) + 1;
  const updated = Object.entries(bySym).filter(([, v]) => v.upd > 0).map(([k, v]) => `${k} ${v.upd}`);
  log('batch', {
    symbols: open.length,
    acks: vals.reduce((n, v) => n + v.ack, 0),
    snapshots: vals.reduce((n, v) => n + v.snap, 0),
    rejects: vals.reduce((n, v) => n + v.rej, 0),
    allSnapshotsWithinMs: Math.round(lastSnap - sentAt),
    snapshotLevels: hist,
    updatesTotal: vals.reduce((n, v) => n + v.upd, 0),
    symbolsWithUpdates: updated,
    frames: s.frames.length,
    framesPerSecond: Math.round((s.frames.length / 45) * 10) / 10,
    bytes: s.bytes,
    gaps: s.gaps,
    otherEvents: [...new Set(s.frames.filter((f) => f.msg.channel !== 'l2').map((f) => key(f.msg)))],
    closed: s.closed,
    pings: s.pings,
  });
}

async function silence() {
  const a = openSocket('silence_none');
  const b = openSocket('silence_l2');
  await Promise.all([a.opened, b.opened]);
  send(b, sub('l2', { symbol: 'STX-USD' }));
  const t0 = performance.now();
  while (performance.now() - t0 < 110_000 && (!a.closed || !b.closed)) await sleep(500);
  for (const s of [a, b]) {
    const lastAt = s.frames.length ? Math.round((s.frames[s.frames.length - 1].at - t0) / 100) / 10 : null;
    const gaps = s.pingAt.slice(1).map((t, i) => t - s.pingAt[i]).sort((x, y) => x - y);
    const pingGapMs = gaps.length ? { min: Math.round(gaps[0]), median: Math.round(gaps[Math.floor(gaps.length / 2)]), max: Math.round(gaps[gaps.length - 1]) } : null;
    log('silence', { label: s.label, frames: s.frames.length, lastFrameAtS: lastAt, pings: s.pings, pingGapMs, closed: s.closed ?? 'open at 110 s' });
    if (!s.closed) s.ws.close();
  }
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const run = { book, errors, origin, deflate, batch, silence }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
