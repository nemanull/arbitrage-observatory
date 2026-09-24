// Tapbit REST probe: whether this host can reach the documented public endpoints of the USDT perpetual, spot and spot v2 APIs, what a refusal looks like, and how long it takes.
// Public, unauthenticated, read-only. One request at a time, at least 400 ms apart, inside the documented 1 to 10 per second per IP.
// Run from server/: node ../scripts/probes/venues/tapbit/rest-probe.mjs [access|latency|ccxt|coingecko|clock|spotv2]
//   access     every documented public path, an unknown path and the bare host, over https and http: status, the CDN headers and the body.
//   latency    DNS, 5 cold and 10 warm requests to the perpetual catalog path, with connect, TLS and first byte times.
//   ccxt       whether CCXT 4.5.68 in server/node_modules has a Tapbit class.
//   coingecko  CoinGecko's public derivatives listing of Tapbit, as listing context: perpetual count, contract names, funding and index fields.
//   clock      the spot v2 time call in ms against the local clock, and the Date header of the refused perpetual time call.
//   spotv2     the spot v2 catalog, ticker list and book once each, the only public calls that answer this host.
// Set PROBE_OUT_DIR to keep the refusal bodies and the CoinGecko reply. Recorded in docs/profiles/tapbit/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'openapi.tapbit.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

// Paths are from https://www.tapbit.com/openapi-docs/, retrieved 2026-09-22.
const PATHS = [
  ['swap catalog', '/swap/api/usdt/instruments/list'],
  ['swap ticker_list', '/swap/api/usdt/instruments/ticker_list'],
  ['swap ticker_one', '/swap/api/usdt/instruments/ticker_one?instrument_id=BTC-SWAP'],
  ['swap funding_rate', '/swap/api/usdt/instruments/funding_rate?instrument_id=BTC-SWAP'],
  ['swap depth', '/swap/api/usdt/instruments/depth?instrument_id=BTC-SWAP&depth=100'],
  ['swap trade_list', '/swap/api/usdt/instruments/trade_list?instrument_id=BTC-SWAP'],
  ['swap time', '/swap/api/v1/usdt/time'],
  ['spot trade_pair_list', '/spot/api/spot/instruments/trade_pair_list'],
  ['spot ticker_list', '/spot/api/spot/instruments/ticker_list'],
  ['spot depth', '/spot/api/spot/instruments/depth?instrument_id=BTC/USDT&depth=10'],
  ['spot time', '/spot/api/spot/instruments/current/timestamp'],
  ['spot-v2 trade_pair_list', '/spot-v2/api/spot/instruments/trade_pair_list'],
  ['spot-v2 time', '/spot-v2/api/spot/instruments/current/timestamp'],
  ['unknown path', '/nope/does-not-exist'],
  ['bare host', '/'],
];

function request(url, { agent, headers = {} } = {}) {
  const lib = url.startsWith('https:') ? https : http;
  return new Promise((resolve) => {
    const t0 = performance.now();
    const marks = {};
    const req = lib.get(url, { agent, headers: { 'user-agent': 'arbitrage-observatory-probe', ...headers }, timeout: 15_000 }, (res) => {
      marks.ttfb = performance.now() - t0;
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), ms: performance.now() - t0, ...marks });
      });
    });
    req.on('socket', (s) => {
      if (!s.connecting) return; // a reused keep-alive socket has no handshake to time
      s.once('lookup', () => (marks.dns = performance.now() - t0));
      s.once('connect', () => (marks.connect = performance.now() - t0));
      s.once('secureConnect', () => (marks.tls = performance.now() - t0));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ error: e.message, ms: performance.now() - t0 }));
  });
}

const r1 = (x) => (x === undefined ? undefined : Math.round(x));

function summarizeBody(body = '') {
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 220);
}

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function access() {
  for (const scheme of ['https', 'http']) {
    for (const [label, path] of PATHS) {
      const res = await request(`${scheme}://${HOST}${path}`);
      const h = res.headers ?? {};
      log('access', {
        scheme,
        label,
        path,
        status: res.status,
        error: res.error,
        ms: r1(res.ms),
        bytes: res.body?.length,
        server: h.server,
        xCache: h['x-cache'],
        pop: h['x-amz-cf-pop'],
        contentType: h['content-type'],
        location: h.location,
        retryAfter: h['retry-after'],
        body: summarizeBody(res.body),
      });
      if (scheme === 'https' && label === 'swap catalog') keep('refusal-swap-catalog.html', res.body ?? '');
      await sleep(400);
    }
  }
  // A browser user-agent and a JSON accept header, to see whether the refusal depends on the request rather than the address.
  const variants = [
    ['browser user-agent', { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' }],
    ['accept json', { accept: 'application/json' }],
  ];
  for (const [label, headers] of variants) {
    const res = await request(`https://${HOST}/swap/api/usdt/instruments/list`, { headers });
    log('variant', { label, status: res.status, xCache: res.headers?.['x-cache'], body: summarizeBody(res.body).slice(0, 80) });
    await sleep(400);
  }
}

async function latency() {
  const t0 = performance.now();
  const addrs = await dns.resolve4(HOST).catch((e) => [e.code]);
  const cname = await dns.resolveCname(HOST).catch(() => []);
  log('dns', { host: HOST, cname, addrs, ms: r1(performance.now() - t0) });
  const url = `https://${HOST}/swap/api/usdt/instruments/list`;
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const res = await request(url, { agent: new https.Agent({ keepAlive: false }) });
    cold.push(res);
    log('cold', { i, status: res.status, dns: r1(res.dns), connect: r1(res.connect), tls: r1(res.tls), ttfb: r1(res.ttfb), ms: r1(res.ms), pop: res.headers?.['x-amz-cf-pop'] });
    await sleep(500);
  }
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  const warm = [];
  for (let i = 0; i < 11; i++) {
    const res = await request(url, { agent });
    if (i > 0) warm.push(res.ms);
    await sleep(500);
  }
  agent.destroy();
  warm.sort((a, b) => a - b);
  log('warm', { n: warm.length, min: r1(warm[0]), median: r1(warm[Math.floor(warm.length / 2)]), max: r1(warm[warm.length - 1]) });
}

function ccxtCheck() {
  const ccxt = require('ccxt');
  const hits = ccxt.exchanges.filter((id) => /tap/i.test(id));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, tapbitLike: hits });
}

