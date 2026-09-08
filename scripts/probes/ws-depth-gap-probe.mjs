// Live sequence gap and book correctness probe for the delta depth channels.
// Maintains a book per market from bybit orderbook.50, okx books, kraken book and coinbase level2, and checks each venue's sequence field on every frame.
// Cross-checks the maintained top of book against bybit orderbook.1, the kraken and coinbase tickers, binance depth20 against bookTicker, and a REST snapshot of quiet markets every thirty seconds.
// On a gap it resubscribes the market, capped per connection, and measures the time to the fresh snapshot and whether the gapped book had diverged from it.
// Prints a JSON summary line every minute and a final line, so a killed run still has data.
// Run from the repo root: node scripts/probes/ws-depth-gap-probe.mjs [windowSeconds] [reportEverySeconds]
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';

// Package resolution follows the importing file, so the server's node_modules is named explicitly.
const WebSocket = createRequire(new URL('../../server/package.json', import.meta.url))('ws');

const WINDOW_MS = (Number(process.argv[2]) || 1500) * 1000;
const REPORT_EVERY_MS = (Number(process.argv[3]) || 60) * 1000;
const REST_EVERY_MS = 30_000;
const REST_SPACING_MS = 2500; // under one REST request per two seconds per venue
const QUIET_MS = 3000; // a market with no delta for this long is a REST candidate
const LEVELS_COMPARED = 10;
const PERSIST_MS = 2000;
const MAX_RESUBSCRIBES_PER_CONNECTION = 10;
const PING_MS = 20_000;
const STARTED = Date.now();
let stopping = false;

const json = async (url) => (await fetch(url, { signal: AbortSignal.timeout(15000) })).json();
const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
const chunk = (a, n) => { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };

