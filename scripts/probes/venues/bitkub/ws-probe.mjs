// Bitkub public WebSocket probe: the live order book stream, the ticker stream, stream naming and errors, several sockets at once, silence and compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node ../scripts/probes/venues/bitkub/ws-probe.mjs [book|streams|fanout|silence|deflate|sync]
//   book     orderbook/<id> on a busy, a quiet, a USDT broker and a stopped pair for 60 s, with two REST depth compares.
//   streams  stream name forms, unknown and closed streams, one market.ticker URL with every active pair, then the same pairs split over two URLs. About 45 s.
//   fanout   one orderbook socket each for the eight busiest THB pairs, opened together, for 30 s.
//   silence  three sockets that never send, one of them never answering pings, for up to 120 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
//   sync     orderbook/1 for 32 s beside a REST depth read every 500 ms, matching the top ten levels of each read to the socket's frames.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep trimmed frames. Recorded in docs/profiles/bitkub/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS = 'wss://api.bitkub.com/websocket-api/';
const API = 'https://api.bitkub.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 20_000) + '\n');
}

async function getJson(path) {
  const r = await fetch(API + path);
  return r.json();
}

// Opens one socket and records every frame with its arrival time. Resolves when the socket closes or the hold ends.
function hold(path, ms, { onFrame, autoPong = true, perMessageDeflate = false, name = path } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const s = { path, name, openMs: null, upgrade: null, frames: 0, bytes: 0, events: {}, pings: [], close: null, error: null, first: null };
    const ws = new WebSocket(WS + path, { perMessageDeflate, autoPong });
    ws.on('upgrade', (res) => (s.upgrade = { status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null }));
    ws.on('unexpected-response', (req, res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        s.error = `http ${res.statusCode} body ${JSON.stringify(b.slice(0, 80))}`;
        finish();
      });
    });
    ws.on('open', () => (s.openMs = Date.now() - t0));
    ws.on('ping', () => s.pings.push(Date.now() - t0));
    ws.on('message', (data) => {
      const at = Date.now();
      const text = data.toString('utf8');
      s.frames++;
      s.bytes += text.length;
      let frame;
      try {
        frame = JSON.parse(text);
      } catch {
        frame = { event: 'non_json' };
      }
      const ev = frame.event ?? (frame.stream ? 'stream:' + frame.stream.split('.').slice(0, 2).join('.') : 'other');
      s.events[ev] = (s.events[ev] ?? 0) + 1;
      if (!s.first) s.first = { ev, ms: at - t0 };
      onFrame?.(frame, text, at);
    });
    ws.on('close', (code, reason) => {
      s.close = { code, reason: reason.toString(), ms: Date.now() - t0 };
      finish();
    });
    ws.on('error', (e) => (s.error = s.error ?? e.message));
    const timer = setTimeout(() => ws.terminate(), ms);
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.heldMs = Date.now() - t0;
      resolve(s);
    }
  });
}

const levelsDesc = (xs) => xs.every((x, i) => i === 0 || x < xs[i - 1]);
const levelsAsc = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
const ordersDesc = (xs) => xs.every((x, i) => i === 0 || x <= xs[i - 1]);
const ordersAsc = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

