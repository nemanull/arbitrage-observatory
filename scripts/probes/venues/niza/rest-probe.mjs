// Niza.fun perpetuals REST probe. Niza.fun is the Orderly builder `niza`, so every market data call goes to Orderly's public API.
// Measures host latency, the catalog against CCXT woofipro (the Orderly class), the anchor calls and how often they change, the public book snapshot, errors and the clock.
// Also checks the Niza Global spot hosts (niza.io, app.niza.io, api.niza.io) that the spot line of the coverage matrix cites.
// Public, unauthenticated, read-only. Stays under Orderly's published 10 requests per second per IP.
// Run from server/: node ../scripts/probes/venues/niza/rest-probe.mjs [catalog|anchor|book|errors]
//   catalog  DNS, cold and warm timing, /v1/public/info and /futures against CCXT woofipro, builder stats, index sources, spot hosts. About 15 s.
//   anchor   /v1/public/futures once a second for 60 s, change counts, funding history against the published rates. About 70 s.
//   book     the zero-auth /v1/public/query orderbook at several depths, level order, caching. About 10 s.
//   errors   unknown symbols, unknown paths, rate limit status. About 5 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/niza/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.orderly.org';
const OUT = process.env.PROBE_OUT_DIR;
const BROKER = 'niza';
const SHARED = /^PERP_[A-Z0-9]+_USDC$/; // builder-listed markets carry a `_<builder>` suffix
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: Math.min(...xs), median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs) });

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, init) {
  const t0 = performance.now();
  const res = await fetch(path.startsWith('http') ? path : API + path, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const query = (body) =>
  get('/v1/public/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function catalog() {
  for (const host of ['api.orderly.org', 'ws-evm.orderly.org', 'api-evm.orderly.org']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }

  const cold = await get('/v1/public/system_info');
  const warm = [];
  for (let i = 0; i < 5; i++) {
    warm.push((await get('/v1/public/system_info')).ms);
    await sleep(200);
  }
  log('latency', { call: 'system_info', coldMs: cold.ms, warmMs: warm, body: cold.json });

  const t0 = Date.now();
  const info = await get('/v1/public/info');
  const t1 = Date.now();
  save('info.json', info.text);
  const rows = info.json.data.rows;
  const shared = rows.filter((r) => SHARED.test(r.symbol));
  const count = (xs, f) => xs.reduce((a, r) => ((a[f(r)] = (a[f(r)] ?? 0) + 1), a), {});
  log('info', {
    status: info.status,
    ms: info.ms,
    bytes: info.bytes,
    rows: rows.length,
    byBuilder: count(rows, (r) => r.broker_id ?? 'shared'),
    byStatus: count(rows, (r) => r.status),
    sharedFundingPeriod: count(shared, (r) => r.funding_period),
    sharedCap: count(shared, (r) => `${r.floor_funding}/${r.cap_funding}`),
    sharedMarkBand: count(shared, (r) => `${r.mark_index_price_deviation_floor}/${r.mark_index_price_deviation_cap}`),
    pretge: rows.filter((r) => r.is_pretge).map((r) => r.symbol),
    offsetMs: info.json.timestamp - Math.round((t0 + t1) / 2),
  });
  log('info_btc', { row: rows.find((r) => r.symbol === 'PERP_BTC_USDC') });

  const fut = await get('/v1/public/futures');
  save('futures.json', fut.text);
  const frows = fut.json.data.rows;
  const fs = frows.filter((r) => SHARED.test(r.symbol));
  const byAmount = [...fs].sort((a, b) => a['24h_amount'] - b['24h_amount']);
  log('futures', {
    status: fut.status,
    ms: fut.ms,
    bytes: fut.bytes,
    rows: frows.length,
    shared: fs.length,
    fields: Object.keys(frows[0]),
    markZero: frows.filter((r) => !(r.mark_price > 0)).map((r) => r.symbol),
    indexZero: frows.filter((r) => !(r.index_price > 0)).map((r) => r.symbol),
    nextFunding: count(frows, (r) => new Date(r.next_funding_time).toISOString()),
    shared24hAmountUsdc: Math.round(fs.reduce((a, r) => a + r['24h_amount'], 0)),
    lowest: byAmount.slice(0, 4).map((r) => `${r.symbol} ${Math.round(r['24h_amount'])}`),
    highest: byAmount.slice(-4).map((r) => `${r.symbol} ${Math.round(r['24h_amount'])}`),
  });
  log('futures_btc', { row: frows.find((r) => r.symbol === 'PERP_BTC_USDC') });

  const one = await get('/v1/public/futures/PERP_BTC_USDC');
  log('futures_one', { status: one.status, ms: one.ms, bytes: one.bytes, keys: Object.keys(one.json?.data ?? {}) });

  const fr = await get('/v1/public/funding_rates');
  log('funding_rates', { status: fr.status, ms: fr.ms, bytes: fr.bytes, rows: fr.json.data.rows.length, btc: fr.json.data.rows.find((r) => r.symbol === 'PERP_BTC_USDC') });

  const e = new ccxt.woofipro();
  const c0 = performance.now();
  const markets = await e.loadMarkets();
  const ms = Math.round(performance.now() - c0);
  const list = Object.values(markets);
  const ids = new Set(list.map((m) => m.id));
  const bySymbol = count(list, (m) => m.symbol);
  const btc = markets['BTC/USDC:USDC'];
  log('ccxt_woofipro', {
    version: ccxt.version,
    ms,
    markets: list.length,
    swaps: list.filter((m) => m.swap).length,
    activeValues: [...new Set(list.map((m) => String(m.active)))],
    takers: [...new Set(list.map((m) => m.taker))],
    makers: [...new Set(list.map((m) => m.maker))],
    contractSizes: [...new Set(list.map((m) => m.contractSize))],
    linear: [...new Set(list.map((m) => m.linear))],
    idsEqualInfo: rows.every((r) => ids.has(r.symbol)) && list.length === rows.length,
    duplicateSymbols: Object.entries(bySymbol).filter(([, n]) => n > 1),
    builderExample: list.filter((m) => !SHARED.test(m.id)).slice(0, 2).map((m) => `${m.id} to ${m.symbol}`),
    btc: { id: btc.id, symbol: btc.symbol, base: btc.base, quote: btc.quote, settle: btc.settle, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker },
  });

  const ips = await get('/v1/public/index_price_source');
  save('index_price_source.json', ips.text);
  const src = new Map(ips.json.data.rows.map((r) => [r.symbol, r.sources]));
  const perSource = {};
  const perpBased = [];
  for (const r of shared) {
    const base = r.symbol.split('_')[1];
    const s = src.get(`SPOT_${base}_USDC`) ?? [];
    for (const x of s) perSource[x] = (perSource[x] ?? 0) + 1;
    if (s.some((x) => /futures|perp/.test(x))) perpBased.push(`${base}:${s.join('+')}`);
  }
  log('index_sources', { status: ips.status, rows: ips.json.data.rows.length, perSource, perpBased, btc: src.get('SPOT_BTC_USDC'), eth: src.get('SPOT_ETH_USDC') });

  for (const path of [`/v1/public/broker/name?broker_id=${BROKER}`, `/v1/public/broker/stats?broker_id=${BROKER}`, `/v1/public/volume/stats?broker_id=${BROKER}`, '/v1/public/volume/stats', '/v1/ip_info']) {
    const r = await get(path);
    const data = r.json?.data ?? r.text.slice(0, 200);
    if (path === '/v1/ip_info' && data && typeof data === 'object') delete data.ip; // keep the host address out of the record
    log('builder', { path, status: r.status, data });
  }

  for (const url of ['https://niza.io/', 'https://niza.fun/', 'https://niza.fun/perpetual', 'https://app.niza.io/trade/v1/markets', 'https://api.niza.io/']) {
    try {
      const r = await get(url, { redirect: 'manual' });
      log('niza_host', { url, status: r.status, bytes: r.bytes, vercelError: r.headers.get('x-vercel-error'), location: r.headers.get('location'), head: r.text.slice(0, 60) });
    } catch (err) {
      log('niza_host', { url, error: String(err.cause?.code ?? err.message) });
    }
  }
}

async function anchor() {
  const symbols = ['PERP_BTC_USDC', 'PERP_ETH_USDC', 'PERP_CL_USDC', 'PERP_MERL_USDC'];
  const prev = {};
  const changes = Object.fromEntries(symbols.map((s) => [s, { index: 0, mark: 0, est: 0, last: 0, next: 0 }]));
  const times = [];
  const offsets = [];
  const serverTs = [];
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const r = await get('/v1/public/futures');
    const t1 = Date.now();
    times.push(r.ms);
    if (r.status !== 200) {
      log('anchor_status', { i, status: r.status, body: r.text.slice(0, 200), retryAfter: r.headers.get('retry-after') });
      await sleep(1000);
      continue;
    }
    offsets.push(r.json.timestamp - Math.round((t0 + t1) / 2));
    serverTs.push(r.json.timestamp);
    for (const s of symbols) {
      const row = r.json.data.rows.find((x) => x.symbol === s);
      const p = prev[s];
      if (p) {
        if (row.index_price !== p.index_price) changes[s].index++;
        if (row.mark_price !== p.mark_price) changes[s].mark++;
        if (row.est_funding_rate !== p.est_funding_rate) changes[s].est++;
        if (row.last_funding_rate !== p.last_funding_rate) changes[s].last++;
        if (row.next_funding_time !== p.next_funding_time) changes[s].next++;
      }
      prev[s] = row;
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  log('anchor_poll', { polls: times.length, ms: stats(times), offsetMs: stats(offsets), changesOver59: changes });
  for (const s of symbols) log('anchor_last', { symbol: s, row: prev[s] });

  const fr = await get('/v1/public/funding_rates');
  const info = await get('/v1/public/info');
  for (const s of symbols) {
    const f = fr.json.data.rows.find((x) => x.symbol === s);
    const period = info.json.data.rows.find((x) => x.symbol === s).funding_period;
    const h = await get(`/v1/public/funding_rate_history?symbol=${s}`);
    const hist = (h.json?.data?.rows ?? []).slice(0, 4);
    log('funding_history', {
      symbol: s,
      period,
      status: h.status,
      published: { est: f.est_funding_rate, estTs: new Date(f.est_funding_rate_timestamp).toISOString(), last: f.last_funding_rate, lastTs: new Date(f.last_funding_rate_timestamp).toISOString(), next: new Date(f.next_funding_time).toISOString() },
      history: hist.map((x) => ({ rate: x.funding_rate, at: new Date(x.funding_rate_timestamp).toISOString(), next: x.next_funding_time && new Date(x.next_funding_time).toISOString() })),
      historyKeys: Object.keys(h.json?.data?.rows?.[0] ?? {}),
    });
    await sleep(200);
  }
}

async function book() {
  for (const [symbol, max] of [['PERP_BTC_USDC', 100], ['PERP_BTC_USDC', 1000], ['PERP_ETH_USDC', 1000], ['PERP_MERL_USDC', 1000], ['PERP_AXS_USDC', 100]]) {
    const r = await query({ type: 'orderbook', symbol, max_level: max });
    const d = r.json?.data;
    if (!d) {
      log('book', { symbol, status: r.status, body: r.text.slice(0, 200) });
      continue;
    }
    const bids = d.bids.map((l) => Number(l.price));
    const asks = d.asks.map((l) => Number(l.price));
    const desc = bids.every((p, i) => i === 0 || p < bids[i - 1]);
    const asc = asks.every((p, i) => i === 0 || p > asks[i - 1]);
    save(`book-${symbol}-${max}.json`, r.text);
    log('book', {
      symbol,
      maxLevel: max,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      weight: r.headers.get('x-ratelimit-weight'),
      remaining: r.headers.get('x-ratelimit-remaining'),
      bids: bids.length,
      asks: asks.length,
      bidsDescending: desc,
      asksAscending: asc,
      top: { bid: d.bids[0], ask: d.asks[0] },
      mid: d.mid_price,
      spread: d.spread,
      innerTsAgeMs: r.json.ts - d.ts,
      numberTypes: [typeof d.bids[0]?.price, typeof d.bids[0]?.quantity],
    });
    await sleep(300);
  }
  const a = await query({ type: 'orderbook', symbol: 'PERP_BTC_USDC', max_level: 5 });
  const b = await query({ type: 'orderbook', symbol: 'PERP_BTC_USDC', max_level: 5 });
  log('book_cache', { firstTs: a.json?.data?.ts, secondTs: b.json?.data?.ts, gapMs: b.json?.ts - a.json?.ts });
  const status = await query({ type: 'rateLimitStatus' });
  log('rate_limit_status', { status: status.status, data: status.json?.data });
}

async function errors() {
  for (const path of ['/v1/public/futures/PERP_NOPE_USDC', '/v1/public/funding_rate_history?symbol=PERP_NOPE_USDC', '/v1/public/nope', '/v1/orderbook/PERP_BTC_USDC']) {
    const r = await get(path);
    log('error', { path, status: r.status, body: r.text.slice(0, 200), retryAfter: r.headers.get('retry-after') });
    await sleep(200);
  }
  const q = await query({ type: 'orderbook', symbol: 'PERP_NOPE_USDC' });
  log('error', { path: 'query orderbook PERP_NOPE_USDC', status: q.status, body: q.text.slice(0, 200) });
  const h = await get('/v1/public/futures');
  const rl = {};
  for (const [k, v] of h.headers) if (/rate|retry|limit|cache|age|cf-|server/i.test(k)) rl[k] = v;
  log('headers', { path: '/v1/public/futures', headers: rl });
}

const mode = process.argv[2] ?? 'catalog';
const run = { catalog, anchor, book, errors }[mode];
if (!run) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await run();
