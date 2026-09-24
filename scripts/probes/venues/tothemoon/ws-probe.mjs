// Tothemoon Octopus WebSocket probe: hosts, instrument catalog, perpetual book channel, ticker anchor fields, errors and silence.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/tothemoon/ws-probe.mjs <mode>
//   hosts    DNS and handshake of the documented and the web app Octopus hosts, and one permessage-deflate offer. About 15 s.
//   catalog  turboFutureInstruments.*, photonInstruments.* and turboEmergencyMode.*, compared with REST get-trade-pairs. About 8 s.
//   book     contractsOrderbookVolumes on all 13 perpetuals, the turbo twin on two, and contractsTickers for best bid and ask. 45 s.
//   anchor   turboTickers.* on every perpetual, compared three times with Gate's futures index for the same coin. 45 s.
//   errors   unknown symbols and channels, bad frames, duplicate subscriptions, a protocol ping. About 15 s.
//   silence  one socket that sends nothing and one subscribed to a quiet book that sends nothing, up to 120 s.
//   record   every frame of the BTC and ETH books and tickers for 45 s into PROBE_OUT_DIR/record.jsonl, for offline replay.
//   replay   offline, no socket: replays capture files given as arguments under three apply rules, see replay() below.
// Set PROBE_OUT_DIR to keep raw frames, capped at 4 MB per file. Recorded in docs/profiles/tothemoon/websocket.md and rest.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_WEB = 'wss://octopus-prod-ws.cryptology.com/v1/connect'; // the host the tothemoon.com web app uses
const URL_DOC = 'wss://octopus.tothemoon.com/v1/connect'; // the host docs.tothemoon.com names
const URL_LEGACY = 'wss://octopus.cryptology.com/v1/connect';
const URL_SANDBOX = 'wss://octopus-sandbox.tothemoon.com/v1/connect';
const REST = 'https://api.tothemoon.com/v1/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const SUB_GAP_MS = 250; // 4 subscribe frames a second, under the documented 10 requests a second
const SENT = {};
const PERPS = ['ADA', 'ATOM', 'AVAX', 'BCH', 'BTC', 'DOGE', 'DOT', 'ETC', 'ETH', 'LTC', 'SOL', 'UNI', 'XAU'].map((b) => `${b}_USDT_PERPETUAL`);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const f = join(OUT, name);
  try { if (statSync(f).size > 4e6) return; } catch {}
  appendFileSync(f, text + '\n');
}

function open(url, { deflate = false, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, { perMessageDeflate: deflate, handshakeTimeout: timeoutMs });
    const info = { url, t0 };
    ws.on('upgrade', (res) => { info.status = res.statusCode; info.extensions = res.headers['sec-websocket-extensions'] ?? null; info.server = res.headers.server ?? null; });
    ws.on('unexpected-response', (req, res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ ...info, ok: false, status: res.statusCode, body: b.slice(0, 200), ms: Date.now() - t0 }));
    });
    ws.on('error', (e) => resolve({ ...info, ok: false, error: e.message, ms: Date.now() - t0 }));
    ws.on('open', () => resolve({ ...info, ok: true, ws, openMs: Date.now() - t0 }));
  });
}