async function book() {
  const symbols = (await getJson('/api/v3/market/symbols')).result;
  const ticker = await getJson('/api/v3/market/ticker');
  const vol = new Map(ticker.map((t) => [t.symbol, Number(t.quote_volume)]));
  const exchange = symbols.filter((x) => x.status === 'active' && x.source === 'exchange' && x.quote_asset === 'THB').sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0));
  const quiet = exchange[Math.floor(exchange.length / 2)];
  const stopped = symbols.find((x) => x.symbol === 'LTC_THB');
  const broker = symbols.find((x) => x.symbol === 'BTC_USDT');
  const activeIds = new Set(symbols.filter((x) => x.status === 'active').map((x) => x.pairing_id));
  const targets = [
    { role: 'busy', row: symbols.find((x) => x.symbol === 'BTC_THB') },
    { role: 'quiet', row: quiet },
    { role: 'broker', row: broker },
    { role: 'stopped', row: stopped },
  ];
  log('book_targets', { targets: targets.map((t) => `${t.role}:${t.row.symbol}:${t.row.pairing_id}`) });

  const stats = new Map();
  const latestDepth = new Map();
  const runs = targets.map((t) => {
    const st = {
      depth: 0,
      depthLevels: [],
      depthIdentical: 0,
      depthOrderBad: 0,
      depthDupPrice: 0,
      depthGaps: [],
      lastDepthAt: null,
      lastDepthText: null,
      sideChanged: 0,
      sideLen: [],
      sideOrderBad: 0,
      sideDupPrice: 0,
      sideVsDepth: { compared: 0, equal: 0 },
      lastSide: {},
      pairIds: new Set(),
      keys: {},
      tradesInitial: null,
      globalIds: new Set(),
      globalNotActive: new Set(),
      globalAt: [],
      qvCheck: { n: 0, bad: 0 },
      touch: { ticker: 0, tickerEqual: 0, global: 0, globalEqual: 0, sample: null },
    };
    stats.set(t.role, st);
    const pid = t.row.pairing_id;
    return hold(`orderbook/${pid}`, 60_000, {
      name: t.role,
      onFrame: (f, text, at) => {
        st.keys[f.event] = Object.keys(f).join(',');
        if (f.pairing_id !== undefined) st.pairIds.add(f.pairing_id);
        const depthNow = latestDepth.get(t.role)?.at(-1)?.data;
        const touchEqual = (bid, ask) => depthNow && Number(bid) === depthNow.bids[0]?.price && Number(ask) === depthNow.asks[0]?.price;
        if (depthNow && f.event === 'ticker') {
          st.touch.ticker++;
          if (touchEqual(f.data.highestBid, f.data.lowestAsk)) st.touch.tickerEqual++;
          else st.touch.sample = { ticker: [f.data.highestBid, f.data.lowestAsk], depth: [depthNow.bids[0]?.price, depthNow.asks[0]?.price] };
        }
        if (depthNow && f.event === 'global.ticker' && f.data?.id === pid) {
          st.touch.global++;
          if (touchEqual(f.data.highestBid, f.data.lowestAsk)) st.touch.globalEqual++;
        }
        if (f.event === 'global.ticker') {
          st.globalIds.add(f.data?.id);
          if (!activeIds.has(f.data?.id)) st.globalNotActive.add(f.data?.id);
          st.globalAt.push(at);
          if (st.globalAt.length === 1) capture(`book-${t.role}.jsonl`, text);
          return;
        }
        capture(`book-${t.role}.jsonl`, text);
        if (f.event === 'tradeschanged' && st.tradesInitial === null) st.tradesInitial = { bids: f.data?.[1]?.length, asks: f.data?.[2]?.length, trades: f.data?.[0]?.length };
        if (f.event === 'depthchanged') {
          st.depth++;
          const b = f.data.bids.map((l) => l.price);
          const a = f.data.asks.map((l) => l.price);
          st.depthLevels.push([b.length, a.length]);
          if (!levelsDesc(b) || !levelsAsc(a)) st.depthOrderBad++;
          st.depthDupPrice += b.length - new Set(b).size + a.length - new Set(a).size;
          for (const l of [...f.data.bids, ...f.data.asks]) {
            st.qvCheck.n++;
            if (Math.abs(l.price * l.base_volume - l.quote_volume) > Math.max(0.02, l.quote_volume * 1e-6)) st.qvCheck.bad++;
          }
          if (st.lastDepthText === JSON.stringify(f.data)) st.depthIdentical++;
          st.lastDepthText = JSON.stringify(f.data);
          if (st.lastDepthAt) st.depthGaps.push(at - st.lastDepthAt);
          st.lastDepthAt = at;
          const recent = latestDepth.get(t.role) ?? [];
          recent.push({ at, data: f.data });
          latestDepth.set(t.role, recent.slice(-20));
          for (const side of ['bidschanged', 'askschanged']) {
            const last = st.lastSide[side];
            if (!last) continue;
            const depthSide = side === 'bidschanged' ? f.data.bids : f.data.asks;
            st.sideVsDepth.compared++;
            const same = last.every((l, i) => depthSide[i] && depthSide[i].price === l[1] && depthSide[i].base_volume === l[2]);
            if (same) st.sideVsDepth.equal++;
          }
        }
        if (f.event === 'bidschanged' || f.event === 'askschanged') {
          st.sideChanged++;
          st.sideLen.push(f.data.length);
          const prices = f.data.map((l) => l[1]);
          if (f.event === 'bidschanged' ? !ordersDesc(prices) : !ordersAsc(prices)) st.sideOrderBad++;
          st.sideDupPrice += prices.length - new Set(prices).size;
          st.lastSide[f.event] = f.data;
        }
      },
    });
  });

  // Five REST reads of the busy book, each matched against the last twenty depthchanged frames, to see which frame it equals and how old that frame is.
  const compares = [];
  for (let i = 0; i < 5; i++) {
    await sleep(10_000);
    const r = await fetch(`${API}/api/v3/market/depth?sym=btc_thb&lmt=100`);
    const eo = r.headers.get('eo-cache-status');
    const body = (await r.json()).result;
    const landed = Date.now();
    const recent = latestDepth.get('busy') ?? [];
    const score = (d) =>
      body.bids.slice(0, 20).filter((l, k) => d.data.bids[k]?.price === l[0] && d.data.bids[k]?.base_volume === l[1]).length +
      body.asks.slice(0, 20).filter((l, k) => d.data.asks[k]?.price === l[0] && d.data.asks[k]?.base_volume === l[1]).length;
    const scored = recent.map((d) => ({ score: score(d), age: landed - d.at }));
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a), { score: -1, age: null });
    const latest = scored.at(-1);
    compares.push({ eo, latest_frame_age_ms: latest?.age ?? null, latest_frame_top20x2_equal: latest?.score ?? null, best_frame_top20x2_equal: best.score, best_frame_age_ms: best.age });
  }
  const results = await Promise.all(runs);

  for (const s of results) {
    const st = stats.get(s.name);
    const gaps = st.depthGaps;
    const gRate = st.globalAt.length > 1 ? st.globalAt.length / ((st.globalAt.at(-1) - st.globalAt[0]) / 1000) : 0;
    log('book_socket', {
      role: s.name,
      path: s.path,
      upgrade: s.upgrade,
      open_ms: s.openMs,
      first: s.first,
      held_ms: s.heldMs,
      close: s.close,
      error: s.error,
      server_pings: s.pings.length,
      frames: s.frames,
      kb_per_s: round(s.bytes / 1024 / (s.heldMs / 1000)),
      events: s.events,
      pairing_ids_seen: [...st.pairIds],
      trades_initial: st.tradesInitial,
    });
    log('book_depth', {
      role: s.name,
      depthchanged: st.depth,
      levels_min: st.depthLevels.length ? [Math.min(...st.depthLevels.map((x) => x[0])), Math.min(...st.depthLevels.map((x) => x[1]))] : null,
      levels_max: st.depthLevels.length ? [Math.max(...st.depthLevels.map((x) => x[0])), Math.max(...st.depthLevels.map((x) => x[1]))] : null,
      order_bad_frames: st.depthOrderBad,
      duplicate_prices: st.depthDupPrice,
      identical_to_previous: st.depthIdentical,
      gap_ms_median: quantile(gaps, 0.5),
      gap_ms_max: gaps.length ? Math.max(...gaps) : null,
      gaps_under_20ms: gaps.filter((g) => g < 20).length,
      quote_volume_is_price_times_base: `${st.qvCheck.n - st.qvCheck.bad}/${st.qvCheck.n}`,
      side_frames: st.sideChanged,
      side_len_max: st.sideLen.length ? Math.max(...st.sideLen) : null,
      side_order_bad: st.sideOrderBad,
      side_duplicate_prices: st.sideDupPrice,
      side_equal_to_next_depth_prefix: `${st.sideVsDepth.equal}/${st.sideVsDepth.compared}`,
    });
    log('book_touch', { role: s.name, ticker_events_after_first_depth: st.touch.ticker, ticker_touch_equal_to_latest_depth: st.touch.tickerEqual, own_global_ticker_events: st.touch.global, own_global_touch_equal: st.touch.globalEqual, last_mismatch: st.touch.sample });
    log('book_global', { role: s.name, frames: st.globalAt.length, per_s: round(gRate), distinct_ids: st.globalIds.size, ids_not_active: [...st.globalNotActive].slice(0, 10) });
    log('book_keys', { role: s.name, keys: st.keys });
  }
  log('book_rest_compare', { compares });
}

