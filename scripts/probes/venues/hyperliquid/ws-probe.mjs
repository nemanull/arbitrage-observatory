// Hyperliquid WebSocket probe: the public channels, the l2Book snapshot feed in detail, aggregation parameters, errors, post requests, keepalive, silence, deflate and one socket carrying every main-dex perp.
// Public, unauthenticated and read-only: POST https://api.hyperliquid.xyz/info and wss://api.hyperliquid.xyz/ws only, never /exchange.
// Sockets open with perMessageDeflate false, like the book feeds of the TypeScript server, except the one deflate check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hyperliquid/ws-probe.mjs [book|errors|batch|silence|deflate]
//   book     two sockets for about 65 s: every public market data channel on a handful of coins, then a post request, ping, the l2Book aggregation variants and fast
//   errors   malformed and unknown subscriptions one at a time for about 40 s, opening a new socket whenever a case closes the old one
//   batch    one socket carrying every listed main-dex perp for 60 s, with an optional comma list of l2Book (default), fast and bbo, as in: batch fast,bbo
//   silence  two sockets for 75 s, one that sends nothing and one that only pings every 30 s
//   deflate  offers permessage-deflate once and prints what the server negotiates
// Without server/node_modules, set NODE_PATH to the folder that holds ws in the root pnpm store, as in node_modules/.pnpm/ws@8.21.1_bufferutil@4.1.0/node_modules.
// REST weight per run stays under 100 of the 1,200 per minute the docs allow per IP.
// Set PROBE_OUT_DIR to keep trimmed raw frames.
// Recorded in docs/profiles/hyperliquid/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import zlib from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const INFO_URL = 'https://api.hyperliquid.xyz/info';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (arr) => ({ n: arr.length, min: pct(arr, 0), p10: pct(arr, 10), p50: pct(arr, 50), p90: pct(arr, 90), max: pct(arr, 100) });
const trim = (text, max = 700) => (text.length > max ? text.slice(0, max) + '…' : text);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

let restWeight = 0;
async function info(body, weight) {
  const t0 = performance.now();
  const res = await fetch(INFO_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  restWeight += weight;
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    log('rest_error', { body, status: res.status, ms, text: trim(text, 200) });
    return undefined;
  }
  return { json: JSON.parse(text), ms, bytes: text.length };
}

function open(label, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, ...opts });
  const s = { ws, label, t0, openMs: undefined, pings: [], closed: undefined, headers: undefined, sent: 0 };
  ws.on('upgrade', (res) => (s.headers = res.headers));
  ws.on('unexpected-response', (_req, res) => log('refused', { label, status: res.statusCode, headers: res.headers }));
  ws.on('ping', () => s.pings.push(Math.round((performance.now() - t0) / 1000)));
  ws.on('close', (code, reason) => (s.closed = { atS: Math.round((performance.now() - t0) / 100) / 10, atMs: performance.now() - t0, code, reason: reason.toString() }));
  ws.on('error', (e) => log('socket_error', { label, error: String(e.message) }));
  s.ready = new Promise((resolve) => ws.once('open', () => ((s.openMs = Math.round(performance.now() - t0)), resolve())));
  s.send = (obj) => {
    s.sent += 1;
    ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  };
  return s;
}

const sub = (subscription) => ({ method: 'subscribe', subscription });
const unsub = (subscription) => ({ method: 'unsubscribe', subscription });

// Checks the two side lists of a book frame for order and crossing.
function inspectBook(levels) {
  const [bids, asks] = levels;
  let bidsDesc = true;
  let asksAsc = true;
  for (let i = 1; i < bids.length; i++) if (!(Number(bids[i].px) < Number(bids[i - 1].px))) bidsDesc = false;
  for (let i = 1; i < asks.length; i++) if (!(Number(asks[i].px) > Number(asks[i - 1].px))) asksAsc = false;
  const crossed = bids.length && asks.length ? Number(bids[0].px) >= Number(asks[0].px) : false;
  return { nb: bids.length, na: asks.length, bidsDesc, asksAsc, crossed };
}

