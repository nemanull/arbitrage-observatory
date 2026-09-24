// CoinW futures WebSocket probe: the depth channel (levels, order, cadence, repeats, size unit against REST), the index, mark and funding channels against the REST tickers, errors, a batch of perpetuals on one connection, keepalive, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Depth subscriptions are documented at 10 per 2 s per IP, so every mode sends them at 4 a second or slower, except one burst of 12 in the errors mode.
// Run from server/: node ../scripts/probes/venues/coinw/ws-probe.mjs [book|errors|batch|anchor|anchorbatch|cap|silence|deflate]
//   book         depth on six perpetuals for 45 s, or BOOK_MS, each size checked against the contract's lot, then a REST depth compare. About 50 s.
//   errors       unknown, lowercase, joined and hidden symbols, bad type, biz and event, bad JSON, duplicate and unsub, ping forms, then a burst of 12 depth subscriptions. About 30 s.
//   batch        depth on 100 USDT perpetuals on one connection, subscribed at 4 a second, held for 40 s. About 70 s.
//   anchor       index_price, mark_price and funding_rate on six perpetuals for 45 s, with the REST tickers polled every second. About 50 s.
//   anchorbatch  index_price, mark_price and funding_rate on every listed perpetual on one connection, subscribed at 25 frames a second, held for 20 s, then the funding fields against instruments and index, mark and rate against one Binance USD-M premiumIndex read. About 70 s.
//   cap          index_price alone on every listed perpetual on one connection, at 25 frames a second, held for 5 s. About 25 s.
//   silence      four sockets that differ only in what the client sends or subscribes, for up to 120 s, or SILENCE_MS.
//   deflate      asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep a few frames, with book levels trimmed to three per side. Recorded in docs/profiles/coinw/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://ws.futurescw.com/perpum';
const API = 'https://api.coinw.com';
const OUT = process.env.PROBE_OUT_DIR;
const SILENCE_MS = Number(process.env.SILENCE_MS ?? 120_000); // a rerun may stop earlier once the close instant is known
const BOOK_MS = Number(process.env.BOOK_MS ?? 45_000); // a short book run is enough to capture frames
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null; };
const stats = (xs) => ({ n: xs.length, min: q(xs, 0), median: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) });
const sub = (type, pairCode, event = 'sub') => ({ event, params: { biz: 'futures', type, pairCode } });
const keyOf = (i) => (i.quote === 'usdc' ? `${i.base.toUpperCase()}_USDC` : i.name); // the pairCode the docs ask for

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 1500) + '\n');
}

async function getJson(path) {
  const r = await fetch(`${API}${path}`);
  return r.json();
}

async function instruments() {
  return (await getJson('/v1/perpum/instruments')).data;
}

// Opens a socket and resolves once it is open, with the time it took.
function open(opts = { perMessageDeflate: false }) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ws = new WebSocket(WS_URL, opts);
    let headers = {};
    ws.on('upgrade', (res) => { headers = res.headers; });
    ws.once('open', () => resolve({ ws, openMs: Date.now() - t0, headers }));
    ws.once('error', reject);
  });
}

function levelsOrdered(levels, dir) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].p);
    const b = Number(levels[i].p);
    if (dir > 0 ? b <= a : b >= a) return false;
  }
  return true;
}

