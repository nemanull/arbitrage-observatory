// SafeTrade REST probe: DNS, the Cloudflare exit this host is seen from, what every public API path on both SafeTrade domains returns here, and whether CCXT 4.5.68 has a SafeTrade class.
// Public, unauthenticated, read-only. One request at a time with a 1 s pause, far below any limit, and no attempt to pass the challenge page.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/safetrade/rest-probe.mjs [access|ccxt]
//   access  resolves the hosts, reads the Cloudflare trace, then GETs each API path on safe.trade and safetrade.com and prints status, timing and the refusal text, and repeats one path per host with a browser User-Agent. About 30 s.
//   ccxt    prints the CCXT version and exchange count, and greps the installed CCXT sources for the SafeTrade hosts.
// Recorded in docs/profiles/safetrade/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOSTS = ['safe.trade', 'safetrade.com', 'support.safetrade.com'];

// Paths the official example client, the help center and public integrations call, plus the legacy Peatio prefix.
const PATHS = [
  '/',
  '/api/v2/trade/public/markets',
  '/api/v2/trade/public/tickers',
  '/api/v2/trade/public/markets/btcusdt/depth',
  '/api/v2/trade/public/markets/btcusdt/order-book',
  '/api/v2/trade/public/timestamp',
  '/api/v2/peatio/public/markets',
  '/api/v2/peatio/public/markets/tickers',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function refusalText(body) {
  const text = body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const i = text.indexOf('If you are seeing this page');
  return i >= 0 ? text.slice(i, i + 160) : text.slice(0, 120);
}

// A desktop browser User-Agent, sent once per host to show the refusal does not depend on the client name.
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function get(url, headers = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(20_000) });
    const body = await res.text();
    return {
      url,
      status: res.status,
      ms: Math.round(performance.now() - t0),
      bytes: body.length,
      contentType: res.headers.get('content-type'),
      cfMitigated: res.headers.get('cf-mitigated'),
      cfRay: res.headers.get('cf-ray'),
      retryAfter: res.headers.get('retry-after'),
      canadaNotice: body.includes('you may be from Canada'),
      challengeType: body.match(/cType: '([a-z]+)'/)?.[1] ?? null,
      text: res.status === 200 && (res.headers.get('content-type') ?? '').includes('json') ? body.slice(0, 160) : refusalText(body),
    };
  } catch (err) {
    return { url, error: String(err.cause?.code ?? err.message), ms: Math.round(performance.now() - t0) };
  }
}

async function access() {
  for (const host of HOSTS) {
    const a = await dns.resolve4(host).catch((e) => e.code);
    const aaaa = await dns.resolve6(host).catch((e) => e.code);
    const cname = await dns.resolveCname(host).catch((e) => e.code);
    log('dns', { host, a, aaaa, cname });
  }

  // The trace names the edge colo and the country Cloudflare places this host in.
  for (const url of ['https://www.cloudflare.com/cdn-cgi/trace', 'https://safe.trade/cdn-cgi/trace', 'https://safetrade.com/cdn-cgi/trace']) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch((e) => ({ status: String(e.cause?.code ?? e.message), text: async () => '' }));
    const text = await res.text();
    const kv = Object.fromEntries(text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    log('trace', { url, status: res.status, colo: kv.colo, loc: kv.loc, http: kv.http });
    await sleep(1_000);
  }

  for (const host of ['safe.trade', 'safetrade.com']) {
    for (const path of PATHS) {
      log('get', await get(`https://${host}${path}`));
      await sleep(1_000);
    }
    log('get_browser_ua', await get(`https://${host}/api/v2/trade/public/markets`, { 'user-agent': BROWSER_UA }));
    await sleep(1_000);
  }

  // The help center is a separate Zendesk host, and its article list is the only public document source that answered.
  const t0 = performance.now();
  const res = await fetch('https://support.safetrade.com/api/v2/help_center/en-us/articles.json?per_page=1', { signal: AbortSignal.timeout(20_000) });
  const zd = res.ok ? await res.json() : {};
  log('helpcenter', { status: res.status, ms: Math.round(performance.now() - t0), count: zd.count, newest: zd.articles?.[0]?.title, newestCreated: zd.articles?.[0]?.created_at });
}

function ccxt() {
  const ccxtLib = require('ccxt');
  const matches = ccxtLib.exchanges.filter((id) => /safe|trade/i.test(id));
  log('ccxt', { version: ccxtLib.version, exchanges: ccxtLib.exchanges.length, idsMatchingSafeOrTrade: matches, hasSafetrade: ccxtLib.exchanges.includes('safetrade') });

  // The class sources are large, so each is read and dropped one at a time.
  const srcDir = new URL('../../../../server/node_modules/ccxt/js/src', import.meta.url).pathname;
  const hits = [];
  for (const dir of [srcDir, join(srcDir, 'pro')]) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (s.includes('safe.trade') || s.includes('safetrade.com')) hits.push(join(dir === srcDir ? '' : 'pro', f));
    }
  }
  log('ccxt_source_grep', { dir: 'server/node_modules/ccxt/js/src and pro/', needles: ['safe.trade', 'safetrade.com'], hits });
}

const mode = process.argv[2] ?? 'access';
if (mode === 'access') await access();
else if (mode === 'ccxt') ccxt();
else console.error(`unknown mode ${mode}`);
