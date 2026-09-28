// Blockfinex futures WebSocket probe: URL, gzip framing, depth_step0 snapshots, level order and count, size unit against the REST book, ping, unknown symbol, a batch of every active perpetual, silence and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like the engine's book feeds.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/blockfinex/ws-probe.mjs [book|batch|silence|deflate]
//   book     futuresws and ws hosts, depth_step0 on four perps, ticker and trade channels, an unknown symbol, 40 s.
//   batch    depth_step0 on every active USDT perpetual on one socket for 30 s.
//   silence  one socket that subscribes and never answers ping, one that answers, up to 70 s.
//   markonly subscribes the mark_price channel names without any depth channel, 8 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw decoded frames. Recorded in docs/profiles/blockfinex/websocket.md.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const FUT_WS = 'wss://futuresws.blockfinex.com/kline-api/ws';
const SPOT_WS = 'wss://ws.blockfinex.com/kline-api/ws';
const API = 'https://futuresopenapi.blockfinex.com/fapi/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const wsSym = (contract) => contract.toLowerCase().replace(/-/g, '_').replace(/^e_/, 'e_').replace(/_(?=[^_]*$)/, ''); // E-BTC-USDT to e_btcusdt
const sub = (channel) => JSON.stringify({ event: 'sub', params: { channel, cb_id: '1' } });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function decode(data, isBinary) {
  if (!isBinary) return { gz: false, text: data.toString() };
  const buf = Buffer.from(data);
  if (buf[0] === 0x1f && buf[1] === 0x8b) return { gz: true, text: gunzipSync(buf).toString() };
  return { gz: false, text: buf.toString() };
}

function open(url, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(url, { perMessageDeflate: opts.deflate ?? false, handshakeTimeout: 10000 });
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => log('refused', { url, status: res.statusCode, body: body.slice(0, 300) }));
  });
  ws.on('error', (e) => log('error', { url, msg: e.message }));
  const opened = new Promise((resolve) => ws.on('open', () => { log('open', { url, ms: Date.now() - t0, ext: ws.extensions }); resolve(true); }));
  return { ws, opened, t0 };
}

async function book() {
  const contracts = ['E-BTC-USDT', 'E-ETH-USDT', 'E-ENJ-USDT', 'E-BTC-USD'];
  for (const url of [FUT_WS, SPOT_WS]) {
    const { ws, opened, t0 } = open(url);
    const stats = {};
    let pings = 0, gzFrames = 0, textFrames = 0;
    ws.on('message', (data, isBinary) => {
      const { gz, text } = decode(data, isBinary);
      gz ? gzFrames++ : textFrames++;
      capture(url.includes('futuresws') ? 'fut.jsonl' : 'spot.jsonl', `${Date.now()} ${text}`);
      let m; try { m = JSON.parse(text); } catch { log('nonjson', { text: text.slice(0, 200) }); return; }
      if (m.ping) { pings++; ws.send(JSON.stringify({ pong: m.ping })); return; }
      const ch = m.channel ?? 'none';
      const s = (stats[ch] ??= { n: 0, first: null, asks: [], bids: [], ascAsk: 0, descBid: 0, sample: null, ts: [] });
      s.n++;
      if (s.n <= 3) s.ts.push(m.ts);
      if (!s.first) { s.first = Date.now() - t0; s.sample = text.slice(0, 300); }
      const t = m.tick;
      if (t && (t.asks || t.buys)) {
        const a = (t.asks ?? []).map((l) => +l[0]), b = (t.buys ?? []).map((l) => +l[0]);
        s.asks.push(a.length); s.bids.push(b.length);
        if (a.every((p, i) => i === 0 || p > a[i - 1])) s.ascAsk++;
        if (b.every((p, i) => i === 0 || p < b[i - 1])) s.descBid++;
        s.lastTick = t; s.keys = Object.keys(m).join(',') + ' tick:' + Object.keys(t).join(',');
      } else if (s.n === 1) s.keys = Object.keys(m).join(',');
    });
    if (!(await Promise.race([opened, sleep(10000).then(() => false)]))) { ws.terminate(); continue; }
    for (const c of contracts) ws.send(sub(`market_${wsSym(c)}_depth_step0`));
    ws.send(sub('market_e_btcusdt_ticker'));
    ws.send(sub('market_e_btcusdt_trade_ticker'));
    ws.send(sub('market_e_nopeusdt_depth_step0'));
    ws.send(sub('market_btcusdt_depth_step0'));
    ws.send(JSON.stringify({ event: 'sub', params: { channel: 'market_e_btcusdt_depth_step1', cb_id: '1' } }));
    await sleep(url === FUT_WS ? 40000 : 10000);
    let restCmp = null;
    const btc = stats['market_e_btcusdt_depth_step0'];
    if (btc?.lastTick) {
      const r = await (await fetch(`${API}/depth?contractName=E-BTC-USDT&limit=30`)).json();
      restCmp = { wsBid: btc.lastTick.buys.slice(0, 3), restBid: r.bids.slice(0, 3), wsAsk: btc.lastTick.asks.slice(0, 3), restAsk: r.asks.slice(0, 3) };
    }
    ws.close();
    const summary = Object.fromEntries(Object.entries(stats).map(([k, s]) => [k, {
      n: s.n, firstMs: s.first, keys: s.keys, askLv: s.asks.length ? [Math.min(...s.asks), Math.max(...s.asks)] : null,
      bidLv: s.bids.length ? [Math.min(...s.bids), Math.max(...s.bids)] : null, ascAsk: s.ascAsk, descBid: s.descBid, ts3: s.ts, sample: s.n <= 3 || !s.asks.length ? s.sample : undefined,
    }]));
    log('book', { url, gzFrames, textFrames, pings, summary, restCmp });
  }
}

