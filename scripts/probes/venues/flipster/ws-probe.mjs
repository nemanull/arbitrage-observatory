// Flipster WebSocket probe: whether the documented Trading API stream accepts a handshake without API key headers, and what the website's own public stream sends to an anonymous client.
// Public, unauthenticated and read-only: no api-key, api-signature or api-expires header, no cookie and no Origin header is ever sent.
// Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/flipster/ws-probe.mjs [api|web|catalog]
//   api      one handshake to wss://trading-api.flipster.io/api/v1/stream, and if it opened, the documented orderbook and ticker topics for 10 s, about 12 s
//   web      the undocumented stream the flipster.io web client opens for logged out visitors, 5 s with no subscription, then the book and ticker tables of three perpetuals for 25 s, about 32 s
//   catalog  the same stream's perpetual list and detail tables for every row, one snapshot each, counted by quote currency and zero 24 h turnover, about 8 s
// The web stream is not part of the published API, so this only records what it is, and the profile does not recommend it as a feed.
// Set PROBE_OUT_DIR to keep raw frames, capped at 2 MB.
// Recorded in docs/profiles/flipster/websocket.md.
import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const API_URL = 'wss://trading-api.flipster.io/api/v1/stream';
const WEB_URL = 'wss://api.flipster.io/api/v2/stream/r230522-public?mode=subscription';
const OUT = process.env.PROBE_OUT_DIR;
const CAP_BYTES = 2_000_000;
const SYMBOLS = ['BTCUSDT.PERP', 'ETHUSDT.PERP', 'PYTHUSDT.PERP']; // two busy books and one the website table showed with zero 24 h turnover
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  try {
    if (statSync(file).size > CAP_BYTES) return;
  } catch {}
  appendFileSync(file, text + '\n');
}

// Resolves with the socket once open, or with the HTTP refusal of the upgrade.
function open(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 10_000 });
    ws.on('open', () => resolve({ ws, openMs: Math.round(performance.now() - t0), extensions: ws.extensions }));
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const headers = {};
        for (const [k, v] of Object.entries(res.headers)) if (/^(content-type|retry-after|x-prex-.*|cf-ray|www-authenticate|server)$/i.test(k)) headers[k] = v;
        resolve({ refused: { status: res.statusCode, ms: Math.round(performance.now() - t0), headers, body: body.slice(0, 300) } });
      });
    });
    ws.on('error', (e) => resolve({ error: e.message }));
  });
}

async function api() {
  const r = await open(API_URL);
  if (!r.ws) {
    log('api_handshake', r);
    return;
  }
  log('api_open', { openMs: r.openMs });
  const frames = [];
  r.ws.on('message', (d) => {
    frames.push(d.toString());
    capture('api-frames.jsonl', d.toString());
  });
  r.ws.on('close', (code, reason) => log('api_close', { code, reason: reason.toString() }));
  r.ws.send(JSON.stringify({ op: 'subscribe', args: SYMBOLS.flatMap((s) => [`orderbook.${s}`, `ticker.${s}`]) }));
  await sleep(10_000);
  log('api_frames', { count: frames.length, first: frames.slice(0, 3).map((f) => f.slice(0, 400)) });
  r.ws.terminate();
}

