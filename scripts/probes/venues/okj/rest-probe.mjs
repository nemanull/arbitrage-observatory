// OKJ (OKCoin Japan) REST probe: host and latency, catalog per instrument type, the missing anchor endpoints, tickers, the REST book, errors and clock offset.
// Public, unauthenticated, read-only. About 100 requests over about 40 s, each endpoint below its published per 2 s limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/okj/rest-probe.mjs [all|latency|catalog|anchor|book|errors|clock|ccxt]
// The ccxt mode also loads the okx class with its hostname set to api.okj.com, spot only, which costs a few public requests.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/okj/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'api.okj.com';
const API = `https://${HOST}/api/v5`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${path}`, { headers: { 'cache-control': 'no-cache' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, headers: res.headers, text, body, ms, bytes: text.length };
}

async function latency() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });
  const wsAddrs = await lookup('ws.okj.com', { all: true });
  log('dns', { host: 'ws.okj.com', addrs: wsAddrs.map((a) => a.address) });
  const cold = await get('public/time');
  const h = cold.headers;
  log('cold', {
    path: 'public/time',
    status: cold.status,
    ms: cold.ms,
    server: h.get('server'),
    via: h.get('via'),
    xcache: h.get('x-cache'),
    cfRay: h.get('cf-ray'),
    headers: [...h.keys()].join(','),
  });
  for (const path of ['public/time', 'market/tickers?instType=SPOT', 'public/instruments?instType=SPOT']) {
    const ms = [];
    let bytes = 0;
    for (let i = 0; i < 10; i++) {
      const r = await get(path);
      ms.push(r.ms);
      bytes = r.bytes;
      await sleep(250);
    }
    log('warm', { path, n: ms.length, bytes, min: Math.min(...ms), median: pct(ms, 50), p90: pct(ms, 90), max: Math.max(...ms) });
  }
}

async function catalog() {
  for (const t of ['SPOT', 'MARGIN', 'SWAP', 'FUTURES', 'OPTION']) {
    const r = await get(`public/instruments?instType=${t}`);
    log('instType', { instType: t, status: r.status, code: r.body?.code, msg: r.body?.msg, rows: r.body?.data?.length });
    if (t === 'SPOT') {
      keep('instruments-spot.json', r.text);
      const d = r.body.data;
      const count = (k) => d.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {});
      log('spot', {
        rows: d.length,
        state: count('state'),
        quote: count('quoteCcy'),
        ruleType: count('ruleType'),
        emptyContractFields: d.every((x) => x.ctVal === '' && x.ctMult === '' && x.settleCcy === ''),
        tickSz: count('tickSz'),
      });
    }
    await sleep(300);
  }
  const opt = await get('public/instruments?instType=OPTION&uly=BTC-JPY');
  log('instType', { instType: 'OPTION uly=BTC-JPY', status: opt.status, code: opt.body?.code, msg: opt.body?.msg });

  const tk = await get('market/tickers?instType=SPOT');
  keep('tickers-spot.json', tk.text);
  const rows = tk.body.data;
  const now = Date.now();
  const byVol = rows
    .map((x) => ({ id: x.instId, volJpy: Math.round(Number(x.volCcy24h)), bid: x.bidPx, ask: x.askPx, ageS: Math.round((now - Number(x.ts)) / 1000) }))
    .sort((a, b) => b.volJpy - a.volJpy);
  log('tickers', {
    status: tk.status,
    ms: tk.ms,
    bytes: tk.bytes,
    rows: rows.length,
    fields: Object.keys(rows[0]).join(','),
    sumVolJpy: byVol.reduce((s, x) => s + x.volJpy, 0),
    zeroVol: byVol.filter((x) => x.volJpy === 0).length,
    emptyBidOrAsk: byVol.filter((x) => !x.bid || !x.ask).length,
  });
  for (const x of byVol.slice(0, 8)) log('topVolume', x);
  log('bottomVolume', { ids: byVol.slice(-8).map((x) => `${x.id}:${x.volJpy}`).join(' ') });
  const plat = await get('market/platform-24-volume');
  log('platform24h', { status: plat.status, body: plat.text });
}

async function anchor() {
  const paths = [
    'public/mark-price?instType=SPOT',
    'public/mark-price?instType=SWAP',
    'public/funding-rate?instId=BTC-JPY',
    'public/funding-rate-history?instId=BTC-JPY',
    'public/price-limit?instId=BTC-JPY',
    'public/estimated-price?instId=BTC-JPY',
    'market/index-tickers?quoteCcy=JPY',
    'market/index-tickers?instId=BTC-JPY',
    'market/index-components?index=BTC-JPY',
    'public/open-interest?instType=SWAP',
  ];
  // The daily OKJ BTC Index behind www.okj.com/btc-index, the only price index the venue publishes.
  const idx = await fetch('https://www.okj.com/v2/support/home/price-index/btc_jpy/getData');
  const body = await idx.json();
  const e = body.data?.entries ?? [];
  log('okjBtcIndex', { status: idx.status, entries: e.length, newest: e[0], newestAt: e[0] ? new Date(e[0].calculateTime).toISOString() : undefined });
  for (const p of paths) {
    const r = await get(p);
    log('anchorPath', { path: p, status: r.status, ms: r.ms, body: r.text.slice(0, 160) });
    await sleep(300);
  }
}

async function book() {
  const levels = (side) => side.map((l) => Number(l[0]));
  const ordered = (xs, desc) => xs.every((x, i) => i === 0 || (desc ? xs[i - 1] > x : xs[i - 1] < x));
  for (const id of ['BTC-JPY', 'XRP-JPY', 'IOST-JPY']) {
    for (const path of [`market/books?instId=${id}&sz=400`, `market/books-full?instId=${id}&sz=5000`, `market/books?instId=${id}`]) {
      const r = await get(path);
      const d = r.body?.data?.[0];
      if (!d) {
        log('book', { path, status: r.status, body: r.text.slice(0, 160) });
        continue;
      }
      const b = levels(d.bids);
      const a = levels(d.asks);
      log('book', {
        path,
        status: r.status,
        ms: r.ms,
        bytes: r.bytes,
        bids: b.length,
        asks: a.length,
        bidsDesc: ordered(b, true),
        asksAsc: ordered(a, false),
        tuple: d.bids[0]?.length,
        top: [d.bids[0], d.asks[0]],
        ageMs: Date.now() - Number(d.ts),
      });
      await sleep(300);
    }
  }
  // Caching: ten reads 200 ms apart, count distinct ts and distinct top of book.
  for (const path of ['market/books?instId=BTC-JPY&sz=20', 'market/books-full?instId=BTC-JPY&sz=20']) {
    const ts = new Set();
    const tops = new Set();
    for (let i = 0; i < 10; i++) {
      const r = await get(path);
      const d = r.body.data[0];
      ts.add(d.ts);
      tops.add(JSON.stringify([d.bids[0], d.asks[0]]));
      await sleep(200);
    }
    log('bookCache', { path, reads: 10, distinctTs: ts.size, distinctTop: tops.size });
  }
}

async function errors() {
  const paths = [
    'market/books?instId=NOPE-JPY',
    'market/books?instId=BTC-USDT',
    'market/books?instId=BTC-JPY&sz=401',
    'market/ticker?instId=NOPE-JPY',
    'market/tickers?instType=SWAP',
    'public/instruments',
    'nope/path',
  ];
  for (const p of paths) {
    const r = await get(p);
    log('error', { path: p, status: r.status, body: r.text.slice(0, 200) });
    await sleep(300);
  }
  // Rate limit headers, if any.
  const r = await get('market/tickers?instType=SPOT');
  const rl = [...r.headers.entries()].filter(([k]) => /rate|limit|retry|remaining/i.test(k));
  log('rateLimitHeaders', { headers: rl });
}

async function clock() {
  const offs = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get('public/time');
    const t1 = Date.now();
    const server = Number(r.body.data[0].ts);
    offs.push({ off: server - (t0 + t1) / 2, rtt: t1 - t0 });
    await sleep(300);
  }
  const best = offs.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  log('clock', { samples: offs.length, bestRttMs: best.rtt, offsetAtBestMs: Math.round(best.off), offsetsMs: offs.map((o) => Math.round(o.off)).join(',') });
}

async function ccxtCheck() {
  const ids = ccxt.exchanges.filter((x) => /okj|okcoin|ok/i.test(x));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, okLike: ids.join(','), hasOkj: ccxt.exchanges.includes('okj'), hasOkcoin: ccxt.exchanges.includes('okcoin') });
  // No OKJ class exists. The okx class speaks the same V5 paths, so this reads what it makes of OKJ's spot catalog with the hostname swapped.
  const ex = new ccxt.okx({ hostname: HOST, options: { fetchMarkets: { types: ['spot'] } } });
  try {
    const markets = Object.values(await ex.loadMarkets());
    const m = ex.market('BTC/JPY');
    log('ccxtOkxHostname', { hostname: HOST, markets: markets.length, id: m.id, symbol: m.symbol, type: m.type, active: m.active, taker: m.taker, maker: m.maker, contractSize: m.contractSize, precision: m.precision });
  } catch (e) {
    log('ccxtOkxHostname', { hostname: HOST, error: `${e.constructor.name}: ${String(e.message).slice(0, 200)}` });
  }
}

const mode = process.argv[2] ?? 'all';
const run = {
  latency,
  catalog,
  anchor,
  book,
  errors,
  clock,
  ccxt: ccxtCheck,
};
log('start', { mode, at: new Date().toISOString() });
for (const [name, fn] of Object.entries(run)) {
  if (mode === 'all' || mode === name) await fn();
}
log('end', { at: new Date().toISOString() });
