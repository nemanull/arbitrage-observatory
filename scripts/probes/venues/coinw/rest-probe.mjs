// CoinW futures REST probe: host and latency, catalog by quote and status, the bulk calls an anchor poller could use, last settled funding, REST book, errors and clock.
// Public, unauthenticated, read-only. It sends at most two requests at once and averages under 3 a second, inside the documented 5 per second per endpoint and 30 per second per IP for market data.
// Run from server/: node ../scripts/probes/venues/coinw/rest-probe.mjs [latency|catalog|anchor|funding|book|errors|clock|binance]
//   latency  DNS, 5 cold and 10 warm requests on the single ticker call.
//   catalog  whether CCXT has a class, then instruments by quote, status, funding period and lot size, cross-checked with the tickers call.
//   anchor   60 polls of tickers and instruments at 1 s: reply time and size, how often fair_price and settledAt changed, fair_price against last_price. About 65 s.
//   funding  last settled funding on two contracts of each funding period, against settledAt and settledPeriod.
//   book     REST depth on four contracts: level count, order, number types, two reads in a row.
//   errors   unknown contract, missing parameter, wrong case and unknown path on each public call, and an equity contract missing from the catalog.
//   clock    the Date header against the local clock, and the tickers ts against arrival.
//   binance  last prices against Binance USD-M on every shared USDT contract, and the BTC touch against Binance three times. It reads two public Binance calls.
// Set PROBE_OUT_DIR to keep the last replies. Recorded in docs/profiles/coinw/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'api.coinw.com';
const API = `https://${HOST}`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const keepAlive = new https.Agent({ keepAlive: true, maxSockets: 2 });

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// Resolves with status, headers, body text, total ms and time to first byte.
function get(path, { agent = keepAlive } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let ttfb = 0;
    const req = https.get(`${API}${path}`, { agent, headers: { 'accept-encoding': 'identity' } }, (res) => {
      ttfb = performance.now() - t0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, ms: performance.now() - t0, ttfb, bytes: body.length, at: Date.now() });
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });
}

const json = (r) => { try { return JSON.parse(r.body); } catch { return undefined; } };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null; };
const stats = (xs) => ({ n: xs.length, min: q(xs, 0), median: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) });
const count = (xs, f) => xs.reduce((a, x) => { const k = f(x); a[k] = (a[k] ?? 0) + 1; return a; }, {});

async function latency() {
  const t0 = performance.now();
  const addrs = await lookup(HOST, { all: true });
  log('dns', { ms: Math.round(performance.now() - t0), addrs: addrs.map((a) => a.address) });
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/v1/perpumPublic/ticker?instrument=BTC', { agent: false });
    cold.push(r.ms);
    await sleep(500);
  }
  const warm = [];
  const ttfb = [];
  await get('/v1/perpumPublic/ticker?instrument=BTC');
  for (let i = 0; i < 10; i++) {
    const r = await get('/v1/perpumPublic/ticker?instrument=BTC');
    warm.push(r.ms);
    ttfb.push(r.ttfb);
    await sleep(500);
  }
  const r = await get('/v1/perpumPublic/ticker?instrument=BTC');
  const h = r.headers;
  log('latency', { cold: stats(cold), warm: stats(warm), warmTtfb: stats(ttfb), server: h.server, cfRay: h['cf-ray'], via: h.via ?? h['x-via'] });
}

