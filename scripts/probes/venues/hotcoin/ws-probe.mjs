// Hotcoin perpetual WebSocket probe: the depth channel (snapshot or delta, levels, order, repeats, size unit against REST), the ticker and funding channels as an anchor source, errors, a batch of perpetuals on one connection, keepalive and silence, compression.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the deflate mode, which asks for it once.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hotcoin/ws-probe.mjs [book|channels|errors|batch|silence|deflate]
//   book      depth on seven perpetuals across the USDT, USDC and coin-M families for 45 s, with a REST book compare at 20 s.
//   channels  ticker, fund_rate, fund_rates, tickers and fills for 45 s, with fund_rates checked against the REST catalog and premiumIndex.
//   errors    unknown, uppercase and missing contract, unknown type and biz, bad JSON, duplicate subscribe, unsubscribe, application and protocol ping. About 20 s.
//   batch     depth on 150 USDT perpetuals in 150 frames on one connection for 30 s, then 150 more on the same connection for 20 s.
//   silence   four sockets that differ only in what the client sends or subscribes, for up to 120 s, or PROBE_SILENCE_MS.
//   deflate   asks for permessage-deflate once, then subscribes depth with zip true and with serialize true, and prints what arrives. About 15 s.
// Set PROBE_OUT_DIR to keep a few trimmed frames. Recorded in docs/profiles/hotcoin/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, inflateSync, inflateRawSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://wss-ct.hotcoin.fit';
const API = 'https://api-ct.hotcoin.fit/api/v1/perpetual/public';
const OUT = process.env.PROBE_OUT_DIR;
const SILENCE_MS = Number(process.env.PROBE_SILENCE_MS ?? 120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};
const stats = (a) => (a.length ? { n: a.length, min: Math.min(...a), median: pct(a, 0.5), p90: pct(a, 0.9), max: Math.max(...a) } : { n: 0 });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, ...opts });
  ws.openedAt = null;
  ws.pings = 0;
  ws.on('ping', () => ws.pings++);
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      ws.openedAt = Date.now();
      ws.openMs = ws.openedAt - t0;
      log('open', { ms: ws.openMs, extensions: ws.extensions || '(none)', deflateOffered: opts.perMessageDeflate === true });
      resolve(ws);
    });
    ws.once('error', reject);
  });
}

const sub = (ws, type, contractCode, extra = {}) =>
  ws.send(JSON.stringify({ event: 'subscribe', params: { biz: 'perpetual', type, ...(contractCode ? { contractCode } : {}), zip: false, serialize: false, ...extra } }));

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  return res.json();
}

function checkLevels(side, asc) {
  let ordered = true;
  let cumulative = true;
  let run = 0;
  for (let i = 0; i < side.length; i++) {
    const p = Number(side[i][0]);
    if (i > 0 && (asc ? p <= Number(side[i - 1][0]) : p >= Number(side[i - 1][0]))) ordered = false;
    run += Number(side[i][1]);
    if (Math.abs(Number(side[i][2]) - run) > 1e-9 * Math.max(1, run)) cumulative = false;
  }
  return { ordered, cumulative };
}

