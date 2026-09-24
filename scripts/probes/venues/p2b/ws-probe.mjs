// P2B spot WebSocket probe: depth channel shape, full and partial frames, level order, one or many markets per socket, keepalive, silence, errors, deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/p2b/ws-probe.mjs [book|multi|silence|deflate]
//   book     depth 100 on BTC_USDT for 70 s with a REST compare, depth on a quiet market, limit and interval variants, error replies, socket lifetimes. About 70 s.
//   multi    several depth, price and state subscriptions on one socket, then 12 depth sockets at once beside one socket each for price, state, deals and kline. About 55 s.
//   silence  five sockets that differ only in what the client sends or subscribes, for up to 120 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep trimmed raw frames. Recorded in docs/profiles/p2b/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://apiws.p2pb2b.com/';
const API = 'https://api.p2pb2b.com/api/v2/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const T0 = Date.now();
const since = () => Date.now() - T0;
let nextId = 1;

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 1500) + '\n');
}

function open(label, opts = {}) {
  const t = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  const s = { label, ws, frames: [], openMs: null, closed: null, pings: 0 };
  ws.on('upgrade', (res) => { s.ext = res.headers['sec-websocket-extensions'] ?? null; s.via = { server: res.headers.server, cfRay: res.headers['cf-ray'] }; });
  ws.on('open', () => { s.openMs = Date.now() - t; s.openedAt = Date.now(); });
  ws.on('ping', () => { s.pings += 1; });
  ws.on('message', (raw) => {
    const at = Date.now();
    const text = raw.toString('utf8');
    capture(`${label}.jsonl`, `${at} ${text}`);
    let msg;
    try { msg = JSON.parse(text); } catch { msg = { unparsed: text.slice(0, 200) }; }
    s.frames.push({ at, msg, bytes: raw.length });
    opts.onFrame?.(msg, at);
  });
  ws.on('close', (code, reason) => { s.closed = { code, reason: reason.toString(), afterMs: s.openedAt ? Date.now() - s.openedAt : null }; });
  ws.on('error', (e) => { s.error = e.message; });
  return new Promise((resolve) => {
    ws.once('open', () => resolve(s));
    ws.once('error', () => resolve(s));
  });
}

function send(s, method, params) {
  const id = nextId++;
  const text = typeof method === 'string' ? JSON.stringify({ method, params, id }) : method.raw;
  s.ws.send(text);
  return { id, sentAt: Date.now() };
}

const replyTo = (s, id) => s.frames.find((f) => f.msg.id === id);
const depthFrames = (s, market) => s.frames.filter((f) => f.msg.method === 'depth.update' && (!market || f.msg.params?.[2] === market));

function orderOf(levels, side) {
  if (!levels || levels.length < 2) return 'n<2';
  let asc = true, desc = true;
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1][0]), b = Number(levels[i][0]);
    if (b < a) asc = false;
    if (b > a) desc = false;
  }
  if (side === 'bids') return desc ? 'best first' : asc ? 'worst first' : 'unordered';
  return asc ? 'best first' : desc ? 'worst first' : 'unordered';
}

function gaps(times) {
  const g = [];
  for (let i = 1; i < times.length; i++) g.push(times[i] - times[i - 1]);
  g.sort((a, b) => a - b);
  if (!g.length) return null;
  return { n: g.length, min: g[0], median: g[Math.floor(g.length / 2)], max: g[g.length - 1] };
}

