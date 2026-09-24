// Koinpark REST probe: host and latency, the public catalog, the book call and its parameters, errors, rate limit headers, clock offset, and how the book changes over a minute.
// Public, unauthenticated, read-only. The API allows 1,440 requests per day per client (header RateLimit-Policy), so each mode spends at most 26 requests and prints what remains.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/koinpark/rest-probe.mjs [catalog|poll]
//   catalog  DNS, cold and warm timings, markets, ticker, asset, book parameters, trades, unknown pairs, headers, clock. About 25 requests.
//   poll     the REST book of one own-book pair and one Binance-mirror pair every 5 s for 60 s, 26 requests, plus Binance depth beside the mirror.
// It needs no package from server/node_modules, since Node's fetch is enough and CCXT 4.5.68 has no Koinpark class.
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/koinpark/rest.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const HOST = 'api.koinpark.com';
const API = `https://${HOST}/publicApi`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const lvl = (x) => [Number(x[0]), Number(x[1])];
let remaining = null;

async function get(path, name) {
  const t0 = performance.now();
  const r = await fetch(`${API}/${path}`);
  const text = await r.text();
  const ms = Math.round(performance.now() - t0);
  remaining = r.headers.get('ratelimit-remaining') ?? remaining;
  if (OUT && name) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${name}.json`), text);
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, ms, bytes: text.length, json, text, headers: r.headers, at: Date.now() };
}

function bookStats(j) {
  const d = j?.data ?? {};
  const bids = (d.bids ?? []).map(lvl);
  const asks = (d.asks ?? []).map(lvl);
  return {
    bids: bids.length,
    asks: asks.length,
    bidDesc: bids.every((x, i) => i === 0 || bids[i - 1][0] > x[0]),
    askAsc: asks.every((x, i) => i === 0 || asks[i - 1][0] < x[0]),
    top: [bids[0], asks[0]],
    spreadPpm: bids[0] && asks[0] ? Math.round(((asks[0][0] - bids[0][0]) / bids[0][0]) * 1e6) : null,
    ts: d.timestamp ?? j?.timestamp,
    rawBid0: JSON.stringify(d.bids?.[0]),
  };
}

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addrs: addrs.map((a) => a.address) });

  const cold = await get('markets', 'markets');
  const warm = [];
  for (let i = 0; i < 2; i++) warm.push((await get('markets')).ms);
  log('latency_markets', { status: cold.status, coldMs: cold.ms, warmMs: warm, bytes: cold.bytes, policy: cold.headers.get('ratelimit-policy'), limit: cold.headers.get('ratelimit-limit'), remaining: cold.headers.get('ratelimit-remaining'), reset: cold.headers.get('ratelimit-reset'), cf: cold.headers.get('cf-cache-status'), cacheControl: cold.headers.get('cache-control'), etag: cold.headers.get('etag') });

  const rows = cold.json.data;
  const byQuote = {};
  for (const r of rows) {
    const q = r.trading_pairs.split('_')[1];
    byQuote[q] = (byQuote[q] ?? 0) + 1;
  }
  const askOverLast = rows.filter((r) => r.last_price > 0).map((r) => r.lowest_ask / r.last_price);
  const bidOverLast = rows.filter((r) => r.last_price > 0).map((r) => r.highest_bid / r.last_price);
  log('markets', {
    rows: rows.length,
    byQuote,
    keys: Object.keys(rows[0]),
    zeroVolume: rows.filter((r) => !(Number(r.quote_volume) > 0)).length,
    duplicates: rows.length - new Set(rows.map((r) => r.trading_pairs)).size,
    lowestAskOverLastMedian: median(askOverLast),
    highestBidOverLastMedian: median(bidOverLast),
    askExactly1pct: askOverLast.filter((x) => Math.abs(x - 1.01) < 1e-9).length,
    btc: JSON.stringify(rows.find((r) => r.trading_pairs === 'BTC_USDT')),
  });

  const tick = await get('ticker', 'ticker');
  const t = tick.json.tickers;
  log('ticker', { status: tick.status, ms: tick.ms, bytes: tick.bytes, rows: Object.keys(t).length, frozen: Object.values(t).filter((x) => x.isFrozen !== 0).length, keys: Object.keys(Object.values(t)[0]), inMarketsNotTicker: rows.filter((r) => !t[r.trading_pairs]).map((r) => r.trading_pairs), inTickerNotMarkets: Object.keys(t).filter((k) => !rows.some((r) => r.trading_pairs === k)) });

  const asset = await get('asset', 'asset');
  const a = asset.json.assets;
  const fees = {};
  for (const x of a) fees[`${x.maker_fee}/${x.taker_fee}`] = (fees[`${x.maker_fee}/${x.taker_fee}`] ?? 0) + 1;
  log('asset', { status: asset.status, ms: asset.ms, bytes: asset.bytes, rows: a.length, keys: Object.keys(a[0]), makerTakerCounts: fees, btc: JSON.stringify(a.find((x) => x.currency_symbol === 'BTC')), usdt: JSON.stringify(a.find((x) => x.currency_symbol === 'USDT')) });

  for (const q of ['market_pair=BTC_USDT', 'market_pair=BTC_USDT&limit=5', 'market_pair=BTC_USDT&limit=20', 'market_pair=BTC_USDT&limit=500', 'market_pair=BTC_USDT&level=1', 'market_pair=BTC_USDT&level=3', 'market_pair=ETH_BTC', 'market_pair=BTC_USDT&limit=7']) {
    const r = await get(`orderbook?${q}`, `orderbook_${q.replace(/[=&]/g, '_')}`);
    log('orderbook', { q, status: r.status, ms: r.ms, bytes: r.bytes, keys: r.json && Object.keys(r.json), ...bookStats(r.json), tsAgeMs: r.json?.timestamp ? r.at - r.json.timestamp : null, etag: r.headers.get('etag') });
  }

  const tr = await get('trades?market_pair=BTC_USDT', 'trades');
  const td = tr.json?.data ?? [];
  const ts = td.map((x) => x.timestamp);
  log('trades', { status: tr.status, ms: tr.ms, rows: td.length, keys: td[0] && Object.keys(td[0]), newest: Math.max(...ts), oldest: Math.min(...ts), ascendingById: td.every((x, i) => i === 0 || td[i - 1].trade_id < x.trade_id), first: JSON.stringify(td[0]), last: JSON.stringify(td.at(-1)) });

  for (const [path, name] of [
    ['orderbook?market_pair=NOPE_USDT', 'err_unknown_pair'],
    ['orderbook', 'err_no_pair'],
    ['orderbook?market_pair=btc_usdt', 'err_lowercase'],
    ['orderbook?market_pair=BTC-USDT', 'err_dash'],
    ['Single_trade_pair?market_pair=NOPE_USDT', 'err_single_pair'],
    ['nope', 'err_path'],
  ]) {
    const r = await get(path, name);
    log('error_shape', { path, status: r.status, ms: r.ms, body: r.text.slice(0, 240) });
  }

  // Clock: the book's own timestamp and the HTTP Date header against local receive time.
  const offsets = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await get('orderbook?market_pair=BTC_USDT&limit=5');
    const mid = (t0 + r.at) / 2;
    offsets.push({ rttMs: r.at - t0, bookTsMinusMidMs: r.json.timestamp - mid, dateHeader: r.headers.get('date') });
    await sleep(500);
  }
  log('clock', { offsets, remaining });
}

async function poll() {
  const OWN = 'BTC_USDT';
  const MIRROR = 'ETH_BTC';
  const prev = {};
  const out = { [OWN]: [], [MIRROR]: [] };
  const t0 = Date.now();
  for (let i = 0; i < 13; i++) {
    for (const pair of [OWN, MIRROR]) {
      const r = await get(`orderbook?market_pair=${pair}&limit=20`);
      const d = r.json?.data ?? {};
      const key = JSON.stringify([d.bids, d.asks]);
      const topKey = JSON.stringify([d.bids?.[0], d.asks?.[0]]);
      const row = { tMs: r.at - t0, ms: r.ms, changed: prev[pair] !== undefined && prev[pair] !== key, topChanged: prev[`${pair}top`] !== undefined && prev[`${pair}top`] !== topKey, tsAgeMs: r.json?.timestamp ? r.at - r.json.timestamp : null, levels: `${d.bids?.length}/${d.asks?.length}` };
      if (pair === MIRROR) {
        const b = await (await fetch('https://api.binance.com/api/v3/depth?symbol=ETHBTC&limit=20')).json();
        const bb = b.bids.map(lvl);
        const kb = (d.bids ?? []).map(lvl);
        row.pricesOnBinance = kb.filter((x) => bb.some((y) => y[0] === x[0])).length;
        row.sizeRatios = kb.slice(0, 3).map((x) => {
          const y = bb.find((z) => z[0] === x[0]);
          return y ? Math.round((x[1] / y[1]) * 1000) / 1000 : null;
        });
      }
      prev[pair] = key;
      prev[`${pair}top`] = topKey;
      out[pair].push(row);
    }
    await sleep(Math.max(0, t0 + (i + 1) * 5000 - Date.now()));
  }
  for (const pair of [OWN, MIRROR]) {
    const rows = out[pair];
    log('poll_summary', { pair, polls: rows.length, bookChanged: rows.filter((r) => r.changed).length, topChanged: rows.filter((r) => r.topChanged).length, msMedian: median(rows.map((r) => r.ms)), msMax: Math.max(...rows.map((r) => r.ms)), tsAgeMs: [Math.min(...rows.map((r) => r.tsAgeMs)), median(rows.map((r) => r.tsAgeMs)), Math.max(...rows.map((r) => r.tsAgeMs))], levels: [...new Set(rows.map((r) => r.levels))] });
    if (pair === MIRROR) log('poll_mirror', { pricesOnBinance: rows.map((r) => r.pricesOnBinance), sizeRatiosFirst: rows.slice(0, 4).map((r) => r.sizeRatios) });
  }
  log('budget', { remaining });
}

const mode = process.argv[2] ?? 'catalog';
log('start', { mode, iso: new Date().toISOString() });
await { catalog, poll }[mode]();
log('end', { iso: new Date().toISOString() });