// Per key tracker for a snapshot channel: frame count, bytes, push intervals by the venue time, arrival lag, repeats.
function tracker() {
  const m = new Map();
  return {
    m,
    add(key, time, arrivalMs, bytes, fingerprint, extra) {
      let t = m.get(key);
      if (!t) {
        t = { frames: 0, bytes: 0, times: [], lags: [], intervals: [], back: 0, same: 0, repeats: 0, lastTime: undefined, lastFp: undefined, first: arrivalMs, levelCounts: {}, disorder: 0, crossed: 0, empty: 0 };
        m.set(key, t);
      }
      t.frames += 1;
      t.bytes += bytes;
      if (time !== undefined) {
        t.lags.push(arrivalMs - time);
        if (t.lastTime !== undefined) {
          if (time < t.lastTime) t.back += 1;
          else if (time === t.lastTime) t.same += 1;
          else t.intervals.push(time - t.lastTime);
        }
        t.lastTime = time;
        t.times.push(time);
      }
      if (fingerprint !== undefined) {
        if (fingerprint === t.lastFp) t.repeats += 1;
        t.lastFp = fingerprint;
      }
      if (extra) {
        const k = `${extra.nb}/${extra.na}`;
        t.levelCounts[k] = (t.levelCounts[k] ?? 0) + 1;
        if (!extra.bidsDesc || !extra.asksAsc) t.disorder += 1;
        if (extra.crossed) t.crossed += 1;
        if (extra.nb === 0 || extra.na === 0) t.empty += 1;
      }
      return t;
    },
    summary(key) {
      const t = m.get(key);
      if (!t) return { frames: 0 };
      return {
        frames: t.frames,
        bytesPerFrame: Math.round(t.bytes / t.frames),
        intervalMs: stats(t.intervals),
        lagMs: stats(t.lags),
        timeBack: t.back,
        timeSame: t.same,
        identicalRepeats: t.repeats,
        levelCounts: t.levelCounts,
        disorder: t.disorder,
        crossed: t.crossed,
        oneSidedOrEmpty: t.empty,
      };
    },
  };
}

// Tries every decoder Node ships on a base64 payload, so the fastAssetCtxs encoding can be named.
function decodeB64(b64) {
  const buf = Buffer.from(b64, 'base64');
  const head = buf.subarray(0, 4).toString('hex');
  const tries = {
    inflate: () => zlib.inflateSync(buf),
    inflateRaw: () => zlib.inflateRawSync(buf),
    gunzip: () => zlib.gunzipSync(buf),
    brotli: () => zlib.brotliDecompressSync(buf),
    zstd: () => zlib.zstdDecompressSync(buf),
  };
  for (const [name, fn] of Object.entries(tries)) {
    try {
      const out = fn();
      return { head, bytes: buf.length, decoder: name, decodedBytes: out.length, sample: trim(out.toString('utf8'), 300) };
    } catch {}
  }
  return { head, bytes: buf.length, decoder: null, sample: trim(buf.toString('utf8'), 120) };
}

async function catalog() {
  const r = await info({ type: 'metaAndAssetCtxs' }, 20);
  const [meta, ctxs] = r.json;
  const rows = meta.universe.map((u, i) => ({ name: u.name, szDecimals: u.szDecimals, delisted: !!u.isDelisted, onlyIsolated: !!u.onlyIsolated, vlm: Number(ctxs[i]?.dayNtlVlm ?? 0), markPx: ctxs[i]?.markPx, midPx: ctxs[i]?.midPx }));
  const listed = rows.filter((x) => !x.delisted);
  log('catalog', { ms: r.ms, bytes: r.bytes, universe: rows.length, listed: listed.length, delisted: rows.length - listed.length, kPrefixed: listed.filter((x) => /^k[A-Z]/.test(x.name)).map((x) => x.name), noMid: listed.filter((x) => x.midPx == null).map((x) => x.name) });
  return { rows, listed };
}

async function hip3Pick() {
  const r = await info({ type: 'perpDexs' }, 20);
  const dexes = r.json.filter(Boolean).map((d) => d.name);
  log('perp_dexs', { ms: r.ms, count: dexes.length, names: dexes });
  if (!dexes.length) return undefined;
  const dex = dexes[0];
  const m = await info({ type: 'metaAndAssetCtxs', dex }, 20);
  const [meta, ctxs] = m.json;
  const rows = meta.universe.map((u, i) => ({ name: u.name, delisted: !!u.isDelisted, vlm: Number(ctxs[i]?.dayNtlVlm ?? 0) })).filter((x) => !x.delisted);
  rows.sort((a, b) => b.vlm - a.vlm);
  log('hip3_dex', { dex, listed: rows.length, top: rows.slice(0, 5).map((x) => x.name), collateralToken: meta.collateralToken });
  return { dex, coin: rows[0]?.name };
}