// Keeps a book from full and partial frames, and checks each later full frame against it, since the channel carries no sequence.
function bookKeeper() {
  const bids = new Map(), asks = new Map();
  const st = { fulls: 0, partials: 0, zeroSizes: 0, partialOrder: {}, fullOrder: {}, fullMatch: [], maxLevels: [0, 0], partialsBeforeFull: 0 };
  const apply = (side, levels) => {
    const m = side === 'bids' ? bids : asks;
    for (const [p, q] of levels ?? []) {
      if (Number(q) === 0) { m.delete(p); st.zeroSizes += 1; } else m.set(p, q);
    }
  };
  const top = (m, side, n) => [...m.entries()].sort((a, b) => side === 'bids' ? b[0] - a[0] : a[0] - b[0]).slice(0, n);
  return {
    st, bids, asks, top,
    onDepth(params) {
      const [full, data] = params;
      if (full) {
        if (st.fulls > 0) {
          const same = (side, m) => {
            const snap = new Map((data[side] ?? []).map(([p, q]) => [p, q]));
            let equal = 0, diff = 0;
            for (const [p, q] of snap) (m.get(p) === q ? equal++ : diff++);
            let extra = 0;
            const worst = side === 'bids' ? Math.min(...[...snap.keys()].map(Number)) : Math.max(...[...snap.keys()].map(Number));
            for (const p of m.keys()) if (!snap.has(p) && (side === 'bids' ? Number(p) >= worst : Number(p) <= worst)) extra++;
            return { equal, diff, extraInside: extra };
          };
          st.fullMatch.push({ bids: same('bids', bids), asks: same('asks', asks) });
        }
        st.fulls += 1;
        bids.clear(); asks.clear();
        apply('bids', data.bids); apply('asks', data.asks);
        for (const side of ['bids', 'asks']) { const o = orderOf(data[side], side); st.fullOrder[`${side}:${o}`] = (st.fullOrder[`${side}:${o}`] ?? 0) + 1; }
      } else {
        if (st.fulls === 0) st.partialsBeforeFull += 1;
        st.partials += 1;
        apply('bids', data.bids); apply('asks', data.asks);
        for (const side of ['bids', 'asks']) { const o = orderOf(data[side], side); st.partialOrder[`${side}:${o}`] = (st.partialOrder[`${side}:${o}`] ?? 0) + 1; }
      }
      st.maxLevels = [Math.max(st.maxLevels[0], bids.size), Math.max(st.maxLevels[1], asks.size)];
    },
  };
}

function summarizeDepth(s, market, sentAt) {
  const fr = depthFrames(s, market);
  const full = fr.filter((f) => f.msg.params[0] === true);
  const part = fr.filter((f) => f.msg.params[0] === false);
  const lv = (f, side) => (f.msg.params[1][side] ?? []).length;
  return {
    market,
    frames: fr.length,
    full: full.length,
    partial: part.length,
    firstFrameAfterSubMs: fr.length ? fr[0].at - sentAt : null,
    firstFrameFull: fr.length ? fr[0].msg.params[0] : null,
    fullGapsMs: gaps(full.map((f) => f.at)),
    partialGapsMs: gaps(part.map((f) => f.at)),
    fullLevels: full.map((f) => `${lv(f, 'bids')}/${lv(f, 'asks')}`).slice(0, 4),
    partialLevelsMax: part.reduce((m, f) => Math.max(m, lv(f, 'bids') + lv(f, 'asks')), 0),
    emptyPartials: part.filter((f) => lv(f, 'bids') + lv(f, 'asks') === 0).length,
    keysSeen: [...new Set(fr.flatMap((f) => Object.keys(f.msg.params[1])))],
    paramsLen: [...new Set(fr.map((f) => f.msg.params.length))],
    meanBytes: fr.length ? Math.round(fr.reduce((a, f) => a + f.bytes, 0) / fr.length) : 0,
  };
}

async function restDepth(market, limit) {
  const r = await fetch(`${API}/depth/result?market=${market}&limit=${limit}`);
  return (await r.json()).result;
}

