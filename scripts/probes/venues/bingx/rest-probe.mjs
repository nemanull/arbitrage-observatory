// BingX perpetual swap REST probe: host and latency, the catalog against CCXT, the bulk anchor call and how often its numbers change, funding history, the REST book, rate limit headers, error shapes and the server clock.
// Public, unauthenticated and read-only.
// Every mode stays far inside the documented 500 requests per 10 s per IP.
// Run from server/: node ../scripts/probes/venues/bingx/rest-probe.mjs [catalog|anchor|book|limits]
//   catalog  USDT-M and USDC-M contracts, coin-M contracts, the premium index set, and CCXT 4.5.68 loadMarkets, about 5 s
//   anchor   the bulk premiumIndex polled once a second for 60 s, the single symbol call, funding history, about 70 s
//   book     the REST depth call at every documented limit, level order, the bids and bidsCoin units, repeat reads, about 10 s
//   limits   cold and warm request time, rate limit headers, error bodies and the server clock offset, about 15 s
// Recorded in docs/profiles/bingx/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'https://open-api.bingx.com';
const API = `${HOST}/openApi`;
const WATCH = ['BTC-USDT', 'ETH-USDT', 'TURBO-USDT', 'AIINU-USDT', 'BTC-USDC', 'NCCOGOLD2USD-USDT'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);
const stats = (xs) => ({ n: xs.length, min: Math.min(...xs), p50: pct(xs, 0.5), p90: pct(xs, 0.9), max: Math.max(...xs) });

async function get(path, { raw = false } = {}) {
  const t0 = performance.now();
  const r = await fetch(`${API}${path}`);
  const text = await r.text();
  const ms = Math.round(performance.now() - t0);
  const headers = Object.fromEntries(['x-ratelimit-requests-remain', 'x-ratelimit-requests-expire', 'retry-after', 'x-cache', 'x-amz-cf-pop', 'age', 'cache-control', 'date'].map((h) => [h, r.headers.get(h)]));
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = raw ? text.slice(0, 300) : null;
  }
  return { status: r.status, ms, bytes: text.length, headers, body };
}