async function web() {
  const r = await open(WEB_URL);
  if (!r.ws) {
    log('web_handshake', r);
    return;
  }
  log('web_open', { openMs: r.openMs, extensions: r.extensions });
  const ws = r.ws;
  const t0 = Date.now();
  const stats = { frames: 0, bytes: 0, beforeSubscribe: 0, tables: {}, events: {}, keys: {}, firstByTable: {} };
  const tickers = {}; // per symbol: frames, field names, and how many frames changed each anchor field
  const books = {}; // per symbol: parts seen, levels, spread in ppm, locked and crossed counts, level order, arrival gaps
  const book = (table, atMs) => {
    for (const [part, rows] of Object.entries(table)) {
      for (const [sym, row] of Object.entries(rows ?? {})) {
        const b = (books[sym] ??= { parts: {}, frames: 0, bidLevels: [], askLevels: [], spreadPpm: [], locked: 0, crossed: 0, unordered: 0, gaps: [], lastAt: null, sizeAtTouch: [], touchQuote: [], secondGapPpm: [], repeats: 0, lastJson: '' });
        b.parts[part] = (b.parts[part] ?? 0) + 1;
        b.frames++;
        if (b.lastAt !== null) b.gaps.push(atMs - b.lastAt);
        b.lastAt = atMs;
        const json = JSON.stringify(row);
        if (json === b.lastJson) b.repeats++;
        b.lastJson = json;
        if (!row?.bids?.length || !row?.asks?.length) continue;
        const bid = Number(row.bids[0][0]);
        const ask = Number(row.asks[0][0]);
        b.bidLevels.push(row.bids.length);
        b.askLevels.push(row.asks.length);
        b.spreadPpm.push(((ask - bid) / ((ask + bid) / 2)) * 1e6);
        b.sizeAtTouch.push(`${row.bids[0][1]}/${row.asks[0][1]}`);
        b.touchQuote.push(Math.round(Math.min(bid * Number(row.bids[0][1]), ask * Number(row.asks[0][1]))));
        // Distance from the touch to the second level on each side, to see whether the touch is a thin quote in front of the book.
        if (row.bids.length > 1) b.secondGapPpm.push(Math.round(((bid - Number(row.bids[1][0])) / bid) * 1e7) / 10);
        if (row.asks.length > 1) b.secondGapPpm.push(Math.round(((Number(row.asks[1][0]) - ask) / ask) * 1e7) / 10);
        if (bid === ask) b.locked++;
        if (bid > ask) b.crossed++;
        const desc = row.bids.every((x, i, a) => i === 0 || Number(a[i - 1][0]) > Number(x[0]));
        const asc = row.asks.every((x, i, a) => i === 0 || Number(a[i - 1][0]) < Number(x[0]));
        if (!desc || !asc) b.unordered++;
      }
    }
  };
  const spread = (a) => {
    const v = [...a].sort((x, y) => x - y);
    return v.length ? { min: v[0], median: v[v.length >> 1], max: v[v.length - 1], n: v.length } : null;
  };
  let subscribed = false;
  ws.on('message', (d, isBinary) => {
    const text = d.toString();
    stats.frames++;
    stats.bytes += text.length;
    if (!subscribed) stats.beforeSubscribe++;
    capture('web-frames.jsonl', `${Date.now() - t0}\t${text}`);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      log('web_nonjson', { isBinary, head: text.slice(0, 120) });
      return;
    }
    for (const k of Object.keys(msg)) stats.keys[k] = (stats.keys[k] ?? 0) + 1;
    for (const [table, body] of Object.entries(msg.t ?? {})) {
      stats.tables[table] = (stats.tables[table] ?? 0) + 1;
      if (!stats.firstByTable[table]) {
        stats.firstByTable[table] = true;
        log('web_first_table', { atMs: Date.now() - t0, table, parts: Object.keys(body), sample: text.slice(0, 700) });
      }
    }
    for (const [sym, row] of Object.entries(msg.t?.['market/tickers']?.s ?? {})) {
      const k = (tickers[sym] ??= { frames: 0, fields: Object.keys(row), changes: {}, last: {} });
      k.frames++;
      for (const f of ['midPrice', 'markPrice', 'indexPrice', 'fundingRate', 'fundingTime']) {
        if (k.frames > 1 && row[f] !== k.last[f]) k.changes[f] = (k.changes[f] ?? 0) + 1;
        k.last[f] = row[f];
      }
    }
    const bookTable = msg.t?.['market/orderbooks-v2'];
    if (bookTable) book(bookTable, Date.now() - t0);
    for (const e of Object.keys(msg.e ?? {})) stats.events[e] = (stats.events[e] ?? 0) + 1;
    if (stats.frames <= 3 && !msg.t) log('web_frame', { atMs: Date.now() - t0, sample: text.slice(0, 400) });
  });
  ws.on('ping', () => log('web_server_ping', { atMs: Date.now() - t0 }));
  ws.on('close', (code, reason) => log('web_close', { atMs: Date.now() - t0, code, reason: reason.toString() }));

  await sleep(5_000);
  subscribed = true;
  const frame = { s: { 'market/orderbooks-v2': { rows: SYMBOLS }, 'market/tickers': { rows: SYMBOLS } } };
  ws.send(JSON.stringify(frame));
  log('web_subscribe', { atMs: Date.now() - t0, frame });
  await sleep(25_000);
  log('web_summary', stats);
  for (const [sym, k] of Object.entries(tickers)) log('web_ticker', { sym, frames: k.frames, fields: k.fields, changes: k.changes, last: k.last });
  for (const [sym, b] of Object.entries(books)) {
    log('web_book', {
      sym,
      parts: b.parts,
      frames: b.frames,
      bidLevels: spread(b.bidLevels),
      askLevels: spread(b.askLevels),
      spreadPpm: spread(b.spreadPpm.map((x) => Math.round(x * 10) / 10)),
      identicalToPrevious: b.repeats,
      locked: b.locked,
      crossed: b.crossed,
      unordered: b.unordered,
      gapMs: spread(b.gaps),
      touchSizes: b.sizeAtTouch.slice(0, 4),
      touchQuoteUsdt: spread(b.touchQuote),
      secondLevelGapPpm: spread(b.secondGapPpm),
    });
  }
  ws.terminate();
}