async function book() {
  const cat = await getJson(API);
  const rows = cat.data;
  const units = new Map(rows.map((m) => [m.code, Number(m.unitAmount)]));
  const codes = ['btcusdt', 'ethusdt', 'sophusdt', 'xrpusd', 'btcusdc', 'jpn225usdt', 'qcomusdt'];
  const ws = await open();
  const st = {};
  for (const c of codes) st[c] = { frames: 0, gaps: [], ages: [], bidN: [], askN: [], unordered: 0, notCumulative: 0, identical: 0, sameTs: 0, tsBack: 0, last: null, lastText: null, lastTs: 0, lastAt: 0, keys: new Set(), echoed: new Set(), crossed: 0, oneSided: 0 };
  const acks = [];
  ws.on('message', (d) => {
    const now = Date.now();
    const s = d.toString();
    const j = JSON.parse(s);
    if (j.channel === 'subscribe') {
      acks.push({ c: j.contractCode, result: j.data?.result, ms: now - ws.openedAt });
      if (st[j.contractCode]) st[j.contractCode].ackAt = now;
      if (acks.length === 1) capture('ack.json', s);
      return;
    }
    if (j.type !== 'depth') return;
    const c = j.contractCode?.toLowerCase();
    const x = st[c];
    if (!x) return;
    x.frames++;
    if (x.frames === 1) x.firstAfterAckMs = x.ackAt ? now - x.ackAt : null;
    x.echoed.add(j.contractCode);
    Object.keys(j).forEach((k) => x.keys.add(k));
    if (x.lastAt) x.gaps.push(now - x.lastAt);
    x.ages.push(now - j.timestamp);
    if (j.timestamp === x.lastTs) x.sameTs++;
    if (j.timestamp < x.lastTs) x.tsBack++;
    const bids = j.data?.bids ?? [];
    const asks = j.data?.asks ?? [];
    x.bidN.push(bids.length);
    x.askN.push(asks.length);
    const b = checkLevels(bids, false);
    const a = checkLevels(asks, true);
    if (!b.ordered || !a.ordered) x.unordered++;
    if (!b.cumulative || !a.cumulative) x.notCumulative++;
    if (bids.length && asks.length && Number(bids[0][0]) >= Number(asks[0][0])) x.crossed++;
    if (!bids.length || !asks.length) x.oneSided++;
    const dataText = JSON.stringify(j.data);
    if (dataText === x.lastText) x.identical++;
    x.lastText = dataText;
    x.last = j;
    x.lastTs = j.timestamp;
    x.lastAt = now;
    if (x.frames === 1 && c === 'btcusdt') capture('depth-first.json', s);
  });
  for (const c of codes) sub(ws, 'depth', c);
  await sleep(20000);
  for (const c of ['btcusdt', 'sophusdt', 'xrpusd']) {
    const rest = await getJson(`${API}/products/${c}/orderbook`);
    const sock = st[c].last?.data;
    if (!sock) continue;
    const restBid = new Map(rest.bids.map((l) => [l[0], l[1]]));
    const restAsk = new Map(rest.asks.map((l) => [l[0], l[1]]));
    let same = 0;
    let priced = 0;
    for (const [p, q] of [...sock.bids.slice(0, 20)]) if (restBid.has(p)) (priced++, restBid.get(p) === q && same++);
    for (const [p, q] of [...sock.asks.slice(0, 20)]) if (restAsk.has(p)) (priced++, restAsk.get(p) === q && same++);
    log('rest_compare', { c, unit: units.get(c), socketTouch: [sock.bids[0], sock.asks[0]], restTouch: [rest.bids[0], rest.asks[0]], top40PricesAlsoInRest: priced, sameSize: same, restLevels: [rest.bids.length, rest.asks.length], socketDeepest: [sock.bids.at(-1)?.[0], sock.asks.at(-1)?.[0]], restAt50: [rest.bids[49]?.[0], rest.asks[49]?.[0]] });
  }
  await sleep(25000);
  ws.close();
  log('acks', { n: acks.length, sample: acks.slice(0, 7) });
  for (const c of codes) {
    const x = st[c];
    log('depth', { c, unit: units.get(c), firstFrameAfterAckMs: x.firstAfterAckMs, frames: x.frames, perSec: +(x.frames / 45).toFixed(2), gapMs: stats(x.gaps), ageMs: stats(x.ages), bids: [Math.min(...x.bidN), Math.max(...x.bidN)], asks: [Math.min(...x.askN), Math.max(...x.askN)], unordered: x.unordered, notCumulative: x.notCumulative, identicalToPrevious: x.identical, sameTimestamp: x.sameTs, timestampBackwards: x.tsBack, crossed: x.crossed, oneSided: x.oneSided, keys: [...x.keys], echoed: [...x.echoed], pings: ws.pings });
  }
}

