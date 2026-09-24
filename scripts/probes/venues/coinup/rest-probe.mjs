// CoinUp.io REST probe: what the public hosts answer this machine, and the listing and fee context that is readable elsewhere.
// Public, unauthenticated and read-only.
// No CoinUp documentation page is readable from here, so the futures and spot paths are the ChainUp open API shape that CCXT's bitrue class uses, at server/node_modules/ccxt/js/src/bitrue.js lines 153 and 225 to 233.
// Requests are sequential with 400 ms between two, about 30 requests in the access mode.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/coinup/rest-probe.mjs [access|context]
//   access   DNS, one GET per candidate URL with status and Cloudflare headers, the edge trace, and five timed repeats of one call, about 25 s
//   context  CCXT catalog check, the CoinGecko derivatives listing, and the help center fee, promotion and delisting articles, about 10 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/coinup/rest.md and docs/profiles/coinup/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const OUT = process.env.PROBE_OUT_DIR;
const HELP = 'https://helpcenter-coinup.zendesk.com/api/v2/help_center/en-us';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

const HOSTS = [
  'futuresopenapi.coinup.io', 'openapi.coinup.io', 'api.coinup.io', 'futuresws.coinup.io', 'ws.coinup.io',
  'futures.coinup.io', 'www.coinup.io', 'doc.coinup.io', 'capi.coinup.io', 'notice.coinup.io', 'helpcenter.coinup.io',
  'static.coinup.io', 'download.coinup.io', 'rank.coinup.io', 'otc.coinup.io', 'fapi.coinup.io',
];

const URLS = [
  'https://futuresopenapi.coinup.io/fapi/v1/ping',
  'https://futuresopenapi.coinup.io/fapi/v1/time',
  'https://futuresopenapi.coinup.io/fapi/v1/contracts',
  'https://futuresopenapi.coinup.io/fapi/v1/depth?contractName=E-BTC-USDT&limit=100',
  'https://futuresopenapi.coinup.io/fapi/v1/ticker?contractName=E-BTC-USDT',
  'https://futuresopenapi.coinup.io/fapi/v1/index?contractName=E-BTC-USDT',
  'https://openapi.coinup.io/sapi/v1/ping',
  'https://openapi.coinup.io/sapi/v1/time',
  'https://openapi.coinup.io/sapi/v1/symbols',
  'https://api.coinup.io/',
  'https://capi.coinup.io/',
  'https://futures.coinup.io/en_US/trade/E-BTC-USDT',
  'https://www.coinup.io/en_US/cms/apidoc',
  'https://www.coinup.io/en_US/cms/agreement',
  'https://www.coinup.io/en_US/cms/fee',
  'https://doc.coinup.io/',
  'https://notice.coinup.io/hc/en-us',
  'https://helpcenter.coinup.io/',
  'https://static.coinup.io/',
  'https://download.coinup.io/',
  'https://rank.coinup.io/',
  'https://otc.coinup.io/',
];

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), body);
}

async function get(url, headers = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, redirect: 'manual' });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    return { res, text, ms };
  } catch (e) {
    return { error: e.cause?.code ?? e.message, ms: Math.round(performance.now() - t0) };
  }
}

function describe(url, r) {
  if (r.error) return { url, error: r.error, ms: r.ms };
  const h = r.res.headers;
  const title = /<title>([^<]*)<\/title>/i.exec(r.text)?.[1];
  return {
    url,
    status: r.res.status,
    cfMitigated: h.get('cf-mitigated'),
    server: h.get('server'),
    ray: h.get('cf-ray'),
    type: h.get('content-type'),
    location: h.get('location'),
    retryAfter: h.get('retry-after'),
    bytes: r.text.length,
    ms: r.ms,
    title,
    body: title ? undefined : r.text.slice(0, 120),
  };
}

