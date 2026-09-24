// BitDelta REST probe: host and latency, the derivatives catalog and per contract terms the website reads, the documented spot catalog, fee tiers, a one second poll of the derivatives quotes, the documented REST book, errors and headers, clock offset.
// Public, unauthenticated, read-only. The derivatives calls are the ones https://bitdelta.com/en/trade/derivatives/btc-usd makes for a visitor who is not logged in, and no documentation covers them.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitdelta/rest-probe.mjs [host|catalog|poll|book|errors|time]
//   host     DNS answers, then one cold and five warm requests to the derivatives snapshot and the documented spot ticker. About 10 s.
//   catalog  the derivatives snapshot, every contract's detail at about 2 requests a second, the documented spot pairs and the holding level fee tiers. About 50 s.
//   poll     the derivatives snapshot once a second for 60 s: reply time and size, how often each contract's bid, ask and price change. About 65 s.
//   book     the documented REST book for a spot pair and for a derivative symbol, and the documented summary and trades for a derivative symbol and a spot pair. About 5 s.
//   errors   unknown slug, missing slug, an undocumented website call that wants a key, rate limit headers. About 5 s.
//   time     the envelope timestamp and the Date header against the local clock over five requests. About 5 s.
// Set PROBE_OUT_DIR to keep trimmed raw replies. Recorded in docs/profiles/bitdelta/rest.md and fees.md.
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.bitdelta.com';
const FUT = `${API}/api/v1/futures/market`;
const OPEN = `${API}/open/api/v1`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const stats = (a) => (a.length ? { n: a.length, min: Math.min(...a), median: median(a), p90: pct(a, 0.9), max: Math.max(...a) } : { n: 0 });
const tally = (xs) => { const m = {}; for (const x of xs) { const k = JSON.stringify(x); m[k] = (m[k] ?? 0) + 1; } return m; };
const trim = (s, n = 400) => (s.length > n ? s.slice(0, n) + `…(${s.length} chars)` : s);

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text.slice(0, 2_000_000));
}

async function get(url) {
  const t0 = performance.now();
  const sentAt = Date.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const headers = {};
  for (const [k, v] of res.headers) if (/limit|retry|server|cache|age|cf-|date|content-encoding|x-/.test(k)) headers[k] = v;
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ms, bytes: text.length, text, json, headers, sentAt, recvAt: Date.now() };
}

async function host() {
  const addrs = await lookup('api.bitdelta.com', { all: true });
  log('dns', { host: 'api.bitdelta.com', addrs });
  const site = await lookup('bitdelta.com', { all: true });
  log('dns', { host: 'bitdelta.com', addrs: site });
  for (const url of [`${FUT}/snapshot`, `${OPEN}/ticker`]) {
    const times = [];
    for (let i = 0; i < 6; i++) {
      const r = await get(url);
      times.push(r.ms);
      if (i === 0) log('first', { url, status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers });
      await sleep(400);
    }
    log('latency', { url, coldMs: times[0], warm: stats(times.slice(1)) });
  }
}

