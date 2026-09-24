// Paymium public REST probe: the CCXT catalog, the v2 market list, latency, the depth reply and its version counter, the ticker, errors and the server clock.
// Public, unauthenticated, read-only. One request at a time, about one per second, under the documented 86,400 calls per day per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/paymium/rest-probe.mjs [catalog|latency|book|errors|all]
//   catalog  CCXT 4.5.68 loadMarkets and fees, /api/v2/markets, /currencies and /countries summaries. About 5 s.
//   latency  DNS, a cold ticker, ten warm depth calls with rate limit headers, an If-None-Match retry. About 15 s.
//   book     20 depth polls interleaved with 20 ticker polls, a 1.1 s pause after each call: levels, order, version steps, touch changes, ticker against depth. About 90 s.
//   errors   unknown currency, a currency with no book, unknown paths, the v2 ticker and trades, a limit parameter, the trades and OHLCV replies, and the Date header against the local clock. About 30 s.
// Recorded in docs/profiles/paymium/rest.md and fees.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const V1 = 'https://paymium.com/api/v1';
const V2 = 'https://paymium.com/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

async function get(url, headers = {}) {
  const started = performance.now();
  const sentAt = Date.now();
  const res = await fetch(url, { headers });
  const text = await res.text();
  const ms = Math.round(performance.now() - started);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, body, headers: res.headers, sentAt, recvAt: Date.now() };
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function catalog() {
  const ex = new ccxt.paymium();
  const markets = await ex.loadMarkets();
  const rows = Object.values(markets).map((m) => ({
    id: m.id, symbol: m.symbol, type: m.type, spot: m.spot, swap: m.swap, linear: m.linear, active: m.active,
    contractSize: m.contractSize, taker: m.taker, maker: m.maker, precision: m.precision, limits: m.limits,
  }));
  log('ccxt', { version: ccxt.version, count: rows.length, rows, feesTrading: ex.fees.trading, has: { swap: ex.has.swap, future: ex.has.future, fetchMarkets: ex.has.fetchMarkets, fetchCurrencies: ex.has.fetchCurrencies, watchOrderBook: ex.has.watchOrderBook ?? null } });
  log('ccxt-pro', { paymiumInPro: Boolean(ccxt.pro && ccxt.pro.paymium) });

  const v2 = await get(`${V2}/markets`);
  log('v2-markets', { status: v2.status, ms: v2.ms, bytes: v2.bytes, body: v2.body });
  await sleep(1100);
  const cur = await get(`${V1}/currencies`);
  const cs = Array.isArray(cur.body) ? cur.body : [];
  log('currencies', { status: cur.status, ms: cur.ms, count: cs.length, codes: cs.map((c) => `${c.code}:${c.type}`).join(','), tradingPairs: [...new Set(cs.flatMap((c) => c.trading ?? []))], swapPairs: new Set(cs.flatMap((c) => c.swap ?? [])).size, keys: cs[0] ? Object.keys(cs[0]).join(',') : null });
  await sleep(1100);
  const co = await get(`${V1}/countries`);
  const all = Array.isArray(co.body) ? co.body : [];
  const pick = (iso) => all.find((c) => c.iso_alpha2 === iso)?.accepted;
  log('countries', { status: co.status, count: all.length, accepted: all.filter((c) => c.accepted).length, US: pick('US'), CA: pick('CA'), FR: pick('FR'), GB: pick('GB'), refused: all.filter((c) => !c.accepted).map((c) => c.iso_alpha2).join(',') });
}

async function latency() {
  const host = 'paymium.com';
  const t = performance.now();
  const addrs = await lookup(host, { all: true });
  log('dns', { host, ms: Math.round(performance.now() - t), addrs: addrs.map((a) => a.address) });
  const cold = await get(`${V1}/data/eur/ticker`);
  log('cold', { url: 'ticker', status: cold.status, ms: cold.ms, bytes: cold.bytes });
  const times = [];
  let last;
  for (let i = 0; i < 10; i++) {
    await sleep(1100);
    last = await get(`${V1}/data/eur/depth`);
    times.push(last.ms);
    if (i === 0 || i === 9) {
      log('depth-headers', { i, status: last.status, limit: last.headers.get('x-ratelimit-limit'), remaining: last.headers.get('x-ratelimit-remaining'), etag: last.headers.get('etag'), cache: last.headers.get('cache-control'), runtime: last.headers.get('x-runtime'), apiVersion: last.headers.get('api-version'), cfRay: last.headers.get('cf-ray') });
    }
  }
  log('warm-depth', { n: times.length, min: Math.min(...times), median: pct(times, 50), p90: pct(times, 90), max: Math.max(...times), bytes: last.bytes });
  await sleep(1100);
  const cond = await get(`${V1}/data/eur/depth`, { 'If-None-Match': last.headers.get('etag') });
  log('if-none-match', { status: cond.status, ms: cond.ms, bytes: cond.bytes });
}