// The web client subscribes a table with the row list ["*"] to get every row.
async function catalog() {
  const r = await open(WEB_URL);
  if (!r.ws) {
    log('catalog_handshake', r);
    return;
  }
  const tables = {};
  r.ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    for (const [table, body] of Object.entries(msg.t ?? {})) {
      if (body.s && !tables[table]) {
        tables[table] = body.s;
        capture(`catalog-${table.replace('/', '-')}.json`, JSON.stringify(body.s));
      }
    }
  });
  r.ws.send(JSON.stringify({ s: { 'market/pswaps': { rows: ['*'] }, 'market/pswap-details': { rows: ['*'] }, 'market/spots': { rows: ['*'] } } }));
  await sleep(6_000);
  r.ws.terminate();
  for (const [table, rows] of Object.entries(tables)) {
    const keys = Object.keys(rows);
    const first = rows[keys.find((k) => k.startsWith('BTCUSDT')) ?? keys[0]];
    const byQuote = {};
    const bySuffix = {};
    for (const k of keys) {
      const quote = rows[k]?.quoteCurrency ?? rows[k]?.quote ?? k.replace(/\..*$/, '').match(/(USDT|USD1|USDC|USD)$/)?.[1] ?? 'other';
      byQuote[quote] = (byQuote[quote] ?? 0) + 1;
      const suffix = k.includes('.') ? k.slice(k.indexOf('.')) : '(none)';
      bySuffix[suffix] = (bySuffix[suffix] ?? 0) + 1;
    }
    const zeroTurnover = keys.filter((k) => Number(rows[k]?.turnover24h) === 0).length;
    const nextFunding = {};
    for (const k of keys) {
      if (!rows[k]?.fundingTime) continue;
      const at = new Date(Number(BigInt(rows[k].fundingTime) / 1_000_000n)).toISOString(); // fundingTime is nanoseconds
      nextFunding[at] = (nextFunding[at] ?? 0) + 1;
    }
    const scaled = keys.filter((k) => /^1000/.test(k));
    log('catalog_table', { table, rows: keys.length, byQuote, bySuffix, zeroTurnover, nextFunding, scaled, fields: Object.keys(first ?? {}), sampleKey: keys.find((k) => k.startsWith('BTCUSDT')) ?? keys[0], sample: JSON.stringify(first).slice(0, 900) });
  }
}

const mode = process.argv[2] ?? 'api';
if (mode === 'api') await api();
else if (mode === 'web') await web();
else if (mode === 'catalog') await catalog();
else throw new Error(`unknown mode ${mode}`);
