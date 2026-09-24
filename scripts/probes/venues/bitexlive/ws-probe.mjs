// Bitexlive WebSocket probe: the undocumented Pusher protocol socket the web app uses, its book event, keepalive, silence, errors and compression.
// Public, unauthenticated, read-only. Public channels only, no auth call, no private channel. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// The socket URL and app key come from the site's own bundle, https://bitexlive.com/build/assets/index-Cf4Q9gzi.js, and the channel id of each pair from window.pageData on https://bitexlive.com/exchange/BTC_USDT.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitexlive/ws-probe.mjs [book|silence|errors|deflate]
//   book     every exchange.public.<uuid> channel plus market.public for 110 s, with a REST order book read every 5 s and after each BTC frame. About 115 s.
//   silence  two sockets for up to 90 s: one that never subscribes or sends, one that subscribes and never sends.
//   errors   unknown channel, repeated subscribe, unsubscribe, text that is not JSON, unknown event, pusher:ping. About 12 s.
//   deflate  asks for permessage-deflate once and prints what the server negotiates.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/bitexlive/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_URL = 'wss://wss.bitexlive.com/app/fiac7yamhonzmyhqokgp?protocol=7&client=js&version=8.4.0&flash=false';
const PAGE_URL = 'https://bitexlive.com/exchange/BTC_USDT';
const API = 'https://prod.bitexlive.com/api/public';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sub = (channel) => JSON.stringify({ event: 'pusher:subscribe', data: { channel } });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

// The exchange page embeds every pair with its uuid, which is the only way to name a book channel.
async function loadPairs() {
  const html = await (await fetch(PAGE_URL, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
  const start = html.indexOf('window.pageData = ') + 'window.pageData = '.length;
  let depth = 0;
  let end = start;
  for (; end < html.length; end++) {
    if (html[end] === '{') depth++;
    else if (html[end] === '}' && --depth === 0) break;
  }
  const page = JSON.parse(html.slice(start, end + 1));
  return Object.values(page.pairs).flat().map((p) => ({ id: p.id, title: p.title }));
}

function open(label, opts = {}) {
  const t0 = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: opts.deflate ?? false });
  ws.on('upgrade', (res) => log('upgrade', { label, status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null, poweredBy: res.headers['x-powered-by'] ?? null }));
  ws.on('ping', () => log('protocol_ping', { label, atMs: Date.now() - t0 }));
  ws.on('close', (code, reason) => log('close', { label, code, reason: reason.toString(), afterMs: Date.now() - t0 }));
  ws.on('error', (e) => log('error', { label, message: e.message }));
  ws.t0 = t0;
  return ws;
}

function parse(raw) {
  const f = JSON.parse(raw.toString());
  const data = typeof f.data === 'string' && f.data.startsWith('{') ? JSON.parse(f.data) : f.data;
  return { ...f, data };
}

function sideOrder(levels, key) {
  const p = levels.map((l) => Number(l[key]));
  let asc = true;
  let desc = true;
  for (let i = 1; i < p.length; i++) {
    if (p[i] < p[i - 1]) asc = false;
    if (p[i] > p[i - 1]) desc = false;
  }
  return asc && desc ? 'flat' : asc ? 'ascending' : desc ? 'descending' : 'unordered';
}

async function restBook(symbol) {
  const t = Date.now();
  const res = await fetch(`${API}/orderBook?filter=${symbol}&limit=50`);
  const body = await res.json();
  return { ms: Date.now() - t, body };
}

