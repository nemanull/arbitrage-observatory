// Coinstore futures market WebSocket probe: depth frames and their id chain, level order and window, size unit, the index stream (index, mark, funding), a batch of every perpetual on one socket, keepalive, silence, errors, deflate, and the legacy socket.io endpoint.
// The socket is the one the futures web app at futures.coinstore.com uses, since the documented perpetual API was deleted from coinstore-openapi.github.io on 2026-06-12.
// Frames are protobuf wrapped in google.protobuf.Any, and the message schema below is copied from the web app bundle (module 53011, java_package com.qkex.market.common.entity).
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node ../scripts/probes/venues/coinstore/ws-probe.mjs [book|recipe|index|batch|silence|errors|deflate|legacy]
//   book     depth on four perps for 60 s after a REST depthAll, chain check per gear (previousDepthId equal to the last lastDepthId plus one), book kept on the finest gear and compared with REST at the end.
//   recipe   subscribe first, read the REST book after the first frame, bridge on the ids, and compare with REST after 30 s.
//   index    the index stream on every perp for 60 s: cadence, how often each field changes, the mark against its band, and the funding fields against the history.
//   batch    depth on every perp on one socket for 45 s.
//   silence  three sockets that differ only in what the client sends, for up to 110 s.
//   errors   unknown symbol, stream and trade type, a symbol absent from the instrument list, bad JSON, duplicate subscribe, text PING. About 17 s.
//   deflate  offers permessage-deflate once and prints what the server negotiates.
//   legacy   opens the socket.io endpoint the deleted documentation named. About 8 s.
// Set PROBE_OUT_DIR to keep trimmed decoded frames. Recorded in docs/profiles/coinstore/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws-futures.coinstore.com/v1/market';
const LEGACY_URL = 'wss://ws-futures.coinstore.com/socket.io/?EIO=3&transport=websocket';
const API = 'https://futures.coinstore.com/api';
const TT = 'linearPerpetual';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

function capture(name, obj) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n');
}

// Field number to [name, type, repeated], from the web app's protobuf JSON descriptor.
const SCHEMA = {
  BaseWsDTO: { 1: ['tradeType', 'string'], 2: ['symbol', 'string'], 3: ['stream', 'string'], 4: ['data', 'Any', true], 5: ['ts', 'uint64'] },
  Any: { 1: ['type_url', 'string'], 2: ['value', 'bytes'] },
  WsDepthDTO: { 1: ['gear', 'string'], 2: ['bids', 'StringsArray', true], 3: ['asks', 'StringsArray', true], 4: ['previousDepthId', 'uint64'], 5: ['lastDepthId', 'uint64'] },
  StringsArray: { 1: ['strings', 'string', true] },
  WsTradeDTO: { 1: ['id', 'uint64'], 2: ['side', 'string'], 3: ['price', 'string'], 4: ['qty', 'string'], 5: ['time', 'uint64'] },
  WsTicker24hrDTO: { 1: ['priceChange', 'string'], 2: ['priceChangePercent', 'string'], 3: ['lastPrice', 'string'], 4: ['openPrice', 'string'], 5: ['highPrice', 'string'], 6: ['lowPrice', 'string'], 7: ['volume', 'string'], 8: ['quoteVolume', 'string'], 9: ['openTime', 'uint64'], 10: ['closeTime', 'uint64'], 11: ['count', 'uint64'] },
  WsMiniTickerDTO: { 1: ['priceChange', 'string'], 2: ['priceChangePercent', 'string'], 3: ['lastPrice', 'string'], 4: ['volume', 'string'], 5: ['quoteVolume', 'string'], 6: ['count', 'uint64'], 7: ['symbol', 'string'] },
  WsIndexPriceDTO: { 1: ['indexPrice', 'string'], 2: ['markPrice', 'string'], 3: ['tradePrice', 'string'], 5: ['scale', 'uint32'], 6: ['fundingRate', 'string'], 7: ['lastFundingRate', 'string'], 8: ['nextFundRateTime', 'uint64'] },
};

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7n;
  }
}