async function streams() {
  const symbols = (await getJson('/api/v3/market/symbols')).result;
  const active = symbols.filter((x) => x.status === 'active');
  const forms = [
    ['ticker_quote_first', 'market.ticker.thb_btc', 8_000],
    ['ticker_base_first', 'market.ticker.btc_thb', 8_000],
    ['ticker_upper', 'market.ticker.THB_BTC', 8_000],
    ['ticker_broker_quote_first', 'market.ticker.usdt_btc', 8_000],
    ['ticker_broker_base_first', 'market.ticker.btc_usdt', 8_000],
    ['ticker_unknown', 'market.ticker.thb_nope', 8_000],
    ['trade_closed_stream', 'market.trade.thb_btc', 8_000],
    ['unknown_service', 'market.nope.thb_btc', 5_000],
    ['orderbook_documented_dot', 'orderbook.1', 5_000],
    ['orderbook_unknown_id', 'orderbook/99999', 8_000],
    ['orderbook_not_numeric', 'orderbook/abc', 5_000],
    ['orderbook_two_ids', 'orderbook/1,orderbook/2', 5_000],
    ['no_stream', '', 5_000],
  ];
  const res = await Promise.all(
    forms.map(([name, path, ms]) =>
      hold(path, ms, {
        name,
        onFrame: (f, text) => capture(`streams-${name}.jsonl`, text),
      }),
    ),
  );
  for (const s of res) log('stream_form', { name: s.name, path: s.path, upgrade: s.upgrade, open_ms: s.openMs, error: s.error, close: s.close, frames: s.frames, events: s.events, first: s.first });

  // Every active pair on ticker URLs. One URL with all of them is refused with 414, so the second attempt splits them in two.
  const names = active.map((x) => `market.ticker.${x.quote_asset.toLowerCase()}_${x.base_asset.toLowerCase()}`);
  const one = await hold(names.join(','), 3_000, { name: 'ticker_all_one_url' });
  log('ticker_all_one_url', { streams: names.length, url_chars: (WS + names.join(',')).length, upgrade: one.upgrade, error: one.error });
  const half = Math.ceil(names.length / 2);
  const heard = new Map();
  const onFrame = (f) => {
    if (f.stream) heard.set(f.stream, (heard.get(f.stream) ?? 0) + 1);
  };
  const parts = await Promise.all([names.slice(0, half), names.slice(half)].map((ns, i) => hold(ns.join(','), 30_000, { name: `ticker_half_${i}`, onFrame })));
  const counts = [...heard.values()];
  for (const p of parts) log('ticker_half', { name: p.name, url_chars: p.path.length + WS.length, upgrade: p.upgrade, error: p.error, close: p.close, frames: p.frames, kb_per_s: round(p.bytes / 1024 / (p.heldMs / 1000)) });
  log('ticker_all', { streams: names.length, seconds: 30, streams_heard: heard.size, per_stream_median: quantile(counts, 0.5), per_stream_max: counts.length ? Math.max(...counts) : null, frames: counts.reduce((a, b) => a + b, 0) });
}

