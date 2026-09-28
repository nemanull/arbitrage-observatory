// Koinbay futures WebSocket probe: depth_step0 book frames, level counts and order, idle repeats, size unit, mark_price and ticker channels, errors, keepalive, silence, a batch of perpetuals on one connection, and deflate.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Frames arrive as binary gzip, so every frame is gunzipped before it is parsed.
// Run from server/: node ../scripts/probes/venues/koinbay/ws-probe.mjs [book|batch|silence|deflate]
//   book     depth_step0 and depth_step1 on three perps, mark_price, ticker, an unknown symbol, a req, for 45 s. About 50 s.
//   batch    depth_step0 on every active E-*-USDT perp on one connection for 30 s.
//   silence  two subscribed sockets, one answers the server ping and one never does, for up to 70 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep a few trimmed frames. Recorded in docs/profiles/koinbay/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://futuresws.koinbay.com/kline-api/ws';
const API = 'https://futuresopenapi.koinbay.com/fapi/v1';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel, cb = '1', event = 'sub') => JSON.stringify({ event, params: { channel, cb_id: cb } });
const socketName = (contract) => contract.toLowerCase().replace(/^([a-z]+)-(.*)$/, (_, t, p) => `${t}_${p.replace(/-/g, '')}`);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 1500) + '\n');
}

function decode(data, isBinary) {
  const text = isBinary ? gunzipSync(data).toString() : data.toString();
  return { text, json: JSON.parse(text) };
}

function open(opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0) }));
    ws.once('error', reject);
  });
}

async function book() {
  const { ws, openMs } = await open();
  log('open', { openMs, extensions: ws._extensions ? Object.keys(ws._extensions) : [] });
  const stats = {};
  const firsts = new Set();
  const lastBody = {};
  let pings = 0;
  ws.on('ping', () => log('protocol_ping', {}));
  ws.on('message', (data, isBinary) => {
    const { text, json } = decode(data, isBinary);
    if (json.ping) {
      pings++;
      if (pings <= 2) log('server_ping', { binary: isBinary, text });
      ws.send(JSON.stringify({ pong: json.ping }));
      return;
    }
    const ch = json.channel || json.event_rep || 'other';
    if (!json.tick) { log('non_tick', { binary: isBinary, text: text.slice(0, 400) }); capture('non-tick.txt', text); return; }
    const s = (stats[ch] ??= { frames: 0, identical: 0, asks: new Set(), bids: new Set(), orderOk: true, keys: Object.keys(json).join(','), tickKeys: Object.keys(json.tick).join(',') });
    s.frames++;
    const body = JSON.stringify(json.tick);
    if (lastBody[ch] === body) s.identical++;
    lastBody[ch] = body;
    if (json.tick.asks) {
      s.asks.add(json.tick.asks.length);
      s.bids.add((json.tick.buys || []).length);
      const a = json.tick.asks, b = json.tick.buys || [];
      if (!a.every((l, i) => i === 0 || l[0] > a[i - 1][0]) || !b.every((l, i) => i === 0 || l[0] < b[i - 1][0])) s.orderOk = false;
    }
    if (!firsts.has(ch)) { firsts.add(ch); log('first_frame', { ch, binary: isBinary, text: text.slice(0, 600) }); capture('first-frames.txt', text); }
  });
  const perps = ['E-BTC-USDT', 'E-SOL-USDT', 'E-SSV-USDT'];
  for (const p of perps) ws.send(sub(`market_${socketName(p)}_depth_step0`, p));
  ws.send(sub('market_e_btcusdt_depth_step1', 'step1'));
  ws.send(sub('mark_price_e_btcusdt', 'mark'));
  ws.send(sub('mark_price_e_ssvusdt', 'mark2'));
  ws.send(sub('market_e_btcusdt_ticker', 'tick'));
  ws.send(sub('market_e_nopeusdt_depth_step0', 'nope'));
  ws.send(sub('market_E-BTC-USDT_depth_step0', 'upper'));
  ws.send(sub('market_e_btcusdt_depth_step0', 'req', 'req'));
  ws.send('not json');
  await sleep(45_000);
  const rest = await (await fetch(`${API}/depth?contractName=E-BTC-USDT&limit=5`)).json();
  log('rest_compare', { restTopAsk: rest.asks[0], restTopBid: rest.bids[0], wsLast: lastBody['market_e_btcusdt_depth_step0']?.slice(0, 200) });
  for (const [ch, s] of Object.entries(stats)) log('channel_stats', { ch, frames: s.frames, perSec: +(s.frames / 45).toFixed(2), identicalRepeats: s.identical, askCounts: [...s.asks], bidCounts: [...s.bids], orderOk: s.orderOk, keys: s.keys, tickKeys: s.tickKeys });
  log('pings', { count: pings });
  ws.terminate();
}