function decode(type, buf) {
  const schema = SCHEMA[type];
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const no = Number(key >> 3n);
    const wt = Number(key & 7n);
    let raw;
    if (wt === 0) [raw, pos] = readVarint(buf, pos);
    else if (wt === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      raw = buf.subarray(pos, pos + Number(len));
      pos += Number(len);
    } else if (wt === 1) { raw = buf.subarray(pos, pos + 8); pos += 8; }
    else if (wt === 5) { raw = buf.subarray(pos, pos + 4); pos += 4; }
    else throw new Error(`wire type ${wt}`);
    const d = schema?.[no];
    if (!d) { (out._unknown ??= {})[no] = wt === 0 ? raw : wt === 2 ? raw.toString('utf8') : raw.toString('hex'); continue; }
    const [name, t, rep] = d;
    const val = t === 'string' ? raw.toString('utf8') : t === 'bytes' ? raw : t === 'uint64' || t === 'uint32' ? raw : decode(t, raw);
    if (rep) (out[name] ??= []).push(val);
    else out[name] = val;
  }
  return out;
}

// One binary frame to {tradeType, symbol, stream, ts, items: [{type, ...}]}.
function decodeFrame(buf) {
  const base = decode('BaseWsDTO', buf);
  const items = (base.data ?? []).map((any) => {
    const type = any.type_url.split('/').pop();
    const body = SCHEMA[type] ? decode(type, any.value) : { raw: any.value.length };
    if (type === 'WsDepthDTO') {
      body.bids = (body.bids ?? []).map((s) => s.strings ?? []);
      body.asks = (body.asks ?? []).map((s) => s.strings ?? []);
    }
    return { type, ...body };
  });
  return { tradeType: base.tradeType, symbol: base.symbol, stream: base.stream, ts: base.ts, items };
}

const sub = (entries) => JSON.stringify({ event: 'subscribe', data: entries });
const unsub = (entries) => JSON.stringify({ event: 'unsubscribe', data: entries });

function open(url, opts = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false, handshakeTimeout: 10_000 });
    ws.on('upgrade', (res) => { ws.upgradeHeaders = res.headers; });
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ ws: null, status: res.statusCode, body: body.slice(0, 200), ms: Math.round(performance.now() - t0) }));
    });
    ws.on('open', () => resolve({ ws, ms: Math.round(performance.now() - t0) }));
    ws.on('error', (e) => resolve({ ws: null, error: e.message, ms: Math.round(performance.now() - t0) }));
  });
}

async function getJson(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  return { status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, json: JSON.parse(text) };
}

const quantile = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const isDesc = (lv) => lv.every((l, i) => i === 0 || Number(lv[i - 1][0]) > Number(l[0]));
const isAsc = (lv) => lv.every((l, i) => i === 0 || Number(lv[i - 1][0]) < Number(l[0]));

async function instruments() {
  const r = await getJson('/v1/public/web/instruments');
  return r.json.data;
}

async function tickers() {
  const r = await getJson(`/v1/market/ticker/24hr?tradeType=${TT}`);
  return r.json.data;
}

