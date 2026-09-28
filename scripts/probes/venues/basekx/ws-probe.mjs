// BASEKX futures WebSocket probe: the per symbol channels, book snapshot cadence, update ids, level order, number format, many symbols on one socket, keepalive and silence, errors.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like the engine does.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/basekx/ws-probe.mjs [book|batch|market|silence|errors]
//   book     sub_symbol on four perps, one socket each, for 60 s, checks every push.deep.full and push.deep. About 62 s.
//   batch    sub_symbol for 20 perps on one socket for 20 s, counts which symbols deliver (only the last one does).
//   market   sub_tickers and sub_mark_prices for 15 s.
//   silence  one subscribed socket that never pings, and one idle socket, for up to 70 s.
//   errors   unknown symbol, unknown req, a text ping, a JSON ping, unsub, then a malformed frame.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/basekx/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://www.basekx.com/ws/market';
const API = 'https://www.basekx.com/futures/fapi/market/v1/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(label) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false, headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.basekx.com' } });
  ws.on('open', () => log('open', { label, ms: Date.now() - t0, extensions: ws.extensions || '' }));
  ws.on('unexpected-response', (_q, r) => log('refused', { label, status: r.statusCode }));
  ws.on('error', (e) => log('error', { label, message: e.message }));
  ws.on('close', (code, reason) => log('close', { label, code, reason: reason.toString(), afterMs: Date.now() - t0 }));
  ws.on('ping', () => log('server_ping', { label, afterMs: Date.now() - t0 }));
  return new Promise((res) => ws.once('open', () => res({ ws, t0 })));
}

const isSci = (s) => /e/i.test(s);
const num = (s) => Number(s);

async function book() {
  const symbols = ['btc_usdt', 'eth_usdt', 'sol_usdt', 'dot_usdt'];
  // sub_symbol replaces the previous symbol on a socket, so each symbol gets its own socket
  const socks = await Promise.all(symbols.map((s) => open(`book_${s}`)));
  const t0 = socks[0].t0;
  const st = Object.fromEntries(symbols.map((s) => [s, { full: 0, deep: 0, lastId: null, idBack: 0, fullGapMs: [], lastFullAt: 0, bidLv: [], askLv: [], bidDesc: true, askAsc: true, sci: 0, zero: 0, ba: {}, fullBeforeDeep: null, deepVsFull: [0, 0] }]));
  const local = Object.fromEntries(symbols.map((s) => [s, { b: new Map(), a: new Map() }]));
  const other = {};
  const onMessage = (d) => {
    const s = d.toString();
    let j;
    try { j = JSON.parse(s); } catch { other.text = (other.text || 0) + 1; capture('book-text.txt', s); return; }
    const ch = j.channel || 'none';
    if (ch !== 'push.deep' && ch !== 'push.deep.full') { other[ch] = (other[ch] || 0) + 1; if (other[ch] <= 2) capture('book-other.jsonl', s); return; }
    const x = st[j.data.s];
    if (!x) return;
    const id = BigInt(j.data.id);
    if (x.lastId !== null && id < x.lastId) x.idBack++;
    x.lastId = id;
    if (ch === 'push.deep.full') {
      const now = Date.now();
      if (x.fullBeforeDeep === null) x.fullBeforeDeep = x.deep === 0;
      if (x.lastFullAt) x.fullGapMs.push(now - x.lastFullAt);
      x.lastFullAt = now;
      x.full++;
      const b = j.data.b || [], a = j.data.a || [];
      x.bidLv.push(b.length); x.askLv.push(a.length);
      for (let i = 1; i < b.length; i++) if (num(b[i][0]) >= num(b[i - 1][0])) x.bidDesc = false;
      for (let i = 1; i < a.length; i++) if (num(a[i][0]) <= num(a[i - 1][0])) x.askAsc = false;
      for (const l of [...b, ...a]) if (isSci(l[1]) || isSci(l[0])) x.sci++;
      // compare the book built from deltas with the new snapshot, top 5 per side, before replacing it
      if (x.full > 1) {
        const L = local[j.data.s];
        const topB = [...L.b.entries()].filter(([, q]) => q > 0).sort((p, q) => q[0] - p[0]).slice(0, 5);
        const snapB = b.slice(0, 5).map((l) => [num(l[0]), num(l[1])]);
        const same = topB.length === snapB.length && topB.every((l, i) => l[0] === snapB[i][0] && l[1] === snapB[i][1]);
        x.deepVsFull[same ? 0 : 1]++;
      }
      local[j.data.s] = { b: new Map(b.map((l) => [num(l[0]), num(l[1])])), a: new Map(a.map((l) => [num(l[0]), num(l[1])])) };
      if (x.full <= 1) capture('book-full.jsonl', s);
    } else {
      x.deep++;
      x.ba[j.data.ba] = (x.ba[j.data.ba] || 0) + 1;
      if (j.data.q === '0') x.zero++;
      if (isSci(j.data.q)) x.sci++;
      const side = j.data.ba === 1 ? 'b' : 'a';
      local[j.data.s][side].set(num(j.data.p), num(j.data.q));
      if (x.deep <= 3) capture('book-deep.jsonl', s);
    }
  };
  symbols.forEach((s, i) => { socks[i].ws.on('message', onMessage); socks[i].ws.send(JSON.stringify({ req: 'sub_symbol', symbol: s })); });
  const ping = setInterval(() => socks.forEach((k) => k.ws.send('ping')), 10000);
  await sleep(60000);
  clearInterval(ping);
  socks.forEach((k) => k.ws.close());
  for (const s of symbols) {
    const x = st[s];
    const g = x.fullGapMs.sort((p, q) => p - q);
    log('book', { s, full: x.full, deep: x.deep, fullFirst: x.fullBeforeDeep, fullGapMsMin: g[0], fullGapMsMed: g[g.length >> 1], fullGapMsMax: g[g.length - 1], bidLevels: [Math.min(...x.bidLv), Math.max(...x.bidLv)], askLevels: [Math.min(...x.askLv), Math.max(...x.askLv)], bidDesc: x.bidDesc, askAsc: x.askAsc, idBackwards: x.idBack, sciNotation: x.sci, zeroQty: x.zero, baCounts: x.ba, deltaBookTop5MatchesNextFull: x.deepVsFull });
  }
  log('book_other_channels', other);
  log('book_done', { heldMs: Date.now() - t0 });
}