async function catalog() {
  let ccxtIds = [];
  try {
    const ccxt = require('ccxt');
    ccxtIds = ccxt.exchanges;
    log('ccxt', { version: ccxt.version, exchanges: ccxtIds.length, matching: ccxtIds.filter((x) => /coinw/i.test(x)) });
  } catch (e) {
    log('ccxt', { error: e.message });
  }
  const ri = await get('/v1/perpum/instruments');
  const inst = json(ri).data;
  save('instruments.json', ri.body);
  log('instruments', { status: ri.status, bytes: ri.bytes, ms: Math.round(ri.ms), rows: inst.length, byQuoteStatus: count(inst, (r) => `${r.quote}/${r.status}`) });
  log('instruments_fields', { settledPeriod: count(inst, (r) => r.settledPeriod), settledAt: count(inst, (r) => new Date(r.settledAt).toISOString()), takerFee: count(inst, (r) => r.takerFee), makerFee: count(inst, (r) => r.makerFee), commissionRate: count(inst, (r) => r.commissionRate), tradfiTag: count(inst, (r) => r.tradfiTag || '(empty)'), platform: count(inst, (r) => r.platform), minSize: count(inst, (r) => r.minSize) });
  log('instruments_spreads', { openSpread: count(inst, (r) => r.openSpread), closeSpread: count(inst, (r) => r.closeSpread), settlementRate: count(inst, (r) => r.settlementRate) });
  const names = inst.map((r) => r.name);
  log('instrument_names', { upperCaseName: names.filter((n) => n === n.toUpperCase()).length, withUnderscore: names.filter((n) => n.includes('_')).length, numericPrefix: names.filter((n) => /^\d/.test(n)).slice(0, 20), baseTwice: Object.entries(count(inst, (r) => r.base)).filter(([, v]) => v > 1).map(([k]) => k) });
  log('instrument_btc', Object.fromEntries(Object.entries(inst.find((r) => r.name === 'BTC')).filter(([k]) => !['configBo', 'iconUrl'].includes(k))));
  log('instrument_usdc', { rows: inst.filter((r) => r.quote === 'usdc').map((r) => ({ name: r.name, base: r.base, oneLotSize: r.oneLotSize, settledPeriod: r.settledPeriod, status: r.status })) });
  await sleep(500);
  const rt = await get('/v1/perpumPublic/tickers');
  const tick = json(rt).data;
  save('tickers.json', rt.body);
  const instKey = new Set(inst.map((r) => `${r.base}${r.quote}`.toUpperCase()));
  const tickNames = tick.map((t) => t.name);
  const lotByKey = new Map(inst.map((r) => [`${r.base}${r.quote}`.toUpperCase(), r.oneLotSize]));
  log('tickers', { status: rt.status, bytes: rt.bytes, rows: tick.length, byQuote: count(tick, (t) => t.quote_coin), notInInstruments: tickNames.filter((n) => !instKey.has(n)), instrumentsNotInTickers: [...instKey].filter((k) => !tickNames.includes(k)), contractSizeDiffers: tick.filter((t) => lotByKey.has(t.name) && lotByKey.get(t.name) !== t.contract_size).length, distinctTs: new Set(tick.map((t) => t.ts)).size, zeroVolume: tick.filter((t) => t.total_volume === 0).length });
  log('ticker_btc', tick.find((t) => t.name === 'BTCUSDT'));
}

async function anchor() {
  const polls = 60;
  const tickMs = [];
  const tickBytes = [];
  const instMs = [];
  const instBytes = [];
  const prevFair = new Map();
  const fairChanges = new Map();
  const prevSettled = new Map();
  const settledChanges = [];
  let fairEqLast = 0;
  let fairRows = 0;
  let over1s = 0;
  const gapPpm = [];
  for (let i = 0; i < polls; i++) {
    const start = Date.now();
    const [rt, ri] = await Promise.all([get('/v1/perpumPublic/tickers'), get('/v1/perpum/instruments')]);
    tickMs.push(rt.ms);
    tickBytes.push(rt.bytes);
    instMs.push(ri.ms);
    instBytes.push(ri.bytes);
    if (rt.ms > 1000 || ri.ms > 1000) over1s++;
    const tick = json(rt)?.data ?? [];
    for (const t of tick) {
      fairRows++;
      if (t.fair_price === t.last_price) fairEqLast++;
      else gapPpm.push(Math.abs(t.fair_price / t.last_price - 1) * 1e6);
      if (prevFair.has(t.name) && prevFair.get(t.name) !== t.fair_price) fairChanges.set(t.name, (fairChanges.get(t.name) ?? 0) + 1);
      prevFair.set(t.name, t.fair_price);
    }
    for (const r of json(ri)?.data ?? []) {
      if (prevSettled.has(r.name) && prevSettled.get(r.name) !== r.settledAt) settledChanges.push({ name: r.name, from: prevSettled.get(r.name), to: r.settledAt });
      prevSettled.set(r.name, r.settledAt);
    }
    if (i === polls - 1) {
      save('tickers-last.json', rt.body);
    }
    const wait = 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
  }
  log('anchor_tickers', { time: stats(tickMs), bytes: stats(tickBytes) });
  log('anchor_instruments', { time: stats(instMs), bytes: stats(instBytes), pollsOver1s: over1s });
  const changes = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'BTCUSDC', 'ETHUSDC'].map((n) => `${n}:${fairChanges.get(n) ?? 0}`);
  log('anchor_fair', { rows: fairRows, fairEqualsLast: fairEqLast, fairDiffersPpm: stats(gapPpm), changedOnPolls: changes, contractsThatNeverChanged: [...prevFair.keys()].filter((n) => !fairChanges.has(n)).length, of: prevFair.size });
  log('anchor_settledAt', { changes: settledChanges.length, sample: settledChanges.slice(0, 5) });
}