async function coingecko() {
  // The id is from https://api.coingecko.com/api/v3/derivatives/exchanges/list, where Tapbit (Futures) is tapbit-futures.
  for (const id of ['tapbit-futures']) {
    const res = await request(`https://api.coingecko.com/api/v3/derivatives/exchanges/${id}?include_tickers=unexpired`);
    log('coingecko', { id, status: res.status, bytes: res.body?.length });
    if (res.status !== 200) {
      await sleep(3000);
      continue;
    }
    keep(`coingecko-${id}.json`, res.body);
    const j = JSON.parse(res.body);
    const tickers = j.tickers ?? [];
    const perps = tickers.filter((t) => t.contract_type === 'perpetual');
    const byTarget = {};
    for (const t of perps) byTarget[t.target] = (byTarget[t.target] ?? 0) + 1;
    log('coingecko_summary', {
      name: j.name,
      country: j.country,
      year: j.year_established,
      url: j.url,
      openInterestBtc: j.open_interest_btc,
      volume24hBtc: j.trade_volume_24h_btc,
      perpetualPairs: j.number_of_perpetual_pairs,
      futuresPairs: j.number_of_futures_pairs,
      tickers: tickers.length,
      perps: perps.length,
      byTarget,
      sample: perps.slice(0, 3).map((t) => ({ symbol: t.symbol, base: t.base, target: t.target, last: t.last, index: t.index, basis: t.basis, funding: t.funding_rate, spread: t.bid_ask_spread, lastTraded: t.last_traded_at, expired: t.expired_at })),
    });
    const stale = perps.filter((t) => Date.now() / 1000 - t.last_traded_at > 3600).length;
    const funding = perps.map((t) => t.funding_rate).filter((x) => typeof x === 'number');
    log('coingecko_fields', {
      symbolsEndWithSwap: perps.filter((t) => /-SWAP$/.test(t.symbol)).length,
      withIndex: perps.filter((t) => t.index > 0).length,
      withFunding: funding.length,
      fundingMin: Math.min(...funding),
      fundingMax: Math.max(...funding),
      lastTradedOverAnHourAgo: stale,
    });
    return;
  }
}

// The perpetual time call is refused, so the clock is read from the spot v2 time call, which answers in ms.
async function clock() {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  const offsets = [];
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const res = await request(`https://${HOST}/spot-v2/api/spot/instruments/current/timestamp`, { agent });
    const t1 = Date.now();
    const server = JSON.parse(res.body).data.timestamp;
    if (i > 0) offsets.push({ offsetMs: server - (t0 + t1) / 2, rttMs: t1 - t0 });
    await sleep(600);
  }
  agent.destroy();
  log('clock', { source: 'spot-v2 current/timestamp', samples: offsets });
  const perp = await request(`https://${HOST}/swap/api/v1/usdt/time`);
  log('clock_perp', { status: perp.status, date: perp.headers?.date });
}

// The spot v2 public calls answer this host, so they are read once for the coverage matrix and the access record.
async function spotv2() {
  const base = `https://${HOST}/spot-v2/api/spot/instruments`;
  const pairs = await request(`${base}/trade_pair_list`);
  const j = JSON.parse(pairs.body);
  const byQuote = {};
  for (const p of j.data) byQuote[p.quote_asset] = (byQuote[p.quote_asset] ?? 0) + 1;
  log('spotv2_pairs', { status: pairs.status, ms: r1(pairs.ms), bytes: pairs.body.length, count: j.data.length, byQuote, fields: Object.keys(j.data[0]), first: j.data[0] });
  keep('spotv2-trade_pair_list.json', pairs.body);
  await sleep(1200);
  const tickers = await request(`${base}/ticker_list`);
  const t = JSON.parse(tickers.body);
  log('spotv2_tickers', { status: tickers.status, ms: r1(tickers.ms), bytes: tickers.body.length, count: t.data?.length, fields: t.data?.[0] && Object.keys(t.data[0]) });
  await sleep(1200);
  const depth = await request(`${base}/depth?instrument_id=BTC/USDT&depth=5`);
  log('spotv2_depth', { status: depth.status, ms: r1(depth.ms), body: depth.body.slice(0, 300) });
}

const mode = process.argv[2] ?? 'access';
const modes = { access, latency, ccxt: ccxtCheck, coingecko, clock, spotv2 };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