async function fanout() {
  const symbols = (await getJson('/api/v3/market/symbols')).result;
  const ticker = await getJson('/api/v3/market/ticker');
  const vol = new Map(ticker.map((t) => [t.symbol, Number(t.quote_volume)]));
  const top = symbols
    .filter((x) => x.status === 'active' && x.source === 'exchange' && x.quote_asset === 'THB')
    .sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0))
    .slice(0, 8);
  let parseNs = 0n;
  let parsed = 0;
  const res = await Promise.all(
    top.map((row) =>
      hold(`orderbook/${row.pairing_id}`, 30_000, {
        name: row.symbol,
        onFrame: (f, text) => {
          const t = process.hrtime.bigint();
          JSON.parse(text);
          parseNs += process.hrtime.bigint() - t;
          parsed++;
        },
      }),
    ),
  );
  let frames = 0;
  let bytes = 0;
  let global = 0;
  let depth = 0;
  for (const s of res) {
    frames += s.frames;
    bytes += s.bytes;
    global += s.events['global.ticker'] ?? 0;
    depth += s.events.depthchanged ?? 0;
    log('fanout_socket', { sym: s.name, upgrade: s.upgrade?.status, open_ms: s.openMs, error: s.error, close: s.close, frames: s.frames, depthchanged: s.events.depthchanged ?? 0, global: s.events['global.ticker'] ?? 0 });
  }
  log('fanout_total', { sockets: res.length, opened: res.filter((s) => s.openMs !== null).length, seconds: 30, frames_per_s: round(frames / 30), global_share: round(global / frames, 3), depthchanged_per_s: round(depth / 30, 2), kb_per_s: round(bytes / 1024 / 30), parse_us_per_frame: round(Number(parseNs) / 1000 / parsed, 2) });
}

