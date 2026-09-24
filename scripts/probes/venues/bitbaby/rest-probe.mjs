// Bitbaby REST probe: documented API hosts, the web app's public catalog, fee tiers, region check, per contract anchor call, clock offset, and a side by side read of Binance funding.
// Bitbaby's API documentation link returns 404, so every call below except the host checks is one the web app itself makes, see docs/profiles/bitbaby/rest.md.
// Public, unauthenticated, read-only.
// No limit is published, so the anchor loop stays at three contracts every 2 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitbaby/rest-probe.mjs [catalog|anchor]
//   catalog  host checks, DNS, catalog timing and analysis, fee tiers, region check, clock offset, error shapes, CCXT id list, about 30 s.
//   anchor   public_market_info for three contracts and Binance premiumIndex for the same symbols every 2 s for 60 s.
// Recorded in docs/profiles/bitbaby/rest.md and docs/profiles/bitbaby/fees.md.
import { createRequire } from 'node:module';
import dns from 'node:dns/promises';
import tls from 'node:tls';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const WEB_API = 'https://web-api.bitbaby.com';
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);

async function timed(url, init) {
  const t = Date.now();
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return { status: res.status, ms: Date.now() - t, bytes: text.length, text, headers: res.headers };
  } catch (e) {
    return { status: null, ms: Date.now() - t, error: e.cause?.code ?? e.message };
  }
}

const post = (path, body = {}) => timed(WEB_API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function certNames(host) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate();
      resolve({ subjectAltName: c.subjectaltname, validTo: c.valid_to, authorized: s.authorized, authorizationError: s.authorizationError });
      s.end();
    });
    s.on('error', (e) => resolve({ error: e.message }));
    s.setTimeout(10_000, () => { s.destroy(); resolve({ error: 'timeout' }); });
  });
}