async function book() {
  const inst = await instruments();
  const tk = await tickers();
  const quiet = [...tk].filter((t) => inst.some((i) => i.symbol === t.symbol)).sort((a, b) => a.count - b.count)[0].symbol;
  const symbols = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', quiet];
  const meta = Object.fromEntries(inst.filter((i) => symbols.includes(i.symbol)).map((i) => [i.symbol, i]));
  log('book_symbols', { symbols, quietCount24h: tk.find((t) => t.symbol === quiet).count, ctVal: Object.fromEntries(symbols.map((s) => [s, meta[s].ctVal])), tickSize: Object.fromEntries(symbols.map((s) => [s, meta[s].tickSize])) });

  // REST snapshot first, like the web app, so the first frame's previousDepthId can be compared.
  const rest = {};
  for (const s of symbols) {
    const r = await getJson(`/v1/market/depthAll?tradeType=${TT}&symbol=${s}`);
    rest[s] = Object.fromEntries(r.json.data.map((g) => [g.gear, g]));
    log('rest_depthAll', { symbol: s, ms: r.ms, bytes: r.bytes, gears: r.json.data.map((g) => `${g.gear}:${g.bids.length}b/${g.asks.length}a/id${g.lastDepthId}`) });
  }

  const { ws, ms, error } = await open(WS_URL);
  if (!ws) return log('open_failed', { error, ms });
  log('open', { ms, extensions: ws.upgradeHeaders['sec-websocket-extensions'] ?? null });
  const tSub = performance.now();
  ws.send(sub(symbols.map((s) => ({ tradeType: TT, symbol: s, stream: 'depth' }))));

  const st = {}; // key symbol|gear
  const finest = Object.fromEntries(symbols.map((s) => [s, meta[s].tickSize]));
  const books = Object.fromEntries(symbols.map((s) => [s, { bids: new Map(rest[s][finest[s]].bids.map(([p, q]) => [p, q])), asks: new Map(rest[s][finest[s]].asks.map(([p, q]) => [p, q])) }]));
  const lag = [];
  let texts = 0;
  let bytes = 0;
  let frames = 0;
  let sizeChecks = { multipleOfCtVal: 0, notMultiple: 0, fractional: 0, examples: [] };
  let captured = 0;

  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    if (!isBinary) {
      texts++;
      const t = data.toString();
      if (texts <= 3) log('text', { atMs: Math.round(performance.now() - tSub), frame: t.slice(0, 300) });
      return;
    }
    frames++;
    bytes += data.length;
    const f = decodeFrame(data);
    if (f.ts) lag.push(now - Number(f.ts));
    for (const it of f.items) {
      if (it.type !== 'WsDepthDTO') continue;
      const key = `${f.symbol}|${it.gear}`;
      const s = (st[key] ??= { frames: 0, gaps: 0, first: null, maxBids: 0, maxAsks: 0, zeroSizes: 0, empty: 0, bidsNotDesc: 0, asksNotAsc: 0, arrivals: [], prevLast: null });
      s.frames++;
      s.arrivals.push(now);
      s.maxBids = Math.max(s.maxBids, it.bids.length);
      s.maxAsks = Math.max(s.maxAsks, it.asks.length);
      if (it.bids.length === 0 && it.asks.length === 0) s.empty++;
      if (!isDesc(it.bids)) s.bidsNotDesc++;
      if (!isAsc(it.asks)) s.asksNotAsc++;
      s.zeroSizes += [...it.bids, ...it.asks].filter((l) => Number(l[1]) === 0).length;
      const restId = rest[f.symbol]?.[it.gear]?.lastDepthId;
      if (s.first === null) {
        s.first = { atMs: Math.round(performance.now() - tSub), previousDepthId: it.previousDepthId, lastDepthId: it.lastDepthId, restLastDepthId: restId, chainsOnRest: it.previousDepthId === BigInt(restId) + 1n, bids: it.bids.length, asks: it.asks.length, zero: [...it.bids, ...it.asks].filter((l) => Number(l[1]) === 0).length };
      } else if (it.previousDepthId !== s.prevLast + 1n) {
        s.gaps++;
        if (s.gaps <= 3) log('gap', { key, expected: s.prevLast + 1n, got: it.previousDepthId });
      }
      s.prevLast = it.lastDepthId;
      if (captured < 12 && OUT) { capture('book-frames.jsonl', { ...f, items: [{ ...it, bids: it.bids.slice(0, 4), asks: it.asks.slice(0, 4) }] }); captured++; }
      if (it.gear === finest[f.symbol]) {
        const b = books[f.symbol];
        for (const [p, q] of it.bids) Number(q) === 0 ? b.bids.delete(p) : b.bids.set(p, q);
        for (const [p, q] of it.asks) Number(q) === 0 ? b.asks.delete(p) : b.asks.set(p, q);
        const ct = Number(meta[f.symbol].ctVal);
        for (const [, q] of [...it.bids, ...it.asks]) {
          const n = Number(q);
          if (n === 0) continue;
          const ratio = n / ct;
          if (Math.abs(ratio - Math.round(ratio)) < 1e-6) sizeChecks.multipleOfCtVal++;
          else { sizeChecks.notMultiple++; if (sizeChecks.examples.length < 4) sizeChecks.examples.push(`${f.symbol} ${q} ctVal ${ct}`); }
          if (!Number.isInteger(n)) sizeChecks.fractional++;
        }
      }
    }
  });

  await sleep(60_000);
  const secs = (performance.now() - tSub) / 1000;
  for (const [key, s] of Object.entries(st)) {
    const gapsMs = s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]);
    log('depth_stream', { key, frames: s.frames, gaps: s.gaps, first: s.first, maxBidsPerFrame: s.maxBids, maxAsksPerFrame: s.maxAsks, zeroSizes: s.zeroSizes, emptyFrames: s.empty, bidsNotDesc: s.bidsNotDesc, asksNotAsc: s.asksNotAsc, interArrivalMs: { p50: quantile(gapsMs, 0.5), p90: quantile(gapsMs, 0.9), max: quantile(gapsMs, 1) } });
  }
  log('size_unit', sizeChecks);
  log('throughput', { secs: Math.round(secs), frames, textFrames: texts, framesPerSec: +(frames / secs).toFixed(1), bytesPerSec: Math.round(bytes / secs), lagMs: { p50: quantile(lag, 0.5), p90: quantile(lag, 0.9), min: quantile(lag, 0), max: quantile(lag, 1) } });

  // Compare the kept finest-gear book with a fresh REST read.
  for (const s of symbols) {
    const r = await getJson(`/v1/market/depth?tradeType=${TT}&symbol=${s}&gear=${finest[s]}`);
    const b = books[s];
    const wsBids = [...b.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0]));
    const wsAsks = [...b.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0]));
    const top = (arr, n) => arr.slice(0, n).map(([p, q]) => `${p}@${q}`);
    const eqPrice = (a, c) => a.slice(0, 20).filter((l, i) => c[i] && Number(c[i][0]) === Number(l[0])).length;
    const eqBoth = (a, c) => a.slice(0, 20).filter((l, i) => c[i] && Number(c[i][0]) === Number(l[0]) && Number(c[i][1]) === Number(l[1])).length;
    log('book_vs_rest', { symbol: s, gear: finest[s], wsLevels: `${wsBids.length}b/${wsAsks.length}a`, restLevels: `${r.json.data.bids.length}b/${r.json.data.asks.length}a`, restLastDepthId: r.json.data.lastDepthId, lastWsId: st[`${s}|${finest[s]}`]?.prevLast, top20PriceEq: `${eqPrice(wsBids, r.json.data.bids)}b/${eqPrice(wsAsks, r.json.data.asks)}a`, top20PriceAndSizeEq: `${eqBoth(wsBids, r.json.data.bids)}b/${eqBoth(wsAsks, r.json.data.asks)}a`, wsTop: [top(wsBids, 2), top(wsAsks, 2)], restTop: [r.json.data.bids.slice(0, 2), r.json.data.asks.slice(0, 2)] });
  }
  ws.send(unsub(symbols.map((s) => ({ tradeType: TT, symbol: s, stream: 'depth' }))));
  await sleep(500);
  ws.terminate();
}