async function universe() {
  const out = {};
  const b = await json('https://fapi.binance.com/fapi/v1/exchangeInfo');
  out.binance = b.symbols.filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING').map((s) => s.symbol);
  let cursor = '';
  const bybit = [];
  do {
    const r = await json(`https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
    bybit.push(...r.result.list.filter((i) => i.status === 'Trading' && i.contractType === 'LinearPerpetual').map((i) => i.symbol));
    cursor = r.result.nextPageCursor;
  } while (cursor);
  out.bybit = bybit;
  const o = await json('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
  out.okx = o.data.filter((i) => i.state === 'live').map((i) => i.instId);
  const k = await json('https://futures.kraken.com/derivatives/api/v3/instruments');
  out.krakenfutures = k.instruments.filter((i) => i.tradeable && i.symbol.startsWith('PF_')).map((i) => i.symbol);
  const c = await json('https://api.coinbase.com/api/v3/brokerage/market/products?product_type=FUTURE&contract_expiry_type=PERPETUAL');
  out.coinbase = (c.products ?? []).filter((p) => p.product_id.endsWith('-INTX') && p.status !== 'offline').map((p) => p.product_id);
  return out;
}

// One sorted book per market: parallel price and size arrays, bids descending, asks ascending.
// keepRaw keeps the venue's own strings so a checksum can be built from them.
function lowerBound(prices, price, descending) {
  let lo = 0;
  let hi = prices.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const before = descending ? prices[mid] > price : prices[mid] < price;
    if (before) lo = mid + 1; else hi = mid;
  }
  return lo;
}

class Book {
  constructor(keepRaw = false) {
    this.bidP = []; this.bidS = []; this.askP = []; this.askS = [];
    this.keepRaw = keepRaw;
    if (keepRaw) { this.bidR = []; this.askR = []; }
  }
  reset() { this.bidP.length = 0; this.bidS.length = 0; this.askP.length = 0; this.askS.length = 0; if (this.keepRaw) { this.bidR.length = 0; this.askR.length = 0; } }
  set(side, price, size, raw) {
    const desc = side === 'bid';
    const P = desc ? this.bidP : this.askP;
    const S = desc ? this.bidS : this.askS;
    const R = this.keepRaw ? (desc ? this.bidR : this.askR) : null;
    const i = lowerBound(P, price, desc);
    const found = i < P.length && P[i] === price;
    if (size === 0) { if (found) { P.splice(i, 1); S.splice(i, 1); if (R) R.splice(i, 1); } return; }
    if (found) { S[i] = size; if (R) R[i] = raw; } else { P.splice(i, 0, price); S.splice(i, 0, size); if (R) R.splice(i, 0, raw); }
  }
  top() { return { bid: this.bidP[0] ?? 0, ask: this.askP[0] ?? 0, bidSize: this.bidS[0] ?? 0, askSize: this.askS[0] ?? 0 }; }
  levels(n) { return { bids: this.bidP.slice(0, n).map((p, i) => [p, this.bidS[i]]), asks: this.askP.slice(0, n).map((p, i) => [p, this.askS[i]]) }; }
  levelCount() { return this.bidP.length + this.askP.length; }
}

function quantiles(a) {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
  return { n: s.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: +s[s.length - 1].toFixed(1) };
}

function makeVenue(name, symbols) {
  return {
    name, symbols, conns: [], connBySym: new Map(), books: new Map(), state: new Map(),
    lastDeltaAt: new Map(), lastRestCheckAt: new Map(), market: new Map(), cmp: new Map(),
    rest: null, resubFrames: null,
    s: {
      msgs: 0, bytes: 0, data: 0, snapshots: 0, deltas: 0, resnapshots: 0, uEqualsOne: 0, deltaBeforeSnapshot: 0, unknownSymbol: 0,
      gaps: 0, gapSizes: [], gapExamples: [], outOfOrder: 0, noops: 0, resets: 0, seqRegress: 0, noSeq: 0,
      closes: 0, errors: 0, errorSamples: [], reconnects: 0, controlSamples: [],
      resub: { requested: 0, recovered: 0, capped: 0, recoveryMs: [] },
      gapDiv: { compared: 0, topDiverged: 0, top10Diverged: 0, examples: [] },
      checksum: { present: 0, nonzero: 0, pass: 0, fail: 0 },
      krakenSeq: { perProductOk: 0, perProductBad: 0, perConnOk: 0, perConnBad: 0, rule: 'undecided' },
      binanceSkips: 0,
      l1: { msgs: 0, sameSeq: 0, sameSeqMismatch: 0, sameSeqExamples: [], mismatchOnArrival: 0, disagreements: 0, persistedOver2s: 0, oscillations: 0, lagTickerBehindBook: [], lagBookBehindTicker: [] },
      restCheck: { checks: 0, matches: 0, mismatches: 0, skipped: 0, failed: 0, examples: [] },
    },
  };
}

function market(v, sym) {
  let m = v.market.get(sym);
  if (!m) { m = { topChanges: 0, tickerMsgs: 0, lagT: [], lagB: [] }; v.market.set(sym, m); }
  return m;
}

// Agreement tracker between the book top and the venue's own top of book source.
// When the two disagree the one that moves last to restore agreement is the laggard, and the disagreement length is its lag.
function trackCmp(v, sym, side, bid, ask, now) {
  if (!bid || !ask) return;
  let c = v.cmp.get(sym);
  if (!c) { c = { book: null, ticker: null, agree: null, disagreeSince: 0, firstMover: null, persisted: false }; v.cmp.set(sym, c); }
  c[side] = { bid, ask };
  if (!c.book || !c.ticker) return;
  const eq = c.book.bid === c.ticker.bid && c.book.ask === c.ticker.ask;
  if (c.agree === null) { c.agree = eq; if (!eq) { c.disagreeSince = now; c.firstMover = side; } return; }
  if (c.agree && !eq) { c.agree = false; c.disagreeSince = now; c.firstMover = side; c.persisted = false; v.s.l1.disagreements++; return; }
  if (!c.agree && eq) {
    c.agree = true;
    const lag = now - c.disagreeSince;
    if (side === c.firstMover) { v.s.l1.oscillations++; return; }
    const m = market(v, sym);
    if (side === 'ticker') { v.s.l1.lagTickerBehindBook.push(lag); m.lagT.push(lag); } else { v.s.l1.lagBookBehindTicker.push(lag); m.lagB.push(lag); }
  }
}

function sweepPersistence(v, now) {
  for (const c of v.cmp.values()) {
    if (c.agree === false && !c.persisted && now - c.disagreeSince > PERSIST_MS) { c.persisted = true; v.s.l1.persistedOver2s++; }
  }
}

function onTicker(v, sym, bid, ask, now) {
  v.s.l1.msgs++;
  market(v, sym).tickerMsgs++;
  const book = v.books.get(sym);
  if (book) { const t = book.top(); if (t.bid !== bid || t.ask !== ask) v.s.l1.mismatchOnArrival++; }
  trackCmp(v, sym, 'ticker', bid, ask, now);
}

function afterBookUpdate(v, sym, book, now, snapshot, before) {
  v.lastDeltaAt.set(sym, now);
  const t = book.top();
  if (!before || before.bid !== t.bid || before.ask !== t.ask) {
    if (!snapshot) market(v, sym).topChanges++;
    trackCmp(v, sym, 'book', t.bid, t.ask, now);
  }
}

function gap(v, sym, st, conn, size, note) {
  v.s.gaps++;
  if (v.s.gapSizes.length < 5000) v.s.gapSizes.push(size);
  if (v.s.gapExamples.length < 8) v.s.gapExamples.push({ sym, note, at: new Date().toISOString() });
  st.gapped = true;
  resubscribe(v, sym, st, conn);
}

function resubscribe(v, sym, st, conn) {
  if (!v.resubFrames || !conn || conn.ws.readyState !== 1) return;
  if (conn.resubs >= MAX_RESUBSCRIBES_PER_CONNECTION) { v.s.resub.capped++; return; }
  conn.resubs++;
  for (const f of v.resubFrames(sym, conn)) conn.ws.send(JSON.stringify(f));
  st.resubAt = Date.now();
  v.s.resub.requested++;
}

// A snapshot arriving for a gapped book shows whether the gap had actually changed anything a reader could see.
function gapDivergence(v, sym, book, snapBids, snapAsks) {
  const mine = book.levels(LEVELS_COMPARED);
  const theirs = { bids: snapBids.slice(0, LEVELS_COMPARED), asks: snapAsks.slice(0, LEVELS_COMPARED) };
  const d = v.s.gapDiv;
  d.compared++;
  const topDiff = mine.bids[0]?.[0] !== theirs.bids[0]?.[0] || mine.asks[0]?.[0] !== theirs.asks[0]?.[0] || mine.bids[0]?.[1] !== theirs.bids[0]?.[1] || mine.asks[0]?.[1] !== theirs.asks[0]?.[1];
  const anyDiff = topDiff || JSON.stringify(mine) !== JSON.stringify(theirs);
  if (topDiff) d.topDiverged++;
  if (anyDiff) d.top10Diverged++;
  if (anyDiff && d.examples.length < 3) d.examples.push({ sym, mine: { bids: mine.bids.slice(0, 3), asks: mine.asks.slice(0, 3) }, snapshot: { bids: theirs.bids.slice(0, 3), asks: theirs.asks.slice(0, 3) } });
}

function onSnapshotArrived(v, sym, st, now) {
  if (st.resubAt) { v.s.resub.recovered++; v.s.resub.recoveryMs.push(now - st.resubAt); st.resubAt = 0; }
  st.gapped = false;
}

function open(v, plan, onOpen, onMessage) {
  const ws = new WebSocket(plan.url, { perMessageDeflate: false });
  const conn = { ws, plan, resubs: 0, lastSeq: null, ping: null, alive: true, openedAt: 0 };
  v.conns.push(conn);
  if (plan.kind === 'book') for (const s of plan.symbols) v.connBySym.set(s, conn);
  ws.on('open', () => { conn.openedAt = Date.now(); Promise.resolve(onOpen(conn)).catch((e) => { v.s.errors++; if (v.s.errorSamples.length < 3) v.s.errorSamples.push(`open ${e.message}`); }); });
  ws.on('message', (raw) => {
    const text = raw.toString('utf8');
    v.s.msgs++; v.s.bytes += text.length;
    if (text === 'pong') return;
    let j;
    try { j = JSON.parse(text); } catch { return; }
    try { onMessage(j, conn, text); } catch (e) { v.s.errors++; if (v.s.errorSamples.length < 3) v.s.errorSamples.push(`${String(e.stack).slice(0, 300)} :: ${text.slice(0, 200)}`); }
  });
  ws.on('error', (e) => { v.s.errors++; if (v.s.errorSamples.length < 3) v.s.errorSamples.push(`socket ${e.message}`); });
  ws.on('close', (code) => {
    v.s.closes++;
    conn.alive = false;
    if (conn.ping) clearInterval(conn.ping);
    if (v.s.controlSamples.length < 6) v.s.controlSamples.push(`close ${code} ${plan.kind} after ${Date.now() - conn.openedAt} ms`);
    if (stopping) return;
    v.s.reconnects++;
    if (plan.kind === 'book') for (const s of plan.symbols) { v.books.delete(s); v.state.delete(s); }
    setTimeout(() => open(v, plan, onOpen, onMessage), 2000);
  });
  return conn;
}

function control(v, j, text) {
  if (j.event === 'error' || j.success === false || j.error || j.type === 'error') v.s.errors++;
  if (v.s.controlSamples.length < 6) v.s.controlSamples.push(text.slice(0, 160));
}

// bybit: orderbook.50 kept as the book, orderbook.1 on separate connections as the venue's own top of book.
const BYBIT_URL = 'wss://stream.bybit.com/v5/public/linear';
async function startBybit(v) {
  v.resubFrames = (sym) => [{ op: 'unsubscribe', args: [`orderbook.50.${sym}`] }, { op: 'subscribe', args: [`orderbook.50.${sym}`] }];
  v.rest = async (sym) => {
    const j = await json(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${sym}&limit=25`);
    if (j.retCode !== 0 || !j.result || j.result.ts === 0) return null;
    return { bids: j.result.b.map((l) => [Number(l[0]), Number(l[1])]), asks: j.result.a.map((l) => [Number(l[0]), Number(l[1])]) };
  };
  const groups = chunk(v.symbols, 200);
  for (const depth of [50, 1]) {
    for (const g of groups) {
      open(v, { url: BYBIT_URL, symbols: g, kind: depth === 50 ? 'book' : 'l1' }, (c) => {
        c.ws.send(JSON.stringify({ op: 'subscribe', args: g.map((s) => `orderbook.${depth}.${s}`) }));
        c.ping = setInterval(() => { if (c.ws.readyState === 1) c.ws.send('{"op":"ping"}'); }, PING_MS);
      }, (j, c, text) => onBybit(v, j, c, text));
    }
  }
}