const send = (ws, o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
const sub = (channel, id, params) => ({ type: 'subscribe', channel, request_id: id ?? channel, ...(params ? { params } : {}) });

async function hosts() {
  for (const h of ['octopus.tothemoon.com', 'octopus-prod-ws.cryptology.com', 'octopus.cryptology.com', 'octopus-sandbox.tothemoon.com', 'contracts-api.tothemoon.com', 'contracts-api.cryptology.com']) {
    try { const a = await lookup(h, { all: true }); log('dns', { h, addrs: a.map((x) => x.address) }); } catch (e) { log('dns', { h, error: e.code }); }
  }
  for (const url of [URL_DOC, URL_SANDBOX, URL_WEB, URL_LEGACY]) {
    const r = await open(url);
    if (!r.ok) { log('open', { url, ok: false, status: r.status, error: r.error, body: r.body, ms: r.ms }); continue; }
    const first = await new Promise((res) => { r.ws.once('message', (d) => res({ s: d.toString(), at: Date.now() })); setTimeout(() => res(null), 3000); });
    let skew = null;
    try { skew = first.at - JSON.parse(first.s).server_timestamp; } catch {}
    log('open', { url, ok: true, openMs: r.openMs, status: r.status, extensions: r.extensions, server: r.server, recvMinusServerMs: skew, welcome: first?.s.slice(0, 300) });
    r.ws.terminate();
    await sleep(500);
  }
  const d = await open(URL_WEB, { deflate: true });
  log('deflate_offer', { ok: d.ok, extensions: d.extensions ?? null });
  d.ws?.terminate();
  for (const u of ['https://octopus-prod-ws.cryptology.com/', 'https://octopus-prod-ws.cryptology.com/v1/connect']) {
    const t = Date.now();
    try { const r = await fetch(u); const b = await r.text(); log('http', { u, status: r.status, ms: Date.now() - t, body: b.slice(0, 120) }); } catch (e) { log('http', { u, error: e.message }); }
  }
}

async function collect(url, frames, durMs, onMsg, onOpen) {
  const r = await open(url);
  if (!r.ok) { log('open_failed', r); return null; }
  const ws = r.ws;
  let welcome = null;
  ws.on('message', (d) => {
    const s = d.toString();
    const at = Date.now();
    let m;
    try { m = JSON.parse(s); } catch { onMsg?.({ raw: s }, at, s); return; }
    if (m.type === 'welcomeMessage') { welcome = { at, m }; }
    onMsg?.(m, at, s);
  });
  ws.on('ping', () => log('server_ping', { url }));
  ws.on('close', (c, why) => log('close', { code: c, reason: why.toString().slice(0, 100) }));
  onOpen?.(ws);
  const t = Date.now();
  for (const f of frames) { SENT[f.request_id] = Date.now(); send(ws, f); await sleep(SUB_GAP_MS); }
  await sleep(Math.max(0, durMs - (Date.now() - t)));
  ws.terminate();
  return { openMs: r.openMs, welcome };
}

async function catalog() {
  let fut, spot, emerg, retrieved;
  await collect(URL_WEB, [sub('turboFutureInstruments.*', 'f'), sub('photonInstruments.*', 's'), sub('turboEmergencyMode.*', 'e'), { type: 'retrieve', channel: 'turboFutureInstruments.*', request_id: 'rf' }], 8000, (m, at, s) => {
    if (m.type === 'subscriptionData' && m.request_id === 'f') fut = m.payload.data;
    if (m.type === 'subscriptionData' && m.request_id === 's') spot = m.payload.data;
    if (m.type === 'subscriptionData' && m.request_id === 'e') emerg = m.payload.data;
    if (m.request_id === 'rf') retrieved = s.slice(0, 200);
    capture('catalog.jsonl', s);
  });
  const inst = Object.values(fut?.instruments ?? {});
  log('futures', { count: inst.length, enabled: inst.filter((i) => i.is_enabled).length, fields: Object.keys(inst[0] ?? {}) });
  for (const i of inst) log('perp', { id: i.instrument_id, pair: i.pair, cs: i.contract_size, step: i.price_step, rev: i.reversed, fundOff: i.funding_disabled, exp: i.expiration_date, margin: i.margin_currency, cc: i.contract_currency, en: i.is_enabled });
  const byFlag = (k) => inst.reduce((a, i) => ((a[String(i[k])] = (a[String(i[k])] ?? 0) + 1), a), {});
  log('perp_flags', { reversed: byFlag('reversed'), funding_disabled: byFlag('funding_disabled'), margin: byFlag('margin_currency'), expiration: byFlag('expiration_date') });
  const em = emerg?.enabled_for_instruments ?? {};
  log('emergency', { system: emerg?.enabled_for_system, instruments: Object.keys(em).length, on: Object.entries(em).filter(([, v]) => v).map(([k]) => k), notInCatalog: Object.keys(em).filter((k) => !fut?.instruments?.[k]) });
  const sp = Object.values(spot?.instruments ?? {});
  const byCounter = sp.reduce((a, i) => ((a[i.counter] = (a[i.counter] ?? 0) + 1), a), {});
  log('spot_ws', { count: sp.length, enabled: sp.filter((i) => i.is_enabled).length, byCounter, feeFields: [...new Set(sp.map((i) => `${i.maker_fee}/${i.taker_fee}`))].slice(0, 5) });
  const rest = await (await fetch(`${REST}/get-trade-pairs`)).json();
  const restIds = new Set(rest.data.map((p) => p.trade_pair));
  const wsIds = new Set(sp.map((i) => i.pair));
  log('spot_rest_vs_ws', { rest: restIds.size, ws: wsIds.size, onlyRest: [...restIds].filter((x) => !wsIds.has(x)).slice(0, 10), onlyWs: [...wsIds].filter((x) => !restIds.has(x)).slice(0, 10), perpPairsOnSpot: inst.filter((i) => restIds.has(i.pair)).length });
  log('retrieve_reply', { retrieved });
}

function bookStats() {
  return { frames: 0, firstAt: 0, first: null, lastNonce: 0, nonceGaps: 0, firstNonce: null, zeros: 0, entries: 0, ext: 0, bids: new Map(), asks: new Map(), maxB: 0, maxA: 0, crossed: 0, offs: [], maxOff: 0, late: [], lagBig: [], lagSmall: [], ts: [], ages: [], sizeChecks: [], stray: 0, lastAt: 0, maxGap: 0, tickerCmp: { n: 0, bidEq: 0, askEq: 0 }, bytes: 0 };
}

function applySide(map, side) {
  let z = 0;
  for (const [p, v] of Object.entries(side ?? {})) {
    const n = Number(v);
    if (n === 0) { z++; map.delete(p); } else map.set(p, n);
  }
  return z;
}

const best = (map, desc) => { let b = null; for (const p of map.keys()) { const x = Number(p); if (b === null || (desc ? x > b : x < b)) b = x; } return b; };

async function book() {
  const st = {};
  const tick = {};
  const cs = {};
  const frames = [sub('turboFutureInstruments.*', 'f')];
  for (const id of PERPS) frames.push(sub(`contractsOrderbookVolumes.${id}`, `b:${id}`));
  frames.push(sub('turboOrderbookVolumes.BTC_USDT_PERPETUAL', 't:BTC_USDT_PERPETUAL'));
  frames.push(sub('turboOrderbookVolumes.ETH_USDT_PERPETUAL', 't1:ETH_USDT_PERPETUAL', { rate_limit: 1 }));
  for (const id of PERPS) frames.push(sub(`contractsTickers.${id}`, `k:${id}`));
  let total = 0, totalBytes = 0, parseUs = 0, t0 = 0, acks = 0;
  const DUR = 45000;
  const res = await collect(URL_WEB, frames, DUR, (m, at, s) => {
    if (!t0) t0 = at;
    total++; totalBytes += s.length;
    const p0 = process.hrtime.bigint(); JSON.parse(s); parseUs += Number(process.hrtime.bigint() - p0) / 1000;
    if (m.type === 'subscribedSuccessful') { acks++; return; }
    if (m.type !== 'subscriptionData') { log('other', { s: s.slice(0, 200) }); return; }
    const rid = m.request_id;
    const d = m.payload.data;
    if (rid === 'f') { for (const i of Object.values(d.instruments)) cs[i.instrument_id] = Number(i.contract_size); return; }
    if (rid.startsWith('k:')) {
      const id = rid.slice(2);
      tick[id] = { bid: Number(d.best_bid), ask: Number(d.best_ask), n: (tick[id]?.n ?? 0) + 1 };
      const b = st[`b:${id}`];
      if (b && b.frames > 0 && d.best_bid !== undefined) {
        b.tickerCmp.n++;
        if (best(b.bids, true) === Number(d.best_bid)) b.tickerCmp.bidEq++;
        if (best(b.asks, false) === Number(d.best_ask)) b.tickerCmp.askEq++;
      }
      return;
    }
    const x = (st[rid] ??= bookStats());
    x.frames++; x.bytes += s.length;
    if (!x.firstAt) x.firstAt = at;
    const nonce = m.payload.nonce;
    if (x.firstNonce === null) x.firstNonce = nonce;
    else if (nonce !== x.lastNonce + 1) x.nonceGaps++;
    x.lastNonce = nonce;
    if (x.lastAt) x.maxGap = Math.max(x.maxGap, at - x.lastAt);
    x.lastAt = at;
    const nb = Object.keys(d.volumes?.bids ?? {}).length, na = Object.keys(d.volumes?.asks ?? {}).length;
    if (!x.first) {
      x.first = { nb, na, afterSubMs: at - SENT[rid], keys: Object.keys(d), bidKeyOrder: Object.keys(d.volumes?.bids ?? {}).slice(0, 4), askKeyOrder: Object.keys(d.volumes?.asks ?? {}).slice(0, 4) };
      capture('book_first.jsonl', s);
    } else if (x.frames < 40) capture('book_delta.jsonl', s);
    x.entries += nb + na;
    x.zeros += applySide(x.bids, d.volumes?.bids) + applySide(x.asks, d.volumes?.asks);
    if (d.extended_volumes) {
      x.ext++;
      const id = d.instrument_id;
      for (const side of ['bids', 'asks']) for (const [p, v] of Object.entries(d.volumes?.[side] ?? {})) {
        const base = d.extended_volumes.base?.[side]?.[p], quote = d.extended_volumes.quote?.[side]?.[p];
        if (Number(v) > 0 && base !== undefined && x.sizeChecks.length < 400) x.sizeChecks.push({ v: Number(v), base: Number(base), quote: Number(quote), p: Number(p), cs: cs[id] });
      }
    }
    x.maxB = Math.max(x.maxB, x.bids.size); x.maxA = Math.max(x.maxA, x.asks.size);
    const bb = best(x.bids, true), ba = best(x.asks, false);
    if (bb !== null && ba !== null && bb >= ba) x.crossed++;
    if (bb !== null && ba !== null) {
      const mid = (bb + ba) / 2;
      x.stray = Math.max(x.stray, [...x.bids.keys(), ...x.asks.keys()].filter((p) => Math.abs(Number(p) / mid - 1) > 0.05).length);
    }
    if (d.offset < x.maxOff) x.late.push(x.frames);
    x.maxOff = Math.max(x.maxOff, d.offset);
    (nb + na >= 10 ? x.lagBig : x.lagSmall).push(m.server_timestamp - d.timestamp);
    if (d.timestamp) x.ages.push(at - d.timestamp);
    x.ts.push(m.server_timestamp - d.timestamp);
  });
  const secs = DUR / 1000;
  log('batch', { openMs: res?.openMs, acks, frames: total, perSec: +(total / secs).toFixed(1), kbPerSec: +(totalBytes / secs / 1024).toFixed(1), bytesPerFrame: Math.round(totalBytes / total), parseUsPerFrame: +(parseUs / total).toFixed(1) });
  const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : null; };
  for (const [rid, x] of Object.entries(st)) {
    const ratios = x.sizeChecks.map((c) => c.base / (c.v * c.cs));
    const qratios = x.sizeChecks.map((c) => c.quote / (c.base * c.p));
    log('stream', {
      rid, frames: x.frames, perSec: +(x.frames / Math.max(1, (x.lastAt - x.firstAt) / 1000)).toFixed(2), maxGapMs: x.maxGap, first: x.first, meanEntries: +(x.entries / Math.max(1, x.frames)).toFixed(1), zeros: x.zeros, ext: x.ext,
      maxBids: x.maxB, maxAsks: x.maxA, endBids: x.bids.size, endAsks: x.asks.size, crossedFrames: x.crossed, strayLevelsMax: x.stray,
      firstNonce: x.firstNonce, lastNonce: x.lastNonce, nonceGaps: x.nonceGaps, lateFrames: x.late.length, lateAtFrame: x.late.slice(0, 6),
      recvMinusTsMed: q(x.ages, 0.5), recvMinusTsMax: q(x.ages, 1), serverMinusTsMed: q(x.ts, 0.5), lagBigN: x.lagBig.length, lagBigMed: q(x.lagBig, 0.5), lagSmallN: x.lagSmall.length, lagSmallMed: q(x.lagSmall, 0.5),
      sizeChecks: x.sizeChecks.length, baseOverContractsTimesCs: ratios.length ? [q(ratios, 0), q(ratios, 1)] : null, quoteOverBaseTimesPrice: qratios.length ? [q(qratios, 0), q(qratios, 1)] : null,
      tickerCmp: x.tickerCmp, bestBid: best(x.bids, true), bestAsk: best(x.asks, false),
    });
  }
  for (const [id, t] of Object.entries(tick)) log('ticker', { id, frames: t.n, bid: t.bid, ask: t.ask, spreadPpm: Math.round((t.ask / t.bid - 1) * 1e6) });
}