async function funding() {
  const ri = await get('/v1/perpum/instruments');
  const inst = json(ri).data.filter((r) => r.quote === 'usdt');
  const picks = [];
  for (const p of [8, 4, 1]) picks.push(...inst.filter((r) => r.settledPeriod === p).slice(0, 2));
  picks.push(...json(ri).data.filter((r) => r.quote === 'usdc').slice(0, 1));
  for (const r of picks) {
    await sleep(300);
    const key = r.quote === 'usdc' ? `${r.base.toUpperCase()}_USDC` : r.name;
    const f = await get(`/v1/perpum/fundingRate?instrument=${key}`);
    const d = json(f);
    const last = d?.data?.ts;
    log('funding', { key, ms: Math.round(f.ms), bytes: f.bytes, settledPeriod: r.settledPeriod, settledAt: new Date(r.settledAt).toISOString(), lastSettled: last ? new Date(last).toISOString() : null, hoursBetween: last ? (r.settledAt - last) / 3_600_000 : null, value: d?.data?.value, reply: d?.data ? undefined : f.body.slice(0, 120) });
  }
}

async function book() {
  const bases = ['BTC', 'ETH', 'BTC_USDC', 'AINVDA'];
  for (const b of bases) {
    const r1 = await get(`/v1/perpumPublic/depth?base=${b}`);
    const r2 = await get(`/v1/perpumPublic/depth?base=${b}`);
    const d = json(r1)?.data;
    if (!d) { log('book', { base: b, status: r1.status, body: r1.body.slice(0, 200) }); continue; }
    const bids = d.bids ?? [];
    const asks = d.asks ?? [];
    const desc = bids.every((l, i) => i === 0 || l.p < bids[i - 1].p);
    const asc = asks.every((l, i) => i === 0 || l.p > asks[i - 1].p);
    log('book', { base: b, status: r1.status, ms: Math.round(r1.ms), bytes: r1.bytes, bids: bids.length, asks: asks.length, bidsDescending: desc, asksAscending: asc, priceType: typeof bids[0]?.p, sizeType: typeof bids[0]?.m, keys: Object.keys(d), n: d.n, t: d.t, arrivalMinusTMs: d.t ? r1.at - d.t : null, top: { bid: bids[0], ask: asks[0] }, secondReadIdentical: r1.body === r2.body, secondReadGapMs: r2.at - r1.at });
    save(`depth-${b}.json`, r1.body);
    await sleep(400);
  }
}

