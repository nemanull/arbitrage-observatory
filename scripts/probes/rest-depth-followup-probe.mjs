// Follow-ups to rest-depth-probe.mjs: kraken level ordering, coinbase edge cache, bybit closed instrument, and idle keep-alive latency.
// Run from server/: node ../scripts/probes/rest-depth-followup-probe.mjs
// Recorded in docs/research/2026-09-06-venue-depth-endpoints-probe.md.
const get = async (url) => { const t0 = performance.now(); const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); const body = await r.text(); return { ms: +(performance.now() - t0).toFixed(0), status: r.status, body, h: r.headers }; };
const mono = (arr, pick) => { let asc = true, desc = true; for (let i = 1; i < arr.length; i++) { const a = pick(arr[i - 1]), b = pick(arr[i]); if (b < a) asc = false; if (b > a) desc = false; } return asc ? 'ascending' : desc ? 'descending' : 'unsorted'; };

// 1. kraken REST ordering
for (const s of ['PF_XBTUSD', 'PF_LAYERUSD']) {
  const r = await get(`https://futures.kraken.com/derivatives/api/v3/orderbook?symbol=${s}`);
  const j = JSON.parse(r.body); const b = j.orderBook.bids, a = j.orderBook.asks;
  console.log(JSON.stringify({ probe: 'kraken-order', s, bids: mono(b, (l) => l[0]), asks: mono(a, (l) => l[0]), firstBid: b[0], lastBid: b[b.length - 1], firstAsk: a[0], lastAsk: a[a.length - 1], keepAlive: r.h.get('keep-alive'), connection: r.h.get('connection') }));
}

// 2. coinbase freshness and cache headers
{
  const url = 'https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id=BTC-PERP-INTX&limit=20';
  const seen = [];
  for (let i = 0; i < 4; i++) { const r = await get(url); const j = JSON.parse(r.body); seen.push({ ms: r.ms, time: j.pricebook.time, bid0: j.pricebook.bids[0], ask0: j.pricebook.asks[0], cf: r.h.get('cf-cache-status'), age: r.h.get('age'), cc: r.h.get('cache-control'), server: r.h.get('server'), ka: r.h.get('keep-alive') }); await new Promise((f) => setTimeout(f, 300)); }
  console.log(JSON.stringify({ probe: 'coinbase-freshness', localNow: new Date().toISOString(), seen }));
}

// 3. bybit unknown symbol behaviour
{
  const inst = await get('https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=LAYERUSDT');
  const bogus = await get('https://api.bybit.com/v5/market/orderbook?category=linear&symbol=FOOBARUSDT&limit=25');
  const ji = JSON.parse(inst.body), jb = JSON.parse(bogus.body);
  console.log(JSON.stringify({ probe: 'bybit-unknown', layerInstruments: { retCode: ji.retCode, retMsg: ji.retMsg, n: ji.result?.list?.length, status: ji.result?.list?.[0]?.status }, bogusBook: { retCode: jb.retCode, retMsg: jb.retMsg, result: jb.result }, keepAlive: bogus.h.get('keep-alive'), connection: bogus.h.get('connection') }));
}

// 4. idle keep-alive: warm, then 3 s idle, then 10 s idle
const hosts = [
  ['binance', 'https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=20'],
  ['binance-inverse', 'https://dapi.binance.com/dapi/v1/depth?symbol=BTCUSD_PERP&limit=20'],
  ['bybit', 'https://api.bybit.com/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=25'],
  ['okx', 'https://www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=20'],
  ['kraken', 'https://futures.kraken.com/derivatives/api/v3/orderbook?symbol=PF_LAYERUSD'],
  ['coinbase', 'https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id=BTC-PERP-INTX&limit=20'],
];
await Promise.all(hosts.map(async ([name, url]) => {
  const out = { probe: 'idle-keepalive', name };
  const c = await get(url); out.cold = c.ms; out.keepAliveHdr = c.h.get('keep-alive'); out.connHdr = c.h.get('connection');
  out.warm = (await get(url)).ms;
  await new Promise((f) => setTimeout(f, 3000)); out.after3sIdle = (await get(url)).ms;
  await new Promise((f) => setTimeout(f, 10000)); out.after10sIdle = (await get(url)).ms;
  await new Promise((f) => setTimeout(f, 30000)); out.after30sIdle = (await get(url)).ms;
  console.log(JSON.stringify(out));
}));

// Coinbase cache busting: the same product_book with and without a nonce query parameter.
const getCb = async (url) => { const t0 = performance.now(); const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); const j = await r.json(); return { ms: +(performance.now() - t0).toFixed(0), cf: r.headers.get('cf-cache-status'), time: j.pricebook.time, bid0: j.pricebook.bids[0].price, bidSize0: j.pricebook.bids[0].size }; };
const cbBase = 'https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id=BTC-PERP-INTX&limit=20';
const plain = [], busted = [];
for (let i = 0; i < 4; i++) { plain.push(await getCb(cbBase)); busted.push(await getCb(`${cbBase}&_=${Date.now()}`)); await new Promise((f) => setTimeout(f, 250)); }
console.log(JSON.stringify({ plain }));
console.log(JSON.stringify({ busted }));
