// Blockchain.com Exchange REST probe: host and latency, the symbols catalog and how CCXT maps it, every open L2 book, one-second polls, and error shapes.
// Public, unauthenticated, read-only. At most two requests a second, well inside the 1,200 messages a minute the API page names for the socket.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/blockchaincom/rest-probe.mjs [catalog|books|poll|errors]
//   catalog  DNS, cold and warm GET /symbols, status and quote counts, tickers, CCXT loadMarkets and market.taker. About 10 s.
//   books    GET /l2 on every open symbol at 2 per second, level counts, order and spread, one L3 book, a Kraken BTC/USD reference. About 40 s.
//   poll     60 one-second polls of /tickers and /l2/BTC-USD: reply time and how often the numbers change. About 65 s.
//   errors   unknown, closed and malformed symbols, a depth parameter, and paths that do not exist. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/blockchaincom/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.blockchain.com/v3/exchange';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, min: s[0], median: pct(s, 0.5), p90: pct(s, 0.9), max: s[s.length - 1] };
}

async function catalog() {
  for (const host of ['api.blockchain.com', 'ws.blockchain.info', 'exchange.blockchain.com']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: String(e.code) }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }

  const cold = await get('/symbols');
  keep('symbols.json', cold.text);
  log('symbols_cold', {
    status: cold.status,
    ms: cold.ms,
    bytes: cold.bytes,
    date: cold.headers.get('date'),
    cfRay: cold.headers.get('cf-ray'),
    rateHeaders: [...cold.headers.keys()].filter((k) => /rate|limit|retry/i.test(k)),
  });

  const warm = [];
  for (let i = 0; i < 5; i++) {
    await sleep(500);
    warm.push((await get('/symbols')).ms);
  }
  log('symbols_warm_ms', { values: warm });

  const symbols = cold.json;
  const entries = Object.entries(symbols);
  const byStatus = {};
  for (const [, s] of entries) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const open = entries.filter(([, s]) => s.status === 'open');
  const byQuote = {};
  for (const [, s] of open) byQuote[s.counter_currency] = (byQuote[s.counter_currency] ?? 0) + 1;
  const bases = [...new Set(open.map(([, s]) => s.base_currency))].sort();
  const keyMismatch = entries.filter(([k, s]) => k !== `${s.base_currency}-${s.counter_currency}`).map(([k]) => k);
  const nonZeroAuction = open.filter(([, s]) => s.auction_price !== 0 || s.auction_time !== '').map(([k]) => k);
  const perpLike = entries.filter(([k]) => /PERP|SWAP|-P$|FUT/i.test(k)).map(([k]) => k);
  log('catalog', { total: entries.length, byStatus, openByQuote: byQuote, openBases: bases, keyMismatch, nonZeroAuction, perpLike });
  log('sample_open', { id: open[0][0], row: open[0][1] });

  const tickers = await get('/tickers');
  keep('tickers.json', tickers.text);
  const traded = tickers.json.filter((t) => t.volume_24h > 0);
  log('tickers', {
    status: tickers.status,
    ms: tickers.ms,
    bytes: tickers.bytes,
    rows: tickers.json.length,
    withVolume: traded.length,
    traded: traded.map((t) => `${t.symbol} vol ${t.volume_24h} last ${t.last_trade_price}`),
  });

  const ex = new ccxt.blockchaincom();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const btc = markets['BTC/USD'];
  log('ccxt', {
    version: ccxt.version,
    ms: Math.round(performance.now() - t0),
    markets: list.length,
    active: list.filter((m) => m.active).length,
    swaps: list.filter((m) => m.swap).length,
    idEqualsKey: list.every((m) => symbols[m.id] !== undefined),
    takerValues: [...new Set(list.map((m) => String(m.taker)))],
    makerValues: [...new Set(list.map((m) => String(m.maker)))],
    btcUsd: {
      id: btc.id,
      type: btc.type,
      active: btc.active,
      taker: btc.taker ?? null,
      maker: btc.maker ?? null,
      linear: btc.linear ?? null,
      contractSize: btc.contractSize ?? null,
      precision: btc.precision,
      minAmount: btc.limits.amount.min,
    },
    feeTiersTaker0: ex.fees.trading.tiers.taker[0],
    feeTiersMaker0: ex.fees.trading.tiers.maker[0],
  });
}

function sortedDesc(levels) {
  return levels.every((l, i) => i === 0 || levels[i - 1].px >= l.px);
}

function sortedAsc(levels) {
  return levels.every((l, i) => i === 0 || levels[i - 1].px <= l.px);
}