async function catalog() {
  const snap = await get(`${FUT}/snapshot`);
  capture('fut-snapshot.json', snap.text);
  const d = snap.json.data;
  const fut = d.futures;
  log('fut_snapshot', { status: snap.status, bytes: snap.bytes, ms: snap.ms, keys: Object.keys(d), categories: d.categories, count: fut.length, byCategory: tally(fut.map((f) => f.category)), quote: tally(fut.map((f) => f.currency2)), chartResolutions: d.chart_resolutions, rowKeys: Object.keys(fut[0]) });
  // A symbol is six letters and does not always spell the base asset, so the base comes from currency1.
  const renamed = fut.filter((f) => f.symbol !== `${f.currency1}${f.currency2}`).map((f) => `${f.symbol}=${f.currency1}/${f.currency2}`);
  log('fut_symbols', { renamed: renamed.length, examples: renamed.slice(0, 40), standardDiffers: fut.filter((f) => f.standard_symbol && f.standard_symbol !== f.symbol).map((f) => `${f.symbol}:${f.standard_symbol}`) });
  const details = [];
  const pairMs = [];
  const pairBytes = [];
  for (const f of fut) {
    const r = await get(`${FUT}/pair?slug=${f.slug}`);
    pairMs.push(r.ms);
    pairBytes.push(r.bytes);
    if (r.status !== 200) { log('fut_pair_error', { slug: f.slug, status: r.status, body: trim(r.text) }); continue; }
    details.push(r.json.data.futures[0]);
    await sleep(330);
  }
  capture('fut-pairs.json', JSON.stringify(details));
  const fields = ['status', 'active', 'ismarketclosed', 'max_leverage', 'default_leverage', 'min_amount', 'max_amount', 'step', 'spread', 'buy_commission', 'sell_commission', 'total_buy_commission', 'buy_funding_fee', 'sell_funding_fee', 'buy_liquidation_fee', 'sell_liquidation_fee', 'tax_details', 'quotetype'];
  const summary = {};
  for (const k of fields) summary[k] = tally(details.map((x) => x[k]));
  log('fut_terms', { contracts: details.length, replyMs: stats(pairMs), bytes: stats(pairBytes), summary });
  log('fut_detail_keys', { keys: Object.keys(details[0]) });
  const odd = details.filter((x) => x.buy_funding_fee !== x.sell_funding_fee).map((x) => `${x.symbol} ${x.buy_funding_fee}/${x.sell_funding_fee}`);
  log('fut_funding_asymmetric', { n: odd.length, examples: odd.slice(0, 20) });
  const spreads = details.map((x) => Math.round(((x.ask - x.bid) / ((x.ask + x.bid) / 2)) * 1e6)).filter(Number.isFinite);
  log('fut_quote_spread_ppm', stats(spreads));

  const pairs = await get(`${OPEN}/pairs`);
  capture('spot-pairs.json', pairs.text);
  const p = pairs.json.data;
  log('spot_pairs', { status: pairs.status, bytes: pairs.bytes, ms: pairs.ms, count: p.length, status_: tally(p.map((x) => x.status)), quote: tally(p.map((x) => x.currency2)), fees: tally(p.map((x) => `${x.mfee}/${x.tfee}`)), totalFees: tally(p.map((x) => `${x.total_mfee}/${x.total_tfee}`)), oddFee: p.filter((x) => x.tfee !== 0.15).map((x) => `${x.symbol} ${x.mfee}/${x.tfee}`), taxDetails: tally(p.map((x) => (x.tax_details ?? []).length)) });
  const tiers = await get(`${API}/api/v1/public/holding-level`);
  capture('holding-level.json', tiers.text);
  log('holding_level', { status: tiers.status, tiers: tiers.json.data.level.map((t) => `${t.level_name}: ${t.amount} ${t.coin}, maker ${t.mfee} taker ${t.tfee}`) });
}