async function catalog() {
  const c = await get('/swap/v2/quote/contracts');
  const p = await get('/swap/v2/quote/premiumIndex');
  const cc = await get(`/cswap/v1/market/contracts?timestamp=${Date.now()}`);
  const ccBare = await get('/cswap/v1/market/contracts');
  const rows = c.body.data;
  const piSet = new Set(p.body.data.map((r) => r.symbol));
  const group = (xs, f) => xs.reduce((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});
  const apiOpen = (r) => r.apiStateOpen === 'true' && r.apiStateClose === 'true';
  log('contracts', {
    status: c.status,
    bytes: c.bytes,
    ms: c.ms,
    rows: rows.length,
    byStatusApiCurrency: group(rows, (r) => `status ${r.status} api ${apiOpen(r) ? 'open' : 'closed'} ${r.currency}`),
    tradFiPrefix: group(rows.filter((r) => /^NC(SK|CO|FX|SI)/.test(r.symbol)), (r) => `${r.symbol.slice(0, 4)} ${apiOpen(r) && r.status === 1 ? 'tradable' : 'not'}`),
    takerFeeRate: group(rows, (r) => r.takerFeeRate),
    makerFeeRate: group(rows, (r) => r.makerFeeRate),
    sizeField: group(rows, (r) => (r.size === String(r.tradeMinQuantity) ? 'size equals tradeMinQuantity' : 'differs')),
    displayNameDiffers: rows.filter((r) => r.displayName !== r.symbol).length,
    displayNameSamples: rows.filter((r) => r.displayName !== r.symbol && !r.symbol.startsWith('NC')).slice(0, 8).map((r) => `${r.symbol}=${r.displayName}`),
    withOffTimeCount: rows.filter((r) => r.offTime > 0).length,
    withOffTime: rows.filter((r) => r.offTime > 0).map((r) => `${r.symbol} ${new Date(r.offTime).toISOString()}`).slice(0, 20),
    withMaintainTime: rows.filter((r) => r.maintainTime > 0).length,
    status1ApiOpenMissingFromPremiumIndex: rows.filter((r) => r.status === 1 && apiOpen(r) && !piSet.has(r.symbol)).map((r) => r.symbol),
    status25InPremiumIndex: rows.filter((r) => r.status === 25 && piSet.has(r.symbol)).length,
    apiClosedInPremiumIndex: rows.filter((r) => !apiOpen(r) && piSet.has(r.symbol)).length,
  });
  log('coin_m_contracts', { withTimestamp: { status: cc.status, rows: cc.body?.data?.length, sample: cc.body?.data?.[0] }, bare: { status: ccBare.status, body: ccBare.body } });

  const t0 = Date.now();
  const ex = new ccxt.bingx();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.type === 'swap');
  const active = swaps.filter((m) => m.swap === true && m.active !== false);
  const byId = new Map(rows.map((r) => [r.symbol, r]));
  const bases = group(active, (m) => `${m.base}/${m.quote}`);
  const baseTwice = group(active, (m) => m.base);
  log('ccxt', {
    version: ccxt.version,
    loadMarketsMs: Date.now() - t0,
    markets: all.length,
    swaps: swaps.length,
    activeSwaps: active.length,
    activeBySettle: group(active, (m) => `${m.linear ? 'linear' : 'inverse'} ${m.settle}`),
    inactiveBySettle: group(swaps.filter((m) => m.active === false), (m) => `${m.linear ? 'linear' : 'inverse'} ${m.settle}`),
    activeWithStatus25: active.filter((m) => byId.get(m.id)?.status === 25).length,
    activeNotInPremiumIndex: active.filter((m) => !piSet.has(m.id)).length,
    activeTradFi: active.filter((m) => /^NC(SK|CO|FX|SI)/.test(m.id)).length,
    takerMakerContractSize: group(active, (m) => `taker ${m.taker} maker ${m.maker} contractSize ${m.contractSize}`),
    idEqualsSymbolField: active.filter((m) => byId.get(m.id)?.symbol === m.id).length,
    basesListedTwice: Object.values(baseTwice).filter((n) => n > 1).length,
    pairsListedTwice: Object.values(bases).filter((n) => n > 1).length,
    btcUsdt: (({ id, symbol, base, quote, settle, linear, contractSize, active, precision }) => ({ id, symbol, base, quote, settle, linear, contractSize, active, precision }))(markets['BTC/USDT:USDT']),
    scaledBases: active.filter((m) => /^(1000|1M|10000)/.test(m.base)).map((m) => m.base).slice(0, 20),
    spotActive: all.filter((m) => m.spot && m.active !== false).length,
  });
}

