// Kinesis REST probe: the documented client API refusal, the undocumented web app catalog and depth calls, latency, a one hertz depth poll, every pair's book shape, error shapes and the clock offset.
// Public, unauthenticated and read-only. No API key, no account, no order.
// Kinesis publishes no public rate limit, so every mode sends at most 2 requests in any one second, most of the time one.
// Run from server/: node ../scripts/probes/venues/kinesis/rest-probe.mjs [main|books|poll|all]
//   main   host and latency, documented API refusal, catalog, fee call, CCXT check, errors, trendlines and OHLC, clock, about 30 s
//   books  one depth call per listed pair at 2 per second, level counts, order and one-sided books, about 85 s
//   poll   60 depth calls on KAU_C1USD one second apart, reply time and how often the touch changes, about 65 s
//   all    all three
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/kinesis/rest.md and docs/profiles/kinesis/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import https from 'node:https';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const WEB_API = 'https://fastapi.kinesis.money/api'; // what kms.kinesis.money calls, from its bundle config `defaultApiRoot`
const CLIENT_API = 'https://client-api.kinesis.money'; // the documented, key-signed API of github.com/bullioncapital/kinesis-api
const OUT = process.env.PROBE_OUT_DIR;
const MODE = process.argv[2] ?? 'main';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const warm = new https.Agent({ keepAlive: true, maxSockets: 1 });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// Resolves with status, selected headers, body text, total ms and time to first byte.
function get(url, agent = warm) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let ttfb = null;
    const req = https.get(url, { agent, headers: { 'user-agent': 'arbitrage-observatory-probe', accept: 'application/json' } }, (res) => {
      ttfb = performance.now() - t0;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), ms: performance.now() - t0, ttfb }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: performance.now() - t0 }));
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
  });
}

const pick = (h) => Object.fromEntries(Object.entries(h ?? {}).filter(([k]) => /^(server|date|content-type|content-length|cache-control|age|etag|retry-after|x-rate|ratelimit|x-ratelimit|via|x-cache|cf-ray|x-amz)/i.test(k)));
const ms = (x) => Math.round(x);
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: ms(s[0]), median: ms(q(0.5)), p90: ms(q(0.9)), max: ms(s[s.length - 1]) };
};

