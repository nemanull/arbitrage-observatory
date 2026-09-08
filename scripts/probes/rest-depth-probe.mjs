// Public REST depth endpoints of the five venues, timed once cold and five times on the kept connection.
// Run from server/ so node resolves the same way the feeds do: node ../scripts/probes/rest-depth-probe.mjs
// Recorded in docs/research/2026-09-06-venue-depth-endpoints-probe.md.
const N_WARM = 5;
const TIMEOUT_MS = 8000;

const targets = [
  { venue: 'binance-linear', sym: 'BTCUSDT', url: (s) => `https://fapi.binance.com/fapi/v1/depth?symbol=${s}&limit=20`, hdr: ['x-mbx-used-weight-1m'] },
  { venue: 'binance-linear', sym: 'LAYERUSDT', url: (s) => `https://fapi.binance.com/fapi/v1/depth?symbol=${s}&limit=20`, hdr: ['x-mbx-used-weight-1m'] },
  { venue: 'binance-inverse', sym: 'BTCUSD_PERP', url: (s) => `https://dapi.binance.com/dapi/v1/depth?symbol=${s}&limit=20`, hdr: ['x-mbx-used-weight-1m'] },
  { venue: 'bybit', sym: 'BTCUSDT', url: (s) => `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${s}&limit=25`, hdr: ['x-bapi-limit', 'x-bapi-limit-status', 'x-bapi-limit-reset-timestamp'] },
  { venue: 'bybit', sym: 'LAYERUSDT', url: (s) => `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${s}&limit=25`, hdr: ['x-bapi-limit', 'x-bapi-limit-status'] },
  { venue: 'okx', sym: 'BTC-USDT-SWAP', url: (s) => `https://www.okx.com/api/v5/market/books?instId=${s}&sz=20`, hdr: ['ratelimit-limit', 'ratelimit-remaining', 'x-ratelimit-limit'] },
  { venue: 'okx', sym: 'LAYER-USDT-SWAP', url: (s) => `https://www.okx.com/api/v5/market/books?instId=${s}&sz=20`, hdr: [] },
  { venue: 'krakenfutures', sym: 'PF_XBTUSD', url: (s) => `https://futures.kraken.com/derivatives/api/v3/orderbook?symbol=${s}`, hdr: ['x-ratelimit-limit', 'x-ratelimit-remaining'] },
  { venue: 'krakenfutures', sym: 'PF_LAYERUSD', url: (s) => `https://futures.kraken.com/derivatives/api/v3/orderbook?symbol=${s}`, hdr: [] },
  { venue: 'coinbase', sym: 'BTC-PERP-INTX', url: (s) => `https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id=${s}&limit=20`, hdr: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'ratelimit-limit'] },
  { venue: 'coinbase', sym: 'S-PERP-INTX', url: (s) => `https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id=${s}&limit=20`, hdr: [] },
];

function levels(venue, body) {
  const j = JSON.parse(body);
  switch (venue) {
    case 'binance-linear':
    case 'binance-inverse': return { bids: j.bids, asks: j.asks, meta: { lastUpdateId: j.lastUpdateId, E: j.E, T: j.T } };
    case 'bybit': return { bids: j.result?.b, asks: j.result?.a, meta: { retCode: j.retCode, ts: j.result?.ts, u: j.result?.u, seq: j.result?.seq, cts: j.result?.cts } };
    case 'okx': return { bids: j.data?.[0]?.bids, asks: j.data?.[0]?.asks, meta: { code: j.code, ts: j.data?.[0]?.ts } };
    case 'krakenfutures': return { bids: j.orderBook?.bids, asks: j.orderBook?.asks, meta: { result: j.result, serverTime: j.serverTime } };
    case 'coinbase': return { bids: j.pricebook?.bids, asks: j.pricebook?.asks, meta: { time: j.pricebook?.time, product_id: j.pricebook?.product_id } };
  }
}

async function timed(url) {
  const t0 = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'depth-probe/1' } });
  const body = await res.text();
  const ms = performance.now() - t0;
  return { ms, status: res.status, body, headers: res.headers };
}

async function probe(t) {
  const url = t.url(t.sym);
  const out = { venue: t.venue, sym: t.sym, url };
  try {
    const cold = await timed(url);
    out.coldMs = +cold.ms.toFixed(0);
    out.status = cold.status;
    out.bytes = cold.body.length;
    const warm = [];
    for (let i = 0; i < N_WARM; i++) warm.push((await timed(url)).ms);
    warm.sort((a, b) => a - b);
    out.warmMs = { min: +warm[0].toFixed(0), med: +warm[Math.floor(warm.length / 2)].toFixed(0), max: +warm[warm.length - 1].toFixed(0) };
    const hdrs = {};
    for (const h of t.hdr) { const v = cold.headers.get(h); if (v !== null) hdrs[h] = v; }
    out.rateHeaders = hdrs;
    out.allHeaderNames = [...cold.headers.keys()].filter((k) => /limit|weight|rate|retry/i.test(k));
    if (cold.status === 200) {
      const L = levels(t.venue, cold.body);
      out.bidLevels = L.bids?.length; out.askLevels = L.asks?.length;
      out.bid0 = L.bids?.[0]; out.bid1 = L.bids?.[1]; out.ask0 = L.asks?.[0]; out.ask1 = L.asks?.[1];
      out.meta = L.meta;
    } else {
      out.bodyHead = cold.body.slice(0, 300);
    }
  } catch (e) {
    out.error = String(e?.message ?? e);
  }
  return out;
}

const results = await Promise.all(targets.map(probe));
for (const r of results) console.log(JSON.stringify(r));
