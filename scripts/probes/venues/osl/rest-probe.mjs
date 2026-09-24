// OSL REST probe: hosts and latency, the OSL HK spot catalog (v5 and v4), fee fields, REST books, errors, rate headers and time,
// then the OSL Global spot catalog and its delisted perpetual family.
// Public, unauthenticated, read-only. Requests go out one at a time, or three at once in poll, at most a few per second,
// far inside the published 1,800 weight per minute (v5) and 200 requests per second (v4).
// Run from server/: node ../scripts/probes/venues/osl/rest-probe.mjs [main|poll|global]
//   main    DNS, CCXT check, CoinGecko listing, HK latency, HK v5 and v4 catalogs, fee config, books, errors, time. About 60 s.
//   poll    30 rounds at 1 s of the HK REST books (v5 and v4) and the bulk ticker, for change rate and caching. About 35 s.
//   global  CoinGecko's derivatives venue list, OSL Global spot catalog and tickers, the perpetual catalog, price and depth of every listed perpetual, time. About 45 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/osl/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HK = 'https://trade-hk.osl.com';
const GLB = 'https://api.osl.com';
const OUT = process.env.PROBE_OUT_DIR;
const TRACKED = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BTCHKD', 'SEIUSD', 'POLHKD'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), typeof body === 'string' ? body : JSON.stringify(body, null, 1));
}

async function get(url) {
  const t0 = performance.now();
  const sentAt = Date.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  const h = (k) => res.headers.get(k);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return {
    url: url.replace(HK, 'HK').replace(GLB, 'GLB'),
    status: res.status,
    ms: Math.round(ms),
    ttfbMs: Math.round(ttfb),
    sentAt,
    doneAt: Date.now(),
    bytes: Buffer.byteLength(text),
    type: h('content-type'),
    encoding: h('content-encoding'),
    weight: h('x-sapi-used-ip-weight-1m'),
    respTime: h('x-response-time'),
    upstreamMs: h('x-envoy-upstream-service-time'),
    etag: h('etag'),
    cache: h('cf-cache-status'),
    colo: (h('cf-ray') ?? '').split('-')[1] ?? null,
    retryAfter: h('retry-after'),
    date: h('date'),
    text,
    json,
  };
}

const strip = (r) => { const { text, json, ...rest } = r; return rest; };
const count = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const isDesc = (lv) => lv.every((l, i) => i === 0 || Number(l[0]) < Number(lv[i - 1][0]));
const isAsc = (lv) => lv.every((l, i) => i === 0 || Number(l[0]) > Number(lv[i - 1][0]));
const decimals = (s) => (String(s).split('.')[1] ?? '').length;

async function host() {
  for (const name of ['trade-hk.osl.com', 'stream-hk.osl.com', 'api.osl.com', 'stream-api.osl.com', 'www.osl.com']) {
    const out = { name };
    try { out.cname = await dns.resolveCname(name); } catch (e) { out.cname = e.code; }
    try { out.a = await dns.resolve4(name); } catch (e) { out.a = e.code; }
    log('dns', out);
  }
}

function ccxtCheck() {
  const ids = ccxt.exchanges;
  log('ccxt', { version: ccxt.version, exchanges: ids.length, matchingOsl: ids.filter((x) => /osl/i.test(x)) });
}

// CoinGecko aggregates several OSL regional sites under one listing, so each ticker is matched against the HK and Global catalogs,
// and a pair both sites list is attributed by comparing CoinGecko's USD volume with each site's own 24 h base volume.
async function coingecko(hk, glb) {
  const r = await get('https://api.coingecko.com/api/v3/exchanges/osl-exchange');
  if (r.status !== 200) { log('coingecko', strip(r)); return; }
  const d = r.json;
  const tickers = d.tickers ?? [];
  const site = (t) => {
    const s = `${t.base}${t.target}`;
    const inHk = hk.has(s);
    const inGlb = glb.has(s);
    return inHk && inGlb ? 'both' : inHk ? 'hk' : inGlb ? 'global' : 'neither';
  };
  log('coingecko', {
    name: d.name, country: d.country, trustScore: d.trust_score, trustScoreRank: d.trust_score_rank, pairs: d.pairs, coins: d.coins,
    volume24hBtc: d.trade_volume_24h_btc, tickers: tickers.length,
    byTarget: count(tickers.map((t) => t.target)),
    bySite: count(tickers.map(site)),
    neither: tickers.filter((t) => site(t) === 'neither').map((t) => `${t.base}/${t.target}`),
    top: tickers.slice(0, 12).map((t) => {
      const s = `${t.base}${t.target}`;
      return { pair: `${t.base}/${t.target}`, usd: Math.round(t.converted_volume?.usd ?? 0), cgBaseVolume: Math.round(t.volume * 1000) / 1000, site: site(t), hkBaseVolume: hk.get(s) ?? null, glbBaseVolume: glb.get(s) ?? null };
    }),
  });
}

