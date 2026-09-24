// BitKan REST probe: what this host can reach, since BitKan publishes no REST API.
// It resolves the hosts, requests the website and the website's own /proxy/v2 calls (paths from the bundle https://cdn.bitkan.net/cdn/static/js/futures.symbols-BmA1Mca9.js) and prints status, Cloudflare headers and timing.
// It confirms CCXT has no BitKan class, reads the socket URL out of the website config bundle, summarises the 2023 Wayback copy of the futures catalog, and reads CoinGecko's exchange and derivatives entries.
// Public, unauthenticated and read-only: a cold and a warm request per website URL a second apart, and a handful of single calls to CoinGecko and Binance, all far inside their public limits.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitkan/rest-probe.mjs [reach|catalog|coingecko|tickers|all]
//   reach      DNS, website, /proxy/v2 calls, help center, cold and warm timing, CCXT, about 30 s
//   catalog    socket URL from the config bundle, and the Wayback copy of /proxy/v2/contract/symbol/contracts from 2023-03-27
//   coingecko  CoinGecko /exchanges/bitkan and /derivatives/exchanges/bitkan-futures, which answer 429 when shared hosts exhaust the free limit, then tickers
//   tickers    every BitKan perpetual CoinGecko lists, matched against Binance USD-M and COIN-M exchangeInfo and the Binance premiumIndex funding rate
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/bitkan/rest.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, extra = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { redirect: 'manual', ...extra });
    const body = await res.text();
    const ms = Math.round(performance.now() - t0);
    const h = res.headers;
    return {
      url,
      status: res.status,
      ms,
      bytes: body.length,
      server: h.get('server'),
      cfMitigated: h.get('cf-mitigated'),
      cfRay: h.get('cf-ray'),
      location: h.get('location'),
      title: body.match(/<title>([^<]*)/)?.[1] ?? null,
      head: /^[\[{]/.test(body.trim()) ? body.slice(0, 160) : body.slice(0, 60).replace(/\s+/g, ' '),
      body,
    };
  } catch (e) {
    return { url, error: e.cause?.code ?? e.message, ms: Math.round(performance.now() - t0) };
  }
}

const strip = ({ body, ...rest }) => rest;