async function batch() {
  const r = await fetch(`${API}/symbol/list`).then((x) => x.json());
  const symbols = r.data.filter((m) => m.contractType === 'PERPETUAL' && m.state === 0).map((m) => m.symbol).slice(0, 20);
  const { ws, t0 } = await open('batch');
  const seen = {}, ack = [];
  ws.on('message', (d) => {
    const s = d.toString();
    if (!s.startsWith('{')) { ack.push(s); return; }
    const j = JSON.parse(s);
    if (j.channel === 'push.deep.full') seen[j.data.s] = (seen[j.data.s] || 0) + 1;
  });
  for (const s of symbols) ws.send(JSON.stringify({ req: 'sub_symbol', symbol: s }));
  await sleep(20000);
  ws.close();
  log('batch', { subscribed: symbols.length, symbolsWithFull: Object.keys(seen).length, symbols: seen, textReplies: ack.slice(0, 25), heldMs: Date.now() - t0 });
}

async function market() {
  const { ws } = await open('market');
  const cnt = {}, syms = {};
  ws.on('message', (d) => {
    const s = d.toString();
    let j; try { j = JSON.parse(s); } catch { cnt.text = (cnt.text || 0) + 1; return; }
    const ch = j.channel || 'none';
    cnt[ch] = (cnt[ch] || 0) + 1;
    if (cnt[ch] <= 1) { capture('market.jsonl', s); log('market_first', { ch, frame: s.slice(0, 300) }); }
    const arr = Array.isArray(j.data) ? j.data : [j.data];
    syms[ch] = syms[ch] || new Set();
    for (const x of arr) if (x && x.s) syms[ch].add(x.s);
  });
  ws.send(JSON.stringify({ req: 'sub_tickers' }));
  ws.send(JSON.stringify({ req: 'sub_mark_prices' }));
  await sleep(15000);
  ws.close();
  log('market', { frames: cnt, distinctSymbols: Object.fromEntries(Object.entries(syms).map(([k, v]) => [k, v.size])) });
}

async function silence() {
  const a = await open('subscribed_no_ping');
  const b = await open('idle_no_sub');
  let last = { a: 0, b: 0 };
  a.ws.on('message', () => { last.a = Date.now(); });
  b.ws.on('message', (d) => { last.b = Date.now(); log('idle_msg', { frame: d.toString().slice(0, 120) }); });
  a.ws.send(JSON.stringify({ req: 'sub_symbol', symbol: 'btc_usdt' }));
  const closed = { a: false, b: false };
  a.ws.on('close', () => { closed.a = true; });
  b.ws.on('close', () => { closed.b = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < 70000 && !(closed.a && closed.b)) await sleep(500);
  log('silence', { heldMs: Date.now() - t0, subscribedClosed: closed.a, idleClosed: closed.b, subscribedLastMsgAgoMs: last.a ? Date.now() - last.a : null });
  a.ws.terminate(); b.ws.terminate();
}

async function errors() {
  const { ws, t0 } = await open('errors');
  ws.on('message', (d) => {
    const s = d.toString();
    let ch = null; try { ch = JSON.parse(s).channel; } catch {}
    if (ch && ch.startsWith('push.')) return;
    log('reply', { ms: Date.now() - t0, frame: s.slice(0, 300) });
  });
  const sends = [
    JSON.stringify({ req: 'sub_symbol', symbol: 'nope_usdt' }),
    JSON.stringify({ req: 'sub_nothing', symbol: 'btc_usdt' }),
    'ping',
    JSON.stringify({ ping: Date.now() }),
    JSON.stringify({ req: 'unsub_symbol' }),
    'not json', // the server answers Invalid parameter and closes, so this goes last
  ];
  for (const m of sends) { log('send', { ms: Date.now() - t0, m }); ws.send(m); await sleep(1500); }
  await sleep(1500);
  ws.close();
}

const mode = process.argv[2] || 'book';
const fn = { book, batch, market, silence, errors }[mode];
if (!fn) { console.error('unknown mode'); process.exit(1); }
await fn();
await sleep(300);
process.exit(0);