function onBybit(v, j, c, text) {
  if (!j.topic || !j.topic.startsWith('orderbook.')) return control(v, j, text);
  const d = j.data;
  const sym = d.s;
  const now = Date.now();
  if (j.topic.startsWith('orderbook.1.')) {
    const bid = Number(d.b?.[0]?.[0] ?? 0);
    const ask = Number(d.a?.[0]?.[0] ?? 0);
    if (!bid || !ask) return;
    const st = v.state.get(sym);
    const book = v.books.get(sym);
    if (st && book && d.seq === st.seq) {
      const t = book.top();
      if (t.bid === bid && t.ask === ask) v.s.l1.sameSeq++;
      else { v.s.l1.sameSeqMismatch++; if (v.s.l1.sameSeqExamples.length < 3) v.s.l1.sameSeqExamples.push({ sym, seq: d.seq, l1: [bid, ask], book: [t.bid, t.ask] }); }
    }
    onTicker(v, sym, bid, ask, now);
    return;
  }
  v.s.data++;
  let book = v.books.get(sym);
  let st = v.state.get(sym);
  if (j.type === 'snapshot') {
    v.s.snapshots++;
    if (book) { v.s.resnapshots++; if (d.u === 1) v.s.uEqualsOne++; if (st?.gapped) gapDivergence(v, sym, book, d.b.map((l) => [Number(l[0]), Number(l[1])]), d.a.map((l) => [Number(l[0]), Number(l[1])])); }
    else { book = new Book(); v.books.set(sym, book); }
    book.reset();
    for (const l of d.b) book.set('bid', Number(l[0]), Number(l[1]));
    for (const l of d.a) book.set('ask', Number(l[0]), Number(l[1]));
    if (!st) { st = { u: d.u, seq: d.seq, gapped: false, resubAt: 0 }; v.state.set(sym, st); } else { st.u = d.u; st.seq = d.seq; }
    onSnapshotArrived(v, sym, st, now);
    afterBookUpdate(v, sym, book, now, true, null);
    return;
  }
  if (!book || !st) { v.s.deltaBeforeSnapshot++; return; }
  v.s.deltas++;
  if (d.u === st.u + 1) { /* consecutive */ }
  else if (d.u <= st.u) v.s.outOfOrder++;
  else gap(v, sym, st, c, d.u - st.u - 1, `u ${st.u} then ${d.u}`);
  if (d.seq < st.seq) v.s.seqRegress++;
  st.u = d.u; st.seq = d.seq;
  const before = book.top();
  for (const l of d.b) book.set('bid', Number(l[0]), Number(l[1]));
  for (const l of d.a) book.set('ask', Number(l[0]), Number(l[1]));
  afterBookUpdate(v, sym, book, now, false, before);
}

