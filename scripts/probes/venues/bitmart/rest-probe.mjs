// BitMart futures REST probe: host and latency, the contract catalog against CCXT, the bulk anchor calls and how often their numbers change, funding history, the REST book, rate limit headers, error shapes and the server clock.
// Public, unauthenticated and read-only.
// Every mode stays far inside the documented 12 requests per 2 s per IP per endpoint, at one request per second per endpoint at most.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitmart/rest-probe.mjs [catalog|anchor|book|limits]
//   catalog  every contract by family, status and 24 h volume, the funding-rate-v2 set, REST books of live and silent contracts, and CCXT 4.5.68 loadMarkets, about 25 s
//   anchor   contract details and funding-rate-v2 polled once a second for 60 s, the mark price kline every 2 s, funding history, about 70 s
//   book     the REST depth call, level order, the cumulative column, repeat reads, about 10 s
//   limits   DNS, cold and warm request time, rate limit headers, error bodies and the server clock offset, about 15 s
// Recorded in docs/profiles/bitmart/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api-cloud-v2.bitmart.com';
const SPOT_API = 'https://api-cloud.bitmart.com';
const WATCH = ['BTCUSDT', 'ETHUSDT', 'FOLKSUSDT', 'ASTEROIDETHUSDT', 'BTCUSD', 'BTCUSDC', 'MUUSDT', 'THETAUSDT'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);
const stats = (xs) => (xs.length ? { n: xs.length, min: Math.min(...xs), p50: pct(xs, 0.5), p90: pct(xs, 0.9), max: Math.max(...xs) } : { n: 0 });
const group = (xs, f) => xs.reduce((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});
const HEADERS = ['x-bm-ratelimit-limit', 'x-bm-ratelimit-remaining', 'x-bm-ratelimit-reset', 'x-bm-ratelimit-mode', 'retry-after', 'cf-cache-status', 'cache-control', 'age', 'date', 'content-type'];

async function get(url) {
  const t0 = performance.now();
  const r = await fetch(url);
  const text = await r.text();
  const ms = Math.round(performance.now() - t0);
  const headers = Object.fromEntries(HEADERS.map((h) => [h, r.headers.get(h)]).filter(([, v]) => v !== null));
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: r.status, ms, bytes: text.length, headers, body, arrived: Date.now() };
}

const family = (r) => (r.quote_currency === 'USD' ? 'coin-M USD' : `${r.quote_currency}-M`) + (r.tradfi_info ? ' tradfi' : ' crypto');

async function catalog() {
  const d = await get(`${API}/contract/public/details`);
  const rows = d.body.data.symbols;
  const trading = rows.filter((r) => r.status === 'Trading');
  const live = (r) => Number(r.volume_24h) > 0;
  const f2 = await get(`${API}/contract/public/funding-rate-v2`);
  const f2Set = new Set(f2.body.data.list.map((r) => r.symbol));
  log('details', {
    status: d.status,
    bytes: d.bytes,
    ms: d.ms,
    rows: rows.length,
    byStatusType: group(rows, (r) => `${r.status} type ${r.product_type} ${r.quote_currency}`),
    tradingByFamily: group(trading, family),
    tradingWithVolumeByFamily: group(trading.filter(live), family),
    tradingZeroVolume: trading.filter((r) => !live(r)).length,
    tradingWithPastDelistTime: group(trading.filter((r) => r.delist_time > 0), (r) => `${new Date(r.delist_time * 1000).toISOString()} ${live(r) ? 'volume' : 'zero volume'}`),
    tradingIntervals: group(trading, (r) => `${r.funding_interval_hours}h ${live(r) ? 'volume' : 'zero volume'}`),
    indexNameDiffers: rows.filter((r) => r.index_name !== r.symbol).length,
    keys: Object.keys(rows[0]),
  });
  log('funding-rate-v2 set', {
    status: f2.status,
    bytes: f2.bytes,
    rows: f2Set.size,
    ofTradingWithVolume: trading.filter(live).filter((r) => f2Set.has(r.symbol)).length,
    tradingWithVolumeMissing: trading.filter(live).filter((r) => !f2Set.has(r.symbol)).map((r) => r.symbol),
    presentButZeroVolume: trading.filter((r) => !live(r) && f2Set.has(r.symbol)).map((r) => r.symbol),
  });
  const silent = trading.filter((r) => !live(r));
  const sample = [...silent.filter((r) => !r.tradfi_info).slice(0, 6), ...silent.filter((r) => r.tradfi_info).slice(0, 3), ...trading.filter(live).slice(0, 3)];
  const books = [];
  for (const r of sample) {
    const b = await get(`${API}/contract/public/depth?symbol=${r.symbol}`);
    books.push(`${r.symbol} ${live(r) ? 'volume' : 'zero'} ${r.tradfi_info ? r.tradfi_info.market_group + '/' + r.tradfi_info.market_session_status : 'crypto'}: bids ${b.body.data?.bids?.length ?? 'null'} asks ${b.body.data?.asks?.length ?? 'null'}`);
    await sleep(350);
  }
  log('rest books of zero volume Trading contracts', { books });

  const ccxt = require('ccxt');
  const ex = new ccxt.bitmart();
  const t0 = performance.now();
  await ex.loadMarkets();
  const swaps = Object.values(ex.markets).filter((m) => m.swap);
  const byId = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  log('ccxt', {
    version: ccxt.version,
    ms: Math.round(performance.now() - t0),
    swaps: swaps.length,
    activeSwaps: swaps.filter((m) => m.active).length,
    activeByFamily: group(swaps.filter((m) => m.active), (m) => `${m.quote} settle ${m.settle} linear ${m.linear} inverse ${m.inverse}`),
    activeWithZeroVolume: swaps.filter((m) => m.active && !live(byId[m.id])).length,
    idEqualsSymbol: swaps.filter((m) => byId[m.id]).length,
    contractSizeEqualsDetails: swaps.filter((m) => m.contractSize === Number(byId[m.id]?.contract_size)).length,
    taker: group(swaps, (m) => m.taker),
    maker: group(swaps, (m) => m.maker),
    feeSide: group(swaps, (m) => `tierBased ${m.tierBased} percentage ${m.percentage}`),
    examples: ['BTC/USDT:USDT', 'BTC/USD:USDT', 'BTC/USDC:USDT', 'ETH/USD:USDT', 'THETA/USDT:USDT'].map((s) => {
      const m = ex.markets[s];
      return m ? `${s} id ${m.id} active ${m.active} contractSize ${m.contractSize} linear ${m.linear} settle ${m.settle} taker ${m.taker}` : `${s} absent`;
    }),
    activeBasesListedTwice: Object.entries(group(swaps.filter((m) => m.active), (m) => m.base)).filter(([, n]) => n > 1),
  });
}

