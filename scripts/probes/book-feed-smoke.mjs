// Runs the compiled book feeds against the live venues with a stub engine, and reports what reached updateBook.
// Per venue: books published, distinct markets, one sided books, resyncs, socket closes, and the top of the BTC book at the end.
// Build first from server/: pnpm run build. Then run from anywhere: node scripts/probes/book-feed-smoke.mjs [seconds]
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const dist = (p) => require(new URL(`../../server/dist/${p}`, import.meta.url).pathname);

const { Logger } = require('@nestjs/common');
const { BinanceFeed } = dist('venues/binance/binance.js');
const { BybitFeed } = dist('venues/bybit/bybit.js');
const { OkxFeed } = dist('venues/okx/okx.js');
const { KrakenFuturesFeed } = dist('venues/krakenfutures/krakenfutures.js');
const { CoinbaseFeed } = dist('venues/coinbase/coinbase.js');

const RUN_MS = (Number(process.argv[2]) || 90) * 1000;
const DEPTH_LEVELS = 20;

const json = async (url) => (await fetch(url, { signal: AbortSignal.timeout(15000) })).json();

async function universe() {
  const out = {};
  const b = await json('https://fapi.binance.com/fapi/v1/exchangeInfo');
  out.binance = b.symbols.filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING').map((s) => [s.symbol, s.baseAsset, s.quoteAsset]);
  let cursor = '';
  const bybit = [];
  do {
    const r = await json(`https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
    bybit.push(...r.result.list.filter((i) => i.status === 'Trading' && i.contractType === 'LinearPerpetual').map((i) => [i.symbol, i.baseCoin, i.quoteCoin]));
    cursor = r.result.nextPageCursor;
  } while (cursor);
  out.bybit = bybit;
  const o = await json('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
  out.okx = o.data.filter((i) => i.state === 'live').map((i) => [i.instId, i.ctValCcy, i.settleCcy]);
  const k = await json('https://futures.kraken.com/derivatives/api/v3/instruments');
  out.krakenfutures = k.instruments.filter((i) => i.tradeable && i.symbol.startsWith('PF_')).map((i) => [i.symbol, i.symbol.slice(3, -3), 'USD']);
  const c = await json('https://api.coinbase.com/api/v3/brokerage/market/products?product_type=FUTURE&contract_expiry_type=PERPETUAL');
  out.coinbase = (c.products ?? []).filter((p) => p.product_id.endsWith('-INTX') && p.status !== 'offline').map((p) => [p.product_id, p.product_id.split('-')[0], 'USDC']);
  return out;
}

const u = await universe();
const feeds = [
  ['binance', 'Binance', BinanceFeed, 'BTCUSDT'],
  ['bybit', 'Bybit', BybitFeed, 'BTCUSDT'],
  ['okx', 'OKX', OkxFeed, 'BTC-USDT-SWAP'],
  ['krakenfutures', 'Kraken Futures', KrakenFuturesFeed, 'PF_XBTUSD'],
  ['coinbase', 'Coinbase Advanced', CoinbaseFeed, 'BTC-PERP-INTX'],
];

const stats = {};
const resyncs = {};
const closes = {};
const origWarn = Logger.prototype.warn;
const origError = Logger.prototype.error;
const origLog = Logger.prototype.log;
Logger.prototype.warn = function (msg, ...rest) {
  if (msg && typeof msg === 'object' && msg.event === 'book_resync') {
    const venue = String(this.context ?? '').replace('WS ', '');
    resyncs[venue] = (resyncs[venue] ?? 0) + 1;
  }
  return origWarn.call(this, msg, ...rest);
};
Logger.prototype.error = function (msg, ...rest) {
  return origError.call(this, msg, ...rest);
};
Logger.prototype.log = function (msg, ...rest) {
  return origLog.call(this, msg, ...rest);
};

const started = [];
for (const [id, name, Feed, btc] of feeds) {
  const st = (stats[id] = { books: 0, markets: new Set(), oneSided: 0, maxLevels: 0, btc: null, staleCalls: 0, staleMarkets: 0 });
  const engine = {
    depthLevels: DEPTH_LEVELS,
    updateBook(venueId, rawMarketId, bids, asks, recvTs) {
      st.books++;
      st.markets.add(rawMarketId);
      if (bids.length === 0 || asks.length === 0) st.oneSided++;
      st.maxLevels = Math.max(st.maxLevels, bids.length, asks.length);
      if (rawMarketId === btc) st.btc = { bids: bids.slice(0, 2), asks: asks.slice(0, 2), levels: [bids.length, asks.length], recvTs };
      return true;
    },
    markStale(venueId, ids) {
      st.staleCalls++;
      st.staleMarkets += ids.length;
      closes[venueId] = (closes[venueId] ?? 0) + 1;
    },
  };
  const markets = u[id].map(([rawMarketId, base, quote]) => ({ venueId: id, rawMarketId, base, quote, takerPpm: 500, linear: true, contractSize: 1 }));
  const feed = new Feed({ id, name, markets }, engine);
  feed.start();
  started.push(feed);
}

const t0 = Date.now();
await new Promise((f) => setTimeout(f, RUN_MS));
for (const feed of started) feed.stop();
await new Promise((f) => setTimeout(f, 1500));

const sec = (Date.now() - t0) / 1000;
for (const [id] of feeds) {
  const st = stats[id];
  console.log(JSON.stringify({
    venue: id,
    seconds: +sec.toFixed(0),
    subscribed: u[id].length,
    marketsWithBook: st.markets.size,
    booksPerSec: +(st.books / sec).toFixed(0),
    oneSided: st.oneSided,
    maxLevelsSeen: st.maxLevels,
    resyncs: resyncs[id] ?? 0,
    markStaleCalls: st.staleCalls,
    btc: st.btc,
  }));
}
process.exit(0);