// okx: books, 400 levels a side, seqId chain. The checksum field is deprecated and fixed at zero since 2026-06-23, so it is verified only when nonzero.
const OKX_URL = 'wss://ws.okx.com:8443/ws/v5/public';
let okxSubId = 0;
async function startOkx(v) {
  v.resubFrames = (sym) => [{ op: 'unsubscribe', args: [{ channel: 'books', instId: sym }] }, { id: `r${++okxSubId}`, op: 'subscribe', args: [{ channel: 'books', instId: sym }] }];
  v.rest = async (sym) => {
    const j = await json(`https://www.okx.com/api/v5/market/books?instId=${sym}&sz=20`);
    if (j.code !== '0' || !j.data?.[0]) return null;
    return { bids: j.data[0].bids.map((l) => [Number(l[0]), Number(l[1])]), asks: j.data[0].asks.map((l) => [Number(l[0]), Number(l[1])]) };
  };
  const groups = chunk(v.symbols, 250);
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) await sleep(400);
    const g = groups[i];
    open(v, { url: OKX_URL, symbols: g, kind: 'book' }, (c) => {
      chunk(g, 200).forEach((s) => c.ws.send(JSON.stringify({ id: `s${++okxSubId}`, op: 'subscribe', args: s.map((x) => ({ channel: 'books', instId: x })) })));
      c.ping = setInterval(() => { if (c.ws.readyState === 1) c.ws.send('ping'); }, PING_MS);
    }, (j, c, text) => onOkx(v, j, c, text));
  }
}

function okxChecksum(book) {
  const parts = [];
  for (let i = 0; i < 25; i++) {
    if (i < book.bidR.length) parts.push(`${book.bidR[i][0]}:${book.bidR[i][1]}`);
    if (i < book.askR.length) parts.push(`${book.askR[i][0]}:${book.askR[i][1]}`);
  }
  return crc32(Buffer.from(parts.join(':'))) | 0;
}

