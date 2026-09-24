// WhiteBIT REST probe: host and latency, the CCXT catalog against the raw replies, the /futures anchor call polled at one hertz, the REST book, errors, server time and funding history.
// Public, unauthenticated, read-only. Every loop keeps at least one second between two requests to the same endpoint, far inside the documented 2,000 per 10 s.
// Run from server/: node ../scripts/probes/venues/whitebit/rest-probe.mjs [main|settlement]
//   main        host, access and refusals, catalog, anchor poll (60 rounds), index against spot and perp last, book, errors, time, funding history. About 3 minutes.
//   settlement  polls /futures and the funding history of four perps every 5 s from 90 s before the next settlement to 120 s after it, waiting for it first.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/whitebit/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://whitebit.com/api/v4/public';
const OUT = process.env.PROBE_OUT_DIR;
const ANCHOR_ROUNDS = 60;
const TRACKED = ['BTC_PERP', 'ETH_PERP', 'SOL_PERP', 'STG_PERP'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), typeof body === 'string' ? body : JSON.stringify(body, null, 1));
}

async function get(path, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(path.startsWith('https://') ? path : API + path, { headers: { accept: 'application/json', ...headers } });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  const h = (k) => res.headers.get(k);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const rateHeaders = {};
  for (const [k, v] of res.headers) if (/rate|retry|limit/i.test(k)) rateHeaders[k] = v;
  return {
    status: res.status,
    ms: Math.round(ms),
    ttfbMs: Math.round(ttfb),
    bytes: Buffer.byteLength(text),
    encoding: h('content-encoding'),
    cfCache: h('cf-cache-status'),
    age: h('age'),
    cacheControl: h('cache-control'),
    cfRay: h('cf-ray'),
    server: h('server'),
    date: h('date'),
    rateHeaders,
    text,
    json,
  };
}

const strip = (r) => { const { text, json, ...rest } = r; return rest; };

// Cloudflare's published ranges say whether an address is Cloudflare's edge, and the cf-ray suffix names the edge colo that answered.
async function host() {
  let ranges = [];
  try { ranges = (await (await fetch('https://www.cloudflare.com/ips-v4')).text()).trim().split('\n'); } catch {}
  const toInt = (ip) => ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
  const inCf = (ip) => ranges.some((p) => {
    const [net, bits] = p.split('/');
    const size = 2 ** (32 - Number(bits));
    return toInt(ip) >= toInt(net) && toInt(ip) < toInt(net) + size;
  });
  for (const name of ['whitebit.com', 'wss.whitebit.com', 'api.whitebit.com']) {
    const out = { name };
    try { out.cname = await dns.resolveCname(name); } catch (e) { out.cname = e.code; }
    try { out.a = (await dns.resolve4(name)).map((ip) => `${ip} ${inCf(ip) ? 'cloudflare' : 'not cloudflare'}`); } catch (e) { out.a = e.code; }
    try { out.aaaa = (await dns.resolve6(name)).length; } catch (e) { out.aaaa = e.code; }
    log('dns', out);
  }
}

// The docs name HTTP 451 as the regional refusal on /collateral/markets and /futures, and Cloudflare's trace says where its edge places this host.
async function access() {
  for (const path of ['/collateral/markets', '/futures', '/markets', '/ticker']) {
    const r = await get(path);
    log('access', { path, status: r.status, bytes: r.bytes, body: r.status === 200 ? undefined : r.text.slice(0, 200) });
    await sleep(1100);
  }
  const trace = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
  log('access_geo', { cloudflareTrace: Object.fromEntries(trace.trim().split('\n').map((l) => l.split('=')).filter(([k]) => ['colo', 'loc'].includes(k))) });
  const site = await fetch('https://whitebit.com/', { headers: { 'user-agent': 'Mozilla/5.0' } });
  const body = await site.text();
  log('access_site', { url: 'https://whitebit.com/', status: site.status, cfMitigated: site.headers.get('cf-mitigated'), title: body.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? null });
}

