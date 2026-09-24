// Ourbit futures REST probe: host and latency, catalog and CCXT mapping, bulk anchor calls, anchor cadence, REST book, funding history, errors.
// Public, unauthenticated, read-only. Every call stays inside the old contract doc's limits: 20 requests per 2 s per endpoint, and 1 per 5 s on /detail.
// Run from server/: node ../scripts/probes/venues/ourbit/rest-probe.mjs [host|catalog|anchor|book|history|errors]
//   host     DNS, cold and warm request time on /ping, clock offset, Cloudflare colo and rate limit headers. About 15 s.
//   catalog  /detail, /ticker and /funding_rate once, counts, index baskets, and CCXT: the id list, and loadMarkets of a mexc instance whose spot and contract hosts point at Ourbit. About 10 s.
//   anchor   /ticker, /funding_rate and the BTC_USDT index and fair price calls once a second for 60 s, time, size and age per reply, and how often each number changes. About 65 s.
//   book     /depth with and without limit, level order, version, and depth_commits. About 5 s.
//   history  /funding_rate/history on an 8 h, a 4 h and a 1 h contract. About 3 s.
//   errors   unknown symbols, bad paths and bad parameters, status and body. About 5 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/ourbit/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const HOST = 'futures.ourbit.com';
const API = `https://${HOST}/api/v1/contract`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (arr) => ({ n: arr.length, min: Math.min(...arr), median: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, { base = API, raw = false } = {}) {
  const t0 = performance.now();
  const res = await fetch(base + path, { headers: { 'User-Agent': 'arbitrage-observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, json, text: raw ? text : undefined, headers: res.headers };
}

async function host() {
  const v4 = await dns.resolve4(HOST).catch((e) => e.code);
  const cname = await dns.resolveCname(HOST).catch((e) => e.code);
  log('dns', { host: HOST, cname, v4 });
  const cold = await get('/ping');
  log('cold', { status: cold.status, ms: cold.ms, body: cold.json, cfRay: cold.headers.get('cf-ray'), server: cold.headers.get('server') });
  const hdr = {};
  for (const [k, v] of cold.headers) if (/limit|retry|remain|x-/i.test(k)) hdr[k] = v;
  log('headers', hdr);
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 10; i++) {
    const before = Date.now();
    const r = await get('/ping');
    const after = Date.now();
    warm.push(r.ms);
    offsets.push(r.json.data - (before + after) / 2);
    await sleep(500);
  }
  log('warm', stats(warm));
  log('clock', { offsetMs: stats(offsets.map(Math.round)), note: 'server data minus local midpoint' });
}

async function catalog() {
  const detail = await get('/detail', { raw: true });
  const ticker = await get('/ticker', { raw: true });
  const funding = await get('/funding_rate', { raw: true });
  keep('detail.json', detail.text);
  const d = detail.json.data;
  const count = (arr, f) => {
    const m = {};
    for (const x of arr) m[f(x)] = (m[f(x)] ?? 0) + 1;
    return m;
  };
  log('replies', {
    detail: { status: detail.status, ms: detail.ms, bytes: detail.bytes, rows: d.length },
    ticker: { status: ticker.status, ms: ticker.ms, bytes: ticker.bytes, rows: ticker.json.data.length },
    funding: { status: funding.status, ms: funding.ms, bytes: funding.bytes, rows: funding.json.data.length },
  });
  log('state', count(d, (x) => x.state));
  log('settle', count(d, (x) => `${x.quoteCoin}/${x.settleCoin} futureType ${x.futureType} type ${x.type}`));
  log('flags', { apiAllowed: count(d, (x) => x.apiAllowed), isHidden: count(d, (x) => x.isHidden), isNew: count(d, (x) => x.isNew) });
  log('fees', { taker: count(d, (x) => x.takerFeeRate), maker: count(d, (x) => x.makerFeeRate) });
  log('contractSize', count(d, (x) => x.contractSize));
  // conceptPlate tags a contract with the site's trade zones, which is the only asset class field in the catalog.
  const zone = (x, re) => (x.conceptPlate ?? []).some((p) => re.test(p));
  const classes = { stock: /_stock$|hk_stocks|semiconductors|technology|financial|industrials|consumer|robinhood|ai_comms/, etf: /_etf$/, index: /stock_indices/, commodity: /commodities|metals|zone_energy$/, forex: /forex/, preIpo: /preipo|private_technology/ };
  const tradfi = d.filter((x) => Object.values(classes).some((re) => zone(x, re)));
  log('tradfi', { tradfi: tradfi.length, crypto: d.length - tradfi.length, byClass: Object.fromEntries(Object.entries(classes).map(([k, re]) => [k, d.filter((x) => zone(x, re)).length])), stockQuoteInBasket: d.filter((x) => x.indexOrigin.includes('REAL-TIME US STOCK QUOTE2')).length, stockQuoteInBasketButCryptoPlate: d.filter((x) => x.indexOrigin.includes('REAL-TIME US STOCK QUOTE2') && !tradfi.includes(x)).map((x) => x.symbol).slice(0, 12) });
  const pairs = count(d, (x) => `${x.baseCoin}/${x.quoteCoin}`);
  log('pairsListedTwice', Object.entries(pairs).filter(([, n]) => n > 1));
  const ids = new Set(d.map((x) => x.symbol));
  const tIds = new Set(ticker.json.data.map((x) => x.symbol));
  const fIds = new Set(funding.json.data.map((x) => x.symbol));
  log('idsMatch', {
    tickerMissing: [...ids].filter((s) => !tIds.has(s)).length,
    tickerExtra: [...tIds].filter((s) => !ids.has(s)),
    fundingMissing: [...ids].filter((s) => !fIds.has(s)).length,
    fundingExtra: [...fIds].filter((s) => !ids.has(s)),
    notUnderscore: [...ids].filter((s) => !/^[A-Z0-9]+_USDT$/.test(s)),
  });
  // Sizes are contracts: 24 h turnover over (24 h contracts x contractSize x last) sits near 1 when contractSize is the coin amount per contract.
  const bySym = new Map(d.map((x) => [x.symbol, x]));
  const ratio = ticker.json.data.filter((x) => x.volume24 > 0).map((x) => x.amount24 / (x.volume24 * bySym.get(x.symbol).contractSize * x.lastPrice)).sort((p, q) => p - q);
  log('sizeUnit', { n: ratio.length, min: ratio[0].toFixed(3), median: ratio[Math.floor(ratio.length / 2)].toFixed(3), max: ratio.at(-1).toFixed(3), within0p8to1p25: ratio.filter((k) => k > 0.8 && k < 1.25).length });
  // Index baskets: the venue lists its sources per contract, including itself as OURBIT.
  const src = {};
  for (const x of d) for (const o of x.indexOrigin) src[o] = (src[o] ?? 0) + 1;
  log('basketSources', src);
  log('basketSize', count(d, (x) => x.indexOrigin.length));
  const own = d.filter((x) => x.indexOrigin.includes('OURBIT'));
  log('ownInBasket', { n: own.length, bySize: count(own, (x) => x.indexOrigin.length), smallest: own.filter((x) => x.indexOrigin.length <= 3).map((x) => `${x.symbol}:${x.indexOrigin.join('+')}`) });
  log('singleSource', d.filter((x) => x.indexOrigin.length === 1).map((x) => `${x.symbol}:${x.indexOrigin[0]}`));
  // CCXT: no ourbit class in 4.5.68. The wire mirrors the MEXC contract API, so a mexc instance pointed at Ourbit shows what reusing that class would load.
  log('ccxt', { version: ccxt.version, ids: ccxt.exchanges.length, ourbit: ccxt.exchanges.filter((x) => /ourbit/i.test(x)) });
  // loadMarkets also reads the spot catalog, so both hosts point at Ourbit: api.ourbit.com answers the MEXC spot v3 paths.
  // The id and name matter because the connector keys the venue by the exchange id, which would otherwise be mexc.
  const ex = new ccxt.mexc({ id: 'ourbit', name: 'Ourbit', urls: { api: { spot: { public: 'https://api.ourbit.com' }, contract: { public: API } } } });
  // The old contract doc limits /detail to 1 request per 5 s, and loadMarkets reads it again.
  await sleep(5500);
  const all = Object.values(await ex.loadMarkets());
  const markets = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  log('ccxtMexcLoadMarkets', { id: ex.id, name: ex.name, all: all.length, spot: all.filter((m) => m.spot).length, activeSwaps: markets.length, privateHostsLeftOnMexc: [ex.urls.api.contract.private, ex.urls.api.spot.private] });
  const btc = markets.find((m) => m.id === 'BTC_USDT');
  log('ccxtMexcOnOurbit', {
    markets: markets.length,
    active: markets.filter((m) => m.active).length,
    linear: markets.filter((m) => m.linear).length,
    taker: count(markets, (m) => m.taker),
    idEqualsSymbol: markets.filter((m) => ids.has(m.id)).length,
    btc: { id: btc.id, symbol: btc.symbol, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker, linear: btc.linear, active: btc.active },
  });
}

async function anchor() {
  const watch = ['BTC_USDT', 'ETH_USDT', 'LSK_USDT', 'AMD_USDT', 'HEI_USDT'];
  const tTimes = [];
  const fTimes = [];
  const tBytes = [];
  const fBytes = [];
  const prev = {};
  const changes = {};
  const allChanges = { index: [], fair: [], rate: [] };
  const age = [];
  const newest = [];
  const single = { index: [], fair: [], indexAge: [], fairAge: [] };
  let last;
  let lastF;
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const [t, f, si, sf] = await Promise.all([get('/ticker'), get('/funding_rate'), get('/index_price/BTC_USDT'), get('/fair_price/BTC_USDT')]);
    single.index.push(si.json.data.indexPrice);
    single.fair.push(sf.json.data.fairPrice);
    single.indexAge.push(Date.now() - si.json.data.timestamp);
    single.fairAge.push(Date.now() - sf.json.data.timestamp);
    tTimes.push(t.ms);
    fTimes.push(f.ms);
    tBytes.push(t.bytes);
    fBytes.push(f.bytes);
    const arrival = Date.now();
    const rows = new Map(t.json.data.map((x) => [x.symbol, x]));
    const frows = new Map(f.json.data.map((x) => [x.symbol, x]));
    const top = Math.max(...t.json.data.map((x) => x.timestamp));
    age.push(arrival - top);
    newest.push(top);
    if (last) {
      let ci = 0;
      let cf = 0;
      let cr = 0;
      for (const [s, x] of rows) {
        const p = last.get(s);
        if (!p) continue;
        if (p.indexPrice !== x.indexPrice) ci++;
        if (p.fairPrice !== x.fairPrice) cf++;
        const pf = lastF.get(s);
        if (pf && frows.get(s) && pf.fundingRate !== frows.get(s).fundingRate) cr++;
      }
      allChanges.index.push(ci);
      allChanges.fair.push(cf);
      allChanges.rate.push(cr);
    }
    for (const s of watch) {
      const x = rows.get(s);
      if (!x) continue;
      const fr = frows.get(s);
      const now = { index: x.indexPrice, fair: x.fairPrice, rateT: x.fundingRate, rateF: fr?.fundingRate };
      changes[s] ??= { index: 0, fair: 0, rateT: 0, rateF: 0, polls: 0, rateTickerEqFunding: 0 };
      if (prev[s]) for (const k of ['index', 'fair', 'rateT', 'rateF']) if (prev[s][k] !== now[k]) changes[s][k]++;
      changes[s].polls++;
      if (now.rateT === now.rateF) changes[s].rateTickerEqFunding++;
      prev[s] = now;
    }
    last = rows;
    lastF = frows;
    if (i === 0) {
      keep('ticker.json', JSON.stringify(t.json));
      keep('funding_rate.json', JSON.stringify(f.json));
      const d = t.json.data;
      const dev = d.filter((x) => x.indexPrice > 0).map((x) => Math.abs(x.fairPrice / x.indexPrice - 1) * 1e6);
      const fairEqLast = d.filter((x) => x.fairPrice === x.lastPrice).length;
      const zero = { index: d.filter((x) => !(x.indexPrice > 0)).length, fair: d.filter((x) => !(x.fairPrice > 0)).length };
      // priceCoefficientVariation is documented only as "fair price coefficient variation", so test it as a band around the index.
      const det = new Map((await get('/detail')).json.data.map((x) => [x.symbol, x]));
      const pcv = {};
      for (const c of det.values()) pcv[c.priceCoefficientVariation] = (pcv[c.priceCoefficientVariation] ?? 0) + 1;
      const betweenLastAndIndex = d.filter((x) => x.fairPrice >= Math.min(x.lastPrice, x.indexPrice) && x.fairPrice <= Math.max(x.lastPrice, x.indexPrice)).length;
      log('fairBand', { pcv, tightest: [...det.values()].filter((c) => c.priceCoefficientVariation < 0.05).map((c) => c.symbol), fairWithinBand: d.filter((x) => Math.abs(x.fairPrice / x.indexPrice - 1) <= det.get(x.symbol).priceCoefficientVariation).length, lastBeyondBand: d.filter((x) => Math.abs(x.lastPrice / x.indexPrice - 1) > det.get(x.symbol).priceCoefficientVariation).map((x) => x.symbol), fairBetweenLastAndIndex: betweenLastAndIndex, fairInsideBidAsk: d.filter((x) => x.fairPrice >= x.bid1 && x.fairPrice <= x.ask1).length });
      log('snapshot', { rows: d.length, fairEqLast, zero, fairVsIndexPpm: stats(dev.map(Math.round)), over1pct: d.filter((x) => x.indexPrice > 0 && Math.abs(x.fairPrice / x.indexPrice - 1) > 0.01).map((x) => `${x.symbol}:${Math.round((x.fairPrice / x.indexPrice - 1) * 1e6)}`).slice(0, 12) });
      const fd = f.json.data;
      log('fundingSnapshot', {
        cycle: Object.fromEntries(Object.entries(fd.reduce((m, x) => ((m[x.collectCycle] = (m[x.collectCycle] ?? 0) + 1), m), {}))),
        atCap: fd.filter((x) => x.fundingRate >= x.maxFundingRate || x.fundingRate <= x.minFundingRate).map((x) => `${x.symbol}:${x.fundingRate}`),
        capSymmetric: fd.filter((x) => x.maxFundingRate === -x.minFundingRate).length,
        nextSettle: [...new Set(fd.map((x) => new Date(x.nextSettleTime).toISOString()))],
        sample: fd.find((x) => x.symbol === 'BTC_USDT'),
      });
      log('tickerSample', d.find((x) => x.symbol === 'BTC_USDT'));
    }
    await sleep(Math.max(0, 1000 - (Date.now() - start)));
  }
  log('tickerTiming', { ms: stats(tTimes), bytes: stats(tBytes), over1s: tTimes.filter((x) => x > 1000).length });
  log('fundingTiming', { ms: stats(fTimes), bytes: stats(fBytes), over1s: fTimes.filter((x) => x > 1000).length });
  log('replyAgeMs', { note: 'arrival minus the newest row timestamp', ...stats(age) });
  const distinct = [...new Set(newest)].sort((p, q) => p - q);
  const steps = distinct.slice(1).map((v, i) => v - distinct[i]);
  log('tickerRefresh', { polls: newest.length, distinctNewestTs: distinct.length, stepMs: steps.length ? stats(steps) : null });
  const ch = (arr) => arr.slice(1).filter((v, i) => v !== arr[i]).length;
  log('singleBtc', { indexChanges: ch(single.index), fairChanges: ch(single.fair), indexAgeMs: stats(single.indexAge), fairAgeMs: stats(single.fairAge) });
  log('changedPerPoll', { index: stats(allChanges.index), fair: stats(allChanges.fair), rate: stats(allChanges.rate) });
  log('watched', changes);
}

async function book() {
  for (const q of ['', '?limit=5', '?limit=20', '?limit=100', '?limit=1000']) {
    const r = await get(`/depth/BTC_USDT${q}`);
    const d = r.json.data;
    const desc = d.bids.every((l, i) => i === 0 || d.bids[i - 1][0] > l[0]);
    const asc = d.asks.every((l, i) => i === 0 || d.asks[i - 1][0] < l[0]);
    log('depth', { q: q || 'none', status: r.status, ms: r.ms, bytes: r.bytes, bids: d.bids.length, asks: d.asks.length, bidsDescending: desc, asksAscending: asc, version: d.version, age: Date.now() - d.timestamp, top: [d.bids[0], d.asks[0]], cache: r.headers.get('cf-cache-status') });
  }
  const a = await get('/depth/BTC_USDT?limit=20');
  const b = await get('/depth/BTC_USDT?limit=20');
  log('backToBack', { versions: [a.json.data.version, b.json.data.version], ms: [a.ms, b.ms] });
  const c = await get('/depth_commits/BTC_USDT/20');
  const vs = c.json.data.map((x) => x.version);
  log('depthCommits', { status: c.status, rows: vs.length, first: vs[0], last: vs.at(-1), stepMinusOne: vs.every((v, i) => i === 0 || vs[i - 1] - v === 1), sample: c.json.data[0] });
  const quiet = await get('/depth/HEI_USDT');
  log('quietDepth', { bids: quiet.json.data.bids.length, asks: quiet.json.data.asks.length, ageMs: Date.now() - quiet.json.data.timestamp, version: quiet.json.data.version });
}

async function history() {
  for (const s of ['BTC_USDT', 'HYPE_USDT', 'LSK_USDT']) {
    const r = await get(`/funding_rate/history?symbol=${s}&page_num=1&page_size=6`);
    const d = r.json.data;
    const cur = await get(`/funding_rate/${s}`);
    log('history', {
      symbol: s,
      status: r.status,
      totalCount: d.totalCount,
      rows: d.resultList.map((x) => `${new Date(x.settleTime).toISOString()} ${x.fundingRate}`),
      keys: Object.keys(d.resultList[0] ?? {}),
      current: cur.json.data,
    });
  }
}

async function errors() {
  const cases = ['/depth/NOPE_USDT', '/funding_rate/NOPE_USDT', '/index_price/NOPE_USDT', '/fair_price/NOPE_USDT', '/ticker?symbol=NOPE_USDT', '/depth/BTC_USDT?limit=abc', '/nope', '/funding_rate/history?symbol=BTC_USDT&page_size=1000'];
  for (const c of cases) {
    const r = await get(c, { raw: true });
    log('error', { path: c, status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
    await sleep(200);
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { host, catalog, anchor, book, history, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