async function access() {
  for (const host of HOSTS) {
    try {
      log('dns', { host, a: await dns.resolve4(host) });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  for (const [i, url] of URLS.entries()) {
    const r = await get(url);
    log('get', describe(url, r));
    if (r.text) save(`get-${i}.txt`, r.text);
    await sleep(400);
  }

  const trace = await get('https://futuresopenapi.coinup.io/cdn-cgi/trace');
  const kv = Object.fromEntries((trace.text ?? '').trim().split('\n').map((l) => l.split('=')));
  log('edge', { status: trace.res?.status, colo: kv.colo, loc: kv.loc, http: kv.http, tls: kv.tls, warp: kv.warp });

  const times = [];
  const statuses = new Set();
  for (let i = 0; i < 5; i++) {
    const r = await get('https://futuresopenapi.coinup.io/fapi/v1/time');
    times.push(r.ms);
    statuses.add(r.res?.status ?? r.error);
    await sleep(1_000);
  }
  log('repeat', { url: '/fapi/v1/time', statuses: [...statuses], ms: times });
}

async function context() {
  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, coinup: ccxt.exchanges.filter((id) => /coinup/i.test(id)), total: ccxt.exchanges.length });

  const cg = await get('https://api.coingecko.com/api/v3/derivatives/exchanges/coinup-futures?include_tickers=unexpired');
  if (cg.res?.status === 200) {
    save('coingecko-derivatives.json', cg.text);
    const j = JSON.parse(cg.text);
    const tally = {};
    for (const t of j.tickers) tally[`${t.contract_type}/${t.target}`] = (tally[`${t.contract_type}/${t.target}`] ?? 0) + 1;
    const ids = j.tickers.map((t) => t.trade_url.split('/').pop());
    const btc = j.tickers.find((t) => t.base === 'BTC');
    log('coingecko', {
      name: j.name, country: j.country, perpetualPairs: j.number_of_perpetual_pairs, futuresPairs: j.number_of_futures_pairs,
      tickers: j.tickers.length, byType: tally, idShape: ids.every((id) => /^E-[A-Z0-9]+-USDT$/.test(id)), sampleIds: ids.slice(0, 3),
      btc: { last: btc?.last, index: btc?.index, fundingRatePct: btc?.funding_rate, spread: btc?.bid_ask_spread, oiUsd: btc?.open_interest_usd },
    });
    const delisted = new Set('RESOLV HYPER BOME SAHARA INIT POPCAT CELO ASR ALT GRASS MEW SOPH PEOPLE NEWT CFX SUN TURBO DOGS ICP BIGTIME ACT NOT MEME BLUR MOVE JTO YGG APE SIGN ALICE G TRB KSM EIGEN IMX HAEDAL JASMY GMT PENDER'.split(' '));
    const live = j.tickers.filter((t) => !delisted.has(t.base));
    const rates = live.map((t) => t.funding_rate);
    log('coingecko_delisted', {
      listedButDelisted: j.tickers.length - live.length,
      rest: live.length,
      fundingRatePct: { min: Math.min(...rates), max: Math.max(...rates), at001: rates.filter((r) => r === 0.01).length },
      openInterestZero: live.filter((t) => !t.open_interest_usd).length,
    });
  } else {
    log('coingecko', describe('coingecko', cg));
  }
  await sleep(400);

  for (const id of ['44454802247193', '62020538776729', '62438443551129', '50804909839641']) {
    const r = await get(`${HELP}/articles/${id}.json`);
    if (r.res?.status !== 200) {
      log('article', describe(id, r));
      continue;
    }
    const a = JSON.parse(r.text).article;
    const body = a.body.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const hits = body.match(/[^.]{0,80}(0\.06%|0\.02%|0%|UTC\+8|delist the)[^.]{0,120}/g) ?? [];
    log('article', { id, title: a.title, updated: a.updated_at, hits: hits.slice(0, 4) });
    await sleep(400);
  }
}

const mode = process.argv[2] ?? 'access';
if (mode === 'access') await access();
else if (mode === 'context') await context();
else console.error('unknown mode', mode);
