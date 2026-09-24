// BitBNS public REST probe: spot catalog and CCXT mapping, the web app's futures instrument list, latency, the REST book and its cache, errors.
// Public, unauthenticated, read-only. Every call is a GET except the POSTs to the web app's funding history route, which read data and change nothing.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitbns/rest-probe.mjs [catalog|latency|book|errors|funding]
//   catalog  fetchMarkets, fetchTickers and CCXT loadMarkets, the futures instrument list, globalParams futures config, 24 h change per instrument. About 15 s.
//   latency  DNS, one cold and ten warm requests to three endpoints, Cloudflare cache status and edge, and the Date header against the local clock. About 20 s.
//   book     REST books on three pairs from both book routes, both routes on USDT/INR, then 30 polls of one book at 1 s to see how often it changes. About 40 s.
//   errors   unknown coin, missing coin, the keyed v1 host without a key, futures routes with bad or missing parameters. About 10 s.
//   funding  the web app's funding history route for the BTC and ETH perpetuals: row count, interval, distinct rates. About 2 s.
// Set PROBE_OUT_DIR to keep trimmed raw replies. Recorded in docs/profiles/bitbns/rest.md and fees.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const WWW = 'https://bitbns.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text.slice(0, 200_000));
}

async function get(url, init = {}) {
  const t = performance.now();
  const r = await fetch(url, init);
  const text = await r.text();
  const ms = Math.round(performance.now() - t);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, ms, bytes: text.length, text, json, cf: r.headers.get('cf-cache-status'), ray: r.headers.get('cf-ray'), date: r.headers.get('date'), ct: r.headers.get('content-type'), retryAfter: r.headers.get('retry-after') };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

async function catalog() {
  const m = await get(`${WWW}/order/fetchMarkets`);
  capture('fetchMarkets.json', m.text);
  const byQuote = {};
  for (const x of m.json) {
    const q = x.quote;
    byQuote[q] ??= { total: 0, active: 0 };
    byQuote[q].total++;
    if (x.active) byQuote[q].active++;
  }
  log('fetchMarkets', { status: m.status, ms: m.ms, bytes: m.bytes, cf: m.cf, rows: m.json.length, byQuote, sample: m.json.find((x) => x.quote === 'USDT') });

  const t = await get(`${WWW}/order/fetchTickers`);
  capture('fetchTickers.json', t.text);
  const rows = Object.values(t.json);
  const two = rows.filter((r) => Number(r.bid) > 0 && Number(r.ask) > 0);
  const spreads = two.map((r) => ((r.ask - r.bid) / ((Number(r.ask) + Number(r.bid)) / 2)) * 1e6);
  const inr = rows.filter((r) => r.symbol.endsWith('/INR'));
  const usdt = rows.filter((r) => r.symbol.endsWith('/USDT'));
  const notional = (list) => Math.round(list.reduce((a, r) => a + (Number(r.baseVolume) || 0) * (Number(r.last) || 0), 0));
  const tsAges = [...new Set(rows.map((r) => r.timestamp))].map((ts) => Math.round((Date.now() - ts) / 1000));
  log('fetchTickers', {
    status: t.status, ms: t.ms, bytes: t.bytes, cf: t.cf, rows: rows.length, tickerTsAgeS: tsAges,
    twoSided: two.length, crossed: two.filter((r) => Number(r.bid) > Number(r.ask)).map((r) => r.symbol), medianSpreadPpm: Math.round(median(spreads)),
    inrNotional24h: notional(inr), inrWithVolume: inr.filter((r) => Number(r.baseVolume) > 0).length, usdtNotional24h: notional(usdt), usdtWithVolume: usdt.filter((r) => Number(r.baseVolume) > 0).length,
    top: ['BTC/INR', 'ETH/INR', 'USDT/INR', 'BTC/USDT', 'ETH/USDT'].map((s) => ({ s, bid: t.json[s]?.bid, ask: t.json[s]?.ask, last: t.json[s]?.last, baseVolume: t.json[s]?.baseVolume })),
  });

  const ex = new ccxt.bitbns();
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const list = Object.values(markets);
  const kinds = {};
  for (const x of list) kinds[x.type] = (kinds[x.type] ?? 0) + 1;
  const btc = markets['BTC/INR'], btcu = markets['BTC/USDT'];
  const pairs = {};
  for (const x of list) { const k = `${x.base}/${x.quote}`; pairs[k] = (pairs[k] ?? 0) + 1; }
  log('ccxt', {
    version: ccxt.version, ms: Date.now() - t0, markets: list.length, kinds, swaps: list.filter((x) => x.swap).length, active: list.filter((x) => x.active).length,
    takers: [...new Set(list.map((x) => x.taker))], makers: [...new Set(list.map((x) => x.maker))], contractSizes: [...new Set(list.map((x) => x.contractSize))],
    duplicatePairs: Object.entries(pairs).filter(([, n]) => n > 1).map(([k]) => k),
    btcInr: { id: btc.id, uppercaseId: btc.uppercaseId, symbol: btc.symbol, linear: btc.linear, contractSize: btc.contractSize, taker: btc.taker, maker: btc.maker },
    btcUsdt: { id: btcu.id, uppercaseId: btcu.uppercaseId, symbol: btcu.symbol, taker: btcu.taker, maker: btcu.maker },
  });

  const inst = await get(`${WWW}/futures-testnet/getInstDetails?network=mainnet`);
  capture('getInstDetails.json', inst.text);
  const data = inst.json?.[0]?.data ?? {};
  const insts = Object.values(data);
  log('futuresInstruments', {
    status: inst.status, ms: inst.ms, bytes: inst.bytes, cf: inst.cf, count: insts.length, statuses: [...new Set(insts.map((i) => i.status))], settled: [...new Set(insts.map((i) => i.usdt_settled))],
    names: insts.map((i) => `${i.inst_id}:${i.coin_name}:f${i.factor}`),
  });

  const gp = await get(`${WWW}/jugApi/globalParams.json`);
  const d = gp.json?.[0]?.data ?? {};
  log('globalParams', { status: gp.status, ms: gp.ms, bytes: gp.bytes, cf: gp.cf, futuresCoins: d.futuresCoins, futuresInstruments: d.futuresInstruments, masterCryptoTransferDisable: d.masterCryptoTransferDisable, disableWithdNw: d.disableWithdNw });

  const changes = [];
  for (const i of insts) {
    const c = await get(`${WWW}/futures-testnet/get24HrChange?network=mainnet&inst_id=${i.inst_id}`);
    const v = c.json?.[0]?.data ?? {};
    changes.push({ id: i.inst_id, name: i.coin_name, status: c.status, open: v.open, close: v.close, vol: v.vol });
    await sleep(300);
  }
  log('futures24h', { withVolume: changes.filter((c) => c.vol > 0).length, rows: changes });
}

