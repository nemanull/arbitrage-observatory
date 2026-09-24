// Hata public REST probe: the pair catalog of both platforms, latency, the REST book, caching, errors, a gentle rate test and the clock.
// Public, unauthenticated, read-only. The only POST is the documented public WebSocket token call, which needs no account.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hata/rest-probe.mjs [catalog|latency|book|limits|time]
//   catalog  exchange-info on both platforms, the CCXT exchange list, and the global prices beside Binance spot.
//   latency  DNS, then one cold and ten warm reads of exchange-info and of one book on each platform, one second apart.
//   book     the REST book of every global pair and the three busiest Malaysia pairs, is_buy, error shapes, and 30 reads at 1 Hz on three books for caching and crossing.
//   limits   20 exchange-info reads at 4 per second, printing every status and any rate header.
//   time     the Date header against the local clock, the token expiry, and a few time paths that are not documented.
// Prints compact JSON lines. Recorded in docs/profiles/hata/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOSTS = { ww: 'https://api.hata.io', my: 'https://my-api.hata.io' };
const INFO = '/orderbook/api/v2/exchange-info';
const BOOK = '/orderbook/api/orderbook';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const pick = (arr, q) => { const v = [...arr].sort((a, b) => a - b); return v.length ? v[Math.floor(q * (v.length - 1))] : null; };

async function get(url, init) {
  const a = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - a);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, bytes: text.length, text, json, headers: Object.fromEntries(res.headers) };
}

const rateHeaders = (h) => Object.fromEntries(Object.entries(h).filter(([k]) => /rate|limit|retry|cache|age|etag|cf-cache/i.test(k)));