async function channels() {
  const cat = await getJson(API);
  const rows = cat.data;
  const byCode = new Map(rows.map((m) => [m.code, m]));
  const ws = await open();
  const seen = {};
  const fr = { frames: 0, gaps: [], rows: [], bytes: [], lastAt: 0, btcMark: 0, btcIndex: 0, prevBtc: null, last: null, lastTs: 0, width: new Set() };
  ws.on('message', (d) => {
    const now = Date.now();
    const s = d.toString();
    const j = JSON.parse(s);
    const key = `${j.type}|${j.channel ?? 'push'}`;
    seen[key] = seen[key] ?? { n: 0, bytes: [], gaps: [], lastAt: 0 };
    const k = seen[key];
    k.n++;
    k.bytes.push(s.length);
    if (k.lastAt) k.gaps.push(now - k.lastAt);
    k.lastAt = now;
    if (k.n === 1) capture(`${j.type}-${j.channel ?? 'push'}.json`, s);
    if (j.type === 'fund_rates' && Array.isArray(j.data)) {
      fr.frames++;
      fr.rows.push(j.data.length);
      j.data.forEach((r) => fr.width.add(r.length));
      const btc = j.data.find((r) => r[0] === 'btcusdt');
      if (btc && fr.prevBtc) {
        if (btc[1] !== fr.prevBtc[1]) fr.btcMark++;
        if (btc[2] !== fr.prevBtc[2]) fr.btcIndex++;
      }
      fr.prevBtc = btc;
      fr.last = j;
      fr.lastTs = j.timestamp;
      fr.lastAt = now;
    }
  });
  sub(ws, 'ticker', 'btcusdt');
  sub(ws, 'fund_rate', 'btcusdt');
  sub(ws, 'fund_rates');
  sub(ws, 'tickers');
  sub(ws, 'fills', 'btcusdt');
  await sleep(22000);
  const prem = await getJson(`${API}/btcusdt/premiumIndex`);
  const catNow = await getJson(API);
  await sleep(23000);
  ws.close();
  for (const [k, v] of Object.entries(seen)) log('channel', { key: k, frames: v.n, bytes: stats(v.bytes), gapMs: stats(v.gaps) });
  const last = fr.last;
  if (!last) return log('fund_rates_missing', {});
  const map = new Map(last.data.map((r) => [r[0], r]));
  const inCat = rows.filter((m) => map.has(m.code)).length;
  const catNowMap = new Map(catNow.data.map((m) => [m.code, m]));
  let lastSettled = 0;
  let nextMatches = 0;
  let nextNear = 0;
  const groupVsField17 = {};
  const negativeCountdown = [];
  for (const m of catNow.data) {
    const r = map.get(m.code);
    if (!r) continue;
    if (Number(r[3]) === Number(m.fund)) lastSettled++;
    const next = last.timestamp + Number(r[5]);
    if (Math.abs(next - m.liquidationTime) < 1000) nextMatches++;
    if (Math.abs(next - m.liquidationTime) < 5000) nextNear++;
    const g = `${new Date(m.liquidationTime).toISOString().slice(11, 16)}:[17]=${r[17]}`;
    groupVsField17[g] = (groupVsField17[g] ?? 0) + 1;
  }
  for (const r of last.data) if (Number(r[5]) < 0 && !catNowMap.has(r[0])) negativeCountdown.push(r[0]);
  const btc = map.get('btcusdt');
  log('fund_rates', { frames: fr.frames, rowsPerFrame: stats(fr.rows), rowWidths: [...fr.width], catalogRows: rows.length, catalogRowsInFrame: inCat, extraRows: last.data.length - inCat, extraRowsWithNegativeCountdown: negativeCountdown.length, field3EqualsCatalogFund: lastSettled, countdownPlusTimestampWithin1sOfCatalogNext: nextMatches, within5s: nextNear, groupVsField17, btcMarkChanges: fr.btcMark, btcIndexChanges: fr.btcIndex, frameAgeAtArrival: fr.lastAt - fr.lastTs });
  log('fund_rates_btc', { row: btc, premium: { est: prem.data.estimateFeeRate, last: prem.data.lastFeeRate, next: prem.data.liquidationTime, mark: prem.data.markPrice, index: prem.data.indexPrice }, catalog: { fund: byCode.get('btcusdt')?.fund, next: byCode.get('btcusdt')?.liquidationTime } });
  const field18 = catNow.data.filter((m) => map.get(m.code) && Number(map.get(m.code)[18]) === Number(m.price)).length;
  log('fund_rates_field18_equals_catalog_last_price', { n: field18, of: inCat });
  const nonCrypto = catNow.data.filter((m) => m.assetCategory !== 'crypto' && map.get(m.code)).slice(0, 3).map((m) => [m.code, m.assetCategory, map.get(m.code)[17]]);
  log('fund_rates_field17_sample', { nonCrypto, crypto: catNow.data.filter((m) => m.assetCategory === 'crypto').slice(0, 3).map((m) => [m.code, map.get(m.code)?.[17]]) });
}