async function gateIndex() {
  const out = {};
  try {
    const r = await (await fetch('https://api.gateio.ws/api/v4/futures/usdt/tickers')).json();
    for (const t of r) out[t.contract] = { index: Number(t.index_price), mark: Number(t.mark_price) };
  } catch (e) { out.error = e.message; }
  return out;
}

async function anchor() {
  const per = {};
  const gate = [];
  const DUR = 45000;
  const latest = {};
  const snapshotLater = async () => { for (const w of [10000, 15000, 15000]) { await sleep(w); gate.push({ g: await gateIndex(), t: JSON.parse(JSON.stringify(latest)) }); } };
  const later = snapshotLater();
  await collect(URL_WEB, [sub('turboTickers.*', 'all')], DUR, (m, at, s) => {
    if (m.type !== 'subscriptionData') return;
    const d = m.payload.data;
    const id = d.instrument_id;
    const x = (per[id] ??= { n: 0, arr: [], mark: new Set(), index: new Set(), fair: new Set(), fr: new Set(), fi: new Set(), lft: new Set(), prem: new Set(), ir: new Set(), markNeIndex: 0, markNeFair: 0, maxMarkIdxPpm: 0, markVsMidPpm: [], secsWithIndexChange: new Set(), lastIndex: null, fields: Object.keys(d) });
    x.n++; x.arr.push(at);
    x.mark.add(d.mark_price); x.index.add(d.index_price); x.fair.add(d.fair_price); x.fr.add(d.funding_rate); x.fi.add(d.funding_interval); x.lft.add(d.last_funding_time); x.prem.add(d.premium_index); x.ir.add(d.interest_rate);
    if (d.mark_price !== d.index_price) x.markNeIndex++;
    if (d.mark_price !== d.fair_price) x.markNeFair++;
    x.maxMarkIdxPpm = Math.max(x.maxMarkIdxPpm, Math.abs(Number(d.mark_price) / Number(d.index_price) - 1) * 1e6);
    if (d.best_bid && d.best_ask) x.markVsMidPpm.push((Number(d.mark_price) / ((Number(d.best_bid) + Number(d.best_ask)) / 2) - 1) * 1e6);
    if (x.lastIndex !== null && x.lastIndex !== d.index_price) x.secsWithIndexChange.add(Math.floor(at / 1000));
    x.lastIndex = d.index_price;
    latest[id] = { index: Number(d.index_price), mark: Number(d.mark_price), bid: Number(d.best_bid), ask: Number(d.best_ask) };
    if (x.n <= 2) capture('ticker.jsonl', s);
  });
  await later;
  const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(0) : null; };
  for (const [id, x] of Object.entries(per)) {
    const gaps = x.arr.slice(1).map((v, i) => v - x.arr[i]);
    log('tick', { id, frames: x.n, perSec: +(x.n / (DUR / 1000)).toFixed(2), gapMed: q(gaps, 0.5), gapMax: q(gaps, 1), distinctMark: x.mark.size, distinctIndex: x.index.size, secsIndexChanged: x.secsWithIndexChange.size, markNeIndex: x.markNeIndex, markNeFair: x.markNeFair, maxMarkIdxPpm: Math.round(x.maxMarkIdxPpm), markVsMidPpm: [q(x.markVsMidPpm, 0), q(x.markVsMidPpm, 0.5), q(x.markVsMidPpm, 1)], funding: [...x.fr], interval: [...x.fi], lastFunding: [...x.lft].map((t) => new Date(t).toISOString()), premium: [...x.prem], interest: [...x.ir] });
  }
  log('ticker_fields', { fields: Object.values(per)[0]?.fields });
  for (const id of PERPS) {
    const gc = id.startsWith('XAU') ? 'XAUT_USDT' : id.replace('_PERPETUAL', '');
    const rows = gate.map((g) => ({ t: g.t[id], gi: g.g[gc] })).filter((x) => x.t && x.gi);
    log('vs_gate', { id, gc, indexGapPpm: rows.map((x) => Math.round((x.t.index / x.gi.index - 1) * 1e6)), midVsGateIndexPpm: rows.map((x) => Math.round(((x.t.bid + x.t.ask) / 2 / x.gi.index - 1) * 1e6)), ttmIndex: rows[0]?.t.index, ttmMid: rows[0] ? (rows[0].t.bid + rows[0].t.ask) / 2 : null, gateIndex: rows[0]?.gi.index });
  }
}