async function book() {
  const inst = await instruments();
  const quiet = [...inst].filter((i) => i.quote === 'usdt').sort((a, b) => b.sort - a.sort)[0];
  const bigLot = inst.find((i) => i.quote === 'usdt' && i.oneLotSize === 1000);
  const pairs = ['BTC', 'ETH', 'BTC_USDC', 'DOGE', quiet.name, bigLot.name];
  const lotOf = new Map(inst.map((i) => [keyOf(i).toLowerCase(), i.oneLotSize]));
  const { ws, openMs, headers } = await open();
  log('open', { openMs, server: headers.server, via: headers['x-via'], extensions: headers['sec-websocket-extensions'] ?? null });
  const st = new Map(pairs.map((p) => [p.toLowerCase(), { frames: 0, sizes: 0, offLot: 0, gaps: [], last: 0, prevBody: '', repeats: 0, levels: new Set(), bidsDesc: 0, asksAsc: 0, crossed: 0, ages: [], tBack: 0, prevT: 0, bytes: 0, subAt: 0, firstMs: null, keys: new Set(), types: new Set(), latest: null }]));
  let acks = [];
  let other = 0;
  ws.on('message', (raw) => {
    const at = Date.now();
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.channel === 'subscribe') { acks.push({ pairCode: m.pairCode, type: m.type, data: m.data }); capture('ack.txt', text); return; }
    const s = st.get(String(m.pairCode).toLowerCase());
    if (m.type !== 'depth' || !s) { other++; capture('other.txt', text); return; }
    const d = m.data;
    s.frames++;
    s.bytes += text.length;
    if (s.firstMs === null) s.firstMs = at - s.subAt;
    if (s.last) s.gaps.push(at - s.last);
    s.last = at;
    s.levels.add(`${d.bids?.length}/${d.asks?.length}`);
    Object.keys(d).forEach((k) => s.keys.add(k));
    Object.keys(m).forEach((k) => s.keys.add('.' + k));
    s.types.add(`${typeof d.bids?.[0]?.p}/${typeof d.bids?.[0]?.m}`);
    if (levelsOrdered(d.bids ?? [], -1)) s.bidsDesc++;
    if (levelsOrdered(d.asks ?? [], 1)) s.asksAsc++;
    if (d.bids?.length && d.asks?.length && Number(d.bids[0].p) >= Number(d.asks[0].p)) s.crossed++;
    const body = JSON.stringify([d.bids, d.asks]);
    if (body === s.prevBody) s.repeats++;
    s.prevBody = body;
    s.ages.push(at - d.t);
    if (d.t < s.prevT) s.tBack++;
    s.prevT = d.t;
    s.latest = d;
    // A size in base currency is a whole number of lots, and a size in contracts would not be.
    const lot = lotOf.get(String(m.pairCode).toLowerCase());
    for (const l of [...(d.bids ?? []), ...(d.asks ?? [])]) {
      s.sizes++;
      const k = Number(l.m) / lot;
      if (Math.abs(k - Math.round(k)) > 1e-6) s.offLot++;
    }
    if (s.frames <= 2) capture(`depth-${m.pairCode}.txt`, `${text.length} bytes, ${d.bids?.length} bids, ${d.asks?.length} asks: ` + JSON.stringify({ ...m, data: { ...d, asks: d.asks?.slice(0, 3), bids: d.bids?.slice(0, 3) } }));
  });
  for (const p of pairs) {
    st.get(p.toLowerCase()).subAt = Date.now();
    ws.send(JSON.stringify(sub('depth', p)));
    await sleep(300);
  }
  await sleep(BOOK_MS);
  ws.close();
  log('acks', { acks });
  for (const [p, s] of st) {
    log('depth', { pair: p, frames: s.frames, perSecond: +(s.frames / (BOOK_MS / 1000)).toFixed(2), firstFrameAfterSubMs: s.firstMs, intervalMs: stats(s.gaps), levelsBidsAsks: [...s.levels].slice(0, 8), keys: [...s.keys], numberTypes: [...s.types], bidsDescending: s.bidsDesc, asksAscending: s.asksAsc, crossed: s.crossed, identicalToPrevious: s.repeats, arrivalMinusTMs: stats(s.ages), tWentBack: s.tBack, oneLotSize: lotOf.get(p), sizesChecked: s.sizes, sizesNotAWholeNumberOfLots: s.offLot, avgBytes: s.frames ? Math.round(s.bytes / s.frames) : 0 });
  }
  log('other_frames', { other });
  // Size unit: the REST book and the last socket frame at the same prices.
  for (const p of ['BTC', 'ETH']) {
    const r = await getJson(`/v1/perpumPublic/depth?base=${p}`);
    const latest = st.get(p.toLowerCase()).latest;
    const ws = new Map([...(latest?.bids ?? []), ...(latest?.asks ?? [])].map((l) => [Number(l.p), Number(l.m)]));
    const rest = [...r.data.bids, ...r.data.asks];
    const same = rest.filter((l) => ws.get(Number(l.p)) === Number(l.m)).length;
    const lot = inst.find((i) => i.name === p).oneLotSize;
    log('size_unit', { pair: p, oneLotSize: lot, restLevels: rest.length, samePriceAndSize: same, samePriceOnly: rest.filter((l) => ws.has(Number(l.p))).length, restTop: { bid: r.data.bids[0], ask: r.data.asks[0] }, wsTop: { bid: latest?.bids?.[0], ask: latest?.asks?.[0] } });
  }
}