async function book() {
  const depths = [];
  const tickers = [];
  for (let i = 0; i < 20; i++) {
    const d = await get(`${V1}/data/eur/depth`);
    depths.push(d);
    await sleep(1100);
    const tk = await get(`${V1}/data/eur/ticker`);
    tickers.push({ tk, depthBefore: d });
    await sleep(1100);
  }
  const ok = depths.filter((d) => d.status === 200 && d.body);
  const bidsDesc = ok.every((d) => d.body.bids.every((l, i, a) => i === 0 || Number(a[i - 1].price) > Number(l.price)));
  const asksAsc = ok.every((d) => d.body.asks.every((l, i, a) => i === 0 || Number(a[i - 1].price) < Number(l.price)));
  const crossed = ok.filter((d) => Number(d.body.bids[0]?.price) >= Number(d.body.asks[0]?.price)).length;
  const versions = ok.map((d) => d.body.version);
  const steps = versions.slice(1).map((v, i) => v - versions[i]);
  let touchChanges = 0;
  for (let i = 1; i < ok.length; i++) {
    const a = ok[i - 1].body;
    const b = ok[i].body;
    if (a.bids[0].price !== b.bids[0].price || a.bids[0].amount !== b.bids[0].amount || a.asks[0].price !== b.asks[0].price || a.asks[0].amount !== b.asks[0].amount) touchChanges++;
  }
  const spreadsPpm = ok.map((d) => Math.round((Number(d.body.asks[0].price) / Number(d.body.bids[0].price) - 1) * 1e7) / 10);
  const touchNotional = ok.map((d) => Math.round(Number(d.body.bids[0].price) * Number(d.body.bids[0].amount)));
  const levelTypes = new Set(ok.flatMap((d) => [...d.body.bids.slice(0, 3), ...d.body.asks.slice(0, 3)].map((l) => `${typeof l.price}/${typeof l.amount}/${Object.keys(l).join(',')}`)));
  const b20 = ok.map((d) => {
    let q = 0;
    for (const l of d.body.bids.slice(0, 20)) q += Number(l.price) * Number(l.amount);
    return Math.round(q);
  });
  log('depth', {
    polls: depths.length,
    statuses: [...new Set(depths.map((d) => d.status))],
    ms: { min: Math.min(...depths.map((d) => d.ms)), median: pct(depths.map((d) => d.ms), 50), max: Math.max(...depths.map((d) => d.ms)) },
    bids: [...new Set(ok.map((d) => d.body.bids.length))],
    asks: [...new Set(ok.map((d) => d.body.asks.length))],
    market: ok[0]?.body.market,
    topKeys: ok[0] ? Object.keys(ok[0].body) : null,
    levelTypes: [...levelTypes],
    bidsDesc, asksAsc, crossed,
    versionFirst: versions[0], versionLast: versions[versions.length - 1],
    versionSteps: { min: Math.min(...steps), median: pct(steps, 50), max: Math.max(...steps), zero: steps.filter((s) => s === 0).length, negative: steps.filter((s) => s < 0).length },
    touchChanges: `${touchChanges} of ${ok.length - 1}`,
    spreadPpm: { min: Math.min(...spreadsPpm), median: pct(spreadsPpm, 50), max: Math.max(...spreadsPpm) },
    bestBidNotionalEur: { min: Math.min(...touchNotional), median: pct(touchNotional, 50), max: Math.max(...touchNotional) },
    top20BidNotionalEur: { min: Math.min(...b20), median: pct(b20, 50), max: Math.max(...b20) },
    lastBidPrice: ok[0]?.body.bids.at(-1)?.price,
    lastAskPrice: ok[0]?.body.asks.at(-1)?.price,
  });
  const tks = tickers.filter((x) => x.tk.status === 200 && x.tk.body);
  const fields = Object.keys(tks[0]?.tk.body ?? {});
  const changed = {};
  for (const f of fields) changed[f] = new Set(tks.map((x) => x.tk.body[f])).size;
  const bidMatches = tks.filter((x) => Number(x.tk.body.bid) === Number(x.depthBefore.body?.bids[0]?.price)).length;
  const askMatches = tks.filter((x) => Number(x.tk.body.ask) === Number(x.depthBefore.body?.asks[0]?.price)).length;
  const atValues = [...new Set(tks.map((x) => x.tk.body.at))].map((a) => `${a}=${new Date(a * 1000).toISOString()}`);
  log('ticker', {
    polls: tickers.length,
    ms: { min: Math.min(...tickers.map((x) => x.tk.ms)), median: pct(tickers.map((x) => x.tk.ms), 50), max: Math.max(...tickers.map((x) => x.tk.ms)) },
    fields: fields.join(','),
    distinctValues: changed,
    atValues,
    bidEqualsDepthBidOneSecondEarlier: `${bidMatches} of ${tks.length}`,
    askEqualsDepthAskOneSecondEarlier: `${askMatches} of ${tks.length}`,
    sample: tks[0]?.tk.body,
  });
}

