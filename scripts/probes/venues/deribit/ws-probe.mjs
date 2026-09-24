// Deribit WebSocket probe: book channels, change_id chain and level order, size unit against the REST book, heartbeats, silence, errors, compression, and every perpetual on one connection.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode which only asks and closes.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/deribit/ws-probe.mjs [book|batch|silence|basket|deflate]
//   book     book.<id>.100ms on five perpetuals, the grouped 20 level channel, agg2, quote, ticker, perpetual, price ranking, error cases, and a REST compare every 5 s. About 65 s.
//   batch    book.<id>.100ms on every perpetual in one subscribe call for 60 s.
//   silence  four sockets that differ only in heartbeat and subscription, held SILENCE_MS, 90 s by default.
//   basket   the first deribit_price_ranking frame of every perpetual index, and of the _usd index a _usdc index proxies: live constituents and weights. About 15 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/deribit/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://www.deribit.com/ws/api/v2';
const API = 'https://www.deribit.com/api/v2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 2000) + '\n');
}

let nextId = 1;
function rpc(ws, method, params) {
  const id = nextId++;
  const frame = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
  ws.send(JSON.stringify(frame));
  return { id, sentAt: performance.now(), frame };
}

function open(label, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      log('open', { label, ms: Math.round(performance.now() - t0), extensions: ws.extensions || '' });
      resolve(ws);
    });
    ws.once('error', reject);
  });
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (arr) => (arr.length ? { n: arr.length, min: Math.min(...arr), median: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) } : { n: 0 });

async function restBook(id) {
  const r = await fetch(`${API}/public/get_order_book?instrument_name=${id}&depth=20`);
  return (await r.json()).result;
}