async function reach() {
  for (const host of ['bitkan.com', 'www.bitkan.com', 'help.bitkan.com', 'cdn.bitkan.net', 's.btckan.com', 'api.bitkan.com', 'docs.bitkan.com', 'openapi.bitkan.com']) {
    try {
      const a = await lookup(host, { all: true });
      log('dns', { host, addresses: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const urls = [
    'https://bitkan.com/',
    'https://bitkan.com/help/fee',
    'https://bitkan.com/help/protocol',
    'https://bitkan.com/proxy/v2/contract/symbol/contracts?exchange=binance&update_time=0&strategy_type=0',
    'https://bitkan.com/proxy/v2/contract/quote/depth?contract_id=BINANCE-BTC-USDT&depth=1',
    'https://bitkan.com/proxy/v2/contract/quote/open_interest',
    'https://bitkan.com/api/seo/rates?from=USDT&to=USD',
    'https://help.bitkan.com/hc/en-us',
    'https://help.bitkan.com/api/v2/help_center/articles/search.json?query=API',
    'https://s.btckan.com:8080/',
  ];
  for (const url of urls) {
    const cold = await get(url);
    await sleep(1_000);
    const warm = await get(url);
    log('get', { ...strip(cold), warmMs: warm.ms, warmStatus: warm.status });
    await sleep(1_000);
  }

  // A browser user agent does not change the answer, which shows the refusal is the challenge and not the curl agent.
  const ua = await get('https://bitkan.com/', { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', accept: 'text/html' } });
  log('get_browser_agent', strip(ua));

  const ids = ccxt.exchanges;
  log('ccxt', { version: ccxt.version, count: ids.length, bitkanLike: ids.filter((x) => /kan|bitk/i.test(x)) });
}

async function catalog() {
  const cfg = await get('https://cdn.bitkan.net/cdn/static/js/config-CiXgh45W.js');
  const prod = cfg.body?.slice(cfg.body.indexOf('name:`prod`'), cfg.body.indexOf('name:`prod`') + 900) ?? '';
  log('config_bundle', {
    status: cfg.status,
    bytes: cfg.bytes,
    prodApiURL: prod.match(/apiURL:`([^`]*)`/)?.[1] ?? null,
    prodSocket: prod.match(/socket:`([^`]*)`/)?.[1] ?? null,
  });

  const wb = await get('https://web.archive.org/web/20230327090537id_/https://bitkan.com/proxy/v2/contract/symbol/contracts?exchange=binance&update_time=0&strategy_type=0');
  if (wb.status !== 200) {
    log('wayback_catalog', strip(wb));
    return;
  }
  keep('wayback-contracts-2023.json', wb.body);
  const j = JSON.parse(wb.body);
  const rows = j.data.items;
  const count = (f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  const btc = rows.find((r) => r.contract_id === 'BINANCE-BTC-USDT');
  log('wayback_catalog', {
    capturedAt: '2023-03-27T09:05:37Z',
    code: j.code,
    categories: j.data.categories,
    rows: rows.length,
    exchange: count((r) => r.exchange),
    group: count((r) => r.group_name),
    futureType: count((r) => `${r.future_type_name}`),
    currency: count((r) => r.currency),
    status: count((r) => r.status),
    idShape: rows.slice(0, 3).map((r) => r.contract_id),
    btc: btc && {
      contract_size: btc.contract_size,
      price_step_size: btc.price_step_size,
      quantity_step_size: btc.quantity_step_size,
      min_notional: btc.min_notional,
      leverage_max: btc.leverage_max,
      preferences_title: btc.preferences_title,
      funding_fee: btc.funding_fee,
    },
    fields: Object.keys(rows[0]),
  });
}

async function coingecko() {
  const ex = await get('https://api.coingecko.com/api/v3/exchanges/bitkan');
  if (ex.status === 200) {
    const j = JSON.parse(ex.body);
    const quotes = j.tickers.reduce((m, t) => ((m[t.target] = (m[t.target] ?? 0) + 1), m), {});
    log('coingecko_exchange', {
      status: 200,
      name: j.name,
      country: j.country,
      year: j.year_established,
      trustScore: j.trust_score,
      trustRank: j.trust_score_rank,
      pairs: j.pairs,
      volume24hBtc: Math.round(j.trade_volume_24h_btc),
      firstTickers: j.tickers.slice(0, 3).map((t) => `${t.base}/${t.target} ${t.trade_url}`),
      quotesInFirstPage: quotes,
    });
  } else log('coingecko_exchange', strip(ex));
  await sleep(2_000);
  const dx = await get('https://api.coingecko.com/api/v3/derivatives/exchanges/bitkan-futures');
  if (dx.status === 200) {
    const j = JSON.parse(dx.body);
    log('coingecko_derivatives', { status: 200, name: j.name, perps: j.number_of_perpetual_pairs, futures: j.number_of_futures_pairs, oiBtc: j.open_interest_btc, vol24hBtc: j.trade_volume_24h_btc, country: j.country });
  } else log('coingecko_derivatives', strip(dx));
  await sleep(5_000);
  await coingeckoTickers();
}

// Every BitKan perpetual CoinGecko lists, set against Binance USD-M and COIN-M, to see whose contracts they are.
async function coingeckoTickers() {
  const tk = await get('https://api.coingecko.com/api/v3/derivatives/exchanges/bitkan-futures?include_tickers=unexpired');
  if (tk.status !== 200) {
    log('coingecko_tickers', strip(tk));
    return;
  }
  keep('coingecko-bitkan-futures-tickers.json', tk.body);
  const t = JSON.parse(tk.body).tickers ?? [];
  const um = await (await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo')).json();
  const cm = await (await fetch('https://dapi.binance.com/dapi/v1/exchangeInfo')).json();
  const prem = await (await fetch('https://fapi.binance.com/fapi/v1/premiumIndex')).json();
  const umPerp = new Set(um.symbols.filter((s) => s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL').map((s) => s.symbol));
  const umTrading = new Set(um.symbols.filter((s) => s.status === 'TRADING' && /PERPETUAL/.test(s.contractType)).map((s) => s.symbol));
  const cmPerp = new Set(cm.symbols.filter((s) => s.contractType === 'PERPETUAL').map((s) => s.symbol));
  const rate = new Map(prem.map((p) => [p.symbol, Number(p.lastFundingRate)]));
  const byTarget = {};
  let inUm = 0;
  let inUmTrading = 0;
  let inCm = 0;
  let rateCompared = 0;
  let rateEqual = 0;
  const missing = [];
  for (const x of t) {
    byTarget[`${x.target}|${x.contract_type}`] = (byTarget[`${x.target}|${x.contract_type}`] ?? 0) + 1;
    const sym = x.symbol.replace(/_PERP$/, '').replace(/_/g, '');
    const coin = `${x.base}USD_PERP`;
    if (umPerp.has(sym)) inUm++;
    if (umTrading.has(sym)) inUmTrading++;
    else if (cmPerp.has(coin) && x.target === 'USD') inCm++;
    else missing.push(x.symbol);
    if (rate.has(sym) && x.funding_rate !== null && x.funding_rate !== undefined) {
      rateCompared++;
      if (Math.abs(Number(x.funding_rate) - rate.get(sym) * 100) < 1e-6) rateEqual++;
    }
  }
  log('coingecko_tickers', {
    tickers: t.length,
    byTargetAndType: byTarget,
    symbolShape: t.slice(0, 3).map((x) => x.symbol),
    tradeUrl: t[0]?.trade_url ?? null,
    binanceUsdmPerps: umTrading.size,
    inBinanceUsdmAnyStatus: inUm,
    inBinanceUsdmTrading: inUmTrading,
    inBinanceCoinm: inCm,
    notFound: missing.length,
    notFoundSample: missing.slice(0, 15),
    fundingRateCompared: rateCompared,
    fundingRateEqualToBinanceLast: rateEqual,
  });
}

const mode = process.argv[2] ?? 'all';
const modes = { reach, catalog, coingecko };
log('start', { mode, at: new Date().toISOString() });
for (const [name, fn] of Object.entries(modes)) if (mode === 'all' || mode === name) await fn();
if (mode === 'tickers') await coingeckoTickers();
log('end', { mode, at: new Date().toISOString() });
process.exit(0);