function onOkx(v, j, c, text) {
  if (!j.arg || !Array.isArray(j.data)) return control(v, j, text);
  const sym = j.arg.instId;
  const d = j.data[0];
  const now = Date.now();
  v.s.data++;
  let book = v.books.get(sym);
  let st = v.state.get(sym);
  if (j.action === 'snapshot') {
    v.s.snapshots++;
    if (book) { v.s.resnapshots++; if (st?.gapped) gapDivergence(v, sym, book, d.bids.map((l) => [Number(l[0]), Number(l[1])]), d.asks.map((l) => [Number(l[0]), Number(l[1])])); }
    else { book = new Book(true); v.books.set(sym, book); }
    book.reset();
    for (const l of d.bids) book.set('bid', Number(l[0]), Number(l[1]), [l[0], l[1]]);
    for (const l of d.asks) book.set('ask', Number(l[0]), Number(l[1]), [l[0], l[1]]);
    if (!st) { st = { seqId: d.seqId, gapped: false, resubAt: 0 }; v.state.set(sym, st); } else st.seqId = d.seqId;
    onSnapshotArrived(v, sym, st, now);
    afterBookUpdate(v, sym, book, now, true, null);
    return;
  }
  if (!book || !st) { v.s.deltaBeforeSnapshot++; return; }
  v.s.deltas++;
  if (d.prevSeqId === st.seqId) { /* chained */ }
  else if (d.seqId < st.seqId) v.s.resets++;
  else gap(v, sym, st, c, d.prevSeqId - st.seqId, `seqId ${st.seqId} then prevSeqId ${d.prevSeqId} seqId ${d.seqId}`);
  if (d.bids.length === 0 && d.asks.length === 0) v.s.noops++;
  st.seqId = d.seqId;
  const before = book.top();
  for (const l of d.bids) book.set('bid', Number(l[0]), Number(l[1]), [l[0], l[1]]);
  for (const l of d.asks) book.set('ask', Number(l[0]), Number(l[1]), [l[0], l[1]]);
  if (d.checksum !== undefined) {
    v.s.checksum.present++;
    if (d.checksum !== 0) { v.s.checksum.nonzero++; if (okxChecksum(book) === d.checksum) v.s.checksum.pass++; else v.s.checksum.fail++; }
  }
  afterBookUpdate(v, sym, book, now, false, before);
}

// kraken: book on three connections, ticker on three more. seq scope is undocumented, so both readings are counted and the consecutive one is adopted after 200 deltas.
const KRAKEN_URL = 'wss://futures.kraken.com/ws/v1';
async function startKraken(v) {
  v.resubFrames = (sym) => [{ event: 'unsubscribe', feed: 'book', product_ids: [sym] }, { event: 'subscribe', feed: 'book', product_ids: [sym] }];
  v.rest = async (sym) => {
    const j = await json(`https://futures.kraken.com/derivatives/api/v3/orderbook?symbol=${sym}`);
    if (j.result !== 'success') return null;
    const bids = j.orderBook.bids.map((l) => [l[0], l[1]]).sort((a, b) => b[0] - a[0]);
    const asks = j.orderBook.asks.map((l) => [l[0], l[1]]).sort((a, b) => a[0] - b[0]);
    return { bids, asks };
  };
  const groups = chunk(v.symbols, 100);
  for (const feed of ['book', 'ticker']) {
    for (const g of groups) {
      open(v, { url: KRAKEN_URL, symbols: g, kind: feed === 'book' ? 'book' : 'ticker' }, (c) => {
        c.ws.send(JSON.stringify({ event: 'subscribe', feed, product_ids: g }));
      }, (j, c, text) => onKraken(v, j, c, text));
    }
  }
}

function krakenDecide(v) {
  const k = v.s.krakenSeq;
  const prod = k.perProductOk + k.perProductBad;
  const conn = k.perConnOk + k.perConnBad;
  if (k.rule !== 'undecided' || prod < 200 || conn < 200) return;
  const prodBad = k.perProductBad / prod;
  const connBad = k.perConnBad / conn;
  const best = prodBad <= connBad ? 'product' : 'connection';
  k.rule = Math.min(prodBad, connBad) > 0.05 ? 'none' : best;
}

function onKraken(v, j, c, text) {
  const now = Date.now();
  if (j.feed === 'ticker' && j.product_id) {
    const bid = Number(j.bid);
    const ask = Number(j.ask);
    if (!bid || !ask) return;
    onTicker(v, j.product_id, bid, ask, now);
    return;
  }
  if (j.feed === 'book_snapshot') {
    const sym = j.product_id;
    v.s.data++; v.s.snapshots++;
    let book = v.books.get(sym);
    let st = v.state.get(sym);
    if (book) { v.s.resnapshots++; if (st?.gapped) gapDivergence(v, sym, book, j.bids.map((l) => [l.price, l.qty]), j.asks.map((l) => [l.price, l.qty])); }
    else { book = new Book(); v.books.set(sym, book); }
    book.reset();
    for (const l of j.bids) book.set('bid', l.price, l.qty);
    for (const l of j.asks) book.set('ask', l.price, l.qty);
    if (!st) { st = { seq: j.seq, gapped: false, resubAt: 0 }; v.state.set(sym, st); } else st.seq = j.seq;
    c.lastSeq = j.seq;
    onSnapshotArrived(v, sym, st, now);
    afterBookUpdate(v, sym, book, now, true, null);
    return;
  }
  if (j.feed === 'book' && j.product_id) {
    const sym = j.product_id;
    v.s.data++;
    const book = v.books.get(sym);
    const st = v.state.get(sym);
    if (!book || !st) { v.s.deltaBeforeSnapshot++; return; }
    v.s.deltas++;
    const k = v.s.krakenSeq;
    const prodOk = j.seq === st.seq + 1;
    const connOk = c.lastSeq === null || j.seq === c.lastSeq + 1;
    if (prodOk) k.perProductOk++; else k.perProductBad++;
    if (connOk) k.perConnOk++; else k.perConnBad++;
    krakenDecide(v);
    if (k.rule === 'product' && !prodOk) { if (j.seq <= st.seq) v.s.outOfOrder++; else gap(v, sym, st, c, j.seq - st.seq - 1, `seq ${st.seq} then ${j.seq}`); }
    if (k.rule === 'connection' && !connOk) { if (j.seq <= c.lastSeq) v.s.outOfOrder++; else { v.s.gaps++; if (v.s.gapSizes.length < 5000) v.s.gapSizes.push(j.seq - c.lastSeq - 1); if (v.s.gapExamples.length < 8) v.s.gapExamples.push({ sym, note: `connection seq ${c.lastSeq} then ${j.seq}`, at: new Date().toISOString() }); } }
    st.seq = j.seq;
    c.lastSeq = j.seq;
    const before = book.top();
    book.set(j.side === 'buy' ? 'bid' : 'ask', j.price, j.qty);
    afterBookUpdate(v, sym, book, now, false, before);
    return;
  }
  control(v, j, text);
}