async function errors() {
  const cases = [
    ['unknown currency', `${V1}/data/nope/depth`],
    ['currency with no book', `${V1}/data/eth/ticker`],
    ['btc alias', `${V1}/data/btc/depth`],
    ['pair spelling', `${V1}/data/BTC-EUR/depth`],
    ['unknown v1 path', `${V1}/data/eur/book`],
    ['unknown v2 path', `${V2}/markets/BTC-EUR/depth`],
    ['v2 ticker', `${V2}/markets/BTC-EUR/ticker`],
    ['v2 trades', `${V2}/markets/BTC-EUR/trades`],
    ['v1 prices', `${V1}/prices`],
    ['limit param', `${V1}/data/eur/depth?limit=5`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    const same = ['btc alias', 'pair spelling', 'limit param'].includes(name) ? { market: r.body?.market, bids: r.body?.bids?.length, asks: r.body?.asks?.length } : name === 'v2 trades' ? { rows: r.body?.length, first: r.body?.[0] } : undefined;
    log('case', { name, url, status: r.status, ms: r.ms, contentType: r.headers.get('content-type'), body: same ? undefined : r.text.slice(0, 220), same });
    await sleep(1100);
  }
  const tr = await get(`${V1}/data/eur/trades`);
  const trades = Array.isArray(tr.body) ? tr.body : [];
  const newest = trades.reduce((m, t) => Math.max(m, t.created_at_int ?? 0), 0);
  const oldest = trades.reduce((m, t) => Math.min(m, t.created_at_int ?? Infinity), Infinity);
  log('trades', { status: tr.status, ms: tr.ms, bytes: tr.bytes, count: trades.length, keys: trades[0] ? Object.keys(trades[0]).join(',') : null, oldest: new Date(oldest * 1000).toISOString(), newest: new Date(newest * 1000).toISOString() });
  // Which window the ticker's open, high, low and volume cover: the UTC day or the trailing 24 h.
  const nowS = Math.floor(Date.now() / 1000);
  const dayStart = nowS - (nowS % 86400);
  const window = (from) => {
    const ts = trades.filter((t) => t.created_at_int >= from).sort((a, b) => a.created_at_int - b.created_at_int);
    const px = ts.map((t) => Number(t.price));
    return { trades: ts.length, volume: Number(ts.reduce((v, t) => v + Number(t.traded_btc), 0).toFixed(8)), open: ts[0]?.price, high: Math.max(...px), low: Math.min(...px) };
  };
  await sleep(1100);
  const tk = await get(`${V1}/data/eur/ticker`);
  log('ticker-window', { ticker: { open: tk.body?.open, high: tk.body?.high, low: tk.body?.low, volume: tk.body?.volume }, utcDay: window(dayStart), trailing24h: window(nowS - 86400) });
  await sleep(1100);
  const oh = await get(`${V1}/data/eur/ohlcv?interval=1m`);
  const rows = Array.isArray(oh.body) ? oh.body : [];
  log('ohlcv', { status: oh.status, ms: oh.ms, rows: rows.length, first: rows[0], last: rows.at(-1) });
  await sleep(1100);
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${V1}/data/eur/ticker`);
    const server = Date.parse(r.headers.get('date'));
    offsets.push(server - (r.sentAt + r.recvAt) / 2);
    await sleep(1100);
  }
  log('clock', { note: 'Date header has one second resolution, so the offset is bounded to about plus or minus 500 ms plus half the round trip', offsetsMs: offsets.map(Math.round) });
}

const mode = process.argv[2] ?? 'all';
log('start', { mode, iso: new Date().toISOString() });
if (mode === 'catalog' || mode === 'all') await catalog();
if (mode === 'latency' || mode === 'all') await latency();
if (mode === 'book' || mode === 'all') await book();
if (mode === 'errors' || mode === 'all') await errors();