async function books() {
  const symbols = (await get('/symbols')).json;
  const open = Object.entries(symbols).filter(([, s]) => s.status === 'open').map(([k]) => k);
  const rows = [];
  for (const sym of open) {
    await sleep(500);
    const r = await get(`/l2/${sym}`);
    const b = r.json?.bids ?? [];
    const a = r.json?.asks ?? [];
    const bb = b.length ? Math.max(...b.map((l) => l.px)) : null;
    const ba = a.length ? Math.min(...a.map((l) => l.px)) : null;
    const spreadPpm = bb && ba ? Math.round(((ba - bb) / ((ba + bb) / 2)) * 1e6) : null;
    rows.push({
      sym,
      status: r.status,
      ms: r.ms,
      nb: b.length,
      na: a.length,
      bidsDesc: sortedDesc(b),
      asksAsc: sortedAsc(a),
      spreadPpm,
      bidUsdTop: bb ? Math.round(bb * b.find((l) => l.px === bb).qty) : null,
      maxNum: Math.max(0, ...b.map((l) => l.num), ...a.map((l) => l.num)),
      errorBody: r.status === 200 ? undefined : r.text.slice(0, 80),
    });
  }
  keep('l2_all.json', JSON.stringify(rows));
  const hist = {};
  for (const r of rows) {
    const k = r.status === 200 ? `${r.nb}x${r.na}` : `http${r.status}`;
    hist[k] = (hist[k] ?? 0) + 1;
  }
  log('l2_levels_hist', { symbols: rows.length, hist });
  log('l2_order', {
    bidsNotDesc: rows.filter((r) => !r.bidsDesc).map((r) => r.sym),
    asksNotAsc: rows.filter((r) => !r.asksAsc).map((r) => r.sym),
    statuses: [...new Set(rows.map((r) => r.status))],
    ms: stats(rows.map((r) => r.ms)),
  });
  const withBoth = rows.filter((r) => r.spreadPpm !== null);
  log('l2_spread_ppm', { twoSided: withBoth.length, oneSidedOrEmpty: rows.length - withBoth.length, ...stats(withBoth.map((r) => r.spreadPpm)) });
  log('l2_errors', { bodies: [...new Set(rows.filter((r) => r.errorBody).map((r) => r.errorBody))], symbols: rows.filter((r) => r.errorBody).map((r) => r.sym) });
  log('l2_empty', { symbols: rows.filter((r) => r.status === 200 && r.nb === 0 && r.na === 0).map((r) => r.sym) });
  log('l2_two_sided', { rows: withBoth.map((r) => `${r.sym} ${r.nb}x${r.na} ${r.spreadPpm}ppm bidQuote ${r.bidUsdTop} num<=${r.maxNum}`) });

  const btc = await get('/l2/BTC-USD');
  log('l2_btc_usd', { status: btc.status, bytes: btc.bytes, body: btc.text.slice(0, 400) });
  const l3 = await get('/l3/BTC-USD');
  log('l3_btc_usd', { status: l3.status, bytes: l3.bytes, body: l3.text.slice(0, 400) });

  const kr = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD').then((r) => r.json()).catch(() => null);
  const k = kr?.result && Object.values(kr.result)[0];
  if (k && btc.json?.bids?.length && btc.json?.asks?.length) {
    const mid = (btc.json.bids[0].px + btc.json.asks[0].px) / 2;
    const kmid = (Number(k.a[0]) + Number(k.b[0])) / 2;
    log('btc_reference', { blockchainMid: mid, krakenMid: kmid, diffPpm: Math.round(((mid - kmid) / kmid) * 1e6) });
  }
}

async function poll() {
  const tick = [];
  const book = [];
  const seenTick = new Set();
  const seenBook = new Set();
  let changesTick = 0;
  let changesBook = 0;
  let lastTick = '';
  let lastBook = '';
  const statuses = {};
  for (let i = 0; i < 60; i++) {
    const t = performance.now();
    const [a, b] = await Promise.all([get('/tickers'), get('/l2/BTC-USD')]);
    statuses[a.status] = (statuses[a.status] ?? 0) + 1;
    statuses[b.status] = (statuses[b.status] ?? 0) + 1;
    tick.push(a.ms);
    book.push(b.ms);
    const tk = JSON.stringify(a.json);
    const bk = JSON.stringify(b.json);
    if (i > 0 && tk !== lastTick) changesTick++;
    if (i > 0 && bk !== lastBook) changesBook++;
    lastTick = tk;
    lastBook = bk;
    seenTick.add(tk);
    seenBook.add(bk);
    const wait = 1000 - (performance.now() - t);
    if (wait > 0) await sleep(wait);
  }
  log('poll', {
    polls: 60,
    statuses,
    tickersMs: stats(tick),
    l2Ms: stats(book),
    tickersChanged: changesTick,
    tickersDistinct: seenTick.size,
    l2Changed: changesBook,
    l2Distinct: seenBook.size,
    lastBook: lastBook.slice(0, 300),
  });

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const before = Date.now();
    const r = await get('/tickers/BTC-USD');
    const after = Date.now();
    const server = Date.parse(r.headers.get('date'));
    offsets.push(Math.round(server + 500 - (before + after) / 2));
    await sleep(700);
  }
  log('date_header_offset_ms', { values: offsets, note: 'Date has 1 s resolution, so +500 ms centres it' });
}

async function errors() {
  const cases = [
    '/l2/NOPE-USD',
    '/l2/btc-usd',
    '/l2/BTCUSD',
    '/l2/TFUEL-USDC',
    '/l2/BTC-USD?depth=1',
    '/l3/BTC-USD?depth=1',
    '/symbols/NOPE-USD',
    '/symbols/BTC-USD',
    '/tickers/NOPE-USD',
    '/tickers/BTC-USD',
    '/tickers/TFUEL-USDC',
    '/time',
    '/nope',
  ];
  for (const path of cases) {
    await sleep(500);
    const r = await get(path);
    log('case', {
      path,
      status: r.status,
      ms: r.ms,
      contentType: r.headers.get('content-type'),
      retryAfter: r.headers.get('retry-after'),
      body: r.text.slice(0, 240),
    });
  }
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, books, poll, errors }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
log('end', { mode, at: new Date().toISOString() });