async function errors() {
  const { ws } = await open();
  const got = [];
  const delivered = new Map();
  const t0 = Date.now();
  ws.on('message', (raw) => {
    const text = raw.toString();
    let m;
    try { m = JSON.parse(text); } catch { got.push({ ms: Date.now() - t0, text: text.slice(0, 160) }); return; }
    if (m.channel === 'subscribe' || m.channel === 'unsubscribe' || m.event || m.data?.result === false || !m.type) { got.push({ ms: Date.now() - t0, text: text.slice(0, 220) }); capture('errors.txt', text); return; }
    const k = `${m.type}:${m.pairCode}`;
    delivered.set(k, (delivered.get(k) ?? 0) + 1);
  });
  ws.on('close', (c, r) => got.push({ ms: Date.now() - t0, close: c, reason: r.toString() }));
  const steps = [
    ['unknown', sub('depth', 'NOPE')],
    ['lowercase', sub('depth', 'eth')],
    ['full name', sub('depth', 'SOLUSDT')],
    ['joined', sub('depth', 'XRP,ADA')],
    ['array', sub('depth', ['LTC', 'BCH'])],
    ['hidden tradfi', sub('depth', 'AVGO')],
    ['propw', sub('depth', 'BTCPROPW')],
    ['usdc without underscore', sub('depth', 'BTCUSDC')],
    ['type deep', sub('deep', 'BTC')],
    ['unknown type', sub('nope', 'BTC')],
    ['biz uppercase', { event: 'sub', params: { biz: 'FUTURES', type: 'depth', pairCode: 'LINK' } }],
    ['biz spot', { event: 'sub', params: { biz: 'spot', type: 'depth', pairCode: 'BTC' } }],
    ['event uppercase', { event: 'SUB', params: { biz: 'futures', type: 'depth', pairCode: 'DOT' } }],
    ['no params', { event: 'sub' }],
    ['not json', 'hello'],
    ['ping json', { event: 'ping' }],
    ['ping text', 'ping'],
    ['duplicate 1', sub('depth', 'BNB')],
    ['duplicate 2', sub('depth', 'BNB')],
  ];
  for (const [label, frame] of steps) {
    got.push({ ms: Date.now() - t0, sent: label });
    ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
    await sleep(350);
  }
  await sleep(6000);
  const before = delivered.get('depth:bnb') ?? delivered.get('depth:BNB') ?? 0;
  got.push({ ms: Date.now() - t0, sent: 'unsub BNB' });
  ws.send(JSON.stringify(sub('depth', 'BNB', 'unsub')));
  await sleep(4000);
  const after = delivered.get('depth:bnb') ?? delivered.get('depth:BNB') ?? 0;
  for (const g of got) log('reply', g);
  log('delivered', { byTypeAndPair: Object.fromEntries(delivered), bnbBeforeUnsub: before, bnbFramesInTheFourSecondsAfterUnsub: after - before });
  ws.close();
  await sleep(500);
  // A burst of 12 depth subscriptions, 2 over the documented 10 per 2 s.
  const inst = (await instruments()).filter((i) => i.quote === 'usdt').slice(10, 22);
  const b = await open();
  const burst = [];
  const acked = new Set();
  const flowing = new Set();
  const tb = Date.now();
  b.ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.channel === 'subscribe') { burst.push({ ms: Date.now() - tb, pairCode: m.pairCode, data: m.data }); if (m.data?.result) acked.add(m.pairCode); return; }
    if (m.type === 'depth') flowing.add(String(m.pairCode).toUpperCase());
    else burst.push({ ms: Date.now() - tb, text: raw.toString().slice(0, 200) });
  });
  b.ws.on('close', (c, r) => burst.push({ ms: Date.now() - tb, close: c, reason: r.toString() }));
  for (const i of inst) b.ws.send(JSON.stringify(sub('depth', i.name)));
  await sleep(5000);
  b.ws.close();
  log('burst', { sent: inst.length, acked: acked.size, delivering: flowing.size, notAcked: burst.filter((x) => x.data && !x.data.result).map((x) => x.pairCode + ' ' + JSON.stringify(x.data)), other: burst.filter((x) => !x.data) });
}

