// XT.COM futures WebSocket probe: endpoints, the incremental and limited depth channels, sequence and level order, the documented REST snapshot recipe, anchor channels, keepalive, silence, errors, and a batch of perpetuals on one connection.
// Public, unauthenticated and read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/xt/ws-probe.mjs [book|misc|batch|silence|deflate|lag|align]
//   book     depth_update at 100 ms and depth at 50 levels on four USDT-M perps for 60 s, with the REST snapshot recipe, a second book seeded from the first depth frame, and a REST compare at the end, about 65 s
//   misc     both URLs, coin-M on the same host, anchor channels, a CJK symbol, unknown and malformed requests, duplicate subscribes, for 30 s
//   batch    depth_update on the busiest 200 USDT-M perps on one connection in one frame, then 200 more in a second frame, 25 s each
//   silence  three sockets that differ only in what the client sends or subscribes, for up to 45 s
//   deflate  asks for permessage-deflate once and prints what the server negotiates and how the frames arrive
//   align    btc and eth books kept from depth_update against every depth frame and 20 REST reads, grouped by how far apart the update ids are, about 25 s
//   lag      mark_price and index_price on three perps beside 20 one second REST polls of the bulk calls, to time how late REST carries each t, about 25 s
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/xt/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_DOC = 'wss://fstream.xt.com/ws/market'; // the documented public URL
const URL_CCXT = 'wss://fstream.xt.com/ws'; // CCXT Pro's contract URL
const FAPI = 'https://fapi.xt.com/future/market';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};
const stats = (arr) => (arr.length ? { n: arr.length, min: Math.min(...arr), median: pct(arr, 0.5), p90: pct(arr, 0.9), max: Math.max(...arr) } : { n: 0 });
const trim = (s, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false });
  ws.once('upgrade', (res) => (ws.__upgradeExt = res.headers['sec-websocket-extensions']));
  return new Promise((resolve) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ ws: null, status: res.statusCode, body: trim(body, 300) }));
    });
    ws.once('error', (e) => resolve({ ws: null, error: e.message }));
  });
}

const sub = (params, id = String(Date.now())) => JSON.stringify({ method: 'SUBSCRIBE', params, id });

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

async function tradingPerps() {
  const list = (await getJson(`${FAPI}/v1/public/symbol/list`)).result;
  const perps = list.filter((x) => x.productType === 'perpetual' && x.tradeSwitch === true && x.isOpenApi === true);
  const tick = (await getJson(`${FAPI}/v1/public/q/tickers`)).result;
  const turnover = new Map(tick.map((t) => [t.s, Number(t.v)]));
  perps.sort((a, b) => (turnover.get(b.symbol) ?? 0) - (turnover.get(a.symbol) ?? 0));
  return perps;
}

const isDesc = (a) => a.every((v, i) => i === 0 || Number(a[i - 1][0]) > Number(v[0]));
const isAsc = (a) => a.every((v, i) => i === 0 || Number(a[i - 1][0]) < Number(v[0]));

