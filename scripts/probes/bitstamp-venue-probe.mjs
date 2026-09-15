// Read-only REST probe of Bitstamp's perpetuals: host and latency, the CCXT catalog, the anchor calls polled at one hertz, the REST book, and error replies.
// Run from server/ on Node 24: node ../scripts/probes/bitstamp-venue-probe.mjs [outDir] [--collisions]
// --collisions also loads the CCXT catalogs of the five running venues once, to list which of them share a Bitstamp base.
// Recorded in docs/profiles/bitstamp/rest.md and docs/profiles/bitstamp/fees.md. The socket half is bitstamp-ws-probe.mjs.
// Public limit is 400 requests per second and 10,000 per 10 minutes, and this run peaks near 5 per second for one minute and takes about three minutes.
import { createRequire } from 'node:module';
import dns from 'node:dns/promises';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'bitstamp-probe'); // raw captures stay out of the repository
fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://www.bitstamp.net';
const POLLS = 60;
const FOCUS = ['btcusd-perp', 'ethusd-perp', 'asterusd-perp', 'ewyusd-perp']; // two liquid, two thin
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};
const save = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 1));

// node:https rather than fetch, so DNS, connect, TLS and first byte are separable, and cold means a fresh socket.
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });
function get(url, { cold = false } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const marks = {};
    const req = https.get(url, { agent: cold ? new https.Agent({ keepAlive: false }) : warmAgent, headers: { accept: 'application/json' } }, (res) => {
      marks.ttfb = performance.now() - t0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          bytes: body.length,
          text: body.toString('utf8'),
          ms: +(performance.now() - t0).toFixed(1),
          ttfbMs: +marks.ttfb.toFixed(1),
          connectMs: marks.connect === undefined ? null : +marks.connect.toFixed(1),
          tlsMs: marks.tls === undefined ? null : +marks.tls.toFixed(1),
          recvAt: Date.now(),
        });
      });
    });
    req.on('socket', (s) => {
      s.once('connect', () => (marks.connect = performance.now() - t0));
      s.once('secureConnect', () => (marks.tls = performance.now() - t0));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: +(performance.now() - t0).toFixed(1) }));
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
  });
}
const json = (r) => {
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
};
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
};

// 1. Host and latency.
async function host() {
  const www = await dns.lookup('www.bitstamp.net', { all: true });
  const ws = await dns.lookup('ws.bitstamp.net', { all: true });
  const cname = await dns.resolveCname('www.bitstamp.net').catch((e) => e.code);
  const wsCname = await dns.resolveCname('ws.bitstamp.net').catch((e) => e.code);
  const calls = {
    markets: '/api/v2/markets/',
    tickerAll: '/api/v2/ticker/',
    fundingBtc: '/api/v2/funding_rate/btcusd-perp/',
    bookBtc: '/api/v2/order_book/btcusd-perp/',
  };
  const out = { dns: { www, wwwCname: cname, ws, wsCname }, calls: {} };
  for (const [name, p] of Object.entries(calls)) {
    const cold = await get(HOST + p, { cold: true });
    await sleep(1100);
    const warm = [];
    for (let i = 0; i < 5; i++) {
      warm.push(await get(HOST + p));
      await sleep(1100);
    }
    const pick = (h) => Object.fromEntries(Object.entries(h ?? {}).filter(([k]) => /cache|age|etag|last-modified|x-cdn|server|ratelimit|retry|x-iinfo|content-encoding|date/i.test(k)));
    out.calls[name] = {
      path: p,
      cold: { status: cold.status, ms: cold.ms, connectMs: cold.connectMs, tlsMs: cold.tlsMs, ttfbMs: cold.ttfbMs, bytes: cold.bytes },
      warmMs: stats(warm.map((w) => w.ms)),
      warmTtfbMs: stats(warm.map((w) => w.ttfbMs)),
      bytes: warm[warm.length - 1].bytes,
      headers: pick(warm[warm.length - 1].headers),
    };
  }
  return out;
}