async function batch() {
  const inst = (await instruments()).filter((i) => i.quote === 'usdt').sort((a, b) => a.sort - b.sort).slice(0, 100);
  const { ws, openMs } = await open();
  const seen = new Map();
  let frames = 0;
  let bytes = 0;
  let parseNs = 0n;
  const perSecond = [];
  let secFrames = 0;
  let fails = [];
  let closed = null;
  let holdStart = 0;
  let holdFrames = 0;
  let holdBytes = 0;
  ws.on('message', (raw) => {
    const t = process.hrtime.bigint();
    const m = JSON.parse(raw.toString());
    parseNs += process.hrtime.bigint() - t;
    if (m.channel === 'subscribe') { if (!m.data?.result) fails.push(m); return; }
    frames++;
    bytes += raw.length;
    secFrames++;
    if (holdStart) { holdFrames++; holdBytes += raw.length; }
    if (m.type === 'depth') seen.set(String(m.pairCode).toUpperCase(), (seen.get(String(m.pairCode).toUpperCase()) ?? 0) + 1);
  });
  ws.on('close', (c, r) => { closed = { code: c, reason: r.toString() }; });
  const tick = setInterval(() => { perSecond.push(secFrames); secFrames = 0; }, 1000);
  const t0 = Date.now();
  for (const i of inst) {
    ws.send(JSON.stringify(sub('depth', i.name)));
    await sleep(250);
  }
  const subMs = Date.now() - t0;
  holdStart = Date.now();
  await sleep(40_000);
  const holdMs = Date.now() - holdStart;
  clearInterval(tick);
  ws.close();
  const heldPerSecond = perSecond.slice(-38);
  log('batch', { openMs, contracts: inst.length, subscribeMs: subMs, fails: fails.slice(0, 3), failCount: fails.length, closed, delivering: seen.size, silent: inst.filter((i) => !seen.has(i.name)).map((i) => i.name), framesTotal: frames, parseUsPerFrame: frames ? Number(parseNs / BigInt(frames)) / 1000 : 0, heldFramesPerSecond: +(holdFrames / (holdMs / 1000)).toFixed(1), heldKBPerSecond: Math.round(holdBytes / (holdMs / 1000) / 1024), bytesPerFrame: Math.round(holdBytes / Math.max(1, holdFrames)), perSecondDuringHold: stats(heldPerSecond), perContractFramesPerSecond: stats([...seen.values()].map((v) => (v / ((Date.now() - t0) / 1000)) * 100)) });
  log('batch_note', { note: 'perContractFramesPerSecond is scaled by 100 to keep two decimals' });
}