async function book() {
  const perps = await tradingPerps();
  const pick = ['btc_usdt', 'eth_usdt', perps[120].symbol, perps[500].symbol];
  const cs = Object.fromEntries(perps.map((p) => [p.symbol, p.contractSize]));
  log('book_pick', { symbols: pick, contractSize: pick.map((s) => cs[s]) });
  const { ws, openMs } = await open(URL_DOC);
  log('open', { url: URL_DOC, openMs });
  const tSub = performance.now();
  ws.send(sub(pick.map((s) => `depth_update@${s},100ms`), 'inc'));
  ws.send(sub(pick.map((s) => `depth@${s},50,100ms`), 'lim'));
  const st = {};
  for (const s of pick) st[s] = { inc: [], lim: 0, limSame: 0, limLast: null, limIds: new Set(), last: null, gaps: 0, puMismatch: 0, empty: 0, unsortedB: 0, unsortedA: 0, firstMs: null, limFirstMs: null, buffered: [], book: null, snapU: null, applied: 0, dropped: 0, bad: 0, limLevels: [], limOrder: { bDesc: 0, aAsc: 0 }, gapSample: [], seed: { book: null, snapU: null, applied: 0, dropped: 0, bad: 0, buf: [], skipped: 0, rejected: 0, seededAtMs: null }, align: { same: 0, deltasAhead: 0, snapshotAhead: 0, sameTop20Equal: 0 } };
  const acks = [];
  let pongs = 0;
  ws.on('message', (raw) => {
    const text = raw.toString();
    if (text === 'pong') {
      pongs++;
      return;
    }
    const m = JSON.parse(text);
    if (m.id !== undefined && m.topic === undefined) {
      acks.push({ ms: Math.round(performance.now() - tSub), ...m });
      capture('book-acks.jsonl', text);
      return;
    }
    const d = m.data;
    const s = d?.s;
    if (!st[s]) return;
    const x = st[s];
    if (m.topic === 'depth_update') {
      capture(`book-inc-${s}.jsonl`, trim(text, 1500));
      if (x.firstMs === null) {
        x.firstMs = Math.round(performance.now() - tSub);
        x.firstFrame = trim(text, 500);
      }
      const fu = Number(d.fu), u = Number(d.u), pu = Number(d.pu);
      if (x.last !== null) {
        if (fu !== x.last + 1) {
          x.gaps++;
          if (x.gapSample.length < 3) x.gapSample.push({ prevU: x.last, fu, pu, u });
        }
        if (pu !== x.last) x.puMismatch++;
      }
      x.last = u;
      x.inc.push(1);
      if ((d.b?.length ?? 0) === 0 && (d.a?.length ?? 0) === 0) x.empty++;
      if (d.b?.length > 1 && !isDesc(d.b)) x.unsortedB++;
      if (d.a?.length > 1 && !isAsc(d.a)) x.unsortedA++;
      if (x.book === null) x.buffered.push(d);
      else applyDelta(x, d);
      if (x.seed.book === null) x.seed.buf.push(d);
      else if (x.seed.applied === 0 && Number(d.u) > x.seed.snapU && Number(d.fu) > x.seed.snapU + 1) {
        // The seed is older than the first delta this socket delivered, so it cannot be bridged: wait for the next depth frame.
        x.seed.rejected++;
        x.seed.book = null;
        x.seed.buf = [d];
      } else applyDelta(x.seed, d);
    } else if (m.topic === 'depth') {
      if (x.limFirstMs === null) {
        x.limFirstMs = Math.round(performance.now() - tSub);
        x.limFirst = trim(text, 500);
        x.limKeys = Object.keys(d);
      }
      capture(`book-lim-${s}.jsonl`, trim(text, 1500));
      x.lim++;
      const key = JSON.stringify([d.b, d.a]);
      if (key === x.limLast) x.limSame++;
      x.limLast = key;
      x.limIds.add(d.id);
      x.limLevels.push(Math.min(d.b?.length ?? 0, d.a?.length ?? 0));
      if (isDesc(d.b ?? [])) x.limOrder.bDesc++;
      if (isAsc(d.a ?? [])) x.limOrder.aAsc++;
      x.limLatest = d;
      // Seed a second book from the first limited depth frame, whose id is the lastUpdateId of the same sequence.
      if (x.seed.book === null && x.seed.buf.length > 0 && Number(d.id) + 1 < Number(x.seed.buf[0].fu)) {
        x.seed.skipped++;
      } else if (x.seed.book === null) {
        x.seed.snapU = Number(d.id);
        x.seed.book = { b: new Map(d.b.map(([p, q]) => [String(Number(p)), q])), a: new Map(d.a.map(([p, q]) => [String(Number(p)), q])) };
        x.seed.bufInfo = { buffered: x.seed.buf.length, snapU: d.id, firstFu: x.seed.buf[0]?.fu };
        x.seed.seededAtMs = Math.round(performance.now() - tSub);
        for (const b of x.seed.buf) applyDelta(x.seed, b);
        x.seed.buf = null;
      } else if (x.last !== null) {
        const diff = x.last - Number(d.id);
        if (diff === 0) {
          x.align.same++;
          const tb = topOf(x.seed.book.b, true), ta = topOf(x.seed.book.a, false);
          if (sameLevels(tb, d.b) && sameLevels(ta, d.a)) x.align.sameTop20Equal++;
        } else if (diff > 0) x.align.deltasAhead++;
        else x.align.snapshotAhead++;
      }
    }
  });
  const ping = setInterval(() => ws.send('ping'), 15_000);
  // The documented recipe: buffer, fetch a REST snapshot, drop u <= lastUpdateId, apply from the first event that spans it.
  await sleep(3000);
  for (const s of pick) {
    const r = await getJson(`${FAPI}/v1/public/q/depth?symbol=${s}&level=50`);
    const snap = r.result;
    const x = st[s];
    x.snapU = Number(snap.u);
    x.book = { b: new Map(snap.b.map(([p, q]) => [String(Number(p)), q])), a: new Map(snap.a.map(([p, q]) => [String(Number(p)), q])) };
    const buf = x.buffered;
    x.buffered = null;
    x.bufInfo = { buffered: buf.length, snapU: x.snapU, firstFu: buf[0]?.fu, lastU: buf.at(-1)?.u };
    for (const d of buf) applyDelta(x, d);
    await sleep(150);
  }
  await sleep(57_000);
  clearInterval(ping);
  // Compare the maintained book, trimmed to the top 20, with a fresh REST read and the latest limited depth frame.
  for (const s of pick) {
    const x = st[s];
    const r = (await getJson(`${FAPI}/v1/public/q/depth?symbol=${s}&level=50`)).result;
    const lastU = x.last;
    const top = (m, desc) => [...m.entries()].filter(([, q]) => Number(q) > 0).sort((a, b) => (desc ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]))).slice(0, 20);
    const mb = top(x.book.b, true), ma = top(x.book.a, false);
    const eq = (mine, theirs) => mine.filter(([p, q], i) => theirs[i] && Number(theirs[i][0]) === Number(p) && Number(theirs[i][1]) === Number(q)).length;
    const lim = x.limLatest;
    const sb = top(x.seed.book.b, true), sa = top(x.seed.book.a, false);
    log('seed_compare', { s, seed_eq_rest_seeded_bids: eq(sb, mb), seed_eq_rest_seeded_asks: eq(sa, ma), rest_eq_bids: eq(sb, r.b), rest_eq_asks: eq(sa, r.a), recipe: x.seed.bufInfo, applied: x.seed.applied, dropped: x.seed.dropped, bad_first: x.seed.bad, depth_frames_skipped_as_older_than_stream: x.seed.skipped, seeds_rejected_by_first_delta: x.seed.rejected, seeded_at_ms: x.seed.seededAtMs, alignment_at_each_later_depth_frame: x.align });
    log('book_compare', {
      s, restU: r.u, wsLastU: lastU, limId: lim?.id,
      rest_eq_bids: eq(mb, r.b), rest_eq_asks: eq(ma, r.a),
      lim_eq_bids: lim ? eq(mb, lim.b) : null, lim_eq_asks: lim ? eq(ma, lim.a) : null,
      ws_top: { b: mb[0], a: ma[0] }, rest_top: { b: r.b[0], a: r.a[0] }, lim_top: lim ? { b: lim.b[0], a: lim.a[0] } : null,
      book_levels: { b: x.book.b.size, a: x.book.a.size },
    });
    await sleep(150);
  }
  ws.close();
  log('acks', { acks });
  for (const s of pick) {
    const x = st[s];
    log('book_stats', {
      s, contractSize: cs[s], inc_frames: x.inc.length, inc_first_ms: x.firstMs, gaps: x.gaps, gapSample: x.gapSample, pu_ne_prev_u: x.puMismatch, empty_deltas: x.empty,
      unsorted_bid_arrays: x.unsortedB, unsorted_ask_arrays: x.unsortedA, recipe: x.bufInfo, applied: x.applied, dropped_le_snapshot: x.dropped, bad_first: x.bad,
      lim_frames: x.lim, lim_first_ms: x.limFirstMs, lim_identical_to_previous: x.limSame, lim_distinct_ids: x.limIds.size, lim_min_levels: stats(x.limLevels), lim_order_ok: x.limOrder,
    });
    log('first_frames', { s, inc: x.firstFrame, lim: x.limFirst, limKeys: x.limKeys });
  }
  log('pongs', { pongs });
}