async function latency() {
  const paths = ['/time', '/futures', '/markets', '/orderbook/BTC_PERP?limit=100'];
  for (const p of paths) {
    const runs = [];
    for (let i = 0; i < 6; i++) {
      runs.push(strip(await get(p)));
      await sleep(1100);
    }
    const warm = runs.slice(1).map((r) => r.ms).sort((a, b) => a - b);
    log('latency', { path: p, first: runs[0].ms, firstTtfb: runs[0].ttfbMs, warmMin: warm[0], warmMedian: warm[2], warmMax: warm[4], bytes: runs[0].bytes, encoding: runs[0].encoding, cfCache: runs[0].cfCache, cfRay: runs[0].cfRay, server: runs[0].server, rateHeaders: runs[0].rateHeaders, cacheControl: runs[0].cacheControl, age: runs[0].age });
  }
}

let futuresIds = new Set();

async function catalog() {
  const fut = await get('/futures');
  save('futures.json', fut.text);
  const rows = fut.json.result;
  futuresIds = new Set(rows.map((r) => r.ticker_id));
  const count = (f, arr = rows) => arr.reduce((o, x) => { const k = f(x); o[k] = (o[k] ?? 0) + 1; return o; }, {});
  log('futures_reply', {
    status: fut.status, rows: rows.length, envelope: Object.keys(fut.json),
    productType: count((r) => `${r.product_type}|${r.money_currency}`),
    fields: [...new Set(rows.flatMap((r) => Object.keys(r)))],
    fundingIntervalMinutes: count((r) => r.funding_interval_minutes),
    nextFunding: count((r) => new Date(Number(r.next_funding_rate_timestamp)).toISOString()),
    capFloor: count((r) => `${r.funding_cap}/${r.funding_floor}`),
    maxLeverage: count((r) => r.max_leverage),
    markEmpty: rows.filter((r) => r.mark_price === '').length,
    indexZero: rows.filter((r) => r.index_price === '0').length,
    markEqualsIndex: rows.filter((r) => r.mark_price === r.index_price).length,
    markEqualsLast: rows.filter((r) => r.mark_price === r.last_price).length,
    indexNameFutureContract: rows.filter((r) => r.index_name.endsWith(' future contract')).length,
  });

  const mk = await get('/markets');
  save('markets.json', mk.text);
  const markets = mk.json;
  const futRows = markets.filter((m) => m.type === 'futures');
  const tradfiRows = markets.filter((m) => m.type === 'tradfiFutures');
  log('markets_reply', {
    status: mk.status, rows: markets.length, types: count((m) => m.type, markets),
    futuresFees: count((m) => `${m.makerFee}/${m.takerFee}`, futRows),
    tradfiFees: count((m) => `${m.makerFee}/${m.takerFee}`, tradfiRows),
    spotFees: count((m) => `${m.makerFee}/${m.takerFee}`, markets.filter((m) => m.type === 'spot')),
    futuresMoney: count((m) => m.money, futRows),
    tradfiMoney: count((m) => m.money, tradfiRows),
    futuresStockPrec: count((m) => m.stockPrec, futRows),
    stepEqualsPrec: futRows.filter((m) => Number(m.stepSize) === 10 ** -Number(m.stockPrec)).length,
    stepEmpty: futRows.filter((m) => m.stepSize === '').length,
    delisted: markets.filter((m) => m.delistedAt !== null).map((m) => `${m.name}@${new Date(m.delistedAt * 1000).toISOString()}`),
    perpNamesNotInFutures: [...futRows, ...tradfiRows].filter((m) => !futuresIds.has(m.name)).map((m) => m.name),
    futuresNotInMarkets: [...futuresIds].filter((id) => !markets.some((m) => m.name === id)).length,
    tradfiSample: tradfiRows.slice(0, 3),
    negativePrec: futRows.filter((m) => Number(m.stockPrec) < 0).map((m) => `${m.name} stockPrec ${m.stockPrec} stepSize ${m.stepSize} minAmount ${m.minAmount}`),
  });
  const tradfiIds = new Set(tradfiRows.map((m) => m.name));
  const crypto = rows.filter((r) => !tradfiIds.has(r.ticker_id));
  const trad = rows.filter((r) => tradfiIds.has(r.ticker_id));
  log('mark_shape', {
    crypto: crypto.length, tradfi: trad.length,
    markEqIndexCrypto: crypto.filter((r) => r.mark_price === r.index_price).length,
    markEqIndexTradfi: trad.filter((r) => r.mark_price === r.index_price).length,
    markEqLastCrypto: crypto.filter((r) => r.mark_price === r.last_price).length,
    markEqLastTradfi: trad.filter((r) => r.mark_price === r.last_price).length,
    indexEqLastTradfi: trad.filter((r) => r.index_price === r.last_price).length,
    tradfiIntervals: count((r) => r.funding_interval_minutes, trad),
    tradfiCaps: count((r) => r.funding_cap, trad),
    tradfiIndexNames: trad.slice(0, 5).map((r) => `${r.ticker_id}: ${r.index_name}`),
    markPremiumAbsOver1pct: rows.filter((r) => Math.abs(Number(r.mark_price) / Number(r.index_price) - 1) > 0.01).length,
    markPremiumAbsMax: Math.max(...rows.map((r) => Math.abs(Number(r.mark_price) / Number(r.index_price) - 1))),
  });

  const ex = new ccxt.whitebit();
  const t0 = performance.now();
  const loaded = await ex.loadMarkets();
  const all = Object.values(loaded);
  const swaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  const byName = Object.fromEntries(markets.map((m) => [m.name, m]));
  const rawNames = markets.map((m) => m.name);
  const symbolsSeen = {};
  for (const m of markets) {
    const quote = m.money === 'PERP' ? 'USDT' : m.money;
    const sym = m.type === 'futures' ? `${m.stock}/${quote}:${quote}` : `${m.stock}/${quote}`;
    (symbolsSeen[sym] ??= []).push(m.name);
  }
  log('ccxt', {
    version: ccxt.version,
    loadMs: Math.round(performance.now() - t0),
    total: all.length,
    rawTotal: rawNames.length,
    collidingSymbols: Object.entries(symbolsSeen).filter(([, v]) => v.length > 1),
    types: count((m) => `${m.type}|swap=${m.swap}|active=${m.active}`, all),
    activeSwaps: swaps.length,
    settle: count((m) => `${m.settle}|linear=${m.linear}`, swaps),
    taker: count((m) => m.taker, swaps),
    maker: count((m) => m.maker, swaps),
    contractSize: count((m) => m.contractSize, swaps),
    contractSizeNotOne: swaps.filter((m) => m.contractSize !== 1).length,
    idInFutures: swaps.filter((m) => futuresIds.has(m.id)).length,
    tradfiAsSpot: all.filter((m) => byName[m.id]?.type === 'tradfiFutures').map((m) => `${m.symbol} ${m.type}`).slice(0, 5),
    tradfiAsSpotCount: all.filter((m) => byName[m.id]?.type === 'tradfiFutures').length,
    pairsTwice: Object.entries(count((m) => `${m.base}/${m.quote}`, swaps)).filter(([, n]) => n > 1),
    samples: ['BTC_PERP', 'ETH_PERP', 'SOL_PERP', 'STG_PERP', 'SHIB_PERP', 'PEPE_PERP'].map((id) => {
      const m = swaps.find((x) => x.id === id);
      return m && { id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, precisionAmount: m.precision.amount, precisionPrice: m.precision.price, stockPrec: m.info.stockPrec, stepSize: m.info.stepSize, minAmount: m.info.minAmount };
    }),
  });

  // Units: 24 h stock_volume times a price near last should equal money_volume if the book and volume unit is the base coin.
  const unit = TRACKED.concat(['SHIB_PERP', 'PEPE_PERP']).map((id) => {
    const r = rows.find((x) => x.ticker_id === id);
    if (!r) return { id, missing: true };
    const implied = Number(r.money_volume) / Number(r.stock_volume);
    return { id, stock_volume: r.stock_volume, money_volume: r.money_volume, impliedPrice: implied, last: r.last_price, ratio: implied / Number(r.last_price), open_interest: r.open_interest, ccxtContractSize: swaps.find((m) => m.id === id)?.contractSize };
  });
  log('size_unit_volume', { unit });
}