async function anchor() {
  const inst = await instruments();
  const four = inst.find((i) => i.settledPeriod === 4);
  const one = inst.find((i) => i.settledPeriod === 1);
  const pairs = ['BTC', 'ETH', 'BTC_USDC', 'DOGE', four.name, one.name];
  const tickerName = (p) => (p.includes('_') ? p.replace('_', '') : `${p}USDT`);
  const { ws } = await open();
  const st = new Map();
  const latest = new Map();
  let fundingFrames = [];
  const ch = (t, p) => { const k = `${t}:${p}`; if (!st.has(k)) st.set(k, { n: 0, last: 0, gaps: [], values: new Set(), changes: 0, prev: null, sameT: 0 }); return st.get(k); };
  ws.on('message', (raw) => {
    const at = Date.now();
    const m = JSON.parse(raw.toString());
    if (m.channel === 'subscribe') { if (!m.data?.result) log('anchor_fail', { m }); return; }
    const p = String(m.pairCode).toLowerCase();
    const s = ch(m.type, p);
    s.n++;
    if (s.last) s.gaps.push(at - s.last);
    s.last = at;
    const v = m.type === 'funding_rate' ? m.data.r : m.data.p;
    if (s.prev !== null && v !== s.prev) s.changes++;
    s.prev = v;
    s.values.add(v);
    latest.set(`${m.type}:${p}`, { v, t: m.data.t, at });
    if (m.type === 'funding_rate') { if (fundingFrames.length < 12) fundingFrames.push({ p, ...m.data }); }
    if (s.n <= 1) capture(`anchor-${m.type}.txt`, raw.toString());
  });
  for (const p of pairs) {
    for (const t of ['index_price', 'mark_price', 'funding_rate']) {
      ws.send(JSON.stringify(sub(t, p)));
      await sleep(60);
    }
  }
  // Poll the REST tickers each second and read fair_price against the socket's latest index, mark and the ticker's own last price.
  const cmp = new Map(pairs.map((p) => [p.toLowerCase(), { index: 0, mark: 0, last: 0, n: 0, premiumPpm: [], fairIndexPpm: [], fairMarkPpm: [] }]));
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    const start = Date.now();
    const tick = (await getJson('/v1/perpumPublic/tickers')).data;
    for (const p of pairs) {
      const t = tick.find((x) => x.name === tickerName(p));
      const c = cmp.get(p.toLowerCase());
      const idx = latest.get(`index_price:${p.toLowerCase()}`);
      const mk = latest.get(`mark_price:${p.toLowerCase()}`);
      if (!t || !idx || !mk) continue;
      c.n++;
      if (t.fair_price === idx.v) c.index++;
      if (t.fair_price === mk.v) c.mark++;
      if (t.fair_price === t.last_price) c.last++;
      c.premiumPpm.push(Math.round((mk.v / idx.v - 1) * 1e6));
      c.fairIndexPpm.push(Math.round(Math.abs(t.fair_price / idx.v - 1) * 1e6));
      c.fairMarkPpm.push(Math.round(Math.abs(t.fair_price / mk.v - 1) * 1e6));
    }
    const wait = 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
  }
  ws.close();
  for (const [k, s] of st) log('anchor_channel', { channel: k, frames: s.n, intervalMs: stats(s.gaps), distinctValues: s.values.size, changes: s.changes });
  for (const [p, c] of cmp) log('anchor_fair', { pair: p, polls: c.n, fairEqualsIndex: c.index, fairEqualsMark: c.mark, fairEqualsLast: c.last, markMinusIndexPpm: stats(c.premiumPpm), fairVsIndexPpm: stats(c.fairIndexPpm), fairVsMarkPpm: stats(c.fairMarkPpm) });
  log('anchor_funding_frames', { frames: fundingFrames.map((f) => ({ ...f, ntIso: new Date(f.nt).toISOString() })) });
  const im = [...latest.entries()].filter(([k]) => k.startsWith('index_price') || k.startsWith('mark_price')).map(([k, v]) => `${k} t=${v.t} ageMs=${v.at - v.t}`);
  log('anchor_last_t', { im });
}

