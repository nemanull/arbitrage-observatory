// Digitalexchange.id REST probe: the undocumented public /api/<pair>/ticker, /depth and /trades routes, the /market page as the catalog, the per pair fee fields embedded in each trading page, reply time and caching, error shapes, and the server clock from the TradingView feed.
// Public, unauthenticated, read-only.
// No cookie, no token, no POST.
// At most 5 requests a second, the rate of the errors burst, and the venue publishes no limit.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/digitalexchange-id/rest-probe.mjs [host|catalog|fees|poll|errors|mirror]
//   host     DNS for the three hosts, then cold and warm request times. About 15 s.
//   catalog  pairs on /market, one ticker per pair, CCXT's exchange list, and the page's integrasi list. About 60 s.
//   fees     the fee fields of the asset_data object on every listed pair's trading page, one page every 500 ms. About 2 min, 30 MB.
//   poll     60 one second rounds of the BTCIDR ticker and depth, how often each number changed, and cache headers.
//   errors   unknown and malformed pairs, a 20 request burst at 5 per second, and the server clock against this host.
//   mirror   six rounds 3 s apart of the BTCIDR and ETHIDR books against Binance's public BTCUSDT and ETHUSDT books, testing whether an integrasi ladder is a Binance ladder scaled by one IDR rate, with two public Binance calls per round.
// Recorded in docs/profiles/digitalexchange-id/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const SITE = 'https://digitalexchange.id';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const stats = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

// A GET that reports time to the whole body, with a fresh TLS connection when agent is false.
function get(url, agent) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = https.get(url, { agent, headers: { 'user-agent': 'observatory-probe' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, ms: Math.round(performance.now() - t0), at: Date.now() });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Math.round(performance.now() - t0), at: Date.now() }));
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
  });
}
const warm = new https.Agent({ keepAlive: true, maxSockets: 1 });
const json = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};
const cacheHeaders = (h) => ({ cf: h['cf-cache-status'], cacheControl: h['cache-control'], age: h.age, server: h.server, ray: h['cf-ray'], rateLimit: Object.fromEntries(Object.entries(h).filter(([k]) => /rate|limit|retry/i.test(k))) });

async function listedPairs() {
  const r = await get(`${SITE}/market`, warm);
  return [...new Set([...r.body.matchAll(/basic-trading\/([A-Z0-9]+)/g)].map((m) => m[1]))];
}

async function modeHost() {
  for (const host of ['digitalexchange.id', 'socket.digitalexchange.id', 'socket-market.digitalexchange.id']) {
    log('dns', { host, a: await dns.resolve4(host).catch((e) => e.code), aaaa: await dns.resolve6(host).catch((e) => e.code) });
  }
  const url = `${SITE}/api/btcidr/ticker`;
  const cold = [];
  for (let i = 0; i < 5; i++) {
    cold.push((await get(url, false)).ms);
    await sleep(500);
  }
  const hot = [];
  for (let i = 0; i < 20; i++) {
    const r = await get(url, warm);
    hot.push(r.ms);
    if (i === 0) log('headers', { url, status: r.status, ...cacheHeaders(r.headers), contentType: r.headers['content-type'] });
    await sleep(300);
  }
  log('latency', { url, coldMs: stats(cold), warmMs: stats(hot) });
}