async function book() {
  const ws = await open('book');
  const books = new Map(); // channel to {bids: Map, asks: Map, last}
  const st = new Map(); // channel to counters
  const pending = new Map();
  const heart = { heartbeat: 0, testRequest: 0, testAnswerMs: [] };
  const firstSeen = new Set();

  const stOf = (ch) => {
    if (!st.has(ch)) st.set(ch, { frames: 0, snapshots: 0, changes: 0, gaps: 0, emptyDeltas: 0, deltaBidsUnordered: 0, deltaAsksUnordered: 0, snapBidsDesc: null, snapAsksAsc: null, snapLevels: null, actions: {}, maxGapMs: 0, lastAt: 0, ages: [], sameAsPrev: 0, prevBody: '', hasChangeId: 0, hasPrev: 0, types: {} });
    return st.get(ch);
  };

  ws.on('message', (buf) => {
    const at = performance.now();
    const text = buf.toString('utf8');
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      log('non_json', { text: text.slice(0, 200) });
      return;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p.what === 'test') {
        heart.testAnswerMs.push(Math.round(at - p.sentAt));
        return;
      }
      log('reply', { what: p.what, ms: Math.round(at - p.sentAt), body: text.slice(0, 700) });
      capture('replies.jsonl', text);
      return;
    }
    if (m.id !== undefined) {
      log('reply_unmatched', { body: text.slice(0, 400) });
      return;
    }
    if (m.method === 'heartbeat') {
      if (m.params?.type === 'test_request') {
        heart.testRequest++;
        const r = rpc(ws, 'public/test', {});
        pending.set(r.id, { what: 'test', sentAt: r.sentAt });
        if (heart.testRequest === 1) log('test_request_frame', { body: text });
      } else {
        heart.heartbeat++;
        if (heart.heartbeat === 1) log('heartbeat_frame', { body: text });
      }
      return;
    }
    if (m.method !== 'subscription') {
      log('other', { body: text.slice(0, 300) });
      return;
    }
    const ch = m.params.channel;
    const d = m.params.data;
    const s = stOf(ch);
    s.frames++;
    if (s.lastAt) s.maxGapMs = Math.max(s.maxGapMs, Math.round(at - s.lastAt));
    s.lastAt = at;
    if (!firstSeen.has(ch)) {
      firstSeen.add(ch);
      capture('first_frames.jsonl', text);
    }
    if (!ch.startsWith('book.')) {
      if (s.frames <= 2) capture('other_frames.jsonl', text);
      if (s.prevBody === JSON.stringify(d)) s.sameAsPrev++;
      s.prevBody = JSON.stringify(d);
      if (d?.timestamp) s.ages.push(Math.round(Date.now() - d.timestamp));
      return;
    }
    if (typeof d.timestamp === 'number') s.ages.push(Date.now() - d.timestamp);
    if (d.change_id !== undefined) s.hasChangeId++;
    if (d.prev_change_id !== undefined) s.hasPrev++;
    s.types[d.type ?? 'absent'] = (s.types[d.type ?? 'absent'] ?? 0) + 1;
    const parts = ch.split('.');
    if (parts.length === 5) {
      // Grouped channel: [price, amount] pairs, a whole window each time.
      const body = JSON.stringify([d.bids, d.asks]);
      if (body === s.prevBody) s.sameAsPrev++;
      s.prevBody = body;
      s.snapLevels = `${d.bids.length}/${d.asks.length}`;
      if (s.frames === 3) capture('grouped.jsonl', text);
      const desc = d.bids.every((x, i) => i === 0 || d.bids[i - 1][0] > x[0]);
      const asc = d.asks.every((x, i) => i === 0 || d.asks[i - 1][0] < x[0]);
      if (!desc) s.deltaBidsUnordered++;
      if (!asc) s.deltaAsksUnordered++;
      return;
    }
    let bk = books.get(ch);
    if (d.type === 'snapshot') {
      s.snapshots++;
      bk = { bids: new Map(), asks: new Map(), last: d.change_id, ts: d.timestamp };
      books.set(ch, bk);
      for (const [a, p, q] of d.bids) bk.bids.set(p, q);
      for (const [a, p, q] of d.asks) bk.asks.set(p, q);
      s.snapBidsDesc = d.bids.every((x, i) => i === 0 || d.bids[i - 1][1] > x[1]);
      s.snapAsksAsc = d.asks.every((x, i) => i === 0 || d.asks[i - 1][1] < x[1]);
      s.snapLevels = `${d.bids.length}/${d.asks.length}`;
      for (const x of [...d.bids, ...d.asks]) s.actions[`snap:${x[0]}`] = (s.actions[`snap:${x[0]}`] ?? 0) + 1;
      capture('snapshots.jsonl', JSON.stringify({ ...m, params: { ...m.params, data: { ...d, bids: d.bids.slice(0, 3), asks: d.asks.slice(0, 3) } } }));
      return;
    }
    s.changes++;
    if (!bk) {
      s.gaps++;
      return;
    }
    if (d.prev_change_id !== bk.last) s.gaps++;
    bk.last = d.change_id;
    bk.ts = d.timestamp;
    if (d.bids.length === 0 && d.asks.length === 0) s.emptyDeltas++;
    if (!d.bids.every((x, i) => i === 0 || d.bids[i - 1][1] > x[1])) s.deltaBidsUnordered++;
    if (!d.asks.every((x, i) => i === 0 || d.asks[i - 1][1] < x[1])) s.deltaAsksUnordered++;
    for (const [a, p, q] of d.bids) {
      s.actions[a] = (s.actions[a] ?? 0) + 1;
      if (a === 'delete') bk.bids.delete(p);
      else bk.bids.set(p, q);
    }
    for (const [a, p, q] of d.asks) {
      s.actions[a] = (s.actions[a] ?? 0) + 1;
      if (a === 'delete') bk.asks.delete(p);
      else bk.asks.set(p, q);
    }
    if (s.changes === 5) capture('deltas.jsonl', text);
  });
  ws.on('close', (code, reason) => log('close', { label: 'book', code, reason: reason.toString() }));

  const send = (what, method, params) => {
    const r = rpc(ws, method, params);
    pending.set(r.id, { what, sentAt: r.sentAt });
  };
  send('set_heartbeat', 'public/set_heartbeat', { interval: 10 });
  send('hello', 'public/hello', { client_name: 'probe', client_version: '0' });
  const channels = [
    'book.BTC_USDC-PERPETUAL.100ms',
    'book.ETH_USDC-PERPETUAL.100ms',
    'book.ALGO_USDC-PERPETUAL.100ms',
    'book.NVDA_USDC-PERPETUAL.100ms',
    'book.ETH-PERPETUAL.100ms',
    'book.BTC_USDC-PERPETUAL.agg2',
    'book.BTC_USDC-PERPETUAL.none.20.100ms',
    'book.ALGO_USDC-PERPETUAL.none.20.100ms',
    'quote.BTC_USDC-PERPETUAL',
    'ticker.BTC_USDC-PERPETUAL.100ms',
    'ticker.ALGO_USDC-PERPETUAL.agg2',
    'perpetual.BTC_USDC-PERPETUAL.100ms',
    'deribit_price_index.btc_usdc',
    'deribit_price_ranking.btc_usdc',
    'deribit_price_ranking.hype_usdc',
    'deribit_price_ranking.nvda_usdc',
    'platform_state',
  ];
  send('subscribe_main', 'public/subscribe', { channels });
  await sleep(1500);
  send('unknown_instrument', 'public/subscribe', { channels: ['book.NOPE_USDC-PERPETUAL.100ms'] });
  await sleep(400);
  send('raw_unauth', 'public/subscribe', { channels: ['book.BTC_USDC-PERPETUAL.raw'] });
  await sleep(400);
  send('bad_interval', 'public/subscribe', { channels: ['book.BTC_USDC-PERPETUAL.50ms'] });
  await sleep(400);
  send('bad_depth', 'public/subscribe', { channels: ['book.BTC_USDC-PERPETUAL.none.50.100ms'] });
  await sleep(400);
  send('duplicate', 'public/subscribe', { channels: ['book.BTC_USDC-PERPETUAL.100ms'] });
  await sleep(400);
  send('mixed_valid_invalid', 'public/subscribe', { channels: ['book.NOPE_USDC-PERPETUAL.100ms', 'trades.ALGO_USDC-PERPETUAL.100ms'] });
  await sleep(400);
  ws.send('not json');
  await sleep(400);
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'public/get_time' }));
  await sleep(400);
  send('unknown_method', 'public/nope', {});
  await sleep(400);
  send('private_unauth', 'private/subscribe', { channels: ['user.orders.any.any.raw'] });

  // Every 5 s, compare the maintained BTC book with a REST read of 20 levels taken while the socket stays open.
  const compares = [];
  for (let i = 0; i < 11; i++) {
    await sleep(5_000);
    const sentAt = Date.now();
    const rest = await restBook('BTC_USDC-PERPETUAL');
    const bk = books.get('book.BTC_USDC-PERPETUAL.100ms');
    if (!bk) continue;
    let eq = 0;
    for (const [p, q] of [...rest.bids, ...rest.asks]) if ((bk.bids.get(p) ?? bk.asks.get(p)) === q) eq++;
    const wsBid = Math.max(...bk.bids.keys());
    const wsAsk = Math.min(...bk.asks.keys());
    compares.push({ restMinusWsChangeId: rest.change_id - bk.last, restTsMinusWsTs: rest.timestamp - bk.ts, restAgeAtReplyMs: Date.now() - rest.timestamp, rttMs: Date.now() - sentAt, sameTouch: wsBid === rest.bids[0][0] && wsAsk === rest.asks[0][0], sizesEqual: `${eq}/${rest.bids.length + rest.asks.length}` });
  }
  log('rest_compare_btc', { reads: compares.length, sameTouch: compares.filter((c) => c.sameTouch).length, rows: compares });
  const bkEnd = books.get('book.BTC_USDC-PERPETUAL.100ms');
  if (bkEnd) log('btc_book_end', { wsLevels: `${bkEnd.bids.size}/${bkEnd.asks.size}`, wsTop: { bid: Math.max(...bkEnd.bids.keys()), ask: Math.min(...bkEnd.asks.keys()) } });
  for (const [ch, s] of st) {
    const { prevBody, lastAt, ages, ...rest2 } = s;
    log('channel', { ch, ...rest2, ageMs: stats(ages.map((a) => Math.round(a))) });
  }
  log('heartbeats', { heartbeat: heart.heartbeat, testRequest: heart.testRequest, testAnswerMs: stats(heart.testAnswerMs) });
  for (const [ch, b] of books) log('book_size', { ch, levels: `${b.bids.size}/${b.asks.size}` });
  ws.close();
  await sleep(300);
}

