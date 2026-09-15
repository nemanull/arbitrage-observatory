// MEXC futures REST: host and latency, the CCXT catalog, the bulk anchor calls polled at one hertz, the REST book, errors and the server clock.
// Public, unauthenticated and read-only. Every loop stays at or under one request per second per endpoint, far inside the published 10 or 20 per 2 seconds.
// Run from server/: node ../scripts/probes/mexc-rest-probe.mjs [host] [catalog] [anchor] [book] [errors] [settle]
// With no section named, every section except settle runs, in about four minutes.
// settle waits for the next whole hour and polls the bulk funding call every two seconds from four minutes before to four minutes after it.
// Raw replies go to $MEXC_PROBE_OUT, default <tmpdir>/mexc-probe. Recorded in docs/profiles/mexc/rest.md.
import { createRequire } from 'node:module';
import dns from 'node:dns/promises';
import https from 'node:https';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const OUT = process.env.MEXC_PROBE_OUT ?? path.join(os.tmpdir(), 'mexc-probe');
fs.mkdirSync(OUT, { recursive: true });

const HOST = 'https://api.mexc.com'; // the documented futures host since 2026-01-19
const LEGACY = 'https://contract.mexc.com'; // the host the older docs and the WebSocket still name
const TRACK = ['BTC_USDT', 'ETH_USDT', 'RIF_USDT', 'CSPR_USDT', 'BTC_USD'];
const TIMEOUT_MS = 10_000;