async function catalog() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, hata: ccxt.exchanges.filter((e) => /hata/i.test(e)) });
  const lists = {};
  for (const [p, host] of Object.entries(HOSTS)) {
    const r = await get(host + INFO);
    const rows = r.json?.data ?? [];
    lists[p] = rows;
    const quotes = {};
    for (const row of rows) quotes[row.quote] = (quotes[row.quote] ?? 0) + 1;
    log('catalog', { platform: p, status: r.status, ms: r.ms, bytes: r.bytes, topKeys: Object.keys(r.json ?? {}), statusField: r.json?.status, pairs: rows.length, quotes, fields: Object.keys(rows[0] ?? {}), idIsBasePlusQuote: rows.every((x) => x.txpair === x.base + x.quote), labels: [...new Set(rows.flatMap((x) => x.labels))], quoteVolumeSum: Math.round(rows.reduce((s, x) => s + Number(x.quote_volume), 0)) });
    for (const row of rows) log('pair', { platform: p, id: row.txpair, price: row.price, min_price: row.min_price, max_price: row.max_price, percentage: row.percentage, base_volume: row.base_volume, quote_volume: row.quote_volume, tick: row.tick_size, step: row.min_step, min_qty: row.min_qty, min_notional: row.min_notional, max_notional: row.max_notional });
  }
  // Global USDT pairs beside Binance spot, to show how far the last trade and the touch sit from the wider market.
  const ids = lists.ww.filter((x) => x.quote === 'USDT').map((x) => x.txpair);
  const refMap = new Map();
  const refStatus = {};
  for (const id of ids) {
    const ref = await get(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${id}`);
    refStatus[id] = ref.status;
    if (ref.status === 200) refMap.set(id, (Number(ref.json.bidPrice) + Number(ref.json.askPrice)) / 2);
  }
  log('reference', { source: 'api.binance.com bookTicker', status: refStatus, missing: ids.filter((i) => !refMap.has(i)) });
  for (const id of ids) {
    const b = await get(`${HOSTS.ww}${BOOK}?pair_name=${id}`);
    const bid = Number(b.json?.data?.bids?.[0]?.price), ask = Number(b.json?.data?.asks?.[0]?.price);
    const mid = refMap.get(id);
    const last = Number(lists.ww.find((x) => x.txpair === id).price);
    log('versusBinance', { id, binanceMid: mid, hataLast: last, lastPpm: mid ? Math.round((last / mid - 1) * 1e6) : null, hataBid: bid, hataAsk: ask, bidPpm: mid ? Math.round((bid / mid - 1) * 1e6) : null, askPpm: mid ? Math.round((ask / mid - 1) * 1e6) : null, spreadPpm: Math.round((ask / bid - 1) * 1e6) });
  }
}

async function latency() {
  for (const host of ['api.hata.io', 'my-api.hata.io', 'websocket.hata.io', 'websocket-my.hata.io']) {
    const a = performance.now();
    const addrs = await dns.resolve4(host).catch((e) => e.code);
    log('dns', { host, addrs, ms: Math.round(performance.now() - a) });
  }
  for (const [p, host] of Object.entries(HOSTS)) {
    for (const path of [INFO, `${BOOK}?pair_name=${p === 'ww' ? 'BTCUSDT' : 'XRPMYR'}`]) {
      const times = [];
      let first = null;
      for (let i = 0; i < 11; i++) {
        const r = await get(host + path);
        if (i === 0) first = { status: r.status, ms: r.ms, bytes: r.bytes };
        else times.push(r.ms);
        await sleep(1_000);
      }
      log('latency', { platform: p, path, cold: first, warm: { min: pick(times, 0), median: pick(times, 0.5), p90: pick(times, 0.9), max: pick(times, 1) } });
    }
  }
}

function orderOf(levels, desc) {
  for (let i = 1; i < levels.length; i++) {
    const a = Number(levels[i - 1].price), b = Number(levels[i].price);
    if (a === b) return 'duplicate';
    if (desc ? b > a : b < a) return 'unordered';
  }
  return desc ? 'descending' : 'ascending';
}

async function book() {
  const ww = (await get(HOSTS.ww + INFO)).json.data.map((x) => x.txpair);
  const my = (await get(HOSTS.my + INFO)).json.data.sort((a, b) => Number(b.quote_volume) - Number(a.quote_volume)).map((x) => x.txpair);
  const targets = ww.map((id) => ['ww', id]).concat(my.slice(0, 3).map((id) => ['my', id]));
  for (const [p, id] of targets) {
    const r = await get(`${HOSTS[p]}${BOOK}?pair_name=${id}`);
    const d = r.json?.data ?? {};
    const bids = d.bids ?? [], asks = d.asks ?? [];
    log('book', { platform: p, id, status: r.status, ms: r.ms, bytes: r.bytes, levels: [bids.length, asks.length], order: [orderOf(bids, true), orderOf(asks, false)], touch: [bids[0], asks[0]], spreadPpm: bids.length && asks.length ? Math.round((asks[0].price / bids[0].price - 1) * 1e6) : null, types: [typeof bids[0]?.price, typeof bids[0]?.qty], cache: rateHeaders(r.headers) });
  }
  for (const isBuy of ['true', 'false']) {
    const r = await get(`${HOSTS.my}${BOOK}?pair_name=${my[0]}&is_buy=${isBuy}`);
    log('isBuy', { is_buy: isBuy, status: r.status, levels: [r.json?.data?.bids?.length ?? null, r.json?.data?.asks?.length ?? null] });
  }
  for (const [name, url] of [['unknown', `${HOSTS.ww}${BOOK}?pair_name=NOPEUSDT`], ['lowercase', `${HOSTS.ww}${BOOK}?pair_name=btcusdt`], ['missing', `${HOSTS.ww}${BOOK}`], ['wrongPlatform', `${HOSTS.ww}${BOOK}?pair_name=BTCMYR`], ['unknownPath', `${HOSTS.ww}/orderbook/api/v2/nope`]]) {
    const r = await get(url);
    log('bookError', { name, status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
  }
  // Caching: 30 reads at 1 Hz on the busiest pair of each platform, counting distinct replies.
  for (const [p, id] of [['ww', 'BTCUSDT'], ['ww', 'XRPUSDT'], ['my', my[0]]]) {
    const seen = [];
    const rtt = [];
    let crossed = 0;
    for (let i = 0; i < 30; i++) {
      const a = Date.now();
      const r = await get(`${HOSTS[p]}${BOOK}?pair_name=${id}`);
      rtt.push(r.ms);
      seen.push(JSON.stringify(r.json?.data));
      const d = r.json?.data;
      if (d?.bids?.length && d?.asks?.length && Number(d.bids[0].price) >= Number(d.asks[0].price)) crossed++;
      await sleep(Math.max(0, 1_000 - (Date.now() - a)));
    }
    let changes = 0;
    for (let i = 1; i < seen.length; i++) if (seen[i] !== seen[i - 1]) changes++;
    log('bookPoll', { platform: p, id, reads: seen.length, distinct: new Set(seen).size, changes, crossed, rtt: { median: pick(rtt, 0.5), max: pick(rtt, 1) } });
  }
}

async function limits() {
  const statuses = {};
  const seenHeaders = new Set();
  for (let i = 0; i < 20; i++) {
    const r = await get(HOSTS.ww + INFO);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    for (const k of Object.keys(rateHeaders(r.headers))) seenHeaders.add(`${k}: ${r.headers[k]}`);
    if (r.status !== 200) log('refused', { i, status: r.status, body: r.text.slice(0, 300), headers: rateHeaders(r.headers) });
    await sleep(250);
  }
  log('limits', { reads: 20, perSecond: 4, statuses, rateHeaders: [...seenHeaders] });
}

async function time() {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const a = Date.now();
    const r = await get(HOSTS.ww + INFO);
    const b = Date.now();
    offsets.push({ serverSec: Date.parse(r.headers.date) / 1000, localBefore: a / 1000, localAfter: b / 1000 });
    await sleep(1_100);
  }
  // The Date header has one second resolution, so the offset is bounded, not measured.
  const bound = offsets.map((o) => [Math.round((o.serverSec - o.localAfter) * 1000), Math.round((o.serverSec + 1 - o.localBefore) * 1000)]);
  log('dateHeader', { offsetBoundsMs: bound });
  for (const path of ['/orderbook/api/time', '/orderbook/api/v2/time', '/api/v1/time', '/orderbook/api/v2/ticker', '/orderbook/api/v2/tickers']) {
    const r = await get(HOSTS.ww + path);
    log('undocumentedPath', { path, status: r.status, body: r.text.slice(0, 120) });
  }
  const t = await get(HOSTS.ww + '/auth/api/v2/ww/user-stream-key', { method: 'POST' });
  log('token', { status: t.status, ms: t.ms, expiry: t.json?.data?.expiry, expiryMinusNowSec: t.json?.data?.expiry - Math.floor(Date.now() / 1000) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, latency, book, limits, time };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode });
