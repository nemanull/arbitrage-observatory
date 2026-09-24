// LeveX REST probe: DNS, what each web API host answers this host, the support page that says there is no API, CCXT, and CoinGecko's listing.
// LeveX publishes no API, so the hosts probed are the ones its web page calls, read from its public JavaScript bundle on 2026-09-22.
// Public, unauthenticated, read-only. Each URL is fetched twice, cold then warm, so about 20 requests in all.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/levex/rest-probe.mjs
// Recorded in docs/profiles/levex/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

const HOSTS = [
  'levex.com',
  'api100.levex.com', // web client REST, from the bundle's `api100` prefix
  'ws100.levex.com', // web client socket, from the bundle's `ws100` prefix
  'data.levex.com',
  'cms-api.levex.com',
  'docs.levex.com',
  'api.levex.com',
  'api-docs.levex.com',
  'developers.levex.com',
  'openapi.levex.com',
];

const URLS = [
  'https://levex.com/en',
  'https://levex.com/en/support/miscellaneous',
  'https://api100.levex.com/public/pairs',
  'https://api100.levex.com/service-user-manage/vip/public/levels',
  'https://api100.levex.com/service-perpetual/trading/public/funding-rate',
  'https://api100.levex.com/service-market-data/public/kline',
  'https://data.levex.com/public/pairs',
  'https://ws100.levex.com/',
  'https://api.levex.com/',
];

async function resolveAll() {
  for (const h of HOSTS) {
    try {
      const cname = await dns.resolveCname(h).catch(() => []);
      const a = await dns.resolve4(h);
      log('dns', { host: h, cname, a: a.slice(0, 4), count: a.length });
    } catch (e) {
      log('dns', { host: h, error: e.code });
    }
  }
}

function strip(text) {
  return text.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchTwice(url) {
  const out = [];
  for (const pass of ['cold', 'warm']) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (probe)' }, redirect: 'manual' });
      const ttfb = performance.now() - t0;
      const body = await res.text();
      const total = performance.now() - t0;
      const h = (k) => res.headers.get(k);
      const text = strip(body);
      out.push({ pass, status: res.status, ttfbMs: Math.round(ttfb), totalMs: Math.round(total), bytes: body.length, server: h('server'), xcache: h('x-cache'), pop: h('x-amz-cf-pop'), date: h('date'), retryAfter: h('retry-after'), location: h('location') });
      if (pass === 'cold') {
        const local = Date.now();
        const remote = Date.parse(h('date') ?? '');
        const blocked = /Request blocked/.test(body);
        const denied = /AccessDenied/.test(body);
        const noApi = text.match(/[^.?]*offer an API[^.?]*[.?][^.?]*[.?]/)?.[0];
        log('body', { url, blocked, s3AccessDenied: denied, noApiStatement: noApi ?? null, head: text.slice(0, 160), dateOffsetS: Number.isFinite(remote) ? Math.round((local - remote) / 1000) : null });
      }
    } catch (e) {
      out.push({ pass, error: e.cause?.code ?? e.message });
    }
  }
  log('http', { url, results: out });
}

async function ccxtCheck() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, levexLike: ccxt.exchanges.filter((x) => /lev|vex/i.test(x)) });
}

async function coingecko() {
  const t0 = performance.now();
  const res = await fetch('https://api.coingecko.com/api/v3/derivatives/exchanges/levex-futures?include_tickers=unexpired');
  const j = await res.json();
  const t = j.tickers ?? [];
  const byTarget = {};
  const funding = {};
  for (const x of t) {
    byTarget[x.target] = (byTarget[x.target] ?? 0) + 1;
    funding[x.funding_rate] = (funding[x.funding_rate] ?? 0) + 1;
  }
  const vol = t.reduce((a, x) => a + Number(x.converted_volume?.usd ?? 0), 0);
  log('coingecko', { status: res.status, ms: Math.round(performance.now() - t0), name: j.name, country: j.country, established: j.year_established, perpetualPairs: j.number_of_perpetual_pairs, futuresPairs: j.number_of_futures_pairs, tickers: t.length, byTarget, fundingPercent: funding, volume24hUsd: Math.round(vol), openInterestBtc: j.open_interest_btc, sample: t.slice(0, 1).map((x) => ({ symbol: x.symbol, trade_url: x.trade_url, index: x.index, funding_rate: x.funding_rate })) });
  const spot = await fetch('https://api.coingecko.com/api/v3/exchanges/levex');
  const s = await spot.json().catch(() => ({}));
  log('coingeckoSpot', { status: spot.status, name: s.name, trust_score_rank: s.trust_score_rank, country: s.country, tickers: s.tickers?.length ?? null });
}

await resolveAll();
for (const u of URLS) await fetchTwice(u);
await ccxtCheck();
await coingecko();