async function latency() {
  const paths = [
    '/api/v5/symbols',
    '/api/v5/book/ticker',
    '/api/v5/order/depth?symbol=BTCUSD&limit=20',
    '/api/v4/instrument',
    '/api/v4/orderBook/L2?symbol=BTCUSD&depth=20',
  ];
  for (const p of paths) {
    const runs = [];
    for (let i = 0; i < 6; i++) { runs.push(await get(HK + p)); await sleep(1000); }
    const warm = runs.slice(1).map((x) => x.ms).sort((a, b) => a - b);
    log('latency', { path: p, first: strip(runs[0]), warmMin: warm[0], warmMedian: warm[2], warmMax: warm[4], weights: runs.map((x) => x.weight), colos: [...new Set(runs.map((x) => x.colo))] });
  }
}

async function catalogHk() {
  const s = await get(HK + '/api/v5/symbols');
  const t = await get(HK + '/api/v5/book/ticker');
  const v4 = await get(HK + '/api/v4/instrument');
  save('hk_v5_symbols.json', s.json); save('hk_v5_ticker.json', t.json); save('hk_v4_instrument.json', v4.json);
  // The first request of the process pays DNS, TCP and TLS, so it is the cold reading.
  log('hk_cold', { symbols: strip(s), ticker: strip(t), v4Instrument: strip(v4) });
  const sym = s.json;
  const pub = sym.filter((x) => x.status === '1');
  log('hk_v5_symbols', {
    rows: sym.length,
    status: count(sym.map((x) => x.status)),
    quoteAll: count(sym.map((x) => x.quoteAsset)),
    quotePublished: count(pub.map((x) => x.quoteAsset)),
    retailPiPublished: count(pub.map((x) => `retail=${x.retailAvailable} pi=${x.piAvailable}`)),
    feePublished: count(pub.map((x) => `taker=${x.takerFeeRate} maker=${x.makerFeeRate}`)),
    zeroTaker: pub.filter((x) => Number(x.takerFeeRate) === 0).map((x) => x.symbol),
    published: pub.map((x) => x.symbol),
    unpublished: sym.filter((x) => x.status !== '1').map((x) => x.symbol),
    keys: Object.keys(sym[0]),
    sample: sym.find((x) => x.symbol === 'BTCUSD'),
  });
  const tickSyms = t.json.map((x) => x.symbol).sort();
  const v4Syms = v4.json.map((x) => x.symbol).sort();
  const pubSyms = pub.map((x) => x.symbol).sort();
  log('hk_catalog_compare', {
    v5TickerRows: tickSyms.length, v4InstrumentRows: v4Syms.length,
    tickerEqualsPublished: JSON.stringify(tickSyms) === JSON.stringify(pubSyms),
    v4EqualsPublished: JSON.stringify(v4Syms) === JSON.stringify(pubSyms),
    v4Keys: Object.keys(v4.json[0]),
    v4Sample: v4.json.find((x) => x.symbol === 'BTCUSD'),
    tickerSample: t.json.find((x) => x.symbol === 'BTCUSD'),
    v4RetailAvailable: count(v4.json.map((x) => String(x.retailAvailable))),
  });
  // v4 minPrice and maxPrice bracket a reference price, and the bracket is compared with each pair's TAKER_PRICE_RATE filter.
  const bands = v4.json.map((x) => {
    const mn = Number(x.minPrice); const mx = Number(x.maxPrice); const ref = (mn + mx) / 2;
    const f = (sym.find((y) => y.symbol === x.symbol)?.filters ?? []).find((y) => y.type === 'TAKER_PRICE_RATE');
    return { symbol: x.symbol, halfBand: Math.round((mx / ref - 1) * 10000) / 10000, filterMax: f ? Number(f.takerOrderMaxRate) : null, ref: Number(ref.toPrecision(8)), last: Number(x.lastPrice), bid: Number(x.bidPrice), ask: Number(x.askPrice) };
  });
  log('hk_v4_price_band', {
    rows: bands.length,
    bandEqualsFilter: bands.filter((b) => b.filterMax !== null && Math.abs(1 + b.halfBand - b.filterMax) < 1e-6).length,
    refEqualsLast: bands.filter((b) => b.ref === b.last).length,
    refInsideSpread: bands.filter((b) => b.ref >= b.bid && b.ref <= b.ask).length,
    sample: bands.filter((b) => ['BTCUSD', 'ETHUSD', 'USDTUSD'].includes(b.symbol)),
  });
  return new Set(pubSyms);
}