async function book() {
  const dns = await lookup('api.hyperliquid.xyz', { all: true });
  log('dns', { addresses: dns.map((a) => a.address) });
  const { rows, listed } = await catalog();
  const byVlm = [...listed].sort((a, b) => b.vlm - a.vlm);
  const mid = byVlm[Math.floor(byVlm.length / 4)];
  const quiet = byVlm.filter((x) => x.midPx != null).at(-1);
  const kCoin = listed.find((x) => x.name === 'kPEPE') ?? listed.find((x) => /^k[A-Z]/.test(x.name));
  const delisted = rows.find((x) => x.delisted);
  const hip3 = await hip3Pick();
  const coins = ['BTC', 'ETH', mid.name, quiet.name, kCoin?.name, delisted?.name, hip3?.coin].filter(Boolean);
  log('coins', { btc: 'BTC', mid: mid.name, midVlm: Math.round(mid.vlm), quiet: quiet.name, quietVlm: Math.round(quiet.vlm), kCoin: kCoin?.name, delisted: delisted?.name, hip3: hip3?.coin });

  const books = tracker();
  const bbos = tracker();
  const channels = new Map();
  const acks = [];
  const errors = [];
  const firstFrame = {};
  const btcBookFrames = [];
  const btcBboTimes = new Set();
  let lastBtcBbo;
  let bookTopMatchesBbo = 0;
  let bookTopBehindBbo = 0;
  const samples = {};
  const fast = { keys: [], btc: 0, undecoded: 0 };
  const ctxChanges = {};

  const main = open('main');
  const onMain = (raw) => {
    const arr = Date.now();
    const text = raw.toString();
    const msg = JSON.parse(text);
    const ch = msg.channel;
    const key = ch === 'l2Book' || ch === 'bbo' || ch === 'activeAssetCtx' || ch === 'activeSpotAssetCtx' ? `${ch}:${msg.data?.coin}` : ch === 'allMids' ? `allMids:${msg.data?.dex ?? Object.keys(msg.data?.mids ?? {}).length}` : ch;
    const c = channels.get(key) ?? { frames: 0, bytes: 0, first: arr, last: arr };
    c.frames += 1;
    c.bytes += text.length;
    c.last = arr;
    channels.set(key, c);
    if (!samples[key]) {
      samples[key] = true;
      capture('main-first.jsonl', trim(text, 1200));
    }
    if (ch === 'subscriptionResponse') acks.push(msg.data);
    else if (ch === 'error') errors.push(msg.data);
    else if (ch === 'l2Book') {
      const d = msg.data;
      firstFrame[d.coin] ??= arr;
      const ins = inspectBook(d.levels);
      books.add(d.coin, d.time, arr, text.length, JSON.stringify(d.levels), ins);
      if (d.coin === 'BTC') {
        btcBookFrames.push({ time: d.time, levels: d.levels });
        if (lastBtcBbo && d.levels[0][0] && d.levels[1][0]) {
          if (lastBtcBbo.bbo[0]?.px === d.levels[0][0].px && lastBtcBbo.bbo[1]?.px === d.levels[1][0].px) bookTopMatchesBbo += 1;
          else if (lastBtcBbo.time > d.time) bookTopBehindBbo += 1;
        }
      }
    } else if (ch === 'bbo') {
      const d = msg.data;
      const fp = JSON.stringify(d.bbo);
      bbos.add(d.coin, d.time, arr, text.length, fp);
      if (d.coin === 'BTC') {
        btcBboTimes.add(d.time);
        lastBtcBbo = d;
      }
    } else if (ch === 'activeAssetCtx') {
      const c = ctxChanges[msg.data.coin] ?? (ctxChanges[msg.data.coin] = { frames: 0, markPx: 0, oraclePx: 0, funding: 0, premium: 0, last: undefined });
      const x = msg.data.ctx;
      c.frames += 1;
      if (c.last) for (const f of ['markPx', 'oraclePx', 'funding', 'premium']) if (x[f] !== c.last[f]) c[f] += 1;
      c.last = x;
    } else if (ch === 'fastAssetCtxs' && typeof msg.data === 'string') {
      try {
        const obj = JSON.parse(zlib.inflateRawSync(Buffer.from(msg.data, 'base64')).toString('utf8'));
        fast.keys.push(Object.keys(obj).length);
        if (obj.BTC) fast.btc += 1;
      } catch {
        fast.undecoded += 1;
      }
    }
    if (ch === 'fastAssetCtxs' && !samples.fastDecoded) {
      samples.fastDecoded = true;
      const payload = typeof msg.data === 'string' ? msg.data : msg.data?.data ?? msg.data;
      log('fast_asset_ctxs_first', { dataType: typeof msg.data, keys: typeof msg.data === 'object' ? Object.keys(msg.data ?? {}) : undefined, decode: typeof payload === 'string' ? decodeB64(payload) : trim(JSON.stringify(payload), 300) });
    }
  };
  main.ws.on('message', onMain);
  await main.ready;
  log('open', { label: 'main', openMs: main.openMs, extensions: main.headers['sec-websocket-extensions'] ?? null, server: main.headers.server, via: main.headers.via ?? null, cache: main.headers['x-cache'] ?? null, amzCf: main.headers['x-amz-cf-pop'] ?? null });
  const tSub = Date.now();
  const subs = [];
  for (const coin of coins) subs.push({ type: 'l2Book', coin });
  subs.push({ type: 'bbo', coin: 'BTC' }, { type: 'bbo', coin: quiet.name }, { type: 'trades', coin: 'BTC' }, { type: 'allMids' });
  if (hip3) subs.push({ type: 'allMids', dex: hip3.dex });
  subs.push({ type: 'activeAssetCtx', coin: 'BTC' }, { type: 'activeAssetCtx', coin: quiet.name });
  if (hip3) subs.push({ type: 'activeAssetCtx', coin: hip3.coin });
  subs.push({ type: 'candle', coin: 'BTC', interval: '1m' }, { type: 'allDexsAssetCtxs' }, { type: 'fastAssetCtxs' });
  for (const s of subs) main.send(sub(s));
  log('subscribed', { label: 'main', streams: subs.length });

  // Second socket: a post request, a ping, the aggregation variants one at a time on BTC, then fast.
  const agg = open('agg');
  const aggLog = [];
  let window = 'setup';
  const aggBooks = tracker();
  const aggSample = {};
  let pongAt;
  agg.ws.on('message', (raw) => {
    const arr = Date.now();
    const text = raw.toString();
    const msg = JSON.parse(text);
    if (msg.channel === 'l2Book') {
      const d = msg.data;
      const ins = inspectBook(d.levels);
      aggBooks.add(window, d.time, arr, text.length, undefined, ins);
      if (!aggSample[window]) {
        const steps = [];
        for (let i = 1; i < Math.min(6, d.levels[0].length); i++) steps.push(+(Number(d.levels[0][i - 1].px) - Number(d.levels[0][i].px)).toPrecision(6));
        aggSample[window] = { top: d.levels.map((side) => side.slice(0, 3).map((l) => `${l.px}x${l.sz}(${l.n})`)), bidSteps: steps };
      }
      return;
    }
    if (msg.channel === 'pong') pongAt = arr;
    if (msg.channel === 'post') {
      const p = msg.data?.response?.payload?.data;
      log('post_reply', { id: msg.data?.id, type: msg.data?.response?.type, payloadType: msg.data?.response?.payload?.type, bytes: text.length, ageAtArrivalMs: p?.time ? arr - p.time : null, levels: p?.levels?.map((x) => x.length) });
      aggLog.push({ window, atMs: arr - tSub, text: trim(text, 300) });
      return;
    }
    aggLog.push({ window, atMs: arr - tSub, text: trim(text, 400) });
    capture('agg.jsonl', trim(text, 1200));
  });
  await agg.ready;
  log('open', { label: 'agg', openMs: agg.openMs });

  window = 'post';
  const tPost = Date.now();
  agg.send({ method: 'post', id: 1, request: { type: 'info', payload: { type: 'l2Book', coin: 'BTC' } } });
  await sleep(2000);
  window = 'ping';
  const tPing = Date.now();
  agg.send({ method: 'ping' });
  await sleep(1500);
  log('ping', { rttMs: pongAt ? pongAt - tPing : null });
  log('post_sent', { atMs: tPost - tSub });

  const variants = [
    ['default', {}],
    ['nSigFigs null', { nSigFigs: null }],
    ['nSigFigs 5', { nSigFigs: 5 }],
    ['nSigFigs 5 mantissa 2', { nSigFigs: 5, mantissa: 2 }],
    ['nSigFigs 5 mantissa 5', { nSigFigs: 5, mantissa: 5 }],
    ['nSigFigs 4', { nSigFigs: 4 }],
    ['nSigFigs 3', { nSigFigs: 3 }],
    ['nSigFigs 2', { nSigFigs: 2 }],
  ];
  for (const [name, params] of variants) {
    const s = { type: 'l2Book', coin: 'BTC', ...params };
    window = `var:${name}`;
    agg.send(sub(s));
    await sleep(4000);
    agg.send(unsub(s));
    window = 'gap';
    await sleep(600);
  }

  // REST snapshot to compare against socket frames by the venue time.
  const rest = await info({ type: 'l2Book', coin: 'BTC' }, 2);
  const restArrival = Date.now();
  const restBook = rest.json;
  const same = btcBookFrames.find((f) => f.time === restBook.time);
  const nearest = btcBookFrames.reduce((best, f) => (!best || Math.abs(f.time - restBook.time) < Math.abs(best.time - restBook.time) ? f : best), undefined);
  const cmp = (f) => {
    if (!f) return null;
    let eq = 0;
    let total = 0;
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < Math.max(f.levels[side].length, restBook.levels[side].length); i++) {
        total += 1;
        const a = f.levels[side][i];
        const b = restBook.levels[side][i];
        if (a && b && a.px === b.px && a.sz === b.sz && a.n === b.n) eq += 1;
      }
    }
    return { socketTime: f.time, equalLevels: eq, of: total };
  };
  const framesBefore = btcBookFrames.length;
  await sleep(6000);
  const next = btcBookFrames[framesBefore];
  log('rest_compare', { restMs: rest.ms, restAgeAtArrivalMs: restArrival - restBook.time, nextSocketTimeMinusRestTime: next ? next.time - restBook.time : null, nextSocket: cmp(next), restTime: restBook.time, restLevels: restBook.levels.map((s) => s.length), exactTimeMatch: cmp(same), nearest: cmp(nearest), restTop: restBook.levels.map((s) => s.slice(0, 2)) });

  window = 'var:fast';
  agg.send(sub({ type: 'l2Book', coin: 'BTC', fast: true }));
  await sleep(14000);
  window = 'end';

  const elapsedS = (Date.now() - tSub) / 1000;
  log('agg_log', { entries: aggLog });
  for (const [name] of [...variants, ['fast']]) log('variant', { name, ...aggBooks.summary(`var:${name}`), sample: aggSample[`var:${name}`] });

  log('acks', { count: acks.length, first: acks[0], errors });
  for (const coin of coins) log('l2Book', { coin, firstFrameMs: firstFrame[coin] ? firstFrame[coin] - tSub : null, ...books.summary(coin) });
  for (const coin of ['BTC', quiet.name]) log('bbo', { coin, ...bbos.summary(coin) });
  const btcBookTimes = btcBookFrames.map((f) => f.time);
  log('btc_book_vs_bbo', { bookFrames: btcBookTimes.length, bookTimesAlsoInBbo: btcBookTimes.filter((t) => btcBboTimes.has(t)).length, bookTopEqualsLatestBbo: bookTopMatchesBbo, bboNewerThanBookAndDifferent: bookTopBehindBbo });
  const perS = {};
  for (const [key, c] of channels) perS[key] = { frames: c.frames, perSecond: +(c.frames / elapsedS).toFixed(2), meanGapMs: c.frames > 1 ? Math.round((c.last - c.first) / (c.frames - 1)) : null, bytesPerFrame: Math.round(c.bytes / c.frames) };
  log('channels', { elapsedS: Math.round(elapsedS), perS });
  for (const [coin, c] of Object.entries(ctxChanges)) log('active_asset_ctx_changes', { coin, frames: c.frames, changedFromPrevious: { markPx: c.markPx, oraclePx: c.oraclePx, funding: c.funding, premium: c.premium } });
  log('fast_asset_ctxs', { frames: fast.keys.length, keysPerFrame: stats(fast.keys), framesWithBtc: fast.btc, undecoded: fast.undecoded });
  log('sockets', { main: { pings: main.pings, closed: main.closed, sent: main.sent }, agg: { pings: agg.pings, closed: agg.closed, sent: agg.sent }, restWeight });
  main.ws.close();
  agg.ws.close();
}