async function errors() {
  const ws = await open();
  const got = [];
  const echoed = {};
  let btcDepth = 0;
  ws.on('message', (d) => {
    const s = d.toString();
    let j;
    try {
      j = JSON.parse(s);
    } catch {
      got.push({ at: Date.now() - ws.openedAt, raw: s.slice(0, 200) });
      return;
    }
    if (j.type === 'depth' && !j.channel) {
      if (j.contractCode?.toLowerCase() === 'btcusdt') btcDepth++;
      echoed[j.contractCode] = (echoed[j.contractCode] ?? 0) + 1;
      return;
    }
    got.push({ at: Date.now() - ws.openedAt, frame: s.slice(0, 300) });
  });
  ws.on('pong', (b) => got.push({ at: Date.now() - ws.openedAt, protocolPong: b.toString() }));
  const send = async (label, text, wait = 1500) => {
    got.push({ at: Date.now() - ws.openedAt, sent: label });
    ws.send(text);
    await sleep(wait);
  };
  await send('depth nopeusdt', JSON.stringify({ event: 'subscribe', params: { biz: 'perpetual', type: 'depth', contractCode: 'nopeusdt', zip: false, serialize: false } }));
  await send('depth BTCUSDT uppercase', JSON.stringify({ event: 'subscribe', params: { biz: 'perpetual', type: 'depth', contractCode: 'BTCUSDT', zip: false, serialize: false } }));
  const upperFrames = btcDepth;
  const echoedAfterUpper = { ...echoed };
  await send('depth without contractCode', JSON.stringify({ event: 'subscribe', params: { biz: 'perpetual', type: 'depth', zip: false, serialize: false } }));
  await send('type nope', JSON.stringify({ event: 'subscribe', params: { biz: 'perpetual', type: 'nope', contractCode: 'btcusdt' } }));
  await send('biz spot', JSON.stringify({ event: 'subscribe', params: { biz: 'spot', type: 'depth', contractCode: 'btcusdt' } }));
  await send('event nope', JSON.stringify({ event: 'nope' }));
  await send('not json', 'hello');
  await send('app ping', JSON.stringify({ event: 'ping' }));
  ws.ping('probe');
  await sleep(1000);
  const beforeDup = btcDepth;
  const t = Date.now();
  await send('depth btcusdt lowercase, same stream again', JSON.stringify({ event: 'subscribe', params: { biz: 'perpetual', type: 'depth', contractCode: 'btcusdt', zip: false, serialize: false } }), 4000);
  const dupRate = (btcDepth - beforeDup) / ((Date.now() - t) / 1000);
  await send('unsubscribe depth btcusdt', JSON.stringify({ event: 'unsubscribe', params: { biz: 'perpetual', type: 'depth', contractCode: 'btcusdt', zip: false, serialize: false } }), 500);
  const afterUnsub = btcDepth;
  await sleep(3000);
  const trailing = btcDepth - afterUnsub;
  ws.close();
  for (const g of got) log('errors', g);
  log('errors_summary', { depthFramesByEchoedCodeAfterUppercase: echoedAfterUpper, depthFramesByEchoedCodeTotal: echoed, btcFramesAfterUppercaseSubscribe: upperFrames, btcFramesPerSecAfterSecondSubscribe: +dupRate.toFixed(1), btcFramesInThreeSecondsAfterUnsubscribe: trailing, serverPings: ws.pings });
}