async function errors() {
  const replies = [];
  const r = await open(URL_WEB);
  if (!r.ok) { log('open_failed', r); return; }
  const ws = r.ws;
  ws.on('message', (d) => { const s = d.toString(); let m; try { m = JSON.parse(s); } catch { m = {}; } if (m.type !== 'subscriptionData') replies.push({ at: Date.now(), s: s.slice(0, 320) }); else if (!replies.some((x) => x.data === m.request_id)) { const v = m.payload?.data?.volumes; replies.push({ at: Date.now(), data: m.request_id, s: `data ${v ? `bids ${Object.keys(v.bids ?? {}).length} asks ${Object.keys(v.asks ?? {}).length} ts ${m.payload.data.timestamp}` : JSON.stringify(m.payload?.data)} nonce ${m.payload?.nonce}` }); } });
  ws.on('close', (c, why) => log('close', { code: c, reason: why.toString() }));
  const tests = [
    ['unknown_perp_book', sub('contractsOrderbookVolumes.NOPE_USDT_PERPETUAL', 'e1')],
    ['unknown_perp_ticker', sub('contractsTickers.NOPE_USDT_PERPETUAL', 'e2')],
    ['legacy_perp_book', sub('contractsOrderbookVolumes.BTC_PERPETUAL', 'e3')],
    ['spot_pair_on_contracts_book', sub('contractsOrderbookVolumes.BTC_USDT', 'e4')],
    ['no_instrument', sub('contractsOrderbookVolumes', 'e5')],
    ['unknown_channel', sub('fooBar.BTC_USDT_PERPETUAL', 'e6')],
    ['missing_request_id', { type: 'subscribe', channel: 'contractsTickers.ETH_USDT_PERPETUAL' }],
    ['unknown_type', { type: 'hello', request_id: 'e8' }],
    ['not_json', 'hello'],
    ['first_sub', sub('contractsOrderbookVolumes.SOL_USDT_PERPETUAL', 'dup')],
    ['same_request_id_again', sub('contractsOrderbookVolumes.SOL_USDT_PERPETUAL', 'dup')],
    ['same_channel_new_id', sub('contractsOrderbookVolumes.SOL_USDT_PERPETUAL', 'dup2')],
    ['get_subscriptions', { type: 'getSubscriptions' }],
    ['unsubscribe_unknown', { type: 'unsubscribe', request_id: 'never' }],
    ['unsubscribe_all', { type: 'unsubscribeAll' }],
  ];
  for (const [name, f] of tests) {
    const before = replies.length;
    const at = Date.now();
    send(ws, f);
    await sleep(700);
    const got = replies.slice(before).map((x) => `${x.at - at}ms ${x.s}`);
    log('error_test', { name, sent: typeof f === 'string' ? f : f, replies: got.slice(0, 3), more: Math.max(0, got.length - 3) });
  }
  const t = Date.now();
  const pong = await new Promise((res) => { ws.once('pong', () => res(Date.now() - t)); ws.ping(); setTimeout(() => res(null), 3000); });
  log('protocol_ping', { pongMs: pong });
  ws.terminate();
}