// One case at a time on a socket that is replaced whenever a case closes it, because an unknown coin closes the whole socket.
async function errors() {
  const { listed } = await catalog();
  const hip3 = await hip3Pick();
  const delisted = (await info({ type: 'meta' }, 20)).json.universe.find((u) => u.isDelisted)?.name;
  const cases = [
    ['unknown type', sub({ type: 'nope', coin: 'BTC' })],
    ['unsubscribe never subscribed', unsub({ type: 'l2Book', coin: 'DOGE' })],
    ['not json', 'hello'],
    ['unknown method', { method: 'nope' }],
    ['subscribe without subscription', { method: 'subscribe' }],
    ['coin array', sub({ type: 'bbo', coin: ['BTC', 'ETH'] })],
    ['duplicate first', sub({ type: 'l2Book', coin: 'SOL' })],
    ['duplicate second', sub({ type: 'l2Book', coin: 'SOL' })],
    ['delisted coin bbo', sub({ type: 'bbo', coin: delisted })],
    ['spot pair coin', sub({ type: 'l2Book', coin: 'PURR/USDC' })],
    ['spot index coin', sub({ type: 'l2Book', coin: '@107' })],
    ['nSigFigs 6', sub({ type: 'l2Book', coin: 'ETH', nSigFigs: 6 })],
    ['mantissa without 5', sub({ type: 'l2Book', coin: 'ETH', nSigFigs: 4, mantissa: 2 })],
    ['unknown coin bbo', sub({ type: 'bbo', coin: 'NOPE' })],
    ['unknown coin l2Book', sub({ type: 'l2Book', coin: 'NOPE' })],
    ['lowercase coin', sub({ type: 'l2Book', coin: 'btc' })],
    ['hip3 upper dex', hip3 ? sub({ type: 'l2Book', coin: hip3.coin.replace(/^[^:]+/, (x) => x.toUpperCase()) }) : undefined],
    ['hip3 bare name', hip3 ? sub({ type: 'l2Book', coin: hip3.coin.split(':')[1] }) : undefined],
    ['post unknown coin', { method: 'post', id: 7, request: { type: 'info', payload: { type: 'l2Book', coin: 'NOPE' } } }],
    ['post without id', { method: 'post', request: { type: 'info', payload: { type: 'l2Book', coin: 'BTC' } } }],
  ];
  const isData = (x) => x.startsWith('{"channel":"l2Book"') || x.startsWith('{"channel":"bbo"');
  let s;
  let got = [];
  let sockets = 0;
  const results = [];
  for (const [name, frame] of cases) {
    if (!frame) continue;
    if (!s || s.closed) {
      if (sockets) await sleep(1500);
      s = open(`err${sockets}`);
      sockets += 1;
      s.ws.on('message', (raw) => got.push(trim(raw.toString(), 300)));
      await s.ready;
      await sleep(300);
      got = [];
    }
    const t = performance.now() - s.t0;
    s.send(frame);
    await sleep(1200);
    results.push({ name, sent: trim(typeof frame === 'string' ? frame : JSON.stringify(frame), 160), replies: got.filter((x) => !isData(x)).slice(0, 3), dataFrames: got.filter(isData).length, closed: s.closed ? { afterMs: Math.round(s.closed.atMs - t), code: s.closed.code } : null });
    capture('errors.jsonl', JSON.stringify(results.at(-1)));
    got = [];
  }
  for (const r of results) log('error_case', r);
  log('sockets', { opened: sockets, restWeight, listed: listed.length });
  if (s && !s.closed) s.ws.close();
}