async function batch() {
  const contracts = await (await fetch(`${API}/contracts`)).json();
  const names = contracts.filter((c) => c.status === 1 && c.type === 'E' && c.marginCoin === 'USDT').map((c) => c.symbol);
  const { ws, openMs } = await open();
  const seen = new Map();
  const acks = {};
  let t0 = 0;
  ws.on('message', (data, isBinary) => {
    const { json } = decode(data, isBinary);
    if (json.ping) { ws.send(JSON.stringify({ pong: json.ping })); return; }
    if (json.event_rep) { const k = `${json.event_rep}:${json.status}`; acks[k] = (acks[k] || 0) + 1; return; }
    if (json.channel && !seen.has(json.channel)) seen.set(json.channel, Math.round(performance.now() - t0));
    if (json.channel) seen.set(json.channel + '#n', (seen.get(json.channel + '#n') || 0) + 1);
  });
  t0 = performance.now();
  for (const n of names) ws.send(sub(`market_${socketName(n)}_depth_step0`, n));
  let closed = null;
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString(), atMs: Math.round(performance.now() - t0) }; });
  await sleep(30_000);
  const firsts = [...seen].filter(([k]) => !k.endsWith('#n')).map(([, v]) => v).sort((a, b) => a - b);
  const counts = [...seen].filter(([k]) => k.endsWith('#n')).map(([, v]) => v).sort((a, b) => a - b);
  const channels = [...seen.keys()].filter((k) => !k.endsWith('#n'));
  const silentAll = names.filter((n) => !seen.has(`market_${socketName(n)}_depth_step0`));
  log('batch', { openMs, subscribed: names.length, acks, deliveredChannels: firsts.length, depthChannels: channels.filter((c) => c.endsWith('_depth_step0')).length, markChannels: channels.filter((c) => c.startsWith('mark_price_')).length, otherChannels: channels.filter((c) => !c.endsWith('_depth_step0') && !c.startsWith('mark_price_')), silentCount: silentAll.length, lastFirstFrameMs: firsts[firsts.length - 1], framesPerChannel30s: { min: counts[0], median: counts[Math.floor(counts.length / 2)], max: counts[counts.length - 1] }, silent: silentAll.slice(0, 20), closed });
  ws.terminate();
}

async function silence() {
  const run = async (label, answer) => {
    const { ws } = await open();
    const t0 = performance.now();
    let pings = 0;
    let frames = 0;
    let firstPingMs = null;
    ws.on('message', (data, isBinary) => {
      const { json } = decode(data, isBinary);
      if (json.ping) { pings++; firstPingMs ??= Math.round(performance.now() - t0); if (answer) ws.send(JSON.stringify({ pong: json.ping })); return; }
      frames++;
    });
    ws.send(sub('market_e_btcusdt_depth_step0', label));
    return new Promise((resolve) => {
      const done = (code, reason) => resolve({ label, code, reason: reason?.toString(), closedAtMs: Math.round(performance.now() - t0), pings, firstPingMs, frames });
      ws.on('close', done);
      setTimeout(() => { ws.terminate(); resolve({ label, open: true, pings, firstPingMs, frames, atMs: 70_000 }); }, 70_000);
    });
  };
  const res = await Promise.all([run('answers', true), run('silent', false)]);
  for (const r of res) log('silence', r);
}

async function deflate() {
  const { ws, openMs } = await open({ deflate: true });
  log('deflate', { openMs, negotiated: ws.extensions || '' });
  ws.terminate();
}

const mode = process.argv[2] || 'book';
await ({ book, batch, silence, deflate })[mode]();
process.exit(0);