async function catalog() {
  for (const h of ['www.bitbaby.com', 'web-api.bitbaby.com', 'api.bitbaby.com', 'openapi.bitbaby.com', 'docs.bitbaby.com', 'futures.bitbaby.com', 'api.influencelab.xyz']) {
    let a;
    try { a = await dns.resolve4(h); } catch (e) { a = e.code; }
    log('dns', { host: h, a });
  }

  // The footer's API Documentation page points at docs.bitbaby.com, the spot config names an open_api_url, and a ChainUp style open API would sit on openapi.
  for (const u of ['https://docs.bitbaby.com/en/', 'https://docs.bitbaby.com/', 'https://www.bitbaby.com/en-us/exchange-open-api', 'https://openapi.bitbaby.com/sapi/v1/ping', 'https://openapi.bitbaby.com/fapi/v1/contracts', 'https://openapi.bitbaby.com/fapi/v1/ticker?contractName=E-BTC-USDT']) {
    const r = await timed(u);
    log('documented_host', { url: u, status: r.status, bytes: r.bytes, title: r.text?.match(/<title>([^<]*)<\/title>/)?.[1] ?? null, error: r.error });
  }
  log('config_ws_host_cert', { host: 'api.influencelab.xyz', ...(await certNames('api.influencelab.xyz')) });

  const us = await post('/spot/api/common/is_us_ip');
  log('is_us_ip', { status: us.status, ms: us.ms, body: JSON.parse(us.text) });

  const times = [];
  let body;
  let clock;
  for (let i = 0; i < 4; i++) {
    const sent = Date.now();
    const r = await post('/futures/api/common/public_info_v2');
    const got = Date.now();
    times.push(r.ms);
    body = JSON.parse(r.text);
    clock = { serverMs: body.data.currentTimeMillis, localMid: Math.round((sent + got) / 2), offsetMs: body.data.currentTimeMillis - Math.round((sent + got) / 2), rttMs: got - sent };
    if (i === 0) log('catalog_headers', { status: r.status, bytes: r.bytes, contentType: r.headers.get('content-type'), cache: r.headers.get('cf-cache-status'), retryAfter: r.headers.get('retry-after'), rateHeaders: [...r.headers.keys()].filter((k) => /rate|limit/i.test(k)) });
    await sleep(2000);
  }
  log('catalog_times', { firstMs: times[0], warmMs: times.slice(1) });
  log('clock', clock);

  const cl = body.data.contractList;
  const count = (f) => cl.reduce((m, c) => { const k = f(c); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  log('catalog_counts', {
    total: cl.length,
    marginCoin: count((c) => c.marginCoin),
    contractSide: count((c) => c.contractSide),
    deliveryKind: count((c) => c.deliveryKind),
    contractType: count((c) => c.contractType),
    capitalFrequencyHours: count((c) => c.capitalFrequency),
    nextCapitalSettTime: count((c) => new Date(c.nextCapitalSettTime).toISOString()),
    multiplier: count((c) => c.multiplier),
    fundsStatus: count((c) => `${c.coinResultVo.fundsInStatus}/${c.coinResultVo.fundsOutStatus}`),
    subSymbolMatchesBaseQuote: cl.filter((c) => c.subSymbol === `e_${(c.base + c.quote).toLowerCase()}`).length,
    contractNameMatches: cl.filter((c) => c.contractName === `E-${c.base}-${c.quote}`).length,
    basesListedTwice: Object.entries(count((c) => c.base)).filter(([, n]) => n > 1).length,
    multiplierCoinIsBase: cl.filter((c) => c.multiplierCoin === c.base).length,
    finestDepthIsTick: cl.filter((c) => Number(c.coinResultVo.depthList[0]) === 10 ** -c.coinResultVo.symbolPricePrecision).length,
    maxLever: { min: Math.min(...cl.map((c) => c.maxLever)), max: Math.max(...cl.map((c) => c.maxLever)) },
  });
  const nonCrypto = cl.filter((c) => /^(XAU|XAG|NVDA|TSLA|AAPL|SPY|QQQ|COIN|MSTR|HOOD|CRCL|GOOGL|AMZN|META|MSFT)$/.test(c.base)).map((c) => c.contractName);
  log('tradfi_like', { count: nonCrypto.length, names: nonCrypto });
  log('contract_sample', { btc: cl.find((c) => c.contractName === 'E-BTC-USDT') });

  for (const type of [1, 2]) {
    const r = await post('/spot/api/membership/get_level_fee_config_list', { type });
    const d = JSON.parse(r.text).data;
    log('fee_tiers', { type, condition: d.condition, tiers: d.list.map((t) => ({ level: t.levelName, compareRule: t.compareRule, [t.firstKey]: t.firstValue, [t.secondKey]: t.secondValue, maker: t.maker, taker: t.taker })) });
  }

  const spot = JSON.parse((await post('/spot/api/common/public_info_v7')).text).data;
  const spotPairs = Object.fromEntries(Object.entries(spot.market?.market ?? {}).map(([quote, pairs]) => [quote, Object.keys(pairs).length]));
  log('spot_config', { pairsByQuote: spotPairs, limitCountryList: spot.limitCountryList, fee_coin_open: spot.switch?.fee_coin_open, open_api_url: spot.open_api_url, coUrl: spot.url?.coUrl });

  const ladder = await post('/futures/api/common/get_ladder_info', { contractId: 1 });
  const ld = JSON.parse(ladder.text).data;
  log('ladder_btc', { status: ladder.status, name: ld?.leverList?.name, tiers: JSON.parse(ld?.leverList?.leverConfig ?? '[]').length, keys: Object.keys(ld ?? {}) });

  await extras(cl);

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, matches: ccxt.exchanges.filter((x) => /baby|chainup/i.test(x)) });
}

