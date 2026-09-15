// Reads the anchors and the top of book of the standing basis pairs on every venue that lists them, and applies the open gate's refusals to every ordered pair of venues.
// Run on Node 24: ROUNDS=90 GAP_MS=2000 OUT=samples.json node scripts/probes/basis-gate-probe.mjs
// Fees are the VENUE_REGISTRY rates, and okx OPENAI and ANTHROPIC are scaled by 10 as PRICE_SCALE does.
// The thin book floor is not evaluated.
import { writeFileSync } from 'node:fs';

const BASES = (process.env.BASES ?? 'OPENAI,ANTHROPIC,ONG,SIREN,ONE').split(',');
const ROUNDS = Number(process.env.ROUNDS ?? 45);
const GAP_MS = Number(process.env.GAP_MS ?? 2000);
const OUT = process.env.OUT;
const FEE_PPM = { binance: 500, bybit: 550, okx: 500, krakenfutures: 500, coinbase: 400 };
const SCALE = { 'okx|ANTHROPIC-USDT-SWAP': 10, 'okx|OPENAI-USDT-SWAP': 10 };
const MIN_NET_PPM = 5000;
const MAX_PLAUSIBLE_NET_PPM = 100000;
const MAX_ANCHOR_MOVE_PPM = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
async function safe(p) { try { return await p; } catch (e) { return { __error: e.message }; } }
const num = (x) => (x === undefined || x === null || x === '' ? NaN : Number(x));
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : x);
const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(3) + '%' : String(x));

async function statuses() {
  const out = {};
  const bin = await safe(j('https://fapi.binance.com/fapi/v1/exchangeInfo'));
  for (const b of BASES) {
    out[b] = {};
    const s = bin.symbols?.find((x) => x.symbol === `${b}USDT`);
    out[b].binance = s ? `${s.status} ${s.contractType}` : 'not listed';
    const by = await safe(j(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${b}USDT`));
    const bi = by.result?.list?.[0];
    out[b].bybit = bi ? `${bi.status} ${bi.contractType}` : 'not listed';
    const ok = await safe(j(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${b}-USDT-SWAP`));
    const oi = ok.data?.[0];
    out[b].okx = oi ? `${oi.state} uly=${oi.uly} ctVal=${oi.ctVal}` : 'not listed';
    out[b].okxUly = oi?.uly ?? `${b}-USDT`;
  }
  return out;
}