// Subscribe first, buffer, read REST after the first frame, then bridge: the first frame applied must have previousDepthId <= restId + 1 <= lastDepthId.
async function recipe() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'BNBUSDT'];
  const inst = await instruments();
  const tick = Object.fromEntries(inst.filter((i) => symbols.includes(i.symbol)).map((i) => [i.symbol, i.tickSize]));
  const { ws, ms } = await open(WS_URL);
  log('open', { ms });
  const st = Object.fromEntries(symbols.map((s) => [s, { buffer: [], book: null, restId: null, last: null, bridged: null, dropped: 0, applied: 0, gaps: 0, fetching: false }]));
  const apply = (s, it) => {
    const b = s.book;
    for (const [p, q] of it.bids) Number(q) === 0 ? b.bids.delete(p) : b.bids.set(p, q);
    for (const [p, q] of it.asks) Number(q) === 0 ? b.asks.delete(p) : b.asks.set(p, q);
    s.last = it.lastDepthId;
    s.applied++;
  };
  const feed = (s, it) => {
    if (s.last === null) {
      if (it.lastDepthId <= s.restId) { s.dropped++; return; }
      const ok = it.previousDepthId <= s.restId + 1n;
      s.bridged = { ok, exact: it.previousDepthId === s.restId + 1n, previousDepthId: it.previousDepthId, restId: s.restId };
      if (!ok) { s.gaps++; return; }
      apply(s, it);
      return;
    }
    if (it.previousDepthId !== s.last + 1n) { s.gaps++; return; }
    apply(s, it);
  };
  ws.on('message', async (data, isBinary) => {
    if (!isBinary) return;
    const f = decodeFrame(data);
    const s = st[f.symbol];
    if (!s) return;
    for (const it of f.items) {
      if (it.gear !== tick[f.symbol]) continue;
      if (s.book === null) {
        s.buffer.push(it);
        if (!s.fetching) {
          s.fetching = true;
          const r = await getJson(`/v1/market/depth?tradeType=${TT}&symbol=${f.symbol}&gear=${tick[f.symbol]}`);
          s.restId = BigInt(r.json.data.lastDepthId);
          s.book = { bids: new Map(r.json.data.bids.map(([p, q]) => [p, q])), asks: new Map(r.json.data.asks.map(([p, q]) => [p, q])) };
          const buffered = s.buffer.splice(0);
          s.bufferedAtRest = buffered.length;
          for (const b of buffered) feed(s, b);
        }
      } else feed(s, it);
    }
  });
  ws.send(sub(symbols.map((s) => ({ tradeType: TT, symbol: s, stream: 'depth' }))));
  await sleep(30_000);
  for (const sym of symbols) {
    const s = st[sym];
    const r = await getJson(`/v1/market/depth?tradeType=${TT}&symbol=${sym}&gear=${tick[sym]}`);
    const wsBids = [...s.book.bids.entries()].sort((x, y) => Number(y[0]) - Number(x[0]));
    const wsAsks = [...s.book.asks.entries()].sort((x, y) => Number(x[0]) - Number(y[0]));
    const eq = (a, c) => a.slice(0, 20).filter((l, i) => c[i] && Number(c[i][0]) === Number(l[0]) && Number(c[i][1]) === Number(l[1])).length;
    log('recipe', { sym, bufferedAtRest: s.bufferedAtRest, dropped: s.dropped, bridged: s.bridged, applied: s.applied, gaps: s.gaps, crossed: Number(wsBids[0][0]) >= Number(wsAsks[0][0]), sameId: String(s.last) === String(r.json.data.lastDepthId), levels: `${wsBids.length}b/${wsAsks.length}a vs REST ${r.json.data.bids.length}b/${r.json.data.asks.length}a`, top20PriceAndSizeEq: `${eq(wsBids, r.json.data.bids)}b/${eq(wsAsks, r.json.data.asks)}a` });
  }
  ws.terminate();
}