const topOf = (m, desc) => [...m.entries()].filter(([, q]) => Number(q) > 0).sort((a, b) => (desc ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]))).slice(0, 20);
const sameLevels = (mine, theirs) => mine.every(([p, q], i) => theirs[i] && Number(theirs[i][0]) === Number(p) && Number(theirs[i][1]) === Number(q));

function applyDelta(x, d) {
  const u = Number(d.u), fu = Number(d.fu);
  if (u <= x.snapU) {
    x.dropped++;
    return;
  }
  if (x.applied === 0 && !(fu <= x.snapU + 1 && u >= x.snapU + 1)) x.bad++;
  for (const [p, q] of d.b ?? []) Number(q) === 0 ? x.book.b.delete(String(Number(p))) : x.book.b.set(String(Number(p)), q);
  for (const [p, q] of d.a ?? []) Number(q) === 0 ? x.book.a.delete(String(Number(p))) : x.book.a.set(String(Number(p)), q);
  x.applied++;
}

async function collect(ws, ms, onFrame) {
  const frames = [];
  const h = (raw) => {
    const t = raw.toString();
    frames.push({ at: Date.now(), t });
    onFrame?.(t);
  };
  ws.on('message', h);
  await sleep(ms);
  ws.off('message', h);
  return frames;
}

