// SecondBTC public socket probe: the Socket.IO server behind socket.secondbtc.com, its WebSocket refusal, the order book event on the long-polling transport, rooms, errors and keepalive.
// Public, unauthenticated, read-only. WebSocket attempts open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// The market info event carries the venue's own market maker settings, including fields named userApiKey and userSecretKey.
// This probe never prints or stores their values: every mmSetting object is reduced to its key names and its priceSource before anything is logged or written.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/secondbtc/ws-probe.mjs [transport|book|multi|unknown|silence]
//   transport  WebSocket upgrade with and without a session id, with an Origin header, with a deflate offer, and the EIO=3 handshake. About 10 s.
//   book       one polling session: 12 s connected with no emit, 20 s after createRoom BTC_USDT, 30 s after the other emits, with REST depth compares. About 65 s.
//   multi      one polling session that joins SOL_USDT, ETH_USDT and BTC_USDT rooms in that order. About 40 s.
//   unknown    one fresh session per room: ETH_USDT, SOL_USDT, the thin SBTC_USDT, the disabled MBASE_USDT, NOPE_USDT and the symbol spelled BTCUSDT, then an unknown event and a malformed packet. About 60 s.
//   silence    two polling sessions, one answers pings and one does not, for up to 80 s.
// Set PROBE_OUT_DIR to keep trimmed, redacted frames. Recorded in docs/profiles/secondbtc/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const HOST = 'socket.secondbtc.com';
const POLL = `https://${HOST}/socket.io/?EIO=4&transport=polling`;
const REST = 'https://api.secondbtc.com/api/v1/depth?limit=5&symbol=';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const t0 = Date.now();
const ms = () => Date.now() - t0;

function redact(data) {
  const info = data?.data?.marketInfo;
  if (info?.mmSetting) info.mmSetting = { redactedKeys: Object.keys(info.mmSetting), priceSource: info.mmSetting.priceSource };
  return data;
}

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 3000) + '\n');
}

// A minimal Socket.IO v4 client on the Engine.IO long-polling transport.
class PollSession {
  constructor(name, { answerPings = true } = {}) {
    this.name = name;
    this.answerPings = answerPings;
    this.events = [];
    this.pings = [];
    this.closed = null;
    this.stopped = false;
  }

  async open() {
    const r = await fetch(POLL, { signal: AbortSignal.timeout(10000) });
    const txt = await r.text();
    this.handshake = JSON.parse(txt.slice(1));
    this.url = `${POLL}&sid=${this.handshake.sid}`;
    log('handshake', { session: this.name, status: r.status, atMs: ms(), packet: txt, setCookie: r.headers.get('set-cookie') });
    this.loop = this.pollLoop();
    log('post', { session: this.name, packet: '40', reply: await this.post('40') });
  }