async function index() {
  const inst = await instruments();
  const symbols = inst.map((i) => i.symbol);
  const { ws, ms } = await open(WS_URL);
  log('open', { ms, symbols: symbols.length });
  const tSub = performance.now();
  ws.send(sub(symbols.map((s) => ({ tradeType: TT, symbol: s, stream: 'index' }))));
  const st = {};
  let texts = 0;
  let captured = 0;
  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    if (!isBinary) { if (++texts <= 2) log('text', { frame: data.toString().slice(0, 200) }); return; }
    const f = decodeFrame(data);
    for (const it of f.items) {
      if (it.type !== 'WsIndexPriceDTO') { log('other_type', { type: it.type }); continue; }
      const s = (st[f.symbol] ??= { frames: 0, arrivals: [], changes: { indexPrice: 0, markPrice: 0, tradePrice: 0, fundingRate: 0, lastFundingRate: 0, nextFundRateTime: 0 }, prev: null, last: null, markOverIndex: [] });
      s.frames++;
      s.arrivals.push(now);
      if (s.prev) for (const k of Object.keys(s.changes)) if (String(s.prev[k]) !== String(it[k])) s.changes[k]++;
      s.prev = it;
      s.last = { ...it, ts: f.ts };
      if (Number(it.indexPrice) > 0) s.markOverIndex.push(Number(it.markPrice) / Number(it.indexPrice) - 1);
      if (captured < 3 && OUT) { capture('index-frames.jsonl', { ...f, items: [it] }); captured++; }
    }
  });
  await sleep(60_000);
  const secs = (performance.now() - tSub) / 1000;
  const next = {};
  const rows = [];
  let unknownField;
  for (const [sym, s] of Object.entries(st)) {
    const gaps = s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]);
    next[String(s.last.nextFundRateTime)] = (next[String(s.last.nextFundRateTime)] ?? 0) + 1;
    const maxPrem = Math.max(...s.markOverIndex.map(Math.abs));
    unknownField ??= s.last._unknown ?? null;
    rows.push({ sym, frames: s.frames, p50: quantile(gaps, 0.5), max: quantile(gaps, 1), changes: s.changes, maxAbsMarkPremPpm: Math.round(maxPrem * 1e6), last: { index: s.last.indexPrice, mark: s.last.markPrice, trade: s.last.tradePrice, scale: s.last.scale, fr: s.last.fundingRate, lfr: s.last.lastFundingRate } });
  }
  rows.sort((a, b) => a.frames - b.frames);
  const allGaps = Object.values(st).flatMap((s) => s.arrivals.slice(1).map((t, i) => t - s.arrivals[i]));
  log('index_summary', { unknownFieldSample: unknownField, secs: Math.round(secs), symbolsWithFrames: rows.length, of: symbols.length, framesMin: rows[0]?.frames, framesMax: rows.at(-1)?.frames, interArrivalMs: { p50: quantile(allGaps, 0.5), p99: quantile(allGaps, 0.99), max: quantile(allGaps, 1) }, nextFundRateTime: next });
  const ratio = Object.fromEntries(inst.map((i) => [i.symbol, Number(i.markPriceGreaterRatio)]));
  const over = rows.filter((r) => r.maxAbsMarkPremPpm > ratio[r.sym] * 1e6).map((r) => `${r.sym}:${r.maxAbsMarkPremPpm}>${ratio[r.sym] * 1e6}`);
  const top = [...rows].sort((a, b) => b.maxAbsMarkPremPpm - a.maxAbsMarkPremPpm).slice(0, 4).map((r) => `${r.sym}:${r.maxAbsMarkPremPpm} band ${ratio[r.sym] * 1e6}`);
  log('mark_premium_vs_band', { symbolsOverTheirMarkPriceGreaterRatio: over, largest: top });
  for (const r of [...rows.slice(0, 3), ...rows.filter((r) => ['BTCUSDT', 'ETHUSDT', 'XRPUSDT'].includes(r.sym)), ...rows.slice(-2)]) log('index_symbol', r);
  const tot = { indexPrice: 0, markPrice: 0, fundingRate: 0, lastFundingRate: 0, nextFundRateTime: 0 };
  for (const r of rows) for (const k of Object.keys(tot)) tot[k] += r.changes[k] > 0 ? 1 : 0;
  log('symbols_with_any_change', tot);
  const frEqLast = rows.filter((r) => r.last.fr === r.last.lfr).length;
  const markEqIndex = rows.filter((r) => r.last.mark === r.last.index).length;
  const markOverCap = rows.filter((r) => r.maxAbsMarkPremPpm >= 5000).map((r) => `${r.sym}:${r.maxAbsMarkPremPpm}`);
  // Is lastFundingRate the rate settled at the last funding time, and fundingRate the one for nextFundRateTime?
  let lastEqSettled = 0;
  let frEqSettled = 0;
  const detail = [];
  const cmp = rows.filter((r) => r.last.fr !== r.last.lfr || ['BTCUSDT', 'ETHUSDT'].includes(r.sym));
  for (const r of cmp) {
    const h = (await getJson(`/v1/public/funding/web/fundingRate?tradeType=${TT}&symbol=${r.sym}`)).json.data;
    if (Number(h[0].fundingRate) === Number(r.last.lfr)) lastEqSettled++;
    else detail.push(`${r.sym} fr ${r.last.fr} lfr ${r.last.lfr} settled ${h.slice(0, 3).map((e) => `${e.fundingRate}@${new Date(e.fundingTime).toISOString().slice(5, 13)}`).join(' ')}`);
    if (Number(h[0].fundingRate) === Number(r.last.fr)) frEqSettled++;
    await sleep(150);
  }
  log('funding_vs_history', { compared: cmp.length, lastFundingRateEqualsLatestSettled: lastEqSettled, fundingRateEqualsLatestSettled: frEqSettled, mismatches: detail });
  log('index_shape', { fundingRateEqualsLast: frEqLast, markEqualsIndex: markEqIndex, markPremAtLeast5000ppm: markOverCap, distinctFundingRates: [...new Set(rows.map((r) => r.last.fr))].slice(0, 12) });
  ws.terminate();
}