async function round(st) {
  const kr = safe(j('https://futures.kraken.com/derivatives/api/v3/tickers'));
  const cb = safe(j('https://api.international.coinbase.com/api/v1/instruments'));
  const perBase = await Promise.all(BASES.map(async (b) => {
    const [pi, bt, byt, okt, okm, oki] = await Promise.all([
      safe(j(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${b}USDT`)),
      safe(j(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${b}USDT`)),
      safe(j(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${b}USDT`)),
      safe(j(`https://www.okx.com/api/v5/market/ticker?instId=${b}-USDT-SWAP`)),
      safe(j(`https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${b}-USDT-SWAP`)),
      safe(j(`https://www.okx.com/api/v5/market/index-tickers?instId=${st[b].okxUly}`)),
    ]);
    const legs = {};
    if (!pi.__error && !bt.__error) legs.binance = { id: `${b}USDT`, bid: num(bt.bidPrice), ask: num(bt.askPrice), index: num(pi.indexPrice), mark: num(pi.markPrice) };
    const byl = byt.result?.list?.[0];
    if (byl) legs.bybit = { id: `${b}USDT`, bid: num(byl.bid1Price), ask: num(byl.ask1Price), index: num(byl.indexPrice), mark: num(byl.markPrice) };
    const okl = okt.data?.[0];
    if (okl) legs.okx = { id: `${b}-USDT-SWAP`, bid: num(okl.bidPx), ask: num(okl.askPx), index: num(oki.data?.[0]?.idxPx), mark: num(okm.data?.[0]?.markPx) };
    return [b, legs];
  }));
  const krv = await kr;
  const cbv = await cb;
  const rows = Object.fromEntries(perBase);
  for (const b of BASES) {
    const k = krv.tickers?.find((t) => String(t.symbol).toUpperCase() === `PF_${b}USD`);
    if (k && k.tag === 'perpetual' && !k.suspended) rows[b].krakenfutures = { id: `PF_${b}USD`, bid: num(k.bid), ask: num(k.ask), index: num(k.indexPrice), mark: num(k.markPrice) };
    const c = Array.isArray(cbv) ? cbv.find((x) => x.symbol === `${b}-PERP` && x.type === 'PERP') : undefined;
    if (c && c.trading_state !== 'DELISTED' && c.quote) rows[b].coinbase = { id: `${b}-PERP-INTX`, state: c.trading_state, bid: num(c.quote.best_bid_price), ask: num(c.quote.best_ask_price), index: num(c.quote.index_price), mark: num(c.quote.mark_price) };
  }
  return { ts: Date.now(), rows, errors: { kraken: krv.__error, coinbase: cbv.__error } };
}

function evaluate(legs, prevLegs) {
  const venues = Object.keys(legs).filter((v) => legs[v].bid > 0 && legs[v].ask > 0);
  const info = {};
  for (const v of venues) {
    const L = legs[v];
    const scale = SCALE[`${v}|${L.id}`] ?? 1;
    const fee = FEE_PPM[v] / 1e6;
    const P = prevLegs?.[v];
    const move = P && P.index > 0 ? Math.max(Math.abs(L.index - P.index) / P.index, P.mark > 0 && L.mark > 0 ? Math.abs(L.mark - P.mark) / P.mark : 0) * 1e6 : Infinity;
    info[v] = { ...L, scale, fee, bidAdj: L.bid * (1 - fee) * scale, askAdj: L.ask * (1 + fee) * scale, fpBid: L.bid / L.mark - 1, fpAsk: L.ask / L.mark - 1, markPrem: L.mark / L.index - 1, move };
  }
  const routes = [];
  for (const s of venues) for (const b of venues) {
    if (s === b) continue;
    const S = info[s], B = info[b];
    const raw = (S.bidAdj / B.askAdj - 1) * 1e6;
    const fresh = ((1 + S.fpBid) / (1 + B.fpAsk) * (1 - S.fee) / (1 + B.fee) - 1) * 1e6;
    const indexGap = ((S.index * S.scale) / (B.index * B.scale) - 1) * 1e6;
    routes.push({ route: `${s}-${b}`, raw, fresh, indexGap, verdict: verdict(raw, fresh, S, B, false), verdictMoving: verdict(raw, fresh, S, B, true) });
  }
  let best = null;
  if (venues.length >= 2) {
    const s = venues.reduce((a, v) => (info[v].bidAdj > info[a].bidAdj ? v : a));
    const b = venues.reduce((a, v) => (info[v].askAdj < info[a].askAdj ? v : a));
    best = s === b ? { route: `${s}-${b}`, verdict: 'same_venue' } : routes.find((r) => r.route === `${s}-${b}`);
  }
  return { info, routes, best };
}

function verdict(raw, fresh, S, B, withMoving) {
  if (raw < MIN_NET_PPM) return 'below_min';
  if (raw > MAX_PLAUSIBLE_NET_PPM) return 'implausible_net_ppm';
  if (!(S.index > 0) || !(B.index > 0)) return 'anchor_missing';
  if (!(S.mark > 0) || !(B.mark > 0)) return 'anchor_no_mark';
  if (withMoving && (S.move > MAX_ANCHOR_MOVE_PPM || B.move > MAX_ANCHOR_MOVE_PPM)) return 'anchor_moving';
  if (fresh < MIN_NET_PPM) return 'standing_basis';
  return 'PASSES_FRESH_GATE';
}

const st = await statuses();
console.log('statuses', JSON.stringify(st, null, 1));
const samples = [];
let prev = {};
for (let i = 0; i < ROUNDS; i++) {
  const t0 = Date.now();
  const r = await round(st);
  const ev = {};
  for (const b of BASES) ev[b] = evaluate(r.rows[b], prev[b]);
  samples.push({ ts: r.ts, errors: r.errors, rows: r.rows, ev });
  prev = r.rows;
  await sleep(Math.max(0, GAP_MS - (Date.now() - t0)));
}
if (OUT) writeFileSync(OUT, JSON.stringify({ st, samples }));

for (const b of BASES) {
  console.log(`\n===== ${b} =====`);
  const venues = [...new Set(samples.flatMap((s) => Object.keys(s.ev[b].info)))];
  for (const v of venues) {
    const xs = samples.map((s) => s.ev[b].info[v]).filter(Boolean);
    const mv = xs.map((x) => x.move).filter(Number.isFinite);
    console.log(`  ${v.padEnd(13)} n=${xs.length} bid/mark-1 med ${pct(median(xs.map((x) => x.fpBid)))} ask/mark-1 med ${pct(median(xs.map((x) => x.fpAsk)))} mark/index-1 med ${pct(median(xs.map((x) => x.markPrem)))} spread med ${pct(median(xs.map((x) => x.ask / x.bid - 1)))} move>1000ppm ${mv.filter((m) => m > 1000).length}/${mv.length}`);
  }
  const bestCounts = {};
  const bestCountsMoving = {};
  for (const s of samples) {
    const k = s.ev[b].best ? `${s.ev[b].best.route} ${s.ev[b].best.verdict}` : 'no_route';
    bestCounts[k] = (bestCounts[k] ?? 0) + 1;
    const k2 = s.ev[b].best ? `${s.ev[b].best.route} ${s.ev[b].best.verdictMoving ?? s.ev[b].best.verdict}` : 'no_route';
    bestCountsMoving[k2] = (bestCountsMoving[k2] ?? 0) + 1;
  }
  console.log('  best route verdicts, without moving guard:', JSON.stringify(bestCounts));
  console.log('  best route verdicts, with moving guard   :', JSON.stringify(bestCountsMoving));
  const routes = [...new Set(samples.flatMap((s) => s.ev[b].routes.map((r) => r.route)))];
  for (const rt of routes) {
    const xs = samples.map((s) => s.ev[b].routes.find((r) => r.route === rt)).filter(Boolean);
    const crossed = xs.filter((x) => x.raw >= MIN_NET_PPM);
    if (crossed.length === 0) continue;
    const passes = xs.filter((x) => x.verdict === 'PASSES_FRESH_GATE');
    console.log(`  route ${rt.padEnd(24)} raw>=5000 ${crossed.length}/${xs.length} passes fresh gate ${passes.length} | raw med ${r0(median(xs.map((x) => x.raw)))} max ${r0(Math.max(...xs.map((x) => x.raw)))} | fresh med ${r0(median(xs.map((x) => x.fresh)))} max ${r0(Math.max(...xs.map((x) => x.fresh)))} | indexGap med ${r0(median(xs.map((x) => x.indexGap)))}`);
  }
  const errs = samples.map((s) => s.errors).filter((e) => e.kraken || e.coinbase);
  if (errs.length) console.log('  round errors:', errs.length);
}