async function anchor() {
  const prev = {};
  const changes = Object.fromEntries(TRACKED.map((s) => [s, { index: 0, mark: 0, funding: 0, last: 0, next: 0, markEqIndex: 0, markEqLast: 0, maxIndexWaitS: 0, lastIndexChangeRound: 0 }]));
  const times = [];
  let identicalBodies = 0;
  let prevHash = null;
  let markEmptyMax = 0;
  const series = { BTC_PERP: [], ETH_PERP: [] };
  const t0 = Date.now();
  for (let round = 0; round < ANCHOR_ROUNDS; round++) {
    const started = Date.now();
    const r = await get('/futures');
    times.push(r.ms);
    const h = hash(r.text);
    if (h === prevHash) identicalBodies++;
    prevHash = h;
    const rows = r.json?.result ?? [];
    markEmptyMax = Math.max(markEmptyMax, rows.filter((x) => x.mark_price === '').length);
    for (const s of TRACKED) {
      const row = rows.find((x) => x.ticker_id === s);
      if (!row) continue;
      const c = changes[s];
      const p = prev[s];
      if (row.mark_price === row.index_price) c.markEqIndex++;
      if (row.mark_price === row.last_price) c.markEqLast++;
      if (p) {
        if (row.index_price !== p.index_price) { c.index++; c.maxIndexWaitS = Math.max(c.maxIndexWaitS, round - c.lastIndexChangeRound); c.lastIndexChangeRound = round; }
        if (row.mark_price !== p.mark_price) c.mark++;
        if (row.funding_rate !== p.funding_rate) c.funding++;
        if (row.last_price !== p.last_price) c.last++;
        if (row.next_funding_rate_timestamp !== p.next_funding_rate_timestamp) c.next++;
      }
      if (series[s] && (!p || row.index_price !== p.index_price || row.mark_price !== p.mark_price || row.funding_rate !== p.funding_rate)) series[s].push({ utc: new Date().toISOString().slice(11, 23), mark: row.mark_price, index: row.index_price, funding: row.funding_rate });
      prev[s] = row;
    }
    if (round === 0 || round === ANCHOR_ROUNDS - 1) {
      log('anchor_rows', { round, at: new Date().toISOString(), rows: TRACKED.map((s) => { const x = rows.find((y) => y.ticker_id === s); return x && { s, index: x.index_price, mark: x.mark_price, last: x.last_price, bid: x.bid, ask: x.ask, funding: x.funding_rate, cap: x.funding_cap, floor: x.funding_floor, next: x.next_funding_rate_timestamp, interval: x.funding_interval_minutes, indexName: x.index_name }; }) });
    }
    const wait = 1000 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  for (const s of TRACKED) changes[s].maxIndexWaitS = Math.max(changes[s].maxIndexWaitS, ANCHOR_ROUNDS - 1 - changes[s].lastIndexChangeRound);
  const sorted = [...times].sort((a, b) => a - b);
  log('anchor_series', { series });
  log('anchor_poll', { rounds: ANCHOR_ROUNDS, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], max: sorted.at(-1), over1s: times.filter((t) => t > 1000).length, over2s: times.filter((t) => t > 2000).length, identicalBodies, markEmptyMax, changes });
}