// 2. Catalog, filtered exactly like server/src/ccxt/connector.ts lines 188 to 194.
async function catalog() {
  const ex = new ccxt.bitstamp();
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const loadMs = Date.now() - t0;
  const all = Object.values(markets);
  const swaps = all.filter((m) => m !== undefined && m.type === 'swap' && m.swap === true && m.active !== false);
  const bySettle = {};
  for (const m of swaps) bySettle[`${m.settle}|linear=${m.linear}`] = (bySettle[`${m.settle}|linear=${m.linear}`] ?? 0) + 1;
  const pairs = {};
  for (const m of swaps) pairs[`${m.base}|${m.quote}`] = (pairs[`${m.base}|${m.quote}`] ?? 0) + 1;
  const pick = (m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize ?? 'undefined', taker: m.taker, maker: m.maker, precision: m.precision, active: m.active, rawName: m.info.name, rawContractSize: m.info.contract_size, rawAssetClass: m.info.asset_class, rawHasMarketHours: m.info.has_market_hours, rawUnderlying: m.info.underlying_asset });
  const entities = {};
  for (const e of ['UK_LTD', 'EUROPE_SA', 'US_INC', 'BVI_LTD', 'EUROPE_BEL', 'UK', 'SI_BROKER', 'SI_MTF', 'ASIA_SG']) {
    await sleep(1100);
    const list = json(await get(`${HOST}/api/v2/markets/?entity=${e}`));
    entities[e] = Array.isArray(list) ? { markets: list.length, perps: list.filter((m) => m.market_type === 'PERPETUAL').length } : { notArray: true };
  }
  await sleep(1100);
  const raw = await get(HOST + '/api/v2/markets/');
  const rawList = json(raw) ?? [];
  const perps = rawList.filter((m) => m.market_type === 'PERPETUAL');
  return {
    ccxtVersion: ccxt.version,
    hasSwap: ex.has.swap,
    loadMs,
    markets: all.length,
    activeSwaps: swaps.length,
    inactiveSwaps: all.filter((m) => m.swap && m.active === false).map((m) => m.id),
    bySettle,
    pairsListedTwice: Object.entries(pairs).filter(([, n]) => n > 1),
    takers: [...new Set(swaps.map((m) => m.taker))],
    btc: pick(markets['BTC/USD:USD']),
    thin: pick(markets['ASTER/USD:USD']),
    allIds: swaps.map((m) => `${m.id} ${m.info.name} ${m.info.asset_class} hours=${m.info.has_market_hours}`),
    entityFilter: entities,
    raw: {
      rows: rawList.length,
      marketTypes: rawList.reduce((a, m) => ((a[m.market_type] = (a[m.market_type] ?? 0) + 1), a), {}),
      perpKeys: [...new Set(perps.flatMap((m) => Object.keys(m)))],
      perpContractSizes: [...new Set(perps.map((m) => m.contract_size))],
      perpPayoff: [...new Set(perps.map((m) => m.payoff_type))],
      perpTrading: [...new Set(perps.map((m) => m.trading))],
      hasExchangeField: perps.some((m) => 'exchange' in m),
      hasTickSizeField: perps.some((m) => 'tick_size' in m),
    },
  };
}