async function latency() {
  for (const host of ['bitbns.com', 'api.bitbns.com', 'socket.bitbns.com', 'wsinrmv2.bitbns.com', 'wsusdtmv2.bitbns.com']) {
    const t = performance.now();
    const addrs = await lookup(host, { all: true });
    log('dns', { host, ms: Math.round(performance.now() - t), addrs: addrs.map((a) => a.address) });
  }
  const urls = [
    `${WWW}/exchangeData/orderbook?coin=BTC&market=INR`,
    `${WWW}/order/fetchTickers`,
    `${WWW}/futures-testnet/getInstDetails?network=mainnet`,
  ];
  for (const url of urls) {
    const times = []; const cf = {}; const offsets = []; const edges = new Set();
    for (let i = 0; i < 11; i++) {
      const before = Date.now();
      const r = await get(url);
      times.push(r.ms);
      cf[r.cf ?? 'none'] = (cf[r.cf ?? 'none'] ?? 0) + 1;
      if (r.ray) edges.add(r.ray.split('-').at(-1));
      if (r.date) offsets.push(new Date(r.date).getTime() - (before + r.ms / 2));
      await sleep(500);
    }
    log('latency', { url, coldMs: times[0], warm: { min: Math.min(...times.slice(1)), median: median(times.slice(1)), max: Math.max(...times.slice(1)) }, cf, edges: [...edges], dateOffsetMs: { min: Math.min(...offsets), max: Math.max(...offsets) } });
  }
}

