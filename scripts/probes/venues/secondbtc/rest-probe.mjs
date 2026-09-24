// SecondBTC public REST probe: host and latency, clock offset, spot catalog and symbol spellings, depth snapshot shape, rate limit headers, and how closely the book tracks Binance.
// Public, unauthenticated, read-only. Every call is a GET on api.secondbtc.com, plus Binance bookTicker in mirror mode, with pauses between calls.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/secondbtc/rest-probe.mjs [catalog|depth|limits|mirror]
//   catalog  DNS, cold and warm time, server time, exchangeInfo, ticker, ticker/price, summary, assets, CCXT class check. About 15 s.
//   depth    depth for a busy, a thin, a disabled and an unknown symbol, the limit parameter, six reads 300 ms apart, summary and ticker touch against depth, and the trades call. About 50 s.
//   limits   20 sequential reads of /api/v1/time with the status codes and any rate limit header. About 15 s.
//   mirror   30 samples 2 s apart of the SecondBTC touch against Binance bookTicker on three pairs, all four reads sent at once. About 70 s.
// Recorded in docs/profiles/secondbtc/rest.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const API = 'https://api.secondbtc.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

async function get(path, { timeoutMs = 10000, base = API } = {}) {
  const t = performance.now();
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, ms: Math.round(performance.now() - t), headers: r.headers, text, json };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t), error: e.name + ': ' + e.message, text: '', json: null };
  }
}

const tally = (arr, key) => arr.reduce((m, x) => { const k = key(x); m[k] = (m[k] || 0) + 1; return m; }, {});

async function catalog() {
  for (const host of ['api.secondbtc.com', 'socket.secondbtc.com', 'secondbtc.com']) {
    const addrs = await lookup(host, { all: true });
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/api/v1/time');
    const t1 = Date.now();
    times.push(r.ms);
    if (r.json?.serverTime) log('clock', { i, ms: r.ms, offsetMs: r.json.serverTime - Math.round((t0 + t1) / 2), cf: r.headers.get('cf-ray') });
    await sleep(300);
  }
  log('time_latency', { coldMs: times[0], warmMs: times.slice(1) });
  const ping = await get('/api/v1/ping');
  log('ping', { status: ping.status, ms: ping.ms, body: ping.text });

  const ei = await get('/api/v1/exchangeInfo');
  const syms = ei.json.symbols;
  log('exchangeInfo', {
    status: ei.status, ms: ei.ms, bytes: ei.text.length, topKeys: Object.keys(ei.json), symbolKeys: Object.keys(syms[0]),
    count: syms.length, statusTally: tally(syms, (s) => String(s.status)), quoteTally: tally(syms.filter((s) => s.status), (s) => s.quoteAsset),
    feeTally: tally(syms, (s) => `${s.tradeFeeMaker}/${s.tradeFeeTaker}`), marketMakerTally: tally(syms, (s) => String(s.marketMaker)),
    orderTypes: tally(syms, (s) => (s.orderTypes || []).join('+')),
    disabled: syms.filter((s) => !s.status).map((s) => s.symbol),
    oddFee: syms.filter((s) => s.tradeFeeTaker !== 0.2).map((s) => `${s.symbol}:${s.tradeFeeMaker}/${s.tradeFeeTaker}:${s.status}`),
    derivativeWords: JSON.stringify(ei.json).match(/perp|swap|futur|contract|funding|markPrice|index/gi) ?? [],
  });
  log('exchangeInfo_btc', { row: syms.find((s) => s.symbol === 'BTCUSDT') });
  await sleep(300);

  const tk = await get('/api/v1/ticker');
  const now = Date.now();
  const ages = tk.json.map((x) => now - x.lastUpdateTimestamp).sort((a, b) => a - b);
  log('ticker', {
    status: tk.status, ms: tk.ms, bytes: tk.text.length, count: tk.json.length, keys: Object.keys(tk.json[0]),
    quoteTally: tally(tk.json, (x) => x.pairs.split('_')[1]), statusTally: tally(tk.json, (x) => String(x.status)),
    spelling: tk.json.slice(0, 2).map((x) => `${x.symbol} ${x.pairs}`),
    ageMs: { min: ages[0], median: ages[Math.floor(ages.length / 2)], max: ages[ages.length - 1] },
    notInExchangeInfoActive: tk.json.filter((x) => !syms.some((s) => s.status && s.symbol === x.symbol)).map((x) => x.symbol),
    activeNotInTicker: syms.filter((s) => s.status && !tk.json.some((x) => x.symbol === s.symbol)).map((s) => s.symbol),
  });
  log('ticker_btc', { row: tk.json.find((x) => x.symbol === 'BTCUSDT') });
  await sleep(300);

  const tp = await get('/api/v1/ticker/price');
  log('ticker_price', { status: tp.status, ms: tp.ms, count: tp.json?.length, first: tp.json?.[0] });
  await sleep(300);

  const sm = await get('/api/v1/summary');
  const smKeys = Object.keys(sm.json.data);
  log('summary', { status: sm.status, ms: sm.ms, bytes: sm.text.length, top: Object.keys(sm.json), code: sm.json.code, count: smKeys.length, keyed: smKeys.slice(0, 3), rowKeys: Object.keys(sm.json.data[smKeys[0]]), btc: sm.json.data.BTC_USDT });
  await sleep(300);

  const as = await get('/api/v1/assets');
  const aKeys = Object.keys(as.json.data);
  log('assets', { status: as.status, ms: as.ms, count: aKeys.length, rowKeys: Object.keys(as.json.data[aKeys[0]]), feeTally: tally(aKeys, (k) => `${as.json.data[k].maker_fee}/${as.json.data[k].taker_fee}`), btc: as.json.data.BTC });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, match: ccxt.exchanges.filter((e) => /second|sbtc/i.test(e)) });
}