async function misc() {
  // Both URLs, and a coin-M contract on the USDT-M host.
  for (const url of [URL_DOC, URL_CCXT, 'wss://fstream.xt.com/ws/user', 'wss://dstream.xt.com/ws/market']) {
    const r = await open(url);
    if (!r.ws) {
      log('url', { url, ...r });
      continue;
    }
    r.ws.send(sub(['depth_update@btc_usdt,100ms', 'depth_update@btc_usd,100ms', 'depth@btc_usd,20,1000ms'], 'u'));
    const frames = await collect(r.ws, 3000);
    const count = {};
    for (const f of frames) {
      try {
        const m = JSON.parse(f.t);
        const k = m.event ?? `ack:${m.id}:${m.code}`;
        count[k] = (count[k] ?? 0) + 1;
      } catch {
        count[f.t] = (count[f.t] ?? 0) + 1;
      }
    }
    log('url', { url, openMs: r.openMs, frames: frames.length, count });
    r.ws.close();
  }
  const { ws } = await open(URL_DOC);
  const tSub = Date.now();
  // Anchor channels, a CJK symbol, a pre-market or quiet symbol, without and with an interval suffix.
  const cjk = '龙虾_usdt';
  const params = ['mark_price@btc_usdt', 'index_price@btc_usdt', 'fund_rate@btc_usdt', 'agg_ticker@btc_usdt', 'ticker@btc_usdt', `depth_update@${cjk},100ms`, 'depth_update@eth_usdt', 'depth@eth_usdt,20', 'mark_price@btc_usd'];
  ws.send(sub(params, 'anchor'));
  const lag = { mark_price: [], index_price: [], fund_rate: [], agg_ticker: [], ticker: [] };
  const firsts = {};
  const counts = {};
  const f1 = collect(ws, 30_000, (t) => {
    if (t === 'pong') return;
    const m = JSON.parse(t);
    const k = m.event ?? `ack:${m.id}`;
    counts[k] = (counts[k] ?? 0) + 1;
    if (!firsts[k]) firsts[k] = trim(t, 600);
    if (lag[m.topic] && m.data?.t) lag[m.topic].push(Date.now() - m.data.t);
  });
  await sleep(2000);
  // Errors and edge cases, each with its own id.
  const tries = [
    ['nope_sym', sub(['depth_update@nope_usdt,100ms'], 'nope_sym')],
    ['nope_topic', sub(['nope@btc_usdt'], 'nope_topic')],
    ['bad_interval', sub(['depth_update@btc_usdt,70ms'], 'bad_interval')],
    ['bad_levels', sub(['depth@btc_usdt,30,100ms'], 'bad_levels')],
    ['delisted', sub(['depth_update@ftt_usdt,100ms'], 'delisted')],
    ['not_openapi', sub(['depth_update@dia_usdt,100ms'], 'not_openapi')],
    ['dup', sub(['depth_update@eth_usdt'], 'dup')],
    ['upper', sub(['depth_update@BTC_USDT,100ms'], 'upper')],
    ['bad_method', JSON.stringify({ method: 'NOPE', params: ['depth_update@btc_usdt'], id: 'bad_method' })],
    ['not_json', 'hello'],
    ['json_ping', JSON.stringify({ method: 'ping' })],
  ];
  for (const [, frame] of tries) {
    ws.send(frame);
    await sleep(300);
  }
  ws.send('ping');
  const tPing = Date.now();
  await f1;
  log('misc_counts', { since_sub_ms: Date.now() - tSub, counts });
  for (const [k, v] of Object.entries(firsts)) log('misc_first', { k, v });
  for (const [k, v] of Object.entries(lag)) log('anchor_lag_ms', { topic: k, ...stats(v) });
  log('ping_sent', { at: tPing });
  ws.close();
}

