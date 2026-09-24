// Emirex REST probe: host and latency, the spot catalog, the fee config, REST book snapshots, errors, server time, and a one second poll of the bulk ticker.
// Public, unauthenticated, read-only. Every call is a GET except the site's own config getter, POST /api/default/config with no body, which every anonymous page load makes.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/emirex/rest-probe.mjs [latency|catalog|book|errors|time|poll|all]
//   latency  DNS, three cold and ten warm requests. About 15 s.
//   catalog  /v1/public/symbols, the bulk /api/default/ticker, /api/default/ticker-margin, the config's trade_commission and margin lists, and a CCXT class check. About 5 s.
//   book     /v1/public/book on all pairs: levels, order, spread, sequenceId, a limit parameter, two back-to-back reads, and the BTCUSDC trade list. About 20 s.
//   errors   unknown and missing pair, unknown path, and every rate limit header seen. About 10 s.
//   time     /api/info/time against the local clock, five reads. About 6 s.
//   poll     /api/default/ticker once a second for 30 s: reply time and how often each pair's rate changed.
//   mirror   ten reads, 2 s apart, of the Emirex touch on four pairs next to Binance spot's public bookTicker. About 25 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/emirex/rest.md and fees.md.
import { createRequire } from 'node:module';
import https from 'node:https';
import dns from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.emirex.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });
const mirrorAgent = new https.Agent({ keepAlive: true, maxSockets: 8 }); // the mirror reads go out together

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

function request(url, { method = 'GET', agent = warmAgent } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(url, { method, agent, headers: { 'user-agent': 'observatory-probe/1', accept: 'application/json' } }, (res) => {
      const chunks = [];
      let ttfb;
      res.once('data', () => { ttfb = performance.now() - t0; });
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, ms: Math.round(performance.now() - t0), ttfb: Math.round(ttfb ?? 0), bytes: Buffer.byteLength(body), remote: res.socket?.remoteAddress });
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const json = (r) => { try { return JSON.parse(r.body); } catch { return null; } };
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function latency() {
  const host = 'api.emirex.com';
  const t0 = performance.now();
  const addrs = await dns.resolve4(host);
  log('dns', { host, ms: Math.round(performance.now() - t0), addrs, socket: await dns.resolve4('socket.emirex.com') });
  const url = `${API}/v1/public/symbols`;
  const cold = [];
  for (let i = 0; i < 3; i++) {
    const r = await request(url, { agent: false });
    cold.push(r.ms);
    log('cold', { i, status: r.status, ms: r.ms, ttfb: r.ttfb, bytes: r.bytes, remote: r.remote, cfRay: r.headers['cf-ray'] });
    await sleep(500);
  }
  const warm = [];
  for (let i = 0; i < 10; i++) {
    const r = await request(url);
    warm.push(r.ms);
    await sleep(500);
  }
  log('latency_summary', { url, cold: stats(cold), warm: stats(warm) });
}

async function catalog() {
  const sym = await request(`${API}/v1/public/symbols`);
  save('symbols.json', sym.body);
  const s = json(sym);
  log('symbols', { status: sym.status, ms: sym.ms, bytes: sym.bytes, count: s?.data?.length, pairs: s?.data?.map((p) => `${p.id}:${p.pair}:${p.base}/${p.quote}:${p.rate_decimal}/${p.base_decimal}/${p.quote_decimal}`) });

  const tick = await request(`${API}/api/default/ticker`);
  save('default-ticker.json', tick.body);
  const t = json(tick);
  const rows = t?.data ?? [];
  log('bulk_ticker', { status: tick.status, ms: tick.ms, bytes: tick.bytes, rows: rows.length, keys: rows[0] ? Object.keys(rows[0]) : [] });
  for (const r of rows) {
    log('bulk_row', { id: r.id, name: r.name, status: r.status, type: r.type, pair_type: r.pair_type, rate: r.rate / 1e8, rate_usd: r.main?.rate_usd / 1e8, volume24h: r.volume / 1e8, commission_percent: r.commission_percent, commission_percent_market: r.commission_percent_market, commission_percent_limit_hidden: r.commission_percent_limit_hidden, min_price: r.min_price, min_step_price: r.min_step_price, min_step_volume: r.min_step_volume, low_liquidity: r.low_liquidity, created: new Date(r.time_create * 1000).toISOString() });
  }

  const margin = await request(`${API}/api/default/ticker-margin`);
  log('ticker_margin', { status: margin.status, body: margin.body.slice(0, 200) });

  const cfg = await request(`${API}/api/default/config`, { method: 'POST' });
  save('config.json', cfg.body);
  const c = json(cfg)?.data ?? {};
  const tc = Object.entries(c.trade_commission ?? {}).map(([id, v]) => `${id}:${c.all_pairs?.[id]}:market=${v.market_percent}:limit=${v.limit_percent}:percent=${v.percent}:fixed=${v.fixed}:min=${v.min_commission}:quick=${v.quick_market_percent}:special=${JSON.stringify(v.special)}`);
  log('config', { status: cfg.status, ms: cfg.ms, bytes: cfg.bytes, keys: Object.keys(c).length, trade_commission: tc, margin_pair_list: c.margin_pair_list, margin_trade_commission: c.margin_trade_commission, margin_currency_list: c.margin_currency_list, order_types: c.order?.type_trade, trade_min: c.trade_min, pair_limit_rate_btc: c.pair_limit_rate?.BTCUSDC });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, emirexLike: ccxt.exchanges.filter((x) => /emi|mirex/i.test(x)) });
}