async function anchor() {
  const polls = [];
  let last = null;
  const all = new Map(); // symbol to the per poll [index, mark, rate] strings, for the A-B-A check
  const series = new Map(WATCH.map((s) => [s, []]));
  let first = null;
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    const t = Date.now();
    const r = await get('/swap/v2/quote/premiumIndex');
    polls.push({ ms: r.ms, bytes: r.bytes, status: r.status, remain: r.headers['x-ratelimit-requests-remain'], cache: r.headers['x-cache'] });
    if (r.status === 200) {
      first ??= r.body.data;
      last = r.body.data;
      for (const row of r.body.data) {
        if (series.has(row.symbol)) series.get(row.symbol).push(row);
        if (!all.has(row.symbol)) all.set(row.symbol, []);
        all.get(row.symbol).push([row.indexPrice, row.markPrice, row.lastFundingRate]);
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  log('anchor_polls', { ms: stats(polls.map((p) => p.ms)), bytes: stats(polls.map((p) => p.bytes)), statuses: [...new Set(polls.map((p) => p.status))], rateRemainMin: Math.min(...polls.map((p) => +p.remain)), cache: [...new Set(polls.map((p) => p.cache))], rows: first.length });
  const changes = (xs, f) => xs.slice(1).filter((x, i) => f(x) !== f(xs[i])).length;
  for (const [s, xs] of series) {
    log('anchor_changes', { symbol: s, polls: xs.length, indexChanges: changes(xs, (x) => x.indexPrice), markChanges: changes(xs, (x) => x.markPrice), rateChanges: changes(xs, (x) => x.lastFundingRate), updateTimeValues: [...new Set(xs.map((x) => x.updateTime))], nextFundingTime: [...new Set(xs.map((x) => x.nextFundingTime))], last: xs.at(-1) });
  }
  // A value that returns on the next poll to the one before it, A then B then A. A lagging replica and a price bouncing between two ticks both produce it.
  const reversals = (xs, k) => xs.slice(2).filter((x, i) => x[k] === xs[i][k] && x[k] !== xs[i + 1][k]).length;
  const rev = [0, 1, 2].map((k) => [...all.values()].map((xs) => reversals(xs, k)));
  log('anchor_reversals', {
    rows: all.size,
    rowsWithIndexReversal: rev[0].filter((n) => n > 0).length,
    rowsWithMarkReversal: rev[1].filter((n) => n > 0).length,
    rowsWithRateReversal: rev[2].filter((n) => n > 0).length,
    indexReversals: rev[0].reduce((a, n) => a + n, 0),
    markReversals: rev[1].reduce((a, n) => a + n, 0),
    rateReversals: rev[2].reduce((a, n) => a + n, 0),
    watched: WATCH.map((s) => `${s} index ${reversals(all.get(s) ?? [], 0)} mark ${reversals(all.get(s) ?? [], 1)} rate ${reversals(all.get(s) ?? [], 2)} rateValues ${[...new Set((all.get(s) ?? []).map((x) => x[2]))].join('/')}`),
  });
  const nowMs = Date.now();
  const premium = first.map((r) => ((+r.markPrice - +r.indexPrice) / +r.indexPrice) * 1e6);
  const atCap = first.filter((r) => Math.abs(+r.lastFundingRate) >= Math.abs(+r.maxFundingRate) - 1e-12);
  log('anchor_shape', {
    fields: Object.keys(first[0]),
    markZero: first.filter((r) => +r.markPrice === 0).length,
    indexZero: first.filter((r) => +r.indexPrice === 0).length,
    capByValue: first.reduce((a, r) => ((a[`±${+r.maxFundingRate}`] = (a[`±${+r.maxFundingRate}`] ?? 0) + 1), a), {}),
    capSymmetric: first.filter((r) => +r.minFundingRate === -r.maxFundingRate).length,
    intervalHours: first.reduce((a, r) => ((a[r.fundingIntervalHours] = (a[r.fundingIntervalHours] ?? 0) + 1), a), {}),
    nextFundingTimeAbsolute: first.filter((r) => r.nextFundingTime > nowMs).length,
    nextFundingTimeValues: [...new Set(first.map((r) => new Date(r.nextFundingTime).toISOString()))],
    updateTimeValues: [...new Set(first.map((r) => new Date(r.updateTime).toISOString()))],
    premiumPpm: { p1: Math.round(pct(premium, 0.01)), p50: Math.round(pct(premium, 0.5)), p99: Math.round(pct(premium, 0.99)), absOver1pct: premium.filter((x) => Math.abs(x) > 10_000).length },
    rateAtCap: atCap.map((r) => `${r.symbol} ${r.lastFundingRate} cap ${r.maxFundingRate}`).slice(0, 8),
    rateAtCapCount: atCap.length,
    premiumOver1pct: first.filter((r) => Math.abs(+r.markPrice / +r.indexPrice - 1) > 0.01).map((r) => `${r.symbol} mark ${r.markPrice} index ${r.indexPrice}`),
  });
  const lastBy = new Map(last.map((r) => [r.symbol, r]));
  const moved = (f) => first.filter((r) => lastBy.has(r.symbol) && f(r) !== f(lastBy.get(r.symbol))).length;
  log('anchor_window_changes', { rows: first.length, indexMoved: moved((r) => r.indexPrice), markMoved: moved((r) => r.markPrice), rateMoved: moved((r) => r.lastFundingRate), rateMovedUsdc: first.filter((r) => r.symbol.endsWith('-USDC') && lastBy.get(r.symbol)?.lastFundingRate !== r.lastFundingRate).length, usdcRows: first.filter((r) => r.symbol.endsWith('-USDC')).length });
  // The published rate set beside the last settled rate on an even spread of contracts.
  const sample = first.filter((_, i) => i % Math.floor(first.length / 20) === 0).slice(0, 20);
  let equalLastSettled = 0;
  const unequal = [];
  for (const r of sample) {
    const h = await get(`/swap/v2/quote/fundingRate?symbol=${r.symbol}&limit=1`);
    const settled = h.body?.data?.[0];
    const pub = lastBy.get(r.symbol)?.lastFundingRate;
    if (settled && +settled.fundingRate === +pub) equalLastSettled++;
    else unequal.push(`${r.symbol} published ${pub} settled ${settled?.fundingRate} at ${settled ? new Date(settled.fundingTime).toISOString() : null}`);
    await sleep(200);
  }
  log('published_vs_settled', { sampled: sample.length, equalLastSettled, unequal: unequal.slice(0, 6) });

  const one = await get('/swap/v2/quote/premiumIndex?symbol=BTC-USDT');
  log('anchor_single', { status: one.status, ms: one.ms, bytes: one.bytes, body: one.body });
  const unknown = await get('/swap/v2/quote/premiumIndex?symbol=NOPE-USDT');
  log('anchor_unknown', { status: unknown.status, body: unknown.body });

  // The last settled rate from history, set beside the rate the bulk call publishes.
  for (const s of ['BTC-USDT', 'ETH-USDT', 'AIINU-USDT']) {
    const h = await get(`/swap/v2/quote/fundingRate?symbol=${s}&limit=4`);
    const cur = first.find((r) => r.symbol === s);
    log('funding_history', { symbol: s, status: h.status, history: h.body?.data?.map((x) => `${new Date(x.fundingTime).toISOString()} ${x.fundingRate}`), published: cur?.lastFundingRate, updateTime: new Date(cur?.updateTime).toISOString() });
    await sleep(200);
  }
  const hourly = first.filter((r) => r.fundingIntervalHours === 1).slice(0, 2);
  for (const r of hourly) {
    const h = await get(`/swap/v2/quote/fundingRate?symbol=${r.symbol}&limit=3`);
    log('funding_history', { symbol: r.symbol, interval: 1, history: h.body?.data?.map((x) => `${new Date(x.fundingTime).toISOString()} ${x.fundingRate}`), published: r.lastFundingRate, updateTime: new Date(r.updateTime).toISOString() });
    await sleep(200);
  }

  const tk = await get('/swap/v2/quote/ticker');
  log('ticker_bulk', { status: tk.status, ms: tk.ms, bytes: tk.bytes, rows: tk.body?.data?.length, fields: Object.keys(tk.body?.data?.[0] ?? {}) });
  const mk = await get('/swap/v1/market/markPriceKlines?symbol=BTC-USDT&interval=1m&limit=2');
  log('mark_klines', { status: mk.status, ms: mk.ms, sample: JSON.stringify(mk.body).slice(0, 300) });
}

async function book() {
  for (const limit of [5, 10, 20, 50, 100, 500, 1000, 30]) {
    const r = await get(`/swap/v2/quote/depth?symbol=BTC-USDT&limit=${limit}`);
    const d = Array.isArray(r.body?.data?.bids) ? r.body.data : null;
    const desc = (lv) => lv.every((x, i) => i === 0 || +lv[i - 1][0] > +x[0]);
    const asc = (lv) => lv.every((x, i) => i === 0 || +lv[i - 1][0] < +x[0]);
    log('depth', { limit, status: r.status, ms: r.ms, bytes: r.bytes, code: r.body?.code, msg: r.body?.msg, keys: d ? Object.keys(d) : JSON.stringify(r.body).slice(0, 200), bids: d?.bids?.length, asks: d?.asks?.length, bidsDesc: d ? desc(d.bids) : null, asksAsc: d ? asc(d.asks) : null, asksDesc: d ? desc(d.asks) : null, coinEqual: d ? JSON.stringify(d.bids) === JSON.stringify(d.bidsCoin) && JSON.stringify(d.asks) === JSON.stringify(d.asksCoin) : null, top: d ? [d.bids[0], d.asks[0]] : null, T: d?.T });
    await sleep(150);
  }
  // Two reads 100 ms apart show whether a reply is cached.
  const reads = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/swap/v2/quote/depth?symbol=BTC-USDT&limit=20');
    reads.push({ T: r.body?.data?.T, ms: r.ms, cache: r.headers['x-cache'], age: r.headers.age, top: `${r.body?.data?.bids?.[0]?.join('x')} / ${r.body?.data?.asks?.[0]?.join('x')}` });
    await sleep(100);
  }
  log('depth_repeat', { reads });
  const quiet = await get('/swap/v2/quote/depth?symbol=AIINU-USDT&limit=100');
  log('depth_quiet', { status: quiet.status, bids: quiet.body?.data?.bids?.length, asks: quiet.body?.data?.asks?.length, top: [quiet.body?.data?.bids?.[0], quiet.body?.data?.asks?.[0]] });
  const gold = await get('/swap/v2/quote/depth?symbol=NCCOGOLD2USD-USDT&limit=5');
  log('depth_tradfi', { status: gold.status, top: [gold.body?.data?.bids?.[0], gold.body?.data?.asks?.[0]], coinEqual: JSON.stringify(gold.body?.data?.bids) === JSON.stringify(gold.body?.data?.bidsCoin) });
  const closed = await get('/swap/v2/quote/depth?symbol=POWER-USDT&limit=5');
  log('depth_api_closed', { status: closed.status, body: JSON.stringify(closed.body).slice(0, 300) });
  const s25 = await get('/swap/v2/quote/depth?symbol=NCCOCOFFEE2USD-USDT&limit=5');
  log('depth_status25', { status: s25.status, body: JSON.stringify(s25.body).slice(0, 300) });
}

async function limits() {
  const u = new URL(HOST);
  const addrs = await lookup(u.hostname, { all: true });
  log('dns', { host: u.hostname, addresses: addrs.map((a) => a.address) });
  const times = [];
  for (let i = 0; i < 8; i++) {
    const r = await get('/swap/v2/server/time');
    times.push(r.ms);
    if (i === 0) log('first_request', { ms: r.ms, headers: r.headers, body: r.body });
    await sleep(250);
  }
  log('server_time_latency', { first: times[0], warm: stats(times.slice(1)) });
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/swap/v2/server/time');
    const t1 = Date.now();
    offsets.push({ offsetMs: r.body.data.serverTime - (t0 + t1) / 2, rttMs: t1 - t0 });
    await sleep(300);
  }
  log('clock', { offsets });
  const remains = [];
  for (let i = 0; i < 20; i++) {
    const r = await get('/swap/v2/quote/bookTicker?symbol=BTC-USDT');
    remains.push(`${r.status}:${r.headers['x-ratelimit-requests-remain']}/${r.headers['x-ratelimit-requests-expire']}`);
  }
  log('rate_headers', { burstOf20: remains });
  const other = await get('/swap/v2/quote/ticker?symbol=BTC-USDT');
  log('rate_headers_other_endpoint', { remain: other.headers['x-ratelimit-requests-remain'], expire: other.headers['x-ratelimit-requests-expire'] });
  const errors = {
    unknownSymbolDepth: await get('/swap/v2/quote/depth?symbol=NOPE-USDT&limit=5', { raw: true }),
    lowerCaseSymbol: await get('/swap/v2/quote/depth?symbol=btc-usdt&limit=5', { raw: true }),
    unknownPath: await get('/swap/v2/quote/nope', { raw: true }),
    unknownSymbolContracts: await get('/swap/v2/quote/contracts?symbol=NOPE-USDT', { raw: true }),
  };
  for (const [k, v] of Object.entries(errors)) log('error_shape', { case: k, status: v.status, body: typeof v.body === 'string' ? v.body : JSON.stringify(v.body).slice(0, 240) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, book, limits };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