async function batch() {
  const perps = await tradingPerps();
  const first = perps.slice(0, 200).map((p) => p.symbol);
  const more = perps.slice(200, 400).map((p) => p.symbol);
  const { ws, openMs } = await open(URL_DOC);
  log('open', { openMs });
  const t0 = performance.now();
  ws.send(sub(first.map((s) => `depth_update@${s},100ms`), 'b1'));
  const last = new Map();
  const seen = new Set();
  let frames = 0, bytes = 0, gaps = 0, parseUs = 0, closed = null, skips = 0, overlaps = 0, puChainHeld = 0, backwards = 0, fuNePuPlus1 = 0;
  const gapSecs = {};
  const gapSyms = new Map();
  const skipSizes = [];
  const gapSample = [];
  const perSec = [];
  let secFrames = 0;
  const acks = [];
  ws.on('close', (code, reason) => (closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }));
  ws.on('message', (raw) => {
    const t = raw.toString();
    if (t === 'pong') return;
    const p0 = performance.now();
    const m = JSON.parse(t);
    parseUs += (performance.now() - p0) * 1000;
    if (m.topic === undefined) {
      acks.push({ ms: Math.round(performance.now() - t0), m: trim(t, 200) });
      return;
    }
    frames++;
    secFrames++;
    bytes += t.length;
    const d = m.data;
    seen.add(d.s);
    const prev = last.get(d.s);
    const fu = Number(d.fu), pu = Number(d.pu), u = Number(d.u);
    if (fu !== pu + 1) fuNePuPlus1++;
    if (prev !== undefined && fu !== prev + 1) {
      gaps++;
      gapSecs[Math.floor((performance.now() - t0) / 1000)] = (gapSecs[Math.floor((performance.now() - t0) / 1000)] ?? 0) + 1;
      gapSyms.set(d.s, (gapSyms.get(d.s) ?? 0) + 1);
      if (fu > prev + 1) {
        skips++;
        skipSizes.push(fu - prev - 1);
      } else overlaps++;
      if (pu === prev) puChainHeld++;
      if (gapSample.length < 5) gapSample.push({ s: d.s, prev, pu, fu, u, atMs: Math.round(performance.now() - t0) });
    }
    if (prev !== undefined && u <= prev) backwards++;
    last.set(d.s, u);
  });
  const tick = setInterval(() => {
    perSec.push(secFrames);
    secFrames = 0;
  }, 1000);
  const ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 15_000);
  await sleep(25_000);
  const seenAt30 = seen.size;
  // A second slice of 200 on the same socket, to look for a per connection cap.
  ws.send(sub(more.map((s) => `depth_update@${s},100ms`), 'b2'));
  await sleep(25_000);
  clearInterval(tick);
  clearInterval(ping);
  ws.close();
  const secs = perSec.length;
  log('batch', {
    streams: first.length + more.length, delivering_at_25s: seenAt30, delivering_at_50s: seen.size, frames, gaps, skips, overlaps, gaps_where_pu_equals_prev_u: puChainHeld, u_not_increasing: backwards, fu_ne_pu_plus_1: fuNePuPlus1,
    symbols_with_gaps: gapSyms.size, gaps_first_25s: Object.entries(gapSecs).filter(([k]) => Number(k) < 25).reduce((a, [, v]) => a + v, 0), gap_seconds: gapSecs, skip_size: stats(skipSizes), gapSample,
    top_gap_symbols: [...gapSyms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    frames_per_s: stats(perSec), kb_per_s: Math.round(bytes / 1024 / secs), bytes_per_frame: Math.round(bytes / frames), parse_us_per_frame: +(parseUs / frames).toFixed(1), closed, acks,
  });
}