async function anchorbatch() {
  const inst = await instruments();
  const pairs = inst.map(keyOf);
  const { ws, openMs } = await open();
  const seen = { index_price: new Set(), mark_price: new Set(), funding_rate: new Set() };
  let frames = 0;
  let bytes = 0;
  let fails = [];
  let closed = null;
  const markZero = new Set();
  const last = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.channel === 'subscribe') { if (!m.data?.result) fails.push(`${m.type}:${m.pairCode}:${JSON.stringify(m.data)}`); return; }
    frames++;
    bytes += raw.length;
    const p = String(m.pairCode).toUpperCase();
    seen[m.type]?.add(p);
    if (m.type === 'mark_price' && !(m.data.p > 0)) markZero.add(m.pairCode);
    if (!last.has(p)) last.set(p, {});
    last.get(p)[m.type] = m.data;
  });
  ws.on('close', (c, r) => { closed = { code: c, reason: r.toString() }; });
  const t0 = Date.now();
  for (const p of pairs) {
    for (const t of ['index_price', 'mark_price', 'funding_rate']) {
      ws.send(JSON.stringify(sub(t, p)));
      await sleep(40);
    }
  }
  const subMs = Date.now() - t0;
  const f0 = frames;
  const b0 = bytes;
  const h0 = Date.now();
  await sleep(20_000);
  const holdS = (Date.now() - h0) / 1000;
  ws.close();
  const want = new Set(pairs.map((p) => p.toUpperCase()));
  const missing = (s) => [...want].filter((p) => !s.has(p));
  const pos = pairs.map((p, i) => [i, seen.index_price.has(p.toUpperCase())]);
  log('anchorbatch_positions', { lastDeliveringPosition: Math.max(...pos.filter(([, d]) => d).map(([i]) => i)), firstSilentPosition: Math.min(...pos.filter(([, d]) => !d).map(([i]) => i)), silentBeforeLastDelivering: pos.filter(([i, d]) => !d && i < Math.max(...pos.filter(([, x]) => x).map(([j]) => j))).length });
  log('anchorbatch', { openMs, pairs: pairs.length, subscribeFrames: pairs.length * 3, subscribeMs: subMs, failCount: fails.length, fails: fails.slice(0, 5), closed, delivering: { index_price: seen.index_price.size, mark_price: seen.mark_price.size, funding_rate: seen.funding_rate.size }, missingIndex: missing(seen.index_price).slice(0, 10), missingMark: missing(seen.mark_price).slice(0, 10), missingFunding: missing(seen.funding_rate).slice(0, 10), markZeroOrAbsent: [...markZero].slice(0, 10), heldFramesPerSecond: +((frames - f0) / holdS).toFixed(1), heldKBPerSecond: Math.round((bytes - b0) / holdS / 1024) });
  // Funding, interval and next settlement against the instruments call, and the mark to index premium.
  const byKey = new Map(inst.map((i) => [keyOf(i).toUpperCase(), i]));
  const rows = [...last.entries()].filter(([, v]) => v.funding_rate && v.index_price && v.mark_price);
  const rates = rows.map(([p, v]) => ({ p, r: v.funding_rate.r, h: v.funding_rate.h, nt: v.funding_rate.nt, prem: (v.mark_price.p / v.index_price.p - 1) * 1e6 }));
  const sortedR = [...rates].sort((a, b) => a.r - b.r);
  log('anchorbatch_funding', { rows: rates.length, rateCounts: Object.fromEntries(Object.entries(rates.reduce((a, x) => { a[x.r] = (a[x.r] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6)), lowest: sortedR.slice(0, 4).map((x) => `${x.p} ${x.r} h${x.h}`), highest: sortedR.slice(-4).map((x) => `${x.p} ${x.r} h${x.h}`), hDiffersFromSettledPeriod: rates.filter((x) => byKey.get(x.p) && byKey.get(x.p).settledPeriod !== x.h).map((x) => x.p), ntDiffersFromSettledAt: rates.filter((x) => byKey.get(x.p) && byKey.get(x.p).settledAt !== x.nt).map((x) => `${x.p} ${x.nt} ${byKey.get(x.p).settledAt}`).slice(0, 6) });
  const prem = rates.map((x) => Math.abs(x.prem));
  log('anchorbatch_premium', { absMarkMinusIndexPpm: stats(prem), over5000: rates.filter((x) => Math.abs(x.prem) > 5000).map((x) => `${x.p} ${Math.round(x.prem)}`).slice(0, 12), markEqualsIndex: rates.filter((x) => x.prem === 0).length });
  // The same contracts on Binance USD-M, read once right after the hold.
  try {
    const b = await (await fetch('https://fapi.binance.com/fapi/v1/premiumIndex')).json();
    const bmap = new Map(b.map((x) => [x.symbol, x]));
    const cmp = [];
    for (const [p, v] of rows) {
      const i = byKey.get(p);
      if (!i || i.quote !== 'usdt') continue;
      const bx = bmap.get(`${p}USDT`);
      if (!bx) continue;
      cmp.push({ p, idx: Math.abs(v.index_price.p / Number(bx.indexPrice) - 1) * 1e6, mark: Math.abs(v.mark_price.p / Number(bx.markPrice) - 1) * 1e6, rateSame: v.funding_rate.r === Number(bx.lastFundingRate), rateDiff: Math.abs(v.funding_rate.r - Number(bx.lastFundingRate)) });
    }
    log('anchorbatch_vs_binance', { common: cmp.length, indexWithin10ppm: cmp.filter((x) => x.idx <= 10).length, markWithin10ppm: cmp.filter((x) => x.mark <= 10).length, indexDiffPpm: stats(cmp.map((x) => x.idx)), markDiffPpm: stats(cmp.map((x) => x.mark)), fundingRateIdentical: cmp.filter((x) => x.rateSame).length, fundingWithin1e5: cmp.filter((x) => x.rateDiff <= 1e-5).length });
  } catch (e) {
    log('anchorbatch_vs_binance', { error: e.message });
  }
}

// index_price alone on every listed perpetual, to tell a per connection cap from a per contract gap.
async function cap() {
  const pairs = (await instruments()).map(keyOf);
  const { ws } = await open();
  const seen = new Set();
  let acks = 0;
  let fails = 0;
  let closed = null;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.channel === 'subscribe') { if (m.data?.result) acks++; else fails++; return; }
    if (m.type === 'index_price') seen.add(String(m.pairCode).toUpperCase());
  });
  ws.on('close', (c, r) => { closed = { code: c, reason: r.toString() }; });
  for (const p of pairs) {
    ws.send(JSON.stringify(sub('index_price', p)));
    await sleep(40);
  }
  await sleep(5000);
  ws.close();
  const pos = pairs.map((p, i) => [i, seen.has(p.toUpperCase())]);
  const silent = pos.filter(([, d]) => !d).map(([i]) => i);
  log('cap', { subscribed: pairs.length, acks, fails, closed, delivering: seen.size, silentCount: silent.length, firstSilentPosition: silent.length ? Math.min(...silent) : null, silentSample: silent.slice(0, 12).map((i) => pairs[i]) });
}