// 3. Anchor: the all-markets ticker at 1 Hz, and the per-market funding call for four symbols at 1 Hz.
async function anchor() {
  const tickerRounds = [];
  const fundingRounds = Object.fromEntries(FOCUS.map((s) => [s, []]));
  const start = Date.now();
  const tickerLoop = (async () => {
    for (let i = 0; i < POLLS; i++) {
      const due = start + i * 1000;
      if (Date.now() < due) await sleep(due - Date.now());
      const r = await get(HOST + '/api/v2/ticker/');
      const list = json(r) ?? [];
      const perps = list.filter((t) => t.market_type === 'PERPETUAL');
      if (i === 0) report.rawSamples = { ...report.rawSamples, tickerBtcRow: perps.find((t) => t.market === 'BTC/USD-PERP') };
      tickerRounds.push({
        i,
        status: r.status,
        ms: r.ms,
        ttfbMs: r.ttfbMs,
        bytes: r.bytes,
        lastModified: r.headers?.['last-modified'],
        etag: r.headers?.etag,
        recvAt: r.recvAt,
        perps: Object.fromEntries(perps.map((t) => [t.market, { ts: t.timestamp, index: t.index_price, mark: t.mark_price, bid: t.bid, ask: t.ask, last: t.last }])),
      });
    }
  })();
  const fundingLoops = FOCUS.map(async (sym, k) => {
    for (let i = 0; i < POLLS; i++) {
      const due = start + 250 * (k + 1) + i * 1000;
      if (Date.now() < due) await sleep(due - Date.now());
      const r = await get(`${HOST}/api/v2/funding_rate/${sym}/`);
      const j = json(r) ?? {};
      if (i === 0 && sym === 'btcusd-perp') report.rawSamples = { ...report.rawSamples, fundingBtcBody: r.text };
      fundingRounds[sym].push({ i, status: r.status, ms: r.ms, bytes: r.bytes, recvAt: r.recvAt, rate: j.funding_rate, ts: j.timestamp, next: j.next_funding_time, market: j.market });
    }
  });
  await Promise.all([tickerLoop, ...fundingLoops]);
  save('anchor-ticker-rounds.json', tickerRounds);
  save('anchor-funding-rounds.json', fundingRounds);

  const changes = (rows, key) => {
    let n = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i][key] !== undefined && rows[i][key] !== rows[i - 1][key]) n++;
    return n;
  };
  const names = { 'btcusd-perp': 'BTC/USD-PERP', 'ethusd-perp': 'ETH/USD-PERP', 'asterusd-perp': 'ASTER/USD-PERP', 'ewyusd-perp': 'EWY/USD-PERP' };
  const perSymbol = {};
  for (const sym of FOCUS) {
    const rows = tickerRounds.map((r) => r.perps[names[sym]] ?? {});
    perSymbol[sym] = {
      tickerPolls: rows.length,
      indexChanged: changes(rows, 'index'),
      markChanged: changes(rows, 'mark'),
      tickerTsChanged: changes(rows, 'ts'),
      bidAskChanged: changes(rows.map((x) => ({ q: `${x.bid}/${x.ask}` })), 'q'),
      fundingPolls: fundingRounds[sym].length,
      fundingRateChanged: changes(fundingRounds[sym], 'rate'),
      fundingTsChanged: changes(fundingRounds[sym], 'ts'),
      nextFundingValues: [...new Set(fundingRounds[sym].map((x) => x.next))],
      fundingMs: stats(fundingRounds[sym].map((x) => x.ms)),
      first: { ticker: rows[0], funding: fundingRounds[sym][0] },
      last: { ticker: rows[rows.length - 1], funding: fundingRounds[sym][fundingRounds[sym].length - 1] },
    };
  }
  const all20 = Object.keys(tickerRounds[0]?.perps ?? {});
  const allIndexChanged = all20.map((m) => [m, changes(tickerRounds.map((r) => r.perps[m] ?? {}), 'index'), changes(tickerRounds.map((r) => r.perps[m] ?? {}), 'mark')]);
  const lagSec = tickerRounds.map((r) => Math.round(r.recvAt / 1000) - Number(r.perps['BTC/USD-PERP']?.ts));
  return {
    tickerMs: stats(tickerRounds.map((r) => r.ms)),
    tickerTtfbMs: stats(tickerRounds.map((r) => r.ttfbMs)),
    tickerBytes: stats(tickerRounds.map((r) => r.bytes)),
    tickerStatuses: [...new Set(tickerRounds.map((r) => r.status))],
    lastModifiedChanged: changes(tickerRounds, 'lastModified'),
    tickerAgeSecondsAtReceipt: stats(lagSec),
    perSymbol,
    allPerpsIndexAndMarkChanges: allIndexChanged,
  };
}

