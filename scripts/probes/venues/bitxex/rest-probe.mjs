// BitxEX futures REST probe: catalog of both families, bulk anchor call, one symbol's funding, index and mark, REST book, latency.
// Public, unauthenticated, read-only. The API sits behind the web origin at https://bitxex.io/futures/{fapi,dapi}, the XT.com futures layout.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitxex/rest-probe.mjs [catalog|anchor]
//   catalog  USDT-M and coin-M symbol lists, counts by contractType, state and fee pair, and whether CCXT 4.5.68 has a class.
//   anchor   agg-tickers twice, funding-rate, index-price, mark-price and depth for btc_usdt, each call timed. Calls run concurrently because a reply can take 35 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitxex/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// server/node_modules went away when the TypeScript server moved to old_ts_server/ on 2026-09-24, so the pnpm virtual store is the fallback.
const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const storeRequire = createRequire(new URL('../../../../node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/package.json', import.meta.url));
let ccxt;
try { ccxt = require('ccxt'); } catch { ccxt = storeRequire('ccxt'); }

const ORIGIN = 'https://bitxex.io/futures';
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, name) {
  const t0 = Date.now();
  try {
    const res = await fetch(ORIGIN + path, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    const ms = Date.now() - t0;
    keep(name, text);
    const type = res.headers.get('content-type');
    let json = null;
    try { json = JSON.parse(text); } catch {}
    log('http', { path, status: res.status, ms, bytes: text.length, type, date: res.headers.get('date'), retryAfter: res.headers.get('retry-after'), code: json?.code, msg: json?.msg });
    return json;
  } catch (e) {
    log('http', { path, error: String(e.name || e), ms: Date.now() - t0 });
    return null;
  }
}

async function catalog() {
  log('ccxt', { version: ccxt.version, match: ccxt.exchanges.filter((x) => /bitx|xex/i.test(x)) });
  const [u, c] = await Promise.all([
    get('/fapi/market/v1/public/symbol/list', 'fapi-symbols.json'),
    get('/dapi/market/v1/public/symbol/list', 'dapi-symbols.json'),
  ]);
  for (const [fam, j] of [['fapi', u], ['dapi', c]]) {
    const d = j?.data;
    if (!Array.isArray(d)) { log('family', { fam, rows: null }); continue; }
    const byKind = {}, byFee = {};
    for (const m of d) {
      const k = `${m.contractType} ${m.underlyingType} ${m.quoteCoin} state=${m.state} trade=${m.tradeSwitch}`;
      byKind[k] = (byKind[k] || 0) + 1;
      const f = `maker=${m.makerFee} taker=${m.takerFee}`;
      byFee[f] = (byFee[f] || 0) + 1;
    }
    const odd = d.filter((m) => m.takerFee !== '0.0004' || m.makerFee !== '0.0004').map((m) => `${m.symbol} ${m.makerFee}/${m.takerFee}`);
    const btc = d.find((m) => m.symbol === 'btc_usdt' || m.symbol === 'btc_usd');
    log('family', { fam, rows: d.length, byKind, byFee, odd, sample: btc && { symbol: btc.symbol, contractSize: btc.contractSize, pricePrecision: btc.pricePrecision, quantityPrecision: btc.quantityPrecision, liquidationFee: btc.liquidationFee } });
  }
}

async function anchor() {
  const t0 = Date.now();
  const calls = [
    ['/fapi/market/v1/public/q/agg-tickers', 'agg-1.json'],
    ['/fapi/market/v1/public/q/funding-rate?symbol=btc_usdt', 'funding.json'],
    ['/fapi/market/v1/public/q/index-price?symbol=btc_usdt', 'index.json'],
    ['/fapi/market/v1/public/q/mark-price?symbol=btc_usdt', 'mark.json'],
    ['/fapi/market/v1/public/q/depth?symbol=btc_usdt&level=50', 'depth.json'],
    ['/fapi/market/v1/public/q/funding-rate-record?symbol=btc_usdt&limit=5', 'funding-record.json'],
  ];
  const replies = await Promise.all(calls.map(([p, n]) => get(p, n)));
  const [agg, fr, ix, mk, dp, rec] = replies;
  if (Array.isArray(agg?.data)) {
    const rows = agg.data;
    const b = rows.find((r) => r.s === 'btc_usdt');
    log('agg', { rows: rows.length, keys: b && Object.keys(b), btc: b, missingMark: rows.filter((r) => !(+r.m > 0)).length, missingIndex: rows.filter((r) => !(+r.i > 0)).length });
  }
  log('funding', { data: fr?.data });
  log('index', { data: ix?.data });
  log('mark', { data: mk?.data });
  log('fundingRecord', { data: Array.isArray(rec?.data?.items) ? rec.data.items.slice(0, 5) : rec?.data });
  if (dp?.data) {
    const { b = [], a = [] } = dp.data;
    const desc = b.every((x, i) => i === 0 || +x[0] < +b[i - 1][0]);
    const asc = a.every((x, i) => i === 0 || +x[0] > +a[i - 1][0]);
    log('depth', { keys: Object.keys(dp.data), bids: b.length, asks: a.length, bidsDescending: desc, asksAscending: asc, top: { b: b.slice(0, 2), a: a.slice(0, 2) }, t: dp.data.t, u: dp.data.u, ageMs: dp.data.t ? Date.now() - dp.data.t : null });
  }
  log('done', { ms: Date.now() - t0 });
}

const mode = process.argv[2] || 'catalog';
if (mode === 'catalog') await catalog();
else if (mode === 'anchor') await anchor();
else console.log('modes: catalog | anchor');