async function anchor() {
  const polls = [];
  const f2polls = [];
  const marks = [];
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const tick = Date.now();
    const d = await get(`${API}/contract/public/details`);
    polls.push({ ms: d.ms, bytes: d.bytes, status: d.status, rows: Object.fromEntries(d.body.data.symbols.filter((r) => WATCH.includes(r.symbol)).map((r) => [r.symbol, r])) });
    const f = await get(`${API}/contract/public/funding-rate-v2`);
    f2polls.push({ ms: f.ms, bytes: f.bytes, status: f.status, rows: Object.fromEntries(f.body.data.list.filter((r) => WATCH.includes(r.symbol)).map((r) => [r.symbol, r])), arrived: f.arrived });
    if (i % 2 === 0) {
      const k = await get(`${API}/contract/public/markprice-kline?symbol=BTCUSDT&step=1&start_time=${Math.floor(Date.now() / 1000) - 120}&end_time=${Math.floor(Date.now() / 1000)}`);
      const last = k.body.data?.at(-1);
      marks.push({ ms: k.ms, close: last?.close_price, ts: last?.timestamp });
    }
    const wait = tick + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  }
  log('details poll', { polls: polls.length, statuses: group(polls, (p) => p.status), ms: stats(polls.map((p) => p.ms)), bytes: stats(polls.map((p) => p.bytes)), overOneSecond: polls.filter((p) => p.ms > 1000).length, wallSeconds: Math.round((Date.now() - t0) / 1000) });
  log('funding-rate-v2 poll', { polls: f2polls.length, statuses: group(f2polls, (p) => p.status), ms: stats(f2polls.map((p) => p.ms)), bytes: stats(f2polls.map((p) => p.bytes)) });
  const changes = (xs, f) => xs.slice(1).filter((x, i) => f(x) !== f(xs[i])).length;
  for (const s of WATCH) {
    const rows = polls.map((p) => p.rows[s]).filter(Boolean);
    const f2 = f2polls.map((p) => p.rows[s]).filter(Boolean);
    log(`watch ${s}`, {
      detailsRows: rows.length,
      indexChanges: changes(rows, (r) => r.index_price),
      lastPriceChanges: changes(rows, (r) => r.last_price),
      fundingRateChanges: changes(rows, (r) => r.funding_rate),
      expectedChanges: changes(rows, (r) => r.expected_funding_rate),
      fundingTime: [...new Set(rows.map((r) => r.funding_time))],
      interval: [...new Set(rows.map((r) => r.funding_interval_hours))],
      first: rows[0] ? { index: rows[0].index_price, last: rows[0].last_price, rate: rows[0].funding_rate, expected: rows[0].expected_funding_rate, cs: rows[0].contract_size } : null,
      f2Rows: f2.length,
      f2ExpectedChanges: changes(f2, (r) => r.expected_rate),
      f2RateChanges: changes(f2, (r) => r.rate_value),
      f2TimestampAgeMs: stats(f2polls.filter((p) => p.rows[s]).map((p) => p.arrived - p.rows[s].timestamp)),
      f2First: f2[0] ?? null,
    });
  }
  log('mark kline BTCUSDT every 2 s', { reads: marks.length, ms: stats(marks.map((m) => m.ms)), closeChanges: changes(marks, (m) => m.close), sample: marks.slice(0, 3) });
  for (const s of ['BTCUSDT', 'ETHUSDT', 'ASTEROIDETHUSDT', 'BTCUSD', 'BTCUSDC']) {
    const h = await get(`${API}/contract/public/funding-rate-history?symbol=${s}&limit=6`);
    const c = await get(`${API}/contract/public/funding-rate?symbol=${s}`);
    const list = h.body.data?.list ?? [];
    log(`funding ${s}`, {
      history: list.map((r) => `${new Date(Number(r.funding_time)).toISOString()} ${r.funding_rate}`),
      current: c.body.data,
      rateValueEqualsLastSettled: list[0] ? Number(list[0].funding_rate) === Number(c.body.data.rate_value) : null,
    });
    await sleep(400);
  }
}