// The public fee page at trade-hk.osl.com/pages/fees renders this unauthenticated config call.
async function feesHk() {
  const r = await get(HK + '/v1/user/pub/config/web/exchange/fee');
  log('hk_fee_config', { ...strip(r), body: r.json ?? r.text.slice(0, 300) });
}

async function booksHk() {
  for (const limit of [20, 100, 1000, 1001]) {
    const r = await get(`${HK}/api/v5/order/depth?symbol=BTCUSD&limit=${limit}`);
    const j = r.json ?? {};
    log('hk_v5_depth', { limit, ...strip(r), keys: Object.keys(j), lastUpdateId: j.lastUpdateId, price: j.price, bids: j.bids?.length, asks: j.asks?.length, bidsDesc: j.bids ? isDesc(j.bids) : null, asksAsc: j.asks ? isAsc(j.asks) : null, types: j.bids ? [...new Set(j.bids.flat().map((x) => typeof x))] : null, sizeDecimals: j.bids ? count(j.bids.map((l) => decimals(l[1]))) : null, top: j.bids ? [j.bids[0], j.asks[0]] : r.text.slice(0, 200) });
    await sleep(1000);
  }
  for (const depth of [20, 0]) {
    const r = await get(`${HK}/api/v4/orderBook/L2?symbol=BTCUSD&depth=${depth}`);
    const j = r.json ?? {};
    log('hk_v4_book', { depth, ...strip(r), keys: Object.keys(j), updateTime: j.updateTime, bids: j.bids?.length, asks: j.asks?.length, bidsDesc: j.bids ? isDesc(j.bids) : null, asksAsc: j.asks ? isAsc(j.asks) : null, sizeDecimals: j.bids ? count(j.bids.map((l) => decimals(l[1]))) : null, top: j.bids ? [j.bids[0], j.asks[0]] : r.text.slice(0, 200) });
    await sleep(1000);
  }
  for (const sym of TRACKED.slice(1)) {
    const r = await get(`${HK}/api/v5/order/depth?symbol=${sym}&limit=100`);
    const j = r.json ?? {};
    log('hk_v5_depth_pair', { sym, status: r.status, bids: j.bids?.length, asks: j.asks?.length, top: j.bids?.[0] && j.asks?.[0] ? [j.bids[0], j.asks[0]] : null, spreadPpm: j.bids?.[0] && j.asks?.[0] ? Math.round(((j.asks[0][0] - j.bids[0][0]) / j.bids[0][0]) * 1e6) : null });
    await sleep(300);
  }
  // Two reads 150 ms apart show whether an edge cache sits in front of the book.
  const a = await get(`${HK}/api/v5/order/depth?symbol=BTCUSD&limit=20`);
  await sleep(150);
  const b = await get(`${HK}/api/v5/order/depth?symbol=BTCUSD&limit=20`);
  log('hk_v5_depth_twice', { ids: [a.json?.lastUpdateId, b.json?.lastUpdateId], sameBody: a.text === b.text, cache: [a.cache, b.cache] });
}

async function errorsHk() {
  const cases = [
    '/api/v5/order/depth?symbol=NOPEUSD',
    '/api/v5/order/depth',
    '/api/v5/order/depth?symbol=XRPUSD',
    '/api/v5/symbols?symbol=NOPEUSD',
    '/api/v5/book/ticker?symbol=NOPEUSD',
    '/api/v5/book/ticker?symbol=XRPUSD',
    '/api/v4/orderBook/L2?symbol=NOPEUSD',
    '/api/v4/orderBook/L2?symbol=XRPUSD',
    '/api/v4/instrument?symbol=NOPEUSD',
  ];
  for (const p of cases) {
    const r = await get(HK + p);
    log('hk_error', { path: p, status: r.status, type: r.type, weight: r.weight, retryAfter: r.retryAfter, body: r.text.slice(0, 300) });
    await sleep(500);
  }
}