async function batch() {
  const all = await (await fetch(`${API}/contracts`)).json();
  const act = all.filter((c) => c.status === 1 && c.type === 'E' && c.marginCoin === 'USDT');
  const { ws, opened } = open(FUT_WS);
  await opened;
  const t = Date.now();
  const seen = new Map();
  let frames = 0, pings = 0;
  ws.on('message', (data, isBinary) => {
    const { text } = decode(data, isBinary);
    const m = JSON.parse(text);
    if (m.ping) { pings++; ws.send(JSON.stringify({ pong: m.ping })); return; }
    frames++;
    if (m.channel && !seen.has(m.channel)) seen.set(m.channel, Date.now() - t);
    if (m.channel) seen.set(m.channel + '#n', (seen.get(m.channel + '#n') ?? 0) + 1);
  });
  for (const c of act) ws.send(sub(`market_${wsSym(c.symbol)}_depth_step0`));
  await sleep(30000);
  ws.close();
  const chans = act.map((c) => `market_${wsSym(c.symbol)}_depth_step0`);
  const got = chans.filter((c) => seen.has(c));
  const counts = got.map((c) => seen.get(c + '#n')).sort((a, b) => a - b);
  const marks = [...seen.keys()].filter((k) => k.startsWith('mark_price_') && !k.endsWith('#n'));
  log('batch', { markStreams: marks.length, subscribed: chans.length, delivered: got.length, missing: chans.filter((c) => !seen.has(c)).slice(0, 20), frames, pings, lastFirstMs: Math.max(...got.map((c) => seen.get(c))), framesPerStream: { min: counts[0], median: counts[counts.length >> 1], max: counts[counts.length - 1] } });
}

async function silence() {
  const runs = [{ name: 'no_pong', answer: false }, { name: 'pong', answer: true }];
  await Promise.all(runs.map(async (r) => {
    const { ws, opened, t0 } = open(FUT_WS);
    await opened;
    let pings = 0, last = 0;
    ws.on('message', (data, isBinary) => {
      const m = JSON.parse(decode(data, isBinary).text);
      if (m.ping) { pings++; if (pings <= 2) log('ping', { run: r.name, at: Date.now() - t0, ping: m.ping }); if (r.answer) ws.send(JSON.stringify({ pong: m.ping })); }
      last = Date.now() - t0;
    });
    ws.on('ping', () => log('protocol_ping', { run: r.name, at: Date.now() - t0 }));
    ws.send(sub('market_e_enjusdt_depth_step0'));
    const closed = new Promise((res) => ws.on('close', (code, reason) => res({ code, reason: reason.toString(), at: Date.now() - t0 })));
    const res = await Promise.race([closed, sleep(70000).then(() => null)]);
    log('silence', { run: r.name, pings, lastFrameAt: last, close: res ?? 'open at 70 s' });
    if (!res) ws.close();
  }));
}

async function markonly() {
  const { ws, opened } = open(FUT_WS);
  await opened;
  const c = {};
  ws.on('message', (data, isBinary) => {
    const m = JSON.parse(decode(data, isBinary).text);
    if (m.ping) return ws.send(JSON.stringify({ pong: m.ping }));
    c[m.channel ?? Object.keys(m).join(',')] = (c[m.channel ?? Object.keys(m).join(',')] ?? 0) + 1;
  });
  ws.send(sub('mark_price_e_btcusdt'));
  ws.send(sub('market_e_ethusdt_mark_price'));
  await sleep(8000);
  ws.close();
  log('markonly', { channels: c });
}

async function deflate() {
  const { ws, opened } = open(FUT_WS, { deflate: true });
  await Promise.race([opened, sleep(10000)]);
  ws.close();
}

const mode = process.argv[2] ?? 'book';
await ({ book, batch, silence, deflate, markonly })[mode]();
process.exit(0);