// 4. One pass over all 20 perps: funding, the gap between two settled rates, and the mark premium read from the ticker.
async function fundingTable() {
  const ticker = json(await get(HOST + '/api/v2/ticker/')) ?? [];
  const perps = ticker.filter((t) => t.market_type === 'PERPETUAL');
  const rows = [];
  for (const t of perps) {
    const sym = t.market.replace('/', '').replace('-PERP', '-perp').toLowerCase();
    await sleep(300);
    const f = json(await get(`${HOST}/api/v2/funding_rate/${sym}/`)) ?? {};
    await sleep(300);
    const h = json(await get(`${HOST}/api/v2/funding_rate_history/${sym}/?limit=4`)) ?? {};
    const hist = h.funding_rate_history ?? [];
    const gaps = hist.slice(1).map((x, i) => (Number(x.timestamp) - Number(hist[i].timestamp)) / 3600);
    rows.push({
      market: t.market,
      symbolUsed: sym,
      index: t.index_price,
      mark: t.mark_price,
      markPremiumPpm: Math.round((Number(t.mark_price) / Number(t.index_price) - 1) * 1e6),
      fundingRate: f.funding_rate,
      fundingPpm: f.funding_rate === undefined ? null : Math.round(Number(f.funding_rate) * 1e6),
      nextFundingTime: f.next_funding_time,
      nextFundingIso: f.next_funding_time ? new Date(Number(f.next_funding_time) * 1000).toISOString() : null,
      historyTimestampsIso: hist.map((x) => new Date(Number(x.timestamp) * 1000).toISOString()),
      historyRates: hist.map((x) => x.funding_rate),
      historyGapsHours: gaps,
    });
  }
  const hours = json(await get(HOST + '/api/v2/derivatives/market_hours/')) ?? [];
  return {
    rows,
    marketHours: hours.map((m) => ({ market: m.market, trading: m.trading_hours, publishing: m.reference_index_publishing_hours?.is_reference_index_publishing, currentClose: m.reference_index_publishing_hours?.current_close, nextOpen: m.reference_index_publishing_hours?.next_open, blocks: m.reference_index_publishing_hours?.schedule?.length })),
  };
}

// 5. REST book, caching, clock, and error replies.
async function bookAndErrors() {
  const out = {};
  for (const sym of ['btcusd-perp', 'asterusd-perp']) {
    const r = await get(`${HOST}/api/v2/order_book/${sym}/`);
    const j = json(r);
    const desc = (xs) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) > Number(x[0]));
    const asc = (xs) => xs.every((x, i) => i === 0 || Number(xs[i - 1][0]) < Number(x[0]));
    out[sym] = { status: r.status, ms: r.ms, bytes: r.bytes, bids: j.bids.length, asks: j.asks.length, bidsDescending: desc(j.bids), asksAscending: asc(j.asks), bestBid: j.bids[0], bestAsk: j.asks[0], worstBid: j.bids.at(-1), worstAsk: j.asks.at(-1), timestamp: j.timestamp, microtimestamp: j.microtimestamp, clockOffsetMs: Math.round(r.recvAt - Number(j.microtimestamp) / 1000), headers: { etag: r.headers.etag, lastModified: r.headers['last-modified'], cacheControl: r.headers['cache-control'] ?? null } };
    await sleep(1100);
  }
  // Two reads 300 ms apart, to see whether the edge hands back the same book.
  const a = await get(`${HOST}/api/v2/order_book/btcusd-perp/`);
  await sleep(300);
  const b = await get(`${HOST}/api/v2/order_book/btcusd-perp/`);
  await sleep(300);
  const c = await get(`${HOST}/api/v2/order_book/btcusd-perp/?_=${Date.now()}`);
  out.caching = [a, b, c].map((r) => ({ ms: r.ms, micro: json(r)?.microtimestamp, etag: r.headers.etag, lastModified: r.headers['last-modified'], dateHeader: r.headers.date, iinfo: r.headers['x-iinfo'] }));
  out.groups = {};
  for (const g of [0, 1, 2, 3]) {
    await sleep(1100);
    const r = await get(`${HOST}/api/v2/order_book/btcusd-perp/?group=${g}`);
    const j = json(r);
    out.groups[g] = { status: r.status, bytes: r.bytes, bids: j?.bids?.length, firstBid: j?.bids?.[0], duplicatePricesOnBids: j ? j.bids.length - new Set(j.bids.map((x) => x[0])).size : null };
  }
  const errs = {
    bookUnknown: '/api/v2/order_book/fooxyz-perp/',
    tickerUnknown: '/api/v2/ticker/fooxyz-perp/',
    fundingUnknown: '/api/v2/funding_rate/fooxyz-perp/',
    fundingSpot: '/api/v2/funding_rate/btcusd/',
    fundingNoSymbol: '/api/v2/funding_rate/',
    marketHoursNoSchedule: '/api/v2/derivatives/market_hours/btcusd-perp/',
    tickerWithQuery: '/api/v2/ticker/btcusd-perp/?x=1',
    tickerUppercase: '/api/v2/ticker/BTCUSD-PERP/',
  };
  out.errors = {};
  for (const [name, p] of Object.entries(errs)) {
    await sleep(1100);
    const r = await get(HOST + p);
    out.errors[name] = { path: p, status: r.status, contentType: r.headers?.['content-type'], bytes: r.bytes, body: r.text?.slice(0, 160) };
  }
  const dateHeader = a.headers.date;
  out.clock = { dateHeader, localAtReceipt: new Date(a.recvAt).toUTCString(), bookMicroOffsetMs: Math.round(a.recvAt - Number(json(a)?.microtimestamp) / 1000) };
  return out;
}