async function book() {
  const pairs = await loadPairs();
  log('pairs', { count: pairs.length, sample: pairs.slice(0, 3) });
  const byId = new Map(pairs.map((p) => [p.id, p.title]));
  const ws = open('book');
  const stats = new Map(); // channel|event to { n, bytes, firstMs, lastMs, gaps[] }
  const books = new Map(); // title to last orderBook
  let shownBook = 0;
  let shownTrade = 0;
  let shownMarket = 0;
  let subAt = 0;
  const marketPerPair = new Map(); // title to market_data.updated count
  const bookBytes = [];
  ws.on('open', () => {
    log('open', { ms: Date.now() - ws.t0 });
    subAt = Date.now();
    for (const p of pairs) ws.send(sub(`exchange.public.${p.id}`));
    ws.send(sub('market.public'));
  });
  ws.on('message', (raw) => {
    const at = Date.now() - ws.t0;
    const s = raw.toString();
    capture('book-frames.txt', `${Date.now()} ${s.length > 20000 ? s.slice(0, 20000) : s}`);
    const f = parse(raw);
    const title = f.channel?.startsWith('exchange.public.') ? byId.get(f.channel.slice(16)) : f.channel;
    const key = `${title}|${f.event}`;
    const st = stats.get(key) ?? { n: 0, bytes: 0, firstMs: at, lastMs: at, maxGapMs: 0 };
    if (st.n) st.maxGapMs = Math.max(st.maxGapMs, at - st.lastMs);
    st.n++;
    st.bytes += s.length;
    st.lastMs = at;
    stats.set(key, st);
    if (f.event === 'pusher:connection_established') log('established', { data: f.data });
    if (f.event === 'pusher_internal:subscription_succeeded' && title === 'BTC_USDT') log('ack', { afterSubMs: Date.now() - subAt, frame: s });
    if (f.event === 'market_data.updated') marketPerPair.set(f.data.marketData.title, (marketPerPair.get(f.data.marketData.title) ?? 0) + 1);
    if (f.event === 'order.book.updated') {
      bookBytes.push(s.length);
      const ob = f.data.orderBook ?? f.data;
      const buy = ob.BUY ?? [];
      const sell = ob.SELL ?? [];
      const prev = books.get(title);
      books.set(title, { buy, sell, at: Date.now() });
      if (shownBook < 3) {
        shownBook++;
        log('book_frame', { title, keys: Object.keys(f.data), obKeys: Object.keys(ob), buyN: buy.length, sellN: sell.length, levelKeys: buy[0] ? Object.keys(buy[0]) : null, buyHead: buy.slice(0, 2), sellHead: sell.slice(0, 2), sellTail: sell.slice(-2), bytes: s.length });
      }
      const pk = buy[0] ? Object.keys(buy[0]).find((k) => /price/i.test(k)) : null;
      const bestBid = pk ? Math.max(...buy.map((l) => Number(l[pk]))) : null;
      const bestAsk = pk && sell.length ? Math.min(...sell.map((l) => Number(l[pk]))) : null;
      const same = prev && JSON.stringify(prev.buy) === JSON.stringify(buy) && JSON.stringify(prev.sell) === JSON.stringify(sell);
      // amount is rounded to the pair's amount_decimals, total / price recovers the size the level really holds
      const levels = [...buy, ...sell];
      const rounded = levels.filter((l) => Math.abs(Number(l.total) / Number(l.price) - Number(l.amount)) > 0.01 * (Number(l.total) / Number(l.price))).length;
      const summary = { at, title, buyN: buy.length, sellN: sell.length, buyOrder: pk ? sideOrder(buy, pk) : null, sellOrder: pk ? sideOrder(sell, pk) : null, bestBid, bestAsk, crossed: bestBid !== null && bestAsk !== null && bestBid >= bestAsk, sameAsPrev: prev ? !!same : null, sincePrevMs: prev ? Date.now() - prev.at : null, roundedOver1pct: rounded, levels: levels.length };
      capture('book-summary.txt', JSON.stringify(summary));
      if (summary.crossed || summary.sameAsPrev || title === 'BTC_USDT') log('book_summary', summary);
      if (title === 'BTC_USDT') compareRest(buy, sell);
    }
    if (f.event === 'public_trade.created' && shownTrade < 2) {
      shownTrade++;
      log('trade_frame', { title, frame: s.slice(0, 600) });
    }
    if (f.event === 'market_data.updated' && shownMarket < 1) {
      shownMarket++;
      log('market_frame', { frame: s.slice(0, 700) });
    }
  });
  // One REST read right after each BTC frame, to see whether both carry the same levels.
  async function compareRest(buy, sell) {
    const r = await restBook('BTC_USDT');
    // REST prints some prices with a float artefact such as 87233.50999999, so prices are matched to one cent
    const cents = (p) => Math.round(Number(p) * 100);
    const ws = new Map([...buy, ...sell].map((l) => [cents(l.price), l]));
    const rest = [...r.body.bids, ...r.body.asks];
    const matched = rest.filter((l) => ws.has(cents(l[0])));
    const near = (a, b) => Math.abs(a - b) <= 0.01 * Math.max(a, b);
    log('rest_vs_ws', {
      ms: r.ms,
      restBids: r.body.bids.length,
      restAsks: r.body.asks.length,
      wsLevels: ws.size,
      wsLevelsFoundInRest: [...ws.keys()].filter((c) => rest.some((l) => cents(l[0]) === c)).length,
      restSizeNearWsAmount: matched.filter((l) => near(Number(l[1]), Number(ws.get(cents(l[0])).amount))).length,
      restSizeNearWsTotalOverPrice: matched.filter((l) => { const w = ws.get(cents(l[0])); return near(Number(l[1]), Number(w.total) / Number(w.price)); }).length,
      restTop: { bids: r.body.bids.slice(0, 3), asks: r.body.asks.slice(-3) },
      wsTop: { buy: buy.slice(0, 3), sell: sell.slice(-3) },
      restAskOrder: sideOrder(r.body.asks.map((a) => ({ price: a[0] })), 'price'),
      restBidOrder: sideOrder(r.body.bids.map((b) => ({ price: b[0] })), 'price'),
    });
  }
  const restReads = [];
  for (let i = 0; i < 22; i++) {
    await sleep(5_000);
    const r = await restBook('BTC_USDT');
    const ws1 = books.get('BTC_USDT');
    restReads.push({ at: Date.now() - ws.t0, ms: r.ms, ts: r.body.LastUpdateTimestamp, bid: r.body.bids?.[0]?.[0], askFirst: r.body.asks?.[0]?.[0], askMin: Math.min(...(r.body.asks ?? []).map((a) => Number(a[0]))), wsHave: !!ws1 });
  }
  ws.close();
  await sleep(300);
  const rows = [...stats.entries()].map(([k, v]) => ({ k, ...v }));
  const bookRows = rows.filter((r) => r.k.endsWith('|order.book.updated'));
  log('summary', { secs: 110, channels: rows.length, bookChannelsWithFrames: bookRows.length, bookFrames: bookRows.reduce((a, r) => a + r.n, 0), bookBytes: bookRows.reduce((a, r) => a + r.bytes, 0) });
  const perPair = [...marketPerPair.values()];
  log('market_data_per_pair', { pairs: marketPerPair.size, min: Math.min(...perPair), max: Math.max(...perPair) });
  log('book_frame_bytes', { min: Math.min(...bookBytes), max: Math.max(...bookBytes), subscribeSentMs: subAt - ws.t0 });
  for (const r of rows) log('stat', r);
  for (const r of restReads) log('rest_btc', r);
}