// Is the index the perp itself? Compare each index with the perp last trade and with the spot last trade of the same base, over a few reads.
async function indexShape() {
  const tallies = { rows: 0, indexEqPerpLast: 0, indexEqSpotLast: 0, noSpot: 0, indexEqPerpLastNoSpot: 0 };
  const perSymbol = {};
  for (let i = 0; i < 5; i++) {
    const fut = await get('/futures');
    const tick = await get('/ticker');
    for (const r of fut.json.result) {
      tallies.rows++;
      const spot = tick.json[`${r.stock_currency}_USDT`];
      const eqPerp = Number(r.index_price) === Number(r.last_price);
      if (eqPerp) tallies.indexEqPerpLast++;
      if (!spot) { tallies.noSpot++; if (eqPerp) tallies.indexEqPerpLastNoSpot++; }
      else if (Number(r.index_price) === Number(spot.last_price)) tallies.indexEqSpotLast++;
      const ps = (perSymbol[r.ticker_id] ??= { eqPerp: 0, eqSpot: 0, spot: !!spot });
      if (eqPerp) ps.eqPerp++;
      if (spot && Number(r.index_price) === Number(spot.last_price)) ps.eqSpot++;
    }
    await sleep(3000);
  }
  const alwaysPerp = Object.entries(perSymbol).filter(([, v]) => v.eqPerp === 5).map(([k, v]) => `${k}${v.spot ? '' : ' (no spot)'}`);
  const alwaysSpot = Object.entries(perSymbol).filter(([, v]) => v.eqSpot === 5).map(([k]) => k);
  log('index_shape', { reads: 5, tallies, alwaysEqPerpLastCount: alwaysPerp.length, alwaysEqPerpLastWithSpot: alwaysPerp.filter((x) => !x.endsWith('(no spot)')), alwaysEqPerpLast: alwaysPerp, alwaysEqSpotLast: alwaysSpot.length, alwaysEqSpotLastSample: alwaysSpot.slice(0, 20) });
}