async function book() {
  for (const s of ['BTCUSDT', 'ETHUSDT', 'ASTEROIDETHUSDT', 'BTCUSD', 'THETAUSDT']) {
    const b = await get(`${API}/contract/public/depth?symbol=${s}`);
    const d = b.body.data;
    const bids = d?.bids ?? [];
    const asks = d?.asks ?? [];
    const desc = bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]));
    const asc = asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]));
    let cum = 0;
    const cumOk = bids.every((l) => ((cum += Number(l[1])), Math.abs(cum - Number(l[2])) < 1e-9 * Math.max(1, cum)));
    log(`depth ${s}`, { status: b.status, ms: b.ms, bytes: b.bytes, bids: d?.bids === null ? 'null' : bids.length, asks: d?.asks === null ? 'null' : asks.length, bidsDescending: desc, asksAscending: asc, thirdColumnIsCumulative: cumOk, top: [bids[0], asks[0]], ageMs: d ? b.arrived - d.timestamp : null, headers: b.headers });
    await sleep(400);
  }
  const reads = [];
  for (let i = 0; i < 6; i++) {
    const b = await get(`${API}/contract/public/depth?symbol=BTCUSDT`);
    reads.push({ ts: b.body.data.timestamp, top: `${b.body.data.bids[0][0]}/${b.body.data.asks[0][0]}`, ms: b.ms });
    await sleep(500);
  }
  log('depth BTCUSDT repeat reads 500 ms apart', { reads });
  const limited = await get(`${API}/contract/public/depth?symbol=BTCUSDT&limit=5`);
  log('depth with limit=5', { status: limited.status, bids: limited.body.data?.bids?.length });
}

async function limits() {
  for (const h of ['api-cloud-v2.bitmart.com', 'openapi-ws-v2.bitmart.com', 'api-cloud.bitmart.com']) {
    log('dns', { host: h, addresses: (await lookup(h, { all: true })).map((a) => a.address) });
  }
  const cold = await get(`${API}/contract/public/funding-rate?symbol=BTCUSDT`);
  const warm = [];
  for (let i = 0; i < 8; i++) {
    warm.push((await get(`${API}/contract/public/funding-rate?symbol=BTCUSDT`)).ms);
    await sleep(300);
  }
  log('latency funding-rate BTCUSDT', { coldMs: cold.ms, warm: stats(warm), headers: cold.headers });
  const cases = [
    ['depth unknown symbol', `${API}/contract/public/depth?symbol=NOPEUSDT`],
    ['depth no symbol', `${API}/contract/public/depth`],
    ['depth delisted symbol', `${API}/contract/public/depth?symbol=LUNAUSDT`],
    ['funding-rate no symbol', `${API}/contract/public/funding-rate`],
    ['funding-rate unknown', `${API}/contract/public/funding-rate?symbol=NOPEUSDT`],
    ['funding-rate zero volume Trading', `${API}/contract/public/funding-rate?symbol=THETAUSDT`],
    ['details unknown', `${API}/contract/public/details?symbol=NOPEUSDT`],
    ['markprice-kline bad step', `${API}/contract/public/markprice-kline?symbol=BTCUSDT&step=2&start_time=1790000000&end_time=1790000600`],
    ['v1 tickers', `${API}/contract/v1/tickers`],
    ['unknown path', `${API}/contract/public/nope`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error', { name, status: r.status, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 260), limitHeaders: [r.headers['x-bm-ratelimit-limit'], r.headers['x-bm-ratelimit-remaining'], r.headers['x-bm-ratelimit-reset']] });
    await sleep(400);
  }
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${SPOT_API}/system/time`);
    const t1 = Date.now();
    offsets.push({ rtt: t1 - t0, offset: r.body?.data?.server_time - Math.round((t0 + t1) / 2) });
    await sleep(300);
  }
  log('clock via spot system/time', { offsets });
  const f = await get(`${API}/contract/public/funding-rate?symbol=BTCUSDT`);
  log('clock via futures reply timestamp', { replyTimestampMinusArrival: f.body.data.timestamp - f.arrived, ms: f.ms });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, book, limits };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