async function book() {
  const kp = bookKeeper();
  const A = await open('A-btc', { onFrame: (m) => { if (m.method === 'depth.update' && m.params?.[2] === 'BTC_USDT') kp.onDepth(m.params); } });
  log('open', { socket: 'A', openMs: A.openMs, ext: A.ext, error: A.error });
  const ping = send(A, 'server.ping', []);
  const time = send(A, 'server.time', []);
  const subA = send(A, 'depth.subscribe', ['BTC_USDT', 100, '0']);

  const Q = await open('Q-quiet');
  const quiet = process.env.QUIET_MARKET ?? 'CPC_USDT';
  const subQ = send(Q, 'depth.subscribe', [quiet, 100, '0']);

  // Limit and interval variants, each on its own socket, because a second depth.subscribe may replace the first.
  const V = [];
  for (const [label, params] of [['L20', ['ETH_USDT', 20, '0']], ['L5', ['ETH_USDT', 5, '0']], ['I01', ['BTC_USDT', 20, '0.1']], ['I1', ['BTC_USDT', 20, '1']]]) {
    const s = await open(`V-${label}`);
    V.push({ label, s, sub: send(s, 'depth.subscribe', params), params });
  }

  // Error replies, all on one socket.
  const E = await open('E-errors');
  const errs = [];
  for (const [label, method, params] of [
    ['unknown market', 'depth.subscribe', ['NOPE_USDT', 20, '0']],
    ['lowercase market', 'depth.subscribe', ['btc_usdt', 20, '0']],
    ['limit 0', 'depth.subscribe', ['BTC_USDT', 0, '0']],
    ['limit 101', 'depth.subscribe', ['BTC_USDT', 101, '0']],
    ['limit 1000', 'depth.subscribe', ['BTC_USDT', 1000, '0']],
    ['interval 0.5', 'depth.subscribe', ['BTC_USDT', 20, '0.5']],
    ['numeric interval', 'depth.subscribe', ['BTC_USDT', 20, 0]],
    ['missing interval', 'depth.subscribe', ['BTC_USDT', 20]],
    ['unknown method', 'depth.nope', []],
    ['price unknown market', 'price.subscribe', ['NOPE_USDT']],
    ['not json', { raw: 'hello' }, null],
  ]) {
    errs.push({ label, ...send(E, method, params) });
    await sleep(400);
  }

  await sleep(12_000);
  const pingReply = replyTo(A, ping.id);
  log('ping', { rttMs: pingReply ? pingReply.at - ping.sentAt : null, reply: pingReply?.msg });
  const timeReply = replyTo(A, time.id);
  if (timeReply) log('server.time', { reply: timeReply.msg, localMs: timeReply.at, offsetS: Number(timeReply.msg.result) - timeReply.at / 1000 });
  log('ack', { socket: 'A', reply: replyTo(A, subA.id)?.msg, ackMs: replyTo(A, subA.id) ? replyTo(A, subA.id).at - subA.sentAt : null });

  // Cases are 400 ms apart, so a reply without an id belongs to the case whose window it lands in.
  errs.forEach((e, i) => {
    const end = errs[i + 1]?.sentAt ?? Infinity;
    const inWindow = E.frames.filter((f) => f.at >= e.sentAt && f.at < end && f.msg.method !== 'depth.update');
    log('error-case', { label: e.label, replies: inWindow.map((f) => ({ ms: f.at - e.sentAt, msg: f.msg })) });
  });
  const eDepth = depthFrames(E);
  log('error-socket', { depthFrames: eDepth.length, markets: [...new Set(eDepth.map((f) => f.msg.params[2]))], closed: E.closed, unmatched: E.frames.filter((f) => !errs.some((e) => e.id === f.msg.id) && f.msg.method !== 'depth.update').map((f) => f.msg).slice(0, 5) });

  for (const v of V) {
    const r = replyTo(v.s, v.sub.id);
    log('variant', { label: v.label, params: v.params, ack: r?.msg, ...summarizeDepth(v.s, v.params[0], v.sub.sentAt) });
    const fulls = depthFrames(v.s).filter((f) => f.msg.params[0]);
    if (fulls.length) log('variant-top', { label: v.label, order: fulls.map((f) => `${orderOf(f.msg.params[1].bids, 'bids')}/${orderOf(f.msg.params[1].asks, 'asks')}`), bids: fulls[0].msg.params[1].bids?.slice(0, 3), asks: fulls[0].msg.params[1].asks?.slice(0, 3) });
    v.s.ws.close();
  }
  E.ws.close();

  await sleep(Math.max(0, 70_000 - since()));
  const local = { bids: kp.top(kp.bids, 'bids', 20), asks: kp.top(kp.asks, 'asks', 20) };
  const rest = await restDepth('BTC_USDT', 100);
  const restAt = Date.now();
  const cmp = (side) => {
    const r = new Map(rest[side].slice(0, 20));
    const l = local[side];
    return { equal: l.filter(([p, q]) => r.get(p) === q).length, priceOnly: l.filter(([p, q]) => r.has(p) && r.get(p) !== q).length, missing: l.filter(([p]) => !r.has(p)).length };
  };
  log('rest-compare', { market: 'BTC_USDT', restLevels: `${rest.bids.length}/${rest.asks.length}`, restOrder: `${orderOf(rest.bids, 'bids')}/${orderOf(rest.asks, 'asks')}`, bids: cmp('bids'), asks: cmp('asks'), localTop: [local.bids[0], local.asks[0]], restTop: [rest.bids[0], rest.asks[0]], sinceLastFrameMs: restAt - depthFrames(A, 'BTC_USDT').at(-1).at });
  log('depth', { socket: 'A', ...summarizeDepth(A, 'BTC_USDT', subA.sentAt), keeper: kp.st });
  log('depth', { socket: 'Q', ack: replyTo(Q, subQ.id)?.msg, ...summarizeDepth(Q, quiet, subQ.sentAt) });
  const qf = depthFrames(Q, quiet);
  if (qf.length) log('quiet-first', { frame: JSON.stringify(qf[0].msg).slice(0, 400) });
  log('protocol-pings', { A: A.pings, Q: Q.pings });
  log('lifetime', { A: A.closed ?? `open ${Date.now() - A.openedAt} ms, client silent after the first second`, Q: Q.closed ?? `open ${Date.now() - Q.openedAt} ms` });
  A.ws.close(); Q.ws.close();
}