async function batch() {
  const inst = await instruments();
  const symbols = inst.map((i) => i.symbol);
  const { ws, ms } = await open(WS_URL);
  log('open', { ms, symbols: symbols.length });
  const tSub = performance.now();
  ws.send(sub(symbols.map((s) => ({ tradeType: TT, symbol: s, stream: 'depth' }))));
  const perSec = new Map();
  const last = {};
  const seen = new Set();
  let frames = 0;
  let bytes = 0;
  let gaps = 0;
  let decodeNs = 0n;
  let ack = null;
  const pushes = {}; // one entry per distinct lastDepthId per symbol, since every gear of one push shares the id
  ws.on('message', (data, isBinary) => {
    if (!isBinary) { ack ??= data.toString().slice(0, 160); return; }
    frames++;
    bytes += data.length;
    const sec = Math.floor((performance.now() - tSub) / 1000);
    perSec.set(sec, (perSec.get(sec) ?? 0) + 1);
    const t0 = process.hrtime.bigint();
    const f = decodeFrame(data);
    decodeNs += process.hrtime.bigint() - t0;
    const arr = (pushes[f.symbol] ??= []);
    const id = f.items[0]?.lastDepthId;
    if (id !== undefined && arr.at(-1)?.id !== id) arr.push({ id, t: Date.now() });
    for (const it of f.items) {
      const key = `${f.symbol}|${it.gear}`;
      seen.add(f.symbol);
      if (last[key] !== undefined && it.previousDepthId !== last[key] + 1n) gaps++;
      last[key] = it.lastDepthId;
    }
  });
  await sleep(45_000);
  const secs = (performance.now() - tSub) / 1000;
  const rates = [...perSec.values()];
  const cadence = {};
  for (const arr of Object.values(pushes)) {
    const med = quantile(arr.slice(1).map((p, i) => p.t - arr[i].t), 0.5);
    const bucket = med === null ? 'one push' : med < 1_500 ? '~1 s' : med < 3_000 ? '1.5 to 3 s' : med < 6_000 ? '3 to 6 s' : 'over 6 s';
    cadence[bucket] = (cadence[bucket] ?? 0) + 1;
  }
  log('push_cadence_by_symbol', { medianInterPushBySymbol: cadence, pushesMin: Math.min(...Object.values(pushes).map((a) => a.length)), pushesMax: Math.max(...Object.values(pushes).map((a) => a.length)) });
  log('batch', { secs: Math.round(secs), symbols: symbols.length, symbolsDelivering: seen.size, streams: Object.keys(last).length, frames, gaps, framesPerSec: +(frames / secs).toFixed(1), medianPerSec: quantile(rates, 0.5), peakPerSec: quantile(rates, 1), bytesPerSec: Math.round(bytes / secs), bytesPerFrame: Math.round(bytes / frames), decodeUsPerFrame: +(Number(decodeNs) / frames / 1000).toFixed(1), ackStart: ack });
  ws.terminate();
}