// coinbase: level2 and ticker on the same connection, 30 products each, sequence_num checked across every message on the connection.
const COINBASE_URL = 'wss://advanced-trade-ws.coinbase.com';
const COINBASE_RESUB_CAP = 5;
async function startCoinbase(v) {
  v.rest = async (sym) => {
    const j = await json(`https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id=${sym}&limit=20&_=${Date.now()}`);
    if (!j.pricebook) return null;
    return { bids: j.pricebook.bids.map((l) => [Number(l.price), Number(l.size)]), asks: j.pricebook.asks.map((l) => [Number(l.price), Number(l.size)]) };
  };
  const groups = chunk(v.symbols, 30);
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) await sleep(300);
    const g = groups[i];
    open(v, { url: COINBASE_URL, symbols: g, kind: 'book' }, async (c) => {
      c.ws.send(JSON.stringify({ type: 'subscribe', channel: 'level2', product_ids: g }));
      await sleep(300);
      c.ws.send(JSON.stringify({ type: 'subscribe', channel: 'ticker', product_ids: g }));
      await sleep(300);
      c.ws.send(JSON.stringify({ type: 'subscribe', channel: 'heartbeats' }));
    }, (j, c, text) => onCoinbase(v, j, c, text));
  }
}

function onCoinbase(v, j, c, text) {
  const now = Date.now();
  if (typeof j.sequence_num === 'number') {
    if (c.lastSeq !== null) {
      if (j.sequence_num === c.lastSeq + 1) { /* consecutive */ }
      else if (j.sequence_num > c.lastSeq) {
        v.s.gaps++;
        if (v.s.gapSizes.length < 5000) v.s.gapSizes.push(j.sequence_num - c.lastSeq - 1);
        if (v.s.gapExamples.length < 8) v.s.gapExamples.push({ sym: c.plan.symbols[0], note: `connection sequence_num ${c.lastSeq} then ${j.sequence_num} on channel ${j.channel}`, at: new Date().toISOString() });
        for (const s of c.plan.symbols) { const st = v.state.get(s); if (st) st.gapped = true; }
        if (c.resubs < COINBASE_RESUB_CAP) {
          c.resubs++;
          c.ws.send(JSON.stringify({ type: 'unsubscribe', channel: 'level2', product_ids: c.plan.symbols }));
          c.ws.send(JSON.stringify({ type: 'subscribe', channel: 'level2', product_ids: c.plan.symbols }));
          for (const s of c.plan.symbols) { const st = v.state.get(s); if (st) st.resubAt = now; }
          v.s.resub.requested++;
        } else v.s.resub.capped++;
      } else v.s.outOfOrder++;
    }
    c.lastSeq = j.sequence_num;
  } else v.s.noSeq++;
  if (j.channel === 'l2_data') {
    for (const ev of j.events ?? []) {
      const sym = ev.product_id;
      v.s.data++;
      let book = v.books.get(sym);
      let st = v.state.get(sym);
      const snapshot = ev.type === 'snapshot';
      if (snapshot) {
        v.s.snapshots++;
        const bids = []; const asks = [];
        for (const u of ev.updates ?? []) (u.side === 'bid' ? bids : asks).push([Number(u.price_level), Number(u.new_quantity)]);
        if (book) { v.s.resnapshots++; if (st?.gapped) gapDivergence(v, sym, book, bids.sort((a, b) => b[0] - a[0]), asks.sort((a, b) => a[0] - b[0])); }
        else { book = new Book(); v.books.set(sym, book); }
        book.reset();
        if (!st) { st = { gapped: false, resubAt: 0 }; v.state.set(sym, st); }
      } else if (!book || !st) { v.s.deltaBeforeSnapshot++; continue; }
      else v.s.deltas++;
      const before = book.top();
      for (const u of ev.updates ?? []) book.set(u.side === 'bid' ? 'bid' : 'ask', Number(u.price_level), Number(u.new_quantity));
      if (snapshot) { onSnapshotArrived(v, sym, st, now); afterBookUpdate(v, sym, book, now, true, null); }
      else afterBookUpdate(v, sym, book, now, false, before);
    }
    return;
  }
  if (j.channel === 'ticker') {
    for (const ev of j.events ?? []) for (const t of ev.tickers ?? []) {
      const bid = Number(t.best_bid);
      const ask = Number(t.best_ask);
      if (!bid || !ask) continue;
      onTicker(v, t.product_id, bid, ask, now);
    }
    return;
  }
  if (j.channel === 'heartbeats' || j.channel === 'subscriptions') return;
  control(v, j, text);
}