async function main() {
  const host = new URL(WEB_API).hostname;
  const t0 = performance.now();
  const addrs = await dns.resolve4(host).catch((e) => [e.code]);
  log('dns', { host, addrs, ms: ms(performance.now() - t0) });
  const cname = await dns.resolveCname('client-api.kinesis.money').catch((e) => [e.code]);
  log('dns', { host: 'client-api.kinesis.money', cname, a: await dns.resolve4('client-api.kinesis.money').catch((e) => [e.code]) });

  // Cold requests open a new TLS connection each time, warm requests reuse one.
  const cold = [];
  for (let i = 0; i < 3; i++) {
    const r = await get(`${WEB_API}/exchange/depth/KAU_C1USD`, false);
    cold.push(r.ms);
    await sleep(1000);
  }
  const warmMs = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${WEB_API}/exchange/depth/KAU_C1USD`);
    warmMs.push(r.ms);
    await sleep(1000);
  }
  log('latency', { url: `${WEB_API}/exchange/depth/KAU_C1USD`, cold: cold.map(ms), warm: warmMs.map(ms) });

  // The documented API signs every call with x-api-key, x-nonce and x-signature, so an unsigned call shows what the public gets.
  for (const path of ['/v1/exchange/pairs', '/v1/exchange/mid-price/KAU_USD', '/v1/exchange/depth/KAU_USD']) {
    const r = await get(CLIENT_API + path, false);
    log('client_api_unsigned', { path, status: r.status, body: r.body?.slice(0, 120) });
    await sleep(600);
  }

  const sym = await get(`${WEB_API}/tradeable-symbols/public?includeOrderRange=true&includeKvtPairs=true`);
  keep('tradeable-symbols.json', sym.body);
  const pairs = JSON.parse(sym.body);
  const byQuote = {};
  const baseTypes = {};
  for (const p of pairs) {
    byQuote[p.quote.code] = (byQuote[p.quote.code] ?? 0) + 1;
    baseTypes[p.base.type] = (baseTypes[p.base.type] ?? 0) + 1;
  }
  log('catalog', {
    status: sym.status, bytes: sym.body.length, ms: ms(sym.ms), pairs: pairs.length, keys: Object.keys(pairs[0]), byQuote, baseTypes,
    canBuyFalse: pairs.filter((p) => !p.canBuy).length, canSellFalse: pairs.filter((p) => !p.canSell).length,
    feeIsQuote: pairs.filter((p) => p.fee === p.quote.code).length,
    idIsBaseUnderscoreQuote: pairs.filter((p) => p.id === `${p.base.code}_${p.quote.code}`).length,
    derivativeLike: pairs.filter((p) => /PERP|SWAP|FUT|-\d{6}/i.test(p.id)).map((p) => p.id),
    first: pairs[0],
  });
  const unsignedPrivate = await get(`${WEB_API}/tradeable-symbols?includeOrderRange=true&includeKvtPairs=true`);
  log('catalog_without_public_suffix', { status: unsignedPrivate.status, body: unsignedPrivate.body.slice(0, 120) });
  await sleep(600);

  const settings = await get(`${WEB_API}/exchange/symbol-pair-settings/all`);
  const rows = JSON.parse(settings.body);
  const listed = new Set(pairs.map((p) => p.id));
  log('pair_settings', { status: settings.status, rows: rows.length, notInPublicList: rows.filter((r) => !listed.has(r.symbolId)).length, sample: rows[0] });
  await sleep(600);

  const fee = await get(`${WEB_API}/exchange/fees/trade`);
  log('trade_fee_call', { status: fee.status, body: fee.body, headers: pick(fee.headers) });
  await sleep(600);

  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, kinesisLike: ccxt.exchanges.filter((x) => /kin|kau|kms/i.test(x)) });

  for (const path of ['/exchange/depth/NOPE_C1USD', '/exchange/depth/kau_c1usd', '/exchange/depth/KAU-C1USD', '/exchange/nope', '/market-data-api/fx-rate/symbols', '/exchange/mid-price/KAU_C1USD']) {
    const r = await get(WEB_API + path);
    log('error_shape', { path, status: r.status, body: r.body?.slice(0, 140) });
    await sleep(600);
  }

  const tl = await get(`${WEB_API}/market-data/trendlines?symbolIds=KAU_C1USD,KAG_C1USD&timeFrame=5&fromDate=${new Date(Date.now() - 3_600_000).toISOString()}&toDate=${new Date().toISOString()}`);
  const tlj = JSON.parse(tl.body);
  log('trendlines', { status: tl.status, keys: Object.keys(tlj), points: Object.values(tlj).map((a) => a.length), last: Object.values(tlj).map((a) => a.at(-1)) });
  await sleep(600);

  // The chart's call, with the parameters the bundle's getBars sends.
  const ohlc = await get(`${WEB_API}/market-data/ohlc/v2?symbolId=KAU_C1USD&fromDate=${new Date(Date.now() - 3_600_000).toISOString()}&to=${new Date().toISOString()}&timeFrame=5&requiredCount=5&includeOlderDataPresentFlag=true`);
  let ohlcSummary = ohlc.body.slice(0, 200);
  try {
    const j = JSON.parse(ohlc.body);
    ohlcSummary = { keys: Object.keys(j), bars: j.ohlcData?.length, last: j.ohlcData?.[0], active: j.ohlcCurrentActive };
  } catch {}
  log('ohlc', { status: ohlc.status, ms: ms(ohlc.ms), summary: ohlcSummary });
  await sleep(600);

  // Clock: the Date header has one second resolution, so the offset is bracketed by the request's send and receive times.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const sent = Date.now();
    const r = await get(`${WEB_API}/exchange/fees/trade`);
    const recv = Date.now();
    const server = Date.parse(r.headers.date);
    offsets.push({ sent, recv, server, lowerMs: server - recv, upperMs: server + 999 - sent });
    await sleep(1100);
  }
  log('clock', { lowerMs: Math.max(...offsets.map((o) => o.lowerMs)), upperMs: Math.min(...offsets.map((o) => o.upperMs)), headers: pick((await get(`${WEB_API}/exchange/depth/KAU_C1USD`)).headers) });
}

function touchOf(book) {
  return { bid: book.buy[0]?.price ?? null, bidAmt: book.buy[0]?.amount ?? null, ask: book.sell[0]?.price ?? null, askAmt: book.sell[0]?.amount ?? null };
}

async function books() {
  const sym = await get(`${WEB_API}/tradeable-symbols/public?includeOrderRange=true&includeKvtPairs=true`);
  const pairs = JSON.parse(sym.body).map((p) => p.id);
  const levels = { buy: [], sell: [] };
  const maxDecimals = { price: 0, amount: 0 };
  let empty = 0, oneSided = [], crossed = [], badOrder = [], numberTypes = new Set(), owned = new Set(), dupPrices = 0, times = [], bytes = [];
  const examples = {};
  for (const id of pairs) {
    const r = await get(`${WEB_API}/exchange/depth/${id}`);
    times.push(r.ms);
    bytes.push(r.body.length);
    const b = JSON.parse(r.body);
    if (b.symbolId !== id) log('symbol_mismatch', { id, got: b.symbolId });
    levels.buy.push(b.buy.length);
    levels.sell.push(b.sell.length);
    if (!b.buy.length && !b.sell.length) empty++;
    else if (!b.buy.length || !b.sell.length) oneSided.push(`${id}:${b.buy.length}/${b.sell.length}`);
    if (b.buy.length && b.sell.length && b.buy[0].price >= b.sell[0].price) crossed.push(id);
    if (!b.buy.every((x, i) => i === 0 || b.buy[i - 1].price > x.price) || !b.sell.every((x, i) => i === 0 || b.sell[i - 1].price < x.price)) badOrder.push(id);
    for (const x of [...b.buy, ...b.sell]) {
      numberTypes.add(`${typeof x.price}/${typeof x.amount}`);
      maxDecimals.price = Math.max(maxDecimals.price, (String(x.price).split('.')[1] ?? '').length);
      maxDecimals.amount = Math.max(maxDecimals.amount, (String(x.amount).split('.')[1] ?? '').length);
      owned.add(x.ownedAmount);
    }
    dupPrices += b.buy.length - new Set(b.buy.map((x) => x.price)).size + b.sell.length - new Set(b.sell.map((x) => x.price)).size;
    if (['KAU_C1USD', 'KAG_C1USD', 'BTC_C1USD', 'IMX_C1USD'].includes(id)) examples[id] = { buy: b.buy.length, sell: b.sell.length, touch: touchOf(b), spreadPpm: b.buy.length && b.sell.length ? Math.round(((b.sell[0].price - b.buy[0].price) / b.buy[0].price) * 1e6) : null };
    await sleep(500);
  }
  const hist = (a) => ({ min: Math.min(...a), median: [...a].sort((x, y) => x - y)[a.length >> 1], max: Math.max(...a), over20: a.filter((x) => x >= 20).length, zero: a.filter((x) => x === 0).length });
  log('books', { pairs: pairs.length, buyLevels: hist(levels.buy), sellLevels: hist(levels.sell), empty, oneSided: oneSided.length, oneSidedList: oneSided.slice(0, 30), crossed, badOrder, numberTypes: [...numberTypes], maxDecimals, ownedAmount: [...owned], dupPrices, time: stats(times), bytes: { min: Math.min(...bytes), max: Math.max(...bytes) } });
  log('book_examples', examples);
}

async function poll() {
  const url = `${WEB_API}/exchange/depth/KAU_C1USD`;
  const times = [];
  let prev = null, touchChanges = 0, bookChanges = 0, prevBody = null;
  const headerSet = new Set();
  for (let i = 0; i < 60; i++) {
    const t = Date.now();
    const r = await get(url);
    times.push(r.ms);
    headerSet.add(JSON.stringify(pick(r.headers)).replace(/"date":"[^"]+",?/, ''));
    const b = JSON.parse(r.body);
    const touch = JSON.stringify(touchOf(b));
    if (prev !== null && touch !== prev) touchChanges++;
    if (prevBody !== null && r.body !== prevBody) bookChanges++;
    prev = touch;
    prevBody = r.body;
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  log('poll', { url, time: stats(times), touchChanges, bookChanges, of: 59, headerVariants: [...headerSet].slice(0, 3) });
}

if (MODE === 'main' || MODE === 'all') await main();
if (MODE === 'books' || MODE === 'all') await books();
if (MODE === 'poll' || MODE === 'all') await poll();
warm.destroy();