// GET /api/v5/time answers although the pages read do not list it, so the offset is bounded from it, the Date header and the v4 book's updateTime.
async function timeHk() {
  const t = await get(`${HK}/api/v5/time`);
  const st = t.json?.serverTime;
  log('hk_time_v5', { status: t.status, body: t.text, rttMs: t.doneAt - t.sentAt, localMinusServerMs: st ? [t.sentAt - st, t.doneAt - st] : null });
  await sleep(1000);
  const r = await get(`${HK}/api/v4/orderBook/L2?symbol=BTCUSD&depth=1`);
  const serverDate = Date.parse(r.date);
  const upd = Date.parse(r.json?.updateTime);
  log('hk_time', { sentAt: r.sentAt, doneAt: r.doneAt, rttMs: r.doneAt - r.sentAt, dateHeader: r.date, dateMinusSentMs: serverDate - r.sentAt, updateTime: r.json?.updateTime, updateTimeAgeMs: r.doneAt - upd });
}

async function poll() {
  const rounds = [];
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    const [d5, d4, tk] = await Promise.all([
      get(`${HK}/api/v5/order/depth?symbol=BTCUSD&limit=20`),
      get(`${HK}/api/v4/orderBook/L2?symbol=BTCUSD&depth=20`),
      get(`${HK}/api/v5/book/ticker`),
    ]);
    const t = (tk.json ?? []).find((x) => x.symbol === 'BTCUSD') ?? {};
    const q = (tk.json ?? []).find((x) => x.symbol === 'SEIUSD') ?? {};
    rounds.push({
      at: t0,
      v5: { id: d5.json?.lastUpdateId, bid: d5.json?.bids?.[0]?.[0], ask: d5.json?.asks?.[0]?.[0], ms: d5.ms, body: d5.text },
      v4: { upd: d4.json?.updateTime, bid: d4.json?.bids?.[0]?.[0], ask: d4.json?.asks?.[0]?.[0], ms: d4.ms, body: d4.text },
      tk: { bid: t.bid, ask: t.ask, last: t.lastPrice, ms: tk.ms, seiBid: q.bid, seiAsk: q.ask },
      weight: d5.weight,
    });
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  const changes = (f) => rounds.slice(1).filter((r, i) => f(r) !== f(rounds[i])).length;
  const ms = (f) => { const v = rounds.map(f).sort((a, b) => a - b); return { min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1] }; };
  log('hk_poll', {
    rounds: rounds.length,
    v5IdChanged: changes((r) => r.v5.id), v5BodyChanged: changes((r) => r.v5.body),
    v5IdDecreased: rounds.slice(1).filter((r, i) => Number(r.v5.id) < Number(rounds[i].v5.id)).length,
    v4UpdateTimeChanged: changes((r) => r.v4.upd), v4BodyChanged: changes((r) => r.v4.body),
    tickerTopChanged: changes((r) => `${r.tk.bid}/${r.tk.ask}`), seiTopChanged: changes((r) => `${r.tk.seiBid}/${r.tk.seiAsk}`),
    v5TopEqualsTicker: rounds.filter((r) => r.v5.bid === r.tk.bid && r.v5.ask === r.tk.ask).length,
    v5TopEqualsV4: rounds.filter((r) => r.v5.bid === r.v4.bid && r.v5.ask === r.v4.ask).length,
    v4UpdateTimeAgeMs: ms((r) => r.at - Date.parse(r.v4.upd)),
    v5Ms: ms((r) => r.v5.ms), v4Ms: ms((r) => r.v4.ms), tickerMs: ms((r) => r.tk.ms),
    weights: rounds.map((r) => r.weight).join(','),
    idSample: rounds.slice(0, 6).map((r) => r.v5.id),
  });
}