function checkOrder(levels, desc) {
  let bad = 0;
  for (let i = 1; i < levels.length; i++) if (desc ? levels[i].rate > levels[i - 1].rate : levels[i].rate < levels[i - 1].rate) bad++;
  return bad;
}

async function book() {
  const sym = json(await request(`${API}/v1/public/symbols`))?.data ?? [];
  for (const p of sym) {
    const r = await request(`${API}/v1/public/book?pair=${p.pair}`);
    const d = json(r)?.data ?? {};
    const buy = d.buy ?? [];
    const sell = d.sell ?? [];
    const bid = buy[0]?.rate;
    const ask = sell[0]?.rate;
    const notionalTop = (lv, n) => lv.slice(0, n).reduce((a, l) => a + l.volume * l.rate, 0);
    log('book', { pair: p.pair, status: r.status, ms: r.ms, bytes: r.bytes, bids: buy.length, asks: sell.length, bidsDescBad: checkOrder(buy, true), asksAscBad: checkOrder(sell, false), bid, ask, spreadPpm: bid && ask ? Math.round(((ask - bid) / ((ask + bid) / 2)) * 1e6) : null, sequenceId: d.sequenceId, maxCount: Math.max(0, ...buy.concat(sell).map((l) => l.count)), top20QuoteBid: Math.round(notionalTop(buy, 20)), top20QuoteAsk: Math.round(notionalTop(sell, 20)), farBid: buy.at(-1)?.rate, farAsk: sell.at(-1)?.rate, cache: r.headers['cf-cache-status'], cacheControl: r.headers['cache-control'] ?? null });
    if (p.pair === 'BTCUSDC') save('book-BTCUSDC.json', r.body);
    await sleep(400);
  }
  const tr = await request(`${API}/v1/public/trades?pair=BTCUSDC`);
  const trades = json(tr)?.data ?? [];
  const ts = trades.map((x) => x.timestamp).sort((x, y) => x - y);
  const gaps = ts.slice(1).map((x, i) => x - ts[i]);
  log('trades', { status: tr.status, count: trades.length, volume: stats(trades.map((x) => x.volume)), quote: stats(trades.map((x) => Math.round(x.price * 100) / 100)), gapSeconds: stats(gaps), newest: new Date(ts.at(-1) * 1000).toISOString(), sides: [...new Set(trades.map((x) => x.type))] });
  const a = await request(`${API}/v1/public/book?pair=BTCUSDC`);
  const b = await request(`${API}/v1/public/book?pair=BTCUSDC`);
  const da = json(a)?.data;
  const db = json(b)?.data;
  log('back_to_back', { msApart: b.ms, seqA: da?.sequenceId, seqB: db?.sequenceId, sameBody: a.body === b.body });
  for (const q of ['limit=5', 'depth=5', 'size=5']) {
    const r = await request(`${API}/v1/public/book?pair=BTCUSDC&${q}`);
    const d = json(r)?.data ?? {};
    log('book_param', { q, status: r.status, bids: d.buy?.length, asks: d.sell?.length });
    await sleep(400);
  }
}