async function silence() {
  const variants = [
    { name: 'nothing', subs: [], pingMs: 0 },
    { name: 'ping every 10 s, no subscription', subs: [], pingMs: 10_000 },
    { name: 'funding_rate BTC, no ping', subs: [sub('funding_rate', 'BTC')], pingMs: 0 },
    { name: 'depth BTC, no ping', subs: [sub('depth', 'BTC')], pingMs: 0 },
  ];
  const results = await Promise.all(variants.map(async (v) => {
    const { ws } = await open();
    const t0 = Date.now();
    const r = { name: v.name, frames: 0, pongs: 0, serverPings: 0, maxGapMs: 0, closedAtMs: null, code: null, reason: null };
    let last = t0;
    ws.on('message', (raw) => { const now = Date.now(); r.maxGapMs = Math.max(r.maxGapMs, now - last); last = now; r.frames++; if (raw.toString().includes('pong')) r.pongs++; });
    ws.on('ping', () => { r.serverPings++; });
    for (const s of v.subs) ws.send(JSON.stringify(s));
    const timer = v.pingMs ? setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'ping' })), v.pingMs) : null;
    await new Promise((resolve) => {
      ws.on('close', (code, reason) => { r.closedAtMs = Date.now() - t0; r.code = code; r.reason = reason.toString(); resolve(); });
      setTimeout(resolve, SILENCE_MS);
    });
    if (timer) clearInterval(timer);
    if (r.closedAtMs === null) { r.maxGapMs = Math.max(r.maxGapMs, Date.now() - last); ws.close(); }
    return r;
  }));
  for (const r of results) log('silence', r);
}

async function deflate() {
  const { ws, headers, openMs } = await open({ perMessageDeflate: true });
  log('deflate', { openMs, extensions: headers['sec-websocket-extensions'] ?? null });
  ws.close();
}

const modes = { book, errors, batch, anchor, anchorbatch, cap, silence, deflate };
const mode = process.argv[2];
if (!modes[mode]) {
  console.log(`usage: ws-probe.mjs ${Object.keys(modes).join('|')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
await sleep(300);
process.exit(0);