async function global() {
  const cg = await get('https://api.coingecko.com/api/v3/derivatives/exchanges/list');
  log('coingecko_derivatives', { status: cg.status, venues: Array.isArray(cg.json) ? cg.json.length : null, matchingOsl: Array.isArray(cg.json) ? cg.json.filter((x) => /osl/i.test(`${x.id} ${x.name}`)) : cg.text.slice(0, 200) });
  const t = await get(GLB + '/openapi/v1/time');
  log('glb_time', { ...strip(t), body: t.json, offsetBoundsMs: t.json ? [t.sentAt - t.json.serverTime, t.doneAt - t.json.serverTime] : null });
  await sleep(1000);
  const ss = await get(GLB + '/openapi/v1/spot/public/symbols');
  const st = await get(GLB + '/openapi/v1/spot/market/tickers');
  save('glb_spot_symbols.json', ss.json); save('glb_spot_tickers.json', st.json);
  const sym = ss.json?.data ?? [];
  const online = sym.filter((x) => x.status === 'online');
  log('glb_spot_symbols', {
    ...strip(ss), envelope: { code: ss.json?.code, msg: ss.json?.msg }, rows: sym.length,
    statusCounts: count(sym.map((x) => x.status)), quoteOnline: count(online.map((x) => x.quoteCoin)),
    fees: count(online.map((x) => `taker=${x.takerFeeRate} maker=${x.makerFeeRate}`)),
    keys: Object.keys(sym[0] ?? {}),
  });
  const tick = st.json?.data ?? [];
  log('glb_spot_tickers', { rows: tick.length, symbols: tick.map((x) => x.symbol).sort(), keys: Object.keys(tick[0] ?? {}) });
  await sleep(1000);
  const ob = await get(GLB + '/openapi/v1/spot/market/orderbook?symbol=BTCUSD&limit=150');
  const d = ob.json?.data ?? {};
  log('glb_spot_book', { ...strip(ob), keys: Object.keys(d), bids: d.bids?.length, asks: d.asks?.length, bidsDesc: d.bids ? isDesc(d.bids) : null, asksAsc: d.asks ? isAsc(d.asks) : null, top: d.bids ? [d.bids[0], d.asks[0]] : ob.text.slice(0, 200) });
  const bad = await get(GLB + '/openapi/v1/spot/market/orderbook?symbol=NOPEUSD');
  log('glb_error', { path: 'spot orderbook NOPEUSD', status: bad.status, body: bad.text.slice(0, 300) });
  await sleep(1000);
  const fs = await get(GLB + '/openapi/v1/symbols');
  const fp = await get(GLB + '/openapi/v1/price');
  save('glb_perp_symbols.json', fs.json); save('glb_perp_price.json', fp.json);
  const perps = fs.json ?? [];
  const price = Object.fromEntries((fp.json ?? []).map((x) => [x.symbol, x]));
  const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : null);
  log('glb_perp_symbols', {
    rows: perps.length, margin: count(perps.map((x) => x.marginAsset)),
    allowTrade: count(perps.map((x) => x.allowTrade)), banOpen: count(perps.map((x) => x.banOpenPositionStatus)),
    tradable: perps.filter((x) => x.allowTrade === 1 && x.banOpenPositionStatus === 0).map((x) => x.symbol),
    keys: Object.keys(perps[0] ?? {}),
  });
  for (const p of perps) {
    const r = await get(`${GLB}/openapi/v1/depth?symbol=${p.symbol}&limit=50`);
    const pr = price[p.symbol] ?? {};
    log('glb_perp', {
      symbol: p.symbol, name: p.symbolName, allowTrade: p.allowTrade, banOpen: p.banOpenPositionStatus, forbidApi: p.forbidOpenapiTrade,
      open: iso(p.openTime), mark: pr.markPrice, index: pr.indexPrice, last: pr.tradePrice, priceTime: iso(pr.time),
      depthStatus: r.status, bids: r.json?.bids?.length, asks: r.json?.asks?.length, depthTime: iso(r.json?.time),
    });
    await sleep(1000);
  }
  const bp = await get(GLB + '/openapi/v1/depth?symbol=NOPEUSDC&limit=50');
  log('glb_error', { path: 'perp depth NOPEUSDC', status: bp.status, body: bp.text.slice(0, 300) });
  const cr = await get(GLB + '/openapi/v1/commissionRate?symbol=BTCUSDC&category=FUTURE');
  log('glb_error', { path: 'commissionRate without key', status: cr.status, body: cr.text.slice(0, 300) });
}

async function main() {
  await host();
  ccxtCheck();
  await catalogHk();
  await sleep(1000);
  const ht = await get(HK + '/api/v5/book/ticker');
  const gs = await get(GLB + '/openapi/v1/spot/public/symbols');
  const gt = await get(GLB + '/openapi/v1/spot/market/tickers');
  const hk = new Map((ht.json ?? []).map((x) => [x.symbol, Number(x.baseVolume)]));
  const glb = new Map((gs.json?.data ?? []).filter((x) => x.status === 'online').map((x) => [x.symbol, null]));
  for (const x of gt.json?.data ?? []) glb.set(x.symbol, Number(x.baseVolume));
  await coingecko(hk, glb);
  await feesHk();
  await latency();
  await booksHk();
  await errorsHk();
  await timeHk();
}

const mode = process.argv[2] ?? 'main';
const run = { main, poll, global }[mode];
if (!run) { console.error(`unknown mode ${mode}`); process.exit(1); }
await run();