const sections = new Set(process.argv.slice(2));
const want = (s) => (sections.size === 0 ? s !== 'settle' : sections.has(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const print = (label, o) => console.log(JSON.stringify({ section: label, ...o }));
const save = (name, text) => fs.writeFileSync(path.join(OUT, name), text);
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : { n: s.length, min: +s[0].toFixed(0), med: +s[Math.floor(s.length / 2)].toFixed(0), max: +s[s.length - 1].toFixed(0) };
};

// Timed with the global fetch, which is what AnchorPoller.getJson uses.
async function timed(url) {
  const t0 = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  const tHeaders = performance.now() - t0;
  const text = await res.text();
  return { ms: performance.now() - t0, headersMs: tHeaders, status: res.status, text, headers: Object.fromEntries(res.headers) };
}

// Wire bytes, which fetch hides once it decodes, read with a plain https request that advertises the same encodings.
function wireBytes(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'accept-encoding': 'br, gzip, deflate', accept: 'application/json' }, timeout: TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        let decoded = raw;
        try {
          if (enc === 'br') decoded = zlib.brotliDecompressSync(raw);
          else if (enc === 'gzip') decoded = zlib.gunzipSync(raw);
          else if (enc === 'deflate') decoded = zlib.inflateSync(raw);
        } catch {}
        resolve({ status: res.statusCode, encoding: enc ?? 'identity', wire: raw.length, decoded: decoded.length });
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function hostSection() {
  const lookups = {};
  for (const h of ['api.mexc.com', 'contract.mexc.com', 'www.mexc.com']) {
    try {
      lookups[h] = (await dns.lookup(h, { all: true })).map((a) => a.address);
    } catch (e) {
      lookups[h] = String(e.message);
    }
  }
  let reverse = {};
  for (const [h, addrs] of Object.entries(lookups)) {
    if (!Array.isArray(addrs)) continue;
    try {
      reverse[h] = await dns.reverse(addrs[0]);
    } catch (e) {
      reverse[h] = String(e.code ?? e.message);
    }
  }
  print('host.dns', { lookups, reverse });

  // Calls in the order a cold process would make them, then warm repeats one second apart.
  // The catalog call is spaced six seconds apart because the older docs cap it at one call per five seconds.
  const calls = [
    { name: 'ping', path: '/api/v1/contract/ping', warm: 5, gapMs: 1000 },
    { name: 'funding_rate bulk', path: '/api/v1/contract/funding_rate', warm: 5, gapMs: 1000 },
    { name: 'ticker bulk', path: '/api/v1/contract/ticker', warm: 5, gapMs: 1000 },
    { name: 'depth BTC_USDT limit 20', path: '/api/v1/contract/depth/BTC_USDT?limit=20', warm: 5, gapMs: 1000 },
    { name: 'detail (catalog)', path: '/api/v1/contract/detail', warm: 2, gapMs: 6000 },
  ];
  for (const base of [HOST, LEGACY]) {
    for (const c of calls) {
      const url = base + c.path;
      const cold = await timed(url);
      const warm = [];
      const warmHeaders = [];
      for (let i = 0; i < c.warm; i++) {
        await sleep(c.gapMs);
        const w = await timed(url);
        warm.push(w.ms);
        warmHeaders.push(w.headersMs);
      }
      await sleep(c.gapMs);
      const bytes = await wireBytes(url);
      const h = cold.headers;
      print('host.latency', {
        base,
        call: c.name,
        status: cold.status,
        coldMs: +cold.ms.toFixed(0),
        coldHeadersMs: +cold.headersMs.toFixed(0),
        warmMs: stats(warm),
        warmHeadersMs: stats(warmHeaders),
        decodedBytes: cold.text.length,
        wire: bytes,
        headers: pick(h, ['content-encoding', 'cache-control', 'x-cache', 'server-timing', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'ratelimit-limit', 'ratelimit-remaining']),
        rateHeaderNames: Object.keys(h).filter((k) => /limit|rate|retry|weight/i.test(k)),
      });
      await sleep(1000);
    }
  }

  // Clock offset against the server time, from ten pings one second apart, taking the sample with the shortest round trip.
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await timed(HOST + '/api/v1/contract/ping');
    const t1 = Date.now();
    const server = JSON.parse(r.text).data;
    samples.push({ rtt: t1 - t0, offsetMs: server - (t0 + t1) / 2 });
    await sleep(1000);
  }
  samples.sort((a, b) => a.rtt - b.rtt);
  print('host.clock', { best: samples[0], offsets: samples.map((s) => Math.round(s.offsetMs)), note: 'offset = server ms minus local midpoint, positive means the server is ahead' });
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

async function catalogSection() {
  const ccxt = requireServer('ccxt');
  const ex = new ccxt.mexc({ timeout: 30_000 });
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const loadMs = Date.now() - t0;
  const all = Object.values(markets);
  // Exactly the filter of server/src/ccxt/connector.ts isActiveSwapMarket.
  const swaps = all.filter((m) => m !== undefined && m.type === 'swap' && m.swap === true && m.active !== false);
  const bySettle = {};
  const takerPpm = {};
  const contractSizes = {};
  for (const m of swaps) {
    const k = `${m.settle} ${m.linear ? 'linear' : 'inverse'}`;
    bySettle[k] = (bySettle[k] ?? 0) + 1;
    const ppm = Math.round(m.taker * 1e6);
    takerPpm[ppm] = (takerPpm[ppm] ?? 0) + 1;
    contractSizes[m.contractSize] = (contractSizes[m.contractSize] ?? 0) + 1;
  }
  const inactiveSwaps = all.filter((m) => m.type === 'swap' && m.active === false).length;
  const show = (sym) => {
    const m = markets[sym];
    if (!m) return { sym, missing: true };
    return { sym, id: m.id, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, precision: m.precision, active: m.active, apiAllowed: m.info?.apiAllowed, indexOrigin: m.info?.indexOrigin };
  };

  // One market per pair per venue: USDT, USDC and USD sit in one family, and USD1 is not in that family.
  const family = (q) => (q === 'USDT' || q === 'USDC' || q === 'USD' ? 'USDT' : q);
  const pairs = {};
  for (const m of swaps) {
    const key = `${m.base}|${family(m.quote)}`;
    (pairs[key] ??= []).push(m.id);
  }
  const twice = Object.entries(pairs).filter(([, ids]) => ids.length > 1);

  const fr = JSON.parse((await timed(HOST + '/api/v1/contract/funding_rate')).text).data;
  const frIds = new Set(fr.map((r) => r.symbol));
  const idsMissingFromAnchor = swaps.filter((m) => !frIds.has(m.id)).map((m) => m.id);
  const idShape = swaps.filter((m) => !/^[A-Z0-9]+_[A-Z0-9]+$/.test(m.id)).map((m) => m.id);

  print('catalog.ccxt', {
    ccxtVersion: ccxt.version,
    loadMs,
    allMarkets: all.length,
    activeSwaps: swaps.length,
    inactiveSwaps,
    bySettle,
    takerPpm,
    contractSizes,
    pairsListedTwice: twice.length,
    pairsListedTwiceSample: twice.slice(0, 12),
    idsMissingFromAnchor,
    idsNotBaseUnderscoreQuote: idShape,
    btc: show('BTC/USDT:USDT'),
    btcInverse: show('BTC/USD:BTC'),
    btcUsdc: show('BTC/USDC:USDC'),
    thin: show('RIF/USDT:USDT'),
    thin2: show('CSPR/USDT:USDT'),
    apiNotAllowed: swaps.filter((m) => m.info?.apiAllowed === false).length,
  });
}

async function anchorSection() {
  const ROUNDS = 60;
  const urls = { funding: HOST + '/api/v1/contract/funding_rate', ticker: HOST + '/api/v1/contract/ticker' };
  const prev = {};
  const changes = {};
  const rtt = { funding: [], ticker: [] };
  const bytes = { funding: [], ticker: [] };
  const rows = { funding: [], ticker: [] };
  const tsLagMs = { funding: [], ticker: [] };
  const firstSeen = {};
  for (let i = 0; i < ROUNDS; i++) {
    const tick = Date.now();
    const [f, t] = await Promise.all([timed(urls.funding), timed(urls.ticker)]);
    const arrived = Date.now();
    for (const [name, r] of [['funding', f], ['ticker', t]]) {
      rtt[name].push(r.ms);
      bytes[name].push(r.text.length);
      if (r.status !== 200) {
        print('anchor.error', { name, status: r.status, body: r.text.slice(0, 300) });
        continue;
      }
      const j = JSON.parse(r.text);
      rows[name].push(j.data.length);
      if (i === 0) save(`anchor-${name}-first.json`, r.text);
      for (const row of j.data) {
        if (!TRACK.includes(row.symbol)) continue;
        const key = `${name}:${row.symbol}`;
        const fields = name === 'funding'
          ? { index: row.idxPrice, mark: row.fairPrice, rate: row.fundingRate, next: row.nextSettleTime, cycle: row.collectCycle, cap: row.maxFundingRate, floor: row.minFundingRate }
          : { index: row.indexPrice, mark: row.fairPrice, rate: row.fundingRate, bid: row.bid1, ask: row.ask1 };
        tsLagMs[name].push(arrived - row.timestamp);
        if (prev[key]) {
          for (const [fname, v] of Object.entries(fields)) {
            if (prev[key][fname] !== v) changes[key][fname] = (changes[key][fname] ?? 0) + 1;
          }
        } else {
          changes[key] = {};
          firstSeen[key] = fields;
        }
        prev[key] = fields;
      }
    }
    const wait = 1000 - (Date.now() - tick);
    if (wait > 0) await sleep(wait);
  }
  print('anchor.poll', {
    rounds: ROUNDS,
    rttMs: { funding: stats(rtt.funding), ticker: stats(rtt.ticker) },
    decodedBytes: { funding: stats(bytes.funding), ticker: stats(bytes.ticker) },
    rowsPerReply: { funding: stats(rows.funding), ticker: stats(rows.ticker) },
    arrivalMinusRowTimestampMs: { funding: stats(tsLagMs.funding), ticker: stats(tsLagMs.ticker) },
    changesOver59Transitions: changes,
    first: firstSeen,
    last: prev,
  });

  // The last settled rates, to tell whether the bulk rate is the upcoming one or the one already charged.
  for (const sym of ['BTC_USDT', 'RIF_USDT', 'BTC_USD']) {
    const h = await timed(`${HOST}/api/v1/contract/funding_rate/history?symbol=${sym}&page_num=1&page_size=3`);
    const single = await timed(`${HOST}/api/v1/contract/funding_rate/${sym}`);
    print('anchor.history', { sym, history: JSON.parse(h.text).data?.resultList, current: JSON.parse(single.text).data });
    await sleep(1000);
  }
  for (const p of ['index_price/BTC_USDT', 'fair_price/BTC_USDT', 'index_price/BTC_USD', 'fair_price/BTC_USD']) {
    const r = await timed(`${HOST}/api/v1/contract/${p}`);
    print('anchor.single', { path: p, status: r.status, body: r.text });
    await sleep(1000);
  }
}

async function bookSection() {
  for (const q of ['', '?limit=5', '?limit=20', '?limit=100', '?limit=1000']) {
    const r = await timed(`${HOST}/api/v1/contract/depth/BTC_USDT${q}`);
    const d = JSON.parse(r.text).data;
    const bidsDesc = d.bids.every((l, i) => i === 0 || d.bids[i - 1][0] > l[0]);
    const asksAsc = d.asks.every((l, i) => i === 0 || d.asks[i - 1][0] < l[0]);
    print('book.depth', { query: q || '(none)', status: r.status, ms: +r.ms.toFixed(0), bytes: r.text.length, bids: d.bids.length, asks: d.asks.length, bidsDescending: bidsDesc, asksAscending: asksAsc, bid0: d.bids[0], ask0: d.asks[0], version: d.version, timestamp: d.timestamp, cts: d.cts, cacheControl: r.headers['cache-control'], xCache: r.headers['x-cache'] });
    if (q === '?limit=20') save('book-btc-20.json', r.text);
    await sleep(1000);
  }
  // Consecutive reads one second apart, to see whether an edge cache repeats a version.
  const versions = [];
  for (let i = 0; i < 5; i++) {
    const r = await timed(`${HOST}/api/v1/contract/depth/RIF_USDT?limit=20`);
    const d = JSON.parse(r.text).data;
    versions.push({ version: d.version, timestamp: d.timestamp, bids: d.bids.length, asks: d.asks.length, bid0: d.bids[0], ask0: d.asks[0], xCache: r.headers['x-cache'] });
    await sleep(1000);
  }
  print('book.thinRepeat', { sym: 'RIF_USDT', versions });
  const commits = await timed(`${HOST}/api/v1/contract/depth_commits/BTC_USDT/20`);
  const c = JSON.parse(commits.text);
  print('book.depthCommits', { status: commits.status, success: c.success, code: c.code, count: c.data?.length, first: c.data?.[0], last: c.data?.[c.data.length - 1], bytes: commits.text.length });
}

async function errorsSection() {
  const paths = [
    '/api/v1/contract/depth/NOPE_USDT?limit=20',
    '/api/v1/contract/funding_rate/NOPE_USDT',
    '/api/v1/contract/index_price/NOPE_USDT',
    '/api/v1/contract/ticker?symbol=NOPE_USDT',
    '/api/v1/contract/detail?symbol=NOPE_USDT',
    '/api/v1/contract/depth/btc_usdt?limit=5',
    '/api/v1/contract/depth/BTCUSDT?limit=5',
  ];
  for (const p of paths) {
    const r = await timed(HOST + p);
    print('errors', { path: p, status: r.status, body: r.text.slice(0, 300), rateHeaderNames: Object.keys(r.headers).filter((k) => /limit|rate|retry/i.test(k)) });
    await sleep(1000);
  }
}

async function settleSection() {
  const HOUR = 3_600_000;
  const target = Math.ceil(Date.now() / HOUR) * HOUR;
  const from = target - 4 * 60_000;
  const until = target + 4 * 60_000;
  console.log(`settle target ${new Date(target).toISOString()}`);
  if (Date.now() < from) await sleep(from - Date.now());
  const first = JSON.parse((await timed(HOST + '/api/v1/contract/funding_rate')).text).data;
  const due = first.filter((r) => r.nextSettleTime === target);
  const pickSyms = [
    ...due.filter((r) => r.collectCycle === 1).sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate)).slice(0, 3),
    ...due.filter((r) => r.collectCycle === 4).sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate)).slice(0, 3),
    ...due.filter((r) => r.collectCycle === 8).sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate)).slice(0, 3),
  ].map((r) => r.symbol);
  const syms = [...new Set([...pickSyms, 'BTC_USDT', 'RIF_USDT'])];
  print('settle.symbols', { target, dueCount: due.length, syms });
  const series = Object.fromEntries(syms.map((s) => [s, []]));
  while (Date.now() < until) {
    const t0 = Date.now();
    const r = await timed(HOST + '/api/v1/contract/funding_rate');
    if (r.status === 200) {
      for (const row of JSON.parse(r.text).data) {
        if (!series[row.symbol]) continue;
        const s = series[row.symbol];
        const last = s[s.length - 1];
        if (!last || last.rate !== row.fundingRate || last.next !== row.nextSettleTime || last.cycle !== row.collectCycle) {
          s.push({ at: t0, rate: row.fundingRate, next: row.nextSettleTime, cycle: row.collectCycle });
        }
      }
    }
    const wait = 2000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  for (const s of syms) {
    await sleep(1000);
    const h = JSON.parse((await timed(`${HOST}/api/v1/contract/funding_rate/history?symbol=${s}&page_num=1&page_size=2`)).text).data?.resultList;
    print('settle.series', { sym: s, changes: series[s].map((c) => ({ ...c, at: new Date(c.at).toISOString() })), history: h });
  }
}

if (want('host')) await hostSection();
if (want('catalog')) await catalogSection();
if (want('anchor')) await anchorSection();
if (want('book')) await bookSection();
if (want('errors')) await errorsSection();
if (want('settle')) await settleSection();
process.exit(0);
