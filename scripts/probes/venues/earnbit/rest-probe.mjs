// EarnBIT REST probe: host and latency, the spot catalog and a search for any futures route, the REST books and their level order,
// the per order fee fields of the public order list, error shapes, rate limit headers, clock offset, CoinGecko listing context,
// and a side by side read of Bybit and Binance spot, because the EarnBIT books look like a market maker quoting around them.
// Public, unauthenticated, read-only. The API answers with x-ratelimit-limit 500 per 60 s, and every mode stays under 3 calls per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/earnbit/rest-probe.mjs [main|poll]
//   main  CCXT class check, DNS including futures host guesses, the Cloudflare trace, 10 status calls, catalog, futures path search, books, fee scan of every market, errors, Bybit and Binance compare, CoinGecko. About 60 s.
//   poll  the tickers call once a second for 60 s, and the BTC_USDT book twice a second for 20 s. About 85 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/earnbit/rest.md and fees.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.earnbit.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const mode = process.argv[2] ?? 'main';

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

const isSorted = (v, dir) => v.every((x, i) => i === 0 || (dir > 0 ? x >= v[i - 1] : x <= v[i - 1]));

function tcpConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const t = performance.now();
    const s = net.connect({ host, port });
    const done = (r) => {
      s.destroy();
      resolve({ ...r, ms: Math.round(performance.now() - t) });
    };
    s.setTimeout(timeoutMs, () => done({ ok: false, why: 'timeout' }));
    s.on('connect', () => done({ ok: true }));
    s.on('error', (e) => done({ ok: false, why: e.code }));
  });
}

