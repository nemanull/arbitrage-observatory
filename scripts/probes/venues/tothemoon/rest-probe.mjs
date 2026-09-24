// Tothemoon public REST probe: host and latency, spot catalog, spot book snapshot, 24 h stats, error shapes and clock.
// Public, unauthenticated, read-only. One request at a time, spaced 1.1 s apart, under the documented 1 request per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/tothemoon/rest-probe.mjs <mode>
//   catalog  DNS, get-trade-pairs by quote, 24 h stats, and the fee config the web page reads. About 10 s.
//   book     20 get-order-book reads of BTC_USDT for latency, depth, level order and caching, then three depth parameters and four other pairs. About 40 s.
//   errors   unknown pair, missing parameter, a perpetual id, unknown paths, and the time call the docs name. About 10 s.
// Recorded in docs/profiles/tothemoon/rest.md and fees.md.
import { lookup } from 'node:dns/promises';

const API = 'https://api.tothemoon.com/v1/public';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const GAP = 1100;

async function get(url) {
  const t = performance.now();
  const r = await fetch(url);
  const text = await r.text();
  const ms = Math.round(performance.now() - t);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const h = (k) => r.headers.get(k);
  return { status: r.status, ms, bytes: text.length, json, text, headers: { date: h('date'), server: h('server'), cache: h('cache-control'), cf: h('cf-cache-status'), age: h('age'), ratelimit: h('x-ratelimit-limit') ?? h('ratelimit-limit') ?? null, retryAfter: h('retry-after') } };
}

async function catalog() {
  for (const h of ['api.tothemoon.com', 'docs.tothemoon.com', 'tothemoon.com']) {
    try { const a = await lookup(h, { all: true }); log('dns', { h, addrs: a.map((x) => x.address) }); } catch (e) { log('dns', { h, error: e.code }); }
  }
  const p = await get(`${API}/get-trade-pairs`);
  const rows = p.json?.data ?? [];
  const byQuote = rows.reduce((a, r) => ((a[r.quoted_currency] = (a[r.quoted_currency] ?? 0) + 1), a), {});
  log('trade_pairs', { status: p.status, ms: p.ms, bytes: p.bytes, count: rows.length, byQuote, fields: Object.keys(rows[0] ?? {}), sample: rows.slice(0, 2), headers: p.headers, perpLike: rows.filter((r) => /PERP/i.test(r.trade_pair)).length });
  await sleep(GAP);
  const s = await get(`${API}/get-24hrs-stat?trade_pair=BTC_USDT`);
  log('stat', { status: s.status, ms: s.ms, body: s.text.slice(0, 200) });
  await sleep(GAP);
  const f = await get('https://cryptology-prod.firebaseio.com/config/web/features/fees/tradeOptions.json');
  log('fee_config', { status: f.status, ms: f.ms, body: f.text.slice(0, 200) });
}

async function book() {
  const times = [];
  let prev = null, same = 0;
  const depth = [];
  let bidsDesc = 0, asksAsc = 0, crossed = 0;
  for (let i = 0; i < 20; i++) {
    const r = await get(`${API}/get-order-book?trade_pair=BTC_USDT`);
    times.push(r.ms);
    const d = r.json?.data;
    if (i === 0) log('book_first', { status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers, bid0: d?.bids?.[0], ask0: d?.asks?.[0], keys: Object.keys(d ?? {}) });
    if (d) {
      depth.push(`${d.bids.length}/${d.asks.length}`);
      const b = d.bids.map((x) => Number(x[0])), a = d.asks.map((x) => Number(x[0]));
      if (b.every((v, k) => k === 0 || v < b[k - 1])) bidsDesc++;
      if (a.every((v, k) => k === 0 || v > a[k - 1])) asksAsc++;
      if (b[0] >= a[0]) crossed++;
      if (prev === r.text) same++;
      prev = r.text;
    }
    await sleep(GAP);
  }
  const s = [...times].sort((x, y) => x - y);
  log('book_latency', { n: times.length, first: times[0], min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1], depths: [...new Set(depth)], bidsDescending: bidsDesc, asksAscending: asksAsc, crossed, identicalToPrevious: same });
  for (const q of ['limit=100', 'depth=50', 'type=FULL']) {
    const r = await get(`${API}/get-order-book?trade_pair=BTC_USDT&${q}`);
    log('book_param', { q, status: r.status, levels: r.json?.data ? `${r.json.data.bids.length}/${r.json.data.asks.length}` : r.text.slice(0, 120) });
    await sleep(GAP);
  }
  for (const pair of ['ETH_USDT', 'ATOM_USDT', 'BTC_EUR', 'XAUT_USDT']) {
    const r = await get(`${API}/get-order-book?trade_pair=${pair}`);
    const d = r.json?.data;
    log('book_pair', { pair, status: r.status, ms: r.ms, levels: d ? `${d.bids.length}/${d.asks.length}` : null, bid0: d?.bids?.[0], ask0: d?.asks?.[0], spreadPpm: d?.bids?.[0] && d?.asks?.[0] ? Math.round((Number(d.asks[0][0]) / Number(d.bids[0][0]) - 1) * 1e6) : null, error: r.json?.error ?? null });
    await sleep(GAP);
  }
}

async function errors() {
  const cases = [
    ['unknown_pair', `${API}/get-order-book?trade_pair=NOPE_USDT`],
    ['missing_param', `${API}/get-order-book`],
    ['perp_id_on_spot', `${API}/get-order-book?trade_pair=BTC_USDT_PERPETUAL`],
    ['time_call', `${API}/time`],
    ['unknown_path', `${API}/get-instruments`],
    ['v1_time', 'https://api.tothemoon.com/v1/time'],
    ['root', 'https://api.tothemoon.com/'],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    const local = Date.now();
    const skew = r.headers.date ? local - Date.parse(r.headers.date) : null;
    log('error_case', { name, status: r.status, ms: r.ms, body: r.text.slice(0, 200), localMinusDateHeaderMs: skew });
    await sleep(GAP);
  }
}

const mode = process.argv[2] ?? 'catalog';
const fn = { catalog, book, errors }[mode];
if (!fn) { console.error('unknown mode', mode); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await fn();
log('end', { mode, at: new Date().toISOString() });