async function errors() {
  const cases = [
    ['GET', '/v1/public/book?pair=NOPEUSDC'],
    ['GET', '/v1/public/book'],
    ['GET', '/v1/public/ticker'],
    ['GET', '/v1/public/ticker?pair=NOPEUSDC'],
    ['GET', '/v1/public/trades?pair=NOPEUSDC'],
    ['GET', '/v1/public/book?pair=btcusdc'],
    ['GET', '/v1/public/book?pair=BTC_USDC'],
    ['GET', '/v1/public/nope'],
    ['GET', '/v1/public/fundingRate'],
    ['GET', '/v1/public/markets'],
  ];
  const limitHeaders = new Set();
  for (const [method, path] of cases) {
    const r = await request(`${API}${path}`, { method });
    for (const h of Object.keys(r.headers)) if (/rate|limit|retry|quota|remaining/i.test(h)) limitHeaders.add(`${h}: ${r.headers[h]}`);
    const d = json(r);
    const brief = d?.data && Array.isArray(d.data.buy) ? `{status:${d.status}, buy:${d.data.buy.length}, sell:${d.data.sell.length}}` : r.body.replace(/\s+/g, ' ').slice(0, 160);
    log('error_case', { method, path, status: r.status, ms: r.ms, contentType: r.headers['content-type'], body: brief });
    await sleep(400);
  }
  log('rate_limit_headers', { seen: [...limitHeaders] });
}

async function time() {
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await request(`${API}/api/info/time`);
    const t1 = Date.now();
    const d = json(r);
    const server = d?.data ?? d?.time ?? d;
    const serverMs = typeof server === 'number' ? (server > 1e12 ? server : server * 1000) : null;
    log('time', { status: r.status, body: r.body.slice(0, 120), rttMs: t1 - t0, offsetMs: serverMs === null ? null : Math.round(serverMs - (t0 + t1) / 2), dateHeader: r.headers.date });
    await sleep(1000);
  }
}

async function poll() {
  const last = new Map();
  const changes = new Map();
  const ms = [];
  let failures = 0;
  const statuses = new Map();
  for (let i = 0; i < 30; i++) {
    const start = Date.now();
    try {
      const r = await request(`${API}/api/default/ticker`);
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      ms.push(r.ms);
      for (const row of json(r)?.data ?? []) {
        if (last.has(row.name) && last.get(row.name) !== row.rate) changes.set(row.name, (changes.get(row.name) ?? 0) + 1);
        last.set(row.name, row.rate);
      }
    } catch (e) {
      failures++;
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  log('poll_summary', { polls: 30, failures, statuses: Object.fromEntries(statuses), ms: stats(ms), rateChangesIn29Intervals: Object.fromEntries(changes) });
}

// Emirex's touch against Binance spot's at the same instant, to see whether the book follows a larger venue.
async function mirror() {
  const pairs = ['BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'DOGEUSDC'];
  const diffs = new Map(pairs.map((p) => [p, { mid: [], bidVsBid: [], askVsAsk: [], spread: [], binanceSpread: [] }]));
  const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbols=${encodeURIComponent(JSON.stringify(pairs))}`;
  for (let i = 0; i < 10; i++) {
    const [bn, ...books] = await Promise.all([request(url, { agent: mirrorAgent }), ...pairs.map((p) => request(`${API}/v1/public/book?pair=${p}&limit=1`, { agent: mirrorAgent }))]);
    const bnRows = new Map((json(bn) ?? []).map((r) => [r.symbol, r]));
    pairs.forEach((p, k) => {
      const d = json(books[k])?.data;
      const b = bnRows.get(p);
      if (!d?.buy?.[0] || !d?.sell?.[0] || !b) return;
      const eb = d.buy[0].rate;
      const ea = d.sell[0].rate;
      const bb = Number(b.bidPrice);
      const ba = Number(b.askPrice);
      const x = diffs.get(p);
      const ppm = (a, c) => Math.round(((a - c) / c) * 1e6);
      x.mid.push(ppm((eb + ea) / 2, (bb + ba) / 2));
      x.bidVsBid.push(ppm(eb, bb));
      x.askVsAsk.push(ppm(ea, ba));
      x.spread.push(ppm(ea, eb));
      x.binanceSpread.push(ppm(ba, bb));
    });
    await sleep(2000);
  }
  for (const [p, x] of diffs) log('mirror', { pair: p, samples: x.mid.length, emirexMidVsBinanceMidPpm: stats(x.mid), emirexBidVsBinanceBidPpm: stats(x.bidVsBid), emirexAskVsBinanceAskPpm: stats(x.askVsAsk), emirexSpreadPpm: stats(x.spread), binanceSpreadPpm: stats(x.binanceSpread) });
}

const mode = process.argv[2] ?? 'all';
const modes = { latency, catalog, book, errors, time, poll, mirror };
log('start', { mode, at: new Date().toISOString() });
if (mode === 'all') {
  for (const m of ['latency', 'catalog', 'book', 'errors', 'time', 'poll', 'mirror']) await modes[m]();
} else {
  await modes[mode]();
}
log('end', { at: new Date().toISOString() });
warmAgent.destroy();
mirrorAgent.destroy();