async function main() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, earnbit: ccxt.exchanges.filter((x) => /earn/i.test(x)) });

  for (const host of ['api.earnbit.com', 'ws.earnbit.com', 'earnbit.com', 'back.earnbitech.cloud', 'ws-futures.earnbit.com', 'futures.earnbit.com', 'api-futures.earnbit.com']) {
    try {
      log('dns', { host, addrs: await dns.resolve4(host) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }
  // Cloudflare's trace names the edge and the country this host's traffic leaves from.
  const trace = await get(`${API}/cdn-cgi/trace`);
  log('cf_trace', Object.fromEntries(trace.text.split('\n').filter((l) => /^(loc|colo|http|tls)=/.test(l)).map((l) => l.split('='))));

  // The web app's own backend, named in its bundle, is not the public API, and only whether it answers is recorded.
  log('tcp', { host: 'back.earnbitech.cloud', ...(await tcpConnect('back.earnbitech.cloud', 443, 8000)) });
  try {
    const r = await fetch('https://back.earnbitech.cloud/api/v1/front-page/market', { signal: AbortSignal.timeout(8000) });
    log('web_backend', { status: r.status });
  } catch (e) {
    log('web_backend', { error: e.name, cause: e.cause?.code ?? e.message });
  }

  // The root answers a status object with the server clock, so it doubles as the latency and clock call.
  const times = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get(`${API}/`);
    const after = Date.now();
    times.push(r.ms);
    if (r.json?.timestamp) offsets.push(r.json.timestamp - (before + after) / 2);
    if (i === 0) {
      log('status_first', { status: r.status, ms: r.ms, body: r.text.slice(0, 120), cfRay: r.headers.get('cf-ray'), date: r.headers.get('date') });
    }
    await sleep(400);
  }
  log('status_latency', { cold: times[0], warm: stats(times.slice(1)), offsetMs: stats(offsets.map(Math.round)) });

  const cat = {};
  for (const p of ['markets', 'symbols', 'products', 'tickers']) {
    const r = await get(`${API}/api/v1/public/${p}`);
    keep(`${p}.json`, r.text);
    cat[p] = r.json?.result;
    log('catalog_call', {
      path: `/api/v1/public/${p}`,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      rows: Array.isArray(r.json?.result) ? r.json.result.length : Object.keys(r.json?.result ?? {}).length,
      rateLimit: [r.headers.get('x-ratelimit-limit'), r.headers.get('x-ratelimit-remaining'), r.headers.get('x-ratelimit-reset')],
      cfRay: r.headers.get('cf-ray'),
    });
    await sleep(400);
  }
  const markets = cat.markets ?? [];
  const byQuote = {};
  for (const m of markets) byQuote[m.money] = (byQuote[m.money] ?? 0) + 1;
  log('catalog', { count: markets.length, byQuote, fields: Object.keys(markets[0] ?? {}), names: markets.map((m) => m.name).join(' ') });
  log('catalog_sample', { first: markets[0], btc: markets.find((m) => m.name === 'BTC_USDT') });
  const tick = cat.tickers ?? {};
  const vol = Object.entries(tick).map(([k, v]) => [k, Number(v.ticker?.deal ?? 0)]).sort((a, b) => b[1] - a[1]);
  log('tickers_volume', { top: vol.slice(0, 6), bottom: vol.slice(-4), totalQuoteVolume: Math.round(vol.reduce((a, [, v]) => a + v, 0)) });
  log('tickers_sample', { BTC_USDT: tick.BTC_USDT });

  for (const p of [
    '/api/v1/public/futures',
    '/api/v1/public/futures/markets',
    '/api/v1/public/perpetual/markets',
    '/api/v1/public/margin/markets',
    '/api/v2/public/markets',
    '/api/v4/public/futures',
  ]) {
    const r = await get(`${API}${p}`);
    log('futures_path', { path: p, status: r.status, body: r.text.slice(0, 100) });
    await sleep(350);
  }

  for (const limit of [1, 50, 100, 1000]) {
    const r = await get(`${API}/api/v1/public/depth/result?market=BTC_USDT&limit=${limit}`);
    const a = (r.json?.asks ?? []).map((x) => Number(x[0]));
    const b = (r.json?.bids ?? []).map((x) => Number(x[0]));
    log('depth_result', {
      limit,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      asks: a.length,
      bids: b.length,
      asksAscending: isSorted(a, 1),
      bidsAscending: isSorted(b, 1),
      bestBid: Math.max(...b),
      firstBid: b[0],
      lastBid: b[b.length - 1],
      bestAsk: Math.min(...a),
      firstAsk: a[0],
      keys: Object.keys(r.json ?? {}),
      cache: r.headers.get('cf-cache-status'),
    });
    await sleep(400);
  }
  const d2 = await get(`${API}/api/v1/public/depth/result?market=BTC_USDT&limit=2`);
  log('depth_result_frame', { body: d2.text.slice(0, 300) });
  await sleep(400);
  const q = await get(`${API}/api/v1/public/depth/result?market=IMX_USDT&limit=1000`);
  log('depth_result_quiet', { market: 'IMX_USDT', asks: q.json?.asks?.length, bids: q.json?.bids?.length });
  await sleep(400);

  // The order list carries takerFee and makerFee per resting order, which is the only public trace of the fee a user pays.
  const fees = {};
  const stampsPerMarket = {};
  let orders = 0;
  for (const m of markets) {
    for (const side of ['sell', 'buy']) {
      const r = await get(`${API}/api/v1/public/book?market=${m.name}&side=${side}&offset=0&limit=100`);
      const list = r.json?.result?.orders ?? [];
      orders += list.length;
      const stamps = new Set();
      for (const o of list) {
        const k = `${o.takerFee}/${o.makerFee}`;
        fees[k] = (fees[k] ?? 0) + 1;
        stamps.add(o.timestamp);
      }
      stampsPerMarket[`${m.name}:${side}`] = { shown: list.length, total: r.json?.result?.total, stamps: stamps.size };
      await sleep(350);
    }
  }
  log('book_fee_scan', { markets: markets.length, orders, takerSlashMaker: fees });
  const sides = Object.values(stampsPerMarket);
  log('book_order_stamps', {
    sides: sides.length,
    totalOrdersPerSide: stats(sides.map((x) => x.total)),
    distinctTimestampsPerSide: stats(sides.map((x) => x.stamps)),
    btc: [stampsPerMarket['BTC_USDT:buy'], stampsPerMarket['BTC_USDT:sell']],
  });
  const b1 = await get(`${API}/api/v1/public/book?market=BTC_USDT&side=buy&offset=0&limit=2`);
  log('book_frame', { body: b1.text.slice(0, 420) });

  const h = await get(`${API}/api/v1/public/history/result?market=BTC_USDT&since=0&limit=3`);
  log('history_result', { status: h.status, body: h.text.slice(0, 300) });
  await sleep(400);

  for (const p of [
    '/api/v1/public/nope',
    '/api/v1/public/depth/result',
    '/api/v1/public/depth/result?market=NOPE_USDT',
    '/api/v1/public/depth/result?market=btc_usdt',
    '/api/v1/public/depth/result?market=BTC_USDT&limit=5000',
    '/api/v1/public/ticker?market=NOPE_USDT',
    '/api/v1/public/book?market=BTC_USDT',
  ]) {
    const r = await get(`${API}${p}`);
    log('error_case', { path: p, status: r.status, body: r.text.slice(0, 160) });
    await sleep(400);
  }

  // Bybit and Binance spot, one bulk call each, to see whether EarnBIT quotes and prints at their prices.
  // All three bulk calls leave together, so the mids compared are read within about a second of each other.
  const [eb, by, bn] = await Promise.all([
    get(`${API}/api/v1/public/tickers`),
    get('https://api.bybit.com/v5/market/tickers?category=spot'),
    get('https://api.binance.com/api/v3/ticker/24hr'),
  ]);
  const tickNow = eb.json?.result ?? {};
  const byMap = new Map((by.json?.result?.list ?? []).map((x) => [x.symbol, x]));
  const bnMap = new Map((Array.isArray(bn.json) ? bn.json : []).map((x) => [x.symbol, x]));
  const rows = [];
  let hiLoBybit = 0;
  let hiLoBinance = 0;
  for (const [name, v] of Object.entries(tickNow)) {
    const t = v.ticker;
    const sym = name.replace('_', '');
    const y = byMap.get(sym);
    const n = bnMap.get(sym);
    const mid = (Number(t.bid) + Number(t.ask)) / 2;
    const yMid = y ? (Number(y.bid1Price) + Number(y.ask1Price)) / 2 : NaN;
    const nMid = n ? (Number(n.bidPrice) + Number(n.askPrice)) / 2 : NaN;
    const sameBy = y && Number(y.highPrice24h) === Number(t.high) && Number(y.lowPrice24h) === Number(t.low);
    const sameBn = n && Number(n.highPrice) === Number(t.high) && Number(n.lowPrice) === Number(t.low);
    if (sameBy) hiLoBybit++;
    if (sameBn) hiLoBinance++;
    rows.push([
      name,
      Math.round(((Number(t.ask) - Number(t.bid)) / mid) * 1e6),
      y ? Math.round(((mid - yMid) / yMid) * 1e6) : null,
      n ? Math.round(((mid - nMid) / nMid) * 1e6) : null,
      sameBy ? 'Y' : '',
      sameBn ? 'N' : '',
    ]);
  }
  log('venue_compare_legend', { cols: 'market, EarnBIT spread ppm, EarnBIT mid minus Bybit mid ppm, minus Binance mid ppm, 24h high and low equal Bybit (Y), equal Binance (N)' });
  log('venue_compare', { rows });
  const onBybit = rows.filter((r) => r[2] !== null);
  log('venue_compare_summary', {
    markets: rows.length,
    onBybit: onBybit.length,
    midEqualBybit: onBybit.filter((r) => r[2] === 0).length,
    maxAbsMidVsBybitPpm: Math.max(...onBybit.map((r) => Math.abs(r[2]))),
    onBinance: rows.filter((r) => r[3] !== null).length,
    midEqualBinance: rows.filter((r) => r[3] === 0).length,
    maxAbsMidVsBinancePpm: Math.max(...rows.filter((r) => r[3] !== null).map((r) => Math.abs(r[3]))),
    highLowEqualBybit: hiLoBybit,
    highLowEqualBinance: hiLoBinance,
  });

  const cg = await get('https://api.coingecko.com/api/v3/exchanges/earnbit');
  const c = cg.json ?? {};
  log('coingecko', {
    status: cg.status,
    name: c.name,
    country: c.country,
    year: c.year_established,
    trustScore: c.trust_score,
    trustRank: c.trust_score_rank,
    coins: c.coins,
    pairs: c.pairs,
    btcVolume24h: c.trade_volume_24h_btc,
  });
}

async function poll() {
  const prev = {};
  const changes = {};
  const ms = [];
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    const r = await get(`${API}/api/v1/public/tickers`);
    ms.push(r.ms);
    for (const [k, v] of Object.entries(r.json?.result ?? {})) {
      const cur = `${v.ticker.bid}|${v.ticker.ask}|${v.ticker.last}`;
      if (prev[k] !== undefined && prev[k] !== cur) changes[k] = (changes[k] ?? 0) + 1;
      prev[k] = cur;
    }
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  const sorted = Object.entries(changes).sort((a, b) => b[1] - a[1]);
  log('tickers_poll', { polls: 60, ms: stats(ms), changedOfFiftyNine: sorted, unchanged: Object.keys(prev).filter((k) => !changes[k]) });

  let lastTop;
  let topChanges = 0;
  const bookMs = [];
  const stampGaps = [];
  let lastStamp;
  for (let i = 0; i < 40; i++) {
    const started = Date.now();
    const r = await get(`${API}/api/v1/public/depth/result?market=BTC_USDT&limit=100`);
    bookMs.push(r.ms);
    const top = JSON.stringify([r.json?.bids?.at(-1), r.json?.asks?.[0]]);
    if (lastTop !== undefined && top !== lastTop) topChanges++;
    lastTop = top;
    if (i % 4 === 0) {
      const o = await get(`${API}/api/v1/public/book?market=BTC_USDT&side=buy&offset=0&limit=1`);
      const s = o.json?.result?.orders?.[0]?.timestamp;
      if (s !== undefined && lastStamp !== undefined && s !== lastStamp) stampGaps.push(Math.round((s - lastStamp) * 1000));
      if (s !== undefined) lastStamp = s;
    }
    await sleep(Math.max(0, 500 - (Date.now() - started)));
  }
  log('book_poll', { polls: 40, ms: stats(bookMs), topChangesOf39: topChanges, bestBidOrderStampStepsMs: stampGaps });
}

if (mode === 'main') await main();
else if (mode === 'poll') await poll();
else console.log('modes: main | poll');