// binance: depth20 is the book, bookTicker on the same connection is the venue's own top of book. pu against the previous u counts skipped snapshots.
const BINANCE_URL = 'wss://fstream.binance.com/public/ws';
async function startBinance(v) {
  const groups = chunk(v.symbols, 200);
  for (const g of groups) {
    open(v, { url: BINANCE_URL, symbols: g, kind: 'book' }, async (c) => {
      let id = 0;
      const frames = [
        ...chunk(g, 100).map((s) => ({ method: 'SUBSCRIBE', params: s.map((x) => `${x.toLowerCase()}@depth20@100ms`), id: ++id })),
        ...chunk(g, 100).map((s) => ({ method: 'SUBSCRIBE', params: s.map((x) => `${x.toLowerCase()}@bookTicker`), id: ++id })),
      ];
      for (const f of frames) { c.ws.send(JSON.stringify(f)); await sleep(250); }
    }, (j, c, text) => onBinance(v, j, c, text));
  }
}

function onBinance(v, j, c, text) {
  const now = Date.now();
  if (j.e === 'depthUpdate') {
    const sym = j.s;
    v.s.data++; v.s.snapshots++;
    let book = v.books.get(sym);
    let st = v.state.get(sym);
    if (!book) { book = new Book(); v.books.set(sym, book); }
    if (st && j.pu !== st.u) v.s.binanceSkips++;
    if (!st) { st = { u: j.u, gapped: false, resubAt: 0 }; v.state.set(sym, st); } else st.u = j.u;
    const before = book.top();
    book.reset();
    for (const l of j.b) { book.bidP.push(Number(l[0])); book.bidS.push(Number(l[1])); }
    for (const l of j.a) { book.askP.push(Number(l[0])); book.askS.push(Number(l[1])); }
    afterBookUpdate(v, sym, book, now, false, before);
    return;
  }
  if (j.e === 'bookTicker') {
    const bid = Number(j.b);
    const ask = Number(j.a);
    if (!bid || !ask) return;
    onTicker(v, j.s, bid, ask, now);
    return;
  }
  control(v, j, text);
}

// REST cross-check of quiet markets: top ten levels a side must match exactly, and a delta during the fetch voids the sample.
async function restCheck(v) {
  if (!v.rest) return;
  const now = Date.now();
  const cands = [...v.books.keys()]
    .filter((s) => now - (v.lastDeltaAt.get(s) ?? 0) > QUIET_MS && !(v.state.get(s)?.gapped))
    .sort((a, b) => (v.lastRestCheckAt.get(a) ?? 0) - (v.lastRestCheckAt.get(b) ?? 0))
    .slice(0, 3);
  for (const sym of cands) {
    v.lastRestCheckAt.set(sym, Date.now());
    const t0 = Date.now();
    let snap;
    try { snap = await v.rest(sym); } catch (e) { v.s.restCheck.failed++; await sleep(REST_SPACING_MS); continue; }
    if (!snap) { v.s.restCheck.skipped++; await sleep(REST_SPACING_MS); continue; }
    const book = v.books.get(sym);
    if (!book || (v.lastDeltaAt.get(sym) ?? 0) > t0) { v.s.restCheck.skipped++; await sleep(REST_SPACING_MS); continue; }
    const mine = book.levels(LEVELS_COMPARED);
    let diff = null;
    for (const side of ['bids', 'asks']) {
      const a = mine[side];
      const b = snap[side].slice(0, LEVELS_COMPARED);
      const n = Math.min(a.length, b.length, LEVELS_COMPARED);
      if (Math.min(a.length, LEVELS_COMPARED) !== Math.min(b.length, LEVELS_COMPARED)) { diff = `${side} length ${a.length} vs ${b.length}`; break; }
      for (let i = 0; i < n; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) { diff = `${side}[${i}] mine ${a[i]} rest ${b[i]}`; break; }
      if (diff) break;
    }
    v.s.restCheck.checks++;
    if (diff === null) v.s.restCheck.matches++;
    else {
      v.s.restCheck.mismatches++;
      if (v.s.restCheck.examples.length < 3) v.s.restCheck.examples.push({ sym, quietMs: t0 - (v.lastDeltaAt.get(sym) ?? 0), firstDiff: diff, mine: { bids: mine.bids.slice(0, 3), asks: mine.asks.slice(0, 3) }, rest: { bids: snap.bids.slice(0, 3), asks: snap.asks.slice(0, 3) } });
    }
    await sleep(REST_SPACING_MS);
  }
}