async function modeCatalog() {
  const pairs = await listedPairs();
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, byName: ccxt.exchanges.filter((x) => /digital|indonesia|dexid/i.test(x)), indonesian: ccxt.exchanges.filter((x) => ['indodax', 'tokocrypto'].includes(x)) });
  const trade = await get(`${SITE}/basic-trading/BTCIDR`, warm);
  const integrasi = (trade.body.match(/var integrasi = \[([^\]]*)\]/)?.[1] ?? '').match(/[A-Z0-9]+/g) ?? [];
  const quotes = {};
  for (const p of pairs) {
    const q = p.endsWith('USDT') ? 'USDT' : p.endsWith('IDR') ? 'IDR' : 'other';
    quotes[q] = (quotes[q] ?? 0) + 1;
  }
  log('catalog', { listed: pairs.length, quotes, integrasiListLength: integrasi.length, listedNotIntegrated: pairs.filter((p) => !integrasi.includes(p)), integratedNotListed: integrasi.filter((p) => !pairs.includes(p)).length });
  const rows = [];
  const ms = [];
  for (const p of pairs) {
    const r = await get(`${SITE}/api/${p.toLowerCase()}/ticker`, warm);
    ms.push(r.ms);
    const d = json(r)?.data?.[0];
    rows.push({ p, status: r.status, ok: json(r)?.status, bid: Number(d?.bid), ask: Number(d?.ask), last: Number(d?.last), vol: Number(d?.volume) });
    await sleep(300);
  }
  const quoted = rows.filter((x) => x.bid > 0 && x.ask > 0);
  const spreadPpm = quoted.filter((x) => x.ask > x.bid).map((x) => Math.round(((x.ask - x.bid) / ((x.ask + x.bid) / 2)) * 1e6));
  log('tickers', {
    requested: rows.length,
    success: rows.filter((x) => x.ok === 'success').length,
    withBidAndAsk: quoted.length,
    zeroRows: rows.filter((x) => !(x.bid > 0 && x.ask > 0)).map((x) => x.p),
    locked: quoted.filter((x) => x.ask === x.bid).map((x) => x.p),
    crossed: quoted.filter((x) => x.ask < x.bid).map((x) => `${x.p}:${x.bid}/${x.ask}`),
    spreadPpm: stats(spreadPpm),
    widest: quoted.filter((x) => x.ask > x.bid).map((x) => [x.p, Math.round(((x.ask - x.bid) / ((x.ask + x.bid) / 2)) * 1e6)]).sort((a, b) => b[1] - a[1]).slice(0, 5),
    zeroVolume: rows.filter((x) => !(x.vol > 0)).length,
    replyMs: stats(ms),
    sample: rows.slice(0, 3),
  });
}