async function silence() {
  const inst = await instruments();
  const tk = await tickers();
  const quiet = [...tk].filter((t) => inst.some((i) => i.symbol === t.symbol)).sort((a, b) => a.count - b.count)[0].symbol;
  const cases = [
    { name: 'no_sub_no_ping' },
    { name: 'no_sub_text_PING_10s', ping: true },
    { name: `sub_depth_${quiet}_no_ping`, subscribe: quiet },
  ];
  const t0 = performance.now();
  await Promise.all(cases.map(async (c) => {
    const { ws, ms } = await open(WS_URL);
    const r = { name: c.name, openMs: ms, serverPings: 0, textReplies: [], binary: 0, closedAtS: null, code: null };
    ws.on('ping', () => { r.serverPings++; });
    ws.on('message', (d, isBinary) => { if (isBinary) r.binary++; else if (r.textReplies.length < 3) r.textReplies.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${d.toString().slice(0, 80)}`); });
    const closed = new Promise((res) => ws.on('close', (code) => { r.closedAtS = +((performance.now() - t0) / 1000).toFixed(2); r.code = code; res(); }));
    if (c.subscribe) ws.send(sub([{ tradeType: TT, symbol: c.subscribe, stream: 'depth' }]));
    let timer;
    if (c.ping) { const t1 = performance.now(); timer = setInterval(() => ws.readyState === 1 && ws.send('PING'), 10_000); r.pingStart = Math.round(performance.now() - t1); }
    await Promise.race([closed, sleep(110_000)]);
    clearInterval(timer);
    if (r.closedAtS === null) { r.openAtEndS = 110; ws.terminate(); }
    log('silence', r);
  }));
}

async function errors() {
  const { ws, ms } = await open(WS_URL);
  log('open', { ms });
  const replies = [];
  let binaries = {};
  ws.on('message', (d, isBinary) => {
    if (isBinary) { const f = decodeFrame(d); const k = `${f.symbol}|${f.stream}`; binaries[k] = (binaries[k] ?? 0) + 1; return; }
    replies.push(d.toString().slice(0, 260));
  });
  const tries = [
    ['text PING', 'PING'],
    ['unknown symbol', sub([{ tradeType: TT, symbol: 'NOPEUSDT', stream: 'depth' }])],
    ['unknown stream', sub([{ tradeType: TT, symbol: 'BTCUSDT', stream: 'nope' }])],
    ['unknown tradeType', sub([{ tradeType: 'nope', symbol: 'BTCUSDT', stream: 'depth' }])],
    ['lowercase symbol', sub([{ tradeType: TT, symbol: 'btcusdt', stream: 'trade' }])],
    ['ticker24hr', sub([{ tradeType: TT, symbol: 'BTCUSDT', stream: 'ticker24hr' }])],
    ['duplicate subscribe', sub([{ tradeType: TT, symbol: 'BTCUSDT', stream: 'ticker24hr' }])],
    ['missing symbol', sub([{ tradeType: TT, stream: 'miniTicker' }])],
    ['listed in tickers, absent from instruments', sub([{ tradeType: TT, symbol: 'QNTXUSDT', stream: 'depth' }])],
    ['legacy contract only', sub([{ tradeType: TT, symbol: 'MATICUSDT', stream: 'depth' }])],
    ['not JSON', 'hello{'],
    ['unknown event', JSON.stringify({ event: 'nope', data: [] })],
  ];
  for (const [name, frame] of tries) {
    const before = replies.length;
    const t0 = performance.now();
    ws.send(frame);
    await sleep(1_200);
    log('try', { name, sent: frame.slice(0, 120), replies: replies.slice(before), firstReplyMs: replies.length > before ? '<1200' : null, open: ws.readyState === 1 });
    if (ws.readyState !== 1) break;
  }
  await sleep(2_000);
  log('binary_streams_seen', binaries);
  ws.terminate();
}

async function deflate() {
  const { ws, ms } = await open(WS_URL, { deflate: true });
  log('deflate', { ms, extensions: ws?.upgradeHeaders?.['sec-websocket-extensions'] ?? null, server: ws?.upgradeHeaders?.server ?? null, setCookie: ws?.upgradeHeaders?.['set-cookie'] ? 'present' : null });
  ws?.terminate();
}

async function legacy() {
  const r = await open(LEGACY_URL);
  if (!r.ws) return log('legacy_open', r);
  const frames = [];
  r.ws.on('message', (d) => frames.push(d.toString().slice(0, 200)));
  r.ws.on('close', (code) => frames.push(`close ${code}`));
  await sleep(3_000);
  // Socket.IO v2 text protocol: 42 prefixes an event, and the deleted documentation subscribed topics by contract id.
  if (r.ws.readyState === 1) r.ws.send('42' + JSON.stringify(['subscribe', { header: { type: 1003 }, body: { topics: [{ topic: 'future_snapshot_depth', params: { symbols: [{ symbol: 100300034 }] } }] } }]));
  await sleep(5_000);
  log('legacy_open', { ms: r.ms, frames: frames.slice(0, 6), count: frames.length });
  r.ws.terminate();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, recipe, index, batch, silence, errors, deflate, legacy };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