async function batch() {
  const r = await fetch(`${API}/public/get_instruments?kind=future`);
  const perps = (await r.json()).result.filter((m) => m.settlement_period === 'perpetual').map((m) => m.instrument_name);
  await sleep(500);
  const ws = await open('batch');
  const last = new Map();
  const snaps = new Set();
  const lastAt = new Map();
  const maxGap = new Map();
  let frames = 0;
  let bytes = 0;
  let gaps = 0;
  let parseNs = 0n;
  let tests = 0;
  const perSecond = [];
  let secFrames = 0;
  let firstAt = 0;
  let subReply = null;
  const tick = setInterval(() => {
    perSecond.push(secFrames);
    secFrames = 0;
  }, 1000);
  ws.on('message', (buf) => {
    const t = process.hrtime.bigint();
    const m = JSON.parse(buf.toString('utf8'));
    parseNs += process.hrtime.bigint() - t;
    if (m.id === 2) {
      subReply = { count: m.result?.length, error: m.error };
      return;
    }
    if (m.method === 'heartbeat') {
      if (m.params.type === 'test_request') {
        tests++;
        rpc(ws, 'public/test', {});
      }
      return;
    }
    if (m.method !== 'subscription') return;
    frames++;
    secFrames++;
    bytes += buf.length;
    const d = m.params.data;
    const id = d.instrument_name;
    const now = performance.now();
    if (!firstAt) firstAt = now;
    if (lastAt.has(id)) maxGap.set(id, Math.max(maxGap.get(id) ?? 0, now - lastAt.get(id)));
    lastAt.set(id, now);
    if (d.type === 'snapshot') {
      snaps.add(id);
      last.set(id, d.change_id);
      return;
    }
    if (last.get(id) !== d.prev_change_id) gaps++;
    last.set(id, d.change_id);
  });
  ws.on('close', (code) => log('close', { label: 'batch', code }));
  nextId = 1;
  rpc(ws, 'public/set_heartbeat', { interval: 10 });
  const t0 = performance.now();
  rpc(ws, 'public/subscribe', { channels: perps.map((p) => `book.${p}.100ms`) });
  const snapTimer = setInterval(() => {
    if (snaps.size === perps.length) {
      log('all_snapshots', { ms: Math.round(performance.now() - t0) });
      clearInterval(snapTimer);
    }
  }, 20);
  await sleep(60_000);
  clearInterval(tick);
  clearInterval(snapTimer);
  const gapsSorted = [...maxGap.entries()].sort((a, b) => b[1] - a[1]);
  const silentAll = perps.filter((p) => !lastAt.has(p));
  log('batch', { channels: perps.length, subReply, snapshots: snaps.size, frames, framesPerSecond: stats(perSecond.slice(1)), kbPerSecond: Math.round(bytes / 60 / 1024), bytesPerFrame: Math.round(bytes / frames), gaps, parseUsPerFrame: Number(parseNs / BigInt(frames)) / 1000, testRequests: tests, longestSilenceMs: gapsSorted.slice(0, 5).map(([k, v]) => [k, Math.round(v)]), instrumentsWithMaxGapOver30s: gapsSorted.filter(([, v]) => v > 30_000).length, neverDelivered: silentAll });
  ws.close();
  await sleep(300);
}