async function book() {
  const isAsc = (l) => l.every((x, i) => i === 0 || Number(x[0]) > Number(l[i - 1][0]));
  const isDesc = (l) => l.every((x, i) => i === 0 || Number(x[0]) < Number(l[i - 1][0]));
  for (const [path, label] of [['/orderbook/BTC_PERP', 'no limit'], ['/orderbook/BTC_PERP?limit=100', '100'], ['/orderbook/BTC_PERP?limit=20', '20'], ['/orderbook/BTC_PERP?limit=0', '0'], ['/orderbook/BTC_PERP?limit=101', '101'], ['/orderbook/BTC_PERP?limit=1000', '1000'], ['/orderbook/STG_PERP?limit=100', 'STG 100'], ['/orderbook/BTC_PERP?limit=20&level=2', 'level 2'], ['/orderbook/BTC_USDT?limit=20', 'spot BTC_USDT']]) {
    const r = await get(path);
    const j = r.json;
    log('rest_book', { label, status: r.status, ms: r.ms, bytes: r.bytes, keys: j && Object.keys(j), bids: j?.bids?.length, asks: j?.asks?.length, bidsDesc: j?.bids && isDesc(j.bids), asksAsc: j?.asks && isAsc(j.asks), top: j?.bids && { bid: j.bids[0], ask: j.asks[0] }, timestamp: j?.timestamp, sizeTypes: j?.bids && [...new Set(j.bids.map((l) => typeof l[1]))], cfCache: r.cfCache, body: j?.bids ? undefined : r.text.slice(0, 200) });
    await sleep(1100);
  }
  // Two reads 150 ms apart show whether the 100 ms cache hands back an identical book.
  const a = await get('/orderbook/BTC_PERP?limit=100');
  await sleep(150);
  const b = await get('/orderbook/BTC_PERP?limit=100');
  const c = await get('/orderbook/BTC_PERP?limit=100');
  log('rest_book_cache', { aTs: a.json.timestamp, bTs: b.json.timestamp, cTs: c.json.timestamp, abIdentical: a.text === b.text, bcIdentical: b.text === c.text, bcGapMs: c.ms });
  for (const path of ['/orderbook/depth/BTC_PERP', '/orderbook/depth/BTC_USDT']) {
    const r = await get(path);
    log('rest_depth', { path, status: r.status, bytes: r.bytes, body: r.text.slice(0, 200) });
    await sleep(1100);
  }
}