async function errors() {
  const calls = [
    '/v1/perpum/instruments?name=NOPE',
    '/v1/perpum/instruments?name=btc',
    '/v1/perpumPublic/ticker?instrument=NOPE',
    '/v1/perpumPublic/ticker',
    '/v1/perpumPublic/ticker?instrument=btc',
    '/v1/perpumPublic/ticker?instrument=BTCUSDT',
    '/v1/perpumPublic/depth?base=NOPE',
    '/v1/perpumPublic/depth',
    '/v1/perpumPublic/depth?base=btc',
    '/v1/perpumPublic/depth?base=BTCUSDT',
    '/v1/perpum/fundingRate?instrument=NOPE',
    '/v1/perpum/fundingRate',
    '/v1/perpum/fundingRate?instrument=BTC_USDC',
    '/v1/perpum/instrumentList?symbols=BTC,ETH',
    '/v1/perpum/instrumentList',
    '/v1/perpumPublic/nope',
    '/v1/perpum/instruments?name=AVGO',
    '/v1/perpumPublic/depth?base=AVGO',
    '/v1/perpum/fundingRate?instrument=AVGO',
  ];
  for (const c of calls) {
    const r = await get(c);
    const d = json(r);
    const summary = d === undefined ? r.body.slice(0, 160) : { code: d.code, msg: d.msg, dataType: Array.isArray(d.data) ? `array ${d.data.length}` : typeof d.data, first: JSON.stringify(Array.isArray(d.data) ? d.data[0] : d.data)?.slice(0, 100) };
    log('error', { call: c, status: r.status, contentType: r.headers['content-type'], retryAfter: r.headers['retry-after'], summary });
    await sleep(400);
  }
}

async function clock() {
  const offsets = [];
  const tsAge = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get('/v1/perpumPublic/ticker?instrument=BTC');
    const after = Date.now();
    const server = Date.parse(r.headers.date);
    offsets.push(server - (before + after) / 2);
    await sleep(700);
  }
  for (let i = 0; i < 5; i++) {
    const r = await get('/v1/perpumPublic/tickers');
    const ts = Math.max(...json(r).data.map((t) => t.ts));
    tsAge.push(r.at - ts);
    await sleep(1000);
  }
  log('clock', { dateHeaderMinusLocalMs: stats(offsets), note: 'Date has 1 s resolution', tickersArrivalMinusNewestTsMs: stats(tsAge) });
}

// Last prices against Binance USD-M on every shared contract, to find a price scale or a different token, and the touch of two books against Binance.
async function binance() {
  const tick = json(await get('/v1/perpumPublic/tickers')).data;
  const bx = await (await fetch('https://fapi.binance.com/fapi/v1/ticker/price')).json();
  const bmap = new Map(bx.map((x) => [x.symbol, Number(x.price)]));
  const rows = tick.filter((t) => t.quote_coin === 'usdt' && bmap.has(t.name)).map((t) => ({ name: t.name, coinw: t.last_price, binance: bmap.get(t.name), ppm: (t.last_price / bmap.get(t.name) - 1) * 1e6 }));
  log('binance_prices', { shared: rows.length, absDiffPpm: stats(rows.map((r) => Math.abs(r.ppm))), beyond5pct: rows.filter((r) => Math.abs(r.ppm) > 50_000).map((r) => `${r.name} ${r.coinw} ${r.binance}`), picks: rows.filter((r) => ['BTCUSDT', '1000PEPEUSDT', 'ANTHROPICUSDT'].includes(r.name)) });
  for (let i = 0; i < 3; i++) {
    const [c, b] = await Promise.all([get('/v1/perpumPublic/depth?base=BTC'), fetch('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=20').then((r) => r.json())]);
    const d = json(c).data;
    log('binance_touch', { coinwBid: d.bids[0], coinwAsk: d.asks[0], binanceBid: b.bids[0], binanceAsk: b.asks[0], sameBidPrice: d.bids[0].p === Number(b.bids[0][0]), sameAskPrice: d.asks[0].p === Number(b.asks[0][0]) });
    await sleep(1500);
  }
}

const modes = { latency, catalog, anchor, funding, book, errors, clock, binance };
const mode = process.argv[2];
if (!modes[mode]) {
  console.log(`usage: rest-probe.mjs ${Object.keys(modes).join('|')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
keepAlive.destroy();
