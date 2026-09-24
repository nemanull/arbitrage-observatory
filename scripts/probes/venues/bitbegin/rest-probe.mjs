// Bitbegin REST probe: host and latency, what the API host returns to a client without the web client's header, the public page data the site serves, futures availability, a price compare against Gate, how often the page data changes, the clock offset, and the CCXT catalog.
// Public, unauthenticated, read-only. It never sends the `userapisecret` header the web client carries, and it stays near one request a second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitbegin/rest-probe.mjs [all|access|pages|poll]
//   access  DNS, cold and warm timings, the API host's refusals and 404s, the neighbouring hosts, Cloudflare trace, clock offset. About 35 s.
//   pages   the Next.js page data of the landing, markets and futures pages, settings flags, the pair list, a Gate compare, and CCXT. About 10 s.
//   poll    the landing page data every 3 s for 60 s, and how often each pair's last price changed. About 65 s.
// Recorded in docs/profiles/bitbegin/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const SITE = 'https://www.bitbegin.io';
const API = 'https://api.bitbegin.io';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) bitbegin-probe';
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function timed(url, opts = {}) {
  const t0 = performance.now();
  const r = await fetch(url, { redirect: 'manual', ...opts, headers: { 'User-Agent': UA, Accept: 'application/json, text/html', ...(opts.headers ?? {}) } });
  const body = await r.text();
  return { status: r.status, ms: Math.round(performance.now() - t0), bytes: body.length, body, headers: r.headers };
}

async function buildId() {
  const r = await timed(`${SITE}/`);
  return r.body.match(/"buildId":"([^"]+)"/)?.[1];
}

async function access() {
  for (const host of ['www.bitbegin.io', 'api.bitbegin.io', 'bitbegin.io', 'www.bitbegin.com', 'bitbegin.com']) {
    const a = await dns.resolve4(host).catch((e) => e.code);
    log('dns', { host, a });
  }

  for (const [name, url] of [['site', `${SITE}/`], ['api_common_settings', `${API}/api/common-settings`]]) {
    const times = [];
    let first;
    for (let i = 0; i < 5; i++) {
      const r = await timed(url);
      first ??= r;
      times.push(r.ms);
      await sleep(1_000);
    }
    log('latency', { name, status: first.status, coldMs: times[0], warmMs: times.slice(1), cfRay: first.headers.get('cf-ray') });
  }

  // Routes the web client calls, read from its bundle. Each one is asked without the web client's header.
  const routes = [
    '/api/common-settings',
    '/api/app-dashboard/BTC_USDT',
    '/api/get-exchange-all-orders-app?per_page=50&dashboard_type=dashboard&order_type=buy_sell&base_coin_id=2&trade_coin_id=1',
    '/api/get-exchange-market-trades-app?dashboard_type=dashboard&base_coin_id=2&trade_coin_id=1',
    '/api/get-networks-list',
  ];
  for (const path of routes) {
    const r = await timed(`${API}${path}`);
    const h = {};
    for (const k of ['content-type', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'cache-control', 'server']) if (r.headers.get(k)) h[k] = r.headers.get(k);
    log('api_without_header', { path, status: r.status, ms: r.ms, body: r.body.slice(0, 160), headers: h });
    await sleep(1_000);
  }

  // Paths a documented public API or a listing feed would commonly use.
  const guesses = ['/api/v1/ticker', '/api/v2/summary', '/api/v2/ticker', '/api/tickers', '/api/coingecko/tickers', '/api/public/tickers', '/api-docs', '/api/documentation'];
  const guessed = [];
  for (const path of guesses) {
    const r = await timed(`${API}${path}`);
    guessed.push(`${path} ${r.status} ${r.body.replace(/\s+/g, '').slice(0, 30)}`);
    await sleep(500);
  }
  log('api_guesses', { guessed });

  // Neighbouring hosts: the .com domain and the market maker page linked from the homepage.
  for (const url of ['https://www.bitbegin.com/', 'https://market-maker.bitbegin.io/']) {
    const r = await timed(url);
    log('other_host', { url, status: r.status, bytes: r.bytes, title: r.body.match(/<title>([^<]*)/)?.[1] ?? null, generator: r.body.match(/name="generator" content="([^"]*)"/)?.[1] ?? null });
  }

  const trace = await timed(`${SITE}/cdn-cgi/trace`);
  const kv = Object.fromEntries(trace.body.trim().split('\n').map((l) => l.split('=')));
  log('cloudflare_trace', { status: trace.status, loc: kv.loc, colo: kv.colo, http: kv.http, tls: kv.tls });

  // The API host's Date header against the local clock, midpoint of the request.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await fetch(`${API}/api/common-settings`, { headers: { 'User-Agent': UA } });
    await r.text();
    const t1 = Date.now();
    offsets.push(Date.parse(r.headers.get('date')) - (t0 + t1) / 2);
    await sleep(1_000);
  }
  log('clock', { offsetsMs: offsets.map(Math.round), note: 'Date header has whole seconds' });
}