async function silence() {
  const pairs = await loadPairs();
  const btc = pairs.find((p) => p.title === 'BTC_USDT');
  const a = open('no-sub-no-send');
  const b = open('sub-no-send');
  const count = { a: 0, b: 0 };
  a.on('message', (raw) => { count.a++; const f = parse(raw); if (f.event !== 'market_data.updated') log('frame', { label: 'no-sub-no-send', atMs: Date.now() - a.t0, event: f.event, data: f.data }); });
  b.on('open', () => b.send(sub(`exchange.public.${btc.id}`)));
  b.on('message', (raw) => { count.b++; const f = parse(raw); if (!/order\.book|public_trade/.test(f.event)) log('frame', { label: 'sub-no-send', atMs: Date.now() - b.t0, event: f.event }); });
  const end = Date.now() + 90_000;
  while (Date.now() < end && (a.readyState <= 1 || b.readyState <= 1)) await sleep(1_000);
  log('silence_done', { heldMs: Date.now() - (end - 90_000), aOpen: a.readyState === 1, bOpen: b.readyState === 1, framesA: count.a, framesB: count.b });
  a.terminate();
  b.terminate();
}

async function errors() {
  const pairs = await loadPairs();
  const btc = pairs.find((p) => p.title === 'BTC_USDT');
  const ws = open('errors');
  ws.on('message', (raw) => {
    const s = raw.toString();
    const f = parse(raw);
    if (/order\.book|public_trade|market_data/.test(f.event)) return;
    log('reply', { atMs: Date.now() - ws.t0, frame: s.slice(0, 400) });
  });
  await new Promise((r) => ws.on('open', r));
  const steps = [
    ['ping', JSON.stringify({ event: 'pusher:ping', data: {} })],
    ['unknown uuid', sub('exchange.public.00000000-0000-0000-0000-000000000000')],
    ['symbol as channel', sub('exchange.public.BTC_USDT')],
    ['first subscribe', sub(`exchange.public.${btc.id}`)],
    ['repeat subscribe', sub(`exchange.public.${btc.id}`)],
    ['unsubscribe', JSON.stringify({ event: 'pusher:unsubscribe', data: { channel: `exchange.public.${btc.id}` } })],
    ['unknown event', JSON.stringify({ event: 'nope', data: {} })],
    ['not json', 'hello'],
    ['ping after errors', JSON.stringify({ event: 'pusher:ping', data: {} })],
  ];
  for (const [label, text] of steps) {
    log('send', { label, atMs: Date.now() - ws.t0, text });
    ws.send(text);
    await sleep(1_200);
  }
  log('errors_done', { open: ws.readyState === 1 });
  ws.close();
  await sleep(300);
}

async function deflate() {
  const ws = open('deflate', { deflate: true });
  ws.on('message', (raw) => log('first_frame', { frame: raw.toString().slice(0, 200) }));
  await sleep(4_000);
  ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'book';
const modes = { book, silence, errors, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, utc: new Date().toISOString() });
await modes[mode]();
log('end', { mode, utc: new Date().toISOString() });