async function errors() {
  for (const path of ['/orderbook/NOPE_PERP', '/orderbook/BTC_PERP?limit=abc', '/orderbook/BTC_PERP?level=abc', '/funding-history/NOPE_PERP', '/funding-history/BTC_USDT', '/nope', '/futures?market=BTC_PERP', '/trades/NOPE_PERP']) {
    const r = await get(path);
    log('error', { path, status: r.status, contentType: r.encoding, bytes: r.bytes, body: r.text.slice(0, 240) });
    await sleep(1100);
  }
}

async function serverTime() {
  for (let i = 0; i < 3; i++) {
    const sent = Date.now();
    const r = await get('/time');
    const recv = Date.now();
    const server = r.json.time * 1000; // whole seconds
    // Local minus server lies between (sent - server - 1000) and (recv - server), since the server floors to a second somewhere inside the round trip.
    log('time', { body: r.text, rttMs: recv - sent, offsetLowMs: sent - server - 1000, offsetHighMs: recv - server });
    await sleep(1100);
  }
}

async function fundingHistory() {
  const r = await get('/funding-history/BTC_PERP');
  const rows = r.json;
  log('funding_history', { status: r.status, bytes: r.bytes, rows: rows.length, first: rows[0], last: rows.at(-1), fields: Object.keys(rows[0] ?? {}), gapsS: [...new Set(rows.slice(1).map((x, i) => Number(rows[i].fundingTime) - Number(x.fundingTime)))], calcLagS: [...new Set(rows.map((x) => Number(x.fundingTime) - Number(x.rateCalculatedTime)))], atOneBp: rows.filter((x) => x.fundingRate === '0.0001').length, aboveOneBp: rows.filter((x) => Number(x.fundingRate) > 0.0001).length, min: Math.min(...rows.map((x) => Number(x.fundingRate))), max: Math.max(...rows.map((x) => Number(x.fundingRate))) });
}

async function settlement() {
  const fut = await get('/futures');
  const next = Math.min(...fut.json.result.map((r) => Number(r.next_funding_rate_timestamp)));
  const start = next - 90_000;
  log('settlement_wait', { next: new Date(next).toISOString(), startsAt: new Date(start).toISOString(), waitMin: Math.round((start - Date.now()) / 60000) });
  if (start > Date.now()) await sleep(start - Date.now());
  const end = next + 120_000;
  const prev = {};
  let lastAll = null;
  while (Date.now() < end) {
    const t = Date.now();
    const r = await get('/futures');
    const rows = r.json?.result ?? [];
    for (const s of TRACKED) {
      const x = rows.find((y) => y.ticker_id === s);
      if (!x) continue;
      const cur = `${x.funding_rate}|${x.next_funding_rate_timestamp}`;
      if (prev[s] !== cur) log('settlement_row', { at: new Date(t).toISOString(), s, funding: x.funding_rate, next: x.next_funding_rate_timestamp, interval: x.funding_interval_minutes, mark: x.mark_price, index: x.index_price });
      prev[s] = cur;
    }
    const all = Object.fromEntries(rows.map((x) => [x.ticker_id, x.funding_rate]));
    if (lastAll) {
      const changed = Object.keys(all).filter((k) => all[k] !== lastAll[k]).length;
      if (changed) log('settlement_all', { at: new Date(t).toISOString(), changed, of: rows.length });
    }
    lastAll = all;
    await sleep(5000 - (Date.now() - t));
  }
  for (const s of TRACKED) {
    const h = await get(`/funding-history/${s}`);
    log('settlement_history', { s, newest: h.json?.slice?.(0, 2) });
    await sleep(1100);
  }
}

const mode = process.argv[2] ?? 'main';
if (mode === 'main') {
  log('start', { at: new Date().toISOString(), mode });
  await host();
  await access();
  await latency();
  await catalog();
  await anchor();
  await indexShape();
  await book();
  await errors();
  await serverTime();
  await fundingHistory();
  log('end', { at: new Date().toISOString() });
} else if (mode === 'settlement') {
  log('start', { at: new Date().toISOString(), mode });
  await settlement();
  log('end', { at: new Date().toISOString() });
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