async function silence() {
  const tStart = performance.now();
  const variants = [
    { name: 'no_sub_no_ping', subs: [], ping: false },
    { name: 'sub_quiet_no_ping', subs: ['depth_update@QUIET,1000ms'], ping: false },
    { name: 'sub_quiet_ping_20s', subs: ['depth_update@QUIET,1000ms'], ping: true },
  ];
  const perps = await tradingPerps();
  const quiet = perps.at(-1).symbol;
  const res = await Promise.all(variants.map(async (v) => {
    const { ws, openMs } = await open(URL_DOC);
    const t0 = performance.now();
    let frames = 0, lastFrame = null, pings = 0;
    ws.on('ping', () => pings++);
    ws.on('message', () => {
      frames++;
      lastFrame = Math.round(performance.now() - t0);
    });
    if (v.subs.length) ws.send(sub(v.subs.map((s) => s.replace('QUIET', quiet)), v.name));
    const timer = v.ping ? setInterval(() => ws.readyState === 1 && ws.send('ping'), 20_000) : null;
    const closed = await new Promise((resolve) => {
      const end = setTimeout(() => resolve(null), 45_000);
      ws.on('close', (code, reason) => {
        clearTimeout(end);
        resolve({ code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) });
      });
    });
    if (timer) clearInterval(timer);
    if (!closed) ws.terminate();
    return { variant: v.name, quiet, openMs, frames, lastFrameMs: lastFrame, protocol_pings: pings, closed: closed ?? "open at 45 s" };
  }));
  for (const r of res) log('silence', r);
  log('silence_total_ms', { ms: Math.round(performance.now() - tStart) });
}

// Whether a book kept from depth_update equals the depth snapshot and the REST book read at the same update id.
async function align() {
  const syms = ['btc_usdt', 'eth_usdt'];
  const { ws } = await open(URL_DOC);
  const st = Object.fromEntries(syms.map((s) => [s, { book: null, snapU: null, applied: 0, dropped: 0, bad: 0, buf: [], last: null, byDiff: {} }]));
  const note = (x, kind, diff, eqB, eqA, sample, c = {}) => {
    const k = `${kind} diff=${diff === 0 ? 0 : diff > 0 ? (diff <= 20 ? '1..20' : '>20') : diff >= -20 ? '-20..-1' : '<-20'}`;
    const o = (x.byDiff[k] ??= { n: 0, all40: 0, eqSum: 0, sample: null });
    o.n++;
    o.eqSum += eqB + eqA;
    o.crossed = (o.crossed ?? 0) + (c.crossed ? 1 : 0);
    o.levelsOnlyInMine = (o.levelsOnlyInMine ?? 0) + (c.mineOnly ?? 0);
    if (eqB + eqA === 40) o.all40++;
    else if (!o.sample && sample) o.sample = sample;
  };
  const cmp = (x, frameB, frameA) => {
    const tb = topOf(x.book.b, true), ta = topOf(x.book.a, false);
    const eqc = (mine, theirs) => mine.filter(([p, q], i) => theirs[i] && Number(theirs[i][0]) === Number(p) && Number(theirs[i][1]) === Number(q)).length;
    const i = ta.findIndex(([p, q], j) => !(frameA[j] && Number(frameA[j][0]) === Number(p) && Number(frameA[j][1]) === Number(q)));
    const theirs = new Set([...frameB, ...frameA].map(([p]) => Number(p)));
    const lowestTheirs = Math.min(...frameB.slice(0, 20).map(([p]) => Number(p)));
    const highestTheirs = Math.max(...frameA.slice(0, 20).map(([p]) => Number(p)));
    const mineOnly = [...tb, ...ta].filter(([p]) => Number(p) >= lowestTheirs && Number(p) <= highestTheirs && !theirs.has(Number(p))).length;
    const crossed = tb[0] && ta[0] && Number(tb[0][0]) >= Number(ta[0][0]);
    return { eqB: eqc(tb, frameB), eqA: eqc(ta, frameA), mineOnly, crossed, firstAskMismatch: i >= 0 ? { at: i, mine: ta[i], theirs: frameA[i] } : null };
  };
  ws.on('message', (raw) => {
    const t = raw.toString();
    if (t === 'pong') return;
    const m = JSON.parse(t);
    const d = m.data;
    const x = st[d?.s];
    if (!x) return;
    if (m.topic === 'depth_update') {
      x.last = Number(d.u);
      if (x.book === null) x.buf.push(d);
      else applyDelta(x, d);
    } else if (m.topic === 'depth' && x.book) {
      const c = cmp(x, d.b, d.a);
      note(x, 'ws_depth50', x.last - Number(d.id), c.eqB, c.eqA, c.firstAskMismatch, c);
    }
  });
  ws.send(sub(syms.flatMap((s) => [`depth_update@${s},100ms`, `depth@${s},50`]), 'align'));
  const ping = setInterval(() => ws.send('ping'), 15_000);
  await sleep(1500);
  for (const s of syms) {
    const snap = (await getJson(`${FAPI}/v1/public/q/depth?symbol=${s}&level=1000`)).result;
    const x = st[s];
    x.snapU = Number(snap.u);
    x.book = { b: new Map(snap.b.map(([p, q]) => [String(Number(p)), q])), a: new Map(snap.a.map(([p, q]) => [String(Number(p)), q])) };
    for (const d of x.buf) applyDelta(x, d);
    x.buf = null;
  }
  for (let i = 0; i < 20; i++) {
    for (const s of syms) {
      const r = (await getJson(`${FAPI}/v1/public/q/depth?symbol=${s}&level=50`)).result;
      const x = st[s];
      const c = cmp(x, r.b, r.a);
      note(x, 'rest_depth50', x.last - Number(r.u), c.eqB, c.eqA, c.firstAskMismatch, c);
      await sleep(500);
    }
  }
  clearInterval(ping);
  ws.close();
  for (const s of syms) log('align', { s, applied: st[s].applied, bad_first: st[s].bad, byDiff: st[s].byDiff });
}