async function silence() {
  const t0 = Date.now();
  const res = {};
  const mk = async (name, frames) => {
    const r = await open(URL_WEB);
    if (!r.ok) { res[name] = { error: r.error ?? r.status }; return; }
    const x = (res[name] = { frames: 0, pings: 0, lastFrameAt: null, closed: null });
    r.ws.on('message', () => { x.frames++; x.lastFrameAt = Date.now() - t0; });
    r.ws.on('ping', () => x.pings++);
    r.ws.on('close', (c) => { x.closed = { code: c, atMs: Date.now() - t0 }; });
    for (const f of frames) send(r.ws, f);
    return r.ws;
  };
  const a = await mk('bare', []);
  const b = await mk('quiet_book', [sub('contractsOrderbookVolumes.XAU_USDT_PERPETUAL', 'q')]);
  for (let s = 0; s < 120; s += 10) {
    await sleep(10000);
    if (res.bare?.closed && res.quiet_book?.closed) break;
  }
  log('silence', { heldMs: Date.now() - t0, ...res });
  a?.terminate(); b?.terminate();
}

async function record() {
  if (!OUT) { console.error('record needs PROBE_OUT_DIR'); return; }
  const frames = [sub('contractsOrderbookVolumes.BTC_USDT_PERPETUAL', 'b:BTC'), sub('contractsOrderbookVolumes.ETH_USDT_PERPETUAL', 'b:ETH'), sub('contractsTickers.BTC_USDT_PERPETUAL', 'k:BTC'), sub('contractsTickers.ETH_USDT_PERPETUAL', 'k:ETH')];
  let n = 0;
  await collect(URL_WEB, frames, 45000, (m, at, s) => { n++; capture('record.jsonl', `${at} ${s.trim()}`); });
  log('recorded', { frames: n, file: join(OUT, 'record.jsonl') });
}