async function poll() {
  const seen = new Map(); // symbol to { bid, ask, price, changes }
  const times = [];
  const sizes = [];
  const ages = [];
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const tick = Date.now();
    const r = await get(`${FUT}/snapshot`);
    times.push(r.ms);
    sizes.push(r.bytes);
    if (r.status !== 200) { log('poll_error', { i, status: r.status, body: trim(r.text), headers: r.headers }); }
    else {
      const env = Date.parse(r.json.timestamp);
      ages.push(r.recvAt - env);
      for (const f of r.json.data.futures) {
        const s = seen.get(f.symbol) ?? { bid: null, ask: null, price: null, bidCh: 0, askCh: 0, priceCh: 0, closed: 0 };
        if (s.bid !== null && s.bid !== f.bid) s.bidCh++;
        if (s.ask !== null && s.ask !== f.ask) s.askCh++;
        if (s.price !== null && s.price !== f.price) s.priceCh++;
        if (f.ismarketclosed) s.closed++;
        Object.assign(s, { bid: f.bid, ask: f.ask, price: f.price });
        seen.set(f.symbol, s);
      }
    }
    const wait = 1000 - (Date.now() - tick);
    if (wait > 0) await sleep(wait);
  }
  log('poll', { polls: times.length, seconds: Math.round((Date.now() - t0) / 1000), replyMs: stats(times), bytes: stats(sizes), recvMinusEnvelopeMs: stats(ages), over1s: times.filter((t) => t > 1000).length, over2s: times.filter((t) => t > 2000).length });
  const rows = [...seen.entries()].map(([k, s]) => ({ k, ...s }));
  log('poll_changes', { contracts: rows.length, bidChanges: stats(rows.map((r) => r.bidCh)), priceChanges: stats(rows.map((r) => r.priceCh)), marketClosedReads: rows.reduce((a, r) => a + r.closed, 0) });
  for (const r of rows.filter((x) => /^(BTCUSD|ETHUSD|SOLUSD|ZENUSD|SNXUSD|IOSUSD|BTCETH)$/.test(x.k))) log('poll_contract', { symbol: r.k, bidCh: r.bidCh, askCh: r.askCh, priceCh: r.priceCh, last: [r.bid, r.ask, r.price] });
}

async function book() {
  const calls = [
    ['spot book', `${OPEN}/orderbook?symbol=BTCUSDT&level=2&depth=50`],
    ['spot book depth 20', `${OPEN}/orderbook?symbol=BTCUSDT&level=2&depth=20`],
    ['derivative book', `${OPEN}/orderbook?symbol=BTCUSD&level=2&depth=50`],
    ['derivative summary', `${OPEN}/summary?symbol=BTCUSD`],
    ['derivative trades', `${OPEN}/trades?symbol=BTCUSD&limit=10`],
    ['spot summary', `${OPEN}/summary?symbol=BTCUSDT`],
  ];
  for (const [name, url] of calls) {
    const r = await get(url);
    capture(`${name.replace(/ /g, '-')}.json`, r.text);
    // The documented book answers {timestamp, bids, asks} at the top level, outside the usual envelope.
    const d = r.json && !Array.isArray(r.json) ? (r.json.bids ? r.json : r.json.data) : null;
    let shape = null;
    if (d && (d.bids || d.asks)) {
      const bids = d.bids ?? [], asks = d.asks ?? [];
      const desc = bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]));
      const asc = asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]));
      shape = { keys: Object.keys(d), timestamp: d.timestamp, bids: bids.length, asks: asks.length, bidsDescending: desc, asksAscending: asc, best: [bids[0], asks[0]] };
    }
    log('book', { name, url, status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers, shape, body: shape ? undefined : trim(r.text, 300) });
    await sleep(500);
  }
}

async function errors() {
  const calls = [
    ['unknown slug', `${FUT}/pair?slug=nope-usd`],
    ['missing slug', `${FUT}/pair`],
    ['symbol instead of slug', `${FUT}/pair?symbol=BTCUSD`],
    ['website spot snapshot', `${API}/api/v1/market/snapshot`],
    ['unknown spot symbol', `${OPEN}/summary?symbol=NOPEUSDT`],
    ['unknown path', `${OPEN}/nope`],
  ];
  for (const [name, url] of calls) {
    const r = await get(url);
    log('error', { name, url, status: r.status, ms: r.ms, headers: r.headers, body: trim(r.text, 300) });
    await sleep(500);
  }
}

async function time() {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${FUT}/pair?slug=btc-usd`);
    const mid = (r.sentAt + r.recvAt) / 2;
    const env = Date.parse(r.json.timestamp);
    offsets.push(Math.round(env - mid));
    log('time', { envelope: r.json.timestamp, date: r.headers.date, rttMs: r.recvAt - r.sentAt, envelopeMinusLocalMidMs: Math.round(env - mid) });
    await sleep(500);
  }
  log('time_summary', { offsetMs: stats(offsets) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { host, catalog, poll, book, errors, time };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
await modes[mode]();