function bookShape(j) {
  const b = j.bids ?? [], a = j.asks ?? [];
  return {
    keys: Object.keys(j), bodyStatus: j.status, msg: j.msg, serverTime: j.serverTime, bids: b.length, asks: a.length,
    bestBid: b[0], bestAsk: a[0], bidsDesc: b.every((x, i) => !i || x[0] <= b[i - 1][0]), asksAsc: a.every((x, i) => !i || x[0] >= a[i - 1][0]),
    dupBidPrices: b.length - new Set(b.map((x) => x[0])).size, dupAskPrices: a.length - new Set(a.map((x) => x[0])).size,
    crossed: b.length && a.length ? b[0][0] >= a[0][0] : null, types: b[0] ? [typeof b[0][0], typeof b[0][1]] : null,
  };
}

async function depth() {
  for (const q of ['symbol=BTCUSDT', 'symbol=SBTCUSDT', 'symbol=CATUSDT', 'symbol=MBASEUSDT', 'symbol=BTC_USDT', 'symbol=NOPEUSDT', '']) {
    const r = await get('/api/v1/depth' + (q ? '?' + q : ''));
    log('depth', { q, http: r.status, ms: r.ms, bytes: r.text.length, ...(r.json ? bookShape(r.json) : { body: r.text.slice(0, 200) }), cache: r.headers?.get('cf-cache-status') });
    await sleep(400);
  }
  for (const lim of [5, 20, 100, 1000]) {
    const r = await get(`/api/v1/depth?symbol=BTCUSDT&limit=${lim}`);
    log('depth_limit', { limit: lim, status: r.status, ms: r.ms, bids: r.json?.bids?.length, asks: r.json?.asks?.length });
    await sleep(400);
  }
  const reads = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/api/v1/depth?symbol=BTCUSDT');
    reads.push({ t: Date.now(), ms: r.ms, serverTime: r.json.serverTime, bb: r.json.bids[0], ba: r.json.asks[0], dup: bookShape(r.json).dupBidPrices + bookShape(r.json).dupAskPrices, etag: r.headers.get('etag') });
    await sleep(300);
  }
  log('depth_repeat', { reads });
  const bulk = [];
  for (let i = 0; i < 5; i++) {
    const [sm, tk, d] = await Promise.all([get('/api/v1/summary'), get('/api/v1/ticker'), get('/api/v1/depth?limit=5&symbol=ETHUSDT')]);
    const s = sm.json.data.ETH_USDT, t = tk.json.find((x) => x.symbol === 'ETHUSDT');
    bulk.push({ depth: `${d.json.bids[0][0]}/${d.json.asks[0][0]}`, summary: `${s.highest_bid}/${s.lowest_ask}`, ticker: `${t.highestBid}/${t.lowestAsk}`, tickerAgeMs: Date.now() - t.lastUpdateTimestamp });
    await sleep(2000);
  }
  log('bulk_vs_depth', { symbol: 'ETHUSDT', reads: bulk });
  const tr = await get('/api/v1/trades?symbol=BTCUSDT', { timeoutMs: 8000 });
  log('trades', { status: tr.status, ms: tr.ms, error: tr.error, body: tr.text.slice(0, 200) });
}