async function silence() {
  const holdMs = Number(process.env.SILENCE_MS ?? 90_000);
  const results = {};
  const t0 = performance.now();
  const mk = async (label, answers, setup) => {
    const ws = await open(label);
    const r = { kinds: {}, testRequestAtS: [], closedAtMs: null, code: null };
    results[label] = r;
    ws.on('message', (buf) => {
      const m = JSON.parse(buf.toString('utf8'));
      const kind = m.method === 'heartbeat' ? `heartbeat:${m.params?.type}` : m.method ?? (m.error ? 'error_reply' : 'reply');
      r.kinds[kind] = (r.kinds[kind] ?? 0) + 1;
      if (r.kinds[kind] === 1 && kind.startsWith('heartbeat')) log('silence_first_frame', { label, kind, body: buf.toString('utf8').slice(0, 300) });
      if (kind === 'heartbeat:test_request') {
        r.testRequestAtS.push(Math.round((performance.now() - t0) / 100) / 10);
        if (answers) rpc(ws, 'public/test', {});
      }
    });
    ws.on('close', (code, reason) => {
      r.closedAtMs = Math.round(performance.now() - t0);
      r.code = code;
      log('silence_close', { label, closedAtMs: r.closedAtMs, code, reason: reason.toString() });
    });
    setup(ws);
    return ws;
  };
  const sockets = [
    await mk('nothing', false, () => {}),
    await mk('subscribed_quiet_book_no_heartbeat', false, (ws) => rpc(ws, 'public/subscribe', { channels: ['book.ALGO_USDC-PERPETUAL.agg2'] })),
    await mk('heartbeat_10s_answers', true, (ws) => rpc(ws, 'public/set_heartbeat', { interval: 10 })),
    await mk('heartbeat_10s_never_answers', false, (ws) => rpc(ws, 'public/set_heartbeat', { interval: 10 })),
  ];
  while (performance.now() - t0 < holdMs) {
    await sleep(1000);
    if (sockets.every((s) => s.readyState !== s.OPEN)) break;
  }
  log('silence', { heldMs: Math.round(performance.now() - t0), results });
  for (const s of sockets) if (s.readyState === s.OPEN) s.close();
  await sleep(300);
}