function report(venues, final) {
  const elapsedMs = Date.now() - STARTED;
  const hours = elapsedMs / 3_600_000;
  const out = { at: new Date().toISOString(), elapsedSec: Math.round(elapsedMs / 1000), final, venues: {} };
  for (const v of venues) {
    const s = v.s;
    const top = [...v.market.entries()].sort((a, b) => b[1].topChanges - a[1].topChanges).slice(0, 10).map(([sym, m]) => ({
      sym, topChangesPerSec: +(m.topChanges / (elapsedMs / 1000)).toFixed(2), tickerPerSec: +(m.tickerMsgs / (elapsedMs / 1000)).toFixed(2),
      lagTickerBehindBookMs: quantiles(m.lagT), lagBookBehindTickerMs: quantiles(m.lagB),
    }));
    let levels = 0;
    for (const b of v.books.values()) levels += b.levelCount();
    let tickerMarkets = 0; let bookMarkets = 0;
    for (const m of v.market.values()) { if (m.tickerMsgs) tickerMarkets++; if (m.topChanges) bookMarkets++; }
    out.venues[v.name] = {
      markets: v.symbols.length, booksHeld: v.books.size, levelsHeld: levels, connections: v.conns.filter((c) => c.alive).length, closes: s.closes, reconnects: s.reconnects, errors: s.errors, errorSamples: s.errorSamples, controlSamples: s.controlSamples,
      msgs: s.msgs, msgsPerSec: +(s.msgs / (elapsedMs / 1000)).toFixed(0), data: s.data, snapshots: s.snapshots, deltas: s.deltas, resnapshots: s.resnapshots, uEqualsOne: s.uEqualsOne, deltaBeforeSnapshot: s.deltaBeforeSnapshot,
      seq: { gaps: s.gaps, gapsPerMarketHour: +(s.gaps / Math.max(1e-9, v.symbols.length * hours)).toFixed(4), gapSizes: quantiles(s.gapSizes), outOfOrder: s.outOfOrder, noopUpdates: s.noops, resets: s.resets, seqRegress: s.seqRegress, framesWithoutSeq: s.noSeq, examples: s.gapExamples },
      resub: { ...s.resub, recoveryMs: quantiles(s.resub.recoveryMs) },
      gapDivergence: s.gapDiv,
      checksum: s.checksum,
      krakenSeq: v.name === 'krakenfutures' ? s.krakenSeq : undefined,
      binanceSkippedSnapshots: v.name === 'binance' ? s.binanceSkips : undefined,
      topOfBookCheck: {
        tickerMsgs: s.l1.msgs, tickerMarkets, bookMarkets, sameSeqMatches: s.l1.sameSeq, sameSeqMismatches: s.l1.sameSeqMismatch, sameSeqExamples: s.l1.sameSeqExamples,
        mismatchOnArrival: s.l1.mismatchOnArrival, mismatchOnArrivalShare: s.l1.msgs ? +(s.l1.mismatchOnArrival / s.l1.msgs).toFixed(3) : null,
        disagreements: s.l1.disagreements, persistedOver2s: s.l1.persistedOver2s, oscillations: s.l1.oscillations,
        lagTickerBehindBookMs: quantiles(s.l1.lagTickerBehindBook), lagBookBehindTickerMs: quantiles(s.l1.lagBookBehindTicker),
      },
      restCheck: s.restCheck,
      topMarkets: top,
    };
  }
  console.log(JSON.stringify(out));
}

const u = await universe();
console.log(JSON.stringify({ universe: Object.fromEntries(Object.entries(u).map(([k, val]) => [k, val.length])), windowSec: WINDOW_MS / 1000, startedAt: new Date(STARTED).toISOString() }));
const venues = [makeVenue('bybit', u.bybit), makeVenue('okx', u.okx), makeVenue('krakenfutures', u.krakenfutures), makeVenue('coinbase', u.coinbase), makeVenue('binance', u.binance)];
await Promise.all([startBybit(venues[0]), startOkx(venues[1]), startKraken(venues[2]), startCoinbase(venues[3]), startBinance(venues[4])]);

const timers = [];
timers.push(setInterval(() => { const now = Date.now(); for (const v of venues) sweepPersistence(v, now); }, 1000));
timers.push(setInterval(() => report(venues, false), REPORT_EVERY_MS));
venues.forEach((v, i) => { if (v.rest) setTimeout(() => { restCheck(v); timers.push(setInterval(() => restCheck(v), REST_EVERY_MS)); }, 20_000 + i * 5000); });

await sleep(WINDOW_MS);
stopping = true;
for (const t of timers) clearInterval(t);
report(venues, true);
for (const v of venues) for (const c of v.conns) { try { if (c.ping) clearInterval(c.ping); c.ws.terminate(); } catch {} }
process.exit(0);
