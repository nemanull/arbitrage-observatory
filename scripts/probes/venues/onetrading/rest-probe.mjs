// One Trading REST probe: host and latency, the instrument catalog and how CCXT 4.5.68 maps it, the anchor calls polled once a second, funding history and settings, the REST book, error shapes and the server clock.
// Public, unauthenticated, read-only. Two calls a second at most, inside the 240 requests a minute the help center names.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/onetrading/rest-probe.mjs [catalog|anchor|funding|book|errors|time]
//   catalog  DNS, cold and warm times per public call, the public fee groups, catalog counts by type and state, and the CCXT market for each instrument type.
//   anchor   market-ticker and funding-rate once a second each for 60 s: reply size and time, how often and at which poll mark and rate change in each call, mark against last, bid and ask.
//   funding  funding-rate settings, and the settled history of every dated future over three days.
//   book     REST order book at each level and depth, level order, repeat reads for caching.
//   errors   unknown instrument, bad depth and level, unknown path, and the headers a reply carries.
//   time     ten reads of the server clock against this host's clock, the offset taken at the fastest read.
// Recorded in docs/profiles/onetrading/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'api.onetrading.com';
const API = `https://${HOST}/fast/v1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantiles = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${path}`);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, ms, bytes: text.length, body, headers: res.headers };
}

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addresses: addrs.map((a) => a.address) });
  const paths = ['time', 'instruments', 'market-ticker', 'funding-rate', 'funding-rate/settings', 'fees', 'currencies', 'order-book/BTC_USD_P?level=2'];
  for (const p of paths) {
    const times = [];
    let first = null;
    for (let i = 0; i < 6; i++) {
      const r = await get(p);
      if (i === 0) first = r;
      else times.push(r.ms);
      await sleep(300);
    }
    log('latency', { path: p, status: first.status, bytes: first.bytes, coldMs: first.ms, warm: quantiles(times), ray: first.headers.get('cf-ray') });
  }
  const fees = (await get('fees')).body;
  for (const g of fees) {
    log('fee_group', { group: g.fee_group_id, volumeCurrency: g.volume_currency, tiers: g.fee_tiers.map((t) => `${t.volume}:${t.maker_fee}/${t.taker_fee}`) });
  }
  const inst = (await get('instruments')).body;
  const counts = {};
  for (const r of inst) {
    const k = `${r.type} ${r.quote.code} ${r.state}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  log('catalog', { rows: inst.length, counts });
  for (const r of inst.filter((x) => x.type !== 'SPOT')) {
    log('future', { id: r.id, type: r.type, state: r.state, expiry: r.contract_expiry_date ?? null, schedule: r.funding_schedule, amountPrecision: r.amount_precision, marketPrecision: r.market_precision, minSize: r.min_size });
  }
  const ex = new ccxt.onetrading();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const byType = {};
  for (const m of all) {
    const k = `${m.type} active=${m.active}`;
    byType[k] = (byType[k] ?? 0) + 1;
  }
  const activeSwaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  log('ccxt', { version: ccxt.version, markets: all.length, byType, activeSwaps: activeSwaps.length });
  for (const id of ['BTC_USD_P', 'BTC_EUR_P', 'SPCX_USD_P', 'BTC_USDC']) {
    const m = all.find((x) => x.id === id);
    if (!m) { log('ccxt_market', { id, missing: true }); continue; }
    log('ccxt_market', { id, symbol: m.symbol, type: m.type, spot: m.spot, swap: m.swap, future: m.future, linear: m.linear ?? null, contractSize: m.contractSize ?? null, settle: m.settle ?? null, expiry: m.expiry ?? null, active: m.active, taker: m.taker, maker: m.maker, precision: m.precision });
  }
  const tickers = (await get('market-ticker')).body;
  const tickerIds = new Set(tickers.map((t) => t.instrument_code));
  const dated = inst.filter((x) => x.type === 'DATED_FUTURE' && x.state === 'ACTIVE').map((x) => x.id);
  const funding = (await get('funding-rate')).body;
  const fundingIds = new Set(funding.map((f) => f.instrument_code));
  log('id_match', { datedActive: dated.length, inTicker: dated.filter((id) => tickerIds.has(id)).length, inFundingRate: dated.filter((id) => fundingIds.has(id)).length, ccxtIdsEqual: dated.filter((id) => markets[all.find((m) => m.id === id)?.symbol]?.id === id).length, fundingRows: funding.length, fundingOnlyIds: [...fundingIds].filter((id) => !dated.includes(id)) });
}

async function anchor() {
  const tick = { times: [], bytes: [] };
  const fr = { times: [], bytes: [] };
  const per = new Map();
  const bump = (id) => {
    if (!per.has(id)) per.set(id, { mark: null, markChanges: 0, rate: null, rateChanges: 0, frMark: null, frMarkChanges: 0, frTime: null, frTimeChanges: 0, frAgeMs: [], next: new Set(), medianMiss: 0, medianHit: 0, lastEqMark: 0, polls: 0, frMarkEqTicker: 0, frPolls: 0, tickerChangeAt: [], frChangeAt: [] });
    return per.get(id);
  };
  for (let i = 0; i < 60; i++) {
    const started = Date.now();
    const [t, f] = await Promise.all([get('market-ticker'), get('funding-rate')]);
    tick.times.push(t.ms); tick.bytes.push(t.bytes);
    fr.times.push(f.ms); fr.bytes.push(f.bytes);
    const tMarks = new Map();
    for (const r of t.body) {
      if (r.type !== 'DATED_FUTURE') continue;
      const s = bump(r.instrument_code);
      s.polls++;
      if (s.mark !== null && r.mark_price !== s.mark) { s.markChanges++; s.tickerChangeAt.push(i); }
      if (s.rate !== null && r.funding_rate !== s.rate) s.rateChanges++;
      s.mark = r.mark_price; s.rate = r.funding_rate; s.last = r.last_price;
      s.next.add(r.next_funding_payment);
      tMarks.set(r.instrument_code, r.mark_price);
      const three = [Number(r.last_price), Number(r.highest_bid), Number(r.lowest_ask)].sort((a, b) => a - b);
      if (Math.abs(three[1] - Number(r.mark_price)) < 1e-12) s.medianHit++; else s.medianMiss++;
      if (r.last_price === r.mark_price) s.lastEqMark++;
    }
    for (const r of f.body) {
      const s = bump(r.instrument_code);
      s.frPolls++;
      if (s.frMark !== null && r.mark_price !== s.frMark) { s.frMarkChanges++; s.frChangeAt.push(i); }
      if (s.frTime !== null && r.time !== s.frTime) s.frTimeChanges++;
      s.frMark = r.mark_price; s.frTime = r.time;
      s.frAgeMs.push(Date.now() - r.time);
      if (tMarks.get(r.instrument_code) === r.mark_price) s.frMarkEqTicker++;
    }
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  log('reply', { call: 'market-ticker', ms: quantiles(tick.times), bytes: quantiles(tick.bytes) });
  log('reply', { call: 'funding-rate', ms: quantiles(fr.times), bytes: quantiles(fr.bytes) });
  for (const [id, s] of per) {
    log('anchor', { id, polls: s.polls, markChanges: s.markChanges, rateChanges: s.rateChanges, markIsMedianOfLastBidAsk: `${s.medianHit}/${s.medianHit + s.medianMiss}`, lastEqualsMark: s.lastEqMark, nextFunding: [...s.next], frPolls: s.frPolls, frMarkChanges: s.frMarkChanges, frTimeChanges: s.frTimeChanges, frAgeMs: s.frAgeMs.length ? quantiles(s.frAgeMs) : null, frMarkEqualsTickerMark: s.frMarkEqTicker, markChangedAtPoll: { ticker: s.tickerChangeAt, fundingRate: s.frChangeAt }, lastRead: { tickerMark: s.mark, tickerLast: s.last, fundingRateMark: s.frMark } });
  }
}

async function funding() {
  const settings = (await get('funding-rate/settings')).body;
  for (const s of settings) log('setting', s);
  const n = 2190; // six 4 h periods a day for 365 days
  log('interest_component', { annual: 0.04, perPeriod: Math.pow(1.04, 1 / n) - 1 });
  const now = Date.now();
  const ids = settings.filter((s) => s.period === 240).map((s) => s.instrument_code);
  for (const id of ids) {
    const r = await get(`funding-rate/history?instrument_code=${id}&from=${now - 3 * 86_400_000}&to=${now}&limit=100`);
    const rows = r.body.funding_rates ?? [];
    const times = rows.map((x) => Number(x.time)).sort((a, b) => a - b);
    const gapsH = [...new Set(times.slice(1).map((t, i) => (t - times[i]) / 3_600_000))];
    const rates = rows.map((x) => Number(x.funding_rate));
    const hours = [...new Set(times.map((t) => new Date(t).getUTCHours()))].sort((a, b) => a - b);
    log('history', { id, status: r.status, rows: rows.length, gapsHours: gapsH, utcHours: hours, minRate: Math.min(...rates), maxRate: Math.max(...rates), atCap: rates.filter((x) => Math.abs(Math.abs(x) - 0.001) < 1e-9).length, newest: rows[0] ?? null });
    await sleep(300);
  }
  const current = (await get('funding-rate')).body;
  for (const c of current) log('current', { id: c.instrument_code, rate: c.funding_rate, mark: c.mark_price, time: c.timestamp });
}

async function book() {
  for (const q of ['', '?level=1', '?level=2', '?level=3', '?level=2&depth=1', '?level=2&depth=16', '?level=3&depth=16', '?depth=20', '?level=4']) {
    const r = await get(`order-book/BTC_USD_P${q}`);
    const b = r.body;
    if (r.status !== 200) { log('book', { query: q, status: r.status, body: b }); continue; }
    const bids = b.bids.map((l) => Number(l.price));
    const asks = b.asks.map((l) => Number(l.price));
    const desc = bids.every((p, i) => i === 0 || p < bids[i - 1]);
    const asc = asks.every((p, i) => i === 0 || p > asks[i - 1]);
    log('book', { query: q, status: r.status, ms: r.ms, levels: [bids.length, asks.length], bidsDesc: desc, asksAsc: asc, keys: Object.keys(b), levelKeys: Object.keys(b.bids[0] ?? {}), unum: b.unum_bids ?? null, timeAgeMs: Date.now() - Number(BigInt(b.time) / 1_000_000n), cacheControl: r.headers.get('cache-control'), age: r.headers.get('age'), cf: r.headers.get('cf-cache-status') });
    await sleep(300);
  }
  // Ten reads 100 ms apart: a cached reply repeats its unum and time.
  const seen = [];
  for (let i = 0; i < 10; i++) {
    const r = await get('order-book/ETH_USD_P?level=2');
    seen.push(`${r.body.unum_bids}@${r.ms}ms`);
    await sleep(100);
  }
  log('repeat_reads', { eth: seen });
  for (const id of ['ETH_USD_P', 'XRP_USD_P', 'SOL_USD_P', 'LTC_USD_P', 'SUI_USD_P', 'TAO_USD_P', 'DOGE_USD_P', 'LINK_USD_P', 'ADA_USD_P', 'BTC_USDC', 'ETH_USDC']) {
    const r = await get(`order-book/${id}?level=3`);
    log('book_depth', { id, levels: [r.body.bids.length, r.body.asks.length] });
    await sleep(300);
  }
}

async function errors() {
  const cases = ['order-book/NOPE_USD_P', 'order-book/BTC_EUR_P', 'order-book/BTC_USD_P?depth=32', 'order-book/BTC_USD_P?level=9', 'market-ticker/NOPE_USD_P', 'funding-rate?instrument_code=NOPE_USD_P', 'funding-rate?instrument_code=BTC_USDC', 'funding-rate/history?instrument_code=BTC_USD_P&limit=5000', 'nope', 'instruments?type=PERP', 'instruments?type=DATED_FUTURE'];
  for (const c of cases) {
    const r = await get(c);
    const body = Array.isArray(r.body) ? `array of ${r.body.length}` : r.body;
    log('error_case', { path: c, status: r.status, ms: r.ms, body });
    await sleep(300);
  }
  const r = await get('market-ticker');
  const keep = {};
  for (const [k, v] of r.headers) keep[k] = v;
  log('headers', { path: 'market-ticker', headers: keep });
}

async function time() {
  const offsets = [];
  const rtts = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get('time');
    const t1 = Date.now();
    rtts.push(t1 - t0);
    offsets.push(r.body.epoch_millis - (t0 + t1) / 2);
    await sleep(500);
  }
  const best = rtts.indexOf(Math.min(...rtts));
  log('clock', { offsetMs: quantiles(offsets), rttMs: quantiles(rtts), offsetAtMinRttMs: offsets[best], samples: rtts.map((r, i) => `${r}ms:${offsets[i]}`) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor, funding, book, errors, time };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
process.exit(0);