async function silence() {
  const symbols = (await getJson('/api/v3/market/symbols')).result;
  const ticker = await getJson('/api/v3/market/ticker');
  const vol = new Map(ticker.map((t) => [t.symbol, Number(t.quote_volume)]));
  const quietest = symbols
    .filter((x) => x.status === 'active' && x.source === 'exchange' && x.quote_asset === 'THB' && (vol.get(x.symbol) ?? 0) > 0)
    .sort((a, b) => (vol.get(a.symbol) ?? 0) - (vol.get(b.symbol) ?? 0))[0];
  log('silence_target', { sym: quietest.symbol, id: quietest.pairing_id, quote_volume_thb: vol.get(quietest.symbol) });
  const own = [];
  const res = await Promise.all([
    hold(`orderbook/${quietest.pairing_id}`, 120_000, {
      name: 'orderbook_autopong',
      onFrame: (f, text, at) => {
        if (f.event !== 'global.ticker') own.push({ ev: f.event, at });
      },
    }),
    hold(`orderbook/${quietest.pairing_id}`, 120_000, { name: 'orderbook_no_pong', autoPong: false }),
    hold(`market.ticker.${quietest.quote_asset.toLowerCase()}_${quietest.base_asset.toLowerCase()}`, 120_000, { name: 'ticker_quiet' }),
  ]);
  for (const s of res) log('silence_socket', { name: s.name, open_ms: s.openMs, held_ms: s.heldMs, close: s.close, error: s.error, server_pings: s.pings.length, ping_ms: s.pings.slice(0, 6), frames: s.frames, events: s.events });
  const ownGaps = own.slice(1).map((x, i) => x.at - own[i].at);
  log('silence_own_events', { frames: own.length, events: own.reduce((m, x) => ((m[x.ev] = (m[x.ev] ?? 0) + 1), m), {}), longest_gap_ms: ownGaps.length ? Math.max(...ownGaps) : null });
}

async function deflate() {
  const s = await hold('market.ticker.thb_btc', 4_000, { perMessageDeflate: true, name: 'deflate' });
  log('deflate', { offered: 'permessage-deflate', upgrade: s.upgrade, frames: s.frames });
}

// The BTC_THB socket beside a REST depth read every 500 ms with a cache busting parameter, to see whether every book the REST call shows also arrives as a depthchanged frame.
async function sync() {
  const frames = [];
  const t0 = Date.now();
  const sock = hold('orderbook/1', 32_000, {
    name: 'sync',
    onFrame: (f, text, at) => {
      if (f.event === 'depthchanged') frames.push({ at, key: topKey(f.data.bids.map((l) => [l.price, l.base_volume]), f.data.asks.map((l) => [l.price, l.base_volume])) });
    },
  });
  await sleep(1_000);
  const reads = [];
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    const r = await fetch(`${API}/api/v3/market/depth?sym=btc_thb&lmt=10&nocache=${started}`);
    const eo = r.headers.get('eo-cache-status');
    const body = (await r.json()).result;
    reads.push({ sent: started, landed: Date.now(), eo, key: topKey(body.bids, body.asks) });
    await sleep(Math.max(0, 500 - (Date.now() - started)));
  }
  const s = await sock;
  log('sync_socket', { open_ms: s.openMs, first: s.first, first_depthchanged_ms: frames.length ? frames[0].at - t0 : null, events: s.events });
  const restDistinct = new Set(reads.map((x) => x.key)).size;
  let matched = 0;
  const lags = [];
  for (const r of reads) {
    const hit = frames.filter((f) => f.key === r.key);
    if (hit.length) {
      matched++;
      lags.push(hit[0].at - r.sent);
    }
  }
  const restBooks = [...new Set(reads.map((x) => x.key))];
  const wsKeys = new Set(frames.map((f) => f.key));
  log('sync', {
    rest_reads: reads.length,
    rest_cache: reads.reduce((m, x) => ((m[x.eo] = (m[x.eo] ?? 0) + 1), m), {}),
    rest_distinct_books: restDistinct,
    rest_distinct_books_seen_on_ws: restBooks.filter((k) => wsKeys.has(k)).length,
    ws_depthchanged: frames.length,
    ws_distinct_books: wsKeys.size,
    rest_reads_matching_a_ws_frame: matched,
    first_ws_match_minus_rest_send_ms_median: quantile(lags, 0.5),
    first_ws_match_minus_rest_send_ms_min: lags.length ? Math.min(...lags) : null,
    first_ws_match_minus_rest_send_ms_max: lags.length ? Math.max(...lags) : null,
  });
}

function topKey(bids, asks) {
  return JSON.stringify([bids.slice(0, 10), asks.slice(0, 10)]);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, streams, fanout, silence, deflate, sync };
log('start', { mode, at: new Date().toISOString() });
if (modes[mode]) await modes[mode]();
else {
  console.error(`unknown mode ${mode}`);
  process.exitCode = 1;
}
log('end', { at: new Date().toISOString() });