function pairsOf(pageProps) {
  const m = new Map();
  for (const list of ['asset_coin_pairs', 'hourly_coin_pairs', 'latest_coin_pairs']) {
    for (const p of pageProps[list] ?? []) m.set(p.id, p);
  }
  return [...m.values()];
}

async function pages() {
  const id = await buildId();
  log('build', { buildId: id });

  const index = await timed(`${SITE}/_next/data/${id}/index.json`);
  const props = JSON.parse(index.body).pageProps;
  const s = props.customSettings ?? {};
  log('index_data', { status: index.status, ms: index.ms, bytes: index.bytes, cacheControl: index.headers.get('cache-control') });
  const flags = {};
  for (const k of ['enable_future_trade', 'api_access_enable', 'api_access_allow_user', 'api_access_trade_enable', 'secret_key_available', 'p2p_module', 'enable_staking', 'enable_demo_trade', 'enable_bot_trade', 'swap_status', 'maintenance_mode_status', 'exchange_url', 'public_chanel_name', 'base_currency']) flags[k] = s[k];
  flags.public_key_present = typeof s.public_key === 'string' && s.public_key.length > 0;
  log('settings_flags', flags);

  const pairs = pairsOf(props);
  log('pairs', { count: pairs.length, quotes: [...new Set(pairs.map((p) => p.parent_coin_name))], listFields: Object.keys(pairs[0] ?? {}).join(',') });

  const gate = {};
  for (const p of pairs) {
    if (p.parent_coin_name !== 'USDT') continue;
    const r = await fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${p.child_coin_name}_USDT`).then((x) => x.json()).catch(() => null);
    gate[p.child_coin_name] = Array.isArray(r) ? Number(r[0].last) : null;
    await sleep(200);
  }
  for (const p of pairs) {
    const g = p.parent_coin_name === 'USDT' ? gate[p.child_coin_name] : null;
    const last = Number(p.last_price);
    log('pair', {
      pair: `${p.child_coin_name}/${p.parent_coin_name}`,
      ids: `${p.parent_coin_id}-${p.child_coin_id}`,
      last: p.last_price,
      volume: p.volume,
      change: p.price_change,
      gateLast: g,
      diffPpm: g ? Math.round((last / g - 1) * 1e6) : null,
    });
  }

  for (const page of ['markets', 'exchange/dashboard', 'futures/exchange', 'futures/wallet-list']) {
    const r = await timed(`${SITE}/_next/data/${id}/${page}.json`);
    let pp = {};
    try {
      pp = JSON.parse(r.body).pageProps ?? {};
    } catch {
      pp = { unparsed: r.body.slice(0, 80) };
    }
    log('page_data', { page, status: r.status, bytes: r.bytes, keys: Object.keys(pp).join(','), redirect: pp.__N_REDIRECT ?? null, redirectStatus: pp.__N_REDIRECT_STATUS ?? null, location: r.headers.get('location') });
    await sleep(500);
  }

  const html = await timed(`${SITE}/futures/exchange`);
  log('futures_page', { status: html.status, location: html.headers.get('location') });

  log('ccxt', { version: ccxt.version, count: ccxt.exchanges.length, matches: ccxt.exchanges.filter((e) => /begin/i.test(e)) });
}

async function poll() {
  const id = await buildId();
  const history = new Map();
  let n = 0;
  const times = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    const r = await timed(`${SITE}/_next/data/${id}/index.json`);
    times.push(r.ms);
    n++;
    for (const p of pairsOf(JSON.parse(r.body).pageProps)) {
      const key = `${p.child_coin_name}/${p.parent_coin_name}`;
      const h = history.get(key) ?? { values: [], changes: 0 };
      if (h.values.length && h.values.at(-1) !== p.last_price) h.changes++;
      h.values.push(p.last_price);
      history.set(key, h);
    }
    await sleep(3_000);
  }
  const sorted = [...times].sort((a, b) => a - b);
  log('poll', { polls: n, minMs: sorted[0], medianMs: sorted[Math.floor(n / 2)], maxMs: sorted.at(-1) });
  for (const [pair, h] of history) log('changes', { pair, polls: h.values.length, changes: h.changes, first: h.values[0], last: h.values.at(-1) });
}

const mode = process.argv[2] ?? 'all';
if (mode === 'access' || mode === 'all') await access();
if (mode === 'pages' || mode === 'all') await pages();
if (mode === 'poll' || mode === 'all') await poll();