async function multi() {
  const M = await open('M-multi');
  log('open', { socket: 'M', openMs: M.openMs });
  const s1 = send(M, 'depth.subscribe', ['BTC_USDT', 20, '0']);
  await sleep(6_000);
  const s2 = send(M, 'depth.subscribe', ['ETH_USDT', 20, '0']);
  const mark2 = Date.now();
  await sleep(6_000);
  const s3 = send(M, 'depth.subscribe', ['BTC_USDT', 20, '0', 'XRP_USDT', 20, '0']);
  const mark3 = Date.now();
  await sleep(6_000);
  const s4 = send(M, 'price.subscribe', ['BTC_USDT', 'ETH_USDT', 'XRP_USDT']);
  const s5 = send(M, 'state.subscribe', ['BTC_USDT', 'ETH_USDT']);
  const mark4 = Date.now();
  await sleep(8_000);
  const s6 = send(M, 'depth.unsubscribe', []);
  const mark6 = Date.now();
  await sleep(4_000);
  const count = (from, to) => {
    const c = {};
    for (const f of M.frames) if (f.at >= from && f.at < to && f.msg.method) { const k = `${f.msg.method}:${f.msg.method === 'depth.update' ? f.msg.params[2] : f.msg.params?.[0]}`; c[k] = (c[k] ?? 0) + 1; }
    return c;
  };
  for (const s of [s1, s2, s3, s4, s5, s6]) log('reply', { id: s.id, reply: replyTo(M, s.id)?.msg });
  log('window', { what: 'after depth BTC only', counts: count(s1.sentAt, mark2) });
  log('window', { what: 'after depth ETH on the same socket', counts: count(mark2 + 1500, mark3) });
  log('window', { what: 'after one depth frame naming BTC and XRP', counts: count(mark3 + 1500, mark4) });
  log('window', { what: 'after price and state subscribe', counts: count(mark4 + 1500, mark6) });
  log('window', { what: 'after depth.unsubscribe', counts: count(mark6 + 1000, Date.now()) });
  M.ws.close();

  // Twelve sockets at once, one market each, to see whether a burst of handshakes is refused.
  const markets = ['BTC_USDT', 'ETH_USDT', 'PAXG_USDT', 'PENGU_USDT', 'BTC_USDC', 'BNB_USDT', 'XRP_USDT', 'DOGE_USDT', 'ETH_USDC', 'BTC_USD', 'FET_USDT', 'BCH_USDT'];
  const t = Date.now();
  const socks = await Promise.all(markets.map((m, i) => open(`N${i}`)));
  log('burst-open', { sockets: socks.length, wallMs: Date.now() - t, openMs: socks.map((s) => s.openMs), errors: socks.filter((s) => s.error).map((s) => s.error) });
  const subs = socks.map((s, i) => send(s, 'depth.subscribe', [markets[i], 20, '0']));

  // Price, state, deals and kline, one channel per socket, over the same 20 s.
  const chans = [['price.subscribe', ['BTC_USDT', 'ETH_USDT']], ['state.subscribe', ['BTC_USDT', 'ETH_USDT']], ['deals.subscribe', ['BTC_USDT', 'ETH_USDT']], ['kline.subscribe', ['BTC_USDT', 900]]];
  const P = [];
  for (const [method, params] of chans) { const s = await open(`P-${method}`); P.push({ method, s, sub: send(s, method, params) }); }
  await sleep(20_000);
  log('burst-depth', { seconds: 20, perSocket: socks.map((s, i) => `${markets[i]} ${depthFrames(s, markets[i]).length}`), acks: [...new Set(socks.map((s, i) => JSON.stringify(replyTo(s, subs[i].id)?.msg?.result ?? null)))], closed: socks.filter((s) => s.closed).length });
  for (const p of P) {
    const byMethod = {};
    for (const f of p.s.frames) if (f.msg.method) byMethod[`${f.msg.method}:${f.msg.params?.[0]}`] = (byMethod[`${f.msg.method}:${f.msg.params?.[0]}`] ?? 0) + 1;
    const first = p.s.frames.find((x) => x.msg.method);
    log('channel', { seconds: 20, method: p.method, ack: replyTo(p.s, p.sub.id)?.msg ?? null, counts: byMethod, sample: first ? JSON.stringify(first.msg).slice(0, 360) : null });
  }
  for (const s of [...socks, ...P.map((p) => p.s)]) s.ws.close();
}