// 6. Extras: the gzip size the poller would download, the full funding history of three markets, and which running venues list Bitstamp's bases.
async function extras() {
  const gz = await new Promise((resolve) => {
    https.get(HOST + '/api/v2/ticker/', { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      let n = 0;
      res.on('data', (c) => (n += c.length));
      res.on('end', () => resolve({ status: res.statusCode, contentEncoding: res.headers['content-encoding'], compressedBytes: n }));
    });
  });
  const histories = {};
  for (const sym of ['wtiusd-perp', 'brentusd-perp', 'btcusd-perp']) {
    await sleep(1100);
    const h = (json(await get(`${HOST}/api/v2/funding_rate_history/${sym}/?limit=100`)) ?? {}).funding_rate_history ?? [];
    histories[sym] = {
      entries: h.length,
      firstIso: h[0] ? new Date(Number(h[0].timestamp) * 1000).toISOString() : null,
      lastIso: h.length ? new Date(Number(h.at(-1).timestamp) * 1000).toISOString() : null,
      nonZero: h.filter((x) => Number(x.funding_rate) !== 0).length,
      maxAbs: Math.max(0, ...h.map((x) => Math.abs(Number(x.funding_rate)))),
      clockTimes: [...new Set(h.map((x) => new Date(Number(x.timestamp) * 1000).toISOString().slice(11, 19)))],
    };
  }
  const bases = ['GOLD', 'SILVER', 'QQQ', 'EWY', 'EUR', 'WTI', 'BRENT', 'PAXG', 'ASTER', 'TAO', 'HYPE', 'XAU', 'XAG', 'CL', 'BZ', 'EURUSD'];
  const collisions = {};
  if (process.argv.includes('--collisions')) {
    for (const id of ['binance', 'bybit', 'okx', 'krakenfutures', 'coinbase']) {
      try {
        const m = await new ccxt[id]().loadMarkets();
        collisions[id] = Object.values(m)
          .filter((x) => x && x.type === 'swap' && x.swap === true && x.active !== false && bases.includes(x.base))
          .map((x) => `${x.id} ${x.base}|${x.quote}`);
      } catch (e) {
        collisions[id] = `error ${e.message.slice(0, 80)}`;
      }
    }
  }
  return { tickerGzip: gz, histories, collisions };
}

const t0 = Date.now();
console.log('host');
report.host = await host();
console.log('catalog');
report.catalog = await catalog();
console.log('anchor, about 62 s');
report.anchor = await anchor();
console.log('funding table');
report.funding = await fundingTable();
console.log('book and errors');
report.book = await bookAndErrors();
console.log('extras');
report.extras = await extras();
report.wallMs = Date.now() - t0;
report.ranAt = new Date(t0).toISOString();
save('rest-report.json', report);
console.log(JSON.stringify(report, null, 1));
warmAgent.destroy();