// Offline: replays a PROBE_OUT_DIR capture (record.jsonl, or book_first.jsonl plus book_delta.jsonl) under three apply rules, in server_timestamp order.
// merge applies every frame as a price map, as the web app does. reset also clears the book on a full window among the first three nonces,
// meaning no zero size and at least 10 levels a side. resetDrop also drops a frame whose offset is not above the highest applied one.
// Ticker frames in the capture are compared with the replayed book of the same instrument.
async function replay() {
  const { readFileSync } = await import('node:fs');
  const lines = process.argv.slice(3).flatMap((f) => readFileSync(f, 'utf8').split('\n')).map((l) => l.trim()).filter(Boolean);
  const msgs = lines.map((l, i) => ({ i, m: JSON.parse(l.startsWith('{') ? l : l.slice(l.indexOf(' ') + 1)) })).filter(({ m }) => m.type === 'subscriptionData' && m.payload?.data);
  msgs.sort((a, b) => a.m.server_timestamp - b.m.server_timestamp || a.i - b.i);
  const RULES = ['merge', 'reset', 'resetDrop'];
  const st = {};
  for (const { m } of msgs) {
    const d = m.payload.data;
    if (!d.volumes) {
      if (d.best_bid === undefined) continue;
      for (const x of Object.values(st)) if (x.id === d.instrument_id) for (const r of RULES) {
        const b = x[r];
        b.ticks++;
        if (best(b.bids, true) === Number(d.best_bid)) b.bidEq++;
        if (best(b.asks, false) === Number(d.best_ask)) b.askEq++;
      }
      continue;
    }
    const x = (st[m.request_id] ??= { id: d.instrument_id, frames: 0, ...Object.fromEntries(RULES.map((r) => [r, { bids: new Map(), asks: new Map(), crossed: 0, lastOff: 0, dropped: 0, resets: 0, ticks: 0, bidEq: 0, askEq: 0 }])) });
    x.frames++;
    const nb = Object.keys(d.volumes.bids ?? {}).length, na = Object.keys(d.volumes.asks ?? {}).length;
    const zeros = [...Object.values(d.volumes.bids ?? {}), ...Object.values(d.volumes.asks ?? {})].filter((v) => Number(v) === 0).length;
    for (const r of RULES) {
      const b = x[r];
      if (r === 'resetDrop' && d.offset <= b.lastOff) { b.dropped++; continue; }
      if (r !== 'merge' && m.payload.nonce <= 3 && zeros === 0 && nb >= 10 && na >= 10) { b.bids.clear(); b.asks.clear(); b.resets++; }
      b.lastOff = Math.max(b.lastOff, d.offset);
      applySide(b.bids, d.volumes.bids); applySide(b.asks, d.volumes.asks);
      const bb = best(b.bids, true), ba = best(b.asks, false);
      if (bb !== null && ba !== null && bb >= ba) b.crossed++;
    }
  }
  for (const [rid, x] of Object.entries(st)) {
    const out = { rid, frames: x.frames };
    for (const r of RULES) { const { crossed, resets, dropped, ticks, bidEq, askEq } = x[r]; out[r] = { crossed, ...(r !== 'merge' ? { resets, dropped } : {}), ...(ticks ? { ticks, bidEq, askEq } : {}) }; }
    log('replay', out);
  }
}

const mode = process.argv[2] ?? 'hosts';
const fn = { hosts, catalog, book, anchor, errors, silence, record, replay }[mode];
if (!fn) { console.error('unknown mode', mode); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await fn();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