async function book() {
  const pairs = [['BTC', 'INR', 'BTC'], ['ETH', 'INR', 'ETH'], ['BTC', 'USDT', 'BTCUSDT']];
  for (const [coin, market, sym] of pairs) {
    const a = await get(`${WWW}/exchangeData/orderbook?coin=${coin}&market=${market}`);
    const b = await get(`${WWW}/order/fetchOrderbook?symbol=${sym}`);
    const desc = (l) => l.every((x, i) => i === 0 || x[0] <= l[i - 1][0]);
    const asc = (l) => l.every((x, i) => i === 0 || x[0] >= l[i - 1][0]);
    const shape = (r) => r.json && Array.isArray(r.json.bids)
      ? { status: r.status, ms: r.ms, bytes: r.bytes, cf: r.cf, bids: r.json.bids.length, asks: r.json.asks.length, bidsDescending: desc(r.json.bids), asksAscending: asc(r.json.asks), top: [r.json.bids[0], r.json.asks[0]], tsAgeS: r.json.timestamp ? Math.round((Date.now() - r.json.timestamp) / 1000) : null, keys: Object.keys(r.json) }
      : { status: r.status, body: r.text.slice(0, 200) };
    log('restBook', { coin, market, exchangeData: shape(a), fetchOrderbook: shape(b) });
  }
  // The two book routes disagree on USDT/INR, so both are read back to back.
  const u1 = await get(`${WWW}/order/fetchOrderbook?symbol=USDT`);
  const u2 = await get(`${WWW}/exchangeData/orderbook?coin=USDT&market=INR`);
  log('usdtInr', { fetchOrderbook: { cf: u1.cf, top: [u1.json?.bids?.[0], u1.json?.asks?.[0]] }, exchangeData: { cf: u2.cf, top: [u2.json?.bids?.[0], u2.json?.asks?.[0]] } });
  const seen = new Map(); const cf = {}; const ages = [];
  for (let i = 0; i < 30; i++) {
    const r = await get(`${WWW}/exchangeData/orderbook?coin=BTC&market=INR`);
    seen.set(r.text, (seen.get(r.text) ?? 0) + 1);
    cf[r.cf ?? 'none'] = (cf[r.cf ?? 'none'] ?? 0) + 1;
    if (r.json?.timestamp) ages.push(Math.round((Date.now() - r.json.timestamp) / 1000));
    await sleep(1000);
  }
  log('bookPoll', { polls: 30, distinctBodies: seen.size, cf, tsAgeS: { min: Math.min(...ages), max: Math.max(...ages), distinct: [...new Set(ages.map((x) => x))].length } });
}

async function errors() {
  const cases = [
    ['unknown coin', `${WWW}/exchangeData/orderbook?coin=NOPE&market=INR`],
    ['missing coin', `${WWW}/exchangeData/orderbook`],
    ['fetchOrderbook unknown', `${WWW}/order/fetchOrderbook?symbol=NOPE`],
    ['v1 tickers without key', 'https://api.bitbns.com/api/trade/v1/tickers'],
    ['v1 platform status without key', 'https://api.bitbns.com/api/trade/v1/platform/status'],
    ['getInstDetails without network', `${WWW}/futures-testnet/getInstDetails`],
    ['get24HrChange without inst_id', `${WWW}/futures-testnet/get24HrChange?network=mainnet`],
    ['mainnet futures path', `${WWW}/futures/getInstDetails`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error', { name, url, status: r.status, ct: r.ct, retryAfter: r.retryAfter, body: r.text.slice(0, 160) });
    await sleep(400);
  }
  const body = new URLSearchParams({ network: 'mainnet', inst_id: '2' });
  const r = await get(`${WWW}/futures-testnet/fundingRateHistory`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  log('error', { name: 'fundingRateHistory POST without login', status: r.status, ct: r.ct, body: r.text.slice(0, 300) });
}

async function funding() {
  for (const id of [2, 3]) {
    const body = new URLSearchParams({ network: 'mainnet', inst_id: String(id) });
    const r = await get(`${WWW}/futures-testnet/fundingRateHistory`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    capture(`fundingRateHistory-${id}.json`, r.text);
    const rows = r.json?.[0]?.data ?? [];
    const ts = rows.map((x) => Date.parse(x.timestamp)).sort((a, b) => b - a);
    const gaps = ts.slice(1).map((t, i) => Math.round((ts[i] - t) / 3.6e6 * 100) / 100);
    const hours = [...new Set(rows.map((x) => new Date(x.timestamp).getUTCHours()))].sort((a, b) => a - b);
    log('funding', {
      inst_id: id, status: r.status, ms: r.ms, bytes: r.bytes, rows: rows.length, keys: rows[0] ? Object.keys(rows[0]) : [],
      newest: rows.slice(0, 3), oldest: rows.at(-1), gapHours: [...new Set(gaps)].slice(0, 8), settleHoursUtc: hours,
      distinctRates: [...new Set(rows.map((x) => x.funding_rate))].length, rateRange: rows.length ? [Math.min(...rows.map((x) => x.funding_rate)), Math.max(...rows.map((x) => x.funding_rate))] : null,
    });
    await sleep(500);
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, latency, book, errors, funding };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