async function limits() {
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const r = await get('/api/v1/time');
    const rl = Object.fromEntries([...r.headers.entries()].filter(([k]) => /rate|limit|retry|used-weight/i.test(k)));
    seen.push({ i, at: Date.now(), status: r.status, ms: r.ms, rl });
    await sleep(500);
  }
  log('limits', { statuses: tally(seen, (s) => s.status), headerNames: [...new Set(seen.flatMap((s) => Object.keys(s.rl)))], limit: [...new Set(seen.map((s) => s.rl['x-ratelimit-limit']))], remaining: seen.map((s) => s.rl['x-ratelimit-remaining']), resetMinusNowS: seen.map((s) => s.rl['x-ratelimit-reset'] - Math.round(s.at / 1000)), ms: seen.map((s) => s.ms) });
  const bad = await get('/api/v1/nope');
  log('unknown_path', { status: bad.status, body: bad.text.slice(0, 120) });
}

async function mirror() {
  const pairs = [['BTCUSDT', 'BTCUSDT'], ['ETHUSDT', 'ETHUSDT'], ['SOLUSDT', 'SOLUSDT']];
  const rows = Object.fromEntries(pairs.map(([s]) => [s, []]));
  for (let i = 0; i < 30; i++) {
    const [bn, ...ds] = await Promise.all([
      get('/api/v3/ticker/bookTicker?symbols=' + encodeURIComponent(JSON.stringify(pairs.map((p) => p[1]))), { base: 'https://api.binance.com' }),
      ...pairs.map(([s]) => get('/api/v1/depth?limit=5&symbol=' + s)),
    ]);
    for (const [k, [s, b]] of pairs.entries()) {
      const d = ds[k];
      const ref = bn.json?.find?.((x) => x.symbol === b);
      if (!d.json?.bids?.length || !d.json?.asks?.length || !ref) continue;
      const mid = (d.json.bids[0][0] + d.json.asks[0][0]) / 2;
      const refMid = (+ref.bidPrice + +ref.askPrice) / 2;
      rows[s].push({ dup: bookShape(d.json).dupBidPrices + bookShape(d.json).dupAskPrices, selfCrossed: d.json.bids[0][0] >= d.json.asks[0][0], touch: `${d.json.bids[0][0]}/${d.json.asks[0][0]}`, refTouch: `${ref.bidPrice}/${ref.askPrice}`, diffPpm: ((mid - refMid) / refMid) * 1e6, spreadPpm: ((d.json.asks[0][0] - d.json.bids[0][0]) / mid) * 1e6, refSpreadPpm: ((+ref.askPrice - +ref.bidPrice) / refMid) * 1e6, crossRefPpm: Math.max((ref.bidPrice - d.json.asks[0][0]) / refMid, (d.json.bids[0][0] - ref.askPrice) / refMid) * 1e6 });
    }
    await sleep(2000);
  }
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
  for (const [s, r] of Object.entries(rows)) {
    const abs = r.map((x) => Math.abs(x.diffPpm));
    log('mirror', { symbol: s, n: r.length, distinctTouches: new Set(r.map((x) => x.touch)).size, distinctBinanceTouches: new Set(r.map((x) => x.refTouch)).size, samplesWithDuplicatePrices: r.filter((x) => x.dup > 0).length, samplesSelfCrossed: r.filter((x) => x.selfCrossed).length, absMidDiffPpm: { median: q(abs, 0.5), p90: q(abs, 0.9), max: q(abs, 1) }, spreadPpm: { median: q(r.map((x) => x.spreadPpm), 0.5), max: q(r.map((x) => x.spreadPpm), 1) }, binanceSpreadPpm: q(r.map((x) => x.refSpreadPpm), 0.5), crossedAgainstBinance: r.filter((x) => x.crossRefPpm > 0).length, maxCrossPpm: q(r.map((x) => x.crossRefPpm), 1) });
  }
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, depth, limits, mirror };
if (!modes[mode]) throw new Error('mode must be one of ' + Object.keys(modes).join(', '));
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