// kinds is a comma list of l2Book, fast and bbo, where fast is l2Book with fast true, and l2Book and fast cannot share a socket because their frames look alike.
async function batch() {
  const kinds = (process.argv[3] ?? 'l2Book').split(',');
  if (kinds.includes('l2Book') && kinds.includes('fast')) throw new Error('l2Book and fast frames cannot be told apart on one socket');
  const bookKind = kinds.find((k) => k === 'l2Book' || k === 'fast');
  const { listed } = await catalog();
  const coins = listed.map((x) => x.name);
  const per = Object.fromEntries(kinds.map((k) => [k, { books: tracker(), frames: 0, bytes: 0, parseNs: 0n, perSecond: new Map(), timesCount: new Map() }]));
  const acked = new Set();
  const errors = [];
  let allFrames = 0;
  let allBytes = 0;
  let allParseNs = 0n;
  const s = open('batch');
  let tStart;
  s.ws.on('message', (raw) => {
    const arr = Date.now();
    const text = raw.toString();
    const p0 = process.hrtime.bigint();
    const msg = JSON.parse(text);
    const dt = process.hrtime.bigint() - p0;
    allFrames += 1;
    allBytes += text.length;
    allParseNs += dt;
    if (msg.channel === 'subscriptionResponse') {
      acked.add(`${msg.data?.subscription?.type}:${msg.data?.subscription?.coin}`);
      return;
    }
    if (msg.channel === 'error') {
      errors.push(trim(String(msg.data), 200));
      return;
    }
    const kind = msg.channel === 'l2Book' ? bookKind : msg.channel === 'bbo' ? 'bbo' : undefined;
    if (!kind) return;
    const k = per[kind];
    k.frames += 1;
    k.bytes += text.length;
    k.parseNs += dt;
    const sec = Math.floor((arr - tStart) / 1000);
    k.perSecond.set(sec, (k.perSecond.get(sec) ?? 0) + 1);
    const d = msg.data;
    k.timesCount.set(d.time, (k.timesCount.get(d.time) ?? 0) + 1);
    const levels = kind === 'bbo' ? [d.bbo[0] ? [d.bbo[0]] : [], d.bbo[1] ? [d.bbo[1]] : []] : d.levels;
    k.books.add(d.coin, d.time, arr, text.length, JSON.stringify(levels), inspectBook(levels));
  });
  await s.ready;
  log('open', { label: 'batch', openMs: s.openMs, coins: coins.length, kinds });
  tStart = Date.now();
  let n = 0;
  for (const kind of kinds) {
    for (const coin of coins) {
      s.send(sub(kind === 'bbo' ? { type: 'bbo', coin } : kind === 'fast' ? { type: 'l2Book', coin, fast: true } : { type: 'l2Book', coin }));
      n += 1;
      if (n % 20 === 0) await sleep(100);
    }
  }
  const subDoneMs = Date.now() - tStart;
  await sleep(5000);
  // Measure over a clean 60 s window that starts after every first snapshot had time to land.
  const snap = Object.fromEntries(kinds.map((kind) => [kind, { frames: per[kind].frames, bytes: per[kind].bytes, parseNs: per[kind].parseNs, coinFrames: new Map([...per[kind].books.m].map(([c, t]) => [c, t.frames])) }]));
  const all0 = { frames: allFrames, bytes: allBytes, parseNs: allParseNs };
  const w0 = Date.now();
  const cpu0 = process.cpuUsage();
  await sleep(60000);
  const secs = (Date.now() - w0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const firstSec = Math.floor((w0 - tStart) / 1000);
  const wf = allFrames - all0.frames;
  log('batch_socket', {
    coins: coins.length,
    kinds,
    streams: n,
    acked: acked.size,
    errorCount: errors.length,
    errors: errors.slice(0, 5),
    subscribeFramesMs: subDoneMs,
    windowS: +secs.toFixed(1),
    framesPerSecond: +(wf / secs).toFixed(1),
    kbPerSecond: +((allBytes - all0.bytes) / secs / 1024).toFixed(1),
    parseUsPerFrame: +(Number(allParseNs - all0.parseNs) / 1000 / wf).toFixed(1),
    cpuUserMsPerS: +(cpu.user / 1000 / secs).toFixed(1),
    cpuSystemMsPerS: +(cpu.system / 1000 / secs).toFixed(1),
  });
  for (const kind of kinds) {
    const k = per[kind];
    const z = snap[kind];
    const kf = k.frames - z.frames;
    const rates = [...k.perSecond.entries()].filter(([sec]) => sec >= firstSec && sec < firstSec + 60).map(([, v]) => v);
    const perCoin = coins.map((c) => ({ c, ...k.books.summary(c) }));
    const allIntervals = [];
    const allLags = [];
    let back = 0;
    let same = 0;
    let repeats = 0;
    let disorder = 0;
    let crossed = 0;
    const levelHist = {};
    for (const [, t] of k.books.m) {
      allIntervals.push(...t.intervals);
      allLags.push(...t.lags);
      back += t.back;
      same += t.same;
      repeats += t.repeats;
      disorder += t.disorder;
      crossed += t.crossed;
      for (const [key, v] of Object.entries(t.levelCounts)) levelHist[key] = (levelHist[key] ?? 0) + v;
    }
    const framesPerCoinPerS = perCoin.filter((x) => x.frames).map((x) => +((k.books.m.get(x.c).frames - (z.coinFrames.get(x.c) ?? 0)) / secs).toFixed(2));
    const distinctTimes = [...k.timesCount.keys()].sort((a, b) => a - b);
    const timeGaps = [];
    for (let i = 1; i < distinctTimes.length; i++) timeGaps.push(distinctTimes[i] - distinctTimes[i - 1]);
    const topLevels = Object.entries(levelHist).sort((a, b) => b[1] - a[1]).slice(0, 6);
    log('batch_kind', {
      kind,
      framesPerSecond: +(kf / secs).toFixed(1),
      perSecondDist: stats(rates),
      kbPerSecond: +((k.bytes - z.bytes) / secs / 1024).toFixed(1),
      bytesPerFrame: Math.round((k.bytes - z.bytes) / kf),
      parseUsPerFrame: +(Number(k.parseNs - z.parseNs) / 1000 / kf).toFixed(1),
      silentCoins: perCoin.filter((x) => !x.frames).map((x) => x.c),
      framesPerCoinPerS: stats(framesPerCoinPerS),
      busiest: perCoin.filter((x) => x.frames).sort((a, b) => b.frames - a.frames).slice(0, 3).map((x) => `${x.c}:${x.frames}`),
      quietest: perCoin.filter((x) => x.frames).sort((a, b) => a.frames - b.frames).slice(0, 5).map((x) => `${x.c}:${x.frames}`),
      pushIntervalMs: stats(allIntervals),
      lagMs: stats(allLags),
      timeBackwards: back,
      timeRepeated: same,
      identicalRepeats: repeats,
      repeatCoins: perCoin.filter((x) => x.identicalRepeats).sort((a, b) => b.identicalRepeats - a.identicalRepeats).slice(0, 6).map((x) => `${x.c}:${x.identicalRepeats}/${x.frames}`),
      disorder,
      crossed,
      topLevelCounts: topLevels,
      frames: perCoin.reduce((a, x) => a + (x.frames ?? 0), 0),
      oneSidedOrEmptyCoins: perCoin.filter((x) => x.oneSidedOrEmpty).map((x) => `${x.c}:${x.oneSidedOrEmpty}`).slice(0, 10),
      distinctTimes: distinctTimes.length,
      distinctTimeGapMs: stats(timeGaps),
      coinsPerDistinctTime: stats([...k.timesCount.values()]),
    });
  }
  log('sockets', { batch: { pings: s.pings, closed: s.closed, sent: s.sent }, restWeight });
  s.ws.close();
}

async function silence() {
  const a = open('silent');
  const b = open('pinger');
  const pongs = [];
  const other = [];
  b.ws.on('message', (raw) => {
    const text = raw.toString();
    if (text.includes('"pong"')) pongs.push({ atS: Math.round((performance.now() - b.t0) / 1000), text });
    else other.push(trim(text, 200));
  });
  a.ws.on('message', (raw) => other.push(trim(raw.toString(), 200)));
  await Promise.all([a.ready, b.ready]);
  const timer = setInterval(() => b.ws.readyState === 1 && b.send({ method: 'ping' }), 30000);
  await sleep(75000);
  clearInterval(timer);
  log('silence', {
    silent: { openMs: a.openMs, protocolPingsAtS: a.pings, closed: a.closed },
    pinger: { openMs: b.openMs, protocolPingsAtS: b.pings, closed: b.closed, pongs, sent: b.sent },
    otherFrames: other.slice(0, 5),
  });
  a.ws.close();
  b.ws.close();
}

async function deflate() {
  const s = open('deflate', { perMessageDeflate: true });
  const frames = [];
  s.ws.on('message', (raw) => frames.push(raw.length));
  await s.ready;
  s.send(sub({ type: 'l2Book', coin: 'BTC' }));
  await sleep(3000);
  log('deflate', { openMs: s.openMs, offered: 'permessage-deflate', negotiated: s.headers['sec-websocket-extensions'] ?? null, status: 'open', frames: frames.length, headers: Object.keys(s.headers) });
  s.ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, errors, batch, silence, deflate };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('done', { mode, at: new Date().toISOString() });
setTimeout(() => process.exit(0), 500);