async function silence() {
  const variants = [
    { label: 'S1 nothing' },
    { label: 'S2 app ping every 30 s', appPing: 30_000 },
    { label: 'S3 quiet depth, no ping', sub: [process.env.QUIET_MARKET ?? 'CPC_USDT', 20, '0'] },
    { label: 'S4 protocol ping every 30 s', wsPing: 30_000 },
    { label: 'S5 busy depth, no ping', sub: ['BTC_USDT', 100, '0'] },
  ];
  const socks = [];
  for (const v of variants) {
    const s = await open(v.label);
    if (v.sub) send(s, 'depth.subscribe', v.sub);
    if (v.appPing) s.timer = setInterval(() => s.ws.readyState === 1 && send(s, 'server.ping', []), v.appPing);
    if (v.wsPing) { s.pongs = 0; s.ws.on('pong', () => { s.pongs += 1; }); s.timer = setInterval(() => s.ws.readyState === 1 && s.ws.ping(), v.wsPing); }
    socks.push({ v, s });
  }
  const until = Date.now() + 120_000;
  while (Date.now() < until && socks.some(({ s }) => !s.closed)) await sleep(1000);
  for (const { v, s } of socks) {
    clearInterval(s.timer);
    log('silence', { label: v.label, closed: s.closed, openForS: s.closed ? s.closed.afterMs / 1000 : (Date.now() - s.openedAt) / 1000, frames: s.frames.length, serverPings: s.pings, pongs: s.pongs, lastFrame: JSON.stringify(s.frames.at(-1)?.msg ?? null).slice(0, 160) });
    s.ws.terminate();
  }
}

async function deflate() {
  const s = await open('D-deflate', { deflate: true });
  log('deflate', { offered: 'permessage-deflate', negotiated: s.ext, openMs: s.openMs, via: s.via });
  s.ws.close();
  const p = await open('D-plain');
  log('plain', { negotiated: p.ext ?? null, openMs: p.openMs });
  p.ws.close();
}

const mode = process.argv[2] ?? 'book';
const modes = { book, multi, silence, deflate };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
await modes[mode]();
log('done', { mode, wallMs: since() });
process.exit(0);