// The same mark and index read from the socket and from the REST bulk calls: how much later the REST reply carries a given t.
async function lag() {
  const ids = ['btc_usdt', 'eth_usdt', 'sol_usdt'];
  const { ws } = await open(URL_DOC);
  const seen = new Map(); // topic|s|t to arrival and price
  ws.on('message', (raw) => {
    const t = raw.toString();
    if (t === 'pong') return;
    const m = JSON.parse(t);
    if (m.data?.t) seen.set(`${m.topic}|${m.data.s}|${m.data.t}`, { at: Date.now(), p: m.data.p });
  });
  ws.send(sub(ids.flatMap((s) => [`mark_price@${s}`, `index_price@${s}`]), 'lag'));
  const delay = { mark_price: [], index_price: [] };
  const miss = { mark_price: 0, index_price: 0 };
  const priceEq = { mark_price: 0, index_price: 0 };
  const restAge = { mark_price: [], index_price: [] };
  await sleep(3000);
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    for (const [topic, path] of [['mark_price', 'mark-price'], ['index_price', 'index-price']]) {
      const rows = (await getJson(`${FAPI}/v1/public/q/${path}`)).result;
      const at = Date.now();
      for (const r of rows.filter((x) => ids.includes(x.s))) {
        restAge[topic].push(at - r.t);
        const w = seen.get(`${topic}|${r.s}|${r.t}`);
        if (!w) {
          miss[topic]++;
          continue;
        }
        delay[topic].push(at - w.at);
        if (Number(w.p) === Number(r.p)) priceEq[topic]++;
      }
    }
    const wait = 1000 - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  ws.close();
  for (const k of Object.keys(delay)) log('rest_behind_ws_ms', { topic: k, rest_arrival_minus_ws_arrival_same_t: stats(delay[k]), rest_age_at_arrival: stats(restAge[k]), no_ws_frame_with_that_t: miss[k], same_price: priceEq[k] });
}

async function deflate() {
  const { ws, openMs } = await open(URL_DOC, { deflate: true });
  const ext = ws.extensions;
  let binary = 0, text = 0;
  ws.on('message', (raw, isBinary) => (isBinary ? binary++ : text++));
  ws.send(sub(['depth_update@btc_usdt,100ms'], 'd'));
  await sleep(3000);
  log('deflate_offered', { openMs, negotiated: ext, header: ws.__upgradeExt ?? null, binary, text });
  ws.close();
  const plain = await open(URL_DOC);
  let b2 = 0, t2 = 0;
  plain.ws.on('message', (raw, isBinary) => (isBinary ? b2++ : t2++));
  plain.ws.send(sub(['depth_update@btc_usdt,100ms'], 'p'));
  await sleep(3000);
  log('deflate_refused', { openMs: plain.openMs, binary: b2, text: t2 });
  plain.ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, misc, batch, silence, deflate, lag, align };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