// Error shapes, the second host, the network exit, and the few cross checks against Binance that the profiles quote.
async function extras(cl) {
  const trace = await timed('https://www.bitbaby.com/cdn-cgi/trace');
  log('cloudflare_trace', Object.fromEntries((trace.text ?? '').split('\n').filter((l) => /^(ip|loc|colo)=/.test(l)).map((l) => l.split('='))));
  let cname;
  try { cname = await dns.resolveCname('web-api.bitbaby.com'); } catch (e) { cname = e.code; }
  log('cname', { host: 'web-api.bitbaby.com', cname });

  const other = await timed('https://api.bitbaby.com/futures/api/common/public_info_v2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  log('second_host', { url: 'https://api.bitbaby.com/futures/api/common/public_info_v2', status: other.status, bytes: other.bytes });

  const code = (r) => { try { const j = JSON.parse(r.text); return { http: r.status, code: j.code, msg: j.msg, dataNull: j.data === null, bytes: r.bytes }; } catch { return { http: r.status, bytes: r.bytes }; } };
  const cases = [
    ['GET public_info_v2', () => timed(WEB_API + '/futures/api/common/public_info_v2')],
    ['fee config without type', () => post('/spot/api/membership/get_level_fee_config_list')],
    ['depth', () => post('/futures/api/common/depth', { contractId: 1 })],
    ['funding_rate_history', () => post('/futures/api/common/funding_rate_history', { contractId: 1 })],
    ['gainers-list', () => post('/futures/api/common/gainers-list')],
    ['public_market_info {}', () => post('/futures/api/common/public_market_info')],
    ['public_market_info symbol', () => post('/futures/api/common/public_market_info', { symbol: 'E-BTC-USDT' })],
    ['public_market_info id list', () => post('/futures/api/common/public_market_info', { contractId: '1,2' })],
    ['public_market_info unknown id', () => post('/futures/api/common/public_market_info', { contractId: 99999 })],
    ['public_market_info id 1', () => post('/futures/api/common/public_market_info', { contractId: 1 })],
  ];
  for (const [name, call] of cases) {
    log('error_case', { name, ...code(await call()) });
    await sleep(300);
  }

  const chip = cl.find((c) => c.contractName === 'E-CHIP-USDT');
  if (chip) {
    const r = JSON.parse((await post('/futures/api/common/public_market_info', { contractId: chip.id })).text).data;
    const b = JSON.parse((await timed('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=CHIPUSDT')).text);
    log('chip', { multiplier: chip.multiplier, multiplierCoin: chip.multiplierCoin, bitbabyIndex: r?.indexPrice, binanceIndex: b.indexPrice });
  }
  const settled = JSON.parse((await timed('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1')).text);
  log('binance_last_settled', { btc: settled[0] });
  log('tags', { tradfi: cl.filter((c) => c.tags.includes('Tradfi')).map((c) => c.contractName) });
}

async function anchor() {
  const pairs = [{ id: 1, bb: 'E-BTC-USDT', bn: 'BTCUSDT' }, { id: 2, bb: 'E-ETH-USDT', bn: 'ETHUSDT' }, { id: 151, bb: 'E-IOTX-USDT', bn: 'IOTXUSDT' }];
  const st = new Map(pairs.map((p) => [p.bb, { ms: [], changes: {}, prev: null, curMinusBinance: [], indexVsBinance: [], markVsIndex: [], sample: null, nextVsCur: 0, n: 0, statuses: {} }]));
  const bnMs = [];
  for (let i = 0; i < 30; i++) {
    const t = Date.now();
    for (const p of pairs) {
      const [r, b] = await Promise.all([post('/futures/api/common/public_market_info', { contractId: p.id }), timed(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${p.bn}`)]);
      const s = st.get(p.bb);
      s.statuses[r.status] = (s.statuses[r.status] ?? 0) + 1;
      s.ms.push(r.ms);
      bnMs.push(b.ms);
      const d = JSON.parse(r.text).data;
      const bn = JSON.parse(b.text);
      s.n++;
      if (s.prev) for (const k of Object.keys(d)) if (d[k] !== s.prev[k]) s.changes[k] = (s.changes[k] ?? 0) + 1;
      s.prev = d;
      s.curMinusBinance.push(Math.round((d.currentFundRate - Number(bn.lastFundingRate)) * 1e6));
      s.indexVsBinance.push(Math.round((d.indexPrice / Number(bn.indexPrice) - 1) * 1e6));
      s.markVsIndex.push(Math.round((d.tagPrice / d.indexPrice - 1) * 1e6));
      if (d.nextFundRate !== d.currentFundRate) s.nextVsCur++;
      if (i === 0) s.sample = { bitbaby: d, binance: { lastFundingRate: bn.lastFundingRate, markPrice: bn.markPrice, indexPrice: bn.indexPrice, nextFundingTime: bn.nextFundingTime } };
    }
    await sleep(Math.max(0, 2000 - (Date.now() - t)));
  }
  for (const [name, s] of st) {
    log('anchor', {
      contract: name,
      polls: s.n,
      statuses: s.statuses,
      replyMs: { min: q(s.ms, 0), p50: q(s.ms, 0.5), p90: q(s.ms, 0.9), max: q(s.ms, 1) },
      changesOver60s: s.changes,
      currentFundRateMinusBinanceLastFundingRatePpm: { min: q(s.curMinusBinance, 0), p50: q(s.curMinusBinance, 0.5), max: q(s.curMinusBinance, 1) },
      indexMinusBinanceIndexPpm: { min: q(s.indexVsBinance, 0), p50: q(s.indexVsBinance, 0.5), max: q(s.indexVsBinance, 1) },
      markMinusIndexPpm: { min: q(s.markVsIndex, 0), p50: q(s.markVsIndex, 0.5), max: q(s.markVsIndex, 1) },
      pollsWhereNextDiffersFromCurrent: s.nextVsCur,
      firstSample: s.sample,
    });
  }
  log('binance_reply_ms', { p50: q(bnMs, 0.5), max: q(bnMs, 1) });
}

const mode = process.argv[2] ?? 'catalog';
const modes = { catalog, anchor };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
await modes[mode]();
process.exit(0);