  async post(body) {
    const r = await fetch(this.url, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8' }, signal: AbortSignal.timeout(10000) });
    return `${r.status} ${(await r.text()).slice(0, 120)}`;
  }

  emit(event, arg) {
    return this.post('42' + JSON.stringify([event, arg]));
  }

  async pollLoop() {
    while (!this.stopped) {
      let r, txt;
      try {
        r = await fetch(this.url, { signal: AbortSignal.timeout(60000) });
        txt = await r.text();
      } catch (e) {
        this.closed = { atMs: ms(), error: e.message };
        return;
      }
      if (r.status !== 200) {
        this.closed = { atMs: ms(), status: r.status, body: txt.slice(0, 200) };
        return;
      }
      for (const p of txt.split('\x1e')) this.onPacket(p);
    }
  }

  onPacket(p) {
    const at = ms();
    if (p === '2') {
      this.pings.push(at);
      if (this.answerPings) this.post('3').catch(() => {});
      capture(`${this.name}.frames`, `${at} ${p}`);
      return;
    }
    if (p.startsWith('42')) {
      const [event, data] = JSON.parse(p.slice(2));
      redact(data);
      this.events.push({ at, event, data, bytes: p.length });
      capture(`${this.name}.frames`, `${at} 42${JSON.stringify([event, data])}`);
      return;
    }
    if (p === '1' || p.startsWith('41')) this.closed = { atMs: at, packet: p };
    capture(`${this.name}.frames`, `${at} ${p}`);
    log('packet', { session: this.name, atMs: at, packet: p.slice(0, 200) });
  }

  stop() {
    this.stopped = true;
  }
}

function summarize(session, from, to) {
  const ev = session.events.filter((e) => e.at >= from && e.at < to);
  const by = {};
  for (const e of ev) {
    const s = (by[e.event] ??= { n: 0, bytes: 0, gapsMs: [], last: null });
    s.n++;
    s.bytes += e.bytes;
    if (s.last !== null) s.gapsMs.push(e.at - s.last);
    s.last = e.at;
  }
  for (const s of Object.values(by)) delete s.last;
  return by;
}

function bookStats(e) {
  const b = e.data?.data?.bids ?? [], a = e.data?.data?.asks ?? [];
  return {
    atMs: e.at, bids: b.length, asks: a.length, bestBid: b[0], bestAsk: a[0],
    bidsDesc: b.every((x, i) => !i || x[0] <= b[i - 1][0]), asksAsc: a.every((x, i) => !i || x[0] >= a[i - 1][0]),
    dupBid: b.length - new Set(b.map((x) => x[0])).size, dupAsk: a.length - new Set(a.map((x) => x[0])).size,
    zeroSizes: [...b, ...a].filter((x) => x[1] === 0).length, keys: Object.keys(e.data), dataKeys: Object.keys(e.data?.data ?? {}),
  };
}

async function restTouch(symbol) {
  const r = await fetch(REST + symbol, { signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  return { atMs: ms(), bestBid: j.bids?.[0], bestAsk: j.asks?.[0], serverTime: j.serverTime };
}

async function transport() {
  const tries = [
    { name: 'ws no sid', url: `wss://${HOST}/socket.io/?EIO=4&transport=websocket`, opts: { perMessageDeflate: false } },
    { name: 'ws origin', url: `wss://${HOST}/socket.io/?EIO=4&transport=websocket`, opts: { perMessageDeflate: false, headers: { Origin: 'https://secondbtc.com' } } },
    { name: 'ws deflate offer', url: `wss://${HOST}/socket.io/?EIO=4&transport=websocket`, opts: { perMessageDeflate: true } },
    { name: 'ws root path', url: `wss://${HOST}/`, opts: { perMessageDeflate: false } },
  ];
  const r = await fetch(POLL);
  const hs = JSON.parse((await r.text()).slice(1));
  tries.push({ name: 'ws upgrade with sid', url: `wss://${HOST}/socket.io/?EIO=4&transport=websocket&sid=${hs.sid}`, opts: { perMessageDeflate: false } });
  for (const t of tries) {
    const start = Date.now();
    await new Promise((resolve) => {
      const ws = new WebSocket(t.url, t.opts);
      ws.on('unexpected-response', (req, res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => { log('ws_attempt', { name: t.name, status: res.statusCode, body: body.slice(0, 120), cfRay: res.headers['cf-ray'], ms: Date.now() - start }); resolve(); });
      });
      ws.on('open', () => { log('ws_attempt', { name: t.name, open: true, extensions: ws.extensions, ms: Date.now() - start }); ws.close(); resolve(); });
      ws.on('error', (e) => { if (!/Unexpected server response/.test(e.message)) { log('ws_attempt', { name: t.name, error: e.message }); resolve(); } });
    });
    await sleep(500);
  }
  const v3 = await fetch(`https://${HOST}/socket.io/?EIO=3&transport=polling`);
  log('eio3', { status: v3.status, body: (await v3.text()).slice(0, 120) });
  log('eio4_handshake', { status: r.status, handshake: hs });
}

async function book() {
  const s = new PollSession('book');
  await s.open();
  await sleep(12000);
  log('phase', { name: 'connected, no emit', window: [0, ms()], events: summarize(s, 0, ms()) });
  const a = ms();
  log('emit', { event: 'createRoom', reply: await s.emit('createRoom', 'BTC_USDT') });
  const rest = [];
  for (let i = 0; i < 4; i++) { await sleep(5000); rest.push(await restTouch('BTCUSDT')); }
  const b = ms();
  log('phase', { name: 'after createRoom BTC_USDT', window: [a, b], events: summarize(s, a, b) });
  for (const e of ['orderBookQueuing', 'EXCHANGE_ALL_DATA', 'EXCHANGE_TRADE_HISTORY', 'EXCHANGE_MARKET_INFO']) log('emit', { event: e, reply: await s.emit(e, 'BTC_USDT') });
  for (let i = 0; i < 6; i++) { await sleep(5000); rest.push(await restTouch('BTCUSDT')); }
  const c = ms();
  log('phase', { name: 'after the other emits', window: [b, c], events: summarize(s, b, c) });
  s.stop();
  const books = s.events.filter((e) => e.event === 'EXCHANGE_ALL_DATA').map(bookStats);
  log('books', { n: books.length, levelCounts: books.map((x) => `${x.bids}/${x.asks}`), ordered: books.every((x) => x.bidsDesc && x.asksAsc), dup: books.map((x) => x.dupBid + x.dupAsk), zeroSizes: books.reduce((n, x) => n + x.zeroSizes, 0), keys: books[0]?.keys, dataKeys: books[0]?.dataKeys });
  log('touch_socket', { touches: books.map((x) => [x.atMs, x.bestBid, x.bestAsk]) });
  log('touch_rest', { touches: rest.map((x) => [x.atMs, x.bestBid, x.bestAsk]) });
  const info = s.events.find((e) => e.event === 'EXCHANGE_MARKET_INFO');
  if (info) {
    const m = info.data.data.marketInfo;
    log('market_info', { dataKeys: Object.keys(info.data.data), marketInfoKeys: Object.keys(m), mmSettingKeys: m.mmSetting.redactedKeys, priceSource: m.mmSetting.priceSource, symbol: m.symbol, tradeFeeMaker: m.tradeFeeMaker, tradeFeeTaker: m.tradeFeeTaker, marketMaker: m.marketMaker, liquidityMaker: m.liquidityMaker, tickSize: m.tickSize, burnListType: Array.isArray(info.data.data.burnList) ? 'array' : typeof info.data.data.burnList });
  }
  const th = s.events.find((e) => e.event === 'EXCHANGE_TRADE_HISTORY');
  if (th) log('trade_history', { n: th.data.data.tradeHistory.length, first: th.data.data.tradeHistory[0] });
  log('pings', { at: s.pings, closed: s.closed });
}

async function multi() {
  const s = new PollSession('multi');
  await s.open();
  for (const m of ['SOL_USDT', 'ETH_USDT', 'BTC_USDT']) log('emit', { event: 'createRoom', arg: m, reply: await s.emit('createRoom', m) });
  await sleep(35000);
  s.stop();
  const books = s.events.filter((e) => e.event === 'EXCHANGE_ALL_DATA').map(bookStats);
  const which = (x) => { const p = x.bestBid?.[0] ?? x.bestAsk?.[0]; return p > 10000 ? 'BTC' : p > 1000 ? 'ETH' : p > 10 ? 'SOL' : 'other'; };
  log('multi_books', { n: books.length, byMarket: books.reduce((m, x) => { m[which(x)] = (m[which(x)] || 0) + 1; return m; }, {}), order: books.map((x) => `${x.atMs}:${which(x)}`) });
  const infos = s.events.filter((e) => e.event === 'EXCHANGE_MARKET_INFO').map((e) => e.data.data.marketInfo.symbol);
  const trades = s.events.filter((e) => e.event === 'EXCHANGE_TRADE_HISTORY').map((e) => e.data.data.tradeHistory[0]?.symbol);
  log('multi_events', { events: summarize(s, 0, ms()), marketInfoSymbols: infos, tradeHistorySymbols: trades });
}

async function unknown() {
  let last;
  for (const m of ['ETH_USDT', 'SOL_USDT', 'SBTC_USDT', 'MBASE_USDT', 'NOPE_USDT', 'BTCUSDT']) {
    const s = new PollSession('room-' + m);
    await s.open();
    log('emit', { event: 'createRoom', arg: m, reply: await s.emit('createRoom', m) });
    await sleep(8000);
    const books = s.events.filter((e) => e.event === 'EXCHANGE_ALL_DATA').map(bookStats);
    const infos = s.events.filter((e) => e.event === 'EXCHANGE_MARKET_INFO').map((e) => e.data.data.marketInfo?.symbol ?? JSON.stringify(e.data).slice(0, 80));
    log('room', { arg: m, events: summarize(s, 0, ms()), marketInfoSymbols: infos, books: books.map((x) => `${x.bids}/${x.asks} ${JSON.stringify(x.bestBid)} ${JSON.stringify(x.bestAsk)} dup ${x.dupBid + x.dupAsk}`) });
    if (last) last.stop();
    last = s;
  }
  log('emit', { event: 'nope_event', reply: await last.emit('nope_event', 'BTC_USDT') });
  log('raw', { packet: '42notjson', reply: await last.post('42notjson') });
  await sleep(3000);
  last.stop();
  log('unknown_tail', { closed: last.closed });
}

async function silence() {
  const quiet = new PollSession('quiet', { answerPings: false });
  const live = new PollSession('live', { answerPings: true });
  await quiet.open();
  await live.open();
  const deadline = Date.now() + 80000;
  while (Date.now() < deadline && !quiet.closed) await sleep(500);
  await sleep(2000);
  quiet.stop();
  live.stop();
  log('silence', { quiet: { pings: quiet.pings, closed: quiet.closed }, live: { pings: live.pings, closed: live.closed }, handshake: quiet.handshake });
}

const mode = process.argv[2] ?? 'book';
const modes = { transport, book, multi, unknown, silence };
if (!modes[mode]) throw new Error('mode must be one of ' + Object.keys(modes).join(', '));
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString(), ms: ms() });
process.exit(0);