async function batch() {
  const cat = await getJson(API);
  const usdt = cat.data.filter((m) => m.base === 'usdt').sort((a, b) => Number(b.size24) - Number(a.size24));
  const first = usdt.filter((_, i) => i % 2 === 0).slice(0, 150).map((m) => m.code);
  const second = usdt.filter((_, i) => i % 2 === 1).slice(0, 150).map((m) => m.code);
  const ws = await open();
  let phase = 1;
  const ph = { 1: { frames: 0, bytes: 0, parseUs: 0, codes: new Set(), acks: 0, nacks: 0, perSec: [] }, 2: { frames: 0, bytes: 0, parseUs: 0, codes: new Set(), acks: 0, nacks: 0, perSec: [] } };
  let secFrames = 0;
  const tick = setInterval(() => {
    ph[phase].perSec.push(secFrames);
    secFrames = 0;
  }, 1000);
  let closed = null;
  ws.on('close', (c) => (closed = { code: c, at: Date.now() - ws.openedAt }));
  ws.on('message', (d) => {
    const t0 = process.hrtime.bigint();
    const j = JSON.parse(d.toString());
    const us = Number(process.hrtime.bigint() - t0) / 1000;
    const p = ph[phase];
    if (j.channel === 'subscribe') {
      j.data?.result ? p.acks++ : p.nacks++;
      return;
    }
    p.frames++;
    secFrames++;
    p.bytes += d.length;
    p.parseUs += us;
    p.codes.add(j.contractCode);
  });
  for (const c of first) sub(ws, 'depth', c);
  await sleep(30000);
  phase = 2;
  for (const c of second) sub(ws, 'depth', c);
  await sleep(20000);
  clearInterval(tick);
  ws.close();
  for (const k of [1, 2]) {
    const p = ph[k];
    const secs = k === 1 ? 30 : 20;
    log('batch', { phase: k, subscribedTotal: k === 1 ? first.length : first.length + second.length, acks: p.acks, nacks: p.nacks, streamsDelivering: p.codes.size, framesPerSec: Math.round(p.frames / secs), perSecond: stats(p.perSec), kbPerSec: Math.round(p.bytes / secs / 1024), bytesPerFrame: Math.round(p.bytes / Math.max(1, p.frames)), parseUsPerFrame: +(p.parseUs / Math.max(1, p.frames)).toFixed(1) });
  }
  log('batch_close', { closed, pings: ws.pings });
}

async function silence() {
  const quiet = 'jpn225usdt';
  const cases = [
    { name: 'no subscribe, no send', subscribe: false, appPing: false },
    { name: 'subscribe quiet depth, no send', subscribe: true, appPing: false },
    { name: 'subscribe quiet depth, app ping every 20 s', subscribe: true, appPing: true },
    { name: 'no subscribe, app ping every 20 s', subscribe: false, appPing: true },
  ];
  const results = await Promise.all(
    cases.map(async (c) => {
      const ws = await open();
      const r = { name: c.name, frames: 0, pongs: 0, closed: null, lastFrameAt: null, maxGapMs: 0 };
      let lastAt = ws.openedAt;
      ws.on('message', (d) => {
        const now = Date.now();
        r.maxGapMs = Math.max(r.maxGapMs, now - lastAt);
        lastAt = now;
        const s = d.toString();
        if (s.includes('pong')) r.pongs++;
        else r.frames++;
        r.lastFrameAt = now - ws.openedAt;
      });
      ws.on('close', (code, reason) => (r.closed = { code, reason: reason.toString(), atMs: Date.now() - ws.openedAt }));
      if (c.subscribe) sub(ws, 'depth', quiet);
      const t = c.appPing ? setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'ping' })), 20000) : null;
      const until = Date.now() + SILENCE_MS;
      while (Date.now() < until && !r.closed) await sleep(500);
      if (t) clearInterval(t);
      r.serverPings = ws.pings;
      if (!r.closed) ws.close();
      return r;
    }),
  );
  for (const r of results) log('silence', r);
}

async function deflate() {
  const ws = await open({ perMessageDeflate: true });
  log('deflate_offer', { negotiated: ws.extensions || '(none)', openMs: ws.openMs });
  ws.close();
  await sleep(500);
  for (const variant of [{ zip: true }, { serialize: true }, { zip: true, serialize: true }]) {
    const s = await open();
    const frames = [];
    s.on('message', (d, isBinary) => frames.push({ isBinary, d }));
    s.send(JSON.stringify({ event: 'subscribe', params: { biz: 'perpetual', type: 'depth', contractCode: 'btcusdt', zip: false, serialize: false, ...variant } }));
    await sleep(4000);
    s.close();
    const summary = frames.slice(0, 3).map(({ isBinary, d }) => {
      let decoded = null;
      for (const [name, fn] of [['gunzip', gunzipSync], ['inflate', inflateSync], ['inflateRaw', inflateRawSync]]) {
        try {
          decoded = `${name}: ${fn(d).toString().slice(0, 120)}`;
          break;
        } catch {}
      }
      return { isBinary, bytes: d.length, head: isBinary ? d.subarray(0, 12).toString('hex') : d.toString().slice(0, 160), decoded };
    });
    log('variant', { variant, frames: frames.length, binaryFrames: frames.filter((f) => f.isBinary).length, summary });
    await sleep(500);
  }
}

const modes = { book, channels, errors, batch, silence, deflate };
const mode = process.argv[2] ?? 'book';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(' ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