// The index basket of every perpetual, from the first deribit_price_ranking frame of each price_index.
// A *_usdc index whose only live source is proxy_usd is the *_usd index converted, so its *_usd ranking is read as well.
async function basket() {
  const r = await fetch(`${API}/public/get_instruments?kind=future`);
  const perps = (await r.json()).result.filter((m) => m.settlement_period === 'perpetual');
  await sleep(500);
  const ws = await open('basket');
  const got = new Map();
  const replies = [];
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString('utf8'));
    if (m.id !== undefined) {
      replies.push({ count: m.result?.length, error: m.error });
      return;
    }
    const ch = m.params?.channel;
    if (!ch?.startsWith('deribit_price_ranking.')) return;
    const idx = ch.slice('deribit_price_ranking.'.length);
    if (!got.has(idx)) got.set(idx, m.params.data);
  });
  const live = (idx) => (got.get(idx) ?? []).filter((c) => c.enabled && c.weight > 0);
  rpc(ws, 'public/subscribe', { channels: perps.map((p) => `deribit_price_ranking.${p.price_index}`) });
  await sleep(6000);
  const proxied = perps.filter((p) => { const l = live(p.price_index); return l.length === 1 && l[0].identifier === 'proxy_usd'; });
  const usdNames = [...new Set(proxied.map((p) => p.price_index.replace(/_usdc$/, '_usd')))];
  rpc(ws, 'public/subscribe', { channels: usdNames.map((n) => `deribit_price_ranking.${n}`) });
  await sleep(6000);
  const sources = {};
  const byCount = {};
  const flagged = [];
  let mdaOnly = 0;
  for (const p of perps) {
    let idx = p.price_index;
    let l = live(idx);
    if (l.length === 1 && l[0].identifier === 'proxy_usd') {
      idx = idx.replace(/_usdc$/, '_usd');
      l = live(idx);
    }
    const n = got.has(idx) ? l.length : 'no frame';
    byCount[n] = (byCount[n] ?? 0) + 1;
    for (const c of l) sources[c.identifier] = (sources[c.identifier] ?? 0) + 1;
    const desc = l.map((c) => `${c.identifier}:${c.weight}`).join(' ');
    capture('baskets.jsonl', JSON.stringify({ id: p.instrument_name, type: p.underlying_type, idx, basket: desc }));
    if (desc === 'mda_index_source:100') mdaOnly++;
    else flagged.push(`${p.instrument_name} ${p.underlying_type} ${idx} [${desc}]`);
  }
  log('basket_replies', { replies, perps: perps.length, proxiedToUsd: usdNames.length });
  log('basket_live_constituent_count', byCount);
  log('basket_sources', sources);
  log('basket_mda_index_source_only', { count: mdaOnly });
  log('basket_visible', { count: flagged.length, rows: flagged });
  ws.close();
  await sleep(300);
}

async function deflate() {
  const ws = new WebSocket(WS_URL, { perMessageDeflate: true });
  let upgradeHeaders = null;
  ws.once('upgrade', (res) => {
    upgradeHeaders = res.headers;
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  log('deflate', { negotiated: ws.extensions || 'none', secWebSocketExtensions: upgradeHeaders?.['sec-websocket-extensions'] ?? null, server: upgradeHeaders?.server ?? null });
  ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, batch, silence, basket, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