async function modeFees() {
  const pairs = await listedPairs();
  const rows = [];
  for (const p of pairs) {
    const r = await get(`${SITE}/basic-trading/${p}`, warm);
    const m = r.body.match(/var asset_data = (\{.*?"get_symbol")/);
    let a = null;
    if (m) {
      try {
        a = JSON.parse(m[1].replace(/,"get_symbol"$/, '}'));
      } catch {
        a = null;
      }
    }
    rows.push({ p, status: r.status, a });
    await sleep(500);
  }
  const tally = (f) => rows.reduce((acc, r) => {
    const k = String(r.a?.[f]);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const fields = ['taker_fee', 'maker_fee', 'real_fee_taker', 'real_fee_maker', 'lp_taker_fee', 'lp_maker_fee', 'integrasi', 'ppn_percentage', 'pph_percentage', 'trading_status', 'backend_status', 'price_filter_source', 'decimal_market', 'market_beta'];
  log('fees', { pages: rows.length, parsed: rows.filter((r) => r.a).length, ...Object.fromEntries(fields.map((f) => [f, tally(f)])) });
  log('fee-pairs', { byTaker: Object.fromEntries(Object.keys(tally('taker_fee')).map((k) => [k, rows.filter((r) => String(r.a?.taker_fee) === k).map((r) => r.p).slice(0, 12)])) });
  const pick = (a) => ({ taker: a?.taker_fee, maker: a?.maker_fee, lpTaker: a?.lp_taker_fee, lpMaker: a?.lp_maker_fee, integrasi: a?.integrasi, minQuote: a?.min_pair_transaction, pricescale: a?.pricescale });
  log('fee-outliers', Object.fromEntries(rows.filter((r) => String(r.a?.taker_fee) !== '0.26' || String(r.a?.maker_fee) !== '0.26').map((r) => [r.p, pick(r.a)])));
  log('fee-btc', pick(rows.find((r) => r.p === 'BTCIDR')?.a));
  // Does the venue field plus the liquidity provider field give the published all in 0.36 % on every pair?
  const sum = (a, b) => Math.round((Number(a ?? 0) + Number(b ?? 0)) * 1e4) / 1e4;
  log('fee-sums', {
    takerPlusLpTaker: rows.reduce((acc, r) => ((acc[sum(r.a?.taker_fee, r.a?.lp_taker_fee)] = (acc[sum(r.a?.taker_fee, r.a?.lp_taker_fee)] ?? 0) + 1), acc), {}),
    makerPlusLpMaker: rows.reduce((acc, r) => ((acc[sum(r.a?.maker_fee, r.a?.lp_maker_fee)] = (acc[sum(r.a?.maker_fee, r.a?.lp_maker_fee)] ?? 0) + 1), acc), {}),
  });
}

async function modePoll() {
  const t = [];
  const d = [];
  let prevT = null;
  let prevD = null;
  const changes = { tickerBid: 0, tickerAsk: 0, tickerLast: 0, depthTouch: 0, depthBody: 0 };
  let tickerVsDepth = 0;
  const statuses = {};
  const cache = {};
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const rt = await get(`${SITE}/api/btcidr/ticker`, warm);
    const rd = await get(`${SITE}/api/btcidr/depth`, warm);
    for (const r of [rt, rd]) {
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      const k = `${r.headers?.['cf-cache-status']}|${r.headers?.['cache-control']}`;
      cache[k] = (cache[k] ?? 0) + 1;
    }
    t.push(rt.ms);
    d.push(rd.ms);
    const tk = json(rt)?.data?.[0];
    const dp = json(rd)?.data;
    if (prevT && tk) {
      if (tk.bid !== prevT.bid) changes.tickerBid++;
      if (tk.ask !== prevT.ask) changes.tickerAsk++;
      if (tk.last !== prevT.last) changes.tickerLast++;
    }
    if (prevD && dp) {
      if (dp.buy[0][0] !== prevD.buy[0][0] || dp.sell[0][0] !== prevD.sell[0][0]) changes.depthTouch++;
      if (JSON.stringify(dp) !== JSON.stringify(prevD)) changes.depthBody++;
    }
    if (tk && dp && Number(tk.bid) === Number(dp.buy[0][0]) && Number(tk.ask) === Number(dp.sell[0][0])) tickerVsDepth++;
    prevT = tk ?? prevT;
    prevD = dp ?? prevD;
    if (i === 0) log('first', { ticker: rt.body.slice(0, 200), depthLevels: { buy: dp?.buy.length, sell: dp?.sell.length }, depthBytes: rd.body.length });
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  // The same depth URL with a nonce, to see whether a cache sits in front of the plain URL.
  const nonce = await get(`${SITE}/api/btcidr/depth?n=${Date.now()}`, warm);
  log('poll', { rounds: 60, tickerMs: stats(t), depthMs: stats(d), statuses, cache, changesOver59Intervals: changes, tickerTouchEqualsDepthTouch: tickerVsDepth, nonceStatus: nonce.status, nonceCf: nonce.headers?.['cf-cache-status'] });
}

async function modeErrors() {
  const cases = ['/api/nopeidr/ticker', '/api/nopeidr/depth', '/api/nopeidr/trades', '/api/btc_idr/ticker', '/api/v1/ticker', '/api/BTCIDR/depth', '/api/btcidr/nope', '/api/btcidr/depth?limit=5', '/api/btcidr', '/api'];
  for (const c of cases) {
    const r = await get(SITE + c, warm);
    log('case', { path: c, status: r.status, type: r.headers?.['content-type'], location: r.headers?.location, body: r.body?.startsWith('<') ? `html ${r.body.length} bytes` : r.body?.slice(0, 160) });
    await sleep(400);
  }
  const tr = await get(`${SITE}/api/btcidr/trades`, warm);
  const trades = json(tr)?.data ?? [];
  log('trades', { status: tr.status, rows: trades.length, bytes: tr.body.length, newest: trades[0], oldest: trades[trades.length - 1], keys: Object.keys(trades[0] ?? {}) });
  const burst = [];
  for (let i = 0; i < 20; i++) {
    const r = await get(`${SITE}/api/btcidr/ticker`, warm);
    burst.push({ s: r.status, ms: r.ms, rl: cacheHeaders(r.headers ?? {}).rateLimit });
    await sleep(200);
  }
  log('burst', { requests: 20, perSecond: 5, statuses: burst.map((b) => b.s).join(','), rateLimitHeaders: burst[burst.length - 1].rl, ms: stats(burst.map((b) => b.ms)) });
  // The TradingView feed's time route answers whole Unix seconds.
  const offsets = [];
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    const r = await get(`${SITE}/tradingview/time`, warm);
    const t1 = Date.now();
    offsets.push({ serverS: Number(r.body), midMs: (t0 + t1) / 2, rttMs: t1 - t0, date: r.headers?.date });
    await sleep(1_130);
  }
  // With 1 s resolution, the offset lies between serverS*1000 - mid and serverS*1000 + 1000 - mid on every sample, so intersect the bounds.
  const lo = Math.max(...offsets.map((o) => o.serverS * 1000 - o.midMs));
  const hi = Math.min(...offsets.map((o) => o.serverS * 1000 + 1000 - o.midMs));
  log('clock', { samples: offsets.length, serverMinusLocalMsBetween: [Math.round(lo), Math.round(hi)], rttMs: stats(offsets.map((o) => o.rttMs)), sample: offsets[0] });
}

// The ratio shared by the most (venue level, Binance level) price pairs, within 2 ppm, and how many venue levels it explains.
function mirrorSide(dex, bin) {
  const ratios = [];
  for (const [p] of dex) for (const [q] of bin) ratios.push(p / q);
  ratios.sort((a, b) => a - b);
  let best = 0;
  let k = null;
  for (let i = 0, j = 0; i < ratios.length; i++) {
    while (ratios[j] < ratios[i] * (1 - 2e-6)) j++;
    let e = i;
    while (e + 1 < ratios.length && ratios[e + 1] <= ratios[i] * (1 + 2e-6)) e++;
    if (e - i + 1 > best) {
      best = e - i + 1;
      k = ratios[i];
    }
  }
  const explained = dex.filter(([p]) => bin.some(([q]) => Math.abs(p / q - k) / k < 2e-6)).length;
  return { k: k && +k.toFixed(3), explained, levels: dex.length };
}

async function modeMirror() {
  const pairs = [['btcidr', 'BTCUSDT'], ['ethidr', 'ETHUSDT']];
  for (let round = 0; round < 6; round++) {
    for (const [dexPair, binPair] of pairs) {
      const [rd, rb] = await Promise.all([get(`${SITE}/api/${dexPair}/depth`, warm), get(`https://data-api.binance.vision/api/v3/depth?symbol=${binPair}&limit=100`, false)]);
      const d = json(rd)?.data;
      const b = json(rb);
      if (!d || !b?.bids) {
        log('mirror', { round, dexPair, dexStatus: rd.status, binanceStatus: rb.status });
        continue;
      }
      const toN = (xs) => xs.map(([p, a]) => [Number(p), Number(a)]);
      const [db, da, bb, ba] = [toN(d.buy), toN(d.sell), toN(b.bids), toN(b.asks)];
      log('mirror', {
        round,
        dexPair,
        binanceStatus: rb.status,
        dexTouch: [db[0]?.[0], da[0]?.[0]],
        dexCrossedPpm: db[0] && da[0] && db[0][0] > da[0][0] ? Math.round(((db[0][0] - da[0][0]) / da[0][0]) * 1e6) : 0,
        binanceTouch: [bb[0][0], ba[0][0]],
        bids: mirrorSide(db, bb),
        asks: mirrorSide(da, ba),
      });
    }
    await sleep(3_000);
  }
}

const mode = process.argv[2] ?? 'host';
const modes = { host: modeHost, catalog: modeCatalog, fees: modeFees, poll: modePoll, errors: modeErrors, mirror: modeMirror };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
